// ─────────────────────────────────────────────────────────────────────────────
// INTERRUPTORES DA FASE A. Quatro peças nascem DESLIGADAS e o dono liga sem
// mexer em env na Vercel.
//
//   ligado('ensaio' | 'replay' | 'ficha' | 'sentinela' | 'duda_vivo' | 'helena_vivo' | 'carla_vivo')
//
// Os três *_vivo (Fase B) ligam a agente que RESPONDE de verdade. Quem atende quem é decidido
// por LEAD, em posse.ts (agenteAtendeEste), com a chave ag5040_vivo_alvo lida daqui.
//
// Ordem de decisão:
//   1. env AGENTES5040_<NOME> (ENSAIO, REPLAY, FICHA, SENTINELA, DUDA_VIVO, ...): '1' liga e
//      '0' desliga, e SOBRESCREVE a chave do banco. Outro valor é ignorado.
//   2. senão, a chave system_state.ag5040_interruptores, um JSON
//      { ensaio?, replay?, ficha?, sentinela?: boolean } sem dado pessoal.
//      Só `true` liga. Lida com cache de 60 s.
//   3. erro de leitura, chave ausente ou nome ausente na chave = o padrão do nome: DESLIGADO, menos
//      `qualidade` e `respostas_dono`, que nascem LIGADOS (PADRAO_LIGADO).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';

/** Lista única dos nomes: o tipo, o leitor do mapa e o painel (rota) saem daqui. */
export const NOMES_INTERRUPTORES = ['ensaio', 'replay', 'ficha', 'sentinela', 'duda_vivo', 'helena_vivo', 'carla_vivo', 'qualidade', 'respostas_dono'] as const;
export type NomeInterruptor = typeof NOMES_INTERRUPTORES[number];

/**
 * Padrão por nome quando NEM a env NEM a chave do banco dizem nada. Todo nome fora desta lista nasce DESLIGADO.
 * `qualidade` (a nota diária das conversas) e `respostas_dono` (as respostas do dono entram no conhecimento da
 * agente) nascem LIGADOS: o botão do painel continua mandando, e ninguém precisa de env. Erro de LEITURA do banco
 * também cai neste padrão, porque as duas peças só leem e escrevem notas e filas, nunca falam com o lead.
 */
export const PADRAO_LIGADO: Readonly<Partial<Record<NomeInterruptor, boolean>>> = Object.freeze({ qualidade: true, respostas_dono: true });
export const padraoDe = (nome: NomeInterruptor): boolean => PADRAO_LIGADO[nome] === true;

export type DonaViva = 'duda' | 'helena' | 'carla';
export const DONAS_VIVAS: readonly DonaViva[] = ['duda', 'helena', 'carla'];
/**
 * Donas que PODEM atender todos os leads (22/10/2026, campanhas no ar). Estar aqui só permite: quem liga de fato é
 * o modo 'todos' de cada dona no ag5040_vivo_alvo (painel). Modo 'todos' gravado para dona fora desta lista vale
 * como 'teste' (posse.ts) e o painel recusa gravá-lo.
 */
export const DONAS_LIBERADAS_PARA_TODOS: readonly DonaViva[] = ['duda', 'helena', 'carla'];
export const interruptorDaDona = (d: DonaViva): NomeInterruptor => `${d}_vivo` as NomeInterruptor;

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
/** Leitura em andamento (cache frio): N chamadas simultâneas esperam a mesma promessa, 1 leitura só. */
let lendoMapa: Promise<Mapa | null> | null = null;
/** Sobe a cada zerada: leitura que começou antes dela não grava o cache depois. */
let geracao = 0;

/** Zera o cache (testes e quem acabou de gravar a chave). Zera junto o cache do alvo e as leituras em andamento. */
export function zerarCacheInterruptores(): void { cache = null; cacheAlvo = null; lendoMapa = null; lendoAlvo = null; geracao++; }

async function lerPadrao(): Promise<unknown> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_INTERRUPTORES).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value;
}

/** Lê o valor bruto da chave (objeto ou texto JSON) e devolve só o que está `true`/`false`. null = ilegível. */
export function mapaDosInterruptores(v: unknown): Partial<Record<NomeInterruptor, boolean>> | null {
  const m = comoMapa(v);
  if (!m) return null;
  const saida: Partial<Record<NomeInterruptor, boolean>> = {};
  for (const n of NOMES_INTERRUPTORES) if (typeof m[n] === 'boolean') saida[n] = m[n] as boolean;
  return saida;
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
  if (cache && agora - cache.em < CACHE_MS) return valorDe(cache.mapa, nome);
  if (!lendoMapa) {
    const g = geracao;
    const leitura: Promise<Mapa | null> = (async () => {
      let mapa: Mapa | null = null;
      try { mapa = comoMapa(await (opts.ler ?? lerPadrao)()); } catch { mapa = null; }
      if (g === geracao) cache = { em: agora, mapa };
      return mapa;
    })().finally(() => { if (lendoMapa === leitura) lendoMapa = null; });
    lendoMapa = leitura;
  }
  return valorDe(await lendoMapa, nome);
}

