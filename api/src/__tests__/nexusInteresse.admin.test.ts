import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Leitura do /admin e proteção das rotas. Cliente principal falso: só from().select()...range().eq().
const h = vi.hoisted(() => ({
  paginas: [] as any[][], // cada await da lista tira uma página daqui (fila vazia = página vazia)
  listaErro: null as any,
  filtros: [] as Array<[string, any]>,
  ordens: [] as Array<[string, any]>,
  ranges: [] as Array<[number, number]>,
  froms: [] as string[],
  selecoes: [] as string[],
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      h.froms.push(t);
      return {
        select: (c: string) => {
          h.selecoes.push(c);
          const q: any = {
            order: (col: string, o: any) => { h.ordens.push([col, o]); return q; },
            range: (a: number, b: number) => { h.ranges.push([a, b]); return q; },
            eq: (col: string, v: any) => { h.filtros.push([col, v]); return q; },
            then: (ok: any, ko: any) =>
              Promise.resolve({ data: h.listaErro ? null : (h.paginas.shift() ?? []), error: h.listaErro }).then(ok, ko),
          };
          return q;
        },
      };
    },
  },
}));

import { cadastrarInteresse, listarInteressesAdmin, nexusInteresseLimiter } from '../routes/nexusInteresse';

beforeEach(() => {
  h.paginas.length = 0;
  h.listaErro = null;
  h.filtros.length = 0;
  h.ordens.length = 0;
  h.ranges.length = 0;
  h.froms.length = 0;
  h.selecoes.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET admin: listarInteressesAdmin', () => {
  function resposta() {
    const res: any = { statusCode: 200, corpo: undefined as any };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: any) => { res.corpo = b; return res; };
    return res;
  }
  const linhas = (n: number, de = 0) => Array.from({ length: n }, (_, i) => ({ id: de + i }));

  it('por padrão só os de produção, mais novos primeiro, uma página curta', async () => {
    h.paginas = [[{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }]];
    const res = resposta();
    await listarInteressesAdmin({ query: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.corpo).toEqual({ ok: true, itens: [{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }] });
    expect(h.froms).toEqual(['nexus_instagram_interesse']);
    expect(h.ordens).toEqual([['criado_em', { ascending: false }], ['id', { ascending: false }]]);
    expect(h.ranges).toEqual([[0, 999]]);
    expect(h.filtros).toEqual([['teste', false]]);
  });

  it('devolve a linha inteira, com eletroposto_respostas e whatsapp_ok (select *)', async () => {
    const linha = { id: 3, eletroposto_respostas: { cotista: { local: 'meu' } }, whatsapp_ok: false };
    h.paginas = [[linha]];
    const res = resposta();
    await listarInteressesAdmin({ query: {} } as any, res);
    expect(res.corpo.itens[0]).toEqual(linha);
    expect(h.selecoes).toEqual(['*']);
  });

  it('com teste=1 traz também os de teste (sem filtro)', async () => {
    h.paginas = [[{ id: 9, teste: true }]];
    const res = resposta();
    await listarInteressesAdmin({ query: { teste: '1' } } as any, res);
    expect(res.corpo).toEqual({ ok: true, itens: [{ id: 9, teste: true }] });
    expect(h.filtros).toEqual([]);
  });

  it('teste com outro valor continua filtrando', async () => {
    const res = resposta();
    await listarInteressesAdmin({ query: { teste: '0' } } as any, res);
    expect(h.filtros).toEqual([['teste', false]]);
  });

  it('pagina de 1000 em 1000 até vir página curta', async () => {
    h.paginas = [linhas(1000), linhas(1000, 1000), linhas(37, 2000)];
    const res = resposta();
    await listarInteressesAdmin({ query: {} } as any, res);
    expect(res.corpo.itens).toHaveLength(2037);
    expect(h.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('para em 5000 linhas mesmo com páginas cheias', async () => {
    h.paginas = Array.from({ length: 8 }, (_, i) => linhas(1000, i * 1000));
    const res = resposta();
    await listarInteressesAdmin({ query: {} } as any, res);
    expect(res.corpo.itens).toHaveLength(5000);
    expect(h.ranges).toHaveLength(5);
    expect(h.ranges[4]).toEqual([4000, 4999]);
  });

  it('banco sem dados devolve lista vazia', async () => {
    const res = resposta();
    await listarInteressesAdmin({ query: {} } as any, res);
    expect(res.corpo).toEqual({ ok: true, itens: [] });
  });

  it('erro do banco é 500 com log só de código e mensagem', async () => {
    h.listaErro = { message: 'boom', code: 'XX002' };
    const res = resposta();
    await listarInteressesAdmin({ query: {} } as any, res);
    expect(res.statusCode).toBe(500);
    expect(res.corpo.ok).toBe(false);
    expect(typeof res.corpo.erro).toBe('string');
    expect(console.error).toHaveBeenCalledWith('[nexus-interesse]', 'XX002', 'boom');
  });
});

describe('proteção das rotas no router de ioEletroposto', () => {
  async function handlersDa(metodo: 'get' | 'post', caminho: string) {
    const mod = await import('../routes/ioEletroposto');
    const pilha = (mod.default as any).stack as any[];
    const camada = pilha.find((x) => x.route && x.route.path === caminho && x.route.methods[metodo]);
    expect(camada, `rota ${metodo.toUpperCase()} ${caminho} registrada`).toBeTruthy();
    return camada.route.stack.map((s: any) => s.handle) as Function[];
  }

  it('GET /nexus-instagram/admin: authMiddleware, adminMiddleware e só então o handler', async () => {
    const { authMiddleware } = await import('../middleware/auth');
    const { adminMiddleware } = await import('../middleware/adminAuth');
    expect(await handlersDa('get', '/nexus-instagram/admin'))
      .toEqual([authMiddleware, adminMiddleware, listarInteressesAdmin]);
  }, 60000);

  it('POST /nexus-interesse: limitador antes do handler público', async () => {
    expect(await handlersDa('post', '/nexus-interesse')).toEqual([nexusInteresseLimiter, cadastrarInteresse]);
  }, 60000);
});

describe('limitador do POST público', () => {
  it('10 por minuto por IP, o 11º é 429 com a frase combinada', async () => {
    const a = express();
    a.use(express.json());
    a.post('/x', nexusInteresseLimiter, (_req, res) => { res.json({ ok: true }); });
    for (let i = 0; i < 10; i++) expect((await request(a).post('/x').send({})).status).toBe(200);
    const r = await request(a).post('/x').send({});
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ ok: false, erro: 'Muitas tentativas. Espere um minuto e tente de novo.' });
  });
});
