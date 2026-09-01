/**
 * A regra de preço mora AQUI e em nenhum outro lugar.
 *
 * Preço = o que o MERCADO pratica, com piso de R$ 1.500 de margem. Decisão do
 * Thiago (01/09): equalizar com o mercado, ganhar no mínimo R$ 1.500 por
 * unidade, e não passar do teto que o mercado trabalha.
 *
 * Como cada preço sai, em ordem:
 *
 * 1. Existe âncora de mercado para o modelo (`config/mercado.ts`)? O preço é
 *    ela, arredondada para baixo até terminar em 990 ou 490. Só entra âncora
 *    que foi carregada de uma página de loja com a ficha conferida.
 * 2. O resultado ficou abaixo de custo + R$ 1.500? Sobe para o piso. É o caso
 *    da Black Fish: o concorrente vende a R$ 4.249 e o nosso custo é R$ 2.990,
 *    então o mínimo possível é R$ 4.490 — R$ 240 acima dele, e é o mais perto
 *    que dá para chegar sem trabalhar de graça.
 * 3. Sem âncora nenhuma? Mantém a regra antiga (o maior número redondo entre
 *    custo + 1.500 e custo + 2.000). Preço sem referência não se inventa: fica
 *    o conservador até alguém ir medir o concorrente.
 *
 * O que isso muda, e vale saber: a loja deixa de estar 20% abaixo do mercado.
 * Aquela era a posição comercial mais forte que ela tinha. A troca é margem por
 * preço agressivo, e foi escolha do dono.
 *
 * `server-only` é a trava que importa: este módulo conhece o custo, então não
 * pode ser importado por componente de cliente nem por engano. Se alguém tentar,
 * o build quebra em vez de vazar a margem dentro do JS da página.
 */

import 'server-only';

import { MERCADO, MERCADO_POR_FICHA, type Ancora } from '../config/mercado.ts';

/** A faixa de margem por unidade, em reais. */
export const MARGEM_MINIMA = 1500;
export const MARGEM_MAXIMA = 2000;

/** Preços de vitrine terminam assim. Nada de R$ 7.990,91. */
function terminaBem(valor: number): boolean {
  const resto = valor % 1000;
  return resto === 990 || resto === 490;
}

/** O maior número redondo que não passa do teto. */
function redondoAbaixoDe(teto: number): number {
  for (let v = Math.floor(teto / 10) * 10; v > 0; v -= 10) {
    if (terminaBem(v)) return v;
  }
  return Math.floor(teto / 10) * 10;
}

/** A âncora do modelo: primeiro a exata por código, depois a da ficha. */
export function ancoraDe(codigo?: string, bateria?: string | null, titulo?: string): Ancora | null {
  if (codigo && MERCADO[codigo]) return MERCADO[codigo];
  const texto = `${titulo ?? ''} ${bateria ?? ''}`;
  for (const { quando, ancora } of MERCADO_POR_FICHA) {
    if (quando.test(texto)) return ancora;
  }
  return null;
}

/** A regra antiga, para quem não tem concorrente medido. */
function semReferencia(custoEmReais: number): number {
  const menor = custoEmReais + MARGEM_MINIMA;
  const maior = custoEmReais + MARGEM_MAXIMA;
  const redondos: number[] = [];
  for (let v = Math.ceil(menor / 10) * 10; v <= maior; v += 10) {
    if (terminaBem(v)) redondos.push(v);
  }
  return redondos.length ? Math.max(...redondos) : Math.round(maior / 10) * 10;
}

export function precoDeVenda(
  custoEmReais: number,
  codigo?: string,
  bateria?: string | null,
  titulo?: string,
): number {
  const ancora = ancoraDe(codigo, bateria, titulo);
  if (!ancora) return semReferencia(custoEmReais);

  const piso = custoEmReais + MARGEM_MINIMA;
  const peloMercado = redondoAbaixoDe(ancora.preco);
  // Mercado abaixo do nosso piso: cobra o piso. Vender abaixo dele é trabalhar
  // de graça, e nenhum preço de concorrente muda isso.
  return Math.max(peloMercado, Math.round(piso / 10) * 10);
}

/** Quanto sobra neste item. O painel usa; a loja nunca. */
export function margemDoItem(
  custoEmReais: number,
  codigo?: string,
  bateria?: string | null,
  titulo?: string,
): number {
  return (
    Math.round((precoDeVenda(custoEmReais, codigo, bateria, titulo) - custoEmReais) * 100) / 100
  );
}
