import { describe, it, expect } from 'vitest';

// FERIADO CALCULADO, NÃO LISTADO.
//
// A lista à mão ia até 2027 com o aviso "atualizar uma vez por ano". Aviso não é
// mecanismo: em 01/01/2028 ela pararia de conhecer feriado em silêncio e a
// agenda abriria no Natal. Estes testes travam as duas coisas que importam —
// que a conta REPRODUZ a lista antiga (nada mudou pra 2026/2027) e que ela
// continua respondendo em anos que a lista nunca cobriu.
import { ehFeriadoBR, feriadosDoAno } from '../utils/feriadosBR';

/** A lista escrita à mão que existia até 03/09/2026, palavra por palavra. */
const LISTA_ANTIGA_2026 = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01',
  '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
];
const LISTA_ANTIGA_2027 = [
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21',
  '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02',
  '2027-11-15', '2027-11-20', '2027-12-25',
];

describe('feriados nacionais', () => {
  it('reproduz exatamente a lista que existia à mão', () => {
    expect([...feriadosDoAno(2026)].sort()).toEqual([...LISTA_ANTIGA_2026].sort());
    expect([...feriadosDoAno(2027)].sort()).toEqual([...LISTA_ANTIGA_2027].sort());
  });

  it('conhece anos que a lista antiga nunca cobriu', () => {
    expect(ehFeriadoBR('2028-12-25')).toBe(true);   // Natal
    expect(ehFeriadoBR('2028-04-14')).toBe(true);   // Sexta-feira Santa (Páscoa 16/04)
    expect(ehFeriadoBR('2028-02-28')).toBe(true);   // Carnaval (segunda)
    expect(ehFeriadoBR('2028-06-15')).toBe(true);   // Corpus Christi
    expect(ehFeriadoBR('2035-03-23')).toBe(true);   // Sexta-feira Santa de 2035
  });

  it('são 13 feriados em qualquer ano', () => {
    for (const ano of [2026, 2027, 2028, 2029, 2030, 2040]) {
      expect(feriadosDoAno(ano).size).toBe(13);
    }
  });

  it('dia comum não vira feriado', () => {
    expect(ehFeriadoBR('2026-09-08')).toBe(false);
    expect(ehFeriadoBR('2026-09-04')).toBe(false);
  });

  it('lixo no lugar da data devolve false, não exceção', () => {
    expect(ehFeriadoBR('')).toBe(false);
    expect(ehFeriadoBR('sem-data')).toBe(false);
    expect(ehFeriadoBR(undefined as unknown as string)).toBe(false);
  });
});
