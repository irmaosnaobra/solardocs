import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// O rastro da rodada viva: GET /cron/agentes-5040/vivo grava ag5040_vivo_ultima só quando algo está ligado e não é seco,
// sem telefone nenhum, e uma falha da gravação não derruba a rota.

const h = vi.hoisted(() => ({
  upserts: [] as any[],
  upsertErro: null as any,
  upsertLanca: false,
  relatorio: null as any,
  rodou: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn((tabela: string) => ({
      upsert: vi.fn(async (linha: any, opts: any) => {
        if (h.upsertLanca) throw new Error('rede');
        h.upserts.push({ tabela, linha, opts });
        return { error: h.upsertErro };
      }),
    })),
  },
}));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: (...a: unknown[]) => h.warn(...a), info: (...a: unknown[]) => h.info(...a) } }));
vi.mock('../services/agentes5040/vivo', () => ({
  runVivoTick: vi.fn(async (o: unknown) => { h.rodou(o); return h.relatorio; }),
}));

import cronRouter from '../routes/cron';

const app = express();
app.use('/cron', cronRouter);

const relatorio = (extra: Record<string, unknown> = {}) => ({
  ok: true, ligado: true, dry: false, conversasVistas: 4, elegiveis: 2, processadas: 2, enviadas: 1, puladas: {}, parou: null,
  chamadasIA: 2, janelaTruncada: false,
  decisoes: [{ chave: '5511988880001', bolhas: ['Oi, Maria'] }],   // dado pessoal que NÃO pode ir para o rastro
  ...extra,
});
const chamar = (q = '') => request(app).get(`/cron/agentes-5040/vivo${q}`).set('Authorization', `Bearer ${process.env.CRON_SECRET}`);

beforeEach(() => {
  process.env.CRON_SECRET = 'segredo-de-teste-cron';
  h.upserts.length = 0; h.upsertErro = null; h.upsertLanca = false;
  h.rodou.mockClear(); h.info.mockClear(); h.warn.mockClear();
  h.relatorio = relatorio();
});

describe('cron agentes-5040/vivo: rastro da última rodada', () => {
  it('rodada ligada grava ag5040_vivo_ultima sem telefone nem texto, e loga o resumo', async () => {
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
    const { tabela, linha, opts } = h.upserts[0];
    expect(tabela).toBe('system_state');
    expect(opts).toEqual({ onConflict: 'key' });
    expect(linha.key).toBe('ag5040_vivo_ultima');
    expect(Object.keys(linha.value).sort()).toEqual(['conversas_vistas', 'em', 'enviadas', 'ligado', 'parou']);
    expect(linha.value).toMatchObject({ ligado: true, conversas_vistas: 4, enviadas: 1, parou: null });
    expect(Number.isFinite(new Date(linha.value.em).getTime())).toBe(true);
    expect(JSON.stringify(h.upserts)).not.toMatch(/5511988880001|Maria/);
    expect(h.info).toHaveBeenCalledWith('cron', 'agentes-5040/vivo rodou', { ligado: true, conversas_vistas: 4, elegiveis: 2, enviadas: 1, parou: null });
    expect(JSON.stringify(h.info.mock.calls)).not.toMatch(/5511988880001|Maria/);
  });

  it('tudo desligado: só o log, nada no banco', async () => {
    h.relatorio = relatorio({ ligado: false, conversasVistas: 0, elegiveis: 0, enviadas: 0, decisoes: [], motivo: 'nenhuma dona ligada na rodada' });
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(0);
    expect(h.info).toHaveBeenCalledWith('cron', 'agentes-5040/vivo rodou', expect.objectContaining({ ligado: false }));
  });

  it('rodada seca (?dry=1) não grava nem loga o "rodou"', async () => {
    h.relatorio = relatorio({ dry: true });
    await chamar('?dry=1');
    expect(h.rodou).toHaveBeenCalledWith({ dry: true });
    expect(h.upserts).toHaveLength(0);
    expect(h.info).not.toHaveBeenCalled();
  });

  it('falha da gravação (erro devolvido ou exceção) não derruba a rota', async () => {
    h.upsertErro = { code: '57014', message: 'timeout com detalhe' };
    expect((await chamar()).status).toBe(200);
    expect(h.warn).toHaveBeenCalledWith('cron', expect.stringContaining('rastro não gravado'), { code: '57014' });
    h.warn.mockClear(); h.upsertErro = null; h.upsertLanca = true;
    expect((await chamar()).status).toBe(200);
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it('sem o segredo do cron: 401 e nada roda', async () => {
    const res = await request(app).get('/cron/agentes-5040/vivo');
    expect(res.status).toBe(401);
    expect(h.rodou).not.toHaveBeenCalled();
  });
});
