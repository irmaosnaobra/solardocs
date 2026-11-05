/* Jornada da obra, fase 1 (05/11/2026): a aba Clientes do Solar e as etapas 1 a 3 da obra.
 * Fase 2 (06/11/2026): a faixa do dinheiro, as etapas 4 a 8 e os papéis do Fechamento nas etapas moram em jornada-dinheiro.js e jornada-obra.js, que se registram em window.Jornada.
 * Script clássico, um IIFE. Expõe window.Jornada = { abrirLista, abrirObra, vendido, h, etapas, extras, dinheiro }.
 * Funções do index.html são buscadas na hora da chamada, sempre com typeof: vdcFetch, admOk, vdcDetalhe, vdcFechar, vdcAnexar,
 * epEmitGet, showToast, navObrasSolar, navPainelSolar. A variável vdcEst é um `let` global do index: lida pelo nome, com typeof.
 * O DOM é montado com createElement e textContent (nada de HTML vindo do servidor, salvo o papel dentro do iframe sem scripts).
 * Cor só por var(--n-*) e var(--io-*), com a reserva escura que o .vdc e o .dc-* já usam. Sem emoji, sem exclamação, sem travessão. */
(function () {
  'use strict';

  var L = { dados: null, aba: 'ativas', filtro: 'todas', busca: '', consultor: '', carregando: false, erro: '', menu: null };
  var O = { card: null, dados: null, fase2: null, fase3: null, dinheiro: null, fase2Erro: false, dinErro: false, ocupado: '', msg: '', painel: null, vdcChave: '', vdcNo: null, vdcDet: null, vdcPainel: 0, obraNo: null, debounce: 0, seq: 0 };

  // ── Rede ───────────────────────────────────────────────────────────────────
  function api(rota, metodo, corpo, ms) {
    if (typeof vdcFetch !== 'function') return Promise.resolve({ status: 0, json: null });
    return vdcFetch(rota, metodo, corpo, ms).then(function (r) { return { status: r.status, json: r.json || {} }; });
  }
  function msgDe(r, padrao) {
    if (r.status === 401) return 'Sua sessão terminou. Entre de novo no Gerador.';
    if (r.status === 0) return 'Sem conexão. Tente de novo.';
    return (r.json && typeof r.json.error === 'string' && r.json.error) || padrao;
  }
  function toast(t) { if (typeof showToast === 'function') showToast(t); }

  // ── DOM ────────────────────────────────────────────────────────────────────
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = String(txt);
    return e;
  }
  function add(pai) { for (var i = 1; i < arguments.length; i++) { if (arguments[i]) pai.appendChild(arguments[i]); } return pai; }
  function btn(txt, cls, fn) {
    var b = el('button', 'jor-btn' + (cls ? ' ' + cls : ''), txt); b.type = 'button';
    if (fn) b.addEventListener('click', fn);
    return b;
  }
  var SVG = 'http://www.w3.org/2000/svg';
  function icone(tipo) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '14'); s.setAttribute('height', '14'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.4'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', tipo === 'ok' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z');
    s.appendChild(p);
    return s;
  }
  function corpo() { return document.getElementById('jor-corpo'); }
  function ddmm(ymd) { var s = String(ymd || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) : ''; }
  function reais(c) { var n = Math.round(Number(c) || 0); var r = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return 'R$ ' + r + ',' + ('0' + (n % 100)).slice(-2); }
  function nomeBonito(n) { n = String(n || ''); return n ? n.charAt(0).toUpperCase() + n.slice(1) : ''; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  /** Dinheiro com sinal: o negativo sai "-R$ 61,50" (o reais() acima é só para valor positivo). */
  function rs(c) { var n = Math.round(Number(c) || 0); return n < 0 ? '-' + reais(-n) : reais(n); }
  /** Texto de dinheiro em centavos inteiros. null = vazio, NaN = não entendi. */
  function cents(txt) {
    if (typeof Financeiro === 'undefined' || typeof Financeiro.centavosDeTexto !== 'function') { var t = String(txt).trim(); if (!t) return null; var n = Number(t.replace(/\./g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) : NaN; }
    return Financeiro.centavosDeTexto(txt);
  }

  function injetarCss() {
    if (document.getElementById('jor-css')) return;
    var css = [
      '.jor{color:var(--n-tx,#E5E7EB);font-size:14px;line-height:1.45}',
      '.jor *{box-sizing:border-box}',
      '.jor h2,.jor h3{margin:0;color:var(--n-tx,#E5E7EB)}',
      '.jor-topo{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 12px}',
      '.jor-topo h2{font-size:22px;font-weight:800;margin-right:auto}',
      '.jor-abas,.jor-filtros{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;align-items:center}',
      '.jor-aba,.jor-chip{border:1px solid var(--n-bd,#334155);background:var(--n-sf,#1E293B);color:var(--n-tx2,#B4C0D2);border-radius:999px;padding:7px 14px;font:inherit;font-weight:700;cursor:pointer;min-height:36px}',
      '.jor-aba.on,.jor-chip.on{background:var(--io-marcado,#2563EB);border-color:var(--io-marcado,#2563EB);color:#fff}',
      '.jor-busca,.jor-sel,.jor-in,.jor-ta{border:1px solid var(--n-bd,#334155);background:var(--n-sf,#1E293B);color:var(--n-tx,#E5E7EB);border-radius:10px;padding:8px 10px;font:inherit;min-height:38px;max-width:100%}',
      '.jor-ta{width:100%;min-height:76px;resize:vertical}',
      '.jor-linha-atrasadas{border:1px solid var(--io-er-bd,rgba(248,113,113,.4));background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-tx,#FCA5A5);border-radius:10px;padding:8px 12px;margin:0 0 10px;font-weight:700}',
      '.jor-nota{color:var(--n-tx3,#94A3B8);font-size:12.5px;margin:8px 0}',
      '.jor-num{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:800}',
      '.jor-tab tr.jor-atrasada td{color:var(--io-er-tx,#FCA5A5)}',
      '.jor-tab tr.jor-atrasada td:first-child{box-shadow:inset 3px 0 0 var(--io-er-tx,#FCA5A5)}',
      '.jor-tab tbody tr{cursor:default}',
      '.jor-tag{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:800;margin-left:6px;background:var(--io-av-sf,rgba(251,191,36,.1));color:var(--io-av-tx,#FCD34D)}',
      '.jor-tag-travada{background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-tx,#FCA5A5)}',
      '.jor-auto{display:inline-block;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:800;margin-left:8px;background:var(--n-sf2,#182338);color:var(--io-azul-tx,#93C5FD);border:1px solid var(--n-bd,#334155)}',
      '.jor-btn{border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);color:var(--n-tx,#E5E7EB);border-radius:10px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;min-height:38px}',
      '.jor-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.jor-btn-pri{background:var(--io-marcado,#2563EB);border-color:var(--io-marcado,#2563EB);color:#fff}',
      '.jor-btn-link{background:transparent;border-color:transparent;color:var(--io-azul-tx,#93C5FD);text-decoration:underline}',
      '.jor-cab{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;border:1px solid var(--n-bd,#334155);background:var(--n-sf,#1E293B);border-radius:14px;padding:14px 16px;margin:0 0 12px}',
      '.jor-cab .jor-num{font-size:20px}',
      '.jor-cab-t{flex:1 1 220px;min-width:0}',
      '.jor-cab-t b{display:block;font-size:17px;overflow-wrap:anywhere}',
      '.jor-cab-t span{color:var(--n-tx2,#B4C0D2);font-size:13px}',
      '.jor-pilula{border-radius:999px;padding:4px 12px;font-weight:800;font-size:12.5px;background:var(--n-sf2,#182338);color:var(--io-azul-tx,#93C5FD);border:1px solid var(--n-bd,#334155)}',
      '.jor-faixa{border:1px solid var(--io-er-bd,rgba(248,113,113,.4));background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-tx,#FCA5A5);border-radius:12px;padding:12px 14px;margin:0 0 12px;font-weight:700}',
      '.jor-regua{display:flex;gap:8px;overflow-x:auto;padding:2px 0 8px;margin:0 0 12px;-webkit-overflow-scrolling:touch}',
      '.jor-passo{flex:0 0 auto;min-width:92px;border:1px solid var(--n-bd,#334155);background:var(--n-sf,#1E293B);color:var(--n-tx2,#B4C0D2);border-radius:12px;padding:8px 10px;text-align:left;font:inherit;cursor:pointer}',
      '.jor-passo b{display:flex;align-items:center;gap:6px;font-size:13px}',
      '.jor-passo small{display:block;color:var(--n-tx3,#94A3B8);font-size:11.5px}',
      '.jor-passo.feita{background:var(--io-ok-sf,rgba(74,222,128,.14));color:var(--io-ok-tx,#4ADE80);border-color:var(--io-ok-tx,#4ADE80)}',
      '.jor-passo.feita small{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-passo.davez{box-shadow:0 0 0 2px var(--io-marcado,#2563EB);color:var(--n-tx,#E5E7EB)}',
      '.jor-passo.futura{opacity:.78;cursor:default}',
      '.jor-passo.sel{outline:2px solid var(--io-azul-tx,#93C5FD);outline-offset:1px}',
      '.jor-cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px;align-items:start}',
      '.jor-esq,.jor-dir{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.jor-bloco{border:1px solid var(--n-bd,#334155);background:var(--n-sf,#1E293B);border-radius:14px;padding:14px 16px}',
      '.jor-bloco-t{display:flex;align-items:center;gap:8px;font-weight:800;margin:0 0 8px;flex-wrap:wrap}',
      '.jor-bloco-t em{font-style:normal;margin-left:auto;font-size:12.5px;color:var(--n-tx3,#94A3B8)}',
      '.jor-bloco-t em.ok{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-itens{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.jor-itens li{display:flex;gap:8px;align-items:flex-start}',
      '.jor-itens li.ok{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-itens li.falta{color:var(--n-tx2,#B4C0D2)}',
      '.jor-anexo{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-anexo:first-of-type{border-top:0}',
      '.jor-anexo .jor-rot{flex:1 1 180px;font-weight:700}',
      '.jor-anexo .jor-est{font-size:12.5px;color:var(--n-tx3,#94A3B8)}',
      '.jor-anexo .jor-est.ok{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-portao{border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);border-radius:14px;padding:14px 16px}',
      '.jor-portao p{margin:6px 0 0;color:var(--n-tx2,#B4C0D2)}',
      '.jor-aviso{border:1px solid var(--n-bd,#334155);background:var(--io-av-sf,rgba(251,191,36,.1));color:var(--io-av-tx,#FCD34D);border-radius:10px;padding:8px 12px}',
      '.jor-erro{color:var(--io-er-tx,#FCA5A5);font-weight:700}',
      '.jor-ok{color:var(--io-ok-tx,#4ADE80);font-weight:700}',
      '.jor-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}',
      '.jor-grade label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-pg{display:grid;grid-template-columns:130px minmax(0,1fr) minmax(0,1fr);gap:6px;margin:4px 0}',
      '.jor-dlg{position:fixed;inset:0;z-index:1300;background:rgba(3,10,24,.72);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.jor-dlg>div{background:var(--n-sf,#1E293B);color:var(--n-tx,#E5E7EB);border:1px solid var(--n-bd,#334155);border-radius:14px;padding:18px;width:min(460px,100%);display:flex;flex-direction:column;gap:10px;max-height:90vh;overflow:auto}',
      '.jor-dlg-bt{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
      '.jor-tbl{width:100%;border-collapse:collapse;font-size:13px}',
      '.jor-tbl th,.jor-tbl td{padding:6px 8px;border-bottom:1px solid var(--n-bd,#334155);text-align:left;color:var(--n-tx,#E5E7EB)}',
      '.jor-tbl th{color:var(--n-tx2,#B4C0D2)}',
      '#jor-vdc{margin-top:14px}',
      '.jor-vdc-det{margin-top:14px}',
      '.jor-vdc-sum{cursor:pointer;font-weight:800;color:var(--n-tx,#E5E7EB);padding:8px 0}',
      '.jor-passo-gasto{color:var(--n-tx2,#B4C0D2);font-weight:700}',
      '.jor-passo.feita .jor-passo-gasto{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-fin-tag{display:inline-block;border-radius:999px;padding:2px 10px;font-size:11.5px;font-weight:800;background:var(--n-sf2,#182338);color:var(--n-tx2,#B4C0D2);border:1px solid var(--n-bd,#334155)}',
      '.jor-dl{display:grid;grid-template-columns:minmax(130px,max-content) minmax(0,1fr);gap:6px 16px;margin:0}',
      '.jor-dl dt{color:var(--n-tx3,#94A3B8);font-size:12.5px}',
      '.jor-dl dd{margin:0;overflow-wrap:anywhere}',
      '.jor-docs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.jor-docs a{color:var(--io-azul-tx,#93C5FD)}',
      '@media (max-width:760px){',
      '.jor-dl{grid-template-columns:minmax(0,1fr)}',
      '.jor-cols{grid-template-columns:minmax(0,1fr)}',
      '.jor-pg{grid-template-columns:minmax(0,1fr)}',
      '.jor-tab thead{display:none}',
      '.jor-tab,.jor-tab tbody,.jor-tab tr,.jor-tab td{display:block;width:100%}',
      '.jor-tab tr{border-bottom:1px solid var(--n-bd,#334155);padding:8px 10px}',
      '.jor-tab td{border:0;padding:2px 0;white-space:normal}',
      '.jor-tab td[data-r]::before{content:attr(data-r) ": ";color:var(--n-tx3,#94A3B8);font-size:12px}',
      '}',
    ].join('\n');
    var st = document.createElement('style'); st.id = 'jor-css'; st.textContent = css; document.head.appendChild(st);
  }

  // ── Diálogos ───────────────────────────────────────────────────────────────
  function fecharDlg() { var d = document.querySelector('.jor-dlg'); if (d) d.remove(); document.removeEventListener('keydown', escDlg); }
  function escDlg(e) { if (e.key === 'Escape') fecharDlg(); }
  /** Diálogo fixo com título, corpo e Cancelar/Salvar. `ok(salvarBtn)` roda no Salvar. */
  function dialogo(titulo, montar, rotuloOk, ok) {
    fecharDlg();
    var d = el('div', 'jor-dlg'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', titulo);
    var c = el('div'); c.appendChild(el('h3', '', titulo));
    var api2 = montar(c) || {};
    var bt = el('div', 'jor-dlg-bt');
    var salvar = btn(rotuloOk || 'Salvar', 'jor-btn-pri', function () { if (!salvar.disabled) ok(salvar, c); });
    api2.salvar = salvar;
    add(bt, btn('Cancelar', '', fecharDlg), salvar);
    c.appendChild(bt); d.appendChild(c);
    d.addEventListener('click', function (e) { if (e.target === d) fecharDlg(); });
    document.addEventListener('keydown', escDlg);
    document.body.appendChild(d);
    if (api2.foco) api2.foco.focus();
    return api2;
  }
  function dialogoMotivo(titulo, rotuloOk, enviar) {
    dialogo(titulo, function (c) {
      var ta = el('textarea', 'jor-ta'); ta.maxLength = 300; ta.setAttribute('aria-label', 'Motivo'); ta.placeholder = 'Diga o motivo';
      c.appendChild(ta);
      var info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); c.appendChild(info);
      var ret = { foco: ta, info: info, ta: ta };
      setTimeout(function () { ret.salvar.disabled = true; }, 0);
      ta.addEventListener('input', function () { ret.salvar.disabled = ta.value.trim().length < 3; });
      return ret;
    }, rotuloOk, function (b, c) {
      var ta = c.querySelector('textarea'); var info = c.querySelector('.jor-erro');
      b.disabled = true;
      enviar(ta.value.trim()).then(function (r) {
        if (r.ok) { fecharDlg(); return; }
        b.disabled = false; info.textContent = r.erro || 'Não consegui agora. Tente de novo.';
      });
    });
  }

  // ── A lista ─────────────────────────────────────────────────────────────────
  function abrirLista() {
    injetarCss();
    sairDaObra();
    O.card = null;
    var c = corpo(); if (!c) return;
    // Link de entrada: /gerador/?obra=<id> (a Agenda manda para cá depois do VENDIDO).
    try {
      var q = new URLSearchParams(location.search).get('obra');
      if (q && /^\d{1,12}$/.test(q)) {
        history.replaceState(null, '', location.pathname + location.hash);
        if (typeof navClientesSolar === 'function') { navClientesSolar(q); return; }
      }
    } catch (e) { /* sem parâmetro */ }
    L.carregando = true; L.erro = '';
    c.replaceChildren(el('p', 'jor-nota', 'Carregando…'));
    api('/gerador/jornada-solar/lista', 'GET').then(function (r) {
      L.carregando = false;
      if (r.status === 200 && r.json && r.json.ok !== false) { L.dados = r.json; L.erro = ''; } else { L.erro = msgDe(r, 'Não consegui abrir a lista agora. Tente de novo.'); }
      desenharLista();
    });
  }

  function linhasVisiveis() {
    var d = L.dados; if (!d) return [];
    var busca = L.busca.trim().toLowerCase();
    return d.linhas.filter(function (l) {
      if (l.grupo !== L.aba) return false;
      if (L.aba === 'ativas') {
        if (L.filtro === 'minha' && !l.minha) return false;
        if (L.filtro === 'atrasadas' && !(l.trilho === 'jornada' && (l.situacao.tipo === 'atrasada' || l.situacao.tipo === 'travada'))) return false;
      }
      if (L.consultor && l.consultor !== L.consultor) return false;
      if (busca && (String(l.cliente).toLowerCase().indexOf(busca) < 0 && String(l.codigo || '').toLowerCase().indexOf(busca) < 0)) return false;
      return true;
    });
  }

  function desenharLista() {
    var c = corpo(); if (!c) return;
    var d = L.dados;
    var raiz = el('div');
    var topo = el('div', 'jor-topo'); topo.appendChild(el('h2', '', 'Clientes'));
    add(topo, btn('Mapa', '', function () {
      if (typeof obEstado !== 'undefined' && obEstado) obEstado.aba = 'mapa';
      if (typeof navObrasSolar === 'function') navObrasSolar();
    }));
    add(topo, btn('Indicações', '', function () {
      if (typeof obEstado !== 'undefined' && obEstado) obEstado.aba = 'indicacoes';
      if (typeof navObrasSolar === 'function') navObrasSolar();
    }));
    if (typeof admOk === 'function' && admOk()) add(topo, btn('Painel', 'jor-btn-link', function () { if (typeof navPainelSolar === 'function') navPainelSolar(); }));
    if (typeof admOk === 'function' && admOk() && window.Jornada.dinheiro && window.Jornada.dinheiro.abrirAjustes) add(topo, btn('Ajustes', 'jor-btn-link', function () { window.Jornada.dinheiro.abrirAjustes(); }));
    raiz.appendChild(topo);
    if (L.erro || !d) {
      raiz.appendChild(el('p', 'jor-erro', L.erro || 'Sem dados.'));
      add(raiz, btn('Tentar de novo', '', abrirLista));
      c.replaceChildren(raiz); return;
    }
    var ct = d.contagem;
    var abas = el('div', 'jor-abas'); abas.setAttribute('role', 'tablist');
    [['ativas', 'Ativas ' + ct.ativas], ['posvenda', 'Pós-venda ' + ct.posvenda], ['canceladas', 'Canceladas ' + ct.canceladas], ['finalizadas', 'Finalizadas ' + (ct.finalizadas || 0)]].forEach(function (a) {
      var b = el('button', 'jor-aba' + (L.aba === a[0] ? ' on' : ''), a[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', L.aba === a[0] ? 'true' : 'false');
      b.addEventListener('click', function () { L.aba = a[0]; desenharLista(); });
      abas.appendChild(b);
    });
    raiz.appendChild(abas);
    var fil = el('div', 'jor-filtros');
    if (L.aba === 'ativas') {
      [['todas', 'Todas'], ['minha', 'Minha fila ' + ct.minha], ['atrasadas', 'Atrasadas ' + ct.atrasadas]].forEach(function (f) {
        var b = el('button', 'jor-chip' + (L.filtro === f[0] ? ' on' : ''), f[1]); b.type = 'button';
        b.addEventListener('click', function () { L.filtro = f[0]; desenharLista(); });
        fil.appendChild(b);
      });
    }
    if (d.eu && d.eu.vePorConsultor) {
      var sel = el('select', 'jor-sel'); sel.setAttribute('aria-label', 'Consultor');
      var o0 = el('option', '', 'Todos os consultores'); o0.value = ''; sel.appendChild(o0);
      var vistos = {};
      d.linhas.forEach(function (l) { if (l.consultor && !vistos[l.consultor]) { vistos[l.consultor] = 1; } });
      Object.keys(vistos).sort().forEach(function (n) { var o = el('option', '', nomeBonito(n)); o.value = n; sel.appendChild(o); });
      sel.value = L.consultor;
      sel.addEventListener('change', function () { L.consultor = sel.value; desenharLista(); });
      fil.appendChild(sel);
    }
    var bu = el('input', 'jor-busca'); bu.type = 'search'; bu.placeholder = 'Buscar por nome ou número'; bu.setAttribute('aria-label', 'Buscar'); bu.value = L.busca;
    bu.addEventListener('input', function () { L.busca = bu.value; var pos = bu.selectionStart; desenharLista(); var nb = corpo().querySelector('.jor-busca'); if (nb) { nb.focus(); try { nb.setSelectionRange(pos, pos); } catch (e) { /* tipo search */ } } });
    fil.appendChild(bu);
    raiz.appendChild(fil);
    var atras = d.linhas.filter(function (l) { return l.grupo === 'ativas' && l.trilho === 'jornada' && (l.situacao.tipo === 'atrasada' || l.situacao.tipo === 'travada'); });
    if (atras.length && L.aba === 'ativas') {
      raiz.appendChild(el('p', 'jor-linha-atrasadas', 'Atrasadas (' + atras.length + '): ' + atras.map(function (l) {
        return nomeBonito(l.cliente) + ' · ' + (l.etapa ? l.etapa.n + ' ' + l.etapa.nome : '') + ' · ' + (l.situacao.dias ? plural(l.situacao.dias, 'dia', 'dias') : '');
      }).join(', ')));
    }
    var adm = !!(d.eu && d.eu.adm);
    var wrap = el('div', 'dc-wrap');
    var tab = el('table', 'dc-tab jor-tab');
    var cab = el('tr');
    ['Nº', 'Cliente', 'Cidade', 'Vendida em', 'Etapa', 'Dono', 'Situação'].concat(adm ? ['Dinheiro'] : []).concat(['']).forEach(function (t) { cab.appendChild(el('th', '', t)); });
    add(tab, add(el('thead'), cab));
    var tb = el('tbody');
    var linhas = linhasVisiveis();
    linhas.forEach(function (l) {
      var tr = el('tr', (l.trilho === 'jornada' && (l.situacao.tipo === 'atrasada' || l.situacao.tipo === 'travada') && l.grupo === 'ativas') ? 'jor-atrasada' : '');
      function td(rot, conteudo) { var t = el('td'); t.setAttribute('data-r', rot); if (typeof conteudo === 'string') t.textContent = conteudo; else if (conteudo) t.appendChild(conteudo); tr.appendChild(t); return t; }
      td('Nº', el('span', 'jor-num', l.codigo || '*'));
      td('Cliente', l.cliente);
      td('Cidade', l.cidade);
      td('Vendida em', l.vendida_em ? ddmm(l.vendida_em) + '/' + l.vendida_em.slice(0, 4) : '');
      if (l.finalizada) { var te = td('Etapa', ''); te.appendChild(el('span', 'jor-fin-tag', 'Finalizada')); } else td('Etapa', l.etapa ? l.etapa.n + ' ' + l.etapa.nome : 'Sem trilho');
      var dn = td('Dono', l.dono ? l.dono.iniciais : ''); if (l.dono) dn.title = nomeBonito(l.dono.nome);
      var s = td('Situação', l.grupo === 'canceladas' && l.cancelada
        ? 'Cancelada em ' + ddmm(l.cancelada.em) + ' por ' + nomeBonito(l.cancelada.por) + (l.cancelada.motivo ? ' · ' + l.cancelada.motivo : '')
        : l.situacao.texto);
      if (l.situacao.tipo === 'travada' && l.grupo === 'ativas') s.appendChild(el('span', 'jor-tag jor-tag-travada', 'Travada'));
      if (l.numero_pendente) s.appendChild(el('span', 'jor-tag', 'Número pendente'));
      if (adm) td('Dinheiro', l.dinheiro || '');
      var ac = td('', '');
      if (l.card) {
        add(ac, btn('Abrir', '', function () { abrirObra(l.card); }));
        if (adm && l.grupo !== 'canceladas' && !l.finalizada) {
          var mn = btn('Venda cancelada', 'jor-btn-link', function () { cancelarDialogo(l.card, function () { abrirLista(); }); });
          mn.setAttribute('aria-label', 'Venda cancelada: ' + l.cliente);
          ac.appendChild(mn);
        }
      } else if (l.codigo) {
        add(ac, btn('Abrir', '', function () { abrirPlanilha(l.codigo); }));
      }
      tb.appendChild(tr);
    });
    if (!linhas.length) { var vz = el('tr'); var tz = el('td', '', 'Nenhuma venda aqui.'); tz.colSpan = 9; vz.appendChild(tz); tb.appendChild(vz); }
    tab.appendChild(tb); wrap.appendChild(tab); raiz.appendChild(wrap);
    raiz.appendChild(el('p', 'jor-nota', 'A lista segue a data da venda, da mais nova para a mais antiga. O número nasce com o contrato e a procuração assinados, por isso pode sair fora de ordem.'));
    if (L.aba === 'canceladas') raiz.appendChild(el('p', 'jor-nota', 'Venda cancelada nunca gasta número.'));
    if (L.aba === 'finalizadas') raiz.appendChild(el('p', 'jor-nota', 'Vendas de antes da jornada. Abrem só para leitura, com os dados da planilha. Ficam fora da cobrança e das mensagens.'));
    c.replaceChildren(raiz);
  }

  // ── A obra ──────────────────────────────────────────────────────────────────
  function sairDaObra() {
    if (O.vdcNo && typeof vdcFechar === 'function') { try { vdcFechar(O.vdcNo); } catch (e) { /* já fechado */ } }
    O.vdcChave = ''; O.vdcNo = null; O.vdcDet = null; O.vdcPainel = 0; O.obraNo = null; O.fase2 = null; O.dinheiro = null;
    if (O.debounce) { clearTimeout(O.debounce); O.debounce = 0; }
  }

  function abrirObra(card) {
    injetarCss();
    var c = corpo(); if (!c) return;
    card = String(card);
    if (O.card !== card) { sairDaObra(); O.painel = null; O.msg = ''; }
    O.card = card;
    if (!O.obraNo) { O.obraNo = el('div'); O.obraNo.id = 'jor-obra'; }
    if (!O.vdcNo) { O.vdcNo = el('div'); O.vdcNo.id = 'jor-vdc'; }
    // Fase 2: o quadro de documentos mora num <details>, aberto nas etapas 1 a 3 e fechado nas outras. O #jor-vdc continua o mesmo nó.
    if (!O.vdcDet) { O.vdcDet = el('details', 'jor-vdc-det'); O.vdcDet.appendChild(el('summary', 'jor-vdc-sum', 'Documentos e cadastro do cliente')); O.vdcDet.appendChild(O.vdcNo); O.vdcPainel = 0; }
    if (!c.contains(O.obraNo)) c.replaceChildren(O.obraNo, O.vdcDet);
    O.obraNo.replaceChildren(el('p', 'jor-nota', 'Carregando…'));
    carregarObra();
  }

  function carregarObra() {
    var seq = ++O.seq; var card = O.card;
    var base = '/gerador/jornada-solar/obra/' + encodeURIComponent(card);
    return Promise.all([api(base, 'GET'), api(base + '/fase2', 'GET'), api(base + '/dinheiro', 'GET'), api(base + '/fase3', 'GET')]).then(function (rs3) {
      var r = rs3[0], rf = rs3[1], rd = rs3[2], r3 = rs3[3];
      if (seq !== O.seq || card !== O.card || !O.obraNo) return;
      // Falha só do fase2 ou do dinheiro não derruba a obra: o bloco diz que não leu e oferece Tentar de novo.
      var f2ok = rf.status === 200 && rf.json && rf.json.ok !== false && Array.isArray(rf.json.etapas);
      var dnok = rd.status === 200 && rd.json && rd.json.ok !== false && (rd.json.visivel === false || !!rd.json.livro);
      O.fase2 = f2ok ? rf.json : null; O.fase2Erro = !f2ok;
      O.dinheiro = dnok ? rd.json : null; O.dinErro = !dnok;
      // Fase 3: o pós-venda. Falha, ou resposta sem a lista de toques, vira null e a obra continua.
      O.fase3 = (r3 && r3.status === 200 && r3.json && r3.json.ok !== false && Array.isArray(r3.json.toques)) ? r3.json : null;
      if (r.status === 200 && r.json && r.json.ok !== false && r.json.finalizada) { O.dados = r.json; sairDoQuadro(); desenharFinalizada(r.json, O.obraNo, O.card); return; }
      if (r.status === 200 && r.json && r.json.ok !== false) {
        O.dados = r.json;
        // Depois do Trazer (ou de qualquer volta de finalizada), o quadro de documentos que a finalizada tirou da tela volta ao lado da obra.
        if (O.vdcDet && !O.vdcDet.isConnected && O.obraNo && O.obraNo.parentNode) O.obraNo.parentNode.appendChild(O.vdcDet);
        desenharObra(); montarQuadro();
      } else {
        O.obraNo.replaceChildren(el('p', 'jor-erro', msgDe(r, 'Não consegui abrir esta venda agora.')), btn('Voltar para Clientes', '', abrirLista));
      }
    });
  }
  /** Venda finalizada: o quadro de documentos editável não monta. */
  function sairDoQuadro() {
    if (O.vdcNo && typeof vdcFechar === 'function') { try { vdcFechar(O.vdcNo); } catch (e) { /* já fechado */ } }
    O.vdcChave = '';
    if (O.vdcDet && O.vdcDet.parentNode) O.vdcDet.parentNode.removeChild(O.vdcDet);
  }

  function trazerDialogo(card) {
    dialogoMotivo('Trazer para a jornada', 'Trazer', function (motivo) {
      return api('/gerador/jornada-solar/obra/' + encodeURIComponent(card) + '/trazer', 'POST', { motivo: motivo }).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { toast('A venda voltou para a jornada.'); carregarObra(); return { ok: true }; }
        return { ok: false, erro: msgDe(r, 'Não consegui trazer agora. Tente de novo.') };
      });
    });
  }

  function dataBr(iso) { var s2 = String(iso || ''); return /^\d{4}-\d{2}-\d{2}/.test(s2) ? s2.slice(8, 10) + '/' + s2.slice(5, 7) + '/' + s2.slice(0, 4) : ''; }

  /** A obra FINALIZADA, só para leitura: cabeçalho, "Dados da planilha" e os documentos que a venda já tem. Nada aqui grava, exceto o Trazer do ADM. */
  function desenharFinalizada(d, alvo, card) {
    var raiz = el('div');
    var cab = el('div', 'jor-cab');
    cab.appendChild(el('span', 'jor-num', d.codigo || '*'));
    var info = d.card || d.cabecalho || {};
    var t = el('div', 'jor-cab-t'); t.appendChild(el('b', '', info.cliente || ''));
    t.appendChild(el('span', '', [info.cidade, info.vendedor ? 'Vendido por ' + nomeBonito(info.vendedor) : ''].filter(Boolean).join(' · ')));
    cab.appendChild(t);
    cab.appendChild(el('span', 'jor-fin-tag', 'Finalizada'));
    add(cab, btn('Clientes', '', function () { L.aba = 'finalizadas'; abrirLista(); }));
    if (d.pode && d.pode.trazer && card) add(cab, btn('Trazer para a jornada', '', function () { trazerDialogo(card); }));
    raiz.appendChild(cab);
    raiz.appendChild(el('p', 'jor-nota', 'Venda de antes da jornada. Abre só para leitura: sem cobrança, sem mensagem e sem edição.'));

    var bl = el('div', 'jor-bloco'); bl.appendChild(el('div', 'jor-bloco-t', 'Dados da planilha'));
    if (d.planilha && d.planilha.campos && d.planilha.campos.length) {
      var dl = el('dl', 'jor-dl');
      d.planilha.campos.forEach(function (c) { dl.appendChild(el('dt', '', c.rotulo)); dl.appendChild(el('dd', '', c.valor)); });
      bl.appendChild(dl);
    } else if (d.planilha) bl.appendChild(el('p', 'jor-nota', 'A planilha não tem dados preenchidos para esta venda.'));
    else bl.appendChild(el('p', 'jor-nota', d.planilha_aviso || 'Sem dados da planilha para esta venda.'));
    raiz.appendChild(bl);

    if (card) {
      var bd = el('div', 'jor-bloco'); bd.appendChild(el('div', 'jor-bloco-t', 'Documentos e anexos'));
      var lista = el('p', 'jor-nota', 'Carregando…'); bd.appendChild(lista);
      raiz.appendChild(bd);
      api('/gerador/clientes/vendasolar/' + encodeURIComponent(card) + '/docs', 'GET').then(function (r) {
        if (String(O.card) !== String(card) || !lista.isConnected) return;
        if (!(r.status === 200 && r.json && r.json.ok !== false && Array.isArray(r.json.arquivos))) { lista.textContent = msgDe(r, 'Não consegui abrir os documentos agora.'); return; }
        var rot = {};
        (r.json.slots || []).forEach(function (sl) { rot[sl.key || sl.chave] = sl.label || sl.rotulo || sl.key; });
        if (!r.json.arquivos.length) { lista.textContent = 'Esta venda não tem documentos anexados.'; return; }
        var ul = el('ul', 'jor-docs');
        r.json.arquivos.forEach(function (a) {
          var li = el('li');
          var nomeArq = a.rotulo || rot[a.slot] || a.slot;
          if (a.url) { var ln = el('a', '', nomeArq); ln.href = a.url; ln.target = '_blank'; ln.rel = 'noopener noreferrer'; li.appendChild(ln); } else li.appendChild(document.createTextNode(nomeArq));
          if (a.em) li.appendChild(el('span', 'jor-nota', ' · ' + dataBr(a.em)));
          ul.appendChild(li);
        });
        lista.replaceWith(ul);
      });
    }
    alvo.replaceChildren(raiz);
  }

  /** Linha só da planilha (sem card): abre por código, só para leitura. */
  function abrirPlanilha(codigo) {
    injetarCss();
    var c = corpo(); if (!c) return;
    sairDaObra(); O.card = null;
    var no = el('div'); no.id = 'jor-obra'; no.appendChild(el('p', 'jor-nota', 'Carregando…'));
    c.replaceChildren(no);
    api('/gerador/jornada-solar/planilha/' + encodeURIComponent(codigo), 'GET').then(function (r) {
      if (!no.isConnected) return;
      if (r.status === 200 && r.json && r.json.abrir_card) { abrirObra(r.json.abrir_card); return; }
      if (r.status === 200 && r.json && r.json.ok !== false && r.json.finalizada) { desenharFinalizada(r.json, no, null); return; }
      no.replaceChildren(el('p', 'jor-erro', msgDe(r, 'Não consegui abrir esta venda agora.')), btn('Voltar para Clientes', '', abrirLista));
    });
  }

  function releia() {
    if (O.debounce) clearTimeout(O.debounce);
    O.debounce = setTimeout(function () { O.debounce = 0; if (O.card) carregarObra(); }, 400);
  }

  function montarQuadro() {
    var d = O.dados; if (!d || !O.vdcNo || typeof vdcDetalhe !== 'function') return;
    var semTrello = atualEtapa() !== 3;
    var chave = O.card + ':' + (semTrello ? 'sem' : 'com');
    if (O.vdcChave === chave) return;
    if (O.vdcChave && typeof vdcFechar === 'function') vdcFechar(O.vdcNo);
    O.vdcChave = chave;
    vdcDetalhe({ id: d.card.id, status: 'fechou', created_by: d.card.created_by, cliente_nome: d.card.cliente, cliente_telefone: '', cidade: d.card.cidade, vendedor_nome: d.card.vendedor },
      { alvo: O.vdcNo, semFechamento: true, semTrello: semTrello, aoMudar: releia });
    O.vdcNo.hidden = false;
  }

  /** Anexo: o mesmo componente em todo lugar. Chama o vdcAnexar do quadro montado embaixo. */
  function anexo(chave, rotulo, tem) {
    var linha = el('div', 'jor-anexo');
    linha.appendChild(el('span', 'jor-rot', rotulo));
    var est = el('span', 'jor-est' + (tem ? ' ok' : ''), tem ? 'Anexado' : 'Falta');
    if (tem) est.insertBefore(icone('ok'), est.firstChild);
    linha.appendChild(est);
    function entrada(rot, aceita, camera) {
      var lab = el('label', 'jor-btn', rot);
      var inp = el('input'); inp.type = 'file'; inp.accept = aceita; inp.style.display = 'none'; if (camera) inp.setAttribute('capture', 'environment');
      inp.setAttribute('aria-label', rot + ': ' + rotulo);
      inp.addEventListener('change', function () {
        var arqs = Array.prototype.slice.call(inp.files || []); inp.value = '';
        if (!arqs.length) return;
        var st = (typeof vdcEst !== 'undefined') ? vdcEst : null;
        if (!st || String(st.id) !== String(O.card) || st.carregando || typeof window.vdcAnexar !== 'function') { toast('Abra o quadro Documentos e cadastro, logo abaixo, e tente de novo.'); return; }
        Promise.resolve(window.vdcAnexar(st, { chave: chave }, arqs)).then(releia);
      });
      lab.appendChild(inp); lab.tabIndex = 0;
      return lab;
    }
    add(linha, entrada('Foto', 'image/*', true), entrada('Arquivo', 'image/*,application/pdf', false), entrada('Print', 'image/*', false));
    return linha;
  }

  function blocoTitulo(t, itens) {
    var falta = itens ? itens.filter(function (i) { return !i.feito; }).length : 0;
    var h = el('div', 'jor-bloco-t'); h.appendChild(el('span', '', t));
    if (itens) h.appendChild(el('em', falta ? '' : 'ok', falta ? 'falta ' + falta : 'completo'));
    return h;
  }

  /** A etapa da vez: a do fase2 (que conhece as etapas 4 a 8) quando ele respondeu; senão a da Fase 1. */
  function atualEtapa() {
    if (O.fase2 && Array.isArray(O.fase2.etapas) && typeof O.fase2.etapa_atual === 'number') return O.fase2.etapa_atual;
    return (O.dados && O.dados.etapa_atual) || 0;
  }
  /** As 9 etapas: 1 a 3 e a 9 da Fase 1; 4 a 8 do fase2 (por n), quando ele respondeu. */
  function etapasMescladas() {
    var d = O.dados; var f2 = O.fase2;
    return d.etapas.map(function (e) {
      if (e.n < 4 || e.n > 8 || !f2) return e;
      var x = f2.etapas.filter(function (y) { return y.n === e.n; })[0];
      return x ? Object.assign({}, e, x) : e;
    });
  }

  function desenharObra() {
    var d = O.dados; var n = O.obraNo; if (!d || !n) return;
    var raiz = el('div');
    // Cabeçalho
    var cab = el('div', 'jor-cab');
    cab.appendChild(el('span', 'jor-num', d.codigo || '*'));
    var t = el('div', 'jor-cab-t'); t.appendChild(el('b', '', d.card.cliente));
    var vend = d.etapas[0] && d.etapas[0].dono && d.etapas[0].dono[0] ? nomeBonito(d.etapas[0].dono[0].nome) : nomeBonito(d.card.vendedor);
    t.appendChild(el('span', '', [d.card.cidade, 'Vendido por ' + (nomeBonito(d.card.vendedor) || vend)].filter(Boolean).join(' · ')));
    cab.appendChild(t);
    if (atualEtapa()) cab.appendChild(el('span', 'jor-pilula', 'Etapa ' + atualEtapa() + ' de 9'));
    add(cab, btn('Clientes', '', abrirLista));
    if (O.dinheiro && O.dinheiro.visivel !== false && O.dinheiro.livro && window.Jornada.dinheiro) add(cab, btn('Dinheiro', '', function () { window.Jornada.dinheiro.abrirLivro(); }));
    if (d.pode.cancelar) add(cab, btn('Venda cancelada', 'jor-btn-link', function () { cancelarDialogo(O.card, carregarObra); }));
    raiz.appendChild(cab);
    if (window.Jornada.dinheiro && window.Jornada.dinheiro.faixa) window.Jornada.dinheiro.faixa(raiz, O.dinheiro);
    if (d.cancelada) {
      var fx = el('div', 'jor-faixa', 'Venda cancelada em ' + ddmm(d.cancelada.em) + ' por ' + nomeBonito(d.cancelada.por) + '. Motivo: ' + (d.cancelada.motivo || ''));
      if (d.pode.descancelar) fx.appendChild(btn('Desfazer o cancelamento', '', function () { desfazerDialogo(); }));
      raiz.appendChild(fx);
    }
    if (d.aviso) raiz.appendChild(el('p', 'jor-aviso', d.aviso));
    // Régua
    var atual = atualEtapa();
    if (O.painel === null) O.painel = (atual >= 1 && atual <= 9) ? atual : 1;
    var ets = etapasMescladas();
    var reg = el('div', 'jor-regua');
    ets.forEach(function (e) {
      var feita = !!e.concluida_em || (atual > e.n);
      var davez = e.n === atual;
      var b = el('button', 'jor-passo ' + (feita ? 'feita' : davez ? 'davez' : 'futura') + (O.painel === e.n ? ' sel' : '')); b.type = 'button';
      var tt = el('b'); tt.appendChild(feita ? icone('ok') : (!davez ? icone('lock') : document.createTextNode('')));
      tt.appendChild(document.createTextNode(e.n + ' ' + e.curto)); b.appendChild(tt);
      b.appendChild(el('small', '', (e.dono || []).map(function (x) { return x.iniciais; }).join(' ')));
      var gp = window.Jornada.dinheiro && window.Jornada.dinheiro.gastoDaRegua ? window.Jornada.dinheiro.gastoDaRegua(O.dinheiro, e.n, atual) : '';
      if (gp) b.appendChild(el('small', 'jor-passo-gasto', gp));
      if (e.n === 9 && atual < 9) { b.setAttribute('aria-disabled', 'true'); }
      else if (e.n > 3 && !O.fase2) { b.title = 'Não consegui ler esta parte agora.'; b.setAttribute('aria-disabled', 'true'); }
      else if (e.n > atual) { b.setAttribute('aria-disabled', 'true'); }
      else {
        b.addEventListener('click', function () { O.painel = e.n; desenharObra(); });
      }
      reg.appendChild(b);
    });
    raiz.appendChild(reg);
    // Duas colunas
    var et = ets[(O.painel || 1) - 1];
    var f2 = O.fase2; var f2et = et.n >= 4 && et.n <= 8;
    var cols = el('div', 'jor-cols'); var esq = el('div', 'jor-esq'); var dir = el('div', 'jor-dir');
    var titulo = el('h3', '', 'Etapa ' + et.n + ' · ' + et.nome);
    esq.appendChild(titulo);
    var donos = (et.dono || []).map(function (x) { return x.iniciais + ' ' + nomeBonito(x.nome); }).join(', ');
    esq.appendChild(el('p', 'jor-nota', 'Dono: ' + donos));
    if (O.vdcDet && O.vdcPainel !== et.n) { O.vdcPainel = et.n; O.vdcDet.open = et.n <= 3; }
    if (et.n === 1) etapa1(esq, d, et); else if (et.n === 2) etapa2(esq, d, et); else if (et.n === 3) etapa3(esq, d, et);
    else if (et.n === 9 && window.Jornada.etapas[9]) window.Jornada.etapas[9](esq, d, et, O.fase3);
    else if (f2 && window.Jornada.etapas[et.n]) window.Jornada.etapas[et.n](esq, d, et, f2);
    else if (f2et) { var pf = el('div', 'jor-bloco'); pf.appendChild(el('p', 'jor-erro', 'Não consegui ler esta parte agora.')); pf.appendChild(btn('Tentar de novo', '', carregarObra)); esq.appendChild(pf); }
    if (et.n === 1 && window.Jornada.extras.vistoria) window.Jornada.extras.vistoria(esq, d);
    if (et.n === 2 && window.Jornada.extras.banco) window.Jornada.extras.banco(esq, d);
    if (et.n === 2 && window.Jornada.extras.indicacao) window.Jornada.extras.indicacao(esq, d, O.fase3);
    if (et.n <= 8 && window.Jornada.dinheiro && window.Jornada.dinheiro.gastosDaEtapa && (et.n <= 3 || f2)) window.Jornada.dinheiro.gastosDaEtapa(esq, et.n, O.dinheiro);
    // Portão
    if (et.n <= 3 || (f2et && f2)) {
      var pt = el('div', 'jor-portao'); pt.appendChild(el('b', '', 'Para concluir'));
      var ul = el('ul', 'jor-itens');
      et.itens.forEach(function (i) {
        var li = el('li', i.feito ? 'ok' : 'falta'); li.appendChild(i.feito ? icone('ok') : icone('lock')); li.appendChild(el('span', '', i.texto)); ul.appendChild(li);
      });
      pt.appendChild(ul);
      var concluida = !!et.concluida_em;
      var podeLista = et.n <= 3 ? d.pode.concluir : ((f2 && f2.pode && f2.pode.concluir) || []);
      var pode = podeLista.indexOf(et.n) >= 0 && et.falta === 0 && !concluida;
      var bc = btn(concluida ? 'Etapa concluída' : (et.n === 8 ? 'Finalizar a obra' : 'Concluir etapa'), 'jor-btn-pri', function () { concluir(et.n, bc); });
      bc.disabled = !pode; bc.style.marginTop = '10px';
      pt.appendChild(bc);
      if (!concluida && et.falta > 0) {
        pt.appendChild(el('p', 'jor-nota', 'Falta ' + plural(et.falta, 'item', 'itens') + ': ' + et.itens.filter(function (i) { return !i.feito; }).map(function (i) { return i.texto; }).join(', ') + '.'));
      }
      var prox = ets[et.n];
      if (prox && et.n !== 3 && et.n !== 8) pt.appendChild(el('p', 'jor-nota', 'Ao concluir: abre ' + prox.nome + ' e ' + (prox.dono || []).map(function (x) { return nomeBonito(x.nome); }).join(' e ') + ' fica com ela.'));
      if (et.n === 2) pt.appendChild(el('p', 'jor-nota', 'Entrada, financiamento e comissões não travam esta etapa.'));
      if (et.n === 3) pt.appendChild(el('p', 'jor-nota', 'Ao concluir: abre Compra (Thiago e Diego).'));
      if (et.n === 8) pt.appendChild(el('p', 'jor-nota', 'Fechada, a conta trava. Só o Thiago reabre, com motivo.'));
      esq.appendChild(pt);
      if (O.msg) { var mm = el('p', 'jor-erro', O.msg); mm.setAttribute('role', 'status'); esq.appendChild(mm); }
    }
    // Prazo e cobrança
    var pz = el('div', 'jor-bloco'); pz.appendChild(el('div', 'jor-bloco-t', 'Prazo e cobrança'));
    if (et.prazo && et.prazo.vence) pz.appendChild(el('p', '', et.prazo.rotulo + ' · ' + ddmm(et.prazo.vence)));
    var sit = et.situacao || { tipo: 'sem_prazo', texto: '' };
    var sp = el('p', sit.tipo === 'atrasada' || sit.tipo === 'travada' ? 'jor-erro' : sit.tipo === 'no_prazo' || sit.tipo === 'vence_hoje' ? 'jor-ok' : '', sit.texto); pz.appendChild(sp);
    var esp = et.n <= 3 ? d.esperando : (f2 ? f2.esperando : null);
    var podeEsp = et.n <= 3 ? d.pode.esperar : !!(f2 && f2.pode && f2.pode.esperar);
    if (esp && esp.etapa === et.n) {
      pz.appendChild(el('p', '', 'Esperando até ' + ddmm(esp.ate) + ' · ' + nomeBonito(esp.motivo)));
      if (podeEsp) pz.appendChild(btn('Voltar a cobrar', '', function () { esperar({ voltar: true }, et.n); }));
    } else if (podeEsp && et.n <= 8 && !et.concluida_em) {
      pz.appendChild(btn('Esperando', '', function () { esperarDialogo(et.n); }));
    }
    if (window.Jornada.extras.avisos) window.Jornada.extras.avisos(pz, O.fase3, et.n);
    dir.appendChild(pz);
    add(cols, esq, dir); raiz.appendChild(cols);
    n.replaceChildren(raiz);
  }

  function concluir(etapa, botao) {
    botao.disabled = true; O.msg = '';
    api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + (etapa >= 4 ? '/etapa-obra' : '/etapa'), 'POST', { etapa: etapa }, 200000).then(function (r) {
      if (r.status === 200 && r.json.ok !== false) {
        O.painel = null;
        var num = r.json.numero;
        if (etapa === 2 && num && num.ok === false) toast('Etapa concluída. O número da obra ainda não saiu: use Tentar o número de novo.');
        else toast(etapa === 8 ? 'Obra finalizada.' : 'Etapa concluída.');
        if (etapa === 8 && window.Jornada.extras.bookPdf) window.Jornada.extras.bookPdf(O.card, null, { silencioso: true });
        carregarObra();
      } else { O.msg = msgDe(r, 'Não consegui concluir agora.'); botao.disabled = false; desenharObra(); }
    });
  }
  function esperar(corpoPedido, etapa) {
    api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + (etapa >= 4 ? '/esperar-obra' : '/esperar'), 'POST', corpoPedido).then(function (r) {
      if (r.status === 200 && r.json.ok !== false) { carregarObra(); return; }
      toast(msgDe(r, 'Não consegui agora. Tente de novo.'));
    });
  }
  function esperarDialogo(etapa) {
    dialogo('Esperando', function (c) {
      var m = el('select', 'jor-sel'); m.setAttribute('aria-label', 'Motivo');
      [['cliente', 'Cliente'], ['cemig', 'Cemig'], ['fornecedor', 'Fornecedor'], ['banco', 'Banco']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; m.appendChild(op); });
      var dt = el('input', 'jor-in'); dt.type = 'date'; dt.setAttribute('aria-label', 'Até quando');
      var hoje = O.dados && O.dados.hoje; if (hoje) dt.min = hoje;
      add(c, el('label', 'jor-nota', 'Motivo'), m, el('label', 'jor-nota', 'Até quando'), dt);
      var info = el('p', 'jor-erro'); c.appendChild(info);
      return { foco: m };
    }, 'Salvar', function (b, c) {
      var m = c.querySelector('select').value; var dt = c.querySelector('input').value; var info = c.querySelector('.jor-erro');
      if (!dt) { info.textContent = 'Escolha a data.'; return; }
      b.disabled = true;
      api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + (etapa >= 4 ? '/esperar-obra' : '/esperar'), 'POST', { motivo: m, ate: dt }).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { fecharDlg(); carregarObra(); return; }
        b.disabled = false; info.textContent = msgDe(r, 'Não consegui agora.');
      });
    });
  }
  function cancelarDialogo(card, depois) {
    dialogoMotivo('Venda cancelada', 'Salvar', function (motivo) {
      return api('/gerador/jornada-solar/obra/' + encodeURIComponent(card) + '/cancelar', 'POST', { motivo: motivo }).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { if (depois) depois(); return { ok: true }; }
        return { ok: false, erro: msgDe(r, 'Não consegui cancelar agora.') };
      });
    });
  }
  function desfazerDialogo() {
    dialogoMotivo('Desfazer o cancelamento', 'Salvar', function (motivo) {
      return api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/descancelar', 'POST', { motivo: motivo }).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { carregarObra(); return { ok: true }; }
        return { ok: false, erro: msgDe(r, 'Não consegui agora.') };
      });
    });
  }

  // ── Etapa 1 ─────────────────────────────────────────────────────────────────
  function itensDoBloco(et, bloco) { return et.itens.filter(function (i) { return i.bloco === bloco; }); }

  function formVenda(pai, d, onSalvo) {
    var v = d.venda || { valor_centavos: 0, pagamento: [], desconto_centavos: null, prazo_prometido: '', nota: '', kit_confirmado: false };
    var f = el('div'); var info = el('p', 'jor-erro'); info.setAttribute('role', 'status');
    var kit = el('input'); kit.type = 'checkbox'; kit.checked = !!v.kit_confirmado;
    var lk = el('label', 'jor-nota'); lk.appendChild(kit); lk.appendChild(document.createTextNode(' Kit confirmado'));
    var valor = el('input', 'jor-in'); valor.type = 'text'; valor.inputMode = 'decimal'; valor.setAttribute('aria-label', 'Valor vendido'); valor.value = v.valor_centavos ? (v.valor_centavos / 100).toFixed(2).replace('.', ',') : '';
    var desc = el('input', 'jor-in'); desc.type = 'text'; desc.inputMode = 'decimal'; desc.setAttribute('aria-label', 'Desconto dado'); desc.value = v.desconto_centavos ? (v.desconto_centavos / 100).toFixed(2).replace('.', ',') : '';
    var prazo = el('input', 'jor-in'); prazo.type = 'text'; prazo.maxLength = 200; prazo.setAttribute('aria-label', 'Prazo prometido ao cliente'); prazo.value = v.prazo_prometido || '';
    var nota = el('textarea', 'jor-ta'); nota.maxLength = 500; nota.setAttribute('aria-label', 'Nota da negociação'); nota.value = v.nota || '';
    var grade = el('div', 'jor-grade');
    function campo(rot, ctl) { var l = el('label', '', rot); l.appendChild(ctl); return l; }
    add(grade, campo('Valor vendido', valor), campo('Desconto dado', desc), campo('Prazo prometido ao cliente', prazo));
    var pgBox = el('div'); var linhas = [];
    function cents(txt) {
      if (typeof Financeiro === 'undefined' || typeof Financeiro.centavosDeTexto !== 'function') { var n = Number(String(txt).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) : NaN; }
      return Financeiro.centavosDeTexto(txt);
    }
    function addLinha(p) {
      var row = el('div', 'jor-pg');
      var fs = el('select', 'jor-sel'); fs.setAttribute('aria-label', 'Forma de pagamento');
      [['pix', 'Pix'], ['ted', 'TED'], ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['financiamento', 'Financiamento'], ['dinheiro', 'Dinheiro']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; fs.appendChild(op); });
      fs.value = p ? p.forma : 'pix';
      var vl = el('input', 'jor-in'); vl.type = 'text'; vl.inputMode = 'decimal'; vl.setAttribute('aria-label', 'Valor desta forma'); vl.value = p ? (p.valor_centavos / 100).toFixed(2).replace('.', ',') : '';
      var ob = el('input', 'jor-in'); ob.type = 'text'; ob.maxLength = 60; ob.setAttribute('aria-label', 'Observação'); ob.placeholder = 'Observação curta'; ob.value = p ? p.obs : '';
      add(row, fs, vl, ob); pgBox.appendChild(row);
      var ref = { fs: fs, vl: vl, ob: ob }; linhas.push(ref);
      [fs, vl, ob].forEach(function (x) { x.addEventListener('input', recalc); });
    }
    (v.pagamento.length ? v.pagamento : [null]).forEach(addLinha);
    var mais = btn('Mais uma forma', '', function () { if (linhas.length < 6) { addLinha(null); recalc(); } });
    var salvar = btn('Salvar', 'jor-btn-pri', function () {
      salvar.disabled = true; info.textContent = '';
      var pedido = {
        valor_centavos: cents(valor.value), kit_confirmado: kit.checked, prazo_prometido: prazo.value.trim(), nota: nota.value.trim(),
        desconto_centavos: desc.value.trim() ? cents(desc.value) : null,
        pagamento: linhas.map(function (l) { return { forma: l.fs.value, valor_centavos: cents(l.vl.value), obs: l.ob.value.trim() }; }),
      };
      api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/venda', 'PUT', pedido).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { if (r.json.aviso) toast(r.json.aviso); toast('Valor salvo.'); onSalvo(); } else { salvar.disabled = false; info.textContent = msgDe(r, 'Não consegui salvar agora.'); }
      });
    });
    function recalc() {
      var tot = cents(valor.value); var soma = 0; var ok = tot > 0;
      linhas.forEach(function (l) { var c = cents(l.vl.value); if (!(c > 0)) ok = false; else soma += c; });
      salvar.disabled = !(ok && soma === tot);
      info.textContent = tot > 0 && soma !== tot && soma > 0 ? 'As formas somam ' + reais(soma) + '. O valor vendido é ' + reais(tot) + '.' : '';
    }
    valor.addEventListener('input', recalc);
    recalc();
    add(f, lk, grade, el('div', 'jor-nota', 'Forma de pagamento'), pgBox, mais, el('label', 'jor-nota', 'Nota da negociação'), nota, info, salvar);
    pai.appendChild(f);
  }

  function etapa1(esq, d, et) {
    var concluida = !!et.concluida_em;
    // 1. Venda
    var b1 = el('div', 'jor-bloco'); b1.appendChild(blocoTitulo('Venda', itensDoBloco(et, 'venda')));
    if (d.proposta) {
      var pp = el('p', '', 'Veio do card · ' + d.proposta.codigo + ' · ' + d.proposta.cliente + (d.proposta.kwp ? ' · ' + String(d.proposta.kwp).replace('.', ',') + ' kWp' : ''));
      pp.appendChild(el('span', 'jor-auto', 'Automático')); b1.appendChild(pp);
    } else if (d.pode.ligar_proposta && d.propostas_candidatas && d.propostas_candidatas.length) {
      b1.appendChild(el('p', 'jor-nota', 'Propostas deste cliente:'));
      d.propostas_candidatas.forEach(function (p) {
        var li = el('div', 'jor-anexo'); li.appendChild(el('span', 'jor-rot', p.codigo + ' · ' + p.cliente + (p.kwp ? ' · ' + String(p.kwp).replace('.', ',') + ' kWp' : '') + (p.data ? ' · ' + ddmm(p.data) : '')));
        li.appendChild(btn('Ligar', '', function () {
          api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/proposta', 'POST', { codigo: p.codigo }).then(function (r) {
            if (r.status === 200 && r.json.ok !== false) carregarObra(); else toast(msgDe(r, 'Não consegui ligar agora.'));
          });
        }));
        b1.appendChild(li);
      });
    } else if (!concluida) {
      b1.appendChild(el('p', 'jor-nota', 'Ligue a proposta no quadro Documentos e cadastro, em Ligações.'));
    }
    if (concluida) {
      var vv = d.venda;
      if (vv) {
        b1.appendChild(el('p', '', 'Valor ' + reais(vv.valor_centavos) + ' · ' + vv.pagamento.map(function (x) { return x.forma + ' ' + reais(x.valor_centavos); }).join(', ')));
        b1.appendChild(el('p', 'jor-nota', 'Combinado por ' + nomeBonito(vv.combinado_por) + ' em ' + ddmm(String(vv.combinado_em).slice(0, 10)) + '. Edite na etapa 2.'));
      }
    } else if (d.pode.editar_venda) {
      formVenda(b1, d, carregarObra);
    }
    var com = (d.comissoes || []).filter(function (x) { return x.papel === 'venda'; })[0];
    if (com && com.nome === (d.etapas[0].dono[0] && d.etapas[0].dono[0].nome) && d.pode.editar_venda) {
      b1.appendChild(el('p', 'jor-nota', 'Sua comissão: ' + (com.pb / 100) + '% · ' + reais(com.valor_centavos)));
    }
    esq.appendChild(b1);
    // 2. Fotos
    var b2 = el('div', 'jor-bloco'); b2.appendChild(blocoTitulo('Fotos da vistoria', itensDoBloco(et, 'fotos')));
    [['fachada', 'Foto da fachada'], ['padrao', 'Foto do padrão de entrada'], ['disjuntor', 'Foto do disjuntor'], ['medidor', 'Foto do medidor']].forEach(function (x) { b2.appendChild(anexo(x[0], x[1], !!d.slots[x[0]])); });
    b2.appendChild(el('p', 'jor-nota', 'As outras fotos e os dados do local ficam no quadro abaixo.'));
    esq.appendChild(b2);
    // 3. Documentos
    var b3 = el('div', 'jor-bloco'); b3.appendChild(blocoTitulo('Documentos', itensDoBloco(et, 'documentos')));
    b3.appendChild(anexo('conta_luz', 'Conta de luz', !!d.slots.conta_luz));
    b3.appendChild(anexo('documento_titular', 'CNH ou documento com foto', !!d.slots.documento));
    b3.appendChild(el('p', d.documentos.email ? 'jor-nota' : 'jor-erro', d.documentos.email ? 'E-mail: ' + d.documentos.email : 'Falta o e-mail: preencha no quadro abaixo.'));
    var q = el('div'); q.appendChild(el('b', '', 'Tem excedente para outras contas?'));
    var qs = el('div', 'jor-filtros');
    [['sim', 'Sim'], ['nao', 'Não']].forEach(function (o) {
      var b = el('button', 'jor-chip' + (d.excedente === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !d.pode.marcar_excedente;
      b.addEventListener('click', function () {
        api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card), 'PATCH', { excedente: o[0] }).then(function (r) {
          if (r.status === 200 && r.json.ok !== false) carregarObra(); else toast(msgDe(r, 'Não consegui agora.'));
        });
      });
      qs.appendChild(b);
    });
    q.appendChild(qs); b3.appendChild(q);
    if (d.excedente === 'sim') {
      d.documentos.beneficiarias.forEach(function (b) {
        var li = el('p', b.mesmo_titular ? 'jor-ok' : 'jor-erro');
        li.textContent = 'UC ' + b.uc + ' · ' + (b.titular || 'sem titular') + ' · ' + (b.mesmo_titular ? 'Mesmo titular' : 'Titular diferente. Todas as contas precisam estar no nome de ' + d.documentos.titular_geradora + '. Troque a titularidade na Cemig ou tire esta conta no quadro abaixo.');
        b3.appendChild(li);
      });
    }
    esq.appendChild(b3);
  }

  // ── Etapa 2 ─────────────────────────────────────────────────────────────────
  function empresaDoAparelho() {
    var e = (typeof epEmitGet === 'function') ? (epEmitGet('aioros') || {}) : {};
    return {
      endereco: e.end, telefone: e.tel, socio_adm: e.socio,
      engenheiro_nome: e.engNome, engenheiro_cpf: e.engCpf, engenheiro_crea: e.engCrea, engenheiro_rg: e.engRg, engenheiro_nacionalidade: e.engNac,
      engenheiro_estado_civil: e.engEc, engenheiro_profissao: e.engProf, engenheiro_endereco: e.engEnd,
      tecnico_nome: e.tecNome, tecnico_cpf: e.tecCpf, tecnico_rg: e.tecRg, tecnico_crt_cft: e.tecCrt, tecnico_nacionalidade: e.tecNac,
      tecnico_estado_civil: e.tecEc, tecnico_endereco: e.tecEnd, pix: e.pix, conta: e.conta,
    };
  }
  function limparEmpresa(o) { var r = {}; Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string' && o[k].trim()) r[k] = o[k].trim().slice(0, 160); }); return r; }

  function gerarPapel(tipo, extra, botao) {
    var pedido = { tipo: tipo, empresa: limparEmpresa(empresaDoAparelho()) };
    Object.keys(extra || {}).forEach(function (k) { pedido[k] = extra[k]; });
    botao.disabled = true; O.msg = '';
    return api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/papel', 'POST', pedido, 30000).then(function (r) {
      botao.disabled = false;
      if (r.status === 200 && r.json.ok !== false) { imprimir(r.json.conteudo, r.json.formato, r.json.titulo); carregarObra(); return { ok: true }; }
      var m = msgDe(r, 'Não consegui gerar agora.');
      toast(m); return { ok: false, erro: m };
    });
  }

  function reciboDialogo(d, botao) {
    var pg0 = d.venda && d.venda.pagamento && d.venda.pagamento[0];
    var hoje = d.hoje;
    dialogo('Recibo', function (c) {
      var num = el('input', 'jor-in'); num.type = 'text'; num.maxLength = 40; num.setAttribute('aria-label', 'Número do recibo');
      num.value = (d.codigo ? d.codigo.replace('#', '') : 'S/N') + '/' + String(hoje).slice(0, 4);
      var forma = el('select', 'jor-sel'); forma.setAttribute('aria-label', 'Forma');
      [['pix', 'Pix'], ['ted', 'TED'], ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['financiamento', 'Financiamento'], ['dinheiro', 'Dinheiro']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; forma.appendChild(op); });
      forma.value = pg0 ? pg0.forma : 'pix';
      var data = el('input', 'jor-in'); data.type = 'date'; data.value = hoje; data.setAttribute('aria-label', 'Data do pagamento');
      var val = el('input', 'jor-in'); val.type = 'text'; val.inputMode = 'decimal'; val.setAttribute('aria-label', 'Valor pago'); val.value = pg0 ? (pg0.valor_centavos / 100).toFixed(2).replace('.', ',') : '';
      var info = el('p', 'jor-erro'); info.setAttribute('role', 'status');
      add(c, el('label', 'jor-nota', 'Número do recibo'), num, el('label', 'jor-nota', 'Pagamento'), forma, data, val, info);
      return { foco: val };
    }, 'Gerar', function (b, c) {
      var ins = c.querySelectorAll('input'); var sel = c.querySelector('select'); var info = c.querySelector('.jor-erro');
      var txt = ins[2].value; var cent = (typeof Financeiro !== 'undefined' && Financeiro.centavosDeTexto) ? Financeiro.centavosDeTexto(txt) : Math.round(Number(String(txt).replace(/\./g, '').replace(',', '.')) * 100);
      if (!(cent > 0)) { info.textContent = 'Diga o valor pago.'; return; }
      b.disabled = true;
      gerarPapel('recibo', { recibo: { numero: ins[0].value.trim(), pagamentos: [{ forma: sel.value, data: ins[1].value, valor_centavos: cent }] } }, botao).then(function (r) {
        if (r.ok) fecharDlg(); else { b.disabled = false; info.textContent = r.erro; }
      });
    });
  }

  function etapa2(esq, d, et) {
    var vend = nomeBonito(d.card.vendedor) || 'o vendedor';
    var e1 = d.etapas[0];
    var b1 = el('div', 'jor-bloco'); b1.appendChild(el('div', 'jor-bloco-t', 'Tudo que ' + vend + ' juntou'));
    [['venda', 'Venda'], ['fotos', 'Fotos da vistoria'], ['documentos', 'Documentos']].forEach(function (x) {
      var li = el('p', 'jor-ok'); li.appendChild(icone('ok')); li.appendChild(document.createTextNode(' ' + x[1] + ': completo')); b1.appendChild(li);
    });
    void e1;
    esq.appendChild(b1);
    var b2 = el('div', 'jor-bloco'); b2.appendChild(el('div', 'jor-bloco-t', 'Valor e pagamento'));
    var vv = d.venda;
    if (vv) {
      b2.appendChild(el('p', '', reais(vv.valor_centavos) + ' · ' + vv.pagamento.map(function (x) { return x.forma + ' ' + reais(x.valor_centavos) + (x.obs ? ' (' + x.obs + ')' : ''); }).join(', ')));
      b2.appendChild(el('p', 'jor-nota', 'Combinado por ' + nomeBonito(vv.combinado_por) + ' em ' + ddmm(String(vv.combinado_em).slice(0, 10)) + '.'));
    }
    if (d.pode.editar_venda) {
      var box = el('div'); box.hidden = true;
      var ed = btn('Editar', '', function () { box.hidden = !box.hidden; });
      b2.appendChild(ed); formVenda(box, d, carregarObra); b2.appendChild(box);
    }
    esq.appendChild(b2);
    // Papéis
    var b3 = el('div', 'jor-bloco'); b3.appendChild(el('div', 'jor-bloco-t', 'Papéis'));
    function linhaPapel(rot, tipo, chaveAssinado, extraCtl, gerarFn) {
      var l = el('div', 'jor-anexo'); l.appendChild(el('span', 'jor-rot', rot));
      var gp = d.papeis && d.papeis[tipo];
      if (extraCtl) l.appendChild(extraCtl);
      var g = btn('Gerar', '', function () { gerarFn(g); }); g.disabled = !d.pode.gerar_papeis; l.appendChild(g);
      if (gp) l.appendChild(el('span', 'jor-est ok', 'Gerado em ' + ddmm(String(gp.gerado_em).slice(0, 10))));
      b3.appendChild(l);
      if (chaveAssinado) b3.appendChild(anexo(chaveAssinado[0], chaveAssinado[1], !!d.slots[chaveAssinado[0]]));
    }
    linhaPapel('Contrato', 'contrato', ['contrato_assinado', 'Contrato assinado'], null, function (g) { gerarPapel('contrato', {}, g); });
    var mod = el('select', 'jor-sel'); mod.setAttribute('aria-label', 'Modelo da procuração');
    [['1', 'Padrão'], ['2', 'Jurídico'], ['3', 'Concessionária e ANEEL']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; mod.appendChild(op); });
    linhaPapel('Procuração', 'procuracao', ['procuracao', 'Procuração assinada'], mod, function (g) { gerarPapel('procuracao', { modelo: Number(mod.value) }, g); });
    linhaPapel('Recibo', 'recibo', null, null, function (g) { reciboDialogo(d, g); });
    b3.appendChild(el('p', 'jor-nota', 'Colha a assinatura do cliente e anexe aqui o papel assinado.'));
    esq.appendChild(b3);
    // Número
    var b4 = el('div', 'jor-bloco'); var tt = el('div', 'jor-bloco-t', 'Número da obra'); tt.appendChild(el('span', 'jor-auto', 'Automático')); b4.appendChild(tt);
    var ne = d.numero.estado;
    if (ne === 'tem') b4.appendChild(el('p', 'jor-ok', 'Nasceu ' + d.numero.codigo + ', com o contrato e a procuração assinados.'));
    else if (ne === 'cancelada') b4.appendChild(el('p', 'jor-nota', 'Venda cancelada não ganha número.'));
    else if (ne === 'falta_papeis') b4.appendChild(el('p', 'jor-nota', 'Nasce quando o contrato e a procuração assinados estiverem anexados.'));
    else if (ne === 'pronto' || ne === 'falhou') {
      var motivos = { trello: 'o Trello não respondeu', trello_grande: 'o quadro do Trello é grande demais', lento: 'o Trello está lento', ocupado: 'outra pessoa estava gravando', sem_credencial: 'falta a chave do Trello', sem_segredo: 'falta a chave de assinatura', banco: 'o banco não respondeu', sequencia: 'a sequência acabou' };
      b4.appendChild(el('p', 'jor-erro', ne === 'falhou' ? 'Não consegui dar o número agora (' + (motivos[d.numero.motivo] || 'tente de novo') + ').' : 'Os dois papéis assinados estão anexados. O número ainda não saiu.'));
      if (d.pode.numero) {
        var bn = btn('Tentar o número de novo', '', function () { tentarNumero(false, bn); }); b4.appendChild(bn);
      }
    } else if (ne === 'confirmar') {
      if (d.pode.numero_novo) {
        b4.appendChild(el('p', 'jor-aviso', 'Pode já estar na planilha.'));
        (d.numero.candidatos || []).forEach(function (cd) { b4.appendChild(el('p', 'jor-nota', cd.codigo + ' · ' + cd.cliente)); });
        var bnn = btn('Criar o número novo', '', function () { tentarNumero(true, bnn); }); b4.appendChild(bnn);
        b4.appendChild(btn('Ligar a venda antiga', '', function () { if (O.vdcNo) O.vdcNo.scrollIntoView({ behavior: 'smooth' }); }));
      } else b4.appendChild(el('p', 'jor-nota', 'O Thiago confere a planilha antes de dar o número.'));
    }
    esq.appendChild(b4);
    // Comissões
    if (window.Jornada.dinheiro && window.Jornada.dinheiro.blocoComissoes) { window.Jornada.dinheiro.blocoComissoes(esq, d, O.dinheiro); return; }
    var b5 = el('div', 'jor-bloco'); b5.appendChild(el('div', 'jor-bloco-t', 'Comissões'));
    if (d.comissoes && d.comissoes.length) {
      b5.appendChild(el('p', '', 'Vendeu: ' + nomeBonito(d.card.vendedor)));
      d.comissoes.forEach(function (x) {
        b5.appendChild(el('p', 'jor-nota', nomeBonito(x.nome) + ' · ' + (x.papel === 'venda' ? 'venda' : 'sócio') + ' ' + (x.pb / 100) + '% · ' + reais(x.valor_centavos) + ' · ' + (x.onde === 'custo' ? 'custo da obra' : 'retirada')));
      });
      if (d.comissoes_aviso) b5.appendChild(el('p', 'jor-aviso', d.comissoes_aviso));
    }
    var rg = el('table', 'jor-tbl'); var th = el('tr'); ['Quem vendeu', 'Quem vendeu', 'Sócios'].forEach(function () { }); rg.appendChild(th);
    [['Nilce', '5% custo · Thiago 2% · Diego 2%'], ['Diego', '5% custo · Diego 2% · Thiago 2%'], ['Thiago', '5% custo · Thiago 2% · Diego 2%'], ['Giovanna', '3% custo · Thiago 2% · Diego 2%']].forEach(function (x) {
      var tr = el('tr'); tr.appendChild(el('td', '', x[0])); tr.appendChild(el('td', '', x[1])); rg.appendChild(tr);
    });
    b5.appendChild(el('div', 'jor-nota', 'A regra das comissões')); b5.appendChild(rg);
    b5.appendChild(el('p', 'jor-nota', 'A parte de quem vendeu entra no custo da obra. Os 2% de cada sócio ficam à parte.'));
    esq.appendChild(b5);
  }
  function tentarNumero(novo, botao) {
    botao.disabled = true;
    api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/numero', 'POST', novo ? { novo: true } : {}, 200000).then(function (r) {
      botao.disabled = false;
      if (r.status === 200 && r.json.ok !== false) toast('Número ' + r.json.codigo + '.'); else toast(msgDe(r, 'Não consegui dar o número agora.'));
      carregarObra();
    });
  }

  // ── Impressão dos papéis ────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** O recibo é texto: título em maiúscula, CLÁUSULA, régua de assinatura de _, itens a) e -, linha em branco, separador ═. Tudo ESCAPADO. */
  function textoParaHtml(texto) {
    var blocos = [];
    String(texto).split(/\r?\n/).forEach(function (linha, i) {
      var t = linha.trim();
      if (!t) return;
      if (/^[═=\-_]{4,}$/.test(t) && t.indexOf('_') < 0) { blocos.push('<hr>'); return; }
      if (/^_{5,}/.test(t)) { blocos.push('<div class="rg"></div>'); return; }
      if (i === 0 || (t === t.toUpperCase() && t.length < 70 && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(t))) { blocos.push((i === 0 ? '<h1>' : '<h2>') + esc(t) + (i === 0 ? '</h1>' : '</h2>')); return; }
      if (/^CL[ÁA]USULA/i.test(t)) { blocos.push('<h2>' + esc(t) + '</h2>'); return; }
      blocos.push('<p>' + esc(t) + '</p>');
    });
    return blocos.join('');
  }
  function imprimir(conteudo, formato, titulo) {
    var antigo = document.getElementById('jor-papel'); if (antigo) antigo.remove();
    var logo = location.origin + '/gerador/logo.png';
    var html;
    if (formato === 'html') {
      var txt = String(conteudo); var estilo = ''; var m = /<style[\s\S]*?<\/style>/i.exec(txt);
      if (m) { estilo = m[0]; txt = txt.replace(m[0], ''); }
      html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title>' + estilo.split('{{LOGO}}').join(logo)
        + '<style>@page{size:A4 portrait;margin:1.5cm}html,body{margin:0;background:#fff}</style></head><body>' + txt.split('{{LOGO}}').join(logo) + '</body></html>';
    } else {
      html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title><style>@page{size:A4 portrait;margin:1.5cm}html,body{margin:0;background:#fff}'
        + 'body{font:13px/1.55 Georgia,serif;color:#111;padding:8px}h1{font-size:18px;text-align:center;margin:0 0 14px}h2{font-size:14px;margin:14px 0 6px}p{margin:0 0 8px;text-align:justify}hr{border:0;border-top:1px solid #111;margin:12px 0}.rg{border-bottom:1px solid #111;width:60%;margin:28px auto 4px}</style></head><body>'
        + textoParaHtml(conteudo) + '</body></html>';
    }
    var ov = el('div', 'ep-prev-bg'); ov.id = 'jor-papel'; ov.style.display = 'flex'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', titulo);
    var bar = el('div', 'ep-prev-bar'); bar.appendChild(el('div', 'ep-prev-tit', titulo));
    var ac = el('div', 'ep-prev-acoes');
    var fr = document.createElement('iframe'); fr.title = titulo; fr.setAttribute('sandbox', 'allow-same-origin allow-modals');
    fr.style.cssText = 'width:100%;height:297mm;border:0;background:#fff'; fr.srcdoc = html;
    add(ac, btn('Imprimir / PDF', 'jor-btn-pri', function () { if (fr.contentWindow) { fr.contentWindow.focus(); fr.contentWindow.print(); } }), btn('Fechar', '', function () { ov.remove(); }));
    bar.appendChild(ac); ov.appendChild(bar);
    var sc = el('div', 'ep-prev-scroll'); var pal = el('div', 'ep-prev-palco'); var fo = el('div', 'ep-prev-folha'); fo.appendChild(fr);
    pal.appendChild(fo); sc.appendChild(pal); ov.appendChild(sc);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }

  // ── Etapa 3 ─────────────────────────────────────────────────────────────────
  function patch(corpoPedido, aviso) {
    return api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card), 'PATCH', corpoPedido).then(function (r) {
      if (r.status === 200 && r.json.ok !== false) { carregarObra(); return true; }
      toast(msgDe(r, aviso || 'Não consegui agora.')); return false;
    });
  }
  function etapa3(esq, d, et) {
    var sem = d.numero.estado !== 'tem';
    if (d.excedente === 'sim') {
      var ra = el('div', 'jor-bloco'); ra.appendChild(el('div', 'jor-bloco-t', 'Rateio do excedente'));
      var bens = d.rateio.linhas.filter(function (l) { return l.papel === 'beneficiaria'; });
      ra.appendChild(el('p', '', 'Esta usina manda excedente para ' + plural(bens.length, 'conta', 'contas') + ', além da geradora.'));
      var tb = el('table', 'jor-tbl');
      d.rateio.linhas.forEach(function (l) {
        var tr = el('tr'); [l.papel === 'geradora' ? 'Geradora' : 'Beneficiária', 'UC ' + l.uc, l.titular, l.endereco, l.pct === null ? '' : String(l.pct).replace('.', ',') + '%'].forEach(function (x) { tr.appendChild(el('td', '', x)); }); tb.appendChild(tr);
      });
      ra.appendChild(tb);
      ra.appendChild(el('p', '', 'Total ' + String(d.rateio.total).replace('.', ',') + '%'));
      ra.appendChild(el('p', 'jor-nota', 'Este rateio vai no projeto, no protocolo e no cartão do Trello. Confira no protocolo da Cemig antes de concluir.'));
      var conf = d.rateio_conferido && d.rateio_conferido.marca === d.rateio.marca;
      if (conf) ra.appendChild(el('p', 'jor-ok', 'Conferido por ' + nomeBonito(d.rateio_conferido.por) + ' em ' + ddmm(String(d.rateio_conferido.conferido_em).slice(0, 10)) + '.'));
      else {
        var bc = btn('Conferi o rateio', 'jor-btn-pri', function () { bc.disabled = true; patch({ rateio_conferido: true }); });
        bc.disabled = !(d.rateio.total === 100 && d.pode.etapa3); ra.appendChild(bc);
      }
      ra.appendChild(el('p', 'jor-nota', 'O percentual se edita no quadro abaixo.'));
      esq.appendChild(ra);
    }
    var tr = el('div', 'jor-bloco'); tr.appendChild(el('div', 'jor-bloco-t', 'Cartão no Trello'));
    if (d.trello.url) {
      tr.appendChild(el('p', 'jor-ok', 'Criado em ' + ddmm(String(d.trello.criado_em).slice(0, 10)) + ' por ' + nomeBonito(d.trello.por)));
      var a = el('a', 'jor-btn', 'Abrir card no Trello'); a.href = d.trello.url; a.target = '_blank'; a.rel = 'noopener'; tr.appendChild(a);
    } else if (d.trello.tem_cartao) {
      tr.appendChild(el('p', 'jor-nota', 'Cartão criado. Envie de novo para guardar o link.'));
    } else {
      var bt = btn('Criar cartão no Trello', 'jor-btn-pri', function () {
        if (O.vdcNo) O.vdcNo.scrollIntoView({ behavior: 'smooth' });
        if (typeof vdcEst !== 'undefined' && vdcEst && typeof window.vdcTrPrevia === 'function') window.vdcTrPrevia(vdcEst);
      });
      bt.disabled = sem; tr.appendChild(bt);
      if (sem) tr.appendChild(el('p', 'jor-nota', 'A obra ainda não tem número. Ele nasce com o contrato e a procuração assinados.'));
    }
    esq.appendChild(tr);
    var art = el('div', 'jor-bloco'); art.appendChild(el('div', 'jor-bloco-t', 'ART (obrigatória)'));
    art.appendChild(anexo('art', 'ART (documento)', !!d.slots.art)); art.appendChild(anexo('art_comprovante', 'Comprovante de pagamento da ART', !!d.slots.art_comprovante));
    esq.appendChild(art);
    var eng = el('div', 'jor-bloco'); eng.appendChild(el('div', 'jor-bloco-t', 'Engenheiro, projeto elétrico'));
    var fe = el('div', 'jor-filtros');
    [['pago', 'Pago'], ['a_pagar', 'A pagar']].forEach(function (o) {
      var b = el('button', 'jor-chip' + (d.engenheiro === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !d.pode.etapa3;
      b.addEventListener('click', function () { patch({ engenheiro: o[0] }); }); fe.appendChild(b);
    });
    eng.appendChild(fe); eng.appendChild(anexo('projeto_comprovante', 'Comprovante do engenheiro', !!d.slots.projeto_comprovante));
    eng.appendChild(el('p', 'jor-nota', 'O pagamento do engenheiro pode ficar pendente. Pendente, ele não trava a etapa. O comprovante entra aqui quando pagar.'));
    esq.appendChild(eng);
    var pr = el('div', 'jor-bloco'); pr.appendChild(el('div', 'jor-bloco-t', 'Protocolo'));
    var num = el('input', 'jor-in'); num.type = 'text'; num.maxLength = 40; num.setAttribute('aria-label', 'Número do protocolo'); num.value = d.protocolo ? d.protocolo.numero : '';
    var dt = el('input', 'jor-in'); dt.type = 'date'; dt.setAttribute('aria-label', 'Data do protocolo'); dt.value = d.protocolo ? d.protocolo.em : '';
    var sv = btn('Salvar', '', function () { sv.disabled = true; patch({ protocolo: { numero: num.value.trim(), em: dt.value } }).then(function () { sv.disabled = false; }); });
    sv.disabled = !d.pode.etapa3; num.disabled = !d.pode.etapa3; dt.disabled = !d.pode.etapa3;
    var g = el('div', 'jor-grade'); add(g, num, dt, sv); pr.appendChild(g);
    pr.appendChild(anexo('protocolo', 'Print do protocolo', !!d.slots.protocolo));
    esq.appendChild(pr);
    var pa = el('div', 'jor-bloco'); pa.appendChild(el('div', 'jor-bloco-t', 'Parecer de acesso'));
    pa.appendChild(anexo('parecer_acesso', 'Parecer de acesso aprovado', !!d.slots.parecer_acesso));
    esq.appendChild(pa);
  }

  // ── O Vendido pelo servidor (commit 3) ──────────────────────────────────────
  function vendido(card, linha) {
    return api('/gerador/vendas-solares/' + encodeURIComponent(String(card)) + '/vendido', 'POST', linha ? { linha: linha } : {}, 20000).then(function (r) {
      if (r.status === 200 && r.json && r.json.ok !== false) return { ok: true, historico: r.json.historico };
      throw new Error(msgDe(r, 'Não consegui marcar a venda agora. Tente de novo.'));
    });
  }

  // Fase 2: os ajudantes que jornada-dinheiro.js e jornada-obra.js usam. Eles se registram em etapas, extras e dinheiro.
  var H = {
    api: api, el: el, add: add, btn: btn, icone: icone, ddmm: ddmm, reais: reais, rs: rs, cents: cents, nomeBonito: nomeBonito, plural: plural, esc: esc,
    anexo: anexo, blocoTitulo: blocoTitulo, dialogo: dialogo, dialogoMotivo: dialogoMotivo, fecharDlg: fecharDlg, toast: toast, releia: releia, imprimir: imprimir,
    empresaDoAparelho: empresaDoAparelho, msgDe: msgDe, corpo: corpo, abrirLista: abrirLista, desenhar: desenharObra, recarregar: function () { return carregarObra(); },
    atual: atualEtapa, O: function () { return O; },
  };
  window.Jornada = { abrirLista: abrirLista, abrirObra: abrirObra, vendido: vendido, h: H, etapas: {}, extras: {}, dinheiro: null };

  // Link de entrada: /gerador/?obra=<id>. Depois do Início, com o modo app ligado.
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      try {
        var q = new URLSearchParams(location.search).get('obra');
        if (!q || !/^\d{1,12}$/.test(q) || document.documentElement.dataset.mode !== 'app') return;
        history.replaceState(null, '', location.pathname + location.hash);
        if (typeof navClientesSolar === 'function') navClientesSolar(q);
      } catch (e) { /* sem parâmetro */ }
    }, 0);
  });
})();
