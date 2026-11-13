/**
 * COMPRA E CANCELAMENTO DE ADICIONAL NO CARTÃO, dentro do app (R$ 17 cada ou as 4 por R$ 40).
 *
 * - Cliente com assinatura mensal viva na Stripe (a do plano ou uma só de adicional): o item entra nela, cobra a
 *   diferença na hora (`always_invoice`) e o acesso é liberado já, sem esperar o webhook (o webhook confere depois).
 * - Sem assinatura (free, anual, Pix): abre um Checkout Session só com o adicional.
 * - 'pacote' com avulsas ativas na mesma assinatura: as avulsas saem e o pacote entra no mesmo update, uma fatura só.
 *
 * Cartão que falha NUNCA deixa o item pela metade: `error_if_incomplete` faz a Stripe recusar o update inteiro.
 */

import { ApiError } from '../../utils/apiError';
import { supabase } from '../../utils/supabase';
import { customerIdsDaConta } from '../stripeContaLink';
import { adicionaisLigado, ehItemValido, itemDaLookup, lookupKeyDoItem, PACOTE, produtosDoItem } from './adicionais';
import { acessos } from './acessos';
import { resolverPrecosAdicionais } from './adicionaisPrecos';
import { marcarCancelando, posseDoAdicional } from './adicionaisApp';
import {
  assinaturaSoDeAdicional, itemDoPlano, itensDeAdicional, liberarAdicionaisDaAssinatura,
} from './adicionaisStripe';

/* eslint-disable @typescript-eslint/no-explicit-any */
const VIVAS = new Set(['active']);

/** Assinaturas vivas do cliente: pelo e-mail do Customer e pelos customers que o ledger conhece (Apple Pay, Link). */
async function assinaturasVivas(stripe: any, email: string): Promise<{ subs: any[]; customerId: string | null }> {
  const clientes = await stripe.customers.list({ email, limit: 10 });
  const ids = [...new Set<string>([...(clientes.data ?? []).map((c: any) => c.id), ...(await customerIdsDaConta(email))])];
  const subs: any[] = [];
  for (const customer of ids) {
    const r = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 });
    subs.push(...(r.data ?? []).filter((s: any) => VIVAS.has(s.status)));
  }
  return { subs, customerId: clientes.data?.[0]?.id ?? ids[0] ?? null };
}

const ehMensal = (item: any): boolean => (item?.price?.recurring?.interval ?? 'month') === 'month';

