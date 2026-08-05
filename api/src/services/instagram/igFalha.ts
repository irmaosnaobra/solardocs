// ─────────────────────────────────────────────────────────────────────────────
// Classificação do erro que a Meta devolve num envio de DM do Instagram.
//
// Por que isto existe (05/08/2026): o lead @saulo_baboo comentou UMA vez e
// recebeu a MESMA mensagem DUAS vezes, e ainda levou um "me chama no direct"
// público embaixo do comentário. Na fila constava UMA linha, com status
// 'failed'. O que aconteceu:
//
//   1) POST /messages devolveu 500 {"code":1,"message":"An unknown error…"};
//   2) o motor tratava QUALQUER erro como "o botão foi recusado" e reenviava o
//      mesmo texto sem quick reply;
//   3) o reenvio devolveu 500 de novo — e as DUAS mensagens chegaram no celular
//      da pessoa. O 500 da Meta aqui é mentira: ela cria a mensagem e devolve
//      erro assim mesmo.
//
// Ou seja: 500 + code 1 NÃO é prova de que a mensagem não saiu. É INCERTO. E
// com envio incerto a única atitude honesta é não reenviar e não anunciar nada
// em público — silêncio erra menos que as duas alternativas.
//
// O reenvio sem botão continua existindo, mas só quando a Meta reclama do botão
// com todas as letras (a mensagem cita quick_replies). Nos 7 erros code 1
// registrados desde 25/07 — quatro deles ANTES de o porteiro existir, quando
// nenhum envio levava botão — ela nunca citou.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `incerto`   — pode ter saído (5xx / code 1 / code 2). Não reenvia, não comenta.
 * `sem_botao` — a Meta recusou o quick reply: vale reenviar o texto puro.
 * `fatal`     — não saiu mesmo (janela fechada, usuário inexistente, permissão).
 */
export type TipoFalha = 'incerto' | 'sem_botao' | 'fatal';

/** HTTP status do erro que o igClient monta ("sendMessage 500: {…}"). */
function statusDe(erro: string): number {
  const m = /\b(\d{3})\b\s*:/.exec(erro || '');
  return m ? Number(m[1]) : 0;
}

/** `code` do corpo da Meta ({"error":{"code":1,…}}). */
function codeDe(erro: string): number {
  const m = /"code"\s*:\s*(\d+)/.exec(erro || '');
  return m ? Number(m[1]) : 0;
}

/**
 * Erros transitórios/opacos da Meta. code 1 = "An unknown error has occurred",
 * code 2 = "temporary issue due to downtime" — os dois já chegaram com a
 * mensagem entregue do outro lado.
 */
const CODES_INCERTOS = [1, 2];

export function classificarFalha(erro: string): TipoFalha {
  const txt = String(erro || '');
  // A Meta só cita o campo quando é ele o problema — aí sim vale tirar o botão.
  if (/quick_?repl/i.test(txt)) return 'sem_botao';
  const status = statusDe(txt);
  const code = codeDe(txt);
  if (status >= 500 || CODES_INCERTOS.includes(code)) return 'incerto';
  // Rede caindo no meio (fetch failed / timeout) também é envio incerto: pode
  // ter chegado no servidor da Meta e voltado sem resposta.
  if (!status && /fetch failed|network|timeout|ECONN|socket hang up/i.test(txt)) return 'incerto';
  return 'fatal';
}
