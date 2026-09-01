/**
 * A regra de preço mora AQUI e em nenhum outro lugar.
 *
 * Preço de venda = custo do fornecedor + 40% sobre o custo, arredondado para a
 * dezena. Nada de segunda fórmula em outro arquivo: qualquer tela que mostre
 * preço tem que chamar `precoDeVenda`.
 *
 * POR QUE DEIXOU DE SER SOMA FIXA (31/08). Os R$ 2.000 somados a tudo pesavam
 * 40% do preço na bike de entrada e 17% no triciclo — quer dizer, a loja era
 * cara justamente onde o marketplace é feroz e barata onde ninguém disputa.
 * Conferido contra o mercado: a Black Fish 500W saía por R$ 4.990 enquanto um
 * concorrente com ficha idêntica (chumbo-ácido 48V 12Ah, 25 km, 32 km/h) vendia
 * por R$ 4.249. A mesma conta em percentual põe a Black Fish em R$ 4.190 e
 * mantém a Tank 800W a 16% abaixo do mercado, com margem TOTAL praticamente
 * igual à de antes (R$ 90,5 mil contra R$ 92 mil nos 46 modelos).
 *
 * `server-only` é a trava que importa: este módulo conhece o custo, então não
 * pode ser importado por componente de cliente nem por engano. Se alguém tentar,
 * o build quebra em vez de vazar a margem dentro do JS da página.
 */

import 'server-only';

const MARGEM_PADRAO = 0.4;

/**
 * Margem sobre o custo, em fração. Padrão combinado: 0,40 (40%).
 *
 * A variável vazia daria `Number('') === 0` e a loja venderia tudo pelo custo;
 * lixo daria `NaN` e todo card mostraria "R$ NaN". Nos dois casos o certo é
 * cair no padrão e gritar no log, nunca publicar o número errado.
 */
function margemConfigurada(): number {
  const bruto = process.env.MARGEM_PERCENTUAL;
  if (bruto === undefined || bruto.trim() === '') return MARGEM_PADRAO;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0 || n > 3) {
    console.error(`MARGEM_PERCENTUAL inválida ("${bruto}"). Usando ${MARGEM_PADRAO}.`);
    return MARGEM_PADRAO;
  }
  return n;
}

export const MARGEM_PERCENTUAL = margemConfigurada();

/**
 * Preço na dezena cheia.
 *
 * O custo do fornecedor vem com centavos (R$ 5.990,91), e o preço saía
 * "R$ 7.990,91" na vitrine. Centavo quebrado em etiqueta de vitrine parece
 * conta de planilha vazada, não preço decidido.
 */
export function precoDeVenda(custoEmReais: number): number {
  return Math.round((custoEmReais * (1 + MARGEM_PERCENTUAL)) / 10) * 10;
}

/** Quanto sobra neste item. O painel usa; a loja nunca. */
export function margemDoItem(custoEmReais: number): number {
  return Math.round((precoDeVenda(custoEmReais) - custoEmReais) * 100) / 100;
}
