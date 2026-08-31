import 'server-only';

import {
  DIAS_DE_SEPARACAO,
  FRETE_MINIMO,
  KG_POR_M3,
  KM_POR_DIA,
  ORIGEM_UNICA,
  PRESUMIDO,
  RAIO_MAXIMO_KM,
  REAIS_POR_KM,
} from '../config/frete.ts';
import { enderecoDoCep, kmDeEstrada } from './geo.ts';
import type { Base } from './montarCatalogo.ts';

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
  origem: { cidade: string; uf: string } | null;
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

  // Hoje a operação sai só de Uberlândia. Com ORIGEM_UNICA em null, o cálculo
  // volta a escolher a base do fornecedor mais perto de quem comprou.
  const candidatas = opcoes.bases.filter((b) => {
    if (b.lat === null || b.lon === null) return false;
    if (ORIGEM_UNICA) return b.slug === ORIGEM_UNICA;
    return opcoes.basesDoProduto.length === 0 || opcoes.basesDoProduto.includes(b.slug);
  });

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

  const presumido = PRESUMIDO[opcoes.categoria] ?? PRESUMIDO.padrao;
  const semFicha = opcoes.pesoKg === null && opcoes.volumeM3 === null;
  const pesoReal = opcoes.pesoKg ?? presumido.pesoKg;
  const volume = opcoes.volumeM3 ?? presumido.m3;
  const pesoCubado = Math.round(volume * KG_POR_M3);

  const foraDoRaio = km !== null && km > RAIO_MAXIMO_KM;
  const kmIdaEVolta = km === null ? null : km * 2;
  const rodagem = kmIdaEVolta === null ? 0 : kmIdaEVolta * REAIS_POR_KM;

  // Fora do raio a viagem dedicada não faz sentido, e um número absurdo na tela
  // mata a venda. Melhor dizer que se cota do que assustar.
  const valor =
    km === null || foraDoRaio ? null : Math.round((FRETE_MINIMO + rodagem) * 100) / 100;

  const prazoDias =
    km === null || foraDoRaio ? null : Math.ceil(km / KM_POR_DIA) + DIAS_DE_SEPARACAO;

  return {
    cep: endereco.cep,
    cidade: endereco.cidade,
    uf: endereco.uf,
    bairro: endereco.bairro,
    origem: origem ? { cidade: origem.cidade, uf: origem.uf } : null,
    km,
    kmIdaEVolta,
    rodagem: Math.round(rodagem * 100) / 100,
    pesoRealKg: opcoes.pesoKg,
    pesoCubadoKg: pesoCubado,
    pesoTaxadoKg: Math.max(pesoReal, pesoCubado),
    presumido: semFicha,
    foraDoRaio,
    valor,
    prazoDias,
  };
}
