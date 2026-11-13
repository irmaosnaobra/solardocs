// ─────────────────────────────────────────────────────────────────────────────
// A HELENA CEDE AOS ROBÔS DE AGENDA (12/11/2026, pedido do anti-ban).
//
// O reagenda automático manda "remarquei" a todo `nao_atendeu` fora do lote com reunião de até 21 dias; o follow-up do não
// atendido e o retorno mandam oferta. Os crons rodam no mesmo minuto da Helena e ela não relia o card antes do claim: a mesma
// pessoa podia receber duas mensagens. Agora, logo ANTES do claim da abertura, ela relê os cards da pessoa e PULA nesta rodada
// (sem tirá-la da fila: ela continua lá e a próxima da fila é a chamada) quando:
//   a) há `nao_atendeu` fora do lote, com reunião nos últimos 21 dias, e `ep_reagenda_auto:<id>` abaixo de 3 voltas;
//   b) há escada aberta do follow-up: `ep_fup_naoatendido:<id>:<passo>` sem o `:lista` E o card ainda é `nao_atendeu`, fora do
//      lote, com reunião dentro de EP_FUP_NAOATENDIDO_DIAS (a mesma consulta do robô: sem isso um r1 solto prenderia a pessoa);
//   c) há retorno recente: `ep_liberado_sim:<id>` de menos de 8 dias.
// Os robôs NÃO mudam (o anti-ban proíbe fazer o reagenda pular a fila). Falha de leitura FECHA: na dúvida, a Helena pula.
// A leitura é EM LOTE (`cedeEmLote`): uma ida ao banco para os candidatos da rodada. Quem cede NÃO gasta os candidatos olhados.
//
// Os prefixos são os dos robôs (EP_REAGENDA_PREFIX, EP_FUP_NAOATENDIDO_PREFIX, EP_LIBERADO_PREFIX); o teste confere cada um
// com o export real, porque importá-los aqui puxaria os módulos de envio dos robôs para dentro da Helena.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehCardSemAvisoAutomatico, ehOrigemEletroposto } from '../agenda/origemEtiqueta';

const LOG = 'investidor-agente-cede';

export const PREFIXO_REAGENDA_AUTO = 'ep_reagenda_auto:';
export const PREFIXO_FUP_NAO_ATENDIDO = 'ep_fup_naoatendido:';
export const PREFIXO_LIBERADO_SIM = 'ep_liberado_sim:';

const DIA_MS = 86_400_000;
export const RETORNO_RECENTE_DIAS = 8;

/** Os mesmos números dos robôs, lidos do ambiente como eles (`Number(env || padrão)`). */
export const janelaDoReagendaDias = (): number => Number(process.env.EP_REAGENDA_JANELA_DIAS || 21);
export const janelaDoFollowupDias = (): number => Number(process.env.EP_FUP_NAOATENDIDO_DIAS || 2);
/** As voltas que o reagenda dá antes de largar o card (EP_REAGENDA_MAX_VOLTAS, 3 por padrão: o mesmo número do robô). */
const maxVoltas = (): number => {
  const n = Number(process.env.EP_REAGENDA_MAX_VOLTAS);
  return Number.isFinite(n) && n > 0 ? n : 3;
};

export type MotivoDeCeder = 'reagenda_com_voltas' | 'escada_do_followup_aberta' | 'retorno_recente' | 'leitura_falhou';

interface CardLido { id: number; status: string | null; quando: string | null; created_by: string | null }
interface Estado { key: string; value: unknown; updated_at: string | null }

