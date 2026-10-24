import { describe, it, expect, vi, beforeEach } from 'vitest';

// O teto de emergência da linha para a ficha ao consultor (60 na hora, 450 em 24 h) tem que contar o carimbo do aviso ao grupo
// de vendas do SolarDoc (`solardoc_aviso_sent:`), como o vivoEnvio e a agenda. Banco simulado na memória; o lineThrottle é o de verdade.

const h = vi.hoisted(() => ({ estado: new Map<string, { updated_at: string }>() }));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      let pref: string[] = [];
      let desde = '';
      let de = 0;
      let ate = 999;
      const q: any = {
        select: () => q,
        or: (expr: string) => { pref = expr.split(',').map(x => x.replace(/^key\.like\./, '').replace(/%$/, '')); return q; },
        gte: (_c: string, v: string) => { desde = v; return q; },
        order: () => q,
        range: (a: number, b: number) => { de = a; ate = b; return q; },
        then: (ok: (v: unknown) => unknown) => {
          const todas = [...h.estado.entries()].filter(([k, r]) => pref.some(p => k.startsWith(p)) && r.updated_at >= desde).map(([key]) => ({ key }));
          return ok({ data: todas.slice(de, ate + 1), error: null });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  solardocViaIo: () => false,
  linhaEmCooldown: () => false,
  sendHuman: vi.fn(), sendImage: vi.fn(), sendWhatsApp: vi.fn(),
}));

import { tetoDaLinhaPermiteFicha } from '../services/agentes5040/fichaEnvio';

const AGORA = new Date('2026-10-24T15:00:00.000Z');
const semear = (prefixo: string, n: number, atrasMs: number): void => {
  for (let i = 0; i < n; i++) h.estado.set(`${prefixo}${i}`, { updated_at: new Date(AGORA.getTime() - atrasMs).toISOString() });
};

beforeEach(() => { h.estado.clear(); });

describe('tetoDaLinhaPermiteFicha: o aviso ao grupo do SolarDoc pesa na conta da linha', () => {
  it('60 carimbos solardoc_aviso_sent: na última hora barram a ficha; 59 deixam', async () => {
    semear('solardoc_aviso_sent:', 59, 20 * 60_000);
    expect(await tetoDaLinhaPermiteFicha(AGORA)).toBe('ok');
    semear('solardoc_aviso_sent:', 60, 20 * 60_000);
    expect(await tetoDaLinhaPermiteFicha(AGORA)).toBe('teto');
  });
  it('450 carimbos em 24 h barram a ficha; 449 deixam', async () => {
    semear('solardoc_aviso_sent:', 449, 5 * 3_600_000);
    expect(await tetoDaLinhaPermiteFicha(AGORA)).toBe('ok');
    semear('solardoc_aviso_sent:', 450, 5 * 3_600_000);
    expect(await tetoDaLinhaPermiteFicha(AGORA)).toBe('teto');
  });
  it('o que já contava continua contando (ag5040_sent: e ficha_lead:)', async () => {
    semear('ag5040_sent:', 30, 20 * 60_000);
    semear('ficha_lead:', 30, 20 * 60_000);
    expect(await tetoDaLinhaPermiteFicha(AGORA)).toBe('teto');
  });
});
