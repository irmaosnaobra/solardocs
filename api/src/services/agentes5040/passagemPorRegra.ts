// A passagem para humano decidida por REGRA DE CÓDIGO, antes do modelo (linha 5040, rodada viva).
//
// Hoje quem decide passar a conversa a uma pessoa é o modelo, e o teste de ataque achou passagens incompletas (o lead
// pede reembolso ou ameaça a empresa e a agente responde como se nada). Aqui a decisão é palavra por palavra, sem IA:
//   · dinheiro_de_volta: PEDIDO de reembolso, estorno, "dinheiro/valor de volta", chargeback (qualquer persona);
//   · juridico: AMEAÇA em 1ª pessoa (Procon, "vou processar", "vou levar na justiça", "meu advogado vai entrar"...);
//   · pessoa: pedido claro de falar com uma pessoa/atendente/humano/vendedor/responsável, SÓ para a Duda e SÓ em horário
//     comercial (a ação que ela dispara é o "ligar agora", que só existe nesse horário).
// PRINCÍPIO: a regra só age em pedido ou ameaça clara em 1ª pessoa. Pergunta de pré-venda ("tem reembolso?"), fala de terceiro
// ("a Cemig está na justiça", "meu vizinho entrou na justiça") e pedido para depois ("falo com o vendedor amanhã") NÃO agem:
// na dúvida devolve null e o modelo decide como hoje. Passar errado fecha a posse de um lead bom.
// Função PURA: não importa envio nem banco (o teste de isolamento vigia). Pedido de parar de receber mensagem
// (opt-out) tem precedência e devolve null: o fluxo normal trata.

import { pareceOptOut, pedeParaPararDeReceber } from './baseRegras';
import { horarioComercial, type Instante } from './relogio';
import { semAcento } from './trava';
import type { Persona } from './tipos';

export type MotivoDePassagem = 'dinheiro_de_volta' | 'juridico' | 'pessoa';
export interface PassagemPorRegra { motivo: MotivoDePassagem; trecho: string }

/** O texto como as regras leem: sem acento, minúsculo e com espaço único. */
export const normalizarRajada = (s: string): string => semAcento(s).replace(/\s+/g, ' ').trim();

/** Negação logo antes do verbo ("não preciso falar com atendente", "não vou processar ninguém"): a regra não age. */
const NEGACAO = String.raw`(?<!\bnao\s(?:\w+\s)?)(?<!\bnunca\s)(?<!\bsem\s)(?<!\bjamais\s)`;

/** A frase em que o trecho aparece, só até ele (do último ponto, interrogação, exclamação ou ponto e vírgula). */
const fraseAte = (t: string, indice: number): string => t.slice(0, indice).split(/[.!?;]/).pop() ?? '';
/** O mesmo, cortando também na vírgula (a oração do pedido). */
const oracaoAte = (t: string, indice: number): string => t.slice(0, indice).split(/[.!?;,]/).pop() ?? '';

/** Casa o primeiro regex que acerta E cuja frase anterior passa no veto. `veto` recebe a frase (ou oração) que vem antes do trecho. */
function primeiro(re: readonly RegExp[], t: string, veto?: (antes: string, fim: string, r: RegExp) => boolean, cortarNaVirgula = false): string | null {
  for (const r of re) {
    const m = r.exec(t);
    if (!m) continue;
    // `fim` = o que fecha a frase depois do trecho ('?', '.', '!', ';' ou '' se o texto acaba ali).
    const fim = /[.!?;]/.exec(t.slice(m.index + m[0].length))?.[0] ?? '';
    if (veto && veto((cortarNaVirgula ? oracaoAte : fraseAte)(t, m.index), fim, r)) continue;
    return m[0];
  }
  return null;
}

// ── dinheiro_de_volta: só PEDIDO. Pergunta de pré-venda ("tem reembolso?", "se eu cancelar tem estorno?") nunca age. ──

const ARTIGOS = String.raw`(?:(?:o|um|meu|meus|do)\s+){0,3}`;
const COISA = String.raw`(?:reembolso|estorno|dinheiro\s+de\s+volta|valor\s+de\s+volta)`;

