import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Versões dos contratos e papéis ligadas ao card (entrega 1 de 2). Tudo simulado: o login, o banco do Gerador, o bucket privado
// `cadastros-venda` e a trava. Nenhuma chamada sai para a rede. Dados inventados.
// Prova: gravar e listar, abrir, excluir só sócio, consultor não vê card alheio (404 igual ao inexistente), card de qualquer status,
// limite de tamanho e de quantidade, linha e id inválidos, lista sem html/snap, append-only e nenhum conteúdo em log.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, unknown>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  cad: new Map<string, Buffer>(),
  tetoBucket: 0,
  bucketExiste: true,
  bucketPublico: false,
  criados: [] as Array<{ nome: string; opcoes: any }>,
  buscados: [] as string[],
  ligacoes: {} as Record<number, string>,
  donosDaVenda: {} as Record<string, string[]>,
  lerListas: 0,
  ordem: [] as string[],
  tique: 0,
  logs: [] as unknown[][],
}));

vi.mock('../utils/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const f: Record<string, unknown> = {};
          const b: any = {
            eq: (c: string, v: unknown) => { f[c] = v; return b; },
            ilike: (c: string, v: string) => { f[`ilike:${c}`] = new RegExp('^' + v.toLowerCase().replace(/%/g, '.*').replace(/_/g, '.') + '$'); return b; },
            order: () => b,
            // Como o banco: mais novos primeiro e só a janela pedida.
            range: async (de: number, ate: number) => ({
              data: h.cards.filter((r) => Object.entries(f).every(([c, v]) => !c.startsWith('ilike:') || (v as RegExp).test(String(r[c.slice(6)] ?? '').toLowerCase())))
                .sort((x, y) => Number(y.id) - Number(x.id)).slice(de, ate + 1),
              error: null,
            }),
            maybeSingle: async () => ({ data: h.cards.find((r) => r.id === f.id) ?? null, error: null }),
          };
          return b;
        },
      };
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      getBucket: async (nome: string) => {
        h.buscados.push(nome);
        return h.bucketExiste
          ? { data: { public: h.bucketPublico, file_size_limit: 5242880, allowed_mime_types: ['application/json'] }, error: null }
          : { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
      },
      createBucket: async (nome: string, opcoes: unknown) => { h.criados.push({ nome, opcoes }); h.bucketExiste = true; return { data: {}, error: null }; },
      from: () => ({
        info: async (p: string) => (h.cad.has(p) ? { data: { id: 'o', name: p }, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }),
        download: async (p: string) => {
          const t = h.cad.get(p);
          return t === undefined ? { data: null, error: { message: '{}', status: 400 } } : { data: { text: async () => t.toString('utf8') }, error: null };
        },
        upload: async (p: string, corpo: Buffer, opcoes: { upsert?: boolean }) => {
          h.ordem.push(`upload:${p}`);
          if (h.tetoBucket && corpo.length > h.tetoBucket) return { data: null, error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } };
          if (!opcoes.upsert && h.cad.has(p)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
          h.cad.set(p, Buffer.from(corpo));
          return { data: { path: p }, error: null };
        },
        list: async () => { h.lerListas++; return { data: [], error: null }; },
        remove: async (ps: string[]) => { ps.forEach((p) => h.cad.delete(p)); return { data: [], error: null }; },
      }),
    },
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => ({
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => {
              const l = h.linhas.get(k);
              return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
            },
          }),
        }),
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (l.key.startsWith('cadastro_trava:')) h.ordem.push('trava');
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: String(l.updated_at ?? ++h.tique) });
          return { error: null };
        },
        delete: () => ({
          eq: (_c: string, k: string) => ({
            eq: (_c2: string, v: string) => ({
              select: async () => {
                const l = h.linhas.get(k);
                if (!l || l.updated_at !== v) return { data: [], error: null };
                h.linhas.delete(k);
                return { data: [{ key: k }], error: null };
              },
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock('../routes/geradorClientes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routes/geradorClientes')>()),
  vendaSolarDoDono: vi.fn(async (nome: string, _socio: boolean, codigo: string) => ((h.donosDaVenda[codigo] ?? []).includes(nome) ? ({ venda: { codigo } } as any) : null)),
}));
vi.mock('../services/gerador/vendaSolarHub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/gerador/vendaSolarHub')>()),
  lerLigacao: vi.fn(async (card: number) => ({ lig: { venda: h.ligacoes[card] ?? '' }, existe: !!h.ligacoes[card] })),
}));

