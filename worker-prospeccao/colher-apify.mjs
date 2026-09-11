/* ─────────────────────────────────────────────────────────────────────────────
   COLHER TODAS AS EMPRESAS DE SOLAR DO BRASIL, com o @ junto.

   POR QUE ISTO EXISTE
   A agente fala com 40 empresas por dia. A fila alcançável (com @) tinha 113:
   menos de 3 dias de trabalho. Procurar o @ pela lupa do Instagram não escala —
   ela devolve no máximo 5 perfis por consulta, polui com celebridade quando a
   cidade tem nome famoso, e em 11/09 já respondeu 429 pra gente. O caminho é
   trazer a lista de FORA, com o @ junto, e não gastar a conta procurando.

   O PULO DO GATO É O COMPLEMENTO DE CONTATO
   O ator do Google Maps cobra US$ 0,003 por empresa. Por mais US$ 0,002
   (`scrapeContacts`) ele ABRE O SITE da empresa e extrai as redes sociais. Ou
   seja: por meio centavo de dólar ele faz, com a infra dele, o mesmo trabalho
   que o nosso extrator de rodapé fazia com 32% de aproveitamento — e sem tocar
   no Instagram, então sem risco nenhum pra conta.

   COMO USAR
     APIFY_TOKEN=apify_api_xxx node colher-apify.mjs --plano
     APIFY_TOKEN=apify_api_xxx node colher-apify.mjs --cidades=40
     APIFY_TOKEN=apify_api_xxx node colher-apify.mjs --cidades=40 --valendo

   Sem --valendo ele só ENSAIA: mostra o que buscaria e quanto custaria.
   O token sai em apify.com → Settings → Integrations → Personal API token.
   ───────────────────────────────────────────────────────────────────────────── */

const ARG = process.argv.slice(2);
const arg = (n, padrao) => {
  const a = ARG.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : padrao;
};
const VALENDO = ARG.includes('--valendo');
const SO_PLANO = ARG.includes('--plano');

const CFG = {
  token: process.env.APIFY_TOKEN || '',
  ator: 'compass~crawler-google-places',
  supa: 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1',
  key: process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6',
  // Quantas cidades por rodada. Cidade grande rende mais, e a lista vem
  // ordenada por população, então as primeiras rodadas são as mais valiosas.
  cidades: Number(arg('cidades', 25)),
  // Piso de população. Abaixo de 100 mil a densidade de integradora cai muito e
  // o custo por empresa encontrada sobe.
  popMin: Number(arg('pop', 100000)),
  porBusca: Number(arg('por-busca', 60)),
  // Teto de gasto por rodada, em dólar. Cinto de segurança: erro de laço aqui
  // custa dinheiro de verdade, não só tempo.
  tetoUsd: Number(arg('teto', 5)),
};

