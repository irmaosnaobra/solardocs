import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A rota do relatório semanal de melhoria: GET /cron/agentes-5040/melhoria. Protegida como as outras, com dry, semana e
// forcar, UM e-mail só quando grava relatório novo com itens, e falha no e-mail que não derruba a rota. O relógio é de
// segunda 07:45 de Brasília.
const h = vi.hoisted(() => ({ rodou: vi.fn(), relatorio: null as any, info: vi.fn(), warn: vi.fn(), email: vi.fn() }));

vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: (...a: unknown[]) => h.warn(...a), info: (...a: unknown[]) => h.info(...a) } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: (...a: unknown[]) => h.email(...a) }));
vi.mock('../services/agentes5040/melhoria', async (original) => ({
  ...(await original<typeof import('../services/agentes5040/melhoria')>()),
  runMelhoriaTick: vi.fn(async (o: unknown) => { h.rodou(o); return h.relatorio; }),
}));

import cronRouter from '../routes/cron';

const app = express();
app.use('/cron', cronRouter);
const chama = (q = '') => request(app).get(`/cron/agentes-5040/melhoria${q}`).set('Authorization', `Bearer ${process.env.CRON_SECRET}`);

beforeEach(() => {
  process.env.CRON_SECRET = 'segredo-de-teste-cron';
  for (const f of [h.rodou, h.info, h.warn, h.email]) f.mockReset();
  h.email.mockResolvedValue(undefined);
  h.relatorio = {
    ok: true, ligado: true, dry: false, semana: '2026-10-26', existe: false, pulou: false, poucosDados: false, notasLidas: 120, notasComProblema: 30,
    agentesComProblema: ['duda'], chamadasIA: 3, gravou: true, novo: true, itens: 3, falhou: [], parou: null,
    top3: [{ tipo: 'repetiu_pergunta', vezes: 9 }, { tipo: 'alucinacao', vezes: 4 }, { tipo: 'tom_errado', vezes: 2 }],
  };
});

describe('cron agentes-5040/melhoria', () => {
  it('sem o segredo do cron: 401 e a rodada nem começa', async () => {
    const res = await request(app).get('/cron/agentes-5040/melhoria');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(404);
    expect(h.rodou).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });

  it('relatório novo com itens: UM e-mail, com o assunto combinado e o corpo curto', async () => {
    const res = await chama();
    expect(res.status).toBe(200);
    expect(h.rodou).toHaveBeenCalledWith({ dry: false, semana: undefined, forcar: false });
    expect(h.email).toHaveBeenCalledTimes(1);
    const [assunto, corpo] = h.email.mock.calls[0] as [string, string];
    expect(assunto).toBe('Agentes 5040: melhorias da semana');
    expect(corpo).toContain('120');
    expect(corpo).toContain('Repetiu pergunta: 9 conversas');
    expect(corpo).toContain('Informação inventada: 4 conversas');
    expect(corpo).toContain('Tom errado: 2 conversas');
    expect(corpo).toContain('Veja na aba Ensaio do /gerador.');
    expect(corpo + assunto).not.toMatch(/[—–]/);
    expect(h.info).toHaveBeenCalledWith('cron', 'agentes-5040/melhoria rodou', expect.objectContaining({ semana: '2026-10-26', gravou: true, itens: 3 }));
  });

  it('semana e forcar chegam na rodada; semana torta é ignorada', async () => {
    await chama('?semana=2026-10-19&forcar=1');
    expect(h.rodou).toHaveBeenLastCalledWith({ dry: false, semana: '2026-10-19', forcar: true });
    await chama('?semana=ontem');
    expect(h.rodou).toHaveBeenLastCalledWith({ dry: false, semana: undefined, forcar: false });
  });

  it('falha no e-mail não derruba a rota', async () => {
    h.email.mockRejectedValue(new Error('Resend error: fora do ar'));
    const res = await chama();
    expect(res.status).toBe(200);
    expect(res.body.gravou).toBe(true);
    expect(h.email).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalled();
  });

  it('sem e-mail quando: dry, pulou, poucos dados, nada gravado, ou gravou sem itens', async () => {
    const casos: Array<Record<string, unknown>> = [
      { dry: true, gravou: false, novo: false }, { pulou: true, gravou: false, novo: false }, { novo: false }, { novo: false, falhou: [] }, { poucosDados: true, itens: 0 }, { gravou: false, novo: false, itens: 0, parou: 'teto' }, { itens: 0 },
    ];
    for (const c of casos) {
      h.relatorio = { ...h.relatorio, gravou: true, novo: true, itens: 3, dry: false, pulou: false, poucosDados: false, ...c };
      await chama();
    }
    expect(h.email).not.toHaveBeenCalled();
  });

  it('interruptor desligado: sai ok, sem e-mail e sem log de rodada', async () => {
    h.relatorio = { ...h.relatorio, ligado: false, gravou: false, novo: false, itens: 0 };
    const res = await chama();
    expect(res.status).toBe(200);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.info).not.toHaveBeenCalled();
  });

  it('rodada que falhou devolve 500', async () => {
    h.relatorio = { ...h.relatorio, ok: false, gravou: false, itens: 0, motivo: 'a rodada falhou' };
    expect((await chama()).status).toBe(500);
    expect(h.email).not.toHaveBeenCalled();
  });

  it('o vercel.json tem o relógio de segunda 10:45 UTC (07:45 em Brasília), e só um', () => {
    const v = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    expect(v.crons.filter(c => c.path === '/cron/agentes-5040/melhoria')).toEqual([{ path: '/cron/agentes-5040/melhoria', schedule: '45 10 * * 1' }]);
    expect(v.crons.find(c => c.path === '/cron/agentes-5040/qualidade')).toEqual({ path: '/cron/agentes-5040/qualidade', schedule: '0,30 10 * * *' });
  });
});
