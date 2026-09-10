#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   COLHEITA DE @ — de graça, sem Apify, sem chave de nada.

   O Google Maps devolve site e telefone, nunca o @ do Instagram. Este script
   abre o site de cada empresa e procura o link do Instagram nele. É o único
   caminho gratuito pro handle, e não depende da fatura da Apify que está
   travada ("Too many outstanding invoices", 403 em 10/09).

   Roda direto:  node colher-instagram.mjs
   Sem argumento nenhum. Node 18+ (usa fetch nativo).

   O que grava:
     instagram = 'handle'  achou
     instagram = ''        procurou e o site não tem Instagram
     instagram = null      ainda não procuramos (estado inicial)
   A distinção entre '' e null é o que impede o script de reprocessar
   eternamente os sites que simplesmente não têm Instagram.
   ───────────────────────────────────────────────────────────────────────────── */

const SUPA = 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1';
const KEY  = process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';
const H    = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const PARALELO   = 6;      // sites simultâneos — educado com servidor pequeno de integrador
const TIMEOUT_MS = 12000;  // site de integrador é lento; 12s antes de desistir

// Handles que NÃO são a empresa: plataforma, agência que fez o site, template.
// Sem esta lista, metade da base viraria "@wix" ou "@instagram".
const LIXO = new Set([
  'instagram','explore','p','reel','reels','stories','accounts','about','developer',
  'wix','wixcom','godaddy','squarespace','shopify','elementor','wordpress','wordpressdotcom',
  'sharer','share','tv','directory','legal','privacy','help',
  // Bandeiras e fabricantes: o site do posto/integrador linka a marca, nao ele.
  // Mandar DM pra @ipiranga em vez do posto local e queimar toque a toa.
  // (o script tambem limpa handle REPETIDO entre empresas, que pega os que
  //  nao estao nesta lista — mas a lista evita o caso de 1 empresa so)
  'ipiranga','shell','petrobras','br','brpetrobras','ale','alecombustiveis',
  'raizen','vibraenergia','texaco','esso','totalenergies',
  'canadiansolar','growatt','deye','jasolar','trinasolar','risensolar','byd',
  'weg','fronius','sma','huawei','solis','sungrow','tsunbrasil','intelbras',
]);

const fmt = n => String(n).padStart(4, ' ');

/** Extrai o handle de qualquer forma de link do Instagram que apareça no HTML. */
function acharHandle(html) {
  const achados = new Map();
  const re = /(?:https?:)?\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const h = m[1].toLowerCase().replace(/\.$/, '');
    if (LIXO.has(h) || h.length < 3) continue;
    achados.set(h, (achados.get(h) || 0) + 1);
  }
  if (!achados.size) return '';
  // O handle da empresa é o que mais se repete (header + rodapé + botão social).
  // Link de agência costuma aparecer uma vez só, no rodapé.
  return [...achados.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function buscarSite(url) {
  const alvo = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(alvo, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IrmaosNaObra/1.0; +https://solardoc.app)' },
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    return (await r.text()).slice(0, 400_000);  // 400 KB basta: o link social está no head ou no rodapé
  } catch {
    return null;                                 // site fora do ar / timeout / TLS quebrado
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const q = `${SUPA}/prospeccao_contatos` +
    `?select=id,empresa,site&instagram=is.null&site=not.is.null&site=neq.&limit=2000`;
  const alvos = await (await fetch(q, { headers: H })).json();

  if (!Array.isArray(alvos)) { console.error('falha ao ler a base:', alvos); process.exit(1); }
  if (!alvos.length) {
    console.log('Nenhuma empresa com site pendente de colheita.');
    console.log('(Se a base acabou de ser importada, confira se a coluna `site` veio preenchida.)');
    return;
  }

  console.log(`Colhendo @ de ${alvos.length} sites, ${PARALELO} por vez.\n`);
  let achou = 0, vazio = 0, morto = 0, i = 0;

  async function trabalhador() {
    while (i < alvos.length) {
      const c = alvos[i++];
      const n = i;
      const html = await buscarSite(c.site);
      let handle = null;
      if (html === null) { morto++; }
      else {
        handle = acharHandle(html);
        if (handle) achou++; else vazio++;
      }
      // site fora do ar continua NULL: pode voltar amanhã e vale tentar de novo.
      // Site que respondeu e não tem Instagram vira '' — esse não se tenta mais.
      if (html !== null) {
        await fetch(`${SUPA}/prospeccao_contatos?id=eq.${c.id}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ instagram: handle, instagram_em: new Date().toISOString() }),
        }).catch(() => {});
      }
      const marca = handle ? `@${handle}` : (html === null ? '(site fora do ar)' : '(sem instagram)');
      console.log(`${fmt(n)}/${alvos.length}  ${String(c.empresa).slice(0, 42).padEnd(42)} ${marca}`);
    }
  }

  await Promise.all(Array.from({ length: PARALELO }, trabalhador));

  console.log(`\n─────────────────────────────────────────`);
  console.log(`  @ encontrados      ${fmt(achou)}`);
  console.log(`  site sem instagram ${fmt(vazio)}`);
  console.log(`  site fora do ar    ${fmt(morto)}  (ficam NULL, dá pra tentar de novo amanhã)`);
  console.log(`─────────────────────────────────────────`);
  if (achou) console.log(`\nA fila do worker (prospeccao_fila_worker) já enxerga esses ${achou}.`);
}

main().catch(e => { console.error('quebrou:', e); process.exit(1); });
