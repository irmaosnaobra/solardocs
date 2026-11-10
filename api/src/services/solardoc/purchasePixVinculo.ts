// Liga o claim do Purchase do Pix (`system_state`, key `meta_purchase_pix:pix_<hash>`) à venda do ledger (`sales`).
//
// Quem cobre o Pix automático e avulso do quiz é o `salesLedger` + `registrarPurchasePixQuizNaVenda` (commit e4936f32): a
// venda nasce com `meta_event_id = pix_<hash>` e o re-drive confere o claim. O que este módulo cobre é o resto: o Pix por
// comprovante e o /pix-liberar, que mandavam Purchase sem linha em `sales`. Aqui o claim, quando fica `enviado`, cria a
// linha (se `criar`) e a marca como enviada, com o id e a hora do claim (ligarVendaAoClaim).
//
// Fica leve de propósito: só supabase, logger e crypto, para o resto do ledger poder carregá-lo sem puxar o quiz.
// O `value` do claim guarda `checkout_session_id`, `pagamento_id`, `contrato`, `user_id` e `e2e_key` (camposDoVinculo),
// campos extras que o `origin/main` ignora ao ler (ele só olha `estado` e `em`).

import { createHash } from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

export const PREFIXO_CLAIM_PURCHASE_PIX = 'meta_purchase_pix:';

/** `pix_` + os 32 primeiros hex do sha256 (UTF-8) da chave inteira do system_state (`pix_e2e:<21>:<valor>`) ou, sem E2E, do dedupKey. */
export const idDoEventoPix = (chave: string): string =>
  'pix_' + createHash('sha256').update(chave, 'utf8').digest('hex').slice(0, 32);

/** O que o claim guarda para a venda ser achada depois. Tudo opcional: o que não existe no caminho não entra. */
export interface VinculoClaim {
  checkoutSessionId?: string | null;
  pagamentoId?: string | null;
  contrato?: string | null;
  userId?: string | null;
}

/** Campos do `value` do claim (sem `estado` e `em`). Só entra o que tem valor. */
export function camposDoVinculo(v: VinculoClaim | null | undefined, e2eKey?: string | null): Record<string, string> {
  const o: Record<string, string> = {};
  const put = (k: string, x: unknown) => { const t = String(x ?? '').trim(); if (t) o[k] = t; };
  put('checkout_session_id', v?.checkoutSessionId);
  put('pagamento_id', v?.pagamentoId);
  put('contrato', v?.contrato);
  put('user_id', v?.userId);
  put('e2e_key', e2eKey);
  return o;
}

export interface ClaimEnviado { eventId: string; em: string }

/**
 * Marca a linha `sales` como enviada ao Meta com o id e a hora do claim. Nunca lança.
 * Não sobrescreve linha que JÁ foi confirmada ao Meta com OUTRO id (meta_response_ok = true, sem motivo de skip): aí o
 * envio duplo já aconteceu e a linha continua contando a verdade; o aviso fica no log. Tentativa que falhou (ok = false,
 * mas `meta_event_id` preenchido pelo ledger) não conta: ela não chegou ao Meta.
 */
export async function ligarVendaAoClaim(checkoutSessionId: string, c: ClaimEnviado): Promise<void> {
  try {
    const { data: atual } = await supabase.from('sales')
      .select('meta_response_ok, meta_event_id, meta_skip_motivo').eq('checkout_session_id', checkoutSessionId).maybeSingle();
    const a = atual as { meta_response_ok?: boolean | null; meta_event_id?: string | null; meta_skip_motivo?: string | null } | null;
    if (a?.meta_response_ok === true && a.meta_event_id && a.meta_event_id !== c.eventId && !a.meta_skip_motivo) {
      logger.warn('purchase-pix-vinculo', `venda ${checkoutSessionId} já foi ao Meta com o id ${a.meta_event_id} e o claim ${c.eventId} também enviou: possível Purchase em dobro`);
      return;
    }
    const { error } = await supabase.from('sales').update({
      meta_event_id: c.eventId, meta_purchase_sent_at: c.em, meta_response_ok: true, meta_skip_motivo: null,
      updated_at: new Date().toISOString(),
    }).eq('checkout_session_id', checkoutSessionId);
    if (error) logger.warn('purchase-pix-vinculo', 'marcar a venda com o claim do Pix falhou', { erro: error.message });
  } catch (err) {
    logger.warn('purchase-pix-vinculo', 'marcar a venda com o claim do Pix falhou', { erro: String(err) });
  }
}
