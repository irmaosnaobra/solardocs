import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitUntil } from '../utils/waitUntil';

const CHAVE = Symbol.for('@vercel/request-context');
const alvo = globalThis as unknown as Record<symbol, unknown>;

describe('waitUntil local', () => {
  afterEach(() => {
    delete alvo[CHAVE];
  });

  it('entrega ao contexto da Vercel exatamente a mesma promessa', () => {
    const spy = vi.fn();
    alvo[CHAVE] = { get: () => ({ waitUntil: spy }) };
    const p = Promise.resolve(1);
    waitUntil(p);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(p);
  });

  it('sem contexto, não lança', () => {
    expect(() => waitUntil(Promise.resolve(1))).not.toThrow();
  });

  it('se o get lançar, não lança', () => {
    alvo[CHAVE] = { get: () => { throw new Error('boom'); } };
    expect(() => waitUntil(Promise.resolve(1))).not.toThrow();
  });
});
