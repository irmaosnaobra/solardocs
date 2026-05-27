// Dunning de inadimplência — 5 dias de tolerância após falha de cobrança.
//
// Fluxo:
//   D0: invoice.payment_failed (webhook) → marca past_due_since, envia D0 imediato
//   D1/D2/D3/D4: cron diário envia lembretes (acesso mantido)
//   D5: cron diário CANCELA a sub no Stripe + plano='free' + envia aviso final
//   Stripe Smart Retries continua tentando em D1-D4 em paralelo. Se cair
//   invoice.payment_succeeded em qualquer dia até D4, billing_status volta pra 'active'.
//   Depois de D5 (sub cancelada), pra voltar tem que assinar de novo do zero.

import { supabase } from '../utils/supabase';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { sendWhatsApp } from './agents/zapiClient';
import { logger } from '../utils/logger';
import { FREE_LIMIT } from './planService';

const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const FROM_EMAIL = process.env.MAIL_FROM || 'SolarDoc Pro <equipe@solardoc.app>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'aiorosgroup@gmail.com';

const SUPPORT_PHONE_LABEL = '(34) 99943-7831';
const BILLING_URL = `${APP_URL}/conta`;
const CHECKOUT_URL = `${APP_URL}/`;

interface DunningTemplate {
  subject: string;
  html: string;
  whatsapp: string;
}

function tplD0(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Falha na cobrança da sua assinatura SolarDoc Pro',
    html: emailShell(
      'Identificamos uma falha na cobrança',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         A cobrança da sua assinatura SolarDoc Pro não foi processada com sucesso pela sua operadora de cartão.
         Pode ter sido um cartão expirado, limite indisponível ou bloqueio temporário pelo banco.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         <strong>Seu acesso à plataforma continua ativo nos próximos 5 dias.</strong>
         Pedimos a gentileza de atualizar os dados de pagamento dentro desse prazo para evitar o cancelamento da assinatura.
       </p>`,
      'Atualizar forma de pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Aviso de cobrança*\n\n${oi}\n\n` +
      `A cobrança da sua assinatura SolarDoc Pro não foi processada com sucesso. ` +
      `Seu acesso continua liberado pelos próximos 5 dias.\n\n` +
      `Por favor, atualize os dados de pagamento para evitar o cancelamento:\n${BILLING_URL}\n\n` +
      `Em caso de dúvidas, estamos à disposição.`,
  };
}

function tplD1(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Lembrete: pagamento da sua assinatura SolarDoc Pro',
    html: emailShell(
      'Lembrete de pagamento pendente',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Ontem identificamos uma falha na cobrança da sua assinatura e o pagamento ainda não foi regularizado.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Faltam <strong>4 dias</strong> para o cancelamento automático.
         A atualização do cartão leva menos de 1 minuto.
       </p>`,
      'Atualizar forma de pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Lembrete*\n\n${oi}\n\n` +
      `Ontem identificamos uma falha na cobrança da sua assinatura.\n\n` +
      `*Faltam 4 dias para o cancelamento automático.*\n\n` +
      `Atualize em:\n${BILLING_URL}`,
  };
}

function tplD2(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Pagamento pendente — faltam 3 dias',
    html: emailShell(
      'Pagamento ainda pendente',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Já se passaram 2 dias desde a falha na cobrança da sua assinatura SolarDoc Pro.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Faltam <strong>3 dias</strong> para o cancelamento. Se houver alguma dificuldade,
         responda este email ou nos chame no WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Atualizar forma de pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Pagamento pendente*\n\n${oi}\n\n` +
      `Já se passaram 2 dias desde a falha na cobrança.\n\n` +
      `*Faltam 3 dias para o cancelamento.*\n\n` +
      `Atualize em:\n${BILLING_URL}\n\n` +
      `Se houver alguma dificuldade, basta responder esta mensagem.`,
  };
}

function tplD3(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Atenção: faltam 2 dias para o cancelamento',
    html: emailShell(
      'Atenção — cancelamento próximo',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         A cobrança da sua assinatura SolarDoc Pro segue pendente há 3 dias.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         <strong>Faltam apenas 2 dias para o cancelamento automático da assinatura.</strong>
         Após o cancelamento, será necessário contratar novamente para retomar o acesso.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Em caso de dúvidas, fale com a nossa equipe pelo WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Regularizar pagamento agora',
    ),
    whatsapp:
      `*SolarDoc Pro — Atenção*\n\n${oi}\n\n` +
      `A cobrança da sua assinatura segue pendente há 3 dias.\n\n` +
      `*Faltam apenas 2 dias para o cancelamento automático.*\n\n` +
      `Após o cancelamento, será preciso contratar novamente.\n\n` +
      `Regularize em:\n${BILLING_URL}`,
  };
}

function tplD4(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Último aviso — sua assinatura será cancelada amanhã',
    html: emailShell(
      'Último aviso antes do cancelamento',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Este é o último aviso antes do cancelamento da sua assinatura SolarDoc Pro.
         A cobrança permanece pendente há 4 dias.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         <strong>O cancelamento ocorrerá amanhã caso o pagamento não seja regularizado até lá.</strong>
         Depois disso, a conta volta para o plano gratuito e será preciso assinar novamente para retomar o acesso completo.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Para qualquer dificuldade, nossa equipe está disponível no WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Regularizar pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Último aviso*\n\n${oi}\n\n` +
      `Último aviso antes do cancelamento. A cobrança permanece pendente há 4 dias.\n\n` +
      `*O cancelamento ocorrerá amanhã caso o pagamento não seja regularizado.*\n\n` +
      `Regularize em:\n${BILLING_URL}\n\n` +
      `Estamos à disposição para auxiliar.`,
  };
}

