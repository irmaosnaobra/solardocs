// A conta é de cliente PAGANTE? Regra única do /publico (marca do Pix e lead da LP) e do Pix na conversa. Sem imports: puro.

/** Plano vencido há até 30 dias ainda é cliente (está renovando); depois disso volta a ser prospect. */
export const CLIENTE_VENCIDO_TOLERANCIA_MS = 30 * 24 * 3600_000;

export type SituacaoDaConta = 'vigente' | 'tolerancia' | 'prospect';

/**
 * Como está o plano da conta. `vigente` = `plano` diferente de `free` E `plano_expira_em` maior que agora (já está liberada). `tolerancia` = a régua do /publico ainda
 * a trata como cliente (plano vencido há até 30 dias, ou plano sem data legível), mas NÃO está vigente: nem "já liberada", nem código novo, o link decide. `prospect` = o resto.
 */
export function situacaoDaConta(u: { plano?: string | null; plano_expira_em?: string | null } | null | undefined, agoraMs: number = Date.now()): SituacaoDaConta {
  if (!u) return 'prospect';
  const plano = String(u.plano ?? '').trim().toLowerCase();
  const expira = Date.parse(String(u.plano_expira_em ?? ''));
  if (plano && plano !== 'free' && Number.isFinite(expira) && expira > agoraMs) return 'vigente';
  return contaEhDeClientePagante(u, agoraMs) ? 'tolerancia' : 'prospect';
}

/** `plano` diferente de `free`, ou `plano_expira_em` maior ou igual a agora menos 30 dias. Conta grátis sem plano vigente é prospect. */
export function contaEhDeClientePagante(u: { plano?: string | null; plano_expira_em?: string | null } | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!u) return false;
  const plano = String(u.plano ?? '').trim().toLowerCase();
  if (plano && plano !== 'free') return true;
  const expira = Date.parse(String(u.plano_expira_em ?? ''));
  return Number.isFinite(expira) && expira >= agoraMs - CLIENTE_VENCIDO_TOLERANCIA_MS;
}
