// ───────────────────────────────────────────────────────────────────────────
// A CONTA DO FUNIL DO QUIZ MONJOUR (19/11/2026). Puro: recebe os eventos de
// lp_events (monjour_*) e devolve o FunilMonjour, sem tocar em banco. A leitura
// mora em painelQuizMonjour.ts. Regras de contagem (por sessão distinta):
//  - chegaram(n) = sessões cujo maior passo é >= n, então o funil só desce;
//  - sairam(n) = chegaram(n) - chegaram(n + 1); a oferta (30) perde quem não
//    clicou em comprar, e o clique (31) perde quem não comprou;
//  - mediana = tempo da primeira vista de n até a de n + 1, só de quem chegou
//    lá, sem valor acima de 30 minutos;
//  - sessão com utm_source "sonda" é teste nosso e fica fora de tudo.
// ───────────────────────────────────────────────────────────────────────────
import {
  type EventoMonjour, type FiltrosMonjour, type FunilMonjour, type LinhaMonjour, type EtapaMonjour,
  TELAS_MONJOUR, ETAPAS_DEPOIS, ETAPA_CHECKOUT, ETAPA_COMPRA, ETAPA_OFERTA, ETAPA_META, ETAPA_PARTIDA,
  MEDIANA_CORTE_SEG, SEM_ANUNCIO, nomeDoAnuncio, conjuntoDoAnuncio, nomeDoConjunto, nomeDoPais,
  ROTULO_APARELHO, ROTULO_SISTEMA, ROTULO_NAVEGADOR,
} from './monjourCatalogo';
import { agruparSessoes, type SessaoMonjour } from './sessoesMonjour';
import { montarRespostas } from './respostasMonjour';

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

const chegou = (s: SessaoMonjour, n: number): boolean => s.nivel >= n;

function passaNosFiltros(s: SessaoMonjour, f: FiltrosMonjour): boolean {
  if (f.pais && s.ctx.pais !== f.pais.toUpperCase()) return false;
  if (f.disp && s.ctx.disp !== f.disp.toLowerCase()) return false;
  if (f.anuncio && (s.ctx.anuncio || SEM_ANUNCIO) !== f.anuncio) return false;
  if (f.conjunto && conjuntoDoAnuncio(s.ctx.anuncio) !== f.conjunto) return false;
  return true;
}

