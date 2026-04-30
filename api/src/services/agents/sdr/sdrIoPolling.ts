// Polling de leads NOVOS na linha Z-API "Irmaos na Obra" (instance 'io').
//
// Por que existe:
//   Z-API tem um bug confirmado em Multi Device onde NAO dispara webhook
//   on-message-received pra essa instancia, mesmo com receivedCallbackUrl
//   configurado corretamente. Outros endpoints de leitura (chat-messages,
//   messages-by-phone) tambem nao funcionam em Multi Device.
//
// Como funciona:
//   - Consulta GET /chats da Z-API IO (esse endpoint funciona em Multi Device)
//   - Pra cada chat com lastMessageTime nos ultimos N minutos:
//       - Se NAO tem sessao SDR existente → eh um lead NOVO. Assume frase
//         padrao do anuncio Meta ("Tenho interesse em energia solar!") e
//         dispara handleSdrLead. Funciona porque 100% dos leads click-to-WhatsApp
//         do anuncio chegam com essa frase pre-formatada.
//       - Se TEM sessao SDR existente → pula. A continuacao do fluxo (etapa 2+)
//         depende do webhook funcionar. Se webhook continuar falhando, abrir
//         ticket Z-API mencionando que /chat-messages nao funciona em MD.

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { handleSdrLead } from './sdrAgentService';
import { sendToGroup, sendWhatsApp, type ZapiInstance } from '../zapiClient';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FRASE_PADRAO_ANUNCIO = 'Tenho interesse em energia solar!';

export async function pollZapiMessagesIO(): Promise<{ processed: number; skipped: number; errors: number }> {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) return { processed: 0, skipped: 0, errors: 0 };

  // Janela de 5min — bem maior que o ciclo de cron (1min) pra cobrir falhas pontuais
  const cutoff = Date.now() - 5 * 60 * 1000;

  let chats: any[] = [];
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${id}/token/${token}/chats?pageSize=30`,
      { headers: { 'Client-Token': client } },
    );
    if (!res.ok) return { processed: 0, skipped: 0, errors: 0 };
    const data: any = await res.json();
    chats = Array.isArray(data) ? data : (data.value ?? data.chats ?? []);
  } catch (err) {
    logger.error('sdr-io-poll', 'fetch chats falhou', err);
    return { processed: 0, skipped: 0, errors: 1 };
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const chat of chats) {
    if (chat.isGroup === true || chat.isGroup === 'true') continue;
    if (!chat.phone) continue;

    const rawT = chat.lastMessageTime ?? 0;
    const lastTime = typeof rawT === 'number'
      ? (rawT > 1e12 ? rawT : rawT * 1000)
      : Number(rawT) || new Date(rawT).getTime();
    if (!lastTime || lastTime < cutoff) continue;

    const phone = String(chat.phone).replace(/\D/g, '');
    if (!phone) continue;

    // Skip se ja tem sessao SDR (eh lead em andamento, nao novo)
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('updated_at')
      .eq('phone', phone)
      .eq('tipo', 'sdr')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (session) {
      skipped++;
      continue;
    }

    // Lead NOVO — dispara fluxo da Luma com frase padrao do anuncio
    try {
      await handleSdrLead(phone, FRASE_PADRAO_ANUNCIO, chat.name ?? null, undefined, 'io');
      processed++;
    } catch (err) {
      logger.error('sdr-io-poll', `handleSdrLead falhou pra ${phone}`, err);
      errors++;
    }
  }

  return { processed, skipped, errors };
}

// ─── Reativação em massa: leads importados que ainda não foram contactados ──
//
// Lista importada via POST /admin/sdr-leads/import vira leads com
// estagio='reativacao' e lead_origem='reativacao'.
//
// Cron processa em horário comercial (seg-sex 9h-20h, sem feriado), com meta
// de 50 leads/dia. Cron de 1min processa 1-2 leads por execução.
//
// Mensagem inicial é gerada via Claude pra ser personalizada e humanizada.
// Quando o lead RESPONDE, handleSdrLead processa normalmente: a Luma faz a
// qualificação e o estagio sai de 'reativacao' pra 'morno' (ou outro).

const FERIADOS_BR_LUMA: Set<string> = new Set([
  '2026-01-01','2026-02-16','2026-02-17','2026-04-03','2026-04-21',
  '2026-05-01','2026-06-04','2026-09-07','2026-10-12','2026-11-02',
  '2026-11-15','2026-11-20','2026-12-25',
  '2027-01-01','2027-02-08','2027-02-09','2027-03-26','2027-04-21',
  '2027-05-01','2027-05-27','2027-09-07','2027-10-12','2027-11-02',
  '2027-11-15','2027-11-20','2027-12-25',
]);

function emHorarioComercial(): boolean {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dia = brt.getUTCDay();
  if (dia === 0 || dia === 6) return false; // sem domingo/sábado
  const iso = brt.toISOString().slice(0, 10);
  if (FERIADOS_BR_LUMA.has(iso)) return false;
  const hora = brt.getUTCHours();
  return hora >= 9 && hora < 20;
}

async function gerarMsgReativacao(lead: any): Promise<string> {
  const nome = lead.nome ? lead.nome.split(' ')[0] : null;
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system: `Você é a Luma, SDR sênior de energia solar da Irmãos na Obra (sede Uberlândia/MG, 8 anos no setor). Está retomando contato com um lead frio que demonstrou interesse em energia solar tempos atrás. Escreva UMA mensagem inicial humanizada pra reativar.

