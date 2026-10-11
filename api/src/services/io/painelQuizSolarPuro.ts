// ───────────────────────────────────────────────────────────────────────────
// A CONTA DO PAINEL DO QUIZ SOLAR no /gerador (10/10/2026). Pura: recebe o que
// o banco devolveu e não lê nada. Quem lê é services/io/painelQuizSolar.ts.
//
// Três perguntas que o consultor faz olhando o anúncio:
//   1. quem chega pelo quiz presta? (nota e porta de cada lead)
//   2. o que virou da reunião que o quiz marcou? (status do card)
//   3. quanto custa cada horário marcado por anúncio? (gasto da Meta ÷ cards)
//
// O gasto é dinheiro da casa: só sócio vê. O corte (`recortarGasto`) monta
// OBJETOS NOVOS e nunca mexe no que veio, porque a rota guarda o dado completo
// em cache e entrega ao consultor uma cópia sem dinheiro.
// ───────────────────────────────────────────────────────────────────────────
import type { FunilQuiz, EventoQuiz, LinhaConjunto, VisitaQuiz } from './quizFunil';
import { ehVisitaDaLpSolar } from './quizFunil';
import type { MetaAnuncio } from './metaConjuntos';

/** Nota a partir da qual o lead é quente (a mesma do LeadQuente enviado à Meta). */
export const NOTA_QUENTE = 80;
/** Abaixo disto é curioso, mesmo que a porta diga outra coisa. */
export const NOTA_CURIOSO = 40;
export const SEM_ANUNCIO = '(sem anúncio)';
export const PORTAS = ['vistoria', 'video', 'ligacao', 'curioso'] as const;
const MAX_DIAS = 31;

export interface LeadBruto { lead_id?: string | null; created_time?: string | null; field_data: unknown }
export interface CardQuiz { utm_term: string | null; utm_content?: string | null; status: string | null; created_at?: string | null }
export type VisitaComData = VisitaQuiz & { created_at?: string | null };

// ── Leads ────────────────────────────────────────────────────────────────────

export interface LeadLido { nota: number | null; caminho: string; anuncio: string }
export type ClasseDoLead = 'quente' | 'morno' | 'curioso' | null;

/** Valor do campo `nome` no `field_data` (`[{ name, values: [..] }]`). Tolera o
 *  jsonb que chega como texto e a caixa do nome. */
export function campoDoLead(fieldData: unknown, nome: string): string {
  let fd = fieldData;
  if (typeof fd === 'string') { try { fd = JSON.parse(fd); } catch { return ''; } }
  if (!Array.isArray(fd)) return '';
  const alvo = nome.toLowerCase();
  for (const c of fd) {
    if (c && typeof c === 'object' && String((c as { name?: unknown }).name ?? '').toLowerCase() === alvo) {
      const v = (c as { values?: unknown }).values;
      return Array.isArray(v) ? String(v[0] ?? '').trim() : '';
    }
  }
  return '';
}

export function lerLead(l: LeadBruto): LeadLido {
  const bruto = campoDoLead(l.field_data, 'Pontos');
  const n = bruto === '' ? NaN : Number(bruto.replace(',', '.'));
  return {
    nota: Number.isFinite(n) ? n : null,
    caminho: campoDoLead(l.field_data, 'Caminho').toLowerCase(),
    anuncio: campoDoLead(l.field_data, 'utm_content'),
  };
}

/** Faixas EXCLUSIVAS, curioso primeiro: porta "curioso" ou nota abaixo de 40 é
 *  curioso; senão 80 ou mais é quente e 40 a 79 é morno. Sem nota e sem porta de
 *  curioso o lead conta no total mas em nenhuma faixa. */
export function classeDoLead(l: LeadLido): ClasseDoLead {
  if (l.caminho === 'curioso' || (l.nota !== null && l.nota < NOTA_CURIOSO)) return 'curioso';
  if (l.nota === null) return null;
  return l.nota >= NOTA_QUENTE ? 'quente' : 'morno';
}

const media = (notas: number[]): number | null =>
  notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) : null;

export interface QualidadeDosLeads {
  total: number; comNota: number; notaMedia: number | null;
  quentes: number; mornos: number; curiosos: number;
  porCaminho: Record<string, number>;
}