const TERMOS = ['energia solar', 'energia fotovoltaica'];
const H = { apikey: CFG.key, Authorization: `Bearer ${CFG.key}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a);
const dorme = ms => new Promise(r => setTimeout(r, ms));

// ── preço, do jeito que o Apify cobra hoje (tier BRONZE) ────────────────────
const PRECO = { lugar: 0.003, contato: 0.002, filtro: 0.001 };
const custoDe = n => n * (PRECO.lugar + PRECO.contato + PRECO.filtro);

// ── os municípios, do maior pro menor ───────────────────────────────────────
async function municipios() {
  const r = await fetch('https://servicodados.ibge.gov.br/api/v3/agregados/6579'
    + '/periodos/2021/variaveis/9324?localidades=N6[all]');
  if (!r.ok) throw new Error('IBGE respondeu ' + r.status);
  return (await r.json())[0].resultados[0].series
    .map(x => {
      const [nome, uf] = String(x.localidade.nome).split(' - ');
      return { nome, uf, pop: Number(Object.values(x.serie)[0]) || 0 };
    })
    .filter(c => c.nome && c.uf && c.pop >= CFG.popMin)
    .sort((a, b) => b.pop - a.pop);
}

const ler = async q => {
  const r = await fetch(`${CFG.supa}/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q.split('?')[0]}: ${r.status}`);
  return r.json();
};

// ── o que já foi colhido, pra não pagar duas vezes ──────────────────────────
async function jaColhidas() {
  const feitas = await ler('prospeccao_varredura?select=cidade,uf,termo&limit=50000');
  return new Set(feitas
    .filter(v => String(v.termo || '').startsWith('apify:'))
    .map(v => `${v.cidade}|${v.uf}`.toLowerCase()));
}

// ── o Instagram vem de onde o Apify conseguir achar ─────────────────────────
// Ele devolve as redes em campos diferentes conforme de onde extraiu. Aceitar
// só um deles jogaria fora metade do que a gente pagou pra descobrir.
function arrobaDe(p) {
  const candidatos = [
    ...(Array.isArray(p.instagrams) ? p.instagrams : []),
    p.instagram,
    ...(Array.isArray(p.socialMedia?.instagram) ? p.socialMedia.instagram : []),
    p.socialMedia?.instagram,
  ].filter(x => typeof x === 'string');
  for (const c of candidatos) {
    const m = c.match(/instagram\.com\/([A-Za-z0-9._]{3,30})/i) || c.match(/^@?([A-Za-z0-9._]{3,30})$/);
    if (!m) continue;
    const u = m[1].toLowerCase();
    if (['p', 'reel', 'reels', 'explore', 'stories', 'accounts'].includes(u)) continue;
    return u;
  }
  return null;
}

// Perfil que claramente não é integradora. Mesmo filtro do worker, porque o
// Maps mistura curso, distribuidora e loja de material na mesma busca.
const NAO_SERVE = new RegExp(['curso', 'treinamento', 'aula', 'faculdade', 'distribuidora',
  'atacado', 'importadora', 'fabricante', 'industria', 'consorcio', 'financiamento',
  'seguro', 'imobiliaria', 'aquecedor', 'piscina', 'universidade'].join('|'), 'i');

async function rodarBusca(cidade, termo) {
  const corpo = {
    searchStringsArray: [termo],
    locationQuery: `${cidade.nome}, ${cidade.uf}, Brazil`,
    maxCrawledPlacesPerSearch: CFG.porBusca,
    language: 'pt-BR',
    skipClosedPlaces: true,     // 1 filtro
    scrapeContacts: true,       // é isto que traz o Instagram
  };
  const r = await fetch(`https://api.apify.com/v2/acts/${CFG.ator}/run-sync-get-dataset-items`
    + `?token=${encodeURIComponent(CFG.token)}&maxTotalChargeUsd=${CFG.tetoUsd}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const txt = await r.text();
  if (!r.ok) {
    // "Too many outstanding invoices" é fatura em aberto, não erro de código.
    if (/outstanding invoice/i.test(txt)) throw new Error('FATURA EM ABERTO no Apify. Quite em apify.com → Billing e rode de novo.');
    throw new Error(`Apify ${r.status}: ${txt.slice(0, 200)}`);
  }
  try { return JSON.parse(txt); } catch { return []; }
}

async function gravar(lugares, cidade, listaId, conhecidos) {
  let novos = 0, comArroba = 0;
  for (const p of lugares) {
    const nome = String(p.title || '').trim();
    if (!nome || NAO_SERVE.test(nome)) continue;
    const arroba = arrobaDe(p);
    if (arroba) comArroba++;
    if (arroba && conhecidos.has(arroba)) continue;

    const ficha = {
      lista_id: listaId,
      empresa: nome.slice(0, 120),
      cidade: p.city || cidade.nome,
      uf: p.state || cidade.uf,
      telefone: (p.phoneUnformatted || '').replace(/\D/g, '') || null,
      site: p.website || null,
      nota: p.totalScore ?? null,
      avaliacoes: p.reviewsCount ?? null,
      classe: 'integradora',
      classe_motivo: `Google Maps via Apify · ${cidade.nome}/${cidade.uf}`,
      ...(arroba ? { instagram: arroba, instagram_em: new Date().toISOString() } : {}),
    };
    const res = await fetch(`${CFG.supa}/prospeccao_contatos`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([ficha]),
    }).catch(() => null);
    if (res?.ok) { novos++; if (arroba) conhecidos.add(arroba); }
  }
  return { novos, comArroba };
}

async function main() {
  const cidades = await municipios();
  const feitas = await jaColhidas();
  const pendentes = cidades.filter(c => !feitas.has(`${c.nome}|${c.uf}`.toLowerCase()));

  console.log('');
  console.log('  PLANO PARA COBRIR O BRASIL');
  console.log(`  cidades com ${CFG.popMin.toLocaleString('pt-BR')}+ habitantes : ${cidades.length}`);
  console.log(`  já colhidas                        : ${cidades.length - pendentes.length}`);
  console.log(`  faltam                             : ${pendentes.length}`);
  console.log(`  buscas por cidade                  : ${TERMOS.length} (${TERMOS.join(', ')})`);
  console.log(`  teto por busca                     : ${CFG.porBusca} empresas`);
  const pior = pendentes.length * TERMOS.length * CFG.porBusca;
  console.log(`  empresas no pior caso              : ${pior.toLocaleString('pt-BR')}`);
  console.log(`  custo no pior caso                 : US$ ${custoDe(pior).toFixed(2)}`);
  console.log(`  (US$ ${(PRECO.lugar + PRECO.contato + PRECO.filtro).toFixed(3)} por empresa, com o site aberto e o Instagram extraído)`);
  console.log('');
  if (SO_PLANO) return;

  if (!CFG.token) { console.log('  Falta APIFY_TOKEN. Pegue em apify.com → Settings → Integrations.\n'); return; }

  const listas = await ler('prospeccao_listas?select=id&status=eq.ativa&produto_id=eq.solardoc&limit=1');
  const listaId = listas[0]?.id;
  if (!listaId) { console.log('  Nenhuma lista ativa pra receber os contatos.\n'); return; }

  const conhecidos = new Set((await ler('prospeccao_contatos?select=instagram&instagram=not.is.null&limit=50000'))
    .map(c => String(c.instagram || '').toLowerCase()).filter(Boolean));
  log(`${conhecidos.size} @ já na base, não vou duplicar`);

  const alvo = pendentes.slice(0, CFG.cidades);
  if (!VALENDO) {
    console.log('  ENSAIO. Buscaria, nesta ordem:');
    alvo.forEach((c, i) => console.log(`   ${String(i + 1).padStart(3)}. ${c.nome}/${c.uf} (${c.pop.toLocaleString('pt-BR')} hab)`));
    console.log('\n  Para valer: acrescente --valendo\n');
    return;
  }

  let totalNovos = 0, totalArroba = 0, totalLugares = 0;
  for (const c of alvo) {
    let daCidade = [];
    for (const termo of TERMOS) {
      try {
        const r = await rodarBusca(c, termo);
        daCidade = daCidade.concat(r || []);
        log(`  ${c.nome}/${c.uf} · "${termo}": ${(r || []).length} lugares`);
      } catch (e) {
        log(`  ${c.nome}/${c.uf} · "${termo}" falhou: ${e.message}`);
        if (/FATURA/.test(e.message)) return;   // não adianta insistir
      }
      await dorme(1500);
    }
    // Dedupe por placeId ANTES de gravar: os dois termos se sobrepõem muito.
    const vistos = new Set();
    const unicos = daCidade.filter(p => p.placeId && !vistos.has(p.placeId) && vistos.add(p.placeId));
    const { novos, comArroba } = await gravar(unicos, c, listaId, conhecidos);
    totalLugares += unicos.length; totalNovos += novos; totalArroba += comArroba;
    log(`  ${c.nome}/${c.uf}: ${unicos.length} únicos · ${novos} novos na base · ${comArroba} com @`);

    await fetch(`${CFG.supa}/prospeccao_varredura`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ cidade: c.nome, uf: c.uf, termo: 'apify:maps', encontrados: unicos.length, novos }),
    }).catch(() => {});
  }

  console.log('');
  console.log(`  ${alvo.length} cidades · ${totalLugares} empresas vistas · ${totalNovos} novas na base`);
  console.log(`  ${totalArroba} vieram com o @ do Instagram (${totalLugares ? Math.round(100 * totalArroba / totalLugares) : 0}%)`);
  console.log(`  custo estimado: US$ ${custoDe(totalLugares).toFixed(2)}`);
  console.log('');
}

main().catch(e => { console.error('\nquebrou:', e.message); process.exit(1); });
