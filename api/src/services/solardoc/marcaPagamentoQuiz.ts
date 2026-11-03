// ─────────────────────────────────────────────────────────────────────────────
// A MARCA DE QUEM CHEGOU NO PAGAMENTO (03/11/2026). Só grava; NÃO envia nada.
//
// Quando o `POST /payments/pix-recorrente/publico` cria (ou devolve) o contrato de origem `quiz_solardoc` ou `lp_solardoc`, grava
// `quiz_pagto:<hmac do telefone>` no system_state. O hmac é o MESMO do claim `quiz_rec_sent:` (hmacDe(chaveDoTelefone(telefone))), então
// a mensagem de 15 min da Carla e a do pagamento nunca falam duas vezes com a mesma pessoa. Quem lê a marca é a rodada da Carla
// (recuperacaoCarla.ts), 5 min depois, pelo portão de sempre. A marca fica FORA de BOT_SENT_PREFIXES: não é envio.
//
// Telefone cru não vai para a marca (só o hmac na chave). Este módulo não tem envio, timer nem cron.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { hmacDe } from '../agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from './quizSolardoc';
import { PREFIXO_PAGTO } from './recuperacaoCarlaRegras';

export interface EntradaMarcaPagto {
  whatsapp: string | null | undefined;
  contratoId: string;
  origem: string;
  email?: string | null;
  nome?: string | null;
  utm_term?: string | null;
  lp_session?: string | null;
}

/** O hmac da pessoa, ou null (telefone ilegível ou sem segredo de hmac). */
export function hmacDoPagamento(whatsapp: string | null | undefined): string | null {
  const tel = normalizarTelefoneSd(whatsapp);
  if (!tel) return null;
  try { return hmacDe(chaveDoTelefone(tel)); } catch { return null; }
}

const limpa = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Grava `quiz_pagto:<hmac>` = { em, contratoId, origem, email, nome, utm_term, lp_session }. Nunca lança e nunca atrasa a resposta por erro.
 * Marca nova: insere. Já existe da MESMA pessoa: se for o mesmo contrato, fica como está (a hora `em` não anda, senão a espera de 5 min
 * recomeçaria a cada visita); se for outro contrato (a pessoa gerou um Pix novo), troca pelo novo. Devolve true se gravou ou já havia.
 */
export async function gravarMarcaPagamento(e: EntradaMarcaPagto, agora: Date = new Date()): Promise<boolean> {
  try {
    const h = hmacDoPagamento(e.whatsapp);
    if (!h || !e.contratoId) return false;
    const chave = `${PREFIXO_PAGTO}${h}`;
    const em = agora.toISOString();
    const valor = {
      em, contratoId: e.contratoId, origem: e.origem, email: limpa(e.email, 200)?.toLowerCase() ?? null,
      nome: limpa(e.nome, 120), utm_term: limpa(e.utm_term, 200), lp_session: limpa(e.lp_session, 80),
    };
    const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: em });
    if (!error) return true;
    if ((error as { code?: string }).code !== '23505') {
      logger.error('pix-publico', `marca de pagamento não gravou (${String((error as { code?: string }).code ?? 'erro').slice(0, 20)})`);
      return false;
    }
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    const atual = (data as { value?: { contratoId?: string } } | null)?.value;
    if (atual?.contratoId === e.contratoId) return true;
    const { error: eUp } = await supabase.from('system_state').update({ value: valor, updated_at: em }).eq('key', chave);
    if (eUp) { logger.error('pix-publico', 'marca de pagamento não trocou de contrato'); return false; }
    return true;
  } catch (err) {
    logger.error('pix-publico', `marca de pagamento estourou (${String((err as Error)?.message ?? err).slice(0, 60)})`);
    return false;
  }
}
