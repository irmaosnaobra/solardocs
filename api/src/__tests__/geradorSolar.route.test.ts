import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rotas do solar no /gerador, com a planilha, o Trello, o login e o banco
// simulados. O que se prova aqui: quem vê o quê, que coluna proibida nunca sai,
// que o cache não vaza resposta de sócio para consultor e que o Trello fora do
// ar não derruba nada.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  estado: new Map<string, unknown>(),
  indicacoes: [] as Array<Record<string, unknown>>,
  colunasIndicacoes: [] as string[],
  csv: '',
  planilhaFora: false,
  trelloFora: false,
  chamadas: { planilha: 0, trello: 0 },
  quadro: { lists: [] as unknown[], cards: [] as unknown[] },
  erroEstado: false,
  naoConfirmados: [] as string[],
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: h.naoConfirmados.includes(token) ? null : '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === 'system_state') {
        return {
          select: () => ({
            in: async (_c: string, chaves: string[]) => {
              if (h.erroEstado) return { data: null, error: { message: 'boom' } };
              return {
                data: chaves.filter((k) => h.estado.has(k)).map((k) => ({ key: k, value: h.estado.get(k) })),
                error: null,
              };
            },
            eq: (_c: string, k: string) => ({
              maybeSingle: async () => ({ data: h.estado.has(k) ? { key: k, value: h.estado.get(k) } : null, error: null }),
            }),
          }),
          upsert: async (linha: { key: string; value: unknown }) => { h.estado.set(linha.key, linha.value); return { error: null }; },
        };
      }
      if (tabela === 'io_indicacoes') {
        return {
          select: (cols: string) => {
            h.colunasIndicacoes = cols.split(',').map((c) => c.trim());
            // O banco devolve SÓ o que foi pedido; este mock devolve tudo,
            // inclusive o pix, para provar que o mapeamento também não deixa passar.
            return { order: () => ({ limit: async () => ({ data: h.indicacoes, error: null }) }) };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  },
}));

import { mountSolar, limparCachesSolar, limitesSolar } from '../routes/geradorSolar';
import { planilhaPadrao, PROIBIDAS, NOMES_PROIBIDOS, CABECALHO, VENDAS, linha, paraCsv } from './solarPlanilhaFixture';

const r = Router();
mountSolar(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const THIAGO = 'Bearer tk-thiago';

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app',
    'tk-thiago': 'thiago@irmaosnaobra.app',
    'tk-diego': 'diego@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app',
    'tk-estranho': 'alguem@gmail.com',
    'tk-acento': 'thiagó@irmaosnaobra.app',
    'tk-naoconf': 'thiago@irmaosnaobra.app',
  };
  h.estado = new Map();
  h.csv = planilhaPadrao();
  h.planilhaFora = false; h.trelloFora = false; h.erroEstado = false;
  h.naoConfirmados = ['tk-naoconf']; h.colunasIndicacoes = [];
  h.chamadas = { planilha: 0, trello: 0 };
  h.quadro = {
    lists: [{ id: 'L1', name: 'PROJETO EM ANALISE' }],
    cards: [{ id: 'c1', name: '#0057 - Ana Souza - Uberlândia MG', idList: 'L1', shortUrl: 'https://trello.com/c/abc123' }],
  };
  h.indicacoes = [{
    indicado_nome: 'Joana Indicada', indicado_telefone: '5534977776666', indicador_nome: 'Cleber',
    indicador_telefone: '5534955554444', indicador_pix: 'PIXSECRETO-123', origem: 'link-bio',
    status: 'novo', created_at: '2026-10-09T12:00:00Z',
  }];
  delete process.env.SOLAR_SOCIOS;
  limparCachesSolar();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('docs.google.com')) {
      h.chamadas.planilha++;
      if (h.planilhaFora) return new Response('erro', { status: 500 });
      return new Response(h.csv, { status: 200 });
    }
    if (String(url).includes('trello.com')) {
      h.chamadas.trello++;
      if (h.trelloFora) throw new Error('rede caiu');
      return new Response(JSON.stringify(h.quadro), { status: 200 });
    }
    throw new Error(`fetch inesperado: ${String(url).split('?')[0]}`);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  limitesSolar.planilhaMs = 15_000; limitesSolar.trelloMs = 8_000;
});

