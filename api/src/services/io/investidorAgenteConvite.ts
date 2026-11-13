// ─────────────────────────────────────────────────────────────────────────────
// A RETOMADA DO CONVITE, A PASSAGEM POR SILÊNCIO E A EQUIPE QUE ASSUMIU (13/11/2026). PURO.
//
// Recebe a sessão e a conversa já lidas e devolve a decisão. Nada aqui lê banco nem envia (o envio, os portões e o claim
// moram em investidorAgente.ts; o aviso à equipe, em investidorAgenteAvisosEquipe.ts). Parecer do chefe anti-ban: NÃO BLOQUEIA
// com as condições do plano, que valem acima de qualquer outra regra daqui.
//
//   1. Retomada do convite (toque `c1`, UM por pessoa para sempre): quem conversou, recebeu o convite (ou os horários) e
//      parou de responder. 24 h depois da última fala da Helena, sem NENHUMA mensagem depois dela (cliente, outro robô,
//      equipe), ela volta UMA vez com 2 horários livres do consultor dono do card.
//   2. Passagem por silêncio: 48 h depois dessa retomada, sem ninguém escrever, a sessão vai para `humano` e o consultor
//      recebe a ficha. Nada sai para o cliente.
//   3. Equipe assumiu: mensagem `from_me` com `from_api` diferente de `true` depois da abertura é gente digitando no
//      celular da linha. A Helena sai da conversa.
// ─────────────────────────────────────────────────────────────────────────────

import { hashDaChave, horarioNaFrase, primeiroNomeDoConsultor } from './investidorAgentePuro';
import { ESTAGIOS_ATIVOS } from './investidorAgentePosse';
import type { TipoHelena } from './investidorAgenteTextos';

const HORA_MS = 3_600_000;
/** A retomada só sai 24 h depois da última fala da Helena. */
export const CONVITE_APOS_MS = 24 * HORA_MS;
/** A passagem por silêncio só vale 48 h depois da retomada. */
export const SILENCIO_APOS_MS = 48 * HORA_MS;
/** Mensagem a até esta distância do carimbo é a própria (o carimbo é gravado antes do envio): não é conversa nova. */
export const MARGEM_DO_CONVITE_MS = 5 * 60_000;
/** Reserva (vale junto com o carimbo): a sessão é gravada ANTES de a mensagem sair, e a última fala dela fica nesta distância do `atualizado_em`. */
export const TOLERANCIA_DA_FALA_MS = 15 * 60_000;
/** A fala dela fica a até 2 min de um carimbo dela (`inv_agente_env`, `inv_agente_frio`, `inv_agente_sent`): a prova de que é da Helena. */
export const TOLERANCIA_DO_CARIMBO_MS = 2 * 60_000;
/** Listas de horário por pessoa (o mesmo teto de investidorAgente.ts). A retomada conta como uma. */
export const OFERTAS_ATE_O_CONVITE = 3;

export const MOTIVO_SILENCIO = 'silencio_depois_do_convite';
export const MOTIVO_EQUIPE_ASSUMIU = 'equipe_assumiu';

export interface SessaoDoConvite {
  estagio: string;
  telefone: string;
  aberto_em: string;
  atualizado_em?: string;
  grupo?: string;
  sem_retomada?: boolean;
  erro?: string | null;
  ciclo_encerrado?: string;
  respostas?: number;
  convidou_em?: string;
  ofertas_feitas?: number;
  convite_retomado_em?: string;
}

/** O que as regras precisam de cada mensagem da conversa. */
export interface MsgDaLinha { from_me: boolean | null; from_api?: boolean | null; tipo?: string | null; momment: string }

const ms = (iso: unknown): number => Date.parse(String(iso ?? ''));

/**
 * Reação e aviso do sistema não são conversa (a mesma regra da Caixa, `contaComoConversa` de gerador/caixaWhatsapp.ts: copiada aqui para
 * esta regra pura não puxar o banco; o teste confere que as duas concordam). Não tiram a Helena da conversa nem seguram a retomada.
 */
export const contaComoConversa = (tipo: string | null | undefined): boolean => tipo !== 'reacao' && tipo !== 'notificacao';

const ordenada = (conversa: readonly MsgDaLinha[]): MsgDaLinha[] =>
  conversa.filter(m => contaComoConversa(m.tipo) && Number.isFinite(ms(m.momment))).sort((a, b) => ms(a.momment) - ms(b.momment));

/**
 * A mensagem é a fala DELA? Automação (`from_me` com `from_api` verdadeiro) a até 2 min de um carimbo dela para essa chave
 * (`inv_agente_env:<chave>:<ms>`, `inv_agente_frio:`, `inv_agente_sent:<chave>:tN` ou `:c1`) OU ao `atualizado_em` / `convidou_em` da sessão a até
 * 15 min (a sessão é gravada antes de cada fala). Um critério não exclui o outro: a sessão antiga tem o `t1` da abertura, mas não tem
 * `inv_agente_env` (só existe desde 12/11), e a última fala dela casa só com o `atualizado_em`.
 */
