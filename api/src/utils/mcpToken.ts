import crypto from 'crypto';

// Confere o token do MCP aceitando o atual (MCP_TOKEN) e, durante a troca, o anterior
// (MCP_TOKEN_ANTERIOR). Lê as envs na hora da chamada. Vazio é ignorado, como antes, sem piso de
// tamanho (o MCP_TOKEN é sensível na Vercel e não dá para medir) (fail-closed: sem nenhum token
// configurado, nada autentica). O access_token que o OAuth devolve continua sendo o MCP_TOKEN.
const TAMANHO_MINIMO = 1;

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function tokenMcpConfere(recebido: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof recebido !== 'string') return false;
  const dado = recebido.trim();
  if (!dado) return false;
  let ok = false;
  for (const chave of ['MCP_TOKEN', 'MCP_TOKEN_ANTERIOR'] as const) {
    const valor = String(env[chave] ?? '').trim();
    if (valor.length < TAMANHO_MINIMO) continue;
    if (igual(valor, dado)) ok = true;
  }
  return ok;
}
