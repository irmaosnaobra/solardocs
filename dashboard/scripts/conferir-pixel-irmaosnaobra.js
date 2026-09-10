/**
 * CONFERE O PIXEL DO /irmaosnaobra OLHANDO O QUE SAI PRA META.
 *
 * Nao le' o codigo: abre a pagina, faz o caminho de um lead de verdade
 * (rola, responde as cinco, clica no botao) e intercepta cada chamada pro
 * facebook.com/tr, que e' por onde o pixel manda evento. O que aparecer aqui
 * e' o que o Gerenciador de Eventos vai receber.
 *
 *   node scripts/conferir-pixel-irmaosnaobra.js            (local)
 *   node scripts/conferir-pixel-irmaosnaobra.js --ar       (no dominio)
 *
 * Por que existe: evento de pixel falha calado. A pagina continua linda, o
 * lead continua chegando no WhatsApp, e a campanha otimiza no escuro por
 * semanas porque o `Lead` nunca chegou.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('c:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');

const NO_AR = process.argv.includes('--ar');
const RAIZ = path.resolve(path.join(__dirname, '..', 'public'));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const servidor = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.length > 1 && p.endsWith('/')) { r.writeHead(308, { location: p.slice(0, -1) }); return r.end(); }
  const a = !path.extname(p) ? path.join(RAIZ, p, 'index.html') : path.join(RAIZ, p);
  if (!a.startsWith(RAIZ) || !fs.existsSync(a)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TIPOS[path.extname(a)] || 'application/octet-stream' });
  fs.createReadStream(a).pipe(r);
});

// o pixel manda tudo por GET em facebook.com/tr, com o evento na query
function lerEvento(url) {
  const u = new URL(url);
  const q = u.searchParams;
  const dados = {};
  for (const [k, v] of q) {
    const m = /^cd\[(.+)\]$/.exec(k);
    if (m) dados[m[1]] = v;
  }
  return { evento: q.get('ev'), pixel: q.get('id'), dados };
}

(async () => {
  const base = NO_AR ? 'https://solardoc.app' : 'http://localhost:4690';
  if (!NO_AR) await new Promise((r) => servidor.listen(4690, r));

  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // OBRIGATORIO. O fbevents.js nao manda evento nenhum quando o navegador se
  // identifica como automatizado (o padrao do headless traz "HeadlessChrome"
  // no user-agent). Sem esta linha o teste acusa "pixel mudo" numa pagina que
  // esta' perfeita — foi o que aconteceu comigo aqui.
  await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
    + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  const saiu = [];
  p.on('request', (r) => {
    const u = r.url();
    if (u.includes('facebook.com/tr')) saiu.push(lerEvento(u));
  });
  // Duas coisas sao barradas de proposito:
  //   wa.me   — o clique abriria o WhatsApp de verdade
  //   /tr     — e' o evento indo pra Meta. Registro que ele SAIU e aborto: um
  //             teste nao pode sujar o Gerenciador de Eventos com lead falso.
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('https://wa.me/') || u.includes('facebook.com/tr')) return r.abort();
    r.continue();
  });

  await p.goto(base + '/irmaosnaobra/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('1. abriu a pagina');

  // rola ate' o simulador, como um visitante faria
  await p.evaluate(() => document.getElementById('simulador').scrollIntoView());
  await new Promise((r) => setTimeout(r, 2500));
  console.log('2. rolou ate o simulador');

  const marca = async (nome, valor) => {
    await p.evaluate((n, v) => {
      const i = [...document.querySelectorAll('input[name=' + n + ']')].find((x) => x.value === v);
      i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true }));
    }, nome, valor);
    await new Promise((r) => setTimeout(r, 400));
  };

  await marca('tipo', 'Casa');
  console.log('3. respondeu a primeira');
  await p.evaluate(() => {
    const c = document.getElementById('cidade');
    c.value = 'Araguari'; c.dispatchEvent(new Event('change'));
  });
  await marca('ligacao', 'bi');
  await p.evaluate(() => {
    const s = document.getElementById('conta');
    s.value = 1500; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
  });
  await marca('atendimento', 'Presencial');
  await new Promise((r) => setTimeout(r, 800));
  console.log('4. completou as cinco');

  await p.evaluate(() => document.getElementById('btn-zap-simulador').click());
  await new Promise((r) => setTimeout(r, 2500));
  console.log('5. clicou pra falar com o consultor\n');

  await b.close();
  if (!NO_AR) servidor.close();

  if (!saiu.length) {
    console.log('NENHUM EVENTO SAIU. O pixel nao esta disparando.');
    process.exit(1);
  }

  console.log('=== o que a Meta recebeu ===');
  saiu.forEach((e) => {
    console.log('\n  ' + e.evento + '   (pixel ' + e.pixel + ')');
    const chaves = Object.keys(e.dados);
    if (!chaves.length) return console.log('     sem parametros');
    chaves.forEach((k) => console.log('     ' + k.padEnd(18) + e.dados[k]));
  });

  const esperados = ['PageView', 'ViewContent', 'SimulacaoIniciada', 'SimulacaoCompleta', 'Lead'];
  const vieram = saiu.map((e) => e.evento);
  const faltando = esperados.filter((x) => !vieram.includes(x));
  console.log('\n' + (faltando.length ? 'FALTOU: ' + faltando.join(', ') : 'os 5 eventos sairam.'));
  if (faltando.length) process.exit(1);
})();
