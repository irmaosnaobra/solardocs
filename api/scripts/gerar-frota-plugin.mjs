// Gera src/data/frotaPluginMunicipio.json a partir da planilha do SENATRAN
// "Frota por UF, Município e Combustível" (RENAVAM).
//
//   node scripts/gerar-frota-plugin.mjs <caminho do .xlsx> [julho/2026]
//
// Fora do boot da API: roda à mão quando sair planilha nova. Plug-in é o que
// recarrega na tomada: ELETRICO + ELETRICO/FONTE EXTERNA + ELETRICO/FONTE INTERNA
// + HIBRIDO PLUG-IN. Híbrido comum e flex com motor elétrico não entram, porque
// nunca param num carregador.
//
// O casamento com municipios.json é por UF e nome sem acento. O que não casar é
// impresso no fim: nome que mudou (Embu virou Embu das Artes) pede apelido abaixo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, '..', 'src', 'data', 'frotaPluginMunicipio.json');
const MUNICIPIOS = JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'src', 'data', 'municipios.json'), 'utf8'));

const PLUGIN = new Set(['ELETRICO', 'ELETRICO/FONTE EXTERNA', 'ELETRICO/FONTE INTERNA', 'HIBRIDO PLUG-IN']);

const UF = {
  'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA', 'CEARA': 'CE',
  'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', 'GOIAS': 'GO', 'MARANHAO': 'MA',
  'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'MINAS GERAIS': 'MG', 'PARA': 'PA',
  'PARAIBA': 'PB', 'PARANA': 'PR', 'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RORAIMA': 'RR',
  'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE', 'TOCANTINS': 'TO',
};

// Nome do RENAVAM → nome do IBGE, quando a grafia diverge. Chave e valor já normalizados.
// Levantados na planilha de julho/2026. Boa Esperança do Norte (MT) ficou de fora:
// é município novo e ainda não está no municipios.json.
const APELIDOS = {
  'RS|SANTANA DO LIVRAMENTO': 'SANT ANA DO LIVRAMENTO',
  'SC|SAO MIGUEL D OESTE': 'SAO MIGUEL DO OESTE',
  'PA|SANTA ISABEL DO PARA': 'SANTA IZABEL DO PARA',
  'SC|SAO LOURENCO D OESTE': 'SAO LOURENCO DO OESTE',
  'SC|BALNEARIO DE PICARRAS': 'BALNEARIO PICARRAS',
  'GO|BOM JESUS': 'BOM JESUS DE GOIAS',
  'RJ|PARATI': 'PARATY',
  'PA|ELDORADO DOS CARAJAS': 'ELDORADO DO CARAJAS',
  'PE|LAGOA DO ITAENGA': 'LAGOA DE ITAENGA',
  'MT|SANTO ANTONIO DO LEVERGER': 'SANTO ANTONIO DE LEVERGER',
  'PR|SANTA CRUZ DO MONTE CASTELO': 'SANTA CRUZ DE MONTE CASTELO',
  'PE|BELEM DE SAO FRANCISCO': 'BELEM DO SAO FRANCISCO',
  'RJ|TRAJANO DE MORAIS': 'TRAJANO DE MORAES',
  'RN|ARES': 'AREZ',
  'PE|IGUARACI': 'IGUARACY',
  'PR|BELA VISTA DO CAROBA': 'BELA VISTA DA CAROBA',
  'PR|MUNHOZ DE MELLO': 'MUNHOZ DE MELO',
  'RN|BOA SAUDE': 'JANUARIO CICCO',
  'RR|SAO LUIZ': 'SAO LUIZ DO ANAUA',
  'MG|AMPARO DA SERRA': 'AMPARO DO SERRA',
  'BA|SANTA TERESINHA': 'SANTA TEREZINHA',
  'RN|LAGOA DANTA': 'LAGOA D ANTA',
  'MG|BARAO D0 MONTE ALTO': 'BARAO DO MONTE ALTO',
  'PR|PINHAL DO SAO BENTO': 'PINHAL DE SAO BENTO',
  'BA|LAGEDO DO TABOCAL': 'LAJEDO DO TABOCAL',
  'TO|SAO VALERIO DA NATIVIDADE': 'SAO VALERIO',
  'TO|COUTO DE MAGALHAES': 'COUTO MAGALHAES',
  'SC|PRESIDENTE CASTELO BRANCO': 'PRESIDENTE CASTELLO BRANCO',
  'TO|FORTALEZA DO TABOCAO': 'TABOCAO',
  'SC|LAGEADO GRANDE': 'LAJEADO GRANDE',
  'MG|QUELUZITA': 'QUELUZITO',
  'PB|SAO DOMINGOS DE POMBAL': 'SAO DOMINGOS',
  'SE|AMPARO DE SAO FRANCISCO': 'AMPARO DO SAO FRANCISCO',
  'PB|SANTAREM': 'JOCA CLAUDINO',
};

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

