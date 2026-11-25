import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/dominaia/quiz-funil: lê os eventos dominaia_* de lp_events (de 1000 em 1000),
// aplica os filtros e devolve o FunilDominaia.

const h = vi.hoisted(() => ({
  eventos: [] as any[], filtros: [] as Array<[string, unknown[]]>, ranges: [] as Array<[number, number]>,
  primeiro: null as string | null, falhaPrimeiro: false, falhaLeitura: false,
}));

function consulta() {
  let soPrimeiro = false;
  const q: any = {
    select: (cols: string) => { soPrimeiro = cols === 'created_at'; return q; },
    eq: (c: string, v: unknown) => { h.filtros.push([`eq:${c}`, [v]]); return q; },
    in: (c: string, v: unknown[]) => { h.filtros.push([`in:${c}`, v]); return q; },
    gte: (c: string, v: unknown) => { h.filtros.push([`gte:${c}`, [v]]); return q; },
    lt: (c: string, v: unknown) => { h.filtros.push([`lt:${c}`, [v]]); return q; },
    order: () => q,
    limit: () => (h.falhaPrimeiro
      ? Promise.resolve({ data: null, error: new Error('x') })
      : Promise.resolve({ data: h.primeiro ? [{ created_at: h.primeiro }] : [], error: null })),
    range: (de: number, ate: number) => {
      h.ranges.push([de, ate]);
      if (h.falhaLeitura) return Promise.resolve({ data: null, error: new Error('banco fora') });
      return Promise.resolve({ data: soPrimeiro ? [] : h.eventos.slice(de, ate + 1), error: null });
    },
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consulta() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => consulta() } }));

import adminRouter from '../routes/admin';
import { DOMINAIA_DESDE } from '../services/dominaia/dominaiaCatalogo';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const agora = () => new Date().toISOString();
const passo = (sid: string, n: number, chave: string, d: Record<string, unknown> = {}) => ({
  session_id: sid, event_type: 'dominaia_passo', created_at: agora(), event_data: { lp: 'dominaia', passo: chave, n, ...d },
});

beforeEach(() => {
  h.eventos = []; h.filtros = []; h.ranges = []; h.primeiro = null; h.falhaPrimeiro = false; h.falhaLeitura = false;
});