REGRAS:
- 1-2 frases curtas. WhatsApp.
- 0-1 emoji NO MÁXIMO. Idealmente nenhum.
- Use o primeiro nome se tiver. Se não, evita "tudo bem".
- Tom de retomada respeitosa, não agressiva. Como se você tivesse esquecido de retomar e agora voltou pra resgatar.
- VARIE a abertura — não use sempre "Oi". Pode ser "Olá", "[Nome], voltei aqui", "Aqui é a Luma da Irmãos na Obra".
- NÃO mencione tabela de preços ou cobre nada. Só reabre conversa.
- Termine SEMPRE com uma pergunta curta que provoque resposta natural ("ainda faz sentido?", "bora retomar?", "quer ver as opções?").
- NÃO use frases de manual ("estou à disposição", "qualquer dúvida").
- Saída: APENAS o texto da mensagem, sem aspas.`,
      messages: [{
        role: 'user',
        content: `Nome: ${nome || 'sem nome'} · Cidade: ${lead.cidade || 'não informada'}\n\nGere a mensagem de reativação.`,
      }],
    });
    const txt = (r.content[0] as { text: string }).text.trim();
    return txt.replace(/^["']|["']$/g, '');
  } catch {
    // Fallback estático
    if (nome) return `Olá ${nome}, aqui é a Luma da Irmãos na Obra. Vi seu contato sobre energia solar e voltei pra te chamar — ainda faz sentido a gente conversar?`;
    return `Olá, aqui é a Luma da Irmãos na Obra. Vi seu interesse em energia solar e voltei pra retomar — ainda faz sentido a gente conversar?`;
  }
}

const META_REATIVACAO_DIA = 50;
const REATIVACOES_POR_EXECUCAO = 2;

export async function processarReativacao(): Promise<{ enviados: number; pulado_horario: boolean; meta_atingida: boolean }> {
  if (!emHorarioComercial()) {
    return { enviados: 0, pulado_horario: true, meta_atingida: false };
  }

  // Conta quantos foram reativados hoje (BRT)
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  brt.setUTCHours(0, 0, 0, 0);
  const inicioHojeBR = new Date(brt.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const { count: feitosHoje } = await supabase
    .from('sdr_leads')
    .select('phone', { count: 'exact', head: true })
    .gte('reativacao_enviada_at', inicioHojeBR);

  if ((feitosHoje ?? 0) >= META_REATIVACAO_DIA) {
    return { enviados: 0, pulado_horario: false, meta_atingida: true };
  }

  // Pega próximos da fila
  const restantes = META_REATIVACAO_DIA - (feitosHoje ?? 0);
  const limite = Math.min(REATIVACOES_POR_EXECUCAO, restantes);

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, instance, reativacao_tentativas')
    .eq('estagio', 'reativacao')
    .eq('instance', 'io')
    .is('reativacao_enviada_at', null)
    .order('created_at', { ascending: true })
    .limit(limite);

  if (!leads?.length) return { enviados: 0, pulado_horario: false, meta_atingida: false };

  let enviados = 0;
  for (const lead of leads) {
    try {
      const msg = await gerarMsgReativacao(lead);
      await sendWhatsApp(lead.phone, msg, 'io');

      // Anexa no histórico (cria sessão pra Luma manter contexto quando lead responder)
      const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('messages')
        .eq('phone', lead.phone)
        .eq('tipo', 'sdr')
        .maybeSingle();
      const oldMessages = (session?.messages as any[]) || [];
      await supabase.from('whatsapp_sessions').upsert({
        phone: lead.phone,
        tipo: 'sdr',
        nome: lead.nome,
        messages: [...oldMessages, { role: 'assistant', content: msg }].slice(-80),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'phone,tipo' });

      await supabase.from('sdr_leads').update({
        reativacao_enviada_at: new Date().toISOString(),
        reativacao_tentativas: (lead.reativacao_tentativas ?? 0) + 1,
        ultimo_contato: new Date().toISOString(),
        aguardando_resposta: true,
        ultima_mensagem: msg.slice(0, 300),
        updated_at: new Date().toISOString(),
      }).eq('phone', lead.phone);
      enviados++;
    } catch (err) {
      logger.error('reativacao', `falha pro lead ${lead.phone}`, err);
    }
  }

  return { enviados, pulado_horario: false, meta_atingida: false };
}

// ─── Revisão horária: Luma re-avalia contexto e reposiciona leads no funil ──
//
// Roda no /cron/process-messages a cada minuto, mas processa CADA lead apenas
// 1x por hora (controle via ultima_revisao_luma). Limita a 5 leads por execução
// pra não estourar custo de IA.
//
// REPOSICIONA EM AMBAS DIREÇÕES: pode promover (frio→quente) E rebaixar
// (quente→morno) baseado na evolução real da conversa.
//
// Estados finais protegidos: fechamento e perdido nunca são revisados.
//
// Quando muda: dispara card no grupo "🔄 Luma reposicionou Lead X de A → B + motivo"

const HIERARQUIA_FUNIL = ['frio', 'novo', 'morno', 'quente'] as const;
type EstagioFunil = typeof HIERARQUIA_FUNIL[number];

function direcaoMudanca(de: string, para: string): 'promocao' | 'rebaixamento' | 'lateral' | null {
  const iDe = HIERARQUIA_FUNIL.indexOf(de as EstagioFunil);
  const iPara = HIERARQUIA_FUNIL.indexOf(para as EstagioFunil);
  if (iDe === -1 || iPara === -1) return null;
  if (iPara === iDe) return null;
  if (iPara > iDe) return 'promocao';
  return 'rebaixamento';
}

function nomeEstagio(s: string): string {
  return ({ novo: 'Novo', frio: 'Frio', morno: 'Morno', quente: 'Quente' } as Record<string,string>)[s] || s;
}

interface RevisaoIA {
  estagio_sugerido: EstagioFunil;
  motivo: string;
}

async function avaliarLeadComIA(lead: any, historico: string): Promise<RevisaoIA | null> {
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Você é a Luma, SDR sênior de energia solar da Irmãos na Obra. Avalia o estágio atual de um lead com base no contexto da conversa e SUGERE em qual estágio ele deveria estar:

- "frio": conta de luz < R$200, sem capacidade financeira, recusou explicitamente, só curioso
- "novo": ainda sem nome ou contato inicial sem qualificação
- "morno": qualificou parcialmente — passou alguns dados (nome, consumo, telhado, etc) mas não fechou
- "quente": qualificou COMPLETO + aceitou agendamento (canal + horário definidos)

Saída em JSON puro, sem markdown:
{ "estagio_sugerido": "frio|novo|morno|quente", "motivo": "1 frase curta com a razão" }`,
      messages: [{
        role: 'user',
        content: `Lead: ${lead.nome || 'Sem nome'} · Cidade: ${lead.cidade || '—'}
Estágio atual: ${lead.estagio}
Agendamento: ${lead.canal_atendimento ? `${lead.canal_atendimento} ${lead.horario_atendimento}` : 'nenhum'}

CONVERSA:
${historico}`,
      }],
    });
    const txt = (r.content[0] as { text: string }).text.trim();
    const cleaned = txt.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!HIERARQUIA_FUNIL.includes(parsed.estagio_sugerido)) return null;
    return parsed;
  } catch (err) {
    logger.error('luma-revisao', 'erro avaliando lead', err);
    return null;
  }
}

