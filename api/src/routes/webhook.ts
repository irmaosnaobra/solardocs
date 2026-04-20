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
    const body = req.body;

    // Ignora mensagens enviadas pelo próprio número
    if (body.fromMe === true) { res.sendStatus(200); return; }
    // Ignora grupos
    if (body.isGroup === true) { res.sendStatus(200); return; }

    const phone      = body.phone || body.senderPhone;
    const senderName = body.senderName || body.pushname || null;
    const text       = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || body.message
      || body.text;

    if (!phone || !text || typeof text !== 'string') { res.sendStatus(200); return; }

    // Responde imediatamente — Z-API não pode esperar
    res.sendStatus(200);

    // Salva debug e processa após responder
    await supabase.from('webhook_debug').insert({ payload: body }).catch(() => {});
    await handleIncomingWhatsApp(phone, text, senderName).catch(err =>
      console.error('WhatsApp agent error:', err)
    );
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
});

export default router;
