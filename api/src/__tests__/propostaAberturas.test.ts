import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  eventos: [] as Record<string, unknown>[],
  docDoDono: true,
  filtros: [] as [string, unknown][],
  limite: 0,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { h.filtros.push([`${tabela}.${c}`, v]); return q; };
      q.order = () => q;
      q.maybeSingle = async () => ({ data: h.docDoDono ? { id: 'doc-1' } : null, error: null });
      q.limit = async (n: number) => { h.limite = n; return { data: h.eventos, error: null }; };
      return q;
    },
  },
}));
vi.mock('../utils/jwt', () => ({
  verifyToken: (t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  },
}));

import { agregarAberturas } from '../controllers/aberturasController';
import documentsRoutes from '../routes/documents';

const app = express();
app.use(express.json());
app.use('/documents', documentsRoutes);
const AUTH = 'Bearer valid-token';

const ev = (document_id: string, em: string, extra: Record<string, unknown> = {}, tipo = 'aberta') => ({
  event_type: tipo, created_at: em, event_data: { document_id, cidade: 'Uberlândia', uf: 'MG', pais: 'BR', dispositivo: 'Celular', ...extra },
});

beforeEach(() => { h.eventos = []; h.docDoDono = true; h.filtros = []; h.limite = 0; });

describe('agregarAberturas', () => {
  it('total por documento e a última abertura (linhas da mais nova para a mais antiga)', () => {
    const r = agregarAberturas([
      ev('a', '2026-11-04T12:00:00Z', { cidade: 'Rio Preto', uf: 'SP', dispositivo: 'Computador' }),
      ev('b', '2026-11-04T11:00:00Z', {}, 'aberta_vencida'),
      ev('a', '2026-11-03T10:00:00Z'),
      ev('a', '2026-11-02T10:00:00Z'),
    ]);
    expect(r.a).toEqual({ total: 3, ultima: { em: '2026-11-04T12:00:00Z', cidade: 'Rio Preto', uf: 'SP', dispositivo: 'Computador', vencida: false } });
    expect(r.b.total).toBe(1);
    expect(r.b.ultima.vencida).toBe(true);
  });

  it('linha sem document_id é ignorada e vazio dá objeto vazio', () => {
    expect(agregarAberturas([{ event_type: 'aberta', created_at: 'x', event_data: null }])).toEqual({});
    expect(agregarAberturas([])).toEqual({});
  });
});

describe('GET /documents/aberturas e /documents/:id/aberturas', () => {
  it('exigem login', async () => {
    expect((await request(app).get('/documents/aberturas')).status).toBe(401);
    expect((await request(app).get('/documents/doc-1/aberturas')).status).toBe(401);
  });

  it('o resumo vem antes de /:id, filtra pelo usuário e lê no máximo 1000 linhas', async () => {
    h.eventos = [ev('doc-1', '2026-11-04T12:00:00Z'), ev('doc-1', '2026-11-03T12:00:00Z')];
    const res = await request(app).get('/documents/aberturas').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body['doc-1'].total).toBe(2);
    expect(res.body['doc-1'].ultima.cidade).toBe('Uberlândia');
    expect(h.limite).toBe(1000);
    expect(h.filtros).toContainEqual(['feature_events.user_id', 'user-123']);
    expect(h.filtros).toContainEqual(['feature_events.feature', 'proposta_link']);
  });

  it('a lista de um documento traz as últimas 50, só do dono', async () => {
    h.eventos = [ev('doc-1', '2026-11-04T12:00:00Z', {}, 'aberta_vencida'), ev('doc-1', '2026-11-03T12:00:00Z')];
    const res = await request(app).get('/documents/doc-1/aberturas').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { em: '2026-11-04T12:00:00Z', cidade: 'Uberlândia', uf: 'MG', pais: 'BR', dispositivo: 'Celular', vencida: true },
      { em: '2026-11-03T12:00:00Z', cidade: 'Uberlândia', uf: 'MG', pais: 'BR', dispositivo: 'Celular', vencida: false },
    ]);
    expect(h.limite).toBe(50);
    expect(h.filtros).toContainEqual(['documents.user_id', 'user-123']);
    expect(h.filtros).toContainEqual(['feature_events.event_data->>document_id', 'doc-1']);
  });

  it('documento de outro usuário dá 404', async () => {
    h.docDoDono = false;
    const res = await request(app).get('/documents/doc-1/aberturas').set('Authorization', AUTH);
    expect(res.status).toBe(404);
  });
});
