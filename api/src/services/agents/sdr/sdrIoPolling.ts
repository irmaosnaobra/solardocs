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

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { handleSdrLead } from './sdrAgentService';

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
