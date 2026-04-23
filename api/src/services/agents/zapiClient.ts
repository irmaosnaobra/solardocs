const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID?.trim();
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN?.trim();
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN?.trim();

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

export async function zapiPost(path: string, body: unknown, retries = 2): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) {
    throw new Error('[zapi] credenciais Z-API não configuradas (ZAPI_INSTANCE_ID, ZAPI_TOKEN ou ZAPI_CLIENT_TOKEN ausentes)');
  }
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) return;
      const txt = await res.text().catch(() => res.status.toString());
      lastErr = new Error(`[zapi] HTTP ${res.status} — ${txt}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < retries) await sleep(1000 * (attempt + 1));
  }
  throw lastErr ?? new Error('[zapi] falha desconhecida');
}

export async function showTyping(phone: string, durationMs = 1500): Promise<void> {
  await zapiPost('send-typing', { phone: fmtPhone(phone), duration: durationMs }).catch(() => {});
  await sleep(durationMs);
}

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  await zapiPost('send-text', { phone: fmtPhone(phone), message });
}

export async function sendHuman(phone: string, parts: string[]): Promise<void> {
  for (const part of parts) {
    const typingMs = Math.min(Math.max(part.length * 40, 800), 2500);
    await showTyping(phone, typingMs);
    await sendWhatsApp(phone, part);
    await sleep(300);
  }
}

export async function sendZAPI(phone: string, message: string): Promise<void> {
  await zapiPost('send-text', { phone: fmtPhone(phone), message });
}
