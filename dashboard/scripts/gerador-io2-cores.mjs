#!/usr/bin/env node
/* GERADOR DO RECOLOR DO /GERADOR (reforma visual, fase 3a).

   Converte as cores do CSS do app (escrito para fundo escuro) no tema claro novo e escreve
   dashboard/public/gerador/ui/io2-cores-index.css. A saida e GERADA: nao se edita a mao. Excecoes decididas
   a mao moram em dashboard/scripts/gerador-io2-cores.regras.json (ao lado deste arquivo).

   Como funciona: serve os arquivos locais por HTTP (sem rede), abre /gerador/index.html num navegador
   headless, le document.styleSheets (o CSSOM ja resolveu @media, @supports, @container, :has e listas com
   virgula) e, para cada regra de TELA com declaracao de cor, emite a mesma regra, nos mesmos @media/@container,
   com o seletor prefixado por  html.io2[data-mode="app"]:not(#_):not(#_)  e SO as declaracoes de cor, com o
   valor novo. Pula @media print, documentos (lista de exclusao) e cores de status vindas de dado.
   O mapa e por PAPEL (texto, fundo, borda, sombra), em OKLCH, nao hex por hex. Idempotente: valores que ja sao
   de tema claro ficam como estao, var(--...) nao e tocado, e a propria folha gerada (pasta /gerador/ui/) nunca
   e lida como entrada.

   Sem dependencia nova: recebe por parametro o puppeteer-core e o navegador.

   Uso (a partir da pasta dashboard/):
     node scripts/gerador-io2-cores.mjs --raiz <pasta que contem dashboard/public> \
          --puppeteer <pasta do pacote puppeteer-core> --navegador <msedge.exe ou chrome.exe> \
          [--pagina /gerador/index.html] [--saida <css>] [--regras <json>] [--relatorio <json>]
   Exemplo (Windows, caminhos genericos):
     node scripts/gerador-io2-cores.mjs --raiz C:/caminho/do/repositorio \
          --puppeteer C:/caminho/node_modules/puppeteer-core \
          --navegador "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
   Sem --saida grava em <raiz>/dashboard/public/gerador/ui/io2-cores-index.css. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) A[k.slice(2)] = true; else { A[k.slice(2)] = n; i++; } }
}
for (const k of ['raiz', 'puppeteer', 'navegador']) if (!A[k]) { console.error('falta --' + k + ' (veja o cabecalho do arquivo)'); process.exit(2); }
const RAIZ = path.resolve(A.raiz);
const PUBLICO = path.join(RAIZ, 'dashboard', 'public');
const PAGINA = A.pagina || '/gerador/index.html';
const SAIDA = path.resolve(A.saida || path.join(PUBLICO, 'gerador', 'ui', 'io2-cores-index.css'));
const REGRAS_ARQ = path.resolve(A.regras || path.join(AQUI, 'gerador-io2-cores.regras.json'));
const RELATORIO_ARQ = A.relatorio ? path.resolve(A.relatorio) : null;
const REGRAS = fs.existsSync(REGRAS_ARQ) ? JSON.parse(fs.readFileSync(REGRAS_ARQ, 'utf8')) : {};

const PREFIXO = 'html.io2[data-mode="app"]:not(#_):not(#_)';

/* ------------------------------------------------------------------ lista de exclusao (plano, secao 4) */
const DOC_IDS = new Set(['eletro-print', 'doc-print', 'propostaSection', 'expiradoSection', 'orcViewSection', 'loadingProposta', 'ep-prev-doc', 'orcview-folha', 'exp-cta-card', 'exp-cta-fallback', 'marr']);
const DOC_CLASSES = new Set(['ep-doc', 'ep-page', 'ep-completo', 'ep-prev-folha', 'ep-prev-palco', 'ep-prev-scroll', 'nx-deck', 'nx-slide', 'simshot', 'orc1', 'orcview-palco', 'orcview-folha', 'pl-rx', 'soc-rx', 'sol-pb', 'sol-te', 'sol-vi', 'sol-card', 'sol-band', 'sol-out', 'sol-res', 'sol-banco', 'prop-header', 'preco-box', 'hero-economia', 'cta-fechamento', 'print-only', 'celebra-overlay']);
const DOC_PREFIXOS = ['ep-', 'nx-', 'pl-', 'soc-', 'sol-', 'celebra-'];
const DOC_PREFIXO_EXCECAO = new Set(['ep-prev-bar', 'ep-prev-nota', 'ep-prev-tit', 'ep-prev-acoes']);
const DOC_ESTADOS = [/body\.print-doc/, /body\.print-proposta/];
/* Guarda de zero especificidade para itens que nao comecam por id de secao de app. */
const GUARDA_RAIZES = ['#eletro-print', '#doc-print', '#ep-preview', '#orcViewSection', '#propostaSection', '#expiradoSection', '#loadingProposta', '#marr', '.celebra-overlay', '.simshot', '.ep-doc', '.orc1', '.nx-deck'];
const GUARDA = ':not(:where(' + GUARDA_RAIZES.join(',') + ') *)';
/* Onde procurar classes que tambem moram dentro de documento (viram LEAKY, ver abaixo). */
const RAIZES_COLETA = [...GUARDA_RAIZES, '#ep-prev-doc', '#orcview-folha', '#orcViewSection'];

/* Casca e cores de status vindas de dado: ficam como estao (casca: io2.css; status: dado do CRM). */
const PULAR_PADROES = [
  [/#app-sidebar|\.sb-item|\.sb-mobile-toggle|#sb-backdrop|\.sb-ic\b|\.sb-/, 'casca (barra lateral e gaveta: io2.css)'],
  [/\.crm-btn-status|\.posse-btn/, 'cor de status que vem de dado (fundo solido)'],
];
/* Selo e botao de temperatura: o tom de fundo e de borda e dado de status e fica; so o TEXTO ganha contraste. */
const STATUS_SO_TEXTO = /\.crm-status-selo|\.bt-quente|\.bt-morno|\.bt-frio/;
const ESTADO_LIVRE = /^(\.|#)?(selo-ok|selo-sr|selo-fora|selo-motivo)\b/;

/* ------------------------------------------------------------------ tokens (valores de io2.css, so para checar contraste) */
const TOK = {
  '--n-bg': '#F2F4F8', '--n-sf': '#FFFFFF', '--n-sf2': '#F7F9FC', '--n-sf3': '#EEF2F7', '--n-bd': '#DDE3EC', '--n-bd2': '#B9C4D4',
  '--n-tx': '#0F1B2D', '--n-tx2': '#44546A', '--n-tx3': '#5B6C83', '--n-inv': '#FFFFFF', '--n-inv2': '#B9C7DE',
  '--io-ok': '#147B3B', '--io-ok-sf': '#E7F6EC', '--io-er': '#B91C1C', '--io-er-sf': '#FDECEC', '--io-av': '#AD5009', '--io-av-sf': '#FFF1DC',
  '--io-info': '#1D4ED8', '--io-azul': '#1D4ED8', '--io-azul-sf': '#E8EFFD', '--io-amarelo': '#FFC220', '--io-amarelo-sf': '#FFF3C7', '--io-tinta': '#0B2447',
};
const T = n => `var(${n})`;

/* ------------------------------------------------------------------ cor */
const NOMES = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0], red: [255, 0, 0, 1], blue: [0, 0, 255, 1], green: [0, 128, 0, 1], orange: [255, 165, 0, 1], yellow: [255, 255, 0, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1], silver: [192, 192, 192, 1], lime: [0, 255, 0, 1], navy: [0, 0, 128, 1], purple: [128, 0, 128, 1], gold: [255, 215, 0, 1], whitesmoke: [245, 245, 245, 1], lightgray: [211, 211, 211, 1], lightgrey: [211, 211, 211, 1], darkgray: [169, 169, 169, 1], dimgray: [105, 105, 105, 1] };
const RE_COR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^()]*\)|hsla?\([^()]*\)|\b(?:white|black|transparent|red|blue|green|orange|yellow|gray|grey|silver|lime|navy|purple|gold|whitesmoke|lightgr[ae]y|darkgray|dimgray)\b/gi;

