// ── O QUE O NAVEGADOR DO LEAD DEIXOU PARA A API DE CONVERSÕES (29/10/2026) ───
// O Schedule que o servidor manda pelo card SAIU SEM MARCAR nasce horas depois, de
// um tick, sem navegador na frente. Para o Meta ligá-lo ao clique do anúncio, o
// rascunho do quiz (leads_meta.field_data) guarda os dados do navegador numa ÚNICA
// chave: `_capi`. Com o user agent, o evento sai como `website`; sem ele, como
// `system_generated`.
//
// A chave `_capi` é INTERNA: tem IP, navegador e cookies do Meta, e o repositório
// e o /gerador são lugares onde isso não pode aparecer. Regra: todo nome de campo
// que começa com "_" é interno. Quem percorre o field_data inteiro (prompt da
// Duda, coluna extra da tela Leads) ignora esses nomes. Quem lê por nome
// (resumoDoLead, hidratarLead, montarObservacao) nunca encosta nela.

import type { Request } from 'express';
import { cookieMeta, type NavegadorMeta } from '../../utils/metaCapi';

export const CAMPO_CAPI = '_capi';
/** Página do quiz solar: o `event_source_url` de todo evento `website` do servidor. */
export const URL_QUIZ_SOLAR = 'https://solardoc.app/io/solar';
/** Cookie fbc com mais de 7 dias não casa mais com o clique: sai do evento. */
export const FBC_VALE_MS = 7 * 86_400_000;

export interface DadosCapi {
  fbc?: string;
  fbp?: string;
  client_user_agent?: string;
  client_ip_address?: string;
  event_source_url?: string;
  /** ISO de quando foram capturados. */
  ts: string;
}
export type CampoFieldData = { name: string; values: string[] };

/** Nome interno de campo do field_data (começa com "_"). */
export const ehCampoInterno = (nome: unknown): boolean => String(nome ?? '').trim().startsWith('_');

/** O field_data sem os campos internos. Qualquer coisa que não seja lista vira lista vazia. */
export function semCamposInternos<T extends { name?: unknown }>(fd: unknown): T[] {
  return (Array.isArray(fd) ? fd : []).filter((c): c is T => !!c && !ehCampoInterno((c as T).name));
}

/**
 * O campo `_capi` a partir da requisição do quiz. null = nada útil para guardar
 * (sem navegador nenhum). fbc/fbp só passam no formato do Meta (cookieMeta).
 */
export function campoCapiDe(req: Pick<Request, 'ip' | 'headers'>, b: Record<string, unknown>, agoraMs = Date.now()): CampoFieldData | null {
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 1000);
  const dados: DadosCapi = { ts: new Date(agoraMs).toISOString() };
  const fbc = cookieMeta(b.fbc), fbp = cookieMeta(b.fbp);
  if (fbc) dados.fbc = fbc;
  if (fbp) dados.fbp = fbp;
  if (ua) dados.client_user_agent = ua;
  if (req.ip) dados.client_ip_address = String(req.ip);
  if (!dados.client_user_agent && !dados.fbc && !dados.fbp) return null;
  dados.event_source_url = URL_QUIZ_SOLAR;
  return { name: CAMPO_CAPI, values: [JSON.stringify(dados)] };
}

/** Lê o `_capi` do field_data de um lead. null = não tem, ou está ilegível. */
export function lerCapi(fd: unknown): DadosCapi | null {
  const f = (Array.isArray(fd) ? fd : []).find(x => x && (x as { name?: unknown }).name === CAMPO_CAPI) as { values?: unknown[] } | undefined;
  const bruto = f?.values?.[0];
  if (typeof bruto !== 'string') return null;
  try {
    const o = JSON.parse(bruto) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || typeof o.ts !== 'string') return null;
    const txt = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);
    return {
      fbc: cookieMeta(o.fbc) ?? undefined, fbp: cookieMeta(o.fbp) ?? undefined,
      client_user_agent: txt(o.client_user_agent, 1000), client_ip_address: txt(o.client_ip_address, 64),
      event_source_url: txt(o.event_source_url, 300), ts: o.ts,
    };
  } catch { return null; }
}

/** fbc de 7 dias ou mais (contados do clique, que está dentro do próprio cookie: fb.1.<ms>.<valor>) fica de fora. */
export function fbcAindaVale(fbc: string | undefined, agoraMs: number): string | undefined {
  const ms = Number(String(fbc ?? '').split('.')[2]);
  if (!fbc || !Number.isFinite(ms) || ms <= 0) return undefined;
  return agoraMs - ms < FBC_VALE_MS ? fbc : undefined;
}

/** Os dados guardados no formato que o enviarEventoMeta pede. */
export function navegadorDoCapi(c: DadosCapi | null, agoraMs: number): NavegadorMeta {
  if (!c) return {};
  return { fbc: fbcAindaVale(c.fbc, agoraMs) ?? null, fbp: c.fbp ?? null, ip: c.client_ip_address ?? null, userAgent: c.client_user_agent ?? null };
}
