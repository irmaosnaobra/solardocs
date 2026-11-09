import { describe, it, expect, vi, beforeEach } from 'vitest';

// Agenda de {dia} (agenda-proxima.yml, 3x/dia): desde 08/11/2026 só o Diego recebe; o Thiago saiu.
const h = vi.hoisted(() => ({ envios: [] as Array<{ tel: string; instancia: string }>, falha: false }));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string, _t: string, instancia: string) => {
    if (h.falha) throw new Error('z-api fora');
    h.envios.push({ tel, instancia });
  }),
}));
vi.mock('../utils/supabaseGerador', () => {
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, lte: () => q,
    order: async () => ({ data: [], error: null }),
  };
  return { supabaseGerador: { from: () => q } };
});

import { enviarAgendaProxima } from '../services/agenda/agendaProximaDigest';

beforeEach(() => { h.envios.length = 0; h.falha = false; });

describe('Agenda de {dia}: destinatários', () => {
  it('manda uma mensagem só, ao Diego, pela linha IO; o Thiago não recebe', async () => {
    const r = await enviarAgendaProxima();
    expect(r).toMatchObject({ enviados: 1, erros: 0 });
    expect(h.envios).toHaveLength(1);
    expect(h.envios[0].instancia).toBe('io');
    expect(h.envios[0].tel).toMatch(/172$/);          // final do telefone do Diego
    expect(h.envios.map(e => e.tel).join(',')).not.toMatch(/223/);   // final do telefone do Thiago
  });

  it('dry não envia nada', async () => {
    const r = await enviarAgendaProxima({ dry: true });
    expect(r.enviados).toBe(0);
    expect(h.envios).toHaveLength(0);
  });

  it('falha de envio vira erro contado, sem lançar', async () => {
    h.falha = true;
    expect(await enviarAgendaProxima()).toMatchObject({ enviados: 0, erros: 1 });
  });
});
