import { supabase } from '../utils/supabase';
import { sendFollowupEmail } from '../utils/mailer';

// Apenas usuários cadastrados após o início do sistema de followup
const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');

export async function runFollowupCnpj(): Promise<{ sent: number }> {
  const { data: usersWithCompany } = await supabase
    .from('company')
    .select('user_id');

  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: users } = await supabase
    .from('users')
    .select('id, email, created_at')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .gte('created_at', FOLLOWUP_START.toISOString())
    .lte('created_at', new Date(Date.now() - 0).toISOString());

  if (!users || users.length === 0) return { sent: 0 };

  const now = new Date();
  let sent = 0;

  for (const user of users) {
    const createdAt = new Date(user.created_at);
    const diffMs = now.getTime() - createdAt.getTime();
    const day = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;

    if (day >= 1 && day <= 7) {
      await sendFollowupEmail(user.email, day);
      sent++;
    }
  }

  return { sent };
}
