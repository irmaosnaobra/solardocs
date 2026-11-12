// ─────────────────────────────────────────────────────────────────────────────
// OS FREIOS DA LINHA PARA AS RESPOSTAS DA HELENA (12/11/2026, parecer do chefe anti-ban).
//
// A conversa que a Helena TEM com quem respondeu (até 2 bolhas por vez, 2 a 5 s entre elas, que é do
// sendHuman) passou a deixar rastro e a respeitar os tetos de emergência da linha, no molde do
// vivoEnvio.ts das agentes da 5040:
//   · cada bolha enviada ganha uma chave `inv_agente_env:<conversa>:<ms>:<n>`, que está em
//     PREFIXOS_RESPOSTA_AGENTES (lineThrottle): o frio espera 2 min depois dela e o teto de
//     emergência da linha (também das agentes da 5040) a enxerga;
//   · ANTES de cada envio: no máximo 60 por hora e 450 em 24 h (tudo que a linha conta, frio, agenda
//     e as respostas das agentes) e 10 s entre conversas DIFERENTES (a espera sai em processo, nunca
//     passa de 10 s: reativo não espera mais que isso, regulamento.ts).
// Falha de leitura FECHA: sem saber quanto a linha já falou, a resposta espera a próxima rodada.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { prefixosDaLinha, PREFIXOS_AGENDA, PREFIXOS_RESPOSTA_AGENTES } from '../agents/whatsapp/lineThrottle';

/** O carimbo de uma bolha de resposta da Helena. Está em PREFIXOS_RESPOSTA_AGENTES. */
export const PREFIXO_ENV = 'inv_agente_env:';

/** Os números do parecer (os mesmos do vivoEnvio.ts: tetoLinhaHora, tetoLinhaDia, espacamentoMs). Nenhum afrouxa. */
export const LIMITES_DA_RESPOSTA = Object.freeze({ horaLinha: 60, diaLinha: 450, entreConversasMs: 10_000 });

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** A espera em processo. Os testes trocam `dormir` por uma função instantânea. */
export const TEMPOS_DA_RESPOSTA = {
  dormir: (ms: number): Promise<void> => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve()),
};

export type ConferenciaDaLinha =
  | { ok: true; esperaMs: number }
  | { ok: false; motivo: 'teto_hora' | 'teto_dia' | 'leitura_falhou' };

const prefixosDaContaTotal = (): string[] => [...new Set([...prefixosDaLinha(), ...PREFIXOS_AGENDA, ...PREFIXOS_RESPOSTA_AGENTES])];

async function contar(prefixos: string[], desdeMs: number): Promise<number | null> {
  const { count, error } = await supabase.from('system_state').select('key', { count: 'exact', head: true })
    .or(prefixos.map(p => `key.like.${p}%`).join(','))
    .gte('updated_at', new Date(desdeMs).toISOString());
  if (error || typeof count !== 'number') return null;
  return count;
}

/**
 * Pode responder agora? Confere os dois tetos (cabe MAIS uma bolha, e a Helena manda até 2) e o espaço de
 * 10 s contra a última bolha de OUTRA conversa. `esperaMs` é o que falta desse espaço (0 a 10 s).
 */
export async function conferirLinhaParaResposta(chaveDaConversa: string, agora: number = Date.now()): Promise<ConferenciaDaLinha> {
  try {
    const [hora, dia] = await Promise.all([
      contar(prefixosDaContaTotal(), agora - HORA_MS), contar(prefixosDaContaTotal(), agora - DIA_MS),
    ]);
    if (hora === null || dia === null) return { ok: false, motivo: 'leitura_falhou' };
    if (hora + 2 > LIMITES_DA_RESPOSTA.horaLinha) return { ok: false, motivo: 'teto_hora' };
    if (dia + 2 > LIMITES_DA_RESPOSTA.diaLinha) return { ok: false, motivo: 'teto_dia' };

    const { data, error } = await supabase.from('system_state').select('key, updated_at')
      .like('key', `${PREFIXO_ENV}%`).order('updated_at', { ascending: false }).limit(1);
    if (error) return { ok: false, motivo: 'leitura_falhou' };
    const ultima = ((data ?? []) as Array<{ key: string; updated_at: string }>)[0];
    if (!ultima) return { ok: true, esperaMs: 0 };
    const deOutra = String(ultima.key).slice(PREFIXO_ENV.length).split(':')[0] !== chaveDaConversa;
    const faz = agora - Date.parse(String(ultima.updated_at));
    const falta = deOutra && Number.isFinite(faz) && faz < LIMITES_DA_RESPOSTA.entreConversasMs
      ? Math.min(LIMITES_DA_RESPOSTA.entreConversasMs, LIMITES_DA_RESPOSTA.entreConversasMs - faz) : 0;
    return { ok: true, esperaMs: Math.max(0, falta) };
  } catch (err) {
    logger.error('investidor-agente', 'conferir a linha para a resposta falhou: a resposta espera a próxima rodada', err);
    return { ok: false, motivo: 'leitura_falhou' };
  }
}

/** Uma chave por bolha realmente enviada. Erro de gravação não derruba a conversa: só aparece no log. */
export async function registrarBolhas(chaveDaConversa: string, quantas: number, agora: number = Date.now()): Promise<void> {
  const em = new Date(agora).toISOString();
  const linhas = Array.from({ length: Math.max(1, quantas) }, (_, n) => ({
    key: `${PREFIXO_ENV}${chaveDaConversa}:${agora}:${n + 1}`, value: { em }, updated_at: em,
  }));
  const { error } = await supabase.from('system_state').upsert(linhas, { onConflict: 'key' });
  if (error) logger.error('investidor-agente', `RESPOSTA ENVIADA SEM REGISTRO (final ${chaveDaConversa.slice(-2)}): o teto da linha está contando a menos`, error);
}

/** O carimbo da ficha ao consultor: no molde do `ficha_lead:` das agentes (vivoEnvio.PREFIXO_FICHA), que ESTÁ em PREFIXOS_RESPOSTA_AGENTES. */
export const PREFIXO_FICHA_NA_LINHA = 'ficha_lead:helena:';

/** Uma chave por ficha enviada, para o teto de emergência da linha (60/h, 450/24 h) enxergar. Erro só vai para o log. */
export async function registrarFichaNaLinha(cardId: number, agora: number = Date.now()): Promise<void> {
  const em = new Date(agora).toISOString();
  const { error } = await supabase.from('system_state')
    .upsert([{ key: `${PREFIXO_FICHA_NA_LINHA}${cardId}`, value: { em }, updated_at: em }], { onConflict: 'key' });
  if (error) logger.error('investidor-agente', `FICHA ENVIADA SEM REGISTRO (card ${cardId}): o teto da linha está contando a menos`, error);
}
