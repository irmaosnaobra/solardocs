#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   WORKER DE PROSPECÇÃO — dirige o SEU Chrome, um contato por vez.

   ZERO DEPENDÊNCIA. Não instala nada. Fala com o Chrome pelo protocolo nativo
   (CDP) usando o WebSocket que já vem no Node 22+. Não precisa de Playwright,
   não baixa navegador, não pede npm install.

   ── COMO SUBIR ──────────────────────────────────────────────────────────────
   1) Feche o Chrome. Abra um DEDICADO à automação (perfil separado do seu):

      & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
        --remote-debugging-port=9222 `
        --user-data-dir="$env:USERPROFILE\.chrome-prospeccao"

   2) NESSA janela, faça login no WhatsApp Web (ou no Instagram). Uma vez só —
      a sessão fica salva no perfil.

   3) Rode em outro terminal:

        node worker.mjs --dry              # ensaio: mostra tudo, não envia nada
        node worker.mjs --canal=whatsapp   # envia de verdade
        node worker.mjs --canal=instagram  # idem, por DM

   COMECE PELO --dry. Ele percorre a fila inteira e imprime a mensagem exata que
   sairia pra cada empresa, sem tocar em ninguém.

   ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
   Não escolhe quem receber: lê a view `prospeccao_fila_worker`, que já aplica
   bloqueado / lista ativa / não-tocado-hoje. Não decide quantos: lê o teto da
   rampa em `prospeccao_teto_hoje`. Não ignora reclamação: para sozinho se o
   disjuntor de opt-out passar de 8% em `prospeccao_saude`.

   Essas três travas moram no banco de propósito. Mexer nelas aqui não adianta —
   o worker relê a cada envio.
   ───────────────────────────────────────────────────────────────────────────── */

// ═══ CONFIGURAÇÃO ════════════════════════════════════════════════════════════
const CFG = {
  cdp:        process.env.CHROME_CDP || 'http://127.0.0.1:9222',
  supa:       'https://ancecdfqfwlaujknizof.supabase.co/rest/v1',
  key:        process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6',
  consultor:  process.env.CONSULTOR || 'Thiago',

  // Ritmo. Piso e teto de espaçamento. O intervalo REAL e calculado: o worker divide o que
  // sobrou da janela pelo que sobrou do teto, entao 100 mensagens em 17 horas
  // viram uma a cada ~10 min sozinhas. O que derruba linha e densidade, nao
  // total — e densidade e exatamente o que essa conta minimiza.
  minSeg:     Number(process.env.MIN_SEG || 60),
  maxSeg:     Number(process.env.MAX_SEG || 900),
  horaIni:    Number(process.env.HORA_INI || 7),
  horaFim:    Number(process.env.HORA_FIM || 24),
};

const ARG = process.argv.slice(2);
const DRY   = ARG.includes('--dry');
const CANAL = (ARG.find(a => a.startsWith('--canal='))?.split('=')[1]) || 'whatsapp';
// abordar = primeira mensagem (fila fria) · responder = quem respondeu e está esperando
const MODO  = (ARG.find(a => a.startsWith('--modo='))?.split('=')[1]) || 'abordar';
const API   = process.env.API_BASE || 'https://solardocs-api.vercel.app';

const H = { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' };
const dorme = ms => new Promise(r => setTimeout(r, ms));
const agora = () => new Date().toLocaleTimeString('pt-BR');
const log = (...a) => console.log(`[${agora()}]`, ...a);

// ═══ CDP: o mínimo pra dirigir uma aba ═══════════════════════════════════════
// Um id por mensagem, uma Promise por id. Sem biblioteca: o protocolo é
// "manda json com id, recebe json com o mesmo id".
class Aba {
  constructor(ws) { this.ws = ws; this.id = 0; this.esperando = new Map(); }

  static async abrir(cdpBase) {
    const v = await (await fetch(`${cdpBase}/json/version`)).json();
    if (!v.webSocketDebuggerUrl) throw new Error('Chrome sem porta de debug aberta');
    // Abre uma aba PRÓPRIA do worker. Nunca adota aba sua: o Chrome continua seu.
    const br = await Aba.conectar(v.webSocketDebuggerUrl);
    const { targetId } = await br.enviar('Target.createTarget', { url: 'about:blank' });
    br.fechar();
    const alvos = await (await fetch(`${cdpBase}/json/list`)).json();
    const alvo = alvos.find(t => t.id === targetId);
    if (!alvo) throw new Error('não achei a aba que acabei de criar');
    const aba = await Aba.conectar(alvo.webSocketDebuggerUrl);
    aba.targetId = targetId;
    aba.cdpBase = cdpBase;
    await aba.enviar('Page.enable', {});
    await aba.enviar('Runtime.enable', {});
    return aba;
  }

  static conectar(url) {
    return new Promise((ok, erro) => {
      const ws = new WebSocket(url);
      const aba = new Aba(ws);
      ws.onopen = () => ok(aba);
      ws.onerror = e => erro(new Error('WebSocket falhou: ' + (e.message || 'sem detalhe')));
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        const p = aba.esperando.get(m.id);
        if (!p) return;
        aba.esperando.delete(m.id);
        m.error ? p.erro(new Error(m.error.message)) : p.ok(m.result);
      };
    });
  }

  enviar(method, params) {
    const id = ++this.id;
    return new Promise((ok, erro) => {
      this.esperando.set(id, { ok, erro });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.esperando.delete(id)) erro(new Error(`${method} não respondeu em 30s`));
      }, 30000);
    });
  }

  async js(expr) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'erro no JS da página');
    return r.result?.value;
  }

  async ir(url) {
    await this.enviar('Page.navigate', { url });
    await dorme(1200);
  }

  /** Espera uma condição na página. Devolve false em vez de explodir: página que
   *  não carregou é motivo de PULAR o contato, não de derrubar o worker. */
  async esperar(exprBool, ms = 25000, passo = 700) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await this.js(exprBool)) return true; } catch { /* navegando */ }
      await dorme(passo);
    }
    return false;
  }

  /** Digita caractere a caractere, com pausa humana. Não é disfarce: é o que
   *  evita que o React da página perca metade do texto num paste. */
  async digitar(texto) {
    for (const ch of texto) {
      await this.enviar('Input.insertText', { text: ch });
      await dorme(18 + Math.floor(45 * ((Date.now() % 97) / 97)));
    }
  }

  async fechar() {
    try { await fetch(`${this.cdpBase}/json/close/${this.targetId}`); } catch {}
    try { this.ws.close(); } catch {}
  }
}

// ═══ BANCO ═══════════════════════════════════════════════════════════════════
const ler = async q => {
  const r = await fetch(`${CFG.supa}/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q.split('?')[0]}: ${r.status} ${await r.text()}`);
  return r.json();
};

async function travas() {
  const [saude, teto] = await Promise.all([
    ler(`prospeccao_saude?select=*&consultor=eq.${encodeURIComponent(CFG.consultor)}`),
    ler(`prospeccao_teto_hoje?select=*&consultor=eq.${encodeURIComponent(CFG.consultor)}`),
  ]);
  return {
    // Consultor que não aparece na saúde não tocou ninguém em 14 dias — e quem
    // não tocou ninguém não pode estar queimando linha.
    estado: saude[0]?.estado || 'ok',
    taxa:   saude[0]?.taxa_optout ?? 0,
    teto:   teto[0]?.teto ?? 5,        // sem linha na rampa = consultor novo = 5
    usados: teto[0]?.usados_hoje ?? 0,
    restam: teto[0]?.restam ?? 0,
    porque: teto[0]?.porque || '',
  };
}

async function gravarToque(contatoId, listaId, produtoId, resultado, obs) {
  if (DRY) return;
  await fetch(`${CFG.supa}/prospeccao_toques`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contato_id: contatoId, lista_id: listaId, produto_id: produtoId,
      consultor: CFG.consultor, resultado, valor: 0, obs,
    }),
  });
}

// ═══ MENSAGEM ════════════════════════════════════════════════════════════════
// Mesma regra da tela: contexto da empresa escolhe a abertura, e o que a trava
// de alegação bloqueia não sai. Duas definições de "qual mensagem mandar" seria
// a pior coisa que este worker poderia ter.
const CTX = c => Number(c.avaliacoes || 0) >= 20 ? 'movimentada'
              : (c.site || '').trim() ? 'com_site' : 'padrao';

function montarMensagem(c, scripts, alegacoes, produtoId, preco) {
  const bloqueia = t => alegacoes.some(a => {
    if (a.verificada || !a.gatilho) return false;
    if (a.produto_id && a.produto_id !== produtoId) return false;
    try { return new RegExp(a.gatilho, 'i').test(t); } catch { return false; }
  });
  const doProduto = scripts.filter(s => s.produto_id === produtoId && (s.tipo || 'abertura') === 'abertura');
  const ctx = CTX(c);
  let pool = doProduto.filter(s => (s.contexto || 'padrao') === ctx);
  if (!pool.length) pool = doProduto.filter(s => (s.contexto || 'padrao') === 'padrao');
  if (!pool.length) pool = doProduto;
  const limpos = pool.filter(s => !bloqueia(s.texto));
  if (!limpos.length) return null;                    // tudo bloqueado: não inventa

  // varia pela posição do contato, não por random (random quebra reexecução)
  const s = limpos[(c.empresa || '').length % limpos.length];
  const primeiro = (c.socio || '').trim().split(/\s+/)[0] || '';
  let t = s.texto;
  if (!primeiro) t = t.replaceAll(', {socio}', '').replaceAll('{socio}', 'você');
  return t
    .replaceAll('{empresa}', c.empresa || '')
    .replaceAll('{cidade}', c.cidade || '')
    .replaceAll('{consultor}', CFG.consultor)
    .replaceAll('{socio}', primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1) : 'você')
    .replaceAll('{avaliacoes}', String(c.avaliacoes || '') || 'várias')
    .replaceAll('{nota}', String(c.nota || '') || '—')
    .replaceAll('{preco}', preco);
}

// ═══ ENVIO ═══════════════════════════════════════════════════════════════════
async function enviarWhatsApp(aba, tel, msg) {
  await aba.ir(`https://web.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(msg)}`);
  const pronto = await aba.esperar(
    `!!document.querySelector('footer [contenteditable="true"]')`, 45000);
  if (!pronto) return { ok: false, motivo: 'caixa de mensagem não abriu (número sem WhatsApp, ou sessão caiu)' };
  await aba.js(`document.querySelector('footer [contenteditable="true"]').focus()`);
  await dorme(900);
  await aba.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await aba.enviar('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await dorme(2200);
  // Prova de entrega: a caixa esvaziou. Sem isso, "enviei" seria só otimismo.
  const vazia = await aba.js(
    `(document.querySelector('footer [contenteditable="true"]')?.innerText || '').trim().length === 0`);
  return vazia ? { ok: true } : { ok: false, motivo: 'texto ficou na caixa — não saiu' };
}