describe('GET /admin/dominaia/quiz-funil', () => {
  it('devolve o funil com o desenho do contrato', async () => {
    h.primeiro = '2026-11-24T12:00:00+00:00';
    h.eventos = [passo('s1', 1, 'edad', { pais: 'MX' }), passo('s1', 2, 'objetivo'), passo('s2', 1, 'edad', { pais: 'CO' })];
    const r = await request(app).get('/admin/dominaia/quiz-funil?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.periodo).toBe('hoje');
    expect(r.body.inicioRastreio).toBe('2026-11-24T12:00:00.000Z');
    expect(r.body.truncado).toBe(false);
    expect(r.body.totais.sessoes).toBe(2);
    expect(r.body.etapas).toHaveLength(34); // 32 telas do catálogo, clicou em comprar e comprou
    expect(r.body.etapas.slice(0, 4).map((e: { chave: string }) => e.chave)).toEqual(['inicio', 'edad', 'espejo_ia', 'objetivo']);
    expect(r.body.etapas.find((e: { chave: string }) => e.chave === 'edad')).toMatchObject({ n: 2, chegaram: 2, sairam: 1 });
    expect(Object.keys(r.body).sort()).toEqual([
      'app', 'ate', 'atualizadoEm', 'desde', 'etapas', 'filtros', 'inicioRastreio', 'paginaVenta', 'periodo',
      'recortes', 'respostas', 'saidas', 'totais', 'truncado',
    ]);
    expect(Object.keys(r.body.recortes).sort()).toEqual(['anuncio', 'aparelho', 'conjunto', 'dia', 'hora', 'navegador', 'pais', 'sistema']);
  });

  it('lê só os quatro tipos dominaia, no período', async () => {
    await request(app).get('/admin/dominaia/quiz-funil?period=ontem');
    const tipos = h.filtros.find(([c]) => c === 'in:event_type')![1] as string[];
    expect(tipos.sort()).toEqual(['dominaia_app', 'dominaia_fim', 'dominaia_passo', 'dominaia_resp']);
    expect(h.filtros.some(([c]) => c === 'gte:created_at')).toBe(true);
    expect(h.filtros.some(([c]) => c === 'lt:created_at')).toBe(true); // ontem tem fim
  });

  it('sem página de venda, sem plus, sem upgrade, sem meta e partida: as chaves do contrato saem zeradas', async () => {
    h.eventos = [
      passo('s1', 1, 'inicio'), passo('s1', 2, 'edad'),
      { session_id: 'dm_1', event_type: 'dominaia_sinal', created_at: agora(), event_data: { q: 'carga', pais: 'MX' } },
      { session_id: 's1', event_type: 'dominaia_fim', created_at: agora(), event_data: { destino: 'checkout', plan: 'basico' } },
      { session_id: 's1', event_type: 'dominaia_fim', created_at: agora(), event_data: { destino: 'compra', valor: 990, moeda: 'usd' } },
    ];
    const r = await request(app).get('/admin/dominaia/quiz-funil?period=hoje');
    // Só os quatro tipos do quiz e do app: o sinal de medição não é lido (nenhuma consulta tem eq event_type).
    expect(h.filtros.some(([c]) => c === 'eq:event_type')).toBe(false);
    expect(r.body.paginaVenta).toEqual({ visitas: 0, planes: 0, compra: 0, checkouts: 0, compras: 0, secoes: [], cliques: [] });
    expect(r.body.saidas).toEqual({ finSeguridad: 0, partidaSemSaida: 0 });
    expect(r.body.totais).toMatchObject({ sessoes: 1, compras: 1, comprasBasico: 1, comprasPlus: 0, upgrades: 0, receitaCentavos: 990, ticketMedioCentavos: 990 });
    expect(r.body.etapas.map((e: { chave: string }) => e.chave)).not.toContain('meta');
    expect(r.body.etapas.map((e: { chave: string }) => e.chave)).not.toContain('partida');
    expect(r.body.etapas.every((e: Record<string, unknown>) => !('desde' in e) && !('ate' in e) && !('pularam' in e))).toBe(true);
    expect(r.body.etapas.slice(-2).map((e: { chave: string }) => e.chave)).toEqual(['checkout', 'compra']);
  });

  it('o app conta só as ações que o site da Domina IA emite', async () => {
    const app1 = (sid: string, acao: string) => ({ session_id: sid, event_type: 'dominaia_app', created_at: agora(), event_data: { lp: 'dominaia', acao } });
    h.eventos = [passo('a', 1, 'inicio'), app1('a', 'abriu'), app1('a', 'instalou'), app1('b', 'abriu'), app1('b', 'prompt_copiado'), app1('b', 'upgrade_click')];
    const r = await request(app).get('/admin/dominaia/quiz-funil?period=hoje');
    expect(r.body.app).toMatchObject({ abriram: 2, instalaram: 1, upgradeClicks: 0 });
    expect(Object.keys(r.body.app.acoes)).toEqual(['abriu', 'aba', 'dia_visto', 'leccion_vista', 'prompt_copiado', 'ejercicio_hecho', 'leccion_hecha', 'instalou']);
    expect(r.body.app.acoes).toMatchObject({ abriu: 2, instalou: 1, prompt_copiado: 1, aba: 0 });
  });

  it('nunca lê antes de 24/11/2026: o gte do período não passa da largada', async () => {
    await request(app).get('/admin/dominaia/quiz-funil?period=30dias');
    await request(app).get('/admin/dominaia/quiz-funil?period=maximo');
    const piso = Date.parse(`${DOMINAIA_DESDE}T00:00:00-03:00`);
    const gtes = h.filtros.filter(([c]) => c === 'gte:created_at').map(([, v]) => Date.parse(String(v[0])));
    expect(gtes.length).toBeGreaterThanOrEqual(4); // a leitura e o primeiro evento, nos dois períodos
    expect(gtes.every((t) => t >= piso)).toBe(true);
  });

  it('pagina de 1000 em 1000', async () => {
    h.eventos = Array.from({ length: 2300 }, (_, i) => passo(`s${i}`, 1, 'edad'));
    const r = await request(app).get('/admin/dominaia/quiz-funil?period=30dias');
    expect(r.body.totais.sessoes).toBe(2300);
    expect(r.body.truncado).toBe(false);
    expect(h.ranges.filter(([de]) => de < 5000)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('passou do teto de 200 mil linhas: truncado', async () => {
    h.eventos = new Proxy([] as any[], {
      get: (alvo, p) => (p === 'slice'
        ? (de: number, ate: number) => Array.from({ length: ate - de }, (_, i) => passo(`t${de + i}`, 1, 'edad'))
        : Reflect.get(alvo, p)),
    });
    const r = await request(app).get('/admin/dominaia/quiz-funil?period=maximo');
    expect(r.status).toBe(200);
    expect(r.body.truncado).toBe(true);
    expect(h.ranges).toHaveLength(200);
  }, 60_000);

  it('filtros pais, disp, anuncio e conjunto vêm da query', async () => {
    h.eventos = [
      passo('a', 1, 'edad', { pais: 'MX', disp: 'movil', utm_content: '120256102223900271' }),
      passo('b', 1, 'edad', { pais: 'CO', disp: 'movil', utm_content: '120256102299300271' }),
      passo('c', 1, 'edad', { pais: 'MX', disp: 'escritorio' }),
    ];
    const total = async (qs: string) => (await request(app).get(`/admin/dominaia/quiz-funil?${qs}`)).body.totais.sessoes;
    expect(await total('period=7dias&pais=mx')).toBe(2);
    expect(await total('period=7dias&disp=movil')).toBe(2);
    expect(await total('period=7dias&pais=MX&disp=movil')).toBe(1);
    expect(await total('period=7dias&anuncio=120256102299300271')).toBe(1);
    expect(await total('period=7dias&conjunto=120256102215990271')).toBe(1);
    expect(await total('period=7dias&anuncio=sem')).toBe(1);
  });

  it('período inválido cai em 7dias; sem período também', async () => {
    expect((await request(app).get('/admin/dominaia/quiz-funil?period=ano')).body.periodo).toBe('7dias');
    expect((await request(app).get('/admin/dominaia/quiz-funil')).body.periodo).toBe('7dias');
  });

  it('período vazio: tudo zerado e inicioRastreio nulo', async () => {
    const r = await request(app).get('/admin/dominaia/quiz-funil?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.totais.sessoes).toBe(0);
    expect(r.body.inicioRastreio).toBeNull();
    expect(r.body.recortes.pais).toEqual([]);
  });

  it('falha ao achar o primeiro evento não derruba o painel', async () => {
    h.falhaPrimeiro = true;
    const r = await request(app).get('/admin/dominaia/quiz-funil');
    expect(r.status).toBe(200);
    expect(r.body.inicioRastreio).toBeNull();
  });

  it('erro do banco vira 500 com a mensagem, no padrão das rotas vizinhas', async () => {
    h.falhaLeitura = true;
    const r = await request(app).get('/admin/dominaia/quiz-funil');
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('banco fora');
  });
});
