/* Trilha do Parceiro NEXUS, telas da equipe: visão "Trilha" (resumo, filas, lista e a ficha de cada parceiro)
   e visão "Mapa de demanda". Carregado pelo painel.js por caminho absoluto, nas duas páginas que usam o painel
   (/nexus/adm e /gerador/parceiros). Usa a sessão e o endereço da api do painel (window.PainelNexus.util).

   Api (contrato do plano da Onda 1, sempre sob /gerador/nexus/equipe):
     GET   /trilha                lista + resumo
     GET   /trilha/:userId        ficha completa com histórico
     PATCH /trilha/:userId        { acao, ... }
     GET   /trilha-mapa           Mapa de demanda
   404 ou { ligada:false }: a visão mostra "Trilha ainda não ligada" e o resto do painel segue igual.

   Modo de exemplo: ?exemplo=1 na página, ou o botão do estado "não ligada". 12 parceiros fictícios,
   marcados como exemplo; as ações mudam só a cópia local e nada vai para a api. */
(function () {
'use strict';

var PN = window.PainelNexus;
var U = PN && PN.util;
if (!U) return;
var esc = U.esc;

/* ── Rótulos (as chaves são as do plano, iguais na api e no app do parceiro) ── */
var PATAMARES = { 1: 'Mapeado', 2: 'Diagnosticado', 3: 'Preparado', 4: 'Em campo', 5: 'Cliente NEXUS', 6: 'Parceiro regional', 7: 'Trilha completa' };
var FILAS = [
  ['', 'Todos'],
  ['esperando', 'Esperando a equipe'],
  ['agendar_diagnostico', 'Agendar diagnóstico'],
  ['diagnostico_hoje', 'Diagnóstico de hoje'],
  ['registrar_encontro', 'Registrar encontro'],
  ['agendar_reuniao', 'Agendar reunião com cliente'],
  ['parados', 'Parados há mais de 7 dias']
];
var PENDENCIA = {
  agendar_diagnostico: 'Agendar diagnóstico', diagnostico_hoje: 'Diagnóstico de hoje',
  registrar_encontro: 'Registrar encontro', agendar_reuniao: 'Agendar reunião com cliente'
};
var RX = {
  anos_solar: { '0-1': 'Até 1 ano no solar', '1-3': '1 a 3 anos no solar', '3-5': '3 a 5 anos no solar', '5+': 'Mais de 5 anos no solar' },
  usinas: { '0-20': 'Até 20 usinas', '20-100': '20 a 100 usinas', '100-500': '100 a 500 usinas', '500+': 'Mais de 500 usinas' },
  equipe: { '1-2': '1 a 2 pessoas', '3-5': '3 a 5 pessoas', '6-15': '6 a 15 pessoas', '16+': '16 pessoas ou mais' },
  capacidades: { eletrica_bt: 'Elétrica BT', eletrica_mt: 'Elétrica MT', engenharia_art: 'Engenharia com ART', obra_civil: 'Obra civil', homologacao: 'Homologação' },
  ja_montou_eletroposto: { nunca: 'Nunca montou eletroposto', '1-2': 'Montou 1 ou 2 eletropostos', '3+': 'Montou 3 ou mais eletropostos' },
  conhece_mercado: { nada: 'Não conhece o mercado', pouco: 'Conhece pouco o mercado', bem: 'Conhece bem o mercado' },
  papel: { revenda: 'Revenda', montagem: 'Montagem', ambos: 'Revenda e montagem' },
  quando: { agora: 'Agora', '3m': 'Em até 3 meses', '6m': 'Em até 6 meses', sem_pressa: 'Sem pressa' },
  dificuldades: { cliente: 'Achar cliente', preco: 'Preço', financiamento: 'Financiamento', tecnica: 'Parte técnica', homologacao: 'Homologação', tempo: 'Falta de tempo', outra: 'Outra' },
  tipo_local: { posto: 'Posto', hotel: 'Hotel', shopping: 'Shopping', condominio: 'Condomínio', empresa_frota: 'Empresa com frota', restaurante: 'Restaurante', estacionamento: 'Estacionamento', outro: 'Outro' },
  fase: { ideia: 'Ideia', conversando: 'Conversando', quente: 'Quente' }
};
var FASE_COR = { ideia: '', conversando: 'az', quente: 'ok' };

/* ── Ícones (traço único, 24 px) ── */
var IC = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  radar: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12l6-6',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  video: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5',
  capelo: 'M2 9l10-5 10 5-10 5zM6 11v5c3.5 2.2 8.5 2.2 12 0v-5',
  caneta: 'M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5',
  gente: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M16 5.2a3 3 0 0 1 0 5.6M18 15c2 .6 3 2.2 3 5',
  carrinho: 'M3 4h2.2l2.3 11h10.8l2-7.5H6.3M9.5 20h.01M17 20h.01',
  nota: 'M6 3h9l4 4v14H6zM9.5 12h6M9.5 16h6',
  seta: 'M5 12h14M13 6l6 6-6 6',
  pessoa: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21c0-4 3.4-6 7.5-6s7.5 2 7.5 6',
  estrela: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  cadeado: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  mapa: 'M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20',
  mais: 'M9 6l6 6-6 6',
  ponto: 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'
};
function ic(nome) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + IC[nome] + '"/></svg>';
}
function aj(txt) {
  return '<button type="button" class="tr-aj" data-aj="' + esc(txt) + '" aria-label="' + esc(txt) + '">?</button>';
}

/* ── Estado ── */
var T = {
  ligada: null,         // null: ainda não sabe; false: api sem trilha; true: ligada
  exemplo: /[?&]exemplo=1\b/.test(location.search),
  lista: null, resumo: null, mapa: null,
  carregandoLista: null, carregandoMapa: null,
  fila: '', patamar: '', uf: '', q: '',
  ficha: null, fichaId: null, carregandoFicha: false,
  acao: null, confirmar: null, salvando: false, erroAcao: '',
  hist: 'tudo', foco: null
};
var EX = null; // dados de exemplo (fichas completas, por user_id)

/* ── Datas ── */
var TZ = 'America/Sao_Paulo';
function data(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? d : null; }
function partes(d) {
  var o = {};
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
  return o;
}
// "17/11" (com o ano quando não é o atual) e, com hora, "17/11 14h30".
function dt(iso, comHora) {
  var d = data(iso); if (!d) return '';
  var p = partes(d), hoje = partes(new Date());
  var s = p.day + '/' + p.month + (p.year !== hoje.year ? '/' + p.year : '');
  return comHora ? s + ' ' + p.hour + 'h' + p.minute : s;
}
function ehHoje(iso) {
  var d = data(iso); if (!d) return false;
  var a = partes(d), b = partes(new Date());
  return a.day === b.day && a.month === b.month && a.year === b.year;
}
function diasDesde(iso) { var d = data(iso); return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null; }
// Valor para <input type="datetime-local"> no horário do aparelho.
function paraCampo(iso) {
  var d = data(iso); if (!d) return '';
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes());
}
function diasTxt(n) { return n === 1 ? '1 dia' : n + ' dias'; }
function num(v) { var n = Number(v); return v == null || v === '' || !isFinite(n) ? null : n; }
function fmtN(v) { var n = num(v); return n == null ? '' : U.fmtNum(n); }

/* ── Leitura tolerante das respostas da api ── */
function listaDe(j) {
  if (Array.isArray(j)) return j;
  return (j && (j.parceiros || j.itens || j.items || j.lista)) || [];
}
// Aceita { chave: n } ou [{ chave|k|tipo|uf|valor|nome, n|total|qtd|quantidade }]
function contagem(x) {
  var o = {};
  if (Array.isArray(x)) {
    x.forEach(function (i) {
      if (!i) return;
      var k = i.chave != null ? i.chave : (i.k != null ? i.k : (i.tipo != null ? i.tipo : (i.patamar != null ? i.patamar : (i.valor != null ? i.valor : i.nome))));
      var n = num(i.n != null ? i.n : (i.total != null ? i.total : (i.qtd != null ? i.qtd : (i.quantidade != null ? i.quantidade : i.parceiros))));
      if (k != null && n != null) o[k] = (o[k] || 0) + n;
    });
  } else if (x && typeof x === 'object') {
    Object.keys(x).forEach(function (k) { var n = num(x[k]); if (n != null) o[k] = n; });
  }
  return o;
}
function patamarDe(p) { var n = Math.round(Number(p && p.patamar)); return n >= 1 && n <= 7 ? n : 1; }
function pendenciaDe(p) { var k = p && (p.pendencia_equipe || p.pendencia); return PENDENCIA[k] ? k : null; }
function paradoDe(p) {
  var n = num(p.parado_ha_dias);
  if (n == null) n = diasDesde(p.ultimo_movimento_em);
  return n;
}
function resumoDe(lista, j) {
  var r = (j && j.resumo) || {};
  var pp = contagem(r.por_patamar || r.patamares);
  var pf = contagem(r.por_fila || r.filas);
  var calc = { pat: {}, fila: {}, esperando: 0, parados: 0 };
  lista.forEach(function (p) {
    var k = patamarDe(p); calc.pat[k] = (calc.pat[k] || 0) + 1;
    var f = pendenciaDe(p); if (f) { calc.fila[f] = (calc.fila[f] || 0) + 1; calc.esperando++; }
    var d = paradoDe(p); if (k < 7 && d != null && d > 7) calc.parados++;
  });
  return {
    pat: Object.keys(pp).length ? pp : calc.pat,
    fila: Object.keys(pf).length ? pf : calc.fila,
    esperando: num(r.esperando_equipe) != null ? num(r.esperando_equipe) : calc.esperando,
    parados: calc.parados,
    total: lista.length
  };
}
function emailCurto(e) {
  var s = String(e || '');
  if (!s) return '';
  var nome = s.split('@')[0].replace(/[._-]+/g, ' ');
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}
function cidadeUf(c, u) { c = String(c || '').trim(); u = String(u || '').trim().toUpperCase(); return c && u ? c + '-' + u : (c || u); }

/* ── Api (ou o exemplo) ── */
function naoLigada(x) {
  return (x.status === 404 && !(x.json && x.json.erro === 'parceiro_nao_encontrado')) || (x.json && x.json.ligada === false) || (x.status === 503 && x.json && x.json.erro === 'trilha_desligada');
}
function carregarLista(forcar) {
  if (T.exemplo) { usarExemplo(); return Promise.resolve(); }
  if (T.carregandoLista) return T.carregandoLista;
  if (T.lista && !forcar) return Promise.resolve();
  T.carregandoLista = U.api('GET', '/trilha').then(function (x) {
    if (naoLigada(x)) { T.ligada = false; T.lista = null; return; }
    if (!U.okHttp(x)) { T.erroLista = 'O servidor respondeu com erro (' + x.status + ').'; return; }
    T.ligada = true; T.erroLista = '';
    T.lista = listaDe(x.json);
    T.resumo = resumoDe(T.lista, x.json);
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    T.erroLista = 'Sem conexão com o servidor.';
  }).then(function () { T.carregandoLista = null; marcarAba(); });
  return T.carregandoLista;
}
function carregarMapa(forcar) {
  if (T.exemplo) { usarExemplo(); return Promise.resolve(); }
  if (T.carregandoMapa) return T.carregandoMapa;
  if (T.mapa && !forcar) return Promise.resolve();
  T.carregandoMapa = U.api('GET', '/trilha-mapa').then(function (x) {
    if (naoLigada(x)) { T.ligada = false; T.mapa = null; return; }
    if (!U.okHttp(x)) { T.erroMapa = 'O servidor respondeu com erro (' + x.status + ').'; return; }
    T.ligada = true; T.erroMapa = '';
    T.mapa = normalizarMapa(x.json);
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    T.erroMapa = 'Sem conexão com o servidor.';
  }).then(function () { T.carregandoMapa = null; });
  return T.carregandoMapa;
}
function normalizarMapa(j) {
  j = j || {};
  var porUf = (Array.isArray(j.por_uf) ? j.por_uf : []).map(function (u) {
    return { uf: String(u.uf || '').toUpperCase(), parceiros: num(u.parceiros) || 0, demanda_12m: num(u.demanda_12m) || 0, clientes_em_vista: num(u.clientes_em_vista) || 0 };
  }).filter(function (u) { return u.uf; });
  return {
    por_patamar: contagem(j.por_patamar || j.patamares),
    por_uf: porUf,
    por_tipo_local: contagem(j.por_tipo_local || j.tipo_local),
    quando: contagem(j.quando),
    dificuldades: contagem(j.dificuldades),
    fases: contagem(j.fases || j.fases_carteira || j.carteira),
    total_raio_x: num(j.total_raio_x || j.raio_x_enviados)
  };
}
function buscarFicha(id) {
  if (T.exemplo) { T.ficha = EX.fichas[id] || null; return Promise.resolve(); }
  T.carregandoFicha = true;
  return U.api('GET', '/trilha/' + encodeURIComponent(id)).then(function (x) {
    if (String(T.fichaId) !== String(id)) return;
    if (naoLigada(x)) { T.ficha = null; T.erroFicha = 'A trilha não está ligada.'; return; }
    if (!U.okHttp(x)) { T.ficha = null; T.erroFicha = 'Não consegui abrir a ficha (' + x.status + ').'; return; }
    T.erroFicha = '';
    T.ficha = x.json.ficha || x.json;
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    T.erroFicha = 'Sem conexão para abrir a ficha.';
  }).then(function () { T.carregandoFicha = false; });
}

