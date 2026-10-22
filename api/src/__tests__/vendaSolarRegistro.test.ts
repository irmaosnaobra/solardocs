import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Registro "código -> card" do alocador (`codigo_solar:<NNNN>`), a leitura dos cards em lote e a trava com espera maior. Bancos em
// memória; nada sai para a rede. Dados inventados.

const h = vi.hoisted(() => ({
  linhas: new Map<string, { value: any; updated_at: string }>(),
  cards: [] as Array<Record<string, any>>,
  lotes: [] as number[][],
  cardsCaem: false,
  paginas: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: () => ({
      select: () => ({
        in: async (_c: string, ids: number[]) => {
          h.lotes.push(ids);
          return h.cardsCaem ? { data: null, error: { code: 'XX000' } } : { data: h.cards.filter((c) => ids.includes(c.id)), error: null };
        },
      }),
    }),
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_c: string, k: string) => ({
          maybeSingle: async () => { const l = h.linhas.get(k); return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null }; },
        }),
        like: (_c: string, p: string) => {
          // o `_` do LIKE é curinga: casa a mais (o `startsWith` do código descarta)
          const re = new RegExp(`^${p.replace(/%$/, '.*').replace(/_/g, '.')}$`);
          const chain: any = {
            order: () => chain,
            range: async (de: number, ate: number) => {
              h.paginas++;
              const todas = [...h.linhas.entries()].filter(([k]) => re.test(k)).sort(([a], [b]) => (a < b ? -1 : 1));
              return { data: todas.slice(de, ate + 1).map(([k, l]) => ({ key: k, value: l.value })), error: null };
            },
          };
          return chain;
        },
      }),
      insert: async (l: { key: string; value: unknown; updated_at: string }) => {
        if (h.linhas.has(l.key)) return { error: { code: '23505' } };
        h.linhas.set(l.key, { value: l.value, updated_at: String(l.updated_at) });
        return { error: null };
      },
      delete: () => ({
        eq: (_c: string, k: string) => ({
          eq: (_c2: string, v: string) => ({
            select: async () => {
              const l = h.linhas.get(k);
              if (!l || l.updated_at !== v) return { data: [], error: null };
              h.linhas.delete(k);
              return { data: [{ key: k }], error: null };
            },
          }),
          then: (ok: (x: unknown) => unknown) => { h.linhas.delete(k); return Promise.resolve({ error: null }).then(ok); },
        }),
      }),
    }),
  },
}));

import {
  chaveCodigoSolar, registroAssinado, assinarRegistro, lerRegistrosDeCodigos, lerRegistroDoCodigo, inserirRegistro, apagarRegistro,
  reiniciarLogsDoRegistro, lerEstadoDoRegistro, codigoDoAlocadorDoCard, type RegistroCodigo,
} from '../services/gerador/vendaSolarRegistro';
import { lerCardsPorIds, ErroHub } from '../services/gerador/vendaSolarHub';
import { comTrava, ErroCadastro } from '../services/gerador/cadastroVendaBanco';

const r0: RegistroCodigo = { codigo: '#0065', card: 1143, por: 'nilce', em: '2026-10-22T18:00:00.000Z', origem: 'novo' };

beforeEach(() => {
  h.linhas = new Map(); h.cards = []; h.lotes = []; h.cardsCaem = false; h.paginas = 0;
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste-inventado';
  reiniciarLogsDoRegistro();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.VINCULO_SOLAR_SECRET; });

