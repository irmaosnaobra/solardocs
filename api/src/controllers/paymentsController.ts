import { Request, Response } from 'express';
import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { sendMetaEvent } from '../utils/metaPixel';
import { sendDunningDay0, sendDunningRecovered } from '../services/dunningService';
import { sendCheckoutCompletionEmail } from '../utils/mailer';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// Trim defensivo + fallback hardcoded — env vars no Vercel às vezes
// vêm com \n no fim (paste com quebra de linha) e quebram o checkout.
function envPrice(key: string, fallback: string): string {
  const v = (process.env[key] || '').trim();
  return v || fallback;
}

const PLAN_MAP: Record<string, { priceId: string; plano: string; limite: number; descricao: string }> = {
  pro: {
    priceId: envPrice('STRIPE_PRICE_PRO', 'price_1TKNtbCkkgzQ4IHeCr0mYSXn'),
    plano: 'pro',
    limite: 90,
    descricao: '📄 90 documentos por mês  •  Indicado para até 20 vendas mensais  •  Tudo do Iniciante  •  Histórico completo de documentos  •  Suporte prioritário',
  },
  ilimitado: {
    priceId: envPrice('STRIPE_PRICE_VIP', 'price_1TUh2yCkkgzQ4IHeZqy52Zu2'),
    plano: 'ilimitado',
    limite: 999999,
    descricao: '📄 Documentos ilimitados  •  Indicado para +20 vendas mensais  •  Dashboard completo  •  Acesso a toda expansão da plataforma  •  Suporte prioritário',
  },
};

// mapa invertido price_id → plano (para o webhook)
function planByPrice(priceId: string) {
  return Object.values(PLAN_MAP).find(p => p.priceId === priceId);
}

export async function createCheckout(req: Request, res: Response): Promise<void> {
  const { plan } = req.body as { plan: string };
  // Aceita 'vip' (alias do landing) → 'ilimitado'
  const planKey = plan === 'vip' ? 'ilimitado' : plan;
  const planInfo = PLAN_MAP[planKey];

  if (!planInfo) {
    res.status(400).json({ error: 'Plano inválido' });
    return;
  }

  const priceId = planInfo.priceId;

  const { data: user } = await supabase
    .from('users')
    .select('email, plano')
    .eq('id', req.userId)
    .single();

  if (!user?.email) {
    res.status(400).json({ error: 'Usuário não encontrado' });
    return;
  }

  if (user.plano === planInfo.plano) {
    res.status(400).json({ error: 'Você já está nesse plano' });
    return;
  }

  // Atualiza a descrição do produto no Stripe para refletir os valores corretos
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as any;
    if (product?.id) {
      await stripe.products.update(product.id, { description: planInfo.descricao });
    }
  } catch { /* silencioso — não bloqueia o checkout */ }

  // Tem subscription ativa? Faz upgrade in-place com proração — cobra a diferença
  // imediatamente no cartão já cadastrado, sem novo checkout.
  try {
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer = customers.data[0];
    if (customer) {
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 1,
      });
      const activeSub = subs.data[0];
      if (activeSub && activeSub.items.data[0]) {
        await stripe.subscriptions.update(activeSub.id, {
          items: [{ id: activeSub.items.data[0].id, price: priceId }],
          proration_behavior: 'always_invoice',
          metadata: { userId: req.userId! },
        });

        await supabase
          .from('users')
          .update({ plano: planInfo.plano, limite_documentos: planInfo.limite, documentos_usados: 0 })
          .eq('id', req.userId);

        res.json({ upgraded: true, plano: planInfo.plano });
        return;
      }
    }
  } catch (err) {
    console.error('upgrade in-place falhou, caindo no checkout normal:', err);
  }

  // Fluxo normal: usuário sem subscription ativa (FREE) → cria checkout
  // Com trial de 7 dias: cartão capturado, primeira cobrança só no 8º dia.
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    metadata: { userId: req.userId! },
    subscription_data: {
      trial_period_days: 7,
      metadata: { userId: req.userId! },
    },
    // Pós-pagamento: cai em /documentos pra ele ver os tipos de doc, conhecer
    // a plataforma. Banner sugere (não obriga) cadastrar empresa. CompanyRequiredGate
    // só bloqueia quando ele clica num tipo específico de doc.
    success_url: `${dashboardUrl}/documentos?welcome=1&plan=${encodeURIComponent(planInfo.plano)}`,
    cancel_url:  `${dashboardUrl}/?cancelado=1`,
    custom_text: {
      submit: { message: planInfo.descricao },
    },
  });

  res.json({ url: session.url });
}

