import { describe, it, expect } from 'vitest';

import { classificarHostil } from '../services/instagram/igHostil';

const hostil = (t: string) => classificarHostil(t).hostil;

describe('filtro de comentário hostil', () => {
  it('xingamento não recebe DM de venda', () => {
    expect(classificarHostil('Vocês são uns palhaços')).toMatchObject({ hostil: true, tipo: 'xingamento' });
    expect(hostil('que porra é essa')).toBe(true);
    expect(hostil('produto é um LIXO')).toBe(true);
  });

  it('acusação sem interrogação é acusação; com interrogação é medo de comprar', () => {
    // Quem escreve "isso é golpe?" está com receio e QUER ser convencido —
    // silenciar essa pessoa é perder o lead mais fácil da fila.
    expect(hostil('isso é golpe?')).toBe(false);
    expect(hostil('Será que é fraude?')).toBe(false);
    expect(classificarHostil('isso é golpe, não caiam nessa')).toMatchObject({ hostil: true, tipo: 'acusacao' });
    expect(hostil('bando de picaretas')).toBe(true);
  });

  it('quem fala em Procon ou processo entra mesmo perguntando', () => {
    expect(hostil('vou no procon?')).toBe(true);
    expect(hostil('vou denunciar vocês')).toBe(true);
  });

  it('ameaça é tratada como hostil', () => {
    expect(classificarHostil('sei onde você mora')).toMatchObject({ hostil: true, tipo: 'ameaca' });
  });

  it('lead de verdade nunca cai no filtro', () => {
    for (const t of [
      'Quanto custa?', 'Tenho interesse', 'Me passa o zap', 'Quero um orçamento',
      'Com 12 painéis fica por quanto?', 'Vocês instalam em Uberaba?',
      'Verdade, paguei 1200 reais para limpeza de 14 placas em casa',
      'Quanto tempo demorou pra ficar pronto?', 'Fechamento.',
    ]) expect(hostil(t)).toBe(false);
  });

  it('pedaço de palavra não vira xingamento', () => {
    // "burro" está na lista; "burrice"/"aburrado" não podem casar.
    expect(hostil('Bom dia, tudo certo?')).toBe(false);
    expect(hostil('meu carro é elétrico')).toBe(false);
    expect(hostil('')).toBe(false);
  });
});
