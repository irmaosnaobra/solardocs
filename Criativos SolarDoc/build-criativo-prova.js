/* Criativo "prova de cliente" — master 1080x1920 com TODO o conteudo dentro do
   retangulo seguro de 1080x1350 que comeca em y=250. E' isso que faz o feed
   (recorte central) e o story (peca inteira) sairem sem cortar nada.

   Roda:  node build-criativo-prova.js
   Depois: python gerar-formatos.py criativo-prova.png

   As imagens entram embutidas em base64 de proposito: file:// com espaco no
   caminho ("Criativos SolarDoc") quebra o carregamento relativo no puppeteer, e
   a peca precisa renderizar identica em qualquer maquina. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');

const RAIZ = 'C:/Users/55349/Desktop/CLAUDE';
const AQUI = __dirname;

const b64 = (p) => 'data:image/webp;base64,' + fs.readFileSync(p).toString('base64');

const LOGOS = [
  'grilo-energia', 'american-energy-solar', 'rsc-solar',
  'forca-solar', 'gsi-solucoes', 'alves-cardoso-solar',
].map((n) => ({ n, uri: b64(`${RAIZ}/dashboard/public/logos/${n}.webp`) }));

const MOCKUP = b64(`${RAIZ}/dashboard/public/hero-orcamento.webp`);

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1920px;background:#0B1120;overflow:hidden;
    font-family:'Segoe UI',system-ui,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  /* brilho ambar no canto de cima, escurecendo pra baixo */
  .luz{position:absolute;inset:0;
    background:radial-gradient(1100px 800px at 78% 6%, rgba(245,158,11,.20), transparent 62%),
               radial-gradient(900px 700px at 12% 100%, rgba(11,17,32,.9), transparent 60%)}

  /* O RETANGULO SEGURO. Tudo vive aqui: no story aparece inteiro com respiro em
     cima e embaixo; no feed ele E' a imagem. Nada pode vazar daqui. */
  .quadro{position:absolute;left:0;top:250px;width:1080px;height:1350px;
    padding:0 68px;display:flex;flex-direction:column}

  .marca{display:flex;align-items:center;gap:14px;margin-bottom:6px}
  .marca .nome{font-size:34px;font-weight:800;letter-spacing:-.02em;color:#F8FAFC}
  .marca .nome i{font-style:normal;color:#F59E0B}
  .marca .risco{flex:1;height:1px;background:rgba(245,158,11,.35)}
  .marca .tag{font-size:15px;font-weight:700;letter-spacing:.18em;color:#94A3B8}

  h1{margin-top:26px;font-size:82px;line-height:1.02;font-weight:800;
    letter-spacing:-.035em;color:#F8FAFC;text-transform:uppercase}
  h1 em{font-style:normal;color:#F59E0B}
  .sub{margin-top:20px;font-size:27px;line-height:1.4;color:#94A3B8;max-width:880px}
  .sub b{color:#F8FAFC;font-weight:600}

  /* CARD DE PRECO */
  .preco{margin-top:30px;display:flex;align-items:center;gap:26px;
    background:linear-gradient(135deg,#16213c,#0F172A);
    border:2px solid rgba(245,158,11,.45);border-radius:24px;padding:24px 32px}
  .preco .val{font-size:86px;line-height:1;font-weight:800;letter-spacing:-.045em;color:#F59E0B}
  .preco .val span{font-size:32px;color:#F8FAFC;font-weight:700;letter-spacing:0}
  .preco .txt{font-size:24px;line-height:1.35;color:#F8FAFC;font-weight:600}
  .preco .txt small{display:block;font-size:19px;color:#94A3B8;font-weight:400;margin-top:5px}

  /* MOCKUP — abaixo do card de preco */
  .mock{margin-top:24px;text-align:center}
  .mock img{width:760px;height:auto;display:block;margin:0 auto;
    filter:drop-shadow(0 26px 46px rgba(0,0,0,.55))}

  /* PROVA — as pastilhas TODAS DO MESMO TAMANHO. E' o que alinha a fileira:
     a logo varia de proporcao, a caixa branca nao. */
  .prova{margin-top:auto;padding-top:18px}
  .prova .rot{font-size:17px;font-weight:700;letter-spacing:.16em;color:#94A3B8;
    text-align:center;margin-bottom:14px}
  .fila{display:flex;justify-content:center;gap:12px}
  .chip{width:148px;height:74px;background:#fff;border-radius:14px;
    display:flex;align-items:center;justify-content:center;padding:10px}
  .chip img{max-width:118px;max-height:52px;width:auto;height:auto;object-fit:contain;display:block}

  .pe{margin-top:22px;display:flex;align-items:center;justify-content:space-between}
  .pe .site{font-size:31px;font-weight:800;color:#F8FAFC;letter-spacing:-.02em}
  .pe .cta{font-size:23px;font-weight:800;color:#0B1120;letter-spacing:-.01em;
    background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:999px;padding:16px 34px}
</style></head><body>
<div class="luz"></div>
<div class="quadro">

  <div class="marca">
    <div class="nome">SolarDoc<i>.App</i></div>
    <div class="risco"></div>
    <div class="tag">PRA INTEGRADOR COM CNPJ</div>
  </div>

  <h1>O cliente não sumiu.<br>Ele não entendeu<br><em>quanto ia economizar</em>.</h1>

  <p class="sub">A proposta sai com o <b>número escrito</b> — quanto ele paga hoje, quanto vai
    pagar e em quanto tempo se paga. Numa folha só.</p>

  <div class="preco">
    <div class="val">R$ 67<span>/mês</span></div>
    <div class="txt">Tudo liberado, sem versão capada.
      <small>Cancela quando quiser · 10 documentos grátis pra testar</small></div>
  </div>

  <div class="mock"><img src="${MOCKUP}" alt=""></div>

  <div class="prova">
    <div class="rot">EMPRESAS QUE JÁ GERAM PROPOSTA AQUI</div>
    <div class="fila">
      ${LOGOS.map((l) => `<div class="chip"><img src="${l.uri}" alt=""></div>`).join('\n      ')}
    </div>
  </div>

  <div class="pe">
    <div class="site">solardoc.app</div>
    <div class="cta">Fazer minha primeira proposta</div>
  </div>

</div></body></html>`;

(async () => {
  const tmp = path.join(AQUI, '_criativo-prova.html');
  fs.writeFileSync(tmp, html, 'utf8');

  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await nav.newPage();
  await p.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await p.goto('file:///' + tmp.replace(/\\/g, '/').replace(/ /g, '%20'), { waitUntil: 'networkidle0' });
  await p.evaluateHandle('document.fonts.ready');

  // GUARDA: nada pode passar do retangulo seguro, senao o feed corta.
  const vaza = await p.evaluate(() => {
    const q = document.querySelector('.quadro');
    const lim = { topo: 250, base: 250 + 1350, esq: 0, dir: 1080 };
    const fora = [];
    q.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.top < lim.topo - 0.5 || r.bottom > lim.base + 0.5 || r.left < lim.esq - 0.5 || r.right > lim.dir + 0.5) {
        fora.push(`${el.className || el.tagName} → ${Math.round(r.top)}..${Math.round(r.bottom)} / ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    });
    const q2 = q.getBoundingClientRect();
    return { fora, quadro: `${Math.round(q2.top)}..${Math.round(q2.bottom)}`, sobra: Math.round(lim.base - q.scrollHeight - lim.topo) };
  });

  const out = path.join(AQUI, 'criativo-prova.png');
  await p.screenshot({ path: out });
  await nav.close();
  fs.unlinkSync(tmp);

  console.log('quadro seguro:', vaza.quadro, '(esperado 250..1600)');
  console.log('elementos vazando:', vaza.fora.length ? vaza.fora : 'nenhum');
  console.log('gerado:', out);
})();
