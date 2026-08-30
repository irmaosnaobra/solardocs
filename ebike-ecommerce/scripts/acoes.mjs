/**
 * Redescobre os IDs das Server Actions do portal do fornecedor.
 *
 * Quando eles fazem deploy, os IDs mudam e a leitura ao vivo para de funcionar.
 * Rode isto, compare com o objeto ACAO de src/lib/soollar.ts e troque o que
 * mudou. Leva dez segundos e evita ter que caçar tudo de novo.
 *
 *   node scripts/acoes.mjs
 */
import http2 from 'node:http2';

const BASE = 'https://soollar.com.br';
const PAGINA = `/cd/${process.env.SOOLLAR_CD ?? 'cduberlandiamg'}/secao/${process.env.SOOLLAR_SECAO ?? 'ebike'}`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// O portal é servido por trás do Cloudflare: fetch do Node leva 403, HTTP/2 passa.
function baixar(caminho) {
  return new Promise((resolver, rejeitar) => {
    const cliente = http2.connect(BASE);
    cliente.on('error', rejeitar);
    const req = cliente.request({ ':method': 'GET', ':path': caminho, 'user-agent': UA });
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('error', rejeitar);
    req.on('end', () => {
      cliente.close();
      resolver(Buffer.concat(pedacos).toString('utf8'));
    });
    req.end();
  });
}

// A ficha do produto vive noutra rota, com outros chunks: varremos as duas.
const CD = process.env.SOOLLAR_CD ?? 'cduberlandiamg';
const paginas = [PAGINA, `/cd/${CD}/produto/1`, '/auth/login'];
const chunks = new Set();
for (const pagina of paginas) {
  const html = await baixar(pagina);
  for (const c of html.match(/\/_next\/static\/chunks\/[A-Za-z0-9%()[\]/_.-]+\.js/g) ?? []) {
    chunks.add(c);
  }
}
console.log(`${chunks.size} chunks em ${paginas.join(', ')}`);

const achados = new Map();
for (const c of chunks) {
  let js;
  try {
    js = await baixar(c);
  } catch {
    continue;
  }
  const re = /createServerReference\)?\("([a-f0-9]+)",[^,]+,[^,]+,[^,]+,"([A-Za-z]+)"/g;
  for (const m of js.matchAll(re)) achados.set(m[2], m[1]);
}

console.log(`\n${achados.size} Server Actions:\n`);
for (const [nome, id] of [...achados].sort()) console.log(`  ${nome.padEnd(38)} ${id}`);
console.log('\nCompare com o objeto ACAO em src/lib/soollar.ts.');