export function qualidadeDosLeads(leads: LeadLido[]): QualidadeDosLeads {
  const porCaminho: Record<string, number> = Object.fromEntries(PORTAS.map((p) => [p, 0]));
  let quentes = 0, mornos = 0, curiosos = 0;
  for (const l of leads) {
    if (l.caminho in porCaminho) porCaminho[l.caminho]++;
    const c = classeDoLead(l);
    if (c === 'quente') quentes++; else if (c === 'morno') mornos++; else if (c === 'curioso') curiosos++;
  }
  const notas = leads.map((l) => l.nota).filter((n): n is number => n !== null);
  return { total: leads.length, comNota: notas.length, notaMedia: media(notas), quentes, mornos, curiosos, porCaminho };
}

// ── Cards (o horário que o quiz marcou) ──────────────────────────────────────

/** Cancelado não é horário marcado: sai de tudo, inclusive de "agendados". */
export const contaComoAgendado = (c: CardQuiz) => String(c.status || '') !== 'cancelado';

export interface ResultadoDosCards {
  agendados: number; orcamentos: number; vendidos: number;
  semInteresse: number; naoAtendeu: number; emAberto: number;
}

/** `agendados` = soma dos outros cinco, sempre. `emAberto` é o que sobra
 *  (agendado, arrendamento, chave na mão e demais status ainda vivos). */
export function resultadoDosCards(cards: CardQuiz[]): ResultadoDosCards {
  const r: ResultadoDosCards = { agendados: 0, orcamentos: 0, vendidos: 0, semInteresse: 0, naoAtendeu: 0, emAberto: 0 };
  for (const c of cards) {
    if (!contaComoAgendado(c)) continue;
    r.agendados++;
    const st = String(c.status || '');
    if (st === 'fez_orcamento' || st === 'proposta_apresentada') r.orcamentos++;
    else if (st === 'fechou') r.vendidos++;
    else if (st === 'sem_interesse') r.semInteresse++;
    else if (st === 'nao_atendeu') r.naoAtendeu++;
    else r.emAberto++;
  }
  return r;
}

// ── Por dia (Brasília, UTC-3) ────────────────────────────────────────────────

/** Dia civil de Brasília de um instante (ms ou ISO). '' se a data não existe. */
export function diaBRT(quando: number | string | null | undefined): string {
  const ms = typeof quando === 'number' ? quando : Date.parse(String(quando || ''));
  return Number.isFinite(ms) ? new Date(ms - 3 * 3600_000).toISOString().slice(0, 10) : '';
}

/** Os dias de `de` a `ate` (inclusive, AAAA-MM-DD), no máximo os últimos 31. */
export function diasDoPeriodo(de: string, ate: string): string[] {
  const dias: string[] = [];
  const fim = Date.parse(`${ate}T00:00:00Z`);
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= fim && dias.length < 400; t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias.slice(-MAX_DIAS);
}

export interface DiaDoQuiz { dia: string; visitas: number; terminaram: number; agendados: number }

/**
 * Um item por dia, com zero nos dias sem movimento (o gráfico não pula dia).
 * Visita e sessão contam UMA vez, no primeiro dia em que apareceram, para a soma
 * dos dias bater com a do funil (`funil.visitas`, `funil.terminaram`) quando o
 * período cabe nos 31 dias. Mesmas regras do `montarFunil`: só visita da página
 * do quiz (não do simulador), só evento com lp 'solar', e "terminou" é sessão
 * que viu alguma pergunta E gravou um destino.
 */
