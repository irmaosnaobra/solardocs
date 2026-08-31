import "server-only";

import {
  BASE_PROPRIA,
  DIAS_DE_SEPARACAO,
  FRETE_MINIMO,
  KG_POR_M3,
  KM_POR_DIA,
  PRESUMIDO,
  RAIO_MAXIMO_KM,
  REAIS_POR_KM,
} from "../config/frete.ts";
import { enderecoDoCep } from "./geo.ts";
import type { Base } from "./montarCatalogo.ts";
import { escolherOrigem } from "./origem.ts";

/**
 * O cálculo do frete.
 *
 *     frete = PISO + (km de ida e volta x R$/km)
 *
 * Entrega dedicada: sai de Uberlândia, leva e volta. O veículo volta vazio,
 * então quem paga a viagem paga os dois trechos.
 *
 * Devolve as PARTES, não só o total: quando o cliente pergunta por que o frete
 * dele deu isso, a resposta está na tela em vez de virar discussão.
 */

export type Cotacao = {
  cep: string;
  cidade: string;
  uf: string;
  bairro: string | null;
  /** Coordenada do cliente, para a vitrine medir distância sem novo pedido. */
  ponto: { lat: number; lon: number } | null;
  origem: { slug: string; cidade: string; uf: string } | null;
  /** Distância só de ida, em quilômetros de estrada. */
  km: number | null;
  kmIdaEVolta: number | null;
  rodagem: number;
  pesoRealKg: number | null;
  pesoCubadoKg: number;
  pesoTaxadoKg: number;
  /** True quando peso e medida saíram de presunção, não da ficha do fabricante. */
  presumido: boolean;
  /** True quando o destino passou do raio de entrega própria. */
  foraDoRaio: boolean;
  /** True quando a bike sai de uma base onde não temos veículo. */
  outraBase: boolean;
  valor: number | null;
  prazoDias: number | null;
};

export async function cotar(opcoes: {
  cep: string;
  bases: Base[];
  basesDoProduto: string[];
  pesoKg: number | null;
  volumeM3: number | null;
  categoria: string;
}): Promise<Cotacao | null> {
  const endereco = await enderecoDoCep(opcoes.cep);
  if (!endereco) return null;

  // A MESMA regra que a vitrine usa no card, para o card e a cotação nunca
  // discordarem sobre de onde a bike sai.
  const escolha = endereco.ponto
    ? escolherOrigem(opcoes.bases, opcoes.basesDoProduto, endereco.ponto)
    : null;
  const origem: Base | null = escolha?.base ?? null;
  const km: number | null = escolha?.km ?? null;

  const presumido = PRESUMIDO[opcoes.categoria] ?? PRESUMIDO.padrao;
  const semFicha = opcoes.pesoKg === null && opcoes.volumeM3 === null;
  const pesoReal = opcoes.pesoKg ?? presumido.pesoKg;
  const volume = opcoes.volumeM3 ?? presumido.m3;
  const pesoCubado = Math.round(volume * KG_POR_M3);

  const outraBase = origem !== null && origem.slug !== BASE_PROPRIA;
  const foraDoRaio = km !== null && km > RAIO_MAXIMO_KM;
  const kmIdaEVolta = km === null ? null : km * 2;
  const rodagem = kmIdaEVolta === null ? 0 : kmIdaEVolta * REAIS_POR_KM;

  // Fora do raio a viagem dedicada não faz sentido, e um número absurdo na tela
  // mata a venda. Melhor dizer que se cota do que assustar.
  // Preço só sai da base onde temos van. Das outras a bike está perto do
  // cliente, e isso já é notícia boa, mas quem leva é transportadora.
  const semPreco = km === null || foraDoRaio || outraBase;
  const valor = semPreco
    ? null
    : Math.round((FRETE_MINIMO + rodagem) * 100) / 100;
  const prazoDias =
    semPreco || km === null
      ? null
      : Math.ceil(km / KM_POR_DIA) + DIAS_DE_SEPARACAO;

  return {
    cep: endereco.cep,
    cidade: endereco.cidade,
    uf: endereco.uf,
    bairro: endereco.bairro,
    ponto: endereco.ponto,
    origem: origem
      ? { slug: origem.slug, cidade: origem.cidade, uf: origem.uf }
      : null,
    km,
    kmIdaEVolta,
    rodagem: Math.round(rodagem * 100) / 100,
    pesoRealKg: opcoes.pesoKg,
    pesoCubadoKg: pesoCubado,
    pesoTaxadoKg: Math.max(pesoReal, pesoCubado),
    presumido: semFicha,
    foraDoRaio,
    outraBase,
    valor,
    prazoDias,
  };
}
