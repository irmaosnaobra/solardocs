// ─────────────────────────────────────────────────────────────────────────────
// NOTA DE CADA CONVERSA, TODO DIA. Um relógio (07:00 e 07:30 de Brasília) lê as conversas em que a agente falou no
// dia anterior, chama a IA UMA vez por conversa e grava a nota em `qualidade/<dia>/<hmac>.json` (bucket privado do
// ensaio). O resumo do dia vai em `qualidade/<dia>/_resumo.json` e é refeito a cada rodada. O que a agente não soube
// responder vira pergunta em aberto (perguntas.ts).
//
// NADA aqui envia mensagem: este arquivo só lê (wa_mensagens, system_state, whatsapp_sessions, bucket) e escreve
// no bucket e em system_state (as perguntas). Telefone nunca vai para o bucket nem para log: a conversa é o HMAC.
//
// QUEM É A AGENTE NA CONVERSA. A linha também manda lembrete de agenda, envio da base e a recepção antiga, tudo com
// `from_api`; `from_api` sozinho NÃO prova que a bolha foi turno da agente. A prova usada, bolha a bolha:
//   1. o carimbo `ag5040_sent:<id da fala do lead>:<1|2>` (vivoEnvio) com estado 'enviado': o `updated_at` dele é a hora
//      da reserva, perto do envio. A bolha da agente é uma bolha `from_api` ainda não reivindicada, depois da fala
//      do lead, dentro de uma janela em volta dessa hora. Se o turno gravado (`turnos/<dia>/<hmac>/<id>.json`) existe, SÓ a
//      bolha cujo texto é igual a uma das `bolhas` dele vale (sem casar, ninguém é Agente: um lembrete que chega logo depois
//      do carimbo não é confundido com ela). Sem o turno gravado (e para a peça, carimbo :2), vale a bolha mais perto da hora;
//   2. o carimbo `ag5040_retomada:<hmac>:<n>` (a Base), do mesmo jeito, pela hora.
// Toda outra bolha `from_api` é "Outro robô"; `from_me` sem `from_api` é "Equipe". O nome da agente vem do turno
// gravado (`persona`) e, na falta dele, da posse. Limites: o descobrimento das conversas parte dos carimbos
// `ag5040_sent` do dia (a conversa cujo único turno do dia foi uma retomada da Base não entra), e a abertura da fila
// de agenda (`ag5040_agenda_sent`, amarrada ao card e não ao contato) conta como "Outro robô".
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { novoAnthropic } from '../../utils/anthropicClient';
import { chaveDaLinha, lidsDasLinhas, type LinhaWa } from '../gerador/caixaWhatsapp';
import {
  gravarQualidade, gravarResumoQualidade, hmacsComQualidade, lerQualidadesDoDia,
} from './armazem';
import { lerConversa } from './contexto';
import { clienteComCota, disjuntorAberto, type EstadoCota } from './cota';
import { lerMapaLid } from './ensaio';
import { hmacDe } from './hmac';
import type { ClienteIA } from './ia';
import { classificarFalhaIA } from './ia';
import { ligado } from './interruptores';
import { produtoDaPersona, registrarPergunta, type ResultadoRegistro } from './perguntas';
import { carimboBR, diaBRT, janelaDoDiaBRT, ontemBRT } from './relogio';
import { lerTurnoExato } from './notas';
import type { MsgConversa, Persona, Produto } from './tipos';

// ── constantes ───────────────────────────────────────────────────────────────

export const MODELO_QUALIDADE_PADRAO = 'claude-sonnet-5-5';
export const modeloDaQualidade = (): string => (process.env.AGENTES5040_MODELO_QUALIDADE || '').trim() || MODELO_QUALIDADE_PADRAO;
export const MAX_TOKENS_QUALIDADE = 2000;
/** Depois disto (ms desde o começo) nenhuma conversa nova abre: a função da Vercel morre aos 300 s. */
export const ORCAMENTO_MS = 200_000;
/** Nenhuma chamada à IA sai depois disto. */
export const PRAZO_TOTAL_MS = 255_000;
export const CONCORRENCIA = 3;
const PAGINA = 1000;
const MAX_PAGINAS = 10;
const LOTE_IDS = 100;
const LOTE_ALVOS_CARIMBO = 50;
/** A bolha da agente chega dentro desta janela em volta do `updated_at` do carimbo. */
const JANELA_ANTES_MS = 10_000;
const JANELA_DEPOIS_MS = 180_000;
const MAX_LINHA = 600;
const MAX_CARACTERES_CONVERSA = 60_000;

