// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE CURSOS.
//
// Curso novo = criar o arquivo dele (declarando módulos e lições) e adicionar
// aqui. Trilha, XP, níveis, conquistas, progresso e telas vêm prontos, no mesmo
// padrão — nenhuma tela nova, nenhum CSS copiado.
// Passo a passo: COMO-ADICIONAR-CURSO.md · casca e regras: curso-tipos.ts
// ═══════════════════════════════════════════════════════════════════════════

import type { Curso } from './curso-tipos';
import { KIT_FECHAMENTO } from './kit-fechamento';

export const CURSOS: Curso[] = [KIT_FECHAMENTO];

export const getCurso = (slug: string): Curso | undefined =>
  CURSOS.find((c) => c.slug === slug);

// Reexporta a casca para quem consome ter um import só.
export * from './curso-tipos';
