/* Portal do Parceiro NEXUS · telas da rede: Oportunidades, Usinas e Engenharia.
   Uso: window.NexusRede.montar(container, tela, ctx)   tela = 'oportunidades' | 'usinas' | 'engenharia'
   ctx: { parceiro, nivel, progresso, libera, demo, api(metodo, caminho, corpo), evento(tipo, dados), irPara(hash) }
   Contrato: v2 (prefixo /gerador/nexus). ctx.api pode devolver o JSON direto ou {ok, status, data}; erro de rede ou
   promessa rejeitada viram tela de erro. Todo texto vindo da API entra por textContent (nunca innerHTML com dado).
   JavaScript puro, sem dependencia. Estilos em /nexus/app/css/rede.css (classes nr-*). */
(function () {
  'use strict';

  var BASE = '/gerador/nexus';
  var TZ = 'America/Sao_Paulo';
  var NS = 'http://www.w3.org/2000/svg';
  var seq = 0;          // ficha de montagem: resposta de montagem antiga e descartada
  var timer = null;     // contagem regressiva da montagem atual
  var uid = 0;          // prefixo de id por montagem (label for= nunca colide)

  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

  var ICO = {
    relogio: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    cadeado: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
    ok: 'M5 12l5 5 9-12',
    pino: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    sol: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    chave: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z',
    fone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    alerta: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
  };

  /* ------------------------------------------------------------------ DOM seguro */
  function add(e, k) {
    if (k == null || k === false) return;
    if (Array.isArray(k)) { for (var i = 0; i < k.length; i++) add(e, k[i]); return; }
    if (typeof k === 'string' || typeof k === 'number') { e.appendChild(document.createTextNode(String(k))); return; }
    e.appendChild(k);
  }
  function h(tag, cls, kids, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) { for (var k in attrs) { if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : String(attrs[k])); } }
    add(e, kids);
    return e;
  }
  function ic(nome, cls) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'nr-ic' + (cls ? ' ' + cls : ''));
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICO[nome] || '');
    s.appendChild(p);
    return s;
  }
  function limpar(e) { while (e.firstChild) e.removeChild(e.firstChild); }
  function str(v) { return v == null ? '' : String(v); }
  function digitos(v) { return str(v).replace(/\D/g, ''); }
  function arr(v) { return Array.isArray(v) ? v : []; }

  /* ------------------------------------------------------------------ data e hora (Brasilia) */
  function fmtDia(ts) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
  }
  function fmtData(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t));
  }
  function fmtHora(ts) {
    var p = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts));
    var hh = '', mm = '';
    for (var i = 0; i < p.length; i++) { if (p[i].type === 'hour') hh = p[i].value; if (p[i].type === 'minute') mm = p[i].value; }
    hh = String(parseInt(hh, 10));
    return mm === '00' ? hh + 'h' : hh + 'h' + mm;
  }
  function prazoAbsoluto(iso, agora) {
    var t = Date.parse(iso);
    if (isNaN(t)) return 'Sem prazo definido';
    var dia = fmtDia(t), hoje = fmtDia(agora), amanha = fmtDia(agora + 86400000);
    var quando;
    if (dia === hoje) quando = 'hoje';
    else if (dia === amanha) quando = 'amanhã';
    else {
      var dif = t - agora;
      if (dif > 0 && dif < 6 * 86400000) {
        var wd = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long' }).format(new Date(t));
        quando = wd.replace('-feira', '');
      } else quando = fmtData(iso).slice(0, 5);
    }
    return 'Aceitar até ' + quando + ', ' + fmtHora(t);
  }
  function contagem(iso, agora) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var dif = t - agora;
    if (dif <= 0) return 'Prazo encerrado';
    var min = Math.floor(dif / 60000), hh = Math.floor(min / 60), mm = min % 60;
    if (hh < 1) return 'Faltam ' + Math.max(1, min) + ' min';
    if (hh < 24) return 'Faltam ' + hh + ' h' + (mm ? ' ' + mm + ' min' : '');
    var d = Math.floor(hh / 24);
    return 'Faltam ' + d + (d === 1 ? ' dia' : ' dias') + (hh % 24 ? ' ' + (hh % 24) + ' h' : '');
  }
  function duracao(min) {
    if (min == null || isNaN(min)) return 'Sem dado';
    min = Math.round(min);
    if (min < 1) return 'Menos de 1 min';
    if (min < 60) return min + ' min';
    var hh = Math.floor(min / 60);
    if (hh < 24) return hh + ' h' + (min % 60 >= 30 ? ' 30 min' : '');
    var d = Math.floor(hh / 24);
    return d + (d === 1 ? ' d' : ' d') + (hh % 24 ? ' ' + (hh % 24) + ' h' : '');
  }

  /* ------------------------------------------------------------------ chamadas */
  function chamar(inst, metodo, caminho, corpo) {
    var ctx = inst.ctx, p;
    try {
      p = typeof ctx.api === 'function' ? ctx.api(metodo, BASE + caminho, corpo) : demoApi(metodo, caminho, corpo);
    } catch (e) {
      return Promise.resolve({ ok: false, status: 0, data: null });
    }
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r === 'object' && typeof r.ok === 'boolean' && typeof r.status === 'number' && 'data' in r) return { ok: r.ok, status: r.status, data: r.data };
      return { ok: true, status: 200, data: r };
    }, function (e) {
      return { ok: false, status: (e && e.status) || 0, data: (e && (e.data || e.body)) || null };
    });
  }
  function evento(inst, tipo, dados) {
    try { if (typeof inst.ctx.evento === 'function') inst.ctx.evento(tipo, dados || {}); } catch (e) { /* evento nunca quebra a tela */ }
  }
  function erroTexto(r) {
    var cod = r && r.data && r.data.erro;
    if (r && (r.status === 503 || cod === 'portal_desligado')) return 'O portal está em atualização. Tente de novo em alguns minutos.';
    if (r && r.status === 401) return 'Sua sessão expirou. Entre de novo.';
    if (r && r.status === 403) return 'Esta função ainda não está liberada para a sua empresa. Veja o que falta em Minha parceria.';
    if (r && r.status === 0) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    if (r && r.status === 404) return 'Este item não existe mais. Atualize a lista.';
    if (r && (r.status === 409 || r.status === 410)) return 'Este item mudou de situação. Atualize a lista.';
    if (r && r.status === 400) return 'Alguns dados não foram aceitos. Confira os campos e tente de novo.';
    return 'Não foi possível concluir agora. Tente de novo.';
  }

  /* ------------------------------------------------------------------ pedacos comuns */
  function esqueleto(qtd, rotulo) {
    var w = h('div', 'nr-esq-grupo', null, { role: 'status', 'aria-live': 'polite' });
    w.appendChild(h('span', 'nr-sr', rotulo));
    for (var i = 0; i < qtd; i++) w.appendChild(h('div', 'nr-esq'));
    return w;
  }
  function estadoErro(msg, aoTentar) {
    var b = h('button', 'nr-btn', 'Tentar de novo', { type: 'button' });
    b.addEventListener('click', aoTentar);
    return h('div', 'nr-cartao nr-estado nr-estado-erro', [
      ic('alerta', 'nr-ic-g'),
      h('p', 'nr-estado-t', 'Não conseguimos carregar'),
      h('p', 'nr-estado-p', msg, { role: 'alert' }),
      b
    ]);
  }
  function estadoVazio(titulo, texto) {
    return h('div', 'nr-cartao nr-estado', [h('p', 'nr-estado-t', titulo), h('p', 'nr-estado-p', texto)]);
  }
  function cabecalho(inst, titulo, sub) {
    var linha = h('div', 'nr-tit-linha', [h('h1', 'nr-h1', titulo)]);
    if (inst.ctx.demo) linha.appendChild(h('span', 'nr-selo-demo', 'Dados de exemplo'));
    return h('section', 'nr-cab', [linha, h('p', 'nr-sub', sub)]);
  }
  function btn(rotulo, cls, tipo) { return h('button', 'nr-btn' + (cls ? ' ' + cls : ''), rotulo, { type: tipo || 'button' }); }
  function chip(rotulo, cls) { return h('span', 'nr-chip' + (cls ? ' ' + cls : ''), rotulo); }

  /* campo de formulario com label, dica e erro ligados por id */
  function campo(inst, chave, rotulo, el, dica, cls) {
    var id = inst.pfx + chave;
    el.id = id;
    el.setAttribute('name', chave);
    var desc = id + '-e';
    var dicaEl = null;
    if (dica) { dicaEl = h('p', 'nr-dica', dica, { id: id + '-d' }); desc = id + '-d ' + desc; }
    el.setAttribute('aria-describedby', desc);
    var erro = h('p', 'nr-campo-erro', '', { id: id + '-e' });
    erro.hidden = true;
    var w = h('div', 'nr-campo' + (cls ? ' ' + cls : ''), [h('label', null, rotulo, { 'for': id }), el, dicaEl, erro]);
    return { wrap: w, el: el, erro: erro };
  }
  function entrada(tipo, extra) {
    var e = document.createElement('input');
    e.type = tipo;
    if (extra) { for (var k in extra) e.setAttribute(k, extra[k]); }
    return e;
  }
  function selectUF() {
    var s = document.createElement('select');
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Selecione'; s.appendChild(o0);
    for (var i = 0; i < UFS.length; i++) { var o = document.createElement('option'); o.value = UFS[i]; o.textContent = UFS[i]; s.appendChild(o); }
    return s;
  }
  function mostrarErros(campos, erros) {
    var primeiro = null;
    for (var k in campos) {
      var c = campos[k], m = erros[k];
      if (m) {
        c.erro.textContent = m; c.erro.hidden = false;
        c.el.setAttribute('aria-invalid', 'true');
        if (!primeiro) primeiro = c.el;
      } else {
        c.erro.textContent = ''; c.erro.hidden = true;
        c.el.removeAttribute('aria-invalid');
      }
    }
    if (primeiro) primeiro.focus();
    return !!primeiro;
  }
  /* numero pt-BR: aceita 1.500 (mil e quinhentos), 12,5 e 12.5. Vazio = null; invalido = NaN */
  function numero(s) {
    s = str(s).trim().replace(/\s/g, '');
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(,\d+)?$/.test(s)) s = s.replace(',', '.');
    else if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function fone(s) {
    var d = digitos(s);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    return d.length === 10 || d.length === 11 ? d : '';
  }
  function fmtNum(n) {
    if (n == null || isNaN(Number(n))) return '';
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(n));
  }
  function lista(d, chave) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d[chave])) return d[chave];
    return [];
  }

  /* ------------------------------------------------------------------ dados de exemplo (sem rede) */
  var demoEstado = null;
  function demoInicio() {
    var agora = Date.now(), H = 3600000;
    demoEstado = {
      ops: [
        { id: 'd1', tipo: 'obra', cidade: 'Anápolis', uf: 'GO', distancia_km: 55, descricao: 'Investidor comprou 1x DC 80 kW chave na mão. Precisamos de montagem e homologação.', valor_servico: '', prazo_aceite: new Date(agora + 20 * H).toISOString(), status: 'oferecida', etapas: [{ status: 'oferecida', em: new Date(agora - 2 * H).toISOString() }] },
        { id: 'd2', tipo: 'cliente', cidade: 'Rio Verde', uf: 'GO', distancia_km: 230, descricao: 'Posto de combustível quer orçamento de 2x DC 120 kW.', prazo_aceite: new Date(agora + 5 * H).toISOString(), status: 'oferecida', etapas: [{ status: 'oferecida', em: new Date(agora - 3 * H).toISOString() }] },
        { id: 'd3', tipo: 'cliente', cidade: 'Itumbiara', uf: 'GO', distancia_km: 200, descricao: 'Hotel de beira de estrada quer saber se o ponto comporta um DC 80 kW.', prazo_aceite: new Date(agora + 30 * H).toISOString(), status: 'oferecida', etapas: [{ status: 'oferecida', em: new Date(agora - 1 * H).toISOString() }] },
        { id: 'd4', tipo: 'obra', cidade: 'Goiânia', uf: 'GO', distancia_km: 12, descricao: 'Condomínio comercial comprou 1x DC 120 kW. Precisamos de montagem, obra civil e comissionamento.', valor_servico: 'A combinar com o comercial', prazo_aceite: new Date(agora + 70 * H).toISOString(), status: 'oferecida', etapas: [{ status: 'oferecida', em: new Date(agora - 4 * H).toISOString() }] }
      ],
      contatos: { d1: { nome: 'Cliente Exemplo', telefone: '62900000000' }, d2: { nome: 'Posto Exemplo', telefone: '64900000000' }, d3: { nome: 'Hotel Exemplo', telefone: '64900000001' }, d4: { nome: 'Condomínio Exemplo', telefone: '62900000002' } },
      usinas: [
        { id: 'u1', dono_nome: 'Usina Exemplo A', potencia_kwp: 300, cidade: 'Goiânia', uf: 'GO', status: 'em_analise', created_at: new Date(agora - 5 * 86400000).toISOString() },
        { id: 'u2', dono_nome: 'Usina Exemplo B', potencia_kwp: 75, cidade: 'Senador Canedo', uf: 'GO', status: 'recebida', created_at: new Date(agora - 1 * 86400000).toISOString() }
      ],
      solic: [
        { id: 's1', tipo: 'engenharia', dados: { servico_nome: 'Projeto elétrico', cidade: 'Goiânia', uf: 'GO', potencia_kw: 80, descricao: 'Ponto de exemplo.' }, status: 'em_andamento', created_at: new Date(agora - 2 * 86400000).toISOString() }
      ]
    };
  }
  function demoApi(metodo, caminho, corpo) {
    if (!demoEstado) demoInicio();
    var E = demoEstado, agora = new Date().toISOString(), m;
    var ok = function (d, s) { return Promise.resolve({ ok: true, status: s || 200, data: d }); };
    if (metodo === 'GET' && caminho === '/oportunidades') {
      return ok({
        oportunidades: E.ops.map(function (o) {
          var c = {}; for (var k in o) c[k] = o[k];
          if (/^(aceita|contato|visita|orcamento|fechou|perdeu)$/.test(o.status)) c.contato = E.contatos[o.id];
          return c;
        })
      });
    }
    if ((m = /^\/oportunidades\/([^/]+)\/(aceitar|recusar|etapa)$/.exec(caminho)) && metodo === 'POST') {
      var op = null;
      for (var i = 0; i < E.ops.length; i++) if (E.ops[i].id === m[1]) op = E.ops[i];
      if (!op) return Promise.resolve({ ok: false, status: 404, data: null });
      var novo = m[2] === 'aceitar' ? 'aceita' : m[2] === 'recusar' ? 'recusada' : corpo.status;
      op.status = novo;
      op.etapas.push({ status: novo, em: agora, obs: (corpo && (corpo.obs || corpo.motivo)) || '' });
      return ok({ ok: true });
    }
    if (metodo === 'GET' && caminho === '/usinas') return ok({ usinas: E.usinas });
    if (metodo === 'POST' && caminho === '/usinas') {
      var u = { id: 'u' + (E.usinas.length + 1), dono_nome: corpo.dono_nome, potencia_kwp: corpo.potencia_kwp, cidade: corpo.cidade, uf: corpo.uf, status: 'recebida', created_at: agora };
      E.usinas.unshift(u);
      return ok(u, 201);
    }
    if (metodo === 'GET' && caminho === '/solicitacoes') return ok({ solicitacoes: E.solic });
    if (metodo === 'POST' && caminho === '/solicitacoes') {
      var s = { id: 's' + (E.solic.length + 1), tipo: corpo.tipo, dados: corpo.dados, status: 'aberta', created_at: agora };
      E.solic.unshift(s);
      return ok(s, 201);
    }
    return Promise.resolve({ ok: false, status: 404, data: null });
  }

  /* ================================================================== OPORTUNIDADES */
  var ACEITAS = { aceita: 1, contato: 1, visita: 1, orcamento: 1, fechou: 1, perdeu: 1 };
  var ANDAMENTO = { aceita: 1, contato: 1, visita: 1, orcamento: 1 };
  var RANK = { aceita: 1, contato: 2, visita: 3, orcamento: 4, fechou: 5 };
  var ETAPA_NOME = { aceita: 'Aceitou', contato: 'Contato', visita: 'Visita', orcamento: 'Orçamento', fechou: 'Fechou', perdeu: 'Perdeu', oferecida: 'Oferecida', recusada: 'Recusada', expirada: 'Expirada' };
  var BOTOES_ETAPA = ['contato', 'visita', 'orcamento', 'fechou', 'perdeu'];
  var FUNIL = [['aceita', 'Aceitou'], ['contato', 'Contato'], ['visita', 'Visita'], ['orcamento', 'Orçamento'], ['fechou', 'Fechou']];
  var PASSOS = ['A NEXUS recebe o cliente', 'Oferece ao Partner Pro mais perto', 'Você aceita em até 24h', 'Primeiro contato em até 48h', 'Você dá baixa a cada passo'];
  var REGRAS = ['Cliente encaminhado, não garantido.', 'Sem exclusividade de cidade.', 'Quem responde rápido e dá baixa recebe primeiro.', 'O equipamento da obra é NEXUS.'];

  function normOp(r) {
    r = r || {};
    var st = str(r.status) || 'oferecida';
    var o = {
      id: str(r.id), tipo: r.tipo === 'obra' ? 'obra' : 'cliente', cidade: str(r.cidade), uf: str(r.uf).toUpperCase().slice(0, 2),
      descricao: str(r.descricao), valor: str(r.valor_servico), prazo: r.prazo_aceite || null, status: st,
      etapas: arr(r.etapas), contato: null, km: null
    };
    var km = r.distancia_km != null ? r.distancia_km : r.km;
    if (km != null && km !== '' && !isNaN(Number(km))) o.km = Number(km);
    // contato so existe depois de aceitar, tambem no cliente
    if (ACEITAS[st] && r.contato && typeof r.contato === 'object') o.contato = { nome: str(r.contato.nome), telefone: str(r.contato.telefone) };
    return o;
  }
  function tipoNome(o) { return o.tipo === 'obra' ? 'Obra terceirizada NEXUS' : 'Cliente para você vender'; }
  function localTxt(o) {
    var l = o.cidade + (o.uf ? '/' + o.uf : '');
    if (o.km != null) l += ' · ' + Math.round(o.km) + ' km';
    return l || 'Local não informado';
  }
  function tempoResposta(o) {
    var ini = null, fim = null, i, e, t;
    for (i = 0; i < o.etapas.length; i++) {
      e = o.etapas[i] || {};
      t = Date.parse(e.em);
      if (isNaN(t)) continue;
      if (e.status === 'oferecida' && ini == null) ini = t;
      if ((e.status === 'aceita' || e.status === 'recusada') && fim == null) fim = t;
    }
    return ini != null && fim != null && fim >= ini ? (fim - ini) / 60000 : null;
  }
  function calcPlacar(itens, api) {
    var p = { aceitas: 0, recusadas: 0, total: itens.length, tempo: null };
    var soma = 0, n = 0, i, t;
    for (i = 0; i < itens.length; i++) {
      if (ACEITAS[itens[i].status]) p.aceitas++;
      else if (itens[i].status === 'recusada') p.recusadas++;
      t = tempoResposta(itens[i]);
      if (t != null) { soma += t; n++; }
    }
    if (n) p.tempo = soma / n;
    if (api && typeof api === 'object') {
      if (api.aceitas != null && !isNaN(Number(api.aceitas))) p.aceitas = Number(api.aceitas);
      if (api.recusadas != null && !isNaN(Number(api.recusadas))) p.recusadas = Number(api.recusadas);
      if (api.total != null && !isNaN(Number(api.total))) p.total = Number(api.total);
      var tm = api.tempo_medio_min != null ? api.tempo_medio_min : api.tempo_medio_minutos;
      if (tm != null && !isNaN(Number(tm))) p.tempo = Number(tm);
    }
    return p;
  }

  function oportunidades(inst) {
    var ctx = inst.ctx, root = inst.root, libera = ctx.libera || {};
    var temAcesso = !!libera.oportunidades;
    evento(inst, 'abriu_oportunidades', { bloqueada: !temAcesso });
    root.appendChild(cabecalho(inst, 'Oportunidades na sua região', 'Clientes e obras que a NEXUS recebe e encaminha para o parceiro mais perto.'));
    if (!temAcesso) { oportunidadesBloqueadas(inst); return; }

    var S = { filtro: 'todas', itens: [], estado: 'carregando', erro: '', placarApi: null, ui: {}, foco: '' };
    var passos = h('ol', 'nr-passos');
    for (var i = 0; i < PASSOS.length; i++) passos.appendChild(h('li', 'nr-passo', [h('span', 'nr-passo-n', i + 1), h('span', 'nr-passo-t', PASSOS[i])]));
    root.appendChild(h('section', 'nr-bloco', [h('h2', 'nr-h2', 'Como funciona'), passos]));

    var areaFiltros = h('div', 'nr-filtros', null, { role: 'group', 'aria-label': 'Filtrar por tipo' });
    var areaLista = h('div', 'nr-lista');
    var areaLado = h('aside', 'nr-lado', null, { 'aria-label': 'Placar e regras' });
    root.appendChild(h('div', 'nr-duas', [h('section', 'nr-principal', [areaFiltros, areaLista]), areaLado]));

    function ui(id) { return S.ui[id] || (S.ui[id] = { modo: null, etapa: '', texto: '', ocupado: false, erro: '' }); }

    function pintarFiltros() {
      limpar(areaFiltros);
      var botoes = [];
      [['todas', 'Todas'], ['obra', 'Obra terceirizada'], ['cliente', 'Cliente para vender']].forEach(function (f) {
        var b = h('button', 'nr-filtro', f[1], { type: 'button', 'aria-pressed': S.filtro === f[0] ? 'true' : 'false' });
        b.addEventListener('click', function () {
          S.filtro = f[0];
          botoes.forEach(function (x) { x[1].setAttribute('aria-pressed', x[0] === f[0] ? 'true' : 'false'); });
          pintarLista();
        });
        botoes.push([f[0], b]);
        areaFiltros.appendChild(b);
      });
    }

    function funil(o) {
      var rk = RANK[o.status] || 0;
      if (o.status === 'perdeu') {
        for (var i = o.etapas.length - 1; i >= 0; i--) { if (RANK[(o.etapas[i] || {}).status]) { rk = RANK[o.etapas[i].status]; break; } }
        if (!rk) rk = 1;
      }
      var ol = h('ol', 'nr-funil');
      FUNIL.forEach(function (f, idx) {
        var feito = idx + 1 <= rk;
        var li = h('li', 'nr-funil-i' + (feito ? ' feito' : ''));
        li.appendChild(h('span', 'nr-funil-b', feito ? ic('ok', 'nr-ic-p') : String(idx + 1)));
        li.appendChild(h('span', 'nr-funil-n', f[1]));
        li.appendChild(h('span', 'nr-funil-s', feito ? 'Feito' : 'Pendente'));
        ol.appendChild(li);
      });
      return ol;
    }

    function cartao(o) {
      var u = ui(o.id), agora = Date.now();
      var topoEsq = h('div', 'nr-topo-esq', [chip(tipoNome(o), o.tipo === 'obra' ? 'obra' : 'cli'), h('span', 'nr-local', localTxt(o))]);
      var topo = h('div', 'nr-topo', topoEsq);
      var c = h('article', 'nr-cartao nr-op', null, { tabindex: '-1', 'data-foco': 'card:' + o.id });
      var oferecida = o.status === 'oferecida';
      var expirou = oferecida && o.prazo && Date.parse(o.prazo) <= agora;
      var bAceitar = null, bRecusar = null;

      if (oferecida) {
        var cont = h('span', 'nr-cont', contagem(o.prazo, agora));
        topo.appendChild(h('span', 'nr-prazo', [ic('relogio'), h('span', null, [prazoAbsoluto(o.prazo, agora), ' · ']), cont]));
        inst.contadores.push({ node: cont, iso: o.prazo, id: o.id });
      } else {
        var cls = o.status === 'fechou' ? 'ok' : o.status === 'perdeu' ? 'er' : ANDAMENTO[o.status] ? 'aceita' : 'cz';
        var chSt = chip(ETAPA_NOME[o.status] || o.status, cls);
        chSt.setAttribute('tabindex', '-1'); chSt.setAttribute('data-foco', 'chip:' + o.id);
        topo.appendChild(chSt);
      }
      c.appendChild(topo);
      c.appendChild(h('p', 'nr-desc', o.descricao || 'Sem descrição.'));
      if (o.tipo === 'obra') c.appendChild(h('p', 'nr-valor', 'Valor do serviço: ' + (o.valor || 'a combinar com o comercial')));

      if (oferecida) {
        var acoes = h('div', 'nr-acoes');
        bAceitar = btn('Aceitar');
        bRecusar = btn('Recusar', 'sec');
        bAceitar.setAttribute('data-acao', 'aceitar');
        if (expirou || u.ocupado) { bAceitar.disabled = true; }
        if (expirou || u.ocupado) { bRecusar.disabled = true; }
        bAceitar.addEventListener('click', function () { aceitar(o); });
        bRecusar.addEventListener('click', function () { u.modo = u.modo === 'recusar' ? null : 'recusar'; u.erro = ''; S.foco = (u.modo ? 'rec:' : 'brec:') + o.id; pintarLista(); });
        bAceitar.setAttribute('data-id', o.id); bRecusar.setAttribute('data-id', o.id);
        bAceitar.setAttribute('data-foco', 'bace:' + o.id); bRecusar.setAttribute('data-foco', 'brec:' + o.id);
        bRecusar.setAttribute('data-acao', 'recusar');
        acoes.appendChild(bAceitar); acoes.appendChild(bRecusar);
        inst.botoes[o.id] = [bAceitar, bRecusar];
        c.appendChild(h('div', 'nr-rodape', acoes));
        if (u.modo === 'recusar' && !expirou) {
          var tid = inst.pfx + 'rec-' + o.id;
          var ta = h('textarea', 'nr-ta', u.texto, { id: tid, rows: '3', maxlength: '500', 'data-foco': 'rec:' + o.id });
          ta.value = u.texto;
          ta.addEventListener('input', function () { u.texto = ta.value; });
          var bc = btn(u.ocupado ? 'Enviando' : 'Confirmar recusa', 'sec', 'submit');
          bc.disabled = u.ocupado;
          var bx = btn('Cancelar', 'link'); bx.disabled = u.ocupado;
          bx.addEventListener('click', function () { u.modo = null; u.erro = ''; S.foco = 'brec:' + o.id; pintarLista(); });
          var f = h('form', 'nr-mini', [
            h('label', null, 'Motivo da recusa (opcional)', { 'for': tid }), ta,
            h('div', 'nr-acoes', [bc, bx]),
            h('p', 'nr-erro-linha', u.erro, { role: 'alert' })
          ], { novalidate: true });
          f.addEventListener('submit', function (ev) { ev.preventDefault(); recusar(o); });
          c.appendChild(f);
        } else if (u.erro) c.appendChild(h('p', 'nr-erro-linha', u.erro, { role: 'alert' }));
        if (expirou) c.appendChild(h('p', 'nr-aviso-linha', 'Prazo encerrado. Esta oportunidade não pode mais ser aceita.'));
        return c;
      }

      if (ACEITAS[o.status]) {
        if (o.contato) {
          var tel = digitos(o.contato.telefone);
          var wa = tel.length === 10 || tel.length === 11 ? '55' + tel : tel;
          var linhaC = [h('span', 'nr-contato-n', o.contato.nome || 'Cliente')];
          if (o.contato.telefone) linhaC.push(h('span', 'nr-contato-t', o.contato.telefone));
          var caixaC = h('div', 'nr-contato', [h('p', 'nr-contato-r', 'Contato do cliente'), h('div', 'nr-contato-l', linhaC)]);
          if (wa.length >= 10) {
            var a = h('a', 'nr-btn sec nr-btn-p', [ic('fone', 'nr-ic-p'), 'Chamar no WhatsApp'], { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer' });
            caixaC.appendChild(a);
          }
          c.appendChild(caixaC);
        } else {
          c.appendChild(h('p', 'nr-aviso-linha', 'O contato do cliente aparece aqui assim que a oportunidade estiver aceita.'));
        }
        c.appendChild(funil(o));
        if (o.status === 'perdeu') c.appendChild(h('p', 'nr-aviso-linha', 'Marcada como perdida.'));
        var hist = o.etapas.filter(function (e) { return e && e.status && e.status !== 'oferecida' && ETAPA_NOME[e.status]; });
        if (hist.length) {
          var ul = h('ul', 'nr-hist');
          hist.forEach(function (e) {
            ul.appendChild(h('li', null, [h('b', null, ETAPA_NOME[e.status]), fmtData(e.em) ? ' · ' + fmtData(e.em) : '', e.obs ? ' · ' + str(e.obs) : '']));
          });
          c.appendChild(h('div', 'nr-hist-w', [h('h3', 'nr-h3', 'Histórico'), ul]));
        }
        if (ANDAMENTO[o.status]) {
          var grupo = h('div', 'nr-etapas', null, { role: 'group', 'aria-label': 'Dar baixa nesta oportunidade' });
          BOTOES_ETAPA.forEach(function (k) {
            var b = h('button', 'nr-filtro', ETAPA_NOME[k], { type: 'button', 'aria-pressed': u.modo === 'etapa' && u.etapa === k ? 'true' : 'false', 'data-etapa': k, 'data-id': o.id, 'data-foco': 'bet:' + o.id + ':' + k });
            b.disabled = u.ocupado || o.status === k;
            b.addEventListener('click', function () { u.modo = 'etapa'; u.etapa = k; u.erro = ''; S.foco = 'obs:' + o.id; pintarLista(); });
            grupo.appendChild(b);
          });
          c.appendChild(h('div', 'nr-baixa', [h('h3', 'nr-h3', 'Dar baixa'), grupo]));
          if (u.modo === 'etapa' && u.etapa) {
            var tid2 = inst.pfx + 'obs-' + o.id;
            var ta2 = h('textarea', 'nr-ta', '', { id: tid2, rows: '3', maxlength: '500', 'data-foco': 'obs:' + o.id });
            ta2.value = u.texto;
            ta2.addEventListener('input', function () { u.texto = ta2.value; });
            var br = btn(u.ocupado ? 'Enviando' : 'Registrar ' + ETAPA_NOME[u.etapa].toLowerCase(), null, 'submit');
            br.disabled = u.ocupado;
            var bx2 = btn('Cancelar', 'link'); bx2.disabled = u.ocupado;
            bx2.addEventListener('click', function () { var ant = u.etapa; u.modo = null; u.erro = ''; S.foco = 'bet:' + o.id + ':' + ant; pintarLista(); });
            var f2 = h('form', 'nr-mini', [
              h('label', null, 'Observação sobre ' + ETAPA_NOME[u.etapa].toLowerCase() + ' (opcional)', { 'for': tid2 }), ta2,
              h('div', 'nr-acoes', [br, bx2]),
              h('p', 'nr-erro-linha', u.erro, { role: 'alert' })
            ], { novalidate: true });
            f2.addEventListener('submit', function (ev) { ev.preventDefault(); etapa(o, u.etapa); });
            c.appendChild(f2);
          } else if (u.erro) c.appendChild(h('p', 'nr-erro-linha', u.erro, { role: 'alert' }));
        }
      } else if (o.status === 'recusada') {
        c.appendChild(h('p', 'nr-aviso-linha', 'Você recusou esta oportunidade.'));
      } else if (o.status === 'expirada') {
        c.appendChild(h('p', 'nr-aviso-linha', 'O prazo para aceitar acabou.'));
      }
      return c;
    }

    function grupo(titulo, itens, vazioOculto) {
      if (!itens.length && vazioOculto) return null;
      var s = h('section', 'nr-grupo', [h('h2', 'nr-h2', [titulo, h('span', 'nr-cnt', String(itens.length))])]);
      itens.forEach(function (o) { s.appendChild(cartao(o)); });
      return s;
    }

    function pintarLista() {
      if (!S.foco) { var a = document.activeElement; if (a && a.getAttribute && areaLista.contains(a) && a.getAttribute('data-foco')) S.foco = a.getAttribute('data-foco'); }
      pintarListaInterno(); aplicarFoco();
    }
    function aplicarFoco() {
      var alvo = S.foco; S.foco = '';
      if (!alvo) return;
      var els = areaLista.querySelectorAll('[data-foco]');
      for (var i = 0; i < els.length; i++) { if (els[i].getAttribute('data-foco') === alvo && !els[i].disabled) { els[i].focus(); return; } }
    }
    function pintarListaInterno() {
      limpar(areaLista);
      inst.contadores = [];
      inst.botoes = {};
      if (S.estado === 'carregando') { areaLista.appendChild(esqueleto(3, 'Carregando oportunidades')); pintarLado(); return; }
      if (S.estado === 'erro') { areaLista.appendChild(estadoErro(S.erro, carregar)); pintarLado(); return; }
      if (!S.itens.length) {
        areaLista.appendChild(estadoVazio('Nenhuma oportunidade por enquanto', 'Quando a NEXUS encaminhar um cliente ou uma obra da sua região, ele aparece aqui.'));
        pintarLado(); return;
      }
      var vis = S.itens.filter(function (o) { return S.filtro === 'todas' || o.tipo === S.filtro; });
      if (!vis.length) {
        areaLista.appendChild(estadoVazio('Nenhuma oportunidade deste tipo', 'Troque o filtro para ver as outras.'));
        pintarLado(); return;
      }
      var porPrazo = function (a, b) { return (Date.parse(a.prazo) || 0) - (Date.parse(b.prazo) || 0); };
      var g1 = vis.filter(function (o) { return o.status === 'oferecida'; }).sort(porPrazo);
      var g2 = vis.filter(function (o) { return ANDAMENTO[o.status]; });
      var g3 = vis.filter(function (o) { return !ANDAMENTO[o.status] && o.status !== 'oferecida'; });
      [grupo('Para responder', g1, true), grupo('Em andamento', g2, true), grupo('Encerradas', g3, true)].forEach(function (g) { if (g) areaLista.appendChild(g); });
      pintarLado();
    }

    function pintarLado() {
      limpar(areaLado);
      var p = calcPlacar(S.itens, S.placarApi);
      var celula = function (valor, rotulo) { return h('div', 'nr-pl-c', [h('span', 'nr-pl-v', valor), h('span', 'nr-pl-r', rotulo)]); };
      var pl = h('section', 'nr-cartao nr-placar', [
        h('h2', 'nr-h2', 'Seu placar'),
        h('div', 'nr-pl', [
          celula(p.total ? p.aceitas + ' de ' + p.total : String(p.aceitas), 'Aceitas'),
          celula(String(p.recusadas), 'Recusadas'),
          celula(p.tempo == null ? 'Sem dado' : duracao(p.tempo), 'Tempo médio de resposta')
        ])
      ]);
      // funil de referencia: a oportunidade em andamento mais adiantada
      var ref = null;
      S.itens.forEach(function (o) { if (ANDAMENTO[o.status] && (!ref || RANK[o.status] > RANK[ref.status])) ref = o; });
      if (ref) pl.appendChild(h('div', 'nr-pl-funil', [h('h3', 'nr-h3', 'Funil de uma oportunidade aceita'), h('p', 'nr-dica', localTxt(ref)), funil(ref)]));
      areaLado.appendChild(pl);
      var ul = h('ul', 'nr-regras-l');
      REGRAS.forEach(function (r) { ul.appendChild(h('li', null, [h('span', 'nr-ponto', null, { 'aria-hidden': 'true' }), h('span', null, r)])); });
      areaLado.appendChild(h('section', 'nr-regras', [h('h2', 'nr-h2', 'Regras da rede'), ul]));
      /* obra terceirizada so chega para quem tem o selo de montagem aprovada (a equipe NEXUS aprova, fora do nivel) */
      if (ctx.montagem_aprovada === false) {
        areaLado.appendChild(h('section', 'nr-cartao nr-lknota', [
          h('div', 'nr-lk-t', [ic('cadeado', 'nr-ic-p'), h('b', null, 'Obra terceirizada: travada')]),
          h('p', 'nr-dica', 'Libera quando a equipe NEXUS aprovar a montagem da sua empresa. Enquanto isso, você recebe os clientes para vender.')
        ]));
      }
    }

    /* acoes */
    function focoDe(o) { var u = ui(o.id); return u.modo === 'recusar' ? 'rec:' + o.id : u.modo === 'etapa' ? 'obs:' + o.id : 'card:' + o.id; }
    function ocupar(o, v) { ui(o.id).ocupado = v; S.foco = focoDe(o); pintarLista(); }
    function recarregarSilencioso() {
      if (ctx.demo) return Promise.resolve();
      return chamar(inst, 'GET', '/oportunidades').then(function (r) {
        if (!inst.vivo()) return;
        if (r.ok) { S.itens = lista(r.data, 'oportunidades').map(normOp); if (r.data && r.data.placar) S.placarApi = r.data.placar; pintarLista(); }
      });
    }
    /* o contato so chega do servidor depois de aceitar: busca de novo e copia so o contato desta oportunidade */
    function buscarContato(o) {
      chamar(inst, 'GET', '/oportunidades').then(function (r) {
        if (!inst.vivo() || !r.ok) return;
        lista(r.data, 'oportunidades').forEach(function (x) {
          if (x && str(x.id) === o.id && ACEITAS[o.status] && x.contato && typeof x.contato === 'object') {
            o.contato = { nome: str(x.contato.nome), telefone: str(x.contato.telefone) };
            pintarLista();
          }
        });
      });
    }
    function aceitar(o) {
      var u = ui(o.id); u.erro = '';
      ocupar(o, true);
      chamar(inst, 'POST', '/oportunidades/' + encodeURIComponent(o.id) + '/aceitar').then(function (r) {
        if (!inst.vivo()) return;
        u.ocupado = false;
        if (!r.ok) { u.erro = erroTexto(r); S.foco = 'bace:' + o.id; pintarLista(); return; }
        o.status = 'aceita';
        o.etapas = o.etapas.concat([{ status: 'aceita', em: new Date().toISOString() }]);
        var cj = r.data && ((r.data.oportunidade && r.data.oportunidade.contato) || r.data.contato);
        if (cj && typeof cj === 'object') o.contato = { nome: str(cj.nome), telefone: str(cj.telefone) };
        u.modo = null; u.texto = '';
        evento(inst, 'aceitou_oportunidade', { id: o.id, tipo: o.tipo });
        S.foco = 'chip:' + o.id;
        pintarLista();
        if (ctx.demo && !o.contato) buscarContato(o);
        recarregarSilencioso();
      });
    }
    function recusar(o) {
      var u = ui(o.id); u.erro = '';
      var motivo = u.texto.trim();
      ocupar(o, true);
      chamar(inst, 'POST', '/oportunidades/' + encodeURIComponent(o.id) + '/recusar', motivo ? { motivo: motivo } : {}).then(function (r) {
        if (!inst.vivo()) return;
        u.ocupado = false;
        if (!r.ok) { u.erro = erroTexto(r); S.foco = 'rec:' + o.id; pintarLista(); return; }
        o.status = 'recusada';
        o.contato = null;
        o.etapas = o.etapas.concat([{ status: 'recusada', em: new Date().toISOString(), obs: motivo }]);
        u.modo = null; u.texto = '';
        evento(inst, 'recusou_oportunidade', { id: o.id, tipo: o.tipo });
        S.foco = 'chip:' + o.id;
        pintarLista();
        recarregarSilencioso();
      });
    }
    function etapa(o, k) {
      var u = ui(o.id); u.erro = '';
      var obs = u.texto.trim();
      ocupar(o, true);
      var corpo = { status: k }; if (obs) corpo.obs = obs;
      chamar(inst, 'POST', '/oportunidades/' + encodeURIComponent(o.id) + '/etapa', corpo).then(function (r) {
        if (!inst.vivo()) return;
        u.ocupado = false;
        if (!r.ok) { u.erro = erroTexto(r); S.foco = 'obs:' + o.id; pintarLista(); return; }
        o.status = k;
        o.etapas = o.etapas.concat([{ status: k, em: new Date().toISOString(), obs: obs }]);
        u.modo = null; u.texto = ''; u.etapa = '';
        evento(inst, 'etapa_oportunidade', { id: o.id, status: k });
        S.foco = 'chip:' + o.id;
        pintarLista();
        recarregarSilencioso();
      });
    }
    function carregar() {
      S.estado = 'carregando'; pintarLista();
      chamar(inst, 'GET', '/oportunidades').then(function (r) {
        if (!inst.vivo()) return;
        if (!r.ok) { S.estado = 'erro'; S.erro = erroTexto(r); pintarLista(); return; }
        S.itens = lista(r.data, 'oportunidades').map(normOp);
        S.placarApi = r.data && !Array.isArray(r.data) ? r.data.placar || null : null;
        S.estado = 'ok';
        pintarLista();
      });
    }

    /* contagem regressiva: mexe so nos textos, nao refaz a lista (nao apaga o que a pessoa digita) */
    inst.tick = function () {
      var agora = Date.now();
      inst.contadores.forEach(function (c) {
        var t = contagem(c.iso, agora);
        if (c.node.textContent !== t) c.node.textContent = t;
        if (t === 'Prazo encerrado' && inst.botoes[c.id]) inst.botoes[c.id].forEach(function (b) { b.disabled = true; });
      });
    };
    pintarFiltros();
    carregar();
  }

  function oportunidadesBloqueadas(inst) {
    var ctx = inst.ctx, root = inst.root, nivel = str(ctx.nivel) || 'cadastrado';
    var NOMES = { cadastrado: 'Cadastrado', partner: 'Partner', pro: 'Partner Pro', master: 'Partner Master' };
    var ETAPA_N = { cadastrado: 1, partner: 2, pro: 3, master: 4 };
    var aviso = (ctx.bloqueios && typeof ctx.bloqueios.oportunidades === 'string' && ctx.bloqueios.oportunidades) || 'Libera com a primeira compra de carregador';
    aviso = aviso.charAt(0).toUpperCase() + aviso.slice(1);
    var n = ETAPA_N[nivel] || 1;

    // o que falta: do progresso da API; sem ele, dos campos do parceiro
    var ROT = {
      partner: 'Virar Partner, depois da conversa com o comercial',
      conversa: 'Fazer a conversa com o comercial da NEXUS',
      papel_montagem: 'Marcar Montagem e Engenharia no seu perfil',
      carregadores_comprados: 'Fazer a primeira compra de carregador NEXUS',
      primeira_compra: 'Fazer a primeira compra de carregador NEXUS',
      termo: 'Aceitar o Termo de Parceria',
      aceite_termo: 'Aceitar o Termo de Parceria',
      termo_aceito: 'Aceitar o Termo de Parceria',
      aprovacao_partner: 'Virar Partner, depois da conversa com o comercial',
      perfil: 'Completar o perfil da empresa'
    };
    var itens = [];
    var prog = ctx.progresso && typeof ctx.progresso === 'object' ? ctx.progresso : null;
    if (prog && Array.isArray(prog.faltam)) {
      prog.faltam.forEach(function (k) {
        var t = ROT[k] || (str(k).replace(/_/g, ' ').replace(/^./, function (m) { return m.toUpperCase(); }));
        itens.push({ t: t, feito: false });
      });
    } else {
      var p = ctx.parceiro || {};
      itens = [
        { t: ROT.partner, feito: !!p.partner_em || nivel === 'partner' || nivel === 'pro' || nivel === 'master' },
        { t: ROT.carregadores_comprados, feito: Number(p.carregadores_comprados) >= 1 },
        { t: ROT.termo, feito: !!(ctx.termo && ctx.termo.aceito_em) }
      ];
    }
    var ul = h('ul', 'nr-falta');
    itens.forEach(function (i) {
      ul.appendChild(h('li', i.feito ? 'feito' : '', [h('span', 'nr-falta-b', i.feito ? ic('ok', 'nr-ic-p') : null), h('span', null, i.t), h('span', 'nr-sr', i.feito ? ' Feito' : ' Pendente')]));
    });
    var ir = btn('Ir para Minha parceria');
    ir.addEventListener('click', function () { if (typeof ctx.irPara === 'function') ctx.irPara('#parceria'); });

    var prev = h('div', 'nr-prev', null, { 'aria-hidden': 'true' });
    [['Obra terceirizada NEXUS', 'Cidade da sua região', 'Montagem e homologação de um carregador NEXUS.'], ['Cliente para você vender', 'Cidade da sua região', 'Orçamento de carregador rápido para um ponto comercial.'], ['Cliente para você vender', 'Cidade da sua região', 'Consulta sobre um ponto para carregador.']].forEach(function (x) {
      prev.appendChild(h('div', 'nr-prev-i', [h('span', 'nr-prev-t', x[0] + ' · ' + x[1]), h('p', null, x[2])]));
    });
    var nota = h('div', 'nr-bloq-nota', [
      h('span', 'nr-bloq-ic', ic('cadeado')),
      h('p', 'nr-bloq-t', aviso),
      h('p', 'nr-dica', 'Seu nível agora: ' + (NOMES[nivel] || 'Cadastrado') + '. Etapa ' + n + ' de 4.'),
      h('div', 'nr-prog', h('span', null, null, { style: 'width:' + (n * 25) + '%' }), { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '4', 'aria-valuenow': String(n), 'aria-label': 'Progresso até Partner Pro' }),
      h('h3', 'nr-h3', 'O que falta para virar Partner Pro'),
      ul, ir
    ], { role: 'note' });
    root.appendChild(h('section', 'nr-bloq', [prev, nota]));
  }

  /* ================================================================== USINAS */
  var STATUS_USINA = { recebida: ['Recebida', 'cz'], em_analise: ['Em análise', 'av'], contrato: ['Em contrato', 'ok'], descartada: ['Encerrada', 'cz'] };

  function usinas(inst) {
    var ctx = inst.ctx, root = inst.root, libera = ctx.libera || {};
    var liberado = libera.usinas !== undefined ? !!libera.usinas : !!libera.basico;
    root.appendChild(cabecalho(inst, 'Indique uma usina', 'A rede de eletropostos precisa de energia limpa. Se você conhece usina solar com energia sobrando, indique para a NEXUS.'));
    if (!liberado) {
      root.appendChild(bloqueioPerfil(inst, 'Complete o perfil da empresa para indicar usinas', 'A indicação fica liberada quando o perfil da sua empresa está completo.'));
      return;
    }
    var S = { itens: [], estado: 'carregando', erro: '', enviando: false };
    var campos = {};
    var nome = campo(inst, 'nome', 'Nome do dono ou da empresa', entrada('text', { autocomplete: 'off', maxlength: '120' }));
    var zap = campo(inst, 'whats', 'WhatsApp', entrada('tel', { autocomplete: 'off', inputmode: 'tel', maxlength: '20' }), 'Com DDD. Exemplo: 62 90000 0000.');
    var cidade = campo(inst, 'cidade', 'Cidade', entrada('text', { autocomplete: 'off', maxlength: '80' }));
    var uf = campo(inst, 'uf', 'UF', selectUF());
    var dist = campo(inst, 'dist', 'Distribuidora (opcional)', entrada('text', { autocomplete: 'off', maxlength: '80' }));
    var kwp = campo(inst, 'kwp', 'Potência instalada (kWp)', entrada('text', { inputmode: 'decimal', autocomplete: 'off' }));
    var ger = campo(inst, 'ger', 'Geração média, em kWh por mês (opcional)', entrada('text', { inputmode: 'decimal', autocomplete: 'off' }));
    var disp = campo(inst, 'disp', 'Energia disponível para venda, em kWh por mês (opcional)', entrada('text', { inputmode: 'decimal', autocomplete: 'off' }), null, 'nr-inteira');
    var obs = campo(inst, 'obs', 'Observações (opcional)', h('textarea', 'nr-ta', '', { rows: '4', maxlength: '800' }), null, 'nr-inteira');
    campos = { nome: nome, whats: zap, cidade: cidade, uf: uf, kwp: kwp, ger: ger, disp: disp };

    var fs = h('fieldset', 'nr-fs');
    fs.appendChild(h('legend', null, 'Interesse'));
    var opcoes = h('div', 'nr-radios');
    [['vender_creditos', 'Vender créditos de energia'], ['alugar', 'Alugar a usina'], ['outro', 'Outro']].forEach(function (x, i) {
      var r = entrada('radio', { name: inst.pfx + 'interesse', value: x[0], id: inst.pfx + 'i-' + x[0] });
      if (i === 0) r.checked = true;
      opcoes.appendChild(h('label', 'nr-radio', [r, x[1]], { 'for': inst.pfx + 'i-' + x[0] }));
    });
    fs.appendChild(opcoes);

    var msg = h('div', 'nr-msg', null, { 'aria-live': 'polite' });
    var enviar = btn('Enviar indicação', 'grande', 'submit');
    var form = h('form', 'nr-cartao nr-form', [
      h('div', 'nr-grade', [nome.wrap, zap.wrap, cidade.wrap, uf.wrap, dist.wrap, kwp.wrap, ger.wrap, disp.wrap]),
      fs, obs.wrap,
      h('div', 'nr-form-rodape', [enviar, msg])
    ], { novalidate: true });

    function validar() {
      var e = {}, v = {};
      v.dono_nome = nome.el.value.trim();
      if (v.dono_nome.length < 2) e.nome = 'Informe o nome do dono ou da empresa.';
      v.whatsapp = fone(zap.el.value);
      if (!v.whatsapp) e.whats = 'Informe um WhatsApp com DDD, de 10 ou 11 números.';
      v.cidade = cidade.el.value.trim();
      if (v.cidade.length < 2) e.cidade = 'Informe a cidade da usina.';
      v.uf = uf.el.value;
      if (UFS.indexOf(v.uf) < 0) e.uf = 'Escolha a UF.';
      v.distribuidora = dist.el.value.trim();
      var k = numero(kwp.el.value);
      if (k == null) e.kwp = 'Informe a potência instalada em kWp.';
      else if (isNaN(k) || k <= 0 || k > 1000000) e.kwp = 'Use só números, maior que zero. Exemplo: 300 ou 12,5.';
      v.potencia_kwp = k;
      var g = numero(ger.el.value);
      if (g != null && (isNaN(g) || g < 0 || g > 1e9)) e.ger = 'Use só números, zero ou maior. Exemplo: 40000.';
      v.geracao_kwh_mes = g;
      var d = numero(disp.el.value);
      if (d != null && (isNaN(d) || d < 0 || d > 1e9)) e.disp = 'Use só números, zero ou maior. Exemplo: 20000.';
      else if (d != null && g != null && !isNaN(g) && d > g) e.disp = 'A energia disponível não pode ser maior que a geração média.';
      v.disponivel_kwh_mes = d;
      var rs = form.querySelectorAll('input[type=radio]'), sel = 'vender_creditos';
      for (var i = 0; i < rs.length; i++) if (rs[i].checked) sel = rs[i].value;
      v.interesse = sel;
      v.obs = obs.el.value.trim();
      return { e: e, v: v };
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (S.enviando) return;
      limpar(msg);
      var r = validar();
      if (mostrarErros(campos, r.e)) { msg.appendChild(h('p', 'nr-msg-erro', 'Confira os campos marcados e envie de novo.', { role: 'alert' })); return; }
      S.enviando = true; enviar.disabled = true; enviar.textContent = 'Enviando';
      chamar(inst, 'POST', '/usinas', r.v).then(function (res) {
        if (!inst.vivo()) return;
        S.enviando = false; enviar.disabled = false; enviar.textContent = 'Enviar indicação';
        limpar(msg);
        if (!res.ok) { msg.appendChild(h('p', 'nr-msg-erro', erroTexto(res), { role: 'alert' })); return; }
        evento(inst, 'indicou_usina', { uf: r.v.uf });
        msg.appendChild(h('p', 'nr-msg-ok', [ic('ok', 'nr-ic-p'), 'Indicação recebida. Você acompanha o andamento em Suas indicações.'], { role: 'status' }));
        form.reset();
        var nova = res.data && typeof res.data === 'object' && res.data.id ? res.data : {};
        S.itens.unshift({
          id: str(nova.id) || 'novo' + Date.now(), dono_nome: r.v.dono_nome, potencia_kwp: r.v.potencia_kwp, cidade: r.v.cidade, uf: r.v.uf,
          status: str(nova.status) || 'recebida', created_at: nova.created_at || new Date().toISOString()
        });
        S.estado = 'ok';
        pintarLista();
        if (!ctx.demo) recarregar();
      });
    });

    var areaLista = h('div', 'nr-ind-corpo');
    var lado = h('aside', 'nr-lado', [
      h('section', 'nr-regras', h('p', 'nr-regras-p', 'A equipe NEXUS avalia cada usina e retorna para você.')),
      h('section', 'nr-cartao', [h('div', 'nr-tit-linha', [h('h2', 'nr-h2', 'Suas indicações'), ctx.demo ? h('span', 'nr-selo-demo', 'Dados de exemplo') : null]), areaLista])
    ], { 'aria-label': 'Suas indicações' });
    root.appendChild(h('div', 'nr-duas', [h('section', 'nr-principal', form), lado]));

    function pintarLista() {
      limpar(areaLista);
      if (S.estado === 'carregando') { areaLista.appendChild(esqueleto(2, 'Carregando indicações')); return; }
      if (S.estado === 'erro') { areaLista.appendChild(estadoErro(S.erro, recarregar)); return; }
      if (!S.itens.length) { areaLista.appendChild(h('div', 'nr-estado', [h('p', 'nr-estado-t', 'Nenhuma indicação ainda'), h('p', 'nr-estado-p', 'Quando você indicar uma usina, ela aparece aqui com o andamento.')])); return; }
      var ul = h('ul', 'nr-ind');
      S.itens.forEach(function (u) {
        var st = STATUS_USINA[u.status] || [str(u.status) || 'Recebida', 'cz'];
        var kw = Number(u.potencia_kwp);
        var titulo = !isNaN(kw) && u.potencia_kwp != null && u.potencia_kwp !== '' ? 'Usina de ' + fmtNum(kw) + ' kWp' : (str(u.dono_nome) || 'Usina');
        var local = str(u.cidade) + (u.uf ? '/' + str(u.uf) : '');
        var data = fmtData(u.created_at);
        ul.appendChild(h('li', 'nr-ind-i', [
          h('div', 'nr-ind-t', [h('span', 'nr-ind-n', titulo), h('span', 'nr-ind-l', [local, data ? (local ? ' · ' : '') + 'Enviada em ' + data : ''])]),
          chip(st[0], st[1])
        ]));
      });
      areaLista.appendChild(ul);
    }
    function recarregar() {
      if (!S.itens.length) { S.estado = 'carregando'; pintarLista(); }
      chamar(inst, 'GET', '/usinas').then(function (r) {
        if (!inst.vivo()) return;
        if (!r.ok) { if (!S.itens.length) { S.estado = 'erro'; S.erro = erroTexto(r); } pintarLista(); return; }
        S.itens = lista(r.data, 'usinas').slice(); S.estado = 'ok'; pintarLista();
      });
    }
    recarregar();
  }

  function bloqueioPerfil(inst, titulo, texto) {
    var ir = btn('Completar o perfil');
    ir.addEventListener('click', function () { if (typeof inst.ctx.irPara === 'function') inst.ctx.irPara('#perfil'); });
    return h('section', 'nr-cartao nr-trava', [
      h('span', 'nr-bloq-ic', ic('cadeado')),
      h('p', 'nr-bloq-t', titulo),
      h('p', 'nr-estado-p', texto),
      ir
    ]);
  }

  /* ================================================================== ENGENHARIA */
  var SERVICOS = [
    ['projeto_eletrico', 'Projeto elétrico'], ['art', 'ART'], ['estudo_entrada', 'Estudo da entrada de energia'],
    ['homologacao', 'Homologação na distribuidora'], ['outro', 'Outro']
  ];
  var STATUS_SOLIC = { aberta: ['Aberta', 'av'], em_andamento: ['Em andamento', ''], concluida: ['Concluída', 'ok'], cancelada: ['Cancelada', 'cz'] };

  function engenharia(inst) {
    var ctx = inst.ctx, root = inst.root, libera = ctx.libera || {};
    var cab = cabecalho(inst, 'Engenharia NEXUS', 'Precisa de projeto elétrico, ART, estudo da entrada de energia ou homologação na distribuidora? A NEXUS faz para você.');
    root.appendChild(cab);
    if (!libera.engenharia) {
      root.appendChild(bloqueioPerfil(inst, 'Complete o perfil da empresa para pedir engenharia', 'O pedido fica liberado quando o perfil da sua empresa está completo.'));
      return;
    }
    var S = { itens: [], estado: 'carregando', erro: '', enviando: false };
    var sel = document.createElement('select');
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Selecione'; sel.appendChild(o0);
    SERVICOS.forEach(function (s) { var o = document.createElement('option'); o.value = s[0]; o.textContent = s[1]; sel.appendChild(o); });
    var serv = campo(inst, 'servico', 'Tipo de serviço', sel);
    var cidade = campo(inst, 'cidade', 'Cidade do ponto', entrada('text', { autocomplete: 'off', maxlength: '80' }));
    var uf = campo(inst, 'uf', 'UF do ponto', selectUF());
    var pot = campo(inst, 'pot', 'Potência do carregador, em kW (opcional)', entrada('text', { inputmode: 'decimal', autocomplete: 'off' }), 'Exemplo: 80 ou 120.');
    var desc = campo(inst, 'desc', 'Descrição do que você precisa', h('textarea', 'nr-ta', '', { rows: '4', maxlength: '1000' }), 'Conte o que já existe no ponto e o que falta.', 'nr-inteira');
    var campos = { servico: serv, cidade: cidade, uf: uf, pot: pot, desc: desc };

    /* saldo de pacotes: com projeto disponivel, o pedido pode consumir 1 (usa_pacote); sem saldo, leva aos pacotes em Servicos NEXUS */
    var sd = ctx.saldo_engenharia && typeof ctx.saldo_engenharia === 'object' ? ctx.saldo_engenharia : null;
    var comprados = sd ? (Number(sd.comprados) || 0) : 0;
    var disp = sd ? (Number(sd.disponiveis) || 0) : 0;
    var usaPac = entrada('checkbox', { id: inst.pfx + 'pacote' });
    var usaTxt = h('span', null, '');
    var usaRot = h('label', 'nr-radio nr-usa-pacote', [usaPac, usaTxt], { 'for': inst.pfx + 'pacote' });
    var saldoTxt = h('p', 'nr-regras-p', '');
    var irPacotes = btn('Ver os pacotes', 'sec');
    irPacotes.addEventListener('click', function () { if (typeof ctx.irPara === 'function') ctx.irPara('#servicos'); });
    function pintarSaldo() {
      if (comprados > 0) saldoTxt.textContent = 'Seu saldo de pacotes: ' + disp + (disp === 1 ? ' projeto disponível' : ' projetos disponíveis') + ' de ' + comprados + ' comprados.';
      else saldoTxt.textContent = 'Precisa de vários projetos? Os pacotes de 3, 5 e 10 ficam em Serviços NEXUS, com preço de parceiro negociado com o comercial.';
      usaTxt.textContent = 'Usar 1 projeto do meu pacote (saldo: ' + disp + ')';
      usaRot.hidden = disp <= 0;
      if (disp <= 0) usaPac.checked = false;
    }
    pintarSaldo();
    root.appendChild(h('section', 'nr-regras nr-saldo-eng', [saldoTxt, irPacotes]));
    var msg = h('div', 'nr-msg', null, { 'aria-live': 'polite' });
    var enviar = btn('Pedir engenharia', 'grande', 'submit');
    var form = h('form', 'nr-cartao nr-form', [
      h('div', 'nr-grade', [serv.wrap, pot.wrap, cidade.wrap, uf.wrap, desc.wrap]),
      usaRot,
      h('div', 'nr-form-rodape', [enviar, msg])
    ], { novalidate: true });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (S.enviando) return;
      limpar(msg);
      var e = {}, nomeServ = '';
      SERVICOS.forEach(function (s) { if (s[0] === serv.el.value) nomeServ = s[1]; });
      if (!nomeServ) e.servico = 'Escolha o tipo de serviço.';
      var c = cidade.el.value.trim();
      if (c.length < 2) e.cidade = 'Informe a cidade do ponto.';
      if (UFS.indexOf(uf.el.value) < 0) e.uf = 'Escolha a UF.';
      var p = numero(pot.el.value);
      if (p != null && (isNaN(p) || p <= 0 || p > 10000)) e.pot = 'Use só números, maior que zero. Exemplo: 80 ou 120.';
      var d = desc.el.value.trim();
      if (d.length < 5) e.desc = 'Descreva em poucas palavras o que você precisa.';
      if (mostrarErros(campos, e)) { msg.appendChild(h('p', 'nr-msg-erro', 'Confira os campos marcados e envie de novo.', { role: 'alert' })); return; }
      var dados = { servico: serv.el.value, servico_nome: nomeServ, cidade: c, uf: uf.el.value, descricao: d };
      if (p != null) dados.potencia_kw = p;
      var usou = !!(usaPac.checked && disp > 0);
      if (usou) dados.usa_pacote = true;
      S.enviando = true; enviar.disabled = true; enviar.textContent = 'Enviando';
      chamar(inst, 'POST', '/solicitacoes', { tipo: 'engenharia', dados: dados }).then(function (res) {
        if (!inst.vivo()) return;
        S.enviando = false; enviar.disabled = false; enviar.textContent = 'Pedir engenharia';
        limpar(msg);
        if (!res.ok) {
          var cod = res.data && (res.data.erro || res.data.error);
          var texto = cod === 'sem_saldo' ? 'Você não tem projeto disponível no pacote. Desmarque a opção ou compre um pacote em Serviços NEXUS.' : erroTexto(res);
          if (cod === 'sem_saldo') { disp = 0; pintarSaldo(); }
          msg.appendChild(h('p', 'nr-msg-erro', texto, { role: 'alert' }));
          return;
        }
        evento(inst, 'pediu_engenharia', { servico: dados.servico, uf: dados.uf, usa_pacote: usou });
        if (usou) { disp = Math.max(0, disp - 1); pintarSaldo(); if (typeof ctx.atualizar === 'function') { try { ctx.atualizar(); } catch (e) { /* o saldo local ja foi atualizado */ } } }
        msg.appendChild(h('p', 'nr-msg-ok', [ic('ok', 'nr-ic-p'), 'Pedido recebido. A equipe NEXUS retorna para você.'], { role: 'status' }));
        form.reset();
        var nova = res.data && typeof res.data === 'object' && res.data.id ? res.data : {};
        S.itens.unshift({ id: str(nova.id) || 'novo' + Date.now(), tipo: 'engenharia', dados: dados, status: str(nova.status) || 'aberta', created_at: nova.created_at || new Date().toISOString() });
        S.estado = 'ok';
        pintarLista();
        if (!ctx.demo) recarregar();
      });
    });

    var areaLista = h('div', 'nr-ind-corpo');
    var lado = h('aside', 'nr-lado', [
      h('section', 'nr-cartao', [h('div', 'nr-tit-linha', [h('h2', 'nr-h2', 'Seus pedidos de engenharia'), ctx.demo ? h('span', 'nr-selo-demo', 'Dados de exemplo') : null]), areaLista])
    ], { 'aria-label': 'Seus pedidos de engenharia' });
    root.appendChild(h('div', 'nr-duas', [h('section', 'nr-principal', form), lado]));

    function pintarLista() {
      limpar(areaLista);
      if (S.estado === 'carregando') { areaLista.appendChild(esqueleto(2, 'Carregando pedidos')); return; }
      if (S.estado === 'erro') { areaLista.appendChild(estadoErro(S.erro, recarregar)); return; }
      if (!S.itens.length) { areaLista.appendChild(h('div', 'nr-estado', [h('p', 'nr-estado-t', 'Nenhum pedido ainda'), h('p', 'nr-estado-p', 'Quando você pedir um serviço de engenharia, ele aparece aqui com o andamento.')])); return; }
      var ul = h('ul', 'nr-ind');
      S.itens.forEach(function (s) {
        var d = s.dados && typeof s.dados === 'object' ? s.dados : {};
        var st = STATUS_SOLIC[s.status] || [str(s.status) || 'Aberta', 'cz'];
        var nomeS = str(d.servico_nome);
        if (!nomeS) SERVICOS.forEach(function (x) { if (x[0] === d.servico) nomeS = x[1]; });
        var local = str(d.cidade) + (d.uf ? '/' + str(d.uf) : '');
        var data = fmtData(s.created_at);
        var meta = [local, d.potencia_kw != null && d.potencia_kw !== '' ? fmtNum(d.potencia_kw) + ' kW' : '', data ? 'Enviado em ' + data : ''].filter(Boolean).join(' · ');
        var li = h('li', 'nr-ind-i', [
          h('div', 'nr-ind-t', [h('span', 'nr-ind-n', nomeS || 'Engenharia'), h('span', 'nr-ind-l', meta)]),
          chip(st[0], st[1])
        ]);
        if (d.usa_pacote) li.appendChild(h('p', 'nr-retorno', [h('b', null, 'Pago com o pacote: '), 'Usou 1 projeto do saldo.']));
        if (s.obs_equipe) li.appendChild(h('p', 'nr-retorno', [h('b', null, 'Retorno da equipe: '), str(s.obs_equipe)]));
        ul.appendChild(li);
      });
      areaLista.appendChild(ul);
    }
    function recarregar() {
      if (!S.itens.length) { S.estado = 'carregando'; pintarLista(); }
      chamar(inst, 'GET', '/solicitacoes').then(function (r) {
        if (!inst.vivo()) return;
        if (!r.ok) { if (!S.itens.length) { S.estado = 'erro'; S.erro = erroTexto(r); } pintarLista(); return; }
        // a API devolve todos os tipos de solicitacao; aqui entram so os de engenharia
        S.itens = lista(r.data, 'solicitacoes').filter(function (s) { return s && s.tipo === 'engenharia'; });
        S.estado = 'ok'; pintarLista();
      });
    }
    recarregar();
  }

  /* ================================================================== entrada */
  function montar(container, tela, ctx) {
    if (!container) return;
    if (timer) { clearInterval(timer); timer = null; }
    var meu = ++seq;
    ctx = ctx || {};
    limpar(container);
    var root = h('div', 'nr nr-' + tela);
    container.appendChild(root);
    var inst = {
      ctx: ctx, root: root, pfx: 'nr' + (++uid) + '-', contadores: [], botoes: {}, tick: null,
      vivo: function () { return meu === seq && document.body.contains(root); }
    };
    var fn = tela === 'oportunidades' ? oportunidades : tela === 'usinas' ? usinas : tela === 'engenharia' ? engenharia : null;
    if (!fn) { root.appendChild(estadoVazio('Tela não encontrada', 'Volte ao início e escolha outra opção.')); return; }
    fn(inst);
    if (inst.tick) {
      timer = setInterval(function () {
        if (!inst.vivo()) { clearInterval(timer); timer = null; return; }
        inst.tick();
      }, 30000);
    }
    return inst;
  }

  window.NexusRede = { montar: montar, _numero: numero, _contagem: contagem };
})();