import { mountContratosVersoes } from '../routes/geradorContratosVersoes';
import { limparCacheBucketVersoes } from '../services/gerador/contratosVersoes';

const r = Router();
mountContratosVersoes(r);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const card = (id: number, o: Record<string, unknown> = {}) => ({ id, cliente_nome: 'Fulano de Teste', cidade: 'Uberlandia', vendedor_nome: 'Nilce', created_by: 'lp_eletroposto', status: 'agendado', ...o });
const url = (linha: string, id: string | number, extra = '') => `/gerador/contratos/${linha}/${id}/versoes${extra}`;
const corpo = (o: Record<string, unknown> = {}) => ({
  tipo: 'Contrato', rotulo: 'Contrato completo', modelo: 'completo', num: '001/2026', data: '21/10/2026', editado: false,
  snap: { ctrNum: '001/2026', ctrCard: { linha: 'eletroposto', codigo: '101', nome: 'Fulano de Teste' } }, html: '<div class="ep-doc">texto do contrato</div>',
  arquivo: 'Contrato_Fulano', titulo: 'Contrato · Fulano', opts: { umaPagina: false }, emit: 'aioros', emitSelo: 'Emitente: AIOROS', ...o,
});
const grava = (linha: string, id: string | number, o: Record<string, unknown> = {}, auth = NILCE) => request(app).post(url(linha, id)).set('Authorization', auth).send(corpo(o));
const lista = (linha: string, id: string | number, auth = NILCE) => request(app).get(url(linha, id)).set('Authorization', auth);

