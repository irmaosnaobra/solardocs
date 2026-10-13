// Expande gerador-io2-componentes.src.css (macros @P, @S e @Q) em dashboard/public/gerador/ui/io2-componentes.css.
// A folha publicada e GERADA: edite o .src.css e rode `node dashboard/scripts/gerador-io2-componentes.cjs`.
// Cada seletor ganha o prefixo html.io2[data-mode="app"], o escopo das secoes de app e a guarda que deixa os documentos de fora.
const fs = require('fs');
const SRC = __dirname + '/gerador-io2-componentes.src.css';
const OUT = require('path').join(__dirname, '..', 'public', 'gerador', 'ui', 'io2-componentes.css');
const P = 'html.io2[data-mode="app"]:not(#_):not(#_):not(#_)';
const SECS = ['#inicioSection', '#formSection', '#historicoSection', '#calcSection', '#eletroSection', '#automacaoSection', '#tabelasSection',
  '#fechamentoSolarSection', '#quemLigarSection', '#obrasSolarSection', '#painelSolarSection', '#leadsSection', '#crmSection', '#redesSection',
  '#crm-det-bg', '#pv-bg', '#modal-completo', '#modal-venda', '#modal-socio', '#modal-duplicado', '#modal-novo-contato', '#histLinkModal', '.modal-overlay'];
const S = ':is(' + SECS.join(',') + ')';
const RAIZ = '#eletro-print,#doc-print,#ep-preview,#orcViewSection,#propostaSection,#expiradoSection,#loadingProposta,#marr,.celebra-overlay,.simshot,.ep-doc,.orc1,.nx-deck';
const G = ':not(:where(' + RAIZ + ') *)';
let src = fs.readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function splitTop(s) { const r = []; let d = 0, c = ''; for (const ch of s) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && d === 0) { r.push(c); c = ''; } else c += ch; } if (c.trim()) r.push(c); return r.map(x => x.trim()).filter(Boolean); }
function parte(p, tipo) {
  p = p.replace(/^@[SPQ] /, '');
  if (p.startsWith('html.io2')) return p;
  let pseudo = ''; const m = p.match(/((::[\w-]+(\([^)]*\))?)+)$/); if (m) { pseudo = m[1]; p = p.slice(0, -pseudo.length); }
  const ehRaiz = SECS.some(r => p === r || p.startsWith(r + ' ') || p.startsWith(r + ':') || p.startsWith(r + '.') || p.startsWith(r + '>') || p.startsWith(r + '[')); if (ehRaiz && tipo === 'S') tipo = 'P'; else if (ehRaiz && tipo === 'Q') tipo = 'Q0';
  if (tipo === 'Q0') return P + ':not(#_) ' + p + G + pseudo;
  return (tipo === 'Q' ? P + ':not(#_)' : P) + (tipo === 'S' || tipo === 'Q' ? ' ' + S : '') + ' ' + p + G + pseudo;
}
function sel(h) { h = h.trim(); let tipo = 'P'; if (h.startsWith('@Q ')) { tipo = 'Q'; h = h.slice(3); } else if (h.startsWith('@S ')) { tipo = 'S'; h = h.slice(3); } else if (h.startsWith('@P ')) h = h.slice(3); return splitTop(h).map(p => parte(p, tipo)).join(',\n'); }
function regras(txt) {
  let out = '', i = 0;
  while (i < txt.length) {
    const a = txt.indexOf('{', i); if (a < 0) break;
    const head = txt.slice(i, a).trim();
    let d = 1, j = a + 1; while (j < txt.length && d > 0) { if (txt[j] === '{') d++; else if (txt[j] === '}') d--; j++; }
    const corpo = txt.slice(a + 1, j - 1);
    if (head.startsWith('@media')) out += head.replace('@media ', '@media screen and ') + '{\n' + regras(corpo) + '}\n';
    else if (head.startsWith('@keyframes')) out += head + '{' + corpo + '}\n';
    else out += sel(head) + '{' + corpo.trim().replace(/\s*\n\s*/g, ' ') + '}\n';
    i = j;
  }
  return out;
}
const corpo = regras(src);
const cab = '/* io2-componentes.css: componentes do visual novo do /gerador (html.io2). Escrito a mao (fase 3b); gerado de uma fonte com atalhos por dashboard/scripts/gerador-io2-componentes.cjs.\n   Campo, rotulo, titulo, botao, cartao, indicador, tabela, aba, etiqueta, modal, toast, estados, trena e superficies do navegador.\n   Tudo sob html.io2[data-mode="app"] e dentro de @media screen. Documentos e o que vira PDF ficam de fora (guarda :not(:where(...) *)). */\n';
fs.writeFileSync(OUT, cab + '@media screen {\n' + corpo + '}\n');
console.log('ok', (cab.length + corpo.length), 'bytes,', (corpo.match(/\{/g) || []).length, 'blocos');
