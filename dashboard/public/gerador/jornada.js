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
    lendo: null, lendoFalhou: '', lendoT: 0, edita: {}, rascunho: {}, confirmando: {}, erroSec: {}, vendaEdita: false, aba: null, abaVista: '', organizar: false, outroTipo: '', ratEdita: false };

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
      '@keyframes jor-pulso{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}',
      '@media (prefers-reduced-motion:reduce){.jor-lendo i{animation:none}}',
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
      '.jor-res-din .jor-din-c b{font-size:17px}',
      '.jor-dl{grid-template-columns:minmax(0,1fr)}',
      '.jor-campos,.jor-fotos{grid-template-columns:minmax(0,1fr)}',
      '.jor-busca{width:100%}',
      '.jor-pg{grid-template-columns:minmax(0,1fr)}',
      '.jor-tab thead{display:none}',
      '.jor-tab,.jor-tab tbody,.jor-tab tr,.jor-tab td{display:block;width:100%}',
      '.jor-tab tr{border-bottom:1px solid var(--n-bd);padding:8px 10px}',
      '.jor-tab td{border:0;padding:2px 0;white-space:normal}',
      '.jor-tab td[data-r]::before{content:attr(data-r) ": ";color:var(--n-tx3);font-size:12px}',
      '}',
    
      // A página do cliente (19/11/2026): cabeçalho, barra de abas fixa, o painel do passo e o Resumo. Cor só por token.
      '.jor-obra-cab{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 12px}',
      '.jor-obra-cab .jor-num{font-size:15px;color:var(--io-titulo);background:var(--n-sf3);border-radius:8px;padding:2px 10px}',
      '.jor-obra-cab h2{font-size:22px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
      '.jor-cab-ac{display:flex;flex-wrap:wrap;gap:8px}',
      '.jor-abas-p{position:sticky;top:var(--top-h,0px);z-index:30;margin:0 0 12px;padding:6px 0;background:var(--n-bg);box-shadow:0 -12px 0 var(--n-bg)}',
      '.jor-abas-tr{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:4px;border:1px solid var(--n-bd);border-radius:14px;background:var(--n-sf);box-shadow:var(--sombra)}',
      '.jor-abas-tr::-webkit-scrollbar{display:none}',
      '.jor-ab{flex:0 0 auto;position:relative;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:6px 14px 6px 8px;border:0;border-radius:10px;background:transparent;color:var(--n-tx2);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;touch-action:manipulation}',
      '.jor-ab.res{padding:6px 16px}',
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
      '.jor-ab-sep{flex:0 0 auto;align-self:center;margin-left:6px;padding:4px 6px 4px 12px;border-left:1px solid var(--n-bd);font-size:12px;font-weight:600;color:var(--n-tx3)}',
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
      '@media (max-width:760px){',
      '.jor-painel{padding:16px}',
      '.jor-pergs,.jor-conf-g{grid-template-columns:minmax(0,1fr)}',
      '.jor-passo-tt h3,.jor-obra-cab h2{font-size:20px}',
      '.jor-ab{padding:6px 12px 6px 6px}',
      '.jor-ab.num:not(.sel) .jor-ab-t{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.jor-ab.num:not(.sel){padding:6px 10px}',
      '.jor-doc-add{grid-template-columns:minmax(0,1fr)}',
      '.jor-prazo-ac{margin-left:0}',
      '.jor-and-l .jor-btn-link,a.jor-rdocs-ab,.jor-grp-t .jor-btn-link{min-height:44px}',
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
    O.vdcChave = ''; O.vdcNo = null; O.vdcDet = null; O.obraNo = null; O.fase2 = null; O.dinheiro = null; O.ficha = null; O.erroSlot = {}; O.ocupSlot = {};
    O.lendo = null; O.lendoFalhou = ''; if (O.lendoT) { clearTimeout(O.lendoT); O.lendoT = 0; } O.edita = {}; O.rascunho = {}; O.confirmando = {}; O.erroSec = {}; O.vendaEdita = false; O.aba = null; O.abaVista = ''; O.organizar = false; O.outroTipo = ''; O.ratEdita = false;
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
        O.dados = r.json;
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

  // Os documentos que só entram com financiamento e os que entram só se precisar (avalista, imóvel, titular da homologação).
  var FIN_DOCS = [
    { slot: 'documento_financiamento', rot: 'Documento do titular do financiamento', msg: 'CNH ou documento do titular do financiamento' },
    { slot: 'comprovante_endereco_financiamento', rot: 'Comprovante de endereço do titular do financiamento', msg: 'Comprovante de endereço do titular do financiamento' },
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
    if (d.financiamento !== 'sim' && d.financiamento !== 'nao') out.push('responder se tem financiamento');
    if (d.excedente !== 'sim' && d.excedente !== 'nao') out.push('responder se tem excedente');
    PEDIDOS.forEach(function (p) { if (!docRecebido(d, p)) out.push(minus(p.rot)); });
    if (d.excedente === 'sim') {
      var ie = itensDe(d, ['excedente'])[0]; var cpf = d.excedente_cpf || {};
      if (!temSlot(d, 'conta_luz_beneficiaria')) out.push('conta do excedente');
      else if ((ie && !ie.feito) || (!ie && cpf.ok === false)) out.push('a conta do excedente no CPF do titular');
    }
    if (d.financiamento === 'sim') FIN_DOCS.forEach(function (f) { if (!temSlot(d, f.slot) && !itemOk(d, f.slot)) out.push(minus(f.rot)); });
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
    ets.forEach(function (e) {
      if (e.n < 4) return;
      P.push({ id: 'e' + e.n, num: 0, titulo: e.nome, curto: e.nome, etapa: e.n, obra: true, e: e, api: e.n <= 8,
        feito: e.n <= 8 && etapaFeita(e, atual), corpo: function (c) { corpoEtapaObra(c, O.dados, e); } });
    });
    P.forEach(function (p, i) { p.livre = i === 0 || P[i - 1].feito || p.feito; });
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
    var e = O.dados && O.dados.etapas ? O.dados.etapas[n - 1] : null;
    return e ? e.nome : 'Etapa ' + n;
  }

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
    var sel = raiz.querySelector('.jor-ab.sel'); var trilho = sel && sel.parentNode;
    // Só rola a barra quando a aba escolhida ficou fora da vista (o Resumo continua à mostra sempre que couber).
    if (trilho && trilho.scrollWidth > trilho.clientWidth && sel.offsetLeft + sel.offsetWidth > trilho.clientWidth) trilho.scrollLeft = sel.offsetLeft + sel.offsetWidth - trilho.clientWidth + 8;
  }
  /** Troca de aba: desenha, devolve o foco à aba e sobe a página até a barra quando ela já passou do topo. */
  function irAba(id, foco) {
    O.aba = id; desenharObra();
    var b = document.getElementById('jor-ab-' + id);
    if (b && foco !== false) try { b.focus({ preventScroll: true }); } catch (e) { /* sem foco */ }
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
    if (window.Jornada.extras.bookPdf && O.fase3 && O.fase3.pode && O.fase3.pode.book) { var bdoc = btn('Documento da obra', '', function () { window.Jornada.extras.bookPdf(O.card, bdoc); }); cac.appendChild(bdoc); }
    add(cac, btn('Clientes', '', abrirLista));
    if (d.pode.cancelar) add(cac, btn('Venda cancelada', 'jor-btn-disc', function () { cancelarDialogo(O.card, carregarObra); }));
    topo.appendChild(cac);
    return topo;
  }

  // ── A barra de abas ──────────────────────────────────────────────────────────────────────────────────────────
  function barraAbas(m, aba) {
    var cx = el('nav', 'jor-abas-p'); cx.setAttribute('aria-label', 'Passos da obra');
    var trilho = el('div', 'jor-abas-tr'); trilho.setAttribute('role', 'tablist');
    // Antes do passo 5 fechar, as etapas da obra viram uma aba só, travada. Depois, cada uma ganha a sua e os passos 1 a 5 encolhem para o número.
    var obraLivre = obraAberta(m);
    var itens = [{ id: 'resumo', curto: 'Resumo', livre: true, resumo: true }].concat(obraLivre ? m.lista : m.lista.filter(function (p) { return !p.obra; }).concat([OBRA_TRAVADA]));
    var anteriorNum = 0;
    itens.forEach(function (p, i) {
      if (p.obra && p.id !== 'obra' && !anteriorNum) { var sp = el('span', 'jor-ab-sep', 'Obra'); sp.setAttribute('aria-hidden', 'true'); trilho.appendChild(sp); anteriorNum = 1; }
      var est = p.resumo ? '' : p.feito ? 'feito' : p.id === m.atual ? 'atual' : p.livre ? 'aberto' : 'travado';
      var b = el('button', 'jor-ab' + (est ? ' ' + est : '') + (p.id === aba ? ' sel' : '') + (p.resumo ? ' res' : '') + (p.num ? ' num' : '') + (p.num && obraLivre ? ' compacta' : '') + (p.aviso ? ' av' : ''));
      b.type = 'button'; b.id = 'jor-ab-' + p.id; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', p.id === aba ? 'true' : 'false'); b.tabIndex = p.id === aba ? 0 : -1;
      if (p.id === aba) b.setAttribute('aria-controls', 'jor-aba-corpo');
      if (!p.resumo) {
        var mk = el('span', 'jor-ab-mk'); mk.setAttribute('aria-hidden', 'true');
        // Travado com número mostra o número (tracejado); sem número, o cadeado.
        if (est === 'feito') mk.appendChild(icone('ok')); else if (p.num) mk.textContent = String(p.num); else if (est === 'travado') mk.appendChild(icone('cadeado')); else mk.appendChild(el('i'));
        b.appendChild(mk);
      }
      b.appendChild(el('span', 'jor-ab-t', p.curto));
      if (p.num && obraLivre) b.title = p.titulo;
      if (!p.resumo) b.appendChild(srTxt(', ' + ({ feito: p.aviso ? 'feito, com pendência' : 'feito', atual: 'passo da vez', aberto: 'em aberto', travado: 'travado' })[est]));
      if (est === 'travado') {
        b.setAttribute('aria-disabled', 'true');
        var antes = itens[i - 1]; var nomeAntes = p.id === 'obra' ? 'o passo 5' : antes && antes.num ? 'o passo ' + antes.num : 'a etapa anterior';
        b.title = 'Conclua ' + nomeAntes + ' para abrir.';
      }
      b.addEventListener('click', function () {
        if (est === 'travado') { toast(b.title); return; }
        irAba(p.id);
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
    return cx;
  }

  /** A obra (etapas 4 a 9) abre depois do passo 5. Fechada, é uma linha só na barra e no Andamento. */
  var OBRA_TRAVADA = { id: 'obra', num: 0, titulo: 'Obra', curto: 'Obra', obra: true, livre: false, feito: false };
  function obraAberta(m) { return m.lista.some(function (p) { return p.obra && p.livre; }); }

  // ── Um passo ─────────────────────────────────────────────────────────────────────────────────────────────────
  function abaPasso(c, d, m, p) {
    var e = m.ets[p.etapa - 1];
    var cab = el('div', 'jor-passo-cab');
    var tt = el('div', 'jor-passo-tt');
    tt.appendChild(el('span', 'jor-passo-de', p.num ? 'Passo ' + p.num + ' de 5' : 'Obra'));
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
    if (p.id === m.atual && e && !etapaFeita(e, atualEtapa())) { var pz = faixaPrazo(d, e); if (pz) c.appendChild(pz); }
    var corpoP = el('div', 'jor-passo-corpo'); corpoP.id = 'jor-s-' + p.id;
    p.corpo(corpoP, p);
    c.appendChild(corpoP);
    var pe = rodapePasso(d, p, m); if (pe) c.appendChild(pe);
  }
  /** Prazo e cobrança da etapa da vez: uma faixa fina no topo do passo, com o Esperando. */
  function faixaPrazo(d, e) {
    var f2 = O.fase2; var pz = el('div', 'jor-prazo');
    if (e.prazo && e.prazo.vence) pz.appendChild(el('span', 'jor-prazo-d', (e.prazo.rotulo || 'Prazo') + ' ' + ddmm(e.prazo.vence)));
    var sit = e.situacao || { tipo: 'sem_prazo', texto: '' };
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
  function faltaDaEtapa(e) {
    var out = []; var pend = [];
    (e.itens || []).forEach(function (i) {
      if (i.feito) return;
      if (i.bloco === 'pendentes') { var q = PEDIDOS.filter(function (p) { return p.item === i.chave; })[0]; pend.push(minus(q ? q.rot : i.texto)); return; }
      var t = e.n <= 3 && FALTA_ROT[i.chave] ? FALTA_ROT[i.chave] : minus(i.texto);
      if (out.indexOf(t) < 0) out.push(t);
    });
    if (pend.length) out.push('o pendente do passo 1 (' + juntar(pend) + ')');
    return out;
  }
  /** O pé do passo: o que falta, em uma frase, e o Concluir que libera o próximo. */
  function rodapePasso(d, p, m) {
    var i = m.lista.indexOf(p); var prox = m.lista[i + 1] || null;
    var e = m.ets[p.etapa - 1]; var atual = atualEtapa();
    var cx = el('div', 'jor-pe'); var barra = el('div', 'jor-portao-barra'); cx.appendChild(barra);
    var irProx = prox ? (prox.num ? 'o passo ' + prox.num : prox.titulo) : '';
    if (O.msg) { var mm = el('p', 'jor-erro', O.msg); mm.setAttribute('role', 'status'); cx.insertBefore(mm, barra); }
    if (!p.api) {
      if (p.obra) return null;   // pós-venda: sem concluir
      // Passos 1 e 3: fecham pelos itens, aqui na tela.
      var falta = p.id === 'p1' ? faltaDoP1(d) : faltaDoP3(d);
      var ja = etapaFeita(e, atual);
      barra.appendChild(el('p', 'jor-portao-frase', falta.length && !ja ? 'Para seguir, falta: ' + juntar(falta) + '.' : (ja ? 'Passo concluído.' : 'Tudo pronto neste passo.')));
      if (prox) {
        var b1 = btn(prox.feito || ja ? 'Ir para ' + irProx : 'Concluir e ir para ' + irProx, 'jor-btn-pri jor-btn-grande', function () { irAba(prox.id); });
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
    barra.appendChild(el('p', 'jor-portao-frase', e.falta > 0 ? 'Para concluir, falta: ' + juntar(faltaE.length ? faltaE : [plural(e.falta, 'item', 'itens')]) + '.' : 'Tudo pronto para concluir.'));
    var rot = e.n === 8 ? 'Finalizar a obra' : e.n === 3 ? 'Concluir a homologação' : p.obra ? 'Concluir ' + minus(e.nome) : 'Concluir e ir para ' + irProx;
    var bc = btn(rot, 'jor-btn-pri jor-btn-grande', function () { concluir(e.n, bc); });
    bc.disabled = !pode;
    if (!pode && e.falta === 0) bc.title = 'Você não tem permissão para concluir esta etapa.';
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
  /** Etapas 4 a 9: o que jornada-obra.js e jornada-posvenda.js desenham, dentro da aba. */
  function corpoEtapaObra(c, d, e) {
    if (e.n === 9) { if (window.Jornada.etapas[9]) window.Jornada.etapas[9](c, d, e, O.fase3); return; }
    if (O.fase2 && window.Jornada.etapas[e.n]) { window.Jornada.etapas[e.n](c, d, e, O.fase2); return; }
    c.appendChild(el('p', 'jor-erro', 'Não consegui ler esta parte agora.')); c.appendChild(btn('Tentar de novo', '', carregarObra));
  }

  // ── O Resumo ────────────────────────────────────────────────────────────────────────────────────────────────
  function abaResumo(c, d, m) {
    var g = el('div', 'jor-res-g');
    var esq = el('div', 'jor-res-col'); var dir = el('div', 'jor-res-col');
    esq.appendChild(grupoCliente(d)); esq.appendChild(grupoVenda(d));
    dir.appendChild(grupoAndamento(d, m)); dir.appendChild(grupoDocs(d));
    add(g, esq, dir); c.appendChild(g);
    // O caixa: entradas, saídas e saldo (só com o Livro liberado pela api), as comissões e o prêmio de quem indicou.
    var dz = el('div', 'jor-res-din'); dz.id = 'jor-s-caixa';
    if (window.Jornada.dinheiro && window.Jornada.dinheiro.faixa) window.Jornada.dinheiro.faixa(dz, O.dinheiro);
    if (atualEtapa() >= 2 && O.dinheiro && O.dinheiro.visivel !== false && window.Jornada.dinheiro && window.Jornada.dinheiro.blocoComissoes) window.Jornada.dinheiro.blocoComissoes(dz, d, O.dinheiro);
    if (window.Jornada.extras.indicacao) window.Jornada.extras.indicacao(dz, d, O.fase3);
    if (dz.firstChild) c.appendChild(dz);
  }
  function tituloGrupo(txt, etiq) { var t = el('div', 'jor-grp-t'); t.appendChild(el('h3', '', txt)); if (etiq) t.appendChild(etiq); return t; }
  function grupoCliente(d) {
    var box = el('div', 'jor-grp'); box.id = 'jor-s-cliente'; box.tabIndex = -1;
    var its = itensDe(d, CAMPOS_CLIENTE.map(function (c) { return c.chave; }));
    var falta = its.filter(function (i) { return !i.feito; }).length;
    var tg = tituloGrupo('Cliente', its.length ? etq(falta ? 'Falta confirmar ' + falta : 'Confirmado', falta ? 'av' : 'ok') : null);
    tg.appendChild(ajudaQ('A IA lê a CNH (nome e CPF) e a conta de luz (endereço) e preenche aqui. Dado editado volta a pedir confirmação no passo 2.'));
    box.appendChild(tg);
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
    g.appendChild(linhaRes('Proposta', d.proposta ? d.proposta.codigo + (kw ? ' · ' + String(kw).replace('.', ',') + ' kWp' : '') : ''));
    g.appendChild(linhaRes('Placas', txtKit(kv.placas), !!conf(d, 'placas')));
    g.appendChild(linhaRes('Inversor', txtKit(kv.inversor), !!conf(d, 'inversor')));
    if (V.vede) {
      var vc = null; if (V.valorC) { vc = el('div', 'jor-rc-v', reais(V.valorC)); if (vv && vv.desconto_centavos > 0) vc.appendChild(el('small', '', 'Desconto de ' + reais(vv.desconto_centavos))); }
      g.appendChild(linhaRes('Valor', vc, !!conf(d, 'valor')));
      var pv = null; if (V.pgs.length) { pv = el('div', 'jor-rc-v'); txtPagamento(V.pgs).forEach(function (t) { pv.appendChild(el('span', 'jor-rc-lin', t)); }); }
      g.appendChild(linhaRes('Pagamento', pv, !!conf(d, 'pagamento')));
    }
    g.appendChild(linhaRes('Prazo', vv && vv.prazo_prometido ? vv.prazo_prometido : ''));
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
    if (com && e1 && e1.dono && e1.dono[0] && com.nome === e1.dono[0].nome && d.pode.editar_venda) {
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
    var obraLivre = obraAberta(m);
    (obraLivre ? m.lista : m.lista.filter(function (p) { return !p.obra; }).concat([OBRA_TRAVADA])).forEach(function (p) {
      var est = p.feito ? 'feito' : p.id === m.atual ? 'atual' : p.livre ? 'aberto' : 'travado';
      var li = el('li', 'jor-and-l ' + est + (p.aviso ? ' av' : ''));
      var mk = el('span', 'jor-ab-mk'); mk.setAttribute('aria-hidden', 'true');
      if (est === 'feito') mk.appendChild(icone('ok')); else if (p.num) mk.textContent = String(p.num); else if (est === 'travado') mk.appendChild(icone('cadeado')); else mk.appendChild(el('i'));
      li.appendChild(mk);
      var tx = el('div', 'jor-and-tx');
      var t = el('b', '', p.titulo); tx.appendChild(t);
      var linha = linhaAndamento(d, p, est, atual);
      if (linha) tx.appendChild(linha);
      li.appendChild(tx);
      if (est !== 'travado') { var ab = btn('Abrir', 'jor-btn-link', function () { irAba(p.id); }); ab.setAttribute('aria-label', 'Abrir ' + (p.num ? 'o passo ' + p.num + ', ' : '') + p.titulo); li.appendChild(ab); }
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }
  function linkFora(url, rot, aria) { if (!/^https:\/\//.test(String(url || ''))) return null; var a = el('a', '', rot); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', aria); return a; }
  function linhaAndamento(d, p, est, atual) {
    var s = el('span', 'jor-and-s');
    function txt(t) { s.appendChild(document.createTextNode(t)); return s; }
    if (p.id === 'obra') return txt('Compra, instalação, homologação final, vistoria final, fechamento e pós-venda. Abre depois do passo 5.');
    if (est === 'travado') return txt('Abre depois ' + (p.num > 1 ? 'do passo ' + (p.num - 1) : 'da etapa anterior') + '.');
    var e = (etapasMescladas())[p.etapa - 1];
    if (p.id === 'p1') {
      var pend = pendentesDe(d);
      if (p.aviso) { s.className += ' av'; return txt('Concluído com pendência: ' + juntar(pend.map(function (i) { var q = PEDIDOS.filter(function (x) { return x.item === i.chave; })[0]; return minus(q ? q.rot : i.texto); })) + '.'); }
      var f = faltaDoP1(d);
      var extras = [d.excedente === 'sim' ? 'com excedente' : d.excedente === 'nao' ? 'sem excedente' : '', d.financiamento === 'sim' ? 'com financiamento' : d.financiamento === 'nao' ? 'sem financiamento' : ''].filter(Boolean);
      return txt((f.length ? 'Falta ' + plural(f.length, 'item', 'itens') : 'Tudo recebido') + (extras.length ? ', ' + extras.join(', ') : '') + '.');
    }
    if (p.id === 'p2') {
      var pp = d.papeis || {};
      var l2 = [pp.contrato ? 'Contrato gerado em ' + dataCurta(pp.contrato.gerado_em) : 'Contrato a gerar', pp.procuracao ? 'procuração gerada em ' + dataCurta(pp.procuracao.gerado_em) : 'procuração a gerar'];
      return txt(l2.join(', ') + '.');
    }
    if (p.id === 'p3') {
      var f3 = faltaDoP3(d);
      txt(f3.length ? 'Falta: ' + juntar(f3) + '.' : 'Contrato e procuração assinados.');
      if (d.numero && d.numero.estado === 'tem') txt(' Número ' + d.numero.codigo + '.');
      return s;
    }
    if (p.id === 'p4') { var pc = Math.round(Number(d.vistoria_pct) || 0); return txt('Relatório ' + pc + '% preenchido' + (pc >= 80 ? '.' : ', precisa de 80%.')); }
    if (p.id === 'p5') {
      var tr = d.trello || {}; var temCartao = (tr.url && tr.fonte !== 'dossie') || tr.tem_cartao;
      var rf = d.relatorio_final; var temRel = !!(rf && rf.url && /^https:\/\//.test(rf.url));
      if (!temCartao && !temRel) return txt(e && e.falta ? 'Falta ' + plural(e.falta, 'item', 'itens') + '. O Trello nasce com tudo pronto.' : 'Tudo pronto.');
      if (temCartao) { txt('Trello criado'); var a1 = linkFora(tr.url, 'Abrir', 'Abrir o cartão no Trello'); if (a1) { txt(' '); s.appendChild(a1); } txt('. '); }
      if (temRel) { txt('Relatório final'); var a2 = linkFora(rf.url, 'Abrir', 'Abrir o relatório final'); if (a2) { txt(' '); s.appendChild(a2); } txt('.'); }
      return s;
    }
    if (p.feito && e && e.concluida_em) return txt('Concluída' + (dataCurta(e.concluida_em) ? ' em ' + dataCurta(e.concluida_em) : '') + '.');
    if (p.id === 'e9') return txt('Mensagens e retorno do cliente.');
    return txt(est === 'atual' ? 'Em andamento.' : 'Em aberto.');
  }
  var ROT_SLOT = { documento_titular: 'CNH ou identidade', conta_luz: 'Conta de luz', conta_luz_beneficiaria: 'Conta do excedente', fachada: 'Foto da fachada', padrao: 'Foto do padrão',
    disjuntor: 'Foto do disjuntor', medidor: 'Foto do medidor', contrato_assinado: 'Contrato assinado', procuracao: 'Procuração assinada', datasheet_modulo: 'Datasheet da placa',
    datasheet_inversor: 'Datasheet do inversor', kmz: 'KMZ do local', art: 'ART', art_comprovante: 'Comprovante da ART', projeto_comprovante: 'Comprovante do engenheiro',
    protocolo: 'Print do protocolo', parecer_acesso: 'Parecer de acesso', outros: 'Outro anexo' };
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
            toast(cfg.semConfirmar ? 'Salvo.' : 'Salvo. Confirme no passo 2.');
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
  function mensagemPedido(d, faltam, excedente, fin) {
    var nome = primeiroNome(d);
    var linhas = faltam.map(function (p) { return '- ' + p.msg; });
    if (excedente) linhas.push('- Conta de luz de cada imóvel que vai receber o excedente');
    (fin || []).forEach(function (f) { linhas.push('- ' + f.msg); });
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
  function simNao(d, campo, valorAtual, pode, rotulo) {
    var qs = el('div', 'jor-filtros'); qs.setAttribute('role', 'group'); if (rotulo) qs.setAttribute('aria-label', rotulo);
    [['sim', 'Sim'], ['nao', 'Não']].forEach(function (o) {
      var b = el('button', 'jor-chip jor-chip-grande' + (valorAtual === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !pode; b.setAttribute('aria-pressed', valorAtual === o[0] ? 'true' : 'false');
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
    var pend = pendentesDe(d);
    if (pend.length && etapaFeita(et, atualEtapa())) {
      var nomes = pend.map(function (i) { var q = PEDIDOS.filter(function (p) { return p.item === i.chave; })[0]; return minus(q ? q.rot : i.texto); });
      var avp = el('p', 'jor-aviso', 'Esta obra passou do passo 1 sem ' + juntar(nomes) + '. Anexe abaixo. A obra segue normal.'); avp.setAttribute('role', 'status'); c.appendChild(avp);
    }
    if (O.lendoFalhou) {
      var lf = el('div', 'jor-aviso jor-aviso-ac'); lf.setAttribute('role', 'alert');
      lf.appendChild(el('span', '', 'Não consegui ler ' + O.lendoFalhou + '. Preencha à mão.'));
      lf.appendChild(btn('Preencher no Resumo', 'jor-btn-link', function () { irResumo('jor-s-cliente'); }));
      c.appendChild(lf);
    }
    // As duas perguntas que mudam a lista.
    var pq = el('div', 'jor-pergs');
    var q1 = el('div', 'jor-perg-c'); q1.appendChild(pergunta('Tem financiamento?', 'Com financiamento, a lista pede o documento e o comprovante de endereço de quem financia, e o passo 2 pede a proposta de banco.'));
    q1.appendChild(simNao(d, 'financiamento', d.financiamento === 'sim' || d.financiamento === 'nao' ? d.financiamento : null, !!d.pode.marcar_excedente, 'Tem financiamento?'));
    var q2 = el('div', 'jor-perg-c'); q2.appendChild(pergunta('Tem excedente?', 'Excedente é a energia das placas que vai para outra conta de luz. Com excedente, a lista pede a conta de cada imóvel que recebe.'));
    q2.appendChild(simNao(d, 'excedente', d.excedente, !!d.pode.marcar_excedente, 'Tem excedente?'));
    add(pq, q1, q2); c.appendChild(pq);
    c.appendChild(blocoMandarLista(d));
    // Os documentos: sempre os 6 do cliente; o excedente e o financiamento só quando a resposta é Sim.
    c.appendChild(subTitulo('Do cliente', ajudaQ('A CNH e a conta de luz preenchem a ficha do cliente sozinhas. Confira no Resumo.')));
    var lista = el('div', 'jor-docs-l'); PEDIDOS.forEach(function (p) { lista.appendChild(linhaDoc(d, p)); }); c.appendChild(lista);
    if (d.excedente === 'sim') blocoExcedente(c, d, et);
    if (d.financiamento === 'sim') {
      c.appendChild(subTitulo('Financiamento'));
      var lf2 = el('div', 'jor-docs-l'); FIN_DOCS.forEach(function (f) { lf2.appendChild(linhaSlot(d, f.slot, f.rot)); }); c.appendChild(lf2);
    }
    blocoOutrosDocs(c, d);
  }
  /** Mandar a lista: o que falta vira mensagem pronta (WhatsApp ou Copiar). O que foi na lista fica marcado como pedido. */
  function blocoMandarLista(d) {
    var box = el('div', 'jor-mandar');
    var faltam = PEDIDOS.filter(function (p) { return !docRecebido(d, p); });
    var excFalta = d.excedente === 'sim' && !temSlot(d, 'conta_luz_beneficiaria');
    var finFalta = d.financiamento === 'sim' ? FIN_DOCS.filter(function (f) { return !temSlot(d, f.slot); }) : [];
    var nomes = faltam.map(function (p) { return p.rot; }); if (excFalta) nomes.push('Conta do excedente'); finFalta.forEach(function (f) { nomes.push(f.rot); });
    var t = el('div', 'jor-mandar-t'); t.appendChild(el('b', '', 'Mandar a lista ao cliente'));
    if (!nomes.length) { t.appendChild(el('span', 'jor-pe-ok', 'Tudo recebido')); box.appendChild(t); return box; }
    t.appendChild(etq('Falta ' + nomes.length, 'av'));
    t.appendChild(ajudaQ('Quem envia é você, pela sua conversa com o cliente. O que for na lista fica marcado como pedido.'));
    box.appendChild(t);
    var ul = el('ul', 'jor-vai'); nomes.forEach(function (x) { ul.appendChild(el('li', '', x)); }); box.appendChild(ul);
    var txt = mensagemPedido(d, faltam, excFalta, finFalta); var tel = telefoneWa(d);
    var pre = el('pre', 'jor-ped-msg', txt); pre.hidden = true;
    var ac = el('div', 'jor-docs-ac');
    if (tel) ac.appendChild(btn('WhatsApp', 'jor-btn-pri', function () { abrirWa(tel, txt); marcarPedidos(d, faltam); }));
    ac.appendChild(btn('Copiar', '', function () {
      copiarTexto(txt).then(function (ok) { if (!ok) pre.hidden = false; toast(ok ? 'Lista copiada. Cole na conversa com o cliente.' : 'Não consegui copiar. Selecione e copie a mensagem abaixo.'); });
      marcarPedidos(d, faltam);
    }));
    if (!tel) ac.appendChild(el('p', 'jor-nota', 'Sem telefone do cliente: só dá para copiar.'));
    if ((d.excedente !== 'sim' && d.excedente !== 'nao') || (d.financiamento !== 'sim' && d.financiamento !== 'nao')) ac.appendChild(el('p', 'jor-nota', 'Responda as duas perguntas antes, para a lista sair completa.'));
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
  /** Uma linha de documento sem pedido: nome, situação e o anexo. */
  function linhaSlot(d, slot, rot) {
    var tem = temSlot(d, slot);
    var row = el('div', 'jor-doc');
    var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', rot));
    var est = el('div', 'jor-doc-est'); est.appendChild(el('span', 'st ' + (tem ? 'st-ok' : 'st-falta'), tem ? 'Recebido' : 'Falta')); info.appendChild(est);
    row.appendChild(info);
    row.appendChild(anexo(slot, rot, tem, { compacto: true }));
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
  function linhaConf(rot, valor, ok, falta) {
    var r = el('div', 'jor-rc');
    var rr = el('div', 'jor-rc-rot', rot); if (ok) { rr.appendChild(icone('ok')); rr.appendChild(srTxt('confirmado')); } r.appendChild(rr);
    if (valor && typeof valor !== 'string') r.appendChild(valor);
    else r.appendChild(el('div', 'jor-rc-v' + (valor ? '' : ' vazio'), valor || falta || 'Falta preencher'));
    return r;
  }
  var ROT_CURTO = { nome: 'Nome', cpf: 'CPF', telefone: 'Telefone', email: 'E-mail', endereco: 'Endereço', endereco_usina: 'Usina' };
  function cartaoConfCliente(d, et) {
    var box = el('div', 'jor-conf-c');
    box.appendChild(el('div', 'jor-conf-ct', 'Cliente'));
    var g = el('div', 'jor-resumo uma'); var carregando = false;
    ficha().forEach(function (cfg) {
      var v = lerCampos(d, cfg); if (v === null) carregando = true;
      var tem = v !== null && cheio(cfg, v);
      g.appendChild(linhaConf(ROT_CURTO[cfg.chave] || cfg.rot, tem ? mostra(cfg, v) : (v === null ? 'Carregando…' : ''), !cfg.semConfirmar && tem && !!conf(d, cfg.chave)));
    });
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
        var inp = el('input', 'jor-in' + (falta ? ' falta' : '')); inp.type = 'text'; inp.maxLength = 120; inp.autocomplete = 'off'; inp.name = 'kit-' + ch; inp.placeholder = k[2]; inp.setAttribute('aria-label', k[1] + ' (quantidade e marca)');
        inp.value = O.rascunho[ek] != null ? O.rascunho[ek] : (falta ? '' : txtKit(kv[ch]));
        inp.addEventListener('input', function () { O.rascunho[ek] = inp.value; });
        inp.disabled = !!semConfirmar(d, et); lin.appendChild(inp);
        if (falta) lin.appendChild(el('small', '', 'A proposta não diz. Digite a quantidade e a marca.'));
        else { var cn = btn('Cancelar', 'jor-btn-link', function () { delete O.edita[ek]; delete O.rascunho[ek]; desenharObra(); }); cn.setAttribute('aria-label', 'Cancelar a edição: ' + k[1]); lin.appendChild(cn); }
        kitIn[ch] = inp; g.appendChild(linhaConf(k[1], lin, false));
        return;
      }
      g.appendChild(linhaConf(k[1], kv ? txtKit(kv[ch]) : '', !!conf(d, ch)));
    });
    if (temDin) {
      g.appendChild(linhaConf('Valor', V.valorC ? reais(V.valorC) : '', !!conf(d, 'valor')));
      var pv = null; if (V.pgs.length) { pv = el('div', 'jor-rc-v'); txtPagamento(V.pgs).forEach(function (t) { pv.appendChild(el('span', 'jor-rc-lin', t)); }); }
      g.appendChild(linhaConf('Pagamento', pv, !!conf(d, 'pagamento')));
    }
    g.appendChild(linhaConf('Prazo', vv && vv.prazo_prometido ? vv.prazo_prometido : '', itemOk(d, 'prazo')));
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
    if (kv && Array.isArray(kv.manual) && !semConfirmar(d, et)) kv.manual.forEach(function (ch) {
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
    if (d.financiamento === 'sim') {
      c.appendChild(el('div', 'jor-sep'));
      if (window.Jornada.extras.banco) window.Jornada.extras.banco(c, d);
      else c.appendChild(el('p', 'jor-nota', 'A proposta de banco não carregou. Atualize a página.'));
    }
    c.appendChild(subTitulo('Cadastro do contrato', ajudaQ('A IA lê os documentos anexados e preenche o resto do cadastro que vai no contrato e na procuração (RG, estado civil, titular da conta). Confira antes de gerar.')));
    emprestar(c, ['topo', 'acoes', 'msg', 'pn', 'pes']);
    c.appendChild(subTitulo('Gerar os papéis'));
    var lista = el('div', 'jor-docs-l');
    function linhaPapel(rot, tipo, extraCtl, gerarFn) {
      var gp = d.papeis && d.papeis[tipo];
      var l = el('div', 'jor-papel'); var info = el('div'); info.appendChild(el('span', 'jor-doc-nome', rot));
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
      var lr = el('div', 'jor-papel'); var ir2 = el('div'); ir2.appendChild(el('span', 'jor-doc-nome', 'Recibo')); var er2 = el('div', 'jor-doc-est'); er2.appendChild(el('span', 'st', 'Opcional')); ir2.appendChild(er2); lr.appendChild(ir2);
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
    var tr = d.trello || {}; var cartao = !!((tr.url && tr.fonte !== 'dossie') || tr.tem_cartao);
    var ta = d.trello_auto || null;
    // O cartão nasce sozinho com o passo em 100% (trello_auto.pronto), com o relatório final dentro.
    if (cartao) {
      var okp = el('p', 'jor-ok', 'Cartão criado' + (tr.criado_em ? ' em ' + dataCurta(tr.criado_em) : '') + (tr.por ? ' por ' + nomeBonito(tr.por) : '') + '.');
      var lk = linkFora(tr.url, 'Abrir no Trello', 'Abrir o cartão no Trello'); if (lk) { okp.appendChild(document.createTextNode(' ')); okp.appendChild(lk); }
      b.appendChild(okp);
    } else if (ta && ta.pronto) b.appendChild(el('p', 'jor-ok', 'Tudo pronto. O cartão nasce sozinho em instantes, com o relatório final.'));
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
    b.appendChild(el('p', 'jor-nota', 'O relatório final vai para o cartão do Trello junto com tudo.'));
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
      bc.disabled = !(d.rateio.total === 100 && d.pode.etapa3); c.appendChild(bc);
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
