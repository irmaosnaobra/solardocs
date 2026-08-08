const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// FOTOS DO ELETROPOSTO — original solto vira arquivo do tamanho da caixa
//
// Entra: um JPG grande por foto em `_originais/`.
// Sai:   WebP em `dashboard/public/io/eletroposto/img/fotos/` (o que o navegador
//        baixa) e JPG 800x450 em `_capas/` (o que a capa do curso embute).
//
// Por que existe: a lander do /io já pesou 2,58 MB uma vez porque um favicon de
// 468 KB era baixado três vezes. Nove fotos full-bleed é exatamente como uma
// página volta pra lá. Cada largura aqui é a CAIXA REAL onde a foto aparece —
// não a resolução que veio do gerador. O mockup do app já ensinou isso: 2040px
// exibido a 354px é 1,4 MB jogado fora pra desenhar 354 pixels.
//
// Rodar:  node plugcash/fotos/processar.js
// ─────────────────────────────────────────────────────────────────────────────

// sharp mora no dashboard; esta pasta não tem node_modules próprio.
const sharp = require('C:/Users/55349/Desktop/CLAUDE/dashboard/node_modules/sharp');

const RAIZ = path.resolve(__dirname, '..', '..');
const ORIGINAIS = path.join(__dirname, '_originais');
const WEB = path.join(RAIZ, 'dashboard', 'public', 'io', 'eletroposto', 'img', 'fotos');
const CAPAS = path.join(__dirname, '_capas');

// A largura de cada foto é o tamanho em que ela é DESENHADA, com folga de tela
// retina só onde a imagem é o assunto (hero e faixas). Card de perfil aparece
// no máximo a ~550px numa grade de 1120px: 760 já cobre 2x no celular.
const FOTOS = [
  { nome: 'lp-hero',           larguras: [1600, 900], q: 68, onde: 'hero das duas landings' },
  { nome: 'lp-mercado',        larguras: [1440, 820], q: 68, onde: 'faixa "por que agora"' },
  { nome: 'perfil-investidor', larguras: [760, 480],  q: 72, onde: 'card "não tem o ponto"' },
  { nome: 'perfil-posto',      larguras: [760, 480],  q: 72, onde: 'card "tem imóvel"' },
  { nome: 'perfil-mercado',    larguras: [760, 480],  q: 72, onde: 'card "tem capital"' },
  { nome: 'perfil-socios',     larguras: [760, 480],  q: 72, onde: 'card "decide com outra pessoa"' },
  { nome: 'campo',             larguras: [1100, 700], q: 70, onde: 'faixa "o que você leva"' },
  { nome: 'padrao-entrada',    larguras: [1100, 700], q: 68, onde: 'faixa "como as aulas são"' },
  { nome: 'obra',              larguras: [1100, 700], q: 70, onde: 'só capa do curso Integrador' },
];

// A foto REAL do carregador que a empresa vende. Estava só no deck; a vitrine da
// landing mostrava um render de IA no lugar do produto que existe.
const DO_DECK = {
  nome: 'produto-dc',
  origem: 'C:/Users/55349/Desktop/EletroPosto/Apresentacao-IrmaosNaObra/_fonte/img/produto-dc.jpg',
  larguras: [900, 600],
  q: 78,
  onde: 'vitrine do equipamento + capa do curso Equipamento',
};

// Capa de curso: 800x450 é o quadro inteiro do gerador de capas, e ela entra
// embutida em base64 — daí JPEG e não WebP (o Chromium do puppeteer decodifica
// os dois, mas JPEG a 55 de qualidade num fundo que vai ficar a 22% de opacidade
// é menos byte pra chegar no mesmo pixel).
const CAPA = { largura: 800, altura: 450, q: 55 };

// ── PNGs antigos que a medição pegou junto ──────────────────────────────────
// Medir a página com as fotos dentro revelou que os três arquivos mais pesados
// das landings NÃO eram fotos: a logo de 42px pesava 58,9 KB e os dois mockups
// do app somavam 197 KB em PNG. Converter os três economiza mais do que todas
// as nove fotos custam juntas.
//
// A logo em PNG continua onde está — ela é usada em PDF e no service worker do
// /gerador. O que muda é só o que a landing pede.
const EXTRAS = [
  { de: 'dashboard/public/gerador/logo-eletroposto.png',
    para: 'dashboard/public/io/eletroposto/img/logo-io.webp', largura: 96, q: 88 },
  { de: 'dashboard/public/plugcash/img/mockup-app.png',
    para: 'dashboard/public/plugcash/img/mockup-app.webp', largura: 2040, q: 80 },
  { de: 'dashboard/public/plugcash/img/mockup-celular.png',
    para: 'dashboard/public/plugcash/img/mockup-celular.webp', largura: 780, q: 82 },
];

async function converterExtras() {
  console.log('');
  for (const e of EXTRAS) {
    const origem = path.join(RAIZ, e.de);
    if (!fs.existsSync(origem)) { console.log(`  ${path.basename(e.de)}: nao encontrado`); continue; }
    const destino = path.join(RAIZ, e.para);
    await sharp(origem)
      .resize({ width: e.largura, withoutEnlargement: true })
      .webp({ quality: e.q, effort: 6 })
      .toFile(destino);
    const antes = (fs.statSync(origem).size / 1024).toFixed(1);
    console.log(`  ${path.basename(e.para)}  ${kb(destino)} KB  (era ${antes} KB em PNG)`);
  }
}

