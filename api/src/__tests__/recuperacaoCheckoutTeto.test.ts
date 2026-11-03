import { describe, it, expect, vi, beforeEach } from 'vitest';

// O carimbo `rec_checkout_sent:` da recuperação de checkout pesa no teto do FRIO da linha (lineThrottle, sem mock do teto).
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { banco } from './_bancoFalso';
import { dentroDoTetoHorarioLinha, maxPorHora, prefixosDaLinha, PREFIXOS_AGENDA } from '../services/agents/whatsapp/lineThrottle';

beforeEach(() => { banco.reset(); });

describe('rec_checkout_sent: no teto da linha', () => {
  it('é prefixo da linha e de FRIO (fora de PREFIXOS_AGENDA)', () => {
    expect(prefixosDaLinha()).toContain('rec_checkout_sent:');
    expect((PREFIXOS_AGENDA as readonly string[]).includes('rec_checkout_sent:')).toBe(false);
  });

  it('sem carimbo há folga; com o teto da hora cheio de carimbos da recuperação, o frio é barrado', async () => {
    expect(await dentroDoTetoHorarioLinha({ transacional: false })).toBe(true);
    const agora = new Date().toISOString();
    for (let i = 0; i < maxPorHora(); i++) banco.poe('system_state', { key: `rec_checkout_sent:ab-${i}:1`, value: {}, updated_at: agora });
    expect(await dentroDoTetoHorarioLinha({ transacional: false })).toBe(false);
  });
});