export async function revisarLeadsLuma(): Promise<{ avaliados: number; promovidos: number }> {
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, estagio, canal_atendimento, horario_atendimento, instance, ultima_revisao_luma')
    .eq('instance', 'io')
    .not('estagio', 'in', '("fechamento","perdido")')
    .or(`ultima_revisao_luma.is.null,ultima_revisao_luma.lt.${umaHoraAtras}`)
    .order('ultima_revisao_luma', { ascending: true, nullsFirst: true })
    .limit(5);

  if (!leads?.length) return { avaliados: 0, promovidos: 0 };

  let avaliados = 0;
  let promovidos = 0;

  for (const lead of leads) {
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('messages')
      .eq('phone', lead.phone)
      .eq('tipo', 'sdr')
      .single();

    const messages = (session?.messages as any[]) || [];
    const historico = messages.slice(-30).map((m: any) =>
      `${m.role === 'user' ? 'Lead' : 'Luma'}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`
    ).join('\n');

    if (!historico) {
      // Sem histórico, só atualiza timestamp pra não ficar revisando vazio
      await supabase.from('sdr_leads').update({
        ultima_revisao_luma: new Date().toISOString(),
      }).eq('phone', lead.phone);
      continue;
    }

    const revisao = await avaliarLeadComIA(lead, historico);
    avaliados++;

    if (!revisao) {
      await supabase.from('sdr_leads').update({
        ultima_revisao_luma: new Date().toISOString(),
      }).eq('phone', lead.phone);
      continue;
    }

    const novoEstagio = revisao.estagio_sugerido;
    const direcao = direcaoMudanca(lead.estagio, novoEstagio);

    if (direcao) {
      await supabase.from('sdr_leads').update({
        estagio: novoEstagio,
        ultima_revisao_luma: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('phone', lead.phone);

      // Avisa no grupo — emoji difere se foi promoção ou rebaixamento
      const seta = direcao === 'promocao' ? '🔺' : '🔻';
      const linkWa = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
      const card = [
        `🔄 *LUMA REPOSICIONOU LEAD*`,
        ``,
        `*${lead.nome || 'Sem nome'}*  →  ${linkWa}`,
        `*${lead.cidade || '—'}*`,
        ``,
        `${seta} ${nomeEstagio(lead.estagio)}  →  *${nomeEstagio(novoEstagio)}*`,
        ``,
        `💡 ${revisao.motivo}`,
      ].join('\n');

      try {
        const inst: ZapiInstance = (lead.instance === 'io' ? 'io' : 'solardoc') as ZapiInstance;
        await sendToGroup(groupId, card, inst);
        promovidos++;
      } catch (err) {
        logger.error('luma-revisao', `falha ao avisar reposicionamento de ${lead.phone}`, err);
      }
    } else {
      // Mantém estágio mas atualiza timestamp
      await supabase.from('sdr_leads').update({
        ultima_revisao_luma: new Date().toISOString(),
      }).eq('phone', lead.phone);
    }
  }

  return { avaliados, promovidos };
}

// Lembrete pré-evento: dispara mensagem de alerta no grupo da equipe.
//  - Ligação/Meet: 2 minutos antes do horário
//  - Vistoria: 20 minutos antes do horário (mais antecedência por logística)
// Roda no /cron/process-messages a cada minuto. Usa janela de 90s pra cobrir
// pequenos atrasos do cron sem disparar 2x (lembrete_enviado_at = dedup).
export async function processarLembretesAgendamento(): Promise<{ enviados: number }> {
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
  const now = Date.now();

  // Pega todos os agendamentos cujo horário tá próximo e o lembrete ainda não foi enviado
  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, canal_atendimento, horario_atendimento, horario_iso, endereco_vistoria, instance')
    .not('horario_iso', 'is', null)
    .is('lembrete_enviado_at', null)
    .in('canal_atendimento', ['ligacao', 'meet', 'vistoria']);

  if (!leads?.length) return { enviados: 0 };

  let enviados = 0;
  for (const lead of leads) {
    if (!lead.horario_iso || !lead.canal_atendimento) continue;
    const eventoMs = new Date(lead.horario_iso).getTime();
    if (isNaN(eventoMs)) continue;

    const isVistoria = lead.canal_atendimento === 'vistoria';
    const antecedenciaMs = isVistoria ? 20 * 60 * 1000 : 2 * 60 * 1000;
    const inicio = eventoMs - antecedenciaMs;
    // Janela de 90s — cobre cron com leve atraso. Não dispara se já passou do evento.
    if (now < inicio || now > inicio + 90 * 1000) continue;
    if (now > eventoMs) continue;

    const linkWa = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
    const minsRestantes = Math.max(1, Math.round((eventoMs - now) / 60000));

    let card = '';
    if (isVistoria) {
      card = [
        `🚨🚨 *ALERTA — VISTORIA EM ${minsRestantes} MIN* 🚨🚨`,
        ``,
        `*Cliente:* ${lead.nome || 'Sem nome'}`,
        `*WhatsApp:* ${linkWa}`,
        `*Cidade:* ${lead.cidade || '—'}`,
        ``,
        `📍 *ENDEREÇO*`,
        `${lead.endereco_vistoria || '⚠️ ENDEREÇO NÃO INFORMADO — verificar com cliente'}`,
        ``,
        `🕐 Horário marcado: *${lead.horario_atendimento}*`,
        `🚗 Saída recomendada: AGORA`,
      ].join('\n');
    } else {
      const emoji = lead.canal_atendimento === 'meet' ? '🎥' : '📞';
      const tipo = lead.canal_atendimento === 'meet' ? 'MEET (vídeo)' : 'LIGAÇÃO';
      card = [
        `⚠️⚠️ *LEMBRETE — ${tipo} EM ${minsRestantes} MIN* ⚠️⚠️`,
        ``,
        `*Cliente:* ${lead.nome || 'Sem nome'}`,
        `${emoji} *Telefone:* ${lead.phone}`,
        `🔗 ${linkWa}`,
        ``,
        `🕐 Horário marcado: *${lead.horario_atendimento}*`,
        `🟢 PREPARAR PRA CONTATO AGORA`,
      ].join('\n');
    }

    try {
      const instance: ZapiInstance = (lead.instance === 'io' ? 'io' : 'solardoc') as ZapiInstance;
      await sendToGroup(groupId, card, instance);
      await supabase.from('sdr_leads').update({
        lembrete_enviado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('phone', lead.phone);
      enviados++;
    } catch (err) {
      logger.error('lembrete-agendamento', `falha pro lead ${lead.phone}`, err);
    }
  }

  return { enviados };
}

// Processa webhook_debug recente procurando mensagens enviadas pelo celular
// (fromMe=true, fromApi=false) na linha IO. Pra cada uma, marca o lead com
// human_takeover=true — Luma vai ficar em silencio nessas conversas.
export async function processIoTakeoverEvents(): Promise<{ takeovers: number }> {
  const ioInstanceId = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  if (!ioInstanceId) return { takeovers: 0 };

  // Janela de 10min — Cron roda 1x/min, com folga pra cobrir lentidao da queue
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: events } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', cutoff)
    .filter('payload->>instanceId', 'eq', ioInstanceId)
    .filter('payload->>fromMe', 'eq', 'true');

  if (!events?.length) return { takeovers: 0 };

  const phonesToTakeover = new Set<string>();
  for (const ev of events) {
    const p: any = ev.payload;
    // fromApi=true → mensagem enviada pela nossa API (Luma) — NAO eh takeover
    if (p.fromApi === true || p.fromApi === 'true') continue;
    if (p.isGroup === true || p.isGroup === 'true') continue;
    const phone = String(p.phone ?? '').replace(/\D/g, '');
    if (!phone) continue;
    phonesToTakeover.add(phone);
  }

  if (!phonesToTakeover.size) return { takeovers: 0 };

  let takeovers = 0;
  for (const phone of phonesToTakeover) {
    // So marca se ainda nao tiver takeover (evita reset de timestamp)
    const { data: lead } = await supabase
      .from('sdr_leads')
      .select('human_takeover')
      .eq('phone', phone)
      .maybeSingle();
    if (lead && !lead.human_takeover) {
      await supabase.from('sdr_leads').update({
        human_takeover: true,
        human_takeover_at: new Date().toISOString(),
        aguardando_resposta: false,
        updated_at: new Date().toISOString(),
      }).eq('phone', phone);
      takeovers++;
    }
  }

  return { takeovers };
}
