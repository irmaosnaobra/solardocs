// ─────────────────────────────────────────────────────────────────────────────
// Teto anti-ban da linha SOLARDOC para os follow-ups da Carla.
//
// A Carla (carlaPlatformFollowupService) tem DUAS cadências que saem pela MESMA
// linha física solardoc: sem_cnpj (3 toques) e inativo (5 toques). Se cada uma
// disparasse pra todo o pool de uma vez (24 + 39 = 63 hoje), a linha mandaria
// dezenas de mensagens automáticas num único ciclo → o Z-API marca como spam e
// BANE o número (linha B2B compartilhada com a Giovanna). Risco registrado.
//
// Por isso o orçamento é UM SÓ pra Carla na última hora: este módulo conta os
// envios efetivados das DUAS cadências (marcadores carla_sent: em system_state) e
// diz se ainda há folga. Ambas chamam dentroDoTetoCarla() antes de cada envio e
// marcamEnvioCarla() depois — assim o backlog drena em drip (poucos/hora) ao
// longo de dias, em vez de um pico que toma ban.
//
// O cron master roda DE HORA EM HORA (.github/workflows/cron.yml '0 * * * *'),
// então MAX_CARLA_POR_HORA é, na prática, o teto por ciclo do master.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';

// Cap anti-ban por hora na linha solardoc, COMPARTILHADO pelas 2 cadências da
// Carla. Conservador de propósito (religando um canal que estava pausado por ban).
export const MAX_CARLA_POR_HORA = 4;

const SENT_PREFIX = 'carla_sent:';

/**
 * Ainda há folga no teto anti-ban da Carla na última hora?
 * `true` = pode enviar; `false` = estourou, segura pro próximo tick.
 * Conta os envios das DUAS cadências (sem_cnpj + inativo) — orçamento único.
 */
export async function dentroDoTetoCarla(): Promise<boolean> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('system_state')
    .select('key')
    .like('key', `${SENT_PREFIX}%`)
    .gte('updated_at', desde)
    .limit(MAX_CARLA_POR_HORA + 1);
  return (data?.length ?? 0) < MAX_CARLA_POR_HORA;
}

// ─── JANELA DE HORÁRIO — arranque controlado (só HOJE 30/jun/2026) ───────────
// O Thiago pediu pra soltar a 1ª leva da base só entre 18:30 e 20:00 BRT, hoje.
// Este guard vale SÓ pra 30/jun: a partir de 01/jul ele deixa de bloquear e a
// cadência volta ao comportamento normal (qualquer hora) — sem precisar reverter.
const JANELA_SO_NESTE_DIA_BRT = '2026-06-30';
const JANELA_INICIO_MIN = 18 * 60 + 30; // 18:30
const JANELA_FIM_MIN    = 20 * 60;      // 20:00

/** Pode disparar a cadência AGORA? Hoje (30/jun) só entre 18:30–20:00 BRT; demais dias, sempre. */
export function dentroDaJanelaDeEnvio(now: Date = new Date()): boolean {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // BRT = UTC-3
  const ymd = brt.toISOString().slice(0, 10);
  if (ymd !== JANELA_SO_NESTE_DIA_BRT) return true; // guard só vale hoje
  const min = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  return min >= JANELA_INICIO_MIN && min < JANELA_FIM_MIN;
}

/**
 * Marca que a Carla enviou uma mensagem pra esse usuário AGORA (alimenta o teto).
 * Upsert por user — o updated_at carimba o instante, que é o que a janela conta.
 * Sem este marcador o envio fura o teto (lição do lineThrottle IO).
 */
export async function marcarEnvioCarla(userId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from('system_state')
    .upsert(
      { key: `${SENT_PREFIX}${userId}`, value: { sent_at: nowIso }, updated_at: nowIso },
      { onConflict: 'key' },
    );
}
