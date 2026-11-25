import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/dominaia/resumo: vendas e leads vêm do site da Domina IA (Stripe), o app vem de lp_events.

const h = vi.hoisted(() => ({ eventos: [] as any[] }));

function consulta() {
  const q: any = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, lt: () => q, order: () => q,
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
import { periodoParaDatas, buscarResumoNoSite, DOMINAIA_DESDE } from '../services/dominaia/resumoDominaia';
import { ACOES_APP_DOMINAIA } from '../services/dominaia/dominaiaCatalogo';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const TOKEN = 'token-de-teste-com-mais-de-24-caracteres';
const corpoSite = {
  periodo: { desde: '2026-11-24', ate: '2026-11-30' }, atualizadoEm: '2026-11-30T15:00:00.000Z', truncado: false,
  vendas: { compras: 2, receitaCentavos: 1980, lista: [{ email: 'a@b.com' }] },
  leads: { total: 5, compraram: 2, conversao: 0.4, porDia: [], lista: [] },
};
const acao = (acaoApp: string, sid: string) => ({
  session_id: sid, event_type: 'dominaia_app', created_at: new Date().toISOString(), event_data: { lp: 'dominaia', acao: acaoApp },
});
const respostaJson = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => { h.eventos = []; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('periodoParaDatas (America/Sao_Paulo, ate inclusive, nunca antes de DOMINAIA_DESDE)', () => {
  it('DOMINAIA_DESDE é o dia da largada', () => {
    expect(DOMINAIA_DESDE).toBe('2026-11-24');
  });
  it('hoje e ontem', () => {
    // 2026-12-02 02:30 UTC ainda é 01/12 em São Paulo (23:30).
    const agora = new Date('2026-12-02T02:30:00Z');
    expect(periodoParaDatas('hoje', agora)).toEqual({ desde: '2026-12-01', ate: '2026-12-01' });
    expect(periodoParaDatas('ontem', agora)).toEqual({ desde: '2026-11-30', ate: '2026-11-30' });
  });
  it('7dias e 30dias contam o dia de hoje', () => {
    const agora = new Date('2027-01-10T15:00:00Z');
    expect(periodoParaDatas('7dias', agora)).toEqual({ desde: '2027-01-04', ate: '2027-01-10' });
    expect(periodoParaDatas('30dias', agora)).toEqual({ desde: '2026-12-12', ate: '2027-01-10' });
  });
  it('7dias, 30dias e maximo não passam antes da largada; período desconhecido vira 7dias', () => {
    const t = new Date('2026-11-27T15:00:00Z');
    expect(periodoParaDatas('7dias', t)).toEqual({ desde: DOMINAIA_DESDE, ate: '2026-11-27' });
    expect(periodoParaDatas('30dias', t)).toEqual({ desde: DOMINAIA_DESDE, ate: '2026-11-27' });
    expect(periodoParaDatas('maximo', t)).toEqual({ desde: DOMINAIA_DESDE, ate: '2026-11-27' });
    expect(periodoParaDatas('xyz', t)).toEqual({ desde: DOMINAIA_DESDE, ate: '2026-11-27' });
  });
  it('ontem no dia da largada fica invertido (nada antes da largada)', () => {
    const p = periodoParaDatas('ontem', new Date('2026-11-24T15:00:00Z'));
    expect(p).toEqual({ desde: '2026-11-24', ate: '2026-11-23' });
  });
  it('maximo nunca passa de 120 dias (o site recusa periodo_grande)', () => {
    const contarDias = (p: { desde: string; ate: string }): number =>
      Math.round((Date.parse(`${p.ate}T00:00:00Z`) - Date.parse(`${p.desde}T00:00:00Z`)) / 86_400_000) + 1;
    const p = periodoParaDatas('maximo', new Date('2027-04-01T15:00:00Z'));
    expect(p).toEqual({ desde: '2026-12-03', ate: '2027-04-01' });
    expect(contarDias(p)).toBe(120);
    const borda = periodoParaDatas('maximo', new Date('2027-03-22T15:00:00Z'));
    expect(borda.desde).toBe(DOMINAIA_DESDE);
    expect(contarDias(borda)).toBe(119);
    expect(contarDias(periodoParaDatas('maximo', new Date('2027-03-23T15:00:00Z')))).toBe(120);
  });
});

describe('GET /admin/dominaia/resumo', () => {
  it('sem DOMINAIA_ADMIN_TOKEN devolve indisponivel e não chama o site', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await request(app).get('/admin/dominaia/resumo?period=7dias');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBe(true);
    expect(r.body.motivo).toMatch(/DOMINAIA_ADMIN_TOKEN/);
    expect(r.body.vendas.lista).toEqual([]);
    expect(r.body.app).toMatchObject({ abriram: 0, instalaram: 0, upgradeClicks: 0 });
    expect(Object.keys(r.body.app.acoes)).toEqual([...ACOES_APP_DOMINAIA]);
    expect(f).not.toHaveBeenCalled();
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('site fora (erro de rede) devolve indisponivel sem vazar o token', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', TOKEN);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`falhou com ${TOKEN}`)));
    const r = await request(app).get('/admin/dominaia/resumo?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });

  it('site com erro HTTP ou resposta fora do formato devolve indisponivel', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', TOKEN);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respostaJson({}, 401)).mockResolvedValueOnce(respostaJson({ oi: 1 })));
    const a = await request(app).get('/admin/dominaia/resumo');
    expect(a.body.indisponivel).toBe(true);
    expect(a.body.motivo).toMatch(/401/);
    const b = await request(app).get('/admin/dominaia/resumo');
    expect(b.body.indisponivel).toBe(true);
    expect(b.body.motivo).toMatch(/formato/);
  });

  it('sucesso devolve a resposta do site mais o app de lp_events', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', TOKEN);
    vi.stubEnv('DOMINAIA_URL', 'https://exemplo.test/');
    const f = vi.fn().mockResolvedValue(respostaJson(corpoSite));
    vi.stubGlobal('fetch', f);
    h.eventos = [acao('abriu', 's1'), acao('abriu', 's2'), acao('instalou', 's1'), acao('upgrade_click', 's2'), acao('leccion_hecha', 's1')];
    const r = await request(app).get('/admin/dominaia/resumo?period=7dias');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBeUndefined();
    expect(r.body.vendas.compras).toBe(2);
    expect(r.body.leads.total).toBe(5);
    // upgrade_click não é ação da Domina IA: não entra. upgradeClicks fica em 0.
    expect(r.body.app).toMatchObject({ abriram: 2, instalaram: 1, upgradeClicks: 0 });
    expect(r.body.app.acoes).toMatchObject({ abriu: 2, instalou: 1, leccion_hecha: 1, aba: 0 });
    expect(r.body.app.acoes).not.toHaveProperty('upgrade_click');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/exemplo\.test\/api\/admin-resumo\?desde=\d{4}-\d\d-\d\d&ate=\d{4}-\d\d-\d\d$/);
    expect(init.headers['x-admin-token']).toBe(TOKEN);
  });

  it('o bloco checkouts do site passa inteiro até a rota', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', TOKEN);
    const checkouts = {
      abertos: 1, expirados: 1, comFalha: 1, pagaramDepois: 2, porMotivo: { insufficient_funds: 1, sem_tentativa: 1 }, truncado: false,
      lista: [
        { criado: '2026-11-19T13:00:00.000Z', status: 'open', plano: 'basico', valor: 990, pais: 'BR', email: 'a@b.com', sid: 'sid1', motivo: 'insufficient_funds', mensagem: 'Saldo', metodo: 'card' },
        { criado: '2026-11-19T12:00:00.000Z', status: 'expired', plano: 'basico', valor: 990, pais: null, email: '', sid: null, motivo: 'sem_tentativa', mensagem: '', metodo: null },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson({ ...corpoSite, checkouts })));
    const r = await request(app).get('/admin/dominaia/resumo?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.checkouts).toEqual(checkouts);
  });

  it('checkouts indisponível no site não derruba o resumo', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', TOKEN);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson({ ...corpoSite, checkouts: { indisponivel: true, motivo: 'sem_permissao' } })));
    const r = await request(app).get('/admin/dominaia/resumo?period=hoje');
    expect(r.status).toBe(200);
    expect(r.body.indisponivel).toBeUndefined();
    expect(r.body.checkouts).toEqual({ indisponivel: true, motivo: 'sem_permissao' });
    expect(r.body.vendas.compras).toBe(2);
  });

  it('usa a URL padrão sem DOMINAIA_URL', async () => {
    const f = vi.fn().mockResolvedValue(respostaJson(corpoSite));
    const r = await buscarResumoNoSite('2026-11-19', '2026-11-19', { DOMINAIA_ADMIN_TOKEN: TOKEN } as NodeJS.ProcessEnv, f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/domina-ia\.vercel\.app\/api\/admin-resumo/);
  });

  it('período inteiro antes da largada (ontem em 24/11) responde vazio sem chamar o site nem marcar indisponivel', async () => {
    vi.stubEnv('DOMINAIA_ADMIN_TOKEN', TOKEN);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { lerResumoDominaia } = await import('../services/dominaia/resumoDominaia');
    const r = await lerResumoDominaia('ontem', new Date('2026-11-24T15:00:00Z'));
    expect(r.indisponivel).toBeUndefined();
    expect(r.vendas).toMatchObject({ compras: 0, comprasPlus: 0, upgrades: 0, lista: [] });
    expect(r.leads).toMatchObject({ total: 0, lista: [] });
    expect(f).not.toHaveBeenCalled();
  });
});
