import { describe, it, expect, vi, beforeEach } from 'vitest';

// A agenda limpa: quais cards a tela esconde e quais a Helena marcou. Dados inventados, nenhum telefone nem nome real.
const h = vi.hoisted(() => ({
  itens: [] as unknown[],
  cards: new Map<string, unknown[]>(),
  marcadas: [] as Array<{ id: number }>,
  chamadas: 0,
  falha: false,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/io/helenaAcompanhamento', () => ({
  lerAcompanhamento: async () => { h.chamadas++; if (h.falha) throw new Error('falhou'); return { itens: h.itens }; },
}));
vi.mock('../services/io/investidorAgente', () => ({
  lerCardsDoContato: async () => h.cards,
  lerTudo: async () => h.marcadas,
}));

import { ocultosDaAgenda, conjuntoDaAgenda, lerAgendaDaHelena, limparCacheDaAgenda, SITUACOES_QUE_OCULTAM } from '../services/io/helenaAgenda';
import type { CardDoContato } from '../services/io/investidorAgentePuro';

const AGORA = Date.parse('2026-11-12T15:00:00Z');
const AGORA_D = new Date(AGORA);
const card = (id: number, status: string, extra: Partial<CardDoContato> = {}): CardDoContato =>
  ({ id, status, quando: '2026-10-01T15:00:00Z', origem: 'lp_eletroposto', vendedor: 'Fulano', ...extra });
const loteFuturo = (id: number, quando = '2026-11-20T10:15:00Z'): CardDoContato =>
  card(id, 'agendado', { origem: 'cadastro_eletroposto', quando });
const it1 = (situacao: string, chave = '3499990001') => [{ chave, situacao }] as Array<{ chave: string; situacao: never }>;
const cardsDe = (...cs: CardDoContato[]) => new Map([['3499990001', cs]]);

beforeEach(() => {
  h.itens = []; h.cards = new Map(); h.marcadas = []; h.chamadas = 0; h.falha = false;
  limparCacheDaAgenda();
});

describe('ocultosDaAgenda: quem esconde', () => {
  it('cada situacao: as 9 da Helena escondem; reuniao_marcada e com_consultor nao', () => {
    const esconde = ['na_fila', 'abordado', 'em_conversa', 'convidado', 'horarios_enviados', 'sem_resposta', 'sem_interesse', 'parou', 'envio_falhou'];
    for (const s of esconde) expect(ocultosDaAgenda(it1(s), cardsDe(card(7, 'cancelado')), AGORA), s).toEqual(['7']);
    for (const s of ['reuniao_marcada', 'com_consultor']) expect(ocultosDaAgenda(it1(s), cardsDe(card(7, 'cancelado')), AGORA), s).toEqual([]);
    expect(SITUACOES_QUE_OCULTAM.size).toBe(esconde.length);
  });
  it('agendado do lote em :15/:45, futuro, entra (e o :15 de hoje tambem)', () => {
    expect(ocultosDaAgenda(it1('na_fila'), cardsDe(loteFuturo(1, '2026-11-13T13:15:00Z'), loteFuturo(2, '2026-11-14T13:45:00Z')), AGORA)).toEqual(['1', '2']);
  });
  it('agendado futuro FORA do lote nunca entra (reuniao real)', () => {
    expect(ocultosDaAgenda(it1('na_fila'), cardsDe(card(1, 'agendado', { quando: '2026-11-20T10:00:00Z' }), card(2, 'agendado', { origem: 'agente_eletroposto', quando: '2026-11-20T10:00:00Z' })), AGORA)).toEqual([]);
  });
  it('cancelado e nao_atendeu entram; card em atendimento e fechado nao', () => {
    expect(ocultosDaAgenda(it1('em_conversa'), cardsDe(card(1, 'cancelado'), card(2, 'nao_atendeu'), card(3, 'em_atendimento'), card(4, 'fechou'), card(5, 'arrendamento')), AGORA)).toEqual(['1', '2']);
  });
  it('reuniao da equipe no lote nao entra', () => {
    const viva = { ...loteFuturo(1), historico: '[09/11 16h02 · Maria Teste] 📅 Reagendado à mão.' };
    expect(ocultosDaAgenda(it1('na_fila'), cardsDe(viva, loteFuturo(2)), AGORA)).toEqual(['2']);
  });
  it('pessoa com dois cards entra com os dois, em ordem; card de outro produto nunca entra', () => {
    expect(ocultosDaAgenda(it1('abordado'), cardsDe(card(30, 'cancelado'), card(9, 'nao_atendeu'), card(31, 'cancelado', { origem: 'lp_solar' })), AGORA)).toEqual(['9', '30']);
  });
  it('so as pessoas da lista: chave sem item nao esconde nada', () => {
    expect(ocultosDaAgenda(it1('na_fila', '3499990009'), cardsDe(card(1, 'cancelado')), AGORA)).toEqual([]);
  });
});

describe('conjuntoDaAgenda e a rota de leitura', () => {
  it('junta ocultos e marcadas, ids como string', async () => {
    h.itens = it1('na_fila'); h.cards = cardsDe(card(5, 'cancelado'), loteFuturo(6)); h.marcadas = [{ id: 42 }, { id: 8 }];
    expect(await conjuntoDaAgenda(AGORA_D)).toEqual({ ocultos: ['5', '6'], marcadas: ['8', '42'] });
  });
  it('cache de 60 s: a segunda leitura nao relê; passado o minuto, relê', async () => {
    h.itens = it1('na_fila'); h.cards = cardsDe(card(5, 'cancelado'));
    const a = await lerAgendaDaHelena(AGORA_D);
    await lerAgendaDaHelena(new Date(AGORA + 30_000));
    expect(h.chamadas).toBe(1);
    await lerAgendaDaHelena(new Date(AGORA + 61_000));
    expect(h.chamadas).toBe(2);
    expect(a).toMatchObject({ ocultos: ['5'], marcadas: [], gerado_em: AGORA_D.toISOString() });
  });
  it('erro de leitura sobe (a rota vira 503) e nao fica em cache', async () => {
    h.falha = true;
    await expect(lerAgendaDaHelena(AGORA_D)).rejects.toThrow();
    h.falha = false; h.itens = it1('na_fila'); h.cards = cardsDe(card(5, 'cancelado'));
    expect((await lerAgendaDaHelena(AGORA_D)).ocultos).toEqual(['5']);
  });
});
