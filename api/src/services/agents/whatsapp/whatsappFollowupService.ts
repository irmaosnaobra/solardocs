import { supabase } from '../../../utils/supabase';
import { sendZAPI } from '../zapiClient';
import { logger } from '../../../utils/logger';

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return '';
  return nome.trim().split(' ')[0];
}

// ─── Day-1: lembrete suave 20-48h após signup ────────────────────
// Dispara 1 vez só. Se cliente já respondeu antes, opt-out, ou ja recebeu o
// lembrete, é skipado. Se passou de 48h, deixa pra la (perdemos a janela natural).

export async function runWhatsappFollowup(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();
  const cutoffEarliest = new Date(now.getTime() - 48 * HOUR_MS).toISOString();
  const cutoffLatest   = new Date(now.getTime() - 20 * HOUR_MS).toISOString();

  const { data: candidates } = await supabase
    .from('users')
    .select('id, nome, whatsapp, whatsapp_opt_out, whatsapp_replied_at, whatsapp_reminder_sent_at, created_at')
    .not('whatsapp', 'is', null)
    .is('whatsapp_reminder_sent_at', null)
    .is('whatsapp_replied_at', null)
    .eq('whatsapp_opt_out', false)
    .gte('created_at', cutoffEarliest)
    .lte('created_at', cutoffLatest);

  if (!candidates || candidates.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0;
  let skipped = 0;

  for (const user of candidates) {
    if (!user.whatsapp) { skipped++; continue; }

    const nome = primeiroNome(user.nome as string | null);
    const saudacao = nome ? `Oi, ${nome}!` : 'Oi!';
    const msg = `${saudacao} Conseguiu testar a plataforma ontem? 🌞\n\nSe travou em algum passo me chama aqui que eu te ajudo. Sem pressa.\n\n${APP_URL}`;

    try {
      await sendZAPI(user.whatsapp, msg);
      await supabase.from('users').update({
        whatsapp_reminder_sent_at: now.toISOString(),
      }).eq('id', user.id);
      sent++;
    } catch (err) {
      logger.error('whatsapp-followup', `Erro ao enviar lembrete para ${user.id}`, err);
    }
  }

  return { sent, skipped };
}

// ─── Day-14: ping suave se ainda não gerou nenhum documento ──────
// 1x apenas. Não reenvia. Se respondeu em qualquer momento, ja foi filtrado.

export async function runInactiveEngagement(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();
  const minSignupAge = new Date(now.getTime() - 14 * DAY_MS).toISOString();

  const { data: companies } = await supabase.from('company').select('user_id');
  const companyUserIds = (companies ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: candidates } = await supabase
    .from('users')
    .select('id, nome, whatsapp, created_at, whatsapp_inactive_ping_sent_at')
    .not('whatsapp', 'is', null)
    .is('whatsapp_inactive_ping_sent_at', null)
    .is('whatsapp_replied_at', null)
    .eq('whatsapp_opt_out', false)
    .lte('created_at', minSignupAge);

  if (!candidates || candidates.length === 0) return { sent: 0, skipped: 0 };

  // Verifica quem nao gerou doc nenhum
  const userIds = candidates.map((c: any) => c.id);
  const { data: docs } = await supabase
    .from('documents')
    .select('user_id')
    .in('user_id', userIds)
    .limit(1000);
  const usersWithDocs = new Set((docs ?? []).map((d: any) => d.user_id));

  // Tambem precisa ter CNPJ (se nao tem CNPJ, ainda esta no flow inicial — nao escala)
  const companySet = new Set(companyUserIds);

  let sent = 0;
  let skipped = 0;

  for (const user of candidates) {
    if (!user.whatsapp) { skipped++; continue; }
    if (usersWithDocs.has(user.id)) { skipped++; continue; }
    if (!companySet.has(user.id)) { skipped++; continue; }

    const nome = primeiroNome(user.nome as string | null);
    const saudacao = nome ? `Oi, ${nome}!` : 'Oi!';
    const msg = `${saudacao} Tudo certo por ai? 😊\n\nSe precisar de uma maozinha pra gerar seu primeiro documento, me chama aqui. To por perto.`;

    try {
      await sendZAPI(user.whatsapp, msg);
      await supabase.from('users').update({
        whatsapp_inactive_ping_sent_at: now.toISOString(),
      }).eq('id', user.id);
      sent++;
    } catch (err) {
      logger.error('whatsapp-inactive', `Erro ao enviar ping para ${user.id}`, err);
    }
  }

  return { sent, skipped };
}