function parseCor(s) {
  s = String(s).trim().toLowerCase();
  if (NOMES[s]) { const n = NOMES[s]; return { r: n[0], g: n[1], b: n[2], a: n[3] }; }
  let m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  if ((m = s.match(/^rgba?\((.*)\)$/))) {
    const p = m[1].replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean);
    if (p.length < 3) return null;
    const num = (v) => v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v);
    const a = p[3] === undefined ? 1 : (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]));
    const o = { r: num(p[0]), g: num(p[1]), b: num(p[2]), a };
    return [o.r, o.g, o.b, o.a].some(Number.isNaN) ? null : o;
  }
  if ((m = s.match(/^hsla?\((.*)\)$/))) {
    const p = m[1].replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = parseFloat(p[0]) / 360, sa = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
    const a = p[3] === undefined ? 1 : (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]));
    const q = l < .5 ? l * (1 + sa) : l + sa - l * sa, pp = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < .5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
    return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255, a };
  }
  return null;
}
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const gam = v => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
function oklch(c) {
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let h = Math.atan2(bb, a) * 180 / Math.PI; if (h < 0) h += 360;
  return { L, C: Math.hypot(a, bb), h };
}
function deOklch(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return { r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), a: 1 };
}
const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const hexCor = h => parseCor(h);
const SF3 = hexCor('#EEF2F7'), BRANCO = hexCor('#FFFFFF');
const fmtA = a => String(Math.round(a * 100) / 100).replace(/^0\./, '.');

/* Familia pela matiz (OKLCH). */
function familia(h) {
  if (h >= 350 || h < 15) return 'rosa';
  if (h < 50) return 'vermelho';
  if (h < 112) return 'ambar';
  if (h < 172) return 'verde';
  if (h < 215) return 'ciano';
  if (h < 278) return 'azul';
  if (h < 350) return 'roxo';
  return 'rosa';
}
const FAM_TEXTO = { vermelho: '--io-er', ambar: '--io-av', verde: '--io-ok', azul: '--io-info' };
const FAM_SF = { vermelho: '--io-er-sf', ambar: '--io-av-sf', verde: '--io-ok-sf', ciano: '--io-ok-sf', azul: '--io-azul-sf', roxo: '--io-azul-sf', rosa: '--io-er-sf' };

const NEUTRO = 0.045;      // C abaixo disto e cinza
const ESCURO_NEUTRO = 0.075; // fundo escuro com C abaixo disto e superficie; acima, continua saturado

/* ------------------------------------------------------------------ mapa por papel */
const USO_VAR = new Map();   // --nome -> Set('texto'|'fundo'|'borda'), preenchido antes das passadas
const estat = { texto: new Map(), fundo: new Map(), borda: new Map(), sombra: new Map(), naoClassificadas: new Map() };
function conta(papel, de, para) {
  const k = de + ' -> ' + para; const m = estat[papel]; m.set(k, (m.get(k) || 0) + 1);
}

/* Texto. ctx.bg: 'sat' (fundo saturado ou escuro que continua assim), 'light' ou null. Devolve string de CSS ou null (sem mudanca). */
function mapTexto(c, ctx = {}) {
  if (c.a === 0) return null;
  if (ctx.bg === 'sat') return null;
  const o = oklch(c);
  const neutro = o.C < NEUTRO;
  if (neutro) {
    // preto/cinza translucido em texto ja e escuro; so o branco translucido precisa de degrau
    let L = o.L;
    if (c.a < 1 && L >= 0.9) L = c.a >= 0.85 ? 0.95 : c.a >= 0.6 ? 0.85 : 0.7;
    if (L >= 0.90) return T('--n-tx');
    if (L >= 0.80) return T('--n-tx2');
    if (L >= 0.52) return T('--n-tx3');
    return null;
  }
  // saturado: se ja passa 4,5:1 sobre o cinza mais escuro das superficies, fica
  const sem = { ...c, a: 1 };
  if (razao(sem, SF3) >= 4.5) return null;
  const fam = familia(o.h);
  if (FAM_TEXTO[fam]) return T(FAM_TEXTO[fam]);
  // familia sem token: escurece mantendo matiz e croma ate dar 4,6:1
  for (let L = Math.min(o.L, 0.7); L > 0.2; L -= 0.01) {
    for (let C = o.C; C > 0.02; C -= 0.02) {
      const t = deOklch(L, C, o.h);
      if (razao(t, SF3) >= 4.6) return hex(t);
    }
  }
  return T('--n-tx');
}

/* Fundo. ctx: { campo, pagina }. Devolve { css|null, kind: 'sat'|'light'|'none' }. */
function mapFundo(c, ctx = {}) {
  if (c.a === 0) return { css: null, kind: 'none' };
  const o = oklch(c);
  const neutro = o.C < NEUTRO;
  const profundidade = (L) => ctx.pagina && L < 0.2 ? '--n-bg' : ctx.campo ? '--n-sf' : L < 0.22 ? '--n-sf2' : L < 0.32 ? '--n-sf' : '--n-sf3';
  if (c.a >= 0.97) {
    if (o.L < 0.45) {
      if (o.C < ESCURO_NEUTRO) return { css: T(profundidade(o.L)), kind: 'light' };
      return { css: null, kind: 'sat' };       // azul de marca, verde escuro etc.: continua saturado, texto branco fica
    }
    if (o.L < 0.62 && o.C < NEUTRO) return { css: null, kind: 'sat' };   // cinza medio de botao: continua
    if (o.C >= ESCURO_NEUTRO) return { css: null, kind: 'sat' };         // amarelo, verde, azul vivo
    return { css: null, kind: 'light' };
  }
  // translucido
  const branco = o.L >= 0.62 && neutro;
  if (branco) {
    if (c.a >= 0.5) return { css: null, kind: 'light' };
    return { css: T(c.a < 0.08 ? '--n-sf2' : '--n-sf3'), kind: 'light' };
  }
  if (neutro) {                                   // escuro translucido
    if (o.L < 0.1) {                              // preto: cortina de modal ou poco
      if (c.a >= 0.4) return { css: `rgba(6,26,56,${fmtA(Math.min(0.72, c.a * 0.85))})`, kind: 'sat' };
      return { css: T('--n-sf3'), kind: 'light' };
    }
    if (c.a >= 0.85) return { css: T(profundidade(o.L)), kind: 'light' };
    return { css: T(c.a >= 0.5 ? '--n-sf2' : '--n-sf3'), kind: 'light' };
  }
  // saturado translucido
  if (c.a >= 0.5) return { css: null, kind: 'sat' };
  return { css: T(FAM_SF[familia(o.h)]), kind: 'light' };
}

/* Borda e contorno. */
function mapBorda(c) {
  if (c.a === 0) return null;
  const o = oklch(c);
  if (o.C >= NEUTRO) return null;
  if (c.a < 0.97) {
    if (o.L >= 0.62) return T(c.a < 0.2 ? '--n-bd' : '--n-bd2');
    return null;                                   // preto translucido ja funciona sobre claro
  }
  if (o.L < 0.38) return T('--n-bd');
  if (o.L < 0.62) return T('--n-bd2');
  return null;
}

