import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/monjour/resumo: vendas e leads vêm do site do Monjour (Stripe), o app vem de lp_events.

const h = vi.hoisted(() => ({ eventos: [] as any[] }));

function consulta() {
  const q: any = {
    select: () => q, in: () => q, gte: () => q, lt: () => q, order: () => q,
    limit: () => Promise.resolve({ data: [], error: null }),
    range: (de: number, ate: number) => Promise.resolve({ data: h.eventos.slice(de, ate + 1), error: null }),
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consulta() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => consulta() } }));

import adminRouter from '../routes/admin';
import { periodoParaDatas, buscarResumoNoSite, MONJOUR_DESDE } from '../services/monjour/resumoMonjour';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const TOKEN = 'token-de-teste-com-mais-de-24-caracteres';
const corpoSite = {
  periodo: { desde: '2026-11-13', ate: '2026-11-19' }, atualizadoEm: '2026-11-19T15:00:00.000Z', truncado: false,
  vendas: { compras: 2, receitaCentavos: 1980, lista: [{ email: 'a@b.com' }] },
  leads: { total: 5, compraram: 2, conversao: 0.4, porDia: [], lista: [] },
};
const acao = (acaoApp: string, sid: string) => ({
  session_id: sid, event_type: 'monjour_app', created_at: new Date().toISOString(), event_data: { lp: 'monjour', acao: acaoApp },
});
const respostaJson = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => { h.eventos = []; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('periodoParaDatas (America/Sao_Paulo, ate inclusive)', () => {
  // 2026-11-19 02:30 UTC ainda é 18/11 em São Paulo (23:30).
  const agora = new Date('2026-11-19T02:30:00Z');
  it('hoje e ontem', () => {
    expect(periodoParaDatas('hoje', agora)).toEqual({ desde: '2026-11-18', ate: '2026-11-18' });
    expect(periodoParaDatas('ontem', agora)).toEqual({ desde: '2026-11-17', ate: '2026-11-17' });
  });
  it('7dias e 30dias contam o dia de hoje', () => {
    expect(periodoParaDatas('7dias', agora)).toEqual({ desde: '2026-11-12', ate: '2026-11-18' });
    expect(periodoParaDatas('30dias', agora)).toEqual({ desde: '2026-10-20', ate: '2026-11-18' });
  });
  it('maximo começa em 2026-11-19 e período desconhecido vira 7dias', () => {
    const t = new Date('2026-11-25T15:00:00Z');
    expect(periodoParaDatas('maximo', t)).toEqual({ desde: MONJOUR_DESDE, ate: '2026-11-25' });
    expect(periodoParaDatas('xyz', t)).toEqual({ desde: '2026-11-19', ate: '2026-11-25' });
  });
  it('maximo nunca passa de 120 dias (o site recusa periodo_grande)', () => {
    const contarDias = (p: { desde: string; ate: string }): number =>
      Math.round((Date.parse(`${p.ate}T00:00:00Z`) - Date.parse(`${p.desde}T00:00:00Z`)) / 86_400_000) + 1;
    const p = periodoParaDatas('maximo', new Date('2027-04-01T15:00:00Z'));
    expect(p).toEqual({ desde: '2026-12-03', ate: '2027-04-01' });
    expect(contarDias(p)).toBe(120);
    // No último dia em que cabe tudo, ainda começa no primeiro dia do Monjour.
    const borda = periodoParaDatas('maximo', new Date('2027-03-18T15:00:00Z'));
    expect(borda.desde).toBe(MONJOUR_DESDE);
    expect(contarDias(borda)).toBe(120);
    expect(contarDias(periodoParaDatas('maximo', new Date('2027-03-19T15:00:00Z')))).toBe(120);
  });
});

describe('GET /admin/monjour/resumo', () => {
  it('sem MONJOUR_ADMIN_TOKEN devolve indisponivel e não chama o site', async () => {
    vi.stubEnv('MONJOUR_ADMIN_TOKEN', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await request(app).get('/admin/monjour/resumo?period=7dias');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBe(true);
    expect(r.body.motivo).toMatch(/MONJOUR_ADMIN_TOKEN/);
    expect(r.body.vendas.lista).toEqual([]);
    expect(r.body.app).toEqual({ abriram: 0, instalaram: 0, upgradeClicks: 0 });
    expect(f).not.toHaveBeenCalled();
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('site fora (erro de rede) devolve indisponivel sem vazar o token', async () => {
    vi.stubEnv('MONJOUR_ADMIN_TOKEN', TOKEN);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`falhou com ${TOKEN}`)));
    const r = await request(app).get('/admin/monjour/resumo?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });

  it('site com erro HTTP ou resposta fora do formato devolve indisponivel', async () => {
    vi.stubEnv('MONJOUR_ADMIN_TOKEN', TOKEN);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respostaJson({}, 401)).mockResolvedValueOnce(respostaJson({ oi: 1 })));
    const a = await request(app).get('/admin/monjour/resumo');
    expect(a.body.indisponivel).toBe(true);
    expect(a.body.motivo).toMatch(/401/);
    const b = await request(app).get('/admin/monjour/resumo');
    expect(b.body.indisponivel).toBe(true);
    expect(b.body.motivo).toMatch(/formato/);
  });

  it('sucesso devolve a resposta do site mais o app de lp_events', async () => {
    vi.stubEnv('MONJOUR_ADMIN_TOKEN', TOKEN);
    vi.stubEnv('MONJOUR_URL', 'https://exemplo.test/');
    const f = vi.fn().mockResolvedValue(respostaJson(corpoSite));
    vi.stubGlobal('fetch', f);
    h.eventos = [acao('abriu', 's1'), acao('abriu', 's2'), acao('instalou', 's1'), acao('upgrade_click', 's2')];
    const r = await request(app).get('/admin/monjour/resumo?period=7dias');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBeUndefined();
    expect(r.body.vendas.compras).toBe(2);
    expect(r.body.leads.total).toBe(5);
    expect(r.body.app).toEqual({ abriram: 2, instalaram: 1, upgradeClicks: 1 });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/exemplo\.test\/api\/admin-resumo\?desde=\d{4}-\d\d-\d\d&ate=\d{4}-\d\d-\d\d$/);
    expect(init.headers['x-admin-token']).toBe(TOKEN);
  });

  it('usa a URL padrão sem MONJOUR_URL', async () => {
    const f = vi.fn().mockResolvedValue(respostaJson(corpoSite));
    const r = await buscarResumoNoSite('2026-11-19', '2026-11-19', { MONJOUR_ADMIN_TOKEN: TOKEN } as NodeJS.ProcessEnv, f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/monjour-natural\.vercel\.app\/api\/admin-resumo/);
  });
});
