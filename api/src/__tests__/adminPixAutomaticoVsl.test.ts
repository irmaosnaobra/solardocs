import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 1) contarPixAutomatico (payload do /admin/billing): mesmo critério do lembrete de Pix (modo 'automatico',
//    status 'ativo' ou 'inadimplente'), conta PESSOAS e separa quem também tem cartão vivo.
// 2) GET /admin/vsl: a /vsl da SolarDoc (lp 'solardoc_vsl') passa a ser mapeada; o eletroposto segue igual.

const h = vi.hoisted(() => ({
  contratos: [] as unknown[], filtros: [] as Array<[string, unknown]>, falha: false,
  visitas: [] as unknown[], eventos: [] as unknown[], tiposPedidos: [] as unknown[], ilikes: [] as string[], lpFiltrado: [] as unknown[],
}));

function consulta(tabela: string) {
  const q: any = {
    select: () => q, gte: () => q, limit: () => q,
    eq: (c: string, v: unknown) => { h.filtros.push([c, v]); if (c === 'event_data->>lp') h.lpFiltrado.push(v); return q; },
    in: (c: string, v: unknown) => {
      h.filtros.push([c, v]);
      if (tabela === 'lp_events') h.tiposPedidos = v as unknown[];
      return q;
    },
    ilike: (_c: string, v: string) => { h.ilikes.push(v); return q; },
    range: (de: number, ate: number) => Promise.resolve(
      h.falha ? { data: null, error: { message: 'x' } } : { data: h.contratos.slice(de, ate + 1), error: null },
    ),
    then: (ok: (v: unknown) => unknown) => ok({ data: tabela === 'page_visits' ? h.visitas : tabela === 'lp_events' ? h.eventos : [], error: null }),
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => consulta(t) } }));

import { contarPixAutomatico } from '../controllers/adminController';
import adminRouter from '../routes/admin';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

describe('contarPixAutomatico', () => {
  beforeEach(() => { h.contratos = []; h.filtros = []; h.falha = false; });

  it('usa o critério do lembrete de Pix e conta pessoas, não contratos', async () => {
    h.contratos = [
      { user_id: 'u1', email: 'a@x.com' },
      { user_id: 'u1', email: 'a@x.com' },       // mesma pessoa, 2 contratos
      { user_id: 'u2', email: 'B@x.com ' },
      { user_id: null, email: 'quiz@x.com' },    // contrato do quiz, sem conta
    ];
    const r = await contarPixAutomatico(new Set<string>(), new Set<string>());
    expect(r).toEqual({ vivos: 3, soPix: 3 });
    expect(h.filtros).toContainEqual(['modo', 'automatico']);
    expect(h.filtros).toContainEqual(['status', ['ativo', 'inadimplente']]);
  });

  it('junta pelo e-mail mesmo quando há user_id (mesma pessoa, dois contratos conta uma vez)', async () => {
    h.contratos = [
      { user_id: 'u1', email: 'a@x.com' },
      { user_id: null, email: 'A@x.com' },       // contrato do quiz, mesmo e-mail
      { user_id: 'u2', email: 'a@x.com' },       // outra conta com o mesmo e-mail
      { user_id: 'u3', email: 'c@x.com' },
    ];
    expect(await contarPixAutomatico(new Set(), new Set())).toEqual({ vivos: 2, soPix: 2 });
    // se qualquer contrato do grupo tem cartão, o grupo inteiro sai de "só Pix"
    expect(await contarPixAutomatico(new Set(['u2']), new Set())).toEqual({ vivos: 2, soPix: 1 });
  });

  it('tira do total quem também tem cartão vivo (por user_id ou por e-mail)', async () => {
    h.contratos = [
      { user_id: 'u1', email: 'a@x.com' },       // cartão por user_id
      { user_id: 'u2', email: 'b@x.com' },       // cartão por e-mail
      { user_id: 'u3', email: 'c@x.com' },       // só Pix
    ];
    const r = await contarPixAutomatico(new Set(['u1']), new Set(['b@x.com']));
    expect(r).toEqual({ vivos: 3, soPix: 1 });
  });

  it('devolve null se a leitura falhar (o painel esconde em vez de mostrar zero)', async () => {
    h.falha = true;
    expect(await contarPixAutomatico(new Set(), new Set())).toBeNull();
  });
});