/* Cor dentro de sombra. */
function mapSombraCor(c, inset) {
  if (c.a === 0) return null;
  const o = oklch(c);
  if (o.C < NEUTRO) {
    if (o.L < 0.2) return `rgba(10,36,80,${fmtA(Math.max(0.04, Math.min(inset ? 0.14 : 0.2, c.a * (inset ? 0.35 : 0.4))))})`;
    if (o.L >= 0.9) return 'rgba(10,36,80,.05)';
    return null;
  }
  if (c.a < 0.9) return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${fmtA(Math.max(0.08, c.a * 0.6))})`;
  return null;
}

/* ------------------------------------------------------------------ leitura de valores */
function dividirTopo(s, sep) {
  const out = []; let d = 0, q = null, ini = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    else if (d === 0 && sep.includes(ch)) { out.push(s.slice(ini, i)); ini = i + 1; }
  }
  out.push(s.slice(ini));
  return out;
}
function declaracoes(cssText) {
  const out = [];
  for (const d of dividirTopo(cssText, ';')) {
    const i = d.indexOf(':'); if (i < 0) continue;
    const prop = d.slice(0, i).trim().toLowerCase(); let valor = d.slice(i + 1).trim();
    if (!prop || !valor) continue;
    let imp = false;
    const m = valor.match(/\s*!\s*important\s*$/i);
    if (m) { imp = true; valor = valor.slice(0, m.index).trim(); }
    out.push({ prop, valor, imp });
  }
  return out;
}
const todasCores = (v) => (v.match(RE_COR) || []);
const temVar = v => /\bvar\(/.test(v);
const ehGradiente = v => /gradient\(/i.test(v);

const LADOS = { 'border-top': 'border-top-color', 'border-right': 'border-right-color', 'border-bottom': 'border-bottom-color', 'border-left': 'border-left-color', 'border-block': 'border-block-color', 'border-inline': 'border-inline-color', 'border-block-start': 'border-block-start-color', 'border-block-end': 'border-block-end-color', 'border-inline-start': 'border-inline-start-color', 'border-inline-end': 'border-inline-end-color', 'border': 'border-color', 'outline': 'outline-color', 'column-rule': 'column-rule-color' };
const PROPS_TEXTO = new Set(['color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color', '-webkit-text-stroke-color']);
const PROPS_BORDA = new Set(['border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-block-color', 'border-inline-color', 'border-block-start-color', 'border-block-end-color', 'border-inline-start-color', 'border-inline-end-color', 'outline-color', 'column-rule-color']);

/* Devolve lista de declaracoes novas [{prop,valor,imp}] e, em .kind, o tipo de fundo da regra (se declara fundo). */
function converterDecls(decls, ctx, alvoInfo) {
  const novas = []; let kind = null; const avisos = [];
  const bgDecl = decls.filter(d => d.prop === 'background' || d.prop === 'background-color' || d.prop === 'background-image');
  const pontoDeFundo = [];
  // 1) fundos primeiro: o tipo deles decide o texto da mesma regra
  for (const d of decls) {
    if (!(d.prop === 'background' || d.prop === 'background-color' || d.prop === 'background-image')) continue;
    if (ctx.somenteTexto) continue;
    if (temVar(d.valor) && !ehGradiente(d.valor)) continue;
    if (ehGradiente(d.valor)) {
      const g = converterGradiente(d.valor, ctx);
      if (g) { kind = g.kind; for (const x of g.decls) novas.push({ ...x, imp: d.imp }); }
      // cor final do shorthand fora do gradiente
      if (d.prop === 'background') {
        const resto = d.valor.replace(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/gi, ' ');
        const cs = todasCores(resto);
        if (cs.length === 1) { const c = parseCor(cs[0]); if (c) { const r = mapFundo(c, ctx); if (r.css) novas.push({ prop: 'background-color', valor: r.css, imp: d.imp }); } }
      }
      continue;
    }
    if (d.prop === 'background-image') continue;
    const cs = todasCores(d.valor);
    if (d.prop === 'background' && /^\s*none\s*$/i.test(d.valor)) continue;
    if (cs.length === 0) continue;
    if (cs.length > 1) { avisos.push('varias cores em ' + d.prop + ': ' + d.valor); continue; }
    const c = parseCor(cs[0]);
    if (!c) { naoClass(cs[0]); continue; }
    const r = mapFundo(c, ctx);
    if (kind !== 'light') kind = r.kind;
    conta('fundo', cs[0].toLowerCase(), r.css || '(fica)');
    // sempre emite o valor (mesmo sem mudanca) para preservar a ordem de cascata
    novas.push({ prop: 'background-color', valor: r.css || normCor(cs[0]), imp: d.imp, mudou: !!r.css });
  }
  // 2) o resto
  for (const d of decls) {
    const p = d.prop;
    if (p === 'background' || p === 'background-color' || p === 'background-image') continue;
    if (p === 'color-scheme') { if (/\bdark\b/.test(d.valor)) novas.push({ prop: p, valor: 'light', imp: d.imp }); continue; }
    if (p.startsWith('--')) {
      const cs = todasCores(d.valor); if (cs.length !== 1 || d.valor.trim() !== cs[0] || ctx.somenteTexto) continue;
      const c = parseCor(cs[0]); if (!c) { naoClass(cs[0]); continue; }
      const papeis = USO_VAR.get(p); if (!papeis) continue;
      let novo = null;
      if (papeis.has('texto')) novo = mapTexto(c, {});
      else if (papeis.has('fundo')) novo = mapFundo(c, {}).css;
      else if (papeis.has('borda')) novo = mapBorda(c);
      conta(papeis.has('texto') ? 'texto' : papeis.has('fundo') ? 'fundo' : 'borda', p + ' = ' + cs[0].toLowerCase(), novo || '(fica)');
      novas.push({ prop: p, valor: novo || normCor(cs[0]), imp: d.imp, mudou: !!novo });
      continue;
    }
    if (PROPS_TEXTO.has(p)) {
      const vf = d.valor.match(/^var\((--[\w-]+),\s*(.+)\)$/);
      if (vf && todasCores(vf[2]).length === 1 && vf[2].trim() === todasCores(vf[2])[0]) {
        const c = parseCor(vf[2].trim()); const novo = c && mapTexto(c, { bg: (kind && kind !== 'none') ? kind : ctx.bgTexto });
        conta('texto', 'fallback ' + vf[2].trim().toLowerCase(), novo || '(fica)');
        novas.push({ prop: p, valor: `var(${vf[1]},${novo || normCor(vf[2])})`, imp: d.imp, mudou: !!novo });
        continue;
      }
      if (temVar(d.valor)) continue;
      const cs = todasCores(d.valor); if (cs.length !== 1 || d.valor.trim() !== cs[0]) { if (cs.length) avisos.push(p + ': ' + d.valor); continue; }
      const c = parseCor(cs[0]); if (!c) { naoClass(cs[0]); continue; }
      const efetivo = (kind && kind !== 'none') ? kind : ctx.bgTexto;
      let novo = mapTexto(c, { bg: efetivo });
      // texto com opacity na mesma regra clareia no composto: sobe um degrau
      const op = decls.find(x => x.prop === 'opacity'); const opv = op ? parseFloat(op.valor) : 1;
      if (novo && opv < 0.9) novo = novo === T('--n-tx3') ? (opv < 0.7 ? T('--n-tx') : T('--n-tx2')) : novo === T('--n-tx2') ? T('--n-tx') : novo;
      if (ctx.somenteTexto) {
        // selo de status: o tom de fundo (translucido) fica; o texto escurece ate 4,6:1 sobre o fundo composto sobre a superficie
        const bgd = decls.find(x => x.prop === 'background' || x.prop === 'background-color');
        const bcs = bgd ? todasCores(bgd.valor) : []; const bc = bcs.length ? parseCor(bcs[0]) : null;
        if (bc) {
          const comp = { r: bc.r * bc.a + 247 * (1 - bc.a), g: bc.g * bc.a + 249 * (1 - bc.a), b: bc.b * bc.a + 252 * (1 - bc.a), a: 1 };
          const tc = novo ? resolverCor(novo) : c;
          if (tc && razao(tc, comp) < 4.6) {
            const o = oklch(tc); let ach = null;
            for (let Lx = Math.min(o.L, 0.7); Lx > 0.15; Lx -= 0.005) { const t2 = deOklch(Lx, o.C, o.h); if (razao(t2, comp) >= 4.6) { ach = t2; break; } }
            if (ach) novo = hex(ach);
          }
        }
      }
      conta('texto', cs[0].toLowerCase() + (efetivo === 'sat' ? ' [em fundo saturado]' : ''), novo || '(fica)');
      novas.push({ prop: p, valor: novo || normCor(cs[0]), imp: d.imp, mudou: !!novo });
      continue;
    }
    if (ctx.somenteTexto && !PROPS_TEXTO.has(p)) continue;
    if (LADOS[p] || PROPS_BORDA.has(p)) {
      if (temVar(d.valor)) continue;
      const alvo = LADOS[p] || p;
      if (/^(none|0|initial|inherit)$/i.test(d.valor.trim())) continue;
      const cs = todasCores(d.valor); if (cs.length !== 1 && !PROPS_BORDA.has(p)) { if (cs.length) avisos.push(p + ': ' + d.valor); continue; }
      if (cs.length === 0) continue;
      // border-color pode ter 1 a 4 cores
      const mapeadas = [];
      const novosVals = d.valor.replace(RE_COR, (m) => { const c = parseCor(m); if (!c) { naoClass(m); mapeadas.push(m); return m; } const n = mapBorda(c); conta('borda', m.toLowerCase(), n || '(fica)'); const r = n || normCor(m); mapeadas.push(r); return r; });
      // atalho (border, border-left, outline...): so a cor vai para o -color; border-color ja e so cor
      const soCor = PROPS_BORDA.has(p) ? novosVals.trim() : mapeadas[0];
      novas.push({ prop: alvo, valor: soCor, imp: d.imp });
      continue;
    }
    if (p === 'box-shadow' || p === 'text-shadow') {
      if (temVar(d.valor) || d.valor.trim() === 'none') continue;
      const partes = dividirTopo(d.valor, ',').map(sh => {
        const inset = /\binset\b/.test(sh);
        return sh.replace(RE_COR, (m) => { const c = parseCor(m); if (!c) { naoClass(m); return m; } const n = mapSombraCor(c, inset); conta('sombra', m.toLowerCase(), n || '(fica)'); return n || normCor(m); }).trim();
      });
      novas.push({ prop: p, valor: partes.join(', '), imp: d.imp });
      continue;
    }
    if (p === 'text-decoration' || p === 'text-decoration-line') {
      const cs = todasCores(d.valor); if (cs.length === 1 && !temVar(d.valor)) { const c = parseCor(cs[0]); const n = c && mapTexto(c, { bg: (kind && kind !== 'none') ? kind : ctx.bgTexto }); if (n) novas.push({ prop: 'text-decoration-color', valor: n, imp: d.imp }); }
      continue;
    }
    if (p === 'scrollbar-color') {
      const cs = todasCores(d.valor);
      if (cs.length === 2 && !temVar(d.valor)) novas.push({ prop: p, valor: `${T('--n-bd2')} ${T('--n-sf3')}`, imp: d.imp });
      continue;
    }
  }
  return { novas, kind, avisos };
}
function resolverCor(v) {
  const m = String(v).match(/^var\((--[\w-]+)\)$/); if (m) return TOK[m[1]] ? parseCor(TOK[m[1]]) : null;
  return parseCor(v);
}
function normCor(s) { const c = parseCor(s); if (!c) return s; return c.a >= 0.999 ? hex(c) : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${fmtA(c.a)})`; }
function naoClass(m) { estat.naoClassificadas.set(m, (estat.naoClassificadas.get(m) || 0) + 1); }

