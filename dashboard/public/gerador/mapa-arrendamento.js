// ─────────────────────────────────────────────────────────────────────────────
// MAPA DO ARRENDAMENTO (08/10/2026)
//
// Pedido do Thiago: ver no mapa, dentro do gerador, todo mundo da aba
// Arrendamento, clicar no pino e já ler tudo daquele endereço.
//
// A LISTA É A DA ABA, NÃO UMA CÓPIA. O mapa lê `cadDados.ponto`, que a aba já
// montou com a regra (cadEhOpcaoArrendamento), a posse (cadPosseDe) e a reunião
// mais nova (cadAgendaDe). Uma terceira cópia da regra aqui seria a tela e o
// mapa discordando em silêncio no dia em que a regra mudar.
//
// SÓ O ENDEREÇO SAI DA PÁGINA. Pra API vão o endereço, a cidade e o DDD; nome e
// telefone ficam aqui. A API devolve coordenada e PRECISÃO (número, CEP, rua,
// bairro, cidade), e o pino aproximado é desenhado diferente: pino no centro da
// cidade com cara de pino na porta leva a equipe ao lugar errado.
//
// A primeira abertura geocodifica o que ainda não está no cache, alguns por
// chamada (o Nominatim aceita 1 por segundo); depois abre na hora.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  var API = (location.hostname === 'localhost' ? 'http://localhost:3001' : '/_api') + '/io/eletroposto/geo';
  var DISSE_NAO = { sem_interesse: 1, perdido: 1 };
  var CAT = {
    dono:    { cor: '#16a34a', kml: 'grn', txt: 'Proprietário' },
    outro:   { cor: '#f59e0b', kml: 'ylw', txt: 'Pode ceder, mas não é o dono' },
    semresp: { cor: '#3b82f6', kml: 'blu', txt: 'ARRENDAMENTO sem dizer de quem é o local' },
    nao:     { cor: '#dc2626', kml: 'red', txt: 'Disse não (sem interesse ou perdido)' },
  };
  var PREC = {
    numero: 'no número da rua',
    cep: 'no CEP (trecho da rua)',
    rua: 'na rua (número não achado no mapa)',
    bairro: 'no bairro (rua não achada no mapa)',
    cidade: 'no centro da cidade (endereço não achado no mapa)',
  };
  var APROX = { bairro: 1, cidade: 1 };
  var UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
    MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco',
    PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia',
    RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };

  var mapa = null, camada = null, pessoas = [], enquadrou = false, rodando = false;
  var ligado = { dono: true, outro: true, semresp: true, nao: false };
  // Coordenada já achada nesta sessão, por endereço: reabrir o mapa não chama a API de novo.
  var achados = {};

  var esc = function (s) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s))
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var soDig = function (t) { return String(t || '').replace(/\D/g, ''); };
  var $ = function (id) { return document.getElementById(id); };

  // ── Leaflet, só quando alguém abre o mapa ────────────────────────────────
  var leafletPronto = null;
  function carregarLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletPronto) return leafletPronto;
    leafletPronto = new Promise(function (ok, falha) {
      var css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = LEAFLET + 'leaflet.min.js';
      js.onload = function () { ok(); };
      js.onerror = function () { leafletPronto = null; falha(new Error('não consegui baixar o mapa (Leaflet)')); };
      document.head.appendChild(js);
    });
    return leafletPronto;
  }

  // ── A tela ───────────────────────────────────────────────────────────────
  function montarTela() {
    if ($('marr')) return;
    var st = document.createElement('style');
    st.textContent = ''
      + '#marr{position:fixed;inset:0;z-index:9000;background:#0b1220;display:flex;flex-direction:column;color:#e2e8f0;font-family:inherit}'
      + '#marr[hidden]{display:none}'
      + '.marr-topo{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(148,163,184,.2);background:#0f172a}'
      + '.marr-tit{font-weight:700;font-size:15px;margin-right:4px}'
      + '.marr-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 auto}'
      + '.marr-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(148,163,184,.3);background:rgba(15,23,42,.6);color:#e2e8f0;border-radius:999px;padding:5px 11px;font-size:12.5px;cursor:pointer}'
      + '.marr-chip[aria-pressed="false"]{opacity:.45}'
      + '.marr-chip i{width:10px;height:10px;border-radius:50%;display:inline-block}'
      + '.marr-chip b{font-variant-numeric:tabular-nums}'
      + '.marr-acoes{display:flex;gap:8px;margin-left:auto}'
      + '.marr-btn{border:1px solid rgba(148,163,184,.35);background:#1e293b;color:#e2e8f0;border-radius:9px;padding:7px 12px;font-size:13px;cursor:pointer;white-space:nowrap}'
      + '.marr-btn.pri{background:#2563eb;border-color:#2563eb}'
      + '.marr-btn:disabled{opacity:.5;cursor:default}'
      + '.marr-status{width:100%;font-size:12.5px;color:#94a3b8;line-height:1.45}'
      + '.marr-status.erro{color:#fca5a5}'
      + '#marr-mapa{flex:1 1 auto;min-height:0}'
      + '.marr-pop{font-size:13px;line-height:1.5;color:#0f172a;max-width:300px}'
      + '.marr-pop .n{font-size:15px;font-weight:700}'
      + '.marr-pop .s{color:#475569;margin-bottom:6px}'
      + '.marr-pop .ap{color:#b45309}'
      + '.marr-pop a{color:#1d4ed8;font-weight:600}'
      + '.marr-pop .lk{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 10px}'
      + '@media (max-width:640px){.marr-acoes{margin-left:0;width:100%}.marr-acoes .marr-btn{flex:1}}';
    document.head.appendChild(st);

    var el = document.createElement('div');
    el.id = 'marr';
    el.hidden = true;
    el.innerHTML = ''
      + '<div class="marr-topo">'
      +   '<span class="marr-tit">Mapa do Arrendamento</span>'
      +   '<div class="marr-chips" id="marr-chips"></div>'
      +   '<div class="marr-acoes">'
      +     '<button type="button" class="marr-btn" id="marr-kml" disabled title="Baixa o arquivo .kml: no Google Earth, Projetos, Novo projeto, Importar arquivo KML">Baixar para o Google Earth</button>'
      +     '<button type="button" class="marr-btn pri" id="marr-fechar">Fechar</button>'
      +   '</div>'
      +   '<div class="marr-status" id="marr-status">Carregando…</div>'
      + '</div>'
      + '<div id="marr-mapa"></div>';
    document.body.appendChild(el);
    $('marr-fechar').onclick = fechar;
    $('marr-kml').onclick = baixarKml;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('marr').hidden) fechar(); });
  }

  function status(txt, erro) {
    var s = $('marr-status');
    if (!s) return;
    s.innerHTML = txt;
    s.classList.toggle('erro', !!erro);
  }

  // ── A lista: a da aba, com o que o mapa precisa ──────────────────────────
  var CAMPOS_OBS = [
    ['Situação do ponto', /^Ponto:\s*([^\n]+)/im],
    ['Vagas', /Vagas dispon[ií]veis:\s*([^\n]+)/i],
    ['Entrada trifásica', /Entrada trif[aá]sica:\s*([^\n]+)/i],
    ['Rota de passagem', /Rota de passagem:\s*([^\n]+)/i],
    ['Modelo de interesse', /Modelo de interesse:\s*([^\n]+)/i],
    ['Decisor', /Decisor:\s*([^\n]+)/i],
  ];
  function montarPessoas() {
    var lista = (typeof cadDados !== 'undefined' && cadDados && cadDados.ponto) || [];
    pessoas = lista.map(function (r) {
      var t8 = cadTel8(r.telefone);
      var obs = (typeof cadObsPorTel !== 'undefined' && cadObsPorTel.get(t8)) || [];
      var endereco = String(r.ponto_endereco || '').trim();
      if (!endereco) {
        for (var i = 0; i < obs.length && !endereco; i++) {
          var m = String(obs[i]).match(/Endere[çc]o:\s*([^\n]+)/i);
          if (m) endereco = m[1].trim();
        }
      }
      var ag = cadAgendaDe(r);
      var posse = cadPosseDe(r);
      var cat = ag && DISSE_NAO[ag.status] ? 'nao'
        : posse === 'pro' ? 'dono' : (posse === 'inq' || posse === 'rep') ? 'outro' : 'semresp';
      var dig = soDig(r.telefone);
      if (dig.length >= 12 && dig.indexOf('55') === 0) dig = dig.slice(2);
      var det = [];
      if (!r.deAgenda && !r.deFicha) {
        if (r.ponto_tipo) det.push(['Tipo do local', r.ponto_tipo]);
        if (r.ponto_vagas) det.push(['Vagas', r.ponto_vagas]);
        if (r.ponto_fluxo) det.push(['Movimento', r.ponto_fluxo]);
        if (r.ponto_energia) det.push(['Energia', r.ponto_energia]);
      }
      var texto = obs.join('\n');
      CAMPOS_OBS.forEach(function (c) {
        if (det.some(function (d) { return d[0] === c[0]; })) return;
        var m = texto.match(c[1]);
        if (m) det.push([c[0], m[1].trim()]);
      });
      return {
        k: cadRef(r), r: r, nome: r.nome || '(sem nome)', relacao: r.ponto_relacao || cadRelacaoDaFicha(r) || '',
        cat: cat, ag: ag, endereco: endereco, cidade: r.cidade || '', ddd: dig.slice(0, 2), dig: dig, det: det,
        origem: r.deAgenda ? 'reunião da LP' : r.deFicha ? 'ficha do quiz' : 'cadastro de parceria',
        geo: achados[endereco + '|' + (r.cidade || '')] || null, semCidade: false,
      };
    });
  }

  // ── Coordenadas: o cache da API primeiro, depois alguns novos por chamada ──
  function localizarTodos() {
    var faltam = function () { return pessoas.filter(function (p) { return !p.geo && !p.semCidade; }); };
    var total = pessoas.length;
    var rodada = function (n) {
      var pend = faltam();
      if (!pend.length || n > 60) return Promise.resolve();
      var vistos = {};
      var itens = pend.filter(function (p) { if (vistos[p.k]) return false; vistos[p.k] = 1; return true; })
        .map(function (p) { return { k: p.k, endereco: p.endereco, cidade: p.cidade, ddd: p.ddd }; });
      return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itens }) })
        .then(function (r) {
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
            throw new Error(j.error || ('HTTP ' + r.status)); });
          return r.json();
        })
        .then(function (j) {
          var novos = 0;
          pend.forEach(function (p) {
            if (!(p.k in j.pontos)) return;
            novos++;
            if (j.pontos[p.k]) { p.geo = j.pontos[p.k]; achados[p.endereco + '|' + p.cidade] = p.geo; }
            else p.semCidade = true;
          });
          desenhar();
          var prontos = pessoas.filter(function (p) { return p.geo || p.semCidade; }).length;
          if (j.pendentes > 0) {
            status('Localizando os endereços: <b>' + prontos + ' de ' + total + '</b>. Na primeira vez leva alguns minutos; '
              + 'depois o mapa abre na hora.');
            // Chamada que não andou nada: parar é melhor que martelar a API.
            if (!novos) throw new Error('a localização parou de andar');
            return rodada(n + 1);
          }
        });
    };
    return rodada(1);
  }

  // ── O CEP pelo navegador ─────────────────────────────────────────────────
  // O servidor toma HTTP 429 da AwesomeAPI (o IP da Vercel é dividido com muita
  // gente) e o ponto volta `parcial`: na rua, no bairro ou na cidade, sem o CEP.
  // O navegador da equipe não toma esse limite. Então ele busca o CEP daqui, com
  // a MESMA conferência do servidor (mesma UF; mesma cidade ou a menos de 15 km;
  // nunca a mais de 60 km), e melhora o pino SÓ nesta tela. Nada volta pro
  // servidor: aceitar ponto mandado pelo navegador seria uma porta aberta pra
  // qualquer um mexer no mapa da equipe.
  var CEP_GUARDA = 'marr-cep-v1:';
  function cepDoEndereco(e) {
    var s = String(e || '');
    var m = s.match(/CEP\s*:?\s*(\d{5})-?(\d{3})\b/i) || s.match(/\b(\d{5})-(\d{3})\b/);
    return m ? m[1] + m[2] : null;
  }
  var semAcento = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); };
  function km(a, b) {
    var r = function (g) { return g * Math.PI / 180; };
    var s = Math.pow(Math.sin(r(b.lat - a.lat) / 2), 2)
      + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.pow(Math.sin(r(b.lng - a.lng) / 2), 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function buscarCep(cep) {
    try {
      var g = localStorage.getItem(CEP_GUARDA + cep);
      if (g) return Promise.resolve(g === 'x' ? null : JSON.parse(g));
    } catch (e) { /* sem armazenamento: busca de novo */ }
    return fetch('https://cep.awesomeapi.com.br/json/' + cep).then(function (r) {
      if (r.status === 404) { try { localStorage.setItem(CEP_GUARDA + cep, 'x'); } catch (e) {} return null; }
      if (!r.ok) return null;   // limite ou fora do ar: não guarda, tenta na próxima abertura
      return r.json().then(function (j) {
        var c = j && j.lat && j.lng ? { lat: Number(j.lat), lng: Number(j.lng), cidade: j.city || '', uf: j.state || '' } : null;
        try { localStorage.setItem(CEP_GUARDA + cep, c ? JSON.stringify(c) : 'x'); } catch (e) {}
        return c;
      });
    }).catch(function () { return null; });
  }
  function refinarPeloCep() {
    var alvos = pessoas.filter(function (p) {
      var cep = p.geo && p.geo.parcial && !p.cepFeito && cepDoEndereco(p.endereco);
      return cep && !/000$/.test(cep);
    });
    if (!alvos.length) return Promise.resolve();
    var i = 0, feitos = 0;
    var vez = function () {
      if (i >= alvos.length) return Promise.resolve();
      var p = alvos[i++];
      return buscarCep(cepDoEndereco(p.endereco)).then(function (c) {
        p.cepFeito = true;
        feitos++;
        if (!c || c.uf !== p.geo.uf) return;
        var d = km(c, p.geo);
        if (d >= 60 || (semAcento(c.cidade) !== semAcento(p.geo.municipio) && d >= 15)) return;
        // Rua e CEP concordando, fica a rua (mais perto do número). Discordando, o CEP manda.
        if ((p.geo.precisao === 'rua' || p.geo.precisao === 'numero') && d < 2) return;
        p.geo = { lat: c.lat, lng: c.lng, precisao: 'cep', municipio: p.geo.municipio, uf: p.geo.uf };
        achados[p.endereco + '|' + p.cidade] = p.geo;
      }).then(function () {
        if (feitos % 10 === 0) {
          status('Refinando os pinos pelo CEP: <b>' + feitos + ' de ' + alvos.length + '</b>.');
          desenhar();
        }
        return vez();
      });
    };
    status('Refinando os pinos pelo CEP: <b>0 de ' + alvos.length + '</b>.');
    return Promise.all([vez(), vez(), vez()]).then(desenhar);
  }

  // ── Desenho ──────────────────────────────────────────────────────────────
  function popup(p) {
    var a = p.ag, g = p.geo;
    var h = '<div class="marr-pop"><div class="n">' + esc(p.nome) + '</div>'
      + '<div class="s">' + esc(CAT[p.cat].txt) + (p.relacao ? ' · resposta: ' + esc(p.relacao) : '') + '</div>'
      + '<b>Endereço:</b> ' + (p.endereco ? esc(p.endereco) : '<i>não informado</i>') + '<br>'
      + (g ? '<b>Cidade:</b> ' + esc(g.municipio + '-' + g.uf) + '<br>' : '')
      + (g ? '<b>Pino:</b> <span class="' + (APROX[g.precisao] ? 'ap' : '') + '">' + esc(PREC[g.precisao]) + '</span><br>' : '')
      + '<b>Telefone:</b> ' + esc(p.dig.length === 11 ? '(' + p.dig.slice(0, 2) + ') ' + p.dig.slice(2, 7) + '-' + p.dig.slice(7)
        : p.dig.length === 10 ? '(' + p.dig.slice(0, 2) + ') ' + p.dig.slice(2, 6) + '-' + p.dig.slice(6) : p.dig);
    if (p.dig.length >= 10) {
      h += ' · <a href="https://wa.me/55' + p.dig + '" target="_blank" rel="noopener">WhatsApp</a>'
        + ' · <a href="tel:+55' + p.dig + '">Ligar</a>';
    }
    h += '<br>';
    if (a) {
      var st = (typeof CAD_AG_STATUS !== 'undefined' && CAD_AG_STATUS[a.status || 'agendado']) || String(a.status || '').toUpperCase();
      var quando = a.quando ? new Date(a.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      h += '<b>Reunião:</b> ' + esc(st) + ' · ' + esc(a.vendedor_nome || 'sem vendedor') + (quando ? ' · ' + esc(quando) : '')
        + ' · <a href="/gerador/agenda?ag=' + encodeURIComponent(a.id) + '&amp;ver=1" target="_blank" rel="noopener">Abrir card</a><br>';
    } else {
      h += '<b>Reunião:</b> nenhuma marcada<br>';
    }
    p.det.forEach(function (d) { h += '<b>' + esc(d[0]) + ':</b> ' + esc(d[1]) + '<br>'; });
    h += '<b>Entrou por:</b> ' + esc(p.origem) + '<br>';
    if (g) {
      var busca = encodeURIComponent(p.endereco || (g.municipio + '-' + g.uf));
      var ll = g.lat.toFixed(6) + ',' + g.lng.toFixed(6);
      h += '<div class="lk">'
        + '<a href="https://www.google.com/maps/search/?api=1&amp;query=' + busca + '" target="_blank" rel="noopener">Google Maps</a>'
        + '<a href="https://www.google.com/maps/@?api=1&amp;map_action=pano&amp;viewpoint=' + ll + '" target="_blank" rel="noopener">Street View</a>'
        + '<a href="https://earth.google.com/web/@' + ll + ',0a,700d,35y,0h,45t,0r" target="_blank" rel="noopener">Google Earth</a>'
        + '</div>';
    }
    return h + '</div>';
  }

  // Pinos no mesmo ponto se abrem em espiral; senão viram um pino só de clicar.
  function posicoes(lista) {
    var grupos = {};
    lista.forEach(function (p) {
      var k = p.geo.lat.toFixed(4) + ',' + p.geo.lng.toFixed(4);
      (grupos[k] = grupos[k] || []).push(p);
    });
    var pos = new Map();
    Object.keys(grupos).forEach(function (k) {
      grupos[k].forEach(function (p, i) {
        if (!i) { pos.set(p, [p.geo.lat, p.geo.lng]); return; }
        var passo = p.geo.precisao === 'cidade' ? 0.0025 : 0.0004;
        var ang = i * 2.39996, r = passo * Math.sqrt(i);
        pos.set(p, [p.geo.lat + r * Math.cos(ang),
          p.geo.lng + r * Math.sin(ang) / Math.cos(p.geo.lat * Math.PI / 180)]);
      });
    });
    return pos;
  }

  function chips() {
    var conta = { dono: 0, outro: 0, semresp: 0, nao: 0 };
    pessoas.forEach(function (p) { conta[p.cat]++; });
    $('marr-chips').innerHTML = Object.keys(CAT).filter(function (c) { return conta[c] || c === 'nao'; })
      .map(function (c) {
        return '<button type="button" class="marr-chip" data-cat="' + c + '" aria-pressed="' + (ligado[c] ? 'true' : 'false') + '">'
          + '<i style="background:' + CAT[c].cor + '"></i>' + esc(CAT[c].txt.replace(/ \(.*\)$/, '')) + ' <b>' + conta[c] + '</b></button>';
      }).join('');
    Array.prototype.forEach.call($('marr-chips').querySelectorAll('.marr-chip'), function (b) {
      b.onclick = function () { ligado[b.dataset.cat] = !ligado[b.dataset.cat]; chips(); desenhar(); };
    });
  }

  function desenhar() {
    if (!mapa) return;
    camada.clearLayers();
    var comPino = pessoas.filter(function (p) { return p.geo; });
    var pos = posicoes(comPino);
    var visiveis = comPino.filter(function (p) { return ligado[p.cat]; });
    visiveis.forEach(function (p) {
      var aprox = !!APROX[p.geo.precisao];
      L.circleMarker(pos.get(p), {
        radius: 8, color: aprox ? CAT[p.cat].cor : '#ffffff', weight: aprox ? 2.5 : 1.5,
        dashArray: aprox ? '3 3' : null, fillColor: CAT[p.cat].cor, fillOpacity: aprox ? 0.35 : 0.95,
      }).bindPopup(popup(p), { maxWidth: 320 }).bindTooltip(esc(p.nome)).addTo(camada);
    });
    if (!enquadrou && visiveis.length) {
      mapa.fitBounds(L.latLngBounds(visiveis.map(function (p) { return pos.get(p); })), { padding: [30, 30] });
      enquadrou = true;
    }
    $('marr-kml').disabled = !comPino.length;
  }

  function resumo() {
    var comPino = pessoas.filter(function (p) { return p.geo; });
    var aprox = comPino.filter(function (p) { return APROX[p.geo.precisao]; }).length;
    var sem = pessoas.filter(function (p) { return p.semCidade; });
    var txt = '<b>' + comPino.length + '</b> de ' + pessoas.length + ' no mapa. '
      + 'Bolinha cheia: no número, no CEP ou na rua. Bolinha tracejada: no bairro ou no centro da cidade ('
      + aprox + ', o endereço não foi achado no mapa). Clique no pino para ver tudo.';
    if (sem.length) {
      txt += ' Fora do mapa por não ter cidade reconhecível (' + sem.length + '): '
        + sem.map(function (p) { return esc(p.nome); }).join(', ') + '.';
    }
    status(txt);
  }

  // ── Abrir e fechar ───────────────────────────────────────────────────────
  function abrir() {
    montarTela();
    $('marr').hidden = false;
    document.body.style.overflow = 'hidden';
    if (rodando) return;
    rodando = true;
    status('Carregando…');
    var dados = (typeof cadDados !== 'undefined' && cadDados) ? Promise.resolve() : cadCarregar();
    Promise.all([carregarLeaflet(), dados]).then(function () {
      if (!mapa) {
        mapa = L.map('marr-mapa', { zoomControl: true }).setView([-15.8, -47.9], 4);
        var satelite = L.layerGroup([
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, attribution: 'Imagens: Esri, Maxar, Earthstar Geographics' }),
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19 }),
        ]);
        var ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
        satelite.addTo(mapa);
        L.control.layers({ 'Satélite': satelite, 'Mapa': ruas }, null, { position: 'topright' }).addTo(mapa);
        camada = L.layerGroup().addTo(mapa);
      }
      setTimeout(function () { mapa.invalidateSize(); }, 50);
      if (typeof cadDados === 'undefined' || !cadDados) {
        status('Não consegui ler a lista da aba. Feche, aperte Atualizar e abra o mapa de novo.', true);
        return;
      }
      montarPessoas();
      chips();
      if (!pessoas.length) { status('Ninguém na aba Arrendamento ainda.'); return; }
      desenhar();
      status('Localizando os endereços…');
      return localizarTodos().then(refinarPeloCep).then(resumo, function (e) {
        desenhar();
        status('Não consegui localizar todos os endereços agora (' + esc(e.message || e) + '). '
          + 'Os pinos que já estavam prontos aparecem; abra o mapa de novo daqui a pouco para completar.', true);
      });
    }).catch(function (e) {
      status('O mapa não abriu: ' + esc(e.message || e), true);
    }).then(function () { rodando = false; });
  }

  function fechar() {
    var el = $('marr');
    if (el) el.hidden = true;
    document.body.style.overflow = '';
  }

  // ── Google Earth: o mesmo conteúdo em .kml ───────────────────────────────
  function baixarKml() {
    var comPino = pessoas.filter(function (p) { return p.geo; });
    if (!comPino.length) return;
    var pos = posicoes(comPino);
    var x = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var cdata = function (s) { return '<![CDATA[' + String(s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>'; };
    var hoje = new Date().toLocaleDateString('pt-BR');
    var estilos = Object.keys(CAT).map(function (c) {
      return ['x', 'a'].map(function (suf) {
        return '<Style id="' + c + '-' + suf + '"><IconStyle><scale>' + (suf === 'x' ? '1.0' : '0.85') + '</scale>'
          + '<Icon><href>https://maps.google.com/mapfiles/kml/paddle/' + CAT[c].kml + '-' + (suf === 'x' ? 'circle' : 'blank') + '.png</href></Icon>'
          + '<hotSpot x="32" y="1" xunits="pixels" yunits="pixels"/></IconStyle><LabelStyle><scale>0.75</scale></LabelStyle></Style>';
      }).join('');
    }).join('');
    var marca = function (p, escondido) {
      var ll = pos.get(p);
      var dados = [['Nome', p.nome], ['Posse', CAT[p.cat].txt], ['De quem é o local', p.relacao], ['Endereço', p.endereco],
        ['Cidade', p.geo.municipio + '-' + p.geo.uf], ['Pino', PREC[p.geo.precisao]],
        ['Status da reunião', p.ag ? ((typeof CAD_AG_STATUS !== 'undefined' && CAD_AG_STATUS[p.ag.status]) || p.ag.status || '') : ''],
        ['Vendedor', p.ag ? p.ag.vendedor_nome || '' : '']].concat(p.det);
      return '<Placemark>' + (escondido ? '<visibility>0</visibility>' : '') + '<name>' + x(p.nome) + '</name>'
        + '<styleUrl>#' + p.cat + '-' + (APROX[p.geo.precisao] ? 'a' : 'x') + '</styleUrl>'
        + '<description>' + cdata(popup(p).replace(/href="\//g, 'href="https://solardoc.app/')) + '</description>'
        + '<ExtendedData>' + dados.map(function (d) { return '<Data name="' + x(d[0]) + '"><value>' + x(d[1]) + '</value></Data>'; }).join('') + '</ExtendedData>'
        + '<Point><coordinates>' + ll[1].toFixed(6) + ',' + ll[0].toFixed(6) + ',0</coordinates></Point></Placemark>';
    };
    var ordem = function (a, b) { return (a.geo.municipio.localeCompare(b.geo.municipio, 'pt-BR')) || a.nome.localeCompare(b.nome, 'pt-BR'); };
    var ativos = comPino.filter(function (p) { return p.cat !== 'nao'; });
    var naoQuer = comPino.filter(function (p) { return p.cat === 'nao'; }).sort(ordem);
    var porUf = {};
    ativos.forEach(function (p) { (porUf[p.geo.uf] = porUf[p.geo.uf] || []).push(p); });
    var ufs = Object.keys(porUf).sort(function (a, b) { return porUf[b].length - porUf[a].length || a.localeCompare(b); });
    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
      + '<name>Eletroposto · Arrendamento (' + x(hoje) + ')</name><open>1</open>'
      + '<description>' + cdata('Lista da aba Arrendamento do /gerador em ' + hoje + '. Verde: proprietário. Amarelo: pode ceder, '
        + 'mas não é o dono. Pino com bolinha: no número, no CEP ou na rua. Pino liso: no bairro ou no centro da cidade.') + '</description>'
      + estilos
      + ufs.map(function (uf) {
        return '<Folder><name>' + x(uf + ' · ' + (UF_NOME[uf] || uf) + ' (' + porUf[uf].length + ')') + '</name>'
          + porUf[uf].sort(ordem).map(function (p) { return marca(p, false); }).join('') + '</Folder>';
      }).join('')
      + (naoQuer.length ? '<Folder><name>Disseram não (' + naoQuer.length + ')</name><visibility>0</visibility>'
        + naoQuer.map(function (p) { return marca(p, true); }).join('') + '</Folder>' : '')
      + '</Document></kml>\n';
    var blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Eletroposto Arrendamento ' + hoje.replace(/\//g, '-') + '.kml';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.mapaArrAbrir = abrir;
  window.mapaArrFechar = fechar;
})();
