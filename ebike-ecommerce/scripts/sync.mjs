/**
 * Gera a cópia de reserva do catálogo (src/data/snapshot.json).
 *
 * A loja lê o fornecedor ao vivo. Este arquivo é o paraquedas: se o portal
 * cair, mudar os IDs das Server Actions ou recusar o login, a página continua
 * no ar com a última leitura boa, e avisa que está na reserva.
 *
 *   node scripts/sync.mjs
 *   SOOLLAR_EMAIL=... SOOLLAR_SENHA=... node scripts/sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { buscarNoFornecedor } from '../src/lib/montarCatalogo.ts';

const destino = path.join(process.cwd(), 'src', 'data', 'snapshot.json');

const catalogo = await buscarNoFornecedor();

if (catalogo.bikes.length === 0) {
  console.error('Nenhuma bike voltou do fornecedor. A reserva NAO foi sobrescrita.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(catalogo, null, 1) + '\n', 'utf8');

const semFicha = catalogo.bikes.filter((b) => b.ficha.length === 0).length;
const semEstoque = catalogo.bikes.filter((b) => b.estoque === null).length;

console.log(`CD: ${catalogo.cd} | Seção: ${catalogo.secao}`);
console.log(`Logado no fornecedor: ${catalogo.logado ? 'sim' : 'NÃO (sem preço negociado nem estoque)'}`);
console.log(`Bikes: ${catalogo.bikes.length}`);
console.log(`Marcas: ${[...new Set(catalogo.bikes.map((b) => b.marca))].join(', ')}`);
if (semFicha) console.log(`Aviso: ${semFicha} item(ns) sem ficha técnica.`);
if (semEstoque) console.log(`Aviso: ${semEstoque} item(ns) sem quantidade informada.`);
console.log(`Salvo em ${destino}`);
