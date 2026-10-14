// Expande gerador-io2-componentes.src.css em dashboard/public/gerador/ui/io2-componentes.css.
// A folha publicada e GERADA: edite o .src.css e rode `node dashboard/scripts/gerador-io2-componentes.cjs`.
// Atalhos no .src.css: "@S x" = prefixo + secoes de app + x; "@Q x" = igual, com um :not(#_) a mais (vence regra @S); "@P x" = so o prefixo.
// Seletor que comeca por html.io2 passa como esta.
//
// Decisoes de custo de desenho (medidas; ver o relatorio da etapa):
//  - Sem guarda de documento: nenhum conteiner de documento mora dentro das secoes de app (todos os hosts sao filhos diretos do <body>).
//  - Lista :is(a, b, c) no sujeito vira um seletor por alternativa: :is() no sujeito cai no balde universal e todo elemento paga por ele.
//  - Saida plana. Aninhamento CSS e @scope encurtam a folha, mas custaram mais tempo de estilo (IO2_MODO=aninhado|scope so para medir).
const fs = require('fs');
const SRC = process.env.IO2_FONTE || __dirname + '/gerador-io2-componentes.src.css';
const OUT = require('path').join(__dirname, '..', 'public', 'gerador', 'ui', 'io2-componentes.css');
const MODO = process.env.IO2_MODO || 'plano';
const P = 'html.io2[data-mode="app"]:not(#_):not(#_):not(#_)';
const SECS = ['#inicioSection', '#formSection', '#historicoSection', '#calcSection', '#eletroSection', '#automacaoSection', '#tabelasSection',
  '#fechamentoSolarSection', '#quemLigarSection', '#obrasSolarSection', '#painelSolarSection', '#planilhaSolarSection', '#documentosSolarSection', '#leadsSection', '#crmSection', '#redesSection',
  '#crm-det-bg', '#pv-bg', '#modal-completo', '#modal-venda', '#modal-socio', '#modal-duplicado', '#modal-novo-contato', '#histLinkModal', '.modal-overlay'];
