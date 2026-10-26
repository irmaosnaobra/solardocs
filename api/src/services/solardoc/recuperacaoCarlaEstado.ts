// ─────────────────────────────────────────────────────────────────────────────
// O ROBÔ DA CARLA ESTÁ LIGADO? (24/10/2026, plano B2). Uma função só, usada pelo robô, pelo tick de
// desistência do B1 e pela sonda de admin.
//
// NASCE LIGADO. Desliga por dois caminhos, e só por eles:
//   1. a env QUIZ_RECUPERACAO_LIGADA com o texto '0' (a env só desliga: qualquer outro valor, '1' inclusive, não liga nada a mais);
//   2. a chave de banco `quiz_rec_pausa` em system_state (a mesma tabela e o mesmo mecanismo de ag5040_linha_pausa:
//      a linha existe = pausado; se o valor traz `ate` e a hora já passou, a pausa expirou).
// A chave de banco é lida a CADA chamada. Leitura que falha vale como DESLIGADO.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { CHAVE_LARGADA_REC, CHAVE_PAUSA_QUIZ_REC } from './recuperacaoCarlaRegras';

export type MotivoEstado = 'ligada' | 'env_desligada' | 'pausa_no_banco' | 'leitura_falhou';
export interface EstadoRecuperacao { ligada: boolean; motivo: MotivoEstado }

/** Só o texto '0' (sem espaços) desliga pela env. */
export const envDesligaRecuperacao = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.QUIZ_RECUPERACAO_LIGADA ?? '').trim() === '0';

/**
 * A linha `quiz_rec_pausa` EXISTE: a pausa vale, a menos que o valor traga `ate` e a hora já tenha passado (expirou, como a pausa da
 * linha). `ate` ausente = pausa sem prazo; `ate` ilegível = pausado (na dúvida, a Carla não fala).
 */
export function pausaDoValor(value: unknown, agoraMs: number): boolean {
  const ate = (value as { ate?: unknown } | null | undefined)?.ate;
  if (ate === undefined || ate === null || ate === '') return true;
  const t = Date.parse(String(ate));
  return !Number.isFinite(t) || t > agoraMs;
}

export async function estadoRecuperacaoCarla(
  opts: { env?: NodeJS.ProcessEnv; agora?: number } = {},
): Promise<EstadoRecuperacao> {
  if (envDesligaRecuperacao(opts.env)) return { ligada: false, motivo: 'env_desligada' };
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_PAUSA_QUIZ_REC).maybeSingle();
    if (error) return { ligada: false, motivo: 'leitura_falhou' };
    if (!data) return { ligada: true, motivo: 'ligada' };
    return pausaDoValor((data as { value?: unknown }).value, opts.agora ?? Date.now())
      ? { ligada: false, motivo: 'pausa_no_banco' }
      : { ligada: true, motivo: 'ligada' };
  } catch {
    return { ligada: false, motivo: 'leitura_falhou' };
  }
}

/** A frase curta do estado, para a sonda. */
export const descricaoDoEstado = (e: EstadoRecuperacao): string =>
  e.ligada ? 'ligada' : e.motivo === 'env_desligada' ? 'desligada pela env' : e.motivo === 'pausa_no_banco' ? 'pausada pela chave do banco' : 'desligada: não consegui ler a chave do banco';

/**
 * A hora da largada (ms), SÓ LEITURA. null = o robô ainda não fez a primeira rodada; erro de leitura lança.
 */
export async function lerLargada(): Promise<number | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LARGADA_REC).maybeSingle();
  if (error) throw new Error(`ler a largada: ${error.message}`);
  if (!data) return null;
  const t = Date.parse(String((data as { value?: { em?: unknown } | null }).value?.em ?? ''));
  return Number.isFinite(t) ? t : null;
}

/**
 * Garante a largada: na primeira rodada grava `quiz_rec_largada` com a hora de agora (insert que NÃO sobrescreve:
 * 23505 = já existia) e devolve a hora que ficou valendo. Só o robô chama. Erro lança (a rodada para: sem largada não há fila).
 */
export async function garantirLargada(agora: Date): Promise<number> {
  const antes = await lerLargada();
  if (antes !== null) return antes;
  const em = agora.toISOString();
  const { error } = await supabase.from('system_state').insert({ key: CHAVE_LARGADA_REC, value: { em }, updated_at: em });
  if (error && (error as { code?: string }).code !== '23505') throw new Error(`gravar a largada: ${error.message}`);
  const depois = await lerLargada();
  if (depois === null) throw new Error('largada não encontrada depois de gravar');
  if (depois === agora.getTime()) logger.info('quiz-rec', 'largada do robô da Carla gravada: só lead novo daqui para a frente');
  return depois;
}
