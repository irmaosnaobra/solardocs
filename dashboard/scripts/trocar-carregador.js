#!/usr/bin/env node
/**
 * Põe o render do carregador NEXUS final em todo lugar que mostra o produto.
 *
 * Uso:  node dashboard/scripts/trocar-carregador.js <caminho-do-png-ou-webp>
 *       node dashboard/scripts/trocar-carregador.js <arquivo> --dry
 *
 * POR QUE ESTE SCRIPT EXISTE (17/09/2026)
 * O funil mostrava três máquinas diferentes e nenhuma era o produto final: uma cena
 * gerada com gabinete branco no topo de quatro páginas, o mesmo gabinete do produto
 * na pintura cinza antiga em /nexus, e uma foto real de caixa branca com os cabos
 * ainda embrulhados em plástico no site institucional.
 *
 * O QUE ELE NÃO FAZ
 * Não encosta em capa.webp (a cena do topo, com dois carros e a cobertura) nem nos
 * três AC (p-ac7, p-ac11, p-ac22). Aqueles são outras imagens, não outra pintura
 * desta, e trocar por um render de DC seria mentir sobre o produto.
 */
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const RAIZ = path.join(__dirname, '..', 'public');
const FUNDO = { r: 255, g: 255, b: 255, alpha: 1 };   // o padrão de recorte da casa

// destino, largura, altura, qualidade. As medidas são as dos arquivos que já estão
// no ar: mudar o tamanho aqui desalinha o layout que já foi testado no celular.
const ALVOS = [
  ['nexus/img/p-dc.webp',                         1200, 1200, 82],
  ['nexus/img/equipamento.webp',                   820, 1093, 82],
  ['nexus/img/unidade.webp',                       820, 1093, 82],
  ['io/eletroposto/img/fotos/produto-dc-900.webp', 900, 1132, 82],
  ['io/eletroposto/img/fotos/produto-dc-600.webp', 600,  755, 80],
  ['io/eletroposto/img/fotos/modelo-04-equipamento.webp', 480, 320, 80],
  ['eletroposto/img/produto-dc.jpg',              1040, 1418, 86],
];

async function main() {
  const origem = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!origem || !fs.existsSync(origem)) {
    console.error('Passe o caminho do arquivo do render. Ex.:');
    console.error('  node dashboard/scripts/trocar-carregador.js ~/Downloads/nexus-dc.png');
    process.exit(1);
  }

  const m = await sharp(origem).metadata();
  console.log(`origem: ${origem} — ${m.width}x${m.height} ${m.format}\n`);

  for (const [rel, w, h, q] of ALVOS) {
    const destino = path.join(RAIZ, rel);
    if (!fs.existsSync(destino)) { console.log(`PULADO (não existe): ${rel}`); continue; }
    const antes = Math.round(fs.statSync(destino).size / 1024);
    if (dry) { console.log(`[dry] ${rel}  ${w}x${h}  (hoje ${antes} KB)`); continue; }

    // `contain` e não `cover`: o produto é alto e estreito, e cortar para preencher
    // um slot deitado (o modelo-04 é 480x320) decepa a máquina pela metade.
    let img = sharp(origem).resize(w, h, { fit: 'contain', background: FUNDO });
    img = rel.endsWith('.jpg') ? img.jpeg({ quality: q }) : img.webp({ quality: q });
    await img.toFile(destino + '.tmp');
    fs.renameSync(destino + '.tmp', destino);
    const depois = Math.round(fs.statSync(destino).size / 1024);
    console.log(`ok  ${rel}  ${w}x${h}  ${antes} KB -> ${depois} KB`);
  }

  if (!dry) {
    console.log('\nNenhum HTML precisou mudar: os arquivos mantêm o mesmo nome e tamanho.');
    console.log('Confira /nexus, /eletroposto e /io/eletroposto antes de publicar.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
