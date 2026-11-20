// ───────────────────────────────────────────────────────────────────────────
// QUEM PASSOU EM CADA TELA DO QUIZ MONJOUR (19/11/2026), para
//   GET /admin/monjour/quiz-funil/sessoes  (chegaram ou saíram de uma tela)
//   GET /admin/monjour/quiz-funil/sessao/:sid  (a jornada de uma sessão)
// Lê os mesmos tipos de evento do funil (TIPOS_EVENTO_MONJOUR, com o app: uma sonda,
// um país ou um anúncio que só aparece num evento do app pesa igual nos dois), agrupa
// pelo mesmo serviço do funil e lista. Sessão sonda sai de tudo.
// A conta de chegaram e saíram é a do funil: chegou(n) = maior etapa >= n, saiu(n) = parou em n.
// As sessões agrupadas ficam 60 s na memória por período: trocar de página ou de aba
// não relê as 200 mil linhas.
// ───────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { inicioDoPeriodo, fimDoPeriodo } from '../io/quizFunil';
import {
  type EventoMonjour, type FiltrosMonjour, TIPOS_EVENTO_MONJOUR, PERGUNTAS_MONJOUR, TELAS_MONJOUR, N_POR_CHAVE, ETAPA_CHECKOUT, ETAPA_COMPRA,
  MEDIANA_CORTE_SEG, SEM_ANUNCIO, PASSO_ATALHO, PASSO_VOLTA, ROTULO_ATALHO, ROTULO_VOLTA, chaveDaResposta, nomeDoAnuncio, conjuntoDoAnuncio, nomeDoConjunto, nomeDoPais,
} from './monjourCatalogo';
import { agruparSessoes, chegouNaEtapa, pararamNaEtapa, type SessaoMonjour } from './sessoesMonjour';
import { passaNosFiltros } from './funilMonjourPuro';
import { lerEventosMonjour, normalizarPeriodo } from './painelQuizMonjour';

export const POR_PAGINA = 50;
export const MAX_LINHAS = 500;
/** Eventos lidos para a jornada de uma sessão: uma sessão normal tem umas 60 linhas. */
const MAX_EVENTOS_SESSAO = 1000;
const PASSO_MAX = ETAPA_COMPRA;
/** Por quanto tempo as sessões agrupadas de um período valem na memória. */
const CACHE_MS = 60_000;

export interface ItemSessao {
  sid: string; entrou: string; pais: string; paisNome: string; regiao: string; cidade: string;
  disp: string; so: string; nav: string; idade: string; objetivo: string; cuerpo: string;
  anuncio: string; conjunto: string; maxPasso: number; maxPassoRotulo: string; clicouComprar: boolean; comprou: boolean; plano: string | null;
  /** Entrou pelo atalho da tela 1, ou voltou direto à oferta: não passou pelas perguntas. */
  atalho: boolean; volta: boolean;
}

export interface LinhaJornada {
  ts: string; tipo: 'viu' | 'respondeu' | 'fim' | 'atalho'; passo: string | null; n: number | null;
  rotulo: string; resposta: string | null; segundosNaTela: number | null;
}

const texto = (v: unknown, max = 60): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const numero = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Rótulo da(s) resposta(s) de uma pergunta: valor fora da lista não é repetido, para não eco de lixo do beacon. */
export function rotuloDaResposta(chave: string, valores: string[]): string {
  const pergunta = PERGUNTAS_MONJOUR.find((p) => p.chave === chave);
  if (!pergunta) return '';
  return valores.map((v) => pergunta.opcoes.find(([o]) => o === v)?.[1] ?? 'Outra resposta').join(', ');
}

export function itemDaSessao(s: SessaoMonjour): ItemSessao {
  const resposta = (chave: string): string => rotuloDaResposta(chave, s.respostas.get(chave) ?? []);
  return {
    sid: s.id, entrou: new Date(s.primeiro).toISOString(),
    pais: s.ctx.pais, paisNome: s.ctx.pais ? nomeDoPais(s.ctx.pais) : '', regiao: s.ctx.regiao, cidade: s.ctx.cidade,
    disp: s.ctx.disp, so: s.ctx.so, nav: s.ctx.nav,
    idade: resposta('edad'), objetivo: resposta('objetivo'), cuerpo: resposta('cuerpo'),
    anuncio: nomeDoAnuncio(s.ctx.anuncio || SEM_ANUNCIO), conjunto: nomeDoConjunto(conjuntoDoAnuncio(s.ctx.anuncio)),
    maxPasso: Math.min(s.nivel, TELAS_MONJOUR.length),
    maxPassoRotulo: TELAS_MONJOUR[Math.min(s.nivel, TELAS_MONJOUR.length) - 1]?.rotulo ?? '',
    clicouComprar: s.destinos.has('checkout') || s.nivel >= ETAPA_CHECKOUT,
    comprou: s.destinos.has('compra'),
    plano: s.plano,
    atalho: s.atalho, volta: s.volta,
  };
}

