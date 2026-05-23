import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { sendDunningDay0 } from './dunningService';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// price_id → plano interno + limite. Sincronizado com PLAN_MAP em
// paymentsController.ts — se mudar lá, mudar aqui.
// price_1TKPoS é o PRO antigo (R$47), mantido como alias pra clientes legados.
const PRICE_TO_PLAN: Record<string, { plano: 'pro' | 'ilimitado'; limite: number }> = {
  [(process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim()]: { plano: 'pro',       limite: 90 },
  [(process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim()]: { plano: 'ilimitado', limite: 999999 },
  'price_1TKPoSCkkgzQ4IHesK6wi3Qq': { plano: 'pro', limite: 90 },  // PRO antigo (R$47)
};

// Stripe statuses que mantêm acesso ao plano. past_due fica DENTRO porque
// o dunning preserva acesso por 5 dias (ver dunningService) — só rebaixa
// pra free quando o D5 cancela a sub ou quando vier subscription.deleted via webhook.
const ACTIVE_STATUSES = new Set<string>(['active', 'trialing', 'past_due']);

type StripeTruth = {
  plano: 'pro' | 'ilimitado';
  limite: number;
  status: string;
  trial_end: Date | null;  // Date se status='trialing', null caso contrário
};

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

      const trialEnd = s.status === 'trialing' && s.trial_end
        ? new Date(s.trial_end * 1000)
        : null;
      truth.set(key, { plano: planInfo.plano, limite: planInfo.limite, status: s.status, trial_end: trialEnd });
      seenEmail.add(key);
    }

    if (!subs.has_more) break;
    cursor = subs.data[subs.data.length - 1]?.id;
  }

  return truth;
}

export async function syncStripePlans(): Promise<{
  scanned: number; upgraded: number; downgraded: number; unchanged: number;
  past_due_caught: number; recovered: number; trial_converted: number; errors: number;
}> {
  let scanned = 0, upgraded = 0, downgraded = 0, unchanged = 0;
  let past_due_caught = 0, recovered = 0, trial_converted = 0, errors = 0;

  let truth: Map<string, StripeTruth>;
  try {
    truth = await fetchStripeTruth();
  } catch (err) {
    logger.error('stripe-sync', 'fetchStripeTruth falhou — abortando', err);
    throw err;
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, plano, limite_documentos, billing_status, past_due_since, trial_expires_at');

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

    // ── Reconcilia billing_status com Stripe (backstop pro webhook) ──
    // Mapeia status real do Stripe → billing_status que queremos no Supabase.
    // active (cobrado, fora de trial) → 'active' (assinante verde)
    // trialing                        → 'trialing' (em teste, ainda não cobrado)
    // past_due                        → 'past_due' (cobrança falhou, em dunning)
    // sem sub ativa                   → 'active' (free, livre, não em dunning)
    const desiredBillingStatus =
      realStatus === 'trialing' ? 'trialing' :
      realStatus === 'past_due' ? 'past_due' :
      'active';
    const desiredTrialExpiresAt = stripeTruth?.trial_end?.toISOString() ?? null;

    // Caso A: Stripe diz past_due mas Supabase diz active → webhook perdeu o
    // invoice.payment_failed. Marca past_due_since=agora e dispara D0.
    if (realStatus === 'past_due' && u.billing_status !== 'past_due' && !u.past_due_since) {
      await supabase
        .from('users')
        .update({
          billing_status: 'past_due',
          past_due_since: new Date().toISOString(),
          dunning_last_day_sent: null,
        })
        .eq('id', u.id);
      sendDunningDay0(u.id).catch(err =>
        logger.error('stripe-sync', `sendDunningDay0 falhou pra ${u.email}`, err),
      );
      past_due_caught++;
      logger.info('stripe-sync', `${u.email}: ghost-pro detectado, marcado past_due`);
    }
    // Caso B: Stripe diz active/trialing mas Supabase diz past_due/suspended →
    // webhook perdeu o invoice.payment_succeeded. Limpa estado de inadimplência.
    else if ((realStatus === 'active' || realStatus === 'trialing') &&
             (u.billing_status === 'past_due' || u.billing_status === 'suspended')) {
      await supabase
        .from('users')
        .update({
          billing_status: desiredBillingStatus,
          trial_expires_at: desiredTrialExpiresAt,
          past_due_since: null,
          dunning_last_day_sent: null,
        })
        .eq('id', u.id);
      recovered++;
      logger.info('stripe-sync', `${u.email}: recuperado, billing_status → ${desiredBillingStatus}`);
    }
    // Caso C: trial convertido em pagamento (trialing → active) — vira assinante verde.
    else if (realStatus === 'active' && u.billing_status === 'trialing') {
      await supabase
        .from('users')
        .update({
          billing_status: 'active',
          trial_expires_at: null,
        })
        .eq('id', u.id);
      trial_converted++;
      logger.info('stripe-sync', `${u.email}: trial convertido em assinante (active)`);
    }
    // Caso D: ajustes finos de billing_status/trial_expires_at sem mudança de classe
    // (ex: alguém marcado 'active' no Supabase mas continua em trial no Stripe;
    // ou trial_expires_at desatualizado).
    else if (
      u.billing_status !== desiredBillingStatus ||
      (u.trial_expires_at ?? null) !== desiredTrialExpiresAt
    ) {
      await supabase
        .from('users')
        .update({
          billing_status: desiredBillingStatus,
          trial_expires_at: desiredTrialExpiresAt,
        })
        .eq('id', u.id);
      logger.info('stripe-sync', `${u.email}: billing_status ${u.billing_status} → ${desiredBillingStatus}`);
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

  const summary = { scanned, upgraded, downgraded, unchanged, past_due_caught, recovered, trial_converted, errors };
  logger.info('stripe-sync', 'concluído', summary);
  return summary;
}
