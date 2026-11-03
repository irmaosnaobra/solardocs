// ─────────────────────────────────────────────────────────────────────────────
// A RETOMADA DOS USUÁRIOS ESTÁ LIGADA? (03/11/2026). Molde: recuperacaoCarlaEstado.ts. Uma leitura só, usada pelo robô, pelo modo seco,
// pelo painel e pela Central.
//
// NASCE LIGADA (o dono mandou iniciar). Desliga por dois caminhos, e só por eles:
//   1. a env CARLA_RETOMADA_USUARIOS_OFF com o texto '1' (com trim; 'true' NÃO desliga);
//   2. a chave de banco `usu_rec_pausa` em system_state (a linha existe = pausado; se o valor traz `ate` e a hora já passou, expirou).
// A chave de banco é lida a CADA chamada. Leitura que falha vale como DESLIGADO: robô que envia tem que falhar fechado (por isso NÃO
// usa o mecanismo de interruptores, cujo padrão volta a LIGADO quando a leitura falha).
//
// Este arquivo também guarda as leituras LEVES que o painel e a Central repetem do robô (linha pausada, IA parada, Carla atende todos):
// ficam aqui, sem importar o vivoEnvio nem o cota.ts, para a Central não arrastar o cliente de IA. Um teste confere que as duas chaves
// copiadas são as mesmas dos arquivos de origem e que a leitura do disjuntor concorda com a do cota.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { DONAS_LIBERADAS_PARA_TODOS, ligado, lerAlvoVivo } from '../agentes5040/interruptores';
import { pausaDoValor } from './recuperacaoCarlaEstado';
import { CHAVE_LARGADA_RET, CHAVE_PAUSA_RET } from './retomadaUsuariosRegras';

const LOG = 'retomada-usuarios';

/** Cópias das chaves de agentes5040/vivoEnvio.ts (CHAVE_LINHA_PAUSA) e agentes5040/cota.ts (CHAVE_DISJUNTOR). Um teste confere. */
export const CHAVE_LINHA_PAUSA_RET = 'ag5040_linha_pausa';
export const CHAVE_DISJUNTOR_RET = 'ag5040_disjuntor';

export type MotivoEstadoRet = 'ligada' | 'env_desligada' | 'pausa_no_banco' | 'leitura_falhou';
export interface EstadoRetomada { ligada: boolean; motivo: MotivoEstadoRet }

/** Só o texto '1' (com trim) desliga pela env. */
export const envDesligaRetomada = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.CARLA_RETOMADA_USUARIOS_OFF ?? '').trim() === '1';

export async function estadoRetomadaUsuarios(opts: { env?: NodeJS.ProcessEnv; agora?: number } = {}): Promise<EstadoRetomada> {
  if (envDesligaRetomada(opts.env)) return { ligada: false, motivo: 'env_desligada' };
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_PAUSA_RET).maybeSingle();
    if (error) return { ligada: false, motivo: 'leitura_falhou' };
    if (!data) return { ligada: true, motivo: 'ligada' };
    return pausaDoValor((data as { value?: unknown }).value, opts.agora ?? Date.now())
      ? { ligada: false, motivo: 'pausa_no_banco' }
      : { ligada: true, motivo: 'ligada' };
  } catch {
    return { ligada: false, motivo: 'leitura_falhou' };
  }
}

/** A frase curta do estado, para o seco e o painel. */
export const descricaoDoEstadoRet = (e: EstadoRetomada): string =>
  e.ligada ? 'ligada'
    : e.motivo === 'env_desligada' ? 'desligada pela env'
      : e.motivo === 'pausa_no_banco' ? 'pausada pela chave do banco'
        : 'desligada: não consegui ler a chave do banco';

// ── a pausa (o que o painel mostra e o botão grava) ──────────────────────────

export interface PausaRetomada { em: string | null; motivo: string | null; por: string | null; n: number | null }

/** A pausa que vale agora, ou null se não há. Erro de leitura LANÇA (quem chama decide). */
export async function lerPausaRetomada(agoraMs: number = Date.now()): Promise<PausaRetomada | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_PAUSA_RET).maybeSingle();
  if (error) throw new Error('ler a pausa da retomada');
  if (!data) return null;
  const v = ((data as { value?: unknown }).value ?? {}) as { em?: unknown; motivo?: unknown; por?: unknown; n?: unknown };
  if (!pausaDoValor(v, agoraMs)) return null;
  return {
    em: typeof v.em === 'string' ? v.em : null,
    motivo: typeof v.motivo === 'string' ? v.motivo.slice(0, 60) : null,
    por: typeof v.por === 'string' ? v.por.slice(0, 60) : null,
    n: Number.isFinite(Number(v.n)) ? Number(v.n) : null,
  };
}

