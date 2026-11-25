// ───────────────────────────────────────────────────────────────────────────
// A CONTA DO FUNIL DO QUIZ DOMINA IA (24/11/2026). Puro: recebe os eventos de
// lp_events (dominaia_*) e devolve o FunilDominaia, sem tocar em banco. A leitura
// mora em painelQuizDominaia.ts. Regras de contagem (por sessão distinta):
//  - chegaram(n) = sessões cujo maior passo é >= n (n é a posição no catálogo, não o n que o
//    site manda), então o funil só desce. Exceção: sessão com atalho_oferta ou volta_oferta
//    (foi direto à oferta) só conta nas telas anteriores à oferta que viu de verdade
//    (chegouNaEtapa, em sessoesDominaia.ts);
//  - sairam(n) = chegaram(n) - chegaram(n + 1); a oferta perde quem não clicou em comprar,
//    e o clique perde quem não comprou. Quem pulou as perguntas até a oferta não sai nas telas do meio;
//  - mediana = tempo da primeira vista de n até a de n + 1, só de quem chegou
//    lá, sem valor acima de 30 minutos;
//  - sessão com utm_source "sonda" é teste nosso e fica fora de tudo;
//  - a Domina IA só tem o plano básico (sem plus, sem upgrade) e não tem página de venda direta nem as telas
//    meta e partida: essas chaves do contrato do painel saem zeradas.
// ───────────────────────────────────────────────────────────────────────────
import {
  type EventoDominaia, type FiltrosDominaia, type FunilDominaia, type LinhaDominaia, type EtapaDominaia, ACOES_APP_DOMINAIA,
  TELAS_DOMINAIA, ETAPAS_DEPOIS, ETAPA_CHECKOUT, ETAPA_COMPRA, ETAPA_OFERTA,
  MEDIANA_CORTE_SEG, SEM_ANUNCIO, nomeDoAnuncio, conjuntoDoAnuncio, nomeDoConjunto, nomeDoPais,
  ROTULO_APARELHO, ROTULO_SISTEMA, ROTULO_NAVEGADOR,
} from './dominaiaCatalogo';
import { agruparSessoes, chegouNaEtapa, daSessaoDoQuiz, pararamNaEtapa, proximaEtapa, type SessaoDominaia } from './sessoesDominaia';
import { montarRespostas } from './respostasDominaia';

const SEM = '(sem)';
const SP = -3 * 3600_000;

const pct = (parte: number, todo: number): number => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : 0);
const fracao = (parte: number, todo: number): number => (todo > 0 ? Math.round((parte / todo) * 10000) / 10000 : 0);

export function medianaDe(valores: number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  return Math.round(mediana * 10) / 10;
}

const chegou = chegouNaEtapa;

export function passaNosFiltros(s: SessaoDominaia, f: FiltrosDominaia): boolean {
  if (f.pais && s.ctx.pais !== f.pais.toUpperCase()) return false;
  if (f.disp && s.ctx.disp !== f.disp.toLowerCase()) return false;
  if (f.anuncio && (s.ctx.anuncio || SEM_ANUNCIO) !== f.anuncio) return false;
  if (f.conjunto && conjuntoDoAnuncio(s.ctx.anuncio, s.ctx.conjunto) !== f.conjunto) return false;
  return true;
}

function linha(chave: string, rotulo: string, grupo: SessaoDominaia[]): LinhaDominaia {
  const compras = grupo.filter((s) => s.destinos.has('compra')).length;
  return {
    chave, rotulo, sessoes: grupo.length,
    leads: grupo.filter((s) => s.lead).length,
    ofertas: grupo.filter((s) => chegou(s, ETAPA_OFERTA)).length,
    checkouts: grupo.filter((s) => chegou(s, ETAPA_CHECKOUT)).length,
    compras, conversao: fracao(compras, grupo.length),
    receitaCentavos: grupo.reduce((a, s) => a + s.receitaCentavos, 0),
  };
}

