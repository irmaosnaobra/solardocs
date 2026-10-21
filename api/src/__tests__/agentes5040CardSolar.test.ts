import { describe, it, expect, vi } from 'vitest';

// O card do solar do contexto: o mais novo DO SOLAR que não está cancelado (a lista vem do mais novo ao mais velho).

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/agentes5040/agendaSolarVagas', () => ({ vagasSolar: vi.fn() }));
vi.mock('../services/io/eletropostoVagas', () => ({ proximasVagas: vi.fn(async () => []) }));

import { cardSolarDaLista } from '../services/agentes5040/contexto';

const card = (id: number, status: string | null, created_by = 'lp_solar'): any => ({
  id, status, quando: '2026-10-22T13:00:00.000Z', vendedor_nome: 'Nilce', cliente_nome: 'Maria', cidade: null, observacao: null, created_by, created_at: null,
});

describe('cardSolarDaLista', () => {
  it('um cancelado mais novo e um agendado mais velho: usa o agendado', () => {
    expect(cardSolarDaLista([card(9, 'cancelado'), card(5, 'agendado')])?.id).toBe(5);
    expect(cardSolarDaLista([card(9, ' Cancelado '), card(5, 'nao_atendeu')])?.id).toBe(5);
  });
  it('o mais novo do solar que não está cancelado, pulando o de eletroposto', () => {
    expect(cardSolarDaLista([card(9, 'agendado', 'lp_eletroposto'), card(7, 'agendado'), card(5, 'agendado')])?.id).toBe(7);
  });
  it('só cancelados, só eletroposto ou lista vazia: nenhum card do solar', () => {
    expect(cardSolarDaLista([card(9, 'cancelado'), card(5, 'cancelado')])).toBeNull();
    expect(cardSolarDaLista([card(9, 'agendado', 'lp_eletroposto')])).toBeNull();
    expect(cardSolarDaLista([])).toBeNull();
  });
  it('status vazio conta como vivo', () => {
    expect(cardSolarDaLista([card(9, null)])?.id).toBe(9);
  });
});
