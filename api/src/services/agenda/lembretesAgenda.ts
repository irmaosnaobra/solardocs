import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

type Agendamento = {
  id: number;
  vendedor_nome: string;
  quando: string;
  cliente_nome: string;
  cliente_telefone: string;
  cidade: string | null;
  observacao: string | null;
  status: string;
  created_by: string | null;
  confirmacao_at: string | null;
  lembrete_1h_at: string | null;
  lembrete_5min_at: string | null;
  created_at: string;
};

type Consultor = { nome: string; whatsapp: string | null };

const ZAPI_INSTANCE = 'io' as const;

const BRT_TZ = 'America/Sao_Paulo';

function formatHora(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: BRT_TZ,
  }).formatToParts(new Date(iso));
  const hh = parts.find(p => p.type === 'hour')?.value ?? '00';
  const mm = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hh}h${mm}`;
}

function formatDataHora(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: BRT_TZ,
  }).formatToParts(new Date(iso));
  const dia = parts.find(p => p.type === 'day')?.value ?? '00';
  const mes = parts.find(p => p.type === 'month')?.value ?? '00';
  return `${dia}/${mes} às ${formatHora(iso)}`;
}

function primeiroNome(nome: string): string {
  const n = (nome || '').trim().split(/\s+/)[0] || '';
  return n && n.toLowerCase() !== 'lead' ? n : '';
}

// Telefone só pra EXIBIR no aviso do vendedor: sai sem o 55 (DDD + número),
// do jeito que o consultor digita no grupo. NÃO mexe no número usado pra enviar.
function telExibicao(tel: string): string {
  const d = (tel || '').replace(/\D/g, '');
  // 55 + DDD(2) + 8 ou 9 dígitos → 12 ou 13 dígitos. Só aí tira o prefixo BR.
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d.slice(2);
  return d || (tel || '');
}

function diaSemanaSP(iso: string): string {
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: BRT_TZ })
    .formatToParts(new Date(iso)).find(p => p.type === 'weekday')?.value || '';
  return wd;
}

async function carregarConsultoresMap(): Promise<Map<string, string>> {
  const { data, error } = await supabaseGerador
    .from('consultores')
    .select('nome, whatsapp');
  if (error || !data) return new Map();
  const map = new Map<string, string>();
  for (const c of data as Consultor[]) {
    if (c.whatsapp) map.set(c.nome, c.whatsapp);
  }
  return map;
}

// CLIENTE primeiro, CONSULTOR depois. A flag só é setada DEPOIS de ambos
// enviarem com sucesso — se falhar, o próximo tick do cron tenta de novo.
async function enviarParCliente(
  ag: Agendamento, vendedorWpp: string | null, msgCliente: string, msgVendedor: string,
) {
  await sendWhatsApp(ag.cliente_telefone, msgCliente, ZAPI_INSTANCE);
  if (vendedorWpp) await sendWhatsApp(vendedorWpp, msgVendedor, ZAPI_INSTANCE);
}

// 1) AO MARCAR — mensagem que já vende, cliente vislumbra ter energia solar.
async function dispararConfirmacao(ag: Agendamento, vendedorWpp: string | null) {
  const nomeCli = primeiroNome(ag.cliente_nome);
  const dia = diaSemanaSP(ag.quando);
  const quandoTxt = formatDataHora(ag.quando);

  const msgC =
    `Oi${nomeCli ? ', ' + nomeCli : ''}! Tudo certo? ✅\n\n` +
    `Sua conversa com *${ag.vendedor_nome}*, da *Irmãos na Obra*, está confirmada: *${dia}, ${quandoTxt}*.\n\n` +
    `É uma conversa rápida e sem compromisso — a gente te mostra quanto dá pra economizar saindo da conta da distribuidora de energia e você decide com calma.\n\n` +
    `A ligação chega neste mesmo número. Se precisar remarcar, é só me avisar por aqui. 👍\n\n` +
    `_Irmãos na Obra ☀️_`;

  const msgV =
    `✅ *Novo agendamento!*\n` +
    `Cliente: *${ag.cliente_nome}*\n` +
    `Quando: *${dia}, ${quandoTxt}*\n` +
    `Tel: ${telExibicao(ag.cliente_telefone)}` +
    (ag.cidade ? `\nCidade: ${ag.cidade}` : '') +
    (ag.observacao ? `\n_Obs: ${ag.observacao}_` : '');

  await enviarParCliente(ag, vendedorWpp, msgC, msgV);
  await supabaseGerador.from('agendamentos').update({ confirmacao_at: new Date().toISOString() }).eq('id', ag.id);
}

// 2) 1 HORA ANTES
async function disparar1h(ag: Agendamento, vendedorWpp: string | null) {
  const nomeCli = primeiroNome(ag.cliente_nome);
  const hora = formatHora(ag.quando);

  const msgC =
    `Oi${nomeCli ? ', ' + nomeCli : ''}! ⏰\n\n` +
    `Daqui a *1 hora* (às ${hora}) o *${ag.vendedor_nome}*, da *Irmãos na Obra*, vai te ligar pra falar de energia solar.\n\n` +
    `É rapidinho. Se não der agora, me avisa por aqui que a gente remarca. 👍`;
  const msgV =
    `🔔 *Em 1 hora:* ligação com *${ag.cliente_nome}* às *${hora}*.\n` +
    `Tel: ${telExibicao(ag.cliente_telefone)}` +
    (ag.cidade ? `\nCidade: ${ag.cidade}` : '') +
    (ag.observacao ? `\n_Obs: ${ag.observacao}_` : '');

  await enviarParCliente(ag, vendedorWpp, msgC, msgV);
  await supabaseGerador.from('agendamentos').update({ lembrete_1h_at: new Date().toISOString() }).eq('id', ag.id);
}

// 3) 5 MINUTOS ANTES
async function disparar5min(ag: Agendamento, vendedorWpp: string | null) {
  const nomeCli = primeiroNome(ag.cliente_nome);
  const hora = formatHora(ag.quando);

  const msgC =
    `${nomeCli ? nomeCli + ', é' : 'É'} agora! 📞\n\n` +
    `Em uns 5 minutos o *${ag.vendedor_nome}*, da *Irmãos na Obra*, vai te ligar neste número (às ${hora}).\n\n` +
    `Deixa o telefone à mão. Até já! ☀️`;
  const msgV =
    `📞 *Em 5 minutos:* ligação com *${ag.cliente_nome}* às *${hora}*.\n` +
    `Tel: ${telExibicao(ag.cliente_telefone)}` +
    (ag.cidade ? `\nCidade: ${ag.cidade}` : '') +
    (ag.observacao ? `\n_Obs: ${ag.observacao}_` : '');

  await enviarParCliente(ag, vendedorWpp, msgC, msgV);
  await supabaseGerador.from('agendamentos').update({ lembrete_5min_at: new Date().toISOString() }).eq('id', ag.id);
}

/**
 * Roda a cada minuto (chamada do /cron/process-messages).
 * Três mensagens cron-driven, cada uma com sua flag (só seta no sucesso → retry automático):
 * - Confirmação (ao marcar): assim que confirmacao_at é null, p/ leads do Instagram futuros.
 * - Lembrete 1h: quando faltam 55–65 min.
 * - Lembrete 5min: quando faltam 0–6 min.
 * Cliente e consultor recebem juntos (cliente primeiro).
 */
export async function processarLembretesAgenda(): Promise<{
  confirmacoes: number;
  enviados_1h: number;
  enviados_5min: number;
  erros: number;
}> {
  const now = new Date();
  const nowMs = now.getTime();

  // Pega agendamentos futuros (até 30 dias) que ainda têm alguma das 3 mensagens pendente.
  const limite = new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade, observacao, status, created_by, confirmacao_at, lembrete_1h_at, lembrete_5min_at, created_at')
    .eq('status', 'agendado')
    .gte('quando', now.toISOString())
    .lte('quando', limite);

  if (error) {
    logger.error('agenda', 'falha ao listar agendamentos', error);
    return { confirmacoes: 0, enviados_1h: 0, enviados_5min: 0, erros: 1 };
  }
  if (!rows?.length) return { confirmacoes: 0, enviados_1h: 0, enviados_5min: 0, erros: 0 };

  const consultores = await carregarConsultoresMap();
  let conf = 0, env1 = 0, env5 = 0, erros = 0;

  for (const ag of rows as Agendamento[]) {
    const quandoMs = new Date(ag.quando).getTime();
    const minutosAteCall = (quandoMs - nowMs) / 60000;
    const vendedorWpp = consultores.get(ag.vendedor_nome) ?? null;

    // ── Confirmação ao marcar (só leads do Instagram; agendamento manual não dispara blast) ──
    if (!ag.confirmacao_at && ag.created_by === 'lead-meta') {
      try {
        await dispararConfirmacao(ag, vendedorWpp);
        conf++;
      } catch (e) {
        logger.error('agenda', 'falha confirmação', { id: ag.id, erro: String(e) });
        erros++;
      }
    }

    // ── ~5 min antes ── janela alargada (12min) p/ tolerar atraso do cron de 5min.
    // A flag impede duplo envio, então alargar é seguro.
    if (!ag.lembrete_5min_at && minutosAteCall <= 12 && minutosAteCall >= -3) {
      try {
        await disparar5min(ag, vendedorWpp);
        env5++;
      } catch (e) {
        logger.error('agenda', 'falha lembrete 5min', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue;
    }

    // ── ~1 hora antes ── janela alargada (45–75min) p/ não perder tick.
    if (!ag.lembrete_1h_at && minutosAteCall <= 75 && minutosAteCall >= 45) {
      try {
        await disparar1h(ag, vendedorWpp);
        env1++;
      } catch (e) {
        logger.error('agenda', 'falha lembrete 1h', { id: ag.id, erro: String(e) });
        erros++;
      }
    }
  }

  return { confirmacoes: conf, enviados_1h: env1, enviados_5min: env5, erros };
}