export const DESFECHOS = ['marcou_reuniao', 'pagou', 'passou_humano', 'pediu_parar', 'sumiu', 'em_andamento', 'fora_do_escopo', 'sem_interacao'] as const;
export const QUALIDADES = ['boa', 'com_problema', 'critica'] as const;
export const TIPOS_PROBLEMA = [
  'passagem_incompleta', 'fora_do_assunto', 'repetiu_pergunta', 'loop_nao_entendeu', 'alucinacao', 'quebrou_regra',
  'ficou_calada', 'ignorou_pergunta', 'tom_errado', 'outro',
] as const;
export const VALORES = ['alto', 'medio', 'baixo', 'nenhum'] as const;
export const SENTIMENTOS = ['positivo', 'neutro', 'negativo'] as const;

export type Desfecho = typeof DESFECHOS[number];
export type Qualidade = typeof QUALIDADES[number];
export type TipoProblema = typeof TIPOS_PROBLEMA[number];

export interface Problema { tipo: TipoProblema; trecho: string; explicacao: string }
export interface PerguntaEmAberto { pergunta_curta: string; trecho: string; como_respondeu: string }

/** O que a IA devolve (já limpo e cortado). */
export interface NotaIA {
  resumo: string;
  desfecho: Desfecho;
  qualidade: Qualidade;
  problemas: Problema[];
  valor: typeof VALORES[number];
  intencao: string;
  sentimento: typeof SENTIMENTOS[number];
  parou_depois_de: string;
  perguntas_em_aberto: PerguntaEmAberto[];
}

/** O que vai no arquivo: a nota mais a identificação. */
export interface NotaGravadaQualidade extends NotaIA {
  dia: string;
  hmac: string;
  agente: Persona;
  produto: Produto;
  modelo: string;
  gerado_em: string;
  turnos_da_agente_no_dia: number;
}

// ── o schema que a IA recebe ─────────────────────────────────────────────────

const texto = { type: 'string' };

/** json_schema estrito: sem maxLength (a saída estrita não garante), os cortes são feitos no código (lerNotaIA). */
export const SCHEMA_NOTA = {
  type: 'object',
  properties: {
    resumo: texto,
    desfecho: { type: 'string', enum: [...DESFECHOS] },
    qualidade: { type: 'string', enum: [...QUALIDADES] },
    problemas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tipo: { type: 'string', enum: [...TIPOS_PROBLEMA] }, trecho: texto, explicacao: texto },
        required: ['tipo', 'trecho', 'explicacao'],
        additionalProperties: false,
      },
    },
    valor: { type: 'string', enum: [...VALORES] },
    intencao: texto,
    sentimento: { type: 'string', enum: [...SENTIMENTOS] },
    parou_depois_de: texto,
    perguntas_em_aberto: {
      type: 'array',
      items: {
        type: 'object',
        properties: { pergunta_curta: texto, trecho: texto, como_respondeu: texto },
        required: ['pergunta_curta', 'trecho', 'como_respondeu'],
        additionalProperties: false,
      },
    },
  },
  required: ['resumo', 'desfecho', 'qualidade', 'problemas', 'valor', 'intencao', 'sentimento', 'parou_depois_de', 'perguntas_em_aberto'],
  additionalProperties: false,
};

const corta = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const dentro = <T extends string>(lista: readonly T[], v: unknown): T | null => (lista as readonly string[]).includes(String(v)) ? (v as T) : null;

