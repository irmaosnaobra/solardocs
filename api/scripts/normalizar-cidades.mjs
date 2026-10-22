#!/usr/bin/env node
// Limpeza das cidades que já estão no banco do Gerador → "Município-UF" (IBGE).
//
// A lógica é a MESMA da API: o script usa o `dist/` compilado (cidadeCanonica,
// geoCidade e a lista de tabelas da varredura (cidadeTabelas)), nada é copiado. Rode antes:
//   cd api && npm run build
//
// SEM UF digitada, o município só é aceito com o DDD do telefone batendo (ou sendo capital):
// "Taguatinga" no DDD 61 não vira Taguatinga-TO, "Moema" no 11 não vira Moema-MG. O que a regra
// antiga aceitava e esta mantém aparece na prévia como "mantida pela regra do DDD".
//
// Todo update confere o valor antigo (.eq('cidade', <original lido>)) e só conta as linhas que o
// banco devolveu: edição de consultor no meio, ou update negado pela RLS sem erro, ficam como
// "puladas", nunca como feitas.
//
// ATENÇÃO, GATILHO DO eletroposto_nota1: o `before update` dessa tabela
// (MIGRATION_eletroposto_qualificacao.sql) preenche slugs e `motivo_descarte` NULOS quando a
// linha é atualizada, com a mesma lógica da ficha nova. É aceitável, mas o --reverter volta SÓ a
// coluna `cidade`: esse preenchimento NÃO é desfeito.
//
// Uso (de dentro de api/):
//   node scripts/normalizar-cidades.mjs                      PRÉVIA: não escreve no banco
//   node scripts/normalizar-cidades.mjs --aplicar            backup + update + conferência
//   node scripts/normalizar-cidades.mjs --reverter <backup>  volta do backup (só onde a cidade ainda é a nova)
//
// A prévia grava ~/Desktop/cidades-normalizacao-previa.csv (tabela;id;cidade_original;cidade_nova;status;ddd).
// A coluna `ddd` leva só os 2 dígitos do DDD, nunca o telefone.
// O --aplicar grava ~/Desktop/cidades-backup-AAAAMMDD-HHMM.csv (tabela;id;cidade_original;cidade_nova)
// ANTES de qualquer update. Backup de 3 colunas (formato antigo) o --reverter recusa.
// A URL e a chave pública vêm de src/utils/supabaseGerador.ts; a chave nunca é impressa.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(AQUI, '..');
const DESKTOP = 'C:/Users/55349/Desktop';
const require = createRequire(import.meta.url);

const DIST = path.join(API, 'dist/services/io');
for (const f of ['cidadeCanonica.js', 'geoCidade.js', 'cidadeTabelas.js']) {
  if (!fs.existsSync(path.join(DIST, f))) {
    console.error(`Falta ${path.join(DIST, f)}. Rode "npm run build" em api/ primeiro.`);
    process.exit(1);
  }
}
const { cidadeCanonica, aceitariaSemDdd, dddDoTelefone } = require(path.join(DIST, 'cidadeCanonica.js'));
const { resolverCidade } = require(path.join(DIST, 'geoCidade.js'));
const { TABELAS_DE_CIDADE } = require(path.join(DIST, 'cidadeTabelas.js'));

