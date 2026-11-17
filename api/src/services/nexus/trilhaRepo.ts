// Acesso ao banco da Trilha do Parceiro NEXUS (banco PRINCIPAL, service role). As tabelas nascem da MIGRATION_nexus_trilha.sql,
// que só o dono roda: até lá a sonda abaixo mantém a trilha DESLIGADA e o portal funciona como sempre. NEXUS_TRILHA_OFF=1 também desliga.
// Toda função recebe o userId já resolvido pela rota (req.userId): nada aqui aceita id vindo do corpo da requisição.

import { supabase } from '../../utils/supabase';
import { ErroBanco, Linha, colunaAusente, separarCidadeUf, tabelaAusente } from './repositorio';
import { contaPaga } from '../solardoc/linkDeSenha';
import { LinhaTrilha, TrilhaNivel, comLegado, faltasDeLegado, nivelDaTrilha } from './trilha';

// ── Sonda "a trilha existe?" com cache de 60 s ───────────────────────────────
const TTL_SONDA_MS = 60_000;
let sonda: { ligada: boolean; ate: number } | null = null;

export function resetSondaTrilha(): void {
  sonda = null;
}

/** A tabela sumiu no meio do caminho: desliga só a trilha (nunca o portal) por 60 s. */
export function marcarTrilhaAusente(): void {
  sonda = { ligada: false, ate: Date.now() + TTL_SONDA_MS };
}

/** Trilha ligada = as duas tabelas existem E NEXUS_TRILHA_OFF não é '1'. Erro passageiro do banco não grava no cache (e, sem cache, vale desligada). */
export async function trilhaLigada(): Promise<boolean> {
  if (process.env.NEXUS_TRILHA_OFF === '1') return false;
  const agora = Date.now();
  if (sonda && sonda.ate > agora) return sonda.ligada;
  try {
    const rs = await Promise.all([
      supabase.from('nexus_trilha').select('user_id').limit(1),
      supabase.from('nexus_trilha_eventos').select('id').limit(1),
    ]);
    if (rs.some((r) => tabelaAusente(r.error) || colunaAusente(r.error))) {
      sonda = { ligada: false, ate: agora + TTL_SONDA_MS };
      return false;
    }
    if (rs.some((r) => r.error)) return sonda?.ligada ?? false;
    sonda = { ligada: true, ate: agora + TTL_SONDA_MS };
    return true;
  } catch {
    return sonda?.ligada ?? false;
  }
}

// ── Leituras ─────────────────────────────────────────────────────────────────
export async function lerTrilha(userId: string): Promise<LinhaTrilha | null> {
  const { data, error } = await supabase.from('nexus_trilha').select('*').eq('user_id', userId).limit(1);
  if (error) throw new ErroBanco(error, 'leitura da trilha');
  return ((data as Linha[] | null) ?? [])[0] ?? null;
}

export interface EventoDaTrilha { tipo: string; dados: Record<string, unknown>; autor: string }

export async function registrarEventos(userId: string, eventos: EventoDaTrilha[]): Promise<void> {
  if (!eventos.length) return;
  const agora = new Date().toISOString();
  const { error } = await supabase.from('nexus_trilha_eventos').insert(eventos.map((e) => ({ user_id: userId, tipo: e.tipo, dados: e.dados, autor: e.autor, created_at: agora })));
  if (error) throw new ErroBanco(error, 'gravação do histórico da trilha');
}

