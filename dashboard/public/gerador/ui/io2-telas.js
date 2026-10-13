/* io2-telas.js: comportamento por tela do visual novo do /gerador. So age com html.io2 e em data-mode="app".
   Erro aqui nunca derruba a casca nem o app: cada bloco tem o seu try/catch, e cada callback (observador,
   ouvinte, temporizador) tambem, porque eles rodam depois que o try de montagem ja terminou.
   Nao envolve funcao do app, nao move no, nao escreve em location, nao renomeia id nem classe do app.
   Blocos: (A) texto longo recolhido, (B) faixa de resultado do Simulador no celular,
   (C) remendos de acessibilidade em tempo de execucao, (D) Inicio: marcas de proporcao para a trena e indicador zerado,
   (D2) Inicio em painel: rotulo curto dos indicadores (atributo), funil em tabela com trena e rosca do desfecho (nos novos, com data-io2),
   (E) acabamento: trena do funil (SVG), indicador zerado no CRM e em Quem ligar, chip ativo de Leads, avatar sem foto na Automacao,
   filtros de Cadastros numa fileira so (os select de #cad-acoes sao movidos para div.io2-cad-filtros; desfazer() devolve),
   celulas de Cadastros que so tem o traco de vazio (data-io2-vazio; o CSS do celular esconde).
   Tudo o que este arquivo acrescenta fica marcado (data-io2, data-io2-*) para desfazer() devolver o app ao que era. */
