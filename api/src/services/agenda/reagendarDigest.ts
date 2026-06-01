import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

/**
 * Digest diário "Reagendar" — todo dia às 17h (BRT) manda pra cada consultor a
 * lista dos clientes DELE que estão parados precisando ser reagendados, com um
 * link único que abre o CRM já filtrado nessa lista.
 *
 * IMPORTANTE — esta regra DEVE espelhar a coluna "Reagendar" do CRM
 * (dashboard/public/gerador/index.html → crmUnificar/derivação de etapa).
 * Se mudar lá, mude aqui. Precedência do funil (de cima pra baixo):
 *   vendido → perdido → temperatura(quente/morno/frio) → falando_whatsapp → REAGENDAR → agendado
 * "Reagendar" = agendamento sem ação que passou do horário, OU nao_atendeu, OU sem_orcamento,
 *   e que NÃO foi resgatado por venda, temperatura, conversa ativa ou perda.
 */

const ZAPI_INSTANCE = 'io' as const;
const CRM_BASE_URL = 'https://solardoc.app/gerador';

const STATUS_PERDIDO = new Set(['cancelado', 'sem_interesse']);
const STATUS_REAGENDAR = new Set(['nao_atendeu', 'sem_orcamento']);

type Agendamento = {
  id: number;
  vendedor_nome: string;
  quando: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  cidade: string | null;
  status: string;
  temperatura: string | null;
};

type Proposta = {
  cliente_nome: string | null;
  consultor_nome: string | null;
  vendido: boolean | null;
  dados: any;
};

