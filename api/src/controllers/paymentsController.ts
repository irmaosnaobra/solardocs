import { Request, Response } from 'express';
import Stripe from 'stripe';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { sendDunningDay0, sendDunningRecovered } from '../services/dunningService';
import { sendCheckoutCompletionEmail } from '../utils/mailer';
import { sendActivationWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';
import { upsertSale, sendPurchaseForSale } from '../services/salesLedger';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// Trim defensivo + fallback hardcoded — env vars no Vercel às vezes
// vêm com \n no fim (paste com quebra de linha) e quebram o checkout.
function envPrice(key: string, fallback: string): string {
  const v = (process.env[key] || '').trim();
  return v || fallback;
}

const PLAN_MAP: Record<string, { priceId: string; plano: string; limite: number; valor: number; descricao: string }> = {
  pro: {
    priceId: envPrice('STRIPE_PRICE_PRO', 'price_1TKNtbCkkgzQ4IHeCr0mYSXn'),
    plano: 'pro',
    limite: 90,
    valor: 27, // preço mensal real (R$) — espelha PRICES.pro da Landing. Usado no value do Purchase (Meta CAPI).
    descricao: '📄 90 documentos por mês  •  Indicado para até 20 vendas mensais  •  Tudo do Iniciante  •  Histórico completo de documentos  •  Suporte prioritário',
  },
  ilimitado: {
    priceId: envPrice('STRIPE_PRICE_VIP', 'price_1TUh2yCkkgzQ4IHeZqy52Zu2'),
    plano: 'ilimitado',
    limite: 999999,
    valor: 67, // preço mensal real (R$) — espelha PRICES.vip da Landing. Usado no value do Purchase (Meta CAPI).
    descricao: '📄 Documentos ilimitados  •  Indicado para +20 vendas mensais  •  Dashboard completo  •  Acesso a toda expansão da plataforma  •  Suporte prioritário',
  },
  // Downsell da LP: MESMO acesso ilimitado (VIP), preço promocional R$ 49/mês.
  // Oferecido no popup ao clicar no Pro. planByPrice() resolve isto pra plano
  // 'ilimitado' (libera VIP na plataforma) e valor 49 entra no Purchase da Meta
  // (CAPI) — NÃO 67. Trial de 7 dias é herdado do createPublicCheckout.
  // Preço R$ 49/mês LIVE criado no produto SolarDoc VIP (prod_UIzsfi8HDwqOvu) em
  // 04/jul/2026. Fallback já é o price_id real; STRIPE_PRICE_VIP_PROMO no Vercel
  // é opcional (sobrescreve o fallback, boa prática).
  vip_promo: {
    priceId: envPrice('STRIPE_PRICE_VIP_PROMO', 'price_1TpYsLCkkgzQ4IHeSt3Oupwg'),
    plano: 'ilimitado',
    limite: 999999,
    valor: 49,
    descricao: '📄 Documentos ilimitados  •  Dashboard completo  •  Acesso a toda expansão da plataforma  •  Suporte prioritário',
  },
};

// mapa invertido price_id → plano (para o webhook)
function planByPrice(priceId: string) {
  return Object.values(PLAN_MAP).find(p => p.priceId === priceId);
}

// Campos de atribuição que viajam da LP → Stripe metadata → users.
// lp_session = sd_lp_session (session_id da landing, casa com page_visits).
const ATTRIBUTION_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','lp_session'] as const;

// Extrai só os campos de atribuição PRESENTES do body, como strings (Stripe
// exige string e limita 500 chars/valor). Campos ausentes não entram → o
// checkout sem UTM fica idêntico ao de hoje (aditivo, não pode quebrar nada).
function extractAttribution(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = body?.[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 480);
  }
  return out;
}

