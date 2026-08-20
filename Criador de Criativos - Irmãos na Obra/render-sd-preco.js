/* Renderiza sd-preco-escondido.html (master 1080x1920) e recorta o feed.
   Roda: node render-sd-preco.js

   A GUARDA e' o ponto: antes de salvar, mede cada elemento e RECUSA se algum
   passar da janela segura y=250..1600. Peca de anuncio torta so' aparece depois
   de publicada, e ai' ja' gastou. */
const fs = require('fs');
const path = require('path');
const p = require('C:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');
const sharp = require('C:/Users/55349/Desktop/CLAUDE/dashboard/node_modules/sharp');

const TOPO = 250, JANELA = 1350, LARG = 1080, ALT = 1920;

(async () => {
  const f = path.join(__dirname, 'sd-preco-escondido.html');
  const url = 'file:///' + f.split(path.sep).join('/').split(' ').join('%20');

  const b = await p.launch({ headless: 'new', args: ['--no-sandbox'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: LARG, height: ALT, deviceScaleFactor: 1 });
  await pg.goto(url, { waitUntil: 'networkidle0' });
  await pg.evaluateHandle('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 1000));

  const check = await pg.evaluate(({ TOPO, JANELA, LARG }) => {
    const base = TOPO + JANELA;
    const fora = [];
    document.querySelectorAll('.art > *:not(.grain)').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.top < TOPO - 0.5 || r.bottom > base + 0.5 || r.left < -0.5 || r.right > LARG + 0.5) {
        fora.push(`${el.className}: y ${Math.round(r.top)}..${Math.round(r.bottom)} x ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    });
    // imagens que nao carregaram viram buraco no anuncio
    const quebradas = [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'));
    return { fora, quebradas };
  }, { TOPO, JANELA, LARG });

  if (check.quebradas.length) { console.error('IMAGEM QUEBRADA:', check.quebradas); process.exit(1); }
  if (check.fora.length) { console.error('VAZOU DA JANELA SEGURA:\n  ' + check.fora.join('\n  ')); process.exit(1); }

  const story = path.join(__dirname, 'sd-preco-escondido-story-1080x1920.png');
  await pg.screenshot({ path: story });
  await b.close();

  const feed = path.join(__dirname, 'sd-preco-escondido-feed-1080x1350.png');
  await sharp(story).extract({ left: 0, top: TOPO, width: LARG, height: JANELA }).toFile(feed);
  // mantem o nome antigo apontando pro feed, que e' o formato que ja' circulava
  await sharp(feed).toFile(path.join(__dirname, 'sd-preco-escondido.png'));

  const kb = (x) => Math.round(fs.statSync(x).size / 1024) + 'KB';
  console.log('janela segura: nada vazou, nenhuma imagem quebrada');
  console.log('story 1080x1920:', kb(story));
  console.log('feed  1080x1350:', kb(feed));
})();