describe('registro do código', () => {
  it('chave, formato e assinatura; só código, card, quem, quando e origem', async () => {
    expect(chaveCodigoSolar('#0065')).toBe('codigo_solar:0065');
    expect(() => chaveCodigoSolar('#65')).toThrow(ErroHub);
    expect(await inserirRegistro(r0)).toBe('ok');
    const v = h.linhas.get('codigo_solar:0065')!.value;
    expect(Object.keys(v).sort()).toEqual(['card', 'codigo', 'em', 'origem', 'por', 'sig']);
    expect(await lerRegistroDoCodigo('#0065')).toEqual(r0);
    // INSERT nunca sobrescreve
    expect(await inserirRegistro({ ...r0, card: 1 })).toBe('ocupado');
    expect(h.linhas.get('codigo_solar:0065')!.value.card).toBe(1143);
    await apagarRegistro('#0065');
    expect(await lerRegistroDoCodigo('#0065')).toBeNull();
  });
  it('chave incoerente com o código, card torto, origem torta ou assinatura adulterada não valem', () => {
    const sig = assinarRegistro(r0);
    expect(registroAssinado('codigo_solar:0065', { ...r0, sig })).toEqual(r0);
    expect(registroAssinado('codigo_solar:0066', { ...r0, sig })).toBeNull();
    expect(registroAssinado('codigo_solar:0065', { ...r0, card: 1144, sig })).toBeNull();
    expect(registroAssinado('codigo_solar:0065', { ...r0, card: '1143', sig })).toBeNull();
    expect(registroAssinado('codigo_solar:0065', { ...r0, origem: 'auto', sig })).toBeNull();
    expect(registroAssinado('codigo_solar:0065', { ...r0 })).toBeNull();
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    expect(registroAssinado('codigo_solar:0065', { ...r0, sig })).toBeNull();
  });
  it('P1: leitura em três estados; P2: login longo é cortado em 60 e o registro valida', async () => {
    expect(await lerEstadoDoRegistro('#0065')).toEqual({ estado: 'ausente' });
    h.linhas.set('codigo_solar:0065', { updated_at: 'x', value: { ...r0, sig: 'forjada' } });
    expect(await lerEstadoDoRegistro('#0065')).toEqual({ estado: 'invalido' });
    expect(await codigoDoAlocadorDoCard('#0065', 999)).toBe(true);    // inválido: na dúvida, é do alocador
    h.linhas.delete('codigo_solar:0065');
    expect(await inserirRegistro({ ...r0, por: 'y'.repeat(90) })).toBe('ok');
    const e = await lerEstadoDoRegistro('#0065');
    expect(e).toMatchObject({ estado: 'valido', registro: { card: 1143 } });
    expect(await codigoDoAlocadorDoCard('#0065', 1143)).toBe(true);
    expect(await codigoDoAlocadorDoCard('#0065', 999)).toBe(false);
  });
  it('sem segredo, inserir lança sem_segredo', async () => {
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    await expect(inserirRegistro(r0)).rejects.toMatchObject({ codigo: 'sem_segredo' });
  });
  it('lê em páginas (1500 linhas), separa os não assinados e descarta o excesso do curinga', async () => {
    for (let n = 1; n <= 1500; n++) {
      const r = { ...r0, codigo: `#${String(n).padStart(4, '0')}`, card: n };
      h.linhas.set(`codigo_solar:${String(n).padStart(4, '0')}`, { updated_at: 'x', value: { ...r, sig: assinarRegistro(r) } });
    }
    h.linhas.set('codigo_solar:9999', { updated_at: 'x', value: { codigo: '#9999', card: 1 } });
    h.linhas.set('codigoXsolar:0001', { updated_at: 'x', value: {} });   // casa o `_` do LIKE, mas não é nossa
    const { validos, naoAssinados } = await lerRegistrosDeCodigos();
    expect(validos.size).toBe(1500);
    expect([...naoAssinados]).toEqual(['#9999']);
    expect(h.paginas).toBe(2);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('cards em lote', () => {
  it('lotes de 150, sem filtrar status nem origem; erro lança', async () => {
    h.cards = Array.from({ length: 320 }, (_, i) => ({ id: i + 1, status: i % 2 ? 'fechou' : 'agendado', created_by: i % 3 ? 'lp_solar' : 'lp_eletroposto' }));
    const m = await lerCardsPorIds(h.cards.map((c) => c.id));
    expect(m.size).toBe(320);
    expect(h.lotes.map((l) => l.length)).toEqual([150, 150, 20]);
    h.cardsCaem = true;
    await expect(lerCardsPorIds([1])).rejects.toBeInstanceOf(ErroHub);
  });
});

describe('trava', () => {
  it('trava forjada com ate no ano 2100 é tratada como vencida; trava viva barra (ocupado) com a espera pedida', async () => {
    h.linhas.set('cadastro_trava:x', { value: { por: 'forjou', ate: '2100-01-01T00:00:00.000Z' }, updated_at: 'f' });
    expect(await comTrava('x', 'nilce', async () => 'ok')).toBe('ok');
    h.linhas.set('cadastro_trava:x', { value: { por: 'outro', ate: new Date(Date.now() + 60_000).toISOString() }, updated_at: 'v' });
    const t0 = Date.now();
    await expect(comTrava('x', 'nilce', async () => 'ok', 15_000, { tentativas: 3, esperaMs: 50 })).rejects.toBeInstanceOf(ErroCadastro);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(h.linhas.get('cadastro_trava:x')!.updated_at).toBe('v');
  });
  it('espera maior: o segundo espera o primeiro e passa', async () => {
    const ordem: string[] = [];
    const lento = comTrava('y', 'a', async () => { ordem.push('a1'); await new Promise((ok) => setTimeout(ok, 400)); ordem.push('a2'); });
    await new Promise((ok) => setTimeout(ok, 20));
    await comTrava('y', 'b', async () => { ordem.push('b'); }, 15_000, { tentativas: 20, esperaMs: 100 });
    await lento;
    expect(ordem).toEqual(['a1', 'a2', 'b']);
  });
});