/** Lê o texto devolvido pela IA. Fora do formato = null (a conversa fica sem nota e a próxima rodada tenta de novo). */
export function lerNotaIA(bruto: string): NotaIA | null {
  let j: unknown;
  try { j = JSON.parse(String(bruto ?? '').trim()); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const desfecho = dentro(DESFECHOS, o.desfecho);
  const qualidade = dentro(QUALIDADES, o.qualidade);
  const valor = dentro(VALORES, o.valor);
  const sentimento = dentro(SENTIMENTOS, o.sentimento);
  if (!desfecho || !qualidade || !valor || !sentimento || typeof o.resumo !== 'string') return null;
  const problemas: Problema[] = [];
  for (const p of Array.isArray(o.problemas) ? o.problemas : []) {
    const r = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    problemas.push({ tipo: dentro(TIPOS_PROBLEMA, r.tipo) ?? 'outro', trecho: corta(r.trecho, 200), explicacao: corta(r.explicacao, 200) });
    if (problemas.length >= 12) break;
  }
  const perguntas: PerguntaEmAberto[] = [];
  for (const p of Array.isArray(o.perguntas_em_aberto) ? o.perguntas_em_aberto : []) {
    const r = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const curta = corta(r.pergunta_curta, 120);
    if (!curta) continue;
    perguntas.push({ pergunta_curta: curta, trecho: corta(r.trecho, 200), como_respondeu: corta(r.como_respondeu, 160) });
    if (perguntas.length >= 8) break;
  }
  return {
    resumo: corta(o.resumo, 300), desfecho, qualidade, problemas, valor, intencao: corta(o.intencao, 160), sentimento,
    parou_depois_de: corta(o.parou_depois_de, 200), perguntas_em_aberto: perguntas,
  };
}

// ── o prompt do avaliador ────────────────────────────────────────────────────

// Sem crase aqui dentro: a crase fecha a string e o tsc passa.
const NOME_DA_AGENTE: Record<Persona, string> = { duda: 'Duda', carla: 'Carla', helena: 'Helena' };
const PRODUTO_EM_TEXTO: Record<Produto, string> = {
  solar: 'energia solar (a Duda faz a pré-venda e põe a consultora em contato)',
  solardoc: 'o SolarDoc, o sistema de propostas solares (a Carla vende pelo WhatsApp)',
  eletroposto: 'eletroposto, o carregador de carro elétrico (a Helena qualifica e leva o lead à reunião)',
};

export const SISTEMA_AVALIADOR = [
  'Você é o auditor de qualidade das agentes de IA de WhatsApp da Irmãos na Obra. Você lê UMA conversa e avalia SÓ o trabalho da agente, nos turnos do dia avaliado.',
  '',
  'COMO LER A CONVERSA',
  '- Cada linha tem a hora, o autor e o texto. Os autores são: Lead (o cliente), Agente (a agente de IA que você avalia, com o nome), Outro robô (lembrete de agenda, envio da base ou a recepção antiga: NÃO é a agente, não julgue) e Equipe (gente do nosso time no celular, não julgue).',
  '- Linhas que começam com asterisco (*) são do DIA AVALIADO. As demais são só contexto. Julgue APENAS os turnos da Agente nas linhas com asterisco. Problema que aconteceu em dia anterior não entra: ele já foi avaliado naquele dia.',
  '- Use a conversa inteira para entender o que já foi dito, mas o trecho de cada problema tem que estar nas linhas com asterisco.',
  '',
  'O QUE A AGENTE PODE E NÃO PODE (regras da casa)',
  '- Uma bolha curta por vez (até 160 caracteres), uma pergunta por resposta, escrita de gente no WhatsApp, sem lista, sem menu e sem emoji.',
  '- Nunca nega ser IA. Se perguntarem se é robô, assume a verdade numa frase e segue.',
  '- Só responde: nunca abre conversa por conta própria nem cobra resposta (a única exceção é a retomada da Base, que é uma bolha leve de volta).',
  '- A Duda (solar) não dá preço nem economia em reais: quem mostra os números é a consultora, com a conta de luz na mão.',
  '- A Carla (SolarDoc) vende o plano a R$ 67 por mês. Qualquer outro preço, desconto ou prazo que ela invente é problema.',
  '- A Helena (eletroposto) não promete retorno, prazo de obra nem valor que não esteja no conhecimento dela.',
  '- Quem passa a conversa para uma pessoa (consultora, consultor, Giovanna do suporte) tem que dizer ao cliente o que acontece em seguida. Prometer "já avisei" sem a ação de aviso, ou passar sem dizer nada, é passagem incompleta.',
  '',
  'OS TIPOS DE PROBLEMA (use exatamente estes nomes)',
  '- passagem_incompleta: prometeu avisar alguém e não avisou, ou passou a conversa sem dizer ao lead o que acontece.',
  '- fora_do_assunto: seguiu o cliente para fora do produto (conta de matemática, receita, opinião, assunto geral).',
  '- repetiu_pergunta: perguntou de novo o que o lead já respondeu (no texto, no áudio, na foto ou na ficha).',
  '- loop_nao_entendeu: ficou girando na mesma resposta sem entender o que o lead quis dizer.',
  '- alucinacao: afirmou como fato algo que não estava no conhecimento, como preço, prazo, garantia, função ou condição.',
  '- quebrou_regra: deu preço ou economia que não podia, negou ser IA, fez mais de uma pergunta na bolha, escreveu bolha longa, usou emoji ou lista.',
  '- ficou_calada: o lead precisava de resposta no dia avaliado e a agente não disse nada (sem ser caso de pedir para parar).',
  '- ignorou_pergunta: o lead fez uma pergunta direta e a agente respondeu outra coisa.',
  '- tom_errado: seca, robótica, melosa demais, apressada, ou insistente com quem recusou.',
  '- outro: problema real que não cabe nos tipos acima.',
  'Para cada problema traga o trecho LITERAL da conversa que prova (copie as palavras, até 200 caracteres) e uma explicação curta (até 200 caracteres). Sem prova literal, não registre o problema.',
  '',
  'OS CAMPOS DA NOTA',
  '- resumo: o que aconteceu na conversa, até 300 caracteres.',
  '- desfecho: marcou_reuniao, pagou, passou_humano, pediu_parar, sumiu, em_andamento, fora_do_escopo ou sem_interacao (o lead nunca respondeu). Escolha o estado ao FIM do dia avaliado.',
  '- qualidade: boa (sem problema relevante), com_problema (erro que atrapalha mas não perde o lead) ou critica (perdeu ou pode ter perdido o lead, deu informação falsa, negou ser IA ou desrespeitou pedido para parar).',
  '- valor: a chance de a conversa virar venda: alto, medio, baixo ou nenhum.',
  '- intencao: o que o lead quer, em poucas palavras.',
  '- sentimento: positivo, neutro ou negativo (o do lead).',
  '- parou_depois_de: a última pergunta da agente antes de o lead sumir, ou vazio se ele não sumiu.',
  '- perguntas_em_aberto: perguntas do lead sobre o produto, a empresa, preço, prazo ou processo que a agente NÃO soube responder ou respondeu com rodeio. Para cada uma: pergunta_curta (a pergunta numa forma curta e neutra, até 120 caracteres, sem nome nem dado do lead, igual para o mesmo assunto), o trecho literal e como a agente respondeu (até 160 caracteres). Nada pessoal e nada fora do escopo do produto. Lista vazia se não houve.',
  '',
  'Seja justo e específico. Conversa sem erro é qualidade boa com a lista de problemas vazia. Responda só o JSON pedido.',
].join('\n');

// ── descobrir quem foi turno da agente ───────────────────────────────────────

export type AutorRotulado = 'lead' | 'agente' | 'outro_robo' | 'equipe';

export interface CarimboDeEnvio {
  /** A hora da reserva do carimbo (ISO). */
  em: string;
  /** O id da fala do lead que a agente respondeu (ag5040_sent). A retomada não tem: null. */
  waIdAlvo: number | null;
  /** 1 = a bolha, 2 = a peça (link, Pix ou imagem). O texto do turno gravado só diz a bolha: a peça vai pela hora. */
  n?: number;
}

const normaliza = (t: string | null | undefined): string => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Rotula cada mensagem. `bolhasDoAlvo` tem, por id da fala do lead, as bolhas que o turno gravado diz ter enviado
 * (desempate por texto). Uma bolha só vale para UM carimbo.
 */
export function rotularConversa(
  msgs: readonly MsgConversa[], carimbos: readonly CarimboDeEnvio[], bolhasDoAlvo: ReadonlyMap<number, readonly string[]> = new Map(),
): Map<number, AutorRotulado> {
  const rotulos = new Map<number, AutorRotulado>();
  for (const m of msgs) rotulos.set(m.id, m.autor === 'lead' ? 'lead' : m.autor === 'equipe' ? 'equipe' : 'outro_robo');
  const reivindicadas = new Set<number>();
  const ordenados = [...carimbos].filter(c => Number.isFinite(Date.parse(c.em))).sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  for (const c of ordenados) {
    const t = Date.parse(c.em);
    const candidatas = msgs.filter(m => m.autor === 'robo' && !reivindicadas.has(m.id)
      && (c.waIdAlvo === null || m.id > c.waIdAlvo)
      && Date.parse(m.momment) >= t - JANELA_ANTES_MS && Date.parse(m.momment) <= t + JANELA_DEPOIS_MS);
    if (!candidatas.length) continue;
    const textos = new Set((c.waIdAlvo !== null && c.n !== 2 ? (bolhasDoAlvo.get(c.waIdAlvo) ?? []) : []).map(normaliza).filter(Boolean));
    // Com o texto do turno conhecido, só vale a bolha que casa: sem casar, ninguém é "Agente" (um lembrete que chega logo
    // depois do carimbo não pode ser confundido com a fala dela). Sem o texto, vale a bolha mais perto da hora do carimbo.
    const escolhida = textos.size > 0
      ? candidatas.find(m => textos.has(normaliza(m.texto)))
      : [...candidatas].sort((a, b) => Math.abs(Date.parse(a.momment) - t) - Math.abs(Date.parse(b.momment) - t) || a.id - b.id)[0];
    if (!escolhida) continue;
    reivindicadas.add(escolhida.id);
    rotulos.set(escolhida.id, 'agente');
  }
  return rotulos;
}

/** A conversa em texto para a IA: asterisco nas linhas do dia avaliado. Passou do teto, as linhas antigas de fora do dia saem primeiro. */
export function montarTranscricao(
  msgs: readonly MsgConversa[], rotulos: ReadonlyMap<number, AutorRotulado>, dia: string, agente: Persona,
): string {
  const quem = (a: AutorRotulado): string => a === 'lead' ? 'Lead' : a === 'agente' ? `Agente (${NOME_DA_AGENTE[agente]})` : a === 'equipe' ? 'Equipe (humano)' : 'Outro robô (não é a agente)';
  const linhas = msgs.map(m => {
    const digitado = String(m.texto ?? '').trim();
    const falado = !digitado && m.tipo === 'audio' ? String(m.transcricao ?? '').trim() : '';
    const conteudo = falado ? `(áudio transcrito) ${falado}` : digitado || (m.tipo && m.tipo !== 'texto' && m.tipo !== 'text' ? `[${m.tipo}]` : '');
    if (!conteudo) return null;
    const doDia = diaBRT(m.momment) === dia;
    return { doDia, linha: `${doDia ? '* ' : '  '}${carimboBR(m.momment)}${quem(rotulos.get(m.id) ?? 'outro_robo')}: ${conteudo.slice(0, MAX_LINHA)}` };
  }).filter((x): x is { doDia: boolean; linha: string } => x !== null);
  let total = linhas.reduce((n, l) => n + l.linha.length + 1, 0);
  let corte = 0;
  while (total > MAX_CARACTERES_CONVERSA && corte < linhas.length) {
    // Tira do começo, só linhas de fora do dia avaliado.
    const i = linhas.findIndex((l, k) => k >= corte && !l.doDia);
    if (i < 0) break;
    total -= linhas[i]!.linha.length + 1;
    linhas.splice(i, 1);
    corte = i;
  }
  const omitidas = msgs.length > linhas.length;
  return (omitidas ? ['  (mensagens antigas omitidas)'] : []).concat(linhas.map(l => l.linha)).join('\n');
}

export function pedidoDeAvaliacao(dia: string, agente: Persona, produto: Produto, transcricao: string): string {
  return [
    `Dia avaliado: ${dia} (horário de Brasília). Agente: ${NOME_DA_AGENTE[agente]}, de ${PRODUTO_EM_TEXTO[produto]}.`,
    'Conversa (mais antiga primeiro). Linhas com asterisco (*) são do dia avaliado:',
    transcricao || '(vazia)',
    '',
    'Avalie só os turnos da Agente nas linhas com asterisco e devolva a nota no formato pedido.',
  ].join('\n');
}

// ── o resumo do dia ──────────────────────────────────────────────────────────

type Contagem = Record<string, number>;
const soma = (o: Contagem, k: string): void => { o[k] = (o[k] ?? 0) + 1; };

export interface ResumoAgente { total: number; por_desfecho: Contagem; por_qualidade: Contagem; por_problema: Contagem }
export interface ResumoDoDia {
  dia: string;
  atualizado_em: string;
  total: number;
  por_desfecho: Contagem;
  por_qualidade: Contagem;
  por_problema: Contagem;
  por_agente: Record<string, ResumoAgente>;
}

/** Conta as notas do dia: por desfecho, qualidade, tipo de problema e agente. */
export function resumirNotas(dia: string, notas: ReadonlyArray<Pick<NotaGravadaQualidade, 'agente' | 'desfecho' | 'qualidade' | 'problemas'>>, agora: Date): ResumoDoDia {
  const r: ResumoDoDia = { dia, atualizado_em: agora.toISOString(), total: 0, por_desfecho: {}, por_qualidade: {}, por_problema: {}, por_agente: {} };
  for (const n of notas) {
    r.total++;
    soma(r.por_desfecho, n.desfecho); soma(r.por_qualidade, n.qualidade);
    const a = (r.por_agente[n.agente] ??= { total: 0, por_desfecho: {}, por_qualidade: {}, por_problema: {} });
    a.total++; soma(a.por_desfecho, n.desfecho); soma(a.por_qualidade, n.qualidade);
    for (const p of n.problemas ?? []) { soma(r.por_problema, p.tipo); soma(a.por_problema, p.tipo); }
  }
  return r;
}

// ── a rodada ─────────────────────────────────────────────────────────────────

export interface OpcoesQualidade {
  /** Só lista as candidatas e quantas já têm nota. Não chama a IA, não grava, não reserva cota. */
  dry?: boolean;
  agora?: Date;
  /** AAAA-MM-DD (Brasília). Padrão: ontem. */
  dia?: string;
  /** No máximo N conversas avaliadas nesta rodada. */
  limite?: number;
  /** Cliente da IA (testes passam um falso). Padrão: o SDK de verdade. */
  cliente?: ClienteIA;
  /** Orçamento de tempo para abrir conversa nova (ms). Padrão 200 s. */
  orcamentoMs?: number;
  concorrencia?: number;
}

export interface RelatorioQualidade {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  dia: string;
  motivo?: string;
  /** Conversas do dia com turno da agente e posse. */
  candidatas: number;
  /** Já tinham nota. */
  jaTinhamNota: number;
  puladas: Record<string, number>;
  avaliadas: number;
  chamadasIA: number;
  perguntas: { criadas: number; somadas: number; fechadas: number; erros: number };
  parou: EstadoCota['parou'] | 'prazo' | 'limite' | null;
  resumo: ResumoDoDia | null;
}

const vazio = (dry: boolean, dia: string, extra: Partial<RelatorioQualidade> = {}): RelatorioQualidade => ({
  ok: true, ligado: true, dry, dia, candidatas: 0, jaTinhamNota: 0, puladas: {}, avaliadas: 0, chamadasIA: 0,
  perguntas: { criadas: 0, somadas: 0, fechadas: 0, erros: 0 }, parou: null, resumo: null, ...extra,
});

interface Candidata {
  chave: string;
  hmac: string;
  /** Os ids das falas do lead respondidas no dia (carimbos ag5040_sent). */
  alvos: number[];
}

const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'interno').slice(0, 20);