beforeEach(() => {
  h.usuarios = { 'tk-jose': 'jose@irmaosnaobra.app', 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app' };
  h.cards = [card(101), card(102, { vendedor_nome: 'Giovanna' }), card(103, { created_by: 'quiz_solar', status: 'fechou' })];
  h.linhas.clear(); h.cad.clear(); h.tetoBucket = 0; h.tique = 0;
  limparCacheBucketVersoes(); h.bucketExiste = true; h.bucketPublico = false; h.criados = []; h.buscados = []; h.ligacoes = {}; h.donosDaVenda = {}; h.lerListas = 0;
  process.env.SOCIOS = process.env.SOCIOS || 'thiago';
});

describe('versões dos contratos ligadas ao card', () => {
  it('grava, lista sem html nem snapshot e abre a versão inteira', async () => {
    const g = await grava('eletroposto', 101);
    expect(g.status).toBe(201);
    expect(g.body.versao).toMatchObject({ tipo: 'Contrato', num: '001/2026', autor: 'nilce@irmaosnaobra.app', editado: false });
    const id = g.body.versao.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.cad.has(`eletroposto/101/${id}.json`)).toBe(true);

    const l = await lista('eletroposto', 101);
    expect(l.status).toBe(200);
    expect(l.body.versoes).toHaveLength(1);
    expect(l.body.versoes[0]).not.toHaveProperty('html');
    expect(l.body.versoes[0]).not.toHaveProperty('snap');
    expect(JSON.stringify(l.body)).not.toContain('texto do contrato');

    const a = await request(app).get(url('eletroposto', 101, `/${id}`)).set('Authorization', NILCE);
    expect(a.status).toBe(200);
    expect(a.body.versao.html).toBe('<div class="ep-doc">texto do contrato</div>');
    expect(a.body.versao.snap.ctrCard.codigo).toBe('101');
    expect(a.body.versao).toMatchObject({ arquivo: 'Contrato_Fulano', emit: 'aioros' });
  });

  it('é append-only: duas gravações iguais viram duas versões, e a lista vem da mais nova', async () => {
    const a = await grava('eletroposto', 101, { num: '1' });
    const b = await grava('eletroposto', 101, { num: '2' });
    expect(a.body.versao.id).not.toBe(b.body.versao.id);
    const l = await lista('eletroposto', 101);
    expect(l.body.versoes.map((v: any) => v.num).sort()).toEqual(['1', '2']);
  });

  it('serve para qualquer status de card (o Termo do Investidor é antes da venda) e para a linha vendasolar', async () => {
    expect((await grava('eletroposto', 101)).status).toBe(201);   // agendado, não vendido
    expect((await grava('vendasolar', 103)).status).toBe(201);
    expect((await lista('vendasolar', 103)).body.versoes).toHaveLength(1);
  });

  it('consultor não vê card alheio: 404 igual ao de card inexistente e ao de linha trocada; sócio vê tudo', async () => {
    await grava('eletroposto', 102, {}, GIOVANNA);
    const alheio = await lista('eletroposto', 102, NILCE);
    const naoExiste = await lista('eletroposto', 999, NILCE);
    const linhaTrocada = await lista('vendasolar', 101, NILCE);
    expect(alheio.status).toBe(404);
    expect(naoExiste.status).toBe(404);
    expect(linhaTrocada.status).toBe(404);
    expect(alheio.body).toEqual(naoExiste.body);
    expect(alheio.body).toEqual(linhaTrocada.body);
    expect((await grava('eletroposto', 102, {}, NILCE)).status).toBe(404);
    const socio = await lista('eletroposto', 102, THIAGO);
    expect(socio.status).toBe(200);
    expect(socio.body.versoes).toHaveLength(1);
  });

  it('abrir versão de card alheio ou com id de outro card dá 404', async () => {
    const g = await grava('eletroposto', 102, {}, GIOVANNA);
    const id = g.body.versao.id as string;
    expect((await request(app).get(url('eletroposto', 102, `/${id}`)).set('Authorization', NILCE)).status).toBe(404);
    // o mesmo id pedido por um card próprio que não o tem
    expect((await request(app).get(url('eletroposto', 101, `/${id}`)).set('Authorization', NILCE)).status).toBe(404);
  });

  it('excluir só sócio: consultor dono recebe 403, sócio apaga, e o arquivo some', async () => {
    const g = await grava('eletroposto', 101);
    const id = g.body.versao.id as string;
    const nao = await request(app).delete(url('eletroposto', 101, `/${id}`)).set('Authorization', NILCE);
    expect(nao.status).toBe(403);
    expect((await lista('eletroposto', 101)).body.versoes).toHaveLength(1);
    const sim = await request(app).delete(url('eletroposto', 101, `/${id}`)).set('Authorization', THIAGO);
    expect(sim.status).toBe(200);
    expect((await lista('eletroposto', 101)).body.versoes).toHaveLength(0);
    expect(h.cad.has(`eletroposto/101/${id}.json`)).toBe(false);
    expect((await request(app).delete(url('eletroposto', 101, `/${id}`)).set('Authorization', THIAGO)).status).toBe(404);
    // card alheio: consultor leva 404, não 403
    const g2 = await grava('eletroposto', 102, {}, GIOVANNA);
    expect((await request(app).delete(url('eletroposto', 102, `/${g2.body.versao.id}`)).set('Authorization', NILCE)).status).toBe(404);
  });

  it('linha, card e id inválidos dão 400; sem login dá 401', async () => {
    expect((await lista('solar', 101)).status).toBe(400);
    expect((await lista('eletroposto', 'abc')).status).toBe(400);
    expect((await lista('eletroposto', 0)).status).toBe(400);
    expect((await request(app).get(url('eletroposto', 101, '/nao-e-uuid')).set('Authorization', NILCE)).status).toBe(400);
    expect((await request(app).delete(url('eletroposto', 101, '/123')).set('Authorization', THIAGO)).status).toBe(400);
    expect((await request(app).get(url('eletroposto', 101))).status).toBe(401);
    expect((await grava('eletroposto', 101, { html: '' })).status).toBe(400);
    expect((await grava('eletroposto', 101, { snap: null })).status).toBe(400);
    expect((await grava('eletroposto', 101, { tipo: '' })).status).toBe(400);
  });

  it('limite de tamanho: acima de 4 MB responde 413 claro e não grava nada', async () => {
    const grande = await grava('eletroposto', 101, { html: 'x'.repeat(4_200_000) });
    expect(grande.status).toBe(413);
    expect(grande.body.error).toMatch(/limite de 4 MB/);
    expect(h.cad.size).toBe(0);
    const ok = await grava('eletroposto', 101, { html: 'x'.repeat(3_000_000) });
    expect(ok.status).toBe(201);
  });

  it('bucket com teto menor recusa e a causa chega clara, sem deixar versão órfã', async () => {
    h.tetoBucket = 262144;
    const r1 = await grava('eletroposto', 101, { html: 'x'.repeat(300_000) });
    expect(r1.status).toBe(413);
    expect(r1.body.motivo).toBe('grande_bucket');
    expect([...h.cad.keys()].filter((k) => k.startsWith('eletroposto/'))).toHaveLength(0);
  });

  it('limite de quantidade: a 201ª versão do card recebe 409', async () => {
    const leves = Array.from({ length: 200 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tipo: 'Contrato', rotulo: '', modelo: '', num: String(i), data: '', em: `2026-10-21T00:00:${String(i % 60).padStart(2, '0')}.000Z`, autor: 'x', editado: false, bytes: 1 }));
    h.cad.set('eletroposto/101/indice.json', Buffer.from(JSON.stringify({ v: 1, versoes: leves })));
    const r1 = await grava('eletroposto', 101);
    expect(r1.status).toBe(409);
    expect(r1.body.motivo).toBe('limite');
    expect(h.cad.size).toBe(1);
  });

  it('seletor de cards: consultor só vê os dele, sócio vê todos, e o termo curto devolve vazio', async () => {
    const meus = await request(app).get('/gerador/contratos/cards?q=fulano').set('Authorization', NILCE);
    expect(meus.status).toBe(200);
    expect(meus.body.cards.map((c: any) => c.codigo).sort()).toEqual(['101', '103']);   // o 102 é da Giovanna
    expect(meus.body.cards.find((c: any) => c.codigo === '101')).toMatchObject({ linha: 'eletroposto', nome: 'Fulano de Teste' });
    const todos = await request(app).get('/gerador/contratos/cards?q=fulano').set('Authorization', THIAGO);
    expect(todos.body.cards.map((c: any) => c.codigo).sort()).toEqual(['101', '102', '103']);
    expect(todos.body.cards.find((c: any) => c.codigo === '103').linha).toBe('vendasolar');
    expect((await request(app).get('/gerador/contratos/cards?q=f').set('Authorization', NILCE)).body.cards).toEqual([]);
  });

  it('nenhum conteúdo do papel vai para o log', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { h.logs.push(a); });
    h.tetoBucket = 10;
    await grava('eletroposto', 101, { html: 'CPF 529.982.247-25 dado pessoal' });
    espiao.mockRestore();
    expect(JSON.stringify(h.logs)).not.toContain('529.982');
  });
  it('o bucket próprio nasce no primeiro uso (getBucket e createBucket, nunca por list), privado, 5 MB e só JSON', async () => {
    h.bucketExiste = false;
    expect((await grava('eletroposto', 101)).status).toBe(201);
    expect(h.buscados[0]).toBe('contratos-versoes');
    expect(h.criados).toHaveLength(1);
    expect(h.criados[0].nome).toBe('contratos-versoes');
    expect(h.criados[0].opcoes).toEqual({ public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['application/json'] });
    expect(h.lerListas).toBe(0);
    expect([...h.cad.keys()].every((k) => k.startsWith('eletroposto/101/'))).toBe(true);
  });

  it('bucket que já existe PÚBLICO é erro: nada é gravado', async () => {
    h.bucketPublico = true;
    const r1 = await grava('eletroposto', 101);
    expect(r1.status).toBe(503);
    expect(h.cad.size).toBe(0);
  });

  it('venda solar: vale o vendedor do card, o consultor da venda ligada na planilha e o sócio; o resto leva 404', async () => {
    h.cards.push(card(104, { vendedor_nome: 'Giovanna', created_by: 'quiz_solar', status: 'agendado' }));
    expect((await lista('vendasolar', 104, NILCE)).status).toBe(404);
    h.ligacoes[104] = '#0057'; h.donosDaVenda['#0057'] = ['diego'];
    expect((await lista('vendasolar', 104, NILCE)).status).toBe(404);
    h.donosDaVenda['#0057'] = ['nilce'];
    expect((await grava('vendasolar', 104, {}, NILCE)).status).toBe(201);
    expect((await lista('vendasolar', 104, NILCE)).body.versoes).toHaveLength(1);
    h.ligacoes = {}; h.donosDaVenda = {};
    expect((await lista('vendasolar', 104, GIOVANNA)).status).toBe(200);
    expect((await lista('vendasolar', 104, THIAGO)).status).toBe(200);
    // essa regra é só da venda solar: a mesma ligação não abre um card do eletroposto
    h.ligacoes[102] = '#0057'; h.donosDaVenda['#0057'] = ['nilce'];
    expect((await lista('eletroposto', 102, NILCE)).status).toBe(404);
  });

  it('o HTML é limpo ao gravar: script, onerror e javascript: saem; o papel normal fica igual', async () => {
    const sujo = '<div class="ep-doc"><p onclick="x()">Contrato</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">v</a></div>';
    const g = await grava('eletroposto', 101, { html: sujo });
    expect(g.status).toBe(201);
    const a = await request(app).get(url('eletroposto', 101, `/${g.body.versao.id}`)).set('Authorization', NILCE);
    const html = a.body.versao.html as string;
    expect(html).not.toMatch(/script|onerror|onclick|javascript:/i);
    expect(html).toContain('Contrato');
    const normal = '<div class="ep-doc"><style>.ep-page{width:210mm}</style><table class="t"><tr><td style="color:red">R$ 1.000,00</td></tr></table><img src="data:image/png;base64,AAAA" alt="logo"></div>';
    const g2 = await grava('eletroposto', 101, { html: normal });
    const a2 = await request(app).get(url('eletroposto', 101, `/${g2.body.versao.id}`)).set('Authorization', NILCE);
    expect(a2.body.versao.html).toBe(normal);
  });

  it('duas gravações simultâneas entram as duas na lista, e o arquivo grande sobe antes da trava', async () => {
    const [a, b] = await Promise.all([grava('eletroposto', 101, { num: 'A' }), grava('eletroposto', 101, { num: 'B' })]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const l = await lista('eletroposto', 101);
    expect(l.body.versoes.map((v: any) => v.num).sort()).toEqual(['A', 'B']);
    // cada versão tem o seu arquivo, mais o índice
    expect([...h.cad.keys()].filter((k) => k.endsWith('.json') && !k.endsWith('indice.json'))).toHaveLength(2);
  });

  it('o upload da versão vem antes da trava; no limite, o arquivo subido é apagado', async () => {
    h.ordem = [];
    await grava('eletroposto', 101);
    const iUp = h.ordem.findIndex((e) => e.startsWith('upload:eletroposto/101/') && !e.endsWith('indice.json'));
    const iTrava = h.ordem.indexOf('trava');
    expect(iUp).toBeGreaterThanOrEqual(0);
    expect(iUp).toBeLessThan(iTrava);
    const leves = Array.from({ length: 200 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tipo: 'Contrato', rotulo: '', modelo: '', num: String(i), data: '', em: '2026-10-21T00:00:00.000Z', autor: 'x', editado: false, bytes: 1 }));
    h.cad.set('eletroposto/101/indice.json', Buffer.from(JSON.stringify({ v: 1, versoes: leves })));
    const antes = [...h.cad.keys()].length;
    expect((await grava('eletroposto', 101)).status).toBe(409);
    expect([...h.cad.keys()].length).toBe(antes);   // o que subiu foi apagado
  });
  it('seletor de cards: o nome do consultor casa sem acento ("jose" acha o card do "José"), como a posse', async () => {
    h.cards.push(card(105, { vendedor_nome: 'José' }));
    const jose = await request(app).get('/gerador/contratos/cards?q=fulano').set('Authorization', 'Bearer tk-jose');
    expect(jose.body.cards.map((c: any) => c.codigo)).toEqual(['105']);
    expect((await lista('eletroposto', 105, 'Bearer tk-jose')).status).toBe(200);
    expect((await lista('eletroposto', 101, 'Bearer tk-jose')).status).toBe(404);
  });
  it('seletor de cards: com mais de 60 cards que o curinga deixa passar ("Bruno" casa com o padrão de "Ana"), uma cliente ANTIGA ainda aparece (o refino vem antes do corte)', async () => {
    for (let i = 0; i < 80; i++) h.cards.push(card(1000 + i, { cliente_nome: `Bruno Costa ${i}`, vendedor_nome: 'Nilce' }));
    h.cards.push(card(9, { cliente_nome: 'Ana Antiga Souza', vendedor_nome: 'Nilce' }));
    const r = await request(app).get('/gerador/contratos/cards?q=ana').set('Authorization', NILCE);
    expect(r.body.cards.map((c: any) => c.codigo)).toEqual(['9']);
  });
  it('seletor de cards: o nome do CLIENTE casa sem acento nos dois sentidos ("Jose" acha "José" e "José" acha "Jose"), sem trazer nome parecido demais', async () => {
    h.cards.push(card(106, { cliente_nome: 'José Almeida' }), card(107, { cliente_nome: 'Jose Pereira' }), card(108, { cliente_nome: 'Josefa Costa' }), card(109, { cliente_nome: 'Joao Prado' }));
    const a = await request(app).get('/gerador/contratos/cards?q=' + encodeURIComponent('Jose')).set('Authorization', NILCE);
    expect(a.body.cards.map((c: any) => c.codigo).sort()).toEqual(['106', '107', '108']);
    const b = await request(app).get('/gerador/contratos/cards?q=' + encodeURIComponent('José')).set('Authorization', NILCE);
    expect(b.body.cards.map((c: any) => c.codigo).sort()).toEqual(['106', '107', '108']);
    const c = await request(app).get('/gerador/contratos/cards?q=' + encodeURIComponent('josé alm')).set('Authorization', NILCE);
    expect(c.body.cards.map((x: any) => x.codigo)).toEqual(['106']);
  });
});
