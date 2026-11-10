// Formato das respostas de /limpapro/* (api/src/routes/limpapro.ts) e pequenos ajudantes de texto.

export type Bloqueio = 'sem_acesso' | 'premium' | 'item' | 'espera' | null;

export interface AulaCurso {
  slug: string;
  grupo: 'modulo' | 'incluso' | 'bonus' | 'extra';
  modulo: number | null;
  ordem: number;
  titulo: string;
  resumo: string;
  minutos: number;
  bonus: boolean;
  feita: boolean;
  bloqueio: Bloqueio;
  liberaEm?: string;
}

export type EstadoCertificado =
  | { liberado: true; url: string }
  | { liberado: false; motivo: 'faltam'; faltam: number }
  | { liberado: false; motivo: 'plano' }
  | { liberado: false; motivo: 'espera'; liberaEm: string };

export interface CursoResposta {
  acesso: boolean;
  premium?: boolean;
  aulas?: AulaCurso[];
  progresso?: Record<string, true>;
  modulosFeitos?: number;
  modulosTotal?: number;
  certificado?: EstadoCertificado;
}

export interface Pergunta { q: string; o: string[]; c: number }

export interface AulaResposta {
  slug: string;
  titulo: string;
  minutos: number;
  grupo: AulaCurso['grupo'];
  modulo: number | null;
  html: string;
  quiz: Pergunta[];
  feita: boolean;
  marcados: number[];
}

/** Dias inteiros que faltam até a data (mínimo 1 enquanto ainda não chegou). */
export function diasAte(iso: string | undefined, agora = Date.now()): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - agora;
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 86_400_000));
}

export const textoDias = (n: number): string => (n === 1 ? '1 dia' : `${n} dias`);

/** Texto do cadeado de uma aula. */
export function textoBloqueio(a: Pick<AulaCurso, 'bloqueio' | 'liberaEm'>): string {
  if (a.bloqueio === 'premium') return 'Este bônus é do plano Completo.';
  if (a.bloqueio === 'espera') return `Abre em ${textoDias(diasAte(a.liberaEm))}.`;
  if (a.bloqueio === 'item') return 'Esta aula não está no seu acesso.';
  return '';
}

/** Primeira aula do curso principal que ainda não foi feita e já está aberta. */
export function proximaDoCurso(aulas: AulaCurso[]): AulaCurso | null {
  return aulas.find((a) => a.grupo === 'modulo' && !a.feita && !a.bloqueio) ?? null;
}

/** A aula seguinte, na ordem do curso, que a pessoa pode abrir. */
export function aulaSeguinte(aulas: AulaCurso[], slug: string): AulaCurso | null {
  const i = aulas.findIndex((a) => a.slug === slug);
  if (i < 0) return null;
  return aulas.slice(i + 1).find((a) => !a.bloqueio) ?? null;
}
