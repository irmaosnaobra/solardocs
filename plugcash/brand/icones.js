const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/55349/Desktop/CLAUDE/dashboard/node_modules/sharp');

// ─────────────────────────────────────────────────────────────────────────────
// ÍCONES DO PLUGCASH
//
// Dois problemas que isto resolve:
//   · o app em /plugcash herdava o favicon do SolarDoc — quem abre o curso via
//     a marca errada na aba;
//   · a landing de R$ 197 tinha só um SVG embutido, sem PNG de fallback e sem
//     apple-touch-icon: salvar na tela de início do iPhone virava um print.
//
// DUAS ARTES, NÃO UMA. A marca tem uma barra vertical de 3,6 de 80 — 4,5% da
// largura. A 16px isso dá 0,7 pixel: some, ou pior, vira um borrão cinza colado
// no raio. Então o ícone pequeno é OUTRO desenho: só o raio, mais gordo e
// centrado. Ninguém percebe a diferença a 16px — percebe é o borrão.
//
// Rodar: node plugcash/brand/icones.js
// ─────────────────────────────────────────────────────────────────────────────

const VERDE = '#00C853';

// Marca cheia — usada de 32px pra cima, onde a barra ainda tem corpo.
const cheia = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect width="80" height="80" rx="21" fill="${VERDE}"/>
  <rect x="38.5" y="11" width="3.6" height="58" rx="1.8" fill="#fff"/>
  <path d="M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z" fill="#fff"/>
</svg>`;

// Versão de 16px: sem a barra, raio mais largo e centrado no quadro. O canto
// arredondado também abre (rx 21→15 proporcional) porque a 16px um raio grande
// come área útil e o ícone parece menor que os vizinhos na barra de abas.
const miuda = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect width="80" height="80" rx="15" fill="${VERDE}"/>
  <path d="M50 10 L24 47 L38 47 L34 70 L58 31 L43 31 Z" fill="#fff"/>
</svg>`;

// Tela de início do iPhone: o sistema NÃO arredonda sozinho em todos os casos e
// não aceita transparência — fundo verde sangrando até a borda, sem raio, que o
// iOS aplica a máscara dele por cima.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect width="80" height="80" fill="${VERDE}"/>
  <rect x="38.5" y="11" width="3.6" height="58" rx="1.8" fill="#fff"/>
  <path d="M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z" fill="#fff"/>
</svg>`;

const SAIDAS = [
  // landing de R$ 197 e qualquer HTML estático do PlugCash
  { arte: cheia,  px: 32,  para: 'dashboard/public/plugcash/img/favicon-32.png' },
  { arte: miuda,  px: 16,  para: 'dashboard/public/plugcash/img/favicon-16.png' },
  { arte: apple,  px: 180, para: 'dashboard/public/plugcash/img/apple-touch-icon.png' },
  { arte: cheia,  px: 512, para: 'dashboard/public/plugcash/img/icone-512.png' },
  // O app NÃO usa a convenção de arquivo do Next (icon.png no segmento): a raiz
  // já tem o favicon.ico do SolarDoc, e os dois juntos viram dois <link rel=icon>
  // com o navegador escolhendo. A declaração é explícita no layout do PlugCash e
  // aponta pra estes mesmos arquivos.
];

(async () => {
  const raiz = path.resolve(__dirname, '..', '..');

  // O SVG vai junto: é ele que o navegador moderno usa, e escala sem perder.
  const svgOut = path.join(raiz, 'dashboard/public/plugcash/img/favicon.svg');
  fs.mkdirSync(path.dirname(svgOut), { recursive: true });
  fs.writeFileSync(svgOut, cheia, 'utf8');
  console.log(`  favicon.svg  ${(fs.statSync(svgOut).size / 1024).toFixed(1)} KB`);

  for (const s of SAIDAS) {
    const destino = path.join(raiz, s.para);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    await sharp(Buffer.from(s.arte))
      .resize(s.px, s.px)
      .png({ compressionLevel: 9 })
      .toFile(destino);
    console.log(`  ${path.basename(s.para).padEnd(20)} ${String(s.px).padStart(3)}px  ` +
                `${(fs.statSync(destino).size / 1024).toFixed(1)} KB`);
  }
})();
