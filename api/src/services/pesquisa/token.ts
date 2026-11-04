// ─────────────────────────────────────────────────────────────────────────────
// O TOKEN DAS PESQUISAS (04/11/2026). Um HMAC curto de `userId + tipo`, com o MESMO segredo do agentes5040/hmac.ts (hmacDe). O
// userId nunca aparece na URL. Como HMAC é de mão única, o servidor não consegue voltar do token para a pessoa: por isso o envio do
// e-mail grava `pesquisa_tok:<tipo>:<token>` = { user_id } e a rota lê essa chave E confere com tokenPesquisa(user_id, tipo)
// só quando o registro existe, é do mesmo tipo e tem até 60 dias. Token de outro tipo cai em outra chave; token inventado não existe.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { hmacDe } from '../agentes5040/hmac';

export const TIPOS_PESQUISA = ['saida', 'depoimento'] as const;
export type TipoPesquisa = typeof TIPOS_PESQUISA[number];

export const ehTipoPesquisa = (t: unknown): t is TipoPesquisa => (TIPOS_PESQUISA as readonly string[]).includes(String(t));

export const PREFIXO_TOKEN = 'pesquisa_tok:';
export const chaveResposta = (tipo: TipoPesquisa, userId: string): string => `pesquisa_${tipo}:${userId}`;
export const chaveToken = (tipo: TipoPesquisa, token: string): string => `${PREFIXO_TOKEN}${tipo}:${token}`;

/** 32 hex. Sem segredo no ambiente devolve null (quem chama não envia). */
export function tokenPesquisa(userId: string, tipo: TipoPesquisa): string | null {
  if (!userId || !ehTipoPesquisa(tipo)) return null;
  return hmacDe(`pesquisa|${tipo}|${userId}`)?.slice(0, 32) ?? null;
}

export const formatoDeToken = (t: unknown): t is string => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);

/** Grava (ou regrava) a chave que liga o token à pessoa. Erro LANÇA: sem ela o link do e-mail não abre. */
export async function registrarToken(userId: string, tipo: TipoPesquisa): Promise<string> {
  const token = tokenPesquisa(userId, tipo);
  if (!token) throw new Error('sem_segredo_de_hmac');
  const agora = new Date().toISOString();
  const { error } = await supabase.from('system_state').upsert(
    { key: chaveToken(tipo, token), value: { user_id: userId, tipo, em: agora }, updated_at: agora }, { onConflict: 'key' });
  if (error) throw new Error('gravar_token_falhou');
  return token;
}

/** Quanto tempo o link de uma pesquisa vale desde o registro (o `em` da chave). Depois disso: "link não vale". */
export const VALIDADE_TOKEN_MS = 60 * 24 * 3_600_000;

/**
 * O userId dono deste token, ou null (formato torto, chave que não existe, tipo que não bate, registro com mais de 60 dias, leitura que falha).
 * Vale o REGISTRO guardado, não o HMAC recalculado: assim o link do e-mail não morre se o segredo girar.
 */
export async function resolverToken(tipo: unknown, token: unknown, agora: Date = new Date()): Promise<string | null> {
  if (!ehTipoPesquisa(tipo) || !formatoDeToken(token)) return null;
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveToken(tipo, token)).maybeSingle();
    if (error || !data) return null;
    const v = (data as { value?: { user_id?: unknown; tipo?: unknown; em?: unknown } }).value;
    const userId = String(v?.user_id ?? '');
    const em = Date.parse(String(v?.em ?? ''));
    if (!userId || v?.tipo !== tipo || !Number.isFinite(em)) return null;
    if (agora.getTime() - em > VALIDADE_TOKEN_MS || em > agora.getTime() + 60_000) return null;
    return userId;
  } catch {
    return null;
  }
}
