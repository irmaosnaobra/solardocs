// ───────────────────────────────────────────────────────────────────────────
// "O QUE MAIS GOSTAM" NO APP MONJOUR (19/11/2026), para GET /admin/monjour/gostos.
// Conta o uso de lp_events no período; a retenção e o dia em que param usam as
// compras do site (cada pessoa, pelo `m`). Site fora: o resto sai e a retenção vem
// sem medida (pct null), com `indisponivel`. Percentuais de 0 a 100, uma casa.
//  - retenção Dk = de quem comprou no período e já completou k dias, quantos usaram
//    o app exatamente no dia k depois da compra (dia de São Paulo). Ninguém elegível
//    (coorte vazia, ou ninguém completou k dias ainda): pct null, "ainda não dá para medir";
//  - paramNoDia = em que dia do plano estava (o maior `dia` que viu) quem parou há 3 dias ou mais.
// ───────────────────────────────────────────────────────────────────────────
import type { EventoApp } from './leituraAppMonjour';
import { janelaDoPeriodo, lerUsoDesde, desdeDeTodos } from './leituraAppMonjour';
import { agruparUso, DIAS_PARADO, type CompraSite, type Janela } from './membrosPuro';
import { lerComprasDoSite } from './membrosMonjour';
import { limpar } from './textosAppMonjour';
import { normalizarPeriodo } from './painelQuizMonjour';

const SP = -3 * 3600_000;
const DIA = 86_400_000;
const DIAS_RETENCAO = [1, 3, 7, 14, 21] as const;
const ABAS = ['hoy', 'recetas', 'compras', 'progreso', 'plus', 'ayuda'] as const;
const ACOES_LISTA = new Set(['lista_bloque', 'lo_tengo', 'enviar_lista']);
const TOPO = 20;

export interface ItemGosto { alvo: string; nome: string; vezes: number; pessoas: number }

export interface Gostos {
  periodo: string; pessoas: number; truncado: boolean;
  recetasVistas: ItemGosto[]; recetasFeitas: ItemGosto[]; favoritas: ItemGosto[]; infusoes: ItemGosto[];
  abas: { aba: string; pessoas: number; vezes: number }[];
  usoLista: number; registraPeso: number; instalou: number;
  retencao: { dia: number; pct: number | null; elegiveis: number }[];
  paramNoDia: { dia: number; pessoas: number }[];
  indisponivel?: true; motivo?: string;
}

const pct = (parte: number, todo: number): number => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : 0);
const tempo = (e: EventoApp): number => Date.parse(e.created_at);
const diaN = (t: number): number => Math.floor((t + SP) / DIA);
const dentro = (t: number, j: Janela): boolean => t >= j.desde && (j.ate === null || t < j.ate);

/** Ranking de uma ação por `alvo`: vezes e pessoas distintas. `contar` filtra quais eventos entram. */
function ranking(eventos: EventoApp[], acao: string, contar: (e: EventoApp) => boolean = () => true): ItemGosto[] {
  const itens = new Map<string, { nome: string; vezes: number; quem: Set<string> }>();
  for (const e of [...eventos].sort((a, b) => tempo(a) - tempo(b))) {
    const alvo = limpar(e.alvo);
    if (e.acao !== acao || !alvo || !contar(e)) continue;
    const x = itens.get(alvo) ?? { nome: '', vezes: 0, quem: new Set<string>() };
    x.vezes += 1;
    x.quem.add(e.m || '');
    x.nome = limpar(e.nome) || x.nome;
    itens.set(alvo, x);
  }
  return [...itens].map(([alvo, x]) => ({ alvo, nome: x.nome || alvo, vezes: x.vezes, pessoas: x.quem.size }))
    .sort((a, b) => b.vezes - a.vezes || b.pessoas - a.pessoas || a.alvo.localeCompare(b.alvo)).slice(0, TOPO);
}