/* ═════════════ Visão Trilha ═════════════ */
function raizLista() { return document.getElementById('tr-lista-raiz'); }
function raizMapa() { return document.getElementById('tr-mapa-raiz'); }

// Quem chega por /nexus/adm#trilha (ou #mapa) cai direto na aba, rolada até as abas.
var rolarParaAbas = /^#(trilha|mapa)\b/.test(location.hash);
function rolarSeVeioPeloLink() {
  if (!rolarParaAbas) return;
  rolarParaAbas = false;
  var a = document.getElementById('abas');
  if (a) a.scrollIntoView({ block: 'start' });
}
function abrir(qual, forcar) {
  if (qual === 'mapa') {
    var rm = raizMapa(); if (!rm) return;
    if (!T.mapa && !T.exemplo) rm.innerHTML = '<div class="vazio"><span class="spin"></span>Carregando o mapa…</div>';
    carregarMapa(forcar).then(desenharMapa).then(rolarSeVeioPeloLink);
    return;
  }
  var rl = raizLista(); if (!rl) return;
  if (!T.lista && !T.exemplo) rl.innerHTML = '<div class="vazio"><span class="spin"></span>Carregando a trilha…</div>';
  carregarLista(forcar).then(desenharVisao).then(rolarSeVeioPeloLink);
}

function faixaExemplo() {
  return '<div class="tr-ex" role="note"><span>Exemplo. Dados fictícios, nada é gravado.</span>' +
    '<button type="button" class="btn ghost sm" data-tr="sair-exemplo">Sair do exemplo</button></div>';
}
function telaOff(onde) {
  return '<div class="tr-off">' + ic('mapa') +
    '<h2>Trilha ainda não ligada</h2>' +
    '<p>Ela liga sozinha quando o banco ganhar as tabelas da trilha. O resto do painel segue igual. ' +
    aj('Falta rodar MIGRATION_nexus_trilha.sql no banco do SolarDoc. Até lá a api responde que a trilha está desligada.') + '</p>' +
    '<button type="button" class="btn" data-tr="exemplo">Ver com dados de exemplo</button></div>' +
    (onde === 'mapa' ? '' : '');
}
function telaErro(msg, alvo) {
  return '<div class="vazio">' + esc(msg) + ' <button type="button" class="btn sm" data-tr="recarregar" data-v="' + alvo + '">Tentar de novo</button></div>';
}

