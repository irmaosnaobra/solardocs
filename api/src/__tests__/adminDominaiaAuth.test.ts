import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { consultaFalsa } from './_dominaiaBancoFalso';

// As rotas da Domina IA moram no router do admin (montadas em /dominaia), atrás do auth e do admin que ele já aplica.

const h = vi.hoisted(() => ({ logado: false, admin: false }));

vi.mock('../middleware/auth', () => ({
  authMiddleware: (_q: unknown, r: { status: (n: number) => { json: (o: unknown) => void } }, n: () => void) => (h.logado ? n() : r.status(401).json({ error: 'sem login' })),
}));
vi.mock('../middleware/adminAuth', () => ({
  adminMiddleware: (_q: unknown, r: { status: (n: number) => { json: (o: unknown) => void } }, n: () => void) => (h.admin ? n() : r.status(403).json({ error: 'sem admin' })),
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consultaFalsa() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => consultaFalsa() } }));

import adminRouter from '../routes/admin';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const ROTAS = [
  '/admin/dominaia/resumo',
  '/admin/dominaia/quiz-funil',
  '/admin/dominaia/quiz-funil/sessoes?passo=1',
  '/admin/dominaia/quiz-funil/sessao/abc',
  '/admin/dominaia/sessao/abc',
];

describe('rotas da Domina IA no admin', () => {
  it.each(ROTAS)('%s sem login volta 401 e sem admin volta 403', async (rota) => {
    h.logado = false; h.admin = false;
    expect((await request(app).get(rota)).status).toBe(401);
    h.logado = true;
    expect((await request(app).get(rota)).status).toBe(403);
  });

  it('com login e admin a rota responde', async () => {
    h.logado = true; h.admin = true;
    const r = await request(app).get('/admin/dominaia/quiz-funil/sessoes?passo=1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ total: 0, itens: [], proximo: null, truncado: false });
  });

  it('membros e gostos não existem em /dominaia (a Domina IA não tem essa fonte de dado)', async () => {
    h.logado = true; h.admin = true;
    expect((await request(app).get('/admin/dominaia/membros')).status).toBe(404);
    expect((await request(app).get('/admin/dominaia/gostos')).status).toBe(404);
  });
});