/** Favoritas: conta quem favoritou e ainda mantém (o último estado de cada pessoa naquela receita é "ligado"). */
function favoritas(eventos: EventoApp[]): ItemGosto[] {
  const base = ranking(eventos, 'favorito', (e) => e.ligado === 'true' || e.ligado === '1');
  const ultimo = new Map<string, boolean>();
  for (const e of [...eventos].sort((a, b) => tempo(a) - tempo(b))) {
    if (e.acao === 'favorito') ultimo.set(`${e.m}|${limpar(e.alvo)}`, e.ligado === 'true' || e.ligado === '1');
  }
  return base.map((x) => ({
    ...x, pessoas: [...ultimo].filter(([k, ligado]) => ligado && k.endsWith(`|${x.alvo}`)).length,
  })).sort((a, b) => b.pessoas - a.pessoas || b.vezes - a.vezes || a.alvo.localeCompare(b.alvo));
}

function retencao(compras: Map<string, CompraSite[]>, uso: Map<string, EventoApp[]>, janela: Janela, agora: number): Gostos['retencao'] {
  const coorte = [...compras].map(([m, c]) => ({ m, compra: Math.min(...c.map((x) => Date.parse(x.quando))) }))
    .filter((x) => dentro(x.compra, janela));
  return DIAS_RETENCAO.map((k) => {
    const elegiveis = coorte.filter((x) => diaN(agora) - diaN(x.compra) >= k);
    const voltaram = elegiveis.filter((x) => (uso.get(x.m) ?? []).some((e) => diaN(tempo(e)) - diaN(x.compra) === k));
    return { dia: k, pct: elegiveis.length ? pct(voltaram.length, elegiveis.length) : null, elegiveis: elegiveis.length };
  });
}

function paramNoDia(uso: Map<string, EventoApp[]>, janela: Janela, agora: number): Gostos['paramNoDia'] {
  const porDia = new Map<number, number>();
  for (const eventos of uso.values()) {
    const tempos = eventos.map(tempo);
    if (!tempos.some((t) => dentro(t, janela)) || agora - Math.max(...tempos) < DIAS_PARADO * DIA) continue;
    const dias = eventos.map((e) => Number(e.dia)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 400);
    if (!dias.length) continue;
    const d = Math.max(...dias);
    porDia.set(d, (porDia.get(d) || 0) + 1);
  }
  return [...porDia].map(([dia, pessoas]) => ({ dia, pessoas })).sort((a, b) => a.dia - b.dia);
}

export function montarGostos(
  eventos: EventoApp[], compras: Map<string, CompraSite[]>, periodo: string, janela: Janela, agora: number, truncado = false,
): Gostos {
  const uso = agruparUso(eventos);
  const noPeriodo = eventos.filter((e) => dentro(tempo(e), janela));
  const pessoas = new Set(noPeriodo.map((e) => e.m));
  const quem = (teste: (e: EventoApp) => boolean): number => new Set(noPeriodo.filter(teste).map((e) => e.m)).size;
  return {
    periodo, pessoas: pessoas.size, truncado,
    recetasVistas: ranking(noPeriodo, 'receta_vista'),
    recetasFeitas: ranking(noPeriodo, 'receta_hecha'),
    favoritas: favoritas(noPeriodo),
    infusoes: ranking(noPeriodo, 'infusion_hecha'),
    abas: ABAS.map((aba) => {
      const dela = noPeriodo.filter((e) => e.acao === 'aba' && limpar(e.alvo) === aba);
      return { aba, pessoas: new Set(dela.map((e) => e.m)).size, vezes: dela.length };
    }).sort((a, b) => b.pessoas - a.pessoas || b.vezes - a.vezes),
    usoLista: pct(quem((e) => ACOES_LISTA.has(e.acao || '')), pessoas.size),
    registraPeso: pct(quem((e) => e.acao === 'peso_registrado'), pessoas.size),
    instalou: pct(quem((e) => e.acao === 'instalou'), pessoas.size),
    retencao: retencao(compras, uso, janela, agora),
    paramNoDia: paramNoDia(uso, janela, agora),
  };
}

export async function lerGostos(
  periodo: string, agora: Date = new Date(), env: NodeJS.ProcessEnv = process.env, buscar: typeof fetch = fetch,
): Promise<Gostos> {
  const per = normalizarPeriodo(periodo);
  const [site, uso] = await Promise.all([lerComprasDoSite(agora, env, buscar), lerUsoDesde(desdeDeTodos(agora))]);
  const g = montarGostos(uso.eventos, site.compras, per, janelaDoPeriodo(per, agora), agora.getTime(), uso.truncado || site.truncado);
  return site.indisponivel ? { ...g, indisponivel: true, motivo: site.motivo } : g;
}
