/* Portal do Parceiro NEXUS: casca (sessao, rotas por hash, telas de informacao, eventos, modo demonstracao).
   JavaScript puro, sem build. Desenho: canvas aprovado de 21/10/2026 (Main, Celular, Equipamento, Parceria; o Mercado virou seção do Início).
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
  var MQ = window.matchMedia ? window.matchMedia('(max-width: 860.98px)') : null;
  function mobile() { return !!(MQ && MQ.matches); }
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
    plataforma: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2M10 6h4M10 9h4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copiar: '<path d="M9 9h11v11H9zM5 15H4V4h11v1"/>',
    imprimir: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
    termo: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4"/>',
    gerar: '<path d="M12 5v14M5 12h14"/>',
    voltar: '<path d="M15 18l-6-6 6-6"/>',
    seta: '<path d="M9 6l6 6-6 6"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    compartilhar: '<path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    celular: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    instalar: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 6.5v6M9.5 10l2.5 2.5 2.5-2.5M10.5 18h3"/>',
    maisq: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    pontos: '<path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3"/>',
    bussola: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'
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
    confirmaPacote: 0, manutAberta: false, apoioAberto: false, plataformaPedida: false, pedidosServ: null, pedidosServErro: false,
    termoTxt: undefined, termoErro: false, termoMsg: '', montagemDemo: null,
    cad: null, emailPre: '', instalarEv: null, instalouAgora: false, bannerFechado: false
  };
  var propAtual = null;      /* proposta em edicao na tela Propostas: {id, numero} */
  var esperaScript = null;
  var cnpjCache = {};
  var GRAFS = [];
  var uidG = 0;

  var ROTAS = {
    inicio: { menu: 'Início', ctx: 'Resumo, mercado, equipamentos e oportunidades' },
    equipamentos: { menu: 'Equipamentos', ctx: 'Os carregadores da rede NEXUS' },
    servicos: { menu: 'Serviços NEXUS', ctx: 'Plataforma, engenharia e suporte: o que inclui, quanto custa e como contratar', reqTodos: ['basico', 'pacotes_engenharia', 'consultoria', 'plataforma', 'manutencao'] },
    propostas: { menu: 'Propostas', ctx: 'Simulador, Orçamento Básico e Orçamento Completo' },
    oportunidades: { menu: 'Oportunidade', ctx: 'Clientes e obras da NEXUS na sua região', req: 'oportunidades' },
    usinas: { menu: 'Usinas', ctx: 'Indique uma usina', req: 'usinas', motivo: 'Complete o perfil da empresa para indicar usinas.' },
    materiais: { menu: 'Materiais', ctx: 'Fotos para divulgar o equipamento', req: 'materiais', motivo: 'Complete o perfil da empresa para liberar os Materiais.' },
    parceria: { menu: 'Minha parceria', ctx: 'Níveis, caminho e selo' },
    perfil: { menu: 'Perfil', ctx: 'Dados e capacidades da empresa' },
    instalar: { menu: 'Instalar o app', ctx: 'Deixe o portal na tela inicial do aparelho' }
  };
  var ORDEM = ['inicio', 'propostas', 'equipamentos', 'servicos', 'oportunidades', 'usinas', 'parceria', 'materiais'].filter(function (r) { return MOSTRAR_USINAS || r !== 'usinas'; });
  var BAIXO = ['perfil', 'instalar'];
  var ALIAS = { trilha: 'parceria', gerar: 'propostas', selo: 'parceria', credenciado: 'parceria' };
  /* A aba Mercado e a aba Engenharia deixaram de existir: #mercado abre o Início na seção Mercado e #engenharia abre Serviços em Pedir engenharia. */
  var ATALHO_SEC = { mercado: ['inicio', 'ini-mercado'], engenharia: ['servicos', 'sv-pedir-eng'] };
  var SECOES = { inicio: { resumo: 'ini-resumo', carregadores: 'ini-carregadores', servicos: 'ini-servicos', mercado: 'ini-mercado', oportunidades: 'ini-oportunidades' }, servicos: { plataforma: 'sv-plat', engenharia: 'sv-eng', suporte: 'sv-sup', pedir: 'sv-pedir-eng' } };

  /* Item ADM: so quando o /eu diz adm:true (is_admin ou e-mail ativo em nexus_equipe). Leva a pagina propria, nao a uma rota do portal. */
  function admOk() { return !!(S.eu && S.eu.adm === true && !S.demo); }
  function wpp() { return (S.eu && S.eu.whatsappComercial) || WA_PADRAO; }
  function nivel() { return (S.eu && S.eu.nivel) || 'cadastrado'; }
  var NIVEL_NOME = { cadastrado: 'Cadastrado', partner: 'Partner', pro: 'Partner Pro', master: 'Partner Master' };
  var NIVEL_IDX = { cadastrado: 1, partner: 2, pro: 3, master: 4 };
  /* Chaves novas da v3: se a API ainda nao mandar a chave, vale o nivel (partner: pacotes e consultoria; pro: plataforma, termo e oportunidades). */
  var LIB_NIVEL = { pacotes_engenharia: 2, consultoria: 2, plataforma: 3, manutencao: 3, termo: 3, oportunidades: 3 };
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
    plataforma: TX_COMPRA, manutencao: TX_COMPRA, termo: TX_COMPRA, oportunidades: TX_COMPRA,
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
    if (ATALHO_SEC[partes[0]]) return { r: ATALHO_SEC[partes[0]][0], sub: '', sec: ATALHO_SEC[partes[0]][1] };
    var r = ALIAS[partes[0]] || partes[0];
    if (!ROTAS[r]) return null;
    if (r === 'usinas' && !MOSTRAR_USINAS) {
      try { history.replaceState(null, '', location.pathname + location.search + '#inicio'); } catch (e) { /* ok */ }
      return { r: 'inicio', sub: '', sec: '' };
    }
    if (SECOES[r]) return { r: r, sub: '', sec: SECOES[r][partes[1]] || '' };
    return { r: r, sub: partes.slice(1).join('/'), sec: '' };
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
    if (r.status === 503 && cod !== 'servico_em_ativacao') { S.fase = 'embreve'; r.tratado = true; pintar(); return; }
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
      servicos: servicosDemo(idx), saldo_engenharia: idx >= 3 ? (idx === 4 ? { comprados: 8, usados: 3, disponiveis: 5 } : { comprados: 3, usados: 1, disponiveis: 2 }) : { comprados: 0, usados: 0, disponiveis: 0 },
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
  /* /eu v5: `servicos` como lista, com o booleano de cada nível (modo demonstração monta os mesmos dados). */
  function servicosDemo(idx) {
    function it(id, grupo, nome, texto, valor, unidade, lib, bloqueio, acao) {
      return { id: id, grupo: grupo, nome: nome, preco_texto: texto, preco_valor: valor, unidade: unidade, libera: lib, bloqueio: lib ? null : bloqueio, acao: acao };
    }
    return [
      it('plataforma', 'plataforma', 'Plataforma NEXUS', '10% do que o ponto fatura em recarga', null, 'do faturamento em recarga', idx >= 3, SV_TX_COMPRA, 'solicitacao'),
      it('eng-1', 'engenharia', 'Engenharia NEXUS · 1 projeto', 'R$ 3.000', 3000, 'projeto', true, SV_TX_AVULSO, 'pedido'),
      it('eng-3', 'engenharia', 'Pacote de engenharia · 3 projetos', 'R$ 7.500', 7500, '3 projetos', idx >= 2, SV_TX_PACOTES, 'pedido'),
      it('eng-5', 'engenharia', 'Pacote de engenharia · 5 projetos', 'R$ 10.000', 10000, '5 projetos', idx >= 2, SV_TX_PACOTES, 'pedido'),
      it('suporte_incluido', 'suporte', 'Suporte incluído no carregador', 'Sem custo', null, '', true, null, null),
      it('manutencao', 'suporte', 'Plano de manutenção NEXUS', 'R$ 200 por mês por carregador', 200, 'por mês por carregador', idx >= 3, SV_TX_COMPRA, 'pedido'),
      it('apoio_venda', 'suporte', 'Apoio de venda', 'R$ 500 por atendimento', 500, 'por atendimento', idx >= 2, SV_TX_PARTNER, 'pedido')
    ];
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
        { id: 'pd4', tipo: 'manutencao', quantidade: 4, status: 'solicitado', created_at: new Date(agora - 86400000).toISOString() },
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
  /* Junta cidade e UF sem repetir a sigla: o cadastro do SolarDoc ja traz "Uberlândia MG" na cidade. Unico lugar do portal que monta "Cidade/UF". */
  function cidadeUf(cidade, uf) {
    var c = String(cidade == null ? '' : cidade).trim(), u = String(uf == null ? '' : uf).trim().toUpperCase();
    var m = c.match(/^(.*\S)\s*(?:[\/,\u2013\u2014-]\s*|\s)([A-Za-z]{2})$/);
    if (m) {
      var sig = m[2].toUpperCase();
      if (u ? sig === u : UFS.indexOf(sig) >= 0) { c = m[1].replace(/[\s,\/\u2013\u2014-]+$/, ''); if (!u) u = sig; }
    }
    return c && u ? c + '/' + u : (c || u);
  }
  window.NxCidadeUf = cidadeUf;
  function localParceiro() {
    var p = (S.eu && S.eu.parceiro) || {};
    var e = (S.eu && S.eu.empresa) || {};
    var cid = p.cidade || e.cidade || '';
    return cidadeUf(cid, p.uf);
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
    var volta = n === 1 ? '<button type="button" class="nx-cad-voltar" data-acao="cadEntrar" aria-label="Voltar para entrar">' + ic('voltar') + '</button>' :
      (n === 2 ? '<button type="button" class="nx-cad-voltar" data-acao="cadVoltar" aria-label="Voltar ao passo 1">' + ic('voltar') + '</button>' : '');
    return volta + '<p class="nx-passo">Passo ' + n + ' de 3</p><div class="nx-prog" role="img" aria-label="Passo ' + n + ' de 3">' + seg + '</div>' +
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
    h += '</nav><nav class="np-nav baixo" aria-label="Conta e aplicativo">';
    BAIXO.forEach(function (r) { h += itemMenu(r); });
    if (admOk()) h += '<a class="np-n-item" href="/nexus/adm">' + ic('escudo', 'm') + '<span>ADM</span></a>';
    h += '</nav><div class="np-emp"><b>' + esc(nomeEmpresa() || 'Sua empresa') + '</b>' +
      (localParceiro() ? '<span class="loc">' + esc(localParceiro()) + '</span>' : '') +
      '<span class="nivel">' + esc(NIVEL_NOME[nivel()] || '') + '</span>' +
      '<div class="acoes"><button type="button" data-acao="sairConta">' + (S.demo ? 'Sair da demonstração' : 'Sair') + '</button></div></div>';
    return h;
  }
  /* ---- casca do celular (abaixo de 861 px): barra de cima, barra de baixo com o botao Gerar e a gaveta Mais ---- */
  var MAIS = null;
  function telaAtual() {
    var r = S.rota, sub = S.sub, R = ROTAS[r] || ROTAS.inicio, p;
    var t = { titulo: R.menu, voltar: '' };
    if (r === 'propostas') t.titulo = sub === 'lista' ? 'Minhas propostas' : 'Gerar proposta';
    else if (r === 'equipamentos' && sub && (p = produtoPor(sub))) { t.titulo = p.nome; t.voltar = 'equipamentos'; }
    else if (r === 'parceria' && sub === 'termo') { t.titulo = 'Termo de Parceria'; t.voltar = 'parceria'; }
    if (!t.voltar && r !== 'inicio' && r !== 'oportunidades' && r !== 'propostas') t.voltar = 'inicio';
    return t;
  }
  function topoHTML() {
    var t = telaAtual(), logo = imgSegura(S.eu && S.eu.empresa && S.eu.empresa.logo_base64), nome = nomeEmpresa() || 'Sua empresa';
    var parc = logo ? '<img src="' + esc(logo) + '" alt="">' : '<span>' + esc(nome) + '</span>';
    return '<div class="np-top-1"><img class="nx" src="/gerador/nexus-logo-tela.png" alt="NEXUS Eletropostos">' +
      '<button type="button" class="np-top-parc" data-acao="ir" data-arg="perfil" aria-label="Em parceria com ' + esc(nome) + '. Abrir o perfil da empresa"><small>Em parceria com</small><span class="pill">' + parc + '</span></button></div>' +
      '<div class="np-top-2">' + (t.voltar ? '<button type="button" class="np-voltar" data-acao="voltar" data-arg="' + esc(t.voltar) + '" aria-label="Voltar">' + ic('voltar') + '</button>' : '') +
      '<p class="np-top-tit">' + esc(t.titulo) + '</p></div>';
  }
  function tabsHTML() {
    var r = S.rota, sub = S.sub;
    var itens = [
      { k: 'inicio', rot: 'Início', icone: 'inicio', arg: 'inicio', at: r === 'inicio' },
      { k: 'propostas', rot: 'Propostas', icone: 'propostas', arg: 'propostas/lista', at: r === 'propostas' && sub === 'lista' },
      { k: 'gerar', rot: 'Gerar', icone: 'gerar', arg: 'propostas', at: r === 'propostas' && sub !== 'lista', central: true },
      { k: 'oportunidades', rot: 'Oportunidade', icone: 'oportunidades', arg: 'oportunidades', at: r === 'oportunidades', tr: travada('oportunidades') }
    ];
    var h = '';
    itens.forEach(function (it) {
      var at = it.at ? ' aria-current="page"' : '';
      if (it.central) {
        h += '<button type="button" class="np-tab np-gerar' + (it.at ? ' ativa' : '') + '" data-acao="gerarProposta"' + at + '><span class="fab">' + ic('gerar') + '</span><span class="rot">' + it.rot + '</span></button>';
        return;
      }
      h += '<button type="button" class="np-tab' + (it.at ? ' ativa' : '') + '" data-acao="irTab" data-arg="' + it.arg + '"' + at + '>' + ic(it.icone) + (it.tr ? ic('cadeado', 'np-cad') + '<span class="sr">, travado</span>' : '') + '<span class="rot">' + esc(it.rot) + '</span></button>';
    });
    var emMais = !(r === 'inicio' || r === 'propostas' || r === 'oportunidades');
    h += '<button type="button" class="np-tab' + (emMais ? ' ativa' : '') + '" data-acao="abrirMais" aria-haspopup="dialog">' + ic('mais') + '<span class="rot">Mais</span></button>';
    return h;
  }
  function folhaHTML() {
    var lista = ['equipamentos', 'servicos'].concat(MOSTRAR_USINAS ? ['usinas'] : []).concat(['parceria', 'materiais', 'perfil', 'instalar']);
    var algumTravado = false;
    var h = '<div class="np-folha-cab"><div class="np-alca" aria-hidden="true"></div><div class="np-folha-tit"><div><b id="np-folha-tit">Mais</b><small>' + esc([nomeEmpresa() || 'Sua empresa', NIVEL_NOME[nivel()] || ''].filter(Boolean).join(' · ')) + '</small></div>' +
      '<button type="button" class="np-icobtn claro" data-acao="fecharMais" data-foco aria-label="Fechar o menu">' + ic('fechar') + '</button></div></div>';
    h += '<div class="np-folha-corpo"><div class="np-grade-f">';
    lista.forEach(function (r) {
      var tr = travada(r);
      if (tr) algumTravado = true;
      h += '<button type="button" class="np-f-tile' + (S.rota === r ? ' ativa' : '') + '" data-acao="ir" data-arg="' + r + '"' + (S.rota === r ? ' aria-current="page"' : '') + '><span class="ico">' + ic(r) + (tr ? '<span class="cad">' + ic('cadeado', 'p') + '</span>' : '') + '</span>' +
        '<span class="rot">' + esc(ROTAS[r].menu) + (tr ? '<span class="sr">, travado</span>' : '') + '</span></button>';
    });
    if (admOk()) h += '<a class="np-f-tile" href="/nexus/adm"><span class="ico">' + ic('escudo') + '</span><span class="rot">ADM</span></a>';
    h += '<button type="button" class="np-f-tile sair" data-acao="sairConta"><span class="ico">' + ic('sair') + '</span><span class="rot">' + (S.demo ? 'Sair da demonstração' : 'Sair') + '</span></button>';
    h += '</div>' + (algumTravado ? '<p class="np-f-nota">' + ic('cadeado', 'p') + '<span>Item com cadeado libera com o seu nível. Toque nele para ver como chegar.</span></p>' : '');
    h += '</div>';
    return h;
  }
  function montarCasca() {
    var root = $('#nx-root');
    root.innerHTML =
      '<header class="np-top" id="np-top"></header>' +
      '<aside class="np-lado" id="np-lado"></aside>' +
      '<div class="np-corpo" id="np-corpo"><header class="np-head" id="np-head"></header><main class="np-main" id="nx-main" tabindex="-1"></main></div>' +
      '<nav class="np-tabs" id="np-tabs" aria-label="Menu do aplicativo"></nav>' +
      '<div class="np-banner" id="np-banner" role="region" aria-label="Instalar o app NEXUS" hidden></div>' +
      '<div class="np-fundo" id="np-fundo" data-acao="fecharMais"></div>' +
      '<div class="np-folha" id="np-folha" role="dialog" aria-modal="true" aria-labelledby="np-folha-tit" tabindex="-1"></div>' +
      '<div class="nx-toast" id="nx-toast" role="status" hidden></div>';
    S.shell = true;
    MAIS = window.NexusFolha ? window.NexusFolha.criar({
      folha: $('#np-folha'), fundo: $('#np-fundo'),
      inertar: function () { return [$('#np-corpo'), $('#np-top'), $('#np-tabs'), $('#np-banner')]; },
      alvoVolta: function () { return $('#np-tabs [data-acao="abrirMais"]'); }
    }) : null;
  }
  function pintarNav() {
    if (!S.shell) return;
    $('#np-top').innerHTML = topoHTML();
    $('#np-lado').innerHTML = ladoHTML();
    $('#np-tabs').innerHTML = tabsHTML();
    if (!(MAIS && MAIS.aberta)) $('#np-folha').innerHTML = folhaHTML();
    $('#np-head').innerHTML = cobrandHTML() + '<button type="button" class="nx-btn np-head-cta" data-acao="ir" data-arg="propostas">Gerar proposta</button>';
    if (mobile()) document.title = telaAtual().titulo + ' · NEXUS Parceiro';
    pintarBanner();
  }
  function abrirMais(gatilho) {
    if (!MAIS) { toast('Não foi possível abrir o menu agora. Atualize a página.', true); irPara('perfil'); return; }
    $('#np-folha').innerHTML = folhaHTML(); MAIS.abrir(gatilho);
  }
  function fecharMais(semFoco) { if (MAIS && MAIS.aberta) MAIS.fechar(!semFoco); }

  /* ---- instalar como app (PWA) ----
     Referencia: dashboard/src/hooks/usePwaInstall.ts (deteccao), baixe-app/page.tsx (passos) e components/InstallBanner (convite e "fechar"). */
  var URL_APP = 'solardoc.app/nexus/app';
  var CHAVE_FECHOU = 'nexus_install_dismiss';
  var DIAS_SEM_VOLTAR = 30;
  function emApp() { return !!(S.instalouAgora || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true); }
  function ehIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  /* 'ios' (Safari), 'ios-outro' (iPhone em outro navegador: so o Safari instala), 'android' ou 'desktop'. */
  function aparelho() {
    var ua = navigator.userAgent || '';
    if (ehIOS()) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|Instagram|FBAN|FBAV/.test(ua) ? 'ios-outro' : 'ios';
    return /Android/i.test(ua) ? 'android' : 'desktop';
  }

  /* QR code em SVG, codigo proprio: modo byte, correcao L, versoes 1 a 4 (ate 78 bytes, um bloco so). Devolve a matriz [linha][coluna] de 0/1.
     O segundo parametro (mascara de 0 a 7) so serve para conferir contra outra biblioteca; sem ele escolhe a de menor penalidade. */
  function qrMatriz(texto, forca) {
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(texto)), TAB = [null, [19, 7], [34, 10], [55, 15], [80, 20]], v = 1, i, j, r, c;
    while (v <= 4 && bytes.length > TAB[v][0] - 2) v++;
    if (v > 4) return null;
    var nd = TAB[v][0], ne = TAB[v][1], tam = 17 + 4 * v, bits = [];
    function por(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    por(4, 4); por(bytes.length, 8); bytes.forEach(function (b) { por(b, 8); });
    por(0, Math.min(4, nd * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var cw = [];
    for (i = 0; i < bits.length; i += 8) { var x = 0; for (j = 0; j < 8; j++) x = x * 2 + bits[i + j]; cw.push(x); }
    for (var pad = 0xEC; cw.length < nd; pad ^= 0xEC ^ 0x11) cw.push(pad);
    /* Reed-Solomon sobre GF(256), polinomio 0x11D */
    var EXP = [], LOG = [], g = [1], q = 1;
    for (i = 0; i < 255; i++) { EXP[i] = q; LOG[q] = i; q <<= 1; if (q & 256) q ^= 0x11D; }
    function mul(a, b) { return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }
    for (i = 0; i < ne; i++) { var ng = g.concat([0]); for (j = 0; j < g.length; j++) ng[j + 1] ^= mul(g[j], EXP[i]); g = ng; }
    var rem = [];
    for (i = 0; i < ne; i++) rem.push(0);
    cw.forEach(function (b) { var f = b ^ rem.shift(); rem.push(0); for (var k = 0; k < ne; k++) rem[k] ^= mul(g[k + 1], f); });
    cw = cw.concat(rem);
    /* desenho: padroes fixos, formato, dados em zigue-zague, mascara */
    var M = [], Fx = [];
    for (i = 0; i < tam; i++) { M.push([]); Fx.push([]); for (j = 0; j < tam; j++) { M[i].push(0); Fx[i].push(false); } }
    function pos(rr, cc, val) { M[rr][cc] = val ? 1 : 0; Fx[rr][cc] = true; }
    [[0, 0], [0, tam - 7], [tam - 7, 0]].forEach(function (p) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = p[0] + dr, cc = p[1] + dc;
        if (rr < 0 || cc < 0 || rr >= tam || cc >= tam) continue;
        var d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        pos(rr, cc, d !== 2 && d !== 4);
      }
    });
    for (i = 8; i < tam - 8; i++) { pos(6, i, i % 2 === 0); pos(i, 6, i % 2 === 0); }
    if (v >= 2) { var al = tam - 7; for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++) pos(al + r, al + c, Math.max(Math.abs(r), Math.abs(c)) !== 1); }
    function formato(m) {
      var d = (1 << 3) | m, rm = d;
      for (var k = 0; k < 10; k++) rm = (rm << 1) ^ ((rm >>> 9) * 0x537);
      var b = ((d << 10) | rm) ^ 0x5412;
      function bt(n) { return (b >>> n) & 1; }
      for (var a = 0; a <= 5; a++) pos(a, 8, bt(a));
      pos(7, 8, bt(6)); pos(8, 8, bt(7)); pos(8, 7, bt(8));
      for (a = 9; a < 15; a++) pos(8, 14 - a, bt(a));
      for (a = 0; a < 8; a++) pos(8, tam - 1 - a, bt(a));
      for (a = 8; a < 15; a++) pos(tam - 15 + a, 8, bt(a));
      pos(tam - 8, 8, 1);
    }
    formato(0);
    var n = 0;
    for (var dir = tam - 1; dir >= 1; dir -= 2) {
      if (dir === 6) dir = 5;
      for (var vert = 0; vert < tam; vert++) for (j = 0; j < 2; j++) {
        var cc2 = dir - j, rr2 = ((dir + 1) & 2) === 0 ? tam - 1 - vert : vert;
        if (!Fx[rr2][cc2] && n < cw.length * 8) { M[rr2][cc2] = (cw[n >>> 3] >>> (7 - (n & 7))) & 1; n++; }
      }
    }
    function mascara(m) {
      for (var rr = 0; rr < tam; rr++) for (var cc = 0; cc < tam; cc++) {
        if (Fx[rr][cc]) continue;
        var t = m === 0 ? (rr + cc) % 2 === 0 : m === 1 ? rr % 2 === 0 : m === 2 ? cc % 3 === 0 : m === 3 ? (rr + cc) % 3 === 0 :
          m === 4 ? (Math.floor(rr / 2) + Math.floor(cc / 3)) % 2 === 0 : m === 5 ? (rr * cc) % 2 + (rr * cc) % 3 === 0 :
          m === 6 ? ((rr * cc) % 2 + (rr * cc) % 3) % 2 === 0 : ((rr + cc) % 2 + (rr * cc) % 3) % 2 === 0;
        if (t) M[rr][cc] ^= 1;
      }
    }
    function penalidade() {
      var p = 0, escuros = 0, a, b, linha;
      for (a = 0; a < tam; a++) for (b = 0; b < tam; b++) escuros += M[a][b];
      for (var sentido = 0; sentido < 2; sentido++) for (a = 0; a < tam; a++) {
        linha = [];
        for (b = 0; b < tam; b++) linha.push(sentido ? M[b][a] : M[a][b]);
        var seq = 1;
        for (b = 1; b < tam; b++) { if (linha[b] === linha[b - 1]) { seq++; if (seq === 5) p += 3; else if (seq > 5) p++; } else seq = 1; }
        var s = linha.join('');
        for (b = 0; b + 11 <= tam; b++) { var w = s.substr(b, 11); if (w === '10111010000' || w === '00001011101') p += 40; }
      }
      for (a = 0; a < tam - 1; a++) for (b = 0; b < tam - 1; b++) { var z = M[a][b]; if (z === M[a][b + 1] && z === M[a + 1][b] && z === M[a + 1][b + 1]) p += 3; }
      return p + (Math.ceil(Math.abs(escuros * 20 - tam * tam * 10) / (tam * tam)) - 1) * 10;
    }
    var melhor = forca != null ? forca : 0, menor = Infinity;
    if (forca == null) {
      for (var m = 0; m < 8; m++) { mascara(m); formato(m); var pn = penalidade(); mascara(m); if (pn < menor) { menor = pn; melhor = m; } }
    }
    mascara(melhor); formato(melhor);
    return M;
  }
  function qrSvg(texto, aria) {
    var m = qrMatriz(texto);
    if (!m) return '';
    var n = m.length, b = 4, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + b) + ' ' + (r + b) + 'h1v1h-1z';
    return '<svg class="np-qr" viewBox="0 0 ' + (n + 2 * b) + ' ' + (n + 2 * b) + '" role="img" aria-label="' + esc(aria) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#0B1A2B"/></svg>';
  }

  /* Tela #instalar: o aparelho detectado vem primeiro, os outros ficam abaixo. */
  function passosHTML(lista) {
    return '<ol class="np-ipass">' + lista.map(function (p) {
      return '<li><span class="tx">' + p.t + '</span>' + (p.ico ? '<span class="figura" aria-hidden="true">' + ic(p.ico) + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  function botaoCopiar() {
    return '<button type="button" class="nx-btn sec np-copiar" data-acao="copiarEndereco" aria-label="Copiar o endereço ' + URL_APP + '">' + ic('copiar', 'p') + 'Copiar endereço</button>';
  }
  function cartaoInst(id, titulo, sub, ico, destaque, corpo) {
    return '<section class="nx-cartao np-icard' + (destaque ? ' destaque' : '') + '" aria-labelledby="ic-' + id + '"><div class="cab"><span class="ico">' + ic(ico) + '</span>' +
      '<div class="nm"><h2 id="ic-' + id + '">' + titulo + '</h2><small>' + sub + '</small></div>' + (destaque ? '<span class="nx-chip az">Seu aparelho</span>' : '') + '</div>' + corpo + '</section>';
  }
  function cartaoAndroid(dest) {
    return cartaoInst('android', 'Android', 'Chrome', 'celular', dest, S.instalarEv
      ? '<p class="np-ip">O seu navegador instala o app com um toque.</p><button type="button" class="nx-btn grande" data-acao="instalarApp">Instalar agora</button>'
      : passosHTML([
        { t: 'Toque nos <b>três pontos</b> no canto de cima', ico: 'pontos' },
        { t: 'Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>', ico: 'instalar' },
        { t: 'Confirme' }
      ]));
  }
  function cartaoIPhone(dest, foraSafari) {
    var aviso = foraSafari
      ? '<div class="np-iaviso" role="note"><b>Você não está no Safari.</b><span>No iPhone só o Safari instala o app. Copie o endereço, abra o Safari e cole lá.</span><span class="np-end">' + URL_APP + '</span>' + botaoCopiar() + '</div>'
      : '';
    return cartaoInst('iphone', 'iPhone', 'Safari', 'celular', dest, aviso + passosHTML([
      { t: 'Abra no <b>Safari</b>', ico: 'bussola' },
      { t: 'Toque em <b>Compartilhar</b> (o quadrado com a seta)', ico: 'compartilhar' },
      { t: 'Role e toque em <b>Adicionar à Tela de Início</b>', ico: 'maisq' },
      { t: 'Toque em <b>Adicionar</b>' }
    ]));
  }
  function cartaoComputador(dest) {
    return cartaoInst('computador', 'Computador', 'Abra no celular', 'monitor', dest,
      '<div class="np-pc"><div class="qr">' + qrSvg('https://' + URL_APP, 'QR code para abrir ' + URL_APP + ' no celular') + '</div>' +
      '<div class="end"><p class="np-ip">Aponte a câmera do celular para o QR code ou abra o endereço no navegador do celular.</p><p class="np-end grande">' + URL_APP + '</p>' + botaoCopiar() + '</div></div>');
  }
  function telaInstalar() {
    var ap = aparelho(), h = '<div class="np-pagina"><section class="np-sec np-instalar"><h1 class="nx-h1" style="margin:0">Instalar o app</h1>' +
      '<p class="np-sub-i">Deixe o Portal do Parceiro NEXUS na tela do seu aparelho, como qualquer outro app.</p>';
    if (emApp()) {
      h += '<section class="nx-cartao np-iok" role="status"><span class="ico">' + ic('check') + '</span><div><h2>O app NEXUS já está instalado neste aparelho.</h2><p>Abra o portal pelo ícone na tela inicial.</p></div></section>';
    } else {
      var cartoes = { android: cartaoAndroid, ios: cartaoIPhone, computador: cartaoComputador };
      var primeiro = ap === 'android' ? 'android' : ap === 'desktop' ? 'computador' : 'ios';
      var outros = ['ios', 'android', 'computador'].filter(function (k) { return k !== primeiro; });
      h += cartoes[primeiro](true, ap === 'ios-outro');
      h += '<h2 class="np-outros">Em outros aparelhos</h2>' + outros.map(function (k) { return cartoes[k](false, false); }).join('');
    }
    h += '<section class="nx-cartao np-ioferece"><h2>O que o app oferece</h2><ul class="np-checks">' +
      '<li>' + ic('check') + '<span>Abre em tela cheia, sem a barra do navegador.</span></li>' +
      '<li>' + ic('check') + '<span>Fica como atalho na tela inicial do aparelho.</span></li>' +
      '<li>' + ic('check') + '<span>Mesmas propostas e mesmo login do portal.</span></li></ul></section></section></div>';
    return h;
  }

  /* Cartao do Inicio no celular: instala direto quando o navegador permite, e sempre leva a #instalar. */
  function instalarHTML() {
    if (!mobile() || emApp()) return '';
    return '<div class="np-inst"><span class="ico">' + ic('instalar') + '</span><div class="tx"><b>Instalar app</b><span>Abra o portal direto da tela inicial, em tela cheia.</span></div>' +
      '<div class="acoes">' + (S.instalarEv ? '<button type="button" class="nx-btn" data-acao="instalarApp">Instalar agora</button>' : '') +
      '<button type="button" class="nx-btn ' + (S.instalarEv ? 'link' : '') + '" data-acao="ir" data-arg="instalar">Ver como instalar</button></div></div>';
  }

  /* Convite fixo no celular (padrao do InstallBanner do SolarDoc): so depois do login ou no demo, fora do app instalado. Fechar vale 30 dias. */
  function bannerFechado() {
    if (S.bannerFechado) return true;
    try {
      var t = Number(localStorage.getItem(CHAVE_FECHOU));
      return t > 0 && Date.now() - t < DIAS_SEM_VOLTAR * 86400000;
    } catch (e) { return false; }
  }
  function pintarBanner() {
    var el = $('#np-banner');
    if (!el) return;
    var ver = S.fase === 'app' && mobile() && !emApp() && S.rota !== 'instalar' && !bannerFechado();
    el.hidden = !ver;
    el.innerHTML = ver
      ? '<span class="ico" aria-hidden="true">' + ic('instalar') + '</span><div class="tx"><b>Instale o app NEXUS</b><span>Abre em tela cheia, direto da tela inicial.</span></div>' +
        '<button type="button" class="np-ban-btn" data-acao="bannerInstalar" aria-label="Instalar o app NEXUS">Instalar</button>' +
        '<button type="button" class="np-ban-x" data-acao="bannerFechar" aria-label="Fechar o convite para instalar o app. Ele só volta depois de 30 dias.">' + ic('fechar') + '</button>'
      : '';
    document.documentElement.classList.toggle('np-com-banner', ver);
  }
  function atualizarInstalar() {
    var el = document.getElementById('np-inst-ini');
    if (el) el.innerHTML = instalarHTML();
    if (!S.shell) return;
    pintarBanner();
    if (S.rota === 'instalar') pintarMain(true);
  }
  function instalarAgora() {
    var e = S.instalarEv;
    if (!e || typeof e.prompt !== 'function') return;
    S.instalarEv = null; atualizarInstalar();
    try {
      e.prompt();
      if (e.userChoice && e.userChoice.then) e.userChoice.then(function (r) { if (r && r.outcome === 'accepted') toast('App instalado.'); });
    } catch (x) { /* o navegador recusou: nada a fazer */ }
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.instalarEv = e; atualizarInstalar(); });
  window.addEventListener('appinstalled', function () { S.instalarEv = null; S.instalouAgora = true; atualizarInstalar(); });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/nexus/sw.js', { scope: '/nexus/' }).catch(function (e) { if (window.console) console.warn('sw nexus', e && e.message); });
    });
  }
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
      if (MAIS) { MAIS.fechar(false); MAIS = null; }
      S.shell = false;
      document.documentElement.classList.remove('np-com-banner');
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
    desligarIndice();
    var r = S.rota, h = faixaDemo(), pos = null;
    if (r !== 'servicos') S.engHost = null;
    if (r === 'inicio') { h += telaInicio(); pos = posInicio; }
    else if (r === 'equipamentos') { h += S.sub && produtoPor(S.sub) ? telaEquipamento(produtoPor(S.sub)) : telaEquipamentos(); pos = posEquipamento; }
    else if (r === 'servicos') { h += telaServicos(); pos = posServicos; }
    else if (r === 'propostas') { h += telaPropostas(); pos = posPropostas; }
    else if (r === 'oportunidades') { h += libera('oportunidades') ? telaRede('oportunidades') : telaOpsBloqueada(); pos = libera('oportunidades') ? function () { montarRede('oportunidades'); } : null; }
    else if (r === 'usinas') {
      h += travada(r) ? '<div class="np-pagina">' + trava(bloq(ROTAS[r].req), '<button type="button" class="nx-btn" data-acao="ir" data-arg="perfil">Completar o perfil</button>') + '</div>' : telaRede(r);
      pos = travada(r) ? null : function () { montarRede(r); };
    }
    else if (r === 'materiais') h += travada(r) ? '<div class="np-pagina">' + trava(bloq('materiais'), '<button type="button" class="nx-btn" data-acao="ir" data-arg="perfil">Completar o perfil</button>') + '</div>' : telaMateriais();
    else if (r === 'parceria') { h += telaParceria(); pos = posParceria; }
    else if (r === 'perfil') h += telaPerfil();
    else if (r === 'instalar') h += telaInstalar();
    main.innerHTML = h;
    if (!manter) {
      window.scrollTo(0, 0);
      try { main.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    }
    if (pos) pos();
    desenharGrafs();
    if (!manter && S.sec) irSecaoDepois(S.sec);
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
  /* Início: um só desenho para computador e celular. Ordem: nível e próximo passo, atalhos com informação viva, índice da página,
     resumo, carregadores, mercado (que era a aba Mercado), oportunidades, engenharia e faixa final. Só o bloco dos carregadores muda de forma. */
  var SEC_INICIO = [['resumo', 'Resumo', 'ini-resumo'], ['carregadores', 'Carregadores', 'ini-carregadores'], ['servicos', 'Serviços', 'ini-servicos'], ['mercado', 'Mercado', 'ini-mercado'], ['oportunidades', 'Oportunidade', 'ini-oportunidades']];
  var IO = null, ioFim = null;

  /* Próxima ação real: a primeira etapa de progresso.faltam que o parceiro mesmo pode cumprir. Se só falta aprovação da equipe, leva à Minha parceria. */
  function proximoPasso(pr) {
    var f = (pr && pr.faltam) || [], i, k;
    var agir = {
      perfil: { rot: 'Complete o perfil', acao: 'ir', arg: 'perfil' },
      primeira_proposta: { rot: 'Gere a primeira proposta', acao: 'ir', arg: 'propostas' },
      papel_montagem: { rot: 'Marque Montagem e Engenharia no perfil', acao: 'ir', arg: 'perfil' },
      primeira_compra: { rot: 'Peça o primeiro equipamento', acao: 'ir', arg: 'equipamentos' },
      compras: { rot: 'Peça mais equipamentos', acao: 'ir', arg: 'equipamentos' },
      aceite_termo: { rot: 'Aceite o Termo de Parceria', acao: 'irTermoParceria', arg: '' }
    };
    for (i = 0; i < f.length; i++) {
      k = f[i];
      if (k === 'conversa') {
        return libera('conversa') ? { rot: 'Agende a conversa com o comercial', acao: 'conversa', arg: '' }
          : { rot: 'Agende a conversa com o comercial', trava: 'conversa' };
      }
      if (agir[k]) return agir[k];
    }
    if (f.indexOf('aprovacao_montagem') >= 0) return { rot: 'Acompanhe a aprovação da montagem', acao: 'ir', arg: 'parceria' };
    if (f.length) return { rot: 'Acompanhe a aprovação da NEXUS', acao: 'ir', arg: 'parceria' };
    return { rot: 'Gere uma proposta', acao: 'ir', arg: 'propostas' };
  }
  function ctaPasso(pp) {
    if (pp.trava) return lk(pp.rot, pp.trava, '');
    return '<button type="button" class="nx-btn in-cta" data-acao="' + pp.acao + '"' + (pp.arg ? ' data-arg="' + esc(pp.arg) + '"' : '') + '>' + esc(pp.rot) + '</button>';
  }
  function nivelHTML() {
    var eu = S.eu, p = eu.parceiro || {}, nv = nivel(), idx = NIVEL_IDX[nv] || 1, pr = eu.progresso || {};
    var prox = pr.proximo ? NIVEL_NOME[pr.proximo] : '';
    var linha = [localParceiro(), p.raio_km ? 'raio de ' + fmt(p.raio_km) + ' km' : ''].filter(Boolean).join(' · ');
    var pp = proximoPasso(pr);
    return '<section class="in-nivel" aria-labelledby="ini-h1"><div class="in-nv-col">' +
      '<h1 class="in-ola" id="ini-h1">Olá, <b>' + esc(nomeEmpresa() || 'parceiro') + '</b></h1>' + (linha ? '<p class="in-loc">' + esc(linha) + '</p>' : '') +
      '<div class="in-nv"><div><span class="in-rot">Seu nível</span><p class="in-nome">' + esc(NIVEL_NOME[nv] || '') + '</p></div><span class="in-etapa">Etapa ' + idx + ' de 4</span></div>' +
      '<div class="in-barra" role="img" aria-label="Progresso até o próximo nível: etapa ' + idx + ' de 4"><i style="width:' + (idx * 25) + '%"></i></div>' +
      '<p class="in-prox">' + esc(prox ? 'Próximo nível: ' + prox + '. ' + COMO[nv] : COMO.master) + '</p>' +
      (textoFaltam(pr) ? '<p class="in-falta">' + esc(textoFaltam(pr)) + '</p>' : '') + '</div>' +
      '<div class="in-passo"><span class="in-rot">Próximo passo</span>' + ctaPasso(pp) + '</div></section>';
  }

  /* atalhos com informação viva */
  function propostasSub() {
    var l = S.propostas;
    if (!l) return S.propEstado === 'erro' ? 'Ver as suas propostas' : 'Carregando';
    if (!l.length) return 'Nenhuma gerada ainda';
    var m = l.filter(function (p) { return num(p.aberturas) > 0; }).length;
    return l.length + (l.length === 1 ? ' gerada' : ' geradas') + ' · ' + m + (m === 1 ? ' aberta' : ' abertas') + ' pelo cliente';
  }
  function servicosSub() {
    var sd = saldoEng();
    if (sd && sd.comprados > 0) return 'Saldo: ' + sd.disponiveis + (sd.disponiveis === 1 ? ' projeto' : ' projetos');
    return travada('servicos') ? bloq('pacotes_engenharia') : 'Plataforma, engenharia e suporte';
  }
  function oportSub() {
    if (!libera('oportunidades')) return bloq('oportunidades');
    if (!S.ops) return S.opsErro ? 'Ver as oportunidades' : 'Carregando';
    var n = S.ops.filter(function (o) { return o.status === 'oferecida'; }).length;
    return n === 0 ? 'Nenhuma nova' : n === 1 ? '1 nova' : n + ' novas';
  }
  function tileInicio(rot, icone, destino, sub, subId, opc) {
    opc = opc || {};
    return '<button type="button" class="in-tile' + (opc.prim ? ' prim' : '') + '" data-acao="ir" data-arg="' + esc(destino) + '"><span class="ico">' + ic(icone) + '</span>' +
      '<span class="tx"><span class="rot">' + esc(rot) + (opc.trava ? '<span class="sr">, travado</span>' : '') + '</span><small class="sub"' + (subId ? ' id="' + subId + '"' : '') + '>' + esc(sub) + '</small></span>' +
      (opc.trava ? '<span class="cad">' + ic('cadeado', 'p') + '</span>' : '') + '</button>';
  }
  function atalhosHTML() {
    var ps = produtos(), nv = NIVEL_NOME[nivel()] || '';
    return '<section class="in-atalhos" aria-label="Atalhos">' +
      tileInicio('Gerar proposta', 'gerar', 'propostas', 'Simulador, Básico e Completo', '', { prim: true }) +
      tileInicio('Minhas propostas', 'propostas', 'propostas/lista', propostasSub(), 'in-sub-propostas') +
      tileInicio('Equipamentos', 'equipamentos', 'equipamentos', ps.length ? ps.length + (ps.length === 1 ? ' carregador da rede' : ' carregadores da rede') : 'Carregadores da rede') +
      tileInicio('Serviços NEXUS', 'servicos', 'servicos', servicosSub(), 'in-sub-servicos', { trava: travada('servicos') }) +
      tileInicio('Oportunidade', 'oportunidades', 'oportunidades', oportSub(), 'in-sub-oport', { trava: !libera('oportunidades') }) +
      tileInicio('Minha parceria', 'parceria', 'parceria', 'Nível ' + nv) + '</section>';
  }
  function indiceHTML() {
    return '<nav class="in-indice" id="ini-indice" aria-label="Nesta página">' + SEC_INICIO.map(function (s) {
      return '<a class="in-chip" href="#inicio/' + s[0] + '" data-acao="irSecao" data-arg="' + s[2] + '" data-sec="' + s[2] + '">' + esc(s[1]) + '</a>';
    }).join('') + '</nav>';
  }

  /* resumo do mês: o que o /eu e as listas já trazem; sem dado, "Sem dado" (zero é um número de verdade) */
  function celulaResumo(valor, rotulo) {
    var sem = valor == null;
    return '<div class="np-num"><strong' + (sem ? ' class="sem"' : '') + '>' + esc(sem ? 'Sem dado' : fmt(valor)) + '</strong><span>' + esc(rotulo) + '</span></div>';
  }
  function resumoCorpoHTML() {
    var c = (S.eu && S.eu.contagens) || {}, b = brt(), links = null, obras = null;
    if (S.propostas) {
      links = S.propostas.filter(function (p) {
        if (!(num(p.aberturas) > 0) || !p.ultima_abertura_em) return false;
        var u = brt(new Date(p.ultima_abertura_em));
        return u.ano === b.ano && u.mes === b.mes;
      }).length;
    }
    if (S.ops && libera('oportunidades')) obras = S.ops.filter(function (o) { return o.tipo === 'obra'; }).length;
    return celulaResumo(c.propostas_mes == null ? null : num(c.propostas_mes), 'Propostas geradas no mês') + celulaResumo(links, 'Links abertos pelos clientes') +
      celulaResumo(c.pedidos == null ? null : num(c.pedidos), 'Pedidos de equipamento') + celulaResumo(obras, 'Obras recebidas');
  }
  function atualizarVivo() {
    var a = $('#in-sub-propostas'); if (a) a.textContent = propostasSub();
    var b = $('#in-sub-oport'); if (b) b.textContent = oportSub();
    var c = $('#in-resumo-corpo'); if (c) c.innerHTML = resumoCorpoHTML();
  }

  function secaoCab(id, titulo, extra) {
    return '<div class="np-tit-linha"><div class="np-tit-grupo"><h2 id="' + id + '-t">' + esc(titulo) + '</h2>' + (S.demo && titulo !== 'Carregadores' && titulo !== 'Serviços NEXUS' ? '<span class="nx-chip ex">Dados de exemplo</span>' : '') + '</div>' + (extra || '') + '</div>';
  }
  function carregadoresHTML() {
    var ps = produtos(), h;
    if (!mobile()) return cardsProdutos();
    h = ps.length ? '<div class="ap-carrossel" role="region" aria-label="Carregadores da rede. Deslize para o lado para ver o próximo." tabindex="0">' + ps.map(cardCarrossel).join('') + '</div>' +
      (ps.length > 1 ? '<div class="ap-dots" aria-hidden="true">' + ps.map(function (x, i) { return '<i' + (i === 0 ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' : '')
      : '<div class="np-vazio-sec">O catálogo não carregou. Atualize a página.</div>';
    return h;
  }
  function cardCarrossel(p) {
    var I = infoDe(p);
    return '<article class="ap-car"><div class="foto"><img src="' + esc(fotoUrl(I.fotos[0])) + '" alt="' + esc(I.alt) + '" loading="lazy"></div><div class="c">' +
      '<div><h3>' + esc(p.nome) + '</h3><p class="ger">' + esc(I.tag) + '</p></div>' +
      '<div class="pr"><span class="np-rot">Preço de tabela</span><strong>' + esc(rs(p.precoSugerido)) + '</strong><small>Teto para o cliente final</small></div>' +
      '<div class="neg"><span class="np-rot">Seu preço de parceiro</span><b>Negociado com o comercial</b>' +
      (libera('negociar') ? '' : '<small class="np-lktx">' + ic('cadeado', 'p') + ' ' + esc(bloq('negociar')) + '</small>') + '</div>' +
      '<button type="button" class="nx-btn" data-acao="ir" data-arg="equipamentos/' + esc(p.id) + '">Ver detalhes</button>' +
      '<button type="button" class="nx-btn sec" data-acao="ir" data-arg="propostas">Gerar proposta</button></div></article>';
  }

  /* Início: os três serviços com o preço em destaque. O botão leva à tela Serviços NEXUS, na âncora do grupo. */
  function servicosInicioHTML() {
    var e1 = engValor(1), e5 = engValor(5) / 5, vMan = servValor('manutencao', MAN_PRECO);
    var cartoes = [
      ['plataforma', 'Plataforma NEXUS', 'O motorista carrega e paga pelo app. O dono do ponto acompanha tudo.', '10%', 'do que o ponto fatura em recarga', 'Ver plataforma', 'servicos/plataforma'],
      ['engenharia', 'Engenharia NEXUS', 'Projeto elétrico, ART do projeto e acompanhamento da homologação na distribuidora.', 'De ' + rs(e5) + ' a ' + rs(e1), 'por projeto', 'Ver engenharia', 'servicos/engenharia'],
      ['servicos', 'Suporte NEXUS', 'Ativação, suporte técnico, garantia e treinamento. Manutenção e apoio de venda opcionais.', 'Incluído no carregador', 'manutenção ' + rs(vMan) + ' por mês', 'Ver suporte', 'servicos/suporte']
    ];
    return '<section class="in-sec" id="ini-servicos" tabindex="-1" aria-labelledby="ini-servicos-t">' + secaoCab('ini-servicos', 'Serviços NEXUS') +
      '<p class="nx-sub in-sub">Plataforma, engenharia e suporte para você revender carregadores NEXUS.</p><div class="in-serv-grade">' + cartoes.map(function (c) {
        return '<article class="in-serv" data-serv-inicio="' + esc(c[0]) + '"><span class="ico">' + ic(c[0]) + '</span><h3>' + esc(c[1]) + '</h3><p>' + esc(c[2]) + '</p>' +
          '<div class="in-serv-preco"><span class="np-rot">Preço</span><strong>' + esc(c[3]) + '</strong><small>' + esc(c[4]) + '</small></div>' +
          '<button type="button" class="nx-btn sec" data-acao="ir" data-arg="' + esc(c[6]) + '">' + esc(c[5]) + '</button></article>';
      }).join('') + '</div></section>';
  }
  function telaInicio() {
    var h = '<div class="in">';
    h += nivelHTML();
    h += '<div id="np-inst-ini">' + instalarHTML() + '</div>';
    h += atalhosHTML();
    h += indiceHTML();
    h += '<section class="in-sec" id="ini-resumo" tabindex="-1" aria-labelledby="ini-resumo-t">' + secaoCab('ini-resumo', 'Resumo do mês') + '<div class="in-nums" id="in-resumo-corpo">' + resumoCorpoHTML() + '</div></section>';
    h += '<section class="in-sec" id="ini-carregadores" tabindex="-1" aria-labelledby="ini-carregadores-t">' +
      secaoCab('ini-carregadores', 'Carregadores', '<button type="button" class="np-linkgrande" data-acao="ir" data-arg="equipamentos">Ver todos</button>') + carregadoresHTML() + '</section>';
    h += servicosInicioHTML();
    h += '<section class="in-sec" id="ini-mercado" tabindex="-1" aria-labelledby="ini-mercado-t">' + secaoCab('ini-mercado', 'Mercado') +
      '<p class="nx-sub in-sub">A procura por eletroposto que chega à NEXUS e a frota de veículos plug-in, com o seu estado em destaque.</p>' +
      '<h3 class="in-h3">Procura por eletroposto</h3><div id="in-m-proc">' + girando('Carregando a procura') + '</div>' +
      '<div id="in-m-frota">' + girando('Carregando o mercado') + '</div><div class="in-fontes" id="in-m-fontes"></div></section>';
    h += '<section class="in-sec" id="ini-oportunidades" tabindex="-1" aria-labelledby="ini-oportunidades-t">' +
      secaoCab('ini-oportunidades', 'Oportunidades na sua região', libera('oportunidades') ? '<button type="button" class="np-linkgrande" data-acao="ir" data-arg="oportunidades">Ver todas</button>' : '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>') +
      '<div id="np-opsini">' + (libera('oportunidades') ? girando('Carregando as oportunidades') : opsBloqueadasHTML()) + '</div></section>';
    h += '<section class="np-chamadas in-chamadas"><div class="np-chamada"><span class="ico">' + ic('engenharia') + '</span><h3>Engenharia NEXUS</h3><p>Precisa de projeto elétrico, ART, estudo da entrada de energia ou homologação na distribuidora? A NEXUS faz para você.</p>' +
      '<button type="button" class="nx-btn" data-acao="ir" data-arg="servicos/pedir">Pedir engenharia</button></div></section>';
    h += '<section class="np-rodape"><p>A NEXUS é importadora. O cliente e a obra da sua região são seus.</p><p>Nada é cobrado sobre a sua obra. Sem mensalidade. Sem taxa de entrada.</p></section>';
    return h + '</div>';
  }
  function posInicio() {
    carregarProcura('in-m-proc');
    carregarFrota(pintarMercadoFrota, 'in-m-frota');
    carregarPropostasInicio();
    if (libera('oportunidades')) carregarOpsInicio();
    var car = $('.ap-carrossel');
    if (car && car.children.length > 1) {
      car.addEventListener('scroll', function () {
        var w = car.children[0].offsetWidth + 12, n = car.children.length;
        var i = car.scrollLeft + car.clientWidth >= car.scrollWidth - 2 ? n - 1 : Math.round(car.scrollLeft / w);
        $$('.ap-dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
      }, { passive: true });
    }
    observarSecoes();
  }
  function carregarPropostasInicio() {
    var t = S.tela;
    S.propEstado = S.propostas ? 'ok' : 'carregando';
    listarPropostas().then(function (l) { S.propostas = l; S.propErro = false; S.propEstado = 'ok'; }, function () { if (!S.propostas) S.propEstado = 'erro'; }).then(function () {
      if (S.tela !== t) return;
      atualizarVivo(); reajustarSecao();
    });
  }

  /* índice da página: seção atual marcada (IntersectionObserver), toque leva à seção */
  function reduzMovimento() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function rolarPara(id, suave) {
    var el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ block: 'start', behavior: suave && !reduzMovimento() ? 'smooth' : 'auto' });
    try { el.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    return true;
  }
  /* Chegou por #mercado ou #engenharia: rola depois de pintar e de novo quando o conteúdo de cima termina de carregar, até o parceiro mexer na tela. */
  function irSecaoDepois(id) {
    S.secPend = id; S.secAte = Date.now() + 5000;
    requestAnimationFrame(function () { rolarPara(id, false); });
  }
  function reajustarSecao() { if (S.secPend && Date.now() < S.secAte) rolarPara(S.secPend, false); }
  function marcarChip(id) {
    var linha = $('#ini-indice');
    $$('.in-chip').forEach(function (a) {
      var on = a.dataset.sec === id;
      a.classList.toggle('ativa', on);
      if (on) { a.setAttribute('aria-current', 'true'); if (linha && linha.scrollWidth > linha.clientWidth) linha.scrollLeft = Math.max(0, a.offsetLeft - 16); }
      else a.removeAttribute('aria-current');
    });
  }
  function desligarIndice() {
    if (IO) { IO.disconnect(); IO = null; }
    if (ioFim) { window.removeEventListener('scroll', ioFim); ioFim = null; }
  }
  function observarSecoes() {
    desligarIndice();
    if (!('IntersectionObserver' in window)) return;
    var ids = SEC_INICIO.map(function (s) { return s[2]; }), noFim = false;
    var topo = mobile() ? 160 : 110;
    /* Seção atual = a última cuja borda de cima já passou da linha logo abaixo das barras fixas. O IntersectionObserver só avisa quando recalcular. */
    function avaliar() {
      var ativo = '';
      if (noFim) ativo = ids[ids.length - 1];
      else ids.forEach(function (id) { var el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= topo + 8) ativo = id; });
      marcarChip(ativo);
    }
    IO = new IntersectionObserver(function () { avaliar(); }, { rootMargin: '-' + topo + 'px 0px -55% 0px', threshold: [0, .1, .25, .5, .75, 1] });
    ids.forEach(function (id) { var el = document.getElementById(id); if (el) IO.observe(el); });
    var espera = false;
    ioFim = function () {
      if (espera) return;
      espera = true;
      requestAnimationFrame(function () {
        espera = false;
        noFim = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        avaliar();
      });
    };
    window.addEventListener('scroll', ioFim, { passive: true });
  }

  /* mercado: procura (API) e frota (JSON) */
  function pintarFontes() {
    var el = $('#in-m-fontes');
    if (!el) return;
    var F = S.frota, uf = ufDoParceiro(), d = S.procura[uf || 'BR'], f = [], h = '';
    if (F) f.push(F.fonte.split(',')[0] + ', ' + F.anterior.rotulo.split(' ')[0] + ' e ' + F.referencia.rotulo + ' (frota plug-in por estado e município)');
    if (d && d.meses) f.push(fonteProcura(d.meses).replace(/^Fonte: /, '').replace(/\.$/, '') + ' (reuniões de eletroposto)');
    if (f.length) h += '<p class="np-fonte">Fontes: ' + esc(f.join('; ')) + '.</p>';
    if (F && F.definicao) h += '<p class="np-fonte">' + esc(F.definicao) + '</p>';
    el.innerHTML = h;
  }
  function procuraInicioHTML(d, uf) {
    var usaUf = !!uf && d.meses.every(function (m) { return m.uf_total != null; });
    var h = '<div class="np-par">';
    if (uf) h += '<div class="np-card"><span class="np-grande">' + esc(fmt(d.reunioes_90d_uf)) + '</span><p class="tit">Reuniões de eletroposto em ' + esc(nomeUf(uf)) + ' nos últimos 90 dias</p><p class="nota">Só conta reuniões com o estado identificado.</p></div>';
    else h += '<div class="np-card"><h3>Informe a UF da sua empresa</h3><p class="nota">Com a UF no perfil, mostramos a procura por eletroposto no seu estado.</p><button type="button" class="nx-btn sec" data-acao="ir" data-arg="perfil">Completar o perfil</button></div>';
    h += '<div class="np-card dois"><h3>' + (usaUf ? 'Reuniões de eletroposto em ' + esc(nomeUf(uf)) + ', por mês' : 'Reuniões de eletroposto agendadas pela NEXUS no Brasil, por mês') + '</h3>' + colunasMeses(d, uf) + '</div></div>';
    if (d.pct_fora_mg_go_df != null) h += '<div class="np-faixa-pct"><span class="p">' + esc(Math.round(d.pct_fora_mg_go_df)) + '%</span>da procura com estado identificado vem de fora de MG, GO e DF. É aí que entra o parceiro regional.</div>';
    return h;
  }
  function pintarMercadoFrota() {
    var el = $('#in-m-frota');
    if (!el) return;
    el.innerHTML = frotaInicioHTML();
    desenharGrafs(); pintarFontes(); reajustarSecao();
  }
  function linhasRanking(todos) {
    var uf = ufDoParceiro(), es = dadosEstados().sort(function (a, b) { return b.jul - a.jul; });
    var lista = todos ? es : es.slice(0, 5), linhas = [];
    lista.forEach(function (e) { linhas.push({ rot: e.uf, val: e.jul, txt: fmt(e.jul) + ' · ' + sinal(e.pct, 1) + '%', dest: e.uf === uf }); });
    if (!todos && uf) {
      es.forEach(function (e) { if (e.uf === uf && !lista.some(function (x) { return x.uf === uf; })) linhas.push({ rot: e.uf, val: e.jul, txt: fmt(e.jul) + ' · ' + sinal(e.pct, 1) + '%', dest: true, sep: true }); });
    }
    return linhas;
  }
  function rankingChart(todos) {
    var linhas = linhasRanking(todos), F = S.frota;
    var aria = 'Gráfico de barras horizontais da frota de veículos plug-in por estado em ' + F.referencia.rotulo + ' e o crescimento sobre ' + F.anterior.rotulo.split(' ')[0] + ', ' + (todos ? 'nos ' + linhas.length + ' estados' : 'os 5 maiores' + (ufDoParceiro() ? ' e o seu estado' : '')) + ': ' +
      linhas.map(function (l) { return l.rot + ' ' + l.txt; }).join(', ');
    return registrarGraf(function (W) { return svgBarrasH(W, linhas, aria, { rowH: todos ? 26 : 30, barH: todos ? 17 : 19 }); });
  }
  function frotaInicioHTML() {
    var F = S.frota, uf = ufDoParceiro(), es = dadosEstados();
    var meu = es.filter(function (e) { return e.uf === uf; })[0];
    var mesA = F.anterior.rotulo.split(' ')[0], mesB = F.referencia.rotulo.split(' ')[0];
    var bj = F.brasil.julho, bn = F.brasil.junho, alta = bn > 0 ? (bj / bn - 1) * 100 : 0;
    var h = '<h3 class="in-h3">Frota plug-in</h3><div class="np-par">';
    if (meu) {
      var rank = es.slice().sort(function (a, b) { return b.jul - a.jul; }).map(function (e) { return e.uf; }).indexOf(uf) + 1;
      h += '<div class="np-escuro"><span class="np-rot">' + esc(meu.nome) + '</span><span class="v">' + esc(fmt(meu.jul)) + '</span><p>Veículos plug-in em ' + esc(F.referencia.rotulo) + '</p>' +
        '<dl class="in-f3"><div><dt>' + esc(mesA.charAt(0).toUpperCase() + mesA.slice(1)) + '</dt><dd>' + esc(fmt(meu.jun)) + '</dd></div><div><dt>' + esc(mesB.charAt(0).toUpperCase() + mesB.slice(1)) + '</dt><dd>' + esc(fmt(meu.jul)) + '</dd></div>' +
        '<div><dt>Crescimento</dt><dd>' + esc(sinal(meu.pct, 1)) + '%</dd></div></dl>' +
        '<p class="s">' + esc(sinal(meu.dif)) + ' carros no mês. É o ' + rank + 'º estado do Brasil em frota plug-in.</p></div>';
    } else {
      h += '<div class="np-card"><span class="np-grande m">' + esc(fmt(bj)) + '</span><p class="tit">Veículos plug-in no Brasil em ' + esc(F.referencia.rotulo) + '</p><p class="nota">Informe a UF da empresa no perfil para ver a frota, a posição e as cidades do seu estado.</p>' +
        '<button type="button" class="nx-btn sec" data-acao="ir" data-arg="perfil">Completar o perfil</button></div>';
    }
    h += '<div class="np-card"><h3>Brasil</h3><div class="in-f3 claro"><div><span>' + esc(F.referencia.rotulo) + '</span><b>' + esc(fmt(bj)) + '</b></div><div><span>' + esc(F.anterior.rotulo) + '</span><b>' + esc(fmt(bn)) + '</b></div><div><span>Crescimento</span><b>' + esc(sinal(alta, 1)) + '%</b></div></div>' +
      '<p class="nota">' + esc(sinal(bj - bn)) + ' carros plug-in a mais em um mês.</p></div></div>';
    if (meu) {
      var cid = F.cidades.filter(function (c) { return c.uf === uf; }).sort(function (a, b) { return b.julho - a.julho; }).slice(0, 5);
      h += '<div class="np-card"><div><h3>Onde vender no seu estado</h3><p class="nota">' + (cid.length ? 'As ' + (cid.length === 1 ? 'cidade' : cid.length + ' cidades') + ' de ' + esc(meu.nome) + ' com mais carros plug-in, entre as que têm ' + esc(F.piso_cidade) + ' ou mais veículos.' : '') + '</p></div>';
      if (cid.length) {
        var lc = cid.map(function (c) { return { rot: c.nome, val: c.julho, txt: fmt(c.julho) }; });
        var ariaC = 'Gráfico de barras horizontais das cidades de ' + meu.nome + ' com mais carros plug-in em ' + F.referencia.rotulo + ': ' + lc.map(function (l) { return l.rot + ' ' + l.txt; }).join(', ');
        h += registrarGraf(function (W) { return svgBarrasH(W, lc, ariaC, { rowH: 30, barH: 19 }); });
      } else h += '<div class="np-vazio-sec">Nenhuma cidade do estado chega a ' + esc(F.piso_cidade) + ' veículos plug-in.</div>';
      h += '</div>';
    }
    h += '<div class="np-card"><div><h3>Ranking do Brasil</h3><p class="nota">Frota plug-in em ' + esc(F.referencia.rotulo) + ' e crescimento sobre ' + esc(mesA) + '.' + (uf ? ' ' + esc(nomeUf(uf)) + ' em destaque.' : '') + '</p></div>' +
      '<div id="in-m-rank">' + rankingChart(!!S.todosEstados) + '</div>' +
      '<button type="button" class="nx-btn sec in-27" data-acao="estados27" aria-expanded="' + (!!S.todosEstados) + '" aria-controls="in-m-rank">' + (S.todosEstados ? 'Ver só os 5 primeiros' : 'Ver os ' + es.length + ' estados') + '</button></div>';
    return h;
  }
  function opMini(o) {
    var local = [cidadeUf(o.cidade, o.uf), o.distancia_km != null ? fmt(o.distancia_km) + ' km' : ''].filter(Boolean).join(' · ');
    return '<button type="button" class="ap-op" data-acao="ir" data-arg="oportunidades"><span class="c"><span class="t"><span class="np-tipo' + (o.tipo === 'obra' ? '' : ' cli') + '">' + esc(tipoOp(o)) + '</span><span class="loc">' + esc(local) + '</span></span>' +
      '<span class="d">' + esc(o.descricao || '') + '</span><span class="prazo">' + ic('relogio', 'p') + esc(prazoTxt(o.prazo_aceite)) + '</span></span>' + ic('seta', 'p fim') + '</button>';
  }
  function opsBloqueadasMini() {
    var pro = (NIVEL_IDX[nivel()] || 1) >= 3;
    return '<div class="ap-trava"><span class="ico">' + ic('cadeado') + '</span><div><p class="b">' + esc(bloq('oportunidades')) + '</p>' +
      '<p class="np-lktx">Clientes e obras da NEXUS na sua região chegam aos parceiros Pro que aceitaram o Termo de Parceria, com prazo para aceitar.</p>' +
      (pro ? '<button type="button" class="nx-btn" data-acao="irTermoParceria">Ler e aceitar o termo</button>' : '<button type="button" class="nx-btn" data-acao="ir" data-arg="parceria">Ver como chegar</button>') + '</div></div>';
  }
  function termoCartaoApp() {
    var t = termo(), aceito = !!t.aceito_em;
    if (!libera('termo')) return termoSecaoHTML();
    return '<section class="np-sec" id="np-termo"><div class="np-tit-grupo"><h2>Termo de Parceria</h2>' + (aceito ? '<span class="nx-chip az">Aceito em ' + esc(dataBR(t.aceito_em)) + '</span>' : '') + '</div>' +
      '<div class="np-card"><p>As regras da parceria entre a NEXUS e a sua empresa. ' + (aceito ? 'Você já aceitou e pode ler de novo.' : 'Você lê e aceita por aqui.') + '</p>' +
      '<button type="button" class="nx-btn' + (aceito ? ' sec' : '') + '" data-acao="irTermoParceria">' + (aceito ? 'Ler o termo' : 'Ler e aceitar o termo') + '</button></div></section>';
  }

  /* Procura (API) */
  function ufDoParceiro() { var u = S.eu && S.eu.parceiro && S.eu.parceiro.uf; return u && UFS.indexOf(String(u).toUpperCase()) >= 0 ? String(u).toUpperCase() : ''; }
  var NOME_UF = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins" };
  function nomeUf(uf) { return NOME_UF[uf] || uf; }
  function carregarProcura(destino) {
    var uf = ufDoParceiro(), t = S.tela;
    var chave = uf || 'BR';
    function pinta(d) { var el = document.getElementById(destino); if (el && S.tela === t) { el.innerHTML = procuraInicioHTML(d, uf); desenharGrafs(); pintarFontes(); reajustarSecao(); } }
    function erro() {
      var el = document.getElementById(destino);
      if (el && S.tela === t) el.innerHTML = secErro('Não foi possível carregar a procura agora.', 'recarregarProcura');
    }
    if (S.procura[chave]) { pinta(S.procura[chave]); return; }
    S.procuraDestino = destino;
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
  function colunasMeses(d, uf) {
    var usaUf = !!uf && d.meses.every(function (m) { return m.uf_total != null; });
    var n = d.meses.length, pts = d.meses.map(function (m, i) { return { rot: rotuloMes(m.mes), val: num(usaUf ? m.uf_total : m.total), parcial: i === n - 1 }; });
    var b = brt(d.atualizado_em ? new Date(d.atualizado_em) : new Date());
    var parcial = 'Parcial, até ' + p2(b.dia) + '/' + p2(b.mes);
    var aria = 'Gráfico de colunas das reuniões de eletroposto agendadas pela NEXUS ' + (usaUf ? 'em ' + nomeUf(uf) : 'no Brasil') + ' por mês: ' + pts.map(function (p) { return p.rot + ' ' + fmt(p.val); }).join(', ') + ' (último mês parcial, ' + parcial.toLowerCase() + ')';
    return registrarGraf(function (W, id) { return svgColunas(W, id, pts, 'Reuniões agendadas', parcial, aria); });
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
  /* Oportunidades na Início */
  function tipoOp(o) { return o.tipo === 'obra' ? 'Obra terceirizada NEXUS' : 'Cliente para você vender'; }
  function opLinha(o, comBotao) {
    var local = [cidadeUf(o.cidade, o.uf), o.distancia_km != null ? fmt(o.distancia_km) + ' km' : ''].filter(Boolean).join(' · ');
    return '<div class="np-op"><div class="c"><div class="t"><span class="np-tipo' + (o.tipo === 'obra' ? '' : ' cli') + '">' + esc(tipoOp(o)) + '</span><span class="loc">' + esc(local) + '</span></div><p>' + esc(o.descricao || '') + '</p></div>' +
      '<div class="r"><span class="prazo">' + ic('relogio', 'p') + esc(prazoTxt(o.prazo_aceite)) + '</span>' + (comBotao ? '<button type="button" class="nx-btn" data-acao="ir" data-arg="oportunidades">Ver</button>' : '') + '</div></div>';
  }
  function carregarOpsInicio() {
    var t = S.tela;
    api('GET', NX + '/oportunidades', undefined, { quieto: true }).then(function (r) {
      var el = $('#np-opsini');
      if (S.tela !== t) return;
      if (!r.ok) { S.ops = null; S.opsErro = true; atualizarVivo(); if (el) el.innerHTML = secErro('Não foi possível carregar as oportunidades agora.', 'recarregarOps'); return; }
      S.ops = (r.data && r.data.oportunidades) || []; S.opsErro = false;
      atualizarVivo();
      if (!el) return;
      var l = S.ops.filter(function (o) { return o.status === 'oferecida'; })
        .sort(function (a, b) { return new Date(a.prazo_aceite) - new Date(b.prazo_aceite); }).slice(0, 3);
      if (!l.length) { el.innerHTML = '<div class="np-vazio-sec">Nenhuma oportunidade aberta na sua região agora. Quando a NEXUS tiver um cliente ou uma obra para você, ela aparece aqui.</div>'; return; }
      el.innerHTML = mobile() ? '<div class="ap-ops">' + l.map(opMini).join('') + '</div>' : '<div class="np-ops">' + l.map(function (o) { return opLinha(o, true); }).join('') + '</div>';
      reajustarSecao();
    });
  }
  function opsBloqueadasHTML() {
    if (mobile()) return opsBloqueadasMini();
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
      var local = cidadeUf(p.cliente_cidade, p.cliente_uf);
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

  /* ------------------------------------------------------------------ Serviços NEXUS (v5): plataforma, engenharia e suporte, com preço e como contratar */
  var PACOTES = [1, 3, 5];
  var ENG_PRECO = { 1: 3000, 3: 7500, 5: 10000 };
  var MAN_PRECO = 200, APOIO_PRECO = 500;
  var STATUS_PED = { solicitado: ['Solicitado', 'cz'], negociando: ['Em negociação', 'av'], confirmado: ['Confirmado', 'az'], cancelado: ['Cancelado', 'er'] };
  /* Textos do cadeado (bloco B da v5): usados quando a API não manda `bloqueio`. */
  var SV_TX_COMPRA = 'Libera com a sua primeira compra de carregador NEXUS.';
  var SV_TX_AVULSO = 'O projeto avulso libera quando o seu perfil estiver completo.';
  var SV_TX_PACOTES = 'Os pacotes com desconto liberam no nível Partner.';
  var SV_TX_PARTNER = 'Libera no nível Partner.';
  /* Chave de `libera` de cada serviço, para quando a API não manda o booleano por serviço. */
  var SERV_CHAVE = { plataforma: 'plataforma', 'eng-1': 'basico', 'eng-3': 'pacotes_engenharia', 'eng-5': 'pacotes_engenharia', manutencao: 'manutencao', apoio_venda: 'consultoria' };
  var SV_BLOQ = { plataforma: SV_TX_COMPRA, 'eng-1': SV_TX_AVULSO, 'eng-3': SV_TX_PACOTES, 'eng-5': SV_TX_PACOTES, manutencao: SV_TX_COMPRA, apoio_venda: SV_TX_PARTNER };
  var SV_PLAT_INCLUI = ['Busca do ponto, recarga e pagamento pelo app', 'Pix, cartão e carteira', 'Tarifa definida pelo dono do ponto', 'Cada carregador em tempo real', 'Repasse conciliado', 'Relatórios', 'OCPP 1.6J aberto'];
  var SV_ENG_INCLUI = ['Projeto elétrico do eletroposto', 'ART do projeto', 'Estudo da entrada de energia: padrão, demanda e se precisa de transformador', 'Pedido de acesso', 'Acompanhamento da homologação na distribuidora', 'Exemplo real: o DC 80 kW puxa perto de 90 kVA, e na CEMIG o padrão de baixa tensão vai até 75 kW'];
  var SV_SUP_INCLUI = ['Ativação na plataforma: configuração do carregador, tarifa e app', 'Suporte técnico remoto pelo WhatsApp, em horário comercial', 'Diagnóstico pela telemetria da plataforma', 'Garantia de fábrica com peça de reposição no país', 'Treinamento online da sua equipe: instalação, comissionamento e manutenção'];
  var SV_MAN_INCLUI = ['Monitoramento contínuo com alerta de falha', 'Atendimento remoto com prioridade', 'Roteiro de manutenção preventiva para a sua equipe seguir', 'Relatório mensal do carregador', 'Prioridade na peça de reposição (peça fora da garantia é cobrada à parte)'];
  var SV_APOIO_INCLUI = ['Especialista NEXUS na reunião online com o seu cliente', 'Revisão da proposta antes do envio', 'Análise do ponto: entrada de energia, fluxo e potência indicada'];
  var SV_FAQ = [
    ['O pacote de engenharia vence?', 'O pacote vira saldo: você usa um projeto por obra, quando precisar. Sobre validade, fale com o comercial NEXUS.'],
    ['Quem faz a obra?', 'A obra e a ART de execução são suas. A NEXUS faz o projeto, a ART do projeto e acompanha a homologação na distribuidora.'],
    ['O que vem incluso sem pagar?', 'Em todo carregador: ativação na plataforma, suporte remoto pelo WhatsApp em horário comercial, diagnóstico pela telemetria, garantia de fábrica e treinamento online da sua equipe.'],
    ['Como recebo a minha parte da plataforma?', 'Você recebe parte dos 10% todo mês, enquanto o ponto operar. O percentual é negociado com o comercial e libera com a primeira compra de carregador.']
  ];
  /* `servicos` vem do /eu como lista (v5): {id, grupo, nome, preco_texto, preco_valor, unidade, libera, bloqueio, acao}. Aceita também um objeto por id. */
  function servApi(id) {
    var L = S.eu && S.eu.servicos, r = null;
    if (Array.isArray(L)) L.forEach(function (x) { if (x && x.id === id) r = x; });
    else if (L && typeof L === 'object') r = L[id] || null;
    return r || {};
  }
  function servNome(id, padrao) { var n = servApi(id).nome; return typeof n === 'string' && n ? n : padrao; }
  /* Só vale o booleano da API (a v3 mandava texto 'partner'/'pro' em `libera`): senão, a chave de nível. */
  function servLibera(id) {
    var l = servApi(id).libera;
    if (typeof l === 'boolean') return l;
    var k = SERV_CHAVE[id];
    return k ? libera(k) : true;
  }
  function servBloq(id) {
    var b = servApi(id).bloqueio;
    return typeof b === 'string' && b.trim() ? maiuscula(b.trim()) : (SV_BLOQ[id] || SV_TX_COMPRA);
  }
  function servValor(id, padrao) { var v = servApi(id).preco_valor; return typeof v === 'number' && isFinite(v) && v > 0 ? v : padrao; }
  function engValor(n) { return servValor('eng-' + n, ENG_PRECO[n]); }
  function projetosTxt(n) { return n === 1 ? '1 projeto' : n + ' projetos'; }
  function nomePacote(n) {
    if (n === 1) return 'Engenharia NEXUS · 1 projeto';
    return servNome('eng-' + n, 'Pacote de engenharia · ' + n + ' projetos');
  }
  function listaChecks(itens) { return '<ul class="np-checks">' + itens.map(function (t) { return '<li>' + ic('check') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul>'; }
  /* Botão travado com o texto de "o que libera" sempre visível (o texto é o do serviço, não o da chave). */
  function lkTx(rotulo, texto, cls) {
    var id = 'lk' + (++uidG);
    return '<div class="np-lk"><button type="button" class="nx-btn' + (cls === '' ? '' : ' ' + (cls || 'sec')) + '" aria-disabled="true" aria-describedby="' + id + '" data-acao="travado" data-txt="' + esc(texto) + '">' +
      ic('cadeado', 'p') + esc(rotulo) + '</button><small class="np-lktx" id="' + id + '">' + esc(texto) + '</small></div>';
  }
  function svBloco(rot, corpo, cls) { return '<div class="sv-bl' + (cls ? ' ' + cls : '') + '"><h4 class="sv-rot">' + esc(rot) + '</h4>' + corpo + '</div>'; }
  function svPreco(grande, unidade) { return '<p class="sv-preco"><strong>' + esc(grande) + '</strong>' + (unidade ? '<span>' + esc(unidade) + '</span>' : '') + '</p>'; }
  function svServico(o) {
    var trv = o.travado === true;
    return '<article class="sv-serv" data-serv="' + esc(o.id) + '" data-travado="' + (trv ? '1' : '0') + '" aria-label="' + esc(o.nome) + '">' +
      '<header class="sv-cab"><h3>' + esc(o.nome) + '</h3>' + (trv ? '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>' : '') + '</header>' +
      svBloco('O que é', '<p>' + esc(o.que) + '</p>') + svBloco('O que inclui', listaChecks(o.inclui)) +
      svBloco('Quanto custa', o.custo, 'sv-custo') + svBloco('Como contratar', '<p>' + esc(o.como) + '</p>' + (o.acao || ''), 'sv-como') + '</article>';
  }
  function svGrupo(id, titulo, corpo) {
    return '<section class="np-sec sv-grupo" id="' + id + '" tabindex="-1" aria-labelledby="' + id + '-t"><h2 id="' + id + '-t">' + esc(titulo) + '</h2>' + corpo + '</section>';
  }

  function svEngenharia() {
    var sd = saldoEng(), base = engValor(1);
    var h = '<article class="sv-serv" data-serv="engenharia" aria-label="Engenharia NEXUS"><header class="sv-cab"><h3>Engenharia NEXUS</h3></header>' +
      svBloco('O que é', '<p>Projeto do eletroposto feito pela NEXUS, do projeto elétrico ao acompanhamento da homologação na distribuidora. A obra e a ART de execução ficam com você.</p>') +
      svBloco('O que inclui', listaChecks(SV_ENG_INCLUI));
    var cartoes = PACOTES.map(function (n) {
      var v = engValor(n), eco = Math.max(0, base * n - v), lib = servLibera('eng-' + n), acao;
      var rot = n === 1 ? '1 projeto' : 'Pacote de ' + projetosTxt(n);
      if (!lib) acao = lkTx('Contratar engenharia', servBloq('eng-' + n), '');
      else if (S.confirmaPacote === n) {
        acao = '<p class="np-confirma">Enviar o pedido de ' + projetosTxt(n) + ' de engenharia ao comercial?</p><div class="nx-linha-btn"><button type="button" class="nx-btn" data-acao="enviarPacote" data-arg="' + n + '">Enviar pedido</button>' +
          '<button type="button" class="nx-btn sec" data-acao="cancelarPacote">Cancelar</button></div>';
      } else acao = '<button type="button" class="nx-btn" data-acao="pedirPacote" data-arg="' + n + '" aria-label="Contratar engenharia, ' + esc(rot) + '">Contratar engenharia</button>';
      return '<div class="np-pacote sv-pac' + (n === 5 ? ' econ' : '') + '" data-serv="eng-' + n + '" data-travado="' + (lib ? '0' : '1') + '" role="group" aria-label="' + esc(rot) + '">' +
        '<div class="sv-pac-topo"><span class="np-rot">' + esc(rot) + '</span>' + (n === 5 ? '<span class="nx-chip az">Mais econômico</span>' : '') + (lib ? '' : '<span class="nx-chip cz">' + ic('cadeado', 'p') + 'Travado</span>') + '</div>' +
        svPreco(rs(v), n === 1 ? 'projeto avulso' : 'ou ' + rs(v / n) + ' cada') +
        (n > 1 && eco > 0 ? '<p class="sv-eco">Você economiza ' + esc(rs(eco)) + '.</p>' : '<p class="sv-eco neutro">Pague só o projeto que precisar.</p>') + acao + '</div>';
    }).join('');
    h += svBloco('Quanto custa', '<div class="np-pacotes sv-pacotes">' + cartoes + '</div><p class="nx-dica">O pacote vira saldo: você usa um projeto por obra, quando precisar.</p>', 'sv-custo');
    if (sd) {
      h += '<div class="sv-bl sv-saldo" id="sv-saldo"><h4 class="sv-rot">Seu saldo de engenharia</h4><div class="np-saldo">' +
        '<div class="np-num"><strong>' + esc(fmt(sd.comprados)) + '</strong><span>Projetos comprados</span></div>' +
        '<div class="np-num"><strong>' + esc(fmt(sd.usados)) + '</strong><span>Projetos usados</span></div>' +
        '<div class="np-num"><strong class="az">' + esc(fmt(sd.disponiveis)) + '</strong><span>Projetos disponíveis</span></div></div>' +
        (sd.disponiveis > 0 ? '<div><button type="button" class="nx-btn" data-acao="ir" data-arg="servicos/pedir">Usar um projeto do pacote</button></div>'
          : '<p class="nx-dica">Sem saldo agora. Contrate um pacote para usar nos próximos pontos.</p>') + '</div>';
    }
    h += svBloco('Como contratar', '<p>Escolha o projeto avulso ou o pacote e peça pelo portal, no botão Contratar engenharia do cartão.</p>', 'sv-como');
    return h + '</article>';
  }

  function telaServicos() {
    var h = '<div class="np-pagina sv-pagina">';
    h += '<section class="np-sec"><div><h1 class="nx-h1">Serviços NEXUS</h1><p class="nx-sub" style="max-width:720px;margin:0">Veja o que a NEXUS faz por você e pelo seu cliente, quanto custa e como contratar.</p></div></section>';

    /* 1. Plataforma NEXUS */
    var plLib = servLibera('plataforma'), acaoP;
    if (!plLib) acaoP = lkTx('Falar com o comercial', servBloq('plataforma'), '');
    else if (S.plataformaPedida) acaoP = '<span class="nx-chip az">Pedido enviado ao comercial</span>';
    else acaoP = '<button type="button" class="nx-btn" data-acao="querPlataforma">Falar com o comercial</button>';
    h += svGrupo('sv-plat', 'Plataforma', svServico({
      id: 'plataforma', nome: servNome('plataforma', 'Plataforma NEXUS'), travado: !plLib,
      que: 'Gestão e cobrança do eletroposto. O motorista acha o ponto, carrega e paga pelo app, por Pix, cartão ou carteira. O dono do ponto define a tarifa.',
      inclui: SV_PLAT_INCLUI,
      custo: svPreco('10%', 'do que o ponto fatura em recarga') + '<p>Sem mensalidade e sem taxa de adesão.</p>' +
        '<p><b>Para você:</b> você revende a plataforma e recebe parte desses 10% todo mês, enquanto o ponto operar. O percentual é negociado com o comercial.</p>' +
        '<p>O preço de parceiro do carregador vale com o ponto operando pela plataforma por 24 meses.</p>',
      como: 'Para definir o seu percentual, fale com o comercial NEXUS.', acao: acaoP
    }));

    /* 2. Engenharia NEXUS */
    h += svGrupo('sv-eng', 'Engenharia', svEngenharia());
    /* Pedir engenharia: o formulário e a lista que eram da aba Engenharia (rede.js), logo abaixo dos pacotes. */
    h += '<section class="np-sec" id="sv-pedir-eng" tabindex="-1" aria-label="Pedir engenharia"><div id="np-rede-eng"></div></section>';

    /* 3. Suporte NEXUS */
    var vMan = servValor('manutencao', MAN_PRECO), vApoio = servValor('apoio_venda', APOIO_PRECO);
    var manLib = servLibera('manutencao'), apLib = servLibera('apoio_venda'), acaoM, acaoA;
    if (!manLib) acaoM = lkTx('Contratar manutenção', servBloq('manutencao'), '');
    else if (S.manutAberta) {
      acaoM = '<div class="np-form-inline sv-form" id="sv-man"><div class="nx-campo"><label for="sv-man-qtd">Quantos carregadores terão o plano?</label>' +
        '<input id="sv-man-qtd" type="number" inputmode="numeric" min="1" max="50" step="1" value="1"><span class="nx-dica">De 1 a 50. ' + esc(rs(vMan)) + ' por mês por carregador.</span></div>' +
        '<div class="nx-campo"><label for="sv-man-obs">Observação (opcional)</label><textarea id="sv-man-obs" maxlength="300"></textarea></div>' +
        '<p class="nx-msg-erro" data-erro hidden></p><div class="nx-linha-btn"><button type="button" class="nx-btn" data-acao="enviarManutencao">Enviar pedido</button>' +
        '<button type="button" class="nx-btn sec" data-acao="cancelarManutencao">Cancelar</button></div></div>';
    } else acaoM = '<button type="button" class="nx-btn" data-acao="pedirManutencao">Contratar manutenção</button>';
    if (!apLib) acaoA = lkTx('Pedir apoio de venda', servBloq('apoio_venda'), '');
    else if (S.apoioAberto) {
      acaoA = '<div class="np-form-inline sv-form" id="sv-apoio"><div class="nx-campo"><label for="sv-ap-cli">Cliente</label><input id="sv-ap-cli" type="text" maxlength="100" autocomplete="off"></div>' +
        '<div class="nx-campo"><label for="sv-ap-ponto">Ponto (cidade e local)</label><input id="sv-ap-ponto" type="text" maxlength="140" autocomplete="off"></div>' +
        '<p class="nx-msg-erro" data-erro hidden></p><div class="nx-linha-btn"><button type="button" class="nx-btn" data-acao="enviarApoio">Enviar pedido</button>' +
        '<button type="button" class="nx-btn sec" data-acao="cancelarApoio">Cancelar</button></div></div>';
    } else acaoA = '<button type="button" class="nx-btn" data-acao="pedirApoio">Pedir apoio de venda</button>';
    h += svGrupo('sv-sup', 'Suporte',
      svServico({ id: 'suporte_incluido', nome: 'Suporte incluído no carregador', travado: false,
        que: 'Tudo o que acompanha cada carregador NEXUS, sem custo, para você ativar, instalar e atender o seu cliente.', inclui: SV_SUP_INCLUI,
        custo: svPreco('Sem custo', 'já vem em todo carregador NEXUS'), como: 'Não precisa contratar. Vem junto com cada carregador.', acao: '' }) +
      svServico({ id: 'manutencao', nome: servNome('manutencao', 'Plano de manutenção NEXUS'), travado: !manLib,
        que: 'Monitoramento contínuo do carregador pela plataforma, com alerta de falha e atendimento remoto com prioridade.', inclui: SV_MAN_INCLUI,
        custo: svPreco(rs(vMan), 'por mês por carregador') + '<p>É o mesmo valor de manutenção que o Simulador já considera na conta do seu cliente.</p>',
        como: 'Escolha os carregadores que terão o plano e peça pelo portal.', acao: acaoM }) +
      svServico({ id: 'apoio_venda', nome: servNome('apoio_venda', 'Apoio de venda'), travado: !apLib,
        que: 'Um especialista NEXUS entra na reunião online com o seu cliente, revisa a proposta antes de você enviar e analisa o ponto.', inclui: SV_APOIO_INCLUI,
        custo: svPreco(rs(vApoio), 'por atendimento') + '<p>A primeira reunião de cada parceiro é por conta da NEXUS.</p>',
        como: 'Peça o atendimento pelo portal e informe o cliente e o ponto.', acao: acaoA }));

    /* Pedidos e perguntas frequentes */
    h += '<section class="np-sec"><h2>Seus pedidos de serviços</h2><div id="sv-pedidos">' + girando('Carregando os pedidos') + '</div></section>';
    h += '<section class="np-sec sv-faq" id="sv-faq" aria-labelledby="sv-faq-t"><h2 id="sv-faq-t">Perguntas frequentes</h2><div class="sv-faq-lista">' + SV_FAQ.map(function (q) {
      return '<details class="sv-q"><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>';
    }).join('') + '</div></section>';
    return h + '</div>';
  }
  function posServicos() {
    carregarPedidosServ();
    montarEngenhariaEmbutida();
  }
  /* O formulário fica num nó que sobrevive aos repaints da tela (pedir pacote, manutenção, recarregar o /eu): sem isso o texto digitado e o "Pedido recebido" sumiriam. */
  function montarEngenhariaEmbutida() {
    var slot = $('#np-rede-eng');
    if (!slot) return;
    if (S.engHost) { slot.appendChild(S.engHost); return; }
    var host = document.createElement('div');
    S.engHost = host;
    slot.appendChild(host);
    var c = ctxBase(); c.embutido = true;
    if (!window.NexusRede || typeof window.NexusRede.montar !== 'function') {
      esperarScript(function () { return window.NexusRede && typeof window.NexusRede.montar === 'function'; }, host, 'Carregando', function () { montarEngenhariaEmbutida2(host, c); });
      return;
    }
    montarEngenhariaEmbutida2(host, c);
  }
  function montarEngenhariaEmbutida2(host, c) {
    host.innerHTML = '';
    try { window.NexusRede.montar(host, 'engenharia', c); }
    catch (e) {
      host.innerHTML = '<div class="nx-cartao nx-vazio">' + ic('engenharia') + '<h2>Não foi possível abrir o pedido de engenharia</h2><p>Tente de novo. Se continuar assim, fale com a gente.</p><button type="button" class="nx-btn" data-acao="repintar">Tentar de novo</button></div>';
      if (window.console) console.error('NexusRede.montar falhou', e);
    }
  }
  function carregarPedidosServ() {
    var t = S.tela;
    api('GET', NX + '/pedidos', undefined, { quieto: true }).then(function (r) {
      if (S.tela !== t) return;
      if (r.ok && r.data && Array.isArray(r.data.pedidos)) {
        S.pedidosServ = r.data.pedidos.filter(function (x) { return x && (x.tipo === 'engenharia' || x.tipo === 'consultoria' || x.tipo === 'manutencao'); });
        S.pedidosServErro = false;
      } else { S.pedidosServ = null; S.pedidosServErro = true; }
      pintarPedidosServ();
    });
  }
  function nomePedidoServ(x) {
    if (x.tipo === 'engenharia') {
      var n = Math.round(num(x.pacote));
      return n === 1 ? 'Engenharia NEXUS · 1 projeto' : n > 1 ? 'Pacote de engenharia · ' + n + ' projetos' : 'Engenharia NEXUS';
    }
    if (x.tipo === 'manutencao') {
      var q = Math.round(num(x.quantidade));
      return 'Plano de manutenção NEXUS' + (q > 0 ? ' · ' + q + (q === 1 ? ' carregador' : ' carregadores') : '');
    }
    return 'Apoio de venda';
  }
  function pintarPedidosServ() {
    var el = $('#sv-pedidos');
    if (!el) return;
    if (S.pedidosServErro) { el.innerHTML = secErro('Não foi possível carregar os pedidos agora.', 'recarregarPedidosServ'); return; }
    var l = S.pedidosServ || [];
    if (!l.length) { el.innerHTML = '<div class="np-vazio-sec">Nenhum pedido de serviço ainda. Quando você contratar engenharia, manutenção ou apoio de venda, o pedido aparece aqui com o andamento.</div>'; return; }
    el.innerHTML = '<ul class="np-pedidos">' + l.map(function (x) {
      var st = STATUS_PED[x.status] || [String(x.status || 'Solicitado'), 'cz'];
      return '<li><div><b>' + esc(nomePedidoServ(x)) + '</b><small>' + esc(dataBR(x.created_at)) + '</small></div><span class="nx-chip ' + esc(st[1]) + '">' + esc(st[0]) + '</span></li>';
    }).join('') + '</ul>';
  }
  function postPedidoServ(corpo, btn, msgOk, tipoEv, caixa) {
    ocupado(btn, true, 'Enviando');
    api('POST', NX + '/pedidos', corpo).then(function (r) {
      if (r.tratado) return;
      ocupado(btn, false);
      if (r.ok) {
        ev(tipoEv, { pacote: corpo.pacote || null, quantidade: corpo.tipo === 'manutencao' ? corpo.quantidade : null });
        toast(msgOk);
        S.confirmaPacote = 0; S.manutAberta = false; S.apoioAberto = false;
        pintarMain(true);
        if (!S.demo) recarregarEu();
        return;
      }
      var cod = r.data && (r.data.erro || r.data.error);
      var c = caixa ? $(caixa) : null, msg;
      if (cod === 'servico_em_ativacao') msg = 'Este serviço está sendo ativado. Tente de novo em instantes ou fale com o comercial.';
      else if (cod === 'etapa_bloqueada') msg = servBloq(corpo.tipo === 'engenharia' ? 'eng-' + (corpo.pacote === 1 ? 1 : 3) : corpo.tipo === 'manutencao' ? 'manutencao' : 'apoio_venda');
      else msg = textoErro(r, 'Não foi possível enviar o pedido.');
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
    { k: 'cadastrado', n: 'Nível 1', nome: 'Cadastrado', como: 'Grátis, com CNPJ ativo.', libera: ['Informação de mercado e da sua região', 'Simulador em PDF', 'Orçamentos, Materiais e engenharia avulsa (1 projeto), com o perfil completo'] },
    { k: 'partner', n: 'Nível 2', nome: 'Partner', como: 'Depois da conversa com o comercial.', libera: ['Preço de parceiro e pedido de equipamento', 'Pacotes de engenharia de 3 e 5 projetos', 'Apoio de venda', 'Selo Parceiro NEXUS'] },
    { k: 'pro', n: 'Nível 3', nome: 'Partner Pro', como: 'A partir da primeira compra de carregador.', libera: ['Termo de Parceria', 'Oportunidades: clientes da sua região, depois de aceitar o termo', 'Revenda da Plataforma NEXUS', 'Plano de manutenção NEXUS'] },
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
    if (mobile() && S.sub === 'termo') return '<div class="np-pagina">' + termoSecaoHTML() + '</div>';
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
    h += mobile() ? termoCartaoApp() : termoSecaoHTML();
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
    if (libera('selo') && $('#nx-selo')) desenharSelo();
    if (libera('termo') && (!mobile() || S.sub === 'termo')) carregarTermo();
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
      S.rota = rh ? rh.r : 'inicio'; S.sub = rh ? rh.sub : ''; S.sec = rh ? rh.sec : '';
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
        if (r.ok && r.data && r.data.parceiro) { S.eu = r.data; S.fase = 'app'; S.rota = 'perfil'; S.sub = ''; S.sec = ''; history.replaceState(null, '', '#perfil'); pintar(); toast('Empresa cadastrada. Agora complete o perfil.'); return; }
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
      S.fase = 'app'; S.rota = 'inicio'; S.sub = ''; S.sec = ''; S.cad = null;
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
        S.fase = 'app'; S.rota = 'inicio'; S.sub = ''; S.sec = ''; S.cad = null;
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
    ir: function (el) { fecharMais(true); irPara(el.dataset.arg); },
    voltar: function (el) { fecharMais(true); irPara(el.dataset.arg); },
    irSecao: function (el, e) {
      if (e && e.preventDefault) e.preventDefault();
      S.secPend = '';
      var id = el.dataset.arg;
      if (rolarPara(id, true)) marcarChip(id);
    },
    estados27: function (el) {
      S.todosEstados = !S.todosEstados;
      var r = $('#in-m-rank');
      if (!r || !S.frota) return;
      r.innerHTML = rankingChart(!!S.todosEstados);
      el.setAttribute('aria-expanded', String(!!S.todosEstados));
      el.textContent = S.todosEstados ? 'Ver só os 5 primeiros' : 'Ver os ' + S.frota.estados.length + ' estados';
      desenharGrafs();
    },
    irTab: function (el) {
      var h = el.dataset.arg, atual = S.rota + (S.sub ? '/' + S.sub : '');
      if (atual === h) { window.scrollTo(0, 0); return; }
      fecharMais(true); irPara(h);
    },
    /* Gerar: se o formulario ja esta na tela, nao repinta (irPara no mesmo hash apagaria o que foi digitado). */
    gerarProposta: function () {
      if (S.rota === 'propostas' && S.sub !== 'lista') { window.scrollTo(0, 0); return; }
      fecharMais(true); irPara('propostas');
    },
    instalarApp: instalarAgora,
    bannerInstalar: function () { if (S.instalarEv) instalarAgora(); else irPara('instalar'); },
    bannerFechar: function () {
      S.bannerFechado = true;
      try { localStorage.setItem(CHAVE_FECHOU, String(Date.now())); } catch (e) { /* sem localStorage: fecha so ate recarregar */ }
      pintarBanner();
    },
    copiarEndereco: function () {
      copiar('https://' + URL_APP).then(function () { toast('Endereço copiado.'); }, function () { toast('Não foi possível copiar. Selecione o endereço e copie.', true); });
    },
    criarConta: function () {
      S.msgEntrada = ''; S.emailPre = ''; S.cad = novoCad();
      try { history.replaceState(null, '', location.pathname + location.search + '#cadastro'); } catch (e) { /* ok */ }
      irPasso(1);
    },
    cadEntrar: function () { S.msgEntrada = ''; S.fase = 'entrada'; pintar(); },
    cadVoltar: function () { lerCad($('[data-form=cad2]'), 2); irPasso(1); },
    abrirMais: function (el) { abrirMais(el); },
    fecharMais: function () { fecharMais(); },
    sairConta: function () {
      fecharMais(true);
      if (S.demo) { location.href = '/nexus/app'; return; }
      limparSessao(); S.eu = null; S.msgEntrada = ''; S.emailPre = ''; S.cad = null; S.fase = 'entrada'; S.propostas = null; S.ultima = null; S.procura = {}; S.ops = null; S.engHost = null; S.secPend = '';
      S.termoTxt = undefined; S.termoErro = false; S.termoMsg = ''; S.pedidosServ = null; S.confirmaPacote = 0; S.manutAberta = false; S.apoioAberto = false; S.plataformaPedida = false;
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
    travado: function (el) { toast(el.dataset.txt || bloq(el.dataset.arg), true); },
    pedirPacote: function (el) { S.confirmaPacote = Number(el.dataset.arg) || 0; S.manutAberta = false; S.apoioAberto = false; pintarMain(true); },
    cancelarPacote: function () { S.confirmaPacote = 0; pintarMain(true); },
    enviarPacote: function (el) {
      var n = Number(el.dataset.arg);
      if (PACOTES.indexOf(n) < 0) return;
      postPedidoServ({ tipo: 'engenharia', pacote: n }, el, 'Pedido do pacote de ' + n + ' projetos enviado ao comercial da NEXUS.', 'pediu_pacote_engenharia');
    },
    pedirManutencao: function () { S.manutAberta = true; S.apoioAberto = false; S.confirmaPacote = 0; pintarMain(true); var q = $('#sv-man-qtd'); if (q) q.focus({ preventScroll: true }); },
    cancelarManutencao: function () { S.manutAberta = false; pintarMain(true); },
    enviarManutencao: function (el) {
      var q = $('#sv-man-qtd'), o = $('#sv-man-obs'), n = q ? Math.round(Number(String(q.value).replace(',', '.'))) : 0;
      if (!(n >= 1 && n <= 50)) return erroForm($('#sv-man'), 'Informe quantos carregadores terão o plano, de 1 a 50.');
      var corpo = { tipo: 'manutencao', quantidade: n }, obs = o ? String(o.value || '').trim().slice(0, 300) : '';
      if (obs) corpo.obs = obs;
      postPedidoServ(corpo, el, 'Pedido do plano de manutenção enviado ao comercial da NEXUS.', 'pediu_manutencao', '#sv-man');
    },
    pedirApoio: function () { S.apoioAberto = true; S.manutAberta = false; S.confirmaPacote = 0; pintarMain(true); var c = $('#sv-ap-cli'); if (c) c.focus({ preventScroll: true }); },
    cancelarApoio: function () { S.apoioAberto = false; pintarMain(true); },
    enviarApoio: function (el) {
      var c = $('#sv-ap-cli'), p = $('#sv-ap-ponto');
      var cli = c ? String(c.value || '').trim().slice(0, 100) : '', ponto = p ? String(p.value || '').trim().slice(0, 140) : '';
      if (!cli) return erroForm($('#sv-apoio'), 'Informe o nome do cliente.');
      if (!ponto) return erroForm($('#sv-apoio'), 'Informe o ponto: cidade e local.');
      postPedidoServ({ tipo: 'consultoria', obs: 'Cliente: ' + cli + '. Ponto: ' + ponto + '.' }, el, 'Pedido de apoio de venda enviado ao comercial da NEXUS.', 'pediu_apoio_venda', '#sv-apoio');
    },
    querPlataforma: function (el) { querPlataforma(el); },
    recarregarPedidosServ: function () { S.pedidosServErro = false; var e = $('#sv-pedidos'); if (e) e.innerHTML = girando('Carregando os pedidos'); carregarPedidosServ(); },
    aceitarTermo: function (el) { aceitarTermo(el); },
    imprimirTermo: imprimirTermo,
    recarregarTermo: function () { S.termoErro = false; S.termoTxt = undefined; carregarTermo(); },
    irTermoParceria: function () { fecharMais(true); if (mobile()) { irPara('parceria/termo'); return; } S.irTermo = true; irPara('parceria'); },
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
      var d = S.procuraDestino || 'in-m-proc', el = document.getElementById(d);
      if (el) el.innerHTML = girando('Carregando a procura');
      carregarProcura(d);
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
    S.rota = rh ? rh.r : 'inicio'; S.sub = rh ? rh.sub : ''; S.sec = rh ? rh.sec : '';
    if (S.rota !== 'equipamentos' || antes !== S.rota + '/' + S.sub) { if (!S.abrirCompra) { S.qtd = 1; S.foto = 0; } }
    fecharMais(true);
    if (window.NexusFolha) window.NexusFolha.fecharTodas();
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
    });
    /* Digitando no celular: as barras fixas saem da frente (senao comem metade da tela que sobra com o teclado aberto). */
    var campoTexto = function (el) { return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|file|range)$/.test(el.type || '')); };
    document.addEventListener('focusin', function (e) { if (mobile() && campoTexto(e.target)) document.documentElement.classList.add('np-teclado'); });
    document.addEventListener('focusout', function () { setTimeout(function () { if (!campoTexto(document.activeElement)) document.documentElement.classList.remove('np-teclado'); }, 80); });
    window.addEventListener('hashchange', aoMudarHash);
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) { window.addEventListener(t, function () { S.secPend = ''; }, { passive: true }); });
    /* Cruzou os 861 px (girou o aparelho, redimensionou a janela): fecha a gaveta e repinta no formato certo. */
    var mudouTela = function () {
      if (S.fase !== 'app' || !S.shell) return;
      fecharMais(true); pintarNav();
      if (!(S.rota === 'propostas' && S.sub !== 'lista')) pintarMain(true);   /* o gerador repinta a si mesmo e guarda o que foi digitado */
    };
    if (MQ) { if (MQ.addEventListener) MQ.addEventListener('change', mudouTela); else if (MQ.addListener) MQ.addListener(mudouTela); }
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
      S.rota = rd ? rd.r : 'inicio'; S.sub = rd ? rd.sub : ''; S.sec = rd ? rd.sec : '';
      pintar();
      return;
    }
    var rh = rotaDoHash();
    S.rota = rh ? rh.r : 'inicio'; S.sub = rh ? rh.sub : ''; S.sec = rh ? rh.sec : '';
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
