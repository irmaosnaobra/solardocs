// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): o LINK DE INDICAÇÃO do cliente e a ligação "esta obra veio da indicação de".
//
// O link é `https://solardoc.app/io/indicacao?i=<card>-<10 caracteres>`: os 10 caracteres são o base64url do
// HMAC-SHA256(segredo, 'indica|' + card). Não grava nada no banco para existir, não dá para adivinhar e mostra só o id do card.
//
// A ligação `jornada_indicacao:<card novo>` é gravada só por INSERT (no 23505 fica a primeira) e assinada; linha sem assinatura válida não conta.
// Serviço: não importa rota, não envia nada, não loga dado pessoal.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { segredoDoVinculo } from './vendaSolarHub';

export const PREFIXO_INDICACAO = 'jornada_indicacao:';
export const chaveIndicacao = (novo: number): string => `${PREFIXO_INDICACAO}${novo}`;
const RE_TOKEN = /^(\d{1,9})-([A-Za-z0-9_-]{10})$/;

const hmacDoCard = (card: number): string | null => {
  const segredo = segredoDoVinculo();
  return segredo ? crypto.createHmac('sha256', segredo).update(`indica|${card}`).digest('base64url').slice(0, 10) : null;
};

/** `<card>-<10 caracteres>`, ou null sem segredo. */
export function tokenIndicacao(card: number): string | null {
  if (!Number.isInteger(card) || card <= 0 || card > 999_999_999) return null;
  const h = hmacDoCard(card);
  return h ? `${card}-${h}` : null;
}

/** O card do token, SE o HMAC confere (timingSafeEqual); senão null. */
export function cardDoToken(token: unknown): number | null {
  const m = typeof token === 'string' ? RE_TOKEN.exec(token) : null;
  if (!m) return null;
  const card = Number(m[1]);
  const esperado = hmacDoCard(card);
  if (!esperado || !Number.isInteger(card) || card <= 0) return null;
  const a = Buffer.from(m[2], 'utf8'); const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? card : null;
}

/** O link público do cliente, sem barra no fim (o servidor tira a barra, e o asset da página é absoluto). Sem segredo: null. */
export function linkIndicacao(card: number): string | null {
  const t = tokenIndicacao(card);
  if (!t) return null;
  const base = (process.env.SITE_URL_SOLARDOC || 'https://solardoc.app').trim().replace(/\/+$/, '');
  return `${base}/io/indicacao?i=${t}`;
}

// ── A ligação assinada ───────────────────────────────────────────────────────────────────────────────────────────────

export interface IndicacaoLigada { v: 1; card: number; indicador: number; em: string }
const dataIso = (v: unknown): string | null =>
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v) ? v : null);
const inteiroPos = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 999_999_999 ? v : null);

/** O normalizado (chaves em ordem fixa), ou null quando não vale. */
export function normalizarIndicacao(value: unknown, novo?: number): IndicacaoLigada | null {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!o || o.v !== 1) return null;
  const card = inteiroPos(o.card); const indicador = inteiroPos(o.indicador); const em = dataIso(o.em);
  if (!card || !indicador || !em || indicador === card || (novo !== undefined && card !== novo)) return null;
  return { v: 1, card, indicador, em };
}

/** HMAC de `indicacao|card|JSON`, ou null sem segredo ou sem formato válido. */
export function assinarIndicacao(novo: number, n: IndicacaoLigada): string | null {
  const segredo = segredoDoVinculo();
  const norm = normalizarIndicacao(n, novo);
  return segredo && norm ? crypto.createHmac('sha256', segredo).update(`indicacao|${novo}|${JSON.stringify(norm)}`).digest('hex') : null;
}

export function indicacaoAssinada(novo: number, value: unknown): IndicacaoLigada | null {
  const n = normalizarIndicacao(value, novo);
  const esperada = n ? assinarIndicacao(novo, n) : null;
  const sig = value && typeof value === 'object' ? (value as { sig?: unknown }).sig : null;
  return n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8')) ? n : null;
}

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

/** Grava SÓ por INSERT. No 23505 fica a primeira (`ja_tinha`). */
export async function gravarIndicacao(novo: number, indicador: number): Promise<'gravou' | 'ja_tinha' | 'erro'> {
  const n = normalizarIndicacao({ v: 1, card: novo, indicador, em: new Date().toISOString() }, novo);
  const sig = n ? assinarIndicacao(novo, n) : null;
  if (!n || !sig) return 'erro';
  try {
    const { error } = await supabase.from('system_state').insert({ key: chaveIndicacao(novo), value: { ...n, sig }, updated_at: n.em });
    if (!error) return 'gravou';
    return codigoDe(error) === '23505' ? 'ja_tinha' : 'erro';
  } catch { return 'erro'; }
}

/** A ligação deste card novo, ou null (sem linha, ou sem assinatura válida). Erro de leitura sobe. */
export async function lerIndicacaoDoCard(novo: number): Promise<IndicacaoLigada | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveIndicacao(novo)).maybeSingle();
  if (error) throw new Error('indicacao_leitura');
  const l = data as { value?: unknown } | null;
  return l ? indicacaoAssinada(novo, l.value) : null;
}

/** Todas as ligações válidas (card novo -> indicador e instante). Páginas de 1000; o `startsWith` descarta o excesso do LIKE. */
export async function lerTodasIndicacoes(): Promise<Map<number, { indicador: number; em: string }>> {
  const mapa = new Map<number, { indicador: number; em: string }>();
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${PREFIXO_INDICACAO}%`).order('key', { ascending: true }).range(de, de + 999);
    if (error) throw new Error('indicacao_leitura');
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const k = String(l.key);
      if (!k.startsWith(PREFIXO_INDICACAO)) continue;
      const id = Number(k.slice(PREFIXO_INDICACAO.length));
      if (!Number.isInteger(id) || id <= 0) continue;
      const n = indicacaoAssinada(id, l.value);
      if (n) mapa.set(id, { indicador: n.indicador, em: n.em });
    }
    if (lote.length < 1000) break;
  }
  return mapa;
}
