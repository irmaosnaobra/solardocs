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
  var Bd = null, Bm = null; /* busca de telas: da barra superior (computador) e da folha "Mais" (celular) */
  var buscas = [], indiceBusca = null, focoAntes = null, buscaId = 0, abasVistas = {};
  var adotados = [];     /* [no, pai, proximoIrmao]: o que sobrou do cabecalho antigo e foi para a barra superior */
  var rotulados = [];    /* controles que ganharam aria-label da casca */
  var chipVisto = '';    /* Agenda: nome do chip ativo ja trazido para a vista */
  var vazios = [];       /* elementos marcados com data-io2-vazio */
  var carregando = [];   /* botoes adotados que a casca vigia (data-io2-carregando enquanto o texto e a ampulheta) */
  var obsGlifos = null, agChip = 0;
  /* el.toggle: botao de recolher o trilho; el.dica: dica com o nome do item (trilho recolhido) */

  /* ---------------------------------------------------------------- modelo de navegacao */
  var ICONES = {
    mais: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"></path>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
    /* Trilho recolhivel: setas duplas (recolher; recolhido o CSS espelha) e o relogio que volta, do "Visual antigo". */
    recolher: '<polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline>',
    antigo: '<path d="M3 12a9 9 0 1 0 3-6.7"></path><polyline points="3 4 3 9 8 9"></polyline><path d="M12 7v5l3 2"></path>',
    /* Menu do usuario: perfil, equipe (so socio) e a seta do botao. */
    perfil: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
    equipe: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    seta: '<polyline points="6 9 12 15 18 9"></polyline>'
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
      /* Perfil: `acionar` trata os dois (abrem a janela do perfil.js). `soSocio`: escondido ate o perfil dizer que a pessoa e socio. */
      { chave: 'perfil', rotulo: 'Meu perfil', icone: 'perfil' },
      { chave: 'perfil-equipe', rotulo: 'Perfis da equipe', icone: 'equipe', soSocio: true },
      { chave: 'sb-atualizar', rotulo: 'Atualizar' },
      { chave: 'sair', rotulo: 'Sair', icone: 'sair' },
      /* Link simples (um <a>), nao dispara nada do app: a pagina grava a chave e volta ao /gerador. Sempre o ultimo item. */
      { chave: 'visual-antigo', rotulo: 'Visual antigo', link: '/gerador/visual-antigo.html' }
    ],
    /* Telas, em ordem de prioridade: a primeira cuja secao esta visivel manda no titulo. */
    telas: [
      { sec: 'propostaSection', titulo: 'Proposta gerada', area: 'Solar' },
      { sec: 'inicioSection', titulo: 'Início', data: '#in-h1' },
      { sec: 'formSection', titulo: 'Gerar proposta', area: 'Solar' },
      { sec: 'historicoSection', titulo: 'Histórico de propostas', area: 'Solar' },
      { sec: 'calcSection', titulo: 'Calculadora de precificação', area: 'Solar' },
      /* Tabelas: o h1 da tela e o nome da linha de equipamento; ele vai para a linha de contexto, nao para o titulo. */
      { sec: 'tabelasSection', titulo: 'Tabelas', area: 'Solar', h1: true },
      { sec: 'leadsSection', titulo: 'Leads', area: 'Solar', aba: '.leads-aba.on' },
      { sec: 'fechamentoSolarSection', titulo: 'Fechamento', area: 'Solar', aba: '.fs-tab.ativa' },
      { sec: 'quemLigarSection', titulo: 'Quem ligar', area: 'Solar' },
      { sec: 'obrasSolarSection', titulo: 'Obras', area: 'Solar', aba: '.fs-tab.ativa' },
      { sec: 'painelSolarSection', titulo: 'Painel', area: 'Solar' },
      { sec: 'planilhaSolarSection', titulo: 'Planilha de clientes', area: 'Solar' },
      { sec: 'documentosSolarSection', titulo: 'Documentos', area: 'Solar' },
      { sec: 'eletroSection', titulo: 'Eletroposto', eletro: true },
      { sec: 'crmSection', titulo: 'CRM', aba: '.crm-subtab.ativo' },
      { sec: 'automacaoSection', titulo: 'Central de Automação', aba: '.auto-tab.ativa, .auto-tab.ativo, .auto-tab.on' },
      { sec: 'redesSection', titulo: 'Redes sociais' }
    ],
    /* Abas de DENTRO de uma tela do Solar: a regua nasce quando a tela abre (render do app), nao existe no HTML.
       Entram no indice quando a tela e vista (registrarAbas) e ficam guardadas so pelo texto, porque o app
       redesenha a regua (leads) e o botao guardado morreria. aba = data-aba do botao da regua Solar que abre a tela. */
    abasInternas: [
      { sec: 'leadsSection', aba: 'leads', sel: '.leads-aba' },
      { sec: 'fechamentoSolarSection', aba: 'fechamento', sel: '.fs-tab' },
      { sec: 'obrasSolarSection', aba: 'obras', sel: '.fs-tab' }
    ],
    /* Reguas de aba: a ativa e trazida para a vista quando nao cabe. */
    reguas: '.solar-subnav, .eletro-subnav, .eletro-subnav2, .cad-abas, .crm-subnav',
    /* gerador-ir: destino pedido por outra pagina (subapps) -> funcao de navegacao existente. */
    ir: { inicio: 'navInicio', solar: 'navGerador', eletroposto: 'navEletroposto', crm: 'navCRM', automacao: 'navAutomacao', sair: 'sairGerador', perfil: 'abrirMeuPerfil', 'perfil-equipe': 'abrirPerfisEquipe' },
    /* Ordem da barra lateral do index (a dos subapps repete esta). */
    barra: ['nav-inicio', 'nav-solar', 'nav-eletroposto', 'nav-agenda', 'nav-crm', 'nav-prospeccao', 'nav-cobrancas', 'nav-agentes', 'nav-automacao'],
    /* Onde cada item mora. `index`: grava gerador-ir e abre /gerador limpo. `sub`: abre /gerador/<nome>. */
    destinos: {
      'nav-inicio': { index: 'inicio' }, 'nav-solar': { index: 'solar' }, 'nav-eletroposto': { index: 'eletroposto' },
      'nav-crm': { index: 'crm' }, 'nav-automacao': { index: 'automacao' }, 'sair': { index: 'sair' },
      'perfil': { index: 'perfil' }, 'perfil-equipe': { index: 'perfil-equipe' },
      'nav-agenda': { sub: 'agenda' }, 'nav-prospeccao': { sub: 'prospeccao' }, 'nav-cobrancas': { sub: 'cobrancas' }, 'nav-agentes': { sub: 'agentes' }
    },
    /* Subapps conhecidos. `ativo`: item aceso (estados, radar e metricas acendem Eletroposto: nao ha item proprio).
       `sessao`: false = a pagina abre sem login (estados e radar).
       `ctx`: linha de contexto sob o titulo quando o subapp nao tem `area` (todo titulo da casca tem a sua linha).
       `adotar`: o que sobra do cabecalho antigo (recarregar, selo de ambiente) e vai para a barra superior, num
       bloco fixo a esquerda da busca. `vazios`: elementos que somem enquanto o texto esta vazio ou so tem traco. */
    subs: [
      { nome: 'agenda', caminho: '/gerador/agenda', titulo: 'Agenda', ctx: 'Agendamentos da semana', ativo: 'nav-agenda', sessao: true, adotar: ['#btn-refresh'] },
      { nome: 'prospeccao', caminho: '/gerador/prospeccao', titulo: 'Prospecção', ctx: 'Fila de contatos', ativo: 'nav-prospeccao', sessao: true, adotar: ['#btn-refresh'] },
      { nome: 'cobrancas', caminho: '/gerador/cobrancas', titulo: 'Cobranças', ctx: 'Cobranças dos clientes', ativo: 'nav-cobrancas', sessao: true, adotar: ['#amb'], vazios: ['#amb'] },
      { nome: 'agentes', caminho: '/gerador/agentes', titulo: 'Agentes', ctx: 'Central das agentes', ativo: 'nav-agentes', sessao: true, adotar: ['#btn-refresh'] },
      { nome: 'estados', caminho: '/gerador/estados', titulo: 'Melhores lugares', area: 'Eletroposto', ativo: 'nav-eletroposto', sessao: false },
      { nome: 'radar', caminho: '/gerador/radar', titulo: 'Radar da prospecção', area: 'Eletroposto', ativo: 'nav-eletroposto', sessao: false },
      { nome: 'metricas', caminho: '/gerador/eletroposto/metricas', titulo: 'Métricas do eletroposto', area: 'Eletroposto', ativo: 'nav-eletroposto', sessao: true }
    ],
    /* Glifos e emojis que fazem papel de icone nos subapps. LISTA FECHADA de elementos de tela (texto escrito no
       codigo da pagina): so os nos de texto filhos diretos de cada elemento. Nunca cartao da Agenda, historico,
       mensagem nem campo. `rot`: nome acessivel se o controle ficar sem texto (so quando nao tem title nem aria-label). */
    rotularTitle: '.nav-semana .nav-btn, #btn-refresh', /* controle cujo glifo some do desenho: o title vira nome acessivel */
    glifos: {
      agentes: [['#tab-chat, #tab-cerebro, .acoes button', '']],
      prospeccao: [['.ch button.btn.sm', 'Anterior'], ['.ch button.btn.sm .kbd', ''], ['.mbar .linha1 button', '']]
    }
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
    s.setAttribute('stroke-width', '1.75');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = corpo;
    return s;
  }
  function fonteDe(chave) {
    if (chave === 'sair') return document.querySelector('#app-sidebar .sb-foot .sb-item:not(#sb-atualizar):not(#sb-perfil)');
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
    /* O bloco do usuario e um botao: abre o menu do usuario (so de 861 px para cima; no celular o CSS esconde os dois). */
    var user = criar('button', null, 'io2-t-user');
    user.type = 'button';
    user.setAttribute('aria-haspopup', 'menu');
    user.setAttribute('aria-expanded', 'false');
    user.setAttribute('aria-controls', 'io2-menu-user');
    el.user = user;
    el.avatar = criar('span', null, 'io2-t-av');
    el.avatar.setAttribute('aria-hidden', 'true');
    el.nome = criar('span', null, 'io2-t-nome');
    var seta = svg(ICONES.seta); seta.setAttribute('class', 'io2-t-seta');
    user.appendChild(el.avatar); user.appendChild(el.nome); user.appendChild(seta);
    user.addEventListener('click', function () { if (el.menu.hidden) abrirMenuUsuario(true); else fecharMenuUsuario(true); });
    user.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (el.menu.hidden) abrirMenuUsuario(true); }
    });
    el.topo.appendChild(txt);
    /* Ferramentas do cabecalho antigo (recarregar, selo de ambiente): ficam entre o titulo e a busca, de modo que
       a busca fica na mesma posicao em toda tela. Vazio nas telas que nao adotam nada. */
    if (modoSub && sub && sub.adotar) { el.extra = criar('div', null, 'io2-t-extra'); el.topo.appendChild(el.extra); }
    /* Busca de telas: no computador mora na barra superior, no celular dentro da folha "Mais".
       Erro aqui nunca derruba a casca: no pior caso o campo some. */
    try { Bd = criarBusca(false); el.topo.appendChild(Bd.raiz); } catch (eb) { desligarBusca(); }
    el.topo.appendChild(user);
    el.topo.appendChild(montarMenuUsuario());

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
      if (it.link) { lista.appendChild(botaoTema('io2-f-item io2-f-tema')); lista.appendChild(criarLink(it, 'io2-f-item io2-f-link')); return; }
      var b = criar('button', null, 'io2-f-item');
      b.type = 'button';
      b.setAttribute('data-io2', it.chave);
      b.appendChild(iconeDe(it));
      var r = criar('span'); r.textContent = it.rotulo;
      b.appendChild(r);
      if (it.soSocio) { b.hidden = true; b.setAttribute('data-io2-socio', '1'); }
      b.addEventListener('click', function () { fecharFolha(false); acionar(it.chave); });
      lista.appendChild(b);
    });
    el.folha.appendChild(alca);
    try { Bm = criarBusca(true); el.folha.appendChild(Bm.raiz); } catch (em) { desligarBusca(); }
    el.folha.appendChild(lista);
    el.folha.addEventListener('keydown', prenderFoco);

    el.dica = criar('div', 'io2-dica');
    el.dica.setAttribute('aria-hidden', 'true');
    var pecas = [el.topo, el.baixo, el.fundo, el.folha, el.dica];
    if (modoSub) pecas.unshift(montarBarra());
    pecas.forEach(function (n) { body.appendChild(n); criados.push(n); });
    /* Index: o trilho lateral e o #app-sidebar do proprio app; o link entra no pe dele, depois do Sair, e sai no desfazer(). */
    if (!modoSub) {
      try {
        var peApp = document.querySelector('#app-sidebar .sb-foot');
        if (peApp) {
          var bt = botaoTema('io2-sb-tema'); peApp.appendChild(bt); criados.push(bt);
          var lk = criarLink({ rotulo: 'Visual antigo', link: '/gerador/visual-antigo.html', chave: 'visual-antigo' }, 'io2-sb-link'); iconeLinkAntigo(lk); peApp.appendChild(lk); criados.push(lk);
        }
        /* Botao de recolher o trilho: primeiro filho do #app-sidebar (irmao do logo, que ja e um <button>). */
        var barraApp = document.getElementById('app-sidebar');
        if (barraApp) { var tg = botaoTrilha(); barraApp.insertBefore(tg, barraApp.firstChild); criados.push(tg); }
      } catch (eL) {}
    }
    montado = true;
    ligarMenuUsuario();
  }
  /* ---------------------------------------------------------------- menu do usuario */
  /* O nome na barra superior abre um menu: cabecalho (foto, nome, e-mail, papel) e Meu perfil, Perfis da equipe (so
     socio), Tema, Visual antigo e Sair. Os dados do cabecalho (e-mail, papel, foto) vem do GET /gerador/perfil, que a
     propria casca chama (nos subapps tambem, onde nao ha perfil.js); a resposta fica em localStorage['gerador-perfil-v1']
     (so nome, e-mail, papel, WhatsApp e foto, e so vale para o mesmo consultor). Sem resposta, o menu mostra so o nome.
     A janela "Meu perfil" e do perfil.js: aqui so se pede para ela abrir (acionar). */
  var PERFIL_CHAVE = 'gerador-perfil-v1';
  var PERFIL_TTL = 10 * 60 * 1000;
  /* perfilQuem: o consultor() de quem e dono de perfilEu (e da busca em voo). Se a pessoa da aba muda sem recarregar
     (sair e outra entrar), tudo isso e descartado e o perfil novo e buscado: nunca se mostra o da pessoa anterior. */
  var perfilEu = null, perfilEm = 0, perfilVoo = null, perfilQuem = '', fotosRuins = {}, itensMenu = [];
  function mesmaPessoa(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function urlPerfil() { return (location.hostname === 'localhost' ? 'http://localhost:3001' : '/_api') + '/gerador/perfil'; }
  function tokenAtual() {
    try { if (typeof sessaoAtual !== 'undefined' && sessaoAtual && sessaoAtual.access_token) return String(sessaoAtual.access_token); } catch (e) {}
    try { var s = JSON.parse(localStorage.getItem('irmaos-na-obra-sessao-v1') || 'null'); return (s && s.access_token) ? String(s.access_token) : ''; } catch (e2) {}
    return '';
  }
  function lerCachePerfil() {
    try {
      var o = JSON.parse(localStorage.getItem(PERFIL_CHAVE) || 'null');
      if (o && o.eu && o.eu.nome && mesmaPessoa(o.consultor, consultor())) return { eu: o.eu, em: Number(o.em) || 0 };
    } catch (e) {}
    return null;
  }
  function gravarCachePerfil(eu) {
    try { localStorage.setItem(PERFIL_CHAVE, JSON.stringify({ consultor: consultor(), em: Date.now(), eu: { nome: eu.nome, email: eu.email || '', socio: eu.socio === true, whatsapp: eu.whatsapp || null, foto_url: eu.foto_url || null } })); } catch (e) {}
  }
  /* Foto de quem esta logado: a que veio do perfil, senao a do mapa que o app carrega dos consultores (se ja chegou). */
  function fotoDoUsuario() {
    var f = '';
    if (perfilEu && perfilEu.foto_url) f = String(perfilEu.foto_url);
    if (!f) {
      try {
        if (typeof consultoresFotos === 'object' && consultoresFotos) {
          var c = consultor();
          for (var k in consultoresFotos) if (Object.prototype.hasOwnProperty.call(consultoresFotos, k) && mesmaPessoa(k, c)) { f = String(consultoresFotos[k] || ''); break; }
        }
      } catch (e) {}
    }
    /* So endereco https de verdade vira imagem; qualquer outro (http:, data:, javascript:) vira a inicial. */
    return f && /^https:\/\//.test(f) && !fotosRuins[f] ? f : '';
  }
  /* Quem esta na aba mudou (ou saiu): esquece o perfil, o cache e a busca em voo da pessoa anterior. */
  function esquecerPerfil() {
    perfilEu = null; perfilEm = 0; perfilQuem = ''; perfilVoo = null; fotosRuins = {};
    try { localStorage.removeItem(PERFIL_CHAVE); } catch (e) {}
  }
  /* Foto ou inicial dentro de um no. So mexe no DOM quando muda (o io2Sync roda o tempo todo). */
  function pintarFoto(no, foto, inicial) {
    if (!no) return;
    var chave = foto ? 'f:' + foto : 'i:' + inicial;
    if (no.getAttribute('data-io2-av') === chave) return;
    no.setAttribute('data-io2-av', chave);
    no.textContent = '';
    if (foto) {
      var im = document.createElement('img');
      im.alt = ''; im.decoding = 'async';
      im.addEventListener('error', function () { fotosRuins[foto] = true; no.removeAttribute('data-io2-av'); pintarUsuario(); });
      im.src = foto;
      no.appendChild(im);
    } else {
      no.textContent = inicial;
    }
  }
  function papelDoPerfil() { return perfilEu ? (perfilEu.socio ? 'Sócio' : 'Consultor') : ''; }
  function pintarUsuario() {
    if (!montado || !el.avatar) return;
    var c = consultor();
    /* Outra pessoa na mesma aba: zera o perfil da anterior e busca o desta (so com sessao: sem token nao ha o que buscar). */
    if (c && perfilQuem && !mesmaPessoa(perfilQuem, c)) { esquecerPerfil(); }
    if (c && !perfilQuem && tokenAtual()) { perfilQuem = c; carregarPerfil(true); }
    var foto = fotoDoUsuario();
    var ini = c ? c.charAt(0).toUpperCase() : '';
    pintarFoto(el.avatar, foto, ini);
    pintarFoto(el.umFoto, foto, ini);
    if (el.user) el.user.setAttribute('aria-label', c ? 'Menu do usuário: ' + c : 'Menu do usuário');
    if (el.umNome) el.umNome.textContent = c;
    if (el.umMail) el.umMail.textContent = (perfilEu && perfilEu.email) || '';
    if (el.umPapel) { var p = papelDoPerfil(); el.umPapel.textContent = p; el.umPapel.hidden = !p; }
    var socio = !!(perfilEu && perfilEu.socio);
    itensMenu.forEach(function (b) { if (b.getAttribute('data-io2-socio')) b.hidden = !socio; });
    var fs = el.folha ? el.folha.querySelectorAll('[data-io2-socio]') : [];
    for (var i = 0; i < fs.length; i++) fs[i].hidden = !socio;
  }
  function aplicarPerfil(eu, gravar) {
    if (!eu || !eu.nome) return;
    perfilEu = { nome: eu.nome, email: eu.email || (perfilEu && perfilEu.email) || '', socio: eu.socio === true || (eu.socio === undefined && !!(perfilEu && perfilEu.socio)), whatsapp: eu.whatsapp || null, foto_url: eu.foto_url || null };
    perfilEm = Date.now();
    if (gravar) gravarCachePerfil(perfilEu);
    pintarUsuario();
  }
  function carregarPerfil(forcar) {
    var quem = consultor();
    if (perfilQuem && !mesmaPessoa(perfilQuem, quem)) esquecerPerfil();
    if (perfilVoo) return perfilVoo;
    if (!forcar && perfilEu && (Date.now() - perfilEm) < PERFIL_TTL) return Promise.resolve(perfilEu);
    perfilQuem = quem;
    var pre = Promise.resolve();
    try { if (typeof authRenovarSePreciso === 'function') pre = Promise.resolve(authRenovarSePreciso()).catch(function () {}); } catch (e) {}
    var voo = perfilVoo = pre.then(function () {
      var tok = tokenAtual();
      if (!tok) throw new Error('sem sessao');
      return fetch(urlPerfil(), { headers: { Authorization: 'Bearer ' + tok } });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok || !j || !j.eu) throw new Error('perfil');
        return j;
      });
    }).then(function (j) {
      if (desfeito || !mesmaPessoa(quem, consultor())) return null; /* a sessao mudou no meio do caminho */
      aplicarPerfil(j.eu, true);
      return perfilEu;
    }).catch(function () { return null; }).then(function (v) { if (perfilVoo === voo) perfilVoo = null; return v; });
    return voo;
  }
  function itemMenu(rotulo, icone, chave, tag) {
    var b = criar(tag || 'button', null, 'io2-um-item');
    if (!tag) b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('data-io2', chave);
    b.tabIndex = -1;
    b.appendChild(svg(icone));
    var r = criar('span'); r.textContent = rotulo;
    b.appendChild(r);
    return b;
  }
  function montarMenuUsuario() {
    itensMenu = [];
    var m = criar('div', 'io2-menu-user', 'io2-um');
    m.hidden = true;
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', 'Menu do usuário');
    el.menu = m;
    var cab = criar('div', null, 'io2-um-cab');
    el.umFoto = criar('span', null, 'io2-um-foto');
    el.umFoto.setAttribute('aria-hidden', 'true');
    var id = criar('div', null, 'io2-um-id');
    el.umNome = criar('span', null, 'io2-um-nome');
    el.umMail = criar('span', null, 'io2-um-mail');
    el.umPapel = criar('span', null, 'io2-um-papel');
    el.umPapel.hidden = true;
    id.appendChild(el.umNome); id.appendChild(el.umMail); id.appendChild(el.umPapel);
    cab.appendChild(el.umFoto); cab.appendChild(id);
    m.appendChild(cab);
    var sep1 = criar('div', null, 'io2-um-sep'); sep1.setAttribute('role', 'separator'); m.appendChild(sep1);
    var perf = itemMenu('Meu perfil', ICONES.perfil, 'perfil');
    var eqp = itemMenu('Perfis da equipe', ICONES.equipe, 'perfil-equipe');
    eqp.hidden = true; eqp.setAttribute('data-io2-socio', '1');
    var tema = botaoTema('io2-um-item');
    tema.setAttribute('role', 'menuitem'); tema.tabIndex = -1;
    var antigo = itemMenu('Visual antigo', ICONES.antigo, 'visual-antigo', 'a');
    antigo.href = '/gerador/visual-antigo.html';
    var sair = itemMenu('Sair', ICONES.sair, 'sair');
    [perf, eqp].forEach(function (b) { m.appendChild(b); });
    var sep2 = criar('div', null, 'io2-um-sep'); sep2.setAttribute('role', 'separator'); m.appendChild(sep2);
    m.appendChild(tema); m.appendChild(antigo);
    var sep3 = criar('div', null, 'io2-um-sep'); sep3.setAttribute('role', 'separator'); m.appendChild(sep3);
    m.appendChild(sair);
    itensMenu = [perf, eqp, tema, antigo, sair];
    /* Escolher um item fecha o menu devolvendo o foco ao botao (a janela do perfil guarda o foco de quem a abriu). */
    [perf, eqp, sair].forEach(function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-io2'); fecharMenuUsuario(true); acionar(k); });
    });
    tema.addEventListener('click', function () { fecharMenuUsuario(false); });
    m.addEventListener('keydown', function (ev) {
      var vis = itensMenu.filter(function (b) { return !b.hidden; });
      var i = vis.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); vis[(i + 1) % vis.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); vis[(i - 1 + vis.length) % vis.length].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); vis[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); vis[vis.length - 1].focus(); }
      else if (ev.key === 'Tab') { fecharMenuUsuario(false); }
    });
    return m;
  }
  function abrirMenuUsuario(focar) {
    if (!montado || !el.menu || !el.menu.hidden) return;
    fecharFolha(false);
    el.menu.hidden = false;
    el.user.setAttribute('aria-expanded', 'true');
    pintarUsuario();
    carregarPerfil(false);
    if (focar) {
      var vis = itensMenu.filter(function (b) { return !b.hidden; });
      if (vis[0]) vis[0].focus();
    }
  }
  function fecharMenuUsuario(devolverFoco) {
    if (!el.menu || el.menu.hidden) return;
    el.menu.hidden = true;
    if (el.user) el.user.setAttribute('aria-expanded', 'false');
    if (devolverFoco && el.user) el.user.focus();
  }
  function ligarMenuUsuario() {
    var c0 = lerCachePerfil();
    if (c0) { perfilEu = c0.eu; perfilEm = c0.em; perfilQuem = consultor(); }
    ouvir(document, 'mousedown', function (ev) {
      var t = ev.target;
      if (!el.menu || el.menu.hidden) return;
      if (t && t.closest && (t.closest('#io2-menu-user') || t.closest('.io2-t-user'))) return;
      fecharMenuUsuario(false);
    }, true);
    ouvir(document, 'focusin', function (ev) {
      var t = ev.target;
      if (!el.menu || el.menu.hidden) return;
      if (t && t.closest && (t.closest('#io2-menu-user') || t.closest('.io2-t-user'))) return;
      fecharMenuUsuario(false);
    });
    ouvir(document, 'keydown', function (ev) { if (ev.key === 'Escape' && el.menu && !el.menu.hidden) { ev.stopPropagation(); fecharMenuUsuario(true); } }, true);
    ouvir(window, 'resize', function () { if (window.innerWidth <= 860) fecharMenuUsuario(false); });
    /* A janela do perfil avisa quando muda o perfil de quem esta logado (foto, WhatsApp) e quando le o perfil. */
    ouvir(window, 'io2-perfil', function (ev) {
      var d = ev && ev.detail;
      if (d && d.eu && d.proprio === true) aplicarPerfil(d.eu, true);
    });
    /* A conta saiu (authLimpar avisa): sem perfil, sem menu aberto. A proxima pessoa busca o dela (pintarUsuario). */
    ouvir(window, 'io2-sessao-limpa', function () { esquecerPerfil(); fecharMenuUsuario(false); pintarUsuario(); });
    pintarUsuario();
    /* Sem perfil guardado (ou velho), busca em segundo plano: o avatar ganha a foto e o menu o e-mail e o papel. */
    if (!perfilEu || (Date.now() - perfilEm) > PERFIL_TTL) carregarPerfil(false);
  }
  /* Tema escuro / claro (escolha de cada aparelho, localStorage['gerador-tema']). Um <button> que grava a escolha e recarrega:
     o app pinta algumas cores em JavaScript conforme o tema, entao a troca so vale na carga seguinte. Vive no pe do trilho
     (antes do "Visual antigo") e na folha "Mais"; entra em `criados` e sai no desfazer(). Se o localStorage falhar, nao faz nada. */
  var ICONE_LUA = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  var ICONE_SOL = '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>';
  function temaEscuroAgora() { return h.getAttribute('data-io2-tema') === 'escuro'; }
  function alternarTema() {
    var novo = temaEscuroAgora() ? 'claro' : 'escuro';
    try { localStorage.setItem('gerador-tema', novo); if (localStorage.getItem('gerador-tema') !== novo) return; } catch (e) { return; }
    try { location.reload(); } catch (e2) {}
  }
  function botaoTema(cls) {
    var esc = temaEscuroAgora();
    var b = criar('button', null, cls);
    b.type = 'button';
    b.setAttribute('data-io2', 'tema');
    b.appendChild(svg(esc ? ICONE_SOL : ICONE_LUA));
    var r = criar('span');
    r.textContent = esc ? 'Tema claro' : 'Tema escuro';
    b.appendChild(r);
    b.addEventListener('click', alternarTema);
    return b;
  }
  /* Item de navegacao que e so um endereco: <a href> de verdade (sem classe sb-item, que o Sair e o Atualizar usam como chave). */
  function criarLink(it, cls) {
    var a = criar('a', null, cls);
    a.href = it.link;
    a.setAttribute('data-io2', it.chave);
    a.textContent = it.rotulo;
    return a;
  }
  /* ---------------------------------------------------------------- trilho recolhivel */
  /* Dois estados do trilho (so de 861 px para cima): aberto (240 px) e recolhido (64 px, so icones). A classe io2-trilha no
     <html> e o estado recolhido; o CSS troca --sb-w e o resto deriva dele. A preferencia e POR CONTEXTO: o Inicio e todo o resto
     (telas internas do app e subapps). Sem nada gravado: Inicio aberto, interno recolhido. A memoria da pagina manda; o
     localStorage so guarda (se falhar, vale o padrao e o botao continua funcionando). */
  var MENU_CHAVE = { inicio: 'gerador-menu-inicio', interno: 'gerador-menu-interno' };
  var MENU_PADRAO = { inicio: 'aberto', interno: 'recolhido' };
  var ALVOS_TRILHA = '#app-sidebar .sb-brand, #app-sidebar .sb-item, #app-sidebar .io2-sb-tema, #app-sidebar .io2-sb-link, #app-sidebar .io2-sb-toggle';
  var prefMenu = {}, ctxMenu = '', larguraAg = 0, animaTimer = 0, trilhados = [], aguardaIr = null, irEmCurso = false, bootAte = -1;
  function menuPref(c) {
    if (prefMenu[c]) return prefMenu[c];
    var v = '';
    try { v = localStorage.getItem(MENU_CHAVE[c]) || ''; } catch (e) {}
    prefMenu[c] = (v === 'aberto' || v === 'recolhido') ? v : MENU_PADRAO[c];
    return prefMenu[c];
  }
  function menuGravar(c, v) {
    prefMenu[c] = v;
    try { localStorage.setItem(MENU_CHAVE[c], v); } catch (e) {}
  }
  /* Em que contexto esta: subapp e interno; no app, o Inicio e o Inicio e o resto e interno. Quem manda e o item aceso do
     trilho (o app o acende em toda troca de tela). Sem item aceso (o app ainda esta subindo, ou a proposta gerada) so o titulo
     do Inicio vale; do contrario fica o contexto de antes, e na primeira montagem vale o Inicio. Quando um subapp pediu outra
     tela (gerador-ir, lido sem apagar), o contexto e interno ate o pedido ser atendido: o app passa pelo Inicio no caminho e
     o trilho nao pode abrir e fechar por causa disso. */
  function menuContexto(r) {
    if (modoSub) return 'interno';
    if (aguardaIr === null) {
      var pedido = '';
      try { pedido = sessionStorage.getItem('gerador-ir') || ''; } catch (e) {}
      aguardaIr = !!pedido && pedido !== 'inicio' && pedido !== 'sair' && pedido !== 'perfil' && pedido !== 'perfil-equipe';
      if (aguardaIr) { bootAte = 0; setTimeout(liberarIr, 6000); }
    }
    if (aguardaIr) return 'interno';
    var c = ctxMenu || 'inicio';
    if (r && r.ativo) c = r.ativo === 'nav-inicio' ? 'inicio' : 'interno';
    else if (r && r.titulo === 'Início') c = 'inicio';
    /* O app sobe passando pelo formulario do Solar por uns 100 ms antes de acender o Inicio. Nessa subida (ate o Inicio
       aparecer, no maximo 2,5 s, ou ate a primeira acao da pessoa) o contexto fica no Inicio. */
    if (bootAte < 0) bootAte = performance.now() + 2500;
    if (bootAte > 0) {
      if (c === 'inicio' && r && (r.ativo === 'nav-inicio' || r.titulo === 'Início')) bootAte = 0;
      else if (performance.now() >= bootAte) bootAte = 0;
      else if (c === 'interno') return 'inicio';
    }
    return c;
  }
  function liberarIr() {
    if (aguardaIr !== true) return;
    aguardaIr = false;
    try { io2Sync(); } catch (e) {}
  }
  function botaoTrilha() {
    var b = criar('button', null, 'io2-sb-toggle');
    b.type = 'button';
    b.setAttribute('aria-controls', 'app-sidebar');
    b.setAttribute('data-io2', 'trilha');
    b.appendChild(svg(ICONES.recolher));
    b.addEventListener('click', alternarTrilha);
    el.toggle = b;
    return b;
  }
  function iconeLinkAntigo(a) {
    var s = svg(ICONES.antigo);
    s.setAttribute('class', 'io2-sb-link-ic');
    a.insertBefore(s, a.firstChild);
  }
  function trilhaBotao() {
    if (!el.toggle) return;
    var rec = h.classList.contains('io2-trilha');
    var nome = rec ? 'Abrir menu' : 'Recolher menu';
    if (el.toggle.getAttribute('aria-label') !== nome) { el.toggle.setAttribute('aria-label', nome); el.toggle.setAttribute('title', nome); }
    var ex = rec ? 'false' : 'true';
    if (el.toggle.getAttribute('aria-expanded') !== ex) el.toggle.setAttribute('aria-expanded', ex);
  }
  /* Recolhido, o texto some da tela: o nome passa para o aria-label (e para o title, que e o aviso do navegador).
     So o que a casca pos e marcado em data-io2-trl ("a" aria-label, "t" title) e sai no desligar e no desfazer(). */
  function trilhaRotulos(ligar) {
    var ns = document.querySelectorAll(ALVOS_TRILHA);
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (n === el.toggle) continue;
      if (ligar) {
        var nome = n.classList.contains('sb-brand') ? (n.getAttribute('title') || 'Início') : textoDe(n);
        if (!nome) continue;
        var marca = '';
        if (!n.hasAttribute('aria-label')) { n.setAttribute('aria-label', nome); marca += 'a'; }
        if (!n.hasAttribute('title')) { n.setAttribute('title', nome); marca += 't'; }
        if (marca) { n.setAttribute('data-io2-trl', marca); trilhados.push(n); }
      } else {
        trilhaLimpar(n);
      }
    }
  }
  function trilhaLimpar(n) {
    var m = n.getAttribute('data-io2-trl');
    if (!m) return;
    if (m.indexOf('a') >= 0) n.removeAttribute('aria-label');
    if (m.indexOf('t') >= 0) n.removeAttribute('title');
    n.removeAttribute('data-io2-trl');
  }
  function mostrarDica(n) {
    if (!el.dica || !h.classList.contains('io2-trilha') || window.innerWidth <= 860) return;
    var nome = n.getAttribute('aria-label');
    if (!nome) return;
    var sb = document.getElementById('app-sidebar');
    var r = n.getBoundingClientRect(), rs = sb ? sb.getBoundingClientRect() : r;
    if (el.dica.textContent !== nome) el.dica.textContent = nome;
    el.dica.style.left = Math.round(rs.right + 8) + 'px';
    el.dica.style.top = Math.round(r.top + r.height / 2) + 'px';
    el.dica.setAttribute('data-aberta', '1');
  }
  function esconderDica() {
    if (el.dica && el.dica.hasAttribute('data-aberta')) el.dica.removeAttribute('data-aberta');
  }
  function alvoDaDica(n) { return (n && n.closest) ? n.closest(ALVOS_TRILHA) : null; }
  function ligarTrilha() {
    ouvir(document, 'mouseover', function (ev) { var a = alvoDaDica(ev.target); if (a) mostrarDica(a); else esconderDica(); });
    ouvir(document.documentElement, 'mouseleave', esconderDica);
    ouvir(document, 'focusin', function (ev) {
      var a = alvoDaDica(ev.target), vis = false;
      if (a) { try { vis = a.matches(':focus-visible'); } catch (e) { vis = true; } }
      if (a && vis) mostrarDica(a); else esconderDica();
    });
    ouvir(document, 'focusout', esconderDica);
    ouvir(document, 'keydown', function (ev) { if (ev.key === 'Escape') esconderDica(); });
    ouvir(document, 'click', function (ev) { if (ev.detail > 0 && alvoDaDica(ev.target)) esconderDica(); }, true);
    var sb = document.getElementById('app-sidebar');
    if (sb) ouvir(sb, 'scroll', esconderDica);
  }
  /* A largura do conteudo muda de uma vez; o app e a casca medem por resize. Um unico aviso por troca, no quadro seguinte. */
  function avisarLargura() {
    if (larguraAg) return;
    larguraAg = requestAnimationFrame(function () {
      larguraAg = 0;
      try { if (!montado || desfeito || window.innerWidth <= 860) return; window.dispatchEvent(new Event('resize')); medirBusca(); } catch (e) {}
    });
  }
  function trilhaAplicar(primeira) {
    var quer = menuPref(ctxMenu || 'interno') === 'recolhido';
    var tem = h.classList.contains('io2-trilha');
    if (quer !== tem) {
      h.classList.toggle('io2-trilha', quer);
      trilhaRotulos(quer);
      esconderDica();
      if (!primeira) avisarLargura();
    }
    trilhaBotao();
    /* A animacao de largura so liga depois da primeira montagem: a carga nunca anima. Atributo (nao classe): a casca
       observa as classes do <html>. */
    if (!animaTimer) animaTimer = setTimeout(function () { try { if (!desfeito) h.setAttribute('data-io2-anima', '1'); } catch (e) {} }, 250);
  }
  function trilhaSync(r, primeira) {
    ctxMenu = menuContexto(r);
    trilhaAplicar(primeira);
  }
  function alternarTrilha() {
    var c = ctxMenu || 'interno';
    menuGravar(c, menuPref(c) === 'recolhido' ? 'aberto' : 'recolhido');
    trilhaAplicar(false);
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
    pe.appendChild(botaoTema('io2-sb-tema'));
    var lkSub = criarLink({ rotulo: 'Visual antigo', link: '/gerador/visual-antigo.html', chave: 'visual-antigo' }, 'io2-sb-link');
    iconeLinkAntigo(lkSub);
    pe.appendChild(lkSub);
    nav.appendChild(botaoTrilha());
    nav.appendChild(marca); nav.appendChild(lista); nav.appendChild(criar('div', null, 'sb-spacer')); nav.appendChild(pe);
    return nav;
  }
  /* Um clique da casca. No index chama o clique do item da barra lateral (lido do DOM). No subapp navega. */
  function acionar(chave) {
    /* Perfil nao tem item na barra lateral: no index chama a janela do perfil.js; no subapp pede ao index (gerador-ir). */
    if (chave === 'perfil' || chave === 'perfil-equipe') {
      var fnPerfil = MODELO.ir[chave];
      if (!modoSub) { try { if (typeof window[fnPerfil] === 'function') window[fnPerfil](); } catch (eP) {} return; }
      if (temSessao()) { try { sessionStorage.setItem('gerador-ir', chave); } catch (eS) {} }
      location.href = '/gerador';
      return;
    }
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

  /* ---------------------------------------------------------------- busca de telas */
  /* Os destinos saem do DOM e do MODELO, nunca de uma lista de textos copiada:
     - primeiro nivel: os itens da barra lateral (MODELO.barra), com o rotulo lido do proprio item;
     - abas (so no index): os botoes das reguas .solar-subtab, .eletro-subtab, .eletro-subtab2, .cad-aba e .crm-subtab,
       com o texto visivel. So entra botao que o app NAO escondeu (hidden, display inline ou computado do proprio botao):
       o pai fechado nao conta, porque Recibo, Frota e Investidores vivem em reguas fechadas ate alguem abrir o grupo.
     O indice e refeito toda vez que o campo ganha o foco, entao nunca fica velho.
     Ir ate la = clicar no item da barra lateral certo (acionar) e depois no botao de cada aba da cadeia. Nenhuma
     funcao do app e chamada pelo nome, e location.search e location.hash nunca sao tocados. */
  var LUPA = '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>';
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function botoes(sel, escopo) {
    var o = [], ns = (escopo || document).querySelectorAll(sel);
    for (var i = 0; i < ns.length; i++) {
      var b = ns[i];
      if (b.hidden || b.disabled || !visivel(b)) continue;
      var t = textoDe(b);
      if (t) o.push({ el: b, t: t });
    }
    return o;
  }
  function registrarAbas() {
    if (modoSub) return;
    MODELO.abasInternas.forEach(function (c) {
      var s = document.getElementById(c.sec);
      if (!s) return; /* sem exigir a tela visivel: o app pode desenhar a regua depois de a pessoa sair; vale o filtro do botao */
      var l = botoes(c.sel, s).map(function (b) { return b.t; });
      if (l.length) abasVistas[c.sec] = l;
    });
  }
  function achar(p) {
    var s = document.getElementById(p.sec), l = s ? botoes(p.sel, s) : [];
    for (var i = 0; i < l.length; i++) if (l[i].t === p.texto) return l[i].el;
    return null;
  }
  function montarIndice() {
    try { registrarAbas(); } catch (e0) {}
    var itens = [], raizes = {}, paisSolar = {};
    function add(caminho, passos, raiz) {
      itens.push({ caminho: caminho, rotulo: caminho[caminho.length - 1], rotuloN: norm(caminho[caminho.length - 1]), texto: norm(caminho.join(' ')), passos: passos, raiz: raiz, nivel: caminho.length, ordem: itens.length });
    }
    MODELO.barra.forEach(function (k) {
      var f = modoSub ? null : fonteDe(k);
      if (!modoSub && (!f || !visivel(f))) return;
      var r = (f && textoDe(f)) || rotuloDe(k);
      raizes[k] = r;
      add([r], [{ chave: k }], k);
    });
    if (modoSub) return itens; /* nos subapps so o primeiro nivel */
    var rs = raizes['nav-solar'], re = raizes['nav-eletroposto'], rc = raizes['nav-crm'];
    if (rs) {
      botoes('.solar-subtab').forEach(function (b) {
        add([rs, b.t], [{ chave: 'nav-solar' }, { el: b.el }], 'nav-solar');
        paisSolar[b.el.getAttribute('data-aba')] = b;
      });
      MODELO.abasInternas.forEach(function (c) {
        var pai = paisSolar[c.aba], lista = abasVistas[c.sec];
        if (!pai || !lista) return;
        lista.forEach(function (t) {
          add([rs, pai.t, t], [{ chave: 'nav-solar' }, { el: pai.el }, { sec: c.sec, sel: c.sel, texto: t }], 'nav-solar');
        });
      });
    }
    if (re) {
      var sec = document.getElementById('eletroSection') || document;
      var n1 = botoes('.eletro-subtab', sec), tabCad = null, tabCadTxt = '';
      n1.forEach(function (a) {
        add([re, a.t], [{ chave: 'nav-eletroposto' }, { el: a.el }], 'nav-eletroposto');
        if (a.el.id === 'eletro-tab-cadastros') { tabCad = a.el; tabCadTxt = a.t; }
        if (a.el.id.indexOf('eletro-grp-') === 0) {
          var r2 = document.getElementById('eletro-subnav2-' + a.el.id.slice('eletro-grp-'.length));
          if (r2) botoes('.eletro-subtab2', r2).forEach(function (c) {
            add([re, a.t, c.t], [{ chave: 'nav-eletroposto' }, { el: a.el }, { el: c.el }], 'nav-eletroposto');
          });
        }
      });
      if (tabCad) botoes('.cad-aba', sec).forEach(function (c) {
        add([re, tabCadTxt, c.t], [{ chave: 'nav-eletroposto' }, { el: tabCad }, { el: c.el }], 'nav-eletroposto');
      });
    }
    if (rc) botoes('.crm-subtab', document.getElementById('crmSection') || document).forEach(function (b) { add([rc, b.t], [{ chave: 'nav-crm' }, { el: b.el }], 'nav-crm'); });
    return itens;
  }
  function pesquisar(q, max) {
    var termos = norm(q).split(/\s+/).filter(Boolean);
    if (!termos.length || !indiceBusca) return [];
    var junto = termos.join(' '), r = [];
    indiceBusca.forEach(function (it) {
      for (var i = 0; i < termos.length; i++) if (it.texto.indexOf(termos[i]) < 0) return;
      var p;
      if (it.rotuloN.indexOf(junto) === 0) p = 0;                       /* comeca o rotulo */
      else if ((' ' + it.rotuloN).indexOf(' ' + junto) >= 0) p = 1;     /* comeca uma palavra do rotulo */
      else if (it.rotuloN.indexOf(junto) >= 0) p = 2;                   /* no meio do rotulo */
      else p = 3;                                                       /* so no caminho */
      r.push({ it: it, p: p });
    });
    r.sort(function (a, b) { return (a.p - b.p) || (a.it.nivel - b.it.nivel) || (a.it.ordem - b.it.ordem); });
    return r.slice(0, max).map(function (x) { return x.it; });
  }
  function seguro(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { desligarBusca(); }
    };
  }
  /* Qualquer erro da busca: some so o campo (e a folha volta ao normal). A casca segue de pe. */
  function desligarBusca() {
    try {
      buscas.forEach(function (B) { if (B.raiz.parentNode) B.raiz.parentNode.removeChild(B.raiz); });
      buscas = []; Bd = null; Bm = null; indiceBusca = null;
      if (el.folha) el.folha.classList.remove('io2-f-buscando');
    } catch (e) {}
  }
  function criarBusca(movel) {
    var B = { n: ++buscaId, movel: movel, itens: [], ativo: -1 };
    B.raiz = criar('div', null, 'io2-busca' + (movel ? ' io2-busca-m' : ''));
    B.raiz.setAttribute('role', 'search');
    var campo = criar('div', null, 'io2-b-campo');
    campo.appendChild(svg(LUPA));
    var inp = criar('input', 'io2-busca-in' + B.n, 'io2-b-in');
    inp.type = 'text';
    inp.placeholder = 'Buscar tela';
    inp.setAttribute('aria-label', 'Buscar tela');
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('spellcheck', 'false');
    inp.setAttribute('enterkeyhint', 'go');
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-haspopup', 'listbox');
    inp.setAttribute('aria-expanded', 'false');
    var ul = criar('ul', 'io2-busca-lista' + B.n, 'io2-b-lista');
    ul.hidden = true;
    ul.setAttribute('role', 'listbox');
    ul.setAttribute('aria-label', 'Telas encontradas');
    inp.setAttribute('aria-controls', ul.id);
    campo.appendChild(inp);
    if (!movel) {
      var dica = criar('kbd', null, 'io2-b-dica');
      dica.setAttribute('aria-hidden', 'true');
      dica.textContent = '/';
      campo.appendChild(dica);
    }
    var vivo = criar('span', null, 'io2-b-vivo');
    vivo.setAttribute('role', 'status');
    vivo.setAttribute('aria-live', 'polite');
    B.inp = inp; B.ul = ul; B.vivo = vivo;
    B.raiz.appendChild(campo); B.raiz.appendChild(ul); B.raiz.appendChild(vivo);

    inp.addEventListener('focus', seguro(function () {
      indiceBusca = montarIndice();
      if (inp.value.trim()) renderizar(B);
    }));
    inp.addEventListener('input', seguro(function () { if (!indiceBusca) indiceBusca = montarIndice(); renderizar(B); }));
    inp.addEventListener('blur', seguro(function () {
      setTimeout(seguro(function () { if (document.activeElement !== inp) fecharLista(B); }), 0);
    }));
    inp.addEventListener('keydown', seguro(function (ev) {
      var k = ev.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        if (ul.hidden) { if (inp.value.trim()) renderizar(B); return; }
        if (!B.itens.length) return;
        var d = k === 'ArrowDown' ? 1 : -1;
        marcarOpcao(B, (B.ativo + d + B.itens.length) % B.itens.length);
      } else if (k === 'Enter') {
        if (!ul.hidden && B.ativo >= 0 && B.itens[B.ativo]) { ev.preventDefault(); irPara(B.itens[B.ativo]); }
      } else if (k === 'Escape') {
        /* No computador o Esc sempre devolve o foco; na folha, com o campo vazio, o Esc segue para fechar a folha. */
        if (!ul.hidden || inp.value || !B.movel) {
          ev.preventDefault(); ev.stopPropagation();
          inp.value = ''; fecharLista(B);
          devolverFoco(B);
        }
      } else if (k === 'Tab') {
        fecharLista(B);
      }
    }));
    buscas.push(B);
    return B;
  }
  function devolverFoco(B) {
    var a = focoAntes; focoAntes = null;
    if (B.movel) { var p = el.folha.querySelector('.io2-f-item'); if (p) p.focus(); else B.inp.blur(); return; }
    if (a && a !== document.body && a.isConnected && typeof a.focus === 'function') a.focus(); else B.inp.blur();
  }
  function renderizar(B) {
    var q = B.inp.value;
    if (!q.trim()) { fecharLista(B); return; }
    var res = pesquisar(q, B.movel ? 6 : 8);
    B.itens = res; B.ativo = res.length ? 0 : -1;
    B.ul.innerHTML = '';
    res.forEach(function (it, i) {
      var li = criar('li', 'io2-bo-' + B.n + '-' + i, 'io2-b-op');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.setAttribute('data-caminho', it.caminho.join(' › '));
      li.appendChild(iconeDe({ chave: it.raiz }));
      var txt = criar('span', null, 'io2-b-op-txt');
      if (it.caminho.length > 1) {
        var pai = criar('span', null, 'io2-b-pai');
        pai.textContent = it.caminho.slice(0, -1).join(' › ') + ' › ';
        txt.appendChild(pai);
      }
      var fim = criar('span', null, 'io2-b-fim');
      fim.textContent = it.rotulo;
      txt.appendChild(fim);
      li.appendChild(txt);
      /* mousedown sem foco perdido: sem isto o blur do campo fecharia a lista antes do clique */
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      li.addEventListener('click', seguro(function () { irPara(it); }));
      li.addEventListener('mousemove', function () { if (B.ativo !== i) marcarOpcao(B, i); });
      B.ul.appendChild(li);
    });
    if (!res.length) {
      var v = criar('li', null, 'io2-b-vazio');
      v.setAttribute('role', 'option');
      v.setAttribute('aria-disabled', 'true');
      v.setAttribute('aria-selected', 'false');
      v.textContent = 'Nenhuma tela com esse nome.';
      B.ul.appendChild(v);
    }
    B.vivo.textContent = res.length ? (res.length === 1 ? '1 tela encontrada.' : res.length + ' telas encontradas.') : 'Nenhuma tela com esse nome.';
    B.ul.hidden = false;
    B.inp.setAttribute('aria-expanded', 'true');
    if (B.movel) el.folha.classList.add('io2-f-buscando');
    marcarOpcao(B, B.ativo);
  }
  function marcarOpcao(B, i) {
    B.ativo = i;
    var ops = B.ul.querySelectorAll('.io2-b-op');
    for (var j = 0; j < ops.length; j++) ops[j].setAttribute('aria-selected', j === i ? 'true' : 'false');
    if (i >= 0 && ops[i]) {
      B.inp.setAttribute('aria-activedescendant', ops[i].id);
      if (ops[i].scrollIntoView) ops[i].scrollIntoView({ block: 'nearest' });
    } else B.inp.removeAttribute('aria-activedescendant');
  }
  function fecharLista(B) {
    if (!B || !B.ul) return;
    B.ul.hidden = true; B.itens = []; B.ativo = -1;
    B.inp.setAttribute('aria-expanded', 'false');
    B.inp.removeAttribute('aria-activedescendant');
    if (B.movel && el.folha) el.folha.classList.remove('io2-f-buscando');
  }
  function irPara(it) {
    buscas.forEach(function (B) { B.inp.value = ''; fecharLista(B); });
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e0) {}
    focoAntes = null;
    fecharFolha(false);
    var p = it.passos;
    try { acionar(p[0].chave); } catch (e1) {}
    seguirPassos(p, 1, 0);
  }
  /* Aba de dentro de tela: a regua e desenhada pelo app depois do clique na tela (e as vezes depois de uma busca
     de dados), entao o botao e procurado pelo texto e tentado por ate ~2 s. */
  function seguirPassos(p, i0, tentativa) {
    for (var i = i0; i < p.length; i++) {
      try {
        var b = p[i].el;
        if (!b && p[i].sec) {
          b = achar(p[i]);
          if (!b) {
            if (tentativa < 14) { var k = i; setTimeout(function () { try { seguirPassos(p, k, tentativa + 1); } catch (e3) {} }, 150); }
            return;
          }
        }
        if (b && b.isConnected) b.click();
      } catch (e2) {}
    }
  }
  function emCampo(t) {
    if (!t || !t.tagName) return false;
    var n = t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || !!t.isContentEditable;
  }
  /* Sobreposicao aberta, descoberta pelo que esta VISIVEL e nao so por nome:
     1) os conhecidos do app (modais, detalhe do CRM, previa, ligar, mapa, modais dos subapps) que estejam na tela;
     2) qualquer coisa fixa acima da casca (z-index maior que 955) por cima de pontos da janela, sem contar o toast. */
  var SOBREPOSICOES = '.modal-overlay, #crm-det-bg, .pv-bg, .ep-prev-bg, .pn-liga, #marr, .modal-bg, .ov, dialog[open], [aria-modal="true"]:not(#io2-folha)';
  function naTela(n) {
    if (!n || !n.getClientRects().length) return false;
    var cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0 && cs.pointerEvents !== 'none';
  }
  function sobreposicaoAberta() {
    var ns = document.querySelectorAll(SOBREPOSICOES);
    for (var i = 0; i < ns.length; i++) if (naTela(ns[i])) return true;
    var w = window.innerWidth, hh = window.innerHeight;
    var pts = [[.5, .5], [.25, .5], [.75, .5], [.5, .3], [.5, .75]];
    for (var p = 0; p < pts.length; p++) {
      var pilha = document.elementsFromPoint(Math.round(w * pts[p][0]), Math.round(hh * pts[p][1]));
      for (var j = 0; j < pilha.length; j++) {
        for (var a = pilha[j]; a && a !== document.documentElement; a = a.parentElement) {
          if (a.id === 'io2-topo' || a.id === 'io2-baixo' || a.id === 'io2-folha' || a.id === 'io2-fundo' || a.id === 'toast') break;
          var cs = getComputedStyle(a);
          if (cs.position === 'fixed' && parseInt(cs.zIndex, 10) > 955 && a.id !== 'toast') return true;
        }
      }
    }
    return false;
  }
  /* "/" e Ctrl+K levam o foco ao campo: no computador o da barra superior; no celular (teclado fisico) o da folha. */
  function atalhoBusca(ev) {
    var k = ev.key;
    var ctrlK = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (k === 'k' || k === 'K');
    var barra = k === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !emCampo(ev.target);
    if (!ctrlK && !barra) return;
    /* A busca nunca abre por baixo de modal, folha ou sobreposicao do app. */
    if (el.folha && !el.folha.hidden) return;
    if (sobreposicaoAberta()) return;
    var B = null;
    if (Bd && Bd.raiz.getClientRects().length) B = Bd;
    else if (Bm && el.mais && el.mais.getClientRects().length) { abrirFolha(); B = Bm; }
    if (!B) return;
    ev.preventDefault();
    var a = document.activeElement;
    focoAntes = (a && a !== B.inp && a !== document.body) ? a : null;
    B.inp.focus();
    B.inp.select();
  }
  /* A busca fica ancorada na direita, a 16 px do usuario, com a mesma largura em toda tela (no app e nos subapps).
     O que sobrou do cabecalho antigo (recarregar, selo de ambiente) mora no bloco .io2-t-extra, a ESQUERDA da busca:
     nunca a empurra. Se a largura nao der para titulo + ferramentas + busca (minimo de 160 px), a busca some por ultimo. */
  function medirBusca() {
    if (!Bd || !el.topo || !Bd.raiz.parentNode) return;
    var r = Bd.raiz;
    r.style.marginRight = ''; r.classList.remove('io2-b-oculta');
    if (!r.getClientRects().length) return; /* escondida por CSS (celular): nada a medir */
    var user = el.topo.querySelector('.io2-t-user');
    var txt = el.topo.querySelector('.io2-t-txt');
    var topoR = el.topo.getBoundingClientRect();
    var uEsq = user && user.getClientRects().length ? user.getBoundingClientRect().left : topoR.right - 24;
    var ex = 0;
    if (el.extra && el.extra.getClientRects().length) { var ew = el.extra.getBoundingClientRect().width; if (ew > 0) ex = ew + 16; }
    /* Largura real do texto do titulo (nao a da caixa, que cresce para encher a barra). */
    var natural = 0;
    try { var rg = document.createRange(); rg.selectNodeContents(el.titulo); natural = Math.ceil(rg.getBoundingClientRect().width); } catch (e) {}
    natural = Math.min(natural || 160, 300);
    /* A busca encolhe ate 160 px; se com isso o titulo ainda nao couber inteiro, ela some (por ultimo). */
    var livre = (uEsq - 16 - ex) - (txt.getBoundingClientRect().left + natural + 16);
    if (livre < 160) r.classList.add('io2-b-oculta');
  }
  function ligarBusca() {
    try { ligarBuscaIn(); } catch (e) { desligarBusca(); }
  }
  function ligarBuscaIn() {
    if (!Bd && !Bm) return;
    ouvir(document, 'keydown', seguro(atalhoBusca));
    ouvir(document, 'mousedown', seguro(function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('.io2-busca')) return;
      buscas.forEach(fecharLista);
    }), true);
    ouvir(window, 'resize', seguro(function () { buscas.forEach(fecharLista); medirBusca(); }));
    if (typeof ResizeObserver === 'function') {
      try {
        var ro = new ResizeObserver(seguro(medirBusca));
        if (el.extra) ro.observe(el.extra);
        if (el.topo) ro.observe(el.topo);
        observadores.push(ro);
      } catch (e) {}
    }
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(seguro(medirBusca)); } catch (e2) {}
    medirBusca();
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
    try { if (Bm) { Bm.inp.value = ''; fecharLista(Bm); } } catch (e) {}
    if (devolverFoco) el.mais.focus();
  }
  function prenderFoco(ev) {
    if (ev.key !== 'Tab') return;
    var itens = [];
    if (Bm && Bm.raiz.parentNode) itens.push(Bm.inp);
    if (!el.folha.classList.contains('io2-f-buscando')) {
      var li = el.folha.querySelectorAll('.io2-f-item');
      for (var q = 0; q < li.length; q++) if (!li[q].hidden) itens.push(li[q]);
    }
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
      if (t.area) partes.push(t.area);
      if (t.h1) {
        var h1 = sec.querySelector('.header-titulo h1');
        var th = h1 ? textoProprio(h1) : '';
        if (th && th !== t.titulo) partes.push(th);
      }
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
      var r = modoSub ? { titulo: sub.titulo, aba: sub.area || sub.ctx || '', ativo: sub.ativo } : descobrir();
      trilhaSync(r, false);
      if (r.titulo) el.titulo.textContent = r.titulo;
      el.aba.textContent = r.aba;
      var c = consultor();
      el.cons.textContent = c ? (r.aba ? ' · ' : '') + c : '';
      el.nome.textContent = c;
      pintarUsuario();   /* foto (ou inicial) do avatar e do menu; so mexe no DOM quando muda */
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
        try { medirBusca(); } catch (eM) {}
        return;
      }
      trazerAbas();
      try { registrarAbas(); medirBusca(); } catch (eM2) {}
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
    if (!v) { if (!irEmCurso) liberarIr(); return; }
    try { sessionStorage.removeItem('gerador-ir'); } catch (e2) {}
    if (!Object.prototype.hasOwnProperty.call(MODELO.ir, v)) { liberarIr(); return; }
    var nome = MODELO.ir[v];
    irEmCurso = true;
    setTimeout(function () {
      try { if (typeof window[nome] === 'function') window[nome](); } catch (e3) {}
      irEmCurso = false;
      liberarIr();
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
        ligarBusca();
        ligarTrilha();
        /* O estado do trilho vale antes do CSS da casca: a carga nasce no estado certo, sem abrir e fechar. */
        trilhaSync(descobrir(), true);
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
      h.classList.remove('io2-adotou');
      h.classList.remove('io2-trilha');
      h.removeAttribute('data-io2-anima');
      h.removeAttribute('data-io2-sub');
      h.classList.remove('io2');
      h.removeAttribute('data-io2-tema');
      var tema = window.__io2TemaAntes;
      if (tema) h.setAttribute('data-theme', tema); else h.removeAttribute('data-theme');
      window.__io2 = false;
      h.style.removeProperty('--io-fonte-papel');
    } catch (e) {}
    try { observadores.forEach(function (o) { o.disconnect(); }); } catch (e1) {}
    try { ouvintes.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); }); } catch (e2) {}
    try { envolvidas.forEach(function (w) { if (window[w[0]] === w[2]) window[w[0]] = w[1]; }); } catch (e3) {}
    /* Devolve ao lugar o que a casca adotou (antes de remover a barra superior, que o continha) e desfaz o que marcou. */
    try {
      adotados.forEach(function (x) {
        var n = x[0], pai = x[1], prox = x[2];
        if (!pai || !pai.isConnected) return;
        if (prox && prox.parentNode === pai) pai.insertBefore(n, prox); else pai.appendChild(n);
      });
    } catch (e6) {}
    try { vazios.forEach(function (n) { n.removeAttribute('data-io2-vazio'); }); } catch (e7) {}
    try { carregando.forEach(function (n) { n.removeAttribute('data-io2-carregando'); }); } catch (e7b) {}
    try { rotulados.forEach(function (b) { b.removeAttribute('aria-label'); b.removeAttribute('data-io2-rot'); }); } catch (e8) {}
    try { trilhados.forEach(trilhaLimpar); } catch (e8b) {}
    try { if (animaTimer) clearTimeout(animaTimer); if (larguraAg) cancelAnimationFrame(larguraAg); } catch (e8c) {}
    try {
      var gl = document.querySelectorAll('[data-io2-glifo]');
      for (var gi = 0; gi < gl.length; gi++) if (gl[gi].parentNode) gl[gi].parentNode.replaceChild(document.createTextNode(gl[gi].getAttribute('data-io2-glifo') || ''), gl[gi]);
    } catch (e9) {}
    try { criados.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); } catch (e4) {}
    trilhados = []; el.toggle = null; el.dica = null; animaTimer = 0; larguraAg = 0;
    el.user = null; el.menu = null; el.umFoto = null; el.umNome = null; el.umMail = null; el.umPapel = null; itensMenu = [];
    criados = []; adotados = []; vazios = []; carregando = []; rotulados = []; montado = false; buscas = []; Bd = null; Bm = null; indiceBusca = null; focoAntes = null;
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
    /* A regua de dentro de Leads, Fechamento e Obras e redesenhada pelo app: guarda as abas quando aparecem. */
    var agAbas = 0;
    MODELO.abasInternas.forEach(function (c) {
      var sc = document.getElementById(c.sec);
      if (sc) observar(sc, { childList: true, subtree: true }, function () {
        if (agAbas) return;
        agAbas = setTimeout(function () { agAbas = 0; try { registrarAbas(); } catch (e) {} }, 150);
      });
    });
    /* Abas internas (Cadastros, CRM, fechamento, leads) nao passam por nenhuma das duas. */
    ouvir(document, 'click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('#io2-topo, #io2-baixo, #io2-folha')) return;
      if (ev.isTrusted) bootAte = 0;   /* a pessoa agiu: nao e mais a subida do app */
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
  /* ---------------------------------------------------------------- subapps: cabecalho antigo, glifos, chip */
  /* Move (nao copia) o recarregar e o selo de ambiente para a barra superior. id, onclick e classes ficam como
     estao; desfazer() devolve cada no ao lugar de origem. Acontece ANTES de o CSS da casca esconder o .topbar. */
  function adotar() {
    /* Subapp que adota algo mas ficou sem o bloco na barra: o cabecalho antigo FICA (a classe nao entra). */
    if (sub.adotar && !el.extra) return;
    (sub.adotar || []).forEach(function (sel) {
      var n = document.querySelector(sel);
      if (!n || n.parentNode === el.extra) return;
      adotados.push([n, n.parentNode, n.nextSibling]);
      el.extra.appendChild(n);
    });
    /* Fim da adocao (inclusive sem nada a adotar ou com tudo ja adotado): so agora o CSS pode esconder o .topbar. */
    h.classList.add('io2-adotou');
  }
  /* O recarregar adotado tem font-size:0 (so o icone aparece); a pagina troca o texto dele por uma ampulheta enquanto
     carrega. A casca marca o botao por ATRIBUTO enquanto o texto for a ampulheta, e o CSS gira o icone. */
  function vigiarCarregando() {
    if (!el.extra) return;
    var bs = el.extra.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) (function (b) {
      var marcar = function () {
        try {
          if (/[\u231B\u23F3]/.test(b.textContent || '')) b.setAttribute('data-io2-carregando', '1');
          else b.removeAttribute('data-io2-carregando');
        } catch (e) {}
      };
      carregando.push(b);
      marcar();
      observar(b, { childList: true, characterData: true, subtree: true }, marcar);
    })(bs[i]);
  }
  function textoVazio(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    return t === '' || /^[-\u2010-\u2015\u2212]+$/.test(t);
  }
  /* Selo que a pagina pinta depois do login: enquanto esta vazio ou so com traco, a casca o esconde (atributo, nunca classe). */
  function vigiarVazios() {
    (sub.vazios || []).forEach(function (sel) {
      var n = document.querySelector(sel);
      if (!n) return;
      var marcar = function () {
        try {
          if (textoVazio(n.textContent)) n.setAttribute('data-io2-vazio', '1'); else n.removeAttribute('data-io2-vazio');
          medirBusca();
        } catch (e) {}
      };
      vazios.push(n);
      marcar();
      observar(n, { childList: true, characterData: true, subtree: true }, marcar);
    });
  }
  /* O glifo do botao some do desenho (CSS) e o nome acessivel passa a vir do title que o botao ja tem. */
  function rotularPorTitle() {
    var ns = document.querySelectorAll(MODELO.rotularTitle);
    for (var i = 0; i < ns.length; i++) {
      var b = ns[i], t = b.getAttribute('title');
      if (!t || b.hasAttribute('aria-label') || b.hasAttribute('aria-labelledby')) continue;
      b.setAttribute('aria-label', t);
      b.setAttribute('data-io2-rot', '1');
      rotulados.push(b);
    }
  }
  /* Glifo ou emoji que faz papel de icone: o span entra no lugar do no de texto e guarda o caractere dentro
     (textContent da pagina nao muda; o CSS desenha o icone e recorta o caractere). So nos de texto FILHOS DIRETOS
     dos elementos da lista fechada MODELO.glifos[sub]. */
  var GLIFO_NOME = { '2190': 'seta-e', '2192': 'seta-d', '2191': 'seta-c', '2193': 'seta-b', '1f4ac': 'conversa', '1f9e0': 'cerebro' };
  var RE_GLIFO = /[\u2190-\u2193\u{1F4AC}\u{1F9E0}]\uFE0F?/gu;
  var RE_TEM = /[\u2190-\u2193\u{1F4AC}\u{1F9E0}]/u;
  function trocarGlifosEm(host) {
    var nos = [];
    for (var n = host.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue && RE_TEM.test(n.nodeValue)) nos.push(n);
    nos.forEach(function (tn) {
      var s = tn.nodeValue, frag = document.createDocumentFragment(), ult = 0, m, achou = false;
      RE_GLIFO.lastIndex = 0;
      while ((m = RE_GLIFO.exec(s))) {
        var nome = GLIFO_NOME[m[0].codePointAt(0).toString(16)];
        if (!nome) continue;
        if (m.index > ult) frag.appendChild(document.createTextNode(s.slice(ult, m.index)));
        var sp = criar('span', null, 'io2-gl io2-gl-' + nome);
        sp.setAttribute('aria-hidden', 'true');
        sp.setAttribute('data-io2-glifo', m[0]);
        sp.textContent = m[0];
        frag.appendChild(sp);
        ult = m.index + m[0].length;
        achou = true;
      }
      if (!achou) return;
      if (ult < s.length) frag.appendChild(document.createTextNode(s.slice(ult)));
      if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
    });
  }
  function semTexto(host) {
    var c = host.cloneNode(true), g = c.querySelectorAll('[data-io2-glifo]');
    for (var i = 0; i < g.length; i++) g[i].parentNode.removeChild(g[i]);
    return !c.textContent.replace(/\s+/g, '');
  }
  function varrerGlifos(raiz) {
    var regras = MODELO.glifos[sub.nome];
    if (!regras || !raiz) return;
    if (raiz.nodeType === 3) raiz = raiz.parentNode;
    if (!raiz || raiz.nodeType !== 1) return;
    var feitos = [];
    regras.forEach(function (rg) {
      var hs = [];
      try { if (raiz.matches(rg[0])) hs.push(raiz); } catch (e0) {}
      var q = raiz.querySelectorAll(rg[0]);
      for (var i = 0; i < q.length; i++) hs.push(q[i]);
      hs.forEach(function (h1) { trocarGlifosEm(h1); feitos.push([h1, rg[1]]); });
    });
    /* depois de todas as trocas (o .kbd de dentro do botao tambem): controle que ficou sem texto ganha nome acessivel */
    feitos.forEach(function (x) {
      var b = x[0];
      if (!x[1] || b.tagName !== 'BUTTON' || b.hasAttribute('aria-label') || b.hasAttribute('title') || b.hasAttribute('aria-labelledby')) return;
      if (b.querySelector('[data-io2-glifo]') && semTexto(b)) {
        b.setAttribute('aria-label', x[1]); b.setAttribute('data-io2-rot', '1'); rotulados.push(b);
      }
    });
  }
  function ligarGlifos() {
    if (!MODELO.glifos[sub.nome]) return;
    varrerGlifos(document.body);
    if (typeof MutationObserver !== 'function') return;
    obsGlifos = observar(document.body, { childList: true, subtree: true }, function (muts) {
      try {
        for (var i = 0; i < muts.length; i++) {
          var add = muts[i].addedNodes;
          for (var j = 0; j < add.length; j++) {
            var a = add[j];
            if (a.nodeType === 1 && a.hasAttribute('data-io2-glifo')) continue;
            varrerGlifos(a);
          }
        }
        obsGlifos.takeRecords(); /* descarta o que as proprias trocas geraram */
      } catch (e) {}
    });
  }
  /* Agenda, celular: o chip do consultor ativo e trazido para a vista ao carregar e quando o ativo muda. So a rolagem
     horizontal da faixa de chips (#abas), nunca a da pagina. O ativo e lembrado pelo NOME: a faixa e redesenhada a
     cada carga e comparar o no traria a faixa de volta a cada atualizacao. */
  function trazerChip() {
    var s = document.getElementById('abas');
    if (!s || !s.clientWidth || s.scrollWidth <= s.clientWidth + 1) return;
    var a = s.querySelector('.aba.ativa');
    if (!a) return;
    var k = textoProprio(a);
    if (k === chipVisto) return;
    chipVisto = k;
    var sr = s.getBoundingClientRect(), ar = a.getBoundingClientRect();
    if (ar.left >= sr.left && ar.right <= sr.right) return;
    if (ar.left < sr.left) s.scrollLeft -= (sr.left - ar.left) + 8;
    else s.scrollLeft += (ar.right - sr.right) + 8;
  }
  function agendarChip() {
    if (agChip) return;
    agChip = setTimeout(function () { agChip = 0; try { trazerChip(); } catch (e) {} }, 60);
  }
  function ligarChip() {
    var s = document.getElementById('abas');
    if (!s) return;
    observar(s, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, agendarChip);
    ouvir(window, 'resize', function () { chipVisto = ''; agendarChip(); });
    agendarChip();
  }
  /* Cada passo e protegido: erro em um nunca derruba a casca (a pagina fica so sem aquele acabamento). */
  function acabamentoSub() {
    [adotar, vigiarVazios, vigiarCarregando, rotularPorTitle, ligarGlifos].forEach(function (fn) { try { fn(); } catch (e) {} });
    if (sub.nome === 'agenda') { try { ligarChip(); } catch (e2) {} }
  }

  function iniciarSub() {
    sub = subDaPagina();
    if (!sub) return;
    /* Pagina sem sessao esta redirecionando para /gerador: montar agora piscaria a casca. */
    if (sub.sessao && !temSessao()) return;
    modoSub = true;
    montar();
    acabamentoSub();   /* antes das classes do html: o .topbar ainda esta a vista quando o que sobra dele e adotado */
    ligarBusca();
    ligarTrilha();
    trilhaSync(null, true);   /* subapp: nasce no estado certo, antes do CSS da casca valer */
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
