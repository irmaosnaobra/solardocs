// Desenhos do Moderno (propostaSolar, modelos 2 e 3): gráficos e ilustrações em SVG puro, sem JS (o PDF roda
// com JS desligado). Só desenho: os números chegam prontos de propostaSolarCalculos.ts e do templateService.
import { pNum } from '../propostaSolarBase';

const CINZA_SEM = '#9AA0A9';
const GRADE = '#E6E8EC';
const TXT_EIXO = '#6B7280';

/** "R$ 48 mil", "R$ 1,2 mi": rótulo de eixo em português, sem "k" nem "M". */
export function brlCurto(n: number): string {
  const v = Math.abs(n);
  const sinal = n < 0 ? '-' : '';
  if (v >= 1_000_000) return `${sinal}R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `${sinal}R$ ${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`;
  return `${sinal}R$ ${Math.round(v)}`;
}

/** Topo "redondo" do eixo: 1, 2, 2,5 ou 5 vezes a potência de 10 logo acima do máximo. */
function teto(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** Barras da geração estimada de cada mês e a linha tracejada do consumo médio (não há consumo mês a mês). */
export function svgGeracaoConsumo(mensal: number[], meses: readonly string[], consumo: number, c1: string): string {
  const W = 686, H = 186, P = { t: 16, r: 8, b: 24, l: 44 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const topo = teto(Math.max(...mensal, consumo, 1) * 1.08);
  const y = (v: number) => P.t + ih - (ih * v) / topo;
  const passo = iw / 12, bw = passo * 0.56;
  const grade = [0, 1, 2, 3, 4].map((i) => {
    const v = (topo * i) / 4, yy = y(v).toFixed(1);
    return `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke="${GRADE}" stroke-width="1"/>`
      + `<text x="${P.l - 8}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${TXT_EIXO}">${pNum(v)}</text>`;
  }).join('');
  const barras = mensal.map((v, i) => {
    const x = P.l + passo * i + (passo - bw) / 2, yy = y(v);
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(P.t + ih - yy).toFixed(1)}" rx="2" fill="${c1}"/>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${(yy - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="#374151" font-weight="600">${pNum(v)}</text>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${TXT_EIXO}">${meses[i]}</text>`;
  }).join('');
  const linha = consumo > 0
    ? `<line x1="${P.l}" x2="${W - P.r}" y1="${y(consumo).toFixed(1)}" y2="${y(consumo).toFixed(1)}" stroke="#12161E" stroke-width="1.5" stroke-dasharray="5 4"/>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Geração estimada por mês${consumo > 0 ? ' e consumo médio' : ''}">${grade}${barras}${linha}</svg>`;
}

