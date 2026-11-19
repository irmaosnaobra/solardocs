import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Cliente principal falso: rpc() e from().select().eq() (contagem do honeypot)
// e from().select().order().order().range().eq() (leitura paginada do admin).
const h = vi.hoisted(() => ({
  rpcChamadas: [] as Array<{ nome: string; args: Record<string, any> }>,
  rpcResposta: { data: { posicao: 7, novo: true }, error: null } as { data: any; error: any },
  rpcLanca: false,
  contagem: { count: 41, error: null } as { count: number | null; error: any },
  paginas: [] as any[][], // cada await da lista do admin tira uma página daqui (fila vazia = página vazia)
  listaErro: null as any,
  filtros: [] as Array<[string, any]>,
  ordens: [] as Array<[string, any]>,
  ranges: [] as Array<[number, number]>,
  froms: [] as string[],
}));

function consulta(tipo: 'contagem' | 'lista') {
  const q: any = {
    select: () => q,
    order: (c: string, o: any) => { h.ordens.push([c, o]); return q; },
    range: (a: number, b: number) => { h.ranges.push([a, b]); return q; },
    eq: (c: string, v: any) => { h.filtros.push([c, v]); return q; },
    then: (ok: any, ko: any) =>
      Promise.resolve(
        tipo === 'contagem'
          ? h.contagem
          : { data: h.listaErro ? null : (h.paginas.shift() ?? []), error: h.listaErro },
      ).then(ok, ko),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({
  supabase: {
    rpc: (nome: string, args: Record<string, any>) => {
      h.rpcChamadas.push({ nome, args });
      if (h.rpcLanca) return Promise.reject(new Error('rede'));
      return Promise.resolve(h.rpcResposta);
    },
    from: (t: string) => {
      h.froms.push(t);
      // O select de contagem do honeypot passa head:true; a lista do admin não.
      return {
        select: (_c: string, o?: { head?: boolean }) => consulta(o?.head ? 'contagem' : 'lista').select(),
      };
    },
  },
}));

import { cadastrarInteresse, listarInteressesAdmin, nexusInteresseLimiter } from '../routes/nexusInteresse';

const app = express();
app.use(express.json());
app.post('/nexus-interesse', cadastrarInteresse);

const base = {
  eletroposto: ['cotista'],
  mobilidade: ['moto'],
  objetivo: 'proprio',
  investimento: '10_50',
  recurso: 'os_dois',
  nome: 'Maria Souza',
  telefone: '55 (34) 99999-0001',
  email: 'Maria@Exemplo.com',
  cidade: 'Uberlândia',
  uf: 'mg',
};
const post = (b: object) => request(app).post('/nexus-interesse').send(b);

beforeEach(() => {
  h.rpcChamadas.length = 0;
  h.rpcResposta = { data: { posicao: 7, novo: true }, error: null };
  h.rpcLanca = false;
  h.contagem = { count: 41, error: null };
  h.paginas.length = 0;
  h.listaErro = null;
  h.filtros.length = 0;
  h.ordens.length = 0;
  h.ranges.length = 0;
  h.froms.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function recusa(corpo: object) {
  const r = await post(corpo);
  expect(r.status).toBe(400);
  expect(r.body.ok).toBe(false);
  expect(r.body.erro).toMatch(/^[A-ZÁÉÍÓÚÂÊÔ]/);
  expect(r.body.erro).not.toMatch(/—|–/);
  expect(h.rpcChamadas).toHaveLength(0);
  return r;
}

describe('POST /nexus-interesse: validação', () => {
  it('base válida grava e devolve posição', async () => {
    const r = await post(base);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, posicao: 7, novo: true });
  });

  it('nada marcado e sem outro é 400 com a frase certa', async () => {
    const r = await recusa({ ...base, eletroposto: [], mobilidade: [] });
    expect(r.body.erro).toBe('Marque pelo menos uma opção ou escreva o que procura.');
    await recusa({ ...base, eletroposto: ['foguete'], mobilidade: ['nave'], outro: '   ' });
  });

  it('só o campo outro preenchido basta', async () => {
    const r = await post({ ...base, eletroposto: [], mobilidade: [], outro: ' ônibus elétrico ' });
    expect(r.status).toBe(200);
    expect(h.rpcChamadas[0].args.p_outro).toBe('ônibus elétrico');
  });

  it('objetivo, investimento e recurso inválidos ou ausentes são 400', async () => {
    await recusa({ ...base, objetivo: 'lazer' });
    await recusa({ ...base, objetivo: undefined });
    await recusa({ ...base, investimento: '1000_mais' });
    await recusa({ ...base, investimento: undefined });
    await recusa({ ...base, recurso: 'cripto' });
    await recusa({ ...base, recurso: undefined });
  });

  it('aceita todos os valores válidos dos enums', async () => {
    for (const objetivo of ['proprio', 'frota', 'revenda', 'investir']) {
      expect((await post({ ...base, objetivo })).status).toBe(200);
    }
    for (const investimento of ['ate_10', '10_50', '50_100', '100_250', '250_500', '500_mais', 'naosei']) {
      expect((await post({ ...base, investimento })).status).toBe(200);
    }
    for (const recurso of ['proprio', 'financiamento', 'os_dois', 'naosei']) {
      expect((await post({ ...base, recurso })).status).toBe(200);
    }
  });

  it('nome curto ou longo é 400', async () => {
    await recusa({ ...base, nome: 'A' });
    await recusa({ ...base, nome: 'x'.repeat(81) });
  });

  it('telefone ruim é 400', async () => {
    await recusa({ ...base, telefone: '34999990001' });
    await recusa({ ...base, telefone: '123' });
  });

  it('e-mail ausente, sem domínio ou longo demais é 400', async () => {
    await recusa({ ...base, email: undefined });
    await recusa({ ...base, email: 'maria@exemplo' });
    await recusa({ ...base, email: 'maria exemplo@x.com' });
    await recusa({ ...base, email: `${'a'.repeat(120)}@x.com` });
  });

  it('cidade ausente é 400', async () => {
    await recusa({ ...base, cidade: undefined });
    await recusa({ ...base, cidade: '   ' });
  });

  it('uf ausente ou inexistente é 400', async () => {
    await recusa({ ...base, uf: undefined });
    await recusa({ ...base, uf: 'XX' });
    await recusa({ ...base, uf: 'MGG' });
  });

  it('cep com tamanho errado é 400, vazio passa', async () => {
    await recusa({ ...base, cep: '38400' });
    expect((await post({ ...base, cep: '' })).status).toBe(200);
    expect((await post({ ...base, cep: '38400-000' })).status).toBe(200);
    expect(h.rpcChamadas[1].args.p_cep).toBe('38400000');
  });

  it('tipo errado em qualquer campo é 400 e nunca 500', async () => {
    await recusa({ ...base, nome: { a: 1 } });
    await recusa({ ...base, telefone: 5534999990001 });
    await recusa({ ...base, email: ['a@b.com'] });
    await recusa({ ...base, cidade: 123 });
    await recusa({ ...base, uf: ['MG'] });
    await recusa({ ...base, objetivo: ['proprio'] });
    await recusa({ ...base, investimento: 10 });
    await recusa({ ...base, recurso: { x: 1 } });
    await recusa({ ...base, eletroposto: 'cotista', mobilidade: 'moto' });
    await recusa({ ...base, eletroposto: [{ a: 1 }, 5, null], mobilidade: [[], true], outro: { a: 1 } });
  });

  it('corpo vazio é 400', async () => {
    const r = await request(app).post('/nexus-interesse').send({});
    expect(r.status).toBe(400);
  });
});

describe('POST /nexus-interesse: gravação', () => {
  it('honeypot preenchido responde ok com contagem+1 e não chama a rpc', async () => {
    const r = await post({ ...base, site: 'http://spam.com' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, posicao: 42, novo: true });
    expect(h.rpcChamadas).toHaveLength(0);
    expect(h.froms).toEqual(['nexus_instagram_interesse']);
    expect(h.filtros).toEqual([['teste', false]]);
  });

  it('honeypot com contagem falha responde posição 1', async () => {
    h.contagem = { count: null, error: { message: 'boom' } };
    const r = await post({ ...base, site: 'x' });
    expect(r.body).toEqual({ ok: true, posicao: 1, novo: true });
    expect(h.rpcChamadas).toHaveLength(0);
  });

  it('manda à rpc os parâmetros normalizados', async () => {
    const r = await post({
      ...base,
      eletroposto: ['cotista', 'foguete', 'cotista', 'parceiro'],
      mobilidade: ['moto', 'nave', 'solar'],
      endereco: ' Rua A, 10 ',
      bairro: 'Centro',
      cep: '38400-000',
      origem: 'bio-instagram',
      utm: { source: 'ig', medium: 'bio', lixo: 'x', campaign: 5 },
      teste: true, // o corpo é ignorado: só a faixa fictícia de telefone marca teste
    });
    expect(r.status).toBe(200);
    expect(h.rpcChamadas).toHaveLength(1);
    const { nome, args } = h.rpcChamadas[0];
    expect(nome).toBe('nexus_instagram_gravar');
    expect(args).toEqual({
      p_nome: 'Maria Souza',
      p_telefone: '5534999990001',
      p_email: 'maria@exemplo.com',
      p_cep: '38400000',
      p_endereco: 'Rua A, 10',
      p_bairro: 'Centro',
      p_cidade: 'Uberlândia',
      p_uf: 'MG',
      p_eletroposto: ['cotista', 'parceiro'],
      p_mobilidade: ['moto', 'solar'],
      p_outro: null,
      p_objetivo: 'proprio',
      p_investimento: '10_50',
      p_recurso: 'os_dois',
      p_origem: 'bio-instagram',
      p_utm: { source: 'ig', medium: 'bio' },
      p_teste: false,
    });
  });

  it('teste só pela faixa fictícia de telefone, nunca pelo corpo', async () => {
    for (const telefone of ['5534900000000', '5534900000099', '553490000012']) {
      h.rpcChamadas.length = 0;
      expect((await post({ ...base, telefone })).status).toBe(200);
      expect(h.rpcChamadas[0].args.p_teste).toBe(true);
    }
    for (const telefone of ['5534999990001', '5534900001000', '5511900000000']) {
      h.rpcChamadas.length = 0;
      expect((await post({ ...base, telefone, teste: true })).status).toBe(200);
      expect(h.rpcChamadas[0].args.p_teste).toBe(false);
    }
  });

  it('sem opcionais manda null e teste false', async () => {
    await post(base);
    const a = h.rpcChamadas[0].args;
    expect(a.p_cep).toBeNull();
    expect(a.p_endereco).toBeNull();
    expect(a.p_bairro).toBeNull();
    expect(a.p_outro).toBeNull();
    expect(a.p_origem).toBeNull();
    expect(a.p_utm).toBeNull();
    expect(a.p_teste).toBe(false);
  });

  it('corta cada array em 30 itens antes de filtrar', async () => {
    const lixo = Array.from({ length: 30 }, () => 'lixo');
    const r = await post({ ...base, eletroposto: [...lixo, 'cotista'], mobilidade: ['moto'] });
    expect(r.status).toBe(200);
    expect(h.rpcChamadas[0].args.p_eletroposto).toEqual([]);
  });

  it('cidade e uf separadas, com a UF digitada valendo', async () => {
    await post({ ...base, cidade: 'uberlandia', uf: 'MG' });
    const a = h.rpcChamadas[0].args;
    expect(a.p_uf).toBe('MG');
    expect(a.p_cidade).not.toMatch(/-MG$/);
    expect(a.p_cidade.toLowerCase()).toContain('uberl');
  });

  it('posicao vem da rpc e novo é sempre true (não revela telefone repetido)', async () => {
    h.rpcResposta = { data: { posicao: 3, novo: false }, error: null };
    const r = await post(base);
    expect(r.body).toEqual({ ok: true, posicao: 3, novo: true });
  });

  it('erro da rpc é 500 com frase fixa e log só com código e mensagem', async () => {
    h.rpcResposta = { data: null, error: { message: 'boom', code: 'XX001' } };
    const r = await post(base);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ ok: false, erro: 'Não deu para salvar agora. Tente de novo em instantes.' });
    expect(console.error).toHaveBeenCalledWith('[nexus-interesse]', 'XX001', 'boom');
    expect(JSON.stringify((console.error as any).mock.calls)).not.toMatch(/5534|maria@/i);
  });

  it('rpc que lança também é 500', async () => {
    h.rpcLanca = true;
    const r = await post(base);
    expect(r.status).toBe(500);
    expect(r.body.ok).toBe(false);
  });
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