function tplD5(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Sua assinatura SolarDoc Pro foi cancelada',
    html: emailShell(
      'Assinatura cancelada',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Após 5 dias sem a regularização do pagamento, sua assinatura SolarDoc Pro foi <strong>cancelada</strong>.
         Sua conta voltou para o plano gratuito e seu histórico permanece preservado.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Para retomar o acesso completo às funcionalidades (geração de propostas, contratos, vistorias e documentos),
         basta contratar novamente pelo botão abaixo.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Em caso de dúvidas, fale conosco pelo WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Assinar novamente',
    ),
    whatsapp:
      `*SolarDoc Pro — Assinatura cancelada*\n\n${oi}\n\n` +
      `Após 5 dias sem regularização, sua assinatura foi *cancelada* e a conta voltou para o plano gratuito. ` +
      `Seu histórico permanece preservado.\n\n` +
      `Para retomar o acesso completo, basta assinar novamente:\n${CHECKOUT_URL}\n\n` +
      `Estamos à disposição.`,
  };
}

function tplRecovered(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Pagamento confirmado — assinatura regularizada',
    html: emailShell(
      'Tudo certo, pagamento confirmado',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Confirmamos o recebimento do pagamento da sua assinatura SolarDoc Pro.
         Sua conta está totalmente regularizada e o acesso a todas as funcionalidades segue normal.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Obrigado pela confiança.
       </p>`,
      'Acessar plataforma',
    ),
    whatsapp:
      `*SolarDoc Pro — Pagamento confirmado*\n\n${oi}\n\n` +
      `Confirmamos o recebimento do pagamento da sua assinatura. ` +
      `Sua conta está regularizada e o acesso a todas as funcionalidades segue normal.\n\n` +
      `Obrigado pela confiança.`,
  };
}

function emailShell(headline: string, body: string, ctaLabel: string): string {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
      <div style="background:#f59e0b;padding:28px 36px;">
        <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
        <h1 style="margin:8px 0 0;color:#0f172a;font-size:22px;font-weight:900;line-height:1.25;">${headline}</h1>
      </div>
      <div style="padding:32px 36px 36px;">
        ${body}
        <div style="margin-top:8px;">
          <a href="${BILLING_URL}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;">${ctaLabel}</a>
        </div>
      </div>
    </div>`;
}

const TEMPLATES: Record<number, (nome: string | null) => DunningTemplate> = {
  0: tplD0,
  1: tplD1,
  2: tplD2,
  3: tplD3,
  4: tplD4,
  5: tplD5,
};

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  // Transacional (não-marketing): sem footer de unsubscribe — é aviso de cobrança,
  // o usuário não pode optar por não receber. Sempre que tem cobrança em aberto,
  // tem direito (e dever) de ser avisado.
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    replyTo: REPLY_TO,
    subject,
    html,
  });
  if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
}

async function sendDayNotification(
  user: { id: string; email: string; nome: string | null; whatsapp: string | null },
  day: number,
): Promise<void> {
  const tplFn = TEMPLATES[day];
  if (!tplFn) return;
  const tpl = tplFn(user.nome);

  const tasks: Array<Promise<void>> = [];
  tasks.push(
    sendEmail(user.email, tpl.subject, tpl.html).catch(err => {
      logger.error('dunning', `email D${day} falhou pra ${user.email}`, err);
    }),
  );
  if (user.whatsapp) {
    tasks.push(
      sendWhatsApp(user.whatsapp, tpl.whatsapp).catch(err => {
        logger.error('dunning', `whatsapp D${day} falhou pra ${user.whatsapp}`, err);
      }),
    );
  }
  await Promise.allSettled(tasks);
}

