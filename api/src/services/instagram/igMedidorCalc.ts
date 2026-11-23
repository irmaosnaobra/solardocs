// ────────────────────────────────────────────────────────────────────────────
// MEDIDOR DO INSTAGRAM: cálculos puros (sem I/O, sem Graph, sem banco).
// Mediana, classificação por post, formato a CORTAR, relatório semanal e ritmo para as metas de seguidores.
// A coleta fica em igMedidor.ts, que reexporta tudo daqui.
// ────────────────────────────────────────────────────────────────────────────

const TZ = 'America/Sao_Paulo';
const HORAS_MINIMAS = 72;
const BASE_POSTS = 30;
const METAS = [10_000, 20_000, 50_000, 100_000];

export type Decisao = 'REPETIR' | 'MANTER' | 'CORRIGIR' | 'CORTAR';
export type DecisaoPost = Decisao | 'AGUARDANDO';

// ── funções puras ────────────────────────────────────────────────────────────

/** Mediana de uma lista de números (ignora o que não é número finito). Lista vazia: 0. */
export function mediana(nums: ReadonlyArray<number | null | undefined>): number {
  const v = nums.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Razão do valor sobre a mediana; null quando a mediana é 0 (não há como comparar). */
export const razaoDe = (valor: number, med: number): number | null => (med > 0 ? valor / med : null);

/**
 * REPETIR: views >= 1,5x E salvamentos+compartilhamentos >= 1x a mediana, ou qualquer um dos dois >= 2x.
 * CORRIGIR: views <= 0,67x OU salvamentos+compartilhamentos <= 0,67x. O resto é MANTER.
 * Mediana 0 não dá razão: aquela métrica não conta nem a favor nem contra.
 */
export function classificarPost(
  post: { views: number; salvaCompart: number },
  med: { medViews: number; medSalvaCompart: number },
): 'REPETIR' | 'MANTER' | 'CORRIGIR' {
  const rv = razaoDe(post.views, med.medViews);
  const rs = razaoDe(post.salvaCompart, med.medSalvaCompart);
  if ((rv !== null && rv >= 2) || (rs !== null && rs >= 2)) return 'REPETIR';
  if (rv !== null && rs !== null && rv >= 1.5 && rs >= 1) return 'REPETIR';
  if ((rv !== null && rv <= 0.67) || (rs !== null && rs <= 0.67)) return 'CORRIGIR';
  return 'MANTER';
}

export interface FormatoComDecisoes {
  tipo: string;
  /** Decisões dos posts já avaliados deste formato, do MAIS RECENTE para o mais antigo. */
  decisoes: Decisao[];
  decisao: Decisao;
}

/** Formato com os 3 posts mais recentes (avaliados) seguidos em CORRIGIR vira CORTAR. */
export function marcarCortar<T extends FormatoComDecisoes>(lista: T[], seguidos = 3): T[] {
  return lista.map((f) => {
    const topo = f.decisoes.slice(0, seguidos);
    const corta = topo.length === seguidos && topo.every((d) => d === 'CORRIGIR');
    return corta ? { ...f, decisao: 'CORTAR' as Decisao } : f;
  });
}

/** Próxima meta de seguidores acima do atual (a última da lista se já passou de todas). */
export function proximaMeta(seguidores: number): number {
  return METAS.find((m) => m > seguidores) ?? METAS[METAS.length - 1];
}

/** AAAA-MM-DD em Brasília. */
export function diaBR(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Hora cheia (0-23) em Brasília. */
export function horaBR(d: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d);
  return parseInt(h, 10) % 24;
}

export const somaDias = (dia: string, n: number): string => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Tipo gravado: Reels/Story pelo produto; feed pelo tipo da mídia (IMAGE, VIDEO, CAROUSEL_ALBUM). */
export function tipoDaMidia(mediaType?: string | null, produto?: string | null): string {
  const p = String(produto || '').toUpperCase();
  if (p && p !== 'FEED') return p;
  return String(mediaType || p || 'DESCONHECIDO').toUpperCase();
}

// ── relatório semanal ────────────────────────────────────────────────────────

export interface LinhaPost {
  media_id: string; tipo: string | null; publicado_em: string | null; legenda: string | null; permalink: string | null;
  views: number | null; saved: number | null; shares: number | null; comments: number | null; follows: number | null;
}

export interface PostRelatorio {
  media_id: string; permalink: string | null; tipo: string | null; publicado_em: string | null; legendaInicio: string;
  views: number | null; salvaCompart: number | null; comments: number | null; follows: number | null;
  razaoViews: number | null; razaoSalvaCompart: number | null; decisao: DecisaoPost;
}

const arred = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);

