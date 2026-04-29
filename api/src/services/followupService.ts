import { supabase } from '../utils/supabase';
import { sendFollowupEmail, sendNoContractsReminderEmail, sendCnpjOngoingEmail } from '../utils/mailer';

const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');
const DAY_MS = 24 * 60 * 60 * 1000;

// Idempotência: só envia se o último email foi há ≥ 23h
const MIN_GAP_MS = 23 * 60 * 60 * 1000;

// Cadência CNPJ: 9 emails ao longo de 180 dias (densidade no início, espaçamento depois)
// Dias 1-7 usam followupEmails (templates 1-7); dias 60+ usam cnpjOngoingEmails
const CNPJ_SCHEDULE: ReadonlyArray<{ day: number; kind: 'onboarding' | 'ongoing'; idx: number }> = [
  { day: 1,   kind: 'onboarding', idx: 1 },
  { day: 2,   kind: 'onboarding', idx: 2 },
  { day: 4,   kind: 'onboarding', idx: 3 },
  { day: 7,   kind: 'onboarding', idx: 4 },
  { day: 14,  kind: 'onboarding', idx: 5 },
  { day: 30,  kind: 'onboarding', idx: 6 },
  { day: 60,  kind: 'onboarding', idx: 7 },
  { day: 90,  kind: 'ongoing',    idx: 0 },
  { day: 180, kind: 'ongoing',    idx: 1 },
];

const CNPJ_HORIZON_DAYS = 180;

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
    .select('id, email, created_at, followup_started_at, followup_email_last_sent_at, followup_abandoned, email_opt_out')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .or(`followup_started_at.not.is.null,created_at.gte.${FOLLOWUP_START.toISOString()}`);

  if (!users || users.length === 0) return { sent: 0, skipped: 0 };

  const now = new Date();
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.email_opt_out) { skipped++; continue; }
    if (user.followup_abandoned) { skipped++; continue; }

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