function linha(chave: string, rotulo: string, grupo: SessaoMonjour[]): LinhaMonjour {
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
  sessoes: SessaoMonjour[], chaveDe: (s: SessaoMonjour) => string, rotuloDe: (chave: string) => string,
  ordem: 'volume' | 'chave' = 'volume',
): LinhaMonjour[] {
  const grupos = new Map<string, SessaoMonjour[]>();
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

function recortes(sessoes: SessaoMonjour[]): FunilMonjour['recortes'] {
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
    conjunto: recorte(sessoes, (s) => conjuntoDoAnuncio(s.ctx.anuncio), nomeDoConjunto),
    dia: recorte(sessoes, (s) => diaSP(s.primeiro), (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`, 'chave'),
    hora: completas,
  };
}

function filtrosDisponiveis(sessoes: SessaoMonjour[]): FunilMonjour['filtros'] {
  const conta = (chaveDe: (s: SessaoMonjour) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const s of sessoes) { const k = chaveDe(s); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const porVolume = <T extends { sessoes: number }>(a: T, b: T): number => b.sessoes - a.sessoes;
  return {
    paises: [...conta((s) => s.ctx.pais)].map(([codigo, sessoes]) => ({ codigo, nome: nomeDoPais(codigo), sessoes })).sort(porVolume),
    aparelhos: [...conta((s) => s.ctx.disp)].map(([chave, sessoes]) => ({ chave, sessoes })).sort(porVolume),
    anuncios: [...conta((s) => s.ctx.anuncio || SEM_ANUNCIO)].map(([id, sessoes]) => ({
      id, nome: nomeDoAnuncio(id), conjunto: conjuntoDoAnuncio(id), sessoes,
    })).sort(porVolume),
  };
}

/** Diferença em segundos entre duas marcas, ou null se faltar uma ou se passar do corte. */
function intervalo(de: number | null | undefined, ate: number | null | undefined): number | null {
  if (de == null || ate == null) return null;
  const seg = (ate - de) / 1000;
  return seg >= 0 && seg <= MEDIANA_CORTE_SEG ? seg : null;
}

function tempoDaEtapa(s: SessaoMonjour, n: number): number | null {
  if (n === ETAPA_COMPRA) return null;
  if (n === ETAPA_CHECKOUT) return intervalo(s.checkoutCriado, s.compraCriada);
  if (n === ETAPA_OFERTA) return intervalo(s.vistas.get(n), s.checkoutTs);
  // A tela da meta pode ser pulada: de 19 o próximo passo visto é o 21.
  const proximo = s.vistas.get(n + 1) ?? (n + 1 === ETAPA_META ? s.vistas.get(ETAPA_PARTIDA) : undefined);
  return intervalo(s.vistas.get(n), proximo);
}

function etapas(sessoes: SessaoMonjour[]): EtapaMonjour[] {
  const todas = [...TELAS_MONJOUR, ...ETAPAS_DEPOIS];
  const base = sessoes.length;
  return todas.map((t) => {
    const chegaram = sessoes.filter((s) => chegou(s, t.n)).length;
    const seguintes = t.n === ETAPA_COMPRA ? 0 : sessoes.filter((s) => chegou(s, t.n + 1)).length;
    const sairam = t.n === ETAPA_COMPRA ? 0 : chegaram - seguintes;
    const e: EtapaMonjour = {
      n: t.n, chave: t.chave, rotulo: t.rotulo, tipo: t.tipo, chegaram,
      pctInicio: pct(chegaram, base), sairam, pctSaida: pct(sairam, chegaram),
      medianaSegundos: medianaDe(sessoes.map((s) => tempoDaEtapa(s, t.n)).filter((v): v is number => v !== null)),
    };
    if (t.n === ETAPA_META) e.pularam = sessoes.filter((s) => chegou(s, ETAPA_PARTIDA) && !s.vistas.has(ETAPA_META)).length;
    return e;
  });
}

export interface OpcoesFunilMonjour {
  periodo: string; desde: string; ate: string; agora?: Date;
  inicioRastreio?: string | null; truncado?: boolean; filtros?: FiltrosMonjour;
}

export function montarFunilMonjour(eventos: EventoMonjour[], op: OpcoesFunilMonjour): FunilMonjour {
  const todas = agruparSessoes(eventos);
  const doFiltro = todas.filter((s) => passaNosFiltros(s, op.filtros || {}));
  const funil = doFiltro.filter((s) => s.visitante);
  const compraram = funil.filter((s) => s.destinos.has('compra'));
  // Compra conta só para quem passou pelo quiz no período. O upgrade é pago no app,
  // dias depois: conta sobre todas as sessões do filtro, como os eventos do app.
  const receitaCompras = compraram.reduce((a, s) => a + s.receitaCompraCentavos, 0);
  const comUpgrade = doFiltro.filter((s) => s.upgrade);
  const receita = receitaCompras + comUpgrade.reduce((a, s) => a + s.receitaUpgradeCentavos, 0);
  const comApp = (acao: string): number => doFiltro.filter((s) => s.acoesApp.has(acao)).length;
  return {
    periodo: op.periodo, desde: op.desde, ate: op.ate,
    atualizadoEm: (op.agora ?? new Date()).toISOString(),
    inicioRastreio: op.inicioRastreio ?? null,
    truncado: !!op.truncado,
    // As opções de filtro vêm do período inteiro, para o menu não encolher quando alguém filtra.
    filtros: filtrosDisponiveis(todas.filter((s) => s.visitante)),
    totais: {
      sessoes: funil.length,
      leads: funil.filter((s) => s.lead).length,
      ofertas: funil.filter((s) => chegou(s, ETAPA_OFERTA)).length,
      checkouts: funil.filter((s) => chegou(s, ETAPA_CHECKOUT)).length,
      compras: compraram.length,
      comprasBasico: compraram.filter((s) => s.plano === 'basico').length,
      comprasPlus: compraram.filter((s) => s.plano === 'plus').length,
      upgrades: comUpgrade.length,
      receitaCentavos: receita,
      conversao: fracao(compraram.length, funil.length),
      // Ticket médio só da compra: o upgrade inflaria a média.
      ticketMedioCentavos: compraram.length ? Math.round(receitaCompras / compraram.length) : 0,
    },
    etapas: etapas(funil),
    saidas: {
      finSeguridad: funil.filter((s) => s.destinos.has('fin_seguridad')).length,
      partidaSemSaida: funil.filter((s) => s.destinos.has('partida_sin_salida')).length,
    },
    recortes: recortes(funil),
    respostas: montarRespostas(funil),
    app: { abriram: comApp('abriu'), instalaram: comApp('instalou'), upgradeClicks: comApp('upgrade_click') },
  };
}
