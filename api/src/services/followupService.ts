import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { sendFollowupEmail, sendNoContractsReminderEmail, sendCnpjOngoingEmail, sendCheckoutRecoveryEmail, sendCheckoutCompletionEmail } from '../utils/mailer';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');
const DAY_MS = 24 * 60 * 60 * 1000;

// Idempotência: só envia se o último email foi há ≥ 23h
const MIN_GAP_MS = 23 * 60 * 60 * 1000;

// Cadência CNPJ (refatorada 2026-05-21): 13 emails ao longo de 365 dias.
// Foco no Gerador de Proposta Personalizado. Disparada às 8h30 BRT.
// Audiência: usuários sem CNPJ (não-ativos na plataforma).
const CNPJ_SCHEDULE: ReadonlyArray<{ day: number; kind: 'onboarding' | 'ongoing'; idx: number }> = [
  { day: 1,   kind: 'onboarding', idx: 1 },  // Hook: novidade Gerador de Proposta
  { day: 3,   kind: 'onboarding', idx: 2 },  // Pain: R$ 200/mês em gerador, aqui vem incluso
  { day: 12,  kind: 'onboarding', idx: 3 },  // Features: logo, cor, portfólio
  { day: 20,  kind: 'onboarding', idx: 4 },  // Equipamentos: aberto a todos do mercado
  { day: 35,  kind: 'onboarding', idx: 5 },  // Marco 35 dias: ativar gratuitamente
  { day: 50,  kind: 'onboarding', idx: 6 },  // Case: integradores fechando mais
  { day: 75,  kind: 'onboarding', idx: 7 },  // Marco 75 dias: vai deixar o mercado passar?
  { day: 100, kind: 'ongoing',    idx: 1 },  // Ongoing: CNPJ ainda não foi cadastrado
  { day: 125, kind: 'ongoing',    idx: 2 },  // Ongoing: contrato no Word
  { day: 180, kind: 'ongoing',    idx: 3 },  // Ongoing: 10 docs grátis te esperam
  { day: 260, kind: 'ongoing',    idx: 4 },  // Ongoing: novidades
  { day: 320, kind: 'ongoing',    idx: 5 },  // Ongoing: concorrente já automatizou
  { day: 365, kind: 'ongoing',    idx: 6 },  // Ongoing: cicla pra idx 0 via modulo
];

const CNPJ_HORIZON_DAYS = 365;

function scheduledForDay(day: number): { kind: 'onboarding' | 'ongoing'; idx: number } | null {
  const entry = CNPJ_SCHEDULE.find(e => e.day === day);
  if (!entry) return null;
  return { kind: entry.kind, idx: entry.idx };
}

export async function runFollowupCnpj(): Promise<{ sent: number; skipped: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: users } = await supabase
    .from('users')
    .select('id, email, created_at, followup_started_at, followup_email_last_sent_at, followup_abandoned, email_opt_out, checkout_recovery_sent_at')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .or(`followup_started_at.not.is.null,created_at.gte.${FOLLOWUP_START.toISOString()}`);

  if (!users || users.length === 0) return { sent: 0, skipped: 0 };

  const now = new Date();
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.email_opt_out) { skipped++; continue; }
    if (user.followup_abandoned) { skipped++; continue; }
    // Recebeu o email específico de abandono de checkout → não duplica com email genérico de CNPJ.
    if (user.checkout_recovery_sent_at) { skipped++; continue; }

    const baseDate = user.followup_started_at
      ? new Date((user.followup_started_at as string).replace(' ', 'T') + 'Z')
      : new Date((user.created_at as string).replace(' ', 'T') + 'Z');

    const day = Math.floor((now.getTime() - baseDate.getTime()) / DAY_MS) + 1;

    if (day < 1 || day > CNPJ_HORIZON_DAYS) { skipped++; continue; }

    const scheduled = scheduledForDay(day);
    if (!scheduled) { skipped++; continue; }

    if (user.followup_email_last_sent_at) {
      const last = new Date((user.followup_email_last_sent_at as string).replace(' ', 'T') + 'Z');
      if (now.getTime() - last.getTime() < MIN_GAP_MS) { skipped++; continue; }
    }

    try {
      if (scheduled.kind === 'onboarding') {
        await sendFollowupEmail(user.email, user.id, scheduled.idx);
      } else {
        await sendCnpjOngoingEmail(user.email, user.id, scheduled.idx);
      }
      const updates: any = { followup_email_last_sent_at: now.toISOString() };
      if (day === 1 && !user.followup_started_at) updates.followup_started_at = now.toISOString();
      await supabase.from('users').update(updates).eq('id', user.id);
      sent++;
    } catch (err) {
      console.error(`Followup email failed for ${user.email} day ${day}:`, err);
    }
  }

  return { sent, skipped };
}

