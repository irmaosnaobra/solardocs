/**
 * PRINTS DA COLUNA DE COMENTARIOS DO INSTAGRAM → /irmaosnaobra
 *
 * O post: https://www.instagram.com/p/DYx8CyPplKy/ — aquele em que a empresa
 * pergunta "indicaria nossa empresa?" e os clientes respondem. A pagina publica
 * do post entrega os comentarios sem login; so' tem um modal por cima.
 *
 * POR QUE ASSIM E NAO RECORTANDO COMENTARIO POR COMENTARIO:
 * a lista de comentario do Instagram e' virtualizada e se remonta a cada
 * rolagem. Medir a caixa de um comentario e depois printar dava recorte em
 * cima de OUTRO comentario — e o fullPage do Chrome piora, porque redimensiona
 * a viewport e reflui tudo antes de capturar. Aqui e' do jeito que uma pessoa
 * faria com o PrtSc: rola a lista um pouco, printa a MESMA faixa da tela,
 * repete. Nao importa o que se remontou: o que estiver na tela e' capturado.
 *
 *   node scripts/build-prints-instagram.js
 *
 * Depois: conferir as tiras uma a uma antes de publicar. Se entrar comentario
 * novo no post, o numero de tiras muda — ajustar PRINTS_INSTAGRAM no dados.js.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('c:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');
const sharp = require('sharp');

const POST = 'https://www.instagram.com/p/DYx8CyPplKy/';
const SAIDA = path.join(__dirname, '..', 'public', 'irmaosnaobra', 'assets', 'img');
const ESC = 2;

(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=pt-BR'] });
  const p = await b.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await p.setViewport({ width: 1400, height: 1100, deviceScaleFactor: ESC });
  await p.goto(POST, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 5000));

  await p.evaluate(() => {
    document.querySelectorAll('[role="dialog"],[role="presentation"]').forEach((el) => {
      const t = el.innerText || '';
      if (/Cadastre-se|Entrar/i.test(t) && t.length < 600) el.remove();
    });
    document.querySelectorAll('*').forEach((el) => {
      if (getComputedStyle(el).position === 'fixed') el.style.display = 'none';
    });
  });
  await new Promise((r) => setTimeout(r, 1000));

  const col = await p.evaluate(() => {
    let alvo = null;
    document.querySelectorAll('div').forEach((el) => {
      const s = getComputedStyle(el);
      if (!/auto|scroll/.test(s.overflowY)) return;
      if (!/Responder/.test(el.innerText || '')) return;
      if (el.scrollHeight <= el.clientHeight + 10) return;
      if (!alvo || el.scrollHeight < alvo.scrollHeight) alvo = el;
    });
    if (!alvo) return null;
    alvo.id = 'lista-coms';
    const r = alvo.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
             h: Math.round(r.height), rolagem: alvo.scrollHeight };
  });
  if (!col) { console.log('nao achei a lista de comentario'); await b.close(); process.exit(1); }
  console.log('lista: ' + JSON.stringify(col));

  const tmp = path.join(SAIDA, '_tira.png');
  let n = 0;
  for (let pos = 0; pos < col.rolagem && n < 8; pos += col.h - 40) {
    await p.evaluate((y) => { document.getElementById('lista-coms').scrollTop = y; }, pos);
    await new Promise((r) => setTimeout(r, 900));
    n++;
    await p.screenshot({ path: tmp, clip: { x: col.x, y: col.y, width: col.w, height: col.h } });
    const destino = path.join(SAIDA, 'insta-' + n + '.webp');
    await sharp(tmp).resize(670, null, { withoutEnlargement: true }).webp({ quality: 82 }).toFile(destino);
    console.log('insta-' + n + '.webp  ' + (fs.statSync(destino).size / 1024).toFixed(1) + ' KB');
  }
  fs.unlinkSync(tmp);
  await b.close();
})();
