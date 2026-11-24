import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quem recebe o lead novo de conta baixa (abaixo de R$ 800). Até 23/11/2026 era a Nilce sozinha (ordem do Thiago, 23/09: "a Nilce
// recebe TODOS"). Desde 23/11/2026 é a divisão por conta de luz: Nilce 50% e Giovanna 50%, por déficit de cards nos últimos 30 dias
// (services/agenda/divisaoSolar.ts). `proximoDaContaBaixa` só devolve o 1º da lista, e nunca lança.

let linhas: Array<Record<string, unknown>> = [];
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'neq', 'gte', 'order']) c[m] = () => c;
      c.range = () => Promise.resolve({ data: linhas, error: null });
      return c;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { proximoDaContaBaixa, FILA_DEPOIS_DA_SEMANA } from '../services/agenda/filaContaBaixa';
import { _limparCacheDivisao } from '../services/agenda/divisaoSolar';

const card = (v: string) => ({ vendedor_nome: v, observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: R$ 400 a R$ 800', status: 'agendado' });

beforeEach(() => { _limparCacheDivisao(); linhas = []; delete process.env.SOLAR_DIVISAO_OFF; });

describe('lead novo de conta baixa: Nilce e Giovanna por déficit', () => {
  it('sem nenhum card, a Nilce abre (ordem da tabela)', async () => {
    expect(await proximoDaContaBaixa()).toBe('Nilce');
  });

  it('com a Nilce na frente, a vez é da Giovanna; com a Giovanna na frente, da Nilce', async () => {
    linhas = [card('Nilce'), card('Nilce'), card('Giovanna')];
    expect(await proximoDaContaBaixa(new Date('2026-11-23T12:00:00-03:00'))).toBe('Giovanna');
    _limparCacheDivisao();
    linhas = [card('Giovanna'), card('Giovanna'), card('Nilce')];
    expect(await proximoDaContaBaixa()).toBe('Nilce');
  });

  it('com o freio SOLAR_DIVISAO_OFF=1 é sempre a Nilce', async () => {
    process.env.SOLAR_DIVISAO_OFF = '1';
    linhas = [card('Nilce'), card('Nilce'), card('Nilce')];
    expect(await proximoDaContaBaixa()).toBe('Nilce');
  });

  it('a reserva (banco fora, freio) é só a Nilce', () => {
    expect(FILA_DEPOIS_DA_SEMANA).toEqual(['Nilce']);
  });
});
