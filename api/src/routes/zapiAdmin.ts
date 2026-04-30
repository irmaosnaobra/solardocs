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

// Lista chats recentes da linha IO (pra debug — ver se Z-API recebeu mensagem)
router.get('/io/chats', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const r = await zapiGet(creds, 'chats?pageSize=20');
  res.json(r);
});

// Debug: dump RAW de /chat-messages/{phone} pra entender estrutura da resposta
router.get('/io/chat-messages/:phone', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const r = await zapiGet(creds, `chat-messages/${req.params.phone}?amount=10`);
  res.json(r);
});

// Diagnostico: testa varios paths e metodos pra descobrir quais funcionam em Multi Device
router.get('/io/try-paths/:phone', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }
  const phone = req.params.phone;

  async function tryReq(method: string, path: string, body?: any): Promise<any> {
    const url = `https://api.z-api.io/instances/${creds.id}/token/${creds.token}/${path}`;
    const opts: any = {
      method,
      headers: { 'Client-Token': creds.client },
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const t = await r.text();
    let parsed: any = t;
    try { parsed = JSON.parse(t); } catch {}
    return { method, path, status: r.status, body: parsed };
  }

  const tests = [
    () => tryReq('GET', `chats/${phone}`),
    () => tryReq('GET', `chats/${phone}?withMessages=true`),
    () => tryReq('GET', `chats/${phone}/messages?amount=10`),
    () => tryReq('POST', `messages`, { phone, amount: 10 }),
    () => tryReq('POST', `chat-messages`, { phone, amount: 10 }),
    () => tryReq('POST', `messages-by-phone`, { phone, amount: 10 }),
    () => tryReq('GET', `messages-by-phone/${phone}?amount=10`),
    () => tryReq('GET', `chats/${phone}/last-messages`),
    () => tryReq('GET', `chats/${phone}/messages/multi-device?amount=10`),
    () => tryReq('GET', `messages-multi-device/${phone}?amount=10`),
    () => tryReq('POST', `queue/last-message`, { phone, amount: 10 }),
  ];

  const results: any[] = [];
  for (const t of tests) {
    try { results.push(await t()); } catch (e) { results.push({ error: String(e) }); }
  }

  res.json({ tested: results.map(r => ({
    method: r.method,
    path: r.path,
    status: r.status,
    is_array: Array.isArray(r.body),
    array_length: Array.isArray(r.body) ? r.body.length : null,
    sample: typeof r.body === 'string' ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 400),
  })) });
});

// Faz polling manual: pega chats recentes, busca mensagens individuais via /chat-messages/{phone}
// e dispara handleSdrLead pra mensagem inbound mais recente nao processada
router.post('/io/poll', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const minutesBack = Number(req.query.minutes) || 30;
  const cutoff = Date.now() - minutesBack * 60 * 1000;

  const chatsRes = await zapiGet(creds, 'chats?pageSize=30');
  if (chatsRes.status !== 200) { res.json({ error: 'chats fetch failed', detail: chatsRes }); return; }

  const chats: any[] = Array.isArray(chatsRes.body) ? chatsRes.body : (chatsRes.body?.value ?? chatsRes.body?.chats ?? []);

  const { handleSdrLead } = await import('../services/agents/sdr/sdrAgentService');
  const { supabase } = await import('../utils/supabase');

  const processed: any[] = [];
  for (const chat of chats) {
    if (chat.isGroup) continue;
    if (chat.isGroup === 'true') continue;
    if (!chat.phone) continue;

    const rawT = chat.lastMessageTime ?? 0;
    const lastTime = typeof rawT === 'number' ? (rawT > 1e12 ? rawT : rawT * 1000) : Number(rawT) || new Date(rawT).getTime();
    if (!lastTime || lastTime < cutoff) continue;

    const phone = String(chat.phone).replace(/\D/g, '');
    if (!phone) continue;

    // Busca mensagens recentes desse chat — Z-API retorna mais recente primeiro
    const msgsRes = await zapiGet(creds, `chat-messages/${phone}?amount=10`);
    const msgs: any[] = Array.isArray(msgsRes.body) ? msgsRes.body : [];

    // Pega a mais recente que nao seja fromMe
    const inbound = msgs.find((m: any) => m.fromMe === false || m.fromMe === 'false');
    if (!inbound) { processed.push({ phone, name: chat.name, status: 'no inbound found' }); continue; }

    const rawMsgT = inbound.momment ?? inbound.timestamp ?? inbound.time ?? 0;
    const msgTime = typeof rawMsgT === 'number' ? (rawMsgT > 1e12 ? rawMsgT : rawMsgT * 1000) : Number(rawMsgT) || new Date(rawMsgT).getTime();
    if (msgTime && msgTime < cutoff) { processed.push({ phone, status: 'inbound too old' }); continue; }

    // Skip se ja processamos
    const { data: session } = await supabase.from('whatsapp_sessions')
      .select('updated_at').eq('phone', phone).eq('tipo', 'sdr')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (session && new Date(session.updated_at).getTime() >= (msgTime || 0)) {
      processed.push({ phone, status: 'already processed' });
      continue;
    }

    const text = inbound.text?.message ?? inbound.body ?? inbound.text ?? inbound.message?.conversation ?? '';
    if (!text) { processed.push({ phone, status: 'no text', dump: inbound }); continue; }

    try {
      await handleSdrLead(phone, String(text), chat.name ?? inbound.senderName ?? null, undefined, 'io');
      processed.push({ phone, name: chat.name, text: String(text).slice(0, 80), status: 'processed' });
    } catch (err) {
      processed.push({ phone, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ minutes_back: minutesBack, total_chats: chats.length, processed });
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
