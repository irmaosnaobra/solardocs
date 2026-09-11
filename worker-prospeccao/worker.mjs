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
  // Quem ASSINA a mensagem. Separado do consultor de propósito: o consultor é a
  // conta que gasta o teto (pode ser um @, como "irmaosnaobra__"), e ninguém
  // escreve "Oi! irmaosnaobra__ aqui" pra outro ser humano.
  assinatura: process.env.NOME || process.env.CONSULTOR || 'Thiago',

  // Ritmo. Piso e teto de espaçamento. O intervalo REAL e calculado: o worker divide o que
  // sobrou da janela pelo que sobrou do teto, entao 100 mensagens em 17 horas
  // viram uma a cada ~10 min sozinhas. O que derruba linha e densidade, nao
  // total — e densidade e exatamente o que essa conta minimiza.
  // Entre uma abordagem e outra. Um humano fazendo prospecção manda de 4 em 4,
  // de 10 em 10 minutos — não de hora em hora. O que protege a conta é o TETO
  // do dia, não o espaço entre uma mensagem e outra.
  minSeg:     Number(process.env.MIN_SEG || 240),   //  4 min
  maxSeg:     Number(process.env.MAX_SEG || 900),   // 15 min
  // De quanto em quanto tempo ela olha se alguém respondeu. LER é de graça e
  // não tem risco nenhum — o que custa é enviar. Então ela olha o tempo todo.
  olharSeg:   Number(process.env.OLHAR_SEG || 150), // 2min30
  // JANELA DE 24 HORAS. Quem recebe de madrugada le e responde de manha — o
  // computador fica ligado, entao nao ha motivo pra ela dormir.
  //
  // Isso NAO aumenta o volume: quem limita quantas mensagens saem por dia e o
  // teto (prospeccao_teto_hoje), nao o relogio. Espalhar o mesmo teto em 24h em
  // vez de 17h baixa as mensagens por hora, nao sobe.
  //
  // horaIni=0 e horaFim=24 desligam as duas pontas da guarda de janela.
  horaIni:    Number(process.env.HORA_INI || 0),
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

  /** Avalia JS na página. Uma nova tentativa de propósito: a causa mais comum de
   *  falha aqui é a página estar navegando na hora — o contexto morre no meio e
   *  volta "Uncaught" sem dizer nada. Meio segundo depois costuma funcionar.
   *  E o erro carrega um pedaço da expressão, senão não dá pra saber qual quebrou. */
  async js(expr, tentativa = 1) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      if (tentativa < 2) { await dorme(600); return this.js(expr, tentativa + 1); }
      const det = r.exceptionDetails.exception?.description
        || r.exceptionDetails.text || 'erro no JS da página';
      const primeira = String(det).split(/[\r\n]/)[0];
      throw new Error(`${primeira} — em: ${expr.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
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

  /** Fecha a aba do worker — mas NUNCA a ultima do navegador. Fechar a ultima
   *  mata o Chrome inteiro, e num turno de 16 horas isso derruba a operacao no
   *  meio da madrugada sem ninguem pra reabrir. Se for a unica, so navega pra
   *  longe e deixa viva. */
  async fechar() {
    try {
      const abas = await (await fetch(`${this.cdpBase}/json/list`)).json();
      const paginas = (abas || []).filter(t => t.type === 'page');
      if (paginas.length <= 1) {
        await this.enviar('Page.navigate', { url: 'https://www.instagram.com/' }).catch(() => {});
      } else {
        await fetch(`${this.cdpBase}/json/close/${this.targetId}`);
      }
    } catch {}
    try { this.ws.close(); } catch {}
  }
}

// ═══ BANCO ═══════════════════════════════════════════════════════════════════
// Um 504 do Supabase derrubava a rodada inteira: o worker morria antes de
// mandar a primeira mensagem por causa de um soluco de 2 segundos. Tres
// tentativas com espera crescente resolvem o transitorio; erro que persiste
// continua estourando, porque aí é problema de verdade.
const ler = async (q, tentativa = 1) => {
  try {
    const r = await fetch(`${CFG.supa}/${q}`, { headers: H });
    if (r.ok) return await r.json();
    // 4xx é pedido errado — repetir não conserta. 5xx e 429 são transitórios.
    if (r.status < 500 && r.status !== 429) {
      throw new Error(`${q.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    if (tentativa >= 3) throw new Error(`${q.split('?')[0]}: ${r.status} depois de 3 tentativas`);
  } catch (e) {
    if (tentativa >= 3 || /: 4\d\d /.test(e.message)) throw e;
  }
  log(`  banco engasgou em ${q.split('?')[0]} — tentativa ${tentativa + 1} de 3`);
  await dorme(1500 * tentativa);
  return ler(q, tentativa + 1);
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
    respostas: teto[0]?.respostas_hoje ?? 0,
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
  // Sem nome na ficha, o vocativo SOME — nao vira "voce". "fala voce" e
  // "oi, voce" sao a cara de mensagem automatica que a gente esta evitando.
  // Tira a virgula e o espaco junto, e limpa pontuacao orfa no comeco da linha.
  if (!primeiro) {
    t = t.replace(/[ 	]*,?[ 	]*\{socio\}/g, '')
         .replace(/\{socio\}[ 	]*,?[ 	]*/g, '')
         .replace(/^[ 	]*,[ 	]*/gm, '')
         .replace(/[ 	]+$/gm, '');
    // "fala" sozinho numa linha fica pendurado — gente escreve "fala!" ou
    // emenda na frase. Sem nome, a saudação vira uma linha completa.
    t = t.replace(/^(fala|opa|oi|e aí|e ai|bom dia|boa tarde)$/gim, m => m + '!');
  }
  return t
    .replaceAll('{empresa}', c.empresa || '')
    .replaceAll('{cidade}', c.cidade || '')
    .replaceAll('{consultor}', CFG.assinatura)
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
  // Mesma porta de entrada do modo responder: um lugar só pra consertar quando
  // o Instagram mexer no layout, e o mesmo diagnóstico útil nos dois caminhos.
  const erro = await abrirConversa(aba, handle, 'instagram');
  if (erro) return { ok: false, motivo: erro };
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

    // Perfil que nem existe: o Instagram serve a pagina de erro, nao um perfil.
    const sumiu = await aba.js('/desculpe|sorry|not available|nao esta disponivel/i'
      + '.test((document.querySelector("main")?.innerText || "").slice(0, 400))');
    if (sumiu) return 'perfil não existe mais (ou foi renomeado)';

    // O rotulo do botao muda com idioma, com tema e com o Instagram mudando de
    // ideia. Duas passadas: primeiro o texto exato, depois um "contém". Se as
    // duas falharem, DEVOLVE O QUE VIU — sem isso o erro nao ensina nada e a
    // correcao vira adivinhacao em cima de adivinhacao.
    const r = await aba.js(`(() => {
      const els = [...document.querySelectorAll('div[role="button"],button,a')]
        .map(e => ({ e, t: (e.innerText || '').trim() }))
        .filter(x => x.t && x.t.length < 40);
      const exato = /^(enviar mensagem|mensagem|message|send message)$/i;
      const contem = /(mensagem|message)/i;
      let alvo = els.find(x => exato.test(x.t)) || els.find(x => contem.test(x.t));
      if (alvo) { alvo.e.click(); return { ok: true, usou: alvo.t }; }
      return { ok: false, vistos: [...new Set(els.map(x => x.t))].slice(0, 14) };
    })()`);

    if (!r || !r.ok) {
      const vistos = (r && r.vistos || []).join(' | ') || '(nenhum botão com texto)';
      return 'botão de mensagem não encontrado. Botões visíveis: ' + vistos;
    }
  } else {
    await aba.ir('https://web.whatsapp.com/send?phone=' + alvo);
  }

  const ok = await aba.esperar('!!document.querySelector(\'' + SEL_CAIXA[canal] + '\')', 45000);
  if (ok) return null;

  // Mesma ideia na caixa: dizer o que existe na tela em vez de "nao abriu".
  if (canal === 'instagram') {
    const pistas = await aba.js(`(() => {
      const t = (document.body.innerText || '').slice(0, 600);
      return {
        url: location.href,
        limite: /limite|limit|tente novamente|try again|espere/i.test(t),
        trecho: t.replace(/[ \\s]+/g, ' ').slice(0, 180),
      };
    })()`);
    if (pistas?.limite) return 'o Instagram pediu pra esperar — parece limite de envio. Pare por hoje.';
    return 'caixa de DM não abriu (em ' + (pistas?.url || '?') + '). Tela dizia: "' + (pistas?.trecho || '') + '"';
  }
  return 'caixa de mensagem não abriu';
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
      + '            .replace(/[ \\s]+/g, " ").trim().slice(0, 600),'
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
      + '   const txt = (r.innerText || "").replace(/[ \\s]+/g, " ").trim().slice(0, 600);'
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
  // sem_retorno entra junto de proposito. Depois que 'conversa_viva' passou a
  // exigir recencia, quem respondeu ha um mes caiu pra sem_retorno — e essa e
  // exatamente a pessoa cuja resposta talvez nunca tenha sido lida. Ler a
  // conversa e barato; so chama a IA se a ultima mensagem for dela.
  const todas = await ler(
    'prospeccao_contato_estado?select=contato_id,empresa,telefone,canal,lista_id'
    + '&canal=in.(aguardando,conversa_viva,sem_retorno)&order=ultimo_toque_em.desc&limit=200');
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
    if (MODO !== 'continuo') log(todas.length + ' conversas em aberto · ' + esperando.length + ' com @ de Instagram');
  } else {
    // Em modo contínuo isto roda a cada 2 min: falar toda vez viraria parede de
  // log e esconderia o que importa. Só avisa quando há algo pra fazer.
  if (MODO !== 'continuo') log(esperando.length + ' conversas em aberto pra conferir');
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
    // Uma conversa que quebra nao pode derrubar a rodada inteira: sao 170 e a
    // proxima pode ser justamente a que respondeu.
    let hist = null, erro = null;
    try { ({ msgs: hist, erro } = await lerConversa(aba, alvo, CANAL)); }
    catch (e) { erro = e.message; }
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
  if (MODO === 'continuo') {
    // Em contínuo só fala quando fez alguma coisa. Silêncio = ninguém respondeu.
    if (respondidas || falhas) log(`respondi ${respondidas}${falhas ? `, ${falhas} falha(s)` : ''}`);
  } else {
    console.log('\n─────────────────────────────────────────');
    console.log('  ' + (DRY ? 'simuladas   ' : 'respondidas ') + respondidas);
    console.log('  sem novidade ' + semNovidade);
    console.log('  falhas       ' + falhas);
    console.log('─────────────────────────────────────────');
    console.log('\nAcompanhe no radar: https://solardoc.app/gerador/radar/\n');
  }
}