/** Conta acumulada em 25 anos sem e com o sistema. A faixa entre as duas linhas é a economia. */
export function svgCurvas(sem: number[], com: number[], c1: string): string {
  const W = 686, H = 236, P = { t: 14, r: 112, b: 26, l: 62 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b, n = sem.length;
  const topo = teto(Math.max(...sem, 1));
  const x = (i: number) => P.l + (iw * i) / (n - 1);
  const y = (v: number) => P.t + ih - (ih * v) / topo;
  const pts = (s: number[]) => s.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const grade = [0, 1, 2, 3, 4].map((i) => {
    const v = (topo * i) / 4, yy = y(v).toFixed(1);
    return `<line x1="${P.l}" x2="${P.l + iw}" y1="${yy}" y2="${yy}" stroke="${GRADE}" stroke-width="1"/>`
      + `<text x="${P.l - 8}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${TXT_EIXO}">${i === 0 ? '0' : brlCurto(v)}</text>`;
  }).join('');
  const anos = [1, 5, 10, 15, 20, 25].filter((a) => a <= n).map((a) =>
    `<text x="${x(a - 1).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${TXT_EIXO}">Ano ${a}</text>`).join('');
  const area = `<polygon points="${[...pts(sem), ...pts(com).reverse()].join(' ')}" fill="${c1}" fill-opacity="0.1"/>`;
  const ult = n - 1;
  // Rótulos no fim das linhas; se ficarem colados, o de baixo desce.
  const ySem = y(sem[ult]), yCom = Math.max(y(com[ult]), ySem + 34);
  const rot = (yy: number, cor: string, t1: string, t2: string) =>
    `<circle cx="${x(ult).toFixed(1)}" cy="${yy.toFixed(1)}" r="3.5" fill="${cor}"/>`
    + `<text x="${(x(ult) + 10).toFixed(1)}" y="${(yy - 2).toFixed(1)}" font-size="11" font-weight="700" fill="#12161E">${t1}</text>`
    + `<text x="${(x(ult) + 10).toFixed(1)}" y="${(yy + 12).toFixed(1)}" font-size="10" fill="${TXT_EIXO}">${t2}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Conta de luz acumulada em ${n} anos, sem e com energia solar">${grade}${area}`
    + `<polyline points="${pts(sem).join(' ')}" fill="none" stroke="${CINZA_SEM}" stroke-width="2" stroke-linejoin="round"/>`
    + `<polyline points="${pts(com).join(' ')}" fill="none" stroke="${c1}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `${anos}${rot(ySem, CINZA_SEM, brlCurto(sem[ult]), 'Sem o sistema')}${rot(yCom, c1, brlCurto(com[ult]), 'Com o sistema')}</svg>`;
}

/** Barra do saldo na tabela ano a ano: negativo à esquerda do zero (cinza), positivo à direita (cor da empresa). */
export function barraSaldo(saldo: number, minimo: number, maximo: number, c1: string): string {
  const W = 120, H = 10, faixa = Math.max(1, Math.abs(minimo) + Math.max(0, maximo));
  const zero = (W * Math.abs(minimo)) / faixa;
  const larg = (W * Math.abs(saldo)) / faixa;
  const x = saldo < 0 ? zero - larg : zero;
  return `<svg class="sb" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`
    + `<rect x="0" y="4.5" width="${W}" height="1" fill="${GRADE}"/>`
    + `<rect x="${x.toFixed(1)}" y="1" width="${Math.max(1, larg).toFixed(1)}" height="8" rx="1.5" fill="${saldo < 0 ? '#C4C8CF' : c1}"/>`
    + `<rect x="${(zero - 0.5).toFixed(1)}" y="0" width="1" height="${H}" fill="#12161E"/></svg>`;
}

// ── Como funciona: um diagrama só (sol, módulos, inversor, casa, rede), traço único de 1,6 ──
const ICONES: Record<string, string> = {
  modulo: '<path d="M-14 8 L-9 -8 L14 -8 L9 8 Z"/><path d="M-11.5 0 L11.5 0 M-2.5 -8 L-5 8 M5.5 -8 L2.5 8"/><path d="M0 8 V13 M-5 13 H5"/>',
  inversor: '<rect x="-11" y="-13" width="22" height="26" rx="3"/><path d="M-6 -3 C-4 -8 -2 -8 0 -3 S4 2 6 -3"/><path d="M-5 7 H5"/>',
  casa: '<path d="M-13 -1 L0 -12 L13 -1"/><path d="M-9 -4 V12 H9 V-4"/><path d="M-3 12 V4 H3 V12"/>',
  rede: '<path d="M0 -14 V14 M-10 -9 H10 M-7 -3 H7"/><path d="M-10 -9 L-12 -5 M10 -9 L12 -5"/><path d="M-6 14 L0 2 L6 14"/>',
};

export function svgComoFunciona(c1: string): string {
  const W = 686, H = 92, nos = ['modulo', 'inversor', 'casa', 'rede'];
  const passo = W / nos.length, cy = 56;
  const cx = (i: number) => passo * i + passo / 2;
  const sol = `<g transform="translate(${cx(0) - 34},22)" stroke="${c1}" stroke-width="1.6" fill="none" stroke-linecap="round">`
    + '<circle r="6"/><path d="M0 -11 V-14 M0 11 V14 M-11 0 H-14 M11 0 H14 M-8 -8 L-10 -10 M8 8 L10 10 M-8 8 L-10 10 M8 -8 L10 -10"/></g>';
  const ligacoes = nos.slice(0, -1).map((_, i) => {
    const x1 = cx(i) + 34, x2 = cx(i + 1) - 34;
    return `<path d="M${x1} ${cy} H${x2}" stroke="${c1}" stroke-width="1.6" stroke-dasharray="${i === 2 ? '4 4' : '0'}" fill="none"/>`
      + `<path d="M${x2 - 6} ${cy - 5} L${x2} ${cy} L${x2 - 6} ${cy + 5}" stroke="${c1}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const circulos = nos.map((k, i) =>
    `<circle cx="${cx(i)}" cy="${cy}" r="28" fill="#fff" stroke="${GRADE}" stroke-width="1.5"/>`
    + `<g transform="translate(${cx(i)},${cy})" stroke="${c1}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">${ICONES[k]}</g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${sol}${ligacoes}${circulos}</svg>`;
}

/** Desenho da capa: um arranjo de módulos em perspectiva, em traço claro sobre a cor da empresa. */
export function svgArranjoCapa(): string {
  const linhas: string[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const x = c * 74, y = r * 46;
      linhas.push(`<rect x="${x}" y="${y}" width="68" height="40" rx="1.5"/>`
        + `<path d="M${x} ${y + 13.3} H${x + 68} M${x} ${y + 26.6} H${x + 68} M${x + 22.6} ${y} V${y + 40} M${x + 45.3} ${y} V${y + 40}" stroke-opacity="0.45"/>`);
    }
  }
  return `<svg class="arranjo" viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<g transform="translate(120 40) skewX(-24) scale(1 0.9)" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.32)" stroke-width="1">${linhas.join('')}</g></svg>`;
}
