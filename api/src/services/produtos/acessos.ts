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
 *
 * Duas fontes que já existiam são LIDAS aqui, não duplicadas em entitlements: o Kit Fecha Vendas (kit_pedidos,
 * regra em ./kitPedidos) e o LimpaPro (limpapro_entitlements e limpapro_membros, em
 * ./limpapro). Compra feita com outro e-mail ou outro cadastro é resolvida no webhook (./contaDoComprador).
 */

import { supabase } from '../../utils/supabase';
import { PRODUTOS, produtosDaAssinatura } from './catalogo';
import { pedidosPagosDaConta } from './kitPedidos';
import { temCompraLimpapro } from './limpapro';

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

  const [{ data: user }, entRes, contaRes] = await Promise.all([
    supabase.from('users').select('plano, is_admin, plano_expira_em').eq('id', userId).single(),
    supabase.from('entitlements').select('produto, origem, expira_em').eq('user_id', userId),
    // E-mail e WhatsApp da conta (para achar a compra do Kit e a do LimpaPro) saem de uma consulta À PARTE da primeira, de propósito: se ela falhar (coluna que não existe
    // numa migration atrasada), a conta continua existindo e só aquele pedaço fica de fora. Se estivessem no
    // select de cima, o erro derrubaria `user` e toda conta voltaria como VAZIA.
    supabase.from('users').select('email, whatsapp').eq('id', userId).maybeSingle(),
  ]);
  const ents = entRes.data;
  const conta = (contaRes.data ?? null) as { email?: string | null; whatsapp?: string | null } | null;
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

  // O curso Kit Fecha Vendas e o LimpaPro continuam com as fontes que já tinham: kit_pedidos (a isca de R$27 e
  // a concessão por assinatura gravam lá, e o funil do admin lê de lá) e limpapro_entitlements/limpapro_membros
  // (o webhook do outro projeto grava lá). Duplicar em entitlements criaria duas verdades pro mesmo acesso, então
  // aqui a gente LÊ a verdade existente em vez de reescrevê-la. Lê-se em paralelo; erro de leitura é "não tem".
  const [pedidosKit, comprouLimpapro] = await Promise.all([
    produtos.has('curso-fechamento')
      ? Promise.resolve([])
      : pedidosPagosDaConta(userId, conta?.email).catch((err) => {
        console.warn('[acessos] kit_pedidos não pôde ser lido, tratando como "não tem":', err);
        return [];
      }),
    produtos.has('curso-limpapro')
      ? Promise.resolve(false)
      : temCompraLimpapro({ email: conta?.email, whatsapp: conta?.whatsapp }).catch(() => false),
  ]);

  // Kit Fecha Vendas: A MESMA regra do /kit/meu-acesso (ver kitPedidos.ts): pedido pago, de qualquer item,
  // achado pelo user_id OU pelo e-mail da conta. Só soma em relação ao que o menu já fazia (user_id).
  if (!produtos.has('curso-fechamento') && pedidosKit.length > 0) {
    produtos.add('curso-fechamento');
    origem['curso-fechamento'] = 'compra';
  }

  if (comprouLimpapro) { produtos.add('curso-limpapro'); origem['curso-limpapro'] = 'compra'; }

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