export interface PedidoSessoes { passo: number; tipo: 'chegaram' | 'sairam'; filtros: FiltrosMonjour; cursor: number }
export interface PaginaSessoes { total: number; itens: ItemSessao[]; proximo: string | null; truncado: boolean }

/** Chegaram: etapa >= passo. Saíram: parou exatamente em passo (a compra, última etapa, não tem saída). */
export function listarSessoes(eventos: EventoMonjour[], pedido: PedidoSessoes, truncado = false): PaginaSessoes {
  return listarDasSessoes(agruparSessoes(eventos), pedido, truncado);
}

function listarDasSessoes(sessoes: SessaoMonjour[], pedido: PedidoSessoes, truncado: boolean): PaginaSessoes {
  const base = sessoes
    .filter((s) => s.visitante && passaNosFiltros(s, pedido.filtros))
    // A mesma conta do funil: quem foi direto à oferta (atalho ou volta) não conta nas perguntas que não viu.
    .filter((s) => (pedido.tipo === 'chegaram' ? chegouNaEtapa(s, pedido.passo) : pedido.passo < ETAPA_COMPRA && pararamNaEtapa(s, pedido.passo)))
    .sort((a, b) => b.primeiro - a.primeiro || a.id.localeCompare(b.id));
  const alcance = Math.min(base.length, MAX_LINHAS);
  const de = Math.max(0, Math.min(pedido.cursor, alcance));
  const ate = Math.min(de + POR_PAGINA, alcance);
  return {
    total: base.length,
    itens: base.slice(de, ate).map(itemDaSessao),
    proximo: ate < alcance ? String(ate) : null,
    truncado,
  };
}

/** Passo pedido: inteiro de 1 até a compra (as telas do catálogo mais clicar em comprar e comprar). */
export function passoValido(v: unknown): number | null {
  const n = numero(v);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= PASSO_MAX ? n : null;
}

// Uma entrada só (o último período lido), para não guardar vários períodos grandes na memória.
let cache: { chave: string; vale: number; sessoes: SessaoMonjour[]; truncado: boolean } | null = null;

/** Para os testes: esquece as sessões guardadas. */
export function esquecerSessoesLidas(): void { cache = null; }

export async function lerSessoesDaTela(periodo: string, pedido: PedidoSessoes, agora: Date = new Date()): Promise<PaginaSessoes> {
  const per = normalizarPeriodo(periodo);
  const desde = inicioDoPeriodo(per, agora.getTime());
  const ate = fimDoPeriodo(per, agora.getTime());
  // A chave é só o período: nos períodos móveis o início anda a cada milissegundo, e 60 s de atraso não mudam a lista.
  const chave = per;
  const hoje = Date.now();
  if (!cache || cache.chave !== chave || cache.vale <= hoje) {
    const lidos = await lerEventosMonjour((de, fim) => {
      let q = supabase.from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('event_type', [...TIPOS_EVENTO_MONJOUR])
        .gte('created_at', desde);
      if (ate) q = q.lt('created_at', ate);
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, fim);
    });
    cache = { chave, vale: hoje + CACHE_MS, sessoes: agruparSessoes(lidos.eventos).filter((s) => s.visitante), truncado: lidos.truncado };
  }
  return listarDasSessoes(cache.sessoes, pedido, cache.truncado);
}

// ── Jornada de uma sessão ───────────────────────────────────────────────────
const ROTULO_FIM: Record<string, string> = {
  checkout: 'Clicou em comprar', compra: 'Comprou', upgrade: 'Fez o upgrade no app',
  fin_seguridad: 'Saiu na tela de segurança', partida_sin_salida: 'Parou no ponto de partida',
};
const N_FIM: Record<string, number> = { checkout: ETAPA_CHECKOUT, compra: ETAPA_COMPRA };

interface Marcado { e: EventoMonjour; quando: number; seq: number }

