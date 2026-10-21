// ─────────────────────────────────────────────────────────────────────────────
// A CHAVE DA FICHA AO CONSULTOR (A4).
//
// UM interruptor só liga duas coisas ao mesmo tempo: a ficha nova (tarefa ficha_5040) e a
// saída antecipada dos 5 avisos antigos. É o que segura "um aviso por lead, nunca zero,
// nunca dois": os dois lados leem a MESMA função, no mesmo instante, e a lista de
// origens que a ficha cobre é a MESMA que o aviso antigo consulta antes de calar.
//
// Arquivo PURO e minúsculo, de propósito: os avisos antigos (leadsMetaService, ioSolar,
// ioEletroposto, manychatLeadService) importam só isto, e nunca o fichaEnvio.ts (que é o
// único arquivo da pasta que importa o zapiClient).
// ─────────────────────────────────────────────────────────────────────────────

import { hmacDe } from './hmac';
import { ligado } from './interruptores';
import { supabase } from '../../utils/supabase';

/** Teto de uma bolha. O texto é cortado antes (ficha.ts) e o fichaEnvio.ts recusa o que passar. */
export const MAX_CARACTERES_FICHA = 1400;

/**
 * O interruptor da ficha (interruptores.ts: env AGENTES5040_FICHA '1' liga e '0' desliga; senão a chave
 * ag5040_interruptores do system_state; ausente ou erro de leitura = DESLIGADO, com cache de 60 s).
 *
 * Sem segredo de HMAC a ficha não consegue reservar (a chave de reserva do lead é um HMAC), então o
 * interruptor ligado sem segredo seria o pior caso: os avisos antigos calados e a ficha parada, ou
 * seja, ZERO avisos. Por isso sem segredo vale como desligado. E leitura que falha vale como desligado:
 * os avisos antigos seguem normais.
 */
export async function fichaConsultorLigada(): Promise<boolean> {
  if (!(await ligado('ficha'))) return false;
  return hmacDe('ficha-5040') !== null;
}

/**
 * As origens (agendamentos.created_by) cujo aviso antigo a ficha SUBSTITUI: exatamente as
 * dos cinco avisos retirados. Fora daqui, a ficha não nasce e o aviso antigo segue como
 * sempre:
 *  - lead-meta .......... leadsMetaService.avisarConsultor
 *  - lp_solar ........... ioSolar /alerta e o aviso do quiz ao dono
 *  - lp_eletroposto ..... ioEletroposto /alerta
 *  - manychat ........... manychatLeadService.avisarSolar
 *  - manychat_eletroposto  manychatLeadService.avisarEletroposto
 * Ficam de fora de propósito: cadastro_eletroposto (lote), card manual e agente_eletroposto
 * (a Helena já avisa com o recado "passou para você", que não é desta peça).
 */
export const ORIGENS_COM_FICHA: readonly string[] = Object.freeze([
  'lead-meta', 'lp_solar', 'manychat', 'lp_eletroposto', 'manychat_eletroposto',
]);

export interface CardParaFicha { id?: number | null; created_by?: string | null; status?: string | null }

/** A marca que o aviso antigo deixa quando ENVIA de verdade: a ficha pula este card (um aviso só por lead). Só o id. */
export const chaveAvisoAntigo = (cardId: number | string): string => `aviso_antigo:${cardId}`;

/** A ficha cobre este card? (origem permitida e não cancelado.) */
export function fichaCobre(card: CardParaFicha): boolean {
  const origem = String(card.created_by ?? '').trim();
  if (!ORIGENS_COM_FICHA.includes(origem)) return false;
  return String(card.status ?? '').trim().toLowerCase() !== 'cancelado';
}

/** Grava a marca `aviso_antigo:<id>`. Melhor esforço: erro aqui nunca impede o aviso (zero aviso é pior que dois). */
async function marcarAvisoAntigo(cardId: number | null | undefined): Promise<void> {
  const id = Number(cardId);
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    await supabase.from('system_state').insert({ key: chaveAvisoAntigo(id), value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() });
  } catch { /* melhor esforço */ }
}

/**
 * A pergunta que os 5 avisos antigos fazem antes de enviar. true = a ficha cuida deste card, o aviso antigo
 * SAI CEDO. false = o aviso antigo vai enviar: antes disso ele grava a marca `aviso_antigo:<id>` e a ficha
 * pula o card. É a marca POR CARD (e não um horário) que impede dois avisos na virada do interruptor e no
 * cache de 60 s. Leitura do interruptor com erro = desligado = o aviso antigo envia (nunca zero).
 */
export async function fichaSubstituiAviso(card: CardParaFicha): Promise<boolean> {
  if (fichaCobre(card) && (await fichaConsultorLigada())) return true;
  await marcarAvisoAntigo(card.id);
  return false;
}