describe('GET /admin/vsl', () => {
  beforeEach(() => { h.visitas = []; h.eventos = []; h.tiposPedidos = []; h.ilikes = []; h.lpFiltrado = []; });

  it('mapeia a /vsl da SolarDoc: filtra os eventos por solardoc_vsl e as visitas por /vsl', async () => {
    h.visitas = [
      { session_id: 's1', landing_url: 'https://solardoc.app/vsl?utm_source=x' },
      { session_id: 's2', landing_url: 'https://solardoc.app/vsl-outra' },
    ];
    const r = await request(app).get('/admin/vsl?lp=solardoc_vsl&period=7dias');
    expect(r.status).toBe(200);
    expect(r.body.visitas).toBe(1);
    expect(h.lpFiltrado).toContain('solardoc_vsl');
    expect(h.ilikes).toContain('%/vsl%');
  });

  it('conta os marcos da /vsl por sessão única e preenche plays com o vsl_play', async () => {
    h.visitas = ['s1', 's2', 's3', 's4'].map((s) => ({ session_id: s, landing_url: 'https://solardoc.app/vsl' }));
    const ev = (s: string, t: string) => ({ session_id: s, event_type: t, event_data: { lp: 'solardoc_vsl' } });
    h.eventos = [
      ev('s1', 'vsl_play'), ev('s1', 'vsl_play'), ev('s1', 'vsl_25'), ev('s1', 'vsl_50'), ev('s1', 'vsl_75'), ev('s1', 'vsl_fim'),
      ev('s2', 'vsl_play'), ev('s2', 'vsl_25'),
      ev('s3', 'vsl_play'),
    ];
    const r = await request(app).get('/admin/vsl?lp=solardoc_vsl&period=7dias');
    expect(r.status).toBe(200);
    expect(h.tiposPedidos).toEqual(['vsl', 'vsl_cta', 'vsl_pular', 'vsl_play', 'vsl_25', 'vsl_50', 'vsl_75', 'vsl_fim']);
    expect(r.body.visitas).toBe(4);
    expect(r.body.plays).toBe(3);
    expect(r.body.completaram).toBe(1);
    expect(r.body.marcos).toEqual([
      { rotulo: 'Play', sessoes: 3, pct_das_visitas: 75 },
      { rotulo: '25%', sessoes: 2, pct_das_visitas: 50 },
      { rotulo: '50%', sessoes: 1, pct_das_visitas: 25 },
      { rotulo: '75%', sessoes: 1, pct_das_visitas: 25 },
      { rotulo: 'Fim', sessoes: 1, pct_das_visitas: 25 },
    ]);
    expect(r.body.curva).toEqual([]);
  });

  it('limita pct_das_visitas a 100 quando há mais sessões com marco do que visitas casadas', async () => {
    h.visitas = [{ session_id: 's1', landing_url: 'https://solardoc.app/vsl' }];
    h.eventos = ['s1', 's2', 's3'].map((s) => ({ session_id: s, event_type: 'vsl_play', event_data: { lp: 'solardoc_vsl' } }));
    const r = await request(app).get('/admin/vsl?lp=solardoc_vsl');
    expect(r.body.marcos[0]).toEqual({ rotulo: 'Play', sessoes: 3, pct_das_visitas: 100 });
  });

  it('marcos com zero visita não dividem por zero', async () => {
    const r = await request(app).get('/admin/vsl?lp=solardoc_vsl');
    expect(r.status).toBe(200);
    expect(r.body.marcos.every((m: { pct_das_visitas: number }) => m.pct_das_visitas === 0)).toBe(true);
  });

  it('o eletroposto continua igual', async () => {
    h.visitas = [{ session_id: 's1', landing_url: 'https://solardoc.app/io/eletroposto' }];
    const r = await request(app).get('/admin/vsl?lp=eletroposto');
    expect(r.status).toBe(200);
    expect(r.body.visitas).toBe(1);
    expect(h.lpFiltrado).toContain('eletroposto');
    expect(h.ilikes).toContain('%/io/eletroposto%');
    expect(h.tiposPedidos).toEqual(['vsl', 'vsl_cta', 'vsl_pular']);
    expect(r.body).not.toHaveProperty('marcos');
  });

  it('lp sem vídeo mapeado continua dando 400', async () => {
    const r = await request(app).get('/admin/vsl?lp=nao_existe');
    expect(r.status).toBe(400);
  });
});
