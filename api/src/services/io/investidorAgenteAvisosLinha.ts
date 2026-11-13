// ─────────────────────────────────────────────────────────────────────────────
// AS CONFERÊNCIAS DA LINHA ANTES DE CADA AVISO DA HELENA À EQUIPE (12/11/2026, parecer do anti-ban). Só lê, nunca envia.
// Nesta ordem: linha livre; menos de 40 carimbos da linha na hora; menos de 6 proativas em 10 min; e 25 s mais um sorteio de 0 a
// 35 s desde a última proativa. O que não couber espera a rodada seguinte (investidorAgenteAvisos.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { prefixosDaLinha } from '../agents/whatsapp/lineThrottle';
import { linhaLivre } from '../agentes5040/guardaDaLinha';
import { cabeNaLinha } from './jornadaMensagensBase';

const LOG = 'investidor-agente-avisos';
const MINUTO_MS = 60_000;
/** Além do que a linha conta, as proativas à equipe que não estão em prefixosDaLinha(): a ficha ao consultor, a Jornada, o quiz solar e o grupo do SolarDoc. */
const PROATIVAS_DA_EQUIPE = ['ficha_lead:', 'jornada_env:', 'solar_quiz_env:', 'solardoc_aviso_sent:'] as const;
const PROATIVAS_MAX_EM_10_MIN = 6;
const ESPACO_MINIMO_MS = 25_000;
const SORTEIO_MAX_MS = 35_000;

// ── As conferências da linha, antes de CADA envio ────────────────────────────
export type Conferencia = { ok: true } | { ok: false; motivo: 'linha_pausada' | 'linha_cheia_na_hora' | 'proativas_em_10_min' | 'espacamento' | 'leitura_falhou' };

export async function conferirAntesDoAviso(agora: Date, sorteio: () => number = Math.random): Promise<Conferencia> {
  // 1) A linha livre (sem pausa por erros seguidos nem cooldown da instância).
  if ((await linhaLivre(agora)) !== 'sim') return { ok: false, motivo: 'linha_pausada' };
  // 2) Menos de 40 carimbos da linha na última hora (leitura que falha vale "não cabe").
  if (!(await cabeNaLinha(agora))) return { ok: false, motivo: 'linha_cheia_na_hora' };
  // 3) Menos de 6 proativas em 10 min e 4) 25 s mais um sorteio de 0 a 35 s desde a última proativa.
  try {
    const prefixos = [...new Set([...prefixosDaLinha(), ...PROATIVAS_DA_EQUIPE])];
    const { data, error } = await supabase.from('system_state').select('updated_at')
      .or(prefixos.map(p => `key.like.${p}%`).join(','))
      .gte('updated_at', new Date(agora.getTime() - 10 * MINUTO_MS).toISOString())
      .order('updated_at', { ascending: false }).limit(PROATIVAS_MAX_EM_10_MIN);
    if (error) return { ok: false, motivo: 'leitura_falhou' };
    const linhas = (data ?? []) as Array<{ updated_at: string }>;
    if (linhas.length >= PROATIVAS_MAX_EM_10_MIN) return { ok: false, motivo: 'proativas_em_10_min' };
    const ultima = Date.parse(String(linhas[0]?.updated_at ?? ''));
    if (Number.isFinite(ultima) && agora.getTime() - ultima < ESPACO_MINIMO_MS + Math.floor(sorteio() * SORTEIO_MAX_MS)) return { ok: false, motivo: 'espacamento' };
  } catch (err) {
    logger.error(LOG, 'conferir as proativas da linha falhou: o aviso espera a próxima rodada', err);
    return { ok: false, motivo: 'leitura_falhou' };
  }
  return { ok: true };
}
