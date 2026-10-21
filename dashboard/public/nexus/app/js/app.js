/* Portal do Parceiro NEXUS: casca (sessao, rotas por hash, telas de informacao, eventos, modo demonstracao).
   JavaScript puro, sem build. Desenho: canvas aprovado de 21/10/2026 (Main, Celular, Mercado, Equipamento, Parceria).
   Documentos: window.NexusGerar.montar(container, ctx) (js/gerar.js). Rede (oportunidades, usinas, engenharia):
   window.NexusRede.montar(container, tela, ctx) (js/rede.js). Todo texto vindo da API passa por esc() antes de virar HTML.
   Contrato do ctx (v2): { parceiro, empresa, nivel, progresso, libera, catalogo, entrega, financiamento, demo,
   api(metodo, caminho, corpo) -> Promise<json> (aceita caminho com ou sem /gerador/nexus; rejeita com Error que traz .status, .erro e .data),
   evento(tipo, dados), irPara('x' ou '#x'), salvarProposta, onGerou, propostaInicial, listarPropostas() -> Promise<array>,
   pedirEquipamento(proposta|{modelo, quantidade, proposta_id, obs}) -> Promise<{id}> }.
   Contrato do ctx (v3), alem do v2: criarLink(propostaId) -> Promise<{token, url}>, servicos, bloqueios, saldo_engenharia, termo,
   montagem_aprovada, atualizar(). Tudo que o parceiro ainda nao tem aparece com cadeado e o texto de bloqueios[chave]. */
