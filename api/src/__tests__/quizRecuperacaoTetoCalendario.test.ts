import { describe, it, expect, vi } from 'vitest';

// O teto de 120 h de calendário (03/11/2026). Com o calendário real nenhum trecho de 121 h tem menos de 49 h úteis (medido de 2026 a 2030,
// de hora em hora): o pior caso são 3 dias inteiros de folga seguidos. Para provar o teto, este arquivo injeta feriados a mais.
const h = vi.hoisted(() => ({ extras: new Set<string>() }));
vi.mock('../utils/feriadosBR', async (orig) => {
  const real = await orig<typeof import('../utils/feriadosBR')>();
  return { ...real, ehFeriadoBR: (ymd: string) => h.extras.has(ymd) || real.ehFeriadoBR(ymd) };
});

import { foraDoTempo, idadeUtilMs, JANELA_MAX_MS, TETO_CALENDARIO_MS, JANELA_LEITURA_COM_ROBO_MS } from '../services/solardoc/recuperacaoCarlaRegras';

const HORA = 3600_000;

describe('teto de calendário de 120 h', () => {
  // domingo 08/11/2026 09:00 BRT; segunda, terça e quarta viram feriado (injetado): 87 h excluídas em 121 h de calendário
  const criado = '2026-11-08T12:00:00.000Z';
  const t0 = Date.parse(criado);

  it('121 h de calendário é vencido mesmo com a idade útil abaixo de 48 h', () => {
    h.extras = new Set(['2026-11-09', '2026-11-10', '2026-11-11']);
    const agora = t0 + 121 * HORA;
    expect(idadeUtilMs(t0, agora)).toBe(34 * HORA);
    expect(idadeUtilMs(t0, agora)).toBeLessThan(JANELA_MAX_MS);
    expect(foraDoTempo({ created_time: criado }, agora)).toBe('vencido');
  });
  it('120 h de calendário ainda vale (o teto é "passar de 120 h")', () => {
    h.extras = new Set(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(foraDoTempo({ created_time: criado }, t0 + 120 * HORA)).toBeNull();
    expect(foraDoTempo({ created_time: criado }, t0 + 120 * HORA + 60_000)).toBe('vencido');
  });
  it('a leitura do tick vai do teto de calendário mais folga até as 48 h: nunca invertida', () => {
    expect(JANELA_LEITURA_COM_ROBO_MS).toBeGreaterThan(TETO_CALENDARIO_MS);
    expect(JANELA_LEITURA_COM_ROBO_MS).toBeGreaterThan(JANELA_MAX_MS);
  });
});
