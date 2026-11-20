// ───────────────────────────────────────────────────────────────────────────
// SESSÕES DO FUNIL MONJOUR: agrupa os eventos monjour_* por session_id e tira de
// cada sessão o que o funil precisa (maior passo, respostas, destino, contexto).
// Puro: sem banco. A contagem em si mora em funilMonjourPuro.ts.
// ───────────────────────────────────────────────────────────────────────────
import {
  type EventoMonjour, N_POR_CHAVE, chaveDaResposta, ETAPA_CHECKOUT, ETAPA_COMPRA, ETAPA_OFERTA, PASSO_ATALHO, PASSO_VOLTA, desdeDaEtapa,
} from './monjourCatalogo';

export interface ContextoMonjour { pais: string; regiao: string; cidade: string; disp: string; so: string; nav: string; anuncio: string }

export interface SessaoMonjour {
  id: string;
  /** Instante (ms) do primeiro evento do navegador no quiz (ou do primeiro evento, sem quiz): dia e hora dos recortes. */
  primeiro: number;
  /** Contexto lido só de eventos do navegador: o webhook da Stripe não diz país nem aparelho da cliente. */
  ctx: ContextoMonjour;
  /**
   * Sessão que passou pelo quiz NO PERÍODO: tem monjour_passo, monjour_resp ou um
   * destino que sai do navegador. Só compra ou upgrade do webhook não basta.
   */
  visitante: boolean;
  /** Maior etapa alcançada (0 fora do funil): a posição da tela no catálogo; depois da oferta, clicou em comprar e comprou. */
  nivel: number;
  /** Primeira vista de cada tela (ms): ts do navegador, ou created_at sem ts. */
  vistas: Map<number, number>;
  respostas: Map<string, string[]>;
  lead: boolean;
  destinos: Set<string>;
  plano: string | null;
  /** Compra + upgrade da sessão (recortes). */
  receitaCentavos: number;
  receitaCompraCentavos: number;
  receitaUpgradeCentavos: number;
  /** created_at (ms) dos destinos de servidor, para a mediana do checkout até a compra. */
  checkoutTs: number | null;
  checkoutCriado: number | null;
  compraCriada: number | null;
  upgrade: boolean;
  acoesApp: Set<string>;
  /** Tocou no atalho da tela 1 e foi direto à oferta (passo atalho_oferta). */
  atalho: boolean;
  /** Já tinha terminado o test e abriu direto na oferta (passo volta_oferta). */
  volta: boolean;
}

/** Sessão que foi à oferta sem passar pelas perguntas. */
export const pulouPerguntas = (s: SessaoMonjour): boolean => s.atalho || s.volta;

/**
 * A etapa n existe para esta sessão? Etapa com `desde` (catálogo) só existe para quem entrou depois dela:
 * sessão antiga nunca viu a tela, então a etapa não entra na conta dela.
 */
export function etapaAplica(s: SessaoMonjour, n: number): boolean {
  const desde = desdeDaEtapa(n);
  return desde === null || s.primeiro >= desde;
}

/** A primeira etapa que existe para a sessão. */
export function primeiraEtapa(s: SessaoMonjour): number {
  return proximaEtapa(s, 0) ?? 1;
}

/** A próxima etapa que existe para a sessão depois de n (a passagem dela é de n para esta), ou null no fim. */
export function proximaEtapa(s: SessaoMonjour, n: number): number | null {
  for (let m = n + 1; m <= ETAPA_COMPRA; m += 1) if (etapaAplica(s, m)) return m;
  return null;
}

/**
 * A sessão chegou à etapa n? Regra normal: o maior passo é >= n, então o funil só desce.
 * Etapa que não existe para a sessão (`desde`) não conta. Sessão de atalho ou de volta não passou pelas perguntas:
 * nas telas antes da oferta só conta a que ela viu de verdade. Da oferta em diante vale o maior passo.
 */
export function chegouNaEtapa(s: SessaoMonjour, n: number): boolean {
  if (!etapaAplica(s, n)) return false;
  if (!pulouPerguntas(s) || n >= ETAPA_OFERTA) return s.nivel >= n;
  return s.vistas.has(n);
}

