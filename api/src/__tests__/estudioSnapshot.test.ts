import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
import { novoBanco } from './_agentes5040Fake';

// Aba Estúdio do /admin (19/11/2026): POST de máquina com token (ESTUDIO_SYNC_TOKEN, com queda para a
// impressão digital embutida) e GET do painel atrás do guard de admin. Banco em memória.

const h = vi.hoisted(() => ({ banco: null as any }));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.banco.cliente.from(t) } }));
vi.mock('../middleware/auth', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.userId = 'admin-1'; next(); } }));
vi.mock('../middleware/adminAuth', () => ({
  adminMiddleware: (req: any, res: any, next: any) => (req.headers['x-admin'] === '1' ? next() : res.status(403).json({ error: 'Acesso restrito a administradores' })),
}));

import { estudioAdminRouter, estudioMaquinaRouter } from '../routes/estudio';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/admin/estudio', estudioAdminRouter);
app.use('/estudio', estudioMaquinaRouter);

const TOKEN = 'token-de-teste-estudio';
const CRON = 'cron-de-teste';
const SNAP = {
  versao: 1,
  atualizadoEm: '2026-11-19T12:00:00.000Z',
  redes: [{ rede: 'instagram', conta: '@x', seguidores: null }],
  episodios: [{ slug: 'dentro-da-guerra-ep06-tregua', numero: 6 }],
  serie: { nome: 'Dentro da Guerra', horario: '19:00', automatico: true },
  fabrica: { etapas: [{ id: 'roteiro', nome: 'Roteiro' }] },
  totais: { views: null, curtidas: null, comentarios: null, porRede: {} },
};
const linha = () => (h.banco.tabelas.system_state ?? []).find((l: any) => l.key === 'estudio_snapshot');
const salvos = { sync: process.env.ESTUDIO_SYNC_TOKEN, cron: process.env.CRON_SECRET, hash: process.env.ESTUDIO_SYNC_TOKEN_SHA256 };

beforeEach(() => {
  h.banco = novoBanco();
  process.env.ESTUDIO_SYNC_TOKEN = TOKEN;
  delete process.env.CRON_SECRET;
  delete process.env.ESTUDIO_SYNC_TOKEN_SHA256;
});
afterEach(() => {
  if (salvos.sync === undefined) delete process.env.ESTUDIO_SYNC_TOKEN; else process.env.ESTUDIO_SYNC_TOKEN = salvos.sync;
  if (salvos.cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = salvos.cron;
  if (salvos.hash === undefined) delete process.env.ESTUDIO_SYNC_TOKEN_SHA256; else process.env.ESTUDIO_SYNC_TOKEN_SHA256 = salvos.hash;
});

describe('POST /estudio/snapshot', () => {
  it('aceita só pela impressão digital (ESTUDIO_SYNC_TOKEN_SHA256), sem o token na env', async () => {
    delete process.env.ESTUDIO_SYNC_TOKEN;
    process.env.ESTUDIO_SYNC_TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
    expect((await request(app).post('/estudio/snapshot').set('Authorization', 'Bearer outro').send(SNAP)).status).toBe(401);
    expect((await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(SNAP)).status).toBe(200);
  });

  it('sem nenhuma env vale só a impressão digital embutida: token qualquer e CRON_SECRET dão 401', async () => {
    delete process.env.ESTUDIO_SYNC_TOKEN;
    process.env.CRON_SECRET = CRON;
    expect((await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(SNAP)).status).toBe(401);
    expect((await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${CRON}`).send(SNAP)).status).toBe(401);
    expect(linha()).toBeUndefined();
  });

  it('401 sem cabeçalho e com token errado', async () => {
    expect((await request(app).post('/estudio/snapshot').send(SNAP)).status).toBe(401);
    expect((await request(app).post('/estudio/snapshot').set('Authorization', 'Bearer errado').send(SNAP)).status).toBe(401);
    expect((await request(app).post('/estudio/snapshot').set('Authorization', TOKEN).send(SNAP)).status).toBe(401);
    expect(linha()).toBeUndefined();
  });

  it('400 com corpo inválido (versão, episodios ou redes fora do contrato)', async () => {
    const post = (b: unknown) => request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(b as object);
    expect((await post({ ...SNAP, versao: 2 })).status).toBe(400);
    expect((await post({ ...SNAP, episodios: {} })).status).toBe(400);
    expect((await post({ ...SNAP, redes: 'x' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ ...SNAP, serie: undefined })).status).toBe(400);
    expect((await post({ ...SNAP, fabrica: {} })).status).toBe(400);
    expect((await post({ ...SNAP, totais: { views: 1 } })).status).toBe(400);
    expect(linha()).toBeUndefined();
  });

  it('200 grava em system_state e a segunda chamada sobrescreve', async () => {
    const r = await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(SNAP);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(linha().value).toEqual(SNAP);
    expect(typeof linha().updated_at).toBe('string');

    const novo = { ...SNAP, atualizadoEm: '2026-11-19T13:00:00.000Z' };
    await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(novo);
    expect(h.banco.tabelas.system_state.filter((l: any) => l.key === 'estudio_snapshot')).toHaveLength(1);
    expect(linha().value.atualizadoEm).toBe(novo.atualizadoEm);
  });

  it('com ESTUDIO_SYNC_TOKEN e CRON_SECRET definidas, só ESTUDIO_SYNC_TOKEN vale', async () => {
    process.env.CRON_SECRET = CRON;
    expect((await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${CRON}`).send(SNAP)).status).toBe(401);
    expect((await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(SNAP)).status).toBe(200);
  });

  it('413 quando o corpo passa de 1 MB', async () => {
    const grande = { ...SNAP, lixo: 'x'.repeat(1024 * 1024 + 10) };
    const r = await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(grande);
    expect(r.status).toBe(413);
    expect(linha()).toBeUndefined();
  });
});

describe('GET /admin/estudio', () => {
  it('403 sem ser admin', async () => {
    const r = await request(app).get('/admin/estudio');
    expect(r.status).toBe(403);
  });

  it('admin sem snapshot recebe nulos', async () => {
    const r = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ snapshot: null, atualizadoEm: null });
  });

  it('admin recebe o snapshot gravado e a hora', async () => {
    await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(SNAP);
    const r = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r.status).toBe(200);
    expect(r.body.snapshot).toEqual(SNAP);
    expect(r.body.atualizadoEm).toBe(linha().updated_at);
  });
});
