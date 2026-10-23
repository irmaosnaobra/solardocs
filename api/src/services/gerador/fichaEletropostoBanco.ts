// Leitura e gravação da ficha do eletroposto e das Obras.
//   - cards vendidos .......... banco do GERADOR, tabela `agendamentos`
//   - `cliente_ep:<id>` ....... banco principal, `system_state` (a ficha)
//   - `pos_venda:<id>` ........ banco principal, `system_state` (o mesmo que a Agenda lê)
//
// Nada daqui põe valor de campo em mensagem de erro: o driver pode devolver o registro no texto do erro,
// então só o CÓDIGO do erro sobe.
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { chavePosVenda, POS_VENDA_PREFIX } from '../agenda/posVendaEletroposto';
import { lerRegistro, type RegistroGestao } from './gestaoClientes';
import {
  chaveFichaEp, idDaChaveFichaEp, PREFIXO_FICHA_EP, ehCardVendidoEp, type CardVendido,
} from './fichaEletroposto';

const POR_CONSULTA = 100;   // 100 ids = URL curta, bem abaixo do corte de 1000 linhas do PostgREST
const COLUNAS_CARD = 'id, cliente_nome, cliente_telefone, cidade, vendedor_nome, created_by, status, created_at, quando';

export class ErroFicha extends Error {
  constructor(public codigo: string) { super(`ficha-eletroposto: ${codigo}`); }
}
const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

/** Todos os cards vendidos de eletroposto. Lê em páginas (o PostgREST corta em 1000 e ignora `.limit()`). */
export async function lerCardsVendidos(): Promise<CardVendido[]> {
  const tudo: CardVendido[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabaseGerador.from('agendamentos')
      .select(COLUNAS_CARD)
      .eq('status', 'fechou')
      .ilike('created_by', '%eletroposto%')
      .order('id', { ascending: true })
      .range(de, de + 999);
    if (error) throw new ErroFicha(codigoDe(error));
    const lote = (data ?? []) as unknown as CardVendido[];
    tudo.push(...lote);
    if (lote.length < 1000) break;
  }
  // O LIKE do banco é só um pré-filtro: a regra de verdade é a do módulo puro.
  return tudo.filter((c) => ehCardVendidoEp(c));
}

/** Um card vendido de eletroposto, ou null se não existe ou não é uma venda de eletroposto (as duas coisas são iguais para quem pede). */
export async function lerCardVendido(id: number): Promise<CardVendido | null> {
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select(COLUNAS_CARD).eq('id', id).maybeSingle();
  if (error) throw new ErroFicha(codigoDe(error));
  const c = data as unknown as CardVendido | null;
  return ehCardVendidoEp(c) ? c : null;
}

async function lerChaves(chaves: string[]): Promise<Array<{ key: string; value: unknown }>> {
  const saida: Array<{ key: string; value: unknown }> = [];
  for (let i = 0; i < chaves.length; i += POR_CONSULTA) {
    const { data, error } = await supabase.from('system_state')
      .select('key, value').in('key', chaves.slice(i, i + POR_CONSULTA));
    if (error) throw new ErroFicha(codigoDe(error));
    saida.push(...((data ?? []) as Array<{ key: string; value: unknown }>));
  }
  return saida;
}

export async function lerFichas(ids: number[]): Promise<Map<number, RegistroGestao>> {
  const mapa = new Map<number, RegistroGestao>();
  for (const l of await lerChaves(ids.map(chaveFichaEp))) {
    if (!String(l.key).startsWith(PREFIXO_FICHA_EP)) continue;
    const id = idDaChaveFichaEp(String(l.key));
    if (Number.isInteger(id)) mapa.set(id, lerRegistro(l.value));
  }
  return mapa;
}

export async function lerPosVendas(ids: number[]): Promise<Map<number, unknown>> {
  const mapa = new Map<number, unknown>();
  const prefixo = POS_VENDA_PREFIX;
  for (const l of await lerChaves(ids.map(chavePosVenda))) {
    if (!String(l.key).startsWith(prefixo)) continue;
    const id = Number(String(l.key).slice(prefixo.length));
    if (Number.isInteger(id)) mapa.set(id, l.value);
  }
  return mapa;
}

async function lerComVersao(chave: string): Promise<{ valor: unknown; versao: string | null }> {
  const { data, error } = await supabase.from('system_state')
    .select('key, value, updated_at').eq('key', chave).maybeSingle();
  if (error) throw new ErroFicha(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  return { valor: l ? l.value : null, versao: l ? (l.updated_at ?? '') : null };
}

/**
 * Grava só se a linha continua igual à lida (compare-and-swap pelo `updated_at`). Ler, mesclar e gravar não é
 * atômico: duas pessoas gravando a mesma chave no mesmo instante perderiam uma das duas sem erro nenhum.
 * Devolve false quando perdeu a corrida (quem chama lê de novo e tenta outra vez).
 */
async function gravarComVersao(chave: string, valor: unknown, versaoLida: string | null, agora: string): Promise<boolean> {
  if (versaoLida === null) {
    const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: agora });
    if (!error) return true;
    if (codigoDe(error) === '23505') return false;   // outra pessoa criou a linha agora
    throw new ErroFicha(codigoDe(error));
  }
  const alvo = supabase.from('system_state').update({ value: valor, updated_at: agora }).eq('key', chave);
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroFicha(codigoDe(error));
  return Array.isArray(data) && data.length > 0;
}

export async function lerFichaComVersao(id: number): Promise<{ reg: RegistroGestao; versao: string | null }> {
  const { valor, versao } = await lerComVersao(chaveFichaEp(id));
  return { reg: lerRegistro(valor), versao };
}
export const gravarFicha = (id: number, reg: RegistroGestao, versao: string | null, agora: string): Promise<boolean> =>
  gravarComVersao(chaveFichaEp(id), reg, versao, agora);

export async function lerPosVendaComVersao(id: number): Promise<{ valor: unknown; versao: string | null }> {
  return lerComVersao(chavePosVenda(id));
}
export const gravarPosVenda = (id: number, valor: unknown, versao: string | null, agora: string): Promise<boolean> =>
  gravarComVersao(chavePosVenda(id), valor, versao, agora);
