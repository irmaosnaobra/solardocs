/* io2-icones.js: no visual novo do /gerador, troca na TELA os emojis coloridos que fazem papel de icone por icones de
   traco unico (io2-icones.css). So age com html.io2, fora de iframe e em data-mode="app". Nao toca no codigo do app.
   Erro aqui nunca derruba a casca nem o app: tudo em try/catch, e o observador roda protegido.

   Como troca: olha os nos de TEXTO que estao dentro de uma LISTA FECHADA de elementos de tela (REGRAS) e troca o emoji
   conhecido por <span class="io2-ic io2-ic-NOME" data-io2-emoji="(o caractere)">(o caractere)</span>. O caractere
   continua dentro do span (a folha de estilo o recorta para fora da caixa do icone), entao o textContent do app e a
   busca por texto da prova seguem iguais. O innerText e a copia manual podem perder o emoji (o icone "nada" usa
   display:none e os icones nao sao selecionaveis); hoje o app nao le innerText em lugar nenhum. desfazer() devolve
   cada caractere ao lugar.
   O no de texto original e reaproveitado como texto do span e o resto do texto vira outro no (splitText): nada e
   removido, e o span e criado antes de cortar o texto, entao uma falha deixa o texto como estava.
   Percorre so os nos de texto acrescentados (TreeWalker), dentro do retorno do observador: roda antes da pintura.

   Nunca entram: texto de mensagem, historico gravado, documento e papel, campo, option, textarea, contenteditable
   (EXCLUIDOS). Emoji sem desenho fica como esta e entra em __io2Icones.desconhecidos().
   Nada escreve em location. Nenhum id, classe, atributo ou onclick do app e alterado; nenhum no muda de lugar. */