/** Puro: a decisão, com os cards e os carimbos já lidos. `null` = a Helena pode chamar. */
export function motivoDeCeder(cards: readonly CardLido[], carimbos: readonly Estado[], agoraMs: number): MotivoDeCeder | null {
  const voltas = new Map<number, number>();
  const comEscada = new Set<number>();
  const comLista = new Set<number>();
  let retornoRecente = false;
  for (const c of carimbos) {
    if (c.key.startsWith(PREFIXO_REAGENDA_AUTO)) {
      const v = (typeof c.value === 'object' && c.value !== null ? c.value : {}) as { n?: unknown };
      voltas.set(Number(c.key.slice(PREFIXO_REAGENDA_AUTO.length)), Number(v.n ?? 0) || 0);
    } else if (c.key.startsWith(PREFIXO_FUP_NAO_ATENDIDO)) {
      const [id, passo] = c.key.slice(PREFIXO_FUP_NAO_ATENDIDO.length).split(':');
      if (passo === 'lista') comLista.add(Number(id)); else if (passo) comEscada.add(Number(id));
    } else if (c.key.startsWith(PREFIXO_LIBERADO_SIM)) {
      const em = Date.parse(String(c.updated_at ?? ''));
      if (Number.isFinite(em) && agoraMs - em < RETORNO_RECENTE_DIAS * DIA_MS) retornoRecente = true;
    }
  }
  for (const c of cards) {
    // Só conta card de eletroposto, não atendido e fora do lote: é o recorte dos dois robôs.
    if (String(c.status ?? '').trim().toLowerCase() !== 'nao_atendeu' || !ehOrigemEletroposto(c.created_by) || ehCardSemAvisoAutomatico(c.created_by)) continue;
    const q = Date.parse(String(c.quando ?? ''));
    if (!Number.isFinite(q) || q > agoraMs) continue;
    // a) o reagenda ainda tem volta (reunião de até 21 dias).
    if (q >= agoraMs - janelaDoReagendaDias() * DIA_MS && (voltas.get(c.id) ?? 0) < maxVoltas()) return 'reagenda_com_voltas';
    // b) a escada do follow-up está de pé (reunião de até 2 dias, sem a queda na lista).
    if (q >= agoraMs - janelaDoFollowupDias() * DIA_MS && comEscada.has(c.id) && !comLista.has(c.id)) return 'escada_do_followup_aberta';
  }
  return retornoRecente ? 'retorno_recente' : null;
}

/** O id do card que o carimbo de um robô guarda na chave. */
const idDoCarimbo = (key: string): number => {
  for (const p of [PREFIXO_REAGENDA_AUTO, PREFIXO_FUP_NAO_ATENDIDO, PREFIXO_LIBERADO_SIM]) if (key.startsWith(p)) return Number(key.slice(p.length).split(':')[0]);
  return NaN;
};

/**
 * Quem, entre os candidatos, está nas mãos de um robô de agenda agora? Relê os cards e os carimbos de TODOS numa ida só (4 consultas)
 * e devolve chave -> motivo, só de quem cede. `ids` são todos os cards do telefone (`cardsConhecidos`). Nunca lança: leitura que
 * falha devolve 'leitura_falhou' para todos (a Helena pula na dúvida).
 */
export async function cedeEmLote(
  candidatos: ReadonlyArray<{ chave: string; ids: readonly number[] }>, agoraMs: number = Date.now(),
): Promise<Map<string, MotivoDeCeder>> {
  const out = new Map<string, MotivoDeCeder>();
  const lista = [...new Set(candidatos.flatMap(c => c.ids))];
  if (!lista.length) return out;
  try {
    const [cards, a, b, c] = await Promise.all([
      supabaseGerador.from('agendamentos').select('id, status, quando, created_by').in('id', lista),
      supabase.from('system_state').select('key, value, updated_at').in('key', lista.map(id => `${PREFIXO_REAGENDA_AUTO}${id}`)),
      supabase.from('system_state').select('key, value, updated_at').or(lista.map(id => `key.like.${PREFIXO_FUP_NAO_ATENDIDO}${id}:%`).join(',')),
      supabase.from('system_state').select('key, value, updated_at').in('key', lista.map(id => `${PREFIXO_LIBERADO_SIM}${id}`)),
    ]);
    const erro = cards.error ?? a.error ?? b.error ?? c.error;
    if (erro) throw new Error(erro.message);
    const todosCards = (cards.data ?? []) as CardLido[];
    const todosCarimbos = [...(a.data ?? []), ...(b.data ?? []), ...(c.data ?? [])] as Estado[];
    for (const cand of candidatos) {
      const meus = new Set(cand.ids);
      const motivo = motivoDeCeder(todosCards.filter(x => meus.has(Number(x.id))), todosCarimbos.filter(x => meus.has(idDoCarimbo(x.key))), agoraMs);
      if (motivo) out.set(cand.chave, motivo);
    }
  } catch (err) {
    logger.error(LOG, 'reler os cards antes do claim falhou: ninguém é chamado nesta rodada', err);
    for (const cand of candidatos) out.set(cand.chave, 'leitura_falhou');
  }
  return out;
}
