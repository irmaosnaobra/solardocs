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

/**
 * Assinatura PAGA e dentro da validade: plano diferente de free e, se há data de expiração (entrada de 30
 * dias, Pix), ainda não vencida. Fonte única: o menu (`acessos()`) e o curso (`/kit/meu-acesso`) usam esta.
 */
export function assinaturaVigente(u: { plano?: string | null; plano_expira_em?: string | null }): boolean {
  const plano = String(u.plano || 'free');
  const expira = u.plano_expira_em ? new Date(u.plano_expira_em).getTime() : null;
  return plano !== 'free' && (expira === null || expira > Date.now());
}

/**
 * billing_status em que a assinatura NÃO abre o curso:
 *  - 'trialing': 7 dias grátis da Stripe (ou trial do Pack). O plano é pago, mas nada foi pago: cancelar no
 *    dia 6 e sair com o curso foi o furo que a trava de 30/07/2026 (commit 61797094) fechou.
 *  - 'suspended': assinatura cancelada. No `customer.subscription.deleted` o webhook grava 'suspended' e
 *    DEIXA `plano` como estava (pro/ilimitado) e `plano_expira_em` nulo, então só o plano não mostra o
 *    cancelamento. Pagamento por Pix depois disso zera o status para 'active' (concederMesPago).
 *  - 'unpaid', 'canceled', 'cancelled': nenhum código grava hoje, mas são os nomes que a Stripe usa para
 *    assinatura encerrada. Negados por segurança, para um status novo nunca abrir o curso por engano.
 * 'past_due' segue entrando: a pessoa pagou, só falhou uma cobrança depois (dunning de 7 dias).
 */
const STATUS_QUE_NAO_ABRE_CURSO = new Set(['trialing', 'suspended', 'unpaid', 'canceled', 'cancelled']);

/**
 * A assinatura abre o Fecha Vendas? Só a PAGA e ATIVA: vigente e com billing_status fora de
 * STATUS_QUE_NAO_ABRE_CURSO.
 */
export function assinaturaAbreCurso(u: {
  plano?: string | null; plano_expira_em?: string | null; billing_status?: string | null;
}): boolean {
  return assinaturaVigente(u) && !STATUS_QUE_NAO_ABRE_CURSO.has(String(u.billing_status ?? '').toLowerCase());
}

const VAZIO: Acessos = {
  produtos: new Set(), plano: 'free', assinante: false, isAdmin: false, origem: {},
};

export async function acessos(userId: string | undefined): Promise<Acessos> {
  if (!userId) return { ...VAZIO, produtos: new Set(), origem: {} };

  const [{ data: user }, entRes, contaRes] = await Promise.all([
    supabase.from('users').select('plano, is_admin, plano_expira_em, billing_status').eq('id', userId).single(),
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
  const assinante = assinaturaVigente(user);
  const abreCurso = assinaturaAbreCurso(user);

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
      if (id === 'curso-fechamento' && !abreCurso) continue;   // trial não paga: ver assinaturaAbreCurso
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

/** Erro de leitura/gravacao com o `code` do Postgres/PostgREST (quem chama com `lancarErro` classifica: schema x rede). */
export class ErroDeBanco extends Error {
  constructor(onde: string, error: { message?: string; code?: string }) {
    super(`${onde}: ${error.message ?? 'erro'}`);
    this.name = 'ErroDeBanco';
    this.code = error.code;
  }
  code?: string;
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
  /**
   * Compra nova sobre uma posse VENCIDA (`expira_em` no passado): reativa a linha (tira o vencimento) em vez de
   * devolver false para sempre. Fica desligado por padrao: a Kiwify segue como era.
   */
  reativarVencido?: boolean;
  /** Erro ao ler ou gravar vira excecao em vez de `false` (quem chama distingue "ja tinha" de "nao gravou"). */
  lancarErro?: boolean;
}): Promise<boolean> {
  const { data: existente, error: erroLeitura } = await supabase
    .from('entitlements')
    .select('id, expira_em')
    .eq('user_id', opts.userId)
    .eq('produto', opts.produto)
    .maybeSingle();
  if (erroLeitura && opts.lancarErro) throw new ErroDeBanco('entitlements', erroLeitura);
  if (existente) {
    const venceu = !!existente.expira_em && new Date(existente.expira_em).getTime() < Date.now();
    if (!(venceu && opts.reativarVencido)) return false;
    const { error: erroReativar } = await supabase.from('entitlements')
      .update({ expira_em: null, origem: opts.origem || 'compra', order_id: opts.orderId || null })
      .eq('id', existente.id);
    if (erroReativar && opts.lancarErro) throw new ErroDeBanco('entitlements', erroReativar);
    return !erroReativar;
  }

  const { error } = await supabase.from('entitlements').insert({
    user_id: opts.userId,
    produto: opts.produto,
    origem: opts.origem || 'compra',
    order_id: opts.orderId || null,
    obs: opts.obs || null,
  });
  if (error && opts.lancarErro) throw new ErroDeBanco('entitlements', error);
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
