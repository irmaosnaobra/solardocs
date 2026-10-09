import { describe, it, expect } from 'vitest';
import {
  jaVirou, viradaDoDia, alvoDoDegrau, ordenarPeloLugar, diaDeBrasilia,
} from '../services/agenda/viradaDoDia';

// A NEGOCIAÇÃO VIRA NO FIM DO PRÓPRIO DIA (ordem do Thiago, 09/10/2026):
// "13:00, Reinaldo, chave na mão, dia 9/10: quando chegar às 23:59 ele já se
// posiciona às 13:15 do dia 10/10". E: "seria qual tempo for; a lógica é virar
// no mesmo dia e ocupar seu lugar na próxima agenda".
//
// Este arquivo prende a regra pura. Os dois ticks (eletroposto e solar) têm
// teste próprio provando que usam ela.

/** Horário de Brasília em ISO. */
const brt = (dia: string, hm: string) => new Date(`${dia}T${hm}:00-03:00`).toISOString();
const ms = (dia: string, hm: string) => Date.parse(brt(dia, hm));

describe('quando o card sai: às 23:59 do dia em que estava', () => {
  const reinaldo = brt('2026-10-09', '13:00');

  it('às 15h do mesmo dia ele ainda não virou', () => {
    expect(jaVirou(reinaldo, ms('2026-10-09', '15:00'))).toBe(false);
  });

  it('às 23:58 também não', () => {
    expect(jaVirou(reinaldo, ms('2026-10-09', '23:58'))).toBe(false);
  });

  it('às 23:59 virou, que é o minuto que a ordem diz', () => {
    expect(viradaDoDia(reinaldo)).toBe(ms('2026-10-09', '23:59'));
    expect(jaVirou(reinaldo, ms('2026-10-09', '23:59'))).toBe(true);
  });

  it('e card de dias atrás já virou faz tempo', () => {
    expect(jaVirou(brt('2026-10-07', '09:15'), ms('2026-10-09', '02:30'))).toBe(true);
  });

  it('o dia é o de Brasília, não o de Greenwich: 22h BRT ainda é o mesmo dia', () => {
    // 22:00 BRT = 01:00 UTC do dia seguinte. Contando em UTC, o card viraria
    // às 21h do próprio dia, duas horas antes de o dia acabar.
    const noite = brt('2026-10-09', '22:00');
    expect(diaDeBrasilia(noite)).toBe('2026-10-09');
    expect(jaVirou(noite, ms('2026-10-09', '23:00'))).toBe(false);
  });

  it('horário ilegível nunca vira', () => {
    expect(jaVirou('lixo', Date.now())).toBe(false);
    expect(jaVirou(null, Date.now())).toBe(false);
  });
});

describe('onde ele cai: o horário dele mais as horas do degrau', () => {
  it('24h depois de 13:00 de 09/10 é 13:00 de 10/10', () => {
    expect(alvoDoDegrau(brt('2026-10-09', '13:00'), 24)).toBe(ms('2026-10-10', '13:00'));
  });
  it('48h, dois dias', () => {
    expect(alvoDoDegrau(brt('2026-10-13', '13:15'), 48)).toBe(ms('2026-10-15', '13:15'));
  });
});

describe('o lugar dele na próxima agenda', () => {
  /** A faixa dos quinze inteira de um dia, como a grade devolve. */
  const faixa = (dia: string) => {
    const out: string[] = [];
    for (let t = 8 * 60 + 15; t <= 17 * 60 + 45; t += 30) {
      out.push(brt(dia, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`));
    }
    return out;
  };

  it('O EXEMPLO DA ORDEM: alvo 13:00, cai às 13:15', () => {
    const lista = ordenarPeloLugar(faixa('2026-10-13'), ms('2026-10-13', '13:00'));
    expect(lista[0]).toBe(brt('2026-10-13', '13:15'));
  });

  it('alvo já na faixa (13:15) fica no mesmo horário', () => {
    const lista = ordenarPeloLugar(faixa('2026-10-15'), ms('2026-10-15', '13:15'));
    expect(lista[0]).toBe(brt('2026-10-15', '13:15'));
  });

  it('13:15 ocupado: o seguinte do mesmo dia, 13:45', () => {
    const livres = faixa('2026-10-13').filter(v => v !== brt('2026-10-13', '13:15'));
    expect(ordenarPeloLugar(livres, ms('2026-10-13', '13:00'))[0]).toBe(brt('2026-10-13', '13:45'));
  });

  it('a tarde inteira cheia: a vaga ANTERIOR mais perto, no mesmo dia', () => {
    const manha = faixa('2026-10-13').filter(v => Date.parse(v) < ms('2026-10-13', '12:00'));
    expect(ordenarPeloLugar(manha, ms('2026-10-13', '16:00'))[0]).toBe(brt('2026-10-13', '11:45'));
  });

  it('o dia do alvo sem vaga nenhuma: a mesma hora no próximo dia que tem', () => {
    // Sábado e feriado não aparecem na lista: a grade já os pula. O alvo é de
    // sábado 13:00 e a primeira vaga é de terça; o card vai pras 13:15 de
    // terça, não pras 08:15.
    const lista = ordenarPeloLugar([...faixa('2026-10-13'), ...faixa('2026-10-14')],
      ms('2026-10-10', '13:00'));
    expect(lista[0]).toBe(brt('2026-10-13', '13:15'));
  });

  it('card de 16:00 não é cortado: o lugar das 16:15 existe na lista', () => {
    expect(ordenarPeloLugar(faixa('2026-10-13'), ms('2026-10-13', '16:00'))[0])
      .toBe(brt('2026-10-13', '16:15'));
  });

  it('os outros dias vêm depois, em ordem, como reserva', () => {
    const lista = ordenarPeloLugar([...faixa('2026-10-14'), ...faixa('2026-10-13')],
      ms('2026-10-13', '13:00'));
    const dias = lista.map(diaDeBrasilia);
    expect(dias.indexOf('2026-10-14')).toBe(faixa('2026-10-13').length);
    expect(lista.length).toBe(faixa('2026-10-13').length * 2);
  });

  it('lista vazia, lugar nenhum', () => {
    expect(ordenarPeloLugar([], ms('2026-10-13', '13:00'))).toEqual([]);
  });
});
