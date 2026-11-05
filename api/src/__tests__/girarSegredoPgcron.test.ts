import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/db', () => ({ default: { connect: (...a: unknown[]) => h.connect(...a) } }));

import { girarSegredoPgcron } from '../services/girarSegredoPgcron';
import cronRouter from '../routes/cron';

const VELHO = 'velho-falso-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOVO = 'novo-falso-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

interface Opcoes { jobs?: number[]; vaultN?: number; vaultErro?: boolean; sobra?: number; erroEm?: RegExp }

function fabrica(o: Opcoes = {}) {
  const sqls: string[] = [];
  let liberou = 0;
  const jobs = o.jobs ?? [11, 12];
  const client = {
    release: () => { liberou++; },
    query: async (sql: string, params?: unknown[]) => {
      sqls.push(sql);
      if (o.erroEm && o.erroEm.test(sql)) throw Object.assign(new Error(`boom ${VELHO}`), { code: 'XX000' });
      if (/current_user/.test(sql)) return { rows: [{ papel: 'postgres', banco: 'postgres' }] };
      if (/as visiveis/.test(sql)) return { rows: [{ visiveis: 5 }] };
      if (/as url from cron\.job/.test(sql)) {
        return { rows: jobs.map((id) => ({ jobid: id, jobname: `job${id}`, schedule: '* * * * *', active: true, url: 'https://api.solardoc.app/cron/x' })) };
      }
      if (/vault\.decrypted_secrets where/.test(sql) && /count/.test(sql)) {
        if (o.vaultErro) throw Object.assign(new Error('sem vault'), { code: '3F000' });
        return { rows: [{ n: o.vaultN ?? 0 }] };
      }
      if (/count\(\*\)::int as n from cron\.job where position/.test(sql)) {
        return { rows: [{ n: params?.[0] === VELHO ? (o.sobra ?? 0) : jobs.length }] };
      }
      return { rows: [] };
    },
  };
  return { pool: { connect: async () => client }, sqls, liberou: () => liberou };
}
const chamou = (sqls: string[], re: RegExp) => sqls.filter((s) => re.test(s)).length;

describe('girarSegredoPgcron', () => {
  it('simulação não troca nada e termina em rollback', async () => {
    const f = fabrica({ vaultN: 1 });
    const r = await girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: false });
    expect(chamou(f.sqls, /alter_job/)).toBe(0);
    expect(chamou(f.sqls, /update_secret/)).toBe(0);
    expect(f.sqls[0]).toBe('begin');
    expect(f.sqls[f.sqls.length - 1]).toBe('rollback');
    expect(chamou(f.sqls, /^commit$/)).toBe(0);
    expect(r).toMatchObject({ aplicado: false, papel: 'postgres', banco: 'postgres', visiveis: 5, vault: 1 });
    expect(r.casaram.map((j) => j.jobid)).toEqual([11, 12]);
    expect(f.liberou()).toBe(1);
  });

  it('o SQL de diagnóstico mantém o \\s da regex e não seleciona o command', async () => {
    const f = fabrica();
    await girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: false });
    const q = f.sqls.find((s) => /as url/.test(s))!;
    expect(q).toContain('\\s');
    expect(q).toContain("substring(command from 'https?://");
  });

  it('aplicar chama alter_job por job e termina em commit', async () => {
    const f = fabrica({ vaultN: 2 });
    const r = await girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: true });
    expect(chamou(f.sqls, /alter_job/)).toBe(2);
    expect(chamou(f.sqls, /update_secret/)).toBe(1);
    expect(f.sqls[f.sqls.length - 1]).toBe('commit');
    expect(r.aplicado).toBe(true);
    expect(r.comNovo).toBe(2);
  });

  it('sem segredo no Vault (0) não chama update_secret', async () => {
    const f = fabrica({ vaultN: 0 });
    await girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: true });
    expect(chamou(f.sqls, /update_secret/)).toBe(0);
  });

  it('sobra com o valor velho faz rollback e lança erro sem commit', async () => {
    const f = fabrica({ sobra: 1 });
    await expect(girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: true })).rejects.toThrow('sobrou job com o valor velho');
    expect(chamou(f.sqls, /^commit$/)).toBe(0);
    expect(f.sqls[f.sqls.length - 1]).toBe('rollback');
    expect(f.liberou()).toBe(1);
  });

  it('erro no Vault não derruba o resto (vault: null)', async () => {
    const f = fabrica({ vaultErro: true });
    const r = await girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: true });
    expect(r.vault).toBeNull();
    expect(r.vaultCodigo).toBe('3F000');
    expect(chamou(f.sqls, /rollback to savepoint v/)).toBe(1);
    expect(chamou(f.sqls, /alter_job/)).toBe(2);
    expect(f.sqls[f.sqls.length - 1]).toBe('commit');
  });

  it('erro qualquer faz rollback, relança e libera o client', async () => {
    const f = fabrica({ erroEm: /alter_job/ });
    await expect(girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: true })).rejects.toThrow();
    expect(f.sqls[f.sqls.length - 1]).toBe('rollback');
    expect(f.liberou()).toBe(1);
  });

  it('nem o resultado nem a mensagem de erro carregam velho ou novo', async () => {
    const f = fabrica({ vaultN: 1 });
    const r = await girarSegredoPgcron(f.pool, { velho: VELHO, novo: NOVO, aplicar: true });
    const txt = JSON.stringify(r);
    expect(txt).not.toContain(VELHO);
    expect(txt).not.toContain(NOVO);
    const msgs: string[] = [];
    for (const args of [{ velho: '', novo: NOVO }, { velho: VELHO, novo: VELHO }, { velho: 'curto', novo: NOVO }]) {
      try { await girarSegredoPgcron(fabrica().pool, { ...args, aplicar: true }); } catch (e: any) { msgs.push(e.message); }
    }
    try { await girarSegredoPgcron(fabrica({ sobra: 1 }).pool, { velho: VELHO, novo: NOVO, aplicar: true }); } catch (e: any) { msgs.push(e.message); }
    expect(msgs).toHaveLength(4);
    for (const m of msgs) { expect(m).not.toContain(VELHO); expect(m).not.toContain(NOVO); }
  });

  it('validação: vazio, igual ou curto lança erro antes de abrir conexão', async () => {
    const f = fabrica();
    const conectar = vi.spyOn(f.pool, 'connect');
    await expect(girarSegredoPgcron(f.pool, { velho: '', novo: NOVO, aplicar: false })).rejects.toThrow();
    await expect(girarSegredoPgcron(f.pool, { velho: VELHO, novo: '', aplicar: false })).rejects.toThrow();
    await expect(girarSegredoPgcron(f.pool, { velho: VELHO, novo: VELHO, aplicar: false })).rejects.toThrow();
    await expect(girarSegredoPgcron(f.pool, { velho: 'curto', novo: NOVO, aplicar: false })).rejects.toThrow();
    await expect(girarSegredoPgcron(f.pool, { velho: VELHO, novo: 'curto', aplicar: false })).rejects.toThrow();
    expect(conectar).not.toHaveBeenCalled();
  });
});

