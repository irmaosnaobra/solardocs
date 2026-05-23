// Winback de cancelados — recupera clientes que cancelaram a assinatura
// (saíram via D5 do dunning OU cancelaram voluntariamente via portal Stripe).
//
// Fluxo:
//   D+7  após cancelamento: 1 email "perdeu algo?", tom leve
//   D+30 após cancelamento: 1 email final "porta aberta"
//
// Email-only. SEM WhatsApp — quem cancelou saiu consciente, WhatsApp = risco de
// ban Z-API + percepção de spam. Idempotente via winback_d7_sent_at / winback_d30_sent_at.

import { supabase } from '../utils/supabase';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { logger } from '../utils/logger';

const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const FROM_EMAIL = process.env.MAIL_FROM || 'SolarDoc Pro <equipe@solardoc.app>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'aiorosgroup@gmail.com';
const CHECKOUT_URL = `${APP_URL}/`;

interface WinbackTemplate {
  subject: string;
  html: string;
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
          <a href="${CHECKOUT_URL}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;">${ctaLabel}</a>
        </div>
      </div>
    </div>`;
}

function tplD7(nome: string | null): WinbackTemplate {
  const oi = nome ? `Olá ${nome.split(' ')[0]},` : 'Olá,';
  return {
    subject: 'Faltou alguma coisa na sua experiência?',
    html: emailShell(
      'Sentimos sua falta',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Notamos que sua assinatura SolarDoc Pro foi cancelada há uma semana e queríamos entender:
         <strong>faltou alguma coisa?</strong>
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Estamos sempre evoluindo a plataforma — novos modelos de proposta, mais automações,
         integrações com bancos. Seu feedback ajuda a definir o que entra primeiro.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Se quiser conversar, basta responder este email. Se preferir retomar agora, sua conta e
         histórico continuam disponíveis — é só assinar novamente.
       </p>`,
      'Voltar para o SolarDoc Pro',
    ),
  };
}

function tplD30(nome: string | null): WinbackTemplate {
  const oi = nome ? `Olá ${nome.split(' ')[0]},` : 'Olá,';
  return {
    subject: 'A porta continua aberta no SolarDoc Pro',
    html: emailShell(
      'Quando quiser voltar, é só clicar',
      `<p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${oi}</p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         Faz cerca de um mês desde que sua assinatura SolarDoc Pro foi cancelada.
         Esta é a última vez que vamos lembrar — não queremos virar spam.
       </p>
       <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 18px;">
         A porta continua aberta. Seu cadastro, sua empresa e todos os documentos gerados
         permanecem na plataforma. Se um dia precisar voltar, é literalmente um clique.
       </p>
       <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 18px;">
         Obrigado por ter usado o SolarDoc Pro.
       </p>`,
      'Reativar minha conta',
    ),
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    replyTo: REPLY_TO,
    subject,
    html,
  });
  if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
}

// Varre TODAS subs canceladas no Stripe (paginado), monta mapa
// email_lower → canceled_at mais recente. Usado pra alimentar last_canceled_at
// e disparar os emails D+7 e D+30.
async function fetchCanceledByEmail(): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  let cursor: string | undefined;

  for (let page = 0; page < 50; page++) {
    const subs = await stripe.subscriptions.list({
      status: 'canceled',
      limit: 100,
      starting_after: cursor,
      expand: ['data.customer'],
    });

    for (const s of subs.data) {
      const cust = s.customer as { email?: string | null } | string;
      const email = typeof cust === 'string' ? null : (cust.email ?? null);
      if (!email) continue;
      if (!s.canceled_at) continue;

      const key = email.toLowerCase();
      const dt = new Date(s.canceled_at * 1000);
      const existing = map.get(key);
      // Guarda o MAIS RECENTE — se cara cancelou e voltou várias vezes, conta o último.
      if (!existing || dt > existing) map.set(key, dt);
    }

    if (!subs.has_more) break;
    cursor = subs.data[subs.data.length - 1]?.id;
  }

  return map;
}

export async function runWinback(): Promise<{
  scanned: number; d7_sent: number; d30_sent: number; errors: number;
}> {
  let d7_sent = 0, d30_sent = 0, errors = 0;

  let canceledMap: Map<string, Date>;
  try {
    canceledMap = await fetchCanceledByEmail();
  } catch (err) {
    logger.error('winback', 'fetchCanceledByEmail falhou', err);
    throw err;
  }

  if (canceledMap.size === 0) {
    return { scanned: 0, d7_sent: 0, d30_sent: 0, errors: 0 };
  }

  // Pega só users que estão free agora (não faz sentido mandar winback pra
  // quem voltou a assinar) e que apareceram em alguma sub cancelada.
  const emails = Array.from(canceledMap.keys());
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, plano, winback_d7_sent_at, winback_d30_sent_at, last_canceled_at')
    .eq('plano', 'free')
    .in('email', emails);

  if (error || !users) {
    logger.error('winback', 'query users falhou', error);
    throw error ?? new Error('users null');
  }

  const now = Date.now();
  const scanned = users.length;

  for (const u of users) {
    const canceledAt = canceledMap.get(u.email.toLowerCase());
    if (!canceledAt) continue;

    // Mantém last_canceled_at em sincronia (best-effort, só atualiza se mudou).
    if (!u.last_canceled_at || new Date(u.last_canceled_at).getTime() !== canceledAt.getTime()) {
      await supabase
        .from('users')
        .update({ last_canceled_at: canceledAt.toISOString() })
        .eq('id', u.id);
    }

    const daysSince = Math.floor((now - canceledAt.getTime()) / 86_400_000);

    // D+7: janela 7-29 dias, ainda não enviado.
    if (daysSince >= 7 && daysSince < 30 && !u.winback_d7_sent_at) {
      const tpl = tplD7(u.nome);
      try {
        await sendEmail(u.email, tpl.subject, tpl.html);
        await supabase
          .from('users')
          .update({ winback_d7_sent_at: new Date().toISOString() })
          .eq('id', u.id);
        d7_sent++;
        logger.info('winback', `D+7 enviado pra ${u.email} (${daysSince}d desde cancel)`);
      } catch (err) {
        errors++;
        logger.error('winback', `D+7 falhou pra ${u.email}`, err);
      }
      continue;
    }

    // D+30: a partir de 30d, ainda não enviado.
    if (daysSince >= 30 && !u.winback_d30_sent_at) {
      const tpl = tplD30(u.nome);
      try {
        await sendEmail(u.email, tpl.subject, tpl.html);
        await supabase
          .from('users')
          .update({ winback_d30_sent_at: new Date().toISOString() })
          .eq('id', u.id);
        d30_sent++;
        logger.info('winback', `D+30 enviado pra ${u.email} (${daysSince}d desde cancel)`);
      } catch (err) {
        errors++;
        logger.error('winback', `D+30 falhou pra ${u.email}`, err);
      }
    }
  }

  const summary = { scanned, d7_sent, d30_sent, errors };
  logger.info('winback', 'concluído', summary);
  return summary;
}