/** A sessão seguiu da etapa n para a próxima? Quem pulou as perguntas até a oferta seguiu de cada tela que viu. */
export function seguiuDaEtapa(s: SessaoMonjour, n: number): boolean {
  if (pulouPerguntas(s) && n < ETAPA_OFERTA && s.nivel >= ETAPA_OFERTA) return true;
  const proxima = proximaEtapa(s, n);
  return proxima !== null && chegouNaEtapa(s, proxima);
}

/** Chegou à etapa n e parou ali (não seguiu). */
export const pararamNaEtapa = (s: SessaoMonjour, n: number): boolean => chegouNaEtapa(s, n) && !seguiuDaEtapa(s, n);

const texto = (v: unknown, max = 80): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const numero = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Valor em centavos de USD: sem moeda conta como USD; outra moeda não entra na receita. */
function centavosUsd(d: Record<string, unknown>): number {
  const moeda = texto(d.moeda, 8).toLowerCase();
  if (moeda && moeda !== 'usd') return 0;
  const v = numero(d.valor);
  return v !== null && v > 0 ? Math.round(v) : 0;
}

function sessaoVazia(id: string, primeiro: number): SessaoMonjour {
  return {
    id, primeiro, ctx: { pais: '', regiao: '', cidade: '', disp: '', so: '', nav: '', anuncio: '' }, visitante: false, nivel: 0,
    vistas: new Map(), respostas: new Map(), lead: false, destinos: new Set(), plano: null,
    receitaCentavos: 0, receitaCompraCentavos: 0, receitaUpgradeCentavos: 0, checkoutTs: null, checkoutCriado: null, compraCriada: null, upgrade: false,
    acoesApp: new Set(), atalho: false, volta: false,
  };
}

/** Respostas aceitas: texto ou lista de textos, cada um com no máximo 60 caracteres. */
function valoresDaResposta(resp: unknown): string[] {
  const lista = Array.isArray(resp) ? resp : [resp];
  const saida: string[] = [];
  for (const v of lista) {
    const t = texto(v, 60);
    if (t && !saida.includes(t)) saida.push(t);
  }
  return saida;
}

/** Destinos que vêm do webhook da Stripe, não do navegador. */
const DESTINOS_DO_WEBHOOK = new Set(['compra', 'upgrade']);
/** Destinos gravados pelo navegador durante o quiz: contam como passagem pelo funil. */
const DESTINOS_DO_NAVEGADOR = new Set(['checkout', 'fin_seguridad', 'partida_sin_salida']);

function doWebhook(e: EventoMonjour): boolean {
  return e.event_type === 'monjour_fim' && DESTINOS_DO_WEBHOOK.has(texto((e.event_data || {}).destino, 40));
}

function doQuiz(e: EventoMonjour): boolean {
  if (e.event_type === 'monjour_passo' || e.event_type === 'monjour_resp') return true;
  return e.event_type === 'monjour_fim' && DESTINOS_DO_NAVEGADOR.has(texto((e.event_data || {}).destino, 40));
}

