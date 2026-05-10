// Dados de referência pra cálculo de proposta solar.
//
// HSP = Horas de Sol Pleno (média anual). Vem de mapas solarimétricos
// brasileiros (CRESESB / INPE). Aqui usamos a média do estado como
// aproximação — vendedor pode ajustar manualmente se quiser.
//
// Tarifa = R$/kWh média residencial 2026 (subgrupo B1) por estado.
// Valor de referência baseado em ANEEL — varia por concessionária e
// faixa de consumo, mas dá pra usar como base de cálculo.

export interface SolarRef {
  hsp: number;       // horas de sol pleno (kWh/m²/dia médio anual)
  tarifa: number;    // R$/kWh
}

export const HSP_TARIFA_BR: Record<string, SolarRef> = {
  // Norte
  AC: { hsp: 4.6, tarifa: 0.95 },
  AM: { hsp: 4.5, tarifa: 0.91 },
  AP: { hsp: 4.6, tarifa: 0.92 },
  PA: { hsp: 4.8, tarifa: 0.88 },
  RO: { hsp: 4.7, tarifa: 0.93 },
  RR: { hsp: 4.7, tarifa: 0.94 },
  TO: { hsp: 5.4, tarifa: 0.96 },

  // Nordeste
  AL: { hsp: 5.7, tarifa: 0.92 },
  BA: { hsp: 5.6, tarifa: 0.99 },
  CE: { hsp: 5.9, tarifa: 0.94 },
  MA: { hsp: 5.6, tarifa: 0.85 },
  PB: { hsp: 5.8, tarifa: 0.91 },
  PE: { hsp: 5.7, tarifa: 0.95 },
  PI: { hsp: 5.8, tarifa: 0.93 },
  RN: { hsp: 5.8, tarifa: 0.91 },
  SE: { hsp: 5.6, tarifa: 0.92 },

  // Centro-Oeste
  DF: { hsp: 5.5, tarifa: 0.98 },
  GO: { hsp: 5.5, tarifa: 0.97 },
  MS: { hsp: 5.3, tarifa: 0.96 },
  MT: { hsp: 5.4, tarifa: 0.94 },

  // Sudeste
  ES: { hsp: 5.3, tarifa: 1.02 },
  MG: { hsp: 5.4, tarifa: 1.05 },
  RJ: { hsp: 5.1, tarifa: 1.06 },
  SP: { hsp: 5.0, tarifa: 0.92 },

  // Sul
  PR: { hsp: 4.8, tarifa: 0.89 },
  RS: { hsp: 4.7, tarifa: 0.95 },
  SC: { hsp: 4.6, tarifa: 0.85 },
};

// Variação mensal típica por região (multiplicador da geração média anual).
// Norte/Nordeste: pouco varia. Sul/Sudeste: varia mais (verão muito mais que inverno).
// 12 valores: jan, fev, mar, abr, mai, jun, jul, ago, set, out, nov, dez.
const VARIACAO_MENSAL: Record<'norte' | 'sul', number[]> = {
  // Equador (NE/N) — geração relativamente plana
  norte: [1.05, 1.00, 1.02, 0.98, 0.95, 0.92, 0.95, 1.00, 1.04, 1.08, 1.07, 1.06],
  // Sul (SP, MG, PR, RS) — verão pico, inverno fraco
  sul:   [1.15, 1.10, 1.05, 0.95, 0.85, 0.78, 0.80, 0.92, 1.00, 1.12, 1.15, 1.13],
};

const ESTADOS_NORTE_NE = ['AC','AM','AP','PA','RO','RR','TO','AL','BA','CE','MA','PB','PE','PI','RN','SE','GO','DF','MT','MS'];

export function getRef(uf: string): SolarRef {
  const u = (uf || '').trim().toUpperCase();
  return HSP_TARIFA_BR[u] || { hsp: 5.2, tarifa: 0.95 };
}

export function variacaoMensal(uf: string): number[] {
  const u = (uf || '').trim().toUpperCase();
  return ESTADOS_NORTE_NE.includes(u) ? VARIACAO_MENSAL.norte : VARIACAO_MENSAL.sul;
}

export const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Calcula geração mensal (kWh/mês) por mês, baseado em kWp + UF.
// Fórmula: kWh = kWp * HSP * dias * eficiência_sistema * variacao_mensal
// Eficiência típica de sistema (perdas inversor + cabeamento + sujeira): 80%
export function geracaoMensal(kwp: number, uf: string): number[] {
  const ref = getRef(uf);
  const variacao = variacaoMensal(uf);
  const efic = 0.80;
  const diasMes = 30.4;
  const baseAnual = kwp * ref.hsp * 365 * efic; // kWh/ano
  const mediaMensal = baseAnual / 12;
  return variacao.map((v) => Math.round(mediaMensal * v));
}

// Calcula payback considerando inflação 6% a.a. da tarifa de energia.
// Retorna ano em que o acumulado de economia supera o investimento.
export function calcPayback(investimento: number, geracaoAnualKwh: number, tarifaInicial: number, inflacaoAA = 0.06): {
  paybackMeses: number;
  acumulado25anos: number;
  economiaAno1: number;
} {
  let acumulado = 0;
  let paybackMeses = 0;
  let economiaAno1 = 0;
  for (let ano = 1; ano <= 25; ano++) {
    const tarifaAno = tarifaInicial * Math.pow(1 + inflacaoAA, ano - 1);
    const economiaAno = geracaoAnualKwh * tarifaAno;
    if (ano === 1) economiaAno1 = economiaAno;
    if (paybackMeses === 0 && acumulado + economiaAno >= investimento) {
      // Mês exato dentro do ano em que o acumulado supera o investimento
      const restante = investimento - acumulado;
      const mesesNoAno = Math.ceil((restante / economiaAno) * 12);
      paybackMeses = (ano - 1) * 12 + mesesNoAno;
    }
    acumulado += economiaAno;
  }
  return {
    paybackMeses: paybackMeses || 0,
    acumulado25anos: Math.round(acumulado),
    economiaAno1: Math.round(economiaAno1),
  };
}
