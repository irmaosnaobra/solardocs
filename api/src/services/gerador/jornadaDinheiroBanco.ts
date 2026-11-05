// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): o BANCO do dinheiro da obra. Lê e grava `fin:<card>:<id>` (lançamentos assinados) e a
// chave `jornada_solar_ajustes` (a regra das comissões), ambos no `system_state` do banco PRINCIPAL.
//
// Importa só o cliente do banco e o `jornadaDinheiro` (puro). Nada aqui põe valor, nome ou texto em log: só o código.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { ErroJornada } from './jornadaSolarBanco';
import { FIN_PREFIX, chaveLancamento, prefixoDoCard } from './financeiroCliente';
import {
  AJUSTES_PADRAO, ajustesAssinados, assinarAjustes, lancamentoObraAssinado, normalizarAjustes, temDinheiroVivo,
  type AjustesSolar, type LancamentoObra,
} from './jornadaDinheiro';

const PAGINA = 1000;
const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

// ── Os lançamentos de UMA obra ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Todos os lançamentos do card (`fin:<card>:%`), em páginas de 1000. O que tem assinatura válida entra; o resto fica FORA da conta e
 * conta em `ignoradas` (que trava o fechamento). A chave manda: a linha só vale se o `id` de dentro concorda com a chave.
 */