async function lerPaginado<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await consulta(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw Object.assign(new Error('leitura'), { code: codigoDe(error) });
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return out;
}

/** Os carimbos de envio da agente com `updated_at` dentro do dia: o id da fala respondida de cada um. */
async function alvosDoDia(desde: string, ate: string): Promise<number[]> {
  const linhas = await lerPaginado<{ key: string; value: { estado?: string } | null }>((de, hasta) =>
    supabase.from('system_state').select('key, value').like('key', 'ag5040_sent:%')
      .gte('updated_at', desde).lte('updated_at', ate).order('key', { ascending: true }).range(de, hasta) as any);
  const ids = new Set<number>();
  for (const l of linhas) {
    if (l.value?.estado !== 'enviado') continue;
    const id = Number(l.key.split(':')[1]);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/** Do id das falas à conversa (chave do contato). Só linhas da instância da linha IO. */
async function candidatasDosAlvos(ids: readonly number[], inst: string): Promise<Map<string, Candidata>> {
  const linhas: Array<Pick<LinhaWa, 'id' | 'telefone' | 'is_group'>> = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { data, error } = await supabase.from('wa_mensagens').select('id, telefone, is_group')
      .eq('instancia', inst).in('id', ids.slice(i, i + LOTE_IDS));
    if (error) throw Object.assign(new Error('leitura'), { code: codigoDe(error) });
    linhas.push(...((data ?? []) as typeof linhas));
  }
  const mapa = await lerMapaLid(lidsDasLinhas(linhas));
  const porChave = new Map<string, Candidata>();
  for (const l of linhas) {
    const chave = chaveDaLinha(l, mapa);
    if (!chave) continue;
    const hmac = hmacDe(chave);
    if (!hmac) continue;
    const atual = porChave.get(chave) ?? { chave, hmac, alvos: [] };
    atual.alvos.push(l.id);
    porChave.set(chave, atual);
  }
  return porChave;
}

interface PosseLida { dona: string }

/** A posse `ag5040` de cada chave (só as que existem). Chave de LID puro não tem posse. */
async function posses(chaves: readonly string[]): Promise<Map<string, PosseLida>> {
  const out = new Map<string, PosseLida>();
  const telefones = chaves.filter(c => /^\d{10}$/.test(c));
  for (let i = 0; i < telefones.length; i += LOTE_IDS) {
    const { data, error } = await supabase.from('whatsapp_sessions').select('phone, lead_data')
      .eq('tipo', 'ag5040').in('phone', telefones.slice(i, i + LOTE_IDS));
    if (error) throw Object.assign(new Error('leitura'), { code: codigoDe(error) });
    for (const r of (data ?? []) as Array<{ phone: string; lead_data: { dona?: string } | null }>) {
      out.set(r.phone, { dona: String(r.lead_data?.dona ?? '') });
    }
  }
  return out;
}

/** Todos os carimbos de envio da conversa: respostas (pelo id das falas do lead) e retomadas (pelo HMAC). */
async function carimbosDaConversa(msgs: readonly MsgConversa[], hmac: string): Promise<CarimboDeEnvio[]> {
  const out: CarimboDeEnvio[] = [];
  const idsLead = msgs.filter(m => m.autor === 'lead').map(m => m.id);
  for (let i = 0; i < idsLead.length; i += LOTE_ALVOS_CARIMBO) {
    const chaves = idsLead.slice(i, i + LOTE_ALVOS_CARIMBO).flatMap(id => [`ag5040_sent:${id}:1`, `ag5040_sent:${id}:2`]);
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at').in('key', chaves);
    if (error) throw Object.assign(new Error('leitura'), { code: codigoDe(error) });
    for (const r of (data ?? []) as Array<{ key: string; value: { estado?: string } | null; updated_at: string }>) {
      if (r.value?.estado !== 'enviado') continue;
      out.push({ em: String(r.updated_at ?? ''), waIdAlvo: Number(r.key.split(':')[1]), n: Number(r.key.split(':')[2]) });
    }
  }
  const { data: ret, error: eRet } = await supabase.from('system_state').select('key, value, updated_at').like('key', `ag5040_retomada:${hmac}:%`);
  if (eRet) throw Object.assign(new Error('leitura'), { code: codigoDe(eRet) });
  for (const r of (ret ?? []) as Array<{ updated_at: string }>) out.push({ em: String(r.updated_at ?? ''), waIdAlvo: null });
  return out;
}

const ehPersona = (p: unknown): p is Persona => p === 'duda' || p === 'carla' || p === 'helena';

/**
 * Uma rodada. Nunca lança: erro vira { ok:false, motivo }. Roda duas vezes por dia (07:00 e 07:30); a segunda pega o
 * que a primeira deixou por tempo ou por teto. Idempotente: conversa com nota no dia é pulada.
 */
export async function runQualidadeTick(opts: OpcoesQualidade = {}): Promise<RelatorioQualidade> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const inicio = Date.now();
  const dia = opts.dia && janelaDoDiaBRT(opts.dia) ? opts.dia : ontemBRT(agora);
  try {
    // Desligado: nenhuma leitura. O dry é só leitura e passa por cima do interruptor (como o do ensaio).
    if (!dry && !(await ligado('qualidade'))) return vazio(dry, dia, { ligado: false, motivo: 'interruptor qualidade desligado' });
    const janela = janelaDoDiaBRT(dia);
    if (!janela) return vazio(dry, dia, { ok: false, motivo: 'dia inválido' });
    if (!hmacDe('qualidade')) return vazio(dry, dia, { ok: false, motivo: 'sem segredo de HMAC: a qualidade não roda' });
    const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
    if (!inst) return vazio(dry, dia, { ok: false, motivo: 'sem a instância da linha IO' });
    if (!dry && await disjuntorAberto(agora)) return vazio(dry, dia, { parou: 'disjuntor', motivo: 'disjuntor aberto' });

    // 1. quem a agente respondeu no dia → a conversa → só as que têm posse
    const alvos = await alvosDoDia(janela.desde, janela.ate);
    const porChave = alvos.length ? await candidatasDosAlvos(alvos, inst) : new Map<string, Candidata>();
    const comPosse = porChave.size ? await posses([...porChave.keys()]) : new Map<string, PosseLida>();
    const r = vazio(dry, dia);
    const candidatas: Candidata[] = [];
    for (const c of porChave.values()) {
      if (!comPosse.has(c.chave)) { soma(r.puladas, 'sem_posse'); continue; }
      candidatas.push(c);
    }
    candidatas.sort((a, b) => (a.hmac < b.hmac ? -1 : 1));
    r.candidatas = candidatas.length;

    // 2. quem já tem nota
    const jaTem = await hmacsComQualidade(dia);
    const pendentes = candidatas.filter(c => !jaTem.has(c.hmac));
    r.jaTinhamNota = candidatas.length - pendentes.length;
    if (dry) return r;

    // 3. a rodada
    const orcamento = opts.orcamentoMs ?? ORCAMENTO_MS;
    const limite = opts.limite !== undefined && Number.isInteger(opts.limite) && opts.limite > 0 ? opts.limite : Infinity;
    const base: ClienteIA = opts.cliente ?? (novoAnthropic() as unknown as ClienteIA);
    const { cliente, estado } = clienteComCota('qualidade', () => new Date(), base, inicio + PRAZO_TOTAL_MS);
    const modelo = modeloDaQualidade();
    let proximo = 0;
    let abertas = 0;
    // As perguntas são fundidas em SÉRIE: ler-e-gravar a mesma pergunta em paralelo perderia contagem.
    let filaDePerguntas: Promise<void> = Promise.resolve();

    const trabalhador = async (): Promise<void> => {
      for (;;) {
        if (estado.parou) { r.parou ??= estado.parou; return; }
        if (Date.now() - inicio > orcamento) { r.parou ??= 'prazo'; return; }
        if (abertas >= limite) { r.parou ??= 'limite'; return; }
        const c = pendentes[proximo++];
        if (!c) return;
        abertas++;
        await avaliarConversa(c, {
          dia, agora, modelo, cliente, estado, r, posse: comPosse.get(c.chave)!,
          enfileirarPerguntas: (fn) => { filaDePerguntas = filaDePerguntas.then(fn, fn); },
        });
      }
    };
    const n = Math.max(1, Math.min(opts.concorrencia ?? CONCORRENCIA, 4));
    await Promise.all(Array.from({ length: n }, () => trabalhador()));
    await filaDePerguntas;
    if (estado.parou) r.parou ??= estado.parou;
    r.chamadasIA = estado.chamadas;

    // 4. o resumo do dia, refeito a cada rodada a partir de TODAS as notas do dia
    const notas = await lerQualidadesDoDia<NotaGravadaQualidade>(dia);
    if (notas.length) {
      r.resumo = resumirNotas(dia, notas.map(x => x.nota), agora);
      await gravarResumoQualidade(dia, r.resumo);
    }
    return r;
  } catch (e) {
    console.error('[agentes5040] qualidade falhou', codigoDe(e));
    return vazio(dry, dia, { ok: false, motivo: 'a rodada falhou' });
  }
}

