// ============= DADOS SOLARES DE REFERÊNCIA =============
// HSP = Horas de Sol Pleno (kWh/m²/dia médio anual)
// Tarifa = R$/kWh residencial B1 (2026, base ANEEL)
// Portado de api/src/services/propostaSolarData.ts

const HSP_TARIFA_BR = {
  AC:{hsp:4.6,tarifa:0.95}, AM:{hsp:4.5,tarifa:0.91}, AP:{hsp:4.6,tarifa:0.92},
  PA:{hsp:4.8,tarifa:0.88}, RO:{hsp:4.7,tarifa:0.93}, RR:{hsp:4.7,tarifa:0.94},
  TO:{hsp:5.4,tarifa:0.96},
  AL:{hsp:5.7,tarifa:0.92}, BA:{hsp:5.6,tarifa:0.99}, CE:{hsp:5.9,tarifa:0.94},
  MA:{hsp:5.6,tarifa:0.85}, PB:{hsp:5.8,tarifa:0.91}, PE:{hsp:5.7,tarifa:0.95},
  PI:{hsp:5.8,tarifa:0.93}, RN:{hsp:5.8,tarifa:0.91}, SE:{hsp:5.6,tarifa:0.92},
  DF:{hsp:5.5,tarifa:0.98}, GO:{hsp:5.5,tarifa:0.97}, MS:{hsp:5.3,tarifa:0.96},
  MT:{hsp:5.4,tarifa:0.94},
  ES:{hsp:5.3,tarifa:1.02}, MG:{hsp:5.4,tarifa:1.20}, RJ:{hsp:5.1,tarifa:1.06},
  SP:{hsp:5.0,tarifa:0.92},
  PR:{hsp:4.8,tarifa:0.89}, RS:{hsp:4.7,tarifa:0.95}, SC:{hsp:4.6,tarifa:0.85},
};

const HSP_CIDADE = {
  'sao paulo':4.95,'campinas':5.25,'ribeirao preto':5.65,'sao jose dos campos':5.10,
  'sorocaba':5.20,'santos':4.85,'sao bernardo do campo':4.95,'osasco':4.95,
  'guarulhos':4.95,'piracicaba':5.30,'bauru':5.45,'presidente prudente':5.55,
  'belo horizonte':5.45,'uberlandia':5.65,'uberaba':5.70,'juiz de fora':5.20,
  'contagem':5.45,'montes claros':5.95,'governador valadares':5.55,'ipatinga':5.40,
  'rio de janeiro':5.05,'niteroi':5.10,'campos dos goytacazes':5.25,'petropolis':4.95,
  'nova iguacu':5.05,'duque de caxias':5.05,
  'vitoria':5.30,'vila velha':5.30,'serra':5.30,'cariacica':5.30,
  'salvador':5.65,'feira de santana':5.75,'vitoria da conquista':5.85,'juazeiro':6.20,
  'barreiras':5.95,'ilheus':5.50,
  'recife':5.70,'petrolina':6.20,'caruaru':5.80,'jaboatao dos guararapes':5.70,
  'fortaleza':5.90,'sobral':6.10,'juazeiro do norte':6.10,
  'joao pessoa':5.85,'campina grande':5.85,'natal':5.95,'mossoro':6.15,
  'maceio':5.65,'aracaju':5.55,'sao luis':5.55,'teresina':5.85,
  'goiania':5.55,'anapolis':5.50,'brasilia':5.55,'cuiaba':5.55,
  'campo grande':5.40,'dourados':5.30,
  'curitiba':4.65,'londrina':5.15,'maringa':5.20,'cascavel':5.05,
  'florianopolis':4.55,'joinville':4.45,'blumenau':4.45,'chapeco':4.85,
  'porto alegre':4.75,'caxias do sul':4.80,'pelotas':4.65,'santa maria':4.85,
  'manaus':4.55,'belem':4.85,'palmas':5.50,'porto velho':4.75,
  'rio branco':4.65,'macapa':4.65,'boa vista':4.75,
};

