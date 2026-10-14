import { describe, it, expect } from 'vitest';
import { ehHorarioDeAlmoco, ehAlmocoNoIso } from '../services/agenda/almoco';
import { ehHorarioDeAlmoco as reexportado } from '../services/io/eletropostoVagas';

// Almoço travado (13/10/2026): início >= 12:00 e < 13:30, em Brasília.
describe('almoco.ts', () => {
  it('ehHorarioDeAlmoco: 11:59 fora, 12:00 e 13:29 dentro, 13:30 fora', () => {
    expect(ehHorarioDeAlmoco('11:59')).toBe(false);
    expect(ehHorarioDeAlmoco('12:00')).toBe(true);
    expect(ehHorarioDeAlmoco('13:29')).toBe(true);
    expect(ehHorarioDeAlmoco('13:30')).toBe(false);
  });

  it('eletropostoVagas reexporta a mesma função', () => {
    expect(reexportado).toBe(ehHorarioDeAlmoco);
  });

  it('ehAlmocoNoIso conta em Brasília, não em UTC', () => {
    expect(ehAlmocoNoIso('2026-10-14T15:00:00Z')).toBe(true);   // 12:00 BRT
    expect(ehAlmocoNoIso('2026-10-14T16:29:00Z')).toBe(true);   // 13:29 BRT
    expect(ehAlmocoNoIso('2026-10-14T16:30:00Z')).toBe(false);  // 13:30 BRT
    expect(ehAlmocoNoIso('2026-10-14T14:59:00Z')).toBe(false);  // 11:59 BRT
    expect(ehAlmocoNoIso('2026-10-14T12:00:00Z')).toBe(false);  // 09:00 BRT: 12:00 UTC não é almoço
    expect(ehAlmocoNoIso('2026-10-14T12:00:00-03:00')).toBe(true);
  });

  it('ehAlmocoNoIso: texto inválido devolve false', () => {
    expect(ehAlmocoNoIso('')).toBe(false);
    expect(ehAlmocoNoIso('não é data')).toBe(false);
  });
});
