const puppeteer = require('puppeteer');
const path = require('path');

const dir = __dirname;
const creatives = [
  // base
  { file: 'feed-1080x1080.html', out: 'feed-1080x1080.png', w: 1080, h: 1080 },
  { file: 'feed-1080x1350.html', out: 'feed-1080x1350.png', w: 1080, h: 1350 },
  { file: 'story-1080x1920.html', out: 'story-1080x1920.png', w: 1080, h: 1920 },
  // ângulo economia
  { file: 'economia-feed-1080x1080.html', out: 'economia-feed-1080x1080.png', w: 1080, h: 1080 },
  { file: 'economia-story-1080x1920.html', out: 'economia-story-1080x1920.png', w: 1080, h: 1920 },
  // ângulo prova social
  { file: 'prova-feed-1080x1080.html', out: 'prova-feed-1080x1080.png', w: 1080, h: 1080 },
  { file: 'prova-story-1080x1920.html', out: 'prova-story-1080x1920.png', w: 1080, h: 1920 },
  // ângulo garantia / medo
  { file: 'garantia-feed-1080x1080.html', out: 'garantia-feed-1080x1080.png', w: 1080, h: 1080 },
  { file: 'garantia-story-1080x1920.html', out: 'garantia-story-1080x1920.png', w: 1080, h: 1920 },
];

(async () => {
  console.log('Iniciando puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new' });
  for (const c of creatives) {
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 2 });
    const url = 'file:///' + path.join(dir, c.file).replace(/\\/g, '/');
    console.log('Renderizando', c.file);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(dir, c.out), type: 'png', clip: { x: 0, y: 0, width: c.w, height: c.h } });
    await page.close();
    console.log('  ->', c.out);
  }
  await browser.close();
  console.log('Pronto. Criativos em', dir);
})();
