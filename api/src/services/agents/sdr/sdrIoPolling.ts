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
