import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /admin/loja-pix: cobranças da loja no Pix (produto_cobrancas) por produto e as últimas 20.
// Só leitura, e NUNCA devolve CPF, e-mail, telefone nem dado de pagamento: da pessoa só o primeiro nome.

const h = vi.hoisted(() => ({
  cobrancas: [] as unknown[], usuarios: [] as unknown[], selects: [] as string[], gtes: [] as Array<[string, unknown]>,
  erro: false,
}));

function consulta(tabela: string) {
  const q: any = {
    select: (cols: string) => { h.selects.push(`${tabela}:${cols}`); return q; },
    gte: (c: string, v: unknown) => { h.gtes.push([c, v]); return q; },
    in: () => (tabela === 'users' ? Promise.resolve({ data: h.usuarios, error: null }) : q),
    order: () => q,
    range: (de: number, ate: number) => Promise.resolve(
      h.erro ? { data: null, error: { message: 'falhou' } } : { data: h.cobrancas.slice(de, ate + 1), error: null },
    ),
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

const linha = (produto: string, status: string, valor: number, userId: string | null, criado: string) =>
  ({ user_id: userId, produto, valor, status, criado_em: criado });

describe('GET /admin/loja-pix', () => {
  beforeEach(() => { h.cobrancas = []; h.usuarios = []; h.selects = []; h.gtes = []; h.erro = false; });

  it('conta geradas, pagas e valor pago por produto, com o nome do catálogo', async () => {
    h.cobrancas = [
      linha('offgrid', 'pago', 97, 'u1', '2026-11-11T12:00:00Z'),
      linha('offgrid', 'pendente', 97, 'u2', '2026-11-11T11:00:00Z'),
      linha('offgrid', 'reembolsado', 97, 'u3', '2026-11-10T11:00:00Z'),
      linha('curso-limpapro', 'pago', 47, null, '2026-11-10T10:00:00Z'),
    ];
    h.usuarios = [{ id: 'u1', nome: 'Maria da Silva' }];
    const r = await request(app).get('/admin/loja-pix?period=30d');
    expect(r.status).toBe(200);
    expect(r.body.period).toBe('30d');
    const off = r.body.por_produto.find((p: { slug: string }) => p.slug === 'offgrid');
    expect(off).toMatchObject({ nome: 'Venda Off-Grid', geradas: 3, pagas: 1, valor_pago: 97 });
    const sem = r.body.por_produto.find((p: { slug: string }) => p.slug === 'inventario');
    expect(sem).toMatchObject({ geradas: 0, pagas: 0, valor_pago: 0 });
    expect(r.body.total).toEqual({ geradas: 4, pagas: 2, valor_pago: 144 });
    expect(r.body.ultimas).toHaveLength(4);
    expect(r.body.ultimas[0]).toMatchObject({ slug: 'offgrid', status: 'pago', valor: 97, primeiro_nome: 'Maria' });
    expect(r.body.ultimas[3].primeiro_nome).toBeNull();
  });

  it('devolve só as 20 últimas e período inválido vira 7d', async () => {
    h.cobrancas = Array.from({ length: 25 }, (_, i) => linha('offgrid', 'pendente', 97, null, `2026-11-${String(11 - (i % 9)).padStart(2, '0')}T10:00:00Z`));
    const r = await request(app).get('/admin/loja-pix?period=1000d');
    expect(r.status).toBe(200);
    expect(r.body.period).toBe('7d');
    expect(r.body.ultimas).toHaveLength(20);
    expect(r.body.total.geradas).toBe(25);
  });

  it('nunca pede nem devolve CPF, QR, e-mail ou telefone', async () => {
    h.cobrancas = [linha('offgrid', 'pago', 97, 'u1', '2026-11-11T12:00:00Z')];
    (h.cobrancas[0] as Record<string, unknown>).cpf = '52998224725';
    (h.cobrancas[0] as Record<string, unknown>).qr_payload = '000201...';
    h.usuarios = [{ id: 'u1', nome: 'Maria Souza', email: 'maria@x.com', whatsapp: '5511999999999' }];
    const r = await request(app).get('/admin/loja-pix?period=7d');
    const texto = JSON.stringify(r.body);
    for (const proibido of ['52998224725', '000201', 'maria@x.com', '5511999999999', 'cpf', 'email', 'whatsapp', 'qr_']) {
      expect(texto, proibido).not.toContain(proibido);
    }
    const colunas = h.selects.join(' | ');
    expect(colunas).not.toMatch(/cpf|qr_|email|whatsapp|asaas/);
  });

  it('janela do período: 7d filtra criado_em dos últimos 7 dias', async () => {
    const antes = Date.now();
    await request(app).get('/admin/loja-pix?period=7d');
    const [coluna, desde] = h.gtes[0];
    expect(coluna).toBe('criado_em');
    const dias = (antes - Date.parse(String(desde))) / 86_400_000;
    expect(dias).toBeGreaterThan(6.99);
    expect(dias).toBeLessThan(7.01);
  });

  it('responde 500 se a leitura falhar', async () => {
    h.erro = true;
    const r = await request(app).get('/admin/loja-pix');
    expect(r.status).toBe(500);
  });
});