function recorte(
  sessoes: SessaoDominaia[], chaveDe: (s: SessaoDominaia) => string, rotuloDe: (chave: string) => string,
  ordem: 'volume' | 'chave' = 'volume',
): LinhaDominaia[] {
  const grupos = new Map<string, SessaoDominaia[]>();
  for (const s of sessoes) {
    const k = chaveDe(s);
    const g = grupos.get(k);
    if (g) g.push(s); else grupos.set(k, [s]);
  }
  const linhas = [...grupos].map(([k, g]) => linha(k, rotuloDe(k), g));
  return linhas.sort(ordem === 'chave'
    ? (a, b) => a.chave.localeCompare(b.chave)
    : (a, b) => b.sessoes - a.sessoes || a.chave.localeCompare(b.chave));
}

const diaSP = (ms: number): string => new Date(ms + SP).toISOString().slice(0, 10);
const horaSP = (ms: number): string => String(new Date(ms + SP).getUTCHours()).padStart(2, '0');
const rotuloDe = (mapa: Record<string, string>) => (k: string): string => (k === SEM ? 'Sem informação' : mapa[k] ?? k);

function recortes(sessoes: SessaoDominaia[]): FunilDominaia['recortes'] {
  const horas = recorte(sessoes, (s) => horaSP(s.primeiro), (k) => `${k}h`, 'chave');
  // As 24 horas sempre aparecem, para o gráfico não ter buraco.
  const completas = sessoes.length
    ? Array.from({ length: 24 }, (_, h) => {
      const k = String(h).padStart(2, '0');
      return horas.find((l) => l.chave === k) ?? linha(k, `${k}h`, []);
    })
    : [];
  return {
    pais: recorte(sessoes, (s) => s.ctx.pais || SEM, (k) => (k === SEM ? 'Sem país' : nomeDoPais(k))),
    aparelho: recorte(sessoes, (s) => s.ctx.disp || SEM, rotuloDe(ROTULO_APARELHO)),
    sistema: recorte(sessoes, (s) => s.ctx.so || SEM, rotuloDe(ROTULO_SISTEMA)),
    navegador: recorte(sessoes, (s) => s.ctx.nav || SEM, rotuloDe(ROTULO_NAVEGADOR)),
    anuncio: recorte(sessoes, (s) => s.ctx.anuncio || SEM_ANUNCIO, nomeDoAnuncio),
    conjunto: recorte(sessoes, (s) => conjuntoDoAnuncio(s.ctx.anuncio, s.ctx.conjunto), nomeDoConjunto),
    dia: recorte(sessoes, (s) => diaSP(s.primeiro), (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`, 'chave'),
    hora: completas,
  };
}

function filtrosDisponiveis(sessoes: SessaoDominaia[]): FunilDominaia['filtros'] {
  const conta = (chaveDe: (s: SessaoDominaia) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const s of sessoes) { const k = chaveDe(s); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const porVolume = <T extends { sessoes: number }>(a: T, b: T): number => b.sessoes - a.sessoes;
  // O utm_term (id do conjunto) de cada anúncio, para o anúncio fora da lista cair no conjunto certo.
  const termDoAnuncio = new Map<string, string>();
  for (const s of sessoes) if (s.ctx.anuncio && s.ctx.conjunto && !termDoAnuncio.has(s.ctx.anuncio)) termDoAnuncio.set(s.ctx.anuncio, s.ctx.conjunto);
  return {
    paises: [...conta((s) => s.ctx.pais)].map(([codigo, sessoes]) => ({ codigo, nome: nomeDoPais(codigo), sessoes })).sort(porVolume),
    aparelhos: [...conta((s) => s.ctx.disp)].map(([chave, sessoes]) => ({ chave, sessoes })).sort(porVolume),
    anuncios: [...conta((s) => s.ctx.anuncio || SEM_ANUNCIO)].map(([id, sessoes]) => ({
      id, nome: nomeDoAnuncio(id), conjunto: conjuntoDoAnuncio(id, termDoAnuncio.get(id) ?? ''), sessoes,
    })).sort(porVolume),
  };
}

/** Diferença em segundos entre duas marcas, ou null se faltar uma ou se passar do corte. */
function intervalo(de: number | null | undefined, ate: number | null | undefined): number | null {
  if (de == null || ate == null) return null;
  const seg = (ate - de) / 1000;
  return seg >= 0 && seg <= MEDIANA_CORTE_SEG ? seg : null;
}

function tempoDaEtapa(s: SessaoDominaia, n: number): number | null {
  if (n === ETAPA_COMPRA) return null;
  if (n === ETAPA_CHECKOUT) return intervalo(s.checkoutCriado, s.compraCriada);
  if (n === ETAPA_OFERTA) return intervalo(s.vistas.get(n), s.checkoutTs);
  const prox = proximaEtapa(n);
  if (prox === null) return null;
  return intervalo(s.vistas.get(n), s.vistas.get(prox));
}

function etapas(sessoes: SessaoDominaia[]): EtapaDominaia[] {
  const todas = [...TELAS_DOMINAIA, ...ETAPAS_DEPOIS];
  const base = sessoes.length;
  return todas.map((t) => {
    const chegaram = sessoes.filter((s) => chegou(s, t.n)).length;
    // Quem foi da tela 1 direto à oferta (atalho ou volta) não "saiu" nas telas do meio: pararamNaEtapa conta só quem parou de verdade.
    const sairam = t.n === ETAPA_COMPRA ? 0 : sessoes.filter((s) => pararamNaEtapa(s, t.n)).length;
    const e: EtapaDominaia = {
      n: t.n, chave: t.chave, rotulo: t.rotulo, tipo: t.tipo, chegaram,
      pctInicio: pct(chegaram, base), sairam, pctSaida: pct(sairam, chegaram),
      medianaSegundos: medianaDe(sessoes.map((s) => tempoDaEtapa(s, t.n)).filter((v): v is number => v !== null)),
    };
    return e;
  });
}

export interface OpcoesFunilDominaia {
  periodo: string; desde: string; ate: string; agora?: Date;
  inicioRastreio?: string | null; truncado?: boolean; filtros?: FiltrosDominaia;
}

export function montarFunilDominaia(eventos: EventoDominaia[], op: OpcoesFunilDominaia): FunilDominaia {
  const todas = agruparSessoes(eventos);
  const doFiltro = todas.filter((s) => passaNosFiltros(s, op.filtros || {}));
  const funil = doFiltro.filter(daSessaoDoQuiz);
  const compraram = funil.filter((s) => s.destinos.has('compra'));
  // Compra conta só para quem passou pelo quiz no período.
  const receita = compraram.reduce((a, s) => a + s.receitaCompraCentavos, 0);
  // O uso do app conta sobre todas as sessões do filtro (a pessoa entra no app dias depois do quiz).
  const comApp = (acao: string): number => doFiltro.filter((s) => s.acoesApp.has(acao)).length;
  return {
    periodo: op.periodo, desde: op.desde, ate: op.ate,
    atualizadoEm: (op.agora ?? new Date()).toISOString(),
    inicioRastreio: op.inicioRastreio ?? null,
    truncado: !!op.truncado,
    // As opções de filtro vêm do período inteiro, para o menu não encolher quando alguém filtra.
    filtros: filtrosDisponiveis(todas.filter(daSessaoDoQuiz)),
    totais: {
      sessoes: funil.length,
      leads: funil.filter((s) => s.lead).length,
      ofertas: funil.filter((s) => chegou(s, ETAPA_OFERTA)).length,
      checkouts: funil.filter((s) => chegou(s, ETAPA_CHECKOUT)).length,
      compras: compraram.length,
      // Só existe o plano básico: toda compra é básica (o webhook da compra não manda o plano, só o clique em comprar).
      comprasBasico: compraram.length,
      comprasPlus: 0,
      upgrades: 0,
      receitaCentavos: receita,
      conversao: fracao(compraram.length, funil.length),
      atalho: funil.filter((s) => s.atalho).length,
      voltas: funil.filter((s) => s.volta).length,
      ticketMedioCentavos: compraram.length ? Math.round(receita / compraram.length) : 0,
    },
    etapas: etapas(funil),
    saidas: {
      finSeguridad: 0,
      partidaSemSaida: 0,
    },
    recortes: recortes(funil),
    respostas: montarRespostas(funil),
    app: {
      abriram: comApp('abriu'), instalaram: comApp('instalou'), upgradeClicks: 0,
      acoes: Object.fromEntries(ACOES_APP_DOMINAIA.map((a) => [a, comApp(a)])),
    },
    paginaVenta: { visitas: 0, planes: 0, compra: 0, checkouts: 0, compras: 0, secoes: [], cliques: [] },
  };
}
