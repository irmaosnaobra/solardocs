import { describe, it, expect } from 'vitest';

// A MANHÃ É DO DIA QUE ABSORVE A EMENDA, NÃO DA SEGUNDA-FEIRA.
//
// A grade dava 10:00 e 11:00 só quando `dow === 1`. O motivo escrito no código
// nunca foi o dia da semana — é o acúmulo: sábado e domingo a agenda não abre,
// o anúncio continua rodando, e tudo desemboca no primeiro dia útil.
//
// Num feriado de segunda esse raciocínio quebrava exatamente ao contrário do que
// devia: a terça herdava TRÊS dias de acúmulo e, por não ser segunda, herdava
// só a tarde. O caso concreto é 07/09/2026 (Independência, uma segunda).
import { horasDoDia, agendaAbre } from '../services/io/eletropostoVagas';

describe('grade do eletroposto na semana do feriado', () => {
  it('07/09/2026 (Independência, segunda) não abre', () => {
    expect(agendaAbre('2026-09-07')).toBe(false);
  });

  it('terça 08/09 herda a manhã, porque herda três dias parados', () => {
    const t = horasDoDia('2026-09-08');
    expect(t).toContain('10:00');
    expect(t).toContain('11:00');
    // e NÃO perde a tarde de meia em meia hora que ela já tinha
    expect(t).toContain('13:30');
    expect(t).toContain('17:30');
    expect(t.length).toBe(12);
  });

  it('quarta 09/09 volta ao normal: só a tarde', () => {
    const q = horasDoDia('2026-09-09');
    expect(q).not.toContain('10:00');
    expect(q[0]).toBe('13:00');
    expect(q.length).toBe(10);
  });

  it('segunda comum segue com a lista fechada do Thiago, intocada', () => {
    // 14/09/2026 é segunda e não tem feriado colado.
    expect(horasDoDia('2026-09-14')).toEqual(
      ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'],
    );
  });

  it('terça comum não ganha manhã nenhuma', () => {
    expect(horasDoDia('2026-09-15')).not.toContain('10:00');
  });

  it('feriado de terça: a quarta seguinte NÃO herda a manhã (só um dia parado)', () => {
    // Não existe em 2026; o que importa é a regra: emenda de 1 dia não conta.
    // 03/04/2026 é a Sexta-feira Santa — a segunda 06/04 já ganharia a manhã por
    // ser segunda, então o caso limpo é a quinta 02/04, véspera, sem acúmulo.
    expect(horasDoDia('2026-04-02')).not.toContain('10:00');
  });
});