/* Gradiente: converte cada parada; azul e roxo de banner vira superficie lisa. */
function converterGradiente(valor, ctx) {
  const camadas = dividirTopo(valor, ',');
  // camadas de um background: top-level virgulas separam camadas, mas gradiente tem virgulas internas dentro de parenteses (dividirTopo respeita)
  const resultado = []; const kinds = []; let temRoxo = false;
  for (const camada of camadas) {
    if (!ehGradiente(camada)) { resultado.push(camada.trim()); continue; }
    const cores = todasCores(camada);
    const infos = cores.map(m => { const c = parseCor(m); return c ? { m, c, o: oklch(c) } : null; });
    if (infos.some(x => !x)) { resultado.push(camada.trim()); continue; }
    if (infos.some(x => x.c.a > 0 && x.o.C >= ESCURO_NEUTRO && x.o.h >= 285 && x.o.h < 345)) temRoxo = true;
    const ks = []; let outro = camada;
    const novo = camada.replace(RE_COR, (m) => {
      const c = parseCor(m); const r = mapFundo(c, { ...ctx, pagina: false });
      ks.push(r.kind);
      return r.css || normCor(m);
    });
    const ativos = ks.filter(k => k !== 'none');
    const temSat = ativos.includes('sat'), temLight = ativos.includes('light');
    if (temSat && temLight) { kinds.push('misto'); } else if (temSat) kinds.push('sat'); else if (temLight) kinds.push('light'); else kinds.push('none');
    resultado.push(novo.trim());
  }
  const todosSat = kinds.length && kinds.every(k => k === 'sat' || k === 'none');
  const algumMisto = kinds.includes('misto') || (kinds.includes('sat') && kinds.includes('light'));
  if (temRoxo || algumMisto) {
    conta('fundo', 'degrade ' + (temRoxo ? 'azul/roxo' : 'misto'), 'superficie lisa');
    return { kind: 'light', decls: [{ prop: 'background-image', valor: 'none' }, { prop: 'background-color', valor: T('--n-sf') }] };
  }
  if (todosSat) { conta('fundo', 'degrade saturado', '(fica)'); return { kind: 'sat', decls: [{ prop: 'background-image', valor: resultado.join(', ') }] }; }
  conta('fundo', 'degrade neutro', 'tokens');
  return { kind: 'light', decls: [{ prop: 'background-image', valor: resultado.join(', ') }] };
}

