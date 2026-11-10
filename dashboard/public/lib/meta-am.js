/* Correspondência avançada do pixel da Meta, no navegador.
 *
 * COMO USAR NA PÁGINA (depois do snippet do fbq, antes do PageView):
 *   <script src="/lib/meta-am.js"></script>
 *   window.ioMatch('824905216831401', { tel: '(34) 99999-0000', email: 'a@b.com', externalId: 'email' })
 *     .then(function () { fbq('track', 'PageView'); });
 *
 * `externalId` é 'tel' ou 'email' e diz de onde sai o external_id: o sha256 hex
 * do telefone normalizado (ou do e-mail normalizado). É o MESMO valor que o
 * servidor manda (api/src/utils/metaCapi.ts: sha256(normFone); e metaPixel.ts:
 * sha256(email minúsculo), igual ao Lead/CompleteRegistration do cadastro), para
 * o Meta juntar o evento do navegador e o do servidor na mesma pessoa.
 *
 * Chama fbq('init', pixelId, { ph, em, external_id }), só com os campos que
 * existirem. O pixel faz o hash de ph e em; o external_id já vai em hex.
 * Sem fbq na página, resolve sem fazer nada. A Promise nunca rejeita.
 */
(function () {
  'use strict';

  // Cópia EXATA de normFone em api/src/utils/metaCapi.ts: só dígitos; 12 ou 13
  // dígitos precisam começar com 55 (senão, inválido); 10 ou 11 ganham o 55.
  function normFone(s) {
    var d = String(s == null ? '' : s).replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 12 || d.length === 13) {
      if (d.indexOf('55') !== 0) return null;
      d = d.slice(2);
    }
    if (d.length !== 10 && d.length !== 11) return null;
    return '55' + d;
  }

  // Minúsculo e sem espaço, como normEmail do servidor. Sem arroba, vazio.
  function normEmail(s) {
    var e = String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
    return /^[^@]+@[^@]+$/.test(e) ? e : null;
  }

  function sha256Hex(texto) {
    try {
      var c = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
      if (!c || !c.subtle || typeof TextEncoder === 'undefined') return Promise.resolve(null);
      return c.subtle.digest('SHA-256', new TextEncoder().encode(texto)).then(function (buf) {
        var b = new Uint8Array(buf);
        var hex = '';
        for (var i = 0; i < b.length; i++) hex += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        return hex;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  window.ioMatch = function (pixelId, dados) {
    try {
      if (typeof window.fbq !== 'function' || !pixelId) return Promise.resolve(null);
      var d = dados || {};
      var ph = normFone(d.tel);
      var em = normEmail(d.email);
      var origemId = d.externalId === 'tel' ? ph : d.externalId === 'email' ? em : null;

      return (origemId ? sha256Hex(origemId) : Promise.resolve(null)).then(function (hash) {
        var ud = {};
        if (ph) ud.ph = ph;
        if (em) ud.em = em;
        if (hash) ud.external_id = hash;
        if (!ud.ph && !ud.em && !ud.external_id) return null; // nada para casar: não reinicia o pixel
        try { window.fbq('init',String(pixelId), ud); } catch (e) { return null; }
        return ud;
      }).then(function (ud) { return ud; }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  };
})();
