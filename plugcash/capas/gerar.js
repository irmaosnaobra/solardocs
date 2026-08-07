const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CAPAS DOS CURSOS DO PLUGCASH
//
// Por que desenhadas e não geradas por IA: uma foto de eletroposto instalado
// seria a imagem de uma obra que a empresa ainda não entregou. O projeto proíbe
// prova inventada, e capa de curso é prova visual — a primeira que o comprador
// vê. Ilustração geométrica não promete nada que não existe.
//
// Regras da marca aplicadas aqui:
//   · fundo preto #0A0A0A, verde #00C853 como ACENTO (nunca como fundo);
//   · sem gradiente, sem glassmorphism, sem sombra — bordas de 1px;
//   · ícone monocromático em SVG, nunca emoji.
//
// O card do catálogo tem ~272px de largura e proporção 16:9, então a capa é
// lida a ~272×153. Daí o ícone grande e pouco texto: o título já aparece embaixo
// da imagem, no próprio card — repetir ali brigaria com ele.
//
// Rodar:  node plugcash/capas/gerar.js
// Sai em: dashboard/public/plugcash/img/<slug>.png  →  /plugcash/img/<slug>.png
// ─────────────────────────────────────────────────────────────────────────────

const LARGURA = 800;
const ALTURA = 450;   // 16:9

// Ícones de traço, 48×48, desenhados pra ler bem reduzidos. `currentColor`
// herda o branco; o traço grosso é o que sobrevive ao downscale do card.
const ICONES = {
  // bússola — entender o terreno antes de andar
  fundamentos: `<circle cx="24" cy="24" r="18"/><path d="M31 17l-4 10-10 4 4-10z"/>`,
  // pin de mapa
  'ponto-zero': `<path d="M24 43s14-11.5 14-21a14 14 0 1 0-28 0c0 9.5 14 21 14 21z"/><circle cx="24" cy="22" r="5"/>`,
  // colunas de banco
  capital: `<path d="M6 20L24 8l18 12"/><path d="M9 20v16M19 20v16M29 20v16M39 20v16"/><path d="M5 40h38"/>`,
  // documento com assinatura
  dossie: `<path d="M12 5h16l8 8v30H12z"/><path d="M28 5v8h8"/><path d="M18 28c3-3 5 3 8 0s5 3 8 0"/>`,
  // selo de aprovação
  homologacao: `<circle cx="24" cy="20" r="13"/><path d="M18 20l4 4 8-8"/><path d="M17 32l-3 11 10-4 10 4-3-11"/>`,
  // totem de recarga com cabo
  equipamento: `<rect x="12" y="6" width="18" height="30" rx="2"/><path d="M17 14h8M17 20h8"/><path d="M12 43h18"/><path d="M30 12h5a3 3 0 0 1 3 3v14a4 4 0 0 0 4 4"/>`,
  // medidor / barras
  operacao: `<path d="M6 42h36"/><rect x="10" y="26" width="7" height="16"/><rect x="21" y="16" width="7" height="26"/><rect x="32" y="22" width="7" height="20"/>`,
  // chave inglesa — quem executa
  integrador: `<path d="M31 6a10 10 0 0 0-9.4 13.4L6 35v7h7l15.6-15.6A10 10 0 1 0 31 6z"/><circle cx="33" cy="15" r="3"/>`,
  // duas pessoas — acompanhamento
  mentoria: `<circle cx="17" cy="16" r="6"/><path d="M6 40c0-6 5-10 11-10s11 4 11 10"/><circle cx="34" cy="19" r="5"/><path d="M31 30c6 0 11 4 11 10"/>`,
};

// A tarja de cima diz em que etapa do caminho o curso entra. Ela é o único
// texto da capa, e existe pra que nove capas pretas não virem nove borrões
// iguais na grade.
const CURSOS = [
  { slug: 'fundamentos', n: '01', etapa: 'Comece por aqui' },
  { slug: 'ponto-zero',  n: '02', etapa: 'Achar o ponto' },
  { slug: 'capital',     n: '03', etapa: 'Viabilizar o dinheiro' },
  { slug: 'dossie',      n: '04', etapa: 'Convencer quem decide' },
  { slug: 'homologacao', n: '05', etapa: 'Aprovar na distribuidora' },
  { slug: 'equipamento', n: '06', etapa: 'Comprar certo' },
  { slug: 'operacao',    n: '07', etapa: 'Operar e precificar' },
  { slug: 'integrador',  n: '08', etapa: 'Executar para terceiros' },
  { slug: 'mentoria',    n: '09', etapa: 'Acompanhamento' },
];

