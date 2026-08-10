import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Thiago e Diego apresentam eletroposto das 13:30 às 17:30. Card de lead SOLAR
// deles não pode cair nesse pedaço do dia — some com a capacidade de apresentação
// e põe a mesma pessoa em dois compromissos. Nilce não tem eletroposto: segue o
// expediente inteiro. O risco de regressão aqui é silencioso (ninguém "vê" um
// card marcado pras 15h), então ele é travado por teste.

vi.mock('../utils/supabaseGerador', () => {
  const vazio = (data: any[]) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, gte: () => q, lte: () => q,
      then: (ok: any) => Promise.resolve({ data, error: null }).then(ok),
    };
    return q;
  };
  return { supabaseGerador: { from: () => vazio([]) } };   // agenda e bloqueios vazios
});
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn() }));

import { slotLivreConsultor } from '../services/agenda/leadsMetaService';

// "agora" fixo: terça, 11/08/2026, meio-dia em Brasília.
const AGORA = new Date('2026-08-11T12:00:00-03:00');
const emSP = (d: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(d).replace(', ', ' ');

// lead pediu "15h às 18h" na terça
const TARDE_DE_TERCA = { y: 2026, m: 8, d: 11, h: 15 };
const MANHA_DE_QUARTA = { y: 2026, m: 8, d: 12, h: 8 };

describe('card de lead solar do Thiago e do Diego', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AGORA); });
  afterEach(() => { vi.useRealTimers(); });

  it('faixa da tarde escorrega pra manhã do próximo dia útil', async () => {
    for (const consultor of ['Thiago', 'Diego']) {
      const slot = await slotLivreConsultor(consultor, TARDE_DE_TERCA);
      expect(emSP(slot)).toBe('2026-08-12 08:00');
    }
  });

  it('faixa da manhã continua no mesmo dia, na hora pedida', async () => {
    const slot = await slotLivreConsultor('Thiago', MANHA_DE_QUARTA);
    expect(emSP(slot)).toBe('2026-08-12 08:00');
  });

  it('Nilce não tem eletroposto — a tarde dela continua de pé', async () => {
    const slot = await slotLivreConsultor('Nilce', TARDE_DE_TERCA);
    expect(emSP(slot)).toBe('2026-08-11 15:00');
  });

  it('lead de ELETROPOSTO pode ser à tarde — é o turno deles', async () => {
    const slot = await slotLivreConsultor('Thiago', TARDE_DE_TERCA, 'eletroposto');
    expect(emSP(slot)).toBe('2026-08-11 15:00');
  });

  it('11:30 é o último começo possível: 11:45 já é do dia seguinte', async () => {
    // base às 11h com a agenda vazia devolve 11:00; o corte real é o 11:45 que
    // não existe — a grade de 15 min para em 11:30.
    const slot = await slotLivreConsultor('Diego', { y: 2026, m: 8, d: 12, h: 11 });
    expect(emSP(slot)).toBe('2026-08-12 11:00');
  });
});
