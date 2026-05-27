// ════════════════════════════════════════════════════════════
// PROMO GERADOR V2 — re-engajamento pros free com link direto
// ════════════════════════════════════════════════════════════
// Mensagem nova (sem pedir email), só manda pro /auth.
// Cadência 15-20s pra parecer humano e reduzir risco de ban Z-API.
// Idempotente via promo_gerador_v2_sent_at.
// MAX_PER_BATCH=15 cabe em ~5min (15 × ~17.5s ≈ 263s) dentro do
// maxDuration:300 da Vercel.
// ════════════════════════════════════════════════════════════

import { supabase } from '../../../utils/supabase';
import { sendZAPI } from '../zapiClient';
import { logger } from '../../../utils/logger';

const DELAY_MIN_MS = 15_000;
const DELAY_MAX_MS = 20_000;
const MAX_PER_BATCH = 15;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1));

function extractFirstName(nome: string | null): string | null {
  if (!nome) return null;
  const primeiro = nome.trim().split(/\s+/)[0];
  if (!primeiro) return null;
  if (primeiro.length < 2 || primeiro.length > 20) return null;
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+$/.test(primeiro)) return null;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

function buildMessage(primeiroNome: string | null): string {
  const saudacao = primeiroNome
    ? `Boa tarde, ${primeiroNome}! ☀️`
    : `Boa tarde, Integrador! ☀️`;
  return [
    saudacao,
    '',
    `Liberei pra você o *melhor Gerador de Propostas Solares do Brasil* 🇧🇷`,
    '',
    `Você já tem cadastro — é só entrar:`,
    `👉 https://solardoc.app/auth`,
    '',
    `Esqueceu senha ou login? Me responde aqui que eu ajusto rapidinho.`,
    '',
    `*BORA VENDER!* 🚀`,
  ].join('\n');
}

interface FreeUser {
  id: string;
  nome: string | null;
  email: string;
  whatsapp: string;
}

export async function runPromoGeradorV2Broadcast(): Promise<{
  enviados: number;
  pulados: number;
  total_elegiveis: number;
  restantes: number;
}> {
  const { data: rows, error } = await supabase
    .from('users')
    .select('id, nome, email, whatsapp')
    .eq('plano', 'free')
    .is('promo_gerador_v2_sent_at', null)
    .not('whatsapp', 'is', null)
    .neq('whatsapp', '')
    .neq('whatsapp_opt_out', true)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_BATCH * 10);

  if (error) {
    logger.error('promo-gerador-v2', 'falha buscando elegíveis', error);
    throw error;
  }

  const users = (rows ?? []) as FreeUser[];

  if (!users.length) {
    return { enviados: 0, pulados: 0, total_elegiveis: 0, restantes: 0 };
  }

  const batch = users.slice(0, MAX_PER_BATCH);
  const restantes = Math.max(0, users.length - batch.length);

  let enviados = 0;
  let pulados = 0;

  for (let i = 0; i < batch.length; i++) {
    const u = batch[i];
    const primeiroNome = extractFirstName(u.nome);
    const msg = buildMessage(primeiroNome);

    try {
      await sendZAPI(u.whatsapp, msg, 'solardoc');

      await supabase
        .from('users')
        .update({ promo_gerador_v2_sent_at: new Date().toISOString() })
        .eq('id', u.id);

      enviados++;
    } catch (err) {
      logger.error('promo-gerador-v2', `falha enviando pra ${u.email}`, err);
      pulados++;
    }

    if (i < batch.length - 1) await sleep(randomDelay());
  }

  logger.info(
    'promo-gerador-v2',
    `${enviados} enviados, ${pulados} pulados, ${restantes} restantes`,
  );
  return { enviados, pulados, total_elegiveis: users.length, restantes };
}