export function montarPorDia(
  dias: string[], visitas: VisitaComData[], eventos: EventoQuiz[], cards: CardQuiz[],
): DiaDoQuiz[] {
  const linhas = new Map<string, DiaDoQuiz>(dias.map((d) => [d, { dia: d, visitas: 0, terminaram: 0, agendados: 0 }]));

  const primeiraVisita = new Map<string, number>();
  for (const v of visitas) {
    if (!v.session_id || !ehVisitaDaLpSolar(v.landing_url)) continue;
    const ms = Date.parse(String(v.created_at || ''));
    if (!Number.isFinite(ms)) continue;
    const antes = primeiraVisita.get(v.session_id);
    if (antes === undefined || ms < antes) primeiraVisita.set(v.session_id, ms);
  }
  for (const ms of primeiraVisita.values()) {
    const l = linhas.get(diaBRT(ms));
    if (l) l.visitas++;
  }

  const sessoes = new Map<string, { passo: boolean; fimEm: number | null }>();
  for (const e of eventos) {
    if (!e.session_id) continue;
    const d = e.event_data || {};
    if (d.lp !== 'solar') continue;
    const s = sessoes.get(e.session_id) || { passo: false, fimEm: null };
    if (e.event_type === 'quiz_passo' && typeof d.passo === 'string' && d.passo) s.passo = true;
    if (e.event_type === 'quiz_fim' && typeof d.destino === 'string' && d.destino) {
      const ms = Date.parse(e.created_at);
      if (Number.isFinite(ms) && (s.fimEm === null || ms < s.fimEm)) s.fimEm = ms;
    }
    sessoes.set(e.session_id, s);
  }
  for (const s of sessoes.values()) {
    if (!s.passo || s.fimEm === null) continue;
    const l = linhas.get(diaBRT(s.fimEm));
    if (l) l.terminaram++;
  }

  for (const c of cards) {
    if (!contaComoAgendado(c)) continue;
    const l = linhas.get(diaBRT(c.created_at));
    if (l) l.agendados++;
  }
  return [...linhas.values()];
}

// ── Por anúncio ──────────────────────────────────────────────────────────────

export interface LinhaAnuncio {
  id: string; nome: string; situacao: string;
  leads: number; agendados: number; notaMedia: number | null; quentes: number;
  gasto?: number | null; custoPorAgendado?: number | null;
}

/** Os anúncios (utm_content) vistos em leads e cards, do que mais importa para o
 *  que menos: mais agendados, depois mais leads. Serve também para escolher quais
 *  50 ids vão à Meta. */
export function idsDosAnuncios(leads: LeadLido[], cards: CardQuiz[]): string[] {
  const peso = new Map<string, [number, number]>();
  const soma = (id: string, i: 0 | 1) => {
    if (!id) return;
    const p = peso.get(id) || [0, 0];
    p[i]++; peso.set(id, p);
  };
  for (const c of cards) if (contaComoAgendado(c)) soma(String(c.utm_content || '').trim(), 0);
  for (const l of leads) soma(l.anuncio, 1);
  return [...peso.entries()].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).map(([id]) => id);
}

/**
 * Junta leads e cards pelo anúncio. `meta` é o que a Meta devolveu (pode vir
 * vazio); `metaOk` false deixa gasto e custo em null (travessão na tela), nunca
 * zero. Quem veio sem utm_content vai na linha "(sem anúncio)", com gasto 0.
 */
export function montarPorAnuncio(
  leads: LeadLido[], cards: CardQuiz[], meta: Map<string, MetaAnuncio>, metaOk: boolean,
): LinhaAnuncio[] {
  const grupos = new Map<string, { leads: LeadLido[]; agendados: number }>();
  const pegar = (id: string) => {
    let g = grupos.get(id);
    if (!g) { g = { leads: [], agendados: 0 }; grupos.set(id, g); }
    return g;
  };
  for (const l of leads) pegar(l.anuncio).leads.push(l);
  for (const c of cards) if (contaComoAgendado(c)) pegar(String(c.utm_content || '').trim()).agendados++;

  const linhas: LinhaAnuncio[] = [...grupos.entries()].map(([id, g]) => {
    const m = id ? meta.get(id) : undefined;
    const gasto = !id ? 0 : m ? m.gasto : (metaOk ? 0 : null);
    return {
      id,
      nome: id ? (m?.nome || id) : SEM_ANUNCIO,
      situacao: m?.status || '',
      leads: g.leads.length,
      agendados: g.agendados,
      notaMedia: media(g.leads.map((l) => l.nota).filter((n): n is number => n !== null)),
      quentes: g.leads.filter((l) => classeDoLead(l) === 'quente').length,
      gasto,
      custoPorAgendado: gasto !== null && g.agendados > 0 ? Math.round((gasto / g.agendados) * 100) / 100 : null,
    };
  });
  return linhas.sort((a, b) => b.agendados - a.agendados || b.leads - a.leads);
}

