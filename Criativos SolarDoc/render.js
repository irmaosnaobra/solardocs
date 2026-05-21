// Render do criativo HTML pra PNG 1080x1080. Roda com:
//   node render.js
const p = require('C:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');
const path = require('path');

(async () => {
  const file = path.join(__dirname, 'criativo-gerador-proposta.html');
  const out  = path.join(__dirname, 'criativo-gerador-proposta.png');
  const url  = 'file:///' + file.replace(/\\/g, '/').replace(/ /g, '%20');

  const b = await p.launch({ headless: 'new' });
  const pg = await b.newPage();
  // Viewport um pouco maior que o criativo pra evitar squeeze do flex do body.
  await pg.setViewport({ width: 1200, height: 1200, deviceScaleFactor: 2 });
  await pg.goto(url, { waitUntil: 'networkidle0' });

  // espera fontes carregarem
  await pg.evaluateHandle('document.fonts.ready');

  // mira o elemento .creative pra cortar exato (sem margens do body)
  const el = await pg.$('.creative');
  await el.screenshot({ path: out, omitBackground: false });

  console.log('OK:', out);
  await b.close();
})();
