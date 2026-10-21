import { describe, it, expect, vi, beforeEach } from 'vitest';

// A faixa da Duda (B1d-1): quem já tem card (qualquer status, inclusive nao_atendeu) remarca nos :15/:45;
// só o lead sem card pega os :00/:30 (e hoje sem card ela nem tem dono para oferecer). O banco e a leitura de vagas são falsos: o teste olha o que foi pedido.

const h = vi.hoisted(() => ({ vagas: vi.fn(async (_p: any) => ['2026-10-22T13:15:00.000Z'] as string[] | null) }));

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/agentes5040/agendaSolarVagas', () => ({ vagasSolar: h.vagas }));
vi.mock('../services/io/eletropostoVagas', () => ({ proximasVagas: vi.fn(async () => []) }));

import { lerHorariosLivres } from '../services/agentes5040/contexto';

const AGORA = '2026-10-21T12:00:00.000Z';
const card = (status: string | null): any => ({
  id: 5, status, quando: '2026-10-22T13:00:00.000Z', vendedor_nome: 'Nilce', cliente_nome: 'Maria', cidade: null, observacao: null, created_by: 'lp_solar',
});

beforeEach(() => { h.vagas.mockClear(); });

describe('lerHorariosLivres da Duda: a faixa segue o card', () => {
  it('sem card a Duda ainda não tem dono (o consumo decide Nilce ou Giovanna): nenhuma vaga é pedida, lista vazia', async () => {
    expect(await lerHorariosLivres('duda', null, null, [], AGORA)).toEqual([]);
    expect(h.vagas).not.toHaveBeenCalled();
  });

  it.each(['agendado', 'nao_atendeu', 'negociacao', 'vendido', null])('com card (status %s) = remarcação, faixa :15/:45, no dono do card', async (status) => {
    await lerHorariosLivres('duda', card(status), null, [], AGORA);
    expect(h.vagas.mock.calls[0][0].faixa).toBe('remarcacao');
    expect(h.vagas.mock.calls[0][0].dono).toBe('Nilce');
    expect(h.vagas.mock.calls[0][0].caminho).toBe('ligacao');
  });
});