(function () {
  'use strict';

  /* Chave da indicação de usinas: false oculta menu, cartão do Início, número e linha do acordo; o código fica. */
  const MOSTRAR_USINAS = false;
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = LOCAL ? 'http://localhost:3001' : '/_api';
  var NX = '/gerador/nexus';
  var WA_PADRAO = '5534998165040';
  var TOKEN_KEY = 'solardoc_token';
  var USER_KEY = 'solardoc_user';
  var ORIGENS = ['portal', 'solardoc', 'solardoc_banner', 'partner_lp', 'convite_email', 'convite_wpp', 'anuncio', 'link_cadastro'];
  var TZ = 'America/Sao_Paulo';
  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MES_AB = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  /* ------------------------------------------------------------------ utilidades */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dig(v) { return String(v || '').replace(/\D/g, ''); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
  function fmt(v, dec) {
    var n = num(v);
    try { return n.toLocaleString('pt-BR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); } catch (e) { return n.toFixed(dec || 0).replace('.', ','); }
  }
  function rs(v, dec) { return 'R$ ' + fmt(v, dec || 0); }
  function dataBR(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleDateString('pt-BR', { timeZone: TZ }); } catch (e) { return ''; }
  }
  /* Partes da data em horario de Brasilia (o relogio da maquina pode estar em UTC). */
  function brt(d) {
    d = d || new Date();
    var o = { ano: 0, mes: 0, dia: 0, hora: 0, min: 0 };
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (p) {
          if (p.type === 'year') o.ano = +p.value; else if (p.type === 'month') o.mes = +p.value; else if (p.type === 'day') o.dia = +p.value;
          else if (p.type === 'hour') o.hora = +p.value; else if (p.type === 'minute') o.min = +p.value;
        });
    } catch (e) { o = { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: d.getUTCHours(), min: d.getUTCMinutes() }; }
    return o;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function diaSerie(o) { return Date.UTC(o.ano, o.mes - 1, o.dia) / 86400000; }
  function prazoTxt(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    if (d.getTime() < Date.now()) return 'Prazo encerrado';
    var a = brt(d), b = brt(new Date());
    var dif = diaSerie(a) - diaSerie(b);
    var dia = dif === 0 ? 'hoje' : dif === 1 ? 'amanhã' : p2(a.dia) + '/' + p2(a.mes);
    return 'Aceitar até ' + dia + ', ' + (a.min ? p2(a.hora) + ':' + p2(a.min) : a.hora + 'h');
  }
  function fmtCnpj(d) {
    d = dig(d).slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  function fmtFone(d) {
    d = dig(d).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function cnpjValido(d) {
    d = dig(d);
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    function dv(base) {
      var pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      var s = 0;
      for (var i = 0; i < base.length; i++) s += Number(base.charAt(i)) * pesos[i];
      var r = s % 11;
      return r < 2 ? 0 : 11 - r;
    }
    var d1 = dv(d.slice(0, 12));
    return d1 === Number(d.charAt(12)) && dv(d.slice(0, 13)) === Number(d.charAt(13));
  }
  function imgSegura(src) {
    return typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(src) ? src : '';
  }
  function slug(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Empresa';
  }
  function maiuscula(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }

  /* ------------------------------------------------------------------ icones (SVG monocromatico, traco) */
  var ICONES = {
    inicio: '<path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
    mercado: '<path d="M3 3v18h18M7 15v3M12 10v8M17 6v12"/>',
    equipamentos: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    propostas: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6"/>',
    oportunidades: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>',
    usinas: '<path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    engenharia: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z"/>',
    materiais: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    parceria: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3zM9 12l2 2 4-4"/>',
    escudo: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z"/>',
    perfil: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
    mais: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    cadeado: '<path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"/>',
    check: '<path d="M5 12l5 5 9-12"/>',
    conversa: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.55L3 20.8l1.75-5.1A8.5 8.5 0 1 1 21 11.5z"/>',
    baixar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    relogio: '<path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>',
    tela: '<path d="M4 6h16v10H4zM8 20h8M12 16v4"/>',
    servicos: '<path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18M11 13v2h2v-2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copiar: '<path d="M9 9h11v11H9zM5 15H4V4h11v1"/>',
    imprimir: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
    termo: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4"/>'
  };
  function ic(nome, cls) {
    return '<svg class="nx-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONES[nome] || '') + '</svg>';
  }

  /* ------------------------------------------------------------------ cookies (os mesmos do SolarDoc: auth.ts) */
  function lerCookie(nome) {
    var partes = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < partes.length; i++) {
      var k = partes[i].indexOf('=');
      if (k < 0) continue;
      if (partes[i].slice(0, k) === nome) {
        try { return decodeURIComponent(partes[i].slice(k + 1)); } catch (e) { return partes[i].slice(k + 1); }
      }
    }
    return '';
  }
  function gravarCookie(nome, valor) {
    var seguro = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = nome + '=' + encodeURIComponent(valor) + '; path=/; max-age=604800; SameSite=Lax' + seguro;
  }
  function apagarCookie(nome) { document.cookie = nome + '=; path=/; max-age=0; SameSite=Lax'; }
  function getToken() { return lerCookie(TOKEN_KEY); }
  function salvarSessao(d) {
    gravarCookie(TOKEN_KEY, d.token);
    if (d.user) { try { gravarCookie(USER_KEY, JSON.stringify(d.user)); } catch (e) { /* segue sem o usuario */ } }
  }
  function limparSessao() { apagarCookie(TOKEN_KEY); apagarCookie(USER_KEY); }

  /* ------------------------------------------------------------------ estado e rotas */
  var S = {
    demo: false, nivelDemo: 'pro', fase: 'boot', eu: null, rota: 'inicio', sub: '',
    propInicial: null, ultima: null, ultimoEquip: null, logoNovo: null, erroTexto: '', msgEntrada: '', shell: false,
    tela: 0, qtd: 1, foto: 0, frota: null, frotaErro: false, frotaCarregando: false, propostas: null, propErro: false,
    procura: {}, abrirCompra: false,
    confirmaPacote: 0, consultoriaAberta: false, plataformaPedida: false, pedidosServ: null, pedidosServErro: false,
    termoTxt: undefined, termoErro: false, termoMsg: '', montagemDemo: null,
    cad: null, emailPre: ''
  };
  var propAtual = null;      /* proposta em edicao na tela Propostas: {id, numero} */
  var esperaScript = null;
  var cnpjCache = {};
  var GRAFS = [];
  var uidG = 0;

  var ROTAS = {
    inicio: { menu: 'Início', ctx: 'Informação de mercado, equipamentos e oportunidades' },
    mercado: { menu: 'Mercado', ctx: 'Frota plug-in e procura por eletroposto' },
    equipamentos: { menu: 'Equipamentos', ctx: 'Os carregadores da rede NEXUS' },
    servicos: { menu: 'Serviços NEXUS', ctx: 'Engenharia em pacotes, consultoria de vendas e plataforma', reqTodos: ['pacotes_engenharia', 'consultoria', 'plataforma'] },
    propostas: { menu: 'Propostas', ctx: 'Simulador, Orçamento Básico e Orçamento Completo' },
    oportunidades: { menu: 'Oportunidades', ctx: 'Clientes e obras da NEXUS na sua região', req: 'oportunidades' },
    usinas: { menu: 'Usinas', ctx: 'Indique uma usina', req: 'usinas', motivo: 'Complete o perfil da empresa para indicar usinas.' },
    engenharia: { menu: 'Engenharia', ctx: 'Engenharia NEXUS', req: 'engenharia', motivo: 'Complete o perfil da empresa para pedir engenharia.' },
    materiais: { menu: 'Materiais', ctx: 'Fotos para divulgar o equipamento', req: 'materiais', motivo: 'Complete o perfil da empresa para liberar os Materiais.' },
    parceria: { menu: 'Minha parceria', ctx: 'Níveis, caminho e selo' },
    perfil: { menu: 'Perfil', ctx: 'Dados e capacidades da empresa' }
  };
  var ORDEM = ['inicio', 'mercado', 'equipamentos', 'servicos', 'propostas', 'oportunidades', 'usinas', 'engenharia', 'materiais', 'parceria'].filter(function (r) { return MOSTRAR_USINAS || r !== 'usinas'; });
  var TABS = ['inicio', 'equipamentos', 'propostas', 'oportunidades'];
  var ALIAS = { trilha: 'parceria', gerar: 'propostas', selo: 'parceria', credenciado: 'parceria' };

  /* Item ADM: so quando o /eu diz adm:true (is_admin ou e-mail ativo em nexus_equipe). Leva a pagina propria, nao a uma rota do portal. */
  function admOk() { return !!(S.eu && S.eu.adm === true && !S.demo); }
  function wpp() { return (S.eu && S.eu.whatsappComercial) || WA_PADRAO; }
  function nivel() { return (S.eu && S.eu.nivel) || 'cadastrado'; }
  var NIVEL_NOME = { cadastrado: 'Cadastrado', partner: 'Partner', pro: 'Partner Pro', master: 'Partner Master' };
  var NIVEL_IDX = { cadastrado: 1, partner: 2, pro: 3, master: 4 };
  /* Chaves novas da v3: se a API ainda nao mandar a chave, vale o nivel (partner: pacotes e consultoria; pro: plataforma, termo e oportunidades). */
  var LIB_NIVEL = { pacotes_engenharia: 2, consultoria: 2, plataforma: 3, termo: 3, oportunidades: 3 };
  function libera(k) {
    var L = S.eu && S.eu.libera;
    if (L && L[k] != null) return !!L[k];
    if (k === 'oportunidades') return (NIVEL_IDX[nivel()] || 1) >= 3 && !!(S.eu && S.eu.termo && S.eu.termo.aceito_em);
    return LIB_NIVEL[k] ? (NIVEL_IDX[nivel()] || 1) >= LIB_NIVEL[k] : false;
  }
  var TX_PARTNER = 'Libera com o nível Partner, depois da conversa com o comercial';
  var TX_COMPRA = 'Libera com a primeira compra de carregador';
  var TX_TERMO = 'Aceite o Termo de Parceria para receber oportunidades';
  var TX_PERFIL = 'Libera quando o perfil da empresa estiver completo';
  var BLOQ_PADRAO = {
    pedido: TX_PARTNER, pacotes_engenharia: TX_PARTNER, consultoria: TX_PARTNER, selo: TX_PARTNER,
    plataforma: TX_COMPRA, termo: TX_COMPRA, oportunidades: TX_COMPRA,
    basico: TX_PERFIL, completo: TX_PERFIL, materiais: TX_PERFIL, engenharia: TX_PERFIL, negociar: TX_PERFIL, usinas: TX_PERFIL,
    conversa: 'Libera depois da primeira proposta'
  };
  /* Texto de "o que libera" de um item travado: o da API (bloqueios) ou o de reserva. */
  function bloq(k) {
    var B = S.eu && S.eu.bloqueios;
    var t = B && typeof B[k] === 'string' ? B[k].trim() : '';
    if (t) return maiuscula(t);
    if (k === 'oportunidades' && (NIVEL_IDX[nivel()] || 1) >= 3) return TX_TERMO;
    return BLOQ_PADRAO[k] || TX_COMPRA;
  }
  function travada(r) {
    var R = ROTAS[r];
    if (!R) return false;
    if (R.req && !libera(R.req)) return true;
    return !!(R.reqTodos && R.reqTodos.every(function (k) { return !libera(k); }));
  }
  function saldoEng() {
    var s = S.eu && S.eu.saldo_engenharia;
    if (!s || typeof s !== 'object') return null;
    return { comprados: num(s.comprados), usados: num(s.usados), disponiveis: num(s.disponiveis, Math.max(0, num(s.comprados) - num(s.usados))) };
  }
  function termo() {
    var t = (S.eu && S.eu.termo) || {};
    return { versao: t.versao || 'v1', disponivel: t.disponivel !== false, aceito_em: t.aceito_em || null };
  }
  function montagemAprovada() {
    if (!S.eu) return false;
    if (S.eu.montagem_aprovada != null) return !!S.eu.montagem_aprovada;
    return !!(S.eu.parceiro && S.eu.parceiro.montagem_aprovada_em);
  }
  function produtos() { return (S.eu && S.eu.catalogo && S.eu.catalogo.produtos) || []; }
  function produtoPor(chave) {
    var ps = produtos(), c = String(chave || '');
    for (var i = 0; i < ps.length; i++) if (ps[i].id === c || ps[i].nome === c) return ps[i];
    return null;
  }

  function rotaDoHash() {
    var t = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (!t) return null;
    var partes = t.split('/');
    var r = ALIAS[partes[0]] || partes[0];
    if (!ROTAS[r]) return null;
    if (r === 'usinas' && !MOSTRAR_USINAS) {
      try { history.replaceState(null, '', location.pathname + location.search + '#inicio'); } catch (e) { /* ok */ }
      return { r: 'inicio', sub: '' };
    }
    return { r: r, sub: partes.slice(1).join('/') };
  }
  function irPara(h) {
    h = String(h || '').replace(/^#\/?/, '');
    if (!h) h = 'inicio';
    if (location.hash === '#' + h) { aoMudarHash(); return; }
    location.hash = '#' + h;
  }

  /* ------------------------------------------------------------------ eventos e pixel */
  function ev(tipo, dados) {
    if (S.demo) return;
    var tk = getToken();
    if (!tk) return;
    try {
      fetch(API + '/feature-events', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({ feature: 'nexus_portal', event_type: tipo, event_data: dados || {} })
      }).catch(function () { /* analytics nunca trava a tela */ });
    } catch (e) { /* idem */ }
  }
  /* Pixel: so evento personalizado e so se a pagina tiver o snippet. Nunca Lead, CompleteRegistration nem Schedule. */
  function pix(nome) {
    if (S.demo) return;
    try { if (window.fbq) window.fbq('trackCustom', nome); } catch (e) { /* ignora */ }
  }

  /* ------------------------------------------------------------------ origem (?o= e utm_*) */
  var CHAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  function capturarOrigem() {
    try {
      var p = new URLSearchParams(location.search);
      var achou = {};
      var o = p.get('o');
      if (o) achou.origem = ORIGENS.indexOf(o) >= 0 ? o : 'portal';
      CHAVES_UTM.forEach(function (k) { var v = p.get(k); if (v) achou[k] = v.slice(0, 120); });
      if (!Object.keys(achou).length) return;
      var atual = {};
      try { atual = JSON.parse(sessionStorage.getItem('nx_origem') || '{}') || {}; } catch (e1) { atual = {}; }
      Object.keys(achou).forEach(function (k) { atual[k] = achou[k]; });
      sessionStorage.setItem('nx_origem', JSON.stringify(atual));
    } catch (e) { /* sem sessionStorage, segue sem origem */ }
  }
  function origemQS() {
    try {
      var o = JSON.parse(sessionStorage.getItem('nx_origem') || '{}') || {};
      var q = Object.keys(o).filter(function (k) { return o[k]; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); });
      return q.length ? '?' + q.join('&') : '';
    } catch (e) { return ''; }
  }
  function origemUsada() { try { sessionStorage.removeItem('nx_origem'); } catch (e) { /* ok */ } }

  /* ------------------------------------------------------------------ API */
  function textoErro(r, padrao) {
    var d = r && r.data;
    var t = d && (typeof d.error === 'string' ? d.error : (typeof d.erro === 'string' ? d.erro : (typeof d.message === 'string' ? d.message : '')));
    if (t && t.length < 220 && !/^[a-z_]+$/.test(t)) return t;
    if (r && r.rede) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    return padrao || 'Não foi possível concluir. Tente de novo.';
  }
  /* Roteador unico de respostas: 503 vira Em breve, 401 volta para a entrada, 403 e 409 de CNPJ tem tela propria. */
  function roteia(r, opc) {
    var cod = r.data && (r.data.erro || r.data.error);
    if (r.status === 503) { S.fase = 'embreve'; r.tratado = true; pintar(); return; }
    if (r.status === 401 && opc.comToken && !opc.semToken) {
      limparSessao(); S.eu = null; S.msgEntrada = 'Sua sessão expirou. Entre de novo.'; S.fase = 'entrada'; r.tratado = true; pintar(); return;
    }
    if (r.status === 403 && cod === 'cnpj_inativo') { S.fase = 'cnpj_inativo'; r.tratado = true; pintar(); return; }
    if (r.status === 409 && cod === 'sem_cnpj') { S.fase = 'sem_cnpj'; r.tratado = true; pintar(); return; }
  }
  function api(metodo, caminho, corpo, opc) {
    opc = opc || {};
    if (S.demo) return demoApi(metodo, caminho, corpo);
    var tk = opc.semToken ? '' : getToken();
    opc.comToken = !!tk;
    var headers = { Accept: 'application/json' };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (tk) headers.Authorization = 'Bearer ' + tk;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, opc.timeout || 25000) : 0;
    return fetch(API + caminho, { method: metodo, headers: headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined, signal: ctrl ? ctrl.signal : undefined })
      .then(function (resp) {
        clearTimeout(t);
        return resp.text().then(function (tx) {
          var d = null;
          try { d = tx ? JSON.parse(tx) : null; } catch (e) { d = null; }
          var r = { ok: resp.ok, status: resp.status, data: d };
          if (!opc.quieto) roteia(r, opc);
          return r;
        });
      })
      .catch(function () {
        clearTimeout(t);
        return { ok: false, status: 0, data: null, rede: true };
      });
  }
  /* api() do ctx dado a E3 e E5: resolve o JSON, rejeita com Error(.status, .erro, .data). */
  function ctxApi(metodo, caminho, corpo) {
    var c = String(caminho || '');
    if (c.indexOf(NX) === 0) c = c.slice(NX.length);
    if (c.charAt(0) !== '/') c = '/' + c;
    return api(metodo, NX + c, corpo).then(function (r) {
      if (r.ok) return r.data == null ? {} : r.data;
      var e = new Error(textoErro(r, 'Não foi possível concluir. Tente de novo.'));
      e.status = r.status; e.data = r.data; e.erro = r.data && (r.data.erro || r.data.error) || '';
      throw e;
    });
  }

  /* ------------------------------------------------------------------ demonstracao (sem rede) */
  function euDemo(nv) {
    var idx = NIVEL_IDX[nv] || 3;
    var montagem = S.montagemDemo != null ? S.montagemDemo : idx >= 3;
    var lib = {
      simulador: true, basico: true, completo: true, materiais: true, engenharia: true, negociar: true, usinas: true, conversa: true,
      pedido: idx >= 2, selo: idx >= 2, pacotes_engenharia: idx >= 2, consultoria: idx >= 2,
      oportunidades: idx === 4, plataforma: idx >= 3, termo: idx >= 3
    };
    var bl = {};
    Object.keys(lib).forEach(function (k) { if (!lib[k] && k !== 'oportunidades') bl[k] = BLOQ_PADRAO[k] || TX_COMPRA; });
    if (!lib.oportunidades) bl.oportunidades = idx >= 3 ? TX_TERMO : TX_COMPRA;
    var vazias = { conectores: null, tensaoEntrada: null, eficiencia: null, protecao: null, certificacao: null, garantia: null };
    var agora = new Date().toISOString();
    var prog = [
      { proximo: 'partner', faltam: ['aprovacao_partner'] },
      { proximo: 'pro', faltam: ['primeira_compra'] },
      { proximo: 'master', faltam: ['compras'], carregadores_faltam: 4 },
      { proximo: null, faltam: [] }
    ][idx - 1];
    return {
      parceiro: {
        id: 'demo', user_id: 'demo', empresa: 'Empresa Exemplo Solar', cidade: 'Goiânia', uf: 'GO', raio_km: 250, papel_revenda: true, papel_montagem: true, status: 'novo',
        primeira_proposta_em: agora, conversa_pedida_em: idx >= 2 ? agora : null, conversa_feita_em: idx >= 2 ? agora : null,
        partner_em: idx >= 2 ? agora : null, montagem_aprovada_em: montagem ? agora : null, carregadores_comprados: idx === 4 ? 5 : idx === 3 ? 1 : 0
      },
      empresa: { nome: 'Empresa Exemplo Solar', nome_fantasia: 'Empresa Exemplo Solar', cnpj: '00000000000000', cidade: 'Goiânia', whatsapp: '00000000000', logo_base64: null },
      nivel: nv, progresso: prog,
      libera: lib, bloqueios: bl, montagem_aprovada: montagem,
      saldo_engenharia: idx >= 3 ? (idx === 4 ? { comprados: 8, usados: 3, disponiveis: 5 } : { comprados: 3, usados: 1, disponiveis: 2 }) : { comprados: 0, usados: 0, disponiveis: 0 },
      termo: { versao: 'v1', disponivel: idx >= 3, aceito_em: idx === 4 ? agora : null },
      catalogo: {
        marca: {
          nome: 'NEXUS Eletropostos', slogan: 'Energia que move o amanhã', fonte: 'Montserrat',
          cores: { verde: '#39FF14', azul: '#0085FF', azulTexto: '#0060C7', fundo: '#0B1A2B', cinza: '#E5E7EB' },
          pilares: ['Recarga rápida e segura', 'Energia limpa e sustentável', 'Tecnologia de ponta', 'Mobilidade para todos'],
          logos: { papel: '/gerador/nexus-logo-papel.png', tela: '/gerador/nexus-logo-tela.png', simbolo: '/gerador/nexus-x.png' },
          imagens: '/nexus/img/',
          distribuidor: 'Equipamento NEXUS Eletropostos · AIOROS GROUP LTDA · CNPJ 63.636.043/0001-88'
        },
        produtos: [
          { id: 'nexus-dc-80', nome: 'NEXUS DC 80 kW', potenciaKw: 80, precoSugerido: 69990, specs: vazias },
          { id: 'nexus-dc-120', nome: 'NEXUS DC 120 kW', potenciaKw: 120, precoSugerido: 89990, specs: vazias }
        ]
      },
      entrega: 'Entrega na primeira quinzena de dezembro',
      financiamento: { parcelas: 96, carenciaDias: 120, taxaRefMensal: 1.49 },
      contagens: { propostas_mes: 12, pedidos: 2, oportunidades_recebidas: 3, usinas: 1 },
      whatsappComercial: WA_PADRAO
    };
  }
  var DEMO = null;
  function demoInicio() {
    var agora = Date.now(), H = 3600000;
    function op(id, tipo, cidade, uf, km, desc, vs, horas) {
      return { id: id, tipo: tipo, cidade: cidade, uf: uf, distancia_km: km, descricao: desc, valor_servico: vs || '', prazo_aceite: new Date(agora + horas * H).toISOString(), status: 'oferecida', etapas: [{ status: 'oferecida', em: new Date(agora - 2 * H).toISOString() }] };
    }
    var b = brt(), meses = [];
    for (var i = 5; i >= 0; i--) {
      var m = b.mes - i, a = b.ano;
      while (m < 1) { m += 12; a--; }
      meses.push(a + '-' + p2(m));
    }
    var tot = [8, 31, 77, 174, 230, 344];
    DEMO = {
      ops: [
        op('d1', 'obra', 'Anápolis', 'GO', 55, 'Investidor comprou 1x DC 80 kW chave na mão. Precisamos de montagem e homologação.', '', 20),
        op('d2', 'cliente', 'Rio Verde', 'GO', 230, 'Posto de combustível quer orçamento de 2x DC 120 kW.', '', 5),
        op('d3', 'cliente', 'Itumbiara', 'GO', 200, 'Hotel de beira de estrada quer saber se o ponto comporta um DC 80 kW.', '', 30),
        op('d4', 'obra', 'Goiânia', 'GO', 12, 'Condomínio comercial comprou 1x DC 120 kW. Precisamos de montagem, obra civil e comissionamento.', 'A combinar com o comercial', 70)
      ],
      contatos: { d1: { nome: 'Cliente Exemplo', telefone: '62900000000' }, d2: { nome: 'Posto Exemplo', telefone: '64900000000' }, d3: { nome: 'Hotel Exemplo', telefone: '64900000001' }, d4: { nome: 'Condomínio Exemplo', telefone: '62900000002' } },
      usinas: [
        { id: 'u1', dono_nome: 'Usina Exemplo A', potencia_kwp: 300, cidade: 'Goiânia', uf: 'GO', status: 'em_analise', created_at: new Date(agora - 5 * 86400000).toISOString() },
        { id: 'u2', dono_nome: 'Usina Exemplo B', potencia_kwp: 75, cidade: 'Senador Canedo', uf: 'GO', status: 'recebida', created_at: new Date(agora - 86400000).toISOString() }
      ],
      solic: [
        { id: 's1', tipo: 'engenharia', dados: { servico_nome: 'Projeto elétrico', cidade: 'Goiânia', uf: 'GO', potencia_kw: 80, descricao: 'Ponto de exemplo.' }, status: 'em_andamento', created_at: new Date(agora - 2 * 86400000).toISOString() }
      ],
      props: [
        { id: 'p1', numero: '20260002', cliente_nome: 'Cliente Exemplo', cliente_cidade: 'Goiânia', cliente_uf: 'GO', modelo: 'NEXUS DC 80 kW', quantidade: 1, valor_total: 99990, saida_ultima: 'completo', created_at: new Date(agora - 3 * 86400000).toISOString(),
          link_token: 'EXEMPLO-link-de-demonstracao', aberturas: 2, primeira_abertura_em: new Date(agora - 2 * 86400000).toISOString(), ultima_abertura_em: new Date(agora - 20 * H).toISOString() },
        { id: 'p2', numero: '20260001', cliente_nome: 'Posto Exemplo', cliente_cidade: 'Rio Verde', cliente_uf: 'GO', modelo: 'NEXUS DC 120 kW', quantidade: 2, valor_total: 179980, saida_ultima: 'simulador', created_at: new Date(agora - 9 * 86400000).toISOString(),
          link_token: null, aberturas: 0, primeira_abertura_em: null, ultima_abertura_em: null }
      ],
      pedidos: (NIVEL_IDX[S.eu && S.eu.nivel] || 1) >= 3 ? [
        { id: 'pd1', tipo: 'engenharia', pacote: 3, status: 'confirmado', created_at: new Date(agora - 12 * 86400000).toISOString() },
        { id: 'pd2', tipo: 'consultoria', status: 'negociando', created_at: new Date(agora - 2 * 86400000).toISOString() },
        { id: 'pd3', tipo: 'equipamento', modelo: 'nexus-dc-80', quantidade: 1, status: 'confirmado', created_at: new Date(agora - 30 * 86400000).toISOString() }
      ] : [],
      procura: {
        uf: 'GO', reunioes_90d_uf: 40, meses: meses.map(function (mes, k) { return { mes: mes, total: tot[k], uf_total: Math.round(tot[k] / 8) }; }),
        por_uf: [['MG', 61], ['GO', 40], ['SP', 39], ['BA', 28], ['PE', 22], ['RS', 13], ['CE', 13], ['PR', 11], ['RN', 11], ['DF', 10], ['MT', 10]].map(function (x) { return { uf: x[0], total: x[1] }; }),
        pct_fora_mg_go_df: 68, total_com_uf: 280, atualizado_em: new Date().toISOString()
      }
    };
  }
  function demoApi(metodo, caminho, corpo) {
    if (!DEMO) demoInicio();
    var c = String(caminho || '');
    if (c.indexOf(NX) === 0) c = c.slice(NX.length);
    c = c.split('?')[0];
    var agora = new Date().toISOString(), m;
    var ok = function (d, s) { return Promise.resolve({ ok: true, status: s || 200, data: d }); };
    corpo = corpo || {};
    if (metodo === 'GET' && c === '/procura') return ok(DEMO.procura);
    if (metodo === 'GET' && c === '/oportunidades') {
      return ok({
        oportunidades: DEMO.ops.map(function (o) {
          var k = {}; for (var x in o) k[x] = o[x];
          if (/^(aceita|contato|visita|orcamento|fechou|perdeu)$/.test(o.status)) k.contato = DEMO.contatos[o.id];
          return k;
        })
      });
    }
    if ((m = /^\/oportunidades\/([^/]+)\/(aceitar|recusar|etapa)$/.exec(c)) && metodo === 'POST') {
      var alvo = null;
      DEMO.ops.forEach(function (o) { if (o.id === m[1]) alvo = o; });
      if (!alvo) return Promise.resolve({ ok: false, status: 404, data: null });
      var novo = m[2] === 'aceitar' ? 'aceita' : m[2] === 'recusar' ? 'recusada' : corpo.status;
      alvo.status = novo;
      alvo.etapas.push({ status: novo, em: agora, obs: corpo.obs || corpo.motivo || '' });
      var visao = {}; for (var y in alvo) visao[y] = alvo[y];
      if (/^(aceita|contato|visita|orcamento|fechou|perdeu)$/.test(novo)) visao.contato = DEMO.contatos[alvo.id];
      return ok({ ok: true, oportunidade: visao });
    }
    if (metodo === 'GET' && c === '/usinas') return ok({ usinas: DEMO.usinas });
    if (metodo === 'POST' && c === '/usinas') {
      var u = { id: 'u' + (DEMO.usinas.length + 1), dono_nome: corpo.dono_nome, potencia_kwp: corpo.potencia_kwp, cidade: corpo.cidade, uf: corpo.uf, status: 'recebida', created_at: agora };
      DEMO.usinas.unshift(u);
      return ok(u, 201);
    }
    if (metodo === 'GET' && c === '/solicitacoes') return ok({ solicitacoes: DEMO.solic });
    if (metodo === 'POST' && c === '/solicitacoes') {
      var s = { id: 's' + (DEMO.solic.length + 1), tipo: corpo.tipo, dados: corpo.dados, status: 'aberta', created_at: agora };
      DEMO.solic.unshift(s);
      return ok(s, 201);
    }
    if (metodo === 'GET' && c === '/pedidos') return ok({ pedidos: DEMO.pedidos });
    if (metodo === 'POST' && c === '/pedidos') {
      var ped = { id: 'pd' + (DEMO.pedidos.length + 1), tipo: corpo.tipo || 'equipamento', pacote: corpo.pacote, modelo: corpo.modelo, quantidade: corpo.quantidade, status: 'solicitado', created_at: agora };
      DEMO.pedidos.unshift(ped);
      return ok(ped, 201);
    }
    if (metodo === 'POST' && c === '/termo/aceitar') {
      if (S.eu && S.eu.termo) S.eu.termo.aceito_em = agora;
      if (S.eu && S.eu.libera && S.eu.parceiro && S.eu.parceiro.carregadores_comprados >= 1) { S.eu.libera.oportunidades = true; if (S.eu.bloqueios) delete S.eu.bloqueios.oportunidades; }
      return ok({ ok: true, termo_versao: corpo.versao || 'v1', termo_aceito_em: agora });
    }
    if ((m = /^\/propostas\/([^/]+)\/link$/.exec(c)) && metodo === 'POST') {
      var tk = 'EXEMPLO-' + m[1];
      DEMO.props.forEach(function (p) { if (p.id === m[1] && !p.link_token) { p.link_token = tk; p.aberturas = 0; } });
      return ok({ token: tk, url: 'https://solardoc.app/nexus/p/?t=' + tk }, 201);
    }
    if (metodo === 'GET' && c === '/propostas') return ok({ propostas: DEMO.props });
    if ((m = /^\/propostas\/([^/]+)$/.exec(c)) && metodo === 'GET') {
      var pr = null;
      DEMO.props.forEach(function (p) { if (p.id === m[1]) pr = p; });
      return pr ? ok({ proposta: pr }) : Promise.resolve({ ok: false, status: 404, data: null });
    }
    if (metodo === 'GET' && c === '/eu') return ok(S.eu);
    return Promise.resolve({ ok: false, status: 404, data: null });
  }

  /* ------------------------------------------------------------------ blocos de tela */
  function girando(txt) { return '<div class="nx-girando" role="status"><div class="nx-spin"></div><span>' + esc(txt || 'Carregando') + '</span></div>'; }
  function waLink(texto) { return 'https://wa.me/' + wpp() + '?text=' + encodeURIComponent(texto); }
  function logoEntrada() { return '<img class="nx-ent-logo" src="/gerador/nexus-logo-tela.png" alt="NEXUS Eletropostos">'; }
  function nomeEmpresa() { return (S.eu && S.eu.empresa && (S.eu.empresa.nome_fantasia || S.eu.empresa.nome)) || (S.eu && S.eu.parceiro && S.eu.parceiro.empresa) || ''; }
  function trava(msg, botao) {
    return '<div class="nx-cartao nx-trava">' + ic('cadeado') + '<h2>Esta área ainda está travada</h2><p>' + esc(msg) + '</p>' +
      (botao || '<button type="button" class="nx-btn" data-acao="ir" data-arg="parceria">Ver como chegar</button>') + '</div>';
  }
  function secErro(msg, acao, rotulo) {
    return '<div class="np-erro-sec" role="alert"><p>' + esc(msg) + '</p><button type="button" class="nx-btn sec" data-acao="' + esc(acao) + '">' + esc(rotulo || 'Tentar de novo') + '</button></div>';
  }
  /* Cadeado (SVG monocromatico): botao travado com o texto de "o que libera" sempre visivel, e nota solta. */
  function lk(rotulo, chave, cls) {
    var id = 'lk' + (++uidG);
    return '<div class="np-lk"><button type="button" class="nx-btn' + (cls === '' ? '' : ' ' + (cls || 'sec')) + '" aria-disabled="true" aria-describedby="' + id + '" data-acao="travado" data-arg="' + esc(chave) + '">' +
      ic('cadeado', 'p') + esc(rotulo) + '</button><small class="np-lktx" id="' + id + '">' + esc(bloq(chave)) + '</small></div>';
  }
  function lkNota(chave) { return '<p class="np-lknota">' + ic('cadeado', 'p') + '<span>' + esc(bloq(chave)) + '</span></p>'; }
  function localParceiro() {
    var p = (S.eu && S.eu.parceiro) || {};
    var e = (S.eu && S.eu.empresa) || {};
    var cid = p.cidade || e.cidade || '';
    return cid ? cid + (p.uf ? '/' + p.uf : '') : (p.uf || '');
  }

  /* ------------------------------------------------------------------ fases de tela inteira */
  function telaEmBreve() {
    return '<div class="nx-ent"><div class="nx-ent-in">' + logoEntrada() +
      '<div class="nx-ent-card nx-tela-cheia"><span class="nx-selo-em-breve">Em breve</span><h1>Portal do Parceiro NEXUS</h1>' +
      '<p class="sub">O portal está sendo preparado. Em breve você poderá criar a conta da sua empresa e gerar propostas de carregadores rápidos NEXUS.</p>' +
      '<a class="nx-btn wa grande" href="' + waLink('Oi, tudo bem? Quero saber do Portal do Parceiro NEXUS.') + '" rel="noopener">' + ic('conversa') + 'Falar com o comercial no WhatsApp</a>' +
      '<p class="nx-ent-rodape"><a href="/nexus">Ver a vitrine da NEXUS</a></p></div></div></div>';
  }
  function telaCnpjInativo() {
    return '<div class="nx-ent"><div class="nx-ent-in">' + logoEntrada() +
      '<div class="nx-ent-card nx-tela-cheia"><h1>Não conseguimos liberar este CNPJ</h1>' +
      '<p class="sub">Ele não aparece como ativo na Receita Federal. Confira o número ou regularize a situação da empresa e tente de novo. O portal é só para empresas. Se você acha que foi engano, fale com a gente pelo WhatsApp.</p>' +
      '<a class="nx-btn wa grande" href="' + waLink('Oi, tudo bem? Meu CNPJ não foi liberado no Portal do Parceiro NEXUS e acho que foi engano.') + '" rel="noopener">' + ic('conversa') + 'Falar no WhatsApp</a>' +
      '<button type="button" class="nx-btn sec grande" style="margin-top:8px" data-acao="sairConta">Voltar para a entrada</button></div></div></div>';
  }
  function telaErro() {
    return '<div class="nx-ent"><div class="nx-ent-in">' + logoEntrada() +
      '<div class="nx-ent-card nx-tela-cheia"><h1>Não foi possível carregar o portal</h1>' +
      '<p class="sub">' + esc(S.erroTexto || 'Tente de novo em instantes.') + '</p>' +
      '<button type="button" class="nx-btn grande" data-acao="tentarDeNovo">Tentar de novo</button>' +
      '<button type="button" class="nx-btn link grande" data-acao="sairConta">Sair</button></div></div></div>';
  }
  function telaSemCnpj() {
    return '<div class="nx-ent"><div class="nx-ent-in">' + logoEntrada() +
      '<div class="nx-ent-card"><h1>Falta o CNPJ da empresa</h1>' +
      '<p class="sub">O portal é só para empresas com CNPJ ativo. Informe o CNPJ da sua empresa para continuar.</p>' +
      '<form data-form="semCnpj" novalidate><p class="nx-msg-erro" data-erro hidden></p>' +
      '<div class="nx-campo"><label for="sc-cnpj">CNPJ da empresa</label><input id="sc-cnpj" name="cnpj" type="text" inputmode="numeric" autocomplete="off" placeholder="00.000.000/0000-00" data-mascara="cnpj"><span class="nx-cnpj-estado" data-cnpj-estado></span></div>' +
      '<div class="nx-campo"><label for="sc-emp">Nome da empresa</label><input id="sc-emp" name="empresa" type="text" autocomplete="organization"></div>' +
      '<button type="submit" class="nx-btn grande">Continuar</button></form>' +
      '<button type="button" class="nx-btn link grande" style="margin-top:6px" data-acao="sairConta">Sair</button></div></div></div>';
  }
  function telaEntrada() {
    return '<div class="nx-ent"><div class="nx-ent-in">' + logoEntrada() +
      '<div class="nx-ent-card"><h1>Portal do Parceiro NEXUS</h1>' +
      '<p class="sub">Para empresas que querem vender ou instalar carregadores rápidos NEXUS na sua região.</p>' +
      '<ul class="nx-benef">' +
      '<li>' + ic('check') + '<span>Grátis para empresas com CNPJ ativo.</span></li>' +
      '<li>' + ic('check') + '<span>Propostas prontas com o logo da sua empresa.</span></li>' +
      '<li>' + ic('check') + '<span>Revenda, obras ou os dois: você escolhe o seu papel.</span></li></ul>' +
      '<div class="nx-abas" role="tablist">' +
      '<button type="button" role="tab" class="nx-aba" id="aba-entrar" aria-selected="true">Entrar</button>' +
      '<button type="button" role="tab" class="nx-aba" id="aba-criar" aria-selected="false" data-acao="criarConta">Criar conta da empresa</button></div>' +
      (S.msgEntrada ? '<p class="np-aviso">' + esc(S.msgEntrada) + '</p>' : '') +
      '<form data-form="login" novalidate><p class="nx-msg-erro" data-erro hidden></p>' +
      '<div class="nx-campo"><label for="lg-email">E-mail</label><input id="lg-email" name="email" type="email" autocomplete="username" inputmode="email" value="' + esc(S.emailPre) + '"></div>' +
      '<div class="nx-campo"><label for="lg-senha">Senha</label><input id="lg-senha" name="password" type="password" autocomplete="current-password"></div>' +
      '<button type="submit" class="nx-btn grande">Entrar</button>' +
      '<p class="nx-ent-rodape">Já usa o SolarDoc? Entre com o mesmo e-mail e senha.<br><a href="/auth">Esqueci a minha senha</a></p></form>' +
      '</div></div></div>';
  }

  /* ------------------------------------------------------------------ cadastro guiado (#cadastro, 3 passos) */
  var TX_BLOQUEIO_CNPJ = 'Ele não aparece como ativo na Receita Federal. Confira o número ou regularize a situação da empresa e tente de novo. O portal é só para empresas. Se você acha que foi engano, fale com a gente pelo WhatsApp.';
  function ehCadastro() { return /^#\/?cadastro(\/|\?|$)/.test(location.hash); }
  function perfilCompleto() { return libera('basico'); }
  function novoCad() { return { passo: 1, nome: '', email: '', fone: '', senha: '', conf: '', aceito: false, cnpj: '', empresa: '', fila: [], vistos: {} }; }
  /* cadastro_passo: sem token ainda (passos 1 e 2) o evento espera na fila e sai logo depois do register. */
  function evPasso(n) {
    var c = S.cad;
    if (!c || c.vistos[n]) return;
    c.vistos[n] = 1;
    if (getToken()) ev('cadastro_passo', { passo: n }); else c.fila.push(n);
  }
  function campoCad(id, nome, rotulo, controle, dica) {
    return '<div class="nx-campo"><label for="' + id + '">' + esc(rotulo) + '</label>' + controle +
      (dica ? '<span class="nx-dica" id="d-' + id + '">' + esc(dica) + '</span>' : '') +
      '<span class="nx-erro-campo" id="e-' + id + '" data-erro-de="' + nome + '" role="alert" hidden></span></div>';
  }
  function inpCad(id, nome, tipo, extra, valor, comDica) {
    return '<input id="' + id + '" name="' + nome + '" type="' + tipo + '" ' + (extra || '') + ' value="' + esc(valor == null ? '' : valor) + '" aria-describedby="' + (comDica ? 'd-' + id + ' ' : '') + 'e-' + id + '">';
  }
  function cabecaCad(n, titulo, sub) {
    var seg = '';
    for (var i = 1; i <= 3; i++) seg += '<span class="' + (i < n ? 'feito' : i === n ? 'atual' : '') + '"></span>';
    return '<p class="nx-passo">Passo ' + n + ' de 3</p><div class="nx-prog" role="img" aria-label="Passo ' + n + ' de 3">' + seg + '</div>' +
      '<h1 id="cad-h1" tabindex="-1">' + esc(titulo) + '</h1><p class="sub">' + esc(sub) + '</p>';
  }
  function telaCadastro() {
    var c = S.cad || novoCad(), n = c.passo, h;
    if (n === 1) {
      h = cabecaCad(1, 'Crie a sua conta', 'Grátis para empresas com CNPJ ativo. Você usa o mesmo e-mail e senha no SolarDoc.') +
        '<form data-form="cad1" novalidate><p class="nx-msg-erro" data-erro hidden></p>' +
        campoCad('c1-nome', 'nome', 'Seu nome completo', inpCad('c1-nome', 'nome', 'text', 'autocomplete="name"', c.nome)) +
        campoCad('c1-email', 'email', 'E-mail', inpCad('c1-email', 'email', 'email', 'autocomplete="email" inputmode="email"', c.email)) +
        campoCad('c1-fone', 'whatsapp', 'WhatsApp com DDD', inpCad('c1-fone', 'whatsapp', 'tel', 'autocomplete="tel-national" inputmode="tel" placeholder="(00) 00000-0000" data-mascara="fone"', fmtFone(c.fone))) +
        campoCad('c1-senha', 'password', 'Senha', inpCad('c1-senha', 'password', 'password', 'autocomplete="new-password"', '', true), 'Pelo menos 8 caracteres e 1 número.') +
        campoCad('c1-conf', 'confirma', 'Repita a senha', inpCad('c1-conf', 'confirma', 'password', 'autocomplete="new-password"', '')) +
        '<div class="nx-campo"><label class="nx-marcar" for="c1-aceito"><input type="checkbox" id="c1-aceito" name="aceito"' + (c.aceito ? ' checked' : '') + ' aria-describedby="e-c1-aceito"><span>Aceito os <a href="/termos" target="_blank" rel="noopener noreferrer">termos de uso</a> e a <a href="/privacidade" target="_blank" rel="noopener noreferrer">política de privacidade</a>.</span></label>' +
        '<span class="nx-erro-campo" id="e-c1-aceito" data-erro-de="aceito" role="alert" hidden></span></div>' +
        '<button type="submit" class="nx-btn grande">Continuar</button></form>' +
        '<p class="nx-ent-rodape">Já tem conta no SolarDoc? <button type="button" class="nx-btn link" data-acao="cadEntrar">Entrar</button></p>';
    } else if (n === 2) {
      h = cabecaCad(2, 'Dados da empresa', 'O portal é só para empresas com CNPJ ativo na Receita Federal.') +
        '<form data-form="cad2" novalidate><p class="nx-msg-erro" data-erro hidden></p>' +
        campoCad('c2-cnpj', 'cnpj', 'CNPJ da empresa', inpCad('c2-cnpj', 'cnpj', 'text', 'inputmode="numeric" autocomplete="off" placeholder="00.000.000/0000-00" data-mascara="cnpj"', fmtCnpj(c.cnpj)) + '<span class="nx-cnpj-estado" data-cnpj-estado></span>') +
        '<div class="nx-bloqueio" data-bloqueio role="alert" hidden><b>Não conseguimos liberar este CNPJ</b><p>' + esc(TX_BLOQUEIO_CNPJ) + '</p>' +
        '<a class="nx-btn wa" href="' + waLink('Oi, tudo bem? Meu CNPJ não foi liberado no Portal do Parceiro NEXUS e acho que foi engano.') + '" rel="noopener">' + ic('conversa') + 'Falar no WhatsApp</a></div>' +
        campoCad('c2-emp', 'empresa', 'Nome da empresa', inpCad('c2-emp', 'empresa', 'text', 'autocomplete="organization"', c.empresa, true), 'Preenchido com a razão social quando o CNPJ é ativo. Você pode editar.') +
        '<button type="submit" class="nx-btn grande">Criar a minha conta</button>' +
        '<button type="button" class="nx-btn link grande" style="margin-top:6px" data-acao="cadVoltar">Voltar</button></form>';
    } else {
      var p = (S.eu && S.eu.parceiro) || {}, e = (S.eu && S.eu.empresa) || {};
      var logo = imgSegura(S.logoNovo) || imgSegura(e.logo_base64);
      h = cabecaCad(3, 'Complete o perfil da empresa', 'Com o perfil completo ficam liberados o Orçamento Básico, o Orçamento Completo, os Materiais e a Engenharia.') +
        '<form data-form="cad3" novalidate><p class="nx-msg-erro" data-erro hidden></p>' +
        '<div class="nx-cartao" id="c3-logo" tabindex="-1" data-foco-de="logo"><h2>Logo da empresa</h2><p class="nx-dica" style="margin-bottom:10px">Aparece nas propostas ao lado da NEXUS. Prefira fundo transparente.</p>' +
        '<div class="nx-logo-area"><div class="nx-logo-prev" id="nx-logo-prev">' + (logo ? '<img src="' + esc(logo) + '" alt="Logo da empresa">' : 'Sem logo') + '</div>' +
        '<div><input class="nx-arquivo" type="file" id="nx-logo-arq" accept="image/png,image/jpeg,image/webp" aria-label="Escolher o logo da empresa" aria-describedby="e-c3-logo">' +
        '<label class="nx-btn sec" for="nx-logo-arq" tabindex="0" id="nx-logo-btn">' + (logo ? 'Trocar o logo' : 'Escolher o logo') + '</label>' +
        '<p class="nx-dica" style="margin-top:6px">PNG, JPG ou WebP. A imagem é reduzida para até 600 px de largura.</p></div></div>' +
        '<span class="nx-erro-campo" id="e-c3-logo" data-erro-de="logo" role="alert" hidden></span></div>' +
        '<div class="nx-cartao"><h2>Onde a sua empresa atende</h2><div class="nx-grade2">' +
        campoCad('c3-cidade', 'cidade', 'Cidade', inpCad('c3-cidade', 'cidade', 'text', 'autocomplete="address-level2"', p.cidade, true), 'Onde a sua empresa fica.') +
        campoCad('c3-uf', 'uf', 'UF', '<select id="c3-uf" name="uf" aria-describedby="e-c3-uf"><option value="">Escolha</option>' +
          UFS.map(function (u) { return '<option' + (String(p.uf || '').toUpperCase() === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select>') +
        campoCad('c3-raio', 'raio_km', 'Raio de atendimento (km)', inpCad('c3-raio', 'raio_km', 'number', 'inputmode="numeric" min="1" max="5000"', p.raio_km, true), 'Distância máxima que a sua equipe atende, a partir da sua cidade.') +
        campoCad('c3-eq', 'equipe_tamanho', 'Tamanho da equipe', inpCad('c3-eq', 'equipe_tamanho', 'number', 'inputmode="numeric" min="0" max="10000"', p.equipe_tamanho, true), 'Quantas pessoas trabalham nos projetos e em campo.') +
        '</div></div>' +
        '<div class="nx-cartao" id="c3-papeis" tabindex="-1" data-foco-de="papel"><h2>Papéis</h2><p class="nx-dica" style="margin-bottom:10px">Marque um ou os dois.</p>' +
        marca('papel_revenda', p.papel_revenda, 'Revenda', 'Você vende o carregador NEXUS para os seus clientes, com preço de parceiro.') +
        marca('papel_montagem', p.papel_montagem, 'Montagem e Engenharia', 'Você executa, na sua região, as obras chave na mão que a NEXUS vende.') +
        '<span class="nx-erro-campo" id="e-c3-papel" data-erro-de="papel" role="alert" hidden></span></div>' +
        '<div class="nx-cartao"><h2>Capacidades</h2><p class="nx-dica" style="margin-bottom:10px">Marque o que a sua equipe executa. Pode deixar em branco.</p>' +
        marca('cap_eletrica_bt', p.cap_eletrica_bt, 'Instalação elétrica de baixa tensão', '') +
        marca('cap_eletrica_mt', p.cap_eletrica_mt, 'Instalação elétrica de média tensão', '') +
        marca('cap_engenharia_art', p.cap_engenharia_art, 'Engenharia com ART', 'Marque se a empresa tem engenheiro que emite a ART dos projetos.') +
        marca('cap_obra_civil', p.cap_obra_civil, 'Obra civil', 'Base, valas, calçada e acabamento do local do carregador.') +
        marca('cap_homologacao', p.cap_homologacao, 'Homologação na distribuidora', 'Pedido de acesso e aprovação do projeto na concessionária de energia.') +
        marca('cap_ja_instala', p.cap_ja_instala, 'Já instala carregador de carro elétrico', 'Marque se a empresa já instalou algum, de qualquer potência.') + '</div>' +
        '<button type="submit" class="nx-btn grande">Concluir o cadastro</button></form>';
    }
    return '<div class="nx-ent"><div class="nx-ent-in cad">' + logoEntrada() + '<div class="nx-ent-card cad">' + h + '</div></div></div>';
  }

  /* ------------------------------------------------------------------ casca (menu, topo, abas) */
  function cobrandHTML() {
    var logo = imgSegura(S.eu && S.eu.empresa && S.eu.empresa.logo_base64);
    var nome = nomeEmpresa();
    var parc = logo
      ? '<img src="' + esc(logo) + '" alt="Logo de ' + esc(nome) + '">'
      : '<span class="nome">' + esc(nome || 'Sua empresa') + '</span><span class="dica">Seu logo aqui. <a href="#perfil">Enviar o logo</a></span>';
    return '<div class="np-cobrand"><img class="nx" src="/gerador/nexus-logo-papel.png" alt="NEXUS Eletropostos"><span class="com">Em parceria com</span><div class="np-parceiro">' + parc + '</div></div>';
  }
  function itemMenu(r) {
    var R = ROTAS[r], tr = travada(r), at = S.rota === r;
    return '<button type="button" class="np-n-item' + (at ? ' ativa' : '') + '" data-acao="ir" data-arg="' + r + '"' + (at ? ' aria-current="page"' : '') + '>' +
      ic(r, 'm') + '<span>' + esc(R.menu) + '</span>' + (tr ? ic('cadeado', 'np-cad') : '') + '</button>';
  }
  function ladoHTML() {
    var h = '<div class="logo"><img src="/gerador/nexus-logo-tela.png" alt="NEXUS Eletropostos"></div><nav class="np-nav" aria-label="Menu principal">';
    ORDEM.forEach(function (r) { h += itemMenu(r); });
    if (admOk()) h += '<a class="np-n-item" href="/nexus/adm">' + ic('escudo', 'm') + '<span>ADM</span></a>';
    h += '</nav><div class="np-emp"><b>' + esc(nomeEmpresa() || 'Sua empresa') + '</b>' +
      (localParceiro() ? '<span class="loc">' + esc(localParceiro()) + '</span>' : '') +
      '<span class="nivel">' + esc(NIVEL_NOME[nivel()] || '') + '</span>' +
      '<div class="acoes"><button type="button" data-acao="ir" data-arg="perfil">Editar perfil</button><button type="button" data-acao="sairConta">' + (S.demo ? 'Sair da demonstração' : 'Sair') + '</button></div></div>';
    return h;
  }
  function tabsHTML() {
    var h = '';
    TABS.forEach(function (r) {
      var tr = travada(r), at = S.rota === r;
      h += '<button type="button" class="np-tab' + (at ? ' ativa' : '') + '" data-acao="ir" data-arg="' + r + '"' + (at ? ' aria-current="page"' : '') + '>' + ic(r) + (tr ? ic('cadeado', 'np-cad') : '') + '<span>' + esc(ROTAS[r].menu) + '</span></button>';
    });
    var emMais = TABS.indexOf(S.rota) < 0;
    h += '<button type="button" class="np-tab' + (emMais ? ' ativa' : '') + '" data-acao="abrirMais" aria-haspopup="dialog">' + ic('mais') + '<span>Mais</span></button>';
    return h;
  }
  function folhaHTML() {
    var h = '<div class="np-alca"></div>';
    ORDEM.concat(['perfil']).forEach(function (r) {
      var tr = travada(r);
      h += '<button type="button" class="np-f-item' + (S.rota === r ? ' ativa' : '') + '" data-acao="ir" data-arg="' + r + '">' + ic(r) + '<span>' + esc(ROTAS[r].menu) + '</span>' + (tr ? ic('cadeado', 'p fim') : '') + '</button>';
    });
    if (admOk()) h += '<a class="np-f-item" href="/nexus/adm">' + ic('escudo') + '<span>ADM</span></a>';
    h += '<button type="button" class="np-f-item" data-acao="sairConta">' + ic('sair') + '<span>' + (S.demo ? 'Sair da demonstração' : 'Sair') + '</span></button>';
    return h;
  }
  function montarCasca() {
    var root = $('#nx-root');
    root.innerHTML =
      '<header class="np-top"><img src="/gerador/nexus-logo-tela.png" alt="NEXUS Eletropostos">' +
      '<button type="button" class="np-icobtn" data-acao="abrirMais" aria-label="Abrir o menu" aria-haspopup="dialog">' + ic('menu') + '</button></header>' +
      '<aside class="np-lado" id="np-lado"></aside>' +
      '<div class="np-corpo"><header class="np-head" id="np-head"></header><main class="np-main" id="nx-main" tabindex="-1"></main></div>' +
      '<nav class="np-tabs" id="np-tabs" aria-label="Abas principais"></nav>' +
      '<div class="np-fundo" id="np-fundo" hidden data-acao="fecharMais"></div>' +
      '<div class="np-folha" id="np-folha" role="dialog" aria-label="Menu" hidden></div>' +
      '<div class="nx-toast" id="nx-toast" role="status" hidden></div>';
    S.shell = true;
  }
  function pintarNav() {
    if (!S.shell) return;
    $('#np-lado').innerHTML = ladoHTML();
    $('#np-tabs').innerHTML = tabsHTML();
    $('#np-folha').innerHTML = folhaHTML();
    $('#np-head').innerHTML = cobrandHTML() + '<button type="button" class="nx-btn np-head-cta" data-acao="ir" data-arg="propostas">Gerar proposta</button>';
  }
  function fecharMais() { var f = $('#np-folha'), u = $('#np-fundo'); if (f) f.hidden = true; if (u) u.hidden = true; }
  function toast(msg, erro) {
    var t = $('#nx-toast');
    if (!t) return;
    t.textContent = msg; t.className = 'nx-toast' + (erro ? ' er' : ''); t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 4600);
  }
  function faixaDemo() {
    return S.demo ? '<div class="np-demo"><b>Demonstração</b><span>Dados de exemplo (nível ' + esc(NIVEL_NOME[nivel()]) + '). Nada é salvo e nenhuma conta é usada.</span></div>' : '';
  }

  /* ------------------------------------------------------------------ pintar (fase atual) */
  function pintar() {
    var root = $('#nx-root');
    if (!root) return;
    if (S.fase !== 'app') {
      S.shell = false;
      if (S.fase === 'boot') root.innerHTML = '<div class="nx-girando" style="min-height:100vh;justify-content:center"><div class="nx-spin"></div><span>Carregando o portal</span></div>';
      else if (S.fase === 'embreve') root.innerHTML = telaEmBreve();
      else if (S.fase === 'cnpj_inativo') root.innerHTML = telaCnpjInativo();
      else if (S.fase === 'sem_cnpj') root.innerHTML = telaSemCnpj();
      else if (S.fase === 'erro') root.innerHTML = telaErro();
      else if (S.fase === 'cadastro') root.innerHTML = telaCadastro();
      else root.innerHTML = telaEntrada();
      window.scrollTo(0, 0);
      if (S.fase === 'cadastro') focoCad();
      return;
    }
    if (!S.shell) montarCasca();
    pintarNav();
    pintarMain();
  }

  function pintarMain(manter) {
    var main = $('#nx-main');
    if (!main) return;
    if (esperaScript) { clearInterval(esperaScript); esperaScript = null; }
    S.tela++;
    GRAFS = [];
    var r = S.rota, h = faixaDemo(), pos = null;
    if (r === 'inicio') { h += telaInicio(); pos = posInicio; }
    else if (r === 'mercado') { h += telaMercado(); pos = posMercado; }
    else if (r === 'equipamentos') { h += S.sub && produtoPor(S.sub) ? telaEquipamento(produtoPor(S.sub)) : telaEquipamentos(); pos = posEquipamento; }
    else if (r === 'servicos') { h += telaServicos(); pos = posServicos; }
    else if (r === 'propostas') { h += telaPropostas(); pos = posPropostas; }
    else if (r === 'oportunidades') { h += libera('oportunidades') ? telaRede('oportunidades') : telaOpsBloqueada(); pos = libera('oportunidades') ? function () { montarRede('oportunidades'); } : null; }
    else if (r === 'usinas' || r === 'engenharia') {
      h += travada(r) ? '<div class="np-pagina">' + trava(bloq(ROTAS[r].req), '<button type="button" class="nx-btn" data-acao="ir" data-arg="perfil">Completar o perfil</button>') + '</div>' : telaRede(r);
      pos = travada(r) ? null : function () { montarRede(r); };
    }
    else if (r === 'materiais') h += travada(r) ? '<div class="np-pagina">' + trava(bloq('materiais'), '<button type="button" class="nx-btn" data-acao="ir" data-arg="perfil">Completar o perfil</button>') + '</div>' : telaMateriais();
    else if (r === 'parceria') { h += telaParceria(); pos = posParceria; }
    else if (r === 'perfil') h += telaPerfil();
    main.innerHTML = h;
    if (!manter) {
      window.scrollTo(0, 0);
      try { main.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    }
    if (pos) pos();
    desenharGrafs();
  }

  /* ------------------------------------------------------------------ graficos SVG (largura real do contêiner, sem rolagem) */
  function registrarGraf(fn) {
    var id = 'g' + (++uidG);
    GRAFS.push({ id: id, fn: fn });
    return '<div class="np-graf" id="' + id + '"></div>';
  }
  function desenharGrafs() {
    GRAFS.forEach(function (g) {
      var el = document.getElementById(g.id);
      if (!el) return;
      var W = Math.floor(el.clientWidth);
      if (W < 200) return;
      try { el.innerHTML = g.fn(Math.min(W, 760), g.id); } catch (e) { if (window.console) console.error('grafico', e); }
    });
  }
  function passoNice(max, alvo) {
    var cru = Math.max(max, 1) / alvo, pot = Math.pow(10, Math.floor(Math.log(cru) / Math.LN10)), f = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < f.length; i++) if (f[i] * pot >= cru) return f[i] * pot;
    return 10 * pot;
  }
  function svgColunas(W, id, pts, rotuloY, notaParcial, aria) {
    var H = 236, pl = 38, pr = 8, topo = 26, base = 180;
    var max = 0;
    pts.forEach(function (p) { if (p.val > max) max = p.val; });
    var passo = passoNice(max, 4), nPassos = Math.max(1, Math.ceil(max / passo)), topoVal = passo * nPassos;
    var esc_ = (base - topo) / topoVal;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(aria) + '"><defs><pattern id="h' + id + '" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#DCEBFF"/><rect width="3" height="8" fill="#0085FF"/></pattern></defs>';
    s += '<text x="0" y="12" font-size="11" fill="#4A5568">' + esc(rotuloY) + '</text>';
    for (var k = 1; k <= nPassos; k++) {
      var y = base - k * passo * esc_;
      s += '<line x1="' + pl + '" y1="' + y + '" x2="' + (W - pr) + '" y2="' + y + '" stroke="#E3E8EF"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" font-size="10" fill="#4A5568" text-anchor="end">' + fmt(k * passo) + '</text>';
    }
    s += '<text x="' + (pl - 6) + '" y="' + (base + 4) + '" font-size="10" fill="#4A5568" text-anchor="end">0</text>';
    var slot = (W - pl - pr) / pts.length, bw = Math.min(54, slot * 0.62);
    pts.forEach(function (p, i) {
      var cx = pl + slot * i + slot / 2, h = Math.max(p.val * esc_, p.val > 0 ? 2 : 0), x = cx - bw / 2;
      if (p.parcial) s += '<rect x="' + x + '" y="' + (base - h) + '" width="' + bw + '" height="' + h + '" rx="3" fill="url(#h' + id + ')" stroke="#0085FF" stroke-width="1.5" stroke-dasharray="4 3"/>';
      else s += '<rect x="' + x + '" y="' + (base - h) + '" width="' + bw + '" height="' + h + '" rx="3" fill="#0085FF"/>';
      s += '<text x="' + cx + '" y="' + (base - h - 6) + '" font-size="13" font-weight="800" fill="#0B1A2B" text-anchor="middle">' + esc(fmt(p.val)) + '</text>';
      s += '<text x="' + cx + '" y="' + (base + 20) + '" font-size="12" font-weight="600" fill="#0B1A2B" text-anchor="middle">' + esc(p.rot) + '</text>';
    });
    s += '<line x1="' + pl + '" y1="' + base + '" x2="' + (W - pr) + '" y2="' + base + '" stroke="#8A97A8" stroke-width="1.2"/>';
    if (notaParcial) s += '<text x="' + (W - pr) + '" y="' + (base + 42) + '" font-size="11" fill="#4A5568" text-anchor="end">' + esc(notaParcial) + '</text>';
    return s + '</svg>';
  }
  /* linhas: [{rot, val, txt, dest, sep}] ; sep marca o ponto onde entra a linha tracejada antes da linha. */
  function svgBarrasH(W, linhas, aria, opc) {
    opc = opc || {};
    var rowH = opc.rowH || 28, barH = opc.barH || 18, topo = 6;
    var maxRot = 0, maxTxt = 0, maxVal = 0;
    linhas.forEach(function (l) {
      if (l.rot.length > maxRot) maxRot = l.rot.length;
      if (l.txt.length > maxTxt) maxTxt = l.txt.length;
      if (l.val > maxVal) maxVal = l.val;
    });
    var pl = Math.min(Math.round(maxRot * 6.8 + 14), Math.round(W * 0.42));
    var pr = Math.min(Math.round(maxTxt * 6.6 + 14), Math.round(W * 0.5));
    var area = Math.max(40, W - pl - pr);
    var extras = linhas.filter(function (l) { return l.sep; }).length * 12;
    var H = topo + linhas.length * rowH + extras + 6;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(aria) + '">';
    s += '<line x1="' + pl + '" y1="' + topo + '" x2="' + pl + '" y2="' + (H - 4) + '" stroke="#8A97A8" stroke-width="1.2"/>';
    var y = topo;
    linhas.forEach(function (l) {
      if (l.sep) { s += '<line x1="' + pl + '" y1="' + (y + 6) + '" x2="' + (W - 4) + '" y2="' + (y + 6) + '" stroke="#C5D0DD" stroke-dasharray="3 3"/>'; y += 12; }
      var w = maxVal > 0 ? Math.max(2, (l.val / maxVal) * area) : 2, ty = y + (rowH - barH) / 2;
      s += '<rect x="' + pl + '" y="' + ty + '" width="' + w + '" height="' + barH + '" rx="3" fill="' + (l.dest ? '#0B1A2B' : '#0085FF') + '"/>';
      s += '<text x="' + (pl - 8) + '" y="' + (ty + barH - 5) + '" font-size="12" font-weight="' + (l.dest ? 800 : 600) + '" fill="#0B1A2B" text-anchor="end">' + esc(l.rot) + '</text>';
      s += '<text x="' + (pl + w + 8) + '" y="' + (ty + barH - 5) + '" font-size="12" font-weight="' + (l.dest ? 800 : 700) + '" fill="#0B1A2B">' + esc(l.txt) + '</text>';
      y += rowH;
    });
    return s + '</svg>';
  }

  /* ------------------------------------------------------------------ catalogo: textos do desenho aprovado (fonte: /nexus) */
  var CHIPS = ['CCS2 · 2 plugues', 'OCPP 1.6J', 'Refrigeração ativa', 'Tela sensível ao toque', 'Telemetria em tempo real'];
  var INFO = {
    'nexus-dc-80': {
      tag: 'Dois carros ao mesmo tempo', fotos: ['p-dc', 'dc-frente-limpo', 'dc-3q-dir', 'dc-lateral'],
      alt: 'Carregador NEXUS DC 80 kW, vista frontal com tela e cabos',
      entrada: 'O DC 80 kW puxa perto de 90 kVA. Na CEMIG, o padrão de baixa tensão (ND-5.1) vai até 75 kW: o ponto precisa de estudo da entrada de energia.'
    },
    'nexus-dc-120': {
      tag: 'Divide a potência entre as vagas', fotos: ['p-dc', 'dc-frente-limpo', 'dc-3q-dir', 'dc-lateral'],
      alt: 'Carregador NEXUS DC 120 kW, vista frontal com tela e cabos',
      entrada: 'Todo ponto precisa de estudo da entrada de energia antes da compra. A Engenharia NEXUS faz esse estudo para você.'
    }
  };
  function infoDe(p) { return INFO[p.id] || { tag: '', fotos: ['dc-frente-limpo'], alt: p.nome, entrada: '' }; }
  function fotoUrl(n) { return '/nexus/img/' + n + '.webp'; }
  function fin() { return (S.eu && S.eu.financiamento) || { parcelas: 96, carenciaDias: 120 }; }
  function entregaTxt() { return (S.eu && S.eu.entrega) || 'Entrega na primeira quinzena de dezembro'; }
  function parcela18(p, q) { return rs((p.precoSugerido * (q || 1)) / 18, 2); }
  function finTxt() { var f = fin(); return 'Em até ' + f.parcelas + 'x com ' + f.carenciaDias + ' dias de carência, sujeito à análise de crédito'; }

  function boxParceiro(p) {
    var corpo = '<strong>Negociado com o comercial</strong>';
    if (libera('negociar')) corpo += '<button type="button" class="nx-btn sec" data-acao="negociar" data-arg="' + esc(p.id) + '">Negociar com o comercial</button>';
    else corpo += '<span class="trava">' + ic('cadeado', 'p') + 'Negociar com o comercial</span><small class="np-lktx">' + esc(bloq('negociar')) + '</small>';
    return '<div class="np-parc"><span class="np-rot">Seu preço de parceiro</span>' + corpo + '</div>';
  }
  function cardProduto(p) {
    var I = infoDe(p);
    return '<article class="np-prod"><div class="np-foto"><img src="' + esc(fotoUrl(I.fotos[0])) + '" alt="' + esc(I.alt) + '" loading="lazy"></div>' +
      '<div><h3>' + esc(p.nome) + '</h3><p class="ger">' + esc(I.tag) + '</p></div>' +
      '<div class="np-chips">' + CHIPS.map(function (c) { return '<span class="nx-chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
      '<div class="np-precos"><div class="np-preco"><span class="np-rot">Preço de tabela</span><strong>' + esc(rs(p.precoSugerido)) + '</strong><small>Teto para o cliente final</small></div>' + boxParceiro(p) + '</div>' +
      '<div class="np-cond"><span><b>Ou 18x de ' + esc(parcela18(p)) + '</b><small>' + esc(finTxt()) + '</small></span><b>' + esc(entregaTxt()) + '</b></div>' +
      '<div class="np-acoes">' + (libera('pedido') ? '<button type="button" class="nx-btn" data-acao="comprar" data-arg="' + esc(p.id) + '">Comprar</button>' : lk('Comprar', 'pedido', '')) +
      '<button type="button" class="nx-btn sec" data-acao="ir" data-arg="propostas">Gerar proposta</button>' +
      '<button type="button" class="nx-btn link" data-acao="ir" data-arg="equipamentos/' + esc(p.id) + '">Ver detalhes</button></div></article>';
  }
  function cardsProdutos() {
    var ps = produtos();
    if (!ps.length) return '<div class="np-vazio-sec">O catálogo não carregou. Atualize a página.</div>';
    return '<div class="np-prods">' + ps.map(cardProduto).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ Início */
  var COMO = {
    cadastrado: 'Depois da conversa com o comercial.',
    partner: 'A partir da primeira compra de carregador.',
    pro: 'A partir de 5 carregadores comprados.',
    master: 'Você está no nível mais alto da rede.'
  };
  var FALTA = {
    perfil: 'Completar o perfil', primeira_proposta: 'Gerar a primeira proposta', conversa: 'Conversa com o comercial',
    aprovacao_partner: 'Aprovação da equipe NEXUS', papel_montagem: 'Marcar Montagem e Engenharia no perfil',
    aprovacao_montagem: 'Montagem aprovada pela equipe NEXUS', primeira_compra: 'Primeira compra', aceite_termo: 'Aceite do Termo de Parceria', compras: 'Carregadores comprados'
  };
  function textoFaltam(pr) {
    if (!pr || !pr.faltam || !pr.faltam.length) return '';
    return 'Falta: ' + pr.faltam.map(function (k) {
      if (k === 'compras' && pr.carregadores_faltam != null) return pr.carregadores_faltam + (pr.carregadores_faltam === 1 ? ' carregador' : ' carregadores') + ' para o Master';
      return (FALTA[k] || k).replace(/^./, function (c) { return c.toLowerCase(); });
    }).join(', ') + '.';
  }
  function telaInicio() {
    var eu = S.eu, p = eu.parceiro || {}, nv = nivel(), idx = NIVEL_IDX[nv] || 1, pr = eu.progresso || {};
    var prox = pr.proximo ? NIVEL_NOME[pr.proximo] : '';
    var linha = [NIVEL_NOME[nv]];
    if (localParceiro()) linha.push(localParceiro());
    if (p.raio_km) linha.push('Raio de atendimento de ' + fmt(p.raio_km) + ' km');
    var c = eu.contagens || {};
    var nums = [
      [c.propostas_mes, 'Propostas geradas no mês'], [c.pedidos, 'Pedidos de equipamento'],
      [c.oportunidades_recebidas, 'Oportunidades recebidas']
    ];
    if (MOSTRAR_USINAS) nums.push([c.usinas, 'Usinas indicadas']);
    var h = '<div class="np-pagina">';
    h += '<section class="np-saud"><div class="tx"><h1>Olá, ' + esc(nomeEmpresa() || 'parceiro') + '</h1><p>' + esc(linha.join(' · ')) + '</p></div>' +
      '<div class="np-prog"><div class="l"><span>' + (prox ? 'Próximo nível: ' + esc(prox) : 'Nível máximo') + '</span><span>Etapa ' + idx + ' de 4</span></div>' +
      '<div class="np-barra" role="img" aria-label="Progresso até o próximo nível: etapa ' + idx + ' de 4"><i style="width:' + (idx * 25) + '%"></i></div>' +
      '<span class="c">' + esc(prox ? COMO[nv] : COMO.master) + '</span>' +
      (textoFaltam(pr) ? '<span class="c">' + esc(textoFaltam(pr)) + '</span>' : '') + '</div></section>';
    h += '<section class="np-sec"><h2>Os carregadores da rede</h2>' + cardsProdutos() + '</section>';
    h += '<section class="np-sec"><div class="np-tit-grupo"><h2>Sua parceria em números</h2>' + (S.demo ? '<span class="nx-chip ex">Dados de exemplo</span>' : '') + '</div><div class="np-nums">' +
      nums.map(function (n) { return '<div class="np-num"><strong>' + esc(fmt(n[0])) + '</strong><span>' + esc(n[1]) + '</span></div>'; }).join('') + '</div></section>';
    h += '<section class="np-sec"><h2>Procura na sua região</h2><div id="np-procura">' + girando('Carregando a procura') + '</div></section>';
    h += '<section class="np-sec"><h2>Mercado no seu estado</h2><div id="np-mercuf">' + girando('Carregando o mercado') + '</div></section>';
    h += '<section class="np-sec"><div class="np-tit-linha"><div class="np-tit-grupo"><h2>Oportunidades na sua região</h2></div>' +
      (libera('oportunidades') ? '<button type="button" class="np-linkgrande" data-acao="ir" data-arg="oportunidades">Ver todas as oportunidades</button>' : '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>') + '</div>' +
      '<div id="np-opsini">' + (libera('oportunidades') ? girando('Carregando as oportunidades') : opsBloqueadasHTML()) + '</div></section>';
    h += '<section class="np-chamadas">' + (MOSTRAR_USINAS ? '<div class="np-chamada"><span class="ico">' + ic('usinas') + '</span><h3>Indique uma usina</h3><p>Conhece uma usina solar com energia sobrando? A NEXUS compra energia para a rede de eletropostos.</p>' +
      '<button type="button" class="nx-btn" data-acao="ir" data-arg="usinas">Indicar usina</button></div>' : '') +
      '<div class="np-chamada" id="servicos"><span class="ico">' + ic('servicos') + '</span><h3>Serviços NEXUS</h3><p>Engenharia em pacotes de 3, 5 e 10 projetos, consultoria de vendas e a Plataforma NEXUS para você revender.' +
      (saldoEng() && saldoEng().comprados > 0 ? ' Seu saldo de engenharia: ' + saldoEng().disponiveis + (saldoEng().disponiveis === 1 ? ' projeto.' : ' projetos.') : '') + '</p>' +
      (travada('servicos') ? lkNota('pacotes_engenharia') : '') +
      '<button type="button" class="nx-btn" data-acao="ir" data-arg="servicos">Ver os serviços</button></div>' +
      '<div class="np-chamada" id="engenharia"><span class="ico">' + ic('engenharia') + '</span><h3>Engenharia NEXUS</h3><p>Precisa de projeto elétrico, ART, estudo da entrada de energia ou homologação na distribuidora? A NEXUS faz para você.</p>' +
      '<button type="button" class="nx-btn" data-acao="ir" data-arg="engenharia">Pedir engenharia</button></div></section>';
    h += '<section class="np-rodape"><p>A NEXUS é importadora. O cliente e a obra da sua região são seus.</p><p>Nada é cobrado sobre a sua obra. Sem mensalidade. Sem taxa de entrada.</p></section>';
    return h + '</div>';
  }
  function posInicio() {
    carregarProcura('np-procura', true);
    carregarFrota(function () { var el = $('#np-mercuf'); if (el) el.innerHTML = mercadoUfHTML(true); desenharGrafs(); }, 'np-mercuf');
    if (libera('oportunidades')) carregarOpsInicio();
  }

  /* Procura (API) */
  function ufDoParceiro() { var u = S.eu && S.eu.parceiro && S.eu.parceiro.uf; return u && UFS.indexOf(String(u).toUpperCase()) >= 0 ? String(u).toUpperCase() : ''; }
  var NOME_UF = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins" };
  function nomeUf(uf) { return NOME_UF[uf] || uf; }
  function carregarProcura(destino, completo) {
    var uf = ufDoParceiro(), t = S.tela;
    var chave = uf || 'BR';
    function pinta(d) { var el = document.getElementById(destino); if (el && S.tela === t) { el.innerHTML = procuraHTML(d, completo, uf); desenharGrafs(); } }
    function erro() {
      var el = document.getElementById(destino);
      if (el && S.tela === t) el.innerHTML = secErro('Não foi possível carregar a procura agora.', 'recarregarProcura');
    }
    if (S.procura[chave]) { pinta(S.procura[chave]); return; }
    S.procuraDestino = destino; S.procuraCompleto = !!completo;
    api('GET', NX + '/procura' + (uf ? '?uf=' + uf : ''), undefined, { quieto: true }).then(function (r) {
      if (S.tela !== t) return;
      if (r.ok && r.data && Array.isArray(r.data.meses)) { S.procura[chave] = r.data; pinta(r.data); }
      else erro();
    });
  }
  function rotuloMes(m) { var k = +String(m).slice(5, 7); return MES_AB[k - 1] || String(m); }
  function fonteProcura(meses) {
    if (!meses || !meses.length) return '';
    var a = meses[0].mes, b = meses[meses.length - 1].mes;
    var ma = MESES[+a.slice(5, 7) - 1], mb = MESES[+b.slice(5, 7) - 1];
    return 'Fonte: Agenda NEXUS, ' + (a.slice(0, 4) === b.slice(0, 4) ? ma + ' a ' + mb + ' de ' + b.slice(0, 4) : ma + ' de ' + a.slice(0, 4) + ' a ' + mb + ' de ' + b.slice(0, 4)) + '.';
  }
  function colunasMeses(d) {
    var n = d.meses.length, pts = d.meses.map(function (m, i) { return { rot: rotuloMes(m.mes), val: num(m.total), parcial: i === n - 1 }; });
    var b = brt(d.atualizado_em ? new Date(d.atualizado_em) : new Date());
    var parcial = 'Parcial, até ' + p2(b.dia) + '/' + p2(b.mes);
    var aria = 'Gráfico de colunas das reuniões de eletroposto agendadas pela NEXUS no Brasil: ' + d.meses.map(function (m) { return rotuloMes(m.mes) + ' ' + num(m.total); }).join(', ') + ' (último mês parcial, ' + parcial.toLowerCase() + ')';
    return registrarGraf(function (W, id) { return svgColunas(W, id, pts, 'Reuniões agendadas', parcial, aria); });
  }
  function barrasPorUf(d, uf) {
    var lista = (d.por_uf || []).slice(), top = lista.slice(0, 10), linhas = [];
    top.forEach(function (x) { linhas.push({ rot: x.uf, val: num(x.total), txt: fmt(x.total), dest: x.uf === uf }); });
    if (uf && !top.some(function (x) { return x.uf === uf; })) {
      lista.forEach(function (x) { if (x.uf === uf) linhas.push({ rot: x.uf, val: num(x.total), txt: fmt(x.total), dest: true, sep: true }); });
    }
    if (!linhas.length) return '<div class="np-vazio-sec">Ainda não há reuniões com o estado identificado.</div>';
    var aria = 'Gráfico de barras horizontais das reuniões de eletroposto com estado identificado: ' + linhas.map(function (l) { return l.rot + ' ' + l.txt; }).join(', ');
    return registrarGraf(function (W) { return svgBarrasH(W, linhas, aria); });
  }
  function procuraHTML(d, completo, uf) {
    if (completo) {
      return '<div class="np-par" style="align-items:flex-start"><div class="np-card"><h3>Reuniões de eletroposto agendadas pela NEXUS no Brasil, por mês</h3>' + colunasMeses(d) + '</div>' +
        '<div class="np-card"><div><h3>Reuniões por estado, só com o estado identificado</h3>' + (uf ? '<p class="nota">' + esc(nomeUf(uf)) + ' em destaque.</p>' : '') + '</div>' + barrasPorUf(d, uf) + '</div></div><p class="np-fonte">' + esc(fonteProcura(d.meses)) + '</p>';
    }
    var h = '<div class="np-par">';
    if (uf) {
      h += '<div class="np-card"><span class="np-grande">' + esc(fmt(d.reunioes_90d_uf)) + '</span><p class="tit">Reuniões de eletroposto em ' + esc(nomeUf(uf)) + ' nos últimos 90 dias</p><p class="nota">Só conta reuniões com o estado identificado.</p></div>';
    } else {
      h += '<div class="np-card"><h3>Informe a UF da sua empresa</h3><p class="nota">Com a UF no perfil, mostramos a procura por eletroposto no seu estado.</p><button type="button" class="nx-btn sec" data-acao="ir" data-arg="perfil">Completar o perfil</button></div>';
    }
    h += '<div class="np-card dois"><h3>Reuniões de eletroposto agendadas pela NEXUS no Brasil</h3>' + colunasMeses(d) + '</div></div>';
    if (d.pct_fora_mg_go_df != null) h += '<div class="np-faixa-pct"><span class="p">' + esc(Math.round(d.pct_fora_mg_go_df)) + '%</span>da procura com estado identificado vem de fora de MG, GO e DF. É aí que entra o parceiro regional.</div>';
    h += '<p class="np-fonte">' + esc(fonteProcura(d.meses)) + '</p>';
    return h;
  }

  /* Frota (JSON estatico) */
  function carregarFrota(cb, destino) {
    var t = S.tela;
    if (S.frota) { cb(); return; }
    function erro() {
      var el = document.getElementById(destino);
      if (el && S.tela === t) el.innerHTML = secErro('Não foi possível carregar os dados de mercado.', 'recarregarFrota');
      S.frotaDestino = destino;
    }
    fetch('/nexus/app/dados/frota-2026-07.json', { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !Array.isArray(j.estados)) throw new Error('formato');
      S.frota = j;
      if (S.tela === t) cb();
    }).catch(function () { erro(); });
  }
  function dadosEstados() {
    var F = S.frota;
    return F.estados.map(function (e) {
      return { uf: e.uf, nome: e.nome, jun: e.junho, jul: e.julho, dif: e.julho - e.junho, pct: e.junho > 0 ? (e.julho / e.junho - 1) * 100 : 0 };
    });
  }
  function sinal(n, d) { return (n >= 0 ? '+' : '-') + fmt(Math.abs(n), d); }
  function refRotulo() { return S.frota.referencia.rotulo; }
  function mercadoUfHTML(resumo) {
    var F = S.frota, uf = ufDoParceiro(), es = dadosEstados();
    var maiores = es.slice().sort(function (a, b) { return b.jul - a.jul; });
    var top = maiores.slice(0, 10), linhas = [];
    top.forEach(function (e) { linhas.push({ rot: e.uf, val: e.jul, txt: fmt(e.jul) + (e.uf === uf ? ' · ' + e.nome : ''), dest: e.uf === uf }); });
    var meu = es.filter(function (e) { return e.uf === uf; })[0];
    if (meu && !top.some(function (e) { return e.uf === uf; })) linhas.push({ rot: meu.uf, val: meu.jul, txt: fmt(meu.jul) + ' · ' + meu.nome, dest: true, sep: true });
    var bj = F.brasil.julho, bn = F.brasil.junho, alta = bn > 0 ? Math.round((bj / bn - 1) * 100) : 0;
    var aria = 'Gráfico de barras horizontais de veículos plug-in por estado, os 10 maiores' + (meu ? ' e ' + meu.nome : '') + ': ' + linhas.map(function (l) { return l.rot + ' ' + fmt(l.val); }).join(', ');
    var h = '<div class="np-par"><div class="np-card">';
    if (meu) h += '<span class="np-grande m">' + esc(fmt(meu.jul)) + '</span><p class="tit">Veículos plug-in em ' + esc(meu.nome) + '</p><p class="nota">' + esc(fmt(bj)) + ' no Brasil, alta de ' + esc(alta) + '% de ' + esc(F.anterior.rotulo.split(' ')[0]) + ' para ' + esc(F.referencia.rotulo.split(' ')[0]) + '.</p>';
    else h += '<span class="np-grande m">' + esc(fmt(bj)) + '</span><p class="tit">Veículos plug-in no Brasil</p><p class="nota">Alta de ' + esc(alta) + '% de ' + esc(F.anterior.rotulo.split(' ')[0]) + ' para ' + esc(F.referencia.rotulo.split(' ')[0]) + '. Informe a UF no perfil para ver o seu estado.</p><button type="button" class="nx-btn sec" data-acao="ir" data-arg="perfil">Completar o perfil</button>';
    h += '</div><div class="np-card dois"><h3>Veículos plug-in por estado, os 10 maiores' + (meu && !top.some(function (e) { return e.uf === uf; }) ? ' e ' + esc(meu.nome) : (meu ? '' : '')) + '</h3>' +
      registrarGraf(function (W) { return svgBarrasH(W, linhas, aria); }) + '</div></div>';
    h += '<div class="np-tit-linha"><p class="np-fonte">Fonte: ' + esc(F.fonte.split(',')[0]) + ', ' + esc(F.referencia.rotulo) + '.</p>' +
      (resumo ? '<button type="button" class="np-linkgrande" data-acao="ir" data-arg="mercado">Ver mercado completo</button>' : '') + '</div>';
    return h;
  }

  /* Oportunidades na Início */
  function tipoOp(o) { return o.tipo === 'obra' ? 'Obra terceirizada NEXUS' : 'Cliente para você vender'; }
  function opLinha(o, comBotao) {
    var local = [o.cidade ? o.cidade + (o.uf ? '/' + o.uf : '') : (o.uf || ''), o.distancia_km != null ? fmt(o.distancia_km) + ' km' : ''].filter(Boolean).join(' · ');
    return '<div class="np-op"><div class="c"><div class="t"><span class="np-tipo' + (o.tipo === 'obra' ? '' : ' cli') + '">' + esc(tipoOp(o)) + '</span><span class="loc">' + esc(local) + '</span></div><p>' + esc(o.descricao || '') + '</p></div>' +
      '<div class="r"><span class="prazo">' + ic('relogio', 'p') + esc(prazoTxt(o.prazo_aceite)) + '</span>' + (comBotao ? '<button type="button" class="nx-btn" data-acao="ir" data-arg="oportunidades">Ver</button>' : '') + '</div></div>';
  }
  function carregarOpsInicio() {
    var t = S.tela;
    api('GET', NX + '/oportunidades', undefined, { quieto: true }).then(function (r) {
      var el = $('#np-opsini');
      if (!el || S.tela !== t) return;
      if (!r.ok) { el.innerHTML = secErro('Não foi possível carregar as oportunidades agora.', 'recarregarOps'); return; }
      var l = ((r.data && r.data.oportunidades) || []).filter(function (o) { return o.status === 'oferecida'; })
        .sort(function (a, b) { return new Date(a.prazo_aceite) - new Date(b.prazo_aceite); }).slice(0, 3);
      if (!l.length) { el.innerHTML = '<div class="np-vazio-sec">Nenhuma oportunidade aberta na sua região agora. Quando a NEXUS tiver um cliente ou uma obra para você, ela aparece aqui.</div>'; return; }
      el.innerHTML = '<div class="np-ops">' + l.map(function (o) { return opLinha(o, true); }).join('') + '</div>';
    });
  }
  function opsBloqueadasHTML() {
    var amostra = ['Obra terceirizada NEXUS · Cidade da sua região', 'Cliente para você vender · Cidade da sua região', 'Cliente para você vender · Cidade da sua região'];
    return '<div class="np-ops"><div class="np-bloq"><div class="fundo" aria-hidden="true">' +
      amostra.map(function (t) { return '<div class="np-op"><div class="c"><div class="t"><span class="np-tipo">' + esc(t) + '</span></div><p>Exemplo de pedido de cliente ou de obra com o prazo para aceitar.</p></div></div>'; }).join('') + '</div>' +
      '<div class="aviso"><div role="note"><span class="ico">' + ic('cadeado') + '</span><p>' + esc(bloq('oportunidades')) + '</p>' +
      '<span class="np-lktx">Clientes e obras da NEXUS na sua região chegam aos parceiros Pro que aceitaram o Termo de Parceria, com prazo para aceitar.</span>' +
      ((NIVEL_IDX[nivel()] || 1) >= 3 ? '<button type="button" class="nx-btn" data-acao="irTermoParceria">Ler e aceitar o termo</button>' : '<button type="button" class="nx-btn" data-acao="ir" data-arg="parceria">Ver como chegar</button>') +
      '</div></div></div></div>';
  }
  function telaOpsBloqueada() {
    return '<div class="np-pagina"><section class="np-sec"><h1 class="nx-h1">Oportunidades na sua região</h1><p class="nx-sub">Clientes e obras da NEXUS que chegam para os parceiros Pro da sua região.</p>' + opsBloqueadasHTML() + '</section></div>';
  }

  /* ------------------------------------------------------------------ Mercado */
  function telaMercado() {
    return '<div class="np-pagina"><section class="np-sec"><div><h1 class="nx-h1">Mercado</h1><p class="nx-sub" style="max-width:720px;margin:0">A frota de veículos plug-in no Brasil e a procura por eletroposto que chega à NEXUS.</p></div>' +
      '<div id="np-mer-a">' + girando('Carregando o mercado') + '</div></section>' +
      '<section class="np-sec" id="np-mer-b"></section>' +
      '<section class="np-sec"><h2>Procura que chega à NEXUS</h2><div id="np-mer-c">' + girando('Carregando a procura') + '</div></section></div>';
  }
  function posMercado() {
    carregarFrota(function () {
      var a = $('#np-mer-a'), b = $('#np-mer-b');
      if (!a || !b) return;
      var m = mercadoCompleto();
      a.innerHTML = m.kpis; b.innerHTML = m.estados;
      desenharGrafs();
    }, 'np-mer-a');
    carregarProcura('np-mer-c', true);
  }
  function mercadoCompleto() {
    var F = S.frota, uf = ufDoParceiro(), es = dadosEstados();
    var bj = F.brasil.julho, bn = F.brasil.junho, dif = bj - bn, alta = bn > 0 ? Math.round((bj / bn - 1) * 100) : 0;
    var mesA = F.anterior.rotulo.split(' ')[0], mesB = F.referencia.rotulo.split(' ')[0];
    var kpis = '<div class="np-kpis"><div class="np-num"><strong class="az">' + esc(fmt(bj)) + '</strong><span>Veículos plug-in no Brasil em ' + esc(F.referencia.rotulo) + '</span></div>' +
      '<div class="np-num"><strong>' + esc(sinal(dif)) + '</strong><span>Carros plug-in a mais em um mês</span></div>' +
      '<div class="np-num"><strong>' + esc(sinal(alta)) + '%</strong><span>Alta da frota de ' + esc(mesA) + ' para ' + esc(mesB) + '</span></div></div>';
    var cres = es.slice().sort(function (a, b) { return b.pct - a.pct; });
    var linhas = cres.map(function (e) { return { rot: e.uf, val: Math.max(e.pct, 0.1), txt: sinal(e.pct, 1) + '% · ' + sinal(e.dif) + ' carros', dest: e.uf === uf }; });
    var ariaE = 'Gráfico de barras horizontais com o crescimento da frota plug-in de ' + mesA + ' para ' + mesB + ' nos ' + es.length + ' estados, do maior para o menor: ' + cres.map(function (e) { return e.uf + ' ' + sinal(e.pct, 1) + '%'; }).join(', ');
    var h = '<h2>Frota plug-in por estado</h2><div class="np-par" style="align-items:flex-start"><div class="np-card dois"><div><h3>Crescimento da frota de ' + esc(mesA) + ' para ' + esc(mesB) + ', nos ' + es.length + ' estados</h3><p class="nota">Do maior para o menor crescimento.' + (uf ? ' ' + esc(nomeUf(uf)) + ' em destaque.' : '') + '</p></div>' +
      registrarGraf(function (W) { return svgBarrasH(W, linhas, ariaE, { rowH: 26, barH: 17 }); }) + '</div><div style="display:flex;flex-direction:column;gap:16px;min-width:0">';
    var meu = es.filter(function (e) { return e.uf === uf; })[0];
    if (meu) {
      var rank = es.slice().sort(function (a, b) { return b.jul - a.jul; }).map(function (e) { return e.uf; }).indexOf(uf) + 1;
      h += '<div class="np-escuro"><span class="np-rot">' + esc(meu.nome) + '</span><span class="v">' + esc(fmt(meu.jul)) + '</span><p>Veículos plug-in em ' + esc(F.referencia.rotulo) + '</p><p class="s">' + esc(sinal(meu.dif)) + ' no mês, alta de ' + esc(fmt(meu.pct, 1)) + '%. É o ' + rank + 'º estado em frota.</p></div>';
      var cid = F.cidades.filter(function (c) { return c.uf === uf; }).sort(function (a, b) { return b.julho - a.julho; });
      h += '<div class="np-card"><div><h3>Cidades de ' + esc(meu.nome) + ' com mais carros plug-in</h3><p class="nota">' + (cid.length ? (cid.length === 1 ? 'A cidade do estado com ' : 'As ' + cid.length + ' cidades do estado com ') + esc(F.piso_cidade) + ' ou mais veículos.' : '') + '</p></div>';
      if (cid.length) {
        var lc = cid.slice(0, 12).map(function (c) { return { rot: c.nome, val: c.julho, txt: fmt(c.julho) }; });
        var ariaC = 'Gráfico de barras horizontais das cidades de ' + meu.nome + ' com mais carros plug-in em ' + F.referencia.rotulo + ': ' + lc.map(function (l) { return l.rot + ' ' + l.txt; }).join(', ');
        h += registrarGraf(function (W) { return svgBarrasH(W, lc, ariaC, { rowH: 30, barH: 19 }); });
      } else h += '<div class="np-vazio-sec">Nenhuma cidade do estado chega a ' + esc(F.piso_cidade) + ' veículos plug-in.</div>';
      h += '</div>';
    } else {
      h += '<div class="np-card"><h3>Veja o seu estado</h3><p class="nota">Informe a UF da empresa no perfil para ver a frota e as cidades do seu estado.</p><button type="button" class="nx-btn sec" data-acao="ir" data-arg="perfil">Completar o perfil</button></div>';
    }
    h += '</div></div><p class="np-fonte">Fonte: ' + esc(F.fonte.split(',')[0]) + ', ' + esc(mesA) + ' e ' + esc(F.referencia.rotulo) + '.</p>';
    return { kpis: kpis, estados: h };
  }

  /* ------------------------------------------------------------------ Equipamentos */
  function telaEquipamentos() {
    return '<div class="np-pagina"><section class="np-sec"><div><h1 class="nx-h1">Equipamentos</h1><p class="nx-sub" style="margin:0">Os dois carregadores rápidos da rede NEXUS. Preço de tabela é o teto para o cliente final.</p></div>' + cardsProdutos() + '</section></div>';
  }
  function especificacoes(p) {
    var s = p.specs || {}, I = infoDe(p), ft = 'Consulte ficha técnica';
    return [
      ['Potência', fmt(p.potenciaKw) + ' kW'], ['Corrente', 'Contínua (DC)'], ['Conectores', s.conectores || 'CCS2, 2 plugues'],
      ['Atendimento', I.tag || ft], ['Comunicação', 'OCPP 1.6J'], ['Refrigeração', 'Ativa'], ['Tela', 'Sensível ao toque'],
      ['Monitoramento', 'Telemetria de cada tomada em tempo real'], ['Tensão de entrada', s.tensaoEntrada || ft], ['Eficiência', s.eficiencia || ft],
      ['Proteções', s.protecao || ft], ['Certificação', s.certificacao || ft], ['Garantia', s.garantia || ft], ['Dimensões e peso', ft]
    ];
  }
  function telaEquipamento(p) {
    var I = infoDe(p), ps = produtos();
    var fotoI = S.foto < I.fotos.length ? S.foto : 0;
    var h = '<div class="np-pagina"><nav class="np-crumbs" aria-label="Trilha de navegação"><a href="#equipamentos">Equipamentos</a><span aria-hidden="true">›</span><span aria-current="page">' + esc(p.nome) + '</span></nav>';
    h += '<section class="np-topo-prod"><div class="np-galeria"><div class="grande"><img id="np-foto" src="' + esc(fotoUrl(I.fotos[fotoI])) + '" alt="' + esc(p.nome + '. ' + I.alt) + '"></div><div class="np-mini">' +
      I.fotos.map(function (f, i) { return '<button type="button" data-acao="foto" data-arg="' + i + '" aria-label="Foto ' + (i + 1) + ' de ' + I.fotos.length + '" aria-pressed="' + (i === fotoI) + '"><img src="' + esc(fotoUrl(f)) + '" alt=""></button>'; }).join('') + '</div></div>';
    h += '<div class="np-info"><div><h1>' + esc(p.nome) + '</h1><p class="ger">' + esc(I.tag) + '</p></div><div class="np-card">' +
      '<div class="np-precos"><div class="np-preco"><span class="np-rot">Preço de tabela</span><strong>' + esc(rs(p.precoSugerido)) + '</strong><small>Teto para o cliente final</small></div>' + boxParceiro(p) + '</div>' +
      '<div class="np-cond"><b>Ou 18x de ' + esc(parcela18(p)) + '</b><small>' + esc(finTxt()) + '</small></div>' +
      '<div class="np-qtd"><div><span class="rot" id="np-rotqtd">Quantidade</span><div class="np-step" role="group" aria-labelledby="np-rotqtd"><button type="button" data-acao="qtd" data-arg="-1" aria-label="Diminuir quantidade">−</button><output id="np-qtd" aria-live="polite">' + S.qtd + '</output><button type="button" data-acao="qtd" data-arg="1" aria-label="Aumentar quantidade">+</button></div></div>' +
      '<div class="np-total"><small id="np-qtdtxt"></small><strong id="np-tot"></strong><small id="np-par18"></small></div></div>' +
      '<p style="font-size:14px;font-weight:700">' + esc(entregaTxt()) + '</p>' +
      '<div class="np-acoes">' + (libera('pedido') ? '<button type="button" class="nx-btn lg" data-acao="comprar" data-arg="' + esc(p.id) + '">Comprar</button>' : lk('Comprar', 'pedido', 'lg')) + '<button type="button" class="nx-btn sec lg" data-acao="ir" data-arg="propostas">Gerar proposta para o meu cliente</button></div>' +
      '<div id="np-compra"></div></div></div></section>';
    h += '<section class="np-sec"><h2>Especificações</h2><div class="np-tab-spec"><table><tbody>' + especificacoes(p).map(function (e) { return '<tr><th scope="row">' + esc(e[0]) + '</th><td>' + esc(e[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px"><button type="button" class="nx-btn" disabled>Baixar ficha técnica</button><span class="nx-chip">Em breve</span></div></section>';
    var avisos = [
      ['equipamentos', 'Entrada de energia', I.entrada],
      ['tela', 'Software NEXUS', 'O ponto opera pelo software NEXUS, que fica com 10% do que o ponto fatura em recarga.'],
      ['engenharia', 'Peça e suporte', 'Peça de reposição no país: a estação não espera contêiner para voltar a faturar.']
    ];
    h += '<section class="np-sec"><h2>Antes de vender</h2><div class="np-avisos">' + avisos.map(function (a) { return '<div class="np-card"><span class="ico">' + ic(a[0], 'm') + '</span><h3>' + esc(a[1]) + '</h3><p>' + esc(a[2]) + '</p></div>'; }).join('') + '</div></section>';
    if (ps.length > 1) {
      var inf = function (x) { return infoDe(x); };
      var linhas = [['Potência', function (x) { return fmt(x.potenciaKw) + ' kW'; }], ['Atendimento', function (x) { return inf(x).tag; }], ['Conectores', function () { return 'CCS2, 2 plugues'; }],
        ['Preço de tabela', function (x) { return rs(x.precoSugerido); }], ['Em 18x', function (x) { return parcela18(x); }]];
      h += '<section class="np-sec"><h2>Compare</h2><div class="np-tab-comp"><table><thead><tr><th scope="col">Característica</th>' +
        ps.map(function (x) { return '<th scope="col"' + (x.id === p.id ? ' class="sel"' : '') + '>' + esc(x.nome) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        linhas.map(function (l) { return '<tr><th scope="row">' + esc(l[0]) + '</th>' + ps.map(function (x) { return '<td' + (x.id === p.id ? ' class="sel"' : '') + '>' + esc(l[1](x)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>';
    }
    return h + '</div>';
  }
  function posEquipamento() {
    if (S.rota !== 'equipamentos' || !S.sub) return;
    atualizarTotal();
    if (S.abrirCompra) { S.abrirCompra = false; abrirCompra(); }
  }
  function atualizarTotal() {
    var p = produtoPor(S.sub);
    if (!p || !$('#np-tot')) return;
    $('#np-qtd').textContent = S.qtd;
    $('#np-qtdtxt').textContent = 'Total de tabela · ' + (S.qtd === 1 ? '1 unidade' : S.qtd + ' unidades');
    $('#np-tot').textContent = rs(p.precoSugerido * S.qtd);
    $('#np-par18').textContent = 'Ou 18x de ' + parcela18(p, S.qtd);
  }
  function pedidoForm(id, o) {
    var ps = produtos();
    return '<div class="np-form-inline" id="ped-' + esc(id) + '" data-prop="' + esc(o.propostaId || '') + '"><h3>' + esc(o.titulo || 'Pedir equipamento') + '</h3>' +
      '<div class="nx-grade2"><div class="nx-campo"><label for="pm-' + esc(id) + '">Modelo</label><select id="pm-' + esc(id) + '">' +
      ps.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === o.modelo ? ' selected' : '') + '>' + esc(p.nome) + '</option>'; }).join('') + '</select></div>' +
      '<div class="nx-campo"><label for="pq-' + esc(id) + '">Quantidade</label><input id="pq-' + esc(id) + '" type="number" inputmode="numeric" min="1" max="50" value="' + esc(o.qtd || 1) + '"></div></div>' +
      '<div class="nx-campo"><label for="po-' + esc(id) + '">Observação para o comercial (opcional)</label><textarea id="po-' + esc(id) + '" maxlength="300"></textarea></div>' +
      '<p class="nx-msg-erro" data-erro hidden></p><button type="button" class="nx-btn" data-acao="enviarPedido" data-arg="' + esc(id) + '">Enviar pedido</button></div>';
  }
  function abrirCompra() {
    var c = $('#np-compra');
    if (!c) return;
    if (!libera('pedido')) {
      c.innerHTML = '<p class="np-aviso lk" style="margin:0">' + ic('cadeado', 'p') + '<span>' + esc(bloq('pedido')) + '. <a href="#parceria">Ver como chegar</a>.</span></p>';
      return;
    }
    c.innerHTML = pedidoForm('compra', { modelo: S.sub, qtd: S.qtd, titulo: 'Pedir ' + ((produtoPor(S.sub) || {}).nome || 'equipamento') });
    var f = c.querySelector('input'); if (f) f.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ Propostas (gerador + lista) */
  function telaPropostas() {
    var lista = S.sub === 'lista';
    var h = '<div class="np-pagina"><div class="np-tit-linha"><h1 class="nx-h1" style="margin:0">' + (lista ? 'Minhas propostas' : 'Propostas') + '</h1></div>' +
      '<div class="np-abas" role="tablist"><button type="button" role="tab" aria-selected="' + (!lista) + '" data-acao="ir" data-arg="propostas">Nova proposta</button><button type="button" role="tab" aria-selected="' + lista + '" data-acao="ir" data-arg="propostas/lista">Minhas propostas</button></div>';
    if (lista) return h + '<p class="nx-sub" style="margin:0">Reabra uma proposta para ajustar e gerar de novo.</p><div id="nx-props">' + girando('Carregando as propostas') + '</div></div>';
    var aviso = !libera('basico') ? '<p class="np-aviso lk" style="margin:0">' + ic('cadeado', 'p') + '<span>Orçamento Básico e Orçamento Completo estão travados. ' + esc(bloq('basico')) + '. <a href="#perfil">Completar o perfil</a>.</span></p>' : '';
    return h + aviso + '<div id="nx-gerar" class="nx-gerar-host"></div><div id="nx-cardd"></div></div>';
  }
  function posPropostas() { if (S.sub === 'lista') carregarPropostas(); else montarGerar(); }
  function ctxBase() {
    var eu = S.eu;
    return {
      parceiro: eu.parceiro, empresa: eu.empresa, nivel: eu.nivel, progresso: eu.progresso, libera: eu.libera, catalogo: eu.catalogo,
      entrega: eu.entrega, financiamento: eu.financiamento, demo: S.demo,
      servicos: eu.servicos || null, bloqueios: bloqueiosCompletos(), saldo_engenharia: saldoEng(), termo: termo(), montagem_aprovada: montagemAprovada(),
      criarLink: criarLink, atualizar: recarregarEu,
      api: ctxApi, evento: function (tipo, dados) { ev(tipo, dados); }, irPara: irPara
    };
  }
  /* bloqueios da API com a reserva local para toda chave travada: quem recebe o ctx nunca fica sem o texto de "libera". */
  function bloqueiosCompletos() {
    var o = {};
    Object.keys(BLOQ_PADRAO).forEach(function (k) { if (!libera(k)) o[k] = bloq(k); });
    var B = (S.eu && S.eu.bloqueios) || {};
    Object.keys(B).forEach(function (k) { if (typeof B[k] === 'string' && B[k]) o[k] = maiuscula(B[k]); });
    return o;
  }
  /* Link da proposta para o cliente final: cria uma vez (POST /propostas/:id/link) e devolve {token, url}. */
  var URL_LINK = 'https://solardoc.app/nexus/p/?t=';
  function urlDoLink(p) { return (p && p.url) || (p && p.link_token ? URL_LINK + p.link_token : ''); }
  function criarLink(propostaId) {
    if (!propostaId) return Promise.reject(new Error('Salve a proposta antes de criar o link.'));
    return api('POST', NX + '/propostas/' + encodeURIComponent(propostaId) + '/link', {}).then(function (r) {
      var d = r.data || {};
      if (r.ok && d.token) {
        var url = d.url || URL_LINK + d.token;
        (S.propostas || []).forEach(function (p) { if (p.id === propostaId) { p.link_token = d.token; p.url = url; if (!p.aberturas) p.aberturas = 0; } });
        ev('criou_link', { proposta: propostaId });
        return { token: d.token, url: url };
      }
      var e = new Error(textoErro(r, 'Não foi possível criar o link da proposta.'));
      e.status = r.status; throw e;
    });
  }
  function ctxGerar() {
    var ini = S.propInicial, c = ctxBase();
    S.propInicial = null;
    propAtual = ini && ini.id ? { id: ini.id, numero: ini.numero } : null;
    S.ultima = null;
    c.propostaInicial = ini || null;
    c.semLista = true; /* a lista Minhas propostas e da casca */
    c.salvarProposta = salvarProposta; c.onGerou = onGerou;
    c.listarPropostas = listarPropostas; c.pedirEquipamento = pedirEquipamento;
    return c;
  }
  function esperarScript(teste, host, rotulo, tentar) {
    host.innerHTML = girando(rotulo);
    var tent = 0;
    esperaScript = setInterval(function () {
      tent++;
      if (!document.body.contains(host)) { clearInterval(esperaScript); esperaScript = null; return; }
      if (teste()) { clearInterval(esperaScript); esperaScript = null; tentar(); return; }
      if (tent >= 16) {
        clearInterval(esperaScript); esperaScript = null;
        host.innerHTML = '<div class="nx-cartao nx-vazio">' + ic('propostas') + '<h2>Esta tela ainda não carregou</h2><p>Atualize a página. Se continuar assim, fale com a gente.</p><button type="button" class="nx-btn" data-acao="repintar">Tentar de novo</button></div>';
      }
    }, 500);
  }
  function montarGerar() {
    var host = $('#nx-gerar');
    if (!host) return;
    if (!window.NexusGerar || typeof window.NexusGerar.montar !== 'function') {
      esperarScript(function () { return window.NexusGerar && typeof window.NexusGerar.montar === 'function'; }, host, 'Carregando o gerador', montarGerar);
      return;
    }
    host.innerHTML = '';
    try { window.NexusGerar.montar(host, ctxGerar()); }
    catch (e) {
      host.innerHTML = '<div class="nx-cartao nx-vazio">' + ic('propostas') + '<h2>Não foi possível abrir o gerador</h2><p>Tente de novo. Se continuar assim, fale com a gente.</p><button type="button" class="nx-btn" data-acao="repintar">Tentar de novo</button></div>';
      if (window.console) console.error('NexusGerar.montar falhou', e);
    }
  }
  function salvarProposta(payload, atual) {
    if (payload && payload.equipamento) S.ultimoEquip = payload.equipamento;
    if (S.demo) return Promise.resolve({ id: 'demo', numero: '20260000' });
    /* 2o argumento do gerador: {id, numero} da proposta em edicao; id null = proposta nova (POST). */
    var id = atual && typeof atual === 'object' && 'id' in atual ? atual.id : (propAtual && propAtual.id);
    if (atual && typeof atual === 'object' && 'id' in atual && !atual.id) propAtual = null;
    return api(id ? 'PUT' : 'POST', NX + '/propostas' + (id ? '/' + encodeURIComponent(id) : ''), payload).then(function (r) {
      if (r.ok && r.data && r.data.id) {
        propAtual = { id: r.data.id, numero: r.data.numero };
        return { id: r.data.id, numero: r.data.numero };
      }
      var cod = r.data && (r.data.erro || r.data.error);
      throw new Error(cod === 'etapa_bloqueada' ? 'Esta saída ainda não está liberada para a sua empresa.' : textoErro(r, 'Não foi possível salvar a proposta.'));
    });
  }
  function onGerou(saida, proposta) {
    S.ultima = { saida: saida, id: proposta && proposta.id, numero: proposta && proposta.numero };
    ev('gerou_' + saida, { numero: S.ultima.numero });
    pix('PropostaNexus');
    pintarCardD();
    if (!S.demo) recarregarEu();
  }
  function listarPropostas() {
    return api('GET', NX + '/propostas').then(function (r) {
      if (r.ok && r.data && Array.isArray(r.data.propostas)) return r.data.propostas;
      var e = new Error(textoErro(r, 'Não foi possível carregar as propostas.')); e.status = r.status; throw e;
    });
  }
  function pedirEquipamento(arg) {
    arg = arg || {};
    if (!libera('pedido')) return Promise.reject(new Error('Disponível para Partner, depois da conversa com o comercial.'));
    var prod = produtoPor(arg.modelo) || produtoPor(arg.modelo_id) || produtos()[0];
    if (!prod) return Promise.reject(new Error('Escolha o modelo do equipamento.'));
    var q = Math.max(1, Math.min(50, Math.round(num(arg.quantidade, 1)) || 1));
    var corpo = { modelo: prod.id, quantidade: q };
    var pid = arg.proposta_id || (arg.numero ? arg.id : '');
    if (pid && pid !== 'demo') corpo.proposta_id = pid;
    if (arg.obs) corpo.obs = String(arg.obs).slice(0, 300);
    return api('POST', NX + '/pedidos', corpo).then(function (r) {
      if (r.ok) { ev('pediu_equipamento', { modelo: prod.id, quantidade: q }); if (!S.demo) recarregarEu(); return { id: r.data && r.data.id }; }
      var cod = r.data && (r.data.erro || r.data.error);
      var e = new Error(cod === 'etapa_bloqueada' ? 'Disponível para Partner, depois da conversa com o comercial.' : textoErro(r, 'Não foi possível enviar o pedido.'));
      e.status = r.status; e.erro = cod || ''; throw e;
    });
  }
  function pintarCardD() {
    var c = $('#nx-cardd');
    if (!c || !S.ultima) return;
    var emp = nomeEmpresa();
    var msg = 'Oi, tudo bem?\nAqui é da ' + emp + ', parceira da NEXUS.\nGerei a proposta ' + (S.ultima.numero || '') + ' no Portal do Parceiro.\nPosso falar com o comercial sobre os próximos passos?';
    var p = S.eu.parceiro || {};
    var eq = S.ultimoEquip || {};
    var pedir = libera('pedido')
      ? '<button type="button" class="nx-btn" data-acao="abrirPedidoD">Pedir equipamento</button>'
      : lk('Pedir equipamento', 'pedido', '');
    c.innerHTML = '<div class="nx-cartao nx-cardd"><h2>Fechou com o cliente?</h2>' +
      '<p>Peça o equipamento ou fale com o comercial da NEXUS.</p>' +
      '<div class="nx-linha-btn">' + pedir +
      '<a class="nx-btn wa" href="' + esc(waLink(msg)) + '" data-acao="clicouWa" rel="noopener">' + ic('conversa', 'p') + 'Falar no WhatsApp</a></div>' +
      (p.conversa_pedida_em ? '' : '<div class="nx-linha-btn" style="margin-top:8px">' + (libera('conversa') ? '<button type="button" class="nx-btn sec" data-acao="conversa">Agendar conversa com o comercial</button>' : lk('Agendar conversa com o comercial', 'conversa')) + '</div>') +
      '<div id="np-pedd"></div></div>';
    c.dataset.modelo = eq.modelo || ''; c.dataset.qtd = eq.quantidade || 1;
    c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function carregarPropostas() {
    var t = S.tela;
    /* Pedidos junto com as propostas: o botão "Pedir equipamento" some quando já existe pedido não cancelado para a proposta.
       Se a lista de pedidos falhar, a lista de propostas aparece do mesmo jeito (sem o aviso de "pedido"). */
    var pedidos = api('GET', NX + '/pedidos').then(function (r) {
      S.pedidos = r.ok && r.data && Array.isArray(r.data.pedidos) ? r.data.pedidos : [];
    }, function () { S.pedidos = []; });
    listarPropostas().then(function (l) { S.propostas = l; S.propErro = false; }, function (e) { S.propostas = null; S.propErro = true; S.erroTexto = e.message; }).then(function () { return pedidos; }).then(function () {
      if (S.tela !== t) return;
      pintarListaPropostas();
    });
  }
  function pedidoDaProposta(id) {
    return (S.pedidos || []).filter(function (x) { return x && x.proposta_id === id && x.status !== 'cancelado'; })[0] || null;
  }
  var SAIDA_ROT = { simulador: 'Simulador em PDF', basico: 'Orçamento Básico', completo: 'Orçamento Completo' };
  /* "hoje, 18h" / "ontem, 18h" / "15/10, 18h30", sempre em horario de Brasilia. */
  function quandoTxt(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    var a = brt(d), b = brt(new Date()), dif = diaSerie(a) - diaSerie(b);
    var dia = dif === 0 ? 'hoje' : dif === -1 ? 'ontem' : p2(a.dia) + '/' + p2(a.mes);
    return dia + ', ' + (a.min ? a.hora + 'h' + p2(a.min) : a.hora + 'h');
  }
  function aberturasTxt(p) {
    var n = Math.max(0, Math.round(num(p.aberturas)));
    if (!n) return 'Ainda não aberta';
    var u = p.ultima_abertura_em ? quandoTxt(p.ultima_abertura_em) : '';
    return 'Aberta ' + (n === 1 ? '1 vez' : n + ' vezes') + (u ? ' · última ' + u : '');
  }
  function linkPropostaHTML(p) {
    var url = urlDoLink(p), id = esc(p.id);
    if (!url) {
      /* A API só cria o link com libera.completo (403 etapa_bloqueada): sem ele, cadeado com o texto de bloqueios.completo. */
      if (!libera('completo')) {
        return '<div class="np-link"><span class="np-rot">Link para o cliente</span><p class="st">Link ainda não criado</p>' +
          '<div class="nx-linha-btn">' + lk('Criar link', 'completo') + '</div></div>';
      }
      return '<div class="np-link"><span class="np-rot">Link para o cliente</span><p class="st">Link ainda não criado</p>' +
        '<div class="nx-linha-btn"><button type="button" class="nx-btn sec" data-acao="criarLinkProp" data-arg="' + id + '">' + ic('link', 'p') + 'Criar link</button></div></div>';
    }
    var wa = 'https://wa.me/?text=' + encodeURIComponent('Segue a proposta de eletroposto: ' + url);
    return '<div class="np-link"><span class="np-rot">Link para o cliente</span><p class="st">' + esc(aberturasTxt(p)) + '</p><p class="url">' + esc(url) + '</p>' +
      '<div class="nx-linha-btn"><button type="button" class="nx-btn sec" data-acao="copiarLinkProp" data-arg="' + id + '">' + ic('copiar', 'p') + 'Copiar link</button>' +
      '<a class="nx-btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener" data-acao="enviouLink" data-arg="' + id + '">' + ic('conversa', 'p') + 'Enviar no WhatsApp</a></div></div>';
  }
  function pintarListaPropostas() {
    var c = $('#nx-props');
    if (!c) return;
    if (S.propErro) { c.innerHTML = '<div class="nx-cartao nx-vazio">' + ic('propostas') + '<h2>Não foi possível carregar</h2><p>' + esc(S.erroTexto) + '</p><button type="button" class="nx-btn" data-acao="recarregarProps">Tentar de novo</button></div>'; return; }
    var l = S.propostas || [];
    if (!l.length) {
      c.innerHTML = '<div class="nx-cartao nx-vazio">' + ic('propostas') + '<h2>Você ainda não gerou propostas</h2><p>Gere o Simulador, o Orçamento Básico ou o Orçamento Completo com o logo da sua empresa ao lado da NEXUS.</p><button type="button" class="nx-btn" data-acao="ir" data-arg="propostas">Gerar proposta</button></div>';
      return;
    }
    c.innerHTML = '<div class="np-lista-prop">' + l.map(function (p) {
      var local = [p.cliente_cidade, p.cliente_uf].filter(Boolean).join('/');
      return '<article class="np-prop"><div class="topo"><div><span class="num">Proposta ' + esc(p.numero) + '</span><p class="cli">' + esc(p.cliente_nome || 'Cliente sem nome') + '</p></div></div>' +
        '<p class="lin">' + esc(local || 'Local não informado') + '</p>' +
        '<p class="lin">' + esc((p.quantidade || 1) + 'x ' + (p.modelo || 'Modelo não informado')) + ' · ' + esc(SAIDA_ROT[p.saida_ultima] || '') + '</p>' +
        '<p class="lin">' + esc(dataBR(p.created_at)) + '</p><p class="val">' + esc(rs(p.valor_total, 2)) + '</p>' +
        linkPropostaHTML(p) +
        '<div class="nx-linha-btn"><button type="button" class="nx-btn sec" data-acao="reabrir" data-arg="' + esc(p.id) + '">Reabrir</button>' +
        (pedidoDaProposta(p.id)
          ? '<button type="button" class="nx-btn" disabled aria-disabled="true">Equipamento pedido</button>'
          : (libera('pedido') ? '<button type="button" class="nx-btn" data-acao="abrirPedidoProp" data-arg="' + esc(p.id) + '">Pedir equipamento</button>' : lk('Pedir equipamento', 'pedido', ''))) + '</div>' +
        '<div class="pedir" id="pw-' + esc(p.id) + '" hidden></div></article>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ Rede (E5): oportunidades, usinas, engenharia */
  function telaRede(tela) { return '<div class="np-pagina" id="np-rede-' + esc(tela) + '"><div id="np-rede">' + girando('Carregando') + '</div></div>'; }
  function montarRede(tela) {
    var host = $('#np-rede');
    if (!host) return;
    if (!window.NexusRede || typeof window.NexusRede.montar !== 'function') {
      esperarScript(function () { return window.NexusRede && typeof window.NexusRede.montar === 'function'; }, host, 'Carregando', function () { montarRede(tela); });
      return;
    }
    host.innerHTML = '';
    try { window.NexusRede.montar(host, tela, ctxBase()); }
    catch (e) {
      host.innerHTML = '<div class="nx-cartao nx-vazio">' + ic(tela) + '<h2>Não foi possível abrir esta tela</h2><p>Tente de novo. Se continuar assim, fale com a gente.</p><button type="button" class="nx-btn" data-acao="repintar">Tentar de novo</button></div>';
      if (window.console) console.error('NexusRede.montar falhou', e);
    }
  }

  /* ------------------------------------------------------------------ Materiais */
  var MATERIAIS = [
    ['dc-frente-limpo', 'Carregador de frente'], ['dc-3q-dir', 'Carregador em três quartos, lado direito'], ['dc-3q-esq', 'Carregador em três quartos, lado esquerdo'],
    ['dc-lateral', 'Carregador de lado'], ['dc-perspectiva', 'Carregador em perspectiva'], ['dc-traseira', 'Carregador por trás'],
    ['equipamento', 'Equipamento'], ['fabrica-linha', 'Linha de produção da fábrica'], ['fabrica-nexus-16x9', 'Fábrica NEXUS'],
    ['posto-noite', 'Posto de recarga à noite'], ['plataforma-app', 'Aplicativo da plataforma'], ['plataforma-painel', 'Painel da plataforma']
  ];
  function telaMateriais() {
    var h = '<div class="np-pagina"><section class="np-sec"><div><h1 class="nx-h1">Materiais</h1><p class="nx-sub" style="margin:0">Fotos do equipamento e da fábrica para você usar na divulgação.</p></div><div class="nx-mat-grade">';
    MATERIAIS.forEach(function (m) {
      h += '<div class="nx-mat"><img loading="lazy" src="/nexus/img/' + m[0] + '.webp" alt="' + esc(m[1]) + '"><div class="nx-mat-c"><b>' + esc(m[1]) + '</b>' +
        '<a class="nx-btn sec" href="/nexus/img/' + m[0] + '.webp" download="NEXUS-' + m[0] + '.webp" data-acao="baixouMaterial" data-arg="' + m[0] + '">' + ic('baixar', 'p') + 'Baixar</a></div></div>';
    });
    ['Ficha técnica', 'Catálogo'].forEach(function (t) { h += '<div class="nx-mat breve"><b>' + t + '</b><span class="nx-chip cz" style="align-self:flex-start">Em breve</span></div>'; });
    return h + '</div><div class="nx-cartao"><h2>Vitrine da NEXUS</h2><p style="margin-bottom:12px">A página pública que você pode mostrar aos seus clientes.</p><a class="nx-btn sec" href="/nexus" target="_blank" rel="noopener">Abrir a vitrine</a></div></section></div>';
  }

  /* ------------------------------------------------------------------ Serviços NEXUS */
  var PACOTES = [3, 5, 10];
  var ESCOPO_PROJETO = ['Projeto elétrico do eletroposto', 'ART do projeto', 'Pedido de acesso e acompanhamento da homologação na distribuidora', 'Estudo da entrada de energia'];
  var ESCOPO_CONSULTORIA = ['Especialista NEXUS na reunião com o seu cliente (online)', 'Revisão da proposta antes de enviar', 'Análise do ponto: entrada de energia, fluxo e potência indicada'];
  var PLAT_O_QUE_E = 'Cuida da cobrança de cada recarga, do monitoramento do carregador, dos relatórios e do app do motorista. O ponto paga 10% do que fatura em recarga.';
  var PLAT_PARA_VOCE = 'Você revende a plataforma e recebe parte dos 10% todo mês, enquanto o ponto operar.';
  var STATUS_PED = { solicitado: ['Solicitado', 'cz'], negociando: ['Em negociação', 'av'], confirmado: ['Confirmado', 'az'], cancelado: ['Cancelado', 'er'] };
  function servApi(id) {
    var L = S.eu && S.eu.servicos, r = null;
    if (Array.isArray(L)) L.forEach(function (x) { if (x && x.id === id) r = x; });
    else if (L && typeof L === 'object') r = L[id] || null;
    return r || {};
  }
  function servNome(id, padrao) { var n = servApi(id).nome; return typeof n === 'string' && n ? n : padrao; }
  function servEscopo(id, padrao) { var e = servApi(id).escopo; return Array.isArray(e) && e.length ? e.map(String) : padrao; }
  function servPreco(id, padrao) { var p = servApi(id).preco; return typeof p === 'string' && p ? p : padrao; }
  function nomePacote(n) { return servNome('eng-' + n, 'Pacote de engenharia · ' + n + ' projetos'); }
  function listaChecks(itens) { return '<ul class="np-checks">' + itens.map(function (t) { return '<li>' + ic('check') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul>'; }
  function precoParceiro(id, rotulo, padrao) {
    return '<div class="np-parc"><span class="np-rot">' + esc(rotulo) + '</span><strong>' + esc(servPreco(id, padrao)) + '</strong></div>';
  }
  function chipTravado(chave) { return libera(chave) ? '' : '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>'; }

  function telaServicos() {
    var sd = saldoEng(), h = '<div class="np-pagina">';
    h += '<section class="np-sec"><div><h1 class="nx-h1">Serviços NEXUS</h1><p class="nx-sub" style="max-width:720px;margin:0">Engenharia em pacotes, consultoria de vendas e a Plataforma NEXUS. Você usa com os seus clientes e a NEXUS entrega.</p></div></section>';

    /* Engenharia em pacotes */
    h += '<section class="np-sec" id="sv-eng"><div class="np-tit-grupo"><h2>Engenharia em pacotes</h2>' + chipTravado('pacotes_engenharia') + '</div>' +
      '<p class="nx-sub" style="margin:0;max-width:720px">Compre projetos de 3 em 3, de 5 em 5 ou de 10 em 10 e use o saldo obra a obra, nos pontos dos seus clientes.</p>' +
      '<div class="np-card"><h3>Cada projeto inclui</h3>' + listaChecks(servEscopo('eng-3', ESCOPO_PROJETO)) + '</div>';
    if (sd) {
      h += '<div class="np-card"><h3>Seu saldo de engenharia</h3><div class="np-saldo">' +
        '<div class="np-num"><strong>' + esc(fmt(sd.comprados)) + '</strong><span>Projetos comprados</span></div>' +
        '<div class="np-num"><strong>' + esc(fmt(sd.usados)) + '</strong><span>Projetos usados</span></div>' +
        '<div class="np-num"><strong class="az">' + esc(fmt(sd.disponiveis)) + '</strong><span>Projetos disponíveis</span></div></div>' +
        (sd.disponiveis > 0 ? '<div><button type="button" class="nx-btn" data-acao="ir" data-arg="engenharia">Usar um projeto do pacote</button></div>'
          : '<p class="nx-dica">Sem saldo agora. Compre um pacote abaixo para usar nos próximos pontos.</p>') + '</div>';
    } else {
      h += '<div class="np-vazio-sec">Saldo disponível depois da primeira compra de pacote.</div>';
    }
    h += '<div class="np-pacotes">' + PACOTES.map(function (n) {
      var acao;
      if (!libera('pacotes_engenharia')) acao = lk('Comprar pacote', 'pacotes_engenharia', '');
      else if (S.confirmaPacote === n) {
        acao = '<p class="np-confirma">Enviar o pedido do pacote de ' + n + ' projetos ao comercial?</p><div class="nx-linha-btn"><button type="button" class="nx-btn" data-acao="enviarPacote" data-arg="' + n + '">Enviar pedido</button>' +
          '<button type="button" class="nx-btn sec" data-acao="cancelarPacote">Cancelar</button></div>';
      } else acao = '<button type="button" class="nx-btn" data-acao="pedirPacote" data-arg="' + n + '">Comprar pacote</button>';
      return '<article class="np-pacote"><div><span class="np-rot">' + n + ' projetos</span><h3>' + esc(nomePacote(n)) + '</h3></div>' +
        precoParceiro('eng-' + n, 'Preço de parceiro', 'Negociado com o comercial') + acao + '</article>';
    }).join('') + '</div></section>';

    /* Consultoria de vendas */
    var acaoC;
    if (!libera('consultoria')) acaoC = lk('Pedir consultoria', 'consultoria', '');
    else if (S.consultoriaAberta) {
      acaoC = '<div class="np-form-inline" id="sv-cons"><div class="nx-campo"><label for="sv-cons-obs">O que você quer tratar (opcional)</label><textarea id="sv-cons-obs" maxlength="300"></textarea></div>' +
        '<p class="nx-msg-erro" data-erro hidden></p><div class="nx-linha-btn"><button type="button" class="nx-btn" data-acao="enviarConsultoria">Enviar pedido</button>' +
        '<button type="button" class="nx-btn sec" data-acao="cancelarConsultoria">Cancelar</button></div></div>';
    } else acaoC = '<button type="button" class="nx-btn" data-acao="pedirConsultoria">Pedir consultoria</button>';
    h += '<section class="np-sec" id="sv-cons-sec"><div class="np-tit-grupo"><h2>' + esc(servNome('consultoria', 'Consultoria de vendas NEXUS')) + '</h2>' + chipTravado('consultoria') + '</div>' +
      '<div class="np-card"><div class="np-tit-grupo"><h3>O que está incluído</h3><span class="nx-chip az">Por atendimento</span></div>' +
      listaChecks(servEscopo('consultoria', ESCOPO_CONSULTORIA)) + precoParceiro('consultoria', 'Preço de parceiro', 'Negociado com o comercial') + acaoC + '</div></section>';

    /* Plataforma NEXUS */
    var acaoP;
    if (!libera('plataforma')) acaoP = lk('Quero revender a plataforma', 'plataforma', '');
    else if (S.plataformaPedida) acaoP = '<span class="nx-chip az">Pedido enviado ao comercial</span>';
    else acaoP = '<button type="button" class="nx-btn" data-acao="querPlataforma">Quero revender a plataforma</button>';
    h += '<section class="np-sec" id="sv-plat"><div class="np-tit-grupo"><h2>' + esc(servNome('plataforma', 'Plataforma NEXUS de gestão')) + '</h2>' + chipTravado('plataforma') + '</div>' +
      '<div class="np-card"><h3>O que é</h3><p>' + esc(PLAT_O_QUE_E) + '</p><h3>Para você</h3><p>' + esc(PLAT_PARA_VOCE) + '</p>' +
      precoParceiro('plataforma', 'Sua parte', 'Negociada com o comercial') + acaoP + '</div></section>';

    /* Pedidos */
    h += '<section class="np-sec"><h2>Seus pedidos de serviços</h2><div id="sv-pedidos">' + girando('Carregando os pedidos') + '</div></section>';
    return h + '</div>';
  }
  function posServicos() { carregarPedidosServ(); }
  function carregarPedidosServ() {
    var t = S.tela;
    api('GET', NX + '/pedidos', undefined, { quieto: true }).then(function (r) {
      if (S.tela !== t) return;
      if (r.ok && r.data && Array.isArray(r.data.pedidos)) {
        S.pedidosServ = r.data.pedidos.filter(function (x) { return x && (x.tipo === 'engenharia' || x.tipo === 'consultoria'); });
        S.pedidosServErro = false;
      } else { S.pedidosServ = null; S.pedidosServErro = true; }
      pintarPedidosServ();
    });
  }
  function pintarPedidosServ() {
    var el = $('#sv-pedidos');
    if (!el) return;
    if (S.pedidosServErro) { el.innerHTML = secErro('Não foi possível carregar os pedidos agora.', 'recarregarPedidosServ'); return; }
    var l = S.pedidosServ || [];
    if (!l.length) { el.innerHTML = '<div class="np-vazio-sec">Nenhum pedido de serviço ainda. Quando você comprar um pacote ou pedir uma consultoria, ele aparece aqui com o andamento.</div>'; return; }
    el.innerHTML = '<ul class="np-pedidos">' + l.map(function (x) {
      var st = STATUS_PED[x.status] || [String(x.status || 'Solicitado'), 'cz'];
      var nome = x.tipo === 'engenharia' ? nomePacote(num(x.pacote)) : servNome('consultoria', 'Consultoria de vendas NEXUS');
      return '<li><div><b>' + esc(nome) + '</b><small>' + esc(dataBR(x.created_at)) + '</small></div><span class="nx-chip ' + esc(st[1]) + '">' + esc(st[0]) + '</span></li>';
    }).join('') + '</ul>';
  }
  function postPedidoServ(corpo, btn, msgOk, tipoEv) {
    ocupado(btn, true, 'Enviando');
    api('POST', NX + '/pedidos', corpo).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok) {
        ev(tipoEv, { pacote: corpo.pacote || null });
        toast(msgOk);
        S.confirmaPacote = 0; S.consultoriaAberta = false;
        pintarMain(true);
        if (!S.demo) recarregarEu();
        return;
      }
      var cod = r.data && (r.data.erro || r.data.error);
      var c = $('#sv-cons');
      var msg = cod === 'etapa_bloqueada' ? bloq(corpo.tipo === 'engenharia' ? 'pacotes_engenharia' : 'consultoria') : textoErro(r, 'Não foi possível enviar o pedido.');
      if (c) erroForm(c, msg); else toast(msg, true);
    });
  }
  function querPlataforma(btn) {
    ocupado(btn, true, 'Enviando');
    api('POST', NX + '/solicitacoes', { tipo: 'plataforma', dados: {} }).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok) { ev('pediu_plataforma'); S.plataformaPedida = true; toast('Pedido enviado. O comercial da NEXUS fala com você.'); pintarMain(true); }
      else toast(textoErro(r, 'Não foi possível enviar o pedido.'), true);
    });
  }

  /* ------------------------------------------------------------------ Minha parceria */
  var NIVEIS = [
    { k: 'cadastrado', n: 'Nível 1', nome: 'Cadastrado', como: 'Grátis, com CNPJ ativo.', libera: ['Informação de mercado e da sua região', 'Simulador em PDF', 'Orçamentos, Materiais e engenharia avulsa, com o perfil completo'] },
    { k: 'partner', n: 'Nível 2', nome: 'Partner', como: 'Depois da conversa com o comercial.', libera: ['Preço de parceiro e pedido de equipamento', 'Pacotes de engenharia de 3, 5 e 10 projetos', 'Consultoria de vendas', 'Selo Parceiro NEXUS'] },
    { k: 'pro', n: 'Nível 3', nome: 'Partner Pro', como: 'A partir da primeira compra de carregador.', libera: ['Termo de Parceria', 'Oportunidades: clientes da sua região, depois de aceitar o termo', 'Revenda da Plataforma NEXUS'] },
    { k: 'master', n: 'Nível 4', nome: 'Partner Master', como: 'A partir de 5 carregadores comprados.', libera: ['Prioridade nas oportunidades da sua região'] }
  ];
  var ENTREGA_NEXUS = ['Equipamento com preço de parceiro', 'Clientes e obras da sua região', 'Engenharia quando você precisar', 'Simulador, propostas e materiais com a sua marca', 'Peça de reposição e suporte no país'];
  var ENTREGA_VOCE = ['Compra o equipamento da NEXUS', 'Atende o cliente encaminhado no prazo', 'Dá baixa de cada oportunidade', 'Opera o ponto pela plataforma de cobrança NEXUS por 24 meses'];
  if (MOSTRAR_USINAS) ENTREGA_VOCE.push('Indica usinas');
  function passosCaminho() {
    var p = S.eu.parceiro || {}, comprados = num(p.carregadores_comprados), L = [];
    L.push({ nome: 'Perfil completo', feito: libera('basico'), acao: libera('basico') ? '' : '<button type="button" class="nx-btn" data-acao="ir" data-arg="perfil">Completar o perfil</button>' });
    L.push({ nome: 'Primeira proposta gerada', feito: !!p.primeira_proposta_em, acao: p.primeira_proposta_em ? '' : (libera('basico') ? '<button type="button" class="nx-btn" data-acao="ir" data-arg="propostas">Gerar proposta</button>' : ''), sub: libera('basico') ? '' : 'Complete o perfil para gerar propostas.' });
    var conv = { nome: 'Conversa com o comercial', feito: !!p.conversa_feita_em };
    if (!conv.feito) {
      if (p.conversa_pedida_em) conv.sub = 'Conversa pedida. A equipe NEXUS marca este passo depois que ela acontecer.';
      else if (libera('conversa')) conv.acao = '<button type="button" class="nx-btn" data-acao="conversa">Agendar conversa com o comercial</button><a class="nx-btn sec" href="' + esc(waLink('Oi, tudo bem?\nAqui é da ' + nomeEmpresa() + ', parceira da NEXUS.\nPosso falar com o comercial sobre os próximos passos?')) + '" data-acao="clicouWa" rel="noopener">Falar no WhatsApp</a>';
      else { conv.sub = bloq('conversa'); conv.trav = true; }
    }
    L.push(conv);
    L.push({ nome: 'Partner aprovado pela equipe NEXUS', feito: !!p.partner_em, sub: p.partner_em ? '' : 'A equipe NEXUS aprova depois da conversa.' });
    var compra = { nome: 'Primeira compra de carregador', feito: comprados >= 1 };
    if (!compra.feito) {
      if (libera('pedido')) compra.acao = '<button type="button" class="nx-btn sec" data-acao="ir" data-arg="equipamentos">Pedir equipamento</button>';
      else { compra.sub = bloq('pedido'); compra.trav = true; }
    }
    L.push(compra);
    var t = termo(), tm = { nome: 'Termo de Parceria aceito', feito: !!t.aceito_em };
    if (!tm.feito) {
      if (libera('termo')) tm.acao = '<a class="nx-btn" href="#parceria" data-acao="irTermo">Ler e aceitar o termo</a>';
      else { tm.sub = bloq('termo'); tm.trav = true; }
    }
    L.push(tm);
    return L;
  }
  function seloMontagemHTML() {
    var p = S.eu.parceiro || {}, ok = montagemAprovada();
    var h = '<article class="np-nivel np-selomont' + (ok ? '' : ' trav') + '"><div><div class="topo"><span class="np-rot">Selo à parte</span>' +
      (ok ? '<span class="nx-chip az">' + ic('check', 'p') + 'Aprovada</span>' : '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Pendente</span>') + '</div>' +
      '<h2>Montagem e Engenharia aprovada</h2><p class="como">' + (ok ? 'A equipe NEXUS aprovou a montagem da sua empresa.' : 'A equipe NEXUS aprova a montagem da sua empresa. Não depende do nível.') + '</p></div>' +
      '<div class="libera"><b>' + (ok ? 'Libera' : 'Libera quando for aprovada') + '</b><ul class="np-checks' + (ok ? '' : ' trv') + '"><li>' + ic(ok ? 'check' : 'cadeado') + '<span>Obras terceirizadas NEXUS na sua região, nas Oportunidades</span></li></ul></div>';
    if (!ok && !p.papel_montagem) h += '<div><button type="button" class="nx-btn sec" data-acao="ir" data-arg="perfil">Marcar Montagem e Engenharia no perfil</button></div>';
    return h + '</article>';
  }
  function telaParceria() {
    var nv = nivel(), p = S.eu.parceiro || {}, comprados = num(p.carregadores_comprados), atualIdx = NIVEL_IDX[nv] || 1;
    var h = '<div class="np-pagina"><section class="np-sec"><h1 class="nx-h1" style="margin:0">Minha parceria</h1><div class="np-niveis">';
    NIVEIS.forEach(function (n) {
      var at = n.k === nv, trv = NIVEL_IDX[n.k] > atualIdx;
      h += '<article class="np-nivel' + (at ? ' atual' : '') + (trv ? ' trav' : '') + '"' + (at ? ' aria-label="' + esc(n.nome) + ', seu nível atual"' : '') + '><div><div class="topo"><span class="np-rot">' + esc(n.n) + '</span>' +
        (at ? '<span class="np-selo-chip">Seu nível</span>' : (trv ? '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>' : '<span class="nx-chip az">' + ic('check', 'p') + 'Alcançado</span>')) + '</div>' +
        '<h2>' + esc(n.nome) + '</h2><p class="como">' + esc(n.como) + '</p></div><div class="libera"><b>' + (trv ? 'Libera ao chegar aqui' : 'Libera') + '</b><ul class="np-checks' + (trv ? ' trv' : '') + '">' +
        n.libera.map(function (t) { return '<li>' + ic(trv ? 'cadeado' : 'check') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div></article>';
    });
    h += '</div>' + seloMontagemHTML() + '</section>';
    h += '<section class="np-sec"><h2>Seu caminho</h2><ul class="np-caminho">';
    passosCaminho().forEach(function (s) {
      h += '<li class="np-passo' + (s.feito ? ' feito' : '') + (s.trav ? ' trav' : '') + '"><span class="bola">' + (s.feito ? ic('check') : (s.trav ? ic('cadeado') : '')) + '</span><span class="nm">' + esc(s.nome) + (s.sub ? '<small>' + esc(s.sub) + '</small>' : '') + '</span>' +
        (s.feito ? '<span class="st">Feito</span>' : (s.acao ? '<span class="lado">' + s.acao + '</span>' : '')) + '</li>';
    });
    var meta = Math.min(comprados, 5);
    h += '<li class="np-passo' + (comprados >= 5 ? ' feito' : '') + '"><span class="bola">' + (comprados >= 5 ? ic('check') : '') + '</span><span class="nm">Carregadores para Master: ' + meta + ' de 5</span>' +
      (comprados >= 5 ? '<span class="st">Feito</span>' : '<div class="mini"><span>Faltam ' + (5 - meta) + (5 - meta === 1 ? ' carregador' : ' carregadores') + '</span><div class="np-barra" role="img" aria-label="Carregadores para Master: ' + meta + ' de 5"><i style="width:' + (meta * 20) + '%"></i></div></div>') + '</li></ul></section>';
    h += termoSecaoHTML();
    h += '<section class="np-sec"><h2>O acordo ganha-ganha</h2><div class="np-acordo"><div class="np-card"><h3>A NEXUS entrega</h3><ul>' +
      ENTREGA_NEXUS.map(function (t) { return '<li>' + ic('check') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div><div class="np-card voce"><h3>Você entrega</h3><ul>' +
      ENTREGA_VOCE.map(function (t) { return '<li>' + ic('check') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div></div></section>';
    h += '<section class="np-faixa"><div><p class="a">Somos importadores, não concorrentes.</p><p class="b">Nada é cobrado sobre a sua obra. Sem mensalidade. Sem taxa de entrada.</p></div><img src="/gerador/nexus-logo-tela.png" alt="NEXUS Eletropostos"></section>';
    h += '<section class="np-sec"><h2>Selo do parceiro</h2>';
    if (libera('selo')) {
      var chaves = legendasDoParceiro();
      h += '<div class="np-card"><div class="np-selo-bloco"><div class="tela"><canvas id="nx-selo" class="nx-selo-tela" width="1080" height="1080" role="img" aria-label="Selo Parceiro Credenciado NEXUS, Energia que move o amanhã"></canvas></div>' +
        '<div class="acao"><p style="font-size:15px;color:var(--nx-tx2)">Baixe o selo e use nas suas redes e nos seus materiais.</p><button type="button" class="nx-btn lg" data-acao="baixarSelo">' + ic('baixar', 'p') + 'Baixar selo em PNG</button></div></div></div>';
      chaves.forEach(function (k) {
        h += '<div class="np-card"><h3>Legenda · ' + (k === 'revenda' ? 'Revenda' : 'Montagem e Engenharia') + '</h3><div class="nx-legenda">' + esc(LEGENDA[k]) + '</div><div><button type="button" class="nx-btn sec" data-acao="copiarLegenda" data-arg="' + k + '">Copiar legenda</button></div></div>';
      });
    } else {
      h += '<div class="np-card"><div class="np-selo-bloco"><div class="tela"><div style="background:var(--nx-navy);border-radius:16px;max-width:360px;padding:28px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center"><img src="/gerador/nexus-logo-tela.png" alt="" style="width:150px;height:auto"><span style="display:block;width:48px;height:3px;border-radius:3px;background:var(--nx-verde)"></span><span style="font-size:18px;font-weight:800;color:#fff;line-height:1.25">Parceiro Credenciado NEXUS</span><span style="font-size:12px;font-weight:500;color:var(--nx-inv2)">Energia que move o amanhã</span></div></div>' +
        '<div class="acao"><p style="font-size:15px;color:var(--nx-tx2)">Prévia do selo. O download fica travado até você virar Partner.</p>' + lk('Baixar selo', 'selo', '') + '</div></div></div>';
    }
    return h + '</section></div>';
  }
  function posParceria() {
    if (libera('selo')) desenharSelo();
    if (libera('termo')) carregarTermo();
    if (S.irTermo) { S.irTermo = false; var tm = $('#np-termo'); if (tm) tm.scrollIntoView({ block: 'start' }); }
  }

  /* Termo de Parceria: o texto vive em dados/termo-parceria-v1.html (escrito pelo especialista em contratos). */
  function termoSecaoHTML() {
    var t = termo(), aceito = !!t.aceito_em;
    var h = '<section class="np-sec" id="np-termo"><div class="np-tit-grupo"><h2>Termo de Parceria</h2>' +
      (aceito ? '<span class="nx-chip az" id="np-termo-chip">Aceito em ' + esc(dataBR(t.aceito_em)) + '</span>' : (libera('termo') ? '' : '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>')) + '</div>';
    if (!libera('termo')) {
      h += '<div class="np-card np-termo-trava"><span class="ico">' + ic('termo') + '</span><div><h3>Termo de Parceria NEXUS</h3>' +
        '<p>As regras da parceria entre a NEXUS e a sua empresa. Você lê e aceita por aqui.</p>' + lkNota('termo') + lk('Ler e aceitar o termo', 'termo', '') + '</div></div>';
    } else h += '<div id="np-termo-corpo">' + girando('Carregando o termo') + '</div>';
    return h + '</section>';
  }
  function urlTermo() { var v = termo().versao; return '/nexus/app/dados/termo-parceria-' + (/^v\d+$/.test(v) ? v : 'v1') + '.html'; }
  function carregarTermo() {
    if (S.termoTxt !== undefined && !S.termoErro) { pintarTermoCorpo(); return; }
    S.termoErro = false; S.termoTxt = undefined; pintarTermoCorpo();
    fetch(urlTermo(), { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404 || r.status === 410) return null;
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    }).then(function (tx) {
      /* servidor com fallback devolve o index do portal com 200: isso nao e o termo */
      if (tx != null && (tx.length < 40 || tx.indexOf('id="nx-root"') >= 0)) tx = null;
      S.termoTxt = tx; S.termoErro = false;
      pintarTermoCorpo();
    }).catch(function () { S.termoErro = true; S.termoTxt = undefined; pintarTermoCorpo(); });
  }
  /* Preenche {{empresa}}, {{cnpj}}, {{cidade_uf}} e {{data}} com o valor escapado e limpa o que for script. */
  function termoHTML() {
    var e = S.eu.empresa || {}, p = S.eu.parceiro || {}, t = termo();
    var dados = {
      empresa: e.nome || p.empresa || nomeEmpresa() || 'Empresa',
      cnpj: e.cnpj ? fmtCnpj(e.cnpj) : 'CNPJ não informado',
      cidade_uf: localParceiro() || 'Cidade não informada',
      data: dataBR(t.aceito_em || new Date().toISOString())
    };
    var txt = String(S.termoTxt).replace(/\{\{\s*(empresa|cnpj|cidade_uf|data)\s*\}\}/g, function (_, k) { return esc(dados[k]); });
    var doc = new DOMParser().parseFromString(txt, 'text/html');
    $$('script,iframe,object,embed,link,style,base,meta,form', doc).forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
    $$('*', doc.body).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      });
    });
    return doc.body.innerHTML;
  }
  function pintarTermoCorpo() {
    var el = $('#np-termo-corpo');
    if (!el) return;
    if (S.termoErro) { el.innerHTML = secErro('Não foi possível carregar o termo agora.', 'recarregarTermo'); return; }
    if (S.termoTxt === undefined) { el.innerHTML = girando('Carregando o termo'); return; }
    if (S.termoTxt === null) {
      el.innerHTML = '<div class="np-vazio-sec"><b>Termo em preparação</b><br>O Termo de Parceria está sendo finalizado pela NEXUS. Assim que ele estiver pronto, você lê e aceita por aqui.</div>';
      return;
    }
    var t = termo(), aceito = !!t.aceito_em;
    var h = '<div class="np-card np-termo"><div class="np-termo-doc" id="np-termo-doc" tabindex="0" aria-label="Texto do Termo de Parceria">' + termoHTML() + '</div>';
    if (aceito) {
      h += '<div class="np-termo-acoes"><span class="nx-chip az">' + ic('check', 'p') + 'Aceito em ' + esc(dataBR(t.aceito_em)) + '</span>' +
        '<button type="button" class="nx-btn sec" data-acao="imprimirTermo">' + ic('imprimir', 'p') + 'Imprimir ou salvar em PDF</button></div>';
    } else {
      h += '<div class="np-termo-acoes">' + (S.termoMsg ? '<p class="nx-msg-erro" role="alert" style="flex:1 1 100%;margin:0">' + esc(S.termoMsg) + '</p>' : '') +
        '<p class="nx-dica" style="flex:1 1 240px;margin:0">Leia o termo inteiro antes de aceitar. O aceite fica registrado com a data de hoje.</p>' +
        '<button type="button" class="nx-btn" data-acao="aceitarTermo">Li e aceito</button></div>';
    }
    el.innerHTML = h + '</div>';
  }
  function aceitarTermo(btn) {
    var t = termo();
    S.termoMsg = '';
    ocupado(btn, true, 'Registrando');
    api('POST', NX + '/termo/aceitar', { versao: t.versao }).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      var d = r.data || {};
      if (r.ok) {
        S.eu.termo = Object.assign({}, S.eu.termo || {}, { versao: t.versao, disponivel: true, aceito_em: d.termo_aceito_em || d.aceito_em || new Date().toISOString() });
        ev('aceitou_termo', { versao: t.versao });
        toast('Termo aceito. Obrigado pela parceria.');
        pintarMain(true);
        if (!S.demo) recarregarEu();
        return;
      }
      var cod = d.erro || d.error;
      S.termoMsg = cod === 'etapa_bloqueada' ? bloq('termo') : textoErro(r, 'Não foi possível registrar o aceite. Tente de novo.');
      pintarTermoCorpo();
    });
  }
  function imprimirTermo() {
    var doc = $('#np-termo-doc');
    if (!doc) return;
    var antigo = $('#np-termo-print');
    if (antigo) antigo.remove();
    var c = document.createElement('div');
    c.id = 'np-termo-print';
    var t = termo();
    c.innerHTML = '<div class="cab"><img src="/gerador/nexus-logo-papel.png" alt="NEXUS Eletropostos"></div><div class="np-termo-doc">' + doc.innerHTML + '</div>' +
      (t.aceito_em ? '<p class="aceite">Aceito em ' + esc(dataBR(t.aceito_em)) + ' por ' + esc(nomeEmpresa()) + '.</p>' : '');
    document.body.appendChild(c);
    var titulo = document.title;
    document.title = 'Termo-de-Parceria-NEXUS-' + slug(nomeEmpresa());
    document.body.classList.add('np-print-termo');
    var fim = function () {
      window.removeEventListener('afterprint', fim);
      document.body.classList.remove('np-print-termo');
      document.title = titulo;
      var x = $('#np-termo-print'); if (x) x.remove();
    };
    window.addEventListener('afterprint', fim);
    setTimeout(function () { try { window.print(); } catch (e) { fim(); } }, 80);
  }
  var LEGENDA = {
    revenda: 'Agora somos Parceiro Credenciado NEXUS Eletropostos.\nCarregadores rápidos para quem quer entrar na mobilidade elétrica, com a nossa proposta e o nosso atendimento.\nFale com a gente.\n#NEXUSEletropostos',
    montagem: 'Agora somos Parceiro Credenciado NEXUS Eletropostos.\nInstalação elétrica, engenharia, obra civil e homologação de eletropostos na nossa região.\nFale com a gente.\n#NEXUSEletropostos'
  };
  function legendasDoParceiro() {
    var p = S.eu.parceiro || {}, c = [];
    if (p.papel_revenda) c.push('revenda');
    if (p.papel_montagem) c.push('montagem');
    return c.length ? c : ['revenda', 'montagem'];
  }
  function carregarImg(src) {
    return new Promise(function (ok, falha) {
      var im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { falha(new Error('imagem')); };
      im.src = src;
    });
  }
  function quebrar(ctx, texto, larg) {
    var palavras = String(texto).split(/\s+/), linhas = [], atual = '';
    palavras.forEach(function (w) {
      var t = atual ? atual + ' ' + w : w;
      if (ctx.measureText(t).width <= larg || !atual) atual = t; else { linhas.push(atual); atual = w; }
    });
    if (atual) linhas.push(atual);
    return linhas;
  }
  function desenharSelo() {
    var cv = $('#nx-selo');
    if (!cv) return;
    var nome = nomeEmpresa() || 'Sua empresa';
    var fontes = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('800 56px Montserrat'), document.fonts.load('700 56px Montserrat'), document.fonts.load('600 40px Montserrat')]).catch(function () { return null; }) : Promise.resolve();
    Promise.all([carregarImg('/gerador/nexus-logo-tela.png').catch(function () { return null; }), fontes]).then(function (rs_) {
      if (!$('#nx-selo')) return;
      var x = cv.getContext('2d'), W = 1080, logo = rs_[0], F = "'Montserrat', system-ui, sans-serif";
      var g = x.createLinearGradient(0, 0, 0, W);
      g.addColorStop(0, '#13293F'); g.addColorStop(1, '#0B1A2B');
      x.fillStyle = g; x.fillRect(0, 0, W, W);
      x.strokeStyle = '#39FF14'; x.lineWidth = 6;
      x.beginPath();
      if (x.roundRect) x.roundRect(48, 48, W - 96, W - 96, 36); else x.rect(48, 48, W - 96, W - 96);
      x.stroke();
      x.textAlign = 'center'; x.textBaseline = 'alphabetic';
      if (logo) {
        var lw = 560, lh = Math.round(lw * logo.naturalHeight / logo.naturalWidth);
        if (lh > 220) { lh = 220; lw = Math.round(lh * logo.naturalWidth / logo.naturalHeight); }
        x.drawImage(logo, (W - lw) / 2, 130 + (220 - lh) / 2, lw, lh);
      } else { x.fillStyle = '#fff'; x.font = '800 96px ' + F; x.fillText('NEXUS', W / 2, 270); }
      x.fillStyle = '#39FF14'; x.fillRect(W / 2 - 60, 410, 120, 6);
      x.fillStyle = '#C9D3E0'; x.font = '700 44px ' + F;
      x.fillText('Parceiro Credenciado NEXUS', W / 2, 500);
      var tam = 84, linhas;
      for (; tam >= 40; tam -= 4) {
        x.font = '800 ' + tam + 'px ' + F;
        linhas = quebrar(x, nome, 880);
        if (linhas.length <= 3 && linhas.every(function (l) { return x.measureText(l).width <= 920; })) break;
      }
      x.fillStyle = '#fff';
      var topo = 600 + (3 - Math.min(3, linhas.length)) * (tam * 0.6);
      linhas.slice(0, 3).forEach(function (l, i) { x.fillText(l, W / 2, topo + i * tam * 1.15); });
      x.fillStyle = '#39FF14'; x.font = '600 40px ' + F;
      x.fillText('Energia que move o amanhã', W / 2, 960);
    });
  }
  function baixarSelo() {
    var cv = $('#nx-selo');
    if (!cv) return;
    var nome = 'Selo-Parceiro-NEXUS-' + slug(nomeEmpresa()) + '.png';
    function baixar(url) { var a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); }
    if (cv.toBlob) cv.toBlob(function (b) { if (!b) return; var u = URL.createObjectURL(b); baixar(u); setTimeout(function () { URL.revokeObjectURL(u); }, 2000); }, 'image/png');
    else baixar(cv.toDataURL('image/png'));
    ev('baixou_selo');
  }
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    return new Promise(function (ok, falha) {
      var t = document.createElement('textarea');
      t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : falha(); } catch (e) { falha(e); }
      t.remove();
    });
  }

  /* ------------------------------------------------------------------ Perfil */
  function marca(nome, ativo, titulo, desc) {
    return '<label class="nx-marcar"><input type="checkbox" name="' + nome + '"' + (ativo ? ' checked' : '') + '><span><b>' + esc(titulo) + '</b>' + (desc ? '<span>' + esc(desc) + '</span>' : '') + '</span></label>';
  }
  function telaPerfil() {
    var eu = S.eu, p = eu.parceiro || {}, e = eu.empresa || {};
    var logo = imgSegura(S.logoNovo) || imgSegura(e.logo_base64);
    return '<div class="np-pagina"><div class="nx-wrap" style="width:100%"><h1 class="nx-h1">Perfil da empresa</h1><p class="nx-sub">' + esc(e.nome || p.empresa || '') + (e.cnpj ? ' · CNPJ ' + esc(fmtCnpj(e.cnpj)) : '') + '</p>' +
      '<form data-form="perfil" novalidate><p class="nx-msg-erro" data-erro hidden></p>' +
      '<div class="nx-cartao"><h2>Papéis</h2><p class="nx-dica" style="margin-bottom:10px">Marque um ou os dois.</p>' +
      marca('papel_revenda', p.papel_revenda, 'Revenda', 'Você vende o carregador NEXUS para os seus clientes, com preço de parceiro.') +
      marca('papel_montagem', p.papel_montagem, 'Montagem e Engenharia', 'Você executa, na sua região, as obras chave na mão que a NEXUS vende.') + '</div>' +
      '<div class="nx-cartao"><h2>Logo da empresa</h2><p class="nx-dica" style="margin-bottom:10px">Aparece nas propostas ao lado da NEXUS. Prefira fundo transparente.</p>' +
      '<div class="nx-logo-area"><div class="nx-logo-prev" id="nx-logo-prev">' + (logo ? '<img src="' + esc(logo) + '" alt="Logo da empresa">' : 'Sem logo') + '</div>' +
      '<div><input class="nx-arquivo" type="file" id="nx-logo-arq" accept="image/png,image/jpeg,image/webp" aria-label="Escolher o logo da empresa">' +
      '<label class="nx-btn sec" for="nx-logo-arq" tabindex="0" id="nx-logo-btn">' + (logo ? 'Trocar o logo' : 'Escolher o logo') + '</label>' +
      '<p class="nx-dica" style="margin-top:6px">PNG, JPG ou WebP. A imagem é reduzida para até 600 px de largura.</p></div></div></div>' +
      '<div class="nx-cartao"><h2>Onde a sua empresa atende</h2><div class="nx-grade2">' +
      '<div class="nx-campo"><label for="pf-cidade">Cidade</label><input id="pf-cidade" name="cidade" type="text" autocomplete="address-level2" value="' + esc(p.cidade || '') + '"><span class="nx-dica">Onde a sua empresa fica.</span></div>' +
      '<div class="nx-campo"><label for="pf-uf">UF</label><select id="pf-uf" name="uf"><option value="">Escolha</option>' +
      UFS.map(function (u) { return '<option' + (String(p.uf || '').toUpperCase() === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></div>' +
      '<div class="nx-campo"><label for="pf-raio">Raio de atendimento (km)</label><input id="pf-raio" name="raio_km" type="number" inputmode="numeric" min="1" max="5000" value="' + esc(p.raio_km == null ? '' : p.raio_km) + '"><span class="nx-dica">Distância máxima que a sua equipe atende, a partir da sua cidade.</span></div>' +
      '<div class="nx-campo"><label for="pf-eq">Tamanho da equipe</label><input id="pf-eq" name="equipe_tamanho" type="number" inputmode="numeric" min="0" max="10000" value="' + esc(p.equipe_tamanho == null ? '' : p.equipe_tamanho) + '"><span class="nx-dica">Quantas pessoas trabalham nos projetos e em campo.</span></div></div></div>' +
      '<div class="nx-cartao"><h2>Capacidades</h2><p class="nx-dica" style="margin-bottom:10px">Instalação elétrica de baixa e média tensão: marque o que a sua equipe executa, baixa tensão, média tensão ou as duas.</p>' +
      marca('cap_eletrica_bt', p.cap_eletrica_bt, 'Instalação elétrica de baixa tensão', '') +
      marca('cap_eletrica_mt', p.cap_eletrica_mt, 'Instalação elétrica de média tensão', '') +
      marca('cap_engenharia_art', p.cap_engenharia_art, 'Engenharia com ART', 'Marque se a empresa tem engenheiro que emite a ART dos projetos.') +
      marca('cap_obra_civil', p.cap_obra_civil, 'Obra civil', 'Base, valas, calçada e acabamento do local do carregador.') +
      marca('cap_homologacao', p.cap_homologacao, 'Homologação na distribuidora', 'Pedido de acesso e aprovação do projeto na concessionária de energia.') +
      marca('cap_ja_instala', p.cap_ja_instala, 'Já instala carregador de carro elétrico', 'Marque se a empresa já instalou algum, de qualquer potência.') + '</div>' +
      '<button type="submit" class="nx-btn grande">Salvar perfil</button></form></div></div>';
  }
  function redimensionarLogo(file) {
    return new Promise(function (ok, falha) {
      if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { falha(new Error('Use uma imagem PNG, JPG ou WebP.')); return; }
      var fr = new FileReader();
      fr.onerror = function () { falha(new Error('Não foi possível ler a imagem.')); };
      fr.onload = function () {
        var im = new Image();
        im.onerror = function () { falha(new Error('Não foi possível abrir a imagem.')); };
        im.onload = function () {
          var w = im.naturalWidth, h = im.naturalHeight;
          if (!w || !h) { falha(new Error('Não foi possível abrir a imagem.')); return; }
          var f = Math.min(1, 600 / w);
          var cw = Math.max(1, Math.round(w * f)), ch = Math.max(1, Math.round(h * f));
          var c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          c.getContext('2d').drawImage(im, 0, 0, cw, ch);
          var LIM = 800000; /* ~600 KB em base64 */
          var out = c.toDataURL('image/png');
          if (out.length > LIM) {
            var wp = c.toDataURL('image/webp', 0.9);
            if (wp.indexOf('data:image/webp') === 0 && wp.length < out.length) out = wp;
          }
          if (out.length > LIM) {
            var c2 = document.createElement('canvas');
            c2.width = cw; c2.height = ch;
            var x2 = c2.getContext('2d');
            x2.fillStyle = '#fff'; x2.fillRect(0, 0, cw, ch); x2.drawImage(im, 0, 0, cw, ch);
            out = c2.toDataURL('image/jpeg', 0.85);
          }
          if (out.length > LIM) falha(new Error('A imagem ficou grande demais. Tente uma imagem menor.'));
          else ok(out);
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ------------------------------------------------------------------ dados do parceiro */
  function recarregarEu() {
    return api('GET', NX + '/eu').then(function (r) {
      if (r.ok && r.data && r.data.parceiro) {
        S.eu = r.data; pintarNav();
        if (S.rota === 'parceria' || S.rota === 'inicio' || S.rota === 'servicos') pintarMain(true);
        else if (S.rota === 'propostas' && S.sub !== 'lista') pintarCardD();
        return true;
      }
      return false;
    });
  }
  function carregarEu() {
    return api('GET', NX + '/eu' + origemQS()).then(function (r) {
      if (r.tratado) return false;
      if (r.ok && r.data && r.data.parceiro) { S.eu = r.data; origemUsada(); return true; }
      S.fase = 'erro'; S.erroTexto = textoErro(r, 'Não foi possível carregar os seus dados.');
      pintar();
      return false;
    });
  }
  function iniciarApp(novo) {
    S.fase = 'boot'; pintar();
    return carregarEu().then(function (ok) {
      if (!ok) return;
      if (ehCadastro()) { aposSessaoCadastro(); return; }
      S.fase = 'app';
      var rh = rotaDoHash();
      S.rota = rh ? rh.r : 'inicio'; S.sub = rh ? rh.sub : '';
      pintar();
      var chave = 'nx_abriu', ja = false;
      try { ja = !!sessionStorage.getItem(chave); sessionStorage.setItem(chave, '1'); } catch (e) { /* ok */ }
      if (!ja && !novo) ev('abriu');
    });
  }

  /* ------------------------------------------------------------------ formularios */
  function erroForm(f, msg) {
    var e = f && $('[data-erro]', f);
    if (!e) return;
    e.textContent = msg || ''; e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function ocupado(btn, sim, rotulo) {
    if (!btn) return;
    if (sim) { btn.dataset.rot = btn.textContent; btn.disabled = true; btn.textContent = rotulo || 'Aguarde'; }
    else { btn.disabled = false; if (btn.dataset.rot) btn.textContent = btn.dataset.rot; }
  }
  function verificarCnpj(cnpj) {
    if (cnpjCache[cnpj]) return Promise.resolve(cnpjCache[cnpj]);
    return api('GET', NX + '/cnpj/' + cnpj, undefined, { semToken: true, quieto: true, timeout: 9000 }).then(function (r) {
      var d = r.data || {}, info;
      if (r.ok && d.ok === true) info = d.ativa ? { ativa: true, razao: d.razao_social || d.nome_fantasia || '' } : { bloqueia: true };
      else if (d.ok === false && d.motivo === 'invalido') info = { invalido: true };
      else return { indisponivel: true };
      cnpjCache[cnpj] = info;
      return info;
    });
  }
  function estadoCnpj(f, info) {
    var s = $('[data-cnpj-estado]', f);
    if (!s) return;
    if (!info) { s.textContent = ''; s.className = 'nx-cnpj-estado'; return; }
    if (info.ativa) { s.textContent = 'CNPJ ativo' + (info.razao ? ': ' + info.razao : ''); s.className = 'nx-cnpj-estado ok'; }
    else if (info.bloqueia) { s.textContent = 'Este CNPJ não aparece como ativo na Receita Federal.'; s.className = 'nx-cnpj-estado er'; }
    else if (info.invalido) { s.textContent = 'CNPJ inválido. Confira o número.'; s.className = 'nx-cnpj-estado er'; }
    else { s.textContent = ''; s.className = 'nx-cnpj-estado'; }
  }
  function conferirCnpjCampo(inp) {
    var f = inp.form, d = dig(inp.value);
    if (d.length !== 14) { estadoCnpj(f, null); return; }
    if (!cnpjValido(d)) { estadoCnpj(f, { invalido: true }); return; }
    verificarCnpj(d).then(function (info) {
      if (dig(inp.value) !== d) return;
      estadoCnpj(f, info);
      var emp = $('[name=empresa]', f);
      if (info.ativa && info.razao && emp && (!emp.value || emp.dataset.auto === '1')) { emp.value = info.razao; emp.dataset.auto = '1'; }
    });
  }
  function valorDe(f, nome) { var i = f.elements[nome]; return i ? String(i.value || '').trim() : ''; }

  function enviarLogin(f) {
    var email = valorDe(f, 'email'), senha = f.elements.password.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return erroForm(f, 'Informe um e-mail válido.');
    if (!senha) return erroForm(f, 'Informe a senha.');
    erroForm(f, '');
    var btn = $('[type=submit]', f); ocupado(btn, true, 'Entrando');
    api('POST', '/auth/login', { email: email, password: senha }, { semToken: true, quieto: true }).then(function (r) {
      if (r.ok && r.data && r.data.token) { S.msgEntrada = ''; S.emailPre = ''; salvarSessao(r.data); iniciarApp(); return; }
      ocupado(btn, false);
      erroForm(f, r.status === 401 ? 'E-mail ou senha incorretos.' : textoErro(r, 'Não foi possível entrar. Tente de novo.'));
    });
  }
  function enviarSemCnpj(f) {
    var cnpj = dig(f.elements.cnpj.value), emp = valorDe(f, 'empresa');
    if (!cnpjValido(cnpj)) return erroForm(f, 'CNPJ inválido. Confira o número.');
    erroForm(f, '');
    var btn = $('[type=submit]', f); ocupado(btn, true, 'Verificando');
    verificarCnpj(cnpj).then(function (info) {
      if (info.bloqueia) { S.fase = 'cnpj_inativo'; pintar(); return; }
      if (info.invalido) { ocupado(btn, false); return erroForm(f, 'CNPJ inválido. Confira o número.'); }
      var corpo = { cnpj: cnpj };
      if (emp || info.razao) corpo.empresa = emp || info.razao;
      return api('PUT', NX + '/perfil', corpo).then(function (r) {
        if (r.tratado) return;
        if (r.ok && r.data && r.data.parceiro && ehCadastro()) { S.eu = r.data; aposSessaoCadastro(); return; }
        if (r.ok && r.data && r.data.parceiro) { S.eu = r.data; S.fase = 'app'; S.rota = 'perfil'; S.sub = ''; history.replaceState(null, '', '#perfil'); pintar(); toast('Empresa cadastrada. Agora complete o perfil.'); return; }
        ocupado(btn, false);
        erroForm(f, textoErro(r, 'Não foi possível salvar o CNPJ.'));
      });
    });
  }
  function enviarPerfil(f) {
    var rv = f.elements.papel_revenda.checked, mo = f.elements.papel_montagem.checked;
    var cidade = valorDe(f, 'cidade'), uf = valorDe(f, 'uf'), raio = valorDe(f, 'raio_km'), eq = valorDe(f, 'equipe_tamanho');
    if (!rv && !mo) return erroForm(f, 'Marque pelo menos um papel: Revenda ou Montagem e Engenharia.');
    if (cidade.length < 2) return erroForm(f, 'Informe a cidade da empresa.');
    if (!uf) return erroForm(f, 'Escolha a UF.');
    if (raio === '' || Number(raio) < 1) return erroForm(f, 'Informe o raio de atendimento em km (pelo menos 1).');
    erroForm(f, '');
    var corpo = {
      cidade: cidade, uf: uf, raio_km: Math.round(Number(raio)), papel_revenda: rv, papel_montagem: mo,
      cap_eletrica_bt: f.elements.cap_eletrica_bt.checked, cap_eletrica_mt: f.elements.cap_eletrica_mt.checked,
      cap_engenharia_art: f.elements.cap_engenharia_art.checked, cap_obra_civil: f.elements.cap_obra_civil.checked,
      cap_homologacao: f.elements.cap_homologacao.checked, cap_ja_instala: f.elements.cap_ja_instala.checked,
      equipe_tamanho: eq === '' ? null : Math.round(Number(eq))
    };
    if (S.logoNovo) corpo.logo_base64 = S.logoNovo;
    if (S.demo) { toast('Indisponível na demonstração.'); return; }
    var antes = libera('basico');
    var btn = $('[type=submit]', f); ocupado(btn, true, 'Salvando');
    api('PUT', NX + '/perfil', corpo).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok && r.data && r.data.parceiro) {
        S.eu = r.data; S.logoNovo = null; S.procura = {};
        ev('perfil_salvo');
        pintarNav(); pintarMain();
        toast(!antes && libera('basico') ? 'Perfil completo. Orçamentos, Materiais e Engenharia liberados.' : 'Perfil salvo.');
        return;
      }
      erroForm(f, textoErro(r, 'Não foi possível salvar o perfil.'));
    });
  }

  /* ------------------------------------------------------------------ cadastro guiado: logica */
  function erroCampo(f, nome, msg) {
    var s = $('[data-erro-de="' + nome + '"]', f), i = f.elements[nome];
    if (s) { s.textContent = msg || ''; s.hidden = !msg; }
    if (i && i.setAttribute) { if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); }
  }
  /* regras: [[nome, mensagem ou '']] na ordem da tela. Mostra todas as mensagens, foca a primeira e devolve true se nao houve erro. */
  function validarCampos(f, regras) {
    var primeiro = null;
    regras.forEach(function (r) {
      erroCampo(f, r[0], r[1]);
      if (r[1] && !primeiro) primeiro = r[0];
    });
    if (primeiro) {
      var el = f.elements[primeiro] || $('[data-foco-de="' + primeiro + '"]', f);
      if (el && el.focus) { try { el.focus(); } catch (e) { /* ok */ } }
    }
    return !primeiro;
  }
  function lerCad(f, passo) {
    var c = S.cad;
    if (!c || !f) return;
    if (passo === 1) {
      c.nome = valorDe(f, 'nome'); c.email = valorDe(f, 'email'); c.fone = dig(f.elements.whatsapp.value);
      c.senha = f.elements.password.value; c.conf = f.elements.confirma.value; c.aceito = !!f.elements.aceito.checked;
    } else if (passo === 2) {
      c.cnpj = dig(f.elements.cnpj.value); c.empresa = valorDe(f, 'empresa');
    }
  }
  function focoCad() { var h = $('#cad-h1'); if (h) { try { h.focus({ preventScroll: true }); } catch (e) { /* ok */ } } }
  function irPasso(n) {
    if (!S.cad) S.cad = novoCad();
    S.cad.passo = n; S.fase = 'cadastro';
    evPasso(n);
    pintar();
    if (n === 2 && S.cad.cnpj) { var i = $('#c2-cnpj'); if (i) conferirCnpjCampo(i); }
  }
  function aposSessaoCadastro() {
    if (perfilCompleto()) {
      try { history.replaceState(null, '', location.pathname + location.search + '#inicio'); } catch (e) { /* ok */ }
      S.fase = 'app'; S.rota = 'inicio'; S.sub = ''; S.cad = null;
      pintar();
      return;
    }
    irPasso(3);
  }
  function abrirCadastro() {
    if (S.demo || (S.fase !== 'app' && S.fase !== 'entrada')) return;
    if (getToken()) { if (S.eu) aposSessaoCadastro(); else iniciarApp(); return; }
    S.cad = novoCad(); irPasso(1);
  }
  function jaTemConta(email) {
    if (S.cad) { S.cad.senha = ''; S.cad.conf = ''; }
    S.emailPre = email;
    S.msgEntrada = 'Você já tem conta no SolarDoc com este e-mail. Entre com a sua senha.';
    S.fase = 'entrada';
    pintar();
    var s = $('#lg-senha'); if (s) { try { s.focus(); } catch (e) { /* ok */ } }
  }
  function voltarComErro(nome, msg) {
    irPasso(1);
    var f = $('[data-form=cad1]');
    if (f) validarCampos(f, [[nome, msg]]);
  }
  function enviarCad1(f) {
    lerCad(f, 1);
    var c = S.cad;
    var ok = validarCampos(f, [
      ['nome', c.nome.length < 2 ? 'Informe o seu nome completo.' : ''],
      ['email', /^\S+@\S+\.\S+$/.test(c.email) ? '' : 'Informe um e-mail válido.'],
      ['whatsapp', c.fone.length < 10 || c.fone.length > 11 ? 'Informe o WhatsApp com DDD, com 10 ou 11 números.' : ''],
      ['password', c.senha.length < 8 ? 'A senha precisa de pelo menos 8 caracteres.' : (!/\d/.test(c.senha) ? 'A senha precisa ter pelo menos 1 número.' : '')],
      ['confirma', c.conf !== c.senha ? 'As senhas não conferem.' : ''],
      ['aceito', c.aceito ? '' : 'É preciso aceitar os termos para continuar.']
    ]);
    if (!ok) return;
    erroForm(f, '');
    irPasso(2);
  }
  function enviarCad2(f) {
    lerCad(f, 2);
    var c = S.cad, bloqueio = $('[data-bloqueio]', f);
    if (bloqueio) bloqueio.hidden = true;
    var ok = validarCampos(f, [
      ['cnpj', cnpjValido(c.cnpj) ? '' : 'CNPJ inválido. Confira o número.'],
      ['empresa', c.empresa.length < 2 ? 'Informe o nome da empresa.' : '']
    ]);
    if (!ok) return;
    erroForm(f, '');
    var btn = $('[type=submit]', f); ocupado(btn, true, 'Verificando o CNPJ');
    verificarCnpj(c.cnpj).then(function (info) {
      if (info.bloqueia) {
        ocupado(btn, false); estadoCnpj(f, info);
        if (bloqueio) { bloqueio.hidden = false; bloqueio.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return;
      }
      if (info.invalido) { ocupado(btn, false); estadoCnpj(f, info); validarCampos(f, [['cnpj', 'CNPJ inválido. Confira o número.'], ['empresa', '']]); return; }
      btn.textContent = 'Criando a conta';
      var corpo = { nome: c.nome, email: c.email, password: c.senha, whatsapp: c.fone, empresa: c.empresa, cnpj: c.cnpj, origem: 'nexus' };
      return api('POST', '/auth/register', corpo, { semToken: true, quieto: true }).then(function (r) {
        if (r.ok && r.data && r.data.token) {
          salvarSessao(r.data); S.msgEntrada = '';
          c.senha = ''; c.conf = '';
          c.fila.forEach(function (n) { ev('cadastro_passo', { passo: n }); });
          c.fila = [];
          ev('cadastrou'); pix('CadastroParceiroNexus');
          carregarEu().then(function (certo) { if (certo) aposSessaoCadastro(); });
          return;
        }
        ocupado(btn, false);
        /* 409: e-mail ja cadastrado ('Email já cadastrado') ou conta com plano ativado ('JA_TEM_CONTA_PLANO_ATIVADO'). */
        if (r.status === 409) { jaTemConta(c.email); return; }
        var cod = r.data && typeof r.data.error === 'string' ? r.data.error : '';
        if (/CNPJ/i.test(cod)) { validarCampos(f, [['cnpj', 'CNPJ inválido. Confira o número.'], ['empresa', '']]); return; }
        if (/WhatsApp/i.test(cod)) { voltarComErro('whatsapp', 'Informe o WhatsApp com DDD, com 10 ou 11 números.'); return; }
        if (/e-?mail/i.test(cod)) { voltarComErro('email', 'Informe um e-mail válido.'); return; }
        if (/senha/i.test(cod)) { voltarComErro('password', 'A senha precisa de pelo menos 8 caracteres e 1 número.'); return; }
        erroForm(f, textoErro(r, 'Não foi possível criar a conta. Tente de novo.'));
      });
    });
  }
  function enviarCad3(f) {
    var e = (S.eu && S.eu.empresa) || {};
    var logo = imgSegura(S.logoNovo) || imgSegura(e.logo_base64);
    var rv = f.elements.papel_revenda.checked, mo = f.elements.papel_montagem.checked;
    var cidade = valorDe(f, 'cidade'), uf = valorDe(f, 'uf'), raio = valorDe(f, 'raio_km'), eq = valorDe(f, 'equipe_tamanho');
    var ok = validarCampos(f, [
      ['logo', logo ? '' : 'Escolha o logo da empresa. Ele aparece nas propostas ao lado da NEXUS.'],
      ['cidade', cidade.length < 2 ? 'Informe a cidade da empresa.' : ''],
      ['uf', uf ? '' : 'Escolha a UF.'],
      ['raio_km', raio === '' || !(Number(raio) >= 1) ? 'Informe o raio de atendimento em km, de 1 a 5000.' : (Number(raio) > 5000 ? 'O raio máximo é 5000 km.' : '')],
      ['equipe_tamanho', eq !== '' && !(Number(eq) >= 0 && Number(eq) <= 10000) ? 'Informe um número de 0 a 10000, ou deixe em branco.' : ''],
      ['papel', rv || mo ? '' : 'Marque pelo menos um papel: Revenda ou Montagem e Engenharia.']
    ]);
    if (!ok) return;
    erroForm(f, '');
    var corpo = {
      cidade: cidade, uf: uf, raio_km: Math.round(Number(raio)), papel_revenda: rv, papel_montagem: mo,
      cap_eletrica_bt: f.elements.cap_eletrica_bt.checked, cap_eletrica_mt: f.elements.cap_eletrica_mt.checked,
      cap_engenharia_art: f.elements.cap_engenharia_art.checked, cap_obra_civil: f.elements.cap_obra_civil.checked,
      cap_homologacao: f.elements.cap_homologacao.checked, cap_ja_instala: f.elements.cap_ja_instala.checked,
      equipe_tamanho: eq === '' ? null : Math.round(Number(eq))
    };
    if (S.logoNovo) corpo.logo_base64 = S.logoNovo;
    var btn = $('[type=submit]', f); ocupado(btn, true, 'Salvando');
    api('PUT', NX + '/perfil', corpo).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok && r.data && r.data.parceiro) {
        S.eu = r.data; S.logoNovo = null; S.procura = {};
        ev('perfil_salvo');
        if (!perfilCompleto()) { erroForm(f, 'O perfil ainda não ficou completo. Confira o logo, a cidade, a UF, o raio e o papel da empresa.'); return; }
        try { history.replaceState(null, '', location.pathname + location.search + '#inicio'); } catch (x) { /* ok */ }
        S.fase = 'app'; S.rota = 'inicio'; S.sub = ''; S.cad = null;
        pintar();
        toast('Cadastro completo. Bem-vindo à rede NEXUS.');
        return;
      }
      erroForm(f, textoErro(r, 'Não foi possível salvar o perfil.'));
    });
  }

  /* ------------------------------------------------------------------ acoes (data-acao) */
  function pedirConversa(btn) {
    if (S.demo) { toast('Indisponível na demonstração.'); return; }
    ocupado(btn, true, 'Enviando');
    api('POST', NX + '/solicitacoes', { tipo: 'conversa', dados: {} }).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok) {
        ev('pediu_conversa');
        toast('Pedido enviado ao comercial da NEXUS.');
        if (S.eu && S.eu.parceiro) S.eu.parceiro.conversa_pedida_em = new Date().toISOString();
        pintarMain(true);
        recarregarEu();
      } else toast(textoErro(r, 'Não foi possível enviar o pedido.'), true);
    });
  }
  function negociar(id, btn) {
    var p = produtoPor(id);
    if (!p) return;
    if (!libera('negociar')) { toast('Complete o perfil para negociar o preço de parceiro.', true); return; }
    var qtd = S.rota === 'equipamentos' && S.sub === id ? S.qtd : 1;
    ocupado(btn, true, 'Enviando');
    api('POST', NX + '/solicitacoes', { tipo: 'negociar_preco', dados: { modelo: p.nome, modelo_id: p.id, quantidade: qtd } }).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok) { ev('negociou_preco', { modelo: p.id }); toast('Pedido enviado. O comercial da NEXUS fala com você sobre o preço de parceiro.'); }
      else toast(textoErro(r, 'Não foi possível enviar o pedido.'), true);
    });
  }
  function enviarPedidoForm(el) {
    var id = el.dataset.arg, c = document.getElementById('ped-' + id);
    if (!c) return;
    var sel = c.querySelector('select'), qt = c.querySelector('input'), ob = c.querySelector('textarea');
    var q = Math.round(Number(qt.value));
    if (!(q >= 1 && q <= 50)) { erroForm(c, 'Informe a quantidade, de 1 a 50.'); return; }
    erroForm(c, '');
    ocupado(el, true, 'Enviando');
    pedirEquipamento({ modelo: sel.value, quantidade: q, proposta_id: c.dataset.prop || '', obs: (ob.value || '').trim() }).then(function (feito) {
      ocupado(el, false);
      toast('Pedido enviado ao comercial da NEXUS.');
      if (c.dataset.prop) {
        S.pedidos = (S.pedidos || []).concat([{ id: feito && feito.id, proposta_id: c.dataset.prop, status: 'solicitado' }]);
        if ($('#nx-props')) { pintarListaPropostas(); return; }
      }
      c.hidden = true; c.innerHTML = '<p class="nx-msg-ok" style="margin:0">Pedido enviado. O comercial da NEXUS entra em contato.</p>'; c.hidden = false;
    }, function (e) { ocupado(el, false); erroForm(c, e.message); });
  }
  var ACOES = {
    ir: function (el) { fecharMais(); irPara(el.dataset.arg); },
    criarConta: function () {
      S.msgEntrada = ''; S.emailPre = ''; S.cad = novoCad();
      try { history.replaceState(null, '', location.pathname + location.search + '#cadastro'); } catch (e) { /* ok */ }
      irPasso(1);
    },
    cadEntrar: function () { S.msgEntrada = ''; S.fase = 'entrada'; pintar(); },
    cadVoltar: function () { lerCad($('[data-form=cad2]'), 2); irPasso(1); },
    abrirMais: function () { var f = $('#np-folha'); f.innerHTML = folhaHTML(); f.hidden = false; $('#np-fundo').hidden = false; },
    fecharMais: fecharMais,
    sairConta: function () {
      if (S.demo) { location.href = '/nexus/app'; return; }
      limparSessao(); S.eu = null; S.msgEntrada = ''; S.emailPre = ''; S.cad = null; S.fase = 'entrada'; S.propostas = null; S.ultima = null; S.procura = {};
      S.termoTxt = undefined; S.termoErro = false; S.termoMsg = ''; S.pedidosServ = null; S.confirmaPacote = 0; S.consultoriaAberta = false; S.plataformaPedida = false;
      history.replaceState(null, '', location.pathname + location.search); pintar();
    },
    tentarDeNovo: function () { if (getToken()) iniciarApp(); else { S.fase = 'entrada'; pintar(); } },
    repintar: function () { pintarMain(true); },
    conversa: function (el) { pedirConversa(el); },
    clicouWa: function () { ev('clicou_whatsapp'); },
    baixouMaterial: function (el) { ev('baixou_material', { arquivo: el.dataset.arg }); },
    baixarSelo: baixarSelo,
    copiarLegenda: function (el) {
      copiar(LEGENDA[el.dataset.arg] || '').then(function () { toast('Legenda copiada.'); }, function () { toast('Não foi possível copiar. Selecione o texto e copie.', true); });
    },
    avisoPartner: function () { toast(bloq('pedido'), true); },
    travado: function (el) { toast(bloq(el.dataset.arg), true); },
    pedirPacote: function (el) { S.confirmaPacote = Number(el.dataset.arg) || 0; pintarMain(true); },
    cancelarPacote: function () { S.confirmaPacote = 0; pintarMain(true); },
    enviarPacote: function (el) {
      var n = Number(el.dataset.arg);
      if (PACOTES.indexOf(n) < 0) return;
      postPedidoServ({ tipo: 'engenharia', pacote: n }, el, 'Pedido do pacote de ' + n + ' projetos enviado ao comercial da NEXUS.', 'pediu_pacote_engenharia');
    },
    pedirConsultoria: function () { S.consultoriaAberta = true; pintarMain(true); var t = $('#sv-cons-obs'); if (t) t.focus({ preventScroll: true }); },
    cancelarConsultoria: function () { S.consultoriaAberta = false; pintarMain(true); },
    enviarConsultoria: function (el) {
      var t = $('#sv-cons-obs'), obs = t ? String(t.value || '').trim().slice(0, 300) : '';
      var corpo = { tipo: 'consultoria' };
      if (obs) corpo.obs = obs;
      postPedidoServ(corpo, el, 'Pedido de consultoria enviado ao comercial da NEXUS.', 'pediu_consultoria');
    },
    querPlataforma: function (el) { querPlataforma(el); },
    recarregarPedidosServ: function () { S.pedidosServErro = false; var e = $('#sv-pedidos'); if (e) e.innerHTML = girando('Carregando os pedidos'); carregarPedidosServ(); },
    aceitarTermo: function (el) { aceitarTermo(el); },
    imprimirTermo: imprimirTermo,
    recarregarTermo: function () { S.termoErro = false; S.termoTxt = undefined; carregarTermo(); },
    irTermoParceria: function () { S.irTermo = true; fecharMais(); irPara('parceria'); },
    irTermo: function (el, e) { if (e && e.preventDefault) e.preventDefault(); var t = $('#np-termo'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    criarLinkProp: function (el) {
      ocupado(el, true, 'Criando');
      criarLink(el.dataset.arg).then(function () { toast('Link criado.'); pintarListaPropostas(); }, function (e) { ocupado(el, false); toast(e.message, true); });
    },
    copiarLinkProp: function (el) {
      var p = (S.propostas || []).filter(function (x) { return x.id === el.dataset.arg; })[0];
      var url = urlDoLink(p);
      if (!url) return;
      copiar(url).then(function () { ev('copiou_link', { proposta: el.dataset.arg }); toast('Link copiado.'); }, function () { toast('Não foi possível copiar. Selecione o link e copie.', true); });
    },
    enviouLink: function (el) { ev('enviou_link_whatsapp', { proposta: el.dataset.arg }); },
    recarregarProps: function () { S.propErro = false; $('#nx-props').innerHTML = girando('Carregando as propostas'); carregarPropostas(); },
    recarregarProcura: function () {
      var d = S.procuraDestino || 'np-procura', el = document.getElementById(d);
      if (el) el.innerHTML = girando('Carregando a procura');
      carregarProcura(d, S.procuraCompleto);
    },
    recarregarFrota: function () { S.frota = null; pintarMain(true); },
    recarregarOps: function () { $('#np-opsini').innerHTML = girando('Carregando as oportunidades'); carregarOpsInicio(); },
    reabrir: function (el) {
      ocupado(el, true, 'Abrindo');
      api('GET', NX + '/propostas/' + encodeURIComponent(el.dataset.arg)).then(function (r) {
        if (r.tratado) return;
        ocupado(el, false);
        var p = r.ok && r.data && (r.data.proposta || r.data);
        if (p && p.id) { S.propInicial = p; irPara('propostas'); }
        else toast(textoErro(r, 'Não foi possível abrir a proposta.'), true);
      });
    },
    abrirPedidoProp: function (el) {
      var id = el.dataset.arg, w = document.getElementById('pw-' + id);
      if (!w) return;
      if (!w.hidden) { w.hidden = true; return; }
      var pr = (S.propostas || []).filter(function (x) { return x.id === id; })[0] || {};
      var prod = produtoPor(pr.modelo) || produtos()[0] || {};
      w.innerHTML = pedidoForm(id, { modelo: prod.id, qtd: pr.quantidade || 1, propostaId: id, titulo: 'Pedir equipamento da proposta ' + (pr.numero || '') });
      w.hidden = false;
    },
    abrirPedidoD: function () {
      var c = $('#np-pedd'), d = $('#nx-cardd');
      if (!c) return;
      var prod = produtoPor(d && d.dataset.modelo) || produtos()[0] || {};
      c.innerHTML = pedidoForm('cardd', { modelo: prod.id, qtd: Number(d && d.dataset.qtd) || 1, propostaId: S.ultima && S.ultima.id && S.ultima.id !== 'demo' ? S.ultima.id : '', titulo: 'Pedir equipamento' });
    },
    enviarPedido: enviarPedidoForm,
    comprar: function (el) {
      var id = el.dataset.arg;
      if (S.rota === 'equipamentos' && S.sub === id) { abrirCompra(); return; }
      S.abrirCompra = true; S.qtd = 1; S.foto = 0; irPara('equipamentos/' + id);
    },
    negociar: function (el) { negociar(el.dataset.arg, el); },
    qtd: function (el) { S.qtd = Math.max(1, Math.min(50, S.qtd + Number(el.dataset.arg))); atualizarTotal(); var q = $('#ped-compra input'); if (q) q.value = S.qtd; },
    foto: function (el) {
      var p = produtoPor(S.sub); if (!p) return;
      S.foto = Number(el.dataset.arg) || 0;
      var I = infoDe(p);
      $('#np-foto').src = fotoUrl(I.fotos[S.foto]);
      $$('.np-mini button').forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === S.foto)); });
    }
  };

  function aoClicar(e) {
    var el = e.target.closest ? e.target.closest('[data-acao]') : null;
    if (!el || !ACOES[el.dataset.acao]) return;
    if (el.getAttribute('aria-disabled') === 'true' && el.dataset.acao !== 'avisoPartner' && el.dataset.acao !== 'travado') return;
    ACOES[el.dataset.acao](el, e);
  }
  function aoEnviar(e) {
    var f = e.target;
    if (!f || !f.dataset || !f.dataset.form) return;
    e.preventDefault();
    var m = { login: enviarLogin, semCnpj: enviarSemCnpj, perfil: enviarPerfil, cad1: enviarCad1, cad2: enviarCad2, cad3: enviarCad3 }[f.dataset.form];
    if (m) m(f);
  }
  function aoDigitar(e) {
    var t = e.target;
    if (t.dataset && t.dataset.mascara === 'cnpj') {
      t.value = fmtCnpj(t.value);
      var bq = t.form && $('[data-bloqueio]', t.form); if (bq) bq.hidden = true;
      conferirCnpjCampo(t);
    }
    else if (t.dataset && t.dataset.mascara === 'fone') t.value = fmtFone(t.value);
    else if (t.name === 'empresa' && t.dataset) delete t.dataset.auto;
  }
  function aoMudar(e) {
    var t = e.target;
    if (t.id === 'nx-logo-arq' && t.files && t.files[0]) {
      var arq = t.files[0];
      var fc = $('[data-form=cad3]');
      redimensionarLogo(arq).then(function (url) {
        S.logoNovo = url;
        var pv = $('#nx-logo-prev');
        if (pv) pv.innerHTML = '<img src="' + esc(url) + '" alt="Prévia do logo">';
        var b = $('#nx-logo-btn'); if (b) b.textContent = 'Trocar o logo';
        if (fc) erroCampo(fc, 'logo', ''); else erroForm($('[data-form=perfil]'), '');
      }, function (err) { if (fc) erroCampo(fc, 'logo', err.message); else erroForm($('[data-form=perfil]'), err.message); });
      t.value = '';
    }
  }

  /* ------------------------------------------------------------------ rotas por hash e partida */
  function aoMudarHash() {
    if (ehCadastro()) { abrirCadastro(); return; }
    if (S.fase !== 'app') return;
    var rh = rotaDoHash();
    var antes = S.rota + '/' + S.sub;
    S.rota = rh ? rh.r : 'inicio'; S.sub = rh ? rh.sub : '';
    if (S.rota !== 'equipamentos' || antes !== S.rota + '/' + S.sub) { if (!S.abrirCompra) { S.qtd = 1; S.foto = 0; } }
    fecharMais();
    pintarNav(); pintarMain();
  }
  function boot() {
    capturarOrigem();
    var root = $('#nx-root');
    root.addEventListener('click', aoClicar);
    root.addEventListener('submit', aoEnviar);
    root.addEventListener('input', aoDigitar);
    root.addEventListener('change', aoMudar);
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'nx-logo-btn') { e.preventDefault(); $('#nx-logo-arq').click(); }
      if (e.key === 'Escape') fecharMais();
    });
    window.addEventListener('hashchange', aoMudarHash);
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(desenharGrafs, 150); });

    S.demo = /[?&]demo=1(&|$)/.test(location.search);
    if (S.demo) {
      var mn = /[?&]nivel=(cadastrado|partner|pro|master)(&|$)/.exec(location.search);
      S.nivelDemo = mn ? mn[1] : 'pro';
      var mm = /[?&]montagem=([01])(&|$)/.exec(location.search);
      S.montagemDemo = mm ? mm[1] === '1' : null;
      S.eu = euDemo(S.nivelDemo); S.fase = 'app';
      var rd = rotaDoHash();
      S.rota = rd ? rd.r : 'inicio'; S.sub = rd ? rd.sub : '';
      pintar();
      return;
    }
    var rh = rotaDoHash();
    S.rota = rh ? rh.r : 'inicio'; S.sub = rh ? rh.sub : '';
    pintar();
    api('GET', NX + '/status', undefined, { semToken: true, quieto: true, timeout: 8000 }).then(function (r) {
      if (r.status === 503 || (r.ok && r.data && r.data.ligado === false)) { S.fase = 'embreve'; pintar(); return; }
      if (getToken()) iniciarApp();
      else if (ehCadastro()) { S.cad = novoCad(); irPasso(1); }
      else { S.fase = 'entrada'; pintar(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