export async function comprarAdicionalCartao(stripe: any, o: {
  userId: string; email: string; item: string; dashboardUrl: string;
}): Promise<{ url: string } | { ok: true }> {
  if (!adicionaisLigado()) throw new ApiError(404, 'Adicionais indisponíveis');
  if (!ehItemValido(o.item)) throw new ApiError(400, 'Item inválido');
  const acessosDaConta = await acessos(o.userId);

  // Quem já tem a ferramenta por qualquer caminho (assinatura, compra antiga, cortesia, adicional ativo) não paga de novo.
  if (produtosDoItem(o.item).every((p) => acessosDaConta.produtos.has(p))) throw new ApiError(409, 'Você já tem este adicional.');

  const chave = lookupKeyDoItem(o.item, 'app') as string;
  let price: string | undefined;
  try {
    price = (await resolverPrecosAdicionais(stripe, [chave])).get(chave);
  } catch (err) {
    // Preço divergente do catálogo (o dono já foi avisado) ou Stripe fora: nunca cobra valor diferente.
    console.error(`[adicionais] preco ${chave} indisponivel:`, (err as Error)?.message);
    throw new ApiError(503, 'Esta compra ainda não está disponível. Tente de novo em instantes.');
  }
  if (!price) {
    console.error(`[adicionais] preco ${chave} nao existe na Stripe e nao foi criado (flag desligada ou cliente sem products)`);
    throw new ApiError(503, 'Esta compra ainda não está disponível. Tente de novo em instantes.');
  }

  const { subs, customerId } = await assinaturasVivas(stripe, o.email);
  const doPlano = subs.find((s) => { const p = itemDoPlano(s.items?.data); return !!p && ehMensal(p); });
  const alvo = doPlano ?? subs.find((s) => assinaturaSoDeAdicional(s));

  if (alvo) {
    const atuais = itensDeAdicional(alvo.items?.data) as any[];
    const itensAtuais = atuais.map((i) => itemDaLookup(i.price?.lookup_key));
    if (itensAtuais.includes(o.item) || itensAtuais.includes(PACOTE)) throw new ApiError(409, 'Você já tem este adicional.');
    // Pacote troca as avulsas: saem e o pacote entra na mesma fatura.
    const saem = o.item === PACOTE ? atuais.map((i) => ({ id: i.id, deleted: true })) : [];
    let atualizada: any;
    try {
      atualizada = await stripe.subscriptions.update(alvo.id, {
        items: [...saem, { price, quantity: 1 }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
      });
    } catch (err) {
      console.error('[adicionais] cobranca do adicional no cartao falhou:', (err as Error)?.message);
      throw new ApiError(402, 'Não consegui cobrar no seu cartão. Confira o cartão ou tente outra forma de pagar.');
    }
    // Pagou (senão o update teria falhado): libera agora. O invoice.payment_succeeded confere depois, sem duplicar.
    await liberarAdicionaisDaAssinatura(atualizada, o.userId);
    return { ok: true };
  }

  const meta = { userId: o.userId, tipo: 'adicional', adicionais: o.item };
  const sessao = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price, quantity: 1 }],
    // Reaproveita o Customer que já existe: um novo a cada clique foi a origem das assinaturas duplicadas.
    ...(customerId ? { customer: customerId } : { customer_email: o.email }),
    metadata: { ...meta, source: 'adicional_app' },
    subscription_data: { metadata: meta },
    success_url: `${o.dashboardUrl}/produtos?adicional=ok`,
    cancel_url: `${o.dashboardUrl}/produtos?adicional=cancelado`,
  });
  if (!sessao?.url) throw new ApiError(502, 'Não consegui abrir o pagamento. Tente de novo.');
  return { url: sessao.url };
}

/**
 * Cancela o adicional no cartão: o acesso continua até o fim do período já pago (a posse tem a data), a cobrança
 * seguinte não acontece. Em assinatura de plano o item sai sem proração; em assinatura só de adicional, com um item
 * só, a assinatura inteira para no fim do período. Devolve false se não há adicional no cartão para cancelar.
 */
export async function cancelarAdicionalCartao(stripe: any, o: { userId: string; item: string }): Promise<boolean> {
  const linhas = await posseDoAdicional(o.userId, o.item, 'cartao');
  const subId = linhas.find((l) => l.order_id)?.order_id;
  if (!subId) return false;

  const sub = await stripe.subscriptions.retrieve(subId);
  const doItem = (itensDeAdicional(sub.items?.data) as any[]).filter((i) => itemDaLookup(i.price?.lookup_key) === o.item);
  if (doItem.length && !['canceled', 'incomplete_expired'].includes(sub.status)) {
    const restam = (sub.items?.data ?? []).filter((i: any) => !doItem.some((d) => d.id === i.id));
    try {
      if (!restam.length) {
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.update(sub.id, {
          items: doItem.map((i) => ({ id: i.id, deleted: true })),
          proration_behavior: 'none',
        });
      }
    } catch (err) {
      console.error('[adicionais] cancelamento no cartao falhou:', (err as Error)?.message);
      throw new ApiError(502, 'Não consegui cancelar agora. Tente de novo em instantes.');
    }
  }
  await marcarCancelando(o.userId, o.item, 'cartao');
  return true;
}

/** E-mail da conta (para a Stripe achar o cliente). */
export async function emailDaConta(userId: string): Promise<string | null> {
  const { data } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
  return (data as { email?: string } | null)?.email ?? null;
}
