// A "visão" da trilha: o JSON que o GET /nexus/trilha devolve ao parceiro (e a ficha da equipe, que é a mesma visão com os
// e-mails da equipe). Só leitura. O e-mail de quem é da equipe NUNCA vai na visão do parceiro: o autor vira 'NEXUS'.

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { Linha, separarCidadeUf, termoAceitoNaVersao } from './repositorio';
import { TERMO_VERSAO } from './catalogo';
import { aulasFeitas, progressoParaFront, TOTAL_AULAS } from './academia';
import { ENCONTROS_META, LinhaTrilha, concluidos, paradoHaDias, patamarEmCurso, pendenciaDaEquipe, proximoPasso } from './trilha';
import { calcularNota } from './trilhaRaioX';
import { lerEventos } from './trilhaRepo';

const TITULOS: Record<string, string> = {
  raio_x_enviado: 'Raio-X enviado', diagnostico_pedido: 'Diagnóstico pedido', diagnostico_agendado: 'Diagnóstico agendado',
  diagnostico_feito: 'Diagnóstico feito', preparo_escolhido: 'Preparação escolhida', mentoria_paga: 'Mentoria confirmada',
  mentoria_encontro: 'Encontro da mentoria registrado', academia_aula: 'Aula da Academia respondida', reuniao_pedida: 'Reunião com o cliente pedida',
  reuniao_agendada: 'Reunião agendada', reuniao_feita: 'Reunião feita', patamar_concluido: 'Nível concluído',
  promover_regional: 'Promovido a Parceiro regional', avancar: 'Nível avançado pela equipe', legado: 'Níveis anteriores reconhecidos',
  responsavel: 'Responsável definido', obs: 'Observação da equipe',
};
/** Eventos que só a equipe vê. */
const SO_EQUIPE = new Set(['obs', 'responsavel']);
/** Chaves de `dados` que são da equipe (motivo, observação, e-mail): nunca vão ao parceiro. */
const CHAVES_DA_EQUIPE = new Set(['motivo', 'obs', 'email', 'autor']);

export function autorParaOParceiro(autor: string): 'voce' | 'NEXUS' | 'sistema' {
  return autor === 'parceiro' ? 'voce' : autor === 'sistema' ? 'sistema' : 'NEXUS';
}

export function historicoDe(eventos: Linha[], paraEquipe: boolean) {
  return eventos
    .filter((e) => paraEquipe || !SO_EQUIPE.has(String(e.tipo)))
    .map((e) => {
      const dados = (e.dados && typeof e.dados === 'object' ? e.dados : {}) as Record<string, unknown>;
      return {
        tipo: e.tipo,
        titulo: TITULOS[String(e.tipo)] ?? 'Movimento na trilha',
        dados: paraEquipe ? dados : Object.fromEntries(Object.entries(dados).filter(([k]) => !CHAVES_DA_EQUIPE.has(k))),
        autor: paraEquipe ? String(e.autor) : autorParaOParceiro(String(e.autor)),
        em: e.created_at,
      };
    });
}

/** Lê sem derrubar a tela: o que o SolarDoc já sabe é enriquecimento, falha vira valor vazio. */
async function tolerante<T>(rotulo: string, vazio: T, fn: () => PromiseLike<T>): Promise<T> {
  try { return await fn(); } catch (e) { logger.warn('nexus-trilha', `${rotulo} falhou`, e); return vazio; }
}

/** O que o SolarDoc já sabe do parceiro (nada disso é perguntado de novo). */
export async function prefillDoSolarDoc(userId: string, parceiro: Linha, company: Linha | null) {
  const [extra, clientes, propostas] = await Promise.all([
    tolerante('empresa da trilha', null as Linha | null, async () => {
      const { data, error } = await supabase.from('company').select('cor_marca, engenheiro_crea').eq('user_id', userId).limit(1);
      if (error) throw new Error(error.message);
      return ((data as Linha[] | null) ?? [])[0] ?? null;
    }),
    tolerante('clientes PJ da trilha', [] as Linha[], async () => {
      const { data, error } = await supabase.from('clients').select('id, nome, cidade, uf').eq('user_id', userId).eq('tipo', 'PJ').order('nome', { ascending: true }).limit(50);
      if (error) throw new Error(error.message);
      return (data as Linha[] | null) ?? [];
    }),
    tolerante('propostas solares da trilha', 0, async () => {
      const { count, error } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('tipo', 'propostaSolar');
      if (error) throw new Error(error.message);
      return count ?? 0;
    }),
  ]);
  return {
    empresa: parceiro.empresa ?? company?.nome_fantasia ?? company?.nome ?? null,
    cnpj: parceiro.cnpj ?? null,
    cidade: parceiro.cidade ?? null,
    uf: parceiro.uf ?? null,
    tem_logo: !!company?.logo_base64,
    cor_marca: extra?.cor_marca ?? null,
    engenheiro_crea: !!String(extra?.engenheiro_crea ?? '').trim(),
    clientes_pj: clientes.map((c) => { const l = separarCidadeUf(c.cidade, c.uf); return { id: c.id, nome: c.nome, cidade: l.cidade, uf: l.uf }; }),
    propostas_solares: propostas,
  };
}

