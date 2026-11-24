// O TETO, A JANELA E OS PENDENTES DOS AVISOS DA LISTA DO INSTAGRAM (19/11/2026, condições 9, 10 e 11 do chefe anti-ban).
// Este arquivo NÃO envia nada: só lê e escreve chaves na system_state (sem dado pessoal: só id de card e de lista).
//   · vaga: 1 lead avisado por balde de 5 min de Brasília (`io_lista_vaga:<AAAA-MM-DD HH:M5>`, INSERT; o valor diz quantas
//     mensagens a vaga gasta: lead de eletroposto = 2, solar e resumo = 1). Antes do INSERT: no máximo 12 mensagens por hora e 60
//     em 24 h somando Nilce, Thiago e Diego, e nenhuma se a linha inteira (prefixosTotalDaLinha) já tem 40 carimbos na hora.
//   · janela: Nilce dentro de horarioAgoraAberto (o atendimento do quiz); Thiago e Diego das 7h às 21h de Brasília.
//   · pendente: `io_lista_pend:<pessoa>:<card>` = quem ficou sem aviso; sai no resumo (listaIgAviso.runListaIgResumoTick).
//   · card: `io_lista_card:<porta>:<id da lista>` = o claim do card (um por pessoa, mesmo com dois cadastros ao mesmo tempo).

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { linhaEmCooldown } from '../agents/zapiClient';
import { prefixosTotalDaLinha } from '../agents/whatsapp/lineThrottle';
import { linhaPausada } from '../agentes5040/vivoEnvio';
import { horarioAgoraAberto } from './solarQuiz';

export type PessoaLista = 'nilce' | 'giovanna' | 'thiago' | 'diego';
export const PREFIXO_VAGA = 'io_lista_vaga:';
export const PREFIXO_ENV = 'io_lista_env:';
export const PREFIXO_PEND = 'io_lista_pend:';
export const PREFIXO_CARD = 'io_lista_card:';
export const TETO = Object.freeze({ hora: 12, dia: 60, linhaHora: 40 });
const LOG = 'io-lista-ig';
const HORA = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const brt = (ms: number): string => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** O balde de 5 min de Brasília: 'AAAA-MM-DD HH:MM' com o minuto cortado no múltiplo de 5. */
export function baldeDe5(ms: number): string {
  const s = brt(ms);
  const min = Number(s.slice(14, 16));
  return `${s.slice(0, 14)}${String(min - (min % 5)).padStart(2, '0')}`;
}

export function dentroDaJanela(pessoa: PessoaLista, ms: number): boolean {
  if (pessoa === 'nilce' || pessoa === 'giovanna') return horarioAgoraAberto(ms);
  const h = Number(brt(ms).slice(11, 13));
  return h >= 7 && h < 21;
}

/** Linha fora de cooldown e sem a pausa por erros seguidos (ag5040_linha_pausa). Leitura que falha = não. */
export async function linhaPronta(ms: number): Promise<boolean> {
  if (linhaEmCooldown('io')) return false;
  try { return (await linhaPausada(new Date(ms))) === 'nao'; } catch { return false; }
}

/** INSERT com chave única. 'ja' = a chave existia (23505). */
export async function inserir(key: string, value: Record<string, unknown>, ms: number): Promise<'ok' | 'ja' | 'erro'> {
  try {
    const { error } = await supabase.from('system_state').insert({ key, value, updated_at: iso(ms) });
    if (!error) return 'ok';
    return (error as { code?: string }).code === '23505' ? 'ja' : 'erro';
  } catch { return 'erro'; }
}

export async function apagar(key: string): Promise<void> {
  try { await supabase.from('system_state').delete().eq('key', key); } catch (err) {
    logger.error(LOG, `apagar ${key.split(':')[0]} falhou`, String((err as { code?: string } | null)?.code ?? ''));
  }
}

/** Reserva `n` mensagens no balde de 5 min. 'teto' = balde tomado, 12/h, 60/24 h ou linha com 40 na hora. 'erro' = leitura falhou (não envia). */
export async function reservarVaga(n: number, agora: number): Promise<'ok' | 'teto' | 'erro'> {
  try {
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at')
      .like('key', `${PREFIXO_VAGA}%`).gte('updated_at', iso(agora - 24 * HORA)).limit(500);
    if (error) return 'erro';
    const linhas = (data ?? []) as Array<{ value?: { n?: number } | null; updated_at?: string }>;
    const soma = (desde: number): number => linhas
      .filter(l => String(l.updated_at ?? '') >= iso(desde)).reduce((t, l) => t + (Number(l.value?.n) || 1), 0);
    if (soma(agora - HORA) + n > TETO.hora || soma(agora - 24 * HORA) + n > TETO.dia) return 'teto';
    const filtro = prefixosTotalDaLinha().map(p => `key.like.${p}%`).join(',');
    const linha = await supabase.from('system_state').select('key').or(filtro).gte('updated_at', iso(agora - HORA)).limit(TETO.linhaHora);
    if (linha.error) return 'erro';
    if ((linha.data ?? []).length >= TETO.linhaHora) return 'teto';
    const r = await inserir(`${PREFIXO_VAGA}${baldeDe5(agora)}`, { n, em: iso(agora) }, agora);
    return r === 'ok' ? 'ok' : r === 'ja' ? 'teto' : 'erro';
  } catch { return 'erro'; }
}

export async function deixarPendente(pessoas: PessoaLista[], cardId: number, porta: 'solar' | 'eletroposto', agora: number): Promise<void> {
  for (const p of pessoas) await inserir(`${PREFIXO_PEND}${p}:${cardId}`, { card: cardId, porta, em: iso(agora) }, agora);
}

export interface Pendente { key: string; card: number; porta: 'solar' | 'eletroposto' }

/** Os pendentes da pessoa, do mais velho ao mais novo. null = a leitura falhou. */
export async function lerPendentes(pessoa: PessoaLista): Promise<Pendente[] | null> {
  try {
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at')
      .like('key', `${PREFIXO_PEND}${pessoa}:%`).order('updated_at', { ascending: true }).limit(50);
    if (error) return null;
    return ((data ?? []) as Array<{ key: string; value?: { card?: number; porta?: string } | null }>)
      .map(l => ({ key: l.key, card: Number(l.value?.card), porta: l.value?.porta === 'solar' ? 'solar' as const : 'eletroposto' as const }))
      .filter(p => Number.isInteger(p.card) && p.card > 0);
  } catch { return null; }
}
