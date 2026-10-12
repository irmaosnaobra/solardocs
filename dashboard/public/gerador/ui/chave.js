/* Chave do visual novo do /gerador. Sincrono, sem dependencia, no <head>.
   Sem a chave ligada (ou em qualquer erro) nao faz nada: o app fica como sempre foi. */
(function () {
  var h = document.documentElement;
  function ligarFolhas(media) {
    var l = document.querySelectorAll('link[data-io2]');
    for (var i = 0; i < l.length; i++) l[i].media = media;
  }
  var temaAntes = h.getAttribute('data-theme');
  try {
    var PADRAO = 'antigo';
    var v = null;
    try { v = localStorage.getItem('gerador-visual'); } catch (e) {}
    if (!v) v = PADRAO;
    if (v !== 'novo') return;
    var q = location.search || '';
    if (/[?&]p=/.test(q) || /[?&]pdf=1(&|$)/.test(q)) return;
    var s = document.currentScript;
    /* casca.js usa isto para devolver o tema se precisar desligar o visual novo no meio do caminho. */
    window.__io2TemaAntes = temaAntes;
    h.classList.add('io2');
    /* As folhas do visual novo vem com media="not all" no index (nao bloqueiam a pintura de quem nao usa a chave,
       nem a do link do cliente). Ligada a chave, passam a valer agora, antes da primeira pintura. */
    ligarFolhas('screen');
    /* Folha que ainda nao chegou: segura a pintura (como uma folha comum faria) ate ela carregar, no maximo
       2,5 s, para ninguem ver o visual antigo piscar em rede lenta. Com o cache do service worker isto nem roda. */
    (function () {
      var l = document.querySelectorAll('link[data-io2]'), falta = 0, st = null, solto = false;
      function soltar() { if (solto) return; solto = true; if (st && st.parentNode) st.parentNode.removeChild(st); }
      function chegou() { falta--; if (falta <= 0) soltar(); }
      for (var i = 0; i < l.length; i++) {
        if (l[i].sheet) continue;
        falta++;
        l[i].addEventListener('load', chegou);
        l[i].addEventListener('error', chegou);
      }
      if (falta > 0 && document.head) {
        st = document.createElement('style');
        st.id = 'io2-espera';
        st.textContent = 'html.io2{background:#F2F4F8}html.io2 body{visibility:hidden}';
        document.head.appendChild(st);
        setTimeout(soltar, 2500);
      }
    })();
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
    var tc = document.querySelector('meta[name="theme-color"]');
    if (!tc && document.head) {
      tc = document.createElement('meta');
      tc.setAttribute('name', 'theme-color');
      document.head.appendChild(tc);
    }
    if (tc) tc.setAttribute('content', '#0A2450');
    if (s && s.getAttribute('data-tema') === 'light') h.dataset.theme = 'light';
    window.__io2 = true;
  } catch (e) {
    /* Qualquer erro devolve o visual antigo inteiro, nunca uma pagina pela metade. */
    try {
      ligarFolhas('not all');
      var esp = document.getElementById('io2-espera');
      if (esp && esp.parentNode) esp.parentNode.removeChild(esp);
      h.classList.remove('io2');
      if (temaAntes) h.setAttribute('data-theme', temaAntes); else h.removeAttribute('data-theme');
      window.__io2 = false;
    } catch (e2) {}
  }
})();
