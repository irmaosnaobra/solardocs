import { Request, Response } from 'express';
import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { sendMetaEvent } from '../utils/metaPixel';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PLAN_MAP: Record<string, { priceId: string; plano: string; limite: number }> = {
  iniciante: { priceId: process.env.STRIPE_PRICE_INICIANTE!, plano: 'iniciante', limite: 15 },
  pro:       { priceId: process.env.STRIPE_PRICE_PRO!,       plano: 'pro',       limite: 35 },
  ilimitado: { priceId: process.env.STRIPE_PRICE_VIP!,       plano: 'ilimitado', limite: 999999 },
};

// mapa invertido price_id → plano (para o webhook)
function planByPrice(priceId: string) {
  return Object.values(PLAN_MAP).find(p => p.priceId === priceId);
}

export async function createCheckout(req: Request, res: Response): Promise<void> {
  const { plan } = req.body as { plan: string };
  const planInfo = PLAN_MAP[plan];

  if (!planInfo) {
    res.status(400).json({ error: 'Plano inválido' });
    return;
  }

  const priceId = planInfo.priceId;

  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('id', req.userId)
    .single();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user?.email,
    metadata: { userId: req.userId! },
    success_url: `${process.env.DASHBOARD_URL}/planos?sucesso=1&sid={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.DASHBOARD_URL}/planos?cancelado=1`,
  });

  res.json({ url: session.url });
}

export async function getCheckoutInfo(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      res.status(400).json({ error: 'Pagamento não confirmado' });
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

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    res.status(400).send('Webhook signature inválida');
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId  = session.metadata?.userId;
    const email   = session.customer_email ?? (session.customer_details as any)?.email;

    // Buscar o price_id da subscription criada
    let priceId = '';
    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      priceId = sub.items.data[0]?.price?.id ?? '';
    }

    const planInfo = planByPrice(priceId);
    if (planInfo) {
      const { plano, limite } = planInfo;

      if (userId) {
        // Fluxo plataforma: usuário logado iniciou o checkout
        await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0 })
          .eq('id', userId);
      } else if (email) {
        // Fluxo landing page: compra direta pelo link Stripe — ativa pelo e-mail
        await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0 })
          .eq('email', email);
      }

      // Meta CAPI — Purchase (server-side, deduplica com pixel client via session.id)
      const valorMap: Record<string, number> = { iniciante: 27, pro: 47, ilimitado: 97 };
      const valor = valorMap[plano] ?? 0;
      sendMetaEvent('Purchase', {
        eventId:    session.id,
        email:      email ?? undefined,
        customData: { value: valor, currency: 'BRL', content_name: plano.toUpperCase() },
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub    = event.data.object as Stripe.Subscription;
    const custId = sub.customer as string;
    const customer = await stripe.customers.retrieve(custId) as Stripe.Customer;
    if (customer.email) {
      await supabase
        .from('users')
        .update({ plano: 'free', limite_documentos: 0, documentos_usados: 0 })
        .eq('email', customer.email);
    }
  }

  // Pagamento da renovação falhou — corta o acesso imediatamente
  if (event.type === 'invoice.payment_failed') {
    const invoice  = event.data.object as Stripe.Invoice;
    const custId   = invoice.customer as string;
    // Só age se for cobrança de renovação (não a primeira, que já tem checkout.session)
    if ((invoice as any).billing_reason === 'subscription_cycle') {
      const customer = await stripe.customers.retrieve(custId) as Stripe.Customer;
      if (customer.email) {
        await supabase
          .from('users')
          .update({ plano: 'free', limite_documentos: 0 })
          .eq('email', customer.email);
      }
    }
  }

  // Assinatura virou past_due ou unpaid (retentativas esgotadas) — garante corte
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.status === 'past_due' || sub.status === 'unpaid') {
      const custId   = sub.customer as string;
      const customer = await stripe.customers.retrieve(custId) as Stripe.Customer;
      if (customer.email) {
        await supabase
          .from('users')
          .update({ plano: 'free', limite_documentos: 0 })
          .eq('email', customer.email);
      }
    }
  }

  res.json({ received: true });
}