(function () {
  var h = document.documentElement;
  try {
    if (!h.classList.contains('io2')) return;
    if (window.self !== window.top) return;
  } catch (e) { return; }

  var criados = [];       /* nos que este arquivo pos no DOM (nunca podado: so desfazer() mexe) */
  var trenas = [];        /* nos da trena do funil: o app descarta e refaz o svg, entao so esta lista e podada */
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
        /* Nenhuma obra: o cartao marinho mostra uma frase so (CSS), em vez de cinco zeros. */
        if (m && tot === 0) { if (!ob.hasAttribute('data-io2-obras-vazio')) ob.setAttribute('data-io2-obras-vazio', '1'); }
        else if (ob.hasAttribute('data-io2-obras-vazio')) ob.removeAttribute('data-io2-obras-vazio');
      }
      /* Time: avanco sobre agendados, lido da celula ("36%"). */
      var cs = sec.querySelectorAll('.in-time td[data-r="Avanço sobre agendados"]');
      for (var j = 0; j < cs.length; j++) {
        var mm = /^\s*(\d{1,3})\s*%\s*$/.exec(cs[j].textContent || '');
        inicioMarcar(cs[j], mm ? +mm[1] : null);
      }
    } catch (e) {}
    try { trenaFunil(); } catch (e) {}
    try { painelInicio(); } catch (e) {}
  }

  /* ------------------------------------------------------------------------------------------------
     (D2) Inicio em painel. Tres pecas, todas feitas so com o que o app ja mostra:
       indicadores: rotulo curto e pilula de contexto, postos como atributo em .in-t (data-io2-rot, data-io2-sub, data-io2-tom)
                    e lidos do proprio botao (data-d, numero e detalhe). A frase inteira vira a dica (title, com a
                    marca data-io2-tit). Nenhum no e criado nem movido; o clique segue o do app.
       funil em tabela: para cada produto que o app desenhou (.pq-graf[data-g="fn-..."]), uma tabela de tres linhas
                    com trena, lida dos aria-label das barras do SVG do app (rotulo e valor ja formatados por ele).
       rosca do desfecho: um cartao novo ao lado, com a divisao dos agendamentos do periodo. Os numeros vem da mesma
                    variavel que o app usa para o funil (inDados.resumo.dados.funil) e so dos produtos desenhados;
                    se o total nao bater com o que esta na tela, a rosca nao e desenhada.
     O app refaz a grade por innerHTML: os nos daqui somem junto e este bloco refaz. A marca data-io2-painel no
     cartao do funil (no do app, que nasce sem ela) impede refazer duas vezes; nada aqui compara conteudo.
     Os nos ficam na lista "painel", podada dos que o app ja descartou; desfazer() tira o resto.
     ------------------------------------------------------------------------------------------------ */
  var painel = [];
  var ROTULOS = {
    agenda: ['Atendimento hoje', 'Atendimentos hoje'], quentes: ['Cliente quente', 'Clientes quentes'],
    vencidos: ['Agendado vencido', 'Agendados vencidos'], obras: ['Obra parada', 'Obras paradas'],
    quiz: ['Quiz sem horário', 'Quiz sem horário'], areceber: ['A receber', 'A receber']
  };
  function txt(n) { return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function numBR(n) { try { return Number(n).toLocaleString('pt-BR'); } catch (e) { return String(n); } }
  function novoNo(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }
  /* Linha de contexto curta, tirada da frase de detalhe que o app escreveu. Sem casar, devolve vazio e o CSS mostra o detalhe. */
  function contextoCurto(d, det, frase) {
    var m, lim;
    if (d === 'agenda') { m = /Próximo às (\d{1,2}:\d{2})/.exec(det); return m ? ['Próximo: ' + m[1], ''] : null; }
    if (d === 'quentes') { m = /(\d+) deles? com o orçamento vencendo/.exec(det); return m ? [m[1] + ' vencendo', 'av'] : null; }
    if (d === 'vencidos') {
      m = /há (\d+ dias?)/.exec(det);
      if (m) return [(/mais antigo/.test(det) ? 'Há até ' : 'Há ') + m[1], 'er'];
      return /^Dê um destino/.test(det) ? ['Dê um destino', 'er'] : null;
    }
    if (d === 'obras') {
      /* O corte ("15 dias ou mais") vem da frase do app e continua na tela junto com a maior espera. */
      lim = /há (\d+) dias ou mais/.exec(frase); m = /há (\d+) dias?/.exec(det);
      if (lim && m && +m[1] > +lim[1] && /mais espera/.test(det)) return ['Há ' + lim[1] + ' a ' + m[1] + ' dias', 'av'];
      if (m) return ['Há ' + m[1] + (m[1] === '1' ? ' dia' : ' dias'), 'av'];
      return lim ? ['Há ' + lim[1] + ' dias ou mais', 'av'] : null;
    }
    if (d === 'quiz') { m = /últimos (\d+ dias?)/.exec(det); return m ? ['Últimos ' + m[1], ''] : null; }
    if (d === 'areceber') {
      /* Venda sem valor na planilha: o total e parcial e o aviso nao pode sair da tela. A pilula leva os dois fatos da frase do app
         ("6 vendas, 1 sem valor"), em cor de aviso. Se a frase nao casar, o CSS mostra o detalhe inteiro do app, tambem em aviso. */
      m = /Em (\d+) (vendas?)/.exec(det);
      if (/sem valor/.test(det)) {
        var sv = /(\d+) delas? sem valor/.exec(det);
        if (!sv) return ['', 'av'];
        return [(m ? m[1] + ' ' + m[2] + ', ' : '') + sv[1] + ' sem valor', 'av'];
      }
      return m ? [m[0], ''] : null;
    }
    return null;
  }
  function indicadoresInicio(sec) {
    var bs = sec.querySelectorAll('#in-pede button.in-linha[data-d]');
    for (var i = 0; i < bs.length; i++) {
      try {
        var b = bs[i], t = b.querySelector('.in-t');
        if (!t || t.hasAttribute('data-io2-rot')) continue;
        var par = ROTULOS[b.getAttribute('data-d')];
        if (!par) continue;
        var frase = txt(b.querySelector('.in-f')), det = txt(b.querySelector('.in-d'));
        t.setAttribute('data-io2-rot', /^1$/.test(txt(b.querySelector('.in-n'))) ? par[0] : par[1]);
        var curto = contextoCurto(b.getAttribute('data-d'), det, frase);
        if (curto && curto[0]) t.setAttribute('data-io2-sub', curto[0]);
        if (curto && curto[1]) t.setAttribute('data-io2-tom', curto[1]);
        if (frase && !b.hasAttribute('title')) {
          b.setAttribute('title', frase + (det ? '. ' + det : ''));
          b.setAttribute('data-io2-tit', '1');
        }
      } catch (e) {}
    }
  }
  /* Le as barras que o app desenhou num funil: [{ rotulo, valor (texto do app), n (numero) }]. */
  function barrasDoFunil(graf) {
    var out = [], alvos = graf.querySelectorAll('svg > rect.pq-alvo[aria-label]');
    for (var i = 0; i < alvos.length; i++) {
      var m = /^(.*?):\s*(.+)$/.exec(alvos[i].getAttribute('aria-label') || '');
      if (!m) return [];
      var d = /^[\d.]+/.exec(m[2]);
      if (!d) return [];
      out.push({ rotulo: m[1], valor: m[2], n: parseInt(d[0].replace(/\./g, ''), 10) || 0 });
    }
    return out;
  }
  function funilTabela(fn, graf, linhas, maximo, nome) {
    var tab = novoNo('table', 'io2-fn-tab');
    tab.setAttribute('data-io2', '1');
    var cap = novoNo('caption', '', 'Funil de ' + nome.toLowerCase());
    cap.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    tab.appendChild(cap);
    var corpo = novoNo('tbody');
    var de = ['', 'dos que agendaram', 'dos que conversaram'];
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i], tr = novoNo('tr');
      var th = novoNo('th', '', l.rotulo); th.setAttribute('scope', 'row');
      var tdB = novoNo('td', 'io2-fn-b'), fita = novoNo('span', 'io2-trena');
      fita.style.setProperty('--io-p', (maximo > 0 ? Math.max(0, Math.min(100, Math.round(l.n / maximo * 1000) / 10)) : 0) + '%');
      fita.setAttribute('aria-hidden', 'true');
      tdB.appendChild(fita);
      var pc = /(\d+%)\s*$/.exec(l.valor);
      if (pc && linhas.length === 3 && de[i]) tr.setAttribute('title', pc[1] + ' ' + de[i]);
      tr.appendChild(th); tr.appendChild(tdB); tr.appendChild(novoNo('td', 'io2-fn-v', l.valor));
      corpo.appendChild(tr);
    }
    tab.appendChild(corpo);
    fn.insertBefore(tab, graf.nextSibling);
    painel.push(tab);
  }
  var FATIAS = [['av', 'Avançaram'], ['conv', 'Demais conversas'], ['sem', 'Sem interesse'], ['nao', 'Não atenderam'], ['can', 'Cancelados'], ['agu', 'Aguardando']];
  function roscaCartao(grade, estado, soma, velho) {
    var card = novoNo('section', 'in-card io2-rosca');
    card.setAttribute('data-io2', '1');
    card.setAttribute('aria-label', 'Desfecho dos agendamentos');
    card.appendChild(novoNo('h3', '', 'Desfecho dos agendamentos'));
    /* Dado de outro periodo com a leitura nova a caminho: o mesmo esmaecido que o app poe no funil. */
    if (velho) { card.classList.add('pq-recarregando'); card.setAttribute('aria-busy', 'true'); }
    if (estado === 'esq') {
      card.setAttribute('aria-busy', 'true');
      var sk = novoNo('div', 'in-sk'); sk.setAttribute('aria-hidden', 'true');
      var s1 = novoNo('div', 'pq-sk'), s2 = novoNo('div', 'pq-sk');
      s1.style.width = '60%'; s2.style.height = '120px';
      sk.appendChild(s1); sk.appendChild(s2); card.appendChild(sk);
    } else if (estado === 'erro' || !soma) {
      card.appendChild(novoNo('p', 'in-fr sec', 'Sem leitura dos agendamentos agora.'));
    } else if (!(soma.total > 0)) {
      card.appendChild(novoNo('p', 'in-fr sec', 'Nenhum agendamento no período.'));
    } else {
      var T = soma.total;
      card.appendChild(novoNo('p', 'in-fr sec', numBR(T) + (T === 1 ? ' agendamento no período.' : ' agendamentos no período.')));
      var corpo = novoNo('div', 'io2-rosca-corpo'), g = novoNo('div', 'io2-rosca-g');
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      var trilho = document.createElementNS(SVGNS, 'circle');
      trilho.setAttribute('class', 'io2-rosca-trilho'); trilho.setAttribute('cx', '60'); trilho.setAttribute('cy', '60'); trilho.setAttribute('r', '50');
      svg.appendChild(trilho);
      var leg = novoNo('ul', 'io2-rosca-leg'), ini = 0, vivas = 0, k;
      for (k = 0; k < FATIAS.length; k++) if (soma[FATIAS[k][0]] > 0) vivas++;
      /* Percentual inteiro por fatia fechando em 100: parte inteira e o que falta vai para os maiores restos. */
      var pct = {}, restos = [], falta = 100;
      for (k = 0; k < FATIAS.length; k++) { var ch0 = FATIAS[k][0], ex = soma[ch0] / T * 100; pct[ch0] = Math.floor(ex); falta -= pct[ch0]; restos.push([ex - pct[ch0], ch0]); }
      restos.sort(function (a, b) { return b[0] - a[0]; });
      for (k = 0; k < restos.length && falta > 0; k++, falta--) pct[restos[k][1]]++;
      for (k = 0; k < FATIAS.length; k++) {
        var ch = FATIAS[k][0], v = soma[ch];
        if (!(v > 0) && ch !== 'av') continue;
        var p = v / T * 100;
        /* O que ainda aguarda nao tem fatia: e o proprio trilho da rosca. */
        if (v > 0 && ch !== 'agu') {
          var c = document.createElementNS(SVGNS, 'circle');
          c.setAttribute('class', 'io2-s-' + ch); c.setAttribute('cx', '60'); c.setAttribute('cy', '60'); c.setAttribute('r', '50');
          c.setAttribute('pathLength', '100');
          var arco = vivas > 1 ? Math.max(0.6, p - 0.8) : p;
          c.setAttribute('stroke-dasharray', arco.toFixed(2) + ' ' + (100 - arco).toFixed(2));
          c.setAttribute('stroke-dashoffset', (-ini).toFixed(2));
          svg.appendChild(c);
        }
        ini += p;
        var li = novoNo('li');
        var pt = novoNo('span', 'io2-pt io2-s-' + ch); pt.setAttribute('aria-hidden', 'true');
        li.appendChild(pt); li.appendChild(novoNo('span', 'io2-nm', FATIAS[k][1]));
        li.appendChild(novoNo('span', 'io2-qt', numBR(v))); li.appendChild(novoNo('span', 'io2-pc', pct[ch] + '%'));
        leg.appendChild(li);
      }
      g.appendChild(svg);
      var centro = novoNo('div', 'io2-rosca-centro');
      centro.appendChild(novoNo('b', '', pct.av + '%'));
      centro.appendChild(novoNo('span', '', 'avançaram'));
      centro.appendChild(novoNo('span', '', 'dos agendados'));
      centro.setAttribute('title', numBR(soma.av) + ' de ' + numBR(T) + ' agendamentos avançaram');
      g.appendChild(centro);
      corpo.appendChild(g); corpo.appendChild(leg); card.appendChild(corpo);
    }
    grade.appendChild(card);
    painel.push(card);
  }
  /* Agenda de hoje: no computador o nome fica numa linha so; o nome inteiro vira a dica. */
  function agendaInicio(sec) {
    var ns = sec.querySelectorAll('#in-agenda .in-prox .in-cli:not([title]), #in-agenda .in-prox .in-meta > span:not([class]):not([title]), .in-card[data-c="funil"] .in-fn > .in-fr:not([title])');
    for (var i = 0; i < ns.length; i++) { var t = txt(ns[i]); if (t) { ns[i].setAttribute('title', t); ns[i].setAttribute('data-io2-tit', '1'); } }
  }
  /* Valor em reais nunca quebra entre "R$" e o numero: o espaco comum que o app escreve vira espaco sem quebra, so no texto
     (frases de vendas e de anuncios e o numero do indicador). O app refaz esses nos a cada desenho; desfazer() devolve o espaco. */
  function reaisSemQuebra(sec) {
    var alvos = sec.querySelectorAll('.in-card[data-c="vendas"] .in-fr, .in-card[data-c="anuncios"] .in-fr, #in-pede .in-n.din');
    for (var i = 0; i < alvos.length; i++) {
      var n = alvos[i].firstChild;
      for (; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.nodeValue.indexOf('R$ ') >= 0) { n.nodeValue = n.nodeValue.replace(/R\$ /g, 'R$\u00a0'); alvos[i].setAttribute('data-io2-rs', '1'); }
      }
    }
  }
  function reaisDevolver() {
    var q = document.querySelectorAll('[data-io2-rs]');
    for (var i = 0; i < q.length; i++) {
      for (var n = q[i].firstChild; n; n = n.nextSibling) { if (n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/R\$\u00a0/g, 'R$ '); }
      q[i].removeAttribute('data-io2-rs');
    }
  }
  /* Grafico de linha: um ponto em cada valor (cor da serie, miolo branco), lido dos pontos da linha que o app desenhou.
     So entra quando ha pelo menos 12 px entre um valor e o seguinte; em periodo longo fica o ponto final do app. */
  function pontosDaLinha(sec) {
    var svg = sec.querySelector('.in-card[data-c="dia"] .pq-graf[data-g="dia"] > svg');
    if (!svg || svg.hasAttribute('data-io2-pontos')) return;
    svg.setAttribute('data-io2-pontos', '0');
    var linhas = svg.querySelectorAll(':scope > polyline[points]'), feitos = 0, todas = linhas.length > 0;
    for (var i = 0; i < linhas.length; i++) {
      var pts = (linhas[i].getAttribute('points') || '').trim().split(/\s+/);
      if (pts.length < 2 || !(Math.abs(parseFloat(pts[1]) - parseFloat(pts[0])) >= 12)) { todas = false; continue; }
    }
    if (!todas) return;
    for (i = 0; i < linhas.length; i++) {
      var ps = linhas[i].getAttribute('points').trim().split(/\s+/), ref = linhas[i].nextSibling;
      for (var k = 0; k < ps.length; k++) {
        var xy = ps[k].split(',');
        if (xy.length !== 2 || !isFinite(parseFloat(xy[0])) || !isFinite(parseFloat(xy[1]))) continue;
        var c = svgNo('circle', { 'class': 'io2-pt-linha', cx: xy[0], cy: xy[1], r: '3.5', stroke: linhas[i].getAttribute('stroke') || '' });
        svg.insertBefore(c, ref); painel.push(c); feitos++;
      }
    }
    if (feitos) svg.setAttribute('data-io2-pontos', '1');
  }
  /* Os dois cartoes que rolam por dentro levam data-io2-mais enquanto ha conteudo abaixo: so entao o pe esmaece. */
  var rolQuadro = 0;
  function marcarRolagem() {
    rolQuadro = 0;
    if (!io2Ligado() || !modoApp()) return;
    var sec = document.getElementById('inicioSection');
    if (!sec) return;
    var alvos = sec.querySelectorAll('#in-agenda > .in-ag, .in-card[data-c="time"]');
    for (var i = 0; i < alvos.length; i++) {
      var a = alvos[i], mais = a.scrollHeight - a.clientHeight - a.scrollTop > 2;
      if (mais && !a.hasAttribute('data-io2-mais')) a.setAttribute('data-io2-mais', '1');
      else if (!mais && a.hasAttribute('data-io2-mais')) a.removeAttribute('data-io2-mais');
    }
  }
  function agendarRolagem() { if (!rolQuadro) rolQuadro = (window.requestAnimationFrame || setTimeout)(function () { try { marcarRolagem(); } catch (e) {} }, 16); }
  function painelInicio() {
    if (!io2Ligado() || !modoApp()) return;
    var sec = document.getElementById('inicioSection');
    if (!sec) return;
    for (var z = painel.length - 1; z >= 0; z--) { if (!painel[z] || !painel[z].isConnected) painel.splice(z, 1); }
    indicadoresInicio(sec);
    try { agendaInicio(sec); } catch (e) {}
    try { reaisSemQuebra(sec); } catch (e) {}
    try { pontosDaLinha(sec); } catch (e) {}
    try { marcarRolagem(); } catch (e) {}
    var card = sec.querySelector('.in-card[data-c="funil"]');
    if (!card || card.hasAttribute('data-io2-painel')) return;
    var grade = card.closest ? card.closest('.in-per-grade') : null;
    if (!grade) return;
    card.setAttribute('data-io2-painel', '1');
    var estado = card.querySelector('.in-sk') ? 'esq' : (card.querySelector('.in-erro') ? 'erro' : 'ok');
    var soma = null;
    if (estado === 'ok') {
      var fns = card.querySelectorAll('.in-fn'), lidos = [], maximo = 0, ilegivel = false, i;
      for (i = 0; i < fns.length; i++) {
        var graf = fns[i].querySelector('.pq-graf[data-g^="fn-"]');
        if (!graf) continue;
        var linhas = barrasDoFunil(graf);
        /* Grafico desenhado mas barras que nao deu para ler: a rosca nao pode afirmar um total menor que o da tela. */
        if (!linhas.length) { ilegivel = true; continue; }
        lidos.push({ fn: fns[i], graf: graf, linhas: linhas, chave: graf.getAttribute('data-g').slice(3) });
        if (linhas[0].n > maximo) maximo = linhas[0].n;
      }
      for (i = 0; i < lidos.length; i++) {
        try { funilTabela(lidos[i].fn, lidos[i].graf, lidos[i].linhas, maximo, txt(lidos[i].fn.querySelector('.in-fn-t')) || lidos[i].chave); } catch (e) {}
      }
      /* Rosca: a mesma leitura do funil, so dos produtos que o app desenhou. O total tem que bater com a tela. */
      try {
        var d = window.inDados && window.inDados.resumo && window.inDados.resumo.dados;
        var funil = d && d.funil;
        if (funil && !ilegivel) {
          soma = { total: 0, av: 0, conv: 0, sem: 0, nao: 0, can: 0, agu: 0 };
          var num = function (v) { v = Number(v); return isFinite(v) && v > 0 ? Math.round(v) : 0; };
          for (i = 0; i < lidos.length && soma; i++) {
            var f = funil[lidos[i].chave];
            if (!f || num(f.agendaram) !== lidos[i].linhas[0].n) { soma = null; break; }
            var ag = num(f.agendaram), av = num(f.avancaram), sem = num(f.semInteresse), nao = num(f.naoAtendeu), can = num(f.cancelados), agu = num(f.aguardando);
            var resto = ag - av - sem - nao - can - agu;
            if (resto < 0) { soma = null; break; }
            soma.total += ag; soma.av += av; soma.sem += sem; soma.nao += nao; soma.can += can; soma.agu += agu; soma.conv += resto;
          }
        }
      } catch (e) { soma = null; }
    }
    try { roscaCartao(grade, estado, soma, card.classList.contains('pq-recarregando')); } catch (e) {}
  }
  function agendarInicio() { if (!inicioQuadro) inicioQuadro = (window.requestAnimationFrame || setTimeout)(decorarInicio, 16); }
  function inicioLigar() {
    var sec = document.getElementById('inicioSection');
    if (!sec) return;
    observar(sec, { childList: true, subtree: true }, agendarInicio);
    try { ouvir(sec, 'scroll', agendarRolagem, true); ouvir(window, 'resize', agendarRolagem, false); } catch (e) {}
    decorarInicio();
    /* A grade mudou de largura em relacao ao CSS antigo: o Inicio so redesenha grafico no resize, e a tela ja pode ter desenhado. */
    try { setTimeout(function () { try { if (io2Ligado()) window.dispatchEvent(new Event('resize')); } catch (e) {} }, 80); } catch (e) {}
  }

  /* ------------------------------------------------------------------------------------------------
     (E) Acabamento. Nada aqui move no, cria id em campo ou toca no que vai ao servidor.
     E1 trenaFunil: o funil do Inicio e SVG desenhado pelo app (path com fill). Aqui entram, por barra, um trilho
        (rect antes) e uma camada de marcas de 10% (rect depois, com <pattern>). Os nos novos levam data-io2 e
        saem no desfazer(); o svg ja tratado leva data-io2-trena e o redesenho do app (svg novo) e tratado de novo.
     E2 zerar: marca data-io2-zero no indicador de valor zero (CRM e Quem ligar); o CSS tira a cor de estado.
     E3 chipAtivo: Leads, ate 860 px, traz o chip ativo para a vista rolando SO o conteiner (scrollLeft).
     E4 avatarSemFoto: imagem do Instagram que nao carrega (Automacao, bloco da conexao) vira circulo com a inicial.
     ------------------------------------------------------------------------------------------------ */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgNo(tipo, attrs) {
    var n = document.createElementNS(SVGNS, tipo);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    n.setAttribute('data-io2', '1');
    return n;
  }
  function trenaFunil() {
    if (!io2Ligado() || !modoApp()) return;
    var sec = document.getElementById('inicioSection');
    if (!sec) return;
    /* Tira de trenas os nos que o app ja descartou (redesenho do Inicio). criados nao e tocado. */
    for (var k = trenas.length - 1; k >= 0; k--) { if (!trenas[k] || !trenas[k].isConnected) trenas.splice(k, 1); }
    var svgs = sec.querySelectorAll('.in-card[data-c="funil"] .pq-graf svg');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      try {
        if (svg.hasAttribute('data-io2-trena')) continue;
        var barras = svg.querySelectorAll(':scope > path[fill]');
        if (!barras.length) continue;
        /* Largura da trena: do primeiro ao ultimo traco vertical da grade (o 0 e o fim do eixo). */
        var xs = [], ls = svg.querySelectorAll(':scope > line');
        for (var a = 0; a < ls.length; a++) {
          if (ls[a].getAttribute('x1') === ls[a].getAttribute('x2')) xs.push(parseFloat(ls[a].getAttribute('x1')));
        }
        var vb = svg.viewBox && svg.viewBox.baseVal;
        var x0 = xs.length ? Math.min.apply(null, xs) : 0;
        var x1 = xs.length ? Math.max.apply(null, xs) : (vb ? vb.width : 0);
        var larg = x1 - x0;
        if (!(larg > 20)) continue;
        var itens = [];
        for (var b = 0; b < barras.length; b++) {
          var bx = barras[b].getBBox();
          if (bx.height > 0) itens.push([barras[b], bx]);
        }
        if (!itens.length) continue;
        /* Linha de valor zero: o app nao desenha barra (path), mas cada linha tem um rect.pq-alvo com a faixa dela (passo
           de 40). A barra fica a uma distancia fixa do topo da faixa, medida nas linhas que tem barra: so desenha se essa
           distancia e a altura saem iguais em todas as barras. Sem isso (ou sem faixa), a linha fica sem trilho. */
        var vazias = [];
        try {
          var alvos = svg.querySelectorAll(':scope > rect.pq-alvo'), dev = null, alt = null, coerente = true;
          var porLinha = [];
          for (var q = 0; q < alvos.length; q++) {
            var ay = parseFloat(alvos[q].getAttribute('y')), ah = parseFloat(alvos[q].getAttribute('height'));
            var dono = null;
            for (var r = 0; r < itens.length; r++) {
              var by = itens[r][1].y;
              if (by >= ay && by < ay + ah) { dono = itens[r]; break; }
            }
            if (dono) {
              var d1 = Math.round((dono[1].y - ay) * 100) / 100, h1 = Math.round(dono[1].height * 100) / 100;
              if (dev === null) { dev = d1; alt = h1; } else if (dev !== d1 || alt !== h1) coerente = false;
            }
            porLinha.push({ alvo: alvos[q], ay: ay, dono: dono });
          }
          if (coerente && dev !== null && dev > 0 && alt > 0) {
            for (var w = 0; w < porLinha.length; w++) {
              if (!porLinha[w].dono && isFinite(porLinha[w].ay)) vazias.push([porLinha[w].alvo, porLinha[w].ay + dev, alt]);
            }
          }
        } catch (e) { vazias = []; }
        var feitas = [];
        var pid = 'io2-trena-' + (++contador);
        var passo = larg / 10;
        var defs = svgNo('defs', {});
        var pat = svgNo('pattern', { id: pid, patternUnits: 'userSpaceOnUse', x: String(x0), y: '0', width: String(passo), height: '400' });
        pat.appendChild(svgNo('line', { 'class': 'io2-marca', x1: String(passo - 0.5), x2: String(passo - 0.5), y1: '0', y2: '400' }));
        defs.appendChild(pat);
        svg.insertBefore(defs, svg.firstChild); feitas.push(defs);
        for (var c = 0; c < itens.length; c++) {
          var p = itens[c][0], g = itens[c][1];
          var trilho = svgNo('rect', { 'class': 'io2-trilho', x: String(x0), y: String(g.y), width: String(larg), height: String(g.height), rx: '4' });
          var marcas = svgNo('rect', { 'class': 'io2-marcas', x: String(x0), y: String(g.y), width: String(larg), height: String(g.height), rx: '4', fill: 'url(#' + pid + ')' });
          svg.insertBefore(trilho, p); feitas.push(trilho);
          svg.insertBefore(marcas, p.nextSibling); feitas.push(marcas);
        }
        for (var v = 0; v < vazias.length; v++) {
          var trilhoV = svgNo('rect', { 'class': 'io2-trilho', x: String(x0), y: String(vazias[v][1]), width: String(larg), height: String(vazias[v][2]), rx: '4' });
          var marcasV = svgNo('rect', { 'class': 'io2-marcas', x: String(x0), y: String(vazias[v][1]), width: String(larg), height: String(vazias[v][2]), rx: '4', fill: 'url(#' + pid + ')' });
          svg.insertBefore(trilhoV, vazias[v][0]); feitas.push(trilhoV);
          svg.insertBefore(marcasV, vazias[v][0]); feitas.push(marcasV);
        }
        for (var d = 0; d < feitas.length; d++) trenas.push(feitas[d]);
        svg.setAttribute('data-io2-trena', '1');
      } catch (e) {}
    }
  }

  var ZEROS = [['#crmSection .crm-kpi', '.crm-kpi-val'], ['#quemLigarSection .ql-num', 'b']];
  function zerar() {
    if (!io2Ligado() || !modoApp()) return;
    for (var z = 0; z < ZEROS.length; z++) {
      var ks = document.querySelectorAll(ZEROS[z][0]);
      for (var i = 0; i < ks.length; i++) {
        try {
          var v = ks[i].querySelector(ZEROS[z][1]);
          var zero = !!v && /^\s*(R\$\s*)?0([.,]0+)?\s*$/.test(v.textContent || '');
          if (zero && !ks[i].hasAttribute('data-io2-zero')) ks[i].setAttribute('data-io2-zero', '1');
          else if (!zero && ks[i].hasAttribute('data-io2-zero')) ks[i].removeAttribute('data-io2-zero');
        } catch (e) {}
      }
    }
  }

  var chipUlt = null; /* {box, idx, larg} do ultimo recentrar; so muda a rolagem quando essa chave muda */
  function chipAtivo() {
    if (!io2Ligado() || !modoApp()) return;
    var box = document.getElementById('leads-abas');
    if (!box || !box.clientWidth || box.scrollWidth <= box.clientWidth + 1) return;
    var on = box.querySelector('[aria-selected="true"], .on');
    if (!on) return;
    /* Recentra SO quando o chip ativo (indice entre os irmaos), a faixa (elemento recriado) ou a largura da faixa mudou:
       a rolagem manual no celular nao e desfeita a cada mutacao da lista. */
    var idx = on.parentNode ? Array.prototype.indexOf.call(on.parentNode.children, on) : -1;
    if (chipUlt && chipUlt.box === box && chipUlt.idx === idx && chipUlt.larg === box.clientWidth) return;
    chipUlt = { box: box, idx: idx, larg: box.clientWidth };
    var rb = box.getBoundingClientRect(), ro = on.getBoundingClientRect();
    var esq = ro.left - rb.left + box.scrollLeft, alvo = esq - (box.clientWidth - ro.width) / 2;
    var max = box.scrollWidth - box.clientWidth;
    box.scrollLeft = Math.max(0, Math.min(max, alvo));
  }

  function avatarSemFoto(img) {
    try {
      if (!img || img.tagName !== 'IMG' || !img.parentElement) return;
      var sec = document.getElementById('automacaoSection');
      if (!sec || !sec.contains(img) || img.closest('#auto-ig-posts')) return;
      if (!/cdninstagram|fbcdn/.test(img.getAttribute('src') || '')) return;
      var pai = img.parentElement;
      if (pai.hasAttribute('data-io2-semfoto')) return;
      var cartao = img.closest('.card') || pai;
      var m = /@([A-Za-z0-9_.]+)/.exec(cartao.textContent || '');
      var nome = (m ? m[1] : (img.getAttribute('alt') || '')).replace(/^[^A-Za-z0-9]+/, '');
      pai.setAttribute('data-io2-semfoto', '1');
      pai.setAttribute('data-io2-ini', (nome.charAt(0) || '?').toUpperCase());
    } catch (e) {}
  }
  function variarAvatares() {
    if (!io2Ligado() || !modoApp()) return;
    var sec = document.getElementById('automacaoSection');
    if (!sec) return;
    var imgs = sec.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete && !imgs[i].naturalWidth) avatarSemFoto(imgs[i]);
    }
  }
  function erroImagem(ev) {
    try { if (ev.target && ev.target.tagName === 'IMG') avatarSemFoto(ev.target); } catch (e) {}
  }

  /* Filtros de Cadastros: os select.cad-filtro que sao filhos diretos de #cad-acoes vao para um div proprio, logo depois da busca,
     para o celular poder mostrar uma fileira que rola de lado (o CSS faz o desenho; no computador o div e display: contents).
     Os selects sao MOVIDOS, nao copiados: id, onchange, classes e style inline seguem os mesmos (o app liga e desliga cada um
     por style.display e le todos por getElementById). Guarda pai e proximo irmao de cada um para desfazer() devolver. */
  var filtrosMovidos = []; /* [select, pai, proximo irmao], na ordem em que foram movidos */
  function filtrosCadastros() {
    if (!io2Ligado() || !modoApp()) return;
    var acoes = document.getElementById('cad-acoes');
    if (!acoes || acoes.querySelector(':scope > .io2-cad-filtros')) return;
    var busca = null, sels = [], i, k;
    for (i = 0; i < acoes.children.length; i++) {
      k = acoes.children[i];
      if (!busca && k.classList.contains('cad-busca')) busca = k;
      else if (k.tagName === 'SELECT' && k.classList.contains('cad-filtro')) sels.push(k);
    }
    if (!busca || !sels.length) return;
    var caixa = document.createElement('div');
    caixa.className = 'io2-cad-filtros';
    caixa.setAttribute('data-io2', '1');
    acoes.insertBefore(caixa, busca.nextSibling);
    for (i = 0; i < sels.length; i++) {
      filtrosMovidos.push([sels[i], sels[i].parentNode, sels[i].nextSibling]);
      caixa.appendChild(sels[i]);
    }
  }
  function filtrosDevolver() {
    for (var i = filtrosMovidos.length - 1; i >= 0; i--) {
      var m = filtrosMovidos[i];
      try {
        var pai = m[1], prox = m[2];
        if (prox && prox.parentNode !== pai) prox = null;
        pai.insertBefore(m[0], prox);
      } catch (e) {}
    }
    filtrosMovidos = [];
    try {
      var cx = document.querySelectorAll('.io2-cad-filtros[data-io2]');
      for (var j = 0; j < cx.length; j++) if (cx[j].parentNode) cx[j].parentNode.removeChild(cx[j]);
    } catch (e) {}
  }

  /* Selo "Investidores perto" (Cadastros, computador): o app escreve "85 km" com espaco comum e a coluna estreita quebrava o numero
     de um lado e "km" do outro. Aqui o espaco entre o numero e "km" vira espaco sem quebra (so o primeiro texto do selo; "mesma
     cidade" e o resto seguem quebrando entre palavras, para a tabela nao passar da largura). Marca o span (data-io2-nb);
     desfazer() devolve o espaco comum. */
  function seloPares(raiz) {
    try {
      if (!raiz || !raiz.querySelectorAll) return;
      var lst = [];
      if (raiz.matches && raiz.matches('button.cad-par > .cad-sub')) lst.push(raiz);
      var f = raiz.querySelectorAll('button.cad-par > .cad-sub');
      for (var i = 0; i < f.length; i++) lst.push(f[i]);
      for (var j = 0; j < lst.length; j++) {
        var sp = lst[j], tx = sp.firstChild;
        if (sp.hasAttribute('data-io2-nb') || !tx || tx.nodeType !== 3) continue;
        if (/^\d+ km/.test(tx.nodeValue)) { tx.nodeValue = tx.nodeValue.replace(/^(\d+) km/, '$1\u00a0km'); sp.setAttribute('data-io2-nb', '1'); }
      }
    } catch (e) {}
  }
  function seloDevolver() {
    var q = document.querySelectorAll('[data-io2-nb]');
    for (var i = 0; i < q.length; i++) {
      var tx = q[i].firstChild;
      if (tx && tx.nodeType === 3) tx.nodeValue = tx.nodeValue.replace(/^(\d+)\u00a0km/, '$1 km');
      q[i].removeAttribute('data-io2-nb');
    }
  }

  /* Cadastros (cartao do celular): marca a celula cujo valor e so o traco de "vazio" (o app escreve um travessao quando falta o dado).
     data-io2-vazio="so"    = a celula inteira e o traco (o CSS do celular esconde a celula);
     data-io2-vazio="traco" = o traco vem antes de legendas .cad-sub (o CSS do celular esconde so o traco e deixa a legenda).
     Nao troca texto nem move no. No computador a marca nao tem regra nenhuma. O app refaz o corpo da tabela inteiro a cada
     filtro ou status: o motor chama de novo com os nos novos. desfazer() tira as marcas. */
  function cadVazios(raiz) {
    try {
      if (!raiz || !raiz.querySelectorAll) return;
      var lst = [];
      if (raiz.matches && raiz.matches('.cadtab td')) lst.push(raiz);
      var f = raiz.querySelectorAll('.cadtab td');
      for (var i = 0; i < f.length; i++) lst.push(f[i]);
      for (var j = 0; j < lst.length; j++) {
        var td = lst[j];
        if (td.hasAttribute('data-io2-vazio') || td.classList.contains('nome')) continue;
        if (td.textContent.replace(/\s+/g, '') === '\u2014') { td.setAttribute('data-io2-vazio', 'so'); continue; }
        var n = td.firstChild, so = !!(n && n.nodeType === 3 && n.nodeValue.replace(/\s+/g, '') === '\u2014' && td.children.length);
        for (var k = 0; so && k < td.children.length; k++) if (!td.children[k].classList.contains('cad-sub')) so = false;
        if (so) td.setAttribute('data-io2-vazio', 'traco');
      }
    } catch (e) {}
  }
  function cadVaziosDevolver() {
    var q = document.querySelectorAll('[data-io2-vazio]');
    for (var i = 0; i < q.length; i++) q[i].removeAttribute('data-io2-vazio');
  }

  var acabQuadro = 0;
  function acabamento() {
    acabQuadro = 0;
    try { zerar(); } catch (e) {}
    try { chipAtivo(); } catch (e) {}
    try { variarAvatares(); } catch (e) {}
    try { trenaFunil(); } catch (e) {}
  }
  function agendarAcabamento() { if (!acabQuadro) acabQuadro = (window.requestAnimationFrame || setTimeout)(acabamento, 16); }
  function acabamentoLigar() {
    var alvos = [document.getElementById('crm-kpis'), document.getElementById('quemLigarSection'),
      document.getElementById('leads-abas'), document.getElementById('automacaoSection')];
    for (var i = 0; i < alvos.length; i++) {
      if (!alvos[i]) continue;
      try { observar(alvos[i], { childList: true, subtree: true }, agendarAcabamento); } catch (e) {}
    }
    /* Troca de tela (style/class da secao) tambem refaz: o chip ativo so tem largura com a tela aberta. */
    var secoes = ['leadsSection', 'automacaoSection', 'crmSection', 'quemLigarSection', 'inicioSection'];
    for (var j = 0; j < secoes.length; j++) {
      var el = document.getElementById(secoes[j]);
      if (el) { try { observar(el, { attributes: true, attributeFilter: ['style', 'class'] }, agendarAcabamento); } catch (e) {} }
    }
    try {
      var sec = document.getElementById('automacaoSection');
      if (sec) ouvir(sec, 'error', erroImagem, true);
    } catch (e) {}
    try { ouvir(window, 'resize', agendarAcabamento, false); } catch (e) {}
    acabamento();
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
        seloPares(r);
        cadVazios(r);
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
    chipUlt = null;
    try { observadores.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); } catch (e) {}
    try { ouvintes.forEach(function (o) { try { o[0].removeEventListener(o[1], o[2], o[3]); } catch (e) {} }); } catch (e) {}
    try { if (timer) clearTimeout(timer); timer = 0; fila = []; } catch (e) {}
    try { filtrosDevolver(); } catch (e) {}
    try { seloDevolver(); } catch (e) {}
    try { cadVaziosDevolver(); } catch (e) {}
    try { criados.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); }); } catch (e) {}
    try { trenas.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); }); trenas = []; } catch (e) {}
    try { painel.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); }); painel = []; } catch (e) {}
    try { reaisDevolver(); } catch (e) {}
    try {
      var pi = document.querySelectorAll('#inicioSection [data-io2-rot], #inicioSection [data-io2-sub], #inicioSection [data-io2-tom], #inicioSection [data-io2-tit], #inicioSection [data-io2-painel], #inicioSection [data-io2-mais], #inicioSection [data-io2-obras-vazio], #inicioSection [data-io2-pontos]');
      for (var yp = 0; yp < pi.length; yp++) {
        if (pi[yp].hasAttribute('data-io2-tit')) { pi[yp].removeAttribute('title'); pi[yp].removeAttribute('data-io2-tit'); }
        pi[yp].removeAttribute('data-io2-rot'); pi[yp].removeAttribute('data-io2-sub'); pi[yp].removeAttribute('data-io2-tom'); pi[yp].removeAttribute('data-io2-painel');
        pi[yp].removeAttribute('data-io2-mais'); pi[yp].removeAttribute('data-io2-obras-vazio'); pi[yp].removeAttribute('data-io2-pontos');
      }
    } catch (e) {}
    try { classesPostas.forEach(function (c) { c[0].classList.remove(c[1]); }); } catch (e) {}
    try { document.body.classList.remove('io2-faixa-ativa'); } catch (e) {}
    try {
      var z = document.querySelectorAll('#inicioSection [data-io2-p], #inicioSection [data-io2-zero]');
      for (var y = 0; y < z.length; y++) { z[y].removeAttribute('data-io2-p'); z[y].removeAttribute('data-io2-leg'); z[y].removeAttribute('data-io2-zero'); z[y].style.removeProperty('--io-p'); }
    } catch (e) {}
    try {
      var zs = document.querySelectorAll('[data-io2-zero], [data-io2-trena], [data-io2-semfoto], [data-io2-ini]');
      for (var y2 = 0; y2 < zs.length; y2++) { zs[y2].removeAttribute('data-io2-zero'); zs[y2].removeAttribute('data-io2-trena'); zs[y2].removeAttribute('data-io2-semfoto'); zs[y2].removeAttribute('data-io2-ini'); }
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
    try { acabamentoLigar(); } catch (e) {}
    try { filtrosCadastros(); } catch (e) {}
    try { seloPares(document); } catch (e) {}
    try { cadVazios(document); } catch (e) {}
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
