import { Router, Request, Response } from 'express';
import { handleIncomingWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';
import { handleSdrLead, tryClaimMessage } from '../services/agents/sdr/sdrAgentService';
import { handleGroupMessage } from '../services/agents/sdr/sdrGroupAgent';
import { supabase } from '../utils/supabase';
import { transcribeAudio, downloadImageAsAnthropicSource } from '../utils/mediaProcessor';

// Z-API webhook payloads costumam trazer messageId|zaapId|id. Pegamos o
// primeiro disponível pra dedup atômico contra redelivery e race com polling.
function extractMessageId(body: any): string | null {
  const id = body.messageId || body.zaapId || body.id || body.message?.id || null;
  return id ? String(id) : null;
}

const router = Router();

// Healthcheck — confirma que o endpoint está acessível
router.get('/whatsapp', (_req: Request, res: Response): void => {
  res.json({ status: 'webhook online', ts: new Date().toISOString() });
});

router.get('/io', (_req: Request, res: Response): void => {
  res.json({ status: 'webhook io online', instance: 'io', ts: new Date().toISOString() });
});

router.get('/io-sent', (_req: Request, res: Response): void => {
  res.json({ status: 'webhook io-sent online', instance: 'io', ts: new Date().toISOString() });
});

// Extrai texto de payloads Z-API (formato antigo e novo)
function extractText(body: any): string {
  return body.message?.conversation
    || body.message?.extendedTextMessage?.text
    || (typeof body.text === 'object' ? body.text?.message || body.text?.conversation : body.text)
    || '';
}

// Detecta mídia no payload Z-API: audio, imagem, video ou documento.
// Z-API usa campos diferentes pra cada tipo (audio.audioUrl, image.imageUrl, etc).
function extractMedia(body: any): { url: string; type: 'audio' | 'image' | 'video' | 'document'; mime: string } | null {
  if (body.audio?.audioUrl) {
    return { url: body.audio.audioUrl, type: 'audio', mime: body.audio.mimeType || 'audio/ogg' };
  }
  if (body.image?.imageUrl) {
    return { url: body.image.imageUrl, type: 'image', mime: body.image.mimeType || 'image/jpeg' };
  }
  if (body.video?.videoUrl) {
    return { url: body.video.videoUrl, type: 'video', mime: body.video.mimeType || 'video/mp4' };
  }
  if (body.document?.documentUrl) {
    return { url: body.document.documentUrl, type: 'document', mime: body.document.mimeType || 'application/pdf' };
  }
  return null;
}

function isFromMe(body: any): boolean {
  return body.fromMe === true || body.fromMe === 'true';
}

function isFromGroup(body: any): boolean {
  return body.isGroup === true || body.isGroup === 'true';
}

// Handler compartilhado: insert sincrono (audit), resposta rápida, processamento async
async function handleWebhook(body: any, route: '/whatsapp' | '/zapi', res: Response): Promise<void> {
  const adData = body.externalAdReply || {};
  const tracking = { ctwa_clid: adData.ctwaClid || null, _route: route };

  // 1. Audit log sincrono — garante que mensagens nunca sejam perdidas mesmo se Vercel matar a função
  try {
    const { error: dbErr } = await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking } });
    if (dbErr) console.error('[webhook] supabase insert webhook_debug falhou:', dbErr);
  } catch (err) {
    console.error('[webhook] insert webhook_debug throw:', err);
  }

  // 2. Responde OK rapidamente — Z-API tem timeout de ~3s e entra em backoff se demorar mais
  if (!res.headersSent) res.status(200).send('ok');

  // 3. Processa em background (fire-and-forget). Claude AI demora 3-4s — não pode bloquear o response.
  //    Em Fluid Compute, a função fica viva até o promise resolver. Se terminar antes, mensagem
  //    fica salva em webhook_debug (passo 1) e pode ser reprocessada via cron ou manual.
  const phone = body.phone || body.senderPhone;
  const text = extractText(body);
  if (phone && text && !isFromMe(body) && !isFromGroup(body)) {
    // Dedup atômico contra redelivery do Z-API
    const messageId = extractMessageId(body);
    if (messageId) {
      const phoneClean = String(phone).replace(/\D/g, '');
      const claimed = await tryClaimMessage(`whk:${messageId}`, phoneClean, 'webhook');
      if (!claimed) {
        console.info(`[webhook${route}] mensagem ${messageId} já processada — pulando`);
        return;
      }
    }
    handleIncomingWhatsApp(String(phone), String(text), body.senderName || body.pushname, tracking)
      .catch(err => console.error('[webhook] handleIncomingWhatsApp falhou:', err));
  }
}

function normalizeBody(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    if (raw.trim() === '') return {};
    try { return JSON.parse(raw); } catch { return { raw }; }
  }
  if (typeof raw === 'object') return raw as Record<string, any>;
  return { raw };
}

// Webhook Z-API — recebe mensagens do WhatsApp
router.post('/whatsapp', async (req: Request, res: Response): Promise<void> => {
  await handleWebhook(normalizeBody(req.body), '/whatsapp', res);
});

// Alias /zapi para redundância
router.post('/zapi', async (req: Request, res: Response): Promise<void> => {
  await handleWebhook(normalizeBody(req.body), '/zapi', res);
});