interface Rodada {
  dia: string; agora: Date; modelo: string; cliente: ClienteIA; estado: EstadoCota; r: RelatorioQualidade; posse: PosseLida;
  enfileirarPerguntas: (fn: () => Promise<void>) => void;
}

async function avaliarConversa(c: Candidata, g: Rodada): Promise<void> {
  const { r, dia } = g;
  try {
    // a. a conversa inteira (LID tratado pelo lerConversa)
    const conv = await lerConversa(c.chave);
    if (!conv.completa || !conv.msgs.length) { soma(r.puladas, 'conversa_incompleta'); return; }

    // b. quem falou: os carimbos e, no dia, os turnos gravados (persona e texto das bolhas)
    const carimbos = await carimbosDaConversa(conv.msgs, c.hmac);
    const bolhasDoAlvo = new Map<number, string[]>();
    let personaDoTurno: Persona | null = null;
    for (const id of c.alvos) {
      const m = conv.msgs.find(x => x.id === id);
      const t = m ? await lerTurnoExato(diaBRT(m.momment), c.hmac, id).catch(() => null) : null;
      if (!t) continue;
      bolhasDoAlvo.set(id, t.bolhas ?? []);
      if (!personaDoTurno && ehPersona(t.persona)) personaDoTurno = t.persona;
    }
    const rotulos = rotularConversa(conv.msgs, carimbos, bolhasDoAlvo);
    const turnosNoDia = conv.msgs.filter(m => rotulos.get(m.id) === 'agente' && diaBRT(m.momment) === dia).length;
    if (!turnosNoDia) { soma(r.puladas, 'sem_turno_da_agente_no_dia'); return; }
    const agente: Persona | null = personaDoTurno ?? (ehPersona(g.posse.dona) ? g.posse.dona : null);
    if (!agente) { soma(r.puladas, 'agente_desconhecida'); return; }
    const produto = produtoDaPersona(agente);

    // c. a chamada (uma por conversa)
    const transcricao = montarTranscricao(conv.msgs, rotulos, dia, agente);
    let resposta: any;
    try {
      resposta = await g.cliente.messages.create({
        model: g.modelo,
        max_tokens: MAX_TOKENS_QUALIDADE,
        system: [{ type: 'text', text: SISTEMA_AVALIADOR }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA_NOTA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: pedidoDeAvaliacao(dia, agente, produto, transcricao) }] }],
      }, { timeout: 60_000, maxRetries: 0 });
    } catch (e) {
      if (!g.estado.parou) console.warn('[agentes5040] qualidade: chamada à IA falhou', classificarFalhaIA(String((e as { message?: string })?.message ?? e)));
      soma(r.puladas, g.estado.parou ? 'ia_indisponivel' : 'ia_falhou');
      return;
    }
    const parada = String(resposta?.stop_reason ?? '');
    if (parada === 'refusal' || parada === 'max_tokens') { soma(r.puladas, 'ia_sem_nota'); return; }
    const textoIA = (Array.isArray(resposta?.content) ? resposta.content : []).map((b: any) => (b?.type === 'text' ? b.text : '')).join('');
    const nota = lerNotaIA(textoIA);
    if (!nota) { soma(r.puladas, 'ia_formato'); return; }

    // d. grava a nota (sem sobrescrever) e só então soma as perguntas
    const gravada: NotaGravadaQualidade = {
      dia, hmac: c.hmac, agente, produto, modelo: g.modelo, gerado_em: new Date().toISOString(), turnos_da_agente_no_dia: turnosNoDia, ...nota,
    };
    const res = await gravarQualidade(dia, c.hmac, gravada);
    if (res !== 'gravado') { soma(r.puladas, 'ja_tinha_nota'); return; }
    r.avaliadas++;
    g.enfileirarPerguntas(async () => {
      for (const p of unicasPorChave(nota.perguntas_em_aberto)) {
        const x: ResultadoRegistro = await registrarPergunta({ produto, pergunta_curta: p.pergunta_curta, dia, hmac: c.hmac, como_respondeu: p.como_respondeu }, g.agora);
        if (x === 'criada') r.perguntas.criadas++; else if (x === 'somada') r.perguntas.somadas++; else if (x === 'fechada') r.perguntas.fechadas++; else r.perguntas.erros++;
      }
    });
  } catch (e) {
    console.error('[agentes5040] qualidade: conversa falhou', codigoDe(e));
    soma(r.puladas, 'erro_na_conversa');
  }
}

/** A mesma pergunta duas vezes na mesma nota conta uma vez só. */
function unicasPorChave(lista: readonly PerguntaEmAberto[]): PerguntaEmAberto[] {
  const vistas = new Set<string>();
  const out: PerguntaEmAberto[] = [];
  for (const p of lista) {
    const k = p.pergunta_curta.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || vistas.has(k)) continue;
    vistas.add(k);
    out.push(p);
  }
  return out;
}
