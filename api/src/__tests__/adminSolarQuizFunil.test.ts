import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// FIXA o JSON de GET /admin/solar/quiz-funil. Há painel em produção lendo esse
// formato: extrair o miolo da rota para um serviço não pode mudar uma chave.
// O arquivo fixtures/adminSolarQuizFunil.golden.json foi gerado ANTES da
// extração (rodando a rota antiga com estes mesmos dados). Para regerar de
// propósito: GOLDEN=1 npx vitest run src/__tests__/adminSolarQuizFunil.test.ts

const h = vi.hoisted(() => ({
  eventos: [] as unknown[], visitas: [] as unknown[], cards: [] as unknown[],
  metaOk: true,
}));

/** Query builder falso: ignora filtros, devolve a tabela inteira e respeita o range. */
function consulta(linhas: unknown[]) {
  const q: any = {
    select: () => q, in: () => q, gte: () => q, lt: () => q, ilike: () => q, like: () => q, eq: () => q,
    order: () => q,
    range: (de: number, ate: number) => Promise.resolve({ data: linhas.slice(de, ate + 1), error: null }),
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t === 'lp_events') return consulta(h.eventos);
      if (t === 'page_visits') return consulta(h.visitas);
      return consulta([]);
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: { from: (t: string) => consulta(t === 'agendamentos' ? h.cards : []) },
}));
vi.mock('../services/io/metaConjuntos', async (orig) => {
  const real = await orig<typeof import('../services/io/metaConjuntos')>();
  return {
    ...real,
    buscarConjuntosMeta: vi.fn(async (ids: string[]) => {
      if (!h.metaOk) return { ok: false, motivo: 'Meta 500', conjuntos: new Map() };
      return {
        ok: true,
        conjuntos: new Map(ids.filter((i) => /^\d{10,20}$/.test(i)).map((id) => [id, { id, nome: `Conjunto ${id.slice(-3)}`, status: 'ACTIVE', gasto: 50 }])),
      };
    }),
  };
});

import admin from '../routes/admin';

const app = express();
app.use('/admin', admin);

const ev = (s: string, tipo: string, d: Record<string, unknown>, seq: number, quando = '2026-10-09T15:00:00Z') =>
  ({ session_id: s, event_type: tipo, event_data: { lp: 'solar', pl: 1, seq, ...d }, created_at: quando });

function dados() {
  h.eventos = [
    ev('a', 'quiz_passo', { passo: 'conta', caminho: 'inicio' }, 1),
    ev('a', 'quiz_passo', { passo: 'tipo', caminho: 'respondendo' }, 2),
    ev('b', 'quiz_passo', { passo: 'conta', caminho: 'inicio' }, 1),
    ev('b', 'quiz_passo', { passo: 'horario', caminho: 'vistoria' }, 2),
    ev('b', 'quiz_fim', { destino: 'vistoria', caminho: 'vistoria' }, 3),
    ev('c', 'quiz_passo', { passo: 'conta', caminho: 'inicio' }, 1),
    ev('c', 'quiz_erro', { passo: 'conta', msg: 'telefone invalido' }, 2),
  ];
  h.visitas = [
    { session_id: 'a', landing_url: 'https://solardoc.app/io/solar?utm_campaign=x', utm_campaign: 'x', utm_term: '120256657642860111', created_at: '2026-10-09T14:59:00Z' },
    { session_id: 'b', landing_url: 'https://solardoc.app/io/solar?utm_campaign=x', utm_campaign: 'x', utm_term: '120256657642860111', created_at: '2026-10-09T14:59:00Z' },
    { session_id: 'c', landing_url: 'https://solardoc.app/io/solar', utm_campaign: null, utm_term: null, created_at: '2026-10-09T14:59:00Z' },
    { session_id: 'd', landing_url: 'https://solardoc.app/io/solar/simulador', utm_campaign: null, utm_term: null, created_at: '2026-10-09T14:59:00Z' },
  ];
  h.cards = [
    { utm_term: '120256657642860111', utm_content: '120256657642860602', status: 'agendado', created_at: '2026-10-09T16:00:00Z' },
    { utm_term: '120256657642860111', utm_content: '120256657642860602', status: 'sem_interesse', created_at: '2026-10-09T16:00:00Z' },
    { utm_term: null, utm_content: null, status: 'fez_orcamento', created_at: '2026-10-09T16:00:00Z' },
  ];
}

const GOLDEN = join(__dirname, 'fixtures', 'adminSolarQuizFunil.golden.json');

// Relógio fixo (só o Date): desde/ate dependem de "agora" e o golden não pode
// envelhecer. 10/10/2026 15:00 UTC = 12:00 em Brasília.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T15:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const casos: Array<[string, string, boolean]> = [
  ['maximo', 'period=maximo', true],
  ['ontem com conjunto', 'period=ontem&conjunto=120256657642860111', true],
  ['padrao', '', true],
  ['meta fora do ar', 'period=maximo', false],
];

describe('GET /admin/solar/quiz-funil (formato fixo)', () => {
  for (const [nome, qs, metaOk] of casos) {
    it(`devolve o mesmo JSON de sempre: ${nome}`, async () => {
      dados(); h.metaOk = metaOk;
      const r = await request(app).get(`/admin/solar/quiz-funil?${qs}`);
      expect(r.status).toBe(200);
      const atual = JSON.parse(JSON.stringify(r.body));
      const todos = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
      if (process.env.GOLDEN === '1') {
        todos[nome] = atual;
        writeFileSync(GOLDEN, JSON.stringify(todos, null, 2) + '\n');
      }
      expect(atual).toEqual(todos[nome]);
      // A ordem das chaves também é contrato de quem lê na mão.
      expect(Object.keys(atual)).toEqual(Object.keys(todos[nome]));
    });
  }
});
