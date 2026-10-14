import { supabase } from '../../../utils/supabase';
import { REGRAS_REDES } from '../../chefe/regulamento';

// ─────────────────────────────────────────────────────────────────────────────
// Peças comuns da fase 1 de "Automação como centro das redes" (14/10/2026):
// chaves de ligar, livro em system_state (claim por insert, troca com versão),
// parada compartilhada da Meta e leitura do erro da Meta.
//
// Tudo que decide "pode ou não" mora aqui uma vez só. O número vem do regulamento
// (REGRAS_REDES), nunca escrito de novo nos serviços.
// ─────────────────────────────────────────────────────────────────────────────

export type RedeMeta = 'instagram' | 'facebook';
export type RedePublicar = RedeMeta | 'status';

/** Uma env por item. Sem a env, nada sai: todas nascem desligadas. */
export const CHAVES = Object.freeze({
  status: 'REDES_STATUS_5040_LIGADO',
  instagram: 'REDES_REELS_IG_LIGADO',
  facebook: 'REDES_REELS_FB_LIGADO',
  respostaIg: 'REDES_RESPOSTA_IG_LIGADA',
  respostaFb: 'REDES_RESPOSTA_FB_LIGADA',
  caixa: 'REDES_CAIXA_LIGADA',
});

export function chaveLigada(nome: string): boolean {
  const v = String(process.env[nome] || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

export const chaveDaPublicacao = (rede: RedePublicar): string => CHAVES[rede];
export const chaveDaResposta = (rede: RedeMeta): string => (rede === 'instagram' ? CHAVES.respostaIg : CHAVES.respostaFb);

const BRT_MS = 3 * 60 * 60 * 1000;

/** Dia civil de Brasília (AAAA-MM-DD). O relógio do servidor é UTC. */
export function diaBrt(agora: number | Date = Date.now()): string {
  const t = typeof agora === 'number' ? agora : agora.getTime();
  return new Date(t - BRT_MS).toISOString().slice(0, 10);
}

/** Instante (epoch ms) em que começa o dia seguinte em Brasília. */
export function inicioDoProximoDiaBrt(agora: number = Date.now()): number {
  const brt = new Date(agora - BRT_MS);
  return Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1) + BRT_MS;
}

// ── livro em system_state ────────────────────────────────────────────────────

export interface Linha<T = any> { value: T; updated_at: string }

/** Código do erro do banco. A mensagem do driver pode trazer valor de célula e nunca vai a log. */
export const codigoDo = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido');

export class ErroLivro extends Error {
  constructor(public codigo: string) { super('erro no livro'); this.name = 'ErroLivro'; }
}

export async function lerLinha<T = any>(chave: string): Promise<Linha<T> | null> {
  const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', chave).maybeSingle();
  if (error) throw new ErroLivro(codigoDo(error));
  return data ? { value: (data as any).value as T, updated_at: String((data as any).updated_at ?? '') } : null;
}

/** Claim por insert: 'ok' ganhou, 'duplicado' (23505) alguém já tem, 'erro' o banco falhou (não segue). */
export async function reivindicar(chave: string, valor: unknown, agora = new Date().toISOString()): Promise<'ok' | 'duplicado' | 'erro'> {
  const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: agora });
  if (!error) return 'ok';
  return codigoDo(error) === '23505' ? 'duplicado' : 'erro';
}

/**
 * Troca de valor com versão: só grava se ninguém mexeu na linha desde a leitura. Devolve o `updated_at` que o
 * banco GRAVOU (é essa a versão para a próxima troca, nunca o relógio de quem chamou), ou null se perdeu.
 */
export async function trocarSe(chave: string, valor: unknown, versaoLida: string, agora = new Date().toISOString()): Promise<string | null> {
  const { data, error } = await supabase.from('system_state')
    .update({ value: valor, updated_at: agora }).eq('key', chave).eq('updated_at', versaoLida).select('key, updated_at');
  if (error) throw new ErroLivro(codigoDo(error));
  if (!Array.isArray(data) || data.length === 0) return null;
  return String((data[0] as { updated_at?: string }).updated_at ?? agora);
}

/** Troca o valor de uma linha que já é nossa (o claim), sem conferir versão. Falha é só logada por quem chama. */
export async function gravarValor(chave: string, valor: unknown): Promise<boolean> {
  try {
    const { error } = await supabase.from('system_state').update({ value: valor }).eq('key', chave);
    return !error;
  } catch { return false; }
}

export async function apagarLinha(chave: string): Promise<void> {
  await supabase.from('system_state').delete().eq('key', chave);
}

/**
 * Faixa de tempo mínima entre duas ações (30 min entre Reels, 20 s entre respostas):
 * lê a marca, recusa se ainda é cedo e grava a nova com versão. Duas chamadas no mesmo
 * segundo: só uma troca a versão, a outra recebe "cedo".
 */
export async function tomarFaixa(
  chave: string, minimoMs: number, quem: string, agora = Date.now(),
): Promise<{ ok: true } | { ok: false; esperaMs: number }> {
  const marca = { em: new Date(agora).toISOString(), por: quem };
  const atual = await lerLinha<{ em?: string }>(chave);
  if (!atual) {
    const r = await reivindicar(chave, marca, marca.em);
    if (r === 'ok') return { ok: true };
    if (r === 'erro') throw new ErroLivro('insert');
    return { ok: false, esperaMs: minimoMs };
  }
  const t = Date.parse(String(atual.value?.em ?? ''));
  if (Number.isFinite(t) && agora - t < minimoMs) return { ok: false, esperaMs: minimoMs - (agora - t) };
  return (await trocarSe(chave, marca, atual.updated_at, marca.em)) !== null ? { ok: true } : { ok: false, esperaMs: minimoMs };
}

