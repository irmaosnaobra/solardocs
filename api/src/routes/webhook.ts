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
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = { raw: body }; } }
    
    // Captura metadados de anúncio (CAPI)
    const adData = body.externalAdReply || {};
    const tracking = {
      ctwa_clid: adData.ctwaClid || null,
      _route: '/whatsapp'
    };

    await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking } });
    
    const phone = body.phone || body.senderPhone;
    // Extração robusta de texto
    const text = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || (typeof body.text === 'object' ? body.text?.message || body.text?.conversation : body.text);

    // Z-API envia fromMe/isGroup como string "true"/"false", não boolean
    const fromMe  = body.fromMe  === true || body.fromMe  === 'true';
    const isGroup = body.isGroup === true || body.isGroup === 'true';

    if (phone && text && !fromMe && !isGroup) {
      // Processa imediatamente sem bloquear a resposta 200 para a Z-API
      handleIncomingWhatsApp(String(phone), String(text), body.senderName || body.pushname, tracking).catch(console.error);
    }
  } catch (err) {
    console.error('Webhook Error:', err);
  }
  res.status(200).send('ok');
});

// Alias /zapi para redundância
router.post('/zapi', async (req: Request, res: Response): Promise<void> => {
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = { raw: body }; } }

    const adData = body.externalAdReply || {};
    const tracking = {
      ctwa_clid: adData.ctwaClid || null,
      _route: '/zapi'
    };

    await supabase.from('webhook_debug').insert({ payload: { ...body, ...tracking } });

    const phone = body.phone || body.senderPhone;
    const text = body.message?.conversation
      || body.message?.extendedTextMessage?.text
      || (typeof body.text === 'object' ? body.text?.message || body.text?.conversation : body.text);

    const fromMe  = body.fromMe  === true || body.fromMe  === 'true';
    const isGroup = body.isGroup === true || body.isGroup === 'true';

    if (phone && text && !fromMe && !isGroup) {
      handleIncomingWhatsApp(String(phone), String(text), body.senderName || body.pushname, tracking).catch(console.error);
    }
  } catch (err) {
    console.error('Z-API Error:', err);
  }
  res.status(200).send('ok');
});

export default router;
