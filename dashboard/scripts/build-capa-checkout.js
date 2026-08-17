/**
 * CAPA DE PRODUTO — o banner do topo do checkout da Kiwify, 1000x500.
 *
 * NAO e' a mesma coisa que a de 300x250. Aquela e' miniatura; esta e' a
 * primeira coisa que a pessoa ve' DEPOIS de clicar em comprar, e o trabalho
 * dela e' segurar a compra no momento em que a mao vai pro cartao.
 *
 * Descoberto olhando os produtos que ja' vendem, nao chutando: "Calculadora
 * Solar" e "Dimensionamento Off Grid" estao SEM capa nenhuma no checkout. O
 * Kit usa 980x928 e o LimpaPro 1000x500 — segui o do LimpaPro, que e' o mais
 * recente e e' a proporcao padrao do banner.
 *
 * Do LimpaPro vem a anatomia: nome do produto em ambar la' em cima, headline
 * de duas linhas com a segunda em ambar, subtitulo, e a tarja de selos no pe'
 * (acesso imediato · garantia · pagamento). No lugar da foto do telhado vai o
 * notebook com a tela do produto — foto de painel eu nao tenho, e o aparelho
 * mostra o que a pessoa esta' comprando.
 */
const p = require('c:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'c:/Users/55349/Desktop/CLAUDE/dashboard/public/capas';

const CAPAS = [
  {
    arquivo: 'calculadora-solar-checkout',
    marca: 'Calculadora Solar',
    h1: ['Você está a 1 passo de', 'saber o que sobra.'],
    sub: 'Todo custo na conta — kit, material CA, mão de obra, deslocamento, ART, imposto e comissão. <b>Você arrasta a margem e vê a sua sobra antes de mandar o preço.</b>',
    preco: '67',
    tela: `
      <div class="l"><span>Custo total da obra</span><b>R$ 24.210</b></div>
      <div class="l"><span>Sua margem</span><b class="am">28%</b></div>
      <div class="barra"><i style="width:58%"></i></div>
      <div class="cards">
        <div class="c"><span>Preço ao cliente</span><b>R$ 33.156</b></div>
        <div class="c bom"><span>Sobra pra você</span><b>R$ 9.284</b></div>
      </div>
      <div class="l"><span>Piso que ainda dá lucro</span><b>R$ 26.259</b></div>
      <div class="l"><span>NF sobre o serviço · 6%</span><b>R$ 552</b></div>
      <div class="l"><span>Comissão do vendedor · 3%</span><b>R$ 920</b></div>
      <div class="l"><span>Preço por kWp</span><b>R$ 4.043</b></div>`,
  },
  {
    arquivo: 'inventario-empresarial-checkout',
    marca: 'Inventário Empresarial',
    h1: ['Você está a 1 passo de', 'saber o que a empresa tem.'],
    sub: 'Cada ferramenta com valor, local e estoque mínimo. <b>O patrimônio soma sozinho e o aviso de repor chega antes de faltar na obra.</b>',
    preco: '67',
    tela: `
      <div class="l"><span>Furadeira · Veículo 1</span><b>R$ 890</b></div>
      <div class="l"><span>Andaime 1,5 m · Depósito</span><b>R$ 1.180</b></div>
      <div class="l rui"><span>Conector MC4 · mín. 40</span><b>restam 6</b></div>
      <div class="cards">
        <div class="c"><span>Patrimônio</span><b>R$ 82.615</b></div>
        <div class="c bom"><span>Locais</span><b>4</b></div>
      </div>
      <div class="l"><span>Total pra contabilidade</span><b>R$ 82.615</b></div>
      <div class="l"><span>Escritório</span><b>R$ 12.480</b></div>
      <div class="l"><span>Veículos</span><b>R$ 24.900</b></div>
      <div class="l"><span>Depósito</span><b>R$ 31.235</b></div>`,
  },
  {
    arquivo: 'dimensionamento-off-grid-checkout',
    marca: 'Dimensionamento Off-Grid',
    h1: ['Você está a 1 passo de', 'responder na hora.'],
    sub: '"Quanto tempo aguenta sem sol?" sai com número, em três cenários. <b>Com o kit dimensionado, o preço com frete e a proposta com a sua marca.</b>',
    preco: '97',
    tela: `
      <div class="l"><span>Consumo por dia</span><b>8,4 kWh</b></div>
      <div class="l"><span>Banco de baterias</span><b>19,2 kWh</b></div>
      <div class="barra"><i style="width:88%"></i></div>
      <div class="cards">
        <div class="c"><span>Kit + frete</span><b>R$ 44.700</b></div>
        <div class="c bom"><span>Sem sol</span><b>2 dias</b></div>
      </div>
      <div class="l"><span>Contra puxar rede</span><b>R$ 112.000</b></div>
      <div class="l"><span>Painéis</span><b>12 × 570 W</b></div>
      <div class="l"><span>Inversor</span><b>5 kW · 48 V</b></div>
      <div class="l"><span>Ligação</span><b>2s × 6p</b></div>`,
  },
];

const html = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1000px;height:500px;overflow:hidden;position:relative;
       background:#080d18;color:#f4f7fb;
       font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
  .brilho{position:absolute;width:760px;height:520px;left:-200px;top:-230px;border-radius:50%;
    background:radial-gradient(circle,rgba(247,164,28,.3),transparent 66%);filter:blur(70px)}
  .brilho2{position:absolute;width:620px;height:460px;right:-120px;top:-120px;border-radius:50%;
    background:radial-gradient(circle,rgba(56,110,180,.26),transparent 66%);filter:blur(70px)}
  .grade{position:absolute;inset:0;
    background-image:linear-gradient(rgba(255,255,255,.032) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.032) 1px,transparent 1px);
    background-size:46px 46px;
    -webkit-mask-image:radial-gradient(ellipse at 28% 26%,#000 26%,transparent 74%)}
  .topo{position:absolute;top:0;left:0;right:0;height:4px;
    background:linear-gradient(90deg,#f7a41c,rgba(247,164,28,.14))}

  /* Centralizado na faixa que sobra acima da tarja (434px), nao colado no
     topo: com padding fixo sobrava um vazio de 170px embaixo do subtitulo e a
     imagem ficava desequilibrada. */
  .miolo{position:relative;z-index:2;padding:0 44px;width:58%;
    height:434px;display:flex;flex-direction:column;justify-content:center}
  .marca{display:block;font-size:14px;font-weight:800;letter-spacing:.22em;
    text-transform:uppercase;color:#f7a41c;margin-bottom:16px}
  h1{font-size:44px;line-height:1.04;letter-spacing:-.032em;font-weight:800;margin-bottom:16px}
  h1 span{display:block;
    background:linear-gradient(180deg,#fbbf24 0%,#f7a41c 58%,#d9860a 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .sub{font-size:16.5px;line-height:1.5;color:#93a3b8;max-width:31em}
  .sub b{color:#f4f7fb;font-weight:700}

  /* notebook a' direita */
  .note{position:absolute;right:-34px;top:56px;width:436px;z-index:2}
  .tampa{background:#0b1320;border:8px solid #1b2740;border-bottom-width:5px;
    border-radius:13px 13px 4px 4px;overflow:hidden;
    box-shadow:0 34px 64px -26px rgba(0,0,0,.95)}
  .barraTopo{display:flex;align-items:center;gap:5px;padding:8px 11px;
    background:#0e1728;border-bottom:1px solid rgba(148,163,184,.16)}
  .barraTopo i{width:6px;height:6px;border-radius:50%;background:#33415c;display:block}
  .barraTopo span{margin-left:6px;font-size:9px;color:#64768f;
    font-family:ui-monospace,Menlo,Consolas,monospace}
  .tela{padding:13px 46px 15px 14px;font-size:11px;line-height:1.3}
  .l{display:flex;justify-content:space-between;gap:9px;padding:6px 0;
    border-bottom:1px solid rgba(148,163,184,.12);color:#cfd9e6}
  .l b{color:#fff;font-weight:700;white-space:nowrap}
  .l b.am{color:#f7a41c}
  .l.rui b{color:#ff9d8f}
  .barra{height:5px;border-radius:99px;background:rgba(148,163,184,.2);margin:8px 0;overflow:hidden}
  .barra i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#d9860a,#f7a41c)}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0}
  .c{background:rgba(148,163,184,.07);border:1px solid rgba(148,163,184,.16);
    border-radius:8px;padding:8px 9px}
  .c span{display:block;font-size:7.5px;font-weight:800;letter-spacing:.09em;
    text-transform:uppercase;color:#93a3b8;margin-bottom:2px}
  .c b{font-size:13px;font-weight:800;letter-spacing:-.02em;white-space:nowrap}
  .c.bom{border-color:rgba(74,222,128,.32);background:rgba(74,222,128,.07)}
  .c.bom b{color:#4ade80}
  .base{height:7px;margin:0 -6%;background:linear-gradient(180deg,#2a3852,#131c2e);
    border-radius:0 0 9px 9px}

  /* tarja de selos, como a do LimpaPro */
  .selos{position:absolute;left:0;right:0;bottom:0;height:66px;z-index:3;
    border-top:2px solid #f7a41c;background:rgba(8,13,24,.94);
    display:flex;align-items:center;gap:26px;padding:0 44px;font-size:16px;font-weight:700}
  .selos i{display:inline-flex;color:#f7a41c;margin-right:8px}
  .selos .sep{width:4px;height:4px;border-radius:99px;background:#33415c}
  .selos .preco{margin-left:auto;font-size:15px;font-weight:700;color:#93a3b8}
  .selos .preco b{font-size:26px;font-weight:800;color:#f7a41c;letter-spacing:-.03em}
</style></head><body>
  <div class="brilho"></div><div class="brilho2"></div><div class="grade"></div><div class="topo"></div>

  <div class="note">
    <div class="tampa">
      <div class="barraTopo"><i></i><i></i><i></i><span>solardoc.app</span></div>
      <div class="tela">${c.tela}</div>
    </div>
    <div class="base"></div>
  </div>

  <div class="miolo">
    <span class="marca">${c.marca}</span>
    <h1>${c.h1[0]}<span>${c.h1[1]}</span></h1>
    <p class="sub">${c.sub}</p>
  </div>

  <div class="selos">
    <span><i><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg></i>Acesso imediato</span>
    <span class="sep"></span>
    <span><i><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 4.6 6v6c0 4.5 3.1 8.3 7.4 9.2 4.3-.9 7.4-4.7 7.4-9.2V6L12 2.8Z"/><path d="m9 12 2.2 2.2L15.4 10"/></svg></i>7 dias de garantia</span>
    <span class="sep"></span>
    <span><i><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="5.4" width="18.8" height="13.2" rx="2.4"/><path d="M2.6 9.8h18.8"/></svg></i>Pix, cartão ou boleto</span>
    <span class="preco">pagamento único de <b>R$ ${c.preco}</b></span>
  </div>
</body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await p.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
  for (const c of CAPAS) {
    for (const [suf, esc] of [['', 1], ['@2x', 2]]) {
      const pg = await b.newPage();
      await pg.setViewport({ width: 1000, height: 500, deviceScaleFactor: esc });
      await pg.setContent(html(c), { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 400));
      const caminho = `${OUT}/${c.arquivo}${suf}.png`;
      await pg.screenshot({ path: caminho, clip: { x: 0, y: 0, width: 1000, height: 500 } });
      console.log(`${c.arquivo}${suf}.png  ${1000 * esc}x${500 * esc}  ${(fs.statSync(caminho).size / 1024).toFixed(1)} KB`);
      await pg.close();
    }
  }
  await b.close();
})();
