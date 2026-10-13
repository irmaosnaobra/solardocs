import { describe, it, expect } from 'vitest';

// A GRADE É A MESMA EM TODO DIA ÚTIL (13/10/2026).
//
// Até 12/10 a grade mudava por dia: a segunda tinha uma lista própria (hora em
// hora, até 18:00) e o dia que absorvia a emenda de um feriado ganhava a manhã
// (o caso concreto era 07/09/2026, Independência, uma segunda). Isto acabou por
// ordem do dono: "vagas no quiz das 08 às 17:30" e "trava a agenda para almoço
// das 12:00 às 13:30". Segunda, terça depois de feriado e sexta têm exatamente os
// mesmos 17 horários, e nenhum começa no almoço.
//
// O arquivo guarda o nome antigo porque os testes de acúmulo eram a cobertura da
// regra de "dia que herda a emenda"; a cobertura continua, agora provando que ela
// NÃO existe mais.
import { horasDoDia, agendaAbre, ehHorarioDeAlmoco } from '../services/io/eletropostoVagas';

const GRADE = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
];

describe('grade do eletroposto: uma só, de segunda a sexta', () => {
  it('07/09/2026 (Independência, segunda) não abre', () => {
    expect(agendaAbre('2026-09-07')).toBe(false);
  });

  it('terça 08/09, depois do feriado, tem os mesmos 17 horários de qualquer dia (não herda manhã extra)', () => {
    const t = horasDoDia('2026-09-08');
    expect([...t]).toEqual(GRADE);
    expect(t.length).toBe(17);
  });

  it('terça 13/10, depois do feriado de 12/10, idem', () => {
    expect(agendaAbre('2026-10-12')).toBe(false);
    expect([...horasDoDia('2026-10-13')]).toEqual(GRADE);
  });

  it('quarta 09/09 é igual à terça pós-feriado', () => {
    expect([...horasDoDia('2026-09-09')]).toEqual([...horasDoDia('2026-09-08')]);
  });

  it('segunda comum (14/09) não tem mais a lista de hora em hora até 18:00', () => {
    const seg = horasDoDia('2026-09-14');
    expect([...seg]).toEqual(GRADE);
    expect(seg).not.toContain('18:00');
    expect(seg).toContain('10:30');          // a meia hora que a segunda não tinha
    expect(seg.length).toBe(17);
  });

  it('sexta comum (16/10) tem os mesmos 17 horários', () => {
    expect([...horasDoDia('2026-10-16')]).toEqual(GRADE);
  });

  it('segunda, terça pós-feriado e sexta são idênticas entre si', () => {
    const seg = horasDoDia('2026-09-14');
    expect(horasDoDia('2026-10-13')).toEqual(seg);
    expect(horasDoDia('2026-10-16')).toEqual(seg);
  });

  it('os cinco dias de uma semana comum têm a mesma grade', () => {
    for (const dia of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) {
      expect([...horasDoDia(dia)]).toEqual(GRADE);
    }
  });

  it('12:00, 12:30 e 13:00 nunca aparecem, em dia nenhum', () => {
    for (const dia of ['2026-09-08', '2026-09-14', '2026-10-13', '2026-10-16', '2026-04-02']) {
      for (const h of ['12:00', '12:30', '13:00']) expect(horasDoDia(dia)).not.toContain(h);
      expect(horasDoDia(dia).some(h => ehHorarioDeAlmoco(h))).toBe(false);
    }
  });

  it('vésperas e dias normais seguem iguais: 02/04/2026 (quinta antes da Sexta Santa)', () => {
    expect([...horasDoDia('2026-04-02')]).toEqual(GRADE);
  });
});

describe('a remarcação (:15 e :45) também pula o almoço', () => {
  const REMARCACAO = [
    '08:15', '08:45', '09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
    '13:45', '14:15', '14:45', '15:15', '15:45', '16:15', '16:45', '17:15', '17:45',
  ];

  it('segunda, terça pós-feriado e sexta têm exatamente os 17 horários, de 08:15 a 17:45', () => {
    for (const dia of ['2026-09-14', '2026-10-13', '2026-10-16']) {
      const g = horasDoDia(dia, 'remarcacao');
      expect([...g]).toEqual(REMARCACAO);
      expect(g.length).toBe(17);
    }
  });

  it('nunca devolve 12:15, 12:45 nem 13:15', () => {
    for (const dia of ['2026-09-14', '2026-10-13', '2026-10-16']) {
      for (const h of ['12:15', '12:45', '13:15']) expect(horasDoDia(dia, 'remarcacao')).not.toContain(h);
    }
  });
});

describe('ehHorarioDeAlmoco: começa em [12:00, 13:30)', () => {
  it('as bordas', () => {
    expect(ehHorarioDeAlmoco('11:59')).toBe(false);
    expect(ehHorarioDeAlmoco('11:45')).toBe(false);
    expect(ehHorarioDeAlmoco('12:00')).toBe(true);
    expect(ehHorarioDeAlmoco('13:29')).toBe(true);
    expect(ehHorarioDeAlmoco('13:30')).toBe(false);
  });
});