// ═══ UMA ABORDAGEM ═══════════════════════════════════════════════════════════
// O modo contínuo manda UMA por rodada, não um lote. É o que espalha os toques
// pelo dia inteiro em vez de despejar o teto numa hora só — e despejar numa
// hora só é exatamente o padrão que derrubou a linha IO em 30/08.
//
// Abre e fecha a aba a cada chamada de propósito: uma aba viva por 16 horas
// acumula estado, memória e sessão velha. Custa 2 segundos e evita a classe
// inteira de bug de "funcionava de manhã".
async function umaAbordagem() {
  const [fila, scripts, alegacoes, produtos] = await Promise.all([
    ler('prospeccao_fila_worker?select=*&limit=200'),
    ler('prospeccao_scripts?select=*'),
    ler('prospeccao_alegacoes?select=*'),
    ler('prospeccao_produtos?select=*&ativo=eq.true&order=ordem.asc'),
  ]);

  const alvos = fila.filter(c => CANAL === 'instagram'
    ? !!(c.instagram || '').trim() : !!(c.telefone || '').trim());
  if (!alvos.length) {
    log(CANAL === 'instagram'
      ? 'ninguém com @ na fila agora — vou procurar mais endereço'
      : 'ninguém na fila agora');
    return 'vazio';
  }

  const c = alvos[0];
  const pid = c.produto_da_lista || (produtos[0] && produtos[0].id);
  const prod = produtos.find(p => p.id === pid);
  const preco = prod ? `R$ ${Number(prod.preco).toLocaleString('pt-BR')}` : '';
  const msg = montarMensagem(c, scripts, alegacoes, pid, preco);
  if (!msg) { log(`PULOU ${c.empresa} — todo script de ${pid} está bloqueado pela trava`); return 'falhou'; }

  const destino = CANAL === 'instagram' ? '@' + c.instagram : c.telefone;
  console.log(`\n─── ${c.empresa} · ${c.cidade || ''} · ${destino} · ${CTX(c)} ───`);
  console.log(msg.split('\n').map(l => '  │ ' + l).join('\n'));
  if (DRY) return 'enviou';

  let aba = null;
  try {
    aba = await Aba.abrir(CFG.cdp);
    const r = CANAL === 'instagram'
      ? await enviarInstagram(aba, c.instagram, msg)
      : await enviarWhatsApp(aba, c.telefone, msg);
    if (r.ok) {
      await gravarToque(c.id, null, pid, 'enviei', `worker ${CANAL}`);
      log('  ✓ enviado');
      return 'enviou';
    }
    log('  ✗ ' + r.motivo);

    // Falha passageira (página não carregou, rede caiu) NÃO vira toque: quem
    // não recebeu não pode sair da fila. Mas perfil que não existe mais é
    // PERMANENTE, e aí a regra se vira contra ela: como a fila sempre entrega o
    // primeiro, um @ morto no topo trava todo mundo atrás dele pra sempre.
    // Foi o que aconteceu em 11/09: @bluesun.luz falhou às 11:53 e de novo às
    // 12:10, e entre uma e outra ela não falou com mais ninguém.
    //
    // Apagar o @ (string vazia, não NULL) é o mesmo sinal que o reabastecimento
    // já usa: "procuramos, não serve". A empresa continua na base; o que sai é
    // o endereço errado.
    if (CANAL === 'instagram' && /não existe mais/.test(r.motivo)) {
      await fetch(`${CFG.supa}/prospeccao_contatos?id=eq.${c.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ instagram: '', instagram_em: new Date().toISOString() }),
      }).catch(() => {});
      log(`  @${c.instagram} não existe mais — apaguei o endereço, a empresa fica na base`);
    }
    return 'falhou';
  } finally {
    if (aba) await aba.fechar();
  }
}

/**
 * Põe a aba DENTRO do instagram.com antes de qualquer busca.
 *
 * Aba nova nasce em about:blank, e de lá um fetch('/web/search/...') não tem
 * contra o que resolver: o Chrome devolve "Failed to parse URL" e a busca morre
 * calada. Foi o que derrubou o reabastecimento e a varredura de cidade em
 * 11/09, com a agente achando que tinha procurado.
 *
 * Não adianta usar o endereço completo: o cookie da sessão só viaja se a
 * requisição sair de uma página do próprio instagram.com. O que resolve é
 * ESTAR lá.
 */
async function garantirInstagram(aba) {
  const onde = await aba.js('location.origin').catch(() => null);
  if (onde === 'https://www.instagram.com') return true;
  await aba.ir('https://www.instagram.com/');
  return await aba.esperar("location.origin === 'https://www.instagram.com'", 20000);
}

// ═══ ORÇAMENTO DE BUSCA ══════════════════════════════════════════════════════
// Buscar na lupa é leitura, muito mais barato que mandar DM — mas não é de
// graça. A conta é a principal (@irmaosnaobra__), semana 1 da rampa, e uma
// rajada de busca derruba um perfil do mesmo jeito que uma rajada de mensagem.
//
// "Nunca ociosa" quer dizer SEMPRE TER O QUE FAZER, não fazer o máximo de
// requisição por minuto. Sem este teto, o loop de 2min30 dispararia ~120
// buscas por hora, que é ritmo de robô e não de gente trabalhando.
const BUSCAS_HORA = Number(process.env.BUSCAS_HORA || 30);
let janelaBusca = [];
function sobramBuscas() {
  const corte = Date.now() - 3600_000;
  janelaBusca = janelaBusca.filter(t => t > corte);
  return Math.max(0, BUSCAS_HORA - janelaBusca.length);
}
const gastarBusca = () => janelaBusca.push(Date.now());

// ═══ REABASTECER ═════════════════════════════════════════════════════════════
// A fila tem 469 empresas mas só ~100 com @. Sem isto a agente seca em dias e
// para sozinha — com 369 alvos parados na base esperando um handle.
//
// Procura o @ pela lupa do próprio Instagram, com a conta logada, DENTRO do
// tempo ocioso entre uma abordagem e outra. Buscar é muito mais leve que mandar
// DM (é leitura), mas não é de graça: por isso vai devagar, poucas por rodada.
//
// Só aceita perfil que compartilhe uma palavra DISTINTIVA com o nome da empresa.
// "solar", "energia", "engenharia" e mais 20 não contam — senão "Solar Brasil"
// casaria com @solarpiracanjuba e a DM iria pro perfil errado, que é pior que
// não mandar.
const GENERICAS = new Set(['solar','energia','energias','solares','fotovoltaica','fotovoltaico',
  'renovavel','renovaveis','engenharia','ltda','me','eireli','comercio','servicos','servico',
  'service','services','e','de','do','da','em','the','sistemas','solucoes','solucao','tecnologia',
  'eletrica','eletricas','eletrico','brasil','grupo','cia','express','automacao','residencial',
  'comercial','industrial','instalacao','instalacoes','projetos','projeto','consultoria',
  'assessoria','representacoes','distribuidora','oficial','ltd','sa','mei','epp']);
const normNome = x => String(x || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const distintivas = n => normNome(n).split(' ').filter(t => t.length >= 3 && !GENERICAS.has(t));

// Perfil que claramente e outra coisa. A academia entrou aqui por merito
// proprio: "JE Energia Solar - Jaragua Goias" casou com
// @academiagavioes24h_jaragua pela palavra "jaragua", que e a CIDADE.
const OUTRO_RAMO = new RegExp(['academia','crossfit','barbearia','salao','estetica','petshop',
  'pizzaria','lanchonete','restaurante','igreja','escola','colegio','futebol','moda','boutique',
  'imobiliaria','advocacia','odonto','clinica','farmacia','mercado','supermercado','padaria',
  'auto ?pecas','borracharia','hotel','pousada'].join('|'));

/**
 * Este perfil e MESMO desta empresa?
 *
 * Erra pra menos de proposito. Mandar oferta de sistema de proposta pra uma
 * academia nao e so desperdicio: e a pessoa errada recebendo venda fria, que e
 * exatamente o que gera denuncia e derruba conta.
 *
 * O que nao vale como prova:
 * · palavra generica do ramo (solar, energia, engenharia, service, express...)
 * · o nome da CIDADE — ela ja esta na consulta, entao casar por ela nao diz
 *   nada sobre ser a empresa certa
 * · uma palavra so, quando a empresa tem varias — "Solar Brasil" nao pode virar
 *   @solarpiracanjuba
 */
function casaPerfil(empresa, u, cidade) {
  const doLugar = new Set(distintivas(cidade || ''));
  const alvo = distintivas(empresa).filter(t => !doLugar.has(t));
  if (!alvo.length) return null;

  const txt = normNome(u.username + ' ' + (u.full_name || ''));
  if (OUTRO_RAMO.test(txt)) return null;

  const junto = txt.replace(/ /g, '');
  const bate = alvo.filter(t => txt.includes(t) || junto.includes(t));
  if (!bate.length) return null;

  // Empresa com nome de uma palavra so: essa palavra tem que aparecer, e ponto.
  // Com duas ou mais, exige pelo menos duas OU uma palavra longa (6+ letras),
  // que e especifica o bastante pra nao ser coincidencia.
  const forte = bate.length >= 2 || alvo.length === 1 || bate.some(t => t.length >= 6);
  if (!forte) return null;

  return { forca: bate.length / alvo.length, palavras: bate };
}

/** Uma rodada curta de busca de @. Devolve quantos achou. */
async function reabastecer(aba, quantos = 4) {
  const cabem = Math.min(quantos, sobramBuscas());
  if (cabem <= 0) return 0;
  if (!await garantirInstagram(aba)) { log('  não consegui abrir o Instagram pra procurar @'); return 0; }
  // SÓ quem nunca foi procurado. O @ vazio quer dizer "já procurei e não achei",
  // e voltar nele toda rodada gastaria a busca do dia relendo as mesmas empresas
  // sem chance — o comentário do vazio dizia isso, a consulta não cumpria.
  const semArroba = await ler('prospeccao_contatos?select=id,empresa,cidade'
    + '&classe=in.(integradora,misto)&instagram=is.null&limit=' + cabem);
  if (!semArroba.length) return 0;

  // O mesmo @ nao pode virar duas empresas. Aconteceu hoje com
  // @ecopowerenergia, atribuido a dois contatos diferentes: a segunda empresa
  // ficaria com o endereco da primeira e receberia mensagem que nao e dela.
  const usados = new Set((await ler('prospeccao_contatos?select=instagram&instagram=not.is.null&limit=20000'))
    .map(x => String(x.instagram || '').toLowerCase()).filter(Boolean));

  let achou = 0;
  for (const c of semArroba) {
    const termo = [c.empresa, c.cidade].filter(Boolean).join(' ');
    let r = null;
    try {
      r = await aba.js(`(async () => {
        try {
          const q = await fetch('/web/search/topsearch/?context=blended&query='
            + encodeURIComponent(${JSON.stringify(termo)}), { headers: { 'X-IG-App-ID': '936619743392459' } });
          if (!q.ok) return { erro: 'HTTP ' + q.status };
          const j = await q.json();
          return { users: (j.users || []).slice(0, 8).map(u => ({
            username: u.user && u.user.username, full_name: u.user && u.user.full_name })).filter(u => u.username) };
        } catch (e) { return { erro: String(e && e.message || e) }; }
      })()`);
    } catch (e) { r = { erro: e.message }; }
    gastarBusca();

    if (r?.erro) { log(`  busca de @ reclamou (${r.erro}) — paro de procurar nesta rodada`); break; }

    const cand = (r?.users || []).map(u => ({ u, m: casaPerfil(c.empresa, u, c.cidade) }))
      .filter(x => x.m && !usados.has(String(x.u.username).toLowerCase()))
      .sort((a, b) => b.m.forca - a.m.forca)[0];

    // '' = procuramos e nao serve. Sem isso a mesma empresa seria procurada
    // pra sempre, gastando busca toda rodada.
    const valor = cand ? cand.u.username : '';
    await fetch(`${CFG.supa}/prospeccao_contatos?id=eq.${c.id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ instagram: valor, instagram_em: new Date().toISOString() }),
    }).catch(() => {});
    if (cand) { usados.add(String(cand.u.username).toLowerCase()); achou++;
      log(`  achei @${cand.u.username} — ${c.empresa} (casou em: ${cand.m.palavras.join(', ')})`); }
    await dorme(4000 + Math.floor(5000 * ((Date.now() % 1009) / 1009)));
  }
  return achou;
}

