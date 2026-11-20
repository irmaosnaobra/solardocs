// Respostas das rotas de jornada do Monjour (contrato de 19/11/2026, Desktop\ligera\JORNADAS-CONTRATO.md).
// Quem passou em cada tela do quiz, a jornada de uma sessão, os membros do app e o "O que mais gostam".
// Mesmo formato do serviço da api: mudou lá, muda aqui.

// ── funil: sessões de uma tela ──────────────────────────────────────────────
export type TipoSessoes = 'chegaram' | 'sairam';

export type SessaoQuiz = {
  sid: string;
  entrou: string;
  pais: string;
  paisNome?: string;
  regiao: string;
  cidade: string;
  disp: string;
  so: string;
  nav: string;
  idade: string;
  objetivo: string;
  cuerpo: string;
  anuncio: string;
  conjunto: string;
  maxPasso: number;
  /** Nome da tela do maxPasso. Ausente em api antiga. */
  maxPassoRotulo?: string;
  clicouComprar: boolean;
  comprou: boolean;
  plano: string | null;
  /** Entrou pelo atalho da tela 1, ou voltou direto à oferta. Ausentes em api antiga. */
  atalho?: boolean;
  volta?: boolean;
};

export type PaginaSessoes = { total: number; itens: SessaoQuiz[]; proximo: string | null; truncado?: boolean };

export type LinhaJornada = {
  ts: string;
  tipo: 'viu' | 'respondeu' | 'fim' | 'atalho';
  passo: string | null;
  n: number | null;
  rotulo: string;
  resposta: string | null;
  segundosNaTela: number | null;
};

export type JornadaSessao = { resumo: SessaoQuiz; linha: LinhaJornada[] };

// ── membros do app ──────────────────────────────────────────────────────────
export type Membro = {
  m: string;
  email: string | null;
  plano: string | null;
  compradoEm: string | null;
  pais: string | null;
  cortesia: boolean;
  semCompra?: boolean;
  ultimoUso: string | null;
  diasAtivos: number;
  diaMaximo: number | null;
  instalou: boolean;
  nota: number;
  parado: boolean;
};

/** Site fora: `indisponivel` com a lista vazia e o motivo. */
type Aviso = { truncado?: boolean; indisponivel?: true; motivo?: string };

export type ListaMembros = { total: number; itens: Membro[] } & Aviso;

export type HistoricoMembro = {
  membro: Membro;
  totais: { porAcao: Record<string, number> };
  linha: { ts: string; acao: string; texto: string }[];
} & Aviso;

// ── o que mais gostam ───────────────────────────────────────────────────────
export type ItemGosto = { alvo: string; nome?: string; tipo?: string; vezes: number; pessoas: number };

export type Gostos = {
  recetasVistas: ItemGosto[];
  recetasFeitas: ItemGosto[];
  favoritas: ItemGosto[];
  infusoes: ItemGosto[];
  abas: { aba: string; pessoas: number; vezes: number }[];
  /** Porcentagens de 0 a 100, como o pct() da api do funil. */
  usoLista: number;
  registraPeso: number;
  instalou: number;
  /** pct null = ninguém da coorte completou o dia ainda: não dá para medir. */
  retencao: { dia: number; pct: number | null; elegiveis?: number }[];
  paramNoDia: { dia: number; pessoas: number }[];
  pessoas?: number;
} & Aviso;

// ── leitura defensiva: 200 com corpo fora do formato vira erro, não tela quebrada ──
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function lerPaginaSessoes(v: unknown): PaginaSessoes | null {
  return obj(v) && Array.isArray(v.itens) ? (v as PaginaSessoes) : null;
}
export function lerJornada(v: unknown): JornadaSessao | null {
  return obj(v) && obj(v.resumo) && Array.isArray(v.linha) ? (v as JornadaSessao) : null;
}
export function lerMembros(v: unknown): ListaMembros | null {
  return obj(v) && Array.isArray(v.itens) ? (v as ListaMembros) : null;
}
export function lerHistorico(v: unknown): HistoricoMembro | null {
  return obj(v) && obj(v.membro) && Array.isArray(v.linha) ? (v as HistoricoMembro) : null;
}
export function lerGostos(v: unknown): Gostos | null {
  if (!obj(v) || !Array.isArray(v.retencao) || !Array.isArray(v.abas)) return null;
  const lista = (x: unknown) => (Array.isArray(x) ? x : []);
  return {
    ...(v as Gostos),
    recetasVistas: lista(v.recetasVistas), recetasFeitas: lista(v.recetasFeitas), favoritas: lista(v.favoritas),
    infusoes: lista(v.infusoes), paramNoDia: lista(v.paramNoDia),
  };
}