(function () {
  var h = document.documentElement;
  try {
    if (!h.classList.contains('io2')) return;
    if (window.self !== window.top) return;
  } catch (e) { return; }

  var RE;
  try {
    RE = new RegExp('\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*)*\\uFE0F?', 'gu');
  } catch (e) { return; }

  var RE_SO = new RegExp(RE.source, 'gu'); /* instancia propria: replace() zera o lastIndex do RE do laco */
  var observadores = [];
  var desfeito = false, iniciado = false, erros = 0, trocados = 0;
  var desconhecidos = {};

  function io2Ligado() { return !desfeito && h.classList.contains('io2'); }
  function modoApp() { return h.getAttribute('data-mode') === 'app'; }

  /* ------------------------------------------------------------------------------------------------
     Mapa: primeiro codepoint (hex) do emoji -> nome do icone.
       'nada'              = tirar o emoji (o span fica com display:none).
       ['nada', 'nome']    = tirar quando ha texto junto; se o controle e SO o emoji, desenha 'nome'.
     'nada' sozinho em controle so de emoji NAO e trocado (nunca deixa botao vazio).
     ------------------------------------------------------------------------------------------------ */
  var MAPA = {
    '274c': 'x', '2716': 'x', '26a1': 'raio', '1f4b0': 'moeda', '1f4b5': 'moeda', '26a0': 'alerta', '1f6a8': 'alerta',
    '1f4ca': 'grafico', '1f4c8': 'tendencia', '1f4c9': 'tendencia-baixo', '1f4c5': 'calendario', '2600': 'sol',
    '1f324': 'sol-nuvem', '23f3': 'relogio', '1f550': 'relogio', '23f0': 'relogio', '1f4cd': 'alfinete',
    '1f4c4': 'documento', '1f4d1': 'documento', '1f9fe': 'documento', '1f4cb': 'prancheta', '2705': 'confere',
    '1f4ac': 'conversa', '1f4f1': 'telefone', '1f4de': 'fone', '1f4f5': 'telefone-off', '1f504': 'atualizar',
    '1f4e5': 'baixar', '1f50e': 'buscar', '1f50d': 'buscar', '1f525': 'fogo', '2744': 'floco', '1f464': 'pessoa',
    '1f64b': 'pessoa', '1f465': 'pessoas', '1f9d4': 'pessoa', '1f3e0': 'casa', '1f511': 'chave', '1f50c': 'tomada',
    '1f91d': 'aperto', '1f6e0': 'ferramenta', '1f3af': 'alvo', '1f3e2': 'predio', '1f645': 'proibido',
    '1f6ab': 'proibido', '1f4b3': 'cartao', '1f3e6': 'banco', '1f48e': 'diamante', '1f50b': 'bateria',
    '1f4a1': 'lampada', '2699': 'ajustes', '1f4f7': 'camera', '1f4f8': 'camera', '1f5d1': 'lixeira', '1f5c2': 'pasta',
    '1f39f': 'ticket', '1f6aa': 'porta', '1f4ce': 'clipe', '1f3ac': 'video', '1f680': 'enviar', '1f441': 'olho', '1f512': 'cadeado', '2795': 'mais',
    '1f517': ['nada', 'link'], '270f': ['nada', 'lapis'],
    '1f91e': 'nada', '1f3c6': 'nada', '1f4be': 'nada'
  };
  /* Nome acessivel para controle (button, a, summary) que era so o emoji e nao tem title nem aria-label. */
  var ROTULO = {
    conversa: 'Conversa', atualizar: 'Atualizar', alfinete: 'Ver no mapa', calendario: 'Calendário', telefone: 'Telefone',
    fone: 'Ligar', link: 'Copiar link', lapis: 'Editar', grafico: 'Estatísticas', sol: 'Solar', raio: 'Eletroposto',
    x: 'Fechar', baixar: 'Baixar', lixeira: 'Remover', camera: 'Foto', documento: 'Documento', mais: 'Adicionar',
    buscar: 'Buscar', olho: 'Ver', pessoa: 'Pessoa'
  };

  /* ------------------------------------------------------------------------------------------------
     LISTA FECHADA de elementos de tela (conferida no index.html). modo:
       'todos' = todo emoji conhecido nos nos de texto do elemento (texto escrito no codigo, sem dado do banco);
       'ini'   = so o emoji que abre o primeiro texto do elemento (o resto e dado: cidade, motivo, nome);
       'exato' = so se o no inteiro for uma das frases de `re`.
     ------------------------------------------------------------------------------------------------ */
  var REGRAS = [
    /* CRM: colunas, abas, cartao, detalhe */
    ['.crm-col-tit', 'todos'], ['.crm-subtab', 'todos'], ['.crm-novo-contato', 'todos'], ['.crm-temp', 'todos'],
    ['.crm-act', 'todos'], ['.crm-status-selo', 'todos'],
    ['.crm-card-cid', 'ini'], ['.crm-card-ag', 'ini'], ['.crm-card-tel', 'ini'], ['.crm-espera', 'ini'],
    ['.crm-btn-status', 'todos'], ['.crm-btn-temp', 'todos'], ['.crm-det-limpar-temp', 'todos'], ['.crm-det-editar', 'todos'],
    ['.crm-det-acoes > *', 'todos'], ['#crm-det-sub', 'ini'], ['.bloqueado-tit', 'todos'], ['.motivo-btn', 'todos'], ['.motivo-bloquear', 'todos'],
    /* Historico de propostas e estatisticas */
    ['.historico-stat .lbl', 'todos'], ['.historico-secao > h4', 'todos'], ['.btn-hist-csv', 'todos'],
    ['#grafico-mes > div', 'ini'], ['#ranking-mes h3', 'ini'],
    ['#historico-tbody .acoes-mini button', 'todos'], ['#historico-tbody span[title]', 'todos'],
    ['#historico-tbody td', 'exato', /^\s*(?:☀️?|⚡️?) (?:Solar|Eletroposto)\s*$/],
    /* Gerar proposta e Tabelas */
    ['#formSection .btn-top', 'todos'], ['#edit-banner', 'todos'], ['#formSection .header .sun', 'todos'],
    ['#formSection .dica', 'todos'], ['#foto-pick', 'todos'], ['.pag-titulo', 'todos'], ['details.opt-block > summary', 'todos'],
    ['#campo-manual > div', 'todos'], ['#formSection .btn-principal', 'todos'], ['.header-titulo h1', 'ini'],
    ['#tabelasSection .tbl-rodape', 'todos'],
    /* Redes e Automacao */
    ['.redes-subtab', 'todos'], ['.redes-ia-head h3', 'todos'], ['.redes-ia-sub', 'todos'], ['.apres-btn', 'todos'],
    ['.auto-warn', 'todos'], ['.auto-lbl', 'todos'],
    /* Modais de tela e aviso */
    ['#modal-venda h3', 'ini'], ['#modal-duplicado h3', 'ini'], ['#modal-novo-contato h3', 'ini'], ['.dossie-topo h4', 'ini'],
    ['#toast', 'ini'],
    /* Linha do tempo do link da proposta: o circulo do evento e a linha do local */
    ['#histLinkBody div[style*="border-radius:50%"]', 'todos'], ['#histLinkBody div[style*="margin-top:2px"]', 'ini']
  ];
  var SEL_TODAS = REGRAS.map(function (r) { return r[0]; }).join(',');

  /* Zonas proibidas: documento e papel, mensagem, historico gravado, campo, e o que a casca e o app guardam por
     referencia. Se o elemento esta dentro de qualquer um, nada e trocado. */
  var EXCLUIDOS = [
    '.ep-doc', '.ep-page', '.ep-completo', '.ep-prev-folha', '.ep-prev-palco', '.ep-prev-scroll', '.nx-deck', '.nx-slide',
    '.simshot', '.orc1', '.orcview-palco', '.orcview-folha', '.pl-rx', '.soc-rx', '.sol-pb', '.sol-te', '.sol-vi',
    '.sol-card', '.sol-band', '.prop-header', '.preco-box', '.hero-economia', '.cta-fechamento', '.print-only',
    '.celebra-overlay', '#eletro-print', '#doc-print', '#propostaSection', '#expiradoSection', '#orcViewSection',
    '#loadingProposta', '#ep-prev-doc', '#orcview-folha', '#exp-cta-card', '#exp-cta-fallback', '#marr',
    '#crm-det-hist', '.crm-det-hist', '#pv-lista', '#pv-faixa', '#dossie-arquivos', '#dossie-bloco .dossie-slot',
    '#app-sidebar', '#io2-topo', '#io2-baixo', '#io2-folha', '#io2-faixa', '[data-io2]', '.io2-ic',
    'textarea', 'select', 'option', '[contenteditable]', 'script', 'style', 'noscript'
  ].join(',');

  /* Indice das regras pela ultima parte do seletor (classe, senao tag): achar a regra de um elemento custa
     poucas comparacoes em vez de 50 matches(). */
  var IDX_CLS = {}, IDX_TAG = {};
  (function () {
    for (var i = 0; i < REGRAS.length; i++) {
      var ult = REGRAS[i][0].split(/\s*>\s*|\s+/).pop();
      var c = ult.match(/\.([\w-]+)/);
      if (c) { (IDX_CLS[c[1]] = IDX_CLS[c[1]] || []).push(i); continue; }
      var t = ult.match(/^[a-z0-9*]+/);
      var k = t ? t[0] : '*';
      (IDX_TAG[k] = IDX_TAG[k] || []).push(i);
    }
  })();
  function regraDe(el) {
    var best = -1, i, j, l, c = el.classList;
    for (i = 0; i < c.length; i++) {
      l = IDX_CLS[c[i]];
      if (l) for (j = 0; j < l.length; j++) {
        if (best !== -1 && l[j] > best) continue;
        try { if (el.matches(REGRAS[l[j]][0])) best = l[j]; } catch (e) {}
      }
    }
    l = IDX_TAG[el.localName];
    if (l) for (j = 0; j < l.length; j++) {
      if (best !== -1 && l[j] > best) continue;
      try { if (el.matches(REGRAS[l[j]][0])) best = l[j]; } catch (e) {}
    }
    l = IDX_TAG['*'];
    if (l) for (j = 0; j < l.length; j++) {
      if (best !== -1 && l[j] > best) continue;
      try { if (el.matches(REGRAS[l[j]][0])) best = l[j]; } catch (e) {}
    }
    return best === -1 ? null : REGRAS[best];
  }

  /* Memorias que valem so dentro de UMA passada (a arvore nao muda de classe enquanto a passada roda). */
  var mHost = null, mExcl = null;
  function excluido(el) {
    if (!el) return false;
    var r = mExcl.get(el);
    if (r !== undefined) return r;
    try { r = el.matches(EXCLUIDOS) || excluido(el.parentElement); } catch (e) { r = true; }
    mExcl.set(el, r);
    return r;
  }
  /* O elemento-alvo mais proximo de `p` (ele mesmo ou ancestral), ou null. */
  function hostDe(p) {
    var r = mHost.get(p);
    if (r !== undefined) return r;
    r = null;
    for (var a = p; a && a !== document.body; a = a.parentElement) {
      var m = mHost.get(a);
      if (m !== undefined) { r = m; break; }
      var g = regraDe(a);
      if (g) { r = { el: a, regra: g }; break; }
    }
    mHost.set(p, r);
    return r;
  }

  function registrar(ch, cp) {
    if (parseInt(cp, 16) < 0x2000) return;
    desconhecidos[ch] = (desconhecidos[ch] || 0) + 1;
  }
  function soEmoji(host) {
    var t = (host.textContent || '').replace(RE_SO, '').replace(/[\s​️]+/g, '');
    return t === '';
  }
  function primeiroTexto(host) {
    var f = host.firstChild;
    if (f && f.nodeType === 3 && f.nodeValue && f.nodeValue.trim() !== '') return f;
    var w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) if (n.nodeValue && n.nodeValue.trim() !== '') return n;
    return null;
  }

  /* Pre-filtro barato: so passa para a expressao cheia o texto que tem algum caractere de emoji. */
  var PRE = /[←-⯿\uD83C-\uD83E]/;
  var NAO_TEXTO = { textarea: 1, option: 1, select: 1, script: 1, style: 1, noscript: 1 };

  /* Troca os emojis de UM no de texto. Cria os spans antes de mexer no DOM (se algo lancar, nada foi tocado) e
     depois faz so duas operacoes: o no original fica com o texto de antes do primeiro emoji e os spans entram
     junto. Nada e removido: textContent do pai nao muda. */
  function tratarTexto(tn) {
    var s = tn.nodeValue;
    if (!s || !PRE.test(s)) return;
    var p = tn.parentNode;
    if (!p || p.nodeType !== 1 || NAO_TEXTO[p.localName] || p.classList.contains('io2-ic')) return;
    var hh = hostDe(p);
    if (!hh) return;
    var host = hh.el, modo = hh.regra[1], re = hh.regra[2] || null;
    /* zona proibida: o proprio no pai (se nao e o alvo), o alvo e a cadeia de ancestrais (memorizada) */
    if (p !== host && excluido(p)) return;
    if (host.hasAttribute('data-io2') || host.hasAttribute('contenteditable') || excluido(host.parentElement)) return;
    if (re && !re.test(s)) return;
    if (modo !== 'todos') {
      if (s.trim() === '') return;
      if (primeiroTexto(host) !== tn) return;
    }
    RE.lastIndex = 0;
    var m, apenasIcone = null, achados = [];
    while ((m = RE.exec(s))) {
      var ch = m[0], cp = ch.codePointAt(0).toString(16);
      if (modo !== 'todos' && (achados.length > 0 || s.slice(0, m.index).trim() !== '')) break;
      var nome = MAPA[cp], alt = null;
      if (nome && typeof nome !== 'string') { alt = nome[1]; nome = nome[0]; }
      if (!nome) { registrar(ch, cp); if (modo !== 'todos') break; continue; }
      if (nome === 'nada') {
        if (apenasIcone === null) apenasIcone = soEmoji(host);
        if (apenasIcone) { if (alt) nome = alt; else continue; }
      }
      achados.push([m.index, ch, nome]);
      if (modo !== 'todos') break;
    }
    if (!achados.length) return;
    var nomes = [], antes = achados[0][0];
    function novoSpan(a) {
      var sp = document.createElement('span');
      sp.className = 'io2-ic io2-ic-' + a[2];
      sp.setAttribute('aria-hidden', 'true');
      sp.setAttribute('data-io2', '1');
      sp.setAttribute('data-io2-emoji', a[1]);
      sp.textContent = a[1];
      return sp;
    }
    if (achados.length === 1 && antes === 0) {
      /* caso comum (emoji que abre o texto): o span entra antes do no, que fica so com o resto. 2 operacoes. */
      var sp1 = novoSpan(achados[0]);
      /* Primeiro o span entra, so depois o texto e cortado: se a insercao falhar, o emoji continua na tela. */
      p.insertBefore(sp1, tn);
      tn.nodeValue = s.slice(achados[0][1].length);
      nomes.push(achados[0][2]);
    } else {
      var frag = document.createDocumentFragment(), ult = antes;
      for (var i = 0; i < achados.length; i++) {
        var a = achados[i];
        if (a[0] > ult) frag.appendChild(document.createTextNode(s.slice(ult, a[0])));
        frag.appendChild(novoSpan(a));
        nomes.push(a[2]);
        ult = a[0] + a[1].length;
      }
      if (ult < s.length) frag.appendChild(document.createTextNode(s.slice(ult)));
      tn.nodeValue = s.slice(0, antes);
      p.insertBefore(frag, tn.nextSibling);
    }
    trocados += nomes.length;
    /* controle que era so o emoji e nao tem nome acessivel */
    try {
      var t = host.tagName;
      if ((t === 'BUTTON' || t === 'A' || t === 'SUMMARY') && nomes.length === 1 && ROTULO[nomes[0]] &&
          !host.hasAttribute('title') && !host.hasAttribute('aria-label') && !host.hasAttribute('aria-labelledby') &&
          soEmoji(host)) {
        host.setAttribute('aria-label', ROTULO[nomes[0]]);
        host.setAttribute('data-io2-aria', '1');
      }
    } catch (e) {}
  }

  function falhou() {
    erros++;
    if (erros > 20) desfazer(); /* algo esta errado de forma repetida: devolve o app ao que era */
  }

  /* Percorre os nos de texto de `raiz` (ou trata o proprio no, se for texto). */
  function varrer(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) { try { tratarTexto(raiz); } catch (e) { falhou(); } return; }
    if (raiz.nodeType !== 1 || raiz.hasAttribute('data-io2') || raiz.classList.contains('io2-ic')) return;
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null), n, lst = [];
    /* coleta primeiro: tratarTexto corta nos e mexe na arvore que o percurso esta lendo */
    while ((n = w.nextNode())) { var v = n.nodeValue; if (v && PRE.test(v)) lst.push(n); }
    for (var i = 0; i < lst.length; i++) { try { tratarTexto(lst[i]); } catch (e) { falhou(); } }
  }
  function passada(f) {
    mHost = new WeakMap(); mExcl = new WeakMap();
    try { f(); } finally { mHost = null; mExcl = null; }
  }

  var obs = null;
  function aoMudar(muts) {
    try {
      if (!io2Ligado() || !modoApp()) return;
      passada(function () {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'characterData') { varrer(m.target); continue; }
          var add = m.addedNodes;
          for (var j = 0; j < add.length; j++) varrer(add[j]);
        }
      });
      /* descarta o que as proprias trocas acabaram de gerar (nao reprocessa nem faz laco) */
      if (obs) obs.takeRecords();
    } catch (e) { falhou(); }
  }

  function desfazer() {
    if (desfeito) return;
    desfeito = true;
    try { observadores.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); } catch (e) {}
    try {
      var q = document.querySelectorAll('[data-io2-emoji]');
      for (var i = 0; i < q.length; i++) {
        var sp = q[i];
        if (sp.parentNode) sp.parentNode.replaceChild(document.createTextNode(sp.getAttribute('data-io2-emoji') || ''), sp);
      }
    } catch (e) {}
    try {
      var a = document.querySelectorAll('[data-io2-aria]');
      for (var k = 0; k < a.length; k++) { a[k].removeAttribute('aria-label'); a[k].removeAttribute('data-io2-aria'); }
    } catch (e) {}
  }

  function iniciarApp() {
    if (iniciado || desfeito || !modoApp()) return;
    iniciado = true;
    try { passada(function () { varrer(document.body); }); } catch (e) { falhou(); }
    try {
      obs = new MutationObserver(aoMudar);
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      observadores.push(obs);
    } catch (e) {}
  }

  try {
    var ob = new MutationObserver(function () {
      try { if (!h.classList.contains('io2')) desfazer(); else iniciarApp(); } catch (e) {}
    });
    ob.observe(h, { attributes: true, attributeFilter: ['class', 'data-mode'] });
    observadores.push(ob);
  } catch (e) {}

  try {
    window.__io2Icones = {
      desfazer: desfazer,
      processar: function (raiz) { try { passada(function () { varrer(raiz || document.body); }); } catch (e) {} },
      desconhecidos: function () { return JSON.parse(JSON.stringify(desconhecidos)); },
      trocados: function () { return trocados; },
      erros: function () { return erros; }
    };
  } catch (e) {}

  try { iniciarApp(); } catch (e) {}
})();