// ═══ DESCOBRIR ═══════════════════════════════════════════════════════════════
// Quando não sobra empresa sem @ pra procurar, ela vai atrás de empresa que a
// gente NUNCA viu — varrendo "energia solar <cidade>" município por município.
// A lista de municípios vem do IBGE na hora; o rastro do que já foi varrido
// fica em prospeccao_varredura, senão ela recomeçaria por Abaetetuba a cada
// reinício e nunca sairia de lá.
// Um termo por rodada, e a cidade só está esgotada quando TODOS passaram.
//
// Antes eram dois termos e a cidade ia pro arquivo morto. São Paulo saiu com 10
// perfis e nunca mais seria visitada, sendo que lá tem milhar de integradora: a
// lupa do Instagram devolve ~10 por consulta, então uma consulta só arranha.
// Termo diferente devolve gente diferente, e é por isso que a chave em
// prospeccao_varredura inclui o termo.
const TERMOS_BUSCA = [
  'energia solar', 'energia fotovoltaica', 'placa solar', 'painel solar',
  'energia solar residencial', 'fotovoltaico', 'solar engenharia', 'usina solar',
];
// Medido em 11/09 na conta logada: a busca devolve no MÁXIMO 5 perfis, e o nome
// da cidade puxa entidade famosa. "energia solar São Paulo" trouxe São Paulo FC,
// Paulo César e a BandNews São Paulo, sobrando 1 vaga de 5 pra empresa de solar.
// "solar Campinas" trouxe 5 empresas em 5.
//
// Por isso o termo cru "solar" saiu daqui: sozinho ele é o que mais colide com
// gente famosa. Quanto mais específico o termo, menos vaga a fama rouba.
// Consequência: cidade gigante rende MENOS por consulta que cidade média, ao
// contrário do que a ordem por população faz supor. A ordem continua certa
// (mercado grande vale mais), mas o ganho por busca lá é pequeno.
// Precisa cheirar a solar E não cheirar a nenhuma destas. Curso, distribuidora,
// fábrica e aquecedor de piscina entram na busca e não compram SolarDoc.
const CHEIRA_SOLAR = /(solar|fotovolt|energia)/;
const NAO_SERVE = new RegExp(['curso','treinamento','aula','professor','mentoria','ensino',
  'distribuidora','atacado','importadora','fabrica','fabricante','industria','consorcio',
  'financiamento','credito','seguro','imobiliaria','aquecedor','aquecimento','boiler',
  'piscina','oficial','noticias','portal','revista','blog'].join('|'));

