import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Thiago e Diego apresentam eletroposto das 13:00 às 17:00. Card de lead SOLAR
// deles não pode cair nesse pedaço do dia — some com a capacidade de apresentação
// e põe a mesma pessoa em dois compromissos. Regra do Thiago (10/08): mesmo que o
// cliente peça tarde ou noite, o card vai pra manhã, e a FILA não se perde — cada
// lead novo pega o próximo horário livre de 15 em 15 min. Nilce não tem
// eletroposto e segue o expediente inteiro. O risco de regressão aqui é silencioso
// (ninguém "vê" um card marcado pras 15h), então ele é travado por teste.

let agenda: Array<{ consultor: string; quando: string }> = [];

vi.mock('../utils/supabaseGerador', () => {
  const resposta = (tabela: string) => {
    let consultor = '';
    const q: any = {
      select: () => q,
      eq: (col: string, v: any) => { if (col === 'vendedor_nome') consultor = v; return q; },
      neq: () => q, gte: () => q, lte: () => q,
      then: (ok: any) => Promise.resolve({
        // a agenda é por PESSOA: o que está no Thiago não bloqueia o Diego
        data: tabela === 'agendamentos'
          ? agenda.filter(a => a.consultor === consultor).map(a => ({ quando: a.quando }))
          : [],
        error: null,
      }).then(ok),
    };
    return q;
  };
  return { supabaseGerador: { from: (t: string) => resposta(t) } };
});
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn() }));

import { slotLivreConsultor } from '../services/agenda/leadsMetaService';

// "agora" fixo: terça, 11/08/2026, meio-dia em Brasília (manhã já vencida).
const AGORA = new Date('2026-08-11T12:00:00-03:00');
const emSP = (d: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(d).replace(', ', ' ');

// lead pediu "15h às 18h" na terça
const TARDE_DE_TERCA = { y: 2026, m: 8, d: 11, h: 15 };
const TERCA = (h: number) => ({ y: 2026, m: 8, d: 11, h });

// Marca de verdade: acha o slot E grava, como o sync faz lead a lead.
async function marcar(consultor: string, base: { y: number; m: number; d: number; h: number }) {
  const slot = await slotLivreConsultor(consultor, base);
  agenda.push({ consultor, quando: slot.toISOString() });
  return emSP(slot);
}

// Preenche a agenda de um consultor de 08:00 até `ate` (inclusive), de 15 em 15.
const lotarManha = (consultor: string, ymd: string, ate: string) => {
  const fim = Number(ate.slice(0, 2)) * 60 + Number(ate.slice(3));
  for (let m = 8 * 60; m <= fim; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    agenda.push({ consultor, quando: `${ymd}T${hh}:${mm}:00-03:00` });
  }
};

describe('card de lead solar do Thiago e do Diego', () => {
  beforeEach(() => { agenda = []; vi.useFakeTimers(); vi.setSystemTime(AGORA); });
  afterEach(() => { vi.useRealTimers(); });

  it('a fila não se perde: 13h vira 08:00, o próximo vira 08:15, o próximo 08:30', async () => {
    vi.setSystemTime(new Date('2026-08-11T07:00:00-03:00'));   // antes de a agenda abrir
    expect(await marcar('Thiago', TERCA(13))).toBe('2026-08-11 08:00');
    expect(await marcar('Thiago', TERCA(18))).toBe('2026-08-11 08:15');
    expect(await marcar('Thiago', TERCA(20))).toBe('2026-08-11 08:30');
  });

  it('Thiago e Diego são duas pessoas: os dois podem abrir o dia às 08:00', async () => {
    vi.setSystemTime(new Date('2026-08-11T07:00:00-03:00'));
    expect(await marcar('Thiago', TERCA(13))).toBe('2026-08-11 08:00');
    expect(await marcar('Diego', TERCA(18))).toBe('2026-08-11 08:00');
    expect(await marcar('Diego', TERCA(18))).toBe('2026-08-11 08:15');
  });

  it('faixa da tarde com a manhã já vencida vai pro próximo dia útil às 08:00', async () => {
    for (const consultor of ['Thiago', 'Diego']) {
      const slot = await slotLivreConsultor(consultor, TARDE_DE_TERCA);
      expect(emSP(slot)).toBe('2026-08-12 08:00');
    }
  });

  it('pediu tarde mas ainda é de manhã: fica HOJE, não amanhã', async () => {
    vi.setSystemTime(new Date('2026-08-11T09:00:00-03:00'));
    const slot = await slotLivreConsultor('Thiago', TARDE_DE_TERCA);
    expect(emSP(slot)).toBe('2026-08-11 09:00');
  });

  it('a hora que o lead pediu não empurra o card pra frente', async () => {
    const slot = await slotLivreConsultor('Diego', { y: 2026, m: 8, d: 12, h: 11 });
    expect(emSP(slot)).toBe('2026-08-12 08:00');
  });

  it('11:30 é o último começo possível da manhã', async () => {
    lotarManha('Diego', '2026-08-12', '11:15');
    const slot = await slotLivreConsultor('Diego', { y: 2026, m: 8, d: 12, h: 8 });
    expect(emSP(slot)).toBe('2026-08-12 11:30');
  });

  it('manhã lotada até 11:30 pula o dia inteiro — nada cai à tarde', async () => {
    lotarManha('Thiago', '2026-08-12', '11:30');
    const slot = await slotLivreConsultor('Thiago', { y: 2026, m: 8, d: 12, h: 8 });
    expect(emSP(slot)).toBe('2026-08-13 08:00');
  });

  it('Nilce não tem eletroposto — a tarde dela continua de pé', async () => {
    const slot = await slotLivreConsultor('Nilce', TARDE_DE_TERCA);
    expect(emSP(slot)).toBe('2026-08-11 15:00');
  });

  it('lead de ELETROPOSTO pode ser à tarde — é o turno deles', async () => {
    const slot = await slotLivreConsultor('Thiago', TARDE_DE_TERCA, 'eletroposto');
    expect(emSP(slot)).toBe('2026-08-11 15:00');
  });
});
