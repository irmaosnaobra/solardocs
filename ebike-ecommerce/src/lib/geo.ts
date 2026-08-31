/**
 * Distância entre um CEP e outro, em linha reta.
 *
 * A BrasilAPI devolve latitude e longitude do CEP; daí a distância sai por
 * haversine. Linha reta NÃO é quilômetro rodado, e o cálculo do frete leva isso
 * em conta com um fator de estrada — o que ela entrega de verdade é uma medida
 * estável e gratuita, sem contrato com ninguém.
 */

export type Ponto = { lat: number; lon: number };

/**
 * Rodovia é mais longa que a linha reta. 1,3 é o fator usualmente citado para
 * malha brasileira; está aqui como constante nomeada e não escondido numa conta
 * justamente porque é uma aproximação, não uma medição.
 */
export const FATOR_ESTRADA = 1.3;

const RAIO_DA_TERRA_KM = 6371;

export function distanciaKm(a: Ponto, b: Ponto): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_DA_TERRA_KM * Math.asin(Math.sqrt(h));
}

export function kmDeEstrada(a: Ponto, b: Ponto): number {
  return Math.round(distanciaKm(a, b) * FATOR_ESTRADA);
}

export type EnderecoDoCep = {
  cep: string;
  cidade: string;
  uf: string;
  bairro: string | null;
  ponto: Ponto | null;
};

/**
 * Resolve o CEP. Tenta a BrasilAPI primeiro porque ela traz coordenada; se ela
 * não conhecer o CEP, o ViaCEP ainda diz a cidade, e aí a loja sabe PARA ONDE
 * entrega mesmo sem saber a distância.
 */
export async function enderecoDoCep(cep: string): Promise<EnderecoDoCep | null> {
  const limpo = cep.replace(/\D/g, '');
  if (limpo.length !== 8) return null;

  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${limpo}`, {
      next: { revalidate: 2592000 },
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const d = (await r.json()) as {
        city?: string;
        state?: string;
        neighborhood?: string;
        location?: { coordinates?: { latitude?: string; longitude?: string } };
      };
      const c = d.location?.coordinates;
      if (d.city && d.state) {
        return {
          cep: limpo,
          cidade: d.city,
          uf: d.state,
          bairro: d.neighborhood || null,
          ponto:
            c?.latitude && c?.longitude
              ? { lat: Number(c.latitude), lon: Number(c.longitude) }
              : null,
        };
      }
    }
  } catch {
    /* cai no ViaCEP */
  }

  try {
    const r = await fetch(`https://viacep.com.br/ws/${limpo}/json/`, {
      next: { revalidate: 2592000 },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      localidade?: string;
      uf?: string;
      bairro?: string;
      erro?: unknown;
    };
    if (d.erro || !d.localidade || !d.uf) return null;
    return { cep: limpo, cidade: d.localidade, uf: d.uf, bairro: d.bairro || null, ponto: null };
  } catch {
    return null;
  }
}
