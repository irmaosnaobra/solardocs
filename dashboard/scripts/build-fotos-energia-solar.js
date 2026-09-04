/**
 * FOTOS DO SITE /irmaosnaobra — recorta e converte pra webp.
 *
 * A origem sao as fotos que ja' estao no repo, nas pastas do /io:
 *   public/io/mosaico/1..11.jpeg   obra entregue (celular da equipe)
 *   public/io/img/fedd1..7.jpg     print de conversa de cliente
 *   public/founder-thiago|diego.webp
 *   public/io/img/logoio.webp
 *
 * Por que gerar em vez de apontar pro arquivo original: as 11 do mosaico
 * somam ~1,55 MB em jpeg de celular, e a LP inteira nao pode pesar isso
 * (o /io ja' mandou 2,58 MB uma vez). Cada slot ganha o tamanho que a tela
 * pede, nada maior.
 *
 *   node scripts/build-fotos-energia-solar.js
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const RAIZ = path.join(__dirname, '..', 'public');
const SAIDA = path.join(RAIZ, 'irmaosnaobra', 'assets', 'img');
const mosaico = (n) => path.join(RAIZ, 'io', 'mosaico', n + '.jpeg');
const fedd = (n) => path.join(RAIZ, 'io', 'img', 'fedd' + n + '.jpg');

fs.mkdirSync(SAIDA, { recursive: true });

// AS 4 FOTOS DE VITRINE (hero + os tres servicos) sao as que o visitante ve
// antes de decidir se fica. O Thiago pediu que fossem mais bonitas, entao elas
// mudaram de origem E ganham tratamento de cor: as escolhidas agora sao as de
// ceu aberto, e nao as de dia nublado.
//   hero        mosaico 10  painel de perto, ceu azul com nuvem e morro verde
//   hero cel.   mosaico 11  fileira limpa em telha de concreto, ceu fechado de azul
//   residencial mosaico  9  telhado inteiro com o horizonte verde atras
//   industria   mosaico  6  telhado de galpao (e a unica industrial que existe)
//   rural       mosaico  4  drone na chacara, com a equipe montando
// O tratamento e' correcao de cor, nao maquiagem: satura 8%, abre um pouco o
// contraste e da' um sharpen leve. Nada entra ou sai da foto.
const VITRINE = new Set(['hero-desktop','hero-mobile','servico-residencial',
                         'servico-industria','servico-rural']);

// [origem, nome de saida, largura, altura ou null pra manter proporcao, qualidade]
const TRABALHOS = [
  [mosaico(10), 'hero-desktop', 1600, 900, 82],
  [mosaico(11), 'hero-mobile', 900, 900, 84],

  [mosaico(9), 'servico-residencial', 800, 597, 86],
  [mosaico(6), 'servico-industria', 800, 597, 86],
  [mosaico(4), 'servico-rural', 800, 597, 86],

  // obras: as 10 restantes em 4:3, SEM tratamento — foto de obra e' documento,
  // fica do jeito que a equipe tirou
  [mosaico(9), 'obra-01', 760, 570, 80],
  [mosaico(1), 'obra-02', 760, 570, 80],
  [mosaico(3), 'obra-03', 760, 570, 80],
  [mosaico(11), 'obra-04', 760, 570, 80],
  [mosaico(6), 'obra-05', 760, 570, 80],
  [mosaico(10), 'obra-06', 760, 570, 80],
  [mosaico(5), 'obra-07', 760, 570, 80],
  [mosaico(2), 'obra-08', 760, 570, 80],
  [mosaico(7), 'obra-09', 760, 570, 80],
  [mosaico(8), 'obra-10', 760, 570, 80],

  // os dois irmaos
  [path.join(RAIZ, 'founder-thiago.webp'), 'irmao-thiago', 360, 360, 82],
  [path.join(RAIZ, 'founder-diego.webp'), 'irmao-diego', 360, 360, 82],

  // logo do cabecalho e do rodape
  [path.join(RAIZ, 'io', 'img', 'logoio.webp'), 'logo-simbolo', 160, 160, 85],
];

// prints de conversa: sao estreitos de origem, nao da' pra ampliar sem borrar
[1, 2, 3, 4, 5, 6, 7].forEach((n) => {
  TRABALHOS.push([fedd(n), 'depo-' + n, 440, null, 74]);
});

(async () => {
  // o card do meio virou "industria": o arquivo antigo nao pode ficar orfao
  const velho = path.join(SAIDA, 'servico-empresas.webp');
  if (fs.existsSync(velho)) { fs.unlinkSync(velho); console.log('apaguei servico-empresas.webp'); }

  let total = 0;
  for (const [origem, nome, largura, altura, q] of TRABALHOS) {
    const destino = path.join(SAIDA, nome + '.webp');
    const meta = await sharp(origem).metadata();
    const w = Math.min(largura, meta.width); // nunca ampliar
    let pipe = sharp(origem);
    if (altura) {
      const h = Math.round((altura / largura) * w);
      pipe = pipe.resize(w, h, { fit: 'cover', position: 'attention' });
    } else {
      pipe = pipe.resize(w, null, { withoutEnlargement: true });
    }
    if (VITRINE.has(nome)) {
      pipe = pipe.modulate({ saturation: 1.08 }).linear(1.05, -6).sharpen({ sigma: 0.7 });
    }
    await pipe.webp({ quality: q }).toFile(destino);
    const kb = fs.statSync(destino).size / 1024;
    total += kb;
    console.log(nome.padEnd(22) + w + 'px'.padEnd(4) + '  ' + kb.toFixed(1) + ' KB');
  }

  // favicon: PNG pequeno, nao o logoio de 500x500 que o navegador baixava 3x.
  // 96px com paleta: 7 KB no lugar de 90 KB, e na aba ninguem ve diferenca.
  await sharp(path.join(RAIZ, 'io', 'img', 'logoio.webp'))
    .resize(96, 96)
    .png({ compressionLevel: 9, palette: true, quality: 80 })
    .toFile(path.join(SAIDA, 'icone-192.png'));
  const kbIcone = fs.statSync(path.join(SAIDA, 'icone-192.png')).size / 1024;
  total += kbIcone;
  console.log('icone-192.png'.padEnd(22) + '192px  ' + kbIcone.toFixed(1) + ' KB');

  console.log('\ntotal do diretorio: ' + total.toFixed(1) + ' KB');
})();
