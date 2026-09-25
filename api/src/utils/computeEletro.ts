// ─────────────────────────────────────────────────────────────────────────────
// O MOTOR DO SIMULADOR, sem navegador em volta.
//
// Morava dentro do apresentacaoController.ts, que importa chromium e puppeteer no
// topo. O estudo do local (eletropostoEstudo.ts) usa a mesma conta dentro do tick
// de 5 min, e importar o controller só pela conta carregaria o navegador junto.
// A função veio movida sem mudar uma linha; o controller reexporta, então quem
// importava de lá continua importando.
//
// Conferência escrita na própria LP (/io/eletroposto, params()) e repetida no
// teste: 10 carros/dia, revenda 2,35, custo 0,70, sem arrendamento.
//   R$ 160.000 ⇒ lucro R$ 6.920 · margem 47,86% · payback 2,46 anos
//   R$ 144.595 ⇒ lucro R$ 6.933 · margem 47,95% · payback 2,27 anos
// Se o teste de ouro quebrar, a LP e o estudo passaram a contar histórias
// diferentes: corrigir a divergência, nunca o número esperado.
// ─────────────────────────────────────────────────────────────────────────────

// ── motor de cálculo: cópia fiel do computeEletro() do Simulador ───────────
// Não "melhorar" nada aqui. Se divergir do /gerador, o deck e o orçamento que o
// cliente tem na mão passam a contar histórias diferentes — e aí a apresentação
// inteira perde a validade.
export interface ParamsEletro {
  carros: number; carga: number; custoKwh: number; precoKwh: number; ativacao: number;
  invest: number; gateway: number; arrend: number; manut: number; imposto: number;
  assinat: number; fixos: number; ocupIni: number; mesesRampa: number; taxaDesc: number;
  /** Software NEXUS, % do faturamento. Opcional: documento antigo não tem. */
  software?: number;
}

export function computeEletro(p: ParamsEletro) {
  const DIAS = 30, ANOS = 10;
  const kwhMes = p.carros * p.carga * DIAS;
  const sessoes = p.carros * DIAS;
  const fatMes = kwhMes * p.precoKwh + sessoes * p.ativacao;

  const custoEnergia = kwhMes * p.custoKwh;
  // SOFTWARE NEXUS: % do faturamento, igual ao gateway. Entrou em 25/09/2026 por
  // ordem do Thiago, com 10% de padrão no Gerador.
  //
  // O `|| 0` NÃO é defensividade à toa, é compatibilidade: todo orçamento já
  // salvo e todo link já enviado têm um `dados` SEM esta chave. Sem o fallback,
  // `undefined` contamina a soma, `taxasPct` vira NaN e o documento que o
  // cliente tem na mão reabre com todos os números em branco.
  //
  // E a LP /io/eletroposto NÃO recebe este custo: o `gateway` dela é 14%
  // (PREMISSAS_LP), contra 3,5% do Gerador. Catorze por cento é alto demais para
  // gateway de pagamento sozinho — aquele número já carrega a plataforma. Somar
  // 10% por cima seria cobrar a mesma coisa duas vezes na conta que o lead vê.
  const taxasPct = p.gateway + p.arrend + p.manut + p.imposto + (p.software || 0);
  const seguroMes = p.invest * 0.01 / 12;
  const fixosMes = p.assinat + seguroMes + (p.fixos || 0);
  const margemVarMes = fatMes - custoEnergia - fatMes * taxasPct;
  const lucroMes = margemVarMes - fixosMes;
  const custosMes = fatMes - lucroMes;
  const margem = fatMes > 0 ? lucroMes / fatMes : 0;

  const ocupIni = Math.min(1, Math.max(0, p.ocupIni == null ? 1 : p.ocupIni));
  const mRampa = Math.max(1, Math.round(p.mesesRampa == null ? 1 : p.mesesRampa));
  const occ = (m: number) => (mRampa <= 1 || m >= mRampa) ? 1 : ocupIni + (1 - ocupIni) * (m - 1) / (mRampa - 1);

  const fluxoAnual: number[] = [];
  for (let a = 0; a < ANOS; a++) {
    let luc = 0;
    for (let m = 1; m <= 12; m++) luc += margemVarMes * occ(a * 12 + m) - fixosMes;
    fluxoAnual.push(luc);
  }
  const lucroAno1 = fluxoAnual[0];

  const fluxo: number[] = [];
  let acc = -p.invest, payback: number | null = null;
  fluxoAnual.forEach((f, i) => {
    const antes = acc; acc += f; fluxo.push(acc);
    if (payback === null && acc >= 0 && f > 0) payback = i + (0 - antes) / f;
  });
  const acumulado10 = fluxo[ANOS - 1];

  const tx = Math.max(0, p.taxaDesc || 0);
  let vpl = -p.invest;
  fluxoAnual.forEach((f, i) => { vpl += f / Math.pow(1 + tx, i + 1); });

  let tir: number | null = null;
  if (p.invest > 0 && fluxoAnual.some(f => f > 0)) {
    const npv = (r: number) => fluxoAnual.reduce((v, f, i) => v + f / Math.pow(1 + r, i + 1), -p.invest);
    if (npv(0) > 0) {
      let lo = 0, hi = 10;
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
      tir = (lo + hi) / 2;
    }
  }
  return {
    kwhMes, sessoes, fatMes, custosMes, lucroMes, margem,
    fatAno: fatMes * 12, lucroAno: lucroMes * 12, lucroAno1,
    fluxo, acumulado10, payback, vpl, tir, seguroMes, fixosMes,
    ativacaoMes: sessoes * p.ativacao, custoEnergiaMes: custoEnergia,
    gatewayMes: fatMes * p.gateway, impostoMes: fatMes * p.imposto, manutMes: fatMes * p.manut,
  };
}

