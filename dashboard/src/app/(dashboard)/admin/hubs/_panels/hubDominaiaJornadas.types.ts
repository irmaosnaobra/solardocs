// Respostas das rotas de jornada da Domina IA, no formato das rotas /admin/dominaia/quiz-funil.
// Quem passou em cada tela do quiz, a jornada de uma sessão.
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

// ── leitura defensiva: 200 com corpo fora do formato vira erro, não tela quebrada ──
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function lerPaginaSessoes(v: unknown): PaginaSessoes | null {
  return obj(v) && Array.isArray(v.itens) ? (v as PaginaSessoes) : null;
}
export function lerJornada(v: unknown): JornadaSessao | null {
  return obj(v) && obj(v.resumo) && Array.isArray(v.linha) ? (v as JornadaSessao) : null;
}