export async function stampFollowupStarted(): Promise<{ stamped: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: users } = await supabase
    .from('users')
    .select('id')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .is('followup_started_at', null);

  if (!users || users.length === 0) return { stamped: 0 };

  const now = new Date().toISOString();
  let stamped = 0;
  for (const user of users) {
    const { error } = await supabase.from('users').update({ followup_started_at: now }).eq('id', user.id);
    if (!error) stamped++;
  }
  return { stamped };
}

export async function blastFollowupDay1(): Promise<{ sent: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: users } = await supabase
    .from('users')
    .select('id, email, email_opt_out')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)');

  if (!users || users.length === 0) return { sent: 0 };

  const now = new Date().toISOString();
  let sent = 0;
  for (const user of users) {
    if (user.email_opt_out) continue;
    try {
      await sendFollowupEmail(user.email, user.id, 1);
      await supabase.from('users').update({
        followup_started_at: now,
        followup_email_last_sent_at: now,
      }).eq('id', user.id);
      sent++;
    } catch (err) {
      console.error(`Blast email failed for ${user.email}:`, err);
    }
  }
  return { sent };
}

// ─── lembrete por email para usuários com empresa, sem documento recente ─
// Cadência decrescente: gap 7 → 14 → 30 → 60 → 90 dias.
// Para após 5 reminders (contract_reminder_count >= 5).

const REMINDER_GAPS_DAYS = [7, 14, 30, 60, 90];
const MAX_REMINDERS = REMINDER_GAPS_DAYS.length;
const FIRST_REMINDER_AFTER_DAYS = 7; // só lembra se faz 7+ dias sem doc

function reminderGapMs(count: number): number {
  return REMINDER_GAPS_DAYS[Math.min(count, REMINDER_GAPS_DAYS.length - 1)] * DAY_MS;
}

export async function runNoContractsEmailReminder(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();

  const { data: companies } = await supabase.from('company').select('user_id');
  const companyUserIds = (companies ?? []).map((c: any) => c.user_id).filter(Boolean);
  if (!companyUserIds.length) return { sent: 0, skipped: 0 };

  const { data: candidates } = await supabase
    .from('users')
    .select('id, email, nome, created_at, contract_reminder_last_sent_at, contract_reminder_count, email_opt_out')
    .in('id', companyUserIds);

  if (!candidates || candidates.length === 0) return { sent: 0, skipped: 0 };

  const { data: docs } = await supabase
    .from('documents')
    .select('user_id, created_at')
    .in('user_id', companyUserIds)
    .order('created_at', { ascending: false });

  const lastDocByUser = new Map<string, Date>();
  for (const d of docs ?? []) {
    if (!lastDocByUser.has(d.user_id)) {
      lastDocByUser.set(d.user_id, new Date((d.created_at as string).replace(' ', 'T') + 'Z'));
    }
  }

  let sent = 0;
  let skipped = 0;

  for (const u of candidates) {
    if (!u.email) { skipped++; continue; }
    if (u.email_opt_out) { skipped++; continue; }

    const count = (u.contract_reminder_count as number | null) ?? 0;
    if (count >= MAX_REMINDERS) { skipped++; continue; }

    const lastDoc = lastDocByUser.get(u.id);
    const lastDocAgeMs = lastDoc ? now.getTime() - lastDoc.getTime() : Infinity;
    if (lastDocAgeMs < FIRST_REMINDER_AFTER_DAYS * DAY_MS) { skipped++; continue; }

    if (u.contract_reminder_last_sent_at) {
      const lastReminder = new Date((u.contract_reminder_last_sent_at as string).replace(' ', 'T') + 'Z');
      if (now.getTime() - lastReminder.getTime() < reminderGapMs(count)) { skipped++; continue; }
    }

    try {
      await sendNoContractsReminderEmail(u.email, u.id, (u.nome as string | null) ?? null, count);
      await supabase.from('users').update({
        contract_reminder_last_sent_at: now.toISOString(),
        contract_reminder_count: count + 1,
      }).eq('id', u.id);
      sent++;
    } catch (err) {
      console.error(`No-contracts reminder failed for ${u.email}:`, err);
    }
  }

  return { sent, skipped };
}