// Mesma chave do CRM: só dígitos, tira 55, DDD + últimos 8 (ignora o 9º dígito).
function telKey(raw: string | null | undefined): string | null {
  let d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

function primeiroNome(nome: string): string {
  const n = (nome || '').trim().split(/\s+/)[0] || '';
  return n;
}

type ClienteReagendar = { nome: string; telefone: string | null; cidade: string | null; quando: string; status: string };

/**
 * Calcula, por consultor, a lista de clientes que precisam reagendar.
 * Retorna um Map vendedor_nome → ClienteReagendar[] (deduplicado por telefone).
 */
export async function calcularReagendarPorConsultor(): Promise<Map<string, ClienteReagendar[]>> {
  const agora = Date.now();

  const [{ data: agendamentos, error: e1 }, { data: propostas, error: e2 }] = await Promise.all([
    supabaseGerador
      .from('agendamentos')
      .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade, status, temperatura')
      .order('quando', { ascending: false }),
    supabaseGerador
      .from('propostas')
      .select('cliente_nome, consultor_nome, vendido, dados'),
  ]);

  if (e1) { logger.error('reagendar', 'falha ao listar agendamentos', e1); return new Map(); }

  const ags = (agendamentos || []) as Agendamento[];
  const props = (propostas || []) as Proposta[];
  if (e2) logger.error('reagendar', 'falha ao listar propostas (segue sem cross-check de venda)', e2);

  // Conjuntos por telefone que RESGATAM o cliente de "Reagendar":
  const vendidos = new Set<string>();   // tem proposta vendida
  for (const p of props) {
    if (p.vendido) {
      const k = telKey(p?.dados?.telefoneDigitos || p?.dados?.telefone);
      if (k) vendidos.add(k);
    }
  }

  // Agrupa agendamentos por telefone pra avaliar o cliente como um todo
  // (temperatura/perdido/whatsapp em QUALQUER agendamento do cliente resgata).
  const porTel = new Map<string, Agendamento[]>();
  for (const ag of ags) {
    const k = telKey(ag.cliente_telefone) || ('id:' + ag.id);
    if (!porTel.has(k)) porTel.set(k, []);
    porTel.get(k)!.push(ag);
  }

  const resultado = new Map<string, ClienteReagendar[]>();

  for (const [k, lista] of porTel) {
    // Resgates: venda, temperatura, conversa ativa, ou perda → NÃO entra em Reagendar.
    if (vendidos.has(k)) continue;
    if (lista.some(a => a.temperatura)) continue;
    if (lista.some(a => a.status === 'falando_whatsapp')) continue;
    if (lista.some(a => STATUS_PERDIDO.has(a.status))) continue;

    // Já tem agendamento FUTURO (não-perdido)? Então já foi reagendado → não entra.
    const temFuturo = lista.some(a => !STATUS_PERDIDO.has(a.status) && new Date(a.quando).getTime() >= agora);
    if (temFuturo) continue;

    // Precisa reagendar?
    const precisa = lista.some(a =>
      STATUS_REAGENDAR.has(a.status) ||
      (a.status === 'agendado' && !a.temperatura && new Date(a.quando).getTime() < agora)
    );
    if (!precisa) continue;

    // Agendamento mais recente define o consultor dono e os dados de exibição.
    const recente = lista.reduce((m, a) => (new Date(a.quando) > new Date(m.quando) ? a : m), lista[0]);
    const dono = recente.vendedor_nome || '(sem consultor)';
    if (!resultado.has(dono)) resultado.set(dono, []);
    resultado.get(dono)!.push({
      nome: recente.cliente_nome,
      telefone: recente.cliente_telefone,
      cidade: recente.cidade,
      quando: recente.quando,
      status: recente.status,
    });
  }

  return resultado;
}

async function carregarConsultoresWpp(): Promise<Map<string, string>> {
  const { data } = await supabaseGerador.from('consultores').select('nome, whatsapp');
  const map = new Map<string, string>();
  for (const c of (data || []) as { nome: string; whatsapp: string | null }[]) {
    if (c.whatsapp) map.set(c.nome, c.whatsapp);
  }
  return map;
}

function montarMensagem(consultor: string, clientes: ClienteReagendar[]): string {
  const linkCrm = `${CRM_BASE_URL}?crm=reagendar&consultor=${encodeURIComponent(consultor)}`;
  const linhas = clientes.slice(0, 30).map((c, i) => {
    const nome = primeiroNome(c.nome) || c.nome || 'Cliente';
    const cid = c.cidade ? ` · ${c.cidade}` : '';
    return `${i + 1}. *${nome}*${cid}`;
  });
  const extra = clientes.length > 30 ? `\n…e mais ${clientes.length - 30}.` : '';
  return (
    `🔄 *Clientes pra reagendar* — ${primeiroNome(consultor) || consultor}\n\n` +
    `Você tem *${clientes.length}* cliente(s) parados, sem ação na agenda (passou do horário, não atendeu ou ficou sem orçamento). ` +
    `Eles precisam de um novo horário pra não esfriar.\n\n` +
    linhas.join('\n') + extra + `\n\n` +
    `👉 Abra a lista e reagende: ${linkCrm}`
  );
}

/**
 * Roda 1×/dia (17h BRT) via GitHub Actions → GET /cron/reagendar-diario.
 * dry=true: não envia nada, só retorna o que enviaria (pra conferência).
 */
export async function enviarReagendarDiario(opts?: { dry?: boolean }): Promise<{
  consultores: number;
  total_clientes: number;
  enviados: number;
  erros: number;
  preview?: Record<string, ClienteReagendar[]>;
}> {
  const dry = !!opts?.dry;
  const porConsultor = await calcularReagendarPorConsultor();
  const wppMap = dry ? new Map<string, string>() : await carregarConsultoresWpp();

  let total = 0, enviados = 0, erros = 0;
  const preview: Record<string, ClienteReagendar[]> = {};

  for (const [consultor, clientes] of porConsultor) {
    if (!clientes.length) continue;
    total += clientes.length;
    preview[consultor] = clientes;
    if (dry) continue;

    const wpp = wppMap.get(consultor);
    if (!wpp) { logger.error('reagendar', 'consultor sem whatsapp', { consultor }); erros++; continue; }
    try {
      await sendWhatsApp(wpp, montarMensagem(consultor, clientes), ZAPI_INSTANCE);
      enviados++;
    } catch (e) {
      // Best-effort: Z-API pode falhar/banir; não derruba o cron.
      logger.error('reagendar', 'falha ao enviar digest', { consultor, erro: String(e) });
      erros++;
    }
  }

  return {
    consultores: porConsultor.size,
    total_clientes: total,
    enviados,
    erros,
    ...(dry ? { preview } : {}),
  };
}