export function ehFalaDela(
  m: MsgDaLinha, s: Pick<SessaoDoConvite, 'atualizado_em' | 'convidou_em'>, carimbosMs: readonly number[],
): boolean {
  if (m.from_me !== true || m.from_api !== true) return false;
  const t = ms(m.momment);
  if (!Number.isFinite(t)) return false;
  if (carimbosMs.some(c => Number.isFinite(c) && Math.abs(t - c) <= TOLERANCIA_DO_CARIMBO_MS)) return true;
  return [ms(s.atualizado_em), ms(s.convidou_em)].some(marcador => Number.isFinite(marcador) && Math.abs(t - marcador) <= TOLERANCIA_DA_FALA_MS);
}

// ── 1) Quem entra na retomada do convite ─────────────────────────────────────

/**
 * A sessão entra na fila da retomada do convite? Só a fila principal (sem `grupo`, `sem_retomada`, `erro`, `ciclo_encerrado`,
 * com telefone), em `conversando` com resposta da Helena E convite registrado, ou em `ofertou`; com menos de 3 listas; e que
 * ainda não recebeu a retomada (uma por pessoa).
 */
export function sessaoEntraNoConvite(s: SessaoDoConvite): boolean {
  if (s.grupo || s.sem_retomada || s.erro || s.ciclo_encerrado || !s.telefone) return false;
  if (s.convite_retomado_em) return false;
  if (Number(s.ofertas_feitas ?? 0) >= OFERTAS_ATE_O_CONVITE) return false;
  if (s.estagio === 'ofertou') return true;
  return s.estagio === 'conversando' && Number(s.respostas ?? 0) > 0 && !!s.convidou_em;
}

export type MotivoDoConvite =
  | 'sem_conversa' | 'cliente_depois' | 'equipe_depois' | 'outra_fala_depois' | 'menos_de_24h';

export type DecisaoDoConvite = { ok: true; ultimaDelaEm: string } | { ok: false; motivo: MotivoDoConvite };

/**
 * Passaram 24 h da última fala da Helena e NINGUÉM falou depois dela? A última mensagem da conversa (sem reação nem aviso do sistema)
 * tem que ser dela (`ehFalaDela`). Cliente depois, equipe depois, outro robô depois ou conversa vazia seguram.
 */
export function avaliarConvite(
  s: Pick<SessaoDoConvite, 'atualizado_em' | 'convidou_em'>, conversa: readonly MsgDaLinha[], agoraMs: number, carimbosMs: readonly number[] = [],
): DecisaoDoConvite {
  const msgs = ordenada(conversa);
  const ultima = msgs[msgs.length - 1];
  if (!ultima) return { ok: false, motivo: 'sem_conversa' };
  if (!ultima.from_me) return { ok: false, motivo: 'cliente_depois' };
  if (ultima.from_api !== true) return { ok: false, motivo: 'equipe_depois' };
  if (!ehFalaDela(ultima, s, carimbosMs)) return { ok: false, motivo: 'outra_fala_depois' };
  const t = ms(ultima.momment);
  if (agoraMs - t < CONVITE_APOS_MS) return { ok: false, motivo: 'menos_de_24h' };
  return { ok: true, ultimaDelaEm: new Date(t).toISOString() };
}

// ── 3) A equipe assumiu ──────────────────────────────────────────────────────

/** A sessão é da Helena (ainda ativa)? Só nela a equipe "assume": o resto já tem outro dono. */
export const sessaoEmConversaDaHelena = (estagio: unknown): boolean =>
  ESTAGIOS_ATIVOS.includes(estagio as typeof ESTAGIOS_ATIVOS[number]);

/**
 * Alguém da equipe escreveu pelo celular da linha depois da abertura? É `from_me` com `from_api` diferente de `true` (é assim
 * que a Caixa reconhece gente). Mensagem de OUTRO robô (`from_api` verdadeiro), reação e aviso do sistema não são "assumiu".
 */
export function equipeAssumiu(conversa: readonly MsgDaLinha[], abertoEm: unknown): boolean {
  const aberto = ms(abertoEm);
  if (!Number.isFinite(aberto)) return false;
  return conversa.some(m => contaComoConversa(m.tipo) && m.from_me === true && m.from_api !== true && ms(m.momment) > aberto);
}

// ── 2) A passagem por silêncio ───────────────────────────────────────────────

export type DecisaoDoSilencio =
  | 'passar' | 'cedo' | 'conversa_nova' | 'sem_retomada' | 'fora_da_helena' | 'sem_envio_real' | 'sem_conversa';

