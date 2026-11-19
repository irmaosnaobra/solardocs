// ───────────────────────────────────────────────────────────────────────────
// MEMBROS DO MONJOUR NO ADMIN (19/11/2026), para
//   GET /admin/monjour/membros  e  GET /admin/monjour/membros/:m
// As compras vêm do site (api/admin-resumo, com o x-admin-token e o `m` de cada venda,
// janela máxima de 120 dias); o uso vem de lp_events. Site fora ou sem token: 200 com
// `indisponivel` (a lista fica vazia; a linha do tempo de um membro ainda sai, sem e-mail).
// O token só vai no cabeçalho e nunca aparece em motivo, log ou resposta.
// ───────────────────────────────────────────────────────────────────────────
import { logger } from '../../utils/logger';
import { buscarResumoNoSite, periodoParaDatas } from './resumoMonjour';
import {
  desdeDeTodos, janelaDoPeriodo, lerUsoDesde, lerUsoDoMembro, MEMBRO_VALIDO,
} from './leituraAppMonjour';
import {
  agruparUso, comprasPorMembro, montarLinhaDoTempo, montarLista, montarMembro, totaisPorAcao,
  type CompraSite, type FiltroMembros, type Membro,
} from './membrosPuro';

/** Tamanho máximo da lista devolvida: o total real vai em `total`. */
export const MAX_MEMBROS = 500;

export interface ComprasLidas {
  compras: Map<string, CompraSite[]>; indisponivel: boolean; motivo?: string; truncado: boolean;
}

/** Compras do site na janela máxima. Nunca lança: site fora vira `indisponivel`. */
export async function lerComprasDoSite(agora: Date, env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch): Promise<ComprasLidas> {
  const datas = periodoParaDatas('maximo', agora);
  const site = await buscarResumoNoSite(datas.desde, datas.ate, env, buscar);
  if (!site.ok) {
    logger.warn('monjour-membros', 'site indisponível', { motivo: site.motivo });
    return { compras: new Map(), indisponivel: true, motivo: site.motivo, truncado: false };
  }
  const vendas = (site.corpo.vendas || {}) as Record<string, unknown>;
  const lista = Array.isArray(vendas.lista) ? vendas.lista : [];
  return {
    compras: comprasPorMembro(lista), indisponivel: false,
    // O site corta a lista em 500 itens: se chegou nisso, pode faltar gente.
    truncado: site.corpo.truncado === true || lista.length >= 500,
  };
}

export interface ListaMembros {
  total: number; itens: Membro[]; truncado: boolean; indisponivel?: true; motivo?: string;
}

export async function lerMembros(
  periodo: string, filtro: FiltroMembros, agora: Date = new Date(), env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<ListaMembros> {
  // Lê os dois juntos; se o site cair, a leitura do uso para na página seguinte em vez de ir até o teto.
  let siteFora = false;
  const [site, uso] = await Promise.all([
    lerComprasDoSite(agora, env, buscar).then((x) => { siteFora = x.indisponivel; return x; }),
    lerUsoDesde(desdeDeTodos(agora), () => siteFora),
  ]);
  if (site.indisponivel) return { total: 0, itens: [], truncado: false, indisponivel: true, motivo: site.motivo };
  const todos = montarLista(site.compras, agruparUso(uso.eventos), janelaDoPeriodo(periodo, agora), agora.getTime(), filtro);
  return { total: todos.length, itens: todos.slice(0, MAX_MEMBROS), truncado: uso.truncado || site.truncado };
}

export interface DetalheMembro {
  membro: Membro; totais: { porAcao: Record<string, number> }; linha: { ts: string; acao: string; texto: string }[];
  truncado: boolean; indisponivel?: true; motivo?: string;
}

/** null quando não há compra nem uso para esse `m`. */
export async function lerMembro(
  m: string, agora: Date = new Date(), env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<DetalheMembro | null> {
  if (!MEMBRO_VALIDO.test(m)) return null;
  const [site, uso] = await Promise.all([lerComprasDoSite(agora, env, buscar), lerUsoDoMembro(m)]);
  const compras = site.compras.get(m) ?? [];
  if (!compras.length && !uso.eventos.length) return null;
  // Sem período no pedido: os dias ativos contam o uso inteiro.
  const membro = montarMembro(m, compras, uso.eventos, { desde: 0, ate: null }, agora.getTime());
  return {
    membro, totais: { porAcao: totaisPorAcao(uso.eventos) }, linha: montarLinhaDoTempo(uso.eventos), truncado: uso.truncado,
    ...(site.indisponivel ? { indisponivel: true as const, motivo: site.motivo } : {}),
  };
}
