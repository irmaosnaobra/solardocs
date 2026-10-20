import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Cartão do Trello da venda solar: a rota `POST /gerador/vendas-solares/:card/trello` e o envio do dossiê, com o quadro público.
// Tudo simulado (login, os dois bancos, os buckets e o Trello inteiro); nenhuma chamada sai para a rede e nada toca o Trello de
// verdade. Dados inventados. Prova: a guarda (outro consultor recusado), 503 sem chave, quadro público bloqueando anexo (rota nova
// e dossiê), título com e sem código, cartão achado por #NNNN (exato), empate sem escolher, etiquetas automáticas e extras,
// checklist marcada pelos documentos, cartão existente sem checklist duplicada nem descrição sobrescrita, prévia sem escrever,
// ligação assinada com o cartão e o vínculo automático que não morre por causa dele.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, unknown>>,
  propostas: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  objetos: new Map<string, Buffer>(),     // fichas-docs
  cad: new Map<string, Buffer>(),         // cadastros-venda
  dossie: new Map<string, Buffer>(),      // dossie-vendas
  tique: 0,
}));
const t = vi.hoisted(() => ({
  publico: false,
  sondaCai: false,
  seq: 0,
  quadro: { name: 'Quadro de teste', lists: [] as any[], labels: [] as any[], cards: [] as any[] },
  checklists: new Map<string, any[]>(),
  anexos: new Map<string, Array<{ id: string; name: string }>>(),
  chamadas: [] as Array<{ metodo: string; caminho: string; params: Record<string, string>; nome?: string; semChave: boolean }>,
  falhaAoCriar: false,
  semLabelsNoQuadro: false,
  labelsCaem: false,
  atrasoCriarMs: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

function consulta(linhas: Array<Record<string, any>>) {
  const f: Record<string, unknown> = {};
  const b: any = {
    eq: (c: string, v: unknown) => { f[c] = v; return b; },
    order: () => b,
    like: () => b,
    in: async () => ({ data: [], error: null }),
    range: async () => ({ data: linhas.filter((r) => Object.entries(f).every(([c, v]) => r[c] === v)), error: null }),
    maybeSingle: async () => ({ data: linhas.find((r) => Object.entries(f).every(([c, v]) => r[c] === v)) ?? null, error: null }),
  };
  return b;
}

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
      if (tabela === 'agendamentos') return { select: () => consulta(h.cards) };
      if (tabela === 'propostas') {
        return {
          select: () => consulta(h.propostas.map((p) => ({ ...p, tel: p.dados?.telefoneDigitos ?? null, tel2: p.dados?.telefone ?? null }))),
          update: (v: { dados: unknown }) => ({
            eq: (_c: string, k: string) => ({
              select: async () => {
                const p = h.propostas.find((x) => x.codigo === k);
                if (!p) return { data: [], error: null };
                p.dados = v.dados;
                return { data: [{ codigo: k }], error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      getBucket: async (nome: string) => ({
        data: nome === 'cadastros-venda'
          ? { public: false, file_size_limit: 262144, allowed_mime_types: ['application/json'] }
          : { public: false, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
        error: null,
      }),
      createBucket: async () => ({ data: {}, error: null }),
      updateBucket: async () => ({ data: {}, error: null }),
      from: (nome: string) => {
        const mapa = nome === 'cadastros-venda' ? h.cad : nome === 'dossie-vendas' ? h.dossie : h.objetos;
        return {
          info: async (p: string) => {
            const x = mapa.get(p);
            return x === undefined
              ? { data: null, error: { message: 'Object not found', statusCode: '404' } }
              : { data: { id: 'o1', name: p, size: x.length, contentType: 'application/json' }, error: null };
          },
          download: async (p: string) => {
            const x = mapa.get(p);
            return x === undefined
              ? { data: null, error: { message: '{}', status: 400 } }
              : { data: { text: async () => x.toString('utf8'), arrayBuffer: async () => x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) }, error: null };
          },
          upload: async (p: string, corpo: Buffer) => { mapa.set(p, Buffer.from(corpo)); return { data: { path: p }, error: null }; },
          remove: async (ps: string[]) => { for (const p of ps) mapa.delete(p); return { data: [], error: null }; },
        };
      },
    },
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-21T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => {
              const l = h.linhas.get(k);
              return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
            },
          }),
          like: (_c: string, p: string) => {
            const prefixo = p.replace(/\\/g, '').replace(/%$/, '');
            const chain: any = {
              order: () => chain,
              range: async () => ({
                data: [...h.linhas.entries()].filter(([k]) => k.startsWith(prefixo)).sort(([a], [c]) => (a < c ? -1 : 1)).map(([k, l]) => ({ key: k, value: l.value })),
                error: null,
              }),
            };
            return chain;
          },
          in: async () => ({ data: [], error: null }),
        }),
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: l.key.startsWith('cadastro_trava:') ? String(l.updated_at) : stamp() });
          return { error: null };
        },
        upsert: async (l: { key: string; value: unknown }) => { h.linhas.set(l.key, { value: l.value, updated_at: stamp() }); return { error: null }; },
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

import { mountVendaSolar } from '../routes/geradorVendaSolar';
import { mountDossie } from '../routes/geradorDossie';
import { limparCacheBucketDocs } from '../services/gerador/docsClienteBanco';
import { limparCacheBucketCadastros } from '../services/gerador/cadastroVendaBanco';
import { limparCacheQuadroPublico } from '../services/gerador/dossieVenda';
import { assinarLigacao, invalidarCachesHub, reiniciarLogsDoHub, lerLigacao, type Ligacao } from '../services/gerador/vendaSolarHub';

const r = Router();
mountVendaSolar(r);
mountDossie(r);
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PDF = Buffer.from('%PDF-1.4\ndocumento de teste\n%%EOF');

const novoId = (): string => (++t.seq).toString(16).padStart(24, '0');
const idFixo = (n: number): string => `f${String(n).padStart(23, '0')}`;
const LISTA_NOVOS = idFixo(900);

const post = (url: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);
const trello = (id = 201, corpo: unknown = {}, auth = NILCE) => post(`/vendas-solares/${id}/trello`, corpo, auth);
const ligacaoGravada = (id: number) => h.linhas.get(`venda_solar:${id}`)?.value as (Ligacao & { sig?: string }) | undefined;
const registroGravado = (id: number) => h.linhas.get(`trello_venda_solar:${id}`)?.value as { card_id: string | null; comentario_id: string | null; anexados: Record<string, string> } | undefined;
const escritas = () => t.chamadas.filter((c) => c.metodo !== 'GET');
const criacoes = () => t.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/cards');
const anexosEnviados = () => t.chamadas.filter((c) => c.metodo === 'POST' && /\/attachments$/.test(c.caminho));

const injeta = (id: number, lig: Partial<Ligacao>) => {
  const l: Ligacao = { proposta: null, venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', ...lig };
  h.linhas.set(`venda_solar:${id}`, { updated_at: 'x', value: { ...l, sig: assinarLigacao(id, l) } });
};
const cadastro = (id: number, campos: Record<string, string>) => {
  h.cad.set(`vendasolar/${id}.json`, Buffer.from(JSON.stringify({
    v: 1, alteracoes: [], em: null,
    campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-10-20T10:00:00.000Z', fonte: 'manual' }])),
  })));
};
const UUID = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`;
/** Documentos do card: arquivo no bucket `fichas-docs` e metadado no `system_state`. */
const anexa = (id: number, itens: Array<{ slot: string; mime: string; ext: string }>) => {
  h.linhas.set(`docs_cliente:vendasolar:${id}`, {
    updated_at: 'd0',
    value: {
      arquivos: itens.map((a, i) => ({ id: `d${i}`, slot: a.slot, caminho: `vendasolar/${id}/${UUID(i)}.${a.ext}`, mime: a.mime, bytes: 100, em: '2026-10-20T10:00:00.000Z', por: 'nilce' })),
      alteracoes: [], apagados: [],
    },
  });
  itens.forEach((a, i) => h.objetos.set(`vendasolar/${id}/${UUID(i)}.${a.ext}`, a.ext === 'pdf' ? PDF : JPG));
};
const arqDossie = (path: string, tipo: string) => ({ path, nome: 'nome-original-do-celular.jpg', tipo, bytes: 100, em: '2026-08-01T00:00:00.000Z', trello_status: 'pendente' });
const prop = (codigo: string, nome: string, o: Record<string, unknown> = {}) => ({
  codigo, cliente_nome: nome, consultor_nome: 'Nilce', cliente_cidade: 'Uberlandia', cliente_uf: 'MG', vendido: true, kwp: 8.8, tipo: 'solar',
  created_at: '2026-08-01T10:00:00.000Z', qtd_placas: null, inversor: null, qtd_inversor: null, dados: {}, ...o,
});
const cartaoTrello = (id: string, name: string, labels: string[] = [], idList = LISTA_NOVOS) =>
  ({ id, name, idList, shortUrl: `https://trello.com/c/${id.slice(-6)}`, labels: labels.map((n) => ({ id: `lab-${n}`, name: n })) });
const checklist = (nome: string, itens: Array<[string, boolean]>) =>
  ({ id: novoId(), name: nome, checkItems: itens.map(([name, ok]) => ({ id: novoId(), name, state: ok ? 'complete' : 'incomplete' })) });

// ── O Trello inteiro, de mentira ──────────────────────────────────────────────
async function trelloFalso(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  const metodo = init?.method ?? 'GET';
  const params = Object.fromEntries(u.searchParams);
  const caminho = u.pathname.replace(/^\/1/, '');
  const semChave = !params.key;
  delete params.key; delete params.token;
  let nome: string | undefined;
  if (init?.body instanceof FormData) nome = String(init.body.get('name'));
  t.chamadas.push({ metodo, caminho, params, nome, semChave });
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

  if (metodo === 'GET' && /^\/boards\/[^/]+$/.test(caminho)) {
    if (semChave) {   // a sonda do quadro público: sem key nem token
      if (t.sondaCai) throw new Error('rede caiu');
      return t.publico ? json({ id: 'Q', name: t.quadro.name }) : new Response('unauthorized', { status: 401 });
    }
    return json({ name: t.quadro.name, lists: t.quadro.lists, cards: t.quadro.cards, ...(t.semLabelsNoQuadro ? {} : { labels: t.quadro.labels }) });
  }
  if (metodo === 'GET' && /^\/boards\/[^/]+\/labels$/.test(caminho)) return t.labelsCaem ? new Response('boom', { status: 500 }) : json(t.quadro.labels);
  if (metodo === 'GET' && /^\/boards\/[^/]+\/lists$/.test(caminho)) return json(t.quadro.lists);
  if (metodo === 'POST' && caminho === '/cards') {
    if (t.atrasoCriarMs) await new Promise((ok) => setTimeout(ok, t.atrasoCriarMs));
    if (t.falhaAoCriar) return new Response('boom', { status: 500 });
    const id = novoId();
    const ids = (params.idLabels ?? '').split(',').filter(Boolean);
    t.quadro.cards.push({ id, name: params.name, idList: params.idList, shortUrl: `https://trello.com/c/${id.slice(-6)}`, desc: params.desc, labels: ids.map((i) => ({ id: i, name: i.replace(/^lab-/, '') })) });
    return json({ id, shortUrl: `https://trello.com/c/${id.slice(-6)}` });
  }
  let m = /^\/cards\/([^/]+)\/idLabels$/.exec(caminho);
  if (metodo === 'POST' && m) return json([]);
  m = /^\/cards\/([^/]+)\/checklists$/.exec(caminho);
  if (metodo === 'GET' && m) return json(t.checklists.get(m[1]) ?? []);
  if (metodo === 'POST' && caminho === '/checklists') {
    const c = { id: novoId(), name: params.name, checkItems: [] as any[] };
    t.checklists.set(params.idCard, [...(t.checklists.get(params.idCard) ?? []), c]);
    return json({ id: c.id });
  }
  m = /^\/checklists\/([^/]+)\/checkItems$/.exec(caminho);
  if (metodo === 'POST' && m) {
    for (const lista of t.checklists.values()) {
      const c = lista.find((x) => x.id === m![1]);
      if (c) c.checkItems.push({ id: novoId(), name: params.name, state: params.checked === 'true' ? 'complete' : 'incomplete' });
    }
    return json({ id: novoId() });
  }
  m = /^\/cards\/([^/]+)\/checkItem\/([^/]+)$/.exec(caminho);
  if (metodo === 'PUT' && m) {
    for (const lista of t.checklists.values()) for (const c of lista) for (const it of c.checkItems) if (it.id === m[2]) it.state = params.state;
    return json({ id: m[2] });
  }
  m = /^\/cards\/([^/]+)\/attachments$/.exec(caminho);
  if (metodo === 'GET' && m) return json(t.anexos.get(m[1]) ?? []);
  if (metodo === 'POST' && m) {
    const a = { id: novoId(), name: nome ?? '' };
    t.anexos.set(m[1], [...(t.anexos.get(m[1]) ?? []), a]);
    return json({ id: a.id });
  }
  if (/^\/cards\/[^/]+\/actions(\/[^/]+)?\/comments$/.test(caminho)) return json({ id: novoId() });
  return new Response('not found', { status: 404 });
}

beforeEach(() => {
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app' };
  h.cards = [
    { id: 201, cliente_nome: 'Ana Souza', cliente_telefone: '(34) 98888-0001', cidade: 'Uberlândia', vendedor_nome: 'Nilce', created_by: 'lp_solar', status: 'fechou', created_at: '2026-09-10T15:00:00.000Z' },
    { id: 202, cliente_nome: 'Dora Eletroposto', cliente_telefone: '', cidade: '', vendedor_nome: 'Nilce', created_by: 'lp_eletroposto', status: 'fechou', created_at: '2026-09-10T15:00:00.000Z' },
    { id: 204, cliente_nome: 'Bruno Lima', cliente_telefone: '(34) 97777-0002', cidade: 'Araguari', vendedor_nome: 'Giovanna', created_by: 'lp_solar', status: 'fechou', created_at: '2026-09-10T15:00:00.000Z' },
  ];
  h.propostas = [
    prop('P1', 'Ana Souza', {
      qtd_placas: 18, inversor: 'Growatt 10K', qtd_inversor: 1,
      dados: {
        telefoneDigitos: '34988880001', tab: { mod: 'Canadian CS7N', pot: 600, inv: 'Growatt 10K' }, item: { n: 18 }, qtdInv: 1,
        dossie: {
          versao: 1, atualizado_em: 'x', campos: {}, trello: {},
          arquivos: {
            documento: [arqDossie('P1/documento-1.pdf', 'application/pdf')],
            conta_luz: [arqDossie('P1/conta_luz-2.jpg', 'image/jpg')],
            fachada: [arqDossie('P1/fachada-3.jpg', 'image/jpeg')],
          },
        },
      },
    }),
    prop('P3', 'Bruno Lima', { consultor_nome: 'Giovanna', dados: { telefoneDigitos: '34977770002' } }),
  ];
  h.linhas = new Map(); h.objetos = new Map(); h.cad = new Map(); h.dossie = new Map(); h.tique = 0;
  h.dossie.set('P1/documento-1.pdf', PDF);
  h.dossie.set('P1/conta_luz-2.jpg', JPG);
  h.dossie.set('P1/fachada-3.jpg', JPG);
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-servico-falsa-do-teste';
  process.env.TRELLO_KEY = 'chave-trello-falsa';
  process.env.TRELLO_TOKEN = 'token-trello-falso';
  delete process.env.VINCULO_SOLAR_SECRET; delete process.env.TRELLO_LISTA_ID; delete process.env.SOLAR_SOCIOS;
  invalidarCachesHub(); reiniciarLogsDoHub(); limparCacheBucketDocs(); limparCacheBucketCadastros(); limparCacheQuadroPublico();

  t.publico = false; t.sondaCai = false; t.seq = 0; t.falhaAoCriar = false; t.semLabelsNoQuadro = false; t.labelsCaem = false; t.atrasoCriarMs = 0;
  t.chamadas = []; t.checklists = new Map(); t.anexos = new Map();
  t.quadro = {
    name: 'Quadro de teste',
    lists: [{ id: LISTA_NOVOS, name: 'BASE DE CLIENTES' }, { id: idFixo(901), name: 'DAR ENTRADA' }],
    labels: ['Monofásico 220V', 'Bifásico', 'Trifásico', 'Urbana', 'Rural', 'Cemig', 'Equatorial', 'EXDEDENTES', 'Equipe Própria', 'Equipe Pablo', 'FASTRACK']
      .map((name) => ({ id: `lab-${name}`, name })),
    cards: [cartaoTrello(idFixo(1), '#0062 - Bruno Lima - Araguari MG')],
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T15:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('trello.com')) return trelloFalso(String(url), init);
    throw new Error('rede indisponível no teste');
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** O card 201 completo: ligação com proposta e venda, cadastro com ligação trifásica, rural, Cemig e beneficiária, e documentos. */
function venda201() {
  injeta(201, { proposta: 'P1', venda: '#0061' });
  cadastro(201, {
    nome: 'Ana Souza Oliveira', email: 'ana@exemplo.com', endereco_ponto: 'Rua A, 10, Centro, Uberlândia - MG',
    uc_fornecimento: 'trifasico', uc_classe: 'rural', concessionaria: 'CEMIG Distribuição S.A.', benef_1_uc: '0099887766',
  });
  anexa(201, [{ slot: 'padrao', mime: 'image/jpeg', ext: 'jpg' }, { slot: 'medidor', mime: 'image/jpeg', ext: 'jpg' }]);
}

describe('guarda e credencial', () => {
  it('outro consultor, card de eletroposto e card inexistente respondem 404 igual, sem falar com o Trello; sem login é 401', async () => {
    // só a proposta ligada (com a venda da planilha ligada, a guarda consultaria a planilha, que aqui não existe)
    injeta(201, { proposta: 'P1' });
    const alheio = await trello(201, {}, GIOVANNA);
    expect(alheio.status).toBe(404);
    for (const id of [202, 999]) {
      const x = await trello(id, {}, THIAGO);
      expect(x.status).toBe(404);
      expect(x.body).toEqual(alheio.body);
    }
    expect((await request(app).post('/gerador/vendas-solares/201/trello').send({})).status).toBe(401);
    expect((await trello(0)).status).toBe(400);
    expect(t.chamadas).toEqual([]);
    // o vendedor e o sócio passam
    expect((await trello(201, { previa: true })).status).toBe(200);
    expect((await trello(201, { previa: true }, THIAGO)).status).toBe(200);
  });
  it('sem TRELLO_KEY e TRELLO_TOKEN responde 503 (depois da guarda)', async () => {
    injeta(201, { proposta: 'P1' });
    delete process.env.TRELLO_KEY;
    const res = await trello(201, {});
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, precisa: 'credencial' });
    expect((await trello(201, {}, GIOVANNA)).status).toBe(404);
    expect(t.chamadas).toEqual([]);
  });
  it('pedido torto é 400: previa que não é booleano, extra que não é lista, extra fora de equipe/FASTRACK, card_id que não é id', async () => {
    venda201();
    expect((await trello(201, { previa: 'sim' })).status).toBe(400);
    expect((await trello(201, { etiquetas_extra: 'Equipe Pablo' })).status).toBe(400);
    expect((await trello(201, { card_id: 'abc' })).status).toBe(400);
    const ruim = await trello(201, { etiquetas_extra: ['Equipe Pablo', 'Cemig'] });
    expect(ruim.status).toBe(400);
    expect(ruim.body.invalidas).toEqual(['Cemig']);
    expect(t.chamadas).toEqual([]);
  });
});

describe('cartão novo', () => {
  it('cria no padrão do quadro: título com #NNNN, lista, etiquetas automáticas e extras, descrição e ligação guardada', async () => {
    venda201();
    const res = await trello(201, { etiquetas_extra: ['Equipe Pablo', 'FASTRACK'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, previa: false, criou_cartao: true, ficha: 'descricao', titulo: '#0061 - Ana Souza Oliveira - Uberlândia MG' });
    const [c] = criacoes();
    // o card do Gerador é "Ana Souza" e o contratante "Ana Souza Oliveira": mesma pessoa, sai o nome do documento
    expect(c.params.name).toBe('#0061 - Ana Souza Oliveira - Uberlândia MG');
    expect(c.params.idList).toBe(LISTA_NOVOS);
    expect(c.params.idLabels.split(',').sort()).toEqual(['lab-Cemig', 'lab-EXDEDENTES', 'lab-Equipe Pablo', 'lab-FASTRACK', 'lab-Rural', 'lab-Trifásico']);
    expect(c.params.desc).toBe(['(34) 98888-0001', 'ana@exemplo.com', 'Trifásico', '**18 - Canadian CS7N 600W**', '**1 - Growatt 10K**'].join('\n\n'));
    expect(res.body.cartao).toMatchObject({ nome: '#0061 - Ana Souza Oliveira - Uberlândia MG', lista: 'BASE DE CLIENTES' });
    // a ligação assinada guarda o cartão, e a venda e a proposta continuam
    const lig = (await lerLigacao(201)).lig;
    expect(lig).toMatchObject({ proposta: 'P1', venda: '#0061', por: 'nilce', trello_card: res.body.cartao.id });
    expect(registroGravado(201)?.card_id).toBe(res.body.cartao.id);
  });

  it('sem venda ligada o título não leva código; sem ligação nenhuma a chave nasce com por = trello', async () => {
    cadastro(201, { cidade: 'Uberaba', uf: 'MG', email: 'ana@exemplo.com' });
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    expect(criacoes()[0].params.name).toBe('Ana Souza - Uberaba MG');
    expect(ligacaoGravada(201)).toMatchObject({ proposta: null, venda: null, por: 'trello', trello_card: res.body.cartao.id });
    // sem uc_fornecimento não há etiqueta de ligação; Urbana é o padrão
    expect(criacoes()[0].params.idLabels).toBe('lab-Urbana');
  });

  it('as checklists nascem com os itens e os marcados saem dos documentos, do telefone e do e-mail', async () => {
    venda201();
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    const [back, eng] = t.checklists.get(res.body.cartao.id)!;
    expect(back.name).toBe('BACKOFFICE');
    expect(back.checkItems.map((i: any) => i.name)).toEqual([
      'Foto Disjuntor', 'Foto n° do Medidor', 'Foto Padrão', 'Doc - CNH ou Identidade (Se for CNPJ - contrato social)', 'Conta de Energia',
      'Procuração assinada', 'DataSheet Inversor', 'Telefone', 'Email', 'KMZ', 'Datasheet Modulo', 'Foto Fachada',
    ]);
    const marcados = back.checkItems.filter((i: any) => i.state === 'complete').map((i: any) => i.name);
    // disjuntor e procuração não têm arquivo; o resto das fotos e documentos, o telefone do card e o e-mail do cadastro têm
    expect(marcados).toEqual(['Foto n° do Medidor', 'Foto Padrão', 'Doc - CNH ou Identidade (Se for CNPJ - contrato social)', 'Conta de Energia', 'Telefone', 'Email', 'Foto Fachada']);
    expect(eng.name).toBe('ENGENHARIA');
    expect(eng.checkItems).toHaveLength(7);
    expect(eng.checkItems.some((i: any) => i.state === 'complete')).toBe(false);
  });

  it('anexa os documentos do card e do dossiê da proposta, nomeados pelo rótulo do item, e não repete no segundo envio', async () => {
    venda201();
    const res = await trello(201, {});
    expect(res.body.anexos).toMatchObject({ enviados: 5, falhas: 0, bloqueados: false });
    expect(anexosEnviados().map((a) => a.nome).sort()).toEqual([
      'CNH ou documento do titular da homologação.pdf',
      'Conta de luz da unidade geradora (onde vão as placas).jpg',
      'Foto da fachada.jpg',
      'Foto do padrão de entrada.jpg',
      'Foto do relógio medidor.jpg',
    ]);
    // segundo envio: acha o cartão pela ligação, não cria outro e não sobe nada de novo
    t.chamadas = [];
    const de_novo = await trello(201, {});
    expect(de_novo.status).toBe(200);
    expect(de_novo.body).toMatchObject({ criou_cartao: false, ficha: 'comentario', anexos: { enviados: 0, ja_enviados: 5 } });
    expect(criacoes()).toHaveLength(0);
    expect(anexosEnviados()).toHaveLength(0);
    expect(t.checklists.get(res.body.cartao.id)).toHaveLength(2);   // não duplicou
  });

  it('quadro PÚBLICO: cria o cartão sem anexo nenhum e devolve anexos_bloqueados', async () => {
    venda201();
    t.publico = true;
    const res = await trello(201, {});
    expect(res.status).toBe(207);
    expect(res.body).toMatchObject({
      ok: false, anexos_bloqueados: true, criou_cartao: true, anexos: { enviados: 0, bloqueados: true },
      error: 'O quadro do Trello está público: não anexo documento pessoal. Deixe o quadro privado no Trello e tente de novo.',
    });
    expect(criacoes()).toHaveLength(1);
    expect(anexosEnviados()).toHaveLength(0);
    expect(h.dossie.size).toBe(3);
    // a sonda não leva key nem token
    const sonda = t.chamadas.find((c) => c.metodo === 'GET' && c.semChave);
    expect(sonda).toBeTruthy();
  });

  it('quadro PÚBLICO: descrição e comentário sem telefone nem e-mail (só ligação, equipamentos e o aviso); a checklist segue marcada pela existência do dado', async () => {
    venda201();
    t.publico = true;
    const previa = await trello(201, { previa: true });
    expect(previa.body.descricao).toBe(['Trifásico', '**18 - Canadian CS7N 600W**', '**1 - Growatt 10K**', 'Telefone e e-mail no gerador (quadro público).'].join('\n\n'));
    const res = await trello(201, {});
    const desc = criacoes()[0].params.desc;
    expect(desc).toBe(previa.body.descricao);
    expect(desc).not.toMatch(/98888|ana@exemplo/);
    const back = t.checklists.get(res.body.cartao.id)![0];
    expect(back.checkItems.filter((i: any) => ['Telefone', 'Email'].includes(i.name)).map((i: any) => i.state)).toEqual(['complete', 'complete']);
    // card que já existe: o comentário também sai sem os dois dados
    t.chamadas = [];
    const previa2 = await trello(201, { previa: true });
    expect(previa2.body.comentario).toContain('Telefone e e-mail no gerador (quadro público).');
    expect(previa2.body.comentario).not.toMatch(/98888|ana@exemplo/);
    await trello(201, {});
    const coment = t.chamadas.find((c) => /actions\/comments$/.test(c.caminho));
    expect(coment).toBeTruthy();
    expect(JSON.stringify(coment)).not.toMatch(/98888|ana@exemplo/);
  });

  it('quadro privado: a descrição segue completa, com telefone e e-mail', async () => {
    venda201();
    const previa = await trello(201, { previa: true });
    expect(previa.body.descricao).toContain('(34) 98888-0001');
    expect(previa.body.descricao).toContain('ana@exemplo.com');
    expect(previa.body.descricao).not.toContain('quadro público');
  });

  it('se a sonda falha (rede), vale como público: nada de anexo', async () => {
    venda201();
    t.sondaCai = true;
    const res = await trello(201, {});
    expect(res.body.anexos_bloqueados).toBe(true);
    expect(anexosEnviados()).toHaveLength(0);
  });

  it('quadro público com tudo já enviado antes (quadro privado) não bloqueia nada no reenvio', async () => {
    venda201();
    expect((await trello(201, {})).body.anexos.enviados).toBe(5);
    t.publico = true;
    limparCacheQuadroPublico();
    t.chamadas = [];
    const previa = await trello(201, { previa: true });
    expect(previa.body).toMatchObject({ quadro_publico: true, anexos_bloqueados: false });
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, anexos: { enviados: 0, ja_enviados: 5, pendentes: 0, bloqueados: false } });
    expect(res.body.anexos_bloqueados).toBeUndefined();
    expect(anexosEnviados()).toHaveLength(0);
    // arquivo novo no card + quadro público: aí sim bloqueia, e só ele conta como pendente
    anexa(201, [{ slot: 'padrao', mime: 'image/jpeg', ext: 'jpg' }, { slot: 'medidor', mime: 'image/jpeg', ext: 'jpg' }, { slot: 'disjuntor', mime: 'image/jpeg', ext: 'jpg' }]);
    const novo = await trello(201, {});
    expect(novo.status).toBe(207);
    expect(novo.body).toMatchObject({ anexos_bloqueados: true, anexos: { pendentes: 1, ja_enviados: 5, bloqueados: true } });
    expect(anexosEnviados()).toHaveLength(0);
  });

  it('quadro privado no envio e público logo depois: o segundo envio bloqueia na hora, sem esperar cache', async () => {
    venda201();
    const primeiro = await trello(201, {});
    expect(primeiro.body.anexos.enviados).toBe(5);
    anexa(201, [{ slot: 'padrao', mime: 'image/jpeg', ext: 'jpg' }, { slot: 'medidor', mime: 'image/jpeg', ext: 'jpg' }, { slot: 'disjuntor', mime: 'image/jpeg', ext: 'jpg' }]);
    t.publico = true;   // o cache NÃO é limpo: "privado" não foi guardado
    t.chamadas = [];
    const segundo = await trello(201, {});
    expect(segundo.status).toBe(207);
    expect(segundo.body).toMatchObject({ anexos_bloqueados: true, anexos: { pendentes: 1, enviados: 0 } });
    expect(anexosEnviados()).toHaveLength(0);
  });

  it('arquivos do item "outros" não vão ao Trello (nem entram na prévia); os demais itens seguem', async () => {
    venda201();
    anexa(201, [
      { slot: 'padrao', mime: 'image/jpeg', ext: 'jpg' }, { slot: 'medidor', mime: 'image/jpeg', ext: 'jpg' },
      { slot: 'outros', mime: 'application/pdf', ext: 'pdf' }, { slot: 'contrato_assinado', mime: 'application/pdf', ext: 'pdf' },
    ]);
    const previa = await trello(201, { previa: true });
    expect(previa.body.anexos.map((a: any) => a.slot)).not.toContain('outros');
    expect(previa.body.anexos.map((a: any) => a.slot)).toContain('contrato_assinado');
    const res = await trello(201, {});
    expect(res.body.anexos.enviados).toBe(6);
    expect(anexosEnviados().map((a) => a.nome)).not.toContain('Outros documentos.pdf');
  });

  it('dois pedidos juntos (clique duplo) não duplicam cartão, checklist nem anexo: ou o segundo espera e vê tudo pronto, ou volta 409', async () => {
    venda201();
    const [a, b] = await Promise.all([trello(201, {}), trello(201, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    expect(criacoes()).toHaveLength(1);
    expect(t.checklists.get(a.body.cartao.id)).toHaveLength(2);
    expect(anexosEnviados()).toHaveLength(5);
    expect([a.body.criou_cartao, b.body.criou_cartao].sort()).toEqual([false, true]);
    expect(t.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/checklists')).toHaveLength(2);
  });

  it('dois pedidos juntos com o primeiro demorando: o segundo leva 409 (tentar de novo) e nada se duplica', async () => {
    venda201();
    t.atrasoCriarMs = 1600;   // a trava espera ~1 s e desiste
    const [a, b] = await Promise.all([trello(201, {}), trello(201, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const perdeu = a.status === 409 ? a : b;
    expect(perdeu.body).toMatchObject({ ok: false, conflito: true, tentarDeNovo: true });
    expect(criacoes()).toHaveLength(1);
    const id = (a.status === 200 ? a : b).body.cartao.id;
    expect(t.checklists.get(id)).toHaveLength(2);
    expect(anexosEnviados()).toHaveLength(5);
    // a trava é solta no fim: um novo pedido passa
    t.atrasoCriarMs = 0;
    expect((await trello(201, {})).status).toBe(200);
  });

  it('o quadro que não devolve as etiquetas na leitura: lê pela rota de etiquetas; se também falha, erro e nada é criado', async () => {
    venda201();
    t.semLabelsNoQuadro = true;
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    expect(criacoes()[0].params.idLabels.split(',')).toContain('lab-Trifásico');
    expect(res.body.etiquetas.ausentes).toEqual([]);

    t.quadro.cards = [];
    t.chamadas = [];
    h.linhas.delete('venda_solar:201');
    injeta(201, { proposta: 'P1', venda: '#0061' });
    t.labelsCaem = true;
    const falha = await trello(201, {});
    expect(falha.status).toBe(502);
    expect(escritas()).toEqual([]);
  });

  it('o Trello recusa a criação: 502 e nenhuma ligação gravada', async () => {
    venda201();
    t.falhaAoCriar = true;
    const res = await trello(201, {});
    expect(res.status).toBe(502);
    expect(ligacaoGravada(201)?.trello_card).toBeUndefined();
    expect(registroGravado(201)).toBeUndefined();
  });
});

describe('achar o cartão que já existe', () => {
  it('acha por #NNNN exato (#0061, não #00610), sem criar outro', async () => {
    venda201();
    t.quadro.cards.push(cartaoTrello(idFixo(2), '#00610 - Outro Cliente - Catalão GO'), cartaoTrello(idFixo(3), '#0061 - Ana Souza Oliveira - Uberlandia MG'));
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    expect(res.body.cartao.id).toBe(idFixo(3));
    expect(res.body.criou_cartao).toBe(false);
    expect(criacoes()).toHaveLength(0);
    expect((await lerLigacao(201)).lig.trello_card).toBe(idFixo(3));
  });

  it('empate nunca escolhe nem cria: 409 com os candidatos; card_id escolhe, mas só entre os cartões do quadro', async () => {
    venda201();
    t.quadro.cards.push(cartaoTrello(idFixo(3), '#0061 - Ana Souza Oliveira - Uberlandia MG'), cartaoTrello(idFixo(4), '#0061 - Ana Souza - Uberlândia MG'));
    const res = await trello(201, {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, precisa: 'escolher_cartao' });
    expect(res.body.candidatos.map((c: any) => c.id).sort()).toEqual([idFixo(3), idFixo(4)]);
    expect(escritas()).toHaveLength(0);
    expect(ligacaoGravada(201)?.trello_card).toBeUndefined();

    const fora = await trello(201, { card_id: idFixo(77) });
    expect(fora.status).toBe(400);
    expect(escritas()).toHaveLength(0);

    const escolhido = await trello(201, { card_id: idFixo(4) });
    expect(escolhido.status).toBe(200);
    expect(escolhido.body.cartao.id).toBe(idFixo(4));
    expect(criacoes()).toHaveLength(0);
  });

  it('empate por nome (sem venda ligada) também devolve candidatos', async () => {
    cadastro(201, { email: 'a@b.com' });
    t.quadro.cards.push(cartaoTrello(idFixo(5), 'Ana Souza Lima - Uberlândia MG'), cartaoTrello(idFixo(6), 'Ana Souza Pires - Araguari MG'));
    const res = await trello(201, {});
    expect(res.status).toBe(409);
    expect(res.body.candidatos).toHaveLength(2);
    expect(criacoes()).toHaveLength(0);
  });
});

describe('cartão que já existe', () => {
  it('não duplica checklist, só marca o que ficou completo e nunca desmarca; não mexe na descrição; ficha vai em comentário; etiqueta só acrescenta', async () => {
    venda201();
    const id = idFixo(3);
    t.quadro.cards.push(cartaoTrello(id, '#0061 - Ana Souza Oliveira - Uberlandia MG', ['Rural', 'Cemig']));
    t.checklists.set(id, [
      checklist('BACKOFFICE', [['Foto Disjuntor', false], ['Foto n° do Medidor', false], ['Foto Padrão', true], ['Telefone', false], ['Email', true], ['KMZ', true]]),
      checklist('ENGENHARIA', [['Art Gerada', true], ['Art Paga', false]]),
    ]);
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ criou_cartao: false, ficha: 'comentario' });
    // nenhuma checklist nova, e nenhuma escrita na descrição ou no nome do cartão
    expect(t.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/checklists')).toHaveLength(0);
    expect(t.chamadas.filter((c) => c.metodo === 'PUT' && c.caminho === `/cards/${id}`)).toHaveLength(0);
    const [back, eng] = t.checklists.get(id)!;
    const estado = (c: any) => Object.fromEntries(c.checkItems.map((i: any) => [i.name, i.state]));
    // marcou o medidor e o telefone (completos agora); manteve Foto Padrão, Email e KMZ marcados; disjuntor segue desmarcado
    expect(estado(back)).toEqual({ 'Foto Disjuntor': 'incomplete', 'Foto n° do Medidor': 'complete', 'Foto Padrão': 'complete', Telefone: 'complete', Email: 'complete', KMZ: 'complete' });
    expect(estado(eng)).toEqual({ 'Art Gerada': 'complete', 'Art Paga': 'incomplete' });
    // etiquetas: já tinha Rural e Cemig; entram Trifásico e EXDEDENTES
    const postas = t.chamadas.filter((c) => c.metodo === 'POST' && /idLabels$/.test(c.caminho)).map((c) => c.params.value).sort();
    expect(postas).toEqual(['lab-EXDEDENTES', 'lab-Trifásico']);
    // a ficha é UM comentário; no segundo envio ele é editado, não empilhado
    expect(t.chamadas.filter((c) => c.metodo === 'POST' && /actions\/comments$/.test(c.caminho))).toHaveLength(1);
    t.chamadas = [];
    await trello(201, {});
    expect(t.chamadas.filter((c) => c.metodo === 'POST' && /actions\/comments$/.test(c.caminho))).toHaveLength(0);
    expect(t.chamadas.filter((c) => c.metodo === 'PUT' && /actions\/[^/]+\/comments$/.test(c.caminho))).toHaveLength(1);
  });

  it('etiqueta do mesmo grupo já no cartão não ganha a segunda: avisa e não muda', async () => {
    venda201();
    const id = idFixo(3);
    t.quadro.cards.push(cartaoTrello(id, '#0061 - Ana Souza Oliveira - Uberlandia MG', ['Bifásico', 'Urbana']));
    const res = await trello(201, {});
    expect(res.status).toBe(200);
    expect(res.body.etiquetas.conflitos).toEqual([{ desejada: 'Trifásico', existente: 'Bifásico' }, { desejada: 'Rural', existente: 'Urbana' }]);
    const postas = t.chamadas.filter((c) => c.metodo === 'POST' && /idLabels$/.test(c.caminho)).map((c) => c.params.value).sort();
    expect(postas).toEqual(['lab-Cemig', 'lab-EXDEDENTES']);
    expect(res.body.avisos.join(' ')).toMatch(/mesmo grupo/);
  });

  it('etiqueta que não existe no quadro não é criada (sai nos avisos)', async () => {
    venda201();
    t.quadro.labels = t.quadro.labels.filter((e) => e.name !== 'Cemig');
    const res = await trello(201, {});
    expect(res.body.etiquetas.ausentes).toEqual(['Cemig']);
    expect(criacoes()[0].params.idLabels).not.toMatch(/Cemig/);
    expect(t.chamadas.some((c) => c.caminho === '/labels')).toBe(false);
  });

  it('anexo que o dossiê antigo já pôs neste mesmo cartão não sobe de novo', async () => {
    venda201();
    const id = idFixo(3);
    t.quadro.cards.push(cartaoTrello(id, '#0061 - Ana Souza Oliveira - Uberlandia MG'));
    const anexoAntigo = novoId();
    t.anexos.set(id, [{ id: anexoAntigo, name: 'CNH ou identidade.pdf' }]);
    const p = h.propostas[0];
    p.dados.dossie.trello = { card_id: id, card_nome: 'x', status: 'enviado', motivo: null, em: null };
    p.dados.dossie.arquivos.documento[0].trello_anexo_id = anexoAntigo;
    const res = await trello(201, {});
    expect(res.body.anexos).toMatchObject({ ja_enviados: 1, enviados: 4 });
    expect(anexosEnviados().map((a) => a.nome)).not.toContain('CNH ou documento do titular da homologação.pdf');
  });
});

describe('prévia', () => {
  it('titular da homologação é outra pessoa: título com o negociador entre parênteses; cartão só pelo titular vira empate, nunca achou', async () => {
    venda201();
    cadastro(201, {
      nome: 'Ana Souza Oliveira', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Eloisa Elena Lima', endereco_ponto: 'Rua A, 10, Centro, Uberlândia - MG',
    });
    const res = await trello(201, { previa: true });
    expect(res.status).toBe(200);
    expect(res.body.titulo).toBe('#0061 - (Ana) Eloisa Elena Lima - Uberlândia MG');
    expect(res.body.cartao).toBeNull();
    // venda #0061 ligada e um cartão de OUTRA venda (#0070) com o nome do titular: empate para confirmar, não é escolhido sozinho
    t.quadro.cards.push(cartaoTrello(idFixo(5), '#0070 - (Ana) Eloisa Elena Lima - Uberlândia MG'));
    const r2 = await trello(201, { previa: true });
    expect(r2.status).toBe(200);
    expect(r2.body.cartao).toBeNull();
    expect(r2.body.candidatos.map((c: any) => c.id)).toEqual([idFixo(5)]);
    expect(r2.body.motivo_empate).toContain('titular');
    // o envio de verdade também não escolhe nem cria: 409 com o candidato
    const envio = await trello(201, {});
    expect(envio.status).toBe(409);
    expect(envio.body).toMatchObject({ ok: false, precisa: 'escolher_cartao' });
    expect(criacoes()).toHaveLength(0);
    // com o #0061 no título, o número decide
    t.quadro.cards.push(cartaoTrello(idFixo(6), '#0061 - (Ana) Eloisa Elena Lima - Uberlândia MG'));
    const r3 = await trello(201, { previa: true });
    expect(r3.body.cartao).toMatchObject({ existente: true, id: idFixo(6), achado_por: 'numero' });
  });

  it('devolve o que faria e NÃO escreve: nem no Trello, nem na ligação, nem no registro', async () => {
    venda201();
    const antes = JSON.stringify([...h.linhas.entries()]);
    const res = await trello(201, { previa: true, etiquetas_extra: ['Equipe Pablo'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, previa: true, quadro_publico: false, anexos_bloqueados: false, cartao: null, titulo: '#0061 - Ana Souza Oliveira - Uberlândia MG', lista: 'BASE DE CLIENTES' });
    expect(res.body.etiquetas.aplicar).toEqual(['Trifásico', 'Rural', 'Cemig', 'EXDEDENTES', 'Equipe Pablo']);
    expect(res.body.descricao).toContain('**18 - Canadian CS7N 600W**');
    expect(res.body.comentario).toBeNull();
    expect(res.body.checklists.BACKOFFICE.filter((i: any) => i.marcado).map((i: any) => i.nome)).toContain('Conta de Energia');
    expect(res.body.checklists.criar).toEqual(['BACKOFFICE', 'ENGENHARIA']);
    expect(res.body.anexos).toHaveLength(5);
    expect(res.body.anexos.every((a: any) => a.ja_enviado === false)).toBe(true);
    expect(escritas()).toEqual([]);
    expect(JSON.stringify([...h.linhas.entries()])).toBe(antes);
    expect(h.dossie.size).toBe(3);
  });
  it('de um cartão que já existe: comentário no lugar da descrição, o que marcaria, e sem escrever', async () => {
    venda201();
    const id = idFixo(3);
    t.quadro.cards.push(cartaoTrello(id, '#0061 - Ana Souza Oliveira - Uberlandia MG'));
    t.checklists.set(id, [checklist('BACKOFFICE', [['Foto Padrão', false]])]);
    const res = await trello(201, { previa: true });
    expect(res.body.cartao).toMatchObject({ existente: true, id, achado_por: 'numero' });
    expect(res.body.descricao).toBeNull();
    expect(res.body.comentario).toContain('Ficha da venda solar');
    expect(res.body.checklists.criar).toEqual(['ENGENHARIA']);
    expect(res.body.checklists.marcar).toEqual(['Foto Padrão']);
    expect(escritas()).toEqual([]);
  });
  it('no quadro público a prévia já avisa que os anexos ficam de fora', async () => {
    venda201();
    t.publico = true;
    const res = await trello(201, { previa: true });
    expect(res.body).toMatchObject({ quadro_publico: true, anexos_bloqueados: true });
  });
});

describe('a ligação com o cartão não atrapalha os vínculos', () => {
  const ID_TRELLO = idFixo(50);
  it('ligação criada só para guardar o cartão ainda deixa o vínculo automático por telefone ligar, levando o cartão junto', async () => {
    injeta(204, { por: 'trello', trello_card: ID_TRELLO });
    const res = await get('/vendas-solares/204/vinculos', GIOVANNA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ proposta: 'P3', por: 'auto' });
    expect(ligacaoGravada(204)).toMatchObject({ proposta: 'P3', por: 'auto', trello_card: ID_TRELLO });
    expect((await lerLigacao(204)).lig.trello_card).toBe(ID_TRELLO);
  });
  it('desligar de propósito (ligação de gente, nada ligado) continua sem religar sozinho', async () => {
    injeta(204, { por: 'giovanna', trello_card: ID_TRELLO });
    const res = await get('/vendas-solares/204/vinculos', GIOVANNA);
    expect(res.body.proposta).toBeNull();
    expect(res.body.sugestoes.propostas.map((p: any) => p.codigo)).toContain('P3');
  });
  it('religar ou desligar a proposta mantém o cartão do Trello', async () => {
    injeta(204, { proposta: 'P3', por: 'giovanna', trello_card: ID_TRELLO });
    const res = await post('/vendas-solares/204/vinculos', { proposta: null }, GIOVANNA);
    expect(res.status).toBe(200);
    expect(ligacaoGravada(204)).toMatchObject({ proposta: null, trello_card: ID_TRELLO });
    expect((await lerLigacao(204)).lig.trello_card).toBe(ID_TRELLO);
  });
});

describe('dossiê da proposta com o quadro público', () => {
  const enviar = () => post('/dossie/P1/trello', {});
  beforeEach(() => {
    t.quadro.cards.push(cartaoTrello(idFixo(3), '#0061 - Ana Souza Oliveira - Uberlandia MG'));
  });

  it('quadro privado: anexa tudo como sempre e fecha como enviado', async () => {
    const res = await enviar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, enviados: 3, falhas: 0 });
    expect(res.body.anexos_bloqueados).toBeUndefined();
    expect(anexosEnviados()).toHaveLength(3);
    expect(h.propostas[0].dados.dossie.trello.status).toBe('enviado');
  });

  it('quadro PÚBLICO: nenhum anexo, arquivos seguem pendentes, o envio não vira enviado, a ficha vai', async () => {
    t.publico = true;
    const res = await enviar();
    expect(res.status).toBe(207);
    expect(res.body).toMatchObject({
      ok: false, anexos_bloqueados: true, enviados: 0,
      error: 'O quadro do Trello está público: não anexo documento pessoal. Deixe o quadro privado no Trello e tente de novo.',
    });
    expect(anexosEnviados()).toHaveLength(0);
    const d = h.propostas[0].dados.dossie;
    expect(d.trello.status).toBe('pendente');
    expect(d.trello.status).not.toBe('enviado');
    expect(d.trello.motivo).toMatch(/público/);
    for (const lista of Object.values(d.arquivos) as any[][]) for (const a of lista) expect(a.trello_status).toBe('pendente');
    // o cartão é atualizado sem anexo: a ficha técnica continua indo
    expect(t.chamadas.filter((c) => c.metodo === 'POST' && /actions\/comments$/.test(c.caminho))).toHaveLength(1);
  });

  it('quadro PÚBLICO: a ficha do dossiê (comentário e descrição do cartão novo) sai sem o e-mail do cliente; no privado segue completa', async () => {
    h.propostas[0].dados.dossie.campos = { email: 'ana@exemplo.com', qtd_placa: '18' };
    const textos = () => t.chamadas.filter((c) => /actions\/comments$/.test(c.caminho)).map((c) => c.params.text);
    t.publico = true;
    expect((await enviar()).status).toBe(207);
    expect(textos()).toHaveLength(1);
    expect(textos()[0]).not.toContain('ana@exemplo.com');
    expect(textos()[0]).toContain('Telefone e e-mail no gerador (quadro público).');
    // cartão novo: a descrição
    t.quadro.cards = [];
    t.chamadas = [];
    h.propostas[0].dados.dossie.trello = {};
    const novo = await enviar();
    expect(novo.body.criou_cartao).toBe(true);
    expect(criacoes()[0].params.desc).not.toContain('ana@exemplo.com');
    expect(criacoes()[0].params.desc).toContain('Telefone e e-mail no gerador (quadro público).');
    // privado: completa (o cache curto de "público" é limpo: o quadro que fecha só é visto depois dele)
    limparCacheQuadroPublico();
    t.publico = false;
    t.chamadas = [];
    h.propostas[0].dados.dossie.trello = { card_id: null, card_nome: null, status: 'pendente', motivo: null, em: null };
    t.quadro.cards = [cartaoTrello(idFixo(3), '#0061 - Ana Souza Oliveira - Uberlandia MG')];
    const privado = await enviar();
    expect(privado.status).toBe(200);
    expect(textos()[0]).toContain('- E-mail: ana@exemplo.com');
  });

  it('quadro público sem nada pendente para anexar não bloqueia', async () => {
    t.publico = true;
    for (const lista of Object.values(h.propostas[0].dados.dossie.arquivos) as any[][]) for (const a of lista) { a.trello_status = 'enviado'; a.trello_anexo_id = novoId(); }
    const res = await enviar();
    expect(res.status).toBe(200);
    expect(res.body.anexos_bloqueados).toBeUndefined();
  });
});
