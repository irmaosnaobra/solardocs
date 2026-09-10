#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   BUSCA DE @ PELO INSTAGRAM — usa a busca do próprio Instagram, logado.

   A colheita pelo site (colher-instagram.mjs) achou 112 @ e parou: 155 empresas
   não têm site e 141 têm site que não linka Instagram. Este aqui pega o resto —
   procura a empresa pelo nome dentro do Instagram, igual você faria na lupa.

   Precisa do Chrome logado no Instagram (mesmo perfil do worker):

     & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
       --remote-debugging-port=9222 `
       --user-data-dir="$env:USERPROFILE\.chrome-prospeccao"

     node buscar-instagram.mjs --dry     # mostra o que casaria, não grava
     node buscar-instagram.mjs           # grava os @ encontrados

   RITMO: busca é muito mais leve que DM, mas não é de graça. 4 a 9 segundos
   entre consultas e teto de 150 por rodada. Buscar 1.000 nomes de uma vez numa
   conta nova é o jeito mais rápido de ela ser marcada antes de mandar a
   primeira mensagem.
   ───────────────────────────────────────────────────────────────────────────── */

const SUPA = 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1';
const KEY  = process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';
const CDP  = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const H    = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const DRY  = process.argv.includes('--dry');
const TETO = Number(process.env.TETO_BUSCA || 150);
const MIN_MS = Number(process.env.MIN_MS || 4000);
const MAX_MS = Number(process.env.MAX_MS || 9000);

const dorme = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a);

// ── CDP mínimo (mesmo do worker; duplicado de propósito pra este script rodar
//    sozinho sem virar dependência de arquivo) ────────────────────────────────
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
    const alvo = alvos.find(t => t.id === targetId);
    const aba = await Aba.conectar(alvo.webSocketDebuggerUrl);
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

// ── casamento de nome ────────────────────────────────────────────────────────
// Palavras que quase toda empresa solar tem no nome. Se o casamento depender só
// delas, "Solar Brasil" casaria com "Solar Piracanjuba" — e a DM iria pro perfil
// errado, que é pior que não mandar.
const GENERICAS = new Set([
  'solar', 'energia', 'energias', 'solares', 'fotovoltaica', 'fotovoltaico', 'renovavel',
  'renovaveis', 'engenharia', 'ltda', 'me', 'eireli', 'comercio', 'servicos', 'e', 'de',
  'do', 'da', 'em', 'the', 'sistemas', 'solucoes', 'tecnologia', 'eletrica', 'brasil',
]);

const normalizar = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const distintivas = nome => normalizar(nome).split(' ')
  .filter(t => t.length >= 3 && !GENERICAS.has(t));

/** Casa se compartilharem ao menos uma palavra DISTINTIVA. Sem palavra
 *  distintiva no nome da empresa, desiste — não há como ter certeza. */
function casa(empresa, perfil) {
  const alvo = distintivas(empresa);
  if (!alvo.length) return { ok: false, motivo: 'nome só tem palavra genérica' };
  const texto = normalizar(perfil.username + ' ' + (perfil.full_name || ''));
  const compacto = texto.replace(/ /g, '');
  const achou = alvo.filter(t => texto.includes(t) || compacto.includes(t));
  return achou.length
    ? { ok: true, forca: achou.length / alvo.length, palavras: achou }
    : { ok: false, motivo: 'nenhuma palavra distintiva bateu' };
}

// ── busca dentro da página (carrega os cookies da sessão sozinha) ────────────
async function buscar(aba, termo) {
  const js = `(async () => {
    try {
      const r = await fetch('/web/search/topsearch/?context=blended&query='
        + encodeURIComponent(${JSON.stringify(termo)}), { headers: { 'X-IG-App-ID': '936619743392459' } });
      if (!r.ok) return { erro: 'HTTP ' + r.status };
      const j = await r.json();
      return { users: (j.users || []).slice(0, 8).map(u => ({
        username: u.user?.username, full_name: u.user?.full_name,
        verificado: !!u.user?.is_verified, privado: !!u.user?.is_private,
      })).filter(u => u.username) };
    } catch (e) { return { erro: String(e && e.message || e) }; }
  })()`;
  return await aba.js(js);
}

async function main() {
  console.log(`\nBUSCA DE @ NO INSTAGRAM${DRY ? '  ·  ENSAIO (não grava)' : ''}\n`);

  const q = `${SUPA}/prospeccao_contatos`
    + `?select=id,empresa,cidade,uf&classe=in.(integradora,misto)`
    + `&or=(instagram.is.null,instagram.eq.)&limit=${TETO}`;
  const alvos = await (await fetch(q, { headers: H })).json();
  if (!Array.isArray(alvos)) { console.error('falha ao ler a base:', alvos); process.exit(1); }
  if (!alvos.length) { console.log('Nenhuma empresa sem @ pendente.'); return; }

  let aba;
  try { aba = await Aba.abrir(); }
  catch (e) {
    console.error('NÃO CONSEGUI FALAR COM O CHROME:', e.message);
    console.error('Suba o Chrome com --remote-debugging-port=9222 e logue no Instagram.');
    process.exit(1);
  }

  const logado = await aba.js(`!document.querySelector('input[name="username"]')`);
  if (!logado) { console.error('Esse Chrome não está logado no Instagram. Logue e rode de novo.'); await aba.fechar(); return; }
  log(`sessão do Instagram OK · ${alvos.length} empresas pra procurar`);

  let achou = 0, semCerteza = 0, semNada = 0, erros = 0;
  for (let i = 0; i < alvos.length; i++) {
    const c = alvos[i];
    const termo = [c.empresa, c.cidade].filter(Boolean).join(' ');
    const r = await buscar(aba, termo);

    if (r?.erro) {
      erros++;
      log(`  ! ${c.empresa}: ${r.erro}`);
      // Instagram reclamando é sinal de parar, não de insistir.
      if (erros >= 5) { log('5 erros seguidos — o Instagram está reclamando. Parando.'); break; }
      await dorme(15000);
      continue;
    }
    erros = 0;

    const users = r?.users || [];
    const cand = users.map(u => ({ u, m: casa(c.empresa, u) }))
      .filter(x => x.m.ok)
      .sort((a, b) => b.m.forca - a.m.forca);

    const n = String(i + 1).padStart(4);
    if (!cand.length) {
      (users.length ? semCerteza++ : semNada++);
      console.log(`${n}/${alvos.length}  ${c.empresa.slice(0, 40).padEnd(40)} ${users.length ? '(nenhum casou)' : '(nada encontrado)'}`);
    } else {
      const { u, m } = cand[0];
      achou++;
      console.log(`${n}/${alvos.length}  ${c.empresa.slice(0, 40).padEnd(40)} @${u.username}  [${m.palavras.join('+')}]${u.privado ? ' privado' : ''}`);
      if (!DRY) {
        await fetch(`${SUPA}/prospeccao_contatos?id=eq.${c.id}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ instagram: u.username, instagram_em: new Date().toISOString() }),
        }).catch(() => {});
      }
    }
    await dorme(MIN_MS + Math.floor((MAX_MS - MIN_MS) * ((Date.now() % 1009) / 1009)));
  }

  await aba.fechar();
  console.log(`\n─────────────────────────────────────────`);
  console.log(`  @ encontrados     ${String(achou).padStart(4)}`);
  console.log(`  achou mas não deu certeza  ${String(semCerteza).padStart(4)}`);
  console.log(`  nada encontrado   ${String(semNada).padStart(4)}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`\nRode de novo pra continuar de onde parou (teto de ${TETO} por rodada).\n`);
}

main().catch(e => { console.error('quebrou:', e.message); process.exit(1); });
