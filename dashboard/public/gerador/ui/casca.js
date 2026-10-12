/* Casca do visual novo do /gerador (fase 2): barra superior, navegacao inferior no celular,
   sincronia de titulo e item ativo. So age com html.io2 e fora de iframe.
   O modelo de navegacao e um dado (MODELO), nao codigo espalhado: os subapps da fase 4
   montam a mesma casca com o mesmo modelo.
   Regras: nunca escreve em location.search nem em location.hash, nunca renomeia id, classe
   ou atributo do app, e cada item chama o onclick do item da barra lateral (lido do DOM).
   Em qualquer erro na montagem: tira io2 do <html>, devolve o tema e desmonta o que criou,
   e o visual antigo volta inteiro. */
(function () {
  var h = document.documentElement;
  var criados = [];      /* elementos que esta casca pos no DOM */
  var observadores = []; /* MutationObservers */
  var ouvintes = [];     /* [alvo, tipo, fn, opcoes] */
  var envolvidas = [];   /* [nome, original, nova] */
  var montado = false, desfeito = false, dclFeito = false, agendado = 0;
  var el = {};           /* topo, titulo, aba, cons, avatar, nome, baixo, fundo, folha, mais */

  /* ---------------------------------------------------------------- modelo de navegacao */
  var ICONES = {
    mais: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"></path>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>'
  };
  var MODELO = {
    /* Barra inferior: o item chama o clique do item da barra lateral com este id. */
    principais: [
      { chave: 'nav-inicio', rotulo: 'Início' },
      { chave: 'nav-solar', rotulo: 'Solar' },
      { chave: 'nav-eletroposto', rotulo: 'Eletroposto' },
      { chave: 'nav-crm', rotulo: 'CRM' }
    ],
    /* Folha "Mais". `sair` nao tem id: e o item do rodape que nao e o Atualizar. */
    mais: [
      { chave: 'nav-agenda', rotulo: 'Agenda' },
      { chave: 'nav-prospeccao', rotulo: 'Prospecção' },
      { chave: 'nav-cobrancas', rotulo: 'Cobranças' },
      { chave: 'nav-agentes', rotulo: 'Agentes' },
      { chave: 'nav-automacao', rotulo: 'Automação' },
      { sep: true },
      { chave: 'sb-atualizar', rotulo: 'Atualizar' },
      { chave: 'sair', rotulo: 'Sair', icone: 'sair' }
    ],
    /* Telas, em ordem de prioridade: a primeira cuja secao esta visivel manda no titulo. */
    telas: [
      { sec: 'propostaSection', titulo: 'Proposta gerada', area: 'Solar' },
      { sec: 'inicioSection', titulo: 'Início', data: '#in-h1' },
      { sec: 'formSection', titulo: 'Gerar proposta', area: 'Solar' },
      { sec: 'historicoSection', titulo: 'Histórico de propostas', area: 'Solar' },
      { sec: 'calcSection', titulo: 'Calculadora de precificação', area: 'Solar' },
      { sec: 'tabelasSection', titulo: 'Tabelas de equipamentos', area: 'Solar', h1: true },
      { sec: 'leadsSection', titulo: 'Leads', area: 'Solar', aba: '.leads-aba.on' },
      { sec: 'fechamentoSolarSection', titulo: 'Fechamento', area: 'Solar', aba: '.fs-tab.ativa' },
      { sec: 'quemLigarSection', titulo: 'Quem ligar', area: 'Solar' },
      { sec: 'obrasSolarSection', titulo: 'Obras', area: 'Solar', aba: '.fs-tab.ativa' },
      { sec: 'painelSolarSection', titulo: 'Painel', area: 'Solar' },
      { sec: 'eletroSection', titulo: 'Eletroposto', eletro: true },
      { sec: 'crmSection', titulo: 'CRM', aba: '.crm-subtab.ativo' },
      { sec: 'automacaoSection', titulo: 'Central de Automação', aba: '.auto-tab.ativa, .auto-tab.ativo, .auto-tab.on' },
      { sec: 'redesSection', titulo: 'Redes sociais' }
    ],
    /* Reguas de aba: a ativa e trazida para a vista quando nao cabe. */
    reguas: '.solar-subnav, .eletro-subnav, .eletro-subnav2, .cad-abas, .crm-subnav',
    /* gerador-ir: destino pedido por outra pagina (subapps) -> funcao de navegacao existente. */
    ir: { inicio: 'navInicio', solar: 'navGerador', eletroposto: 'navEletroposto', crm: 'navCRM', automacao: 'navAutomacao' }
  };

  /* ---------------------------------------------------------------- utilidades */
  var RE_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
  function limpar(t) { return String(t || '').replace(RE_EMOJI, '').replace(/\s+/g, ' ').trim(); }
  function textoDe(no) {
    if (!no) return '';
    var c = no.cloneNode(true);
    var lixo = c.querySelectorAll('.cad-cnt, .crm-subtab-qt, .leads-aba .c, .sb-ic, svg');
    for (var i = 0; i < lixo.length; i++) lixo[i].parentNode.removeChild(lixo[i]);
    return limpar(c.textContent);
  }
  function textoProprio(no) {
    var s = '';
    for (var n = no.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) s += n.nodeValue;
    return limpar(s);
  }
  function visivel(no) {
    if (!no || no.style.display === 'none') return false;
    return getComputedStyle(no).display !== 'none';
  }
  function criar(tag, id, cls) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    return e;
  }
  function svg(corpo, extra) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = corpo;
    return s;
  }
  function fonteDe(chave) {
    if (chave === 'sair') return document.querySelector('#app-sidebar .sb-foot .sb-item:not(#sb-atualizar)');
    return document.getElementById(chave);
  }
  function iconeDe(item) {
    if (item.icone && ICONES[item.icone]) return svg(ICONES[item.icone]);
    var f = fonteDe(item.chave);
    var o = f && f.querySelector('.sb-ic svg');
    if (!o) return svg('<circle cx="12" cy="12" r="2"></circle>');
    var c = o.cloneNode(true);
    ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].forEach(function (a) { c.removeAttribute(a); });
    var s = svg('');
    s.innerHTML = c.innerHTML;
    return s;
  }
  function consultor() {
    try { if (typeof window.getConsultorAtual === 'function') { var c = window.getConsultorAtual(); if (c) return String(c); } } catch (e) {}
    try {
      var a = JSON.parse(localStorage.getItem('irmaos-na-obra-auth-v1') || 'null');
      if (a && a.consultor) return String(a.consultor);
    } catch (e2) {}
    return '';
  }
  function ouvir(alvo, tipo, fn, opc) {
    alvo.addEventListener(tipo, fn, opc);
    ouvintes.push([alvo, tipo, fn, opc]);
  }
  function observar(alvo, opc, fn) {
    var o = new MutationObserver(fn);
    o.observe(alvo, opc);
    observadores.push(o);
    return o;
  }

  /* ---------------------------------------------------------------- montagem */
  function montar() {
    var body = document.body;
    /* Barra superior */
    el.topo = criar('header', 'io2-topo');
    var txt = criar('div', null, 'io2-t-txt');
    el.titulo = criar('p', null, 'io2-t-tit');
    var ctx = criar('p', null, 'io2-t-ctx');
    el.aba = criar('span', null, 'io2-t-aba');
    el.cons = criar('span', null, 'io2-t-cons');
    ctx.appendChild(el.aba); ctx.appendChild(el.cons);
    txt.appendChild(el.titulo); txt.appendChild(ctx);
    var user = criar('div', null, 'io2-t-user');
    el.avatar = criar('span', null, 'io2-t-av');
    el.avatar.setAttribute('aria-hidden', 'true');
    el.nome = criar('span', null, 'io2-t-nome');
    user.appendChild(el.avatar); user.appendChild(el.nome);
    el.topo.appendChild(txt); el.topo.appendChild(user);

    /* Navegacao inferior */
    el.baixo = criar('nav', 'io2-baixo');
    el.baixo.setAttribute('aria-label', 'Navegação principal');
    MODELO.principais.forEach(function (it) {
      var b = botaoBaixo(it.rotulo, iconeDe(it), it.chave);
      b.addEventListener('click', function () { fecharFolha(false); var f = fonteDe(it.chave); if (f) f.click(); });
      el.baixo.appendChild(b);
    });
    el.mais = botaoBaixo('Mais', svg(ICONES.mais), 'mais');
    el.mais.setAttribute('aria-haspopup', 'dialog');
    el.mais.setAttribute('aria-expanded', 'false');
    el.mais.addEventListener('click', function () { if (el.folha.hidden) abrirFolha(); else fecharFolha(true); });
    el.baixo.appendChild(el.mais);

    /* Folha "Mais" */
    el.fundo = criar('div', 'io2-fundo');
    el.fundo.hidden = true;
    el.fundo.addEventListener('click', function () { fecharFolha(true); });
    el.folha = criar('div', 'io2-folha');
    el.folha.hidden = true;
    el.folha.setAttribute('role', 'dialog');
    el.folha.setAttribute('aria-modal', 'true');
    el.folha.setAttribute('aria-label', 'Mais opções');
    var alca = criar('div', null, 'io2-f-alca');
    alca.setAttribute('aria-hidden', 'true');
    var lista = criar('div', null, 'io2-f-lista');
    MODELO.mais.forEach(function (it) {
      if (it.sep) { lista.appendChild(criar('div', null, 'io2-f-sep')); return; }
      var b = criar('button', null, 'io2-f-item');
      b.type = 'button';
      b.setAttribute('data-io2', it.chave);
      b.appendChild(iconeDe(it));
      var r = criar('span'); r.textContent = it.rotulo;
      b.appendChild(r);
      b.addEventListener('click', function () { fecharFolha(false); var f = fonteDe(it.chave); if (f) f.click(); });
      lista.appendChild(b);
    });
    el.folha.appendChild(alca); el.folha.appendChild(lista);
    el.folha.addEventListener('keydown', prenderFoco);

    [el.topo, el.baixo, el.fundo, el.folha].forEach(function (n) { body.appendChild(n); criados.push(n); });
    montado = true;
  }
  function botaoBaixo(rotulo, icone, chave) {
    var b = criar('button', null, 'io2-b-item');
    b.type = 'button';
    b.setAttribute('data-io2', chave);
    var ic = criar('span', null, 'io2-b-ic');
    ic.appendChild(icone);
    var r = criar('span');
    r.textContent = rotulo;
    b.appendChild(ic); b.appendChild(r);
    return b;
  }

  /* ---------------------------------------------------------------- folha "Mais" */
  function abrirFolha() {
    if (!montado) return;
    el.fundo.hidden = false; el.folha.hidden = false;
    el.mais.setAttribute('aria-expanded', 'true');
    var p = el.folha.querySelector('.io2-f-item');
    if (p) p.focus();
  }
  function fecharFolha(devolverFoco) {
    if (!montado || el.folha.hidden) return;
    el.fundo.hidden = true; el.folha.hidden = true;
    el.mais.setAttribute('aria-expanded', 'false');
    if (devolverFoco) el.mais.focus();
  }
  function prenderFoco(ev) {
    if (ev.key !== 'Tab') return;
    var itens = el.folha.querySelectorAll('.io2-f-item');
    if (!itens.length) return;
    var a = itens[0], z = itens[itens.length - 1];
    if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
  }

  /* ---------------------------------------------------------------- sincronia */
  function descobrir() {
    var r = { titulo: '', aba: '', ativo: '' };
    var partes = [];
    var ativo = document.querySelector('#app-sidebar .sb-item.ativo');
    r.ativo = ativo ? ativo.id : '';
    for (var i = 0; i < MODELO.telas.length; i++) {
      var t = MODELO.telas[i];
      var sec = document.getElementById(t.sec);
      if (!visivel(sec)) continue;
      r.titulo = t.titulo;
      if (t.h1) {
        var h1 = sec.querySelector('.header-titulo h1');
        var th = h1 ? textoProprio(h1) : '';
        if (th) r.titulo = th;
      }
      if (t.area) partes.push(t.area);
      if (t.data) {
        var d = document.querySelector(t.data);
        var td = d ? textoDe(d) : '';
        if (td && td !== t.titulo) partes.push(td);
      }
      if (t.aba) { var a = sec.querySelector(t.aba); var ta = a ? textoDe(a) : ''; if (ta) partes.push(ta); }
      if (t.eletro) {
        var n1 = sec.querySelector('.eletro-subnav .eletro-subtab.ativa');
        var n2 = sec.querySelector('.eletro-subnav2.on .eletro-subtab2.ativa');
        var c = sec.querySelector('.cad-abas .cad-aba.ativa');
        if (n1) partes.push(textoDe(n1));
        if (n2) partes.push(textoDe(n2));
        if (c && c.getClientRects().length) partes.push(textoDe(c));
      }
      /* Aba da regua Solar (titulo da tela ja e o nome da aba; nao repete). */
      break;
    }
    r.aba = partes.filter(Boolean).join(' · ');
    return r;
  }
  function marcarItem(no, ligado) {
    no.classList.toggle('ativa', ligado);
    if (ligado) no.setAttribute('aria-current', 'page'); else no.removeAttribute('aria-current');
  }
  function io2Sync() {
    try {
      if (!montado || desfeito) return;
      var r = descobrir();
      if (r.titulo) el.titulo.textContent = r.titulo;
      el.aba.textContent = r.aba;
      var c = consultor();
      el.cons.textContent = c ? (r.aba ? ' · ' : '') + c : '';
      el.nome.textContent = c;
      el.avatar.textContent = c ? c.charAt(0).toUpperCase() : '';
      /* Item ativo nas duas navegacoes: quem manda e o item ativo da barra lateral. */
      var principal = false;
      var botoes = el.baixo.querySelectorAll('.io2-b-item');
      for (var i = 0; i < botoes.length; i++) {
        var k = botoes[i].getAttribute('data-io2');
        var ligado = k === r.ativo;
        if (ligado) principal = true;
        if (k !== 'mais') marcarItem(botoes[i], ligado);
      }
      marcarItem(el.mais, !principal && !!r.ativo && r.ativo !== 'nav-agenda');
      var itens = el.folha.querySelectorAll('.io2-f-item');
      for (var j = 0; j < itens.length; j++) marcarItem(itens[j], itens[j].getAttribute('data-io2') === r.ativo);
      trazerAbas();
    } catch (e) { /* a sincronia nunca derruba o app */ }
  }
  /* Regua que o usuario rolou a mao nao e recentrada: so rola quando a aba ativa MUDOU desde a ultima
     vez e nao esta inteira na vista, e rola o minimo para ela aparecer inteira. */
  var abaVista = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function trazerAbas() {
    var reguas = document.querySelectorAll(MODELO.reguas);
    for (var i = 0; i < reguas.length; i++) {
      var s = reguas[i];
      if (!s.clientWidth || s.scrollWidth <= s.clientWidth + 1) continue;
      var a = s.querySelector('.ativa, .ativo');
      if (!a) continue;
      var mudou = !abaVista || abaVista.get(s) !== a;
      if (abaVista) abaVista.set(s, a);
      if (!mudou) continue;
      var sr = s.getBoundingClientRect(), ar = a.getBoundingClientRect();
      if (ar.left >= sr.left && ar.right <= sr.right) continue;
      if (ar.left < sr.left) s.scrollLeft -= (sr.left - ar.left) + 8;
      else s.scrollLeft += (ar.right - sr.right) + 8;
    }
  }
  function agendar() {
    if (agendado) return;
    agendado = setTimeout(function () { agendado = 0; io2Sync(); }, 60);
  }

  /* ---------------------------------------------------------------- entrada por outra pagina */
  function irSePedido() {
    /* So no app: em qualquer outro modo (login, link do cliente) nao le nem apaga o pedido. */
    if (h.getAttribute('data-mode') !== 'app') return;
    var v = null;
    try { v = sessionStorage.getItem('gerador-ir'); } catch (e) {}
    if (!v) return;
    try { sessionStorage.removeItem('gerador-ir'); } catch (e2) {}
    if (!Object.prototype.hasOwnProperty.call(MODELO.ir, v)) return;
    var nome = MODELO.ir[v];
    setTimeout(function () {
      try { if (typeof window[nome] === 'function') window[nome](); } catch (e3) {}
    }, 0);
  }
  function aposBoot() {
    if (dclFeito || document.readyState === 'complete') irSePedido();
    /* senao o ouvinte de DOMContentLoaded, registrado depois do Inicio, chama irSePedido. */
  }

  /* ---------------------------------------------------------------- ciclo */
  function envolver(nome) {
    var orig = window[nome];
    if (typeof orig !== 'function') throw new Error('sem ' + nome);
    var nova = function () {
      var r = orig.apply(this, arguments);
      try { io2Sync(); } catch (e) {}
      return r;
    };
    window[nome] = nova;
    envolvidas.push([nome, orig, nova]);
  }
  /* Com a barra lateral em todas as telas, o CRM passa a ser alcancavel de qualquer uma. O navCRM
     so fecha Fechamento, Quem ligar, Obras, Painel, Inicio, o formulario e o Historico: Leads,
     Tabelas, Calculadora, Eletroposto e Automacao ficavam abertas por baixo (medido: 5 de 13
     partidas). A casca chama antes a limpeza central que o app ja tem, sem reescrever o navCRM. */
  function limparAntes(nome) {
    var orig = window[nome];
    if (typeof orig !== 'function') return;
    var nova = function () {
      try { if (typeof window.telasSolarLimpar === 'function') window.telasSolarLimpar(); } catch (e) {}
      return orig.apply(this, arguments);
    };
    window[nome] = nova;
    envolvidas.push([nome, orig, nova]);
  }
  function aoMudarEstado() {
    try {
      if (h.getAttribute('data-mode') !== 'app') { if (montado) fecharFolha(false); return; }
      var primeira = !montado;
      if (primeira) {
        montar();
        /* So agora o CSS da casca passa a valer: esconder o menu antigo antes disto deixaria o celular sem navegacao. */
        h.classList.add('io2-casca');
      }
      io2Sync();
      if (primeira) {
        window.dispatchEvent(new Event('resize'));   /* o Inicio redesenha os graficos na nova largura */
        aposBoot();
      }
    } catch (e) { desfazer(); }
  }
  function desfazer() {
    if (desfeito) return;
    desfeito = true;
    try {
      h.classList.remove('io2-casca');
      h.classList.remove('io2');
      var tema = window.__io2TemaAntes;
      if (tema) h.setAttribute('data-theme', tema); else h.removeAttribute('data-theme');
      window.__io2 = false;
      h.style.removeProperty('--io-fonte-papel');
    } catch (e) {}
    try { observadores.forEach(function (o) { o.disconnect(); }); } catch (e1) {}
    try { ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); }); } catch (e2) {}
    try { envolvidas.forEach(function (w) { if (window[w[0]] === w[2]) window[w[0]] = w[1]; }); } catch (e3) {}
    try { criados.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); } catch (e4) {}
    criados = []; montado = false;
    try { window.dispatchEvent(new Event('resize')); } catch (e5) {}
  }

  function iniciar() {
    if (!h.classList.contains('io2')) return;
    if (window.self !== window.top) return;
    /* Fonte real do body (a reforma nao toca nele): a guarda de fonte dos documentos usa este valor. */
    h.style.setProperty('--io-fonte-papel', getComputedStyle(document.body).fontFamily);
    /* Subapps ainda nao definem marcarNavAtivo (fase 4): sem ele nao ha o que sincronizar. Sai em
       silencio, sem desfazer e sem montar nada; a classe io2 fica e nao ha CSS de casca para subapp. */
    if (typeof window.marcarNavAtivo !== 'function') return;
    envolver('marcarNavAtivo');
    envolver('eletroSubaba');
    limparAntes('navCRM');
    /* Rede de seguranca: telas que nao passam pelas duas funcoes (proposta gerada, login,
       logout) e qualquer mudanca de classe de tela no <html>. */
    observar(h, { attributes: true, attributeFilter: ['class', 'data-mode'] }, aoMudarEstado);
    var prop = document.getElementById('propostaSection');
    if (prop) observar(prop, { attributes: true, attributeFilter: ['style'] }, agendar);
    ['in-h1'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) observar(n, { childList: true, characterData: true, subtree: true }, agendar);
    });
    var tab = document.querySelector('#tabelasSection .header-titulo');
    if (tab) observar(tab, { childList: true, characterData: true, subtree: true }, agendar);
    /* Abas internas (Cadastros, CRM, fechamento, leads) nao passam por nenhuma das duas. */
    ouvir(document, 'click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('#io2-topo, #io2-baixo, #io2-folha')) return;
      agendar();
    }, true);
    ouvir(document, 'keydown', function (ev) { if (ev.key === 'Escape') fecharFolha(true); });
    ouvir(window, 'resize', function () {
      if (montado && !el.folha.hidden && window.innerWidth > 860) fecharFolha(false);
    });
    ouvir(document, 'DOMContentLoaded', function () { dclFeito = true; setTimeout(irSePedido, 0); });
    aoMudarEstado();
  }

  try {
    iniciar();
  } catch (e) {
    desfazer();
  }
})();
