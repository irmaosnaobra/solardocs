import { emBolhas } from './bolhas';

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

// ─── Desvio de linha (plano B pra quando a B2B cai) ──────────────────────────
// A linha B2B já parou duas vezes levando junto follow-up da Giovanna, curso de
// R$19 e cobrança de Pix — tudo em silêncio. Com `ZAPI_SOLARDOC_VIA_IO=1` TODO
// envio dela passa a sair pela linha IO (34998165040) sem tocar em serviço
// nenhum; tirar a env var volta ao normal.
//
// O que NÃO muda: o inbound. Os pollers leem `ZAPI_*_IO` direto, então a
// resposta do cliente chega na linha IO — onde nenhum agente atende sozinho
// (`handleSdrLead` tem early-return pra 'io'), ou seja, cai pra humano.
// Ligar isto SÓ com a B2B fora: o teto anti-ban da linha passa a ser dividido
// (ver `carlaThrottle`/`lineThrottle`) e o cliente recebe de um número que não
// conhece.
export function solardocViaIo(): boolean {
  return (process.env.ZAPI_SOLARDOC_VIA_IO || '').trim() === '1';
}

/** Linha FÍSICA que vai levar o envio — aplica o desvio quando ligado. */
function linhaFisica(instance: ZapiInstance): ZapiInstance {
  return instance === 'solardoc' && solardocViaIo() ? 'io' : instance;
}

/** Etiqueta de log: mostra o desvio quando ele acontece (`solardoc→io`). */
function tagLinha(instance: ZapiInstance, linha: ZapiInstance): string {
  return instance === linha ? instance : `${instance}→${linha}`;
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
  // Linha física: com o desvio ligado, um envio pedido pra 'solardoc' sai pela IO.
  const linha = linhaFisica(instance);
  const tag = tagLinha(instance, linha);
  const { id, token, client } = getCreds(linha);
  if (!id || !token || !client) {
    throw new Error(`[zapi:${tag}] credenciais Z-API ausentes (verifique ZAPI_INSTANCE_ID${linha === 'io' ? '_IO' : ''}, ZAPI_TOKEN${linha === 'io' ? '_IO' : ''}, ZAPI_CLIENT_TOKEN)`);
  }

  // Circuit-breaker: se esta instância falhou há pouco (instância fora), nem
  // toca a rede — evita o flood de 60 falhas/min por tick de cron. Chaveado pela
  // linha FÍSICA: com o desvio ligado, os dois canais compartilham a mesma.
  const cd = instanceCooldownUntil[linha];
  if (cd && Date.now() < cd) {
    throw new Error(`[zapi:${tag}] em cooldown (instância indisponível há <60s) — pulando envio`);
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
      lastErr = new Error(`[zapi:${tag}] HTTP ${res.status} — ${txt}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    // Erro PERMANENTE (instância não existe): abre o cooldown e para de retentar
    // — retentar "not found" só multiplica o flood. Cobre falha via HTTP (body
    // "Instance not found") E via exceção de rede que contenha a mesma marca.
    if (PERMANENT_ERR.test(lastErr.message)) {
      instanceCooldownUntil[linha] = Date.now() + COOLDOWN_MS;
      throw lastErr;
    }
    if (attempt < retries) await sleep(1000 * (attempt + 1));
  }
  throw lastErr ?? new Error(`[zapi:${tag}] falha desconhecida`);
}

// DELETE /messages?phone=X&messageId=Y&owner=true — usado pra apagar
// um card antigo do grupo antes de mandar versão atualizada.
export async function zapiDelete(
  path: string,
  query: Record<string, string>,
  instance: ZapiInstance = 'solardoc',
): Promise<void> {
  const linha = linhaFisica(instance);
  const { id, token, client } = getCreds(linha);
  if (!id || !token || !client) {
    throw new Error(`[zapi:${tagLinha(instance, linha)}] credenciais Z-API ausentes`);
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

// Envia imagem. `image` = URL pública OU data URI base64 ("data:image/jpeg;base64,...").
// Usado pra ENCAMINHAR o comprovante de Pix do cliente pro WhatsApp do dono.
export async function sendImage(phone: string, image: string, caption = '', instance: ZapiInstance = 'solardoc'): Promise<void> {
  await zapiPost('send-image', { phone: fmtPhone(phone), image, caption }, 2, instance);
}

export async function sendHuman(
  phone: string,
  parts: string[],
  instance: ZapiInstance = 'solardoc',
  opts?: { slow?: boolean; max?: number; maxBolhas?: number },
): Promise<void> {
  // slow=true → simula leitura+digitação ~15s por bolha (B2B Carla, vendedora humana).
  // Default: rápido (até 2.5s) — agentes de suporte/operacional.
  const minMs = opts?.slow ? 8000  : 800;
  const maxMs = opts?.slow ? 15000 : 2500;
  const perChar = opts?.slow ? 80   : 40;
  const gapMs = opts?.slow ? 1200 : 300;

  // Ninguém escreve parágrafo pra outro humano no WhatsApp. Aqui é o ÚLTIMO
  // ponto antes da linha, e o ÚNICO que fatia — vale mesmo quando a IA ignora o
  // prompt ou quando o chamador passa o texto inteiro como uma parte só. As
  // partes viram um texto só (o || é a mesma fronteira) pra que o teto de bolhas
  // conte a MENSAGEM inteira, não cada parte. `emBolhas` nunca trunca: Pix
  // copia-e-cola e URL saem inteiros.
  const bolhas = emBolhas(parts.join('||'), { max: opts?.max, maxBolhas: opts?.maxBolhas });

  for (const part of bolhas) {
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
