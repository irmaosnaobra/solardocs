/**
 * PRINT DE CADA COMENTARIO DO INSTAGRAM, UM POR CLIENTE → /irmaosnaobra
 *
 * O post: https://www.instagram.com/p/DYx8CyPplKy/ — aquele em que a empresa
 * pergunta "indicaria nossa empresa?" e os clientes respondem. A pagina publica
 * entrega os comentarios sem login; so' tem um modal por cima.
 *
 * O QUE NAO FUNCIONA, e por que (levei tres tentativas):
 *   - elementHandle.screenshot(): rola o elemento pra dentro da tela antes de
 *     recortar, e a lista de comentario do Instagram e' VIRTUALIZADA — ela se
 *     remonta durante a rolagem. O recorte caia em cima de outro comentario.
 *   - page.screenshot({fullPage:true}): o Chrome redimensiona a viewport pra
 *     altura toda antes de capturar, e o layout reflui nisso. Mesma coisa: a
 *     coordenada medida antes nao vale mais na hora do print.
 *
 * O QUE FUNCIONA: rolar A LISTA (nao a pagina), esperar assentar, medir o
 * comentario e printar com clip NO MESMO INSTANTE, sem nada rolar no meio.
 *
 *   node scripts/build-prints-instagram.js
 *
 * O @ nao e' marcado na imagem: quem destaca ele e' o site, num rotulo dourado
 * embaixo do print. Escrever em cima de um print e' comecar a editar prova.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('c:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');
const sharp = require('sharp');

const POST = 'https://www.instagram.com/p/DYx8CyPplKy/';
const SAIDA = path.join(__dirname, '..', 'public', 'irmaosnaobra', 'assets', 'img');
const ESC = 3;

// A ordem aqui e' a ordem que vai aparecer no site.
const HANDLES = [
  '_vida_com_proposito__', 'fgadia', 'granjaoliveiracarvalho', 'evertonjosebraga',
  'sthefano', 'cortes_marcio', 'martincleber', 'hvillela73', 'andrigojs',
  'mariperinstay', 'isa.valesca', 'contarimcarlos', 'luizantonionakano'
];

(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=pt-BR'] });
  const p = await b.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await p.setViewport({ width: 1400, height: 1500, deviceScaleFactor: ESC });
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

  const achouLista = await p.evaluate(() => {
    let alvo = null;
    document.querySelectorAll('div').forEach((el) => {
      const s = getComputedStyle(el);
      if (!/auto|scroll/.test(s.overflowY)) return;
      if (!/Responder/.test(el.innerText || '')) return;
      if (el.scrollHeight <= el.clientHeight + 10) return;
      if (!alvo || el.scrollHeight < alvo.scrollHeight) alvo = el;
    });
    if (!alvo) return false;
    alvo.id = 'lista-coms';
    return true;
  });
  if (!achouLista) { console.log('nao achei a lista de comentario'); await b.close(); process.exit(1); }

  const tmp = path.join(SAIDA, '_corte.png');
  const feitos = [];
  const faltou = [];

  // A lista e' virtualizada: item longe da viewport nem existe no DOM. Passar
  // uma vez do topo ao fim faz o Instagram montar todos, e a partir dai a busca
  // por @ acha qualquer um. Sem isto, o comentario mais longo (martincleber)
  // simplesmente nao era encontrado.
  await p.evaluate(async () => {
    const lista = document.getElementById('lista-coms');
    for (let y = 0; y < lista.scrollHeight; y += 300) {
      lista.scrollTop = y;
      await new Promise((r) => setTimeout(r, 120));
    }
    lista.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 1200));

  for (const handle of HANDLES) {
    // 1. rola A LISTA ate' o comentario, com folga em cima
    const posicionou = await p.evaluate((h) => {
      const lista = document.getElementById('lista-coms');
      let alvo = null;
      lista.querySelectorAll('div,li').forEach((el) => {
        const t = (el.innerText || '').trim();
        if (!t.startsWith(h) || !/Responder/.test(t)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 40) return;
        if (!alvo || r.height < alvo.getBoundingClientRect().height) alvo = el;
      });
      if (!alvo) return false;
      const topoLista = lista.getBoundingClientRect().top;
      lista.scrollTop += alvo.getBoundingClientRect().top - topoLista - 24;
      return true;
    }, handle);
    if (!posicionou) { faltou.push(handle); continue; }

    await new Promise((r) => setTimeout(r, 950)); // deixa a lista assentar

    // 2. mede e 3. printa, sem nada rolar entre uma coisa e outra
    let caixa = await p.evaluate((h) => {
      const lista = document.getElementById('lista-coms');
      let alvo = null;
      lista.querySelectorAll('div,li').forEach((el) => {
        const t = (el.innerText || '').trim();
        if (!t.startsWith(h) || !/Responder/.test(t)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 40) return;
        if (!alvo || r.height < alvo.getBoundingClientRect().height) alvo = el;
      });
      if (!alvo) return null;
      const r = alvo.getBoundingClientRect();
      const l = lista.getBoundingClientRect();
      // so' vale se o comentario couber INTEIRO dentro da lista visivel
      if (r.top < l.top - 1 || r.bottom > l.bottom + 1) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height, texto: alvo.innerText.trim() };
    }, handle);
    if (!caixa) {
      // comentario alto que nao coube: encosta ele no topo e mede de novo
      await p.evaluate((h) => {
        const lista = document.getElementById('lista-coms');
        let alvo = null;
        lista.querySelectorAll('div,li').forEach((el) => {
          const t = (el.innerText || '').trim();
          if (!t.startsWith(h) || !/Responder/.test(t)) return;
          const r = el.getBoundingClientRect();
          if (r.width < 200 || r.height < 40) return;
          if (!alvo || r.height < alvo.getBoundingClientRect().height) alvo = el;
        });
        if (alvo) lista.scrollTop += alvo.getBoundingClientRect().top -
                                    lista.getBoundingClientRect().top - 4;
      }, handle);
      await new Promise((r) => setTimeout(r, 950));
      caixa = await p.evaluate((h) => {
        const lista = document.getElementById('lista-coms');
        let alvo = null;
        lista.querySelectorAll('div,li').forEach((el) => {
          const t = (el.innerText || '').trim();
          if (!t.startsWith(h) || !/Responder/.test(t)) return;
          const r = el.getBoundingClientRect();
          if (r.width < 200 || r.height < 40) return;
          if (!alvo || r.height < alvo.getBoundingClientRect().height) alvo = el;
        });
        if (!alvo) return null;
        const r = alvo.getBoundingClientRect(), l = lista.getBoundingClientRect();
        if (r.top < l.top - 1 || r.bottom > l.bottom + 1) return null;
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, handle);
    }
    if (!caixa) { faltou.push(handle); continue; }

    const pad = 10;
    await p.screenshot({ path: tmp, clip: {
      x: Math.max(0, caixa.x - pad), y: Math.max(0, caixa.y - pad),
      width: caixa.w + pad * 2, height: caixa.h + pad * 2 } });

    const nome = 'insta-' + handle.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.webp';
    await sharp(tmp).resize(700, null, { withoutEnlargement: true })
      .webp({ quality: 86 }).toFile(path.join(SAIDA, nome));
    feitos.push({ handle, nome, kb: +(fs.statSync(path.join(SAIDA, nome)).size / 1024).toFixed(1) });
    console.log(nome.padEnd(42) + feitos[feitos.length - 1].kb + ' KB');
  }

  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  if (faltou.length) console.log('\nNAO SAIU: ' + faltou.join(', '));
  console.log('\n' + feitos.length + ' de ' + HANDLES.length + ' comentarios');
  await b.close();
})();
