/**
 * ACESSOS — a única função que responde "esta pessoa pode usar isto?".
 *
 * Regra dura: TODO gate chama `acessos()`. Enquanto cada controller tinha a sua
 * checagem inline (um olhava `plano`, outro `offgrid_desde`, o curso olhava
 * `kit_pedidos`), o número de estados crescia junto com o catálogo — e o
 * desfecho previsível é o cliente que pagou e não consegue usar o que comprou.
 *
 * Três origens compõem o acesso:
 *   1. entitlements — compra avulsa, cortesia, liberação manual. Persistido.
 *   2. assinatura   — DERIVADO de users.plano na hora da leitura. Some sozinho
 *                     quando o cara cancela, sem depender de ninguém lembrar
 *                     de apagar linha.
 *   3. admin        — vê tudo.
 */

import { supabase } from '../../utils/supabase';
import { PRODUTOS, produtosDaAssinatura } from './catalogo';

/**
 * Ferramentas que JÁ FORAM GRÁTIS. Se a tabela de entitlements ainda não existe
 * (código no ar antes da migration), elas voltam a ser liberadas pra todo mundo
 * em vez de sumir da mão de quem trabalha com elas. É rede de segurança de
 * deploy: o pior erro possível aqui é tirar ferramenta de usuário ativo por
 * causa de uma migration que ficou pra trás.
 */
const EX_GRATUITAS = ['precificacao', 'inventario'];

export interface Acessos {
  /** ids de produto liberados. */
  produtos: Set<string>;
  plano: string;
  assinante: boolean;
  isAdmin: boolean;
  /** De onde veio cada acesso — a tela usa pra dizer "incluso no seu plano". */
  origem: Record<string, 'compra' | 'cortesia' | 'admin' | 'assinatura'>;
}

const VAZIO: Acessos = {
  produtos: new Set(), plano: 'free', assinante: false, isAdmin: false, origem: {},
};

export async function acessos(userId: string | undefined): Promise<Acessos> {
  if (!userId) return { ...VAZIO, produtos: new Set(), origem: {} };

  const [{ data: user }, entRes] = await Promise.all([
    supabase.from('users').select('plano, is_admin, plano_expira_em').eq('id', userId).single(),
    supabase.from('entitlements').select('produto, origem, expira_em').eq('user_id', userId),
  ]);
  const ents = entRes.data;
  // Erro aqui é quase sempre "relation does not exist" — migration não aplicada.
  const semTabela = !!entRes.error;
  if (semTabela) {
    console.error('[acessos] entitlements indisponível, liberando as ex-gratuitas:', entRes.error?.message);
  }

  if (!user) return { ...VAZIO, produtos: new Set(), origem: {} };

  const plano = String(user.plano || 'free');
  const isAdmin = !!user.is_admin;
  // Assinatura com data de expiração (a entrada de 30 dias usa isso) só vale
  // enquanto não venceu.
  const expira = user.plano_expira_em ? new Date(user.plano_expira_em).getTime() : null;
  const assinante = plano !== 'free' && (expira === null || expira > Date.now());

  const produtos = new Set<string>();
  const origem: Acessos['origem'] = {};

  if (isAdmin) {
    for (const p of PRODUTOS) { produtos.add(p.id); origem[p.id] = 'admin'; }
    return { produtos, plano, assinante, isAdmin, origem };
  }

  for (const e of ents || []) {
    const venceu = e.expira_em && new Date(e.expira_em).getTime() < Date.now();
    if (venceu) continue;
    produtos.add(e.produto);
    origem[e.produto] = e.origem as 'compra' | 'cortesia' | 'admin';
  }

  if (semTabela) {
    for (const id of EX_GRATUITAS) {
      if (!produtos.has(id)) origem[id] = 'cortesia';
      produtos.add(id);
    }
  }

  if (assinante) {
    for (const id of produtosDaAssinatura()) {
      if (!produtos.has(id)) origem[id] = 'assinatura';
      produtos.add(id);
    }
  }

  // O curso Kit Fecha Vendas continua com a fonte que ele já tinha (kit_pedidos):
  // é lá que a isca de R$27 e a concessão por assinatura gravam, e é de lá que o
  // funil do admin lê. Duplicar em entitlements criaria duas verdades pro mesmo
  // acesso — então aqui a gente lê a verdade existente em vez de reescrevê-la.
  if (!produtos.has('curso-fechamento')) {
    const { data: pedido } = await supabase
      .from('kit_pedidos')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'paid')
      .limit(1)
      .maybeSingle();
    if (pedido) { produtos.add('curso-fechamento'); origem['curso-fechamento'] = 'compra'; }
  }

  return { produtos, plano, assinante, isAdmin, origem };
}

/** Atalho pra gate de um produto só. */
export async function temAcesso(userId: string | undefined, produtoId: string): Promise<boolean> {
  const a = await acessos(userId);
  return a.produtos.has(produtoId);
}

/**
 * Concede acesso comprado. Idempotente: reentrega de webhook não cria linha
 * nova nem reinicia nada.
 */
export async function concederAcesso(opts: {
  userId: string;
  produto: string;
  origem?: 'compra' | 'cortesia' | 'admin';
  orderId?: string | null;
  obs?: string | null;
}): Promise<boolean> {
  const { data: existente } = await supabase
    .from('entitlements')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('produto', opts.produto)
    .maybeSingle();
  if (existente) return false;

  const { error } = await supabase.from('entitlements').insert({
    user_id: opts.userId,
    produto: opts.produto,
    origem: opts.origem || 'compra',
    order_id: opts.orderId || null,
    obs: opts.obs || null,
  });
  return !error;
}

/**
 * Comprou QUALQUER produto avulso (ferramenta ou curso), fora da assinatura.
 *
 * O layout do app usa isto pra não empurrar esse comprador pros portões que
 * pertencem a outro produto — o muro de CNPJ e a tela de "acabaram seus
 * documentos". Quem pagou por uma ferramenta específica não pode esbarrar num
 * paywall de outra coisa minutos depois de pagar.
 */
export async function comprouAlgumProduto(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from('entitlements')
    .select('id')
    .eq('user_id', userId)
    .in('origem', ['compra', 'cortesia'])
    .limit(1)
    .maybeSingle();
  return !!data;
}
