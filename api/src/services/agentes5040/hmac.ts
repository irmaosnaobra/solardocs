// ─────────────────────────────────────────────────────────────────────────────
// HMAC DA CHAVE DO CONTATO. Nenhuma chave de system_state, nome de arquivo ou log
// da Fase A leva telefone: leva o HMAC dele.
//
// Segredo, em ordem:
//   1. AGENTES5040_HMAC, se existir;
//   2. senão, sha256('agentes5040-hmac|' + SUPABASE_SERVICE_KEY) (a mesma env de utils/supabase.ts);
//   3. se nenhuma das duas existir, não há chave: hmacDe devolve null e a peça não roda.
// A env é lida a CADA chamada (instância quente não recarrega módulo).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createHmac } from 'crypto';

/** A chave do HMAC, ou null quando não há segredo nenhum. */
export function chaveHmac(): Buffer | null {
  const direta = (process.env.AGENTES5040_HMAC || '').trim();
  if (direta) return Buffer.from(direta, 'utf8');
  const servico = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (servico) return createHash('sha256').update('agentes5040-hmac|' + servico).digest();
  return null;
}

/**
 * Identificador da chave em uso: 8 hex do sha256 da chave (não revela a chave). Quem
 * grava um HMAC grava junto este id, e assim sabe que um HMAC de chave antiga (troca de
 * AGENTES5040_HMAC ou de SUPABASE_SERVICE_KEY) não é comparável. Sem chave, null.
 */
export function idChaveHmac(): string | null {
  const k = chaveHmac();
  return k ? createHash('sha256').update(k).digest('hex').slice(0, 8) : null;
}

/** HMAC-SHA256 em hexadecimal (64 caracteres). Texto vazio ou sem chave devolve null. */
export function hmacDe(texto: string | null | undefined): string | null {
  const t = String(texto ?? '');
  if (!t) return null;
  const k = chaveHmac();
  if (!k) return null;
  return createHmac('sha256', k).update(t, 'utf8').digest('hex');
}
