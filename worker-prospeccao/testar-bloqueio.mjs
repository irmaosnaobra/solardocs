/* ─────────────────────────────────────────────────────────────────────────────
   O INSTAGRAM JA DESTRAVOU?

   Em 11/09 a conta levou restricao de CONVERSA NOVA. O sintoma e mudo: o perfil
   abre, o botao "Message" esta la, o clique funciona, e o compositor nao abre.
   Nao ha aviso, nao ha erro, nao ha e-mail. A unica forma de saber e testar.

   Este arquivo testa UMA vez por rodada, com leitura de pagina (nao manda nada),
   e:
     · se AINDA bloqueado  -> nao faz nada, so registra
     · se DESTRAVOU        -> devolve o teto pra 5/dia e marca o pulso, e o cron
                              de 15 em 15 min avisa no WhatsApp do dono

   POR QUE VOLTA EM 5 E NAO EM 40: foram 33 DMs frias em 2 dias que trouxeram o
   bloqueio. Voltar no mesmo ritmo traz de volta, e da segunda vez costuma ser
   mais longo. A rampa automatica sobe sozinha conforme a conta aguenta.

   Roda pela tarefa do Windows as 07h e as 18h.
   ───────────────────────────────────────────────────────────────────────────── */

const CFG = {
  cdp: process.env.CHROME_CDP || 'http://127.0.0.1:9222',
  supa: 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1',
  key: process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6',
  consultor: process.env.CONSULTOR || 'irmaosnaobra__',
  tetoAoVoltar: Number(process.env.TETO_AO_VOLTAR || 5),
};
const H = { apikey: CFG.key, Authorization: `Bearer ${CFG.key}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log(`[${new Date().toLocaleString('pt-BR')}]`, ...a);
const dorme = ms => new Promise(r => setTimeout(r, ms));

const ler = async q => {
  const r = await fetch(`${CFG.supa}/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q.split('?')[0]}: ${r.status}`);
  return r.json();
};

/** Abre um perfil que NUNCA foi contactado e ve se o compositor abre. */
async function compositorAbre(handle) {
  const alvo = await (await fetch(`${CFG.cdp}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => {
    try { const m = JSON.parse(ev.data); const f = pend.get(m.id); if (f) { pend.delete(m.id); f(m); } } catch { }
  });
  const cmd = (method, params = {}) => new Promise(ok => {
    const i = ++id; pend.set(i, ok);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.delete(i)) ok({}); }, 25000);
  });
  const js = async e => (await cmd('Runtime.evaluate',
    { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

  try {
    await new Promise(r => ws.addEventListener('open', r));
    await cmd('Page.enable'); await cmd('Runtime.enable');
    await cmd('Page.navigate', { url: `https://www.instagram.com/${handle}/` });
    await dorme(8000);

    if (await js(`!!document.querySelector('input[name="username"]')`)) {
      return { erro: 'a conta esta DESLOGADA do Instagram' };
    }
    const clicou = await js(`(() => {
      const els = [...document.querySelectorAll('div[role="button"],button,a')]
        .map(e => ({ e, t: (e.innerText || '').trim() })).filter(x => x.t && x.t.length < 40);
      const alvo = els.find(x => /^(enviar mensagem|mensagem|message|send message)$/i.test(x.t))
                || els.find(x => /(mensagem|message)/i.test(x.t));
      if (!alvo) return false;
      alvo.e.click(); return true;
    })()`);
    if (!clicou) return { erro: 'nao achei o botao de mensagem (perfil sumiu ou layout mudou)' };

    await dorme(6000);
    const abriu = await js(`!!document.querySelector('div[role="textbox"],textarea[placeholder]')`);
    return { abriu: !!abriu };
  } catch (e) {
    return { erro: e.message };
  } finally {
    try { await fetch(`${CFG.cdp}/json/close/${alvo.id}`); } catch { }
    try { ws.close(); } catch { }
  }
}

async function main() {
  // Um alvo que a agente ainda NAO tocou. Testar em quem ja recebeu mensagem
  // daria falso positivo: la a conversa existe e o compositor abre sempre.
  const fila = await ler('prospeccao_fila_worker?select=instagram&instagram=not.is.null&instagram=neq.&limit=1');
  const alvo = fila[0]?.instagram;
  if (!alvo) { log('nao ha perfil novo na fila pra testar.'); return; }

  log(`testando o compositor em @${alvo} (perfil nunca contactado)`);
  const r = await compositorAbre(alvo);

  if (r.erro) { log('nao deu pra testar: ' + r.erro); return; }

  if (!r.abriu) {
    log('AINDA BLOQUEADO. A caixa nao abriu. Sigo esperando, sem bater.');
    return;
  }

  // ── destravou ──────────────────────────────────────────────────────────────
  log('DESTRAVOU! A caixa de mensagem voltou a abrir em perfil novo.');

  const rampa = await ler(`prospeccao_rampa?select=teto_manual&consultor=eq.${encodeURIComponent(CFG.consultor)}`);
  if ((rampa[0]?.teto_manual ?? null) === 0) {
    await fetch(`${CFG.supa}/prospeccao_rampa?consultor=eq.${encodeURIComponent(CFG.consultor)}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({
        teto_manual: CFG.tetoAoVoltar,
        obs: `Destravou em ${new Date().toLocaleDateString('pt-BR')}. Voltando em ${CFG.tetoAoVoltar}/dia, `
           + 'nao em 40: foram 33 DMs frias em 2 dias que trouxeram o bloqueio de 11/09. '
           + 'Suba o teto so depois de uma semana limpa, ou tire o manual e deixe a rampa automatica trabalhar.',
        atualizado_em: new Date().toISOString(),
      }),
    });
    log(`teto devolvido: ${CFG.tetoAoVoltar} por dia (era 0)`);
  } else {
    log(`teto ja estava em ${rampa[0]?.teto_manual}, nao mexi`);
  }

  // O cron de 15 em 15 min le isto e avisa no WhatsApp dele.
  await fetch(`${CFG.supa}/prospeccao_pulso?id=eq.1`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ fazendo: `DESTRAVOU em ${new Date().toLocaleString('pt-BR')}` }),
  }).catch(() => { });
  log('marquei o pulso; o aviso sai no WhatsApp dele em ate 15 min.');
}

main().catch(e => { console.error('quebrou:', e.message); process.exit(1); });
