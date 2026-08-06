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
import { solardocViaIo } from '../zapiClient';
import { dentroDoTetoHorarioLinha, respeitaEspacamentoLinha } from './lineThrottle';

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
  // Desvio ligado (ZAPI_SOLARDOC_VIA_IO=1): estes envios saem pela linha IO, que
  // já tem Bia e followup do gerador dentro do MESMO número. Os 4/h da Carla
  // passam a caber DENTRO dos 12/h da linha — não a somar por cima deles.
  if (solardocViaIo() && !(await dentroDoTetoHorarioLinha())) return false;

  // Margem de 5 min entre envios (ordem do Thiago, 06/ago). O cap de 4/h autorizava
  // as 4 no mesmo minuto — e autorizou: 01h13 de 06/ago saíram 4 em 37 segundos, com
  // o gap interno de 4s. Com o desvio ligado a régua é a linha inteira (inclui a Bia);
  // sem ele, só os envios da própria Carla.
  if (!(await respeitaEspacamentoLinha(solardocViaIo() ? undefined : [SENT_PREFIX]))) return false;

  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('system_state')
    .select('key')
    .like('key', `${SENT_PREFIX}%`)
    .gte('updated_at', desde)
    .limit(MAX_CARLA_POR_HORA + 1);
  return (data?.length ?? 0) < MAX_CARLA_POR_HORA;
}

// ─── JANELA DE HORÁRIO ───────────────────────────────────────────────────────
// Era o arranque controlado de 30/jun/2026 (18:30–20:00 só naquele dia) e expirou
// sozinho no dia seguinte, como planejado — só que o "depois" virou 24/7: a função
// passou a devolver `true` sempre e a cadência disparou às 01h, 04h e 07h (log de
// 03–04/ago). Mensagem comercial de madrugada é denúncia, e denúncia é o que derruba
// a linha. Agora delega pra janela ÚNICA da linha (08h–21h BRT, lineThrottle) — a
// mesma que a Bia respeita, num lugar só. Kill-switch: JANELA_DIURNA_OFF=1.
export { dentroDaJanelaDiurna as dentroDaJanelaDeEnvio } from './lineThrottle';

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
