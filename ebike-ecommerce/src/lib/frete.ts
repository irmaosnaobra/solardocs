import 'server-only';

import { FRETE_GRATIS_ACIMA_DE, TABELA, tabelaPreenchida } from '../config/frete.ts';
import { enderecoDoCep, kmDeEstrada } from './geo.ts';
import type { Base } from './montarCatalogo.ts';

/**
 * O cálculo do frete, ponta a ponta.
 *
 * A parte que a loja sabe sozinha (de onde sai, quantos km, quantos kg) é
 * calculada sempre. O VALOR só sai se a tabela estiver preenchida — sem ela a
 * resposta diz "a combinar", e isso é melhor do que um número inventado que o
 * cliente vai cobrar depois.
 */

export type Cotacao = {
  cep: string;
  cidade: string;
  uf: string;
  bairro: string | null;
  /** Base do fornecedor mais perto do cliente, entre as que têm o modelo. */
  origem: { cidade: string; uf: string } | null;
  km: number | null;
  pesoKg: number | null;
  valor: number | null;
  prazoDias: number | null;
  gratis: boolean;
};

export async function cotar(opcoes: {
  cep: string;
  bases: Base[];
  basesDoProduto: string[];
  pesoKg: number | null;
  precoDaBike: number;
}): Promise<Cotacao | null> {
  const endereco = await enderecoDoCep(opcoes.cep);
  if (!endereco) return null;

  // Só as bases que têm ESTE modelo, e só as que têm coordenada.
  const candidatas = opcoes.bases.filter(
    (b) =>
      b.lat !== null &&
      b.lon !== null &&
      (opcoes.basesDoProduto.length === 0 || opcoes.basesDoProduto.includes(b.slug)),
  );

  let origem: Base | null = null;
  let km: number | null = null;

  if (endereco.ponto && candidatas.length) {
    const destino = endereco.ponto;
    const maisPerto = candidatas
      .map((b) => ({ b, km: kmDeEstrada({ lat: b.lat!, lon: b.lon! }, destino) }))
      .sort((x, y) => x.km - y.km)[0];
    origem = maisPerto.b;
    km = maisPerto.km;
  }

  const peso = opcoes.pesoKg ?? TABELA.pesoPadraoKg;

  let valor: number | null = null;
  if (tabelaPreenchida() && km !== null) {
    const soma =
      (TABELA.base ?? 0) + (TABELA.porKm ?? 0) * km + (TABELA.porKg ?? 0) * (peso ?? 0);
    valor = Math.round(soma * 100) / 100;
  }

  const gratis =
    FRETE_GRATIS_ACIMA_DE !== null && opcoes.precoDaBike >= FRETE_GRATIS_ACIMA_DE;
  if (gratis) valor = 0;

  const prazoDias =
    km !== null && TABELA.kmPorDia
      ? Math.ceil(km / TABELA.kmPorDia) + (TABELA.prazoBaseDias ?? 0)
      : null;

  return {
    cep: endereco.cep,
    cidade: endereco.cidade,
    uf: endereco.uf,
    bairro: endereco.bairro,
    origem: origem ? { cidade: origem.cidade, uf: origem.uf } : null,
    km,
    pesoKg: peso,
    valor,
    prazoDias,
    gratis,
  };
}
