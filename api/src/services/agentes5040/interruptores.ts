// ─────────────────────────────────────────────────────────────────────────────
// INTERRUPTORES DA FASE A. Quatro peças nascem DESLIGADAS e o dono liga sem
// mexer em env na Vercel.
//
//   ligado('ensaio' | 'replay' | 'ficha' | 'sentinela')
//
// Ordem de decisão:
//   1. env AGENTES5040_<NOME> (ENSAIO, REPLAY, FICHA, SENTINELA): '1' liga e
//      '0' desliga, e SOBRESCREVE a chave do banco. Outro valor é ignorado.
//   2. senão, a chave system_state.ag5040_interruptores, um JSON
//      { ensaio?, replay?, ficha?, sentinela?: boolean } sem dado pessoal.
//      Só `true` liga. Lida com cache de 60 s.
//   3. erro de leitura, chave ausente ou nome ausente na chave = DESLIGADO.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';

export type NomeInterruptor = 'ensaio' | 'replay' | 'ficha' | 'sentinela';

export const CHAVE_INTERRUPTORES = 'ag5040_interruptores';
export const CACHE_MS = 60_000;

type Mapa = Partial<Record<NomeInterruptor, unknown>>;

export interface OpcoesInterruptor {
  env?: Record<string, string | undefined>;
  /** Lê o valor bruto da chave (undefined/null se ausente). Lança em erro. */
  ler?: () => Promise<unknown>;
  agora?: () => number;
}

let cache: { em: number; mapa: Mapa | null } | null = null;

/** Zera o cache (testes e quem acabou de gravar a chave). */
export function zerarCacheInterruptores(): void { cache = null; }

async function lerPadrao(): Promise<unknown> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_INTERRUPTORES).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value;
}

function comoMapa(v: unknown): Mapa | null {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Mapa) : null;
}

export async function ligado(nome: NomeInterruptor, opts: OpcoesInterruptor = {}): Promise<boolean> {
  const env = opts.env ?? process.env;
  const porEnv = (env[`AGENTES5040_${nome.toUpperCase()}`] ?? '').trim();
  if (porEnv === '1') return true;
  if (porEnv === '0') return false;

  const agora = (opts.agora ?? Date.now)();
  if (!cache || agora - cache.em >= CACHE_MS) {
    let mapa: Mapa | null = null;
    try { mapa = comoMapa(await (opts.ler ?? lerPadrao)()); } catch { mapa = null; }
    cache = { em: agora, mapa };
  }
  return cache.mapa?.[nome] === true;
}
