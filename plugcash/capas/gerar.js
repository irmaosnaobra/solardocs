const puppeteer = require('puppeteer');
const sharp = require('C:/Users/55349/Desktop/CLAUDE/dashboard/node_modules/sharp');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CAPAS DOS CURSOS DO PLUGCASH
//
// FOTO ENTROU EM 08/08, MAS COMO FUNDO — não como assunto.
//
// A versão anterior era só geometria, e o motivo escrito aqui era que foto de
// eletroposto instalado viraria prova de obra que a empresa ainda não entregou.
// O motivo continua valendo; o que mudou é o papel da foto. Ela fica a 20% de
// opacidade, sob um véu preto, atrás do ícone e do número — dá matéria e clima
// a nove retângulos pretos que na grade viravam nove borrões iguais, sem
// nenhuma delas afirmar "isto é nosso". O ícone continua sendo o assunto.
//
// É por isso, também, que a foto de instalação em andamento aparece SÓ aqui, na
// capa do curso de execução, e em nenhuma página de venda: numa landing ela
// leria como portfólio, e não há obra documentada pra sustentar essa leitura.
//
// As fotos saem de `plugcash/fotos/processar.js` (pasta `_capas/`). Se faltar
// alguma, aquela capa volta sozinha pro fundo preto liso — nada quebra.
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
// `foto` é o arquivo em plugcash/fotos/_capas/. Cada uma responde ao assunto do
// curso, não ao acaso: quem homologa olha padrão de entrada, quem compra
// equipamento olha o carregador, quem convence sócio olha uma mesa com papel.
const CURSOS = [
  { slug: 'fundamentos', n: '01', etapa: 'Comece por aqui',           foto: 'lp-hero' },
  { slug: 'ponto-zero',  n: '02', etapa: 'Achar o ponto',              foto: 'lp-mercado' },
  { slug: 'capital',     n: '03', etapa: 'Viabilizar o dinheiro',     foto: 'perfil-mercado' },
  { slug: 'dossie',      n: '04', etapa: 'Convencer quem decide',     foto: 'perfil-socios' },
  { slug: 'homologacao', n: '05', etapa: 'Aprovar na distribuidora',  foto: 'padrao-entrada' },
  { slug: 'equipamento', n: '06', etapa: 'Comprar certo',             foto: 'produto-dc' },
  { slug: 'operacao',    n: '07', etapa: 'Operar e precificar',       foto: 'perfil-posto' },
  { slug: 'integrador',  n: '08', etapa: 'Executar para terceiros',   foto: 'obra' },
  { slug: 'mentoria',    n: '09', etapa: 'Acompanhamento',            foto: 'campo' },
];

// A foto entra embutida: o puppeteer roda com setContent, sem servidor, então
// caminho relativo não resolve.
const PASTA_FOTOS = path.join(__dirname, '..', 'fotos', '_capas');

// AS NOVE SÃO UM CONJUNTO. Enquanto faltar uma, NENHUMA leva foto.
//
// A grade do catálogo mostra as nove lado a lado. Com oito chapadas e uma com
// foto, a que tem foto não parece a melhor — parece a quebrada. Um estado
// intermediário aqui é pior que os dois estados finais, e ele não some sozinho:
// fica no ar até alguém reparar.
//
// Assim que o nono arquivo entrar em plugcash/fotos/_originais/, as nove passam
// a ter foto no mesmo `node plugcash/capas/gerar.js`. Sem chave pra virar.
const faltando = CURSOS.filter((c) => !fs.existsSync(path.join(PASTA_FOTOS, `${c.foto}.jpg`)));
const COM_FOTO = faltando.length === 0;

function fotoEmbutida(curso) {
  if (!COM_FOTO) return null;
  const p = path.join(PASTA_FOTOS, `${curso.foto}.jpg`);
  return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
}

function html(curso) {
  const foto = fotoEmbutida(curso);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${LARGURA}px;height:${ALTURA}px;background:#0A0A0A;overflow:hidden;
       font-family:'Inter','Segoe UI',system-ui,-apple-system,Arial,sans-serif;
       color:#fff;position:relative}

  /* Foto: matéria, não assunto. 20% já dá textura e mantém o ícone branco
     legível a 272px de largura, que é o tamanho real do card. O véu escurece o
     lado esquerdo, onde ficam a tarja da etapa e o ícone. */
  .foto{position:absolute;inset:0;background:center/cover no-repeat;opacity:.38;filter:grayscale(.2) contrast(1.05)}
  /* O véu é assimétrico de propósito: escuro onde mora o texto (esquerda),
     aberto onde a foto pode respirar (direita, atrás do número em contorno). */
  .veu{position:absolute;inset:0;
       background:linear-gradient(100deg,rgba(10,10,10,.95) 30%,rgba(10,10,10,.6) 68%,rgba(10,10,10,.34) 100%)}

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
  ${foto ? `<div class="foto" style="background-image:url('${foto}')"></div><div class="veu"></div>` : ''}
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

  if (COM_FOTO) {
    console.log('as nove com foto ao fundo\n');
  } else {
    console.log(`as nove SEM foto — faltam ${faltando.length} em plugcash/fotos/_originais/:`);
    for (const c of faltando) console.log(`  · ${c.foto}.jpg  (capa ${c.n} ${c.slug})`);
    console.log('');
  }

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

    // O catálogo mostra as nove capas de uma vez. Em PNG, uma capa com foto
    // passa de 110 KB e a grade sozinha baixa mais de 1 MB — o mesmo erro que
    // levou a lander do /io a 2,58 MB. O WebP é o que o `thumb_url` aponta; o
    // PNG fica pra qualquer lugar que ainda peça a extensão antiga.
    const webp = path.join(destino, `${curso.slug}.webp`);
    await sharp(arquivo).webp({ quality: 82, effort: 6 }).toFile(webp);

    const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
    console.log(`${curso.slug} — webp ${kb(webp)} KB (png ${kb(arquivo)})`);
  }

  await browser.close();
})();
