// Cache de curta duração da Central das Agentes.
//
// A rota GET /gerador/agentes é pública, roda a cada abertura da tela e cada
// montagem faz várias leituras no banco (2 s ou mais). Aqui ficam três regras:
//   1. resposta boa vale por `ttlMs` (60 s);
//   2. uma montagem por vez: quem chega durante a montagem espera a mesma promessa;
//   3. se a montagem falha, o erro NÃO é guardado. Havendo um resultado bom de
//      até `velhoMs` (5 min), entrega esse; sem ele, repassa o erro.
// Módulo folha de propósito (sem banco, sem logger): relógio e montagem entram por
// parâmetro, então o teste roda com dublê e sem esperar 60 s de verdade.

export interface CacheMontagemOpcoes {
  ttlMs?: number;
  velhoMs?: number;
  agora?: () => number;
  /** Chamado quando a montagem falhou e o resultado antigo foi entregue. */
  aoServirAntigo?: (erro: unknown, idadeMs: number) => void;
}

export const CENTRAL_TTL_MS = 60_000;
export const CENTRAL_VELHO_MS = 5 * 60_000;

export function criarCacheDeMontagem<T>(
  montar: () => Promise<T>,
  opc: CacheMontagemOpcoes = {},
): () => Promise<T> {
  const ttl = opc.ttlMs ?? CENTRAL_TTL_MS;
  const velho = opc.velhoMs ?? CENTRAL_VELHO_MS;
  const agora = opc.agora ?? Date.now;

  let bom: { valor: T; em: number } | null = null;
  let voando: Promise<T> | null = null;

  return function obter(): Promise<T> {
    if (bom && agora() - bom.em < ttl) return Promise.resolve(bom.valor);
    if (voando) return voando;

    const p: Promise<T> = (async () => {
      try {
        const valor = await montar();
        bom = { valor, em: agora() };
        return valor;
      } catch (err) {
        const idade = bom ? agora() - bom.em : Infinity;
        if (bom && idade < velho) {
          opc.aoServirAntigo?.(err, idade);
          return bom.valor;
        }
        throw err;
      }
    })();
    voando = p;
    const soltar = () => { if (voando === p) voando = null; };
    p.then(soltar, soltar);
    return p;
  };
}
