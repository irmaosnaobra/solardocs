/**
 * A regra de preço mora AQUI e em nenhum outro lugar.
 *
 * Preço de venda = custo do fornecedor + margem fixa. Nada de multiplicador
 * por cima da margem, nada de segunda fórmula em outro arquivo: qualquer tela
 * que mostre preço tem que chamar `precoDeVenda`.
 *
 * `server-only` é a trava que importa: este módulo conhece o custo, então não
 * pode ser importado por componente de cliente nem por engano. Se alguém tentar,
 * o build quebra em vez de vazar a margem dentro do JS da página.
 */

import 'server-only';

const MARGEM_PADRAO = 2000;

/**
 * Margem em reais somada a cada item. Padrão combinado: R$ 2.000.
 *
 * A variável vazia daria `Number('') === 0` e a loja venderia tudo pelo custo;
 * lixo daria `NaN` e todo card mostraria "R$ NaN". Nos dois casos o certo é
 * cair no padrão e gritar no log, nunca publicar o número errado.
 */
function margemConfigurada(): number {
  const bruto = process.env.MARGEM_REAIS;
  if (bruto === undefined || bruto.trim() === '') return MARGEM_PADRAO;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`MARGEM_REAIS inválida ("${bruto}"). Usando R$ ${MARGEM_PADRAO}.`);
    return MARGEM_PADRAO;
  }
  return n;
}

export const MARGEM_EM_REAIS = margemConfigurada();

export function precoDeVenda(custoEmReais: number): number {
  return Math.round((custoEmReais + MARGEM_EM_REAIS) * 100) / 100;
}
