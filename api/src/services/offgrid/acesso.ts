/**
 * OFF-GRID — quem pode ver o dinheiro.
 *
 * O acesso é um ADD-ON vitalício comprado à parte (não é degrau de plano): a
 * ferramenta é o canal que traz pedido de kit, então trancá-la atrás da
 * assinatura afunilaria justamente quem a gente quer dentro. Quem paga o add-on
 * destrava o preço, a proposta e o pedido — assinante ou não.
 *
 * O que é grátis pra qualquer um: dimensionar o sistema e ver a autonomia. É a
 * parte que vende sozinha, e é de propósito que ela fique aberta.
 */

import { supabase } from '../../utils/supabase';
import { acessos, concederAcesso } from '../produtos/acessos';

/** Preço do add-on, em reais. Também usado na tela de oferta. */
export const OFFGRID_ADDON_PRECO = 97;

/** Nome do produto na Kiwify (fallback quando o ID não está no env). */
export const OFFGRID_PRODUTO_REGEX = /(kit\s*off[\s-]*grid|off[\s-]*grid.*(gerador|calculadora|ferramenta))/i;

export interface AcessoOffGrid {
  liberado: boolean;
  /** Quando comprou (null = não tem). */
  desde: string | null;
  /** Admin entra por ser admin, não por ter comprado — muda a mensagem. */
  porAdmin: boolean;
  /** Crédito a abater no primeiro pedido de kit. 0 depois de usado. */
  creditoPedido: number;
}

/**
 * Não faz cache: o webhook pode liberar a qualquer momento e o integrador que
 * acabou de pagar precisa ver o preço ao dar F5, não daqui a cinco minutos.
 */
export async function acessoOffGrid(userId: string | undefined): Promise<AcessoOffGrid> {
  const vazio: AcessoOffGrid = { liberado: false, desde: null, porAdmin: false, creditoPedido: 0 };
  if (!userId) return vazio;

  // Quem decide é a fonte única (entitlements + plano + admin). O crédito do
  // primeiro pedido continua em users porque é específico deste produto.
  const [a, { data }] = await Promise.all([
    acessos(userId),
    supabase.from('users').select('offgrid_desde, offgrid_credito').eq('id', userId).single(),
  ]);

  return {
    liberado: a.produtos.has('offgrid'),
    desde: data?.offgrid_desde ?? null,
    porAdmin: a.isAdmin,
    creditoPedido: a.isAdmin ? 0 : Number(data?.offgrid_credito ?? 0),
  };
}

/**
 * Libera o add-on. Idempotente: comprou duas vezes (ou a Kiwify reentregou o
 * webhook), a data e o crédito continuam os da PRIMEIRA compra — senão uma
 * reentrega renovaria um crédito já usado.
 */
export async function liberarOffGrid(userId: string, credito = OFFGRID_ADDON_PRECO): Promise<boolean> {
  const { data: atual } = await supabase
    .from('users').select('offgrid_desde').eq('id', userId).single();
  if (atual?.offgrid_desde) return false;

  // Grava nos dois lugares: o entitlement é a fonte do gate, e a coluna carrega
  // o crédito do primeiro pedido (que é regra só deste produto).
  await concederAcesso({ userId, produto: 'offgrid', origem: 'compra' });
  const { error } = await supabase
    .from('users')
    .update({ offgrid_desde: new Date().toISOString(), offgrid_credito: credito })
    .eq('id', userId);
  return !error;
}

/** Zera o crédito depois que ele entra num pedido de kit. */
export async function consumirCreditoOffGrid(userId: string): Promise<void> {
  await supabase.from('users').update({ offgrid_credito: 0 }).eq('id', userId);
}
