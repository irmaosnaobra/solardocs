/* Jornada da obra, fase 3 (06/11/2026): a etapa 9 (Pós-venda), o painel Mensagens em Ajustes, o Book em PDF e o link de indicação.
 * Script clássico, um IIFE. Pega os ajudantes de window.Jornada.h na hora da chamada e se registra em Jornada.etapas[9] e Jornada.extras.
 * Nenhuma mensagem sai daqui: as chaves em Ajustes só chamam a rota do servidor, que decide tudo (ordem, janela, anti-ban).
 * Cor só por var(--n-*) e var(--io-*), com a mesma reserva escura do jornada.js. Sem emoji, sem exclamação, sem travessão. */
(function () {
  'use strict';

  function H() { return window.Jornada.h; }
  function O() { return H().O(); }
  function el(t, c, x) { return H().el(t, c, x); }
  function add() { return H().add.apply(null, arguments); }
  function btn(t, c, f) { return H().btn(t, c, f); }
  function base() { return '/gerador/jornada-solar/obra/' + encodeURIComponent(O().card); }
  function ehAdm() { return typeof admOk === 'function' && admOk(); }

  var GRUPOS = [
    ['venda', 'Aviso de venda', 'Equipe'],
    ['etapa', 'É sua e Esperando', 'Dono da etapa e o Thiago'],
    ['fila', 'Fila das 08:00, escalada e placar', 'Equipe'],
    ['liberacao', 'Liberação com o Book', 'Cliente'],
    ['aniversario', 'Aniversários', 'Cliente'],
  ];
  var SITUACAO = {
    agendado: 'Agendado',
    sem_book: 'Sai quando o Book em PDF estiver pronto',
    sem_data: 'Sem data de nascimento na ficha',
    sem_telefone: 'Sem telefone no card',
    desligado: 'Desligado em Ajustes',
    nao_saiu: 'Não saiu',
    falhou: 'Não saiu: erro da linha',
  };
  var TIPO_AVISO = { sua: 'É sua', espera: 'Esperando', venda: 'Aviso de venda' };

  // ── Pequenos ajudantes ─────────────────────────────────────────────────────
  function msgSrv(r, padrao) {
    var j = r && r.json;
    if (j && typeof j.mensagem === 'string' && j.mensagem) return j.mensagem;
    if (r && r.status === 401) return 'Sua sessão terminou. Entre de novo no Gerador.';
    if (r && r.status === 0) return 'Sem conexão. Tente de novo.';
    if (j && typeof j.error === 'string' && /\s/.test(j.error)) return j.error;
    return padrao;
  }
  /** ISO em UTC para dd/mm e hh:mm de Brasília. */
  function quando(iso) {
    try {
      var f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      var o = {}; f.formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
      if (!o.day) return { d: '', h: '' };
      return { d: o.day + '/' + o.month, h: o.hour + ':' + o.minute };
    } catch (e) { return { d: '', h: '' }; }
  }
  function dataBR(ymd) { var s = String(ymd || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }
  function primeiro(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }
  function bloco(titulo) { var b = el('div', 'jor-bloco'); b.appendChild(el('div', 'jor-bloco-t', titulo)); return b; }
  function f3Valido(f3) { return !!f3 && typeof f3 === 'object' && Array.isArray(f3.toques); }

  function injetarCss() {
    if (document.getElementById('jor-pos-css')) return;
    var css = [
      '.jor-pos-toque{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:4px 10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-pos-toque:first-of-type{border-top:0}',
      '.jor-pos-n{font-weight:800;color:var(--n-tx2,#B4C0D2)}',
      '.jor-pos-rot{font-weight:700;overflow-wrap:anywhere}',
      '.jor-pos-sit{color:var(--n-tx2,#B4C0D2);font-size:13px;text-align:right}',
      '.jor-pos-sit.ok{color:var(--io-ok-tx,#4ADE80);font-weight:700}',
      '.jor-pos-sit.mau{color:var(--io-er-tx,#FCA5A5);font-weight:700}',
      '.jor-pos-ver{grid-column:2 / -1}',
      '.jor-pos-ver summary{cursor:pointer;color:var(--io-azul-tx,#93C5FD);font-size:13px}',
      '.jor-pos-ver pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;padding:8px 10px;border-radius:10px;border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);color:var(--n-tx,#E5E7EB);font:inherit;font-size:13px}',
      '.jor-pos-link{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;overflow-wrap:anywhere;word-break:break-all;padding:8px 10px;border-radius:10px;border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);color:var(--n-tx,#E5E7EB);margin:6px 0}',
      '.jor-pos-ind{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;padding:6px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-pos-ind:first-of-type{border-top:0}',
      '.jor-pos-grupo{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:8px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-pos-grupo:first-of-type{border-top:0}',
      '.jor-pos-grupo b{display:block}',
      '.jor-pos-grupo small{display:block;color:var(--n-tx2,#B4C0D2);font-size:12.5px}',
      '.jor-pos-grupo .jor-pos-sit{grid-column:1;text-align:left}',
      '.jor-pos-av{display:block;color:var(--n-tx2,#B4C0D2);font-size:13px;margin:2px 0}',
      '@media (max-width:760px){',
      '.jor-pos-toque{grid-template-columns:24px minmax(0,1fr)}',
      '.jor-pos-sit{grid-column:2;text-align:left}',
      '.jor-pos-grupo{grid-template-columns:minmax(0,1fr)}',
      '}',
    ].join('\n');
    // O acompanhamento: a régua dos 3 pedidos (data à esquerda, cartão à direita) e os registros da usina.
    var pv = [
      '.jor-pv-regua{list-style:none;margin:10px 0 0;padding:0}',
      '.jor-pv-it{position:relative;display:grid;grid-template-columns:64px minmax(0,1fr);gap:0 14px;padding-bottom:14px}',
      '.jor-pv-it:last-child{padding-bottom:0}',
      '.jor-pv-it:not(:last-child)::before{content:"";position:absolute;left:31px;top:52px;bottom:4px;border-left:2px solid var(--n-bd)}',
      '.jor-pv-mk{display:flex;flex-direction:column;align-items:center;justify-content:center;height:52px;border-radius:12px;border:1px solid var(--n-bd2);background:var(--n-sf);font-variant-numeric:tabular-nums}',
      '.jor-pv-mk b{font-size:16px;font-weight:700;line-height:1.15;color:var(--io-titulo)}',
      '.jor-pv-mk small{font-size:11px;line-height:1.2;color:var(--n-tx3)}',
      '.jor-pv-it.feito .jor-pv-mk{background:var(--io-ok-sf);border-color:var(--io-ok-bd)}',
      '.jor-pv-it.feito .jor-pv-mk b{color:var(--io-ok-fg)}',
      '.jor-pv-it.atrasado .jor-pv-mk{background:var(--io-er-sf);border-color:var(--io-er-bd)}',
      '.jor-pv-it.atrasado .jor-pv-mk b{color:var(--io-er-tx)}',
      '.jor-pv-it.hoje .jor-pv-mk{background:var(--io-amarelo-sf);border-color:var(--io-amarelo)}',
      '.jor-pv-it.pedido .jor-pv-mk{background:var(--io-azul-sf);border-color:var(--n-bd2)}',
      '.jor-pv-card{min-width:0;padding:12px 14px 14px;border:1px solid var(--n-bd);border-radius:12px;background:var(--n-sf)}',
      '.jor-pv-it.atrasado .jor-pv-card{border-color:var(--io-er-bd)}',
      '.jor-pv-it.feito .jor-pv-card{background:var(--n-sf2)}',
      '.jor-pv-card-t{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:0 0 6px}',
      '.jor-pv-card-t h4{margin:0;font-size:15px;font-weight:700;color:var(--io-titulo)}',
      '.jor-pv-est{margin-left:auto;padding:2px 10px;border-radius:999px;background:var(--n-sf3);color:var(--n-tx2);font-size:12.5px;font-weight:700;white-space:nowrap}',
      '.jor-pv-est.ok{background:var(--io-ok-sf);color:var(--io-ok-fg)}',
      '.jor-pv-est.er{background:var(--io-er-sf);color:var(--io-er-tx)}',
      '.jor-pv-est.vez{background:var(--io-amarelo-sf);color:var(--io-titulo)}',
      '.jor-pv-est.pedido{background:var(--io-azul-sf);color:var(--io-azul-tx)}',
      '.jor-pv-txt{margin:0 0 10px;color:var(--n-tx2)}',
      '.jor-pv-ac{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.jor-pv-ac .jor-btn{min-height:44px}',
      '.jor-pv-ver{margin-top:8px}',
      '.jor-pv-ver summary{display:inline-flex;align-items:center;min-height:32px;cursor:pointer;color:var(--io-azul-tx);font-size:13px;font-weight:600}',
      '.jor-pv-msg{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;padding:10px 12px;border-radius:10px;border:1px solid var(--n-bd);background:var(--n-sf2);color:var(--n-tx);font:inherit;font-size:13px}',
      '.jor-pv-aviso{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:0 0 10px}',
      '.jor-pv-grade{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px 20px;margin-top:12px;padding-top:12px;border-top:1px solid var(--n-bd)}',
      '.jor-pv-grade>.jor-anexo{margin:0}',
      '.jor-pv-lado{display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.jor-pv-lado>.jor-btn{align-self:flex-start;min-height:44px}',
      '.jor-pv-campo{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--n-tx2)}',
      '.jor-pv-duo{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}',
      '.jor-pv-med-t{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;color:var(--n-tx2)}',
      '.jor-pv-pct{font-size:22px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}',
      '.jor-pv-pct.ok{color:var(--io-ok-fg)}',
      '.jor-pv-pct.av{color:var(--io-ambar-tx)}',
      '.jor-pv-barra{position:relative;height:10px;margin:8px 0 4px;border-radius:999px;background:var(--n-sf3)}',
      '.jor-pv-barra i{display:block;height:100%;border-radius:999px;background:var(--io-ok)}',
      '.jor-pv-barra.av i{background:var(--io-av,#B45309)}',
      '.jor-pv-90{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;border-radius:2px;background:var(--n-tx3)}',
      '.jor-pv-med .jor-nota,.jor-pv-eco .jor-nota{margin:2px 0 0}',
      '.jor-pv-reg .jor-bloco-t .jor-btn{margin-left:auto}',
      '.jor-pv-gar,.jor-pv-oc,.jor-pv-ind{list-style:none;margin:0;padding:0}',
      '.jor-pv-gar li,.jor-pv-ind li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--n-bd)}',
      '.jor-pv-gar li:first-child,.jor-pv-ind li:first-child,.jor-pv-oc li:first-child{border-top:0;padding-top:2px}',
      '.jor-pv-gar b,.jor-pv-ind b{display:block;color:var(--n-tx);font-weight:700}',
      '.jor-pv-gar small,.jor-pv-ind small{display:block;color:var(--n-tx3);font-size:12.5px}',
      '.jor-pv-venc{text-align:right;flex:none;font-variant-numeric:tabular-nums}',
      '.jor-pv-vencida{color:var(--io-er-tx)!important}',
      '.jor-pv-oc li{padding:10px 0;border-top:1px solid var(--n-bd)}',
      '.jor-pv-oc-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
      '.jor-pv-oc-t small{color:var(--n-tx3);font-size:12.5px;font-variant-numeric:tabular-nums}',
      '.jor-pv-oc-p{margin:4px 0 2px;color:var(--n-tx);overflow-wrap:anywhere}',
      '.jor-pv-oc-s{margin:0;color:var(--n-tx2);overflow-wrap:anywhere}',
      '.jor-pv-link{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:4px}',
      '.jor-pv-link .jor-pos-link{flex:1 1 260px;margin:0}',
      '@media (max-width:760px){',
      '.jor-pv-it{grid-template-columns:52px minmax(0,1fr);gap:0 10px}',
      '.jor-pv-it:not(:last-child)::before{left:25px}',
      '.jor-pv-mk b{font-size:14px}',
      '.jor-pv-grade{grid-template-columns:minmax(0,1fr)}',
      '.jor-pv-est{margin-left:0}',
      '}',
    ].join('\n');
    var st2 = document.createElement('style'); st2.id = 'jor-pv-css'; st2.textContent = H().comReserva ? H().comReserva(pv) : pv; document.head.appendChild(st2);
    var st = document.createElement('style'); st.id = 'jor-pos-css'; st.textContent = css; document.head.appendChild(st);
  }

  // ── Etapa 9 ────────────────────────────────────────────────────────────────
  function situacaoToque(t) {
    if (t.situacao === 'enviado') { var q = quando(t.enviado_em); return { txt: 'Enviado em ' + q.d + (q.h ? ' às ' + q.h : ''), cls: 'ok' }; }
    var cls = t.situacao === 'falhou' || t.situacao === 'nao_saiu' ? 'mau' : '';
    return { txt: SITUACAO[t.situacao] || 'Agendado', cls: cls };
  }
  function linhaToque(t, prim) {
    var rot = t.n === 1 ? 'Liberação' : t.n === 2 ? 'Aniversário de ' + prim : '1 ano da usina';
    var s = situacaoToque(t);
    var lin = el('div', 'jor-pos-toque');
    add(lin, el('span', 'jor-pos-n', t.n), el('span', 'jor-pos-rot', rot + (t.data ? ' · ' + dataBR(t.data) : '')), el('span', 'jor-pos-sit ' + s.cls, s.txt));
    if (t.texto) {
      var det = el('details', 'jor-pos-ver'); det.open = true; det.appendChild(el('summary', '', 'Ver a mensagem')); det.appendChild(el('pre', '', t.texto));
      lin.appendChild(det);
    }
    return lin;
  }

  function etapa9(esq, d, et, f3) {
    injetarCss(); var h = H();
    var prim = primeiro(d.card && d.card.cliente);
    // 1. O acompanhamento: os 3 pedidos em ordem de data, depois garantias, ocorrências e indicações.
    acompanhamento(esq, d, f3, prim);
    if (!f3Valido(f3)) {
      var pf = el('div', 'jor-bloco'); pf.appendChild(el('p', 'jor-erro', 'Não consegui ler as mensagens automáticas e o Book agora.')); pf.appendChild(btn('Tentar de novo', '', function () { h.recarregar(); }));
      esq.appendChild(pf); return;
    }
    // 2. As mensagens automáticas (a régua de 3 toques do servidor)
    var b1 = bloco('Mensagens automáticas');
    f3.toques.forEach(function (t) { b1.appendChild(linhaToque(t, prim)); });
    if (!f3.toques.length) b1.appendChild(el('p', 'jor-nota', 'Os toques aparecem quando a obra for finalizada.'));
    b1.appendChild(el('p', 'jor-nota', 'Os toques 2 e 3 se repetem todo ano. Saem das 9h às 20h, de segunda a sábado, e passam pelo anti-ban.'));
    esq.appendChild(b1);
    // O Book em PDF mora na Conclusão geral, logo acima (botão, quando foi gerado e o que o segura).
    esq.appendChild(el('p', 'jor-nota', 'Saiu da lista ativa na liberação. Segue na aba Pós-venda de Clientes.'));
  }

  // ── O acompanhamento do pós-venda (dados.posvenda e posvenda_info do /fase2) ─────────────────────────────────
  // Nada sai daqui sozinho: o WhatsApp só abre a conversa no aparelho de quem clicou, com o texto pronto.
  var RASC = { card: null, v: {} };
  function rasc(k, v) { if (RASC.card !== String(O().card)) RASC = { card: String(O().card), v: {} }; if (v === undefined) return RASC.v[k]; RASC.v[k] = v; return v; }
  function limpaRasc(chaves) { chaves.forEach(function (k) { delete RASC.v[k]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }
  function hojeYmd() { var d = O().dados; if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.hoje || ''))) return d.hoje; try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function soDig(s) { return String(s || '').replace(/\D/g, ''); }
  function telWa(d) {
    var x = soDig((d.dados_cliente && d.dados_cliente.telefone) || (d.card && d.card.telefone) || '');
    if (x.length === 10 || x.length === 11) return '55' + x;
    if ((x.length === 12 || x.length === 13) && x.indexOf('55') === 0) return x;
    return '';
  }
  function telTxt(s) { var x = soDig(s); if (x.length === 13 && x.indexOf('55') === 0) x = x.slice(2); if (x.length === 11) return '(' + x.slice(0, 2) + ') ' + x.slice(2, 7) + '-' + x.slice(7); if (x.length === 10) return '(' + x.slice(0, 2) + ') ' + x.slice(2, 6) + '-' + x.slice(6); return x; }
  function telMasc(s) { var x = soDig(s).slice(0, 11); if (x.length <= 2) return x.length ? '(' + x : ''; if (x.length <= 6) return '(' + x.slice(0, 2) + ') ' + x.slice(2); if (x.length <= 10) return '(' + x.slice(0, 2) + ') ' + x.slice(2, 6) + '-' + x.slice(6); return '(' + x.slice(0, 2) + ') ' + x.slice(2, 7) + '-' + x.slice(7); }
  function copiarTxt(t) {
    function plano() { try { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; } catch (e) { return false; } }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return plano(); });
    return Promise.resolve(plano());
  }
  function ajuda(txt) { var q = el('span', 'jor-q', '?'); q.title = txt; q.tabIndex = 0; q.setAttribute('role', 'img'); q.setAttribute('aria-label', 'Ajuda: ' + txt); return q; }
  function kwhTxt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' kWh'; }
  function numBr(s) { var t = String(s == null ? '' : s).trim(); if (!t) return null; t = t.indexOf(',') >= 0 ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\.(?=\d{3}(\D|$))/g, ''); var n = Number(t); return isFinite(n) && n >= 0 ? n : NaN; }
  function centsOk(s) { if (!String(s || '').trim()) return null; var v = H().cents(s); return typeof v === 'number' && !isNaN(v) && v >= 0 ? v : NaN; }
  function txtCents(c) { return (Math.round(Number(c) || 0) / 100).toFixed(2).replace('.', ','); }
  function pvVazio() { return { avaliacao: { pedida_em: null, avaliou_em: null }, geracao_mes1: { pedida_em: null, kwh: null, print_id: '' }, conta1: { pedida_em: null, arquivo_id: '', valor_antes_centavos: null, valor_depois_centavos: null, compensado_kwh: null }, ocorrencias: [], indicacoes: [] }; }
  function pvDe(f2) { var p = (f2 && f2.dados && f2.dados.posvenda) || {}; var v = pvVazio(); Object.keys(v).forEach(function (k) { if (p[k] != null) v[k] = Array.isArray(v[k]) ? (Array.isArray(p[k]) ? p[k] : []) : Object.assign(v[k], p[k]); }); return v; }
  function arqsSlot(f2, slot) { return ((f2 && f2.arquivos) || []).filter(function (a) { return a && a.slot === slot; }); }
  function podePv(f2) { return !!(f2 && f2.pode && Array.isArray(f2.pode.secoes) && f2.pode.secoes.indexOf('posvenda') >= 0); }

  /** PUT .../fase2/posvenda com a versão lida e o pós-venda inteiro (o servidor dá id e data às linhas novas). */
  function salvarPv(mudar, aviso) {
    var h = H(); var f2 = O().fase2; var pv = clone(pvDe(f2)); mudar(pv);
    var versao = (f2 && f2.versoes && Number(f2.versoes.posvenda)) || 0;
    return h.api(base() + '/fase2/posvenda', 'PUT', { versao: versao, dados: pv }, 60000).then(function (r) {
      if (r.status === 200 && r.json && r.json.ok !== false) { if (aviso) h.toast(aviso); return h.recarregar().then(function () { return r; }); }
      if (r.status === 409 && r.json && r.json.mudou) { h.toast(msgSrv(r, 'Outra pessoa mexeu no pós-venda agora. A tela vai recarregar.')); h.recarregar(); return r; }
      h.toast(msgSrv(r, 'Não consegui salvar agora. Tente de novo.')); return r;
    });
  }

  /** O "quando" de um pedido: feito, pedido, atrasado, hoje ou a data. */
  function estadoPedido(quandoYmd, feito, pedidaEm, hoje) {
    if (feito) return { t: feito, cls: 'ok', k: 'feito' };
    if (pedidaEm) return { t: 'Pedido em ' + dataCurta(pedidaEm), cls: 'pedido', k: 'pedido' };
    if (!quandoYmd) return { t: 'Depois da liberação', cls: '', k: 'sem' };
    if (quandoYmd < hoje) return { t: 'Atrasado desde ' + dataCurta(quandoYmd), cls: 'er', k: 'atrasado' };
    if (quandoYmd === hoje) return { t: 'Hoje', cls: 'vez', k: 'hoje' };
    return { t: 'Em ' + dataCurta(quandoYmd), cls: '', k: 'futuro' };
  }
  function dataCurta(ymd) { var s = String(ymd || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) : ''; }

  /** As ações de pedir: WhatsApp (abre a conversa do cliente com o texto) e Copiar. As duas gravam `pedida_em`. */
  function botoesPedir(d, chave, texto, rotWa, principal, aviso) {
    var h = H(); var tel = telWa(d); var cx = el('div', 'jor-pv-ac');
    var pre = el('pre', 'jor-pv-msg', texto); pre.hidden = true;
    function marca() { return salvarPv(function (pv) { pv[chave].pedida_em = hojeYmd(); }, aviso); }
    if (tel) {
      var bw = btn(rotWa, principal ? 'jor-btn-pri' : '', function () {
        try { window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(texto), '_blank', 'noopener'); } catch (e) { h.toast('Não consegui abrir o WhatsApp.'); return; }
        marca();
      });
      cx.appendChild(bw);
    }
    cx.appendChild(btn('Copiar', tel || !principal ? '' : 'jor-btn-pri', function () {
      copiarTxt(texto).then(function (ok) { if (!ok) pre.hidden = false; h.toast(ok ? 'Mensagem copiada. Cole na conversa com o cliente.' : 'Não consegui copiar. Selecione a mensagem abaixo.'); marca(); });
    }));
    if (!tel) cx.appendChild(el('span', 'jor-nota', 'Sem telefone do cliente: só dá para copiar.'));
    var vs = el('details', 'jor-pv-ver'); vs.appendChild(el('summary', '', 'Ver a mensagem')); vs.appendChild(el('pre', 'jor-pv-msg', texto));
    return [cx, pre, vs];
  }

  /** Os 3 pedidos ao cliente e o estado de cada um (a régua e o ponto da aba usam a mesma conta). */
  function pedidosPos(f2) {
    var pv = pvDe(f2); var q = (f2.posvenda_info || {}).quando || {}; var hoje = hojeYmd();
    var ger = pv.geracao_mes1, co = pv.conta1, av = pv.avaliacao;
    var temPrint = arqsSlot(f2, 'pos_geracao').length > 0, temConta = arqsSlot(f2, 'pos_conta').length > 0;
    var feitoGer = Number(ger.kwh) > 0 && temPrint;
    var feitoConta = temConta && Number(co.valor_antes_centavos) > 0 && co.valor_depois_centavos != null;
    return [
      { k: 'avaliacao', ord: 0, titulo: 'Avaliação no Google', dias: '+7 dias', quando: q.avaliacao, est: estadoPedido(q.avaliacao, av.avaliou_em ? 'Avaliou em ' + dataCurta(av.avaliou_em) : '', av.pedida_em, hoje), corpo: cartaoAvaliacao },
      { k: 'geracao_mes1', ord: 1, titulo: 'Geração do 1º mês', dias: '+30 dias', quando: q.geracao_mes1, est: estadoPedido(q.geracao_mes1, feitoGer ? 'Recebida' : '', ger.pedida_em, hoje), corpo: cartaoGeracao },
      { k: 'conta1', ord: 2, titulo: 'Primeira conta de luz', dias: '+30 dias', quando: q.conta1, est: estadoPedido(q.conta1, feitoConta ? 'Recebida' : '', co.pedida_em, hoje), corpo: cartaoConta },
    ];
  }
  /** Pedido que já venceu (hoje, atrasado ou pedido sem resposta) e não chegou: falta, mas não trava nada. Amarelo. */
  function pedidoEmFalta(est) { return est.k === 'atrasado' || est.k === 'hoje' || est.k === 'pedido'; }
  function pendenciaPos(f2) { if (!f2 || !f2.dados) return ''; return pedidosPos(f2).some(function (p) { return pedidoEmFalta(p.est); }) ? 'op' : ''; }

  function acompanhamento(esq, d, f3, prim) {
    var h = H(); var f2 = O().fase2;
    if (!f2 || !f2.dados) {
      var pf = el('div', 'jor-bloco'); pf.appendChild(el('div', 'jor-bloco-t', 'Acompanhamento do cliente'));
      pf.appendChild(el('p', 'jor-erro', 'Não consegui ler o pós-venda agora.')); pf.appendChild(btn('Tentar de novo', '', function () { h.recarregar(); }));
      esq.appendChild(pf); return;
    }
    var pv = pvDe(f2); var info = f2.posvenda_info || {}; var msg = info.mensagens || {}; var pode = podePv(f2); var hoje = hojeYmd();
    var PED = pedidosPos(f2);
    PED.sort(function (a, b) { return String(a.quando || '9') < String(b.quando || '9') ? -1 : String(a.quando || '9') > String(b.quando || '9') ? 1 : a.ord - b.ord; });
    var feitos = PED.filter(function (p) { return p.est.k === 'feito'; }).length;
    var atras = PED.filter(function (p) { return p.est.k === 'atrasado'; }).length;

    var b = el('div', 'jor-bloco jor-pv');
    var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', 'Pedidos ao cliente'));
    t.appendChild(h.etq(feitos + ' de 3', feitos === 3 ? 'ok' : atras ? 'av' : ''));
    t.appendChild(ajuda('Cada pedido tem a sua data, contada da liberação da usina. Quem pede é você, pela sua conversa com o cliente.'));
    b.appendChild(t);
    b.appendChild(el('p', 'jor-nota', info.liberada_em ? 'Usina liberada em ' + dataBR(info.liberada_em) + '.' : 'As datas aparecem quando a usina for liberada.'));
    if (!pode) b.appendChild(el('p', 'jor-nota', 'Só a Giovanna, o ADM e quem vendeu registram o pós-venda.'));
    var ol = el('ol', 'jor-pv-regua');
    PED.forEach(function (p) {
      var li = el('li', 'jor-pv-it ' + p.est.k);
      var mk = el('div', 'jor-pv-mk'); mk.setAttribute('aria-hidden', 'true');
      mk.appendChild(el('b', '', p.quando ? dataCurta(p.quando) : '--')); mk.appendChild(el('small', '', p.dias)); li.appendChild(mk);
      var c = el('div', 'jor-pv-card'); h.marcaFalta(c, pedidoEmFalta(p.est) ? 'op' : '');
      var ct = el('div', 'jor-pv-card-t'); ct.appendChild(el('h4', '', p.titulo)); ct.appendChild(el('span', 'jor-pv-est ' + p.est.cls, p.est.t)); c.appendChild(ct);
      p.corpo(c, d, f2, pv, info, msg, pode, p.est);
      li.appendChild(c); ol.appendChild(li);
    });
    b.appendChild(ol); esq.appendChild(b);
    // Os registros da usina: sem data marcada.
    esq.appendChild(cartaoGarantias(info, hoje));
    esq.appendChild(cartaoOcorrencias(pv, pode, hoje));
    esq.appendChild(cartaoIndicacoes(d, pv, pode, f3, prim));
  }

  function cartaoAvaliacao(c, d, f2, pv, info, msg, pode, est) {
    var h = H(); var av = pv.avaliacao;
    if (info.falta_link_avaliacao) {
      var a = el('p', 'jor-aviso jor-pv-aviso', 'Cadastre o link de avaliação nos Ajustes.');
      if (typeof admOk === 'function' && admOk() && window.Jornada.dinheiro && window.Jornada.dinheiro.abrirAjustes) a.appendChild(btn('Abrir os Ajustes', 'jor-btn-link', function () { window.Jornada.dinheiro.abrirAjustes(); }));
      c.appendChild(a);
    }
    if (av.avaliou_em) return;
    c.appendChild(el('p', 'jor-pv-txt', av.pedida_em ? 'Pedido em ' + dataBR(av.pedida_em) + '. Quando ele avaliar, marque aqui.' : 'Peça uma avaliação no Google uma semana depois da liberação.'));
    if (!pode) return;
    var partes = botoesPedir(d, 'avaliacao', msg.avaliacao || '', av.pedida_em ? 'Pedir de novo' : 'Pedir no WhatsApp', !av.pedida_em, 'Pedido marcado.');
    if (av.pedida_em) {
      var bm = btn('Marcar como avaliou', 'jor-btn-pri', function () { bm.disabled = true; salvarPv(function (x) { x.avaliacao.avaliou_em = hojeYmd(); }, 'Avaliação registrada.').then(function () { bm.disabled = false; }); });
      partes[0].insertBefore(bm, partes[0].firstChild);
    }
    partes.forEach(function (x) { c.appendChild(x); });
  }

  /** A comparação com o esperado: a barra, a marca de 90% e a frase. Verde a partir de 90%, âmbar abaixo. */
  function medidor(kwh, esperado) {
    var cx = el('div', 'jor-pv-med');
    function pinta(v) {
      cx.replaceChildren();
      if (!esperado) { cx.appendChild(el('p', 'jor-nota', 'A proposta não tem a geração esperada para comparar.')); return; }
      if (!(v > 0)) { cx.appendChild(el('p', 'jor-nota', 'Esperado pela proposta: ' + kwhTxt(esperado) + ' por mês.')); return; }
      var pct = Math.round(100 * v / esperado); var bom = pct >= 90;
      var linha = el('div', 'jor-pv-med-t'); linha.appendChild(el('b', 'jor-pv-pct ' + (bom ? 'ok' : 'av'), pct + '%')); linha.appendChild(el('span', '', 'do esperado · ' + kwhTxt(v) + ' de ' + kwhTxt(esperado)));
      cx.appendChild(linha);
      var br = el('div', 'jor-pv-barra ' + (bom ? 'ok' : 'av')); br.setAttribute('role', 'meter'); br.setAttribute('aria-valuemin', '0'); br.setAttribute('aria-valuemax', '120'); br.setAttribute('aria-valuenow', String(pct)); br.setAttribute('aria-label', 'Geração do mês contra o esperado');
      var fi = el('i'); fi.style.width = Math.min(100, pct / 1.2) + '%'; br.appendChild(fi); var m90 = el('span', 'jor-pv-90'); m90.style.left = (90 / 1.2) + '%'; br.appendChild(m90); cx.appendChild(br);
      cx.appendChild(el('p', 'jor-nota', bom ? 'Gerando o esperado.' : 'Abaixo de 90% do esperado. Vale conferir sombra, sujeira e o inversor.'));
    }
    pinta(kwh); cx.pinta = pinta; return cx;
  }

  function cartaoGeracao(c, d, f2, pv, info, msg, pode, est) {
    var h = H(); var g = pv.geracao_mes1; var temPrint = arqsSlot(f2, 'pos_geracao').length > 0;
    if (est.k !== 'feito') c.appendChild(el('p', 'jor-pv-txt', g.pedida_em ? 'Pedido em ' + dataBR(g.pedida_em) + '. Anexe o print e digite os kWh do mês.' : 'Peça o print do aplicativo do inversor com a geração do primeiro mês.'));
    if (pode && est.k !== 'feito') botoesPedir(d, 'geracao_mes1', msg.geracao_mes1 || '', g.pedida_em ? 'Pedir de novo' : 'Pedir no WhatsApp', !g.pedida_em, 'Pedido marcado.').forEach(function (x) { c.appendChild(x); });
    var grade = el('div', 'jor-pv-grade');
    grade.appendChild(h.anexo('pos_geracao', 'Print da geração', temPrint, { nivel: 'op', rotFalta: 'Falta', semContorno: true }));
    var lado = el('div', 'jor-pv-lado');
    var r0 = rasc('kwh'); var kw = el('input', 'jor-in'); kw.type = 'text'; kw.inputMode = 'decimal'; kw.autocomplete = 'off'; kw.value = r0 !== undefined ? r0 : (Number(g.kwh) > 0 ? String(Math.round(g.kwh)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''); kw.disabled = !pode; kw.placeholder = 'Ex.: 1.020';
    var lb = el('label', 'jor-pv-campo', 'Geração do mês (kWh)'); lb.appendChild(kw); lado.appendChild(lb);
    var med = medidor(numBr(kw.value), info.esperado_kwh_mes); lado.appendChild(med);
    var er = el('p', 'jor-erro'); er.setAttribute('role', 'status'); lado.appendChild(er);
    kw.addEventListener('input', function () { rasc('kwh', kw.value); var v = numBr(kw.value); med.pinta(v); er.textContent = (v !== null && isNaN(v)) ? 'Use só números, como 1.020.' : ''; });
    if (pode) {
      var sv = btn('Salvar a geração', '', function () {
        var v = numBr(kw.value); if (v !== null && isNaN(v)) { er.textContent = 'Use só números, como 1.020.'; return; }
        var fotos = arqsSlot(O().fase2, 'pos_geracao'); sv.disabled = true;
        salvarPv(function (x) { x.geracao_mes1.kwh = v === null ? null : Math.round(v); x.geracao_mes1.print_id = fotos.length ? String(fotos[fotos.length - 1].id) : ''; }, 'Geração salva.').then(function (r) { sv.disabled = false; if (r && r.status === 200) limpaRasc(['kwh']); });
      });
      lado.appendChild(sv);
    }
    grade.appendChild(lado); c.appendChild(grade);
  }

  function cartaoConta(c, d, f2, pv, info, msg, pode, est) {
    var h = H(); var co = pv.conta1; var temConta = arqsSlot(f2, 'pos_conta').length > 0;
    if (est.k !== 'feito') c.appendChild(el('p', 'jor-pv-txt', co.pedida_em ? 'Pedido em ' + dataBR(co.pedida_em) + '. Anexe a conta e digite os dois valores.' : 'Peça a primeira conta de luz depois da liberação, em foto ou PDF.'));
    if (pode && est.k !== 'feito') botoesPedir(d, 'conta1', msg.conta1 || '', co.pedida_em ? 'Pedir de novo' : 'Pedir no WhatsApp', !co.pedida_em, 'Pedido marcado.').forEach(function (x) { c.appendChild(x); });
    var grade = el('div', 'jor-pv-grade');
    grade.appendChild(h.anexo('pos_conta', 'Conta de luz', temConta, { nivel: 'op', rotFalta: 'Falta', semContorno: true }));
    var lado = el('div', 'jor-pv-lado');
    function campoR(k, rot, ex, val) {
      var r0 = rasc(k); var i = el('input', 'jor-in'); i.type = 'text'; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.placeholder = ex; i.disabled = !pode;
      i.value = r0 !== undefined ? r0 : val; var lb = el('label', 'jor-pv-campo', rot); lb.appendChild(i);
      i.addEventListener('input', function () { rasc(k, i.value); conta(); }); return { lb: lb, i: i };
    }
    var an = campoR('antes', 'Antes da usina (R$)', 'Ex.: 680,00', Number(co.valor_antes_centavos) > 0 ? txtCents(co.valor_antes_centavos) : '');
    var de = campoR('depois', 'Com a usina (R$)', 'Ex.: 98,40', co.valor_depois_centavos != null ? txtCents(co.valor_depois_centavos) : '');
    var kc = campoR('comp', 'Energia compensada (kWh, opcional)', 'Ex.: 640', Number(co.compensado_kwh) > 0 ? String(co.compensado_kwh) : '');
    var duo = el('div', 'jor-pv-duo'); add(duo, an.lb, de.lb); add(lado, duo, kc.lb);
    var eco = el('div', 'jor-pv-eco'); eco.setAttribute('aria-live', 'polite'); lado.appendChild(eco);
    var er = el('p', 'jor-erro'); er.setAttribute('role', 'status'); lado.appendChild(er);
    function conta() {
      var a = centsOk(an.i.value), b = centsOk(de.i.value); eco.replaceChildren(); er.textContent = '';
      if ((a !== null && isNaN(a)) || (b !== null && isNaN(b))) { er.textContent = 'Use um valor em reais, como 680,00.'; return; }
      if (!(a > 0) || b === null) { eco.appendChild(el('p', 'jor-nota', 'Digite os dois valores para ver a economia.')); return; }
      var dif = a - b; var pct = Math.round(100 * dif / a);
      var linha = el('div', 'jor-pv-med-t'); linha.appendChild(el('b', 'jor-pv-pct ' + (dif > 0 ? 'ok' : 'av'), (dif >= 0 ? '' : '-') + h.reais(Math.abs(dif))));
      linha.appendChild(el('span', '', dif > 0 ? 'de economia no mês · ' + pct + '% a menos' : 'A conta não caiu. Vale conferir a compensação.'));
      eco.appendChild(linha);
    }
    conta();
    if (pode) {
      var sv = btn('Salvar a conta', '', function () {
        var a = centsOk(an.i.value), b = centsOk(de.i.value), k = numBr(kc.i.value);
        if ((a !== null && isNaN(a)) || (b !== null && isNaN(b))) { er.textContent = 'Use um valor em reais, como 680,00.'; return; }
        if (k !== null && isNaN(k)) { er.textContent = 'Use só números na energia compensada.'; return; }
        var arqs = arqsSlot(O().fase2, 'pos_conta'); sv.disabled = true;
        salvarPv(function (x) { x.conta1.valor_antes_centavos = a; x.conta1.valor_depois_centavos = b; x.conta1.compensado_kwh = k === null ? null : Math.round(k); x.conta1.arquivo_id = arqs.length ? String(arqs[arqs.length - 1].id) : ''; }, 'Conta salva.')
          .then(function (r) { sv.disabled = false; if (r && r.status === 200) limpaRasc(['antes', 'depois', 'comp']); });
      });
      lado.appendChild(sv);
    }
    grade.appendChild(lado); c.appendChild(grade);
  }

  function cartaoGarantias(info, hoje) {
    var g = info.garantias || { itens: [] }; var itens = Array.isArray(g.itens) ? g.itens.slice() : [];
    itens.sort(function (a, b) { return String(a.vence_em) < String(b.vence_em) ? -1 : 1; });
    var b = el('div', 'jor-bloco jor-pv-reg'); var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', 'Garantias'));
    t.appendChild(ajuda('Placas e inversor contam da liberação. A instalação conta do termo de entrega assinado.')); b.appendChild(t);
    if (!itens.length) { b.appendChild(el('p', 'jor-nota', 'As garantias aparecem quando a usina for liberada e a Compra tiver a garantia de cada equipamento.')); return b; }
    var ul = el('ul', 'jor-pv-gar');
    itens.forEach(function (x) {
      var li = el('li'); var venc = String(x.vence_em || '') < hoje;
      var a = el('div'); a.appendChild(el('b', '', x.rotulo)); a.appendChild(el('small', '', (x.meses % 12 === 0 ? H().plural(x.meses / 12, 'ano', 'anos') : H().plural(x.meses, 'mês', 'meses')) + ', desde ' + (x.base === 'entrega' ? 'a entrega' : 'a liberação') + ' em ' + dataBR(x.inicio)));
      var v = el('div', 'jor-pv-venc'); v.appendChild(el('small', '', venc ? 'Venceu em' : 'Vence em')); v.appendChild(el('b', venc ? 'jor-pv-vencida' : '', dataBR(x.vence_em)));
      add(li, a, v); ul.appendChild(li);
    });
    b.appendChild(ul);
    var pe = [g.registrada_em ? 'Registrada no fabricante em ' + dataBR(g.registrada_em) + '.' : 'Ainda não registrada no fabricante.', g.treinado ? 'Cliente treinado no app.' : 'Cliente ainda não treinado no app.'];
    b.appendChild(el('p', 'jor-nota', pe.join(' ')));
    return b;
  }

  function cartaoOcorrencias(pv, pode, hoje) {
    var h = H(); var oc = pv.ocorrencias || [];
    var abertas = oc.filter(function (x) { return !x.resolvido_em; }).length;
    var b = el('div', 'jor-bloco jor-pv-reg'); var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', 'Ocorrências'));
    if (oc.length) t.appendChild(h.etq(abertas ? h.plural(abertas, 'aberta', 'abertas') : 'Todas resolvidas', abertas ? 'av' : 'ok'));
    if (pode && oc.length < 50) t.appendChild(btn('Registrar ocorrência', '', function () { ocorrenciaDialogo(hoje); }));
    b.appendChild(t);
    if (!oc.length) { b.appendChild(el('p', 'jor-nota', 'Nenhum problema registrado depois da liberação.')); return b; }
    var ul = el('ul', 'jor-pv-oc');
    oc.slice().sort(function (a, c) { return (a.resolvido_em ? 1 : 0) - (c.resolvido_em ? 1 : 0) || (String(a.em) < String(c.em) ? 1 : -1); }).forEach(function (x) {
      var li = el('li', x.resolvido_em ? 'ok' : 'aberta');
      var tp = el('div', 'jor-pv-oc-t'); tp.appendChild(el('small', '', dataBR(x.em))); tp.appendChild(h.etq(x.resolvido_em ? 'Resolvida em ' + dataCurta(x.resolvido_em) : 'Aberta', x.resolvido_em ? 'ok' : 'av'));
      li.appendChild(tp); li.appendChild(el('p', 'jor-pv-oc-p', x.problema));
      if (x.resolvido_em && x.solucao) li.appendChild(el('p', 'jor-pv-oc-s', 'Solução: ' + x.solucao));
      if (!x.resolvido_em && pode) li.appendChild(btn('Resolver', 'jor-btn-link', function () { resolverDialogo(x, hoje); }));
      ul.appendChild(li);
    });
    b.appendChild(ul); return b;
  }
  function ocorrenciaDialogo(hoje) {
    var h = H(); var ta = null, info = null;
    h.dialogo('Registrar ocorrência', function (box) {
      box.appendChild(el('p', 'jor-nota', 'Data: hoje, ' + dataBR(hoje) + '.'));
      ta = el('textarea', 'jor-ta'); ta.maxLength = 400; ta.rows = 3; ta.placeholder = 'Ex.: inversor desligou à tarde';
      var lb = el('label', 'jor-pv-campo', 'O problema'); lb.appendChild(ta); box.appendChild(lb);
      info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); box.appendChild(info);
      return { foco: ta };
    }, 'Registrar', function (b) {
      if (ta.value.trim().length < 3) { info.textContent = 'Diga qual foi o problema.'; return; }
      b.disabled = true;
      salvarPv(function (x) { x.ocorrencias.push({ id: null, em: hoje, problema: ta.value.trim(), resolvido_em: null, solucao: '' }); }, 'Ocorrência registrada.').then(function (r) { if (r && r.status === 200) H().fecharDlg(); else { b.disabled = false; info.textContent = msgSrv(r, 'Não consegui salvar agora.'); } });
    });
  }
  function resolverDialogo(oc, hoje) {
    var h = H(); var ta = null, dt = null, info = null;
    h.dialogo('Resolver ocorrência', function (box) {
      box.appendChild(el('p', 'jor-pv-oc-p', oc.problema));
      ta = el('textarea', 'jor-ta'); ta.maxLength = 400; ta.rows = 3; ta.placeholder = 'Ex.: religado o disjuntor CA e conferido o Wi-Fi';
      var lb = el('label', 'jor-pv-campo', 'O que foi feito'); lb.appendChild(ta); box.appendChild(lb);
      dt = el('input', 'jor-in'); dt.type = 'date'; dt.value = hoje; dt.max = hoje; var ld = el('label', 'jor-pv-campo', 'Resolvida em'); ld.appendChild(dt); box.appendChild(ld);
      info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); box.appendChild(info);
      return { foco: ta };
    }, 'Resolver', function (b) {
      if (ta.value.trim().length < 3) { info.textContent = 'Diga o que foi feito.'; return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt.value)) { info.textContent = 'Escolha a data.'; return; }
      b.disabled = true;
      salvarPv(function (x) { x.ocorrencias.forEach(function (y) { if (y.id === oc.id) { y.resolvido_em = dt.value; y.solucao = ta.value.trim(); } }); }, 'Ocorrência resolvida.').then(function (r) { if (r && r.status === 200) H().fecharDlg(); else { b.disabled = false; info.textContent = msgSrv(r, 'Não consegui salvar agora.'); } });
    });
  }

  function cartaoIndicacoes(d, pv, pode, f3, prim) {
    var h = H(); var man = pv.indicacoes || []; var link = f3Valido(f3) && f3.link ? f3.link : ''; var pelo = f3Valido(f3) && Array.isArray(f3.indicacoes) ? f3.indicacoes : [];
    var b = el('div', 'jor-bloco jor-pv-reg'); var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', 'Indicações de ' + (prim || 'cliente')));
    if (man.length + pelo.length) t.appendChild(h.etq(String(man.length + pelo.length), ''));
    t.appendChild(ajuda('O prêmio de quem indica é digitado e entra como gasto, com comprovante, na obra nova, quando a indicação vira venda. Nunca entra nesta obra.'));
    if (pode && man.length < 50) t.appendChild(btn('Adicionar indicação', '', function () { indicacaoDialogo(); }));
    b.appendChild(t);
    if (link) {
      var lk = el('div', 'jor-pv-link'); lk.appendChild(el('span', 'jor-pos-link', link)); lk.appendChild(btn('Copiar o link', '', function () { copiar(link); }));
      b.appendChild(lk); b.appendChild(el('p', 'jor-nota', 'Quem chega pelo link cai na Agenda da Nilce como Indicação de ' + prim + '.'));
    }
    if (!man.length && !pelo.length) { b.appendChild(el('p', 'jor-nota', 'Nenhuma indicação ainda.')); }
    var ul = el('ul', 'jor-pv-ind');
    man.forEach(function (x) {
      var li = el('li'); var a = el('div'); a.appendChild(el('b', '', x.nome)); a.appendChild(el('small', '', [telTxt(x.telefone), 'anotada em ' + dataCurta(x.em)].filter(Boolean).join(' · ')));
      li.appendChild(a);
      if (pode) li.appendChild(btn('Tirar', 'jor-btn-link', function () { tirarIndicacao(x); }));
      ul.appendChild(li);
    });
    pelo.forEach(function (x) {
      var li = el('li'); var a = el('div'); var q2 = quando(x.em); a.appendChild(el('b', '', x.cliente || 'Sem nome'));
      var sit = x.situacao === 'vendida' ? 'Virou venda' + (x.codigo ? ' ' + x.codigo : '') : x.situacao === 'perdida' ? 'Não virou venda' : 'Na agenda de ' + h.nomeBonito(x.vendedor || 'nilce');
      a.appendChild(el('small', '', 'Pelo link em ' + q2.d + ' · ' + sit)); li.appendChild(a);
      if (x.situacao === 'vendida' && x.card) li.appendChild(btn('Abrir', '', function () { if (window.Jornada && window.Jornada.abrirObra) window.Jornada.abrirObra(x.card); }));
      ul.appendChild(li);
    });
    if (ul.firstChild) b.appendChild(ul);
    if (f3Valido(f3)) {
      var pl = f3.placar || { indicacoes: 0, vendas: 0 }; var ge = f3.geral || {};
      var pe = (prim || 'Cliente') + ': ' + h.plural(pl.indicacoes || 0, 'indicação', 'indicações') + ' pelo link, ' + h.plural(pl.vendas || 0, 'venda', 'vendas') + '.';
      if (f3.geral) pe += ' Geral: ' + h.plural(ge.na_regua || 0, 'cliente', 'clientes') + ' na régua, ' + h.plural(ge.indicacoes_mes || 0, 'indicação', 'indicações') + ' no mês, ' + ((ge.vendas_mes || 0) === 1 ? '1 virou venda' : (ge.vendas_mes || 0) + ' viraram venda') + '.';
      b.appendChild(el('p', 'jor-nota', pe));
    }
    return b;
  }
  function indicacaoDialogo() {
    var h = H(); var nm = null, tl = null, info = null;
    h.dialogo('Adicionar indicação', function (box) {
      nm = el('input', 'jor-in'); nm.type = 'text'; nm.maxLength = 80; nm.autocomplete = 'off'; var l1 = el('label', 'jor-pv-campo', 'Nome'); l1.appendChild(nm);
      tl = el('input', 'jor-in'); tl.type = 'tel'; tl.inputMode = 'tel'; tl.autocomplete = 'off'; tl.placeholder = '(34) 99999-0000'; var l2 = el('label', 'jor-pv-campo', 'Telefone'); l2.appendChild(tl);
      tl.addEventListener('input', function () { tl.value = telMasc(tl.value); });
      add(box, l1, l2); info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); box.appendChild(info);
      return { foco: nm };
    }, 'Adicionar', function (b) {
      var n = soDig(tl.value).length;
      if (nm.value.trim().length < 2) { info.textContent = 'Diga o nome de quem foi indicado.'; return; }
      if (n && (n < 10 || n > 11)) { info.textContent = 'Telefone com DDD, 10 ou 11 dígitos.'; return; }
      b.disabled = true;
      salvarPv(function (x) { x.indicacoes.push({ id: null, nome: nm.value.trim(), telefone: soDig(tl.value), em: hojeYmd() }); }, 'Indicação anotada.').then(function (r) { if (r && r.status === 200) H().fecharDlg(); else { b.disabled = false; info.textContent = msgSrv(r, 'Não consegui salvar agora.'); } });
    });
  }
  function tirarIndicacao(ind) {
    var h = H();
    h.dialogo('Tirar a indicação', function (box) { box.appendChild(el('p', '', 'Tirar ' + ind.nome + ' da lista?')); return {}; }, 'Tirar', function (b) {
      b.disabled = true;
      salvarPv(function (x) { x.indicacoes = x.indicacoes.filter(function (y) { return y.id !== ind.id; }); }, 'Indicação tirada.').then(function (r) { if (r && r.status === 200) H().fecharDlg(); else b.disabled = false; });
    });
  }

  function copiar(link) {
    var h = H();
    function falhou() { h.toast('Não consegui copiar. Selecione o link e copie à mão.'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { h.toast('Link copiado.'); }, falhou);
      else falhou();
    } catch (e) { falhou(); }
  }

  function abrirUrl(url) {
    // Só abre endereço https: o que vier de outro jeito (javascript:, data:, http:) não passa.
    if (typeof url !== 'string' || url.indexOf('https://') !== 0) { H().toast('Não deu para abrir o PDF.'); return; }
    try { window.open(url, '_blank', 'noopener'); } catch (e) { H().toast('Não consegui abrir o PDF. Tente de novo.'); }
  }

  // ── O Book em PDF (feito no servidor) ──────────────────────────────────────
  function bookPdf(card, botao, opts) {
    var h = H(); opts = opts || {}; var silencioso = !!opts.silencioso;
    if (botao) botao.disabled = true;
    h.toast('Gerando o Book em PDF.');
    var rota = '/gerador/jornada-solar/obra/' + encodeURIComponent(card || O().card) + '/book/pdf';
    return h.api(rota, 'POST', {}, 120000).then(function (r) {
      if (botao) botao.disabled = false;
      var antiga = document.getElementById('jor-pos-trava'); if (antiga) antiga.remove();
      if (r.status === 200 && r.json && r.json.ok !== false) {
        h.toast('Book em PDF pronto.'); if (!silencioso && r.json.url) abrirUrl(r.json.url);
        h.recarregar();
        return;
      }
      if (r.status === 409 && r.json && Array.isArray(r.json.trava) && r.json.trava.length) {
        h.toast('O Book ainda não pode sair: ' + r.json.trava.join(' '));
        if (botao && botao.parentNode) {
          var ul = el('ul', 'jor-din-ul'); ul.id = 'jor-pos-trava'; r.json.trava.forEach(function (t) { ul.appendChild(el('li', '', t)); });
          botao.parentNode.insertBefore(ul, botao.nextSibling);
        }
        return;
      }
      h.toast(msgSrv(r, 'Não consegui gerar o Book agora. Tente de novo.'));
    });
  }

  // ── Etapa 2 da obra nova: veio por indicação ───────────────────────────────
  function indicacao(esq, d, f3) {
    if (!f3 || !f3.veio_de) return;
    injetarCss(); var h = H(); var v = f3.veio_de;
    var b = bloco('Veio por indicação');
    b.appendChild(el('p', '', 'Indicação de ' + (v.nome || 'cliente') + ' (' + (v.codigo || '*') + ').'));
    if (f3.premio && f3.premio.lancado) b.appendChild(el('p', 'jor-ok', 'Prêmio lançado, com comprovante.'));
    else if (f3.pode && f3.pode.premio) {
      b.appendChild(btn('Lançar o prêmio de quem indicou', 'jor-btn-pri', function () {
        if (window.Jornada.dinheiro && window.Jornada.dinheiro.lancar) window.Jornada.dinheiro.lancar({ tipo: 'saida', etapa: 2, categoria: 'premio_indicacao' });
      }));
    } else b.appendChild(el('p', 'jor-nota', 'Só a Giovanna e o Thiago lançam o prêmio.'));
    b.appendChild(el('p', 'jor-nota', 'Prêmio de quem indica: o valor é digitado na hora.'));
    esq.appendChild(b); void h;
  }

  // ── O cartão "Prazo e cobrança": avisos e o próximo ────────────────────────
  function avisos(pz, f3, n) {
    if (!f3Valido(f3) || !pz || n > 8) return;
    var lista = (Array.isArray(f3.avisos) ? f3.avisos : []).filter(function (a) { return a && (a.tipo === 'venda' ? n === 1 : a.etapa === n); }).slice(0, 5);
    lista.forEach(function (a) {
      var q = quando(a.em); var extra = a.situacao === 'falhou' ? ' · não saiu' : a.situacao === 'pendente' ? ' · pendente' : '';
      pz.appendChild(el('span', 'jor-pos-av', q.d + ' ' + q.h + ' · ' + (TIPO_AVISO[a.tipo] || a.tipo) + ' · ' + H().nomeBonito(a.para) + extra));
    });
    var gr = f3.grupos || {};
    var fim = f3.proximo || (gr.fila === false ? 'Mensagens desligadas em Ajustes.' : '');
    if (fim) pz.appendChild(el('p', 'jor-nota', fim));
  }

  // ── Etapa 8: a mensagem da liberação ───────────────────────────────────────
  function mensagemLiberacao(alvo, f3) {
    injetarCss();
    var t = f3Valido(f3) ? f3.toques.filter(function (x) { return x.n === 1; })[0] : null;
    if (!t) { alvo.appendChild(el('p', 'jor-nota', 'A mensagem sai quando a obra for finalizada e o Book em PDF estiver pronto, das 9h às 20h, de segunda a sábado.')); return; }
    alvo.appendChild(linhaToque(t, ''));
  }

  // ── Ajustes: o painel Mensagens (só o ADM) ─────────────────────────────────
  var MSG = { dados: null };
  function mensagens(alvo) {
    if (!ehAdm() || !alvo) return;
    injetarCss(); var h = H();
    var b = bloco('Mensagens'); alvo.appendChild(b);
    function pintar() {
      var corpo = b.querySelector('.jor-pos-corpo'); if (corpo) corpo.remove();
      corpo = el('div', 'jor-pos-corpo'); b.appendChild(corpo);
      var d = MSG.dados;
      if (!d || !d.grupos || typeof d.grupos !== 'object') { corpo.appendChild(el('p', 'jor-nota', 'Não consegui ler as mensagens agora.')); return; }
      GRUPOS.forEach(function (g) {
        var s = d.grupos[g[0]] || {}; var lin = el('div', 'jor-pos-grupo');
        var t = el('div'); t.appendChild(el('b', '', g[1])); t.appendChild(el('small', '', 'Quem recebe: ' + g[2])); lin.appendChild(t);
        var bt = btn(s.ligado ? 'Desligar' : 'Ligar', s.ligado ? '' : 'jor-btn-pri', function () { confirmar(g, !s.ligado, pintar); });
        bt.setAttribute('aria-label', (s.ligado ? 'Desligar ' : 'Ligar ') + g[1]); lin.appendChild(bt);
        var sit;
        if (s.ligado) { var q = quando(s.ligado_em); sit = 'Ligado desde ' + q.d + ' às ' + q.h + (s.por ? ' por ' + h.nomeBonito(s.por) : '') + '. ' + h.plural(s.enviadas_24h || 0, 'enviada', 'enviadas') + ' em 24 h.'; }
        else sit = 'Desligado.';
        lin.appendChild(el('span', 'jor-pos-sit ' + (s.ligado ? 'ok' : ''), sit));
        corpo.appendChild(lin);
      });
      corpo.appendChild(el('p', 'jor-nota', 'As do cliente ligam um dia depois das da equipe.'));
      if (d.desligado_na_vercel) corpo.appendChild(el('p', 'jor-aviso', 'Todas estão desligadas na Vercel (JORNADA_MSG_OFF).'));
      if (d.valida === false) corpo.appendChild(el('p', 'jor-aviso', 'As chaves estão sem assinatura válida. Todas valem como desligadas.'));
    }
    if (MSG.dados) pintar(); else b.appendChild(el('p', 'jor-nota jor-pos-corpo', 'Carregando…'));
    h.api('/gerador/jornada-solar/mensagens', 'GET').then(function (r) {
      if (r.status === 200 && r.json && r.json.grupos) MSG.dados = r.json; else if (!MSG.dados) MSG.dados = null;
      if (b.isConnected !== false) pintar();
    });
  }
  function confirmar(g, ligar, depois) {
    var h = H();
    h.dialogo((ligar ? 'Ligar ' : 'Desligar ') + g[1] + '?', function (c) {
      c.appendChild(el('p', '', ligar ? 'Só o que for gravado a partir de agora dispara.' : 'As mensagens deste grupo param na próxima rodada.'));
      var info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); c.appendChild(info);
      return {};
    }, ligar ? 'Ligar' : 'Desligar', function (b, c) {
      var info = c.querySelector('.jor-erro'); b.disabled = true; info.textContent = '';
      h.api('/gerador/jornada-solar/mensagens', 'PUT', { grupo: g[0], ligado: ligar }).then(function (r) {
        if (r.status === 200 && r.json && r.json.ok !== false) {
          if (r.json.grupos) MSG.dados = r.json;
          h.fecharDlg(); h.toast(ligar ? 'Ligado.' : 'Desligado.'); depois(); return;
        }
        b.disabled = false; info.textContent = msgSrv(r, 'Não consegui agora. Tente de novo.');
      });
    });
  }

  window.Jornada.etapas[9] = etapa9;
  window.Jornada.extras.pendenciaPos = pendenciaPos;
  window.Jornada.extras.indicacao = indicacao;
  window.Jornada.extras.mensagens = mensagens;
  window.Jornada.extras.avisos = avisos;
  window.Jornada.extras.bookPdf = bookPdf;
  window.Jornada.extras.mensagemLiberacao = mensagemLiberacao;
})();
