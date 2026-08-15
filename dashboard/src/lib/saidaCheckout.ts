// O `cancel_url` da Stripe cobre UM gesto só: o clique na setinha "←" dentro da
// página deles. O botão de VOLTAR DO NAVEGADOR (e o swipe-back do celular, que é
// como quase todo mundo desiste) não passa por lá — ele desfaz a navegação e
// devolve a pessoa pra página de onde ela saiu, com a Stripe fora do caminho.
// Resultado medido em 15/08: sessão criada com o cancel_url certo, tela /quase-la
// no ar, e mesmo assim quem voltava caía na LP em vez da oferta de Pix.
//
// O que esta peça faz: no instante em que mandamos alguém pro checkout, guarda o
// endereço de saída (o MESMO cancel_url, calculado pelo servidor) no
// sessionStorage. Quando a pessoa reaparece na nossa aba, o <VoltaDoCheckout>
// lê isso e a leva pra /quase-la.
//
// O que NÃO tem jeito: fechar a aba. Acontece no domínio da Stripe, onde a gente
// não roda JavaScript — nem este código nem nenhum outro é executado. Quem some
// assim só é alcançado pela cadência de abandono (`checkout.session.expired`).
const CHAVE = 'sd-saida-checkout';

// 2h. Passou disso não é mais "voltei do checkout agora": é a mesma aba aberta
// no dia seguinte, e mandar essa pessoa pra uma tela de "faltou pouco" seria
// falar de uma compra que ela já esqueceu.
const VALIDADE_MS = 2 * 60 * 60 * 1000;

// Piso de tempo: a marca é gravada milissegundos antes do location.href, então
// o próprio load que sai da página nunca pode ser lido como uma volta. Curto de
// propósito — quem clica sem querer e volta na hora é justamente o caso que esta
// tela existe pra pegar; um piso alto viraria uma zona morta bem no comeco.
const MINIMO_MS = 500;

interface Saida { destino: string; em: number }

/**
 * Chamar SEMPRE colado no `window.location.href = url` do checkout — nunca antes
 * de ter a URL em mãos. Marcar cedo (junto do clique) deixaria a marca de pé
 * quando o checkout falha, e a pessoa que nunca saiu daqui seria empurrada pra
 * tela de abandono na próxima navegação.
 */
export function marcarSaidaProCheckout(destino?: string | null): void {
  if (!destino) return; // sem destino não há resgate — melhor não marcar nada
  try {
    // Guarda só o CAMINHO. O servidor manda a URL inteira (DASHBOARD_URL +
    // /quase-la), e se essa env não for exatamente o domínio em que a pessoa
    // está navegando — apex contra www, domínio de preview — o redirect sairia
    // pra outra origem e deixaria a sessão dela pra trás. A tela é sempre nossa:
    // o caminho basta, e caminho nunca troca de origem.
    const caminho = new URL(destino, window.location.origin);
    const dado: Saida = { destino: caminho.pathname + caminho.search, em: Date.now() };
    sessionStorage.setItem(CHAVE, JSON.stringify(dado));
  } catch { /* modo privado / storage cheio / URL torta: segue sem o resgate */ }
}

export function limparSaidaDoCheckout(): void {
  try { sessionStorage.removeItem(CHAVE); } catch { /* idem */ }
}

/** O destino de volta, se existir uma saída recente o bastante pra valer. */
export function destinoDaVolta(): string | null {
  try {
    const cru = sessionStorage.getItem(CHAVE);
    if (!cru) return null;
    const { destino, em } = JSON.parse(cru) as Saida;
    if (!destino || typeof em !== 'number') { limparSaidaDoCheckout(); return null; }
    const idade = Date.now() - em;
    if (idade > VALIDADE_MS) { limparSaidaDoCheckout(); return null; }
    if (idade < MINIMO_MS) return null; // ainda é a ida, não a volta
    return destino;
  } catch {
    return null;
  }
}
