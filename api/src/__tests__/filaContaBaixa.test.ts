import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quem recebe o lead novo de conta baixa. Ordem do Thiago (23/09/2026): "a Nilce
// recebe TODOS". A Giovanna saiu do rodízio de lead novo, o que ela já tem
// continua dela, mas lead novo não entra mais.
//
// O que já deu errado nesta mesma regra, e por isso continua testado:
//   • a contagem começando numa fase qualquer do rodízio (existia um piso de
//     data só pra isso);
//   • o lead ficar SEM DONO quando o banco não respondia.
// Com uma dona só as duas deixam de ser possíveis, e o teste do banco vira o
// oposto: provar que ele nem é consultado.

let consultas = 0;

// O mock existe pra PROVAR que o banco não é tocado. Qualquer `from()` aqui é
// uma regressão: fila de uma pessoa só não tem fase pra descobrir, e consultar
// pra responder sempre a mesma coisa é latência e um modo de falha de graça.
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      consultas++;
      throw new Error('a fila de conta baixa não deve consultar o banco');
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { proximoDaContaBaixa, FILA_DEPOIS_DA_SEMANA } from '../services/agenda/filaContaBaixa';

/** Instante real de um horário de Brasília. -03:00 fixo: o Brasil não tem horário de verão. */
const brt = (ymd: string, hms: string) => new Date(`${ymd}T${hms}-03:00`);

beforeEach(() => { consultas = 0; });

describe('lead novo de conta baixa é todo da Nilce', () => {
  it('é dela, em qualquer dia e hora', async () => {
    const momentos = [
      brt('2026-09-23', '00:00:00'),
      brt('2026-09-23', '09:30:00'),
      brt('2026-09-27', '23:59:59'),   // sábado
      brt('2026-12-31', '18:00:00'),
      brt('2027-03-01', '08:00:00'),
    ];
    for (const m of momentos) expect(await proximoDaContaBaixa(m)).toBe('Nilce');
  });

  it('sem argumento nenhum também responde (o padrão é agora)', async () => {
    expect(await proximoDaContaBaixa()).toBe('Nilce');
  });

  it('não encosta no banco: a resposta não depende de contagem', async () => {
    await proximoDaContaBaixa(brt('2026-09-24', '10:00:00'));
    await proximoDaContaBaixa(brt('2026-09-24', '10:01:00'));
    expect(consultas).toBe(0);
  });

  it('a Giovanna não recebe lead novo', async () => {
    expect(FILA_DEPOIS_DA_SEMANA).not.toContain('Giovanna');
  });

  it('a fila tem um nome só, é o tamanho dela que carrega a proporção', () => {
    expect(FILA_DEPOIS_DA_SEMANA).toEqual(['Nilce']);
  });
});