export async function lerEventos(userId: string, limite = 300): Promise<Linha[]> {
  const { data, error } = await supabase.from('nexus_trilha_eventos').select('id, tipo, dados, autor, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limite);
  if (error) throw new ErroBanco(error, 'leitura do histórico da trilha');
  return (data as Linha[] | null) ?? [];
}

/** updated_at novo: nunca igual ao lido (é a "versão" da linha que trava a escrita concorrente). */
const proximaVersao = (anterior: unknown): string => new Date(Math.max(Date.now(), (Date.parse(String(anterior ?? '')) || 0) + 1)).toISOString();

/**
 * Garante a linha do parceiro em nexus_trilha e o LEGADO, tudo neste lugar só. Quem JÁ comprou carregador (carregadores_comprados >= 1)
 * tem os patamares 1 a 4 reconhecidos: sem isso perderia o pedido no dia em que a trilha ligasse. O legado vale na criação E depois
 * (pedido confirmado com a trilha já ligada). A gravação é condicional (`.is(coluna, null)`): se duas chamadas correm juntas, só uma
 * grava e só ela registra o evento `legado`.
 * Só as rotas DA TRILHA chamam isto. Quem só confere liberação usa estadoParaNivel, que lê e nunca grava.
 */
export async function garantirTrilha(parceiro: Linha): Promise<LinhaTrilha> {
  const userId = String(parceiro.user_id);
  let t = await lerTrilha(userId);
  if (!t) {
    const agora = new Date().toISOString();
    const ins = await supabase.from('nexus_trilha').insert({ user_id: userId, raio_x: {}, mentoria_encontros: 0, academia: {}, ultimo_movimento_em: agora, created_at: agora, updated_at: agora }).select('*').single();
    if (ins.error) {
      if ((ins.error as { code?: string }).code !== '23505') throw new ErroBanco(ins.error, 'criação da trilha'); // 23505: outra chamada criou primeiro
      const outra = await lerTrilha(userId);
      if (!outra) throw new ErroBanco(ins.error, 'criação da trilha');
      t = outra;
    } else t = ins.data as LinhaTrilha;
  }
  const falta = faltasDeLegado(parceiro, t);
  if (!falta.length) return t;
  const agora = new Date().toISOString();
  const up = await supabase.from('nexus_trilha')
    .update({ ...Object.fromEntries(falta.map((c) => [c, agora])), ultimo_movimento_em: agora, updated_at: proximaVersao(t.updated_at) })
    .eq('user_id', userId).is(falta[0]!, null).select('*');
  if (up.error) throw new ErroBanco(up.error, 'legado da trilha');
  const gravada = ((up.data as LinhaTrilha[] | null) ?? [])[0];
  if (!gravada) return (await lerTrilha(userId)) ?? t; // outra chamada já gravou o legado
  await registrarEventos(userId, [{ tipo: 'legado', dados: { patamares: falta.map((c) => Number(c[1])) }, autor: 'sistema' }]);
  return gravada;
}

export type Decisao<R = unknown> =
  | { tipo: 'gravar'; patch: Record<string, unknown>; eventos?: EventoDaTrilha[]; resultado?: R }
  | { tipo: 'sem_mudanca'; resultado?: R }
  | { tipo: 'recusar'; status: number; corpo: Record<string, unknown> };

const TENTATIVAS = 5;

/**
 * Único caminho de escrita da trilha. `decidir` recebe a linha ATUAL e devolve o que gravar (só os campos que mudam). A gravação
 * é condicional à versão lida (`updated_at`): se outra chamada gravou no meio, nada é escrito, a linha é relida e `decidir` roda de
 * novo sobre o estado novo (por isso dois cliques seguidos em "encontro" somam 2, e o JSON da Academia não perde aula). O evento só
 * é gravado por quem de fato gravou, então nunca sai duplicado.
 */
export async function atualizarTrilha<R = unknown>(parceiro: Linha, decidir: (t: LinhaTrilha) => Decisao<R>): Promise<{ t: LinhaTrilha; decisao: Decisao<R> }> {
  const userId = String(parceiro.user_id);
  let t = await garantirTrilha(parceiro);
  for (let i = 0; i < TENTATIVAS; i++) {
    const decisao = decidir(t);
    if (decisao.tipo !== 'gravar') return { t, decisao };
    const agora = new Date().toISOString();
    let q = supabase.from('nexus_trilha').update({ ...decisao.patch, ultimo_movimento_em: agora, updated_at: proximaVersao(t.updated_at) }).eq('user_id', userId);
    q = t.updated_at ? q.eq('updated_at', t.updated_at) : q.is('updated_at', null);
    const up = await q.select('*');
    if (up.error) throw new ErroBanco(up.error, 'gravação da trilha');
    const gravada = ((up.data as LinhaTrilha[] | null) ?? [])[0];
    if (gravada) {
      await registrarEventos(userId, decisao.eventos ?? []);
      return { t: gravada, decisao };
    }
    t = (await lerTrilha(userId)) ?? t; // perdeu a corrida: relê e decide de novo
  }
  return { t, decisao: { tipo: 'recusar', status: 409, corpo: { erro: 'tente_de_novo' } } };
}

/** Plano pago ativo? Usa a regra que a casa já tem (`contaPaga`): free ativo NÃO conta. */
export async function assinanteDe(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('users').select('plano, billing_status, plano_expira_em').eq('id', userId).limit(1);
  if (error) throw new ErroBanco(error, 'leitura do plano');
  return contaPaga(((data as Linha[] | null) ?? [])[0] ?? null);
}

/** Dos ids citados, quais são mesmo clientes DESTE usuário. */
export async function clientesDoUsuario(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from('clients').select('id').eq('user_id', userId).in('id', ids);
  if (error) throw new ErroBanco(error, 'conferência dos clientes');
  return new Set(((data as Linha[] | null) ?? []).map((c) => String(c.id).toLowerCase()));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Itens que citam `cliente_id` (clientes em vista do Raio-X, pedido de reunião): preenche nome, cidade e UF que faltarem com a linha de
 * `clients` DO PRÓPRIO USUÁRIO, antes de validar. `cliente_id` que não é deste usuário (ou não existe) marca `invalido`: nada é preenchido
 * a partir da linha de outra conta. O que o parceiro já mandou nunca é sobrescrito.
 */
export async function completarComClientes(userId: string, itens: unknown[], chaveNome: 'nome' | 'cliente_nome'): Promise<{ itens: unknown[]; invalido: boolean }> {
  const ehObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const ids = [...new Set(itens.filter(ehObj).map((x) => x.cliente_id).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase()))];
  if (!ids.length) return { itens, invalido: false };
  const { data, error } = await supabase.from('clients').select('id, nome, cidade, uf').eq('user_id', userId).in('id', ids);
  if (error) throw new ErroBanco(error, 'leitura dos clientes');
  const donos = new Map(((data as Linha[] | null) ?? []).map((c) => [String(c.id).toLowerCase(), c]));
  let invalido = false;
  const out = itens.map((x) => {
    if (!ehObj(x) || typeof x.cliente_id !== 'string' || !UUID_RE.test(x.cliente_id)) return x;
    const c = donos.get(x.cliente_id.toLowerCase());
    if (!c) { invalido = true; return x; }
    const local = separarCidadeUf(c.cidade, c.uf);
    const vazio = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
    return {
      ...x,
      ...(vazio(x[chaveNome]) && c.nome ? { [chaveNome]: String(c.nome) } : {}),
      ...(vazio(x.cidade) && local.cidade ? { cidade: local.cidade } : {}),
      ...(vazio(x.uf) && local.uf ? { uf: local.uf } : {}),
    };
  });
  return { itens: out, invalido };
}

/** A proposta NEXUS (nexus_propostas) é deste usuário? */
export async function propostaDoUsuario(userId: string, propostaId: string): Promise<boolean> {
  const { data, error } = await supabase.from('nexus_propostas').select('id').eq('user_id', userId).eq('id', propostaId).limit(1);
  if (error) throw new ErroBanco(error, 'conferência da proposta');
  return ((data as Linha[] | null) ?? []).length > 0;
}

/**
 * Para o niveis.ts: o estado da trilha deste parceiro, ou null quando ela está desligada. SÓ LÊ: sem linha, ou com o legado ainda
 * por gravar, o estado é calculado em memória (patamar 1, ou os patamares 1 a 4 se já comprou). A linha é criada só pelas rotas da trilha.
 */
export async function estadoParaNivel(parceiro: Linha): Promise<TrilhaNivel | null> {
  if (!(await trilhaLigada())) return null;
  try {
    return nivelDaTrilha(comLegado(parceiro, await lerTrilha(String(parceiro.user_id))), Number(parceiro.carregadores_comprados) || 0);
  } catch (e) {
    if (e instanceof ErroBanco && tabelaAusente(e.causa)) { marcarTrilhaAusente(); return null; }
    throw e;
  }
}

/** O mesmo, para vários parceiros de uma vez (a lista de aptos da equipe): leitura em lote, nunca grava. Null = trilha desligada. */
export async function estadosParaNivel(parceiros: Linha[]): Promise<Map<string, TrilhaNivel> | null> {
  if (!(await trilhaLigada())) return null;
  try {
    const linhas = new Map<string, LinhaTrilha>();
    for (let i = 0; i < parceiros.length; i += 150) {
      const ids = parceiros.slice(i, i + 150).map((p) => String(p.user_id));
      const { data, error } = await supabase.from('nexus_trilha').select('*').in('user_id', ids);
      if (error) throw new ErroBanco(error, 'leitura em lote da trilha');
      for (const t of (data as LinhaTrilha[] | null) ?? []) linhas.set(String(t.user_id), t);
    }
    return new Map(parceiros.map((p) => [String(p.user_id), nivelDaTrilha(comLegado(p, linhas.get(String(p.user_id)) ?? null), Number(p.carregadores_comprados) || 0)]));
  } catch (e) {
    if (e instanceof ErroBanco && tabelaAusente(e.causa)) { marcarTrilhaAusente(); return null; }
    throw e;
  }
}