const get = (rota: string, auth = NILCE) => request(app).get(`/gerador/solar/${rota}`).set('Authorization', auth);
const codigos = (corpo: { obras: Array<{ codigo: string }> }) => corpo.obras.map((o) => o.codigo).sort();

describe('login', () => {
  it('401 sem token, com chave publishable e com token inválido, em todas as rotas', async () => {
    for (const rota of ['obras', 'mapa', 'indicacoes']) {
      expect((await request(app).get(`/gerador/solar/${rota}`)).status).toBe(401);
      expect((await get(rota, 'Bearer sb_publishable_abc')).status).toBe(401);
      expect((await get(rota, 'Bearer lixo')).status).toBe(401);
    }
    const post = await request(app).post('/gerador/solar/obras/marcar').send({ codigo: '#0057', tipo: 'depoimento_pedido' });
    expect(post.status).toBe(401);
  });
  it('403 para conta que não é @irmaosnaobra.app', async () => {
    expect((await get('obras', 'Bearer tk-estranho')).status).toBe(403);
  });
  it('e-mail com acento NÃO vira sócio (thiagó não é thiago)', async () => {
    const res = await get('obras', 'Bearer tk-acento');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verTudo: false, consultor: 'thiagó' });
    expect(res.body.obras).toEqual([]);        // nem a venda do Thiago ele enxerga por tabela
    expect(JSON.stringify(res.body)).not.toContain('valores');
    expect((await get('indicacoes', 'Bearer tk-acento')).body.recebidas).toEqual([]);
  });
  it('403 para e-mail não confirmado, mesmo com o nome de sócio', async () => {
    for (const rota of ['obras', 'mapa', 'indicacoes']) {
      expect((await get(rota, 'Bearer tk-naoconf')).status).toBe(403);
    }
    expect(h.chamadas.planilha).toBe(0);
  });
  it('nada é baixado antes de passar pelo login', async () => {
    await request(app).get('/gerador/solar/obras');
    expect(h.chamadas.planilha).toBe(0);
  });
});

