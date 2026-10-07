// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — porta de entrada do NÚCLEO PURO.
//
// Só exporta o que não toca em banco, rede, env, relógio nem log: o
// regulamento, as classes, os destinos, a decisão e o replay em memória. O livro
// (RPC), o passaporte e a catraca no zapiPost são fases seguintes; nada daqui
// está ligado a envio nenhum ainda.
// ─────────────────────────────────────────────────────────────────────────────

export * from './regulamento';
export * from './classes';
export * from './destinos';
export * from './decidir';
export * from './estado';
export * from './simular';
