import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/produtos-loja?produto=<id>: leitura de `entitlements` por produto.
// Produtos aceitos: só os que o acessos.ts lê de entitlements (offgrid, precificacao, inventario).

type Chamada = { tabela: string; metodo: string; args: unknown[] };

const h = vi.hoisted(() => ({
  entitlements: [] as unknown[],
  users: [] as unknown[],
  chamadas: [] as Array<{ tabela: string; metodo: string; args: unknown[] }>,
  erroEm: null as string | null,   // tabela cujo resultado devolve { error }
}));

function consulta(tabela: string) {
  const linhas = () => (tabela === 'entitlements' ? h.entitlements : tabela === 'users' ? h.users : []);
  let head = false;
  const reg = (metodo: string, args: unknown[]) => { h.chamadas.push({ tabela, metodo, args }); };
  const resultado = () => {
    if (h.erroEm === tabela) return { data: null, count: null, error: { message: 'segredo interno do banco' } };
    return head ? { data: null, count: linhas().length, error: null } : { data: linhas(), error: null };
  };
  const q: any = {
    select: (c: string, opts?: { head?: boolean }) => { head = !!opts?.head; reg('select', [c, opts]); return q; },
    eq: (...a: unknown[]) => { reg('eq', a); return q; },
    or: (...a: unknown[]) => { reg('or', a); return q; },
    gte: (...a: unknown[]) => { reg('gte', a); return q; },
    in: (...a: unknown[]) => { reg('in', a); return q; },
    order: (...a: unknown[]) => { reg('order', a); return q; },
    limit: (...a: unknown[]) => { reg('limit', a); return Promise.resolve(resultado()); },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, ko),
  };
  return q;
}

vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => consulta(t) } }));

import adminRouter from '../routes/admin';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

const doEnt = (metodo: string): Chamada[] => h.chamadas.filter((c) => c.tabela === 'entitlements' && c.metodo === metodo);

beforeEach(() => { h.chamadas.length = 0; h.erroEm = null; h.entitlements = []; h.users = []; });

describe('GET /admin/produtos-loja', () => {
  it('produto fora da lista dá 400, inclusive os cursos (acesso lido de outras tabelas)', async () => {
    const r = await request(app).get('/admin/produtos-loja?produto=qualquer');
    expect(r.status).toBe(400);
    for (const curso of ['curso-fechamento', 'curso-limpapro']) {
      expect((await request(app).get(`/admin/produtos-loja?produto=${curso}`)).status).toBe(400);
    }
    const sem = await request(app).get('/admin/produtos-loja');
    expect(sem.status).toBe(400);
  });

  it('produto válido devolve total, ultimos30 e itens com nome e e-mail', async () => {
    h.entitlements = [{ user_id: 'u1', origem: 'compra', desde: '2026-11-01T10:00:00Z', expira_em: null }];
    h.users = [{ id: 'u1', nome: 'Ana', email: 'ana@exemplo.com' }];
    const r = await request(app).get('/admin/produtos-loja?produto=offgrid');
    expect(r.status).toBe(200);
    expect(r.body.produto).toBe('offgrid');
    expect(r.body.total).toBe(1);
    expect(r.body.ultimos30).toBe(1);
    expect(r.body.itens).toEqual([
      { user_id: 'u1', nome: 'Ana', email: 'ana@exemplo.com', origem: 'compra', desde: '2026-11-01T10:00:00Z' },
    ]);
    expect(doEnt('eq')).toContainEqual({ tabela: 'entitlements', metodo: 'eq', args: ['produto', 'offgrid'] });
  });

  it('sem acessos devolve zeros e lista vazia', async () => {
    const r = await request(app).get('/admin/produtos-loja?produto=inventario');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 0, ultimos30: 0, itens: [] });
  });

  it('as 3 consultas só contam acesso ativo: expira_em nulo ou no futuro', async () => {
    const antes = Date.now();
    await request(app).get('/admin/produtos-loja?produto=precificacao');
    const ors = doEnt('or');
    expect(ors).toHaveLength(3);
    for (const o of ors) {
      const m = /^expira_em\.is\.null,expira_em\.gt\.(.+)$/.exec(String(o.args[0]));
      expect(m, String(o.args[0])).not.toBeNull();
      const limite = new Date(m![1]).getTime();
      expect(limite).toBeGreaterThanOrEqual(antes - 1000);
      expect(limite).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it('ultimos30 usa desde >= agora menos 30 dias', async () => {
    const antes = Date.now();
    await request(app).get('/admin/produtos-loja?produto=offgrid');
    const gtes = doEnt('gte');
    expect(gtes).toHaveLength(1);
    expect(gtes[0].args[0]).toBe('desde');
    const corte = new Date(String(gtes[0].args[1])).getTime();
    const esperado = antes - 30 * 86400_000;
    expect(Math.abs(corte - esperado)).toBeLessThan(5000);
  });

  it('a lista vem em ordem de desde decrescente com limite 20', async () => {
    await request(app).get('/admin/produtos-loja?produto=offgrid');
    expect(doEnt('order')).toEqual([{ tabela: 'entitlements', metodo: 'order', args: ['desde', { ascending: false }] }]);
    expect(doEnt('limit')).toEqual([{ tabela: 'entitlements', metodo: 'limit', args: [20] }]);
  });

  it.each(['entitlements', 'users'])('erro do Supabase em %s dá 500 sem a mensagem interna', async (tabela) => {
    h.entitlements = [{ user_id: 'u1', origem: 'compra', desde: '2026-11-01T10:00:00Z', expira_em: null }];
    h.erroEm = tabela;
    const r = await request(app).get('/admin/produtos-loja?produto=offgrid');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Erro ao ler produtos da loja' });
    expect(JSON.stringify(r.body)).not.toContain('segredo interno');
  });
});