/** Data do 1º pedido confirmado (patamar 5). Sem data legível, cai na última atualização do parceiro. */
async function dataDoPrimeiroPedido(userId: string, parceiro: Linha): Promise<string | null> {
  if ((Number(parceiro.carregadores_comprados) || 0) < 1) return null;
  const achada = await tolerante('1º pedido da trilha', null as string | null, async () => {
    const { data, error } = await supabase.from('nexus_pedidos').select('confirmado_em').eq('user_id', userId).eq('status', 'confirmado').order('confirmado_em', { ascending: true }).limit(1);
    if (error) throw new Error(error.message);
    return String(((data as Linha[] | null) ?? [])[0]?.confirmado_em ?? '') || null;
  });
  return achada ?? (parceiro.updated_at ? String(parceiro.updated_at) : null);
}

export interface EntradaVisao {
  parceiro: Linha;
  company: Linha | null;
  t: LinhaTrilha;
  assinante: boolean;
  /** Ficha da equipe: histórico com o e-mail de quem agiu e os campos internos. */
  paraEquipe?: boolean;
}

export async function montarVisao(e: EntradaVisao): Promise<Record<string, unknown>> {
  const { parceiro, company, t } = e;
  const userId = String(parceiro.user_id);
  const comprados = Number(parceiro.carregadores_comprados) || 0;
  const patamar = patamarEmCurso(t, comprados);
  const termoAceito = termoAceitoNaVersao(parceiro);
  const [prefill, eventos, p5Em] = await Promise.all([prefillDoSolarDoc(userId, parceiro, company), lerEventos(userId), dataDoPrimeiroPedido(userId, parceiro)]);

  const respostas = (t.raio_x && typeof t.raio_x === 'object' ? t.raio_x : {}) as Record<string, unknown>;
  const { nota, faltas } = calcularNota(respostas, { cnpj: prefill.cnpj, cidade: prefill.cidade, uf: prefill.uf, tem_logo: prefill.tem_logo });
  const c = concluidos(t, comprados);

  const visao: Record<string, unknown> = {
    ligada: true,
    patamar,
    assinante: e.assinante,
    etapas: {
      p1: { em: c[0] ? t.p1_em : null }, p2: { em: c[1] ? t.p2_em : null }, p3: { em: c[2] ? t.p3_em : null },
      p4: { em: c[3] ? t.p4_em : null }, p5: { em: c[4] ? p5Em : null }, p6: { em: c[5] ? t.regional_em : null },
    },
    raio_x: { respostas, nota, enviado_em: t.raio_x_enviado_em ?? null, faltas },
    diagnostico: {
      pedido_em: t.diag_pedido_em ?? null, preferencia: t.diag_preferencia ?? null, agendado_para: t.diag_agendado_para ?? null,
      link: t.diag_link ?? null, feito_em: t.diag_feito_em ?? null, resultado: t.diag_resultado ?? null, plano: t.diag_plano ?? null,
    },
    preparo: {
      formato: t.preparo_formato ?? null, mentoria_paga_em: t.mentoria_paga_em ?? null, encontros: Number(t.mentoria_encontros) || 0,
      encontros_meta: ENCONTROS_META, academia: { feitas: aulasFeitas(t.academia), meta: TOTAL_AULAS, aulas: progressoParaFront(t.academia) },
    },
    termo: { aceito: termoAceito, versao: TERMO_VERSAO },
    reuniao: { pedida_em: t.reuniao_pedida_em ?? null, dados: t.reuniao_dados ?? null, agendada_para: t.reuniao_agendada_para ?? null, feita_em: t.reuniao_feita_em ?? null },
    proximo_passo: proximoPasso({ t, patamar, assinante: e.assinante, termo_aceito: termoAceito }),
    prefill,
    historico: historicoDe(eventos, e.paraEquipe === true),
  };
  if (e.paraEquipe) {
    visao.equipe = { responsavel_email: t.responsavel_email ?? null, obs_equipe: t.obs_equipe ?? null, pendencia_equipe: pendenciaDaEquipe(t), parado_ha_dias: paradoHaDias(t) };
  }
  return visao;
}
