// ─────────────────────────────────────────────────────────────────────────────
// A PESSOA DO PIX PENDENTE JÁ PAGOU? (17/11/2026). O aviso ao grupo "Pix gerado e não pago" não pode sair para quem pagou por outro meio
// (cartão aos 20 min, outro contrato Pix, plano liberado à mão). Vale em dois momentos: antes do claim (avisoPixPendenteTick) e na hora do envio
// do cartão de pendentes (descarregarPendentes). Erro de leitura NUNCA vira "pagou" nem "não pagou": volta 'erro' e quem chama espera.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { situacaoDaConta } from '../../utils/clientePagante';
import { comprouPorEmail, vendasRecentes, type VendasRecentes } from './compraQuizSolardoc';

export interface ContratoPix { contract_id?: string | null; email?: string | null; user_id?: string | null; status?: string | null; ultimo_pagamento_id?: unknown; ultimo_pagamento_em?: unknown }

/** Contrato que ainda NÃO foi pago: `pendente` e sem nenhum pagamento gravado. */
export const contratoNaoPago = (c: ContratoPix): boolean => c.status === 'pendente' && !c.ultimo_pagamento_id && !c.ultimo_pagamento_em;

/** Contrato que vale como pago: pagamento gravado, ou ativo/inadimplente (já foi cobrado e liberado). */
const contratoPago = (c: ContratoPix): boolean => !!c.ultimo_pagamento_id || !!c.ultimo_pagamento_em || c.status === 'ativo' || c.status === 'inadimplente';

const COLUNAS = 'contract_id, email, user_id, status, ultimo_pagamento_id, ultimo_pagamento_em';

/**
 * A pessoa deste contrato pagou por qualquer meio? Confere: o próprio contrato, venda do ledger com o e-mail, plano pago pelo e-mail,
 * conta vigente pelo user_id e OUTRO contrato Pix pago do mesmo e-mail ou user_id. `vendas` opcional (o tick lê uma vez por rodada).
 */
export async function pessoaDoContratoPagou(c: ContratoPix, agora: number = Date.now(), vendas?: VendasRecentes): Promise<'pagou' | 'nao_pagou' | 'erro'> {
  try {
    if (!contratoNaoPago(c)) return 'pagou';
    const email = String(c.email ?? '').toLowerCase().trim();
    const userId = c.user_id ? String(c.user_id) : '';
    if (email) {
      const v = vendas ?? await vendasRecentes(agora);
      if (await comprouPorEmail(v, email)) return 'pagou';
    }
    if (userId) {
      const { data, error } = await supabase.from('users').select('plano, plano_expira_em').eq('id', userId).limit(1);
      if (error) return 'erro';
      if (((data ?? []) as Array<{ plano?: string | null; plano_expira_em?: string | null }>).some(u => situacaoDaConta(u, agora) === 'vigente')) return 'pagou';
    }
    for (const [coluna, valor] of [['email', email], ['user_id', userId]] as const) {
      if (!valor) continue;
      const { data, error } = await supabase.from('asaas_pix_assinaturas').select(COLUNAS).eq(coluna, valor).limit(50);
      if (error) return 'erro';
      if (((data ?? []) as ContratoPix[]).some(o => o.contract_id !== c.contract_id && contratoPago(o))) return 'pagou';
    }
    return 'nao_pagou';
  } catch {
    return 'erro';
  }
}

/** Confere pelo id do contrato (relê o contrato: o aviso pendente só guarda o id na chave). Leitura que falha = 'erro' (espera); contrato que sumiu = 'nao_pagou'. */
export async function pessoaDoContratoIdPagou(contratoId: string, agora: number = Date.now(), vendas?: VendasRecentes): Promise<'pagou' | 'nao_pagou' | 'erro'> {
  try {
    const { data, error } = await supabase.from('asaas_pix_assinaturas').select(COLUNAS).eq('contract_id', contratoId).maybeSingle();
    if (error) return 'erro';
    if (!data) return 'nao_pagou';
    return await pessoaDoContratoPagou(data as ContratoPix, agora, vendas);
  } catch {
    return 'erro';
  }
}
