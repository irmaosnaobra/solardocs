// ════════════════════════════════════════════════════════════
// CARLA — PERGUNTA-PÍLULA PRA QUEM NÃO TEM CNPJ
// ════════════════════════════════════════════════════════════
// Manda UMA mensagem curta e irresistível pra cada user que cadastrou
// na plataforma mas não preencheu CNPJ. Pergunta que o cérebro NÃO
// consegue ignorar — pede permissão ou força escolha binária.
//
// 3 versões rotativas (escolhe por hash do user_id pra ficar consistente
// se rodar de novo):
//  1. Pede permissão: "Posso te fazer 1 pergunta rapidinha?"
//  2. Direto ao ponto: "O que tá te travando pra cadastrar o CNPJ?"
//  3. Binária: "Travou no CNPJ ou ficou em dúvida sobre a plataforma?"
//
// Cada user só recebe UMA vez (killer_q_sent_at marca quem já recebeu).
// Endpoint /cron/carla-pergunta-cnpj é one-shot — disparo manual.
// ════════════════════════════════════════════════════════════

import { supabase } from '../../../utils/supabase';
import { sendZAPI } from '../zapiClient';
import { logger } from '../../../utils/logger';

const DELAY_BETWEEN_SENDS_MS = 20_000; // 20s — evita flag anti-spam Z-API/WA
const MAX_PER_BATCH = 12;              // 12 × 20s = 240s, cabe no maxDuration:300 do Vercel
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VARIACOES: ((nome: string) => string)[] = [
  (n) => `${n}, posso te fazer 1 pergunta rapidinha?\n\nO acesso continua aí: solardoc.app`,
  (n) => `Oi ${n}, o que tá te travando pra cadastrar o CNPJ?\n\nsolardoc.app`,
  (n) => `${n}, travou no CNPJ ou ficou em dúvida sobre a plataforma?\n\nsolardoc.app`,
];

function pickVariation(userId: string): number {
  // Hash determinístico simples — mesmo user sempre recebe mesma variação
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return Math.abs(h) % VARIACOES.length;
}

interface SemCnpjUser {
  id: string;
  nome?: string | null;
  email: string;
  whatsapp: string;
}

export async function runCarlaCnpjKillerBroadcast(): Promise<{ enviados: number; pulados: number; total: number; restantes: number }> {
  // Subquery: users sem CNPJ (LEFT JOIN company), com WhatsApp, sem opt-out,
  // sem killer_q_sent_at (não receberam ainda).
  const { data, error } = await supabase.rpc('select_users_killer_q_eligible');

  // Fallback caso a RPC não exista — query direta.
  let users: SemCnpjUser[] = [];
  if (error || !data) {
    const { data: rows } = await supabase
      .from('users')
      .select(`
        id,
        nome,
        email,
        whatsapp,
        whatsapp_opt_out,
        killer_q_sent_at,
        company:company(cnpj)
      `)
      .not('whatsapp', 'is', null)
      .neq('whatsapp', '')
      .is('killer_q_sent_at', null);

    type Row = { id: string; nome: string | null; email: string; whatsapp: string; whatsapp_opt_out?: boolean | null; company?: { cnpj?: string | null }[] | { cnpj?: string | null } | null };
    users = ((rows as Row[]) || [])
      .filter((u) => !u.whatsapp_opt_out)
      .filter((u) => {
        const company = Array.isArray(u.company) ? u.company[0] : u.company;
        return !company?.cnpj;
      })
      .map((u) => ({ id: u.id, nome: u.nome, email: u.email, whatsapp: u.whatsapp }));
  } else {
    users = data as SemCnpjUser[];
  }

  if (!users.length) {
    return { enviados: 0, pulados: 0, total: 0, restantes: 0 };
  }

  // Cabe no Vercel timeout: processa MAX_PER_BATCH por chamada. User dispara
  // o endpoint de novo pra continuar até esvaziar.
  const batch = users.slice(0, MAX_PER_BATCH);
  const restantes = Math.max(0, users.length - batch.length);

  let enviados = 0;
  let pulados = 0;

  for (let i = 0; i < batch.length; i++) {
    const u = batch[i];
    const primeiroNome = (u.nome || u.email.split('@')[0]).trim().split(/\s+/)[0];
    const idx = pickVariation(u.id);
    const msg = VARIACOES[idx](primeiroNome);

    try {
      await sendZAPI(u.whatsapp, msg, 'solardoc');

      await supabase.from('users').update({
        killer_q_sent_at: new Date().toISOString(),
      }).eq('id', u.id);

      enviados++;
    } catch (err) {
      logger.error('carla-killer-q', `falha enviando pra ${u.email}`, err);
      pulados++;
    }

    // 20s entre cada send (exceto após o último) — anti-spam.
    if (i < batch.length - 1) await sleep(DELAY_BETWEEN_SENDS_MS);
  }

  logger.info('carla-killer-q', `pergunta-pílula: ${enviados} enviados, ${pulados} pulados, ${restantes} restantes`);
  return { enviados, pulados, total: users.length, restantes };
}
