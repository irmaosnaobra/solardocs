/* Central de Automacao, abas Publicar e Comentarios (fase 1 de "Automacao como centro das redes").
   - Publicar: um video, ate tres destinos (Reels do Instagram, Reels do Facebook, Status do WhatsApp).
     O navegador envia o arquivo DIRETO ao Storage (PUT na URL assinada) e depois faz UMA chamada por rede.
   - Comentarios: caixa de uma rede por vez, com o que o robo ja fez e a resposta de gente (1 por comentario).
   - Quem trava e o servidor (api/src/routes/geradorRedes.ts). Esta tela so mostra as regras e o estado.
   - Tudo nasce desligado por env: resposta de desligado vira aviso neutro, nunca erro vermelho.
   - Texto vindo da API entra so por textContent. Link so se for https.
   Cor: tokens de io2.css (--n-*, --io-*) com a paleta escura do visual antigo como reserva (la o io2.css nao vale).
   Entrada global: window.autoRedes.mostrar('publicar'|'comentarios') e .esconder(); o index.html chama pelo nome.
   Fora do link do cliente (?p=) e do PDF (pdf=1) nada disto roda. */
(function () {
  'use strict';
  var q = location.search || '';
  if (/[?&]p=/.test(q) || /[?&]pdf=1(&|$)/.test(q)) return;

  var API = (location.hostname === 'localhost' ? 'http://localhost:3001' : '/_api') + '/gerador/redes';
  var MB = 1024 * 1024;
  var VIDEO_MAX = 50 * MB;       /* vale para Reels */
  var STATUS_MAX = 10 * MB;      /* Status do WhatsApp */
  var LEGENDA_MAX = 2200;
  var LEGENDA_STATUS = 900;
  var RESPOSTA_MAX = 1000;
  var AVANCO_MS = 60 * 1000;     /* o servidor so le o conteiner 1 vez por minuto */

  var REDES = [
    { id: 'instagram', nome: 'Instagram (Reels)', conta: 'o Instagram' },
    { id: 'facebook', nome: 'Facebook (Reels)', conta: 'a Página' },
    { id: 'status', nome: 'Status do WhatsApp', conta: 'o celular da linha' }
  ];
  function redeDe(id) { for (var i = 0; i < REDES.length; i++) if (REDES[i].id === id) return REDES[i]; return null; }

  /* ---------------------------------------------------------------- utilidades */
  function noop() {}
  function criar(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild); }
  function tokenAtual() {
    try { if (typeof sessaoAtual !== 'undefined' && sessaoAtual && sessaoAtual.access_token) return String(sessaoAtual.access_token); } catch (e) {}
    try { var s = JSON.parse(localStorage.getItem('irmaos-na-obra-sessao-v1') || 'null'); return (s && s.access_token) ? String(s.access_token) : ''; } catch (e2) {}
    return '';
  }
  function renovar() {
    try { if (typeof authRenovarSePreciso === 'function') return Promise.resolve(authRenovarSePreciso()).catch(noop); } catch (e) {}
    return Promise.resolve();
  }
  /* Geracao da sessao: sobe quando a conta sai (io2-sessao-limpa). Uma chamada que nasceu antes e volta depois NUNCA
     fala (a promessa fica parada): nada do que ela traria pode cair na tela da pessoa seguinte. */
  var ger = 0;
  var ativas = [];                 /* AbortController das chamadas em voo: o logout aborta todas */
  var PRAZO_MS = 20000;            /* nenhuma chamada fica pendurada: depois disto vira "sem conexao" */
  /* Uma chamada, nunca rejeita: { status, j }. status 0 = sem conexao (ou prazo estourado). */
  function chamar(metodo, caminho, corpo) {
    var g0 = ger;
    function parada() { return new Promise(noop); }
    return renovar().then(function () {
      if (g0 !== ger) return parada();
      var tok = tokenAtual();
      if (!tok) return { status: 401, j: null, semToken: true };
      var o = { method: metodo, headers: { 'Authorization': 'Bearer ' + tok } };
      if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
      var ac = typeof AbortController === 'function' ? new AbortController() : null;
      var to = 0;
      if (ac) { o.signal = ac.signal; ativas.push(ac); to = setTimeout(function () { try { ac.abort(); } catch (e) {} }, PRAZO_MS); }
      function fim() { if (to) clearTimeout(to); if (ac) { var i = ativas.indexOf(ac); if (i >= 0) ativas.splice(i, 1); } }
      return fetch(API + caminho, o).then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          return { status: r.status, j: (j && typeof j === 'object' && !Array.isArray(j)) ? j : null };
        });
      }).then(function (x) { fim(); return g0 !== ger ? parada() : x; }, function () { fim(); return g0 !== ger ? parada() : { status: 0, j: null }; });
    }).then(function (r) { return r; }, function () { return g0 !== ger ? parada() : { status: 0, j: null }; });
  }
  function cssEsc(v) { return (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(v) : String(v).replace(/[^0-9A-Za-z_-]/g, '\\$&'); }
  function msgDe(j) { return j ? String(j.mensagem || j.error || '') : ''; }
  function httpsOuNada(u) { u = String(u || ''); return /^https:\/\//i.test(u) ? u : ''; }

  var FMT_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  function hora(d) { return FMT_HORA.format(d); }
  function dia(d) { return FMT_DIA.format(d); }
  function ddmm(d) { var s = dia(d); return s.slice(8, 10) + '/' + s.slice(5, 7); }
  function dataValida(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? null : d; }
  /* "Abre às 14:32." (hoje), "Abre amanhã às 00:00." ou "Abre em 15/10 às 09:00." */
  function quandoAbre(iso) {
    var d = dataValida(iso); if (!d) return '';
    var h = hora(d), alvo = dia(d);
    if (alvo === dia(new Date())) return 'Abre às ' + h + '.';
    if (alvo === dia(new Date(Date.now() + 864e5))) return 'Abre amanhã às ' + h + '.';
    return 'Abre em ' + ddmm(d) + ' às ' + h + '.';
  }
  function quandoFoi(iso) { var d = dataValida(iso); return d ? ddmm(d) + ' às ' + hora(d) : ''; }
  function tam(b) { return b >= MB ? (b / MB).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function duracao(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function milhar(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* ---------------------------------------------------------------- CSS (uma vez) */
  function garantirCss() {
    if (document.getElementById('ar-css')) return;
    var st = document.createElement('style');
    st.id = 'ar-css';
    st.textContent = [
      '#automacaoSection.ar-larga{max-width:none}',
      '.ar{--ar-tx:var(--n-tx,#E5E7EB);--ar-tx2:var(--n-tx2,#B4C0D1);--ar-sf:var(--n-sf,#1E293B);--ar-sf2:var(--n-sf2,#182338);--ar-bd:var(--n-bd,#334155);--ar-campo:var(--io-borda-campo,#7384A0);',
      '--ar-ok:var(--io-ok-fg,#4ADE80);--ar-ok-sf:var(--io-ok-sf,rgba(74,222,128,.14));--ar-ok-bd:var(--io-ok-bd,rgba(74,222,128,.4));',
      '--ar-er:var(--io-er-fg,#FCA5A5);--ar-er-sf:var(--io-er-sf,rgba(248,113,113,.14));--ar-er-bd:var(--io-er-bd,rgba(248,113,113,.4));',
      '--ar-av:var(--io-ambar-tx,#FBBF24);--ar-av-sf:var(--io-av-sf,rgba(251,191,36,.14));--ar-av-bd:var(--io-ambar-bd,rgba(251,191,36,.45));',
      '--ar-in:var(--io-azul-tx,#93C5FD);--ar-in-sf:var(--io-azul-sf,rgba(96,165,250,.16));--ar-marcado:var(--io-marcado,#2563EB);--ar-tit:var(--io-titulo,#fff);',
      'display:block;min-width:0;color:var(--ar-tx)}',
      '.ar *,.ar *::before,.ar *::after{box-sizing:border-box}',
      '.ar [hidden]{display:none!important}',
      '.ar-grade2{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}',
      '.ar-grade3{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:12px}',
      '.ar-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr));gap:12px;align-items:start}',
      '.ar-cartao,.ar-card-rede,.ar-com,.ar-vazio{background:var(--ar-sf);border:1px solid var(--ar-bd);border-radius:14px;padding:16px;min-width:0}',
      '.ar-secao{margin-top:20px;min-width:0}',
      '.ar-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 12px}',
      '.ar-tit{margin:0;font-size:15px;font-weight:800;color:var(--ar-tit)}',
      '.ar-aviso{border:1px solid var(--ar-av-bd);background:var(--ar-av-sf);color:var(--ar-av);border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.45;margin-bottom:14px;overflow-wrap:anywhere}',
      '.ar-aviso.neutro{border-color:var(--ar-bd);background:var(--ar-sf2);color:var(--ar-tx2)}',
      '.ar-zona{border:1.5px dashed var(--ar-campo);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;min-width:0}',
      '.ar-zona.arrasta{border-style:solid;background:var(--ar-in-sf)}',
      '.ar-dica,.ar-nota,.ar-contador,.ar-meta{font-size:12.5px;line-height:1.45;color:var(--ar-tx2);overflow-wrap:anywhere}',
      '.ar-previa{margin-top:12px;min-width:0}',
      '.ar-previa video{display:block;width:100%;max-height:320px;background:#000;border-radius:10px;object-fit:contain}',
      '.ar-meta{margin-top:8px}.ar-meta b{color:var(--ar-tx);font-weight:700}',
      '.ar-msg{font-size:13px;line-height:1.45;margin-top:8px;overflow-wrap:anywhere;color:var(--ar-tx2)}',
      '.ar-msg.er{color:var(--ar-er)}.ar-msg.av{color:var(--ar-av)}.ar-msg.ok{color:var(--ar-ok)}',
      '.ar-contador{margin-top:6px}.ar-contador.er{color:var(--ar-er);font-weight:700}',
      '.ar-rede{display:flex;gap:12px;align-items:flex-start;padding:10px 0;min-height:44px;border-top:1px solid var(--ar-bd);cursor:pointer}',
      '.ar-rede:first-of-type{border-top:0}',
      '.ar-rede input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--ar-marcado)}',
      '.ar-rede.off{cursor:not-allowed}.ar-rede.off input{opacity:.55}',
      '.ar-rede-txt{min-width:0;flex:1}.ar-rede-txt strong{display:block;font-size:14px;color:var(--ar-tit)}',
      '.ar-lim{display:block;font-size:12.5px;line-height:1.4;color:var(--ar-tx2);margin-top:2px;overflow-wrap:anywhere}',
      '.ar-lim.ok{color:var(--ar-ok)}.ar-lim.av{color:var(--ar-av)}',
      '.ar-regras{margin:12px 0 0;padding:12px 14px;border-radius:10px;background:var(--ar-sf2);border:1px solid var(--ar-bd);font-size:12.5px;line-height:1.5;color:var(--ar-tx2)}',
      '.ar-regras p{margin:0 0 6px}.ar-regras p:last-child{margin:0}.ar-regras b{color:var(--ar-tx)}',
      '.ar-acoes{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px}',
      '.ar .auto-btn{min-height:44px}',
      /* botao desligado com texto legivel nos dois visuais (o io2 apaga o texto do desligado ate 1,2:1 no tema escuro) */
      '#automacaoSection .ar .auto-btn:disabled:not(#_):not(#_):not(#_):not(#_){opacity:1;background:var(--ar-sf2);color:var(--ar-tx2);border:1px solid var(--ar-bd);cursor:not-allowed;transition:none}',
      '.ar-card-rede{display:flex;flex-direction:column;gap:8px}',
      '.ar-card-cab{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
      '.ar-card-cab strong{font-size:14px;color:var(--ar-tit)}',
      '.ar-card-rede p{margin:0;font-size:13px;line-height:1.45;color:var(--ar-tx);overflow-wrap:anywhere}',
      '.ar-card-rede .auto-prog{margin-top:2px}',
      '.ar-link{color:var(--ar-in);font-weight:700;font-size:13px;overflow-wrap:anywhere}',
      '.ar-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid var(--ar-bd);background:var(--ar-sf2);color:var(--ar-tx);white-space:nowrap}',
      '.ar-badge.ok{background:var(--ar-ok-sf);border-color:var(--ar-ok-bd);color:var(--ar-ok)}',
      '.ar-badge.er{background:var(--ar-er-sf);border-color:var(--ar-er-bd);color:var(--ar-er)}',
      '.ar-badge.av{background:var(--ar-av-sf);border-color:var(--ar-av-bd);color:var(--ar-av)}',
      '.ar-badge.in{background:var(--ar-in-sf);border-color:var(--ar-in);color:var(--ar-in)}',
      '.ar-hist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.ar-hist li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:start;background:var(--ar-sf);border:1px solid var(--ar-bd);border-radius:12px;padding:12px 14px;min-width:0}',
      '.ar-hist .ar-h-corpo{min-width:0;font-size:13px;line-height:1.45;overflow-wrap:anywhere}',
      '.ar-hist .ar-h-corpo strong{color:var(--ar-tit)}',
      '.ar-hist .ar-h-sub{color:var(--ar-tx2);font-size:12.5px}',
      '.ar-barra{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
      '.ar-chip{min-height:44px;padding:8px 18px;border-radius:999px;border:1px solid var(--ar-campo);background:transparent;color:var(--ar-tx);font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
      '.ar-chip[aria-pressed="true"]{background:var(--ar-marcado);border-color:var(--ar-marcado);color:var(--n-inv,#fff)}',
      '.ar-atual{font-size:12.5px;color:var(--ar-tx2);margin-left:auto}',
      '.ar-com{display:flex;flex-direction:column;gap:8px}',
      '.ar-com-cab{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline}',
      '.ar-com-cab strong{color:var(--ar-tit);font-size:14px;overflow-wrap:anywhere}',
      '.ar-com-cab span{font-size:12.5px;color:var(--ar-tx2)}',
      '.ar-com-txt{margin:0;font-size:14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.ar-motor,.ar-gente{font-size:12.5px;line-height:1.45;color:var(--ar-tx2);border-top:1px dashed var(--ar-bd);padding-top:8px}',
      '.ar-gente.ok{color:var(--ar-ok)}.ar-gente.av{color:var(--ar-av)}',
      '.ar-resp textarea{display:block;width:100%;min-height:64px;resize:vertical}',
      '.ar-resp .ar-resp-linha{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:6px}',
      '.ar-resp .ar-contador{margin:0}',
      '.ar-vazio{text-align:center;color:var(--ar-tx2);font-size:14px;padding:28px 16px}',
      '.ar .ar-so-leitor{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.ar :is(button,input,textarea):focus-visible,.ar .ar-rede:focus-within{outline:2px solid var(--ar-in);outline-offset:2px}',
      '@media (max-width:860px){.ar-grade2{grid-template-columns:minmax(0,1fr)}.ar-atual{margin-left:0;width:100%}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- limites (um GET, as duas abas leem) */
  var L = null;            /* ultima resposta de /limites */
  var Lerro = '';          /* frase quando nao deu para ler */
  var Lcarregando = null;
  var semEquipe = false;   /* o servidor respondeu 403 precisa:'equipe' */
  function carregarLimites() {
    if (Lcarregando) return Lcarregando;
    Lcarregando = chamar('GET', '/limites').then(function (r) {
      if (r.status === 200 && r.j && r.j.ok) { L = r.j; Lerro = ''; }
      else if (r.status === 403 && r.j && r.j.precisa === 'equipe') { Lerro = 'Esta tela é só para a equipe.'; semEquipe = true; }
      else if (r.status === 401) { Lerro = 'Sua sessão venceu. Entre de novo para usar esta tela.'; }
      else { Lerro = 'Não consegui conferir os limites agora. O servidor confere de novo na hora de publicar.'; }
      Lcarregando = null;
      redesenharLimites();
      /* Quem não é da equipe não tem o que fazer em Publicar nem em Comentários: vai para a aba Instagram (a de hoje). */
      if (semEquipe && ((P.pane && paneVisivel(P.pane)) || (C.pane && paneVisivel(C.pane))) && typeof window.automacaoSubaba === 'function') window.automacaoSubaba('instagram');
    });
    return Lcarregando;
  }
  function limitePub(id) { return !L ? null : (id === 'status' ? L.status : (L[id] && L[id].publicar)) || null; }
  function limiteResp(id) { return (L && L[id] && L[id].responder) || null; }
  /* { texto, tom } a partir de um bloco { ligado, pode, mensagem, abre_em } */
  function fraseLimite(b, extra) {
    if (!b) return { texto: Lerro || 'Conferindo os limites…', tom: '' };
    if (b.ligado === false) return { texto: 'Desligado por enquanto.', tom: '' };
    if (b.pode) return { texto: 'Pode agora.' + (extra ? ' ' + extra : ''), tom: 'ok' };
    var partes = [quandoAbre(b.abre_em), b.mensagem ? String(b.mensagem) : ''].filter(Boolean);
    return { texto: (partes.join(' ') || 'Não pode agora.') + (extra ? ' ' + extra : ''), tom: 'av' };
  }
  function redesenharLimites() {
    if (P.montado) { desenharRedes(); desenharBotao(); desenharAviso(); }
    if (C.montado) { desenharTopo(); desenharLista(); }
  }

  /* ================================================================ PUBLICAR */
  var P = { montado: false, chk: {}, lim: {}, rotulo: {} };
  function novoS() { return { video: null, arqId: 0, ocupado: false, cards: {}, pend: {}, hist: null, histErro: '', poll: null, urlPrevia: '' }; }
  var S = novoS();
  var xhrAtual = null;

  function montarPublicar(pane) {
    var raiz = criar('div', 'ar'); pane.appendChild(raiz); P.pane = pane;
    P.aviso = criar('div', 'ar-aviso'); P.aviso.hidden = true; P.aviso.setAttribute('role', 'status'); raiz.appendChild(P.aviso);
    var grade = criar('div', 'ar-grade2'); raiz.appendChild(grade);

    /* cartao 1: video e legenda */
    var c1 = criar('section', 'ar-cartao'); grade.appendChild(c1);
    c1.appendChild(criar('h3', 'ar-tit', 'Vídeo e legenda')); c1.firstChild.style.marginBottom = '12px';
    P.zona = criar('div', 'ar-zona'); c1.appendChild(P.zona);
    P.arquivo = criar('input'); P.arquivo.type = 'file'; P.arquivo.id = 'ar-arquivo'; P.arquivo.hidden = true;
    P.arquivo.accept = 'video/mp4,video/quicktime,.mp4,.mov';
    P.btnEscolher = criar('button', 'auto-btn', 'Escolher vídeo'); P.btnEscolher.type = 'button';
    P.zona.appendChild(P.arquivo); P.zona.appendChild(P.btnEscolher);
    P.zona.appendChild(criar('div', 'ar-dica', 'Vídeo mp4 ou mov, até 50 MB. Também dá para arrastar o arquivo até aqui.'));
    P.erroVideo = criar('div', 'ar-msg er'); P.erroVideo.hidden = true; P.erroVideo.setAttribute('role', 'alert'); c1.appendChild(P.erroVideo);
    P.previa = criar('div', 'ar-previa'); P.previa.hidden = true; c1.appendChild(P.previa);
    P.video = criar('video'); P.video.controls = true; P.video.preload = 'metadata'; P.video.setAttribute('playsinline', ''); P.video.muted = true;
    P.previa.appendChild(P.video);
    P.semPrevia = criar('div', 'ar-msg', 'Este aparelho não consegue mostrar a prévia deste vídeo. O envio funciona do mesmo jeito.'); P.semPrevia.hidden = true; P.previa.appendChild(P.semPrevia);
    P.meta = criar('div', 'ar-meta'); P.previa.appendChild(P.meta);
    var lbl = criar('label', 'auto-lbl', 'Legenda'); lbl.htmlFor = 'ar-legenda'; lbl.style.marginTop = '14px'; c1.appendChild(lbl);
    P.legenda = criar('textarea', 'auto-ta'); P.legenda.id = 'ar-legenda'; P.legenda.rows = 5; P.legenda.maxLength = LEGENDA_MAX;
    P.legenda.placeholder = 'Escreva a legenda que vai junto com o vídeo.'; c1.appendChild(P.legenda);
    P.contador = criar('div', 'ar-contador'); c1.appendChild(P.contador);

    /* cartao 2: onde publicar */
    var c2 = criar('section', 'ar-cartao'); grade.appendChild(c2);
    var cab2 = criar('div', 'ar-cab'); c2.appendChild(cab2);
    cab2.appendChild(criar('h3', 'ar-tit', 'Onde publicar'));
    P.btnLimites = criar('button', 'auto-btn ghost', 'Atualizar limites'); P.btnLimites.type = 'button'; cab2.appendChild(P.btnLimites);
    var grupo = criar('div'); grupo.setAttribute('role', 'group'); grupo.setAttribute('aria-label', 'Redes'); c2.appendChild(grupo);
    REDES.forEach(function (r) {
      var lb = criar('label', 'ar-rede');
      var ck = criar('input'); ck.type = 'checkbox'; ck.id = 'ar-rede-' + r.id; ck.value = r.id;
      var tx = criar('span', 'ar-rede-txt'); tx.appendChild(criar('strong', null, r.nome));
      var lim = criar('span', 'ar-lim'); tx.appendChild(lim);
      lb.appendChild(ck); lb.appendChild(tx); grupo.appendChild(lb);
      P.chk[r.id] = ck; P.lim[r.id] = lim; P.rotulo[r.id] = lb;
      ck.addEventListener('change', function () { desenharBotao(); desenharContador(); });
    });
    var regras = criar('div', 'ar-regras'); c2.appendChild(regras);
    [['Status do WhatsApp: ', 'até 3 por dia (1 por dia na primeira semana), 2 horas entre um e outro, das 9h às 20h de segunda a sábado. Vídeo até 10 MB, só mp4, e legenda até 900 caracteres.'],
     ['Reels: ', '30 minutos entre publicações em cada conta, e o mesmo vídeo só 1 vez por conta.']].forEach(function (p) {
      var el = criar('p'); el.appendChild(criar('b', null, p[0])); el.appendChild(document.createTextNode(p[1])); regras.appendChild(el);
    });
    var ac = criar('div', 'ar-acoes'); c2.appendChild(ac);
    P.btnPublicar = criar('button', 'auto-btn', 'Publicar'); P.btnPublicar.type = 'button'; ac.appendChild(P.btnPublicar);
    P.dicaBtn = criar('span', 'ar-dica'); P.dicaBtn.setAttribute('aria-live', 'polite'); ac.appendChild(P.dicaBtn);

    /* andamento */
    P.secAnd = criar('section', 'ar-secao'); P.secAnd.hidden = true; raiz.appendChild(P.secAnd);
    P.secAnd.appendChild(criar('h3', 'ar-tit', 'Andamento')); P.secAnd.firstChild.style.marginBottom = '12px';
    P.cards = criar('div', 'ar-grade3'); P.cards.setAttribute('aria-live', 'polite'); P.secAnd.appendChild(P.cards);

    /* historico */
    var sh = criar('section', 'ar-secao'); raiz.appendChild(sh);
    var cabh = criar('div', 'ar-cab'); sh.appendChild(cabh);
    cabh.appendChild(criar('h3', 'ar-tit', 'Histórico recente'));
    P.btnHist = criar('button', 'auto-btn ghost', 'Atualizar'); P.btnHist.type = 'button'; cabh.appendChild(P.btnHist);
    P.hist = criar('div'); sh.appendChild(P.hist);

    /* eventos */
    P.btnEscolher.addEventListener('click', function () { P.arquivo.click(); });
    P.arquivo.addEventListener('change', function () { var f = P.arquivo.files && P.arquivo.files[0]; escolherVideo(f); P.arquivo.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) { P.zona.addEventListener(n, function (e) { e.preventDefault(); P.zona.classList.add('arrasta'); }); });
    ['dragleave', 'drop'].forEach(function (n) { P.zona.addEventListener(n, function (e) { e.preventDefault(); P.zona.classList.remove('arrasta'); }); });
    P.zona.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) escolherVideo(f); });
    P.legenda.addEventListener('input', function () { desenharContador(); desenharBotao(); });
    P.btnPublicar.addEventListener('click', publicar);
    P.btnLimites.addEventListener('click', function () { carregarLimites(); });
    P.btnHist.addEventListener('click', function () { carregarHist(); });
    P.video.addEventListener('loadedmetadata', function () {
      if (S.video && isFinite(P.video.duration) && P.video.duration > 0) { S.video.duracao = P.video.duration; desenharMeta(); }
    });
    P.video.addEventListener('error', function () { if (S.video) { S.video.semPrevia = true; desenharVideo(); } });
    P.montado = true;
    desenharVideo(); desenharContador(); desenharRedes(); desenharBotao(); desenharAviso(); desenharHist();
  }

  /* ---- video escolhido */
  function extDe(file) {
    var m = /\.([A-Za-z0-9]+)$/.exec(file.name || ''); var e = m ? m[1].toLowerCase() : '';
    if (e === 'mp4' || e === 'mov') return e;
    if (/^video\/quicktime$/.test(file.type)) return 'mov';
    if (/^video\/mp4$/.test(file.type)) return 'mp4';
    return '';
  }
  function erroDoVideo(t) { P.erroVideo.textContent = t || ''; P.erroVideo.hidden = !t; }
  function escolherVideo(file) {
    if (!file || S.ocupado) return;
    var ext = extDe(file);
    if (!ext) return erroDoVideo('Escolha um vídeo mp4 ou mov.');
    if (!file.size) return erroDoVideo('O arquivo está vazio.');
    if (file.size > VIDEO_MAX) return erroDoVideo('O vídeo passa de 50 MB. Este tem ' + tam(file.size) + '.');
    erroDoVideo('');
    if (S.urlPrevia) { try { URL.revokeObjectURL(S.urlPrevia); } catch (e) {} }
    S.urlPrevia = URL.createObjectURL(file);
    S.arqId += 1;
    S.video = { file: file, ext: ext, duracao: null, semPrevia: false };
    P.video.src = S.urlPrevia;
    if (P.chk.status.checked && statusMotivo()) P.chk.status.checked = false;
    desenharVideo(); desenharRedes(); desenharBotao(); desenharContador();
  }
  function tipoDe(file, ext) { return file.type || (ext === 'mov' ? 'video/quicktime' : 'video/mp4'); }
  function desenharMeta() {
    limpar(P.meta);
    if (!S.video) return;
    var f = S.video.file;
    var n = criar('b', null, f.name); P.meta.appendChild(n);
    P.meta.appendChild(document.createTextNode(' · ' + tam(f.size) + (S.video.duracao ? ' · ' + duracao(S.video.duracao) : '')));
  }
  function desenharVideo() {
    P.previa.hidden = !S.video;
    if (!S.video) { P.btnEscolher.textContent = 'Escolher vídeo'; return; }
    P.video.hidden = !!S.video.semPrevia;
    P.semPrevia.hidden = !S.video.semPrevia;
    P.btnEscolher.textContent = 'Trocar vídeo';
    desenharMeta();
  }
  function desenharContador() {
    var n = P.legenda.value.length, st = P.chk.status && P.chk.status.checked;
    var passou = st && n > LEGENDA_STATUS;
    P.contador.textContent = milhar(n) + ' de ' + milhar(LEGENDA_MAX) + ' caracteres. O Status do WhatsApp aceita até ' + LEGENDA_STATUS + '.';
    P.contador.className = 'ar-contador' + (passou ? ' er' : '');
  }

  /* ---- redes: marcar, bloquear, mostrar limite */
  var TRAVA = { enviando: 1, pedido: 1, aguardando: 1, processando: 1, publicado: 1, aceito: 1, incerto: 1 };
  function statusMotivo() {
    if (!S.video) return '';
    if (S.video.ext === 'mov') return 'O Status do WhatsApp só aceita vídeo mp4.';
    if (S.video.file.size > STATUS_MAX) return 'Acima de 10 MB o Status fica desligado. Este vídeo tem ' + tam(S.video.file.size) + '.';
    return '';
  }
  function bloqueio(id) {
    var b = limitePub(id);
    if (b && b.ligado === false) return 'Desligado por enquanto.';
    if (id === 'status') { var m = statusMotivo(); if (m) return m; }
    var c = S.cards[id];
    if (c && c.arq === S.arqId && TRAVA[c.fase]) {
      if (c.fase === 'enviando' || c.fase === 'pedido') return 'Enviando agora.';
      if (c.fase === 'aguardando' || c.fase === 'processando') return 'Em andamento com este vídeo. Espere terminar.';
      return 'Já enviado com este vídeo. Para publicar de novo, escolha outro vídeo.';
    }
    return '';
  }
  function desenharRedes() {
    REDES.forEach(function (r) {
      var ck = P.chk[r.id], bl = bloqueio(r.id), lim;
      if (bl) { lim = { texto: bl, tom: '' }; }
      else {
        var b = limitePub(r.id), extra = '';
        if (r.id === 'status' && b && b.hoje && b.hoje.usados != null && b.hoje.teto != null) extra = 'Hoje: ' + b.hoje.usados + ' de ' + b.hoje.teto + '.';
        lim = fraseLimite(b, extra);
      }
      ck.disabled = !!bl || S.ocupado;
      if (bl && ck.checked) ck.checked = false;
      P.rotulo[r.id].classList.toggle('off', !!bl);
      P.lim[r.id].textContent = lim.texto;
      P.lim[r.id].className = 'ar-lim' + (lim.tom ? ' ' + lim.tom : '');
    });
  }
  function todasDesligadas() {
    return !!L && REDES.every(function (r) { var b = limitePub(r.id); return b && b.ligado === false; });
  }
  function desenharAviso() {
    var t = '', neutro = true;
    if (todasDesligadas()) t = 'A publicação nas redes está desligada por enquanto. Quando a equipe ligar, ela passa a funcionar aqui.';
    else if (Lerro) t = Lerro;
    P.aviso.textContent = t; P.aviso.hidden = !t;
    P.aviso.className = 'ar-aviso' + (neutro ? ' neutro' : '');
  }
  function marcadas() { return REDES.filter(function (r) { return P.chk[r.id].checked && !P.chk[r.id].disabled; }); }
  function motivoBotao() {
    if (S.ocupado) return 'Publicando…';
    if (todasDesligadas()) return 'A publicação está desligada por enquanto.';
    if (!S.video) return 'Escolha um vídeo.';
    var m = marcadas();
    if (!m.length) return 'Marque pelo menos uma rede.';
    var n = P.legenda.value.length;
    if (P.chk.status.checked && n > LEGENDA_STATUS) return 'A legenda do Status tem no máximo ' + LEGENDA_STATUS + ' caracteres. Hoje tem ' + milhar(n) + '.';
    return '';
  }
  function desenharBotao() {
    var m = motivoBotao();
    P.btnPublicar.disabled = !!m;
    P.btnPublicar.textContent = S.ocupado ? 'Publicando…' : 'Publicar';
    P.dicaBtn.textContent = S.ocupado ? '' : m;
    P.btnEscolher.disabled = S.ocupado;
    P.legenda.disabled = S.ocupado;
  }

  /* ---- cartoes de andamento */
  var FASES = {
    enviando: { rot: 'Enviando vídeo', tom: 'in' }, pedido: { rot: 'Enviando pedido', tom: 'in' },
    aguardando: { rot: 'Aguardando', tom: 'av' }, processando: { rot: 'Processando', tom: 'in' },
    publicado: { rot: 'Publicado', tom: 'ok' }, aceito: { rot: 'Pedido aceito', tom: 'ok' },
    nao_saiu: { rot: 'Não saiu', tom: 'er' }, desligado: { rot: 'Desligado', tom: '' }
  };
  function rotuloFase(c) {
    if (c.fase === 'incerto') return c.rede === 'facebook' ? 'Confira a Página' : (c.rede === 'instagram' ? 'Confira o Instagram' : 'Confira o celular');
    return (FASES[c.fase] || { rot: c.fase }).rot;
  }
  function tomFase(c) { return c.fase === 'incerto' ? 'av' : (FASES[c.fase] || { tom: '' }).tom; }
  function textoPadrao(c) {
    var r = redeDe(c.rede);
    switch (c.fase) {
      case 'enviando': return 'Enviando o vídeo… ' + (c.pct || 0) + '%';
      case 'pedido': return 'Mandando o pedido.';
      case 'aguardando': return 'A Meta está processando o vídeo. Confiro de novo a cada minuto enquanto esta tela estiver aberta.';
      case 'processando': return 'Publicando.';
      case 'publicado': return c.rede === 'instagram' ? 'Publicado no Instagram.' : 'Publicado na Página.';
      case 'aceito': return 'O pedido foi aceito. Confira no celular da linha se o status apareceu.';
      case 'incerto': return 'Não sei se saiu. Confira ' + r.conta + ' antes de subir de novo.';
      case 'nao_saiu': return 'Não saiu. Nada foi publicado.';
      default: return '';
    }
  }
  var LINK_IG = /^https:\/\/(www\.)?instagram\.com\//;
  /* Instagram: só o permalink que o servidor devolve E que é mesmo do instagram.com (https). Facebook: só pelo media_id
     validado. Nenhum outro campo da resposta (link, url) vira endereço. */
  function linkDe(c) {
    if (c.rede === 'instagram') return typeof c.link === 'string' && LINK_IG.test(c.link) ? c.link : '';
    if (c.rede === 'facebook' && c.media_id && /^[0-9A-Za-z_-]+$/.test(c.media_id)) return 'https://www.facebook.com/reel/' + encodeURIComponent(c.media_id);
    return '';
  }
  function desenharCards() {
    var ids = REDES.filter(function (r) { return S.cards[r.id]; });
    P.secAnd.hidden = !ids.length;
    limpar(P.cards);
    ids.forEach(function (r) {
      var c = S.cards[r.id], tom = tomFase(c);
      var art = criar('article', 'ar-card-rede'); art.setAttribute('data-rede', r.id);
      var cab = criar('div', 'ar-card-cab'); art.appendChild(cab);
      cab.appendChild(criar('strong', null, r.nome));
      cab.appendChild(criar('span', 'ar-badge' + (tom ? ' ' + tom : ''), rotuloFase(c)));
      art.appendChild(criar('p', null, c.texto || textoPadrao(c)));
      if (c.fase === 'enviando') {
        var pr = criar('div', 'auto-prog'); pr.setAttribute('role', 'progressbar'); pr.setAttribute('aria-valuemin', '0'); pr.setAttribute('aria-valuemax', '100');
        pr.setAttribute('aria-valuenow', String(c.pct || 0)); pr.setAttribute('aria-label', 'Envio do vídeo');
        var barra = criar('div'); barra.style.width = (c.pct || 0) + '%'; pr.appendChild(barra); art.appendChild(pr);
      }
      if (c.abre) art.appendChild(criar('p', 'ar-nota', c.abre));
      if (c.fase === 'publicado') {
        var u = linkDe(c);
        if (u) { var a = criar('a', 'ar-link', 'Abrir a publicação'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; art.appendChild(a); }
        else if (c.rede === 'instagram') art.appendChild(criar('p', 'ar-nota', 'O Instagram não devolveu o link do Reel. Abra o perfil para ver.'));
      }
      P.cards.appendChild(art);
    });
  }
  function definir(rede, mud) {
    var c = S.cards[rede]; if (!c) return;
    for (var k in mud) if (Object.prototype.hasOwnProperty.call(mud, k)) c[k] = mud[k];
    desenharCards(); desenharRedes(); desenharBotao();
  }

  /* ---- enviar o arquivo (XMLHttpRequest, para ter o progresso) */
  function enviarArquivo(info, file, aoProgredir) {
    var g0 = ger;
    return new Promise(function (resolve0) {
      function resolve(v) { if (g0 === ger) resolve0(v); }   /* envio de quem já saiu nunca responde */
      var x = new XMLHttpRequest(); xhrAtual = x;
      x.timeout = 15 * 60 * 1000;
      try { x.open(String(info.metodo || 'PUT').toUpperCase(), info.upload_url); } catch (e) { resolve({ ok: false, status: 0 }); return; }
      var h = info.cabecalhos && typeof info.cabecalhos === 'object' ? info.cabecalhos : {};
      Object.keys(h).forEach(function (k) { try { x.setRequestHeader(k, String(h[k])); } catch (e) {} });
      x.upload.onprogress = function (e) { if (e.lengthComputable && e.total > 0) aoProgredir(Math.min(100, Math.round(e.loaded * 100 / e.total))); };
      x.onload = function () { resolve({ ok: x.status >= 200 && x.status < 300, status: x.status }); };
      x.onerror = x.ontimeout = x.onabort = function () { resolve({ ok: false, status: 0 }); };
      x.send(file);
    });
  }

  /* ---- publicar */
  function falhaGeral(sel, r) {
    var j = r.j, st = r.status;
    var mud;
    if (st === 403 && j && (j.motivo === 'chave_desligada' || j.precisa === 'equipe')) mud = { fase: 'desligado', texto: msgDe(j) || 'A publicação nas redes está desligada por enquanto.' };
    else if (st === 401) mud = { fase: 'nao_saiu', texto: 'Sua sessão venceu. Entre de novo. Nada foi publicado.' };
    else if (st === 0) mud = { fase: 'nao_saiu', texto: 'Sem conexão. Nada foi enviado.' };
    else mud = { fase: 'nao_saiu', texto: msgDe(j) || 'Não consegui preparar o envio agora. Nada foi publicado. Tente de novo.' };
    sel.forEach(function (r2) { definir(r2.id, mud); });
  }
  function publicar() {
    if (motivoBotao()) return;
    var sel = marcadas(), arq = S.video.file, ext = S.video.ext, legenda = P.legenda.value, id = S.arqId;
    S.ocupado = true; S.cards = {};
    sel.forEach(function (r) { S.cards[r.id] = { rede: r.id, fase: 'enviando', pct: 0, arq: id, texto: '', pubId: null, link: '', media_id: '', abre: '' }; });
    desenharCards(); desenharRedes(); desenharBotao();
    chamar('POST', '/upload-url', { nome: arq.name, tipo: tipoDe(arq, ext), tamanho: arq.size }).then(function (r) {
      var j = r.j;
      if (!(r.status === 200 && j && j.ok && j.upload_url && j.video_url)) { falhaGeral(sel, r); return null; }
      if (j.limite_bytes && arq.size > j.limite_bytes) { falhaGeral(sel, { status: 400, j: { error: 'O vídeo passa do limite de ' + tam(j.limite_bytes) + '.' } }); return null; }
      return enviarArquivo(j, arq, function (p) { sel.forEach(function (r2) { if (S.cards[r2.id] && S.cards[r2.id].fase === 'enviando') { S.cards[r2.id].pct = p; } }); desenharCards(); }).then(function (u) {
        if (!u.ok) {
          var t = u.status ? 'O vídeo não subiu (erro ' + u.status + '). Nada foi publicado. Tente de novo.' : 'O envio do vídeo caiu. Nada foi publicado. Tente de novo.';
          sel.forEach(function (r2) { definir(r2.id, { fase: 'nao_saiu', texto: t }); });
          return null;
        }
        sel.forEach(function (r2) { if (S.cards[r2.id]) S.cards[r2.id].pct = 100; }); desenharCards();
        return j.video_url;
      });
    }).then(function (videoUrl) {
      if (!videoUrl) return;
      return sel.reduce(function (cadeia, r) {
        return cadeia.then(function () {
          definir(r.id, { fase: 'pedido', texto: '' });
          return chamar('POST', '/publicar', { rede: r.id, video_url: videoUrl, legenda: legenda }).then(function (resp) { aplicarPublicar(r.id, resp); });
        });
      }, Promise.resolve());
    }).then(function () {
      S.ocupado = false; desenharRedes(); desenharBotao();
      carregarLimites(); carregarHist();
    }, function () {
      S.ocupado = false; desenharRedes(); desenharBotao();
    });
  }
  function pubDe(j) { return j && j.publicacao && typeof j.publicacao === 'object' ? j.publicacao : null; }
  function aplicarPublicar(rede, r) {
    var j = r.j, st = r.status, msg = msgDe(j), abre = j && j.abre_em ? quandoAbre(j.abre_em) : '';
    var base = { abre: abre, texto: '' };
    if (st === 0) return definir(rede, { fase: 'incerto', abre: '', texto: 'Não sei se o pedido chegou. Confira ' + redeDe(rede).conta + ' antes de subir de novo.' });
    /* Sem JSON: 2xx e 5xx podem ter publicado (o corpo veio cortado ou de um intermediário): incerto. Só o 4xx é "não saiu". */
    if (!j) return definir(rede, (st >= 500 || (st >= 200 && st < 300)) ? { fase: 'incerto', abre: '', texto: '' } : { fase: 'nao_saiu', abre: '', texto: 'Não saiu. A resposta do servidor veio vazia (erro ' + st + ').' });
    if (st === 403 && (j.motivo === 'chave_desligada' || j.precisa === 'equipe')) return definir(rede, { fase: 'desligado', abre: '', texto: msg || 'Desligado por enquanto.' });
    if (st === 401) return definir(rede, { fase: 'nao_saiu', abre: '', texto: 'Sua sessão venceu. Entre de novo. Nada foi publicado.' });
    if (j.ok === true) {
      var p = pubDe(j);
      if (rede === 'status') return definir(rede, { fase: 'aceito', abre: '', texto: msg });
      if (st === 202 || j.motivo === 'aguardando') {
        if (p && p.id) { S.pend[p.id] = rede; iniciarPoll(); }
        return definir(rede, { fase: 'aguardando', abre: '', texto: msg, pubId: p ? p.id : null });
      }
      return definir(rede, { fase: 'publicado', abre: '', texto: msg, pubId: p ? p.id : null, media_id: p && p.media_id ? String(p.media_id) : '', link: p && typeof p.permalink === 'string' ? p.permalink : '' });
    }
    if (st === 202 || j.incerto) return definir(rede, { fase: 'incerto', abre: '', texto: msg });
    return definir(rede, { fase: 'nao_saiu', abre: base.abre, texto: msg || 'Não saiu. Nada foi publicado.' });
  }

  /* ---- avanco a cada 60 s (so com a tela aberta e visivel) */
  function paneVisivel(no) { return !!no && no.getClientRects().length > 0 && !document.hidden; }
  function iniciarPoll() { if (!S.poll) S.poll = setInterval(tick, AVANCO_MS); }
  function pararPoll() { if (S.poll) { clearInterval(S.poll); S.poll = null; } }
  var tickRodando = false;
  function tick() {
    var ids = Object.keys(S.pend);
    if (!ids.length) { pararPoll(); return; }
    if (tickRodando || !paneVisivel(P.pane)) return;
    tickRodando = true;
    var terminou = false;
    ids.reduce(function (cadeia, id) {
      return cadeia.then(function () {
        return chamar('POST', '/publicacoes/' + encodeURIComponent(id) + '/avancar', {}).then(function (r) {
          var rede = S.pend[id], p = pubDe(r.j), t = false;
          if (p) {
            var est = p.estado, mud = null;
            if (est === 'publicado') { mud = { fase: 'publicado', abre: '', texto: msgDe(r.j) || p.mensagem || '', media_id: p.media_id ? String(p.media_id) : '', link: typeof p.permalink === 'string' ? p.permalink : '' }; t = true; }
            else if (est === 'falhou' || est === 'nao_saiu') { mud = { fase: 'nao_saiu', abre: '', texto: msgDe(r.j) || p.mensagem || '' }; t = true; }
            else if (est === 'incerto') { mud = { fase: 'incerto', abre: '', texto: msgDe(r.j) || p.mensagem || '' }; t = true; }
            else if (est === 'publicando') mud = { fase: 'processando', abre: '', texto: '' };
            else mud = { fase: 'aguardando', abre: '', texto: msgDe(r.j) || p.mensagem || '' };
            if (S.cards[rede] && S.cards[rede].pubId === id) definir(rede, mud);
          } else if (r.status === 404 || (r.j && r.j.motivo === 'nao_encontrada')) {
            if (S.cards[rede] && S.cards[rede].pubId === id) definir(rede, { fase: 'incerto', abre: '', texto: msgDe(r.j) || '' });
            t = true;
          } else if (r.status === 403 && r.j && (r.j.motivo === 'chave_desligada' || r.j.precisa === 'equipe')) {
            if (S.cards[rede] && S.cards[rede].pubId === id) definir(rede, { fase: 'desligado', abre: '', texto: msgDe(r.j) || '' });
            if (r.j.precisa === 'equipe') { semEquipe = true; Lerro = 'Esta tela é só para a equipe.'; }
            t = true;
          }
          if (t) { delete S.pend[id]; terminou = true; }
        });
      });
    }, Promise.resolve()).then(function () {
      tickRodando = false;
      if (!Object.keys(S.pend).length) pararPoll();
      if (terminou) { carregarLimites(); carregarHist(); }
    }, function () { tickRodando = false; });
  }

  /* ---- historico */
  var ESTADO_HIST = {
    criando: ['Criando', 'in'], aguardando: ['Aguardando', 'av'], publicando: ['Processando', 'in'], publicado: ['Publicado', 'ok'],
    falhou: ['Falhou', 'er'], nao_saiu: ['Não saiu', 'er'], enviado: ['Pedido aceito', 'ok'], reservado: ['Em andamento', 'in']
  };
  function estadoHist(h) {
    if (h.estado === 'incerto') return [h.rede === 'facebook' ? 'Confira a Página' : (h.rede === 'instagram' ? 'Confira o Instagram' : 'Confira o celular'), 'av'];
    return ESTADO_HIST[h.estado] || [String(h.estado || ''), ''];
  }
  function carregarHist() {
    return chamar('GET', '/publicacoes').then(function (r) {
      if (r.status === 200 && r.j && r.j.ok) {
        var lista = [];
        (Array.isArray(r.j.reels) ? r.j.reels : []).forEach(function (x) { lista.push({ id: String(x.id), rede: x.rede, estado: x.estado, por: x.por, criado_em: x.criado_em, mensagem: x.mensagem || '', media_id: x.media_id || '', permalink: typeof x.permalink === 'string' ? x.permalink : '', legenda: x.legenda || '' }); });
        (Array.isArray(r.j.status) ? r.j.status : []).forEach(function (x) { lista.push({ id: String(x.id), rede: 'status', estado: x.estado, por: x.por, criado_em: x.criado_em, mensagem: '', media_id: '', legenda: '' }); });
        lista.sort(function (a, b) { return (Date.parse(b.criado_em) || 0) - (Date.parse(a.criado_em) || 0); });
        S.hist = lista.slice(0, 12); S.histErro = '';
        S.hist.forEach(function (h) { if ((h.estado === 'aguardando' || h.estado === 'publicando' || h.estado === 'criando') && h.rede !== 'status' && !S.pend[h.id]) { S.pend[h.id] = h.rede; iniciarPoll(); } });
      } else if (r.status === 403 && r.j && r.j.precisa === 'equipe') { S.hist = null; S.histErro = 'Esta tela é só para a equipe.'; }
      else { S.histErro = (r.j && r.j.error) || 'Não consegui ler o histórico agora. Tente de novo em instantes.'; }
      desenharHist();
    });
  }
  function desenharHist() {
    limpar(P.hist);
    if (S.histErro && !S.hist) { P.hist.appendChild(criar('div', 'ar-vazio', S.histErro)); return; }
    if (!S.hist) { P.hist.appendChild(criar('div', 'ar-vazio', 'Carregando…')); return; }
    if (!S.hist.length) { P.hist.appendChild(criar('div', 'ar-vazio', 'Ainda não saiu nenhuma publicação por aqui.')); return; }
    if (S.histErro) P.hist.appendChild(criar('p', 'ar-msg av', S.histErro));
    var ul = criar('ul', 'ar-hist'); P.hist.appendChild(ul);
    S.hist.forEach(function (h) {
      var r = redeDe(h.rede), e = estadoHist(h);
      var li = criar('li');
      li.appendChild(criar('span', 'ar-badge' + (e[1] ? ' ' + e[1] : ''), e[0]));
      var c = criar('div', 'ar-h-corpo'); li.appendChild(c);
      c.appendChild(criar('strong', null, r ? r.nome : String(h.rede || '')));
      var sub = [h.por ? 'por ' + h.por : '', quandoFoi(h.criado_em)].filter(Boolean).join(' · ');
      if (sub) { c.appendChild(document.createTextNode(' ')); c.appendChild(criar('span', 'ar-h-sub', sub)); }
      if (h.legenda) c.appendChild(criar('div', 'ar-h-sub', h.legenda));
      if (h.mensagem && h.estado !== 'publicado') c.appendChild(criar('div', 'ar-h-sub', h.mensagem));
      if (h.estado === 'publicado' && h.rede === 'facebook' && h.media_id && /^[0-9A-Za-z_-]+$/.test(h.media_id)) {
        var a = criar('a', 'ar-link', 'Abrir a publicação'); a.href = 'https://www.facebook.com/reel/' + encodeURIComponent(h.media_id); a.target = '_blank'; a.rel = 'noopener noreferrer'; c.appendChild(a);
      } else if (h.estado === 'publicado' && h.rede === 'instagram' && typeof h.permalink === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(h.permalink)) {
        /* O link do Instagram só existe quando o servidor devolve o permalink da publicação. */
        var ai = criar('a', 'ar-link', 'Abrir a publicação'); ai.href = h.permalink; ai.target = '_blank'; ai.rel = 'noopener noreferrer'; c.appendChild(ai);
      }
      ul.appendChild(li);
    });
  }

  /* ================================================================ COMENTARIOS */
  var C = { montado: false, rede: 'instagram', sem: false, dados: { instagram: null, facebook: null }, ui: {}, enviando: false, carregando: false };

  function montarComentarios(pane) {
    var raiz = criar('div', 'ar'); pane.appendChild(raiz); C.pane = pane;
    var barra = criar('div', 'ar-barra'); raiz.appendChild(barra);
    var grupo = criar('div', 'ar-barra'); grupo.style.margin = '0'; grupo.setAttribute('role', 'group'); grupo.setAttribute('aria-label', 'Rede'); barra.appendChild(grupo);
    C.chips = {};
    [['instagram', 'Instagram'], ['facebook', 'Facebook']].forEach(function (x) {
      var b = criar('button', 'ar-chip', x[1]); b.type = 'button'; b.setAttribute('aria-pressed', x[0] === C.rede ? 'true' : 'false'); grupo.appendChild(b); C.chips[x[0]] = b;
      b.addEventListener('click', function () { trocarRede(x[0]); });
    });
    C.btnSem = criar('button', 'ar-chip'); C.btnSem.type = 'button'; C.btnSem.setAttribute('aria-pressed', 'false'); barra.appendChild(C.btnSem);
    C.btnSem.addEventListener('click', function () { C.sem = !C.sem; desenharTopo(); desenharLista(); });
    C.btnAtu = criar('button', 'auto-btn ghost', 'Atualizar'); C.btnAtu.type = 'button'; barra.appendChild(C.btnAtu);
    C.btnAtu.addEventListener('click', function () { carregarComentarios(C.rede); carregarLimites(); });
    C.atual = criar('span', 'ar-atual'); barra.appendChild(C.atual);
    C.aviso = criar('div', 'ar-aviso'); C.aviso.hidden = true; C.aviso.setAttribute('role', 'status'); raiz.appendChild(C.aviso);
    C.regra = criar('p', 'ar-nota'); C.regra.style.margin = '0 0 12px'; raiz.appendChild(C.regra);
    C.lista = criar('div'); raiz.appendChild(C.lista);
    C.montado = true;
    desenharTopo(); desenharLista();
  }
  function trocarRede(r) {
    if (r === C.rede) return;
    C.rede = r;
    desenharTopo();
    if (!C.dados[r]) carregarComentarios(r); else desenharLista();
  }
  /* "Sem resposta" = ninguém respondeu EM PÚBLICO: nem a equipe nem o robô. A DM do robô é privada e não conta,
     porque quem lê o post ainda vê a pergunta sem resposta. */
  function semResposta(it) {
    var m = it.motor || {};
    return !it.gente && m.publica !== 'enviada';
  }
  function respostaLigada(rede) { var b = limiteResp(rede); return !b || b.ligado !== false; }
  function desenharTopo() {
    Object.keys(C.chips).forEach(function (k) { C.chips[k].setAttribute('aria-pressed', k === C.rede ? 'true' : 'false'); });
    var d = C.dados[C.rede], n = d && d.itens ? d.itens.filter(semResposta).length : null;
    C.btnSem.textContent = 'Sem resposta' + (n != null ? ' (' + n + ')' : '');
    C.btnSem.setAttribute('aria-pressed', C.sem ? 'true' : 'false');
    C.btnSem.title = 'Comentários que nem o robô nem a equipe responderam';
    C.btnAtu.disabled = C.carregando;
    C.atual.textContent = d && d.atualizado_em ? 'Atualizado às ' + hora(new Date(d.atualizado_em)) + (d.fonte === 'cache_velho' ? ' (cópia guardada)' : '') : '';
    var f = fraseLimite(limiteResp(C.rede));
    var rgs = 'Respostas de gente: 1 por comentário e 20 segundos entre uma e outra. ';
    C.regra.textContent = rgs + (f.texto === 'Desligado por enquanto.' ? 'A resposta nesta rede está desligada por enquanto.' : (f.tom === 'ok' ? 'Pode responder agora.' : f.texto));
    var av = '';
    if (d && d.parada && d.parada.abre_em) av = 'A rede pediu uma pausa. ' + quandoAbre(d.parada.abre_em) + ' Mostrando a lista que ficou guardada.';
    else if (Lerro && !L) av = Lerro;
    C.aviso.textContent = av; C.aviso.hidden = !av; C.aviso.className = 'ar-aviso neutro';
  }
  function carregarComentarios(rede) {
    C.carregando = true; desenharTopo(); desenharLista();
    return chamar('GET', '/comentarios?rede=' + encodeURIComponent(rede)).then(function (r) {
      var j = r.j;
      if (r.status === 200 && j && j.ok && Array.isArray(j.itens)) {
        C.dados[rede] = { itens: j.itens, fonte: j.fonte || '', parada: j.parada || null, atualizado_em: j.atualizado_em || '', erro: '', desligado: false };
      } else if (r.status === 403 && j && j.motivo === 'chave_desligada') {
        C.dados[rede] = { itens: [], desligado: true, erro: '' };
      } else {
        var t = r.status === 403 && j && j.precisa === 'equipe' ? 'Esta tela é só para a equipe.'
          : r.status === 401 ? 'Sua sessão venceu. Entre de novo para ver os comentários.'
          : r.status === 0 ? 'Sem conexão. Confira a internet e tente de novo.'
          : ((j && j.error) || 'Não consegui ler os comentários agora. Tente de novo em instantes.');
        /* So falha passageira (sem conexao, 5xx) mantem a lista que ja estava na tela; 401 e 403 (nao e da equipe) a tiram. */
        var passageira = r.status === 0 || r.status >= 500;
        C.dados[rede] = passageira && C.dados[rede] && C.dados[rede].itens && C.dados[rede].itens.length ? Object.assign({}, C.dados[rede], { erro: t }) : { itens: [], desligado: false, erro: t };
        if (r.status === 403 && j && j.precisa === 'equipe') {
          semEquipe = true; Lerro = t;
          if (C.pane && paneVisivel(C.pane) && typeof window.automacaoSubaba === 'function') window.automacaoSubaba('instagram');
        }
      }
      C.carregando = false; desenharTopo(); desenharLista();
    });
  }
  function uiDe(rede, id) { var k = rede + ':' + id; return C.ui[k] || (C.ui[k] = { texto: '', msg: '', tom: '', trava: false, ate: 0 }); }
  function quemRespondeu(g) {
    var t = g.por ? 'Respondido por ' + g.por : 'Respondido pela equipe';
    var q = g.em ? quandoFoi(g.em) : '';
    t += q ? ' em ' + q + '.' : '.';
    if (g.estado === 'incerto') t += ' Não sei se saiu: confira o comentário na rede.';
    return t;
  }
  var MOTOR = { enviada: 'enviada', na_fila: 'na fila', falhou: 'falhou', pulada: 'pulada' };
  function textoMotor(m) {
    var p = [];
    if (m && m.dm) p.push('DM ' + (MOTOR[m.dm] || String(m.dm)));
    if (m && m.publica) p.push('resposta pública ' + (MOTOR[m.publica] || String(m.publica)));
    return p.length ? 'Robô: ' + p.join(' · ') + '.' : 'Robô: ainda não mexeu neste comentário.';
  }
  function construirItem(rede, it) {
    var ui = uiDe(rede, it.id);
    var art = criar('article', 'ar-com'); art.setAttribute('data-id', it.id);
    var cab = criar('div', 'ar-com-cab'); art.appendChild(cab);
    cab.appendChild(criar('strong', null, it.autor_nome ? String(it.autor_nome) : 'Alguém'));
    cab.appendChild(criar('span', null, quandoFoi(it.criado_em)));
    art.appendChild(criar('p', 'ar-com-txt', String(it.texto || '')));
    art.appendChild(criar('div', 'ar-motor', textoMotor(it.motor)));
    if (it.gente) art.appendChild(criar('div', 'ar-gente ' + (it.gente.estado === 'incerto' ? 'av' : 'ok'), quemRespondeu(it.gente)));
    if (it.pode_responder) {
      if (!respostaLigada(rede)) { art.appendChild(criar('div', 'ar-nota', 'A resposta nesta rede está desligada por enquanto.')); return art; }
      var box = criar('div', 'ar-resp'); art.appendChild(box);
      var lb = criar('label', 'ar-so-leitor', 'Resposta para ' + (it.autor_nome ? String(it.autor_nome) : 'este comentário')); var tid = 'ar-r-' + rede + '-' + it.id; lb.htmlFor = tid; box.appendChild(lb);
      var ta = criar('textarea', 'auto-ta'); ta.id = tid; ta.rows = 2; ta.maxLength = RESPOSTA_MAX; ta.placeholder = 'Escreva a resposta…'; ta.value = ui.texto; ta.disabled = ui.trava; box.appendChild(ta);
      var lin = criar('div', 'ar-resp-linha'); box.appendChild(lin);
      var cnt = criar('span', 'ar-contador', milhar(ui.texto.length) + ' de ' + milhar(RESPOSTA_MAX)); lin.appendChild(cnt);
      var bt = criar('button', 'auto-btn', 'Responder'); bt.type = 'button'; bt.disabled = ui.trava || !!ui.enviando || (ui.ate && Date.now() < ui.ate); lin.appendChild(bt);
      var ms = criar('div', 'ar-msg' + (ui.tom ? ' ' + ui.tom : '')); ms.textContent = ui.msg; ms.hidden = !ui.msg; ms.setAttribute('role', ui.tom === 'er' ? 'alert' : 'status'); box.appendChild(ms);
      ta.addEventListener('input', function () { ui.texto = ta.value; cnt.textContent = milhar(ta.value.length) + ' de ' + milhar(RESPOSTA_MAX); });
      bt.addEventListener('click', function () { responder(rede, it); });
    }
    return art;
  }
  function refazerItem(rede, it, focarCampo) {
    if (rede !== C.rede) return;
    var antigo = C.lista.querySelector('[data-id="' + cssEsc(String(it.id)) + '"]');
    var novo = construirItem(rede, it);
    if (antigo) {
      if (C.sem && !semResposta(it)) antigo.parentNode.removeChild(antigo); else antigo.parentNode.replaceChild(novo, antigo);
    }
    if (focarCampo) { var ta = novo.querySelector('textarea'); if (ta && !ta.disabled) ta.focus(); }
    desenharTopo();
  }
  function desenharLista() {
    limpar(C.lista);
    var d = C.dados[C.rede];
    if (!d) { C.lista.appendChild(criar('div', 'ar-vazio', 'Carregando os comentários…')); C.lista.setAttribute('aria-busy', 'true'); return; }
    C.lista.removeAttribute('aria-busy');
    if (d.desligado) { C.lista.appendChild(criar('div', 'ar-vazio', 'A caixa de comentários está desligada por enquanto.')); return; }
    if (d.erro && !(d.itens && d.itens.length)) { C.lista.appendChild(criar('div', 'ar-vazio', d.erro)); return; }
    if (d.erro) C.lista.appendChild(criar('p', 'ar-msg av', d.erro));
    var itens = d.itens.filter(function (it) { return !C.sem || semResposta(it); });
    if (!itens.length) { C.lista.appendChild(criar('div', 'ar-vazio', C.sem ? 'Nenhum comentário sem resposta agora.' : 'Nenhum comentário por aqui.')); return; }
    var grade = criar('div', 'ar-lista'); C.lista.appendChild(grade);
    itens.forEach(function (it) { grade.appendChild(construirItem(C.rede, it)); });
  }
  function responder(rede, it) {
    var ui = uiDe(rede, it.id), texto = ui.texto.trim();
    if (ui.trava) return;
    if (!texto) { ui.msg = 'Escreva a resposta antes de enviar.'; ui.tom = 'er'; refazerItem(rede, it, true); return; }
    if (C.enviando) { ui.msg = 'Espere a resposta anterior terminar.'; ui.tom = 'av'; refazerItem(rede, it); return; }
    C.enviando = true; ui.enviando = true; ui.msg = 'Enviando…'; ui.tom = ''; refazerItem(rede, it);
    chamar('POST', '/comentarios/responder', { rede: rede, comentario_id: it.id, texto: texto }).then(function (r) {
      C.enviando = false; ui.enviando = false;
      var j = r.j, st = r.status, msg = msgDe(j), foco = false;
      if (st === 200 && j && j.ok) {
        it.pode_responder = false; it.gente = { por: 'você', em: new Date().toISOString(), estado: 'enviado' }; ui.msg = ''; ui.tom = ''; ui.texto = '';
        carregarLimites();
      } else if (st === 0 || st === 202 || (j && j.incerto) || (!j && (st >= 500 || (st >= 200 && st < 300)))) {
        ui.trava = true; ui.tom = 'av';
        ui.msg = st === 0 ? 'Sem conexão. Não sei se saiu. Confira o comentário na rede antes de tentar de novo.' : (msg || 'Não sei se saiu. Confira o comentário na rede antes de tentar de novo.');
      } else if (st === 409) {
        it.pode_responder = false; it.gente = { por: null, em: null, estado: 'enviado' }; ui.msg = ''; ui.tom = '';
      } else if (st === 429) {
        ui.tom = 'av'; ui.msg = [quandoAbre(j && j.abre_em), msg].filter(Boolean).join(' ') || 'Ainda não dá para responder.';
        var alvo = j && j.abre_em ? Date.parse(j.abre_em) : NaN;
        if (isFinite(alvo)) {
          var delta = Math.min(Math.max(alvo - Date.now(), 500), 2147483000); ui.ate = Date.now() + delta;
          /* A espera do limite morre com a sessão: se alguém saiu nesse meio-tempo, o timer não toca na tela de quem entrou. */
          var gerDaEspera = ger;
          setTimeout(function () { if (gerDaEspera !== ger) return; ui.ate = 0; if (ui.tom === 'av' && !ui.trava) { ui.msg = ''; ui.tom = ''; } refazerItem(rede, it); carregarLimites(); }, delta);
        }
        foco = true;
      } else if (st === 403 && j && j.motivo === 'chave_desligada') {
        if (L && L[rede]) { L[rede].responder = Object.assign({}, L[rede].responder, { ligado: false, pode: false }); }
        else { L = L || {}; L[rede] = L[rede] || {}; L[rede].responder = { ligado: false, pode: false }; }
        ui.msg = ''; ui.tom = ''; desenharTopo(); desenharLista(); return;
      } else {
        ui.tom = 'er'; ui.msg = st === 401 ? 'Sua sessão venceu. Entre de novo. Nada foi enviado.' : (msg || 'Não saiu. Nada foi marcado como respondido.'); foco = true;
      }
      refazerItem(rede, it, foco);
    });
  }

  /* ================================================================ entrada */
  function aoAbrirPublicar() {
    var pane = document.getElementById('auto-pane-publicar'); if (!pane) return;
    garantirCss();
    if (!P.montado) montarPublicar(pane);
    carregarLimites(); carregarHist();
    if (Object.keys(S.pend).length) iniciarPoll();
  }
  function aoAbrirComentarios() {
    var pane = document.getElementById('auto-pane-comentarios'); if (!pane) return;
    garantirCss();
    var primeira = !C.montado;
    if (primeira) montarComentarios(pane);
    carregarLimites();
    carregarComentarios(C.rede);
  }
  /* ================================================================ logout
     O app NAO recarrega a pagina ao sair (sairGeradorJa): quem entra depois na mesma aba nao pode herdar nada de quem saiu.
     O authLimpar avisa por 'io2-sessao-limpa'. Aqui: para o avanco, aborta o que esta em voo, solta a URL da previa e volta
     o video, a legenda, os rascunhos de resposta, os cartoes, o historico, os comentarios e os limites ao estado de fabrica. */
  function zerarTudo() {
    ger += 1;                                    /* o que estava em voo nunca mais fala */
    ativas.splice(0).forEach(function (ac) { try { ac.abort(); } catch (e) {} });
    if (xhrAtual) { try { xhrAtual.abort(); } catch (e) {} xhrAtual = null; }
    pararPoll(); tickRodando = false; Lcarregando = null;
    L = null; Lerro = ''; semEquipe = false;
    if (S.urlPrevia) { try { URL.revokeObjectURL(S.urlPrevia); } catch (e) {} }
    S = novoS();
    C.rede = 'instagram'; C.sem = false; C.dados = { instagram: null, facebook: null }; C.ui = {}; C.enviando = false; C.carregando = false;
    if (P.montado) {
      P.legenda.value = ''; P.legenda.disabled = false; P.arquivo.value = '';
      try { P.video.removeAttribute('src'); P.video.load(); } catch (e) {}
      erroDoVideo('');
      REDES.forEach(function (r) { P.chk[r.id].checked = false; });
      desenharVideo(); desenharContador(); desenharRedes(); desenharBotao(); desenharAviso(); desenharCards(); desenharHist();
    }
    if (C.montado) { desenharTopo(); desenharLista(); }
  }
  window.addEventListener('io2-sessao-limpa', zerarTudo);

  window.autoRedes = {
    semEquipe: function () { return semEquipe; },
    mostrar: function (qual) { try { if (qual === 'publicar') aoAbrirPublicar(); else if (qual === 'comentarios') aoAbrirComentarios(); } catch (e) { console.error(e); } },
    esconder: function () { /* o avanco so roda com o painel visivel; nada a desfazer */ }
  };
})();