describe('GET /solar/obras', () => {
  it('consultor vê só as próprias vendas e SEM dinheiro', async () => {
    const res = await get('obras');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, verTudo: false, consultor: 'nilce' });
    expect(codigos(res.body)).toEqual(['#0057', '#0059', '#0061']);
    for (const o of res.body.obras) expect('valores' in o).toBe(false);
    expect('aReceber' in res.body.resumo).toBe(false);
    expect(res.body.resumo).toMatchObject({ total: 3, concluidas: 2, emAndamento: 1 });
    expect(JSON.stringify(res.body)).not.toContain('Bruno');
  });

  it('sócio vê tudo, com valores e a receber', async () => {
    const res = await get('obras', THIAGO);
    expect(res.body).toMatchObject({ verTudo: true, consultor: 'thiago' });
    expect(codigos(res.body)).toEqual(['#0057', '#0058', '#0059', '#0060', '#0061']);
    const bruno = res.body.obras.find((o: any) => o.codigo === '#0058');
    expect(bruno.valores).toEqual({ venda: 10000, recebido: 4000, aReceber: 6000 });
    expect(res.body.resumo.aReceber).toBe(6000);
  });

  it('SOLAR_SOCIOS troca quem é sócio', async () => {
    process.env.SOLAR_SOCIOS = 'nilce';
    const res = await get('obras');
    expect(res.body.verTudo).toBe(true);
    expect(res.body.obras).toHaveLength(5);
    const dg = await get('obras', 'Bearer tk-diego');
    expect(dg.body.verTudo).toBe(false);
    expect(codigos(dg.body)).toEqual(['#0058']);
  });

  it('formato de uma obra', async () => {
    const res = await get('obras');
    const ana = res.body.obras.find((o: any) => o.codigo === '#0057');
    expect(ana).toMatchObject({
      cliente: 'Ana Souza', consultor: 'Nilce', telefone: '5534999990000', endereco: 'Rua X, 10',
      cidade: 'Uberlândia', uf: 'MG', concessionaria: 'Cemig', equipe: 'Propria', engenheiro: 'Guilherme',
      sistema: { placas: 10, modeloPlaca: 'Tsun 585W', inversores: 1, inversor: 'Saj 3K', estrutura: 'Fibromadeira' },
      vendaEm: '2026-08-03', etapaAtual: 'concluida', paradoHaDias: null, recebimento: 'quitado',
      depoimento: 'pedido',
      marcas: { depoimentoPedidoEm: null, indicacaoPedidaEm: null, por: null },
      pedir: { depoimento: true, indicacao: true },
      linkIndicacao: 'https://solardoc.app/io/indicacao',
      trello: { lista: 'PROJETO EM ANALISE', url: 'https://trello.com/c/abc123' },
    });
    // Consultor comum: a origem não leva o texto (nome de cliente de outro consultor).
    expect(ana.origem).toEqual({ tipo: 'indicacao', indicadoPor: '#0013' });
    expect(JSON.stringify(res.body)).not.toContain('Cleber');
    expect(ana.etapas.map((e: any) => e.chave)).toEqual(['venda', 'projeto', 'material', 'instalacao', 'vistoria', 'liberado']);
    expect(ana.etapas.every((e: any) => e.feito)).toBe(true);
    expect(res.body.fonte).toEqual({ planilha: true, trello: true, marcas: true });
    expect(res.body.resumo.porEtapa).toEqual({ projeto: 0, material: 0, instalacao: 1, vistoria: 0, liberado: 0 });
    const fabio = res.body.obras.find((o: any) => o.codigo === '#0061');
    expect(fabio.pedir.indicacao).toBe(false);   // insatisfeito
    expect(fabio.trello).toBeNull();
  });

  it('sócio recebe o texto da origem', async () => {
    const res = await get('obras', THIAGO);
    const ana = res.body.obras.find((o: any) => o.codigo === '#0057');
    expect(ana.origem).toEqual({ tipo: 'indicacao', texto: '#0013 Cleber', indicadoPor: '#0013' });
  });

  it('ordem: em andamento primeiro, concluída por último', async () => {
    const res = await get('obras', THIAGO);
    expect(res.body.obras.map((o: any) => o.codigo)).toEqual(['#0060', '#0059', '#0058', '#0057', '#0061']);
  });

  it('LISTA BRANCA: nenhuma coluna proibida, chave ou valor, nem para sócio', async () => {
    for (const auth of [NILCE, THIAGO]) {
      const texto = JSON.stringify((await get('obras', auth)).body);
      for (const s of Object.values(PROIBIDAS)) expect(texto).not.toContain(s);
      for (const n of NOMES_PROIBIDOS) expect(texto.toLowerCase()).not.toContain(n.toLowerCase());
      expect(texto).not.toContain('999.999');   // a linha TOTAL da planilha
    }
    for (const rota of ['mapa', 'indicacoes']) {
      const texto = JSON.stringify((await get(rota, THIAGO)).body);
      for (const s of Object.values(PROIBIDAS)) expect(texto).not.toContain(s);
    }
  });

  it('Trello fora do ar não derruba a rota', async () => {
    h.trelloFora = true;
    const res = await get('obras');
    expect(res.status).toBe(200);
    expect(res.body.fonte.trello).toBe(false);
    expect(res.body.obras.every((o: any) => o.trello === null)).toBe(true);
    expect(res.body.obras).toHaveLength(3);
  });

  it('Trello que responde 500 também vira trello null', async () => {
    (globalThis.fetch as any).mockImplementation(async (url: string) =>
      String(url).includes('trello.com') ? new Response('x', { status: 500 }) : new Response(h.csv, { status: 200 }));
    const res = await get('obras');
    expect(res.status).toBe(200);
    expect(res.body.fonte.trello).toBe(false);
  });

  it('marcas que não leem não derrubam a lista', async () => {
    h.erroEstado = true;
    const res = await get('obras');
    expect(res.status).toBe(200);
    expect(res.body.fonte.marcas).toBe(false);
  });
});

