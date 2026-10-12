/* Casca do visual novo do /gerador. Por enquanto so o esqueleto seguro: nao monta nada.
   Sai se a chave nao esta ligada ou se a pagina esta dentro de iframe.
   Em qualquer erro, tira a classe io2 e o visual antigo volta inteiro. */
(function () {
  try {
    var h = document.documentElement;
    if (!h.classList.contains('io2')) return;
    if (window.self !== window.top) return;
    /* Fase 2: montar barra superior e navegacao inferior aqui. */
  } catch (e) {
    try { document.documentElement.classList.remove('io2'); } catch (e2) {}
  }
})();