async function enviarInstagram(aba, handle, msg) {
  await aba.ir(`https://www.instagram.com/${handle}/`);
  const carregou = await aba.esperar(`!!document.querySelector('main')`, 25000);
  if (!carregou) return { ok: false, motivo: 'perfil não carregou' };

  // O botão muda de nome e de classe; procuro pelo TEXTO, que é estável.
  const abriu = await aba.js(`(() => {
    const alvo = [...document.querySelectorAll('div[role="button"],button,a')]
      .find(b => /^(enviar mensagem|message|mensagem)$/i.test((b.innerText||'').trim()));
    if (!alvo) return false; alvo.click(); return true;
  })()`);
  if (!abriu) return { ok: false, motivo: 'botão de mensagem não encontrado (perfil privado, ou layout mudou)' };

  const caixa = await aba.esperar(
    `!!document.querySelector('div[role="textbox"],textarea[placeholder]')`, 25000);
  if (!caixa) return { ok: false, motivo: 'caixa de DM não abriu' };
  await aba.js(`(document.querySelector('div[role="textbox"],textarea[placeholder]')).focus()`);
  await dorme(700);
  await aba.digitar(msg);
  await dorme(900);
  await aba.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await aba.enviar('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await dorme(2500);
  const vazia = await aba.js(
    `((document.querySelector('div[role="textbox"],textarea[placeholder]')?.innerText || '')).trim().length === 0`);
  return vazia ? { ok: true } : { ok: false, motivo: 'texto ficou na caixa — não saiu' };
}

// ═══ OUVIDO: ler a conversa ══════════════════════════════════════════════════
// Dois canais, dois DOMs, um contrato: devolve [{de:'nos'|'lead', texto}].
//
// WhatsApp tem .message-in / .message-out — estáveis há anos.
// Instagram NÃO tem marcador equivalente: a classe é gerada e muda sozinha.
// O que não muda é o LAYOUT — mensagem nossa encosta na direita, dele na
// esquerda. Então o lado é decidido por geometria, não por nome de classe.
// É a única coisa que o Instagram não pode trocar sem virar outro produto.

const SEL_CAIXA = {
  whatsapp:  'footer [contenteditable="true"]',
  instagram: 'div[role="textbox"], textarea[placeholder]',
};

async function abrirConversa(aba, alvo, canal) {
  if (canal === 'instagram') {
    await aba.ir('https://www.instagram.com/' + alvo + '/');
    if (!await aba.esperar('!!document.querySelector("main")', 25000)) return 'perfil não carregou';
    const abriu = await aba.js('(() => {'
      + ' const b = [...document.querySelectorAll(\'div[role="button"],button,a\')]'
      + '   .find(x => /^(enviar mensagem|message|mensagem)$/i.test((x.innerText||"").trim()));'
      + ' if (!b) return false; b.click(); return true; })()');
    if (!abriu) return 'botão de mensagem não encontrado (perfil privado, ou layout mudou)';
  } else {
    await aba.ir('https://web.whatsapp.com/send?phone=' + alvo);
  }
  const ok = await aba.esperar('!!document.querySelector(\'' + SEL_CAIXA[canal] + '\')', 45000);
  return ok ? null : 'caixa de mensagem não abriu';
}

async function lerConversa(aba, alvo, canal, quantas = 12) {
  const erro = await abrirConversa(aba, alvo, canal);
  if (erro) return { erro };
  await dorme(1500);

  const js = canal === 'whatsapp'
    ? '(() => {'
      + ' const l = [...document.querySelectorAll(".message-in, .message-out")];'
      + ' return l.slice(-' + quantas + ').map(el => ({'
      + '   de: el.classList.contains("message-in") ? "lead" : "nos",'
      + '   texto: (el.querySelector(".selectable-text")?.innerText || el.innerText || "")'
      + '            .replace(/[ \t\n\r]+/g, " ").trim().slice(0, 600),'
      + ' })).filter(m => m.texto); })()'
    // Instagram: lado por geometria. Pega as linhas da thread, mede o centro de
    // cada uma contra o centro do container. Direita = nossa, esquerda = dele.
    : '(() => {'
      + ' const rows = [...document.querySelectorAll(\'div[role="row"]\')];'
      + ' if (!rows.length) return [];'
      + ' const cont = rows[0].parentElement?.getBoundingClientRect();'
      + ' if (!cont || !cont.width) return [];'
      + ' const meio = cont.left + cont.width / 2;'
      + ' return rows.slice(-' + quantas + ').map(r => {'
      + '   const txt = (r.innerText || "").replace(/[ \t\n\r]+/g, " ").trim().slice(0, 600);'
      + '   if (!txt) return null;'
      + '   const b = r.getBoundingClientRect();'
      + '   const centro = b.left + b.width / 2;'
      + '   return { de: centro > meio ? "nos" : "lead", texto: txt };'
      + ' }).filter(Boolean); })()';

  const msgs = await aba.js(js);
  return { msgs: msgs || [] };
}

// ═══ BOCA: digitar as bolhas, uma mensagem por bolha ═════════════════════════
// Uma bolha por Enter. Mandar tudo junto vira parede de texto — a cara de robô
// que a casa evita em todos os outros agentes.
async function mandarBolhas(aba, bolhas, canal) {
  const CX = 'document.querySelector(\'' + SEL_CAIXA[canal] + '\')';
  for (const b of bolhas) {
    if (!await aba.esperar('!!' + CX, 20000)) return { ok: false, motivo: 'caixa sumiu no meio' };
    await aba.js(CX + '.focus()');
    await dorme(400);
    await aba.digitar(b);
    await dorme(500);
    await aba.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await aba.enviar('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await dorme(1800);
    const vazia = await aba.js('(' + CX + '?.innerText || "").trim().length === 0');
    if (!vazia) return { ok: false, motivo: 'bolha ficou na caixa — não saiu' };
    // gente não manda 3 mensagens no mesmo segundo
    await dorme(1200 + Math.floor(1800 * ((Date.now() % 991) / 991)));
  }
  return { ok: true };
}

// ═══ MODO RESPONDER ══════════════════════════════════════════════════════════
// Só chama a IA se a ÚLTIMA mensagem for do lead. Chamar pra conversa onde nós
// falamos por último seria pagar pra descobrir que não há o que responder.
async function modoResponder() {
  const todas = await ler(
    'prospeccao_contato_estado?select=contato_id,empresa,telefone,canal,lista_id'
    + '&canal=in.(aguardando,conversa_viva)&order=ultimo_toque_em.desc&limit=200');
  // Instagram só alcança quem tem @. Buscar o handle aqui (e não na view)
  // mantém prospeccao_contato_estado do jeito que a tela já usa.
  let esperando = todas;
  if (CANAL === 'instagram') {
    const ids = todas.map(c => c.contato_id).join(',');
    const arrobas = ids
      ? await ler('prospeccao_contatos?select=id,instagram&id=in.(' + ids + ')&instagram=not.is.null&instagram=neq.')
      : [];
    const porId = new Map(arrobas.map(a => [a.id, a.instagram]));
    esperando = todas.filter(c => porId.has(c.contato_id))
                     .map(c => ({ ...c, instagram: porId.get(c.contato_id) }));
    log(todas.length + ' conversas em aberto · ' + esperando.length + ' com @ de Instagram');
  } else {
    log(esperando.length + ' conversas em aberto pra conferir');
  }
  if (!esperando.length) return;

  let aba = null;
  try { aba = await Aba.abrir(CFG.cdp); }
  catch (e) {
    log('NÃO CONSEGUI FALAR COM O CHROME:', e.message);
    log('Sem Chrome não dá pra LER conversa nenhuma. Listando quem eu conferiria:');
    todas.slice(0, 20).forEach(c => console.log('  · ' + c.empresa + ' (' + c.telefone + ')'));
    return;
  }
  log(DRY ? 'Chrome conectado — vou LER e mostrar a resposta, sem mandar nada.' : 'Chrome conectado.');

  let respondidas = 0, semNovidade = 0, falhas = 0;
  for (const c of esperando) {
    const alvo = CANAL === 'instagram' ? c.instagram : c.telefone;
    const { msgs: hist, erro } = await lerConversa(aba, alvo, CANAL);
    if (erro || !hist || !hist.length) {
      falhas++; log('  x ' + c.empresa + ': ' + (erro || 'conversa vazia')); continue;
    }
    if (hist[hist.length - 1].de !== 'lead') { semNovidade++; continue; }

    let v = null;
    try {
      const r = await fetch(API + '/gerador/prospeccao/responder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: c.empresa, produto_id: 'solardoc', historico: hist,
          contato_id: c.contato_id, canal: CANAL }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      v = await r.json();
    } catch (e) { falhas++; log('  x ' + c.empresa + ': a cabeça não respondeu (' + e.message + ')'); continue; }

    console.log('\n─── ' + c.empresa + ' · ' + (CANAL === 'instagram' ? '@' + c.instagram : c.telefone) + ' ───');
    console.log('  ele: "' + hist[hist.length - 1].texto.slice(0, 110) + '"');
    console.log('  -> ' + v.intencao + ' / ' + v.resultado
      + (v.escalar ? ' · ESCALAR' : '') + (v.mandar_link ? ' · manda link' : ''));
    (v.envio || []).forEach(b => console.log('  | ' + b));

    if (DRY) { respondidas++; continue; }

    const env = await mandarBolhas(aba, v.envio, CANAL);
    if (!env.ok) { falhas++; log('  x ' + env.motivo); continue; }
    respondidas++;
    await gravarToque(c.contato_id, c.lista_id, 'solardoc', v.resultado,
      ('IA: ' + v.intencao + (v.escalar ? ' · PRECISA DE HUMANO' : '') + ' — ' + v.motivo).slice(0, 400));

    // 'nao_perturbar' bloqueia o contato, igual a tela faz. Sem isto ele
    // voltaria pra fila fria amanhã depois de ter pedido pra parar.
    if (v.resultado === 'nao_perturbar') {
      await fetch(CFG.supa + '/prospeccao_contatos?id=eq.' + c.contato_id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ bloqueado: true }),
      }).catch(() => {});
      log('  contato bloqueado — não entra mais em fila nenhuma');
    }
    if (v.escalar) log('  ESCALADO: alguém precisa olhar essa conversa');
    await dorme(8000 + Math.floor(12000 * ((Date.now() % 997) / 997)));
  }

  await aba.fechar();
  console.log('\n─────────────────────────────────────────');
  console.log('  ' + (DRY ? 'simuladas   ' : 'respondidas ') + respondidas);
  console.log('  sem novidade ' + semNovidade);
  console.log('  falhas       ' + falhas);
  console.log('─────────────────────────────────────────');
  console.log('\nAcompanhe no radar: https://solardoc.app/gerador/radar/\n');
}

