import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { sendDunningDay0 } from './dunningService';
import { FREE_LIMIT } from './planService';
import { resolverPrecoAnual, precoAnualConhecido, FERRAMENTAS_DO_ANUAL } from './precoAnual';
import { concederAcesso } from './produtos/acessos';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// price_id → plano interno + limite. Sincronizado com PLAN_MAP em
// paymentsController.ts — se mudar lá, mudar aqui.
// price_1TKPoS é o PRO antigo (R$47), mantido como alias pra clientes legados.
const PRICE_TO_PLAN: Record<string, { plano: 'pro' | 'ilimitado'; limite: number }> = {
  [(process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim()]: { plano: 'pro',       limite: 90 },
  [(process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim()]: { plano: 'ilimitado', limite: 999999 },
  // VIP PROMO (downsell LP, R$49) — ilimitado. Sem isto o cron REBAIXAVA esses clientes pra free.
  [(process.env.STRIPE_PRICE_VIP_PROMO || 'price_1TpYsLCkkgzQ4IHeSt3Oupwg').trim()]: { plano: 'ilimitado', limite: 999999 },
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
  priceId: string;         // pra derivar produto (PRO/VIP/VIP PROMO) no ledger
  valorReais: number;      // unit_amount real da Stripe (R$) — corrige chute do backfill
};

// Preços pra distinguir VIP (R$67) de VIP PROMO (R$49) no ledger de vendas.
const SYNC_PRICE_VIP       = (process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim();
const SYNC_PRICE_VIP_PROMO = (process.env.STRIPE_PRICE_VIP_PROMO || 'price_1TpYsLCkkgzQ4IHeSt3Oupwg').trim();
function produtoFromPrice(priceId: string): 'PRO' | 'VIP' | 'VIP PROMO' | 'VIP ANUAL' {
  // Guarda do vazio: sem ela, um price desconhecido casaria com '' e viraria
  // "VIP ANUAL" — este `if` vem antes justamente porque o default é 'PRO'.
  const anual = precoAnualConhecido();
  if (anual && priceId === anual)        return 'VIP ANUAL';
  if (priceId === SYNC_PRICE_VIP_PROMO) return 'VIP PROMO';
  if (priceId === SYNC_PRICE_VIP)       return 'VIP';
  return 'PRO';
}

// Varre TODAS as subscriptions do Stripe (sem janela de data), monta um mapa
// email → plano real. Pra cada email só guarda a sub MAIS RECENTE (created desc)
// que esteja em status ativo — evita usar sub canceled antiga sobre a vigente.
async function fetchStripeTruth(): Promise<Map<string, StripeTruth>> {
  const truth = new Map<string, StripeTruth>();
  const seenEmail = new Set<string>();

  // O price anual é resolvido em runtime (services/precoAnual.ts), então ele não
  // cabe no mapa estático acima. `criar: false`: o cron LÊ preço, não inventa.
  //
  // SEM .catch DE PROPÓSITO. Se a Stripe piscar e isto virasse '', toda
  // assinatura anual sairia do `truth` e o laço lá embaixo REBAIXARIA cada uma
  // pra free — o bug do VIP_PROMO, mas disparado por um segundo de rede ruim.
  // Estourando aqui, o sync inteiro aborta sem tocar em ninguém.
  const anualId = await resolverPrecoAnual(stripe, { criar: false });
  const priceToPlan: typeof PRICE_TO_PLAN = {
    ...PRICE_TO_PLAN,
    // Chave vazia nunca entra: PRICE_TO_PLAN[''] devolveria 'ilimitado' pra
    // qualquer sub sem price.
    ...(anualId ? { [anualId]: { plano: 'ilimitado' as const, limite: 999999 } } : {}),
  };

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
      const planInfo = priceToPlan[priceId];
      if (!planInfo) continue;

      const unitAmount = s.items.data[0]?.price?.unit_amount ?? 0;
      const trialEnd = s.status === 'trialing' && s.trial_end
        ? new Date(s.trial_end * 1000)
        : null;
      truth.set(key, { plano: planInfo.plano, limite: planInfo.limite, status: s.status, trial_end: trialEnd, priceId, valorReais: Math.round(unitAmount) / 100 });
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
  // Quantas ferramentas do anual o cron teve que REPOR. Em operação normal é 0:
  // qualquer número acima disso é webhook que não gravou — e é o único jeito de
  // essa falha aparecer, já que o cliente não sente falta enquanto assina.
  anual_ferramentas: number;
}> {
  let scanned = 0, upgraded = 0, downgraded = 0, unchanged = 0;
  let past_due_caught = 0, recovered = 0, trial_converted = 0, errors = 0;
  let anual_ferramentas = 0;

  let truth: Map<string, StripeTruth>;
  try {
    truth = await fetchStripeTruth();
  } catch (err) {
    logger.error('stripe-sync', 'fetchStripeTruth falhou — abortando', err);
    throw err;
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, plano, limite_documentos, billing_status, past_due_since, trial_expires_at, is_admin, pack_trial_until, plano_expira_em');

  if (error || !users) {
    logger.error('stripe-sync', 'leitura de users falhou', error);
    throw error ?? new Error('users null');
  }

  for (const u of users) {
    // Admins não passam pelo funil de Stripe — têm plano vitalício gerenciado
    // manualmente. Sem este guard, o sync ia rebaixar admin pra free toda hora
    // (porque admin não tem sub no Stripe).
    if (u.is_admin) {
      unchanged++;
      continue;
    }
    scanned++;
    const stripeTruth = truth.get(u.email.toLowerCase());

    // Trial Pack→SolarDoc (sem cartão, sem sub Stripe): enquanto vigente, o user
    // tem PRO e o sync NÃO pode rebaixar. Sai do funil do Stripe igual admin.
    const packTrialActive = u.pack_trial_until
      ? new Date(u.pack_trial_until).getTime() > Date.now()
      : false;
    if (packTrialActive && !stripeTruth) {
      // Garante PRO + billing trialing enquanto o trial Pack vale. Sem sub Stripe,
      // o cron pack-trial-expiry rebaixa no vencimento.
      if (u.plano !== 'pro' || u.billing_status !== 'trialing') {
        await supabase
          .from('users')
          .update({ plano: 'pro', limite_documentos: 90, billing_status: 'trialing' })
          .eq('id', u.id);
      }
      unchanged++;
      continue;
    }

    // Liberação por Pix (sem cartão, sem sub Stripe): enquanto plano_expira_em
    // estiver no futuro, o acesso foi pago manualmente e o sync NÃO pode rebaixar.
    // Sai do funil do Stripe igual admin/pack_trial. Não há cron de expiração Pix —
    // o rebaixamento no vencimento é manual (ou via /schedule).
    const pixAccessActive = u.plano_expira_em
      ? new Date(u.plano_expira_em).getTime() > Date.now()
      : false;
    if (pixAccessActive && !stripeTruth) {
      unchanged++;
      continue;
    }

    const realPlano  = stripeTruth?.plano  ?? 'free';
    const realLimite = stripeTruth?.limite ?? FREE_LIMIT;
    const realStatus = stripeTruth?.status ?? null;

    // Reconcilia o LEDGER de vendas (sales) com a Stripe — status SEMPRE; e
    // produto + valor quando há sub viva (corrige o chute do backfill: ex. um
    // 'ilimitado' que na verdade é VIP R$67, não VIP PROMO R$49). Assim o ledger
    // fica 100% igual à Stripe — sem erro de registro. Best-effort.
    const salesStatus = realStatus ?? 'canceled';
    const salesPatch: Record<string, unknown> = { status: salesStatus, updated_at: new Date().toISOString() };
    if (stripeTruth?.priceId) {
      salesPatch.produto = produtoFromPrice(stripeTruth.priceId);
      if (stripeTruth.valorReais > 0) salesPatch.valor = stripeTruth.valorReais;
    }
    await supabase
      .from('sales')
      .update(salesPatch)
      .eq('email', u.email.toLowerCase())
      .then(() => {}, () => {});

    // ── FERRAMENTAS DO ANUAL (backstop pro webhook) ──────────────────────────
    // O webhook concede Precificação e Inventário na venda do anual. Se ele
    // falhar, NINGUÉM PERCEBE: a assinatura viva já libera as duas por
    // `naAssinatura`, então o cliente entra e vê tudo no lugar. O erro só
    // apareceria daqui a um ano, no cancelamento — quando ele perdesse
    // justamente o que a página vendeu como "pra sempre".
    //
    // Por isso o cron repõe. `concederAcesso` é idempotente (não duplica linha
    // nem reinicia nada), então rodar toda manhã não custa mais que 2 SELECTs
    // por assinante anual. Best-effort: falhar aqui não pode abortar o sync do
    // plano, que é o trabalho principal desta função.
    const idAnual = precoAnualConhecido();
    if (idAnual && stripeTruth?.priceId === idAnual) {
      for (const ferramenta of FERRAMENTAS_DO_ANUAL) {
        try {
          const criou = await concederAcesso({
            userId: u.id,
            produto: ferramenta,
            origem: 'compra',
            obs: 'incluso no plano anual',
          });
          if (criou) {
            anual_ferramentas++;
            logger.info('stripe-sync', `anual: ${ferramenta} reposto pra ${u.email} (webhook não gravou)`);
          }
        } catch (err) {
          logger.error('stripe-sync', `anual: falha ao repor ${ferramenta} pra ${u.email}`, err);
        }
      }
    }

    // ── Reconcilia billing_status com Stripe (backstop pro webhook) ──
    // Mapeia status real do Stripe → billing_status que queremos no Supabase.
    // active (cobrado, fora de trial) → 'active' (assinante verde)
    // trialing                        → 'trialing' (em teste, ainda não cobrado)
    // past_due                        → 'past_due' (cobrança falhou, em dunning)
    // sem sub ativa                   → 'active' (free, livre, não em dunning)
    // Acesso pago por Pix manda no status: enquanto plano_expira_em está no
    // futuro o cliente está em dia, mesmo com uma sub de cartão morrendo no
    // Stripe. Sem isto o Caso D reescrevia 'past_due' toda manhã e o cliente
    // aparecia como inadimplente no painel depois de ter pago.
    const desiredBillingStatus =
      pixAccessActive              ? 'active'   :
      realStatus === 'trialing'    ? 'trialing' :
      realStatus === 'past_due'    ? 'past_due' :
      'active';
    const desiredTrialExpiresAt = stripeTruth?.trial_end?.toISOString() ?? null;

    // Caso A: Stripe diz past_due mas Supabase diz active → webhook perdeu o
    // invoice.payment_failed. Marca past_due_since=agora e dispara D0.
    //
    // MENOS quando o acesso está pago por Pix (plano_expira_em no futuro): aí o
    // cartão falhando no Stripe é justamente o motivo de o cliente ter migrado
    // pro Pix — vários não têm limite. Sem este guard o sync desfazia a liberação
    // manual toda manhã e mandava "sua cobrança falhou" pra quem tinha acabado de
    // pagar. O guard do Pix lá em cima não pega este caso porque a sub ainda
    // existe no Stripe (stripeTruth preenchido); o certo é cancelar a sub, mas
    // enquanto ela viver o cliente não pode ser cobrado nem rebaixado.
    if (realStatus === 'past_due' && !pixAccessActive && u.billing_status !== 'past_due' && !u.past_due_since) {
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
    // Trial Pack vencido (chegou aqui = packTrialActive false): limpa o carimbo
    // pra não reprocessar e deixar claro que acabou.
    if (realPlano === 'free' && u.pack_trial_until) patch.pack_trial_until = null;

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

  const summary = { scanned, upgraded, downgraded, unchanged, past_due_caught, recovered, trial_converted, errors, anual_ferramentas };
  logger.info('stripe-sync', 'concluído', summary);
  return summary;
}
