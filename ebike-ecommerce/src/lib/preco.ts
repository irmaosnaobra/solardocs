/**
 * A regra de preço mora AQUI e em nenhum outro lugar.
 *
 * A margem trabalha numa FAIXA de R$ 1.500 a R$ 2.000 por unidade — número do
 * Thiago (01/09) — e dentro dela a loja escolhe o melhor preço, não o maior.
 *
 * "Melhor" tem duas regras, nesta ordem:
 *
 * 1. TERMINAR EM 990 OU 490. Preço de vitrine é etiqueta, não resultado de
 *    planilha: o custo do fornecedor vem com centavos (R$ 5.990,91) e a conta
 *    crua devolvia "R$ 7.990,91". Dentro da faixa quase sempre existe um número
 *    redondo, e a loja pega o MAIOR deles — margem cheia com cara de preço
 *    decidido.
 *
 * 2. RESPEITAR O CONCORRENTE, quando ele foi medido. Aí a escolha inverte: em
 *    vez do maior da faixa, o maior que ainda passa por baixo do mercado. É o
 *    caso da Black Fish 500W — R$ 2.990 de custo contra um concorrente de ficha
 *    idêntica a R$ 4.249. Pelo topo da faixa ela sairia por R$ 4.990, 17% acima;
 *    pelo piso sai por R$ 4.490, 5,7% acima, o que a nota fiscal, a garantia e o
 *    frete calculado na tela cobrem com folga.
 *
 * Resultado nos 46 modelos: R$ 90.144 de margem, nenhuma unidade fora da faixa,
 * e a lista de preços cabe numa mão — 4.490 / 5.990 / 6.990 / 7.990 / 8.490 /
 * 11.990.
 *
 * `server-only` é a trava que importa: este módulo conhece o custo, então não
 * pode ser importado por componente de cliente nem por engano. Se alguém tentar,
 * o build quebra em vez de vazar a margem dentro do JS da página.
 */

import 'server-only';

/** A faixa de margem por unidade, em reais. */
export const MARGEM_MINIMA = 1500;
export const MARGEM_MAXIMA = 2000;

/**
 * Preço do concorrente, por código, quando alguém foi lá conferir.
 *
 * Só entra aqui número que eu vi numa loja, com a MESMA ficha técnica — não
 * "achei que devia custar". Sem entrada aqui, a loja usa o topo da faixa.
 *
 * 695723 / 695730 — Bicicleta Black Fish 500W: a Bikelete vende uma
 * chumbo-ácido 48V 12Ah, 25 km, 32 km/h por R$ 4.249,90 (conferido em 01/09).
 */
const MERCADO: Record<string, number> = {
  '695723': 4249,
  '695730': 4249,
};

/** Preços de vitrine terminam assim. Nada de R$ 7.990,91. */
function terminaBem(valor: number): boolean {
  const resto = valor % 1000;
  return resto === 990 || resto === 490;
}

export function precoDeVenda(custoEmReais: number, codigo?: string): number {
  const menor = custoEmReais + MARGEM_MINIMA;
  const maior = custoEmReais + MARGEM_MAXIMA;

  const redondos: number[] = [];
  for (let v = Math.ceil(menor / 10) * 10; v <= maior; v += 10) {
    if (terminaBem(v)) redondos.push(v);
  }

  // Faixa estreita demais para conter um número redondo: fica o topo dela.
  if (!redondos.length) return Math.round(maior / 10) * 10;

  const teto = codigo ? MERCADO[codigo] : undefined;
  if (teto !== undefined) {
    const cabem = redondos.filter((v) => v <= teto);
    // Nenhum passa por baixo do concorrente? Então o mais barato possível —
    // é o mais perto que a faixa deixa chegar.
    return cabem.length ? Math.max(...cabem) : Math.min(...redondos);
  }

  return Math.max(...redondos);
}

/** Quanto sobra neste item. O painel usa; a loja nunca. */
export function margemDoItem(custoEmReais: number, codigo?: string): number {
  return Math.round((precoDeVenda(custoEmReais, codigo) - custoEmReais) * 100) / 100;
}
