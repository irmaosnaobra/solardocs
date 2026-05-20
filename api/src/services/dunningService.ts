// Dunning de inadimplência — 7 dias de tolerância após falha de cobrança.
//
// Fluxo:
//   D0: invoice.payment_failed (webhook) → marca past_due_since, envia D0 imediato
//   D2/D4/D6: cron diário envia lembretes (acesso mantido)
//   D7: cron diário muda billing_status='suspended' + envia último aviso
//   Stripe Smart Retries continua tentando em paralelo. Se cair
//   invoice.payment_succeeded em qualquer dia, billing_status volta pra 'active'.

import { supabase } from '../utils/supabase';
import { Resend } from 'resend';
import { sendWhatsApp } from './agents/zapiClient';
import { logger } from '../utils/logger';

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const FROM_EMAIL = process.env.MAIL_FROM || 'SolarDoc Pro <equipe@solardoc.app>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'aiorosgroup@gmail.com';

const SUPPORT_PHONE_LABEL = '(34) 99943-7831';
const BILLING_URL = `${APP_URL}/conta`;

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
         <strong>Seu acesso à plataforma continua ativo nos próximos 7 dias.</strong>
         Pedimos a gentileza de atualizar os dados de pagamento dentro desse prazo para evitar a suspensão da conta.
       </p>`,
      'Atualizar forma de pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Aviso de cobrança*\n\n${oi}\n\n` +
      `A cobrança da sua assinatura SolarDoc Pro não foi processada com sucesso. ` +
      `Seu acesso continua liberado pelos próximos 7 dias.\n\n` +
      `Por favor, atualize os dados de pagamento para evitar a suspensão:\n${BILLING_URL}\n\n` +
      `Em caso de dúvidas, estamos à disposição.`,
  };
}

function tplD2(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Lembrete: pagamento da sua assinatura SolarDoc Pro',
    html: emailShell(
      'Lembrete de pagamento pendente',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Há 2 dias identificamos uma falha na cobrança da sua assinatura e o pagamento ainda não foi regularizado.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Faltam <strong>5 dias</strong> para a suspensão automática da conta.
         A atualização leva menos de 1 minuto.
       </p>`,
      'Atualizar forma de pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Lembrete*\n\n${oi}\n\n` +
      `Há 2 dias identificamos uma falha na cobrança da sua assinatura e o pagamento ainda não foi regularizado.\n\n` +
      `*Faltam 5 dias para a suspensão automática da conta.*\n\n` +
      `Atualize os dados de pagamento em:\n${BILLING_URL}`,
  };
}

function tplD4(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Atenção: faltam 3 dias para a suspensão da sua conta',
    html: emailShell(
      'Pagamento pendente — atenção necessária',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         A cobrança da sua assinatura SolarDoc Pro segue pendente. Já se passaram 4 dias desde a primeira falha.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         <strong>Faltam apenas 3 dias para a suspensão automática da conta.</strong>
         Após a suspensão, o acesso à geração de documentos será bloqueado até a regularização do pagamento.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Caso precise de auxílio com a atualização, entre em contato pelo WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Regularizar pagamento agora',
    ),
    whatsapp:
      `*SolarDoc Pro — Atenção*\n\n${oi}\n\n` +
      `A cobrança da sua assinatura segue pendente. Já se passaram 4 dias desde a primeira falha.\n\n` +
      `*Faltam apenas 3 dias para a suspensão automática da conta.*\n\n` +
      `Após a suspensão, o acesso à plataforma será bloqueado até a regularização.\n\n` +
      `Regularize em:\n${BILLING_URL}\n\n` +
      `Caso precise de auxílio, responda esta mensagem.`,
  };
}

