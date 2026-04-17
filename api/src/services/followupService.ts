import { supabase } from '../utils/supabase';
import { sendFollowupEmail } from '../utils/mailer';

// Apenas usuários cadastrados após o início do sistema de followup
const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');

export async function runFollowupCnpj(): Promise<{ sent: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  // Busca usuários sem CNPJ que têm followup_started_at OU cadastraram após FOLLOWUP_START
  const { data: users } = await supabase
    .from('users')
    .select('id, email, created_at, followup_started_at')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .or(`followup_started_at.not.is.null,created_at.gte.${FOLLOWUP_START.toISOString()}`);

  if (!users || users.length === 0) return { sent: 0 };

  const now = new Date();
  let sent = 0;

  for (const user of users) {
    // Usa followup_started_at se disponível, senão usa created_at
    const baseDate = user.followup_started_at
      ? new Date(user.followup_started_at)
      : new Date(user.created_at);

    const diffMs = now.getTime() - baseDate.getTime();
    const day = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;

    if (day >= 1 && day <= 7) {
      try {
        await sendFollowupEmail(user.email, day);
        // Marca início na primeira vez (dia 1)
        if (day === 1 && !user.followup_started_at) {
          await supabase.from('users').update({ followup_started_at: now.toISOString() }).eq('id', user.id);
        }
        sent++;
      } catch (err) {
        console.error(`Followup email failed for ${user.email} day ${day}:`, err);
      }
    }
  }

  return { sent };
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
      // Marca o início da sequência para calcular os próximos dias corretamente
      await supabase.from('users').update({ followup_started_at: now }).eq('id', user.id);
      sent++;
    } catch (err) {
      console.error(`Blast email failed for ${user.email}:`, err);
    }
  }
  return { sent };
}
