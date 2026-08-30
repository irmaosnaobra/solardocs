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

/** Margem em reais somada a cada item. Padrão combinado: R$ 2.000. */
export const MARGEM_EM_REAIS = Number(process.env.MARGEM_REAIS ?? 2000);

export function precoDeVenda(custoEmReais: number): number {
  return Math.round((custoEmReais + MARGEM_EM_REAIS) * 100) / 100;
}
