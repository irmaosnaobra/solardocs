/* Origem do visitante: UTMs, fbclid, fbc e fbp. Um arquivo, todas as landings.
 *
 * COMO USAR NA PÁGINA (antes de qualquer outro script que mande beacon/formulário):
 *   <script src="/lib/origem.js"></script>
 *
 * O QUE FAZ
 *   Na carga, lê da URL utm_source, utm_medium, utm_campaign, utm_content,
 *   utm_term e fbclid, e guarda no cookie first-party `io_orig` (90 dias) e no
 *   localStorage `io_origem`.
 *
 * REGRA DE TOQUE
 *   - URL com qualquer utm_* ou fbclid SUBSTITUI o conjunto guardado (o último
 *     clique de campanha vale). landing_url e referrer são gravados junto, só
 *     quando o conjunto é (re)gravado.
 *   - Visita sem parâmetro NÃO apaga o que está guardado.
 *
 * FBC / FBP
 *   - fbc: se o cookie `_fbc` existe, vale ele. Senão, se veio fbclid, cria
 *     fb.1.<Date.now()>.<fbclid> e grava o cookie `_fbc` (90 dias).
 *   - fbp: lido do cookie `_fbp` na hora da consulta, porque o pixel pode
 *     criá-lo depois que este script rodou.
 *
 * API
 *   window.ioOrigem.get()        objeto completo (inclui fbc e fbp lidos agora)
 *   window.ioOrigem.paraEnvio()  objeto plano, só com campos preenchidos:
 *                                utm_*, fbclid, fbc, fbp, landing_url, referrer.
 *                                É o que a página manda nos beacons e formulários.
 *
 * Nada aqui pode lançar erro: tudo em try/catch, sem dependência.
 */
(function () {
  'use strict';

  var CHAVES_URL = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  var COOKIE_ORIG = 'io_orig';
  var LS_ORIGEM = 'io_origem';
  var NOVENTA_DIAS = 90 * 24 * 60 * 60; // segundos

  function lerCookie(nome) {
    try {
      var partes = String(document.cookie || '').split(';');
      for (var i = 0; i < partes.length; i++) {
        var p = partes[i].replace(/^\s+/, '');
        var ix = p.indexOf('=');
        if (ix > 0 && p.slice(0, ix) === nome) return p.slice(ix + 1);
      }
    } catch (e) {}
    return '';
  }

  function gravarCookie(nome, valor) {
    try {
      document.cookie = nome + '=' + valor + '; max-age=' + NOVENTA_DIAS + '; path=/; SameSite=Lax';
    } catch (e) {}
  }

  function parametrosDaUrl() {
    var out = {};
    try {
      var busca = String((window.location && window.location.search) || '');
      if (busca.charAt(0) === '?') busca = busca.slice(1);
      var pares = busca ? busca.split('&') : [];
      for (var i = 0; i < pares.length; i++) {
        var ix = pares[i].indexOf('=');
        var k = ix < 0 ? pares[i] : pares[i].slice(0, ix);
        var v = ix < 0 ? '' : pares[i].slice(ix + 1);
        try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
        try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
        v = v.replace(/^\s+|\s+$/g, '');
        if (CHAVES_URL.indexOf(k) >= 0 && v) out[k] = v.slice(0, 480);
      }
    } catch (e) {}
    return out;
  }

  function lerGuardado() {
    var obj = null;
    try {
      var c = lerCookie(COOKIE_ORIG);
      if (c) obj = JSON.parse(decodeURIComponent(c));
    } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object') {
      try {
        var l = window.localStorage && window.localStorage.getItem(LS_ORIGEM);
        if (l) obj = JSON.parse(l);
      } catch (e) { obj = null; }
    }
    return obj && typeof obj === 'object' ? obj : {};
  }

  function guardar(obj) {
    var json = '';
    try { json = JSON.stringify(obj); } catch (e) { return; }
    gravarCookie(COOKIE_ORIG, encodeURIComponent(json));
    try { window.localStorage && window.localStorage.setItem(LS_ORIGEM, json); } catch (e) {}
  }

  function tocar() {
    try {
      var url = parametrosDaUrl();
      var veioAlgo = false;
      for (var k in url) { if (Object.prototype.hasOwnProperty.call(url, k)) { veioAlgo = true; break; } }
      if (!veioAlgo) return; // visita sem parâmetro não apaga nada

      var conj = {};
      for (var i = 0; i < CHAVES_URL.length; i++) {
        if (url[CHAVES_URL[i]]) conj[CHAVES_URL[i]] = url[CHAVES_URL[i]];
      }

      // fbc: o cookie do pixel manda; sem ele, nasce do fbclid.
      var fbc = lerCookie('_fbc');
      if (!fbc && url.fbclid) {
        fbc = 'fb.1.' + Date.now() + '.' + url.fbclid;
        gravarCookie('_fbc', fbc);
      }
      if (fbc) conj.fbc = fbc;

      try { conj.landing_url = String(window.location.href || '').slice(0, 500); } catch (e) {}
      try { conj.referrer = String(document.referrer || '').slice(0, 500); } catch (e) {}
      conj.ts = Date.now();
      guardar(conj);
    } catch (e) {}
  }

  function obter() {
    var out = {};
    try {
      var g = lerGuardado();
      for (var k in g) { if (Object.prototype.hasOwnProperty.call(g, k)) out[k] = g[k]; }
      var fbc = lerCookie('_fbc') || g.fbc || '';
      if (fbc) out.fbc = fbc; else delete out.fbc;
      var fbp = lerCookie('_fbp');
      if (fbp) out.fbp = fbp; else delete out.fbp;
    } catch (e) {}
    return out;
  }

  var CAMPOS_ENVIO = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'fbc', 'fbp', 'landing_url', 'referrer'];

  function paraEnvio() {
    var out = {};
    try {
      var o = obter();
      for (var i = 0; i < CAMPOS_ENVIO.length; i++) {
        var v = o[CAMPOS_ENVIO[i]];
        if (typeof v === 'string' && v) out[CAMPOS_ENVIO[i]] = v;
      }
    } catch (e) {}
    return out;
  }

  try { window.ioOrigem = { get: obter, paraEnvio: paraEnvio }; } catch (e) {}
  tocar();
})();