let CIDADES = null;   // cache por execução: 5.571 municípios não mudam no turno

/**
 * Os municípios do Brasil, DO MAIOR PRO MENOR.
 *
 * A ordem importa mais que parece. A listagem crua do IBGE vem em ordem de
 * código, que começa em Rondônia — ela varreria Alta Floresta D'Oeste, Cabixi e
 * Cerejeiras por semanas antes de chegar em São Paulo. Empresa de solar mora
 * onde mora gente: ordenando por população ela começa em São Paulo, Rio,
 * Brasília e Salvador e desce a cauda, então o melhor lead aparece no primeiro
 * dia e não no centésimo.
 */
async function municipios() {
  if (CIDADES) return CIDADES;
  try {
    const r = await fetch('https://servicodados.ibge.gov.br/api/v3/agregados/6579'
      + '/periodos/2021/variaveis/9324?localidades=N6[all]');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const series = (await r.json())[0].resultados[0].series;
    CIDADES = series.map(x => {
      const [nome, uf] = String(x.localidade.nome).split(' - ');
      return { nome, uf, pop: Number(Object.values(x.serie)[0]) || 0 };
    }).filter(c => c.nome && c.uf).sort((a, b) => b.pop - a.pop);
    return CIDADES;
  } catch (e) {
    // Sem população ela ainda trabalha — só na ordem burra do IBGE. Ordem ruim
    // é muito melhor que parar, que é o que ela nunca pode fazer.
    log('não consegui a população do IBGE (' + e.message + ') — vou na ordem crua');
    const r = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
    if (!r.ok) throw new Error('IBGE respondeu ' + r.status);
    CIDADES = (await r.json()).map(m => ({
      nome: m.nome, pop: 0,
      uf: m.microrregiao?.mesorregiao?.UF?.sigla || m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla,
    })).filter(c => c.uf);
    return CIDADES;
  }
}