// ═══ LOOP ════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ${(MODO === 'responder' ? 'RESPONDENDO' : 'ABORDANDO').padEnd(11)} · ${CANAL.toUpperCase().padEnd(9)} ${(DRY ? 'ENSAIO (não envia)' : 'ENVIANDO DE VERDADE').padEnd(19)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (MODO === 'responder') return await modoResponder();

  const t0 = await travas();
  log(`consultor ${CFG.consultor} · teto ${t0.usados}/${t0.teto} · opt-out ${t0.taxa}% (${t0.estado})`);
  if (t0.porque) log(`  ${t0.porque}`);
  log(`  janela ${CFG.horaIni}h–${CFG.horaFim === 24 ? '23h59' : CFG.horaFim + 'h'}`);
  if (t0.estado === 'travado') {
    log('DISJUNTOR ARMADO — a fila está travada por opt-out alto. Nada será enviado.');
    log('Troque a abertura e recomece por uma lista nova antes de voltar.');
    return;
  }
  if (t0.restam <= 0 && !DRY) { log('teto do dia já atingido. Volte amanhã — a rampa continua.'); return; }

  const [fila, scripts, alegacoes, produtos] = await Promise.all([
    ler('prospeccao_fila_worker?select=*&limit=200'),
    ler('prospeccao_scripts?select=*'),
    ler('prospeccao_alegacoes?select=*'),
    ler('prospeccao_produtos?select=*&ativo=eq.true&order=ordem.asc'),
  ]);

  // Só quem tem o endereço do canal escolhido.
  const alvos = fila.filter(c => CANAL === 'instagram' ? !!(c.instagram || '').trim() : !!(c.telefone || '').trim());
  log(`fila: ${fila.length} elegíveis · ${alvos.length} com ${CANAL === 'instagram' ? '@' : 'telefone'}`);
  if (CANAL === 'instagram' && alvos.length < fila.length) {
    log(`  (${fila.length - alvos.length} sem @ — rode "node colher-instagram.mjs" pra colher)`);
  }
  if (!alvos.length) { log('ninguém pra falar agora.'); return; }

  let aba = null;
  if (!DRY) {
    try { aba = await Aba.abrir(CFG.cdp); }
    catch (e) {
      log('NÃO CONSEGUI FALAR COM O CHROME:', e.message);
      log('Suba o Chrome com --remote-debugging-port=9222 e um --user-data-dir próprio.');
      log('Enquanto isso, "node worker.mjs --dry" funciona e mostra tudo que sairia.');
      return;
    }
    log('Chrome conectado, aba própria aberta.');
  }

  let enviados = 0, falhas = 0;
  for (const c of alvos) {
    // As travas são relidas a cada envio, não uma vez no começo: se alguém
    // registrar "não perturbar" na tela enquanto isto roda, o worker para.
    const t = await travas();
    if (t.estado === 'travado') { log('DISJUNTOR ARMOU no meio da fila — parando.'); break; }
    if (!DRY && t.restam <= 0)  { log(`teto do dia atingido (${t.teto}). Parando.`); break; }

    const h = new Date().getHours();
    if (h < CFG.horaIni || (CFG.horaFim < 24 && h >= CFG.horaFim)) {
      log(`fora da janela (${CFG.horaIni}h–${CFG.horaFim}h). Parando.`); break;
    }

    const pid = c.produto_da_lista || (produtos[0] && produtos[0].id);
    const prod = produtos.find(p => p.id === pid);
    const preco = prod ? `R$ ${Number(prod.preco).toLocaleString('pt-BR')}` : '';
    const msg = montarMensagem(c, scripts, alegacoes, pid, preco);
    if (!msg) { log(`PULOU ${c.empresa} — todo script de ${pid} está bloqueado pela trava de alegação`); continue; }

    const destino = CANAL === 'instagram' ? '@' + c.instagram : c.telefone;
    console.log(`\n─── ${c.empresa} · ${c.cidade || ''} · ${destino} · ${CTX(c)} ───`);
    console.log(msg.split('\n').map(l => '  │ ' + l).join('\n'));

    if (DRY) { enviados++; continue; }

    const r = CANAL === 'instagram'
      ? await enviarInstagram(aba, c.instagram, msg)
      : await enviarWhatsApp(aba, c.telefone, msg);

    if (r.ok) {
      enviados++;
      await gravarToque(c.id, null, pid, 'enviei', `worker ${CANAL}`);
      log(`  ✓ enviado (${enviados})`);
    } else {
      falhas++;
      log(`  ✗ ${r.motivo}`);
      // Falha NÃO vira toque: gravar "enviei" pra mensagem que não saiu faria a
      // pessoa sumir da fila sem nunca ter sido falada.
      if (falhas >= 5) { log('5 falhas seguidas — algo mudou na página ou a sessão caiu. Parando.'); break; }
    }

    // ── ESPACAMENTO ADAPTATIVO ──────────────────────────────────────────
    // Divide o tempo que sobra da janela pelo que sobra do teto. Manda cedo e
    // o worker anda devagar; entrou tarde e ele acelera ate o piso. Ninguem
    // precisa escolher "quantos segundos entre mensagens": a janela e o teto
    // ja respondem isso, e a resposta e sempre a MENOR densidade possivel.
    const fimJanela = new Date(); fimJanela.setHours(CFG.horaFim, 0, 0, 0);
    const sobramSeg = Math.max(60, Math.floor((fimJanela - new Date()) / 1000));
    const sobramMsg = Math.max(1, (await travas()).restam);
    const ideal = Math.floor(sobramSeg / sobramMsg);
    const jitter = 0.75 + 0.5 * ((Date.now() % 1013) / 1013);   // +-25%, nunca ritmo de metronomo
    const espera = Math.min(CFG.maxSeg, Math.max(CFG.minSeg, Math.floor(ideal * jitter)));
    log(`  aguardando ${espera}s (${sobramMsg} restantes em ${Math.floor(sobramSeg/60)} min de janela)`);
    await dorme(espera * 1000);
  }

  if (aba) await aba.fechar();
  console.log(`\n─────────────────────────────────────────`);
  console.log(`  ${DRY ? 'simulados' : 'enviados'}  ${enviados}`);
  if (!DRY) console.log(`  falhas     ${falhas}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`\nAcompanhe no radar: https://solardoc.app/gerador/radar/\n`);
}

main().catch(e => { console.error('\nquebrou:', e.message); process.exit(1); });