// Checkout PÚBLICO (sem login) — fluxo LP → Stripe → Cadastro.
// A pessoa escolhe o plano na LP e vai DIRETO pro Stripe (coleta email + cartão,
// 7 dias grátis). Só depois de aprovar o cartão ela cria a conta no cadastro
// (com o email do session_id). Sem free: quem não passa daqui não tem conta.
export async function createPublicCheckout(req: Request, res: Response): Promise<void> {
  const { plan } = req.body as { plan: string };
  const planKey = plan === 'vip' ? 'ilimitado' : plan;
  const planInfo = PLAN_MAP[planKey];

  if (!planInfo) {
    res.status(400).json({ error: 'Plano inválido' });
    return;
  }

  try {
    const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: planInfo.priceId, quantity: 1 }],
      // Stripe coleta o email no próprio checkout (não temos user ainda).
      billing_address_collection: 'auto',
      subscription_data: {
        trial_period_days: 7,
        metadata: { plan: planInfo.plano, source: 'public_checkout' },
      },
      metadata: { plan: planInfo.plano, source: 'public_checkout' },
      // Pós-pagamento → cadastro com o session_id pra puxar o email e o plano.
      // &plano= é fallback: se o GET /checkout-info falhar, o RegisterForm ainda
      // sabe o plano e não mostra a tela enganosa de "criar conta grátis".
      success_url: `${dashboardUrl}/auth?mode=register&session={CHECKOUT_SESSION_ID}&plano=${encodeURIComponent(planInfo.plano === 'ilimitado' ? 'vip' : planInfo.plano)}`,
      cancel_url:  `${dashboardUrl}/?cancelado=1`,
      custom_text: { submit: { message: planInfo.descricao } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('createPublicCheckout error:', err);
    res.status(500).json({ error: 'Falha ao iniciar o checkout' });
  }
}

export async function getCheckoutInfo(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId as any);

    // No trial de 7 dias NÃO há cobrança imediata: payment_status vem como
    // 'no_payment_required' e a sub fica 'trialing'. Então validamos que o
    // checkout foi COMPLETO (status complete) — não que houve pagamento.
    const paidOrTrialing = session.payment_status === 'paid'
      || session.payment_status === 'no_payment_required'
      || session.status === 'complete';
    if (!paidOrTrialing) {
      res.status(400).json({ error: 'Checkout não concluído' });
      return;
    }

    const email = session.customer_email ?? (session.customer_details as { email?: string })?.email ?? null;

    let planName: string | null = null;
    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = sub.items.data[0]?.price?.id ?? '';
      const info = planByPrice(priceId);
      if (info) planName = info.plano;
    }

    res.json({ email, plan: planName });
  } catch {
    res.status(404).json({ error: 'Sessão não encontrada' });
  }
}

