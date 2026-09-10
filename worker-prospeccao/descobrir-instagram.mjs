#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   DESCOBERTA DE EMPRESAS DENTRO DO INSTAGRAM

   Os outros dois scripts partem de uma empresa que a gente já conhece:
     colher-instagram.mjs   empresa da base → procura o @ no site dela
     buscar-instagram.mjs   empresa da base → procura o @ na lupa do Instagram

   Este aqui NÃO parte de nada. Ele procura empresas que a gente nunca viu,
   varrendo "energia solar <cidade>" no Instagram, cidade por cidade — que é o
   que você faria na lupa, uma por vez, se tivesse o dia inteiro.

   Precisa do Chrome logado no Instagram (mesmo perfil do worker):

     node descobrir-instagram.mjs --dry              # mostra o que acharia
     node descobrir-instagram.mjs                    # grava na base
     node descobrir-instagram.mjs --uf=PA            # só um estado
     node descobrir-instagram.mjs --cidades=30       # quantas cidades por rodada

   O que ele grava: empresa, @, cidade, UF. Sem telefone — é uma empresa que
   existe no Instagram e só. A dedup é por @, então rodar de novo não duplica.
   ───────────────────────────────────────────────────────────────────────────── */

const SUPA = 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1';
const KEY  = process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';
const CDP  = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const H    = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const ARG   = process.argv.slice(2);
const DRY   = ARG.includes('--dry');
const UF    = (ARG.find(a => a.startsWith('--uf='))?.split('=')[1] || '').toUpperCase();
const NCID  = Number(ARG.find(a => a.startsWith('--cidades='))?.split('=')[1] || 25);
const MIN_MS = Number(process.env.MIN_MS || 5000);
const MAX_MS = Number(process.env.MAX_MS || 11000);

// Três termos por cidade. Mais que isso repete os mesmos perfis e só gasta
// consulta — a busca do Instagram já é fuzzy.
const TERMOS = ['energia solar', 'energia fotovoltaica', 'solar'];
const LISTA = 'Instagram — descobertas na busca';

const dorme = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a);

// ── CDP mínimo ──────────────────────────────────────────────────────────────
class Aba {
  constructor(ws) { this.ws = ws; this.id = 0; this.esperando = new Map(); }
  static conectar(url) {
    return new Promise((ok, erro) => {
      const ws = new WebSocket(url); const aba = new Aba(ws);
      ws.onopen = () => ok(aba);
      ws.onerror = e => erro(new Error('WebSocket falhou: ' + (e.message || '')));
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data); const p = aba.esperando.get(m.id);
        if (!p) return; aba.esperando.delete(m.id);
        m.error ? p.erro(new Error(m.error.message)) : p.ok(m.result);
      };
    });
  }
  static async abrir() {
    const v = await (await fetch(`${CDP}/json/version`)).json();
    if (!v.webSocketDebuggerUrl) throw new Error('Chrome sem porta de debug');
    const br = await Aba.conectar(v.webSocketDebuggerUrl);
    const { targetId } = await br.enviar('Target.createTarget', { url: 'https://www.instagram.com/' });
    br.ws.close();
    const alvos = await (await fetch(`${CDP}/json/list`)).json();
    const aba = await Aba.conectar(alvos.find(t => t.id === targetId).webSocketDebuggerUrl);
    aba.targetId = targetId;
    await aba.enviar('Runtime.enable', {});
    await dorme(2500);
    return aba;
  }
  enviar(method, params) {
    const id = ++this.id;
    return new Promise((ok, erro) => {
      this.esperando.set(id, { ok, erro });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.esperando.delete(id)) erro(new Error(method + ' sem resposta')); }, 30000);
    });
  }
  async js(expr) {
    const r = await this.enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'erro no JS');
    return r.result?.value;
  }
  async fechar() {
    try { await fetch(`${CDP}/json/close/${this.targetId}`); } catch {}
    try { this.ws.close(); } catch {}
  }
}

// ── filtro: isso é uma integradora solar? ───────────────────────────────────
const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Precisa cheirar a solar…
const SOLAR = /(solar|fotovolt|energia)/;
// …e NÃO cheirar a nenhuma destas. Curso, loja de equipamento, marca de
// fabricante e perfil pessoal entram na busca e não são o comprador do SolarDoc.
const FORA = new RegExp([
  'curso', 'cursos', 'treinamento', 'aula', 'professor', 'mentoria', 'ensino', 'faculdade',
  'distribuidora', 'atacado', 'importadora', 'fabrica', 'fabricante', 'industria',
  'consorcio', 'financiamento', 'credito', 'seguro', 'imobiliaria',
  'aquecedor', 'aquecimento', 'boiler', 'piscina',
  'oficial', 'brasil oficial', 'noticias', 'portal', 'revista', 'blog',
].join('|'));

function avaliar(u) {
  const texto = norm(u.username + ' ' + (u.full_name || ''));
  if (!SOLAR.test(texto)) return { ok: false, motivo: 'não parece solar' };
  if (FORA.test(texto))   return { ok: false, motivo: 'curso/distribuidora/fabricante/outro' };
  if (u.verificado)       return { ok: false, motivo: 'verificado — é marca grande, não integradora local' };
  if (String(u.username).length < 4) return { ok: false, motivo: '@ curto demais' };
  return { ok: true };
}

