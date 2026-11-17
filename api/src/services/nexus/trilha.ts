// Regras PURAS da Trilha do Parceiro NEXUS (sem banco e sem relógio): patamar, próximo passo, pendência da equipe e a
// liberação das etapas. O patamar em curso é o primeiro não concluído (1..6); 7 = todos concluídos. NUNCA pula: cada
// patamar só vale se o anterior também está concluído.

import type { Bloqueios, Libera } from './niveis';
import { AULAS, aulasFeitas, TOTAL_AULAS } from './academia';
import { diaBRT } from './tempo';

export type LinhaTrilha = Record<string, any>;

export const PATAMARES = Object.freeze([
  { n: 1, nome: 'Mapeado' },
  { n: 2, nome: 'Diagnosticado' },
  { n: 3, nome: 'Preparado' },
  { n: 4, nome: 'Em campo' },
  { n: 5, nome: 'Cliente NEXUS' },
  { n: 6, nome: 'Parceiro regional' },
]);
export const ENCONTROS_META = 4;
/** Coluna que marca cada patamar gravado pela trilha. O 5 vem de carregadores_comprados e não tem coluna. */
export const COLUNA_DO_PATAMAR: Readonly<Record<number, string>> = Object.freeze({ 1: 'p1_em', 2: 'p2_em', 3: 'p3_em', 4: 'p4_em', 6: 'regional_em' });

/** O que o niveis.ts precisa saber da trilha para liberar as etapas. */
export interface TrilhaNivel {
  p1: boolean;
  p3: boolean;
  p4: boolean;
  regional: boolean;
}

/** Linha vazia, para quem ainda não tem linha em nexus_trilha (a equipe lê sem criar). */
export function trilhaVazia(userId: string): LinhaTrilha {
  return { user_id: userId, raio_x: {}, mentoria_encontros: 0, academia: {}, ultimo_movimento_em: null };
}

/** Quem JÁ comprou carregador (carregadores_comprados >= 1) tem os patamares 1 a 4 reconhecidos como legado, para não perder o pedido. */
export const COLUNAS_LEGADO = ['p1_em', 'p2_em', 'p3_em', 'p4_em'] as const;

/** Colunas de legado que ainda faltam na linha (vazio se o parceiro não comprou nada ou se já está tudo marcado). */
export function faltasDeLegado(parceiro: LinhaTrilha, t: LinhaTrilha | null): string[] {
  if ((Number(parceiro.carregadores_comprados) || 0) < 1) return [];
  return COLUNAS_LEGADO.filter((c) => !t?.[c]);
}

/** A linha como ela vale para a liberação: com o legado aplicado EM MEMÓRIA (nada é gravado aqui). */
export function comLegado(parceiro: LinhaTrilha, t: LinhaTrilha | null, agora: string = new Date().toISOString()): LinhaTrilha {
  const base = t ?? trilhaVazia(String(parceiro.user_id));
  return { ...base, ...Object.fromEntries(faltasDeLegado(parceiro, t).map((c) => [c, agora])) };
}

/** Cada patamar está concluído? Índice 0 = patamar 1. O 5 é o primeiro pedido confirmado. */
export function concluidos(t: LinhaTrilha | null, comprados: number): boolean[] {
  const c = [!!t?.p1_em, !!t?.p2_em, !!t?.p3_em, !!t?.p4_em, Number(comprados) >= 1, !!t?.regional_em];
  let anterior = true;
  return c.map((x) => (anterior = anterior && x)); // só conta se o anterior também está concluído
}

export function patamarEmCurso(t: LinhaTrilha | null, comprados: number): number {
  const i = concluidos(t, comprados).findIndex((x) => !x);
  return i === -1 ? 7 : i + 1;
}

export function nivelDaTrilha(t: LinhaTrilha | null, comprados: number): TrilhaNivel {
  const c = concluidos(t, comprados);
  return { p1: c[0]!, p3: c[2]!, p4: c[3]!, regional: c[5]! };
}

export const TEXTO_BLOQUEIO_TRILHA = Object.freeze({
  p1: 'Libera quando o Raio-X passar com nota 80 ou mais',
  p3: 'Libera quando você concluir o nível Preparado',
  p4: 'Libera quando você concluir o nível Em campo',
  p5: 'Libera com o primeiro pedido de carregador',
  regional: 'Libera quando a equipe promover sua empresa a Parceiro regional',
});

/** Liberação com a trilha LIGADA. `perfil` só vale para as usinas, que ficam como estavam. */
export function liberaPelaTrilha(
  e: { cadastro: boolean; perfil: boolean; comprados: number; termo_aceito: boolean },
  t: TrilhaNivel,
): Libera {
  const cad = e.cadastro;
  return {
    simulador: cad,
    basico: cad && t.p3,
    completo: cad && t.p3,
    materiais: cad && t.p3,
    engenharia: cad && t.p3,
    negociar: cad && t.p3,
    selo: cad && t.p3,
    termo: cad && t.p3,
    usinas: cad && e.perfil,
    conversa: cad && t.p1,
    pedido: cad && t.p4,
    pacotes_engenharia: cad && t.p4,
    consultoria: cad && t.p4,
    plataforma: cad && e.comprados >= 1,
    manutencao: cad && e.comprados >= 1,
    oportunidades: cad && t.regional && e.termo_aceito,
  };
}

