// ───────────────────────────────────────────────────────────────────────────
// MEMBROS DO MONJOUR (19/11/2026). Puro: junta as compras vindas do site (com `m`)
// ao uso do app (lp_events) e devolve a lista, a linha do tempo e a nota de uso.
// Regras:
//  - nota de 0 a 100 = 70 pelos dias ativos sobre os dias desde a compra (no máximo 21)
//    + 30 pela variedade (tipos de ação usados sobre 8). Conta o uso inteiro, sem período;
//  - parado = sem uso há 3 dias ou mais (quem comprou e nunca usou conta desde a compra);
//  - diasAtivos é o único número da lista que obedece ao período do painel.
// ───────────────────────────────────────────────────────────────────────────
import type { EventoApp } from './leituraAppMonjour';
import { MEMBRO_VALIDO } from './leituraAppMonjour';
import { textoDaAcao } from './textosAppMonjour';

const SP = -3 * 3600_000;
const DIA = 86_400_000;
export const DIAS_PARADO = 3;
const DIAS_DA_NOTA = 21;
const VARIEDADE_CHEIA = 8;
const MAX_LINHA = 500;

/** Uma compra (ou upgrade) da lista de vendas do site, já com o `m`. */
export interface CompraSite { m: string; email: string; plano: string; tipo: string; quando: string; pais: string }

export interface Membro {
  m: string; email: string | null; plano: string | null; compradoEm: string | null; pais: string | null;
  cortesia: boolean; semCompra: boolean; ultimoUso: string | null; diasAtivos: number; diaMaximo: number | null;
  instalou: boolean; nota: number; parado: boolean;
}

export interface Janela { desde: number; ate: number | null }

const diaSP = (ms: number): string => new Date(ms + SP).toISOString().slice(0, 10);
const ms = (iso: string): number => Date.parse(iso);

const numeroDia = (v: string | null): number | null => {
  const n = v !== null && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 400 ? n : null;
};

/** Compras do site com `m` válido, agrupadas por pessoa: a primeira compra dá a data, a mais nova dá o plano. */
export function comprasPorMembro(lista: unknown): Map<string, CompraSite[]> {
  const saida = new Map<string, CompraSite[]>();
  if (!Array.isArray(lista)) return saida;
  for (const item of lista) {
    const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const m = typeof i.m === 'string' ? i.m.trim().toLowerCase() : '';
    const quando = typeof i.quando === 'string' ? i.quando : '';
    if (!MEMBRO_VALIDO.test(m) || !Number.isFinite(ms(quando))) continue;
    const compra: CompraSite = {
      m, quando, email: typeof i.email === 'string' ? i.email.trim() : '', plano: typeof i.plano === 'string' ? i.plano.toLowerCase() : '',
      tipo: typeof i.tipo === 'string' ? i.tipo : 'compra', pais: typeof i.pais === 'string' ? i.pais.toUpperCase().slice(0, 4) : '',
    };
    const g = saida.get(m);
    if (g) g.push(compra); else saida.set(m, [compra]);
  }
  return saida;
}

export function agruparUso(eventos: EventoApp[]): Map<string, EventoApp[]> {
  const saida = new Map<string, EventoApp[]>();
  for (const e of eventos) {
    const m = (e.m || '').toLowerCase();
    if (!MEMBRO_VALIDO.test(m) || !Number.isFinite(ms(e.created_at))) continue;
    const g = saida.get(m);
    if (g) g.push(e); else saida.set(m, [e]);
  }
  return saida;
}

export function calcularNota(diasAtivos: number, diasDesdeCompra: number, tiposDeAcao: number): number {
  const base = Math.min(DIAS_DA_NOTA, Math.max(1, diasDesdeCompra + 1));
  const nota = 70 * Math.min(1, diasAtivos / base) + 30 * Math.min(1, tiposDeAcao / VARIEDADE_CHEIA);
  return Math.round(Math.max(0, Math.min(100, nota)));
}