// ── o simulador da LP, para a conta de referência do estudo ────────────────
// Cópia do CONFIGS, do CARGAS e do params() de dashboard/public/io/eletroposto.
// `max` é o teto do SIMULADOR, de propósito mais conservador que a máquina.

export const CONFIGS_EP: Record<number, { invest: number; bicos: number; max: number }> = {
  60: { invest: 135000, bicos: 2, max: 20 },
  80: { invest: 145000, bicos: 2, max: 30 },
  120: { invest: 195000, bicos: 2, max: 40 },
};

/** kWh por recarga. Rodovia enche mais: o motorista para porque precisa seguir. */
export const CARGAS_EP = { cidade: 20, rodovia: 35 } as const;

/** Janela de movimento da seção Rotatividade. Premissa, não medição. */
export const JANELA_H = 12;

/** As premissas que o params() da LP passa ao cálculo (menos carros, carga e invest). */
export const PREMISSAS_LP = {
  precoKwh: 2.35, custoKwh: 0.70, ativacao: 1.20,
  gateway: 0.14, arrend: 0, manut: 0.001, imposto: 0.06,
  assinat: 0, fixos: 300, ocupIni: 0.5, mesesRampa: 24, taxaDesc: 0.1425,
} as const;

/**
 * 160 e 240 kW saem sob consulta na LP, sem preço: a conta usa a de 120. Potência
 * que não existe no simulador cai na configuração de baixo, nunca na de cima: o
 * consultor lê o investimento em voz alta e arredondar para cima infla o número.
 */
export function configDoKw(kw: number): number {
  if (CONFIGS_EP[kw]) return kw;
  if (kw > 120) return 120;
  if (kw > 80) return 80;
  return 60;
}

/** Cópia do rotativ() da LP: dois bicos ocupados dividem a potência, 12 h de janela. */
export function tetoFisico(kw: number, carga: number): number {
  const k = configDoKw(kw);
  const c = CONFIGS_EP[k];
  const min1 = carga / k * 60;
  const min2 = min1 * c.bicos;
  const cap = Math.floor(c.bicos * (JANELA_H * 60) / min2);
  return Math.min(c.max, cap);
}

/**
 * Menor número de recargas por dia que paga o investimento em `meses`, dentro do
 * que o carregador aguenta. `null` quando nem o teto paga.
 */
export function recargasParaPagar(
  p: Omit<ParamsEletro, 'carros'>, teto: number, meses = 36,
): number | null {
  for (let carros = 1; carros <= teto; carros++) {
    const { payback } = computeEletro({ ...p, carros });
    if (payback !== null && payback * 12 <= meses) return carros;
  }
  return null;
}

export interface CenarioConta {
  carros: number;
  fatMes: number;
  lucroMes: number;
  payback: number | null;
  fluxo: number[];
}

export interface ContaReferencia {
  kw: number;
  invest: number;
  carga: number;
  teto_fisico: number;
  piso: CenarioConta;
  base: CenarioConta;
  teto: CenarioConta;
  recargas_36m: number | null;
  premissas: typeof PREMISSAS_LP;
}

/**
 * A conta do estudo, com o que o lead simulou na LP. Sem a linha "Simulou", vale o
 * que o simulador abre: 80 kW e 10 carros por dia. Piso e teto são os mesmos ±33%
 * da apresentação (apresentacaoController), com o teto limitado pela máquina.
 */
export function contaDeReferencia(
  e: { kw?: number | null; carros?: number | null; rodovia?: boolean },
): ContaReferencia {
  const kw = configDoKw(Number(e.kw) || 80);
  const cfg = CONFIGS_EP[kw];
  const carga = e.rodovia ? CARGAS_EP.rodovia : CARGAS_EP.cidade;
  const teto_fisico = tetoFisico(kw, carga);
  const carrosBase = Math.min(teto_fisico, Math.max(1, Math.round(Number(e.carros) || 10)));

  const base: Omit<ParamsEletro, 'carros'> = { ...PREMISSAS_LP, carga, invest: cfg.invest };
  const cenario = (carros: number): CenarioConta => {
    const r = computeEletro({ ...base, carros });
    return { carros, fatMes: r.fatMes, lucroMes: r.lucroMes, payback: r.payback, fluxo: r.fluxo };
  };

  return {
    kw,
    invest: cfg.invest,
    carga,
    teto_fisico,
    piso: cenario(Math.max(1, Math.round(carrosBase * 0.67))),
    base: cenario(carrosBase),
    teto: cenario(Math.min(Math.round(carrosBase * 1.33), teto_fisico)),
    recargas_36m: recargasParaPagar(base, teto_fisico, 36),
    premissas: PREMISSAS_LP,
  };
}