const S = ':is(' + SECS.join(',') + ')';
const PREF = { P: P, S: P + ' ' + S, Q: P + ':not(#_) ' + S, Q0: P + ':not(#_)' };
const NL = String.fromCharCode(10);
const src = fs.readFileSync(SRC, 'utf8').replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function splitTop(s) {
  const r = []; let d = 0, c = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') d++;
    if (ch === ')' || ch === ']') d--;
    if (ch === ',' && d === 0) { r.push(c); c = ''; } else c += ch;
  }
  if (c.trim()) r.push(c);
  return r.map(x => x.trim()).filter(Boolean);
}
// primeiro :is( de profundidade zero vira uma alternativa por item
function expandirIs(p) {
  let d = 0;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    else if (d === 0 && p.startsWith(':is(', i)) {
      let k = i + 4, dd = 1;
      while (k < p.length && dd > 0) { if (p[k] === '(') dd++; else if (p[k] === ')') dd--; k++; }
      const antes = p.slice(0, i), depois = p.slice(k);
      return splitTop(p.slice(i + 4, k - 1)).flatMap(a => expandirIs(antes + a + depois));
    }
  }
  return [p];
}
// Especificidade [id, classe, tag] de um seletor. :is()/:not()/:has() valem o maior argumento, :where() vale zero.
function ident(s, i) { while (i < s.length && /[\w-]|[^\x00-\x7f]/.test(s[i])) i++; return i; }
function parens(s, i) { let d = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') { d--; if (d === 0) return i + 1; } } return i; }
const maiorSpec = l => l.reduce((m, x) => (x[0] - m[0] || x[1] - m[1] || x[2] - m[2]) > 0 ? x : m, [0, 0, 0]);
function spec(s) {
  let a = 0, b = 0, c = 0, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { a++; i = ident(s, i + 1); }
    else if (ch === '.') { b++; i = ident(s, i + 1); }
    else if (ch === '[') { b++; i = s.indexOf(']', i) + 1; }
    else if (ch === ':') {
      if (s[i + 1] === ':') { c++; i = ident(s, i + 2); if (s[i] === '(') i = parens(s, i); }
      else {
        const j = ident(s, i + 1), nome = s.slice(i + 1, j);
        if (s[j] === '(') {
          const k = parens(s, j), arg = s.slice(j + 1, k - 1);
          if (nome === 'where') { /* zero */ }
          else if (nome === 'not' || nome === 'is' || nome === 'matches' || nome === 'has') { const m = maiorSpec(splitTop(arg).map(spec)); a += m[0]; b += m[1]; c += m[2]; }
          else if (/^nth-(last-)?child$/.test(nome)) { b++; const o = arg.indexOf(' of '); if (o >= 0) { const m = maiorSpec(splitTop(arg.slice(o + 4)).map(spec)); a += m[0]; b += m[1]; c += m[2]; } }
          else b++;
          i = k;
        } else { b++; i = j; }
      }
    }
    else if (/[a-zA-Z_]/.test(ch) || ch === '\\') { c++; i = ident(s, i); }
    else i++;
  }
  return [a, b, c];
}
// Abrir um :is() em alternativas baixa a especificidade das menores para a da propria alternativa; o original valia a maior.
// Cada alternativa recebe de volta o que falta (bobagens que nunca casam: #_ , .__ , zz) para o cascade ficar como estava.
const AVISOS = [];
function completar(orig, x) {
  const o = spec(orig), v = spec(x);
  if (v[0] > o[0] || (v[0] === o[0] && v[1] > o[1])) AVISOS.push(x);
  const d = [Math.max(o[0] - v[0], 0), Math.max(o[1] - v[1], 0), Math.max(o[2] - v[2], 0)];
  if (!d[0] && !d[1] && !d[2]) return x;
  const m = x.match(/((::[\w-]+(\([^)]*\))?)+)$/), ps = m ? m[1] : '';
  return (ps ? x.slice(0, -ps.length) : x) + ':not(#_)'.repeat(d[0]) + ':not(.__)'.repeat(d[1]) + ':not(zz)'.repeat(d[2]) + ps;
}
const ehRaizDeSecao = p => SECS.some(r => p === r || p.startsWith(r + ' ') || p.startsWith(r + ':') || p.startsWith(r + '.') || p.startsWith(r + '>') || p.startsWith(r + '['));
// cabeca da regra -> [{ pref, rest }]; pref vazio = seletor cru
function partes(h) {
  h = h.trim(); let tipo = 'P';
  if (h.startsWith('@Q ')) { tipo = 'Q'; h = h.slice(3); } else if (h.startsWith('@S ')) { tipo = 'S'; h = h.slice(3); } else if (h.startsWith('@P ')) h = h.slice(3);
  const out = [];
  for (let p of splitTop(h)) {
    p = p.replace(/^@[SPQ] /, '');
    if (p.startsWith('html.io2')) { out.push({ pref: '', rest: p }); continue; }
    for (const x of new Set(expandirIs(p))) {
      let t = tipo;
      if (ehRaizDeSecao(x)) t = tipo === 'Q' ? 'Q0' : 'P';
      out.push({ pref: PREF[t], rest: completar(p, x) });
    }
  }
  return out;
}
function emitir(itens) {
  let out = '', i = 0;
  while (i < itens.length) {
    const it = itens[i];
    if (it.raw !== undefined) { out += it.raw; i++; continue; }
    if (MODO === 'plano' || it.pref === '') {
      let j = i; const sels = [];
      while (j < itens.length && itens[j].raw === undefined && itens[j].rid === it.rid) { sels.push(itens[j].pref === '' ? itens[j].rest : itens[j].pref + ' ' + itens[j].rest); j++; }
      out += sels.join(',' + NL) + '{' + it.body + '}' + NL; i = j; continue;
    }
    let j = i; const grupo = [];
    while (j < itens.length && itens[j].pref === it.pref) { grupo.push(itens[j]); j++; }
    const regs = [];
    for (const g of grupo) { const u = regs[regs.length - 1]; if (u && u.rid === g.rid) u.sels.push(g.rest); else regs.push({ rid: g.rid, body: g.body, sels: [g.rest] }); }
    if (MODO === 'aninhado') out += it.pref + '{' + NL + regs.map(r => r.sels.map(x => '& ' + x).join(', ') + '{' + r.body + '}').join(NL) + NL + '}' + NL;
    else {
      const raiz = it.pref.replace(/:not\(#_\)/g, '');
      const mais = x => { const m = x.match(/((::[\w-]+(\([^)]*\))?)+)$/); const ps = m ? m[1] : ''; return (ps ? x.slice(0, -ps.length) : x) + ':not(#_):not(#_):not(#_):not(#_)' + ps; };
      out += '@scope (' + raiz + '){' + NL + regs.map(r => r.sels.map(mais).join(', ') + '{' + r.body + '}').join(NL) + NL + '}' + NL;
    }
    i = j;
  }
  return out;
}
function regras(txt) {
  const itens = []; let i = 0, rid = 0;
  while (i < txt.length) {
    const a = txt.indexOf('{', i); if (a < 0) break;
    const head = txt.slice(i, a).trim();
    let d = 1, j = a + 1;
    while (j < txt.length && d > 0) { if (txt[j] === '{') d++; else if (txt[j] === '}') d--; j++; }
    const corpo = txt.slice(a + 1, j - 1);
    if (head.startsWith('@media')) itens.push({ raw: head.replace('@media ', '@media screen and ') + '{' + NL + regras(corpo) + '}' + NL });
    else if (head.startsWith('@keyframes')) itens.push({ raw: head + '{' + corpo + '}' + NL });
    else {
      const body = corpo.trim().replace(/\s*\n\s*/g, ' '); rid++;
      for (const pt of partes(head)) itens.push({ pref: pt.pref, rest: pt.rest, body, rid });
    }
    i = j;
  }
  return emitir(itens);
}
const corpo = regras(src);
const cab = '/* io2-componentes.css: componentes do visual novo do /gerador (html.io2). GERADO por dashboard/scripts/gerador-io2-componentes.cjs a partir de gerador-io2-componentes.src.css: nao edite a mao.' + NL +
  '   Campo, rotulo, titulo, botao, cartao, indicador, tabela, aba, etiqueta, modal, toast, estados, trena e superficies do navegador.' + NL +
  '   Tudo sob html.io2[data-mode="app"] e dentro de @media screen. Documentos e o que vira PDF ficam de fora: nenhum documento mora dentro das secoes de app. */' + NL;
const saida = cab + '@media screen {' + NL + corpo + '}' + NL;
fs.writeFileSync(process.env.IO2_SAIDA || OUT, saida);
if (AVISOS.length) console.error('AVISO especificidade maior que a do original em', AVISOS.length, 'seletores:', AVISOS.slice(0, 5).join(' | '));
console.log('ok', saida.length, 'bytes,', (corpo.match(/\{/g) || []).length, 'blocos', MODO);
