import { Router, Request, Response } from 'express';
import { handleIncomingWhatsApp } from '../services/whatsappAgentService';
import { supabase } from '../utils/supabase';

const router = Router();

// Healthcheck — confirma que o endpoint está acessível
router.get('/whatsapp', (_req: Request, res: Response): void => {
  res.json({ status: 'webhook online', ts: new Date().toISOString() });
});

// Webhook Z-API — recebe mensagens do WhatsApp
router.post('/whatsapp', async (req: Request, res: Response): Promise<void> => {
  try {
    // Parseia body em qualquer formato que vier do Z-API
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = { raw: body }; }
    }
    if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString()); } catch { body = { raw: body.toString() }; }
    }
    body = body ?? {};

    // Loga payload
    await supabase.from('webhook_debug').insert({ payload: body });

    if (body.fromMe === true || body.isGroup === true) { res.sendStatus(200); return; }

    const phone      = body.phone || body.senderPhone;
    const senderName = body.senderName || body.pushname || null;
    const text       = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || (typeof body.message === 'string' ? body.message : null)
      || body.text;

    if (phone && text) {
      // Salva na fila ANTES de responder — garantido no serverless
      await supabase.from('message_queue').insert({
        phone: String(phone), text: String(text), sender_name: senderName
      });
    }
  } catch (err) {
    await supabase.from('webhook_debug').insert({ payload: { error: String(err) } });
  }

  res.status(200).json({ status: 'ok' });
});

export default router;
