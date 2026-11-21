/* Jornada da obra (19/11/2026): as abas 6 Compra (etapa 4 da api), 7 Logística (5), 8 Obra (6) e 9 Comissionamento (7 e 8, com o botão
 * final "Concluir e preencher a planilha"), e os três papéis: relatório de vistoria (etapa 1), proposta de banco (etapa 2) e termo de entrega.
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
  var CHECK = [['estrutura', 'Estrutura fixada e vedada'], ['placas', 'Placas alinhadas e aterradas'], ['strings', 'Strings 1 e 2 ligadas'], ['inversor', 'Inversor fixado'], ['dps', 'DPS CC e CA'], ['aterramento', 'Aterramento'], ['cabos', 'Cabos identificados'], ['padrao', 'Padrão ligado']];
  /** O checklist da Obra grava em fila (20/11/2026), igual ao "Comprado": a marca muda na hora e fica em `pend` (por chave do item) até o PUT dela voltar.
   *  `voo` = há um PUT a caminho; `ob` = o objeto da obra do último desenho (a versão mais recente lida). Os campos nunca desligam. */
  var CHK = { voo: false, pend: {}, ob: null, card: null };
  /** O "Comprado" da Compra grava em fila (20/11/2026): a marca muda na hora e fica em `pend` (por id do item, ou k<posição> sem id) até o PUT dela voltar.
   *  `voo` = há um PUT a caminho. O redesenho depois de cada PUT relê `pend`, então um clique que ainda está na fila nunca se perde. */
  var PIL = { voo: false, pend: {} };
  var FOTOS_ENTREGA = [['ent_vista_geral', 'Vista geral das placas'], ['ent_arranjo', 'Arranjo de perto'], ['ent_inversor', 'Inversor ligado, com o visor'], ['ent_quadro', 'Quadro de proteção'], ['ent_aterramento', 'Aterramento'], ['ent_padrao', 'Padrão com placa de advertência'], ['ent_etiquetas', 'Etiquetas'], ['ent_local_limpo', 'Local limpo']];
  /** Os álbuns (itens de vários arquivos) e o limite de fotos de cada um, igual ao do servidor. */
  var ALBUNS = { obra_foto: 400, ent_extra: 100 };
  var TERMO_ITENS = [
    'Instalação concluída, com o local limpo e sem sobra de material.',
    'Sistema ligado e gerando energia na presença do cliente.',
    'Aplicativo de monitoramento instalado no celular do cliente, com o acesso entregue.',
    'Cliente orientado sobre o funcionamento, o desligamento de emergência e os cuidados de uso.',
    'Manuais e termos de garantia dos equipamentos entregues.',
    'Telhado conferido depois da obra, com reposição das telhas danificadas quando houve.',
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
  /** Conta fechada: o dinheiro trava (valor, orçado, pagamento). O equipamento dos itens continua editável (19/11/2026). */
  function contaFechada(f2) { return !!(f2 && f2.fechada); }
  function podeEquip(f2) { return podeSecao(f2, 'compra') || !!(f2 && f2.pode && (f2.pode.equipamento || f2.pode.editar_equipamento)); }
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
  // CPF e placa de quem buscou a carga: máscara enquanto digita, só dígitos (CPF) e maiúscula sem hífen (placa) no que vai ao servidor.
  function soDig(s) { return String(s || '').replace(/\D/g, ''); }
  function cpfMasc(s) {
    var d = soDig(s).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
    if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
    return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
  }
  function cpfOk(s) {
    var d = soDig(s); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) { var soma = 0; for (var i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i); if (((soma * 10) % 11) % 10 !== Number(d[t])) return false; }
    return true;
  }
  /** A placa crua: 3 letras, 1 número, letra ou número, 2 números (Mercosul ABC1D23 ou antiga ABC1234). */
  function placaCrua(s) {
    var t = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); var out = '';
    for (var i = 0; i < t.length && out.length < 7; i++) {
      var c = t[i]; var n = out.length;
      if (n < 3 ? /[A-Z]/.test(c) : n === 4 ? /[A-Z0-9]/.test(c) : /\d/.test(c)) out += c;
    }
    return out;
  }
  function placaMasc(s) { var p = placaCrua(s); return p.length > 3 ? p.slice(0, 3) + '-' + p.slice(3) : p; }
  function placaOk(s) { return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placaCrua(s)); }
  /** O campo com máscara: mostra formatado, guarda pelo `guardar(cru)` e diz embaixo quando o valor completo não vale. */
  function campoMascara(rot, valor, aria, masc, cru, valido, erroTxt, guardar, pode, modo) {
    var i = entrada('text', masc(valor), aria); i.disabled = !pode; i.autocomplete = 'off'; i.spellcheck = false;
    if (modo) i.inputMode = modo; else i.autocapitalize = 'characters';
    var lb = campo(rot, i); var er = el('small', 'jor-ob-campo-er'); er.setAttribute('aria-live', 'polite'); lb.appendChild(er);
    function confere(final) {
      var v = cru(i.value); var ruim = !!v && !valido(i.value) && (final || v.length >= (modo ? 11 : 7));
      er.textContent = ruim ? erroTxt : ''; i.setAttribute('aria-invalid', ruim ? 'true' : 'false'); i.classList.toggle('falta', ruim);
    }
    i.addEventListener('input', function () { var p = i.selectionStart === i.value.length; i.value = masc(i.value); if (p) i.setSelectionRange(i.value.length, i.value.length); guardar(cru(i.value)); confere(false); });
    i.addEventListener('blur', function () { confere(true); });
    confere(false);
    return lb;
  }


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
      // A ficha do trajeto: Retirada e Entrega lado a lado, ligadas pelo tempo de estrada.
      '.jor-ob-traj-t{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:14px 0 8px;padding-top:10px;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-cl0{margin:0;font-size:14px;font-weight:800;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-traj-est{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 8px}',
      '.jor-ob-traj{display:grid;grid-template-columns:minmax(0,1fr) 104px minmax(0,1fr);align-items:stretch}',
      '.jor-ob-ponta{display:flex;flex-direction:column;gap:10px;min-width:0;padding:12px 14px 14px;border:1px solid var(--n-bd,#334155);border-radius:12px;background:var(--n-sf,#1E293B)}',
      '.jor-ob-ponta label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--n-tx2,#B4C0D2);min-width:0}',
      '.jor-ob-ponta label .jor-auto{align-self:flex-start;margin:0}',
      '.jor-ob-ponta-t{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-pino{flex:none;width:12px;height:12px;border-radius:50%;border:3px solid var(--io-marcado,#2E6CEA);background:var(--n-sf,#1E293B)}',
      '.jor-ob-ponta.ent .jor-ob-pino{background:var(--io-marcado,#2E6CEA)}',
      '.jor-ob-traj-meio{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0 6px;text-align:center}',
      '.jor-ob-traj-meio::before{content:"";position:absolute;left:0;right:0;top:50%;border-top:2px dashed var(--n-bd2,#475569)}',
      '.jor-ob-traj-meio.ok::before{border-top-style:solid;border-color:var(--io-marcado,#2E6CEA)}',
      '.jor-ob-traj-meio>*{position:relative;background:var(--n-sf2,#182338);padding:0 4px}',
      '.jor-ob-traj-meio small{font-size:11.5px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-tempo{font-size:13px;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-dupla{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}',
      '.jor-ob-cpfpl{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}',
      '.jor-ob-campo-er{color:var(--io-er-tx,#FCA5A5);font-size:12px;font-weight:600}',
      '.jor-ob-campo-er:empty{display:none}',
      '.jor-ob-fotos8{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 18px}',
      // A obra nova (19/11/2026): a área de arquivos da Compra, as linhas de item com o tique, a carga, o diário e as seções da aba 9.
      '.jor-ob-drop{display:flex;align-items:center;flex-wrap:wrap;gap:14px;padding:18px 20px;border:2px dashed var(--n-bd2,#475569);border-radius:14px;background:var(--n-sf2,#182338);transition:border-color .15s,background-color .15s}',
      '.jor-ob-drop.on{border-color:var(--io-marcado,#2E6CEA);background:var(--io-azul-sf,rgba(96,165,250,.16))}',
      '.jor-ob-drop-ic{flex:0 0 44px;width:44px;height:44px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;background:var(--n-sf,#1E293B);color:var(--io-azul-tx,#93C5FD);box-shadow:inset 0 0 0 1px var(--n-bd,#334155)}',
      '.jor-ob-drop-tx{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.jor-ob-drop-tx b{font-size:15px;font-weight:700;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-drop-tx span{font-size:13px;line-height:1.45;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-drop-bts{display:flex;flex-wrap:wrap;gap:8px}',
      '.jor-ob-arqbt{display:inline-flex}',
      '.jor-ob-arqbt .jor-btn{min-height:44px}',
      '.jor-ob-arqs{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.jor-ob-arqs[hidden]{display:none}',
      '.jor-ob-arq{display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 6px 8px 10px;border:1px solid var(--n-bd,#334155);border-radius:10px;background:var(--n-sf,#1E293B)}',
      '.jor-ob-arq.novo{box-shadow:inset 3px 0 0 var(--io-ok,#15803D)}',
      '.jor-ob-arq-ic{flex:0 0 32px;width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:var(--n-sf2,#182338);color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-arq-ic.ok{color:var(--io-ok-tx,#4ADE80)}',
      '.jor-ob-arq.lendo .jor-ob-arq-ic{color:var(--io-azul-tx,#93C5FD);animation:jorObPulso 1.2s ease-in-out infinite}',
      '@keyframes jorObPulso{50%{opacity:.4}}',
      '@media (prefers-reduced-motion:reduce){.jor-ob-arq.lendo .jor-ob-arq-ic{animation:none}}',
      '.jor-ob-arq-tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.jor-ob-arq-tx b{font-size:13.5px;font-weight:600;color:var(--n-tx,#E5E7EB);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.jor-ob-arq-m{font-size:12.5px;line-height:1.4;color:var(--n-tx2,#B4C0D2);overflow-wrap:anywhere}',
      '.jor-ob-arq-m.ok{color:var(--io-ok-tx,#4ADE80);font-weight:600}',
      '.jor-ob-arq-m.er{color:var(--io-er-tx,#FCA5A5)}',
      '.jor-ob-arq-l{flex:0 0 auto;display:flex;align-items:center;gap:2px}',
      '.jor-ob-x{min-width:44px;min-height:44px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-color:transparent}',
      '.jor-ob-its{list-style:none;margin:0;padding:0}',
      '.jor-ob-it{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 14px;padding:10px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-it:first-child{border-top:0}',
      '.jor-ob-it-m{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.jor-ob-it-d{font-size:14px;font-weight:600;color:var(--n-tx,#E5E7EB);overflow-wrap:anywhere}',
      '.jor-ob-it-s{font-size:12.5px;line-height:1.4;color:var(--n-tx2,#B4C0D2);overflow-wrap:anywhere}',
      '.jor-ob-it-v{font-size:13px;font-weight:600;color:var(--n-tx,#E5E7EB);font-variant-numeric:tabular-nums}',
      '.jor-ob-it-l{display:flex;align-items:center;justify-content:flex-end;gap:6px}',
      '.jor-ob-pill{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:6px 14px 6px 10px;border:1px solid var(--n-bd2,#475569);border-radius:999px;background:var(--n-sf,#1E293B);color:var(--n-tx2,#B4C0D2);font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;touch-action:manipulation}',
      '.jor-ob-pill-bx{flex:0 0 20px;width:20px;height:20px;border-radius:6px;border:2px solid var(--n-bd2,#475569);display:inline-flex;align-items:center;justify-content:center;background:var(--n-sf,#1E293B)}',
      '.jor-ob-pill-bx svg{width:13px;height:13px}',
      '.jor-ob-pill.on{background:var(--io-ok-sf,rgba(74,222,128,.14));border-color:var(--io-ok-bd,rgba(74,222,128,.4));color:var(--io-ok-fg,#4ADE80)}',
      '.jor-ob-pill.on .jor-ob-pill-bx{background:var(--io-ok,#15803D);border-color:var(--io-ok,#15803D);color:var(--n-inv,#FFFFFF)}',
      '.jor-ob-pill:hover:not(:disabled) .jor-ob-pill-bx{border-color:var(--io-marcado,#2E6CEA)}',
      '.jor-ob-pill:focus-visible{outline:2px solid var(--io-azul-tx,#93C5FD);outline-offset:2px}',
      '.jor-ob-pill:disabled{cursor:default}',
      '.jor-ob-carga-t{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px}',
      '.jor-ob-carga-t h4{margin:0;font-size:15px;font-weight:700;color:var(--io-titulo,#F1F5F9)}',
      '.jor-ob-carga-f{margin:4px 0 14px;font-size:13px;line-height:1.45;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-carga-f.er{color:var(--io-er-tx,#FCA5A5);font-weight:600}',
      '.jor-ob-carga-f.av{color:var(--io-av-tx,#FBBF24);font-weight:600}',
      '.jor-ob-carga-f.ok{color:var(--io-ok-tx,#4ADE80);font-weight:600}',
      '.jor-ob-carga-pe{display:flex;justify-content:flex-end;margin-top:16px}',
      '.jor-ob-sub-b{margin-top:16px;padding-top:14px;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-linha0{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}',
      '.jor-ob-linha0:has(>label){align-items:flex-end}',
      '.jor-ob-linha0>label:not(.jor-ob-chk){flex:1 1 200px;min-width:0;max-width:420px}',
      ':is(.jor-ob-sub-b,.jor-ob-carga,.jor-ob-secao,.jor-ob-det) label:not(.jor-ob-chk):not(.jor-btn){display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-addfoto{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;margin-top:8px;padding:8px 8px 8px 12px;border:1px dashed var(--n-bd2,#475569);border-radius:10px}',
      '.jor-ob-chks{display:flex;flex-direction:column;gap:2px;margin:8px 0 0}',
      '.jor-ob-gt{display:block;margin:10px 0 0}',
      '.jor-ob-chks .jor-ob-chk{min-height:40px;padding:2px 8px;border-radius:8px}',
      '.jor-ob-chk2{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 14px}',
      '.jor-ob-tres{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:10px;margin:12px 0}',
      '.jor-ob-eq{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}',
      '.jor-ob-dia{margin:10px 0}',
      '.jor-ob-det{margin:16px 0 0;padding:0 14px;border:1px solid var(--n-bd,#334155);border-radius:12px;background:var(--n-sf,#1E293B)}',
      '.jor-ob-det[open]{padding-bottom:14px}',
      '.jor-ob-det>summary{display:flex;align-items:center;gap:10px;min-height:48px;cursor:pointer;font-weight:600;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-det>summary:focus-visible{outline:2px solid var(--io-azul-tx,#93C5FD);outline-offset:2px;border-radius:8px}',
      '.jor-ob-plano{padding-top:10px;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-secao{margin:32px 0 0;padding-top:22px;border-top:3px solid var(--n-bd,#334155)}',
      '.jor-ob-secao:first-child{margin-top:20px;padding-top:0;border-top:0}',
      '.jor-ob-secao-t{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 4px;font-size:18px;font-weight:700;line-height:1.3;color:var(--io-titulo,#F1F5F9)}',
      '.jor-ob-secao>.jor-ob-sub-b:first-of-type{border-top:0;padding-top:4px;margin-top:8px}',
      '.jor-ob-passo{padding:14px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-secao-t+.jor-ob-passo{border-top:0}',
      '.jor-ob-passo .jor-ob-linha0+.jor-ob-linha0{margin-top:8px}',
      '.jor-ob-res{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0 24px;margin:8px 0 0}',
      '.jor-ob-res>div{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-res dt{font-size:12px;font-weight:600;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-res dd{margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:14px;font-weight:600;color:var(--n-tx,#E5E7EB);overflow-wrap:anywhere}',
      '.jor-ob-res dd .jor-rc-org{margin-left:0}',
      '.jor-ob-fases{list-style:none;margin:16px 0 4px;padding:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}',
      '.jor-ob-fases li{position:relative;display:flex;flex-direction:column;gap:2px;padding:16px 8px 0 0;font-size:12px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-fases li::before{content:"";position:absolute;left:0;right:0;top:4px;border-top:2px dashed var(--n-bd2,#475569)}',
      '.jor-ob-fases li::after{content:"";position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;background:var(--n-sf,#1E293B);box-shadow:inset 0 0 0 2px var(--n-bd2,#475569)}',
      '.jor-ob-fases li.ok::before{border-top-style:solid;border-color:var(--io-ok,#15803D)}',
      '.jor-ob-fases li.ok::after{background:var(--io-ok,#15803D);box-shadow:none}',
      '.jor-ob-fases b{font-size:14px;color:var(--n-tx,#E5E7EB);font-variant-numeric:tabular-nums}',
      '.jor-ob-fases li:not(.ok) b{font-weight:600;color:var(--n-tx3,#94A3B8)}',
      '.jor-ob-final{margin-top:16px;justify-content:space-between}',
      '.jor-ob-final-tx{flex:1 1 280px;display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.45;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-final-tx b{font-size:14px;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-plan{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--n-sf2,#182338)}',
      '.jor-ob-plan>p{margin:0}',
      '.jor-ob-cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0 16px;margin:10px 0}',
      '.jor-ob-cols>div{padding:6px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-cols dt{display:flex;gap:8px;font-size:12px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-cols dt b{min-width:22px;color:var(--io-azul-tx,#93C5FD)}',
      '.jor-ob-cols dd{margin:2px 0 0;font-size:13.5px;color:var(--n-tx,#E5E7EB);overflow-wrap:anywhere}',
      '.jor-ob-conf{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:10px}',
      '.jor-ob-conf li{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.45;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-conf svg{flex:0 0 auto;margin-top:3px;color:var(--io-ok-tx,#4ADE80)}',
      '.jor-ob-conf-book{margin:12px 0 8px;padding:10px 12px;border-radius:10px;border:1px solid var(--io-ambar-bd,rgba(247,164,28,.4));background:var(--io-av-sf,rgba(247,164,28,.1));color:var(--io-ambar-tx,#FDE68A);font-size:14px;line-height:1.45}',
      '.jor-ob-conf-book b{display:block;font-weight:700}',
      '.jor-ob-conf-book ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.jor-ob-conf-book li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 12px;font-size:13px;font-weight:600}',
      '.jor-ob-conf-book .jor-btn-link{min-height:44px;color:inherit;border-color:var(--io-ambar-bd,rgba(247,164,28,.4))}',
      '.jor-ob-final-av{color:var(--io-ambar-tx,#FDE68A);font-weight:600}',
      '.jor-ob-termo{list-style:none;counter-reset:t;margin:8px 0 12px;padding:0;display:flex;flex-direction:column}',
      '.jor-ob-termo li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px;padding:6px 0;border-top:1px solid var(--n-bd,#334155);font-size:13.5px;line-height:1.45;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-termo li:first-child{border-top:0}',
      '.jor-ob-termo li>span{flex:1 1 300px}',
      '.jor-ob-termo li>span::before{counter-increment:t;content:counter(t) ". ";color:var(--n-tx2,#B4C0D2)}',
      '.jor-ob-cofre{align-items:center}',
      '.jor-ob-senha-l{margin-top:8px}',
      '.jor-ob-secao .jor-ob-linha0+.jor-ob-linha0,.jor-ob-cofre+.jor-ob-linha0{margin-top:12px}',
      '.jor-ob-secao>.jor-ob-chk{display:inline-flex;min-height:40px;margin:8px 0 4px;padding:2px 12px 2px 6px;border-radius:8px}',
      '.jor-ob-dia>.jor-btn-link,.jor-ob-reabrir{margin-top:10px}',
      '.jor-din-acoes{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}',
      '.jor-ob-it-v{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}',
      '.jor-ob-quatro{grid-template-columns:minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)}',
      '.jor-ob-rm{margin-top:16px;padding-top:12px;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-ob-rm-b{color:var(--io-er-tx,#FCA5A5)}',
      '.jor-ob-rm-q{margin:0;font-size:14px;font-weight:600;color:var(--n-tx,#E5E7EB)}',
      '.jor-ob-rm-sim{border-color:var(--io-er,#DC2626);color:var(--io-er-tx,#FCA5A5)}',
      '.jor-ob-rotl{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}',
      '@media (max-width:760px){',
      '.jor-ob-drop{padding:14px}',
      '.jor-ob-drop-bts{width:100%}',
      '.jor-ob-drop-bts{flex-direction:column}',
      '.jor-ob-drop-bts .jor-ob-arqbt{flex:1 1 auto;width:100%}',
      '.jor-ob-res{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 16px}',
      '.jor-ob-res>div.larga{grid-column:1/-1}',
      '.jor-ob-drop-bts .jor-btn,.jor-ob-carga-pe .jor-btn,.jor-ob-final .jor-btn{width:100%}',
      '.jor-ob-it-l{flex-direction:column;align-items:flex-end;gap:0}',
      '.jor-ob-tres{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}',
      '.jor-ob-tres:not(.jor-ob-quatro)>label:first-child{grid-column:1/-1}',
      '.jor-ob-quatro{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}',
      '.jor-ob-eq{grid-template-columns:minmax(0,1fr)}',
      '.jor-ob-fases{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));row-gap:14px}',
      '.jor-ob-secao-t{font-size:17px}',
      '.jor-ob-traj{grid-template-columns:minmax(0,1fr)}',
      '.jor-ob-traj-meio{flex-direction:row;justify-content:flex-start;gap:8px;min-height:52px;padding:0 0 0 30px}',
      '.jor-ob-traj-meio::before{left:19px;right:auto;top:0;bottom:0;border-top:0;border-left:2px dashed var(--n-bd2,#475569)}',
      '.jor-ob-traj-meio.ok::before{border-left-style:solid;border-color:var(--io-marcado,#2E6CEA)}',
      '.jor-ob-traj-meio>*{background:none;padding:0}',
      '.jor-ob-ent-dupla{grid-template-columns:minmax(0,1fr)}',
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
    // O número de série do inversor é digitado só no Monitoramento: o salvar da Compra não o manda (ausente = a api não mexe).
    if (secao === 'compra' && Array.isArray(c.itens)) c.itens.forEach(function (i) { if (i) delete i.serie; });
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
    var b = btn(rot, '', function () {
      b.disabled = true;
      var c = montar(); if (c === false) { b.disabled = false; return; }
      salvar(secao, c, aviso).then(function () { b.disabled = false; });
    });
    return b;
  }

  /** Anexo ligado a um lugar da obra pelo id do arquivo: depois do envio, acha o arquivo novo do slot e grava o id por `ligar`. */
  function anexoLigado(f2, chave, rotulo, idAtual, ligar, nivel) {
    var h = H(); var tem = existe(f2, idAtual); nivel = nivel === 'op' ? 'op' : 'ob';
    var linha = el('div', 'jor-anexo'); linha.appendChild(el('span', 'jor-rot', rotulo));
    // Vermelho quando o item da etapa exige o arquivo; amarelo ("Opcional") quando não trava.
    var est = el('span', 'jor-est' + (tem ? ' ok' : nivel === 'op' ? ' fp' : ' fo'), tem ? 'Anexado' : nivel === 'op' ? 'Opcional' : 'Falta'); if (tem) est.insertBefore(h.icone('ok'), est.firstChild); linha.appendChild(est);
    h.marcaFalta(linha, tem ? '' : nivel);
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

  // ── A obra nova (19/11/2026): 6 Compra, 7 Logística, 8 Obra e 9 Comissionamento ─────────────────────────
  // As etapas 4, 5 e 6 da api abrem a seguinte sozinhas (sem Concluir). A aba 9 junta a 7 e a 8 da api e tem o botão final.
  // Nenhum botão de "Ler": anexou, o servidor lê e preenche só o que está vazio. Dinheiro mora no caixa do Resumo; aqui só o que falta pagar.
  var ORIGEM_TXT = { proposta: 'Da proposta', lista: 'Lista pronta', manual: 'Digitado', nota: 'Da nota', arquivo: 'Lido de um arquivo' };
  var TIPO_DOC = { orcamento: 'Orçamento', pedido: 'Pedido', nota_fiscal: 'Nota' };
  var ACEITA_COMPRA = 'image/*,application/pdf,.pdf,.xml,text/xml,application/xml';
  var ICO = {
    subir: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4',
    camera: 'M4 8h3.2l1.6-2.5h6.4L16.8 8H20v11H4zM12 16.5a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z',
    doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
    x: 'M6 6l12 12M18 6L6 18',
  };
  function ico(nome, tam) {
    var ns = 'http://www.w3.org/2000/svg'; var s = document.createElementNS(ns, 'svg'); var t = String(tam || 20);
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', t); s.setAttribute('height', t); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICO[nome] || ICO.doc); s.appendChild(p); return s;
  }
  function juntarE(l) { l = (l || []).filter(Boolean); return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]; }
  function qtdTxt(i) { return i.quantidade === null || i.quantidade === undefined || i.quantidade === '' ? '' : String(i.quantidade).replace('.', ',') + ' ' + (i.unidade || 'un'); }
  function origemTxt(i) { return i.lido_de ? 'Lido de ' + i.lido_de : (ORIGEM_TXT[i.origem] || ''); }
  /** Valor só quando a api mandou o número: pago (nota, pedido ou digitado) ou, sem ele, o orçado. null não mostra nada. */
  function valorTxt(i) {
    if (typeof i.valor_centavos === 'number' && i.valor_centavos > 0) return H().rs(i.valor_centavos);
    if (typeof i.orcado_centavos === 'number' && i.orcado_centavos > 0) return 'Orçado ' + H().rs(i.orcado_centavos);
    return '';
  }
  function ehKit(i) { return i.grupo ? i.grupo === 'kit' : (i.tipo === 'modulo' || i.tipo === 'inversor' || i.tipo === 'estrutura'); }
  function podeLancar() { var dn = O().dinheiro; return !!(dn && dn.livro && dn.pode && dn.pode.lancar_saida && D() && D().lancar); }
  /** Envia vários arquivos para um slot de álbum e devolve os ids novos (os que ainda não estão ligados a nada). */
  function subirAlbum(slot, files) {
    var st = vdcAgora();
    if (!st || String(st.id) !== String(O().card) || st.carregando || typeof window.vdcAnexar !== 'function') { H().toast('Os anexos ainda estão carregando. Tente de novo em instantes.'); return Promise.resolve(null); }
    return Promise.resolve(window.vdcAnexar(st, { chave: slot }, files)).then(function () { return H().api(base() + '/fase2', 'GET'); }).then(function (r) {
      var lista = (r.json && r.json.arquivos) || []; var usados = idsLigados(O().fase2);
      return lista.filter(function (a) { return a.slot === slot && usados.indexOf(a.id) < 0; }).map(function (a) { return a.id; });
    });
  }
  /** Um seletor de arquivo de verdade: botão que abre o input escondido (Enter e Espaço funcionam). */
  function botaoArquivo(rot, cls, aceita, varios, camera, aria, aoEscolher, icone) {
    var inp = el('input'); inp.type = 'file'; inp.accept = aceita; inp.hidden = true; if (varios) inp.multiple = true; if (camera) inp.setAttribute('capture', 'environment');
    inp.setAttribute('aria-hidden', 'true'); inp.tabIndex = -1;
    var b = btn('', cls, function () { inp.click(); });
    if (icone) b.appendChild(ico(icone, 18));
    b.appendChild(document.createTextNode(rot)); if (aria) b.setAttribute('aria-label', aria);
    inp.addEventListener('change', function () { var fs = Array.prototype.slice.call(inp.files || []); inp.value = ''; if (fs.length) aoEscolher(fs); });
    var w = el('span', 'jor-ob-arqbt'); w.appendChild(b); w.appendChild(inp); return w;
  }
  /** As miniaturas de um álbum (ids), com a data de cada foto. */
  function miniaturas(f2, ids, rotulo) {
    var al = el('div', 'jor-ob-album'); var h = H();
    ids.forEach(function (id, k) {
      var a = (f2.arquivos || []).filter(function (x) { return x.id === id; })[0]; if (!a) return;
      var dd = a.em ? h.ddmm(String(a.em).slice(0, 10)) : 'foto';
      var m = fotoMini(id, dd, false, null); m.setAttribute('aria-label', rotulo + ' ' + (k + 1) + ', ' + dd); m.tabIndex = -1; m.disabled = true; al.appendChild(m);
    });
    return al;
  }
  /** A seção grande da aba 9: título com a situação ao lado e divisória grossa em cima. */
  function secao(titulo, etiq, id) {
    var s = el('section', 'jor-ob-secao'); if (id) s.id = id;
    var t = el('h3', 'jor-ob-secao-t'); t.appendChild(el('span', '', titulo)); if (etiq) t.appendChild(etiq); s.appendChild(t); return s;
  }
  function etqItens(its, concluida) {
    var h = H(); if (concluida) return h.etq('Completo', 'ok');
    var eOpc = function (i) { return i.opcional === true || i.nivel === 'opcional'; };
    var ob = its.filter(function (i) { return !i.feito && !eOpc(i); }).length; var op = its.filter(function (i) { return !i.feito && eOpc(i); }).length;
    if (ob) return h.etqFalta('Falta ' + ob, 'ob');
    if (op) return h.etqFalta('Falta ' + op + ' opcional', 'op');
    return its.length ? h.etq('Completo', 'ok') : null;
  }
  function itensDe(f2, n, chaves) {
    var e = (f2.etapas || []).filter(function (x) { return x.n === n; })[0];
    return ((e && e.itens) || []).filter(function (i) { return !chaves || chaves.indexOf(i.chave) >= 0; });
  }
  function etapaF2(f2, n) { return (f2.etapas || []).filter(function (x) { return x.n === n; })[0] || null; }

  // ── 6 · Compra ────────────────────────────────────────────────────────────────────────────────────────
  function compraDe(f2) { var c = dados(f2).compra || {}; return { itens: c.itens || [], compras: c.compras || [], sugeridos: c.sugeridos || [], documentos: c.documentos || [], kit: c.kit || null, material: c.material || null }; }
  /** Sem item gravado, a base é o kit da proposta que a api sugere. A lista pronta nunca vira item sozinha: só pelo botão Lista pronta. */
  function itensBase(c) { return c.itens.length ? clone(c.itens) : clone(c.sugeridos.filter(function (i) { return i.origem === 'proposta' || ehKit(i); })); }
  /** Item que só veio de orçamento e ainda não foi comprado: amarelo, não trava o kit nem o fechamento. */
  function soOrcado(i, c) {
    if (i.comprado) return false;
    if (typeof i.orcado_apenas === 'boolean') return i.orcado_apenas;   // a api marca (19/11/2026); o resto é para a obra antiga
    var dc = i.documento_id ? (c.documentos || []).filter(function (x) { return x.id === i.documento_id; })[0] : null;
    if (dc) return dc.tipo === 'orcamento';
    return i.origem === 'arquivo' && !i.documento_id;   // sem a marca da api: item novo de arquivo ainda sem tique
  }
  function nomeCompra(c, i) { return 'Compra ' + (i + 1) + (c.fornecedor ? ' · ' + c.fornecedor : ''); }
  function somaItens(itens, cid) { var s = 0; itens.forEach(function (i) { if (i.compra_id === cid) s += Number(i.valor_centavos) || 0; }); return s; }

  // A fila dos arquivos da Compra: um POST por arquivo, um de cada vez. Vive fora do desenho (a tela redesenha a cada arquivo lido).
  var FILA = { card: null, itens: [], rodando: false, seq: 0, no: null };
  function filaDoCard() { if (FILA.card !== String(O().card)) FILA = { card: String(O().card), itens: [], rodando: false, seq: 0, no: null }; return FILA; }
  function msgLeitura(lc) {
    if (lc.resultado === 'lido') {
      var p = []; var pl = H().plural;
      if (lc.novos) p.push(pl(lc.novos, 'item novo', 'itens novos'));
      if (lc.atualizados) p.push(pl(lc.atualizados, 'item completado', 'itens completados'));
      if (lc.marcados_comprados) p.push(lc.marcados_comprados === 1 ? '1 marcado como comprado' : lc.marcados_comprados + ' marcados como comprados');
      return (TIPO_DOC[lc.tipo] || 'Arquivo') + (lc.fornecedor ? ' da ' + lc.fornecedor : '') + ': ' + (p.length ? juntarE(p) : 'nada novo para preencher') + '.';
    }
    if (lc.resultado === 'repetido') return 'Já tinha esse arquivo.';
    if (lc.resultado === 'nao_e_documento') return 'Não parece orçamento, pedido nem nota.';
    return lc.mensagem || 'Não consegui ler agora. Tente de novo.';
  }
  function enfileirar(files) {
    var F = filaDoCard();
    files.forEach(function (f) { F.seq++; F.itens.push({ id: 'a' + F.seq, nome: String(f.name || 'arquivo'), file: f, est: 'fila', msg: '', doc: '' }); });
    pintarFila(); rodarFila();
  }
  function rodarFila() {
    var F = filaDoCard(); if (F.rodando) return;
    var it = F.itens.filter(function (x) { return x.est === 'fila'; })[0];
    if (!it) return;
    F.rodando = true; it.est = 'lendo'; pintarFila();
    var card = F.card;
    D().prepararArquivo(it.file).then(function (a) {
      return H().api(base() + '/compra/arquivo', 'POST', { base64: a.base64, media_type: a.media_type, nome: a.nome }, 150000);
    }).then(function (r) {
      var j = r && r.json;
      if (r.status === 200 && j && j.ok !== false && j.leitura_compra) {
        var lc = j.leitura_compra; it.est = lc.resultado; it.msg = msgLeitura(lc); it.doc = lc.documento_id || '';
        if (lc.resultado === 'lido' || lc.resultado === 'repetido' || lc.resultado === 'nao_e_documento' || lc.resultado === 'sem_itens') it.file = null;
        if (Array.isArray(j.etapas) && card === String(O().card)) { var novo = {}; Object.keys(j).forEach(function (k) { if (k !== 'leitura_compra') novo[k] = j[k]; }); O().fase2 = novo; }
      } else if (r.status === 409 && j && j.error === 'nota_repetida') { it.est = 'repetido'; it.msg = msgSrv(r, 'Esta nota já foi lançada.'); it.file = null; }
      else { it.est = 'erro'; it.msg = msgSrv(r, 'Não consegui enviar este arquivo. Tente de novo.'); }
    }).catch(function (e) {
      it.est = 'erro'; it.msg = (e && (e.message === 'grande' || e.message === 'heic' || e.message === 'vazio') && D().msgArquivo) ? D().msgArquivo(e) : 'Não consegui enviar este arquivo. Tente de novo.';
      if (e && e.message === 'grande') it.file = null;
    }).then(function () {
      F.rodando = false;
      if (card !== String(O().card)) return;
      var mais = F.itens.some(function (x) { return x.est === 'fila'; });
      if (mais) { if (it.est === 'lido') H().desenhar(); else pintarFila(); rodarFila(); }
      else if (F.itens.some(function (x) { return x.est === 'lido'; })) H().recarregar(); else pintarFila();
    });
  }
  var EST_ARQ = { fila: ['Na fila', ''], lendo: ['Lendo…', 'vez'], lido: ['Lido', 'ok'], repetido: ['Já lido', ''], nao_e_documento: ['Não lido', 'fp'], sem_itens: ['Sem itens', 'fp'], cota: ['Tente depois', 'fp'], falhou: ['Não leu', 'fo'], erro: ['Não enviou', 'fo'] };
  function pintarFila() {
    var F = filaDoCard(); var no = F.no; if (!no) return;
    no.replaceChildren();
    // O lido aparece na lista dos documentos (com a frase do que fez); aqui fica o que ainda não virou documento.
    F.itens.filter(function (x) { return x.est !== 'lido'; }).forEach(function (x) { no.appendChild(linhaArquivo(x.nome, x.msg, x.est, x)); });
    no.hidden = !no.firstChild;
  }
  function linhaArquivo(nome, msg, est, x) {
    var h = H(); var e = EST_ARQ[est] || EST_ARQ.fila;
    var li = el('li', 'jor-ob-arq' + (est === 'lendo' ? ' lendo' : ''));
    var ic = el('span', 'jor-ob-arq-ic'); ic.appendChild(ico('doc', 18)); li.appendChild(ic);
    var tx = el('div', 'jor-ob-arq-tx'); tx.appendChild(el('b', '', nome));
    var m = el('span', 'jor-ob-arq-m' + (e[1] === 'fo' ? ' er' : ''), est === 'lendo' ? 'Lendo e preenchendo o que está vazio…' : est === 'fila' ? 'Esperando a vez.' : msg);
    tx.appendChild(m); li.appendChild(tx);
    var lado = el('div', 'jor-ob-arq-l');
    var et = e[1] === 'fo' || e[1] === 'fp' ? h.etqFalta(e[0], e[1] === 'fo' ? 'ob' : 'op') : h.etq(e[0], e[1]); lado.appendChild(et);
    if (x && x.file && (est === 'erro' || est === 'falhou' || est === 'cota')) lado.appendChild(btn('Tentar de novo', 'jor-btn-link', function () { x.est = 'fila'; x.msg = ''; pintarFila(); rodarFila(); }));
    if (x && est !== 'lendo' && est !== 'fila') {
      var tirar = btn('', 'jor-btn-link jor-ob-x', function () { var F = filaDoCard(); F.itens = F.itens.filter(function (y) { return y !== x; }); pintarFila(); });
      tirar.appendChild(ico('x', 16)); tirar.setAttribute('aria-label', 'Tirar ' + nome + ' da lista'); lado.appendChild(tirar);
    }
    li.appendChild(lado);
    li.setAttribute('aria-busy', est === 'lendo' ? 'true' : 'false');
    return li;
  }
  /** "Orçamentos, pedidos e notas": a área única. Arrastar ou escolher; cada arquivo vira um POST, em fila. */
  function blocoArquivos(f2, c, pode) {
    var h = H(); var F = filaDoCard();
    var b = bloco('Orçamentos, pedidos e notas', c.documentos.length ? h.etq(h.plural(c.documentos.length, 'arquivo lido', 'arquivos lidos'), '') : null);
    if (pode) {
      var zona = el('div', 'jor-ob-drop');
      var zi = el('span', 'jor-ob-drop-ic'); zi.appendChild(ico('subir', 22)); zona.appendChild(zi);
      var zt = el('div', 'jor-ob-drop-tx');
      var toque = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);   // no celular não há o que arrastar
      zt.appendChild(el('b', '', toque ? 'Escolha os arquivos ou tire uma foto' : 'Arraste os arquivos aqui ou escolha'));
      zt.appendChild(el('span', '', 'Foto, PDF, print ou XML, vários de uma vez. Cada um é lido sozinho e só preenche o que está vazio.'));
      zona.appendChild(zt);
      var zb = el('div', 'jor-ob-drop-bts');
      zb.appendChild(botaoArquivo('Escolher arquivos', 'jor-btn-pri', ACEITA_COMPRA, true, false, 'Escolher orçamentos, pedidos e notas', enfileirar, 'subir'));
      zb.appendChild(botaoArquivo('Tirar foto', 'jor-ob-cel', 'image/*', false, true, 'Tirar foto de um orçamento, pedido ou nota', enfileirar, 'camera'));
      zona.appendChild(zb);
      var fundo = 0;
      zona.addEventListener('dragenter', function (e) { e.preventDefault(); fundo++; zona.classList.add('on'); });
      zona.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
      zona.addEventListener('dragleave', function () { fundo = Math.max(0, fundo - 1); if (!fundo) zona.classList.remove('on'); });
      zona.addEventListener('drop', function (e) { e.preventDefault(); fundo = 0; zona.classList.remove('on'); var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []); if (fs.length) enfileirar(fs); });
      b.appendChild(zona);
    }
    var fila = el('ul', 'jor-ob-arqs jor-ob-fila'); fila.setAttribute('aria-live', 'polite'); fila.setAttribute('aria-label', 'Arquivos enviados agora'); F.no = fila; b.appendChild(fila); pintarFila();
    // Obras do meio do caminho: a nota ligada direto na compra (antes da leitura nova) e quando a nota chega.
    var antigas = c.compras.filter(function (cp) {
      var temDoc = c.documentos.some(function (dc) { return dc.tipo === 'nota_fiscal' && (dc.compra_id === cp.id || (cp.nota && cp.nota.numero && dc.numero === cp.nota.numero)); });
      return !temDoc && (cp.nota || cp.nota_chega === 'com_a_carga' || cp.nota_chega === 'na_retirada');
    });
    if (c.documentos.length || antigas.length) {
      var ul = el('ul', 'jor-ob-arqs'); ul.setAttribute('aria-label', 'Arquivos lidos nesta obra');
      antigas.forEach(function (cp) {
        var li = el('li', 'jor-ob-arq'); var ic = el('span', 'jor-ob-arq-ic' + (cp.nota ? ' ok' : '')); ic.appendChild(ico('doc', 18)); li.appendChild(ic);
        var tx = el('div', 'jor-ob-arq-tx');
        tx.appendChild(el('b', '', ['Nota', cp.fornecedor, cp.nota && cp.nota.numero ? 'nº ' + cp.nota.numero : ''].filter(Boolean).join(' · ')));
        tx.appendChild(el('span', 'jor-ob-arq-m', cp.nota ? 'Anexada na compra' + (cp.data ? ' de ' + h.ddmm(cp.data) : '') + '.' : (cp.nota_chega === 'na_retirada' ? 'A nota vem na retirada. Anexe aqui quando chegar.' : 'A nota chega com a carga. Anexe aqui quando chegar.')));
        li.appendChild(tx);
        if (!cp.nota) { var lado = el('div', 'jor-ob-arq-l'); lado.appendChild(h.etqFalta('Falta a nota', 'op')); li.appendChild(lado); }
        ul.appendChild(li);
      });
      c.documentos.slice().reverse().forEach(function (dc) {
        var agora = F.itens.filter(function (x) { return x.est === 'lido' && x.doc && x.doc === dc.id; })[0];
        var li = el('li', 'jor-ob-arq' + (agora ? ' novo' : ''));
        var ic = el('span', 'jor-ob-arq-ic ok'); ic.appendChild(ico('doc', 18)); li.appendChild(ic);
        var tx = el('div', 'jor-ob-arq-tx');
        tx.appendChild(el('b', '', [TIPO_DOC[dc.tipo] || 'Arquivo', dc.fornecedor, dc.numero ? 'nº ' + dc.numero : ''].filter(Boolean).join(' · ')));
        var sub = [dc.data ? h.ddmm(dc.data) : '', dc.itens ? h.plural(dc.itens, 'item', 'itens') : '', typeof dc.total_centavos === 'number' && dc.total_centavos > 0 ? h.rs(dc.total_centavos) : '', dc.nome].filter(Boolean).join(' · ');
        if (sub) tx.appendChild(el('span', 'jor-ob-arq-m', sub));
        if (agora) tx.appendChild(el('span', 'jor-ob-arq-m ok', agora.msg));
        li.appendChild(tx); ul.appendChild(li);
      });
      b.appendChild(ul);
    } else if (!pode) b.appendChild(el('p', 'jor-nota', 'Nenhum arquivo lido ainda.'));
    return b;
  }
  function etapa4(esq, d, et, f2) {
    injetarCss(); var h = H(); var fechada = contaFechada(f2); var pode = podeSecao(f2, 'compra') && !fechada; var podeEq = podeEquip(f2);
    var c = compraDe(f2); var itens = itensBase(c);
    if (fechada && podeEq) { var nf = el('p', 'jor-nota', 'Conta fechada: o equipamento de cada item continua editável. Valor, compra e pagamento só o Thiago reabre.'); nf.setAttribute('role', 'note'); esq.appendChild(nf); }
    esq.appendChild(blocoArquivos(f2, c, pode));
    var eq = dados(f2).equipamento_final || {};
    var avisos = (f2.book && Array.isArray(f2.book.avisos) && f2.book.avisos.length) ? f2.book.avisos : (Array.isArray(eq.diferencas) && eq.diferencas.length ? ['Comprado diferente da proposta: ' + eq.diferencas.join('; ') + '.'] : []);
    var kk = [], mm = [];
    itens.forEach(function (i, k) { (ehKit(i) ? kk : mm).push(k); });
    // Kit
    var kit = c.kit;
    var etK = kit ? (kit.completo ? h.etq('Comprado ' + kit.comprados + ' de ' + kit.total, 'ok') : h.etqFalta(kit.faltam && kit.faltam.length ? 'Falta comprar ' + juntarE(kit.faltam) : 'Falta comprar', 'ob')) : null;
    var bK = bloco('Kit', etK);
    avisos.forEach(function (a) { var p = el('p', 'jor-aviso', a); p.setAttribute('role', 'note'); bK.appendChild(p); });
    if (!kk.length) bK.appendChild(el('p', 'jor-nota', 'Nenhum item do kit ainda. Anexe a nota ou o pedido acima, ou use + Item.'));
    else { var lk = el('ul', 'jor-ob-its'); kk.forEach(function (k) { lk.appendChild(linhaItem(itens, k, c, f2, pode, 'ob', podeEq)); }); bK.appendChild(lk); }
    esq.appendChild(bK);
    // Material elétrico
    var mat = c.material;
    var etM = mat && mat.total ? (mat.completo ? h.etq('Comprado ' + mat.comprados + ' de ' + mat.total, 'ok') : h.etqFalta('Falta comprar ' + (mat.total - mat.comprados) + ' de ' + mat.total, 'op')) : h.etqFalta('Opcional', 'op');
    var bM = bloco('Material elétrico', etM);
    if (!mm.length) bM.appendChild(el('p', 'jor-nota', 'Nenhum item ainda. Use a lista pronta ou + Item. Não segura a Logística.'));
    else { var lm = el('ul', 'jor-ob-its'); mm.forEach(function (k) { lm.appendChild(linhaItem(itens, k, c, f2, pode, 'op', podeEq)); }); bM.appendChild(lm); }
    if (pode) {
      var ac = el('div', 'jor-din-acoes');
      add(ac, btn('+ Item', '', function () { itemDialogo(-1, itens, c, f2); }), btn('Lista pronta de material', '', function () { listaProntaDialogo(itens, c, f2); }));
      bM.appendChild(ac);
    }
    esq.appendChild(bM);
    // O que falta pagar das compras (o pagamento entra no caixa, ligado à compra).
    var apagar = c.compras.filter(function (cp) { return typeof cp.a_pagar_centavos === 'number' && cp.a_pagar_centavos > 0; });
    if (apagar.length) {
      var bP = bloco('Falta pagar', h.etqFalta(h.plural(apagar.length, 'compra', 'compras'), 'op'));
      var ul = el('ul', 'jor-ob-its');
      apagar.forEach(function (cp) {
        var li = el('li', 'jor-ob-it'); var m = el('div', 'jor-ob-it-m');
        m.appendChild(el('b', 'jor-ob-it-d', cp.fornecedor || nomeCompra(cp, c.compras.indexOf(cp))));
        m.appendChild(el('span', 'jor-ob-it-s', 'Falta ' + h.rs(cp.a_pagar_centavos) + (Number(cp.pago_centavos) > 0 ? ' · pago ' + h.rs(cp.pago_centavos) : '')));
        li.appendChild(m);
        if (podeLancar()) { var l = el('div', 'jor-ob-it-l'); l.appendChild(btn('Lançar o pagamento', '', function () { pagarCompra(cp, itens); })); li.appendChild(l); }
        ul.appendChild(li);
      });
      bP.appendChild(ul); bP.appendChild(el('p', 'jor-nota', 'O pagamento entra no caixa do Resumo, com o comprovante.'));
      esq.appendChild(bP);
    }
  }
  /** Enquanto há gravação automática na fila (checklist ou pílulas), o redesenho guarda e devolve o que a pessoa digitou e ainda não salvou (jornada.js). */
  function manterFim() { if (!CHK.voo && !PIL.voo && !Object.keys(CHK.pend).length && !Object.keys(PIL.pend).length) H().O().manter = false; }
  function pilChave(i, k) { return i && i.id ? String(i.id) : 'k' + k; }
  /** Manda as marcas da fila num PUT só, sobre a lista MAIS RECENTE lida (nunca a do desenho velho), e repete até a fila esvaziar. Erro: desfaz só as marcas enviadas e avisa. */
  function pilFila() {
    if (PIL.voo) return;
    if (!Object.keys(PIL.pend).length) { manterFim(); return; }
    var h = H(); H().O().manter = true; var c = compraDe(O().fase2); var lista = itensBase(c); var enviado = {};
    lista.forEach(function (it, k) {
      var ch = it.id && PIL.pend[String(it.id)] !== undefined ? String(it.id) : PIL.pend['k' + k] !== undefined ? 'k' + k : '';
      if (ch) { it.comprado = PIL.pend[ch]; enviado[ch] = PIL.pend[ch]; }
    });
    Object.keys(PIL.pend).forEach(function (ch) { if (enviado[ch] === undefined) delete PIL.pend[ch]; });   // o item sumiu da lista
    var ks = Object.keys(enviado); if (!ks.length) { manterFim(); return; }
    PIL.voo = true;
    var aviso = ks.length > 1 ? 'Compras marcadas.' : enviado[ks[0]] ? 'Marcado como comprado.' : 'Voltou para previsto.';
    salvar('compra', { itens: lista, compras: clone(c.compras) }, aviso).then(function (r) { return r; }, function () { h.toast('Não consegui salvar agora. Tente de novo.'); return null; }).then(function (r) {
      PIL.voo = false;
      var ok = !!(r && r.status === 200 && r.json && r.json.ok !== false);
      ks.forEach(function (ch) { if (PIL.pend[ch] === enviado[ch]) delete PIL.pend[ch]; });
      if (ok) { pilFila(); return; }
      // Erro (409 incluído): a marca enviada volta ao que o servidor tem e a tela relê; o que ainda está na fila só segue sobre a versão nova.
      Promise.resolve(h.recarregar()).then(pilFila, pilFila);
    });
  }
  /** Uma linha de item: descrição, quantidade, fornecedor, origem e valor à esquerda; o tique "Comprado" e o Editar à direita. */
  function linhaItem(itens, k, c, f2, pode, nivel, podeEq) {
    var h = H(); var i = itens[k]; var desc = i.descricao || 'Item sem nome';
    var pk = pilChave(i, k); if (PIL.pend[pk] !== undefined) i.comprado = PIL.pend[pk];   // a marca que ainda está na fila vale mais que a lida
    var li = el('li', 'jor-ob-it' + (i.comprado ? ' on' : ''));
    var m = el('div', 'jor-ob-it-m');
    m.appendChild(el('b', 'jor-ob-it-d', desc));
    var sub = [qtdTxt(i), i.fornecedor, origemTxt(i)].filter(Boolean).join(' · '); if (sub) m.appendChild(el('span', 'jor-ob-it-s', sub));
    var orc = soOrcado(i, c);
    var v = valorTxt(i);
    if (v || orc) { var lv = el('span', 'jor-ob-it-v'); if (v) lv.appendChild(document.createTextNode(v)); if (orc) lv.appendChild(h.etqFalta('Orçado, não comprado', 'op')); m.appendChild(lv); }
    li.appendChild(m);
    var l = el('div', 'jor-ob-it-l');
    var p = el('button', 'jor-ob-pill' + (i.comprado ? ' on' : '')); p.type = 'button'; p.setAttribute('aria-pressed', i.comprado ? 'true' : 'false'); p.setAttribute('aria-label', 'Comprado: ' + desc);
    var bx = el('span', 'jor-ob-pill-bx'); if (i.comprado) bx.appendChild(h.icone('ok')); p.appendChild(bx); p.appendChild(el('span', '', 'Comprado'));
    // Só o kit contorna o que falta (vermelho, trava a Logística). O material já diz no título que falta e não trava.
    // A estrutura aparece no Kit, mas não segura a Logística: só módulo e inversor ficam em vermelho.
    p.disabled = !pode; var vermelho = nivel === 'ob' && !orc && i.tipo !== 'estrutura'; if (!i.comprado && vermelho) h.marcaFalta(p, nivel);
    p.addEventListener('click', function () {
      // Marca na hora e não desliga a pílula: o próximo clique, mesmo logo depois, entra na fila.
      var on = !i.comprado; i.comprado = on; PIL.pend[pk] = on;
      p.classList.toggle('on', on); li.classList.toggle('on', on); p.setAttribute('aria-pressed', on ? 'true' : 'false');
      bx.replaceChildren(); if (on) bx.appendChild(h.icone('ok'));
      h.marcaFalta(p, !on && vermelho ? nivel : '');
      pilFila();
    });
    l.appendChild(p);
    if (pode || podeEq) { var ed = btn('Editar', 'jor-btn-link', function () { itemDialogo(k, itens, c, f2); }); ed.setAttribute('aria-label', 'Editar ' + desc); l.appendChild(ed); }
    li.appendChild(l);
    return li;
  }
  /** Digitar ou editar um item. `k` = posição na lista (-1 = novo). "Nova compra deste fornecedor" cria a compra e liga o item, em dois passos. */
  function itemDialogo(k, itens, c, f2) {
    var h = H(); var novo = k < 0; var fechada = contaFechada(f2);
    var it = novo ? { id: null, origem: 'manual', tipo: 'eletrico', descricao: '', quantidade: 1, unidade: 'un', marca: '', modelo: '', fornecedor: '', valor_centavos: null, data: '', etapa: 4, compra_id: null, comprado: false } : clone(itens[k]);
    var ctl = {};
    h.dialogo(novo ? 'Novo item' : 'Item da compra', function (box) {
      var g = el('div', 'jor-ob-par');
      ctl.desc = entrada('text', it.descricao, 'Descrição'); ctl.tipo = selecao(TIPOS, it.tipo || 'outro', 'Tipo'); ctl.qtd = entrada('text', it.quantidade === null || it.quantidade === undefined ? '' : String(it.quantidade).replace('.', ','), 'Quantidade'); ctl.qtd.inputMode = 'decimal';
      ctl.un = selecao(UNIDADES, it.unidade || 'un', 'Unidade'); ctl.marca = entrada('text', it.marca || '', 'Marca'); ctl.modelo = entrada('text', it.modelo || '', 'Modelo');
      ctl.forn = entrada('text', it.fornecedor || '', 'Fornecedor');
      ctl.compra = selecao([['', 'Sem compra ainda']].concat(c.compras.map(function (cp, i) { return [cp.id, nomeCompra(cp, i)]; })).concat([['__nova', 'Nova compra deste fornecedor']]), it.compra_id || '', 'Compra');
      ctl.valor = entrada('text', Number(it.valor_centavos) > 0 ? txtCents(it.valor_centavos) : '', 'Valor total do item'); ctl.valor.inputMode = 'decimal';
      ctl.data = entrada('date', it.data || '', 'Data da compra');
      var mostraValor = veDinheiro() && it.valor_centavos !== undefined;
      // Conta fechada: valor, compra, data e o tique são dinheiro e ficam só para leitura.
      if (fechada) { [ctl.valor, ctl.compra, ctl.data].forEach(function (x) { x.disabled = true; }); ctl.valor.readOnly = true; }
      add(g, campo('Descrição', ctl.desc), campo('Tipo', ctl.tipo), campo('Quantidade', ctl.qtd), campo('Unidade', ctl.un), campo('Marca', ctl.marca), campo('Modelo', ctl.modelo), campo('Fornecedor', ctl.forn), campo('Compra', ctl.compra), mostraValor ? campo('Valor total (R$)', ctl.valor) : null, campo('Data', ctl.data));
      box.appendChild(g);
      ctl.comp = marca('Comprado', !!it.comprado, 'Comprado'); ctl.comp.input.disabled = fechada; box.appendChild(ctl.comp);
      if (fechada) box.appendChild(el('p', 'jor-nota', 'Conta fechada: valor, compra e data só mudam se o Thiago reabrir a conta.'));
      var gm = el('div', 'jor-ob-par');
      ctl.pw = entrada('text', it.potencia_w || '', 'Potência (W)'); ctl.fab = entrada('text', it.garantia_fabricacao_anos || '', 'Fabricação (anos)'); ctl.des = entrada('text', it.garantia_desempenho_anos || '', 'Desempenho (anos)');
      ctl.pk = entrada('text', it.potencia_kw || '', 'Potência (kW)'); ctl.gi = entrada('text', it.garantia_anos || '', 'Garantia (anos)');
      var cert = el('div');
      function mostrar() {
        gm.replaceChildren(); cert.replaceChildren();
        if (ctl.tipo.value === 'modulo') add(gm, campo('Potência de cada placa (W)', ctl.pw), campo('Garantia de fabricação (anos)', ctl.fab), campo('Garantia de desempenho (anos)', ctl.des));
        if (ctl.tipo.value === 'inversor') add(gm, campo('Potência (kW)', ctl.pk), campo('Garantia (anos)', ctl.gi));
        if (!novo && ctl.tipo.value === 'modulo') cert.appendChild(h.anexo('cert_modulo', 'Certificado de garantia das placas', arqs(f2, 'cert_modulo').length > 0, { nivel: 'op' }));
        if (!novo && ctl.tipo.value === 'inversor') cert.appendChild(h.anexo('cert_inversor', 'Certificado de garantia do inversor', arqs(f2, 'cert_inversor').length > 0, { nivel: 'op' }));
      }
      ctl.tipo.addEventListener('change', mostrar);
      ctl.info = el('p', 'jor-erro'); ctl.info.setAttribute('role', 'status');
      add(box, gm, cert, ctl.info); mostrar();
      // Remover: a confirmação mora dentro do diálogo (o confirm do navegador não abre aqui).
      if (!novo && !fechada) {
        var rm = el('div', 'jor-ob-rm');
        var pinta = function (perg) {
          rm.replaceChildren();
          if (!perg) { rm.appendChild(btn('Remover item', 'jor-btn-link jor-ob-rm-b', function () { pinta(true); })); return; }
          var q = el('p', 'jor-ob-rm-q', 'Tirar ' + (it.descricao || 'este item') + ' da Compra?'); rm.appendChild(q);
          var ac = el('div', 'jor-din-acoes');
          var sim = btn('Sim, remover', 'jor-btn jor-ob-rm-sim', function () {
            sim.disabled = true; var lista = itens.filter(function (x, j) { return j !== k; });
            salvar('compra', { itens: lista, compras: clone(c.compras) }, 'Item removido.').then(function (r) {
              if (r && r.status === 200) { h.fecharDlg(); return; }
              sim.disabled = false; ctl.info.textContent = msgSrv(r, 'Não consegui remover agora.');
            });
          });
          add(ac, sim, btn('Manter', '', function () { pinta(false); })); rm.appendChild(ac);
          try { sim.focus(); } catch (e) { /* sem foco */ }
        };
        pinta(false); box.appendChild(rm);
      }
      return { foco: ctl.desc };
    }, 'Salvar', function (b) {
      var q = ctl.qtd.value.trim() ? Number(ctl.qtd.value.replace(/\./g, '').replace(',', '.')) : null;
      var v = veDinheiro() ? h.cents(ctl.valor.value) : null;
      if (!ctl.desc.value.trim()) { ctl.info.textContent = 'Diga o que é o item.'; return; }
      if (q !== null && !(q > 0)) { ctl.info.textContent = 'Use só números na quantidade.'; return; }
      if (!fechada && typeof v === 'number' && isNaN(v)) { ctl.info.textContent = 'Use um valor em reais, como 1.250,00.'; return; }
      var nova = !fechada && ctl.compra.value === '__nova';
      if (nova && !ctl.forn.value.trim()) { ctl.info.textContent = 'Diga o fornecedor da compra nova.'; return; }
      it.descricao = ctl.desc.value.trim(); it.tipo = ctl.tipo.value; it.quantidade = q; it.unidade = ctl.un.value; it.marca = ctl.marca.value.trim(); it.modelo = ctl.modelo.value.trim();
      it.fornecedor = ctl.forn.value.trim();
      if (!fechada) { it.compra_id = nova ? null : (ctl.compra.value || null); if (veDinheiro() && it.valor_centavos !== undefined) it.valor_centavos = v > 0 ? v : null; it.data = ctl.data.value || ''; it.comprado = ctl.comp.input.checked; }
      if (it.tipo === 'modulo') { it.potencia_w = Number(ctl.pw.value.replace(',', '.')) || null; it.garantia_fabricacao_anos = Number(ctl.fab.value) || null; it.garantia_desempenho_anos = Number(ctl.des.value) || null; }
      if (it.tipo === 'inversor') { it.potencia_kw = Number(ctl.pk.value.replace(',', '.')) || null; it.garantia_anos = Number(ctl.gi.value) || null; }
      b.disabled = true;
      var lista = itens.slice(); var pos = novo ? lista.length : k;
      if (novo) lista.push(it); else lista[k] = it;
      var compras = clone(c.compras);
      if (nova) compras.push({ id: null, fornecedor: it.fornecedor, cidade: '', data: it.data || hoje(), forma: '', nota_chega: 'anexada', nota: null });
      salvar('compra', { itens: lista, compras: compras }, nova ? 'Compra criada.' : 'Item salvo.').then(function (r) {
        if (r.status !== 200) { b.disabled = false; ctl.info.textContent = msgSrv(r, 'Não consegui salvar agora.'); return; }
        if (!nova) { h.fecharDlg(); return; }
        var c2 = compraDe(O().fase2); var cp = c2.compras[c2.compras.length - 1]; var l2 = clone(c2.itens);
        if (cp && l2[pos]) { l2[pos].compra_id = cp.id; return salvar('compra', { itens: l2, compras: clone(c2.compras) }, 'Item salvo.').then(function () { h.fecharDlg(); }); }
        h.fecharDlg();
      });
    });
  }
  function listaProntaDialogo(itens, c, f2) {
    var h = H(); var lista = (f2.lista_pronta || []).filter(function (x) { return x.tipo !== 'estrutura' || !itens.some(function (i) { return i.descricao === x.descricao; }); }); var marcas = [];
    h.dialogo('Lista pronta de material', function (box) {
      box.appendChild(el('p', 'jor-nota', 'Os itens de sempre. Marque os que entram nesta obra. A quantidade entra depois, no Editar ou pela nota.'));
      lista.forEach(function (x) { var ja = itens.some(function (i) { return i.descricao === x.descricao; }); var m = marca(x.descricao + ' (' + (x.unidade || 'un') + ')' + (ja ? ' · já na lista' : ''), false, x.descricao); m.input.disabled = ja; box.appendChild(m); marcas.push([x, m]); });
      return {};
    }, 'Adicionar', function (b) {
      var novos = marcas.filter(function (p) { return p[1].input.checked; }).map(function (p) {
        return { id: null, origem: 'lista', tipo: p[0].tipo || 'eletrico', descricao: p[0].descricao, quantidade: null, unidade: p[0].unidade || 'un', marca: '', modelo: '', fornecedor: '', valor_centavos: null, data: '', etapa: 4, compra_id: null, comprado: false };
      });
      if (!novos.length) { h.fecharDlg(); return; }
      b.disabled = true;
      salvar('compra', { itens: itens.concat(novos), compras: clone(c.compras) }, 'Itens adicionados.').then(function (r) { if (r.status === 200) h.fecharDlg(); else b.disabled = false; });
    });
  }
  function pagarCompra(cp, itens) {
    var tem = itens.some(function (x) { return x.compra_id === cp.id && (x.tipo === 'modulo' || x.tipo === 'inversor'); });
    var falta = Number(cp.a_pagar_centavos) > 0 ? Number(cp.a_pagar_centavos) : somaItens(itens, cp.id);
    D().lancar({ tipo: 'saida', etapa: 4, categoria: tem ? 'equipamento' : 'material', compra_id: cp.id, valor_sugerido: falta || null, contraparte: cp.fornecedor });
  }

  // ── 7 · Logística ─────────────────────────────────────────────────────────────────────────────────────
  function cargaNova(n, itens, nome) {
    return { id: null, nome: nome || 'Carga ' + n, itens: (itens || []).slice(), saida: { lugar: '', em: '' }, chegada: { lugar: '', destino: 'obra', em: '' }, transporte: { empresa: '', motorista: '', cpf: '', placa: '' }, compras: [],
      recebido_por: { nome: '', cpf: '', assinatura_id: '' }, conferencia: { itens_ok: [], foto_id: '' }, fotos: [], avaria: { tem: false, descricao: '', foto_id: '', o_que_fazer: '', resolvida: false },
      frete: { valor_centavos: null, forma: '' }, documentos: [] };
  }
  /** O que falta numa carga (a mesma regra do portão da api: onde, data, placa, quem buscou com CPF, quem recebeu e 1 foto). */
  function faltaCarga(cg, f2) {
    var f = [];
    if (!String(cg.saida.lugar || '').trim()) f.push('onde buscou');
    if (!cg.saida.em && !cg.chegada.em) f.push('a data');
    if (!placaOk(cg.transporte.placa)) f.push('a placa');
    if (!String(cg.transporte.motorista || '').trim()) f.push('quem buscou');
    if (!cpfOk(cg.transporte.cpf)) f.push('o CPF de quem buscou');
    if (!String(cg.recebido_por.nome || '').trim()) f.push('quem recebeu');
    if (!(cg.fotos || []).some(function (id) { return existe(f2, id); }) && !existe(f2, cg.conferencia.foto_id)) f.push('1 foto');
    return f;
  }
  function etapa5(esq, d, et, f2) {
    injetarCss(); var h = H();
    var cargas = ((dados(f2).logistica || {}).cargas || []).map(clone); var pode = podeSecao(f2, 'logistica');
    var c = compraDe(f2); var itensCompra = c.itens.filter(function (i) { return !!i.id; });
    var idsKit = (c.kit && Array.isArray(c.kit.ids)) ? c.kit.ids : itensCompra.filter(ehKit).map(function (i) { return i.id; });
    // A primeira carga já nasce com os itens do kit marcados (só grava quando a pessoa salva).
    if (!cargas.length) cargas.push(cargaNova(1, idsKit, 'Kit'));
    cargas.forEach(function (cg, i) { esq.appendChild(cartaoCarga(cg, i, cargas, itensCompra, c, f2, pode, d, idsKit)); });
    if (pode) {
      var ac = el('div', 'jor-din-acoes');
      ac.appendChild(btn('+ Carga', '', function () { var n = cargas.concat([cargaNova(cargas.length + 1, [], 'Material')]); salvar('logistica', { cargas: n }, 'Carga criada.'); }));
      ac.appendChild(el('span', 'jor-nota', 'Para o material que vier depois. Não segura a Obra.'));
      esq.appendChild(ac);
    }
  }
  function cartaoCarga(cg, idx, todas, itensCompra, c, f2, pode, d, idsKit) {
    var h = H(); var bx = el('section', 'jor-ob-carga'); bx.setAttribute('data-carga', String(idx));
    cg.transporte = cg.transporte || {}; cg.recebido_por = cg.recebido_por || {}; cg.saida = cg.saida || {}; cg.chegada = cg.chegada || { destino: 'obra' }; cg.fotos = cg.fotos || []; cg.conferencia = cg.conferencia || { itens_ok: [], foto_id: '' };
    cg.avaria = cg.avaria || { tem: false }; cg.frete = cg.frete || { valor_centavos: null, forma: '' };
    var doKit = cg.itens.some(function (id) { return idsKit.indexOf(id) >= 0; }) || (!cg.id && idx === 0);
    var nivel = doKit ? 'ob' : 'op';
    function gravar(aviso) { return salvar('logistica', { cargas: todas.map(function (x, k) { return k === idx ? cg : x; }) }, aviso || 'Carga salva.'); }
    // Topo: nome, situação e o que falta numa frase.
    var t = el('div', 'jor-ob-carga-t'); var tt = el('h4', '', 'Carga ' + (idx + 1) + (cg.nome ? ' · ' + cg.nome : '')); tt.id = 'jor-cg-' + idx; t.appendChild(tt); bx.setAttribute('aria-labelledby', tt.id);
    var est = el('span', 'jor-ob-carga-e'); t.appendChild(est); bx.appendChild(t);
    var frase = el('p', 'jor-ob-carga-f'); bx.appendChild(frase);
    if (!cg.id) bx.appendChild(el('p', 'jor-nota', 'Os itens do kit já vêm marcados. Preencha e salve.'));
    var ctl = {};
    function pinta() {
      var f = faltaCarga(cg, f2);
      est.replaceChildren(f.length ? h.etqFalta('Falta ' + f.length, nivel) : h.etq('Completa', 'ok'));
      frase.textContent = f.length ? 'Falta ' + juntarE(f) + '.' : (doKit ? 'Carga do kit completa.' : 'Carga completa.');
      frase.className = 'jor-ob-carga-f' + (f.length ? (nivel === 'ob' ? ' er' : ' av') : ' ok');
      // Só a carga do kit contorna os campos (vermelho, trava a Obra). A de material diz o que falta no topo e não pinta campo.
      var mk = function (no, falta) { if (no) h.marcaFalta(no, falta && nivel === 'ob' ? 'ob' : ''); };
      mk(ctl.onde, !String(cg.saida.lugar || '').trim()); mk(ctl.quando, !cg.saida.em && !cg.chegada.em);
      mk(ctl.placa, !placaOk(cg.transporte.placa)); mk(ctl.quem, !String(cg.transporte.motorista || '').trim()); mk(ctl.cpf, !cpfOk(cg.transporte.cpf));
      mk(ctl.rec, !String(cg.recebido_por.nome || '').trim());
      mk(ctl.fotos, f.indexOf('1 foto') >= 0);
    }
    // Retirada e Na obra, lado a lado (no celular, uma embaixo da outra, ligadas por um trilho).
    var traj = el('div', 'jor-ob-traj'); bx.appendChild(traj);
    function ponta(cls, titulo) { var p = el('section', 'jor-ob-ponta ' + cls); var tp = el('h5', 'jor-ob-ponta-t'); tp.appendChild(el('i', 'jor-ob-pino')); tp.appendChild(el('span', '', titulo)); p.appendChild(tp); p.setAttribute('aria-label', titulo); return p; }
    var pRet = ponta('ret', 'Retirada'); var meio = el('div', 'jor-ob-traj-meio'); var pEnt = ponta('ent', 'Na obra');
    add(traj, pRet, meio, pEnt);
    var fornDe = ''; cg.itens.forEach(function (id) { var it = itensCompra.filter(function (x) { return x.id === id; })[0]; var cp = it && c.compras.filter(function (x) { return x.id === it.compra_id; })[0]; if (cp && !fornDe) fornDe = [cp.fornecedor, cp.cidade].filter(Boolean).join(', '); });
    if (!cg.saida.lugar && fornDe) cg.saida.lugar = fornDe;
    ctl.onde = entrada('text', cg.saida.lugar || '', 'Onde buscou, lugar e endereço'); ctl.onde.placeholder = 'Ex.: Aldo Solar, Av. Brasil 1200, Maringá…'; ctl.onde.disabled = !pode;
    ctl.onde.addEventListener('input', function () { cg.saida.lugar = ctl.onde.value; pinta(); });
    var lOnde = campo('Onde buscou', ctl.onde);
    if (fornDe && cg.saida.lugar === fornDe) { var au = automatico(); au.title = 'Veio do fornecedor, na Compra.'; var rl = el('span', 'jor-ob-rotl'); rl.appendChild(lOnde.firstChild); rl.appendChild(au); lOnde.insertBefore(rl, lOnde.firstChild); }
    ctl.quando = entrada('datetime-local', cg.saida.em || '', 'Quando buscou'); ctl.quando.disabled = !pode;
    ctl.carro = entrada('text', cg.transporte.carro || '', 'Carro, modelo'); ctl.carro.placeholder = 'Ex.: Strada branca…'; ctl.carro.disabled = !pode; ctl.carro.maxLength = 80;
    ctl.carro.addEventListener('input', function () { cg.transporte.carro = ctl.carro.value; });
    var cpPl = campoMascara('Placa', cg.transporte.placa || '', 'Placa do carro', placaMasc, placaCrua, placaOk, 'Use ABC1D23 ou ABC1234.', function (v) { cg.transporte.placa = v; pinta(); }, pode, '');
    ctl.placa = cpPl.querySelector('input');
    ctl.quem = entrada('text', cg.transporte.motorista || '', 'Quem buscou'); ctl.quem.disabled = !pode; ctl.quem.autocomplete = 'off';
    ctl.quem.addEventListener('input', function () { cg.transporte.motorista = ctl.quem.value; pinta(); });
    var cpB = campoMascara('CPF', cg.transporte.cpf || '', 'CPF de quem buscou', cpfMasc, soDig, cpfOk, 'CPF inválido. Confira os 11 números.', function (v) { cg.transporte.cpf = v; pinta(); }, pode, 'numeric');
    ctl.cpf = cpB.querySelector('input');
    var g1 = el('div', 'jor-ob-dupla'); add(g1, campo('Carro (modelo)', ctl.carro), cpPl);
    var g2 = el('div', 'jor-ob-dupla jor-ob-cpfpl'); add(g2, campo('Quem buscou', ctl.quem), cpB);
    add(pRet, lOnde, campo('Quando buscou', ctl.quando), g1, g2);
    ctl.rec = entrada('text', cg.recebido_por.nome || '', 'Quem recebeu na obra'); ctl.rec.disabled = !pode; ctl.rec.autocomplete = 'off';
    ctl.rec.addEventListener('input', function () { cg.recebido_por.nome = ctl.rec.value; pinta(); });
    var cpR = campoMascara('CPF (opcional)', cg.recebido_por.cpf || '', 'CPF de quem recebeu', cpfMasc, soDig, cpfOk, 'CPF inválido. Confira os 11 números.', function (v) { cg.recebido_por.cpf = v; pinta(); }, pode, 'numeric');
    ctl.cpfR = cpR.querySelector('input');
    var cheg = entrada('datetime-local', cg.chegada.em || '', 'Quando chegou na obra'); cheg.disabled = !pode;
    add(pEnt, campo('Quem recebeu', ctl.rec), cpR, campo('Quando chegou (opcional)', cheg));
    var tempo = el('b', 'jor-ob-tempo'); add(meio, el('small', '', 'Na estrada'), tempo);
    function atualizaTempo() { var x = duracao(ctl.quando.value, cheg.value); tempo.textContent = x || (ctl.quando.value ? 'A caminho' : 'Sem data'); meio.classList.toggle('ok', !!x); }
    ctl.quando.addEventListener('input', function () { cg.saida.em = ctl.quando.value; atualizaTempo(); pinta(); });
    cheg.addEventListener('input', function () { cg.chegada.em = cheg.value; cg.chegada.destino = 'obra'; atualizaTempo(); pinta(); });
    atualizaTempo();
    // Fotos do material (álbum da carga).
    var bF = el('div', 'jor-ob-sub-b'); bF.appendChild(el('h5', 'jor-ob-cl0', 'Fotos do material'));
    var idsF = cg.fotos.filter(function (id) { return existe(f2, id); }); if (existe(f2, cg.conferencia.foto_id) && idsF.indexOf(cg.conferencia.foto_id) < 0) idsF.unshift(cg.conferencia.foto_id);
    if (idsF.length) bF.appendChild(miniaturas(f2, idsF, 'Foto do material'));
    var fx = el('div', 'jor-ob-addfoto'); ctl.fotos = fx;
    fx.appendChild(el('span', 'jor-ob-sub', idsF.length ? H().plural(idsF.length, 'foto', 'fotos') + '.' : 'Pelo menos 1 foto do material.'));
    if (pode) fx.appendChild(botaoArquivo('Adicionar fotos', '', 'image/*', true, false, 'Adicionar fotos do material da carga ' + (idx + 1), function (fs) { fotosCarga(cg, idx, todas, fs); }, 'camera'));
    bF.appendChild(fx); bx.appendChild(bF);
    // Itens que vieram (kit e material).
    var bI = el('div', 'jor-ob-sub-b'); bI.appendChild(el('h5', 'jor-ob-cl0', 'Itens que vieram'));
    if (!itensCompra.length) bI.appendChild(el('p', 'jor-nota', 'A Compra ainda não tem itens.'));
    [['Kit', itensCompra.filter(ehKit)], ['Material elétrico', itensCompra.filter(function (i) { return !ehKit(i); })]].forEach(function (g) {
      if (!g[1].length) return;
      bI.appendChild(el('span', 'jor-ob-sub jor-ob-gt', g[0])); var gr = el('div', 'jor-ob-chks jor-ob-chk2');
      g[1].forEach(function (i) {
        var m = marca((qtdTxt(i) ? qtdTxt(i) + ' · ' : '') + i.descricao, cg.itens.indexOf(i.id) >= 0, 'Veio nesta carga: ' + i.descricao); m.input.disabled = !pode;
        m.input.addEventListener('change', function () { var k = cg.itens.indexOf(i.id); if (m.input.checked && k < 0) cg.itens.push(i.id); if (!m.input.checked && k >= 0) cg.itens.splice(k, 1); });
        gr.appendChild(m);
      });
      bI.appendChild(gr);
    });
    bx.appendChild(bI);
    // Avaria (opcional) e frete (opcional).
    var bA = el('div', 'jor-ob-sub-b'); var tA = el('div', 'jor-ob-linha0'); tA.appendChild(el('h5', 'jor-ob-cl0', 'Teve avaria?'));
    var fa = el('div', 'jor-filtros'); fa.setAttribute('role', 'group'); fa.setAttribute('aria-label', 'Teve avaria na carga ' + (idx + 1));
    [[false, 'Não'], [true, 'Sim']].forEach(function (o) {
      var b = el('button', 'jor-chip' + (!!cg.avaria.tem === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.disabled = !pode; b.setAttribute('aria-pressed', !!cg.avaria.tem === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (!!cg.avaria.tem === o[0]) return; var antes = !!cg.avaria.tem; cg.avaria.tem = o[0];
        gravar('Salvo.').then(function (r) { if (!r || r.status !== 200) { cg.avaria.tem = antes; H().desenhar(); } });
      }); fa.appendChild(b);
    });
    tA.appendChild(fa); bA.appendChild(tA);
    if (cg.avaria.tem) {
      var ao = el('textarea', 'jor-ta'); ao.maxLength = 400; ao.value = cg.avaria.descricao || cg.avaria.o_que_fazer || ''; ao.setAttribute('aria-label', 'O que aconteceu e o que fazer'); ao.disabled = !pode;
      ao.addEventListener('input', function () { cg.avaria.descricao = ao.value; });
      bA.appendChild(campo('O que aconteceu e o que fazer', ao));
      if (pode) bA.appendChild(anexoLigado(f2, 'log_avaria', 'Foto da avaria', cg.avaria.foto_id, function (id) { cg.avaria.foto_id = id; return gravar('Foto guardada.'); }, 'op'));
      var rv = marca('Resolvida', cg.avaria.resolvida, 'Avaria resolvida'); rv.input.disabled = !pode; rv.input.addEventListener('change', function () { cg.avaria.resolvida = rv.input.checked; });
      bA.appendChild(rv);
    }
    bx.appendChild(bA);
    // Frete: o valor só existe para quem vê o dinheiro (null = nada aparece). O pagamento entra no caixa.
    if (veDinheiro()) {
      var bR = el('div', 'jor-ob-sub-b');
      var fv = entrada('text', Number(cg.frete.valor_centavos) > 0 ? txtCents(cg.frete.valor_centavos) : '', 'Valor do frete'); fv.inputMode = 'decimal'; fv.placeholder = 'Vazio quando vem incluso…'; fv.disabled = !pode;
      fv.addEventListener('input', function () { var v = h.cents(fv.value); cg.frete.valor_centavos = (typeof v === 'number' && v > 0) ? v : 0; });
      var lf = el('div', 'jor-ob-linha0'); lf.appendChild(campo('Frete (R$, opcional)', fv));
      if (cg.id && podeLancar()) lf.appendChild(btn('Lançar o frete no caixa', 'jor-btn-link', function () { D().lancar({ tipo: 'saida', etapa: 5, categoria: 'frete', carga_id: cg.id, valor_sugerido: Number(cg.frete.valor_centavos) > 0 ? cg.frete.valor_centavos : null }); }));
      bR.appendChild(lf); bx.appendChild(bR);
    }
    if (pode) {
      var bt = el('div', 'jor-ob-carga-pe'); var sv = btn('Salvar a carga', '', function () { sv.disabled = true; gravar('Carga salva.').then(function () { sv.disabled = false; }); }); bt.appendChild(sv); bx.appendChild(bt);
    }
    pinta();
    return bx;
  }
  /** Fotos novas da carga: salva a carga se ela ainda não existe, sobe as fotos e liga os ids no álbum dela. */
  function fotosCarga(cg, idx, todas, files) {
    var h = H(); h.toast('Enviando ' + h.plural(files.length, 'foto', 'fotos') + '…');
    var antes = cg.id ? Promise.resolve(true) : salvar('logistica', { cargas: todas.map(function (x, k) { return k === idx ? cg : x; }) }, 'Carga salva.').then(function (r) {
      var nova = r.status === 200 && ((dados(O().fase2).logistica || {}).cargas || [])[idx]; if (nova) cg.id = nova.id; return !!nova;
    });
    antes.then(function (ok) {
      if (!ok) return null;
      return subirAlbum('log_conferencia', files).then(function (ids) {
        if (!ids) return null;
        if (!ids.length) return h.recarregar();
        cg.fotos = (cg.fotos || []).concat(ids);
        return salvar('logistica', { cargas: todas.map(function (x, k) { return k === idx ? cg : x; }) }, ids.length === 1 ? 'Foto guardada.' : ids.length + ' fotos guardadas.');
      });
    });
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

  // ── 8 · Obra ──────────────────────────────────────────────────────────────────────────────────────────
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
    var u = urlDe(id); if (u) { var im = el('img'); im.alt = ''; im.src = u; im.loading = 'lazy'; im.width = 76; im.height = 76; b.appendChild(im); }
    b.appendChild(el('span', '', rot)); if (aoClicar) b.addEventListener('click', aoClicar); return b;
  }
  /** O álbum de fotos (vários arquivos no mesmo item): a grade de miniaturas e o Adicionar. `resumo` é a linha de cima; sem ela, a contagem. */
  function blocoAlbum(f2, slot, titulo, resumo, podeAdd, opc) {
    var h = H(); opc = opc || {}; var album = arqs(f2, slot); var lim = ALBUNS[slot] || 100;
    var b = el('div', 'jor-ob-sub-b'); var t = el('div', 'jor-ob-linha0'); t.appendChild(el('h5', 'jor-ob-cl0', titulo)); if (opc.etq) t.appendChild(opc.etq); b.appendChild(t);
    if (opc.nota) b.appendChild(el('p', 'jor-nota', opc.nota));
    var linha1 = resumo || '';
    if (linha1) b.appendChild(el('p', 'jor-nota', linha1));
    if (album.length) { var alb = el('div', 'jor-ob-album'); album.forEach(function (a) { var dd = a.em ? h.ddmm(String(a.em).slice(0, 10)) : 'foto'; alb.appendChild(fotoMini(a.id, dd, false, null)); }); b.appendChild(alb); }
    if (podeAdd && album.length < lim) {
      var ax = el('div', 'jor-ob-addfoto'); if (opc.falta) h.marcaFalta(ax, opc.falta);
      ax.appendChild(el('span', 'jor-ob-sub', album.length ? h.plural(album.length, 'foto', 'fotos') + ' de ' + lim + '.' : 'Nenhuma foto ainda.'));
      ax.appendChild(botaoArquivo(opc.rotAdd || 'Adicionar fotos', '', 'image/*', true, false, 'Adicionar ' + (opc.aria || titulo), function (arquivos) {
        var st = vdcAgora();
        if (!st || String(st.id) !== String(O().card) || st.carregando || typeof window.vdcAnexar !== 'function') { h.toast('Os anexos ainda estão carregando. Tente de novo em instantes.'); return; }
        h.toast('Enviando ' + h.plural(arquivos.length, 'foto', 'fotos') + '…');
        Promise.resolve(window.vdcAnexar(st, { chave: slot }, arquivos)).then(function () { h.recarregar(); });
      }, 'camera'));
      b.appendChild(ax);
    } else if (podeAdd) b.appendChild(el('p', 'jor-nota', 'O álbum chegou ao limite de ' + lim + ' fotos.'));
    return b;
  }
  var DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function diaSemana(ymd) { var d = new Date(String(ymd) + 'T12:00:00'); return isNaN(d) ? '' : DIAS_SEMANA[d.getDay()]; }
  /** Manda as marcas da fila do checklist num PUT só, sobre o objeto da obra MAIS RECENTE lido (nunca o do desenho velho), e repete até a fila esvaziar.
   *  Erro (409 incluído): some só o que foi enviado, a tela relê e o aviso vem do salvar. */
  function chkFila() {
    if (CHK.voo) return;
    if (!Object.keys(CHK.pend).length) { manterFim(); return; }
    var h = H(); h.O().manter = true; var enviado = {};
    // Só a versão lida da obra + as marcas da fila. O texto digitado e não salvo fica para o Salvar da seção dele.
    var ob = clone(dados(h.O().fase2).obra) || {}; ob.plano = ob.plano || []; ob.diario = ob.diario || []; ob.checklist = ob.checklist || {}; ob.equipe = ob.equipe || { combinado_centavos: null, descricao: '' };
    Object.keys(CHK.pend).forEach(function (k) { enviado[k] = CHK.pend[k]; ob.checklist[k] = enviado[k]; });
    var ks = Object.keys(enviado); CHK.voo = true;
    salvar('obra', ob, 'Checklist salvo.').then(function (r) { return r; }, function () { h.toast('Não consegui salvar agora. Tente de novo.'); return null; }).then(function (r) {
      CHK.voo = false;
      var ok = !!(r && r.status === 200 && r.json && r.json.ok !== false);
      ks.forEach(function (k) { if (CHK.pend[k] === enviado[k]) delete CHK.pend[k]; });
      if (ok) { chkFila(); return; }
      Promise.resolve(h.recarregar()).then(chkFila, chkFila);
    });
  }
  function etapa6(esq, d, et, f2) {
    injetarCss(); var h = H(); var pode = podeSecao(f2, 'obra'); var l = livro();
    var ob = clone(dados(f2).obra) || {}; ob.plano = ob.plano || []; ob.diario = ob.diario || []; ob.checklist = ob.checklist || {}; ob.equipe = ob.equipe || { combinado_centavos: null, descricao: '' };
    Object.keys(CHK.pend).forEach(function (k) { ob.checklist[k] = CHK.pend[k]; });   // a marca que ainda está na fila vale mais que a lida
    // Redesenho de gravação automática: o diário, o plano e a equipe do desenho anterior (com o que ainda não foi salvo) seguem; só o Salvar deles grava.
    if (h.O().manter && CHK.ob && CHK.card === h.O().card) { ob.plano = CHK.ob.plano; ob.diario = CHK.ob.diario; ob.equipe = CHK.ob.equipe; }
    var equipes = (f2.equipes && f2.equipes.length) ? f2.equipes : [{ id: 'pablo', rotulo: 'Equipe Pablo (montagem)' }];
    function salvarObra(aviso) { return salvar('obra', ob, aviso || 'Obra salva.'); }
    function botaoObra(rot, aviso) { var b = btn(rot, '', function () { b.disabled = true; salvarObra(aviso).then(function () { b.disabled = false; }); }); b.disabled = !pode; return b; }
    // 1. Diário: um registro por dia, com pelo menos 1 foto. Horário é opcional.
    var comFoto = ob.diario.filter(function (x) { return (x.fotos || []).some(function (id) { return existe(f2, id); }); }).length;
    var bD = bloco('Diário da obra', ob.diario.length ? (comFoto ? h.etq(h.plural(ob.diario.length, 'dia', 'dias') + ', ' + comFoto + ' com foto', 'ok') : h.etqFalta('Falta 1 dia com foto', 'ob')) : h.etqFalta('Falta 1 dia com foto', 'ob'));
    var lista = el('div', 'jor-ob-dias'); bD.appendChild(lista);
    function pintaDias() {
      lista.replaceChildren();
      if (!ob.diario.length) lista.appendChild(el('p', 'jor-nota', 'Nenhum dia ainda. Use + Dia no primeiro dia de obra.'));
      ob.diario.forEach(function (dr, i) {
        dr.fotos = dr.fotos || [];
        var ids = dr.fotos.filter(function (id) { return existe(f2, id); });
        var cx = el('section', 'jor-ob-carga jor-ob-dia');
        var t = el('div', 'jor-ob-carga-t'); var tt = el('h4', '', 'Dia ' + (i + 1) + (dr.data ? ' · ' + h.ddmm(dr.data) + (diaSemana(dr.data) ? ', ' + diaSemana(dr.data) : '') : '')); t.appendChild(tt);
        t.appendChild(ids.length ? h.etq(h.plural(ids.length, 'foto', 'fotos'), 'ok') : h.etqFalta('Falta foto', comFoto ? 'op' : 'ob')); cx.appendChild(t);
        var dt = entrada('date', dr.data || '', 'Data do dia ' + (i + 1)); var ch = entrada('time', dr.chegada || '', 'Chegada no dia ' + (i + 1)); var sd = entrada('time', dr.saida || '', 'Saída no dia ' + (i + 1));
        var eqd = entrada('text', dr.equipe || '', 'Equipe do dia ' + (i + 1)); eqd.placeholder = 'Ex.: Pablo e Juca…'; eqd.maxLength = 120;
        [dt, eqd, ch, sd].forEach(function (x) { x.disabled = !pode; });
        dt.addEventListener('input', function () { dr.data = dt.value; }); ch.addEventListener('input', function () { dr.chegada = ch.value; }); sd.addEventListener('input', function () { dr.saida = sd.value; });
        eqd.addEventListener('input', function () { dr.equipe = eqd.value; });
        var g = el('div', 'jor-ob-tres jor-ob-quatro'); add(g, campo('Data', dt), campo('Equipe', eqd), campo('Chegada (opcional)', ch), campo('Saída (opcional)', sd)); cx.appendChild(g);
        if (ids.length) cx.appendChild(miniaturas(f2, ids, 'Foto do dia ' + (i + 1)));
        var fx = el('div', 'jor-ob-addfoto'); if (!ids.length) h.marcaFalta(fx, comFoto ? 'op' : 'ob');
        fx.appendChild(el('span', 'jor-ob-sub', ids.length ? 'Fotos do dia.' : 'Pelo menos 1 foto do dia.'));
        if (pode) fx.appendChild(botaoArquivo('Adicionar fotos', '', 'image/*', true, false, 'Adicionar fotos do dia ' + (i + 1), function (fs) {
          h.toast('Enviando ' + h.plural(fs.length, 'foto', 'fotos') + '…');
          subirAlbum('obra_foto', fs).then(function (novos) { if (!novos) return; dr.fotos = dr.fotos.concat(novos); return salvarObra(novos.length === 1 ? 'Foto guardada.' : novos.length + ' fotos guardadas.'); });
        }, 'camera'));
        cx.appendChild(fx);
        var oc = el('textarea', 'jor-ta'); oc.maxLength = 400; oc.value = dr.ocorrencia || ''; oc.setAttribute('aria-label', 'Observação do dia ' + (i + 1)); oc.disabled = !pode; oc.placeholder = 'O que foi feito, quem estava, o que aconteceu…';
        oc.addEventListener('input', function () { dr.ocorrencia = oc.value; });
        cx.appendChild(campo('Observação', oc));
        if (pode && !ids.length) { var tir = btn('Tirar este dia', 'jor-btn-link', function () { ob.diario.splice(i, 1); pintaDias(); }); cx.appendChild(tir); }
        lista.appendChild(cx);
      });
    }
    pintaDias();
    if (pode) {
      var aD = el('div', 'jor-din-acoes');
      aD.appendChild(btn('+ Dia', '', function () {
        if (ob.diario.length >= 20) { h.toast('O diário guarda até 20 dias.'); return; }
        var ult = ob.diario.map(function (x) { return x.data; }).filter(Boolean).sort().pop();
        var dia = !ult ? hoje() : (ult < hoje() ? hoje() : somaDias(ult, 1));
        var eqAnt = ob.diario.length ? ob.diario[ob.diario.length - 1].equipe || '' : '';
        ob.diario.push({ data: dia, equipe: eqAnt, chegada: '', saida: '', fotos: [], ocorrencia: '' }); pintaDias();
      }));
      aD.appendChild(botaoObra('Salvar o diário', 'Diário salvo.')); bD.appendChild(aD);
    }
    // Fotos antigas do álbum da obra que não estão em nenhum dia (obras de antes do diário novo).
    var ligadas = {}; ob.diario.forEach(function (x) { (x.fotos || []).forEach(function (id) { ligadas[id] = 1; }); });
    var soltas = arqs(f2, 'obra_foto').filter(function (a) { return !ligadas[a.id]; }).map(function (a) { return a.id; });
    if (soltas.length) { bD.appendChild(el('p', 'jor-nota', 'Outras fotos da obra, sem dia: ' + soltas.length + '.')); bD.appendChild(miniaturas(f2, soltas, 'Foto da obra')); }
    esq.appendChild(bD);
    // 2. Checklist da instalação
    var feitos = CHECK.filter(function (x) { return !!ob.checklist[x[0]]; }).length;
    var etqC = feitos === CHECK.length ? h.etq('8 de 8', 'ok') : h.etqFalta(feitos + ' de 8', 'ob');
    var bC = bloco('Checklist da instalação', etqC);
    var gc = el('div', 'jor-ob-chks jor-ob-chk2');
    // Grava sozinho ao marcar e desmarcar (igual ao "Comprado" da Compra), na mesma rota e com o mesmo corpo do antigo Salvar.
    // As marcas entram numa fila: um PUT por vez, sempre sobre a versão mais recente. Erro: desfaz só o que foi enviado e avisa.
    CHK.ob = ob; CHK.card = h.O().card;
    CHECK.forEach(function (x) {
      var k0 = x[0]; var m = marca(x[1], !!ob.checklist[k0], x[1]); m.input.disabled = !pode; if (!ob.checklist[k0]) h.marcaFalta(m, 'ob');
      m.input.addEventListener('change', function () {
        // Marca na hora e não desliga nada: o próximo clique, mesmo logo depois, entra na fila.
        var on = m.input.checked; ob.checklist[k0] = on; CHK.pend[k0] = on; h.marcaFalta(m, on ? '' : 'ob');
        var n = CHECK.filter(function (y) { return !!ob.checklist[y[0]]; }).length;
        etqC.textContent = n === CHECK.length ? '8 de 8' : n + ' de 8'; etqC.className = 'jor-etq jor-etq-' + (n === CHECK.length ? 'ok' : 'fo');
        chkFila();
      }); gc.appendChild(m);
    });
    bC.appendChild(gc);
    esq.appendChild(bC);
    // 3. Equipe e valor combinado (o pagamento mora no caixa)
    var temValor = veDinheiro() && ob.equipe.combinado_centavos !== undefined;
    var bE = bloco('Equipe e valor combinado', (ob.equipe.descricao || Number(ob.equipe.combinado_centavos) > 0) ? null : h.etqFalta('Opcional', 'op'));
    var cdesc = entrada('text', ob.equipe.descricao || '', 'Equipe e o que foi combinado'); cdesc.placeholder = 'Ex.: Equipe Pablo, 15 placas a R$ 110,00…'; cdesc.disabled = !pode; cdesc.maxLength = 160;
    cdesc.addEventListener('input', function () { ob.equipe.descricao = cdesc.value; });
    var comb = entrada('text', Number(ob.equipe.combinado_centavos) > 0 ? txtCents(ob.equipe.combinado_centavos) : '', 'Valor combinado com a equipe'); comb.inputMode = 'decimal'; comb.disabled = !pode;
    comb.addEventListener('input', function () { var v = h.cents(comb.value); ob.equipe.combinado_centavos = (typeof v === 'number' && v > 0) ? v : null; });
    var g7 = el('div', 'jor-ob-dupla jor-ob-eq'); add(g7, campo('Equipe e o combinado', cdesc), temValor ? campo('Valor (R$)', comb) : null); bE.appendChild(g7);
    var aE = el('div', 'jor-din-acoes'); if (pode) aE.appendChild(botaoObra('Salvar', 'Equipe salva.'));
    if (l) {
      var falta = (l.a_pagar || []).filter(function (p) { return p.tipo === 'equipe'; })[0];
      if (falta) { aE.appendChild(el('span', 'jor-ob-sub', 'Falta pagar ' + (falta.valor_centavos ? h.rs(falta.valor_centavos) : falta.texto) + '.')); if (podeLancar()) aE.appendChild(btn('Lançar o pagamento', 'jor-btn-link', function () { D().lancar({ tipo: 'saida', etapa: 6, categoria: 'mao_de_obra' }); })); }
    }
    if (aE.firstChild) bE.appendChild(aE);
    esq.appendChild(bE);
    // 4. Plano por dia (opcional) e a agenda das equipes, fechados.
    var det = el('details', 'jor-ob-det'); var sm = el('summary', '', 'Plano por dia e agenda das equipes'); sm.appendChild(h.etqFalta('Opcional', 'op')); det.appendChild(sm);
    if (ob.plano.length) det.open = true;
    var lp = el('div'); det.appendChild(lp);
    function pintaPlano() {
      lp.replaceChildren();
      ob.plano.forEach(function (p, i) {
        var g = el('div', 'jor-ob-par jor-ob-plano'); g.appendChild(el('b', '', 'Dia ' + (i + 1)));
        var dt = entrada('date', p.data, 'Data do dia ' + (i + 1) + ' do plano'); var ini = entrada('time', p.inicio, 'Início'); var fim = entrada('time', p.fim, 'Fim');
        var eq = selecao(equipes.map(function (e) { return [e.id, e.rotulo]; }), p.equipe || equipes[0].id, 'Equipe'); var aj = entrada('number', p.ajudantes === undefined ? 0 : p.ajudantes, 'Ajudantes'); aj.min = 0; aj.max = 9;
        var sv = entrada('text', p.servico, 'Serviço do dia'); sv.maxLength = 200;
        [dt, ini, fim, eq, aj, sv].forEach(function (x) { x.disabled = !pode; });
        dt.addEventListener('input', function () { p.data = dt.value; }); ini.addEventListener('input', function () { p.inicio = ini.value; }); fim.addEventListener('input', function () { p.fim = fim.value; });
        eq.addEventListener('change', function () { p.equipe = eq.value; }); aj.addEventListener('input', function () { p.ajudantes = Math.max(0, Math.min(9, Number(aj.value) || 0)); }); sv.addEventListener('input', function () { p.servico = sv.value; });
        add(g, campo('Data', dt), campo('Início', ini), campo('Fim', fim), campo('Equipe', eq), campo('Ajudantes', aj), campo('Serviço', sv));
        lp.appendChild(g);
      });
      if (!ob.plano.length) lp.appendChild(el('p', 'jor-nota', 'Sem plano. Marque os dias para a agenda das equipes avisar conflito.'));
    }
    pintaPlano();
    if (pode) {
      var a2 = el('div', 'jor-din-acoes');
      a2.appendChild(btn('+ Dia no plano', '', function () { if (ob.plano.length < 10) { ob.plano.push({ data: '', inicio: '07:30', fim: '17:30', equipe: equipes[0].id, ajudantes: 1, servico: '' }); pintaPlano(); } }));
      a2.appendChild(botaoObra('Salvar o plano', 'Plano salvo.')); det.appendChild(a2);
    }
    var ag = el('div', 'jor-ob-sub-b'); ag.appendChild(el('h5', 'jor-ob-cl0', 'Agenda das equipes'));
    var agCarregou = false;
    det.addEventListener('toggle', function () { if (det.open && !agCarregou) { agCarregou = true; agendaEquipes(ag, f2); } });
    if (det.open) { agCarregou = true; agendaEquipes(ag, f2); }
    det.appendChild(ag);
    esq.appendChild(det);
  }

  // ── 9 · Comissionamento (etapas 7 e 8 da api): entrega, monitoramento, concessionária, conclusão e o botão final ──────
  var PLAN = { card: null, res: null };
  function comissionamento(esq, d, f2, f3) {
    injetarCss(); var h = H();
    var e7 = etapaF2(f2, 7) || {}; var e8 = etapaF2(f2, 8) || {};
    var concluida = !!e8.concluida_em;
    var en = clone(dados(f2).entrega) || {}; en.testes = en.testes || {}; en.monitoramento = en.monitoramento || {}; en.garantias = en.garantias || {}; en.termo = en.termo || null;
    var c = compraDe(f2);
    var podeE = podeSecao(f2, 'entrega'); var podeL = podeSecao(f2, 'liberacao');
    function corpoEnt() { return { testes: en.testes, monitoramento: en.monitoramento, garantias: en.garantias, termo: en.termo, responsavel: en.responsavel || '', observacoes: en.observacoes || '' }; }
    function grava(aviso) { return botaoSalvar('Salvar', 'entrega', corpoEnt, aviso); }
    var feita7 = !!e7.concluida_em;
    // 1. Entrega: as 8 fotos, outras fotos, testes e o termo assinado.
    var sE = secao('Entrega', etqItens(itensDe(f2, 7, ['fotos', 'testes', 'termo']), feita7), 'jor-s-entrega');
    var tem = FOTOS_ENTREGA.filter(function (x) { return arqs(f2, x[0]).length > 0; }).length;
    var bF = el('div', 'jor-ob-sub-b'); var tF = el('div', 'jor-ob-linha0'); tF.appendChild(el('h5', 'jor-ob-cl0', 'Fotos de tudo pronto')); tF.appendChild(tem === 8 ? h.etq('8 de 8', 'ok') : h.etqFalta(tem + ' de 8', 'ob')); bF.appendChild(tF);
    var g8 = el('div', 'jor-ob-fotos8'); FOTOS_ENTREGA.forEach(function (x) { g8.appendChild(h.anexo(x[0], x[1], arqs(f2, x[0]).length > 0)); }); bF.appendChild(g8);
    sE.appendChild(bF);
    var nExtra = arqs(f2, 'ent_extra').length;
    // Sem foto e sem como pôr (obra concluída ou sem permissão), o bloco não diz nada: some.
    if (nExtra || podeE) sE.appendChild(blocoAlbum(f2, 'ent_extra', 'Outras fotos', '', podeE, { falta: nExtra ? '' : 'op', etq: nExtra ? null : h.etqFalta('Opcional', 'op'), rotAdd: 'Adicionar fotos', aria: 'outras fotos da entrega', nota: nExtra ? '' : 'Telhado, cabos, o cliente com o app e o que mais valer guardar.' }));
    // Testes
    var T = en.testes; var bT = el('div', 'jor-ob-sub-b'); var tT = el('div', 'jor-ob-linha0'); tT.appendChild(el('h5', 'jor-ob-cl0', 'Testes')); var cont = el('span'); tT.appendChild(cont); bT.appendChild(tT);
    var s1 = entrada('text', T.string1_voc || '', 'String 1, Voc em volts'); var s2 = entrada('text', T.string2_voc || '', 'String 2, Voc em volts'); var gk = entrada('text', T.gerando_kw || '', 'Inversor gerando, em kW'); var gh = entrada('time', T.gerando_hora || '', 'Hora da leitura');
    [s1, s2, gk].forEach(function (x) { x.inputMode = 'decimal'; });
    var cks = [['isolamento_ok', 'Isolamento ok'], ['wifi_ok', 'Wi-Fi do inversor conectado'], ['disjuntores_ok', 'Disjuntores identificados']];
    var mks = [];
    function conta() {
      var n = (T.string1_voc ? 1 : 0) + (T.string2_voc ? 1 : 0) + (T.isolamento_ok ? 1 : 0) + (T.gerando_kw ? 1 : 0) + (T.wifi_ok ? 1 : 0) + (T.disjuntores_ok ? 1 : 0);
      cont.replaceChildren(n === 6 ? h.etq('6 de 6', 'ok') : h.etqFalta(n + ' de 6', 'ob'));
      [[s1, 'string1_voc'], [s2, 'string2_voc'], [gk, 'gerando_kw']].forEach(function (p) { h.marcaFalta(p[0], T[p[1]] ? '' : 'ob'); });
      mks.forEach(function (p) { h.marcaFalta(p[0], T[p[1]] ? '' : 'ob'); });
    }
    [[s1, 'string1_voc'], [s2, 'string2_voc'], [gk, 'gerando_kw'], [gh, 'gerando_hora']].forEach(function (p) { p[0].disabled = !podeE; p[0].addEventListener('input', function () { T[p[1]] = p[0].value; conta(); }); });
    var g2 = el('div', 'jor-ob-par'); add(g2, campo('String 1, Voc (V)', s1), campo('String 2, Voc (V)', s2), campo('Inversor gerando (kW)', gk), campo('Hora da leitura', gh)); bT.appendChild(g2);
    var gck = el('div', 'jor-ob-chks jor-ob-chk2');
    cks.forEach(function (x) { var m = marca(x[1], !!T[x[0]], x[1]); m.input.disabled = !podeE; m.input.addEventListener('change', function () { T[x[0]] = m.input.checked; conta(); }); mks.push([m, x[0]]); gck.appendChild(m); });
    bT.appendChild(gck); conta();
    if (podeE) { var aT = el('div', 'jor-din-acoes'); aT.appendChild(grava('Testes salvos.')); bT.appendChild(aT); }
    sE.appendChild(bT);
    termoDeEntrega(sE, d, f2, en, podeE, c, corpoEnt);
    esq.appendChild(sE);
    // 2. Monitoramento: app, conta, usina online e a senha no cofre.
    var sM = secao('Monitoramento', etqItens(itensDe(f2, 7, ['monitoramento']), feita7), 'jor-s-monit');
    monitoramento(sM, f2, en, podeE, grava, function (aviso) { return salvar('entrega', corpoEnt(), aviso); });
    esq.appendChild(sM);
    // 3. Concessionária: pedido de vistoria, vistoria, medidor (opcional) e liberada.
    var sC = secao('Concessionária', etqItens(itensDe(f2, 8, ['pedido', 'vistoria', 'medidor', 'liberacao']), concluida), 'jor-s-conc');
    concessionaria(sC, f2, e8, podeL);
    esq.appendChild(sC);
    // 4. Conclusão geral, montada sozinha.
    var sG = secao('Conclusão geral', el('span', 'jor-auto', 'Automático'), 'jor-s-conclusao');
    conclusaoGeral(sG, d, f2, f3);
    var bO = el('div', 'jor-ob-sub-b'); var tO = el('div', 'jor-ob-linha0'); tO.appendChild(el('h5', 'jor-ob-cl0', 'Observações finais')); tO.appendChild(h.etqFalta('Opcional', 'op')); bO.appendChild(tO);
    var ta = el('textarea', 'jor-ta'); ta.maxLength = 1000; ta.value = en.observacoes || ''; ta.disabled = !podeE; ta.placeholder = 'O que vale registrar sobre a obra, para quem pegar depois…'; ta.setAttribute('aria-label', 'Observações finais');
    ta.addEventListener('input', function () { en.observacoes = ta.value; }); bO.appendChild(ta);
    if (podeE) { var aO = el('div', 'jor-din-acoes'); aO.appendChild(grava('Observações salvas.')); bO.appendChild(aO); }
    sG.appendChild(bO);
    esq.appendChild(sG);
    // 5. Fechamento e o botão final.
    var sF = secao('Fechamento', concluida ? h.etq('Completo', 'ok') : ((f2.finalizar && f2.finalizar.falta && f2.finalizar.falta.length) ? h.etqFalta('Falta ' + f2.finalizar.falta.length, 'ob') : h.etq('Pronto', 'ok')), 'jor-s-fechar');
    fechamentoFinal(sF, d, f2, concluida, e8);
    esq.appendChild(sF);
    // 6. Depois de concluída: o pós-venda (o conteúdo de jornada-posvenda.js, igual).
    if (concluida && window.Jornada.etapas[9]) {
      var sP = secao('Pós-venda', null, 'jor-s-pos');
      var e9 = (d.etapas || []).filter(function (x) { return x.n === 9; })[0] || { n: 9 };
      window.Jornada.etapas[9](sP, d, e9, f3);
      esq.appendChild(sP);
    }
  }
  function monitoramento(b3, f2, en, pode, grava, salvarEntrega) {
    var h = H();
    var M = en.monitoramento; var mon0 = (dados(f2).entrega || {}).monitoramento || {}; delete M.conta_mascarada; var cofre = (dados(f2).entrega || {}).cofre || null;
    // Cada informação num lugar só: a série se digita aqui. Se este campo está vazio e a Compra já tem a do inversor, ela entra pronta para confirmar.
    var daCompra = ''; if (!M.serie) compraDe(f2).itens.some(function (i) { if (i && i.tipo === 'inversor' && String(i.serie || '').trim()) { daCompra = String(i.serie).trim(); return true; } return false; });
    if (daCompra) M.serie = daCompra;
    var app = entrada('text', M.app || '', 'Aplicativo do fabricante'); var us = entrada('text', M.usina || '', 'Usina no aplicativo'); var se = entrada('text', M.serie || '', 'Número de série do inversor'); var cm = entrada('date', M.comissionamento || '', 'Data do comissionamento');
    var conta = entrada('text', M.conta || '', 'Conta do cliente no aplicativo'); if (mon0.conta_mascarada) { conta.value = ''; conta.placeholder = mon0.conta_mascarada; }
    [app, us, se, cm, conta].forEach(function (x) { x.disabled = !pode; });
    app.addEventListener('input', function () { M.app = app.value; }); us.addEventListener('input', function () { M.usina = us.value; }); se.addEventListener('input', function () { M.serie = se.value; }); cm.addEventListener('input', function () { M.comissionamento = cm.value; });
    var contaOrig = M.conta || '';
    conta.addEventListener('input', function () { M.conta = conta.value.trim() || contaOrig; });
    if (!M.app) h.marcaFalta(app, 'ob'); if (!M.conta && !mon0.conta_mascarada) h.marcaFalta(conta, 'ob'); if (!M.serie) h.marcaFalta(se, 'ob');
    var g3 = el('div', 'jor-ob-par'); add(g3, campo('Aplicativo', app), campo('Conta do cliente', conta), campo('Usina no aplicativo', us), campo('Número de série do inversor', se), campo('Comissionamento', cm)); b3.appendChild(g3);
    if (daCompra && pode) b3.appendChild(el('p', 'jor-nota', 'A série do inversor veio da Compra. Salve para confirmar.'));
    var on = marca('Usina online e gerando', !!M.online, 'Usina online e gerando'); on.input.disabled = !pode; on.input.addEventListener('change', function () { M.online = on.input.checked; h.marcaFalta(on, M.online ? '' : 'ob'); }); if (!M.online) h.marcaFalta(on, 'ob'); b3.appendChild(on);
    var cf = el('div', 'jor-ob-linha jor-ob-cofre'); cf.appendChild(el('b', '', 'Senha do aplicativo'));
    if (cofre && cofre.gravado) {
      cf.appendChild(el('span', 'jor-ob-senha', '••••••')); cf.appendChild(el('span', 'jor-ob-sub', 'No cofre' + (cofre.por ? ', por ' + h.nomeBonito(cofre.por) : '') + (cofre.em ? ' em ' + h.ddmm(String(cofre.em).slice(0, 10)) : '') + '. Só sócio revela.'));
      if (f2.pode && f2.pode.cofre_revelar) { var br = btn('Revelar', 'jor-btn-link', function () { revelar(cf, br); }); cf.appendChild(br); }
    } else { cf.appendChild(el('span', 'jor-ob-sub', 'Ainda não guardada.')); h.marcaFalta(cf, 'ob'); }
    b3.appendChild(cf);
    if (pode && f2.pode && f2.pode.cofre_gravar) {
      var sn = entrada('password', '', 'Senha do aplicativo'); sn.autocomplete = 'new-password'; sn.maxLength = 120;
      var gs = btn(cofre && cofre.gravado ? 'Trocar a senha no cofre' : 'Guardar no cofre', '', function () {
        if (!sn.value) { h.toast('Digite a senha.'); return; }
        gs.disabled = true;
        h.api(base() + '/cofre', 'PUT', { senha: sn.value }, 30000).then(function (r) {
          gs.disabled = false;
          // O cofre não mexe na versão da Entrega. Salvar o que já foi digitado antes de a tela recarregar evita perder app, conta, usina e o resto.
          if (r.status === 200 && r.json.ok !== false) { sn.value = ''; salvarEntrega('Senha guardada e monitoramento salvo.'); } else h.toast(msgSrv(r, 'Não consegui guardar a senha.'));
        });
      });
      var lc = el('div', 'jor-ob-linha0 jor-ob-senha-l'); add(lc, campo('Senha (some depois de guardada)', sn), gs); b3.appendChild(lc);
    }
    var G = en.garantias;
    var gd = entrada('date', G.registrada_em || '', 'Garantia registrada no fabricante em'); gd.disabled = !pode; gd.addEventListener('input', function () { G.registrada_em = gd.value; });
    var gt = marca('Cliente treinado no app', !!G.treinado, 'Cliente treinado no app'); gt.input.disabled = !pode; gt.input.addEventListener('change', function () { G.treinado = gt.input.checked; });
    var gg = el('div', 'jor-ob-linha0'); add(gg, campo('Garantia registrada no fabricante em', gd), gt); b3.appendChild(gg);
    if (pode) { var aM = el('div', 'jor-din-acoes'); aM.appendChild(grava('Monitoramento salvo.')); b3.appendChild(aM); }
  }
  function concessionaria(b, f2, et, pode) {
    var h = H(); var lb = clone(dados(f2).liberacao) || {}; lb.passos = lb.passos || {}; lb.exigencias = lb.exigencias || [];
    var P = lb.passos; var ped = P.pedido || { data: '', numero: '', arquivo_id: '' };
    var jaPediu = !!(et.prazo && et.prazo.rotulo === 'Prazo da Cemig');
    function corpoLib(num) { var c = { passos: P, exigencias: lb.exigencias }; if (num) c.pedido_numero = num; return c; }
    function grava(aviso, num) { return salvar('liberacao', corpoLib(num), aviso); }
    var its = itensDe(f2, 8);
    function nivelDe(ch) { var i = its.filter(function (x) { return x.chave === ch; })[0]; return i ? (i.feito ? '' : (i.nivel === 'opcional' ? 'op' : 'ob')) : ''; }
    // Pedido de vistoria: data, protocolo e o print.
    var p1 = el('div', 'jor-ob-passo'); var t1 = el('div', 'jor-ob-linha0'); t1.appendChild(el('h5', 'jor-ob-cl0', 'Pedido de vistoria')); var n1 = nivelDe('pedido'); t1.appendChild(n1 ? h.etqFalta('Falta', n1) : h.etq('Feito', 'ok')); p1.appendChild(t1);
    var dt = entrada('date', ped.data || '', 'Data do pedido'); var pr = entrada('text', '', 'Protocolo'); pr.placeholder = ped.numero || (jaPediu ? 'Já enviado' : ''); dt.disabled = pr.disabled = !pode;
    var g = el('div', 'jor-ob-linha0'); var sp = botaoSalvar('Salvar', 'liberacao', function () { P.pedido = { data: dt.value, numero: pr.value.trim() || ped.numero || '', arquivo_id: ped.arquivo_id || '' }; return corpoLib(pr.value.trim()); }, 'Pedido salvo.'); sp.disabled = !pode;
    add(g, campo('Data do pedido', dt), campo('Protocolo', pr), sp); p1.appendChild(g);
    if (pode) p1.appendChild(anexoLigado(f2, 'lib_pedido', 'Print do pedido', ped.arquivo_id, function (id) { P.pedido = { data: dt.value || ped.data || '', numero: pr.value.trim() || ped.numero || '', arquivo_id: id }; return grava('Print guardado.', pr.value.trim()); }, 'ob'));
    if (jaPediu) p1.appendChild(el('p', 'jor-nota', 'A concessionária tem 7 dias úteis para vistoriar.'));   // o vencimento fica só na faixa de prazo
    b.appendChild(p1);
    var PASSOS = [['vistoria', 'Vistoria aprovada', 'lib_vistoria'], ['medidor', 'Troca do medidor', 'lib_medidor'], ['liberada', 'Usina liberada', 'lib_liberacao']];
    PASSOS.forEach(function (x) {
      var p = P[x[0]] || { data: '', arquivo_id: '' }; var nv = nivelDe(x[0] === 'liberada' ? 'liberacao' : x[0]);
      var bx = el('div', 'jor-ob-passo'); var t = el('div', 'jor-ob-linha0'); t.appendChild(el('h5', 'jor-ob-cl0', x[1])); t.appendChild(nv === 'op' ? h.etqFalta('Opcional', 'op') : nv ? h.etqFalta('Falta', 'ob') : h.etq('Feito', 'ok')); bx.appendChild(t);
      var di = entrada('date', p.data || '', 'Data: ' + x[1]); di.disabled = !pode; di.addEventListener('input', function () { p = { data: di.value, arquivo_id: p.arquivo_id || '' }; P[x[0]] = p; });
      var sv = btn('Salvar', '', function () { sv.disabled = true; P[x[0]] = { data: di.value, arquivo_id: p.arquivo_id || '' }; grava('Data salva.').then(function () { sv.disabled = false; }); }); sv.disabled = !pode;
      var lin = el('div', 'jor-ob-linha0'); add(lin, campo('Data', di), sv); bx.appendChild(lin);
      if (pode) bx.appendChild(anexoLigado(f2, x[2], 'Print', p.arquivo_id, function (id) { P[x[0]] = { data: di.value || p.data || '', arquivo_id: id }; return grava('Print guardado.', pr.value.trim()); }, x[0] === 'medidor' ? 'op' : 'ob'));
      b.appendChild(bx);
    });
    var ac = el('div', 'jor-din-acoes'); var rep = btn('Vistoria reprovada', 'jor-btn-link', function () { exigenciaDialogo(f2, lb, P); }); rep.disabled = !pode; ac.appendChild(rep); b.appendChild(ac);
    lb.exigencias.forEach(function (x) { b.appendChild(el('p', 'jor-nota', 'Exigência de ' + h.ddmm(String(x.em || '').slice(0, 10)) + ': ' + x.texto)); });
  }
  /** O resumo da obra, montado sozinho: equipamento final, potência, datas de cada fase, equipe e, para quem vê o livro, gasto e saldo. */
  function conclusaoGeral(b, d, f2, f3) {
    var h = H(); var eq = dados(f2).equipamento_final || {}; var l = livro(); var ob = dados(f2).obra || {};
    var g = el('dl', 'jor-ob-res');
    function lin(rot, val, etq, larga) { if (!val) return; var w = el('div', larga ? 'larga' : ''); w.appendChild(el('dt', '', rot)); var dd = el('dd', '', val); if (etq) dd.appendChild(etq); w.appendChild(dd); g.appendChild(w); }
    function txtL(ls) { return (ls || []).map(function (x) { return (x.quantidade ? String(x.quantidade).replace('.', ',') + ' x ' : '') + (x.descricao || [x.marca, x.modelo].filter(Boolean).join(' ')); }).join('; '); }
    var et = eq.etiqueta ? el('span', 'jor-rc-org', eq.etiqueta === 'Comprado' ? 'comprado' : eq.etiqueta) : null;
    lin('Placas', txtL(eq.modulos), et, true); lin('Inversor', txtL(eq.inversores), null, true); lin('Estrutura', txtL(eq.estruturas), null, true);
    if (eq.material && eq.material.length) lin('Material elétrico', h.plural(eq.material.length, 'item comprado', 'itens comprados'));
    if (eq.kwp) lin('Potência', String(eq.kwp).replace('.', ',') + ' kWp');
    var equipe = ob.equipe && ob.equipe.descricao ? ob.equipe.descricao : '';
    if (!equipe && (ob.plano || []).length) { var ids = {}; ob.plano.forEach(function (p) { if (p.equipe) ids[p.equipe] = 1; }); equipe = Object.keys(ids).map(function (k) { var x = (f2.equipes || []).filter(function (e) { return e.id === k; })[0]; return x ? x.rotulo : k; }).join(', '); }
    lin('Equipe', equipe, null, true);
    if (l && typeof l.gasto === 'number') lin('Total gasto', h.rs(l.gasto));
    if (l && typeof l.saldo === 'number') lin('Saldo', h.rs(l.saldo));
    b.appendChild(g);
    // As datas de cada fase, numa régua.
    var fases = [['Venda', 1, 'aberta_em'], ['Homologação', 3, 'concluida_em'], ['Compra', 4, 'concluida_em'], ['Logística', 5, 'concluida_em'], ['Obra', 6, 'concluida_em'], ['Entrega', 7, 'concluida_em'], ['Liberação', 8, 'concluida_em']];
    var ol = el('ol', 'jor-ob-fases'); ol.setAttribute('aria-label', 'Datas de cada fase');
    fases.forEach(function (fz) {
      var e = fz[1] >= 4 && fz[1] <= 8 ? etapaF2(f2, fz[1]) : (d.etapas || [])[fz[1] - 1];
      var dt = e && e[fz[2]] ? h.ddmm(String(e[fz[2]]).slice(0, 10)) : '';
      var li = el('li', dt ? 'ok' : ''); li.appendChild(el('span', '', fz[0])); li.appendChild(el('b', '', dt || 'Falta')); ol.appendChild(li);
    });
    b.appendChild(ol);
    // O Book da obra.
    var bk = f2.book || { pode: false };
    var ac = el('div', 'jor-din-acoes');
    var bt = btn('Baixar o Book', '', function () { if (window.Jornada.extras.bookPdf) window.Jornada.extras.bookPdf(d.card.id || O().card, bt); }); bt.disabled = !bk.pode; bt.insertBefore(h.icone('baixo'), bt.firstChild);
    var bkf = f3 && f3.book && f3.book.gerado_em ? f3.book : null;
    var qd = bkf ? h.quando(bkf.gerado_em) : null;
    ac.appendChild(bt); ac.appendChild(el('span', 'jor-nota', bkf ? 'Último gerado' + (qd ? ' em ' + qd : '') + (bkf.por ? ' por ' + h.nomeBonito(bkf.por) : '') + '.' : 'Com as fotos, os testes e as garantias.')); b.appendChild(ac);
    var trava = travaDoBook(f2);
    if (trava.length) {
      var cx = el('div', 'jor-ob-conf-book'); cx.setAttribute('role', 'note');
      cx.appendChild(el('b', '', 'Para o Book ir ao cliente, falta corrigir:'));
      var ul = el('ul'); ul.setAttribute('aria-label', 'O que segura o Book');
      trava.forEach(function (t) {
        var onde = ondeCorrige(t); var li = el('li'); li.appendChild(el('span', '', t));
        li.appendChild(btn(onde.rot, 'jor-btn-link', function () { irCorrigir(onde); })); ul.appendChild(li);
      });
      cx.appendChild(ul); b.appendChild(cx);
    }
  }
  /** As pendências que seguram o Book (texto de cada uma), ou lista vazia quando ele está livre. */
  function travaDoBook(f2) {
    var bk = (f2 && f2.book) || {};
    return (!bk.pode && Array.isArray(bk.trava)) ? bk.trava.filter(Boolean) : [];
  }
  function fraseBookTravado(n) {
    return n === 1 ? 'O Book ainda tem 1 pendência e só vai ao cliente depois que ela for corrigida.' : 'O Book ainda tem ' + n + ' pendências e só vai ao cliente depois que forem corrigidas.';
  }
  /** Onde se corrige cada trava do Book: equipamento e garantia no Editar item da Compra, garantia de contrato no passo 2, foto e teste na Entrega. */
  function ondeCorrige(t) {
    var x = String(t || '');
    if (/contrato|instala/i.test(x)) return { aba: 'p2', rot: 'Corrigir no passo 2' };
    if (/s[ée]rie|monitor|aplicativo|senha/i.test(x)) return { aba: 'e7', alvo: 'jor-s-monit', rot: 'Ir ao Monitoramento' };
    if (/foto|teste|termo|entrega/i.test(x)) return { aba: 'e7', alvo: 'jor-s-entrega', rot: 'Ir à Entrega' };
    return { aba: 'e4', rot: 'Corrigir em 6 Compra' };
  }
  /** Vai aonde a pendência se corrige: outra aba, ou a seção desta. */
  function irCorrigir(onde) {
    var h = H(); if (h.irAba) h.irAba(onde.aba);
    if (onde.alvo) setTimeout(function () { var a = document.getElementById(onde.alvo); if (a) a.scrollIntoView({ block: 'start' }); }, 0);
  }
  function fechamentoFinal(b, d, f2, concluida, e8) {
    var h = H(); var pode = f2.pode || {};
    if (!concluida) {
      var falta = (f2.finalizar && f2.finalizar.falta) || [];
      if (falta.length) {
        var fr = el('div', 'jor-portao-frase'); fr.appendChild(el('span', '', 'Para concluir, falta:'));
        var ul = el('ul', 'jor-pe-falta'); falta.forEach(function (i) { ul.appendChild(el('li', i.nivel === 'opcional' ? 'op' : '', i.texto)); }); fr.appendChild(ul); b.appendChild(fr);
      } else if (!pode.finalizar) b.appendChild(el('p', 'jor-ok', 'Tudo pronto para concluir.'));
      if (D() && D().fechamento && O().dinheiro && O().dinheiro.livro) { var det = el('details', 'jor-ob-det'); det.appendChild(el('summary', '', 'A conta da obra')); D().fechamento(det, O().dinheiro); b.appendChild(det); }
      if (pode.finalizar) {
        var barra = el('div', 'jor-portao-barra jor-ob-final');
        var tx = el('div', 'jor-ob-final-tx');
        tx.appendChild(el('b', '', pode.finalizar_pronto ? 'Pronto para concluir.' : 'O botão libera quando a lista acima zerar.'));
        var travaF = travaDoBook(f2);
        if (travaF.length) {
          tx.appendChild(el('span', '', 'Ao concluir, a conta fecha e a planilha é preenchida.'));
          tx.appendChild(el('span', 'jor-ob-final-av', fraseBookTravado(travaF.length)));
        } else tx.appendChild(el('span', '', 'Ao concluir, a conta fecha, a planilha é preenchida e o cliente recebe o Book da usina no WhatsApp.'));
        barra.appendChild(tx);
        var bf = btn('Concluir e preencher a planilha', 'jor-btn-pri jor-btn-grande', function () { confirmarFinal(bf); });
        bf.disabled = !pode.finalizar_pronto; if (!pode.finalizar_pronto) bf.setAttribute('aria-describedby', 'jor-s-fechar');
        barra.appendChild(bf); b.appendChild(barra);
      }
      return;
    }
    b.appendChild(el('p', 'jor-ok', 'Obra concluída em ' + h.ddmm(String(e8.concluida_em).slice(0, 10)) + (f2.fechada && f2.fechada.por ? ' por ' + h.nomeBonito(f2.fechada.por) : '') + '.'));
    var res = PLAN.card === String(O().card) ? PLAN.res : null;
    if (res) b.appendChild(resultadoPlanilha(res, !!pode.planilha));
    else if (pode.planilha) { var ap = el('div', 'jor-din-acoes'); var bp = btn('Preencher a planilha', '', function () { tentarPlanilha(bp); }); ap.appendChild(bp); ap.appendChild(el('span', 'jor-nota', 'Só preenche as células vazias da linha da venda.')); b.appendChild(ap); }
    // A conta: fechada junto com a conclusão. Só o Thiago reabre.
    if (f2.fechada) {
      if (pode.reabrir) b.appendChild(btn('Reabrir a conta', 'jor-btn-link jor-ob-reabrir', function () {
        h.dialogoMotivo('Reabrir a conta', 'Reabrir', function (motivo) {
          return h.api(base() + '/dinheiro/reabrir', 'POST', { motivo: motivo }, 30000).then(function (r) {
            if (r.status === 200 && r.json.ok !== false) { h.toast('Conta reaberta.'); h.recarregar(); return { ok: true }; }
            return { ok: false, erro: msgSrv(r, 'Não consegui reabrir agora.') };
          });
        });
      }));
    } else if (pode.fechar) {
      b.appendChild(btn('Fechar a conta de novo', '', function () {
        h.api(base() + '/dinheiro/fechar', 'POST', {}, 30000).then(function (r) { if (r.status === 200 && r.json.ok !== false) { h.toast('Conta fechada.'); h.recarregar(); } else h.toast(msgSrv(r, 'Ainda não dá para fechar.')); });
      }));
    }
  }
  function confirmarFinal(bf) {
    var h = H(); var info = null;
    h.dialogo('Concluir a obra', function (box) {
      var ul = el('ul', 'jor-ob-conf');
      var trava = travaDoBook(O().fase2);
      // Com o Book travado a promessa vira aviso: ele só segue ao cliente depois de corrigido.
      var itens = ['A conta da obra fecha. Só o Thiago reabre.', 'A planilha antiga recebe os dados da venda, só nas células vazias.'];
      if (!trava.length) itens.push('O cliente recebe o Book da usina no WhatsApp.');
      itens.forEach(function (t) { var li = el('li'); li.appendChild(h.icone('ok')); li.appendChild(el('span', '', t)); ul.appendChild(li); });
      box.appendChild(ul);
      if (trava.length) {
        var av = el('div', 'jor-ob-conf-book'); av.setAttribute('role', 'note');
        av.appendChild(el('b', '', fraseBookTravado(trava.length)));
        var lt = el('ul'); lt.setAttribute('aria-label', 'O que segura o Book');
        trava.forEach(function (t) {
          var onde = ondeCorrige(t); var li = el('li'); li.appendChild(el('span', '', t));
          li.appendChild(btn(onde.rot, 'jor-btn-link', function () { h.fecharDlg(); irCorrigir(onde); }));
          lt.appendChild(li);
        });
        av.appendChild(lt); box.appendChild(av);
      }
      info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); box.appendChild(info);
      return {};
    }, 'Concluir', function (b) {
      b.disabled = true; bf.disabled = true; info.textContent = '';
      h.api(base() + '/comissionamento/concluir', 'POST', {}, 120000).then(function (r) {
        var j = r.json || {};
        if (r.status === 200 && j.ok !== false) {
          PLAN = { card: String(O().card), res: j.planilha || null };
          h.fecharDlg(); h.toast('Obra concluída.'); h.recarregar();
          return;
        }
        b.disabled = false; bf.disabled = false;
        if (r.status === 409 && j.precisa === 'itens' && Array.isArray(j.falta)) { info.textContent = 'Ainda falta: ' + j.falta.map(function (i) { return i.texto; }).join(', ') + '.'; h.recarregar(); return; }
        info.textContent = msgSrv(r, 'Não consegui concluir agora. Tente de novo.');
      });
    });
  }
  function tentarPlanilha(bt) {
    var h = H(); if (bt) bt.disabled = true;
    h.api(base() + '/planilha', 'POST', {}, 90000).then(function (r) {
      if (bt) bt.disabled = false;
      if (r.status === 200 && r.json && r.json.planilha) { PLAN = { card: String(O().card), res: r.json.planilha }; h.desenhar(); return; }
      h.toast(msgSrv(r, 'Não consegui falar com a planilha agora.'));
    });
  }
  function copiarTudo(txt, bt) {
    var h = H();
    function ok() { h.toast('Copiado.'); if (bt) { bt.textContent = 'Copiado'; setTimeout(function () { bt.textContent = 'Copiar tudo'; }, 2000); } }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(ok, function () { h.toast('Não consegui copiar. Selecione o texto e copie.'); }); return; }
    var ta = el('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { h.toast('Não consegui copiar. Selecione o texto e copie.'); }
    ta.remove();
  }
  /** O que a planilha respondeu: preenchida, nada a gravar, não ligada (lista para colar) ou falhou (tentar de novo + lista). */
  function resultadoPlanilha(p, podeTentar) {
    var h = H(); var b = el('div', 'jor-ob-plan'); b.setAttribute('role', 'status');
    var gravadas = (p.gravadas || []).length;
    if (p.status === 'preenchida') b.appendChild(el('p', 'jor-ok', 'Planilha preenchida: ' + h.plural(gravadas, 'coluna', 'colunas') + (p.linha ? ' na linha ' + p.linha : '') + '.' + ((p.puladas || []).length ? ' ' + (p.puladas.length === 1 ? '1 já estava preenchida.' : p.puladas.length + ' já estavam preenchidas.') : '')));
    else if (p.status === 'nada_a_gravar') b.appendChild(el('p', 'jor-ok', p.aviso || 'A linha da planilha já estava preenchida.'));
    else if (p.status === 'nao_ligada') b.appendChild(el('p', 'jor-aviso', 'Planilha automática ainda não ligada. Copie e cole na linha da venda.'));
    else b.appendChild(el('p', 'jor-erro', p.aviso || 'Não consegui preencher a planilha agora.'));
    var cols = Array.isArray(p.colunas) ? p.colunas : [];
    if ((p.status === 'nao_ligada' || p.status === 'falhou') && cols.length) {
      var tb = el('dl', 'jor-ob-cols');
      cols.forEach(function (x) { var w = el('div'); var dt = el('dt'); dt.appendChild(el('b', '', x.coluna)); dt.appendChild(el('span', '', x.rotulo)); w.appendChild(dt); w.appendChild(el('dd', '', x.texto)); tb.appendChild(w); });
      b.appendChild(tb);
    }
    var ac = el('div', 'jor-din-acoes');
    if (p.status === 'falhou' && podeTentar) { var bt = btn('Tentar a planilha de novo', 'jor-btn-pri', function () { tentarPlanilha(bt); }); ac.appendChild(bt); }
    if ((p.status === 'nao_ligada' || p.status === 'falhou') && cols.length) {
      var txt = cols.map(function (x) { return x.coluna + ' (' + x.rotulo + '): ' + x.texto; }).join('\n');
      var bc = btn('Copiar tudo', '', function () { copiarTudo(txt, bc); }); ac.appendChild(bc);
    }
    if (ac.firstChild) b.appendChild(ac);
    return b;
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
  /** O termo de entrega: os 6 itens, a ressalva, quem assina e a assinatura na tela. `corpoEnt` monta o PUT da entrega. */
  function termoDeEntrega(alvo, d, f2, en, pode, c, corpoEnt) {
    var h = H(); var b = el('div', 'jor-ob-sub-b'); var termo = en.termo || {};
    var assinado = !!(termo.assinado_em && existe(f2, termo.arquivo_id));
    var t = el('div', 'jor-ob-linha0'); t.appendChild(el('h5', 'jor-ob-cl0', 'Termo de entrega assinado')); t.appendChild(assinado ? h.etq('Assinado', 'ok') : h.etqFalta('Falta', 'ob')); b.appendChild(t);
    var chk = (termo.chk && termo.chk.length === 6) ? termo.chk.slice() : ['sim', 'sim', 'sim', 'sim', 'sim', 'sim'];
    var tx = (typeof FS_TERMO_ITENS !== 'undefined' && FS_TERMO_ITENS.length === 6) ? FS_TERMO_ITENS : TERMO_ITENS;
    var rs = el('textarea', 'jor-ta'); rs.maxLength = 500; rs.value = termo.ressalva || ''; rs.setAttribute('aria-label', 'Ressalva'); rs.disabled = !pode;
    var info = el('p', 'jor-erro'); info.setAttribute('role', 'status');
    var ol = el('ol', 'jor-ob-termo');
    tx.forEach(function (tt, i) {
      var li = el('li'); li.appendChild(el('span', '', tt));
      var s = selecao([['sim', 'Sim'], ['na', 'Não se aplica'], ['pend', 'Pendente']], chk[i], 'Item ' + (i + 1) + ' do termo'); s.disabled = !pode;
      s.addEventListener('change', function () { chk[i] = s.value; }); li.appendChild(s); ol.appendChild(li);
    });
    b.appendChild(ol);
    b.appendChild(campo('Ressalva (obrigatória se houver item pendente)', rs));
    var nome = entrada('text', termo.nome || '', 'Nome de quem assina'); nome.disabled = !pode; b.appendChild(campo('Nome de quem assina', nome));
    function dadosTermo() { return { assinado_em: new Date().toISOString(), nome: nome.value.trim(), arquivo_id: '', chk: chk, ressalva: rs.value.trim() }; }
    function valida() {
      if (!nome.value.trim()) { info.textContent = 'Diga o nome de quem assina.'; return false; }
      if (chk.indexOf('pend') >= 0 && !rs.value.trim()) { info.textContent = 'Há item pendente: descreva a ressalva.'; return false; }
      info.textContent = ''; return true;
    }
    if (pode) b.appendChild(assinaturaBloco(f2, 'ent_termo_assinado', termo.arquivo_id, function (id) {
      var tt = dadosTermo(); tt.arquivo_id = id; en.termo = tt;
      return salvar('entrega', corpoEnt(), 'Termo assinado.');
    }, valida));
    if (termo.assinado_em) b.appendChild(el('p', 'jor-ok', 'Assinado por ' + (termo.nome || 'o cliente') + ' em ' + h.ddmm(String(termo.assinado_em).slice(0, 10)) + '.'));
    var ac = el('div', 'jor-din-acoes');
    ac.appendChild(btn('Ver o termo para imprimir', 'jor-btn-link', function () { if (!valida()) return; gerarTermoEntrega(d, f2, c, chk, rs.value.trim(), en); }));
    b.appendChild(ac); b.appendChild(info); alvo.appendChild(b);
  }
  function exigenciaDialogo(f2, lb, P) {
    var h = H(); var ta = null;
    h.dialogo('O que a concessionária exigiu', function (box) {
      ta = el('textarea', 'jor-ta'); ta.maxLength = 400; ta.setAttribute('aria-label', 'O que a concessionária exigiu'); box.appendChild(ta);
      box.appendChild(h.anexo('lib_exigencia', 'Documento da exigência', arqs(f2, 'lib_exigencia').length > 0, { nivel: 'op' }));
      box.appendChild(el('p', 'jor-nota', 'Registra a exigência e pede a vistoria de novo, sem sair do passo.')); return { foco: ta };
    }, 'Registrar e pedir de novo', function (b) {
      if (ta.value.trim().length < 3) { h.toast('Diga o que a concessionária exigiu.'); return; }
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

  /** O /fase2 falhou: a seção não some calada. Mostra o erro e Tentar de novo. */
  function semFase2(esq, titulo, texto) {
    var b = el('div', 'jor-bloco'); var t = el('div', 'jor-bloco-t'); t.appendChild(el('span', '', titulo)); t.appendChild(el('em', 'jor-etq jor-etq-av', 'Não carregou')); b.appendChild(t);
    var p = el('p', 'jor-erro', texto); p.setAttribute('role', 'alert'); b.appendChild(p);
    b.appendChild(btn('Tentar de novo', '', function () { H().recarregar(); }));
    esq.appendChild(b);
  }
  // Etapa 1 · Relatório de vistoria
  function extraVistoria(esq, d) {
    var f2 = O().fase2; injetarCss(); var h = H();
    if (!f2) { semFase2(esq, 'Relatório de vistoria', 'O relatório de vistoria não carregou, e a trava de 80% depende dele.'); return; }
    var pode = podeSecao(f2, 'vistoria'); var v = clone(dados(f2).vistoria) || {};
    var sg = (H().sugs && H().sugs('vistoria')) || {};
    ['telhado', 'entrada', 'inversor'].forEach(function (k) { v[k] = v[k] || {}; }); v.adeq = v.adeq || [];
    var box = el('div', 'jor-bloco');
    // O quanto do relatório já está preenchido (vistoria_pct, do servidor). Com 80% ou mais a etapa pode concluir.
    var pct = Math.max(0, Math.min(100, Math.round(Number(d.vistoria_pct) || 0)));
    var tit = el('div', 'jor-bloco-t'); tit.appendChild(el('span', '', 'Relatório de vistoria'));
    tit.appendChild(el('em', 'jor-etq jor-etq-' + (pct >= 80 ? 'ok' : 'fo'), pct + '% preenchido')); box.appendChild(tit);
    var barra = el('div', 'jor-prog' + (pct >= 80 ? ' ok' : '')); barra.setAttribute('role', 'progressbar'); barra.setAttribute('aria-valuemin', '0'); barra.setAttribute('aria-valuemax', '100'); barra.setAttribute('aria-valuenow', String(pct)); barra.setAttribute('aria-label', 'Relatório de vistoria preenchido');
    var barraI = el('i'); barraI.style.width = pct + '%'; barra.appendChild(barraI); box.appendChild(barra);
    box.appendChild(el('p', 'jor-nota', 'Precisa de pelo menos 80% para concluir a etapa. Na dúvida, fale com o técnico para ajudar na avaliação.'));
    var ins = {};
    // Opções rápidas: um toque preenche o campo (a pessoa ainda pode digitar outra coisa).
    var SIM3 = ['Sim', 'Não', 'Precisa adequar'];
    var OPCOES = {
      'telhado.tipo': ['Cerâmico', 'Fibrocimento', 'Metálico', 'Laje', 'Solo'], 'telhado.estado': ['Bom', 'Regular', 'Ruim'],
      'telhado.orient': ['Norte', 'Nordeste', 'Leste', 'Oeste', 'Noroeste', 'Sul'], 'telhado.incl': ['0 a 10°', '10 a 20°', '20 a 30°', 'Acima de 30°'],
      'telhado.sombra': ['Sem sombra', 'Pouca', 'Muita'], 'telhado.estr': ['Madeira', 'Metálica', 'Concreto'], 'telhado.acesso': ['Fácil', 'Médio', 'Difícil'],
      'entrada.padrao': ['Monofásico', 'Bifásico', 'Trifásico'], 'entrada.tensao': ['127 V', '220 V', '380 V'], 'entrada.apto': SIM3, 'entrada.aterr': SIM3,
      'inversor.local': ['Garagem', 'Parede externa', 'Área de serviço', 'Quadro'], 'inversor.abrig': ['Abrigado', 'Exposto'], 'inversor.wifi': ['Tem sinal', 'Sem sinal'],
    };
    function chips(lb, i, obj, chave, opcoes) {
      var cx = el('div', 'jor-opcoes'); cx.setAttribute('role', 'group'); cx.setAttribute('aria-label', 'Opções rápidas');
      var bs = opcoes.map(function (o) {
        var b = el('button', 'jor-chip', o); b.type = 'button'; b.disabled = !pode;
        b.addEventListener('click', function () { i.value = o; obj[chave] = o; i.dispatchEvent(new Event('input', { bubbles: true })); });
        cx.appendChild(b); return b;
      });
      function marca() { bs.forEach(function (b) { var on = String(i.value).trim().toLowerCase() === b.textContent.toLowerCase(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
      i.addEventListener('input', marca); marca(); lb.appendChild(cx);
    }
    function lin(grupo, chave, rot, tipo) {
      var obj = grupo ? v[grupo] : v; var s = sg[(grupo ? grupo + '.' : '') + chave];
      if (s && !String(obj[chave] || '').trim()) obj[chave] = String(s.valor); else s = null;
      var i = entrada(tipo || 'text', obj[chave] || '', rot); i.disabled = !pode; ins[(grupo || '') + '.' + chave] = i;
      i.addEventListener('input', function () { obj[chave] = i.value; });
      var lb = campo(rot, i); if (s && H().veio) lb.appendChild(H().veio(s, i));
      var op = OPCOES[(grupo ? grupo + '.' : '') + chave]; if (op) chips(lb, i, obj, chave, op);
      return lb;
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
    ac.appendChild(btn('Gerar relatório', '', function () { gerarVistoria(d, v, info); }));
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
        cli: cli, emp: solEmp(), data: v.data || (typeof solHoje === 'function' ? solHoje() : hoje()), quem: v.quem || '', acomp: v.acomp || '', local: (cad && typeof vdcV === 'function' ? vdcV(cad, 'endereco_ponto') : '') || ((H().ficha && H().ficha() && H().ficha().campos && H().ficha().campos['uc.endereco_ponto']) ? String(H().ficha().campos['uc.endereco_ponto'].valor) : ''), kwp: (d.proposta && d.proposta.kwp) ? String(d.proposta.kwp).replace('.', ',') : '', nmod: '', uc: cad ? (typeof vdcV === 'function' ? vdcV(cad, 'unidade_consumidora') : '') : '', conc: cad ? (typeof vdcV === 'function' ? vdcV(cad, 'concessionaria') : '') : '',
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
    var f2 = O().fase2; injetarCss(); var h = H();
    if (!f2) { semFase2(esq, 'Proposta de banco', 'A proposta de banco não carregou.'); return; }
    var pode = podeSecao(f2, 'banco'); var bk = clone(dados(f2).banco) || {};
    var sg = (H().sugs && H().sugs('banco')) || {};
    var vendaOk = !!(d.venda && d.venda.valor_centavos > 0);
    // Mora dentro do passo Contrato e procuração (depois do Sim do financiamento): sem título próprio nem caixa que fecha, tudo à vista.
    var bloc = el('div', 'jor-banco'); bloc.appendChild(H().subTitulo('Proposta de banco' + (bk.banco ? ' · para o ' + bk.banco : '')));
    var falta = []; var exigidos = {};
    function atualiza() { Object.keys(exigidos).forEach(function (k) { h.marcaFalta(exigidos[k], (bk[k] || '').trim() ? '' : 'ob'); }); falta = []; if (!(bk.banco || '').trim()) falta.push('o banco'); if (!(bk.agencia || '').trim()) falta.push('a agência'); if (!(bk.conta || '').trim()) falta.push('a conta'); if (!vendaOk) falta.push('o valor vendido'); aviso.textContent = falta.length ? 'Falta ' + falta.join(', ') + '.' : ''; gerar.disabled = falta.length > 0; }
    var box = el('div');
    function lin(chave, rot, tipo) {
      var s = sg[chave]; if (s && !String(bk[chave] || '').trim()) bk[chave] = String(s.valor); else s = null;
      var i = entrada(tipo || 'text', bk[chave] || '', rot); i.disabled = !pode; i.addEventListener('input', function () { bk[chave] = i.value; atualiza(); });
      if (chave === 'banco' || chave === 'agencia' || chave === 'conta') exigidos[chave] = i;
      var lb = campo(rot, i); if (s && H().veio) lb.appendChild(H().veio(s, i)); return lb;
    }
    function reais0(chave, rot) { var i = entrada('text', Number(bk[chave]) > 0 ? txtCents(bk[chave]) : '', rot); i.inputMode = 'decimal'; i.disabled = !pode; i.addEventListener('input', function () { var v = h.cents(i.value); bk[chave] = (typeof v === 'number' && v > 0) ? v : null; }); return campo(rot + ' (R$, opcional)', i); }
    var g = el('div', 'jor-ob-par'); add(g, lin('banco', 'Banco'), lin('agencia', 'Agência'), lin('conta', 'Conta corrente'), lin('validade', 'Validade (dias)'), lin('prazo', 'Prazo de entrega'), lin('origem', 'Origem dos recursos'), lin('nota', 'Nota da entrada'), lin('desc', 'Descrição do sistema'), lin('ger', 'Geração (kWh/mês)'), reais0('eq_centavos', 'Equipamento'), reais0('mo_centavos', 'Mão de obra')); box.appendChild(g);
    var det = el('div'); det.appendChild(H().subTitulo('Titular do financiamento', H().etq('Opcional'))); var fin = bk.fin || {};
    var gf = el('div', 'jor-ob-par');
    // Preencher: o titular do financiamento do cadastro (quando já se sabe quem é). Qualificação e endereço saem montados como nos papéis.
    var q = {}; ['nacionalidade', 'estado_civil', 'profissao', 'orgao_emissor'].forEach(function (k) { var s = sg['fin.qualif.' + k]; if (s) q[k] = String(s.valor); });
    var en = {}; ['endereco', 'bairro', 'cidade', 'uf'].forEach(function (k) { var s = sg['fin.end.' + k]; if (s) en[k] = String(s.valor); });
    var sQualif = null, sEnd = null;
    if (!String(fin.qualif || '').trim() && (q.nacionalidade || q.estado_civil || q.profissao) && typeof solQualifPf === 'function') {
      fin.qualif = solQualifPf({ nac: q.nacionalidade || '', ec: q.estado_civil || '', prof: q.profissao || '', rg: String(fin.rg || (sg['fin.rg'] && sg['fin.rg'].valor) || ''), orgao: q.orgao_emissor || '' });
      sQualif = sg['fin.qualif.nacionalidade'] || sg['fin.qualif.estado_civil'] || sg['fin.qualif.profissao'];
    }
    if (!String(fin.end || '').trim() && en.endereco) {
      fin.end = (typeof solEnd === 'function') ? solEnd(en.endereco, en.bairro || '', en.cidade || '', en.uf || '') : [en.endereco, en.bairro, en.cidade, en.uf].filter(Boolean).join(', ');
      sEnd = sg['fin.end.endereco'];
    }
    [['nome', 'Nome'], ['doc', 'CPF ou CNPJ'], ['rg', 'RG'], ['qualif', 'Qualificação'], ['end', 'Endereço'], ['cep', 'CEP'], ['tel', 'Telefone'], ['email', 'E-mail']].forEach(function (x) {
      var s = x[0] === 'qualif' ? sQualif : (x[0] === 'end' ? sEnd : sg['fin.' + x[0]]);
      if (x[0] !== 'qualif' && x[0] !== 'end') { if (s && !String(fin[x[0]] || '').trim()) fin[x[0]] = String(s.valor); else s = null; }
      if (s) bk.fin = fin;
      var i = entrada('text', fin[x[0]] || '', 'Titular: ' + x[1]); i.disabled = !pode; i.addEventListener('input', function () { fin[x[0]] = i.value; bk.fin = fin; });
      var lb = campo(x[1], i); if (s && H().veio) lb.appendChild(H().veio(s, i)); gf.appendChild(lb);
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
    function fin(tp) { var t = c.itens.filter(function (x) { return x.tipo === tp; }); var cp = t.filter(function (x) { return x.comprado; }); return cp.length ? cp : t; } var mod = fin('modulo'); var inv = fin('inversor');
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
  window.Jornada.etapas.comissionamento = comissionamento;
  window.Jornada.extras.vistoria = extraVistoria;
  window.Jornada.extras.banco = extraBanco;
  // A trava do Book é uma só: o botão da Conclusão geral e o do topo da página leem a mesma regra e a mesma frase.
  window.Jornada.extras.travaDoBook = travaDoBook;
  window.Jornada.extras.fraseBookTravado = fraseBookTravado;
  void semanaDe;
})();