function desenharVisao() {
  var r = raizLista(); if (!r) return;
  if (T.exemplo) usarExemplo();
  if (!T.exemplo && T.ligada === false) { r.innerHTML = telaOff('lista'); return; }
  if (!T.lista) { r.innerHTML = telaErro(T.erroLista || 'Não consegui carregar a trilha.', 'trilha'); return; }
  var ufs = {};
  T.lista.forEach(function (p) { if (p.uf) ufs[String(p.uf).toUpperCase()] = 1; });
  if (T.uf) ufs[T.uf] = 1;
  r.innerHTML =
    (T.exemplo ? faixaExemplo() : '') +
    '<div class="tr-resumo" id="tr-resumo"></div>' +
    '<div class="tr-filas" id="tr-filas" role="group" aria-label="Filas"></div>' +
    '<div class="tr-filtros">' +
      '<div class="busca"><label for="tr-q">Buscar</label><input id="tr-q" type="search" placeholder="Empresa ou cidade…" autocomplete="off" value="' + esc(T.q) + '"></div>' +
      '<div><label for="tr-pat">Nível</label><select id="tr-pat"><option value="">Todos</option>' +
        [1, 2, 3, 4, 5, 6, 7].map(function (k) { return '<option value="' + k + '"' + (String(T.patamar) === String(k) ? ' selected' : '') + '>' + (k < 7 ? k + '. ' : '') + PATAMARES[k] + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label for="tr-uf">UF</label><select id="tr-uf"><option value="">Todas</option>' +
        Object.keys(ufs).sort().map(function (u) { return '<option' + (T.uf === u ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') +
      '</select></div>' +
    '</div>' +
    '<p class="contagem" id="tr-cont" aria-live="polite"></p>' +
    '<div class="tr-cab" aria-hidden="true"><span>Parceiro</span><span>Nível</span><span>Nota</span><span>Assinante</span><span>Parado há</span><span>Pendência</span><span>Responsável</span></div>' +
    '<div class="tr-lista" id="tr-lin"></div>';
  desenharDinamico();
}

function filtrar() {
  var q = semAcento(T.q);
  return (T.lista || []).filter(function (p) {
    var pat = patamarDe(p), pend = pendenciaDe(p), par = paradoDe(p);
    if (T.patamar && String(pat) !== String(T.patamar)) return false;
    if (T.uf && String(p.uf || '').toUpperCase() !== T.uf) return false;
    if (T.fila === 'esperando' && !pend) return false;
    if (T.fila === 'parados' && !(pat < 7 && par != null && par > 7)) return false;
    if (PENDENCIA[T.fila] && pend !== T.fila) return false;
    if (q && semAcento([p.empresa, p.cidade, p.uf].join(' ')).indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    // Na fila: quem está parado há mais tempo primeiro. Em Todos: quem está mais perto do 1º pedido.
    var pa = patamarDe(a), pb = patamarDe(b);
    if (T.fila) return (paradoDe(b) || 0) - (paradoDe(a) || 0);
    var ka = pa === 7 ? 0 : pa, kb = pb === 7 ? 0 : pb;
    if (kb !== ka) return kb - ka;
    return (paradoDe(b) || 0) - (paradoDe(a) || 0);
  });
}
function semAcento(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

function desenharDinamico() {
  var R = T.resumo || resumoDe(T.lista || [], null);
  var maxPat = 1;
  [1, 2, 3, 4, 5, 6, 7].forEach(function (k) { maxPat = Math.max(maxPat, R.pat[k] || 0); });
  var escada = '<div class="tr-escada"><div class="tr-escada-t"><h2>Onde cada um está ' +
      aj('Nível em curso de cada parceiro. Toque num degrau para filtrar.') + '</h2>' +
      (T.patamar ? '<button type="button" class="btn ghost sm" data-tr="limpar-pat">Ver todos</button>' : '') + '</div>' +
    '<div class="tr-degraus">' + [1, 2, 3, 4, 5, 6, 7].map(function (k) {
      var n = R.pat[k] || 0;
      return '<button type="button" class="tr-dg' + (k === 7 ? ' fim' : '') + (n ? '' : ' zero') + '" data-tr="pat" data-v="' + k + '" aria-pressed="' + (String(T.patamar) === String(k)) + '"' +
        ' aria-label="' + esc((k < 7 ? 'Nível ' + k + ', ' : '') + PATAMARES[k] + ': ' + n) + '" style="--alt:' + (10 + (k - 1) * 9) + 'px;--pct:' + Math.max(n ? 4 : 0, Math.round(n / maxPat * 100)) + '%">' +
        '<span class="q num">' + n + '</span><span class="bloco-dg"></span>' +
        '<span class="nm"><b>' + (k < 7 ? 'N' + k : 'Fim') + '</b>' + esc(PATAMARES[k]) + '</span></button>';
    }).join('') + '</div></div>';
  var kpis = '<div class="tr-kpis">' +
    '<button type="button" class="tr-kpi esp" data-tr="fila" data-v="esperando" aria-pressed="' + (T.fila === 'esperando') + '"><span class="r">Esperando a equipe</span><span class="n num">' + R.esperando + '</span></button>' +
    '<button type="button" class="tr-kpi par" data-tr="fila" data-v="parados" aria-pressed="' + (T.fila === 'parados') + '"><span class="r">Parados há mais de 7 dias</span><span class="n num">' + R.parados + '</span></button>' +
    '<button type="button" class="tr-kpi" data-tr="tudo" aria-pressed="false"><span class="r">Na trilha</span><span class="n num">' + R.total + '</span></button>' +
    '</div>';
  document.getElementById('tr-resumo').innerHTML = escada + kpis;

  document.getElementById('tr-filas').innerHTML = FILAS.map(function (f) {
    var n = f[0] === '' ? R.total : (f[0] === 'esperando' ? R.esperando : (f[0] === 'parados' ? R.parados : (R.fila[f[0]] || 0)));
    var esp = PENDENCIA[f[0]] || f[0] === 'esperando';
    return '<button type="button" class="' + (esp && n ? 'esp' : '') + '" data-tr="fila" data-v="' + f[0] + '" aria-pressed="' + (T.fila === f[0]) + '">' +
      esc(f[1]) + '<em class="num">' + n + '</em></button>';
  }).join('');

  var l = filtrar(), tot = (T.lista || []).length;
  document.getElementById('tr-cont').textContent = l.length === tot ? (tot === 1 ? '1 parceiro' : tot + ' parceiros') : l.length + ' de ' + tot + ' parceiros';
  var box = document.getElementById('tr-lin');
  if (!tot) { box.innerHTML = '<div class="vazio">Ninguém começou a trilha ainda. Quem abrir o Raio-X no portal aparece aqui.</div>'; return; }
  if (!l.length) {
    box.innerHTML = '<div class="vazio">' + (T.fila && !T.q && !T.patamar && !T.uf ? 'Fila vazia. Nada esperando a equipe aqui.' : 'Ninguém com esses filtros.') +
      ' <button type="button" class="btn ghost sm" data-tr="tudo">Limpar filtros</button></div>';
    return;
  }
  box.innerHTML = l.map(linhaHtml).join('');
}

function escadinha(pat) {
  var h = '';
  for (var i = 1; i <= 6; i++) h += '<i class="' + (i < pat ? 'feita' : (i === pat ? 'at' : '')) + '" style="height:' + (4 + i * 2) + 'px"></i>';
  return '<span class="tr-fm" aria-hidden="true">' + h + '</span>';
}
function paradoHtml(p) {
  var pat = patamarDe(p), d = paradoDe(p);
  if (pat === 7) return '<span class="tr-sem">Concluída</span>';
  if (d == null) return '<span class="tr-sem">Sem dado</span>';
  var c = d > 7 ? 'er' : (d > 3 ? 'av' : '');
  return '<span class="tr-parado num ' + c + '">' + (d === 0 ? 'Hoje' : diasTxt(d)) + '</span>';
}
function notaHtml(p) {
  var n = num(p.nota != null ? p.nota : p.raio_x_nota);
  if (n == null) return '<span class="tr-nota sem">Sem Raio-X</span>';
  return '<span class="tr-nota num' + (n >= 80 ? ' ok' : '') + '">' + n + '</span>';
}
function linhaHtml(p) {
  var pat = patamarDe(p), pend = pendenciaDe(p);
  var resp = p.responsavel_email ? emailCurto(p.responsavel_email) : '';
  return '<button type="button" class="tr-lin' + (pend ? ' esp' : '') + '" data-tr="ficha" data-v="' + esc(p.user_id) + '">' +
    '<div class="c-emp"><div class="emp">' + esc(p.empresa || 'Empresa sem nome') + '</div><div class="peq">' + esc(cidadeUf(p.cidade, p.uf) || 'Sem cidade') + '</div></div>' +
    '<div class="c-pat"><span class="rt">Nível</span><span class="tr-pat">' + escadinha(pat) + '<span>' + (pat < 7 ? pat + '.&nbsp;' : '') + esc(PATAMARES[pat]) + '</span>' + '</span></div>' +
    '<div><span class="rt">Nota</span>' + notaHtml(p) + '</div>' +
    '<div><span class="rt">Assinante</span>' + (p.assinante ? '<span class="pill ok">Sim</span>' : '<span class="pill">Não</span>') + '</div>' +
    '<div><span class="rt">Parado há</span>' + paradoHtml(p) + '</div>' +
    '<div class="c-pend">' + (pend ? '<span class="rt">Pendência</span><span class="tr-pend">' + ic('relogio') + esc(PENDENCIA[pend]) + '</span>' : '') + '</div>' +
    '<div class="c-resp">' + (resp ? '<span class="rt">Responsável</span>' + esc(resp) : '<span class="rt">Responsável</span><span class="tr-sem">Sem responsável</span>') + '</div>' +
    '</button>';
}

/* ═════════════ Ficha ═════════════ */
function abrirFicha(id) {
  T.fichaId = id; T.acao = null; T.confirmar = null; T.erroAcao = ''; T.hist = 'tudo'; T.ficha = null; T.erroFicha = '';
  T.foco = document.activeElement;
  var fundo = garantirGaveta();
  fundo.hidden = false;
  document.body.style.overflow = 'hidden';
  var f = document.getElementById('tr-ficha');
  f.innerHTML = '<div class="tr-f-topo"><div><h2 id="tr-f-titulo">Abrindo a ficha</h2></div>' + botaoFechar() + '</div><div class="vazio" style="margin:20px"><span class="spin"></span>Carregando…</div>';
  focarFechar();
  buscarFicha(id).then(function () { desenharFicha(); f.scrollTop = 0; focarFechar(); });
}
function botaoFechar() { return '<button type="button" class="tr-fx" data-tr="fechar" aria-label="Fechar a ficha">' + ic('x') + '</button>'; }
function focarFechar() { var b = document.querySelector('#tr-ficha .tr-fx'); if (b) b.focus(); }
function fecharFicha() {
  var fundo = document.getElementById('tr-fundo');
  if (fundo) fundo.hidden = true;
  T.fichaId = null; T.ficha = null; T.acao = null; T.confirmar = null;
  document.body.style.overflow = '';
  esconderBalao();
  if (T.foco && T.foco.focus && document.contains(T.foco)) { try { T.foco.focus(); } catch (e) { /* segue */ } }
}
function garantirGaveta() {
  var fundo = document.getElementById('tr-fundo');
  if (fundo) return fundo;
  fundo = document.createElement('div');
  fundo.id = 'tr-fundo'; fundo.className = 'tr-fundo pn'; fundo.hidden = true;
  fundo.innerHTML = '<div class="tr-ficha" id="tr-ficha" role="dialog" aria-modal="true" aria-labelledby="tr-f-titulo" tabindex="-1"></div>';
  fundo.addEventListener('mousedown', function (ev) { if (ev.target === fundo) fecharFicha(); });
  document.body.appendChild(fundo);
  return fundo;
}

function fichaG(f, k) {
  // A ficha da equipe traz os dados da trilha e, ao lado, os do nexus_parceiros e da equipe.
  var fontes = [f, f.equipe || {}, f.trilha || {}, f.parceiro || {}];
  for (var i = 0; i < fontes.length; i++) if (fontes[i][k] != null && fontes[i][k] !== '') return fontes[i][k];
  return null;
}
function etapaEm(f, n) { var e = f.etapas && f.etapas['p' + n]; return e ? (e.em || (typeof e === 'string' ? e : null)) : null; }

function desenharFicha() {
  var box = document.getElementById('tr-ficha');
  if (!box) return;
  var f = T.ficha;
  if (!f) {
    box.innerHTML = '<div class="tr-f-topo"><div><h2 id="tr-f-titulo">Ficha</h2></div>' + botaoFechar() + '</div>' +
      '<div style="padding:20px">' + telaErro(T.erroFicha || 'Parceiro não encontrado.', 'ficha') + '</div>';
    return;
  }
  var pre = f.prefill || {}, par = f.parceiro || {};
  var pat = patamarDe(f);
  var empresa = pre.empresa || par.empresa || fichaG(f, 'empresa') || 'Empresa sem nome';
  var local = cidadeUf(pre.cidade || par.cidade, pre.uf || par.uf);
  var resp = fichaG(f, 'responsavel_email');
  var ult = fichaG(f, 'ultimo_movimento_em');
  var hist = Array.isArray(f.historico) ? f.historico : [];
  if (!ult && hist.length) ult = hist.reduce(function (a, h) { return !a || String(h.em) > String(a) ? h.em : a; }, null);
  var parado = num(fichaG(f, 'parado_ha_dias'));
  if (parado == null) parado = diasDesde(ult);
  var parPill = pat === 7 ? '' : (parado == null ? '' :
    '<span class="pill ' + (parado > 7 ? 'er' : (parado > 3 ? 'av' : '')) + '">Parado há ' + (parado === 0 ? 'menos de 1 dia' : diasTxt(parado)) + '</span>');

  box.innerHTML =
    '<div class="tr-f-topo"><div style="min-width:0">' +
      '<h2 id="tr-f-titulo">' + esc(empresa) + '</h2>' +
      '<p class="sub">' + esc(local || 'Sem cidade') + ' · ' + (resp ? 'Responsável: ' + esc(emailCurto(resp)) : 'Sem responsável') + '</p>' +
      '<div class="tr-pills">' +
        '<span class="pill az">' + (pat < 7 ? 'Nível ' + pat + ' · ' : '') + esc(PATAMARES[pat]) + '</span>' + parPill +
        (f.assinante ? '<span class="pill ok">Assinante</span>' : '<span class="pill">Sem plano pago</span>') +
        (T.exemplo ? '<span class="tr-tag-ex">Exemplo</span>' : '') +
      '</div></div>' + botaoFechar() + '</div>' +
    '<div class="tr-f-corpo">' +
      '<div class="tr-f-col">' + blocoAcoes(f, pat, empresa) + blocoPassos(f, pat) + blocoNota(f) + '</div>' +
      '<div class="tr-f-col">' + blocoRaioX(f) + blocoCarteira(f) + blocoSimulacao(f) + blocoSolarDoc(f) + blocoHistorico(hist) + '</div>' +
    '</div>';
}

/* Ações do PATCH. As que mudam o patamar pedem confirmação aqui mesmo. */
var ACOES = {
  agendar_diagnostico: { rot: 'Agendar diagnóstico', ic: 'cal' },
  diagnostico_feito: { rot: 'Registrar o diagnóstico', ic: 'video' },
  mentoria_paga: { rot: 'Marcar mentoria paga', ic: 'capelo' },
  mentoria_encontro: { rot: 'Registrar encontro', ic: 'capelo' },
  agendar_reuniao: { rot: 'Agendar reunião com cliente', ic: 'cal' },
  reuniao_feita: { rot: 'Marcar reunião feita', ic: 'gente' },
  promover_regional: { rot: 'Promover a Parceiro regional', ic: 'estrela' },
  avancar: { rot: 'Avançar o nível', ic: 'seta' },
  responsavel: { rot: 'Trocar o responsável', ic: 'pessoa' },
  obs: { rot: 'Escrever observação', ic: 'nota' }
};
function acoesDe(f, pat) {
  var l = [], d = f.diagnostico || {}, pr = f.preparo || {}, re = f.reuniao || {};
  if (pat === 2 && d.pedido_em && !d.feito_em) { l.push('agendar_diagnostico'); l.push('diagnostico_feito'); }
  if (pat === 3 && pr.formato === 'mentoria') l.push(pr.mentoria_paga_em ? 'mentoria_encontro' : 'mentoria_paga');
  if (pat === 4 && re.pedida_em && !re.feita_em) { l.push('agendar_reuniao'); l.push('reuniao_feita'); }
  if (pat === 6) l.push('promover_regional');
  var sempre = ['responsavel', 'obs'];
  // O Nível 5 fecha sozinho com o 1º pedido confirmado: não tem "avançar".
  if (pat <= 6 && pat !== 5) sempre.unshift('avancar');
  return { agora: l, sempre: sempre, d: d, pr: pr, re: re };
}
function rotuloAcao(k, f) {
  var d = f.diagnostico || {}, re = f.reuniao || {}, pr = f.preparo || {};
  if (k === 'agendar_diagnostico' && d.agendado_para) return 'Remarcar o diagnóstico';
  if (k === 'agendar_reuniao' && re.agendada_para) return 'Remarcar a reunião';
  if (k === 'mentoria_encontro') return 'Registrar encontro ' + Math.min(4, (num(pr.encontros) || 0) + 1) + ' de 4';
  return ACOES[k].rot;
}
function blocoAcoes(f, pat, empresa) {
  var a = acoesDe(f, pat);
  var bt = function (k, primaria) {
    var aberto = T.acao === k;
    return '<button type="button" class="btn' + (primaria ? '' : ' ghost') + '" data-tr="acao" data-v="' + k + '" aria-expanded="' + aberto + '">' +
      '<span>' + esc(rotuloAcao(k, f)) + '</span>' + ic(aberto ? 'x' : (primaria ? ACOES[k].ic : 'mais')) + '</button>' + (aberto ? formAcao(k, f, pat, empresa) : '');
  };
  var h = '<div class="tr-cx"><h3>Agora ' + aj('Só aparecem as ações que valem no nível em curso. Toda ação fica no histórico com o seu e-mail.') + '</h3><div class="tr-acoes">';
  if (a.agora.length) h += a.agora.map(function (k) { return bt(k, true); }).join('');
  else h += '<p class="vz">' + esc(esperaTxt(f, pat)) + '</p>';
  h += '<div class="sep" role="presentation"></div>' + a.sempre.map(function (k) { return bt(k, false); }).join('');
  return h + '</div></div>';
}
function esperaTxt(f, pat) {
  var d = f.diagnostico || {}, pr = f.preparo || {}, ac = pr.academia || {};
  if (pat === 1) return 'Esperando o Raio-X com nota 80.';
  if (pat === 2) return d.pedido_em ? 'Nada esperando a equipe.' : (f.assinante ? 'Esperando ele pedir o diagnóstico.' : 'Precisa assinar para pedir o diagnóstico.');
  if (pat === 3) return pr.formato === 'academia' ? 'Fazendo a Academia: ' + (num(ac.feitas) || 0) + ' de ' + (num(ac.meta) || 12) + ' aulas.' : 'Esperando ele escolher mentoria ou Academia.';
  if (pat === 4) return (f.termo || {}).aceito ? 'Esperando ele pedir a reunião com o cliente.' : 'Esperando ele aceitar o termo.';
  if (pat === 5) return 'Esperando o 1º pedido confirmado.';
  if (pat === 7) return 'Trilha completa.';
  return 'Nada esperando a equipe.';
}
function formAcao(k, f, pat, empresa) {
  var d = f.diagnostico || {}, re = f.reuniao || {}, pr = f.preparo || {};
  var erro = T.erroAcao ? '<p class="erro" role="alert" tabindex="-1">' + esc(T.erroAcao) + '</p>' : '';
  if (T.confirmar && T.confirmar.acao === k) {
    return '<div class="tr-conf" role="alertdialog" aria-labelledby="tr-conf-t"><p id="tr-conf-t">' + esc(T.confirmar.texto) + '<small>' + esc(T.confirmar.sub) + '</small></p>' + erro +
      '<div class="linha">' +
      '<button type="button" class="btn tr-ok" data-tr="confirmar"' + (T.salvando ? ' disabled' : '') + '>' + (T.salvando ? 'Salvando…' : 'Confirmar') + '</button>' +
      '<button type="button" class="btn ghost" data-tr="voltar"' + (T.salvando ? ' disabled' : '') + '>Voltar</button></div></div>';
  }
  var c = '';
  if (k === 'agendar_diagnostico') {
    var pref = d.preferencia || {};
    var dias = (Array.isArray(pref.dias) ? pref.dias : []).map(function (x) { return dt(x); }).filter(Boolean);
    c = (dias.length ? '<p class="dica">Prefere ' + esc(dias.join(', ')) + (pref.periodo ? ', de ' + (pref.periodo === 'manha' ? 'manhã' : 'tarde') : '') + '.</p>' : '') +
      '<div><label for="tr-a-quando">Data e hora</label><input id="tr-a-quando" type="datetime-local" required value="' + esc(paraCampo(d.agendado_para)) + '"></div>' +
      '<div><label for="tr-a-link">Link da reunião</label><input id="tr-a-link" type="url" inputmode="url" placeholder="https://meet.google.com/…" value="' + esc(d.link || '') + '"></div>';
  } else if (k === 'diagnostico_feito') {
    c = '<fieldset class="tr-fs"><legend>Resultado</legend>' +
      '<div class="tr-escolha"><label><input type="radio" name="tr-a-res" value="aprovado">Aprovado</label><label><input type="radio" name="tr-a-res" value="ainda_nao">Ainda não</label></div></fieldset>' +
      '<div><label for="tr-a-plano">Plano de entrada</label><textarea id="tr-a-plano" placeholder="Por onde começa, qual cliente, o que precisa">' + esc(d.plano || '') + '</textarea></div>';
  } else if (k === 'mentoria_paga') {
    c = '<p class="dica">Libera os 4 encontros da mentoria.</p>';
  } else if (k === 'mentoria_encontro') {
    var n = Math.min(4, (num(pr.encontros) || 0) + 1);
    c = '<p class="dica">Encontro ' + n + ' de 4.' + (n === 4 ? ' O 4º fecha o Nível 3.' : '') + '</p>';
  } else if (k === 'agendar_reuniao') {
    var dd = re.dados || {};
    c = (dd.cliente_nome ? '<p class="dica">Com ' + esc(dd.cliente_nome) + (dd.cidade ? ', ' + esc(cidadeUf(dd.cidade, dd.uf)) : '') + '.</p>' : '') +
      '<div><label for="tr-a-quando">Data e hora</label><input id="tr-a-quando" type="datetime-local" required value="' + esc(paraCampo(re.agendada_para)) + '"></div>';
  } else if (k === 'reuniao_feita') {
    c = (!(f.termo || {}).aceito ? '<p class="erro">O parceiro ainda não aceitou o termo. A reunião só fecha depois do aceite.</p>' : '') + '<div><label for="tr-a-obs">Como foi</label><textarea id="tr-a-obs" placeholder="Opcional"></textarea></div>';
  } else if (k === 'promover_regional') {
    c = '<p class="dica">Confira os requisitos antes. Abre as obras da região.</p>';
  } else if (k === 'avancar') {
    c = '<p class="dica">Fecha o Nível ' + pat + ' sem o passo normal. O motivo fica no histórico.</p>' +
      '<div><label for="tr-a-motivo">Motivo</label><textarea id="tr-a-motivo" required placeholder="Obrigatório"></textarea></div>';
  } else if (k === 'responsavel') {
    var r = fichaG(f, 'responsavel_email') || '';
    c = '<div><label for="tr-a-email">E-mail de quem cuida</label><input id="tr-a-email" type="email" inputmode="email" autocomplete="off" spellcheck="false" value="' + esc(r) + '" placeholder="nome@empresa.com"></div>';
  } else if (k === 'obs') {
    c = '<div><label for="tr-a-texto">Observação</label><textarea id="tr-a-texto" required placeholder="Só a equipe vê"></textarea></div>';
  }
  return '<form class="tr-form" data-tr-form="' + k + '" novalidate>' + c + erro +
    '<div class="linha"><button type="submit" class="btn"' + (T.salvando ? ' disabled' : '') + '>' + (T.salvando ? 'Salvando…' : (k === 'mentoria_paga' ? 'Marcar como paga' : 'Salvar')) + '</button>' +
    '<button type="button" class="btn ghost" data-tr="acao" data-v="' + k + '">Cancelar</button></div></form>';
}
// Lê o formulário. Devolve { corpo } ou { erro }; muda: texto da confirmação quando a ação fecha um patamar.
function lerForm(k, form, f, pat, empresa) {
  var v = function (id) { var e = form.querySelector('#' + id); return e ? String(e.value || '').trim() : ''; };
  var corpo = { acao: k }, muda = null;
  var fecha = function (n) { return { texto: 'Fecha o Nível ' + n + ' (' + PATAMARES[n] + ') de ' + empresa + '.', sub: n < 6 ? 'O parceiro passa para o Nível ' + (n + 1) + ' na hora.' : 'A trilha fica completa.' }; };
  if (k === 'agendar_diagnostico' || k === 'agendar_reuniao') {
    var q = v('tr-a-quando'); var d = q ? new Date(q) : null;
    if (!d || isNaN(d.getTime())) return { erro: 'Escolha a data e a hora.' };
    corpo.quando = d.toISOString();
    if (k === 'agendar_diagnostico') {
      var link = v('tr-a-link');
      if (link && !/^https:\/\/\S+\.\S+$/i.test(link)) return { erro: 'O link precisa começar com https://' };
      if (link) corpo.link = link;
    }
  } else if (k === 'diagnostico_feito') {
    var r = form.querySelector('input[name="tr-a-res"]:checked');
    if (!r) return { erro: 'Escolha Aprovado ou Ainda não.' };
    corpo.resultado = r.value;
    var plano = v('tr-a-plano'); if (plano) corpo.plano = plano;
    if (r.value === 'aprovado') muda = fecha(2);
  } else if (k === 'mentoria_encontro') {
    if ((num((f.preparo || {}).encontros) || 0) + 1 >= 4) muda = fecha(3);
  } else if (k === 'reuniao_feita') {
    var o = v('tr-a-obs'); if (o) corpo.obs = o;
    muda = fecha(4);
  } else if (k === 'promover_regional') {
    muda = fecha(6);
  } else if (k === 'avancar') {
    var m = v('tr-a-motivo');
    if (m.length < 3) return { erro: 'Escreva o motivo. Ele fica no histórico.' };
    corpo.motivo = m;
    muda = fecha(pat);
  } else if (k === 'responsavel') {
    var e = v('tr-a-email');
    if (!/^\S+@\S+\.\S+$/.test(e)) return { erro: 'Confira o e-mail.' };
    corpo.email = e.toLowerCase();
  } else if (k === 'obs') {
    var t = v('tr-a-texto');
    if (!t) return { erro: 'Escreva a observação.' };
    corpo.texto = t;
  }
  return { corpo: corpo, muda: muda };
}
var ERRO_ACAO = {
  sem_pedido_pendente: 'Não há pedido em aberto para isso.', sem_pedido: 'O parceiro ainda não pediu.', ja_concluido: 'Esse passo já foi concluído.',
  etapa_anterior: 'Falta concluir o nível anterior.', formato_invalido: 'O parceiro não escolheu a mentoria.', ja_registrado: 'Isso já está registrado.',
  encontros_completos: 'Os 4 encontros já foram registrados.', termo_pendente: 'O parceiro ainda não aceitou o termo.',
  patamar_automatico: 'O Nível 5 fecha sozinho com o 1º pedido confirmado.', motivo_obrigatorio: 'Escreva o motivo.',
  acao_invalida: 'Confira os campos e tente de novo.', trilha_desligada: 'A trilha está desligada.', parceiro_nao_encontrado: 'Parceiro não encontrado.'
};
function enviarAcao(corpo) {
  var id = T.fichaId;
  T.salvando = true; T.erroAcao = '';
  desenharFicha();
  var feito = function () {
    T.salvando = false; T.acao = null; T.confirmar = null;
    U.toast(T.exemplo ? 'Feito no exemplo. Nada foi gravado.' : 'Salvo.');
  };
  if (T.exemplo) {
    aplicarNoExemplo(id, corpo);
    feito(); desenharFicha();
    if (raizLista()) desenharVisao();
    T.mapa = null;
    return;
  }
  U.api('PATCH', '/trilha/' + encodeURIComponent(id), corpo).then(function (x) {
    if (x.status >= 200 && x.status < 300) {
      feito();
      var j = x.json && (x.json.ficha || x.json);
      var fresca = j && (j.historico || j.raio_x) ? Promise.resolve(T.ficha = j) : buscarFicha(id);
      T.mapa = null;
      return Promise.all([fresca, carregarLista(true)]).then(function () {
        if (String(T.fichaId) === String(id)) desenharFicha();
        if (U.aba() === 'trilha') desenharVisao();
      });
    }
    T.salvando = false;
    T.erroAcao = (x.json && (ERRO_ACAO[x.json.erro] || x.json.mensagem)) || U.textoDoErro(x);
    desenharFicha();
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    T.salvando = false; T.erroAcao = 'Sem conexão. Nada foi salvo.';
    desenharFicha();
  });
}

/* Passos: os 6 patamares e o que aconteceu dentro de cada um, com data. */
function blocoPassos(f, pat) {
  var d = f.diagnostico || {}, pr = f.preparo || {}, re = f.reuniao || {}, rx = f.raio_x || {}, te = f.termo || {}, par = f.parceiro || {};
  var ac = pr.academia || {};
  var subs = {
    1: [['Raio-X enviado', rx.enviado_em ? dt(rx.enviado_em) + (num(rx.nota) != null ? ', nota ' + num(rx.nota) : '') : '']],
    2: [['Diagnóstico pedido', dt(d.pedido_em)], ['Agendado para', dt(d.agendado_para, true)],
        ['Diagnóstico feito', d.feito_em ? dt(d.feito_em) + (d.resultado ? (d.resultado === 'aprovado' ? ', aprovado' : ', ainda não') : '') : '']],
    3: [['Formato', pr.formato === 'mentoria' ? 'Mentoria' : (pr.formato === 'academia' ? 'Academia' : '')]].concat(
        pr.formato === 'academia'
          ? [['Aulas certas', (num(ac.feitas) || 0) + ' de ' + (num(ac.meta) || 12)]]
          : [['Mentoria paga', dt(pr.mentoria_paga_em)], ['Encontros', pr.mentoria_paga_em ? (num(pr.encontros) || 0) + ' de ' + (num(pr.encontros_meta) || 4) : '']]),
    4: [['Termo aceito', te.aceito ? (dt(te.aceito_em || te.em) || 'Sim') + (te.versao ? ', ' + te.versao : '') : ''], ['Reunião pedida', dt(re.pedida_em)],
        ['Agendada para', dt(re.agendada_para, true)], ['Reunião feita', dt(re.feita_em)]],
    5: [['Carregadores comprados', num(par.carregadores_comprados) ? fmtN(par.carregadores_comprados) : '']],
    6: [['Promovido', dt(fichaG(f, 'regional_em'))]]
  };
  var h = '<div class="tr-cx"><h3>Passos</h3><ol class="tr-passos">';
  for (var n = 1; n <= 6; n++) {
    var em = etapaEm(f, n), feito = !!em || n < pat, agora = n === pat;
    h += '<li class="pt ' + (feito ? 'feito' : (agora ? 'agora' : '')) + '"><span class="ic">' + ic(feito ? 'check' : (agora ? 'ponto' : 'cadeado')) + '</span>' +
      '<span>' + n + '. ' + esc(PATAMARES[n]) + '</span><span class="dt">' + (em ? esc(dt(em)) : (agora ? 'Agora' : (feito ? 'Feito' : ''))) + '</span></li>';
    if (feito || agora) {
      subs[n].forEach(function (s) {
        if (!s[1] && !agora) return;
        h += '<li class="sub-p"><span>' + esc(s[0]) + '</span><span class="dt">' + (s[1] ? esc(s[1]) : 'Falta') + '</span></li>';
      });
    }
  }
  return h + '</ol></div>';
}
function blocoNota(f) {
  var o = fichaG(f, 'obs_equipe');
  if (!o) return '';
  return '<div class="tr-cx"><h3>Nota da equipe</h3><p style="margin:0;white-space:pre-wrap;line-height:1.5;overflow-wrap:anywhere">' + esc(o) + '</p></div>';
}

function chips(lista) {
  lista = lista.filter(Boolean);
  if (!lista.length) return '<span class="tr-chip vz">Não respondeu</span>';
  return lista.map(function (t) { return '<span class="tr-chip">' + esc(t) + '</span>'; }).join('');
}
function rot(mapa, v) { return v == null || v === '' ? '' : (RX[mapa][v] || String(v)); }
function blocoRaioX(f) {
  var rx = f.raio_x || {}, r = rx.respostas || {};
  var nota = num(rx.nota);
  var pct = nota == null ? 0 : Math.max(0, Math.min(100, nota));
  var faltas = Array.isArray(rx.faltas) ? rx.faltas : [];
  var h = '<div class="tr-cx"><h3>Raio-X ' + aj('Passa com nota 80. Tudo o que o parceiro respondeu, do jeito que respondeu.') +
    '<span class="dir">' + (rx.enviado_em ? 'Enviado em ' + esc(dt(rx.enviado_em)) : 'Não enviado') + '</span></h3>' +
    '<div class="tr-rx-topo"><div class="tr-rx-n num' + (nota != null && nota >= 80 ? ' ok' : '') + '">' + (nota == null ? '0' : nota) + '<small>De 100</small></div>' +
    '<div><div class="tr-regua" role="img" aria-label="Nota ' + (nota == null ? 0 : nota) + ' de 100, passa com 80"><i class="' + (pct >= 80 ? 'ok' : '') + '" style="width:' + pct + '%"></i><b></b></div>' +
    '<div class="tr-regua-t"><span>0</span><span>Passa com 80</span></div></div></div>' +
    '<div class="tr-rx-g">' +
      '<div><span class="k">Experiência</span><div class="tr-chips">' + chips([rot('anos_solar', r.anos_solar), rot('usinas', r.usinas), rot('equipe', r.equipe), num(r.raio_km) ? 'Atende ' + fmtN(r.raio_km) + ' km' : '']) + '</div></div>' +
      '<div><span class="k">Sabe fazer</span><div class="tr-chips">' + chips((r.capacidades || []).map(function (c) { return rot('capacidades', c); })) + '</div></div>' +
      '<div><span class="k">Mercado</span><div class="tr-chips">' + chips([rot('ja_montou_eletroposto', r.ja_montou_eletroposto), rot('conhece_mercado', r.conhece_mercado), rot('papel', r.papel), r.quando ? 'Quer entrar: ' + rot('quando', r.quando).toLowerCase() : '']) + '</div></div>' +
      '<div><span class="k">Dificuldades</span><div class="tr-chips">' + chips((r.dificuldades || []).map(function (c) { return rot('dificuldades', c); })) + '</div></div>' +
    '</div>';
  if (faltas.length && !rx.enviado_em) {
    h += '<p class="tr-faltas"><b>Falta para passar:</b> ' + faltas.map(function (x) {
      return esc(x.texto || x.item) + (num(x.pontos) ? ' (+' + num(x.pontos) + ')' : '');
    }).join(', ') + '.</p>';
  }
  return h + '</div>';
}
function blocoCarteira(f) {
  var r = (f.raio_x || {}).respostas || {};
  var clis = Array.isArray(r.clientes_em_vista) ? r.clientes_em_vista : [];
  var dem = num(r.demanda_12m);
  var h = '<div class="tr-cx"><h3>Carteira e demanda ' + aj('Clientes que ele já tem em vista e quantos carregadores acha que fecha em 12 meses.') + '</h3>' +
    '<div class="tr-dem"><strong class="num">' + (dem == null ? 'Sem dado' : fmtN(dem)) + '</strong><span>' + (dem == null ? '' : (dem === 1 ? 'Carregador' : 'Carregadores') + ' em 12 meses') + '</span></div>';
  if (!clis.length) return h + '<p class="vz">Nenhum cliente em vista.</p></div>';
  return h + '<div class="tr-clis">' + clis.map(function (c) {
    return '<div class="tr-cli"><b>' + esc(c.nome || 'Cliente sem nome') + '</b>' +
      '<span class="peq">' + esc([cidadeUf(c.cidade, c.uf), rot('tipo_local', c.tipo_local)].filter(Boolean).join(' · ')) + '</span>' +
      (c.fase ? '<span class="pill ' + (FASE_COR[c.fase] || '') + '">' + esc(rot('fase', c.fase)) + '</span>' : '') + '</div>';
  }).join('') + '</div></div>';
}
var RES_ROT = { receita_mes: 'Receita por mês', lucro_mes: 'Lucro por mês', payback_meses: 'Retorno em meses', kwh_dia: 'kWh por dia', recargas_mes: 'Recargas por mês', investimento: 'Investimento' };
function valorRes(k, v) {
  var n = num(v);
  if (n == null) return String(v);
  if (/receita|lucro|invest|valor|custo|economia/.test(k)) return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
function blocoSimulacao(f) {
  var s = ((f.raio_x || {}).respostas || {}).simulacao;
  var h = '<div class="tr-cx"><h3>Simulação ' + aj('Conta que o parceiro fez no simulador, para um cliente dele. Não é preço de parceiro.') + '</h3>';
  if (!s || !num(s.kwh_mes)) return h + '<p class="vz">Não fez a simulação.</p></div>';
  var kv = [['Local', rot('tipo_local', s.tipo_local)], ['Modelo', s.modelo || ''], ['Energia por mês', fmtN(s.kwh_mes) + ' kWh'],
    ['Preço do kWh', num(s.preco_kwh) != null ? 'R$ ' + num(s.preco_kwh).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '']];
  var res = s.resultado && typeof s.resultado === 'object' ? s.resultado : {};
  Object.keys(res).slice(0, 6).forEach(function (k) {
    if (res[k] == null || typeof res[k] === 'object') return;
    kv.push([RES_ROT[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')), valorRes(k, res[k])]);
  });
  return h + '<div class="tr-kv">' + kv.filter(function (x) { return x[1]; }).map(function (x) {
    return '<div><div class="k">' + esc(x[0]) + '</div><div class="v num">' + esc(x[1]) + '</div></div>';
  }).join('') + '</div></div>';
}
function blocoSolarDoc(f) {
  var p = f.prefill || {};
  var kv = [['Empresa', p.empresa], ['CNPJ', p.cnpj], ['Cidade', cidadeUf(p.cidade, p.uf)], ['Logo', p.tem_logo == null ? '' : (p.tem_logo ? 'Tem' : 'Não tem')],
    ['Engenheiro com CREA', p.engenheiro_crea == null ? '' : (p.engenheiro_crea ? 'Sim' : 'Não')],
    ['Clientes PJ', Array.isArray(p.clientes_pj) ? fmtN(p.clientes_pj.length) : ''], ['Propostas solares', num(p.propostas_solares) != null ? fmtN(p.propostas_solares) : '']];
  kv = kv.filter(function (x) { return x[1] != null && x[1] !== ''; });
  if (!kv.length) return '';
  return '<div class="tr-cx"><h3>Veio da SolarDoc ' + aj('Dados que a SolarDoc já tinha. O parceiro só confirmou.') + '</h3><div class="tr-kv">' + kv.map(function (x) {
    return '<div><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>';
  }).join('') + '</div></div>';
}

/* Histórico: tudo, em ordem de data. */
var HF = [['tudo', 'Tudo'], ['parceiro', 'Parceiro'], ['equipe', 'Equipe'], ['sistema', 'Sistema']];
function quemDe(h) {
  var a = String(h.autor || '').toLowerCase();
  if (a === 'parceiro' || a === 'voce' || a === 'você') return 'parceiro';
  if (a === 'sistema' || !a) return 'sistema';
  return 'equipe';
}
function visualEvento(tipo, dados) {
  var t = String(tipo || '');
  if (/raio/.test(t)) return ['radar', /enviad/.test(t) ? 'ok' : ''];
  if (/diag/.test(t)) return /feito/.test(t) ? ['video', dados && dados.resultado === 'ainda_nao' ? 'av' : 'ok'] : ['cal', 'az'];
  if (/mentoria|academia|preparo|aula/.test(t)) return ['capelo', /encontro|aula/.test(t) ? 'ok' : 'az'];
  if (/termo/.test(t)) return ['caneta', 'ok'];
  if (/reuniao/.test(t)) return /feita/.test(t) ? ['gente', 'ok'] : ['cal', 'az'];
  if (/pedido/.test(t)) return ['carrinho', 'av'];
  if (/regional|promov/.test(t)) return ['estrela', 'ok'];
  if (/avanc|patamar/.test(t)) return ['seta', /avanc/.test(t) ? 'av' : 'ok'];
  if (/respons/.test(t)) return ['pessoa', ''];
  if (/obs|nota/.test(t)) return ['nota', 'av'];
  return ['ponto', ''];
}
var DADOS_EV = [['motivo', 'Motivo'], ['plano', 'Plano'], ['obs', 'Como foi'], ['link', 'Link']];
function blocoHistorico(hist) {
  var l = hist.slice().sort(function (a, b) { return String(a.em || '').localeCompare(String(b.em || '')); });
  var cont = { tudo: l.length, parceiro: 0, equipe: 0, sistema: 0 };
  l.forEach(function (h) { cont[quemDe(h)]++; });
  var vis = T.hist === 'tudo' ? l : l.filter(function (h) { return quemDe(h) === T.hist; });
  var h = '<div class="tr-cx"><h3>Histórico <span class="dir">' + (l.length === 1 ? '1 evento' : l.length + ' eventos') + '</span></h3>' +
    '<div class="tr-hf" role="group" aria-label="Filtrar o histórico">' + HF.map(function (x) {
      return '<button type="button" data-tr="hist" data-v="' + x[0] + '" aria-pressed="' + (T.hist === x[0]) + '">' + x[1] + ' <span class="num">' + cont[x[0]] + '</span></button>';
    }).join('') + '</div>';
  if (!vis.length) return h + '<p class="vz">Nada aqui ainda.</p></div>';
  return h + '<ol class="tr-tl">' + vis.map(function (ev) {
    var dd = ev.dados || {}, vz = visualEvento(ev.tipo, dd), quem = quemDe(ev);
    var autor = quem === 'parceiro' ? 'Parceiro' : (quem === 'sistema' ? 'Sistema' : (String(ev.autor).indexOf('@') > 0 ? emailCurto(ev.autor) : 'Equipe'));
    var extra = '';
    if (dd.texto && /obs|nota/.test(ev.tipo)) extra += '<div class="nota">' + esc(dd.texto) + '</div>';
    DADOS_EV.forEach(function (k) { if (dd[k[0]]) extra += '<p><b>' + k[1] + ':</b> ' + esc(String(dd[k[0]]).slice(0, 600)) + '</p>'; });
    return '<li class="tr-ev ' + vz[1] + '"><span class="ib">' + ic(vz[0]) + '</span><div>' +
      '<h4>' + esc(tituloEvento(ev)) + '</h4>' +
      '<div class="meta">' + esc(dt(ev.em, true)) + ' · <b>' + esc(autor) + '</b></div>' + extra + '</div></li>';
  }).join('') + '</ol></div>';
}
function tituloEvento(ev) {
  var d = ev.dados || {}, t = String(ev.tipo || '');
  var n = Math.round(Number(d.patamar));
  if (t === 'patamar_concluido' && PATAMARES[n]) return 'Nível ' + n + ' concluído: ' + PATAMARES[n];
  if (t === 'avancar' && PATAMARES[n]) return 'Nível ' + n + ' fechado pela equipe';
  if (t === 'mentoria_encontro' && num(d.numero)) return 'Encontro ' + num(d.numero) + ' de 4 da mentoria';
  if (t === 'diagnostico_feito' && d.resultado) return d.resultado === 'aprovado' ? 'Diagnóstico: aprovado para seguir' : 'Diagnóstico: ainda não';
  if ((t === 'diagnostico_agendado' || t === 'reuniao_agendada') && d.quando) return (t === 'reuniao_agendada' ? 'Reunião com o cliente' : 'Diagnóstico') + ' agendado para ' + dt(d.quando, true);
  if (t === 'responsavel' && d.email) return 'Responsável agora é ' + emailCurto(d.email);
  return ev.titulo || tituloPadrao(t);
}
function tituloPadrao(t) { t = String(t || 'Evento').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }

/* ═════════════ Mapa de demanda ═════════════ */
// Brasil em ladrilhos: [linha, coluna] de cada UF numa grade de 6 colunas.
var BR = { RR: [0, 1], AP: [0, 3], AM: [1, 1], PA: [1, 2], MA: [1, 3], CE: [1, 4], RN: [1, 5], AC: [2, 0], RO: [2, 1], TO: [2, 2], PI: [2, 3], PE: [2, 4], PB: [2, 5],
  MT: [3, 1], GO: [3, 2], BA: [3, 3], SE: [3, 4], AL: [3, 5], MS: [4, 1], DF: [4, 2], MG: [4, 3], ES: [4, 4], PR: [5, 1], SP: [5, 2], RJ: [5, 3], SC: [6, 1], RS: [7, 1] };
function barras(pares, classe) {
  pares = pares.filter(function (p) { return p[1] > 0; });
  if (!pares.length) return '<p class="vz">Sem dado ainda.</p>';
  var max = Math.max.apply(null, pares.map(function (p) { return p[1]; }));
  return '<div class="tr-hb ' + (classe || '') + '">' + pares.map(function (p) {
    return '<div><span class="t">' + esc(p[0]) + '</span><span class="b" role="img" aria-label="' + esc(p[0] + ': ' + p[1]) + '"><i style="width:' + Math.max(3, Math.round(p[1] / max * 100)) + '%"></i></span><span class="n">' + fmtN(p[1]) + '</span></div>';
  }).join('') + '</div>';
}
function ordenado(obj, mapa) {
  return Object.keys(obj).map(function (k) { return [mapa ? (mapa[k] || tituloPadrao(k)) : k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
}
function desenharMapa() {
  var r = raizMapa(); if (!r) return;
  if (T.exemplo) usarExemplo();
  if (!T.exemplo && T.ligada === false) { r.innerHTML = telaOff('mapa'); return; }
  var M = T.mapa;
  if (!M) { r.innerHTML = telaErro(T.erroMapa || 'Não consegui carregar o mapa.', 'mapa'); return; }
  var dem = 0, clis = 0, parc = 0;
  M.por_uf.forEach(function (u) { dem += u.demanda_12m; clis += u.clientes_em_vista; });
  Object.keys(M.por_patamar).forEach(function (k) { parc += M.por_patamar[k]; });
  var nRx = M.total_raio_x != null ? M.total_raio_x : M.por_uf.reduce(function (s, u) { return s + u.parceiros; }, 0);

  var maxD = Math.max.apply(null, [1].concat(M.por_uf.map(function (u) { return u.demanda_12m; })));
  var porUf = {}; M.por_uf.forEach(function (u) { porUf[u.uf] = u; });
  var ladr = Object.keys(BR).map(function (uf) {
    var u = porUf[uf], pos = 'grid-row:' + (BR[uf][0] + 1) + ';grid-column:' + (BR[uf][1] + 1);
    if (!u || !u.parceiros) return '<div class="tr-uf" style="' + pos + '" aria-hidden="true">' + uf + '</div>';
    var n = u.demanda_12m ? Math.max(1, Math.min(3, Math.ceil(u.demanda_12m / maxD * 3))) : 1;
    return '<button type="button" class="tr-uf n' + n + '" style="' + pos + '" data-tr="uf" data-v="' + uf + '" aria-label="' + esc(uf + ': ' + u.demanda_12m + ' carregadores em 12 meses, ' + u.parceiros + ' parceiros. Ver na Trilha') + '">' +
      uf + '<small class="num">' + fmtN(u.demanda_12m) + '</small></button>';
  }).join('');
  var linhasUf = M.por_uf.slice().sort(function (a, b) { return b.demanda_12m - a.demanda_12m || b.parceiros - a.parceiros; });
  var tabela = linhasUf.length ? '<div class="tab-rola"><table class="tr-tab"><thead><tr><th scope="col">UF</th><th scope="col" class="n">Parceiros</th><th scope="col" class="n">Carregadores</th><th scope="col" class="n">Clientes</th></tr></thead><tbody>' +
    linhasUf.map(function (u) {
      return '<tr><th scope="row">' + esc(u.uf === 'SEM_UF' ? 'Sem UF' : u.uf) + '</th><td class="n">' + fmtN(u.parceiros) + '</td><td class="n">' + fmtN(u.demanda_12m) + '</td><td class="n">' + fmtN(u.clientes_em_vista) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="vz">Ninguém informou a UF ainda.</p>';

  var fases = M.fases, totF = (fases.ideia || 0) + (fases.conversando || 0) + (fases.quente || 0);
  var split = totF ? '<div class="tr-split" role="img" aria-label="' + esc(['quente', 'conversando', 'ideia'].map(function (k) { return RX.fase[k] + ': ' + (fases[k] || 0); }).join(', ')) + '">' +
    ['quente', 'conversando', 'ideia'].map(function (k) {
      var n = fases[k] || 0; if (!n) return '';
      var w = n / totF * 100;
      return '<div class="f-' + k + '" style="width:' + w + '%">' + (w >= 14 ? fmtN(n) : '') + '</div>';
    }).join('') + '</div><div class="tr-split-leg">' + ['quente', 'conversando', 'ideia'].map(function (k) {
      return '<span>' + RX.fase[k] + ' <b class="num">' + fmtN(fases[k] || 0) + '</b></span>';
    }).join('') + '</div>' : '<p class="vz">Sem cliente em vista ainda.</p>';

  r.innerHTML = (T.exemplo ? faixaExemplo() : '') +
    '<div class="tr-valor"><span class="big num">' + fmtN(dem) + '</span>' +
      '<p><b>Carregadores previstos em 12 meses</b>Soma de ' + (nRx === 1 ? '1 Raio-X' : fmtN(nRx) + ' Raio-X') + '</p>' +
      '<div class="mini"><div><strong class="num">' + fmtN(clis) + '</strong><span>Clientes em vista</span></div><div><strong class="num">' + fmtN(parc) + '</strong><span>Na trilha</span></div>' +
      aj('Cada parceiro diz no Raio-X quantos carregadores fecha em 12 meses. Aqui é a soma de todos.') + '</div></div>' +
    '<div class="tr-mg"><div class="tr-f-col">' +
      '<div class="tr-cx"><h3>Onde está a demanda ' + aj('Cor mais forte, mais carregadores previstos. Toque num estado para ver os parceiros dele.') + '</h3>' +
        '<div class="tr-br">' + ladr + '</div>' +
        '<div class="tr-leg" aria-hidden="true"><span>Menos</span><i class="n1"></i><i class="n2"></i><i class="n3"></i><span>Mais</span></div>' + tabela + '</div>' +
      '<div class="tr-cx"><h3>Fase da carteira ' + aj('Os clientes em vista de todos os parceiros, pela fase da conversa.') + '</h3>' + split + '</div>' +
    '</div><div class="tr-f-col">' +
      '<div class="tr-cx"><h3>Parceiros por nível</h3>' + barras([1, 2, 3, 4, 5, 6, 7].map(function (k) { return [(k < 7 ? k + '. ' : '') + PATAMARES[k], M.por_patamar[k] || 0]; })) + '</div>' +
      '<div class="tr-cx"><h3>Tipo de local ' + aj('Dos clientes em vista. Diz que carregador e que material mais vão pedir.') + '</h3>' + barras(ordenado(M.por_tipo_local, RX.tipo_local), 'esc') + '</div>' +
      '<div class="tr-cx"><h3>Quando querem entrar</h3>' + barras(['agora', '3m', '6m', 'sem_pressa'].map(function (k) { return [RX.quando[k], M.quando[k] || 0]; })) + '</div>' +
      '<div class="tr-cx"><h3>Dificuldades mais citadas ' + aj('Cada parceiro marca até 3.') + '</h3>' + barras(ordenado(M.dificuldades, RX.dificuldades), 'esc') + '</div>' +
    '</div></div>';
}

/* ═════════════ Exemplo (dados fictícios) ═════════════ */
function diasAtras(d, hora) {
  var t = new Date(Date.now() - d * 86400000);
  if (hora != null) t.setHours(Math.floor(hora), Math.round((hora % 1) * 60), 0, 0);
  return t.toISOString();
}
function notaDe(r) {
  var f = [], n = 10;
  var tem = function (k) { return r[k] != null && r[k] !== '' && !(Array.isArray(r[k]) && !r[k].length); };
  if (tem('anos_solar') && tem('usinas') && tem('equipe') && tem('raio_km')) n += 15; else f.push({ item: 'experiencia', pontos: 15, texto: 'Experiência' });
  if (tem('capacidades')) n += 10; else f.push({ item: 'capacidades', pontos: 10, texto: 'O que sabe fazer' });
  if (tem('ja_montou_eletroposto') && tem('conhece_mercado') && tem('papel') && tem('quando')) n += 15; else f.push({ item: 'mercado', pontos: 15, texto: 'Mercado' });
  if (tem('dificuldades')) n += 5; else f.push({ item: 'dificuldades', pontos: 5, texto: 'Dificuldades' });
  var c = (r.clientes_em_vista || []).length;
  if (c >= 2) n += 20; else if (c === 1) { n += 15; f.push({ item: 'carteira', pontos: 5, texto: 'Mais um cliente em vista' }); } else f.push({ item: 'carteira', pontos: 20, texto: 'Clientes em vista' });
  if (num(r.demanda_12m) > 0) n += 10; else f.push({ item: 'demanda', pontos: 10, texto: 'Demanda em 12 meses' });
  if (r.simulacao && num(r.simulacao.kwh_mes) > 0) n += 15; else f.push({ item: 'simulacao', pontos: 15, texto: 'Simulação' });
  return { nota: n, faltas: f };
}
function cli(nome, cidade, uf, tipo, fase) { return { nome: nome, cidade: cidade, uf: uf, tipo_local: tipo, fase: fase }; }
function sim(tipo, modelo, kwh, preco) {
  var receita = Math.round(kwh * preco);
  return { tipo_local: tipo, modelo: modelo, kwh_mes: kwh, preco_kwh: preco, resultado: { receita_mes: receita, recargas_mes: Math.round(kwh / 28), payback_meses: Math.round(150000 / (receita * 0.55)) } };
}
var EQ = ['ana@exemplo.com', 'bruno@exemplo.com', 'carla@exemplo.com'];
var DEFS = [
  { id: 'ex-01', empresa: 'Volt Sul Energia Solar', cidade: 'Uberlândia', uf: 'MG', pat: 3, assina: true, inicio: 26, parado: 1, resp: 0, formato: 'mentoria', paga: true, encontros: 3,
    r: { anos_solar: '3-5', usinas: '100-500', equipe: '6-15', raio_km: 300, capacidades: ['eletrica_bt', 'engenharia_art', 'homologacao'], ja_montou_eletroposto: 'nunca', conhece_mercado: 'pouco', papel: 'ambos', quando: 'agora',
      dificuldades: ['preco', 'financiamento'], clientes_em_vista: [cli('Posto Cerrado', 'Uberlândia', 'MG', 'posto', 'quente'), cli('Supermercado Bom Preço', 'Araguari', 'MG', 'empresa_frota', 'conversando'), cli('Hotel Serra Azul', 'Uberaba', 'MG', 'hotel', 'ideia')],
      demanda_12m: 6, simulacao: sim('posto', 'DC 80 kW', 9000, 2.1) }, obs: 'Quatro montadores, sem obra DC ainda. Começa pelo Posto Cerrado.' },
  { id: 'ex-02', empresa: 'Raio Forte Energia', cidade: 'Campo Grande', uf: 'MS', pat: 4, assina: true, inicio: 34, parado: 2, resp: 1, formato: 'academia', aulas: 12, reuniaoPedida: true,
    r: { anos_solar: '5+', usinas: '500+', equipe: '16+', raio_km: 400, capacidades: ['eletrica_bt', 'eletrica_mt', 'engenharia_art', 'obra_civil', 'homologacao'], ja_montou_eletroposto: '1-2', conhece_mercado: 'bem', papel: 'montagem', quando: 'agora',
      dificuldades: ['cliente'], clientes_em_vista: [cli('Frota Pantanal Transportes', 'Campo Grande', 'MS', 'empresa_frota', 'quente')],
      demanda_12m: 10, simulacao: sim('empresa_frota', 'DC 120 kW', 15000, 1.9) } },
  { id: 'ex-03', empresa: 'Sol do Vale Energia', cidade: 'Montes Claros', uf: 'MG', pat: 5, assina: true, inicio: 41, parado: 3, resp: 0, formato: 'mentoria', paga: true, encontros: 4, reuniaoFeita: true,
    r: { anos_solar: '3-5', usinas: '100-500', equipe: '6-15', raio_km: 250, capacidades: ['eletrica_bt', 'engenharia_art'], ja_montou_eletroposto: 'nunca', conhece_mercado: 'pouco', papel: 'revenda', quando: '3m',
      dificuldades: ['financiamento', 'tecnica'], clientes_em_vista: [cli('Posto Avenida', 'Montes Claros', 'MG', 'posto', 'quente'), cli('Restaurante Sertão', 'Bocaiuva', 'MG', 'restaurante', 'conversando')],
      demanda_12m: 4 } },
  { id: 'ex-04', empresa: 'SolTech Integração', cidade: 'Ribeirão Preto', uf: 'SP', pat: 2, assina: true, inicio: 16, parado: 9, resp: 2, diagPedido: true,
    r: { anos_solar: '1-3', usinas: '20-100', equipe: '3-5', raio_km: 150, capacidades: ['eletrica_bt', 'homologacao'], ja_montou_eletroposto: 'nunca', conhece_mercado: 'nada', papel: 'revenda', quando: '3m',
      dificuldades: ['cliente', 'financiamento', 'tecnica'], clientes_em_vista: [cli('Mercado Real', 'Ribeirão Preto', 'SP', 'empresa_frota', 'conversando'), cli('Mercado Popular', 'Sertãozinho', 'SP', 'outro', 'ideia')],
      demanda_12m: 3, simulacao: sim('outro', 'AC 22 kW', 2500, 1.8) } },
  { id: 'ex-05', empresa: 'Lumen Engenharia Solar', cidade: 'Goiânia', uf: 'GO', pat: 1, assina: false, inicio: 15, parado: 14, resp: -1,
    r: { anos_solar: '1-3', usinas: '20-100', equipe: '3-5', raio_km: 120, capacidades: ['engenharia_art'], ja_montou_eletroposto: 'nunca', conhece_mercado: 'pouco', papel: 'ambos', quando: '6m',
      dificuldades: ['tempo'], clientes_em_vista: [], demanda_12m: 2 } },
  { id: 'ex-06', empresa: 'Cerrado Sol Energia', cidade: 'Brasília', uf: 'DF', pat: 2, assina: true, inicio: 9, parado: 0, resp: 1, diagPedido: true, diagHoje: true,
    r: { anos_solar: '5+', usinas: '100-500', equipe: '6-15', raio_km: 200, capacidades: ['eletrica_bt', 'eletrica_mt', 'engenharia_art'], ja_montou_eletroposto: '1-2', conhece_mercado: 'pouco', papel: 'ambos', quando: 'agora',
      dificuldades: [], clientes_em_vista: [cli('Condomínio Lago Norte', 'Brasília', 'DF', 'condominio', 'quente'), cli('Estacionamento Central', 'Brasília', 'DF', 'estacionamento', 'conversando'), cli('Hotel Planalto', 'Brasília', 'DF', 'hotel', 'ideia')],
      demanda_12m: 8, simulacao: sim('condominio', 'AC 22 kW', 4000, 2.3) } },
  { id: 'ex-07', empresa: 'Paraná Fotovoltaica', cidade: 'Londrina', uf: 'PR', pat: 3, assina: true, inicio: 22, parado: 5, resp: 2, formato: 'academia', aulas: 7,
    r: { anos_solar: '3-5', usinas: '100-500', equipe: '3-5', raio_km: 180, capacidades: ['eletrica_bt', 'homologacao'], ja_montou_eletroposto: 'nunca', conhece_mercado: 'pouco', papel: 'revenda', quando: '3m',
      dificuldades: [], clientes_em_vista: [cli('Posto Rodovia 369', 'Cambé', 'PR', 'posto', 'conversando')],
      demanda_12m: 3, simulacao: sim('posto', 'DC 80 kW', 6000, 2.0) } },
  { id: 'ex-08', empresa: 'Litoral Solar', cidade: 'Joinville', uf: 'SC', pat: 1, assina: false, inicio: 5, parado: 4, resp: -1,
    r: { anos_solar: '0-1', usinas: '0-20', equipe: '1-2', capacidades: ['eletrica_bt'], dificuldades: ['cliente', 'tecnica'], clientes_em_vista: [] } },
  { id: 'ex-09', empresa: 'Bahia Luz Integradora', cidade: 'Feira de Santana', uf: 'BA', pat: 6, assina: true, inicio: 58, parado: 6, resp: 0, formato: 'mentoria', paga: true, encontros: 4, reuniaoFeita: true, compras: 2,
    r: { anos_solar: '5+', usinas: '500+', equipe: '16+', raio_km: 500, capacidades: ['eletrica_bt', 'eletrica_mt', 'engenharia_art', 'obra_civil', 'homologacao'], ja_montou_eletroposto: '3+', conhece_mercado: 'bem', papel: 'ambos', quando: 'agora',
      dificuldades: ['homologacao'], clientes_em_vista: [cli('Posto BR 116', 'Feira de Santana', 'BA', 'posto', 'quente'), cli('Atacadão Sertanejo', 'Feira de Santana', 'BA', 'empresa_frota', 'quente'), cli('Pousada do Recôncavo', 'Cachoeira', 'BA', 'hotel', 'conversando')],
      demanda_12m: 12, simulacao: sim('posto', 'DC 120 kW', 14000, 2.0) } },
  { id: 'ex-10', empresa: 'Norte Energia Limpa', cidade: 'Belém', uf: 'PA', pat: 1, assina: true, inicio: 21, parado: 21, resp: -1, semRx: true, r: {} },
  { id: 'ex-11', empresa: 'Pampa Sol Engenharia', cidade: 'Caxias do Sul', uf: 'RS', pat: 3, assina: true, inicio: 19, parado: 2, resp: 1, formato: 'mentoria', paga: true, encontros: 0,
    r: { anos_solar: '3-5', usinas: '20-100', equipe: '6-15', raio_km: 220, capacidades: ['eletrica_bt', 'engenharia_art', 'obra_civil'], ja_montou_eletroposto: 'nunca', conhece_mercado: 'pouco', papel: 'montagem', quando: '6m',
      dificuldades: ['financiamento'], clientes_em_vista: [cli('Vinícola Serra', 'Bento Gonçalves', 'RS', 'restaurante', 'conversando'), cli('Condomínio Jardins', 'Caxias do Sul', 'RS', 'condominio', 'ideia')],
      demanda_12m: 4 } },
  { id: 'ex-12', empresa: 'Horizonte Solar', cidade: 'Campinas', uf: 'SP', pat: 7, assina: true, inicio: 80, parado: 11, resp: 0, formato: 'mentoria', paga: true, encontros: 4, reuniaoFeita: true, compras: 6,
    r: { anos_solar: '5+', usinas: '500+', equipe: '16+', raio_km: 350, capacidades: ['eletrica_bt', 'eletrica_mt', 'engenharia_art', 'obra_civil', 'homologacao'], ja_montou_eletroposto: '3+', conhece_mercado: 'bem', papel: 'ambos', quando: 'agora',
      dificuldades: ['tempo'], clientes_em_vista: [cli('Rede de Postos Paulista', 'Campinas', 'SP', 'posto', 'quente'), cli('Shopping Dom', 'Campinas', 'SP', 'shopping', 'quente'), cli('Logística Anhanguera', 'Jundiaí', 'SP', 'empresa_frota', 'conversando')],
      demanda_12m: 18, simulacao: sim('shopping', 'DC 120 kW', 18000, 2.2) } }
];
function montarExemplo(d) {
  var r = JSON.parse(JSON.stringify(d.r || {}));
  var nf = notaDe(r);
  var f = {
    user_id: d.id, ligada: true, patamar: d.pat, assinante: d.assina, etapas: {},
    raio_x: { respostas: r, nota: d.semRx ? null : nf.nota, enviado_em: null, faltas: nf.faltas },
    diagnostico: {}, preparo: { encontros: 0, encontros_meta: 4, academia: { feitas: 0, meta: 12 } }, termo: { aceito: false }, reuniao: {},
    prefill: { empresa: d.empresa, cidade: d.cidade, uf: d.uf, tem_logo: d.pat > 1, engenheiro_crea: (r.capacidades || []).indexOf('engenharia_art') >= 0,
      clientes_pj: new Array(d.pat > 2 ? 14 : 4).join('.').split('.').map(function () { return {}; }), propostas_solares: d.pat * 23 + 7 },
    parceiro: { carregadores_comprados: d.compras || 0 },
    responsavel_email: d.resp >= 0 ? EQ[d.resp] : null, obs_equipe: d.obs || null, historico: []
  };
  var passos = [];
  var add = function (tipo, titulo, autor, dados, aplicar) { passos.push({ tipo: tipo, titulo: titulo, autor: autor, dados: dados || {}, aplicar: aplicar }); };
  var eq = f.responsavel_email || EQ[0];
  add('cadastro', 'Entrou no Portal do Parceiro', 'sistema');
  if (!d.semRx) add('raio_x_salvo', 'Começou o Raio-X', 'parceiro');
  if (d.pat >= 2) add('raio_x_enviado', 'Raio-X enviado, nota ' + nf.nota, 'parceiro', {}, function (em) { f.raio_x.enviado_em = em; f.etapas.p1 = { em: em }; });
  if (d.pat >= 2) add('diagnostico_pedido', 'Pediu o diagnóstico', 'parceiro', {}, function (em) {
    f.diagnostico.pedido_em = em; f.diagnostico.preferencia = { dias: [diasAtras(-1), diasAtras(-2)], periodo: 'manha' };
  });
  if (d.pat >= 3 || d.diagHoje) add('diagnostico_agendado', 'Diagnóstico agendado', eq, { link: 'https://meet.google.com/exemplo' }, function () {
    f.diagnostico.agendado_para = d.diagHoje ? diasAtras(0, 15) : diasAtras(d.inicio * 0.6, 10); f.diagnostico.link = 'https://meet.google.com/exemplo';
  });
  if (d.pat >= 3) add('diagnostico_feito', 'Diagnóstico: aprovado para seguir', eq, { resultado: 'aprovado', plano: 'Começar pelo cliente mais quente. Apoio na engenharia.' }, function (em) {
    f.diagnostico.feito_em = em; f.diagnostico.resultado = 'aprovado'; f.diagnostico.plano = 'Começar pelo cliente mais quente. Apoio na engenharia.'; f.etapas.p2 = { em: em };
  });
  if (d.pat >= 3) add('preparo_escolhido', d.formato === 'academia' ? 'Escolheu a Academia' : 'Escolheu a mentoria', 'parceiro', {}, function () { f.preparo.formato = d.formato; });
  if (d.paga) add('mentoria_paga', 'Mentoria paga', eq, {}, function (em) { f.preparo.mentoria_paga_em = em; });
  for (var i = 1; i <= (d.encontros || 0); i++) {
    (function (k) { add('mentoria_encontro', 'Encontro ' + k + ' de 4 da mentoria', eq, {}, function (em) { f.preparo.encontros = k; if (k === 4) f.etapas.p3 = { em: em }; }); })(i);
  }
  if (d.formato === 'academia' && d.aulas) add('academia_aula', d.aulas >= 12 ? 'Academia concluída, 12 de 12' : 'Aula ' + d.aulas + ' de 12 certa', 'parceiro', {}, function (em) {
    f.preparo.academia.feitas = d.aulas; if (d.aulas >= 12) f.etapas.p3 = { em: em };
  });
  if (d.pat >= 4) add('termo_aceito', 'Termo de Parceria v1 aceito', 'parceiro', {}, function (em) { f.termo = { aceito: true, versao: 'v1', aceito_em: em }; });
  var c0 = (r.clientes_em_vista || [])[0] || {};
  if (d.pat >= 4 && (d.reuniaoPedida || d.reuniaoFeita)) add('reuniao_pedida', 'Pediu reunião com ' + (c0.nome || 'o cliente'), 'parceiro', {}, function (em) {
    f.reuniao.pedida_em = em; f.reuniao.dados = { cliente_nome: c0.nome, cidade: c0.cidade, uf: c0.uf, tipo_local: c0.tipo_local };
  });
  if (d.reuniaoFeita) {
    add('reuniao_agendada', 'Reunião com o cliente agendada', eq, {}, function (em) { f.reuniao.agendada_para = em; });
    add('reuniao_feita', 'Reunião feita com ' + (c0.nome || 'o cliente'), eq, { obs: 'Cliente pediu proposta do DC.' }, function (em) { f.reuniao.feita_em = em; f.etapas.p4 = { em: em }; });
  }
  if (d.compras) add('pedido_confirmado', '1º pedido confirmado', 'sistema', {}, function (em) { f.etapas.p5 = { em: em }; });
  if (d.pat >= 7) add('promovido_regional', 'Promovido a Parceiro regional', eq, {}, function (em) { f.etapas.p6 = { em: em }; f.regional_em = em; });
  if (d.obs) add('obs', 'Observação', eq, { texto: d.obs });
  var n = passos.length;
  passos.forEach(function (p, k) {
    var dia = n === 1 ? d.parado : d.inicio - (d.inicio - d.parado) * (k / (n - 1));
    var em = diasAtras(dia, 9 + (k * 1.7) % 8);
    f.historico.push({ tipo: p.tipo, titulo: p.titulo, autor: p.autor, dados: p.dados, em: em });
    if (p.aplicar) p.aplicar(em);
  });
  f.ultimo_movimento_em = f.historico[f.historico.length - 1].em;
  return f;
}
function linhaDeFicha(f) {
  var r = f.raio_x.respostas || {}, pre = f.prefill;
  return { user_id: f.user_id, empresa: pre.empresa, cidade: pre.cidade, uf: pre.uf, patamar: f.patamar, nota: f.raio_x.nota, assinante: f.assinante,
    parado_ha_dias: diasDesde(f.ultimo_movimento_em), pendencia_equipe: pendenciaExemplo(f), responsavel_email: f.responsavel_email,
    demanda_12m: num(r.demanda_12m) || 0, clientes_em_vista: (r.clientes_em_vista || []).length };
}
function pendenciaExemplo(f) {
  var d = f.diagnostico, pr = f.preparo, re = f.reuniao;
  if (f.patamar === 2 && d.pedido_em && !d.agendado_para) return 'agendar_diagnostico';
  if (f.patamar === 2 && d.agendado_para && !d.feito_em && ehHoje(d.agendado_para)) return 'diagnostico_hoje';
  if (f.patamar === 3 && pr.mentoria_paga_em && (pr.encontros || 0) < 4) return 'registrar_encontro';
  if (f.patamar === 4 && re.pedida_em && !re.agendada_para) return 'agendar_reuniao';
  return null;
}
function mapaDeFichas(fichas) {
  var M = { por_patamar: {}, por_uf: [], por_tipo_local: {}, quando: {}, dificuldades: {}, fases: {}, total_raio_x: 0 };
  var ufs = {};
  fichas.forEach(function (f) {
    var r = f.raio_x.respostas || {}, uf = f.prefill.uf;
    M.por_patamar[f.patamar] = (M.por_patamar[f.patamar] || 0) + 1;
    if (f.raio_x.nota != null) M.total_raio_x++;
    var u = ufs[uf] || (ufs[uf] = { uf: uf, parceiros: 0, demanda_12m: 0, clientes_em_vista: 0 });
    u.parceiros++; u.demanda_12m += num(r.demanda_12m) || 0; u.clientes_em_vista += (r.clientes_em_vista || []).length;
    if (r.quando) M.quando[r.quando] = (M.quando[r.quando] || 0) + 1;
    (r.dificuldades || []).forEach(function (k) { M.dificuldades[k] = (M.dificuldades[k] || 0) + 1; });
    (r.clientes_em_vista || []).forEach(function (c) {
      if (c.tipo_local) M.por_tipo_local[c.tipo_local] = (M.por_tipo_local[c.tipo_local] || 0) + 1;
      if (c.fase) M.fases[c.fase] = (M.fases[c.fase] || 0) + 1;
    });
  });
  M.por_uf = Object.keys(ufs).map(function (k) { return ufs[k]; });
  return M;
}
function usarExemplo() {
  if (!EX) {
    EX = { fichas: {} };
    DEFS.forEach(function (d) { EX.fichas[d.id] = montarExemplo(d); });
  }
  var todas = Object.keys(EX.fichas).map(function (k) { return EX.fichas[k]; });
  T.lista = todas.map(linhaDeFicha);
  T.resumo = resumoDe(T.lista, null);
  T.mapa = mapaDeFichas(todas);
  marcarAba();
}
// Ação no exemplo: muda a cópia local do jeito que a api faria e grava o evento no histórico.
function aplicarNoExemplo(id, c) {
  var f = EX.fichas[id]; if (!f) return;
  var agora = new Date().toISOString(), eu = (U.eu() && U.eu().email) || 'voce@exemplo.com';
  var ev = function (tipo, titulo, dados) { f.historico.push({ tipo: tipo, titulo: titulo, autor: eu, dados: dados || {}, em: agora }); };
  var fechar = function (n) {
    f.etapas['p' + n] = { em: agora }; f.patamar = Math.min(7, n + 1);
    if (n === 6) f.regional_em = agora;
  };
  var a = c.acao;
  if (a === 'agendar_diagnostico') { f.diagnostico.agendado_para = c.quando; if (c.link) f.diagnostico.link = c.link; ev('diagnostico_agendado', 'Diagnóstico agendado para ' + dt(c.quando, true), { link: c.link }); }
  else if (a === 'diagnostico_feito') {
    f.diagnostico.feito_em = agora; f.diagnostico.resultado = c.resultado; if (c.plano) f.diagnostico.plano = c.plano;
    ev('diagnostico_feito', c.resultado === 'aprovado' ? 'Diagnóstico: aprovado para seguir' : 'Diagnóstico: ainda não', { resultado: c.resultado, plano: c.plano });
    if (c.resultado === 'aprovado') fechar(2);
  } else if (a === 'mentoria_paga') { f.preparo.mentoria_paga_em = agora; f.preparo.formato = f.preparo.formato || 'mentoria'; ev('mentoria_paga', 'Mentoria paga'); }
  else if (a === 'mentoria_encontro') {
    f.preparo.encontros = (f.preparo.encontros || 0) + 1;
    ev('mentoria_encontro', 'Encontro ' + f.preparo.encontros + ' de 4 da mentoria');
    if (f.preparo.encontros >= 4) fechar(3);
  } else if (a === 'agendar_reuniao') { f.reuniao.agendada_para = c.quando; ev('reuniao_agendada', 'Reunião com o cliente agendada para ' + dt(c.quando, true)); }
  else if (a === 'reuniao_feita') { f.reuniao.feita_em = agora; ev('reuniao_feita', 'Reunião com o cliente feita', { obs: c.obs }); fechar(4); }
  else if (a === 'promover_regional') { ev('promovido_regional', 'Promovido a Parceiro regional'); fechar(6); }
  else if (a === 'avancar') { var p = f.patamar; ev('avancar', 'Nível ' + p + ' fechado pela equipe', { motivo: c.motivo }); fechar(p); }
  else if (a === 'responsavel') { f.responsavel_email = c.email; ev('responsavel', 'Responsável agora é ' + emailCurto(c.email)); }
  else if (a === 'obs') { f.obs_equipe = c.texto; ev('obs', 'Observação', { texto: c.texto }); }
  f.ultimo_movimento_em = agora;
  usarExemplo();
}
function entrarExemplo(sim) {
  T.exemplo = sim;
  T.fila = ''; T.patamar = ''; T.uf = ''; T.q = '';
  if (!sim) { T.lista = null; T.mapa = null; T.resumo = null; }
  var a = U.aba();
  if (a === 'trilha' || a === 'mapa') abrir(a, true);
  marcarAba();
}

/* ── Balão do "(?)" ── */
function balao() {
  var b = document.getElementById('tr-balao');
  if (!b) { b = document.createElement('div'); b.id = 'tr-balao'; b.setAttribute('role', 'tooltip'); b.hidden = true; document.body.appendChild(b); }
  return b;
}
var balaoDe = null;
function mostrarBalao(btn) {
  var b = balao();
  b.textContent = btn.getAttribute('data-aj');
  b.hidden = false;
  var r = btn.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight;
  var x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  var y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
  b.style.left = x + 'px'; b.style.top = y + 'px';
  if (balaoDe && balaoDe !== btn) balaoDe.setAttribute('aria-expanded', 'false');
  balaoDe = btn; btn.setAttribute('aria-expanded', 'true');
}
function esconderBalao() {
  var b = document.getElementById('tr-balao'); if (b) b.hidden = true;
  if (balaoDe) { balaoDe.setAttribute('aria-expanded', 'false'); balaoDe = null; }
}

/* ── Contagem na aba ── */
function marcarAba() {
  var b = document.querySelector('#abas button[data-aba="trilha"]');
  if (!b) return;
  var ct = b.querySelector('.ct');
  var n = T.resumo ? T.resumo.esperando : 0;
  if (!n) { if (ct) ct.remove(); return; }
  if (!ct) { ct = document.createElement('span'); ct.className = 'ct'; b.appendChild(ct); }
  ct.textContent = n;
  b.setAttribute('title', n === 1 ? '1 parceiro esperando a equipe' : n + ' esperando a equipe');
}
function aoCarregarPainel() {
  T.mapa = null;
  return carregarLista(true).then(function () {
    if (T.fichaId && !T.exemplo) buscarFicha(T.fichaId).then(desenharFicha);
  });
}

/* ── Eventos (delegados) ── */
document.addEventListener('click', function (ev) {
  var t = ev.target;
  var a = t.closest ? t.closest('.tr-aj') : null;
  if (a) { ev.preventDefault(); if (balaoDe === a) esconderBalao(); else mostrarBalao(a); return; }
  if (balaoDe) esconderBalao();
  var b = t.closest ? t.closest('[data-tr]') : null;
  if (!b || b.disabled) return;
  var o = b.getAttribute('data-tr'), v = b.getAttribute('data-v');
  if (o === 'fila') { T.fila = T.fila === v ? '' : v; desenharDinamico(); }
  else if (o === 'pat') { T.patamar = String(T.patamar) === v ? '' : v; sincronizarFiltros(); desenharDinamico(); }
  else if (o === 'limpar-pat') { T.patamar = ''; sincronizarFiltros(); desenharDinamico(); }
  else if (o === 'tudo') { T.fila = ''; T.patamar = ''; T.uf = ''; T.q = ''; sincronizarFiltros(); desenharDinamico(); }
  else if (o === 'ficha') abrirFicha(v);
  else if (o === 'fechar') fecharFicha();
  else if (o === 'exemplo') entrarExemplo(true);
  else if (o === 'sair-exemplo') entrarExemplo(false);
  else if (o === 'recarregar') { if (v === 'ficha') { if (T.fichaId) abrirFicha(T.fichaId); } else abrir(v, true); }
  else if (o === 'uf') { T.uf = v; T.fila = ''; T.patamar = ''; T.q = ''; U.abrirAba('trilha', false); desenharVisao(); var s = document.getElementById('tr-lista-raiz'); if (s) s.scrollIntoView({ block: 'start' }); }
  else if (o === 'hist') { T.hist = v; desenharFicha(); var hb = document.querySelector('#tr-ficha [data-tr="hist"][data-v="' + v + '"]'); if (hb) hb.focus(); }
  else if (o === 'acao') {
    T.acao = T.acao === v ? null : v; T.confirmar = null; T.erroAcao = '';
    desenharFicha();
    var foco = document.querySelector('#tr-ficha [data-tr-form] input:not([type=radio]), #tr-ficha [data-tr-form] textarea, #tr-ficha [data-tr-form] input[type=radio], #tr-ficha [data-tr-form] button[type=submit]');
    if (T.acao && foco) foco.focus();
    else { var bb = document.querySelector('#tr-ficha [data-tr="acao"][data-v="' + v + '"]'); if (bb) bb.focus(); }
  }
  else if (o === 'confirmar' && T.confirmar) enviarAcao(T.confirmar.corpo);
  else if (o === 'voltar') { T.confirmar = null; T.erroAcao = ''; desenharFicha(); var vb = document.querySelector('#tr-ficha [data-tr-form] button[type=submit]'); if (vb) vb.focus(); }
});
document.addEventListener('submit', function (ev) {
  var form = ev.target.closest ? ev.target.closest('[data-tr-form]') : null;
  if (!form) return;
  ev.preventDefault();
  if (T.salvando || !T.ficha) return;
  var k = form.getAttribute('data-tr-form');
  var pat = patamarDe(T.ficha);
  var pre = T.ficha.prefill || {};
  var empresa = pre.empresa || (T.ficha.parceiro || {}).empresa || 'este parceiro';
  var lido = lerForm(k, form, T.ficha, pat, empresa);
  if (lido.erro) { T.erroAcao = lido.erro; desenharFicha(); var e = document.querySelector('#tr-ficha .tr-form .erro'); if (e) e.focus(); return; }
  T.erroAcao = '';
  if (lido.muda) {
    T.confirmar = { acao: k, corpo: lido.corpo, texto: lido.muda.texto, sub: lido.muda.sub };
    desenharFicha();
    var cb = document.querySelector('#tr-ficha [data-tr="confirmar"]'); if (cb) cb.focus();
    return;
  }
  enviarAcao(lido.corpo);
});
document.addEventListener('input', function (ev) {
  if (ev.target && ev.target.id === 'tr-q') { T.q = ev.target.value; desenharDinamico(); }
});
document.addEventListener('change', function (ev) {
  var id = ev.target && ev.target.id;
  if (id === 'tr-pat') { T.patamar = ev.target.value; desenharDinamico(); }
  else if (id === 'tr-uf') { T.uf = ev.target.value; desenharDinamico(); }
});
document.addEventListener('keydown', function (ev) {
  var aberta = T.fichaId && document.getElementById('tr-fundo') && !document.getElementById('tr-fundo').hidden;
  if (ev.key === 'Escape') {
    if (balaoDe) { esconderBalao(); return; }
    if (aberta) { ev.stopPropagation(); fecharFicha(); }
    return;
  }
  if (ev.key === 'Tab' && aberta) {
    var el = document.getElementById('tr-ficha').querySelectorAll('button:not([disabled]),a[href],input,select,textarea');
    if (!el.length) return;
    var p = el[0], z = el[el.length - 1];
    if (ev.shiftKey && document.activeElement === p) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); p.focus(); }
  }
});
document.addEventListener('mouseover', function (ev) {
  var a = ev.target.closest ? ev.target.closest('.tr-aj') : null;
  if (a && a !== balaoDe && window.matchMedia('(hover: hover)').matches) mostrarBalao(a);
});
document.addEventListener('mouseout', function (ev) {
  var a = ev.target.closest ? ev.target.closest('.tr-aj') : null;
  if (a && a === balaoDe && !(ev.relatedTarget && a.contains(ev.relatedTarget))) esconderBalao();
});
window.addEventListener('scroll', function () { if (balaoDe) esconderBalao(); }, true);
window.addEventListener('hashchange', function () {
  var m = /^#(trilha|mapa)\b/.exec(location.hash);
  if (m && U.painelPronto()) U.abrirAba(m[1], false);
});
function sincronizarFiltros() {
  var p = document.getElementById('tr-pat'); if (p) p.value = T.patamar;
  var u = document.getElementById('tr-uf'); if (u) u.value = T.uf;
  var q = document.getElementById('tr-q'); if (q && q.value !== T.q) q.value = T.q;
}

window.TrilhaNexus = { abrir: abrir, marcarAba: marcarAba, aoCarregarPainel: aoCarregarPainel };

// O painel pode ter terminado antes deste arquivo chegar: pega a aba aberta e a contagem agora.
if (U.painelPronto()) {
  aoCarregarPainel().then(function () {
    var a = U.aba();
    if (a === 'trilha' || a === 'mapa') abrir(a, false);
  });
}
})();