/** Varre UMA cidade ainda não varrida. Devolve quantas empresas novas gravou. */
async function descobrir(aba) {
  if (sobramBuscas() <= 0) return 0;   // uma rodada = uma busca; sem orçamento, não começa
  if (!await garantirInstagram(aba)) { log('  não consegui abrir o Instagram pra varrer cidade'); return 0; }

  const todas  = await municipios();
  const feitas = await ler('prospeccao_varredura?select=cidade,uf,termo&limit=50000');
  const jaFoi  = new Set(feitas.map(v => (v.cidade + '|' + v.uf + '|' + (v.termo || '')).toLowerCase()));

  // Cidade grande primeiro, e dentro dela um termo por vez. Assim São Paulo é
  // visitada 8 vezes com consultas diferentes antes de Cabixi ser visitada uma.
  let alvo = null, termo = null;
  for (const c of todas) {
    const falta = TERMOS_BUSCA.find(t => !jaFoi.has((c.nome + '|' + c.uf + '|' + t).toLowerCase()));
    if (falta) { alvo = c; termo = falta; break; }
  }
  if (!alvo) { log(`os ${todas.length} municípios já foram varridos com os ${TERMOS_BUSCA.length} termos.`); return 0; }

  // A lista de destino é a mesma da operação: contato descoberto entra na fila
  // no mesmo lugar dos outros, sem lista paralela pra ninguém esquecer dela.
  const listas = await ler('prospeccao_listas?select=id,nome&status=eq.ativa&produto_id=eq.solardoc&limit=1');
  const listaId = listas[0]?.id;
  if (!listaId) { log('nenhuma lista ativa pra receber os descobertos'); return 0; }

  // Quem já está na base não volta como novidade. O índice único é sobre
  // lower(instagram), e o PostgREST não sabe resolver expressão em on_conflict
  // ("column \"lower\" does not exist", 400) — então a comparação é feita aqui,
  // e o índice fica só como última linha de defesa contra corrida.
  const conhecidos = new Set((await ler('prospeccao_contatos?select=instagram&instagram=not.is.null&limit=20000'))
    .map(c => String(c.instagram || '').toLowerCase()).filter(Boolean));

  let novos = 0, achados = 0, limpas = 0;
  {
    const busca = `${termo} ${alvo.nome}`;
    let r = null;
    try {
      r = await aba.js(`(async () => {
        try {
          const q = await fetch('/web/search/topsearch/?context=blended&query='
            + encodeURIComponent(${JSON.stringify(busca)}),
            { headers: { 'X-IG-App-ID': '936619743392459' } });
          if (!q.ok) return { erro: 'HTTP ' + q.status };
          const j = await q.json();
          return { users: (j.users || []).map(u => ({
            username: u.user && u.user.username, full_name: u.user && u.user.full_name,
            verificado: !!(u.user && u.user.is_verified) })).filter(u => u.username) };
        } catch (e) { return { erro: String(e && e.message || e) }; }
      })()`);
    } catch (e) { r = { erro: e.message }; }
    gastarBusca();

    if (r?.erro) { log(`  busca reclamou (${r.erro}) — deixo ${alvo.nome} pra próxima`); }
    else limpas++;

    for (const u of r?.users || []) {
      achados++;
      const arroba = String(u.username).toLowerCase();
      if (arroba.length < 4 || u.verificado || conhecidos.has(arroba)) continue;
      const txt = normNome(u.username + ' ' + (u.full_name || ''));
      if (!CHEIRA_SOLAR.test(txt) || NAO_SERVE.test(txt)) continue;

      const res = await fetch(`${CFG.supa}/prospeccao_contatos`, {
        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify([{
          lista_id: listaId,
          empresa: String(u.full_name || u.username).slice(0, 120),
          cidade: alvo.nome, uf: alvo.uf,
          instagram: u.username, instagram_em: new Date().toISOString(),
          classe: 'integradora',
          classe_motivo: `descoberta na busca do Instagram por "${busca}"`,
        }]),
      }).catch(() => null);
      conhecidos.add(arroba);
      if (res?.ok) { novos++; log(`  nova: @${u.username} — ${u.full_name || ''} (${alvo.nome}/${alvo.uf})`); }
      else if (res && res.status !== 409) log(`  não gravei @${u.username}: HTTP ${res.status}`);
    }
    await dorme(4000 + Math.floor(6000 * ((Date.now() % 1009) / 1009)));
  }

  // SÓ risca a cidade da lista se a busca REALMENTE rodou. Marcar como varrida
  // depois de um 429 queimaria o município pra sempre — e o propósito desta
  // tabela é justamente não perder o lugar, não perder a cidade.
  if (!limpas) { log(`  ${alvo.nome}/${alvo.uf} não foi varrida (busca falhou) — tento de novo depois`); return 0; }

  await fetch(`${CFG.supa}/prospeccao_varredura`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ cidade: alvo.nome, uf: alvo.uf, termo,
                           encontrados: achados, novos }),
  }).catch(() => {});
  const resta = TERMOS_BUSCA.length - 1 - TERMOS_BUSCA.indexOf(termo);
  log(`varri ${alvo.nome}/${alvo.uf} por "${termo}": ${achados} perfis, ${novos} nova(s)`
    + (resta ? ` · faltam ${resta} termo(s) nesta cidade` : ' · cidade esgotada'));
  return novos;
}

