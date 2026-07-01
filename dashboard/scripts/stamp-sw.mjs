// Prebuild: carimba o service worker com um token único por build.
//
// POR QUÊ: public/sw.js é estático. Entre dois deploys que não editam o arquivo
// ele fica byte-idêntico → o browser (que detecta update SW por comparação de
// bytes do sw.js) NUNCA vê uma versão nova → a faixa "Nova versão disponível"
// nunca aparece. Trocar __BUILD_ID__ pelo SHA do commit faz TODO deploy mudar o
// sw.js, então o update passa a ser detectável de verdade.
//
// RODA ANTES do `next build` (hook prebuild). Tem que ser antes: o next build
// snapshota public/ pro output estático; se o stamp rodasse depois, editaria um
// arquivo que já não é o servido (foi o bug do 1º deploy — carimbou mas o /sw.js
// servido continuou com o placeholder). A Vercel expõe VERCEL_GIT_COMMIT_SHA;
// fora dela (build local) é no-op pelo gate VERCEL!=1 abaixo. Idempotente: se já
// foi carimbado (sem placeholder), não faz nada — não quebra rebuilds.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = join(__dirname, '..', 'public', 'sw.js');

// SÓ carimba no build da Vercel. Localmente é no-op: senão todo `npm run build`
// reescreveria public/sw.js (arquivo VERSIONADO) com um timestamp e sujaria a
// árvore — risco de commitar um sw.js já carimbado, o que congelaria o VERSION
// e faria o stamp da Vercel virar no-op (placeholder some). Gatear aqui garante
// que o fonte no git SEMPRE tem o placeholder num checkout limpo.
if (process.env.VERCEL !== '1') {
  console.log('[stamp-sw] build local (VERCEL!=1) — não carimba, evita sujar o fonte.');
  process.exit(0);
}

// SHA curto do commit (7 chars); fallback improvável dentro da Vercel.
const rawSha = process.env.VERCEL_GIT_COMMIT_SHA || '';
const buildId = rawSha ? rawSha.slice(0, 7) : `build-${Date.now()}`;

try {
  const src = readFileSync(SW_PATH, 'utf8');

  if (!src.includes('__BUILD_ID__')) {
    // Já carimbado (rebuild sem git clean) ou placeholder removido — nada a fazer.
    console.log('[stamp-sw] sw.js já carimbado ou sem placeholder; pulando.');
    process.exit(0);
  }

  const out = src.replaceAll('__BUILD_ID__', buildId);
  writeFileSync(SW_PATH, out);
  console.log(`[stamp-sw] sw.js carimbado com VERSION=sd-${buildId}`);
} catch (err) {
  // NÃO derruba o build por causa disso — sem carimbo o pior caso é a faixa não
  // aparecer (comportamento antigo), não um app quebrado.
  console.warn('[stamp-sw] falhou ao carimbar sw.js (seguindo mesmo assim):', err?.message || err);
  process.exit(0);
}