// ── erro da Meta e parada compartilhada ──────────────────────────────────────

export interface ErroMeta { http: number; codigo: number | null; subcodigo: number | null; mensagem: string; rede: boolean }

/** Lê o corpo de erro do Graph (`{error:{code,error_subcode,message}}`) mesmo quando vem dentro de um texto de erro. */
export function lerErroMeta(http: number, corpo: unknown): ErroMeta {
  let texto = '';
  let j: any = null;
  if (corpo && typeof corpo === 'object') j = corpo;
  else if (typeof corpo === 'string') {
    texto = corpo;
    try { j = JSON.parse(corpo); } catch {
      const m = /\{.*\}/s.exec(corpo);
      if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
    }
  }
  const e = j?.error ?? null;
  let codigo = Number.isFinite(Number(e?.code)) && e?.code !== undefined ? Number(e.code) : null;
  if (codigo === null && texto) { const m = /"code"\s*:\s*(\d+)/.exec(texto); if (m) codigo = Number(m[1]); }
  const sub = Number.isFinite(Number(e?.error_subcode)) && e?.error_subcode !== undefined ? Number(e.error_subcode) : null;
  const mensagem = String(e?.message ?? texto ?? '').slice(0, 200);
  return { http, codigo, subcodigo: sub, mensagem, rede: false };
}

export const erroDeRede = (mensagem: string): ErroMeta => ({ http: 0, codigo: null, subcodigo: null, mensagem: mensagem.slice(0, 200), rede: true });

/** Erro que PARA a conta por 15 min (limite de chamadas, spam, bloqueio de ação). */
export const codigoParaParar = (codigo: number | null): boolean => codigo !== null && REGRAS_REDES.paradaMeta.codigos.includes(codigo);

/** Erro de cota de publicação (Reels por dia): para a conta até o dia seguinte. */
export function erroDeCota(e: ErroMeta): boolean {
  return e.codigo === 9 || e.subcodigo === 2207042 || /publishing limit|limite de publica|reached the maximum|daily limit/i.test(e.mensagem);
}

export const chaveParada = (rede: RedeMeta): string => `redes_parada:${rede}`;
export const chaveCota = (rede: RedeMeta): string => `redes_cota:${rede}`;

/** Parada vigente da conta (a mesma para publicar e para responder): quando abre e por quê. */
export async function paradaVigente(rede: RedeMeta, agora = Date.now()): Promise<{ ate: number; motivo: string } | null> {
  const [p, c] = await Promise.all([lerLinha<{ ate?: string; codigo?: number }>(chaveParada(rede)), lerLinha<{ ate?: string }>(chaveCota(rede))]);
  const tp = Date.parse(String(p?.value?.ate ?? ''));
  const tc = Date.parse(String(c?.value?.ate ?? ''));
  const cand: Array<{ ate: number; motivo: string }> = [];
  if (Number.isFinite(tp) && tp > agora) cand.push({ ate: tp, motivo: `parada_meta_${p?.value?.codigo ?? 'x'}` });
  if (Number.isFinite(tc) && tc > agora) cand.push({ ate: tc, motivo: 'cota_de_publicacao' });
  if (!cand.length) return null;
  return cand.sort((a, b) => b.ate - a.ate)[0]!;
}

/** Grava a parada. Falha de gravação é logada por quem chama; aqui só tenta duas vezes. */
export async function registrarParada(rede: RedeMeta, e: ErroMeta, agora = Date.now()): Promise<'parada' | 'cota' | null> {
  const cota = erroDeCota(e);
  if (!cota && !codigoParaParar(e.codigo)) return null;
  const chave = cota ? chaveCota(rede) : chaveParada(rede);
  const ate = cota ? inicioDoProximoDiaBrt(agora) : agora + REGRAS_REDES.paradaMeta.paradaMs;
  const linha = { key: chave, value: { ate: new Date(ate).toISOString(), codigo: e.codigo, em: new Date(agora).toISOString() }, updated_at: new Date(agora).toISOString() };
  for (let i = 0; i < 2; i++) {
    const { error } = await supabase.from('system_state').upsert(linha, { onConflict: 'key' });
    if (!error) break;
  }
  return cota ? 'cota' : 'parada';
}

/** Mensagem curta para a tela, sem número de código nem texto cru da Meta. */
export function textoDaParada(motivo: string, ate: number): string {
  const hora = new Date(ate - BRT_MS).toISOString().slice(11, 16);
  return motivo === 'cota_de_publicacao'
    ? 'A cota de publicação da conta acabou por hoje. Abre amanhã.'
    : `A Meta pediu uma pausa nesta conta. Abre às ${hora} (Brasília).`;
}

/** Hora em Brasília (HH:MM) de um instante, para mensagem de tela. */
export const horaBrt = (t: number): string => new Date(t - BRT_MS).toISOString().slice(11, 16);

/** Texto vindo do navegador: só string de verdade (lista, objeto e número não passam). */
export function textoSimples(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > max ? null : t;
}
