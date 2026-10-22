// Leitura e gravação dos registros da Gestão de clientes em `system_state`
// (banco principal), uma chave por venda: `gestao_cliente:<NNNN>`. Sem tabela nova.
//
// Nada daqui põe valor de célula em mensagem de erro: o driver pode devolver o
// registro no texto do erro, então só o CÓDIGO do erro sobe.
import { supabase } from '../../utils/supabase';
import { chaveGestao, codigoDaChave, lerRegistro, type RegistroGestao } from './gestaoClientes';

const POR_CONSULTA = 150;   // o PostgREST estoura a URL antes do teto de linhas (mesmo lote de geradorSolar)

export class ErroGestao extends Error {
  constructor(public codigo: string) { super(`gestao-clientes: ${codigo}`); }
}
const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

/** Os registros das vendas pedidas, por código canônico. `.in` em lotes: não passa pelo corte de 1000 linhas. */
export async function lerRegistros(codigos: string[]): Promise<Map<string, RegistroGestao>> {
  const mapa = new Map<string, RegistroGestao>();
  for (let i = 0; i < codigos.length; i += POR_CONSULTA) {
    const lote = codigos.slice(i, i + POR_CONSULTA);
    const { data, error } = await supabase.from('system_state')
      .select('key, value').in('key', lote.map(chaveGestao));
    if (error) throw new ErroGestao(codigoDe(error));
    for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
      mapa.set(codigoDaChave(l.key), lerRegistro(l.value));
    }
  }
  return mapa;
}

/** O registro de UMA venda e a versão lida (o `updated_at`), para a gravação conferir que ninguém gravou no meio. */
export async function lerRegistroComVersao(codigo: string): Promise<{ reg: RegistroGestao; versao: string | null }> {
  const { data, error } = await supabase.from('system_state')
    .select('key, value, updated_at').eq('key', chaveGestao(codigo)).maybeSingle();
  if (error) throw new ErroGestao(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  return { reg: lerRegistro(l?.value), versao: l ? (l.updated_at ?? '') : null };
}

/**
 * Grava só se a linha continua igual à lida (compare-and-swap pelo `updated_at`).
 * Ler, mesclar e gravar não é atômico: duas pessoas editando células DIFERENTES da
 * mesma venda no mesmo instante perderiam uma das duas sem erro nenhum. Devolve
 * false quando perdeu a corrida (quem chama lê de novo e tenta outra vez).
 */
export async function gravarRegistro(
  codigo: string, reg: RegistroGestao, versaoLida: string | null, agora: string,
): Promise<boolean> {
  const chave = chaveGestao(codigo);
  if (versaoLida === null) {
    const { error } = await supabase.from('system_state').insert({ key: chave, value: reg, updated_at: agora });
    if (!error) return true;
    if (codigoDe(error) === '23505') return false;   // outra pessoa criou a linha agora
    throw new ErroGestao(codigoDe(error));
  }
  const alvo = supabase.from('system_state').update({ value: reg, updated_at: agora }).eq('key', chave);
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroGestao(codigoDe(error));
  return Array.isArray(data) && data.length > 0;
}

// ── Overlay da linha do /gerador (fase 2) ────────────────────────────────────
// O que se digita numa linha que só existe no /gerador mora numa chave do CARD (`gestao_gerador:<card>`), nunca na do código: se o
// Excel ganhar depois o #N de OUTRO cliente, a linha dele e as telas de Obras não herdam valores deste. Sem dado pessoal (as
// colunas pessoais dessa linha são só leitura).
export const PREFIXO_GESTAO_GERADOR = 'gestao_gerador:';
export const chaveGestaoGerador = (card: number): string => `${PREFIXO_GESTAO_GERADOR}${card}`;

/** Os overlays dos cards pedidos (card -> registro). `.in` em lotes. */
export async function lerRegistrosDoGerador(cards: number[]): Promise<Map<number, RegistroGestao>> {
  const mapa = new Map<number, RegistroGestao>();
  const unicos = [...new Set(cards.filter((c) => Number.isInteger(c) && c > 0))];
  for (let i = 0; i < unicos.length; i += POR_CONSULTA) {
    const lote = unicos.slice(i, i + POR_CONSULTA);
    const { data, error } = await supabase.from('system_state').select('key, value').in('key', lote.map(chaveGestaoGerador));
    if (error) throw new ErroGestao(codigoDe(error));
    for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
      const card = Number(String(l.key).slice(PREFIXO_GESTAO_GERADOR.length));
      if (Number.isInteger(card) && card > 0) mapa.set(card, lerRegistro(l.value));
    }
  }
  return mapa;
}

/** O overlay de UM card e a versão lida (para a gravação conferir que ninguém gravou no meio). */
export async function lerRegistroDoGeradorComVersao(card: number): Promise<{ reg: RegistroGestao; versao: string | null }> {
  const { data, error } = await supabase.from('system_state')
    .select('key, value, updated_at').eq('key', chaveGestaoGerador(card)).maybeSingle();
  if (error) throw new ErroGestao(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  return { reg: lerRegistro(l?.value), versao: l ? (l.updated_at ?? '') : null };
}

/** Grava o overlay do card com a mesma conferência de versão (compare-and-swap) de `gravarRegistro`. false = perdeu a corrida. */
export async function gravarRegistroDoGerador(card: number, reg: RegistroGestao, versaoLida: string | null, agora: string): Promise<boolean> {
  const chave = chaveGestaoGerador(card);
  if (versaoLida === null) {
    const { error } = await supabase.from('system_state').insert({ key: chave, value: reg, updated_at: agora });
    if (!error) return true;
    if (codigoDe(error) === '23505') return false;
    throw new ErroGestao(codigoDe(error));
  }
  const alvo = supabase.from('system_state').update({ value: reg, updated_at: agora }).eq('key', chave);
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroGestao(codigoDe(error));
  return Array.isArray(data) && data.length > 0;
}
