/* Jornada da obra, fase 2 (06/11/2026): as etapas 4 a 8 da obra solar (Compra, Logística, Obra, Entrega, Liberação), o Book e
 * os três papéis que substituem o Fechamento: relatório de vistoria (etapa 1), proposta de banco (etapa 2) e termo de entrega (etapa 7).
 * Script clássico, um IIFE. Pega os ajudantes de window.Jornada.h na hora da chamada e se registra em Jornada.etapas e Jornada.extras.
 * Os papéis chamam as funções do index.html (fsBancoPaginado, fsTermoHTML, fsVistoriaBlocos, epPaginar, epPreview, solEmp) sempre com typeof.
 * Nada aqui envia mensagem. Cor só por var(--n-*) e var(--io-*), com a mesma reserva escura do jornada.js.
 * Sem emoji, sem exclamação, sem travessão. O canvas da assinatura tem fundo branco e traço preto porque vira imagem de papel. */
(function () {
  'use strict';

  function H() { return window.Jornada.h; }
  function D() { return window.Jornada.dinheiro; }
  function O() { return H().O(); }
  function base() { return '/gerador/jornada-solar/obra/' + encodeURIComponent(O().card); }
  var SEMANA = { de: '' };

  var UNIDADES = [['un', 'un'], ['m', 'm'], ['par', 'par'], ['kit', 'kit']];
  var TIPOS = [['modulo', 'Placas'], ['inversor', 'Inversor'], ['estrutura', 'Estrutura'], ['eletrico', 'Elétrico'], ['outro', 'Outro']];
  var ORIGENS = { proposta: 'Proposta', lista: 'Lista pronta', manual: 'Digitado', nota: 'Nota' };
  var FORMAS = [['pix', 'Pix'], ['transferencia', 'TED'], ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro'], ['financiamento', 'Financiamento'], ['outro', 'Outro']];
  var CHECK = [['estrutura', 'Estrutura fixada e vedada'], ['placas', 'Placas alinhadas e aterradas'], ['strings', 'Strings 1 e 2 ligadas'], ['inversor', 'Inversor fixado'], ['dps', 'DPS CC e CA'], ['aterramento', 'Aterramento'], ['cabos', 'Cabos identificados'], ['padrao', 'Padrão ligado']];
  var FOTOS_ENTREGA = [['ent_vista_geral', 'Vista geral das placas'], ['ent_arranjo', 'Arranjo de perto'], ['ent_inversor', 'Inversor ligado, com o visor'], ['ent_quadro', 'Quadro de proteção'], ['ent_aterramento', 'Aterramento'], ['ent_padrao', 'Padrão com placa de advertência'], ['ent_etiquetas', 'Etiquetas'], ['ent_local_limpo', 'Local limpo']];
  var TERMO_ITENS = [
    'Instalação concluída, com o local limpo e sem sobra de material.',
    'Sistema ligado e gerando energia na presença do cliente.',
    'Aplicativo de monitoramento instalado no celular do cliente, com o acesso entregue.',
    'Cliente orientado sobre o funcionamento, o desligamento de emergência e os cuidados de uso.',
    'Manuais e termos de garantia dos equipamentos entregues.',
    'Telhado conferido depois da obra, com reposição das telhas danificadas quando houve.',
  ];
  var TRAVA_ROTULOS = [
    ['Marca e potência das placas e do inversor batem com o contrato', /marca|pot[eê]ncia|quantidade|placas da compra/i],
    ['Garantia do inversor igual à do contrato', /inversor/i],
    ['Garantia de desempenho das placas igual à do contrato', /desempenho/i],
    ['Garantia da instalação é o texto do contrato', /instala[cç][aã]o/i],
  ];

  // ── Pequenos ajudantes ─────────────────────────────────────────────────────
  function el(t, c, x) { return H().el(t, c, x); }
  function add() { return H().add.apply(null, arguments); }
  function btn(t, c, f) { return H().btn(t, c, f); }
  function clone(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }
  function hoje() { var d = O().dados; return (d && d.hoje) || new Date().toISOString().slice(0, 10); }
  function txtCents(c) { return (Math.round(Number(c) || 0) / 100).toFixed(2).replace('.', ','); }
  function msgSrv(r, padrao) {
    var j = r && r.json;
    if (j && typeof j.mensagem === 'string' && j.mensagem) return j.mensagem;
    if (r && r.status === 401) return 'Sua sessão terminou. Entre de novo no Gerador.';
    if (r && r.status === 0) return 'Sem conexão. Tente de novo.';
    if (j && typeof j.error === 'string' && /\s/.test(j.error)) return j.error;
    return padrao;
  }
  function campo(rot, ctrl) { var l = el('label', '', rot); l.appendChild(ctrl); return l; }
  function entrada(tipo, valor, aria, cls) {
    var i = el('input', cls || 'jor-in'); i.type = tipo || 'text'; if (valor !== undefined && valor !== null) i.value = String(valor); if (aria) i.setAttribute('aria-label', aria);
    if (tipo === 'text') i.maxLength = 160;
    return i;
  }
  function selecao(opcoes, valor, aria) {
    var s = el('select', 'jor-sel'); if (aria) s.setAttribute('aria-label', aria);
    opcoes.forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; s.appendChild(op); });
    s.value = valor; return s;
  }
  function marca(rot, ligado, aria) {
    var l = el('label', 'jor-ob-chk'); var c = el('input'); c.type = 'checkbox'; c.checked = !!ligado; c.setAttribute('aria-label', aria || rot);
    l.appendChild(c); l.appendChild(document.createTextNode(' ' + rot)); l.input = c; return l;
  }
  function bloco(titulo, extra) { var b = el('div', 'jor-bloco'); var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', titulo)); if (extra) t.appendChild(extra); b.appendChild(t); return b; }
  function automatico() { return el('span', 'jor-auto', 'Automático'); }
  function tag(t) { return el('span', 'jor-ob-tag', t); }
  function arqs(f2, slot) { return (f2.arquivos || []).filter(function (a) { return a.slot === slot; }); }
  function existe(f2, id) { return !!id && (f2.arquivos || []).some(function (a) { return a.id === id; }); }
  function podeSecao(f2, s) { return !!(f2 && f2.pode && Array.isArray(f2.pode.secoes) && f2.pode.secoes.indexOf(s) >= 0); }
  function dados(f2) { return (f2 && f2.dados) || {}; }
  function livro() { var d = O().dinheiro; return d && d.livro ? d.livro : null; }
  function vdcAgora() { return (typeof vdcEst !== 'undefined') ? vdcEst : null; }
  function urlDe(id) {
    var st = vdcAgora();
    if (!st || String(st.id) !== String(O().card) || !st.docs || !Array.isArray(st.docs.arquivos)) return '';
    var a = st.docs.arquivos.filter(function (x) { return x && x.id === id; })[0];
    var u = a && a.url ? String(a.url) : '';
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function urlDoSlot(slot) {
    var st = vdcAgora();
    if (!st || String(st.id) !== String(O().card) || !st.docs || !Array.isArray(st.docs.arquivos)) return '';
    var a = st.docs.arquivos.filter(function (x) { return x && x.slot === slot && x.url; })[0];
    var u = a && a.url ? String(a.url) : '';
    return /^https?:\/\//i.test(u) ? u : '';
  }
  /** Todos os ids de arquivo já ligados a algum lugar do obra.json (para achar o arquivo NOVO depois do envio). */
  function idsLigados(f2) {
    var vistos = [];
    (function walk(o, k) {
      if (!o) return;
      if (Array.isArray(o)) { o.forEach(function (x) { if (typeof x === 'string' && (k === 'fotos' || k === 'documentos')) vistos.push(x); else walk(x, k); }); return; }
      if (typeof o === 'object') { Object.keys(o).forEach(function (kk) { var v = o[kk]; if (typeof v === 'string' && /(^|_)(arquivo|foto|assinatura)_id$/.test(kk)) vistos.push(v); else walk(v, kk); }); }
    })(dados(f2));
    return vistos;
  }
  function duracao(a, b) {
    if (!a || !b) return '';
    var m = Math.round((new Date(b) - new Date(a)) / 60000);
    if (!isFinite(m) || m < 0) return '';
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    var partes = [];
    if (d) partes.push(H().plural(d, 'dia', 'dias'));
    if (h) partes.push(H().plural(h, 'hora', 'horas'));
    if (!d && mm) partes.push(H().plural(mm, 'minuto', 'minutos'));
    return partes.join(' e ') || '0 minuto';
  }
  function agoraLocal() { var d = new Date(); var p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function dtTxt(s) { s = String(s || ''); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? H().ddmm(s) + ' ' + s.slice(11, 16) : ''; }

  function injetarCss() {
    if (document.getElementById('jor-obra-css')) return;
    var css = [
      '.jor-ob-tag{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:var(--n-sf2,#182338);color:var(--io-azul-tx,#93C5FD);border:1px solid var(--n-bd,#334155)}',
      '.jor-ob-tag.ok{background:var(--io-ok-sf,rgba(74,222,128,.14));color:var(--io-ok-tx,#4ADE80);border-color:var(--io-ok-tx,#4ADE80)}',
      '.jor-ob-tag.av{background:var(--io-av-sf,rgba(251,191,36,.1));color:var(--io-av-tx,#FCD34D);border-color:var(--io-av-tx,#FCD34D)}',
      '.jor-ob-tag.er{background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-tx,#FCA5A5);border-color:var(--io-er-tx,#FCA5A5)}',
      '.jor-ob-barra{height:10px;border-radius:999px;background:var(--n-sf2,#182338);border:1px solid var(--n-bd,#334155);overflow:hidden;margin:6px 0}',
      '.jor-ob-barra i{display:block;height:100%;background:var(--io-marcado,#2563EB)}',
      '.jor-ob-par{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}',
      '.jor-ob-par label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-chk{display:flex;align-items:center;gap:6px;color:var(--n-tx,#E5E7EB);font-size:13.5px}',
      '.jor-ob-chk input{width:18px;height:18px}',
      '.jor-ob-linha{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:6px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-linha:first-of-type{border-top:0}',
      '.jor-ob-grupo{font-weight:800;color:var(--n-tx,#E5E7EB);margin:12px 0 4px}',
      '.jor-ob-sub{color:var(--n-tx2,#B4C0D2);font-size:12.5px}',
      '.jor-ob-carga{border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);border-radius:12px;padding:12px 14px;margin:10px 0}',
      '.jor-ob-cl{display:block;font-weight:800;color:var(--n-tx,#E5E7EB);margin:12px 0 4px;padding-top:8px;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-cl:first-of-type{border-top:0;padding-top:0}',
      '.jor-ob-cel{display:none}',
      '.jor-ob-grade{width:100%;border-collapse:collapse;font-size:13px}',
      '.jor-ob-grade th,.jor-ob-grade td{padding:6px 8px;border-bottom:1px solid var(--n-bd,#334155);text-align:left;color:var(--n-tx,#E5E7EB);vertical-align:top}',
      '.jor-ob-grade th{color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-grade td.v{text-align:right;font-variant-numeric:tabular-nums}',
      '.jor-ob-grade tr.cab td{font-weight:800;background:var(--n-sf2,#182338)}',
      '.jor-ob-agenda td.ocupado{background:var(--io-av-sf,rgba(251,191,36,.1))}',
      '.jor-ob-agenda td.conflito{background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-tx,#FCA5A5)}',
      '.jor-ob-album{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
      '.jor-ob-foto{position:relative;width:76px;height:76px;border-radius:8px;border:2px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);overflow:hidden;padding:0;cursor:pointer}',
      '.jor-ob-foto img{width:100%;height:100%;object-fit:cover;display:block}',
      '.jor-ob-foto span{position:absolute;left:0;right:0;bottom:0;font-size:10px;font-weight:800;background:var(--n-sf,#1E293B);color:var(--n-tx,#E5E7EB);padding:1px 2px;text-align:center}',
      '.jor-ob-foto.on{border-color:var(--io-marcado,#2563EB)}',
      '.jor-ob-ass{border:1px solid var(--n-bd,#334155);border-radius:10px;width:100%;max-width:420px;height:150px;background:#fff;touch-action:none;display:block}',
      '.jor-ob-senha{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:800}',
      '.jor-ob-trava li{display:flex;gap:8px;align-items:flex-start}',
      '.jor-ob-trava li.ok{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-ob-trava li.er{color:var(--io-er-tx,#FCA5A5)}',
      '.jor-ob-barra-p{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
      '@media (max-width:760px){',
      '.jor-ob-par{grid-template-columns:minmax(0,1fr)}',
      '.jor-ob-cel{display:inline-flex}',
      '.jor-ob-grade thead{display:none}',
      '.jor-ob-grade,.jor-ob-grade tbody,.jor-ob-grade tr,.jor-ob-grade td{display:block;width:100%}',
      '.jor-ob-grade tr{border-bottom:1px solid var(--n-bd,#334155);padding:6px 0}',
      '.jor-ob-grade td{border:0;padding:2px 0;text-align:left!important}',
      '.jor-ob-grade td[data-r]::before{content:attr(data-r) ": ";color:var(--n-tx3,#94A3B8);font-size:12px}',
      '.jor-ob-agenda{display:block;overflow-x:auto}',
      '.jor-ob-agenda thead{display:table-header-group}',
      '.jor-ob-agenda tbody{display:table-row-group}',
      '.jor-ob-agenda tr{display:table-row;border:0;padding:0}',
      '.jor-ob-agenda td,.jor-ob-agenda th{display:table-cell;width:auto;padding:6px 8px!important;border-bottom:1px solid var(--n-bd,#334155)!important}',
      '.jor-ob-agenda td[data-r]::before{content:none}',
      '}',
    ].join('\n');
    var st = document.createElement('style'); st.id = 'jor-obra-css'; st.textContent = css; document.head.appendChild(st);
  }

  // ── Gravar uma seção ───────────────────────────────────────────────────────
  /** PUT .../fase2/<secao> com a versão lida. 409 mudou: relê a obra e mostra a frase do servidor. Devolve a resposta. */
  function veDinheiro() { var d = O().dinheiro; return !!d && d.visivel !== false; }
  /** Quem não vê o dinheiro recebe valor null: a tela não manda esses campos de volta no PUT (o servidor guarda os que já existem). */
  function semNulos(secao, corpo) {
    if (!corpo) return corpo;
    var c = clone(corpo);
    // O frete da carga que veio null não volta no PUT, com ou sem acesso ao dinheiro.
    if (secao === 'logistica' && Array.isArray(c.cargas)) c.cargas.forEach(function (g) { if (g && g.frete && (g.frete.valor_centavos === null || g.frete.valor_centavos === undefined)) delete g.frete.valor_centavos; });
    if (veDinheiro()) return c;
    if (secao === 'compra' && Array.isArray(c.itens)) c.itens.forEach(function (i) { if (i.valor_centavos === null || i.valor_centavos === undefined) delete i.valor_centavos; });
    if (secao === 'obra' && c.equipe && (c.equipe.combinado_centavos === null || c.equipe.combinado_centavos === undefined)) delete c.equipe.combinado_centavos;
    return c;
  }
  function salvar(secao, corpo, aviso) {
    var h = H(); var f2 = O().fase2;
    corpo = semNulos(secao, corpo);
    var versao = (f2 && f2.versoes && Number(f2.versoes[secao])) || 0;
    return h.api(base() + '/fase2/' + secao, 'PUT', { versao: versao, dados: corpo }, 60000).then(function (r) {
      if (r.status === 200 && r.json && r.json.ok !== false) {
        h.toast(aviso || 'Salvo.');
        if (r.json.conflitos && r.json.conflitos.length) h.toast('Atenção: a mesma equipe já está em outra obra neste dia.');
        return h.recarregar().then(function () { return r; });
      }
      if (r.status === 409 && r.json && r.json.mudou) { h.toast(msgSrv(r, 'Outra pessoa mexeu nesta parte agora. A tela vai recarregar.')); h.recarregar(); return r; }
      h.toast(msgSrv(r, 'Não consegui salvar agora. Tente de novo.')); return r;
    });
  }
  function botaoSalvar(rot, secao, montar, aviso) {
    var b = btn(rot, 'jor-btn-pri', function () {
      b.disabled = true;
      var c = montar(); if (c === false) { b.disabled = false; return; }
      salvar(secao, c, aviso).then(function () { b.disabled = false; });
    });
    return b;
  }

  /** Anexo ligado a um lugar da obra pelo id do arquivo: depois do envio, acha o arquivo novo do slot e grava o id por `ligar`. */
  function anexoLigado(f2, chave, rotulo, idAtual, ligar) {
    var h = H(); var tem = existe(f2, idAtual);
    var linha = el('div', 'jor-anexo'); linha.appendChild(el('span', 'jor-rot', rotulo));
    var est = el('span', 'jor-est' + (tem ? ' ok' : ''), tem ? 'Anexado' : 'Falta'); if (tem) est.insertBefore(h.icone('ok'), est.firstChild); linha.appendChild(est);
    linha.appendChild(D().botoesAnexo(rotulo, function (arq) {
      var st = vdcAgora();
      if (!st || String(st.id) !== String(O().card) || st.carregando || typeof window.vdcAnexar !== 'function') { h.toast('Abra o quadro Documentos e cadastro, logo abaixo, e tente de novo.'); return; }
      est.textContent = 'Enviando…';
      Promise.resolve(window.vdcAnexar(st, { chave: chave }, [arq])).then(function () {
        return h.api(base() + '/fase2', 'GET');
      }).then(function (r) {
        var lista = (r.json && r.json.arquivos) || [];
        var usados = idsLigados(f2);
        var novos = lista.filter(function (a) { return a.slot === chave && usados.indexOf(a.id) < 0 && a.id !== idAtual; });
        var novo = novos[novos.length - 1];
        if (novo) return ligar(novo.id);
        return h.recarregar();
      });
    }));
    return linha;
  }

  /** O canvas da assinatura. Fundo branco e traço preto: vira imagem de papel. Devolve { no, vazio(), png(): Promise<Blob>, limpar() }. */
  function assinatura() {
    var c = el('canvas', 'jor-ob-ass'); c.width = 600; c.height = 250; c.setAttribute('aria-label', 'Assinatura na tela');
    var g = c.getContext('2d'); var desenhou = false; var vivo = false;
    function limpar() { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#000000'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; desenhou = false; }
    limpar();
    function pos(e) { var r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; }
    c.addEventListener('pointerdown', function (e) { vivo = true; var p = pos(e); g.beginPath(); g.moveTo(p.x, p.y); try { c.setPointerCapture(e.pointerId); } catch (x) { /* sem captura */ } e.preventDefault(); });
    c.addEventListener('pointermove', function (e) { if (!vivo) return; var p = pos(e); g.lineTo(p.x, p.y); g.stroke(); desenhou = true; e.preventDefault(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { c.addEventListener(n, function () { vivo = false; }); });
    return {
      no: c, limpar: limpar, vazio: function () { return !desenhou; },
      png: function () { return new Promise(function (ok, falha) { c.toBlob(function (b) { if (b) ok(b); else falha(new Error('png')); }, 'image/png'); }); },
    };
  }
  function enviarPng(chave, blob, nome) {
    var st = vdcAgora();
    if (!st || String(st.id) !== String(O().card) || st.carregando || typeof window.vdcAnexar !== 'function') { H().toast('Abra o quadro Documentos e cadastro, logo abaixo, e tente de novo.'); return Promise.resolve(false); }
    var arq; try { arq = new File([blob], nome || 'assinatura.png', { type: 'image/png' }); } catch (e) { H().toast('Este aparelho não montou o arquivo da assinatura.'); return Promise.resolve(false); }
    return Promise.resolve(window.vdcAnexar(st, { chave: chave }, [arq])).then(function () {
      return H().api(base() + '/fase2', 'GET').then(function (r) {
        var lista = (r.json && r.json.arquivos) || []; var usados = idsLigados(O().fase2);
        var novos = lista.filter(function (a) { return a.slot === chave && usados.indexOf(a.id) < 0; });
        return novos.length ? novos[novos.length - 1].id : '';
      });
    });
  }

  // ── Etapa 4 · Compra ───────────────────────────────────────────────────────
  function compraDe(f2) { var c = dados(f2).compra || {}; return { itens: c.itens || [], compras: c.compras || [], sugeridos: c.sugeridos || [], contador: c.contador || { com_origem: 0, total: 0 } }; }
  function itensBase(c) { return c.itens.length ? clone(c.itens) : clone(c.sugeridos); }
  function nomeCompra(c, i) { return 'Compra ' + (i + 1) + (c.fornecedor ? ' · ' + c.fornecedor : ''); }
  function formaTxt(f) { var x = FORMAS.filter(function (y) { return y[0] === f; })[0]; return x ? x[1] : ''; }
  function somaItens(itens, cid) { var s = 0; itens.forEach(function (i) { if (i.compra_id === cid) s += Number(i.valor_centavos) || 0; }); return s; }

  function etapa4(esq, d, et, f2) {
    injetarCss(); var h = H();
    var c = compraDe(f2); var l = livro(); var pode = podeSecao(f2, 'compra');
    var prev = l && D().grupoPrevisto ? D().grupoPrevisto(l, 'material') : null;
    // 1. Para comprar
    var b1 = bloco('Para comprar');
    if (l) {
      var p = el('div', 'jor-ob-par jor-din-faixa');
      [['Recebido', h.rs(l.recebido)], ['Gasto até aqui', h.rs(l.gasto)], ['Saldo', h.rs(l.saldo)], ['Previsto da compra', prev && prev.previsto ? h.rs(prev.previsto) : 'Sem previsto']].forEach(function (x) {
        var c0 = el('div', 'jor-din-c' + (x[0] === 'Saldo' && l.saldo < 0 ? ' neg' : '')); c0.appendChild(el('small', 'jor-ob-sub', x[0])); c0.appendChild(el('b', '', x[1])); p.appendChild(c0);
      });
      b1.appendChild(p);
    } else b1.appendChild(el('p', 'jor-nota', 'O dinheiro desta obra não está à vista agora.'));
    esq.appendChild(b1);
    // 2. A regra
    esq.appendChild(el('p', 'jor-nota', 'A compra pode sair em fases. Cada item comprado fica separado, com origem, valor e data.'));
    // 3. Material da obra
    var b3 = bloco('Material da obra');
    var pcent = c.contador.total ? Math.round(100 * c.contador.com_origem / c.contador.total) : 0;
    b3.appendChild(el('p', '', 'Material com origem ' + c.contador.com_origem + ' de ' + c.contador.total));
    var br = el('div', 'jor-ob-barra'); var bi = el('i'); bi.style.width = pcent + '%'; br.appendChild(bi); br.setAttribute('role', 'progressbar'); br.setAttribute('aria-valuenow', String(pcent)); b3.appendChild(br);
    var algumaProposta = c.itens.concat(c.sugeridos).some(function (i) { return i.origem === 'proposta'; });
    if (algumaProposta) { var av = el('p', 'jor-aviso', 'Chegou pronta: kit da proposta, estrutura pelo telhado da vistoria e o material elétrico de sempre. '); av.appendChild(automatico()); b3.appendChild(av); }
    var itens = itensBase(c);
    if (!itens.length) b3.appendChild(el('p', 'jor-nota', 'Nenhum item ainda. Digite um, escolha da lista pronta ou leia uma nota.'));
    else b3.appendChild(gradeItens(itens, c, f2, pode));
    // 4. Jeitos de lançar
    if (pode) {
      var ac = el('div', 'jor-din-acoes');
      add(ac, btn('Digitar item', '', function () { itemDialogo(null, itens, c, f2); }),
        btn('Escolher da lista pronta', '', function () { listaProntaDialogo(itens, c, f2); }),
        btn('Ler a nota ou o pedido', '', function () { notaDialogo(null, itens, c, f2); }),
        btn('Nova compra', '', function () { compraDialogo(null, itens, c, f2); }));
      b3.appendChild(ac);
    }
    esq.appendChild(b3);
    // 5. Compras
    if (c.compras.length) {
      var b5 = bloco('Compras');
      c.compras.forEach(function (cp, i) { b5.appendChild(cartaoCompra(cp, i, itens, c, f2, pode)); });
      esq.appendChild(b5);
    }
    // 6. Real x previsto
    if (prev && prev.previsto) {
      var dif = (Number(prev.previsto) || 0) - (Number(prev.real) || 0);
      esq.appendChild(el('p', 'jor-nota', 'Real x previsto: ' + h.rs(prev.real) + ' x ' + h.rs(prev.previsto) + ' (' + (dif >= 0 ? h.rs(dif) + ' abaixo' : h.rs(-dif) + ' acima') + ').'));
    }
    // 7. A frase
    esq.appendChild(el('p', 'jor-nota', 'Material comprado em outra etapa entra do mesmo jeito: item por item, com origem, valor e data.'));
  }

  function situacaoItem(i, c) {
    var cp = c.compras.filter(function (x) { return x.id === i.compra_id; })[0];
    var falta = [];
    if (!i.fornecedor) falta.push('fornecedor');
    if (veDinheiro() && !(Number(i.valor_centavos) > 0)) falta.push('valor');
    if (!i.data) falta.push('data');
    if (!i.compra_id) falta.push('compra');
    if (falta.length) return { ok: false, txt: 'Falta ' + falta.join(', ') };
    if (!veDinheiro()) return { ok: true, txt: 'Com origem' };
    if (cp && Number(cp.a_pagar_centavos) > 0) return { ok: false, txt: 'A pagar ' + H().rs(cp.a_pagar_centavos) };
    if (cp && !(Number(cp.pago_centavos) > 0)) return { ok: false, txt: 'A comprar' };
    return { ok: true, txt: 'Comprado' };
  }
  function gradeItens(itens, c, f2, pode) {
    var h = H();
    var tb = el('table', 'jor-ob-grade'); var th = el('tr');
    ['Item', 'Origem', 'Data', 'Valor', 'Situação', ''].forEach(function (t) { th.appendChild(el('th', t === 'Valor' ? 'v' : '', t)); });
    tb.appendChild(add(el('thead'), th)); var body = el('tbody');
    var grupos = c.compras.map(function (cp, i) { return { cp: cp, i: i, itens: itens.filter(function (x) { return x.compra_id === cp.id; }) }; });
    grupos.push({ cp: null, i: -1, itens: itens.filter(function (x) { return !x.compra_id || !c.compras.some(function (cp) { return cp.id === x.compra_id; }); }) });
    grupos.forEach(function (g) {
      if (!g.itens.length) return;
      var cab = el('tr', 'cab'); var tdc = el('td'); tdc.colSpan = 6;
      if (g.cp) {
        var tot = somaItens(itens, g.cp.id);
        tdc.textContent = nomeCompra(g.cp, g.i) + (g.cp.forma ? ' · ' + formaTxt(g.cp.forma) : '') + (g.cp.data ? ' ' + h.ddmm(g.cp.data) : '') + (tot ? ' · ' + h.rs(tot) : '') + (Number(g.cp.pago_centavos) > 0 && !(Number(g.cp.a_pagar_centavos) > 0) ? ' · Comprovante' : '') +
          (g.cp.nota ? ' · Nota fiscal anexada' : (g.cp.nota_chega === 'na_retirada' ? ' · Nota fiscal: na retirada' : ' · Nota fiscal: chega com a carga (entra na Logística)'));
      } else tdc.textContent = 'A comprar';
      cab.appendChild(tdc); body.appendChild(cab);
      g.itens.forEach(function (i) {
        var tr = el('tr'); var s = situacaoItem(i, c);
        function td(rot, t, cls) { var x = el('td', cls || '', t); x.setAttribute('data-r', rot); tr.appendChild(x); return x; }
        td('Item', (i.quantidade ? (String(i.quantidade).replace('.', ',') + (i.unidade && i.unidade !== 'un' ? ' ' + i.unidade : '') + ' ') : '') + (i.descricao || '') + (i.etapa === 6 ? ' (material extra)' : ''));
        td('Origem', ORIGENS[i.origem] || ''); td('Data', i.data ? h.ddmm(i.data) : ''); td('Valor', Number(i.valor_centavos) > 0 ? h.rs(i.valor_centavos) : '', 'v');
        var ts = td('Situação', ''); ts.appendChild(tag(s.txt)); ts.firstChild.className = 'jor-ob-tag' + (s.ok ? ' ok' : ' av');
        var ta = td('', ''); if (pode) ta.appendChild(btn('Editar', 'jor-btn-link', function () { itemDialogo(i, itens, c, f2); }));
        body.appendChild(tr);
      });
    });
    tb.appendChild(body); var w = el('div', 'dc-wrap'); w.appendChild(tb); return w;
  }

  function itemDialogo(item, itens, c, f2) {
    var h = H(); var novo = !item; var it = item ? clone(item) : { id: null, origem: 'manual', tipo: 'outro', descricao: '', quantidade: 1, unidade: 'un', marca: '', modelo: '', fornecedor: '', valor_centavos: null, data: '', etapa: 4, compra_id: null };
    var ctl = {};
    h.dialogo(novo ? 'Digitar item' : 'Item da compra', function (box) {
      var g = el('div', 'jor-ob-par');
      ctl.desc = entrada('text', it.descricao, 'Descrição'); ctl.tipo = selecao(TIPOS, it.tipo || 'outro', 'Tipo'); ctl.qtd = entrada('text', it.quantidade === null || it.quantidade === undefined ? '' : String(it.quantidade).replace('.', ','), 'Quantidade');
      ctl.un = selecao(UNIDADES, it.unidade || 'un', 'Unidade'); ctl.marca = entrada('text', it.marca || '', 'Marca'); ctl.modelo = entrada('text', it.modelo || '', 'Modelo');
      ctl.forn = entrada('text', it.fornecedor || '', 'Fornecedor');
      ctl.compra = selecao([['', 'Sem compra ainda']].concat(c.compras.map(function (cp, i) { return [cp.id, nomeCompra(cp, i)]; })), it.compra_id || '', 'Compra');
      ctl.valor = entrada('text', Number(it.valor_centavos) > 0 ? txtCents(it.valor_centavos) : '', 'Valor total do item'); ctl.valor.inputMode = 'decimal';
      var mostraValor = veDinheiro();
      ctl.data = entrada('date', it.data || '', 'Data da compra');
      add(g, campo('Descrição', ctl.desc), campo('Tipo', ctl.tipo), campo('Quantidade', ctl.qtd), campo('Unidade', ctl.un), campo('Marca', ctl.marca), campo('Modelo', ctl.modelo), campo('Fornecedor', ctl.forn), campo('Compra', ctl.compra), mostraValor ? campo('Valor total (R$)', ctl.valor) : null, campo('Data', ctl.data));
      box.appendChild(g);
      var gm = el('div', 'jor-ob-par'); gm.id = 'jor-ob-garantia';
      ctl.pw = entrada('text', it.potencia_w || '', 'Potência (W)'); ctl.fab = entrada('text', it.garantia_fabricacao_anos || '', 'Fabricação (anos)'); ctl.des = entrada('text', it.garantia_desempenho_anos || '', 'Desempenho (anos)');
      ctl.pk = entrada('text', it.potencia_kw || '', 'Potência (kW)'); ctl.gi = entrada('text', it.garantia_anos || '', 'Garantia (anos)');
      var info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); ctl.info = info;
      function mostrar() {
        gm.replaceChildren();
        if (ctl.tipo.value === 'modulo') add(gm, campo('Potência de cada placa (W)', ctl.pw), campo('Fabricação (anos)', ctl.fab), campo('Desempenho (anos)', ctl.des));
        if (ctl.tipo.value === 'inversor') add(gm, campo('Potência (kW)', ctl.pk), campo('Garantia (anos)', ctl.gi));
        cert.replaceChildren();
        if (!novo && ctl.tipo.value === 'modulo') cert.appendChild(h.anexo('cert_modulo', 'Certificado de garantia das placas', arqs(f2, 'cert_modulo').length > 0));
        if (!novo && ctl.tipo.value === 'inversor') cert.appendChild(h.anexo('cert_inversor', 'Certificado de garantia do inversor', arqs(f2, 'cert_inversor').length > 0));
      }
      var cert = el('div');
      ctl.tipo.addEventListener('change', mostrar);
      add(box, gm, cert, info); mostrar();
      return { foco: ctl.desc };
    }, 'Salvar', function (b) {
      var q = ctl.qtd.value.trim() ? Number(ctl.qtd.value.replace(',', '.')) : null;
      var v = veDinheiro() ? h.cents(ctl.valor.value) : null;
      if (!ctl.desc.value.trim()) { ctl.info.textContent = 'Diga o que é o item.'; return; }
      if (q !== null && !(q > 0)) { ctl.info.textContent = 'Use só números na quantidade.'; return; }
      if (typeof v === 'number' && isNaN(v)) { ctl.info.textContent = 'Use um valor em reais, como 1.250,00.'; return; }
      it.descricao = ctl.desc.value.trim(); it.tipo = ctl.tipo.value; it.quantidade = q; it.unidade = ctl.un.value; it.marca = ctl.marca.value.trim(); it.modelo = ctl.modelo.value.trim();
      it.fornecedor = ctl.forn.value.trim(); it.compra_id = ctl.compra.value || null; if (veDinheiro()) it.valor_centavos = v > 0 ? v : null; it.data = ctl.data.value || '';
      if (it.tipo === 'modulo') { it.potencia_w = Number(ctl.pw.value.replace(',', '.')) || null; it.garantia_fabricacao_anos = Number(ctl.fab.value) || null; it.garantia_desempenho_anos = Number(ctl.des.value) || null; }
      if (it.tipo === 'inversor') { it.potencia_kw = Number(ctl.pk.value.replace(',', '.')) || null; it.garantia_anos = Number(ctl.gi.value) || null; }
      b.disabled = true;
      var lista = itens.slice();
      if (novo) lista.push(it); else lista = lista.map(function (x) { return x.id === it.id ? it : x; });
      salvar('compra', { itens: lista, compras: clone(c.compras) }, 'Item salvo.').then(function (r) {
        if (r.status === 200) h.fecharDlg(); else { b.disabled = false; ctl.info.textContent = msgSrv(r, 'Não consegui salvar agora.'); }
      });
    });
  }

  function listaProntaDialogo(itens, c, f2) {
    var h = H(); var lista = f2.lista_pronta || []; var marcas = [];
    h.dialogo('Escolher da lista pronta', function (box) {
      box.appendChild(el('p', 'jor-nota', 'Os itens que vocês sempre compram. Marque os que entram nesta obra. Quem compra preenche a quantidade.'));
      lista.forEach(function (x) { var m = marca(x.descricao + ' (' + (x.unidade || 'un') + ')', false, x.descricao); box.appendChild(m); marcas.push([x, m]); });
      return {};
    }, 'Adicionar', function (b) {
      var novos = marcas.filter(function (p) { return p[1].input.checked; }).map(function (p) {
        return { id: null, origem: 'lista', tipo: p[0].tipo || 'eletrico', descricao: p[0].descricao, quantidade: null, unidade: p[0].unidade || 'un', marca: '', modelo: '', fornecedor: '', valor_centavos: null, data: '', etapa: 4, compra_id: null };
      });
      if (!novos.length) { h.fecharDlg(); return; }
      b.disabled = true;
      salvar('compra', { itens: itens.concat(novos), compras: clone(c.compras) }, 'Itens adicionados.').then(function (r) { if (r.status === 200) h.fecharDlg(); else b.disabled = false; });
    });
  }

  function compraDialogo(cp, itens, c, f2, depois) {
    var h = H(); var novo = !cp; var x = cp ? clone(cp) : { id: null, fornecedor: '', cidade: '', data: hoje(), forma: 'pix', nota_chega: 'com_a_carga', nota: null }; var ctl = {};
    h.dialogo(novo ? 'Nova compra' : 'Compra', function (box) {
      ctl.forn = entrada('text', x.fornecedor, 'Fornecedor'); ctl.cid = entrada('text', x.cidade, 'Cidade do fornecedor'); ctl.data = entrada('date', x.data, 'Data'); ctl.forma = selecao(FORMAS, x.forma || 'pix', 'Forma');
      ctl.nota = selecao([['com_a_carga', 'Chega com a carga'], ['na_retirada', 'Na retirada'], ['anexada', 'Já anexada']], x.nota_chega || 'com_a_carga', 'A nota fiscal');
      var g = el('div', 'jor-ob-par'); add(g, campo('Fornecedor', ctl.forn), campo('Cidade', ctl.cid), campo('Data', ctl.data), campo('Forma', ctl.forma), campo('Nota fiscal', ctl.nota)); box.appendChild(g);
      ctl.info = el('p', 'jor-erro'); ctl.info.setAttribute('role', 'status'); box.appendChild(ctl.info); return { foco: ctl.forn };
    }, 'Salvar', function (b) {
      if (!ctl.forn.value.trim()) { ctl.info.textContent = 'Diga o fornecedor.'; return; }
      x.fornecedor = ctl.forn.value.trim(); x.cidade = ctl.cid.value.trim(); x.data = ctl.data.value; x.forma = ctl.forma.value; x.nota_chega = ctl.nota.value;
      var compras = clone(c.compras); if (novo) compras.push(x); else compras = compras.map(function (y) { return y.id === x.id ? x : y; });
      b.disabled = true;
      salvar('compra', { itens: itens, compras: compras }, 'Compra salva.').then(function (r) {
        if (r.status === 200) { h.fecharDlg(); if (depois) depois(r); } else { b.disabled = false; ctl.info.textContent = msgSrv(r, 'Não consegui salvar agora.'); }
      });
    });
  }

  function cartaoCompra(cp, i, itens, c, f2, pode) {
    var h = H(); var bx = el('div', 'jor-ob-carga');
    var tot = somaItens(itens, cp.id); var paga = Number(cp.pago_centavos) > 0 && !(Number(cp.a_pagar_centavos) > 0);
    var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', nomeCompra(cp, i))); t.appendChild(tag(paga ? 'Comprada' : 'A comprar')); t.lastChild.className = 'jor-ob-tag ' + (paga ? 'ok' : 'av'); bx.appendChild(t);
    bx.appendChild(el('p', 'jor-nota', [cp.cidade, formaTxt(cp.forma), cp.data ? h.ddmm(cp.data) : '', tot ? h.rs(tot) : '', Number(cp.pago_centavos) > 0 ? 'Pago ' + h.rs(cp.pago_centavos) : ''].filter(Boolean).join(' · ')));
    bx.appendChild(el('p', 'jor-nota', cp.nota ? 'Nota fiscal anexada' + (cp.nota.numero ? ' · nº ' + cp.nota.numero : '') : (cp.nota_chega === 'na_retirada' ? 'Nota fiscal: na retirada' : 'Nota fiscal: chega com a carga (entra na Logística)')));
    if (pode) {
      var ac = el('div', 'jor-din-acoes');
      if (!paga) ac.appendChild(btn('Marcar como comprado', '', function () { compradoDialogo(cp, i, itens, c, f2); }));
      ac.appendChild(btn('Pelo comprovante', '', function () { pagarCompra(cp, itens); }));
      ac.appendChild(btn('Editar a compra', 'jor-btn-link', function () { compraDialogo(cp, itens, c, f2); }));
      bx.appendChild(ac);
    }
    return bx;
  }
  function pagarCompra(cp, itens) {
    var tem = itens.some(function (x) { return x.compra_id === cp.id && (x.tipo === 'modulo' || x.tipo === 'inversor'); });
    var falta = Number(cp.a_pagar_centavos) > 0 ? Number(cp.a_pagar_centavos) : somaItens(itens, cp.id);
    D().lancar({ tipo: 'saida', etapa: 4, categoria: tem ? 'equipamento' : 'material', compra_id: cp.id, valor_sugerido: falta || null, contraparte: cp.fornecedor });
  }
  /** "Marcar como comprado": primeiro a nota fiscal (opcional, a IA lê e sugere), depois o comprovante. */
  function compradoDialogo(cp, i, itens, c, f2) {
    var h = H(); var estado = { msg: '' };
    h.dialogo('Marcar como comprado', function (box) {
      box.appendChild(el('p', 'jor-nota', nomeCompra(cp, i)));
      var t1 = el('div', 'jor-bloco-t'); t1.appendChild(el('span', '', 'Primeiro, a nota fiscal')); t1.appendChild(automatico()); box.appendChild(t1);
      var st = el('p', 'jor-nota', cp.nota ? 'Nota fiscal anexada. Use Trocar a nota para mudar.' : 'Se a nota chega com a carga, pule este passo: ela entra na Logística.'); box.appendChild(st);
      var area = el('div'); box.appendChild(area);
      area.appendChild(botoesNota(cp, itens, c, f2, function (m) { st.textContent = m; }, !!cp.nota));
      box.appendChild(el('div', 'jor-bloco-t', 'Agora, o comprovante'));
      box.appendChild(btn('Anexar o comprovante', 'jor-btn-pri', function () { h.fecharDlg(); pagarCompra(cp, itens); }));
      return {};
    }, 'Fechar', function () { h.fecharDlg(); });
    void estado;
  }
  /** Os botões do Anexo da nota (Foto, Arquivo, Print). Sobe com ler:true e doc:nota, depois liga à compra. */
  function botoesNota(cp, itens, c, f2, aviso, trocar) {
    var h = H(); var caixa = el('div');
    var lab = el('p', 'jor-nota', trocar ? 'Trocar a nota' : 'Anexar a nota'); caixa.appendChild(lab);
    caixa.appendChild(D().botoesAnexo('nota fiscal', function (arq) {
      aviso('Lendo a nota…');
      D().prepararArquivo(arq).then(function (a) {
        return h.api(base() + '/dinheiro/comprovante', 'POST', { base64: a.base64, media_type: a.media_type, nome: a.nome, ler: true, doc: 'nota' }, 90000);
      }).then(function (r) {
        if (!(r.status === 200 && r.json && r.json.arquivo)) { aviso(msgSrv(r, 'Não consegui enviar a nota. Tente de novo.')); return null; }
        return h.api(base() + '/fase2/nota', 'POST', { compra_id: cp.id, arquivo_path: r.json.arquivo.path, trocar: !!trocar }, 60000);
      }).then(function (r) {
        if (!r) return;
        if (r.status === 200 && r.json && r.json.ok !== false) {
          aviso(r.json.mensagem || 'A nota foi anexada.');
          h.recarregar().then(function () { if (r.json.lida && r.json.lida.itens && r.json.lida.itens.length) lidosDialogo(cp, r.json.lida); });
        } else aviso(msgSrv(r, 'Não consegui ligar a nota. Tente de novo.'));
      }, function (e) { aviso(D().msgArquivo ? D().msgArquivo(e) : 'Não consegui ler o arquivo. Tente de novo.'); });
    }, false, { xml: true }));
    return caixa;
  }
  function unidadeDaNota(u) { var s = String(u || '').trim().toLowerCase(); if (/^(m|mt|mts|metro|metros)$/.test(s)) return 'm'; if (/^(par|pr|pares)$/.test(s)) return 'par'; if (/^(kit|kt|kits)$/.test(s)) return 'kit'; return 'un'; }
  /** Os itens que a IA leu na nota: a pessoa confere um por um. Cada um preenche um item que falta ou entra como item novo. */
  function lidosDialogo(cp, lida) {
    var h = H(); var f2 = O().fase2; if (!f2) return; var c = compraDe(f2); var itens = itensBase(c);
    var livres = itens.filter(function (x) { return !veDinheiro() || !(Number(x.valor_centavos) > 0); });
    var linhas = [];
    h.dialogo('A nota foi lida', function (box) {
      var xml = lida.origem === 'xml';
      box.appendChild(el('p', 'jor-ok', (xml ? 'O XML foi lido: ' : 'A nota foi lida: ') + [lida.emitente, lida.data ? h.ddmm(lida.data) : '', h.plural(lida.n_itens || lida.itens.length, 'item', 'itens'), lida.valor_total_centavos ? h.rs(lida.valor_total_centavos) : ''].filter(Boolean).join(' · ')));
      box.appendChild(el('p', 'jor-nota', xml ? 'Cada item já vem com o frete, o IPI e o desconto dele. Confira antes de salvar.' : 'A leitura só sugere. Confira cada item e o valor antes de salvar.'));
      if (Number(lida.diferenca_centavos) < 0) box.appendChild(el('p', 'jor-nota', 'Os itens somam ' + h.rs(lida.soma_itens_centavos) + ' e a nota ' + h.rs(lida.valor_total_centavos) + '. Confira antes de salvar.'));
      lida.itens.forEach(function (li) {
        var lin = el('div', 'jor-ob-linha');
        var rot = (li.descricao || 'Item') + (li.ncm ? ' · NCM ' + li.ncm : '') + ' · ' + h.rs(li.valor_total_centavos)
          + (typeof li.valor_produto_centavos === 'number' && li.valor_produto_centavos !== li.valor_total_centavos ? ' (produto ' + h.rs(li.valor_produto_centavos) + ')' : '');
        var m = marca(rot, true, li.descricao || 'Item da nota'); lin.appendChild(m);
        var sel = selecao([['', 'Item novo']].concat(livres.map(function (x) { return [x.id, x.descricao]; })), '', 'Ligar a um item');
        lin.appendChild(sel); box.appendChild(lin); linhas.push({ li: li, m: m, sel: sel });
      });
      return {};
    }, 'Usar os itens', function (b) {
      var usadas = {}; var lista = itens.slice(); var tem = false;
      linhas.forEach(function (p) {
        if (!p.m.input.checked) return; tem = true; var li = p.li;
        var alvo = p.sel.value && !usadas[p.sel.value] ? lista.filter(function (x) { return x.id === p.sel.value; })[0] : null;
        if (alvo) { usadas[alvo.id] = 1; if (veDinheiro()) alvo.valor_centavos = li.valor_total_centavos || null; if (!alvo.quantidade && li.quantidade) alvo.quantidade = li.quantidade; alvo.fornecedor = lida.emitente || cp.fornecedor || alvo.fornecedor; alvo.data = lida.data || alvo.data || ''; alvo.compra_id = cp.id; }
        else lista.push({ id: null, origem: 'nota', tipo: 'outro', descricao: String(li.descricao || 'Item da nota').slice(0, 120), quantidade: li.quantidade || null, unidade: unidadeDaNota(li.unidade), marca: '', modelo: '', fornecedor: lida.emitente || cp.fornecedor || '', valor_centavos: veDinheiro() ? (li.valor_total_centavos || null) : null, data: lida.data || '', etapa: 4, compra_id: cp.id });
      });
      if (!tem) { h.fecharDlg(); return; }
      if (lista.length > 80) { h.toast('A Compra ficaria com mais de 80 itens. Junte alguns antes de usar a nota.'); return; }
      b.disabled = true;
      salvar('compra', { itens: lista, compras: clone(c.compras) }, 'Itens da nota salvos.').then(function (r) { if (r.status === 200) h.fecharDlg(); else b.disabled = false; });
    });
  }
  function notaDialogo(cp0, itens, c, f2) {
    var h = H(); var sel = null;
    if (!c.compras.length) { compraDialogo(null, itens, c, f2, function () { h.toast('Compra criada. Agora anexe a nota nela.'); }); return; }
    h.dialogo('Ler a nota ou o pedido', function (box) {
      box.appendChild(el('p', 'jor-nota', 'Foto, PDF, print ou o XML da nota. O XML entra exato, sem IA. Foto, PDF e print a IA lê e só sugere.'));
      sel = selecao(c.compras.map(function (cp, i) { return [cp.id, nomeCompra(cp, i)]; }), cp0 ? cp0.id : c.compras[0].id, 'Compra da nota');
      box.appendChild(campo('Compra', sel));
      var st = el('p', 'jor-nota'); st.setAttribute('role', 'status'); box.appendChild(st);
      var area = el('div'); box.appendChild(area);
      function pinta() { var cp = c.compras.filter(function (x) { return x.id === sel.value; })[0]; area.replaceChildren(botoesNota(cp, itens, c, f2, function (m) { st.textContent = m; }, !!cp.nota)); }
      sel.addEventListener('change', pinta); pinta();
      return {};
    }, 'Fechar', function () { h.fecharDlg(); });
  }

  // ── Etapa 5 · Logística ────────────────────────────────────────────────────
  function cargaNova(n) {
    return { id: null, nome: 'Carga ' + n, itens: [], saida: { lugar: '', em: '' }, chegada: { lugar: '', destino: 'obra', em: '' }, transporte: { empresa: '', motorista: '' }, compras: [],
      recebido_por: { nome: '', assinatura_id: '' }, conferencia: { itens_ok: [], foto_id: '' }, avaria: { tem: false, descricao: '', foto_id: '', o_que_fazer: '', resolvida: false },
      frete: { valor_centavos: 0, forma: 'pix' }, documentos: [] };
  }
  function etapa5(esq, d, et, f2) {
    injetarCss(); var h = H();
    var lg = (dados(f2).logistica || {}); var cargas = (lg.cargas || []).map(clone); var pode = podeSecao(f2, 'logistica');
    var c = compraDe(f2); var itensCompra = c.itens.filter(function (i) { return i.etapa !== 6; });
    var b0 = bloco('Cargas'); var av = el('p', 'jor-aviso', 'Os itens e o fornecedor vêm da Compra, e o endereço vem da ficha. '); av.appendChild(automatico()); b0.appendChild(av);
    if (!itensCompra.length) b0.appendChild(el('p', 'jor-nota', 'A Compra ainda não tem itens. Monte a lista na etapa 4.'));
    esq.appendChild(b0);
    cargas.forEach(function (cg, i) { esq.appendChild(cartaoCarga(cg, i, cargas, itensCompra, c, f2, pode, d)); });
    if (pode) {
      var ac = el('div', 'jor-din-acoes');
      ac.appendChild(btn('Nova carga', '', function () { var n = cargas.concat([cargaNova(cargas.length + 1)]); salvar('logistica', { cargas: n }, 'Carga criada.'); }));
      esq.appendChild(ac);
    }
  }
  function cartaoCarga(cg, idx, todas, itensCompra, c, f2, pode, d) {
    var h = H(); var bx = el('div', 'jor-ob-carga'); bx.setAttribute('data-carga', String(idx));
    var feita = (cg.conferencia.itens_ok || []).length > 0 && cg.itens.length > 0 && cg.itens.every(function (id) { return cg.conferencia.itens_ok.indexOf(id) >= 0; }) && existe(f2, cg.conferencia.foto_id);
    var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', 'Carga ' + (idx + 1) + ' · ' + (cg.nome || '')));
    if (feita) { var tg = tag('Conferida'); tg.className = 'jor-ob-tag ok'; t.appendChild(tg); }
    bx.appendChild(t);
    var nome = entrada('text', cg.nome, 'Nome da carga'); nome.disabled = !pode; bx.appendChild(campo('Nome da carga', nome));
    nome.addEventListener('input', function () { cg.nome = nome.value; });
    function gravar(aviso) { return salvar('logistica', { cargas: todas.map(function (x, k) { return k === idx ? cg : x; }) }, aviso || 'Carga salva.'); }
    // 1. O que vai
    bx.appendChild(el('span', 'jor-ob-cl', 'O que vai, item a item'));
    if (!itensCompra.length) bx.appendChild(el('p', 'jor-nota', 'Sem itens na Compra.'));
    itensCompra.forEach(function (i) {
      if (i.id === null) return;
      var m = marca((i.quantidade ? i.quantidade + ' ' : '') + i.descricao, cg.itens.indexOf(i.id) >= 0, i.descricao); m.input.disabled = !pode;
      m.input.addEventListener('change', function () { var k = cg.itens.indexOf(i.id); if (m.input.checked && k < 0) cg.itens.push(i.id); if (!m.input.checked && k >= 0) cg.itens.splice(k, 1); });
      bx.appendChild(m);
    });
    // 2. Saída
    bx.appendChild(el('span', 'jor-ob-cl', 'Saída'));
    var fornDe = ''; cg.itens.forEach(function (id) { var it = itensCompra.filter(function (x) { return x.id === id; })[0]; var cp = it && c.compras.filter(function (x) { return x.id === it.compra_id; })[0]; if (cp && cp.cidade && !fornDe) fornDe = cp.cidade + (cp.fornecedor ? ' · ' + cp.fornecedor : ''); });
    var sl = entrada('text', cg.saida.lugar || fornDe, 'Lugar de saída'); sl.disabled = !pode; sl.addEventListener('input', function () { cg.saida.lugar = sl.value; });
    if (!cg.saida.lugar && fornDe) cg.saida.lugar = fornDe;
    var sem = entrada('datetime-local', cg.saida.em || '', 'Saiu em'); sem.disabled = !pode;
    var par = el('div', 'jor-ob-par'); par.appendChild(add(campo('Lugar', sl), !cg.saida.lugar || cg.saida.lugar === fornDe ? automatico() : null)); par.appendChild(campo('Saiu em', sem)); bx.appendChild(par);
    // 3. Chegada
    bx.appendChild(el('span', 'jor-ob-cl', 'Chegada'));
    var dest = selecao([['obra', 'Obra'], ['deposito', 'Depósito']], cg.chegada.destino || 'obra', 'Destino');
    var endObra = (f2.dados && f2.dados.endereco_obra) || (d.card && d.card.cidade) || '';
    function lugarAuto() { return dest.value === 'obra' ? 'Obra · ' + endObra : 'Depósito'; }
    var cl = entrada('text', cg.chegada.lugar || lugarAuto(), 'Lugar de chegada'); cl.disabled = !pode;
    if (!cg.chegada.lugar) cg.chegada.lugar = lugarAuto();
    var cem = entrada('datetime-local', cg.chegada.em || '', 'Chegou em'); cem.disabled = !pode; dest.disabled = !pode;
    var tempo = el('b', '', duracao(sem.value, cem.value) || 'Falta a data');
    function atualizaTempo() { tempo.textContent = duracao(sem.value, cem.value) || 'Falta a data'; }
    sem.addEventListener('input', function () { cg.saida.em = sem.value; atualizaTempo(); }); cem.addEventListener('input', function () { cg.chegada.em = cem.value; atualizaTempo(); });
    cl.addEventListener('input', function () { cg.chegada.lugar = cl.value; });
    dest.addEventListener('change', function () { cg.chegada.destino = dest.value; if (!cl.value || /^(Obra ·|Depósito)/.test(cl.value)) { cl.value = lugarAuto(); cg.chegada.lugar = cl.value; } });
    var par2 = el('div', 'jor-ob-par'); par2.appendChild(add(campo('Lugar', cl), automatico())); add(par2, campo('Destino', dest), campo('Chegou em', cem));
    var lt = el('label', '', 'Tempo'); lt.appendChild(tempo); lt.appendChild(automatico()); par2.appendChild(lt); bx.appendChild(par2);
    // 4. Quem leva
    bx.appendChild(el('span', 'jor-ob-cl', 'Quem leva'));
    var emp = entrada('text', cg.transporte.empresa, 'Empresa ou carro'); var mot = entrada('text', cg.transporte.motorista, 'Motorista'); emp.disabled = mot.disabled = !pode;
    emp.addEventListener('input', function () { cg.transporte.empresa = emp.value; }); mot.addEventListener('input', function () { cg.transporte.motorista = mot.value; });
    var par3 = el('div', 'jor-ob-par'); add(par3, campo('Empresa ou carro', emp), campo('Motorista', mot)); bx.appendChild(par3);
    // 5. Nota fiscal
    bx.appendChild(el('span', 'jor-ob-cl', 'Nota fiscal'));
    var cps = {}; cg.itens.forEach(function (id) { var it = itensCompra.filter(function (x) { return x.id === id; })[0]; if (it && it.compra_id) cps[it.compra_id] = 1; });
    var ids = Object.keys(cps);
    if (!ids.length) bx.appendChild(el('p', 'jor-nota', 'Marque os itens e salve a carga. As compras deles aparecem aqui.'));
    ids.forEach(function (cid) {
      var cp = c.compras.filter(function (x) { return x.id === cid; })[0]; if (!cp) return;
      var lin = el('div', 'jor-ob-linha'); lin.appendChild(el('span', '', nomeCompra(cp, c.compras.indexOf(cp))));
      if (cp.nota) { var tg2 = tag('Nota anexada' + (cp.nota.numero ? ' · nº ' + cp.nota.numero : '')); tg2.className = 'jor-ob-tag ok'; lin.appendChild(tg2); }
      var st2 = el('span', 'jor-nota'); lin.appendChild(st2);
      if (pode || podeSecao(f2, 'compra')) lin.appendChild(botoesNota(cp, c.itens, c, f2, function (m) { st2.textContent = m; }, !!cp.nota));
      bx.appendChild(lin);
    });
    // 6. Quem recebeu
    bx.appendChild(el('span', 'jor-ob-cl', 'Quem recebeu'));
    var rn = entrada('text', cg.recebido_por.nome, 'Nome de quem recebeu'); rn.disabled = !pode; rn.addEventListener('input', function () { cg.recebido_por.nome = rn.value; });
    bx.appendChild(campo('Nome', rn));
    if (pode) bx.appendChild(assinaturaBloco(f2, 'log_assinatura', cg.recebido_por.assinatura_id, function (id) { cg.recebido_por.assinatura_id = id; return gravar('Assinatura guardada.'); }));
    // 7. Conferência
    bx.appendChild(el('span', 'jor-ob-cl', 'Conferência contra a compra'));
    if (!cg.itens.length) bx.appendChild(el('p', 'jor-nota', 'Sem itens marcados.'));
    cg.itens.forEach(function (id) {
      var it = itensCompra.filter(function (x) { return x.id === id; })[0]; if (!it) return;
      var m = marca((it.quantidade ? it.quantidade + ' ' : '') + it.descricao + ' conferido', cg.conferencia.itens_ok.indexOf(id) >= 0, 'Conferido: ' + it.descricao); m.input.disabled = !pode;
      m.input.addEventListener('change', function () { var k = cg.conferencia.itens_ok.indexOf(id); if (m.input.checked && k < 0) cg.conferencia.itens_ok.push(id); if (!m.input.checked && k >= 0) cg.conferencia.itens_ok.splice(k, 1); });
      bx.appendChild(m);
    });
    if (pode) bx.appendChild(anexoLigado(f2, 'log_conferencia', 'Foto da conferência', cg.conferencia.foto_id, function (id) { cg.conferencia.foto_id = id; return gravar('Foto guardada.'); }));
    // 8. Avaria
    bx.appendChild(el('span', 'jor-ob-cl', 'Avaria'));
    var fa = el('div', 'jor-filtros');
    [[true, 'Sim'], [false, 'Não']].forEach(function (o) {
      var b = el('button', 'jor-chip' + (!!cg.avaria.tem === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !pode; b.setAttribute('aria-label', 'Teve avaria: ' + o[1]);
      b.addEventListener('click', function () { cg.avaria.tem = o[0]; gravar('Salvo.'); }); fa.appendChild(b);
    });
    bx.appendChild(el('p', 'jor-nota', 'Teve avaria?')); bx.appendChild(fa);
    if (cg.avaria.tem) {
      if (pode) bx.appendChild(anexoLigado(f2, 'log_avaria', 'Foto da avaria', cg.avaria.foto_id, function (id) { cg.avaria.foto_id = id; return gravar('Foto guardada.'); }));
      var ao = el('textarea', 'jor-ta'); ao.maxLength = 400; ao.value = cg.avaria.o_que_fazer || ''; ao.setAttribute('aria-label', 'O que fazer'); ao.disabled = !pode; ao.addEventListener('input', function () { cg.avaria.o_que_fazer = ao.value; });
      bx.appendChild(campo('O que fazer', ao));
      var rv = marca('Resolvida', cg.avaria.resolvida, 'Avaria resolvida'); rv.input.disabled = !pode; rv.input.addEventListener('change', function () { cg.avaria.resolvida = rv.input.checked; }); bx.appendChild(rv);
    }
    // 9. Frete
    bx.appendChild(el('span', 'jor-ob-cl', 'Frete'));
    var fv = entrada('text', Number(cg.frete.valor_centavos) > 0 ? txtCents(cg.frete.valor_centavos) : '', 'Valor do frete'); fv.inputMode = 'decimal'; fv.placeholder = 'R$ 0,00 quando vem incluso'; fv.disabled = !pode;
    var ff = selecao(FORMAS, cg.frete.forma || 'pix', 'Forma do frete'); ff.disabled = !pode;
    fv.addEventListener('input', function () { var v = h.cents(fv.value); cg.frete.valor_centavos = (typeof v === 'number' && v > 0) ? v : 0; }); ff.addEventListener('change', function () { cg.frete.forma = ff.value; });
    var par4 = el('div', 'jor-ob-par'); add(par4, campo('Valor (R$ 0,00 quando vem incluso)', fv), campo('Forma', ff)); bx.appendChild(par4);
    if (Number(cg.frete.valor_centavos) > 0) {
      var lf = el('div', 'jor-din-acoes');
      var bf = btn('Lançar o frete', 'jor-btn-pri', function () { D().lancar({ tipo: 'saida', etapa: 5, categoria: 'frete', carga_id: cg.id, valor_sugerido: cg.frete.valor_centavos }); });
      bf.disabled = !cg.id || !pode; lf.appendChild(bf); if (!cg.id) lf.appendChild(el('span', 'jor-nota', 'Salve a carga primeiro.')); bx.appendChild(lf);
    } else bx.appendChild(el('p', 'jor-nota', 'Sem gasto, não pede comprovante.'));
    // 10. Anexar documento
    bx.appendChild(el('span', 'jor-ob-cl', 'Anexar documento'));
    if (pode) bx.appendChild(anexoLigado(f2, 'log_documento', 'Canhoto, rastreio ou conhecimento de transporte', (cg.documentos || [])[0] === undefined ? '' : cg.documentos[cg.documentos.length - 1], function (id) { cg.documentos = (cg.documentos || []).concat([id]); return gravar('Documento guardado.'); }));
    if ((cg.documentos || []).length) bx.appendChild(el('p', 'jor-nota', h.plural(cg.documentos.length, 'documento anexado', 'documentos anexados') + '.'));
    // Botões
    if (pode) {
      var bt = el('div', 'jor-din-acoes');
      bt.appendChild(btn('Salvar a carga', 'jor-btn-pri', function () { gravar('Carga salva.'); }));
      bt.appendChild(btn('Confirmar entrega', 'jor-ob-cel', function () { cg.chegada.em = agoraLocal(); cem.value = cg.chegada.em; atualizaTempo(); gravar('Entrega confirmada.'); }));
      bx.appendChild(bt);
    }
    return bx;
  }
  /** "Quem recebeu" e o termo: o canvas, o Refazer e o envio da imagem para o slot, ligada pelo id. */
  function assinaturaBloco(f2, slot, idAtual, ligar, antes) {
    var h = H(); var caixa = el('div'); var tem = existe(f2, idAtual);
    var as = assinatura();
    caixa.appendChild(el('p', 'jor-nota', tem ? 'Assinatura guardada. Faça outra para trocar.' : 'Assinatura na tela'));
    caixa.appendChild(as.no);
    var info = el('p', 'jor-erro'); info.setAttribute('role', 'status');
    var ac = el('div', 'jor-din-acoes');
    ac.appendChild(btn('Refazer', '', function () { as.limpar(); }));
    var ok = btn('Guardar a assinatura', '', function () {
      if (as.vazio()) { info.textContent = 'Peça a assinatura na tela.'; return; }
      if (antes && antes() === false) return;
      ok.disabled = true; info.textContent = '';
      as.png().then(function (blob) { return enviarPng(slot, blob, 'assinatura.png'); }).then(function (id) {
        if (id) return ligar(id);
        info.textContent = 'Não consegui guardar a assinatura. Tente de novo.'; ok.disabled = false;
      }, function () { info.textContent = 'Não consegui guardar a assinatura. Tente de novo.'; ok.disabled = false; });
    });
    ac.appendChild(ok); caixa.appendChild(ac); caixa.appendChild(info); void h;
    return caixa;
  }

  // ── Etapa 6 · Obra ─────────────────────────────────────────────────────────
  function semanaDe(ymd) { return ymd; }
  function agendaEquipes(alvo, f2) {
    var h = H(); var corpo = el('div'); alvo.appendChild(corpo);
    function pinta() {
      corpo.replaceChildren(el('p', 'jor-nota', 'Carregando a agenda…'));
      h.api('/gerador/jornada-solar/agenda-equipes' + (SEMANA.de ? '?de=' + encodeURIComponent(SEMANA.de) : ''), 'GET').then(function (r) {
        if (!(r.status === 200 && r.json && Array.isArray(r.json.dias))) { corpo.replaceChildren(el('p', 'jor-erro', 'Não consegui ler a agenda agora.'), btn('Tentar de novo', '', pinta)); return; }
        var j = r.json; var tb = el('table', 'jor-ob-grade jor-ob-agenda'); var th = el('tr'); th.appendChild(el('th', '', 'Equipe'));
        j.dias.forEach(function (dd) { th.appendChild(el('th', '', h.ddmm(dd))); }); tb.appendChild(add(el('thead'), th));
        var body = el('tbody');
        (j.linhas || []).forEach(function (ln) {
          var tr = el('tr'); tr.appendChild(el('td', '', ln.rotulo || ln.equipe));
          j.dias.forEach(function (dd) {
            var os = (ln.dias && ln.dias[dd]) || []; var conf = (j.conflitos || []).some(function (x) { return x.equipe === ln.equipe && x.data === dd; });
            var td = el('td', conf ? 'conflito' : (os.length ? 'ocupado' : ''), os.length ? os.map(function (o) { return (o.codigo || '*') + ' ' + o.cliente; }).join(', ') : 'livre'); tr.appendChild(td);
          });
          body.appendChild(tr);
        });
        tb.appendChild(body); var w = el('div', 'dc-wrap'); w.appendChild(tb);
        var bs = el('div', 'jor-din-acoes');
        bs.appendChild(btn('Semana anterior', '', function () { SEMANA.de = somaDias(j.de, -7); pinta(); }));
        bs.appendChild(btn('Próxima semana', '', function () { SEMANA.de = somaDias(j.de, 7); pinta(); }));
        corpo.replaceChildren(w, (j.conflitos || []).length ? el('p', 'jor-erro', 'Conflito de agenda: ' + j.conflitos.map(function (x) { return x.equipe + ' em ' + h.ddmm(x.data); }).join(', ') + '.') : el('p', 'jor-ok', 'Sem conflito de agenda.'), bs);
      });
    }
    pinta();
  }
  function somaDias(ymd, n) { var d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function fotoMini(id, rot, on, aoClicar) {
    var b = el('button', 'jor-ob-foto' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-label', rot); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    var u = urlDe(id); if (u) { var im = el('img'); im.alt = ''; im.src = u; im.loading = 'lazy'; b.appendChild(im); }
    b.appendChild(el('span', '', rot)); if (aoClicar) b.addEventListener('click', aoClicar); return b;
  }
  function etapa6(esq, d, et, f2) {
    injetarCss(); var h = H(); var pode = podeSecao(f2, 'obra'); var l = livro();
    var ob = clone(dados(f2).obra) || {}; ob.plano = ob.plano || []; ob.diario = ob.diario || []; ob.checklist = ob.checklist || {}; ob.equipe = ob.equipe || { combinado_centavos: null, descricao: '' };
    var equipes = (f2.equipes && f2.equipes.length) ? f2.equipes : [{ id: 'pablo', rotulo: 'Equipe Pablo (montagem)' }];
    var podePlano = pode || (f2.pode && f2.pode.secoes && f2.pode.secoes.indexOf('obra') >= 0);
    function gravaObra(aviso) { return botaoSalvar('Salvar', 'obra', function () { return ob; }, aviso || 'Obra salva.'); }
    // 1. Agenda
    var b1 = bloco('Agenda das equipes'); agendaEquipes(b1, f2); esq.appendChild(b1);
    // 2. Plano
    var b2 = bloco('Plano por dia'); var lista = el('div'); b2.appendChild(lista);
    function pintaPlano() {
      lista.replaceChildren();
      ob.plano.forEach(function (p, i) {
        var g = el('div', 'jor-ob-par'); g.appendChild(el('b', '', 'Dia ' + (i + 1)));
        var dt = entrada('date', p.data, 'Data do dia ' + (i + 1)); var ini = entrada('time', p.inicio, 'Início'); var fim = entrada('time', p.fim, 'Fim');
        var eq = selecao(equipes.map(function (e) { return [e.id, e.rotulo]; }), p.equipe || equipes[0].id, 'Equipe'); var aj = entrada('number', p.ajudantes === undefined ? 0 : p.ajudantes, 'Ajudantes'); aj.min = 0; aj.max = 9;
        var sv = entrada('text', p.servico, 'Serviço do dia'); sv.maxLength = 200;
        [dt, ini, fim, eq, aj, sv].forEach(function (x) { x.disabled = !podePlano; });
        dt.addEventListener('input', function () { p.data = dt.value; }); ini.addEventListener('input', function () { p.inicio = ini.value; }); fim.addEventListener('input', function () { p.fim = fim.value; });
        eq.addEventListener('change', function () { p.equipe = eq.value; }); aj.addEventListener('input', function () { p.ajudantes = Math.max(0, Math.min(9, Number(aj.value) || 0)); }); sv.addEventListener('input', function () { p.servico = sv.value; });
        add(g, campo('Data', dt), campo('Início', ini), campo('Fim', fim), campo('Equipe', eq), campo('Ajudantes', aj), campo('Serviço', sv));
        lista.appendChild(g);
      });
      if (!ob.plano.length) lista.appendChild(el('p', 'jor-nota', 'Nenhum dia marcado. Sem os dias, a Compra e o material não têm prazo.'));
    }
    pintaPlano();
    if (podePlano) {
      var a2 = el('div', 'jor-din-acoes');
      a2.appendChild(btn('Mais um dia', '', function () { if (ob.plano.length < 10) { ob.plano.push({ data: '', inicio: '07:30', fim: '17:30', equipe: equipes[0].id, ajudantes: 1, servico: '' }); pintaPlano(); } }));
      a2.appendChild(gravaObra('Plano salvo.')); b2.appendChild(a2);
    }
    esq.appendChild(b2);
    // 4. Álbum
    var album = arqs(f2, 'obra_foto'); var b4 = bloco('Fotos da obra inteira');
    var porDia = {}; album.forEach(function (a) { var dia = String(a.em || '').slice(0, 10); var k = ob.plano.map(function (p) { return p.data; }).indexOf(dia); var rot = k >= 0 ? 'dia ' + (k + 1) : 'sem dia'; porDia[rot] = (porDia[rot] || 0) + 1; });
    b4.appendChild(el('p', '', h.plural(album.length, 'foto', 'fotos') + (album.length ? ' (' + Object.keys(porDia).map(function (k) { return k + ': ' + porDia[k]; }).join('; ') + ')' : '')));
    var alb = el('div', 'jor-ob-album'); album.forEach(function (a) { var dd = a.em ? h.ddmm(String(a.em).slice(0, 10)) + ' ' + String(a.em).slice(11, 16) : 'foto'; alb.appendChild(fotoMini(a.id, dd, false, null)); }); b4.appendChild(alb);
    var ax = el('div', 'jor-anexo'); ax.appendChild(el('span', 'jor-rot', 'Adicionar ao álbum'));
    ax.appendChild(D().botoesAnexo('álbum da obra', function (arquivos) {
      var st = vdcAgora();
      if (!st || String(st.id) !== String(O().card) || st.carregando || typeof window.vdcAnexar !== 'function') { h.toast('Abra o quadro Documentos e cadastro, logo abaixo, e tente de novo.'); return; }
      Promise.resolve(window.vdcAnexar(st, { chave: 'obra_foto' }, arquivos)).then(function () { h.recarregar(); });
    }, true));
    b4.appendChild(ax); esq.appendChild(b4);
    // 5. Diário
    var b5 = bloco('Diário de obra');
    if (!ob.plano.length) b5.appendChild(el('p', 'jor-nota', 'Marque os dias da obra no plano para abrir o diário.'));
    ob.plano.forEach(function (p, i) {
      var dr = ob.diario.filter(function (x) { return x.data === p.data; })[0];
      if (!dr) { dr = { data: p.data, chegada: '', saida: '', fotos: [], ocorrencia: '' }; ob.diario.push(dr); }
      dr.fotos = dr.fotos || [];
      var cx = el('div', 'jor-ob-carga'); cx.appendChild(el('b', '', 'Dia ' + (i + 1) + (p.data ? ' · ' + h.ddmm(p.data) : '')));
      var ch = entrada('time', dr.chegada, 'Chegada no dia ' + (i + 1)); var sd = entrada('time', dr.saida, 'Saída no dia ' + (i + 1)); ch.disabled = sd.disabled = !podePlano;
      ch.addEventListener('input', function () { dr.chegada = ch.value; }); sd.addEventListener('input', function () { dr.saida = sd.value; });
      var g = el('div', 'jor-ob-par'); add(g, campo('Chegada', ch), campo('Saída', sd)); cx.appendChild(g);
      cx.appendChild(el('p', 'jor-nota', 'Fotos do álbum'));
      var al = el('div', 'jor-ob-album');
      album.forEach(function (a) {
        var on = dr.fotos.indexOf(a.id) >= 0;
        var m = fotoMini(a.id, a.em ? String(a.em).slice(11, 16) : 'foto', on, podePlano ? function () { var k = dr.fotos.indexOf(a.id); if (k >= 0) dr.fotos.splice(k, 1); else dr.fotos.push(a.id); m.classList.toggle('on'); m.setAttribute('aria-pressed', k < 0 ? 'true' : 'false'); } : null);
        al.appendChild(m);
      });
      if (!album.length) al.appendChild(el('span', 'jor-nota', 'O álbum está vazio.')); cx.appendChild(al);
      var oc = el('textarea', 'jor-ta'); oc.maxLength = 400; oc.value = dr.ocorrencia || ''; oc.setAttribute('aria-label', 'Ocorrência do dia ' + (i + 1)); oc.disabled = !podePlano; oc.addEventListener('input', function () { dr.ocorrencia = oc.value; });
      cx.appendChild(campo('Ocorrência', oc)); b5.appendChild(cx);
    });
    if (podePlano && ob.plano.length) b5.appendChild(gravaObra('Diário salvo.'));
    esq.appendChild(b5);
    // 6. Checklist
    var b6 = bloco('Checklist técnico'); var feitos = 0;
    CHECK.forEach(function (c) {
      var m = marca(c[1], !!ob.checklist[c[0]], c[1]); m.input.disabled = !podePlano; if (ob.checklist[c[0]]) feitos++;
      m.input.addEventListener('change', function () { ob.checklist[c[0]] = m.input.checked; }); b6.appendChild(m);
    });
    b6.appendChild(el('p', 'jor-nota', feitos + ' de ' + CHECK.length + ' itens feitos.'));
    if (podePlano) b6.appendChild(gravaObra('Checklist salvo.'));
    esq.appendChild(b6);
    // 7. Pagamento da equipe
    var b7 = bloco('Pagamento da equipe');
    var comb = entrada('text', Number(ob.equipe.combinado_centavos) > 0 ? txtCents(ob.equipe.combinado_centavos) : '', 'Valor combinado com a equipe'); comb.inputMode = 'decimal'; comb.disabled = !podePlano;
    var cdesc = entrada('text', ob.equipe.descricao || '', 'O que foi combinado'); cdesc.placeholder = 'Ex.: 15 placas a R$ 110,00'; cdesc.disabled = !podePlano;
    comb.addEventListener('input', function () { var v = h.cents(comb.value); ob.equipe.combinado_centavos = (typeof v === 'number' && v > 0) ? v : null; }); cdesc.addEventListener('input', function () { ob.equipe.descricao = cdesc.value; });
    var g7 = el('div', 'jor-ob-par'); add(g7, veDinheiro() ? campo('Combinado (R$)', comb) : null, campo('O que foi combinado', cdesc)); b7.appendChild(g7);
    if (l) {
      (l.linhas || []).filter(function (x) { return Number(x.etapa) === 6 && x.categoria === 'mao_de_obra' && x.grupo === 'custo' && !x.estorno_de; }).forEach(function (x) {
        b7.appendChild(el('p', x.estornada ? 'jor-nota' : '', (x.descricao || 'Pagamento') + ' · ' + h.ddmm(x.data) + ' · ' + h.rs(x.valor_centavos) + (x.estornada ? ' (estornado)' : '')));
      });
      var falta = (l.a_pagar || []).filter(function (p) { return p.tipo === 'equipe'; })[0];
      if (falta) b7.appendChild(el('p', 'jor-erro', 'Falta pagar ' + (falta.valor_centavos ? h.rs(falta.valor_centavos) : falta.texto) + '.'));
    }
    var a7 = el('div', 'jor-din-acoes');
    if (podePlano) a7.appendChild(gravaObra('Combinado salvo.'));
    if (podePlano && D() && h.O().dinheiro && h.O().dinheiro.pode && h.O().dinheiro.pode.lancar_saida) {
      a7.appendChild(btn('Lançar pagamento', 'jor-btn-pri', function () { D().lancar({ tipo: 'saida', etapa: 6, categoria: 'mao_de_obra' }); }));
      a7.appendChild(btn('Material extra', '', function () { materialExtraDialogo(f2); }));
    }
    b7.appendChild(a7); esq.appendChild(b7);
  }
  /** Material comprado na obra: vira item da Compra com etapa 6 (compra própria) e o gasto sai como material extra. */
  function materialExtraDialogo(f2) {
    var h = H(); var c = compraDe(f2); var ctl = {};
    h.dialogo('Material extra', function (box) {
      box.appendChild(el('p', 'jor-nota', 'Material comprado em outra etapa entra do mesmo jeito: item por item, com origem, valor e data.'));
      ctl.desc = entrada('text', '', 'O que foi comprado'); ctl.forn = entrada('text', '', 'Fornecedor'); ctl.qtd = entrada('text', '1', 'Quantidade');
      var g = el('div', 'jor-ob-par'); add(g, campo('O que foi comprado', ctl.desc), campo('Fornecedor', ctl.forn), campo('Quantidade', ctl.qtd)); box.appendChild(g);
      ctl.info = el('p', 'jor-erro'); ctl.info.setAttribute('role', 'status'); box.appendChild(ctl.info); return { foco: ctl.desc };
    }, 'Continuar', function (b) {
      if (!ctl.desc.value.trim() || !ctl.forn.value.trim()) { ctl.info.textContent = 'Diga o que foi comprado e onde.'; return; }
      b.disabled = true;
      var itens = itensBase(c); var compras = clone(c.compras);
      compras.push({ id: null, fornecedor: ctl.forn.value.trim(), cidade: '', data: hoje(), forma: 'pix', nota_chega: 'anexada', nota: null });
      salvar('compra', { itens: itens, compras: compras }, 'Compra criada.').then(function (r) {
        if (r.status !== 200) { b.disabled = false; ctl.info.textContent = msgSrv(r, 'Não consegui salvar agora.'); return; }
        var c2 = compraDe(O().fase2); var nova = c2.compras[c2.compras.length - 1];
        var it = { id: null, origem: 'manual', tipo: 'outro', descricao: ctl.desc.value.trim(), quantidade: Number(ctl.qtd.value.replace(',', '.')) || 1, unidade: 'un', marca: '', modelo: '', fornecedor: nova.fornecedor, valor_centavos: null, data: hoje(), etapa: 6, compra_id: nova.id };
        return salvar('compra', { itens: itensBase(c2).concat([it]), compras: clone(c2.compras) }, 'Item salvo.').then(function (r2) {
          if (r2.status !== 200) { b.disabled = false; ctl.info.textContent = msgSrv(r2, 'Não consegui salvar o item.'); return; }
          h.fecharDlg(); D().lancar({ tipo: 'saida', etapa: 6, categoria: 'material_extra', compra_id: nova.id, contraparte: nova.fornecedor, descricao: it.descricao });
        });
      });
    });
  }

  // ── Etapa 7 · Entrega da obra ──────────────────────────────────────────────
  function etapa7(esq, d, et, f2) {
    injetarCss(); var h = H(); var pode = podeSecao(f2, 'entrega'); var en = clone(dados(f2).entrega) || {};
    en.testes = en.testes || {}; en.monitoramento = en.monitoramento || {}; en.garantias = en.garantias || {}; en.termo = en.termo || null;
    var c = compraDe(f2); var mon0 = (dados(f2).entrega || {}).monitoramento || {};
    function grava(aviso) { return botaoSalvar('Salvar', 'entrega', function () { return { testes: en.testes, monitoramento: en.monitoramento, garantias: en.garantias, termo: en.termo, responsavel: en.responsavel || '' }; }, aviso); }
    // 1. Fotos
    var tem = FOTOS_ENTREGA.filter(function (x) { return arqs(f2, x[0]).length > 0; }).length;
    var b1 = bloco('Fotos de tudo pronto', tag(tem + ' de 8'));
    FOTOS_ENTREGA.forEach(function (x) { b1.appendChild(h.anexo(x[0], x[1], arqs(f2, x[0]).length > 0)); });
    esq.appendChild(b1);
    // 2. Testes
    var T = en.testes; var b2 = bloco('Está tudo certo');
    var s1 = entrada('text', T.string1_voc || '', 'String 1, Voc em volts'); var s2 = entrada('text', T.string2_voc || '', 'String 2, Voc em volts'); var gk = entrada('text', T.gerando_kw || '', 'Inversor gerando, em kW'); var gh = entrada('time', T.gerando_hora || '', 'Hora da leitura');
    [[s1, 'string1_voc'], [s2, 'string2_voc'], [gk, 'gerando_kw'], [gh, 'gerando_hora']].forEach(function (p) { p[0].disabled = !pode; p[0].addEventListener('input', function () { T[p[1]] = p[0].value; atualizaContagem(); }); });
    var g2 = el('div', 'jor-ob-par'); add(g2, campo('String 1, Voc (V)', s1), campo('String 2, Voc (V)', s2), campo('Inversor gerando (kW)', gk), campo('Hora da leitura', gh)); b2.appendChild(g2);
    var cks = [['isolamento_ok', 'Isolamento ok'], ['wifi_ok', 'Wi-Fi do inversor conectado'], ['disjuntores_ok', 'Disjuntores identificados']];
    cks.forEach(function (x) { var m = marca(x[1], !!T[x[0]], x[1]); m.input.disabled = !pode; m.input.addEventListener('change', function () { T[x[0]] = m.input.checked; atualizaContagem(); }); b2.appendChild(m); });
    var cont = tag(''); b2.firstChild.appendChild(cont);
    function atualizaContagem() { var n = (T.string1_voc ? 1 : 0) + (T.string2_voc ? 1 : 0) + (T.isolamento_ok ? 1 : 0) + (T.gerando_kw ? 1 : 0) + (T.wifi_ok ? 1 : 0) + (T.disjuntores_ok ? 1 : 0); cont.textContent = 'Testes · ' + n + ' de 6'; cont.className = 'jor-ob-tag' + (n === 6 ? ' ok' : ''); }
    atualizaContagem(); if (pode) b2.appendChild(grava('Testes salvos.')); esq.appendChild(b2);
    // 3. Monitoramento
    var M = en.monitoramento; delete M.conta_mascarada; var b3 = bloco('Monitoramento'); var cofre = (dados(f2).entrega || {}).cofre || null;
    var app = entrada('text', M.app || '', 'Aplicativo do fabricante'); var us = entrada('text', M.usina || '', 'Usina no aplicativo'); var se = entrada('text', M.serie || '', 'Número de série do inversor'); var cm = entrada('date', M.comissionamento || '', 'Data do comissionamento');
    var conta = entrada('text', M.conta || '', 'Conta do cliente no aplicativo'); if (mon0.conta_mascarada) { conta.value = ''; conta.placeholder = mon0.conta_mascarada; }
    [app, us, se, cm, conta].forEach(function (x) { x.disabled = !pode; });
    app.addEventListener('input', function () { M.app = app.value; }); us.addEventListener('input', function () { M.usina = us.value; }); se.addEventListener('input', function () { M.serie = se.value; }); cm.addEventListener('input', function () { M.comissionamento = cm.value; });
    // A conta que o servidor devolve vem mascarada: sem digitar outra, volta como veio e o servidor mantém a gravada. A conta_mascarada nunca volta.
    var contaOrig = M.conta || '';
    conta.addEventListener('input', function () { M.conta = conta.value.trim() || contaOrig; });
    var g3 = el('div', 'jor-ob-par'); add(g3, campo('Aplicativo', app), campo('Conta do cliente', conta), campo('Usina no aplicativo', us), campo('Número de série do inversor', se), campo('Comissionamento', cm)); b3.appendChild(g3);
    if (mon0.conta_mascarada) b3.appendChild(el('p', 'jor-nota', 'Conta salva: ' + mon0.conta_mascarada + '. Digite outra para trocar.'));
    var on = marca('Online e gerando', !!M.online, 'Online e gerando'); on.input.disabled = !pode; on.input.addEventListener('change', function () { M.online = on.input.checked; }); b3.appendChild(on);
    // cofre
    var cf = el('div', 'jor-ob-linha'); cf.appendChild(el('b', '', 'Senha do aplicativo'));
    if (cofre && cofre.gravado) {
      cf.appendChild(el('span', 'jor-ob-senha', '••••••')); var tg = tag('Só sócio revela'); cf.appendChild(tg); cf.appendChild(el('span', 'jor-ob-sub', 'Guardada no cofre' + (cofre.por ? ' por ' + h.nomeBonito(cofre.por) : '') + (cofre.em ? ' em ' + h.ddmm(String(cofre.em).slice(0, 10)) : '') + '.'));
      if (f2.pode && f2.pode.cofre_revelar) { var br = btn('Revelar', '', function () { revelar(cf, br); }); cf.appendChild(br); }
    } else cf.appendChild(el('span', 'jor-ob-sub', 'Ainda não guardada.'));
    b3.appendChild(cf);
    if (pode && f2.pode && f2.pode.cofre_gravar) {
      var sn = entrada('password', '', 'Senha do aplicativo'); sn.autocomplete = 'new-password'; sn.maxLength = 120;
      var gs = btn(cofre && cofre.gravado ? 'Trocar a senha no cofre' : 'Guardar no cofre', '', function () {
        if (!sn.value) { h.toast('Digite a senha.'); return; }
        gs.disabled = true;
        h.api(base() + '/cofre', 'PUT', { senha: sn.value }, 30000).then(function (r) {
          gs.disabled = false;
          if (r.status === 200 && r.json.ok !== false) { sn.value = ''; h.toast('Senha guardada no cofre.'); h.recarregar(); } else h.toast(msgSrv(r, 'Não consegui guardar a senha.'));
        });
      });
      var lc = el('div', 'jor-ob-par'); add(lc, campo('Senha (some depois de guardada)', sn)); b3.appendChild(lc); b3.appendChild(gs);
    }
    if (pode) { var gm = grava('Monitoramento salvo.'); gm.style.marginLeft = '8px'; b3.appendChild(gm); }
    esq.appendChild(b3);
    // 4. Garantias
    var G = en.garantias; var b4 = bloco('Garantias e cadastros');
    var gd = entrada('date', G.registrada_em || '', 'Garantia registrada no fabricante em'); gd.disabled = !pode; gd.addEventListener('input', function () { G.registrada_em = gd.value; });
    var gt = marca('Cliente treinado no app', !!G.treinado, 'Cliente treinado no app'); gt.input.disabled = !pode; gt.input.addEventListener('change', function () { G.treinado = gt.input.checked; });
    b4.appendChild(campo('Garantia registrada no fabricante em', gd)); b4.appendChild(gt); if (pode) b4.appendChild(grava('Garantias salvas.')); esq.appendChild(b4);
    // 5. Termo de garantia
    termoDeGarantia(esq, f2, c);
    // 6. Termo de entrega
    termoDeEntrega(esq, d, f2, en, pode, c, grava);
    // 7. Book
    bookBloco(esq, d, f2);
  }
  function revelar(linha, botao) {
    var h = H(); if (botao) botao.disabled = true;
    h.api(base() + '/cofre/revelar', 'POST', {}, 30000).then(function (r) {
      if (!(r.status === 200 && r.json && r.json.ok !== false && typeof r.json.senha === 'string')) { if (botao) botao.disabled = false; h.toast(msgSrv(r, 'Não consegui revelar a senha.')); return; }
      var caixa = el('span', 'jor-ob-linha');
      caixa.appendChild(el('span', 'jor-ob-senha', r.json.senha));
      if (r.json.conta) caixa.appendChild(el('span', 'jor-ob-sub', 'Conta: ' + r.json.conta));
      caixa.appendChild(el('span', 'jor-ob-sub', 'Some em 30 segundos.'));
      linha.appendChild(caixa);
      setTimeout(function () { if (caixa.parentNode) caixa.remove(); if (botao) botao.disabled = false; }, 30000);
    });
  }
  function termoDeGarantia(esq, f2, c) {
    var b = bloco('Termo de garantia', automatico()); var h = H();
    var cg = dados(f2).contrato_garantias || {};
    var mod = c.itens.filter(function (x) { return x.tipo === 'modulo'; })[0] || {}; var inv = c.itens.filter(function (x) { return x.tipo === 'inversor'; })[0] || {};
    var tb = el('table', 'jor-ob-grade'); var th = el('tr'); ['Campo', 'Valor', 'Vem de'].forEach(function (t) { th.appendChild(el('th', '', t)); }); tb.appendChild(add(el('thead'), th));
    var body = el('tbody');
    [['Placas', [mod.quantidade ? mod.quantidade + ' ' : '', mod.marca || '', mod.modelo || ''].join(' ').trim() || 'Falta na Compra', 'Compra'],
      ['Garantia de fabricação das placas', mod.garantia_fabricacao_anos ? mod.garantia_fabricacao_anos + ' anos' : 'Falta na Compra', 'Compra'],
      ['Garantia de desempenho das placas', mod.garantia_desempenho_anos ? mod.garantia_desempenho_anos + ' anos' : 'Falta na Compra', 'Compra'],
      ['Inversor', [inv.marca || '', inv.modelo || ''].join(' ').trim() || 'Falta na Compra', 'Compra'],
      ['Garantia do inversor', inv.garantia_anos ? inv.garantia_anos + ' anos' : 'Falta na Compra', 'Compra'],
      ['Garantia da instalação', cg.instalacao || 'Falta no contrato', 'Contrato da etapa 2'],
      ['Garantia de desempenho no contrato', cg.modulos ? cg.modulos + ' anos' : 'Falta no contrato', 'Contrato da etapa 2'],
      ['Garantia do inversor no contrato', cg.inversor ? cg.inversor + ' anos' : 'Falta no contrato', 'Contrato da etapa 2']].forEach(function (r) {
      var tr = el('tr'); r.forEach(function (t, i) { var td = el('td', '', t); td.setAttribute('data-r', ['Campo', 'Valor', 'Vem de'][i]); tr.appendChild(td); }); body.appendChild(tr);
    });
    tb.appendChild(body); var w = el('div', 'dc-wrap'); w.appendChild(tb); b.appendChild(w);
    b.appendChild(el('div', 'jor-ob-grupo', 'Trava do Termo'));
    var trava = (f2.book && f2.book.trava) || []; var usadas = {};
    var ul = el('ul', 'jor-itens jor-ob-trava');
    TRAVA_ROTULOS.forEach(function (rot) {
      var achou = trava.filter(function (t, k) { if (usadas[k]) return false; var casa = rot[1].test(t); if (casa) usadas[k] = 1; return casa; });
      var li = el('li', achou.length ? 'er' : 'ok'); li.appendChild(achou.length ? h.icone('lock') : h.icone('ok')); li.appendChild(el('span', '', achou.length ? rot[0] + ': ' + achou.join(' ') : rot[0])); ul.appendChild(li);
    });
    trava.forEach(function (t, k) { if (usadas[k]) return; var li = el('li', 'er'); li.appendChild(h.icone('lock')); li.appendChild(el('span', '', t)); ul.appendChild(li); });
    b.appendChild(ul); esq.appendChild(b);
  }
  function termoDeEntrega(esq, d, f2, en, pode, c, grava) {
    var h = H(); var b = bloco('Termo de entrega'); var termo = en.termo || {};
    var chk = (termo.chk && termo.chk.length === 6) ? termo.chk.slice() : ['sim', 'sim', 'sim', 'sim', 'sim', 'sim'];
    var tx = (typeof FS_TERMO_ITENS !== 'undefined' && FS_TERMO_ITENS.length === 6) ? FS_TERMO_ITENS : TERMO_ITENS;
    var rs = el('textarea', 'jor-ta'); rs.maxLength = 500; rs.value = termo.ressalva || ''; rs.setAttribute('aria-label', 'Ressalva'); rs.disabled = !pode;
    var info = el('p', 'jor-erro'); info.setAttribute('role', 'status');
    tx.forEach(function (t, i) {
      var lin = el('div', 'jor-ob-linha'); lin.appendChild(el('span', '', (i + 1) + '. ' + t));
      var s = selecao([['sim', 'Sim'], ['na', 'Não se aplica'], ['pend', 'Pendente']], chk[i], 'Situação do item ' + (i + 1)); s.disabled = !pode;
      s.addEventListener('change', function () { chk[i] = s.value; }); lin.appendChild(s); b.appendChild(lin);
    });
    b.appendChild(campo('Ressalva (obrigatória se houver item pendente)', rs));
    var nome = entrada('text', termo.nome || '', 'Nome de quem assina'); nome.disabled = !pode; b.appendChild(campo('Nome de quem assina', nome));
    function dadosTermo() { return { assinado_em: new Date().toISOString(), nome: nome.value.trim(), arquivo_id: '', chk: chk, ressalva: rs.value.trim() }; }
    function valida() {
      if (!nome.value.trim()) { info.textContent = 'Diga o nome de quem assina.'; return false; }
      if (chk.indexOf('pend') >= 0 && !rs.value.trim()) { info.textContent = 'Há item pendente: descreva a ressalva.'; return false; }
      info.textContent = ''; return true;
    }
    if (pode) b.appendChild(assinaturaBloco(f2, 'ent_termo_assinado', termo.arquivo_id, function (id) {
      var t = dadosTermo(); t.arquivo_id = id; en.termo = t;
      return salvar('entrega', { testes: en.testes, monitoramento: en.monitoramento, garantias: en.garantias, termo: t, responsavel: en.responsavel || '' }, 'Termo assinado.');
    }, valida));
    if (termo.assinado_em) b.appendChild(el('p', 'jor-ok', 'Assinado por ' + (termo.nome || 'o cliente') + ' em ' + h.ddmm(String(termo.assinado_em).slice(0, 10)) + '.'));
    var ac = el('div', 'jor-din-acoes');
    ac.appendChild(btn('Gerar o termo de entrega', '', function () { if (!valida()) return; gerarTermoEntrega(d, f2, c, chk, rs.value.trim(), en); }));
    b.appendChild(ac); b.appendChild(info); esq.appendChild(b);
  }
  function bookBloco(esq, d, f2) {
    var h = H(); var b = bloco('Book da obra', automatico()); var bk = f2.book || { pode: false, trava: [] };
    b.appendChild(el('p', 'jor-nota', 'Monta com as fotos, os testes e o Termo de garantia.'));
    var bt = btn('Baixar o Book', 'jor-btn-pri', function () { if (window.Jornada.extras.bookPdf) window.Jornada.extras.bookPdf(d.card.id || O().card, bt); }); bt.disabled = !bk.pode; b.appendChild(bt);
    if (!bk.pode && bk.trava && bk.trava.length) { var ul = el('ul', 'jor-din-ul'); bk.trava.forEach(function (t) { ul.appendChild(el('li', '', t)); }); b.appendChild(ul); }
    b.appendChild(el('p', 'jor-nota', 'Vai para o cliente em PDF quando a obra for finalizada, com a mensagem de obrigado.'));
    esq.appendChild(b); void h;
  }
  // ── Etapa 8 · Pedido de vistoria e liberação ───────────────────────────────
  function etapa8(esq, d, et, f2) {
    injetarCss(); var h = H(); var pode = podeSecao(f2, 'liberacao'); var lb = clone(dados(f2).liberacao) || {}; lb.passos = lb.passos || {}; lb.exigencias = lb.exigencias || [];
    var P = lb.passos; var ped = P.pedido || { data: '', numero: '', arquivo_id: '' };
    var jaPediu = !!(et.prazo && et.prazo.rotulo === 'Prazo da Cemig');
    function corpoLib(num) { var c = { passos: P, exigencias: lb.exigencias }; if (num) c.pedido_numero = num; return c; }
    function grava(aviso, num) { return salvar('liberacao', corpoLib(num), aviso); }
    // 1. Pedido
    var b1 = bloco('Pedido à Cemig');
    var dt = entrada('date', ped.data || '', 'Data do pedido'); var pr = entrada('text', '', 'Protocolo'); dt.disabled = pr.disabled = !pode;
    var g = el('div', 'jor-ob-par'); add(g, campo('Data do pedido', dt), campo('Protocolo', pr)); b1.appendChild(g);
    var sp = botaoSalvar('Salvar o pedido', 'liberacao', function () { P.pedido = { data: dt.value, numero: pr.value.trim() || ped.numero || '', arquivo_id: ped.arquivo_id || '' }; return corpoLib(pr.value.trim()); }, 'Pedido salvo.'); sp.disabled = !pode; b1.appendChild(sp);
    if (jaPediu) b1.appendChild(el('p', 'jor-nota', 'O protocolo já foi enviado. Digite outro só se mudou.'));
    if (pode) b1.appendChild(anexoLigado(f2, 'lib_pedido', 'Print do pedido de vistoria', ped.arquivo_id, function (id) { P.pedido = { data: dt.value || ped.data || '', numero: pr.value.trim() || ped.numero || '', arquivo_id: id }; return grava('Print guardado.', pr.value.trim()); }));
    var pz = et.prazo;
    if (pz && pz.vence && pz.rotulo) b1.appendChild(el('p', 'jor-nota', 'Cemig: 7 dias úteis para vistoriar, vence ' + h.ddmm(pz.vence) + '.'));
    esq.appendChild(b1);
    // 2. Andamento
    var PASSOS = [['pedido', 'Pedido', 'lib_pedido'], ['vistoria', 'Vistoria aprovada', 'lib_vistoria'], ['medidor', 'Medidor trocado', 'lib_medidor'], ['liberada', 'Liberada', 'lib_liberacao']];
    var feitos = PASSOS.filter(function (x) { var p = P[x[0]]; return p && p.data && existe(f2, p.arquivo_id); }).length;
    var b2 = bloco('Andamento', tag(feitos + ' de 4 passos'));
    PASSOS.forEach(function (x) {
      if (x[0] === 'pedido') { b2.appendChild(el('p', '', 'Pedido · ' + (ped.data ? h.ddmm(ped.data) : 'sem data') + (ped.numero ? ' · protocolo ' + ped.numero : ''))); return; }
      var p = P[x[0]] || { data: '', arquivo_id: '' };
      var lin = el('div', 'jor-ob-linha'); lin.appendChild(el('b', '', x[1]));
      var di = entrada('date', p.data || '', 'Data: ' + x[1]); di.disabled = !pode; di.addEventListener('input', function () { p = { data: di.value, arquivo_id: p.arquivo_id || '' }; P[x[0]] = p; });
      lin.appendChild(di);
      var sv = btn('Salvar a data', 'jor-btn-pri', function () { sv.disabled = true; P[x[0]] = { data: di.value, arquivo_id: p.arquivo_id || '' }; grava('Data salva.').then(function () { sv.disabled = false; }); }); sv.disabled = !pode; lin.appendChild(sv);
      b2.appendChild(lin);
      if (pode) b2.appendChild(anexoLigado(f2, x[2], 'Print: ' + x[1], p.arquivo_id, function (id) { P[x[0]] = { data: di.value || p.data || '', arquivo_id: id }; return grava('Print guardado.', pr.value.trim()); }));
    });
    var rep = btn('Vistoria reprovada', '', function () { exigenciaDialogo(f2, lb, P); }); rep.disabled = !pode; b2.appendChild(rep);
    lb.exigencias.forEach(function (x) { b2.appendChild(el('p', 'jor-nota', 'Exigência de ' + h.ddmm(String(x.em || '').slice(0, 10)) + ': ' + x.texto)); });
    esq.appendChild(b2);
    // 3. Fechamento
    if (D() && D().fechamento) D().fechamento(esq, O().dinheiro);
    var b3 = bloco('Conta da obra');
    b3.appendChild(el('p', 'jor-nota', 'Fechada, a conta trava. Só o Thiago reabre, com motivo.'));
    if (f2.fechada) {
      b3.appendChild(el('p', 'jor-ok', 'Conta fechada em ' + h.ddmm(String(f2.fechada.em).slice(0, 10)) + ' por ' + h.nomeBonito(f2.fechada.por) + '.'));
      if (f2.pode && f2.pode.reabrir) b3.appendChild(btn('Reabrir a conta', '', function () {
        h.dialogoMotivo('Reabrir a conta', 'Reabrir', function (motivo) {
          return h.api(base() + '/dinheiro/reabrir', 'POST', { motivo: motivo }, 30000).then(function (r) {
            if (r.status === 200 && r.json.ok !== false) { h.toast('Conta reaberta.'); h.recarregar(); return { ok: true }; }
            return { ok: false, erro: msgSrv(r, 'Não consegui reabrir agora.') };
          });
        });
      }));
    } else if (et.concluida_em && f2.pode && f2.pode.fechar) {
      b3.appendChild(btn('Fechar a conta de novo', '', function () {
        h.api(base() + '/dinheiro/fechar', 'POST', {}, 30000).then(function (r) {
          if (r.status === 200 && r.json.ok !== false) { h.toast('Conta fechada.'); h.recarregar(); } else h.toast(msgSrv(r, 'Ainda não dá para fechar.'));
        });
      }));
    }
    esq.appendChild(b3);
    // 4. Mensagem
    var b4 = bloco('Mensagem ao cliente ao finalizar'); if (window.Jornada.extras.mensagemLiberacao) window.Jornada.extras.mensagemLiberacao(b4, O().fase3); esq.appendChild(b4);
  }
  function exigenciaDialogo(f2, lb, P) {
    var h = H(); var ta = null;
    h.dialogo('O que a Cemig exigiu', function (box) {
      ta = el('textarea', 'jor-ta'); ta.maxLength = 400; ta.setAttribute('aria-label', 'O que a Cemig exigiu'); box.appendChild(ta);
      box.appendChild(h.anexo('lib_exigencia', 'Documento da exigência', arqs(f2, 'lib_exigencia').length > 0));
      box.appendChild(el('p', 'jor-nota', 'Registra a exigência e pede a vistoria de novo, sem sair da etapa.')); return { foco: ta };
    }, 'Registrar e pedir de novo', function (b) {
      if (ta.value.trim().length < 3) { h.toast('Diga o que a Cemig exigiu.'); return; }
      b.disabled = true; var P2 = clone(P); P2.vistoria = null; P2.medidor = null; P2.liberada = null;
      salvar('liberacao', { passos: P2, exigencias: lb.exigencias.concat([{ texto: ta.value.trim() }]) }, 'Exigência registrada.').then(function (r) { if (r.status === 200) h.fecharDlg(); else b.disabled = false; });
    });
  }

  // ── Os papéis do Fechamento nas etapas ─────────────────────────────────────
  function cadastroPronto() {
    var st = vdcAgora();
    if (st && String(st.id) === String(O().card) && !st.carregando && st.cad) return Promise.resolve(st.cad);
    return H().api('/gerador/clientes/vendasolar/' + encodeURIComponent(O().card) + '/cadastro', 'GET').then(function (r) { return (r.json && r.json.cadastro) || null; });
  }
  function cliDe(cad, d) {
    var v = function (k) { return (typeof vdcV === 'function' && cad) ? vdcV(cad, k) : ''; };
    var doc = v('cpf_cnpj'); var pj = (typeof vdcDigitos === 'function') ? vdcDigitos(doc).length === 14 : false;
    var cid = v('cidade') || String((d.card && d.card.cidade) || '').replace(/\s*[-/]\s*[A-Za-z]{2}$/, '');
    var c = { nome: v('nome') || (d.card && d.card.cliente) || '', tipo: pj ? 'PJ' : 'PF', pj: pj, doc: doc, cep: v('cep'), end: v('endereco'), bairro: v('bairro'), cidade: cid, uf: v('uf').toUpperCase(), tel: v('telefone'), rep: v('rep_nome') };
    c.endFull = (typeof solEnd === 'function') ? solEnd(c.end, c.bairro, c.cidade, c.uf) : '';
    c.qualif = (!pj && typeof solQualifPf === 'function') ? solQualifPf({ nac: v('nacionalidade'), ec: v('estado_civil'), prof: v('profissao'), rg: v('rg_ie'), orgao: v('orgao_emissor') }) : '';
    return c;
  }
  function papelOk() {
    var falta = [typeof epPreview, typeof epPaginar, typeof solEmp, typeof solRodape].filter(function (t) { return t !== 'function'; });
    if (falta.length) { H().toast('O Gerador ainda está carregando. Tente de novo em instantes.'); return false; }
    return true;
  }
  function previa(html, arquivo, titulo, opts) {
    epPreview({ html: html, arquivo: arquivo, titulo: titulo, opts: opts || null, hist: null, ctx: 'jor', emit: 'aioros', aoSair: function () {} });
  }
  function limpaArq(n) { return (typeof solLimpaArq === 'function' ? solLimpaArq(n) : String(n || '').replace(/[^A-Za-z0-9]+/g, '_')) || 'Cliente'; }
  function numTxt(x) { return typeof fsVNum === 'function' ? fsVNum(String(x)) : String(x).replace(/\./g, ','); }

  // Etapa 1 · Relatório de vistoria
  function extraVistoria(esq, d) {
    var f2 = O().fase2; if (!f2) return; injetarCss(); var h = H();
    var pode = podeSecao(f2, 'vistoria'); var v = clone(dados(f2).vistoria) || {};
    ['telhado', 'entrada', 'inversor'].forEach(function (k) { v[k] = v[k] || {}; }); v.adeq = v.adeq || [];
    var box = el('details', 'jor-bloco'); box.appendChild(el('summary', 'jor-vdc-sum', 'Relatório de vistoria'));
    var ins = {};
    function lin(grupo, chave, rot, tipo) {
      var obj = grupo ? v[grupo] : v; var i = entrada(tipo || 'text', obj[chave] || '', rot); i.disabled = !pode; ins[(grupo || '') + '.' + chave] = i;
      i.addEventListener('input', function () { obj[chave] = i.value; }); return campo(rot, i);
    }
    var g0 = el('div', 'jor-ob-par'); add(g0, lin('', 'data', 'Data da vistoria', 'date'), lin('', 'quem', 'Quem vistoriou'), lin('', 'acomp', 'Acompanhou no local')); box.appendChild(g0);
    box.appendChild(el('div', 'jor-ob-grupo', 'Telhado'));
    var g1 = el('div', 'jor-ob-par'); [['tipo', 'Tipo'], ['estado', 'Estado'], ['orient', 'Orientação da água'], ['incl', 'Inclinação (graus)'], ['area', 'Área útil livre (m²)'], ['sombra', 'Sombreamento'], ['estr', 'Estrutura de apoio'], ['acesso', 'Acesso']].forEach(function (x) { g1.appendChild(lin('telhado', x[0], x[1])); }); box.appendChild(g1);
    box.appendChild(el('div', 'jor-ob-grupo', 'Entrada de energia'));
    var g2 = el('div', 'jor-ob-par'); [['padrao', 'Padrão'], ['tensao', 'Tensão'], ['disj', 'Disjuntor geral (A)'], ['apto', 'Padrão apto a receber'], ['aterr', 'Aterramento'], ['quadro', 'Espaço no quadro']].forEach(function (x) { g2.appendChild(lin('entrada', x[0], x[1])); }); box.appendChild(g2);
    box.appendChild(el('div', 'jor-ob-grupo', 'Inversor e cabos'));
    var g3 = el('div', 'jor-ob-par'); [['local', 'Local do inversor'], ['dist', 'Distância ao quadro (m)'], ['abrig', 'Abrigado de sol e chuva'], ['wifi', 'Sinal de Wi-Fi']].forEach(function (x) { g3.appendChild(lin('inversor', x[0], x[1])); }); box.appendChild(g3);
    box.appendChild(el('div', 'jor-ob-grupo', 'Conclusão'));
    var concl = selecao([['', 'Não avaliado'], ['ok', 'Apto para instalação'], ['adeq', 'Apto com adequações'], ['nao', 'Não apto no momento']], v.concl || '', 'Conclusão da vistoria'); concl.disabled = !pode; concl.addEventListener('change', function () { v.concl = concl.value; });
    box.appendChild(campo('Conclusão', concl));
    var adeq = el('textarea', 'jor-ta'); adeq.value = v.adeq.join('\n'); adeq.disabled = !pode; adeq.setAttribute('aria-label', 'Adequações'); adeq.placeholder = 'Uma adequação por linha'; adeq.addEventListener('input', function () { v.adeq = adeq.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10); });
    var obs = el('textarea', 'jor-ta'); obs.value = v.obs || ''; obs.disabled = !pode; obs.maxLength = 600; obs.setAttribute('aria-label', 'Observações'); obs.addEventListener('input', function () { v.obs = obs.value; });
    box.appendChild(campo('Adequações', adeq)); box.appendChild(campo('Observações', obs));
    var info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); box.appendChild(info);
    var ac = el('div', 'jor-din-acoes');
    if (pode) ac.appendChild(botaoSalvar('Salvar', 'vistoria', function () { return v; }, 'Relatório salvo.'));
    ac.appendChild(btn('Gerar relatório', 'jor-btn-pri', function () { gerarVistoria(d, v, info); }));
    box.appendChild(ac); esq.appendChild(box);
  }
  function gerarVistoria(d, v, info) {
    if (!papelOk()) return;
    if (typeof fsVistoriaBlocos !== 'function') { info.textContent = 'O papel da vistoria não está disponível agora.'; return; }
    if (!v.concl) { info.textContent = 'Escolha a conclusão da vistoria.'; return; }
    if ((v.concl === 'adeq' || v.concl === 'nao') && !(v.adeq || []).length) { info.textContent = 'Com essa conclusão, descreva as adequações necessárias.'; return; }
    info.textContent = '';
    cadastroPronto().then(function (cad) {
      var cli = cliDe(cad, d); var t = v.telhado || {}, e = v.entrada || {}, iv = v.inversor || {};
      var fotos = (v.fotos && v.fotos.length ? v.fotos.map(function (f) { return { src: urlDe(f.arquivo_id), leg: f.leg || 'Foto', txt: f.txt || '' }; }) : [['fachada', 'Fachada'], ['padrao', 'Padrão de entrada'], ['disjuntor', 'Disjuntor'], ['medidor', 'Medidor']].map(function (x) { return { src: urlDoSlot(x[0]), leg: x[1], txt: '' }; })).filter(function (f) { return f.src; });
      var dd = {
        cli: cli, emp: solEmp(), data: v.data || (typeof solHoje === 'function' ? solHoje() : hoje()), quem: v.quem || '', acomp: v.acomp || '', local: '', kwp: (d.proposta && d.proposta.kwp) ? String(d.proposta.kwp).replace('.', ',') : '', nmod: '', uc: cad ? (typeof vdcV === 'function' ? vdcV(cad, 'unidade_consumidora') : '') : '', conc: cad ? (typeof vdcV === 'function' ? vdcV(cad, 'concessionaria') : '') : '',
        tel: cli.tel, concl: v.concl, adeq: v.adeq || [], obs: v.obs || '',
        telhado: [['Tipo', t.tipo || ''], ['Estado', t.estado || ''], ['Orientação da água', t.orient || ''], ['Inclinação', t.incl ? numTxt(t.incl) + ' graus' : ''], ['Área útil livre', t.area ? numTxt(t.area) + ' m²' : ''], ['Sombreamento', t.sombra || ''], ['Estrutura de apoio', t.estr || ''], ['Acesso', t.acesso || '']],
        entrada: [['Padrão', e.padrao || ''], ['Tensão', e.tensao || ''], ['Disjuntor geral', e.disj ? numTxt(e.disj) + ' A' : ''], ['Padrão apto a receber', e.apto || ''], ['Aterramento', e.aterr || ''], ['Espaço no quadro', e.quadro || '']],
        inversor: [['Local do inversor', iv.local || ''], ['Distância ao quadro', iv.dist ? numTxt(iv.dist) + ' m' : ''], ['Abrigado de sol e chuva', iv.abrig || ''], ['Sinal de Wi-Fi', iv.wifi || '']],
        fotos: fotos,
      };
      var pageFoot = function (n, tot) { return solRodape('Relatório de vistoria técnica', dd.cli.nome, n, tot, 0); };
      var html = '<div class="ep-doc">' + epPaginar(fsVistoriaBlocos(dd), pageFoot) + '</div>';
      previa(html, 'Vistoria_Solar_' + limpaArq(dd.cli.nome), 'Vistoria solar · ' + dd.cli.nome, null);
    });
  }

  // Etapa 2 · Proposta de banco
  function extraBanco(esq, d) {
    var f2 = O().fase2; if (!f2) return; injetarCss(); var h = H();
    var pode = podeSecao(f2, 'banco'); var bk = clone(dados(f2).banco) || {};
    var vendaOk = !!(d.venda && d.venda.valor_centavos > 0);
    var bloc = el('div', 'jor-bloco'); var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', 'Proposta de banco' + (bk.banco ? ' · para o ' + bk.banco : ''))); bloc.appendChild(t);
    var falta = [];
    function atualiza() { falta = []; if (!(bk.banco || '').trim()) falta.push('o banco'); if (!(bk.agencia || '').trim()) falta.push('a agência'); if (!(bk.conta || '').trim()) falta.push('a conta'); if (!vendaOk) falta.push('o valor vendido'); aviso.textContent = falta.length ? 'Falta ' + falta.join(', ') + '.' : ''; gerar.disabled = falta.length > 0; }
    var box = el('details'); box.appendChild(el('summary', 'jor-vdc-sum', 'Preencher a proposta de banco'));
    function lin(chave, rot, tipo) { var i = entrada(tipo || 'text', bk[chave] || '', rot); i.disabled = !pode; i.addEventListener('input', function () { bk[chave] = i.value; atualiza(); }); return campo(rot, i); }
    function reais0(chave, rot) { var i = entrada('text', Number(bk[chave]) > 0 ? txtCents(bk[chave]) : '', rot); i.inputMode = 'decimal'; i.disabled = !pode; i.addEventListener('input', function () { var v = h.cents(i.value); bk[chave] = (typeof v === 'number' && v > 0) ? v : null; }); return campo(rot + ' (R$, opcional)', i); }
    var g = el('div', 'jor-ob-par'); add(g, lin('banco', 'Banco'), lin('agencia', 'Agência'), lin('conta', 'Conta corrente'), lin('validade', 'Validade (dias)'), lin('prazo', 'Prazo de entrega'), lin('origem', 'Origem dos recursos'), lin('nota', 'Nota da entrada'), lin('desc', 'Descrição do sistema'), lin('ger', 'Geração (kWh/mês)'), reais0('eq_centavos', 'Equipamento'), reais0('mo_centavos', 'Mão de obra')); box.appendChild(g);
    var det = el('details'); det.appendChild(el('summary', 'jor-vdc-sum', 'Titular do financiamento (opcional)')); var fin = bk.fin || {};
    var gf = el('div', 'jor-ob-par');
    [['nome', 'Nome'], ['doc', 'CPF ou CNPJ'], ['rg', 'RG'], ['qualif', 'Qualificação'], ['end', 'Endereço'], ['cep', 'CEP'], ['tel', 'Telefone'], ['email', 'E-mail']].forEach(function (x) {
      var i = entrada('text', fin[x[0]] || '', 'Titular: ' + x[1]); i.disabled = !pode; i.addEventListener('input', function () { fin[x[0]] = i.value; bk.fin = fin; }); gf.appendChild(campo(x[1], i));
    });
    det.appendChild(gf); box.appendChild(det);
    var aviso = el('p', 'jor-erro'); aviso.setAttribute('role', 'status'); var gerar = btn('Gerar', 'jor-btn-pri', function () { gerarBanco(d, bk, f2, aviso); });
    var ac = el('div', 'jor-din-acoes'); if (pode) ac.appendChild(botaoSalvar('Salvar', 'banco', function () { return bk; }, 'Proposta de banco salva.')); ac.appendChild(gerar);
    box.appendChild(aviso); box.appendChild(ac); bloc.appendChild(box); esq.appendChild(bloc); atualiza();
  }
  function gerarBanco(d, bk, f2, aviso) {
    if (!papelOk()) return;
    if (typeof fsBancoPaginado !== 'function') { aviso.textContent = 'O papel do banco não está disponível agora.'; return; }
    var tot = Number(d.venda && d.venda.valor_centavos) || 0;
    var ent = ((d.venda && d.venda.pagamento) || []).filter(function (p) { return p.forma !== 'financiamento'; }).reduce(function (s, p) { return s + (Number(p.valor_centavos) || 0); }, 0);
    var eqD = Number(bk.eq_centavos) || 0, moD = Number(bk.mo_centavos) || 0, eq, mo;
    if (eqD > 0 && moD > 0) { eq = eqD; mo = moD; } else if (eqD > 0) { eq = eqD; mo = tot - eqD; } else if (moD > 0) { mo = moD; eq = tot - moD; } else { eq = Math.round(tot * 0.82); mo = tot - eq; }
    var erros = [];
    if (eq < 0 || mo < 0) erros.push('O valor dos equipamentos ou da mão de obra passa do valor total.');
    else if (eq + mo !== tot) erros.push('Equipamento mais mão de obra (' + H().reais(eq + mo) + ') não fecha com o valor total (' + H().reais(tot) + ').');
    if (ent >= tot) erros.push('A entrada é igual ou maior que o valor total: não sobra saldo a financiar.');
    if (erros.length) { aviso.textContent = erros.join(' '); return; }
    aviso.textContent = '';
    var c = compraDe(f2); var todos = c.itens.concat(c.itens.length ? [] : c.sugeridos);
    var mods = todos.filter(function (x) { return x.tipo === 'modulo'; }), invs = todos.filter(function (x) { return x.tipo === 'inversor'; });
    var q = function (v) { return (/^\d+$/.test(String(v).trim()) && +v > 0) ? String(+v) : '1'; };
    var itens = [];
    mods.forEach(function (m) { itens.push({ qtd: q(m.quantidade), desc: ('Módulos fotovoltaicos ' + [m.marca, m.modelo, m.potencia_w ? m.potencia_w + 'W' : ''].filter(Boolean).join(' ')).trim() }); });
    invs.forEach(function (m) { itens.push({ qtd: q(m.quantidade), desc: ('Inversor ' + [m.marca, m.modelo].filter(Boolean).join(' ')).trim() }); });
    if (!mods.length) itens.push({ qtd: '1', desc: 'Módulos fotovoltaicos' });
    if (!invs.length) itens.push({ qtd: '1', desc: 'Inversor' });
    itens.push({ qtd: '1', desc: 'Kit estrutura para telhado' }, { qtd: '1', desc: 'Kit cabo fotovoltaico' }, { qtd: '1', desc: 'Kit material elétrico CA' }, { qtd: '1', desc: 'Homologação do projeto de engenharia' }, { qtd: '1', desc: 'Montagem especializada' });
    cadastroPronto().then(function (cad) {
      var cli = cliDe(cad, d); var fin = bk.fin && bk.fin.nome ? bk.fin : null;
      var dd = {
        cli: cli, emp: solEmp(), contas: { tot: tot, ent: ent, eq: eq, mo: mo, saldo: tot - ent, padrao: !(eqD > 0 || moD > 0), erros: [] }, itens: itens,
        banco: bk.banco || '', agencia: bk.agencia || '', conta: bk.conta || '', kwp: d.proposta && d.proposta.kwp ? String(d.proposta.kwp).replace('.', ',') : '', ger: bk.ger || '', desc: bk.desc || '',
        nota: bk.nota || 'Entrada paga pelo comprador com recursos próprios', validade: bk.validade || '', prazo: bk.prazo || '', origem: bk.origem || '', data: (typeof solHoje === 'function' ? solHoje() : hoje()), cidade: cli.cidade,
        fin: fin ? { nome: fin.nome, doc: fin.doc || '', pj: (typeof vdcDigitos === 'function' ? vdcDigitos(fin.doc || '').length === 14 : false), rg: fin.rg || '', qualif: fin.qualif || '', end: fin.end || '', cep: fin.cep || '', tel: fin.tel || '', email: fin.email || '' } : null,
      };
      var pageFoot = function (n, totp) { return solRodape('Proposta de banco', dd.cli.nome, n, totp, 0); };
      var html = '<div class="ep-doc">' + fsBancoPaginado(dd, pageFoot) + '</div>';
      previa(html, 'Proposta_Banco_Solar_' + limpaArq(dd.cli.nome), 'Proposta de banco · ' + dd.cli.nome, null);
    });
  }

  // Etapa 7 · Termo de entrega
  function gerarTermoEntrega(d, f2, c, chk, ressalva, en) {
    if (!papelOk()) return;
    if (typeof fsTermoHTML !== 'function') { H().toast('O papel do termo não está disponível agora.'); return; }
    var mod = c.itens.filter(function (x) { return x.tipo === 'modulo'; }); var inv = c.itens.filter(function (x) { return x.tipo === 'inversor'; });
    var cg = dados(f2).contrato_garantias || {}; var M = en.monitoramento || {};
    var nmod = mod.reduce(function (s, x) { return s + (Number(x.quantidade) || 0); }, 0), ninv = inv.reduce(function (s, x) { return s + (Number(x.quantidade) || 0); }, 0);
    var kwp = (nmod && mod[0] && mod[0].potencia_w) ? String(Math.round(nmod * mod[0].potencia_w / 10) / 100).replace('.', ',') : (d.proposta && d.proposta.kwp ? String(d.proposta.kwp).replace('.', ',') : '');
    var ginst = String(cg.instalacao || ''); var mi = /^(\d+)/.exec(ginst);
    cadastroPronto().then(function (cad) {
      var cli = cliDe(cad, d);
      var dd = {
        cli: cli, emp: solEmp(), data: (typeof solHoje === 'function' ? solHoje() : hoje()), cidade: cli.cidade, conclusao: (en.termo && en.termo.assinado_em ? String(en.termo.assinado_em).slice(0, 10) : (typeof solHoje === 'function' ? solHoje() : hoje())), liberacao: '',
        serie: M.serie || '', cnum: d.codigo ? d.codigo.replace('#', '') : '', cdata: '', kwp: kwp, nmod: nmod ? String(nmod) : '', mod: mod[0] ? [mod[0].marca, mod[0].modelo, mod[0].potencia_w ? mod[0].potencia_w + 'W' : ''].filter(Boolean).join(' ') : '',
        ninv: ninv ? String(ninv) : '', tinv: 'on-grid', minv: inv[0] ? [inv[0].marca, inv[0].modelo].filter(Boolean).join(' ') : '', bat: '', local: cli.endFull || '',
        uc: cad && typeof vdcV === 'function' ? vdcV(cad, 'unidade_consumidora') : '', conc: cad && typeof vdcV === 'function' ? vdcV(cad, 'concessionaria') : '',
        gmod: (mod[0] && mod[0].garantia_desempenho_anos) ? String(mod[0].garantia_desempenho_anos) : (cg.modulos ? String(cg.modulos) : ''), ginv: (inv[0] && inv[0].garantia_anos) ? String(inv[0].garantia_anos) : (cg.inversor ? String(cg.inversor) : ''),
        ginst: mi ? mi[1] : '', ginstun: /mes/i.test(ginst) ? 'meses' : 'anos', chk: chk, ressalva: ressalva,
      };
      previa(fsTermoHTML(dd), 'Termo_Entrega_Solar_' + limpaArq(cli.nome), 'Termo de entrega solar · ' + cli.nome, { umaPagina: true, piso: 0.86, alvo: '.ep-page' });
    });
  }

  window.Jornada.etapas[4] = etapa4;
  window.Jornada.etapas[5] = etapa5;
  window.Jornada.etapas[6] = etapa6;
  window.Jornada.etapas[7] = etapa7;
  window.Jornada.etapas[8] = etapa8;
  window.Jornada.extras.vistoria = extraVistoria;
  window.Jornada.extras.banco = extraBanco;
  void semanaDe;
})();
