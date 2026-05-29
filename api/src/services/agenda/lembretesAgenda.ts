import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

type Agendamento = {
  id: number;
  vendedor_nome: string;
  quando: string;
  cliente_nome: string;
  cliente_telefone: string;
  observacao: string | null;
  status: string;
  lembrete_3h_at: string | null;
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
  return (nome || '').trim().split(/\s+/)[0] || '';
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

async function disparar5min(ag: Agendamento, vendedorWpp: string | null) {
  const nomeCli = primeiroNome(ag.cliente_nome);
  const hora = formatHora(ag.quando);

  // Vendedor
  if (vendedorWpp) {
    const msgV =
      `📞 *Em 5 minutos:* ligação com *${ag.cliente_nome}* às *${hora}*.\n` +
      `Tel: ${ag.cliente_telefone}` +
      (ag.observacao ? `\n_Obs: ${ag.observacao}_` : '');
    await sendWhatsApp(vendedorWpp, msgV, ZAPI_INSTANCE);
  }

  // Cliente
  const msgC =
    `Olá${nomeCli ? ' ' + nomeCli : ''}! Em ~5 minutos o consultor *${ag.vendedor_nome}* ` +
    `da *Irmãos na Obra* vai te ligar (às ${hora}). Deixa o telefone à mão!`;
  await sendWhatsApp(ag.cliente_telefone, msgC, ZAPI_INSTANCE);

  await supabaseGerador
    .from('agendamentos')
    .update({ lembrete_5min_at: new Date().toISOString() })
    .eq('id', ag.id);
}

async function disparar3h(ag: Agendamento, vendedorWpp: string | null) {
  const nomeCli = primeiroNome(ag.cliente_nome);
  const quandoTxt = formatDataHora(ag.quando);

  if (vendedorWpp) {
    const msgV =
      `🔔 *Em ~3 horas:* ligação com *${ag.cliente_nome}* (${quandoTxt}).\n` +
      `Tel: ${ag.cliente_telefone}` +
      (ag.observacao ? `\n_Obs: ${ag.observacao}_` : '');
    await sendWhatsApp(vendedorWpp, msgV, ZAPI_INSTANCE);
  }

  const msgC =
    `Olá${nomeCli ? ' ' + nomeCli : ''}! Lembrando da sua conversa com o consultor *${ag.vendedor_nome}* ` +
    `da *Irmãos na Obra*, hoje ${quandoTxt}. Te ligamos no horário!`;
  await sendWhatsApp(ag.cliente_telefone, msgC, ZAPI_INSTANCE);

  await supabaseGerador
    .from('agendamentos')
    .update({ lembrete_3h_at: new Date().toISOString() })
    .eq('id', ag.id);
}

/**
 * Roda a cada minuto (chamada do /cron/process-messages).
 * - Lembrete 5min: dispara quando faltam entre 0 e 6 min pra ligação.
 * - Lembrete 3h: dispara quando faltam entre 2h55min e 3h05min, e o agendamento
 *   foi criado com >24h de antecedência.
 * Cada lembrete só dispara uma vez (flags lembrete_*_at).
 */
export async function processarLembretesAgenda(): Promise<{
  enviados_5min: number;
  enviados_3h: number;
  erros: number;
}> {
  const now = new Date();
  const nowMs = now.getTime();

  // Janela ampla: pega tudo de agora até 4h à frente que tenha algum lembrete pendente.
  const limite = new Date(nowMs + 4 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, observacao, status, lembrete_3h_at, lembrete_5min_at, created_at')
    .eq('status', 'agendado')
    .gte('quando', now.toISOString())
    .lte('quando', limite);

  if (error) {
    logger.error('agenda', 'falha ao listar agendamentos', error);
    return { enviados_5min: 0, enviados_3h: 0, erros: 1 };
  }
  if (!rows?.length) return { enviados_5min: 0, enviados_3h: 0, erros: 0 };

  const consultores = await carregarConsultoresMap();
  let env5 = 0;
  let env3 = 0;
  let erros = 0;

  for (const ag of rows as Agendamento[]) {
    const quandoMs = new Date(ag.quando).getTime();
    const minutosAteCall = (quandoMs - nowMs) / 60000;
    const vendedorWpp = consultores.get(ag.vendedor_nome) ?? null;

    // ── 5 min antes ──
    if (!ag.lembrete_5min_at && minutosAteCall <= 6 && minutosAteCall >= -1) {
      try {
        await disparar5min(ag, vendedorWpp);
        env5++;
      } catch (e) {
        logger.error('agenda', 'falha lembrete 5min', { id: ag.id, erro: String(e) });
        erros++;
      }
      continue; // mesmo ciclo: não dispara 3h junto
    }

    // ── 3 h antes (só se o agendamento foi feito com >24h de antecedência) ──
    if (!ag.lembrete_3h_at && minutosAteCall <= 185 && minutosAteCall >= 175) {
      const criadoMs = new Date(ag.created_at).getTime();
      const antecedenciaHoras = (quandoMs - criadoMs) / (1000 * 60 * 60);
      if (antecedenciaHoras < 24) continue;

      try {
        await disparar3h(ag, vendedorWpp);
        env3++;
      } catch (e) {
        logger.error('agenda', 'falha lembrete 3h', { id: ag.id, erro: String(e) });
        erros++;
      }
    }
  }

  return { enviados_5min: env5, enviados_3h: env3, erros };
}
