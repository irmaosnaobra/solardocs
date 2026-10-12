import { describe, it, expect, vi, beforeEach } from 'vitest';

// As quatro leituras de bloqueio (opt-out, mudo, bloqueado, pausa humana) falham
// ABERTAS por padrão: erro de leitura vira "ninguém barrado". Para a abertura
// fria da Helena isso é o contrário do certo, então elas ganharam o modo
// estrito. Aqui se prova as duas metades com as funções DE VERDADE:
//   · sem o parâmetro, nada mudou para os outros robôs (continua falhando aberto);
//   · com { estrito: true }, o erro SOBE e a leitura vem inteira, paginada.

type Row = Record<string, any>;
const banco = {
  whatsapp_suppression: [] as Row[],
  atendimento_pausa: [] as Row[],
  mudos: [] as Row[],
  falha: new Set<string>(),      // 'whatsapp_suppression' | 'atendimento_pausa' | 'wa_mudos'
  rpc: [] as Array<{ nome: string; args: Row }>,
};

function consulta(nome: string, linhas: () => Row[]) {
  const st = { filtros: [] as Array<(r: Row) => boolean>, de: 0, ate: Infinity };
  const executar = () => {
    if (banco.falha.has(nome)) return { data: null, error: { message: `banco fora (${nome})` } };
    const todas = linhas().filter(r => st.filtros.every(f => f(r)));
    // O teto de 1000 linhas do PostgREST, como em produção.
    return { data: todas.slice(st.de, Math.min(st.ate + 1, st.de + 1000)), error: null };
  };
  const q: any = {
    select: () => q,
    order: () => q,
    eq: (c: string, v: unknown) => { st.filtros.push(r => r[c] === v); return q; },
    is: (c: string, v: unknown) => { st.filtros.push(r => (r[c] ?? null) === v); return q; },
    range: (de: number, ate: number) => { st.de = de; st.ate = ate; return q; },
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, falha),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: 'whatsapp_suppression' | 'atendimento_pausa') => consulta(t, () => banco[t]),
    rpc: (nome: string, args: Row) => { banco.rpc.push({ nome, args }); return consulta(nome, () => banco.mudos); },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { carregarSilenciados, carregarMudos, carregarBloqueados } from '../services/agents/whatsapp/silenciar';
import { carregarPausas } from '../services/agents/whatsapp/pausaHumana';

const tel = (i: number) => `55349${String(90000000 + i)}`;       // 13 dígitos
const chave = (i: number) => `34${String(90000000 + i)}`;        // DDD + 8 últimos

beforeEach(() => {
  banco.whatsapp_suppression = [];
  banco.atendimento_pausa = [];
  banco.mudos = [];
  banco.falha.clear();
  banco.rpc.length = 0;
  delete process.env.PAUSA_HUMANA_OFF;
});

describe('opt-out (carregarSilenciados)', () => {
  it('padrão: erro de leitura NÃO barra ninguém (inalterado para os outros robôs)', async () => {
    banco.whatsapp_suppression = [{ phone: tel(1), motivo: 'opt_out' }];
    banco.falha.add('whatsapp_suppression');
    const silenciado = await carregarSilenciados();
    expect(silenciado(tel(1))).toBe(false);
  });

  it('estrito: erro de leitura SOBE', async () => {
    banco.falha.add('whatsapp_suppression');
    await expect(carregarSilenciados({ estrito: true })).rejects.toThrow(/leitura do opt-out falhou/);
  });

  it('estrito: lê a lista inteira, além das 1000 linhas', async () => {
    banco.whatsapp_suppression = Array.from({ length: 2300 }, (_, i) => ({ phone: tel(i), motivo: 'opt_out' }));
    const estrito = await carregarSilenciados({ estrito: true });
    expect(estrito(tel(0))).toBe(true);
    expect(estrito(tel(1500))).toBe(true);
    expect(estrito(tel(2299))).toBe(true);
    expect(estrito(tel(5000))).toBe(false);
  });

  it('estrito: a chave continua sendo DDD + 8 (com e sem o nono dígito)', async () => {
    banco.whatsapp_suppression = [{ phone: '5534991360223', motivo: 'opt_out' }];
    const estrito = await carregarSilenciados({ estrito: true });
    expect(estrito('553491360223')).toBe(true);
    expect(estrito('34991360223')).toBe(true);
  });
});

