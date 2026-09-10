/* ─────────────────────────────────────────────────────────────────────────────
   GRÁFICOS DO RADAR — SVG puro, sem biblioteca.

   Por que sem biblioteca: a página é servida estática do próprio domínio e o
   resto do /gerador é assim. Um CDN a mais é um ponto de falha a mais numa tela
   que o dono deixa aberta o dia inteiro.

   REGRAS DE COR (não são gosto, são função):
   · funil e etapa são PROGRESSÃO → rampa sequencial de UMA cor, clara→escura.
     Oito cores categóricas num funil sugeririam oito coisas sem relação.
   · canal é ESTADO → paleta de status, sempre com rótulo do lado. Cor nunca
     carrega o significado sozinha.
   · toques por hora é UMA série → uma cor, sem legenda: o título já a nomeia.

   Toda forma com marca tem tooltip no hover. Gráfico em HTML que não responde
   ao mouse desperdiça o meio.
   ───────────────────────────────────────────────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}) => {
  const e = document.createElementNS(NS, t);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
};
const fmt = n => Number(n || 0).toLocaleString('pt-BR');

// Rampa sequencial azul (clara → escura). Monotônica em luminosidade, que é o
// que uma rampa sequencial precisa provar — o validador categórico não se aplica.
export const RAMPA = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];
// Status: reservadas, nunca reaproveitadas como "série 5".
export const STATUS = { bom: '#0ca30c', atencao: '#fab219', serio: '#ec835a', critico: '#d03b3b', neutro: '#4A5772' };

const degrau = (i, n) => RAMPA[Math.min(RAMPA.length - 1, Math.round(i * (RAMPA.length - 1) / Math.max(1, n - 1)))];

// ── tooltip único, reaproveitado por todos os gráficos ──────────────────────
let dica;
function mostrar(x, y, html) {
  if (!dica) {
    dica = document.createElement('div');
    dica.className = 'dica';
    document.body.appendChild(dica);
  }
  dica.innerHTML = html;
  dica.style.display = 'block';
  const r = dica.getBoundingClientRect();
  dica.style.left = Math.min(window.innerWidth - r.width - 12, Math.max(8, x - r.width / 2)) + 'px';
  dica.style.top = Math.max(8, y - r.height - 14) + 'px';
}
function esconder() { if (dica) dica.style.display = 'none'; }

/* ── FUNIL ────────────────────────────────────────────────────────────────────
   Barras horizontais em rampa, com a taxa de passagem ENTRE as etapas. A queda
   entre dois degraus é a informação: mostrar só o total de cada etapa esconde
   onde o funil vaza. Etapa que não dá pra medir vira faixa vazada com "—" —
   zero medido e zero desconhecido não podem ter o mesmo desenho. */
export function funil(alvo, etapas) {
  alvo.innerHTML = '';
  const validos = etapas.map(e => Number(e.valor) || 0);
  const topo = Math.max(1, ...validos);
  const LARG = 100, ALT_L = 38, GAP = 13;

  etapas.forEach((e, i) => {
    const nulo = e.valor === null || e.valor === undefined;
    const v = nulo ? 0 : Number(e.valor);
    const pct = nulo ? 0 : (100 * v / topo);
    const cor = degrau(i, etapas.length);

    const linha = document.createElement('div');
    linha.className = 'fn';
    const passagem = i > 0 && !nulo && validos[i - 1] > 0
      ? (100 * v / validos[i - 1]) : null;

    linha.innerHTML = `
      <div class="fn-rot">
        <b>${e.nome}</b>
        ${e.de ? `<small>${e.de}</small>` : ''}
      </div>
      <div class="fn-tr">
        <i style="width:${nulo ? 0 : Math.max(v > 0 ? 1.5 : 0, pct)}%;background:${cor}"></i>
        ${nulo ? '<u class="fn-vazio">não medido ainda</u>' : ''}
      </div>
      <div class="fn-val" style="color:${nulo ? 'var(--faint)' : v ? cor : 'var(--faint)'}">
        ${nulo ? '—' : fmt(v)}
        ${passagem !== null ? `<small>${passagem.toFixed(passagem < 10 ? 1 : 0)}% da anterior</small>` : ''}
      </div>`;

    if (!nulo) {
      linha.addEventListener('mousemove', ev => mostrar(ev.clientX, ev.clientY,
        `<b>${e.nome}</b><br>${fmt(v)} ${v === 1 ? 'contato' : 'contatos'}` +
        (passagem !== null ? `<br><span class="dim">${passagem.toFixed(1)}% vieram da etapa anterior</span>` : '') +
        (validos[0] ? `<br><span class="dim">${(100 * v / validos[0]).toFixed(1)}% do topo do funil</span>` : '')));
      linha.addEventListener('mouseleave', esconder);
    }
    alvo.appendChild(linha);
  });
}

