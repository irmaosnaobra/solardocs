import { describe, it, expect } from 'vitest';
import { lerPaginado, LINHAS_POR_PAGINA } from '../utils/lerPaginado';

const pagina = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe('lerPaginado', () => {
  it('junta as paginas e para na incompleta', async () => {
    const chamadas: number[] = [];
    const r = await lerPaginado<{ i: number }>('t', async (de) => {
      chamadas.push(de);
      return { data: de < 2000 ? pagina(LINHAS_POR_PAGINA) : pagina(500), error: null };
    });
    expect(r).toHaveLength(2500);
    expect(chamadas).toEqual([0, 1000, 2000]);
  });

  it('erro em qualquer pagina lanca', async () => {
    await expect(lerPaginado('t', async (de) =>
      de === 0 ? { data: pagina(LINHAS_POR_PAGINA), error: null } : { data: null, error: { message: 'caiu' } },
    )).rejects.toThrow(/página 2.*caiu/);
  });

  it('data que NAO e lista depois da 1a pagina lanca, em vez de encerrar como completo', async () => {
    await expect(lerPaginado('t', async (de) =>
      de === 0 ? { data: pagina(LINHAS_POR_PAGINA), error: null } : { data: null, error: null },
    )).rejects.toThrow(/não veio como lista/);
    await expect(lerPaginado('t', async (de) =>
      de === 0 ? { data: pagina(LINHAS_POR_PAGINA), error: null } : ({ data: {} as any, error: null }),
    )).rejects.toThrow(/não veio como lista/);
  });

  it('data NULO sem erro ja na 1a pagina lanca: em lista de exclusao, vazio abriria a porta', async () => {
    await expect(lerPaginado('t', async () => ({ data: null, error: null })))
      .rejects.toThrow(/página 1 não veio como lista/);
  });

  it('bater o teto de paginas lanca', async () => {
    await expect(lerPaginado('t', async () => ({ data: pagina(LINHAS_POR_PAGINA), error: null })))
      .rejects.toThrow(/teto/);
  });
});
