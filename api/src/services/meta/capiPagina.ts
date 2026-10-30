// ── O SCHEDULE QUE A PÁGINA JÁ CONTOU (29/10/2026) ───────────────────────────
// Pedido do dono: "aponte no meta todos os leads que virarem cards". O Schedule
// treina o conjunto do quiz, e o navegador já dispara um por card que a página
// cria (fbq). O tick `capi_card_novo` manda o Schedule do SERVIDOR para o card que
// a página NÃO contou (o SAIU SEM MARCAR e o da Duda). Para o tick saber qual é
// qual, cada rota que cria card pela página deixa aqui uma linha de dedup:
//   lead_id = ag_<id>, event_name = Schedule, origem = 'pagina'.
// A linha é gravada SEMPRE que o card é de verdade (o que conta é que o navegador
// disparou o fbq), e EM PARALELO com a chamada da API de Conversões, não depois
// dela: por isso ela não leva o resultado do Meta (meta_status 0).
//
// Fora daqui, de propósito (30/10/2026):
//   · registro de teste (nome de teste, ficha de teste, lp_solar_teste): sem linha;
//   · META_TEST_EVENT_CODE ligado: sem linha, para um card real não ser queimado
//     na aba de testes do Meta.
//
// Nunca lança e nunca segura a resposta ao lead mais que TETO_LINHA_MS.

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { normFone } from '../../utils/metaCapi';
import { ehTeste } from './clientesQuentesPuro';

export const ORIGEM_PAGINA = 'pagina';
export const EVENTO_SCHEDULE = 'Schedule';
/** A gravação da linha espera no máximo isto: a resposta ao lead não pode demorar por causa dela. */
export const TETO_LINHA_MS = 800;

/** META_TEST_EVENT_CODE ligado: nenhum dedup é gravado (nem `pagina`, nem `card_novo`). */
export const emModoTesteDoMeta = (): boolean => (process.env.META_TEST_EVENT_CODE || '').trim() !== '';

/**
 * A linha de dedup da página. `telefone_core8` é NOT NULL (erro 23502 em 10/10/2026): sem telefone válido não há linha (null).
 * `meta_status` é 0 (a linha sai em paralelo com a API, antes do resultado). Sem event_id o motivo vai em `meta_error`.
 */
export function linhaDaPagina(a: { cardId: number | string; telefone: unknown; nome?: unknown; semEventId?: boolean }): Record<string, unknown> | null {
  const fone = normFone(a.telefone);
  if (!fone || a.cardId == null || a.cardId === '') return null;
  return {
    lead_id: `ag_${a.cardId}`,
    telefone_core8: fone.slice(-8),
    cliente_nome: a.nome ? String(a.nome).slice(0, 120) : null,
    valor: null,
    origem: ORIGEM_PAGINA,
    event_name: EVENTO_SCHEDULE,
    meta_status: 0,
    ...(a.semEventId ? { meta_error: 'sem_event_id' } : {}),
  };
}

/** Coluna que o banco não conhece: tenta de novo sem `meta_error` (a linha de dedup vale mais que a mensagem). */
const colunaInexistente = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .*does not exist|could not find the .* column/i.test(String(e.message || '')));

async function gravarLinha(linha: Record<string, unknown>, cardId: unknown, onde: string): Promise<void> {
  try {
    const gravar = (l: Record<string, unknown>) =>
      supabaseGerador.from('capi_conversoes_enviadas').upsert(l, { onConflict: 'lead_id,event_name', ignoreDuplicates: true });
    let { error } = await gravar(linha);
    if (error && colunaInexistente(error)) {
      const { meta_error: _omitido, ...semMotivo } = linha;
      ({ error } = await gravar(semMotivo));
    }
    if (error) logger.error(onde, `dedup do Schedule da página (card ${cardId}) não gravou`, error);
  } catch (err) {
    logger.error(onde, `dedup do Schedule da página (card ${cardId}) falhou`, err);
  }
}

/**
 * Grava a linha com teto de TETO_LINHA_MS. Chamar SEM await antes da API de Conversões e esperar a promessa junto com ela
 * (Promise.all): os dois correm ao mesmo tempo. Nunca rejeita.
 */
export async function registrarSchedulePagina(
  a: { cardId: number | string | null | undefined; telefone: unknown; nome?: unknown; semEventId?: boolean; teste?: boolean },
  onde: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (a.cardId == null) return;
    if (a.teste || ehTeste(a.nome) || emModoTesteDoMeta()) return;
    const linha = linhaDaPagina({ ...a, cardId: a.cardId });
    if (!linha) { logger.warn(onde, `Schedule da página do card ${a.cardId}: telefone inválido, linha de dedup não gravada`); return; }
    await Promise.race([
      gravarLinha(linha, a.cardId, onde),
      new Promise<void>(resolve => { timer = setTimeout(() => { logger.warn(onde, `dedup do Schedule da página (card ${a.cardId}) passou de ${TETO_LINHA_MS} ms`); resolve(); }, TETO_LINHA_MS); }),
    ]);
  } catch (err) {
    logger.error(onde, `dedup do Schedule da página (card ${a.cardId}) falhou`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