// ─── Abandono de checkout ─────────────────────────────────────────
// VSL → Cadastro → Stripe → /empresa. Quem fecha a aba na hora do
// cartão fica FREE. Esse fluxo manda 1 email "Faltou só o cartão" na
// janela 4-72h após signup, uma vez só.
//
// Detecção: user FREE criado nessa janela, SEM subscription no Stripe
// (qualquer status), opt-out=false, sem checkout_recovery_sent_at.
// O timestamp marca pra não repetir e pra runFollowupCnpj pular esse
// user (email genérico de CNPJ seria redundante).
export async function runCheckoutAbandonRecovery(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();
  const minAge = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();   // criou há ≥ 4h
  const maxAge = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();  // criou há ≤ 72h

  const { data: candidates } = await supabase
    .from('users')
    .select('id, email, email_opt_out, plano, created_at')
    .eq('plano', 'free')
    .eq('email_opt_out', false)
    .is('checkout_recovery_sent_at', null)
    .lte('created_at', minAge)
    .gte('created_at', maxAge);

  if (!candidates || candidates.length === 0) return { sent: 0, skipped: 0 };

  // Mapeia email → tem subscription no Stripe? Janela ampla pra cobrir todos
  // os candidates (que foram criados nas últimas 72h).
  const stripeEmails = new Set<string>();
  try {
    const sinceUnix = Math.floor(now.getTime() / 1000) - 5 * 86400; // 5d cobre janela + folga
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const subs = await stripe.subscriptions.list({
        created: { gte: sinceUnix },
        status: 'all',
        limit: 100,
        starting_after: cursor,
        expand: ['data.customer'],
      });
      for (const s of subs.data) {
        const cust = s.customer as { email?: string | null } | string;
        const email = typeof cust === 'string' ? null : (cust.email ?? null);
        if (email) stripeEmails.add(email.toLowerCase());
      }
      if (!subs.has_more) break;
      cursor = subs.data[subs.data.length - 1]?.id;
    }
  } catch (err) {
    console.error('runCheckoutAbandonRecovery: stripe lookup falhou — abortando pra evitar email errado:', err);
    return { sent: 0, skipped: candidates.length };
  }

  let sent = 0;
  let skipped = 0;

  for (const user of candidates) {
    if (stripeEmails.has(user.email.toLowerCase())) { skipped++; continue; }

    try {
      await sendCheckoutRecoveryEmail(user.email, user.id);
      await supabase
        .from('users')
        .update({ checkout_recovery_sent_at: now.toISOString() })
        .eq('id', user.id);
      sent++;
    } catch (err) {
      console.error(`Checkout recovery email failed for ${user.email}:`, err);
      skipped++;
    }
  }

  return { sent, skipped };
}

