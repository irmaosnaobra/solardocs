import { Router, Request, Response } from 'express';
import { handleIncomingWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';
import { supabase } from '../utils/supabase';

const router = Router();

// Healthcheck — confirma que o endpoint está acessível
router.get('/whatsapp', (_req: Request, res: Response): void => {
  res.json({ status: 'webhook online', ts: new Date().toISOString() });
});

// Extrai texto de payloads Z-API (formato antigo e novo)
function extractText(body: any): string {
  return body.message?.conversation
    || body.message?.extendedTextMessage?.text
    || (typeof body.text === 'object' ? body.text?.message || body.text?.conversation : body.text)
    || '';
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

export default router;