/** Pausa SEM prazo (volta à mão). Erro LANÇA: o botão do painel precisa saber que não gravou. */
export async function pausarRetomada(
  p: { motivo: 'painel' | 'dois_erros_de_linha'; por?: string | null; n?: number }, agora: Date = new Date(),
): Promise<void> {
  const iso = agora.toISOString();
  const value: Record<string, unknown> = { em: iso, motivo: p.motivo };
  if (p.por) value.por = String(p.por).slice(0, 60);
  if (typeof p.n === 'number') value.n = p.n;
  const { error } = await supabase.from('system_state').upsert({ key: CHAVE_PAUSA_RET, value, updated_at: iso }, { onConflict: 'key' });
  if (error) throw new Error('gravar a pausa da retomada');
}

/** Tira a pausa. Erro LANÇA. */
export async function retomarRetomada(): Promise<void> {
  const { error } = await supabase.from('system_state').delete().eq('key', CHAVE_PAUSA_RET);
  if (error) throw new Error('tirar a pausa da retomada');
}

// ── a largada ────────────────────────────────────────────────────────────────

/** A hora da largada (ms), SÓ LEITURA. null = o robô ainda não fez a primeira rodada; erro de leitura lança. */
export async function lerLargadaRet(): Promise<number | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LARGADA_RET).maybeSingle();
  if (error) throw new Error(`ler a largada: ${error.message}`);
  if (!data) return null;
  const t = Date.parse(String((data as { value?: { em?: unknown } | null }).value?.em ?? ''));
  return Number.isFinite(t) ? t : null;
}

/**
 * Garante a largada: na primeira rodada grava `usu_rec_largada` com a hora de agora (insert que NÃO sobrescreve: 23505 = já existia) e
 * devolve a hora que ficou valendo. Só o robô chama. Erro lança (a rodada para: sem largada não há fila nem início).
 */
export async function garantirLargadaRet(agora: Date): Promise<number> {
  const antes = await lerLargadaRet();
  if (antes !== null) return antes;
  const em = agora.toISOString();
  const { error } = await supabase.from('system_state').insert({ key: CHAVE_LARGADA_RET, value: { em }, updated_at: em });
  if (error && (error as { code?: string }).code !== '23505') throw new Error(`gravar a largada: ${error.message}`);
  const depois = await lerLargadaRet();
  if (depois === null) throw new Error('largada não encontrada depois de gravar');
  if (depois === agora.getTime()) logger.info(LOG, 'largada da retomada gravada: só conta criada antes dela, e o 1º envio nunca é no dia do deploy');
  return depois;
}

// ── leituras leves da linha e da IA (as mesmas do robô) ──────────────────────

/** A linha está pausada pelos erros seguidos (ag5040_linha_pausa com `ate` no futuro)? 'erro' = não deu para ler. */
export async function lerLinhaPausada(agora: Date): Promise<'sim' | 'nao' | 'erro'> {
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA_RET).maybeSingle();
    if (error) return 'erro';
    const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
    return Number.isFinite(ate) && ate > agora.getTime() ? 'sim' : 'nao';
  } catch { return 'erro'; }
}

/** O disjuntor da IA está aberto? Erro de leitura conta como ABERTO (a mesma regra do cota.ts: sem banco a Carla não fala). */
export async function lerIaParada(agora: Date): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_DISJUNTOR_RET).maybeSingle();
    if (error) return true;
    if (!data) return false;
    const ate = Date.parse(String((data as { value?: { ate?: string } }).value?.ate ?? ''));
    return Number.isFinite(ate) ? agora.getTime() < ate : true;
  } catch { return true; }
}

/**
 * A Carla atende TODOS (carla_vivo ligado e modo `todos`)? Sem isso a resposta de quem recebeu a retomada cairia na Giovanna.
 * 'erro' = não deu para ler o alvo (o painel diz que não conseguiu ler, em vez de culpar a Carla).
 */
export async function lerCarlaAtendeTodosDetalhe(): Promise<'sim' | 'nao' | 'erro'> {
  try {
    if (!(await ligado('carla_vivo'))) return 'nao';
    const alvo = await lerAlvoVivo();
    if (!alvo) return 'erro';
    return alvo.modos.carla === 'todos' && DONAS_LIBERADAS_PARA_TODOS.includes('carla') ? 'sim' : 'nao';
  } catch { return 'erro'; }
}

/** O mesmo, em sim ou não: o robô trata o erro de leitura como "não atende" e não envia. */
export async function lerCarlaAtendeTodos(): Promise<boolean> {
  return (await lerCarlaAtendeTodosDetalhe()) === 'sim';
}