/* ── SÉRIE TEMPORAL ───────────────────────────────────────────────────────────
   Área + linha, uma série, com crosshair. Área porque o volume acumulado do dia
   é a leitura natural; linha por cima porque a área sozinha esconde a variação
   quando os números são pequenos. */
export function porHora(alvo, baldes, horaAtual) {
  alvo.innerHTML = '';
  const W = 720, H = 190, ML = 34, MR = 12, MT = 14, MB = 26;
  const iw = W - ML - MR, ih = H - MT - MB;
  const topo = Math.max(2, ...baldes);
  const x = h => ML + (h / 23) * iw;
  const y = v => MT + ih - (v / topo) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'g', preserveAspectRatio: 'none' });

  // grade recessiva: 3 linhas, nada mais
  for (let k = 0; k <= 2; k++) {
    const v = Math.round(topo * k / 2), yy = y(v);
    svg.appendChild(el('line', { x1: ML, x2: W - MR, y1: yy, y2: yy, class: 'grade' }));
    const t = el('text', { x: ML - 7, y: yy + 4, class: 'eixo', 'text-anchor': 'end' });
    t.textContent = v; svg.appendChild(t);
  }

  const pts = baldes.map((v, h) => [x(h), y(v)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');

  const grad = el('linearGradient', { id: 'gArea', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.appendChild(el('stop', { offset: '0%', 'stop-color': RAMPA[3], 'stop-opacity': '.42' }));
  grad.appendChild(el('stop', { offset: '100%', 'stop-color': RAMPA[3], 'stop-opacity': '0' }));
  const defs = el('defs'); defs.appendChild(grad); svg.appendChild(defs);

  svg.appendChild(el('path', { d: `${d} L ${x(23)} ${y(0)} L ${x(0)} ${y(0)} Z`, fill: 'url(#gArea)' }));
  svg.appendChild(el('path', { d, fill: 'none', stroke: RAMPA[3], 'stroke-width': '2',
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // marca a hora atual — dá a leitura de "onde estamos no dia"
  if (horaAtual >= 0) {
    svg.appendChild(el('line', { x1: x(horaAtual), x2: x(horaAtual), y1: MT, y2: MT + ih, class: 'agora' }));
  }

  baldes.forEach((v, h) => {
    if (h % 3 === 0) {
      const t = el('text', { x: x(h), y: H - 7, class: 'eixo', 'text-anchor': 'middle' });
      t.textContent = String(h).padStart(2, '0'); svg.appendChild(t);
    }
    if (v > 0) svg.appendChild(el('circle', { cx: x(h), cy: y(v), r: '3.5', fill: RAMPA[3],
      stroke: 'var(--bg2)', 'stroke-width': '2' }));
  });

  // faixa invisível por hora: alvo de mouse maior que a marca
  const cross = el('line', { x1: 0, x2: 0, y1: MT, y2: MT + ih, class: 'cross', opacity: '0' });
  svg.appendChild(cross);
  baldes.forEach((v, h) => {
    const hit = el('rect', { x: x(h) - iw / 46, y: MT, width: iw / 23, height: ih, fill: 'transparent' });
    hit.addEventListener('mousemove', ev => {
      cross.setAttribute('x1', x(h)); cross.setAttribute('x2', x(h)); cross.setAttribute('opacity', '1');
      mostrar(ev.clientX, ev.clientY,
        `<b>${String(h).padStart(2, '0')}:00</b><br>${v} ${v === 1 ? 'toque' : 'toques'}`);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', '0'); esconder(); });
    svg.appendChild(hit);
  });

  alvo.appendChild(svg);
}

/* ── BARRA EMPILHADA (etapa = progressão) ─────────────────────────────────────
   Uma barra só, segmentos em rampa, 2px de respiro entre eles. Segmento pequeno
   demais pra rotular não recebe número em cima — vai pra legenda. */
export function empilhada(alvo, itens, total) {
  alvo.innerHTML = '';
  const t = Math.max(1, total || itens.reduce((s, i) => s + i.n, 0));
  const barra = document.createElement('div');
  barra.className = 'emp';
  itens.forEach((it, i) => {
    if (!it.n) return;
    const pct = 100 * it.n / t;
    const seg = document.createElement('i');
    seg.style.width = pct + '%';
    seg.style.background = it.cor || degrau(i, itens.length);
    if (pct > 7) seg.textContent = fmt(it.n);
    seg.addEventListener('mousemove', ev => mostrar(ev.clientX, ev.clientY,
      `<b>${it.rot}</b><br>${fmt(it.n)} · ${pct.toFixed(1)}%`));
    seg.addEventListener('mouseleave', esconder);
    barra.appendChild(seg);
  });
  alvo.appendChild(barra);

  const leg = document.createElement('div');
  leg.className = 'leg';
  leg.innerHTML = itens.filter(i => i.n).map((it, i) =>
    `<span><i style="background:${it.cor || degrau(i, itens.length)}"></i>${it.rot}
      <b>${fmt(it.n)}</b></span>`).join('');
  alvo.appendChild(leg);
}

/* ── MEDIDOR (opt-out contra o limite) ────────────────────────────────────────
   Bullet chart: a medida contra a faixa aceitável e o limite. Melhor que um
   número solto porque mostra QUANTO falta pra travar, não só onde está. */
export function medidor(alvo, valor, limite, faixas) {
  alvo.innerHTML = '';
  const W = 320, H = 54, ML = 4, MR = 4;
  const escala = Math.max(limite * 1.35, valor * 1.15, 1);
  const px = v => ML + (v / escala) * (W - ML - MR);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'g med' });
  faixas.forEach(f => {
    svg.appendChild(el('rect', {
      x: px(f.de), y: 14, width: Math.max(0, px(f.ate) - px(f.de)), height: 16,
      fill: f.cor, opacity: '.20', rx: '3',
    }));
  });

  const cor = valor >= limite ? STATUS.critico
    : valor >= limite / 2 ? STATUS.atencao : STATUS.bom;
  svg.appendChild(el('rect', { x: ML, y: 18, width: Math.max(3, px(valor) - ML), height: 8,
    fill: cor, rx: '4' }));
  // o limite: linha grossa, o marco que importa
  svg.appendChild(el('line', { x1: px(limite), x2: px(limite), y1: 10, y2: 34,
    stroke: STATUS.critico, 'stroke-width': '2.5' }));
  const lb = el('text', { x: px(limite), y: 47, class: 'eixo', 'text-anchor': 'middle', fill: STATUS.critico });
  lb.textContent = `trava em ${limite}%`;
  svg.appendChild(lb);
  const v0 = el('text', { x: ML, y: 9, class: 'eixo' });
  v0.textContent = '0%'; svg.appendChild(v0);

  alvo.appendChild(svg);
}
