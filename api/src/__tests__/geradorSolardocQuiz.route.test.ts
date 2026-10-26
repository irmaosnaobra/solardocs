import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// GET /gerador/solardoc/quiz-status: devolve estado de cliente, então tem que exigir login de consultor.
// O serviço é simulado (ele tem os testes dele): aqui se prova a porta, o cabeçalho e o erro.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  pedidos: [] as unknown[],
  falha: false,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
  },
}));
vi.mock('../services/solardoc/statusLeadsQuiz', () => ({
  statusLeadsQuiz: vi.fn(async (o: { dias?: unknown }) => {
    h.pedidos.push(o.dias);
    if (h.falha) throw new Error('connection refused postgres://user:segredo@db');
    return { ok: true, carla_ligada: true, carla_motivo: 'ligada', largada: null, truncado: false, status: {} };
  }),
}));

import { mountSolardocQuizStatus } from '../routes/geradorSolardocQuiz';

function app() {
  const router = Router();
  mountSolardocQuizStatus(router);
  const a = express();
  a.use('/gerador', router);
  return a;
}

beforeEach(() => {
  h.usuarios = { 'tok-nilce': 'nilce@irmaosnaobra.app', 'tok-fora': 'alguem@gmail.com' };
  h.pedidos = []; h.falha = false;
});

describe('GET /gerador/solardoc/quiz-status', () => {
  it('sem login responde 401 e não chega ao serviço', async () => {
    const r = await request(app()).get('/gerador/solardoc/quiz-status');
    expect(r.status).toBe(401);
    expect(h.pedidos).toHaveLength(0);
  });
  it('com a chave publishable (a que qualquer um tem) responde 401', async () => {
    const r = await request(app()).get('/gerador/solardoc/quiz-status').set('Authorization', 'Bearer sb_publishable_abc');
    expect(r.status).toBe(401);
  });
  it('com token inválido responde 401', async () => {
    const r = await request(app()).get('/gerador/solardoc/quiz-status').set('Authorization', 'Bearer qualquer');
    expect(r.status).toBe(401);
  });
  it('com conta que não é de consultor responde 403', async () => {
    const r = await request(app()).get('/gerador/solardoc/quiz-status').set('Authorization', 'Bearer tok-fora');
    expect(r.status).toBe(403);
    expect(h.pedidos).toHaveLength(0);
  });
  it('consultor logado: 200, sem cache, e os dias chegam ao serviço', async () => {
    const r = await request(app()).get('/gerador/solardoc/quiz-status?dias=30').set('Authorization', 'Bearer tok-nilce');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(h.pedidos).toEqual(['30']);
  });
  it('serviço que falha: 502 sem vazar o erro do banco', async () => {
    h.falha = true;
    const r = await request(app()).get('/gerador/solardoc/quiz-status').set('Authorization', 'Bearer tok-nilce');
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|segredo/);
  });
});
