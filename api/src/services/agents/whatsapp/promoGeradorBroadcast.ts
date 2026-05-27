// ════════════════════════════════════════════════════════════
// PROMO GERADOR DE PROPOSTA — broadcast one-shot pros users free
// ════════════════════════════════════════════════════════════
// Disparo único 27/05/2026 06:50 BRT pra todos users plano=free
// com whatsapp e sem opt-out. Pede e-mail em troca de 10 créditos
// no novo gerador de propostas.
//
// Idempotente via promo_gerador_sent_at — cada user recebe UMA vez.
// Endpoint /cron/promo-gerador-blast é one-shot. GitHub Actions
// chama 4x seguidas (cada batch ~20 envios, ~4min cada) pra cobrir
// os ~87 usuários elegíveis sem estourar maxDuration:300s do Vercel.
// ════════════════════════════════════════════════════════════

import { supabase } from '../../../utils/supabase';
import { sendZAPI } from '../zapiClient';
import { logger } from '../../../utils/logger';

const DELAY_MIN_MS = 10_000;
const DELAY_MAX_MS = 14_000;
const MAX_PER_BATCH = 20; // 20 × ~12s ≈ 240s, cabe no maxDuration:300

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1));

function buildMessage(primeiroNome: string): string {
  return [
    `Bom dia, ${primeiroNome}! ☀️`,
    '',
    `Hoje é dia cheio de vendas — que tal testar nosso *novo gerador de propostas* da SolarDoc?`,
    '',
    `Me responde com seu *e-mail* que eu te libero *10 créditos* agora 🎁`,
  ].join('\n');
}

interface FreeUser {
  id: string;
  nome: string | null;
  email: string;
  whatsapp: string;
}

export async function runPromoGeradorBroadcast(): Promise<{
  enviados: number;
  pulados: number;
  total_elegiveis: number;
  restantes: number;
}> {
  const { data: rows, error } = await supabase
    .from('users')
    .select('id, nome, email, whatsapp')
    .eq('plano', 'free')
    .is('promo_gerador_sent_at', null)
    .not('whatsapp', 'is', null)
    .neq('whatsapp', '')
    .neq('whatsapp_opt_out', true)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_BATCH * 10);

  if (error) {
    logger.error('promo-gerador', 'falha buscando elegíveis', error);
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
    const primeiroNome = (u.nome || u.email.split('@')[0]).trim().split(/\s+/)[0];
    const msg = buildMessage(primeiroNome);

    try {
      await sendZAPI(u.whatsapp, msg, 'solardoc');

      await supabase
        .from('users')
        .update({ promo_gerador_sent_at: new Date().toISOString() })
        .eq('id', u.id);

      enviados++;
    } catch (err) {
      logger.error('promo-gerador', `falha enviando pra ${u.email}`, err);
      pulados++;
    }

    if (i < batch.length - 1) await sleep(randomDelay());
  }

  logger.info(
    'promo-gerador',
    `${enviados} enviados, ${pulados} pulados, ${restantes} restantes`,
  );
  return { enviados, pulados, total_elegiveis: users.length, restantes };
}