/** Marca do navegador (ts) ou, sem ela, o created_at do servidor. */
function marcar(e: EventoMonjour): Marcado {
  const d = e.event_data || {};
  const ts = numero(d.ts);
  const criado = Date.parse(e.created_at);
  return { e, quando: ts !== null && ts > 0 ? ts : (Number.isFinite(criado) ? criado : 0), seq: numero(d.seq) ?? 0 };
}

function linhaDe({ e, quando }: Marcado): LinhaJornada | null {
  const d = e.event_data || {};
  const ts = new Date(quando).toISOString();
  if (e.event_type === 'monjour_passo') {
    const chave = texto(d.passo, 40).toLowerCase();
    if (chave === PASSO_ATALHO || chave === PASSO_VOLTA) {
      return { ts, tipo: 'atalho', passo: chave, n: null, rotulo: chave === PASSO_ATALHO ? ROTULO_ATALHO : ROTULO_VOLTA, resposta: null, segundosNaTela: null };
    }
    const tela = TELAS_MONJOUR.find((t) => t.chave === chave);
    if (!tela) return null;
    return { ts, tipo: 'viu', passo: tela.chave, n: tela.n, rotulo: tela.rotulo, resposta: null, segundosNaTela: null };
  }
  if (e.event_type === 'monjour_resp') {
    const chave = chaveDaResposta(d.passo);
    if (!chave) return null;
    const lista = Array.isArray(d.resp) ? d.resp : [d.resp];
    const valores = [...new Set(lista.map((v) => texto(v)).filter(Boolean))];
    if (!valores.length) return null;
    const pergunta = PERGUNTAS_MONJOUR.find((p) => p.chave === chave);
    return {
      ts, tipo: 'respondeu', passo: chave, n: N_POR_CHAVE[chave] ?? (texto(d.passo, 40).startsWith('cargando') ? N_POR_CHAVE.cargando : null),
      rotulo: pergunta?.pergunta ?? chave, resposta: rotuloDaResposta(chave, valores), segundosNaTela: null,
    };
  }
  if (e.event_type === 'monjour_fim') {
    const destino = texto(d.destino, 40);
    if (!destino) return null;
    return { ts, tipo: 'fim', passo: destino, n: N_FIM[destino] ?? null, rotulo: ROTULO_FIM[destino] ?? 'Outro destino', resposta: null, segundosNaTela: null };
  }
  return null;
}

/** Tempo em cada tela: da vista até a próxima tela diferente ou o fim. Acima de 30 minutos a sessão foi abandonada: sem valor. */
export function montarJornada(eventos: EventoMonjour[]): LinhaJornada[] {
  const linhas = eventos.map(marcar).sort((a, b) => a.quando - b.quando || a.seq - b.seq)
    .map((m) => ({ linha: linhaDe(m), quando: m.quando })).filter((x): x is { linha: LinhaJornada; quando: number } => x.linha !== null);
  linhas.forEach((x, i) => {
    if (x.linha.tipo !== 'viu') return;
    const proximo = linhas.slice(i + 1).find((y) => y.linha.tipo === 'fim' || y.linha.tipo === 'atalho' || (y.linha.tipo === 'viu' && y.linha.n !== x.linha.n));
    if (!proximo) return;
    const seg = (proximo.quando - x.quando) / 1000;
    x.linha.segundosNaTela = seg >= 0 && seg <= MEDIANA_CORTE_SEG ? Math.round(seg * 10) / 10 : null;
  });
  return linhas.map((x) => x.linha);
}

export async function lerJornadaDaSessao(sid: string): Promise<{ resumo: ItemSessao; linha: LinhaJornada[] } | null> {
  const lidos = await lerEventosMonjour((de, fim) => {
    if (de >= MAX_EVENTOS_SESSAO) return Promise.resolve({ data: [], error: null });
    return supabase.from('lp_events')
      .select('session_id, event_type, event_data, created_at')
      .eq('session_id', sid)
      .in('event_type', [...TIPOS_EVENTO_MONJOUR])
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, fim);
  });
  const sessao = agruparSessoes(lidos.eventos).find((s) => s.id === sid);
  // Sem o quiz no histórico (sessão só de webhook, ou sonda que saiu): não há jornada.
  if (!sessao || !sessao.visitante) return null;
  return { resumo: itemDaSessao(sessao), linha: montarJornada(lidos.eventos) };
}