describe('POST /cron/girar-segredo-pgcron', () => {
  const app = express();
  app.use('/cron', cronRouter);
  const GH = 'falso-github-secret-dddddddddddddddddddd';
  const antes = { c: process.env.CRON_SECRET, g: process.env.GITHUB_CRON_SECRET, v: process.env.CRON_SECRET_ANTERIOR };
  const post = (seg?: string, q = '') => {
    const r = request(app).post(`/cron/girar-segredo-pgcron${q}`);
    return seg === undefined ? r : r.set('Authorization', `Bearer ${seg}`);
  };
  beforeEach(() => {
    h.connect.mockReset();
    process.env.CRON_SECRET = NOVO;
    process.env.GITHUB_CRON_SECRET = GH;
    process.env.CRON_SECRET_ANTERIOR = VELHO;
  });
  afterEach(() => {
    for (const [k, v] of [['CRON_SECRET', antes.c], ['GITHUB_CRON_SECRET', antes.g], ['CRON_SECRET_ANTERIOR', antes.v]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('slot CRON_SECRET_ANTERIOR, GITHUB_CRON_SECRET, segredo errado e sem header levam 401 sem tocar no banco', async () => {
    expect((await post(VELHO)).status).toBe(401);
    expect((await post(GH)).status).toBe(401);
    expect((await post('errado')).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('falta de env (ou envs iguais) leva 409', async () => {
    delete process.env.CRON_SECRET_ANTERIOR;
    const r = await post(NOVO);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'sem par de segredos para trocar' });
    process.env.CRON_SECRET_ANTERIOR = NOVO;
    expect((await post(NOVO)).status).toBe(409);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('CRON_SECRET sem ?aplicar=1 simula (rollback) e a resposta não tem os valores', async () => {
    const f = fabrica({ vaultN: 1 });
    h.connect.mockImplementation(f.pool.connect);
    const r = await post(NOVO);
    expect(r.status).toBe(200);
    expect(r.body.aplicado).toBe(false);
    expect(f.sqls[f.sqls.length - 1]).toBe('rollback');
    expect(JSON.stringify(r.body)).not.toContain(VELHO);
    expect(JSON.stringify(r.body)).not.toContain(NOVO);
  });

  it('?aplicar=1 faz commit', async () => {
    const f = fabrica();
    h.connect.mockImplementation(f.pool.connect);
    const r = await post(NOVO, '?aplicar=1');
    expect(r.status).toBe(200);
    expect(r.body.aplicado).toBe(true);
    expect(f.sqls[f.sqls.length - 1]).toBe('commit');
  });

  it('falha do banco devolve 500 só com o código, sem message', async () => {
    h.connect.mockRejectedValue(Object.assign(new Error(`conexão ${VELHO}`), { code: 'ECONNREFUSED' }));
    const r = await post(NOVO);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'falhou', codigo: 'ECONNREFUSED' });
  });
});
