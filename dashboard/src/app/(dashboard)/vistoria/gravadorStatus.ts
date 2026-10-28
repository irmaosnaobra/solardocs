// Gravação do status dos itens com debounce e em ordem. Sem dependência de React nem de rede: quem usa
// passa a função que faz o PUT (`enviar`). Cada troca leva junto a sua CARGA (id da vistoria e mapa de
// status capturados na hora em que o técnico tocou), então uma gravação que sai depois, com outra
// vistoria já aberta, ainda manda o mapa certo para a vistoria certa.
//
// Regra que isto garante: as gravações saem uma depois da outra. Se a gravação A está no ar (lenta) e
// o técnico troca outro status, a B só começa quando A termina. Assim um PUT velho nunca chega depois de
// um novo e sobrescreve, e "esperar" no Concluir espera a cadeia toda.

export interface GravadorStatus<T> {
  /** Reinicia o debounce com a carga mais recente: grava `atraso` ms depois da última troca. */
  agendar(carga: T): void;
  /** Dispara na hora a troca que esperava o debounce e espera TODA a cadeia terminar. */
  esperar(): Promise<boolean>;
  /** Cancela o debounce e põe esta carga NA cadeia (atrás do que já está no ar). */
  enfileirar(carga: T): Promise<boolean>;
  /** Há troca esperando o debounce (ainda não foi para a rede). */
  pendente(): boolean;
  /**
   * Aba fechando: cancela o debounce e entrega a carga pendente a `aoDescarregar`, que a manda com
   * keepalive FORA da cadeia. Janela aceita: se um PUT da cadeia ainda estiver no ar, o keepalive pode
   * chegar antes dele, mas leva o mapa mais novo, e o servidor guarda o mapa inteiro de cada PUT.
   */
  descarregar(): void;
}

export function criarGravadorStatus<T>(opcoes: {
  enviar: (carga: T) => Promise<boolean>;
  aoDescarregar?: (carga: T) => void;
  atraso?: number;
}): GravadorStatus<T> {
  const atraso = opcoes.atraso ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cargaPendente: T | undefined;
  let cadeia: Promise<boolean> | null = null;

  function gravar(carga: T): Promise<boolean> {
    const anterior = cadeia;
    // Sem gravação no ar, envia já (de forma síncrona até o primeiro await de `enviar`).
    const p: Promise<boolean> = anterior ? anterior.then(() => opcoes.enviar(carga)) : opcoes.enviar(carga);
    cadeia = p;
    // Só solta a cadeia se ninguém encadeou depois: senão o "esperar" perderia a gravação mais nova.
    void p.finally(() => { if (cadeia === p) cadeia = null; });
    return p;
  }

  function cancelarTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
    cargaPendente = undefined;
  }

  return {
    agendar(carga) {
      if (timer) clearTimeout(timer);
      cargaPendente = carga;
      timer = setTimeout(() => {
        timer = null;
        const c = cargaPendente as T;
        cargaPendente = undefined;
        void gravar(c);
      }, atraso);
    },
    async esperar() {
      if (timer) {
        const c = cargaPendente as T;
        cancelarTimer();
        void gravar(c);
      }
      return cadeia ? await cadeia : true;
    },
    async enfileirar(carga) {
      cancelarTimer();
      return await gravar(carga);
    },
    pendente() {
      return timer !== null;
    },
    descarregar() {
      if (!timer) return;
      const c = cargaPendente as T;
      cancelarTimer();
      opcoes.aoDescarregar?.(c);
    },
  };
}