export async function lerLancamentosDaObra(card: number): Promise<{ lancamentos: LancamentoObra[]; ignoradas: number }> {
  const prefixo = prefixoDoCard(card);
  const lancamentos: LancamentoObra[] = [];
  let ignoradas = 0;
  for (let de = 0; de < 100_000; de += PAGINA) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${prefixo}%`).order('key', { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      if (!String(l.key).startsWith(prefixo)) continue;
      const v = lancamentoObraAssinado(card, l.value);
      if (v && l.key === chaveLancamento(card, v.id)) lancamentos.push(v);
      else ignoradas++;
    }
    if (lote.length < PAGINA) break;
  }
  return { lancamentos, ignoradas };
}

/** Um lançamento só, se a assinatura confere. */
export async function lerLancamentoObra(card: number, id: string): Promise<LancamentoObra | null> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', chaveLancamento(card, id)).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown } | null;
  return l ? lancamentoObraAssinado(card, l.value) : null;
}

/** Um lançamento só, com a versão (`updated_at`) para a gravação com trava. */
export async function lerLancamentoObraComVersao(card: number, id: string): Promise<{ l: LancamentoObra | null; versao: string | null }> {
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chaveLancamento(card, id)).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const r = data as { value?: unknown; updated_at?: string | null } | null;
  return r ? { l: lancamentoObraAssinado(card, r.value), versao: r.updated_at ?? '' } : { l: null, versao: null };
}

/** UPDATE do lançamento já reassinado (só a marca de conferência muda), com a trava do `updated_at`. false = outra gravação chegou antes. */
export async function atualizarLancamentoObra(l: LancamentoObra, versaoLida: string): Promise<boolean> {
  const alvo = supabase.from('system_state').update({ value: l, updated_at: new Date().toISOString() }).eq('key', chaveLancamento(l.card_id, l.id));
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroJornada(codigoDe(error));
  return Array.isArray(data) && data.length > 0;
}

/** INSERT. true = gravou; false = a chave já existia (23505): outra requisição chegou primeiro com o mesmo id. */
export async function inserirLancamentoObra(l: LancamentoObra): Promise<boolean> {
  const { error } = await supabase.from('system_state').insert({ key: chaveLancamento(l.card_id, l.id), value: l, updated_at: new Date().toISOString() });
  if (!error) return true;
  if (codigoDe(error) === '23505') return false;
  throw new ErroJornada(codigoDe(error));
}

// ── A busca global (qualquer card do `fin:`, solar ou eletroposto) ─────────────────────────────────────────────────────

interface LinhaLeve { key: string; sha: string | null; idt: string | null; id: string | null; card: string | null; apagado: string | null; est: string | null }

async function varrerFin(): Promise<LinhaLeve[]> {
  const todas: LinhaLeve[] = [];
  for (let de = 0; de < 200_000; de += PAGINA) {
    const { data, error } = await supabase.from('system_state')
      .select('key, sha:value->arquivo->>sha256, idt:value->>id_transacao, id:value->>id, card:value->>card_id, apagado:value->>apagado, est:value->obra->>estorno_de')
      .like('key', `${FIN_PREFIX}%`).order('key', { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as unknown as LinhaLeve[];
    for (const l of lote) if (String(l.key).startsWith(FIN_PREFIX)) todas.push(l);
    if (lote.length < PAGINA) break;
  }
  return todas;
}

export interface AchadoGlobal { card: number; id: string }

/**
 * Uma linha VIVA com o mesmo sha256 de arquivo e/ou o mesmo ID de transação, em qualquer card. Viva = não apagada e nenhuma outra linha do mesmo
 * card a estorna. A original estornada fica de fora (quem lançou errado relança o mesmo comprovante); a linha de estorno com arquivo (devolução) conta.
 * Não filtra por assinatura: o card de eletroposto não tem.
 */
export async function buscarNoFinanceiro(sha: string, idt: string): Promise<{ comprovante: AchadoGlobal | null; transacoes: AchadoGlobal[] }> {
  const linhas = await varrerFin();
  const estornadas = new Set<string>();
  for (const l of linhas) if (l.est) estornadas.add(`${l.card}:${l.est}`);
  // Fica de fora só a ORIGINAL estornada (e a apagada). A linha de estorno que tem arquivo próprio (a devolução) conta: o PDF dela não serve de gasto em outra obra.
  const viva = (l: LinhaLeve): boolean => l.apagado !== 'true' && !!l.id && !estornadas.has(`${l.card}:${l.id}`);
  const achado = (l: LinhaLeve): AchadoGlobal | null => {
    const card = Number(l.card);
    return Number.isInteger(card) && card > 0 && l.id ? { card, id: l.id } : null;
  };
  let comprovante: AchadoGlobal | null = null;
  const transacoes: AchadoGlobal[] = [];
  for (const l of linhas) {
    if (!viva(l)) continue;
    const a = achado(l);
    if (!a) continue;
    if (!comprovante && sha && l.sha === sha) comprovante = a;
    if (idt && l.idt && l.idt.trim() === idt) transacoes.push(a);
  }
  return { comprovante, transacoes };
}

export const buscarComprovanteVivo = async (sha: string): Promise<AchadoGlobal | null> => (await buscarNoFinanceiro(sha, '')).comprovante;
export const buscarIdTransacao = async (idt: string): Promise<AchadoGlobal[]> => (await buscarNoFinanceiro('', idt)).transacoes;

// ── O resumo da lista (só o ADM) ────────────────────────────────────────────────────────────────────────────────────────

export interface ResumoDinheiro { recebido: number; gasto: number; retirada: number }

/** Uma varredura de `fin:%`: só as linhas SOLARES assinadas, agrupadas por card, com o estorno subtraindo. */
export async function lerResumoDoDinheiro(): Promise<Map<number, ResumoDinheiro>> {
  const mapa = new Map<number, ResumoDinheiro>();
  for (let de = 0; de < 200_000; de += PAGINA) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${FIN_PREFIX}%`).order('key', { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const v = obj(l.value);
      const card = typeof v?.card_id === 'number' ? v.card_id : 0;
      if (!String(l.key).startsWith(FIN_PREFIX) || !v || !obj(v.obra) || card <= 0) continue;
      const s = lancamentoObraAssinado(card, l.value);
      if (!s || l.key !== chaveLancamento(card, s.id)) continue;
      const r = mapa.get(card) ?? { recebido: 0, gasto: 0, retirada: 0 };
      const val = s.obra.estorno_de ? -s.valor_centavos : s.valor_centavos;
      if (s.obra.grupo === 'entrada') r.recebido += val;
      else if (s.obra.grupo === 'retirada') r.retirada += val;
      else r.gasto += val;
      mapa.set(card, r);
    }
    if (lote.length < PAGINA) break;
  }
  return mapa;
}

