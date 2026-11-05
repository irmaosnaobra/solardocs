// Cálculos e gráficos da proposta solar, extraídos do modelo Moderno (M1) para o modelo
// Completo usar os MESMOS números. Módulo puro: sem banco, sem relógio.
//
// REGRA DURA: as fórmulas aqui são cópia literal do que o M1 já fazia. Os modelos 1, 2 e 3
// têm que imprimir byte a byte o mesmo HTML de antes da extração; qualquer ajuste de conta
// muda o valor que o cliente já recebeu. Mexeu aqui? Rode os testes `proposta*`.
import { pmtPriceCarencia, pNum } from './propostaSolarBase';

// ─── Parcelas ────────────────────────────────────────────────────────────────

// Tabela Elo padrão (usada quando o tenant não envia taxa customizada).
export const TAXA_CARTAO_DEFAULT: Record<number, number> = {
  1: 3.99, 2: 5.30, 3: 5.99, 4: 6.68, 5: 7.35, 6: 8.02, 7: 9.47,
  8: 10.13, 9: 10.78, 10: 11.43, 11: 12.06, 12: 12.70, 13: 13.32,
  14: 13.94, 15: 14.56, 16: 15.17, 17: 15.77, 18: 16.37,
  19: 16.97, 20: 17.57, 21: 18.17,
};

// Financiamento Price com 120 dias (4 meses) de carência. Taxa mensal padrão de 2,2%.
export const FIN_CARENCIA_MESES = 4;
export const FIN_RATE_DEFAULT = 2.20; // % a.m.
export const FIN_PRAZOS = [36, 48, 60, 72, 84] as const;

export function taxaCartao(f: Record<string, unknown>, n: number): number {
  const raw = String(f[`taxa_cartao_${n}`] || '').replace(',', '.');
  const v = parseFloat(raw);
  return v > 0 ? v : (TAXA_CARTAO_DEFAULT[n] ?? 0);
}

export function valorParcelaCartao(f: Record<string, unknown>, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  return Math.ceil((investimento * (1 + taxaCartao(f, n) / 100)) / n);
}

export function taxaFin(f: Record<string, unknown>, n: number): number {
  const raw = String(f[`taxa_fin_${n}`] || '').replace(',', '.');
  const v = parseFloat(raw);
  return v > 0 ? v : FIN_RATE_DEFAULT;
}

export function valorParcelaFin(f: Record<string, unknown>, investimento: number, n: number): number {
  if (investimento <= 0 || n <= 0) return 0;
  return Math.ceil(pmtPriceCarencia(investimento, taxaFin(f, n) / 100, n, FIN_CARENCIA_MESES));
}

// ─── Financeiro ──────────────────────────────────────────────────────────────

export const NUM_ANOS = 25;
export const BREAKDOWN_ANOS = [1, 5, 10, 25];

export interface EntradaFinanceira {
  consumoKwh: number;
  tarifa: number;
  taxaMinima: number;
  /** Fração (0,06 = 6% a.a.). */
  inflacao: number;
  /** Fração. */
  inflacaoTaxaMin: number;
  investimento: number;
  /** Só o modelo 4 com Fio B ligado: custo mensal do Fio B de cada ano (25 posições), somado à conta COM solar. Ausente = como sempre foi. */
  fioBMensal?: number[];
}

export interface Financeiro {
  paybackMeses: number;
  paybackAnos: string;
  paybackTexto: string;
  contaHoje: number;
  contaComSolar: number;
  economiaMensal: number;
  semSolarAcum: number[];
  comSolarAcum: number[];
  economia25: number;
  breakdownAnos: number[];
  breakdownEconomia: number[];
}

