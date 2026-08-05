#!/usr/bin/env node
/* Pipeline de imagem com sharp — substitui a conversão por puppeteer+canvas.
 *
 * POR QUÊ: peso de imagem é o problema medido das landers (6 capas de hero
 * ocupavam 262KB pra renderizar a 105px). O sharp faz isso melhor, em uma
 * passada, e ainda abre AVIF — que o canvas não dá.
 *
 * USO:
 *   node tools/otimizar-imagens.js <arquivo-ou-pasta> [--larguras 220,440] [--avif] [--saida <pasta>]
 *
 * EXEMPLOS:
 *   node tools/otimizar-imagens.js "C:/.../limpapro/img/hero.png" --larguras 760,1200
 *   node tools/otimizar-imagens.js "C:/.../limpapro/img" --larguras 220 --avif
 *
 * Gera <nome>-<largura>.webp (e .avif com a flag) ao lado do original, ou na
 * pasta do --saida. Nunca sobrescreve o original. Imprime o antes/depois em KB.
 */
'use strict';

const path = require('path');
const fs = require('fs');

// O sharp veio junto do Next 16 e mora no dashboard — não resolve da raiz nem
// das pastas das landers. Resolver aqui evita depender do shell de quem chama.
const CAMINHO_SHARP = path.join(__dirname, '..', 'dashboard', 'node_modules', 'sharp');
let sharp;
try {
  sharp = require(CAMINHO_SHARP);
} catch {
  try {
    sharp = require('sharp');
  } catch {
    console.error('sharp não encontrado. Esperado em', CAMINHO_SHARP);
    console.error('Se sumiu, instale no projeto: npm i -D sharp');
    process.exit(1);
  }
}

const EXTENSOES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);

function argumentos(argv) {
  const alvo = argv[2];
  if (!alvo) {
    console.error('Faltou o arquivo ou a pasta. Veja o cabeçalho deste arquivo.');
    process.exit(1);
  }
  const pega = (flag, padrao) => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const larguras = pega('--larguras', '')
    .split(',')
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  return {
    alvo,
    larguras,                          // vazio = mantém a largura original
    avif: argv.includes('--avif'),
    saida: pega('--saida', null),
  };
}

function listar(alvo) {
  const st = fs.statSync(alvo);
  if (st.isFile()) return [alvo];
  return fs
    .readdirSync(alvo)
    .map((n) => path.join(alvo, n))
    .filter((f) => fs.statSync(f).isFile() && EXTENSOES.has(path.extname(f).toLowerCase()));
}

const kb = (bytes) => (bytes / 1024).toFixed(1).padStart(7) + ' KB';

async function converter(arquivo, opcoes) {
  const original = fs.statSync(arquivo).size;
  const base = path.basename(arquivo, path.extname(arquivo));
  const destinoDir = opcoes.saida || path.dirname(arquivo);
  if (!fs.existsSync(destinoDir)) fs.mkdirSync(destinoDir, { recursive: true });

  const meta = await sharp(arquivo).metadata();
  // Nunca AUMENTAR: redimensionar pra cima só inventa peso sem ganhar nitidez.
  const larguras = (opcoes.larguras.length ? opcoes.larguras : [meta.width]).filter(
    (w) => w <= meta.width
  );

  if (!larguras.length) {
    console.log(`  ${base}: largura pedida é maior que a original (${meta.width}px) — pulado`);
    return;
  }

  console.log(`\n${path.basename(arquivo)}  (${meta.width}×${meta.height}, ${kb(original).trim()})`);

  for (const largura of larguras) {
    const sufixo = larguras.length === 1 && largura === meta.width ? '' : `-${largura}`;

    const destinoWebp = path.join(destinoDir, `${base}${sufixo}.webp`);
    await sharp(arquivo).resize({ width: largura }).webp({ quality: 82 }).toFile(destinoWebp);
    const tw = fs.statSync(destinoWebp).size;
    console.log(`  webp ${String(largura).padStart(5)}px ${kb(tw)}  (${(100 - (tw / original) * 100).toFixed(0)}% menor)  ${path.basename(destinoWebp)}`);

    if (opcoes.avif) {
      const destinoAvif = path.join(destinoDir, `${base}${sufixo}.avif`);
      await sharp(arquivo).resize({ width: largura }).avif({ quality: 55 }).toFile(destinoAvif);
      const ta = fs.statSync(destinoAvif).size;
      console.log(`  avif ${String(largura).padStart(5)}px ${kb(ta)}  (${(100 - (ta / original) * 100).toFixed(0)}% menor)  ${path.basename(destinoAvif)}`);
    }
  }
}

(async () => {
  const opcoes = argumentos(process.argv);
  const arquivos = listar(opcoes.alvo);
  if (!arquivos.length) {
    console.log('Nenhuma imagem encontrada em', opcoes.alvo);
    return;
  }
  console.log(`sharp ${sharp.versions.sharp} · ${arquivos.length} imagem(ns)`);
  for (const a of arquivos) await converter(a, opcoes);
  console.log('\nLembrete: no <img>, servir com srcset + `height:auto` no CSS —');
  console.log('sem height:auto os atributos width/height travam a altura.');
})().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
