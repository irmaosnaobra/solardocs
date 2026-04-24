import { Router, Request, Response } from 'express';
import { handleIncomingWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';
import { supabase } from '../utils/supabase';

const router = Router();

// Healthcheck — confirma que o endpoint está acessível
router.get('/whatsapp', (_req: Request, res: Response): void => {
  res.json({ status: 'webhook online', ts: new Date().toISOString() });
});

// Webhook Z-API — recebe mensagens do WhatsApp
router.post('/whatsapp', async (req: Request, res: Response): Promise<void> => {
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = { raw: body }; }

  const adData = body.externalAdReply || {};
  const tracking = { ctwa_clid: adData.ctwaClid || null, _route: '/whatsapp' };

  try {
    const { error: dbErr } = await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking } });
    if (dbErr) console.error('[webhook] supabase insert webhook_debug falhou:', dbErr);

    const phone = body.phone || body.senderPhone;
    const text = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || (typeof body.text === 'object' ? body.text?.message || body.text?.conversation : body.text);

    const fromMe  = body.fromMe  === true || body.fromMe  === 'true';
    const isGroup = body.isGroup === true || body.isGroup === 'true';

    if (phone && text && !fromMe && !isGroup) {
      // await mantém a função Vercel viva até o processamento concluir
      await handleIncomingWhatsApp(String(phone), String(text), body.senderName || body.pushname, tracking);
    }
  } catch (err) {
    console.error('Webhook Error:', err);
  }
  if (!res.headersSent) res.status(200).send('ok');
});

// Alias /zapi para redundância
router.post('/zapi', async (req: Request, res: Response): Promise<void> => {
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = { raw: body }; }

  const adData = body.externalAdReply || {};
  const tracking = { ctwa_clid: adData.ctwaClid || null, _route: '/zapi' };

  try {
    const { error: dbErr } = await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking } });
    if (dbErr) console.error('[webhook] supabase insert webhook_debug falhou:', dbErr);

    const phone = body.phone || body.senderPhone;
    const text = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || (typeof body.text === 'object' ? body.text?.message || body.text?.conversation : body.text);

    const fromMe  = body.fromMe  === true || body.fromMe  === 'true';
    const isGroup = body.isGroup === true || body.isGroup === 'true';

    if (phone && text && !fromMe && !isGroup) {
      // await mantém a função Vercel viva até o processamento concluir
      await handleIncomingWhatsApp(String(phone), String(text), body.senderName || body.pushname, tracking);
    }
  } catch (err) {
    console.error('Z-API Error:', err);
  }
  if (!res.headersSent) res.status(200).send('ok');
});

export default router;