/** O valor explícito da chave (boolean) ou, na falta dele, o padrão do nome. */
function valorDe(mapa: Mapa | null | undefined, nome: NomeInterruptor): boolean {
  const v = mapa?.[nome];
  return typeof v === 'boolean' ? v : padraoDe(nome);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALVO DA RODADA VIVA (Fase B). Chave system_state `ag5040_vivo_alvo`:
//   { kid, hmacs: string[] (até 3), modos: { duda?, helena?, carla?: 'teste' | 'todos' }, atualizado_em }
// Modo ausente = 'teste'. Chave ausente = modo teste com lista vazia = a agente não atende NINGUÉM.
// Liberar para todos é passo explícito (modo 'todos'), nunca efeito de apagar a lista.
// Telefone cru NUNCA entra aqui: só o HMAC. Se o `kid` não for o da chave de HMAC em uso, os
// hmacs gravados deixam de casar (falha segura: ninguém em teste).
// Cache de 60 s, como os interruptores. Erro de leitura = null (quem pergunta trata como "não atende").
// ─────────────────────────────────────────────────────────────────────────────

export const CHAVE_VIVO_ALVO = 'ag5040_vivo_alvo';
export const MAX_ALVOS = 3;
export type ModoVivo = 'teste' | 'todos';

export interface AlvoVivo {
  kid: string | null;
  hmacs: string[];
  modos: Partial<Record<DonaViva, ModoVivo>>;
  atualizado_em: string | null;
}

const HMAC_64 = /^[0-9a-f]{64}$/;
/** Leitura que falhou vale pouco: não deixa a agente sem alvo por um minuto inteiro. */
const CACHE_ERRO_MS = 10_000;

/** Lê o valor bruto (objeto ou texto JSON) da chave do alvo. Ausente/ilegível = alvo vazio em modo teste. */
export function alvoDoValor(v: unknown): AlvoVivo {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = null; } }
  const o = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as Record<string, unknown>;
  const hmacs = Array.isArray(o.hmacs) ? [...new Set(o.hmacs.filter((h): h is string => typeof h === 'string' && HMAC_64.test(h)))].slice(0, MAX_ALVOS) : [];
  const modosBrutos = (o.modos && typeof o.modos === 'object' && !Array.isArray(o.modos) ? o.modos : {}) as Record<string, unknown>;
  const modos: Partial<Record<DonaViva, ModoVivo>> = {};
  for (const d of DONAS_VIVAS) if (modosBrutos[d] === 'teste' || modosBrutos[d] === 'todos') modos[d] = modosBrutos[d] as ModoVivo;
  return {
    kid: typeof o.kid === 'string' && o.kid ? o.kid : null,
    hmacs,
    modos,
    atualizado_em: typeof o.atualizado_em === 'string' ? o.atualizado_em : null,
  };
}

export interface OpcoesAlvo {
  /** Lê o valor bruto da chave (undefined/null se ausente). Lança em erro. */
  ler?: () => Promise<unknown>;
  agora?: () => number;
}

let cacheAlvo: { em: number; alvo: AlvoVivo | null } | null = null;
/** Leitura do alvo em andamento (cache frio): N chamadas simultâneas esperam a mesma promessa. */
let lendoAlvo: Promise<AlvoVivo | null> | null = null;

async function lerAlvoPadrao(): Promise<unknown> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_VIVO_ALVO).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value;
}

/** O alvo da rodada viva, com cache de 60 s. null = erro de leitura (quem chama trata como "a agente não atende"). */
export async function lerAlvoVivo(opts: OpcoesAlvo = {}): Promise<AlvoVivo | null> {
  const agora = (opts.agora ?? Date.now)();
  if (cacheAlvo && agora - cacheAlvo.em < (cacheAlvo.alvo ? CACHE_MS : CACHE_ERRO_MS)) return cacheAlvo.alvo;
  if (!lendoAlvo) {
    const g = geracao;
    const leitura: Promise<AlvoVivo | null> = (async () => {
      let alvo: AlvoVivo | null = null;
      try { alvo = alvoDoValor(await (opts.ler ?? lerAlvoPadrao)()); } catch { alvo = null; }
      if (g === geracao) cacheAlvo = { em: agora, alvo };
      return alvo;
    })().finally(() => { if (lendoAlvo === leitura) lendoAlvo = null; });
    lendoAlvo = leitura;
  }
  return lendoAlvo;
}
