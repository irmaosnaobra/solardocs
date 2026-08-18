// ─────────────────────────────────────────────────────────────────────────────
// GERA api/src/data/municipios.json — os 5.570 municípios do Brasil com nome,
// UF, código IBGE e uma coordenada.
//
// POR QUE UMA TABELA EMBARCADA, e não geocodificação online:
// a cidade que o lead digita precisa virar coordenada DENTRO da requisição que
// grava o cadastro, pra o aviso no WhatsApp já sair com a dica de quem está
// perto. Chamada externa nesse caminho é latência que a Vercel corta e, no caso
// do Nominatim, é 1 requisição por segundo com lote proibido — o IP inteiro
// levaria throttle, e o mesmo geocodificador é usado pelo raio da prospecção.
// Offline resolve em microssegundos e nunca cai.
//
// DE ONDE VÊM OS DADOS (duas APIs do IBGE, sem chave):
//   /api/v1/localidades/estados/{UF}/municipios  → id, nome (a verdade do nome)
//   /api/v3/malhas/estados/{UF}?intrarregiao=municipio&qualidade=minima
//                                               → o polígono de cada município
//
// A COORDENADA É O CENTRO DO RETÂNGULO ENVOLVENTE DO MUNICÍPIO, não a sede.
// Isso é uma aproximação assumida: em município gigante (Altamira/PA tem 159 mil
// km²) o centro pode ficar longe da cidade de verdade. Serve pra ordenar "quem
// está mais perto" numa escala de 100 a 400 km, que é o uso aqui. Se um dia
// isso virar rota, deslocamento de equipe ou preço por km, TROCAR por coordenada
// de sede — não reaproveitar calado.
//
// RODAR:  node api/scripts/gerar-municipios.mjs
// Leva ~1 min (27 estados × 2 requisições, com pausa de respeito entre elas).
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = resolve(AQUI, '../src/data/municipios.json');

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
             'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function json(url) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'irmaosnaobra-solardocs/1.0' } });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } catch (e) {
      if (tentativa === 3) throw e;
      await dormir(2000 * tentativa);
    }
  }
}

/** Centro do retângulo envolvente. Percorre a geometria inteira sem montar
 *  array intermediário — RS e MG têm polígono de milhares de pontos. */
function centro(geom) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const anda = (n) => {
    if (typeof n[0] === 'number' && typeof n[1] === 'number') {
      if (n[0] < minX) minX = n[0]; if (n[0] > maxX) maxX = n[0];
      if (n[1] < minY) minY = n[1]; if (n[1] > maxY) maxY = n[1];
      return;
    }
    for (const f of n) anda(f);
  };
  anda(geom.coordinates);
  if (!isFinite(minX)) return null;
  return { lng: +((minX + maxX) / 2).toFixed(4), lat: +((minY + maxY) / 2).toFixed(4) };
}

const municipios = [];
let semGeo = 0;

for (const uf of UFS) {
  const [lista, malha] = await Promise.all([
    json(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`),
    json(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}`
       + `?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`),
  ]);

  // A malha traz o código IBGE em `codarea` (string); a lista traz `id` (number).
  const porCodigo = new Map();
  for (const f of (malha.features || [])) {
    const cod = String(f.properties?.codarea || '').trim();
    const c = f.geometry ? centro(f.geometry) : null;
    if (cod && c) porCodigo.set(cod, c);
  }

  for (const m of lista) {
    const c = porCodigo.get(String(m.id));
    if (!c) { semGeo++; console.warn(`  sem geometria: ${m.nome}-${uf} (${m.id})`); continue; }
    municipios.push({ n: m.nome, uf, ibge: m.id, lat: c.lat, lng: c.lng });
  }
  console.log(`${uf}: ${lista.length} municípios`);
  await dormir(400);
}

municipios.sort((a, b) => a.n.localeCompare(b.n, 'pt-BR') || a.uf.localeCompare(b.uf));
mkdirSync(dirname(SAIDA), { recursive: true });
writeFileSync(SAIDA, JSON.stringify(municipios));

console.log(`\n${municipios.length} municípios gravados em ${SAIDA}`);
console.log(`sem geometria: ${semGeo}`);
if (municipios.length !== 5570) {
  console.warn(`ATENÇÃO: o Brasil tem 5.570 municípios e saíram ${municipios.length}.`);
}