// ════════════════════════════════════════════════════════════════════
// REDE DE SEGURANÇA — checkout público SEM conta (PAGOU e NÃO cadastrou)
// ════════════════════════════════════════════════════════════════════
// Fluxo LP→Stripe→Cadastro: a sub trialing nasce no momento do pagamento,
// mas a conta em `users` só nasce quando a pessoa VOLTA e preenche o form.
// Quem fecha a aba paga e some (Lucas/Josefi/Ivan). O webhook NÃO pode
// avisar na hora (todo mundo está "sem conta" segundos após pagar — seria
// spam pra quem ainda vai cadastrar). Então este sweep roda periodicamente:
// pega subs públicas trialing/active criadas há ≥ GRACE (carência) e ≤ MAX,
// confirma que a conta AINDA não existe, e manda o link de conclusão.
// Idempotente via system_state (1 email por checkout). Pega passado e futuro.
const ORPHAN_GRACE_MS = 30 * 60 * 1000;            // só age após 30min (deu tempo de cadastrar)
const ORPHAN_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000; // até 6d (antes do trial de 7d virar cobrança)

// Lê os marcadores `orphan_checkout:{sessionId}` que o webhook gravou (email +
// plano + session_id já corretos — sem re-derivar do Stripe). Pra cada um que,
// passada a carência, AINDA não tem conta em `users`, manda o link de conclusão.
// Dedup só DEPOIS do envio confirmado (não queima a chave se falhar). NÃO conta
// como enviado quando não há session (não acontece: o marcador sempre tem uma).
// Backlog anterior ao marcador (Lucas/Josefi/Ivan) é recuperado manualmente.
export async function recoverOrphanCheckouts(): Promise<{ sent: number; skipped: number; scanned: number }> {
  const now = Date.now();
  const graceCutoff = now - ORPHAN_GRACE_MS;
  const maxAgeCutoff = now - ORPHAN_MAX_AGE_MS;

  const { data: markers } = await supabase
    .from('system_state')
    .select('key, value')
    .like('key', 'orphan_checkout:%')
    .limit(500);

  if (!markers?.length) return { sent: 0, skipped: 0, scanned: 0 };

  // Filtra por janela de carência (criado há ≥30min e ≤6d) e que ainda não foi enviado.
  type Marker = { sessionId: string; email: string; plano: string; createdMs: number };
  const pending: Marker[] = [];
  for (const m of markers) {
    const v = (m.value ?? {}) as { email?: string; plano?: string; session_id?: string; created_at?: string; sent_at?: string };
    if (v.sent_at) continue;                            // já enviado
    if (!v.email || !v.session_id) continue;
    const createdMs = v.created_at ? Date.parse(v.created_at) : 0;
    if (!createdMs || createdMs > graceCutoff) continue; // dentro da carência
    if (createdMs < maxAgeCutoff) continue;              // velho demais (trial já virou cobrança/cancelou)
    pending.push({ sessionId: v.session_id, email: v.email.toLowerCase(), plano: v.plano || 'pro', createdMs });
  }

  if (!pending.length) return { sent: 0, skipped: 0, scanned: markers.length };

  // Quem desses JÁ criou conta? (voltou e cadastrou) — não é mais órfão.
  const emails = Array.from(new Set(pending.map(p => p.email)));
  const { data: existingUsers } = await supabase.from('users').select('email').in('email', emails);
  const hasAccount = new Set((existingUsers ?? []).map(u => (u.email || '').toLowerCase()));

  let sent = 0, skipped = 0;
  for (const p of pending) {
    if (hasAccount.has(p.email)) { skipped++; continue; }
    try {
      await sendCheckoutCompletionEmail({ to: p.email, sessionId: p.sessionId, plano: p.plano });
      // Marca enviado SÓ após sucesso (não queima a chave em caso de falha).
      await supabase
        .from('system_state')
        .update({ key: `orphan_checkout:${p.sessionId}`, value: { email: p.email, plano: p.plano, session_id: p.sessionId, created_at: new Date(p.createdMs).toISOString(), sent_at: new Date(now).toISOString() } })
        .eq('key', `orphan_checkout:${p.sessionId}`);
      sent++;
    } catch (err) {
      console.error(`recoverOrphanCheckouts: email falhou pra ${p.email}:`, err);
      skipped++;
    }
  }

  return { sent, skipped, scanned: pending.length };
}