/** Monta o relatório a partir das linhas (a última coleta de cada post). Pura: não toca no banco. */
export function montarRelatorio(
  linhas: LinhaPost[],
  conta: Array<{ dia: string; seguidores: number | null; ganho_dia: number | null }>,
  agora: Date = new Date(),
) {
  const t = agora.getTime();
  const idadeH = (p: LinhaPost): number => (p.publicado_em ? (t - new Date(p.publicado_em).getTime()) / 3_600_000 : -1);
  const sc = (p: LinhaPost): number => (p.saved ?? 0) + (p.shares ?? 0);
  const porData = [...linhas].filter((p) => p.publicado_em).sort((a, b) => +new Date(b.publicado_em!) - +new Date(a.publicado_em!));

  // Base de comparação: 30 posts mais recentes com 72 h ou mais de vida
  const base = porData.filter((p) => idadeH(p) >= HORAS_MINIMAS).slice(0, BASE_POSTS);
  const medianas = { medViews: mediana(base.map((p) => p.views)), medSalvaCompart: mediana(base.map(sc)) };

  const avalia = (p: LinhaPost): PostRelatorio => {
    const maduro = idadeH(p) >= HORAS_MINIMAS;
    const views = p.views ?? 0;
    const rv = maduro ? razaoDe(views, medianas.medViews) : null;
    const rs = maduro ? razaoDe(sc(p), medianas.medSalvaCompart) : null;
    return {
      media_id: p.media_id, permalink: p.permalink, tipo: p.tipo, publicado_em: p.publicado_em,
      legendaInicio: String(p.legenda ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      views: p.views, salvaCompart: p.saved === null && p.shares === null ? null : sc(p), comments: p.comments, follows: p.follows,
      razaoViews: arred(rv), razaoSalvaCompart: arred(rs),
      decisao: maduro ? classificarPost({ views, salvaCompart: sc(p) }, medianas) : 'AGUARDANDO',
    };
  };

  // Posts da semana (últimos 7 dias); os com menos de 72 h aparecem como AGUARDANDO
  const semanaPosts = porData.filter((p) => idadeH(p) <= 7 * 24).map(avalia);

  // Formatos: sobre a base inteira, do mais recente para o mais antigo
  const grupos = new Map<string, PostRelatorio[]>();
  for (const p of base.map(avalia)) {
    const k = p.tipo ?? 'DESCONHECIDO';
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  const formatos: Array<FormatoComDecisoes & { posts: number; mediaRazao: number | null }> = [...grupos].map(([tipo, ps]) => {
    const rz = ps.map((p) => {
      const v = [p.razaoViews, p.razaoSalvaCompart].filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }).filter((x): x is number => x !== null);
    const mediaRazao = rz.length ? rz.reduce((a, b) => a + b, 0) / rz.length : null;
    const decisao: Decisao = mediaRazao === null ? 'MANTER' : mediaRazao >= 1.5 ? 'REPETIR' : mediaRazao <= 0.67 ? 'CORRIGIR' : 'MANTER';
    return { tipo, posts: ps.length, mediaRazao: arred(mediaRazao), decisao, decisoes: ps.map((p) => p.decisao as Decisao) };
  });
  const porFormato = marcarCortar(formatos).map(({ tipo, posts, mediaRazao, decisao }) => ({ tipo, posts, mediaRazao, decisao }));

  // Conta
  const contaOrd = [...conta].sort((a, b) => (a.dia < b.dia ? 1 : -1));
  const seguidores = contaOrd.find((c) => c.seguidores !== null)?.seguidores ?? null;
  const hoje = diaBR(agora);
  const desde = somaDias(hoje, -7);
  const ganhos = contaOrd.filter((c) => c.dia > desde && c.ganho_dia !== null).map((c) => c.ganho_dia as number);
  const ganhoSemana = ganhos.length ? ganhos.reduce((a, b) => a + b, 0) : null;
  const meta = seguidores !== null ? proximaMeta(seguidores) : null;
  const faltam = meta !== null && seguidores !== null ? Math.max(0, meta - seguidores) : null;
  const diasNoRitmoAtual = faltam !== null && ganhoSemana !== null && ganhoSemana > 0 ? Math.ceil(faltam / (ganhoSemana / 7)) : null;

  return {
    semana: `${desde} a ${hoje}`,
    seguidores,
    ganhoSemana,
    ritmoParaMeta: { meta, faltam, diasNoRitmoAtual },
    medianas,
    posts: semanaPosts,
    porFormato,
    comentariosSemana: semanaPosts.reduce((a, p) => a + (p.comments ?? 0), 0),
  };
}
