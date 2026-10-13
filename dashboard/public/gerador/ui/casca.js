/* Casca do visual novo do /gerador (fase 2): barra superior, navegacao inferior no celular,
   sincronia de titulo e item ativo. So age com html.io2 e fora de iframe.
   O modelo de navegacao e um dado (MODELO), nao codigo espalhado: os subapps da fase 4
   montam a mesma casca com o mesmo modelo.
   Regras: nunca escreve em location.search nem em location.hash, nunca renomeia id, classe
   ou atributo do app, e cada item chama o onclick do item da barra lateral (lido do DOM).
   Em qualquer erro na montagem: tira io2 do <html>, devolve o tema e desmonta o que criou,
   e o visual antigo volta inteiro.
   Subapps (fase 4a): paginas separadas, sem marcarNavAtivo e sem #app-sidebar. Ali a casca monta a
   propria barra lateral a partir do mesmo MODELO, poe io2-casca e io2-sub no <html> e navega por
   endereco: item do index grava sessionStorage['gerador-ir'] e abre /gerador limpo; item de subapp
   abre /gerador/<nome>. Nunca monta em iframe, nem sem sessao (a pagina esta redirecionando). */
(function () {
  var h = document.documentElement;
  var criados = [];      /* elementos que esta casca pos no DOM */
  var observadores = []; /* MutationObservers */
  var ouvintes = [];     /* [alvo, tipo, fn, opcoes] */
  var envolvidas = [];   /* [nome, original, nova] */
  var montado = false, desfeito = false, dclFeito = false, agendado = 0;
  var modoSub = false, sub = null; /* sub: { nome, titulo, area, ativo } da pagina atual */
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
    ir: { inicio: 'navInicio', solar: 'navGerador', eletroposto: 'navEletroposto', crm: 'navCRM', automacao: 'navAutomacao', sair: 'sairGerador' },
    /* Ordem da barra lateral do index (a dos subapps repete esta). */
    barra: ['nav-inicio', 'nav-solar', 'nav-eletroposto', 'nav-agenda', 'nav-crm', 'nav-prospeccao', 'nav-cobrancas', 'nav-agentes', 'nav-automacao'],
    /* Onde cada item mora. `index`: grava gerador-ir e abre /gerador limpo. `sub`: abre /gerador/<nome>. */
    destinos: {
      'nav-inicio': { index: 'inicio' }, 'nav-solar': { index: 'solar' }, 'nav-eletroposto': { index: 'eletroposto' },
      'nav-crm': { index: 'crm' }, 'nav-automacao': { index: 'automacao' }, 'sair': { index: 'sair' },
      'nav-agenda': { sub: 'agenda' }, 'nav-prospeccao': { sub: 'prospeccao' }, 'nav-cobrancas': { sub: 'cobrancas' }, 'nav-agentes': { sub: 'agentes' }
    },
    /* Subapps conhecidos. `ativo`: item aceso (estados, radar e metricas acendem Eletroposto: nao ha item proprio).
       `sessao`: false = a pagina abre sem login (estados e radar). */
    subs: [
      { nome: 'agenda', caminho: '/gerador/agenda', titulo: 'Agenda', ativo: 'nav-agenda', sessao: true },
      { nome: 'prospeccao', caminho: '/gerador/prospeccao', titulo: 'Prospecção', ativo: 'nav-prospeccao', sessao: true },
      { nome: 'cobrancas', caminho: '/gerador/cobrancas', titulo: 'Cobranças', ativo: 'nav-cobrancas', sessao: true },
      { nome: 'agentes', caminho: '/gerador/agentes', titulo: 'Agentes', ativo: 'nav-agentes', sessao: true },
      { nome: 'estados', caminho: '/gerador/estados', titulo: 'Melhores lugares', area: 'Eletroposto', ativo: 'nav-eletroposto', sessao: false },
      { nome: 'radar', caminho: '/gerador/radar', titulo: 'Radar da prospecção', area: 'Eletroposto', ativo: 'nav-eletroposto', sessao: false },
      { nome: 'metricas', caminho: '/gerador/eletroposto/metricas', titulo: 'Métricas do eletroposto', area: 'Eletroposto', ativo: 'nav-eletroposto', sessao: true }
    ]
  };
  /* Icones da barra nos subapps (la nao existe #app-sidebar para clonar). Mesmos tracos do index. */
  var NAV_ICONES = {
    'nav-inicio': '<path d="M3 11l9-8 9 8"></path><path d="M5 9.5V20h14V9.5"></path><path d="M10 20v-6h4v6"></path>',
    'nav-solar': '<circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line>',
    'nav-eletroposto': '<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polyline>',
    'nav-agenda': '<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
    'nav-crm': '<line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>',
    'nav-prospeccao': '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="1" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="23"></line><line x1="1" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="23" y2="12"></line>',
    'nav-cobrancas': '<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line><line x1="6" y1="15" x2="10" y2="15"></line>',
    'nav-agentes': '<rect x="4" y="8" width="16" height="12" rx="3"></rect><line x1="12" y1="4" x2="12" y2="8"></line><circle cx="12" cy="3" r="1"></circle><line x1="9" y1="13" x2="9" y2="14"></line><line x1="15" y1="13" x2="15" y2="14"></line>',
    'nav-automacao': '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>',
    'sb-atualizar': '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>'
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
    if (modoSub) return svg(NAV_ICONES[item.chave] || '<circle cx="12" cy="12" r="2"></circle>');
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
    el.topo = criar(modoSub ? 'div' : 'header', 'io2-topo');
    if (modoSub) el.topo.setAttribute('role', 'banner'); /* subapps estilizam a tag header; a casca nao herda isso */
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
      b.addEventListener('click', function () { fecharFolha(false); acionar(it.chave); });
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
      b.addEventListener('click', function () { fecharFolha(false); acionar(it.chave); });
      lista.appendChild(b);
    });
    el.folha.appendChild(alca); el.folha.appendChild(lista);
    el.folha.addEventListener('keydown', prenderFoco);

    var pecas = [el.topo, el.baixo, el.fundo, el.folha];
    if (modoSub) pecas.unshift(montarBarra());
    pecas.forEach(function (n) { body.appendChild(n); criados.push(n); });
    montado = true;
  }
  /* Subapp: a mesma barra lateral do index (mesmas classes sb-*, mesmo MODELO), construida aqui. */
  function rotuloDe(chave) {
    var l = MODELO.principais.concat(MODELO.mais);
    for (var i = 0; i < l.length; i++) if (l[i].chave === chave) return l[i].rotulo;
    return chave;
  }
  function itemBarra(chave, rotulo, id) {
    var b = criar('button', id || null, 'sb-item');
    b.type = 'button';
    if (chave) b.setAttribute('data-io2', chave);
    var ic = criar('span', null, 'sb-ic');
    if (chave) ic.appendChild(iconeDe({ chave: chave })); else ic.textContent = '↩'; /* o Sair desenha o icone por CSS, como no index */
    b.appendChild(ic);
    b.appendChild(document.createTextNode(' ' + rotulo));
    return b;
  }
  function montarBarra() {
    var nav = criar('nav', 'app-sidebar');
    nav.setAttribute('aria-label', 'Menu principal');
    var marca = criar('button', null, 'sb-brand');
    marca.type = 'button'; marca.title = 'Início';
    var logo = criar('img', null, 'sb-logo');
    logo.src = '/gerador/logo.png'; logo.alt = 'Irmãos na Obra';
    var nome = criar('span', null, 'sb-name');
    nome.appendChild(document.createTextNode('Irmãos na Obra'));
    var peq = criar('small'); peq.textContent = 'Gerador solar';
    nome.appendChild(peq);
    marca.appendChild(logo); marca.appendChild(nome);
    marca.addEventListener('click', function () { acionar('nav-inicio'); });
    var lista = criar('div', null, 'sb-nav');
    MODELO.barra.forEach(function (k) {
      var b = itemBarra(k, rotuloDe(k));
      b.addEventListener('click', function () { acionar(k); });
      lista.appendChild(b);
    });
    var pe = criar('div', null, 'sb-foot');
    var at = itemBarra('sb-atualizar', 'Atualizar', 'sb-atualizar');
    at.addEventListener('click', function () { acionar('sb-atualizar'); });
    var sa = itemBarra('', 'Sair');
    sa.addEventListener('click', function () { acionar('sair'); });
    pe.appendChild(at); pe.appendChild(sa);
    nav.appendChild(marca); nav.appendChild(lista); nav.appendChild(criar('div', null, 'sb-spacer')); nav.appendChild(pe);
    return nav;
  }
  /* Um clique da casca. No index chama o clique do item da barra lateral (lido do DOM). No subapp navega. */
  function acionar(chave) {
    if (!modoSub) { var f = fonteDe(chave); if (f) f.click(); return; }
    if (chave === 'sb-atualizar') { atualizarSub(); return; }
    var d = MODELO.destinos[chave];
    if (!d) return;
    if (d.sub) {
      if (chave === sub.ativo) return; /* ja esta aqui */
      location.href = '/gerador/' + d.sub;
      return;
    }
    /* Sem sessao (estados e radar abrem sem login) o pedido nao e guardado: ele ficaria esperando e
       dispararia sozinho depois do proximo login, por exemplo o "Sair". */
    if (temSessao()) { try { sessionStorage.setItem('gerador-ir', d.index); } catch (e) {} }
    location.href = '/gerador';        /* endereco limpo: sem ? e sem #, para o app abrir e o irSePedido levar a tela */
  }
  function atualizarSub() {
    try { if (typeof window.forcarAtualizarApp === 'function') { window.forcarAtualizarApp(null); return; } } catch (e) {}
    location.reload();
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
      var r = modoSub ? { titulo: sub.titulo, aba: sub.area || '', ativo: sub.ativo } : descobrir();
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
      /* No index a Agenda fica de fora do "Mais" aceso; nos subapps todo item que nao e da barra inferior acende o "Mais". */
      marcarItem(el.mais, !principal && !!r.ativo && (modoSub || r.ativo !== 'nav-agenda'));
      var itens = el.folha.querySelectorAll('.io2-f-item');
      for (var j = 0; j < itens.length; j++) marcarItem(itens[j], itens[j].getAttribute('data-io2') === r.ativo);
      if (modoSub) {
        var lat = document.querySelectorAll('#app-sidebar .sb-item[data-io2]');
        for (var m = 0; m < lat.length; m++) {
          var on = lat[m].getAttribute('data-io2') === r.ativo;
          lat[m].classList.toggle('ativo', on);
          if (on) lat[m].setAttribute('aria-current', 'page'); else lat[m].removeAttribute('aria-current');
        }
        return;
      }
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
      h.classList.remove('io2-sub');
      h.removeAttribute('data-io2-sub');
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
    /* Subapps nao definem marcarNavAtivo: tem casca propria (iniciarSub). Pagina que nao e subapp
       conhecido sai em silencio, sem desfazer e sem montar nada. */
    if (typeof window.marcarNavAtivo !== 'function') { iniciarSub(); return; }
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

  /* ---------------------------------------------------------------- subapps */
  function subDaPagina() {
    var p = String(location.pathname || '').replace(/\/index\.html$/i, '').replace(/\/+$/, '').toLowerCase();
    for (var i = 0; i < MODELO.subs.length; i++) if (MODELO.subs[i].caminho === p) return MODELO.subs[i];
    return null;
  }
  function temSessao() {
    try { return !!localStorage.getItem('irmaos-na-obra-auth-v1'); } catch (e) { return false; }
  }
  function iniciarSub() {
    sub = subDaPagina();
    if (!sub) return;
    /* Pagina sem sessao esta redirecionando para /gerador: montar agora piscaria a casca. */
    if (sub.sessao && !temSessao()) return;
    modoSub = true;
    montar();
    /* So agora o CSS da casca passa a valer: o cabecalho antigo some junto com a montagem, nunca antes. */
    h.setAttribute('data-io2-sub', sub.nome);
    h.classList.add('io2-sub');
    h.classList.add('io2-casca');
    io2Sync();
    ouvir(document, 'keydown', function (ev) { if (ev.key === 'Escape') fecharFolha(true); });
    ouvir(window, 'resize', function () {
      if (montado && !el.folha.hidden && window.innerWidth > 860) fecharFolha(false);
    });
  }

  try {
    iniciar();
  } catch (e) {
    desfazer();
  }
})();
