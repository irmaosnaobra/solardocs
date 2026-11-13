/**
 * ADICIONAIS NO CARTÃO (Stripe): linhas do bump no checkout, leitura dos itens da assinatura e liberação do acesso.
 *
 * A assinatura do cliente pode ter, além do plano, itens de adicional (price com lookup_key `ad_*`). Dois cuidados
 * que o resto do código nunca precisou ter: (1) o plano deixa de ser sempre o `items.data[0]`, então quem quer o
 * plano usa `itemDoPlano`; (2) pode existir assinatura SÓ de adicional (quem está no free, no anual ou no Pix e compra
 * dentro do app), que nunca pode virar "plano" nem ser suspensa como se fosse.
 *
 * Os clientes Stripe chegam por parâmetro (nunca importados aqui) para o teste trocar por um falso.
 */

import { supabase } from '../../utils/supabase';
import {
  comFolga, ehLookupAdicional, itemDaLookup, lookupKeyDoItem, obsDoAdicional, produtosDaLookup,
  type ContextoAdicional,
} from './adicionais';
import { resolverPrecosAdicionais } from './adicionaisPrecos';
import { concederOuEstender } from './acessos';
import { emailsDaConta } from '../stripeContaLink';

/* eslint-disable @typescript-eslint/no-explicit-any */
type ItemStripe = { id?: string; price?: { id?: string; lookup_key?: string | null; recurring?: { interval?: string } | null } | null; current_period_end?: number };
type AssinaturaStripe = {
  id: string; status?: string; metadata?: Record<string, string> | null; items?: { data?: ItemStripe[] };
  current_period_end?: number; cancel_at_period_end?: boolean; customer?: any;
};

export const ehItemDeAdicional = (item: ItemStripe | null | undefined): boolean =>
  ehLookupAdicional(item?.price?.lookup_key);

/** O item do PLANO (o que não é adicional). undefined = a assinatura só tem adicional. */
export function itemDoPlano<T extends ItemStripe>(itens: T[] | null | undefined): T | undefined {
  return (itens ?? []).find((i) => !ehItemDeAdicional(i));
}

/** Os itens de adicional de uma assinatura. */
export function itensDeAdicional<T extends ItemStripe>(itens: T[] | null | undefined): T[] {
  return (itens ?? []).filter((i) => ehItemDeAdicional(i));
}

/** Assinatura que só cobra adicional (nenhum item de plano). Nunca é "o plano" do cliente. */
export function assinaturaSoDeAdicional(sub: AssinaturaStripe | null | undefined): boolean {
  const itens = sub?.items?.data ?? [];
  if (!itens.length) return sub?.metadata?.tipo === 'adicional';
  return itens.every((i) => ehItemDeAdicional(i));
}

/**
 * Linhas recorrentes do bump para somar ao checkout do plano. Item sem preço na Stripe (script ainda não rodou) é
 * DESCARTADO e vai para o log: o bump nunca derruba a venda do plano. `aplicados` diz o que de fato entrou.
 */
export async function linhasDoBump(
  stripe: { prices: any }, itens: string[], contexto: ContextoAdicional = 'checkout',
): Promise<{ linhas: Array<{ price: string; quantity: number }>; aplicados: string[] }> {
  const pares = itens.map((i) => ({ item: i, chave: lookupKeyDoItem(i, contexto) })).filter((p) => !!p.chave) as Array<{ item: string; chave: string }>;
  if (!pares.length) return { linhas: [], aplicados: [] };
  let precos: Map<string, string>;
  try {
    precos = await resolverPrecosAdicionais(stripe, pares.map((p) => p.chave));
  } catch (err) {
    console.error('[adicionais] nao consegui ler os precos na Stripe (o plano segue sem o bump):', err);
    return { linhas: [], aplicados: [] };
  }
  const linhas: Array<{ price: string; quantity: number }> = [];
  const aplicados: string[] = [];
  for (const p of pares) {
    const price = precos.get(p.chave);
    if (!price) { console.error(`[adicionais] preco ${p.chave} nao existe na Stripe: rode scripts/criar-precos-adicionais.ts`); continue; }
    linhas.push({ price, quantity: 1 });
    aplicados.push(p.item);
  }
  return { linhas, aplicados };
}

