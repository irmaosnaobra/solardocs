import { describe, it, expect, vi, beforeEach } from 'vitest';

// Os carimbos novos do lembrete de renovação, do dunning e da 2ª perna da Carla do quiz (04/11/2026) são FRIOS: pesam no teto da linha
// e ficam fora de PREFIXOS_AGENDA. Teto REAL (lineThrottle sem mock) sobre o banco falso.
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { banco } from './_bancoFalso';
import { dentroDoTetoHorarioLinha, maxPorHora, prefixosDaLinha, PREFIXOS_AGENDA } from '../services/agents/whatsapp/lineThrottle';

const NOVOS = ['pix_vip_sent:', 'dunning_sent:', 'quiz_rec_sent2:'] as const;

beforeEach(() => { banco.reset(); });

describe('prefixos frios novos da linha', () => {
  it('estão em BOT_SENT_PREFIXES (prefixosDaLinha) e fora de PREFIXOS_AGENDA, ou seja, são do balde FRIO', () => {
    for (const p of NOVOS) {
      expect(prefixosDaLinha()).toContain(p);
      expect((PREFIXOS_AGENDA as readonly string[]).includes(p)).toBe(false);
    }
  });

  for (const p of NOVOS) {
    it(`sonda: gravar ${p}sonda sobe a contagem do teto, e apagar faz ela voltar`, async () => {
      const agora = new Date().toISOString();
      // Uma vaga de sobra no teto da hora.
      for (let i = 0; i < maxPorHora() - 1; i++) banco.poe('system_state', { key: `quiz_rec_sent:cheio${i}`, value: {}, updated_at: agora });
      expect(await dentroDoTetoHorarioLinha({ transacional: false })).toBe(true);
      banco.poe('system_state', { key: `${p}sonda`, value: {}, updated_at: agora });
      expect(await dentroDoTetoHorarioLinha({ transacional: false })).toBe(false);
      banco.tabelas['system_state'] = banco.linhas('system_state').filter(r => r.key !== `${p}sonda`);
      expect(await dentroDoTetoHorarioLinha({ transacional: false })).toBe(true);
    });
  }
});