const VARIACAO_MENSAL = {
  norte: [1.05,1.00,1.02,0.98,0.95,0.92,0.95,1.00,1.04,1.08,1.07,1.06],
  sul:   [1.15,1.10,1.05,0.95,0.85,0.78,0.80,0.92,1.00,1.12,1.15,1.13],
};

const ESTADOS_NORTE_NE = ['AC','AM','AP','PA','RO','RR','TO','AL','BA','CE','MA','PB','PE','PI','RN','SE','GO','DF','MT','MS'];

const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function normalizeCidade(c) {
  return (c || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

function getRef(uf, cidade) {
  const u = (uf || '').trim().toUpperCase();
  const stateRef = HSP_TARIFA_BR[u] || { hsp: 5.2, tarifa: 0.95 };
  if (!cidade) return stateRef;
  const cityHsp = HSP_CIDADE[normalizeCidade(cidade)];
  return cityHsp ? { hsp: cityHsp, tarifa: stateRef.tarifa } : stateRef;
}

function variacaoMensal(uf) {
  const u = (uf || '').trim().toUpperCase();
  return ESTADOS_NORTE_NE.includes(u) ? VARIACAO_MENSAL.norte : VARIACAO_MENSAL.sul;
}

function geracaoMensal(kwp, uf, cidade) {
  const ref = getRef(uf, cidade);
  const variacao = variacaoMensal(uf);
  const efic = 0.80;
  const baseAnual = kwp * ref.hsp * 365 * efic;
  const mediaMensal = baseAnual / 12;
  return variacao.map(v => Math.round(mediaMensal * v));
}

function calcPayback(investimento, geracaoAnualKwh, tarifaInicial, inflacaoAA) {
  if (inflacaoAA == null) inflacaoAA = 0.06;
  let acumulado = 0;
  let paybackMeses = 0;
  let economiaAno1 = 0;
  for (let ano = 1; ano <= 25; ano++) {
    const tarifaAno = tarifaInicial * Math.pow(1 + inflacaoAA, ano - 1);
    const economiaAno = geracaoAnualKwh * tarifaAno;
    if (ano === 1) economiaAno1 = economiaAno;
    if (paybackMeses === 0 && acumulado + economiaAno >= investimento) {
      const restante = investimento - acumulado;
      const mesesNoAno = Math.ceil((restante / economiaAno) * 12);
      paybackMeses = (ano - 1) * 12 + mesesNoAno;
    }
    acumulado += economiaAno;
  }
  return {
    paybackMeses: paybackMeses || 0,
    paybackAnos: paybackMeses ? (paybackMeses / 12) : 0,
    acumulado25anos: Math.round(acumulado),
    economiaAno1: Math.round(economiaAno1),
  };
}

// Modelo realista de economia/payback com inflação dual:
// - "Sem solar" = consumo × tarifa × 12 (tarifa cresce inflTarifa a.a.)
// - "Com solar" = taxa mínima × 12 (cresce inflTaxaMin a.a. — mais lenta)
// Economia = diff entre as duas curvas. Mais honesto que geração × tarifa.
function calcModeloRealista(consumoKwh, tarifa, taxaMin, investimento, inflTarifa, inflTaxaMin) {
  if (inflTarifa == null) inflTarifa = 0.06;
  if (inflTaxaMin == null) inflTaxaMin = 0.06;
  let semAcum = 0, comAcum = 0;
  const semSolarAcum = [], comSolarAcum = [];
  let paybackMeses = 0;
  for (let a = 1; a <= 25; a++) {
    const ftar = Math.pow(1 + inflTarifa, a - 1);
    const fmin = Math.pow(1 + inflTaxaMin, a - 1);
    const semAno = consumoKwh * 12 * tarifa * ftar;
    const comAno = taxaMin * 12 * fmin;
    const ecoAno = semAno - comAno;
    const ecoAcum = semAcum - comAcum;
    if (paybackMeses === 0 && ecoAcum + ecoAno >= investimento && ecoAno > 0) {
      const restante = investimento - ecoAcum;
      paybackMeses = (a - 1) * 12 + Math.ceil((restante / ecoAno) * 12);
    }
    semAcum += semAno;
    comAcum += comAno;
    semSolarAcum.push(Math.round(semAcum));
    comSolarAcum.push(Math.round(comAcum));
  }
  return {
    semSolarAcum: semSolarAcum,
    comSolarAcum: comSolarAcum,
    economia25: Math.round(semAcum - comAcum),
    paybackMeses: paybackMeses || 0,
    paybackAnos: paybackMeses ? (paybackMeses / 12) : 0,
    breakdown: [1, 5, 10, 25].map(function (a) { return semSolarAcum[a - 1] - comSolarAcum[a - 1]; }),
    economiaMensal: Math.max(0, Math.round(consumoKwh * tarifa - taxaMin)),
  };
}

// Formata meses como "X anos e Y meses" (mais natural que 1,8 anos)
function paybackTexto(meses) {
  if (!meses) return '—';
  var anos = Math.floor(meses / 12);
  var m = meses % 12;
  if (anos === 0) return m + ' ' + (m === 1 ? 'mês' : 'meses');
  if (m === 0) return anos + ' ' + (anos === 1 ? 'ano' : 'anos');
  return anos + ' ' + (anos === 1 ? 'ano' : 'anos') + ' e ' + m + ' ' + (m === 1 ? 'mês' : 'meses');
}

function renderGraficoMensalSVG(mensal, opts) {
  opts = opts || {};
  const c1 = opts.c1 || '#0d2d5e';
  const c2 = opts.c2 || '#4a90e2';
  const W = 600, H = 240, P = { top: 24, right: 16, bottom: 50, left: 48 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const barCount = 12;
  const barGap = 6;
  const barW = (innerW - barGap * (barCount - 1)) / barCount;
  const maxKwh = Math.max.apply(null, mensal.concat([1]));
  const yTicks = 4;
  const fmtN = n => new Intl.NumberFormat('pt-BR').format(Math.round(n));

  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round((maxKwh * i) / yTicks);
    const y = P.top + innerH - (innerH * i) / yTicks;
    return `<line x1="${P.left}" y1="${y}" x2="${P.left + innerW}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>` +
           `<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#9CA3AF">${fmtN(v)}</text>`;
  }).join('');

  const bars = mensal.map((kwh, i) => {
    const x = P.left + i * (barW + barGap);
    const h = (kwh / maxKwh) * innerH;
    const y = P.top + innerH - h;
    return `<g>` +
      `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="url(#gradSolar)"/>` +
      `<text x="${x + barW/2}" y="${P.top + innerH + 16}" text-anchor="middle" font-size="11" fill="#6B7280">${MESES_ABREV[i]}</text>` +
      `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${c1}">${fmtN(kwh)}</text>` +
    `</g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gradSolar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    ${yLines}
    ${bars}
  </svg>`;
}

// Formato BRL curto: R$ 100k, R$ 1,2M
function pBRLshort(n) {
  if (n >= 1000000) return 'R$ ' + (n / 1000000).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1000) return 'R$ ' + Math.round(n / 1000) + 'k';
  return 'R$ ' + Math.round(n);
}
function pBRL(n) {
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}

// SVG comparativo 25 anos: 2 linhas (sem solar vermelha vs com solar verde)
// + área verde de economia preenchida. Espelha propostaSolarM1 da plataforma.
// Retorna { html, semTotal, comTotal, economia25 } ou null se faltar dado.
function renderChart25SVG(d) {
  const consumoKwh = Number(d.consumoKwh) || 0;
  const tarifa = Number(d.tarifa) || 0;
  const taxaMin = Number(d.taxaMin) || 0;
  const inflTarifa = Number(d.inflTarifa) || 0.06;
  const inflTaxaMin = Number(d.inflTaxaMin) || 0.06;
  if (consumoKwh <= 0 || tarifa <= 0 || taxaMin <= 0) return null;

  const NUM_ANOS = 25;
  const semSolarAcum = [];
  const comSolarAcum = [];
  let sem = 0, com = 0;
  for (let a = 1; a <= NUM_ANOS; a++) {
    const fatorTarifa = Math.pow(1 + inflTarifa, a - 1);
    const fatorMin = Math.pow(1 + inflTaxaMin, a - 1);
    sem += consumoKwh * 12 * tarifa * fatorTarifa;
    com += taxaMin * 12 * fatorMin;
    semSolarAcum.push(Math.round(sem));
    comSolarAcum.push(Math.round(com));
  }
  const semTotal = semSolarAcum[NUM_ANOS - 1];
  const comTotal = comSolarAcum[NUM_ANOS - 1];
  const economia25 = semTotal - comTotal;

  const CW = 700, CH = 280, CP = { top: 24, right: 20, bottom: 50, left: 70 };
  const cInnerW = CW - CP.left - CP.right;
  const cInnerH = CH - CP.top - CP.bottom;
  const yMax = Math.max.apply(null, semSolarAcum.concat([1]));

  const cYTicks = 5;
  const yLinesArr = [];
  for (let i = 0; i <= cYTicks; i++) {
    const v = (yMax * i) / cYTicks;
    const y = CP.top + cInnerH - (cInnerH * i) / cYTicks;
    yLinesArr.push(
      '<line x1="' + CP.left + '" y1="' + y + '" x2="' + (CP.left + cInnerW) + '" y2="' + y + '" stroke="#E5E7EB" stroke-width="1"/>' +
      '<text x="' + (CP.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#9CA3AF">' + pBRLshort(v) + '</text>'
    );
  }
  const cYLines = yLinesArr.join('\n');

  const xCoord = (i) => CP.left + (cInnerW * i) / (NUM_ANOS - 1);
  const yCoord = (v) => CP.top + cInnerH - (cInnerH * v) / yMax;

  const semPath = semSolarAcum.map((v, i) => (i === 0 ? 'M' : 'L') + ' ' + xCoord(i).toFixed(1) + ' ' + yCoord(v).toFixed(1)).join(' ');
  const comPath = comSolarAcum.map((v, i) => (i === 0 ? 'M' : 'L') + ' ' + xCoord(i).toFixed(1) + ' ' + yCoord(v).toFixed(1)).join(' ');
  const semForward = semPath;
  const comReverse = [...comSolarAcum].reverse().map((v, i) => {
    const idx = NUM_ANOS - 1 - i;
    return 'L ' + xCoord(idx).toFixed(1) + ' ' + yCoord(v).toFixed(1);
  }).join(' ');
  const areaEconomia = semForward + ' ' + comReverse + ' Z';

  const cXLabels = [1, 5, 10, 15, 20, 25].map(a => {
    const i = a - 1;
    return '<text x="' + xCoord(i).toFixed(1) + '" y="' + (CP.top + cInnerH + 18).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#6B7280" font-weight="600">Ano ' + a + '</text>';
  }).join('\n');

  const html = '<svg viewBox="0 0 ' + CW + ' ' + CH + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="gEco" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#10B981" stop-opacity="0.35"/>' +
    '<stop offset="100%" stop-color="#10B981" stop-opacity="0.10"/>' +
    '</linearGradient></defs>' +
    cYLines +
    '<path d="' + areaEconomia + '" fill="url(#gEco)" stroke="none"/>' +
    '<path d="' + semPath + '" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<path d="' + comPath + '" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    cXLabels +
    '</svg>';

  return { html: html, semTotal: semTotal, comTotal: comTotal, economia25: economia25 };
}
