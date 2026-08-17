import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A agenda do Thiago e do Diego é ENCAIXADA: a LP do eletroposto vende de hora em
// hora (10:00, 11:00 e 13:00–18:00) e o card de lead SOLAR deles mora nas
// meias-horas que sobram no meio, mais as duas primeiras horas da manhã. Regra do
// Thiago (17/08). Antes disso eram só as manhãs (10/08), e antes ainda o dia
// inteiro — o que punha a mesma pessoa em dois compromissos. Nilce não tem
// eletroposto e segue a grade de 15 min no expediente inteiro.
//
// O risco de regressão aqui é silencioso (ninguém "vê" um card marcado pras 14:00,
// em cima de uma apresentação), então ele é travado por teste.

let agenda: Array<{ consultor: string; quando: string; created_by?: string }> = [];

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
          ? agenda.filter(a => a.consultor === consultor)
              .map(a => ({ quando: a.quando, created_by: a.created_by ?? 'lead-meta' }))
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

// A lista fechada dos sócios — a mesma que a LP do solar oferece.
const GRADE = ['08:00','08:30','09:00','09:30','10:30','11:30',
               '13:30','14:30','15:30','16:30','17:30','18:30'];

// Marca de verdade: acha o slot E grava, como o sync faz lead a lead.
async function marcar(consultor: string, base: { y: number; m: number; d: number; h: number }) {
  const slot = await slotLivreConsultor(consultor, base);
  agenda.push({ consultor, quando: slot.toISOString() });
  return emSP(slot);
}

/** Ocupa a grade de um consultor num dia, do começo até `ate` (inclusive). */
const lotar = (consultor: string, ymd: string, ate: string) => {
  for (const h of GRADE) {
    agenda.push({ consultor, quando: `${ymd}T${h}:00-03:00` });
    if (h === ate) return;
  }
};

describe('card de lead solar do Thiago e do Diego', () => {
  beforeEach(() => { agenda = []; vi.useFakeTimers(); vi.setSystemTime(AGORA); });
  afterEach(() => { vi.useRealTimers(); });

  it('a fila não se perde: 13h vira 08:00, o próximo 08:30, o próximo 09:00', async () => {
    vi.setSystemTime(new Date('2026-08-11T07:00:00-03:00'));   // antes de a agenda abrir
    expect(await marcar('Thiago', TERCA(13))).toBe('2026-08-11 08:00');
    expect(await marcar('Thiago', TERCA(18))).toBe('2026-08-11 08:30');
    expect(await marcar('Thiago', TERCA(20))).toBe('2026-08-11 09:00');
  });

  it('Thiago e Diego são duas pessoas: os dois podem abrir o dia às 08:00', async () => {
    vi.setSystemTime(new Date('2026-08-11T07:00:00-03:00'));
    expect(await marcar('Thiago', TERCA(13))).toBe('2026-08-11 08:00');
    expect(await marcar('Diego', TERCA(18))).toBe('2026-08-11 08:00');
    expect(await marcar('Diego', TERCA(18))).toBe('2026-08-11 08:30');
  });

  it('a tarde voltou: com a manhã vencida o card fica HOJE às 13:30', async () => {
    for (const consultor of ['Thiago', 'Diego']) {
      const slot = await slotLivreConsultor(consultor, TARDE_DE_TERCA);
      expect(emSP(slot)).toBe('2026-08-11 13:30');
    }
  });

  it('a hora que o lead pediu não empurra o card pra frente', async () => {
    vi.setSystemTime(new Date('2026-08-11T09:20:00-03:00'));
    const slot = await slotLivreConsultor('Thiago', TARDE_DE_TERCA);
    expect(emSP(slot)).toBe('2026-08-11 09:30');
  });

  it('a grade pula 10:00 e 11:00 — é apresentação de eletroposto', async () => {
    lotar('Diego', '2026-08-12', '09:30');
    const slot = await slotLivreConsultor('Diego', { y: 2026, m: 8, d: 12, h: 8 });
    expect(emSP(slot)).toBe('2026-08-12 10:30');
  });

  it('18:30 é o último começo do dia; cheio, pula o dia inteiro', async () => {
    lotar('Thiago', '2026-08-12', '17:30');
    expect(emSP(await slotLivreConsultor('Thiago', { y: 2026, m: 8, d: 12, h: 8 })))
      .toBe('2026-08-12 18:30');
    lotar('Thiago', '2026-08-12', '18:30');
    expect(emSP(await slotLivreConsultor('Thiago', { y: 2026, m: 8, d: 12, h: 8 })))
      .toBe('2026-08-13 08:00');
  });

  it('vistoria presencial de 1h tira o consultor da rua — o 08:30 some junto', async () => {
    agenda.push({ consultor: 'Diego', quando: '2026-08-12T08:00:00-03:00', created_by: 'lp_solar' });
    const slot = await slotLivreConsultor('Diego', { y: 2026, m: 8, d: 12, h: 8 });
    expect(emSP(slot)).toBe('2026-08-12 09:00');
  });

  it('apresentação de eletroposto às 14:00 não come o card das 13:30', async () => {
    agenda.push({ consultor: 'Thiago', quando: '2026-08-12T14:00:00-03:00', created_by: 'lp_eletroposto' });
    lotar('Thiago', '2026-08-12', '11:30');   // fecha a manhã, sobra a tarde
    const slot = await slotLivreConsultor('Thiago', { y: 2026, m: 8, d: 12, h: 8 });
    expect(emSP(slot)).toBe('2026-08-12 13:30');
  });

  it('Nilce não tem eletroposto — a grade de 15 min dela continua de pé', async () => {
    const slot = await slotLivreConsultor('Nilce', TARDE_DE_TERCA);
    expect(emSP(slot)).toBe('2026-08-11 15:00');
  });

  it('dois cards da Nilce cabem lado a lado, de 15 em 15', async () => {
    expect(await marcar('Nilce', TERCA(15))).toBe('2026-08-11 15:00');
    expect(await marcar('Nilce', TERCA(15))).toBe('2026-08-11 15:15');
  });

  it('lead de ELETROPOSTO pode ser à tarde em hora cheia — é o turno deles', async () => {
    const slot = await slotLivreConsultor('Thiago', TARDE_DE_TERCA, 'eletroposto');
    expect(emSP(slot)).toBe('2026-08-11 15:00');
  });
});
