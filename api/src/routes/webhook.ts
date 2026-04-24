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

// Processa mensagem em background — não bloqueia a resposta pra Z-API.
// Z-API tem timeout ~3s; Claude AI demora mais que isso. Precisa ser assíncrono.
async function processInBackground(body: any, tracking: { ctwa_clid: string | null; _route: string }) {
  try {
    const { error: dbErr } = await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking } });
    if (dbErr) console.error('[webhook] supabase insert webhook_debug falhou:', dbErr);

    const phone = body.phone || body.senderPhone;
    const text = extractText(body);

    if (phone && text && !isFromMe(body) && !isFromGroup(body)) {
      await handleIncomingWhatsApp(String(phone), String(text), body.senderName || body.pushname, tracking);
    }
  } catch (err) {
    console.error('[webhook] processInBackground falhou:', err);
  }
}

// Webhook Z-API — recebe mensagens do WhatsApp
router.post('/whatsapp', (req: Request, res: Response): void => {
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = { raw: body }; }

  const adData = body.externalAdReply || {};
  const tracking = { ctwa_clid: adData.ctwaClid || null, _route: '/whatsapp' };

  // Responde imediatamente — Z-API tem timeout de ~3s e entra em backoff se demorar
  res.status(200).send('ok');

  // Processa de forma assíncrona (Fluid Compute mantém a função viva até o promise resolver)
  processInBackground(body, tracking);
});

// Alias /zapi para redundância
router.post('/zapi', (req: Request, res: Response): void => {
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = { raw: body }; }

  const adData = body.externalAdReply || {};
  const tracking = { ctwa_clid: adData.ctwaClid || null, _route: '/zapi' };

  res.status(200).send('ok');
  processInBackground(body, tracking);
});

export default router;
