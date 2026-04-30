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

// Lista status da instancia IO + webhooks configurados (via /me que tem todos os callback URLs)
router.get('/io/status', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }

  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const [status, me] = await Promise.all([
    zapiGet(creds, 'status'),
    zapiGet(creds, 'me'),
  ]);

  res.json({
    instance_id: creds.id,
    status,
    me,
  });
});

// Registra webhook on-message-received apontando pro /webhook/io desta API
router.post('/io/setup', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }

  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const apiUrl = process.env.API_URL || 'https://api.solardoc.app';
  const webhookUrl = `${apiUrl}/webhook/io`;

  // Lê estado antes
  const before = await zapiGet(creds, 'me');

  // Tenta TODOS os endpoints conhecidos de update de webhook on-message-received
  // (Z-API mudou path em algumas versoes — testamos mais de um)
  const attempts: Array<{ path: string; body: any; method: 'PUT' | 'POST' }> = [
    { path: 'update-webhook-received', body: { value: webhookUrl }, method: 'PUT' },
    { path: 'update-webhook-received-delivery', body: { value: webhookUrl }, method: 'PUT' },
    { path: 'update-every-webhooks', body: { value: webhookUrl, notifySentByMe: false }, method: 'PUT' },
    { path: 'update-every-webhook', body: { value: webhookUrl, notifySentByMe: false }, method: 'PUT' },
    { path: 'webhooks', body: { receivedCallbackUrl: webhookUrl }, method: 'PUT' },
  ];

  const results: any[] = [];
  for (const a of attempts) {
    const fn = a.method === 'PUT' ? zapiPut : (c: IOCreds, p: string, b: any) =>
      fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': c.client },
        body: JSON.stringify(b),
      }).then(async r => ({ status: r.status, body: await r.text().then(t => { try { return JSON.parse(t); } catch { return t; } }) }));
    const r = await fn(creds, a.path, a.body);
    results.push({ method: a.method, path: a.path, response: r });
  }

  // Le estado depois pra confirmar qual chamada persistiu
  const after = await zapiGet(creds, 'me');

  res.json({
    target_webhook: webhookUrl,
    before_me: before,
    attempts: results,
    after_me: after,
  });
});

// Reinicia a instancia (sem perder QR / conexao)
router.post('/io/restart', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const r = await zapiGet(creds, 'restart');
  res.json({ restart: r });
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