// Webhook on-message-send da linha Irmaos na Obra. Detecta quando humano
// (Giovanna ou alguem da equipe) responde manualmente pelo celular — fromMe=true
// E fromApi=false. Marca lead como human_takeover pra Luma ficar em silencio.
router.post('/io-sent', async (req: Request, res: Response): Promise<void> => {
  const body = normalizeBody(req.body);

  if (!res.headersSent) res.status(200).send('ok');

  try {
    await supabase.from('webhook_debug').insert({
      payload: { ...body, _route: '/io-sent', instance: 'io' },
    });
  } catch (err) {
    console.error('[webhook:io-sent] webhook_debug insert falhou:', err);
  }

  // Filtros: nos importa apenas mensagens enviadas pelo celular (NAO via API)
  const fromMe = body.fromMe === true || body.fromMe === 'true';
  const fromApi = body.fromApi === true || body.fromApi === 'true';
  if (!fromMe || fromApi) return;
  if (body.isGroup === true || body.isGroup === 'true') return;

  // O phone do destinatario eh quem recebeu a mensagem (lead)
  const phone = String(body.phone || body.senderPhone || '').replace(/\D/g, '');
  if (!phone) return;

  try {
    await supabase.from('sdr_leads').update({
      human_takeover: true,
      human_takeover_at: new Date().toISOString(),
      aguardando_resposta: false,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
  } catch (err) {
    console.error('[webhook:io-sent] update sdr_leads falhou:', err);
  }
});

// Webhook da instância Irmãos na Obra (Luma SDR — energia solar B2C).
// Toda mensagem nessa linha vai DIRETO pra Luma (sem trigger, sem checagem de user da plataforma).
router.post('/io', async (req: Request, res: Response): Promise<void> => {
  const body = normalizeBody(req.body);
  const adData = body.externalAdReply || {};
  const tracking = { ctwa_clid: adData.ctwaClid || null, _route: '/io' as const };

  // Audit log
  try {
    await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking, instance: 'io' } });
  } catch (err) {
    console.error('[webhook:io] insert webhook_debug throw:', err);
  }

  // Resposta rápida (Z-API timeout ~3s)
  if (!res.headersSent) res.status(200).send('ok');

  // ── ROTA GRUPO: mensagem do grupo IO (consultores comandando Luma) ──
  // Aceita só o grupo configurado, ignora outras mensagens de grupo aleatórias.
  // fromApi=true = enviada pela própria API (Luma respondendo a si mesma) → skip pra evitar loop.
  const groupId = process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
  if (isFromGroup(body)) {
    const fromApi = body.fromApi === true || body.fromApi === 'true';
    const isMine = isFromMe(body);
    if (fromApi || isMine) return; // skip auto-resposta + mensagens da própria conta da Luma

    const incomingGroupId = String(body.phone || body.chatId || body.groupId || '');
    // Compara só os dígitos do JID — Z-API alterna entre "120363xxx-group", "120363xxx@g.us", etc.
    const baseId = (s: string) => s.replace(/\D/g, '').slice(0, 20);
    if (!baseId(incomingGroupId) || baseId(incomingGroupId) !== baseId(groupId)) return;

    const text = extractText(body);
    const media = extractMedia(body);
    if (!text && !media) return;

    (async () => {
      try {
        let finalText = String(text || '');
        let imageSource: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null = null;

        if (media) {
          if (media.type === 'audio') {
            const transcription = await transcribeAudio(media.url, media.mime);
            finalText = transcription || finalText;
          } else if (media.type === 'image') {
            imageSource = await downloadImageAsAnthropicSource(media.url, media.mime);
            if (!finalText) finalText = '[imagem anexada]';
          }
        }

        if (!finalText) return;

        await handleGroupMessage({
          groupId: incomingGroupId,
          senderPhone: String(body.participantPhone || body.senderPhone || body.phone || ''),
          senderName: body.senderName || body.pushname || null,
          text: finalText,
          imageSource,
        });
      } catch (err) {
        console.error('[webhook:io] handleGroupMessage falhou:', err);
      }
    })();
    return;
  }

  // ── ROTA LEAD (DM): conversa privada com cliente ──
  if (isFromMe(body)) return;

  const phone = body.phone || body.senderPhone;
  const text = extractText(body);
  const media = extractMedia(body);
  if (!phone) return;
  if (!text && !media) return; // sem texto nem mídia = nada pra processar

  // Dedup atômico — Z-API pode redisparar o mesmo webhook. Se já reivindicado
  // por outro processo (webhook anterior ou polling), retorna sem reprocessar.
  const messageId = extractMessageId(body);
  if (messageId) {
    const phoneClean = String(phone).replace(/\D/g, '');
    const claimed = await tryClaimMessage(`whk:${messageId}`, phoneClean, 'webhook');
    if (!claimed) {
      console.info(`[webhook:io] mensagem ${messageId} já processada — pulando`);
      return;
    }
  }

  // Processa em background — chama Luma direto na linha 'io'.
  // Pra mídia: transcreve áudio (Whisper) ou baixa imagem como base64 (Anthropic vision).
  (async () => {
    try {
      let finalText = String(text || '');
      let imageSource: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null = null;

      if (media) {
        if (media.type === 'audio') {
          const transcription = await transcribeAudio(media.url, media.mime);
          finalText = transcription || finalText || '[áudio recebido — não consegui transcrever, pode digitar?]';
        } else if (media.type === 'image') {
          imageSource = await downloadImageAsAnthropicSource(media.url, media.mime);
          if (!finalText || finalText === '[imagem]') {
            finalText = 'O cliente enviou esta imagem.';
          }
        } else if (media.type === 'video' || media.type === 'document') {
          finalText = (finalText || '') +
            ` [cliente enviou ${media.type} — diga educadamente que você só analisa texto, áudio e imagem; peça pra ele descrever ou tirar uma foto]`;
        }
      }

      if (!finalText) return;
      await handleSdrLead(
        String(phone), finalText,
        body.senderName || body.pushname,
        tracking, 'io', imageSource,
      );
    } catch (err) {
      console.error('[webhook:io] handleSdrLead falhou:', err);
    }
  })();
});

export default router;
