import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// verifyCronSecret na rota de verdade: aceita CRON_SECRET, GITHUB_CRON_SECRET e CRON_SECRET_ANTERIOR; loga o slot só quando
// é o CRON_SECRET_ANTERIOR (e nunca o valor); sem o anterior o velho dá 401. A rota /cron/dispute-preview responde 400 (id
// inválido) logo depois de autenticar, sem tocar em banco nem rede: 400 = passou na senha, 401 = barrou.
const h = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: (...a: unknown[]) => h.warn(...a), info: vi.fn() } }));

import cronRouter from '../routes/cron';

const app = express();
app.use('/cron', cronRouter);

const A = 'falso-cron-secret-aaaaaaaa';
const G = 'falso-github-secret-bbbbbbbb';
const V = 'falso-anterior-secret-cccccc';
const chamar = (segredo?: string) => {
  const r = request(app).get('/cron/dispute-preview?id=invalido').set('User-Agent', 'agente-de-teste/1.0');
  return segredo === undefined ? r : r.set('Authorization', `Bearer ${segredo}`);
};

describe('verifyCronSecret com o segredo anterior', () => {
  const antes = { c: process.env.CRON_SECRET, g: process.env.GITHUB_CRON_SECRET, v: process.env.CRON_SECRET_ANTERIOR };
  beforeEach(() => {
    h.warn.mockClear();
    process.env.CRON_SECRET = A;
    process.env.GITHUB_CRON_SECRET = G;
    delete process.env.CRON_SECRET_ANTERIOR;
  });
  afterEach(() => {
    for (const [k, v] of [['CRON_SECRET', antes.c], ['GITHUB_CRON_SECRET', antes.g], ['CRON_SECRET_ANTERIOR', antes.v]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('CRON_SECRET passa e não loga nada', async () => {
    expect((await chamar(A)).status).toBe(400);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('GITHUB_CRON_SECRET passa e não loga (só o CRON_SECRET_ANTERIOR loga)', async () => {
    expect((await chamar(G)).status).toBe(400);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('com CRON_SECRET_ANTERIOR, o velho passa e loga slot, rota sem query e ua', async () => {
    process.env.CRON_SECRET_ANTERIOR = V;
    expect((await chamar(V)).status).toBe(400);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][0]).toBe('cron');
    const msg = String(h.warn.mock.calls[0][1]);
    expect(msg).toBe('cron-segredo slot=CRON_SECRET_ANTERIOR rota=/cron/dispute-preview ua=agente-de-teste/1.0');
    expect(msg).not.toContain(V);
    expect(msg).not.toContain('invalido');
  });

  it('sem CRON_SECRET_ANTERIOR o velho dá 401 e não loga', async () => {
    expect((await chamar(V)).status).toBe(401);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('sem header ou com valor errado dá 401', async () => {
    process.env.CRON_SECRET_ANTERIOR = V;
    expect((await chamar()).status).toBe(401);
    expect((await chamar('errado')).status).toBe(401);
    expect(h.warn).not.toHaveBeenCalled();
  });
});
