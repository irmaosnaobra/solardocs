import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/solardoc/quiz-funil: lê os eventos com lp = 'solardoc' e devolve a MESMA
// forma de /admin/solar/quiz-funil (o painel do dashboard lê as duas igual).

const h = vi.hoisted(() => ({
  eventos: [] as unknown[], visitas: [] as unknown[], filtros: [] as Array<[string, unknown]>,
}));

function consulta(tabela: string) {
  const linhas = () => (tabela === 'lp_events' ? h.eventos : tabela === 'page_visits' ? h.visitas : []);
  const q: any = {
    select: () => q, in: () => q, gte: () => q, lt: () => q, ilike: () => q, like: () => q,
    eq: (c: string, v: unknown) => { h.filtros.push([c, v]); return q; },
    order: () => q,
    range: (de: number, ate: number) => Promise.resolve({ data: linhas().slice(de, ate + 1), error: null }),
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => consulta(t) } }));
vi.mock('../services/io/metaConjuntos', async (orig) => ({
  ...(await orig<typeof import('../services/io/metaConjuntos')>()),
  buscarConjuntosMeta: vi.fn().mockResolvedValue({ ok: true, conjuntos: new Map() }),
}));

import adminRouter from '../routes/admin';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const ev = (s: string, tipo: string, d: Record<string, unknown>, seq: number) =>
  ({ session_id: s, event_type: tipo, event_data: { lp: 'solardoc', caminho: 'principal', pl: 1, seq, ...d }, created_at: new Date().toISOString() });

describe('GET /admin/solardoc/quiz-funil', () => {
  it('devolve o funil com as chaves da rota do solar e filtra os eventos por lp', async () => {
    h.eventos = [ev('a', 'quiz_passo', { passo: 'capa' }, 1), ev('a', 'quiz_passo', { passo: 'papel' }, 2), ev('b', 'quiz_passo', { passo: 'capa' }, 1), ev('b', 'quiz_fim', { destino: 'pix' }, 2)];
    h.visitas = [{ session_id: 'a', landing_url: 'https://solardoc.app/diagnostico?utm_term=111', utm_campaign: 'c', utm_term: '111' }];
    const r = await request(app).get('/admin/solardoc/quiz-funil?period=7dias');
    expect(r.status).toBe(200);
    for (const k of ['periodo', 'desde', 'ate', 'abriram', 'terminaram', 'destinos', 'caminhos', 'campanhas', 'conjuntos', 'por_conjunto', 'meta_ok', 'meta_motivo', 'medindo_desde']) {
      expect(r.body, k).toHaveProperty(k);
    }
    expect(r.body.periodo).toBe('7dias');
    expect(r.body.abriram).toBe(2);
    expect(r.body.destinos).toEqual({ pix: 1 });
    expect(r.body.caminhos[0].id).toBe('principal');
    expect(h.filtros).toContainEqual(['event_data->>lp', 'solardoc']);
  });
});