/** O membro de uma pessoa: compras do site (pode não haver) e todo o uso dela (pode não haver). */
export function montarMembro(m: string, compras: CompraSite[], uso: EventoApp[], janela: Janela, agora: number): Membro {
  const ordenadas = [...compras].sort((a, b) => ms(a.quando) - ms(b.quando));
  const primeira = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];
  const tempos = uso.map((e) => ms(e.created_at));
  const ultimoUsoMs = tempos.length ? Math.max(...tempos) : null;
  const noPeriodo = uso.filter((e) => { const t = ms(e.created_at); return t >= janela.desde && (janela.ate === null || t < janela.ate); });
  const diasAtivos = new Set(noPeriodo.map((e) => diaSP(ms(e.created_at)))).size;
  const diasAtivosTotal = new Set(tempos.map(diaSP)).size;
  const dias = uso.map((e) => numeroDia(e.dia)).filter((n): n is number => n !== null);
  const compradoMs = primeira ? ms(primeira.quando) : null;
  const inicioMs = compradoMs ?? (tempos.length ? Math.min(...tempos) : agora);
  const referencia = ultimoUsoMs ?? compradoMs;
  const ultimoComPais = [...uso].sort((a, b) => ms(b.created_at) - ms(a.created_at));
  const pegar = (campo: 'plan' | 'pais'): string | null => ultimoComPais.find((e) => e[campo])?.[campo] ?? null;
  return {
    m,
    email: primeira?.email || null,
    plano: (ultima?.plano || pegar('plan') || '').toLowerCase() || null,
    compradoEm: primeira?.quando ?? null,
    pais: primeira?.pais || (pegar('pais') || '').toUpperCase() || null,
    cortesia: uso.some((e) => e.cortesia === 'true'),
    semCompra: !primeira,
    ultimoUso: ultimoUsoMs !== null ? new Date(ultimoUsoMs).toISOString() : null,
    diasAtivos,
    diaMaximo: dias.length ? Math.max(...dias) : null,
    instalou: uso.some((e) => e.acao === 'instalou'),
    nota: calcularNota(diasAtivosTotal, Math.floor((agora - inicioMs) / DIA), new Set(uso.map((e) => e.acao).filter(Boolean)).size),
    parado: referencia !== null && agora - referencia >= DIAS_PARADO * DIA,
  };
}

/** plano: basico, plus, cortesia (sem compra e com acesso de cortesia) ou sem_compra (sem compra e sem cortesia). */
export interface FiltroMembros { q: string; plano: string; parados: boolean }

function passaNoPlano(x: Membro, plano: string): boolean {
  if (!plano) return true;
  if (plano === 'cortesia') return x.cortesia;
  if (plano === 'sem_compra') return x.semCompra && !x.cortesia;
  return (x.plano || '') === plano;
}

/** Todos os membros: cada compra com `m` mais quem tem uso sem compra. Mais recente em uso primeiro. */
export function montarLista(
  compras: Map<string, CompraSite[]>, uso: Map<string, EventoApp[]>, janela: Janela, agora: number, filtro: FiltroMembros,
): Membro[] {
  const todos = [...new Set([...compras.keys(), ...uso.keys()])]
    .map((m) => montarMembro(m, compras.get(m) ?? [], uso.get(m) ?? [], janela, agora));
  const q = filtro.q.trim().toLowerCase();
  return todos
    .filter((x) => !q || (x.email || '').toLowerCase().includes(q) || x.m.startsWith(q))
    .filter((x) => passaNoPlano(x, filtro.plano))
    .filter((x) => !filtro.parados || x.parado)
    .sort((a, b) => (b.ultimoUso ? ms(b.ultimoUso) : -1) - (a.ultimoUso ? ms(a.ultimoUso) : -1)
      || (b.compradoEm ? ms(b.compradoEm) : -1) - (a.compradoEm ? ms(a.compradoEm) : -1) || a.m.localeCompare(b.m));
}

export function montarLinhaDoTempo(uso: EventoApp[]): { ts: string; acao: string; texto: string }[] {
  return [...uso]
    .sort((a, b) => ms(b.created_at) - ms(a.created_at))
    .slice(0, MAX_LINHA)
    .map((e) => ({ ts: new Date(ms(e.created_at)).toISOString(), acao: e.acao || 'desconhecida', texto: textoDaAcao(e) }));
}

export function totaisPorAcao(uso: EventoApp[]): Record<string, number> {
  const conta = new Map<string, number>();
  for (const e of uso) if (e.acao) conta.set(e.acao, (conta.get(e.acao) || 0) + 1);
  return Object.fromEntries(conta);
}
