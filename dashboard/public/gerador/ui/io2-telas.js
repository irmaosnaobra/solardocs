/* io2-telas.js: comportamento por tela do visual novo do /gerador. So age com html.io2 e em data-mode="app".
   Erro aqui nunca derruba a casca nem o app: cada bloco tem o seu try/catch, e cada callback (observador,
   ouvinte, temporizador) tambem, porque eles rodam depois que o try de montagem ja terminou.
   Nao envolve funcao do app, nao move no, nao escreve em location, nao renomeia id nem classe do app.
   Blocos: (A) texto longo recolhido, (B) faixa de resultado do Simulador no celular,
   (C) remendos de acessibilidade em tempo de execucao, (D) Inicio: marcas de proporcao para a trena e indicador zerado.
   Tudo o que este arquivo acrescenta fica marcado (data-io2, data-io2-*) para desfazer() devolver o app ao que era. */
(function () {
  var h = document.documentElement;
  try {
    if (!h.classList.contains('io2')) return;
    if (window.self !== window.top) return;
  } catch (e) { return; }

  var criados = [];       /* nos que este arquivo pos no DOM */
  var classesPostas = []; /* [no, classe] para desfazer */
  var observadores = [];
  var ouvintes = [];      /* [alvo, tipo, fn, opcoes] */
  var timer = 0;          /* um so temporizador do motor; limpo ao disparar */
  var desfeito = false;
  var iniciado = false;
  var contador = 0;

  function io2Ligado() { return !desfeito && h.classList.contains('io2'); }
  function modoApp() { return h.getAttribute('data-mode') === 'app'; }
  function ouvir(alvo, tipo, fn, opc) { alvo.addEventListener(tipo, fn, opc); ouvintes.push([alvo, tipo, fn, opc]); }
  function observar(alvo, opcoes, fn) {
    var o = new MutationObserver(function (m) { try { fn(m); } catch (e) {} });
    o.observe(alvo, opcoes); observadores.push(o); return o;
  }

  /* Documento e tudo que vira papel: nenhum remendo entra ali. */
  var DOC = '.ep-doc, .ep-page, .ep-completo, .ep-prev-folha, .ep-prev-palco, .ep-prev-scroll, .nx-deck, .nx-slide, .simshot, .orc1, ' +
    '.orcview-palco, .orcview-folha, .pl-rx, .soc-rx, .sol-pb, .sol-te, .sol-vi, .sol-card, .sol-band, .prop-header, .preco-box, ' +
    '.hero-economia, .cta-fechamento, .print-only, .celebra-overlay, #eletro-print, #doc-print, #propostaSection, #expiradoSection, ' +
    '#orcViewSection, #loadingProposta, #ep-prev-doc, #orcview-folha, #exp-cta-card, #exp-cta-fallback, #marr';
  function emDocumento(n) { try { return !!(n.closest && n.closest(DOC)); } catch (e) { return true; } }
  function meu(n) { try { return !!(n.closest && n.closest('[data-io2]')); } catch (e) { return false; } }

  /* ------------------------------------------------------------------------------------------------
     (A) Texto longo acima da ferramenta fica numa linha com botao (aria-expanded). Acrescenta classe no bloco
     e um botao IRMAO antes dele; o bloco nao sai do lugar e o texto (que o app reescreve por innerHTML em
     alguns casos) nao e tocado. O estado aberto ou fechado de cada bloco e lembrado por aparelho em
     localStorage ('io2-cf:<id estavel>' = '1' quando aberto).
     ------------------------------------------------------------------------------------------------ */
  var ALVOS_CF = '#leads-info, #crm-info, #eletro-pane-cadastros > .pesquisa-info, #cad-pane-pontos .pesquisa-info';
  var feitosCf = typeof WeakSet === 'function' ? new WeakSet() : null;

  function idEstavel(b) {
    if (b.id && b.getAttribute('data-io2-cfid') !== '1') return b.id;
    return b.closest && b.closest('#cad-pane-pontos') ? 'pontos' : 'cadastros';
  }
  function lerEstado(chave) { try { return window.localStorage.getItem(chave) === '1'; } catch (e) { return false; } }
  function gravarEstado(chave, aberto) {
    try { if (aberto) window.localStorage.setItem(chave, '1'); else window.localStorage.removeItem(chave); } catch (e) {}
  }

  function comoFunciona(raiz) {
    try {
      if (!raiz || !raiz.querySelectorAll) return;
      var lst = [];
      if (raiz.matches && raiz.matches(ALVOS_CF)) lst.push(raiz);
      var f = raiz.querySelectorAll(ALVOS_CF);
      for (var i = 0; i < f.length; i++) lst.push(f[i]);
      for (var j = 0; j < lst.length; j++) {
        var b = lst[j];
        try {
          if (!b.parentNode || (feitosCf && feitosCf.has(b)) || b.classList.contains('io2-cf')) continue;
          if (feitosCf) feitosCf.add(b);
          var estavel = idEstavel(b);
          if (!b.id) { b.id = 'io2-cf-' + estavel; b.setAttribute('data-io2-cfid', '1'); }
          var chave = 'io2-cf:' + estavel;
          var aberto = lerEstado(chave);
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'io2-cf-btn';
          btn.setAttribute('data-io2', '1');
          btn.setAttribute('data-io2-chave', chave);
          btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
          btn.setAttribute('aria-controls', b.id);
          btn.textContent = estavel === 'leads-info' ? 'Quem atende cada lead' : 'Como funciona';
          b.classList.add('io2-cf');
          classesPostas.push([b, 'io2-cf']);
          if (aberto) { b.classList.add('io2-cf-aberto'); classesPostas.push([b, 'io2-cf-aberto']); }
          b.parentNode.insertBefore(btn, b);
          criados.push(btn);
        } catch (e) {}
      }
    } catch (e) {}
  }

  function cliqueComoFunciona(ev) {
    try {
      var t = ev.target;
      var btn = t && t.closest ? t.closest('.io2-cf-btn') : null;
      if (!btn) return;
      var bloco = document.getElementById(btn.getAttribute('aria-controls'));
      if (!bloco) return;
      var abrir = !bloco.classList.contains('io2-cf-aberto');
      bloco.classList.toggle('io2-cf-aberto', abrir);
      if (abrir) classesPostas.push([bloco, 'io2-cf-aberto']);
      btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      gravarEstado(btn.getAttribute('data-io2-chave'), abrir);
    } catch (e) {}
  }

  /* ------------------------------------------------------------------------------------------------
     (B) Faixa do Simulador (celular): lucro por mes, retorno e TIR logo acima da navegacao inferior
     enquanto o vendedor preenche. Le do DOM (#el-luc-mes, #el-payback, #el-tir) e observa a mudanca:
     eletroCalc nao e tocada. Nasce escondida (hidden) e so aparece quando: modo app, largura ate 860 px,
     aba do Simulador aberta e visivel, os tres valores ja calculados e o resultado de verdade fora da tela.
     ------------------------------------------------------------------------------------------------ */
  function faixaSimulador() {
    var luc = document.getElementById('el-luc-mes');
    var pay = document.getElementById('el-payback');
    var tir = document.getElementById('el-tir');
    var pane = document.getElementById('eletro-pane-simulador');
    var res = document.querySelector('#eletroSection .eletro-col-result');
    if (!luc || !pay || !tir || !pane || !res) return;
    var mq = window.matchMedia('(max-width: 860px)');
    var box = document.createElement('div');
    box.id = 'io2-faixa';
    box.hidden = true;
    box.setAttribute('data-io2', '1');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Resumo do simulador');
    box.setAttribute('aria-hidden', 'true');
    var rotulos = ['Lucro por mês', 'Retorno', 'TIR'];
    var valores = [];
    for (var i = 0; i < 3; i++) {
      var c = document.createElement('div');
      var s = document.createElement('small'); s.textContent = rotulos[i];
      var v = document.createElement('b');
      c.appendChild(s); c.appendChild(v); box.appendChild(c); valores.push(v);
    }
    document.body.appendChild(box);
    criados.push(box);

    var resultadoNaTela = false, quadro = 0;
    function texto(n) { return (n.textContent || '').replace(/\s+/g, ' ').trim(); }
    function vazio(t) { return t === '' || t === '-' || t === '—' || t === '–'; }
    function pintar() {
      quadro = 0;
      try {
        if (!io2Ligado()) return;
        var t0 = texto(luc), t1 = texto(pay), t2 = texto(tir);
        var calculado = !vazio(t0) && !vazio(t1) && !vazio(t2);
        if (calculado) {
          if (valores[0].textContent !== t0) valores[0].textContent = t0;
          if (valores[1].textContent !== t1) valores[1].textContent = t1;
          if (valores[2].textContent !== t2) valores[2].textContent = t2;
        }
        var ativo = calculado && modoApp() && mq.matches && h.classList.contains('eletro-aberto') &&
          pane.offsetParent !== null && !resultadoNaTela;
        box.hidden = !ativo;
        box.classList.toggle('io2-faixa-on', ativo);
        box.setAttribute('aria-hidden', ativo ? 'false' : 'true');
        document.body.classList.toggle('io2-faixa-ativa', ativo);
      } catch (e) {}
    }
    function agendarPintura() { if (!quadro) quadro = (window.requestAnimationFrame || setTimeout)(pintar, 16); }

    observar(luc, { childList: true, characterData: true, subtree: true }, agendarPintura);
    observar(pay, { childList: true, characterData: true, subtree: true }, agendarPintura);
    observar(tir, { childList: true, characterData: true, subtree: true }, agendarPintura);
    observar(pane, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] }, agendarPintura);
    observar(h, { attributes: true, attributeFilter: ['class', 'data-mode'] }, agendarPintura);
    try { if (mq.addEventListener) mq.addEventListener('change', agendarPintura); else if (mq.addListener) mq.addListener(agendarPintura); } catch (e) {}
    if (typeof IntersectionObserver === 'function') {
      /* 120 px de folga embaixo: a faixa e a navegacao inferior ja cobrem esse trecho da tela. */
      var io = new IntersectionObserver(function (es) {
        try { resultadoNaTela = es[es.length - 1].isIntersecting; agendarPintura(); } catch (e) {}
      }, { rootMargin: '0px 0px -120px 0px', threshold: 0 });
      io.observe(res);
      observadores.push({ disconnect: function () { io.disconnect(); } });
    }
    pintar();
  }

  /* ------------------------------------------------------------------------------------------------
     (C) Remendos de acessibilidade: rotulo ligado ao campo, inputmode em numero, clicavel focavel.
     Nunca gera id em campo: o app serializa Fechamento, Simulador e Cadastros por input[id] e um id novo
     viraria chave nova no que vai para o banco. Campo sem id leva aria-labelledby apontando para o rotulo.
     Cada atributo acrescentado leva uma marca data-io2-* para desfazer() remover so o que e nosso.
     ------------------------------------------------------------------------------------------------ */
  var CAMPO = 'input:not([type=hidden]), select, textarea';
  var feitosA11y = typeof WeakSet === 'function' ? new WeakSet() : null;

  function ehCampo(n) { return !!(n && n.nodeType === 1 && /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) && n.type !== 'hidden'); }
  function jaTemNome(c) {
    return c.hasAttribute('aria-label') || c.hasAttribute('aria-labelledby') || (c.labels && c.labels.length > 0);
  }
  function alvoDoRotulo(l) {
    var n = l.nextElementSibling;
    if (ehCampo(n)) return n;
    if (n && !n.matches('label, button, a')) {
      var c = n.querySelectorAll(CAMPO);
      if (c.length === 1) return c[0];
    }
    var p = l.parentElement;
    if (p && p.querySelectorAll('label').length === 1) {
      var cs = p.querySelectorAll(CAMPO);
      if (cs.length === 1) return cs[0];
    }
    var a = l.previousElementSibling;
    if (ehCampo(a) && (a.type === 'checkbox' || a.type === 'radio')) return a;
    return null;
  }
  function ligarRotulo(l) {
    if (l.hasAttribute('for') || l.querySelector(CAMPO)) return;
    var c = alvoDoRotulo(l);
    if (!c || jaTemNome(c)) return;
    var simples = !/^(checkbox|radio|range|file)$/.test(c.type || '');
    if (simples && c.id && document.getElementById(c.id) === c) {
      l.setAttribute('for', c.id);
      l.setAttribute('data-io2-for', '1');
    } else {
      if (!l.id) { l.id = 'io2-l-' + (++contador); l.setAttribute('data-io2-lid', '1'); }
      c.setAttribute('aria-labelledby', l.id);
      c.setAttribute('data-io2-lbl', '1');
    }
  }
  /* LISTA FECHADA de clicaveis que ganham teclado. Conferida no index.html, um a um (fora deles nada muda):
     span.auto-chip[onclick] = chip de post do Instagram na Automacao, onclick autoIgAddMidia(id): so acrescenta
     o id ao campo de texto #auto-ig-post, nao grava nada, nao pede confirmacao porque nao precisa.
     Ficam de fora de proposito: span.tbl-toggle (toggleEquip faz POST), span dentro de button.tbl-aba,
     .crm-card (tem botoes dentro), os fundos de modal (onclick testa event.target) e o #sb-backdrop. */
  var FOCAVEIS = 'span.auto-chip[onclick]';
  var ANCESTRAL_INTERATIVO = 'a, button, summary, label, [role=button], [role=link], [role=tab]';
  var BLOQUEIO_CLIQUE = 'a, button, input, select, textarea, [onclick], [role=button], [role=link], [role=tab], [tabindex]';
  function tornarFocavel(el) {
    if (el.parentElement && el.parentElement.closest(ANCESTRAL_INTERATIVO)) return;
    if (!el.matches(FOCAVEIS)) return;
    if (el.hasAttribute('role') || el.hasAttribute('tabindex')) return;
    if (el.querySelector(BLOQUEIO_CLIQUE)) return;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-io2-btn', '1');
  }
  function remendos(raiz) {
    try {
      if (!raiz || !raiz.querySelectorAll) return;
      var lst = [];
      var SEL = 'label:not([for]), input[type=number]:not([inputmode]), ' + FOCAVEIS;
      if (raiz.matches && raiz.matches(SEL)) lst.push(raiz);
      var f = raiz.querySelectorAll(SEL);
      for (var i = 0; i < f.length; i++) lst.push(f[i]);
      for (var j = 0; j < lst.length; j++) {
        var el = lst[j];
        try {
          if (feitosA11y && feitosA11y.has(el)) continue;
          if (meu(el) || emDocumento(el)) continue;
          if (feitosA11y) feitosA11y.add(el);
          var tag = el.tagName;
          if (tag === 'LABEL') ligarRotulo(el);
          else if (tag === 'INPUT') {
            if (!el.hasAttribute('inputmode')) { el.setAttribute('inputmode', 'decimal'); el.setAttribute('data-io2-im', '1'); }
          } else tornarFocavel(el);
        } catch (e) {}
      }
    } catch (e) {}
  }
  function tecla(ev) {
    try {
      var t = ev.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-io2-btn')) return;
      if (ev.repeat) return;
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      t.click();
    } catch (e) {}
  }


  /* ------------------------------------------------------------------------------------------------
     (D) Inicio: o app desenha os cartoes por innerHTML. Aqui so se LE o que ja esta na tela e se poe marca
     (atributo data-io2-* e a variavel --io-p) para o CSS desenhar a trena e o indicador zerado.
     Nao cria no, nao move no, nao toca no texto. Refaz a cada redesenho (observa so childList).
     ------------------------------------------------------------------------------------------------ */
  var inicioQuadro = 0;
  function inicioMarcar(el, p, leg) {
    if (p === null) {
      if (el.hasAttribute('data-io2-p')) { el.removeAttribute('data-io2-p'); el.removeAttribute('data-io2-leg'); el.style.removeProperty('--io-p'); }
      return;
    }
    var v = Math.max(0, Math.min(100, p)) + '%';
    if (el.getAttribute('data-io2-p') !== v) { el.setAttribute('data-io2-p', v); el.style.setProperty('--io-p', v); }
    if (leg !== undefined) { if (el.getAttribute('data-io2-leg') !== leg) el.setAttribute('data-io2-leg', leg); }
  }
  function decorarInicio() {
    inicioQuadro = 0;
    try {
      if (!io2Ligado() || !modoApp()) return;
      var sec = document.getElementById('inicioSection');
      if (!sec) return;
      /* Indicador zerado fica neutro. */
      var ns = sec.querySelectorAll('#in-pede button.in-linha .in-n');
      for (var i = 0; i < ns.length; i++) {
        var b = ns[i].parentNode, zero = /^\s*0\s*$/.test(ns[i].textContent || '');
        if (zero && !b.hasAttribute('data-io2-zero')) b.setAttribute('data-io2-zero', '1');
        else if (!zero && b.hasAttribute('data-io2-zero')) b.removeAttribute('data-io2-zero');
      }
      /* Obras: concluidas sobre o total, lido da frase do proprio cartao ("14 obras em andamento e 30 concluidas"). */
      var ob = sec.querySelector('.in-card[data-c="obras"]');
      if (ob) {
        var fr = ob.querySelector('.in-fr'), m = fr ? /(\d+)\s+obras?\s+em\s+andamento\s+e\s+(\d+)\s+conclu/i.exec(fr.textContent || '') : null;
        var em = m ? +m[1] : 0, co = m ? +m[2] : 0, tot = em + co;
        if (m && tot > 0) inicioMarcar(ob, Math.round(co / tot * 100), co + ' de ' + tot + ' obras concluídas');
        else inicioMarcar(ob, null);
      }
      /* Time: avanco sobre agendados, lido da celula ("36%"). */
      var cs = sec.querySelectorAll('.in-time td[data-r="Avanço sobre agendados"]');
      for (var j = 0; j < cs.length; j++) {
        var mm = /^\s*(\d{1,3})\s*%\s*$/.exec(cs[j].textContent || '');
        inicioMarcar(cs[j], mm ? +mm[1] : null);
      }
    } catch (e) {}
  }
  function agendarInicio() { if (!inicioQuadro) inicioQuadro = (window.requestAnimationFrame || setTimeout)(decorarInicio, 16); }
  function inicioLigar() {
    var sec = document.getElementById('inicioSection');
    if (!sec) return;
    observar(sec, { childList: true, subtree: true }, agendarInicio);
    decorarInicio();
    /* A grade mudou de largura em relacao ao CSS antigo: o Inicio so redesenha grafico no resize, e a tela ja pode ter desenhado. */
    try { setTimeout(function () { try { if (io2Ligado()) window.dispatchEvent(new Event('resize')); } catch (e) {} }, 80); } catch (e) {}
  }

  /* ------------------------------------------------------------------------------------------------
     Motor: um observador de nos novos no body (so childList, nunca atributo), com debounce de 150 ms.
     Processa so as raizes adicionadas e so em modo app. Ignora o que este arquivo mesmo criou.
     ------------------------------------------------------------------------------------------------ */
  var fila = [];
  function processarFila() {
    timer = 0;
    try {
      if (!io2Ligado() || !modoApp()) { fila = []; return; }
      var roots = fila; fila = [];
      for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (!r || !r.isConnected) continue;
        comoFunciona(r);
        remendos(r);
      }
    } catch (e) {}
  }
  function aoMudarCorpo(muts) {
    for (var i = 0; i < muts.length; i++) {
      var add = muts[i].addedNodes;
      for (var j = 0; j < add.length; j++) {
        var n = add[j];
        if (n.nodeType !== 1 || (n.hasAttribute && n.hasAttribute('data-io2'))) continue;
        fila.push(n);
      }
    }
    if (fila.length && !timer) timer = setTimeout(processarFila, 150);
  }

  /* Devolve ao app o que este arquivo acrescentou: so o que tem marca data-io2-*. */
  function desfazer() {
    if (desfeito) return;
    desfeito = true;
    try { observadores.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); } catch (e) {}
    try { ouvintes.forEach(function (o) { try { o[0].removeEventListener(o[1], o[2], o[3]); } catch (e) {} }); } catch (e) {}
    try { if (timer) clearTimeout(timer); timer = 0; fila = []; } catch (e) {}
    try { criados.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); }); } catch (e) {}
    try { classesPostas.forEach(function (c) { c[0].classList.remove(c[1]); }); } catch (e) {}
    try { document.body.classList.remove('io2-faixa-ativa'); } catch (e) {}
    try {
      var z = document.querySelectorAll('#inicioSection [data-io2-p], #inicioSection [data-io2-zero]');
      for (var y = 0; y < z.length; y++) { z[y].removeAttribute('data-io2-p'); z[y].removeAttribute('data-io2-leg'); z[y].removeAttribute('data-io2-zero'); z[y].style.removeProperty('--io-p'); }
    } catch (e) {}
    try {
      var q;
      q = document.querySelectorAll('[data-io2-btn]');
      for (var a = 0; a < q.length; a++) { q[a].removeAttribute('role'); q[a].removeAttribute('tabindex'); q[a].removeAttribute('data-io2-btn'); }
      q = document.querySelectorAll('[data-io2-for]');
      for (var b = 0; b < q.length; b++) { q[b].removeAttribute('for'); q[b].removeAttribute('data-io2-for'); }
      q = document.querySelectorAll('[data-io2-lbl]');
      for (var c = 0; c < q.length; c++) { q[c].removeAttribute('aria-labelledby'); q[c].removeAttribute('data-io2-lbl'); }
      q = document.querySelectorAll('[data-io2-lid]');
      for (var d = 0; d < q.length; d++) { q[d].removeAttribute('id'); q[d].removeAttribute('data-io2-lid'); }
      q = document.querySelectorAll('[data-io2-im]');
      for (var e2 = 0; e2 < q.length; e2++) { q[e2].removeAttribute('inputmode'); q[e2].removeAttribute('data-io2-im'); }
      q = document.querySelectorAll('[data-io2-cfid]');
      for (var g = 0; g < q.length; g++) { q[g].removeAttribute('id'); q[g].removeAttribute('data-io2-cfid'); }
    } catch (e) {}
  }

  /* Tudo que mexe no app comeca so quando o modo vira "app" (o login tem o tratamento dele, so de CSS).
     O modo e observado: login seguido de app, e logout, acontecem depois do carregamento. */
  function iniciarApp() {
    if (iniciado || desfeito || !modoApp()) return;
    iniciado = true;
    try { comoFunciona(document); } catch (e) {}
    try { remendos(document); } catch (e) {}
    try { faixaSimulador(); } catch (e) {}
    try { inicioLigar(); } catch (e) {}
    try { ouvir(document, 'click', cliqueComoFunciona, false); } catch (e) {}
    try { ouvir(document, 'keydown', tecla, false); } catch (e) {}
    try { observar(document.body, { childList: true, subtree: true }, aoMudarCorpo); } catch (e) {}
  }

  try {
    observar(h, { attributes: true, attributeFilter: ['class', 'data-mode'] }, function () {
      if (!h.classList.contains('io2')) desfazer();
      else iniciarApp();
    });
  } catch (e) {}
  try { iniciarApp(); } catch (e) {}
})();
