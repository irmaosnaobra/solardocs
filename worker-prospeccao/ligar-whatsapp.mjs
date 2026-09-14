/* ─────────────────────────────────────────────────────────────────────────────
   LIGAR O WHATSAPP DA PROSPECÇÃO. Roda UMA vez, quando o chip novo chega.
   Quem chama é o LIGAR-WHATSAPP.cmd (dois cliques).

   1. abre o WhatsApp Web no Chrome da agente e traz a aba pra frente
   2. espera alguém ler o QR com o celular do chip (até 10 minutos)
   3. RECUSA a linha IO e o celular do dono
   4. fecha a aba e deixa a marca whatsapp-ligado.flag. A aba fecha porque o
      WhatsApp Web não aceita duas abas da mesma sessão, e a agente abre a dela.
      A marca é o que faz o VIGIA.ps1 manter a agente do WhatsApp de pé.

   POR QUE RECUSA: a linha IO leva a agenda inteira (bom dia, lembrete de 1h e
   de 5 min das reuniões). Em 30/08 ela caiu por volume e 11 reuniões de 31/08
   passaram sem ninguém ser avisado. Prospecção fria é o jeito mais rápido de
   derrubar um número, então ela nunca sai de um número que faz outra coisa.
   Os números estão como hash porque este repositório é público.
   ───────────────────────────────────────────────────────────────────────────── */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CDP   = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const SUPA  = 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1';
const KEY   = process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';
const MARCA = fileURLToPath(new URL('./whatsapp-ligado.flag', import.meta.url));
// Enquanto existem, o vigia não esconde o Chrome: o QR precisa ficar na tela.
// Somem ao fechar a aba (e vencem sozinhas, 15 e 30 min).
const MARCA_QR = fileURLToPath(new URL('./qr-aberto.flag', import.meta.url));
const MARCA_VISIVEL = fileURLToPath(new URL('./chrome-visivel.flag', import.meta.url));
const ABRIR = fileURLToPath(new URL('./abrir-chrome-agente.ps1', import.meta.url));
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// sha256 do número sem o 55 (DDD + número).
const PROIBIDOS = {
  '3c29bb19ab77fc2db6010f0633e373da538038352ec330dcc65a38b0cecd03bb': 'a linha IO, que leva a agenda e os lembretes das reuniões',
  'c5553c7963affdec11f8e9d9fbc2059dfb554d84817068d1358914d788a7dd8e': 'o celular do dono, que recebe os alarmes',
};

const dorme = ms => new Promise(r => setTimeout(r, ms));
const diga = (...a) => console.log('  ' + a.join(' '));

async function main() {
  // O Chrome da agente mora numa área de trabalho escondida, onde ninguém vê o
  // QR. Pra ler, ele reabre NA TELA. Quando a aba fecha, as marcas somem e o
  // vigia devolve o Chrome pro escondido.
  writeFileSync(MARCA_QR, new Date().toISOString());
  diga('Trazendo o Chrome da agente pra tela...');
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ABRIR, '-Mostrar'], { stdio: 'ignore' });
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    try { await (await fetch(CDP + '/json/version')).json(); pronto = true; }
    catch { await dorme(1000); }
  }
  if (!pronto) {
    rmSync(MARCA_QR, { force: true });
    diga('O Chrome da agente não abriu. Rode de novo em 2 minutos.');
    process.exit(1);
  }
  const alvo = await (await fetch(CDP + '/json/new?https://web.whatsapp.com/', { method: 'PUT' })).json();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => {
    try { const m = JSON.parse(ev.data); const f = pend.get(m.id); if (f) { pend.delete(m.id); f(m); } } catch { }
  });
  const cmd = (method, params = {}) => new Promise(ok => {
    const i = ++id; pend.set(i, ok);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.delete(i)) ok({}); }, 20000);
  });
  const js = async e => (await cmd('Runtime.evaluate',
    { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const fechar = async () => {
    rmSync(MARCA_QR, { force: true });
    rmSync(MARCA_VISIVEL, { force: true });
    try { await fetch(`${CDP}/json/close/${alvo.id}`); } catch { }
    try { ws.close(); } catch { }
  };

  await new Promise(r => ws.addEventListener('open', r));
  await cmd('Runtime.enable');
  await cmd('Page.bringToFront');

  const LER = `(() => {
    let wid = null;
    try { wid = localStorage.getItem('last-wid-md') || localStorage.getItem('last-wid'); } catch (e) { }
    const usarAqui = [...document.querySelectorAll('button, div[role="button"]')]
      .find(b => /^(usar aqui|use here)$/i.test((b.innerText || '').trim()));
    if (usarAqui) usarAqui.click();
    return {
      logado: !!document.querySelector('#pane-side, [aria-label="Chat list"], [aria-label="Lista de conversas"]'),
      wid,
    };
  })()`;

  diga('Abri o WhatsApp Web no Chrome da agente.');
  diga('');
  diga('No celular do CHIP DA PROSPECÇÃO:');
  diga('  WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho');
  diga('  e aponte a câmera pro QR que está no Chrome.');
  diga('');
  diga('Espero até 10 minutos...');

  let r = null;
  const fim = Date.now() + 10 * 60000;
  while (Date.now() < fim) {
    r = await js(LER).catch(() => null);
    if (r?.logado) break;
    await dorme(3000);
  }
  if (!r?.logado) {
    diga('Ninguém leu o QR em 10 minutos. Rode de novo com o celular na mão.');
    await fechar(); process.exit(1);
  }

  // O número aparece no armazenamento alguns segundos depois do login.
  let wid = r.wid;
  for (let i = 0; i < 15 && !wid; i++) { await dorme(2000); wid = (await js(LER).catch(() => null))?.wid; }
  const numero = (String(wid || '').match(/\d{10,15}/) || [])[0] || '';
  if (!numero) {
    diga('Logou, mas não consegui ler qual número é. NÃO liguei a agente: me chame pra conferir.');
    await fechar(); process.exit(1);
  }

  const proibido = PROIBIDOS[createHash('sha256').update(numero.replace(/^55/, '')).digest('hex')];
  if (proibido) {
    diga('');
    diga(`ESTE NÚMERO NÃO PODE PROSPECTAR: é ${proibido}.`);
    diga('No celular, em Aparelhos conectados, desconecte o Chrome que acabou de entrar,');
    diga('e rode isto de novo lendo o QR com o celular do chip da prospecção.');
    rmSync(MARCA, { force: true });
    await fechar(); process.exit(1);
  }

  writeFileSync(MARCA, `WhatsApp da prospeccao ligado em ${new Date().toISOString()}, final ${numero.slice(-4)}\n`);
  await fetch(`${SUPA}/prospeccao_pulso?id=eq.2`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({
      ativo: true, logado: true, conta: numero, batido_em: new Date().toISOString(),
      fazendo: 'WhatsApp ligado, a agente sobe em instantes', ultimo_erro: null,
    }),
  }).catch(() => { });

  await fechar();
  diga('');
  diga(`PRONTO. WhatsApp final ${numero.slice(-4)} ligado à prospecção.`);
  // O teto fica TRAVADO em 5 (prospeccao_rampa.teto_manual). A rampa automática
  // da view pularia pra 25 e 50 por dia em duas semanas, que é o ritmo que já
  // derrubou o Instagram e a linha IO. Subir é na mão, olhando as respostas.
  diga('Ele manda para 5 empresas por dia. Subir (até 10) é decisão tomada olhando as respostas.');
  process.exit(0);
}

main().catch(e => { console.error('  quebrou:', e.message); process.exit(1); });
