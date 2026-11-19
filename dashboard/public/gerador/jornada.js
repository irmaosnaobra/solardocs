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
  var O = { card: null, dados: null, fase2: null, fase3: null, dinheiro: null, ficha: null, fase2Erro: false, dinErro: false, ocupado: '', msg: '', painel: null, vdcChave: '', vdcNo: null, vdcDet: null, vdcPainel: 0, obraNo: null, debounce: 0, seq: 0, erroSlot: {}, ocupSlot: {},
    lendo: null, lendoFalhou: '', lendoT: 0, edita: {}, rascunho: {}, confirmando: {}, erroSec: {}, abertos: {}, vendaEdita: false };

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
    p.setAttribute('d', tipo === 'ok' ? 'M5 12.5l4.5 4.5L19 7.5' : tipo === 'baixo' ? 'M12 5v13M6.5 12.5L12 18l5.5-5.5' : 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z');
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

  /** Reserva escura para o visual antigo (onde os tokens do io2 nao existem): os mesmos valores do bloco escuro do io2.css. */
  var RESERVA = {
    '--n-tx': '#E5E7EB', '--n-tx2': '#B4C0D1', '--n-tx3': '#94A3B8', '--n-sf': '#1E293B', '--n-sf2': '#182338', '--n-sf3': '#2A384F', '--n-bd': '#334155', '--n-bd2': '#475569',
    '--n-inv': '#FFFFFF', '--io-borda-campo': '#7384A0', '--io-titulo': '#F1F5F9', '--io-azul': '#2E6CEA', '--io-azul-tx': '#93C5FD', '--io-azul-sf': 'rgba(96,165,250,.16)',
    '--io-amarelo': '#FFC220', '--io-amarelo-forte': '#E5A900', '--io-amarelo-sf': 'rgba(255,194,32,.16)', '--io-tinta': '#0B2447', '--io-marcado': '#2E6CEA',
    '--io-ok': '#15803D', '--io-ok-tx': '#4ADE80', '--io-ok-sf': 'rgba(74,222,128,.14)', '--io-ok-fg': '#4ADE80', '--io-ok-bd': 'rgba(74,222,128,.4)',
    '--io-er': '#DC2626', '--io-er-tx': '#FCA5A5', '--io-er-sf': 'rgba(248,113,113,.14)', '--io-er-bd': 'rgba(248,113,113,.4)',
    '--io-av-tx': '#FBBF24', '--io-av-sf': 'rgba(251,191,36,.14)', '--io-ambar-tx': '#FBBF24', '--io-ambar-bd': 'rgba(251,191,36,.45)',
    '--io-zap-fundo': '#EFE8DD', '--io-zap-bolha': '#DDF4D4', '--io-zap-bd': '#B9DDAC',
    '--sombra': '0 1px 2px rgba(0,0,0,.4),0 4px 12px rgba(0,0,0,.35)', '--ioc-sel': 'none',
  };
  /** Escreve var(--token) e o injetarCss poe a reserva escura de cada um. */
  function comReserva(css) { return css.replace(/var\((--[a-z0-9-]+)\)/g, function (m, k) { return RESERVA[k] ? 'var(' + k + ',' + RESERVA[k] + ')' : m; }); }

  function injetarCss() {
    if (document.getElementById('jor-css')) return;
    var css = [
      '.jor{color:var(--n-tx);font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}',
      '.jor *{box-sizing:border-box}',
      '.jor h2,.jor h3{margin:0;color:var(--io-titulo)}',
      '.jor-topo{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 12px}',
      '.jor-topo h2{font-size:20px;font-weight:700;margin-right:auto}',
      '.jor-abas,.jor-filtros{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;align-items:center}',
      '.jor-aba,.jor-chip{border:1px solid var(--n-bd2);background:var(--n-sf);color:var(--n-tx2);border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;min-height:36px}',
      '.jor-aba:hover,.jor-chip:hover:not(:disabled){background:var(--n-sf3)}',
      '.jor-aba.on,.jor-chip.on{background:var(--io-marcado);border-color:var(--io-marcado);color:var(--n-inv)}',
      '.jor-chip:disabled{cursor:not-allowed;background:var(--n-sf3);color:var(--n-tx3)}',
      '.jor-chip.on:disabled{background:var(--io-marcado);color:var(--n-inv);opacity:.75}',
      '.jor-chip-grande{min-height:48px;padding:10px 28px;border-radius:12px;font-size:15px}',
      // Campos do sistema: o mesmo desenho dos campos do io2 (contorno --io-borda-campo, raio 10, seta do select vinda do io2).
      '.jor-busca,.jor-sel,.jor-in,.jor-ta{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--io-borda-campo);border-radius:10px;background-color:var(--n-sf);color:var(--n-tx);font:inherit;font-size:14px;font-weight:500;max-width:100%}',
      '.jor-busca{width:300px;border-radius:999px;background-color:var(--n-sf2)}',
      '.jor-busca::placeholder,.jor-in::placeholder,.jor-ta::placeholder{color:var(--n-tx3)}',
      '.jor-in:focus-visible,.jor-sel:focus-visible,.jor-ta:focus-visible,.jor-busca:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:1px}',
      '.jor-sel{width:auto;min-width:150px;-webkit-appearance:none;appearance:none;cursor:pointer;background-image:var(--ioc-sel);background-repeat:no-repeat;background-position:right 12px center;background-size:16px;padding-right:36px}',
      '.jor-in[type=date]{width:auto}',
      '.jor-ta{min-height:76px;resize:vertical;line-height:1.5}',
      '.jor input[type=checkbox]{-webkit-appearance:none;appearance:none;flex:0 0 22px;width:22px;height:22px;margin:0;border:1.5px solid var(--io-borda-campo);border-radius:6px;background:var(--n-sf);display:inline-grid;place-content:center;cursor:pointer}',
      '.jor input[type=checkbox]:checked{background:var(--io-azul);border-color:var(--io-azul)}',
      '.jor input[type=checkbox]:checked::after{content:"";width:6px;height:11px;border:solid var(--n-inv);border-width:0 2.2px 2.2px 0;transform:rotate(45deg) translate(-1px,-1px)}',
      '.jor input[type=checkbox]:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:2px}',
      '.jor-linha-atrasadas{border:1px solid var(--io-er-bd);background:var(--io-er-sf);color:var(--io-er-tx);border-radius:10px;padding:8px 12px;margin:0 0 10px;font-weight:600}',
      '.jor-nota{color:var(--n-tx2);font-size:13px;margin:8px 0}',
      '.jor-num{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-weight:600;font-variant-numeric:normal}',
      '.jor-tab tr.jor-atrasada td{color:var(--io-er-tx)}',
      '.jor-tab tr.jor-atrasada td:first-child{box-shadow:inset 3px 0 0 var(--io-er-tx)}',
      '.jor-tab tbody tr{cursor:default}',
      '.jor-tab td{font-weight:400}',
      '.jor-tab td b{font-weight:700}',
      '.jor-tag{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600;margin-left:6px;background:var(--io-av-sf);color:var(--io-ambar-tx)}',
      '.jor-tag-travada{background:var(--io-er);color:var(--n-inv)}',
      // Etiquetas (jr-etq do desenho): Automatico, ok, falta.
      '.jor-etq,.jor-auto{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;background:var(--n-sf3);color:var(--n-tx2);font-size:12px;font-weight:600;line-height:1.5;white-space:nowrap;margin-left:0;border:0}',
      '.jor-etq-auto,.jor-auto{background:var(--io-azul-sf);color:var(--io-azul-tx);margin-left:8px}',
      '.jor-etq-ok{background:var(--io-ok-sf);color:var(--io-ok-fg)}',
      '.jor-etq-av{background:var(--io-av-sf);color:var(--io-ambar-tx)}',
      '.jor-etq-er{background:var(--io-er);color:var(--n-inv)}',
      '.jor-etq-vez{background:var(--io-amarelo-sf);color:var(--io-titulo)}',
      // Botoes: o primario e amarelo com texto escuro; os outros sao secundarios discretos.
      '.jor-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--n-bd2);background:var(--n-sf);color:var(--n-tx);border-radius:10px;padding:8px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;min-height:40px;text-decoration:none}',
      '.jor-btn:hover:not(:disabled){background:var(--n-sf3)}',
      '.jor-btn:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:2px}',
      '.jor-btn:disabled{cursor:not-allowed;background:var(--n-sf3);border-color:var(--n-bd);color:var(--n-tx3)}',
      '.jor-btn-pri{background:var(--io-amarelo);border-color:var(--io-amarelo);color:var(--io-tinta)}',
      '.jor-btn-pri:hover:not(:disabled){background:var(--io-amarelo-forte);border-color:var(--io-amarelo-forte);color:var(--io-tinta)}',
      '.jor-btn-grande{min-height:48px;padding:10px 20px;border-radius:12px;font-size:15px}',
      '.jor-btn-link,.jor-btn-disc{min-height:32px;padding:4px 12px;border-radius:8px;font-size:13px;font-weight:600;background:transparent;border-color:var(--n-bd);color:var(--n-tx2);text-decoration:none}',
      '.jor-btn-link:hover:not(:disabled),.jor-btn-disc:hover:not(:disabled){background:var(--n-sf3);color:var(--n-tx)}',
      '.jor-cartao{min-width:0;background:var(--n-sf);border:1px solid var(--n-bd);border-radius:12px;box-shadow:var(--sombra)}',
      '.jor-cab{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;padding:16px 24px;margin:0 0 16px}',
      '.jor-cab .jor-num{font-size:16px;color:var(--io-titulo);background:var(--n-sf3);border-radius:8px;padding:2px 10px}',
      '.jor-cab-t{flex:1 1 260px;min-width:0}',
      '.jor-cab-t b{display:block;font-size:18px;font-weight:700;line-height:22px;color:var(--io-titulo);overflow-wrap:anywhere}',
      '.jor-cab-t span{display:block;margin-top:4px;color:var(--n-tx2);font-size:14px}',
      '.jor-pilula{display:inline-flex;align-items:center;min-height:28px;border-radius:999px;padding:2px 12px;font-weight:600;font-size:13px;background:var(--io-azul-sf);color:var(--io-azul-tx)}',
      '.jor-faixa{border:1px solid var(--io-er-bd);background:var(--io-er-sf);color:var(--io-er-tx);border-radius:12px;padding:12px 14px;margin:0 0 12px;font-weight:600}',
      // Regua: circulos de 32 px ligados por linha, a pilula "N · sigla" e o gasto embaixo.
      '.jor-regua-cx{margin:0 0 16px;padding:0 0 12px}',
      '.jor-regua{display:flex;overflow-x:auto;padding:16px 12px 4px;margin:0;-webkit-overflow-scrolling:touch}',
      '.jor-passo{flex:1 1 0;min-width:96px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:2px 0 6px;border:0;border-radius:8px;background:transparent;color:var(--n-tx);font:inherit;cursor:pointer;text-align:center}',
      '.jor-passo:hover:not([aria-disabled=true]){background:var(--n-sf2)}',
      '.jor-passo[aria-disabled=true]{cursor:default}',
      '.jor-passo-trilha{display:flex;align-items:center;width:100%}',
      '.jor-passo-linha{flex:1 1 0;height:3px;background:var(--n-bd2)}',
      '.jor-passo-linha.ok{background:var(--io-ok)}',
      '.jor-passo-linha.nada{background:transparent}',
      '.jor-passo-bola{flex:0 0 32px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;background:var(--n-sf3);border:1px solid var(--n-bd2);color:var(--n-tx3)}',
      '.jor-passo.feita .jor-passo-bola{background:var(--io-ok);border:2px solid var(--io-ok);color:var(--n-inv)}',
      '.jor-passo.davez .jor-passo-bola{background:var(--io-amarelo);border:2px solid var(--io-tinta);color:var(--io-tinta);box-shadow:0 0 0 4px var(--io-amarelo-sf)}',
      '.jor-passo-nome{font-size:13px;font-weight:500;white-space:nowrap;color:var(--n-tx3)}',
      '.jor-passo.feita .jor-passo-nome{font-weight:600;color:var(--n-tx)}',
      '.jor-passo.davez .jor-passo-nome{font-weight:700;color:var(--io-titulo)}',
      '.jor-passo-dono{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--n-sf3);color:var(--n-tx2)}',
      '.jor-passo.feita .jor-passo-dono{background:var(--io-ok-sf);color:var(--io-ok-fg)}',
      '.jor-passo.davez .jor-passo-dono{background:var(--io-amarelo-sf);color:var(--io-titulo)}',
      '.jor-passo.sel .jor-passo-nome{text-decoration:underline;text-underline-offset:3px}',
      '.jor-passo-gasto{font-size:12px;white-space:nowrap;color:var(--n-tx3)}',
      '.jor-passo.feita .jor-passo-gasto{color:var(--n-tx);font-weight:600}',
      '.jor-passo.davez .jor-passo-gasto{color:var(--io-titulo);font-weight:700}',
      '.jor-regua-pe{margin:8px 12px 0;font-size:13px;color:var(--n-tx2)}',
      '.jor-cols{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;align-items:start;margin-bottom:32px}',
      '.jor-esq,.jor-dir{min-width:0}',
      '.jor-esq{padding:24px}',
      '.jor-dir{display:flex;flex-direction:column;gap:16px}',
      // O cabecalho da etapa: titulo de 20 px, "Da vez", o dono com avatar de 40 px.
      '.jor-etapa-topo{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}',
      '.jor-etapa-id{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}',
      '.jor-etapa-t{margin:0;font-size:20px;font-weight:700;line-height:1.3}',
      '.jor-etapa-quando{font-size:13px;color:var(--n-tx2)}',
      '.jor-dono{display:flex;align-items:center;gap:12px;margin-top:12px}',
      '.jor-avatar{width:40px;height:40px;flex:0 0 40px;border-radius:50%;background:var(--io-azul-sf);color:var(--io-titulo);display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}',
      '.jor-dono-nome{font-size:14px;font-weight:600;color:var(--n-tx)}',
      '.jor-dono-papel{font-size:12px;color:var(--n-tx2)}',
      '.jor-intro{margin:16px 0 0;font-size:14px;color:var(--n-tx2)}',
      // Secoes dentro do mesmo cartao.
      '.jor-esq>.jor-bloco,.jor-esq>.jor-portao{margin-top:24px}',
      '.jor-bloco{min-width:0}',
      // Cada seção da etapa: divisória grossa em cima, título maior e a situação (Completo ou Falta N) logo ao lado.
      '.jor-esq>.jor-bloco,.jor-esq>.jor-portao{border-top:4px solid var(--n-bd2);padding-top:16px}',
      '.jor-esq>.jor-bloco>.jor-bloco-t{font-size:18px}',
      '.jor-esq .jor-bloco-t em{margin-left:0}',
      '.jor-email-cmp{display:flex;flex:1 1 220px;min-width:0}',
      '.jor-ped-lista{display:flex;flex-direction:column}',
      '.jor-ped{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 0;border-top:1px solid var(--n-bd);cursor:pointer}',
      '.jor-ped:first-child{border-top:0}',
      '.jor-ped-t{flex:1 1 auto;min-width:0;font-weight:500}',
      '.jor-ped-msg{margin:10px 0 0;padding:10px 12px;border:1px dashed var(--io-borda-campo);border-radius:10px;background:var(--n-sf2);color:var(--n-tx2);font:inherit;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.jor-prog{height:10px;border-radius:999px;background:var(--n-sf3);overflow:hidden;margin:6px 0 4px}',
      '.jor-prog>i{display:block;height:100%;border-radius:999px;background:var(--io-azul)}',
      '.jor-prog.ok>i{background:var(--io-ok)}',
      '.jor-opcoes{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}',
      '.jor-opcoes .jor-chip{min-height:36px;padding:4px 12px}',
      '.jor-dir .jor-bloco{background:var(--n-sf);border:1px solid var(--n-bd);border-radius:12px;box-shadow:var(--sombra);padding:24px}',
      '.jor-bloco-t{display:flex;align-items:center;gap:8px 12px;font-size:16px;font-weight:600;line-height:1.35;color:var(--io-titulo);margin:0 0 12px;flex-wrap:wrap}',
      '.jor-bloco-t em{font-style:normal;margin-left:auto}',
      '.jor-bloco-t .jor-btn{margin-left:auto}',
      '.jor-sub-t{margin:16px 0 8px;font-size:14px;font-weight:600;color:var(--io-titulo);display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
      '.jor-campos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '.jor-campo{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.jor-campo-larga{grid-column:1/-1}',
      '.jor-campo-rot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '.jor-campo-lei{box-sizing:border-box;min-height:40px;padding:8px 12px;border:1px dashed var(--io-borda-campo);border-radius:10px;background:var(--n-sf2);color:var(--n-tx);font-size:14px;font-weight:500;overflow-wrap:anywhere}',
      '.jor-in.falta,.jor-campo-lei.falta{border-color:var(--io-ambar-tx)}',
      '.jor-kit{display:flex;align-items:center;gap:10px;min-height:40px;padding:8px 12px;border:1px solid var(--io-borda-campo);border-radius:10px;background:var(--n-sf);font-weight:500;cursor:pointer}',
      '.jor-kit.falta{border-color:var(--io-ambar-tx)}',
      '.jor-comis{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:16px;border-radius:10px;background:var(--n-sf2);border:1px solid var(--n-bd)}',
      '.jor-comis-num{font-size:20px;font-weight:700;line-height:1.3;color:var(--io-titulo)}',
      '.jor-zap{padding:16px;border-radius:10px;background:var(--io-zap-fundo);border:1px solid var(--n-bd)}',
      '.jor-zap-bolha{max-width:440px;padding:10px 14px;border-radius:2px 12px 12px 12px;background:var(--io-zap-bolha);border:1px solid var(--io-zap-bd);font-size:14px;line-height:1.55;color:var(--io-tinta)}',
      '.jor-zap-lin{margin:0}',
      '.jor-itens{list-style:none;margin:0;padding:0}',
      '.jor-itens li{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--n-bd);color:var(--n-tx)}',
      '.jor-ck{flex:0 0 24px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:2px solid var(--io-borda-campo);background:var(--n-sf);color:var(--n-tx3)}',
      '.jor-itens li.ok .jor-ck{background:var(--io-ok);border-color:var(--io-ok);color:var(--n-inv)}',
      '.jor-fotos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.jor-foto{min-width:0;border:1px solid var(--n-bd);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}',
      '.jor-foto-topo{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;font-weight:600}',
      // Anexo: caixa tracejada com Foto, Arquivo e Print; preenchido vira bloco verde com miniatura, data e Trocar.
      '.jor-anexo{display:flex;flex-direction:column;gap:6px;padding:8px 0;border-top:1px solid var(--n-bd)}',
      '.jor-anexo:first-of-type{border-top:0}',
      '.jor-foto .jor-anexo{border-top:0;padding:0}',
      '.jor-anexo-topo{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px}',
      '.jor-anexo .jor-rot{font-weight:600;font-size:14px}',
      '.jor-anexo-bts{display:flex;gap:6px;padding:6px;border:1px dashed var(--n-bd2);border-radius:10px;background:var(--n-sf2)}',
      '.jor-anexo-bt{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:6px 8px;border:1px solid var(--n-bd2);border-radius:8px;background:var(--n-sf);color:var(--n-tx);font-size:13px;font-weight:600;cursor:pointer}',
      '.jor-anexo-bt:hover,.jor-anexo-bt:focus-visible{background:var(--n-sf3)}',
      '.jor-anexo-ok{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:6px 8px 6px 6px;border:1px solid var(--io-ok-bd);border-radius:10px;background:var(--io-ok-sf)}',
      '.jor-anexo-mini{flex:0 0 44px;width:44px;height:44px;border-radius:8px;background:var(--n-sf3);color:var(--io-ok-tx);display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '.jor-anexo-mini img{width:100%;height:100%;object-fit:cover}',
      '.jor-anexo-leg{flex:1 1 90px;min-width:0;display:flex;flex-direction:column;line-height:1.35}',
      '.jor-anexo-leg b{font-size:13px;font-weight:600;color:var(--n-tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.jor-anexo-leg small{font-size:12px;color:var(--n-tx2)}',
      '.jor-anexo-trocar{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;border-radius:8px;background:transparent;color:var(--io-azul-tx);font-size:13px;font-weight:600;cursor:pointer}',
      '.jor-anexo-trocar:hover,.jor-anexo-trocar:focus-visible{background:var(--n-sf)}',
      '.jor-anexo-trocar:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:1px}',
      'button.jor-anexo-trocar{border:0;font-family:inherit}',
      '.jor-anexo-acoes{display:flex;align-items:center;gap:2px;margin-left:auto}',
      '.jor-anexo-apagar{color:var(--io-er-tx)}',
      '.jor-anexo-msg{margin:0;font-size:13px}',
      '.jor-email-lin{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.jor-email-lin .jor-in,.jor-email-lin .jor-campo-lei{flex:1 1 220px;width:auto}',
      // Portao: lista, barra com a frase e o botao.
      '.jor-portao-barra{margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;padding:16px;border-radius:10px;background:var(--n-sf2)}',
      '.jor-portao-frase{flex:1 1 260px;font-size:14px;color:var(--n-tx);margin:0}',
      '.jor-portao-feito{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 16px;border-radius:12px;background:var(--io-ok-sf);color:var(--io-ok-fg);font-size:15px;font-weight:600}',
      '.jor-portao p{margin:8px 0 0;color:var(--n-tx2)}',
      '.jor-portao p.jor-portao-frase{color:var(--n-tx);margin:0}',
      '.jor-aviso{border:1px solid var(--io-ambar-bd);background:var(--io-av-sf);color:var(--io-ambar-tx);border-radius:10px;padding:8px 12px}',
      '.jor-erro{color:var(--io-er-tx);font-weight:600}',
      '.jor-ok{color:var(--io-ok-tx);font-weight:600}',
      '.jor-conta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px;margin:8px 0 0;border:1px solid var(--n-bd);border-radius:10px}',
      '.jor-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:8px 0}',
      '.jor-grade label,.jor-campo label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '.jor-pg{display:grid;grid-template-columns:150px minmax(0,1fr) minmax(0,1fr);gap:8px;margin:8px 0 0}',
      '.jor-dlg{position:fixed;inset:0;z-index:1300;background:rgba(3,10,24,.72);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.jor-dlg>div{background:var(--n-sf);color:var(--n-tx);border:1px solid var(--n-bd);border-radius:12px;padding:18px;width:min(460px,100%);display:flex;flex-direction:column;gap:10px;max-height:90vh;overflow:auto}',
      '.jor-dlg-bt{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
      '.jor-tbl{width:100%;border-collapse:collapse;font-size:13px}',
      '.jor-tbl th,.jor-tbl td{padding:8px;border-bottom:1px solid var(--n-bd);text-align:left;color:var(--n-tx)}',
      '.jor-tbl th{color:var(--n-tx2);background:var(--n-sf2);font-weight:600}',
      '.jor-vdc-det{margin-top:24px;border-top:1px solid var(--n-bd);padding-top:12px}',
      '.jor-vdc-sum{cursor:pointer;font-weight:600;font-size:15px;color:var(--io-titulo);padding:8px 0}',
      '.jor-vdc-det .vdc{background:transparent;border:0;padding:0;color:var(--n-tx)}',
      '.jor-vdc-det .vdc-tit{display:none}',
      '.jor-vdc-det .vdc-sec-t,.jor-vdc-det .vdc-pn-gr{text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;color:var(--io-titulo)}',
      '.jor-vdc-det .vdc-btn{min-height:40px;border-radius:10px;border:1px solid var(--n-bd2);background:var(--n-sf);color:var(--n-tx);font-weight:600}',
      '.jor-vdc-det .vdc-btn:hover:not(:disabled){background:var(--n-sf3)}',
      '.jor-vdc-det .vdc-btn:disabled{opacity:1;background:var(--n-sf3);border-color:var(--n-bd);color:var(--n-tx3)}',
      '.jor-vdc-det .vdc-btn-pri{background:var(--io-amarelo);border-color:var(--io-amarelo);color:var(--io-tinta)}',
      '.jor-vdc-det .vdc-btn-pri:hover:not(:disabled){background:var(--io-amarelo-forte);border-color:var(--io-amarelo-forte)}',
      '.jor-vdc-det .vdc-doc,.jor-vdc-det .vdc-pn{background:var(--n-sf2);border-color:var(--n-bd)}',
      '.jor-vdc-det .vdc-in{background:var(--n-sf);border-radius:10px;font-weight:500}',
      '.jor-fin-tag{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;background:var(--n-sf3);color:var(--n-tx2)}',
      '.jor-dl{display:grid;grid-template-columns:minmax(130px,max-content) minmax(0,1fr);gap:6px 16px;margin:0}',
      '.jor-dl dt{color:var(--n-tx3);font-size:13px}',
      '.jor-dl dd{margin:0;overflow-wrap:anywhere}',
      '.jor-docs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.jor-docs a{color:var(--io-azul-tx)}',
      // A lista de Clientes: codigo em pilula, bolinha da etapa, pilula do dono e o menu da linha.
      '.jor-cl-cod{display:inline-block;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:13px;font-weight:600;color:var(--io-titulo);background:var(--n-sf3);border-radius:8px;padding:1px 8px}',
      '.jor-cl-nome{display:block;font-size:14px;font-weight:700;color:var(--io-titulo)}',
      '.jor-cl-sub{display:block;font-size:13px;color:var(--n-tx2)}',
      '.jor-cl-bola{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--io-azul-sf);color:var(--io-azul-tx);font-size:12px;font-weight:700;margin-right:8px}',
      '.jor-cl-dono{display:inline-block;padding:1px 10px;border-radius:999px;background:var(--io-azul-sf);color:var(--io-azul-tx);font-size:12px;font-weight:600}',
      '.jor-cl-kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--n-tx2)}',
      '.jor-cl-kv b{font-weight:600;color:var(--n-tx)}',
      '.jor-cl-kv.neg b{color:var(--io-er-tx)}',
      '.jor-cl-ac{display:flex;gap:6px;align-items:center;position:relative;white-space:nowrap}',
      '.jor-cl-menu{position:absolute;right:0;top:100%;z-index:20;margin-top:4px;min-width:180px;padding:4px;border:1px solid var(--n-bd);border-radius:10px;background:var(--n-sf);box-shadow:var(--sombra)}',
      '.jor-cl-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--io-er-tx);font:inherit;font-size:13px;font-weight:600;padding:8px 10px;border-radius:8px;cursor:pointer}',
      '.jor-cl-menu button:hover{background:var(--io-er-sf)}',
      // A página do cliente (18/11/2026): o resumo no topo e a linha do tempo. Cor só por token.
      '.jor-q{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:6px;border-radius:50%;border:1px solid var(--n-bd2);color:var(--n-tx2);font-size:12px;font-weight:700;font-style:normal;cursor:help;vertical-align:middle;flex:0 0 22px}',
      '.jor-q:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:2px}',
      // Resumo
      '.jor-res{padding:20px 24px;margin:0 0 16px}',
      '.jor-res-topo{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding-bottom:16px;border-bottom:1px solid var(--n-bd)}',
      '.jor-res-topo .jor-num{font-size:16px;color:var(--io-titulo);background:var(--n-sf3);border-radius:8px;padding:2px 10px}',
      '.jor-res-topo h2{font-size:22px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
      '.jor-res-g{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:20px 24px;margin-top:18px}',
      '.jor-grp{min-width:0;scroll-margin-top:16px}',
      '.jor-grp:focus{outline:none}',
      '.jor-grp-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 10px}',
      '.jor-grp-t h3{font-size:15px;font-weight:700;line-height:1.3}',
      '.jor-grp-sit{margin-top:20px}',
      '.jor-ficha-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.jor-fc{min-width:0;padding:8px 12px;border:1px solid var(--n-bd);border-radius:10px;background:var(--n-sf);display:flex;flex-direction:column;gap:2px}',
      '.jor-fc.vazio{border-style:dashed;border-color:var(--n-bd2);background:var(--n-sf2)}',
      '.jor-fc.edita{grid-column:1/-1;border-color:var(--io-borda-campo);padding:12px}',
      '.jor-fc-rot{display:flex;align-items:center;gap:6px;min-height:20px;font-size:12px;font-weight:600;color:var(--n-tx2)}',
      '.jor-fc-rot svg,.jor-rc-rot svg{flex:0 0 14px;color:var(--io-ok-fg)}',
      '.jor-fc-org{margin-left:auto;font-size:12px;font-weight:500;color:var(--n-tx3);white-space:nowrap}',
      '.jor-fc-org.ia{color:var(--io-azul-tx);font-weight:600}',
      '.jor-fc-v{display:flex;align-items:center;gap:8px;min-height:32px}',
      '.jor-fc-v>span{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;line-height:1.35;color:var(--io-titulo);overflow-wrap:anywhere}',
      '.jor-fc.nome .jor-fc-v>span{font-size:16px;font-weight:700}',
      '.jor-fc.cpf .jor-fc-v>span{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-variant-numeric:normal}',
      '.jor-fc.vazio .jor-fc-v>span{font-size:14px;font-weight:500;color:var(--n-tx3);font-family:inherit}',
      '.jor-fc-ed{flex:0 0 auto;min-height:32px;padding:4px 10px;border:0;border-radius:8px;background:transparent;color:var(--io-azul-tx);font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
      '.jor-fc-ed:hover:not(:disabled){background:var(--n-sf3)}',
      '.jor-fc-ed:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:1px}',
      '.jor-fc-ed:disabled{color:var(--n-tx3);cursor:not-allowed}',
      '.jor-resumo{display:grid;grid-template-columns:minmax(0,1fr);border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf);overflow:hidden}',
      '.jor-rc{min-width:0;display:flex;align-items:baseline;gap:12px;padding:8px 12px;border-top:1px solid var(--n-bd)}',
      '.jor-rc:first-child{border-top:0}',
      '.jor-rc-rot{flex:0 0 92px;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--n-tx2)}',
      '.jor-rc-v{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;line-height:1.4;color:var(--io-titulo);overflow-wrap:anywhere}',
      '.jor-rc-v.vazio{color:var(--n-tx3);font-weight:500}',
      '.jor-rc-v small{display:block;font-size:12px;font-weight:500;color:var(--n-tx2)}',
      '.jor-rc-lin{display:block}',
      '.jor-sit{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}',
      '.jor-sit-c{min-width:0;padding:8px 12px;border:1px solid var(--n-bd);border-radius:10px;background:var(--n-sf)}',
      '.jor-sit-c small{display:block;font-size:12px;font-weight:600;color:var(--n-tx2)}',
      '.jor-sit-c b{display:block;font-size:14px;font-weight:600;line-height:1.4;color:var(--io-titulo);overflow-wrap:anywhere}',
      '.jor-sit-c.vazio{border-style:dashed;border-color:var(--n-bd2);background:var(--n-sf2)}',
      '.jor-sit-c.vazio b{color:var(--n-tx3);font-weight:500}',
      '.jor-sit-c.av b{color:var(--io-ambar-tx)}',
      '.jor-sit-c a{color:var(--io-azul-tx);font-weight:600;text-underline-offset:2px}',
      '.jor-res-din{margin-top:20px;padding-top:18px;border-top:1px solid var(--n-bd)}',
      '.jor-res-din .jor-din-painel{border:0;box-shadow:none;padding:0;margin:0;background:transparent}',
      '.jor-res-din .jor-din-tit{font-size:15px;font-weight:700;margin:0 0 10px}',
      '.jor-res-din .jor-din-faixa{border:0;box-shadow:none;padding:0;background:transparent;gap:8px}',
      '.jor-res-din .jor-din-c{background:var(--n-sf2)}',
      '.jor-res-din .jor-bloco-t{font-size:15px;font-weight:700}',
      '.jor-tl>li:last-child::before{display:none}',
      '.jor-res-din>.jor-bloco{margin-top:18px;padding-top:16px;border-top:1px solid var(--n-bd)}',
      '.jor-lendo{display:flex;align-items:center;gap:10px;padding:8px 12px;margin:0 0 10px;border-radius:10px;background:var(--io-azul-sf);color:var(--io-azul-tx);font-weight:600}',
      '.jor-lendo i{flex:0 0 10px;width:10px;height:10px;border-radius:50%;background:currentColor;animation:jor-pulso 1.2s ease-in-out infinite}',
      '.jor-doc .jor-lendo{grid-column:1/-1;margin:0;padding:6px 10px;font-size:13px}',
      '@keyframes jor-pulso{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}',
      '@media (prefers-reduced-motion:reduce){.jor-lendo i{animation:none}}',
      // Linha do tempo: um nó por passo, o marcador numa linha vertical; o atual aberto, o feito em uma linha, o futuro apagado.
      '.jor-tl{list-style:none;margin:16px 0 0;padding:0}',
      '.jor-tl-no,.jor-tl-portao{position:relative;display:grid;grid-template-columns:32px minmax(0,1fr);gap:0 14px;padding:0 0 20px;scroll-margin-top:16px}',
      '.jor-tl-no:focus{outline:none}',
      '.jor-tl-no::before{content:"";position:absolute;left:15px;top:36px;bottom:4px;width:2px;border-radius:2px;background:var(--n-bd)}',
      '.jor-tl-no.feito::before{background:var(--io-ok)}',
      '.jor-tl-mk{position:relative;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;background:var(--n-sf);border:2px solid var(--n-bd2);color:var(--n-tx2)}',
      '.jor-tl-mk.vazio{border:0;background:transparent}',
      '.jor-tl-no.feito .jor-tl-mk{background:var(--io-ok);border-color:var(--io-ok);color:var(--n-inv)}',
      '.jor-tl-no.atual .jor-tl-mk{background:var(--io-amarelo);border-color:var(--io-tinta);color:var(--io-tinta);box-shadow:0 0 0 4px var(--io-amarelo-sf)}',
      '.jor-tl-no.pendente .jor-tl-mk{border-color:var(--io-ambar-tx);color:var(--io-ambar-tx)}',
      '.jor-tl-no.futuro .jor-tl-mk{border-style:dashed;color:var(--n-tx3)}',
      '.jor-tl-cx{min-width:0;padding-top:4px}',
      '.jor-tl-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-height:28px}',
      '.jor-tl-t h4{margin:0;font-size:16px;font-weight:700;line-height:1.3;color:var(--io-titulo)}',
      '.jor-tl-no.feito .jor-tl-t h4{font-weight:600}',
      '.jor-tl-no.futuro .jor-tl-t h4{color:var(--n-tx3);font-weight:600}',
      '.jor-tl-t .jor-tl-ac{margin-left:auto}',
      '.jor-tl-res{margin:2px 0 0;font-size:13px;color:var(--n-tx2)}',
      '.jor-tl-no.futuro .jor-tl-res{color:var(--n-tx3)}',
      '.jor-tl-corpo{position:relative;z-index:1;margin-top:10px;padding:16px;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-tl-no.atual .jor-tl-corpo{border-color:var(--io-borda-campo);box-shadow:var(--sombra)}',
      '.jor-tl-corpo>.jor-bloco+.jor-bloco{margin-top:16px;padding-top:16px;border-top:1px solid var(--n-bd)}',
      '.jor-tl-corpo .jor-bloco-t{font-size:15px}',
      '.jor-tl-corpo>.jor-nota:first-child,.jor-tl-corpo>.jor-docs-ac:first-child,.jor-tl-corpo>.jor-perg:first-child{margin-top:0}',
      '.jor-tl-corpo>.jor-bloco>.jor-nota:first-child{margin-top:0}',
      '.jor-tl-fase{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:4px 0 16px;padding:10px 12px;border-radius:10px;background:var(--n-sf2);border:1px solid var(--n-bd)}',
      '.jor-tl-fase b{font-size:14px;color:var(--io-titulo)}',
      '.jor-tl-fase .jor-avatar{width:28px;height:28px;flex:0 0 28px;font-size:12px}',
      '.jor-tl-fase .jor-nota{margin:0}',
      '.jor-tl-fase-g{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13px;color:var(--n-tx2)}',
      '.jor-tl-portao .jor-portao-barra{margin-top:0}',
      '.jor-tl-portao .jor-nota{margin:8px 0 0}',
      '.jor-perg{display:flex;align-items:center;flex-wrap:wrap;margin:14px 0 8px;font-size:14px;font-weight:600;color:var(--io-titulo)}',
      '.jor-sep{height:1px;background:var(--n-bd);margin:16px 0}',
      '.jor-vai{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0 0 12px;padding:0}',
      '.jor-vai li{padding:4px 10px;border-radius:999px;background:var(--io-av-sf);color:var(--io-ambar-tx);font-size:13px;font-weight:600}',
      '.jor-conf{padding:12px 0;border-top:1px solid var(--n-bd)}',
      '.jor-conf-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:14px}',
      '.jor-conf-t b{color:var(--io-titulo)}',
      '.jor-conf .jor-nota{margin:4px 0 0}',
      '.jor-conf .jor-din-acoes{margin-top:8px}',
      '.jor-conf .jor-erro:empty{display:none}',
      '.jor-pe-ok{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--io-ok-fg)}',
      // Documentos: uma lista só, pedido e anexo na mesma linha.
      '.jor-docs-ac{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px}',
      '.jor-docs-ac .jor-nota{margin:0}',
      '.jor-docs-l{border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-doc{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,320px);gap:8px 16px;align-items:center;padding:10px 14px;border-top:1px solid var(--n-bd)}',
      '.jor-doc:first-child{border-top:0}',
      '.jor-doc-nome{display:block;font-weight:600;color:var(--io-titulo)}',
      '.jor-doc-est{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;font-size:13px;color:var(--n-tx2)}',
      '.jor-doc-est .st{font-weight:600}',
      '.jor-doc-est .st-falta{color:var(--io-ambar-tx)}',
      '.jor-doc-est .st-ped{color:var(--io-azul-tx)}',
      '.jor-doc-est .st-ok{color:var(--io-ok-fg)}',
      '.jor-passos{display:inline-flex;align-items:center}',
      '.jor-passos i{display:block;width:10px;height:10px;border-radius:50%;border:2px solid var(--n-bd2);background:var(--n-sf)}',
      '.jor-passos b{display:block;width:10px;height:2px;background:var(--n-bd2)}',
      '.jor-passos.p0 i:first-child{background:var(--io-ambar-tx);border-color:var(--io-ambar-tx)}',
      '.jor-passos.p1 .on{background:var(--io-azul-tx);border-color:var(--io-azul-tx)}',
      '.jor-passos.ok i,.jor-passos.ok b{background:var(--io-ok);border-color:var(--io-ok)}',
      '.jor-doc-ped{display:inline-flex;align-items:center;gap:8px;min-height:40px;font-size:13px;font-weight:500;color:var(--n-tx2);cursor:pointer}',
      '.jor-doc .jor-anexo{padding:0;border:0}',
      '.jor-papel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;align-items:center;padding:12px 14px;border-top:1px solid var(--n-bd)}',
      '.jor-papel:first-child{border-top:0}',
      '.jor-papel-ac{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:flex-end}',
      '.jor-venda-form{margin-top:12px;padding:16px;border:1px solid var(--io-borda-campo);border-radius:12px;background:var(--n-sf2)}',
      '.jor-venda-form>.jor-sub-t:first-child{margin-top:0}',
      '.jor-rolar{overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '.jor-grade-bt{display:flex;align-items:flex-end}',
      '#jor-s-vistoria .jor-ob-par{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
      '#jor-s-vistoria .jor-bloco>label{display:flex;flex-direction:column;gap:4px;margin:10px 0 0;font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '#jor-s-vistoria .jor-bloco>label .jor-sel{align-self:flex-start}',
      '#jor-s-vistoria .jor-ob-grupo{margin-top:18px;font-size:14px;color:var(--io-titulo)}',
      '.jor-quadro{margin:0 0 32px;padding:8px 24px 24px}',
      '.jor-quadro>.jor-vdc-sum{font-size:18px;font-weight:700;padding:14px 0 6px}',
      '.jor-quadro.jor-vdc-det{margin-top:0;border-top:0}',
      // Celular: atalho logo abaixo do cabeçalho da ficha, para pular direto ao passo atual. Nada da ficha some.
      '.jor-ir-atual{display:none}',
      '@media (max-width:599px){',
      '.jor-ir-atual{display:flex;width:100%;min-height:44px;margin:12px 0 0;justify-content:center;touch-action:manipulation}',
      '}',
      '@media (max-width:760px){',
      '.jor-res{padding:16px}',
      '.jor-res-g,.jor-ficha-g{grid-template-columns:minmax(0,1fr)}',
      '.jor-sit{grid-template-columns:repeat(2,minmax(0,1fr))}',
      '.jor-doc,.jor-papel{grid-template-columns:minmax(0,1fr)}',
      '.jor-papel-ac{justify-content:flex-start}',
      '.jor-fc-ed{min-height:44px}',
      '.jor-tl-no,.jor-tl-portao{grid-template-columns:28px minmax(0,1fr);gap:0 10px}',
      '.jor-tl-mk{width:28px;height:28px;font-size:13px}',
      '.jor-tl-no::before{left:13px;top:32px}',
      '.jor-tl-corpo{padding:12px;margin-left:-38px}',
      '.jor-tl-fase-g{margin-left:0;width:100%}',
      '.jor-tl .jor-btn-link,.jor-tl .jor-btn{min-height:44px}',
      '.jor-rc-rot{flex-basis:84px}',
      '.jor-res-din .jor-din-c b{font-size:17px}',
      '.jor-cols>.jor-dir{order:-1}',
      '.jor-quadro{padding:4px 16px 16px}',
      '.jor-dl{grid-template-columns:minmax(0,1fr)}',
      '.jor-cols{grid-template-columns:minmax(0,1fr)}',
      '.jor-campos,.jor-fotos{grid-template-columns:minmax(0,1fr)}',
      '.jor-esq{padding:16px}',
      '.jor-busca{width:100%}',
      '.jor-pg{grid-template-columns:minmax(0,1fr)}',
      '.jor-tab thead{display:none}',
      '.jor-tab,.jor-tab tbody,.jor-tab tr,.jor-tab td{display:block;width:100%}',
      '.jor-tab tr{border-bottom:1px solid var(--n-bd);padding:8px 10px}',
      '.jor-tab td{border:0;padding:2px 0;white-space:normal}',
      '.jor-tab td[data-r]::before{content:attr(data-r) ": ";color:var(--n-tx3);font-size:12px}',
      '}',
    ].join('\n');
    var st = document.createElement('style'); st.id = 'jor-css'; st.textContent = comReserva(css); document.head.appendChild(st);
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
    ['Nº', 'Cliente', 'Vendida em', 'Etapa', 'Dono', 'Situação'].concat(adm ? ['Dinheiro'] : []).concat(['']).forEach(function (t) { cab.appendChild(el('th', '', t)); });
    add(tab, add(el('thead'), cab));
    var tb = el('tbody');
    var linhas = linhasVisiveis();
    var anoAtual = String(new Date().getFullYear());
    linhas.forEach(function (l) {
      var tr = el('tr', (l.trilho === 'jornada' && (l.situacao.tipo === 'atrasada' || l.situacao.tipo === 'travada') && l.grupo === 'ativas') ? 'jor-atrasada' : '');
      function td(rot, conteudo) { var t = el('td'); t.setAttribute('data-r', rot); if (typeof conteudo === 'string') t.textContent = conteudo; else if (conteudo) t.appendChild(conteudo); tr.appendChild(t); return t; }
      td('Nº', el('span', 'jor-num jor-cl-cod', l.codigo || '*'));
      var tc = td('Cliente', ''); tc.appendChild(el('span', 'jor-cl-nome', l.cliente));
      var sub = [l.kwp ? String(l.kwp).replace('.', ',') + ' kWp' : '', cidadeUF(l.cidade)].filter(Boolean).join(' · '); if (sub) tc.appendChild(el('span', 'jor-cl-sub', sub));
      td('Vendida em', l.vendida_em ? (l.vendida_em.slice(0, 4) === anoAtual ? ddmm(l.vendida_em) : ddmm(l.vendida_em) + '/' + l.vendida_em.slice(0, 4)) : '');
      var te = td('Etapa', '');
      if (l.finalizada) te.appendChild(el('span', 'jor-fin-tag', 'Finalizada'));
      else if (l.etapa) { te.appendChild(el('span', 'jor-cl-bola', l.etapa.n)); te.appendChild(document.createTextNode(l.etapa.nome)); }
      else te.appendChild(document.createTextNode('Sem trilho'));
      var dn = td('Dono', ''); if (l.dono) { dn.appendChild(el('span', 'jor-cl-dono', l.dono.iniciais)); dn.title = nomeBonito(l.dono.nome); }
      var s = td('Situação', l.grupo === 'canceladas' && l.cancelada
        ? 'Cancelada em ' + ddmm(l.cancelada.em) + ' por ' + nomeBonito(l.cancelada.por) + (l.cancelada.motivo ? ' · ' + l.cancelada.motivo : '')
        : l.situacao.texto);
      if (l.situacao.tipo === 'travada' && l.grupo === 'ativas') s.appendChild(el('span', 'jor-tag jor-tag-travada', 'Travada'));
      if (l.numero_pendente) s.appendChild(el('span', 'jor-tag', 'Número pendente'));
      if (adm) {
        var tdn = td('Dinheiro', ''); var textoDin = String(l.dinheiro || ''); var achou = 0;
        textoDin.split(' · ').forEach(function (p) {
          var m = /^(Recebido|A receber|Gasto|Saldo) (.+)$/.exec(p); if (!m) return;
          achou++; var kv = el('div', 'jor-cl-kv' + (m[1] === 'Saldo' && /-/.test(m[2]) ? ' neg' : '')); kv.appendChild(el('span', '', m[1])); kv.appendChild(el('b', '', m[2])); tdn.appendChild(kv);
        });
        if (!achou) tdn.textContent = textoDin;
      }
      var ac = td('', ''); var acd = el('div', 'jor-cl-ac'); ac.appendChild(acd);
      if (l.card) {
        add(acd, btn('Abrir', '', function () { abrirObra(l.card); }));
        if (adm && l.grupo !== 'canceladas' && !l.finalizada) {
          var mn = btn('⋯', 'jor-btn-link', function () { L.menu = L.menu === l.chave ? null : l.chave; desenharLista(); });
          mn.setAttribute('aria-label', 'Mais ações: ' + l.cliente); mn.setAttribute('aria-haspopup', 'menu'); mn.setAttribute('aria-expanded', L.menu === l.chave ? 'true' : 'false');
          acd.appendChild(mn);
          if (L.menu === l.chave) {
            var mm = el('div', 'jor-cl-menu'); mm.setAttribute('role', 'menu');
            var mi = el('button', '', 'Venda cancelada'); mi.type = 'button'; mi.setAttribute('role', 'menuitem'); mi.setAttribute('aria-label', 'Venda cancelada: ' + l.cliente);
            mi.addEventListener('click', function () { L.menu = null; cancelarDialogo(l.card, function () { abrirLista(); }); });
            mm.appendChild(mi); acd.appendChild(mm);
          }
        }
      } else if (l.codigo) {
        add(acd, btn('Abrir', '', function () { abrirPlanilha(l.codigo); }));
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
  // O menu da linha fecha com um clique fora dele.
  document.addEventListener('click', function (e) {
    if (!L.menu || !corpo() || (e.target && e.target.closest && e.target.closest('.jor-cl-ac'))) return;
    L.menu = null; if (L.dados && corpo().querySelector('.jor-tab')) desenharLista();
  });

  // ── A obra ──────────────────────────────────────────────────────────────────
  function sairDaObra() {
    if (O.vdcNo && typeof vdcFechar === 'function') { try { vdcFechar(O.vdcNo); } catch (e) { /* já fechado */ } }
    O.vdcChave = ''; O.vdcNo = null; O.vdcDet = null; O.vdcPainel = 0; O.obraNo = null; O.fase2 = null; O.dinheiro = null; O.ficha = null; O.erroSlot = {}; O.ocupSlot = {};
    O.lendo = null; O.lendoFalhou = ''; if (O.lendoT) { clearTimeout(O.lendoT); O.lendoT = 0; } O.edita = {}; O.rascunho = {}; O.confirmando = {}; O.erroSec = {}; O.abertos = {}; O.vendaEdita = false;
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
    // O quadro de documentos mora num <details> fechado, que o desenharObra põe dentro da etapa 1 a 3 (e esconde nas outras). O #jor-vdc continua o mesmo nó.
    if (!O.vdcDet) { O.vdcDet = el('details', 'jor-vdc-det'); O.vdcDet.open = true; O.vdcDet.appendChild(el('summary', 'jor-vdc-sum', 'Todos os documentos e cadastro')); O.vdcDet.appendChild(O.vdcNo); O.vdcPainel = 0; }
    if (!c.contains(O.obraNo)) c.replaceChildren(O.obraNo);
    O.obraNo.replaceChildren(el('p', 'jor-nota', 'Carregando…'));
    carregarObra();
  }

  function carregarObra() {
    var seq = ++O.seq; var card = O.card;
    var base = '/gerador/jornada-solar/obra/' + encodeURIComponent(card);
    return Promise.all([api(base, 'GET'), api(base + '/fase2', 'GET'), api(base + '/dinheiro', 'GET'), api(base + '/fase3', 'GET'), api(base + '/ficha', 'GET', undefined, 6000)]).then(function (rs3) {
      var r = rs3[0], rf = rs3[1], rd = rs3[2], r3 = rs3[3];
      // Preencher (06/11/2026): a ficha consolidada. Sem ela (rota fora, 404, 503) os formulários abrem como sempre.
      var rfi = rs3[4]; O.ficha = (rfi && rfi.status === 200 && rfi.json && rfi.json.ok !== false && rfi.json.ficha && rfi.json.ficha.v === 1) ? rfi.json.ficha : null;
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
        // Depois do Trazer (ou de qualquer volta de finalizada), o desenharObra põe o quadro de documentos de volta na etapa.
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

  /** Etiqueta do desenho: tipo auto, ok, av (falta) ou er. */
  function etq(txt, tipo) { return el('span', 'jor-etq' + (tipo ? ' jor-etq-' + tipo : ''), txt); }
  /** "dd/mm às hh:mm" no horário de Brasília. */
  function quando(iso) {
    var dt = new Date(iso); if (isNaN(dt.getTime())) return '';
    try {
      var g = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(dt).forEach(function (x) { g[x.type] = x.value; });
      return g.day + '/' + g.month + ' às ' + g.hour + ':' + g.minute;
    } catch (e) { return ''; }
  }
  /**
   * O arquivo deste item. Quem diz de onde ele veio é o servidor (origem_slots da obra): dossiê da proposta ou Planilha (#NNNN) são só
   * leitura, com o link quando ele já chegou (o do dossiê vem do quadro; o da Planilha, da ficha). O resto é do card.
   */
  function arquivoDoSlot(chave, id) {
    var org = id != null ? '' : ((O.dados && O.dados.origem_slots && O.dados.origem_slots[chave]) || '');
    var st = (typeof vdcEst !== 'undefined') ? vdcEst : null;
    var temSt = !!(st && String(st.id) === String(O.card) && st.docs);
    // Item com vários arquivos (as contas do excedente): `id` escolhe UM arquivo do item.
    if (id != null) {
      if (!temSt || !Array.isArray(st.docs.arquivos)) return null;
      return st.docs.arquivos.filter(function (a) { return a && a.slot === chave && String(a.id) === String(id); })[0] || null;
    }
    if (org === 'dossie') {
      var dd = (temSt && st.docs.dossie && Array.isArray(st.docs.dossie.arquivos)) ? st.docs.dossie.arquivos.filter(function (a) { return a && a.slot === chave; }) : [];
      return { url: dd.length ? (dd[dd.length - 1].url || '') : '', em: '', fora: 'dossiê da proposta' };
    }
    if (org === 'planilha') {
      var fo = (O.ficha && Array.isArray(O.ficha.documentos_fora)) ? O.ficha.documentos_fora.filter(function (a) { return a && a.slot === chave; }) : [];
      var y = fo.length ? fo[fo.length - 1] : null;
      return { url: (y && y.url) || '', em: (y && y.em) || '', fora: 'planilha' };
    }
    if (!temSt || !Array.isArray(st.docs.arquivos)) return null;
    var l = st.docs.arquivos.filter(function (a) { return a && a.slot === chave; });
    return l.length ? l[l.length - 1] : null;
  }

  // ── Anexos: trocar, apagar e o erro do item ─────────────────────────────────
  // O quadro de documentos (vdcEst) mora no <details> fechado e é quem fala com a API. Aqui a Jornada espera ele carregar, usa as funções dele
  // e mostra o resultado na própria tela. O erro e o "enviando" de cada item moram em O (a obra se redesenha depois de cada gravação).
  function quadroDoCard() { var st = (typeof vdcEst !== 'undefined') ? vdcEst : null; return (st && String(st.id) === String(O.card)) ? st : null; }
  /** Espera o quadro deste card terminar de carregar. Devolve o st, ou null se não carregou ou se `no` saiu da tela. */
  function quadroPronto(no, ms) {
    return new Promise(function (ok) {
      var t0 = Date.now();
      // A 1ª checagem espera um tick: o nó de quem chama ainda está sendo montado, fora da tela.
      setTimeout(function volta() {
        if (no && !no.isConnected) { ok(null); return; }
        var st = quadroDoCard();
        if (st && !st.carregando) { ok(st.docs ? st : null); return; }
        if (Date.now() - t0 > (ms || 25000)) { ok(null); return; }
        setTimeout(volta, 150);
      }, 0);
    });
  }
  /** Monta o quadro se ainda não estiver montado (ele nasce junto da obra) e espera ele carregar. */
  function garantirQuadro() {
    if (!quadroDoCard()) { O.vdcChave = ''; montarQuadro(); }
    return quadroPronto(null, 25000);
  }
  /** Quem pode trocar e apagar é decidido pelo servidor (pode_remover). null enquanto o quadro não carregou. */
  function podeMexer() { var st = quadroDoCard(); return (st && !st.carregando && st.docs) ? !!st.docs.pode : null; }

  /** Manda o arquivo: Trocar (troca=true, o antigo sai na mesma gravação) ou anexar o primeiro. Erro vira linha do item e aviso. */
  function enviarArquivo(chave, arqs, troca, refazer, opc) {
    opc = opc || {}; var ck = opc.ck || chave;   // ck: a chave do estado na tela (item com vários arquivos tem uma por arquivo)
    if (O.ocupSlot[ck]) return;
    var card = String(O.card); var falha = ''; var idsAntes = null;
    delete O.erroSlot[ck];
    O.ocupSlot[ck] = troca ? 'Trocando o arquivo…' : 'Enviando…';
    refazer();
    garantirQuadro().then(function (st) {
      if (!st) { falha = 'Não consegui abrir os documentos agora. Tente de novo.'; return null; }
      idsAntes = idsDoSlot(chave);
      if (troca) {
        var a = arquivoDoSlot(chave, opc.id);
        if (!a || a.fora || a.id == null) { falha = 'Não achei o arquivo atual deste item. Atualize a tela e tente de novo.'; return null; }
        if (typeof window.vdcTrocarEnviar !== 'function') { falha = 'Não consegui trocar agora. Atualize a página.'; return null; }
        return window.vdcTrocarEnviar(st, a, arqs[0]).then(function (r) { if (!r || !r.ok) falha = (r && r.erro) || 'Não consegui trocar o arquivo agora. O arquivo atual continua no lugar.'; });
      }
      if (typeof window.vdcAnexar !== 'function') { falha = 'Não consegui anexar agora. Atualize a página.'; return null; }
      return window.vdcAnexar(st, { chave: chave }, arqs).then(function () {
        var m = st.msgDoc && st.msgDoc[chave]; var rs = st.resDoc && st.resDoc[chave];
        if (!m && rs && rs.falhas && rs.falhas.length) m = rs.falhas[0].msg;
        if (m) falha = m;
      });
    }).catch(function () { falha = 'Não consegui enviar agora. Tente de novo.'; }).then(function () {
      delete O.ocupSlot[ck];
      if (falha) { if (String(O.card) === card) O.erroSlot[ck] = falha; toast(falha); }
      // CNH e conta de luz: o servidor lê o documento sozinho depois do upload. A tela espera a ficha do cliente mudar,
      // mas só quando há campo vazio para preencher e o arquivo é novo (arquivo repetido não cria linha nova no item: nada novo para ler).
      if (!falha && String(O.card) === card && SLOTS_LIDOS[chave]) {
        var idsDepois = idsDoSlot(chave);
        var repetido = !troca && !!idsAntes && !!idsDepois && idsDepois.every(function (i) { return idsAntes.indexOf(i) >= 0; });
        depoisDoUpload(chave, repetido);
      }
      if (String(O.card) === card) releia();
    });
  }

  /** Apagar: confirma na própria tela (diálogo da Jornada) e só então chama o quadro. */
  function pedirApagar(chave, rotulo, id, ck) {
    ck = ck || chave;
    var card = String(O.card);
    var a0 = arquivoDoSlot(chave, id);
    var nome = (a0 && !a0.fora && (a0.rotulo || a0.nome)) || rotulo;
    var dlgEl = null;
    var id0 = (a0 && !a0.fora && a0.id != null) ? String(a0.id) : '';   // o arquivo que a pessoa viu no diálogo: é ele que sai, nenhum outro
    dialogo('Apagar arquivo', function (c) {
      c.appendChild(el('p', 'jor-nota', 'Apagar "' + nome + '"? O arquivo é apagado e não dá para desfazer.'));
      var info = el('p', 'jor-erro'); info.setAttribute('role', 'alert'); c.appendChild(info);
      return {};
    }, 'Apagar', function (b, c) {
      var info = c.querySelector('.jor-erro'); info.textContent = '';
      b.disabled = true; b.textContent = 'Apagando…';
      garantirQuadro().then(function (st) {
        if (!st) return { ok: false, erro: 'Não consegui abrir os documentos agora. Tente de novo.' };
        var a = arquivoDoSlot(chave, id);
        if (!id0 || !a || a.fora || a.id == null) return { ok: false, erro: 'Não achei este arquivo. Atualize a tela.' };
        if (String(a.id) !== id0) return { ok: false, erro: 'Este item mudou desde que você abriu o aviso. Feche, confira o arquivo e tente de novo.' };
        if (typeof window.vdcExcluirJa !== 'function') return { ok: false, erro: 'Não consegui apagar agora. Atualize a página.' };
        return window.vdcExcluirJa(st, a);
      }).catch(function () { return { ok: false, erro: 'Não consegui apagar agora. Tente de novo.' }; }).then(function (r) {
        if (r && r.ok) { delete O.erroSlot[ck]; if (dlgEl && dlgEl.isConnected) fecharDlg(); if (String(O.card) === card) releia(); return; }
        if (!b.isConnected) return;
        b.disabled = false; b.textContent = 'Apagar'; info.textContent = (r && r.erro) || 'Não consegui apagar agora. Tente de novo.';
      });
    });
    dlgEl = document.querySelector('.jor-dlg');   // o diálogo é este: se a pessoa o fechar e abrir outro, o sucesso daqui não fecha o novo
  }

  /** O seletor de arquivo: um rótulo que abre o seletor do aparelho. `aoEscolher(arquivos)` roda quando a pessoa escolhe. */
  function seletor(rot, aceita, camera, cls, ariaRot, aoEscolher) {
    var lab = el('label', cls, rot);
    var inp = el('input'); inp.type = 'file'; inp.accept = aceita; inp.style.display = 'none'; if (camera) inp.setAttribute('capture', 'environment');
    inp.setAttribute('aria-label', rot + ': ' + ariaRot);
    inp.addEventListener('change', function () {
      var arqs = Array.prototype.slice.call(inp.files || []); inp.value = '';
      if (arqs.length) aoEscolher(arqs);
    });
    lab.appendChild(inp); lab.tabIndex = 0;
    lab.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    return lab;
  }
  var ACEITA_PADRAO = 'image/*,application/pdf';
  var ACEITA_KMZ = '.kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml';

  /** Anexo: o mesmo componente em todo lugar. Usa o quadro de documentos montado. Vazio: caixa tracejada com Foto, Arquivo e Print. Preenchido: bloco verde com miniatura, data, Trocar e Apagar.
   *  opts: compacto; id (um arquivo de um item com vários); ck (chave do estado); aceita (só o botão Arquivo, com este filtro: o KMZ). */
  function anexo(chave, rotulo, tem, opts) {
    opts = opts || {};
    var ck = opts.ck || (opts.id != null ? chave + '#' + opts.id : chave);
    var aceitaTudo = opts.aceita || ACEITA_PADRAO;
    var linha = el('div', 'jor-anexo');
    function entrada(rot, aceita, camera, cls, troca) {
      return seletor(rot, aceita, camera, cls, rotulo, function (arqs) { enviarArquivo(chave, arqs, !!troca, montar, { id: opts.id, ck: ck }); });
    }
    function montar() {
      linha.replaceChildren();
      if (!opts.compacto) {
        var tp = el('div', 'jor-anexo-topo'); tp.appendChild(el('span', 'jor-rot', rotulo));
        tp.appendChild(etq(tem ? 'Anexado' : 'Falta', tem ? 'ok' : 'av')); linha.appendChild(tp);
      }
      if (O.ocupSlot[ck]) { var oc = el('p', 'jor-nota', O.ocupSlot[ck]); oc.setAttribute('role', 'status'); linha.appendChild(oc); return; }
      if (tem) {
        var fora = arquivoDoSlot(chave, opts.id);
        if (fora && fora.fora) {
          // Já existe em outro depósito: mostra, só leitura. Ninguém sobe de novo nem apaga.
          var ok2 = el('div', 'jor-anexo-ok'); var mini2 = el('span', 'jor-anexo-mini');
          if (fora.url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(fora.url))) { var im2 = el('img'); im2.src = fora.url; im2.alt = ''; im2.loading = 'lazy'; mini2.appendChild(im2); } else mini2.appendChild(icone('ok'));
          ok2.appendChild(mini2);
          var leg2 = el('span', 'jor-anexo-leg'); leg2.appendChild(el('b', '', 'Anexado')); var dt2 = fora.em ? dataBr(fora.em) : ''; if (dt2) leg2.appendChild(el('small', '', dt2));
          leg2.appendChild(veio({ rotulo: fora.fora })); ok2.appendChild(leg2);
          if (fora.url && /^https:\/\//.test(fora.url)) { var ab2 = el('a', 'jor-anexo-trocar', 'Abrir'); ab2.href = fora.url; ab2.target = '_blank'; ab2.rel = 'noopener noreferrer'; ok2.appendChild(ab2); }
          linha.appendChild(ok2);
        } else {
          var ok = el('div', 'jor-anexo-ok');
          var mini = el('span', 'jor-anexo-mini'); var arq = fora;
          if (arq && arq.url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(arq.nome || arq.url))) { var im = el('img'); im.src = arq.url; im.alt = ''; im.loading = 'lazy'; mini.appendChild(im); } else mini.appendChild(icone('ok'));
          ok.appendChild(mini);
          var leg = el('span', 'jor-anexo-leg'); leg.appendChild(el('b', '', (arq && (arq.nome || arq.rotulo)) || 'Anexado'));
          var dt = arq && arq.em ? dataBr(arq.em) : ''; if (dt) leg.appendChild(el('small', '', dt));
          ok.appendChild(leg);
          // Trocar e Apagar: quem pode é o servidor (pode_remover). Antes do quadro carregar, o Trocar já aparece e o Apagar chega junto com a resposta.
          var acoes = el('span', 'jor-anexo-acoes'); var pode = podeMexer();
          var troc = pode === false ? null : entrada('Trocar', aceitaTudo, false, 'jor-anexo-trocar', true);
          if (troc) acoes.appendChild(troc);
          var apagar = function () {
            var b = el('button', 'jor-anexo-trocar jor-anexo-apagar', 'Apagar'); b.type = 'button'; b.setAttribute('aria-label', 'Apagar arquivo: ' + rotulo);
            b.addEventListener('click', function () { pedirApagar(chave, rotulo, opts.id, ck); });
            return b;
          };
          if (pode === true) acoes.appendChild(apagar());
          else if (pode === null) {
            quadroPronto(acoes).then(function (st2) {
              if (!st2 || !acoes.isConnected) return;
              if (!st2.docs.pode) { if (troc && troc.parentNode) troc.parentNode.removeChild(troc); return; }
              var a2 = arquivoDoSlot(chave, opts.id);
              if (a2 && !a2.fora && a2.id != null) acoes.appendChild(apagar());
            });
          }
          if (acoes.firstChild || pode === null) ok.appendChild(acoes);
          linha.appendChild(ok);
        }
      } else {
        var bts = el('div', 'jor-anexo-bts');
        if (opts.aceita) add(bts, entrada('Arquivo', aceitaTudo, false, 'jor-anexo-bt'));
        else add(bts, entrada('Foto', 'image/*', true, 'jor-anexo-bt'), entrada('Arquivo', aceitaTudo, false, 'jor-anexo-bt'), entrada('Print', 'image/*', false, 'jor-anexo-bt'));
        linha.appendChild(bts);
      }
      if (O.erroSlot[ck]) { var er = el('p', 'jor-erro jor-anexo-msg', O.erroSlot[ck]); er.setAttribute('role', 'alert'); linha.appendChild(er); }
    }
    montar();
    return linha;
  }

  function blocoTitulo(t, itens) {
    var falta = itens ? itens.filter(function (i) { return !i.feito; }).length : 0;
    var h = el('div', 'jor-bloco-t'); h.appendChild(el('span', '', t));
    if (itens) { var em = el('em', 'jor-etq jor-etq-' + (falta ? 'av' : 'ok'), falta ? 'Falta ' + falta : 'Completo'); h.appendChild(em); }
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

  function abrirQuadro() { if (O.vdcDet) { O.vdcDet.open = true; if (O.vdcNo && O.vdcNo.scrollIntoView) O.vdcNo.scrollIntoView({ behavior: 'smooth' }); } }
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
  function itemFeito(et, chave) { var x = et.itens.filter(function (i) { return i.chave === chave; })[0]; return !!(x && x.feito); }
  function cidadeUF(c) { return String(c || '').replace(/\s+-\s+/, '-').trim(); }
  /** Campo rotulado do desenho: rótulo (com etiqueta opcional) em cima, o controle embaixo. */
  function campoRot(rot, ctl, etiq, larga) {
    var c = el('div', 'jor-campo' + (larga ? ' jor-campo-larga' : ''));
    var r = el('div', 'jor-campo-rot'); r.appendChild(document.createTextNode(rot)); if (etiq) r.appendChild(etiq);
    c.appendChild(r); c.appendChild(ctl); return c;
  }
  function subTitulo(txt, etiq) { var t = el('div', 'jor-sub-t'); t.appendChild(el('span', '', txt)); if (etiq) t.appendChild(etiq); return t; }

  /** O formulário do bloco "Você confirma". O formato do PUT /venda é o mesmo de sempre: valor, kit, prazo, nota, desconto e de 1 a 6 formas de pagamento. */
  /** Preencher: as sugestões da ficha para um formulário (sempre um objeto). */
  function sugs(form) { var f = O.ficha && O.ficha.sugestoes; return (f && f[form]) || {}; }
  /** A marca discreta "Veio de: <fonte>". Sai no primeiro toque da pessoa no campo. */
  function veio(s, inp) {
    var m = el('span', 'jor-auto', 'Veio de: ' + String((s && s.rotulo) || ''));
    if (inp) inp.addEventListener('input', function () { if (m.parentNode) m.parentNode.removeChild(m); }, { once: true });
    return m;
  }
  function formVenda(pai, d, onSalvo, et) {
    var v = d.venda || { valor_centavos: 0, pagamento: [], desconto_centavos: null, prazo_prometido: '', nota: '', kit_confirmado: false };
    var f = el('div'); var info = el('p', 'jor-erro'); info.setAttribute('role', 'status');
    var valor = el('input', 'jor-in'); valor.type = 'text'; valor.inputMode = 'decimal'; valor.setAttribute('aria-label', 'Valor vendido'); valor.value = v.valor_centavos ? (v.valor_centavos / 100).toFixed(2).replace('.', ',') : '';
    var desc = el('input', 'jor-in'); desc.type = 'text'; desc.inputMode = 'decimal'; desc.setAttribute('aria-label', 'Desconto dado'); desc.value = v.desconto_centavos ? (v.desconto_centavos / 100).toFixed(2).replace('.', ',') : '';
    var prazo = el('input', 'jor-in'); prazo.type = 'text'; prazo.maxLength = 200; prazo.setAttribute('aria-label', 'Prazo prometido ao cliente'); prazo.value = v.prazo_prometido || '';
    var nota = el('textarea', 'jor-ta'); nota.maxLength = 500; nota.setAttribute('aria-label', 'Nota da negociação'); nota.value = v.nota || '';
    var etPrazo = etq('Falta', 'av'); var trava = el('span', 'jor-nota', 'Trava a etapa.'); trava.style.margin = '0';
    var etValor = etq('Falta', 'av');
    // Preencher: sem venda gravada, o que já existe (proposta, ou planilha para quem a vê) abre no campo vazio, com a marca.
    var sv = d.venda ? {} : sugs('venda');
    function pre(inp, s, txt) { if (!s || inp.value) return null; inp.value = txt; return veio(s, inp); }
    var mValor = pre(valor, sv.valor_centavos, sv.valor_centavos ? (Number(sv.valor_centavos.valor) / 100).toFixed(2).replace('.', ',') : '');
    var mPrazo = pre(prazo, sv.prazo_prometido, sv.prazo_prometido ? String(sv.prazo_prometido.valor).slice(0, 200) : '');
    var mNota = pre(nota, sv.nota, sv.nota ? String(sv.nota.valor).slice(0, 500) : '');
    var rotValor = el('span'); rotValor.appendChild(etValor); if (mValor) rotValor.appendChild(mValor);
    function marcaFaltas() {
      // A etiqueta tem display próprio (inline-flex) que vence o atributo hidden: some pelo style.display também.
      function mostra(x, on) { x.hidden = !on; x.style.display = on ? '' : 'none'; }
      var pv = !prazo.value.trim(); prazo.classList.toggle('falta', pv); mostra(etPrazo, pv); mostra(trava, pv);
      var vv = !(cents(valor.value) > 0); valor.classList.toggle('falta', vv); mostra(etValor, vv);
    }
    var grade = el('div', 'jor-campos');
    add(grade, campoRot('Valor vendido', valor, rotValor), campoRot('Desconto dado', desc),
      campoRot('Prazo prometido ao cliente', prazo, (function () { var s = el('span'); s.appendChild(etPrazo); s.appendChild(document.createTextNode(' ')); s.appendChild(trava); if (mPrazo) s.appendChild(mPrazo); return s; })(), true));
    var pgBox = el('div'); var linhas = [];
    function addLinha(p) {
      var row = el('div', 'jor-pg');
      var fs = el('select', 'jor-sel'); fs.setAttribute('aria-label', 'Forma de pagamento');
      [['pix', 'Pix'], ['ted', 'TED'], ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['financiamento', 'Financiamento'], ['dinheiro', 'Dinheiro']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; fs.appendChild(op); });
      fs.value = p ? p.forma : 'pix';
      var vl = el('input', 'jor-in'); vl.type = 'text'; vl.inputMode = 'decimal'; vl.setAttribute('aria-label', 'Valor desta forma'); vl.placeholder = 'Valor'; vl.value = p ? (p.valor_centavos / 100).toFixed(2).replace('.', ',') : '';
      var ob = el('input', 'jor-in'); ob.type = 'text'; ob.maxLength = 60; ob.setAttribute('aria-label', 'Observação'); ob.placeholder = 'Observação curta'; ob.value = p ? p.obs : '';
      add(row, fs, vl, ob); pgBox.appendChild(row);
      var ref = { fs: fs, vl: vl, ob: ob }; linhas.push(ref);
      [fs, vl, ob].forEach(function (x) { x.addEventListener('input', recalc); });
    }
    var FORMAS_OK = ['pix', 'ted', 'boleto', 'cartao', 'financiamento', 'dinheiro'];
    var pgSug = !v.pagamento.length && sv.forma && sv.valor_centavos && FORMAS_OK.indexOf(String(sv.forma.valor)) >= 0 ? [{ forma: String(sv.forma.valor), valor_centavos: Number(sv.valor_centavos.valor), obs: '' }] : null;
    (v.pagamento.length ? v.pagamento : (pgSug || [null])).forEach(addLinha);
    var mais = btn('Mais uma forma', '', function () { if (linhas.length < 6) { addLinha(null); recalc(); } });
    var salvar = btn('Salvar', 'jor-btn-pri', function () {
      salvar.disabled = true; info.textContent = '';
      var pedido = {
        valor_centavos: cents(valor.value), kit_confirmado: !!v.kit_confirmado, prazo_prometido: prazo.value.trim(), nota: nota.value.trim(),
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
      marcaFaltas();
    }
    valor.addEventListener('input', recalc); prazo.addEventListener('input', marcaFaltas);
    recalc();
    void et;
    // Duas fontes que discordam: a de baixo aparece como nota (só quem vê as duas recebe a "alt").
    var cv = O.ficha && O.ficha.campos && O.ficha.campos['venda.valor_centavos'];
    var difere = (cv && cv.alt && typeof cv.alt.valor === 'number') ? el('p', 'jor-nota', 'A ' + cv.alt.rotulo + ' diz ' + reais(cv.alt.valor) + '.') : null;
    add(f, grade, difere, subTitulo('Forma de pagamento', pgSug ? veio(sv.forma) : null), pgBox, mais, subTitulo('Nota da negociação', mNota), nota, info, el('div', 'jor-sub-t'), salvar);
    pai.appendChild(f);
  }

  // ── A página do cliente (18/11/2026): o RESUMO no topo e a LINHA DO TEMPO embaixo ────────────────────────────────
  // O resumo junta a ficha do cliente, a venda, a situação e o dinheiro, e vai se preenchendo ("Aguardando") conforme os passos andam.
  // A linha do tempo segue a ordem do trabalho, um passo por vez: o passo atual fica aberto; o feito mostra o resultado em uma linha
  // com Editar; o futuro aparece apagado com o que vai pedir. Dado que está no resumo não se repete no passo: o passo só tem a ação.

  /** O "?" com a explicação longa no title (e no leitor de tela). */
  function ajudaQ(txt) { var q = el('span', 'jor-q', '?'); q.title = txt; q.tabIndex = 0; q.setAttribute('role', 'img'); q.setAttribute('aria-label', 'Ajuda: ' + txt); return q; }
  /** Texto só para o leitor de tela. */
  function srTxt(t) { var s = el('span', '', t); s.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap'; return s; }
  function juntar(l) { return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]; }
  /** Os itens do servidor das etapas 1 a 3 por chave (o passo não depende de em qual etapa a api pôs o item). */
  function itensDe(d, chaves) {
    var out = []; (d.etapas || []).slice(0, 3).forEach(function (e) { (e.itens || []).forEach(function (i) { if (chaves.indexOf(i.chave) >= 0) out.push(i); }); });
    return out;
  }
  function todosFeitos(l) { return l.every(function (i) { return i.feito; }); }
  function irPara(id) {
    var a = document.getElementById(id); if (!a) return;
    var reduz = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    a.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' });
    try { a.focus({ preventScroll: true }); } catch (e) { /* sem foco */ }
  }
  /** Celular: rola até o passo atual da linha do tempo (ou o primeiro pendente, ou o título "Passo a passo" se não houver nenhum). */
  function irAoPassoAtual() {
    var no = document.querySelector('#jor-obra .jor-tl-no.atual') || document.querySelector('#jor-obra .jor-tl-no.pendente');
    irPara(no && no.id ? no.id : 'jor-tl-tit');
  }
  function quem(c) { var q = c && c.em ? quando(c.em) : ''; return (c && c.por ? ' por ' + nomeBonito(c.por) : '') + (q ? ' em ' + q : ''); }
  function ultimaMarca(d, chaves) { return chaves.map(function (k) { return conf(d, k); }).filter(Boolean).sort(function (a, b) { return String(b.em || '').localeCompare(String(a.em || '')); })[0] || null; }
  function etapaFeita(e, atual) { return !!(e && (e.concluida_em || atual > e.n)); }

  // ── A página ───────────────────────────────────────────────────────────────────────────────────────────────
  var TITULO_QUADRO = 'Todos os documentos e cadastro';
  function desenharObra() {
    var d = O.dados; var n = O.obraNo; if (!d || !n) return;
    var raiz = el('div');
    var atual = atualEtapa(); var ets = etapasMescladas();
    raiz.appendChild(resumoObra(d, atual));
    if (d.cancelada) {
      var fx = el('div', 'jor-faixa', 'Venda cancelada em ' + ddmm(d.cancelada.em) + ' por ' + nomeBonito(d.cancelada.por) + '. Motivo: ' + (d.cancelada.motivo || ''));
      if (d.pode.descancelar) fx.appendChild(btn('Desfazer o cancelamento', '', function () { desfazerDialogo(); }));
      raiz.appendChild(fx);
    }
    if (d.aviso) raiz.appendChild(el('p', 'jor-aviso', d.aviso));
    var cols = el('div', 'jor-cols'); var esq = el('section', 'jor-esq jor-cartao'); var dir = el('div', 'jor-dir');
    esq.setAttribute('aria-labelledby', 'jor-tl-tit');
    var topo = el('div', 'jor-etapa-topo'); var idc = el('div', 'jor-etapa-id');
    var ht = el('h3', 'jor-etapa-t', 'Passo a passo'); ht.id = 'jor-tl-tit'; idc.appendChild(ht);
    if (atual) idc.appendChild(el('span', 'jor-pilula', 'Etapa ' + atual + ' de 9'));
    topo.appendChild(idc); esq.appendChild(topo);
    esq.appendChild(linhaDoTempo(d, ets, atual));
    if (O.msg) { var mm = el('p', 'jor-erro', O.msg); mm.setAttribute('role', 'status'); esq.appendChild(mm); }
    // Prazo e cobrança da etapa atual, ao lado.
    var et = ets[(atual || 1) - 1]; var f2 = O.fase2;
    var pz = el('div', 'jor-bloco'); pz.appendChild(el('div', 'jor-bloco-t', 'Prazo e cobrança'));
    pz.appendChild(el('p', 'jor-nota', 'Etapa ' + et.n + ' · ' + et.nome)); pz.lastChild.style.marginTop = '0';
    if (et.prazo && et.prazo.vence) pz.appendChild(el('p', '', et.prazo.rotulo + ' · ' + ddmm(et.prazo.vence)));
    var sit = et.situacao || { tipo: 'sem_prazo', texto: '' };
    pz.appendChild(el('p', sit.tipo === 'atrasada' || sit.tipo === 'travada' ? 'jor-erro' : sit.tipo === 'no_prazo' || sit.tipo === 'vence_hoje' ? 'jor-ok' : '', sit.texto));
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
    // O quadro completo (documentos, ligações e cadastro): uma vez só, no fim da página, aberto. Os anexos e o Trello dependem dele montado.
    if (O.vdcDet) {
      O.vdcPainel = atual;
      O.vdcDet.firstChild.textContent = TITULO_QUADRO; O.vdcDet.className = 'jor-vdc-det jor-quadro jor-cartao'; O.vdcDet.id = 'jor-quadro';
      raiz.appendChild(O.vdcDet);
    }
    n.replaceChildren(raiz);
  }

  // ── O resumo ────────────────────────────────────────────────────────────────────────────────────────────────
  function resumoObra(d, atual) {
    var box = el('section', 'jor-res jor-cartao'); box.setAttribute('aria-labelledby', 'jor-res-tit');
    var topo = el('div', 'jor-res-topo');
    topo.appendChild(el('span', 'jor-num jor-res-cod', d.codigo || '*'));
    var t = el('div', 'jor-cab-t'); var h = el('h2', '', d.card.cliente); h.id = 'jor-res-tit'; t.appendChild(h);
    var kwpTxt = d.proposta && d.proposta.kwp ? String(d.proposta.kwp).replace('.', ',') + ' kWp' : '';
    t.appendChild(el('span', '', [kwpTxt, cidadeUF(d.card.cidade)].filter(Boolean).join(' · ')));
    topo.appendChild(t);
    var cac = el('div', 'jor-cab-ac');
    if (window.Jornada.extras.bookPdf && O.fase3 && O.fase3.pode && O.fase3.pode.book) { var bdoc = btn('Documento da obra', '', function () { window.Jornada.extras.bookPdf(O.card, bdoc); }); cac.appendChild(bdoc); }
    if (O.dinheiro && O.dinheiro.visivel !== false && O.dinheiro.livro && window.Jornada.dinheiro) add(cac, btn('Livro do dinheiro', '', function () { window.Jornada.dinheiro.abrirLivro(); }));
    add(cac, btn('Clientes', '', abrirLista));
    if (d.pode.cancelar) add(cac, btn('Venda cancelada', 'jor-btn-disc', function () { cancelarDialogo(O.card, carregarObra); }));
    topo.appendChild(cac);
    box.appendChild(topo);
    var ir = btn('Ir para o passo atual', 'jor-btn-link jor-ir-atual', irAoPassoAtual); ir.appendChild(icone('baixo')); box.appendChild(ir);
    var g = el('div', 'jor-res-g');
    g.appendChild(grupoCliente(d)); g.appendChild(grupoVenda(d));
    box.appendChild(g);
    box.appendChild(grupoSituacao(d));
    var dz = el('div', 'jor-res-din');
    if (window.Jornada.dinheiro && window.Jornada.dinheiro.faixa) window.Jornada.dinheiro.faixa(dz, O.dinheiro);
    // Comissões (da etapa 2 em diante) e o prêmio de quem indicou moram com o dinheiro.
    if (atual >= 2 && O.dinheiro && O.dinheiro.visivel !== false && window.Jornada.dinheiro && window.Jornada.dinheiro.blocoComissoes) window.Jornada.dinheiro.blocoComissoes(dz, d, O.dinheiro);
    if (window.Jornada.extras.indicacao) window.Jornada.extras.indicacao(dz, d, O.fase3);
    if (dz.firstChild) box.appendChild(dz);
    return box;
  }
  function tituloGrupo(txt, etiq) { var t = el('div', 'jor-grp-t'); t.appendChild(el('h3', '', txt)); if (etiq) t.appendChild(etiq); return t; }
  function grupoCliente(d) {
    var box = el('div', 'jor-grp'); box.id = 'jor-s-cliente'; box.tabIndex = -1;
    var its = itensDe(d, CAMPOS_CLIENTE.map(function (c) { return c.chave; }));
    var falta = its.filter(function (i) { return !i.feito; }).length;
    var tg = tituloGrupo('Cliente', its.length ? etq(falta ? 'Falta confirmar ' + falta : 'Confirmado', falta ? 'av' : 'ok') : null);
    tg.appendChild(ajudaQ('A IA lê a CNH (nome e CPF) e a conta de luz (endereço) e preenche aqui. Dado editado volta a pedir confirmação no passo 4.'));
    box.appendChild(tg);
    if (O.lendo && O.lendo.card === String(O.card)) {
      var l = el('p', 'jor-lendo'); l.setAttribute('role', 'status'); l.appendChild(el('i')); l.appendChild(document.createTextNode('Lendo ' + O.lendo.qual + '…')); box.appendChild(l);
    } else if (O.lendoFalhou) {
      var f = el('p', 'jor-aviso', 'Não consegui ler ' + O.lendoFalhou + '. Preencha à mão.'); f.setAttribute('role', 'alert'); f.style.margin = '0 0 10px'; box.appendChild(f);
    }
    var g = el('div', 'jor-ficha-g'); var et1 = d.etapas[0];
    ficha().forEach(function (cfg) { g.appendChild(campoFicha(d, et1, cfg)); });
    box.appendChild(g);
    return box;
  }
  /** Uma linha de leitura do resumo: vazio vira "Aguardando", em tom apagado. */
  function linhaRes(rot, valor, ok, cls) {
    var v = valor ? (typeof valor === 'string' ? el('div', 'jor-rc-v' + (cls ? ' ' + cls : ''), valor) : valor) : el('div', 'jor-rc-v vazio', 'Aguardando');
    return celula(rot, v, ok && !!valor);
  }
  function grupoVenda(d) {
    var box = el('div', 'jor-grp');
    var vv = d.venda; var dc = d.dados_cliente || {}; var kv = d.kit_vendido || {};
    var vede = !!(vv && vv.valor_centavos !== undefined) || (dc && dc.valor_centavos !== undefined);   // quem vê o valor é decidido pela api (o vendedor vê, mesmo sem o Livro)
    box.appendChild(tituloGrupo('Venda'));
    var g = el('div', 'jor-resumo uma');
    var kw = kv.kwp || (d.proposta && d.proposta.kwp);
    g.appendChild(linhaRes('Proposta', d.proposta ? d.proposta.codigo + (kw ? ' · ' + String(kw).replace('.', ',') + ' kWp' : '') : ''));
    g.appendChild(linhaRes('Placas', txtKit(kv.placas), !!conf(d, 'placas')));
    g.appendChild(linhaRes('Inversor', txtKit(kv.inversor), !!conf(d, 'inversor')));
    var valorC = vv && vv.valor_centavos > 0 ? vv.valor_centavos : (typeof dc.valor_centavos === 'number' && dc.valor_centavos > 0 ? dc.valor_centavos : 0);
    var pgs = vv && vv.pagamento && vv.pagamento.length ? vv.pagamento : (Array.isArray(dc.pagamento) ? dc.pagamento : []);
    var temDin = vede && ((vv && vv.valor_centavos !== undefined) || dc.valor_centavos !== undefined);
    if (temDin) {
      var vc = null; if (valorC) { vc = el('div', 'jor-rc-v', reais(valorC)); if (vv && vv.desconto_centavos > 0) vc.appendChild(el('small', '', 'Desconto de ' + reais(vv.desconto_centavos))); }
      g.appendChild(linhaRes('Valor', vc, !!conf(d, 'valor')));
      var pv = null; if (pgs.length) { pv = el('div', 'jor-rc-v'); pgs.forEach(function (x) { pv.appendChild(el('span', 'jor-rc-lin', (FORMAS_ROT[x.forma] || x.forma) + ' ' + reais(x.valor_centavos) + (x.obs ? ' · ' + x.obs : ''))); }); }
      g.appendChild(linhaRes('Pagamento', pv, !!conf(d, 'pagamento')));
    }
    g.appendChild(linhaRes('Prazo', vv && vv.prazo_prometido ? vv.prazo_prometido : ''));
    var e1 = d.etapas[0]; var vEm = e1 && e1.aberta_em ? quando(e1.aberta_em).split(' ')[0] : '';
    g.appendChild(linhaRes('Vendedor', nomeBonito(d.card.vendedor) + (vEm ? ' · ' + vEm : '')));
    if (vv && vv.nota) g.appendChild(linhaRes('Nota', vv.nota));
    box.appendChild(g);
    return box;
  }
  function sitCel(rot, valor, cls, link) {
    var c = el('div', 'jor-sit-c' + (valor ? (cls ? ' ' + cls : '') : ' vazio'));
    c.appendChild(el('small', '', rot));
    var b = el('b', '', valor || 'Aguardando'); c.appendChild(b);
    if (link && /^https:\/\//.test(link.url)) { var a = el('a', '', link.rot); a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', link.rot + ': ' + rot); b.appendChild(document.createTextNode(' ')); b.appendChild(a); }
    return c;
  }
  function papelTxt(d, tipo, slot) {
    if (d.slots && d.slots[slot]) return 'Assinado';
    var gp = d.papeis && d.papeis[tipo]; return gp ? 'Gerado em ' + ddmm(String(gp.gerado_em).slice(0, 10)) : '';
  }
  function grupoSituacao(d) {
    var box = el('div', 'jor-grp jor-grp-sit'); box.appendChild(tituloGrupo('Situação'));
    var g = el('div', 'jor-sit');
    var fin = d.financiamento === 'sim' ? 'Sim' : d.financiamento === 'nao' ? 'Não' : '';
    g.appendChild(sitCel('Financiamento', fin));
    var cpf = d.excedente_cpf || { ok: null };
    var exc = d.excedente === 'nao' ? 'Não' : d.excedente === 'sim' ? (cpf.ok === false ? 'Sim · outro CPF' : cpf.ok === true ? 'Sim · mesmo CPF' : 'Sim') : '';
    g.appendChild(sitCel('Excedente', exc, cpf.ok === false && d.excedente === 'sim' ? 'av' : ''));
    g.appendChild(sitCel('Contrato', papelTxt(d, 'contrato', 'contrato_assinado')));
    g.appendChild(sitCel('Procuração', papelTxt(d, 'procuracao', 'procuracao')));
    g.appendChild(sitCel('Número da venda', d.numero && d.numero.estado === 'tem' ? String(d.numero.codigo || '') : ''));
    var tr = d.trello || {}; var temCartao = (tr.url && tr.fonte !== 'dossie') || tr.tem_cartao;
    g.appendChild(sitCel('Trello', temCartao ? 'Criado' : '', '', temCartao && tr.url ? { url: tr.url, rot: 'Abrir' } : null));
    var rf = d.relatorio_final; var temRel = !!(rf && rf.url && /^https:\/\//.test(rf.url));
    g.appendChild(sitCel('Relatório final', temRel ? 'Gerado' + (rf.gerado_em ? ' em ' + ddmm(String(rf.gerado_em).slice(0, 10)) : '') : '', '', temRel ? { url: rf.url, rot: 'Abrir' } : null));
    box.appendChild(g);
    return box;
  }

  // ── A linha do tempo ────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Os passos na ordem do trabalho. n = a etapa do servidor que o passo fecha; chaves = os itens dele (a situação vem do servidor);
   * feito() = reserva quando a api não manda os itens; linha() = o resultado em uma linha; prev = o que o passo vai pedir; corpo(c) = a ação.
   */
  function passosDaObra(d, ets) {
    var exc = d.excedente === 'sim';
    function por(chaves, reserva) { var l = itensDe(d, chaves); return l.length ? todosFeitos(l) : !!reserva(); }
    var P = [
      { id: 'vendido', n: 1, titulo: 'Vendido', chaves: [], feito: function () { return true; }, semCorpo: true,
        linha: function () { var e1 = d.etapas[0]; var q = e1 && e1.aberta_em ? quando(e1.aberta_em).split(' ')[0] : ''; return 'Vendido' + (q ? ' em ' + q : '') + ' por ' + nomeBonito(d.card.vendedor) + '.'; } },
      { id: 'lista', n: 1, titulo: 'Mandar a lista de documentos', chaves: ['pedido_cnh', 'pedido_conta_luz', 'pedido_fachada', 'pedido_padrao', 'pedido_disjuntor', 'pedido_medidor'], prev: 'Perguntar se tem excedente e mandar ao cliente a lista do que falta.',
        feito: function () { return (d.excedente === 'sim' || d.excedente === 'nao') && PEDIDOS.every(function (p) { return docRecebido(d, p) || (d.pedidos && d.pedidos[p.chave]); }); },
        linha: function () {
          var em = Object.keys(d.pedidos || {}).map(function (k) { return String((d.pedidos[k] || {}).em || ''); }).filter(Boolean).sort().pop();
          var todos = PEDIDOS.every(function (p) { return docRecebido(d, p); });
          return (todos ? 'Tudo recebido.' : 'Lista enviada' + (em ? ' em ' + ddmm(em.slice(0, 10)) : '') + '.') + (exc ? ' Com excedente.' : d.excedente === 'nao' ? ' Sem excedente.' : '');
        }, corpo: corpoLista },
      { id: 'anexos', n: 1, titulo: 'Anexar tudo da lista', chaves: ['documento', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor', 'excedente', 'conta_excedente'],
        abreSozinho: function () { return pendentesDe(d).length > 0; },
        prev: pendentesDe(d).length ? 'Pendente da etapa 1: ' + juntar(pendentesDe(d).map(function (i) { var q = PEDIDOS.filter(function (p) { return p.item === i.chave; })[0]; return q ? q.rot : i.texto; })) + '.' : 'CNH, conta de luz e 4 fotos. A ficha do cliente se preenche sozinha.',
        feito: function () { if (pendentesDe(d).length) return false; var cpf = d.excedente_cpf || {}; return PEDIDOS.every(function (p) { return docRecebido(d, p); }) && (!exc || (!!d.slots.conta_luz_beneficiaria && cpf.ok !== false)); },
        linha: function () { var cpf = d.excedente_cpf || {}; return 'Tudo anexado.' + (exc ? (cpf.ok === true ? ' Conta do excedente no mesmo CPF.' : ' Conta do excedente anexada.') : ''); }, corpo: corpoAnexos },
      { id: 'ficha', n: 1, titulo: 'Conferir a ficha', chaves: ['nome', 'telefone', 'endereco', 'endereco_usina', 'email', 'proposta', 'prazo', 'placas', 'inversor', 'valor', 'pagamento'], prev: 'Confirmar os dados do cliente e da venda no resumo.',
        feito: function () { return false; },
        linha: function () { var m = ultimaMarca(d, ['nome', 'telefone', 'endereco', 'endereco_usina', 'email', 'placas', 'inversor', 'valor', 'pagamento']); return 'Cliente e venda confirmados' + quem(m) + '.'; }, corpo: corpoFicha },
      { id: 'papeis', n: 1, titulo: 'Contrato e procuração', chaves: ['financiamento', 'proposta_banco', 'papel_contrato', 'papel_procuracao'], prev: 'Financiamento, contrato e procuração.',
        feito: function () { return (d.financiamento === 'sim' || d.financiamento === 'nao') && !!(d.papeis && d.papeis.contrato && d.papeis.procuracao); },
        linha: function () { var p = d.papeis || {}; return [p.contrato ? 'Contrato gerado em ' + ddmm(String(p.contrato.gerado_em).slice(0, 10)) : '', p.procuracao ? 'Procuração gerada em ' + ddmm(String(p.procuracao.gerado_em).slice(0, 10)) : '', d.financiamento === 'sim' ? 'Com proposta de banco' : 'Sem financiamento'].filter(Boolean).join(' · ') + '.'; }, corpo: corpoPapeis },
      { id: 'assinaturas', n: 2, titulo: 'Assinaturas', chaves: ['contrato_assinado', 'procuracao'], prev: 'Anexar o contrato e a procuração assinados.',
        feito: function () { return !!(d.slots.contrato_assinado && d.slots.procuracao); },
        linha: function () { return 'Contrato e procuração assinados anexados.' + (d.numero && d.numero.estado === 'tem' ? ' Número ' + d.numero.codigo + '.' : ''); }, corpo: corpoAssinaturas },
      { id: 'vistoria', n: 2, titulo: 'Vistoria', chaves: ['vistoria'], prev: 'Relatório de vistoria com pelo menos 80% preenchido.',
        feito: function () { return (Number(d.vistoria_pct) || 0) >= 80; },
        linha: function () { return 'Relatório ' + Math.round(Number(d.vistoria_pct) || 0) + '% preenchido.'; }, corpo: corpoVistoria,
        etiqueta: function () { var p = Math.round(Number(d.vistoria_pct) || 0); return p + '% de 80%'; } },
      { id: 'equipamento', n: 3, titulo: 'Homologação', chaves: ['datasheet_modulo', 'datasheet_inversor', 'kmz'], prev: 'Datasheet da placa, datasheet do inversor e KMZ do local.',
        feito: function () { return !!(d.slots.datasheet_modulo && d.slots.datasheet_inversor && d.slots.kmz); },
        linha: function () { return 'Datasheets e KMZ anexados.'; }, corpo: corpoEquipamento },
      { id: 'trello', n: 3, titulo: 'Trello e relatório final', chaves: ['trello'], prev: 'O cartão do Trello nasce sozinho quando tudo acima fica pronto.',
        feito: function () { var tr = d.trello || {}; return !!((tr.url && tr.fonte !== 'dossie') || tr.tem_cartao); },
        linha: function () { var tr = d.trello || {}; var rf = d.relatorio_final; return 'Cartão do Trello criado' + (tr.criado_em ? ' em ' + ddmm(String(tr.criado_em).slice(0, 10)) : '') + '.' + (rf && rf.url ? ' Relatório final gerado.' : ''); }, corpo: corpoTrello },
    ];
    if (exc) P.push({ id: 'rateio', n: 3, titulo: 'Rateio do excedente', chaves: ['rateio'], prev: 'Conferir o rateio do excedente no protocolo.',
      feito: function () { return !!(d.rateio_conferido && d.rateio && d.rateio_conferido.marca === d.rateio.marca); },
      linha: function () { var r = d.rateio_conferido || {}; return 'Rateio conferido' + (r.por ? ' por ' + nomeBonito(r.por) : '') + (r.conferido_em ? ' em ' + ddmm(String(r.conferido_em).slice(0, 10)) : '') + '.'; }, corpo: corpoRateio });
    P.push(
      { id: 'art', n: 3, titulo: 'ART e engenheiro', chaves: ['art'], prev: 'ART com documento e comprovante. O pagamento do engenheiro.',
        feito: function () { return !!(d.slots.art && d.slots.art_comprovante); }, linha: function () { return 'ART anexada com o comprovante.' + (d.engenheiro === 'pago' ? ' Engenheiro pago.' : d.engenheiro === 'a_pagar' ? ' Engenheiro a pagar.' : ''); }, corpo: corpoArt },
      { id: 'protocolo', n: 3, titulo: 'Protocolo', chaves: ['protocolo'], prev: 'Número e print do protocolo.',
        feito: function () { return !!(d.protocolo && d.protocolo.numero && d.slots.protocolo); }, linha: function () { var p = d.protocolo || {}; return 'Protocolo ' + (p.numero || '') + (p.em ? ' em ' + ddmm(p.em) : '') + '.'; }, corpo: corpoProtocolo },
      { id: 'parecer', n: 3, titulo: 'Parecer de acesso', chaves: ['parecer'], prev: 'Parecer de acesso aprovado.',
        feito: function () { return !!d.slots.parecer_acesso; }, linha: function () { return 'Parecer de acesso anexado.'; }, corpo: corpoParecer }
    );
    P.forEach(function (p) { var reserva = p.feito; p.feito = p.chaves.length ? por(p.chaves, reserva) : reserva(); });
    // As etapas 4 a 9 entram como um passo cada, no mesmo desenho.
    ets.forEach(function (e) {
      if (e.n < 4) return;
      P.push({ id: 'etapa' + e.n, n: e.n, titulo: e.nome, chaves: [], etapa: e, feito: !!e.concluida_em,
        prev: (e.itens || []).length ? 'Pede: ' + juntar(e.itens.map(function (i) { return i.texto; }).slice(0, 4)) + (e.itens.length > 4 ? ' e mais' : '') + '.' : '',
        linha: function () { return 'Concluída' + (e.concluida_em ? ' em ' + ddmm(String(e.concluida_em).slice(0, 10)) : '') + '.'; },
        corpo: function (c) { corpoEtapaObra(c, d, e); } });
    });
    return P;
  }
  /** Qual passo cada chave fecha (para o portão dizer o nome do passo e não o do item). */
  function passoDaChave(passos, chave) { return passos.filter(function (p) { return p.chaves.indexOf(chave) >= 0; })[0] || null; }

  function linhaDoTempo(d, ets, atual) {
    var ol = el('ol', 'jor-tl');
    var passos = passosDaObra(d, ets);
    var idAtual = null;
    passos.forEach(function (p) { if (!idAtual && !p.feito && p.n <= atual && !etapaFeita(ets[p.n - 1], atual)) idAtual = p.id; });
    var ultima = 0;
    passos.forEach(function (p, i) {
      var e = ets[p.n - 1];
      if (p.n !== ultima && p.n <= 3) { ol.appendChild(cabFase(e, atual)); }
      if (p.n !== ultima && p.n === 4) ol.appendChild(cabFase(null, atual));
      ultima = p.n;
      var est = p.feito ? 'feito' : p.id === idAtual ? 'atual' : (p.n <= atual ? 'pendente' : 'futuro');
      ol.appendChild(noPasso(d, p, i + 1, est));
      var prox = passos[i + 1];
      if ((!prox || prox.n !== p.n) && p.n === atual && p.n <= 8 && e && !e.concluida_em) ol.appendChild(portaoEtapa(d, e, passos));
    });
    return ol;
  }
  /** O separador de cada etapa na linha do tempo: nome, dono, situação e um Lançar gasto discreto (a soma dos gastos está no resumo). Etapas 4 a 9: um só, "Obra". */
  function cabFase(e, atual) {
    var li = el('li', 'jor-tl-fase');
    if (!e) { li.appendChild(el('b', '', 'Obra')); li.appendChild(el('span', 'jor-nota', 'Etapas 4 a 9')); return li; }
    var feita = etapaFeita(e, atual);
    li.appendChild(el('b', '', 'Etapa ' + e.n + ' · ' + e.nome));
    (e.dono || []).forEach(function (x) { var a = el('span', 'jor-avatar', x.iniciais); a.title = nomeBonito(x.nome); a.setAttribute('aria-label', 'Responsável: ' + nomeBonito(x.nome)); li.appendChild(a); });
    li.appendChild(etq(feita ? 'Concluída' + (e.concluida_em ? ' em ' + ddmm(String(e.concluida_em).slice(0, 10)) : '') : e.n === atual ? 'Em andamento' : 'A seguir', feita ? 'ok' : e.n === atual ? 'vez' : ''));
    var gx = el('span', 'jor-tl-fase-g');
    var din = O.dinheiro;
    if (din && din.visivel !== false && din.pode && din.pode.lancar_saida && e.n <= atual && window.Jornada.dinheiro && window.Jornada.dinheiro.lancar) {
      var bg = btn('Lançar gasto', 'jor-btn-link', function () { window.Jornada.dinheiro.lancar({ tipo: 'saida', etapa: e.n }); }); bg.setAttribute('aria-label', 'Lançar gasto na etapa ' + e.n); gx.appendChild(bg);
    }
    if (gx.firstChild) li.appendChild(gx);
    return li;
  }
  function noPasso(d, p, num, est) {
    var sozinho = !!(p.abreSozinho && est === 'pendente' && p.abreSozinho() && O.abertos[p.id] !== false);   // pendência da etapa 1: abre sozinho até a pessoa fechar
    var aberto = !p.semCorpo && (est === 'atual' || sozinho || (est !== 'futuro' && !!O.abertos[p.id]));
    var li = el('li', 'jor-tl-no ' + est + (aberto ? ' aberto' : '')); li.id = 'jor-p-' + p.id; li.tabIndex = -1;
    var mk = el('span', 'jor-tl-mk'); mk.setAttribute('aria-hidden', 'true');
    if (est === 'feito') mk.appendChild(icone('ok')); else mk.textContent = String(num);
    li.appendChild(mk);
    var cx = el('div', 'jor-tl-cx');
    var t = el('div', 'jor-tl-t'); var h = el('h4', '', p.titulo); h.insertBefore(srTxt('Passo ' + num + ', ' + ({ feito: 'feito', atual: 'atual', pendente: 'pendente', futuro: 'ainda não chegou' })[est] + ': '), h.firstChild); t.appendChild(h);
    if (est === 'atual') t.appendChild(etq('Agora', 'vez'));
    var falta = itensDe(d, p.chaves).filter(function (i) { return !i.feito; }).length;
    if (p.etiqueta && est !== 'feito' && est !== 'futuro') t.appendChild(etq(p.etiqueta(), 'av'));
    else if (est === 'pendente' && falta) t.appendChild(etq('Falta ' + falta, 'av'));
    if (!p.semCorpo && est !== 'futuro' && est !== 'atual') {
      var bt = btn(aberto ? 'Fechar' : (est === 'feito' ? 'Editar' : 'Abrir'), 'jor-btn-link jor-tl-ac', function () { if (aberto) { if (p.abreSozinho) O.abertos[p.id] = false; else delete O.abertos[p.id]; } else O.abertos[p.id] = true; desenharObra(); var x = document.getElementById('jor-p-' + p.id); if (x && !aberto) try { x.focus({ preventScroll: true }); } catch (e) { /* sem foco */ } });
      bt.setAttribute('aria-expanded', aberto ? 'true' : 'false'); bt.setAttribute('aria-label', (aberto ? 'Fechar: ' : est === 'feito' ? 'Editar: ' : 'Abrir: ') + p.titulo);
      t.appendChild(bt);
    }
    cx.appendChild(t);
    if (est === 'feito' || !aberto) cx.appendChild(el('p', 'jor-tl-res', est === 'feito' ? p.linha() : (p.prev || '')));
    if (aberto) { var corpoP = el('div', 'jor-tl-corpo'); corpoP.id = 'jor-s-' + p.id; p.corpo(corpoP, p); cx.appendChild(corpoP); }
    li.appendChild(cx);
    return li;
  }
  /** O Concluir no fim do último passo da etapa: o que falta, pelo nome do passo (nunca a lista item por item). */
  function portaoEtapa(d, e, passos) {
    var li = el('li', 'jor-tl-portao'); li.appendChild(el('span', 'jor-tl-mk vazio'));
    var cx = el('div', 'jor-tl-cx'); var barra = el('div', 'jor-portao-barra');
    var falta = [];
    // Na ordem dos passos: primeiro o que fecha um passo da linha do tempo, depois o item solto pelo texto dele.
    var soltos = [];
    // Os 'pendentes' da etapa 1 entram um a um, pelo texto da api ("CNH ou identidade (pendente da etapa 1)").
    (e.itens || []).forEach(function (i) { if (i.feito) return; var p = e.n <= 3 && i.bloco !== 'pendentes' ? passoDaChave(passos, i.chave) : null; if (!p && soltos.indexOf(i.texto) < 0) soltos.push(i.texto); });
    passos.forEach(function (p) { if (e.n <= 3 && (e.itens || []).some(function (i) { return !i.feito && i.bloco !== 'pendentes' && p.chaves.indexOf(i.chave) >= 0; })) falta.push(p.titulo); });
    falta = falta.concat(soltos);
    var f2 = O.fase2;
    var podeLista = e.n <= 3 ? (O.dados.pode.concluir || []) : ((f2 && f2.pode && f2.pode.concluir) || []);
    var pode = podeLista.indexOf(e.n) >= 0 && e.falta === 0;
    barra.appendChild(el('p', 'jor-portao-frase', e.falta > 0 ? 'Para concluir a etapa ' + e.n + ', falta: ' + juntar(falta.length ? falta : [plural(e.falta, 'item', 'itens')]) + '.' : 'Tudo pronto para concluir a etapa ' + e.n + '.'));
    var bc = btn(e.n === 8 ? 'Finalizar a obra' : 'Concluir etapa ' + e.n, 'jor-btn-pri jor-btn-grande', function () { concluir(e.n, bc); });
    bc.disabled = !pode; barra.appendChild(bc);
    cx.appendChild(barra);
    // Pendências da etapa 1 no que falta: um link rola até o passo de anexar.
    if ((e.itens || []).some(function (i) { return i.bloco === 'pendentes' && !i.feito; })) {
      var ia = 0; passos.forEach(function (q, k) { if (q.id === 'anexos') ia = k + 1; });
      if (ia) { var lk = el('p', 'jor-nota'); lk.appendChild(btn('Ir para o passo ' + ia, 'jor-btn-link', function () { irPara('jor-p-anexos'); })); cx.appendChild(lk); }
    }
    var prox = etapasMescladas()[e.n];
    if (prox && e.n !== 3 && e.n !== 8) cx.appendChild(el('p', 'jor-nota', 'Ao concluir: abre ' + prox.nome + ' e ' + (prox.dono || []).map(function (x) { return nomeBonito(x.nome); }).join(' e ') + ' recebe o aviso.'));
    if (e.n === 2) cx.appendChild(el('p', 'jor-nota', 'Entrada, financiamento e comissões não travam esta etapa.'));
    if (e.n === 3) cx.appendChild(el('p', 'jor-nota', 'Ao concluir: abre Compra (Thiago e Diego).'));
    if (e.n === 8) cx.appendChild(el('p', 'jor-nota', 'Fechada, a conta trava. Só o Thiago reabre, com motivo.'));
    li.appendChild(cx);
    return li;
  }
  /** Etapas 4 a 9: o que jornada-obra.js e jornada-posvenda.js desenham, dentro do passo. */
  function corpoEtapaObra(c, d, e) {
    if (e.n === 9) { if (window.Jornada.etapas[9]) window.Jornada.etapas[9](c, d, e, O.fase3); return; }
    if (O.fase2 && window.Jornada.etapas[e.n]) { window.Jornada.etapas[e.n](c, d, e, O.fase2); return; }
    c.appendChild(el('p', 'jor-erro', 'Não consegui ler esta parte agora.')); c.appendChild(btn('Tentar de novo', '', carregarObra));
  }

  // ── A leitura dos documentos: CNH e conta de luz preenchem a ficha sozinhas ───────────────────────────────────────
  // Só a CNH do contratante e a conta de luz são lidas sozinhas. A CNH do titular da homologação (documento_titular_uc) não preenche a ficha.
  var SLOTS_LIDOS = { documento_titular: 'a CNH', conta_luz: 'a conta de luz' };
  // O que cada leitura preenche em dados_cliente: a CNH dá nome e CPF, a conta de luz dá o endereço.
  var CAMPOS_LIDOS = { documento_titular: ['nome', 'cpf'], conta_luz: ['endereco'] };
  var MSG_NADA_NOVO = 'Recebido. Nada novo para preencher na ficha.';
  function assinaturaDC(d) { var c = (d && d.dados_cliente) || {}; return JSON.stringify([c.nome, c.cpf, c.endereco, c.bairro, c.cidade, c.uf, c.cep, c.endereco_ponto, c.telefone, c.email, c.origem || null]); }
  /** Os campos que a leitura deste item preencheria e que estão vazios na ficha agora. Lista vazia = não há o que preencher. */
  function vaziosDaLeitura(d, slot) {
    var c = (d && d.dados_cliente) || {};
    return (CAMPOS_LIDOS[slot] || []).filter(function (k) { return !String(c[k] == null ? '' : c[k]).trim(); });
  }
  /** Os ids dos arquivos do item no quadro. null enquanto o quadro não carregou. */
  function idsDoSlot(chave) {
    var st = quadroDoCard(); if (!st || !st.docs || !Array.isArray(st.docs.arquivos)) return null;
    return st.docs.arquivos.filter(function (a) { return a && a.slot === chave; }).map(function (a) { return String(a.id); });
  }
  /** Depois do upload: recarrega a obra a cada 3 s até a ficha mudar. Só espera quando havia campo vazio para a leitura preencher. */
  function iniciarLeitura(slot) {
    if (O.lendoT) clearTimeout(O.lendoT);
    O.lendo = { slot: slot, qual: SLOTS_LIDOS[slot], t0: Date.now(), antes: assinaturaDC(O.dados), card: String(O.card) }; O.lendoFalhou = '';
    O.lendoT = setTimeout(passoLeitura, 3000);
  }
  function passoLeitura() {
    O.lendoT = 0; var l = O.lendo; if (!l || l.card !== String(O.card)) return;
    Promise.resolve(carregarObra()).then(function () {
      if (O.lendo !== l || l.card !== String(O.card)) return;
      if (O.dados && assinaturaDC(O.dados) !== l.antes) { O.lendo = null; toast('Li ' + l.qual + '. Confira a ficha do cliente.'); desenharObra(); return; }
      if (Date.now() - l.t0 > 20000) {
        O.lendo = null;
        // Falha de verdade só quando o campo vazio continuou vazio. Se ele foi preenchido por outra via, não há falha para mostrar.
        if (vaziosDaLeitura(O.dados, l.slot).length) O.lendoFalhou = l.qual; else toast(MSG_NADA_NOVO);
        desenharObra(); return;
      }
      O.lendoT = setTimeout(passoLeitura, 3000);
    });
  }
  /** Fim do upload de CNH ou conta de luz: espera a leitura só se há o que ela preencher e o arquivo é novo. */
  function depoisDoUpload(chave, repetido) {
    if (!SLOTS_LIDOS[chave]) return;
    if (repetido || !vaziosDaLeitura(O.dados, chave).length) { toast(MSG_NADA_NOVO); return; }
    iniciarLeitura(chave);
  }

  // ── Confirmar em lote: um botão confirma todas as chaves de um grupo, uma depois da outra ──────────────────────────
  function confirmarLote(d, sec, lista) {
    if (!lista.length || O.confirmando[sec]) return;
    var card = String(O.card); var falhou = '';
    O.confirmando[sec] = true; delete O.erroSec[sec]; desenharObra();
    var seq = Promise.resolve();
    lista.forEach(function (x) {
      seq = seq.then(function () {
        if (falhou) return null;
        return confirmarChave(d, x.chave, true, x.texto, true).then(function (r) { if (!r.ok) falhou = r.erro; else if (x.depois) x.depois(); });
      });
    });
    seq.catch(function () { falhou = 'Não consegui confirmar agora. Tente de novo.'; }).then(function () {
      delete O.confirmando[sec];
      if (String(O.card) !== card) return;
      if (falhou) O.erroSec[sec] = falhou; else toast('Confirmado.');
      desenharObra(); releia();
    });
  }
  /**
   * Uma linha de confirmação: Confirmar (as chaves com valor e ainda sem marca), quem confirmou por último e o que falta preencher.
   * cfg: sec, titulo, chaves, rotulo, aria, temValor(k), rotDe(k), coletar (opcional: campos abertos que entram junto, como o kit escrito à mão).
   */
  function linhaConfirmar(d, et, cfg) {
    var box = el('div', 'jor-conf');
    var abertos = cfg.coletar ? cfg.coletar.chaves() : [];
    var pend = cfg.chaves.filter(function (k) { return abertos.indexOf(k) < 0 && !conf(d, k) && cfg.temValor(k); });
    var vazios = cfg.chaves.filter(function (k) { return abertos.indexOf(k) < 0 && !cfg.temValor(k); });
    var marca = ultimaMarca(d, cfg.chaves);
    var cab = el('div', 'jor-conf-t'); cab.appendChild(el('b', '', cfg.titulo));
    if (!pend.length && !abertos.length && !vazios.length) {
      var ok = el('span', 'jor-pe-ok'); ok.appendChild(icone('ok')); ok.appendChild(document.createTextNode('Confirmado' + quem(marca))); cab.appendChild(ok);
      box.appendChild(cab); return box;
    }
    box.appendChild(cab);
    var info = [];
    if (pend.length) info.push('Falta confirmar: ' + juntar(pend.map(cfg.rotDe)) + '.');
    if (vazios.length) info.push('Falta preencher: ' + juntar(vazios.map(cfg.rotDe)) + '.');
    if (info.length) box.appendChild(el('p', 'jor-nota', info.join(' ')));
    var ac = el('div', 'jor-din-acoes');
    var erro = el('p', 'jor-erro', O.erroSec[cfg.sec] || ''); erro.setAttribute('role', 'alert');
    if (pend.length || abertos.length) {
      var ocup = !!O.confirmando[cfg.sec];
      var b = btn(ocup ? 'Confirmando…' : cfg.rotulo, 'jor-btn-pri', function () {
        var lista = [];
        if (cfg.coletar) { var r = cfg.coletar.lista(); if (r.erro) { O.erroSec[cfg.sec] = r.erro; erro.textContent = r.erro; return; } lista = r.itens; }
        confirmarLote(d, cfg.sec, lista.concat(pend.map(function (k) { return { chave: k }; })));
      });
      b.setAttribute('aria-label', cfg.aria); negar(b, semConfirmar(d, et)); if (ocup) b.disabled = true;
      ac.appendChild(b);
    }
    box.appendChild(ac);
    box.appendChild(erro);
    return box;
  }

  // ── Seções da etapa: título com a situação ao lado (Completo ou Falta N) e divisória grossa ──────────────────────────
  function secao(titulo, itens) {
    var b = el('div', 'jor-bloco');
    b.appendChild(blocoTitulo(titulo, itens && itens.length ? itens : null));
    return b;
  }
  function itensPorChave(et, chaves) { return (et.itens || []).filter(function (i) { return chaves.indexOf(i.chave) >= 0; }); }
  function situacao(ok) { return [{ feito: !!ok }]; }
  function conf(d, chave) { return (d.confirmados && d.confirmados[chave]) || null; }
  /** Por que a pessoa não pode confirmar agora ('' = pode): sem permissão ou com a etapa 1 já concluída. */
  function semConfirmar(d, et) {
    if (et && et.concluida_em) return 'A etapa 1 já foi concluída.';
    if (!d.pode || !d.pode.confirmar) return 'Você não tem permissão para confirmar.';
    return '';
  }
  /** Desabilita o botão com um title curto explicando. */
  function negar(b, motivo) { if (motivo) { b.disabled = true; b.title = motivo; } return b; }
  function enc(x) { return encodeURIComponent(String(x)); }
  function confirmarChave(d, chave, on, texto, semReler) {
    var corpo = { chave: chave, confirmar: !!on }; if (texto) corpo.texto = texto;
    return api('/gerador/jornada-solar/obra/' + enc(O.card) + '/confirmar', 'POST', corpo).then(function (r) {
      if (r.status === 200 && r.json.ok !== false) {
        d.confirmados = d.confirmados || {};
        if (on) d.confirmados[chave] = { em: new Date().toISOString(), por: '' }; else delete d.confirmados[chave];
        if (!semReler) releia(); return { ok: true };
      }
      return { ok: false, erro: msgDe(r, 'Não consegui confirmar agora. Tente de novo.') };
    });
  }

  // ── Etapa 1: dados do cliente, cada um com Confirmar ────────────────────────────
  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function soDig(t) { return String(t || '').replace(/\D/g, ''); }
  function fmtTel(v) {
    var x = soDig(v);
    if (x.length === 11) return '(' + x.slice(0, 2) + ') ' + x.slice(2, 7) + '-' + x.slice(7);
    if (x.length === 10) return '(' + x.slice(0, 2) + ') ' + x.slice(2, 6) + '-' + x.slice(6);
    return String(v || '');
  }
  function fmtCep(v) { var x = soDig(v); return x.length === 8 ? x.slice(0, 5) + '-' + x.slice(5) : String(v || ''); }
  function enderecoTxt(v) {
    var cu = [v.cidade, v.uf].filter(Boolean).join(' - ');
    return [v.endereco, v.bairro, cu, v.cep ? fmtCep(v.cep) : ''].filter(Boolean).join(', ');
  }
  /**
   * Os campos do bloco "Dados do cliente". `chave` é a chave de confirmação no servidor; cada `campos[].k` é um campo do cadastro (PUT /cadastro).
   * `completo(v)`: o valor tem o mínimo para confirmar. `txt(v)`: como o valor aparece.
   */
  var CAMPOS_CLIENTE = [
    { chave: 'nome', rot: 'Nome completo', campos: [{ k: 'nome', rot: 'Nome completo', tipo: 'text', ex: 'Nome e sobrenome' }],
      valida: function (v) { return v.nome.length < 3 ? 'Digite o nome completo do cliente.' : ''; },
      sug: function (d) { return d.card && d.card.cliente ? { nome: d.card.cliente } : null; } },
    { chave: 'telefone', rot: 'Telefone de contato', campos: [{ k: 'telefone', rot: 'Telefone', tipo: 'tel', ex: '(34) 99999-0000', fmt: fmtTel, norm: soDig }],
      valida: function (v) { var n = soDig(v.telefone).length; return n >= 10 && n <= 13 ? '' : 'Telefone com DDD, de 10 a 13 dígitos.'; },
      sug: function (d) { return d.card && soDig(d.card.telefone).length >= 10 ? { telefone: d.card.telefone } : null; } },
    { chave: 'endereco', rot: 'Endereço completo', campos: [{ k: 'endereco', rot: 'Rua e número', tipo: 'text', ex: 'Rua, número' }, { k: 'bairro', rot: 'Bairro', tipo: 'text', ex: 'Bairro' },
      { k: 'cidade', rot: 'Cidade', tipo: 'text', ex: 'Cidade' }, { k: 'uf', rot: 'UF', tipo: 'text', ex: 'MG', max: 2, up: true }, { k: 'cep', rot: 'CEP', tipo: 'text', ex: '00000-000', fmt: fmtCep, norm: soDig }],
      txt: enderecoTxt,
      valida: function (v) {
        if (v.endereco.length < 5) return 'Digite a rua e o número.';
        if (v.cidade.length < 2) return 'Digite a cidade.';
        if (!/^[A-Za-z]{2}$/.test(v.uf)) return 'Digite a UF com 2 letras.';
        if (v.cep && soDig(v.cep).length !== 8) return 'CEP com 8 dígitos.';
        return '';
      } },
    { chave: 'endereco_usina', rot: 'Endereço da usina', campos: [{ k: 'endereco_ponto', rot: 'Endereço da usina', tipo: 'text', ex: 'Rua, número, bairro, cidade e UF' }],
      atalho: 'Mesmo endereço do cliente',
      valida: function (v) { return v.endereco_ponto.length < 8 ? 'Digite o endereço completo da usina, com rua, número, bairro e cidade.' : ''; } },
    { chave: 'email', rot: 'E-mail do cliente', campos: [{ k: 'email', rot: 'E-mail', tipo: 'email', ex: 'nome@exemplo.com' }],
      valida: function (v) { return EMAIL_OK.test(v.email) ? '' : 'Esse e-mail não parece certo. Confira e tente de novo.'; },
      sug: function (d, st) { return st && st.sugEmail ? { email: st.sugEmail } : null; } },
  ];
  function valorDoCadastro(st, campo) { var c = st && st.cad && st.cad.campos && st.cad.campos[campo]; return String((c && c.valor) == null ? '' : c.valor).trim(); }
  /** Os valores de um campo composto. De onde vêm: dados_cliente do servidor > cadastro do quadro (quando carregar). null = ainda não sei. */
  function lerCampos(d, cfg) {
    var out = {}; var st = quadroDoCard(); var pronto = !!(st && !st.carregando && st.cad); var dc = d.dados_cliente || {};
    for (var i = 0; i < cfg.campos.length; i++) {
      var k = cfg.campos[i].k; var dk = cfg.campos[i].dc || k; var x = dc[dk];
      if (typeof x === 'string') out[k] = x.trim();
      else if (x === null && Object.prototype.hasOwnProperty.call(dc, dk)) out[k] = '';
      else if (k === 'email' && d.documentos && typeof d.documentos.email === 'string') out[k] = d.documentos.email.trim();
      else if (pronto) out[k] = valorDoCadastro(st, k);
      else return null;
    }
    return out;
  }
  function cheio(cfg, v) { return !!v && cfg.campos.some(function (c) { return v[c.k]; }); }
  function mostra(cfg, v) {
    if (cfg.txt) return cfg.txt(v);
    var c = cfg.campos[0]; return c.fmt ? c.fmt(v[c.k]) : v[c.k];
  }

  // ── A ficha do cliente (no resumo): cada dado com a origem e Editar na própria célula ─────────────────────────────
  function fmtDoc(v) {
    var x = soDig(v);
    if (x.length === 11) return x.slice(0, 3) + '.' + x.slice(3, 6) + '.' + x.slice(6, 9) + '-' + x.slice(9);
    if (x.length === 14) return x.slice(0, 2) + '.' + x.slice(2, 5) + '.' + x.slice(5, 8) + '/' + x.slice(8, 12) + '-' + x.slice(12);
    return String(v || '');
  }
  /** O CPF entra na ficha e no cadastro (cpf_cnpj), mas não tem chave de confirmação no servidor. */
  var CPF_CFG = { chave: 'cpf', semConfirmar: true, rot: 'CPF', campos: [{ k: 'cpf_cnpj', dc: 'cpf', rot: 'CPF', tipo: 'text', ex: '000.000.000-00', fmt: fmtDoc, norm: soDig }],
    valida: function (v) { var n = soDig(v.cpf_cnpj).length; return n === 11 || n === 14 ? '' : 'CPF com 11 dígitos (ou CNPJ com 14).'; } };
  function cfgCliente(chave) { return CAMPOS_CLIENTE.filter(function (c) { return c.chave === chave; })[0]; }
  function ficha() { return [cfgCliente('nome'), CPF_CFG, cfgCliente('telefone'), cfgCliente('email'), cfgCliente('endereco'), cfgCliente('endereco_usina')]; }
  var VAZIO = { nome: 'Aguardando a CNH', cpf: 'Aguardando a CNH', endereco: 'Aguardando a conta de luz', endereco_usina: 'Aguardando a conta de luz', telefone: 'Aguardando', email: 'Aguardando' };
  /** De onde veio o dado (dados_cliente.origem do servidor). 'ia' diz qual documento: nome e CPF saem da CNH, endereço da conta de luz. */
  function origemDe(d, cfg) {
    var o = d.dados_cliente && d.dados_cliente.origem; if (!o || typeof o !== 'object') return '';
    var v = o[cfg.chave]; if (v == null && cfg.chave === 'endereco_usina') v = o.endereco_ponto;
    if (v === 'ia') return cfg.chave === 'nome' || cfg.chave === 'cpf' ? 'da CNH' : (cfg.chave === 'endereco' || cfg.chave === 'endereco_usina' ? 'da conta de luz' : 'do documento');
    return { manual: 'digitado', card: 'do card', proposta: 'da proposta' }[v] || '';
  }

  /**
   * Um dado da ficha. Leitura: valor, origem e Editar (vazio: "Aguardando a CNH" e Preencher). Edição: os campos, Salvar e Cancelar, na mesma
   * célula, que ocupa a largura toda. Salvar grava pelo PUT /cadastro do quadro (vdcCamposGravar) e tira a confirmação do dado, se tinha.
   * O que está em edição e o que foi digitado moram em O (a obra se redesenha a cada gravação e a cada leitura de documento).
   */
  function campoFicha(d, et, cfg) {
    var card = String(O.card);
    var no = el('div', 'jor-fc ' + cfg.chave);
    var vals = lerCampos(d, cfg);
    if (vals === null) quadroPronto(no).then(function () { if (!no.isConnected) return; vals = lerCampos(d, cfg) || vazioDe(); montar(); });
    function vazioDe() { var o = {}; cfg.campos.forEach(function (c) { o[c.k] = ''; }); return o; }
    function rasc(k) { return O.rascunho[cfg.chave + '.' + k]; }
    function limparRasc() { cfg.campos.forEach(function (c) { delete O.rascunho[cfg.chave + '.' + c.k]; }); }
    function montar(foco) {
      var edita = !!O.edita[cfg.chave] && vals !== null;
      var temValor = vals !== null && cheio(cfg, vals);
      no.className = 'jor-fc ' + cfg.chave + (edita ? ' edita' : (vals !== null && !temValor ? ' vazio' : ''));
      no.replaceChildren();
      var ok = !cfg.semConfirmar && temValor && !!conf(d, cfg.chave);
      var rot = el('div', 'jor-fc-rot'); rot.appendChild(document.createTextNode(cfg.rot));
      if (ok) { rot.appendChild(icone('ok')); rot.appendChild(srTxt('confirmado')); }
      var org = temValor && !edita ? origemDe(d, cfg) : ''; if (org) rot.appendChild(el('span', 'jor-fc-org' + (/^da (CNH|conta)|^do doc/.test(org) ? ' ia' : ''), org));
      no.appendChild(rot);
      if (vals === null) { var lv = el('div', 'jor-fc-v'); lv.appendChild(el('span', '', 'Carregando…')); no.appendChild(lv); return; }
      if (!edita) {
        var v = el('div', 'jor-fc-v'); v.appendChild(el('span', '', temValor ? mostra(cfg, vals) : VAZIO[cfg.chave]));
        var bE = el('button', 'jor-fc-ed', temValor ? 'Editar' : 'Preencher'); bE.type = 'button'; bE.setAttribute('aria-label', (temValor ? 'Editar: ' : 'Preencher: ') + cfg.rot);
        bE.addEventListener('click', function () { O.edita[cfg.chave] = true; montar(true); });
        negar(bE, semConfirmar(d, et)); v.appendChild(bE); no.appendChild(v);
        return;
      }
      var inps = {}; var grade = el('div', cfg.campos.length > 1 ? 'jor-campos' : 'jor-email-cmp');
      var erro = el('p', 'jor-erro jor-anexo-msg'); erro.setAttribute('role', 'alert');
      var nota = el('p', 'jor-nota'); nota.hidden = true;
      cfg.campos.forEach(function (c) {
        var inp = el('input', 'jor-in' + (temValor ? '' : ' falta')); inp.type = c.tipo; inp.inputMode = c.tipo === 'tel' ? 'tel' : c.tipo === 'email' ? 'email' : (c.norm ? 'numeric' : 'text');
        inp.autocomplete = 'off'; inp.name = 'cliente-' + c.k; inp.maxLength = c.max || 160; if (c.tipo !== 'text' || c.norm) inp.spellcheck = false;
        inp.setAttribute('aria-label', cfg.campos.length > 1 ? cfg.rot + ': ' + c.rot : cfg.rot); inp.placeholder = c.ex || '';
        inp.value = rasc(c.k) != null ? rasc(c.k) : (temValor ? (c.fmt ? c.fmt(vals[c.k]) : vals[c.k]) : '');
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); salvar(); } if (e.key === 'Escape') { e.preventDefault(); cancelar(); } });
        inp.addEventListener('input', function () { O.rascunho[cfg.chave + '.' + c.k] = inp.value; nota.hidden = true; erro.textContent = ''; });
        inps[c.k] = inp;
        if (cfg.campos.length > 1) { var lb = el('label', '', c.rot); lb.appendChild(inp); grade.appendChild(lb); } else grade.appendChild(inp);
      });
      var ac = el('div', 'jor-email-lin'); ac.style.marginTop = '8px';
      var sv = btn('Salvar', 'jor-btn-pri', salvar); sv.setAttribute('aria-label', 'Salvar: ' + cfg.rot);
      var cn = btn('Cancelar', '', cancelar); cn.setAttribute('aria-label', 'Cancelar: ' + cfg.rot);
      add(ac, sv, cn);
      if (cfg.atalho) {
        var va = lerCampos(d, cfgCliente('endereco'));
        if (va && cheio(cfgCliente('endereco'), va)) ac.appendChild(btn(cfg.atalho, 'jor-btn-link', function () { var i0 = inps[cfg.campos[0].k]; i0.value = enderecoTxt(va); O.rascunho[cfg.chave + '.' + cfg.campos[0].k] = i0.value; nota.hidden = true; }));
      }
      add(no, grade, ac, nota, erro);
      if (foco) setTimeout(function () { var p0 = inps[cfg.campos[0].k]; if (p0) p0.focus(); }, 0);
      // O que já existe em outro lugar (card, proposta) é só sugestão: preenche o campo vazio, nunca grava sozinho nem confirma.
      if (!temValor && cfg.sug) {
        var sugerir = function () {
          var sg = cfg.sug(d, quadroDoCard()); if (!sg) return;
          if (cfg.campos.some(function (c) { return inps[c.k].value; })) return;
          cfg.campos.forEach(function (c) { if (sg[c.k]) inps[c.k].value = c.fmt ? c.fmt(sg[c.k]) : sg[c.k]; });
          nota.textContent = 'Veio ' + (cfg.chave === 'email' ? 'da proposta' : 'do card') + '. Confira e salve.'; nota.hidden = false;
        };
        sugerir(); quadroPronto(no).then(function () { if (no.isConnected) sugerir(); });
      }
      function cancelar() { delete O.edita[cfg.chave]; limparRasc(); montar(); }
      function salvar() {
        if (sv.disabled) return;
        var val = {}; var env = {}; erro.textContent = '';
        cfg.campos.forEach(function (c) { var t = inps[c.k].value.trim(); if (c.up) t = t.toUpperCase(); val[c.k] = t; });
        if (cfg.campos.every(function (c) { return !val[c.k]; })) { erro.textContent = 'Preencha este dado.'; inps[cfg.campos[0].k].focus(); return; }
        var msg = cfg.valida(val); if (msg) { erro.textContent = msg; inps[cfg.campos[0].k].focus(); return; }
        cfg.campos.forEach(function (c) { env[c.k] = c.norm ? c.norm(val[c.k]) : val[c.k]; });
        var igual = temValor && cfg.campos.every(function (c) { var a = c.norm ? c.norm(vals[c.k]) : vals[c.k]; return a === env[c.k]; });
        if (igual) { cancelar(); return; }
        sv.disabled = true; sv.textContent = 'Salvando…';
        garantirQuadro().then(function (st) {
          if (!st) return { ok: false, erro: 'Não consegui abrir o cadastro agora. Tente de novo.' };
          if (typeof window.vdcCamposGravar !== 'function') return { ok: false, erro: 'Não consegui salvar agora. Atualize a página.' };
          return window.vdcCamposGravar(st, env);
        }).catch(function () { return { ok: false, erro: 'Não consegui salvar agora. Tente de novo.' }; }).then(function (r) {
          if (r && r.ok) {
            toast(cfg.semConfirmar ? 'Salvo.' : 'Salvo. Confirme no passo 4.');
            if (String(O.card) !== card) return;
            vals = env; delete O.edita[cfg.chave]; limparRasc(); O.lendoFalhou = '';
            // A tela mostra o novo valor já, sem esperar a releitura: o dado foi digitado.
            var dc = d.dados_cliente = d.dados_cliente || {};
            cfg.campos.forEach(function (c) { dc[c.dc || c.k] = env[c.k]; });
            if (dc.origem && typeof dc.origem === 'object') dc.origem[cfg.chave] = 'manual';
            // Dado alterado volta a pedir a confirmação.
            var desf = !cfg.semConfirmar && conf(d, cfg.chave) ? confirmarChave(d, cfg.chave, false, null, true) : Promise.resolve({ ok: true });
            desf.then(function () { desenharObra(); releia(); });
            return;
          }
          var m2 = (r && r.erro) || 'Não consegui salvar agora. Tente de novo.';
          if (!sv.isConnected) { toast(m2); return; }
          sv.disabled = false; sv.textContent = 'Salvar'; erro.textContent = m2;
        });
      }
    }
    montar();
    return no;
  }

  // ── Documentos do cliente: o pedido e o anexo na mesma linha ───────────────────────────────────────────────
  var PEDIDOS = [
    { chave: 'pedido_cnh', item: 'documento', rot: 'CNH ou identidade', msg: 'CNH ou identidade', slots: ['documento', 'documento_titular', 'documento_titular_uc'] },
    { chave: 'pedido_conta_luz', item: 'conta_luz', rot: 'Conta de luz', msg: 'Conta de luz', slots: ['conta_luz'] },
    { chave: 'pedido_fachada', item: 'fachada', rot: 'Foto da fachada', msg: 'Foto da fachada da casa', slots: ['fachada'] },
    { chave: 'pedido_padrao', item: 'padrao', rot: 'Foto do padrão de entrada', msg: 'Foto do padrão de entrada', slots: ['padrao'] },
    { chave: 'pedido_disjuntor', item: 'disjuntor', rot: 'Foto do disjuntor do padrão', msg: 'Foto do disjuntor do padrão', slots: ['disjuntor'] },
    { chave: 'pedido_medidor', item: 'medidor', rot: 'Foto do medidor (relógio de luz)', msg: 'Foto do medidor (relógio de luz)', slots: ['medidor'] },
  ];
  function recebido(d, p) { return p.slots.some(function (s) { return !!(d.slots && d.slots[s]); }); }
  function docRecebido(d, p) { if (pendentesDe(d).some(function (i) { return i.chave === p.item; })) return false; var x = itensDe(d, [p.item]).filter(function (i) { return i.bloco === 'documentos' || i.bloco === 'fotos'; })[0]; return (x && !!x.feito) || recebido(d, p); }
  /** O slot do documento: o do contratante, ou o do titular da homologação quando só ele existe. */
  function slotDoc(d, p) { if (p.item !== 'documento') return p.item; return d.slots.documento ? 'documento_titular' : (d.slots.documento_titular_uc ? 'documento_titular_uc' : 'documento_titular'); }
  function primeiroNome(d) {
    var n = String((d.dados_cliente && d.dados_cliente.nome) || (d.card && d.card.cliente) || '').trim().split(/\s+/)[0] || '';
    return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
  }
  function mensagemPedido(d, faltam, excedente) {
    var nome = primeiroNome(d);
    var linhas = faltam.map(function (p) { return '- ' + p.msg; });
    if (excedente) linhas.push('- Conta de luz de cada imóvel que vai receber o excedente');
    return (nome ? 'Olá, ' + nome + '.' : 'Olá.') + ' Para seguir com o seu projeto de energia solar, preciso destes documentos e fotos:\n'
      + linhas.join('\n') + '\nPode mandar por aqui mesmo. Obrigado!';
  }
  function copiarTexto(t) {
    function plano() {
      try {
        var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return plano(); });
    return Promise.resolve(plano());
  }
  function telefoneWa(d) {
    var x = soDig((d.dados_cliente && d.dados_cliente.telefone) || (d.card && d.card.telefone) || '');
    if (x.length === 10 || x.length === 11) return '55' + x;
    if ((x.length === 12 || x.length === 13) && x.indexOf('55') === 0) return x;
    return '';
  }
  function abrirWa(tel, txt) { try { window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(txt), '_blank', 'noopener'); } catch (e) { toast('Não consegui abrir o WhatsApp.'); } }
  /** A UC (ou, sem UC, o endereço) da conta do excedente em outro CPF. Vazio quando o cadastro não tem nenhum dos dois. */
  function contaDoExcedente(d) {
    var bens = ((d.documentos && d.documentos.beneficiarias) || []).filter(function (b) { return b && b.uc; });
    var b = bens.filter(function (x) { return !x.mesmo_titular; })[0] || bens[0];
    if (b) return 'UC ' + b.uc;
    var st = quadroDoCard();
    for (var i = 1; i <= 5; i++) {
      var uc = valorDoCadastro(st, 'benef_' + i + '_uc'); if (uc) return 'UC ' + uc;
      var end = valorDoCadastro(st, 'benef_' + i + '_endereco'); if (end) return end;
    }
    return '';
  }
  /** O pedido de troca de titularidade do excedente: versão 1 quando dá para dizer qual conta (UC ou endereço), versão 2 quando não. */
  function mensagemTitularidade(d) {
    var nome = primeiroNome(d); var conta = contaDoExcedente(d);
    var linhas = [nome ? 'Olá, ' + nome + '.' : 'Olá.'];
    linhas.push(conta ? 'A conta ' + conta + ' está em outro CPF, diferente do seu.' : 'A conta que vai receber a sobra de energia das placas está em outro CPF, diferente do seu.');
    linhas.push(conta ? 'A concessionária só divide a energia que sobra das placas entre contas do mesmo CPF.' : 'A concessionária só divide essa energia entre contas do mesmo CPF.');
    linhas.push('Por isso, peça na concessionária a troca de titularidade dessa conta para o seu CPF.');
    linhas.push('Se preferir, nos mande a conta de outra unidade que já esteja no seu nome.');
    linhas.push('Qualquer dúvida, é só chamar.');
    return linhas.join('\n');
  }
  /** Marca como pedido o que foi listado na mensagem (PATCH dos pedidos). Quem envia é a pessoa: nada sai pelo sistema. */
  function marcarPedidos(d, itens) {
    d.pedidos = d.pedidos || {};
    var fila = itens.filter(function (p) { return !d.pedidos[p.chave]; });
    var seq = Promise.resolve();
    fila.forEach(function (p) {
      seq = seq.then(function () {
        return api('/gerador/jornada-solar/obra/' + enc(O.card), 'PATCH', { pedido: p.chave, feito: true }).then(function (r) {
          if (r.status === 200 && r.json.ok !== false) d.pedidos[p.chave] = { em: new Date().toISOString(), por: '' };
        });
      });
    });
    return seq.then(function () { if (fila.length) releia(); });
  }
  /** Uma linha: o nome, os 3 passos (Falta pedir, Pedido em, Recebido), o "Já pedi" e o anexo (Foto, Arquivo, Print ou a miniatura com Trocar e Apagar). */
  function linhaDoc(d, p, opc) {
    opc = opc || {};
    var rec = docRecebido(d, p); var ped = (d.pedidos && d.pedidos[p.chave]) || null; var slot = slotDoc(d, p);
    var row = el('div', 'jor-doc');
    var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', p.rot));
    var est = el('div', 'jor-doc-est');
    var passo = rec ? 2 : ped ? 1 : 0;
    var ps = el('span', 'jor-passos p' + passo + (rec ? ' ok' : '')); ps.setAttribute('aria-hidden', 'true');
    [0, 1, 2].forEach(function (i) { if (i) ps.appendChild(el('b', i <= passo ? 'on' : '')); ps.appendChild(el('i', i <= passo ? 'on' : '')); });
    if (!opc.semPedido) est.appendChild(ps);   // pendência da etapa 1: só o anexo (o pedido só vale com a etapa 1 aberta)
    if (!opc.semPedido) est.appendChild(el('span', 'st ' + (rec ? 'st-ok' : ped ? 'st-ped' : 'st-falta'), rec ? 'Recebido' : ped ? 'Pedido' + (ped.em ? ' em ' + ddmm(String(ped.em).slice(0, 10)) : '') : 'Falta pedir'));
    if (!rec && !opc.semPedido) {
      var lb = el('label', 'jor-doc-ped'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!ped; cb.setAttribute('aria-label', 'Já pedi: ' + p.rot);
      cb.addEventListener('change', function () {
        var on = cb.checked; cb.disabled = true;
        api('/gerador/jornada-solar/obra/' + enc(O.card), 'PATCH', { pedido: p.chave, feito: on }).then(function (r) {
          if (r.status === 200 && r.json.ok !== false) { d.pedidos = d.pedidos || {}; if (on) d.pedidos[p.chave] = { em: new Date().toISOString(), por: '' }; else delete d.pedidos[p.chave]; desenharObra(); releia(); return; }
          cb.checked = !on; cb.disabled = false; toast(msgDe(r, 'Não consegui marcar agora.'));
        });
      });
      lb.appendChild(cb); lb.appendChild(document.createTextNode('Já pedi')); est.appendChild(lb);
    }
    if (est.firstChild) info.appendChild(est); row.appendChild(info);
    row.appendChild(anexo(slot, p.rot, rec, { compacto: true }));
    if (O.lendo && O.lendo.slot === slot && O.lendo.card === String(O.card)) {
      var ld = el('p', 'jor-lendo'); ld.setAttribute('role', 'status'); ld.appendChild(el('i')); ld.appendChild(document.createTextNode('Lendo o documento…')); row.appendChild(ld);
    }
    return row;
  }

  // ── Passo 2: mandar a lista (com a pergunta do excedente) ───────────────────────────────────────────────────
  function simNao(d, campo, valorAtual, pode, rotulo) {
    var qs = el('div', 'jor-filtros'); qs.setAttribute('role', 'group'); if (rotulo) qs.setAttribute('aria-label', rotulo);
    [['sim', 'Sim'], ['nao', 'Não']].forEach(function (o) {
      var b = el('button', 'jor-chip jor-chip-grande' + (valorAtual === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !pode; b.setAttribute('aria-pressed', valorAtual === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        var corpo = {}; corpo[campo] = o[0];
        api('/gerador/jornada-solar/obra/' + enc(O.card), 'PATCH', corpo).then(function (r) {
          if (r.status === 200 && r.json.ok !== false) carregarObra(); else toast(msgDe(r, 'Não consegui agora.'));
        });
      });
      qs.appendChild(b);
    });
    return qs;
  }
  function pergunta(txt, q) { var t = el('p', 'jor-perg', txt); if (q) t.appendChild(ajudaQ(q)); return t; }
  function corpoLista(c) {
    var d = O.dados;
    c.appendChild(pergunta('Tem excedente para outra conta de luz?', 'Se sim, a conta de cada imóvel que vai receber o excedente entra na lista.'));
    c.appendChild(simNao(d, 'excedente', d.excedente, !!d.pode.marcar_excedente, 'Tem excedente para outra conta de luz?'));
    var faltam = PEDIDOS.filter(function (p) { return !docRecebido(d, p); });
    var excFalta = d.excedente === 'sim' && !(d.slots && d.slots.conta_luz_beneficiaria);
    var sep = el('div', 'jor-sep'); c.appendChild(sep);
    if (!faltam.length && !excFalta) { c.appendChild(el('p', 'jor-ok', 'Tudo recebido. Nada para pedir.')); return; }
    var nomes = faltam.map(function (p) { return p.rot; }); if (excFalta) nomes.push('Conta do excedente');
    c.appendChild(pergunta('Vai na lista (' + nomes.length + '):'));
    var ul = el('ul', 'jor-vai'); nomes.forEach(function (x) { ul.appendChild(el('li', '', x)); }); c.appendChild(ul);
    var txt = mensagemPedido(d, faltam, excFalta); var tel = telefoneWa(d);
    var pre = el('pre', 'jor-ped-msg', txt); pre.hidden = true;
    var ac = el('div', 'jor-docs-ac');
    if (tel) ac.appendChild(btn('Enviar no WhatsApp', 'jor-btn-pri', function () { abrirWa(tel, txt); marcarPedidos(d, faltam); }));
    ac.appendChild(btn('Copiar lista', '', function () {
      copiarTexto(txt).then(function (ok) { if (!ok) pre.hidden = false; toast(ok ? 'Lista copiada. Cole na conversa com o cliente.' : 'Não consegui copiar. Selecione e copie a mensagem abaixo.'); });
      marcarPedidos(d, faltam);
    }));
    ac.appendChild(el('p', 'jor-nota', (tel ? '' : 'Sem telefone do cliente: só dá para copiar. ') + 'O que for na lista fica marcado como pedido.'));
    c.appendChild(ac); c.appendChild(pre);
  }

  // ── Passo 3: anexar tudo (documentos, fotos e as contas do excedente com a conferência do CPF) ────────────────────
  /** Obra que concluiu a etapa 1 pela regra antiga: a api manda na etapa 2 o bloco 'pendentes' (só enquanto faltam), um item por documento ou foto. */
  function pendentesDe(d) {
    var e2 = (d.etapas || [])[1];
    return ((e2 && e2.itens) || []).filter(function (i) { return i && i.bloco === 'pendentes' && !i.feito; });
  }
  function corpoAnexos(c) {
    var d = O.dados; var et = d.etapas[0];
    var pend = pendentesDe(d);
    if (pend.length) {
      // Só o que faltou na etapa 1: a CNH, a conta de luz e as fotos que a api listou, para anexar aqui mesmo.
      var chaves = pend.map(function (i) { return i.chave; });
      c.appendChild(el('p', 'jor-nota jor-nota-topo', 'Pendente da etapa 1. Anexe só o que falta.'));
      var lp = el('div', 'jor-docs-l'); PEDIDOS.forEach(function (p) { if (chaves.indexOf(p.item) >= 0) lp.appendChild(linhaDoc(d, p, { semPedido: true })); }); c.appendChild(lp);
      return;
    }
    c.appendChild(el('p', 'jor-nota jor-nota-topo', 'Anexe o que o cliente mandar. A CNH e a conta de luz preenchem a ficha do cliente sozinhas.'));
    var lista = el('div', 'jor-docs-l'); PEDIDOS.forEach(function (p) { lista.appendChild(linhaDoc(d, p)); }); c.appendChild(lista);
    if (d.excedente === 'sim') {
      c.appendChild(subTitulo('Contas que recebem o excedente'));
      c.appendChild(listaVarios(d, et, { slot: 'conta_luz_beneficiaria', rotBase: 'Conta excedente', add: 'Adicionar conta excedente', item: 'conta_excedente', titulo: '', cartaoVazio: true }));
      // A api sempre manda o objeto: ok false = aviso com o texto dela; ok true = mesmo CPF; ok nulo = ainda não deu para conferir (a lista UC por UC).
      var cpf = d.excedente_cpf || { ok: null };
      if (cpf.ok === false) {
        var av = el('p', 'jor-aviso', cpf.texto || 'O CPF da conta do excedente não confere com o da conta principal.'); av.style.marginTop = '10px'; c.appendChild(av);
        // Pedido de troca de titularidade (texto final do redator). Quem envia é a pessoa: nada sai pelo sistema.
        var tel = telefoneWa(d);
        var txt = mensagemTitularidade(d);
        var pre = el('pre', 'jor-ped-msg', txt); pre.hidden = true;
        var ac = el('div', 'jor-docs-ac'); ac.style.marginTop = '10px';
        if (tel) ac.appendChild(btn('Enviar no WhatsApp', '', function () { abrirWa(tel, txt); }));
        ac.appendChild(btn('Copiar', '', function () { copiarTexto(txt).then(function (ok) { if (!ok) pre.hidden = false; toast(ok ? 'Pedido copiado. Cole na conversa com o cliente.' : 'Não consegui copiar. Selecione e copie a mensagem abaixo.'); }); }));
        c.appendChild(ac); c.appendChild(pre);
      } else if (cpf.ok === true) c.appendChild(el('p', 'jor-ok', 'Mesmo CPF da conta principal.'));
      else {
        ((d.documentos && d.documentos.beneficiarias) || []).forEach(function (bn) {
          var li = el('div', 'jor-conta');
          li.appendChild(etq(bn.mesmo_titular ? 'ok' : 'Titular diferente', bn.mesmo_titular ? 'ok' : 'er'));
          li.appendChild(el('span', bn.mesmo_titular ? 'jor-ok' : 'jor-erro', 'UC ' + bn.uc + ' · ' + (bn.titular || 'sem titular') + ' · ' + (bn.mesmo_titular ? 'Mesmo titular' : 'Titular diferente. Todas as contas precisam estar no nome de ' + d.documentos.titular_geradora + '.')));
          c.appendChild(li);
        });
      }
    } else if (d.excedente !== 'nao') c.appendChild(el('p', 'jor-nota', 'Diga no passo 2 se tem excedente.'));
  }

  // ── Passo 4: conferir a ficha (confirmar cliente e venda; os dados ficam no resumo) ───────────────────────────────
  function txtKit(x) {
    if (x === null || x === undefined || x === '') return '';
    if (typeof x === 'object') { var q = x.quantidade || x.qtd || ''; var m = [x.marca, x.modelo, x.potencia_w ? x.potencia_w + ' W' : ''].filter(Boolean).join(' '); return [q ? q + ' x' : '', m].filter(Boolean).join(' '); }
    return String(x);
  }
  var FORMAS_ROT = { pix: 'Pix', ted: 'TED', boleto: 'Boleto', cartao: 'Cartão', financiamento: 'Financiamento', dinheiro: 'Dinheiro' };
  var KITS = [['placas', 'Placas', 'Ex.: 14 x Canadian 590 W'], ['inversor', 'Inversor', 'Ex.: 1 x Growatt 10K']];
  /** Uma célula de leitura: rótulo (com o tique quando confirmado) e o valor. */
  function celula(rot, v, ok, larga) {
    var c = el('div', 'jor-rc' + (larga ? ' larga' : ''));
    var r = el('div', 'jor-rc-rot', rot); if (ok) { r.appendChild(icone('ok')); r.appendChild(srTxt('confirmado')); } c.appendChild(r);
    c.appendChild(typeof v === 'string' ? el('div', 'jor-rc-v', v) : v);
    return c;
  }
  function abrirLigacoes() {
    abrirQuadro();
    quadroPronto(null, 8000).then(function (st) { var alvo = st && st.no && st.no.vinc; if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  function ligarProposta(d, et, c) {
    if (d.proposta) return;
    c.appendChild(el('p', 'jor-aviso', 'Esta venda ainda não tem a proposta aceita ligada.'));
    if (d.pode.ligar_proposta && d.propostas_candidatas && d.propostas_candidatas.length) {
      d.propostas_candidatas.forEach(function (p) {
        var l = el('div', 'jor-email-lin'); l.style.marginTop = '8px';
        l.appendChild(el('span', '', p.codigo + ' · ' + p.cliente + (p.kwp ? ' · ' + String(p.kwp).replace('.', ',') + ' kWp' : '') + (p.data ? ' · ' + ddmm(p.data) : '')));
        var bl = btn('Ligar', '', function () {
          bl.disabled = true;
          api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/proposta', 'POST', { codigo: p.codigo }).then(function (r) {
            if (r.status === 200 && r.json.ok !== false) carregarObra(); else { bl.disabled = false; toast(msgDe(r, 'Não consegui ligar agora.')); }
          });
        });
        bl.setAttribute('aria-label', 'Ligar a proposta ' + p.codigo); l.appendChild(bl); c.appendChild(l);
      });
    } else if (!et.concluida_em) c.appendChild(btn('Ligar a proposta', '', abrirLigacoes));
  }
  function corpoFicha(c) {
    var d = O.dados; var et = d.etapas[0];
    var vv = d.venda; var dc = d.dados_cliente || {}; var kv = d.kit_vendido || null;
    var vede = !!(vv && vv.valor_centavos !== undefined) || (dc && dc.valor_centavos !== undefined);   // quem vê o valor é decidido pela api (o vendedor vê, mesmo sem o Livro)
    var topo = el('div', 'jor-docs-ac'); topo.appendChild(el('p', 'jor-nota', 'Os dados estão no resumo, no topo. Confira lá e confirme aqui.'));
    var bv = btn('Ver a ficha', 'jor-btn-link', function () { irPara('jor-s-cliente'); }); topo.appendChild(bv); c.appendChild(topo);
    // Cliente
    c.appendChild(linhaConfirmar(d, et, {
      sec: 'cliente', titulo: 'Dados do cliente', chaves: CAMPOS_CLIENTE.map(function (x) { return x.chave; }), rotulo: 'Confirmar dados do cliente', aria: 'Confirmar dados do cliente',
      temValor: function (k) { var x = cfgCliente(k); var v = lerCampos(d, x); return !!(v && cheio(x, v)); },
      rotDe: function (k) { return cfgCliente(k).rot.replace(' do cliente', '').toLowerCase(); },
    }));
    // Venda: o kit escrito à mão (quando a proposta não tem), a proposta ligada e o Confirmar venda.
    ligarProposta(d, et, c);
    var kitIn = {};
    if (kv) KITS.forEach(function (k) {
      var ch = k[0]; var ek = 'kit.' + ch; var falta = Array.isArray(kv.faltando) && kv.faltando.indexOf(ch) >= 0;
      if (!falta && !O.edita[ek]) return;
      var rot = k[1] + ' (quantidade e marca)';
      var lin = el('div', 'jor-email-lin');
      var inp = el('input', 'jor-in' + (falta ? ' falta' : '')); inp.type = 'text'; inp.maxLength = 120; inp.autocomplete = 'off'; inp.name = 'kit-' + ch; inp.placeholder = k[2]; inp.setAttribute('aria-label', rot);
      inp.value = O.rascunho[ek] != null ? O.rascunho[ek] : (falta ? '' : txtKit(kv[ch]));
      inp.addEventListener('input', function () { O.rascunho[ek] = inp.value; });
      inp.disabled = !!semConfirmar(d, et); lin.appendChild(inp);
      if (!falta) { var cn = btn('Cancelar', '', function () { delete O.edita[ek]; delete O.rascunho[ek]; desenharObra(); }); cn.setAttribute('aria-label', 'Cancelar a edição: ' + k[1]); lin.appendChild(cn); }
      kitIn[ch] = inp; c.appendChild(campoRot(rot, lin, falta ? etq('A proposta não diz', 'av') : null, true));
    });
    var valorC = vv && vv.valor_centavos > 0 ? vv.valor_centavos : (typeof dc.valor_centavos === 'number' && dc.valor_centavos > 0 ? dc.valor_centavos : 0);
    var pgs = vv && vv.pagamento && vv.pagamento.length ? vv.pagamento : (Array.isArray(dc.pagamento) ? dc.pagamento : []);
    var temDin = vede && ((vv && vv.valor_centavos !== undefined) || dc.valor_centavos !== undefined);
    var rotK = { placas: 'placas', inversor: 'inversor', valor: 'valor', pagamento: 'forma de pagamento' };
    var lc = linhaConfirmar(d, et, {
      sec: 'venda', titulo: 'Venda', chaves: (kv ? ['placas', 'inversor'] : []).concat(temDin ? ['valor', 'pagamento'] : []), rotulo: 'Confirmar venda', aria: 'Confirmar a venda',
      temValor: function (k) { if (k === 'valor') return valorC > 0; if (k === 'pagamento') return pgs.length > 0; return !!txtKit(kv && kv[k]); },
      rotDe: function (k) { return rotK[k]; },
      coletar: {
        chaves: function () { return Object.keys(kitIn); },
        lista: function () {
          var erro = ''; var itens = [];
          Object.keys(kitIn).forEach(function (ch) {
            var t = kitIn[ch].value.trim();
            if (t.length < 3 && !erro) { erro = 'Digite a quantidade e a marca ' + (ch === 'placas' ? 'das placas.' : 'do inversor.'); kitIn[ch].focus(); }
            itens.push({ chave: ch, texto: t, depois: function () {
              var k2 = d.kit_vendido; if (k2) { k2[ch] = t; if (Array.isArray(k2.faltando)) k2.faltando = k2.faltando.filter(function (x) { return x !== ch; }); var mn = Array.isArray(k2.manual) ? k2.manual : (k2.manual = []); if (mn.indexOf(ch) < 0) mn.push(ch); }
              delete O.edita['kit.' + ch]; delete O.rascunho['kit.' + ch];
            } });
          });
          return { erro: erro, itens: itens };
        },
      },
    });
    c.appendChild(lc);
    // Os botões de editar a venda ficam na linha da venda: valor, pagamento e prazo (o formulário de sempre) e o kit escrito à mão.
    var editaVenda = !!d.pode.editar_venda && (O.vendaEdita || !vv);
    var acs = lc.querySelector('.jor-din-acoes'); if (!acs) { acs = el('div', 'jor-din-acoes'); lc.appendChild(acs); }
    if (d.pode.editar_venda && !editaVenda) acs.appendChild(btn('Editar valor, pagamento e prazo', '', function () { O.vendaEdita = true; desenharObra(); }));
    if (kv && Array.isArray(kv.manual) && !semConfirmar(d, et)) kv.manual.forEach(function (ch) {
      if (O.edita['kit.' + ch] || (kv.faltando || []).indexOf(ch) >= 0) return;
      var be = btn('Editar ' + (ch === 'placas' ? 'placas' : 'inversor'), '', function () { O.edita['kit.' + ch] = true; desenharObra(); }); acs.appendChild(be);
    });
    if (editaVenda) {
      var fx = el('div', 'jor-venda-form'); fx.appendChild(subTitulo(vv ? 'Editar valor, pagamento e prazo' : 'Valor, pagamento e prazo'));
      formVenda(fx, d, function () { O.vendaEdita = false; carregarObra(); }, et);
      if (vv) fx.appendChild(btn('Cancelar', '', function () { O.vendaEdita = false; desenharObra(); }));
      c.appendChild(fx);
    }
    var com = (d.comissoes || []).filter(function (x) { return x.papel === 'venda'; })[0];
    if (com && d.etapas[0].dono[0] && com.nome === d.etapas[0].dono[0].nome && d.pode.editar_venda) {
      c.appendChild(el('p', 'jor-nota', 'Sua comissão: ' + reais(com.valor_centavos) + ' (' + (com.pb / 100) + '% do vendido). Paga depois que a entrada entrar.'));
    }
    if (!et.concluida_em) lc.firstChild.appendChild(ajudaQ('Com a venda confirmada, a equipe toda recebe o aviso de venda no WhatsApp.'));
  }

  // ── Passo 5: financiamento, contrato e procuração (e o recibo, se quiser) ────────────────────────────────────────
  function corpoPapeis(c) {
    var d = O.dados; var fin = d.financiamento === 'sim' || d.financiamento === 'nao' ? d.financiamento : null;
    c.appendChild(pergunta('Precisa de proposta de banco ou financiamento?'));
    c.appendChild(simNao(d, 'financiamento', fin, !!d.pode.marcar_excedente, 'Precisa de proposta de banco ou financiamento?'));
    if (fin === 'sim') {
      if (window.Jornada.extras.banco) window.Jornada.extras.banco(c, d);
      else c.appendChild(el('p', 'jor-nota', 'A proposta de banco não carregou. Atualize a página.'));
    }
    c.appendChild(el('div', 'jor-sep'));
    var lista = el('div', 'jor-docs-l');
    function linhaPapel(rot, tipo, extraCtl, gerarFn) {
      var gp = d.papeis && d.papeis[tipo];
      var l = el('div', 'jor-papel'); var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', rot));
      var est = el('div', 'jor-doc-est'); est.appendChild(el('span', 'st ' + (gp ? 'st-ok' : 'st-falta'), gp ? 'Gerado em ' + ddmm(String(gp.gerado_em).slice(0, 10)) : 'Falta gerar')); info.appendChild(est);
      l.appendChild(info);
      var ac = el('div', 'jor-papel-ac'); if (extraCtl) ac.appendChild(extraCtl);
      var g = btn(gp ? 'Gerar de novo' : 'Gerar ' + rot.toLowerCase(), gp ? '' : 'jor-btn-pri', function () { gerarFn(g); });
      g.setAttribute('aria-label', (gp ? 'Gerar de novo: ' : 'Gerar: ') + rot);
      negar(g, d.pode.gerar_papeis ? '' : 'Você não tem permissão para gerar os papéis.'); ac.appendChild(g);
      l.appendChild(ac); lista.appendChild(l);
    }
    linhaPapel('Contrato', 'contrato', null, function (g) { gerarPapel('contrato', {}, g); });
    var mod = el('select', 'jor-sel'); mod.setAttribute('aria-label', 'Modelo da procuração');
    [['1', 'Padrão'], ['2', 'Jurídico'], ['3', 'Concessionária e ANEEL']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; mod.appendChild(op); });
    linhaPapel('Procuração', 'procuracao', mod, function (g) { gerarPapel('procuracao', { modelo: Number(mod.value) }, g); });
    c.appendChild(lista);
    var pe = el('div', 'jor-docs-ac'); pe.style.marginTop = '12px';
    pe.appendChild(el('p', 'jor-nota', 'Assinados, eles entram no passo 6.'));
    // O recibo mostra o valor: aparece quando a api mandou o valor (mesma regra do resumo), não pela regra do Livro.
    var vv = d.venda; var dcr = d.dados_cliente || {};
    var vede = !!(vv && vv.valor_centavos !== undefined) || dcr.valor_centavos !== undefined;
    if (d.pode.gerar_papeis && vede) { var br = btn('Gerar recibo (opcional)', 'jor-btn-link', function () { reciboDialogo(d, br); }); pe.appendChild(br); }
    c.appendChild(pe);
  }

  // ── Itens com vários arquivos num slot só (contas do excedente e outros anexos) ──
  /** cfg: slot, rotBase, add, item (chave do item no servidor, p/ dica), titulo, cartaoVazio (sem arquivo: um cartão vazio com Foto, Arquivo e Print). */
  function listaVarios(d, et, cfg) {
    var CK_NOVA = cfg.slot + '#novo';
    var raiz = el('div');
    if (cfg.titulo) raiz.appendChild(subTitulo(cfg.titulo));
    var grade = el('div', 'jor-fotos'); raiz.appendChild(grade);
    var rodape = el('div'); raiz.appendChild(rodape);
    var esperou = false;
    var dica = (cfg.item && itemFeito(et, cfg.item)) || !!d.slots[cfg.slot];
    function pinta() {
      grade.replaceChildren(); rodape.replaceChildren();
      var st = quadroDoCard();
      var lista = (st && !st.carregando && st.docs && Array.isArray(st.docs.arquivos)) ? st.docs.arquivos.filter(function (a) { return a && a.slot === cfg.slot; }) : null;
      if (lista === null && !esperou) { esperou = true; quadroPronto(raiz).then(pinta); }
      if (lista === null && dica) { grade.appendChild(el('p', 'jor-nota', 'Carregando…')); return; }
      lista = lista || [];
      if (!lista.length && cfg.cartaoVazio) {
        var c0 = el('div', 'jor-foto'); var t0 = el('div', 'jor-foto-topo'); t0.appendChild(el('span', '', cfg.rotBase + ' 1')); t0.appendChild(etq('Falta', 'av')); c0.appendChild(t0);
        c0.appendChild(anexo(cfg.slot, cfg.rotBase + ' 1', false, { compacto: true, ck: CK_NOVA })); grade.appendChild(c0);
        return;
      }
      if (!lista.length) grade.appendChild(el('p', 'jor-nota', 'Nenhum anexo ainda.'));
      lista.forEach(function (a, i) {
        var rot = cfg.rotBase + ' ' + (i + 1);
        var c = el('div', 'jor-foto'); var t = el('div', 'jor-foto-topo'); t.appendChild(el('span', '', rot)); t.appendChild(etq('Anexado', 'ok')); c.appendChild(t);
        c.appendChild(anexo(cfg.slot, rot, true, { compacto: true, id: a.id })); grade.appendChild(c);
      });
      if (O.ocupSlot[CK_NOVA]) { var oc = el('p', 'jor-nota', O.ocupSlot[CK_NOVA]); oc.setAttribute('role', 'status'); rodape.appendChild(oc); return; }
      rodape.appendChild(seletor(cfg.add, ACEITA_PADRAO, false, 'jor-btn', cfg.titulo || cfg.rotBase, function (arqs) { enviarArquivo(cfg.slot, arqs, false, pinta, { ck: CK_NOVA }); }));
      if (O.erroSlot[CK_NOVA]) { var er = el('p', 'jor-erro jor-anexo-msg', O.erroSlot[CK_NOVA]); er.setAttribute('role', 'alert'); rodape.appendChild(er); }
    }
    pinta();
    return raiz;
  }

  // ── Etapa 2: um cartão de anexo (com Trocar e Apagar) ───────────────────────────
  function cartaoAnexo(d, et, slot, rot, item, aceita) {
    var tem = (item && itemFeito(et, item)) || !!d.slots[slot];
    var cf = el('div', 'jor-foto'); var tp = el('div', 'jor-foto-topo'); tp.appendChild(el('span', '', rot)); tp.appendChild(etq(tem ? 'Anexado' : 'Falta', tem ? 'ok' : 'av')); cf.appendChild(tp);
    cf.appendChild(anexo(slot, rot, tem, aceita ? { compacto: true, aceita: aceita } : { compacto: true }));
    return cf;
  }

  // ── Trello e relatório final ─────────────────────────────────────────────────
  function relatorioFinalDe(r) { var j = r.json || {}; return (j.relatorio_final && j.relatorio_final.url) || j.url || (j.relatorio && j.relatorio.url) || ''; }
  function blocoTrelloRelatorio(d, et) {
    var b = secao('Trello e relatório final', itensPorChave(et, ['trello']));
    var cartao = d.trello && ((d.trello.url && d.trello.fonte !== 'dossie') || d.trello.tem_cartao);
    if (!cartao) {
      b.appendChild(el('p', 'jor-nota', 'O cartão do Trello é criado sozinho quando as fases 1, 2 e 3 fecham.'));
      var ta = d.trello_auto;
      if (ta && !ta.pronto && Array.isArray(ta.falta) && ta.falta.length) b.appendChild(el('p', 'jor-nota', 'Falta para criar o cartão: ' + ta.falta.join(', ') + '.'));
    } else b.appendChild(el('p', 'jor-ok', 'O cartão do Trello já foi criado.'));
    var rf = d.relatorio_final;
    var info = el('p', 'jor-erro jor-anexo-msg'); info.setAttribute('role', 'alert');
    var temRel = !!(rf && rf.url && /^https:\/\//.test(rf.url));
    var semPerm = d.pode && d.pode.relatorio_final ? '' : 'Você não tem permissão para gerar o relatório final.';
    var rotGerar = temRel ? 'Gerar de novo' : 'Relatório final';
    function gerarRel() {
      var w = null; try { w = window.open('about:blank', '_blank'); } catch (e) { w = null; }
      bt.disabled = true; bt.textContent = 'Gerando…'; info.textContent = '';
      api('/gerador/jornada-solar/obra/' + enc(O.card) + '/relatorio-final', 'POST', {}, 120000).then(function (r) {
        bt.disabled = false; bt.textContent = rotGerar;
        var url = relatorioFinalDe(r);
        if (r.status === 200 && r.json.ok !== false && /^https:\/\//.test(url)) { if (w) w.location.href = url; else window.open(url, '_blank', 'noopener'); toast('Relatório final gerado.'); releia(); return; }
        if (w) { try { w.close(); } catch (e) { /* já fechada */ } }
        info.textContent = msgDe(r, 'Não consegui gerar o relatório final agora. Tente de novo.');
      });
    }
    var bt = btn(rotGerar, temRel ? '' : 'jor-btn-pri', gerarRel); negar(bt, semPerm);
    var ac = el('div', 'jor-din-acoes');
    if (temRel) { var ab = btn('Abrir', 'jor-btn-pri', function () { window.open(rf.url, '_blank', 'noopener'); }); negar(ab, semPerm); ac.appendChild(ab); }
    ac.appendChild(bt); b.appendChild(ac);
    if (rf && rf.gerado_em) b.appendChild(el('p', 'jor-nota', 'Gerado em ' + ddmm(String(rf.gerado_em).slice(0, 10)) + '.'));
    b.appendChild(info);
    b.appendChild(el('p', 'jor-nota', 'O relatório final vai para o cartão do Trello junto com tudo.'));
    return b;
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
  // ── Passo 6: assinaturas (contrato e procuração assinados, outros anexos e o número da obra) ─────────────────────────
  function blocoNumero(d) {
    var b4 = el('div');
    var ne = d.numero.estado;
    if (ne === 'tem') b4.appendChild(el('p', 'jor-ok', 'Nasceu ' + d.numero.codigo + ', com o contrato e a procuração assinados.'));
    else if (ne === 'cancelada') b4.appendChild(el('p', 'jor-nota', 'Venda cancelada não ganha número.'));
    else if (ne === 'falta_papeis') b4.appendChild(el('p', 'jor-nota', 'Nasce sozinho quando o contrato e a procuração assinados estiverem anexados.'));
    else if (ne === 'pronto' || ne === 'falhou') {
      var motivos = { trello: 'o Trello não respondeu', trello_grande: 'o quadro do Trello é grande demais', lento: 'o Trello está lento', ocupado: 'outra pessoa estava gravando', sem_credencial: 'falta a chave do Trello', sem_segredo: 'falta a chave de assinatura', banco: 'o banco não respondeu', sequencia: 'a sequência acabou' };
      b4.appendChild(el('p', 'jor-erro', ne === 'falhou' ? 'Não consegui dar o número agora (' + (motivos[d.numero.motivo] || 'tente de novo') + ').' : 'Os dois papéis assinados estão anexados. O número ainda não saiu.'));
      if (d.pode.numero) { var bn = btn('Tentar o número de novo', '', function () { tentarNumero(false, bn); }); b4.appendChild(bn); }
    } else if (ne === 'confirmar') {
      if (d.pode.numero_novo) {
        b4.appendChild(el('p', 'jor-aviso', 'Pode já estar na planilha.'));
        (d.numero.candidatos || []).forEach(function (cd) { b4.appendChild(el('p', 'jor-nota', cd.codigo + ' · ' + cd.cliente)); });
        var ac = el('div', 'jor-din-acoes');
        var bnn = btn('Criar o número novo', '', function () { tentarNumero(true, bnn); }); ac.appendChild(bnn);
        ac.appendChild(btn('Ligar a venda antiga', '', function () { abrirLigacoes(); }));
        b4.appendChild(ac);
      } else b4.appendChild(el('p', 'jor-nota', 'O Thiago confere a planilha antes de dar o número.'));
    }
    return b4;
  }
  function corpoAssinaturas(c) {
    var d = O.dados; var et = d.etapas[1];
    var gs = el('div', 'jor-fotos');
    gs.appendChild(cartaoAnexo(d, et, 'contrato_assinado', 'Contrato assinado', 'contrato_assinado'));
    gs.appendChild(cartaoAnexo(d, et, 'procuracao', 'Procuração assinada', 'procuracao'));
    c.appendChild(gs);
    c.appendChild(el('p', 'jor-nota', 'O contrato assinado fica arquivado aqui. Só a procuração segue para a homologação.'));
    c.appendChild(subTitulo('Outros anexos', etq('Opcional')));
    c.appendChild(listaVarios(d, et, { slot: 'outros', rotBase: 'Anexo', add: 'Adicionar anexo', item: null, titulo: '', cartaoVazio: false }));
    if (d.numero && d.numero.estado !== 'tem') { c.appendChild(subTitulo('Número da obra', etq('Automático', 'auto'))); c.appendChild(blocoNumero(d)); }
  }

  // ── Passo 7: vistoria (o formulário de jornada-obra.js, sem o título: o passo já diz) ─────────────────────────────
  function corpoVistoria(c) {
    var d = O.dados;
    if (!window.Jornada.extras.vistoria) { c.appendChild(el('p', 'jor-erro', 'O relatório de vistoria não carregou. Atualize a página.')); return; }
    window.Jornada.extras.vistoria(c, d);
    var t = c.querySelector('.jor-bloco > .jor-bloco-t'); if (t && t.parentNode) t.parentNode.removeChild(t);
  }

  // ── Passos 8 em diante: a homologação ────────────────────────────────────────────────────────────────────────
  function corpoEquipamento(c) {
    var d = O.dados; var et = d.etapas[2];
    var g = el('div', 'jor-fotos');
    g.appendChild(cartaoAnexo(d, et, 'datasheet_modulo', 'Datasheet da placa', 'datasheet_modulo'));
    g.appendChild(cartaoAnexo(d, et, 'datasheet_inversor', 'Datasheet do inversor', 'datasheet_inversor'));
    g.appendChild(cartaoAnexo(d, et, 'kmz', 'KMZ do local', 'kmz', ACEITA_KMZ));
    c.appendChild(g);
  }
  function corpoTrello(c) {
    var d = O.dados; var sem = d.numero.estado !== 'tem';
    var b = blocoTrelloRelatorio(d, d.etapas[2]); var t = b.querySelector('.jor-bloco-t'); if (t) b.removeChild(t);
    c.appendChild(b);
    var tr = d.trello || {};
    if (!((tr.url && tr.fonte !== 'dossie') || tr.tem_cartao)) {
      c.appendChild(subTitulo('Se o cartão não nascer sozinho'));
      if (tr.url) {
        // O cartão antigo, do dossiê da proposta: aparece, mas não conclui a etapa (ela pede o cartão padrão).
        var aa = el('a', 'jor-btn', 'Abrir o cartão antigo no Trello'); aa.href = tr.url; aa.target = '_blank'; aa.rel = 'noopener'; c.appendChild(aa);
        c.appendChild(veio({ rotulo: tr.rotulo }));
        c.appendChild(el('p', 'jor-nota', 'Este é o cartão do dossiê da proposta. Crie o cartão padrão para concluir a etapa.'));
      }
      var bt = btn('Criar cartão no Trello', '', function () {
        abrirQuadro();
        if (typeof vdcEst !== 'undefined' && vdcEst && typeof window.vdcTrPrevia === 'function') window.vdcTrPrevia(vdcEst);
      });
      bt.disabled = sem; c.appendChild(bt);
      if (sem) c.appendChild(el('p', 'jor-nota', 'A obra ainda não tem número. Ele nasce com o contrato e a procuração assinados.'));
    } else if (tr.url && tr.fonte !== 'dossie' && tr.criado_em) {
      c.appendChild(el('p', 'jor-nota', 'Criado em ' + ddmm(String(tr.criado_em).slice(0, 10)) + (tr.por ? ' por ' + nomeBonito(tr.por) : '') + '. O link está no resumo.'));
    }
  }
  function corpoRateio(c) {
    var d = O.dados;
    var bens = d.rateio.linhas.filter(function (l) { return l.papel === 'beneficiaria'; });
    c.appendChild(el('p', '', 'Esta usina manda excedente para ' + plural(bens.length, 'conta', 'contas') + ', além da geradora.'));
    var tb = el('table', 'jor-tbl');
    d.rateio.linhas.forEach(function (l) {
      var tr = el('tr'); [l.papel === 'geradora' ? 'Geradora' : 'Beneficiária', 'UC ' + l.uc, l.titular, l.endereco, l.pct === null ? '' : String(l.pct).replace('.', ',') + '%'].forEach(function (x) { tr.appendChild(el('td', '', x)); }); tb.appendChild(tr);
    });
    var rol = el('div', 'jor-rolar'); rol.appendChild(tb); c.appendChild(rol);
    c.appendChild(el('p', '', 'Total ' + String(d.rateio.total).replace('.', ',') + '%'));
    var cf = d.rateio_conferido && d.rateio_conferido.marca === d.rateio.marca;
    if (cf) c.appendChild(el('p', 'jor-ok', 'Conferido por ' + nomeBonito(d.rateio_conferido.por) + ' em ' + ddmm(String(d.rateio_conferido.conferido_em).slice(0, 10)) + '.'));
    else {
      var bc = btn('Conferi o rateio', 'jor-btn-pri', function () { bc.disabled = true; patch({ rateio_conferido: true }); });
      bc.disabled = !(d.rateio.total === 100 && d.pode.etapa3); c.appendChild(bc);
    }
    c.appendChild(el('p', 'jor-nota', 'Confira no protocolo da Cemig antes de concluir. O percentual se edita no quadro do fim da página.'));
  }
  function corpoArt(c) {
    var d = O.dados;
    c.appendChild(anexo('art', 'ART (documento)', !!d.slots.art)); c.appendChild(anexo('art_comprovante', 'Comprovante de pagamento da ART', !!d.slots.art_comprovante));
    c.appendChild(subTitulo('Engenheiro, projeto elétrico'));
    var fe = el('div', 'jor-filtros'); fe.setAttribute('role', 'group'); fe.setAttribute('aria-label', 'Pagamento do engenheiro');
    [['pago', 'Pago'], ['a_pagar', 'A pagar']].forEach(function (o) {
      var b = el('button', 'jor-chip' + (d.engenheiro === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !d.pode.etapa3; b.setAttribute('aria-pressed', d.engenheiro === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () { patch({ engenheiro: o[0] }); }); fe.appendChild(b);
    });
    c.appendChild(fe); c.appendChild(anexo('projeto_comprovante', 'Comprovante do engenheiro', !!d.slots.projeto_comprovante));
    c.appendChild(el('p', 'jor-nota', 'Pendente, o pagamento do engenheiro não trava a etapa. O comprovante entra aqui quando pagar.'));
  }
  function corpoProtocolo(c) {
    var d = O.dados;
    var num = el('input', 'jor-in'); num.type = 'text'; num.maxLength = 40; num.name = 'protocolo-numero'; num.autocomplete = 'off'; num.setAttribute('aria-label', 'Número do protocolo'); num.value = d.protocolo ? d.protocolo.numero : '';
    var dt = el('input', 'jor-in'); dt.type = 'date'; dt.name = 'protocolo-data'; dt.setAttribute('aria-label', 'Data do protocolo'); dt.value = d.protocolo ? d.protocolo.em : '';
    var sv = btn('Salvar', 'jor-btn-pri', function () { sv.disabled = true; patch({ protocolo: { numero: num.value.trim(), em: dt.value } }).then(function () { sv.disabled = false; }); });
    sv.disabled = !d.pode.etapa3; num.disabled = !d.pode.etapa3; dt.disabled = !d.pode.etapa3;
    var g = el('div', 'jor-grade'); var lp = el('label', '', 'Protocolo'); lp.appendChild(num); var ld = el('label', '', 'Data do protocolo'); ld.appendChild(dt); var ls = el('div', 'jor-grade-bt'); ls.appendChild(sv); add(g, lp, ld, ls); c.appendChild(g);
    c.appendChild(anexo('protocolo', 'Print do protocolo', !!d.slots.protocolo));
  }
  function corpoParecer(c) { c.appendChild(anexo('parecer_acesso', 'Parecer de acesso aprovado', !!O.dados.slots.parecer_acesso)); }

  // ── O Vendido pelo servidor (commit 3) ──────────────────────────────────────
  function vendido(card, linha) {
    return api('/gerador/vendas-solares/' + encodeURIComponent(String(card)) + '/vendido', 'POST', linha ? { linha: linha } : {}, 20000).then(function (r) {
      if (r.status === 200 && r.json && r.json.ok !== false) {
        // 200 com jornada:false e um aviso: o servidor gravou o VENDIDO mas não abriu a etapa 1. Quem clicou precisa ler o motivo.
        var aviso = (r.json.jornada === false && typeof r.json.aviso === 'string') ? r.json.aviso.trim() : '';
        if (aviso && typeof showToast === 'function') showToast(aviso, 9000);
        return { ok: true, historico: r.json.historico, jornada: r.json.jornada, aviso: aviso };
      }
      throw new Error(msgDe(r, 'Não consegui marcar a venda agora. Tente de novo.'));
    });
  }

  // Fase 2: os ajudantes que jornada-dinheiro.js e jornada-obra.js usam. Eles se registram em etapas, extras e dinheiro.
  var H = {
    api: api, el: el, add: add, btn: btn, icone: icone, ddmm: ddmm, reais: reais, rs: rs, cents: cents, nomeBonito: nomeBonito, plural: plural, esc: esc,
    anexo: anexo, blocoTitulo: blocoTitulo, comReserva: comReserva, etq: etq, quando: quando, cidadeUF: cidadeUF, campoRot: campoRot, subTitulo: subTitulo, dialogo: dialogo, dialogoMotivo: dialogoMotivo, fecharDlg: fecharDlg, toast: toast, releia: releia, imprimir: imprimir,
    empresaDoAparelho: empresaDoAparelho, msgDe: msgDe, corpo: corpo, abrirLista: abrirLista, desenhar: desenharObra, recarregar: function () { return carregarObra(); },
    ficha: function () { return O.ficha; }, sugs: sugs, veio: veio,
    atual: atualEtapa, O: function () { return O; }, gerarPapel: gerarPapel,
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
