import { describe, it, expect, vi } from 'vitest';

// pix_pago disparado ao REABRIR a pagina (retomado: true) e a mesma venda confirmada depois: nao entra na conta por sessao do painel,
// A NAO SER que a sessao ja tenha pix_gerou (o sid do quiz sobrevive ao recarregar a mesma aba: quem volta do banco com a pagina recarregada e uma venda valida).

const h = vi.hoisted(() => ({ eventos: [] as unknown[], contratos: [] as unknown[] }));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q, in: () => q, gte: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: { created_at: '2026-01-01T00:00:00.000Z' }, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabela === 'lp_events' ? h.eventos : h.contratos, error: null }).then(ok),
      };
      return q;
    },
  },
}));

import { getPixFunil, sessoes, type Evento } from '../controllers/pixFunilController';

const ev = (session_id: string, event_type: string, event_data: Record<string, unknown> | null = null): Evento =>
  ({ session_id, event_type, event_data, created_at: '2026-11-16T10:00:00.000Z' });

describe('pix_pago retomado fica fora do painel', () => {
  it('sessoes(): pix_pago com retomado true nao conta; sem a marca conta; outros tipos nao sao afetados', () => {
    const evs = [ev('a', 'pix_pago'), ev('b', 'pix_pago', { retomado: true }), ev('c', 'pix_pago', { retomado: false }), ev('d', 'pix_gerou', { retomado: true })];
    expect(sessoes(evs, 'pix_pago')).toBe(2);
    expect(sessoes(evs, 'pix_gerou')).toBe(1);
  });

  it('sessoes(): pix_pago retomado numa sessao que TEM pix_gerou conta (recarregou a mesma aba); sem pix_gerou continua fora', () => {
    const evs = [
      ev('x', 'pix_gerou'), ev('x', 'pix_pago', { retomado: true }),              // recarregou a aba: conta
      ev('y', 'pix_pago', { retomado: true }),                                     // outra aba/aparelho, sem pix_gerou: fora
      ev('z', 'pix_gerou'), ev('z', 'pix_pago'), ev('z', 'pix_pago', { retomado: true }), // as duas marcas na mesma sessao: 1 sessao
    ];
    expect(sessoes(evs, 'pix_pago')).toBe(2);
  });

  it('sessoes(): o pix_gerou de outra tela tambem vale, e o filtro por tela olha o evento pix_pago', () => {
    const evs = [ev('w', 'pix_gerou', { tela: 'automatico' }), ev('w', 'pix_pago', { retomado: true, tela: 'recorrente' })];
    expect(sessoes(evs, 'pix_pago')).toBe(1);
    expect(sessoes(evs, 'pix_pago', 'recorrente')).toBe(1);
    expect(sessoes(evs, 'pix_pago', 'automatico')).toBe(0);
  });

  it('getPixFunil: o numero de pagos na tela ignora o retomado', async () => {
    h.eventos = [
      ev('s1', 'pix_abriu'), ev('s1', 'pix_gerou'), ev('s1', 'pix_pago'),
      ev('s2', 'pix_abriu'), ev('s2', 'pix_pago', { retomado: true }), // outra aba, sem pix_gerou
    ];
    h.contratos = [];
    let corpo: any;
    const res = { json: (b: unknown) => { corpo = b; }, status: () => res } as any;
    await getPixFunil({ query: { period: '30dias' } } as any, res);
    expect(corpo).toBeTruthy();
    // Sem o filtro seriam 2 sessoes com pix_pago; com ele, 1.
    const passo = (corpo.passos as Array<{ key: string; count: number }>).find(p => p.key === 'pagou');
    expect(passo?.count).toBe(1);
  });

  it('getPixFunil: retomado com pix_gerou na sessao (aba recarregada) entra na conta; sem pix_gerou, nao', async () => {
    h.eventos = [
      ev('s1', 'pix_abriu'), ev('s1', 'pix_gerou'), ev('s1', 'pix_pago', { retomado: true }),
      ev('s2', 'pix_abriu'), ev('s2', 'pix_pago', { retomado: true }),
    ];
    h.contratos = [];
    let corpo: any;
    const res = { json: (b: unknown) => { corpo = b; }, status: () => res } as any;
    await getPixFunil({ query: { period: '30dias' } } as any, res);
    expect((corpo.passos as Array<{ key: string; count: number }>).find(p => p.key === 'pagou')?.count).toBe(1);
  });
});