function tplD6(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Último aviso — sua conta será suspensa amanhã',
    html: emailShell(
      'Último aviso antes da suspensão',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Este é o último aviso antes da suspensão da sua conta SolarDoc Pro.
         A cobrança da sua assinatura permanece pendente há 6 dias.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         <strong>A suspensão ocorrerá amanhã, caso o pagamento não seja regularizado até lá.</strong>
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Para qualquer dificuldade na atualização do cartão, nossa equipe está disponível no WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Regularizar pagamento',
    ),
    whatsapp:
      `*SolarDoc Pro — Último aviso*\n\n${oi}\n\n` +
      `Este é o último aviso antes da suspensão da sua conta. ` +
      `A cobrança permanece pendente há 6 dias.\n\n` +
      `*A suspensão ocorrerá amanhã, caso o pagamento não seja regularizado até lá.*\n\n` +
      `Regularize em:\n${BILLING_URL}\n\n` +
      `Estamos à disposição para auxiliar.`,
  };
}

function tplD7(nome: string | null): DunningTemplate {
  const oi = nome ? `Prezado(a) ${nome.split(' ')[0]},` : 'Prezado(a) cliente,';
  return {
    subject: 'Sua conta SolarDoc Pro foi suspensa',
    html: emailShell(
      'Conta suspensa por falta de pagamento',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Após 7 dias sem a regularização do pagamento, sua conta SolarDoc Pro foi <strong>suspensa</strong>.
         A geração de documentos e demais funcionalidades da plataforma estão temporariamente bloqueadas.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         <strong>Boa notícia:</strong> a reativação é imediata. Basta atualizar a forma de pagamento e
         sua conta volta a funcionar normalmente, com todo o seu histórico preservado.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Em caso de dúvidas, entre em contato pelo WhatsApp ${SUPPORT_PHONE_LABEL}.
       </p>`,
      'Reativar minha conta',
    ),
    whatsapp:
      `*SolarDoc Pro — Conta suspensa*\n\n${oi}\n\n` +
      `Após 7 dias sem a regularização do pagamento, sua conta foi *suspensa*. ` +
      `As funcionalidades da plataforma estão temporariamente bloqueadas.\n\n` +
      `*A reativação é imediata.* Atualize a forma de pagamento e sua conta volta a funcionar com todo o histórico preservado:\n${BILLING_URL}\n\n` +
      `Estamos à disposição para auxiliar.`,
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
  2: tplD2,
  4: tplD4,
  6: tplD6,
  7: tplD7,
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

// Cron diário (chamado pelo master) — varre contas past_due e dispara avisos
// nos dias 2/4/6 e suspende+notifica no dia 7.
export async function runDunning(): Promise<{ scanned: number; notified: number; suspended: number }> {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, past_due_since, dunning_last_day_sent, billing_status')
    .in('billing_status', ['past_due', 'suspended'])
    .not('past_due_since', 'is', null);

  if (error) {
    logger.error('dunning', 'query falhou', error);
    return { scanned: 0, notified: 0, suspended: 0 };
  }

  let notified = 0;
  let suspended = 0;
  const now = Date.now();

  for (const u of users ?? []) {
    const past = u.past_due_since ? new Date(u.past_due_since).getTime() : 0;
    if (!past) continue;
    const daysElapsed = Math.floor((now - past) / 86_400_000);
    const lastSent = (u.dunning_last_day_sent ?? -1) as number;

    // Encontra o maior dia (0/2/4/6/7) que já passou e ainda não foi notificado.
    // D0 normalmente já foi enviado pelo webhook; mas se por algum motivo não foi
    // (ex: webhook falhou), o cron pega no dia seguinte.
    const milestones = [0, 2, 4, 6, 7];
    let dayToSend: number | null = null;
    for (const d of milestones) {
      if (daysElapsed >= d && d > lastSent) dayToSend = d;
    }
    if (dayToSend === null) continue;

    // Dia 7 → suspende ANTES de notificar (pra mensagem refletir o novo estado)
    if (dayToSend === 7 && u.billing_status !== 'suspended') {
      await supabase
        .from('users')
        .update({ billing_status: 'suspended' })
        .eq('id', u.id);
      suspended++;
    }

    await sendDayNotification(u, dayToSend);
    await supabase
      .from('users')
      .update({ dunning_last_day_sent: dayToSend })
      .eq('id', u.id);
    notified++;
  }

  return { scanned: users?.length ?? 0, notified, suspended };
}
