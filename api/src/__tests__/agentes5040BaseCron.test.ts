import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A rota da Base (B4b): GET /cron/agentes-5040/base, protegida como as outras, com ?dry=1, e o relógio próprio de 10 em 10 minutos.
const h = vi.hoisted(() => ({ rodou: vi.fn(), relatorio: null as any, info: vi.fn() }));

vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: (...a: unknown[]) => h.info(...a) } }));
vi.mock('../services/agentes5040/baseEnvio', () => ({
  runBaseTick: vi.fn(async (o: unknown) => { h.rodou(o); return h.relatorio; }),
}));

import cronRouter from '../routes/cron';

const app = express();
app.use('/cron', cronRouter);

beforeEach(() => {
  process.env.CRON_SECRET = 'segredo-de-teste-cron';
  h.rodou.mockClear(); h.info.mockClear();
  h.relatorio = { ok: true, ligado: true, dry: false, motivo: null, avaliadas: 3, elegiveis: 1, cortou: false, chamadasIA: 1, enviou: true, puladas: {}, decisoes: [{ hmac8: 'abcd1234', dona: 'duda', resultado: 'enviada', motivo: null }] };
});

describe('cron agentes-5040/base', () => {
  it('sem o segredo do cron: 401 e a rodada nem começa', async () => {
    const res = await request(app).get('/cron/agentes-5040/base');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(404);
    expect(h.rodou).not.toHaveBeenCalled();
  });

  it('com o segredo roda a Base (sem dry) e loga o resumo sem hmac nem texto', async () => {
    const res = await request(app).get('/cron/agentes-5040/base').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(h.rodou).toHaveBeenCalledWith({ dry: false });
    expect(h.info).toHaveBeenCalledWith('cron', 'agentes-5040/base rodou', { avaliadas: 3, elegiveis: 1, enviou: true, motivo: null, chamadas_ia: 1 });
    expect(JSON.stringify(h.info.mock.calls)).not.toContain('abcd1234');
  });

  it('?dry=1 repassa o dry e não deixa o "rodou" no log', async () => {
    h.relatorio = { ...h.relatorio, dry: true };
    const res = await request(app).get('/cron/agentes-5040/base?dry=1').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(h.rodou).toHaveBeenCalledWith({ dry: true });
    expect(h.info).not.toHaveBeenCalled();
    expect(res.body.decisoes[0].hmac8).toBe('abcd1234');
  });

  it('rodada que falhou devolve 500', async () => {
    h.relatorio = { ...h.relatorio, ok: false, motivo: 'a_rodada_falhou' };
    const res = await request(app).get('/cron/agentes-5040/base').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(500);
  });

  it('o vercel.json tem o relógio próprio de 10 em 10 minutos, e só um', () => {
    const v = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    expect(v.crons.filter(c => c.path === '/cron/agentes-5040/base')).toEqual([{ path: '/cron/agentes-5040/base', schedule: '*/10 * * * *' }]);
  });
});