/** O dono da assinatura: metadata.userId, ou a conta achada pelo e-mail (ponte `sales` + e-mail do Customer, lido só se preciso). */
export async function donoDaAssinatura(
  sub: AssinaturaStripe, emailDoCustomer?: () => Promise<string | null>,
): Promise<string | null> {
  const direto = sub.metadata?.userId;
  if (direto) return direto;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const emails = await emailsDaConta({ customerId, subscriptionId: sub.id, emailDoCustomer: (await emailDoCustomer?.()) ?? null });
  if (!emails.length) return null;
  const { data } = await supabase.from('users').select('id').in('email', emails).limit(1).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Libera (ou estende) o acesso dos itens de adicional da assinatura: até o fim do período pago + 3 dias. Chamada pelo
 * `checkout.session.completed` e por toda fatura paga; a mesma fatura reentregue cai em 'mantido'. Devolve os produtos
 * que ficaram válidos. Não lança para o webhook por erro de UMA ferramenta: quem chama já isola.
 */
export async function liberarAdicionaisDaAssinatura(sub: AssinaturaStripe, userId: string): Promise<string[]> {
  const liberados: string[] = [];
  for (const item of itensDeAdicional(sub.items?.data)) {
    const chave = item.price?.lookup_key as string;
    const fimS = item.current_period_end ?? sub.current_period_end;
    if (!fimS) { console.error(`[adicionais] assinatura ${sub.id} sem fim de periodo: ${chave} nao liberado`); continue; }
    const cancelando = !!sub.cancel_at_period_end;
    const obs = obsDoAdicional('cartao', itemDaLookup(chave) as string, cancelando);
    for (const produto of produtosDaLookup(chave) ?? []) {
      await concederOuEstender({ userId, produto, ate: comFolga(fimS * 1000), orderId: sub.id, obs });
      liberados.push(produto);
    }
  }
  return liberados;
}

/**
 * A assinatura da fatura só cobra adicional? Serve para o dunning, o espelho de venda e o aviso de renovação NÃO
 * tratarem a cobrança de um adicional como se fosse a mensalidade do plano. Falha de leitura da Stripe LANÇA
 * (`ErroLeituraDaAssinatura`): o webhook responde 500 e a Stripe reenvia, em vez de a fatura seguir pelo caminho do plano.
 */
export async function faturaEhSoDeAdicional(stripe: { subscriptions: any }, invoice: any): Promise<boolean> {
  const sub = await assinaturaDaFatura(stripe, invoice);
  return !!sub && assinaturaSoDeAdicional(sub);
}

/** Não deu para ler a assinatura da fatura na Stripe: sem ela não dá para saber se a fatura é de plano ou só de adicional. */
export class ErroLeituraDaAssinatura extends Error {
  constructor(public subscriptionId: string, causa: unknown) {
    super(`nao li a assinatura ${subscriptionId}: ${(causa as Error)?.message ?? 'erro'}`);
    this.name = 'ErroLeituraDaAssinatura';
  }
}

/**
 * A assinatura da fatura, lida uma vez. null = fatura sem assinatura (nada a classificar). Leitura que falha LANÇA `ErroLeituraDaAssinatura`:
 * devolver null deixaria a fatura de um adicional seguir pelo caminho do plano (status de cobrança, dunning, UTMify, aviso de renovação).
 */
export async function assinaturaDaFatura(stripe: { subscriptions: any }, invoice: any): Promise<AssinaturaStripe | null> {
  const subId: string | null = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription ?? null;
  if (!subId) return null;
  try {
    return (await stripe.subscriptions.retrieve(subId)) as AssinaturaStripe;
  } catch (err) {
    console.error(`[adicionais] fatura ${invoice?.id}: nao li a assinatura ${subId}:`, (err as Error)?.message);
    throw new ErroLeituraDaAssinatura(subId, err);
  }
}

/**
 * `invoice.payment_succeeded`: acha a assinatura da fatura e libera os adicionais dela. Fatura sem assinatura, ou
 * assinatura sem adicional, não faz nada (zero chamada ao banco). `soAdicional` = a assinatura não tem plano: o resto
 * do tratamento da fatura (status de cobrança, UTMify, aviso de renovação) não se aplica.
 */
export async function liberarAdicionaisDaFatura(
  stripe: { subscriptions: any; customers: any }, invoice: any, subJaLida?: AssinaturaStripe | null,
): Promise<{ liberados: string[]; soAdicional: boolean }> {
  const sub = subJaLida ?? await assinaturaDaFatura(stripe, invoice);
  if (!sub) return { liberados: [], soAdicional: false };
  const subId = sub.id;
  if (!itensDeAdicional(sub.items?.data).length) return { liberados: [], soAdicional: false };
  const soAdicional = assinaturaSoDeAdicional(sub);
  const dono = await donoDaAssinatura(sub, async () => {
    const id = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    return id ? ((await stripe.customers.retrieve(id)) as { email?: string | null }).email ?? null : null;
  });
  if (!dono) { console.error(`[adicionais] fatura ${invoice?.id}: nao achei o dono da assinatura ${subId}`); return { liberados: [], soAdicional }; }
  return { liberados: await liberarAdicionaisDaAssinatura(sub, dono), soAdicional };
}

/**
 * O que o webhook faz com `invoice.payment_succeeded`, nesta ORDEM: (1) classifica a fatura (assinatura SÓ de adicional?); (2) libera os
 * adicionais num try próprio. A classificação não depende da liberação: se ela lança, `soAdicional` já está decidido e a fatura de adicional
 * continua sem seguir pelo caminho do plano. Só lança `ErroLeituraDaAssinatura` (a Stripe não respondeu): o webhook responde 500 para ela reenviar.
 */
export async function processarFaturaDeAdicionais(
  stripe: { subscriptions: any; customers: any }, invoice: any,
): Promise<{ soAdicional: boolean; liberados: string[] }> {
  const sub = await assinaturaDaFatura(stripe, invoice);
  const soAdicional = !!sub && assinaturaSoDeAdicional(sub);
  try {
    const r = await liberarAdicionaisDaFatura(stripe, invoice, sub);
    return { soAdicional, liberados: r.liberados };
  } catch (err) {
    console.error(`[adicionais] liberacao na fatura ${invoice?.id} falhou (cobranca intacta):`, (err as Error)?.message);
    return { soAdicional, liberados: [] };
  }
}

/**
 * `checkout.session.completed`: libera os adicionais da assinatura da sessão. Roda DEPOIS do bloco do plano, quando a
 * conta (inclusive a criada pelo webhook, no checkout público) já existe. Devolve [] sem tocar no banco quando a
 * sessão não tem assinatura ou a assinatura não tem adicional.
 */
export async function liberarAdicionaisDaSessao(
  stripe: { subscriptions: any }, session: any,
): Promise<string[]> {
  if (!session?.subscription || session.payment_status === 'unpaid') return [];
  const sub = (await stripe.subscriptions.retrieve(session.subscription as string)) as AssinaturaStripe;
  if (!itensDeAdicional(sub.items?.data).length) return [];

  let dono: string | null = session.metadata?.userId ?? null;
  const email = String(session.customer_email ?? session.customer_details?.email ?? '').toLowerCase().trim();
  if (!dono && email) {
    const { data } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    dono = (data as { id?: string } | null)?.id ?? null;
  }
  if (!dono) { console.error(`[adicionais] sessao ${session.id} paga e sem conta para liberar: ${email || 'sem e-mail'}`); return []; }
  return liberarAdicionaisDaAssinatura(sub, dono);
}
