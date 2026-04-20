import { Router, Request, Response } from 'express';
import { handleIncomingWhatsApp } from '../services/whatsappAgentService';

const router = Router();

// Webhook Z-API — recebe mensagens do WhatsApp
router.post('/whatsapp', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body;

    // Ignora mensagens enviadas pelo próprio número
    if (body.fromMe === true) { res.sendStatus(200); return; }
    // Ignora grupos
    if (body.isGroup === true) { res.sendStatus(200); return; }

    const phone = body.phone || body.senderPhone;
    const text  = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || body.message
      || body.text;

    if (!phone || !text || typeof text !== 'string') { res.sendStatus(200); return; }

    // Responde ao Z-API imediatamente (evita timeout)
    res.sendStatus(200);

    // Processa em background
    handleIncomingWhatsApp(phone, text).catch(err =>
      console.error('WhatsApp agent error:', err)
    );
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
});

export default router;
