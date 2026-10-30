// ── CAPI CARD NOVO: A PARTE PURA (29/10/2026) ────────────────────────────────
// Pedido do dono: "aponte no meta todos os leads que virarem cards e meta entenda
// qual nosso publico e encontre". O conjunto do quiz otimiza SCHEDULE no pixel solar,
// e o navegador só conta o card que a PÁGINA cria. Os outros dois caminhos do quiz
// até a agenda nascem sem navegador:
//   · o card SAIU SEM MARCAR (criado pelo tick solar_quiz_avisos);
//   · o card da Duda (marcar_horario / ligar_agora, na conversa do WhatsApp).
// Este arquivo só decide: QUEM recebe um Schedule do servidor e COMO o evento é
// montado. Nada de banco nem de rede, para o teste chegar sem mock.
//
// Ordem de prioridade do desenho: primeiro nunca contar duas vezes (o conjunto
// aprende com cada Schedule), depois contar tudo que for verdade.
//
// LIMITE CONHECIDO, PARTE DO DESENHO: se a pessoa volta à página DEPOIS de o Schedule do card SAIU ter sido enviado (a espera é de 60 min) e
// marca horário, são DOIS Schedules para a mesma pessoa: o do SAIU (servidor) e o do card novo (página). A dedup por telefone em 30 dias só
// impede o contrário (o servidor repetir uma pessoa que a página já contou). Aceito: o 2º é um agendamento de verdade.

import { normFone, type EventoMeta, type PessoaMeta } from '../../utils/metaCapi';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { ehCardSaiu, ehCardDaDuda } from '../agenda/solarRota';
import { ehTeste } from './clientesQuentesPuro';
import { lerCapi, navegadorDoCapi, URL_QUIZ_SOLAR, type DadosCapi } from './capiNavegador';

/** Quem cria card para uma pessoa do quiz sem a página: o tick do SAIU e a Duda gravam `lp_solar`. A LP do eletroposto só nasce pela página. */
export const ORIGENS_ROBO: readonly string[] = ['lp_solar'];
/** A pessoa pode voltar à página e marcar sozinha: o card SAIU 1716 foi cancelado quando o 1717 nasceu. Antes disto o card não é enviado. */
export const ESPERA_MS = 60 * 60_000;
/** O Meta recusa o LOTE inteiro se um evento tem mais de 7 dias. Cada evento sai sozinho e o card não passa de 6 dias. */
export const IDADE_MAX_MS = 6 * 86_400_000;
/** Quem já teve um Schedule (de qualquer card, de qualquer origem) nos últimos 30 dias não recebe outro. */
export const DEDUP_FONE_MS = 30 * 86_400_000;
export const TETO_ENVIOS = 10;
/** Teto DURO da rodada: 12 s. Um envio só começa com pelo menos MIN_RESTANTE_MS de sobra (o envio tem 6 s de timeout próprio). */
export const ORCAMENTO_MS = 12_000;
export const MIN_RESTANTE_MS = 6_000;
/** Cada leitura espera no máximo isto; estourou, a rodada é abortada sem enviar nada. */
export const TETO_LEITURA_MS = 3_000;
export const FORM_QUIZ_SOLAR = 'quiz_solar';

export interface CardCand {
  id: number;
  cliente_nome?: string | null;
  cliente_telefone?: string | null;
  cidade?: string | null;
  status?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  observacao?: string | null;
}
export interface LeadQuiz {
  lead_id?: string | null;
  form_id?: string | null;
  nome?: string | null;
  whatsapp?: string | null;
  cidade?: string | null;
  field_data?: unknown;
  created_time?: string | null;
  agendado_id?: number | null;
}

export type ClasseDoCard = 'saiu' | 'duda';
export interface Envio {
  card: CardCand;
  lead: LeadQuiz;
  classe: ClasseDoCard;
  /** Telefone do lead como a página mandou (55 + DDD + 9 + 8): é dele que sai o external_id. */
  foneLead: string;
  /** Últimos 8 dígitos, a chave da dedup por pessoa. */
  core8: string;
}
export interface Selecao {
  enviar: Envio[];
  /** Quantos cards cada regra deixou de fora (para o relatório e para o teste). */
  ignorados: Record<string, number>;
}

