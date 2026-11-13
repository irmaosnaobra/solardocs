// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS DOS AVISOS DA HELENA À EQUIPE (12/11/2026). PURO: recebe o dado, devolve o texto.
//
//   · aviso na marcação: 1 bolha, o link na última linha (regra do anti-ban), até 1200 caracteres;
//   · resumo do dia: 1 bolha por consultor, no singular ou no plural, linhas em ordem de horário.
//
// Os textos são os do redator, sem mudar uma palavra. Linha sem dado some inteira.
// ─────────────────────────────────────────────────────────────────────────────

import { horaPorExtenso, quandoPorExtenso } from '../agentes5040/personas/comum';
import type { DadosDaConversa } from './investidorAgentePuro';
import type { TipoHelena } from './investidorAgenteTextos';

export const LINK_DA_ABA_HELENA = 'https://solardoc.app/gerador/agentes/#helena';
/** Uma bolha só: o teto do aviso (o texto cabe com folga; o corte é para o pior caso, nome e fatos enormes). */
export const TETO_DO_AVISO = 1200;
/** Quantas linhas de reunião o resumo mostra; o resto vira "e mais N na agenda". */
const LINHAS_NO_RESUMO = 10;

const ROTULO_DO_TIPO_NO_AVISO: Readonly<Record<TipoHelena, string>> = {
  investidor: 'Investidor', arrendamento: 'Arrendamento', parceiro: 'Parceiro', curioso: 'Curioso',
};
export const rotuloDoTipo = (t: TipoHelena): string => ROTULO_DO_TIPO_NO_AVISO[t];

const umaLinha = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Os campos da descoberta que mais dizem, por tipo, na ordem de prioridade (o primeiro de cada grupo que tiver valor). */
const PRIORIDADE_DOS_FATOS: Readonly<Record<TipoHelena, ReadonlyArray<readonly (keyof DadosDaConversa)[]>>> = {
  // Quanto quer investir; depois o local em vista, a região ou a cidade.
  investidor: [['valor_confirmado'], ['tem_ponto', 'regiao', 'cidade']],
  // O tipo do local; depois o espaço (vagas ou área).
  arrendamento: [['tipo_local'], ['tamanho_espaco']],
  // A área de atuação (ou a empresa); depois a região.
  parceiro: [['atuacao'], ['regiao_atuacao', 'regiao']],
  // O que quer saber.
  curioso: [['duvidas', 'interesse_origem']],
};

/** Até 2 dados não vazios da descoberta (a mesma fonte da ficha ao consultor: `dados` da sessão). Sem nenhum, lista vazia. */
export function fatosDoAviso(tipo: TipoHelena, dados: DadosDaConversa | undefined): string[] {
  const d = (dados ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const grupo of PRIORIDADE_DOS_FATOS[tipo]) {
    const v = grupo.map(k => umaLinha(d[k], 80)).find(Boolean);
    if (v) out.push(v);
  }
  return out;
}

export interface DadosDoAviso {
  consultor: string;
  nome: string;
  tipo: string;
  cidade: string;
  /** O horário da reunião (ISO). */
  quando: string;
  fatos: readonly string[];
}

/** "sexta, 14/11, às 10h" (com "hoje, " ou "amanhã, " na frente quando for o caso), em Brasília. */
export const quandoDoAviso = (iso: string, agoraIso: string): string => quandoPorExtenso(iso, agoraIso);

/** O aviso na marcação (mensagem única, link na última linha). */
export function textoAvisoMarcada(d: DadosDoAviso, agoraIso: string): string {
  const nome = umaLinha(d.nome, 60);
  const fatos = d.fatos.map(f => umaLinha(f, 80)).filter(Boolean).slice(0, 2);
  const monta = (f: readonly string[]): string => [
    '*REUNIÃO MARCADA PELA HELENA*',
    `Oi, ${umaLinha(d.consultor, 40)}, a Helena marcou uma reunião para você.`,
    '',
    nome ? `*Cliente:* ${nome}` : null,
    d.tipo ? `*Tipo:* ${d.tipo}` : null,
    umaLinha(d.cidade, 60) ? `*Cidade:* ${umaLinha(d.cidade, 60)}` : null,
    `*Quando:* ${quandoDoAviso(d.quando, agoraIso)}`,
    f.length ? `*Da conversa:* ${f.join('; ')}` : null,
    '',
    'A ficha completa chega antes da reunião, até 3h antes.',
    'A conversa está na aba Helena do /gerador:',
    LINK_DA_ABA_HELENA,
  ].filter((l): l is string => l !== null).join('\n');
  let texto = monta(fatos);
  // Pior caso: tira os fatos antes de passar do teto (o link nunca pode ser cortado).
  if (texto.length > TETO_DO_AVISO) texto = monta([]);
  return texto;
}

export interface LinhaDoResumo { quando: string; nome: string; tipo: string; cidade: string }

/** O resumo do dia de UM consultor: singular com 1 reunião, plural com 2 ou mais. Linhas em ordem de horário. */
export function textoResumoDoDia(consultor: string, reunioes: readonly LinhaDoResumo[]): string {
  const ordenadas = [...reunioes].sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
  const n = ordenadas.length;
  const linha = (r: LinhaDoResumo): string =>
    `Às ${horaPorExtenso(r.quando)}: ${[umaLinha(r.nome, 60) || 'sem nome', r.tipo, umaLinha(r.cidade, 60)].filter(Boolean).join(', ')}`;
  const mostradas = ordenadas.slice(0, LINHAS_NO_RESUMO).map(linha);
  if (n > LINHAS_NO_RESUMO) mostradas.push(`E mais ${n - LINHAS_NO_RESUMO} na agenda.`);
  const nomeC = umaLinha(consultor, 40);
  return (n === 1
    ? ['*REUNIÃO DE HOJE*', `Bom dia, ${nomeC}.`, 'Você tem 1 reunião marcada pela Helena hoje.', '', ...mostradas, '', 'A conversa está na aba Helena do /gerador.']
    : ['*REUNIÕES DE HOJE*', `Bom dia, ${nomeC}.`, `Você tem ${n} reuniões marcadas pela Helena hoje.`, '', ...mostradas, '', 'As conversas estão na aba Helena do /gerador.']
  ).join('\n');
}
