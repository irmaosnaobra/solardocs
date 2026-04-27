import { supabase } from '../utils/supabase';
import { sendFollowupEmail, sendNoContractsReminderEmail, sendCnpjOngoingEmail } from '../utils/mailer';

const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');
const DAY_MS = 24 * 60 * 60 * 1000;

// Idempotência: só envia se o último email foi há ≥ 23h
const MIN_GAP_MS = 23 * 60 * 60 * 1000;

type CnpjPhase = 'daily' | 'weekly' | 'done';

function phaseForDay(day: number): CnpjPhase {
  if (day < 1 || day > 365) return 'done';
  if (day <= 10) return 'daily';
  return ((day - 10) % 7) === 0 ? 'weekly' : 'done';
}

// Para a fase diária (dia 1..10): cicla os 7 templates onboarding
function dailyTemplateForDay(day: number): number {
  return ((day - 1) % 7) + 1;
}

// Para a fase semanal: incrementa por envio (dia 17 = idx 0, dia 24 = idx 1, ...)
function weeklyVariantIdx(day: number): number {
  return Math.floor((day - 10) / 7) - 1;
}

export async function runFollowupCnpj(): Promise<{ sent: number; skipped: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: users } = await supabase
    .from('users')
    .select('id, email, created_at, followup_started_at, followup_email_last_sent_at')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .or(`followup_started_at.not.is.null,created_at.gte.${FOLLOWUP_START.toISOString()}`);

  if (!users || users.length === 0) return { sent: 0, skipped: 0 };

  const now = new Date();
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    const baseDate = user.followup_started_at
      ? new Date((user.followup_started_at as string).replace(' ', 'T') + 'Z')
      : new Date((user.created_at as string).replace(' ', 'T') + 'Z');

    const day = Math.floor((now.getTime() - baseDate.getTime()) / DAY_MS) + 1;
    const phase = phaseForDay(day);
    if (phase === 'done') { skipped++; continue; }

    if (user.followup_email_last_sent_at) {
      const last = new Date((user.followup_email_last_sent_at as string).replace(' ', 'T') + 'Z');
      if (now.getTime() - last.getTime() < MIN_GAP_MS) { skipped++; continue; }
    }

    try {
      if (phase === 'daily') {
        await sendFollowupEmail(user.email, dailyTemplateForDay(day));
      } else {
        await sendCnpjOngoingEmail(user.email, weeklyVariantIdx(day));
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
    .select('id, email')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)');

  if (!users || users.length === 0) return { sent: 0 };

  const now = new Date().toISOString();
  let sent = 0;
  for (const user of users) {
    try {
      await sendFollowupEmail(user.email, 1);
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

// ─── lembrete por email para usuários com empresa, sem documento há 3+ dias ─
// Envia 1x a cada 3 dias por até 1 ano após criar a conta.

const REMINDER_GAP_MS = 3 * DAY_MS;
const ONE_YEAR_MS = 365 * DAY_MS;

export async function runNoContractsEmailReminder(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();

  const { data: companies } = await supabase.from('company').select('user_id');
  const companyUserIds = (companies ?? []).map((c: any) => c.user_id).filter(Boolean);
  if (!companyUserIds.length) return { sent: 0, skipped: 0 };

  const { data: candidates } = await supabase
    .from('users')
    .select('id, email, nome, created_at, contract_reminder_last_sent_at')
    .in('id', companyUserIds);

  if (!candidates || candidates.length === 0) return { sent: 0, skipped: 0 };

  // Pega último documento por usuário em uma única query
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

    const created = new Date((u.created_at as string).replace(' ', 'T') + 'Z');
    if (now.getTime() - created.getTime() > ONE_YEAR_MS) { skipped++; continue; }

    const lastDoc = lastDocByUser.get(u.id);
    if (lastDoc && now.getTime() - lastDoc.getTime() < REMINDER_GAP_MS) { skipped++; continue; }

    if (u.contract_reminder_last_sent_at) {
      const lastReminder = new Date((u.contract_reminder_last_sent_at as string).replace(' ', 'T') + 'Z');
      if (now.getTime() - lastReminder.getTime() < REMINDER_GAP_MS) { skipped++; continue; }
    }

    // Variant cycling baseado em quantos dias desde a criação da conta
    const daysSinceSignup = Math.floor((now.getTime() - created.getTime()) / DAY_MS);
    const variantIdx = Math.floor(daysSinceSignup / 3);

    try {
      await sendNoContractsReminderEmail(u.email, (u.nome as string | null) ?? null, variantIdx);
      await supabase.from('users').update({
        contract_reminder_last_sent_at: now.toISOString(),
      }).eq('id', u.id);
      sent++;
    } catch (err) {
      console.error(`No-contracts reminder failed for ${u.email}:`, err);
    }
  }

  return { sent, skipped };
}
