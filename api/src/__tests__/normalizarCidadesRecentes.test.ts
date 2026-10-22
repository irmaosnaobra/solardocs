import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tabelas falsas: cada .from(nome) devolve as linhas daquela tabela e anota os updates.
const linhasPorTabela: Record<string, any[]> = {};
const updates: Array<{ tabela: string; valor: string; coluna: string; ids: any[]; original: string }> = [];
// ids que "mudaram no meio" (a cidade já não é a lida): o update não acha a linha e devolve vazio.
const mudouNoMeio = new Set<any>();
let devolverVazio = false;
const lidoDesde: Record<string, string> = {};
let falharLeituraDe: string | null = null;
let falharUpdate = false;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: vi.fn((tabela: string) => {
      const q: any = {
        select: vi.fn(() => q),
        not: vi.fn(() => q),
        order: vi.fn(() => q),
        gte: vi.fn((_c: string, v: string) => { lidoDesde[tabela] = v; return q; }),
        range: vi.fn(async () => (falharLeituraDe === tabela
          ? { data: null, error: { message: 'boom' } }
          : { data: linhasPorTabela[tabela] || [], error: null })),
        update: vi.fn((patch: any) => {
          const u: any = { original: undefined, coluna: '', ids: [] as any[] };
          u.eq = vi.fn((_c: string, v: string) => { u.original = v; return u; });
          u.in = vi.fn((coluna: string, ids: any[]) => { u.coluna = coluna; u.ids = ids; return u; });
          u.select = vi.fn(async () => {
            if (falharUpdate) return { data: null, error: { message: 'negado' } };
            const pegou = devolverVazio ? [] : u.ids.filter((i: any) => !mudouNoMeio.has(i));
            if (pegou.length) updates.push({ tabela, valor: patch.cidade, coluna: u.coluna, ids: pegou, original: u.original });
            return { data: pegou.map((i: any) => ({ [u.coluna]: i })), error: null };
          });
          return u;
        }),
      };
      return q;
    }),
  },
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { normalizarCidadesRecentes, MAX_ATUALIZACOES } from '../services/io/normalizarCidadesRecentes';

beforeEach(() => {
  for (const k of Object.keys(linhasPorTabela)) delete linhasPorTabela[k];
  updates.length = 0;
  falharLeituraDe = null;
  falharUpdate = false;
  devolverVazio = false;
  mudouNoMeio.clear();
});

describe('normalizarCidadesRecentes', () => {
  it('atualiza só ok/ddd com valor diferente, agrupando por tabela e cidade', async () => {
    linhasPorTabela.agendamentos = [
      { id: 1, cidade: 'uberlandia', cliente_telefone: '5534999990000' },
      { id: 2, cidade: 'UberlÂndia', cliente_telefone: '5534999990001' },
      { id: 3, cidade: 'Uberlândia-MG', cliente_telefone: '5534999990002' },   // já no formato
      { id: 4, cidade: 'Santa Luzia', cliente_telefone: '5531999990003' },      // ddd
      { id: 5, cidade: 'Santa Luzia', cliente_telefone: '5511999990004' },      // ambígua, DDD não decide
      { id: 6, cidade: '37', cliente_telefone: '5534999990005' },               // lixo
    ];
    linhasPorTabela.leads_meta = [{ lead_id: 'abc', cidade: 'Goiania go', whatsapp: '5562999990000' }];
    const r = await normalizarCidadesRecentes(new Date('2026-10-22T12:00:00Z'));
    expect(r.atualizadas).toBe(4);
    expect(r.falhas).toBe(0);
    // agrupa por (original, novo): cada grafia lida vira um update que confere o valor antigo
    expect(updates).toContainEqual({ tabela: 'agendamentos', valor: 'Uberlândia-MG', coluna: 'id', ids: [1], original: 'uberlandia' });
    expect(updates).toContainEqual({ tabela: 'agendamentos', valor: 'Uberlândia-MG', coluna: 'id', ids: [2], original: 'UberlÂndia' });
    expect(updates).toContainEqual({ tabela: 'agendamentos', valor: 'Santa Luzia-MG', coluna: 'id', ids: [4], original: 'Santa Luzia' });
    expect(updates).toContainEqual({ tabela: 'leads_meta', valor: 'Goiânia-GO', coluna: 'lead_id', ids: ['abc'], original: 'Goiania go' });
    expect(r.porTabela.agendamentos).toEqual({ lidas: 6, atualizadas: 3 });
  });

  it('olha só os últimos 3 dias', async () => {
    await normalizarCidadesRecentes(new Date('2026-10-22T12:00:00Z'));
    expect(lidoDesde.agendamentos).toBe('2026-10-19T12:00:00.000Z');
    expect(Object.keys(lidoDesde).sort()).toEqual(
      ['agendamentos', 'eletroposto_nota1', 'eletroposto_parceria', 'leads_meta']);
  });

  it('no máximo 500 atualizações por rodada', async () => {
    linhasPorTabela.agendamentos = Array.from({ length: 700 }, (_, i) => ({
      id: i + 1, cidade: 'uberlandia', cliente_telefone: '5534999990000',
    }));
    const r = await normalizarCidadesRecentes();
    expect(MAX_ATUALIZACOES).toBe(500);
    expect(r.atualizadas).toBe(500);
    expect(updates.every(u => u.ids.length <= 200)).toBe(true);
  });

  it('nunca lança: leitura que falha numa tabela não impede as outras', async () => {
    falharLeituraDe = 'agendamentos';
    linhasPorTabela.eletroposto_nota1 = [{ id: 9, cidade: 'Brasilia DF', telefone: '5561999990000' }];
    const r = await normalizarCidadesRecentes();
    expect(r.falhas).toBe(1);
    expect(r.atualizadas).toBe(1);
    expect(updates[0]).toMatchObject({ tabela: 'eletroposto_nota1', valor: 'Brasília-DF' });
  });

  it('edição no meio: a linha cuja cidade já mudou não conta como atualizada', async () => {
    linhasPorTabela.agendamentos = [
      { id: 1, cidade: 'uberlandia', cliente_telefone: '5534999990000' },
      { id: 2, cidade: 'uberlandia', cliente_telefone: '5534999990001' },
    ];
    mudouNoMeio.add(2);
    const r = await normalizarCidadesRecentes();
    expect(r.atualizadas).toBe(1);
    expect(r.porTabela.agendamentos).toEqual({ lidas: 2, atualizadas: 1 });
    expect(updates).toEqual([{ tabela: 'agendamentos', valor: 'Uberlândia-MG', coluna: 'id', ids: [1], original: 'uberlandia' }]);
  });

  it('update que a RLS nega sem erro (volta vazio) conta 0', async () => {
    devolverVazio = true;
    linhasPorTabela.agendamentos = [{ id: 1, cidade: 'uberlandia', cliente_telefone: '5534999990000' }];
    const r = await normalizarCidadesRecentes();
    expect(r.atualizadas).toBe(0);
    expect(r.falhas).toBe(0);
  });

  it('nunca lança: update negado vira falha no resumo', async () => {
    falharUpdate = true;
    linhasPorTabela.eletroposto_parceria = [{ id: 1, cidade: 'salvador bahia', telefone: '5571999990000' }];
    const r = await normalizarCidadesRecentes();
    expect(r.atualizadas).toBe(0);
    expect(r.falhas).toBe(1);
  });
});