const CADE = /\bcade\s+(?:(?:o|a|meu|minha)\s+){0,2}(?:reembolso|estorno|dinheiro|valor)\b/;
const DINHEIRO: RegExp[] = [
  // "quero o meu reembolso", "exijo meu dinheiro de volta", "preciso de um estorno"
  new RegExp(String.raw`\b(?:quero|exijo|preciso|necessito|cobro|gostaria)\s+(?:de\s+)?${ARTIGOS}${COISA}`),
  // "cadê o meu reembolso", "cadê o dinheiro" (a interrogação aqui é cobrança, não pergunta de pré-venda)
  CADE,
  // "devolvam o meu dinheiro", "me devolve o valor"
  /\bdevolv(?:am|a|e|er)\s+(?:(?:o|a|do|dos|de|meu|meus|todo|esse|este|seu)\s+){0,3}(?:dinheiro|valor)\b/,
  /\bdevolucao\s+(?:(?:do|de|dos|o|meu|meus)\s+){1,3}(?:dinheiro|valor)\b/,
  // "meu reembolso", "meu estorno"
  /\bmeu\s+(?:reembolso|estorno)\b/,
  // "pedi o reembolso", "solicito estorno", "quero pedir o reembolso"
  /\b(?:pedi|solicito|solicitei|pedindo|(?:quero|vou|preciso|gostaria\s+de)\s+pedir)\s+(?:(?:o|um|meu|de)\s+){0,2}(?:reembolso|estorno)\b/,
  // "vou contestar a cobrança/compra": nunca a conta de luz (isso é com a concessionária, não com a gente)
  /\bcontest(?:ar|ei|o|ando|acao)\s+(?:(?:a|o|essa|esse|esta|este|uma|um|minha|meu|na|no|da|do)\s+){0,2}(?:cobranca|compra)\w*/,
];
const CHARGEBACK = /\bchargeback\b/;
/**
 * Pergunta de pré-venda: o pedido termina em "?" ("se eu cancelar devolvem o dinheiro?"), ou a palavra de pré-venda vem COLADA nele
 * (no máximo uma palavra no meio: "tem reembolso", "se eu cancelar tem estorno", "posso pedir reembolso"). Reclamação com a palavra
 * mais longe ("se vocês não resolverem quero meu dinheiro de volta", "já tem 10 dias e quero meu reembolso") passa.
 */
const PRE_VENDA_COLADA = /\b(?:se|caso|tem|tenho|tenha|posso|possa|existe|ha|havera|garantia|garantias|como|sera|qual|quais|quanto)\s+(?:\w+\s+)?$/;
const ehPreVenda = (antes: string, fim: string, r: RegExp): boolean => PRE_VENDA_COLADA.test(antes) || (fim === '?' && r !== CADE);
const CONTA_DE_LUZ = /\b(?:cemig|luz|energia|concessionaria|equatorial|cpfl|enel|neoenergia|energisa|celesc|copel|light|fatura\s+de\s+energia)\b/;

// ── juridico: AMEAÇA em 1ª pessoa. Fala de terceiro ("a Cemig está na justiça") e conversa de contrato não agem. ──

const JURIDICO: RegExp[] = [
  /\bprocon\b/,
  /\bconsumidor\s*\.?\s*gov\b/,
  new RegExp(String.raw`${NEGACAO}\bvou\s+(?:te\s+|lhes\s+|os\s+|vos\s+)?processar\b`),
  /\bprocessar\s+(?:voces|vcs|vc|a\s+empresa)\b/,
  // "vou entrar na justiça", "vamos levar isso pra justiça", "vou colocar vocês na justiça", "vou na justiça"
  new RegExp(String.raw`${NEGACAO}\b(?:vou|vamos|irei|iremos)\s+(?:\w+\s+){0,4}?(?:na|pra|para)\s+justica\b`),
  new RegExp(String.raw`${NEGACAO}\b(?:vou|vamos|irei|iremos)\s+(?:entrar\s+com|abrir|mover|ajuizar|ingressar\s+com)\s+(?:uma\s+)?acao\b`),
  /\b(?:vou|vamos|irei)\s+(?:\w+\s+){0,3}?(?:ao|no|em)\s+juizado\b/,
  /\bjuizado\s+de\s+pequenas\s+causas\b/,
  // "vou postar no Reclame Aqui", "já postei no reclame aqui"
  /\b(?:vou|vamos|irei|postei|reclamei|abri|registrei)\s+(?:\w+\s+){0,4}?reclame\s*aqui\b/,
];
/**
 * Advogado: só ameaça EXPLÍCITA ("vou acionar o advogado", "meu advogado vai entrar com processo"). "Vou mostrar, passar, levar ou
 * mandar pro meu advogado" é revisão de proposta, não ameaça, e fica de fora. Conversa de contrato na rajada também não conta.
 */
