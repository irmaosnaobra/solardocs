import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quem recebe o lead novo de conta baixa. Ordem do Thiago (15/09/2026): de hoje
// até domingo 20/09 é tudo da Nilce, porque a semana da Giovanna está cheia com
// as fichas da ação de 11/09. De segunda 21/09 em diante volta o 3 Nilce : 1
// Giovanna, contando só a partir de 21/09.
//
// O que já deu errado nesta mesma regra: a contagem começando numa fase
// qualquer (por isso existe o piso), e o lead ficando sem dono quando o banco
// falha.

let contagem = 0;
let falha = false;
let consultas = 0;
const filtros: { in?: string[]; gte?: string } = {};

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      consultas++;
      const q: any = {
        select() { return q; },
        in(_c: string, v: string[]) { filtros.in = v; return q; },
        gte(_c: string, v: string) {
          filtros.gte = v;
          return Promise.resolve(falha
            ? { count: null, error: { message: 'boom' } }
            : { count: contagem, error: null });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  proximoDaContaBaixa, donaDaContaBaixa, SEMANA_DA_NILCE_ATE, FILA_DEPOIS_DA_SEMANA,
} from '../services/agenda/filaContaBaixa';

/** Instante real de um horário de Brasília. -03:00 fixo: o Brasil não tem horário de verão. */
const brt = (ymd: string, hms: string) => new Date(`${ymd}T${hms}-03:00`);

beforeEach(() => {
  contagem = 0; falha = false; consultas = 0;
  delete filtros.in; delete filtros.gte;
});

describe('esta semana (15 a 20/09) é tudo da Nilce', () => {
  it('hoje de madrugada, já é dela', async () => {
    expect(await proximoDaContaBaixa(brt('2026-09-15', '00:50:00'))).toBe('Nilce');
  });

  it('não importa a contagem: a Giovanna não recebe nada nesta semana', async () => {
    for (const n of [0, 1, 2, 3, 7, 11]) {
      contagem = n;
      expect(await proximoDaContaBaixa(brt('2026-09-18', '17:00:00'))).toBe('Nilce');
    }
  });

  it('nem encosta no banco (a resposta não depende de contagem)', async () => {
    await proximoDaContaBaixa(brt('2026-09-16', '10:00:00'));
    expect(consultas).toBe(0);
  });

  it('domingo 23:59:59 em Brasília ainda é a semana dela', async () => {
    contagem = 3;   // na fila de depois, isto seria a vez da Giovanna
    expect(await proximoDaContaBaixa(brt('2026-09-20', '23:59:59'))).toBe('Nilce');
  });
});

describe('de 21/09 em diante, 3 Nilce : 1 Giovanna', () => {
  it('a virada é meia-noite de Brasília, não de UTC', async () => {
    contagem = 3;
    expect(await proximoDaContaBaixa(brt('2026-09-21', '00:00:00'))).toBe('Giovanna');
    // 21/09 00:30 em UTC ainda é domingo 21h30 em Brasília.
    expect(await proximoDaContaBaixa(new Date('2026-09-21T00:30:00Z'))).toBe('Nilce');
  });

  it('a ordem é Nilce, Nilce, Nilce, Giovanna, e repete', () => {
    const segunda = brt('2026-09-21', '09:00:00');
    const vez = [0, 1, 2, 3, 4, 5, 6, 7].map(n => donaDaContaBaixa(segunda, n));
    expect(vez).toEqual(['Nilce', 'Nilce', 'Nilce', 'Giovanna', 'Nilce', 'Nilce', 'Nilce', 'Giovanna']);
  });

  it('a primeira ficha de segunda é da Nilce: a contagem começa em 21/09, não em agosto', async () => {
    contagem = 0;
    expect(await proximoDaContaBaixa(brt('2026-09-21', '08:00:00'))).toBe('Nilce');
    expect(filtros.gte).toBe(SEMANA_DA_NILCE_ATE);
  });

  it('conta as fichas das DUAS, venham de qual porta vierem', async () => {
    await proximoDaContaBaixa(brt('2026-09-22', '08:00:00'));
    expect([...(filtros.in ?? [])].sort()).toEqual(['Giovanna', 'Nilce']);
  });

  it('a proporção é 3 pra 1', () => {
    expect(FILA_DEPOIS_DA_SEMANA.filter(n => n === 'Nilce')).toHaveLength(3);
    expect(FILA_DEPOIS_DA_SEMANA.filter(n => n === 'Giovanna')).toHaveLength(1);
  });

  it('contagem falhou: cai na Nilce, e o lead nunca fica sem dono', async () => {
    falha = true;
    expect(await proximoDaContaBaixa(brt('2026-09-23', '10:00:00'))).toBe('Nilce');
  });
});
