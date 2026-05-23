import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { sendDunningDay0 } from './dunningService';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// price_id → plano interno + limite. Sincronizado com PLAN_MAP em
// paymentsController.ts — se mudar lá, mudar aqui.
const PRICE_TO_PLAN: Record<string, { plano: 'pro' | 'ilimitado'; limite: number }> = {
  [(process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim()]: { plano: 'pro',       limite: 90 },
  [(process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim()]: { plano: 'ilimitado', limite: 999999 },
};

// Stripe statuses que mantêm acesso ao plano. past_due fica DENTRO porque
// o dunning preserva acesso por 5 dias (ver dunningService) — só rebaixa
// pra free quando o D5 cancela a sub ou quando vier subscription.deleted via webhook.
const ACTIVE_STATUSES = new Set<string>(['active', 'trialing', 'past_due']);

type StripeTruth = { plano: 'pro' | 'ilimitado'; limite: number; status: string };

// Varre TODAS as subscriptions do Stripe (sem janela de data), monta um mapa
// email → plano real. Pra cada email só guarda a sub MAIS RECENTE (created desc)
// que esteja em status ativo — evita usar sub canceled antiga sobre a vigente.
async function fetchStripeTruth(): Promise<Map<string, StripeTruth>> {
  const truth = new Map<string, StripeTruth>();
  const seenEmail = new Set<string>();

  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const subs = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      starting_after: cursor,
      expand: ['data.customer'],
    });

    for (const s of subs.data) {
      const cust = s.customer as { email?: string | null; deleted?: boolean } | string;
      const email = typeof cust === 'string' ? null : (cust.email ?? null);
      if (!email) continue;

      const key = email.toLowerCase();
      // Stripe lista por created desc → primeira sub ativa que aparecer pra esse
      // email é a vigente. Subs canceladas posteriores não devem sobrescrever.
      if (seenEmail.has(key)) continue;

      if (!ACTIVE_STATUSES.has(s.status)) continue;

      const priceId = s.items.data[0]?.price?.id ?? '';
      const planInfo = PRICE_TO_PLAN[priceId];
      if (!planInfo) continue;

      truth.set(key, { plano: planInfo.plano, limite: planInfo.limite, status: s.status });
      seenEmail.add(key);
    }

    if (!subs.has_more) break;
    cursor = subs.data[subs.data.length - 1]?.id;
  }

  return truth;
}

export async function syncStripePlans(): Promise<{
  scanned: number; upgraded: number; downgraded: number; unchanged: number;
  past_due_caught: number; recovered: number; errors: number;
}> {
  let scanned = 0, upgraded = 0, downgraded = 0, unchanged = 0;
  let past_due_caught = 0, recovered = 0, errors = 0;

  let truth: Map<string, StripeTruth>;
  try {
    truth = await fetchStripeTruth();
  } catch (err) {
    logger.error('stripe-sync', 'fetchStripeTruth falhou — abortando', err);
    throw err;
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, plano, limite_documentos, billing_status, past_due_since');

  if (error || !users) {
    logger.error('stripe-sync', 'leitura de users falhou', error);
    throw error ?? new Error('users null');
  }

  for (const u of users) {
    scanned++;
    const stripeTruth = truth.get(u.email.toLowerCase());

    const realPlano  = stripeTruth?.plano  ?? 'free';
    const realLimite = stripeTruth?.limite ?? 0;
    const realStatus = stripeTruth?.status ?? null;

    // ── Reconcilia billing_status (backstop pro webhook que pode ter perdido evento) ──
    // Caso 1: Stripe diz past_due mas Supabase diz active → webhook perdeu o
    // invoice.payment_failed. Marca past_due_since=agora e dispara D0.
    if (realStatus === 'past_due' && u.billing_status === 'active' && !u.past_due_since) {
      await supabase
        .from('users')
        .update({
          billing_status: 'past_due',
          past_due_since: new Date().toISOString(),
          dunning_last_day_sent: null,
        })
        .eq('id', u.id);
      // Dispara D0 best-effort — se falhar, o cron de dunning pega no dia seguinte.
      sendDunningDay0(u.id).catch(err =>
        logger.error('stripe-sync', `sendDunningDay0 falhou pra ${u.email}`, err),
      );
      past_due_caught++;
      logger.info('stripe-sync', `${u.email}: ghost-pro detectado, marcado past_due`);
    }

    // Caso 2: Stripe diz active/trialing mas Supabase diz past_due/suspended →
    // webhook perdeu o invoice.payment_succeeded. Limpa estado de inadimplência.
    if ((realStatus === 'active' || realStatus === 'trialing') &&
        (u.billing_status === 'past_due' || u.billing_status === 'suspended')) {
      await supabase
        .from('users')
        .update({
          billing_status: 'active',
          past_due_since: null,
          dunning_last_day_sent: null,
        })
        .eq('id', u.id);
      recovered++;
      logger.info('stripe-sync', `${u.email}: recuperado, billing_status → active`);
    }

    // ── Reconcilia plano + limite ──
    if (u.plano === realPlano && u.limite_documentos === realLimite) {
      unchanged++;
      continue;
    }

    // Só reseta documentos_usados quando o plano de fato muda — senão usuário
    // perderia contagem mensal a cada execução horária.
    const patch: Record<string, unknown> = { plano: realPlano, limite_documentos: realLimite };
    if (u.plano !== realPlano) patch.documentos_usados = 0;

    const { error: updErr } = await supabase.from('users').update(patch).eq('id', u.id);
    if (updErr) {
      errors++;
      logger.error('stripe-sync', `update user ${u.id} falhou`, updErr);
      continue;
    }

    if (realPlano === 'free') downgraded++;
    else upgraded++;

    logger.info('stripe-sync', `${u.email}: ${u.plano} → ${realPlano}`);
  }

  const summary = { scanned, upgraded, downgraded, unchanged, past_due_caught, recovered, errors };
  logger.info('stripe-sync', 'concluído', summary);
  return summary;
}
