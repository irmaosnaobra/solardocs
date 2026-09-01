/**
 * A regra de preço mora AQUI e em nenhum outro lugar.
 *
 * Preço = o MAIOR entre "custo + 40%" e "custo + R$ 2.000", arredondado para a
 * dezena. Qualquer tela que mostre preço tem que chamar `precoDeVenda`; nada de
 * segunda fórmula em outro arquivo.
 *
 * As duas metades existem por motivos diferentes:
 *
 * O PISO de R$ 2.000 é exigência do Thiago (01/09). Abaixo disso a venda não
 * paga atender, entregar e dar suporte a um veículo.
 *
 * O PERCENTUAL conserta o outro lado. Só com soma fixa, a margem pesava 40% do
 * preço na bike de entrada e 17% no triciclo — ou seja, a loja ficava cara
 * justamente onde o marketplace é feroz e barata onde ninguém disputa. Nas
 * máquinas caras 40% dá mais que R$ 2.000, e não faz sentido ganhar o mesmo num
 * triciclo de R$ 10 mil de custo e numa bike de R$ 4 mil.
 *
 * O que o piso custa, e vale escrito: com custo de R$ 2.990, a Black Fish 500W
 * só pode sair por R$ 4.990, enquanto um concorrente de ficha idêntica
 * (chumbo-ácido 48V 12Ah, 25 km, 32 km/h) vende por R$ 4.249. Nesse modelo as
 * duas regras são incompatíveis: ou ele fica 17% acima do mercado, ou sai da
 * vitrine. Decisão do Thiago, não do código.
 *
 * `server-only` é a trava que importa: este módulo conhece o custo, então não
 * pode ser importado por componente de cliente nem por engano. Se alguém tentar,
 * o build quebra em vez de vazar a margem dentro do JS da página.
 */

import 'server-only';

const MARGEM_PADRAO = 0.4;

/** Piso em reais por unidade. Nenhuma bike sai por menos que isto de margem. */
export const PISO_EM_REAIS = 2000;

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
  const porPercentual = custoEmReais * (1 + MARGEM_PERCENTUAL);
  const porPiso = custoEmReais + PISO_EM_REAIS;
  return Math.round(Math.max(porPercentual, porPiso) / 10) * 10;
}

/** Quanto sobra neste item. O painel usa; a loja nunca. */
export function margemDoItem(custoEmReais: number): number {
  return Math.round((precoDeVenda(custoEmReais) - custoEmReais) * 100) / 100;
}
