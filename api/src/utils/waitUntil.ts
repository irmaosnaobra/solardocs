// Pede à Vercel para manter a função viva até a promessa terminar, mesmo depois de a resposta HTTP sair.
// Lê o mesmo contexto de requisição que o pacote oficial de funções da Vercel lê (Symbol.for('@vercel/request-context')),
// sem trazer esse pacote para a subida a frio. Fora da Vercel, ou se o contexto não existir, não faz nada e a
// promessa segue rodando como antes. Se a Vercel mudar esse contexto, a função vira no-op sem erro: o
// comportamento volta ao de antes. Nunca lança.

interface ContextoVercel {
  waitUntil?: (promessa: Promise<unknown>) => void;
}

interface ReqContext {
  get?: () => ContextoVercel | undefined;
}

export function waitUntil(promessa: Promise<unknown>): void {
  try {
    const global = globalThis as unknown as Record<symbol, ReqContext | undefined>;
    const ctx = global[Symbol.for('@vercel/request-context')]?.get?.();
    ctx?.waitUntil?.(promessa);
  } catch {
    // no-op: a promessa já está rodando; só não fica garantida depois da resposta
  }
}
