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

// Tenta ativar varios flags que podem destravar webhook em Multi Device
router.post('/io/force-enable', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }
  const c: IOCreds = creds;
  const apiUrl = process.env.API_URL || 'https://api.solardoc.app';
  const url = `${apiUrl}/webhook/io`;

  async function tryPut(path: string, body: any): Promise<any> {
    const r = await fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Client-Token': c.client },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    let parsed: any = t;
    try { parsed = JSON.parse(t); } catch {}
    return { path, status: r.status, body: parsed };
  }

  const results = await Promise.all([
    tryPut('update-webhook-received', { value: url, enabled: true }),
    tryPut('update-webhook-received-delivery', { value: url, enabled: true }),
    tryPut('update-receive-message-call-back', { value: url }),
    tryPut('update-on-message-received', { value: url }),
    tryPut('update-webhook', { value: url, event: 'on-message-received' }),
    tryPut('update-receive-callback-sent-by-me', { value: false }),
    tryPut('update-auto-read-message', { value: false }),
    tryPut('update-webhook-message-status', { value: url }),
  ]);

  const me = await zapiGet(c, 'me');
  res.json({ url, attempts: results, me });
});

// Diagnostico: testa varios paths e metodos pra descobrir quais funcionam em Multi Device
router.get('/io/try-paths/:phone', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }
  const c: IOCreds = creds;
  const phone = req.params.phone;

  async function tryReq(method: string, path: string, body?: any): Promise<any> {
    const url = `https://api.z-api.io/instances/${c.id}/token/${c.token}/${path}`;
    const opts: any = {
      method,
      headers: { 'Client-Token': c.client },
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

// Polling de leads NOVOS na linha IO via /chats (Z-API webhook nao dispara em Multi Device).
// Pra leads SEM sessao SDR existente, dispara handleSdrLead com texto fixo "Tenho interesse
// em energia solar!" (todo lead de anuncio Meta chega com essa frase).
// Pra continuacao do fluxo (etapas 2+), webhook eh o unico caminho — bug Z-API ainda em aberto.
router.post('/io/poll', async (req: Request, res: Response): Promise<void> => {
  // Aceita key via query OU header (pra cron interno usar)
  const isAuthed = req.query.key === BOOTSTRAP_KEY || req.get('x-bootstrap-key') === BOOTSTRAP_KEY;
  if (!isAuthed) { res.status(403).json({ error: 'forbidden' }); return; }

  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }

  const minutesBack = Number(req.query.minutes) || 5;
  const cutoff = Date.now() - minutesBack * 60 * 1000;
  const FRASE_PADRAO_ANUNCIO = 'Tenho interesse em energia solar!';

  const chatsRes = await zapiGet(creds, 'chats?pageSize=30');
  if (chatsRes.status !== 200) { res.json({ error: 'chats fetch failed', detail: chatsRes }); return; }

  const chats: any[] = Array.isArray(chatsRes.body) ? chatsRes.body : (chatsRes.body?.value ?? chatsRes.body?.chats ?? []);

  const { handleSdrLead } = await import('../services/agents/sdr/sdrAgentService');
  const { supabase } = await import('../utils/supabase');

  const processed: any[] = [];
  for (const chat of chats) {
    if (chat.isGroup === true || chat.isGroup === 'true') continue;
    if (!chat.phone) continue;

    const rawT = chat.lastMessageTime ?? 0;
    const lastTime = typeof rawT === 'number' ? (rawT > 1e12 ? rawT : rawT * 1000) : Number(rawT) || new Date(rawT).getTime();
    if (!lastTime || lastTime < cutoff) continue;

    const phone = String(chat.phone).replace(/\D/g, '');
    if (!phone) continue;

    // Skip se ja processamos esse phone (existe sessao SDR pra ele)
    const { data: session } = await supabase.from('whatsapp_sessions')
      .select('updated_at').eq('phone', phone).eq('tipo', 'sdr')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (session) {
      processed.push({ phone, name: chat.name, status: 'has session - waiting webhook for continuation' });
      continue;
    }

    // Lead NOVO sem sessao — assume frase padrao do anuncio Meta
    try {
      await handleSdrLead(phone, FRASE_PADRAO_ANUNCIO, chat.name ?? null, undefined, 'io');
      processed.push({ phone, name: chat.name, status: 'NEW LEAD processed (assumed default text)' });
    } catch (err) {
      processed.push({ phone, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ minutes_back: minutesBack, total_chats: chats.length, processed });
});

// Le webhook config da instancia SolarDocs (referencia funcional)
router.get('/solardoc/me', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const id = process.env.ZAPI_INSTANCE_ID?.trim();
  const token = process.env.ZAPI_TOKEN?.trim();
  const client = process.env.ZAPI_CLIENT_TOKEN?.trim();
  if (!id || !token || !client) { res.status(500).json({ error: 'creds solardoc ausentes' }); return; }
  const r = await fetch(`https://api.z-api.io/instances/${id}/token/${token}/me`, { headers: { 'Client-Token': client } });
  const t = await r.text();
  let parsed: any = t; try { parsed = JSON.parse(t); } catch {}
  res.json({ status: r.status, body: parsed });
});

// Aponta webhook da linha IO pra MESMA URL da linha SolarDoc (pra usar a mesma rota que funciona)
router.post('/io/match-solardoc-webhook', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const sdId = process.env.ZAPI_INSTANCE_ID?.trim();
  const sdToken = process.env.ZAPI_TOKEN?.trim();
  const client = process.env.ZAPI_CLIENT_TOKEN?.trim();
  if (!sdId || !sdToken || !client) { res.status(500).json({ error: 'creds solardoc ausentes' }); return; }

  // Le webhook URL atual da SolarDoc
  const sdMe = await fetch(`https://api.z-api.io/instances/${sdId}/token/${sdToken}/me`, { headers: { 'Client-Token': client } });
  const sdData: any = await sdMe.json();
  const sdWebhook = sdData?.receivedCallbackUrl;
  if (!sdWebhook) { res.status(500).json({ error: 'solardoc webhook nao encontrado', dump: sdData }); return; }

  // Aponta linha IO pro mesmo URL
  const ioCreds = getIOCreds();
  if ('error' in ioCreds) { res.status(500).json({ error: ioCreds.error }); return; }

  const update = await fetch(`https://api.z-api.io/instances/${ioCreds.id}/token/${ioCreds.token}/update-every-webhooks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ioCreds.client },
    body: JSON.stringify({ value: sdWebhook, notifySentByMe: false }),
  });
  const updateBody = await update.text();
  let updateParsed: any = updateBody; try { updateParsed = JSON.parse(updateBody); } catch {}

  const ioMe = await zapiGet(ioCreds, 'me');
  res.json({
    solardoc_webhook: sdWebhook,
    update_response: { status: update.status, body: updateParsed },
    io_me: ioMe,
  });
});

// Ativa notifySentByMe na linha IO pra Z-API disparar webhook em mensagens
// enviadas (incluindo as do celular do humano). webhook_debug captura tudo,
// e cron processa pra detectar takeover.
router.post('/io/enable-sent-by-me', async (req: Request, res: Response): Promise<void> => {
  if (req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  const creds = getIOCreds();
  if ('error' in creds) { res.status(500).json({ error: creds.error }); return; }
  const c: IOCreds = creds;

  // Recoloca todos os webhooks no Worker COM notifySentByMe=true
  const url = 'https://zapi-webhook.aiorosgroup.workers.dev/';
  const r = await fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/update-every-webhooks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Client-Token': c.client },
    body: JSON.stringify({ value: url, notifySentByMe: true }),
  });
  const txt = await r.text();
  let parsed: any = txt; try { parsed = JSON.parse(txt); } catch {}

  const me = await zapiGet(c, 'me');
  res.json({ update: { status: r.status, body: parsed }, me });
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