/**
 * Acrescenta os anúncios que GASTARAM e não trouxeram lead nem card (o
 * desperdício), do que mais gastou para o que menos. Vão DEPOIS dos outros, de
 * propósito: a ordem de quem tem resultado não pode depender do gasto. Essas
 * linhas só chegam a sócio (ver `respostaDoPainel`): a presença delas já
 * revelaria gasto.
 */
export function acrescentarSoGasto(linhas: LinhaAnuncio[], extras: Map<string, MetaAnuncio>): LinhaAnuncio[] {
  const tem = new Set(linhas.map((l) => l.id));
  const novas: LinhaAnuncio[] = [...extras.values()]
    .filter((a) => !tem.has(a.id) && (a.gasto || 0) > 0)
    .sort((a, b) => (b.gasto || 0) - (a.gasto || 0) || (a.id < b.id ? -1 : 1))
    .map((a) => ({
      id: a.id, nome: a.nome || a.id, situacao: a.status || '', leads: 0, agendados: 0, notaMedia: null, quentes: 0,
      gasto: a.gasto, custoPorAgendado: null,
    }));
  return [...linhas, ...novas];
}

// ── O painel inteiro e o corte do dinheiro ───────────────────────────────────

export interface PainelQuizSolar {
  periodo: string; desde: string; ate: string | null;
  funil: FunilQuiz;
  leads: QualidadeDosLeads;
  resultado: ResultadoDosCards;
  porDia: DiaDoQuiz[];
  porAnuncio: LinhaAnuncio[];
  porConjunto: LinhaConjunto[];
  meta_ok: boolean; meta_motivo: string | null;
}

/** Chaves de dinheiro. `custo_reuniao` e `custo_resultado` do conjunto são o
 *  gasto dividido por contagem que o consultor também vê: multiplicando de volta
 *  entrega o gasto, então saem junto. */
const DINHEIRO_ANUNCIO = ['gasto', 'custoPorAgendado'] as const;
const DINHEIRO_CONJUNTO = ['gasto', 'custo_reuniao', 'custo_resultado'] as const;

function semChaves<T extends object>(o: T, chaves: readonly string[]): T {
  const copia = { ...o } as Record<string, unknown>;
  for (const k of chaves) delete copia[k];
  return copia as T;
}

/** O conjunto do consultor comum: sem o conjunto que só entrou por ter gasto
 *  (sem visita e sem reunião) e fora da ordem de gasto que `montarConjuntos`
 *  usa. A presença e a posição entregariam o ranking de verba. */
function conjuntosDoConsultor(lista: LinhaConjunto[]): LinhaConjunto[] {
  return lista
    .filter((c) => c.visitas > 0 || c.reunioes > 0)
    .sort((a, b) => b.reunioes - a.reunioes || b.visitas - a.visitas || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => semChaves(c, DINHEIRO_CONJUNTO));
}

/**
 * A resposta do painel para quem chama. Sócio recebe o dado completo; consultor
 * recebe uma CÓPIA sem nenhuma chave de dinheiro (a chave nem existe), sem as
 * linhas que só existem por causa do gasto (anúncio sem lead nem card, conjunto
 * sem visita nem reunião), com os conjuntos reordenados por resultado e sem o
 * motivo técnico da Meta. Nunca altera `p`: ele mora em cache.
 */
export function respostaDoPainel(p: PainelQuizSolar, verGasto: boolean) {
  const base = { ok: true as const, periodo: p.periodo, desde: p.desde, ate: p.ate, verGasto };
  if (verGasto) return { ...base, ...p, verGasto };
  return {
    ...base,
    funil: p.funil, leads: p.leads, resultado: p.resultado, porDia: p.porDia,
    porAnuncio: p.porAnuncio.filter((a) => a.leads > 0 || a.agendados > 0).map((a) => semChaves(a, DINHEIRO_ANUNCIO)),
    porConjunto: conjuntosDoConsultor(p.porConjunto),
    meta_ok: p.meta_ok, meta_motivo: null,
  };
}