/**
 * Os cards que têm lançamento de dinheiro VIVO e não estornado (`temDinheiroVivo`): uma varredura de `fin:%`, só linhas SOLARES assinadas.
 * Serve à regra das vendas finalizadas (obra com dinheiro lançado é trabalho de gente). Falha de leitura lança `ErroJornada`.
 */
export async function lerCardsComDinheiroVivo(): Promise<Set<number>> {
  const porCard = new Map<number, LancamentoObra[]>();
  for (let de = 0; de < 200_000; de += PAGINA) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${FIN_PREFIX}%`).order('key', { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const v = obj(l.value);
      const card = typeof v?.card_id === 'number' ? v.card_id : 0;
      if (!String(l.key).startsWith(FIN_PREFIX) || !v || !obj(v.obra) || card <= 0) continue;
      const s = lancamentoObraAssinado(card, l.value);
      if (!s || l.key !== chaveLancamento(card, s.id)) continue;
      const lista = porCard.get(card) ?? [];
      lista.push(s);
      porCard.set(card, lista);
    }
    if (lote.length < PAGINA) break;
  }
  return new Set([...porCard].filter(([, ls]) => temDinheiroVivo(ls)).map(([card]) => card));
}

// ── Os Ajustes (`jornada_solar_ajustes`) ────────────────────────────────────────────────────────────────────────────────

export const CHAVE_AJUSTES = 'jornada_solar_ajustes';

/** `valido`: false só quando a linha existe e a assinatura não confere (vale o padrão). Sem linha, o padrão é legítimo. */
export async function lerAjustes(): Promise<{ ajustes: AjustesSolar; valido: boolean; versao: string | null }> {
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', CHAVE_AJUSTES).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  if (!l) return { ajustes: AJUSTES_PADRAO, valido: true, versao: null };
  const a = ajustesAssinados(l.value);
  return a ? { ajustes: a, valido: true, versao: l.updated_at ?? '' } : { ajustes: AJUSTES_PADRAO, valido: false, versao: l.updated_at ?? '' };
}

/** Grava os Ajustes assinados, com compare-and-swap pelo `updated_at`. Até 4 voltas; perdeu as 4: `ErroJornada('ocupado')`. */
export async function gravarAjustes(a: Pick<AjustesSolar, 'comissoes' | 'dinheiro_aberto'>, por: string): Promise<AjustesSolar> {
  for (let t = 0; t < 4; t++) {
    const { versao } = await lerAjustes();
    const agora = new Date().toISOString();
    const n = normalizarAjustes({ v: 1, comissoes: a.comissoes, dinheiro_aberto: a.dinheiro_aberto, editado_em: agora, editado_por: por });
    const sig = n ? assinarAjustes(n) : null;
    if (!n || !sig) throw new ErroJornada('sem_segredo');
    const value = { ...n, sig };
    if (versao === null) {
      const { error } = await supabase.from('system_state').insert({ key: CHAVE_AJUSTES, value, updated_at: agora });
      if (!error) return n;
      if (codigoDe(error) !== '23505') throw new ErroJornada(codigoDe(error));
      continue;
    }
    const alvo = supabase.from('system_state').update({ value, updated_at: agora }).eq('key', CHAVE_AJUSTES);
    const { data, error } = await (versao === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versao)).select('key');
    if (error) throw new ErroJornada(codigoDe(error));
    if (Array.isArray(data) && data.length > 0) return n;
  }
  throw new ErroJornada('ocupado');
}
