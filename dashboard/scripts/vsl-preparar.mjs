// Prepara a VSL da LP pra web: comprime o vídeo e tira a capa.
//
//   node scripts/vsl-preparar.mjs "C:\caminho\do\meu-video.mp4"
//
// Por que existir: o export de câmera/editor sai em 200–300 MB. Isso não pode
// ir pro repositório (engorda todo deploy), não passa no limite de 100 MB do
// upload do Cloudinary e, principalmente, é o tipo de peso que já derrubou
// landing daqui antes. Aqui ele vira um mp4 de web (H.264 + faststart, que é o
// que faz o vídeo começar a tocar antes de terminar de baixar) e um JPG de capa.
//
// A saída fica em `scripts/.vsl-saida/` (fora do build, fora do git).
// O passo seguinte é subir os dois arquivos e colar as URLs em
// src/components/Landing/vsl.ts.

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = resolve(AQUI, '.vsl-saida');

// Teto do upload do Cloudinary no plano atual (Free): 100 MB por vídeo.
const TETO_UPLOAD = 100 * 1024 * 1024;

const entrada = process.argv[2];
if (!entrada) {
  console.error('Uso: node scripts/vsl-preparar.mjs "<caminho do video>"');
  process.exit(1);
}
if (!existsSync(entrada)) {
  console.error(`Arquivo não encontrado: ${entrada}`);
  process.exit(1);
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const roda = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// 1) O que é esse arquivo. Duração e altura mandam na compressão: um take de
//    90s em 4K e uma VSL de 12 min pedem coisas diferentes.
const info = JSON.parse(roda('ffprobe', [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate:format=duration,size',
  '-of', 'json',
  entrada,
]));
const larg = info.streams?.[0]?.width ?? 0;
const alt = info.streams?.[0]?.height ?? 0;
const [fpsNum, fpsDen] = String(info.streams?.[0]?.r_frame_rate ?? '30/1').split('/');
const fps = Number(fpsNum) / Number(fpsDen || 1);
const dur = Number(info.format?.duration ?? 0);
const min = Math.floor(dur / 60);
const seg = Math.round(dur % 60);
const duracaoTexto = `${min}:${String(seg).padStart(2, '0')}`;

console.log(`\nOriginal: ${larg}x${alt} · ${Math.round(fps)}fps · ${duracaoTexto} · ${mb(statSync(entrada).size)}`);

// Vídeo em pé (celular) não vira paisagem à força — só limita a altura.
const emPe = alt > larg;
const escala = emPe ? 'scale=-2:min(1280\\,ih)' : 'scale=min(1280\\,iw):-2';

// Celular grava em 60fps. Numa VSL (fala, tela de sistema) ninguém enxerga a
// diferença pra 30, e 60 custa perto do dobro de arquivo — é o corte mais
// barato que existe aqui.
const filtroVideo = fps > 31 ? `${escala},fps=30` : escala;

mkdirSync(SAIDA, { recursive: true });
const mp4 = resolve(SAIDA, 'vsl-computador.mp4');
const capa = resolve(SAIDA, 'vsl-computador-capa.jpg');

// 2) O mp4 de web. crf 24 + preset slow é o ponto onde tela de sistema (texto
//    fino, muito branco) ainda fica legível sem o arquivo explodir.
console.log('Comprimindo… (o ffmpeg demora alguns minutos em VSL longa)');
execFileSync('ffmpeg', [
  '-y', '-i', entrada,
  '-vf', filtroVideo,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
  '-pix_fmt', 'yuv420p',          // sem isso, Safari/iOS abre tela preta
  '-profile:v', 'high', '-level', '4.0',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
  '-movflags', '+faststart',      // metadados na frente = toca antes de baixar tudo
  mp4,
], { stdio: ['ignore', 'inherit', 'inherit'] });

// 3) A capa: 1s pra dentro, porque o quadro 0 costuma ser preto/fade-in.
const posicaoCapa = dur > 2 ? '1' : '0';
execFileSync('ffmpeg', [
  '-y', '-ss', posicaoCapa, '-i', entrada,
  '-frames:v', '1', '-update', '1',   // sem -update o ffmpeg trata o .jpg como sequência
  '-vf', escala,
  '-q:v', '4',
  capa,
], { stdio: ['ignore', 'ignore', 'inherit'] });

const tamanho = statSync(mp4).size;
console.log(`\nPronto:`);
console.log(`  ${mp4}  →  ${mb(tamanho)}`);
console.log(`  ${capa}  →  ${mb(statSync(capa).size)}`);
console.log(`\n  duracao: '${duracaoTexto}'   ← copiar pro src/components/Landing/vsl.ts`);

// Se o original já vinha comprimido (export de app, vídeo baixado), re-encodar
// só engorda. Nesse caso sobe o original mesmo — desde que caiba no upload.
const tamanhoOriginal = statSync(entrada).size;
if (tamanho >= tamanhoOriginal && tamanhoOriginal <= TETO_UPLOAD) {
  console.log(
    `\nOBS: o comprimido ficou MAIOR que o original (${mb(tamanhoOriginal)}).\n` +
    `O arquivo de origem já estava comprimido — sobe o original e ignora o mp4 daqui.`
  );
}

if (tamanho > TETO_UPLOAD) {
  console.log(
    `\nATENÇÃO: passou dos ${mb(TETO_UPLOAD)} do upload do Cloudinary.\n` +
    `Roda de novo com mais compressão (troca crf 24 por 28 neste script) ou corta a VSL.`
  );
}
