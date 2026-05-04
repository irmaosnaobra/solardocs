// Suporte a múltiplas instâncias Z-API.
// 'solardoc' = linha B2B da SolarDoc (Carla + Dani)
// 'io'       = linha B2C Irmãos na Obra (Luma — energia solar cliente final)
export type ZapiInstance = 'solardoc' | 'io';

interface ZapiCreds {
  id?: string;
  token?: string;
  client?: string;
}

function getCreds(instance: ZapiInstance): ZapiCreds {
  if (instance === 'io') {
    return {
      id: process.env.ZAPI_INSTANCE_ID_IO?.trim(),
      token: process.env.ZAPI_TOKEN_IO?.trim(),
      // Client-Token na Z-API é por CONTA (não por instância) — se IO for da mesma conta, usa o mesmo
      client: (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim(),
    };
  }
  return {
    id: process.env.ZAPI_INSTANCE_ID?.trim(),
    token: process.env.ZAPI_TOKEN?.trim(),
    client: process.env.ZAPI_CLIENT_TOKEN?.trim(),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

export async function zapiPost(
  path: string,
  body: unknown,
  retries = 2,
  instance: ZapiInstance = 'solardoc',
): Promise<any> {
  const { id, token, client } = getCreds(instance);
  if (!id || !token || !client) {
    throw new Error(`[zapi:${instance}] credenciais Z-API ausentes (verifique ZAPI_INSTANCE_ID${instance === 'io' ? '_IO' : ''}, ZAPI_TOKEN${instance === 'io' ? '_IO' : ''}, ZAPI_CLIENT_TOKEN)`);
  }
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://api.z-api.io/instances/${id}/token/${token}/${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': client },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) {
        const txt = await res.text().catch(() => '');
        if (!txt) return null;
        try { return JSON.parse(txt); } catch { return txt; }
      }
      const txt = await res.text().catch(() => res.status.toString());
      lastErr = new Error(`[zapi:${instance}] HTTP ${res.status} — ${txt}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < retries) await sleep(1000 * (attempt + 1));
  }
  throw lastErr ?? new Error(`[zapi:${instance}] falha desconhecida`);
}

// DELETE /messages?phone=X&messageId=Y&owner=true — usado pra apagar
// um card antigo do grupo antes de mandar versão atualizada.
export async function zapiDelete(
  path: string,
  query: Record<string, string>,
  instance: ZapiInstance = 'solardoc',
): Promise<void> {
  const { id, token, client } = getCreds(instance);
  if (!id || !token || !client) {
    throw new Error(`[zapi:${instance}] credenciais Z-API ausentes`);
  }
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(
    `https://api.z-api.io/instances/${id}/token/${token}/${path}?${qs}`,
    { method: 'DELETE', headers: { 'Client-Token': client } },
  );
  if (!res.ok && res.status !== 204) {
    const txt = await res.text().catch(() => res.status.toString());
    throw new Error(`[zapi:${instance}] DELETE ${path} HTTP ${res.status} — ${txt}`);
  }
}

export async function showTyping(phone: string, durationMs = 1500, instance: ZapiInstance = 'solardoc'): Promise<void> {
  await zapiPost('send-typing', { phone: fmtPhone(phone), duration: durationMs }, 2, instance).catch(() => {});
  await sleep(durationMs);
}

export async function sendWhatsApp(phone: string, message: string, instance: ZapiInstance = 'solardoc'): Promise<void> {
  await zapiPost('send-text', { phone: fmtPhone(phone), message }, 2, instance);
}

export async function sendHuman(phone: string, parts: string[], instance: ZapiInstance = 'solardoc'): Promise<void> {
  for (const part of parts) {
    const typingMs = Math.min(Math.max(part.length * 40, 800), 2500);
    await showTyping(phone, typingMs, instance);
    await sendWhatsApp(phone, part, instance);
    await sleep(300);
  }
}

export async function sendZAPI(phone: string, message: string, instance: ZapiInstance = 'solardoc'): Promise<void> {
  await zapiPost('send-text', { phone: fmtPhone(phone), message }, 2, instance);
}

// Envia mensagem pra grupo Z-API. NÃO formata phone (já é ID de grupo no
// formato "120363xxx-group" ou similar). A linha precisa ser membro do grupo.
// Retorna messageId pra permitir delete posterior (usado em cards atualizáveis).
export async function sendToGroup(groupId: string, message: string, instance: ZapiInstance = 'solardoc'): Promise<{ messageId: string | null }> {
  const r = await zapiPost('send-text', { phone: groupId, message }, 2, instance);
  const messageId = r && typeof r === 'object'
    ? (r.messageId || r.zaapId || r.id || null)
    : null;
  return { messageId: messageId ? String(messageId) : null };
}

// Apaga uma mensagem que NÓS enviamos pro grupo (ou pra um contato).
// Usar antes de re-enviar um card atualizado pra evitar bagunça no grupo.
export async function deleteGroupMessage(
  groupId: string,
  messageId: string,
  instance: ZapiInstance = 'solardoc',
): Promise<void> {
  await zapiDelete('messages', {
    phone: groupId,
    messageId,
    owner: 'true',
  }, instance);
}