// Só os utm_* presentes no metadata (pra guardar no marcador órfão / value JSONB).
function utmsFromMetadata(meta: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    const v = meta?.[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

// Patch de atribuição pras colunas de `users`, montado SÓ com campos presentes
// no metadata do checkout. Re-entrega do webhook sem UTM → patch vazio (a menos
// do checkout_session_id) → nunca sobrescreve valor já gravado com null.
function attributionPatchFromMetadata(
  meta: Record<string, unknown> | null | undefined,
  checkoutSessionId: string,
): Record<string, string> {
  const utms = utmsFromMetadata(meta);
  const patch: Record<string, string> = { ...utms, checkout_session_id: checkoutSessionId };
  const lp = meta?.lp_session;
  if (typeof lp === 'string' && lp.trim()) patch.attribution_session_id = lp.trim();
  // Só carimba a data se de fato houve algum dado de atribuição (utm ou lp_session).
  if (Object.keys(utms).length || patch.attribution_session_id) {
    patch.attribution_captured_at = new Date().toISOString();
  }
  return patch;
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

    // Atribuição: a LP manda os UTMs + o session_id (sd_lp_session) no body.
    // Só entram no metadata se vierem preenchidos (campos ausentes = checkout
    // normal de hoje). Stripe exige valores string; truncamos por segurança.
    const attribution = extractAttribution(req.body);
    const baseMeta = { plan: planInfo.plano, source: 'public_checkout', ...attribution };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: planInfo.priceId, quantity: 1 }],
      // Stripe coleta o email no próprio checkout (não temos user ainda).
      billing_address_collection: 'auto',
      // Coleta o WhatsApp no checkout → o webhook manda a boas-vindas da Giovanna
      // pelo número certo NA HORA do pagamento (não depende do cliente voltar e
      // preencher o cadastro). Vem em E.164 (+55...) em session.customer_details.phone.
      phone_number_collection: { enabled: true },
      subscription_data: {
        trial_period_days: 7,
        metadata: baseMeta,
      },
      metadata: baseMeta,
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
      const { plano, limite, valor } = planInfo;

      // Atribuição forward-only: lê os UTMs que createPublicCheckout gravou no
      // metadata. Só keys NÃO-vazias entram no patch — uma re-entrega do webhook
      // sem UTM (improvável, mas at-least-once) nunca zera o que já foi gravado.
      // Esta é a escrita de FALLBACK; a primária é no register (authController).
      const attrPatch = attributionPatchFromMetadata(session.metadata, session.id);

      if (userId) {
        await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0, ...attrPatch })
          .eq('id', userId);
      } else if (email) {
        // Normaliza p/ lowercase — o register grava e busca a conta em lowercase.
        // O UPDATE e o INSERT abaixo PRECISAM usar o mesmo case, senão o webhook
        // cria uma linha ("Foo@x.com") que o register não acha ("foo@x.com") e
        // vira DUPLICATA (users.email é UNIQUE case-sensitive).
        const emailLc = String(email).toLowerCase().trim();

        // UPDATE com .select() pra saber se casou alguma linha. Se a conta JÁ existe
        // (ex.: FREE que comprou depois), só atualiza o plano. Se 0 linhas casarem,
        // é o fluxo LP→Stripe→cadastro em que a pessoa ainda não tem conta → o bloco
        // abaixo (100% CADASTRO) CRIA a conta na hora e manda "defina sua senha".
        const { data: updated } = await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0, ...attrPatch })
          .eq('email', emailLc)
          .select('id');

        if (!updated?.length) {
          // ═══════════════════ 100% CADASTRO ═══════════════════
          // Pagou (sub trialing criada) mas AINDA não tem conta — fluxo
          // LP→Stripe→cadastro em que a pessoa fecha a aba antes de voltar. Em vez
          // de só marcar/avisar (que deixava o cliente invisível), CRIAMOS a conta
          // AGORA, com o email e o plano que a Stripe confirmou, e mandamos "defina
          // sua senha" por EMAIL (backbone) + WhatsApp (best-effort). Assim nenhum
          // pagante fica sem cadastro.
          //
          // IDEMPOTÊNCIA: users.email é UNIQUE → re-entrega do webhook (at-least-once)
          // ou corrida com o /register batem em 23505 e são ignoradas (não duplica
          // conta nem reenvia). ADITIVO E À PROVA DE ERRO: todo o bloco é try/catch;
          // qualquer falha aqui NÃO pode quebrar o Purchase/Meta abaixo nem o pagamento.
          try {
            const phone = ((session.customer_details as any)?.phone || '').replace(/\D/g, '') || null;
            const nome  = ((session.customer_details as any)?.name as string | null) || null;
            const token = crypto.randomBytes(32).toString('hex');
            // Expiração GENEROSA (30d) — é onboarding, não recuperação de senha de 1h.
            const expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            const { data: created, error: insErr } = await supabase
              .from('users')
              .insert({
                email: emailLc,
                password_hash: null,          // conta PENDENTE — ativa quando o cliente definir a senha
                nome,
                plano,
                limite_documentos: limite,
                documentos_usados: 0,
                data_reset: expiresIso,
                whatsapp: phone,
                billing_status: 'trialing',
                reset_token: token,
                reset_token_expires: expiresIso,
                ...attrPatch,
              })
              .select('id')
              .single();

            if (insErr) {
              // 23505 = email já existe (re-entrega OU o /register acabou de criar) →
              // conta já tratada, não faz nada. Outro erro: loga e segue (não quebra).
              if ((insErr as { code?: string }).code !== '23505') {
                console.error('100%-cadastro: criação de conta no webhook falhou:', insErr);
              }
            } else if (created) {
              const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
              const resetUrl = `${dashboardUrl}/auth?mode=redefinir&token=${token}`;

              // EMAIL = backbone confiável (Resend nunca é banido). Await pra garantir
              // o envio antes de a função serverless encerrar.
              try {
                await sendCheckoutCompletionEmail({ to: emailLc, sessionId: session.id, plano, resetUrl });
              } catch (err) {
                console.error('100%-cadastro: email de ativação falhou:', err);
              }

              // WhatsApp = MELHOR-ESFORÇO (Z-API pode cair/banir). NUNCA trava a conta.
              // Só dispara se a Stripe coletou telefone no checkout.
              if (phone) {
                try {
                  await sendActivationWhatsApp(phone, resetUrl, plano, nome);
                  await supabase
                    .from('users')
                    .update({ whatsapp_welcome_sent_at: new Date().toISOString() })
                    .eq('id', created.id);
                } catch (err) {
                  console.error('100%-cadastro: WhatsApp de ativação falhou:', err);
                }
              }
            }
          } catch (err) {
            console.error('100%-cadastro: exceção no auto-create (pagamento intacto):', err);
          }
        }
      }

      // ═══════════════════ VENDA (fonte única) + PURCHASE ═══════════════════
      // DURABLE-FIRST: grava a linha da venda no ledger `sales` ANTES de tentar o
      // Meta. Se a entrega falhar (rede/token/freeze serverless), o cron
      // reDrivePendingPurchases reenvia (idempotente por event_id = session.id →
      // Meta faz dedup, não duplica). O Purchase leva email + TELEFONE + external_id
      // + nome (+ fbc/fbp quando a Fase 4 popular) → correspondência forte; o email
      // sozinho quase não casava a venda com o anúncio. value = preço REAL do plano
      // (27/49/67) do PLAN_MAP. Aditivo e à prova de erro: nunca quebra o pagamento.
      try {
        const cd = session.customer_details as { name?: string | null; phone?: string | null } | null;
        const produto = priceId === PLAN_MAP.vip_promo.priceId ? 'VIP PROMO'
          : priceId === PLAN_MAP.ilimitado.priceId ? 'VIP' : 'PRO';
        const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
        const saleId = await upsertSale({
          checkout_session_id: session.id,
          subscription_id: (session.subscription as string) ?? null,
          customer_id: (session.customer as string) ?? null,
          email: email ?? null,
          nome: cd?.name ?? null,
          phone: cd?.phone ? String(cd.phone).replace(/\D/g, '') : null,
          plano, produto, valor,
          status: 'trialing',
          utm_source: meta.utm_source ?? null,
          utm_medium: meta.utm_medium ?? null,
          utm_campaign: meta.utm_campaign ?? null,
          utm_content: meta.utm_content ?? null,
          utm_term: meta.utm_term ?? null,
          attribution_session_id: meta.lp_session ?? null,
          fbc: meta.fbc ?? null,   // Fase 4 (LP) passa a popular
          fbp: meta.fbp ?? null,
          card_passed_at: new Date().toISOString(),
        });
        if (saleId) await sendPurchaseForSale(saleId);
      } catch (err) {
        console.error('ledger/Purchase falhou (pagamento intacto):', err);
      }
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
