// ─────────────────────────────────────────────────────────────────────────────
// O CÓDIGO DO BOTÃO DO QUIZ SOLAR (03/11/2026). O cliente digita um número no quiz e escreve do WhatsApp de OUTRO número com o texto
// fixo do botão ("Oi! Acabei de preencher a simulação de energia solar"), sem nada que ligue a fala ao card (card 1714: o quiz foi com o
// DDD 11, a fala veio do DDD 34). Agora o card ganha um código curto e aleatório, que a página põe no fim do texto do botão
// ("... Código: K7M2P"). O religarQuiz.ts usa o código para religar o card ao número de quem escreveu.
//
// O que fica no banco: system_state `quizsolar_codigo:<CÓDIGO>` com { card_id, criado_em }. NUNCA telefone, NUNCA o id do card nem o
// quiz_<DDD+8> como código. Vale 2 h. Este módulo só fala com o supabase (nada de envio, nada de zapiClient).
// ─────────────────────────────────────────────────────────────────────────────

import { randomInt } from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

const LOG = 'quiz-solar-codigo';

export const PREFIXO_CODIGO = 'quizsolar_codigo:';
export const PREFIXO_RELIGADO = 'quizsolar_religado:';
export const VALIDADE_CODIGO_MS = 2 * 3_600_000;
export const TAMANHO_CODIGO = 5;
/** Sem 0/O e sem 1/I/L: o que o cliente lê na tela e o que digita não se confundem. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 5 caracteres do alfabeto, sorteados com crypto.randomInt. */
export function gerarCodigoQuiz(): string {
  let c = '';
  for (let i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  return c;
}

/** O código está no formato (5 caracteres, todos do alfabeto, maiúsculos)? */
export const codigoValido = (c: unknown): c is string =>
  typeof c === 'string' && c.length === TAMANHO_CODIGO && [...c].every(ch => ALFABETO_CODIGO.includes(ch));

/** O código de uma fala ("... Código: K7M2P"), em maiúsculas, ou null. Aceita "codigo" sem acento e qualquer caixa. */
export function codigoDoTexto(texto: unknown): string | null {
  const m = /c[oó]digo\s*:\s*([a-z0-9]{5})(?![a-z0-9])/i.exec(String(texto ?? ''));
  if (!m) return null;
  const c = m[1]!.toUpperCase();
  return codigoValido(c) ? c : null;
}

/**
 * Grava `quizsolar_codigo:<CÓDIGO>` para o card (INSERT: no 23505 sorteia outro, nunca sobrescreve o código vivo de outro card) e devolve o
 * código. Nunca lança: qualquer falha devolve null, e a rota segue sem código (o botão sai como sempre).
 */
export async function gravarCodigoDoCard(cardId: number, agora: number = Date.now()): Promise<string | null> {
  try {
    if (!Number.isInteger(cardId) || cardId <= 0) return null;
    const em = new Date(agora).toISOString();
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = gerarCodigoQuiz();
      const { error } = await supabase.from('system_state').insert({
        key: `${PREFIXO_CODIGO}${codigo}`, value: { card_id: cardId, criado_em: em }, updated_at: em,
      });
      if (!error) return codigo;
      if ((error as { code?: string }).code !== '23505') { logger.warn(LOG, `não gravei o código do card ${cardId}`, error); return null; }
    }
    return null;
  } catch (err) {
    logger.warn(LOG, `gravar o código do card ${cardId} lançou`, err);
    return null;
  }
}
