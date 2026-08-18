/**
 * A PONTE entre o Customer da Stripe e a conta do SolarDoc.
 *
 * Por que existe: o e-mail do Customer NÃO é o e-mail da conta. Quem paga com
 * Apple Pay / Google Pay / Link entrega à Stripe o e-mail da CARTEIRA, e o
 * Customer nasce com ele — enquanto a conta foi criada com o e-mail digitado
 * no formulário do checkout (`session.customer_details.email`), que é o que o
 * webhook de venda usa.
 *
 * Caso real (18/08/2026): Apple Pay com carteira `mossoroenergy@gmail.com` e
 * conta `max.myller.s.n@gmail.com`. Tudo que casa por e-mail do Customer não
 * achou a conta — e o cron `sync-stripe-plans`, que trata "não achei" como
 * "não assina", REBAIXOU pra free um assinante que tinha pagado 1h46 antes,
 * e ainda carimbou a venda como `canceled`. O cliente pagou R$67 de manhã e
 * viu "sua conta é grátis" à tarde.
 *
 * `sales` já guarda os dois lados: `subscription_id` + `customer_id` da Stripe
 * ao lado do `email` que veio do customer_details. Este módulo só lê essa
 * ponte que já existia e ninguém consultava.
 *
 * REGRA DURA: o resultado é sempre ADITIVO — devolve o e-mail da conta E o do
 * Customer. Nenhuma assinatura que casava antes deixa de casar por causa
 * daqui; só passam a casar as que não casavam. Assinatura sem linha em `sales`
 * (as antigas, anteriores ao campo) se comporta exatamente como hoje.
 */

import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';

/** Sem duplicata e sem vazio, preservando a ordem (conta primeiro). */
function limpar(emails: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const e of emails) {
    const v = (e || '').trim();
    if (!v) continue;
    for (const variante of [v, v.toLowerCase()]) {
      if (!out.includes(variante)) out.push(variante);
    }
  }
  return out;
}

/**
 * Todos os e-mails pelos quais esta assinatura/cliente da Stripe pode ser
 * encontrada em `users`. Use com `.in('email', ...)` — nunca `.eq()`.
 *
 * O e-mail da CONTA vem primeiro: quando algum chamador precisar de um só,
 * `[0]` é a resposta certa.
 */
export async function emailsDaConta(opts: {
  customerId?: string | null;
  subscriptionId?: string | null;
  emailDoCustomer?: string | null;
}): Promise<string[]> {
  let emailDaVenda: string | null = null;

  try {
    // subscription_id é a chave mais específica (1 assinatura = 1 conta).
    // customer_id é o fallback: o checkout cria um Customer novo por clique,
    // então ele identifica a compra mesmo antes de existir assinatura.
    let q = supabase.from('sales').select('email, created_at').order('created_at', { ascending: false }).limit(1);
    if (opts.subscriptionId)   q = q.eq('subscription_id', opts.subscriptionId);
    else if (opts.customerId)  q = q.eq('customer_id', opts.customerId);
    else                       q = q.eq('subscription_id', '__sem_chave__');

    const { data } = await q.maybeSingle();
    emailDaVenda = data?.email ?? null;

    // Assinatura conhecida mas sem linha por subscription_id (venda antiga
    // gravada só com customer_id) — tenta o segundo caminho antes de desistir.
    if (!emailDaVenda && opts.subscriptionId && opts.customerId) {
      const { data: porCustomer } = await supabase
        .from('sales')
        .select('email')
        .eq('customer_id', opts.customerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      emailDaVenda = porCustomer?.email ?? null;
    }
  } catch (err) {
    // Best-effort de propósito: sem a ponte o comportamento volta a ser o de
    // hoje (só o e-mail do Customer). Falhar aqui não pode derrubar webhook.
    logger.error('stripe-conta-link', 'consulta a sales falhou', err);
  }

  return limpar([emailDaVenda, opts.emailDoCustomer]);
}

/**
 * Mapa `subscription_id | customer_id` → e-mail da conta, em UMA consulta.
 * Para quem varre a Stripe inteira (o cron de sync) e não pode fazer um SELECT
 * por assinatura.
 */
export async function carregarPonteEmailConta(): Promise<Map<string, string>> {
  const ponte = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('subscription_id, customer_id, email, created_at')
      .order('created_at', { ascending: true });   // mais recente sobrescreve
    if (error) throw error;

    for (const v of data || []) {
      const email = (v.email || '').trim().toLowerCase();
      if (!email) continue;
      if (v.subscription_id) ponte.set(v.subscription_id, email);
      if (v.customer_id)     ponte.set(v.customer_id, email);
    }
  } catch (err) {
    // Mapa vazio = comportamento de hoje. NÃO relança: o sync de plano é mais
    // importante que a ponte, e um erro aqui não pode abortar o cron inteiro.
    logger.error('stripe-conta-link', 'carregarPonteEmailConta falhou', err);
  }
  return ponte;
}

/**
 * Caminho inverso: os Customers da Stripe que pertencem a esta conta, achados
 * pelo ledger em vez de `customers.list({ email })`.
 *
 * Sem isto, cancelar a assinatura de quem pagou por carteira não cancela nada:
 * a busca por e-mail na Stripe não acha o Customer, `cancelStripeSubsForEmail`
 * devolve 0 e o cliente continua sendo cobrado depois de suspenso.
 */
export async function customerIdsDaConta(email: string): Promise<string[]> {
  const alvo = (email || '').trim().toLowerCase();
  if (!alvo) return [];
  try {
    const { data } = await supabase
      .from('sales')
      .select('customer_id')
      .ilike('email', alvo)
      .not('customer_id', 'is', null);
    return [...new Set((data || []).map(v => v.customer_id as string).filter(Boolean))];
  } catch (err) {
    logger.error('stripe-conta-link', `customerIdsDaConta falhou pra ${alvo}`, err);
    return [];
  }
}