function html(curso) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${LARGURA}px;height:${ALTURA}px;background:#0A0A0A;overflow:hidden;
       font-family:'Inter','Segoe UI',system-ui,-apple-system,Arial,sans-serif;
       color:#fff;position:relative}

  /* Malha de linhas finíssimas: dá textura sem virar gradiente nem ruído.
     4% de opacidade — some no card pequeno e aparece no tamanho cheio. */
  .malha{position:absolute;inset:0;
    background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);
    background-size:50px 50px;opacity:.04}

  /* O número é recorte, não enfeite: fica atrás de tudo, só contorno. */
  /* O número é textura de fundo, não informação: fica inteiro dentro do quadro,
     em contorno, e no card pequeno vira só uma sombra geométrica. Cortado na
     borda ele lia como erro de layout. */
  .numero{position:absolute;right:44px;top:50%;transform:translateY(-50%);
    font-size:300px;font-weight:800;letter-spacing:-.06em;line-height:.8;
    color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.09)}

  .conteudo{position:absolute;inset:0;padding:46px 52px;display:flex;
    flex-direction:column;justify-content:space-between}

  /* Tudo é dimensionado pro tamanho REAL de exibição: o card tem ~272px de
     largura, então o que está aqui aparece a 34% do tamanho. Um rótulo de 19px
     vira 6px na tela — some. Daí 30px, que chega legível a ~10px. */
  .topo{display:flex;align-items:center;gap:16px}
  .barra{width:44px;height:4px;background:#00C853;border-radius:2px}
  .etapa{font-size:30px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#00C853}

  .icone{width:200px;height:200px;stroke:#fff;stroke-width:2.4;fill:none;
    stroke-linecap:round;stroke-linejoin:round;margin-left:-6px}

  .rodape{display:flex;align-items:center;justify-content:space-between}
  .marca{display:flex;align-items:center;gap:12px;font-size:30px;font-weight:800;letter-spacing:-.02em}
  .marca svg{width:38px;height:38px}
  .cash{color:#00C853}
  /* Régua verde na base: o mesmo acento da faixa do item ativo no menu. */
  .regua{position:absolute;left:0;right:0;bottom:0;height:7px;background:#00C853}
</style></head><body>
  <div class="malha"></div>
  <div class="numero">${curso.n}</div>
  <div class="conteudo">
    <div class="topo"><span class="barra"></span><span class="etapa">${curso.etapa}</span></div>
    <svg class="icone" viewBox="0 0 48 48">${ICONES[curso.slug]}</svg>
    <div class="rodape">
      <span class="marca">
        <svg viewBox="0 0 80 80">
          <rect width="80" height="80" rx="21" fill="#00C853"/>
          <rect x="38.5" y="11" width="3.6" height="58" rx="1.8" fill="#fff"/>
          <path d="M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z" fill="#fff"/>
        </svg>
        <span>Plug<span class="cash">Cash</span></span>
      </span>
    </div>
  </div>
  <div class="regua"></div>
</body></html>`;
}

(async () => {
  const destino = path.join(__dirname, '..', '..', 'dashboard', 'public', 'plugcash', 'img');
  fs.mkdirSync(destino, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: LARGURA, height: ALTURA, deviceScaleFactor: 1 });

  for (const curso of CURSOS) {
    if (!ICONES[curso.slug]) throw new Error(`sem ícone para ${curso.slug}`);
    // `domcontentloaded` e não `networkidle0`: a página não busca NADA na rede —
    // fonte é de sistema, ícone e logo são SVG inline. Esperar a rede ficar ociosa
    // trava no segundo arquivo, porque nunca houve requisição pra ficar ociosa.
    await page.setContent(html(curso), { waitUntil: 'domcontentloaded' });
    const arquivo = path.join(destino, `${curso.slug}.png`);
    await page.screenshot({ path: arquivo, type: 'png' });
    console.log(`${curso.slug}.png — ${(fs.statSync(arquivo).size / 1024).toFixed(1)} KB`);
  }

  await browser.close();
})();