describe('cache de 5 minutos', () => {
  it('a segunda chamada não baixa de novo', async () => {
    await get('obras');
    await get('obras');
    await get('mapa');
    expect(h.chamadas).toEqual({ planilha: 1, trello: 1 });
  });
  it('?fresco=1 de sócio baixa de novo; de consultor é ignorado', async () => {
    await get('obras', THIAGO);
    await get('obras', NILCE);
    await get('obras', NILCE);
    expect(h.chamadas.planilha).toBe(1);
    await request(app).get('/gerador/solar/obras?fresco=1').set('Authorization', NILCE);
    expect(h.chamadas.planilha).toBe(1);
    await request(app).get('/gerador/solar/obras?fresco=1').set('Authorization', THIAGO);
    expect(h.chamadas).toEqual({ planilha: 2, trello: 2 });
  });
  it('expira depois de 5 minutos', async () => {
    const t0 = Date.now();
    await get('obras');
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 5 * 60_000 + 1000);
    await get('obras');
    expect(h.chamadas.planilha).toBe(2);
  });
  it('o cache guarda dado, não resposta: sócio primeiro, consultor depois, sem dinheiro', async () => {
    const socio = await get('obras', THIAGO);
    expect(socio.body.obras[0].valores).toBeDefined();
    const consultor = await get('obras', NILCE);
    expect(h.chamadas.planilha).toBe(1);
    expect(JSON.stringify(consultor.body)).not.toContain('valores');
    expect(JSON.stringify(consultor.body)).not.toContain('aReceber');
    expect(codigos(consultor.body)).toEqual(['#0057', '#0059', '#0061']);
  });
  it('planilha fora sem cópia: 502; com cópia antiga: serve a antiga e avisa', async () => {
    h.planilhaFora = true;
    expect((await get('obras')).status).toBe(502);
    h.planilhaFora = false;
    const t0 = Date.now();
    expect((await get('obras')).status).toBe(200);
    h.planilhaFora = true;
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 6 * 60_000);
    const velha = await get('obras');
    expect(velha.status).toBe(200);
    expect(velha.body.fonte.planilha).toBe(false);
    expect(velha.body.obras).toHaveLength(3);
  });
  it('cópia velha vale no máximo 6 horas: depois disso, 502', async () => {
    const t0 = Date.now();
    expect((await get('obras')).status).toBe(200);
    h.planilhaFora = true;
    const agora = vi.spyOn(Date, 'now');
    agora.mockReturnValue(t0 + 6 * 3_600_000 - 60_000);
    const quase = await get('obras');
    expect(quase.status).toBe(200);
    expect(quase.body.fonte.planilha).toBe(false);
    agora.mockReturnValue(t0 + 6 * 3_600_000 + 60_000);
    const passou = await get('obras');
    expect(passou.status).toBe(502);
    expect(passou.body.obras).toBeUndefined();
  });
  it('fetch da planilha pendurado (ignora o abort) não trava a rota além do limite', async () => {
    limitesSolar.planilhaMs = 50;
    (globalThis.fetch as any).mockImplementation(() => new Promise(() => { /* nunca resolve */ }));
    const t0 = Date.now();
    const res = await get('obras');
    expect(res.status).toBe(502);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('Trello pendurado não trava a rota: 200 com trello null', async () => {
    limitesSolar.trelloMs = 50;
    (globalThis.fetch as any).mockImplementation(async (url: string) =>
      String(url).includes('trello.com') ? new Promise(() => { /* nunca resolve */ }) : new Response(h.csv, { status: 200 }));
    const t0 = Date.now();
    const res = await get('obras');
    expect(res.status).toBe(200);
    expect(res.body.fonte.trello).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('POST /solar/obras/marcar', () => {
  const marcar = (corpo: object, auth = NILCE) => request(app).post('/gerador/solar/obras/marcar').set('Authorization', auth).send(corpo);

  it('grava, mescla e desfaz', async () => {
    const a = await marcar({ codigo: '#0057', tipo: 'depoimento_pedido' });
    expect(a.status).toBe(200);
    expect(a.body.marcas.por).toBe('nilce');
    expect(a.body.marcas.depoimentoPedidoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.body.marcas.indicacaoPedidaEm).toBeNull();
    expect(h.estado.has('solar_obra:0057')).toBe(true);

    const b = await marcar({ codigo: '0057', tipo: 'indicacao_pedida' });
    expect(b.body.marcas.depoimentoPedidoEm).toBe(a.body.marcas.depoimentoPedidoEm);   // mesclou
    expect(b.body.marcas.indicacaoPedidaEm).toBeTruthy();

    const lista = await get('obras');
    const ana = lista.body.obras.find((o: any) => o.codigo === '#0057');
    expect(ana.pedir).toEqual({ depoimento: false, indicacao: false });
    expect(ana.marcas.por).toBe('nilce');

    const c = await marcar({ codigo: '#0057', tipo: 'depoimento_pedido', desfazer: true });
    expect(c.body.marcas.depoimentoPedidoEm).toBeNull();
    expect(c.body.marcas.indicacaoPedidaEm).toBe(b.body.marcas.indicacaoPedidaEm);
    expect(h.estado.get('solar_obra:0057')).not.toHaveProperty('depoimentoPedidoEm');
  });

  it('404 para venda de outro consultor e para código que não existe', async () => {
    expect((await marcar({ codigo: '#0058', tipo: 'depoimento_pedido' })).status).toBe(404);
    expect((await marcar({ codigo: '#9999', tipo: 'depoimento_pedido' })).status).toBe(404);
    expect(h.estado.size).toBe(0);
  });

  it('o código da venda alheia em qualquer grafia (58, #58, #0058, 0058, número) dá 404 e não grava', async () => {
    for (const codigo of ['58', '#58', '#0058', '0058', 58, ' #0058 ']) {
      for (const tipo of ['depoimento_pedido', 'indicacao_pedida']) {
        const res = await marcar({ codigo, tipo });
        expect(res.status).toBe(404);
        expect(res.body.ok).toBe(false);
      }
    }
    expect(h.estado.size).toBe(0);
  });

  it('o mesmo código escrito de outro jeito grava na mesma chave da venda própria', async () => {
    for (const codigo of ['57', '#57', '#0057']) {
      expect((await marcar({ codigo, tipo: 'depoimento_pedido' })).status).toBe(200);
    }
    expect([...h.estado.keys()]).toEqual(['solar_obra:0057']);
  });

  it('sócio marca venda de qualquer consultor', async () => {
    const res = await marcar({ codigo: '#0058', tipo: 'indicacao_pedida' }, THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.marcas.por).toBe('thiago');
  });

  it('400 para corpo inválido', async () => {
    expect((await marcar({ codigo: '#0057', tipo: 'outra_coisa' })).status).toBe(400);
    expect((await marcar({ codigo: 'abc', tipo: 'depoimento_pedido' })).status).toBe(400);
    expect((await marcar({})).status).toBe(400);
  });
});

// Vendas para os testes de indicação: o #0013 é cliente da Nilce, indicou a Ana (Nilce)
// e o Gil (Giovanna). A Giovanna e a Nilce não podem ver a venda uma da outra.
const CSV_INDICACOES = () => paraCsv([
  CABECALHO, VENDAS.ana, VENDAS.bruno,
  linha({ codigo: '#0013', cliente: 'Cleber Souza', consultor: 'Nilce', origem: 'Tráfego', cidade: 'Araguari', uf: 'MG' }),
  linha({
    codigo: '#0062', cliente: 'Gil Prado', consultor: 'Giovanna', origem: '#0013 Cleber', contato: '34966665555',
    endereco: 'Rua Alheia, 99', cidade: 'Cidade Fantasma', uf: 'ZZ',
  }),
]);
const ALHEIO = ['Gil', 'Prado', '#0062', '66665555', 'Rua Alheia', 'Bruno', '#0058', 'Cidade Fantasma', 'ZZ/', 'Giovanna'];

describe('GET /solar/mapa', () => {
  it('uma linha por cidade, com todas as vendas e sem dado de cliente (sócio)', async () => {
    const res = await get('mapa', THIAGO);
    expect(res.status).toBe(200);
    const u = res.body.cidades.find((c: any) => c.cidade === 'Uberlândia');
    expect(u).toMatchObject({ uf: 'MG', instaladas: 2, emAndamento: 1 });
    expect(res.body.cidades.find((c: any) => c.cidade === 'Araguari')).toMatchObject({ instaladas: 0, emAndamento: 1 });
    expect(res.body.semCoordenada).toBe(1);
    expect(res.body.semCoordenadaLista).toEqual(['Cidade Inventada/XX']);
    const texto = JSON.stringify(res.body);
    for (const proibido of ['Ana', 'Bruno', 'Carla', 'Eva', 'Fabio', 'Souza', '5534', '99999', 'Rua X', 'telefone', 'endereco', 'cliente']) {
      expect(texto).not.toContain(proibido);
    }
    for (const c of res.body.cidades) expect(Object.keys(c).sort()).toEqual(['cidade', 'emAndamento', 'instaladas', 'lat', 'lng', 'uf']);
  });

  it('consultor comum: só a contagem, nenhum texto livre da planilha', async () => {
    h.csv = CSV_INDICACOES();
    const res = await get('mapa');
    expect(res.status).toBe(200);
    expect(res.body.semCoordenada).toBe(1);
    expect('semCoordenadaLista' in res.body).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual(['cidades', 'ok', 'semCoordenada']);
    const texto = JSON.stringify(res.body);
    for (const x of [...ALHEIO, 'Ana', 'Cleber', 'Souza', 'Rua X', '5534', 'Cidade Inventada', 'Fantasma']) {
      expect(texto).not.toContain(x);
    }
    // Só nomes oficiais de município (do IBGE), nunca a digitação da planilha.
    expect(res.body.cidades.map((c: any) => c.cidade).sort()).toEqual(['Araguari', 'Uberlândia']);
  });
});

describe('GET /solar/indicacoes', () => {
  it('ranking pela origem da planilha (sócio vê tudo)', async () => {
    const socio = await get('indicacoes', THIAGO);
    expect(socio.body.ranking).toEqual([{ codigo: '#0013', cliente: 'Cleber', indicou: 1, vendas: ['#0057'] }]);
  });

  it('consultor comum: só indicador que é cliente dele, e só as vendas dele', async () => {
    h.csv = CSV_INDICACOES();
    const socio = await get('indicacoes', THIAGO);
    expect(socio.body.ranking).toEqual([{ codigo: '#0013', cliente: 'Cleber Souza', indicou: 2, vendas: ['#0057', '#0062'] }]);

    const nilce = await get('indicacoes');
    expect(nilce.body.ranking).toEqual([{ codigo: '#0013', cliente: 'Cleber Souza', indicou: 1, vendas: ['#0057'] }]);
    for (const x of ALHEIO) expect(JSON.stringify(nilce.body)).not.toContain(x);

    // A Giovanna vendeu para um indicado, mas o indicador não é cliente dela.
    const giovanna = await get('indicacoes', 'Bearer tk-giovanna');
    expect(giovanna.body.ranking).toEqual([]);
    expect(JSON.stringify(giovanna.body)).not.toContain('Cleber');
  });

  it('recebidas (io_indicacoes não tem consultor) só para sócio; comum recebe lista vazia sem nem consultar', async () => {
    const nilce = await get('indicacoes');
    expect(nilce.body.recebidas).toEqual([]);
    expect(h.colunasIndicacoes).toEqual([]);
    const texto = JSON.stringify(nilce.body);
    for (const x of ['Joana', 'Cleber', '5534977776666', '5534955554444', 'link-bio', 'PIX']) expect(texto).not.toContain(x);
    const socio = await get('indicacoes', THIAGO);
    expect(socio.body.recebidas).toHaveLength(1);
  });

  it('nunca devolve o pix; telefone do indicador só para sócio', async () => {
    const socio = await get('indicacoes', THIAGO);
    expect(JSON.stringify(socio.body)).not.toContain('PIXSECRETO');
    expect(JSON.stringify(socio.body).toLowerCase()).not.toContain('pix');
    expect(h.colunasIndicacoes).not.toContain('indicador_pix');
    expect(h.colunasIndicacoes).toContain('indicador_telefone');
    expect(socio.body.recebidas[0]).toEqual({
      indicadoNome: 'Joana Indicada', indicadoTelefone: '5534977776666', indicadorNome: 'Cleber',
      indicadorTelefone: '5534955554444', origem: 'link-bio', status: 'novo', criadoEm: '2026-10-09T12:00:00Z',
    });
  });

  it('planilha fora: sócio recebe as recebidas e ranking vazio', async () => {
    h.planilhaFora = true;
    const res = await get('indicacoes', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.ranking).toEqual([]);
    expect(res.body.recebidas).toHaveLength(1);
    expect(res.body.fonte.planilha).toBe(false);
  });
});
