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
const linhaDe = (key: string) => (h.banco.tabelas.system_state ?? []).find((l: any) => l.key === key);
const enviar = (b: unknown) => request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(b as object);
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
    expect(r.body).toEqual({ snapshot: null, atualizadoEm: null, fabricas: [] });
  });

  it('admin recebe o snapshot gravado e a hora', async () => {
    await request(app).post('/estudio/snapshot').set('Authorization', `Bearer ${TOKEN}`).send(SNAP);
    const r = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r.status).toBe(200);
    expect(r.body.snapshot).toEqual(SNAP);
    expect(r.body.atualizadoEm).toBe(linha().updated_at);
  });
});

describe('várias fábricas (v2)', () => {
  const NA_OBRA = { ...SNAP, fabricaId: 'irmaos-na-obra', fabricaNome: 'Irmãos na Obra', ordem: 2, situacao: 'no-ar', serie: { nome: 'Energia' } };
  const YT = { ...SNAP, fabricaId: 'youtube', fabricaNome: 'YouTube', ordem: 3, situacao: 'em-montagem', serie: { nome: 'Curiosidades' } };

  it('snapshot antigo, sem fabricaId, continua indo para estudio_snapshot', async () => {
    expect((await enviar(SNAP)).status).toBe(200);
    expect(linhaDe('estudio_snapshot').value).toEqual(SNAP);
    expect(h.banco.tabelas.system_state).toHaveLength(1);
    expect((await enviar({ ...SNAP, fabricaId: 'dentro-da-guerra' })).status).toBe(200);
    expect(h.banco.tabelas.system_state).toHaveLength(1);
  });

  it('fabricaId fora da lista dá 400 e não grava nada', async () => {
    for (const f of ['outra', '', 'estudio_snapshot:x', 'youtube:2', null, 3, ['youtube'], {}]) {
      expect((await enviar({ ...SNAP, fabricaId: f })).status).toBe(400);
    }
    expect(h.banco.tabelas.system_state ?? []).toHaveLength(0);
  });

  it('irmaos-na-obra e youtube gravam em keys separadas sem tocar a de dentro-da-guerra', async () => {
    await enviar(SNAP);
    expect((await enviar(NA_OBRA)).status).toBe(200);
    expect((await enviar(YT)).status).toBe(200);
    expect(linhaDe('estudio_snapshot').value).toEqual(SNAP);
    expect(linhaDe('estudio_snapshot:irmaos-na-obra').value).toEqual(NA_OBRA);
    expect(linhaDe('estudio_snapshot:youtube').value).toEqual(YT);
    expect(h.banco.tabelas.system_state).toHaveLength(3);
    // reenviar uma fábrica troca só a dela
    await enviar({ ...NA_OBRA, atualizadoEm: '2026-11-20T00:00:00.000Z' });
    expect(h.banco.tabelas.system_state).toHaveLength(3);
    expect(linhaDe('estudio_snapshot:irmaos-na-obra').value.atualizadoEm).toBe('2026-11-20T00:00:00.000Z');
    expect(linhaDe('estudio_snapshot:youtube').value).toEqual(YT);
  });

  it('GET devolve o snapshot de sempre e fabricas em ordem, com fabricaId e atualizadoEm', async () => {
    await enviar(YT);
    await enviar(NA_OBRA);
    await enviar(SNAP);
    const r = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r.status).toBe(200);
    expect(r.body.snapshot).toEqual(SNAP);
    expect(r.body.atualizadoEm).toBe(linhaDe('estudio_snapshot').updated_at);
    expect(r.body.fabricas.map((f: any) => f.fabricaId)).toEqual(['dentro-da-guerra', 'irmaos-na-obra', 'youtube']);
    expect(r.body.fabricas[1].atualizadoEm).toBe(linhaDe('estudio_snapshot:irmaos-na-obra').updated_at);
    expect(r.body.fabricas[0].serie.nome).toBe('Dentro da Guerra');
  });

  it('GET traz só as fábricas com snapshot e respeita `ordem`', async () => {
    await enviar({ ...YT, ordem: 1 });
    await enviar(SNAP); // sem ordem: posição padrão 1, empate cai na posição da lista
    const r = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r.body.fabricas.map((f: any) => f.fabricaId)).toEqual(['dentro-da-guerra', 'youtube']);
    await enviar({ ...SNAP, ordem: 9 });
    const r2 = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r2.body.fabricas.map((f: any) => f.fabricaId)).toEqual(['youtube', 'dentro-da-guerra']);
    // snapshot só do youtube: `snapshot` (de sempre) fica nulo
    h.banco = novoBanco();
    await enviar(YT);
    const r3 = await request(app).get('/admin/estudio').set('x-admin', '1');
    expect(r3.body.snapshot).toBeNull();
    expect(r3.body.fabricas).toHaveLength(1);
  });

  describe('campos opcionais', () => {
    const PROG = { quando: '2026-11-20T19:00:00-03:00', slug: 'ep-07', titulo: 'Ep 7', capaUrl: 'https://res.cloudinary.com/x/capa.jpg', linha: 'guerra', redes: { instagram: 'agendado', tiktok: 'publicado' }, link: 'https://exemplo.com/v' };
    const PAUTA = { semana: '2026-11-16', etapas: ['fatos', 'roteiro'], itens: [{ dia: 'seg', hora: '11:00', slug: 'a', tema: 'Tema', linha: 'solar', etapa: 'fatos', nota: 8.5 }] };
    const PLANO = {
      formato: 'longo', cadencia: '2 por semana', objetivo: 'Crescer',
      esqueleto: [{ minuto: '0-1', bloco: 'Gancho' }], marcos: [{ titulo: 'Canal', feito: false }],
      referencias: [{ canal: 'Canal X', idioma: 'en', inscritos: 1000, mediaViews: 500 }], riscos: ['Risco'],
    };
    const completo = {
      ...NA_OBRA,
      contas: [{ rede: 'instagram', handle: '@exemplo', url: 'https://instagram.com/exemplo', seguidores: 10 }],
      horarios: ['11:00', '17:00'], programacao: [PROG], pauta: PAUTA,
      personagem: { nome: 'Protagonista', imagemUrl: 'https://exemplo.com/p.png', descricao: 'Texto' }, plano: PLANO,
    };

    it('snapshot completo é aceito e gravado como veio', async () => {
      expect((await enviar(completo)).status).toBe(200);
      expect(linhaDe('estudio_snapshot:irmaos-na-obra').value).toEqual(completo);
    });

    it('recusa tipos e valores fora do contrato com 400', async () => {
      const ruins: Record<string, unknown> = {
        situacao: 'outra', ordem: 'dois', fabricaNome: 5,
        contas: [{ rede: 'orkut', handle: '@x' }],
        horarios: ['9h'], programacao: [{ ...PROG, quando: 'ontem' }],
        pauta: { ...PAUTA, itens: 'x' }, personagem: { nome: 3 }, plano: { ...PLANO, marcos: [{ titulo: 'x', feito: 'sim' }] },
      };
      for (const [campo, valor] of Object.entries(ruins)) {
        expect((await enviar({ ...SNAP, [campo]: valor })).status, campo).toBe(400);
      }
      expect((await enviar({ ...SNAP, programacao: [{ ...PROG, redes: { instagram: 'quase' } }] })).status).toBe(400);
      expect((await enviar({ ...SNAP, programacao: [{ ...PROG, redes: { orkut: 'agendado' } }] })).status).toBe(400);
      expect((await enviar({ ...SNAP, programacao: 'x' })).status).toBe(400);
      expect(h.banco.tabelas.system_state ?? []).toHaveLength(0);
    });

    it('só aceita URL https para capa, imagem, link e conta', async () => {
      for (const u of ['http://exemplo.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//exemplo.com/a.jpg', 'sem-url']) {
        expect((await enviar({ ...SNAP, programacao: [{ ...PROG, capaUrl: u }] })).status, u).toBe(400);
        expect((await enviar({ ...SNAP, personagem: { imagemUrl: u } })).status, u).toBe(400);
      }
      expect((await enviar({ ...SNAP, programacao: [{ ...PROG, link: 'http://x.com' }] })).status).toBe(400);
      expect((await enviar({ ...SNAP, contas: [{ rede: 'tiktok', handle: '@x', url: 'http://x.com' }] })).status).toBe(400);
      expect(h.banco.tabelas.system_state ?? []).toHaveLength(0);
    });

    it('limita o tamanho: 60 itens em programação e pauta, strings razoáveis', async () => {
      expect((await enviar({ ...SNAP, programacao: Array(60).fill(PROG) })).status).toBe(200);
      expect((await enviar({ ...SNAP, programacao: Array(61).fill(PROG) })).status).toBe(400);
      const item = PAUTA.itens[0];
      expect((await enviar({ ...SNAP, pauta: { ...PAUTA, itens: Array(60).fill(item) } })).status).toBe(200);
      expect((await enviar({ ...SNAP, pauta: { ...PAUTA, itens: Array(61).fill(item) } })).status).toBe(400);
      expect((await enviar({ ...SNAP, programacao: [{ ...PROG, titulo: 'x'.repeat(5000) }] })).status).toBe(400);
      expect((await enviar({ ...SNAP, personagem: { descricao: 'x'.repeat(5000) } })).status).toBe(400);
      expect((await enviar({ ...SNAP, plano: { ...PLANO, riscos: Array(31).fill('r') } })).status).toBe(400);
      expect((await enviar({ ...SNAP, programacao: [{ ...PROG, capaUrl: 'https://exemplo.com/' + 'a'.repeat(600) }] })).status).toBe(400);
    });
  });
});
