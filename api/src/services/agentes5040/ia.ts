// ─────────────────────────────────────────────────────────────────────────────
// A CHAMADA À IA DAS AGENTES 5040. A persona entra por PARÂMETRO (PersonaDef): este
// arquivo não importa personas/. Não grava, não envia e não lê banco.
//
//  · Principal claude-opus-5-5, reserva claude-sonnet-5-5 (a reserva da Helena antiga
//    era o 4-6: não copiar). Falha do principal = erro, `refusal`, `max_tokens` ou
//    saída fora do schema; nos quatro casos a mesma pergunta vai à reserva. Crédito
//    zerado ou chave recusada NÃO vão à reserva (é a mesma conta; só gasta tempo).
//  · O bloco fixo (persona + regras + conhecimento) vai em `system` com cache de 1 hora. As respostas do dono
//    (perguntas.ts) vão num SEGUNDO bloco de system, sem cache, que o turno resolve e passa em `sistemaExtra`.
//    O que é do lead (fatos, conversa, mídia) vai SÓ na mensagem do usuário.
//  · Saída por json_schema (nas duas chamadas). O campo `thinking` nunca é enviado.
//  · Sem repetição automática do SDK e com tempo limite por chamada.
//  · `pensar` = pergunta + trava + UMA reescrita; se quebrar de novo, a agente não fala.
//  · Nada de `ia_falha:*` aqui: quem chama decide o que fazer com `causa`.
// ─────────────────────────────────────────────────────────────────────────────

import { novoAnthropic } from '../../utils/anthropicClient';
import type { BlocoMidia } from './midia';
import { carimboBR } from './relogio';
import { MOTIVO_HISTORICO_INCOMPLETO, permiteReescrita, pedidoDeReescrita, validarFala, type ParametrosTrava } from './trava';
import {
  lerSaida, schemaSaidaAgente,
  type ContextoLead, type MsgConversa, type PersonaDef, type SaidaAgente,
} from './tipos';

export const MODELO_PRINCIPAL = (process.env.AGENTES5040_MODELO || 'claude-opus-5-5').trim();
export const MODELO_RESERVA = 'claude-sonnet-5-5';

type Esforco = 'low' | 'medium' | 'high';
const ESFORCOS: readonly Esforco[] = ['low', 'medium', 'high'];
const esforco = (): Esforco =>
  ESFORCOS.find(e => e === (process.env.AGENTES5040_ESFORCO || '').trim().toLowerCase()) ?? 'medium';

/** O raciocínio conta neste limite: com pouco, a resposta trunca e o JSON sai inválido. */
const MAX_TOKENS_PRINCIPAL = 16_000;
const MAX_TOKENS_RESERVA = 2_000;
const OPCOES_DA_CHAMADA = { timeout: 60_000, maxRetries: 0 } as const;
const PARADAS_QUE_SAO_FALHA: ReadonlySet<string> = new Set(['refusal', 'max_tokens']);

/** O mínimo que a chamada exige do cliente: o SDK de verdade ou um falso nos testes. */
export interface ClienteIA {
  messages: { create(body: any, opts?: any): Promise<any> };
}

export type CausaIA = 'ia_sem_credito' | 'ia_chave' | 'ia_limite' | 'formato' | 'parada' | 'outro';

/** Cópia própria do classificarFalha (filaAlerta.ts:58), sem a causa da Z-API. */
export function classificarFalhaIA(errMsg: string): CausaIA {
  const e = String(errMsg || '').toLowerCase();
  if (e.includes('credit balance is too low') || e.includes('billing')) return 'ia_sem_credito';
  if (e.includes('authentication_error') || e.includes('x-api-key') || e.includes('invalid api key')
      || e.includes('permission_error') || /\b401\b/.test(e) || /\b403\b/.test(e)) return 'ia_chave';
  if (e.includes('rate_limit') || e.includes('overloaded') || e.includes('too many requests')
      || /\b429\b/.test(e) || /\b529\b/.test(e)) return 'ia_limite';
  return 'outro';
}

export interface UsoIA { entrada: number; cache_criado: number; cache_lido: number; saida: number }
const usoZero = (): UsoIA => ({ entrada: 0, cache_criado: 0, cache_lido: 0, saida: 0 });
function somar(a: UsoIA, b: UsoIA): UsoIA {
  return {
    entrada: a.entrada + b.entrada, cache_criado: a.cache_criado + b.cache_criado,
    cache_lido: a.cache_lido + b.cache_lido, saida: a.saida + b.saida,
  };
}
const usoDe = (r: any): UsoIA => ({
  entrada: Number(r?.usage?.input_tokens) || 0,
  cache_criado: Number(r?.usage?.cache_creation_input_tokens) || 0,
  cache_lido: Number(r?.usage?.cache_read_input_tokens) || 0,
  saida: Number(r?.usage?.output_tokens) || 0,
});