// ── Card de compartilhamento ────────────────────────────────────────────────
// O og.jpg que estava no ar tinha dois defeitos: a logo circular aparecia
// duplicada atrás da tarja verde, e o rodapé dizia "investimento a partir de
// R$85.000" enquanto a página mostra de R$ 141.673 a R$ 229.436 — os valores
// vêm do CONFIGS do simulador e mudaram desde que o card foi feito.
//
// O card novo NÃO TEM PREÇO. Número em imagem estática envelhece na primeira
// vez que alguém reajusta a planilha, e a regra da casa é que preço de
// eletroposto tem uma fonte só: o Simulador. Quem quiser o número, clica.
async function gerarOg() {
  const puppeteer = require(path.join(RAIZ, 'node_modules', 'puppeteer'));
  const logo = path.join(RAIZ, 'dashboard', 'public', 'gerador', 'logo-eletroposto.png');
  const produto = DO_DECK.origem;
  if (!fs.existsSync(logo) || !produto || !fs.existsSync(produto)) {
    console.log('\nog.jpg: pulado (falta logo ou foto do produto)');
    return;
  }

  const b64 = (p, t) => `data:image/${t};base64,${fs.readFileSync(p).toString('base64')}`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:630px;background:#050D02;overflow:hidden;position:relative;
         font-family:'Inter','Segoe UI',system-ui,Arial,sans-serif;color:#F7FBF2}
    .foto{position:absolute;right:0;top:0;width:44%;height:100%;
          background:#0d1a05 url('${b64(produto, 'jpeg')}') center/contain no-repeat;
          -webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 26%)}
    .txt{position:absolute;left:64px;top:0;height:100%;width:62%;
         display:flex;flex-direction:column;justify-content:center;gap:20px;z-index:2}
    .marca{display:flex;align-items:center;gap:14px}
    .marca img{width:64px;height:64px;border-radius:14px;object-fit:contain;display:block}
    .marca span{font-size:15px;font-weight:800;letter-spacing:2.2px;text-transform:uppercase;color:#9BDD2E}
    h1{font-size:74px;font-weight:900;line-height:.96;letter-spacing:-3px}
    h1 em{font-style:normal;color:#9BDD2E;display:block}
    p{font-size:25px;font-weight:600;line-height:1.38;color:rgba(247,251,242,.74);max-width:22ch}
    .selo{display:inline-flex;align-self:flex-start;align-items:center;gap:9px;font-size:16px;font-weight:800;
          color:#050D02;background:#9BDD2E;padding:12px 22px;border-radius:60px}
    .veu{position:absolute;inset:0;z-index:1;pointer-events:none;
         background:linear-gradient(90deg,#050D02 44%,rgba(5,13,2,.55) 66%,transparent 82%)}
  </style>
  <div class="foto"></div><div class="veu"></div>
  <div class="txt">
    <span class="marca"><img src="${b64(logo, 'png')}"><span>Irmãos na Obra · Mobilidade</span></span>
    <h1>Invista em<em>Eletropostos</em></h1>
    <p>Sua vaga ociosa vira renda recorrente.</p>
    <span class="selo">Simule o retorno do seu ponto</span>
  </div>`;

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const saida = path.join(WEB, '..', 'og.jpg');
  await page.screenshot({ path: saida, type: 'jpeg', quality: 86 });
  await browser.close();
  console.log(`\nog.jpg refeito — ${kb(saida)} KB (sem preço: o número vive no simulador)`);
}

function achar(nome) {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.JPG', '.JPEG', '.PNG']) {
    const p = path.join(ORIGINAIS, nome + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);

(async () => {
  fs.mkdirSync(WEB, { recursive: true });
  fs.mkdirSync(CAPAS, { recursive: true });
  fs.mkdirSync(ORIGINAIS, { recursive: true });

  const faltando = [];
  let total = 0;

  const fila = FOTOS.map((f) => ({ ...f, origem: achar(f.nome) }))
    .concat([{ ...DO_DECK, origem: fs.existsSync(DO_DECK.origem) ? DO_DECK.origem : null }]);

  for (const f of fila) {
    if (!f.origem) { faltando.push(f.nome); continue; }

    for (const w of f.larguras) {
      const saida = path.join(WEB, `${f.nome}-${w}.webp`);
      await sharp(f.origem)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: f.q, effort: 6 })
        .toFile(saida);
      total += fs.statSync(saida).size;
      console.log(`  ${f.nome}-${w}.webp  ${kb(saida)} KB`);
    }

    // versão da capa — recorte central 16:9
    const capa = path.join(CAPAS, `${f.nome}.jpg`);
    await sharp(f.origem)
      .resize({ width: CAPA.largura, height: CAPA.altura, fit: 'cover', position: 'attention' })
      .jpeg({ quality: CAPA.q, mozjpeg: true })
      .toFile(capa);
  }

  console.log(`\ntotal na web: ${(total / 1024).toFixed(0)} KB em ${fila.length - faltando.length} fotos`);

  await converterExtras();
  await gerarOg();

  if (faltando.length) {
    console.log(`\nFALTAM em plugcash/fotos/_originais/ (nome exato + .jpg):`);
    for (const n of faltando) console.log(`  · ${n}`);
    process.exitCode = 1;
  } else {
    console.log('\nTudo pronto. Agora: node plugcash/capas/gerar.js');
  }
})();