export function calcularFinanceiro(e: EntradaFinanceira): Financeiro {
  const { consumoKwh, taxaMinima, inflacao, investimento } = e;
  const inflacaoTaxaMin = e.inflacaoTaxaMin;
  const ref = { tarifa: e.tarifa };
  const fioB = e.fioBMensal;

  // Payback usando o MESMO modelo dual-inflação do chart 25 anos
  // (senão o "X anos pra retorno" diverge dos números mostrados nas curvas)
  const paybackMeses = (() => {
    if (investimento <= 0 || consumoKwh <= 0) return 0;
    let acum = 0;
    for (let a = 1; a <= 25; a++) {
      const ftar = Math.pow(1 + inflacao, a - 1);
      const fmin = Math.pow(1 + inflacaoTaxaMin, a - 1);
      const economiaAno = consumoKwh * 12 * ref.tarifa * ftar - taxaMinima * 12 * fmin - (fioB ? fioB[a - 1] * 12 : 0);
      if (acum + economiaAno >= investimento) {
        const restante = investimento - acum;
        return (a - 1) * 12 + Math.ceil((restante / economiaAno) * 12);
      }
      acum += economiaAno;
    }
    return 0;
  })();
  const paybackAnos = paybackMeses > 0 ? (paybackMeses / 12).toFixed(1).replace('.', ',') : '—';
  const paybackTexto = (() => {
    const m = paybackMeses;
    if (!m) return '—';
    const anos = Math.floor(m / 12);
    const meses = m % 12;
    if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    if (meses === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
    return `${anos} ${anos === 1 ? 'ano' : 'anos'} e ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  })();

  // Conta antes vs depois: hoje paga consumo × tarifa; com solar paga taxa mínima
  const contaHoje = Math.round(consumoKwh * ref.tarifa);
  const contaComSolar = taxaMinima + (fioB ? fioB[0] : 0);
  const economiaMensal = Math.max(0, contaHoje - contaComSolar);

  // Série anual acumulada pros 25 anos: conta SEM solar × conta COM solar.
  const semSolarAcum: number[] = [];
  const comSolarAcum: number[] = [];
  {
    let sem = 0, com = 0;
    for (let a = 1; a <= NUM_ANOS; a++) {
      const fatorTarifa = Math.pow(1 + inflacao, a - 1);
      const fatorMin = Math.pow(1 + inflacaoTaxaMin, a - 1);
      sem += consumoKwh * 12 * ref.tarifa * fatorTarifa;
      com += taxaMinima * 12 * fatorMin + (fioB ? fioB[a - 1] * 12 : 0);
      semSolarAcum.push(Math.round(sem));
      comSolarAcum.push(Math.round(com));
    }
  }
  const economia25 = semSolarAcum[NUM_ANOS - 1] - comSolarAcum[NUM_ANOS - 1];

  // Breakdown da economia em 25 anos (ano 1, 5, 10, 25) — mesmo modelo do chart.
  const breakdownAnos = BREAKDOWN_ANOS;
  const breakdownEconomia = breakdownAnos.map((anoAlvo) => semSolarAcum[anoAlvo - 1] - comSolarAcum[anoAlvo - 1]);

  return { paybackMeses, paybackAnos, paybackTexto, contaHoje, contaComSolar, economiaMensal, semSolarAcum, comSolarAcum, economia25, breakdownAnos, breakdownEconomia };
}

// ─── Gráficos (SVG inline, sem JS) ───────────────────────────────────────────

export function pBRLshort(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
  return `R$ ${Math.round(n)}`;
}

export interface PartesBarras { W: number; H: number; yLines: string; bars: string }

/** Barras de geração mensal. `c1` pinta o rótulo de cada barra; o degradê (c1 a c2) fica no wrapper. */
export function partesBarrasMensais(mensal: number[], mesesAbrev: readonly string[], c1: string): PartesBarras {
  const W = 600, H = 240, P = { top: 24, right: 16, bottom: 50, left: 48 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const barCount = 12;
  const barGap = 6;
  const barW = (innerW - barGap * (barCount - 1)) / barCount;
  const maxKwh = Math.max(...mensal, 1);
  // Y axis ticks (4 níveis)
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxKwh * i) / yTicks));
  const yLines = yLabels.map((v, i) => {
    const y = P.top + innerH - (innerH * i) / yTicks;
    return `<line x1="${P.left}" y1="${y}" x2="${P.left + innerW}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#9CA3AF">${pNum(v)}</text>`;
  }).join('\n');
  const bars = mensal.map((kwh, i) => {
    const x = P.left + i * (barW + barGap);
    const h = (kwh / maxKwh) * innerH;
    const y = P.top + innerH - h;
    return `<g>
  <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="url(#g1)"/>
  <text x="${x + barW / 2}" y="${P.top + innerH + 16}" text-anchor="middle" font-size="11" fill="#6B7280">${mesesAbrev[i]}</text>
  <text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${c1}">${pNum(kwh)}</text>
</g>`;
  }).join('\n');
  return { W, H, yLines, bars };
}

/** SVG completo das barras mensais. Altura controlada pelo CSS do chamador (viewBox 600x240). */
export function svgBarrasMensais(mensal: number[], mesesAbrev: readonly string[], c1: string, c2: string): string {
  const { W, H, yLines, bars } = partesBarrasMensais(mensal, mesesAbrev, c1);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  ${yLines}
  ${bars}
</svg>`;
}

export interface PartesCurvas { CW: number; CH: number; cYLines: string; areaEconomia: string; semPath: string; comPath: string; cXLabels: string }

/** Curvas acumuladas "sem solar x com solar" (25 anos). */
export function partesCurvas25(semSolarAcum: number[], comSolarAcum: number[]): PartesCurvas {
  const NUM = semSolarAcum.length;
  const CW = 700, CH = 280, CP = { top: 24, right: 20, bottom: 50, left: 70 };
  const cInnerW = CW - CP.left - CP.right;
  const cInnerH = CH - CP.top - CP.bottom;
  const yMaxComp = Math.max(...semSolarAcum, 1);
  const cYTicks = 5;
  const cYLines = Array.from({ length: cYTicks + 1 }, (_, i) => {
    const v = (yMaxComp * i) / cYTicks;
    const y = CP.top + cInnerH - (cInnerH * i) / cYTicks;
    return `<line x1="${CP.left}" y1="${y}" x2="${CP.left + cInnerW}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
<text x="${CP.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">${pBRLshort(v)}</text>`;
  }).join('\n');
  const xCoord = (i: number): number => CP.left + (cInnerW * i) / (NUM - 1);
  const yCoord = (v: number): number => CP.top + cInnerH - (cInnerH * v) / yMaxComp;

  // Path da linha "sem solar"
  const semPath = semSolarAcum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i).toFixed(1)} ${yCoord(v).toFixed(1)}`).join(' ');
  // Path da linha "com solar"
  const comPath = comSolarAcum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i).toFixed(1)} ${yCoord(v).toFixed(1)}`).join(' ');
  // Área de economia: polygon do sem (topo) descendo ao com (base) e fechando
  const areaEconomia = semSolarAcum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i).toFixed(1)} ${yCoord(v).toFixed(1)}`).join(' ')
    + ' ' + [...comSolarAcum].reverse().map((v, i) => {
        const idx = NUM - 1 - i;
        return `L ${xCoord(idx).toFixed(1)} ${yCoord(v).toFixed(1)}`;
      }).join(' ')
    + ' Z';

  // Labels do eixo X: anos 1, 5, 10, 15, 20, 25
  const cXLabels = [1, 5, 10, 15, 20, 25].map(a => {
    const i = a - 1;
    return `<text x="${xCoord(i).toFixed(1)}" y="${(CP.top + cInnerH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#6B7280" font-weight="600">Ano ${a}</text>`;
  }).join('\n');

  return { CW, CH, cYLines, areaEconomia, semPath, comPath, cXLabels };
}

export interface CoresCurvas { sem: string; com: string }
export const CORES_CURVAS_PADRAO: CoresCurvas = { sem: '#EF4444', com: '#10B981' };

/** SVG completo das curvas de 25 anos. A área entre as linhas é a economia. */
export function svgCurvas25(semSolarAcum: number[], comSolarAcum: number[], cores: CoresCurvas = CORES_CURVAS_PADRAO): string {
  const { CW, CH, cYLines, areaEconomia, semPath, comPath, cXLabels } = partesCurvas25(semSolarAcum, comSolarAcum);
  return `<svg viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gEco" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${cores.com}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${cores.com}" stop-opacity="0.10"/>
    </linearGradient>
  </defs>
  ${cYLines}
  <path d="${areaEconomia}" fill="url(#gEco)" stroke="none"/>
  <path d="${semPath}" fill="none" stroke="${cores.sem}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${comPath}" fill="none" stroke="${cores.com}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${cXLabels}
