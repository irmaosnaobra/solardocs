/* Trilha do Parceiro NEXUS (Onda 1): telas do parceiro.
   JavaScript puro, sem build. A casca (js/app.js) chama window.NexusTrilha.ligar(ctx) no boot e pergunta ligada() antes de
   mostrar qualquer coisa daqui. Com o GET /gerador/nexus/trilha devolvendo {ligada:false}, ou com erro, nada da trilha aparece
   e o portal fica exatamente como era.
   Rotas: #trilha (escada e próximo passo), #trilha/raiox, #trilha/nota, #trilha/diagnostico, #trilha/preparo, #trilha/academia[/id],
   #trilha/termo, #trilha/reuniao, #trilha/patamar/N, #historico. Com o Nível 4 feito, #inicio vira a mesa limpa.
   Contrato da api: plano-trilha (17/11/2026). Todo texto que vem da api passa por esc(). O gabarito da Academia nunca vem para cá. */
(function () {
  'use strict';

  var C = null;                 /* ponte da casca: api, S, toast, irPara, repintar, termo, listarPropostas, produtos */
  var E = null;                 /* resposta do GET /trilha */
  var st = {
    prom: null, carregado: false, demo: false,
    rx: { i: -1, resp: {}, nota: null, faltas: null, fila: {}, t: 0, sim: null, novo: null },
    acad: null, acadErro: false, acadProm: null, acadRes: {},
    props: null, propsErro: false, propsProm: null,
    diag: { pronto: false, nome: '', whatsapp: '', periodo: '', erro: null },   /* fim do Nível 1: o contato que a equipe NEXUS chama */
    reu: { cliente: '', proposta: '', dias: [], periodo: '', tipo: '' },
    conq: null, busca: ''
  };
  var TZ = 'America/Sao_Paulo';
  var DEMO_ACAD_CERTA = {};     /* só no modo demonstração: o gabarito de mentira mora aqui */

  /* ------------------------------------------------------------------ utilidades */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
  function rs(v) { try { return 'R$ ' + Math.round(num(v)).toLocaleString('pt-BR'); } catch (e) { return 'R$ ' + Math.round(num(v)); } }
  function partes(iso) {
    var d = iso instanceof Date ? iso : new Date(iso);
    if (!iso || isNaN(d.getTime())) return null;
    var o = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    } catch (e) { return null; }
    return o;
  }
  var SEMANA = { Mon: 'Seg', Tue: 'Ter', Wed: 'Qua', Thu: 'Qui', Fri: 'Sex', Sat: 'Sáb', Sun: 'Dom' };
  function dm(iso) { var p = partes(iso); return p ? p.day + '/' + p.month : ''; }
  function dmh(iso) {
    var p = partes(iso);
    if (!p) return '';
    var h = +p.hour, m = p.minute;
    return SEMANA[p.weekday] + ' ' + p.day + '/' + p.month + ', ' + h + (m !== '00' ? ':' + m : 'h');
  }
  function diasEntre(a, b) { return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)); }
  function digitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  /* WhatsApp brasileiro com DDD: tira o 55 e o 0 da frente; 10 ou 11 dígitos. */
  function foneLimpo(v) { return digitos(v).replace(/^(?:55|0)(?=\d{10,11}$)/, ''); }
  function foneFmt(v) {
    var d = foneLimpo(v).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function urlSegura(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; }
  function iniciais(t) {
    var p = String(t || '').replace(/\b(ltda|me|eireli|s\/?a|epp)\b\.?/gi, '').trim().split(/\s+/).filter(Boolean);
    return ((p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
  }
  function cidUf(cidade, uf) {
    var c = String(cidade || '').trim(), u = String(uf || '').trim().toUpperCase();
    var m = c.match(/^(.*\S)\s*[-\/,\s]\s*([A-Za-z]{2})$/);
    if (m && (!u || m[2].toUpperCase() === u)) { c = m[1]; u = m[2].toUpperCase(); }
    return { cidade: c, uf: u, txt: c && u ? c + '-' + u : (c || u) };
  }

  /* ------------------------------------------------------------------ ícones (traço, monocromáticos) */
  var IC = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    cadeado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    voltar: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    baixo: '<path d="m6 9 6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
    planilha: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    caneta: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    selo: '<circle cx="12" cy="9" r="6"/><path d="m8.5 13.7-1.5 8.3 5-3 5 3-1.5-8.3"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    predio: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    video: '<path d="m16 13 5 3.5V7.5L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    raio: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    chave: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    historico: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    loja: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6"/>',
    regua: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    pino: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    radar: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    capelo: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    aperto: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7 .9l.2.2"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
    grafico: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    cifrao: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    inicio: '<path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
    propostas: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6"/>',
    perfil: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
    escada: '<path d="M3 21h4v-5h4v-5h4V6h4V3"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
    conversa: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>'
  };
  function ic(n, c) { return '<svg class="nx-ic' + (c ? ' ' + c : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (IC[n] || '') + '</svg>'; }
  /* "(?)": explicação em balão de até 2 linhas. O texto também vira o nome do botão para quem usa leitor de tela. */
  function aj(t) { return '<button type="button" class="tr-aj" data-aj="' + esc(t) + '" aria-label="Ajuda: ' + esc(t) + '">?</button>'; }

  /* ------------------------------------------------------------------ patamares */
  var PAT = [
    null,
    { nome: 'Mapeado', sub: 'Seu Raio-X', ic: 'radar', rota: 'trilha/raiox', passa: 'Raio-X com nota 80 ou mais.' },
    { nome: 'Diagnosticado', sub: 'Plano de entrada', ic: 'alvo', rota: 'trilha/diagnostico', passa: 'Reunião de diagnóstico aprovada pela equipe.' },
    { nome: 'Preparado', sub: 'Proposta com sua marca', ic: 'capelo', rota: 'trilha/preparo', passa: 'Mentoria com 4 encontros ou as 12 aulas da Academia.' },
    { nome: 'Em campo', sub: 'Reunião com seu cliente', ic: 'aperto', rota: 'trilha/reuniao', passa: 'Termo aceito e reunião com o cliente feita.' },
    { nome: 'Cliente NEXUS', sub: 'Suporte prioritário', ic: 'raio', rota: 'trilha/patamar/5', passa: 'Primeiro pedido de carregador confirmado.' },
    { nome: 'Parceiro regional', sub: 'Obras da sua região', ic: 'pino', rota: 'trilha/patamar/6', passa: 'Promoção pela equipe NEXUS.' }
  ];
  /* O que cada patamar abre quando termina (a lista do cartão "Abre no fim do Nível N"). */
  var ABRE = [
    null,
    [['alvo', 'Reunião de diagnóstico'], ['planilha', 'Plano de entrada']],
    [['capelo', 'Mentoria ou Academia']],
    [['doc', 'Proposta com sua marca'], ['planilha', 'Planilha completa'], ['caneta', 'Termo de Parceria'], ['aperto', 'Reunião com seu cliente'], ['selo', 'Selo do parceiro']],
    [['raio', 'Pedido de carregador'], ['regua', 'Pacotes de engenharia'], ['usuarios', 'Consultoria']],
    [['raio', 'Suporte prioritário']],
    [['pino', 'Obras da sua região']]
  ];
  function ligada() { return !!(E && E.ligada === true); }
  function pat() { var p = Math.round(num(E && E.patamar, 1)); return Math.min(7, Math.max(1, p)); }
  function etapa(n) { return (E && E.etapas && E.etapas['p' + n]) || {}; }
  function feito(n) { return !!etapa(n).em; }
  function concluida() { return ligada() && feito(4); }
  function eu() { return (C && C.S && C.S.eu) || {}; }
  function prefill() { return (E && E.prefill) || {}; }
  function rx() { return (E && E.raio_x) || {}; }
  function diag() { return (E && E.diagnostico) || {}; }
  function prep() { return (E && E.preparo) || {}; }
  function reun() { return (E && E.reuniao) || {}; }
  function termoAceito() { return !!((E && E.termo && E.termo.aceito) || (eu().termo && eu().termo.aceito_em)); }
  function assinante() { return !!(E && E.assinante); }
  function empresa() { var p = prefill(); return p.empresa || (C && C.nomeEmpresa()) || 'Sua empresa'; }
  function curto(nome) { return String(nome || '').replace(/\s+(energia\s+solar|solar|ltda\.?|me|eireli)\b.*$/i, '') || nome; }
  function uf() { return prefill().uf || (eu().parceiro && eu().parceiro.uf) || ''; }
  function rotulo() { var p = pat(); return p >= 7 ? 'Nível 6 de 6' : 'Nível ' + p + ' de 6'; }
  function fmHTML(cls) {
    var p = pat(), h = '';
    for (var k = 1; k <= 6; k++) h += '<i class="' + (k < p || feito(k) ? 'f' : k === p ? 'a' : '') + '" style="height:' + (4 + k * 3) + 'px"></i>';
    return '<span class="tr-fm' + (cls ? ' ' + cls : '') + '" role="img" aria-label="' + esc(rotulo()) + '">' + h + '</span>';
  }

  /* ------------------------------------------------------------------ Raio-X: perguntas (chaves iguais às da api) */
  var BLOCOS = ['Confirmar', 'Experiência', 'Momento', 'Região', 'Demanda', 'Simulação'];
  var TIPOS = [['posto', 'Posto'], ['hotel', 'Hotel'], ['shopping', 'Shopping'], ['condominio', 'Condomínio'], ['empresa_frota', 'Frota'], ['restaurante', 'Restaurante'], ['estacionamento', 'Estacionamento'], ['outro', 'Outro']];
  var FASES = [['ideia', 'Ainda não falei'], ['conversando', 'Já conversei'], ['quente', 'Pediu preço']];
  var Q = [
    { k: '_confirmar', b: 0, tipo: 'confirmar' },
    { k: 'anos_solar', b: 1, t: 'Há quanto tempo vocês trabalham com solar?', ops: [['0-1', 'Menos de 1 ano'], ['1-3', '1 a 3 anos'], ['3-5', '3 a 5 anos'], ['5+', 'Mais de 5 anos']] },
    { k: 'usinas', b: 1, t: 'Quantas usinas vocês já instalaram?', dicaSd: true, ops: [['0-20', 'Até 20'], ['20-100', '21 a 100'], ['100-500', '101 a 500'], ['500+', 'Mais de 500']] },
    { k: 'equipe', b: 1, t: 'Quantas pessoas na equipe?', ops: [['1-2', '1 ou 2'], ['3-5', '3 a 5'], ['6-15', '6 a 15'], ['16+', '16 ou mais']] },
    { k: 'capacidades', b: 1, multi: true, t: 'O que a sua equipe faz?', dica: 'Marque quantas quiser.', ops: [['eletrica_bt', 'Elétrica de baixa tensão'], ['eletrica_mt', 'Elétrica de média tensão'], ['engenharia_art', 'Engenharia com ART'], ['obra_civil', 'Obra civil'], ['homologacao', 'Homologação na distribuidora']] },
    { k: 'ja_montou_eletroposto', b: 2, t: 'Já montou algum eletroposto?', ops: [['nunca', 'Nunca'], ['1-2', '1 ou 2'], ['3+', '3 ou mais']] },
    { k: 'conhece_mercado', b: 2, t: 'Quanto conhece de carro elétrico?', ops: [['nada', 'Nada'], ['pouco', 'O básico'], ['bem', 'Bem']] },
    { k: 'papel', b: 2, t: 'Como você quer atuar?', ops: [['revenda', 'Vender o carregador'], ['montagem', 'Montar e instalar'], ['ambos', 'Os dois']] },
    { k: 'quando', b: 2, t: 'Quando quer começar?', ops: [['agora', 'Agora'], ['3m', 'Em 3 meses'], ['6m', 'Em 6 meses'], ['sem_pressa', 'Sem pressa']] },
    { k: 'dificuldades', b: 2, multi: true, max: 3, t: 'Sua maior dificuldade?', dica: 'Até 3.', ops: [['cliente', 'Achar cliente com perfil'], ['preco', 'Cliente acha caro'], ['financiamento', 'Falta financiamento'], ['tecnica', 'Parte técnica'], ['homologacao', 'Homologação'], ['tempo', 'Falta tempo'], ['outra', 'Outra']] },
    { k: 'raio_km', b: 3, t: 'Até onde a sua equipe atende?', dicaCidade: true, ops: [[50, 'Até 50 km'], [100, 'Até 100 km'], [200, 'Até 200 km'], [300, 'Até 300 km'], [500, 'Até 500 km']] },
    { k: 'clientes_em_vista', b: 4, tipo: 'carteira', t: 'Quem da sua carteira pode ter um ponto?' },
    { k: 'demanda_12m', b: 4, t: 'Quantos pontos você fecha em 12 meses?', ops: [[1, '1'], [3, '2 a 3'], [10, '4 a 10'], [20, 'Mais de 10']] },
    { k: 'simulacao', b: 5, tipo: 'simulacao', t: 'Simule um ponto' }
  ];
  function qPor(k) { for (var i = 0; i < Q.length; i++) if (Q[i].k === k) return i; return -1; }
  function rotOp(k, v) {
    var q = Q[qPor(k)];
    if (!q || !q.ops) return '';
    for (var i = 0; i < q.ops.length; i++) if (String(q.ops[i][0]) === String(v)) return q.ops[i][1];
    return '';
  }
  function rotDe(lista, v) { for (var i = 0; i < lista.length; i++) if (lista[i][0] === v) return lista[i][1]; return ''; }
  function respondida(k, r) {
    var v = r[k];
    if (k === 'clientes_em_vista' || k === 'capacidades' || k === 'dificuldades') return Array.isArray(v) && v.length > 0;
    if (k === 'simulacao') return !!(v && num(v.kwh_mes) > 0);
    return v != null && v !== '';
  }

  /* Nota local: só para a demonstração e para a primeira pintura antes da resposta do PUT. Quem decide é a api. */
  function notaLocal(r) {
    var p = prefill(), f = [], n = 0;
    var emp = (p.cnpj ? 4 : 0) + (p.cidade && p.uf ? 3 : 0) + (p.tem_logo ? 3 : 0);
    n += emp; if (emp < 10) f.push({ item: 'empresa', pontos: 10 - emp, texto: 'Complete a empresa na SolarDoc' });
    var exp = ['anos_solar', 'usinas', 'equipe', 'raio_km'].filter(function (k) { return respondida(k, r); }).length;
    n += Math.round(15 * exp / 4); if (exp < 4) f.push({ item: 'experiencia', pontos: 15 - Math.round(15 * exp / 4), texto: 'Responda a experiência' });
    if (respondida('capacidades', r)) n += 10; else f.push({ item: 'capacidades', pontos: 10, texto: 'Marque o que a equipe faz' });
    var mer = ['ja_montou_eletroposto', 'conhece_mercado', 'papel', 'quando'].filter(function (k) { return respondida(k, r); }).length;
    n += Math.round(15 * mer / 4); if (mer < 4) f.push({ item: 'mercado', pontos: 15 - Math.round(15 * mer / 4), texto: 'Responda o momento' });
    if (respondida('dificuldades', r)) n += 5; else f.push({ item: 'dificuldades', pontos: 5, texto: 'Diga sua maior dificuldade' });
    var cli = Array.isArray(r.clientes_em_vista) ? r.clientes_em_vista.length : 0;
    n += cli >= 2 ? 20 : cli === 1 ? 15 : 0; if (cli < 2) f.push({ item: 'carteira', pontos: cli ? 5 : 20, texto: cli ? 'Mais 1 cliente em vista' : 'Escolha clientes em vista' });
    if (num(r.demanda_12m) > 0) n += 10; else f.push({ item: 'demanda_12m', pontos: 10, texto: 'Diga quantos pontos fecha' });
    if (r.simulacao && num(r.simulacao.kwh_mes) > 0) n += 15; else f.push({ item: 'simulacao', pontos: 15, texto: 'Faça a simulação' });
    return { nota: Math.min(100, n), faltas: f };
  }
  var FALTA_Q = { experiencia: 'anos_solar', capacidades: 'capacidades', mercado: 'ja_montou_eletroposto', dificuldades: 'dificuldades', carteira: 'clientes_em_vista', demanda_12m: 'demanda_12m', demanda: 'demanda_12m', simulacao: 'simulacao', raio_km: 'raio_km' };

  /* ------------------------------------------------------------------ carregar e ligar */
  function aplicar(d) {
    if (!d || typeof d !== 'object') return;
    if (d.ligada === false) { E = { ligada: false }; return; }
    E = d;
    st.rx.resp = Object.assign({}, (d.raio_x && d.raio_x.respostas) || {}, st.rx.novo || {});
  }
  function carregar() {
    if (st.demo) return Promise.resolve(E);
    if (st.prom) return st.prom;
    /* Falha (rede, 401, 5xx) deixa a trilha desligada nesta pintura, sem repetir sozinha; um novo iniciarApp tenta de novo. */
    /* Prazo curto só para a trilha (6 s): se estourar ou cair a rede, o app abre sem ela e a próxima pintura tenta de novo. */
    st.prom = C.api('GET', '/trilha', undefined, { timeout: 6000 }).then(function (r) {
      st.carregado = !(r && r.status === 0);
      if (r.ok && r.data) aplicar(r.data); else { E = { ligada: false }; st.prom = null; }
      return E;
    }, function () { st.carregado = false; st.prom = null; E = { ligada: false }; return E; });
    return st.prom;
  }
  /* Recarrega depois de uma ação (e quando a equipe pode ter mexido). */
  function recarregar() {
    if (st.demo) { C.repintarTudo(); return Promise.resolve(E); }
    return C.api('GET', '/trilha').then(function (r) { if (r.ok && r.data) aplicar(r.data); C.repintarTudo(); return E; });
  }
  /* A casca chama em toda pintura: se a trilha ainda não veio (cadastro novo, por exemplo), busca uma vez e repinta. */
  function garantir() {
    if (st.demo || st.carregado || st.prom || !C) return;
    carregar().then(function () { if (ligada()) C.aoLigar(); });
  }
  /* Resposta de ação: {trilha} ou a própria trilha. */
  function trilhaDe(d) { return d && d.trilha && typeof d.trilha === 'object' ? d.trilha : (d && d.etapas ? d : null); }
  /* Códigos que a api devolve (erro) e a frase curta de cada um. */
  var MSG_ERRO = {
    assinatura_necessaria: 'Assine um plano da SolarDoc para seguir.',
    etapa_bloqueada: 'Esta etapa ainda não abriu. Conclua a anterior.',
    trilha_desligada: 'A trilha não está disponível agora. Tente mais tarde.',
    ja_pedido: 'Este pedido já foi enviado.',
    contato_invalido: 'Confira o nome e o WhatsApp.',
    nome_invalido: 'Escreva o nome de quem vai na reunião.',
    whatsapp_invalido: 'Escreva o WhatsApp com DDD.',
    ja_pedida: 'A reunião já foi pedida.',
    ja_concluido: 'Esta etapa já foi concluída.',
    formato_ja_escolhido: 'Você já começou o outro formato.',
    cliente_invalido: 'Esse cliente não está na sua conta.',
    proposta_invalida: 'Essa proposta não está na sua conta.',
    reuniao_invalida: 'Confira os dados da reunião e tente de novo.',
    termo_pendente: 'Aceite o Termo de Parceria antes.',
    aguarde: 'Releia a aula e tente de novo daqui a pouco.'
  };
  function postar(caminho, corpo, btn, ok) {
    if (btn) { btn.disabled = true; btn.dataset.rot = btn.textContent; btn.textContent = 'Enviando'; }
    var p = st.demo ? Promise.resolve(demoPost(caminho, corpo)) : C.api('POST', caminho, corpo);
    return p.then(function (r) {
      if (btn) { btn.disabled = false; if (btn.dataset.rot) btn.textContent = btn.dataset.rot; }
      if (!r.ok) {
        var d = r.data || {}, cod = d.erro || d.error || '';
        var msg = typeof d.message === 'string' ? d.message : (typeof cod === 'string' && cod.length > 30 ? cod : '');
        C.toast(msg || MSG_ERRO[cod] || (r.status === 0 ? 'Sem conexão. Tente de novo.' : 'Não foi possível concluir. Tente de novo.'), true);
        /* Sem plano pago: a tela passa a mostrar o cartão "Assine para seguir", cujo botão abre /assinar na janela de cima (o app roda em iframe). */
        if (cod === 'assinatura_necessaria' && E && E.ligada) { E.assinante = false; C.repintarTudo(); }
        /* Já pedido (outra aba, outro aparelho): busca a trilha para a tela mostrar o pedido que existe. */
        if (cod === 'ja_pedido' || cod === 'ja_pedida') recarregar();
        /* Contato recusado pela api: o erro vai para baixo do campo que ela apontou. */
        if (cod === 'contato_invalido' && /^(nome|whatsapp|periodo)$/.test(d.campo || '')) {
          st.diag.erro = { campo: d.campo, msg: d.campo === 'nome' ? 'Escreva o nome de quem vai na reunião.' : d.campo === 'whatsapp' ? 'Confira o WhatsApp com DDD.' : 'Escolha o melhor período.' };
          C.repintar(true);
        }
        return null;
      }
      var t = trilhaDe(r.data);
      if (t) aplicar(t);
      if (ok) ok(r.data || {});
      return r.data;
    });
  }

  /* ------------------------------------------------------------------ próximo passo (sempre um, com um botão) */
  function proximo() {
    var p = pat(), r = rx(), d = diag(), pr = prep(), ru = reun();
    if (p === 1) {
      if (r.enviado_em && num(r.nota) < 80) return { t: 'Suba sua nota para 80', meta: [['alvo', 'Nota ' + num(r.nota)]], bt: 'Ver o que falta', ir: 'trilha/nota' };
      var resp = st.rx.resp, feitas = Q.filter(function (q) { return q.k.charAt(0) !== '_' && respondida(q.k, resp); }).length;
      if (feitas) return { t: 'Continue seu Raio-X', meta: [['radar', feitas + ' de ' + (Q.length - 1) + ' respostas']], bt: 'Continuar', ir: 'trilha/raiox', pct: feitas / (Q.length - 1) };
      return { t: 'Faça seu Raio-X', meta: [['relogio', 'Cerca de 10 min'], ['check', 'Tudo fica salvo']], bt: 'Começar', ir: 'trilha/raiox', aj: 'Uma pergunta por tela. O que a SolarDoc já sabe vem preenchido.' };
    }
    if (p === 2) {
      if (!assinante()) return { t: 'Assine para seguir', meta: [['info', 'O diagnóstico é para assinantes']], bt: 'Ver os planos', href: '/assinar', aj: 'O Nível 1 é para todos. Do diagnóstico em diante, só com plano pago da SolarDoc.' };
      if (d.feito_em && d.resultado === 'ainda_nao') return { t: 'Ajuste o plano e volte', meta: [['alvo', 'Diagnóstico em ' + dm(d.feito_em)]], bt: 'Ver o plano', ir: 'trilha/diagnostico' };
      if (d.agendado_para) return { t: 'Diagnóstico, 30 min', meta: [['calendario', dmh(d.agendado_para)], ['video', 'Vídeo']], bt: urlSegura(d.link) ? 'Entrar na reunião' : 'Ver o diagnóstico', href: urlSegura(d.link), ir: 'trilha/diagnostico' };
      if (d.pedido_em) return { t: 'Contato enviado', meta: [['conversa', 'A equipe chama você no WhatsApp']], bt: 'Ver o pedido', ir: 'trilha/diagnostico', aj: 'Vocês combinam o dia da reunião de 30 minutos.' };
      return { t: 'Deixe um contato', meta: [['video', 'Diagnóstico de 30 min'], ['conversa', 'A equipe NEXUS chama você']], bt: 'Deixar meu contato', ir: 'trilha/diagnostico', aj: 'Reunião de 30 minutos com a NEXUS. Sai o seu plano de entrada.' };
    }
    if (p === 3) {
      if (!pr.formato) return { t: 'Escolha como se preparar', meta: [['capelo', 'Mentoria ou Academia']], bt: 'Escolher', ir: 'trilha/preparo' };
      if (pr.formato === 'academia') {
        var a = (pr.academia || {}), fe = num(a.feitas), meta = num(a.meta, 12) || 12;
        return { t: fe ? 'Academia: aula ' + Math.min(meta, fe + 1) + ' de ' + meta : 'Comece a Academia', meta: [['capelo', fe + ' de ' + meta + ' aulas']], bt: fe ? 'Continuar' : 'Começar', ir: 'trilha/academia', pct: fe / meta };
      }
      var enc = num(pr.encontros), em = num(pr.encontros_meta, 4) || 4;
      if (!pr.mentoria_paga_em) return { t: 'Mentoria NEXUS', meta: [['usuarios', 'A equipe combina com você']], bt: 'Ver a mentoria', ir: 'trilha/preparo', aj: 'Valor e datas a combinar com a equipe. Os 4 encontros abrem a proposta com a sua marca.' };
      return { t: 'Encontro ' + Math.min(em, enc + 1) + ' da mentoria: ' + ENCONTROS[Math.min(em, enc + 1) - 1].toLowerCase(), meta: [['video', 'Por vídeo']], bt: 'Ver a mentoria', ir: 'trilha/preparo', pontos: [enc, em] };
    }
    if (p === 4) {
      if (!termoAceito()) return { t: 'Aceite o Termo de Parceria', meta: [['caneta', 'As regras da parceria']], bt: 'Ler o termo', ir: 'trilha/termo' };
      if (!ru.pedida_em) return { t: 'Marque a reunião com seu cliente', meta: [['aperto', 'NEXUS, você e o cliente']], bt: 'Escolher o cliente', ir: 'trilha/reuniao' };
      var nm = (ru.dados && ru.dados.cliente_nome) || 'seu cliente';
      if (ru.agendada_para) return { t: 'Reunião com ' + nm, meta: [['calendario', dmh(ru.agendada_para)]], bt: 'Ver a reunião', ir: 'trilha/reuniao', aj: 'Passa quando a equipe marca a reunião como feita. Aí abre o pedido de carregador.' };
      return { t: 'Reunião pedida', meta: [['relogio', 'A equipe confirma o horário']], bt: 'Ver o pedido', ir: 'trilha/reuniao' };
    }
    if (p === 5) {
      var cli = (reun().dados && reun().dados.cliente_nome) || '';
      return { t: cli ? 'Faça o pedido do ' + cli : 'Faça o primeiro pedido', meta: ru.feita_em ? [['check', 'Reunião feita em ' + dm(ru.feita_em)]] : [['raio', 'DC 80 ou DC 120']], bt: 'Fazer o pedido', ir: 'equipamentos', aj: 'O pedido confirmado abre o Nível 5. Pagamento para a K EMA EASY, a NEXUS.' };
    }
    if (p === 6) return { t: 'Siga vendendo', meta: [['pino', 'Próximo: Parceiro regional']], bt: 'Gerar proposta', ir: 'propostas', aj: 'A equipe NEXUS promove a Parceiro regional. Aí abrem as obras da sua região.' };
    return { t: 'Obras da sua região', meta: [['pino', 'Parceiro regional']], bt: 'Ver as obras', ir: 'oportunidades' };
  }
  var ENCONTROS = ['Mercado', 'Técnica', 'Venda', 'Financiamento'];

  function passoHTML() {
    var x = proximo(), botao;
    if (x.href) botao = '<a class="tr-bt br lg" href="' + esc(x.href) + '"' + (/^https:/.test(x.href) ? ' target="_blank" rel="noopener"' : ' target="_top"') + '>' + esc(x.bt) + '</a>';
    else botao = '<a class="tr-bt br lg" href="#' + esc(x.ir) + '">' + esc(x.bt) + '</a>';
    var pts = '';
    if (x.pontos) {
      for (var k = 0; k < x.pontos[1]; k++) pts += '<i class="' + (k < x.pontos[0] ? 'f' : k === x.pontos[0] ? 'a' : '') + '"></i>';
      pts = '<div class="tr-pontos" role="img" aria-label="' + x.pontos[0] + ' de ' + x.pontos[1] + ' encontros feitos">' + pts + '</div>';
    } else if (x.pct != null) pts = '<div class="tr-barra-esc" role="img" aria-label="' + Math.round(x.pct * 100) + '% feito"><i style="width:' + Math.round(x.pct * 100) + '%"></i></div>';
    return '<section class="tr-cx tr-passo" aria-labelledby="tr-passo-t"><div class="tr-passo-tx"><span class="tr-rot">Seu próximo passo' + (x.aj ? ' ' + aj(x.aj) : '') + '</span>' +
      '<h2 id="tr-passo-t">' + esc(x.t) + '</h2><div class="tr-meta">' + (x.meta || []).map(function (m) { return '<span>' + ic(m[0], 'p') + esc(m[1]) + '</span>'; }).join('') + '</div>' + pts + '</div>' + botao + '</section>';
  }

  /* ------------------------------------------------------------------ escada */
  function abreQuando(n) {
    var f = prep().formato;
    if (n === 4 && f) return f === 'mentoria' ? 'Abre ao terminar a mentoria' : 'Abre ao terminar a Academia';
    return 'Abre ao concluir o Nível ' + (n - 1);
  }
  function trancaTexto(n) { return 'Abre ao concluir o Nível ' + (n - 1) + '. ' + PAT[n - 1].passa; }
  function escadaHTML() {
    var p = pat(), cel = C.mobile(), h = '';
    for (var n = 1; n <= 6; n++) {
      var P = PAT[n], ok = feito(n), at = !ok && n === p, lk = !ok && n > p;
      var est = ok ? '<span class="tr-est ok">' + esc(dm(etapa(n).em)) + '</span>' : at ? '<span class="tr-est az">' + (n === 3 && prep().formato === 'mentoria' ? num(prep().encontros) + '/4' : n === 3 && prep().formato === 'academia' ? num(prep().academia && prep().academia.feitas) + '/12' : 'Agora') + '</span>' : '';
      var destino = n === 1 && (ok || rx().enviado_em) ? 'trilha/nota' : P.rota;
      if (cel) {
        h += '<li class="' + (ok ? 'feita' : at ? 'at' : 'lk') + '"><a href="#' + destino + '"><span class="b">' + (ok ? ic('check', 'p') : lk ? ic('cadeado', 'p') : n) + '</span><span class="nm">' + esc(P.nome) + '<small>' + esc(P.sub) + '</small></span>' + est + '</a>' + (lk ? aj(trancaTexto(n)) : '') + '</li>';
      } else {
        h += '<li class="tr-esa ' + (ok ? 'feita' : at ? 'at' : 'lk') + '"><a href="#' + destino + '"' + (at ? ' aria-current="step"' : '') + '><span class="deg" style="height:' + (58 + n * 20) + 'px"><span class="n">' + n + (ok ? ic('check', 'p') : lk ? ic('cadeado', 'p') : '') + '</span>' + ic(P.ic) + '</span>' +
          '<b>' + esc(P.nome) + '</b><small>' + esc(P.sub) + '</small>' + est + '</a>' + (lk && n === p + 1 ? '<span class="tr-trava">' + esc(abreQuando(n)) + '</span>' : lk ? '<span class="tr-trava-aj">' + aj(trancaTexto(n)) + '</span>' : '') + '</li>';
      }
    }
    return '<section class="tr-cx" aria-labelledby="tr-esc-t"><div class="tr-cab-l"><h3 id="tr-esc-t">Sua escada ' + aj('Cada degrau abre quando o anterior termina. Cada um deixa a sua empresa mais forte para vender.') + '</h3>' +
      '<span class="tr-sub">' + esc(rotulo()) + '. Tudo fica salvo.</span></div>' + (cel ? '<ol class="tr-vlist">' + h + '</ol>' : '<ol class="tr-escada">' + h + '</ol>') + '</section>';
  }
  function premioHTML() {
    var p = Math.min(6, pat()), L = ABRE[p] || [];
    var itens = L.map(function (x) { return '<li>' + ic(x[0], 'p') + esc(x[1]) + '</li>'; }).join('');
    if (p < 6) itens += '<li class="top">' + ic('cadeado', 'p') + 'Obras da sua região ' + aj('Abre só no Parceiro regional, o último nível.') + '</li>';
    return '<section class="tr-cx tr-premio" aria-labelledby="tr-pr-t"><div class="tr-vid" aria-hidden="true"><div class="falso"><span class="fb"></span><span class="fl"></span><span class="fl" style="width:80%"></span><span class="fl" style="width:60%"></span></div><div class="cad"><span>' + ic('cadeado') + '</span></div></div>' +
      '<div><h3 id="tr-pr-t">Abre no fim do Nível ' + p + '</h3><ul class="tr-libs">' + itens + '</ul></div></section>';
  }
  /* Selo do parceiro: o prêmio do Nível 3. Trancado até o Nível 3 terminar; depois, o selo de verdade com o botão de baixar.
     soGanho: no início limpo e no Histórico só aparece se já foi ganho. */
  function seloHTML(soGanho) {
    if (!C.selo) return '';
    var ganho = C.selo.liberado();
    if (soGanho && !ganho) return '';
    var chip = ganho ? '<span class="tr-est ok">' + ic('check', 'p') + 'Ganho no Nível 3</span>' : '<span class="tr-est cz">' + ic('cadeado', 'p') + 'Trancado</span>';
    var acao = ganho ? '' : '<p class="tr-sub">Use nas suas redes e nos seus materiais.</p>' +
      '<span class="tr-sub tr-lin">Abre ao concluir o Nível 3 ' + aj('Abre ao concluir o Nível 3: 4 encontros da mentoria ou as 12 aulas da Academia. Aí você baixa o selo em PNG, com o nome da sua empresa.') + '</span>';
    return '<section class="tr-cx tr-selo" aria-labelledby="tr-selo-t"><div class="tr-cab-l"><span class="tr-rot">' + (ganho ? 'Seu prêmio' : 'Prêmio do Nível 3') + '</span>' + chip + '</div>' +
      '<h3 id="tr-selo-t">Selo do parceiro</h3>' + C.selo.bloco(ganho, acao) + '</section>';
  }
  function conquistaHTML() {
    if (!st.conq) return '';
    /* O aviso de conquista fica na tela em que apareceu; saiu dela, some. */
    var aqui = C.S.rota + '/' + C.S.sub;
    if (st.conq.onde && st.conq.onde !== aqui) { st.conq = null; return ''; }
    st.conq.onde = aqui;
    var c = st.conq;
    return '<div class="tr-conq" role="status">' + ic('check') + '<b>' + esc(c.t) + '</b><span>' + esc(c.s) + '</span>' + (c.ir ? '<a class="tr-bt br" href="#' + esc(c.ir) + '">' + esc(c.bt) + '</a>' : '') + '</div>';
  }
  function telaTrilha() {
    var u = uf();
    return '<div class="tr-pag">' + conquistaHTML() +
      '<div class="tr-topo">' + passoHTML() +
      '<section class="tr-cx tr-regiao"><span class="pin">' + ic('pino') + '</span><h3>Seja um dos primeiros parceiros aprovados' + (u ? ' em ' + esc(u) : ' na sua região') + '</h3>' +
      '<span class="tr-sub tr-lin">Sem número inventado ' + aj('Quando houver pedidos reais da sua região no banco, o número aparece aqui.') + '</span></section></div>' +
      escadaHTML() + premioHTML() + '</div>';
  }

  /* ------------------------------------------------------------------ cabeçalho das telas internas */
  function cab(titulo, voltar, extra) {
    return '<div class="tr-cabt"><a class="tr-volta" href="#' + esc(voltar || 'trilha') + '" aria-label="Voltar">' + ic('voltar') + '</a><h1 class="tr-h1" tabindex="-1">' + esc(titulo) + '</h1>' + (extra || '') + '</div>';
  }
  function trancada(n, titulo) {
    return '<div class="tr-pag">' + cab(titulo) + '<section class="tr-cx tr-lk"><span class="tr-ib">' + ic('cadeado') + '</span><div><h3>Abre no fim do Nível ' + (n - 1) + '</h3><p class="tr-sub">' + esc(PAT[n - 1].passa) + '</p></div>' +
      '<a class="tr-bt az" href="#' + esc(n - 1 === 1 ? 'trilha/raiox' : PAT[n - 1].rota) + '">Ir para o Nível ' + (n - 1) + '</a></section></div>';
  }

  /* ------------------------------------------------------------------ Raio-X: uma pergunta por tela */
  function primeiraAberta() {
    var r = st.rx.resp;
    for (var i = 1; i < Q.length; i++) if (!respondida(Q[i].k, r)) return i;
    return Q.length - 1;
  }
  function blocosHTML(i) {
    var q = Q[i], noBloco = Q.filter(function (x) { return x.b === q.b; }), pos = noBloco.indexOf(q);
    return '<div class="tr-blocos" aria-hidden="true">' + BLOCOS.map(function (n, k) {
      var w = k < q.b ? 100 : k === q.b ? Math.round(100 * (pos + 1) / noBloco.length) : 0;
      return '<div class="' + (k === q.b ? 'at' : '') + '"><i><b style="width:' + w + '%"></b></i><span>' + n + '</span></div>';
    }).join('') + '</div>';
  }
  function telaRaioX() {
    if (feito(1)) return telaNota();
    if (st.rx.i < 0) st.rx.i = Object.keys(st.rx.resp).length ? primeiraAberta() : 0;
    var i = st.rx.i, q = Q[i], r = st.rx.resp;
    var pct = Math.round(100 * i / (Q.length - 1));
    var h = '<div class="tr-pag tr-qz-pag"><div class="tr-qz" data-q="' + esc(q.k) + '">' +
      '<div class="tr-qz-top">' + (i > 0 ? '<button type="button" class="tr-icb" data-tr="rxVoltar" aria-label="Pergunta anterior">' + ic('voltar') + '</button>' : '<a class="tr-icb" href="#trilha" aria-label="Voltar para a trilha">' + ic('voltar') + '</a>') +
      '<span class="tr-qz-bl">' + esc(BLOCOS[q.b]) + '</span><span class="num">' + pct + '%</span></div>' + blocosHTML(i);
    if (q.tipo === 'confirmar') h += confirmarHTML();
    else if (q.tipo === 'carteira') h += carteiraHTML();
    else if (q.tipo === 'simulacao') h += simulacaoHTML();
    else {
      h += '<h2 class="tr-qz-h" id="tr-q-t" tabindex="-1">' + esc(q.t) + '</h2>';
      if (q.dicaSd && num(prefill().propostas_solares) > 0) h += '<p class="tr-dica sd">' + ic('info', 'p') + 'Você já fez ' + num(prefill().propostas_solares) + ' propostas na SolarDoc</p>';
      else if (q.dicaCidade && prefill().cidade) h += '<p class="tr-dica">' + ic('pino', 'p') + 'A partir de ' + esc(cidUf(prefill().cidade, prefill().uf).txt) + '</p>';
      else if (q.dica) h += '<p class="tr-dica">' + esc(q.dica) + '</p>';
      var marc = q.multi ? (Array.isArray(r[q.k]) ? r[q.k] : []) : null;
      h += '<div class="tr-ops" role="' + (q.multi ? 'group' : 'radiogroup') + '" aria-labelledby="tr-q-t">' + q.ops.map(function (o) {
        var sel = q.multi ? marc.indexOf(o[0]) >= 0 : String(r[q.k]) === String(o[0]);
        return '<button type="button" class="tr-op' + (q.multi ? ' multi' : '') + (sel ? ' sel' : '') + '" role="' + (q.multi ? 'checkbox' : 'radio') + '" aria-checked="' + sel + '" data-tr="' + (q.multi ? 'rxMarca' : 'rxResp') + '" data-v="' + esc(o[0]) + '">' +
          '<span class="mk">' + (sel ? ic('check') : '') + '</span>' + esc(o[1]) + (q.multi ? '' : '<span class="seta">' + ic('seta', 'p') + '</span>') + '</button>';
      }).join('') + '</div>';
      if (q.multi) h += '<button type="button" class="tr-bt az lg tr-cont" data-tr="rxSegue">' + (marc.length ? 'Continuar com ' + marc.length : 'Continuar') + '</button>';
    }
    return h + '</div></div>';
  }
  function confirmarHTML() {
    var p = prefill(), cu = cidUf(p.cidade, p.uf);
    function linha(rot, val, falta) {
      return '<div><dt>' + esc(rot) + '</dt><dd>' + (val ? esc(val) : '<span class="tr-falta">Falta</span>') + (falta && !val ? ' ' + aj(falta) : '') + '</dd></div>';
    }
    var cnpj = String(p.cnpj || '').replace(/\D/g, '');
    if (cnpj.length === 14) cnpj = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    return '<h2 class="tr-qz-h" id="tr-q-t" tabindex="-1">Confirme o que já sabemos</h2><span class="tr-veio">Veio da SolarDoc</span>' +
      '<dl class="tr-conf">' + linha('Empresa', p.empresa) + linha('CNPJ', cnpj) + linha('Cidade', cu.txt, 'Complete na SolarDoc. Vale pontos na nota.') +
      linha('Logo', p.tem_logo ? 'Cadastrado' : '', 'Envie o logo na SolarDoc. Ele vai na proposta com a sua marca.') +
      linha('Engenheiro', p.engenheiro_crea ? 'Com CREA' : '', 'Sem engenheiro com CREA na SolarDoc. A NEXUS pode fazer a engenharia.') + '</dl>' +
      '<p class="tr-cart">' + ic('usuarios', 'p') + num((p.clientes_pj || []).length) + ' clientes empresa · ' + num(p.propostas_solares) + ' propostas</p>' +
      '<button type="button" class="tr-bt az lg tr-cont" data-tr="rxConfirma">Está certo</button>' +
      '<a class="tr-lnk" href="/empresa" target="_top">Corrigir na SolarDoc</a>';
  }

  /* Carteira: escolhe dos clientes PJ da SolarDoc, sem digitar. Só quem não tem carteira digita um nome. */
  function carteira() { return Array.isArray(st.rx.resp.clientes_em_vista) ? st.rx.resp.clientes_em_vista : []; }
  function noVista(id, nome) {
    var l = carteira();
    for (var i = 0; i < l.length; i++) if ((id && l[i].cliente_id === id) || (!id && l[i].nome === nome)) return i;
    return -1;
  }
  function carteiraHTML() {
    var pj = (prefill().clientes_pj || []).slice(0, 50), l = carteira(), b = st.busca.toLowerCase();
    var extras = l.filter(function (c) { return !c.cliente_id; });
    var mostra = pj.filter(function (c) { return !b || String(c.nome).toLowerCase().indexOf(b) >= 0 || noVista(c.id) >= 0; });
    function linha(c, idx, chave) {
      var marcado = idx >= 0, v = marcado ? l[idx] : {}, cu = cidUf(c.cidade, c.uf);
      var h = '<li class="tr-cli' + (marcado ? ' on' : '') + '"><label class="tr-cli-l"><input type="checkbox" data-tr-ch="cli" data-v="' + esc(chave) + '"' + (marcado ? ' checked' : '') + '><span><b>' + esc(c.nome) + '</b><small>' + esc(cu.txt || 'Cidade não informada') + '</small></span></label>';
      if (marcado) {
        h += '<div class="tr-cli-x"><label class="tr-sel-l"><span class="nx-sr">Tipo do lugar de ' + esc(c.nome) + '</span><select data-tr-ch="tipo" data-v="' + esc(chave) + '">' +
          '<option value="">Tipo do lugar</option>' + TIPOS.map(function (t) { return '<option value="' + t[0] + '"' + (v.tipo_local === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>' +
          '<div class="tr-pills" role="radiogroup" aria-label="Estágio de ' + esc(c.nome) + '">' + FASES.map(function (f) {
            return '<button type="button" class="tr-pill' + (v.fase === f[0] ? ' on' : '') + '" role="radio" aria-checked="' + (v.fase === f[0]) + '" data-tr="cliFase" data-c="' + esc(chave) + '" data-v="' + f[0] + '">' + f[1] + '</button>';
          }).join('') + '</div></div>';
      }
      return h + '</li>';
    }
    var h = '<h2 class="tr-qz-h" id="tr-q-t" tabindex="-1">Quem da sua carteira pode ter um ponto?</h2>' +
      '<p class="tr-dica">Até 10. Toque para marcar. ' + aj('Só clientes empresa da SolarDoc. Diga o tipo do lugar e em que pé está a conversa.') + '</p>';
    if (pj.length > 8) h += '<label class="tr-busca">' + ic('busca', 'p') + '<span class="nx-sr">Buscar na carteira</span><input type="search" data-tr-in="busca" placeholder="Buscar na carteira…" name="busca" autocomplete="off" value="' + esc(st.busca) + '"></label>';
    h += '<ul class="tr-cli-lista">';
    mostra.forEach(function (c) { h += linha(c, noVista(c.id), 'id:' + c.id); });
    extras.forEach(function (c) { h += linha(c, noVista('', c.nome), 'nm:' + c.nome); });
    if (!pj.length && !extras.length) h += '<li class="tr-vazio">Nenhum cliente empresa na SolarDoc ainda.</li>';
    h += '</ul>';
    if (l.length < 10) {
      h += '<details class="tr-add"><summary>' + ic('mais', 'p') + 'Outro cliente</summary><div class="tr-add-c">' +
        '<div class="nx-campo"><label for="tr-add-nome">Nome</label><input type="text" id="tr-add-nome" name="cliente_nome" maxlength="120" autocomplete="off"></div>' +
        '<div class="tr-dois"><div class="nx-campo"><label for="tr-add-cid">Cidade</label><input type="text" id="tr-add-cid" name="cliente_cidade" maxlength="80" autocomplete="off"></div>' +
        '<div class="nx-campo"><label for="tr-add-uf">UF</label><input type="text" id="tr-add-uf" name="cliente_uf" maxlength="2" autocomplete="off" style="text-transform:uppercase"></div></div>' +
        '<button type="button" class="tr-bt sec" data-tr="cliAdd">Adicionar</button></div></details>';
    }
    var falta = l.filter(function (c) { return !c.tipo_local || !c.fase; }).length;
    h += '<button type="button" class="tr-bt az lg tr-cont" data-tr="rxSegue">' + (l.length ? 'Continuar com ' + l.length : 'Continuar sem cliente') + '</button>';
    return h;
  }

  /* Simulação: a mesma conta do Simulador do portal (js/calc.js). */
  function simPadrao() {
    var s = st.rx.resp.simulacao || {}, r = s.resultado || {}, cl = carteira();
    var ps = C.produtos(), mod = s.modelo || (ps[0] && ps[0].id) || '';
    var cli = r.cliente_nome || (cl[0] && cl[0].nome) || '';
    var tipo = s.tipo_local || (cl[0] && cl[0].tipo_local) || 'posto';
    return { cliente: cli, tipo: tipo, modelo: mod, recargas: num(r.recargas_dia, 10) || 10, kwh: num(r.kwh_recarga, 20) || 20, preco: num(s.preco_kwh, 2.35) || 2.35, custo: num(r.custo_kwh, 0.7) || 0.7 };
  }
  function simConta(x) {
    var calc = window.NexusCalc, ps = C.produtos(), prod = null;
    for (var i = 0; i < ps.length; i++) if (ps[i].id === x.modelo) prod = ps[i];
    if (!calc || !prod) return null;
    var c = calc.calcular({ equip: { preco: prod.precoSugerido, quantidade: 1 }, prem: { carros: x.recargas, carga: x.kwh, precoKwh: x.preco, custoKwh: x.custo } });
    return { kwh: c.r.kwhMes, receita: c.r.fatMes, sobra: c.r.lucroMes, retorno: c.paybackPleno, invest: c.r.investTotal, energia: c.r.kwhMes * x.custo, prod: prod };
  }
  function simulacaoHTML() {
    var x = st.rx.sim || (st.rx.sim = simPadrao()), cl = carteira(), ps = C.produtos();
    var h = '<h2 class="tr-qz-h" id="tr-q-t" tabindex="-1">Simule um ponto</h2><p class="tr-dica">Mude os números e veja a conta na hora.</p>';
    if (cl.length) {
      h += '<div class="nx-campo"><label for="tr-sim-cli">Lugar <span class="tr-veio">Da sua carteira</span></label><select id="tr-sim-cli" data-tr-in="simCli">' +
        cl.map(function (c) { return '<option' + (c.nome === x.cliente ? ' selected' : '') + '>' + esc(c.nome) + '</option>'; }).join('') + '</select></div>';
    } else {
      h += '<div class="nx-campo"><label for="tr-sim-tipo">Tipo do lugar</label><select id="tr-sim-tipo" data-tr-in="simTipo">' + TIPOS.map(function (t) { return '<option value="' + t[0] + '"' + (x.tipo === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div>';
    }
    h += '<fieldset class="tr-mod"><legend>Carregador</legend>' + ps.map(function (p) {
      return '<label class="tr-mod-op' + (p.id === x.modelo ? ' on' : '') + '"><input type="radio" name="tr-mod" value="' + esc(p.id) + '" data-tr-in="simMod"' + (p.id === x.modelo ? ' checked' : '') + '><b>' + esc(String(p.nome || '').replace(/^NEXUS\s+/i, '')) + '</b></label>';
    }).join('') + '</fieldset>' +
      '<div class="tr-dois"><div class="nx-campo"><label for="tr-sim-rec">Recargas por dia</label><input type="number" id="tr-sim-rec" name="recargas_dia" inputmode="numeric" min="1" max="200" value="' + x.recargas + '" data-tr-in="simNum" data-c="recargas"></div>' +
      '<div class="nx-campo"><label for="tr-sim-kwh">kWh cada</label><input type="number" id="tr-sim-kwh" name="kwh_recarga" inputmode="numeric" min="5" max="150" value="' + x.kwh + '" data-tr-in="simNum" data-c="kwh"></div></div>' +
      '<div class="tr-dois"><div class="nx-campo"><label for="tr-sim-pr">Venda, R$ por kWh</label><input type="number" id="tr-sim-pr" name="preco_kwh" inputmode="decimal" step="0.05" min="0" value="' + x.preco + '" data-tr-in="simNum" data-c="preco"></div>' +
      '<div class="nx-campo"><label for="tr-sim-cu">Energia, R$ por kWh</label><input type="number" id="tr-sim-cu" name="custo_kwh" inputmode="decimal" step="0.05" min="0" value="' + x.custo + '" data-tr-in="simNum" data-c="custo"></div></div>' +
      '<div class="tr-sim-res" id="tr-sim-res" aria-live="polite">' + simResHTML(x) + '</div>' +
      '<button type="button" class="tr-bt az lg tr-cont" data-tr="rxEnviar">Ver minha nota</button>';
    return h;
  }
  function simResHTML(x) {
    var c = simConta(x);
    if (!c) return '<p class="tr-sub">A conta carrega em instantes.</p>';
    var pos = Math.max(0, c.sobra), soma = Math.max(1, c.receita);
    function pc(v) { return Math.max(0, Math.round(100 * v / soma)); }
    return '<div class="tr-sobra"><div><span class="tr-sub">Sobra por mês</span><strong class="num">' + rs(c.sobra) + '</strong></div>' +
      '<div class="ret"><span class="tr-sub">Retorno do carregador ' + aj('Só o preço de tabela do carregador. Obra e instalação ficam de fora desta conta.') + '</span><b class="num">' + (c.retorno ? Math.ceil(c.retorno) + ' meses' : 'Sem retorno') + '</b></div></div>' +
      '<div class="tr-pilha" role="img" aria-label="Receita de ' + rs(c.receita) + ' por mês: energia, taxas e sobra"><i class="e" style="width:' + pc(c.energia) + '%"></i><i class="t" style="width:' + pc(c.receita - c.energia - pos) + '%"></i><i class="s" style="width:' + pc(pos) + '%"></i></div>' +
      '<div class="tr-pil-leg"><span><i class="e"></i>Energia</span><span><i class="t"></i>Plataforma, impostos e fixos</span><span><i class="s"></i>Sobra</span></div>' +
      '<dl class="tr-conta"><div><dt>Energia vendida</dt><dd class="num">' + Math.round(c.kwh).toLocaleString('pt-BR') + ' kWh</dd></div><div><dt>Receita</dt><dd class="num">' + rs(c.receita) + '</dd></div></dl>';
  }

  function cliCompleto(c) { return !!(c && c.nome && c.cidade && c.uf && c.tipo_local && c.fase); }
  function salvarRx(k, v) {
    st.rx.resp[k] = v;
    st.rx.novo = st.rx.novo || {}; st.rx.novo[k] = v;
    st.rx.fila[k] = k === 'clientes_em_vista' && Array.isArray(v) ? v.filter(cliCompleto) : v;   /* a api recusa cliente sem tipo e fase: o incompleto fica só na tela */
    clearTimeout(st.rx.t);
    st.rx.t = setTimeout(enviarFila, 350);
  }
  function enviarFila() {
    var corpo = st.rx.fila; st.rx.fila = {};
    if (!Object.keys(corpo).length) return Promise.resolve();
    if (st.demo) { var n = notaLocal(st.rx.resp); st.rx.nota = n.nota; st.rx.faltas = n.faltas; return Promise.resolve(); }
    return C.api('PUT', '/trilha/raio-x', { respostas: corpo }).then(function (r) {
      if (r.ok && r.data) { st.rx.nota = num(r.data.nota); st.rx.faltas = Array.isArray(r.data.faltas) ? r.data.faltas : null; }
      else if (r.status) C.toast('Uma resposta não foi salva. Toque de novo.', true);
    });
  }
  function irPergunta(i) {
    st.rx.i = Math.max(0, Math.min(Q.length - 1, i));
    C.repintar(false);
    var h = $('#tr-q-t'); if (h) try { h.focus({ preventScroll: true }); } catch (e) { /* ok */ }
  }
  function enviarRx(btn) {
    var x = st.rx.sim || simPadrao(), c = simConta(x);
    if (c) {
      salvarRx('simulacao', { tipo_local: x.tipo, modelo: x.modelo, kwh_mes: Math.round(c.kwh), preco_kwh: x.preco,
        resultado: { receita_mes: Math.round(c.receita), sobra_mes: Math.round(c.sobra), retorno_meses: c.retorno ? Math.ceil(c.retorno) : null, recargas_dia: x.recargas, kwh_recarga: x.kwh, custo_kwh: x.custo, cliente_nome: x.cliente } });
    }
    clearTimeout(st.rx.t);
    btn.disabled = true; btn.textContent = 'Calculando a nota';
    enviarFila().then(function () {
      if (st.demo) return demoPost('/trilha/raio-x/enviar', {});
      return C.api('POST', '/trilha/raio-x/enviar', {});
    }).then(function (r) {
      if (!r || !r.ok) { btn.disabled = false; btn.textContent = 'Ver minha nota'; C.toast('Não foi possível enviar. Tente de novo.', true); return; }
      var d = r.data || {};
      st.rx.nota = num(d.nota); st.rx.faltas = Array.isArray(d.faltas) ? d.faltas : [];
      var t = trilhaDe(d); if (t) aplicar(t);
      st.rx.novo = null;
      if (d.passou) st.conq = { t: 'Nível 1 concluído.', s: 'Abriu: reunião de diagnóstico.', ir: 'trilha/diagnostico', bt: 'Deixar meu contato' };
      C.irPara('trilha/nota');
    });
  }

  /* ------------------------------------------------------------------ nota e Raio-X */
  function anelHTML(n) {
    var r = 64, c = 2 * Math.PI * r, pass = n >= 80;
    return '<div class="tr-anel" role="img" aria-label="Nota ' + n + ' de 100. Passa com 80."><svg viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="' + r + '" class="fundo"/>' +
      '<circle cx="75" cy="75" r="' + r + '" class="v' + (pass ? ' ok' : '') + '" stroke-dasharray="' + (c * n / 100).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><div class="t"><strong class="num">' + n + '</strong><span>Passa com 80</span></div></div>';
  }
  function raioXResumoHTML(r) {
    var SEM = '<span class="tr-sub">Sem resposta ainda</span>';
    function chips(l) { l = l.filter(Boolean); return l.length ? '<div class="tr-chips">' + l.map(function (t) { return '<span class="tr-chip">' + esc(t) + '</span>'; }).join('') + '</div>' : SEM; }
    var caps = (r.capacidades || []).map(function (v) { return rotOp('capacidades', v); });
    var dif = (r.dificuldades || []).map(function (v) { return rotOp('dificuldades', v); });
    var cl = Array.isArray(r.clientes_em_vista) ? r.clientes_em_vista : [];
    var sim = r.simulacao || {}, sr = sim.resultado || {};
    var faseCls = { quente: 'ok', conversando: 'az', ideia: 'cz' };
    return '<div class="tr-rx-g">' +
      '<div class="tr-rx-s"><span class="tr-rot">' + ic('chave', 'p') + 'Experiência</span>' + chips([rotOp('anos_solar', r.anos_solar), rotOp('usinas', r.usinas) ? rotOp('usinas', r.usinas) + ' usinas' : '', rotOp('equipe', r.equipe) ? rotOp('equipe', r.equipe) + ' pessoas' : ''].concat(caps)) + '</div>' +
      '<div class="tr-rx-s"><span class="tr-rot">' + ic('raio', 'p') + 'Momento</span>' + chips([rotOp('conhece_mercado', r.conhece_mercado) ? 'Conhece: ' + rotOp('conhece_mercado', r.conhece_mercado).toLowerCase() : '', rotOp('ja_montou_eletroposto', r.ja_montou_eletroposto) ? 'Eletroposto: ' + rotOp('ja_montou_eletroposto', r.ja_montou_eletroposto).toLowerCase() : '', rotOp('papel', r.papel), rotOp('quando', r.quando)]) +
        (dif.length ? '<span class="tr-sub">Dificuldade</span>' + chips(dif) : '') + '</div>' +
      '<div class="tr-rx-s"><span class="tr-rot">' + ic('usuarios', 'p') + 'Demanda</span>' + (cl.length ? '<ul class="tr-clis">' + cl.map(function (c) {
        return '<li><span>' + esc(c.nome) + '</span><span class="tr-est ' + (faseCls[c.fase] || 'cz') + '">' + esc(rotDe(FASES, c.fase) || 'Sem estágio') + '</span></li>';
      }).join('') + '</ul>' : '<span class="tr-sub">Nenhum cliente em vista</span>') + '</div>' +
      '<div class="tr-rx-s"><span class="tr-rot">' + ic('alvo', 'p') + 'Em 12 meses</span>' + (num(r.demanda_12m) > 0 ? '<span class="tr-big num">' + esc(rotOp('demanda_12m', r.demanda_12m) || r.demanda_12m) + (num(r.demanda_12m) === 1 ? ' ponto' : ' pontos') + '</span>' : SEM) + '</div>' +
      '<div class="tr-rx-s"><span class="tr-rot">' + ic('pino', 'p') + 'Região</span>' + (num(r.raio_km) > 0 ? '<span><b class="tr-big num">' + num(r.raio_km) + ' km</b> de raio</span>' : SEM) + '</div>' +
      '<div class="tr-rx-s"><span class="tr-rot">' + ic('planilha', 'p') + 'Simulação</span>' + (num(sim.kwh_mes) > 0 ? '<span><b class="tr-big num">' + rs(sr.sobra_mes) + '</b> por mês' + (sr.cliente_nome ? ' no ' + esc(sr.cliente_nome) : '') + '</span>' : '<span class="tr-sub">Ainda não feita</span>') + '</div></div>';
  }
  function telaNota() {
    var r = rx(), resp = st.rx.resp, loc = notaLocal(resp);
    var n = st.rx.nota != null ? st.rx.nota : (r.nota != null ? num(r.nota) : loc.nota);
    var faltas = st.rx.faltas || (r.enviado_em && Array.isArray(r.faltas) ? r.faltas : loc.faltas);
    var passou = feito(1);
    var h = '<div class="tr-pag">' + conquistaHTML() + cab('Seu Raio-X', 'trilha', '<span class="tr-ex">' + (r.enviado_em ? 'Enviado em ' + esc(dm(r.enviado_em)) : 'Rascunho') + '</span>');
    h += '<div class="tr-rx"><section class="tr-cx" aria-labelledby="tr-nota-t"><span class="tr-rot" id="tr-nota-t">Nota de excelência ' + aj('Tudo respondido, 1 cliente ou mais em vista e a simulação feita. Passa com 80.') + '</span>' + anelHTML(n);
    if (passou) h += '<p class="tr-ok-l">' + ic('check', 'p') + 'Nível 1 concluído em ' + esc(dm(etapa(1).em)) + '</p>' + (pat() === 2 && !diag().pedido_em && !st.conq ? '<a class="tr-bt az" href="#trilha/diagnostico">Deixar meu contato</a>' : '');
    else if (faltas && faltas.length) {
      h += '<span class="tr-rot">Falta para 80</span><ul class="tr-faltas" aria-label="O que falta para 80">' + faltas.map(function (f) {
        var alvo = FALTA_Q[f.item] != null ? qPor(FALTA_Q[f.item]) : -1;
        var miolo = '<span>' + esc(maiusc(f.texto || f.item)) + '</span><b class="num">+' + num(f.pontos) + '</b>' + ic('seta', 'p');
        if (alvo >= 0) return '<li><button type="button" class="tr-falta-b" data-tr="rxIr" data-v="' + alvo + '">' + miolo + '</button></li>';
        if (f.item === 'empresa') return '<li><a class="tr-falta-b" href="/empresa" target="_top">' + miolo + '</a></li>';
        return '<li><span class="tr-falta-b">' + miolo.replace(ic('seta', 'p'), '') + '</span></li>';
      }).join('') + '</ul>';
      h += n >= 80 && !r.enviado_em ? '<button type="button" class="tr-bt az lg tr-cont" data-tr="rxIr" data-v="' + (Q.length - 1) + '">Enviar o Raio-X</button>'
        : '<a class="tr-bt az lg tr-cont" href="#trilha/raiox">Continuar o Raio-X</a>';
    }
    h += '</section><div class="tr-rx-dir"><h2 class="tr-h2">Raio-X da ' + esc(curto(empresa())) + ' ' + aj('Você e a equipe NEXUS veem o mesmo. Revisado a cada 3 meses.') + '</h2>' + raioXResumoHTML(resp) + '</div></div>';
    return h + '</div>';
  }
  function maiusc(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }

  /* ------------------------------------------------------------------ Nível 2: diagnóstico */
  function proximosDias(n) {
    var l = [], d = new Date();
    while (l.length < n) {
      d = new Date(d.getTime() + 86400000);
      var p = partes(d);
      if (!p || p.weekday === 'Sat' || p.weekday === 'Sun') continue;
      l.push({ iso: p.year + '-' + p.month + '-' + p.day, sem: SEMANA[p.weekday], dm: p.day + '/' + p.month });
    }
    return l;
  }
  function escolhaDias(estado, acaoDia, acaoPer, rotulo) {
    return '<fieldset class="tr-dias-f"><legend>' + esc(rotulo || 'Até 3 dias') + '</legend><div class="tr-dias">' + proximosDias(8).map(function (d) {
      var on = estado.dias.indexOf(d.iso) >= 0;
      return '<button type="button" class="tr-dia' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-tr="' + acaoDia + '" data-v="' + d.iso + '"><b>' + d.sem + '</b><small>' + d.dm + '</small></button>';
    }).join('') + '</div></fieldset>' +
      '<fieldset class="tr-dias-f"><legend>Período</legend><div class="tr-pills">' + [['manha', 'Manhã'], ['tarde', 'Tarde']].map(function (p) {
        return '<button type="button" class="tr-pill lg' + (estado.periodo === p[0] ? ' on' : '') + '" aria-pressed="' + (estado.periodo === p[0]) + '" data-tr="' + acaoPer + '" data-v="' + p[0] + '">' + p[1] + '</button>';
      }).join('') + '</div></fieldset>';
  }
  function diasTxt(pref) {
    var ds = (pref && pref.dias) || [];
    return ds.map(function (x) { var p = partes(x + 'T12:00:00-03:00'); return p ? SEMANA[p.weekday] + ' ' + p.day + '/' + p.month : x; }).join(', ') + (pref && pref.periodo ? ', ' + (pref.periodo === 'manha' ? 'manhã' : 'tarde') : '');
  }
  /* Fim do Nível 1, sem agenda: a pessoa deixa um contato e o melhor período, e a equipe NEXUS chama para a reunião
     de diagnóstico. Nome e WhatsApp vêm preenchidos com o que a SolarDoc já sabe (prefill.contato_sugerido). */
  var PERIODOS = [['manha', 'Manhã', 'pela manhã'], ['tarde', 'Tarde', 'à tarde'], ['noite', 'Noite', 'à noite']];
  function contatoForm() {
    var D = st.diag;
    if (!D.pronto) {
      var cs = prefill().contato_sugerido || {};
      D.nome = String(cs.nome || '').trim(); D.whatsapp = foneFmt(cs.whatsapp); D.pronto = true;
    }
    function erro(campo) { return D.erro && D.erro.campo === campo ? '<span class="tr-erro-c" id="tr-dg-' + campo + '-e">' + esc(D.erro.msg) + '</span>' : ''; }
    function inval(campo) { return D.erro && D.erro.campo === campo ? ' aria-invalid="true"' : ''; }
    return '<form class="tr-apto-form" data-tr-form="diag" novalidate><div class="tr-apto-campos">' +
      '<div class="nx-campo"><label for="tr-dg-nome">Nome de quem vai na reunião</label>' +
        '<input type="text" id="tr-dg-nome" name="nome" autocomplete="name" maxlength="80" value="' + esc(D.nome) + '" data-tr-in="dgNome"' + inval('nome') + (D.erro && D.erro.campo === 'nome' ? ' aria-describedby="tr-dg-nome-e"' : '') + '>' + erro('nome') + '</div>' +
      '<div class="nx-campo"><label for="tr-dg-wa">WhatsApp</label>' +
        '<input type="tel" id="tr-dg-wa" name="whatsapp" inputmode="tel" autocomplete="tel-national" placeholder="(00) 00000-0000" maxlength="16" value="' + esc(D.whatsapp) + '" data-mascara="fone" data-tr-in="dgWa"' + inval('whatsapp') + ' aria-describedby="tr-dg-wa-d' + (D.erro && D.erro.campo === 'whatsapp' ? ' tr-dg-whatsapp-e' : '') + '">' +
        '<span class="nx-dica" id="tr-dg-wa-d">Com DDD. É nesse número que a equipe vai chamar você.</span>' + erro('whatsapp') + '</div></div>' +
      '<fieldset class="tr-dias-f tr-per"' + (D.erro && D.erro.campo === 'periodo' ? ' aria-describedby="tr-dg-periodo-e"' : '') + '><legend>Melhor período para conversar</legend><div class="tr-pills">' + PERIODOS.map(function (x) {
        var on = D.periodo === x[0];
        return '<button type="button" class="tr-pill lg' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-tr="dgPer" data-v="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>' + erro('periodo') + '</fieldset>' +
      '<button type="submit" class="tr-bt az lg">Pedir meu diagnóstico</button></form>';
  }
  function contatoEnviado(d) {
    var ct = d.contato || {}, wa = foneLimpo(ct.whatsapp);
    var per = null;
    PERIODOS.forEach(function (x) { if (x[0] === ct.periodo) per = x; });
    var passos = ['A equipe NEXUS lê o seu Raio-X.', per ? 'Ela chama você no WhatsApp ' + per[2] + '.' : 'Ela chama você no WhatsApp que você deixou.', 'Vocês combinam o dia da reunião de 30 minutos.'];
    return '<div class="tr-apto-corpo"><span class="tr-rot">O que acontece agora</span><ol class="tr-agora">' + passos.map(function (t, i) {
      return '<li><span class="n num" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>';
    }).join('') + '</ol>' +
      (ct.nome || wa ? '<div class="tr-contato">' + (ct.nome ? '<span>' + ic('usuarios', 'p') + esc(ct.nome) + '</span>' : '') + (wa ? '<span class="num">' + ic('conversa', 'p') + esc(foneFmt(wa)) + '</span>' : '') + (per ? '<span>' + ic('relogio', 'p') + esc(per[1]) + '</span>' : '') + '</div>' : '') +
      '</div>';
  }
  function telaDiag() {
    if (!feito(1)) return trancada(2, 'Diagnóstico');
    var d = diag(), h = '<div class="tr-pag">' + conquistaHTML() + cab('Nível 2: Diagnosticado');
    if (!assinante()) {
      return h + '<section class="tr-cx tr-lk"><span class="tr-ib">' + ic('cadeado') + '</span><div><h3>Assine para seguir</h3><p class="tr-sub">O diagnóstico é para quem tem plano pago da SolarDoc.</p></div><a class="tr-bt az" href="/assinar" target="_top">Ver os planos</a></section></div>';
    }
    h += '<div class="tr-g2">';
    if (!d.pedido_em) {
      h += '<section class="tr-cx tr-apto" aria-labelledby="tr-dg-t"><div class="tr-apto-topo"><span class="tr-apto-ok">' + ic('check') + '</span>' +
        '<h2 id="tr-dg-t" tabindex="-1">Parabéns, você concluiu o Nível 1</h2>' +
        '<p>Agora deixe um contato e a equipe NEXUS chama você para a reunião de diagnóstico. ' + aj('Reunião de 30 minutos com a NEXUS. Sai o seu plano de entrada.') + '</p></div>' +
        '<div class="tr-apto-corpo">' + contatoForm() + '</div></section>';
    } else if (d.feito_em) {
      h += '<section class="tr-cx" aria-labelledby="tr-dg-t"><h3 id="tr-dg-t">' + ic('video') + 'Diagnóstico, 30 min</h3>' + (d.resultado === 'aprovado'
        ? '<div class="tr-feito">' + ic('check') + 'Aprovado para seguir · ' + esc(dm(d.feito_em)) + ' ' + aj('A equipe marca no fim da reunião. Isso abre o Nível 3.') + '</div>'
        : '<div class="tr-feito av">' + ic('info') + 'Ainda não · ' + esc(dm(d.feito_em)) + ' ' + aj('Siga o plano ao lado. A equipe marca de novo quando estiver pronto.') + '</div>') + '</section>';
    } else if (d.agendado_para) {
      var link = urlSegura(d.link);
      h += '<section class="tr-cx" aria-labelledby="tr-dg-t"><h3 id="tr-dg-t">' + ic('video') + 'Diagnóstico, 30 min</h3>' +
        '<div class="tr-quando"><span class="tr-ib">' + ic('calendario') + '</span><div><b>' + esc(dmh(d.agendado_para)) + '</b><small>Por vídeo, com a equipe NEXUS</small></div></div>' +
        (link ? '<a class="tr-bt az lg" href="' + esc(link) + '" target="_blank" rel="noopener">' + ic('video', 'p') + 'Entrar na reunião</a>' : '<p class="tr-sub">O link chega aqui antes da reunião.</p>') + '</section>';
    } else {
      /* Contato enviado, esperando a equipe. Pedido antigo (com dias e período) mostra a preferência embaixo. */
      var pref = d.preferencia && d.preferencia.dias && d.preferencia.dias.length ? diasTxt(d.preferencia) : '';
      h += '<section class="tr-cx tr-apto" aria-labelledby="tr-dg-t"><div class="tr-apto-topo"><span class="tr-apto-ok">' + ic('check') + '</span>' +
        '<h2 id="tr-dg-t" tabindex="-1">Contato enviado</h2><p>Recebemos seu pedido de diagnóstico.</p></div>' + contatoEnviado(d) +
        (pref ? '<p class="tr-sub tr-apto-pref">' + esc(maiusc(pref)) + '</p>' : '') + '</section>';
    }
    h += '<section class="tr-cx" aria-labelledby="tr-pl-t"><h3 id="tr-pl-t">Seu plano de entrada</h3>';
    if (d.plano) h += '<p class="tr-plano">' + esc(d.plano) + '</p>';
    else h += '<ul class="tr-plano-l"><li><span class="tr-ib">' + ic('usuarios', 'p') + '</span><span><b>Clientes certos</b><small>Quem da carteira atacar primeiro</small></span></li><li><span class="tr-ib">' + ic('raio', 'p') + '</span><span><b>Modelo</b><small>DC 80 ou DC 120</small></span></li><li><span class="tr-ib">' + ic('caneta', 'p') + '</span><span><b>Contrato</b><small>O formato que fecha</small></span></li></ul><p class="tr-sub">Sai na reunião.</p>';
    h += '</section></div>';
    if (feito(2)) h += '<a class="tr-bt az lg tr-seg" href="#trilha/preparo">Escolher como se preparar</a>';
    return h + '</div>';
  }
  /* Valida e envia o contato. O erro aparece embaixo do campo, que recebe o foco. */
  function pedirDiagnostico(btn) {
    var D = st.diag, nome = String(D.nome || '').trim().replace(/\s+/g, ' '), wa = foneLimpo(D.whatsapp);
    D.erro = null;
    if (nome.length < 2) D.erro = { campo: 'nome', msg: 'Escreva o nome de quem vai na reunião.' };
    else if (!/^[1-9]\d(?:[2-8]\d{7}|9\d{8})$/.test(wa)) D.erro = { campo: 'whatsapp', msg: wa.length ? 'Confira o número. Com DDD são 10 ou 11 dígitos.' : 'Escreva o WhatsApp com DDD.' };
    else if (!D.periodo) D.erro = { campo: 'periodo', msg: 'Escolha o melhor período.' };
    if (D.erro) {
      C.repintar(true);
      var f = $(D.erro.campo === 'nome' ? '#tr-dg-nome' : D.erro.campo === 'whatsapp' ? '#tr-dg-wa' : '.tr-per .tr-pill'); if (f) try { f.focus(); } catch (e) { /* ok */ }
      return;
    }
    postar('/trilha/diagnostico', { contato: { nome: nome.slice(0, 80), whatsapp: wa, periodo: D.periodo } }, btn, function () {
      st.conq = null; C.repintarTudo();
      window.scrollTo(0, 0);
      var t = $('#tr-dg-t'); if (t) try { t.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    });
  }

  /* ------------------------------------------------------------------ Nível 3: mentoria ou Academia */
  function telaPreparo() {
    if (!feito(2)) return trancada(3, 'Preparo');
    var pr = prep(), h = '<div class="tr-pag">' + conquistaHTML() + cab('Nível 3: Preparado');
    var acad = pr.academia || {}, fe = num(acad.feitas), meta = num(acad.meta, 12) || 12;
    h += '<div class="tr-escolha">';
    if (pr.formato === 'mentoria') {
      var enc = num(pr.encontros), em = num(pr.encontros_meta, 4) || 4;
      h += '<section class="tr-cx tr-ment" aria-labelledby="tr-mt-t"><div class="tr-cab-l"><span class="tr-rot">Sua mentoria</span><span class="tr-est ok">' + enc + ' de ' + em + '</span></div>' +
        '<h3 id="tr-mt-t">Mentoria NEXUS ' + aj('Passa com os 4 encontros feitos. A equipe registra cada um.') + '</h3><ol class="tr-enc">' + ENCONTROS.map(function (n, k) {
          var f = k < enc, a = k === enc;
          return '<li class="' + (f ? 'f' : a ? 'a' : '') + '">' + ic(f ? 'check' : a ? 'calendario' : 'cadeado') + '<b>' + n + '</b><small>' + (f ? 'Feito' : a ? 'Próximo' : 'Depois') + '</small></li>';
        }).join('') + '</ol><div class="tr-ment-pe"><span>' + (pr.mentoria_paga_em ? ic('check', 'p') + 'Confirmada em ' + esc(dm(pr.mentoria_paga_em)) : 'Valor a combinar com a equipe') + '</span></div></section>';
      h += '<section class="tr-cx tr-acad"><div class="tr-cab-l"><span class="tr-rot">Ou grátis</span><span class="tr-sub num">' + fe + ' de ' + meta + '</span></div><h3>Academia NEXUS</h3><p class="tr-sub">12 aulas curtas com checagem.</p>' +
        (pr.mentoria_paga_em ? '' : '<button type="button" class="tr-bt sec" data-tr="prepFormato" data-v="academia">Fazer pela Academia</button>') + '</section>';
    } else if (pr.formato === 'academia') {
      h += '<section class="tr-cx tr-acad tr-acad-on"><div class="tr-cab-l"><span class="tr-rot">Sua Academia</span><span class="tr-est az num">' + fe + ' de ' + meta + '</span></div><h3>Academia NEXUS ' + aj('Passa com as 12 aulas, todas com a checagem certa.') + '</h3>' +
        '<div class="tr-barra-esc claro" role="img" aria-label="' + fe + ' de ' + meta + ' aulas"><i style="width:' + Math.round(100 * fe / meta) + '%"></i></div>' +
        '<a class="tr-bt az lg" href="#trilha/academia">' + (fe ? 'Continuar' : 'Começar') + '</a></section>' +
        '<section class="tr-cx tr-ment"><span class="tr-rot">Caminho rápido</span><h3>Mentoria NEXUS, 4 encontros</h3><span class="tr-sub-inv">Mercado, técnica, venda e financiamento</span><span class="tr-sub-inv">Valor a combinar com a equipe</span>' +
        '<button type="button" class="tr-bt br" data-tr="prepFormato" data-v="mentoria">Quero a mentoria</button></section>';
    } else {
      h += '<section class="tr-cx tr-ment"><span class="tr-rot">Caminho rápido</span><h3>Mentoria NEXUS, 4 encontros</h3><span class="tr-sub-inv">Mercado, técnica, venda e financiamento</span>' +
        '<span class="tr-sub-inv">Valor a combinar com a equipe ' + aj('A equipe combina valor e datas com você depois da escolha.') + '</span><button type="button" class="tr-bt br lg" data-tr="prepFormato" data-v="mentoria">Quero a mentoria</button></section>' +
        '<section class="tr-cx tr-acad"><span class="tr-rot">Grátis</span><h3>Academia NEXUS</h3><span class="tr-sub">12 aulas curtas com checagem</span><button type="button" class="tr-bt sec lg" data-tr="prepFormato" data-v="academia">Fazer sozinho</button></section>';
    }
    h += '</div><section class="tr-cx"><h3 class="tr-mb">Ao terminar, abre</h3><div class="tr-abre">' + ABRE[3].map(function (x) { return '<span>' + ic(x[0], 'p') + esc(x[1]) + '</span>'; }).join('') + '</div></section>';
    h += seloHTML(false);
    if (feito(3)) h += '<a class="tr-bt az lg tr-seg" href="#trilha/termo">Ler o Termo de Parceria</a>';
    return h + '</div>';
  }

  /* Academia: as aulas vêm do GET /trilha/academia, sem gabarito. */
  var GRUPOS = [['grafico', 'Mercado'], ['chave', 'Técnica'], ['aperto', 'Venda'], ['cifrao', 'Financiamento']];
  function acadProgresso() {
    var a = st.acad || {}, p = a.progresso || a.academia || prep().academia || {};
    return { feitas: num(p.feitas), meta: num(p.meta, 12) || 12, aulas: p.aulas || {} };
  }
  function carregarAcad() {
    if (st.acadProm) return st.acadProm;
    st.acadErro = false;
    st.acadProm = (st.demo ? Promise.resolve({ ok: true, data: demoAcademia() }) : C.api('GET', '/trilha/academia')).then(function (r) {
      st.acadProm = null;
      if (r.ok && r.data && Array.isArray(r.data.aulas)) st.acad = r.data; else st.acadErro = true;
      if (C.S.rota === 'trilha' && /^academia/.test(C.S.sub)) C.repintar(true);
    });
    return st.acadProm;
  }
  function grupoDe(a, i) {
    var g = String(a.modulo || a.grupo || a.trilha || '').toLowerCase();
    for (var k = 0; k < GRUPOS.length; k++) if (g && GRUPOS[k][1].toLowerCase().indexOf(g.slice(0, 4)) === 0) return k;
    return Math.min(3, Math.floor(i / 3));
  }
  function telaAcademia(sub) {
    if (!feito(2)) return trancada(3, 'Academia');
    var id = sub.split('/')[1] || '';
    if (!st.acad) {
      if (!st.acadErro) carregarAcad();
      return '<div class="tr-pag">' + cab('Academia NEXUS', 'trilha/preparo') + (st.acadErro ? '<section class="tr-cx"><p>Não foi possível carregar as aulas.</p><button type="button" class="tr-bt sec" data-tr="acadDeNovo">Tentar de novo</button></section>' : C.girando('Carregando as aulas…')) + '</div>';
    }
    var aulas = st.acad.aulas, pg = acadProgresso();
    if (id) {
      var idx = -1;
      aulas.forEach(function (a, i) { if (String(a.id) === id) idx = i; });
      if (idx >= 0) return telaAula(aulas[idx], idx, aulas, pg);
    }
    var h = '<div class="tr-pag">' + cab('Academia NEXUS', 'trilha/preparo', '<span class="tr-est az num">' + pg.feitas + ' de ' + pg.meta + '</span>');
    if (prep().formato !== 'academia') h += '<p class="tr-aviso">' + ic('info', 'p') + 'Você está na mentoria. As aulas são para consulta e não contam para o Nível 3. <button type="button" class="tr-bt p sec" data-tr="prepFormato" data-v="academia">Trocar para a Academia</button></p>';
    h += '<div class="tr-grupos">';
    GRUPOS.forEach(function (g, k) {
      var doGrupo = [];
      aulas.forEach(function (a, i) { if (grupoDe(a, i) === k) doGrupo.push({ a: a, i: i }); });
      if (!doGrupo.length) return;
      var certas = doGrupo.filter(function (x) { var s = pg.aulas[x.a.id]; return s && s.certa; }).length;
      h += '<section class="tr-cx tr-grupo" aria-labelledby="tr-g' + k + '"><div class="tr-cab-l"><h3 id="tr-g' + k + '">' + ic(g[0], 'p') + g[1] + '</h3><span class="tr-sub num">' + certas + ' de ' + doGrupo.length + '</span></div>' +
        '<div class="tr-mini" aria-hidden="true"><i style="width:' + Math.round(100 * certas / doGrupo.length) + '%"></i></div><ol class="tr-aulas">' + doGrupo.map(function (x) {
          var s = pg.aulas[x.a.id] || {}, cls = s.certa ? 'ok' : s.em ? 'rf' : '';
          return '<li><a class="' + cls + '" href="#trilha/academia/' + esc(x.a.id) + '"><span class="b">' + (s.certa ? ic('check', 'p') : x.i + 1) + '</span><span class="nm">' + esc(x.a.titulo) + '</span>' +
            (s.certa ? '<span class="tr-sub">Feita</span>' : s.em ? '<span class="tr-est av">Refazer</span>' : ic('seta', 'p')) + '</a></li>';
        }).join('') + '</ol></section>';
    });
    return h + '</div></div>';
  }
  /* Errou: a api devolve aguarde_s e grava libera_em na aula; antes disso a checagem fica fechada (409 aguarde). */
  function liberaEm(id) {
    var t = 0, r = st.acadRes[id], l = [];
    if (r && r.libera) l.push(r.libera);
    var a1 = st.acad && st.acad.progresso && st.acad.progresso.aulas && st.acad.progresso.aulas[id];
    var a2 = prep().academia && prep().academia.aulas && prep().academia.aulas[id];
    [a1, a2].forEach(function (x) { if (x && x.libera_em && !x.certa) l.push(new Date(x.libera_em).getTime()); });
    l.forEach(function (v) { if (isFinite(v) && v > t) t = v; });
    return t > Date.now() ? t : 0;
  }
  function mmss(ms) { var sgs = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(sgs / 60) + ':' + (sgs % 60 < 10 ? '0' : '') + (sgs % 60); }
  var relogio = 0;
  function contarAula() {
    clearInterval(relogio);
    if (!$('[data-conta]')) return;
    relogio = setInterval(function () {
      var el = $('[data-conta]');
      if (!el) { clearInterval(relogio); return; }
      var falta = num(el.getAttribute('data-conta')) - Date.now();
      if (falta <= 0) { clearInterval(relogio); C.repintar(true); return; }
      el.textContent = mmss(falta);
    }, 1000);
  }
  function telaAula(a, idx, aulas, pg) {
    var s = pg.aulas[a.id] || {}, res = st.acadRes[a.id], espera = (s.certa || (res && res.certa)) ? 0 : liberaEm(a.id);
    var pontos = Array.isArray(a.pontos) ? a.pontos : (a.pontos ? [a.pontos] : []);
    var video = urlSegura(a.video_url || a.url || a.video || '');
    var prox = aulas[idx + 1];
    var h = '<div class="tr-pag tr-qz-pag"><div class="tr-qz tr-aula">' +
      '<div class="tr-qz-top"><a class="tr-icb" href="#trilha/academia" aria-label="Voltar para as aulas">' + ic('voltar') + '</a><span class="tr-qz-bl">' + esc(GRUPOS[grupoDe(a, idx)][1]) + '</span><span class="num">Aula ' + (idx + 1) + ' de ' + aulas.length + '</span></div>' +
      '<h2 class="tr-qz-h" id="tr-q-t" tabindex="-1">' + esc(a.titulo) + '</h2>' + (a.resumo ? '<p class="tr-resumo">' + esc(a.resumo) + '</p>' : '') +
      (pontos.length ? '<ul class="tr-pts">' + pontos.map(function (p) { return '<li>' + ic('check', 'p') + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
      (video ? '<a class="tr-bt sec" href="' + esc(video) + '" target="_blank" rel="noopener">' + ic('play', 'p') + 'Ver o vídeo</a>' : '');
    var ops = Array.isArray(a.opcoes) ? a.opcoes : [];
    if (a.pergunta && ops.length) {
      h += '<div class="tr-check"><span class="tr-rot">Checagem</span><h3 id="tr-ck-t">' + esc(a.pergunta) + '</h3><div class="tr-ops" role="radiogroup" aria-labelledby="tr-ck-t">' + ops.map(function (o, k) {
        var marcado = res && res.resp === k, cls = marcado ? (res.certa ? ' certa' : ' errada') : '';
        return '<button type="button" class="tr-op' + cls + '" role="radio" aria-checked="' + !!marcado + '" data-tr="acadResp" data-c="' + esc(a.id) + '" data-v="' + k + '"' + ((res && res.certa) || espera ? ' disabled' : '') + '><span class="mk">' + (marcado ? ic(res.certa ? 'check' : 'x') : '') + '</span>' + esc(o) + '</button>';
      }).join('') + '</div>';
      if (res && res.certa) h += '<p class="tr-res ok" role="status">Certa. Aula feita.</p>';
      else if (s.certa) h += '<p class="tr-res ok">' + ic('check', 'p') + 'Você já acertou esta.</p>';
      else if (espera) h += '<p class="tr-res er" role="status">' + ic('relogio', 'p') + 'Releia e tente de novo em <span class="num" data-conta="' + espera + '">' + mmss(espera - Date.now()) + '</span></p>';
      else if (res) h += '<p class="tr-res er" role="status">Releia e tente de novo.</p>';
      h += '</div>';
    }
    if ((res && res.certa) || s.certa) h += prox ? '<a class="tr-bt az lg tr-cont" href="#trilha/academia/' + esc(prox.id) + '">Próxima aula</a>' : '<a class="tr-bt az lg tr-cont" href="#trilha">Voltar para a trilha</a>';
    return h + '</div></div>';
  }

  /* ------------------------------------------------------------------ termo (usa o aceite que já existe no portal) */
  function telaTermo() {
    if (!feito(3)) return trancada(4, 'Termo de Parceria');
    var h = '<div class="tr-pag">' + conquistaHTML() + cab('Termo de Parceria');
    if (termoAceito()) h += '<div class="tr-conq">' + ic('check') + '<b>Termo aceito.</b><span>Próximo: reunião com o seu cliente.</span><a class="tr-bt br" href="#trilha/reuniao">Marcar</a></div>';
    return h + '<div class="tr-termo">' + C.termo.html() + '</div></div>';
  }

  /* ------------------------------------------------------------------ Nível 4: reunião com o cliente */
  function clientesReuniao() {
    var l = [], vistos = {};
    carteira().forEach(function (c) { var k = c.cliente_id || c.nome; vistos[k] = 1; l.push({ id: c.cliente_id || '', nome: c.nome, cidade: c.cidade, uf: c.uf, tipo: c.tipo_local, fase: c.fase }); });
    (prefill().clientes_pj || []).forEach(function (c) { if (!vistos[c.id]) { var cu = cidUf(c.cidade, c.uf); l.push({ id: c.id, nome: c.nome, cidade: cu.cidade, uf: cu.uf }); } });
    return l;
  }
  function carregarProps() {
    if (st.props || st.propsProm) return;
    st.propsErro = false;
    st.propsProm = (st.demo ? Promise.resolve(demoProps()) : C.listarPropostas()).then(function (l) { st.props = l || []; }, function () { st.propsErro = true; }).then(function () {
      st.propsProm = null;
      var r = C.S.rota;
      if (r === 'inicio' || (r === 'trilha' && C.S.sub === 'reuniao')) C.repintar(true);
    });
  }
  function telaReuniao() {
    if (!feito(3)) return trancada(4, 'Reunião com o cliente');
    var ru = reun(), h = '<div class="tr-pag">' + conquistaHTML() + cab('Nível 4: Em campo');
    if (!termoAceito()) {
      return h + '<section class="tr-cx tr-lk"><span class="tr-ib">' + ic('caneta') + '</span><div><h3>Aceite o Termo de Parceria primeiro</h3><p class="tr-sub">A reunião abre depois do aceite.</p></div><a class="tr-bt az" href="#trilha/termo">Ler o termo</a></section></div>';
    }
    if (ru.pedida_em) {
      var d = ru.dados || {}, emp = empresa();
      return h + '<section class="tr-cx tr-reu-st"><div class="tr-trio" aria-hidden="true"><span class="nx">NX</span><span class="vc">' + esc(iniciais(emp)) + '</span><span class="cl">' + esc(iniciais(d.cliente_nome)) + '</span></div>' +
        '<div><b>' + (ru.agendada_para ? esc(dmh(ru.agendada_para)) : 'Pedida em ' + esc(dm(ru.pedida_em))) + '</b><span class="tr-sub">NEXUS, ' + esc(curto(emp)) + ' e ' + esc(d.cliente_nome || 'seu cliente') + '</span></div>' +
        (ru.feita_em ? '<span class="tr-est ok">Feita em ' + esc(dm(ru.feita_em)) + '</span>' : '<span class="tr-est av">' + (ru.agendada_para ? 'Aguardando a reunião' : 'Aguardando o horário') + '</span>') +
        aj('Passa quando a equipe marca a reunião como feita. Aí abre o pedido de carregador.') + '</section>' +
        (ru.feita_em ? '<a class="tr-bt az lg tr-seg" href="#equipamentos">Fazer o pedido</a>' : '') + '</div>';
    }
    carregarProps();
    var cls = clientesReuniao(), R = st.reu;
    if (!R.cliente && cls[0]) R.cliente = cls[0].id || cls[0].nome;
    var cli = null;
    cls.forEach(function (c) { if ((c.id || c.nome) === R.cliente) cli = c; });
    h += '<div class="tr-passos3">';
    h += '<section class="tr-cx tr-ph" aria-labelledby="tr-r1"><div class="nn"><span>1</span><h3 id="tr-r1">Cliente</h3></div>';
    if (!cls.length) h += '<p class="tr-sub">Nenhum cliente na carteira.</p><a class="tr-lnk" href="/clientes" target="_top">Cadastrar na SolarDoc</a>';
    else {
      if (cls.length > 6) h += '<label class="tr-busca">' + ic('busca', 'p') + '<span class="nx-sr">Buscar na carteira</span><input type="search" data-tr-in="busca" placeholder="Buscar na carteira…" name="busca" autocomplete="off" value="' + esc(st.busca) + '"></label>';
      var b = st.busca.toLowerCase();
      h += '<div class="tr-radios" role="radiogroup" aria-labelledby="tr-r1">' + cls.filter(function (c) { return !b || c.nome.toLowerCase().indexOf(b) >= 0 || (c.id || c.nome) === R.cliente; }).slice(0, 8).map(function (c) {
        var k = c.id || c.nome, on = k === R.cliente;
        return '<button type="button" class="tr-rad' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-tr="reuCli" data-v="' + esc(k) + '">' + ic('predio', 'p') + '<span><b>' + esc(c.nome) + '</b><small>' + esc(cidUf(c.cidade, c.uf).txt) + '</small></span></button>';
      }).join('') + '</div><span class="tr-veio">Veio da SolarDoc</span>';
      if (cli && !cli.tipo) {
        h += '<div class="nx-campo"><label for="tr-reu-tipo">Tipo do lugar</label><select id="tr-reu-tipo" data-tr-in="reuTipo"><option value="">Escolha</option>' + TIPOS.map(function (t) { return '<option value="' + t[0] + '"' + (R.tipo === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div>';
      }
    }
    h += '</section><section class="tr-cx tr-ph" aria-labelledby="tr-r2"><div class="nn"><span>2</span><h3 id="tr-r2">Proposta anexada</h3></div>';
    if (!st.props) h += st.propsErro ? '<p class="tr-sub">Não foi possível carregar as propostas.</p>' : C.girando('Carregando…');
    else {
      var nomeCli = cli ? cli.nome.toLowerCase() : '';
      var ps = st.props.slice().sort(function (x, y) { return (String(y.cliente_nome || '').toLowerCase() === nomeCli) - (String(x.cliente_nome || '').toLowerCase() === nomeCli); });
      if (!ps.length) h += '<p class="tr-sub">Nenhuma proposta ainda.</p><a class="tr-bt sec" href="#propostas">Gerar a proposta</a>';
      else {
        if (!R.proposta || !ps.some(function (p) { return String(p.id) === R.proposta; })) R.proposta = String(ps[0].id);
        h += '<div class="tr-radios" role="radiogroup" aria-labelledby="tr-r2">' + ps.slice(0, 4).map(function (p) {
          var on = String(p.id) === R.proposta;
          return '<button type="button" class="tr-rad' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-tr="reuProp" data-v="' + esc(p.id) + '">' + ic('doc', 'p') + '<span><b>' + esc(p.cliente_nome || 'Proposta ' + (p.numero || '')) + '</b><small>' + esc([String(p.modelo || '').replace(/^NEXUS\s+/i, ''), p.valor_total ? rs(p.valor_total) : ''].filter(Boolean).join(' · ')) + '</small></span></button>';
        }).join('') + '</div>';
      }
    }
    h += '</section><section class="tr-cx tr-ph" aria-labelledby="tr-r3"><div class="nn"><span>3</span><h3 id="tr-r3">Horário</h3></div>' + escolhaDias(R, 'reuDia', 'reuPer', 'Até 3 dias') + '</section></div>';
    h += '<div class="tr-reu-pe"><span class="tr-sub">' + ic('aperto', 'p') + 'NEXUS, ' + esc(curto(empresa())) + ' e ' + esc(cli ? cli.nome : 'seu cliente') + '</span>' +
      '<button type="button" class="tr-bt az lg" data-tr="reuPedir">Pedir a reunião</button></div>';
    return h + '</div>';
  }

  /* ------------------------------------------------------------------ patamares 5 e 6 (trancados, com o prêmio) */
  function telaPatamar(n) {
    n = Math.min(6, Math.max(1, Math.round(num(n, 5))));
    if (n <= 4) { C.irPara(PAT[n].rota); return ''; }
    var P = PAT[n], ok = feito(n), lk = !ok && n > pat();
    return '<div class="tr-pag">' + cab('Nível ' + n + ': ' + P.nome) +
      '<section class="tr-cx tr-pat"><span class="tr-ib ' + (ok ? 'ok' : lk ? 'lk' : '') + '">' + ic(ok ? 'check' : lk ? 'cadeado' : P.ic) + '</span><div class="tr-pat-g">' +
      '<div><span class="tr-rot">Passa com</span><p>' + esc(P.passa) + '</p></div>' +
      '<div><span class="tr-rot">Abre</span><ul class="tr-libs">' + (ABRE[n] || []).map(function (x) { return '<li>' + ic(x[0], 'p') + esc(x[1]) + '</li>'; }).join('') + '</ul></div></div>' +
      (ok ? '<span class="tr-est ok">Feito em ' + esc(dm(etapa(n).em)) + '</span>' : lk ? '<span class="tr-est cz">' + ic('cadeado', 'p') + 'Trancado</span>' : '<span class="tr-est az">Agora</span>') + '</section>' +
      (n === 5 && pat() === 5 ? '<a class="tr-bt az lg tr-seg" href="#equipamentos">Fazer o pedido</a>' : '') + '</div>';
  }

  /* ------------------------------------------------------------------ mesa limpa (Nível 4 feito): passo, propostas, loja */
  function statusProp(p) {
    if (num(p.aberturas) > 0) return ['av', 'Cliente abriu'];
    if (p.link_token) return ['az', 'Enviada'];
    return ['cz', 'Gerada'];
  }
  function telaMesa() {
    carregarProps();
    var h = '<div class="tr-pag">' + passoHTML() + '<div class="tr-mesa">';
    h += '<section class="tr-cx" aria-labelledby="tr-ps-t"><div class="tr-cab-l"><h3 id="tr-ps-t">Suas propostas</h3><a class="tr-bt p sec" href="#propostas">' + ic('mais', 'p') + 'Gerar</a></div>';
    if (!st.props) h += st.propsErro ? '<p class="tr-sub">Não foi possível carregar.</p>' : C.girando('Carregando as propostas…');
    else if (!st.props.length) h += '<p class="tr-sub">Nenhuma proposta ainda.</p>';
    else {
      h += '<ul class="tr-props">' + st.props.slice(0, 6).map(function (p) {
        var s = statusProp(p);
        return '<li><span class="nm"><b>' + esc(p.cliente_nome || 'Cliente') + '</b><small>' + esc([cidUf(p.cliente_cidade, p.cliente_uf).txt, String(p.modelo || '').replace(/^NEXUS\s+/i, '')].filter(Boolean).join(' · ')) + '</small></span>' +
          '<span class="v num">' + (p.valor_total ? rs(p.valor_total) : '') + '</span><span class="tr-est ' + s[0] + '">' + s[1] + '</span></li>';
      }).join('') + '</ul>' + (st.props.length > 6 ? '<a class="tr-lnk" href="#propostas/lista">Ver as ' + st.props.length + '</a>' : '');
    }
    h += '</section><section class="tr-cx tr-loja" aria-labelledby="tr-lj-t"><h3 id="tr-lj-t">Loja</h3>' +
      '<a class="it" href="#equipamentos"><span class="tr-ib">' + ic('raio') + '</span><span><b>Carregadores</b><small>DC 80 e DC 120</small></span>' + ic('seta', 'p') + '</a>' +
      '<a class="it" href="#servicos"><span class="tr-ib">' + ic('regua') + '</span><span><b>Engenharia</b><small>Projeto e ART</small></span>' + ic('seta', 'p') + '</a>' +
      (feito(6) ? '<a class="it" href="#oportunidades"><span class="tr-ib">' + ic('pino') + '</span><span><b>Obras da sua região</b><small>Parceiro regional</small></span>' + ic('seta', 'p') + '</a>'
        : '<div class="it lk"><span class="tr-ib">' + ic('cadeado') + '</span><span><b>Obras da sua região</b><small>Abre no Parceiro regional</small></span>' + aj('Último prêmio. A equipe NEXUS promove a Parceiro regional.') + '</div>') +
      '</section></div>' + seloHTML(true) +
      '<a class="tr-cx tr-hist-l" href="#historico">' + ic('historico') + '<span><b>Histórico</b> · ' + esc(resumoTrilha()) + '</span>' + ic('seta', 'p') + '</a></div>';
    return h;
  }
  function resumoTrilha() {
    var ini = etapa(1).em || (rx().enviado_em), feitos = 0, ult = '';
    for (var n = 1; n <= 6; n++) if (feito(n)) { feitos++; ult = etapa(n).em; }
    if (!ini) return 'Sua trilha começa no Raio-X';
    return 'Na trilha desde ' + dm(ini) + ', ' + feitos + (feitos === 1 ? ' nível' : ' níveis') + (ult ? ' em ' + Math.max(1, diasEntre(ini, ult)) + ' dias' : '');
  }

  /* ------------------------------------------------------------------ histórico */
  var AUTOR = { voce: 'Você', NEXUS: 'NEXUS', sistema: '' };
  function telaHistorico() {
    var lista = Array.isArray(E.historico) ? E.historico.slice() : [];
    if (!lista.length) {
      for (var n = 1; n <= 6; n++) if (feito(n)) lista.push({ titulo: 'Nível ' + n + ': ' + PAT[n].nome, em: etapa(n).em, autor: 'sistema' });
    }
    lista.sort(function (a, b) { return new Date(b.em).getTime() - new Date(a.em).getTime(); });
    var h = '<div class="tr-pag">' + cab('Histórico', 'inicio', '<span class="tr-sub">' + esc(resumoTrilha()) + '</span>');
    h += '<section class="tr-cx" aria-labelledby="tr-hp-t"><h3 id="tr-hp-t" class="tr-mb">Níveis</h3><ol class="tr-pats">';
    for (var k = 1; k <= 6; k++) {
      var ok = feito(k), at = !ok && k === pat();
      h += '<li class="' + (ok ? 'feita' : at ? 'at' : 'lk') + '"><span class="b">' + (ok ? ic('check', 'p') : at ? k : ic('cadeado', 'p')) + '</span><b>' + esc(PAT[k].nome) + '</b><span class="tr-sub">' + (ok ? esc(dm(etapa(k).em)) : at ? 'Agora' : '') + '</span></li>';
    }
    h += '</ol></section>' + seloHTML(true) + '<div class="tr-hist-g"><section class="tr-cx" aria-labelledby="tr-hl-t"><h3 id="tr-hl-t" class="tr-mb">Cada passo</h3>';
    if (!lista.length) h += '<p class="tr-sub">Nada ainda. O primeiro passo é o Raio-X.</p>';
    else {
      h += '<ol class="tr-linha">' + lista.map(function (x) {
        var a = AUTOR[x.autor] != null ? AUTOR[x.autor] : 'NEXUS';
        return '<li><span class="dt num">' + esc(dm(x.em)) + '</span><span class="tx"><b>' + esc(maiusc(x.titulo || x.tipo || '')) + '</b>' + (a ? '<span class="tr-autor' + (a === 'NEXUS' ? ' nx' : '') + '">' + esc(a) + '</span>' : '') + '</span></li>';
      }).join('') + '</ol>';
    }
    var r = rx();
    h += '</section><section class="tr-cx" aria-labelledby="tr-hr-t"><div class="tr-cab-l"><h3 id="tr-hr-t">Suas respostas</h3>' + (r.nota != null ? '<span class="tr-est ' + (num(r.nota) >= 80 ? 'ok' : 'av') + ' num">Nota ' + num(r.nota) + '</span>' : '') + '</div>' +
      raioXResumoHTML(st.rx.resp) + (feito(1) ? '' : '<a class="tr-bt sec" href="#trilha/raiox">Continuar o Raio-X</a>') + '</section></div></div>';
    return h;
  }

  /* ------------------------------------------------------------------ casca: tela, barra do modo embutido e rótulos */
  function tela(r, sub) {
    sub = String(sub || '');
    if (r === 'historico') return telaHistorico();
    if (r === 'inicio') return concluida() ? telaMesa() : telaTrilha();
    var s0 = sub.split('/')[0];
    if (s0 === 'raiox') return telaRaioX();
    if (s0 === 'nota') return telaNota();
    if (s0 === 'diagnostico') return telaDiag();
    if (s0 === 'preparo') return telaPreparo();
    if (s0 === 'academia') return telaAcademia(sub);
    if (s0 === 'termo') return telaTermo();
    if (s0 === 'reuniao') return telaReuniao();
    if (s0 === 'patamar') return telaPatamar(sub.split('/')[1]);
    return concluida() ? telaMesa() : telaTrilha();
  }
  function pos(r, sub) {
    sub = String(sub || '');
    if (C.selo && $('#nx-selo')) C.selo.desenhar();   /* o canvas do selo só existe depois da pintura */
    if (r === 'trilha' && sub === 'termo' && feito(3)) {
      C.termo.carregar();
      /* Aceitou agora (o /eu já sabe, a trilha ainda não): busca a trilha uma vez para o Nível 4 andar. */
      if (termoAceito() && !(E.termo && E.termo.aceito) && !st.demo && !st.termoBusca) { st.termoBusca = true; recarregar(); }
    }
    if (r === 'trilha' && /^academia\//.test(sub)) contarAula();
    if (r === 'trilha' && sub === 'raiox') {
      var h = $('#tr-q-t'); if (h && st.rx.focar) { st.rx.focar = false; try { h.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
    }
  }
  function abas() {
    var lig = ligada(), conc = concluida();
    return [
      { h: 'inicio', rot: lig && !conc ? 'Trilha' : 'Início', ic: lig && !conc ? 'escada' : 'inicio', at: ['inicio', 'trilha'] },
      { h: 'propostas/lista', rot: 'Propostas', ic: 'propostas', at: ['propostas'] },
      { h: 'equipamentos', rot: 'Loja', ic: 'loja', at: ['equipamentos', 'servicos', 'oportunidades'] },
      lig ? { h: 'historico', rot: 'Histórico', ic: 'historico', at: ['historico'] } : { h: 'parceria', rot: 'Parceria', ic: 'selo', at: ['parceria'] },
      { h: 'perfil', rot: 'Perfil', ic: 'perfil', at: ['perfil', 'instalar', 'materiais'] }
    ];
  }
  var TITULOS = { raiox: 'Nível 1: Mapeado', nota: 'Seu Raio-X', diagnostico: 'Nível 2: Diagnosticado', preparo: 'Nível 3: Preparado', academia: 'Academia NEXUS', termo: 'Termo de Parceria', reuniao: 'Nível 4: Em campo' };
  function barra(rota, sub) {
    var lig = ligada(), t = 'Parceiro NEXUS';
    if (rota === 'trilha' && TITULOS[String(sub || '').split('/')[0]]) t = TITULOS[String(sub).split('/')[0]];
    var dir = lig ? '<span class="tr-eb-dir">' + fmHTML() + '<span class="tr-eb-txt"><b>' + esc(rotulo().replace(' de 6', '')) + '</b><span>, ' + esc(PAT[Math.min(6, pat())].nome) + '</span></span></span>' : '';
    return '<div class="tr-eb-cab"><img src="/gerador/nexus-logo-tela.png" alt="NEXUS Eletropostos" width="116" height="28"><span class="sep" aria-hidden="true"></span><span class="tit">' + esc(t) + '</span>' + dir + '</div>' +
      '<nav class="tr-eb-abas" aria-label="Seções do Parceiro NEXUS">' + abas().map(function (a) {
        var on = a.at.indexOf(rota) >= 0;
        return '<a href="#' + a.h + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + ic(a.ic) + '<span>' + esc(a.rot) + '</span></a>';
      }).join('') + '</nav>';
  }
  /* Menu da casca sem o modo embutido: "Minha parceria" (níveis antigos) dá lugar ao Histórico. */
  function menu(lista) { return lista.map(function (r) { return r === 'parceria' ? 'historico' : r; }); }
  function cartaoInicioCurto() { return passoHTML(); }

  /* ------------------------------------------------------------------ eventos */
  function achaCli(chave) {
    var l = carteira();
    for (var i = 0; i < l.length; i++) {
      if (chave.indexOf('id:') === 0 ? l[i].cliente_id === chave.slice(3) : (!l[i].cliente_id && l[i].nome === chave.slice(3))) return i;
    }
    return -1;
  }
  function salvarCarteira(l) { salvarRx('clientes_em_vista', l.slice(0, 10)); }
  function alternarDia(estado, iso) {
    var i = estado.dias.indexOf(iso);
    if (i >= 0) estado.dias.splice(i, 1);
    else if (estado.dias.length >= 3) { C.toast('Escolha até 3 dias.'); return false; }
    else estado.dias.push(iso);
    return true;
  }
  var ACOES = {
    rxConfirma: function () { irPergunta(1); },
    rxVoltar: function () { irPergunta(st.rx.i - 1); },
    rxIr: function (el) { st.rx.i = num(el.dataset.v); if (C.S.sub === 'raiox') irPergunta(st.rx.i); else C.irPara('trilha/raiox'); },
    rxResp: function (el) {
      var q = Q[st.rx.i], v = el.dataset.v;
      if (q.ops && typeof q.ops[0][0] === 'number') v = num(v);
      $$('.tr-op', el.parentNode).forEach(function (b) { b.classList.toggle('sel', b === el); b.setAttribute('aria-checked', String(b === el)); });
      el.querySelector('.mk').innerHTML = ic('check');
      salvarRx(q.k, v);
      setTimeout(function () { irPergunta(st.rx.i + 1); }, 160);
    },
    rxMarca: function (el) {
      var q = Q[st.rx.i], l = Array.isArray(st.rx.resp[q.k]) ? st.rx.resp[q.k].slice() : [], v = el.dataset.v, i = l.indexOf(v);
      if (i >= 0) l.splice(i, 1);
      else if (q.max && l.length >= q.max) { C.toast('Escolha até ' + q.max + '.'); return; }
      else l.push(v);
      salvarRx(q.k, l);
      C.repintar(true);
    },
    rxSegue: function () {
      var q = Q[st.rx.i];
      if (q.multi && !(Array.isArray(st.rx.resp[q.k]) && st.rx.resp[q.k].length)) { C.toast('Marque pelo menos 1.'); return; }
      if (q.tipo === 'carteira') {
        var falta = carteira().filter(function (c) { return !c.tipo_local || !c.fase; });
        if (falta.length) { C.toast('Diga o tipo do lugar e o estágio de ' + falta[0].nome + '.'); var s0 = $('.tr-cli.on select'); if (s0) s0.focus(); return; }
        var semLocal = carteira().filter(function (c) { return !c.cidade || !c.uf; });
        if (semLocal.length) { C.toast('Falta a cidade e a UF de ' + semLocal[0].nome + (semLocal[0].cliente_id ? ' no cadastro do cliente.' : '.'), true); return; }
      }
      irPergunta(st.rx.i + 1);
    },
    rxEnviar: function (el) { enviarRx(el); },
    cliFase: function (el) {
      var l = carteira().slice(), i = achaCli(el.dataset.c);
      if (i < 0) return;
      l[i] = Object.assign({}, l[i], { fase: el.dataset.v });
      salvarCarteira(l); C.repintar(true);
    },
    cliAdd: function () {
      var n = ($('#tr-add-nome') || {}).value || '', c = ($('#tr-add-cid') || {}).value || '', u = String(($('#tr-add-uf') || {}).value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
      n = n.trim(); c = c.trim();
      if (!n) { C.toast('Escreva o nome do cliente.', true); var f = $('#tr-add-nome'); if (f) f.focus(); return; }
      if (!c) { C.toast('Escreva a cidade do cliente.', true); var fc = $('#tr-add-cid'); if (fc) fc.focus(); return; }
      if (u.length !== 2) { C.toast('Escreva a UF do cliente, com 2 letras.', true); var fu = $('#tr-add-uf'); if (fu) fu.focus(); return; }
      if (noVista('', n) >= 0) { C.toast('Este cliente já está na lista.'); return; }
      var l = carteira().concat([{ nome: n.slice(0, 120), cidade: c.slice(0, 80), uf: u, tipo_local: '', fase: '' }]);
      salvarCarteira(l); C.repintar(true);
    },
    dgPer: function (el) {
      st.diag.periodo = el.dataset.v;
      if (st.diag.erro && st.diag.erro.campo === 'periodo') st.diag.erro = null;
      $$('.tr-per .tr-pill').forEach(function (b) { var on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      var e3 = $('#tr-dg-periodo-e'); if (e3) e3.remove();
    },
    prepFormato: function (el) {
      postar('/trilha/preparo', { formato: el.dataset.v }, el, function () {
        C.toast(el.dataset.v === 'mentoria' ? 'Mentoria escolhida. A equipe combina com você.' : 'Academia escolhida. Bons estudos.');
        if (el.dataset.v === 'academia') { st.acad = null; C.irPara('trilha/academia'); } else C.repintarTudo();
      });
    },
    acadDeNovo: function () { st.acadErro = false; carregarAcad(); C.repintar(true); },
    acadResp: function (el) {
      var id = el.dataset.c, k = num(el.dataset.v);
      $$('.tr-op', el.parentNode).forEach(function (b) { b.disabled = true; });
      var p = st.demo ? Promise.resolve(demoPost('/trilha/academia/' + id, { resposta: k })) : C.api('POST', '/trilha/academia/' + encodeURIComponent(id), { resposta: k });
      p.then(function (r) {
        var d = r.data || {};
        if (r.status === 409 && (d.erro === 'aguarde' || d.error === 'aguarde')) {
          st.acadRes[id] = { resp: k, certa: false, libera: Date.now() + num(d.segundos, 60) * 1000 };
          C.repintar(true); return;
        }
        if (!r.ok) { C.toast('Não foi possível conferir. Tente de novo.', true); C.repintar(true); return; }
        var t = trilhaDe(d);
        if (t) aplicar(t);
        st.acadRes[id] = { resp: k, certa: !!d.certa, libera: d.certa ? 0 : Date.now() + num(d.aguarde_s, 0) * 1000 };
        if (st.acad && d.certa) {
          var pg = st.acad.progresso || (st.acad.progresso = { feitas: 0, meta: 12, aulas: {} });
          pg.aulas = pg.aulas || {};
          if (!(pg.aulas[id] && pg.aulas[id].certa)) pg.feitas = num(pg.feitas) + 1;
          pg.aulas[id] = { em: new Date().toISOString(), certa: true };
        } else if (st.acad) {
          var pe = st.acad.progresso || (st.acad.progresso = { feitas: 0, meta: 12, aulas: {} });
          pe.aulas = pe.aulas || {};
          if (!(pe.aulas[id] && pe.aulas[id].certa)) pe.aulas[id] = { em: new Date().toISOString(), certa: false, libera_em: st.acadRes[id].libera ? new Date(st.acadRes[id].libera).toISOString() : null };
        }
        if (feito(3)) st.conq = { t: 'Nível 3 concluído.', s: 'Abriu: proposta com sua marca e o termo.', ir: 'trilha/termo', bt: 'Ler o termo' };
        C.repintarTudo();
      });
    },
    reuCli: function (el) { st.reu.cliente = el.dataset.v; st.reu.tipo = ''; C.repintar(true); },
    reuProp: function (el) { st.reu.proposta = el.dataset.v; C.repintar(true); },
    reuDia: function (el) { if (alternarDia(st.reu, el.dataset.v)) C.repintar(true); },
    reuPer: function (el) { st.reu.periodo = el.dataset.v; C.repintar(true); },
    reuPedir: function (el) {
      var R = st.reu, cli = null;
      clientesReuniao().forEach(function (c) { if ((c.id || c.nome) === R.cliente) cli = c; });
      if (!cli) { C.toast('Escolha o cliente.'); return; }
      if (!(cli.tipo || R.tipo)) { C.toast('Escolha o tipo do lugar.'); var tp = $('#tr-reu-tipo'); if (tp) tp.focus(); return; }
      if (!R.dias.length || !R.periodo) { C.toast(R.dias.length ? 'Escolha o período.' : 'Escolha pelo menos 1 dia.'); return; }
      var corpo = { cliente_nome: cli.nome, cidade: cli.cidade || '', uf: cli.uf || '', tipo_local: cli.tipo || R.tipo, preferencia: { dias: R.dias.slice().sort(), periodo: R.periodo } };
      if (cli.id) corpo.cliente_id = cli.id;
      if (R.proposta) corpo.proposta_id = R.proposta;
      postar('/trilha/reuniao', corpo, el, function () { C.toast('Pedido enviado. A equipe confirma o horário.'); C.repintarTudo(); });
    }
  };
  var ENTRADAS = {
    busca: function (el) { st.busca = el.value; var pos0 = el.selectionStart; C.repintar(true); var n = $('[data-tr-in="busca"]'); if (n) { n.focus(); try { n.setSelectionRange(pos0, pos0); } catch (e) { /* ok */ } } },
    dgNome: function (el) { st.diag.nome = el.value; if (st.diag.erro && st.diag.erro.campo === 'nome') { st.diag.erro = null; el.removeAttribute('aria-invalid'); var e1 = $('#tr-dg-nome-e'); if (e1) e1.remove(); } },
    dgWa: function (el) { st.diag.whatsapp = el.value; if (st.diag.erro && st.diag.erro.campo === 'whatsapp') { st.diag.erro = null; el.removeAttribute('aria-invalid'); var e2 = $('#tr-dg-whatsapp-e'); if (e2) e2.remove(); } },
    reuTipo: function (el) { st.reu.tipo = el.value; C.repintar(true); },
    simCli: function (el) {
      var x = st.rx.sim; x.cliente = el.value;
      carteira().forEach(function (c) { if (c.nome === el.value && c.tipo_local) x.tipo = c.tipo_local; });
      atualizarSim();
    },
    simTipo: function (el) { st.rx.sim.tipo = el.value; atualizarSim(); },
    simMod: function (el) { st.rx.sim.modelo = el.value; $$('.tr-mod-op').forEach(function (l) { l.classList.toggle('on', !!$('input:checked', l)); }); atualizarSim(); },
    simNum: function (el) { var v = num(String(el.value).replace(',', '.'), 0); if (v >= 0) { st.rx.sim[el.dataset.c] = v; atualizarSim(); } }
  };
  function atualizarSim() { var r = $('#tr-sim-res'); if (r && st.rx.sim) r.innerHTML = simResHTML(st.rx.sim); }
  function aoMudar(e) {
    var t = e.target;
    if (t.dataset && t.dataset.trCh === 'cli') {
      var chave = t.dataset.v, l = carteira().slice(), i = achaCli(chave);
      if (t.checked && i < 0) {
        if (l.length >= 10) { t.checked = false; C.toast('Até 10 clientes.'); return; }
        var c = null;
        (prefill().clientes_pj || []).forEach(function (x) { if ('id:' + x.id === chave) c = x; });
        if (c) { var cu = cidUf(c.cidade, c.uf); l.push({ cliente_id: c.id, nome: c.nome, cidade: cu.cidade, uf: cu.uf, tipo_local: '', fase: '' }); }
      } else if (!t.checked && i >= 0) l.splice(i, 1);
      salvarCarteira(l); C.repintar(true);
      var volta = $('[data-tr-ch="cli"][data-v="' + (window.CSS && CSS.escape ? CSS.escape(chave) : chave) + '"]'); if (volta) volta.focus();
      return;
    }
    if (t.dataset && t.dataset.trCh === 'tipo') {
      var l2 = carteira().slice(), j = achaCli(t.dataset.v);
      if (j >= 0) { l2[j] = Object.assign({}, l2[j], { tipo_local: t.value }); salvarCarteira(l2); C.repintar(true); }
      return;
    }
    if (t.dataset && t.dataset.trIn && ENTRADAS[t.dataset.trIn] && (t.tagName === 'SELECT' || t.type === 'radio')) ENTRADAS[t.dataset.trIn](t);
  }
  function aoDigitar(e) {
    var t = e.target;
    if (t.dataset && t.dataset.trIn && ENTRADAS[t.dataset.trIn] && t.tagName === 'INPUT' && t.type !== 'radio') ENTRADAS[t.dataset.trIn](t);
  }

  /* Balão do "(?)": passa o mouse, foca ou toca. Fecha com Esc, com toque fora e ao rolar. */
  var bal = null, fixo = null;
  function mostra(b) {
    if (!bal) return;
    bal.textContent = b.getAttribute('data-aj');
    bal.hidden = false;
    var r = b.getBoundingClientRect(), w = bal.offsetWidth, hh = bal.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var y = r.top - hh - 8; if (y < 8) y = r.bottom + 8;
    bal.style.left = x + 'px'; bal.style.top = y + 'px';
  }
  function esconde() { if (bal) bal.hidden = true; if (fixo) fixo.setAttribute('aria-expanded', 'false'); fixo = null; }
  function ligarBalao() {
    bal = document.createElement('div');
    bal.className = 'tr-balao'; bal.setAttribute('role', 'tooltip'); bal.hidden = true;
    document.body.appendChild(bal);
    document.addEventListener('mouseover', function (e) { var b = e.target.closest && e.target.closest('.tr-aj'); if (b && !fixo) mostra(b); });
    document.addEventListener('mouseout', function (e) { var b = e.target.closest && e.target.closest('.tr-aj'); if (b && !fixo) esconde(); });
    document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('tr-aj')) mostra(e.target); });
    document.addEventListener('focusout', function (e) { if (e.target.classList && e.target.classList.contains('tr-aj') && !fixo) esconde(); });
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.tr-aj');
      if (!b) { if (fixo) esconde(); return; }
      e.preventDefault(); e.stopPropagation();
      if (fixo === b) { esconde(); return; }
      esconde(); fixo = b; b.setAttribute('aria-expanded', 'true'); mostra(b);
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') esconde(); });
    window.addEventListener('scroll', function () { if (!bal.hidden) { if (fixo) mostra(fixo); else esconde(); } }, true);
    window.addEventListener('hashchange', esconde);
  }

  function ligar(ctx) {
    C = ctx;
    var root = document.getElementById('nx-root');
    if (root) {
      root.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-tr]') : null;
        if (!el || el.disabled || !ACOES[el.dataset.tr]) return;
        ACOES[el.dataset.tr](el, e);
      });
      root.addEventListener('change', aoMudar);
      root.addEventListener('input', aoDigitar);
      /* O formulário do contato (fim do Nível 1): Enter e o botão enviam pelo mesmo caminho, sem recarregar a página. */
      root.addEventListener('submit', function (e) {
        var f = e.target;
        if (!f || !f.getAttribute || f.getAttribute('data-tr-form') !== 'diag') return;
        e.preventDefault();
        var b = $('[type=submit]', f);
        if (b && !b.disabled) pedirDiagnostico(b);
      });
    }
    ligarBalao();
  }

  /* ------------------------------------------------------------------ demonstração (?demo=1, sem rede): Volt Sul, Uberlândia-MG */
  function demo(euD, busca) {
    st.demo = true; st.carregado = true;
    var mp = /[?&]patamar=([1-7])(&|$)/.exec(busca || ''), p = mp ? +mp[1] : 3;
    var D = 86400000, agora = Date.now();
    function dia(n, h) { var d = new Date(agora + n * D); d.setUTCHours((h || 13) + 3, 0, 0, 0); return d.toISOString(); }
    var pj = [['c1', 'Posto Cerrado Ltda.', 'Uberlândia-MG'], ['c2', 'Supermercado Bom Preço', 'Uberaba-MG'], ['c3', 'Hotel Serra Azul', 'Araguari-MG'], ['c4', 'Transportadora Triângulo', 'Ituiutaba-MG'],
      ['c5', 'Restaurante Sabor do Campo', 'Uberlândia-MG'], ['c6', 'Condomínio Parque Sul', 'Uberlândia-MG']].map(function (x) { return { id: x[0], nome: x[1], cidade: x[2] }; });
    var respostas = p >= 2 ? {
      anos_solar: '3-5', usinas: '100-500', equipe: '6-15', raio_km: 300, capacidades: ['eletrica_bt', 'engenharia_art', 'homologacao'],
      ja_montou_eletroposto: 'nunca', conhece_mercado: 'pouco', papel: 'ambos', quando: 'agora', dificuldades: ['preco', 'financiamento'],
      clientes_em_vista: [
        { cliente_id: 'c1', nome: 'Posto Cerrado Ltda.', cidade: 'Uberlândia', uf: 'MG', tipo_local: 'posto', fase: 'quente' },
        { cliente_id: 'c2', nome: 'Supermercado Bom Preço', cidade: 'Uberaba', uf: 'MG', tipo_local: 'outro', fase: 'conversando' },
        { cliente_id: 'c3', nome: 'Hotel Serra Azul', cidade: 'Araguari', uf: 'MG', tipo_local: 'hotel', fase: 'ideia' }],
      demanda_12m: 3,
      simulacao: { tipo_local: 'posto', modelo: 'nexus-dc-80', kwh_mes: 6000, preco_kwh: 2.35, resultado: { receita_mes: 14460, sobra_mes: 6290, retorno_meses: 12, recargas_dia: 10, kwh_recarga: 20, custo_kwh: 0.7, cliente_nome: 'Posto Cerrado Ltda.' } }
    } : {};
    var t1 = dia(-24), t2 = dia(-21), t3 = dia(-8), t4 = dia(-3), t5 = dia(-1);
    var et = { p1: { em: p >= 2 ? t1 : null }, p2: { em: p >= 3 ? t2 : null }, p3: { em: p >= 4 ? t3 : null }, p4: { em: p >= 5 ? t4 : null }, p5: { em: p >= 6 ? t5 : null }, p6: { em: p >= 7 ? dia(0) : null } };
    var enc = p === 3 ? 2 : p >= 4 ? 4 : 0;
    E = {
      ligada: true, patamar: p, assinante: true, etapas: et,
      raio_x: { respostas: respostas, nota: p >= 2 ? 86 : null, enviado_em: p >= 2 ? t1 : null, faltas: [] },
      diagnostico: p >= 3 ? { pedido_em: dia(-23), contato: { nome: 'Rafael Souza', whatsapp: '34991234567', periodo: 'manha' }, agendado_para: dia(-21, 10), link: '', feito_em: t2, resultado: 'aprovado', plano: '1º Posto Cerrado, 2º Bom Preço. DC 80 kW. Contrato chave na mão.' }
        : (p === 2 && /[?&]pedido=1(&|$)/.test(busca || '') ? { pedido_em: dia(0), contato: { nome: 'Rafael Souza', whatsapp: '34991234567', periodo: 'tarde' } } : {}),
      preparo: { formato: p >= 3 ? 'mentoria' : null, mentoria_paga_em: p >= 3 ? dia(-20) : null, encontros: enc, encontros_meta: 4, academia: { feitas: 0, meta: 12, aulas: {} } },
      termo: { aceito: p >= 4, versao: 'v1' },
      reuniao: p >= 4 && !/[?&]reuniao=0(&|$)/.test(busca || '') ? { pedida_em: t3, dados: { cliente_nome: 'Posto Cerrado', cidade: 'Uberlândia', uf: 'MG', tipo_local: 'posto' }, agendada_para: dia(p >= 5 ? -3 : 2, 10), feita_em: p >= 5 ? t4 : null } : {},
      prefill: { empresa: 'Volt Sul Energia Solar', cnpj: '12345678000190', cidade: 'Uberlândia', uf: 'MG', tem_logo: true, cor_marca: '#0E7C66', engenheiro_crea: true, clientes_pj: pj, propostas_solares: 214,
        contato_sugerido: { nome: 'Rafael Souza', whatsapp: '34991234567' } },
      historico: []
    };
    var H = [];
    if (p >= 2) H.push({ titulo: 'Raio-X enviado, nota 86', em: t1, autor: 'voce' }, { titulo: 'Nível 1: Mapeado', em: t1, autor: 'sistema' });
    if (p >= 3) H.push({ titulo: 'Contato deixado para o diagnóstico', em: dia(-23), autor: 'voce' }, { titulo: 'Diagnóstico feito: aprovado para seguir', em: t2, autor: 'NEXUS' }, { titulo: 'Nível 2: Diagnosticado', em: t2, autor: 'sistema' }, { titulo: 'Escolheu a mentoria', em: dia(-21), autor: 'voce' });
    for (var k = 1; k <= enc; k++) H.push({ titulo: 'Encontro ' + k + ' da mentoria: ' + ENCONTROS[k - 1].toLowerCase(), em: dia(-20 + k * 3), autor: 'NEXUS' });
    if (p >= 4) H.push({ titulo: 'Nível 3: Preparado', em: t3, autor: 'sistema' }, { titulo: 'Termo de Parceria aceito', em: t3, autor: 'voce' }, { titulo: 'Reunião com o Posto Cerrado pedida', em: t3, autor: 'voce' });
    if (p >= 5) H.push({ titulo: 'Reunião com o Posto Cerrado feita', em: t4, autor: 'NEXUS' }, { titulo: 'Nível 4: Em campo', em: t4, autor: 'sistema' });
    if (p >= 6) H.push({ titulo: 'Primeiro pedido confirmado', em: t5, autor: 'NEXUS' });
    E.historico = H;
    st.rx.resp = Object.assign({}, respostas);
    if (p >= 2) { st.rx.nota = 86; st.rx.faltas = []; }
    /* O /eu de mentira passa a ser o da Volt Sul, com a liberação do niveis.ts com a trilha ligada. */
    if (euD) {
      euD.empresa = Object.assign({}, euD.empresa, { nome: 'Volt Sul Energia Solar', nome_fantasia: 'Volt Sul Energia Solar', cidade: 'Uberlândia' });
      euD.parceiro = Object.assign({}, euD.parceiro, { empresa: 'Volt Sul Energia Solar', cidade: 'Uberlândia', uf: 'MG', raio_km: 300, carregadores_comprados: p >= 6 ? 1 : 0 });
      var p3 = p >= 4, p4 = p >= 5, L = euD.libera || {};
      ['basico', 'completo', 'materiais', 'negociar', 'engenharia', 'selo', 'termo'].forEach(function (k2) { L[k2] = p3; });
      L.conversa = p >= 2; L.pedido = p4; L.pacotes_engenharia = p4; L.consultoria = p4; L.plataforma = p >= 6; L.manutencao = p >= 6; L.oportunidades = p >= 7;
      euD.libera = L;
      var B = {};
      Object.keys(L).forEach(function (k3) { if (!L[k3]) B[k3] = /^(pedido|pacotes_engenharia|consultoria)$/.test(k3) ? 'Abre no fim do Nível 4' : /^(plataforma|manutencao)$/.test(k3) ? 'Abre no Nível 5' : k3 === 'oportunidades' ? 'Abre no Parceiro regional' : 'Abre no fim do Nível 3'; });
      euD.bloqueios = B;
      euD.termo = { versao: 'v1', disponivel: true, aceito_em: p >= 4 ? t3 : null };
    }
  }
  function demoProps() {
    var D = 86400000, n = Date.now();
    return [
      { id: 'dp1', numero: '20260004', cliente_nome: 'Posto Cerrado', cliente_cidade: 'Uberlândia', cliente_uf: 'MG', modelo: 'NEXUS DC 80 kW', valor_total: 145000, link_token: 'x', aberturas: 3, created_at: new Date(n - 9 * D).toISOString() },
      { id: 'dp2', numero: '20260003', cliente_nome: 'Supermercado Bom Preço', cliente_cidade: 'Uberaba', cliente_uf: 'MG', modelo: 'NEXUS DC 120 kW', valor_total: 165000, link_token: 'y', aberturas: 1, created_at: new Date(n - 6 * D).toISOString() },
      { id: 'dp3', numero: '20260002', cliente_nome: 'Hotel Serra Azul', cliente_cidade: 'Araguari', cliente_uf: 'MG', modelo: 'NEXUS DC 80 kW', valor_total: 145000, link_token: 'z', aberturas: 0, created_at: new Date(n - 4 * D).toISOString() },
      { id: 'dp4', numero: '20260001', cliente_nome: 'Transportadora Triângulo', cliente_cidade: 'Ituiutaba', cliente_uf: 'MG', modelo: 'NEXUS DC 120 kW', valor_total: 165000, link_token: null, aberturas: 0, created_at: new Date(n - 2 * D).toISOString() }
    ];
  }
  function demoAcademia() {
    var T = [['Mercado', 'O carro elétrico no Brasil'], ['Mercado', 'Quem compra um ponto'], ['Mercado', 'Quanto um ponto fatura'], ['Técnica', 'AC e DC'], ['Técnica', 'Padrão de entrada'], ['Técnica', 'Instalação de um DC'],
      ['Venda', 'Posto de combustível'], ['Venda', 'Mercado e shopping'], ['Venda', 'Hotel e restaurante'], ['Financiamento', 'Chave na mão'], ['Financiamento', 'Financiamento em 96x'], ['Financiamento', 'Sociedade e arrendamento']];
    var pg = prep().academia || { feitas: 0, meta: 12, aulas: {} };
    return {
      aulas: T.map(function (x, i) {
        DEMO_ACAD_CERTA['a' + (i + 1)] = 1;
        return { id: 'a' + (i + 1), modulo: x[0], titulo: x[1], resumo: 'Texto de exemplo da aula. O conteúdo de verdade chega com a equipe NEXUS.', pontos: ['Ponto de exemplo 1', 'Ponto de exemplo 2'], pergunta: 'Pergunta de exemplo da aula ' + (i + 1) + '?', opcoes: ['Primeira opção', 'Segunda opção', 'Terceira opção'] };
      }),
      progresso: pg
    };
  }
  function demoPost(c, corpo) {
    var agora = new Date().toISOString(), m;
    if (c === '/trilha/raio-x/enviar') {
      var n = notaLocal(st.rx.resp), passou = n.nota >= 80;
      E.raio_x = Object.assign({}, E.raio_x, { respostas: Object.assign({}, st.rx.resp), nota: n.nota, enviado_em: agora, faltas: n.faltas });
      if (passou) { E.etapas.p1 = { em: agora }; E.patamar = 2; E.historico.push({ titulo: 'Raio-X enviado, nota ' + n.nota, em: agora, autor: 'voce' }); }
      return { ok: true, data: { nota: n.nota, passou: passou, faltas: n.faltas, trilha: E } };
    }
    if (c === '/trilha/diagnostico') {
      if (E.diagnostico && E.diagnostico.pedido_em) return { ok: false, status: 409, data: { erro: 'ja_pedido' } };
      E.diagnostico = { pedido_em: agora, contato: corpo.contato };
      E.historico.push({ titulo: 'Contato deixado para o diagnóstico', em: agora, autor: 'voce' });
      return { ok: true, data: E };
    }
    if (c === '/trilha/preparo') { E.preparo = Object.assign({}, E.preparo, { formato: corpo.formato }); return { ok: true, data: E }; }
    if ((m = /^\/trilha\/academia\/(.+)$/.exec(c))) {
      var certa = num(corpo.resposta) === DEMO_ACAD_CERTA[m[1]];
      var a = E.preparo.academia || (E.preparo.academia = { feitas: 0, meta: 12, aulas: {} });
      var ja = a.aulas[m[1]];
      if (ja && !ja.certa && ja.libera_em && new Date(ja.libera_em).getTime() > Date.now()) return { ok: false, status: 409, data: { erro: 'aguarde', segundos: Math.ceil((new Date(ja.libera_em).getTime() - Date.now()) / 1000) } };
      if (certa && !(ja && ja.certa)) { a.feitas++; a.aulas[m[1]] = { em: agora, certa: true }; }
      if (!certa) { a.aulas[m[1]] = { em: agora, certa: false, libera_em: new Date(Date.now() + 120000).toISOString() }; return { ok: true, data: { certa: false, aguarde_s: 120, trilha: E } }; }
      if (a.feitas >= 12 && E.preparo.formato === 'academia') { E.etapas.p3 = { em: agora }; E.patamar = 4; }
      return { ok: true, data: { certa: certa, trilha: E } };
    }
    if (c === '/trilha/reuniao') { E.reuniao = { pedida_em: agora, dados: corpo }; E.historico.push({ titulo: 'Reunião com ' + corpo.cliente_nome + ' pedida', em: agora, autor: 'voce' }); return { ok: true, data: E }; }
    return { ok: false, status: 404, data: null };
  }

  window.NexusTrilha = {
    ligar: ligar, carregar: carregar, garantir: garantir, recarregar: recarregar, demo: demo,
    ligada: ligada, concluida: concluida, rotulo: rotulo, tela: tela, pos: pos, barra: barra, menu: menu, cartaoInicio: cartaoInicioCurto
  };
})();
