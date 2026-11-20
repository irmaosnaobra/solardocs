/* Jornada da obra, fase 1 (05/11/2026): a aba Clientes do Solar e as etapas 1 a 3 da obra.
 * Fase 2 (06/11/2026): a faixa do dinheiro, as etapas 4 a 8 e os papéis do Fechamento nas etapas moram em jornada-dinheiro.js e jornada-obra.js, que se registram em window.Jornada.
 * Script clássico, um IIFE. Expõe window.Jornada = { abrirLista, abrirObra, vendido, h, etapas, extras, dinheiro }.
 * Funções do index.html são buscadas na hora da chamada, sempre com typeof: vdcFetch, admOk, vdcDetalhe, vdcFechar, vdcAnexar,
 * epEmitGet, showToast, navObrasSolar, navPainelSolar. A variável vdcEst é um `let` global do index: lida pelo nome, com typeof.
 * O DOM é montado com createElement e textContent (nada de HTML vindo do servidor, salvo o papel dentro do iframe sem scripts).
 * Cor só por var(--n-*) e var(--io-*), com a reserva escura que o .vdc e o .dc-* já usam. Sem emoji, sem exclamação, sem travessão. */
(function () {
  'use strict';

  var L = { dados: null, aba: 'ativas', filtro: 'todas', busca: '', consultor: '', carregando: false, erro: '', menu: null, ajuda: false };
  var O = { card: null, dados: null, fase2: null, fase3: null, dinheiro: null, ficha: null, fase2Erro: false, dinErro: false, ocupado: '', msg: '', painel: null, vdcChave: '', vdcNo: null, vdcDet: null, vdcPainel: 0, obraNo: null, debounce: 0, seq: 0, erroSlot: {}, ocupSlot: {},
    lendo: null, lendoFalhou: '', lendoT: 0, leit: null, novos: null, novosT: 0, edita: {}, rascunho: {}, confirmando: {}, erroSec: {}, vendaEdita: false, aba: null, abaVista: '', organizar: false, outroTipo: '', ratEdita: false };

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
    p.setAttribute('d', tipo === 'ok' ? 'M5 12.5l4.5 4.5L19 7.5' : tipo === 'doc' ? 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5' : tipo === 'baixo' ? 'M12 5v13M6.5 12.5L12 18l5.5-5.5' : 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z');
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
    '--n-bg': '#0F172A', '--n-tx': '#E5E7EB', '--n-tx2': '#B4C0D1', '--n-tx3': '#94A3B8', '--n-sf': '#1E293B', '--n-sf2': '#182338', '--n-sf3': '#2A384F', '--n-bd': '#334155', '--n-bd2': '#475569',
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
      // Visual novo: a seção de Clientes Solar e os diálogos dela ficam na fonte do app (o io2 só liga a fonte nas seções da lista dele).
      'html.io2[data-mode="app"] :is(#clientesSolarSection,.jor-dlg){font-family:var(--io-fonte)}',
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
      '.jor-chip-grande.jor-chip-3{padding:10px 16px}',
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
      '.jor-avatar{width:40px;height:40px;flex:0 0 40px;border-radius:50%;background:var(--io-azul-sf);color:var(--io-titulo);display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}',
      // Secoes dentro do mesmo cartao.
      '.jor-bloco{min-width:0}',
      // Cada seção da etapa: divisória grossa em cima, título maior e a situação (Completo ou Falta N) logo ao lado.
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
      '.jor-anexo-trocar{display:inline-flex;flex-direction:row;align-items:center;justify-content:center;min-height:44px;padding:0 10px;border-radius:8px;background:transparent;color:var(--io-azul-tx);font-size:13px;font-weight:600;cursor:pointer}',
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
      '.jor-vdc-sum{cursor:pointer;font-weight:600;font-size:15px;color:var(--io-titulo);padding:8px 0}',
      '.jor-vdcx .vdc{background:transparent;border:0;padding:0;color:var(--n-tx)}',
      '.jor-vdcx .vdc-tit{display:none}',
      '.jor-vdcx .vdc-sec-t,.jor-vdcx .vdc-pn-gr{text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;color:var(--io-titulo)}',
      '.jor-vdcx .vdc-btn{min-height:40px;border-radius:10px;border:1px solid var(--n-bd2);background:var(--n-sf);color:var(--n-tx);font-weight:600}',
      '.jor-vdcx .vdc-btn:hover:not(:disabled){background:var(--n-sf3)}',
      '.jor-vdcx .vdc-btn:disabled{opacity:1;background:var(--n-sf3);border-color:var(--n-bd);color:var(--n-tx3)}',
      '.jor-vdcx .vdc-btn-pri{background:var(--io-amarelo);border-color:var(--io-amarelo);color:var(--io-tinta)}',
      '.jor-vdcx .vdc-btn-pri:hover:not(:disabled){background:var(--io-amarelo-forte);border-color:var(--io-amarelo-forte)}',
      '.jor-vdcx .vdc-doc,.jor-vdcx .vdc-pn{background:var(--n-sf2);border-color:var(--n-bd)}',
      '.jor-vdcx .vdc-in{background:var(--n-sf);border-radius:10px;font-weight:500}',
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
      '.jor-res-g{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:20px 24px;margin-top:18px}',
      '.jor-grp{min-width:0;scroll-margin-top:16px}',
      '.jor-grp:focus{outline:none}',
      '.jor-grp-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 10px}',
      '.jor-grp-t h3{font-size:15px;font-weight:700;line-height:1.3}',
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
      '.jor-res-din{margin-top:20px;padding-top:18px;border-top:1px solid var(--n-bd)}',
      '.jor-res-din .jor-din-painel{border:0;box-shadow:none;padding:0;margin:0;background:transparent}',
      '.jor-res-din .jor-din-tit{font-size:15px;font-weight:700;margin:0 0 10px}',
      '.jor-res-din .jor-din-faixa{border:0;box-shadow:none;padding:0;background:transparent;gap:8px}',
      '.jor-res-din .jor-din-c{background:var(--n-sf2)}',
      '.jor-res-din .jor-bloco-t{font-size:15px;font-weight:700}',
      '.jor-res-din>.jor-bloco{margin-top:18px;padding-top:16px;border-top:1px solid var(--n-bd)}',
      '.jor-lendo{display:flex;align-items:center;gap:10px;padding:8px 12px;margin:0 0 10px;border-radius:10px;background:var(--io-azul-sf);color:var(--io-azul-tx);font-weight:600}',
      '.jor-lendo i{flex:0 0 10px;width:10px;height:10px;border-radius:50%;background:currentColor;animation:jor-pulso 1.2s ease-in-out infinite}',
      '.jor-doc .jor-lendo{grid-column:1/-1;margin:0;padding:6px 10px;font-size:13px}',
      '.jor-lendo.jor-lendo-auto{padding:0;background:none;border-radius:0;font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '.jor-lendo-auto i{flex:0 0 14px;width:14px;height:14px;background:none;border:2px solid currentColor;border-right-color:transparent;animation:jor-gira .8s linear infinite}',
      '.jor-vdcx .vdc-lendo{display:flex;align-items:center;gap:10px;margin:0;font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '.jor-vdcx .vdc-lendo i{flex:0 0 14px;width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:jor-gira .8s linear infinite}',
      '@media (prefers-reduced-motion:reduce){.jor-vdcx .vdc-lendo i{animation:none}}',
      '@keyframes jor-gira{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.jor-lendo-auto i{animation:none}}',
      '@keyframes jor-pulso{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}',
      '@media (prefers-reduced-motion:reduce){.jor-lendo i{animation:none}}',
      '.jor-perg{display:flex;align-items:center;flex-wrap:wrap;margin:14px 0 8px;font-size:14px;font-weight:600;color:var(--io-titulo)}',
      '.jor-sep{height:1px;background:var(--n-bd);margin:16px 0}',
      '.jor-vai{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0 0 12px;padding:0}',
      // O que vai na mensagem: tom neutro (o vermelho do que falta já está na etiqueta e em cada linha abaixo).
      '.jor-vai li{padding:3px 10px;border-radius:8px;background:var(--n-sf2);color:var(--n-tx);box-shadow:inset 0 0 0 1px var(--n-bd2);font-size:13px;font-weight:600}',
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
      '.jor-doc-est .st-falta{color:var(--io-er-tx)}',
      '.jor-doc-est .st-ped{color:var(--io-azul-tx)}',
      '.jor-doc-est .st-ok{color:var(--io-ok-fg)}',
      '.jor-doc .jor-anexo{padding:0;border:0}',
      '.jor-papel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;align-items:center;padding:12px 14px;border-top:1px solid var(--n-bd)}',
      '.jor-papel:first-child{border-top:0}',
      '.jor-papel-ac{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:flex-end}',
      '.jor-venda-form{margin-top:12px;padding:16px;border:1px solid var(--io-borda-campo);border-radius:12px;background:var(--n-sf2)}',
      '.jor-venda-form>.jor-sub-t:first-child{margin-top:0}',
      '.jor-rolar{overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '.jor-grade-bt{display:flex;align-items:flex-end}',
      '#jor-s-vistoria .jor-bloco>label{display:flex;flex-direction:column;gap:4px;margin:10px 0 0;font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '#jor-s-vistoria .jor-ob-par{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
      '#jor-s-vistoria .jor-bloco>label .jor-sel{align-self:flex-start}',
      '#jor-s-vistoria .jor-ob-grupo{margin-top:18px;font-size:14px;color:var(--io-titulo)}',
      '@media (max-width:760px){',
      '.jor-res-g,.jor-ficha-g{grid-template-columns:minmax(0,1fr)}',
      '.jor-doc,.jor-papel{grid-template-columns:minmax(0,1fr)}',
      '.jor-papel-ac{justify-content:flex-start}',
      '.jor-fc-ed{min-height:44px}',
      '.jor-rc-rot{flex-basis:84px}',
      '.jor-rc{flex-wrap:wrap}',
      '.jor-rc-rot+.jor-rc-v{flex:1 1 calc(100% - 96px)}',
      '.jor-res-din .jor-din-c b{font-size:17px}',
      '.jor-dl{grid-template-columns:minmax(0,1fr)}',
      '.jor-campos,.jor-fotos{grid-template-columns:minmax(0,1fr)}',
      '.jor-busca{width:100%}',
      '.jor-pg{grid-template-columns:minmax(0,1fr)}',
      '}',
    
      // A página do cliente (19/11/2026): cabeçalho, barra de abas fixa, o painel do passo e o Resumo. Cor só por token.
      '.jor-obra-cab{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 12px}',
      '.jor-obra-cab .jor-num{font-size:15px;color:var(--io-titulo);background:var(--n-sf3);border-radius:8px;padding:2px 10px}',
      '.jor-obra-cab h2{font-size:22px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
      '.jor-cab-ac{display:flex;flex-wrap:wrap;gap:8px}',
      '.jor-cab-av{flex:1 0 100%;margin:0;font-size:13px;font-weight:600;line-height:1.4;color:var(--io-ambar-tx,#FDE68A)}',
      '.jor-abas-p{position:sticky;top:var(--top-h,0px);z-index:30;margin:0 0 12px;padding:6px 0;background:var(--n-bg);box-shadow:0 -12px 0 var(--n-bg)}',
      '.jor-abas-tr{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:4px 8px 4px 4px;border:1px solid var(--n-bd);border-radius:14px;background:var(--n-sf);box-shadow:var(--sombra)}',
      '.jor-abas-tr::-webkit-scrollbar{display:none}',
      '.jor-abas-tr.rola{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}',
      '.jor-ab{flex:0 0 auto;position:relative;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:6px 10px 6px 6px;border:0;border-radius:10px;background:transparent;color:var(--n-tx2);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;touch-action:manipulation}',
      '.jor-ab.res{padding:6px 12px}',
      '.jor-ab:hover:not(.travado):not(.sel){background:var(--n-sf2);color:var(--n-tx)}',
      '.jor-ab:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:-2px}',
      '.jor-ab.sel{background:var(--io-marcado);color:var(--n-inv)}',
      '.jor-ab.travado{color:var(--n-tx3);cursor:not-allowed}',
      '.jor-ab-mk{flex:0 0 24px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:1.5px solid var(--n-bd2);color:var(--n-tx2);background:var(--n-sf)}',
      '.jor-ab-mk svg{width:13px;height:13px}',
      '.jor-ab-mk i{width:8px;height:8px;border-radius:50%;background:currentColor}',
      '.jor-ab.feito .jor-ab-mk,.jor-and-l.feito .jor-ab-mk{background:var(--io-ok);border-color:var(--io-ok);color:var(--n-inv)}',
      '.jor-ab.atual .jor-ab-mk,.jor-and-l.atual .jor-ab-mk{background:var(--io-amarelo);border-color:var(--io-amarelo);color:var(--io-tinta)}',
      '.jor-ab.feito.av .jor-ab-mk,.jor-and-l.feito.av .jor-ab-mk{background:var(--io-av-sf);border-color:var(--io-ambar-tx);color:var(--io-ambar-tx)}',
      '.jor-ab.travado .jor-ab-mk,.jor-and-l.travado .jor-ab-mk{border-style:dashed;color:var(--n-tx3);background:transparent}',
      '.jor-ab.sel .jor-ab-mk{box-shadow:0 0 0 2px var(--n-inv)}',
      '.jor-ab.compacta:not(.sel) .jor-ab-t{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.jor-ab.compacta:not(.sel){padding:6px 10px}',
      '.jor-ab-sep{flex:0 0 1px;align-self:stretch;margin:6px 4px 6px 2px;background:var(--n-bd)}',
      // O motivo escrito de um botão desligado (20/11/2026): nunca cinza sem dizer por quê.
      '.jor-motivo{display:block;flex:1 0 100%;margin:4px 0 0;font-size:12.5px;line-height:1.4;font-weight:500;color:var(--n-tx2)}',
      '.jor-motivo-topo{margin:0 0 12px}',
      // A dica da aba (19/11/2026): o que falta no passo, ao passar o mouse ou focar com o teclado. Fixa na tela para a barra rolável não cortar.
      '.jor-dica{position:fixed;left:0;top:0;z-index:60;width:max-content;max-width:min(320px,calc(100vw - 16px));padding:10px 12px;border:1px solid var(--n-bd2);border-radius:10px;background:var(--n-sf);color:var(--n-tx);box-shadow:var(--sombra);font-size:13px;font-weight:500;line-height:1.45;white-space:normal;visibility:hidden;opacity:0;pointer-events:none;transition:opacity .12s ease,visibility .12s}',
      '.jor-dica.on{visibility:visible;opacity:1;pointer-events:auto}',
      '.jor-dica::before{content:"";position:absolute;top:-6px;left:var(--seta,16px);width:10px;height:10px;background:var(--n-sf);border-left:1px solid var(--n-bd2);border-top:1px solid var(--n-bd2);transform:rotate(45deg)}',
      '.jor-dica p{margin:0}',
      '.jor-dica-n{font-weight:700;color:var(--io-titulo);margin:0 0 6px}',
      '.jor-dica-t{color:var(--n-tx)}',
      '.jor-dica-t.ok{color:var(--io-ok-tx);font-weight:600}',
      '.jor-dica-h{font-size:12px;font-weight:700;letter-spacing:.02em;margin:8px 0 2px}',
      '.jor-dica-t+.jor-dica-h{margin-top:8px}',
      '.jor-dica-n+.jor-dica-h,.jor-dica>.jor-dica-h:first-child{margin-top:0}',
      '.jor-dica-h.ob{color:var(--io-er-tx)}',
      '.jor-dica-h.op{color:var(--io-av-tx)}',
      '.jor-dica ul{list-style:none;margin:0;padding:0}',
      '.jor-dica li{position:relative;padding:1px 0 1px 14px}',
      '.jor-dica li::before{content:"";position:absolute;left:2px;top:.62em;width:6px;height:6px;border-radius:50%}',
      '.jor-dica ul.ob li::before{background:var(--io-er)}',
      '.jor-dica ul.op li::before{background:var(--io-amarelo-forte)}',
      '.jor-dica-mais{color:var(--n-tx3);margin-top:4px}',
      '@media (prefers-reduced-motion:reduce){.jor-dica{transition:none}}',
      '.jor-painel{padding:20px 24px 24px;margin:0 0 32px}',
      '.jor-painel:focus{outline:none}',
      '.jor-pagina .jor-grp,.jor-pagina [id^=jor-s-],.jor-painel{scroll-margin-top:calc(var(--top-h,0px) + 76px)}',
      '.jor-passo-cab{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:8px 16px;padding-bottom:14px;border-bottom:1px solid var(--n-bd)}',
      '.jor-passo-de{display:block;font-size:12px;font-weight:600;color:var(--n-tx2)}',
      '.jor-passo-tt h3{font-size:22px;font-weight:700;line-height:1.25}',
      '.jor-passo-ld{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.jor-passo-ld .jor-avatar{width:32px;height:32px;flex:0 0 32px;font-size:12px}',
      '.jor-prazo{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin:12px 0 0;padding:8px 12px;border-radius:10px;background:var(--n-sf2);font-size:13px;color:var(--n-tx2)}',
      '.jor-prazo-d{font-weight:600;color:var(--n-tx)}',
      '.jor-prazo-ac{margin-left:auto}',
      '.jor-prazo-av{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:4px 12px}',
      '.jor-prazo-av .jor-nota{margin:0}',
      '.jor-passo-corpo>.jor-bloco{margin-top:24px;padding-top:20px;border-top:1px solid var(--n-bd)}',
      '.jor-passo-corpo>.jor-bloco:first-child{margin-top:16px;padding-top:0;border-top:0}',
      '.jor-passo-corpo>.jor-aviso:first-child{margin-top:16px}',
      '.jor-pe{margin-top:24px}',
      '.jor-pe .jor-portao-barra{margin-top:0}',
      '.jor-pe .jor-nota{margin:8px 0 0}',
      '.jor-pe>.jor-erro{margin:0 0 8px}',
      '.jor-pergs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}',
      '.jor-perg-c{padding:12px 16px 16px;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf2)}',
      '.jor-perg-c .jor-perg{margin:0 0 10px}',
      '.jor-perg-c .jor-filtros{margin:0}',
      '.jor-mandar{margin-top:12px;padding:14px 16px;border:1px solid var(--n-bd);border-radius:12px}',
      '.jor-mandar-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
      '.jor-mandar-t b{font-size:15px;color:var(--io-titulo)}',
      '.jor-mandar .jor-vai{margin:10px 0 12px}',
      '.jor-mandar .jor-docs-ac{margin:0}',
      '.jor-aviso-ac{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:12px 0 0}',
      '.jor-doc-add{grid-template-columns:minmax(0,1fr) auto}',
      '.jor-doc-add .jor-sel{width:100%}',
      '.jor-conf-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}',
      '.jor-conf-c{min-width:0;display:flex;flex-direction:column;gap:10px}',
      '.jor-conf-ct{font-size:13px;font-weight:700;color:var(--n-tx2)}',
      '.jor-conf.compacto{padding:0;border:0}',
      '.jor-conf.compacto .jor-din-acoes{margin-top:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.jor-conf.compacto>.jor-nota{margin:8px 0 0}',
      '.jor-rc-v .jor-in{margin:0}',
      '.jor-rc-v .jor-btn-link{margin-top:6px}',
      '.jor-vdcx{color:var(--n-tx)}',
      '.jor-vdcx *{box-sizing:border-box}',
      '.jor-vdcx .vdc-lst-bt{display:none}',
      '.jor-vdcx .vdc-acoes{display:flex;flex-wrap:wrap;gap:8px}',
      '.jor-vdcx .vdc-tre>.vdc-sec-t{display:none}',
      '.jor-vdcx .vdc-tre .vdc-btn{width:auto}',
      '.jor-vdcx .vdc-acoes .vdc-btn{width:auto;flex:0 0 auto}',
      '.jor-vdcx .vdc-acoes .vdc-btn-pri{background:var(--n-sf);border-color:var(--n-bd2);color:var(--n-tx)}',
      '.jor-vdcx .vdc-acoes .vdc-btn-pri:hover:not(:disabled){background:var(--n-sf3);border-color:var(--n-bd2)}',
      '.jor-res-g{margin-top:0;gap:28px 32px}',
      '.jor-res-col{min-width:0;display:flex;flex-direction:column;gap:28px}',
      '.jor-and{list-style:none;margin:0;padding:0;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-and-l{display:flex;align-items:flex-start;gap:10px;padding:10px 8px 10px 12px;border-top:1px solid var(--n-bd)}',
      '.jor-and-l:first-child{border-top:0}',
      '.jor-and-tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:2px}',
      '.jor-and-tx b{font-size:14px;font-weight:600;color:var(--io-titulo)}',
      '.jor-and-l.travado .jor-and-tx b{color:var(--n-tx3)}',
      '.jor-and-s{font-size:13px;color:var(--n-tx2)}',
      '.jor-and-s.av{color:var(--io-ambar-tx)}',
      '.jor-and-s a,a.jor-rdocs-ab{color:var(--io-azul-tx);font-weight:600;text-underline-offset:2px}',
      '.jor-and-l .jor-btn-link{flex:0 0 auto}',
      '.jor-rdocs{list-style:none;margin:0;padding:0;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-rdocs li{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border-top:1px solid var(--n-bd)}',
      '.jor-rdocs li:first-child{border-top:0}',
      '.jor-rdocs-t{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}',
      '.jor-rdocs-t b{font-size:14px;font-weight:600;color:var(--n-tx)}',
      '.jor-rdocs-t small{font-size:12px;color:var(--n-tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      'a.jor-rdocs-ab{flex:0 0 auto;display:inline-flex;align-items:center;min-height:40px;padding:0 8px;font-size:13px;border-radius:8px}',
      'a.jor-rdocs-ab:hover{background:var(--n-sf3)}',
      '.jor-grp-t .jor-btn-link{margin-left:auto}',
      '#jor-s-ligacoes{margin-top:16px}',
      '.jor-libera-forcar{justify-content:flex-start;text-align:left}',
      '@media (max-width:760px){',
      '.jor-painel{padding:16px}',
      '.jor-pergs,.jor-conf-g{grid-template-columns:minmax(0,1fr)}',
      '.jor-passo-tt h3,.jor-obra-cab h2{font-size:20px}',
      '.jor-ab{padding:6px 12px 6px 6px}',
      '.jor-ab.num:not(.sel):not(.ob) .jor-ab-t{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.jor-ab.num:not(.sel):not(.ob){padding:6px 10px}',
      '.jor-doc-add{grid-template-columns:minmax(0,1fr)}',
      '.jor-prazo-ac{margin-left:0}',
      '.jor-and-l .jor-btn-link,a.jor-rdocs-ab,.jor-grp-t .jor-btn-link{min-height:44px}',
      '.jor-pagina .jor-btn-link,.jor-pagina .jor-btn-disc,.jor-pagina .jor-chip,.jor-pagina .jor-fc-ed,.jor-dlg .jor-btn-link{min-height:44px}',
      '}',
      // A lista de clientes (19/11/2026): título com "?", abas, uma barra de filtros, tabela no computador e cartão no celular. Cor só por token.
      '.jor-lt-topo{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 16px;margin:0 0 8px}',
      '.jor-lt-tit{display:flex;align-items:center;gap:8px}',
      '.jor-lt-tit h2{font-size:20px;font-weight:700;line-height:1.2}',
      '.jor-lt-q{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:50%;border:1px solid var(--n-bd2);background:var(--n-sf);color:var(--n-tx2);font:inherit;font-size:13px;font-weight:700;cursor:pointer;position:relative}',
      '.jor-lt-q::after{content:"";position:absolute;inset:-8px}',
      '.jor-lt-q:hover,.jor-lt-q[aria-expanded=true]{background:var(--n-sf3);color:var(--n-tx)}',
      '.jor-lt-nav{display:flex;flex-wrap:wrap;gap:8px}',
      '.jor-lt-navb{min-height:40px;padding:6px 14px 6px 12px;font-size:14px;color:var(--n-tx)}',
      '.jor-lt-navb svg{color:var(--n-tx2);flex:0 0 auto}',
      '.jor-lt-ajuda{max-width:640px;margin:0 0 12px;padding:10px 14px;border:1px solid var(--n-bd);border-radius:10px;background:var(--n-sf2);color:var(--n-tx2);font-size:13px}',
      '.jor-lt-ajuda p{margin:0}',
      '.jor-lt-ajuda p+p{margin-top:6px}',
      '.jor-lt-abas{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;margin:0 0 16px;border-bottom:1px solid var(--n-bd)}',
      '.jor-lt-abas::-webkit-scrollbar{display:none}',
      '.jor-lt-aba{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;margin-bottom:-1px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--n-tx2);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}',
      '.jor-lt-aba:hover{color:var(--n-tx)}',
      '.jor-lt-aba.on{color:var(--io-titulo);font-weight:700;border-bottom-color:var(--io-amarelo)}',
      '.jor-lt-ct{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 6px;border-radius:999px;background:var(--n-sf3);color:var(--n-tx2);font-size:12px;font-weight:700}',
      '.jor-lt-aba.on .jor-lt-ct{background:var(--io-amarelo);color:var(--io-tinta)}',
      '.jor-lt-ct.er{background:var(--io-er-sf);color:var(--io-er-tx)}',
      '.jor-lt-fil{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px}',
      '.jor-lt-seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--n-bd2);border-radius:12px;background:var(--n-sf)}',
      '.jor-lt-segb{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--n-tx2);font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}',
      '.jor-lt-segb:hover:not(.on){background:var(--n-sf3);color:var(--n-tx)}',
      '.jor-lt-segb.on{background:var(--io-marcado);color:var(--n-inv)}',
      '.jor-lt-segb.on .jor-lt-ct{background:var(--n-sf);color:var(--io-titulo)}',
      '.jor-lt-segb.on .jor-lt-ct.er{background:var(--io-er-sf);color:var(--io-er-tx)}',
      '.jor-lt-sel{min-height:40px}',
      '.jor-lt-busca{width:280px;margin-left:auto}',
      '.jor-lt-aba:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:-2px;border-radius:8px 8px 0 0}',
      '.jor-lt-segb:focus-visible,.jor-lt-q:focus-visible,.jor-lt-din:focus-visible,.jor-lt-mais:focus-visible{outline:2px solid var(--io-azul-tx);outline-offset:2px}',
      '.jor-lt-wrap{border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-lt-tab{width:100%;border-collapse:separate;border-spacing:0;font-size:14px;color:var(--n-tx);font-variant-numeric:tabular-nums}',
      '.jor-lt-tab th{padding:10px 12px;background:var(--n-sf2);color:var(--n-tx2);font-size:12px;font-weight:600;text-align:left;white-space:nowrap;border-bottom:1px solid var(--n-bd)}',
      '.jor-lt-tab th:first-child{border-top-left-radius:11px}',
      '.jor-lt-tab th:last-child{border-top-right-radius:11px}',
      '.jor-lt-tab td{padding:12px;border-bottom:1px solid var(--n-bd);vertical-align:middle;text-align:left;color:var(--n-tx);font-size:14px;font-weight:400;background:transparent}',
      '.jor-lt-tab tbody tr:last-child td{border-bottom:0}',
      '.jor-lt-tab tbody tr:last-child td:first-child{border-bottom-left-radius:11px}',
      '.jor-lt-tab tbody tr:last-child td:last-child{border-bottom-right-radius:11px}',
      '.jor-lt-linha.abre{cursor:pointer}',
      '.jor-lt button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      '.jor-lt-linha:hover td{background:var(--n-sf2)}',
      '.jor-lt-n{width:84px}',
      '.jor-lt-dt{width:76px;white-space:nowrap;color:var(--n-tx2)}',
      'td.jor-lt-dt{color:var(--n-tx2)}',
      '.jor-lt-and{width:250px}',
      '.jor-lt-pz{width:200px}',
      '.jor-lt-din{width:190px}',
      'th.jor-lt-ac,td.jor-lt-ac{width:1%;white-space:nowrap}',
      '.jor-lt-meta{display:none}',
      '.jor-lt-cod{display:inline-block;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:13px;font-weight:600;color:var(--io-titulo);background:var(--n-sf3);border-radius:6px;padding:2px 8px;white-space:nowrap}',
      '.jor-lt-cod.vazio{font-family:inherit;font-weight:500;font-size:12px;color:var(--n-tx3);background:transparent;padding:2px 0}',
      '.jor-lt-cod.pend{font-family:inherit;font-size:12px;background:var(--io-av-sf);color:var(--io-ambar-tx)}',
      '.jor-lt-nome{display:block;font-size:14px;font-weight:600;color:var(--io-titulo);line-height:1.35}',
      '.jor-lt-sub{display:block;font-size:12px;color:var(--n-tx2);margin-top:2px}',
      '.jor-lt-andw{display:flex;align-items:center;gap:10px}',
      '.jor-lt-av{flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--io-azul-sf);color:var(--io-titulo);font-size:11px;font-weight:700}',
      '.jor-lt-av.vazio{background:transparent}',
      '.jor-lt-andt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.jor-lt-fase{font-size:13px;font-weight:600;color:var(--n-tx);line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.jor-lt-fase.apagada{font-weight:500;color:var(--n-tx3)}',
      '.jor-lt-trena{position:relative;display:block;height:8px;max-width:180px;border-radius:4px;background:var(--n-sf3);overflow:hidden}',
      '.jor-lt-trena i{position:absolute;top:0;bottom:0;left:0;background:var(--io-amarelo)}',
      '.jor-lt-trena i.jor-lt-vez{opacity:.4}',
      '.jor-lt-trena::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:var(--io-trena-marca,.5);background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),var(--io-tinta) calc(10% - 1px),var(--io-tinta) 10%)}',
      '.jor-lt-pzw{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.jor-lt-pzp{font-size:13px;font-weight:600;color:var(--n-tx);display:inline-flex;align-items:center;gap:6px}',
      '.jor-lt-pzp::before{content:"";flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:var(--n-bd2)}',
      '.jor-lt-pzd{font-size:12px;color:var(--n-tx2);padding-left:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}',
      '.jor-lt-pzw.no_prazo .jor-lt-pzp::before{background:var(--io-ok-tx)}',
      '.jor-lt-pzw.vence_hoje .jor-lt-pzp{color:var(--io-ambar-tx)}',
      '.jor-lt-pzw.vence_hoje .jor-lt-pzp::before{background:var(--io-av-tx)}',
      '.jor-lt-pzw.atrasada .jor-lt-pzp,.jor-lt-pzw.travada .jor-lt-pzp,.jor-lt-pzw.travada .jor-lt-pzd{color:var(--io-er-tx)}',
      '.jor-lt-pzw.atrasada .jor-lt-pzp::before,.jor-lt-pzw.travada .jor-lt-pzp::before{background:var(--io-er-tx)}',
      '.jor-lt-pzw.esperando .jor-lt-pzp::before{background:var(--io-azul-tx)}',
      '.jor-lt-pzw.sem_prazo .jor-lt-pzp,.jor-lt-pzw.cancelada .jor-lt-pzp{font-weight:500;color:var(--n-tx2)}',
      'button.jor-lt-din{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:auto;min-height:40px;margin:-4px -8px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:help}',
      'button.jor-lt-din:hover{background:var(--n-sf3)}',
      '.jor-lt-dinp{display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap}',
      '.jor-lt-dink{font-size:12px;color:var(--n-tx2)}',
      '.jor-lt-dinp b{font-size:14px;font-weight:600;color:var(--n-tx)}',
      '.jor-lt-dinp b.neg,.jor-lt-popl b.neg{color:var(--io-er-tx)}',
      '.jor-lt-dind{font-size:12px;color:var(--n-tx2);white-space:nowrap}',
      '.jor-lt-dinx{font-size:13px;color:var(--n-tx2)}',
      '.jor-lt-pop{display:none;position:absolute;z-index:25;top:calc(100% + 6px);right:0;min-width:220px;padding:8px 12px;border:1px solid var(--io-borda-campo);border-radius:10px;background:var(--n-sf);box-shadow:var(--sombra);cursor:default}',
      'button.jor-lt-din:hover .jor-lt-pop,button.jor-lt-din:focus .jor-lt-pop{display:block}',
      '.jor-lt-popl{display:flex;justify-content:space-between;gap:16px;padding:3px 0;font-size:13px;color:var(--n-tx2);white-space:nowrap}',
      '.jor-lt-popl b{font-weight:600;color:var(--n-tx)}',
      '.jor-lt-popl.tot{margin-top:4px;padding-top:7px;border-top:1px solid var(--n-bd)}',
      '.jor-lt-abrir{min-height:36px;padding:4px 14px;font-size:13px}',
      '.jor-lt-mais{width:36px;min-height:36px;padding:0;border-color:transparent;background:transparent;color:var(--n-tx2)}',
      '.jor-lt-mais:hover:not(:disabled),.jor-lt-mais[aria-expanded=true]{background:var(--n-sf3);color:var(--n-tx)}',
      '.jor-lt-vazio td{padding:32px 12px;text-align:center;color:var(--n-tx2)}',
      '@media (max-width:1100px){.jor-lt-dt{display:none}.jor-lt-and{width:210px}}',
      '@media (max-width:860px){',
      '.jor-lt-busca{width:100%;margin-left:0;order:-1;font-size:16px;min-height:44px}',
      '.jor-lt-sel{flex:1 1 auto;min-height:44px;font-size:16px}',
      '.jor-lt-segb{min-height:38px}',
      '.jor-lt-topo{gap:12px}',
      '.jor-lt-nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:8px;width:100%}',
      '.jor-lt-navb{flex-direction:column;gap:4px;min-height:56px;padding:6px 4px;font-size:12px}',
      '.jor-lt-seg{display:flex;width:100%}',
      '.jor-lt-segb{flex:1 1 0;justify-content:center;padding:0 8px}',
      '.jor-lt-aba{padding:0 10px}',
      '.jor-lt-wrap{border:0;background:transparent}',
      '.jor-lt-tab thead{display:none}',
      '.jor-lt-tab,.jor-lt-tab tbody{display:block}',
      '.jor-lt-tab tbody{display:flex;flex-direction:column;gap:10px}',
      '.jor-lt-linha{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"cl ac" "and and" "pz din";gap:12px 12px;padding:14px 14px 14px 16px;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-lt-linha:hover td{background:transparent}',
      '.jor-lt-tab td,.jor-lt-tab tbody tr:last-child td{display:block;width:auto;padding:0;border:0;border-radius:0}',
      '.jor-lt-tab td.jor-lt-n,.jor-lt-tab td.jor-lt-dt,.jor-lt-tab tbody tr:last-child td.jor-lt-n,.jor-lt-tab tbody tr:last-child td.jor-lt-dt{display:none}',
      'td.jor-lt-cl{grid-area:cl;align-self:center}',
      'td.jor-lt-ac{grid-area:ac;align-self:start}',
      'td.jor-lt-and{grid-area:and;padding:10px 0 0;border-top:1px solid var(--n-bd)}',
      'td.jor-lt-pz{grid-area:pz;grid-column:1 / -1}',
      '.com-din td.jor-lt-pz{grid-column:auto}',
      'td.jor-lt-din{grid-area:din;justify-self:end;text-align:right}',
      'button.jor-lt-din{align-items:flex-end;text-align:right;margin:-4px -8px -4px 0;min-height:44px}',
      '.jor-lt-pop{right:0}',
      '.jor-lt-trena{max-width:none}',
      '.jor-lt-pzd{max-width:none;white-space:normal}',
      '.jor-lt-abrir{min-height:44px;padding:4px 16px}',
      '.jor-lt-meta{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:12px;color:var(--n-tx2)}',
      '.jor-lt-mais{width:44px;min-height:44px}',
      '.jor-lt-vazio{display:block;border:1px dashed var(--n-bd2);border-radius:12px}',
      '.jor-lt-vazio td{display:block}',
      '}',
      // Leitura por IA ampliada (19/11/2026): ficha com identidade e conta de luz, origem por documento, "Ler todos os documentos" e o destaque do que entrou.
      '.jor-fc.largo{grid-column:1/-1}',
      '.jor-fc.vazio .jor-fc-v>span{font-size:13px;font-weight:500;color:var(--n-tx2)}',
      '.jor-fc{transition:background-color .9s ease,border-color .9s ease}',
      '.jor-fc.jor-novo{background:var(--io-azul-sf);border-color:var(--io-azul-tx)}',
      '.jor-rc{transition:background-color .9s ease}',
      '.jor-rc.jor-novo{background:var(--io-azul-sf)}',
      '.jor-rc-org{flex:0 0 auto;margin-left:auto;align-self:center;font-size:12px;font-weight:600;color:var(--io-azul-tx);white-space:nowrap}',
      '.jor-rc-org.mao{font-weight:500;color:var(--n-tx3)}',
      '.jor-sel.jor-in{width:100%}',
      '.jor-fc>.jor-email-cmp{flex:0 0 auto}',
      '.jor-grp-org{font-size:12px;font-weight:600;color:var(--io-azul-tx)}',
      '.jor-doc-est .st-opc{color:var(--io-av-tx)}',
      '@media (prefers-reduced-motion:reduce){.jor-fc,.jor-rc{transition:none}}',
      // O que falta (19/11/2026): vermelho = a api exige para concluir (itensDaEtapa); amarelo = falta, mas não trava. Feito não pinta.
      // O contorno é um outline por dentro (não mexe no tamanho); campo de digitar usa a borda, porque o outline dele é o do foco.
      '.jor-fx-ob{--fx-bd:var(--io-er);--fx-sf:var(--io-er-sf);--fx-tx:var(--io-er-tx)}',
      // O fundo do amarelo vai pela metade: o opcional não pode pesar mais que o obrigatório.
      '.jor-fx-op{--fx-bd:var(--io-amarelo-forte);--fx-sf:color-mix(in srgb,var(--io-amarelo-sf) 50%,var(--n-sf));--fx-tx:var(--io-av-tx)}',
      ':is(.jor-fx-ob,.jor-fx-op):is(.jor-fx-ob,.jor-fx-op):not(input,select,textarea){outline:2px solid var(--fx-bd);outline-offset:-2px;background-color:var(--fx-sf)}',
      ':is(input,select,textarea):is(.jor-fx-ob,.jor-fx-op):is(.jor-fx-ob,.jor-fx-op){border-color:var(--fx-bd);box-shadow:inset 0 0 0 1px var(--fx-bd);background-color:var(--fx-sf)}',
      ':is(.jor-docs-l,.jor-resumo)>:is(.jor-fx-ob,.jor-fx-op){margin:4px;border-radius:10px;border-top-color:transparent}',
      ':is(.jor-docs-l,.jor-resumo)>:is(.jor-fx-ob,.jor-fx-op)+*{border-top-color:transparent}',
      '.jor-anexo:is(.jor-fx-ob,.jor-fx-op),.jor-ob-linha:is(.jor-fx-ob,.jor-fx-op){margin:4px 0;padding:8px 12px;border-radius:10px;border-top-color:transparent}',
      '.jor-fc:is(.jor-fx-ob,.jor-fx-op) .jor-fc-v>span,.jor-rc:is(.jor-fx-ob,.jor-fx-op) .jor-rc-v.vazio{color:var(--fx-tx);font-weight:600}',
      '.jor-rc-v.vazio.fo{color:var(--io-er-tx);font-weight:600}',
      '.jor-rc-v.vazio.fp{color:var(--io-av-tx);font-weight:600}',
      '.jor-etq-fo{background:var(--n-sf);color:var(--io-er-tx);box-shadow:inset 0 0 0 1px var(--io-er-bd)}',
      '.jor-etq-fp{background:var(--n-sf);color:var(--io-av-tx);box-shadow:inset 0 0 0 1px var(--io-ambar-bd)}',
      '.jor-est.fo{color:var(--io-er-tx);font-weight:600}',
      '.jor-est.fp{color:var(--io-av-tx);font-weight:600}',
      // O ponto da pendência no número do passo (na barra e no Andamento).
      '.jor-ab-mk{position:relative}',
      // O ponto fica -3px dentro do número e a barra (overflow-x:auto corta o que passa) tem folga de 8px à direita: nada é cortado no celular.
      // O amarelo leva um aro âmbar por dentro: sem ele, some em cima do número amarelo do passo da vez.
      '.jor-ab-pd{--pd-aro:var(--n-sf);position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 2px var(--pd-aro)}',
      '.jor-ab.sel .jor-ab-pd{--pd-aro:var(--io-marcado)}',
      '.jor-ab-pd.ob{background:var(--io-er)}',
      '.jor-ab-pd.op{background:var(--io-amarelo);box-shadow:inset 0 0 0 2px var(--io-av-tx),0 0 0 2px var(--pd-aro)}',
      // O que falta para concluir, no pé do passo: uma etiqueta por item.
      '.jor-pe-falta{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:8px 0 0;padding:0}',
      '.jor-pe-falta li{padding:3px 10px;border-radius:8px;background:var(--n-sf);color:var(--io-er-tx);box-shadow:inset 0 0 0 1.5px var(--io-er);font-size:13px;font-weight:600;line-height:1.4}',
      '.jor-pe-falta li.op{color:var(--io-av-tx);box-shadow:inset 0 0 0 1.5px var(--io-amarelo-forte)}',
      // O que libera a próxima aba da obra (6, 7 e 8 não têm Concluir): uma linha, o que falta embaixo, e o Ir para quando liberou.
      '.jor-libera{display:flex;align-items:flex-start;gap:12px;margin:0 0 16px;padding:12px 14px;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf2)}',
      '.jor-libera-ic{flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--n-sf);color:var(--n-tx2);box-shadow:inset 0 0 0 1.5px var(--n-bd2)}',
      '.jor-libera.ok .jor-libera-ic{background:var(--io-ok);color:var(--n-inv);box-shadow:none}',
      '.jor-libera-tx{flex:1 1 auto;min-width:0}',
      '.jor-libera-f{margin:3px 0 0;font-size:14px;font-weight:600;line-height:1.45;color:var(--n-tx)}',
      '.jor-libera>.jor-btn{flex:0 0 auto;align-self:center}',
      '.jor-libera-forcar{margin-top:8px;padding:4px 0;border:0;min-height:32px;color:var(--n-tx3);text-decoration:underline;text-underline-offset:3px}',
      '.jor-libera-mot{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--n-tx2)}',
      '@media (max-width:600px){.jor-libera{flex-wrap:wrap}.jor-libera-tx{flex:1 1 200px}.jor-libera>.jor-btn{width:100%}}',
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

  // A lista fala a língua da página do cliente: os passos 1 a 5 e as etapas da obra. A api manda a etapa de 1 a 9
  // (a 1 são os passos 1 e 2, a 2 os passos 3 e 4, a 3 o passo 5). A trena tem 10 marcas: 5 passos e 5 etapas da obra; o Pós-venda enche a fita.
  var FASES = [null,
    { nome: 'Documentos e contrato', onde: 'Passos 1 e 2 de 5', feito: 0, vez: 2 },
    { nome: 'Assinaturas e vistoria', onde: 'Passos 3 e 4 de 5', feito: 2, vez: 2 },
    { nome: 'Homologação', onde: 'Passo 5 de 5', feito: 4, vez: 1 },
    { nome: 'Compra', onde: 'Obra, etapa 1 de 5', feito: 5, vez: 1 },
    { nome: 'Logística', onde: 'Obra, etapa 2 de 5', feito: 6, vez: 1 },
    { nome: 'Obra', onde: 'Obra, etapa 3 de 5', feito: 7, vez: 1 },
    { nome: 'Entrega', onde: 'Obra, etapa 4 de 5', feito: 8, vez: 1 },
    { nome: 'Liberação', onde: 'Obra, etapa 5 de 5', feito: 9, vez: 1 },
    { nome: 'Pós-venda', onde: 'Obra entregue', feito: 10, vez: 0 },
  ];
  var ICONES = {
    mapa: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    indica: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18.5 14.5a6.5 6.5 0 013 5.5',
    painel: 'M4 20V10M10 20V4M16 20v-7M21.5 20h-19',
    ajustes: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5',
    mais: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  function iconeL(nome, tam) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', String(tam || 18)); s.setAttribute('height', String(tam || 18)); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', nome === 'mais' ? '3.2' : '1.9'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', ICONES[nome]); s.appendChild(p);
    return s;
  }
  /** A trena da linha: o que já foi feito em amarelo cheio, a fase da vez em amarelo claro. */
  function trena(feito, vez) {
    var t = el('span', 'jor-lt-trena'); t.setAttribute('aria-hidden', 'true');
    var f = el('i', 'jor-lt-feito'); f.style.width = (feito * 10) + '%'; t.appendChild(f);
    if (vez) { var v = el('i', 'jor-lt-vez'); v.style.left = (feito * 10) + '%'; v.style.width = (vez * 10) + '%'; t.appendChild(v); }
    return t;
  }
  /** "Recebido R$ 1,00 · A receber ... · Saldo R$ -2,00" em pares. Texto que não segue o molde volta vazio. */
  function partesDinheiro(txt) {
    var out = {}; var achou = 0;
    String(txt || '').split(' · ').forEach(function (p) {
      var m = /^(Recebido|A receber|Gasto|Saldo) (.+)$/.exec(p); if (!m) return;
      achou++; var neg = /-/.test(m[2]); out[m[1]] = { txt: (neg ? '-' : '') + m[2].replace('-', ''), neg: neg };
    });
    return achou ? out : null;
  }
  /** O prazo em duas partes: o principal e o detalhe (o que vem depois do " · " ou do ": "). */
  function prazoPartes(l) {
    if (l.finalizada) return { tipo: 'sem_prazo', p: 'Fora da cobrança', d: '' };
    if (l.grupo === 'canceladas' && l.cancelada) return { tipo: 'cancelada', p: 'Cancelada em ' + ddmm(l.cancelada.em), d: ['Por ' + nomeBonito(l.cancelada.por), l.cancelada.motivo].filter(Boolean).join(' · ') };
    var t = String((l.situacao && l.situacao.texto) || ''); var tipo = (l.situacao && l.situacao.tipo) || 'sem_prazo';
    var i = t.indexOf(' · '); var j = t.indexOf(': ');
    var corte = i >= 0 ? i : j; var tam = i >= 0 ? 3 : 2;
    var p = corte >= 0 ? t.slice(0, corte) : t; var d = corte >= 0 ? t.slice(corte + tam) : '';
    if (tipo === 'no_prazo' && /^vence /.test(d)) { p = 'Vence ' + d.slice(6); d = 'No prazo'; }
    return { tipo: tipo, p: p || 'Sem prazo', d: d ? d.charAt(0).toUpperCase() + d.slice(1) : '' };
  }
  function ehAtrasada(l) { return l.grupo === 'ativas' && l.trilho === 'jornada' && (l.situacao.tipo === 'atrasada' || l.situacao.tipo === 'travada'); }
  var AJUDA_LISTA = {
    base: 'A lista segue a data da venda, da mais nova para a mais antiga. O número nasce com o contrato e a procuração assinados, por isso pode sair fora de ordem.',
    canceladas: 'Venda cancelada nunca gasta número.',
    finalizadas: 'Vendas de antes da jornada. Abrem só para leitura, com os dados da planilha. Ficam fora da cobrança e das mensagens.',
  };

  function desenharLista() {
    var c = corpo(); if (!c) return;
    var d = L.dados;
    var raiz = el('div', 'jor-lt');
    var topo = el('div', 'jor-lt-topo');
    var tit = el('div', 'jor-lt-tit'); tit.appendChild(el('h2', '', 'Clientes'));
    // O "?" abre a explicação da ordem e do número. Texto longo não fica solto na tela.
    var q = el('button', 'jor-lt-q', '?'); q.type = 'button'; q.setAttribute('aria-label', 'Como a lista funciona'); q.setAttribute('aria-expanded', L.ajuda ? 'true' : 'false'); q.setAttribute('aria-controls', 'jor-lt-ajuda');
    q.addEventListener('click', function () { L.ajuda = !L.ajuda; var a = document.getElementById('jor-lt-ajuda'); if (a) a.hidden = !L.ajuda; q.setAttribute('aria-expanded', L.ajuda ? 'true' : 'false'); });
    tit.appendChild(q); topo.appendChild(tit);
    var nav = el('div', 'jor-lt-nav');
    function navBtn(rot, ic, fn) { var b = btn('', 'jor-lt-navb', fn); b.appendChild(iconeL(ic, 18)); b.appendChild(el('span', '', rot)); return b; }
    add(nav, navBtn('Mapa', 'mapa', function () {
      if (typeof obEstado !== 'undefined' && obEstado) obEstado.aba = 'mapa';
      if (typeof navObrasSolar === 'function') navObrasSolar();
    }));
    add(nav, navBtn('Indicações', 'indica', function () {
      if (typeof obEstado !== 'undefined' && obEstado) obEstado.aba = 'indicacoes';
      if (typeof navObrasSolar === 'function') navObrasSolar();
    }));
    if (typeof admOk === 'function' && admOk()) add(nav, navBtn('Painel', 'painel', function () { if (typeof navPainelSolar === 'function') navPainelSolar(); }));
    if (typeof admOk === 'function' && admOk() && window.Jornada.dinheiro && window.Jornada.dinheiro.abrirAjustes) add(nav, navBtn('Ajustes', 'ajustes', function () { window.Jornada.dinheiro.abrirAjustes(); }));
    topo.appendChild(nav);
    raiz.appendChild(topo);
    var ajuda = el('div', 'jor-lt-ajuda'); ajuda.id = 'jor-lt-ajuda'; ajuda.hidden = !L.ajuda;
    ajuda.appendChild(el('p', '', AJUDA_LISTA.base));
    if (AJUDA_LISTA[L.aba]) ajuda.appendChild(el('p', '', AJUDA_LISTA[L.aba]));
    raiz.appendChild(ajuda);
    if (L.erro || !d) {
      raiz.appendChild(el('p', 'jor-erro', L.erro || 'Sem dados.'));
      add(raiz, btn('Tentar de novo', '', abrirLista));
      c.replaceChildren(raiz); return;
    }
    var ct = d.contagem;
    // Quais vendas: as abas. Dentro delas, os filtros numa barra só.
    var abas = el('div', 'jor-lt-abas'); abas.setAttribute('role', 'tablist'); abas.setAttribute('aria-label', 'Vendas');
    [['ativas', 'Ativas', ct.ativas], ['posvenda', 'Pós-venda', ct.posvenda], ['canceladas', 'Canceladas', ct.canceladas], ['finalizadas', 'Finalizadas', ct.finalizadas || 0]].forEach(function (a) {
      var on = L.aba === a[0];
      var b = el('button', 'jor-lt-aba' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.setAttribute('data-aba', a[0]);
      b.appendChild(el('span', '', a[1])); b.appendChild(el('span', 'jor-lt-ct', a[2]));
      b.addEventListener('click', function () { L.aba = a[0]; L.menu = null; desenharLista(); });
      abas.appendChild(b);
    });
    raiz.appendChild(abas);
    var fil = el('div', 'jor-lt-fil');
    if (L.aba === 'ativas') {
      var seg = el('div', 'jor-lt-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Filtro');
      [['todas', 'Todas', null], ['minha', 'Minha fila', ct.minha], ['atrasadas', 'Atrasadas', ct.atrasadas]].forEach(function (f) {
        var on = L.filtro === f[0];
        var b = el('button', 'jor-lt-segb' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.appendChild(el('span', '', f[1]));
        if (f[2] !== null) b.appendChild(el('span', 'jor-lt-ct' + (f[0] === 'atrasadas' && f[2] > 0 ? ' er' : ''), f[2]));
        b.addEventListener('click', function () { L.filtro = f[0]; desenharLista(); });
        seg.appendChild(b);
      });
      fil.appendChild(seg);
    }
    if (d.eu && d.eu.vePorConsultor) {
      var sel = el('select', 'jor-sel jor-lt-sel'); sel.setAttribute('aria-label', 'Consultor');
      var o0 = el('option', '', 'Todos os consultores'); o0.value = ''; sel.appendChild(o0);
      var vistos = {};
      d.linhas.forEach(function (l) { if (l.consultor && !vistos[l.consultor]) { vistos[l.consultor] = 1; } });
      Object.keys(vistos).sort().forEach(function (n) { var o = el('option', '', nomeBonito(n)); o.value = n; sel.appendChild(o); });
      sel.value = L.consultor;
      sel.addEventListener('change', function () { L.consultor = sel.value; desenharLista(); });
      fil.appendChild(sel);
    }
    var bu = el('input', 'jor-busca jor-lt-busca'); bu.type = 'search'; bu.placeholder = 'Buscar por nome ou número…'; bu.setAttribute('aria-label', 'Buscar por nome ou número'); bu.value = L.busca; bu.autocomplete = 'off'; bu.spellcheck = false;
    bu.addEventListener('input', function () { L.busca = bu.value; var pos = bu.selectionStart; desenharLista(); var nb = corpo().querySelector('.jor-lt-busca'); if (nb) { nb.focus(); try { nb.setSelectionRange(pos, pos); } catch (e) { /* tipo search */ } } });
    fil.appendChild(bu);
    raiz.appendChild(fil);

    var adm = !!(d.eu && d.eu.adm);
    var wrap = el('div', 'jor-lt-wrap' + (adm ? ' com-din' : ''));
    var tab = el('table', 'jor-lt-tab');
    var cab = el('tr');
    [['Nº', 'n'], ['Cliente', 'cl'], ['Venda', 'dt'], ['Andamento', 'and'], ['Prazo', 'pz']].concat(adm ? [['Dinheiro', 'din']] : []).concat([['', 'ac']]).forEach(function (t) {
      var th = el('th', 'jor-lt-' + t[1], t[0]); th.scope = 'col'; if (!t[0]) th.appendChild(srTxt('Ações')); cab.appendChild(th);
    });
    add(tab, add(el('thead'), cab));
    var tb = el('tbody');
    var linhas = linhasVisiveis();
    var anoAtual = String(new Date().getFullYear());
    linhas.forEach(function (l) {
      var abrir = l.card ? function () { abrirObra(l.card); } : l.codigo ? function () { abrirPlanilha(l.codigo); } : null;
      var tr = el('tr', 'jor-lt-linha' + (ehAtrasada(l) ? ' atrasada' : '') + (abrir ? ' abre' : ''));
      function td(cls) { var t = el('td', 'jor-lt-' + cls); tr.appendChild(t); return t; }
      // Nº: sem número, o adm vê se ele já pode nascer.
      var tn = td('n');
      if (l.codigo) tn.appendChild(el('span', 'jor-lt-cod', l.codigo));
      else if (l.numero_pendente) { var np = el('span', 'jor-lt-cod pend', 'Sem nº'); np.title = 'Número pendente'; tn.appendChild(np); }
      else tn.appendChild(el('span', 'jor-lt-cod vazio', 'Sem nº'));
      var tc = td('cl');
      var vd = l.vendida_em ? (l.vendida_em.slice(0, 4) === anoAtual ? ddmm(l.vendida_em) : ddmm(l.vendida_em) + '/' + l.vendida_em.slice(2, 4)) : '';
      // No celular o número e a data sobem para o cartão, numa linha só.
      var meta = el('span', 'jor-lt-meta'); meta.setAttribute('aria-hidden', 'true');
      if (l.codigo) meta.appendChild(el('span', 'jor-lt-cod', l.codigo)); else if (l.numero_pendente) meta.appendChild(el('span', 'jor-lt-cod pend', 'Sem nº'));
      if (vd) meta.appendChild(el('span', '', 'Venda ' + vd));
      tc.appendChild(meta);
      tc.appendChild(el('span', 'jor-lt-nome', l.cliente || 'Cliente sem nome'));
      var sub = [l.kwp ? String(l.kwp).replace('.', ',') + ' kWp' : '', cidadeUF(l.cidade)].filter(Boolean).join(' · '); if (sub) tc.appendChild(el('span', 'jor-lt-sub', sub));
      var tdt = td('dt'); if (vd) tdt.textContent = vd; else tdt.appendChild(el('span', 'jor-lt-sub', 'Sem data'));
      // Andamento: quem está com a venda, a fase da vez e a trena.
      var ta = td('and'); var and = el('div', 'jor-lt-andw');
      var fase = l.etapa ? FASES[l.etapa.n] : null;
      if (l.dono) { var av = el('span', 'jor-lt-av', l.dono.iniciais); av.title = 'Com ' + nomeBonito(l.dono.nome); av.setAttribute('aria-label', 'Com ' + nomeBonito(l.dono.nome)); av.setAttribute('role', 'img'); and.appendChild(av); }
      else if (!l.finalizada && l.grupo !== 'canceladas') and.appendChild(el('span', 'jor-lt-av vazio'));
      var at = el('div', 'jor-lt-andt');
      if (l.finalizada) { at.appendChild(el('span', 'jor-lt-fase', 'Finalizada')); at.appendChild(trena(10, 0)); }
      else if (l.grupo === 'canceladas') { at.appendChild(el('span', 'jor-lt-fase apagada', fase ? 'Parou em ' + minus(fase.nome) : 'Cancelada')); }
      else if (fase) {
        var fn = el('span', 'jor-lt-fase', fase.nome); fn.title = fase.onde; at.appendChild(fn);
        at.appendChild(trena(fase.feito, fase.vez)); at.appendChild(srTxt(', ' + fase.onde));
      } else at.appendChild(el('span', 'jor-lt-fase apagada', 'Sem trilho'));
      and.appendChild(at); ta.appendChild(and);
      // Prazo: a situação em uma linha forte e o detalhe embaixo.
      var pz = prazoPartes(l);
      var tp = td('pz'); var pw = el('div', 'jor-lt-pzw ' + pz.tipo);
      pw.appendChild(el('span', 'jor-lt-pzp', pz.p)); if (pz.d) pw.appendChild(el('span', 'jor-lt-pzd', pz.d));
      tp.appendChild(pw);
      // Dinheiro (só quem já via): o saldo à vista; recebido, a receber e gasto no detalhe.
      if (adm) {
        var tdn = td('din'); var pd = partesDinheiro(l.dinheiro);
        if (pd && pd.Saldo) {
          var db = el('button', 'jor-lt-din'); db.type = 'button';
          var linha1 = el('span', 'jor-lt-dinp'); linha1.appendChild(el('span', 'jor-lt-dink', 'Saldo')); linha1.appendChild(el('b', pd.Saldo.neg ? 'neg' : '', pd.Saldo.txt)); db.appendChild(linha1);
          if (pd['A receber']) db.appendChild(el('span', 'jor-lt-dind', 'A receber ' + pd['A receber'].txt));
          else if (pd.Recebido) db.appendChild(el('span', 'jor-lt-dind', 'Recebido ' + pd.Recebido.txt));
          db.setAttribute('aria-label', 'Dinheiro de ' + (l.cliente || 'cliente') + ': ' + ['Recebido', 'A receber', 'Gasto', 'Saldo'].filter(function (k) { return pd[k]; }).map(function (k) { return k + ' ' + pd[k].txt; }).join(', '));
          var pop = el('span', 'jor-lt-pop'); pop.setAttribute('aria-hidden', 'true');
          ['Recebido', 'A receber', 'Gasto', 'Saldo'].forEach(function (k) {
            if (!pd[k]) return; var r = el('span', 'jor-lt-popl' + (k === 'Saldo' ? ' tot' : '')); r.appendChild(el('span', '', k)); r.appendChild(el('b', pd[k].neg ? 'neg' : '', pd[k].txt)); pop.appendChild(r);
          });
          db.appendChild(pop); tdn.appendChild(db);
        } else if (pd) {
          var so = Object.keys(pd)[0]; var s1 = el('span', 'jor-lt-dinp'); s1.appendChild(el('span', 'jor-lt-dink', so)); s1.appendChild(el('b', '', pd[so].txt)); tdn.appendChild(s1);
        } else if (l.dinheiro) tdn.appendChild(el('span', 'jor-lt-dinx', l.dinheiro));
      }
      // Ações: Abrir leva à página do cliente; o menu guarda a venda cancelada (só ADM, em venda que corre).
      var ac = td('ac'); var acd = el('div', 'jor-cl-ac');
      if (abrir) { var ab = btn('Abrir', 'jor-lt-abrir', abrir); ab.setAttribute('aria-label', 'Abrir ' + (l.cliente || 'cliente')); acd.appendChild(ab); }
      if (l.card && adm && l.grupo !== 'canceladas' && !l.finalizada) {
        var mn = btn('', 'jor-lt-mais jor-cl-mais', function () { L.menu = L.menu === l.chave ? null : l.chave; desenharLista(); var x = corpo().querySelector('.jor-cl-menu button'); if (x) x.focus(); });
        mn.appendChild(iconeL('mais', 20));
        mn.setAttribute('aria-label', 'Mais ações: ' + l.cliente); mn.setAttribute('aria-haspopup', 'menu'); mn.setAttribute('aria-expanded', L.menu === l.chave ? 'true' : 'false');
        acd.appendChild(mn);
        if (L.menu === l.chave) {
          var mm = el('div', 'jor-cl-menu'); mm.setAttribute('role', 'menu');
          var mi = el('button', '', 'Venda cancelada'); mi.type = 'button'; mi.setAttribute('role', 'menuitem'); mi.setAttribute('aria-label', 'Venda cancelada: ' + l.cliente);
          mi.addEventListener('click', function () { L.menu = null; cancelarDialogo(l.card, function () { abrirLista(); }); });
          mi.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { L.menu = null; desenharLista(); var m2 = corpo().querySelectorAll('.jor-cl-mais'); Array.prototype.forEach.call(m2, function (b) { if (b.getAttribute('aria-label') === 'Mais ações: ' + l.cliente) b.focus(); }); } });
          mm.appendChild(mi); acd.appendChild(mm);
        }
      }
      ac.appendChild(acd);
      // A linha inteira abre o cliente com o mouse ou o toque. Botão, menu e dinheiro dentro dela fazem só o que é deles.
      if (abrir) tr.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('button,a,select,input,.jor-cl-menu')) return; abrir(); });
      tb.appendChild(tr);
    });
    if (!linhas.length) {
      var vz = el('tr', 'jor-lt-vazio'); var tz = el('td', '', L.busca.trim() ? 'Nenhum cliente com “' + L.busca.trim() + '”.' : 'Nenhuma venda aqui.'); tz.colSpan = 8; vz.appendChild(tz); tb.appendChild(vz);
    }
    tab.appendChild(tb); wrap.appendChild(tab); raiz.appendChild(wrap);
    c.replaceChildren(raiz);
  }
  // O menu da linha fecha com um clique fora dele.
  document.addEventListener('click', function (e) {
    if (!L.menu || !corpo() || (e.target && e.target.closest && e.target.closest('.jor-cl-ac'))) return;
    L.menu = null; if (L.dados && corpo().querySelector('.jor-lt-tab')) desenharLista();
  });

  // ── A obra ──────────────────────────────────────────────────────────────────
  function sairDaObra() {
    if (O.vdcNo && typeof vdcFechar === 'function') { try { vdcFechar(O.vdcNo); } catch (e) { /* já fechado */ } }
    O.vdcChave = ''; O.vdcNo = null; O.vdcDet = null; O.obraNo = null; O.fase2 = null; O.dinheiro = null; O.ficha = null; O.erroSlot = {}; O.ocupSlot = {};
    O.lendo = null; O.lendoFalhou = ''; if (O.lendoT) { clearTimeout(O.lendoT); O.lendoT = 0; } if (O.leit) { if (O.leit.t) clearTimeout(O.leit.t); O.leit = null; } O.novos = null; if (O.novosT) { clearTimeout(O.novosT); O.novosT = 0; } O.edita = {}; O.rascunho = {}; O.confirmando = {}; O.erroSec = {}; O.vendaEdita = false; O.aba = null; O.abaVista = ''; O.organizar = false; O.outroTipo = ''; O.ratEdita = false;
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
    // O quadro de documentos (index.html) fica montado e escondido no fim da página: os anexos, a leitura e o Trello falam com a api por ele.
    // Os pedaços que só existiam nele (cadastro completo, ligações, rateio, lista para renomear) a página pega emprestados no lugar certo.
    if (!O.vdcDet) { O.vdcDet = el('div', 'jor-vdc-det'); O.vdcDet.hidden = true; O.vdcDet.appendChild(O.vdcNo); }
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
        O.dados = r.json; acompanharLeitura();
        // Depois do Trazer (ou de qualquer volta de finalizada), o desenharObra põe o quadro de documentos de volta na etapa.
        montarQuadro(); desenharObra();
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
      { alvo: O.vdcNo, semFechamento: true, semTrello: semTrello, lerSozinho: true, aoMudar: releia });
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
      if (!falha && String(O.card) === card && leSlot(chave)) {
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
    // nivel: 'ob' (padrão: a api exige) ou 'op' (não trava: diz "Opcional"). semContorno: quem contorna é o cartão em volta.
    var nivel = opts.nivel === 'op' ? 'op' : 'ob';
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
        tp.appendChild(tem ? etq('Anexado', 'ok') : etqFalta(opts.rotFalta || (nivel === 'op' ? 'Opcional' : 'Falta'), nivel)); linha.appendChild(tp);
        if (!opts.semContorno) marcaFalta(linha, tem ? '' : nivel);
      }
      if (O.ocupSlot[ck]) { var oc = el('p', 'jor-nota', O.ocupSlot[ck]); oc.setAttribute('role', 'status'); linha.appendChild(oc); return; }
      if (tem) {
        var fora = arquivoDoSlot(chave, opts.id);
        if (fora && fora.fora) {
          // Já existe em outro depósito: mostra, só leitura. Ninguém sobe de novo nem apaga.
          var ok2 = el('div', 'jor-anexo-ok'); var mini2 = el('span', 'jor-anexo-mini');
          if (fora.url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(fora.url))) { var im2 = el('img'); im2.src = fora.url; im2.alt = ''; im2.loading = 'lazy'; im2.width = 44; im2.height = 44; mini2.appendChild(im2); } else mini2.appendChild(icone('ok'));
          ok2.appendChild(mini2);
          var leg2 = el('span', 'jor-anexo-leg'); leg2.appendChild(el('b', '', 'Anexado')); var dt2 = fora.em ? dataBr(fora.em) : ''; if (dt2) leg2.appendChild(el('small', '', dt2));
          leg2.appendChild(veio({ rotulo: fora.fora })); ok2.appendChild(leg2);
          if (fora.url && /^https:\/\//.test(fora.url)) { var ab2 = el('a', 'jor-anexo-trocar', 'Abrir'); ab2.href = fora.url; ab2.target = '_blank'; ab2.rel = 'noopener noreferrer'; ok2.appendChild(ab2); }
          linha.appendChild(ok2);
        } else {
          var ok = el('div', 'jor-anexo-ok');
          var mini = el('span', 'jor-anexo-mini'); var arq = fora;
          if (arq && arq.url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(arq.nome || arq.url))) { var im = el('img'); im.src = arq.url; im.alt = ''; im.loading = 'lazy'; im.width = 44; im.height = 44; mini.appendChild(im); } else mini.appendChild(icone('ok'));
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
    if (itens) { var em = el('em', 'jor-etq jor-etq-' + (falta ? 'fo' : 'ok'), falta ? 'Falta ' + falta : 'Completo'); h.appendChild(em); }
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

  function concluir(etapa, botao) {
    botao.disabled = true; O.msg = '';
    api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + (etapa >= 4 ? '/etapa-obra' : '/etapa'), 'POST', { etapa: etapa }, 200000).then(function (r) {
      if (r.status === 200 && r.json.ok !== false) {
        O.painel = null; O.aba = null;   // a página abre no passo que o concluir liberou
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
      // Prazo e valor travam a etapa 1 na api (itensDaEtapa): vermelho.
      var pv = !prazo.value.trim(); marcaFalta(prazo, pv ? 'ob' : ''); mostra(etPrazo, pv); mostra(trava, pv);
      var vv = !(cents(valor.value) > 0); marcaFalta(valor, vv ? 'ob' : ''); mostra(etValor, vv);
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

  // ── A página do cliente (19/11/2026): o Resumo e os passos em abas ───────────────────────────────────────────
  // No topo, a barra fixa: Resumo, 1 Documentos, 2 Contrato, 3 Assinaturas, 4 Vistoria, 5 Homologação e as etapas da obra.
  // Concluir um passo libera o próximo. Passo travado não abre. Passo feito reabre para editar. A página abre no passo da vez.
  // O Resumo junta o que já está ok: cliente, venda, andamento, documentos recebidos e o caixa. Cada dado aparece num lugar só.
  // A api tem as etapas 1 a 9: a etapa 1 são os passos 1 e 2, a etapa 2 os passos 3 e 4, a etapa 3 o passo 5. Os passos 1 e 3 fecham pela tela.

  /** O "?" com a explicação longa no title (e no leitor de tela). */
  function ajudaQ(txt) { var q = el('span', 'jor-q', '?'); q.title = txt; q.tabIndex = 0; q.setAttribute('role', 'img'); q.setAttribute('aria-label', 'Ajuda: ' + txt); return q; }
  /** Texto só para o leitor de tela. */
  function srTxt(t) { var s = el('span', '', t); s.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap'; return s; }
  function juntar(l) { return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]; }
  /** Primeira letra minúscula para entrar no meio da frase (sigla fica como está). */
  function minus(s) { s = String(s || ''); return /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1); }
  /** Os itens do servidor das etapas 1 a 3 por chave (o passo não depende de em qual etapa a api pôs o item). */
  function itensDe(d, chaves) {
    var out = []; (d.etapas || []).slice(0, 3).forEach(function (e) { (e.itens || []).forEach(function (i) { if (chaves.indexOf(i.chave) >= 0) out.push(i); }); });
    return out;
  }
  function todosFeitos(l) { return l.every(function (i) { return i.feito; }); }
  // ── O que falta (19/11/2026): vermelho quando a api exige (o item vem em itensDaEtapa), amarelo quando falta mas não trava ──
  /** A api manda este item em alguma etapa (1 a 9)? Se manda, ele trava o Concluir. */
  function exigido(chave) { return !!(O.dados && etapasMescladas().some(function (e) { return (e.itens || []).some(function (i) { return i.chave === chave; }); })); }
  /** Contorna o nó: 'ob' (obrigatório, vermelho), 'op' (opcional, amarelo) ou '' (pronto: tira o contorno). */
  function marcaFalta(no, nivel) {
    if (!no) return no;
    no.classList.remove('jor-fx-ob', 'jor-fx-op');
    if (nivel === 'ob' || nivel === 'op') no.classList.add('jor-fx-' + nivel);
    return no;
  }
  /** A etiqueta do que falta: vermelha no obrigatório, âmbar no opcional. */
  function etqFalta(txt, nivel) { return etq(txt, nivel === 'op' ? 'fp' : 'fo'); }
  function irPara(id) {
    var a = document.getElementById(id); if (!a) return;
    var reduz = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    a.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' });
    try { a.focus({ preventScroll: true }); } catch (e) { /* sem foco */ }
  }
  function quem(c) { var q = c && c.em ? quando(c.em) : ''; return (c && c.por ? ' por ' + nomeBonito(c.por) : '') + (q ? ' em ' + q : ''); }
  function ultimaMarca(d, chaves) { return chaves.map(function (k) { return conf(d, k); }).filter(Boolean).sort(function (a, b) { return String(b.em || '').localeCompare(String(a.em || '')); })[0] || null; }
  function etapaFeita(e, atual) { return !!(e && (e.concluida_em || atual > e.n)); }
  function dataCurta(iso) { return ddmm(String(iso || '').slice(0, 10)); }

  /** O tipo de financiamento: 'nao', 'proprio' ou 'financeira'. O legado 'sim' vale Próprio. Sem resposta, ''. */
  function tipoFin(d) { var f = d && d.financiamento; return f === 'sim' ? 'proprio' : (f === 'proprio' || f === 'financeira' || f === 'nao') ? f : ''; }
  // Os documentos que o banco ou a financeira podem pedir a mais: opcionais, nunca travam o passo. Depois, os que entram só se precisar (avalista, imóvel, titular da homologação).
  var FIN_DOCS = [
    { slot: 'documento_financiamento', rot: 'Documento do titular do financiamento', msg: 'CNH ou documento do titular do financiamento' },
    { slot: 'comprovante_endereco_financiamento', rot: 'Comprovante de endereço do titular do financiamento', msg: 'Comprovante de endereço do titular do financiamento' },
  ];
  // Opcionais do passo 1 que a IA lê: o orçamento, o contrato e a procuração (os dois últimos também no passo 3, o mesmo arquivo).
  var DOCS_LIDOS_OPC = [
    { slot: 'orcamento', rot: 'Orçamento ou proposta' },
    { slot: 'contrato_assinado', rot: 'Contrato assinado' },
    { slot: 'procuracao', rot: 'Procuração assinada' },
  ];
  var OUTROS_DOCS = [
    { slot: 'documento_titular_uc', rot: 'Documento do titular da conta de luz' },
    { slot: 'comprovante_endereco_comprador', rot: 'Comprovante de endereço do cliente' },
    { slot: 'documento_avalista', rot: 'Documento do avalista' },
    { slot: 'comprovante_endereco_avalista', rot: 'Comprovante de endereço do avalista' },
    { slot: 'documento_imovel', rot: 'Documento do imóvel' },
    { slot: 'documento_outra_pessoa', rot: 'Documento de outra pessoa' },
  ];
  /** O item tem arquivo: pelo resumo da api ou pela lista do quadro de documentos. */
  function temSlot(d, s) {
    if (d.slots && d.slots[s]) return true;
    var st = quadroDoCard();
    return !!(st && st.docs && Array.isArray(st.docs.arquivos) && st.docs.arquivos.some(function (a) { return a && a.slot === s; }));
  }
  function itemOk(d, chave) { var x = itensDe(d, [chave])[0]; return !!(x && x.feito); }

  /** O que falta no passo 1, em palavras. Vazio = o passo está pronto. */
  function faltaDoP1(d) {
    var out = [];
    if (!tipoFin(d)) out.push('responder se tem financiamento');
    if (d.excedente !== 'sim' && d.excedente !== 'nao') out.push('responder se tem excedente');
    PEDIDOS.forEach(function (p) { if (!docRecebido(d, p)) out.push(minus(p.rot)); });
    if (d.excedente === 'sim') {
      var ie = itensDe(d, ['excedente'])[0]; var cpf = d.excedente_cpf || {};
      if (!temSlot(d, 'conta_luz_beneficiaria')) out.push('conta do excedente');
      else if ((ie && !ie.feito) || (!ie && cpf.ok === false)) out.push('a conta do excedente no CPF do titular');
    }
    return out;
  }
  function faltaDoP3(d) {
    var out = [];
    if (!(temSlot(d, 'contrato_assinado') || itemOk(d, 'contrato_assinado'))) out.push('contrato assinado');
    if (!(temSlot(d, 'procuracao') || itemOk(d, 'procuracao'))) out.push('procuração assinada');
    return out;
  }

  /** Os passos e o estado de cada um: feito, livre (abre) e qual é o da vez. */
  function modelo(d) {
    var ets = etapasMescladas(); var atual = atualEtapa();
    var f1 = etapaFeita(ets[0], atual), f2 = etapaFeita(ets[1], atual), f3 = etapaFeita(ets[2], atual);
    var P = [
      { id: 'p1', num: 1, titulo: 'Documentos', curto: 'Documentos', etapa: 1, feito: f1 || !faltaDoP1(d).length, aviso: f1 && pendentesDe(d).length > 0, corpo: corpoP1 },
      { id: 'p2', num: 2, titulo: 'Contrato e procuração', curto: 'Contrato', etapa: 1, feito: f1, corpo: corpoP2, api: true },
      { id: 'p3', num: 3, titulo: 'Assinaturas', curto: 'Assinaturas', etapa: 2, feito: f2 || !faltaDoP3(d).length, corpo: corpoP3 },
      { id: 'p4', num: 4, titulo: 'Vistoria', curto: 'Vistoria', etapa: 2, feito: f2, corpo: corpoP4, api: true },
      { id: 'p5', num: 5, titulo: 'Homologação', curto: 'Homologação', etapa: 3, feito: f3, corpo: corpoP5, api: true },
    ];
    // A obra (19/11/2026): 6 Compra, 7 Logística, 8 Obra e 9 Comissionamento, a partir de `abas[]` do fase2. O pós-venda não é aba: aparece no fim da 9.
    // As 4 abas existem sempre, mesmo antes de a api mandar as etapas 4 a 8 (20/11/2026): sem dado, ficam travadas até o passo anterior concluir.
    var abasF2 = (O.fase2 && Array.isArray(O.fase2.abas)) ? O.fase2.abas : null;
    ABAS_OBRA.forEach(function (a) {
      var es = a.etapas.map(function (n) { return ets[n - 1]; }).filter(Boolean);
      var x = abasF2 ? abasF2.filter(function (y) { return y.numero === a.num; })[0] || null : null;
      var nE = a.etapas.length > 1 && atual >= a.etapas[1] ? a.etapas[1] : a.etapas[0];
      P.push({ id: a.id, num: a.num, titulo: a.titulo, curto: a.titulo, etapa: nE, etapas: a.etapas, obra: true, aba: x, api: true,
        feito: x ? !!x.concluida : es.length > 0 && es.every(function (e) { return etapaFeita(e, atual); }), aberta: x ? !!x.aberta : es.some(function (e) { return !!e.aberta_em; }),
        corpo: function (c) { corpoAbaObra(c, O.dados, a); } });
    });
    P.forEach(function (p, i) { p.livre = i === 0 || P[i - 1].feito || p.feito || !!p.aberta; });
    var vez = P.filter(function (p) { return p.livre && !p.feito; })[0] || P[P.length - 1];
    return { lista: P, atual: vez.id, ets: ets };
  }
  function passoPorId(m, id) { return m.lista.filter(function (p) { return p.id === id; })[0] || null; }
  /** O nome da etapa da api para o dinheiro e os avisos: diz quais passos ela junta. */
  function rotEtapa(n) {
    n = Number(n);
    if (n === 1) return 'Passos 1 e 2 · Documentos e contrato';
    if (n === 2) return 'Passos 3 e 4 · Assinaturas e vistoria';
    if (n === 3) return 'Passo 5 · Homologação';
    var ab = ABAS_OBRA.filter(function (a) { return a.etapas.indexOf(n) >= 0; })[0];
    if (ab) return 'Passo ' + ab.num + ' · ' + ab.titulo;
    if (n === 9) return 'Pós-venda';
    var e = O.dados && O.dados.etapas ? O.dados.etapas[n - 1] : null;
    return e ? e.nome : 'Etapa ' + n;
  }
  /** As abas da obra e as etapas da api que cada uma junta. A 9 (Comissionamento) é a entrega (7) e a liberação (8). */
  var ABAS_OBRA = [
    { id: 'e4', num: 6, titulo: 'Compra', etapas: [4], art: 'a', libera: 'quando as placas e o inversor estiverem comprados' },
    { id: 'e5', num: 7, titulo: 'Logística', etapas: [5], art: 'a', libera: 'quando a carga do kit estiver completa' },
    { id: 'e6', num: 8, titulo: 'Obra', etapas: [6], art: 'a', libera: 'com o checklist completo e 1 dia no diário com foto' },
    { id: 'e7', num: 9, titulo: 'Comissionamento', etapas: [7, 8], art: 'o', libera: '' },
  ];

  // ── Os nós do quadro de documentos (index.html) que esta página usa no lugar certo ───────────────────────────────
  // O quadro continua montado e escondido: é ele que fala com a api de documentos e cadastro. A página pega emprestados os pedaços
  // que só existiam nele (cadastro completo, ligações, rateio, Trello, lista para renomear) e devolve antes de cada redesenho.
  var NOS_EMPRESTADOS = ['topo', 'vinc', 'rat', 'tre', 'pes', 'acoes', 'msg', 'pn', 'lista', 'org'];
  function devolverNos() {
    var st = quadroDoCard(); if (!st || !st.no || !st.no.sec) return;
    NOS_EMPRESTADOS.forEach(function (k) { var n = st.no[k]; if (n && n.parentNode !== st.no.sec) st.no.sec.appendChild(n); });
  }
  function emprestar(pai, chaves) {
    var box = el('div', 'jor-vdcx');
    function encher() { var s = quadroDoCard(); if (!s || !s.no) return false; box.replaceChildren(); chaves.forEach(function (k) { if (s.no[k]) box.appendChild(s.no[k]); }); return true; }
    if (!encher()) { box.appendChild(el('p', 'jor-nota', 'Carregando…')); quadroPronto(box).then(function () { if (box.isConnected) encher(); }); }
    pai.appendChild(box); return box;
  }

  // ── A página ───────────────────────────────────────────────────────────────────────────────────────────────
  function desenharObra() {
    var d = O.dados; var n = O.obraNo; if (!d || !n) return;
    devolverNos();
    var m = modelo(d);
    var aba = O.aba;
    if (aba !== 'resumo') { var pa = passoPorId(m, aba); if (!pa || !pa.livre) aba = m.atual; }
    O.abaVista = aba;
    var raiz = el('div', 'jor-pagina');
    raiz.appendChild(cabecalho(d));
    if (d.cancelada) {
      var fx = el('div', 'jor-faixa', 'Venda cancelada em ' + ddmm(d.cancelada.em) + ' por ' + nomeBonito(d.cancelada.por) + '. Motivo: ' + (d.cancelada.motivo || ''));
      if (d.pode.descancelar) fx.appendChild(btn('Desfazer o cancelamento', '', function () { desfazerDialogo(); }));
      raiz.appendChild(fx);
    }
    if (d.aviso) raiz.appendChild(el('p', 'jor-aviso', d.aviso));
    raiz.appendChild(barraAbas(m, aba));
    var painel = el('section', 'jor-painel jor-cartao'); painel.id = 'jor-aba-corpo'; painel.tabIndex = -1;
    painel.setAttribute('role', 'tabpanel'); painel.setAttribute('aria-labelledby', 'jor-ab-' + aba);
    if (aba === 'resumo') abaResumo(painel, d, m); else abaPasso(painel, d, m, passoPorId(m, aba));
    raiz.appendChild(painel);
    // O quadro de documentos fica montado e escondido no fim (os anexos, a leitura e o Trello dependem dele).
    if (O.vdcDet) { O.vdcDet.hidden = true; raiz.appendChild(O.vdcDet); }
    n.replaceChildren(raiz);
    motivosVisiveis(painel);
    var sel = raiz.querySelector('.jor-ab.sel'); var trilho = sel && sel.parentNode;
    // Só rola a barra quando a aba escolhida ficou fora da vista (o Resumo continua à mostra sempre que couber).
    if (trilho && trilho.scrollWidth > trilho.clientWidth && sel.offsetLeft + sel.offsetWidth > trilho.clientWidth) trilho.scrollLeft = sel.offsetLeft + sel.offsetWidth - trilho.clientWidth + 8;
  }
  /**
   * Botão desligado na tela desenhada ganha o motivo escrito (antes só aparecia no `title`, ao passar o mouse, e no toque nunca).
   * Os pequenos "Editar" e "Preencher" do Resumo e os chips viram uma frase só por grupo; botão de ação ganha a frase logo depois dele.
   * O passo que está ocupado (Gerando, Salvando) desliga depois do desenho e não passa por aqui.
   */
  function motivosVisiveis(painel) {
    if (!painel) return;
    var n = 0; var topo = ''; var paisChips = [];
    Array.prototype.slice.call(painel.querySelectorAll('button:disabled')).forEach(function (b) {
      if (b.getAttribute('aria-describedby') || b.classList.contains('jor-ob-pill')) return;
      var t = b.title || '';
      if (b.classList.contains('jor-fc-ed')) { if (t && !topo) topo = t; return; }
      if (b.classList.contains('jor-chip')) {
        var pai = b.parentNode; if (t && pai && paisChips.indexOf(pai) < 0) { paisChips.push(pai); var sc = el('p', 'jor-motivo', t); pai.insertAdjacentElement('afterend', sc); }
        return;
      }
      // Só o motivo dado pelo próprio botão (`title`): botão cinza por falta de dado já tem a frase "Falta…" ao lado, e um texto genérico mentiria.
      if (!t) return;
      var s = el('span', 'jor-motivo', t); s.id = 'jor-mot-' + (++n); b.insertAdjacentElement('afterend', s); b.setAttribute('aria-describedby', s.id);
    });
    if (topo) { var p0 = el('p', 'jor-nota jor-motivo-topo', topo.replace(/confirmar\.$/, 'editar estes dados.')); painel.insertBefore(p0, painel.firstChild); }
  }
  /** Troca de aba: desenha, devolve o foco à aba e sobe a página até a barra quando ela já passou do topo. */
  function irAba(id, foco) {
    O.aba = id; desenharObra();
    var b = document.getElementById('jor-ab-' + id);
    // O foco volta à aba (leitor de tela e setas), sem abrir a dica: ela é para o mouse e para quem navega pelo teclado.
    if (b && foco !== false) { O.focoAba = true; try { b.focus({ preventScroll: true }); } catch (e) { /* sem foco */ } O.focoAba = false; }
    var barra = document.querySelector('#jor-obra .jor-abas-p');
    if (barra) {
      var topo = barra.getBoundingClientRect().top + window.scrollY - 8;
      if (window.scrollY > topo) {
        var reduz = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        window.scrollTo({ top: topo, behavior: reduz ? 'auto' : 'smooth' });
      }
    }
  }
  /** Vai ao Resumo e rola até um bloco dele. */
  function irResumo(alvo) { irAba('resumo', false); if (alvo) setTimeout(function () { irPara(alvo); }, 0); }

  function cabecalho(d) {
    var topo = el('header', 'jor-obra-cab');
    topo.appendChild(el('span', 'jor-num jor-res-cod', d.codigo || '*'));
    var t = el('div', 'jor-cab-t'); var h = el('h2', '', d.card.cliente || 'Cliente sem nome'); h.id = 'jor-res-tit'; t.appendChild(h);
    var kwpTxt = d.proposta && d.proposta.kwp ? String(d.proposta.kwp).replace('.', ',') + ' kWp' : '';
    t.appendChild(el('span', '', [kwpTxt, cidadeUF(d.card.cidade)].filter(Boolean).join(' · ')));
    topo.appendChild(t);
    var cac = el('div', 'jor-cab-ac');
    var xt = window.Jornada.extras; var avBook = null;
    // Liberado: a api diz `fase3.pode.book` (ela manda false quando há trava). Travado: quem pode gerar o Book (`fase2.pode.book_gerar`) vê o botão
    // desligado com o motivo, a partir do Comissionamento (etapa 7 aberta, a mesma janela em que a fase 3 pede o Book). A trava é a da Conclusão geral.
    var bLivre = !!(O.fase3 && O.fase3.pode && O.fase3.pode.book);
    var tvB = (!bLivre && xt.travaDoBook && O.fase2 && O.fase2.pode && O.fase2.pode.book_gerar && atualEtapa() >= 7) ? xt.travaDoBook(O.fase2) : [];
    if (xt.bookPdf && (bLivre || tvB.length)) {
      var bdoc = btn('Book da obra', '', function () { xt.bookPdf(O.card, bdoc); }); cac.appendChild(bdoc);
      if (tvB.length) {
        bdoc.disabled = true; bdoc.setAttribute('aria-describedby', 'jor-cab-book-av');
        avBook = el('p', 'jor-cab-av', xt.fraseBookTravado ? xt.fraseBookTravado(tvB.length) : 'O Book está travado por pendências.'); avBook.id = 'jor-cab-book-av';
      }
    }
    add(cac, btn('Clientes', '', abrirLista));
    if (d.pode.cancelar) add(cac, btn('Venda cancelada', 'jor-btn-disc', function () { cancelarDialogo(O.card, carregarObra); }));
    topo.appendChild(cac);
    if (avBook) topo.appendChild(avBook);
    return topo;
  }

  var BLOCOS_PASSO = { p2: ['cliente', 'venda', 'papeis'], p4: ['vistoria'] };
  /** O item da etapa 1 a 3 é deste passo? (a mesma conta do ponto da aba e da dica) */
  function itemDoPasso(p, i) { return i.bloco !== 'pendentes' && (!BLOCOS_PASSO[p.id] || BLOCOS_PASSO[p.id].indexOf(i.bloco) >= 0); }
  /**
   * A pendência do passo, para o ponto no número: 'ob' (falta o que a api exige), 'op' (só falta o que não trava) ou ''.
   * Só marca passo liberado: travado não abre e feito sem pendência fica limpo.
   */
  function pendencia(d, p, m) {
    if (!d || !p || p.resumo || !p.livre) return '';
    // Abas da obra: o `falta` (vermelho) e o `falta_opcional` (amarelo) que a api manda. Depois de concluída, a 9 fica com o pós-venda.
    if (p.obra) {
      if (p.feito) return p.num === 9 && window.Jornada.extras.pendenciaPos ? window.Jornada.extras.pendenciaPos(O.fase2) : '';
      var x = p.aba;
      if (x) return x.falta > 0 ? 'ob' : x.falta_opcional > 0 ? 'op' : '';
      var its = []; (p.etapas || []).forEach(function (n) { var e0 = m.ets[n - 1]; (e0 && e0.itens || []).forEach(function (i) { if (!i.feito) its.push(i); }); });
      return its.some(function (i) { return i.nivel !== 'opcional'; }) ? 'ob' : its.length ? 'op' : '';
    }
    if (p.aviso) return 'ob';
    if (p.feito) return '';
    if (p.id === 'p1') return faltaDoP1(d).length ? 'ob' : '';
    if (p.id === 'p3') return faltaDoP3(d).length ? 'ob' : '';
    var e = m.ets[p.etapa - 1]; if (!e) return '';
    if (e.n === 9) return window.Jornada.extras.pendenciaPos ? window.Jornada.extras.pendenciaPos(O.fase2) : '';
    // Etapas 1 a 3 da api: conta só os itens deste passo. O bloco 'pendentes' é herança do passo 1; na etapa 1 os documentos e o
    // excedente são do passo 1 (o p2 fica com cliente, venda e papéis); na etapa 2 o contrato e a procuração são do passo 3 (o p4 só
    // responde pela vistoria).
    var n = e.n <= 3 && e.itens
      ? e.itens.filter(function (i) { return !i.feito && itemDoPasso(p, i); }).length
      : typeof e.falta === 'number' ? e.falta : (e.itens || []).filter(function (i) { return !i.feito; }).length;
    if (n > 0) return 'ob';
    if (p.id === 'p5' && !temSlot(d, 'projeto_comprovante')) return 'op';
    return '';
  }

  // ── A dica da aba (19/11/2026): o que falta no passo, com as mesmas contas do ponto e do "Para concluir, falta:" ──
  /** O que libera cada passo 1 a 5, para a dica da aba seguinte quando ela está travada. */
  var FIM_PASSO = { p1: 'os Documentos estiverem completos', p2: 'o Contrato estiver concluído', p3: 'as Assinaturas estiverem completas', p4: 'a Vistoria for concluída', p5: 'a Homologação for concluída' };
  /** Quando uma aba travada abre: o que o passo anterior precisa ter feito (nas abas da obra, o `libera` da aba anterior). Sem o ponto final. */
  function textoAbre(lista, i) {
    var antes = lista[i - 1]; var abA = antes && antes.obra ? ABAS_OBRA.filter(function (a) { return a.num === antes.num; })[0] : null;
    return abA && abA.libera ? 'Abre ' + abA.libera : 'Abre quando ' + (antes && FIM_PASSO[antes.id] || 'o passo anterior concluir');
  }
  /** O que falta no passo, em duas listas: ob (a api exige, vermelho) e op (não trava, âmbar). */
  function faltasDoPasso(d, p, m) {
    var ob = [], op = [];
    function pe(l, t) { t = String(t || ''); t = t.charAt(0).toUpperCase() + t.slice(1); if (t && l.indexOf(t) < 0) l.push(t); }
    if (p.feito) {
      if (p.aviso) pendentesDe(d).forEach(function (i) { var q = PEDIDOS.filter(function (x) { return x.item === i.chave; })[0]; pe(ob, q ? q.rot : i.texto); });
      else if (p.obra && p.num === 9 && pendencia(d, p, m) === 'op') pe(op, 'Pedido do pós-venda esperando o cliente');
      return { ob: ob, op: op };
    }
    if (p.obra) {
      // Como a api conta o `falta` e o `falta_opcional` da aba: só as etapas ainda não concluídas.
      (p.etapas || []).forEach(function (n) {
        var e0 = m.ets[n - 1]; if (!e0 || e0.concluida_em) return;
        (e0.itens || []).forEach(function (i) { if (!i.feito) pe(i.nivel === 'opcional' ? op : ob, i.texto); });
      });
    } else if (p.id === 'p1') faltaDoP1(d).forEach(function (t) { pe(ob, t); });
    else if (p.id === 'p3') faltaDoP3(d).forEach(function (t) { pe(ob, t); });
    else {
      var e = m.ets[p.etapa - 1];
      if (e && e.n <= 3) faltaDaEtapa(e, function (i) { return itemDoPasso(p, i); }).forEach(function (t) { pe(ob, t); });
      if (p.id === 'p5' && !temSlot(d, 'projeto_comprovante')) pe(op, 'Comprovante do engenheiro');
    }
    return { ob: ob, op: op };
  }
  /** A dica de uma aba de passo. `abre` (só travada) diz o que libera. Fica escondida; ligarDica mostra. */
  function dicaDoPasso(d, p, m, est, compacta, abre) {
    var no = el('div', 'jor-dica'); no.id = 'jor-dica-' + p.id; no.setAttribute('role', 'tooltip');
    if (compacta) no.appendChild(el('p', 'jor-dica-n', p.num + ' ' + p.titulo));
    if (est === 'travado') { no.appendChild(el('p', 'jor-dica-t', abre)); return no; }
    var f = faltasDoPasso(d, p, m); var tot = f.ob.length + f.op.length;
    if (est === 'feito') {
      var ns = p.obra ? p.etapas : [p.etapa]; var dt = '';
      ns.slice().reverse().forEach(function (n) { var e0 = m.ets[n - 1]; if (!dt && e0 && e0.concluida_em) dt = dataCurta(e0.concluida_em); });
      no.appendChild(el('p', 'jor-dica-t ok', 'Concluído' + (dt ? ' em ' + dt : '')));
    } else if (!tot) no.appendChild(el('p', 'jor-dica-t', 'Tudo pronto neste passo.'));
    var resta = 6;
    [['ob', 'Falta'], ['op', 'Opcional']].forEach(function (g) {
      var l = f[g[0]].slice(0, resta); if (!l.length) return;
      resta -= l.length;
      no.appendChild(el('p', 'jor-dica-h ' + g[0], g[1]));
      var ul = el('ul', g[0]); l.forEach(function (t) { ul.appendChild(el('li', '', t)); }); no.appendChild(ul);
    });
    if (tot > 6) no.appendChild(el('p', 'jor-dica-mais', 'e mais ' + (tot - 6)));
    return no;
  }
  /** Liga a dica à aba: mouse (não o toque, que abre a aba) e foco de teclado. Esc fecha. A dica aceita o mouse em cima, sem sumir. */
  function ligarDica(b, dica, cx) {
    var S = cx._dica || (cx._dica = { t: 0, ativa: null });
    function fechar() { clearTimeout(S.t); if (S.ativa) S.ativa.classList.remove('on'); S.ativa = null; }
    function mostrar() {
      if (O.dicaCalada === b.id) return;   // a aba acabou de ser clicada: a dica volta quando o mouse sair e entrar de novo
      clearTimeout(S.t); if (S.ativa && S.ativa !== dica) S.ativa.classList.remove('on');
      S.ativa = dica;
      var r = b.getBoundingClientRect(); var w = dica.offsetWidth; var vw = document.documentElement.clientWidth;
      var x = Math.max(8, Math.min(r.left, vw - w - 8));
      dica.style.left = Math.round(x) + 'px'; dica.style.top = Math.round(r.bottom + 8) + 'px';
      dica.style.setProperty('--seta', Math.round(Math.max(10, Math.min(r.left + r.width / 2 - x - 5, w - 22))) + 'px');
      dica.classList.add('on');
      window.addEventListener('scroll', fechar, { passive: true, once: true, capture: true });
    }
    function esconder() { clearTimeout(S.t); S.t = setTimeout(function () { dica.classList.remove('on'); if (S.ativa === dica) S.ativa = null; }, 120); }
    b.setAttribute('aria-describedby', dica.id);
    b.addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') mostrar(); });
    b.addEventListener('pointerleave', function (ev) { if (O.dicaCalada === b.id) O.dicaCalada = null; if (ev.pointerType === 'mouse') esconder(); });
    dica.addEventListener('pointerenter', function () { clearTimeout(S.t); });
    dica.addEventListener('pointerleave', esconder);
    b.addEventListener('focus', function () { if (O.focoAba) return; var fv = true; try { fv = b.matches(':focus-visible'); } catch (e) { /* navegador sem :focus-visible */ } if (fv) mostrar(); });
    b.addEventListener('blur', function () { fechar(); if (O.dicaCalada === b.id && b.isConnected) O.dicaCalada = null; });   // clique por teclado: sai do foco, a dica volta
    b.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') fechar(); });
  }

  // ── A barra de abas ──────────────────────────────────────────────────────────────────────────────────────────
  function barraAbas(m, aba) {
    var cx = el('nav', 'jor-abas-p'); cx.setAttribute('aria-label', 'Passos da obra');
    var trilho = el('div', 'jor-abas-tr'); trilho.setAttribute('role', 'tablist');
    // Resumo, 1 a 5 e 6 a 9 (a obra). As 4 abas da obra aparecem sempre, com o nome; antes da hora ficam travadas. Depois que a obra abre, os passos 1 a 5 encolhem para o número.
    var obraLivre = obraAberta(m);
    var itens = [{ id: 'resumo', curto: 'Resumo', livre: true, resumo: true }].concat(m.lista);
    var anteriorNum = 0;
    itens.forEach(function (p, i) {
      if (p.obra && !anteriorNum) { var sp = el('span', 'jor-ab-sep'); sp.setAttribute('aria-hidden', 'true'); trilho.appendChild(sp); anteriorNum = 1; }
      var est = p.resumo ? '' : p.feito ? 'feito' : p.id === m.atual ? 'atual' : p.livre ? 'aberto' : 'travado';
      var compacta = p.num && !p.obra && obraLivre;
      var b = el('button', 'jor-ab' + (est ? ' ' + est : '') + (p.id === aba ? ' sel' : '') + (p.resumo ? ' res' : '') + (p.num ? ' num' : '') + (p.obra ? ' ob' : '') + (compacta ? ' compacta' : '') + (p.aviso ? ' av' : ''));
      b.type = 'button'; b.id = 'jor-ab-' + p.id; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', p.id === aba ? 'true' : 'false'); b.tabIndex = p.id === aba ? 0 : -1;
      if (p.id === aba) b.setAttribute('aria-controls', 'jor-aba-corpo');
      if (!p.resumo) {
        var mk = el('span', 'jor-ab-mk'); mk.setAttribute('aria-hidden', 'true');
        // Travado com número mostra o número (tracejado); sem número, o cadeado.
        if (est === 'feito') mk.appendChild(icone('ok')); else if (p.num) mk.textContent = String(p.num); else if (est === 'travado') mk.appendChild(icone('cadeado')); else mk.appendChild(el('i'));
        var pd = pendencia(O.dados, p, m); if (pd) mk.appendChild(el('b', 'jor-ab-pd ' + pd));
        b.appendChild(mk);
      }
      b.appendChild(el('span', 'jor-ab-t', p.curto));
      if (!p.resumo) b.appendChild(srTxt(', ' + ({ feito: p.aviso ? 'feito, com pendência' : 'feito', atual: 'passo da vez', aberto: 'em aberto', travado: 'travado' })[est] + ({ ob: ', falta item obrigatório', op: ', falta item opcional' }[pendencia(O.dados, p, m)] || '')));
      var abre = '';
      if (est === 'travado') { b.setAttribute('aria-disabled', 'true'); abre = textoAbre(itens, i); }
      // A dica (o que falta, o que libera ou quando concluiu) no lugar do title: o nativo é lento e some em foco de teclado.
      if (!p.resumo) { var dica = dicaDoPasso(O.dados, p, m, est, compacta, abre); cx.appendChild(dica); ligarDica(b, dica, cx); }
      b.addEventListener('click', function () {
        if (est === 'travado') { toast(p.titulo + ': ' + minus(abre) + '.'); return; }
        O.dicaCalada = b.id; irAba(p.id);
      });
      b.addEventListener('keydown', function (ev) {
        var k = ev.key; if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(k) < 0) return;
        ev.preventDefault();
        var abas = Array.prototype.slice.call(trilho.querySelectorAll('.jor-ab:not(.travado)'));
        var j = abas.indexOf(b);
        var alvo = k === 'Home' ? abas[0] : k === 'End' ? abas[abas.length - 1] : abas[(j + (k === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length];
        if (alvo) alvo.click();
      });
      trilho.appendChild(b);
    });
    cx.appendChild(trilho);
    // Barra que rola: esmaece a borda direita enquanto ainda há abas fora da vista, para ninguém achar que a última é a que cortou.
    function fimDaBarra() { trilho.classList.toggle('rola', trilho.scrollWidth - trilho.clientWidth - trilho.scrollLeft > 4); }
    trilho.addEventListener('scroll', fimDaBarra, { passive: true });
    setTimeout(fimDaBarra, 0);
    return cx;
  }

  /** A obra (abas 6 a 9) abre depois do passo 5. Fechada, as 4 abas aparecem travadas, cada uma com o que a abre. */
  function obraAberta(m) { return m.lista.some(function (p) { return p.obra && p.livre; }); }

  // ── Um passo ─────────────────────────────────────────────────────────────────────────────────────────────────
  function abaPasso(c, d, m, p) {
    var e = m.ets[p.etapa - 1];
    var cab = el('div', 'jor-passo-cab');
    var tt = el('div', 'jor-passo-tt');
    tt.appendChild(el('span', 'jor-passo-de', p.num ? 'Passo ' + p.num + ' de 9' : 'Obra'));
    var h = el('h3', '', p.titulo); tt.appendChild(h);
    cab.appendChild(tt);
    var ld = el('div', 'jor-passo-ld');
    if (p.aviso) ld.appendChild(etq('Feito, com pendência', 'av'));
    else if (p.feito) ld.appendChild(etq(p.api && e && e.concluida_em ? 'Concluído' + (dataCurta(e.concluida_em) ? ' em ' + dataCurta(e.concluida_em) : '') : 'Feito', 'ok'));
    else if (p.id === m.atual) ld.appendChild(etq('Agora', 'vez'));
    else ld.appendChild(etq('Em aberto', 'av'));
    ((e && e.dono) || []).forEach(function (x) { var a = el('span', 'jor-avatar', x.iniciais); a.title = 'Responsável: ' + nomeBonito(x.nome); a.setAttribute('role', 'img'); a.setAttribute('aria-label', 'Responsável: ' + nomeBonito(x.nome)); ld.appendChild(a); });
    cab.appendChild(ld);
    c.appendChild(cab);
    if (p.obra) { var fl = faixaLibera(p, m); if (fl) c.appendChild(fl); }
    if (p.obra && p.num === 9) { var fe = forcarEntrega(p); if (fe) c.appendChild(fe); }
    if (p.id === m.atual && e && !etapaFeita(e, atualEtapa())) { var pz = faixaPrazo(d, e); if (pz) c.appendChild(pz); }
    var corpoP = el('div', 'jor-passo-corpo'); corpoP.id = 'jor-s-' + p.id;
    p.corpo(corpoP, p);
    c.appendChild(corpoP);
    var pe = rodapePasso(d, p, m); if (pe) c.appendChild(pe);
  }
  /**
   * As abas 6, 7 e 8 não têm Concluir: abrem a seguinte sozinhas. Uma linha diz o que libera a próxima e o que falta
   * (vermelho o que trava, amarelo o que não trava). Feita, diz quando liberou e leva à próxima.
   */
  function faixaLibera(p, m) {
    var ab = ABAS_OBRA.filter(function (a) { return a.num === p.num; })[0]; if (!ab || !ab.libera) return null;
    var prox = m.lista[m.lista.indexOf(p) + 1] || null; if (!prox) return null;
    var nomeProx = (prox.num === 9 ? 'o ' : 'a ') + prox.num + ' ' + prox.titulo;
    var f = el('div', 'jor-libera' + (p.feito ? ' ok' : '')); f.setAttribute('role', 'status');
    var ic = el('span', 'jor-libera-ic'); ic.appendChild(icone(p.feito ? 'ok' : 'cadeado')); f.appendChild(ic);
    var tx = el('div', 'jor-libera-tx');
    var e0 = m.ets[ab.etapas[ab.etapas.length - 1] - 1];
    tx.appendChild(el('p', 'jor-libera-f', p.feito ? 'Liberou ' + nomeProx + (e0 && e0.concluida_em ? ' em ' + dataCurta(e0.concluida_em) : '') + '.' : 'Libera ' + nomeProx + ' ' + ab.libera + '.'));
    // Obra antiga presa num portão: o ADM abre a próxima mesmo assim, com motivo opcional (19/11/2026).
    if (!p.feito && O.fase2 && O.fase2.pode && O.fase2.pode.forcar) {
      var fz = btn('Abrir a próxima etapa mesmo assim (ADM)', 'jor-btn-link jor-libera-forcar', function () { forcarDialogo(ab.etapas[0], nomeProx); });
      tx.appendChild(fz);
    }
    f.appendChild(tx);
    if (p.feito && prox.livre) f.appendChild(btn('Ir para ' + prox.num + ' ' + prox.titulo, 'jor-btn', function () { irAba(prox.id); }));
    return f;
  }
  /**
   * O Comissionamento junta a Entrega (7) e a Liberação (8) e não tem faixa de "libera". Obra antiga presa na Entrega (ex.: sem a senha no cofre):
   * o ADM abre a Liberação mesmo assim, igual às abas 6 a 8. A etapa 8 não se força: só conclui pelo botão final.
   */
  function forcarEntrega(p) {
    if (p.feito || atualEtapa() !== 7 || !(O.fase2 && O.fase2.pode && O.fase2.pode.forcar)) return null;
    var cx = el('p', 'jor-nota');
    cx.appendChild(btn('Abrir a liberação mesmo assim (ADM)', 'jor-btn-link jor-libera-forcar', function () { forcarDialogo(7, 'a liberação'); }));
    return cx;
  }
  /** Forçar a abertura: o motivo é opcional e a confirmação mora no próprio diálogo (o botão diz o que acontece). */
  function forcarDialogo(etapa, nomeProx) {
    var ta = null; var info = null;
    dialogo('Abrir ' + nomeProx + ' mesmo assim', function (box) {
      box.appendChild(el('p', 'jor-nota', 'O que falta nesta etapa continua aparecendo, mas não segura mais a próxima. Fica registrado quem abriu e quando.'));
      ta = el('textarea', 'jor-ta'); ta.maxLength = 300; ta.setAttribute('aria-label', 'Motivo (opcional)'); ta.placeholder = 'Ex.: obra antiga, a carga já foi entregue…';
      var lb = el('label', 'jor-libera-mot', 'Motivo (opcional)'); lb.appendChild(ta); box.appendChild(lb);
      info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); box.appendChild(info);
      return { foco: ta };
    }, 'Sim, abrir ' + nomeProx, function (b) {
      b.disabled = true; info.textContent = '';
      api('/gerador/jornada-solar/obra/' + encodeURIComponent(O.card) + '/etapa-obra', 'POST', { etapa: etapa, forcar: true, motivo: ta.value.trim() }, 60000).then(function (r) {
        if (r.status === 200 && r.json && r.json.ok !== false) { fecharDlg(); toast('Etapa aberta.'); carregarObra(); return; }
        b.disabled = false; info.textContent = msgDe(r, 'Não consegui abrir agora. Tente de novo.');
      });
    });
  }
  /** Prazo e cobrança da etapa da vez: uma faixa fina no topo do passo, com o Esperando. */
  function faixaPrazo(d, e) {
    var f2 = O.fase2; var pz = el('div', 'jor-prazo');
    var sit = e.situacao || { tipo: 'sem_prazo', texto: '' };
    var dv = e.prazo && e.prazo.vence ? ddmm(e.prazo.vence) : '';
    var rotP = e.prazo && e.prazo.rotulo && e.prazo.rotulo !== 'Prazo' ? e.prazo.rotulo : '';
    // A data aparece uma vez só: quando a situação já diz "vence dd/mm", fica só ela (e o nome do prazo, se for outro).
    if (dv) { if (!(sit.texto && sit.texto.indexOf(dv) >= 0)) pz.appendChild(el('span', 'jor-prazo-d', (rotP || 'Prazo') + ' ' + dv)); else if (rotP) pz.appendChild(el('span', 'jor-prazo-d', rotP)); }
    if (sit.texto) pz.appendChild(el('span', sit.tipo === 'atrasada' || sit.tipo === 'travada' ? 'jor-erro' : sit.tipo === 'no_prazo' || sit.tipo === 'vence_hoje' ? 'jor-ok' : '', sit.texto));
    var esp = e.n <= 3 ? d.esperando : (f2 ? f2.esperando : null);
    var podeEsp = e.n <= 3 ? d.pode.esperar : !!(f2 && f2.pode && f2.pode.esperar);
    var ac = el('span', 'jor-prazo-ac');
    if (esp && esp.etapa === e.n) {
      pz.appendChild(el('span', '', 'Esperando até ' + ddmm(esp.ate) + ' · ' + nomeBonito(esp.motivo)));
      if (podeEsp) ac.appendChild(btn('Voltar a cobrar', 'jor-btn-link', function () { esperar({ voltar: true }, e.n); }));
    } else if (podeEsp && e.n <= 8 && !e.concluida_em) {
      var be = btn('Esperando', 'jor-btn-link', function () { esperarDialogo(e.n); }); be.title = 'Pausa a cobrança até uma data, com o motivo.'; ac.appendChild(be);
    }
    if (ac.firstChild) pz.appendChild(ac);
    if (window.Jornada.extras.avisos) { var av = el('div', 'jor-prazo-av'); window.Jornada.extras.avisos(av, O.fase3, e.n); if (av.firstChild) pz.appendChild(av); }
    return pz.firstChild ? pz : null;
  }

  /** O nome do que falta, pelo passo onde se resolve (nunca a lista crua de chaves). */
  var FALTA_ROT = {
    nome: 'confirmar os dados do cliente', telefone: 'confirmar os dados do cliente', endereco: 'confirmar os dados do cliente', endereco_usina: 'confirmar os dados do cliente', email: 'confirmar os dados do cliente',
    placas: 'confirmar a venda', inversor: 'confirmar a venda', valor: 'confirmar a venda', pagamento: 'confirmar a venda', prazo: 'o prazo prometido (no Resumo)', proposta: 'ligar a proposta aceita',
    financiamento: 'responder se tem financiamento (passo 1)', proposta_banco: 'a proposta de banco', papel_contrato: 'gerar o contrato', papel_procuracao: 'gerar a procuração',
    documento: 'documentos do passo 1', conta_luz: 'documentos do passo 1', fachada: 'documentos do passo 1', padrao: 'documentos do passo 1', disjuntor: 'documentos do passo 1', medidor: 'documentos do passo 1',
    documento_financiamento: 'documentos do passo 1', comprovante_endereco_financiamento: 'documentos do passo 1', excedente: 'excedente do passo 1', conta_excedente: 'excedente do passo 1',
    contrato_assinado: 'assinaturas do passo 3', procuracao: 'assinaturas do passo 3', vistoria: 'vistoria com 80% preenchido',
  };
  function faltaDaEtapa(e, ok) {
    var out = []; var pend = [];
    (e.itens || []).forEach(function (i) {
      if (i.feito || (ok && !ok(i))) return;
      if (i.bloco === 'pendentes') { var q = PEDIDOS.filter(function (p) { return p.item === i.chave; })[0]; pend.push(minus(q ? q.rot : i.texto)); return; }
      var t = e.n <= 3 && FALTA_ROT[i.chave] ? FALTA_ROT[i.chave] : minus(i.texto);
      if (out.indexOf(t) < 0) out.push(t);
    });
    if (pend.length) out.push('o pendente do passo 1 (' + juntar(pend) + ')');
    return out;
  }
  /** "Para concluir, falta:" e uma etiqueta vermelha por item (o que a api exige). */
  function fraseFalta(txt, itens) {
    var f = el('div', 'jor-portao-frase'); f.appendChild(el('span', '', txt));
    var ul = el('ul', 'jor-pe-falta'); itens.forEach(function (t) { ul.appendChild(el('li', '', t.charAt(0).toUpperCase() + t.slice(1))); });
    f.appendChild(ul); return f;
  }
  /** Quem pode concluir a etapa: `conclui_por` (nomes, que a api manda) ou, sem ele, os donos da etapa. */
  function quemConclui(e) {
    var l = Array.isArray(e.conclui_por) && e.conclui_por.length ? e.conclui_por : (e.dono || []);
    var out = [];
    l.forEach(function (x) { var n = nomeBonito(x && typeof x === 'object' ? x.nome : x); if (n && out.indexOf(n) < 0) out.push(n); });
    return out;
  }
  /** O pé do passo: o que falta, em etiquetas, e o Concluir que libera o próximo. */
  function rodapePasso(d, p, m) {
    var i = m.lista.indexOf(p); var prox = m.lista[i + 1] || null;
    var e = m.ets[p.etapa - 1]; var atual = atualEtapa();
    var cx = el('div', 'jor-pe'); var barra = el('div', 'jor-portao-barra'); cx.appendChild(barra);
    var irProx = prox ? (prox.num ? 'o passo ' + prox.num : prox.titulo) : '';
    if (O.msg) { var mm = el('p', 'jor-erro', O.msg); mm.setAttribute('role', 'status'); cx.insertBefore(mm, barra); }
    // A obra não tem Concluir: as abas 6 a 8 abrem a seguinte sozinhas e a 9 tem o botão final dentro dela.
    if (p.obra) return null;
    if (!p.api) {
      // Passos 1 e 3: fecham pelos itens, aqui na tela.
      var falta = p.id === 'p1' ? faltaDoP1(d) : faltaDoP3(d);
      var ja = etapaFeita(e, atual);
      barra.appendChild(falta.length && !ja ? fraseFalta('Para seguir, falta:', falta) : el('p', 'jor-portao-frase', ja ? 'Passo concluído.' : 'Tudo pronto neste passo.'));
      if (prox) {
        var b1 = btn(prox.feito || ja ? 'Ir para ' + irProx : 'Concluir e ir para ' + irProx, prox.feito || ja ? 'jor-btn-grande' : 'jor-btn-pri jor-btn-grande', function () { irAba(prox.id); });
        b1.disabled = !!falta.length && !ja; barra.appendChild(b1);
      }
      return cx;
    }
    if (etapaFeita(e, atual)) {
      barra.appendChild(el('p', 'jor-portao-frase', (p.obra ? 'Etapa concluída' : 'Passo concluído') + (e.concluida_em && dataCurta(e.concluida_em) ? ' em ' + dataCurta(e.concluida_em) : '') + '.'));
      if (prox && prox.livre) barra.appendChild(btn('Ir para ' + irProx, 'jor-btn-grande', function () { irAba(prox.id); }));
      return cx;
    }
    var faltaE = faltaDaEtapa(e);
    var f2 = O.fase2;
    var podeLista = e.n <= 3 ? (d.pode.concluir || []) : ((f2 && f2.pode && f2.pode.concluir) || []);
    var pode = podeLista.indexOf(e.n) >= 0 && e.falta === 0;
    // Botão cinza sempre com o motivo escrito ao lado: o que falta, ou (tudo pronto, sem permissão) quem conclui este passo.
    var frase = null;
    if (e.falta > 0) frase = fraseFalta('Para concluir, falta:', faltaE.length ? faltaE : [plural(e.falta, 'item', 'itens')]);
    else if (pode) frase = el('p', 'jor-portao-frase', 'Tudo pronto para concluir.');
    else { var qc = quemConclui(e); frase = el('p', 'jor-portao-frase', qc.length ? 'Tudo pronto. Quem conclui este passo: ' + juntar(qc) + '.' : 'Tudo pronto. Você não tem permissão para concluir este passo.'); }
    frase.id = 'jor-pe-motivo'; barra.appendChild(frase);
    var rot = e.n === 8 ? 'Finalizar a obra' : e.n === 3 ? 'Concluir a homologação' : p.obra ? 'Concluir ' + minus(e.nome) : 'Concluir e ir para ' + irProx;
    var bc = btn(rot, 'jor-btn-pri jor-btn-grande', function () { concluir(e.n, bc); });
    bc.disabled = !pode;
    if (!pode) bc.setAttribute('aria-describedby', 'jor-pe-motivo');
    barra.appendChild(bc);
    if ((e.itens || []).some(function (x) { return x.bloco === 'pendentes' && !x.feito; })) {
      var lk = el('p', 'jor-nota'); lk.appendChild(btn('Ir para o passo 1', 'jor-btn-link', function () { irAba('p1'); })); cx.appendChild(lk);
    }
    var nx = m.ets[e.n];
    if (nx && e.n !== 3 && e.n !== 8 && (nx.dono || []).length) cx.appendChild(el('p', 'jor-nota', 'Ao concluir: abre ' + (prox && prox.num ? 'o passo ' + prox.num : nx.nome) + ' e ' + (nx.dono || []).map(function (x) { return nomeBonito(x.nome); }).join(' e ') + ' recebe o aviso.'));
    if (e.n === 2) cx.appendChild(el('p', 'jor-nota', 'Entrada, financiamento e comissões não travam este passo.'));
    if (e.n === 3) cx.appendChild(el('p', 'jor-nota', 'Ao concluir: abre a Compra (Thiago e Diego).'));
    if (e.n === 8) cx.appendChild(el('p', 'jor-nota', 'Fechada, a conta trava. Só o Thiago reabre, com motivo.'));
    return cx;
  }
  /** Abas 6 a 9: o que jornada-obra.js desenha. A 9 junta a entrega e a liberação, e o pós-venda (jornada-posvenda.js) no fim. */
  function corpoAbaObra(c, d, a) {
    var J = window.Jornada.etapas;
    if (O.fase2 && a.num === 9 && J.comissionamento) { J.comissionamento(c, d, O.fase2, O.fase3); return; }
    var e = etapasMescladas()[a.etapas[0] - 1];
    if (O.fase2 && e && J[a.etapas[0]]) { J[a.etapas[0]](c, d, e, O.fase2); return; }
    c.appendChild(el('p', 'jor-erro', 'Não consegui ler esta parte agora.')); c.appendChild(btn('Tentar de novo', '', carregarObra));
  }

  // ── O Resumo ────────────────────────────────────────────────────────────────────────────────────────────────
  /** O bloco de Comissões do Resumo aparece a partir da etapa 2, com o dinheiro visível. Fora disso, "Sua comissão" fica na venda. */
  function comissoesNaTela() { return atualEtapa() >= 2 && !!O.dinheiro && O.dinheiro.visivel !== false && !!(window.Jornada.dinheiro && window.Jornada.dinheiro.blocoComissoes); }
  function abaResumo(c, d, m) {
    var ll = linhaLendo(d); if (ll) c.appendChild(ll);
    var g = el('div', 'jor-res-g');
    var esq = el('div', 'jor-res-col'); var dir = el('div', 'jor-res-col');
    esq.appendChild(grupoCliente(d)); esq.appendChild(grupoConta(d)); esq.appendChild(grupoVenda(d));
    dir.appendChild(grupoAndamento(d, m)); dir.appendChild(grupoDocs(d));
    add(g, esq, dir); c.appendChild(g);
    // O caixa: entradas, saídas e saldo (só com o Livro liberado pela api), as comissões e o prêmio de quem indicou.
    var dz = el('div', 'jor-res-din'); dz.id = 'jor-s-caixa';
    if (window.Jornada.dinheiro && window.Jornada.dinheiro.faixa) window.Jornada.dinheiro.faixa(dz, O.dinheiro);
    if (comissoesNaTela()) window.Jornada.dinheiro.blocoComissoes(dz, d, O.dinheiro);
    if (window.Jornada.extras.indicacao) window.Jornada.extras.indicacao(dz, d, O.fase3);
    if (dz.firstChild) c.appendChild(dz);
  }
  function tituloGrupo(txt, etiq) { var t = el('div', 'jor-grp-t'); t.appendChild(el('h3', '', txt)); if (etiq) t.appendChild(etiq); return t; }
  function grupoCliente(d) {
    var box = el('div', 'jor-grp'); box.id = 'jor-s-cliente'; box.tabIndex = -1;
    var its = itensDe(d, CAMPOS_CLIENTE.map(function (c) { return c.chave; }).filter(function (k) { return k !== 'endereco_usina'; }));
    var falta = its.filter(function (i) { return !i.feito; }).length;
    var tg = tituloGrupo('Cliente', its.length ? etq(falta ? 'Falta confirmar ' + falta : 'Confirmado', falta ? 'fo' : 'ok') : null);
    tg.appendChild(ajudaQ('A IA lê a CNH, a conta de luz, o contrato, a procuração, o orçamento e o comprovante, e preenche o que estiver vazio. Ela nunca troca um dado já preenchido. Ao lado de cada dado aparece de onde ele veio. Nome, CPF, telefone, e-mail e endereços editados voltam a pedir confirmação no passo 2.'));
    box.appendChild(tg);
    var g = el('div', 'jor-ficha-g'); var et1 = d.etapas[0];
    fichaCliente().forEach(function (x) { g.appendChild(campoFicha(d, et1, x[0], !!x[1])); });
    box.appendChild(g);
    return box;
  }
  /** Quando todo dado lido pela IA no grupo veio do mesmo documento (2 ou mais), a origem sobe para o título e sai de cada célula. */
  function origemComum(d, lista) {
    var txts = lista.map(function (x) { var o = origemInfo(d, x[0]); var v = lerCampos(d, x[0]); return o && o.ia && v && cheio(x[0], v) ? o.txt : null; }).filter(Boolean);
    return txts.length >= 2 && txts.every(function (t) { return t === txts[0]; }) ? txts[0] : '';
  }
  /** A conta de luz da usina: unidade consumidora, concessionária, titular, classe, consumo e o endereço da usina. */
  function grupoConta(d) {
    var box = el('div', 'jor-grp'); box.id = 'jor-s-conta'; box.tabIndex = -1;
    var it = itensDe(d, ['endereco_usina']).filter(function (i) { return !i.feito; });
    var tg = tituloGrupo('Conta de luz', it.length ? etq('Falta confirmar 1', 'fo') : null);
    var og = origemComum(d, fichaConta()); if (og) tg.insertBefore(el('span', 'jor-grp-org', 'Lido ' + og), tg.children[1] || null);
    box.appendChild(tg);
    var g = el('div', 'jor-ficha-g'); var et1 = d.etapas[0];
    fichaConta().forEach(function (x) { g.appendChild(campoFicha(d, et1, x[0], !!x[1], og)); });
    box.appendChild(g);
    return box;
  }
  /** Uma linha de leitura do resumo: vazio vira "Falta", em tom apagado. `cel` liga a linha ao destaque da leitura; `org` é a origem (venda_origem). */
  function linhaRes(rot, valor, ok, cls, cel, org, chave) {
    var v = valor ? (typeof valor === 'string' ? el('div', 'jor-rc-v' + (cls ? ' ' + cls : ''), valor) : valor) : el('div', 'jor-rc-v vazio', VAZIO_TXT);
    var r = celula(rot, v, ok && !!valor);
    // Vazio: vermelho quando a api exige o item (proposta, kit, valor, pagamento, prazo); amarelo quando não.
    if (!valor && chave) marcaFalta(r, exigido(chave) ? 'ob' : 'op');
    if (cel) { r.dataset.cel = cel; if (novoAgora(cel)) r.classList.add('jor-novo'); }
    if (valor && org && org.fonte === 'ia') r.appendChild(el('span', 'jor-rc-org', ROT_DOC[org.doc] || 'lido pela IA'));
    return r;
  }
  /** O valor e o pagamento só aparecem quando a api mandou o valor (ela decide quem vê: o vendedor vê, mesmo sem o Livro). */
  function vendaDe(d) {
    var vv = d.venda; var dc = d.dados_cliente || {};
    var vede = !!(vv && vv.valor_centavos !== undefined) || dc.valor_centavos !== undefined;
    var valorC = vv && vv.valor_centavos > 0 ? vv.valor_centavos : (typeof dc.valor_centavos === 'number' && dc.valor_centavos > 0 ? dc.valor_centavos : 0);
    var pgs = vv && vv.pagamento && vv.pagamento.length ? vv.pagamento : (Array.isArray(dc.pagamento) ? dc.pagamento : []);
    return { vv: vv, vede: vede, valorC: valorC, pgs: pgs };
  }
  function txtPagamento(pgs) { return pgs.map(function (x) { return (FORMAS_ROT[x.forma] || x.forma) + ' ' + reais(x.valor_centavos) + (x.obs ? ' · ' + x.obs : ''); }); }
  function grupoVenda(d) {
    var box = el('div', 'jor-grp'); box.id = 'jor-s-venda'; box.tabIndex = -1;
    var V = vendaDe(d); var vv = V.vv; var kv = d.kit_vendido || {};
    var editaVenda = !!d.pode.editar_venda && O.vendaEdita;
    var tg = tituloGrupo('Venda');
    if (d.pode.editar_venda && !editaVenda) { var be = btn(vv ? 'Editar' : 'Preencher', 'jor-btn-link', function () { O.vendaEdita = true; desenharObra(); }); be.setAttribute('aria-label', (vv ? 'Editar' : 'Preencher') + ' valor, pagamento e prazo'); tg.appendChild(be); }
    box.appendChild(tg);
    var g = el('div', 'jor-resumo uma');
    var kw = kv.kwp || (d.proposta && d.proposta.kwp);
    g.appendChild(linhaRes('Proposta', d.proposta ? d.proposta.codigo + (kw ? ' · ' + String(kw).replace('.', ',') + ' kWp' : '') : '', false, '', '', null, 'proposta'));
    var vo = (d.dados_cliente && d.dados_cliente.venda_origem) || {};
    // O equipamento FINAL é o comprado (19/11/2026). Antes da compra, a proposta, com a etiqueta "da proposta".
    var ef = d.equipamento_final && d.equipamento_final.origem === 'compra' ? d.equipamento_final : null;
    function txtEq(ls) { return (ls || []).map(function (x) { return (x.quantidade ? String(x.quantidade).replace('.', ',') + ' x ' : '') + (x.descricao || [x.marca, x.modelo].filter(Boolean).join(' ')); }).join('; '); }
    var orgP = d.equipamento_final && d.equipamento_final.origem === 'proposta' ? 'da proposta' : '';
    [['Placas', ef ? txtEq(ef.modulos) : txtKit(kv.placas), 'placas'], ['Inversor', ef ? txtEq(ef.inversores) : txtKit(kv.inversor), 'inversor']].forEach(function (x) {
      var r = linhaRes(x[0], x[1], !!conf(d, x[2]), '', 'v-' + x[2], null, x[2]);
      var o = ef ? 'comprado' : orgP; if (x[1] && o) r.appendChild(el('span', 'jor-rc-org', o));
      // O equipamento muda em qualquer etapa: o comprado se corrige na Compra; o da venda, no passo 2.
      if (!semEquip(d) && d.kit_vendido) {
        var ch = x[2]; var bc = btn(ef ? 'Editar na Compra' : 'Editar', 'jor-fc-ed', function () { if (ef) { irAba('e4'); return; } O.edita['kit.' + ch] = true; irAba('p2'); });
        bc.setAttribute('aria-label', (ef ? 'Editar na Compra: ' : 'Editar ') + x[0].toLowerCase()); r.appendChild(bc);
      }
      g.appendChild(r);
    });
    if (V.vede) {
      var vc = null; if (V.valorC) { vc = el('div', 'jor-rc-v', reais(V.valorC)); if (vv && vv.desconto_centavos > 0) vc.appendChild(el('small', '', 'Desconto de ' + reais(vv.desconto_centavos))); }
      g.appendChild(linhaRes('Valor', vc, !!conf(d, 'valor'), '', 'v-valor', vo.valor, 'valor'));
      var pv = null; if (V.pgs.length) { pv = el('div', 'jor-rc-v'); txtPagamento(V.pgs).forEach(function (t) { pv.appendChild(el('span', 'jor-rc-lin', t)); }); }
      g.appendChild(linhaRes('Pagamento', pv, !!conf(d, 'pagamento'), '', 'v-pagamento', vo.pagamento, 'pagamento'));
    }
    g.appendChild(linhaRes('Prazo', vv && vv.prazo_prometido ? vv.prazo_prometido : '', false, '', 'v-prazo', vo.prazo, 'prazo'));
    var e1 = d.etapas[0]; var vEm = e1 && e1.aberta_em ? quando(e1.aberta_em).split(' ')[0] : '';
    g.appendChild(linhaRes('Vendedor', nomeBonito(d.card.vendedor) + (vEm ? ' · ' + vEm : '')));
    if (vv && vv.nota) g.appendChild(linhaRes('Nota', vv.nota));
    box.appendChild(g);
    if (editaVenda) {
      var fx = el('div', 'jor-venda-form'); fx.appendChild(subTitulo(vv ? 'Editar valor, pagamento e prazo' : 'Valor, pagamento e prazo'));
      formVenda(fx, d, function () { O.vendaEdita = false; carregarObra(); }, e1);
      fx.appendChild(btn('Cancelar', '', function () { O.vendaEdita = false; desenharObra(); }));
      box.appendChild(fx);
    }
    var com = (d.comissoes || []).filter(function (x) { return x.papel === 'venda'; })[0];
    if (com && e1 && e1.dono && e1.dono[0] && com.nome === e1.dono[0].nome && d.pode.editar_venda && !comissoesNaTela()) {
      box.appendChild(el('p', 'jor-nota', 'Sua comissão: ' + reais(com.valor_centavos) + ' (' + (com.pb / 100) + '% do vendido). Paga depois que a entrada entrar.'));
    }
    // A proposta e a venda da planilha ligadas a este card (ligar, desligar).
    var lig = emprestar(box, ['vinc']); lig.id = 'jor-s-ligacoes'; lig.tabIndex = -1;
    return box;
  }
  /** O andamento: uma linha por passo, com o resultado ou o que falta. */
  function grupoAndamento(d, m) {
    var box = el('div', 'jor-grp'); box.appendChild(tituloGrupo('Andamento'));
    var ol = el('ol', 'jor-and');
    var atual = atualEtapa();
    m.lista.forEach(function (p, i) {
      var est = p.feito ? 'feito' : p.id === m.atual ? 'atual' : p.livre ? 'aberto' : 'travado';
      var li = el('li', 'jor-and-l ' + est + (p.aviso ? ' av' : ''));
      var mk = el('span', 'jor-ab-mk'); mk.setAttribute('aria-hidden', 'true');
      if (est === 'feito') mk.appendChild(icone('ok')); else if (p.num) mk.textContent = String(p.num); else if (est === 'travado') mk.appendChild(icone('cadeado')); else mk.appendChild(el('i'));
      var pd = pendencia(d, p, m); if (pd) mk.appendChild(el('b', 'jor-ab-pd ' + pd));
      li.appendChild(mk);
      var tx = el('div', 'jor-and-tx');
      var t = el('b', '', p.titulo); tx.appendChild(t);
      var linha = linhaAndamento(d, p, est, atual, est === 'travado' && p.obra ? textoAbre(m.lista, i) : '');
      if (linha) tx.appendChild(linha);
      li.appendChild(tx);
      if (est !== 'travado') { var ab = btn('Abrir', 'jor-btn-link', function () { irAba(p.id); }); ab.setAttribute('aria-label', 'Abrir ' + (p.num ? 'o passo ' + p.num + ', ' : '') + p.titulo); li.appendChild(ab); }
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }
  function linkFora(url, rot, aria) { if (!/^https:\/\//.test(String(url || ''))) return null; var a = el('a', '', rot); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', aria); return a; }
  function linhaAndamento(d, p, est, atual, abre) {
    var s = el('span', 'jor-and-s');
    function txt(t) { s.appendChild(document.createTextNode(t)); return s; }
    if (est === 'travado') return txt(abre ? abre + '.' : 'Abre depois ' + (p.num > 1 ? 'do passo ' + (p.num - 1) : 'da etapa anterior') + '.');
    if (p.obra) {
      var eo = etapasMescladas(); var eu = eo[p.etapas[p.etapas.length - 1] - 1];
      if (p.feito) return txt('Concluído' + (eu && eu.concluida_em ? ' em ' + dataCurta(eu.concluida_em) : '') + (p.num === 9 ? '. Pós-venda em andamento.' : '.'));
      var fz = []; p.etapas.forEach(function (n) { ((eo[n - 1] || {}).itens || []).forEach(function (i) { if (!i.feito && i.nivel !== 'opcional') fz.push(i.texto); }); });
      return txt(fz.length ? fz[0] + (fz.length > 1 ? ' (e mais ' + (fz.length - 1) + ')' : '') + '.' : 'Em andamento.');
    }
    var e = (etapasMescladas())[p.etapa - 1];
    // Passo feito nunca diz "Falta" ao lado do tique: diz quando concluiu (o p1 com pendência tem a linha própria, logo abaixo).
    var fezEm = p.feito && e && e.concluida_em && dataCurta(e.concluida_em) ? 'Concluído em ' + dataCurta(e.concluida_em) : 'Concluído';
    if (p.id === 'p1') {
      var pend = pendentesDe(d);
      if (p.aviso) { s.className += ' av'; return txt('Concluído com pendência: ' + juntar(pend.map(function (i) { var q = PEDIDOS.filter(function (x) { return x.item === i.chave; })[0]; return minus(q ? q.rot : i.texto); })) + '.'); }
      var f = faltaDoP1(d);
      var extras = [d.excedente === 'sim' ? 'com excedente' : d.excedente === 'nao' ? 'sem excedente' : '', { proprio: 'com financiamento próprio', financeira: 'com financeira', nao: 'sem financiamento' }[tipoFin(d)] || ''].filter(Boolean);
      return txt((f.length ? 'Falta ' + plural(f.length, 'item', 'itens') : 'Tudo recebido') + (extras.length ? ', ' + extras.join(', ') : '') + '.');
    }
    if (p.id === 'p2') {
      if (p.feito) return txt(fezEm + '.');
      var pp = d.papeis || {};
      var l2 = [pp.contrato ? 'Contrato gerado em ' + dataCurta(pp.contrato.gerado_em) : 'Contrato a gerar', pp.procuracao ? 'procuração gerada em ' + dataCurta(pp.procuracao.gerado_em) : 'procuração a gerar'];
      return txt(l2.join(', ') + '.');
    }
    if (p.id === 'p3') {
      var f3 = faltaDoP3(d);
      txt(f3.length && !p.feito ? 'Falta: ' + juntar(f3) + '.' : f3.length ? fezEm + '.' : 'Contrato e procuração assinados.');
      if (d.numero && d.numero.estado === 'tem') txt(' Número ' + d.numero.codigo + '.');
      return s;
    }
    if (p.id === 'p4') { var pc = Math.round(Number(d.vistoria_pct) || 0); return txt(p.feito ? fezEm + '.' : 'Relatório ' + pc + '% preenchido' + (pc >= 80 ? '.' : ', precisa de 80%.')); }
    if (p.id === 'p5') {
      var tr = d.trello || {}; var temCartao = (tr.url && tr.fonte !== 'dossie') || tr.tem_cartao;
      var rf = d.relatorio_final; var temRel = !!(rf && rf.url && /^https:\/\//.test(rf.url));
      if (!temCartao && !temRel) return txt(p.feito ? fezEm + '.' : e && e.falta ? 'Falta ' + plural(e.falta, 'item', 'itens') + '. O Trello nasce com tudo pronto.' : 'Tudo pronto.');
      if (temCartao) { txt('Trello criado'); var a1 = linkFora(tr.url, 'Abrir', 'Abrir o cartão no Trello'); if (a1) { txt(' '); s.appendChild(a1); } txt('. '); }
      if (temRel) { txt('Relatório final'); var a2 = linkFora(rf.url, 'Abrir', 'Abrir o relatório final'); if (a2) { txt(' '); s.appendChild(a2); } txt('.'); }
      return s;
    }
    if (p.feito && e && e.concluida_em) return txt('Concluída' + (dataCurta(e.concluida_em) ? ' em ' + dataCurta(e.concluida_em) : '') + '.');
    return txt(est === 'atual' ? 'Em andamento.' : 'Em aberto.');
  }
  var ROT_SLOT = { documento_titular: 'CNH ou identidade', conta_luz: 'Conta de luz', conta_luz_beneficiaria: 'Conta do excedente', fachada: 'Foto da fachada', padrao: 'Foto do padrão',
    disjuntor: 'Foto do disjuntor', medidor: 'Foto do medidor', contrato_assinado: 'Contrato assinado', procuracao: 'Procuração assinada', datasheet_modulo: 'Datasheet da placa',
    datasheet_inversor: 'Datasheet do inversor', kmz: 'KMZ do local', art: 'ART', art_comprovante: 'Comprovante da ART', projeto_comprovante: 'Comprovante do engenheiro',
    protocolo: 'Print do protocolo', parecer_acesso: 'Parecer de acesso', orcamento: 'Orçamento ou proposta', outros: 'Outro anexo' };
  FIN_DOCS.concat(OUTROS_DOCS).forEach(function (x) { ROT_SLOT[x.slot] = x.rot; });
  /** Os documentos recebidos, numa lista compacta. "Renomear ou mover" troca para a lista do quadro, que faz isso. */
  function grupoDocs(d) {
    var box = el('div', 'jor-grp'); box.id = 'jor-s-docs'; box.tabIndex = -1;
    var tg = tituloGrupo('Documentos recebidos'); box.appendChild(tg);
    var corpoD = el('div'); box.appendChild(corpoD);
    var esperou = false;
    function pinta() {
      corpoD.replaceChildren(); while (tg.childNodes.length > 1) tg.removeChild(tg.lastChild);
      var st = quadroDoCard();
      var arqs = st && !st.carregando && st.docs && Array.isArray(st.docs.arquivos) ? st.docs.arquivos : null;
      if (!arqs) {
        corpoD.appendChild(el('p', 'jor-nota', st && !st.carregando ? 'Não consegui ler os documentos agora.' : 'Carregando…'));
        if (!esperou) { esperou = true; quadroPronto(box).then(function () { if (box.isConnected) pinta(); }); }
        return;
      }
      tg.appendChild(el('span', 'jor-etq', String(arqs.length)));
      if (O.organizar) {
        var fecha = btn('Voltar à lista', 'jor-btn-link', function () { O.organizar = false; pinta(); }); tg.appendChild(fecha);
        emprestar(corpoD, ['lista', 'org']);
        return;
      }
      if (arqs.length && st.docs.pode) { var org = btn('Renomear ou mover', 'jor-btn-link', function () { O.organizar = true; pinta(); }); tg.appendChild(org); }
      if (!arqs.length) { corpoD.appendChild(el('p', 'jor-nota', 'Nenhum documento ainda. Eles entram no passo 1.')); return; }
      var ul = el('ul', 'jor-rdocs');
      arqs.slice().sort(function (a, b) { return String(b.em || '').localeCompare(String(a.em || '')); }).forEach(function (a) {
        var li = el('li');
        var rot = ROT_SLOT[a.slot] || (typeof vdcRotuloSlot === 'function' ? vdcRotuloSlot(st, a.slot) : '') || a.slot;
        var tx = el('div', 'jor-rdocs-t'); tx.appendChild(el('b', '', rot));
        var meta = [a.rotulo && a.rotulo !== rot ? a.rotulo : '', a.em ? dataBr(a.em) : ''].filter(Boolean).join(' · ');
        if (meta) tx.appendChild(el('small', '', meta));
        li.appendChild(tx);
        var lk = linkFora(a.url, 'Abrir', 'Abrir ' + rot); if (lk) { lk.className = 'jor-rdocs-ab'; li.appendChild(lk); }
        ul.appendChild(li);
      });
      corpoD.appendChild(ul);
    }
    pinta();
    return box;
  }

  // ── A leitura dos documentos: depois do upload, o servidor lê o arquivo sozinho e preenche o que está vazio ─────────────────
  // Lê sozinho: CNH, conta de luz, comprovante de endereço, contrato, procuração e orçamento. A CNH do titular da homologação (documento_titular_uc)
  // é lida pelo servidor mas não é esperada aqui: ela não preenche a ficha do contratante.
  var SLOTS_LIDOS = { documento_titular: 'a CNH', conta_luz: 'a conta de luz', comprovante_endereco_comprador: 'o comprovante', contrato_assinado: 'o contrato', procuracao: 'a procuração', orcamento: 'o orçamento' };
  // O que cada leitura pode preencher (chaves de dados_cliente; '#' = parte da venda). Só espera quando um deles está vazio.
  var PESSOA_LIDA = ['nome', 'cpf', 'rg', 'estado_civil', 'profissao', 'endereco'];
  var CAMPOS_LIDOS = {
    documento_titular: ['nome', 'cpf', 'rg', 'nascimento'],
    conta_luz: ['endereco', 'endereco_ponto', 'unidade_consumidora', 'concessionaria', 'titular_conta', 'uc_classe', 'consumo_medio_kwh'],
    comprovante_endereco_comprador: ['endereco'],
    contrato_assinado: PESSOA_LIDA.concat(['#valor', '#pagamento', '#prazo']),
    procuracao: PESSOA_LIDA,
    orcamento: ['#valor', '#pagamento', '#prazo'],
  };
  // Contrato, procuração e orçamento têm várias páginas: a leitura demora mais.
  var ESPERA_LEITURA_MS = { contrato_assinado: 50000, procuracao: 50000, orcamento: 50000 };
  var MSG_NADA_NOVO = 'Recebido. Nada novo para preencher na ficha.';
  /** O valor de cada dado do Resumo (a chave é a da célula). Serve para saber se a leitura mudou algo e o que destacar. */
  function valoresCelulas(d) {
    var c = (d && d.dados_cliente) || {}; var out = {};
    fichaCliente().concat(fichaConta()).forEach(function (x) { var cfg = x[0]; out[cfg.chave] = cfg.campos.map(function (k) { var v = c[k.dc || k.k]; return String(v == null ? '' : v); }).join('|').replace(/^\|+$/, ''); });
    var V = d ? vendaDe(d) : { valorC: 0, pgs: [], vv: null }; var kv = (d && d.kit_vendido) || {};
    out['v-valor'] = String(V.valorC || ''); out['v-pagamento'] = V.pgs && V.pgs.length ? JSON.stringify(V.pgs) : ''; out['v-prazo'] = (V.vv && V.vv.prazo_prometido) || '';
    out['v-placas'] = txtKit(kv.placas); out['v-inversor'] = txtKit(kv.inversor);
    return out;
  }
  function mudaram(antes, depois) { return Object.keys(depois).filter(function (k) { return depois[k] && depois[k] !== (antes || {})[k]; }); }
  /** Os campos que a leitura deste item preencheria e que estão vazios agora. Lista vazia = não há o que preencher. */
  function vaziosDaLeitura(d, slot) {
    var c = (d && d.dados_cliente) || {}; var V = d ? vendaDe(d) : null;
    return (CAMPOS_LIDOS[slot] || []).filter(function (k) {
      if (k === '#valor') return !!(V && V.vede) && !V.valorC;
      if (k === '#pagamento') return !!(V && V.vede) && !V.pgs.length;
      if (k === '#prazo') return !(V && V.vv && V.vv.prazo_prometido);
      return !String(c[k] == null ? '' : c[k]).trim();
    });
  }
  /** Os ids dos arquivos do item no quadro. null enquanto o quadro não carregou. */
  function idsDoSlot(chave) {
    var st = quadroDoCard(); if (!st || !st.docs || !Array.isArray(st.docs.arquivos)) return null;
    return st.docs.arquivos.filter(function (a) { return a && a.slot === chave; }).map(function (a) { return String(a.id); });
  }
  /** Depois do upload: recarrega a obra a cada 3 s até um dado do Resumo mudar. Só espera quando havia dado vazio para a leitura preencher. */
  function iniciarLeitura(slot) {
    if (O.lendoT) clearTimeout(O.lendoT);
    O.lendo = { slot: slot, qual: SLOTS_LIDOS[slot] || 'o documento', t0: Date.now(), antes: valoresCelulas(O.dados), card: String(O.card), ate: ESPERA_LEITURA_MS[slot] || 20000 }; O.lendoFalhou = '';
    O.lendoT = setTimeout(passoLeitura, 3000);
  }
  function passoLeitura() {
    O.lendoT = 0; var l = O.lendo; if (!l || l.card !== String(O.card)) return;
    Promise.resolve(carregarObra()).then(function () {
      if (O.lendo !== l || l.card !== String(O.card)) return;
      var novos = O.dados ? mudaram(l.antes, valoresCelulas(O.dados)) : [];
      if (novos.length) { O.lendo = null; toast('Li ' + l.qual + '. Preenchi ' + plural(novos.length, 'dado', 'dados') + ' no Resumo.'); O.novos = null; marcarNovos(novos); desenharObra(); return; }
      if (Date.now() - l.t0 > l.ate) {
        O.lendo = null;
        // Falha de verdade só quando o campo vazio continuou vazio. Se ele foi preenchido por outra via, não há falha para mostrar.
        if (vaziosDaLeitura(O.dados, l.slot).length) O.lendoFalhou = l.qual; else toast(MSG_NADA_NOVO);
        desenharObra(); return;
      }
      O.lendoT = setTimeout(passoLeitura, 3000);
    });
  }
  /** Fotos, datasheets e KMZ a IA não lê: a tela não espera. Todo o resto que se anexa é lido pelo servidor. */
  var SLOTS_SEM_LEITURA = { fachada: 1, padrao: 1, disjuntor: 1, medidor: 1, obra_foto: 1, ent_extra: 1, datasheet_modulo: 1, datasheet_inversor: 1, kmz: 1, art: 1, art_comprovante: 1, projeto_comprovante: 1, protocolo: 1, parecer_acesso: 1 };
  /** O servidor lê este item? Vale a lista que o GET manda (`leitura.slots`); sem ela, o espelho da lista do servidor (SLOTS_NAO_LIDOS_SOLAR). */
  function leSlot(chave) {
    var ls = O.dados && O.dados.leitura && O.dados.leitura.slots;
    if (Array.isArray(ls) && ls.length) return ls.indexOf(chave) >= 0;
    return !SLOTS_SEM_LEITURA[chave] && !/^(ent_|log_|pos_|cert_|lib_)/.test(chave);
  }
  /** Fim do upload de um documento lido: espera a leitura. Nos seis documentos que a ficha conhece, só se há o que ela preencher e o arquivo é novo. */
  function depoisDoUpload(chave, repetido) {
    if (!leSlot(chave)) return;
    if (repetido || (CAMPOS_LIDOS[chave] && !vaziosDaLeitura(O.dados, chave).length)) { toast(MSG_NADA_NOVO); return; }
    iniciarLeitura(chave);
  }

  // ── Destaque do que a leitura preencheu: a célula fica azul por alguns segundos e volta ao normal ─────────────────────
  function novoAgora(k) { return !!(O.novos && O.novos[k]); }
  /** Acende as células já na tela e as que forem desenhadas nos próximos 6 s. */
  function marcarNovos(chaves) {
    if (!chaves || !chaves.length) return;
    O.novos = O.novos || {}; chaves.forEach(function (k) { O.novos[k] = true; });
    var raiz = O.obraNo || document;
    chaves.forEach(function (k) { Array.prototype.forEach.call(raiz.querySelectorAll('[data-cel="' + k + '"]'), function (n) { if (!n.classList.contains('edita')) n.classList.add('jor-novo'); }); });
    if (O.novosT) clearTimeout(O.novosT);
    O.novosT = setTimeout(function () {
      O.novosT = 0; O.novos = null;
      Array.prototype.forEach.call(document.querySelectorAll('.jor-novo'), function (n) { n.classList.remove('jor-novo'); });
    }, 6000);
  }

  // ── Leitura automática: o servidor lê todo documento novo sozinho; a tela só mostra e acompanha ─────────────────────────
  // GET da obra traz `leitura: { rodando, pendentes, ultima_em }`. Enquanto lê, a tela recarrega a cada 15 s (no máximo 8 vezes).
  var LEIT_MS = 15000, LEIT_MAX = 8;
  function leituraAtiva(d) { var l = d && d.leitura; return !!(l && l.rodando); }   // só `rodando`: pendente que o servidor não começou (espera, cota) não prende a tela
  /** Chamada a cada carga da obra. Começa a acompanhar quando há leitura, e ao terminar acende o que mudou. */
  function acompanharLeitura() {
    var d = O.dados; var card = String(O.card); var s = O.leit;
    if (s && s.card !== card) { if (s.t) clearTimeout(s.t); s = O.leit = null; }
    if (O.lendo && O.lendo.card === card) return;   // a espera do upload (3 s) já cuida da tela
    if (leituraAtiva(d)) {
      if (!s) s = O.leit = { card: card, n: 0, antes: valoresCelulas(d), t: 0 };
      if (!s.t && s.n < LEIT_MAX) s.t = setTimeout(function () { s.t = 0; s.n++; if (O.leit === s && String(O.card) === card) carregarObra(); }, LEIT_MS);
      return;
    }
    if (!s) return;
    if (s.t) clearTimeout(s.t); O.leit = null;
    var novos = mudaram(s.antes, valoresCelulas(d));
    if (novos.length) { toast('Preenchi ' + plural(novos.length, 'dado', 'dados') + '.'); marcarNovos(novos); }
  }
  /** A linha discreta do topo do Resumo e do passo 1 enquanto o servidor lê. */
  function linhaLendo(d) {
    if (!leituraAtiva(d)) return null;
    var p = el('p', 'jor-lendo jor-lendo-auto'); p.setAttribute('role', 'status'); p.appendChild(el('i')); p.appendChild(document.createTextNode('Lendo os documentos novos.'));
    return p;
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
    var box = el('div', 'jor-conf' + (cfg.compacto ? ' compacto' : ''));
    var abertos = cfg.coletar ? cfg.coletar.chaves() : [];
    var pend = cfg.chaves.filter(function (k) { return abertos.indexOf(k) < 0 && !conf(d, k) && cfg.temValor(k); });
    var vazios = cfg.chaves.filter(function (k) { return abertos.indexOf(k) < 0 && !cfg.temValor(k); });
    var marca = ultimaMarca(d, cfg.chaves);
    // compacto (passo 2): sem o título, porque o cartão já mostra cada dado; o "Confirmado" vai na linha dos botões.
    var cab = el('div', 'jor-conf-t'); if (!cfg.compacto) cab.appendChild(el('b', '', cfg.titulo));
    if (!pend.length && !abertos.length && !vazios.length) {
      var ok = el('span', 'jor-pe-ok'); ok.appendChild(icone('ok')); ok.appendChild(document.createTextNode('Confirmado' + quem(marca)));
      if (cfg.compacto) { var ac0 = el('div', 'jor-din-acoes'); ac0.appendChild(ok); box.appendChild(ac0); return box; }
      cab.appendChild(ok); box.appendChild(cab); return box;
    }
    if (cab.firstChild) box.appendChild(cab);
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
      // Quem só corrige o equipamento (sem permissão de confirmar) ainda grava o kit por este botão.
      var soKit = !!(cfg.coletar && cfg.coletar.chaves().length && !semEquip(d));
      b.setAttribute('aria-label', cfg.aria); negar(b, soKit ? '' : semConfirmar(d, et)); if (ocup) b.disabled = true;
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
  /** Por que a pessoa não pode confirmar agora ('' = pode): quem manda é `pode.confirmar` da api (com a etapa 1 concluída, Giovanna e ADM ainda completam). */
  function semConfirmar(d, et) {
    if (!d.pode || !d.pode.confirmar) return 'Você não tem permissão para confirmar.';
    return '';
  }
  /** O equipamento (placas e inversor da venda) muda em qualquer etapa, mesmo depois da homologação e com a conta fechada (19/11/2026). */
  function semEquip(d) { return d.pode && (d.pode.confirmar || d.pode.editar_venda || d.pode.editar_kit) ? '' : 'Você não tem permissão para mudar o equipamento.'; }
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
  /** Os dados que o passo 2 confere (com Confirmar). O Resumo mostra mais: veja fichaCliente e fichaConta. */
  function ficha() { return [cfgCliente('nome'), CPF_CFG, cfgCliente('telefone'), cfgCliente('email'), cfgCliente('endereco'), cfgCliente('endereco_usina')]; }

  // Os dados que a IA lê dos documentos além da ficha do passo 2 (19/11/2026). Gravam pelo mesmo PUT /cadastro, sem confirmação no passo 2.
  // `k` é o campo do cadastro; `dc`, a chave em dados_cliente quando ela é outra (o RG). `txt` mostra o valor; `fmt` só prepara o campo de edição.
  function dataBrDe(v) { var x = soDig(v); return x.length === 8 ? x.slice(0, 2) + '/' + x.slice(2, 4) + '/' + x.slice(4) : String(v || '').trim(); }
  var CLASSES_UC = [['residencial', 'Residencial'], ['comercial', 'Comercial'], ['rural', 'Rural'], ['industrial', 'Industrial'], ['poder_publico', 'Poder público']];
  function rotClasse(v) { var x = CLASSES_UC.filter(function (c) { return c[0] === v; })[0]; return x ? x[1] : nomeBonito(String(v || '').replace(/_/g, ' ')); }
  function kwhTxt(v) { var n = Number(String(v || '').replace(',', '.')); return isFinite(n) && n > 0 ? String(n).replace('.', ',') + ' kWh por mês' : String(v || ''); }
  var EXTRAS_CFG = {
    rg: { chave: 'rg', semConfirmar: true, rot: 'RG', campos: [{ k: 'rg_ie', dc: 'rg', rot: 'RG', tipo: 'text', ex: 'MG-12.345.678' }],
      valida: function (v) { return soDig(v.rg_ie).length < 4 ? 'Digite o número do RG.' : ''; } },
    nascimento: { chave: 'nascimento', semConfirmar: true, rot: 'Nascimento', campos: [{ k: 'nascimento', rot: 'Nascimento', tipo: 'text', ex: 'dd/mm/aaaa', norm: dataBrDe, num: true, max: 10 }],
      valida: function (v) { return /^\d{2}\/\d{2}\/\d{4}$/.test(dataBrDe(v.nascimento)) ? '' : 'Data no formato dd/mm/aaaa.'; } },
    estado_civil: { chave: 'estado_civil', semConfirmar: true, rot: 'Estado civil', campos: [{ k: 'estado_civil', rot: 'Estado civil', tipo: 'text', ex: 'Casado', lista: ['Solteiro', 'Casado', 'Divorciado', 'Viúvo', 'União estável'] }],
      valida: function (v) { return v.estado_civil.length < 4 ? 'Digite o estado civil.' : ''; } },
    profissao: { chave: 'profissao', semConfirmar: true, rot: 'Profissão', campos: [{ k: 'profissao', rot: 'Profissão', tipo: 'text', ex: 'Comerciante' }],
      valida: function (v) { return v.profissao.length < 3 ? 'Digite a profissão.' : ''; } },
    uc: { chave: 'unidade_consumidora', semConfirmar: true, rot: 'Unidade consumidora', campos: [{ k: 'unidade_consumidora', rot: 'Unidade consumidora', tipo: 'text', ex: 'Número da instalação', num: true }],
      valida: function (v) { return v.unidade_consumidora.length < 3 ? 'Digite o número da unidade consumidora.' : ''; } },
    concessionaria: { chave: 'concessionaria', semConfirmar: true, rot: 'Concessionária', campos: [{ k: 'concessionaria', rot: 'Concessionária', tipo: 'text', ex: 'Cemig' }],
      valida: function (v) { return v.concessionaria.length < 2 ? 'Digite a concessionária.' : ''; } },
    titular: { chave: 'titular_conta', semConfirmar: true, rot: 'Titular da conta', campos: [{ k: 'titular_conta', rot: 'Titular da conta', tipo: 'text', ex: 'Nome como está na conta' }],
      valida: function (v) { return v.titular_conta.length < 3 ? 'Digite o nome do titular da conta.' : ''; } },
    classe: { chave: 'uc_classe', semConfirmar: true, rot: 'Classe', campos: [{ k: 'uc_classe', rot: 'Classe', opcoes: CLASSES_UC }],
      txt: function (v) { return rotClasse(v.uc_classe); },
      valida: function (v) { return v.uc_classe ? '' : 'Escolha a classe.'; } },
    consumo: { chave: 'consumo_medio_kwh', semConfirmar: true, rot: 'Consumo médio', campos: [{ k: 'consumo_medio_kwh', rot: 'Consumo médio em kWh', tipo: 'text', ex: '350', num: true, fmt: function (v) { return String(v || '').replace('.', ','); } }],
      txt: function (v) { return kwhTxt(v.consumo_medio_kwh); },
      valida: function (v) { var n = Number(v.consumo_medio_kwh.replace(/\./g, '').replace(',', '.')); return isFinite(n) && n > 0 ? '' : 'Consumo médio em kWh, maior que zero.'; } },
  };
  /** O Resumo: o cliente (identidade e contato) e a conta de luz (a unidade geradora). `largo` ocupa a linha toda. */
  function fichaCliente() { return [[cfgCliente('nome'), 1], [CPF_CFG], [EXTRAS_CFG.rg], [EXTRAS_CFG.nascimento], [EXTRAS_CFG.estado_civil], [EXTRAS_CFG.profissao], [cfgCliente('telefone')], [cfgCliente('email'), 1], [cfgCliente('endereco'), 1]]; }
  function fichaConta() { return [[EXTRAS_CFG.uc], [EXTRAS_CFG.concessionaria], [EXTRAS_CFG.titular, 1], [EXTRAS_CFG.classe], [EXTRAS_CFG.consumo], [cfgCliente('endereco_usina'), 1]]; }
  var VAZIO_TXT = 'Falta';
  // De qual documento a IA leu (dados_cliente.origem_doc e venda_origem.*.doc): o item vira o rótulo curto.
  var ROT_DOC = { documento_titular: 'da CNH', documento_titular_uc: 'da CNH', documento: 'da CNH', conta_luz: 'da conta de luz', contrato_assinado: 'do contrato',
    procuracao: 'da procuração', orcamento: 'do orçamento', comprovante_endereco_comprador: 'do comprovante' };
  // Sem o item (leitura de antes de 19/11), o dado diz de onde costuma vir.
  var DOC_PADRAO = { nome: 'da CNH', cpf: 'da CNH', rg: 'da CNH', nascimento: 'da CNH', endereco: 'da conta de luz', endereco_usina: 'da conta de luz', endereco_ponto: 'da conta de luz',
    unidade_consumidora: 'da conta de luz', concessionaria: 'da conta de luz', titular_conta: 'da conta de luz', uc_classe: 'da conta de luz', consumo_medio_kwh: 'da conta de luz' };
  /** De onde veio o dado (dados_cliente.origem do servidor). 'ia' diz qual documento (origem_doc). Devolve { txt, ia }. */
  function origemInfo(d, cfg) {
    var dc = d.dados_cliente || {}; var o = dc.origem; if (!o || typeof o !== 'object') return null;
    var ch = cfg.chave === 'endereco_usina' ? 'endereco_ponto' : cfg.chave;
    var v = o[ch]; if (v == null && ch === 'endereco_ponto') v = o.endereco_usina;
    if (v === 'ia') { var od = dc.origem_doc && dc.origem_doc[ch]; return { txt: ROT_DOC[od] || DOC_PADRAO[ch] || 'lido pela IA', ia: true }; }
    var t = { manual: 'digitado', card: 'do card', proposta: 'da proposta' }[v];
    return t ? { txt: t, ia: false } : null;
  }


  /**
   * Um dado da ficha. Leitura: valor, origem e Editar (vazio: "Aguardando a CNH" e Preencher). Edição: os campos, Salvar e Cancelar, na mesma
   * célula, que ocupa a largura toda. Salvar grava pelo PUT /cadastro do quadro (vdcCamposGravar) e tira a confirmação do dado, se tinha.
   * O que está em edição e o que foi digitado moram em O (a obra se redesenha a cada gravação e a cada leitura de documento).
   */
  function campoFicha(d, et, cfg, largo, orgDoGrupo) {
    var card = String(O.card);
    var base = 'jor-fc ' + cfg.chave + (largo ? ' largo' : '');
    var no = el('div', base); no.dataset.cel = cfg.chave;
    var vals = lerCampos(d, cfg);
    if (vals === null) quadroPronto(no).then(function () { if (!no.isConnected) return; vals = lerCampos(d, cfg) || vazioDe(); montar(); });
    function vazioDe() { var o = {}; cfg.campos.forEach(function (c) { o[c.k] = ''; }); return o; }
    function rasc(k) { return O.rascunho[cfg.chave + '.' + k]; }
    function limparRasc() { cfg.campos.forEach(function (c) { delete O.rascunho[cfg.chave + '.' + c.k]; }); }
    function montar(foco) {
      var edita = !!O.edita[cfg.chave] && vals !== null;
      var temValor = vals !== null && cheio(cfg, vals);
      no.className = base + (edita ? ' edita' : (vals !== null && !temValor ? ' vazio' : '')) + (!edita && novoAgora(cfg.chave) ? ' jor-novo' : '');
      // Vazio: vermelho quando o dado é item da api (nome, telefone, e-mail, endereços); amarelo nos que não travam (CPF, RG, nascimento, a conta de luz).
      if (!edita && vals !== null && !temValor) marcaFalta(no, exigido(cfg.chave) ? 'ob' : 'op');
      no.replaceChildren();
      var ok = !cfg.semConfirmar && temValor && !!conf(d, cfg.chave);
      var rot = el('div', 'jor-fc-rot'); rot.appendChild(document.createTextNode(cfg.rot));
      if (ok) { rot.appendChild(icone('ok')); rot.appendChild(srTxt('confirmado')); }
      var org = temValor && !edita ? origemInfo(d, cfg) : null; if (org && org.ia && org.txt === orgDoGrupo) org = null; if (org) rot.appendChild(el('span', 'jor-fc-org' + (org.ia ? ' ia' : ''), org.txt));
      no.appendChild(rot);
      if (vals === null) { var lv = el('div', 'jor-fc-v'); lv.appendChild(el('span', '', 'Carregando…')); no.appendChild(lv); return; }
      if (!edita) {
        var v = el('div', 'jor-fc-v'); v.appendChild(el('span', '', temValor ? mostra(cfg, vals) : VAZIO_TXT));
        var bE = el('button', 'jor-fc-ed', temValor ? 'Editar' : 'Preencher'); bE.type = 'button'; bE.setAttribute('aria-label', (temValor ? 'Editar: ' : 'Preencher: ') + cfg.rot);
        bE.addEventListener('click', function () { O.edita[cfg.chave] = true; montar(true); });
        negar(bE, semConfirmar(d, et)); v.appendChild(bE); no.appendChild(v);
        return;
      }
      var inps = {}; var grade = el('div', cfg.campos.length > 1 ? 'jor-campos' : 'jor-email-cmp');
      var erro = el('p', 'jor-erro jor-anexo-msg'); erro.setAttribute('role', 'alert');
      var nota = el('p', 'jor-nota'); nota.hidden = true;
      cfg.campos.forEach(function (c) {
        var inp;
        if (c.opcoes) {
          // Lista fechada (a classe da conta): o servidor guarda a chave.
          inp = el('select', 'jor-sel jor-in' + (temValor ? '' : ' falta')); inp.name = 'cliente-' + c.k;
          var o0 = el('option', '', 'Escolha'); o0.value = ''; inp.appendChild(o0);
          c.opcoes.forEach(function (op) { var oo = el('option', '', op[1]); oo.value = op[0]; inp.appendChild(oo); });
        } else {
          inp = el('input', 'jor-in' + (temValor ? '' : ' falta')); inp.type = c.tipo; inp.inputMode = c.tipo === 'tel' ? 'tel' : c.tipo === 'email' ? 'email' : (c.norm || c.num ? 'numeric' : 'text');
          inp.autocomplete = 'off'; inp.name = 'cliente-' + c.k; inp.maxLength = c.max || 160; if (c.tipo !== 'text' || c.norm || c.num) inp.spellcheck = false;
          inp.placeholder = c.ex || '';
          if (c.lista) { var dl = el('datalist'); dl.id = 'jor-dl-' + c.k; c.lista.forEach(function (x) { var oo = el('option'); oo.value = x; dl.appendChild(oo); }); grade.appendChild(dl); inp.setAttribute('list', dl.id); }
        }
        inp.setAttribute('aria-label', cfg.campos.length > 1 ? cfg.rot + ': ' + c.rot : cfg.rot);
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
            toast(cfg.semConfirmar ? 'Salvo.' : 'Salvo. Confirme no passo 2.');
            if (String(O.card) !== card) return;
            vals = env; delete O.edita[cfg.chave]; limparRasc(); O.lendoFalhou = '';
            // A tela mostra o novo valor já, sem esperar a releitura: o dado foi digitado.
            var dc = d.dados_cliente = d.dados_cliente || {};
            cfg.campos.forEach(function (c) { dc[c.dc || c.k] = env[c.k]; });
            var chO = cfg.chave === 'endereco_usina' ? 'endereco_ponto' : cfg.chave;
            if (dc.origem && typeof dc.origem === 'object') { dc.origem[chO] = 'manual'; if (chO !== cfg.chave) delete dc.origem[cfg.chave]; }
            if (dc.origem_doc && typeof dc.origem_doc === 'object') dc.origem_doc[chO] = null;
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
  /** Uma linha do passo 1: o nome, a situação em uma palavra (Falta, Pedido em dd/mm, Recebido) e o anexo com Trocar e Apagar. */
  function linhaDoc(d, p) {
    var rec = docRecebido(d, p); var ped = (d.pedidos && d.pedidos[p.chave]) || null; var slot = slotDoc(d, p);
    var row = el('div', 'jor-doc');
    if (!rec) marcaFalta(row, 'ob');   // os 6 do cliente travam o passo 1 (faltaDoP1)
    var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', p.rot));
    var est = el('div', 'jor-doc-est');
    est.appendChild(el('span', 'st ' + (rec ? 'st-ok' : ped ? 'st-ped' : 'st-falta'), rec ? 'Recebido' : ped ? 'Pedido' + (ped.em ? ' em ' + dataCurta(ped.em) : '') : 'Falta'));
    info.appendChild(est); row.appendChild(info);
    row.appendChild(anexo(slot, p.rot, rec, { compacto: true }));
    if (O.lendo && O.lendo.slot === slot && O.lendo.card === String(O.card)) {
      var ld = el('p', 'jor-lendo'); ld.setAttribute('role', 'status'); ld.appendChild(el('i')); ld.appendChild(document.createTextNode('Lendo o documento…')); row.appendChild(ld);
    }
    return row;
  }

  // ── Passo 1: documentos (as duas perguntas, a lista para o cliente e os anexos) ───────────────────────────────
  /** Escolha única em chips que grava na hora. `opcoes`: [valor, texto]; sem ela, Sim e Não. */
  function simNao(d, campo, valorAtual, pode, rotulo, opcoes) {
    var qs = el('div', 'jor-filtros'); qs.setAttribute('role', 'group'); if (rotulo) qs.setAttribute('aria-label', rotulo);
    var ops = opcoes || [['sim', 'Sim'], ['nao', 'Não']];
    ops.forEach(function (o) {
      var b = el('button', 'jor-chip jor-chip-grande' + (ops.length > 2 ? ' jor-chip-3' : '') + (valorAtual === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !pode; b.setAttribute('aria-pressed', valorAtual === o[0] ? 'true' : 'false');
      if (!pode) b.title = 'Você não tem permissão para mudar.';
      b.addEventListener('click', function () {
        if (valorAtual === o[0]) return;
        var corpo = {}; corpo[campo] = o[0]; b.disabled = true;
        api('/gerador/jornada-solar/obra/' + enc(O.card), 'PATCH', corpo).then(function (r) {
          if (r.status === 200 && r.json.ok !== false) carregarObra(); else { b.disabled = false; toast(msgDe(r, 'Não consegui agora.')); }
        });
      });
      qs.appendChild(b);
    });
    return qs;
  }
  function pergunta(txt, q) { var t = el('p', 'jor-perg', txt); if (q) t.appendChild(ajudaQ(q)); return t; }
  /** Obra que concluiu a etapa 1 pela regra antiga: a api manda na etapa 2 o bloco 'pendentes' (só enquanto faltam), um item por documento ou foto. */
  function pendentesDe(d) {
    var e2 = (d.etapas || [])[1];
    return ((e2 && e2.itens) || []).filter(function (i) { return i && i.bloco === 'pendentes' && !i.feito; });
  }
  function corpoP1(c) {
    var d = O.dados; var et = d.etapas[0];
    var ll = linhaLendo(d); if (ll) c.appendChild(ll);
    var pend = pendentesDe(d);
    if (pend.length && etapaFeita(et, atualEtapa())) {
      var nomes = pend.map(function (i) { var q = PEDIDOS.filter(function (p) { return p.item === i.chave; })[0]; return minus(q ? q.rot : i.texto); });
      var avp = el('p', 'jor-aviso', 'Esta obra passou do passo 1 sem ' + (nomes.length === 1 ? nomes[0] : plural(nomes.length, 'documento', 'documentos')) + '. Anexe abaixo. A obra segue normal.'); avp.setAttribute('role', 'status'); c.appendChild(avp);
    }
    if (O.lendoFalhou) {
      var lf = el('div', 'jor-aviso jor-aviso-ac'); lf.setAttribute('role', 'alert');
      lf.appendChild(el('span', '', 'Não consegui ler ' + O.lendoFalhou + '. Preencha à mão.'));
      lf.appendChild(btn('Preencher no Resumo', 'jor-btn-link', function () { irResumo('jor-s-cliente'); }));
      c.appendChild(lf);
    }
    // As duas perguntas que mudam a lista.
    var pq = el('div', 'jor-pergs');
    var q1 = el('div', 'jor-perg-c'); q1.appendChild(pergunta('Tem financiamento?', 'Próprio: o passo 2 pede os dados da proposta de banco. Financeira: só se ela pedir algum documento a mais, em Documentos extras.'));
    q1.appendChild(simNao(d, 'financiamento', tipoFin(d) || null, !!d.pode.marcar_excedente, 'Tem financiamento?', [['nao', 'Não'], ['proprio', 'Próprio'], ['financeira', 'Financeira']]));
    var q2 = el('div', 'jor-perg-c'); q2.appendChild(pergunta('Tem excedente?', 'Excedente é a energia das placas que vai para outra conta de luz. Com excedente, a lista pede a conta de cada imóvel que recebe.'));
    q2.appendChild(simNao(d, 'excedente', d.excedente, !!d.pode.marcar_excedente, 'Tem excedente?'));
    // Sem resposta, a pergunta trava o passo 1 (faltaDoP1).
    marcaFalta(q1, tipoFin(d) ? '' : 'ob'); marcaFalta(q2, d.excedente === 'sim' || d.excedente === 'nao' ? '' : 'ob');
    add(pq, q1, q2); c.appendChild(pq);
    c.appendChild(blocoMandarLista(d));
    // Os documentos: sempre os 6 do cliente; o excedente só com Sim; os do financiamento são extras, opcionais.
    var stc = subTitulo('Do cliente', ajudaQ('A IA lê cada documento assim que ele chega e preenche o Resumo.'));
    c.appendChild(stc);
    var lista = el('div', 'jor-docs-l'); PEDIDOS.forEach(function (p) { lista.appendChild(linhaDoc(d, p)); }); c.appendChild(lista);
    // O que o cliente já tem assinado ou orçado: opcional aqui, e a IA tira dele a ficha e a venda.
    var opcLidos = DOCS_LIDOS_OPC.filter(function (o) { return !(o.slot === 'orcamento' && !vendaDe(d).vede); });   // o orçamento tem preço: só quem vê o valor
    c.appendChild(subTitulo('Contrato e orçamento', etqGrupoOpc('Se tiver', opcLidos, d)));
    var lco = el('div', 'jor-docs-l'); opcLidos.forEach(function (o) { lco.appendChild(linhaSlot(d, o.slot, o.rot, true)); }); c.appendChild(lco);   // o orçamento tem preço: só quem vê o valor
    if (d.excedente === 'sim') blocoExcedente(c, d, et);
    // Com Próprio ou Financeira entram os dois, opcionais. Com Não (ou sem resposta) só os que já têm arquivo: documento anexado nunca some.
    var finExtras = FIN_DOCS.filter(function (f) { return tipoFin(d) === 'proprio' || tipoFin(d) === 'financeira' || temSlot(d, f.slot); });
    if (finExtras.length) {
      c.appendChild(subTitulo('Documentos extras', etqGrupoOpc('Se pedirem', finExtras, d)));
      var lf2 = el('div', 'jor-docs-l'); finExtras.forEach(function (f) { lf2.appendChild(linhaSlot(d, f.slot, f.rot, true)); }); c.appendChild(lf2);
    }
    blocoOutrosDocs(c, d);
  }
  /** A etiqueta de um grupo opcional: âmbar enquanto falta algum, cinza quando todos chegaram. */
  function etqGrupoOpc(txt, lista, d) { return lista.some(function (o) { return !temSlot(d, o.slot); }) ? etqFalta(txt, 'op') : etq(txt); }
  /** Mandar a lista: o que falta vira mensagem pronta (WhatsApp ou Copiar). O que foi na lista fica marcado como pedido. */
  function blocoMandarLista(d) {
    var box = el('div', 'jor-mandar');
    var faltam = PEDIDOS.filter(function (p) { return !docRecebido(d, p); });
    var excFalta = d.excedente === 'sim' && !temSlot(d, 'conta_luz_beneficiaria');
    var nomes = faltam.map(function (p) { return p.rot; }); if (excFalta) nomes.push('Conta do excedente');
    var t = el('div', 'jor-mandar-t'); t.appendChild(el('b', '', 'Mandar a lista ao cliente'));
    if (!nomes.length) { t.appendChild(el('span', 'jor-pe-ok', 'Tudo recebido')); box.appendChild(t); return box; }
    t.appendChild(etq('Falta ' + nomes.length, 'fo'));
    t.appendChild(ajudaQ('Quem envia é você, pela sua conversa com o cliente. O que for na lista fica marcado como pedido.'));
    box.appendChild(t);
    var ul = el('ul', 'jor-vai'); nomes.forEach(function (x) { ul.appendChild(el('li', '', x)); }); box.appendChild(ul);
    var txt = mensagemPedido(d, faltam, excFalta); var tel = telefoneWa(d);
    var pre = el('pre', 'jor-ped-msg', txt); pre.hidden = true;
    var ac = el('div', 'jor-docs-ac');
    if (tel) ac.appendChild(btn('WhatsApp', 'jor-btn-pri', function () { abrirWa(tel, txt); marcarPedidos(d, faltam); }));
    ac.appendChild(btn('Copiar', '', function () {
      copiarTexto(txt).then(function (ok) { if (!ok) pre.hidden = false; toast(ok ? 'Lista copiada. Cole na conversa com o cliente.' : 'Não consegui copiar. Selecione e copie a mensagem abaixo.'); });
      marcarPedidos(d, faltam);
    }));
    if (!tel) ac.appendChild(el('p', 'jor-nota', 'Sem telefone do cliente: só dá para copiar.'));
    if ((d.excedente !== 'sim' && d.excedente !== 'nao') || !tipoFin(d)) ac.appendChild(el('p', 'jor-nota', 'Responda as duas perguntas antes, para a lista sair completa.'));
    box.appendChild(ac); box.appendChild(pre);
    return box;
  }
  /** As contas do excedente, a conferência do CPF e o pedido de troca de titularidade. */
  function blocoExcedente(c, d, et) {
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
      ac.appendChild(el('span', 'jor-nota', 'Pedir a troca de titularidade:'));
      if (tel) ac.appendChild(btn('WhatsApp', '', function () { abrirWa(tel, txt); }));
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
  }
  /** Os documentos que entram só se precisar: os que já têm arquivo aparecem; o resto se anexa escolhendo o tipo. */
  function blocoOutrosDocs(c, d) {
    // Quando a linha "CNH ou identidade" já usa o documento do titular da UC, ele não repete aqui.
    var naCnh = slotDoc(d, { item: 'documento' });
    var tem = OUTROS_DOCS.filter(function (o) { return o.slot !== naCnh && temSlot(d, o.slot); });
    var livres = OUTROS_DOCS.filter(function (o) { return o.slot !== naCnh && !temSlot(d, o.slot); });
    c.appendChild(subTitulo('Outros documentos', etq('Se precisar')));
    var lista = el('div', 'jor-docs-l');
    tem.forEach(function (o) { lista.appendChild(linhaSlot(d, o.slot, o.rot)); });
    if (livres.length) {
      var ck = 'outro#novo';
      var row = el('div', 'jor-doc jor-doc-add');
      var sel = el('select', 'jor-sel'); sel.setAttribute('aria-label', 'Tipo do documento'); sel.name = 'outro-tipo';
      livres.forEach(function (o) { var op = el('option', '', o.rot); op.value = o.slot; sel.appendChild(op); });
      if (O.outroTipo && livres.some(function (o) { return o.slot === O.outroTipo; })) sel.value = O.outroTipo;
      sel.addEventListener('change', function () { O.outroTipo = sel.value; });
      row.appendChild(sel);
      if (O.ocupSlot[ck]) { var oc = el('p', 'jor-nota', O.ocupSlot[ck]); oc.setAttribute('role', 'status'); row.appendChild(oc); }
      else row.appendChild(seletor('Anexar', ACEITA_PADRAO, false, 'jor-btn', 'outro documento', function (arqs) { enviarArquivo(sel.value, arqs, false, desenharObra, { ck: ck }); }));
      if (O.erroSlot[ck]) { var er = el('p', 'jor-erro jor-anexo-msg', O.erroSlot[ck]); er.setAttribute('role', 'alert'); row.appendChild(er); }
      lista.appendChild(row);
    }
    c.appendChild(lista);
  }
  /** Uma linha de documento sem pedido: nome, situação e o anexo. `opcional`: sem arquivo diz "Opcional" em vez de "Falta". */
  function linhaSlot(d, slot, rot, opcional) {
    var tem = temSlot(d, slot);
    var row = el('div', 'jor-doc');
    if (!tem) marcaFalta(row, opcional ? 'op' : 'ob');
    var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', rot));
    var est = el('div', 'jor-doc-est'); est.appendChild(el('span', 'st ' + (tem ? 'st-ok' : opcional ? 'st-opc' : 'st-falta'), tem ? 'Recebido' : opcional ? 'Opcional' : 'Falta')); info.appendChild(est);
    row.appendChild(info);
    row.appendChild(anexo(slot, rot, tem, { compacto: true }));
    if (O.lendo && O.lendo.slot === slot && O.lendo.card === String(O.card)) {
      var ld = el('p', 'jor-lendo'); ld.setAttribute('role', 'status'); ld.appendChild(el('i')); ld.appendChild(document.createTextNode('Lendo o documento…')); row.appendChild(ld);
    }
    return row;
  }

  // ── Kit, formas de pagamento e a célula de leitura (Resumo e passo 2) ───────────────────────────────
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
  // ── Passo 2: contrato e procuração (conferir os dados, financiamento, cadastro completo e os papéis) ───────────────
  function abrirLigacoes() { irResumo('jor-s-ligacoes'); }
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
    } else if (!et.concluida_em) c.appendChild(btn('Ligar a proposta no Resumo', '', abrirLigacoes));
  }
  /** Uma linha de conferência: rótulo, valor (ou "Falta") e o tique de confirmado. */
  function linhaConf(rot, valor, ok, falta, nivel) {
    var r = el('div', 'jor-rc');
    var rr = el('div', 'jor-rc-rot', rot); if (ok) { rr.appendChild(icone('ok')); rr.appendChild(srTxt('confirmado')); } r.appendChild(rr);
    if (valor && typeof valor !== 'string') r.appendChild(valor);
    else r.appendChild(el('div', 'jor-rc-v' + (valor ? '' : ' vazio' + (nivel === 'ob' ? ' fo' : nivel === 'op' ? ' fp' : '')), valor || falta || 'Falta preencher'));
    return r;
  }
  /** O cartão do passo 2 fica contornado enquanto tem dado a confirmar ou a preencher que a api exige; amarelo quando só falta o que não trava. */
  function marcaConf(g, d, chaves, temValor) {
    var ob = false, op = false;
    chaves.forEach(function (k) {
      var ex = exigido(k);
      if (!temValor(k)) { if (ex) ob = true; else op = true; }
      else if (ex && !conf(d, k) && !itemOk(d, k)) ob = true;
    });
    marcaFalta(g, ob ? 'ob' : op ? 'op' : '');
  }
  var ROT_CURTO = { nome: 'Nome', cpf: 'CPF', telefone: 'Telefone', email: 'E-mail', endereco: 'Endereço', endereco_usina: 'Usina' };
  function cartaoConfCliente(d, et) {
    var box = el('div', 'jor-conf-c');
    box.appendChild(el('div', 'jor-conf-ct', 'Cliente'));
    var g = el('div', 'jor-resumo uma'); var carregando = false;
    ficha().forEach(function (cfg) {
      var v = lerCampos(d, cfg); if (v === null) carregando = true;
      var tem = v !== null && cheio(cfg, v);
      g.appendChild(linhaConf(ROT_CURTO[cfg.chave] || cfg.rot, tem ? mostra(cfg, v) : (v === null ? 'Carregando…' : ''), !cfg.semConfirmar && tem && !!conf(d, cfg.chave), '', exigido(cfg.chave) ? 'ob' : 'op'));
    });
    if (!carregando) marcaConf(g, d, ficha().map(function (x) { return x.chave; }), function (k) { var x = k === 'cpf' ? CPF_CFG : cfgCliente(k); var v = lerCampos(d, x); return !!(v && cheio(x, v)); });
    if (carregando) quadroPronto(box).then(function (st) { if (st && st.cad && box.isConnected) desenharObra(); });
    box.appendChild(g);
    var lc = linhaConfirmar(d, et, {
      sec: 'cliente', titulo: 'Dados do cliente', compacto: true, chaves: CAMPOS_CLIENTE.map(function (x) { return x.chave; }), rotulo: 'Confirmar dados do cliente', aria: 'Confirmar dados do cliente',
      temValor: function (k) { var x = cfgCliente(k); var v = lerCampos(d, x); return !!(v && cheio(x, v)); },
      rotDe: function (k) { return cfgCliente(k).rot.replace(' do cliente', '').toLowerCase(); },
    });
    lc.querySelector('.jor-din-acoes').appendChild(btn('Editar no Resumo', 'jor-btn-link', function () { irResumo('jor-s-cliente'); }));
    box.appendChild(lc);
    return box;
  }
  function cartaoConfVenda(d, et) {
    var box = el('div', 'jor-conf-c');
    box.appendChild(el('div', 'jor-conf-ct', 'Venda'));
    var V = vendaDe(d); var kv = d.kit_vendido || null; var vv = V.vv;
    var temDin = V.vede;
    var g = el('div', 'jor-resumo uma');
    var kitIn = {};
    KITS.forEach(function (k) {
      var ch = k[0]; var ek = 'kit.' + ch; var falta = !!(kv && Array.isArray(kv.faltando) && kv.faltando.indexOf(ch) >= 0);
      if (kv && (falta || O.edita[ek])) {
        // A proposta não diz o kit (ou a pessoa pediu para corrigir): o campo entra no lugar do valor e vai junto com o Confirmar.
        var lin = el('div', 'jor-rc-v');
        var inp = el('input', 'jor-in' + (falta ? ' jor-fx-ob' : '')); inp.type = 'text'; inp.maxLength = 120; inp.autocomplete = 'off'; inp.name = 'kit-' + ch; inp.placeholder = k[2]; inp.setAttribute('aria-label', k[1] + ' (quantidade e marca)');
        inp.value = O.rascunho[ek] != null ? O.rascunho[ek] : (falta ? '' : txtKit(kv[ch]));
        inp.addEventListener('input', function () { O.rascunho[ek] = inp.value; });
        inp.disabled = !!semEquip(d); lin.appendChild(inp);
        if (falta) lin.appendChild(el('small', '', 'A proposta não diz. Digite a quantidade e a marca.'));
        else { var cn = btn('Cancelar', 'jor-btn-link', function () { delete O.edita[ek]; delete O.rascunho[ek]; desenharObra(); }); cn.setAttribute('aria-label', 'Cancelar a edição: ' + k[1]); lin.appendChild(cn); }
        kitIn[ch] = inp; g.appendChild(linhaConf(k[1], lin, false));
        return;
      }
      g.appendChild(linhaConf(k[1], kv ? txtKit(kv[ch]) : '', !!conf(d, ch), '', exigido(ch) ? 'ob' : 'op'));
    });
    if (temDin) {
      g.appendChild(linhaConf('Valor', V.valorC ? reais(V.valorC) : '', !!conf(d, 'valor'), '', exigido('valor') ? 'ob' : 'op'));
      var pv = null; if (V.pgs.length) { pv = el('div', 'jor-rc-v'); txtPagamento(V.pgs).forEach(function (t) { pv.appendChild(el('span', 'jor-rc-lin', t)); }); }
      g.appendChild(linhaConf('Pagamento', pv, !!conf(d, 'pagamento'), '', exigido('pagamento') ? 'ob' : 'op'));
    }
    g.appendChild(linhaConf('Prazo', vv && vv.prazo_prometido ? vv.prazo_prometido : '', itemOk(d, 'prazo'), '', exigido('prazo') ? 'ob' : 'op'));
    marcaConf(g, d, (kv ? ['placas', 'inversor'] : []).concat(temDin ? ['valor', 'pagamento'] : []).concat(['prazo']), function (k) {
      if (k === 'valor') return V.valorC > 0; if (k === 'pagamento') return V.pgs.length > 0; if (k === 'prazo') return !!(vv && vv.prazo_prometido);
      return !!txtKit(kv && kv[k]) && !(Array.isArray(kv.faltando) && kv.faltando.indexOf(k) >= 0);
    });
    box.appendChild(g);
    var rotK = { placas: 'placas', inversor: 'inversor', valor: 'valor', pagamento: 'forma de pagamento' };
    var lc = linhaConfirmar(d, et, {
      sec: 'venda', titulo: 'Venda', compacto: true, chaves: (kv ? ['placas', 'inversor'] : []).concat(temDin ? ['valor', 'pagamento'] : []), rotulo: 'Confirmar a venda', aria: 'Confirmar a venda',
      temValor: function (k) { if (k === 'valor') return V.valorC > 0; if (k === 'pagamento') return V.pgs.length > 0; return !!txtKit(kv && kv[k]); },
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
    var acs = lc.querySelector('.jor-din-acoes');
    if (!(vv && vv.prazo_prometido) && d.pode.editar_venda) acs.appendChild(btn('Preencher o prazo no Resumo', 'jor-btn-link', function () { O.vendaEdita = true; irResumo('jor-s-venda'); }));
    else if (d.pode.editar_venda) acs.appendChild(btn('Editar no Resumo', 'jor-btn-link', function () { O.vendaEdita = true; irResumo('jor-s-venda'); }));
    // Placas e inversor sempre têm Corrigir (não só o kit digitado à mão): o equipamento não trava com a homologação nem com a conta fechada.
    if (kv && !semEquip(d)) ['placas', 'inversor'].forEach(function (ch) {
      if (O.edita['kit.' + ch] || (kv.faltando || []).indexOf(ch) >= 0) return;
      acs.appendChild(btn('Corrigir ' + (ch === 'placas' ? 'as placas' : 'o inversor'), 'jor-btn-link', function () { O.edita['kit.' + ch] = true; desenharObra(); }));
    });
    if (!et.concluida_em) lc.appendChild(el('p', 'jor-nota', 'Com a venda confirmada, a equipe toda recebe o aviso de venda no WhatsApp.'));
    box.appendChild(lc);
    return box;
  }
  function corpoP2(c) {
    var d = O.dados; var et = d.etapas[0];
    ligarProposta(d, et, c);
    c.appendChild(subTitulo('Conferir os dados', ajudaQ('Os dados vêm da proposta e dos documentos lidos pela IA. Para mudar um dado, edite no Resumo. Dado editado volta a pedir confirmação aqui.')));
    var gc = el('div', 'jor-conf-g'); add(gc, cartaoConfCliente(d, et), cartaoConfVenda(d, et)); c.appendChild(gc);
    if (tipoFin(d) === 'proprio') {
      c.appendChild(el('div', 'jor-sep'));
      if (window.Jornada.extras.banco) window.Jornada.extras.banco(c, d);
      else c.appendChild(el('p', 'jor-nota', 'A proposta de banco não carregou. Atualize a página.'));
    }
    c.appendChild(subTitulo('Cadastro do contrato', ajudaQ('A IA lê os documentos anexados e preenche o resto do cadastro que vai no contrato e na procuração (RG, estado civil, titular da conta). Confira antes de gerar.')));
    var llP2 = linhaLendo(d); if (llP2) c.appendChild(llP2);
    emprestar(c, ['topo', 'acoes', 'msg', 'pn', 'pes']);
    c.appendChild(subTitulo('Gerar os papéis'));
    var lista = el('div', 'jor-docs-l');
    function linhaPapel(rot, tipo, extraCtl, gerarFn) {
      var gp = d.papeis && d.papeis[tipo];
      var l = el('div', 'jor-papel'); var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', rot));
      if (!gp && !(d.slots && d.slots[tipo === 'contrato' ? 'contrato_assinado' : 'procuracao'])) marcaFalta(l, 'ob');   // papel_contrato e papel_procuracao da api
      var est = el('div', 'jor-doc-est'); est.appendChild(el('span', 'st ' + (gp ? 'st-ok' : 'st-falta'), gp ? 'Gerado em ' + dataCurta(gp.gerado_em) : 'Falta gerar')); info.appendChild(est);
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
    // O recibo mostra o valor: aparece quando a api mandou o valor (mesma regra do Resumo), não pela regra do Livro.
    if (d.pode.gerar_papeis && vendaDe(d).vede) {
      var lr = el('div', 'jor-papel'); var ir2 = el('div'); ir2.appendChild(el('span', 'jor-doc-nome', 'Recibo')); var er2 = el('div', 'jor-doc-est'); er2.appendChild(el('span', 'st st-opc', 'Opcional')); ir2.appendChild(er2); lr.appendChild(ir2);
      var ar = el('div', 'jor-papel-ac'); var br = btn('Gerar recibo', '', function () { reciboDialogo(d, br); }); ar.appendChild(br); lr.appendChild(ar); lista.appendChild(lr);
    }
    c.appendChild(lista);
    c.appendChild(el('p', 'jor-nota', 'Assinados, eles entram no passo 3.'));
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
        var nv0 = cfg.item && exigido(cfg.item) ? 'ob' : 'op';
        var c0 = el('div', 'jor-foto'); var t0 = el('div', 'jor-foto-topo'); t0.appendChild(el('span', '', cfg.rotBase + ' 1')); t0.appendChild(etqFalta(nv0 === 'op' ? 'Opcional' : 'Falta', nv0)); c0.appendChild(t0);
        marcaFalta(c0, nv0);
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
    var nv = item && exigido(item) ? 'ob' : 'op';
    var cf = el('div', 'jor-foto'); var tp = el('div', 'jor-foto-topo'); tp.appendChild(el('span', '', rot)); tp.appendChild(tem ? etq('Anexado', 'ok') : etqFalta(nv === 'op' ? 'Opcional' : 'Falta', nv)); cf.appendChild(tp);
    marcaFalta(cf, tem ? '' : nv);
    cf.appendChild(anexo(slot, rot, tem, aceita ? { compacto: true, aceita: aceita } : { compacto: true }));
    return cf;
  }

  // ── Trello e relatório final ─────────────────────────────────────────────────
  function relatorioFinalDe(r) { var j = r.json || {}; return (j.relatorio_final && j.relatorio_final.url) || j.url || (j.relatorio && j.relatorio.url) || ''; }
  function blocoTrelloRelatorio(d, et) {
    var b = secao('Trello e relatório final', itensPorChave(et, ['trello']));
    var tr = d.trello || {}; var cartao = !!((tr.url && tr.fonte !== 'dossie') || tr.tem_cartao);
    var ta = d.trello_auto || null;
    // O cartão nasce sozinho com o passo em 100% (trello_auto.pronto), com o relatório final dentro.
    if (cartao) {
      var okp = el('p', 'jor-ok', 'Cartão criado' + (tr.criado_em ? ' em ' + dataCurta(tr.criado_em) : '') + (tr.por ? ' por ' + nomeBonito(tr.por) : '') + '.');
      var lk = linkFora(tr.url, 'Abrir no Trello', 'Abrir o cartão no Trello'); if (lk) { okp.appendChild(document.createTextNode(' ')); okp.appendChild(lk); }
      b.appendChild(okp);
    } else if (ta && ta.pronto) b.appendChild(el('p', 'jor-ok', 'Tudo pronto. O cartão nasce sozinho em instantes, com o relatório final.'));
    else if (et && et.concluida_em) b.appendChild(el('p', 'jor-nota', 'Homologação concluída sem cartão no Trello.'));
    else {
      var faltaT = ta && Array.isArray(ta.falta) ? ta.falta : [];
      b.appendChild(el('p', 'jor-nota', 'Com tudo acima pronto, o cartão do Trello nasce sozinho com o relatório final.' + (faltaT.length ? ' Falta: ' + juntar(faltaT.map(minus)) + '.' : '')));
    }
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
    // Se o cartão não nascer sozinho: o Trello do quadro de documentos (criar o cartão, ou abrir o antigo do dossiê).
    if (!cartao && quadroDoCard() && quadroDoCard().no && quadroDoCard().no.tre) { b.appendChild(subTitulo('Se o cartão não nascer sozinho')); emprestar(b, ['tre']); }
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
  // ── Passo 3: assinaturas (contrato e procuração assinados, outros anexos e o número da obra) ───────────────────────
  function corpoP3(c) {
    var d = O.dados; var et = d.etapas[1];
    var gs = el('div', 'jor-fotos');
    gs.appendChild(cartaoAnexo(d, et, 'contrato_assinado', 'Contrato assinado', 'contrato_assinado'));
    gs.appendChild(cartaoAnexo(d, et, 'procuracao', 'Procuração assinada', 'procuracao'));
    c.appendChild(gs);
    c.appendChild(el('p', 'jor-nota', 'O contrato assinado fica arquivado aqui. Só a procuração segue para a homologação.'));
    if (d.numero && d.numero.estado !== 'tem') { c.appendChild(subTitulo('Número da obra', etq('Automático', 'auto'))); c.appendChild(blocoNumero(d)); }
    c.appendChild(subTitulo('Outros anexos', etq('Opcional')));
    c.appendChild(listaVarios(d, et, { slot: 'outros', rotBase: 'Anexo', add: 'Adicionar anexo', item: null, titulo: '', cartaoVazio: false }));
  }

  // ── Passo 4: vistoria (o formulário de jornada-obra.js, com os chips; o passo já diz o título) ───────────────────
  function corpoP4(c) {
    var d = O.dados;
    var w = el('div'); w.id = 'jor-s-vistoria'; c.appendChild(w);
    if (!window.Jornada.extras.vistoria) { w.appendChild(el('p', 'jor-erro', 'O relatório de vistoria não carregou. Atualize a página.')); return; }
    window.Jornada.extras.vistoria(w, d);
  }

  // ── Passo 5: homologação ──────────────────────────────────────────────────────────────────────────────────────
  function corpoP5(c) {
    var d = O.dados; var et = d.etapas[2];
    var b1 = secao('Equipamento', itensPorChave(et, ['datasheet_modulo', 'datasheet_inversor', 'kmz']));
    var g = el('div', 'jor-fotos');
    g.appendChild(cartaoAnexo(d, et, 'datasheet_modulo', 'Datasheet da placa', 'datasheet_modulo'));
    g.appendChild(cartaoAnexo(d, et, 'datasheet_inversor', 'Datasheet do inversor', 'datasheet_inversor'));
    g.appendChild(cartaoAnexo(d, et, 'kmz', 'KMZ do local', 'kmz', ACEITA_KMZ));
    b1.appendChild(g); c.appendChild(b1);
    if (d.excedente === 'sim' && d.rateio) { var br = secao('Rateio do excedente', itensPorChave(et, ['rateio'])); corpoRateio(br); c.appendChild(br); }
    var ba = secao('ART e engenheiro', itensPorChave(et, ['art'])); corpoArt(ba); c.appendChild(ba);
    var bp = secao('Protocolo', itensPorChave(et, ['protocolo'])); corpoProtocolo(bp); c.appendChild(bp);
    var bq = secao('Parecer de acesso', itensPorChave(et, ['parecer'])); corpoParecer(bq); c.appendChild(bq);
    c.appendChild(blocoTrelloRelatorio(d, et));
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
      bc.disabled = !(d.rateio.total === 100 && d.pode.etapa3);
      if (!d.pode.etapa3) bc.title = 'Você não tem permissão para conferir o rateio.'; else if (d.rateio.total !== 100) bc.title = 'O rateio não soma 100%. Corrija os percentuais antes de conferir.';
      c.appendChild(bc);
    }
    c.appendChild(el('p', 'jor-nota', 'Confira no protocolo da Cemig antes de concluir.'));
    // O percentual de cada conta se muda no editor do quadro de documentos, que abre aqui mesmo.
    if (O.ratEdita) { emprestar(c, ['rat']); c.appendChild(btn('Fechar o editor', 'jor-btn-link', function () { O.ratEdita = false; desenharObra(); })); }
    else if (d.pode.etapa3) c.appendChild(btn('Mudar os percentuais', 'jor-btn-link', function () { O.ratEdita = true; desenharObra(); }));
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
    c.appendChild(fe); c.appendChild(anexo('projeto_comprovante', 'Comprovante do engenheiro', !!d.slots.projeto_comprovante, { nivel: 'op' }));
    c.appendChild(el('p', 'jor-nota', 'Pendente, o pagamento do engenheiro não trava a etapa. O comprovante entra aqui quando pagar.'));
  }
  function corpoProtocolo(c) {
    var d = O.dados;
    var num = el('input', 'jor-in'); num.type = 'text'; num.maxLength = 40; num.name = 'protocolo-numero'; num.autocomplete = 'off'; num.setAttribute('aria-label', 'Número do protocolo'); num.value = d.protocolo ? d.protocolo.numero : '';
    var dt = el('input', 'jor-in'); dt.type = 'date'; dt.name = 'protocolo-data'; dt.setAttribute('aria-label', 'Data do protocolo'); dt.value = d.protocolo ? d.protocolo.em : '';
    var sv = btn('Salvar', '', function () { sv.disabled = true; patch({ protocolo: { numero: num.value.trim(), em: dt.value } }).then(function () { sv.disabled = false; }); });
    sv.disabled = !d.pode.etapa3; if (!d.pode.etapa3) sv.title = 'Você não tem permissão para salvar o protocolo.'; num.disabled = !d.pode.etapa3; dt.disabled = !d.pode.etapa3;
    // O número do protocolo é parte do item da api (número e print).
    marcaFalta(num, d.protocolo && d.protocolo.numero ? '' : 'ob');
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
    anexo: anexo, blocoTitulo: blocoTitulo, comReserva: comReserva, etq: etq, marcaFalta: marcaFalta, etqFalta: etqFalta, exigido: exigido, quando: quando, cidadeUF: cidadeUF, campoRot: campoRot, subTitulo: subTitulo, dialogo: dialogo, dialogoMotivo: dialogoMotivo, fecharDlg: fecharDlg, toast: toast, releia: releia, imprimir: imprimir,
    empresaDoAparelho: empresaDoAparelho, msgDe: msgDe, corpo: corpo, abrirLista: abrirLista, desenhar: desenharObra, recarregar: function () { return carregarObra(); },
    ficha: function () { return O.ficha; }, sugs: sugs, veio: veio,
    atual: atualEtapa, O: function () { return O; }, gerarPapel: gerarPapel, rotEtapa: rotEtapa, irAba: irAba,
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
