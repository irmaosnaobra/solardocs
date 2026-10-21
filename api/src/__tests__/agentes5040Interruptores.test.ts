import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ligado, zerarCacheInterruptores, CACHE_MS } from '../services/agentes5040/interruptores';

beforeEach(() => zerarCacheInterruptores());

describe('interruptores da Fase A', () => {
  it('env 1 liga, mesmo com a chave dizendo false', async () => {
    const ler = vi.fn(async () => ({ ensaio: false }));
    expect(await ligado('ensaio', { env: { AGENTES5040_ENSAIO: '1' }, ler })).toBe(true);
    expect(ler).not.toHaveBeenCalled();
  });

  it('env 0 desliga, mesmo com a chave dizendo true', async () => {
    expect(await ligado('ficha', { env: { AGENTES5040_FICHA: '0' }, ler: async () => ({ ficha: true }) })).toBe(false);
  });

  it('valor estranho na env é ignorado e a chave decide', async () => {
    expect(await ligado('replay', { env: { AGENTES5040_REPLAY: 'sim' }, ler: async () => ({ replay: true }) })).toBe(true);
  });

  it('a chave liga só o que está true', async () => {
    const ler = async () => ({ sentinela: true, ensaio: false });
    expect(await ligado('sentinela', { env: {}, ler })).toBe(true);
    expect(await ligado('ensaio', { env: {}, ler })).toBe(false);
    expect(await ligado('ficha', { env: {}, ler })).toBe(false);
  });

  it('aceita a chave como texto JSON', async () => {
    expect(await ligado('ensaio', { env: {}, ler: async () => '{"ensaio":true}' })).toBe(true);
    zerarCacheInterruptores();
    expect(await ligado('ensaio', { env: {}, ler: async () => 'lixo' })).toBe(false);
  });

  it('chave ausente desliga', async () => {
    expect(await ligado('ensaio', { env: {}, ler: async () => null })).toBe(false);
    zerarCacheInterruptores();
    expect(await ligado('ensaio', { env: {}, ler: async () => undefined })).toBe(false);
  });

  it('erro de leitura desliga', async () => {
    expect(await ligado('sentinela', { env: {}, ler: async () => { throw new Error('banco fora'); } })).toBe(false);
  });

  it('cache de 60 s: não lê de novo antes, lê depois', async () => {
    let t = 1_000_000;
    const ler = vi.fn(async () => ({ ensaio: true }));
    const o = { env: {}, ler, agora: () => t };
    expect(await ligado('ensaio', o)).toBe(true);
    t += CACHE_MS - 1;
    expect(await ligado('replay', o)).toBe(false);
    expect(ler).toHaveBeenCalledTimes(1);
    t += 1;
    await ligado('ensaio', o);
    expect(ler).toHaveBeenCalledTimes(2);
  });
});