function aplicar(s: SessaoMonjour, e: EventoMonjour, criado: number): void {
  const d = e.event_data || {};
  if (!doWebhook(e)) {
    const c = s.ctx;
    if (!c.pais) c.pais = texto(d.pais, 4).toUpperCase();
    if (!c.regiao) c.regiao = texto(d.regiao, 60);
    if (!c.cidade) c.cidade = texto(d.cidade, 60);
    if (!c.disp) c.disp = texto(d.disp, 20).toLowerCase();
    if (!c.so) c.so = texto(d.so, 20).toLowerCase();
    if (!c.nav) c.nav = texto(d.nav, 20).toLowerCase();
    if (!c.anuncio) c.anuncio = texto(d.utm_content);
  }
  const tsNavegador = numero(d.ts);
  const quando = tsNavegador !== null && tsNavegador > 0 ? tsNavegador : criado;

  if (e.event_type === 'monjour_app') {
    const acao = texto(d.acao, 20);
    if (acao) s.acoesApp.add(acao);
    return;
  }
  if (doQuiz(e)) {
    if (!s.visitante) s.primeiro = criado;
    s.visitante = true;
    // Qualquer evento do quiz põe a sessão na primeira etapa QUE EXISTE para ela (a Idade, se entrou antes da abertura nova).
    s.nivel = Math.max(s.nivel, primeiraEtapa(s));
  }

  if (e.event_type === 'monjour_passo') {
    const chave = texto(d.passo, 40).toLowerCase();
    // Atalho e volta não têm n: só marcam a sessão (a pessoa já conta como visitante pelo doQuiz acima).
    if (chave === PASSO_ATALHO) { s.atalho = true; return; }
    if (chave === PASSO_VOLTA) { s.volta = true; return; }
    // Só a chave vale: o n que o site manda é informação e não ordena nada (a ordem é a do catálogo).
    const n = N_POR_CHAVE[chave];
    if (n === undefined) return;
    s.nivel = Math.max(s.nivel, n);
    const ja = s.vistas.get(n);
    if (ja === undefined || quando < ja) s.vistas.set(n, quando);
  } else if (e.event_type === 'monjour_resp') {
    const chave = chaveDaResposta(d.passo);
    if (!chave) return;
    const valores = valoresDaResposta(d.resp);
    if (!valores.length) return;
    // A última resposta vale: quem volta e troca fica com a nova.
    s.respostas.set(chave, valores);
    if (chave === 'correo') s.lead = true;
  } else if (e.event_type === 'monjour_fim') {
    const destino = texto(d.destino, 40);
    if (!destino) return;
    s.destinos.add(destino);
    if (destino === 'checkout') {
      s.nivel = Math.max(s.nivel, ETAPA_CHECKOUT);
      if (s.checkoutTs === null) { s.checkoutTs = quando; s.checkoutCriado = criado; }
      if (!s.plano) s.plano = texto(d.plan, 20).toLowerCase() || null;
    } else if (destino === 'compra') {
      // Webhook repetido da Stripe: vale a primeira compra da sessão. O nível 32 só
      // entra no fim (agruparSessoes), e só para quem passou pelo quiz no período.
      if (s.compraCriada === null) {
        s.compraCriada = criado;
        s.plano = texto(d.plan, 20).toLowerCase() || s.plano;
        s.receitaCompraCentavos += centavosUsd(d);
      }
    } else if (destino === 'upgrade' && !s.upgrade) {
      s.upgrade = true;
      s.receitaUpgradeCentavos += centavosUsd(d);
    }
  }
}

/** Agrupa por sessão. Sessão com utm_source "sonda" em qualquer evento é teste nosso e sai. */
export function agruparSessoes(eventos: EventoMonjour[]): SessaoMonjour[] {
  // Cada evento ganha sua marca de tempo uma vez só: com 200 mil linhas, ordenar chamando Date.parse a cada comparação pesa.
  const marcados = eventos.map((e) => {
    const t = Date.parse(e.created_at);
    return { e, t: Number.isFinite(t) ? t : 0, seq: numero((e.event_data || {}).seq) ?? 0 };
  });
  marcados.sort((a, b) => a.t - b.t || a.seq - b.seq);
  const sessoes = new Map<string, SessaoMonjour>();
  const sondas = new Set<string>();
  for (const { e, t } of marcados) {
    if (!e.session_id) continue;
    if (texto((e.event_data || {}).utm_source, 40).toLowerCase() === 'sonda') { sondas.add(e.session_id); continue; }
    let s = sessoes.get(e.session_id);
    if (!s) { s = sessaoVazia(e.session_id, t); sessoes.set(e.session_id, s); }
    aplicar(s, e, t);
  }
  for (const id of sondas) sessoes.delete(id);
  for (const s of sessoes.values()) {
    s.receitaCentavos = s.receitaCompraCentavos + s.receitaUpgradeCentavos;
    if (!s.visitante) {
      // Sessão só de webhook ou de app (o quiz foi em outro período): fora do funil.
      s.nivel = 0;
      s.destinos.delete('compra');
    } else if (s.compraCriada !== null) {
      s.nivel = Math.max(s.nivel, ETAPA_COMPRA);
    }
  }
  return [...sessoes.values()];
}