export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    res.status(400).send('Webhook signature inválida');
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const userId  = session.metadata?.userId;
    const email   = session.customer_email ?? (session.customer_details as any)?.email;

    let priceId = '';
    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      priceId = sub.items.data[0]?.price?.id ?? '';
    }

    const planInfo = planByPrice(priceId);
    // Guard cross-produto: este bloco SÓ roda pra price PRO/VIP do SolarDoc.
    // Compra do Pack Solar é mode=payment, sem subscription → priceId='' →
    // planByPrice undefined → bloco pulado. Conta Stripe é compartilhada, então
    // o isolamento aqui é justamente o `if (planInfo)`.
    if (planInfo) {
      const { plano, limite } = planInfo;

      if (userId) {
        await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0 })
          .eq('id', userId);
      } else if (email) {
        // UPDATE com .select() pra saber se casou alguma linha. No fluxo
        // LP→Stripe→Cadastro a conta só nasce quando a pessoa VOLTA e preenche
        // o form — e este evento dispara NO MOMENTO do pagamento, ANTES disso.
        // Então 0 linhas aqui é o caminho NORMAL (a pessoa ainda vai cadastrar),
        // NÃO um órfão. Por isso NÃO mandamos email de recuperação daqui — só
        // gravamos um marcador. O envio real é feito pelo sweep
        // recoverOrphanCheckouts (followupService) após uma janela de carência,
        // que confirma que a conta ainda não existe minutos depois.
        const { data: updated } = await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0 })
          .eq('email', email)
          .select('id');

        if (!updated?.length) {
          // Marcador idempotente do checkout pendente (insert falha em 23505 se já
          // existe — ok). O sweep lê estes marcadores; não enviamos nada aqui.
          await supabase
            .from('system_state')
            .insert({
              key: `orphan_checkout:${session.id}`,
              value: { email, plano, session_id: session.id, created_at: new Date().toISOString() },
            });
        }
      }

      const valorMap: Record<string, number> = { iniciante: 27, pro: 47, ilimitado: 97 };
      sendMetaEvent('Purchase', {
        eventId:    session.id,
        email:      email ?? undefined,
        customData: { value: valorMap[plano] ?? 0, currency: 'BRL', content_name: plano.toUpperCase() },
      });
    }
  }

  // Cancelamento da assinatura (cancelou nos 7 dias, ou Stripe encerrou após
  // retentativas). Modelo SEM FREE: BLOQUEIA (suspended) — a tela de suspensão
  // pede pra reativar/atualizar o cartão. Não vira mais free.
  if (event.type === 'customer.subscription.deleted') {
    const sub    = event.data.object as any;
    const custId = sub.customer as string;
    const customer = await stripe.customers.retrieve(custId) as any;
    if (customer.email) {
      await supabase
        .from('users')
        .update({
          billing_status: 'suspended',
          documentos_usados: 0,
          dunning_last_day_sent: null,
        })
        .eq('email', customer.email);
    }
  }

  // Renovação da assinatura falhou — INICIA o fluxo de dunning de 7 dias.
  // NÃO corta acesso. Carimba past_due_since (idempotente, só na 1ª falha
  // pra não resetar o relógio em cada retentativa do Stripe Smart Retries)
  // e dispara o aviso D0 imediato por email + WhatsApp.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as any;
    const custId  = invoice.customer as string;

    // Só age em renovação. Primeira cobrança falha já é tratada pelo próprio
    // checkout (cliente vê o erro na hora e tenta de novo).
    if (invoice.billing_reason === 'subscription_cycle') {
      const customer = await stripe.customers.retrieve(custId) as any;
      if (customer.email) {
        // Idempotência: só carimba past_due_since se ainda for null. Cada
        // retentativa do Stripe dispara payment_failed de novo — sem o
        // guard, o usuário ganhava +7 dias de tolerância a cada falha.
        const { data: updated } = await supabase
          .from('users')
          .update({
            billing_status: 'past_due',
            past_due_since: new Date().toISOString(),
            dunning_last_day_sent: null,
          })
          .eq('email', customer.email)
          .is('past_due_since', null)
          .select('id')
          .maybeSingle();

        // Dispara D0 só na 1ª falha (quando o update acima de fato carimbou).
        if (updated?.id) {
          await sendDunningDay0(updated.id).catch(err =>
            console.error('sendDunningDay0 falhou:', err),
          );
        }
      }
    }
  }

  // Sincronização de status: Stripe muda subscription pra past_due/unpaid.
  // Só ATUALIZA billing_status (sem mexer em past_due_since/dunning — esses
  // são responsabilidade do invoice.payment_failed). Idempotente.
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as any;
    if (sub.status === 'past_due' || sub.status === 'unpaid') {
      const custId   = sub.customer as string;
      const customer = await stripe.customers.retrieve(custId) as any;
      if (customer.email) {
        await supabase
          .from('users')
          .update({ billing_status: 'past_due' })
          .eq('email', customer.email)
          .eq('billing_status', 'active'); // só se ainda estava active — evita
                                            // sobrescrever 'suspended' caso evento chegue fora de ordem
      }
    }
  }

  // Pagamento confirmado (cobrança recorrente OU retry bem-sucedido do
  // Smart Retries durante o dunning) — limpa estado de inadimplência e
  // notifica o cliente.
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as any;
    if (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_update') {
      const custId   = invoice.customer as string;
      const customer = await stripe.customers.retrieve(custId) as any;
      if (customer.email) {
        // Só notifica se o usuário estava de fato em dunning (past_due ou suspended).
        const { data: userBefore } = await supabase
          .from('users')
          .select('id, billing_status')
          .eq('email', customer.email)
          .single();

        await supabase
          .from('users')
          .update({
            billing_status: 'active',
            past_due_since: null,
            dunning_last_day_sent: null,
          })
          .eq('email', customer.email);

        const wasDunning = userBefore?.billing_status === 'past_due' || userBefore?.billing_status === 'suspended';
        if (wasDunning && userBefore?.id) {
          await sendDunningRecovered(userBefore.id).catch(err =>
            console.error('sendDunningRecovered falhou:', err),
          );
        }
      }
    }
  }

  res.json({ received: true });
}

// Customer portal — link assinado pra o cliente atualizar cartão / cancelar
// assinatura. Usado pelo botão "Atualizar pagamento" na tela de suspensão.
export async function createBillingPortal(req: Request, res: Response): Promise<void> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', req.userId)
      .single();

    if (!user?.email) {
      res.status(400).json({ error: 'Usuário não encontrado' });
      return;
    }

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer = customers.data[0];
    if (!customer) {
      res.status(404).json({ error: 'Nenhuma assinatura encontrada pra esse email' });
      return;
    }

    const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${dashboardUrl}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('createBillingPortal error:', err);
    res.status(500).json({ error: 'Falha ao criar sessão do portal' });
  }
}
