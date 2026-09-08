/**
 * CONFERE SE O CORTE DAS FONTES DEIXOU ALGUMA LETRA SEM DESENHO.
 *
 * Cortar fonte economiza peso e tem UM risco: um caractere que ficou de fora
 * aparece na fonte do sistema, no meio da frase, e ninguem percebe ate' o
 * cliente ver. Este script abre a pagina, mexe em tudo que muda texto
 * (formulario inteiro, faixa de valor, detalhes abertos), le' cada caractere
 * que foi realmente desenhado — ja' com text-transform aplicado — e compara com
 * a faixa declarada no @font-face daquela familia.
 *
 *   node scripts/conferir-fontes-irmaosnaobra.js
 *
 * Saida limpa = nenhum caractere caiu fora. Rode depois de mexer em texto do
 * site ou no build-fontes-irmaosnaobra.js.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('c:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');

const RAIZ = path.resolve(path.join(__dirname, '..', 'public'));
const CSS = path.join(RAIZ, 'irmaosnaobra', 'assets', 'css', 'style.css');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

// as faixas que o @font-face declara, por familia
function faixasDeclaradas() {
  const css = fs.readFileSync(CSS, 'utf8');
  const porFamilia = {};
  for (const [, corpo] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const fam = /font-family:'([^']+)'/.exec(corpo)[1];
    const faixa = /unicode-range:([^;]+);/.exec(corpo)[1];
    porFamilia[fam] = faixa.split(',').map((f) => {
      const m = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(f.trim());
      const de = parseInt(m[1], 16);
      return [de, m[2] ? parseInt(m[2], 16) : de];
    });
  }
  return porFamilia;
}

const servidor = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.length > 1 && p.endsWith('/')) { r.writeHead(308, { location: p.slice(0, -1) }); return r.end(); }
  const a = !path.extname(p) ? path.join(RAIZ, p, 'index.html') : path.join(RAIZ, p);
  if (!a.startsWith(RAIZ) || !fs.existsSync(a)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TIPOS[path.extname(a)] || 'application/octet-stream' });
  fs.createReadStream(a).pipe(r);
});

(async () => {
  const faixas = faixasDeclaradas();
  await new Promise((r) => servidor.listen(4671, r));
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto('http://localhost:4671/irmaosnaobra/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // mexe em tudo que troca texto na tela
  await p.evaluate(() => {
    const marca = (n, v) => {
      const i = [...document.querySelectorAll('input[name=' + n + ']')].find((x) => x.value === v);
      if (i) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    ['Casa', 'Comércio', 'Zona rural'].forEach((v) => marca('tipo', v));
    ['mono', 'bi', 'tri'].forEach((v) => marca('ligacao', v));
    ['Presencial', 'Ligação', 'Chamada de vídeo', 'WhatsApp'].forEach((v) => marca('atendimento', v));
    const c = document.getElementById('cidade');
    [...c.options].forEach((o) => { c.value = o.value; c.dispatchEvent(new Event('change')); });
    const s = document.getElementById('conta');
    [150, 300, 550, 800, 1000, 1500, 2000, 3000].forEach((v) => {
      s.value = v; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
    });
    document.getElementById('btn-resultado').click();
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
  });
  await new Promise((r) => setTimeout(r, 700));

  const usado = await p.evaluate(() => {
    const porFamilia = {};
    const guarda = (fam, texto) => {
      (porFamilia[fam] = porFamilia[fam] || {});
      for (const ch of texto) porFamilia[fam][ch] = true;
    };
    const anda = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let no;
    while ((no = anda.nextNode())) {
      if (!(no.textContent || '').trim()) continue;
      const el = no.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      let t = no.textContent;
      if (cs.textTransform === 'uppercase') t = t.toLocaleUpperCase('pt-BR');
      else if (cs.textTransform === 'lowercase') t = t.toLocaleLowerCase('pt-BR');
      else if (cs.textTransform === 'capitalize') t += t.toLocaleUpperCase('pt-BR');
      guarda(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), t);
    }
    document.querySelectorAll('*').forEach((el) => {
      ['::before', '::after'].forEach((pe) => {
        const cs = getComputedStyle(el, pe);
        if (!cs.content || cs.content === 'none' || cs.content === 'normal') return;
        guarda(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
          cs.content.replace(/^["']|["']$/g, ''));
      });
    });
    const saida = {};
    for (const k in porFamilia) saida[k] = Object.keys(porFamilia[k]).join('');
    return saida;
  });

  let problemas = 0;
  for (const fam in usado) {
    const declarada = faixas[fam];
    if (!declarada) { console.log('  (fonte do sistema, sem corte: ' + fam + ')'); continue; }
    const fora = [...new Set([...usado[fam]])].filter((ch) => {
      const cp = ch.codePointAt(0);
      if (cp < 0x21) return false; // espaco e quebra de linha nao desenham nada
      return !declarada.some(([de, ate]) => cp >= de && cp <= ate);
    });
    if (fora.length) {
      problemas += fora.length;
      console.log('\n  FALTA EM ' + fam + ':');
      fora.forEach((ch) => console.log('    "' + ch + '"  U+'
        + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')));
    } else {
      console.log('  ok  ' + fam.padEnd(20) + [...new Set([...usado[fam]])].length
        + ' caracteres, todos cobertos');
    }
  }

  await b.close(); servidor.close();
  if (problemas) {
    console.log('\n' + problemas + ' caractere(s) sem desenho — vao aparecer na fonte do sistema.');
    process.exit(1);
  }
  console.log('\nnenhum caractere caiu fora do corte.');
})();
