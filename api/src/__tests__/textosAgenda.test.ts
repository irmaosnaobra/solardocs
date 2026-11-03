import { describe, it, expect } from 'vitest';
import { citaAHora, citaSoEstaHora, horasCitadas, hhmmBRT } from '../services/agentes5040/textosAgenda';

// citaSoEstaHora: a fala cita UMA hora só, e é a do horário marcado. Oferta com duas horas nunca vale como confirmação.

const T1430 = '2026-10-22T17:30:00.000Z';   // 14h30 em Brasília
const T14 = '2026-10-22T17:00:00.000Z';     // 14h
const T9 = '2026-10-22T12:00:00.000Z';      // 9h

describe('citaSoEstaHora', () => {
  it('número solto depois de "às" ou "ou" também é hora: "14h ou às 15?" é oferta, não confirmação', () => {
    for (const oferta of ['Pode ser 14h ou às 15?', 'Tenho 14h, ou 15 se preferir', '14h ou as 15, qual fica melhor?']) {
      expect(citaSoEstaHora(oferta, T14), oferta).toBe(false);
    }
    expect([...horasCitadas('Pode ser 14h ou às 15?')].sort()).toEqual(['14:00', '15:00']);
    expect(citaSoEstaHora('Fechado, às 14h então', T14)).toBe(true);
  });

  it('uma hora só, e é a do card: 14h30, 14:30, 14h 30, caixa alta e hora repetida', () => {
    for (const ok of ['Fechado para quinta às 14h30!', 'Quinta, 14:30. Combinado', 'às 14h 30 então', 'ÀS 14H30', 'Quinta às 14h30, ok? Te espero às 14h30', 'dia 22/10 às 14h30']) {
      expect(citaSoEstaHora(ok, T1430), ok).toBe(true);
    }
  });

  it('a hora cheia aceita 14h, 14:00, 14 horas; 09h e 9h dão a mesma hora', () => {
    for (const ok of ['às 14h', 'às 14:00', 'às 14 horas', 'as 14h, tudo bem?', 'às 14h.']) expect(citaSoEstaHora(ok, T14), ok).toBe(true);
    for (const ok of ['às 09h', 'às 9h', 'às 9:00', 'às 9 horas']) expect(citaSoEstaHora(ok, T9), ok).toBe(true);
  });

  it('oferta com duas horas, ou uma hora de outro horário, dá falso', () => {
    for (const no of ['14h30 ou 15h?', 'Pode ser 14h30 ou 15h30?', 'Das 9h às 18h, 14h30 serve?', 'às 14:30 ou às 16:00', 'Combinado, 14h30 e 15h']) {
      expect(citaSoEstaHora(no, T1430), no).toBe(false);
    }
    for (const no of ['Fechado para quinta às 14h!', 'Quinta às 4h30', 'às 14h45', 'Combinado, deixei marcado', 'dia 14/10 às 15h30', '', 'às 114h30']) {
      expect(citaSoEstaHora(no, T1430), no).toBe(false);
    }
    for (const no of ['às 14h30', 'às 4h', 'às 114h', 'às 14h e às 15h']) expect(citaSoEstaHora(no, T14), no).toBe(false);
    expect(citaSoEstaHora('às 19h', T9)).toBe(false);
  });

  it('data não vira hora, mas número com h solto (24h, 48h) conta como hora a mais e tira o "só esta"', () => {
    expect(citaSoEstaHora('Fechado: 22/10 às 14h30', T1430)).toBe(true);
    expect(citaSoEstaHora('Atendemos 24h. Ficou às 14h30', T1430)).toBe(false);
    expect(citaSoEstaHora('Em 48h te retorno, às 14h30', T1430)).toBe(false);
  });

  it('texto nulo, vazio ou horário do card ilegível: falso', () => {
    expect(citaSoEstaHora(null, T1430)).toBe(false);
    expect(citaSoEstaHora(undefined, T1430)).toBe(false);
    expect(citaSoEstaHora('às 14h30', 'lixo')).toBe(false);
    expect(citaSoEstaHora('às 14h30', '')).toBe(false);
  });

  it('toda fala verdadeira no citaSoEstaHora também é verdadeira no citaAHora (as duas regex não divergem)', () => {
    const casos: Array<[string, string]> = [
      ['Fechado para quinta às 14h30!', T1430], ['Quinta, 14:30. Combinado', T1430], ['às 14h 30 então', T1430], ['ÀS 14H30', T1430],
      ['às 14h', T14], ['às 14:00', T14], ['às 14 horas', T14], ['as 14h, tudo bem?', T14],
      ['às 09h', T9], ['às 9h', T9], ['às 9 horas', T9], ['dia 22/10 às 14h30', T1430],
    ];
    for (const [texto, iso] of casos) {
      expect(citaSoEstaHora(texto, iso), texto).toBe(true);
      expect(citaAHora(texto, iso), texto).toBe(true);
    }
  });

  it('horasCitadas e hhmmBRT: o conjunto normalizado e o HH:MM de Brasília', () => {
    expect([...horasCitadas('14h30 ou 9h ou 14 horas ou 16:05')].sort()).toEqual(['09:00', '14:00', '14:30', '16:05']);
    expect([...horasCitadas('14h 30')]).toEqual(['14:30']);
    expect(horasCitadas('sem hora nenhuma, dia 14/10').size).toBe(0);
    expect(hhmmBRT(T1430)).toBe('14:30');
    expect(hhmmBRT(T9)).toBe('09:00');
    expect(hhmmBRT('lixo')).toBeNull();
  });
});