function credenciais() {
  const fonte = fs.readFileSync(path.join(API, 'src/utils/supabaseGerador.ts'), 'utf8');
  const url = (fonte.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const chave = (fonte.match(/SUPABASE_PUBLICA\s*=\s*'([^']+)'/) || [])[1];
  if (!url || !chave) throw new Error('não achei SUPABASE_URL e SUPABASE_PUBLICA em src/utils/supabaseGerador.ts');
  return { url, chave };
}
const { url, chave } = credenciais();
const db = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

// ── CSV (ponto e vírgula, UTF-8 com BOM) ──────────────────────────────────
const celula = (v) => {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function gravarCsv(arquivo, cabecalho, linhas) {
  const txt = [cabecalho.join(';'), ...linhas.map((l) => l.map(celula).join(';'))].join('\r\n') + '\r\n';
  fs.writeFileSync(arquivo, '\uFEFF' + txt, 'utf8');
}
function lerCsv(arquivo) {
  const txt = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '');
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo.replace(/\r$/, '')); linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// ── leitura paginada (1000 em 1000, ordenada pela chave única) ────────────
async function lerTudo(t) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from(t.nome)
      .select(`${t.chave},cidade,${t.telefone}`)
      .order(t.chave, { ascending: true })
      .range(de, de + 999);
    if (error) throw new Error(`${t.nome}: ${error.message}`);
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

function classificar(l, t) {
  const original = l.cidade ?? '';
  const c = cidadeCanonica(original, l[t.telefone]);
  if (c.status === 'vazia') return { original, nova: '', status: 'vazia' };
  if (c.status === 'ok' || c.status === 'ddd') {
    return c.valor === original
      ? { original, nova: c.valor, status: 'no_formato' }
      : { original, nova: c.valor, status: c.status };
  }
  // Nome único no país (ou UF só de estado) que a regra ANTIGA aceitaria e o DDD não confirma.
  if (aceitariaSemDdd(original)) return { original, nova: original, status: 'regra_ddd' };
  const r = resolverCidade(original);
  // `ok` aqui é nome único no país que a guarda de abreviação ("Conquista", "Barra") segurou: ambígua.
  return { original, nova: original, status: r.status === 'nao_encontrada' ? 'nao_encontrada' : 'ambigua' };
}

// ── PRÉVIA ────────────────────────────────────────────────────────────────
async function analisar() {
  const saida = [];                 // linhas do CSV
  const resumo = {};                // por tabela
  const naoResolvidos = new Map();  // valor → contagem
  const aMudar = [];                // {t, id, original, nova}
  for (const t of TABELAS_DE_CIDADE) {
    const linhas = await lerTudo(t);
    const r = { total: linhas.length, no_formato: 0, ok: 0, ddd: 0, regra_ddd: 0, ambigua: 0, nao_encontrada: 0, vazia: 0 };
    for (const l of linhas) {
      const c = classificar(l, t);
      r[c.status]++;
      saida.push([t.nome, l[t.chave], c.original, c.nova, c.status, dddDoTelefone(l[t.telefone])]);
      if (c.status === 'ok' || c.status === 'ddd') aMudar.push({ t, id: l[t.chave], original: c.original, nova: c.nova });
      if (c.status === 'ambigua' || c.status === 'nao_encontrada' || c.status === 'regra_ddd') {
        const k = c.original.trim();
        naoResolvidos.set(k, (naoResolvidos.get(k) || 0) + 1);
      }
    }
    resumo[t.nome] = r;
  }
  return { saida, resumo, naoResolvidos, aMudar };
}

function imprimirResumo(resumo, naoResolvidos) {
  for (const [nome, r] of Object.entries(resumo)) {
    console.log(`${nome}: total ${r.total} · já no formato ${r.no_formato} · corrige por nome (ok) ${r.ok} · ` +
      `corrige pelo DDD ${r.ddd} · mantida pela regra do DDD ${r.regra_ddd} · ambígua ${r.ambigua} · ` +
      `não encontrada ${r.nao_encontrada} · vazia ${r.vazia}`);
  }
  const top = [...naoResolvidos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
  console.log('\nOs 30 valores não resolvidos mais comuns, mantidos pela regra do DDD inclusive (valor → vezes):');
  for (const [v, n] of top) console.log(`  ${String(n).padStart(4)}  ${JSON.stringify(v)}`);
}

// ── escrita (só --aplicar / --reverter) ───────────────────────────────────
// Atualiza só onde a cidade ainda é `de` e devolve os ids que o banco confirmou (.select).
// O que ficou de fora mudou no meio (edição de consultor) ou foi negado pela RLS sem erro.
async function atualizar(t, de, para, ids) {
  const confirmados = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const { data, error } = await db.from(t.nome)
      .update({ cidade: para }).eq('cidade', de).in(t.chave, lote).select(t.chave);
    if (error) throw new Error(`${t.nome} → ${JSON.stringify(para)}: ${error.message}`);
    confirmados.push(...data.map((l) => l[t.chave]));
  }
  return confirmados;
}

async function conferir(t, ids, esperado) {
  let divergentes = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const { data, error } = await db.from(t.nome).select(`${t.chave},cidade`).in(t.chave, lote);
    if (error) throw new Error(`conferência ${t.nome}: ${error.message}`);
    divergentes += lote.length - data.filter((l) => l.cidade === esperado).length;
  }
  return divergentes;
}