/** Os dois formatos do mesmo celular: com e sem o 9 depois do DDD, sempre com o 55. */
export function variantesDoFone(tel: unknown): string[] {
  const f = normFone(tel);
  if (!f) return [];
  const ddd = f.slice(2, 4), resto = f.slice(4);
  const out = new Set<string>([f]);
  if (resto.length === 9 && resto[0] === '9') out.add(`55${ddd}${resto.slice(1)}`);
  else if (resto.length === 8) out.add(`55${ddd}9${resto}`);
  return [...out];
}

/** DDD + 8 últimos dígitos (a chave do lead `quiz_<chave>`). Mesma conta do telKeySolar, sem puxar o banco junto. */
export function chaveDoQuiz(tel: unknown): string | null {
  const d = String(tel ?? '').replace(/\D/g, '').replace(/^55/, '');
  return d.length < 10 ? null : d.slice(0, 2) + d.slice(-8);
}
export const leadIdDoQuiz = (tel: unknown): string | null => { const k = chaveDoQuiz(tel); return k ? `quiz_${k}` : null; };

const ms = (iso: unknown): number => Date.parse(String(iso ?? ''));
const core8De = (tel: unknown): string | null => { const f = normFone(tel); return f ? f.slice(-8) : null; };

/**
 * Quem já foi contado pela PÁGINA antes do deploy da linha `pagina` (30/10/2026): um card `lp_solar` dos últimos 30 dias sem a marca SAIU e sem
 * a da Duda nasceu da página, que disparou o fbq, mas não deixou linha de dedup. Devolve o core8 dessas pessoas. Card de teste não conta.
 */
export function core8DeCardsDaPagina(cards: CardCand[]): Set<string> {
  const out = new Set<string>();
  for (const c of cards) {
    if (!ORIGENS_ROBO.includes(String(c.created_by ?? '').trim())) continue;
    if (ehCardSaiu(c.observacao) || ehCardDaDuda(c.observacao) || ehTeste(c.cliente_nome)) continue;
    const k = core8De(c.cliente_telefone);
    if (k) out.add(k);
  }
  return out;
}

/** Os cards que a leitura deve trazer, só pela data: [piso, teto]. O resto da regra mora em escolherCardsNovos. */
export function janelaDosCards(agoraMs: number, corteMs: number): { deMs: number; ateMs: number } {
  return { deMs: Math.max(corteMs, agoraMs - IDADE_MAX_MS), ateMs: agoraMs - ESPERA_MS };
}

/**
 * Quais cards recebem Schedule agora. Cada recusa tem nome (em `ignorados`), porque "nada saiu" sem motivo é a pior resposta de um
 * tick de Meta. A ordem das regras é a ordem do relatório.
 */
