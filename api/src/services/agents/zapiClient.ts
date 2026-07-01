// Suporte a múltiplas instâncias Z-API.
// 'solardoc' = linha B2B da SolarDoc (Carla + Giovanna)
// 'io'       = linha B2C Irmãos na Obra (humanos + Bia de recuperação LimpaPro)
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

// Circuit-breaker por instância, fail-open e auto-expirável. Quando a instância
// Z-API está fora (ex: "Instance not found" = deletada/cancelada/token errado),
// SEM isto cada tick de cron re-tentava 20 cards × 3 chamadas = ~60 falhas/min
// nos logs, floodando observabilidade e queimando execução — visto desde 30/jun.
// Aqui: a 1ª falha marca um cooldown; chamadas seguintes na mesma janela
// short-circuitam sem tocar a rede. Expira sozinho → quando a instância volta,
// o próximo tick tenta de novo (recuperação automática, sem probe de status que
// poderia dar falso-negativo e barrar envio legítimo).
const COOLDOWN_MS = 60_000;
const instanceCooldownUntil: Record<string, number> = {};
// "Instance not found" é PERMANENTE (não adianta retentar na mesma chamada) —
// além de disparar o cooldown, pula os retries internos.
const PERMANENT_ERR = /Instance not found/i;

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

  // Circuit-breaker: se esta instância falhou há pouco (instância fora), nem
  // toca a rede — evita o flood de 60 falhas/min por tick de cron.
  const cd = instanceCooldownUntil[instance];
  if (cd && Date.now() < cd) {
    throw new Error(`[zapi:${instance}] em cooldown (instância indisponível há <60s) — pulando envio`);
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
    // Erro PERMANENTE (instância não existe): abre o cooldown e para de retentar
    // — retentar "not found" só multiplica o flood. Cobre falha via HTTP (body
    // "Instance not found") E via exceção de rede que contenha a mesma marca.
    if (PERMANENT_ERR.test(lastErr.message)) {
      instanceCooldownUntil[instance] = Date.now() + COOLDOWN_MS;
      throw lastErr;
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

// Envia figurinha (sticker) do WhatsApp. `sticker` é URL pública de imagem
// (a Z-API converte server-side; ideal 512x512 com fundo transparente).
export async function sendSticker(phone: string, stickerUrl: string, instance: ZapiInstance = 'solardoc'): Promise<void> {
  await zapiPost('send-sticker', { phone: fmtPhone(phone), sticker: stickerUrl }, 2, instance);
}

export async function sendHuman(phone: string, parts: string[], instance: ZapiInstance = 'solardoc', opts?: { slow?: boolean }): Promise<void> {
  // slow=true → simula leitura+digitação ~15s por bolha (B2B Carla, vendedora humana).
  // Default: rápido (até 2.5s) — agentes de suporte/operacional.
  const minMs = opts?.slow ? 8000  : 800;
  const maxMs = opts?.slow ? 15000 : 2500;
  const perChar = opts?.slow ? 80   : 40;
  const gapMs = opts?.slow ? 1200 : 300;

  for (const part of parts) {
    const typingMs = Math.min(Math.max(part.length * perChar, minMs), maxMs);
    await showTyping(phone, typingMs, instance);
    await sendWhatsApp(phone, part, instance);
    await sleep(gapMs);
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