// ═══ MODO CONTÍNUO ═══════════════════════════════════════════════════════════
// Um dia inteiro de trabalho sem ninguém dar comando. Alterna abordar e
// responder, dorme fora da janela, e acorda sozinho no dia seguinte.
//
// Por que alternar em vez de só abordar: quem respondeu vale mais que quem
// ainda não foi falado. Deixar uma resposta esperando 6 horas porque o worker
// está ocupado mandando mensagem fria é perder o lead mais quente do dia.
//
// O ritmo NÃO é fixo. Cada rodada calcula quanto falta da janela e divide pelo
// que sobra do teto — então ele anda devagar de manhã e acelera se você ligar
// tarde. Isso é o oposto de metrônomo, que é o que denuncia robô.
async function modoContinuo() {
  console.log('\n  MODO CONTÍNUO — trabalha sozinho das '
    + (CFG.horaIni === 0 && CFG.horaFim === 24
        ? '24 horas por dia, sem parar'
        : CFG.horaIni + 'h às ' + (CFG.horaFim === 24 ? '23h59' : CFG.horaFim + 'h')) + '.');
  console.log('  Aborda de ' + Math.round(CFG.minSeg / 60) + ' a ' + Math.round(CFG.maxSeg / 60) + ' min.');
  if (CANAL === 'instagram') {
    console.log('  Quem RESPONDE e o webhook da Meta, no servidor — nao este worker.');
    console.log('  Aqui so sai a primeira mensagem de cada empresa.');
  } else {
    console.log('  Confere resposta a cada ' + Math.round(CFG.olharSeg / 60) + ' min.');
  }
  console.log('  Ctrl+C para parar. Deixe esta janela aberta.\n');

  let proximaAbordagem = 0;   // epoch em que pode mandar a próxima fria
  let semAlvo = false;

  for (;;) {
    // NENHUM TROPEÇO ENCERRA O DIA.
    //
    // Em 11/09 o Supabase engasgou por alguns segundos, a leitura do teto
    // falhou nas 3 tentativas, o erro subiu até o topo e o processo MORREU.
    // A janela religava e ela morria de novo em 1 minuto, três vezes seguidas.
    //
    // Agente que precisa rodar 24h não pode morrer de soluço de rede: erro de
    // uma volta vira linha de log e a volta seguinte tenta de novo. O que
    // continua derrubando de propósito é Ctrl+C, que é ordem de gente.
    try {
      const agoraMs = Date.now();
      const h = new Date().getHours();

      // ── fora da janela: dorme até o próximo turno ──────────────────────────
      if (h < CFG.horaIni || (CFG.horaFim < 24 && h >= CFG.horaFim)) {
        const alvo = new Date();
        if (h >= CFG.horaIni) alvo.setDate(alvo.getDate() + 1);
        alvo.setHours(CFG.horaIni, 0, 0, 0);
        const seg = Math.max(60, Math.floor((alvo - new Date()) / 1000));
        log(`fora da janela — dormindo ${Math.round(seg / 60)} min, volto às ${CFG.horaIni}h`);
        await dorme(seg * 1000);
        proximaAbordagem = 0; semAlvo = false;
        continue;
      }

      // ── 1. RESPONDER ──────────────────────────────────────────────────────
      // No Instagram isto NÃO roda mais: quem responde é o webhook da Meta, que
      // recebe a mensagem pronta no servidor e devolve pela API oficial.
      //
      // Ler pelo navegador aqui era pior que inútil — era o que travava o loop.
      // Cada conversa custa ~8s (navegar + esperar) e são 170: mais de 20 minutos
      // por volta, ANTES da primeira mensagem sair. A tela parecia parada porque
      // estava moendo conversa que o webhook já cobre.
      //
      // No WhatsApp continua rodando: lá não existe webhook, e o navegador é o
      // único jeito de saber que alguém respondeu.
      if (CANAL !== 'instagram') {
        try { await modoResponder(); }
        catch (e) { log('rodada de resposta falhou: ' + e.message); }
      }

      // ── 2. ABORDAR, se já passou o intervalo e ainda tem teto ─────────────
      if (Date.now() >= proximaAbordagem) {
        const t = await travas();

        if (t.estado === 'travado') {
          log('DISJUNTOR ARMADO — opt-out alto. Paro de abordar; sigo só respondendo.');
          proximaAbordagem = Date.now() + 3600_000;   // reconfere de hora em hora
        } else if (t.restam <= 0) {
          // TETO FECHADO NÃO É FIM DE EXPEDIENTE. O teto limita ENVIAR, não
          // trabalhar. Enquanto não pode mandar, ela constrói a lista de amanhã —
          // é isso que faz nunca faltar empresa de solar pra abordar.
          if (!semAlvo) {
            log(`teto de envio fechado (${t.usados}/${t.teto}). Sigo construindo a lista até 23h59.`);
            semAlvo = true;
          }
          proximaAbordagem = Date.now() + 600_000;   // reconfere de 10 em 10 min
        } else {
          semAlvo = false;
          let desfecho = 'falhou';
          try { desfecho = await umaAbordagem(); }
          catch (e) { log('abordagem falhou: ' + e.message); }

          // Três desfechos, três esperas. Antes eram dois, e por isso um perfil
          // morto custava 15 minutos de silêncio: ela tratava "falhei com este"
          // igual a "não tem ninguém pra falar".
          //   enviou  intervalo humano de 4 a 15 min, sorteado
          //   falhou  90s e vai pro PRÓXIMO da fila. Não gastou mensagem nem
          //           incomodou ninguém, então não há o que esperar. Uma sequência
          //           de @ mortos custaria horas no ritmo antigo
          //   vazio   15 min, porque insistir em fila vazia só gasta consulta
          const faixa = CFG.maxSeg - CFG.minSeg;
          const espera = desfecho === 'enviou'
            ? CFG.minSeg + Math.floor(faixa * ((Date.now() % 1013) / 1013))
            : desfecho === 'falhou' ? 90 : 900;
          proximaAbordagem = Date.now() + espera * 1000;
          const t2 = await travas();
          log(`${t2.usados}/${t2.teto} abordagens · ${t2.respostas} respostas hoje`
            + ` · próxima abordagem em ${Math.round(espera / 60)} min`);
        }
      }

      // ── 3. CONSTRUIR A LISTA — todo tempo ocioso vira lista ───────────────
      // Roda SEMPRE, não só quando a fila está curta. Duas frentes, nessa ordem:
      //   1) achar o @ de empresa que já está na base (mais barato, mais certeiro)
      //   2) quando não sobra nenhuma, ir atrás de empresa que nunca vimos
      // Assim ela nunca fica sem o que fazer entre 07h e 23h59, e nunca seca.
      if (CANAL === 'instagram' && !DRY) {
        let aba = null;
        try {
          aba = await Aba.abrir(CFG.cdp);
          const achou = await reabastecer(aba, 5);
          if (achou) log(`achei @ de ${achou} empresa(s) que já estavam na base`);
          else await descobrir(aba);
        } catch (e) { log('construção da lista falhou: ' + e.message); }
        finally { if (aba) await aba.fechar(); }
      }

      // ── 4. dorme pouco e volta ────────────────────────────────────────────
      await dorme(CFG.olharSeg * 1000);
    } catch (e) {
      log(`a volta tropeçou (${e.message}) — sigo na próxima`);
      await dorme(30000);
    }
  }
}

