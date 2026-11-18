import { describe, it, expect, vi, beforeEach } from 'vitest';

// E9 (17/11/2026): a LimpaPro cedeu vaga do frio da linha 5040 à retomada da SolarDoc. No máximo `LIMPAPRO_FRIO_DIA` (padrão 3) envios frios em 24 h,
// contados pelos carimbos dos 4 toques ANTES de enviar. O marcador pendente sobrevive (não é consumido).

type Linha = { key: string; value: Record<string, unknown>; updated_at: string };
const h = vi.hoisted(() => ({
  carimbos: [] as Array<{ key: string; updated_at: string }>,
  pendentes: [] as Linha[],
  apagados: [] as string[],
  sendFrio: vi.fn(async () => true),
}));

function construtor() {
  let orFiltro = '';
  let gte = '';
  let max = 1000;
  let op: 'select' | 'delete' = 'select';
  let chave = '';
  const q: any = {
    select: () => q,
    delete: () => { op = 'delete'; return q; },
    eq: (_c: string, v: string) => { chave = v; return q; },
    or: (f: string) => { orFiltro = f; return q; },
    gte: (_c: string, v: string) => { gte = v; return q; },
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { h.apagados.push(chave); return Promise.resolve({ data: { key: chave }, error: null }); },
    then: (res: (v: unknown) => unknown) => {
      if (op === 'select' && orFiltro.includes('_pending:')) return res({ data: h.pendentes, error: null });
      const prefixos = orFiltro.split(',').map(p => p.replace('key.like.', '').replace(/%$/, ''));
      const lista = h.carimbos.filter(c => prefixos.some(p => c.key.startsWith(p)) && c.updated_at >= gte).slice(0, max);
      return res({ data: lista.map(c => ({ key: c.key })), error: null });
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({
  supabase: { from: () => construtor(), rpc: async () => ({ data: { leads_abertos: [] }, error: null }) },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({ sendFrio: (...a: unknown[]) => (h.sendFrio as any)(...a), fmtPhone: (t: string) => t }));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: async () => true,
  dentroDaJanelaDiurna: () => true,
  respeitaEspacamentoLinha: async () => true,
}));

import { runLimpaproRecoveryConsumer, limpaproFrioNoTeto, tetoFrioLimpapro } from '../services/agents/whatsapp/limpaproRecoveryService';

const AGORA = Date.now();
const atras = (horas: number): string => new Date(AGORA - horas * 3600_000).toISOString();
const carimbo = (prefixo: string, n: number, horas: number): void => { h.carimbos.push({ key: `${prefixo}l${n}@x.com`, updated_at: atras(horas) }); };

beforeEach(() => {
  h.carimbos = []; h.apagados = []; h.sendFrio.mockClear();
  h.pendentes = [{ key: 'limpapro_recovery_pending:novo@x.com', value: { origem: 'opener' }, updated_at: atras(1) }];
  process.env.ZAPI_INSTANCE_ID_IO = 'id'; process.env.ZAPI_TOKEN_IO = 'tk'; process.env.RECUP_ENABLED = 'true';
  delete process.env.LIMPAPRO_FRIO_DIA;
});

describe('o teto de frio da LimpaPro', () => {
  it('o padrão é 3 e a env LIMPAPRO_FRIO_DIA muda (lixo volta ao padrão)', () => {
    expect(tetoFrioLimpapro(undefined)).toBe(3);
    expect(tetoFrioLimpapro('5')).toBe(5);
    expect(tetoFrioLimpapro('0')).toBe(0);
    expect(tetoFrioLimpapro('abc')).toBe(3);
    expect(tetoFrioLimpapro('')).toBe(3);
  });

  it('conta os carimbos dos 4 toques nas últimas 24 h; o que passou de 24 h não pesa', async () => {
    carimbo('limpapro_recovery:', 1, 2); carimbo('limpapro_cupom_sent:', 2, 5); carimbo('limpapro_grupo_sent:', 3, 30);
    expect(await limpaproFrioNoTeto()).toBe(false);
    carimbo('limpapro_fechamento_sent:', 4, 10);
    expect(await limpaproFrioNoTeto()).toBe(true);
  });
});

describe('o consumidor da LimpaPro', () => {
  it('com 3 carimbos em 24 h não envia o 4º: o marcador pendente fica (nada é consumido)', async () => {
    for (let i = 0; i < 3; i++) carimbo('limpapro_recovery:', i, 3 + i);
    const r = await runLimpaproRecoveryConsumer();
    expect(r.enviados).toBe(0);
    expect(r.motivo.teto_frio_dia).toBe(1);
    expect(r.mantidos).toBe(1);
    expect(h.apagados).toEqual([]);
    expect(h.sendFrio).not.toHaveBeenCalled();
  });

  it('com 2 carimbos o gate passa (o marcador é reivindicado)', async () => {
    for (let i = 0; i < 2; i++) carimbo('limpapro_recovery:', i, 3 + i);
    const r = await runLimpaproRecoveryConsumer();
    expect(r.motivo.teto_frio_dia).toBeUndefined();
    expect(h.apagados).toEqual(['limpapro_recovery_pending:novo@x.com']);
  });

  it('LIMPAPRO_FRIO_DIA=5 libera até 5', async () => {
    process.env.LIMPAPRO_FRIO_DIA = '5';
    for (let i = 0; i < 4; i++) carimbo('limpapro_recovery:', i, 3 + i);
    const r = await runLimpaproRecoveryConsumer();
    expect(r.motivo.teto_frio_dia).toBeUndefined();
  });
});
