// ─────────────────────────────────────────────────────────────────────────────
// TAXAS REAIS DA CONTA ASAAS — a fonte de verdade do dinheiro que sobra.
//
// Por que buscar em vez de tabelar: a tabela pública do site (2,99% à vista,
// 4,29% em 13–21x) é o preço de balcão. A conta tem taxa promocional — conferido
// em 14/08/2026 contra a API: `hasValidDiscount: true` derrubava 13–21x de 4,29%
// para 3,29%, e o promo tem data pra vencer. Uma tabela chumbada aqui começaria
// certa e ficaria errada em silêncio, bem no número que o Thiago manda pro
// cliente.
//
// A pegadinha que custou dinheiro: antecipação de cartão tem DUAS taxas, e a
// diferença é de 36%.
//   detachedMonthlyFeeValue     = 1,25% a.m.  → cobrança à vista
//   installmentMonthlyFeeValue  = 1,70% a.m.  → PARCELAMENTO
// Usar 1,25% num 18x subestima a mordida em ~R$190 numa venda de R$7,7 mil.
// Por isso as duas viajam separadas até o cálculo, sem "taxa de antecipação"
// genérica no meio do caminho.
// ─────────────────────────────────────────────────────────────────────────────

import { asaasFetch, asaasBaseUrl } from './asaasClient';
import { logger } from '../../utils/logger';

const LOG = 'asaas-taxas';
const CACHE_MS = 10 * 60 * 1000;   // taxa não muda no meio da tarde; 10 min basta

export type Ambiente = 'sandbox' | 'prod';

export interface Taxas {
  ambiente: Ambiente;
  /** R$ fixos por transação no cartão (operationValue). */
  cartaoFixo: number;
  /** % do cartão por faixa de parcelas — já resolvido entre promo e cheio. */
  cartaoPct: { avista: number; ate6: number; ate12: number; ate21: number };
  /** true = a conta está no período promocional (e a promo tem validade). */
  promoAtiva: boolean;
  promoVence: string | null;
  /** Dias até o dinheiro do cartão cair SEM antecipar (por parcela). */
  cartaoDias: number;

  boleto: number;
  boletoDias: number;

  pixTipo: 'FIXED' | 'PERCENT';
  pixFixo: number;
  pixPct: number;
  pixMin: number;
  pixMax: number;
  pixGratisMes: number;
  pixJaUsadosMes: number;

  /** % ao mês da antecipação. Parcelado e à vista são DIFERENTES — ver topo. */
  antecipAvistaMes: number;
  antecipParceladoMes: number;
}

type RespostaFees = {
  payment?: {
    bankSlip?: { defaultValue?: number; discountValue?: number; daysToReceive?: number };
    creditCard?: {
      operationValue?: number;
      oneInstallmentPercentage?: number; upToSixInstallmentsPercentage?: number;
      upToTwelveInstallmentsPercentage?: number; upToTwentyOneInstallmentsPercentage?: number;
      discountOneInstallmentPercentage?: number; discountUpToSixInstallmentsPercentage?: number;
      discountUpToTwelveInstallmentsPercentage?: number; discountUpToTwentyOneInstallmentsPercentage?: number;
      hasValidDiscount?: boolean; daysToReceive?: number; discountExpiration?: string;
    };
    pix?: {
      fixedFeeValue?: number; fixedFeeValueWithDiscount?: number; percentageFee?: number | null;
      minimumFeeValue?: number | null; maximumFeeValue?: number | null; type?: string;
      monthlyCreditsWithoutFee?: number; creditsReceivedOfCurrentMonth?: number;
    };
  };
  anticipation?: {
    creditCard?: { detachedMonthlyFeeValue?: number; installmentMonthlyFeeValue?: number };
  };
};

export function ambienteAsaas(): Ambiente {
  return asaasBaseUrl().includes('sandbox') ? 'sandbox' : 'prod';
}