// ═══ LOOP ════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ${(MODO === 'responder' ? 'RESPONDENDO' : 'ABORDANDO').padEnd(11)} · ${CANAL.toUpperCase().padEnd(9)} ${(DRY ? 'ENSAIO (não envia)' : 'ENVIANDO DE VERDADE').padEnd(19)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (MODO === 'responder') return await modoResponder();
  if (MODO === 'continuo')  return await modoContinuo();

  const t0 = await travas();
  log(`conta ${CFG.consultor} · assina como "${CFG.assinatura}" · teto ${t0.usados}/${t0.teto} · opt-out ${t0.taxa}% (${t0.estado})`);
  if (t0.porque) log(`  ${t0.porque}`);
  log('  janela ' + (CFG.horaIni === 0 && CFG.horaFim === 24
    ? '24h por dia' : `${CFG.horaIni}h–${CFG.horaFim === 24 ? '23h59' : CFG.horaFim + 'h'}`));
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
    // Com janela de 24h nao existe "fim do expediente": o horizonte e sempre as
    // proximas 24h. Sem isto, as 23h50 ela acharia que sobram 10 minutos pra
    // gastar o teto inteiro e despejaria tudo de uma vez.
    const fimJanela = new Date();
    if (CFG.horaIni === 0 && CFG.horaFim === 24) fimJanela.setTime(Date.now() + 86400_000);
    else fimJanela.setHours(CFG.horaFim, 0, 0, 0);
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
