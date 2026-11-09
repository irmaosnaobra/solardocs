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

import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBloqueio, parseHistorico, freioPendente, planoDeTeste, escolherAlvoTeste, registrarTeste, avaliarDestrave, registrarVolta, avisoDoEstado, diaDeIso } from './ritmo.mjs';

// Regras da VOLTA AUTOMÁTICA (chefe-antiban, 09/11/2026), todas em ritmo.mjs e testadas em teste-ritmo.mjs:
//   1ª volta da semana = 1 teste limpo + 24 h desde o freio; 2ª = 2 testes limpos SEGUIDOS + 48 h; 3ª = só o dono.
//   Os testes são em @ DIFERENTES (não repete o @ dos últimos testes) e cada um fica no histórico com o @ e a hora.
const ARQ_BLOQUEIO = fileURLToPath(new URL('./bloqueio-instagram.json', import.meta.url));
const ARQ_HISTORICO = fileURLToPath(new URL('./historico-bloqueio-instagram.json', import.meta.url));
const lerHistoricoArq = () => { try { return parseHistorico(readFileSync(ARQ_HISTORICO, 'utf8')); } catch { return null; } };
const gravarHistoricoArq = h => writeFileSync(ARQ_HISTORICO, JSON.stringify(h, null, 2));

const CFG = {
  cdp: process.env.CHROME_CDP || 'http://127.0.0.1:9222',
  supa: 'https://ancecdfqfwlaujknizof.supabase.co/rest/v1',
  key: process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6',
  consultor: process.env.CONSULTOR || 'irmaosnaobra__',
  tetoAoVoltar: 5,   // sempre 5: o teto_manual nunca fica nulo nem acima disso ao destravar
};
const H = { apikey: CFG.key, Authorization: `Bearer ${CFG.key}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log(`[${new Date().toLocaleString('pt-BR')}]`, ...a);
const dorme = ms => new Promise(r => setTimeout(r, ms));

const ler = async q => {
  const r = await fetch(`${CFG.supa}/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q.split('?')[0]}: ${r.status}`);
  return r.json();
};

/** Aba nova SEM tirar o Chrome do minimizado. O /json/new joga a janela na
 *  frente de quem esta usando o computador; o createTarget com background nao. */
async function abaEmSegundoPlano() {
  const v = await (await fetch(`${CFG.cdp}/json/version`)).json();
  const br = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, erro) => { br.addEventListener('open', ok); br.addEventListener('error', erro); });
  const targetId = await new Promise(ok => {
    br.addEventListener('message', ev => {
      try { const m = JSON.parse(ev.data); if (m.id === 1) ok(m.result?.targetId); } catch { }
    });
    br.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', background: true } }));
    setTimeout(() => ok(null), 15000);
  });
  try { br.close(); } catch { }
  const alvo = (await (await fetch(`${CFG.cdp}/json/list`)).json()).find(t => t.id === targetId);
  if (!alvo) throw new Error('nao consegui abrir aba em segundo plano');
  return alvo;
}

/** Abre um perfil que NUNCA foi contactado e ve se o compositor abre. */
async function compositorAbre(handle) {
  const alvo = await abaEmSegundoPlano();
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
  // SEM bloqueio, nada a testar: antes isto rodava as 07h e as 18h mesmo livre e devolvia o teto a 5 duas vezes por dia.
  let h = lerHistoricoArq();
  if (!existsSync(ARQ_BLOQUEIO) && !freioPendente(h)) { log('sem bloqueio-instagram.json e sem freio pendente: nada a testar.'); return; }
  if (!h) {   // arquivo de bloqueio sem histórico (robô parado): reconstrói a base a partir do bloqueio
    const b = parseBloqueio(readFileSync(ARQ_BLOQUEIO, 'utf8'));
    const desde = b.desde || new Date().toISOString();
    h = { ...parseHistorico('{}'), ultimo: desde, dia: diaDeIso(desde), rebaixado: false };
  }
  // Ainda não é hora (24 h / 48 h desde o freio), PARADO até o dono liberar, ou 2 voltas em 7 dias: não visita perfil à toa.
  const plano = planoDeTeste({ historico: h, agoraMs: Date.now() });
  if (!plano.testar) { log('sem teste agora: ' + plano.motivo); return; }

  // Um alvo que a agente ainda NAO tocou E que NAO foi um dos ultimos testes: testar em quem ja recebeu mensagem
  // daria falso positivo (la a conversa existe e o compositor abre sempre), e repetir o @ nao prova nada novo.
  const fila = await ler('prospeccao_fila_worker?select=instagram&instagram=not.is.null&instagram=neq.&limit=30');
  const alvo = escolherAlvoTeste(fila, h);
  if (!alvo) { log('nao ha perfil novo (diferente dos ultimos testes) na fila pra testar.'); return; }

  log(`testando o compositor em @${alvo} (perfil nunca contactado, diferente dos ultimos testes)`);
  const r = await compositorAbre(alvo);

  if (r.erro) { log('nao deu pra testar: ' + r.erro); return; }

  // Cada teste (limpo ou nao) fica no historico com o @ e a hora: "2 limpos seguidos" depende disso.
  h = registrarTeste(h, { arroba: alvo, limpo: !!r.abriu, agoraIso: new Date().toISOString() });
  try { gravarHistoricoArq(h); } catch (e) { log('nao consegui gravar o teste no historico: ' + e.message + ' (sem registro nao destravo)'); return; }

  if (!r.abriu) {
    log('AINDA BLOQUEADO. A caixa nao abriu. Sigo esperando, sem bater.');
    return;
  }
  const av = avaliarDestrave({ historico: h, agoraMs: Date.now() });
  if (!av.destravar) { log('teste limpo registrado, mas ainda nao destravo: ' + av.motivo); return; }

  // ── destravou ──────────────────────────────────────────────────────────────
  log('DESTRAVOU! A caixa de mensagem voltou a abrir em perfil novo (' + av.motivo + ').');
  // SEMPRE volta o teto_manual a 5, qualquer que fosse o valor. Ele NUNCA pode ficar nulo: nulo cai na rampa
  // da VIEW (25 a 100), que e o ritmo que ja derrubou a conta. A partir de 5, a rampa do worker sobe +1 por dia cheio, ate 10.
  const rampa = await ler(`prospeccao_rampa?select=teto_manual&consultor=eq.${encodeURIComponent(CFG.consultor)}`);
  const antes = rampa[0]?.teto_manual ?? null;
  const rr = await fetch(`${CFG.supa}/prospeccao_rampa?consultor=eq.${encodeURIComponent(CFG.consultor)}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({
      teto_manual: CFG.tetoAoVoltar,
      obs: `Destravou em ${new Date().toLocaleDateString('pt-BR')}. Voltando em ${CFG.tetoAoVoltar}/dia (era ${antes}), `
         + 'nao em 40: foram 33 DMs frias em 2 dias que trouxeram o bloqueio de 11/09. '
         + 'A rampa do worker sobe +1 por dia cheio, ate 10.',
      atualizado_em: new Date().toISOString(),
    }),
  });
  if (!rr.ok) {
    // O PATCH vem ANTES: sem ele gravado, o arquivo de bloqueio FICA, e o worker segue bloqueado (e em no maximo 5).
    log(`NAO consegui devolver o teto: HTTP ${rr.status}. MANTIVE bloqueio-instagram.json: o worker continua bloqueado.`);
    return;
  }
  log(`teto devolvido: ${CFG.tetoAoVoltar} por dia (era ${antes})`);
  // So agora, com o PATCH gravado (rr.ok), o arquivo de bloqueio sai. O historico NAO se apaga: ele guarda o dia do bloqueio
  // (que nunca conta como dia cheio) e a prova do rebaixe.
  // A volta e REGISTRADA no historico (voltas[] e a PROVA dos 3 primeiros envios) ANTES de apagar o bloqueio: e o que
  // autoriza o worker vivo a baixar a flag (podeVoltar) e o que conta "no maximo 2 voltas em 7 dias".
  const agoraIso = new Date().toISOString();
  const hVolta = registrarVolta({ ...h, rebaixado: true, rebaixadoEm: agoraIso }, agoraIso);
  try { gravarHistoricoArq(hVolta); }
  catch (e) { log('nao consegui gravar a volta no historico: ' + e.message + '. MANTIVE bloqueio-instagram.json.'); return; }
  try {
    rmSync(ARQ_BLOQUEIO, { force: true });
    log('bloqueio-instagram.json apagado: o worker vivo volta sozinho no comeco da proxima volta do laco (teto 5, 3 envios de prova).');
  } catch (e) { log('nao consegui apagar bloqueio-instagram.json: ' + e.message); }

  // O cron de 15 em 15 min le isto e avisa no WhatsApp dele.
  await fetch(`${CFG.supa}/prospeccao_pulso?id=eq.1`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ fazendo: avisoDoEstado({ bloqueado: false, historico: hVolta, agoraMs: Date.now() }) || 'VOLTOU SOZINHO: o Instagram deixou abrir conversa nova de novo.' }),
  }).catch(() => { });
  log('marquei o pulso; o aviso sai no WhatsApp dele em ate 15 min.');
}

main().catch(e => { console.error('quebrou:', e.message); process.exit(1); });
