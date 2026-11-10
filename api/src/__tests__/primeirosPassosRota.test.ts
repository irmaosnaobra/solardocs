import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rotas de /primeiros-passos (09/11/2026): o GET devolve a fonte única; o PUT do WhatsApp valida e normaliza como o cadastro (authController.register).

const H = vi.hoisted(() => ({ gravado: [] as any[], erro: null as null | { message: string }, passos: null as any, donos: [] as any[], erroBusca: null as null | { message: string }, buscas: [] as any[] }));
vi.mock('../utils/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ in: (c: string, vs: string[]) => ({ neq: (c2: string, v: string) => ({ limit: async () => { H.buscas.push({ c, vs, c2, v }); return { data: H.erroBusca ? null : H.donos, error: H.erroBusca }; } }) }) }),
    update: (p: any) => ({ eq: async (c: string, v: string) => { H.gravado.push({ p, c, v }); return { error: H.erro }; } }) }) },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/solardoc/primeirosPassos', () => ({
  carregarPassos: vi.fn(async () => { if (H.passos === 'lanca') throw new Error('banco fora'); return H.passos; }),
}));

import { getPrimeirosPassos, putPrimeirosPassosWhatsapp } from '../controllers/primeirosPassosController';

function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const req = (body?: unknown): any => ({ userId: 'u1', body });

beforeEach(() => { H.gravado.length = 0; H.erro = null; H.passos = null; H.donos = []; H.erroBusca = null; H.buscas.length = 0; });

describe('PUT /primeiros-passos/whatsapp', () => {
  it('normaliza para só dígitos e grava em users.whatsapp', async () => {
    const r = res();
    await putPrimeirosPassosWhatsapp(req({ whatsapp: '(34) 99999-0001' }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, whatsapp: '34999990001' });
    expect(H.gravado).toEqual([{ p: { whatsapp: '34999990001' }, c: 'id', v: 'u1' }]);
  });
  it('aceita DDD + 8 dígitos (fixo)', async () => {
    const r = res();
    await putPrimeirosPassosWhatsapp(req({ whatsapp: '3433334444' }), r);
    expect(r.body).toEqual({ ok: true, whatsapp: '3433334444' });
  });
  it.each([undefined, '', '123', '349999900011', 'abc', null, { a: 1 }])('recusa %j com 400 em português, sem gravar', async (v) => {
    const r = res();
    await putPrimeirosPassosWhatsapp(req({ whatsapp: v }), r);
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'WhatsApp deve ter DDD + 8 ou 9 dígitos' });
    expect(H.gravado).toHaveLength(0);
  });
  it('número que já é de OUTRA conta: 409 em português e não grava; a busca usa as variantes do número e exclui a própria conta', async () => {
    H.donos = [{ id: 'u9' }];
    const r = res();
    await putPrimeirosPassosWhatsapp(req({ whatsapp: '(34) 99999-0001' }), r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'Esse WhatsApp já está em outra conta. Fale com o suporte.' });
    expect(H.gravado).toHaveLength(0);
    expect(H.buscas[0]).toMatchObject({ c: 'whatsapp', c2: 'id', v: 'u1' });
    expect(H.buscas[0].vs).toEqual(expect.arrayContaining(['34999990001', '5534999990001']));
  });
  it('não deu para conferir o dono do número: 500 e não grava', async () => {
    H.erroBusca = { message: 'x' };
    const r = res();
    await putPrimeirosPassosWhatsapp(req({ whatsapp: '34999990001' }), r);
    expect(r.statusCode).toBe(500);
    expect(H.gravado).toHaveLength(0);
  });
  it('erro do banco vira 500 com mensagem em português', async () => {
    H.erro = { message: 'x' };
    const r = res();
    await putPrimeirosPassosWhatsapp(req({ whatsapp: '34999990001' }), r);
    expect(r.statusCode).toBe(500);
    expect(String((r.body as any).error)).toMatch(/Não foi possível salvar/);
  });
});

describe('GET /primeiros-passos', () => {
  it('devolve o objeto da fonte única', async () => {
    H.passos = { passos: [], proximo: 'empresa', feitos: 0, total: 4, tudoPronto: false, pago: false };
    const r = res();
    await getPrimeirosPassos(req(), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe(H.passos);
  });
  it('usuário que não existe: 404; leitura que lança: 500', async () => {
    const a = res(); await getPrimeirosPassos(req(), a); expect(a.statusCode).toBe(404);
    H.passos = 'lanca';
    const b = res(); await getPrimeirosPassos(req(), b); expect(b.statusCode).toBe(500);
  });
});