// Rede de segurança: se a API de taxas cair, o app continua calculando com o
// preço de BALCÃO (o mais caro). Errar pra mais deixa sobrar dinheiro; errar pra
// menos manda o Thiago cobrar pouco e descobrir depois.
function taxasDeBalcao(): Taxas {
  return {
    ambiente: ambienteAsaas(),
    cartaoFixo: 0.49,
    cartaoPct: { avista: 2.99, ate6: 3.49, ate12: 3.99, ate21: 4.29 },
    promoAtiva: false, promoVence: null, cartaoDias: 32,
    boleto: 1.99, boletoDias: 1,
    pixTipo: 'FIXED', pixFixo: 1.99, pixPct: 0, pixMin: 0, pixMax: 0,
    pixGratisMes: 0, pixJaUsadosMes: 0,
    antecipAvistaMes: 1.25, antecipParceladoMes: 1.70,
  };
}

let cache: { em: number; taxas: Taxas } | null = null;

export async function buscarTaxas(forcar = false): Promise<Taxas> {
  if (!forcar && cache && Date.now() - cache.em < CACHE_MS) return cache.taxas;

  try {
    const r = await asaasFetch<RespostaFees>('/myAccount/fees');
    const cc = r.payment?.creditCard ?? {};
    const bs = r.payment?.bankSlip ?? {};
    const px = r.payment?.pix ?? {};
    const an = r.anticipation?.creditCard ?? {};

    // A promo só vale enquanto `hasValidDiscount` for true — o próprio Asaas
    // decide isso, não a data. Quando virar false, os campos cheios voltam.
    const promo = cc.hasValidDiscount === true;
    const escolhe = (comDesconto?: number, cheio?: number, padrao = 0) =>
      Number((promo ? comDesconto : cheio) ?? cheio ?? padrao);

    const taxas: Taxas = {
      ambiente: ambienteAsaas(),
      cartaoFixo: Number(cc.operationValue ?? 0.49),
      cartaoPct: {
        avista: escolhe(cc.discountOneInstallmentPercentage, cc.oneInstallmentPercentage, 2.99),
        ate6: escolhe(cc.discountUpToSixInstallmentsPercentage, cc.upToSixInstallmentsPercentage, 3.49),
        ate12: escolhe(cc.discountUpToTwelveInstallmentsPercentage, cc.upToTwelveInstallmentsPercentage, 3.99),
        ate21: escolhe(cc.discountUpToTwentyOneInstallmentsPercentage, cc.upToTwentyOneInstallmentsPercentage, 4.29),
      },
      promoAtiva: promo,
      promoVence: promo ? (cc.discountExpiration ?? null) : null,
      cartaoDias: Number(cc.daysToReceive ?? 32),

      boleto: Number((bs.discountValue ?? bs.defaultValue) ?? 1.99),
      boletoDias: Number(bs.daysToReceive ?? 1),

      pixTipo: px.type === 'PERCENT' ? 'PERCENT' : 'FIXED',
      pixFixo: Number((px.fixedFeeValueWithDiscount ?? px.fixedFeeValue) ?? 1.99),
      pixPct: Number(px.percentageFee ?? 0),
      pixMin: Number(px.minimumFeeValue ?? 0),
      pixMax: Number(px.maximumFeeValue ?? 0),
      pixGratisMes: Number(px.monthlyCreditsWithoutFee ?? 0),
      pixJaUsadosMes: Number(px.creditsReceivedOfCurrentMonth ?? 0),

      antecipAvistaMes: Number(an.detachedMonthlyFeeValue ?? 1.25),
      antecipParceladoMes: Number(an.installmentMonthlyFeeValue ?? 1.70),
    };

    cache = { em: Date.now(), taxas };
    return taxas;
  } catch (err) {
    logger.warn(LOG, 'não consegui ler as taxas da conta — usando preço de balcão', err);
    return taxasDeBalcao();
  }
}

/** % do cartão para um número de parcelas. Faixa, não interpolação. */
export function pctCartao(t: Taxas, parcelas: number): number {
  const n = Math.max(1, Math.round(parcelas));
  if (n === 1) return t.cartaoPct.avista;
  if (n <= 6) return t.cartaoPct.ate6;
  if (n <= 12) return t.cartaoPct.ate12;
  return t.cartaoPct.ate21;
}

/** Taxa da antecipação, ao mês, para um número de parcelas. */
export function pctAntecipacaoMes(t: Taxas, parcelas: number): number {
  return parcelas > 1 ? t.antecipParceladoMes : t.antecipAvistaMes;
}

/** Só pros testes — zera o cache entre casos. */
export function _limparCacheTaxas(): void { cache = null; }