/* ------------------------------------------------------------------ seletores */
function splitCompostos(item) {
  // devolve lista de compostos (sem combinadores), na ordem
  const out = []; let d = 0, q = null, atual = '';
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (q) { atual += ch; if (ch === '\\') { atual += item[++i] || ''; } else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; atual += ch; continue; }
    if (ch === '(' || ch === '[') d++;
    if (ch === ')' || ch === ']') d--;
    if (d === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) { if (atual) out.push(atual); atual = ''; continue; }
    atual += ch;
  }
  if (atual) out.push(atual);
  return out;
}
function normComposto(c) {
  // tira pseudo-classes e pseudo-elementos (estados), mantem tag, classes, ids e atributos
  let r = ''; let d = 0, q = null;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (q) { r += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; r += ch; continue; }
    if (ch === '[') { d++; r += ch; continue; } if (ch === ']') { d--; r += ch; continue; }
    if (d === 0 && ch === ':') {
      // pula :nome ou ::nome e o parentese seguinte
      i++; if (c[i] === ':') i++;
      while (i < c.length && /[\w-]/.test(c[i])) i++;
      if (c[i] === '(') { let p = 0; for (; i < c.length; i++) { if (c[i] === '(') p++; else if (c[i] === ')') { p--; if (p === 0) break; } } }
      else i--;
      continue;
    }
    r += ch;
  }
  return r;
}
const temEstado = c => /:(hover|focus|focus-within|focus-visible|active|disabled|checked|invalid|visited|target|empty|read-only|placeholder-shown)\b|::/.test(c);
function tokensSeletor(item) {
  const ids = [], classes = [];
  const semAspas = item.replace(/"[^"]*"|'[^']*'/g, '""');
  for (const m of semAspas.matchAll(/#([\w-]+)/g)) ids.push(m[1]);
  for (const m of semAspas.matchAll(/\.([\w-]+)/g)) classes.push(m[1]);
  return { ids, classes };
}
function ehDocumento(item) {
  const { ids, classes } = tokensSeletor(item);
  if (ids.some(i => DOC_IDS.has(i))) return true;
  for (const c of classes) {
    if (DOC_CLASSES.has(c)) return true;
    if (DOC_PREFIXOS.some(p => c.startsWith(p)) && !DOC_PREFIXO_EXCECAO.has(c)) return true;
  }
  return DOC_ESTADOS.some(re => re.test(item));
}
function motivoPular(item) {
  for (const [re, motivo] of PULAR_PADROES) if (re.test(item)) return motivo;
  for (const r of (REGRAS.pular || [])) if (casa(r.seletor, item)) return 'regras.json: ' + (r.motivo || r.seletor);
  return null;
}
function casa(padrao, texto) {
  if (padrao.startsWith('/') && padrao.lastIndexOf('/') > 0) { const i = padrao.lastIndexOf('/'); return new RegExp(padrao.slice(1, i), padrao.slice(i + 1)).test(texto); }
  return texto.includes(padrao);
}

/* Prefixa um item de seletor. Devolve null se o item nunca casaria sob html.io2[data-mode=app][data-theme=light]. */
function prefixar(item) {
  item = item.trim();
  let m = item.match(/^(?:html|:root)((?:\.[\w-]+|\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\)|:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*)([\s\S]*)$/);
  if (m && (m[2] === '' || /^[\s>+~]/.test(m[2]))) {
    let extras = m[1]; const resto = m[2];
    const attrs = [...extras.matchAll(/\[([^\]]*)\]/g)].map(x => x[1].replace(/\s+/g, ''));
    for (const a of attrs) {
      if (/^data-theme=["']?dark["']?$/.test(a)) return { nulo: 'tema escuro' };
      const dm = a.match(/^data-mode=["']?([\w-]+)["']?$/);
      if (dm && dm[1] !== 'app') return { nulo: 'outro modo' };
    }
    extras = extras.replace(/\[data-mode(?:=["']?app["']?)?\]/g, '');
    return { css: PREFIXO + extras + resto, ancorado: false, fusao: true };
  }
  return { css: PREFIXO + ' ' + item, ancorado: false };
}
/* `.container` NAO ancora: os documentos (#propostaSection etc.) moram dentro dele, entao
   ".container .chart-caption" alcancaria o documento. Ver precisaGuarda(item, true). */
function ancoradoEmApp(item) {
  // primeiro composto, depois do html: id de secao de app que nao e documento
  const comp = splitCompostos(item.replace(/^(?:html|:root)(?:\.[\w-]+|\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\)|:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*\s*/, ''))[0] || '';
  const m = comp.match(/^#([\w-]+)/);
  return !!(m && !DOC_IDS.has(m[1]) && /(Section|^app-sidebar$|^pv-bg$|^pv-tela$|^crm-det|^historico|^modal)/.test(m[1])) || /^\.modal-overlay/.test(comp);
}
/* Classes de app que tambem moram dentro de documento: descobertas nos proprios seletores de documento
   (ex.: ".simshot .card") mais uma lista minima. Um item so precisa de guarda se TODOS os compostos puderem estar num documento. */
const LEAKY = new Set(['card', 'header', 'eletro-grid', 'eletro-chart', 'eletro-sub', 'eletro-field', 'eletro-inp', 'itens']);
const HTML_PREFIXO_RE = /^(?:html|:root)(?:\.[\w-]+|\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\)|:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*\s*/;
function precisaGuarda(item) {
  let comps = splitCompostos(item.replace(HTML_PREFIXO_RE, ''));
  /* ".container X": o .container so e o pai de tudo; o que decide e o resto. */
  if (comps.length > 1 && /^\.container(\.|$|:|\[)/.test(comps[0])) comps = comps.slice(1);
  if (!comps.length) return false;
  const ult = comps[comps.length - 1];
  if (/^(body|html)(?![\w-])/i.test(ult)) return false;
  return comps.every(c => { const { ids, classes } = tokensSeletor(normComposto(c)); return ids.length === 0 && classes.every(k => LEAKY.has(k)); });
}
function comGuarda(css) {
  // insere a guarda antes de pseudo-elemento do ultimo composto
  const comps = css; // procura o ultimo "::" ou ":before/:after" fora de parenteses/colchetes
  let d = 0, q = null, pos = -1;
  for (let i = 0; i < comps.length; i++) {
    const ch = comps[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--;
    else if (d === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) pos = -1;
    else if (d === 0 && ch === ':' && pos < 0) {
      const resto = comps.slice(i);
      if (/^::/.test(resto) || /^:(before|after|first-line|first-letter)\b/.test(resto)) pos = i;
    }
  }
  return pos >= 0 ? css.slice(0, pos) + GUARDA + css.slice(pos) : css + GUARDA;
}

/* ------------------------------------------------------------------ pagina */
function iniciarServidor() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(PUBLICO, p);
      if (!f.startsWith(path.normalize(PUBLICO))) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(f));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const LER_FOLHAS = () => {
  const saida = { folhas: [], regras: [], semLeitura: [] };
  const wrapDe = (r) => { const t = r.cssText; return t.slice(0, t.indexOf('{')).trim(); };
  let seq = 0;
  function andar(lista, wrappers, folhaIdx) {
    for (const r of lista) {
      const tipo = r.constructor.name;
      if (tipo === 'CSSStyleRule') {
        saida.regras.push({ n: seq++, f: folhaIdx, sel: r.selectorText, css: r.style.cssText, w: wrappers, aninhada: (r.cssRules && r.cssRules.length) || 0 });
      } else if (tipo === 'CSSMediaRule' || tipo === 'CSSSupportsRule' || tipo === 'CSSContainerRule' || tipo === 'CSSLayerBlockRule') {
        andar(r.cssRules, wrappers.concat([wrapDe(r)]), folhaIdx);
      } else if (tipo === 'CSSImportRule' || tipo === 'CSSFontFaceRule' || tipo === 'CSSKeyframesRule' || tipo === 'CSSPageRule' || tipo === 'CSSNamespaceRule') {
        /* sem cor de seletor */
      } else { saida.semLeitura.push(tipo); }
    }
  }
  Array.from(document.styleSheets).forEach((s, idx) => {
    const dono = s.ownerNode;
    const info = { idx, href: s.href ? s.href.replace(location.origin, '') : null, noCorpo: !!(dono && dono.closest && dono.closest('body')), media: s.media ? s.media.mediaText : '' };
    saida.folhas.push(info);
    try { andar(s.cssRules, [], idx); } catch (e) { saida.semLeitura.push('folha ' + idx + ': ' + e.message); info.erro = String(e.message).slice(0, 80); }
  });
  return saida;
};

async function carregarPuppeteer(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const entrada = path.join(dir, typeof pkg.main === 'string' ? pkg.main : 'index.js');
  const mod = await import(pathToFileURL(entrada).href);
  return mod.default || mod;
}

/* ------------------------------------------------------------------ inline (style="...") */
function colherInline(textos) {
  const achados = new Map(); // "prop|valor" -> {prop, valor, n, comFundoNoMesmo}
  const re = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const txt of textos) {
    let m;
    while ((m = re.exec(txt))) {
      const attr = m[1] ?? m[2];
      const ds = declaracoes(attr).filter(d => !/\$\{|'\s*\+|\+\s*'|\{\{/.test(d.valor)); // so declaracoes sem valor montado em tempo de execucao
      const temFundo = ds.some(d => /^background(-color)?$/.test(d.prop) && todasCores(d.valor).length && !/transparent/i.test(d.valor));
      for (const d of ds) {
        if (!(PROPS_TEXTO.has(d.prop) || d.prop === 'background' || d.prop === 'background-color' || d.prop === 'border' || /^border-(top|right|bottom|left)(-color)?$/.test(d.prop) || d.prop === 'border-color')) continue;
        if (temVar(d.valor)) continue;
        const cs = todasCores(d.valor); if (!cs.length) continue;
        const k = d.prop + '|' + d.valor.toLowerCase();
        const e = achados.get(k) || { prop: d.prop, valor: d.valor, n: 0, comFundo: 0 };
        e.n++; if (temFundo) e.comFundo++;
        achados.set(k, e);
      }
    }
  }
  return [...achados.values()];
}
const escAttr = s => s.replace(/"/g, '\\"');
function inlineRegras(achados) {
  const regras = []; const sem = [];
  const forms = (prop, valor) => {
    // formas que o autor escreve: "color:#94A3B8" e "color: #94A3B8"
    const v = valor.trim();
    return [`${prop}:${v}`, `${prop}: ${v}`];
  };
  for (const e of achados) {
    const c0 = todasCores(e.valor);
    let novo = null, extra = '';
    if (PROPS_TEXTO.has(e.prop)) {
      if (c0.length !== 1) continue;
      const c = parseCor(c0[0]); if (!c) { naoClass(c0[0]); continue; }
      novo = mapTexto(c, {});
      if (novo && oklch(c).C < NEUTRO) extra = ':not([style*="background" i])';  // branco com fundo proprio no mesmo atributo fica
      conta('texto', 'inline ' + c0[0].toLowerCase(), novo || '(fica)');
      if (!novo) continue;
      for (const f of forms(e.prop, e.valor)) regras.push({ sel: `[style*="${escAttr(f)}" i]${extra}${e.prop === 'color' ? ':not([style*="-color:' + escAttr(e.valor.trim()) + '" i]):not([style*="-color: ' + escAttr(e.valor.trim()) + '" i])' : ''}`, decl: `${e.prop}:${novo}!important`, n: e.n });
    } else if (e.prop === 'background' || e.prop === 'background-color') {
      if (c0.length !== 1 || ehGradiente(e.valor)) {
        if (ehGradiente(e.valor)) { const g = converterGradiente(e.valor, {}); if (g && g.kind === 'light') for (const f of forms(e.prop, e.valor)) regras.push({ sel: `[style*="${escAttr(f.slice(0, 60))}" i]`, decl: g.decls.map(x => `${x.prop}:${x.valor}!important`).join(';'), n: e.n }); else sem.push(e); }
        continue;
      }
      const c = parseCor(c0[0]); if (!c) { naoClass(c0[0]); continue; }
      const r = mapFundo(c, {});
      conta('fundo', 'inline ' + c0[0].toLowerCase(), r.css || '(fica)');
      if (!r.css) continue;
      for (const f of forms(e.prop, e.valor)) regras.push({ sel: `[style*="${escAttr(f)}" i]`, decl: `background-color:${r.css}!important`, n: e.n });
    } else {
      // borda
      const alvo = LADOS[e.prop] || e.prop;
      /* so para a contagem do relatorio: cada cor da declaracao e classificada como borda */
      for (const m of e.valor.match(RE_COR) || []) { const c = parseCor(m); if (c) conta('borda', 'inline ' + m.toLowerCase(), mapBorda(c) || '(fica)'); }
      const cs = todasCores(e.valor); if (cs.length !== 1) continue;
      const c = parseCor(cs[0]); const n = c && mapBorda(c); if (!n) continue;
      for (const f of forms(e.prop, e.valor)) regras.push({ sel: `[style*="${escAttr(f)}" i]`, decl: `${alvo}:${n}!important`, n: e.n });
    }
  }
  return regras;
}

/* ------------------------------------------------------------------ principal */
(async () => {
  const puppeteer = await carregarPuppeteer(path.resolve(A.puppeteer));
  const srv = await iniciarServidor();
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const browser = await puppeteer.launch({ executablePath: A.navegador, headless: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-gpu'] });
  let bruto, textosFonte = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setJavaScriptEnabled(false);             // so o CSS estatico: nada de dado, nada de rede
    await page.setRequestInterception(true);
    page.on('request', rq => { if (rq.url().startsWith(origem)) rq.continue(); else rq.abort('blockedbyclient'); });
    await page.goto(origem + PAGINA, { waitUntil: 'load', timeout: 60000 });
    bruto = await page.evaluate(LER_FOLHAS);
    /* Classes do markup estatico dos conteineres de documento: com JS desligado so o HTML do arquivo existe. */
    bruto.classesDocs = await page.evaluate((raizes) => {
      const s = new Set();
      for (const sel of raizes) document.querySelectorAll(sel).forEach(r => { [r, ...r.querySelectorAll('*')].forEach(e => e.classList && e.classList.forEach(c => s.add(c))); });
      return [...s];
    }, RAIZES_COLETA);
    // fontes de style="..." : o proprio HTML e os .js que ele carrega
    const html = fs.readFileSync(path.join(PUBLICO, PAGINA.replace(/^\//, '')), 'utf8');
    textosFonte.push(html);
    for (const m of html.matchAll(/<script[^>]+src="(\/gerador\/[^"?#]+\.js)"/g)) {
      const f = path.join(PUBLICO, m[1]); if (fs.existsSync(f) && !/\/ui\//.test(m[1]) && !/\.min\.js$/.test(m[1])) textosFonte.push(fs.readFileSync(f, 'utf8'));
    }
  } finally { await browser.close(); srv.close(); }

  const rel = { folhas: bruto.folhas, regrasLidas: 0, regrasDeTela: 0, regrasEmPrint: 0, regrasSemCor: 0, regrasEmitidas: 0, itensEmitidos: 0, itensPuladosDocumento: 0, itensPuladosTemaEscuro: 0, itensPuladosCasca: 0, itensPuladosRegrasJson: 0, regrasComNidificacao: 0, semLeitura: bruto.semLeitura };
  const folhasOk = new Set(bruto.folhas.filter(f => !(f.href && /\/gerador\/ui\//.test(f.href)) && !/^print$/i.test(f.media.trim())).map(f => f.idx));
  const ehPrintSo = (w) => w.some(x => /\bprint\b/i.test(x) && !/\b(screen|all)\b/i.test(x));

  const regras = [];
  for (const r of bruto.regras) {
    if (!folhasOk.has(r.f)) continue;
    rel.regrasLidas++;
    if (ehPrintSo(r.w)) { rel.regrasEmPrint++; continue; }
    rel.regrasDeTela++;
    if (r.aninhada) rel.regrasComNidificacao++;
    regras.push(r);
  }

  for (const r of regras) for (const item of dividirTopo(r.sel, ',')) { if (!ehDocumento(item)) continue; for (const c of splitCompostos(item)) { const { classes } = tokensSeletor(normComposto(c)); for (const k of classes) if (!DOC_CLASSES.has(k) && !DOC_PREFIXOS.some(p => k.startsWith(p)) && !/^(print-|celebra)/.test(k)) LEAKY.add(k); } }
  /* Semente: toda classe do markup dos documentos (HTML estatico lido aqui + as que o JS injeta, listadas
     em regras.json > leakyDocumentos, colhidas de um render real). Classes que ja sao de documento, ou da
     barra de acoes da previa (DOC_PREFIXO_EXCECAO), nao entram: as primeiras nunca emitem regra e as
     segundas precisam continuar recoloridas. */
  const ehClasseDoc = k => DOC_CLASSES.has(k) || DOC_PREFIXOS.some(p => k.startsWith(p)) || DOC_PREFIXO_EXCECAO.has(k);
  for (const k of [...(bruto.classesDocs || []), ...(REGRAS.leakyDocumentos || [])]) if (!ehClasseDoc(k)) LEAKY.add(k);
  rel.leaky = [...LEAKY].sort();

  for (const r of regras) for (const d of declaracoes(r.css)) {
    for (const m of d.valor.matchAll(/var\((--[\w-]+)/g)) {
      const papel = PROPS_TEXTO.has(d.prop) ? 'texto' : /^background/.test(d.prop) ? 'fundo' : (LADOS[d.prop] || PROPS_BORDA.has(d.prop)) ? 'borda' : null;
      if (papel) { const st = USO_VAR.get(m[1]) || new Set(); st.add(papel); USO_VAR.set(m[1], st); }
    }
  }

  /* passada 1: quais compostos declaram fundo e de que tipo (so regras sem estado) */
  const indiceFundo = new Map();
  function itensDe(r) { return dividirTopo(r.sel, ',').map(s => s.trim()).filter(Boolean); }
  for (const r of regras) {
    const ds = declaracoes(r.css);
    if (!ds.some(d => /^background(-color|-image)?$/.test(d.prop))) continue;
    for (const item of itensDe(r)) {
      if (ehDocumento(item) || motivoPular(item)) continue;
      const comps = splitCompostos(item); const ult = comps[comps.length - 1]; if (!ult || temEstado(ult)) continue;
      const alvo = infoAlvo(item);
      const { kind } = converterDecls(ds, { campo: alvo.campo, pagina: alvo.pagina }, alvo);
      if (!kind || kind === 'none') continue;
      const k = normComposto(ult); if (!k) continue;
      const s = indiceFundo.get(k) || new Set(); s.add(kind); indiceFundo.set(k, s);
    }
  }
  for (const k of Object.keys(estat)) if (estat[k] instanceof Map) estat[k].clear();   // as contagens contam so a passada 2

  function infoAlvo(item) {
    const comps = splitCompostos(item.replace(/^(?:html|:root)(?:\.[\w-]+|\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\)|:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*\s*/, ''));
    const ult = comps[comps.length - 1] || '';
    const campo = /^(input|select|textarea)\b/i.test(ult) || /\.[\w-]*(inp|input|busca|filtro|textarea|-ta|-sel|select)\b/i.test(ult);
    const pagina = /^(body|html)$/i.test(ult) || (comps.length === 1 && /^#\w+Section$/.test(normComposto(ult)));
    return { campo, pagina, comps };
  }
  function fundoDosAncestrais(item) {
    const { comps } = infoAlvo(item);
    for (let i = comps.length - 1; i >= 0; i--) {
      const k = normComposto(comps[i]);
      let s = indiceFundo.get(k);
      if (!s && i === comps.length - 1) { const mc = k.match(/[.#][\w-]+$/); if (mc) s = indiceFundo.get(mc[0]); }
      if (s && s.size) return (s.has('light') || s.has('none')) ? 'light' : 'sat';
    }
    return null;
  }

  /* regras.json: cores globais, fundos forcados, manter */
  const manter = (REGRAS.manter || []);
  const forcar = (REGRAS.forcar || []);
  const fundoForcado = (REGRAS.fundoForcado || []);
  const coresFixas = REGRAS.cores || {};

  /* passada 2: emite */
  const blocos = []; // {chave, wrappers, linhas[]}
  const paresBaixos = [];
  function empurrar(w, linha) {
    const chave = w.join(' || ');
    const ult = blocos[blocos.length - 1];
    if (ult && ult.chave === chave) ult.linhas.push(linha); else blocos.push({ chave, w, linhas: [linha] });
  }
  for (const r of regras) {
    const ds = declaracoes(r.css);
    const relevante = ds.some(d => (d.prop.startsWith('--') && USO_VAR.has(d.prop)) || PROPS_TEXTO.has(d.prop) || /^(background|background-color|background-image|border|border-color|outline|outline-color|box-shadow|text-shadow|text-decoration|scrollbar-color|color-scheme|column-rule)$/.test(d.prop) || LADOS[d.prop] || PROPS_BORDA.has(d.prop));
    if (!relevante) { rel.regrasSemCor++; continue; }
    const gruposPorDecl = new Map();
    let algumItem = false;
    for (const item of itensDe(r)) {
      if (ehDocumento(item)) { rel.itensPuladosDocumento++; continue; }
      const mp = motivoPular(item);
      if (mp) { if (mp.startsWith('regras.json')) rel.itensPuladosRegrasJson++; else rel.itensPuladosCasca++; continue; }
      if (ESTADO_LIVRE.test(item)) { rel.itensPuladosCasca++; continue; }
      const pf = prefixar(item);
      if (pf.nulo) { if (pf.nulo === 'tema escuro') rel.itensPuladosTemaEscuro++; continue; }
      const alvo = infoAlvo(item);
      const ancestral = fundoDosAncestrais(item);
      const forcado = fundoForcado.find(f => casa(f.seletor, item));
      const ctx = { campo: alvo.campo, pagina: alvo.pagina, bgTexto: forcado ? forcado.tipo : ancestral, somenteTexto: STATUS_SO_TEXTO.test(item) };
      const { novas, kind, avisos } = converterDecls(ds, ctx, alvo);
      // regras.json: manter e cores fixas
      const finais = novas.filter(d => !manter.some(m => casa(m.seletor, item) && (!m.props || m.props.includes(d.prop))));
      for (const d of finais) {
        const orig = ds.find(x => x.prop === d.prop || LADOS[x.prop] === d.prop);
        if (orig) for (const c of todasCores(orig.valor)) { const fx = coresFixas[normCor(c).toLowerCase()] || coresFixas[normCor(c)]; if (fx && (!fx.prop || fx.prop === d.prop)) d.valor = fx.valor; }
      }
      if (!finais.length) continue;
      // contraste dentro da regra, quando texto e fundo sao conhecidos
      const t = finais.find(d => d.prop === 'color'); const b = finais.find(d => d.prop === 'background-color');
      if (t && b && b.valor !== 'transparent') {
        const ct = resolver(t.valor), cb = resolver(b.valor);
        if (ct && cb && cb.a >= 0.97 && razao(ct, cb) < 4.5) {
          const ob = oklch(cb);
          if (t.mudou && /^var\(--(ok|er|av|info|n-tx3|n-tx2)\)$/.test(t.valor)) {
            // par de familia que fica a poucos decimos de 4,5:1 (ex.: --io-ok sobre --io-ok-sf): escurece o texto so aqui
            const o = oklch(ct); let achou = null;
            for (let L = o.L; L > 0.15; L -= 0.005) { const t2 = deOklch(L, o.C, o.h); if (razao(t2, cb) >= 4.6) { achou = t2; break; } }
            if (achou) { conta('texto', t.valor + ' sobre ' + b.valor, hex(achou)); t.valor = hex(achou); t.mudou = true; }
          } else if (!t.mudou && !b.mudou && lum(ct) > 0.7 && ob.C >= ESCURO_NEUTRO) {
            // botao/etiqueta de fundo saturado e texto branco abaixo de 4,5:1: a familia ganha o tom forte do token; sem token, texto tinta
            const fam = familia(ob.h); const forte = { azul: '--io-azul', verde: '--io-ok', vermelho: '--io-er' }[fam];
            if (forte && razao(ct, resolver(T(forte))) >= 4.5) { conta('fundo', b.valor + ' com texto branco', T(forte)); b.valor = T(forte); b.mudou = true; }
            else if (razao(resolver(T('--io-tinta')), cb) >= 4.5) { conta('texto', 'branco sobre ' + b.valor, T('--io-tinta')); t.valor = T('--io-tinta'); t.mudou = true; }
            else paresBaixos.push({ seletor: item.slice(0, 90), texto: t.valor, fundo: b.valor, razao: Math.round(razao(ct, cb) * 100) / 100 });
          } else if (t.mudou || b.mudou) paresBaixos.push({ seletor: item.slice(0, 90), texto: t.valor, fundo: b.valor, razao: Math.round(razao(ct, cb) * 100) / 100 });
        }
      }
      const chaveDecl = finais.map(d => `${d.prop}:${d.valor}${d.imp ? '!important' : ''}`).join(';');
      let css = pf.css;
      if (!ancoradoEmApp(item) && precisaGuarda(item)) css = comGuarda(css);
      const g = gruposPorDecl.get(chaveDecl) || { itens: [], decl: chaveDecl };
      g.itens.push(css); gruposPorDecl.set(chaveDecl, g);
      algumItem = true; rel.itensEmitidos++;
    }
    if (!algumItem) continue;
    for (const g of gruposPorDecl.values()) { empurrar(r.w, `${g.itens.join(',\n')}{${g.decl}}`); rel.regrasEmitidas++; }
  }
  function resolver(v) {
    const m = String(v).match(/^var\((--[\w-]+)\)$/); if (m) return TOK[m[1]] ? hexCor(TOK[m[1]]) : null;
    return parseCor(v);
  }

  /* forcar (excecoes a mao) entram no fim, dentro de @media screen, com o mesmo prefixo */
  const forcadas = [];
  for (const f of forcar) {
    const sel = f.seletor.split(',').map(s => { const p = prefixar(s); return p.css || null; }).filter(Boolean).join(',\n');
    if (sel) forcadas.push(`${sel}{${f.prop}:${f.valor}${f.importante === false ? '' : '!important'}}`);
  }

  /* inline */
  const achadosInline = colherInline(textosFonte);
  for (const x of (REGRAS.inlineExtra || [])) { const dd = declaracoes(x)[0]; if (dd && !achadosInline.some(e => e.prop === dd.prop && e.valor.toLowerCase() === dd.valor.toLowerCase())) achadosInline.push({ prop: dd.prop, valor: dd.valor, n: 0, comFundo: 0 }); }
  const inl = inlineRegras(achadosInline);
  const GUARDA_INLINE = GUARDA;
  const linhasInline = inl.map(x => `html.io2[data-mode="app"] ${x.sel}${GUARDA_INLINE}{${x.decl}}`);

  /* escrita */
  const cab = `/* ARQUIVO GERADO. NAO EDITE A MAO.
   Gerado por dashboard/scripts/gerador-io2-cores.mjs a partir do CSS de ${PAGINA} (e style.css).
   Recolor do tema escuro para o claro novo: so cor de tela, sob html.io2[data-mode="app"], dentro de @media screen.
   Excecoes decididas a mao: dashboard/scripts/gerador-io2-cores.regras.json. Para refazer: veja o cabecalho do script. */\n`;
  let css = cab + '@media screen {\n';
  for (const b of blocos) {
    let abre = '', fecha = '';
    for (const w of b.w) { abre += w + ' {\n'; fecha += '}\n'; }
    css += abre + b.linhas.join('\n') + '\n' + fecha;
  }
  if (forcadas.length) css += '/* excecoes de regras.json (forcar) */\n' + forcadas.join('\n') + '\n';
  css += '/* atributos style="" com cor fixa */\n' + linhasInline.join('\n') + '\n}\n';
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, css);

  /* relatorio */
  const resumoMapa = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const lista = (m, n = 40) => resumoMapa(m).slice(0, n).map(([k, v]) => `${String(v).padStart(5)}  ${k}`).join('\n');
  const distinto = (m) => new Set([...m.keys()].map(k => k.split(' -> ')[0])).size;
  const out = [];
  out.push('RELATORIO DO GERADOR');
  out.push(`folhas lidas: ${bruto.folhas.length} (${bruto.folhas.map(f => (f.href || (f.noCorpo ? '<style no corpo>' : '<style>')) + (folhasOk.has(f.idx) ? '' : ' [ignorada]')).join(', ')})`);
  out.push(`regras lidas: ${rel.regrasLidas}   em @media print (puladas): ${rel.regrasEmPrint}   de tela: ${rel.regrasDeTela}   sem declaracao de cor: ${rel.regrasSemCor}`);
  out.push(`regras emitidas: ${rel.regrasEmitidas}   itens de seletor emitidos: ${rel.itensEmitidos}`);
  out.push(`itens pulados: documento ${rel.itensPuladosDocumento}, tema escuro (data-theme=dark) ${rel.itensPuladosTemaEscuro}, casca/status ${rel.itensPuladosCasca}, regras.json ${rel.itensPuladosRegrasJson}`);
  out.push(`regras de atributo style="" emitidas: ${inl.length} (de ${achadosInline.length} pares prop/valor lidos)`);
  out.push(`tamanho da folha: ${Buffer.byteLength(css)} bytes`);
  for (const p of ['texto', 'fundo', 'borda', 'sombra']) out.push(`\ncores distintas mapeadas, papel ${p}: ${distinto(estat[p])}\n${lista(estat[p])}`);
  out.push(`\ncores nao classificadas: ${estat.naoClassificadas.size}\n${lista(estat.naoClassificadas)}`);
  out.push(`\npares texto/fundo da mesma regra abaixo de 4,5:1: ${paresBaixos.length}\n` + paresBaixos.slice(0, 40).map(p => `  ${p.razao}  ${p.seletor}  [${p.texto} / ${p.fundo}]`).join('\n'));
  if (rel.semLeitura.length) out.push('\nnao lido: ' + [...new Set(rel.semLeitura)].join(', '));
  const texto = out.join('\n');
  console.log(texto);
  if (RELATORIO_ARQ) fs.writeFileSync(RELATORIO_ARQ, texto);
})().catch(e => { console.error('FALHOU', e); process.exit(1); });