</svg>`;
}

// ─── Fio B (Lei 14.300), só no modelo 4 ──────────────────────────────────────
// Quem instala a partir de 2023 paga uma parte do Fio B sobre a energia injetada na rede. A parte sobe
// por ano do calendário. O ano 1 da série de 25 anos é o ano da emissão da proposta.

/** Percentual do Fio B cobrado no ano do calendário. */
export function percentualFioB(ano: number): number {
  if (ano <= 2023) return 15;
  if (ano === 2024) return 30;
  if (ano === 2025) return 45;
  if (ano === 2026) return 60;
  if (ano === 2027) return 75;
  if (ano === 2028) return 90;
  return 100;
}

/**
 * Ano do calendário (fuso de São Paulo) de uma data: o ano da MESMA string dd/mm/aaaa que a proposta imprime
 * como data de emissão (mesma chamada de formatação), então os dois nunca divergem.
 */
export function anoCivil(d: Date): number {
  const partes = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/');
  return parseInt(partes[partes.length - 1], 10);
}

/** Simultaneidade padrão (30%): a parte que vai para a rede é 100 - simultaneidade (70%, o padrão de antes). */
export const FIO_B_SIMULTANEIDADE_PADRAO = 30;
export const FIO_B_INJETADA_PADRAO = 100 - FIO_B_SIMULTANEIDADE_PADRAO;
export const MSG_FIO_B_TARIFA = 'Escreva o valor do Fio B da sua concessionária, em R$ por kWh.';
export const MSG_FIO_B_PCT = 'A parte da geração que vai para a rede tem que ficar entre 1% e 100%.';
export const MSG_FIO_B_SIMULT = 'A simultaneidade tem que ficar entre 0% e 100%.';

/**
 * A mesma regra do formulário: com vírgula, o ponto é de milhar ("1.000,5" vale 1000,5); a vírgula vira ponto;
 * e a leitura é estrita (Number): "0,28abc" não é número.
 */
export function numeroFlex(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  let t = v.trim();
  if (t === '') return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

/** Valor do campo ausente, nulo ou vazio: não veio. */
function veio(v: unknown): boolean {
  return !(v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));
}

/** Mensagem do primeiro erro do Fio B (só vale com fio_b_mostrar = true), ou null. */
export function validarFioB(f: Record<string, unknown>): string | null {
  if (f.fio_b_mostrar !== true) return null;
  const tarifa = numeroFlex(f.fio_b_tarifa);
  if (!(tarifa >= 0.01 && tarifa <= 2)) return MSG_FIO_B_TARIFA;
  if (veio(f.fio_b_simultaneidade_pct)) {
    // Barra de 0% a 100%: inteira. 100% (nada vai para a rede) vale e dá custo de Fio B zero.
    const s = numeroFlex(f.fio_b_simultaneidade_pct);
    if (!(Number.isInteger(s) && s >= 0 && s <= 100)) return MSG_FIO_B_SIMULT;
  } else if (veio(f.fio_b_injetada_pct)) {
    // Propostas de antes da barra: a parte injetada direta (1% a 100%).
    const pct = numeroFlex(f.fio_b_injetada_pct);
    if (!(pct >= 1 && pct <= 100)) return MSG_FIO_B_PCT;
  }
  return null;
}

/** `pct` = parte da geração que vai para a rede; `simultaneidade` = 100 - pct (a parte consumida na hora). */
export interface FioBLido { tarifa: number; pct: number; simultaneidade: number }

/** Os dados do Fio B, ou null se está desligado (ausente ou false) ou inválido (o controller já barra o inválido). */
export function lerFioB(f: Record<string, unknown>): FioBLido | null {
  if (validarFioB(f) !== null || f.fio_b_mostrar !== true) return null;
  // Simultaneidade vence; sem ela, vale a injetada de antes (simultaneidade = 100 - injetada); sem nenhuma, 30%.
  let simultaneidade = FIO_B_SIMULTANEIDADE_PADRAO;
  if (veio(f.fio_b_simultaneidade_pct)) simultaneidade = numeroFlex(f.fio_b_simultaneidade_pct);
  else if (veio(f.fio_b_injetada_pct)) simultaneidade = 100 - numeroFlex(f.fio_b_injetada_pct);
  return { tarifa: numeroFlex(f.fio_b_tarifa), pct: 100 - simultaneidade, simultaneidade };
}

export interface SerieFioB {
  tarifa: number;
  pct: number;
  simultaneidade: number;
  anoInicial: number;
  /** Percentual do ano (15 a 100), 25 posições. */
  percentuais: number[];
  /** Custo mensal do Fio B em cada um dos 25 anos, em R$ (sem arredondar). */
  custoMensal: number[];
}

/**
 * custo mensal do ano y = geração mensal média x (pct injetada / 100) x tarifa do Fio B
 *                         x (1 + reajuste da tarifa)^(y-1) x percentual do ano / 100.
 * `inflacao` é fração (0,06 = 6% a.a.), a mesma da tarifa de energia.
 */
export function serieFioB(a: { fio: FioBLido; geracaoMediaMensal: number; inflacao: number; anoInicial: number }): SerieFioB {
  const percentuais: number[] = [];
  const custoMensal: number[] = [];
  for (let y = 1; y <= NUM_ANOS; y++) {
    const pctAno = percentualFioB(a.anoInicial + y - 1);
    percentuais.push(pctAno);
    // Em centavos: conta com solar + economia = conta de hoje, exato, no que a proposta imprime.
    custoMensal.push(Math.round(a.geracaoMediaMensal * (a.fio.pct / 100) * a.fio.tarifa * Math.pow(1 + a.inflacao, y - 1) * (pctAno / 100) * 100) / 100);
  }
  return { tarifa: a.fio.tarifa, pct: a.fio.pct, simultaneidade: a.fio.simultaneidade, anoInicial: a.anoInicial, percentuais, custoMensal };
}
