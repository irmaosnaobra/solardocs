import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BASE_CLIENTE_URL, tokenDoCliente, tokenInternoDoCliente, urlDoCliente,
} from '../services/io/eletropostoEstudoCliente';

const INTERNO = '0123456789abcdef'.repeat(4);

describe('token da versão do cliente', () => {
  const antes = process.env.EP_ESTUDO_DB_SEGREDO;
  beforeEach(() => { process.env.EP_ESTUDO_DB_SEGREDO = 'x'.repeat(40); });
  afterEach(() => { process.env.EP_ESTUDO_DB_SEGREDO = antes; });

  it('ida e volta, 64 hex, diferente do interno e estável', () => {
    const c = tokenDoCliente(INTERNO) as string;
    expect(c).toMatch(/^[a-f0-9]{64}$/);
    expect(c).not.toBe(INTERNO);
    expect(c.slice(0, 32)).not.toBe(INTERNO.slice(0, 32));
    expect(tokenDoCliente(INTERNO)).toBe(c);
    expect(tokenInternoDoCliente(c)).toBe(INTERNO);
    expect(urlDoCliente(INTERNO)).toBe(`${BASE_CLIENTE_URL}${c}`);
  });

  it('outro segredo, outro link: girar o segredo invalida o link já mandado', () => {
    const c = tokenDoCliente(INTERNO) as string;
    process.env.EP_ESTUDO_DB_SEGREDO = 'y'.repeat(40);
    expect(tokenInternoDoCliente(c)).not.toBe(INTERNO);
  });

  it('token torto não decifra', () => {
    for (const t of ['', 'abc', 'G'.repeat(64), INTERNO.toUpperCase(), `${INTERNO}00`]) {
      expect(tokenInternoDoCliente(t)).toBeNull();
    }
  });

  it('sem segredo, sem link', () => {
    process.env.EP_ESTUDO_DB_SEGREDO = '';
    expect(tokenDoCliente(INTERNO)).toBeNull();
    expect(urlDoCliente(INTERNO)).toBeNull();
  });
});
