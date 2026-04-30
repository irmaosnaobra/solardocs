import { Router, Request, Response } from 'express';

const router = Router();

// Bootstrap key: hardcoded por ser temporario / debug. Remover quando linha IO estiver estavel.
const BOOTSTRAP_KEY = 'ZAPI_IO_2026_BOOTSTRAP';

interface IOCreds { id: string; token: string; client: string; }

function getIOCreds(): IOCreds | { error: string } {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) {
    return { error: `creds ausentes — id:${!!id} token:${!!token} client:${!!client}` };
  }
  return { id, token, client };
}

async function zapiGet(creds: IOCreds, path: string): Promise<any> {
  const url = `https://api.z-api.io/instances/${creds.id}/token/${creds.token}/${path}`;
  const res = await fetch(url, { headers: { 'Client-Token': creds.client } });
  const txt = await res.text();
  try { return { status: res.status, body: JSON.parse(txt) }; }
  catch { return { status: res.status, body: txt }; }
}

async function zapiPut(creds: IOCreds, path: string, body: any): Promise<any> {
  const url = `https://api.z-api.io/instances/${creds.id}/token/${creds.token}/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Client-Token': creds.client },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  try { return { status: res.status, body: JSON.parse(txt) }; }
  catch { return { status: res.status, body: txt }; }
}

// Lista status da instancia IO + webhooks configurados
router.get('/io/status', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }

  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const [status, webhookReceive, webhookSend, webhookConn, webhookDisc] = await Promise.all([
    zapiGet(creds, 'status'),
    zapiGet(creds, 'webhook-by-events/on-message-received'),
    zapiGet(creds, 'webhook-by-events/on-message-send'),
    zapiGet(creds, 'webhook-by-events/on-connect'),
    zapiGet(creds, 'webhook-by-events/on-disconnect'),
  ]);

  res.json({
    instance_id: creds.id,
    status,
    webhooks: {
      on_message_received: webhookReceive,
      on_message_send: webhookSend,
      on_connect: webhookConn,
      on_disconnect: webhookDisc,
    },
  });
});

// Registra webhook on-message-received apontando pro /webhook/io desta API
router.post('/io/setup', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }

  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const apiUrl = process.env.API_URL || 'https://api.solardoc.app';
  const webhookUrl = `${apiUrl}/webhook/io`;

  // PUT update-webhook-received — endpoint legado simples
  const r1 = await zapiPut(creds, 'update-webhook-received', { value: webhookUrl });
  // PUT webhook-by-events com all events false e on-message-received true (modelo novo)
  const r2 = await zapiPut(creds, 'update-every-webhook', {
    value: webhookUrl,
    notifySentByMe: false,
  });

  // Confirma que ficou salvo lendo de volta
  const confirm = await zapiGet(creds, 'webhook-by-events/on-message-received');

  res.json({
    target_webhook: webhookUrl,
    update_webhook_received_response: r1,
    update_every_webhook_response: r2,
    final_state: confirm,
  });
});

// Envia uma mensagem de teste pra confirmar outbound funcionando
router.post('/io/test-send', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }

  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!phone) { res.status(400).json({ error: 'phone query param obrigatorio' }); return; }

  const r = await fetch(`https://api.z-api.io/instances/${creds.id}/token/${creds.token}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': creds.client },
    body: JSON.stringify({ phone, message: 'Teste de outbound da linha Irmaos na Obra (Luma).' }),
  });
  const txt = await r.text();
  res.json({ status: r.status, body: txt });
});

export default router;
