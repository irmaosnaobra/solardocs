import { describe, it, expect, vi, beforeEach } from 'vitest';

// vendasDesde (páginas de 1000 com .range) e chavesComPlanoPago (em lote), com o banco simulado.

const h = vi.hoisted(() => ({
  vendas: [] as Array<{ phone: string; attribution_session_id: string | null; created_at: string }>,
  faixas: [] as Array<[number, number]>,
  erroNaPagina: -1,
  users: [] as Array<{ whatsapp: string }>,
  lotesIn: [] as number[],
  erroUsers: false,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === 'sales') {
        const q: any = {
          select: () => q, gte: () => q, order: () => q,
          range: async (de: number, ate: number) => {
            h.faixas.push([de, ate]);
            if (h.erroNaPagina === h.faixas.length - 1) return { data: null, error: { message: 'falhou' } };
            return { data: h.vendas.slice(de, ate + 1), error: null };
          },
        };
        return q;
      }
      const u: any = {
        select: () => u, neq: () => u,
        in: (_c: string, lote: string[]) => { h.lotesIn.push(lote.length); return u; },
        limit: async () => (h.erroUsers ? { data: null, error: { message: 'falhou' } } : { data: h.users, error: null }),
      };
      return u;
    },
  },
}));

import { vendasDesde, chavesComPlanoPago, PAGINA_VENDAS, PAGINAS_VENDAS_MAX } from '../services/solardoc/compraQuizSolardoc';

const venda = (i: number) => ({ phone: `5534${String(90000000 + i)}`.slice(0, 13), attribution_session_id: `s${i}`, created_at: `2026-10-${String(20 + (i % 6)).padStart(2, '0')}T10:00:00.000Z` });

beforeEach(() => { h.vendas = []; h.faixas = []; h.erroNaPagina = -1; h.users = []; h.lotesIn = []; h.erroUsers = false; });

describe('vendasDesde', () => {
  it('pagina de 1000 em 1000 e para na primeira página incompleta', async () => {
    h.vendas = Array.from({ length: 2300 }, (_, i) => venda(i));
    const r = await vendasDesde(0);
    expect(h.faixas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(r.sessoes.size).toBe(2300);
    expect(r.truncada).toBe(false);
  });
  it('página cheia no meio e vazia depois: lê a seguinte e termina sem corte', async () => {
    h.vendas = Array.from({ length: 1000 }, (_, i) => venda(i));
    const r = await vendasDesde(0);
    expect(h.faixas).toEqual([[0, 999], [1000, 1999]]);
    expect(r.truncada).toBe(false);
  });
  it('5 páginas cheias = truncada, e não lê a sexta', async () => {
    h.vendas = Array.from({ length: PAGINA_VENDAS * PAGINAS_VENDAS_MAX + 400 }, (_, i) => venda(i));
    const r = await vendasDesde(0);
    expect(h.faixas).toHaveLength(PAGINAS_VENDAS_MAX);
    expect(r.truncada).toBe(true);
  });
  it('erro em qualquer página lança', async () => {
    h.vendas = Array.from({ length: 2500 }, (_, i) => venda(i));
    h.erroNaPagina = 1;
    await expect(vendasDesde(0)).rejects.toThrow('ler vendas');
  });
  it('guarda a data da primeira venda de cada telefone', async () => {
    h.vendas = [
      { phone: '5534999991111', attribution_session_id: null, created_at: '2026-10-26T10:00:00.000Z' },
      { phone: '5534999991111', attribution_session_id: 'a', created_at: '2026-10-20T10:00:00.000Z' },
    ];
    const r = await vendasDesde(0);
    expect(r.chaves.get('3499991111')).toBe('2026-10-20T10:00:00.000Z');
    expect(r.sessoes.get('a')).toBe('2026-10-20T10:00:00.000Z');
  });
});

describe('chavesComPlanoPago', () => {
  it('uma consulta por até 25 chaves (100 variantes) e devolve as chaves com plano', async () => {
    const chaves = Array.from({ length: 60 }, (_, i) => `34${String(99990000 + i)}`);
    h.users = [{ whatsapp: '5534999990005' }, { whatsapp: '34999990007' }];
    const pagas = await chavesComPlanoPago(chaves);
    expect(h.lotesIn).toEqual([100, 100, 40]);
    expect(pagas.has('3499990005')).toBe(true);
    expect(pagas.has('3499990007')).toBe(true);
    expect(pagas.size).toBe(2);
  });
  it('sem chave válida não consulta; erro lança', async () => {
    expect((await chavesComPlanoPago(['lid:123', ''])).size).toBe(0);
    expect(h.lotesIn).toEqual([]);
    h.erroUsers = true;
    await expect(chavesComPlanoPago(['3499990005'])).rejects.toThrow('ler users');
  });
});
