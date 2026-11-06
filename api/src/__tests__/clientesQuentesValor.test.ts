import { describe, it, expect, vi, beforeEach } from 'vitest';

// A leitura das fontes do valor real da venda: só ligação ASSINADA (lerTodasLigacoes) e propostas vendidas. Nunca lança.
let ligacoes: Map<number, { proposta: string | null; venda: string | null; por: string; em: string }> = new Map();
let propostas: any[] = [];
let ligacoesFalham = false;
let propostasFalham = false;
let obras: Map<number, any> = new Map();

vi.mock('../services/gerador/vendaSolarHub', () => ({
  lerTodasLigacoes: async () => { if (ligacoesFalham) throw new Error('banco fora'); return ligacoes; },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => ({
      select: () => ({
        in: (_c: string, codigos: string[]) => Promise.resolve(propostasFalham
          ? { data: null, error: { message: 'queda' } }
          : { data: propostas.filter(p => codigos.includes(p.codigo)), error: null }),
      }),
    }),
  },
}));
vi.mock('../services/gerador/jornadaSolarBanco', () => ({
  lerPrivadoJornada: async (id: number) => { const o = obras.get(id); if (o instanceof Error) throw o; return o ?? null; },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const lig = (venda: string | null, proposta: string | null = null) => ({ venda, proposta, por: 'gerador', em: '2026-11-01T10:00:00Z' });
const prop = (codigo: string, valor: number | null, over: Record<string, unknown> = {}) => ({ codigo, vendido: true, valor_vendido: valor, tipo: null, ...over });

beforeEach(() => { ligacoes = new Map(); propostas = []; ligacoesFalham = false; propostasFalham = false; obras = new Map(); });

async function ler(ids: number[]) {
  const m = await import('../services/meta/clientesQuentesValor');
  return m.lerFontesDeValor(ids);
}

describe('lerFontesDeValor', () => {
  it('lê o código das ligações de todos os cards e o valor da proposta só dos pedidos', async () => {
    ligacoes = new Map([[3, lig('#0065', 'P-1')], [4, lig('#0066', 'P-2')], [8, lig(null, null)]]);
    propostas = [prop('P-1', 18200), prop('P-2', 9000)];
    const f = await ler([3]);
    expect([...f.codigosDoCard.entries()]).toEqual([[3, [65]], [4, [66]]]);
    expect([...f.valorDaProposta.entries()]).toEqual([[3, 18200]]);
  });
  it('proposta ligada a dois cards, não vendida, de eletroposto, sem valor ou repetida no banco: sem valor', async () => {
    ligacoes = new Map([[1, lig(null, 'P-1')], [2, lig(null, 'P-1')], [3, lig(null, 'P-3')], [4, lig(null, 'P-4')], [5, lig(null, 'P-5')], [6, lig(null, 'P-6')]]);
    propostas = [prop('P-1', 5000), prop('P-3', 5000, { vendido: false }), prop('P-4', 5000, { tipo: 'eletroposto' }), prop('P-5', null), prop('P-6', 5000), prop('P-6', 7000)];
    const f = await ler([1, 2, 3, 4, 5, 6]);
    expect(f.valorDaProposta.size).toBe(0);
  });
  it('falha de leitura (ligações ou propostas) devolve fontes vazias, sem lançar', async () => {
    ligacoes = new Map([[3, lig('#0065', 'P-1')]]); propostas = [prop('P-1', 18200)];
    ligacoesFalham = true;
    let f = await ler([3]);
    expect(f.codigosDoCard.size + f.valorDaProposta.size).toBe(0);
    ligacoesFalham = false; propostasFalham = true;
    f = await ler([3]);
    expect(f.codigosDoCard.size + f.valorDaProposta.size).toBe(0);
  });
  it('o valor da obra: centavos viram reais; venda nula ou zerada fica de fora', async () => {
    obras = new Map([[1, { venda: { valor_centavos: 3890000 } }], [2, { venda: null }], [3, null], [4, { venda: { valor_centavos: 0 } }]]);
    const f = await ler([1, 2, 3, 4]);
    expect([...f.valorDaJornada.entries()]).toEqual([[1, 38900]]);
  });
  it('card cuja leitura da obra lança: os outros seguem', async () => {
    obras = new Map<number, any>([[1, new Error('bucket fora')], [2, { venda: { valor_centavos: 1500000 } }], [3, { venda: { valor_centavos: 2000000 } }]]);
    const f = await ler([1, 2, 3]);
    expect([...f.valorDaJornada.entries()]).toEqual([[2, 15000], [3, 20000]]);
  });
  it('ligações caindo: volta o valor da obra cheio e as outras fontes vazias', async () => {
    obras = new Map([[7, { venda: { valor_centavos: 4200000 } }]]);
    ligacoes = new Map([[7, lig('#0065', 'P-1')]]); propostas = [prop('P-1', 18200)];
    ligacoesFalham = true;
    const f = await ler([7]);
    expect([...f.valorDaJornada.entries()]).toEqual([[7, 42000]]);
    expect(f.codigosDoCard.size + f.valorDaProposta.size).toBe(0);
  });
});