async function buscar(aba, termo) {
  const js = `(async () => {
    try {
      const r = await fetch('/web/search/topsearch/?context=blended&query='
        + encodeURIComponent(${JSON.stringify(termo)}), { headers: { 'X-IG-App-ID': '936619743392459' } });
      if (!r.ok) return { erro: 'HTTP ' + r.status };
      const j = await r.json();
      return { users: (j.users || []).map(u => ({
        username: u.user?.username, full_name: u.user?.full_name,
        verificado: !!u.user?.is_verified, privado: !!u.user?.is_private,
      })).filter(u => u.username) };
    } catch (e) { return { erro: String(e && e.message || e) }; }
  })()`;
  return await aba.js(js);
}

// ── cidades: as maiores do Brasil, do IBGE, sem depender de arquivo local ────
async function cidades() {
  const url = UF
    ? `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${UF}/municipios`
    : 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';
  const r = await fetch(url);
  if (!r.ok) throw new Error('IBGE respondeu ' + r.status);
  const todos = await r.json();
  return todos.map(m => ({
    nome: m.nome,
    uf: m.microrregiao?.mesorregiao?.UF?.sigla || m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || UF || null,
  })).filter(c => c.uf);
}

async function main() {
  console.log(`\nDESCOBERTA NO INSTAGRAM${DRY ? '  ·  ENSAIO (não grava)' : ''}${UF ? '  ·  ' + UF : ''}\n`);

  const todas = await cidades();
  // Sem população na API de municípios, a ordem do IBGE é por código — não por
  // tamanho. Embaralhar seria pior: melhor deixar o operador escolher a UF e
  // rodar em rodadas, do que fingir que sabe quais são as maiores.
  const alvo = todas.slice(0, NCID);
  log(`${todas.length} municípios${UF ? ' em ' + UF : ''} · vou varrer ${alvo.length} nesta rodada`);

  let aba;
  try { aba = await Aba.abrir(); }
  catch (e) {
    console.error('NÃO CONSEGUI FALAR COM O CHROME:', e.message);
    console.error('Suba o Chrome com --remote-debugging-port=9222 e logue no Instagram.');
    process.exit(1);
  }
  if (!await aba.js(`!document.querySelector('input[name="username"]')`)) {
    console.error('Esse Chrome não está logado no Instagram.'); await aba.fechar(); return;
  }

  // Lista de destino (uma só, reaproveitada entre rodadas)
  let listaId = null;
  if (!DRY) {
    const j = await (await fetch(`${SUPA}/prospeccao_listas?select=id&nome=eq.${encodeURIComponent(LISTA)}`, { headers: H })).json();
    listaId = j[0]?.id;
    if (!listaId) {
      const r = await fetch(`${SUPA}/prospeccao_listas`, {
        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify({ nome: LISTA, origem: 'Busca do Instagram (navegador logado)', status: 'ativa', custo: 0, produto_id: 'solardoc' }),
      });
      listaId = (await r.json())[0].id;
    }
  }

  const vistos = new Set();
  let achados = 0, gravados = 0, dup = 0, recusados = 0, erros = 0;

  for (const c of alvo) {
    for (const t of TERMOS) {
      const r = await buscar(aba, `${t} ${c.nome}`);
      if (r?.erro) {
        erros++;
        log(`  ! ${t} ${c.nome}: ${r.erro}`);
        if (erros >= 5) { log('5 erros seguidos — o Instagram está reclamando. Parando.'); await aba.fechar(); return resumo(); }
        await dorme(20000);
        continue;
      }
      erros = 0;

      for (const u of r.users || []) {
        const k = u.username.toLowerCase();
        if (vistos.has(k)) continue;
        vistos.add(k);
        const v = avaliar(u);
        if (!v.ok) { recusados++; continue; }
        achados++;
        console.log(`  @${u.username.padEnd(28)} ${(u.full_name || '').slice(0, 34).padEnd(34)} ${c.nome}/${c.uf}`);
        if (DRY) continue;

        const res = await fetch(`${SUPA}/prospeccao_contatos?on_conflict=lower(instagram)`, {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify([{
            lista_id: listaId,
            empresa: (u.full_name || u.username).slice(0, 120),
            cidade: c.nome, uf: c.uf,
            instagram: u.username, instagram_em: new Date().toISOString(),
            classe: 'integradora',
            classe_motivo: `descoberta na busca do Instagram por "${t} ${c.nome}"`,
          }]),
        });
        if (res.ok) { ((await res.json()).length ? gravados++ : dup++); } else { dup++; }
      }
      await dorme(MIN_MS + Math.floor((MAX_MS - MIN_MS) * ((Date.now() % 1009) / 1009)));
    }
  }

  await aba.fechar();
  return resumo();

  function resumo() {
    console.log(`\n─────────────────────────────────────────`);
    console.log(`  perfis que passaram no filtro  ${String(achados).padStart(5)}`);
    console.log(`  gravados novos                 ${String(gravados).padStart(5)}`);
    console.log(`  já estavam na base             ${String(dup).padStart(5)}`);
    console.log(`  recusados pelo filtro          ${String(recusados).padStart(5)}`);
    console.log(`─────────────────────────────────────────`);
    console.log(`\nRode de novo com --cidades maior, ou --uf=XX pra varrer outro estado.\n`);
  }
}

main().catch(e => { console.error('quebrou:', e.message); process.exit(1); });
