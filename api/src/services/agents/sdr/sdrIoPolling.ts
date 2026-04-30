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
import { sendToGroup, type ZapiInstance } from '../zapiClient';

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
