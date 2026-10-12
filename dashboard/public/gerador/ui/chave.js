/* Chave do visual novo do /gerador. Sincrono, sem dependencia, no <head>.
   Sem a chave ligada (ou em qualquer erro) nao faz nada: o app fica como sempre foi. */
(function () {
  var h = document.documentElement;
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
      h.classList.remove('io2');
      if (temaAntes) h.setAttribute('data-theme', temaAntes); else h.removeAttribute('data-theme');
      window.__io2 = false;
    } catch (e2) {}
  }
})();
