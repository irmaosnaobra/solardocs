import { describe, it, expect } from 'vitest';
import { tokenMcpConfere } from '../utils/mcpToken';

const N = 'falso-mcp-token-novo-aaaaaa';
const V = 'falso-mcp-token-velho-bbbbb';

describe('tokenMcpConfere', () => {
  it('aceita o MCP_TOKEN e o MCP_TOKEN_ANTERIOR', () => {
    const env = { MCP_TOKEN: N, MCP_TOKEN_ANTERIOR: V } as NodeJS.ProcessEnv;
    expect(tokenMcpConfere(N, env)).toBe(true);
    expect(tokenMcpConfere(V, env)).toBe(true);
    expect(tokenMcpConfere(` ${N} `, env)).toBe(true);
  });

  it('sem MCP_TOKEN_ANTERIOR o velho não passa', () => {
    expect(tokenMcpConfere(V, { MCP_TOKEN: N } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('fail-closed: sem nenhum token configurado, nada autentica (nem string vazia)', () => {
    expect(tokenMcpConfere('', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(tokenMcpConfere('qualquer-coisa-com-mais-de-16', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(tokenMcpConfere('', { MCP_TOKEN: '', MCP_TOKEN_ANTERIOR: '' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('valor curto vale como antes; só vazio é ignorado', () => {
    expect(tokenMcpConfere('curto', { MCP_TOKEN: 'curto' } as NodeJS.ProcessEnv)).toBe(true);
    expect(tokenMcpConfere('x', { MCP_TOKEN: '  ' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('errado ou de tamanho diferente dá false, sem lançar', () => {
    const env = { MCP_TOKEN: N } as NodeJS.ProcessEnv;
    expect(tokenMcpConfere('falso-mcp-token-novo-aaaaab', env)).toBe(false);
    expect(() => tokenMcpConfere(N + 'x', env)).not.toThrow();
    expect(tokenMcpConfere(N + 'x', env)).toBe(false);
    expect(tokenMcpConfere(undefined, env)).toBe(false);
  });
});
