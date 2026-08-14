// Named import (e não `import Stripe from 'stripe'`): é assim que o tipo entra
// no escopo neste tsconfig — o default só traz o namespace.
import { Stripe } from 'stripe';
import { logger } from '../utils/logger';

// ── PLANO ANUAL (ancoragem) ─────────────────────────────────────────────────
// R$ 564 cobrados de uma vez = R$ 47/mês. Existe pra ancorar o mensal de R$ 67:
// ao lado do anual, o mensal deixa de ser "o preço" e vira "a opção cara".
//
// POR QUE O PRICE NASCE EM RUNTIME E NÃO NO PAINEL
// Não há acesso à conta da Stripe por script daqui — a chave só existe no
// ambiente da Vercel. É o mesmo motivo do garantirVitrineStripe e do
// garantirCupomStripe: o servidor cria o que precisa na primeira vez que
// precisa, e ninguém depende de um passo manual que pode não acontecer.
//
// DIFERENÇA IMPORTANTE PRO CUPOM: `coupons.create` aceita um `id` escolhido por
// nós (por isso o retrieve-then-create de lá funciona), mas `prices.create` NÃO.
// A chave idempotente de um price é o `lookup_key` — é ele que faz duas
// instâncias frias resolverem o MESMO price em vez de criarem dois.
export const ANUAL_VALOR = 564;                     // R$ cobrados de uma vez, por ano
export const ANUAL_EQUIV_MES = 47;                  // 564/12 — número da vitrine, nunca do ledger
export const ANUAL_CENTAVOS = ANUAL_VALOR * 100;
// O valor entra na chave de propósito: mudar o preço cria um price NOVO em vez
// de reaproveitar em silêncio um antigo com o valor velho (mesma disciplina do
// id do cupom, que carrega o desconto em centavos).
export const ANUAL_LOOKUP_KEY = `sd-vip-anual-${ANUAL_CENTAVOS}`;

// O anual mora no MESMO produto do VIP mensal (é o mesmo acesso, outro ciclo) —
// então o produto sai daqui, do price que já está no ar.
const PRICE_VIP = (process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim();

// Memória por instância: o price não muda entre checkouts, e sem isto cada
// compra pagaria uma chamada extra à Stripe. Cold start refaz.
let cache = '';

/**
 * O id do price anual que ESTA instância já conhece — sem ida à Stripe.
 * Vazio = ainda não resolvido nesta instância (não significa que não existe).
 * Quem precisa da resposta certa chama `resolverPrecoAnual`.
 */
export function precoAnualConhecido(): string {
  return (process.env.STRIPE_PRICE_VIP_ANUAL || '').trim() || cache;
}

/**
 * Resolve (e por padrão cria) o price anual na Stripe.
 *
 * `criar: false` é pra quem só LÊ — o cron de sincronia e o painel não podem
 * inventar preço; eles só precisam reconhecer o que já existe.
 *
 * Lança se a Stripe estiver fora do ar e o price não for conhecido. É de
 * propósito: quem lê price_id pra decidir plano precisa que a falha seja
 * barulhenta. Devolver '' ali viraria "esse assinante não tem plano".
 */
export async function resolverPrecoAnual(
  stripe: Stripe,
  opts: { criar?: boolean } = {},
): Promise<string> {
  const jaSei = precoAnualConhecido();
  if (jaSei) return jaSei;

  const achados = await stripe.prices.list({ lookup_keys: [ANUAL_LOOKUP_KEY], limit: 1 });
  const existente = achados.data[0]?.id;
  if (existente) {
    cache = existente;
    return existente;
  }

  if (opts.criar === false) return '';

  const vip = await stripe.prices.retrieve(PRICE_VIP, { expand: ['product'] });
  const produto = typeof vip.product === 'string' ? vip.product : (vip.product as { id?: string })?.id;
  if (!produto) throw new Error('price anual: não achei o produto do VIP mensal');

  try {
    const novo = await stripe.prices.create({
      product: produto,
      currency: 'brl',
      unit_amount: ANUAL_CENTAVOS,
      recurring: { interval: 'year' },
      lookup_key: ANUAL_LOOKUP_KEY,
      nickname: `SolarDoc anual — R$ ${ANUAL_VALOR}/ano (equivale a R$ ${ANUAL_EQUIV_MES}/mês)`,
    });
    cache = novo.id;
    logger.info('stripe', `price anual criado: ${novo.id} (${ANUAL_LOOKUP_KEY})`);
    return novo.id;
  } catch (err) {
    // Corrida entre duas instâncias frias: quem perdeu recebe erro de
    // lookup_key duplicada. O price existe — é só ler de novo.
    const denovo = await stripe.prices.list({ lookup_keys: [ANUAL_LOOKUP_KEY], limit: 1 });
    const id = denovo.data[0]?.id;
    if (id) {
      cache = id;
      return id;
    }
    throw err;
  }
}
