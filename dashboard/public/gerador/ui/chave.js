/* Chave do visual novo do /gerador. Sincrono, sem dependencia, no <head>.
   O visual novo e o padrao. Quem tem localStorage['gerador-visual'] = 'antigo' fica no antigo, e em qualquer erro
   o app volta ao antigo inteiro. Quando uma folha do novo falha, a aba fica no antigo por 10 minutos
   (sessionStorage['gerador-visual-falhou'] guarda o horario da falha); depois disso o novo e tentado de novo.
   No visual antigo, fora do link do cliente (?p=) e do PDF (pdf=1), o menu lateral ganha o link "Visual novo"
   (/gerador/visual-novo.html), o caminho de volta. */
(function () {
  var h = document.documentElement;
  var VOLTA_ID = 'io2-voltar-novo';
  var PRAZO_FALHA = 10 * 60 * 1000;
  /* A marca de falha vale se guarda um horario com menos de 10 minutos. Vencida, ou no formato antigo ('1'),
     e apagada e o visual novo e tentado de novo. */
  function marcaDeFalhaValida() {
    try {
      var m = sessionStorage.getItem('gerador-visual-falhou');
      if (!m) return false;
      var t = /^\d{10,}$/.test(m) ? Number(m) : NaN;
      var idade = Date.now() - t;
      if (isFinite(t) && idade >= 0 && idade < PRAZO_FALHA) return true;
      sessionStorage.removeItem('gerador-visual-falhou');
    } catch (e) {}
    return false;
  }
  /* Link discreto no pe do menu lateral do app antigo. Sem menu (subapps, login, outras paginas) nao faz nada. */
  function criarVoltar() {
    try {
      var foot = document.querySelector('#app-sidebar .sb-foot');
      if (!foot || document.getElementById(VOLTA_ID)) return;
      var a = document.createElement('a');
      a.id = VOLTA_ID;
      a.className = 'sb-item';
      a.setAttribute('href', '/gerador/visual-novo.html');
      a.style.textDecoration = 'none';
      a.style.boxSizing = 'border-box';
      a.innerHTML = '<span class="sb-ic"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path></svg></span> Visual novo';
      foot.appendChild(a);
      /* Em tela baixa (notebook de 768 px, celular) o menu antigo nao tem rolagem e o ultimo item ficaria
         cortado: quando o conteudo nao cabe, o menu passa a rolar. Quando cabe, nada muda. */
      var sb = document.getElementById('app-sidebar');
      var caber = function () {
        try { if (sb) sb.style.overflowY = (sb.scrollHeight > sb.clientHeight + 1) ? 'auto' : ''; } catch (e2) {}
      };
      caber();
      window.addEventListener('resize', caber);
      /* O menu so aparece depois do login (data-mode passa de login para app): mede de novo nessa hora. */
      try { new MutationObserver(caber).observe(h, { attributes: true, attributeFilter: ['data-mode'] }); } catch (e3) {}
    } catch (e) {}
  }
  function agendarVoltar() {
    try {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', criarVoltar);
      else criarVoltar();
    } catch (e) {}
  }
  function ligarFolhas(media, semCores) {
    var l = document.querySelectorAll('link[data-io2]');
    for (var i = 0; i < l.length; i++) {
      /* No tema escuro as folhas io2-cores-* ficam desligadas: elas so convertem o escuro nativo em claro. */
      l[i].media = (semCores && /io2-cores-/.test(l[i].getAttribute('href') || '')) ? 'not all' : media;
    }
  }
  var temaAntes = h.getAttribute('data-theme');
  try {
    /* Link do cliente (?p=): o zoom fica liberado, com ou sem a chave. A visão do cliente não tem campo de
       formulário, então não há zoom automático do iPhone para evitar. Na geração de PDF nada muda. */
    var q0 = location.search || '';
    if (/[?&]p=/.test(q0) && !/[?&]pdf=1(&|$)/.test(q0)) {
      var vp0 = document.querySelector('meta[name="viewport"]');
      if (vp0) {
        /* Tira só as duas travas de zoom e mantém o resto do que a página declarou. */
        var c0 = (vp0.getAttribute('content') || '')
          .replace(/\s*,?\s*(maximum-scale|user-scalable)\s*=\s*[^,]*/gi, '')
          .replace(/^\s*,\s*/, '');
        vp0.setAttribute('content', c0 || 'width=device-width, initial-scale=1');
      }
    }
    var PADRAO = 'novo';
    var v = null;
    try { v = localStorage.getItem('gerador-visual'); } catch (e) {}
    if (!v) v = PADRAO;
    var q = location.search || '';
    var doCliente = /[?&]p=/.test(q) || /[?&]pdf=1(&|$)/.test(q);
    /* Escolha gravada pelo antigo, ou uma folha do novo falhou ha menos de 10 minutos (veja falha() abaixo):
       fica no visual antigo, com o link de volta no menu (nunca no link do cliente nem no PDF). */
    if (v !== 'novo' || marcaDeFalhaValida()) {
      if (!doCliente) agendarVoltar();
      return;
    }
    if (doCliente) return;
    var s = document.currentScript;
    /* casca.js usa isto para devolver o tema se precisar desligar o visual novo no meio do caminho. */
    window.__io2TemaAntes = temaAntes;
    /* Tema: escolha de cada aparelho (localStorage['gerador-tema']). Sem nada gravado vale o claro. */
    var escuro = false;
    try { escuro = localStorage.getItem('gerador-tema') === 'escuro'; } catch (e) {}
    h.classList.add('io2');
    if (escuro) h.setAttribute('data-io2-tema', 'escuro');
    /* As folhas do visual novo vem com media="not all" no index (nao bloqueiam a pintura de quem nao usa a chave,
       nem a do link do cliente). Ligada a chave, passam a valer agora, antes da primeira pintura. */
    ligarFolhas('screen', escuro);
    /* Folha que ainda nao chegou: segura a pintura (como uma folha comum faria) ate ela carregar, no maximo
       2,5 s, para ninguem ver o visual antigo piscar em rede lenta. Com o cache do service worker isto nem roda. */
    (function () {
      var l = document.querySelectorAll('link[data-io2]'), falta = 0, st = null, solto = false;
      function soltar() { if (solto) return; solto = true; if (st && st.parentNode) st.parentNode.removeChild(st); }
      function chegou() { falta--; if (falta <= 0) soltar(); }
      function falha() {
        /* Uma folha do visual novo nao veio. Marca esta aba para o visual antigo. Se a pagina ainda esta
           escondida (ninguem digitou nada), recarrega uma vez; se ja apareceu, nao recarrega para nao
           apagar o que a pessoa digitou: a marca vale a partir da proxima carga, por 10 minutos. */
        try { sessionStorage.setItem('gerador-visual-falhou', String(Date.now())); } catch (e) { chegou(); return; }
        if (!solto) { try { location.reload(); return; } catch (e2) {} }
        chegou();
      }
      for (var i = 0; i < l.length; i++) {
        if (escuro && /io2-cores-/.test(l[i].getAttribute('href') || '')) continue;
        if (l[i].sheet) continue;
        falta++;
        l[i].addEventListener('load', chegou);
        l[i].addEventListener('error', falha);
      }
      if (falta > 0 && document.head) {
        st = document.createElement('style');
        st.id = 'io2-espera';
        st.textContent = (escuro ? 'html.io2{background:#0F172A}' : 'html.io2{background:#F2F4F8}') + 'html.io2 body{visibility:hidden}';
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
    if (!escuro && s && s.getAttribute('data-tema') === 'light') h.dataset.theme = 'light';
    window.__io2 = true;
  } catch (e) {
    /* Qualquer erro devolve o visual antigo inteiro, nunca uma pagina pela metade. */
    try {
      ligarFolhas('not all');
      var esp = document.getElementById('io2-espera');
      if (esp && esp.parentNode) esp.parentNode.removeChild(esp);
      h.classList.remove('io2');
      h.removeAttribute('data-io2-tema');
      if (temaAntes) h.setAttribute('data-theme', temaAntes); else h.removeAttribute('data-theme');
      window.__io2 = false;
    } catch (e2) {}
  }
})();
