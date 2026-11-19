import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// "Hoje" nos seletores do admin é o dia de calendário de São Paulo (UTC-3), não as últimas 24 horas.
// Cobre a loja no Pix, o funil do Ponto Certo e a jornada do LimpaPro.

const h = vi.hoisted(() => ({ gtes: [] as Array<[string, unknown]> }));

function consulta() {
  const q: any = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    limit: () => Promise.resolve({ data: [], error: null }),
    gte: (c: string, v: unknown) => { h.gtes.push([c, v]); return q; },
    range: () => Promise.resolve({ data: [], error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consulta() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => consulta() } }));

import adminRouter from '../routes/admin';
import { inicioDoDiaSP, inicioDaJanelaSP } from '../utils/inicioDoDiaSP';
import { inicioDaJanela } from '../services/io/pontoCertoFunil';
import { periodoLoja, resumoLojaPix } from '../services/produtos/lojaPixAdmin';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

// 19/11/2026 01:30 em São Paulo = 04:30 UTC: o dia de SP já virou, as 24 h corridas ainda estão no dia 18.
const AGORA = Date.parse('2026-11-19T04:30:00Z');
const MEIA_NOITE_SP = '2026-11-19T03:00:00.000Z';

describe('início do dia de São Paulo', () => {
  it('vira à meia-noite de SP, não de UTC', () => {
    expect(inicioDoDiaSP(AGORA).toISOString()).toBe(MEIA_NOITE_SP);
    expect(inicioDoDiaSP(Date.parse('2026-11-19T02:59:00Z')).toISOString()).toBe('2026-11-18T03:00:00.000Z');
  });
  it('dias <= 1 é Hoje; acima disso é agora menos N dias', () => {
    expect(inicioDaJanelaSP(1, AGORA).toISOString()).toBe(MEIA_NOITE_SP);
    expect(inicioDaJanelaSP(7, AGORA).toISOString()).toBe('2026-11-12T04:30:00.000Z');
  });
});

describe('Ponto Certo', () => {
  it('dias=1 começa no início do dia de SP; 7 e 30 seguem em dias corridos', () => {
    expect(inicioDaJanela(1, AGORA)).toBe(MEIA_NOITE_SP);
    expect(inicioDaJanela(7, AGORA)).toBe('2026-11-12T04:30:00.000Z');
  });
  it('a rota aceita dias=1 (antes subia para 7)', async () => {
    h.gtes = [];
    const r = await request(app).get('/admin/ponto-certo-funil?dias=1');
    expect(r.status).toBe(200);
    expect(r.body.dias).toBe(1);
    const desde = h.gtes.find(([c]) => c === 'created_at')?.[1] as string;
    expect(desde >= inicioDoDiaSP().toISOString()).toBe(true);
    expect(new Date(desde).getTime()).toBeGreaterThan(Date.now() - 86_400_000);
  });
});

describe('Loja no Pix', () => {
  it('hoje é aceito e valor desconhecido continua virando 7d', () => {
    expect(periodoLoja('hoje')).toBe('hoje');
    expect(periodoLoja('1000d')).toBe('7d');
    expect(periodoLoja(undefined)).toBe('7d');
    expect(periodoLoja('30d')).toBe('30d');
  });
  it('a janela de hoje começa no início do dia de SP', async () => {
    h.gtes = [];
    const r = await resumoLojaPix('hoje', AGORA);
    expect(r.period).toBe('hoje');
    expect(r.desde).toBe(MEIA_NOITE_SP);
    expect((await resumoLojaPix('7d', AGORA)).desde).toBe('2026-11-12T04:30:00.000Z');
  });
  it('a rota devolve period=hoje', async () => {
    const r = await request(app).get('/admin/loja-pix?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.period).toBe('hoje');
  });
});

describe('Jornada do LimpaPro', () => {
  it('dias=1 filtra desde o início do dia de SP (ou do início da medição, o que for mais recente)', async () => {
    h.gtes = [];
    const r = await request(app).get('/admin/jornada-limpapro?dias=1');
    expect(r.status).toBe(200);
    const desde = h.gtes.find(([c]) => c === 'created_at')?.[1] as string;
    expect(desde).toBe(inicioDoDiaSP().toISOString());
  });
});
