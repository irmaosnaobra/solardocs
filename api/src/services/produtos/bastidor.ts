/**
 * BASTIDOR — quem enxerga a loja de produtos e os cadeados.
 *
 * Nasceu fechado (só o e-mail do Thiago) pra validar o lançamento sem a base
 * ver. **ABERTO PRA TODOS em 17/08/2026**, junto com a regra de que Precificação
 * e Inventário são do plano anual: enquanto o bastidor estava fechado, a
 * ferramenta seguia destrancada pra base inteira — a regra existia no catálogo e
 * não acontecia na tela. Cadeado que não tranca é decisão que não foi tomada.
 *
 * ANTES DE ABRIR foi conferido no banco quem perderia acesso: 74 pessoas já
 * usaram a precificação e 11 o inventário, e **nenhuma** ficaria trancada — as
 * posses `cortesia` (a leva antiga + as 49 do grandfather de 17/08) cobrem todo
 * mundo. É o que sustenta a promessa da LP: "já usava de graça, continua usando".
 *
 * Fechar de novo NÃO precisa de deploy: basta pôr e-mails em
 * PRODUTOS_BASTIDOR_EMAILS — a lista da env manda mais que este padrão.
 */

const PADRAO = ['*'];

function lista(): string[] {
  const bruto = (process.env.PRODUTOS_BASTIDOR_EMAILS || '').trim();
  if (!bruto) return PADRAO;
  return bruto.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** `*` na env var libera a loja pra base inteira. */
export function lojaAbertaPraTodos(): boolean {
  return lista().includes('*');
}

export function noBastidor(email: string | null | undefined): boolean {
  if (lojaAbertaPraTodos()) return true;
  const e = (email || '').trim().toLowerCase();
  return !!e && lista().includes(e);
}
