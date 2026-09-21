#!/usr/bin/env node
/**
 * Põe a arte final do carregador DC da NEXUS nos lugares que mostram o produto.
 *
 * Uso (as quatro vistas, nesta ordem):
 *   node dashboard/scripts/trocar-carregador.js <frente> <frente-perspectiva> <traseira-perspectiva> <traseira>
 *   ... --dry   só lista o que seria gravado
 *
 *   frente                a tela e o "CHARGING STATION" de frente
 *   frente-perspectiva    a mesma face, girada, mostrando a lateral com a grade
 *   traseira-perspectiva  a porta de serviço girada, com a grade da lateral
 *   traseira              a porta de serviço de frente
 *
 * HISTÓRICO
 * 17/09/2026: a primeira versão pegava UM arquivo e gravava por cima de sete,
 *   inclusive das fotos reais de estoque.
 * 21/09/2026: a arte final chegou em quatro vistas de 1600x900 com muito branco em
 *   volta. Esta versão corta o branco antes de encaixar (sem isso a máquina ficava
 *   com um terço da altura do card) e escreve só onde o produto é desenho.
 *
 * O QUE ELE NÃO FAZ, DE PROPÓSITO
 * - nexus/img/hero.webp, equipamento.webp e unidade.webp: são fotos de fábrica, e a
 *   seção da /nexus diz "sem render, sem estúdio". Trocar por render seria mentir.
 * - nexus/img/capa.webp: é a cena do topo (cobertura e dois carros), outra imagem.
 *   Refazer a cena com a máquina nova é geração de imagem, não recorte.
 * - p-ac7, p-ac11, p-ac22: são os wallbox, outro produto.
 * - eletroposto/img/produto-dc.jpg: a /eletroposto assina Irmãos na Obra, e a arte
 *   final tem o logo da NEXUS estampado no gabinete.
 */
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const RAIZ = path.join(__dirname, '..', 'public');
const BRANCO = { r: 255, g: 255, b: 255, alpha: 1 };

// vista (índice do argumento), destino, largura, altura, margem, qualidade, modo.
// 'inteiro' encaixa a máquina toda com margem; 'topo' recorta a parte de cima
// (logo e tela), que é o que se lê numa miniatura de 132 px.
const ALVOS = [
  [0, 'nexus/img/p-dc.webp',                    1200, 1200, 0.05, 82, 'inteiro'],
  [1, 'nexus/img/dc-perspectiva.webp',           800,  800, 0.06, 80, 'inteiro'],
  [2, 'nexus/img/dc-lateral.webp',               800,  800, 0.06, 80, 'inteiro'],
  [3, 'nexus/img/dc-traseira.webp',              800,  800, 0.06, 80, 'inteiro'],
  [1, 'io/eletroposto/img/fotos/modelo-04-equipamento.webp', 480, 320, 0, 80, 'topo'],
];

// Corta o fundo branco. O limiar tolera o ruído do JPEG sem comer a sombra do piso.
async function recortado(origem) {
  const { data, info } = await sharp(origem)
    .trim({ background: '#ffffff', threshold: 18 })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

async function gerar(origem, [, rel, W, H, margem, q, modo]) {
  const r = await recortado(origem);
  let img;
  if (modo === 'topo') {
    // Faixa de cima com a proporção do destino, pegando a largura inteira do gabinete.
    const alto = Math.min(r.h, Math.round(r.w * H / W));
    img = sharp(r.buf).extract({ left: 0, top: 0, width: r.w, height: alto }).resize(W, H, { fit: 'cover' });
  } else {
    const padX = Math.round(W * margem), padY = Math.round(H * margem);
    img = sharp(r.buf)
      .resize(W - 2 * padX, H - 2 * padY, { fit: 'contain', background: BRANCO })
      .extend({ top: padY, bottom: padY, left: padX, right: padX, background: BRANCO });
  }
  img = img.flatten({ background: BRANCO });
  return rel.endsWith('.jpg') ? img.jpeg({ quality: q, mozjpeg: true }) : img.webp({ quality: q });
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dry = process.argv.includes('--dry');
  if (args.length !== 4 || !args.every(a => fs.existsSync(a))) {
    console.error('Passe as quatro vistas: frente, frente-perspectiva, traseira-perspectiva, traseira.');
    process.exit(1);
  }

  for (const alvo of ALVOS) {
    const [i, rel, W, H] = alvo;
    const destino = path.join(RAIZ, rel);
    const antes = fs.existsSync(destino) ? `${Math.round(fs.statSync(destino).size / 1024)} KB` : 'novo';
    if (dry) { console.log(`[dry] ${rel}  ${W}x${H}  de ${path.basename(args[i])}  (hoje ${antes})`); continue; }
    await (await gerar(args[i], alvo)).toFile(destino + '.tmp');
    fs.renameSync(destino + '.tmp', destino);
    console.log(`ok  ${rel}  ${W}x${H}  ${antes} -> ${Math.round(fs.statSync(destino).size / 1024)} KB`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