/** Texto de cada item travado, com a trilha ligada. `textoCadastro` e `textoPerfil` vêm do niveis.ts. */
export function bloqueiosDaTrilha(libera: Libera, cadastro: boolean, textoCadastro: string, textoPerfil: string): Bloqueios {
  const motivo = (k: keyof Libera): string => {
    if (!cadastro) return textoCadastro;
    switch (k) {
      case 'usinas': return textoPerfil;
      case 'conversa': return TEXTO_BLOQUEIO_TRILHA.p1;
      case 'pedido': case 'pacotes_engenharia': case 'consultoria': return TEXTO_BLOQUEIO_TRILHA.p4;
      case 'plataforma': case 'manutencao': return TEXTO_BLOQUEIO_TRILHA.p5;
      case 'oportunidades': return TEXTO_BLOQUEIO_TRILHA.regional;
      default: return TEXTO_BLOQUEIO_TRILHA.p3; // basico, completo, materiais, engenharia, negociar, selo, termo
    }
  };
  const out: Bloqueios = {};
  for (const k of Object.keys(libera) as Array<keyof Libera>) if (!libera[k]) out[k] = motivo(k);
  return out;
}

export interface ProximoPasso { codigo: string; titulo: string; botao: string }

export interface ContextoPasso {
  t: LinhaTrilha;
  patamar: number;
  assinante: boolean;
  termo_aceito: boolean;
}

/** O passo que a aba mostra. Do patamar 2 ao 4 é preciso plano pago ativo. */
export function proximoPasso(c: ContextoPasso): ProximoPasso {
  const { t, patamar } = c;
  if (patamar >= 2 && patamar <= 4 && !c.assinante) return { codigo: 'assinar', titulo: 'Assine para seguir', botao: 'Ver planos' };
  switch (patamar) {
    case 1: {
      const comecou = !!t.raio_x && Object.keys(t.raio_x).length > 0;
      return { codigo: 'raio_x', titulo: 'Preencher o Raio-X', botao: comecou ? 'Continuar' : 'Começar' };
    }
    case 2:
      if (!t.diag_pedido_em) return { codigo: 'pedir_diagnostico', titulo: 'Pedir o diagnóstico', botao: 'Pedir' };
      if (t.diag_feito_em && t.diag_resultado === 'ainda_nao') return { codigo: 'refazer_diagnostico', titulo: 'Ajustar e pedir novo diagnóstico', botao: 'Pedir de novo' };
      if (t.diag_agendado_para) return { codigo: 'diagnostico_agendado', titulo: 'Diagnóstico agendado', botao: 'Ver detalhes' };
      return { codigo: 'aguardar_agenda', titulo: 'Aguardando a equipe agendar', botao: 'Ver detalhes' };
    case 3:
      if (!t.preparo_formato) return { codigo: 'escolher_preparo', titulo: 'Escolher mentoria ou Academia', botao: 'Escolher' };
      if (t.preparo_formato === 'mentoria') return { codigo: 'mentoria', titulo: `Mentoria: ${Number(t.mentoria_encontros) || 0} de ${ENCONTROS_META} encontros`, botao: 'Ver detalhes' };
      return { codigo: 'academia', titulo: `Academia: ${aulasFeitas(t.academia)} de ${TOTAL_AULAS} aulas`, botao: 'Continuar' };
    case 4:
      if (!c.termo_aceito) return { codigo: 'aceitar_termo', titulo: 'Aceitar o Termo de Parceria', botao: 'Ler e aceitar' };
      if (!t.reuniao_pedida_em) return { codigo: 'pedir_reuniao', titulo: 'Pedir a reunião com seu cliente', botao: 'Pedir' };
      return { codigo: 'aguardar_reuniao', titulo: 'Reunião com o cliente em andamento', botao: 'Ver detalhes' };
    case 5: return { codigo: 'primeiro_pedido', titulo: 'Fazer o primeiro pedido de carregador', botao: 'Fazer pedido' };
    case 6: return { codigo: 'aguardar_regional', titulo: 'Aguardando a promoção a Parceiro regional', botao: 'Ver detalhes' };
    default: return { codigo: 'concluida', titulo: 'Trilha concluída', botao: 'Ver histórico' };
  }
}

export type Pendencia = 'agendar_diagnostico' | 'diagnostico_hoje' | 'registrar_encontro' | 'agendar_reuniao';
export const PENDENCIAS: readonly Pendencia[] = Object.freeze(['agendar_diagnostico', 'diagnostico_hoje', 'registrar_encontro', 'agendar_reuniao']);

/** O que a EQUIPE tem a fazer por este parceiro (a primeira que se aplica). */
export function pendenciaDaEquipe(t: LinhaTrilha, agora: Date = new Date()): Pendencia | null {
  if (t.diag_pedido_em && !t.diag_feito_em) {
    if (!t.diag_agendado_para) return 'agendar_diagnostico';
    const dia = new Date(t.diag_agendado_para);
    if (!Number.isNaN(dia.getTime()) && diaBRT(dia) <= diaBRT(agora)) return 'diagnostico_hoje';
  }
  if (t.preparo_formato === 'mentoria' && t.mentoria_paga_em && !t.p3_em && (Number(t.mentoria_encontros) || 0) < ENCONTROS_META) return 'registrar_encontro';
  if (t.reuniao_pedida_em && !t.reuniao_agendada_para && !t.reuniao_feita_em) return 'agendar_reuniao';
  return null;
}

/** Dias desde o último movimento (null = nunca se mexeu). */
export function paradoHaDias(t: LinhaTrilha, agora: Date = new Date()): number | null {
  const ms = Date.parse(String(t.ultimo_movimento_em ?? ''));
  return Number.isFinite(ms) ? Math.max(0, Math.floor((agora.getTime() - ms) / 86_400_000)) : null;
}

/** O parceiro tem as 12 aulas certas e escolheu a Academia? Então o patamar 3 fecha. */
export function academiaCompleta(t: LinhaTrilha): boolean {
  return t.preparo_formato === 'academia' && aulasFeitas(t.academia) >= AULAS.length;
}