const ADVOGADO: RegExp[] = [
  /\b(?:meu|minha)\s+advogad[oa]\s+vai\s+(?:\w+\s+){0,2}?(?:entrar\s+com|acionar|processar|mover|ajuizar|tomar\s+as\s+providencias)\b/,
  /\b(?:vou|vamos|irei)\s+acionar\s+(?:o|a|meu|minha|um|uma)\s+(?:advogad[oa]|justica)\b/,
  /\b(?:vou|vamos|irei)\s+tomar\s+(?:as\s+)?providencias\s+(?:com|junto\s+com)\s+(?:o\s+)?(?:meu|minha)\s+advogad[oa]\b/,
];
/** Assunto de contrato na mesma rajada: o advogado está lendo a proposta, não ameaçando. */
const CONVERSA_DE_CONTRATO = /\b(?:contrato|proposta|orcamento|minuta|assinar|assinatura|analis\w*|revis\w*|avali\w*|olhar|ler|conferir)\b/;

// ── pessoa ───────────────────────────────────────────────────────────────────

const FIM_DA_FRASE = String.raw`(?=\s*(?:$|[.!?,;]|\s(?:de\s+verdade|real|humana|ai|da\s+empresa|do\s+atendimento|por\s+favor|pf|pfv|agora|mesmo|que\s+(?:possa|resolva|entenda|atenda))))`;
/** Quem o lead quer: atendente, humano, vendedor, responsável, ou "uma pessoa" quando a frase acaba ali (não "uma pessoa da minha família"). */
const ALVO_DA_PESSOA = String.raw`(?:atendente|atendimento\s+humano|ser\s+humano|humano|vendedor(?:a)?|alguem\s+de\s+verdade|gente\s+de\s+verdade`
  + String.raw`|(?:uma\s+)?pessoa${FIM_DA_FRASE}|responsavel${FIM_DA_FRASE})`;
const ARTIGO = String.raw`(?:(?:um|uma|o|a|algum|alguma|outro|outra)\s+)?`;