describe('bloqueado à mão (carregarBloqueados)', () => {
  it('padrão: erro de leitura NÃO barra ninguém', async () => {
    banco.falha.add('whatsapp_suppression');
    expect((await carregarBloqueados())(tel(1))).toBe(false);
  });

  it('estrito: erro de leitura SOBE', async () => {
    banco.falha.add('whatsapp_suppression');
    await expect(carregarBloqueados({ estrito: true })).rejects.toThrow(/leitura dos bloqueados falhou/);
  });

  it('estrito: só o motivo fora_do_padrao, e a lista inteira', async () => {
    banco.whatsapp_suppression = [
      ...Array.from({ length: 1200 }, (_, i) => ({ phone: tel(i), motivo: 'fora_do_padrao' })),
      { phone: tel(9000), motivo: 'opt_out' },
    ];
    const bloqueado = await carregarBloqueados({ estrito: true });
    expect(bloqueado(tel(1199))).toBe(true);
    expect(bloqueado(tel(9000))).toBe(false);
  });
});

describe('mudo (carregarMudos)', () => {
  it('padrão: erro de leitura NÃO barra ninguém', async () => {
    banco.falha.add('wa_mudos');
    expect((await carregarMudos(2))(tel(1))).toBe(false);
  });

  it('estrito: erro de leitura SOBE', async () => {
    banco.falha.add('wa_mudos');
    await expect(carregarMudos(2, 60, { estrito: true })).rejects.toThrow(/leitura dos mudos falhou/);
  });

  it('estrito: pede 2 toques em 60 dias e lê além das 1000 linhas', async () => {
    banco.mudos = Array.from({ length: 1700 }, (_, i) => ({ telefone: chave(i) }));
    const mudo = await carregarMudos(2, 60, { estrito: true });
    expect(banco.rpc[0]).toEqual({ nome: 'wa_mudos', args: { min_toques: 2, dias: 60 } });
    expect(mudo(tel(0))).toBe(true);
    expect(mudo(tel(1699))).toBe(true);
    expect(mudo(tel(1700))).toBe(false);
  });
});

describe('humano na conversa (carregarPausas)', () => {
  const pausa = (i: number): Row => ({
    chave: chave(i), telefone: tel(i), quem: 'Giovanna', liberado_em: null,
    ultima_fala_humano: new Date().toISOString(), ultima_fala_lead: null,
  });

  it('padrão: erro de leitura NÃO barra ninguém', async () => {
    banco.atendimento_pausa = [pausa(1)];
    banco.falha.add('atendimento_pausa');
    expect((await carregarPausas())(tel(1)).pode).toBe(true);
  });

  it('estrito: erro de leitura SOBE', async () => {
    banco.falha.add('atendimento_pausa');
    await expect(carregarPausas({ estrito: true })).rejects.toThrow(/leitura das pausas falhou/);
  });

  it('estrito: lê as pausas inteiras, além das 1000 linhas, e só as não liberadas', async () => {
    banco.atendimento_pausa = [
      ...Array.from({ length: 1300 }, (_, i) => pausa(i)),
      { ...pausa(8000), liberado_em: new Date().toISOString() },
    ];
    const gate = await carregarPausas({ estrito: true });
    expect(gate(tel(0)).pode).toBe(false);
    expect(gate(tel(1299)).pode).toBe(false);
    expect(gate(tel(8000)).pode).toBe(true);
    expect(gate(tel(9999)).pode).toBe(true);
  });

  it('sem o parâmetro, a leitura normal continua funcionando igual', async () => {
    banco.atendimento_pausa = [pausa(1)];
    const gate = await carregarPausas();
    expect(gate(tel(1)).pode).toBe(false);
    expect(gate(tel(2)).pode).toBe(true);
  });
});
