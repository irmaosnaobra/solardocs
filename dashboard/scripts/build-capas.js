/**
 * AS 3 CAPAS DE PRODUTO, 300x250 (o tamanho do painel da Kiwify).
 *
 * As primeiras usavam a paleta do APP (#0F172A, laranja #F26513) e a fonte
 * Nunito. As LPs agora falam a lingua da /kit — #080d18 de fundo e ambar
 * #f7a41c — entao a capa que a pessoa ve' no checkout batia diferente da
 * pagina de onde ela veio. Refeitas na paleta certa, com o notebook e a tela
 * do produto dentro.
 *
 *   node scripts/build-capas.js
 */
const p = require('c:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'c:/Users/55349/Desktop/CLAUDE/dashboard/public/capas';

const CAPAS = [
  {
    arquivo: 'calculadora-solar',
    nome: 'Calculadora<br>Solar',
    linha: 'O preço certo, com a sua margem à vista.',
    preco: '67',
    tela: `
      <div class="l"><span>Custo total da obra</span><b>R$ 24.210</b></div>
      <div class="l"><span>Sua margem</span><b class="am">28%</b></div>
      <div class="barra"><i style="width:58%"></i></div>
      <div class="cards">
        <div class="c"><span>Preço</span><b>R$ 33.156</b></div>
        <div class="c bom"><span>Sobra</span><b>R$ 9.284</b></div>
      </div>`,
  },
  {
    arquivo: 'inventario-empresarial',
    nome: 'Inventário<br>Empresarial',
    linha: 'Onde está cada ferramenta — e quanto vale.',
    preco: '67',
    tela: `
      <div class="l"><span>Furadeira · Veículo 1</span><b>R$ 890</b></div>
      <div class="l"><span>Andaime 1,5 m</span><b>R$ 1.180</b></div>
      <div class="l rui"><span>Conector MC4 · mín. 40</span><b>restam 6</b></div>
      <div class="cards">
        <div class="c"><span>Patrimônio</span><b>R$ 82.615</b></div>
        <div class="c bom"><span>Locais</span><b>4</b></div>
      </div>`,
  },
  {
    arquivo: 'dimensionamento-off-grid',
    nome: 'Dimensionamento<br>Off-Grid',
    linha: 'O kit isolado dimensionado na hora.',
    preco: '97',
    tela: `
      <div class="l"><span>Consumo por dia</span><b>8,4 kWh</b></div>
      <div class="l"><span>Banco de baterias</span><b>19,2 kWh</b></div>
      <div class="barra"><i style="width:88%"></i></div>
      <div class="cards">
        <div class="c"><span>Kit + frete</span><b>R$ 44.700</b></div>
        <div class="c bom"><span>Sem sol</span><b>2 dias</b></div>
      </div>`,
  },
];

const html = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:300px;height:250px;overflow:hidden;position:relative;
       background:#080d18;color:#f4f7fb;
       font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
  /* o mesmo brilho ambar do heroi da /kit */
  .brilho{position:absolute;width:340px;height:250px;left:-90px;top:-120px;border-radius:50%;
    background:radial-gradient(circle,rgba(247,164,28,.34),transparent 68%);filter:blur(38px)}
  .grade{position:absolute;inset:0;
    background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
    background-size:28px 28px;
    -webkit-mask-image:radial-gradient(ellipse at 26% 22%,#000 24%,transparent 76%)}
  .topo{position:absolute;top:0;left:0;right:0;height:3px;
    background:linear-gradient(90deg,#f7a41c,rgba(247,164,28,.16))}
  .miolo{position:relative;height:100%;padding:19px 18px 15px;display:flex;flex-direction:column}
  .selo{display:inline-block;align-self:flex-start;font-size:7.5px;font-weight:800;
    letter-spacing:.17em;text-transform:uppercase;color:#f7a41c;
    background:rgba(247,164,28,.1);border:1px solid rgba(247,164,28,.3);
    padding:4px 9px;border-radius:99px;margin-bottom:10px}
  h1{font-size:22px;line-height:1.05;letter-spacing:-.028em;font-weight:800;margin-bottom:7px;max-width:62%}
  .sub{font-size:10.5px;line-height:1.35;color:#93a3b8;max-width:48%}
  /* notebook, encostado na quina de baixo */
  /* Sangra so' 14px, e a tela reserva 22px a' direita: com -24px o corte caia
     no meio do numero ("R$ 24.2...") e lia como imagem quebrada, nao como
     recorte de propósito. */
  .note{position:absolute;right:-14px;bottom:16px;width:152px}
  .tampa{background:#0b1320;border:5px solid #1b2740;border-bottom-width:3px;
    border-radius:8px 8px 3px 3px;overflow:hidden;
    box-shadow:0 18px 34px -16px rgba(0,0,0,.95)}
  .barraTopo{display:flex;align-items:center;gap:3px;padding:4px 6px;
    background:#0e1728;border-bottom:1px solid rgba(148,163,184,.16)}
  .barraTopo i{width:3.5px;height:3.5px;border-radius:50%;background:#33415c;display:block}
  .tela{padding:7px 24px 9px 8px;font-size:6.4px;line-height:1.3}
  .l{display:flex;justify-content:space-between;gap:5px;padding:3.5px 0;
    border-bottom:1px solid rgba(148,163,184,.12);color:#cfd9e6}
  .l b{color:#fff;font-weight:700;white-space:nowrap}
  .l b.am{color:#f7a41c}
  .l.rui b{color:#ff9d8f}
  .barra{height:3px;border-radius:99px;background:rgba(148,163,184,.2);margin:5px 0;overflow:hidden}
  .barra i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#d9860a,#f7a41c)}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:5px}
  .c{background:rgba(148,163,184,.07);border:1px solid rgba(148,163,184,.16);
    border-radius:5px;padding:5px 6px}
  .c span{display:block;font-size:5.4px;font-weight:800;letter-spacing:.08em;
    text-transform:uppercase;color:#93a3b8;margin-bottom:1.5px}
  /* nowrap: "R$ 44.700" quebrava em "R$" / "44.700" e o cartao virava duas
     alturas diferentes ao lado do vizinho. */
  .c b{font-size:8px;font-weight:800;letter-spacing:-.02em;white-space:nowrap}
  .c.bom{border-color:rgba(74,222,128,.32);background:rgba(74,222,128,.07)}
  .c.bom b{color:#4ade80}
  .base{height:4px;margin:0 -7%;background:linear-gradient(180deg,#2a3852,#131c2e);
    border-radius:0 0 6px 6px}
  /* rodape */
  /* A marca saiu do rodape: la' ela passava por baixo do notebook. Foi pro
     alto, do lado oposto ao selo, onde nao disputa espaco com nada. */
  .marcaTopo{position:absolute;top:15px;right:16px;z-index:3;
    font-size:7.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#64768f}
  .marcaTopo b{color:#93a3b8}
  .pe{margin-top:auto;position:relative;z-index:2}
  .preco{font-size:19px;font-weight:800;color:#f7a41c;letter-spacing:-.03em;line-height:1}
  .preco small{font-size:.45em;font-weight:700;color:#93a3b8;letter-spacing:0}
  .marca{font-size:8px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#64768f}
  .marca b{color:#93a3b8}
</style></head><body>
  <div class="brilho"></div><div class="grade"></div><div class="topo"></div>
  <div class="note">
    <div class="tampa">
      <div class="barraTopo"><i></i><i></i><i></i></div>
      <div class="tela">${c.tela}</div>
    </div>
    <div class="base"></div>
  </div>
  <span class="marcaTopo"><b>SolarDoc</b> Pro</span>
  <div class="miolo">
    <span class="selo">Para integrador solar</span>
    <h1>${c.nome}</h1>
    <p class="sub">${c.linha}</p>
    <div class="pe">
      <span class="preco">R$ ${c.preco}<small> à vista</small></span>
    </div>
  </div>
</body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await p.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
  for (const c of CAPAS) {
    for (const [suf, esc] of [['', 1], ['@2x', 2]]) {
      const pg = await b.newPage();
      await pg.setViewport({ width: 300, height: 250, deviceScaleFactor: esc });
      await pg.setContent(html(c), { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 350));
      const caminho = `${OUT}/${c.arquivo}${suf}.png`;
      await pg.screenshot({ path: caminho, clip: { x: 0, y: 0, width: 300, height: 250 } });
      console.log(`${c.arquivo}${suf}.png  ${300 * esc}x${250 * esc}  ${(fs.statSync(caminho).size / 1024).toFixed(1)} KB`);
      await pg.close();
    }
  }
  await b.close();
})();
