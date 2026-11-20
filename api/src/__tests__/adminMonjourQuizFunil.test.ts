import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/monjour/quiz-funil: lê os eventos monjour_* de lp_events (de 1000 em 1000),
// aplica os filtros e devolve o FunilMonjour.

const h = vi.hoisted(() => ({
  eventos: [] as any[], filtros: [] as Array<[string, unknown[]]>, ranges: [] as Array<[number, number]>,
  primeiro: null as string | null, falhaPrimeiro: false, falhaLeitura: false,
}));

function consulta() {
  let soPrimeiro = false;
  const q: any = {
    select: (cols: string) => { soPrimeiro = cols === 'created_at'; return q; },
    in: (c: string, v: unknown[]) => { h.filtros.push([`in:${c}`, v]); return q; },
    gte: (c: string, v: unknown) => { h.filtros.push([`gte:${c}`, [v]]); return q; },
    lt: (c: string, v: unknown) => { h.filtros.push([`lt:${c}`, [v]]); return q; },
    order: () => q,
    limit: () => (h.falhaPrimeiro
      ? Promise.resolve({ data: null, error: new Error('x') })
      : Promise.resolve({ data: h.primeiro ? [{ created_at: h.primeiro }] : [], error: null })),
    range: (de: number, ate: number) => {
      h.ranges.push([de, ate]);
      if (h.falhaLeitura) return Promise.resolve({ data: null, error: new Error('banco fora') });
      return Promise.resolve({ data: soPrimeiro ? [] : h.eventos.slice(de, ate + 1), error: null });
    },
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consulta() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => consulta() } }));

import adminRouter from '../routes/admin';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const agora = () => new Date().toISOString();
const passo = (sid: string, n: number, chave: string, d: Record<string, unknown> = {}) => ({
  session_id: sid, event_type: 'monjour_passo', created_at: agora(), event_data: { lp: 'monjour', passo: chave, n, ...d },
});

beforeEach(() => {
  h.eventos = []; h.filtros = []; h.ranges = []; h.primeiro = null; h.falhaPrimeiro = false; h.falhaLeitura = false;
});

describe('GET /admin/monjour/quiz-funil', () => {
  it('devolve o funil com o desenho do contrato', async () => {
    h.primeiro = '2026-11-18T12:00:00+00:00';
    h.eventos = [passo('s1', 1, 'edad', { pais: 'MX' }), passo('s1', 2, 'objetivo'), passo('s2', 1, 'edad', { pais: 'CO' })];
    const r = await request(app).get('/admin/monjour/quiz-funil?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.periodo).toBe('hoje');
    expect(r.body.inicioRastreio).toBe('2026-11-18T12:00:00.000Z');
    expect(r.body.truncado).toBe(false);
    expect(r.body.totais.sessoes).toBe(2);
    expect(r.body.etapas).toHaveLength(36); // 34 telas do catálogo, clicou em comprar e comprou
    expect(r.body.etapas.slice(0, 4).map((e: { chave: string }) => e.chave)).toEqual(['inicio', 'edad', 'app', 'objetivo']);
    expect(r.body.etapas.find((e: { chave: string }) => e.chave === 'edad')).toMatchObject({ n: 2, chegaram: 2, sairam: 1 });
    expect(Object.keys(r.body).sort()).toEqual([
      'app', 'ate', 'atualizadoEm', 'desde', 'etapas', 'filtros', 'inicioRastreio', 'periodo',
      'recortes', 'respostas', 'saidas', 'totais', 'truncado',
    ]);
    expect(Object.keys(r.body.recortes).sort()).toEqual(['anuncio', 'aparelho', 'conjunto', 'dia', 'hora', 'navegador', 'pais', 'sistema']);
  });

  it('lê só os quatro tipos monjour, no período', async () => {
    await request(app).get('/admin/monjour/quiz-funil?period=ontem');
    const tipos = h.filtros.find(([c]) => c === 'in:event_type')![1] as string[];
    expect(tipos.sort()).toEqual(['monjour_app', 'monjour_fim', 'monjour_passo', 'monjour_resp']);
    expect(h.filtros.some(([c]) => c === 'gte:created_at')).toBe(true);
    expect(h.filtros.some(([c]) => c === 'lt:created_at')).toBe(true); // ontem tem fim
  });

  it('pagina de 1000 em 1000', async () => {
    h.eventos = Array.from({ length: 2300 }, (_, i) => passo(`s${i}`, 1, 'edad'));
    const r = await request(app).get('/admin/monjour/quiz-funil?period=30dias');
    expect(r.body.totais.sessoes).toBe(2300);
    expect(r.body.truncado).toBe(false);
    expect(h.ranges.filter(([de]) => de < 5000)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('passou do teto de 200 mil linhas: truncado', async () => {
    h.eventos = new Proxy([] as any[], {
      get: (alvo, p) => (p === 'slice'
        ? (de: number, ate: number) => Array.from({ length: ate - de }, (_, i) => passo(`t${de + i}`, 1, 'edad'))
        : Reflect.get(alvo, p)),
    });
    const r = await request(app).get('/admin/monjour/quiz-funil?period=maximo');
    expect(r.status).toBe(200);
    expect(r.body.truncado).toBe(true);
    expect(h.ranges).toHaveLength(200);
  }, 60_000);

  it('filtros pais, disp, anuncio e conjunto vêm da query', async () => {
    h.eventos = [
      passo('a', 1, 'edad', { pais: 'MX', disp: 'movil', utm_content: '120256011166960271' }),
      passo('b', 1, 'edad', { pais: 'CO', disp: 'movil', utm_content: '120256011191360271' }),
      passo('c', 1, 'edad', { pais: 'MX', disp: 'escritorio' }),
    ];
    const total = async (qs: string) => (await request(app).get(`/admin/monjour/quiz-funil?${qs}`)).body.totais.sessoes;
    expect(await total('period=7dias&pais=mx')).toBe(2);
    expect(await total('period=7dias&disp=movil')).toBe(2);
    expect(await total('period=7dias&pais=MX&disp=movil')).toBe(1);
    expect(await total('period=7dias&anuncio=120256011191360271')).toBe(1);
    expect(await total('period=7dias&conjunto=120256011160400271')).toBe(1);
    expect(await total('period=7dias&anuncio=sem')).toBe(1);
  });

  it('período inválido cai em 7dias; sem período também', async () => {
    expect((await request(app).get('/admin/monjour/quiz-funil?period=ano')).body.periodo).toBe('7dias');
    expect((await request(app).get('/admin/monjour/quiz-funil')).body.periodo).toBe('7dias');
  });

  it('período vazio: tudo zerado e inicioRastreio nulo', async () => {
    const r = await request(app).get('/admin/monjour/quiz-funil?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.totais.sessoes).toBe(0);
    expect(r.body.inicioRastreio).toBeNull();
    expect(r.body.recortes.pais).toEqual([]);
  });

  it('falha ao achar o primeiro evento não derruba o painel', async () => {
    h.falhaPrimeiro = true;
    const r = await request(app).get('/admin/monjour/quiz-funil');
    expect(r.status).toBe(200);
    expect(r.body.inicioRastreio).toBeNull();
  });

  it('erro do banco vira 500 com a mensagem, no padrão das rotas vizinhas', async () => {
    h.falhaLeitura = true;
    const r = await request(app).get('/admin/monjour/quiz-funil');
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('banco fora');
  });
});
