import { BASE_PROPRIA, ORIGEM_UNICA, RAIO_MAXIMO_KM } from '../config/frete.ts';
import { kmDeEstrada } from './geo.ts';

/**
 * O mínimo para medir distância. Genérico de propósito: o servidor passa a
 * `Base` inteira e a vitrine passa a versão enxuta que vai para o navegador.
 */
export type Galpao = {
  slug: string;
  cidade: string;
  uf: string;
  lat: number | null;
  lon: number | null;
};

/**
 * De qual base a bike sai para quem está comprando.
 *
 * Existe UMA vez porque a vitrine e a cotação precisam concordar. Enquanto cada
 * uma escolhia sozinha "a mais perto", dava para o card prometer "sai de
 * Contagem — 248 km" e a página do produto responder "consulte o frete", porque
 * Contagem ganhou de Uberlândia por alguns quilômetros — e é de Uberlândia, e
 * só de lá, que sai a nossa van com preço fechado.
 *
 * A regra, então, não é a menor distância: é o melhor desfecho para quem compra.
 *   1. Se a NOSSA base tem o modelo e o destino cabe no raio, sai daqui. Preço
 *      cravado na tela vale mais do que estar cem quilômetros mais perto de um
 *      galpão que não é nosso.
 *   2. Fora do raio a van não vai de jeito nenhum. Aí a base mais perto é a
 *      resposta honesta: é ela que faz o frete de transportadora ficar menor.
 */

export type Escolha<B extends Galpao> = { base: B; km: number };

export function escolherOrigem<B extends Galpao>(
  bases: B[],
  basesDoProduto: string[],
  destino: { lat: number; lon: number },
): Escolha<B> | null {
  const candidatas = bases.filter((b) => {
    if (b.lat === null || b.lon === null) return false;
    if (ORIGEM_UNICA) return b.slug === ORIGEM_UNICA;
    return basesDoProduto.length === 0 || basesDoProduto.includes(b.slug);
  });
  if (!candidatas.length) return null;

  const medidas = candidatas
    .map((b) => ({
      base: b,
      km: kmDeEstrada({ lat: b.lat!, lon: b.lon! }, destino),
    }))
    .sort((x, y) => x.km - y.km);

  const nossa = medidas.find((m) => m.base.slug === BASE_PROPRIA);
  if (nossa && nossa.km <= RAIO_MAXIMO_KM) return nossa;

  return medidas[0];
}
