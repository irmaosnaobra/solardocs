// Esconder o botão flutuante do WhatsApp por contagem. Cada tela ou gaveta que quer o botão escondido soma 1
// ao montar e tira 1 ao desmontar; o botão volta ao estilo original só quando a conta chega a zero. Assim a
// ordem em que as telas montam e desmontam não importa (guardar "o estilo anterior" em cada uma deixava o
// botão preso em display:none quando a gaveta saía depois da página).

export interface ElementoFab { style: { display: string } }

export function criarContadorFab(achar: () => ElementoFab | null) {
  let escondidos = 0;
  let original: string | null = null;

  return {
    /** Soma (+1) ou tira (-1) um pedido de esconder. */
    mudar(delta: 1 | -1) {
      escondidos = Math.max(0, escondidos + delta);
      const fab = achar();
      if (escondidos > 0) {
        if (!fab) return;
        if (original === null) original = fab.style.display;
        fab.style.display = 'none';
      } else {
        if (fab && original !== null) fab.style.display = original;
        original = null;
      }
    },
    total: () => escondidos,
  };
}
