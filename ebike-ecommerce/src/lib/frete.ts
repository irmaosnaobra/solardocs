import 'server-only';

import {
  AD_VALOREM,
  CAPACIDADE_PAGANTE_KG,
  CCD_ANTT_POR_KM,
  DIAS_DE_COLETA_E_ENTREGA,
  FATOR_MERCADO,
  FRETE_MINIMO,
  KG_POR_M3,
  KM_POR_DIA,
  PRESUMIDO,
  REAIS_POR_KG_KM,
} from '../config/frete.ts';
import { enderecoDoCep, kmDeEstrada } from './geo.ts';
import type { Base } from './montarCatalogo.ts';

/**
 * O cálculo do frete, ponta a ponta.
 *
 * Segue a estrutura de carga fracionada: peso taxado (o maior entre balança e
 * cubagem), frete-peso proporcional aos quilômetros, ad valorem sobre o valor
 * da mercadoria, e um piso que cobre coleta, despacho e entrega.
 *
 * Devolve as PARTES, não só o total: quando o cliente pergunta por que o frete
 * dele deu isso, a resposta está na tela em vez de virar discussão.
 */

export type Cotacao = {
  cep: string;
  cidade: string;
  uf: string;
  bairro: string | null;
  /** Base do fornecedor mais perto do cliente, entre as que têm o modelo. */
  origem: { cidade: string; uf: string } | null;
  km: number | null;
  pesoRealKg: number | null;
  pesoCubadoKg: number | null;
  pesoTaxadoKg: number;
  /** True quando peso e medida saíram de presunção, não da ficha do fabricante. */
  presumido: boolean;
  fretePeso: number;
  freteValor: number;
  /** True quando o piso foi maior que a soma das partes. */
  noPiso: boolean;
  valor: number;
  prazoDias: number | null;
};

export async function cotar(opcoes: {
  cep: string;
  bases: Base[];
  basesDoProduto: string[];
  pesoKg: number | null;
  volumeM3: number | null;
  categoria: string;
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

  const presumido = PRESUMIDO[opcoes.categoria] ?? PRESUMIDO.padrao;
  const semFicha = opcoes.pesoKg === null && opcoes.volumeM3 === null;
  const pesoReal = opcoes.pesoKg ?? presumido.pesoKg;
  const volume = opcoes.volumeM3 ?? presumido.m3;

  const pesoCubado = Math.round(volume * KG_POR_M3);
  const pesoTaxado = Math.max(pesoReal, pesoCubado);

  const fretePeso = km === null ? 0 : REAIS_POR_KG_KM * pesoTaxado * km;
  const freteValor = AD_VALOREM * opcoes.precoDaBike;
  const soma = fretePeso + freteValor;

  const noPiso = soma < FRETE_MINIMO;
  const valor = Math.round(Math.max(FRETE_MINIMO, soma) * 100) / 100;

  const prazoDias = km === null ? null : Math.ceil(km / KM_POR_DIA) + DIAS_DE_COLETA_E_ENTREGA;

  return {
    cep: endereco.cep,
    cidade: endereco.cidade,
    uf: endereco.uf,
    bairro: endereco.bairro,
    origem: origem ? { cidade: origem.cidade, uf: origem.uf } : null,
    km,
    pesoRealKg: opcoes.pesoKg,
    pesoCubadoKg: pesoCubado,
    pesoTaxadoKg: pesoTaxado,
    presumido: semFicha,
    fretePeso: Math.round(fretePeso * 100) / 100,
    freteValor: Math.round(freteValor * 100) / 100,
    noPiso,
    valor,
    prazoDias,
  };
}

/** Os números que sustentam a conta, para o painel mostrar de onde ela sai. */
export function parametrosDoFrete() {
  return {
    piso: FRETE_MINIMO,
    kgPorM3: KG_POR_M3,
    ccdAntt: CCD_ANTT_POR_KM,
    capacidadePagante: CAPACIDADE_PAGANTE_KG,
    fatorMercado: FATOR_MERCADO,
    reaisPorKgKm: REAIS_POR_KG_KM,
    adValorem: AD_VALOREM,
    kmPorDia: KM_POR_DIA,
    diasDeColetaEEntrega: DIAS_DE_COLETA_E_ENTREGA,
  };
}