export function escolherCardsNovos(a: {
  agoraMs: number;
  /** `capi_card_novo_desde`: card criado antes desta marca nunca é enviado. */
  corteMs: number;
  cards: CardCand[];
  leads: LeadQuiz[];
  /** ids de card que já têm linha Schedule (qualquer origem). */
  cardsComSchedule: ReadonlySet<number>;
  /** core8 de quem já teve Schedule nos últimos 30 dias (qualquer card, qualquer origem). */
  fonesComSchedule: ReadonlySet<string>;
  /** core8 de quem tem card `lp_solar` sem marca SAIU nem Duda nos últimos 30 dias (core8DeCardsDaPagina): a página já o contou. */
  fonesDePaginaAntiga?: ReadonlySet<string>;
  teto?: number;
}): Selecao {
  const ig: Record<string, number> = {};
  const nao = (motivo: string) => { ig[motivo] = (ig[motivo] || 0) + 1; };
  const { deMs, ateMs } = janelaDosCards(a.agoraMs, a.corteMs);
  const teto = a.teto ?? TETO_ENVIOS;
  const fones = new Set(a.fonesComSchedule);
  const paginaAntiga = a.fonesDePaginaAntiga ?? new Set<string>();
  const out: Envio[] = [];

  for (const c of [...a.cards].sort((x, y) => ms(x.created_at) - ms(y.created_at) || x.id - y.id)) {
    const criado = ms(c.created_at);
    if (!ORIGENS_ROBO.includes(String(c.created_by ?? '').trim())) { nao('origem'); continue; }
    if (!Number.isFinite(criado) || criado < deMs) { nao('antes_da_janela'); continue; }
    if (criado > ateMs) { nao('espera_de_60min'); continue; }
    if (String(c.status ?? '').trim().toLowerCase() === 'cancelado') { nao('cancelado'); continue; }
    if (ehTeste(c.cliente_nome)) { nao('teste'); continue; }
    const classe: ClasseDoCard | null = ehCardSaiu(c.observacao) ? 'saiu' : ehCardDaDuda(c.observacao) ? 'duda' : null;
    // Sem as duas marcas não dá para saber se a página contou: um card da página sem a linha de dedup viraria Schedule em dobro.
    if (!classe) { nao('sem_marca_saiu_nem_duda'); continue; }
    if (a.cardsComSchedule.has(c.id)) { nao('card_ja_tem_schedule'); continue; }
    const core8 = core8De(c.cliente_telefone);
    if (!core8) { nao('telefone_invalido'); continue; }

    const idQuiz = leadIdDoQuiz(c.cliente_telefone);
    const lead = a.leads.find(l => {
      if (String(l.form_id ?? FORM_QUIZ_SOLAR) !== FORM_QUIZ_SOLAR) return false;
      if (Number(l.agendado_id) === c.id) return true;   // o lead já aponta para este card: vínculo direto, sem conta de data
      // O lead do mesmo telefone vale sem janela de data: a frescura do fbc e do _capi é de capiNavegador (fbc de 7 dias ou mais cai).
      return !!idQuiz && l.lead_id === idQuiz;
    });
    const foneLead = lead ? normFone(lead.whatsapp) : null;
    if (!lead || !foneLead) { nao(lead ? 'lead_sem_telefone' : 'sem_lead_do_quiz'); continue; }

    const chaves = [core8, foneLead.slice(-8)];
    if (chaves.some(k => fones.has(k))) { nao('fone_ja_teve_schedule_em_30d'); continue; }
    if (chaves.some(k => paginaAntiga.has(k))) { nao('pagina_ja_contou_antes_do_deploy'); continue; }
    if (out.length >= teto) { nao('teto_da_rodada'); continue; }
    chaves.forEach(k => fones.add(k));   // dois cards da mesma pessoa na mesma rodada: só o mais antigo
    out.push({ card: c, lead, classe, foneLead, core8 });
  }
  return { enviar: out, ignorados: ig };
}

/**
 * action_source de cada classe (decisão do dono, 29/10/2026; a regra do Meta é que ele diga a verdade):
 *  · SAIU com `_capi` e navegador: `website` (o lead foi enviado pelo site), com event_source_url;
 *  · SAIU sem `_capi`: `system_generated`;
 *  · card da Duda: SEMPRE `chat`, mesmo com `_capi` (fbc, fbp, IP e navegador entram só para casar a pessoa).
 */
export function origemDoEvento(classe: ClasseDoCard, capi: DadosCapi | null): EventoMeta['origem'] {
  if (classe === 'duda') return 'chat';
  return capi?.client_user_agent ? 'website' : 'system_generated';
}

/** O evento Schedule do servidor para um card. `eventTime` é o created_at do card (UTC real em `agendamentos`). */
export function montarEventoCardNovo(e: Envio, agoraMs: number): EventoMeta {
  const capi = lerCapi(e.lead.field_data);
  const origem = origemDoEvento(e.classe, capi);
  const pessoa: PessoaMeta = {
    // O external_id sai SÓ deste telefone: o do lead, exatamente como a página o calculou. O `ph` leva as duas formas dos dois números.
    telefone: e.foneLead,
    telefonesExtras: [...variantesDoFone(e.foneLead), ...variantesDoFone(e.card.cliente_telefone)],
    nome: e.card.cliente_nome || e.lead.nome,
    cidade: e.card.cidade || e.lead.cidade,
  };
  return {
    produto: ehOrigemEletroposto(e.card.created_by) ? 'eletroposto' : 'solar',
    nome: 'Schedule',
    eventId: `card_ag_${e.card.id}`,
    eventTime: Math.floor(ms(e.card.created_at) / 1000),
    origem,
    pessoa,
    navegador: navegadorDoCapi(capi, agoraMs),
    ...(origem === 'website' ? { urlDaPagina: capi?.event_source_url || URL_QUIZ_SOLAR } : {}),
  };
}

/** Recusa que nunca vai mudar de resposta: grava a marca para não tentar até o card envelhecer. */
export const recusaDefinitiva = (r: { ok: boolean; status: number; erro?: string }): boolean =>
  !r.ok && ((r.status === 400 && /2804036/.test(String(r.erro ?? ''))) || r.erro === 'sem_identificador');
