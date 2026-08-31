import { ORIGEM_UNICA } from '../config/frete.ts';
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
 * A regra é a MENOR DISTÂNCIA, e agora ela também é o menor preço: desde 31/08
 * o piso de R$ 250 conta da sede de cada unidade, então toda base cota. Antes a
 * loja preferia a nossa base mesmo estando mais longe, porque era a única que
 * sabia dar valor — a preferência sumiu junto com o motivo dela.
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

  return medidas[0];
}
