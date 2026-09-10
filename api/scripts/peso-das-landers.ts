// ─────────────────────────────────────────────────────────────────────────────
// Quanto pesa cada landing page — e quanto pesaria depois do webp.
//
// O peso das nossas landers nunca foi HTML: em 04/08/2026 a /io mandava 2,58 MB
// porque um favicon de 468 KB era baixado 3×. Consertado à mão, virou 24,9 KB.
// O eletroposto e o LimpaPro ficaram para trás — porque "à mão" não escala e
// ninguém lembra da próxima lander.
//
// Este script mede e converte. Por padrão só MEDE (`--relatorio`), porque a nossa
// convenção é gerar o webp e COMMITAR o arquivo (ver a pipeline de fotos do
// eletroposto), não transformar no build. Build que reescreve `dashboard/public`
// briga com a convenção e com a Vercel.
//
//   npx ts-node scripts/peso-das-landers.ts              # só mede
//   npx ts-node scripts/peso-das-landers.ts --converter  # gera os .webp
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const RAIZ = path.resolve(__dirname, '../../dashboard/public');
const EXTENSOES = new Set(['.png', '.jpg', '.jpeg']);
/** Abaixo disso não vale o esforço nem o commit de um arquivo novo. */
const PISO_BYTES = 20 * 1024;

const converter = process.argv.includes('--converter');

interface Achado {
  arquivo: string;
  bytes: number;
  bytesWebp: number;
}

function varrer(dir: string, saida: string[] = []): string[] {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      varrer(p, saida);
    } else if (EXTENSOES.has(path.extname(e.name).toLowerCase())) {
      saida.push(p);
    }
  }
  return saida;
}

function kb(b: number): string {
  return (b / 1024).toFixed(1) + ' KB';
}

async function principal(): Promise<void> {
  if (!fs.existsSync(RAIZ)) {
    console.error('[peso] não achei ' + RAIZ);
    process.exit(1);
  }

  const arquivos = varrer(RAIZ).filter((f) => fs.statSync(f).size >= PISO_BYTES);
  console.log(`[peso] ${arquivos.length} imagens acima de ${kb(PISO_BYTES)} em dashboard/public\n`);

  const achados: Achado[] = [];

  for (const f of arquivos) {
    const bytes = fs.statSync(f).size;
    const destino = f.replace(/\.(png|jpe?g)$/i, '.webp');
    try {
      const buf = await sharp(f).webp({ quality: 82, effort: 5 }).toBuffer();
      achados.push({ arquivo: f, bytes, bytesWebp: buf.length });
      if (converter && buf.length < bytes) {
        fs.writeFileSync(destino, buf);
      }
    } catch (e) {
      console.warn('[peso] pulei ' + path.relative(RAIZ, f) + ': ' + String((e as Error).message).slice(0, 60));
    }
  }

  achados.sort((a, b) => b.bytes - b.bytesWebp - (a.bytes - a.bytesWebp));

  let total = 0;
  let totalWebp = 0;
  for (const a of achados) {
    total += a.bytes;
    totalWebp += a.bytesWebp;
    const corte = Math.round((1 - a.bytesWebp / a.bytes) * 100);
    if (corte <= 5) continue;
    console.log(
      `  ${String(corte).padStart(3)}%  ${kb(a.bytes).padStart(9)} → ${kb(a.bytesWebp).padStart(9)}  ${path.relative(RAIZ, a.arquivo)}`
    );
  }

  console.log(
    `\n[peso] total ${kb(total)} → ${kb(totalWebp)} ` +
      `(economia de ${kb(total - totalWebp)}, ${Math.round((1 - totalWebp / total) * 100)}%)`
  );

  if (converter) {
    console.log('[peso] .webp gravados. LEMBRE: o webp gerado TEM que ir no commit.');
  } else {
    console.log('[peso] só medi. Rode com --converter para gerar os .webp.');
  }
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
