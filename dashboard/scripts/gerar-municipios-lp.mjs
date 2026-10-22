// Gera dashboard/public/io/dados/municipios.json: a lista dos 5.570 municipios do IBGE
// no formato compacto [["Abadiania","GO"], ...], ordenada, para o campo de cidade do
// quiz do eletroposto sugerir o nome oficial ("Uberlandia-MG") em vez de texto livre.
//
// Fonte: api/src/data/municipios.json. Rodar de qualquer pasta:
//   node dashboard/scripts/gerar-municipios-lp.mjs
// A pagina le o arquivo pelo caminho ABSOLUTO /io/dados/municipios.json: caminho
// relativo em landing resolve um nivel acima e deixa a pagina muda.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const origem = raiz + 'api/src/data/municipios.json';
const destino = raiz + 'dashboard/public/io/dados/municipios.json';

const todos = JSON.parse(fs.readFileSync(origem, 'utf8'));
if (!Array.isArray(todos) || todos.length < 5000) throw new Error('municipios.json inesperado: ' + todos.length);

const lista = todos
  .map(m => [String(m.n).trim(), String(m.uf).trim().toUpperCase()])
  .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR') || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

const texto = JSON.stringify(lista);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, texto);
console.log(`${lista.length} municipios, ${Buffer.byteLength(texto)} bytes, gzip ~${zlib.gzipSync(texto).length} bytes -> ${destino}`);