/** Pré-filtro (sem ler conversa): a retomada tem 48 h ou mais e a sessão segue ativa (a última fala dela é igual ou mais nova que a retomada). */
export function silencioVencido(s: Pick<SessaoDoConvite, 'estagio' | 'convite_retomado_em'>, agoraMs: number): boolean {
  const t = ms(s.convite_retomado_em);
  return Number.isFinite(t) && sessaoEmConversaDaHelena(s.estagio) && agoraMs - t >= SILENCIO_APOS_MS;
}

/**
 * Passa para a equipe? As 48 h contam da ÚLTIMA fala dela depois da retomada (não da retomada): se o cliente respondeu e a Helena
 * respondeu de volta, o relógio recomeça nessa fala. Precisa de ENVIO REAL: o carimbo `c1` existe (`temC1`) e a última mensagem da
 * conversa é uma fala dela (`ehFalaDela`) feita desde a retomada (a própria retomada sai segundos depois do carimbo da sessão).
 * Cliente, outro robô ou equipe falando por último seguram.
 */
export function silencioDepoisDoConvite(
  s: Pick<SessaoDoConvite, 'estagio' | 'convite_retomado_em' | 'atualizado_em' | 'convidou_em'>,
  conversa: readonly MsgDaLinha[], agoraMs: number, carimbosMs: readonly number[] = [], temC1 = true,
): DecisaoDoSilencio {
  const retomada = ms(s.convite_retomado_em);
  if (!Number.isFinite(retomada)) return 'sem_retomada';
  if (!sessaoEmConversaDaHelena(s.estagio)) return 'fora_da_helena';
  if (agoraMs - retomada < SILENCIO_APOS_MS) return 'cedo';
  const msgs = ordenada(conversa);
  const ultima = msgs[msgs.length - 1];
  if (!ultima) return 'sem_conversa';
  if (!ehFalaDela(ultima, s, carimbosMs)) return 'conversa_nova';
  if (!temC1 || ms(ultima.momment) < retomada - MARGEM_DO_CONVITE_MS) return 'sem_envio_real';
  return agoraMs - ms(ultima.momment) >= SILENCIO_APOS_MS ? 'passar' : 'cedo';
}

// ── Os textos fixos ──────────────────────────────────────────────────────────
// Regra: nada de artigo antes de {consultor} e nenhum pronome com gênero para consultor ou cliente.

const CONVITES: readonly { variante: 'A' | 'B' | 'C'; molde: string }[] = [
  { variante: 'A', molde: 'Oi, aqui é a Helena de novo. Te falei da reunião com {consultor}. Tenho {horario1} ou {horario2} livres. Algum dos dois te serve?' },
  { variante: 'B', molde: 'Oi, tudo bem? Helena aqui. Ainda dá para a gente marcar a conversa com {consultor}? Tenho {horario1} ou {horario2}. Se não encaixar, me diz um período melhor.' },
  { variante: 'C', molde: 'Helena de novo. Sei que o dia corre, então vou direto: tenho {horario1} e {horario2} para você conversar com {consultor}. Algum desses cabe na sua agenda?' },
];

/** O texto da retomada: 1A, 1B ou 1C, escolhido de forma estável pela chave da pessoa. */
export function textoDoConvite(chave: string, consultor: unknown, iso1: string, iso2: string): { variante: 'A' | 'B' | 'C'; texto: string } {
  const v = CONVITES[hashDaChave(chave) % CONVITES.length]!;
  const quem = primeiroNomeDoConsultor(consultor) || 'nossa equipe';
  const texto = v.molde
    .split('{consultor}').join(quem)
    .split('{horario1}').join(horarioNaFrase(iso1))
    .split('{horario2}').join(horarioNaFrase(iso2));
  return { variante: v.variante, texto };
}

/** A linha que vai no topo da ficha de quem passou por silêncio. */
export const TEXTO_DO_SILENCIO = 'Sem resposta ao convite nem à retomada da Helena. Vale uma ligação.';

const ROTULO_DO_TIPO: Readonly<Record<TipoHelena, string>> = {
  investidor: 'Investidor', arrendamento: 'Arrendamento', parceiro: 'Parceiro', curioso: 'Curioso',
};

/** O aviso de que a equipe assumiu. Nome vazio vira "a pessoa". */
export function textoEquipeAssumiu(i: { consultor: unknown; nome: unknown; tipo: TipoHelena }): string {
  const consultor = primeiroNomeDoConsultor(i.consultor) || 'Oi';
  const nome = String(i.nome ?? '').replace(/\s+/g, ' ').trim() || 'a pessoa';
  return `*HELENA SAIU DA CONVERSA*\n${consultor}, alguém da equipe escreveu para ${nome} (${ROTULO_DO_TIPO[i.tipo]}) pela linha e a Helena parou de responder. A conversa está na Caixa da 5040.`;
}
