/* Portal do Parceiro NEXUS · gaveta de baixo para cima (bottom sheet) do celular.
 * Usada pela casca (menu Mais) e pelo gerador (escolha do documento).
 * Faz: abrir e fechar com animacao (sem animacao quando o aparelho pede menos movimento), fundo escurecido,
 * fechar tocando fora, arrastando a alca para baixo ou com Esc, foco preso dentro dela, foco de volta ao gatilho
 * e rolagem da pagina travada enquanto aberta.
 * Estrutura esperada: o elemento da folha tem um filho .np-folha-cab (alca e titulo: e dai que se arrasta). */
(function () {
  'use strict';
  var travas = 0;
  var todas = [];

  function focaveis(f) {
    var q = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(f.querySelectorAll(q)).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }
  function travarRolagem(sim) {
    travas = Math.max(0, travas + (sim ? 1 : -1));
    document.documentElement.classList.toggle('np-sem-rolagem', travas > 0);
  }

  /* o: { folha, fundo, inertar: function () { return [elementos]; } (opcional), aoFechar: function () {} (opcional) } */
  function criar(o) {
    var f = o.folha, u = o.fundo;
    var s = { aberta: false };
    var voltar = null, inertados = [], timer = 0;
    var arrastando = false, y0 = 0, t0 = 0, dy = 0;

    function teclado(e) {
      if (!s.aberta) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); return; }
      if (e.key !== 'Tab') return;
      var l = focaveis(f);
      if (!l.length) { e.preventDefault(); f.focus(); return; }
      var a = document.activeElement, i = l.indexOf(a);
      if (!f.contains(a)) { e.preventDefault(); l[0].focus(); return; }
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); l[l.length - 1].focus(); }
      else if (!e.shiftKey && i === l.length - 1) { e.preventDefault(); l[0].focus(); }
    }

    function abrir(gatilho) {
      if (s.aberta) return;
      clearTimeout(timer);
      s.aberta = true;
      voltar = gatilho || document.activeElement;
      f.style.transform = ''; u.style.opacity = '';
      f.classList.add('aberta'); u.classList.add('aberta');
      travarRolagem(true);
      if (o.inertar) {
        inertados = (o.inertar() || []).filter(Boolean);
        inertados.forEach(function (el) { el.inert = true; });
      }
      document.addEventListener('keydown', teclado, true);
      requestAnimationFrame(function () {
        if (!s.aberta) return;
        var l = focaveis(f);
        var alvo = f.querySelector('[data-foco]') || l[0] || f;
        try { alvo.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      });
    }

    function fechar(restaurar) {
      if (!s.aberta) return;
      s.aberta = false;
      document.removeEventListener('keydown', teclado, true);
      /* depois de arrastada, a folha ja tem transform em linha: leva ela ate o fim em vez de pular de volta */
      if (f.style.transform) f.style.transform = 'translateY(100%)';
      u.style.opacity = '';
      f.classList.remove('aberta'); u.classList.remove('aberta');
      timer = setTimeout(function () { f.style.transform = ''; }, 360);
      inertados.forEach(function (el) { el.inert = false; });
      inertados = [];
      travarRolagem(false);
      if (restaurar) {
        var alvo = voltar && document.body.contains(voltar) ? voltar : (o.alvoVolta ? o.alvoVolta() : null);
        if (alvo) { try { alvo.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
      }
      voltar = null;
      if (o.aoFechar) o.aoFechar();
    }

    f.addEventListener('pointerdown', function (e) {
      if (!s.aberta || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var cab = e.target.closest ? e.target.closest('.np-folha-cab') : null;
      if (!cab || e.target.closest('button,a,input,select,textarea')) return;
      arrastando = true; y0 = e.clientY; t0 = e.timeStamp; dy = 0;
      f.style.transition = 'none'; u.style.transition = 'none';
      try { cab.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    });
    f.addEventListener('pointermove', function (e) {
      if (!arrastando) return;
      dy = Math.max(0, e.clientY - y0);
      f.style.transform = 'translateY(' + dy + 'px)';
      u.style.opacity = String(Math.max(0, 1 - dy / Math.max(1, f.offsetHeight)));
    });
    function fim(e) {
      if (!arrastando) return;
      arrastando = false;
      f.style.transition = ''; u.style.transition = '';
      var v = dy / Math.max(1, e.timeStamp - t0);
      if (dy > 90 || (dy > 28 && v > 0.5)) fechar(true);
      else { f.style.transform = ''; u.style.opacity = ''; }
    }
    f.addEventListener('pointerup', fim);
    f.addEventListener('pointercancel', fim);

    s.abrir = abrir; s.fechar = fechar; s.folha = f;
    todas.push(s);
    return s;
  }
  /* Troca de tela (hash) com alguma gaveta aberta: fecha todas, sem devolver o foco. */
  function fecharTodas() {
    todas = todas.filter(function (x) { return x.folha.isConnected; });
    todas.forEach(function (x) { if (x.aberta) x.fechar(false); });
  }

  window.NexusFolha = { criar: criar, fecharTodas: fecharTodas };
})();