// Chamado direto pelo webhook quando invoice.payment_failed dispara — envia D0
// na hora, em vez de esperar o cron do dia seguinte.
export async function sendDunningDay0(userId: string): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp')
    .eq('id', userId)
    .single();
  if (!user) return;
  await sendDayNotification(user, 0);
  await supabase
    .from('users')
    .update({ dunning_last_day_sent: 0 })
    .eq('id', userId);
}

// Enviado pelo webhook quando invoice.payment_succeeded em conta que estava
// inadimplente — confirma regularização.
export async function sendDunningRecovered(userId: string): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp')
    .eq('id', userId)
    .single();
  if (!user) return;
  const tpl = tplRecovered(user.nome);
  const tasks: Array<Promise<void>> = [];
  tasks.push(
    sendEmail(user.email, tpl.subject, tpl.html).catch(err => {
      logger.error('dunning', `email recuperação falhou pra ${user.email}`, err);
    }),
  );
  if (user.whatsapp) {
    tasks.push(
      sendWhatsApp(user.whatsapp, tpl.whatsapp).catch(err => {
        logger.error('dunning', `whatsapp recuperação falhou pra ${user.whatsapp}`, err);
      }),
    );
  }
  await Promise.allSettled(tasks);
}

// Cancela TODAS subs ativas/past_due desse email no Stripe. Idempotente —
// se já estiver canceled, Stripe retorna sem efeito. Chamado no D5.
async function cancelStripeSubsForEmail(email: string): Promise<number> {
  let canceled = 0;
  try {
    const customers = await stripe.customers.list({ email, limit: 5 });
    for (const cust of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: cust.id, status: 'all', limit: 20 });
      for (const s of subs.data) {
        if (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'unpaid') {
          await stripe.subscriptions.cancel(s.id, { invoice_now: false, prorate: false });
          canceled++;
        }
      }
    }
  } catch (err) {
    logger.error('dunning', `cancelStripeSubsForEmail falhou pra ${email}`, err);
  }
  return canceled;
}

// Cron diário (chamado pelo master) — varre contas past_due e dispara avisos
// D1/D2/D3/D4 e CANCELA+notifica no D5.
export async function runDunning(): Promise<{ scanned: number; notified: number; canceled: number }> {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, past_due_since, dunning_last_day_sent, billing_status')
    .in('billing_status', ['past_due', 'suspended'])
    .not('past_due_since', 'is', null);

  if (error) {
    logger.error('dunning', 'query falhou', error);
    return { scanned: 0, notified: 0, canceled: 0 };
  }

  let notified = 0;
  let canceled = 0;
  const now = Date.now();

  for (const u of users ?? []) {
    const past = u.past_due_since ? new Date(u.past_due_since).getTime() : 0;
    if (!past) continue;
    const daysElapsed = Math.floor((now - past) / 86_400_000);
    const lastSent = (u.dunning_last_day_sent ?? -1) as number;

    // Encontra o maior dia (0..5) que já passou e ainda não foi notificado.
    // D0 normalmente já foi enviado pelo webhook; mas se por algum motivo não foi
    // (ex: webhook falhou), o cron pega no dia seguinte.
    const milestones = [0, 1, 2, 3, 4, 5];
    let dayToSend: number | null = null;
    for (const d of milestones) {
      if (daysElapsed >= d && d > lastSent) dayToSend = d;
    }
    if (dayToSend === null) continue;

    // Dia 5 → cancela sub no Stripe + rebaixa pra free ANTES de notificar
    // (pra mensagem refletir o novo estado).
    if (dayToSend === 5) {
      const cancelCount = await cancelStripeSubsForEmail(u.email);
      await supabase
        .from('users')
        .update({
          plano: 'free',
          limite_documentos: FREE_LIMIT,
          documentos_usados: 0,
          billing_status: 'active',  // não está mais cobrando — é só free
          past_due_since: null,
          dunning_last_day_sent: 5,  // marca pra não reenviar
        })
        .eq('id', u.id);
      canceled++;
      logger.info('dunning', `${u.email}: D5 — ${cancelCount} subs canceladas no Stripe + rebaixado pra free`);
    }

    await sendDayNotification(u, dayToSend);

    // Pro D5 já atualizamos acima junto com o cancel. Pros outros dias só carimba o último enviado.
    if (dayToSend !== 5) {
      await supabase
        .from('users')
        .update({ dunning_last_day_sent: dayToSend })
        .eq('id', u.id);
    }
    notified++;
  }

  return { scanned: users?.length ?? 0, notified, canceled };
}