export interface RespostaIA {
  saida: SaidaAgente | null;
  modelo: string;
  stop_reason: string | null;
  uso: UsoIA;
  /** Preenchido quando saida é null (ou quando o principal falhou e a reserva respondeu). */
  causa?: CausaIA;
}

export interface ArgsPerguntar {
  persona: PersonaDef;
  /** Fatos + conversa já montados (ver montarPedido). É a mensagem do usuário. */
  pedido: string;
  midias?: readonly BlocoMidia[];
  /** Padrão: schema da persona (acao como enum). */
  schema?: Record<string, unknown>;
  cliente?: ClienteIA;
  /**
   * Bloco de system EXTRA (as respostas do dono, ver perguntas.ts), depois do bloco fixo e SEM cache_control: o
   * bloco fixo continua com o mesmo prefixo e o cache de 1 hora não quebra. Quem resolve é o turno; este arquivo
   * continua sem ler banco.
   */
  sistemaExtra?: string | null;
}

/** Blocos de conteúdo da mensagem do usuário: a mídia primeiro, o pedido por último. */
function conteudoDoUsuario(pedido: string, midias: readonly BlocoMidia[]): Array<Record<string, unknown>> {
  const blocos: Array<Record<string, unknown>> = [];
  for (const m of midias) {
    if (m.tipo === 'texto') blocos.push({ type: 'text', text: `Mídia da mensagem ${m.msgId}: ${m.texto}` });
    else if (m.tipo === 'imagem') blocos.push({ type: 'image', source: m.source });
    else blocos.push({ type: 'document', source: m.source });
  }
  blocos.push({ type: 'text', text: pedido });
  return blocos;
}

const textoDe = (r: any): string =>
  (Array.isArray(r?.content) ? r.content : []).map((b: any) => (b?.type === 'text' ? b.text : '')).join('');

/**
 * Uma pergunta: o principal e, se ele falhar, a reserva. Nunca lança.
 * `saida: null` com `causa` quando as duas falharam (ou quando a conta/chave está fora).
 */
export async function perguntarAgente(args: ArgsPerguntar): Promise<RespostaIA> {
  const { persona } = args;
  const schema = args.schema ?? schemaSaidaAgente(persona.acoes);
  const system: Array<Record<string, unknown>> = [{ type: 'text', text: persona.sistemaFixo, cache_control: { type: 'ephemeral', ttl: '1h' } }];
  if (args.sistemaExtra && args.sistemaExtra.trim()) system.push({ type: 'text', text: args.sistemaExtra });
  const messages = [{ role: 'user', content: conteudoDoUsuario(args.pedido, args.midias ?? []) }];
  const format = { type: 'json_schema', schema };
  const cliente: ClienteIA = args.cliente ?? (novoAnthropic() as unknown as ClienteIA);

  let uso = usoZero();
  const falha: { causa: CausaIA } = { causa: 'outro' };

  const tentar = async (modelo: string, principal: boolean): Promise<RespostaIA | null> => {
    try {
      const r = await cliente.messages.create({
        model: modelo,
        max_tokens: principal ? MAX_TOKENS_PRINCIPAL : MAX_TOKENS_RESERVA,
        system,
        output_config: principal ? { effort: esforco(), format } : { format },
        messages,
      }, OPCOES_DA_CHAMADA);
      uso = somar(uso, usoDe(r));
      const parada = String(r?.stop_reason ?? '');
      if (PARADAS_QUE_SAO_FALHA.has(parada)) { falha.causa = 'parada'; return null; }
      const lida = lerSaida(textoDe(r), persona.acoes);
      if (!lida.ok) { falha.causa = 'formato'; return null; }
      return { saida: lida.saida, modelo, stop_reason: r?.stop_reason ?? null, uso };
    } catch (e) {
      falha.causa = classificarFalhaIA(String((e as { message?: string })?.message ?? e));
      console.warn('[agentes5040] chamada à IA falhou', modelo, falha.causa);
      return null;
    }
  };

  const primeira = await tentar(MODELO_PRINCIPAL, true);
  if (primeira) return { ...primeira, uso };
  // Mesma conta, mesma chave: a reserva só repetiria o erro.
  if (falha.causa === 'ia_sem_credito' || falha.causa === 'ia_chave') {
    return { saida: null, modelo: MODELO_PRINCIPAL, stop_reason: null, uso, causa: falha.causa };
  }
  const segunda = await tentar(MODELO_RESERVA, false);
  if (segunda) return { ...segunda, uso, causa: undefined };
  return { saida: null, modelo: MODELO_RESERVA, stop_reason: null, uso, causa: falha.causa };
}

// ── o pedido ─────────────────────────────────────────────────────────────────

const MAX_LINHA = 1200;