const PESSOA: RegExp[] = [
  // "falar com um atendente", "conversar com alguém de verdade", "falar com o responsável"
  new RegExp(String.raw`${NEGACAO}(?<!\b(?:vou|vamos|vai|vao|iremos|irei)\s)\b(?:falar|conversar|papear)\s+(?:direto\s+)?(?:com|c)\s+${ARTIGO}${ALVO_DA_PESSOA}`),
  // "quero um atendente", "preciso de um humano", "prefiro atendimento humano"
  new RegExp(String.raw`${NEGACAO}\b(?:quero|preciso|prefiro|queria|gostaria\s+de|necessito)\s+(?:de\s+)?${ARTIGO}(?:atendente|atendimento\s+humano|ser\s+humano|humano|vendedor(?:a)?|alguem\s+de\s+verdade|pessoa\s+de\s+verdade|responsavel${FIM_DA_FRASE})`),
  // "me passa para um atendente", "me coloca em contato com uma pessoa". O "me" é o que diz que ele fala conosco (e não "vou passar o número pra uma pessoa").
  new RegExp(String.raw`${NEGACAO}\bme\s+(?:passa|passe|passar|transfere|transfira|transferir|encaminha|encaminhe|encaminhar|coloca|coloque|colocar)\w*\s+(?:\w+\s+){0,3}?(?:para|pra|com)\s+${ARTIGO}${ALVO_DA_PESSOA}`),
  // "passa para um atendente", "transfere pra um humano" (sem o "me": só os alvos sem ambiguidade)
  new RegExp(String.raw`${NEGACAO}\b(?:passa|passe|transfere|transfira|encaminha|encaminhe)\s+(?:\w+\s+){0,2}?(?:para|pra)\s+${ARTIGO}(?:atendente|humano|vendedor(?:a)?)\b`),
  // "quero ser atendido por um humano"
  new RegExp(String.raw`${NEGACAO}\b(?:ser|ficar)\s+atendid[oa]\s+por\s+${ARTIGO}${ALVO_DA_PESSOA}`),
  // "chama um atendente"
  new RegExp(String.raw`${NEGACAO}\b(?:chama|chame|chamar)\s+${ARTIGO}(?:atendente|humano|vendedor(?:a)?)\b`),
  // "atendimento humano" / "atendente humano" soltos são o pedido de quem quer sair do robô
  /\b(?:atendimento|atendente)\s+humano\b/,
  // a mensagem inteira é só a palavra
  /^(?:um\s+)?(?:atendente|humano)[\s.!?]*$/,
];
/** Pedido para DEPOIS: "posso falar com o vendedor depois?", "quero falar com o vendedor amanhã". Não é para ligar agora. */
const NO_FUTURO = /\b(?:depois|amanha|mais\s+tarde|outro\s+dia|semana\s+que\s+vem|proxima\s+semana|mes\s+que\s+vem|mais\s+pra\s+frente|mais\s+para\s+frente|daqui\s+a|hoje\s+a\s+noite|a\s+noite|de\s+noite|segunda|terca|quarta|quinta|sexta|sabado|domingo|qualquer\s+hora|quando\s+(?:der|puder|tiver))\b/;
/** Outra pessoa é quem fala: "vou pedir pra minha esposa falar com a vendedora", "vou falar com um atendente depois". */
const TERCEIRO_NA_ORACAO = /\b(?:vou|vamos|irei|iremos|ela|ele|esposa|marido|mulher|filho|filha|pai|mae|socio|socia|irmao|irma|amigo|amiga|cunhado|cunhada|vizinho|vizinha|primo|prima|genro|nora)\b/;

/** O trecho que casou, curto (cabe no resumo da ficha): no máximo 60 caracteres, com espaço único. */
const curto = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * A regra manda passar a conversa a uma pessoa? `textoDaRajada` é o que o lead escreveu desde a última fala da agente.
 * Devolve null (o modelo decide como hoje) ou o motivo e o trecho que casou. `pessoa` só vale para a Duda e dentro do
 * horário comercial; dinheiro_de_volta e juridico valem para qualquer persona e hora. Dinheiro e jurídico têm prioridade.
 */
export function motivoDePassagem(textoDaRajada: string, persona: Persona, agora: Instante): PassagemPorRegra | null {
  const t = normalizarRajada(String(textoDaRajada ?? ''));
  if (!t) return null;
  // Pedido de parar de receber mensagem vem antes de tudo: quem trata é o fluxo normal (silêncio, despedida).
  if (pareceOptOut([t]) || pedeParaPararDeReceber([t])) return null;

  const chargeback = CHARGEBACK.exec(t);
  if (chargeback) return { motivo: 'dinheiro_de_volta', trecho: curto(chargeback[0]) };
  // "contestar a cobrança da Cemig" é conta de luz: nunca é nosso reembolso (e a concessionária no texto vale para a rajada toda).
  const dinheiro = CONTA_DE_LUZ.test(t)
    ? primeiro(DINHEIRO.slice(0, -1), t, ehPreVenda)
    : primeiro(DINHEIRO, t, ehPreVenda);
  if (dinheiro) return { motivo: 'dinheiro_de_volta', trecho: curto(dinheiro) };

  const juridico = primeiro(JURIDICO, t) ?? (CONVERSA_DE_CONTRATO.test(t) ? null : primeiro(ADVOGADO, t));
  if (juridico) return { motivo: 'juridico', trecho: curto(juridico) };

  if (persona === 'duda' && horarioComercial(agora) && !NO_FUTURO.test(t)) {
    const pessoa = primeiro(PESSOA, t, antes => TERCEIRO_NA_ORACAO.test(antes), true);
    if (pessoa) return { motivo: 'pessoa', trecho: curto(pessoa) };
  }
  return null;
}