const xmlTexto = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function lerPlanilha(arquivo) {
  const zip = await JSZip.loadAsync(fs.readFileSync(arquivo));
  const shared = await zip.file('xl/sharedStrings.xml')?.async('string') ?? '';
  const strs = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlTexto(m[1]));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const linhas = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cel = [...r[1].matchAll(/<c r="[A-Z]+\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(c => {
      const corpo = c[2] || '';
      const v = corpo.match(/<v>([^<]*)<\/v>/)?.[1];
      if (/t="s"/.test(c[1])) return strs[Number(v)] ?? '';
      if (/t="inlineStr"/.test(c[1])) return xmlTexto(corpo);
      return v ?? '';
    });
    linhas.push(cel);
  }
  return linhas;
}

async function main() {
  const arquivo = process.argv[2];
  const ref = process.argv[3] || 'julho/2026';
  if (!arquivo) { console.error('uso: node scripts/gerar-frota-plugin.mjs <planilha.xlsx> [mes/ano]'); process.exit(1); }

  const linhas = await lerPlanilha(arquivo);
  const hdr = linhas.findIndex(l => l.includes('Qtd. Veículos'));
  if (hdr < 0) throw new Error('cabeçalho "Qtd. Veículos" não encontrado');

  const porChave = new Map(MUNICIPIOS.map(m => [`${m.uf}|${norm(m.n)}`, m.ibge]));
  const brasil = { frota: 0, plugin: 0 };
  const brasilComUf = { frota: 0, plugin: 0 };
  const uf = {};
  const municipios = {};
  const naoCasados = new Map();
  const ufsIgnoradas = new Map();

  for (const l of linhas.slice(hdr + 1)) {
    if (l.length < 4) continue;
    const [ufNome, munNome, combustivel, qtdTxt] = l;
    const qtd = Number(qtdTxt) || 0;
    const sigla = UF[norm(ufNome)];
    const plug = PLUGIN.has(String(combustivel).trim()) ? qtd : 0;
    // O total Brasil é o da planilha inteira (é o número que o SENATRAN publica).
    // Cerca de 3 milhões de veículos vêm com UF "Sem Informação": entram no Brasil e
    // em nenhuma UF, então a comparação de adoção usa `brasil_com_uf`, que é a soma
    // das UFs e fala a mesma língua dos municípios.
    brasil.frota += qtd; brasil.plugin += plug;
    if (!sigla) { ufsIgnoradas.set(ufNome, (ufsIgnoradas.get(ufNome) || 0) + qtd); continue; }

    brasilComUf.frota += qtd; brasilComUf.plugin += plug;
    uf[sigla] ??= { frota: 0, plugin: 0 };
    uf[sigla].frota += qtd; uf[sigla].plugin += plug;

    const n = norm(munNome);
    const ibge = porChave.get(`${sigla}|${APELIDOS[`${sigla}|${n}`] || n}`);
    if (!ibge) { naoCasados.set(`${sigla}|${n}`, (naoCasados.get(`${sigla}|${n}`) || 0) + qtd); continue; }
    const k = String(ibge);
    municipios[k] ??= [0, 0];
    municipios[k][0] += qtd; municipios[k][1] += plug;
  }

  const saida = {
    ref,
    fonte: 'SENATRAN/RENAVAM, frota por UF, município e combustível',
    categorias_plugin: [...PLUGIN],
    brasil,
    brasil_com_uf: brasilComUf,
    uf,
    municipios,
  };
  fs.writeFileSync(SAIDA, JSON.stringify(saida));

  console.log('Brasil:', brasil, 'com UF:', brasilComUf);
  console.log('Municípios casados:', Object.keys(municipios).length, 'de', MUNICIPIOS.length);
  console.log('UF fora do mapa (só no total Brasil):', [...ufsIgnoradas]);
  console.log('Não casados:', naoCasados.size);
  for (const [k, q] of [...naoCasados].sort((a, b) => b[1] - a[1])) console.log('  ', k, q);
  console.log('Gravado em', SAIDA);
}

main().catch((e) => { console.error(e); process.exit(1); });