/** Uma linha da conversa, com data e hora de Brasília: "[18/09 14:32] Cliente: ...". */
function linhaDaConversa(m: MsgConversa): string {
  const quem = m.autor === 'lead' ? 'Cliente' : m.autor === 'equipe' ? 'Equipe (humano)' : 'Nós (robô)';
  const digitado = String(m.texto ?? '').trim();
  const falado = !digitado && m.tipo === 'audio' ? String(m.transcricao ?? '').trim() : '';
  if (falado) return `${carimboBR(m.momment)}${quem} (áudio transcrito): ${falado.slice(0, MAX_LINHA)}`;
  const conteudo = digitado || (m.tipo && m.tipo !== 'texto' && m.tipo !== 'text' ? `[${m.tipo}]` : '');
  return conteudo ? `${carimboBR(m.momment)}${quem}: ${conteudo.slice(0, MAX_LINHA)}` : '';
}

/** O pedido ao modelo: a conversa inteira e depois os fatos da persona. É a mensagem do usuário, nunca o bloco em cache. */
export function montarPedido(persona: PersonaDef, ctx: ContextoLead): string {
  const conversa = ctx.msgs.map(linhaDaConversa).filter(Boolean).join('\n');
  return [
    'Conversa até agora no WhatsApp (mais antiga primeiro):',
    conversa || '(vazia)',
    '',
    'Fatos sobre este lead:',
    persona.fatos(ctx),
    '',
    'Escreva a próxima fala da agente, ou não fale se não souber o contexto.',
  ].join('\n');
}

// ── pensar ───────────────────────────────────────────────────────────────────

export type ParametrosPensar = Omit<ParametrosTrava, 'persona'>;

export type Pensamento =
  | {
      falou: true; saida: SaidaAgente; modelo: string; stop_reason: string | null; uso: UsoIA;
      /** Os motivos da primeira resposta, quando a reescrita passou. */
      reescrita?: string[];
    }
  | { falou: false; motivo: string; causa?: CausaIA; modelo: string; uso: UsoIA };

export interface ArgsPensar {
  persona: PersonaDef;
  pedido: string;
  conv: readonly MsgConversa[];
  trava: ParametrosPensar;
  midias?: readonly BlocoMidia[];
  cliente?: ClienteIA;
  /** Ver ArgsPerguntar.sistemaExtra. Vale nas duas chamadas (a primeira e a reescrita). */
  sistemaExtra?: string | null;
}

/**
 * O miolo da conversa: pergunta, passa a trava e, se barrou, UMA reescrita avisando o motivo.
 * Quebrou de novo = { falou: false, motivo } e nada sai. Falta de contexto não ganha reescrita.
 */
export async function pensar(args: ArgsPensar): Promise<Pensamento> {
  const params: ParametrosTrava = { ...args.trava, persona: args.persona.persona };
  // Histórico incompleto não gasta chamada: a trava já diria não, então nem pergunta ao modelo.
  // (sabe_contexto é uma resposta do modelo e só pode ser conferida depois, em validarFala.)
  if (args.trava.completa !== true) {
    return { falou: false, motivo: MOTIVO_HISTORICO_INCOMPLETO, modelo: MODELO_PRINCIPAL, uso: usoZero() };
  }
  const um = await perguntarAgente({ persona: args.persona, pedido: args.pedido, midias: args.midias, cliente: args.cliente, sistemaExtra: args.sistemaExtra });
  if (!um.saida) {
    return { falou: false, motivo: `a IA não respondeu (${um.causa ?? 'outro'})`, causa: um.causa, modelo: um.modelo, uso: um.uso };
  }
  const motivos = validarFala(um.saida, args.conv, params);
  if (!motivos.length) {
    return { falou: true, saida: um.saida, modelo: um.modelo, stop_reason: um.stop_reason, uso: um.uso };
  }
  if (!permiteReescrita(motivos)) {
    return { falou: false, motivo: motivos.join('; '), modelo: um.modelo, uso: um.uso };
  }
  const dois = await perguntarAgente({
    persona: args.persona,
    pedido: pedidoDeReescrita(args.pedido, motivos, um.saida),
    midias: args.midias, cliente: args.cliente, sistemaExtra: args.sistemaExtra,
  });
  const uso = somar(um.uso, dois.uso);
  if (!dois.saida) {
    return { falou: false, motivo: `${motivos.join('; ')}; a reescrita não veio (${dois.causa ?? 'outro'})`, causa: dois.causa, modelo: dois.modelo, uso };
  }
  const motivos2 = validarFala(dois.saida, args.conv, params);
  if (motivos2.length) {
    return { falou: false, motivo: `${motivos.join('; ')}; na reescrita: ${motivos2.join('; ')}`, modelo: dois.modelo, uso };
  }
  return { falou: true, saida: dois.saida, modelo: dois.modelo, stop_reason: dois.stop_reason, uso, reescrita: motivos };
}