function agrupar(itens, chaveDoGrupo) {
  const m = new Map();
  for (const it of itens) {
    const k = chaveDoGrupo(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

const agoraArquivo = () => {
  const d = new Date(Date.now() - 3 * 3600 * 1000);       // o relógio local é UTC; o nome do arquivo vai em Brasília
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

const AVISO_GATILHO = 'Aviso: o gatilho do eletroposto_nota1 preenche slugs e motivo_descarte NULOS quando a linha é ' +
  'atualizada; o --reverter volta só a coluna cidade e NÃO desfaz esse preenchimento.';

async function aplicar(aMudar) {
  const arquivo = `${DESKTOP}/cidades-backup-${agoraArquivo()}.csv`;
  gravarCsv(arquivo, ['tabela', 'id', 'cidade_original', 'cidade_nova'], aMudar.map((x) => [x.t.nome, x.id, x.original, x.nova]));
  console.log(`Backup gravado: ${arquivo} (${aMudar.length} linhas)`);
  let feitas = 0, puladas = 0, divergentes = 0;
  for (const [, grupo] of agrupar(aMudar, (x) => `${x.t.nome}\u0000${x.original}\u0000${x.nova}`)) {
    const { t, original, nova } = grupo[0];
    const ids = grupo.map((x) => x.id);
    const confirmados = await atualizar(t, original, nova, ids);
    feitas += confirmados.length;
    puladas += ids.length - confirmados.length;
    divergentes += await conferir(t, confirmados, nova);
  }
  console.log(`Aplicado: ${feitas} linhas atualizadas · puladas (mudaram no meio ou RLS): ${puladas} · divergentes na releitura: ${divergentes}`);
  console.log(AVISO_GATILHO);
}

async function reverter(arquivo) {
  const [cab, ...linhas] = lerCsv(arquivo).filter((l) => l.length >= 3);
  if (!cab || cab.length < 4 || cab[3] !== 'cidade_nova') {
    throw new Error('backup sem a coluna cidade_nova (formato antigo): recusado, porque reverter sem conferir o valor atual sobrescreveria edição posterior');
  }
  const porNome = Object.fromEntries(TABELAS_DE_CIDADE.map((t) => [t.nome, t]));
  const itens = linhas.map(([tabela, id, original, nova]) => {
    const t = porNome[tabela];
    if (!t) throw new Error(`tabela desconhecida no backup: ${tabela}`);
    return { t, id: t.chave === 'id' ? Number(id) : id, original, nova };
  });
  let feitas = 0, puladas = 0, divergentes = 0;
  for (const [, grupo] of agrupar(itens, (x) => `${x.t.nome}\u0000${x.nova}\u0000${x.original}`)) {
    const { t, original, nova } = grupo[0];
    const ids = grupo.map((x) => x.id);
    const confirmados = await atualizar(t, nova, original, ids);   // só onde a cidade ainda é a nova
    feitas += confirmados.length;
    puladas += ids.length - confirmados.length;
    divergentes += await conferir(t, confirmados, original);
  }
  console.log(`Revertido: ${feitas} linhas · puladas (cidade já não é a nova, ou RLS): ${puladas} · divergentes na releitura: ${divergentes}`);
  console.log(AVISO_GATILHO);
}

// ── main ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
try {
  if (args[0] === '--reverter') {
    if (!args[1]) throw new Error('uso: --reverter <arquivo de backup>');
    await reverter(args[1]);
  } else {
    const { saida, resumo, naoResolvidos, aMudar } = await analisar();
    const previa = `${DESKTOP}/cidades-normalizacao-previa.csv`;
    gravarCsv(previa, ['tabela', 'id', 'cidade_original', 'cidade_nova', 'status', 'ddd'], saida);
    console.log(`Prévia gravada: ${previa} (${saida.length} linhas)\n`);
    imprimirResumo(resumo, naoResolvidos);
    console.log(`\nLinhas que o --aplicar mudaria: ${aMudar.length}`);
    if (args.includes('--aplicar')) await aplicar(aMudar);
    else console.log('(prévia: nada foi escrito no banco)');
    console.log(AVISO_GATILHO);
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exit(1);
}
