/* Pós-venda do eletroposto: funções puras e chamadas de rede.
 *
 * Compartilhado entre o /gerador (index.html) e a Agenda (agenda/index.html).
 * Não depende de variável global de nenhum dos dois: a base de URL e os headers
 * chegam por parâmetro, do mesmo jeito que cada tela já monta a chamada de
 * `/gerador/etiqueta`. Expõe `window.PosVenda`.
 *
 * Contrato da API (rota `/gerador/pos-venda`):
 *   GET  ?ids=1,2,3  -> { ok, registros:{[id]:Registro}, sugestoes:{[id]:modelo}, catalogo }
 *   POST { id, modelo?, valor?, vendido_em?, etapa?, previsto?, responsavel?, obs?, por? }
 *                    -> { ok, registro } ou 400 { error: '<codigo>' } (aceita 'erro' também)
 * Campo ausente no POST mantém o valor que já existe. `valor` é número em REAIS.
 */
(function (w) {
  'use strict';

  var MODELOS_FALLBACK = [
    { slug: 'chave_na_mao', rotulo: 'Chave na mão' },
    { slug: 'meio_a_meio',  rotulo: '50/50' },
    { slug: 'arrendamento', rotulo: 'Arrendamento' },
    { slug: 'cotista',      rotulo: 'Cotas' },
    { slug: 'integrador',   rotulo: 'Integrador' },
    { slug: 'carregador',   rotulo: 'Carregador avulso' }
  ];
  var DONO_ROT = { nos: 'Nosso', cliente: 'Cliente', dist: 'Concessionária', banco: 'Banco' };
  var TZ = 'America/Sao_Paulo';
  var LIMITE_VALOR = 100000000; // a API recusa valor acima disto
  var LOTE = 400;              // ids por chamada, igual ao lote do apalavrado

  var PosVenda = {
    MODELOS_FALLBACK: MODELOS_FALLBACK,
    DONO_ROT: DONO_ROT,
    catalogoAtual: null,        // o último catálogo que a API devolveu
    ganchos: {}                 // prefixo -> function(slug), chamada ao escolher modelo
  };

  function p2(n) { return String(n).padStart(2, '0'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  PosVenda.esc = esc;

  // ── valor ────────────────────────────────────────────────────────────────
  // O campo é type="text" de propósito. Em type="number", digitar "145.000"
  // vale 145 (o ponto vira decimal) e a vírgula do teclado zera o campo.
  // Devolve null para vazio, NaN para "não entendi", senão o número em reais.
  PosVenda.parseValor = function (texto) {
    if (texto == null) return null;
    // "R$" só vale como PREFIXO: "10R$20" não é um número.
    var t = String(texto).trim().replace(/^R\$/i, '').replace(/\s+/g, '');
    if (t === '') return null;
    if (!/^[0-9.,]+$/.test(t)) return NaN;     // letras, "mil", sinal de menos
    var n;
    if (t.indexOf(',') !== -1) {
      var partes = t.split(',');
      if (partes.length !== 2) return NaN;
      var inteiro = partes[0], dec = partes[1];
      if (!/^[0-9]{1,2}$/.test(dec)) return NaN;
      if (!(/^[0-9]+$/.test(inteiro) || /^[0-9]{1,3}(\.[0-9]{3})+$/.test(inteiro))) return NaN;
      n = parseFloat(inteiro.replace(/\./g, '') + '.' + dec);
    } else if (/^[0-9]{1,3}(\.[0-9]{3})+$/.test(t)) {
      n = parseFloat(t.replace(/\./g, ''));
    } else if (/^[0-9]+\.[0-9]{1,2}$/.test(t)) {
      n = parseFloat(t);
    } else if (/^[0-9]+$/.test(t)) {
      n = parseFloat(t);
    } else {
      return NaN;
    }
    if (!isFinite(n) || n < 0 || n > LIMITE_VALOR) return NaN;
    return n;
  };

  // "145.000,00", sem depender de ICU nem de espaço especial do Intl.
  function numTxt(n) {
    var cent = Math.round(Number(n) * 100);
    var neg = cent < 0; if (neg) cent = -cent;
    var inteiro = String(Math.floor(cent / 100));
    var dec = p2(cent % 100);
    inteiro = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + inteiro + ',' + dec;
  }
  PosVenda.numTxt = numTxt;
  PosVenda.fmtBrl = function (n) { return 'R$ ' + numTxt(n); };

  // ── datas ────────────────────────────────────────────────────────────────
  function hojeBr() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (e) {
      var d = new Date(Date.now() - 3 * 3600 * 1000);   // Brasília, sem horário de verão
      return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
    }
  }
  PosVenda.hojeBr = hojeBr;

  // 'YYYY-MM-DD' de uma data pura ou de um ISO com hora (lido no fuso de Brasília).
  function diaDe(x) {
    if (!x) return '';
    var s = String(x);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (isNaN(d.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
    } catch (e) {
      var b = new Date(d.getTime() - 3 * 3600 * 1000);
      return b.getUTCFullYear() + '-' + p2(b.getUTCMonth() + 1) + '-' + p2(b.getUTCDate());
    }
  }
  PosVenda.diaDe = diaDe;

  PosVenda.dataBr = function (ymd) {
    var s = diaDe(ymd);
    return s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  };

  // Dias de `a` até `b` (positivo quando b é depois de a), pelas partes da data.
  PosVenda.diasEntre = function (a, b) {
    var x = diaDe(a), y = diaDe(b);
    if (!x || !y) return 0;
    var ux = Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
    var uy = Date.UTC(+y.slice(0, 4), +y.slice(5, 7) - 1, +y.slice(8, 10));
    return Math.round((uy - ux) / 86400000);
  };

  // ── catálogo ─────────────────────────────────────────────────────────────
  function modelosDe(cat) {
    return (cat && Array.isArray(cat.modelos) && cat.modelos.length) ? cat.modelos : MODELOS_FALLBACK;
  }
  PosVenda.modelosDe = modelosDe;

  function modeloInfo(slug, cat) {
    var l = modelosDe(cat);
    for (var i = 0; i < l.length; i++) if (l[i].slug === slug) return l[i];
    return null;
  }
  PosVenda.modeloInfo = modeloInfo;

  PosVenda.rotuloModelo = function (slug, cat) {
    if (!slug) return 'Modelo a confirmar';
    var m = modeloInfo(slug, cat);
    return m ? m.rotulo : String(slug);
  };

  PosVenda.papeisDe = function (slug, cat) {
    var m = modeloInfo(slug, cat);
    var p = m && m.papeis;
    if (!p) return '';
    return Array.isArray(p) ? p.join(', ') : String(p);
  };

  function trilho(modelo, cat) {
    var t = cat && cat.trilhos && cat.trilhos[modelo || ''];
    return Array.isArray(t) ? t : [];
  }
  PosVenda.trilho = trilho;

  function etapaInfo(slug, cat) {
    var e = cat && cat.etapas && cat.etapas[slug];
    return e || null;
  }
  PosVenda.etapaInfo = etapaInfo;

  PosVenda.rotuloEtapa = function (slug, cat) {
    var e = etapaInfo(slug, cat);
    return e && e.rotulo ? e.rotulo : String(slug || '');
  };
  PosVenda.rotuloDono = function (slug, cat) {
    var e = etapaInfo(slug, cat);
    return e && e.dono ? (DONO_ROT[e.dono] || e.dono) : '';
  };

  // A etapa depois de `etapa` no trilho do `modelo`, ou null se é a última (ou se
  // a etapa não está no trilho: nesse caso não há "próxima" honesta para chutar).
  PosVenda.seguinte = function (modelo, etapa, cat) {
    var t = trilho(modelo, cat);
    var i = t.indexOf(etapa);
    return (i >= 0 && i + 1 < t.length) ? t[i + 1] : null;
  };
  PosVenda.proximaEtapa = function (registro, catalogo) {
    if (!registro) return null;
    return PosVenda.seguinte(registro.modelo, registro.etapa, catalogo);
  };

  // O que a tela precisa saber de um registro, já mastigado.
  PosVenda.resumo = function (registro, catalogo, hoje) {
    var reg = registro || null;
    var modelo = reg ? (reg.modelo || '') : '';
    var t = trilho(modelo, catalogo);
    var idx = reg ? t.indexOf(reg.etapa) : -1;
    var concluido = !!(reg && modelo && reg.etapa === 'concluido');
    var hojeD = hoje || hojeBr();
    var previsto = reg && reg.previsto ? diaDe(reg.previsto) : '';
    var atraso = 0;
    if (reg && previsto && !concluido && reg.etapa !== 'concluido') {
      var d = PosVenda.diasEntre(previsto, hojeD);
      atraso = d > 0 ? d : 0;
    }
    var dias = (reg && reg.etapa_desde) ? Math.max(0, PosVenda.diasEntre(reg.etapa_desde, hojeD)) : null;
    return {
      modeloRot: PosVenda.rotuloModelo(modelo, catalogo),
      etapaRot: reg && reg.etapa ? PosVenda.rotuloEtapa(reg.etapa, catalogo) : '',
      donoRot: reg && reg.etapa ? PosVenda.rotuloDono(reg.etapa, catalogo) : '',
      diasNaEtapa: dias,
      atrasoDias: atraso,
      previstoBr: previsto ? PosVenda.dataBr(previsto) : '',
      concluido: concluido,
      faltaInformar: !reg || !modelo,
      posicao: idx >= 0 ? idx + 1 : 0,
      total: t.length
    };
  };

  // Erro da rota: o corpo de erro é { error: '<codigo>' } (aceita 'erro' também).
  // O Error leva .status (HTTP) e .codigo, e PosVenda.mensagemErro(e) traduz.
  function erroDaApi(r, j) {
    var codigo = (j && (j.error || j.erro)) || '';
    var e = new Error(codigo || ('pos-venda HTTP ' + r.status));
    e.status = r.status;
    e.codigo = String(codigo || '');
    return e;
  }

  var MENSAGENS_ERRO = {
    valor_invalido: 'Esse valor não foi aceito. Confira o número.',
    etapa_fora_do_trilho: 'Essa etapa não existe neste modelo. Escolha outra.',
    previsto_invalido: 'Essa data não foi aceita. Escolha outra.',
    data_invalida: 'Essa data não foi aceita. Escolha outra.',
    modelo_invalido: 'Esse modelo não foi aceito. Escolha de novo.',
    texto_invalido: 'Esse texto não foi aceito. Escreva de novo.'
  };
  PosVenda.mensagemErro = function (e) {
    var c = e && e.codigo;
    return (c && MENSAGENS_ERRO[c]) || 'Não deu para salvar o pós-venda. Tente de novo.';
  };

  // ── rede ─────────────────────────────────────────────────────────────────
  function cabecalhos(opcoes, comCorpo) {
    var h = {};
    var src = (opcoes && opcoes.headers) || {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) h[k] = src[k];
    if (comCorpo && !h['Content-Type']) h['Content-Type'] = 'application/json';
    return h;
  }

  // Lê os registros dos `ids` (em lotes). Sem ids, devolve só o catálogo.
  PosVenda.ler = async function (base, ids, opcoes) {
    var lista = (ids || []).filter(function (x) { return x != null && x !== ''; });
    var registros = {}, sugestoes = {}, catalogo = null;
    var lotes = [];
    if (!lista.length) lotes.push([]);
    for (var i = 0; i < lista.length; i += LOTE) lotes.push(lista.slice(i, i + LOTE));
    for (var n = 0; n < lotes.length; n++) {
      var url = base + '/gerador/pos-venda' + (lotes[n].length ? '?ids=' + lotes[n].join(',') : '');
      var r = await fetch(url, { headers: cabecalhos(opcoes, false) });
      var j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      if (!r.ok || !j || j.ok === false) {
        throw erroDaApi(r, j);
      }
      Object.assign(registros, j.registros || {});
      Object.assign(sugestoes, j.sugestoes || {});
      if (j.catalogo) catalogo = j.catalogo;
    }
    if (catalogo) PosVenda.catalogoAtual = catalogo;
    return { registros: registros, sugestoes: sugestoes, catalogo: catalogo || PosVenda.catalogoAtual };
  };

  // Grava (merge: o que não vai no corpo fica como está). Devolve o registro.
  PosVenda.gravar = async function (base, id, campos, opcoes) {
    var corpo = { id: id };
    for (var k in (campos || {})) {
      if (!Object.prototype.hasOwnProperty.call(campos, k) || campos[k] === undefined) continue;
      // Em por, responsavel e obs o null nunca e intencao (o servidor recusa com
      // texto_invalido). Em valor e previsto, null continua significando "limpar".
      if (campos[k] === null && (k === 'por' || k === 'responsavel' || k === 'obs')) continue;
      corpo[k] = campos[k];
    }
    var r = await fetch(base + '/gerador/pos-venda', {
      method: 'POST', headers: cabecalhos(opcoes, true), body: JSON.stringify(corpo)
    });
    var j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok || !j || j.ok === false) {
      throw erroDaApi(r, j);
    }
    return j.registro;
  };

  // ── histórico ────────────────────────────────────────────────────────────
  // Mesmo carimbo que G (`tsCrm`) e A (`tsSt`) usam: "dd/mm 14h05", hora local.
  PosVenda.carimbo = function (quando) {
    var d = quando || new Date();
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + 'h' + p2(d.getMinutes());
  };
  PosVenda.linhaHistorico = function (autor, texto) {
    var a = String(autor || '').trim();
    if (!a || a === '—') a = 'Equipe';
    return '[' + PosVenda.carimbo() + ' · ' + a + '] ' + texto;
  };

  // ── formulário de captura (reusado em G e em A) ──────────────────────────
  // `prefixo` só com letras, números e hífen: vira id e vai em atributo onclick.
  // `pre` = { modelo, valor, semTitulo }.
  PosVenda.capturaHtml = function (prefixo, pre, catalogo) {
    var p = String(prefixo).replace(/[^A-Za-z0-9_-]/g, '');
    pre = pre || {};
    var modelo = pre.modelo || '';
    var valorTxt = (typeof pre.valor === 'number' && isFinite(pre.valor)) ? numTxt(pre.valor) : '';
    var botoes = modelosDe(catalogo).map(function (m) {
      var on = m.slug === modelo;
      return '<button type="button" class="pv-opt' + (on ? ' on' : '') + '" data-slug="' + esc(m.slug) + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
        + ' onclick="PosVenda.escolher(\'' + p + '\',\'' + esc(m.slug) + '\')">' + esc(m.rotulo) + '</button>';
    }).join('');
    return '<div class="pv-cap" id="' + p + '-cap" data-modelo="' + esc(modelo) + '">'
      + (pre.semTitulo ? '<div class="pv-lbl" style="margin-top:14px">Modelo</div>' : '<div class="pv-cap-tit">Qual modelo fechou?</div>')
      + '<div class="pv-opts" role="group" aria-label="Modelo vendido">' + botoes + '</div>'
      + '<label class="pv-lbl" for="' + p + '-valor">Valor da venda</label>'
      + '<input id="' + p + '-valor" class="pv-in" type="text" inputmode="decimal" autocomplete="off"'
      + ' placeholder="Ex.: 145.000,00" value="' + esc(valorTxt) + '" oninput="PosVenda.atualizar(\'' + p + '\')">'
      + '<div class="pv-eco" id="' + p + '-eco" aria-live="polite"></div>'
      + '</div>';
  };

  PosVenda.escolher = function (prefixo, slug) {
    var cap = document.getElementById(prefixo + '-cap');
    if (!cap) return;
    cap.setAttribute('data-modelo', slug);
    var bs = cap.querySelectorAll('.pv-opt');
    for (var i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute('data-slug') === slug;
      bs[i].classList.toggle('on', on);
      bs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    PosVenda.atualizar(prefixo);
    var g = PosVenda.ganchos[prefixo];
    if (typeof g === 'function') { try { g(slug); } catch (e) { /* o gancho não derruba a escolha */ } }
  };

  // Lê o formulário. `erro`: 'modelo' (nenhum escolhido), 'valor' (não entendi) ou null.
  PosVenda.lerCaptura = function (prefixo) {
    var cap = document.getElementById(prefixo + '-cap');
    var inp = document.getElementById(prefixo + '-valor');
    var modelo = cap ? (cap.getAttribute('data-modelo') || '') : '';
    var valor = PosVenda.parseValor(inp ? inp.value : '');
    var erro = null;
    if (typeof valor === 'number' && isNaN(valor)) erro = 'valor';
    else if (!modelo) erro = 'modelo';
    return { modelo: modelo, valor: erro === 'valor' ? null : valor, erro: erro, valorInvalido: erro === 'valor' };
  };

  // Eco do valor a cada tecla, e liga/desliga os botões que dependem do formulário
  // (os que têm data-pv-confirma="<prefixo>").
  PosVenda.atualizar = function (prefixo) {
    var eco = document.getElementById(prefixo + '-eco');
    var inp = document.getElementById(prefixo + '-valor');
    var v = PosVenda.parseValor(inp ? inp.value : '');
    var invalido = (typeof v === 'number' && isNaN(v));
    if (eco) {
      eco.classList.toggle('erro', invalido);
      if (invalido) eco.textContent = 'Não entendi esse valor. Escreva só o número, como 145.000,00.';
      else if (v === null) eco.textContent = '';
      else eco.textContent = 'Entendi ' + PosVenda.fmtBrl(v);
    }
    var cap = document.getElementById(prefixo + '-cap');
    var temModelo = !!(cap && cap.getAttribute('data-modelo'));
    var bts = document.querySelectorAll('[data-pv-confirma="' + prefixo + '"]');
    for (var i = 0; i < bts.length; i++) bts[i].disabled = invalido || !temModelo;
    return !invalido;
  };

  // ── vendas, resumo, evolução e ranking ───────────────────────────────────
  // A base são os CARDS que estão VENDIDO hoje, cruzados com os registros.
  // O crédito é do `vendedor_nome` do card, nunca do `registro.por` (esse campo
  // é sobrescrito a cada gravação por quem editou).
  var SEM_CONSULTOR = 'Sem consultor';
  PosVenda.SEM_CONSULTOR = SEM_CONSULTOR;
  function nomeConsultor(x) {
    var n = String(x == null ? '' : x).trim();
    return n || SEM_CONSULTOR;
  }
  PosVenda.nomeConsultor = nomeConsultor;

  function diaExiste(a, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    var u = new Date(Date.UTC(a, m - 1, d));
    return u.getUTCFullYear() === a && u.getUTCMonth() === m - 1 && u.getUTCDate() === d;
  }

  // O texto `historico` empilha as linhas, a mais nova em cima. A linha que
  // registra a venda é "[dd/mm 14h05 · Autor] ... Status: X → VENDIDO..." (clique
  // de status, em G e na Agenda) ou "[...] ... Venda registrada: R$ ..." (modal de
  // venda do Histórico). O carimbo não tem ano: vale a data passada mais recente
  // em relação a `hoje`. "VENDIDO → outra coisa" (venda desfeita) não conta.
  // Entre várias marcações, vence a mais recente pela data e hora do carimbo.
  PosVenda.dataDaVendaNoHistorico = function (historico, hoje) {
    var texto = String(historico == null ? '' : historico);
    if (!texto) return null;
    var h = diaDe(hoje) || hojeBr();
    var hA = +h.slice(0, 4), hM = +h.slice(5, 7), hD = +h.slice(8, 10);
    var linhas = texto.split(/\r?\n/);
    var melhorChave = '', melhorDia = null;
    for (var i = 0; i < linhas.length; i++) {
      var m = /^\s*\[(\d{2})\/(\d{2})\s+(\d{1,2})h(\d{2})[^\]]*\]\s*(.*)$/.exec(linhas[i]);
      if (!m) continue;
      var resto = m[5];
      // "Status: X → VENDIDO" só vale com X diferente de VENDIDO: "VENDIDO → VENDIDO" é o
      // clique repetido só para informar o modelo, não uma venda nova.
      var st = /Status:\s*([^→\n]*?)\s*→\s*VENDIDO(?![A-Za-zÀ-ú])/i.exec(resto);
      var ehVenda = (st && !/^VENDIDO$/i.test(st[1].trim())) || /Venda registrada:/i.test(resto);
      if (!ehVenda) continue;
      var dd = +m[1], mm = +m[2];
      // O carimbo vem do relógio do aparelho e hoje é de Brasília: até 2 dias depois de
      // hoje, neste ano, ainda é hoje (e não o ano passado).
      var ano = hA, dia;
      if (!diaExiste(ano, mm, dd)) {
        // 29/02 em ano que não é bissexto: procura o ano bissexto anterior mais próximo
        ano = hA - 1;
        while (ano > hA - 8 && !diaExiste(ano, mm, dd)) ano--;
        if (!diaExiste(ano, mm, dd)) continue;
        dia = ano + '-' + p2(mm) + '-' + p2(dd);
      } else {
        dia = ano + '-' + p2(mm) + '-' + p2(dd);
        if (dia > h) {
          var depois = Math.round((Date.UTC(ano, mm - 1, dd) - Date.UTC(hA, hM - 1, hD)) / 86400000);
          if (depois <= 2) dia = h;
          else { ano = hA - 1; if (!diaExiste(ano, mm, dd)) continue; dia = ano + '-' + p2(mm) + '-' + p2(dd); }
        }
      }
      var chave = dia + ' ' + p2(+m[3]) + ':' + m[4];
      if (!melhorDia || chave > melhorChave) { melhorChave = chave; melhorDia = dia; }
    }
    return melhorDia;
  };

  // Uma linha por card VENDIDO.
  PosVenda.vendas = function (cards, registros, hoje) {
    var h = diaDe(hoje) || hojeBr();
    var regs = registros || {};
    return (cards || []).map(function (c) {
      var id = String(c.id);
      var reg = regs[id] || null;
      var dia = reg && reg.vendido_em ? diaDe(reg.vendido_em) : '';
      if (!dia) dia = PosVenda.dataDaVendaNoHistorico(c.historico, h) || '';
      if (!dia) {
        dia = diaDe(c.quando);
        if (dia && dia > h) dia = h;   // reunião marcada para o futuro não é data de venda
      }
      if (!dia) dia = h;
      var valor = (reg && reg.valor != null && isFinite(Number(reg.valor))) ? Number(reg.valor) : null;
      return {
        id: id,
        cliente: c.cliente_nome || '',
        cidade: c.cidade || '',
        consultor: nomeConsultor(c.vendedor_nome),
        valor: valor,
        modelo: reg ? (reg.modelo || '') : '',
        dia: dia,
        mes: dia.slice(0, 7),
        temRegistro: !!reg
      };
    });
  };

  function cent(n) { return Math.round(n * 100) / 100; }
  function agrega(lista) {
    var valor = 0, comValor = 0;
    lista.forEach(function (v) { if (v.valor != null) { valor += v.valor; comValor++; } });
    valor = cent(valor);
    return {
      qtd: lista.length, valor: valor, comValor: comValor, semValor: lista.length - comValor,
      ticket: comValor > 0 ? cent(valor / comValor) : null
    };
  }
  // `valor` é a soma do valor INFORMADO: venda sem valor conta na quantidade e em `semValor`.
  PosVenda.resumoVendas = function (vendas, hoje) {
    var mes = (diaDe(hoje) || hojeBr()).slice(0, 7);
    var lista = vendas || [];
    return { geral: agrega(lista), mes: agrega(lista.filter(function (v) { return v.mes === mes; })) };
  };

  function proximoMes(ym) {
    var a = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return m === 12 ? (a + 1) + '-01' : a + '-' + p2(m + 1);
  }
  function mesAnterior(ym) {
    var a = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return m === 1 ? (a - 1) + '-12' : a + '-' + p2(m - 1);
  }
  // Do primeiro mês com venda até o mês corrente, mês vazio com zero, até 12 meses.
  // `minMeses` (opcional, até 12) completa a janela PARA TRÁS com meses zerados até ter
  // pelo menos essa quantidade de pontos, terminando onde ela já terminava. Sem ele, o
  // comportamento é o de sempre. Sem nenhuma venda a lista continua vazia.
  PosVenda.evolucaoMensal = function (vendas, hoje, minMeses) {
    var lista = vendas || [];
    if (!lista.length) return [];
    var atual = (diaDe(hoje) || hojeBr()).slice(0, 7);
    var ini = lista[0].mes, fim = atual;
    lista.forEach(function (v) { if (v.mes < ini) ini = v.mes; if (v.mes > fim) fim = v.mes; });
    var porMes = {};
    lista.forEach(function (v) {
      var o = porMes[v.mes] || (porMes[v.mes] = { mes: v.mes, qtd: 0, valor: 0 });
      o.qtd++;
      if (v.valor != null) o.valor += v.valor;
    });
    var min = Math.min(12, Math.max(0, Math.floor(Number(minMeses)) || 0));
    var out = [];
    for (var ym = ini, guarda = 0; ym <= fim && guarda < 1200; ym = proximoMes(ym), guarda++) {
      var o = porMes[ym];
      out.push({ mes: ym, qtd: o ? o.qtd : 0, valor: o ? cent(o.valor) : 0 });
    }
    for (var ant = mesAnterior(ini), g2 = 0; out.length < min && g2 < 24; ant = mesAnterior(ant), g2++) {
      out.unshift({ mes: ant, qtd: 0, valor: 0 });
    }
    return out.slice(-12);
  };

  // A mesma lista da evolução, com o que o tooltip precisa por mês: quantas vendas têm
  // valor, quantas não, e o ticket (soma ÷ vendas COM valor, como no resumo).
  PosVenda.evolucaoDetalhada = function (vendas, hoje, minMeses) {
    var porMes = {};
    (vendas || []).forEach(function (v) { (porMes[v.mes] || (porMes[v.mes] = [])).push(v); });
    return PosVenda.evolucaoMensal(vendas, hoje, minMeses).map(function (m) {
      var a = agrega(porMes[m.mes] || []);
      return { mes: m.mes, qtd: a.qtd, valor: a.valor, comValor: a.comValor, semValor: a.semValor, ticket: a.ticket };
    });
  };

  // Valor compacto para rótulo de gráfico: "R$ 950", "R$ 1,5 mil", "R$ 145 mil",
  // "R$ 1,2 mi". Feito à mão (sem Intl). Na virada, 999.500 vira "R$ 1 mi", nunca
  // "1.000 mil". `semPrefixo` tira o "R$ " (rótulo de eixo).
  function umaCasa(x) { return String(Math.round(x * 10) / 10).replace('.', ','); }
  PosVenda.fmtBrlCompacto = function (n, semPrefixo) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    var neg = v < 0, a = Math.abs(v), t;
    if (a < 999.5) {
      t = String(Math.round(a));
    } else if (a < 999500) {
      var mil = a / 1000;
      t = (mil < 9.95 ? umaCasa(mil) : String(Math.round(mil))) + ' mil';
    } else {
      var mi = a / 1000000;
      t = (mi < 99.95 ? umaCasa(mi) : String(Math.round(mi)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')) + ' mi';
    }
    return (neg && t !== '0' ? '-' : '') + (semPrefixo ? '' : 'R$ ') + t;
  };

  // Eixo "bonito" para barras que nascem do zero: no máximo 3 linhas de grade, passo
  // 1, 2, 2,5 ou 5 vezes uma potência de 10. `inteiro` (contagem) nunca usa passo
  // fracionado. Máximo zero ou inválido: sem eixo.
  PosVenda.escalaEixo = function (max, inteiro) {
    var m = Number(max);
    if (!isFinite(m) || m <= 0) return { topo: 0, passo: 0, ticks: [] };
    var base = Math.floor(Math.log(m) / Math.LN10) - 1;
    var mult = [1, 2, 2.5, 5];
    for (var e = base; e <= base + 3; e++) {
      for (var k = 0; k < mult.length; k++) {
        var passo = mult[k] * Math.pow(10, e);
        passo = Math.round(passo * 1000000) / 1000000;
        if (inteiro && (passo < 1 || passo % 1 !== 0)) continue;
        var n = Math.ceil(m / passo - 1e-9);
        if (n <= 3) {
          var ticks = [];
          for (var i = 1; i <= n; i++) ticks.push(Math.round(passo * i * 1000000) / 1000000);
          return { topo: ticks[n - 1], passo: passo, ticks: ticks };
        }
      }
    }
    return { topo: m, passo: m, ticks: [m] };
  };

  PosVenda.mesesComVenda = function (vendas) {
    var vistos = {}, out = [];
    (vendas || []).forEach(function (v) { if (!vistos[v.mes]) { vistos[v.mes] = 1; out.push(v.mes); } });
    return out.sort().reverse();
  };

  // `negociacao`: os cards ainda em negociação (cada um com `vendedor_nome`). É o
  // estado de agora, igual em qualquer período. `periodo`: 'YYYY-MM' ou 'tudo'.
  PosVenda.rankingVendas = function (vendas, negociacao, periodo) {
    var mapa = {}, ordem = [];
    var pegar = function (nome) {
      var k = 'k:' + nome;
      if (!mapa[k]) { mapa[k] = { consultor: nome, vendas: 0, valor: 0, semValor: 0, negociando: 0 }; ordem.push(mapa[k]); }
      return mapa[k];
    };
    (vendas || []).forEach(function (v) {
      if (periodo !== 'tudo' && v.mes !== periodo) return;
      var r = pegar(v.consultor);
      r.vendas++;
      if (v.valor != null) r.valor += v.valor; else r.semValor++;
    });
    (negociacao || []).forEach(function (c) { pegar(nomeConsultor(c && c.vendedor_nome)).negociando++; });
    ordem.forEach(function (r) { r.valor = cent(r.valor); });
    return ordem.sort(function (a, b) {
      if (b.vendas !== a.vendas) return b.vendas - a.vendas;
      if (b.valor !== a.valor) return b.valor - a.valor;
      if (b.negociando !== a.negociando) return b.negociando - a.negociando;
      return a.consultor < b.consultor ? -1 : (a.consultor > b.consultor ? 1 : 0);
    });
  };

  // Mesmo rótulo que o ranking do solar mostra nos botões: "out/26".
  var MESES_ROT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  PosVenda.rotuloMes = function (ym) {
    var a = +String(ym).slice(0, 4), m = +String(ym).slice(5, 7);
    if (!a || !m || m < 1 || m > 12) return String(ym || '');
    return MESES_ROT[m - 1] + '/' + String(a).slice(-2);
  };

  w.PosVenda = PosVenda;
})(typeof window !== 'undefined' ? window : this);
