import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import JSZip from 'jszip';

// Rotas da Vistoria (autenticadas em /vistorias e públicas em /v) contra o banco falso e um bucket
// em memória. Dados inventados, nada sai para a rede. Prova: status que descarta lixo, 409 em vistoria
// concluída, 503 quando as colunas novas não existem, assinatura exigindo nome e PNG de verdade, reabrir,
// GET com e sem colunas, a lista de compras (PUT, GET e a contagem de leituras), o ZIP autenticado com o
// documento pessoal, relatório público com e sem selo, com a marca do integrador e o cadastro do cliente, o
// documento pessoal fora do link público e do ZIP público, o rodapé do PDF, a lista de compras no relatório e no nome do PDF, e o PDF em 302.

const h = vi.hoisted(() => ({
  objetos: new Map<string, Buffer>(),
  removidos: [] as string[],
  navegador: { abriu: 0, fechou: 0, html: '' as string, falha: false, opcoes: null as unknown },
  // Contagem de leituras (maybeSingle) em `vistorias` e gancho para simular outra requisição no meio.
  leituras: 0,
  aoLer: null as null | ((n: number) => void),
  // Atraso (ms) por caminho no download do Storage: prova que a ordem do ZIP não depende de quem termina primeiro.
  atrasoMs: new Map<string, number>(),
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: () => void) => {
    const u = req.headers['x-user'];
    if (!u) { res.status(401).json({ error: 'Token não fornecido' }); return; }
    req.userId = String(u);
    next();
  },
}));
vi.mock('../utils/supabase', async () => {
  const falso = await import('./_bancoFalso');
  const storage = {
    from: () => ({
      upload: async (path: string, buf: Buffer) => { h.objetos.set(path, buf); return { data: { path }, error: null }; },
      remove: async (paths: string[]) => { for (const p of paths) { h.objetos.delete(p); h.removidos.push(p); } return { data: [], error: null }; },
      list: async (prefixo: string, opts?: { search?: string }) => ({
        data: [...h.objetos.keys()]
          .filter((p) => p.startsWith(prefixo + '/'))
          .map((p) => ({ name: p.slice(prefixo.length + 1) }))
          .filter((a) => !opts?.search || a.name.includes(opts.search)),
        error: null,
      }),
      createSignedUrl: async (path: string, _validade?: number, opcoes?: { download?: string }) => ({
        data: { signedUrl: `https://storage.test/${path}?token=abc${opcoes?.download ? `&download=${encodeURIComponent(opcoes.download)}` : ''}` },
        error: null,
      }),
      download: async (path: string) => {
        const ms = h.atrasoMs.get(path);
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const buf = h.objetos.get(path);
        if (!buf) return { data: null, error: { message: 'Object not found' } };
        return { data: { arrayBuffer: async () => new Uint8Array(buf).buffer }, error: null };
      },
    }),
  };
  const from = (t: string) => {
    const c: any = falso.supabase.from(t);
    if (t === 'vistorias') {
      const orig = c.maybeSingle.bind(c);
      c.maybeSingle = async () => { h.leituras++; h.aoLer?.(h.leituras); return orig(); };
    }
    return c;
  };
  return { supabase: { ...falso.supabase, from, storage } };
});
vi.mock('../controllers/pdfController', () => ({
  abrirNavegador: async () => {
    h.navegador.abriu++;
    return {
      newPage: async () => ({
        setJavaScriptEnabled: async () => {},
        setContent: async (html: string) => { h.navegador.html = html; if (h.navegador.falha) throw new Error('chromium caiu'); },
        pdf: async (opcoes?: unknown) => { h.navegador.opcoes = opcoes; return new Uint8Array([37, 80, 68, 70]); },
      }),
      close: async () => { h.navegador.fechou++; },
    };
  },
}));

import { banco } from './_bancoFalso';
import { logger } from '../utils/logger';
import { urlPublica } from '../services/relatorio/base';
import vistoriasRoutes, { CHECKLIST_VISTORIA, montarZipDaVistoria, slugify } from '../routes/vistorias';
import publicVistoriaRoutes from '../routes/publicVistoria';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/vistorias', vistoriasRoutes);
app.use('/v', publicVistoriaRoutes);

const U1 = 'user-1';
const U2 = 'user-2';
const ID = '11111111-1111-4111-8111-111111111111';
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
const NAO_PNG = 'data:image/png;base64,' + Buffer.from('isto nao e um png de verdade').toString('base64');
const COLUNA_AUSENTE = { code: '42703', message: 'column vistorias.status_itens does not exist' };
const BANCO_FORA = { code: '57P01', message: 'terminating connection due to administrator command' };
const COMPRAS_AUSENTE = { code: '42703', message: 'column vistorias.compras does not exist' };

const get = (url: string, user = U1) => request(app).get(url).set('x-user', user);
const post = (url: string, body: unknown = {}, user = U1) => request(app).post(url).set('x-user', user).send(body as object);
const put = (url: string, body: unknown, user = U1) => request(app).put(url).set('x-user', user).send(body as object);
const del = (url: string, user = U1) => request(app).delete(url).set('x-user', user);

const linha = () => banco.linhas('vistorias').find((r) => r.id === ID)!;

function poeVistoria(extra: Record<string, unknown> = {}, comColunas = true) {
  banco.poe('vistorias', {
    id: ID, user_id: U1, cliente_id: null, cliente_nome: 'Maria Souza', status: 'em_andamento', localizacao: null,
    created_at: '2026-10-20T12:00:00.000Z',
    itens: CHECKLIST_VISTORIA.map((c) => ({
      key: c.key, label: c.label, dica: c.dica, obs: '',
      fotos: c.key === 'padrao'
        ? [{ url: `vistorias/${U1}/${ID}/padrao-1.jpg`, ts: 't', tipo: 'image' }, { url: `vistorias/${U1}/${ID}/padrao-2.pdf`, ts: 't', tipo: 'file', nome: 'laudo.pdf' }]
        : c.key === 'telhado' ? [{ url: `vistorias/${U1}/${ID}/telhado-1.jpg`, ts: 't', tipo: 'image' }] : [],
    })),
    ...(comColunas ? { status_itens: {}, assinaturas: {} } : {}),
    ...extra,
  });
}

beforeEach(() => {
  banco.reset();
  h.objetos.clear();
  h.removidos.length = 0;
  h.navegador.abriu = 0; h.navegador.fechou = 0; h.navegador.html = ''; h.navegador.falha = false; h.navegador.opcoes = null;
  h.leituras = 0; h.aoLer = null; h.atrasoMs.clear();
});

describe('PUT /:id/status', () => {
  it('grava só chave técnica com valor válido e devolve o resumo', async () => {
    poeVistoria();
    const r = await put(`/vistorias/${ID}/status`, {
      status_itens: { padrao: 'conforme', conta_luz: 'conforme', telhado: 'otimo', medidor: 'na', inventada: 'atencao', sombreamento: 'atencao' },
    });
    expect(r.status).toBe(200);
    expect(linha().status_itens).toEqual({ padrao: 'conforme', medidor: 'na', sombreamento: 'atencao' });
    expect(r.body.resumo.selo).toBe('atencao');
    expect(r.body.resumo.pendencias.map((p: any) => p.key)).toEqual(['sombreamento']);
  });
  it('mapa vazio limpa tudo', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    expect((await put(`/vistorias/${ID}/status`, { status_itens: {} })).status).toBe(200);
    expect(linha().status_itens).toEqual({});
  });
  it('corpo que não é mapa é 400', async () => {
    poeVistoria();
    expect((await put(`/vistorias/${ID}/status`, { status_itens: 'conforme' })).status).toBe(400);
    expect((await put(`/vistorias/${ID}/status`, {})).status).toBe(400);
  });
  it('vistoria concluída é 409 e nada é gravado', async () => {
    poeVistoria({ status: 'concluida' });
    banco.escritas.length = 0;
    const r = await put(`/vistorias/${ID}/status`, { status_itens: { padrao: 'conforme' } });
    expect(r.status).toBe(409);
    expect(banco.escritas).toHaveLength(0);
  });
  it('coluna ainda não existe é 503 migracao_pendente', async () => {
    poeVistoria({}, false);
    banco.falhas['vistorias.select'] = { erro: COLUNA_AUSENTE, uma: true, pular: 1 };
    const r = await put(`/vistorias/${ID}/status`, { status_itens: { padrao: 'conforme' } });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('migracao_pendente');
  });
  it('erro do banco que NÃO é coluna ausente responde 500 e não grava nada', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 1 };
    banco.escritas.length = 0;
    const r = await put(`/vistorias/${ID}/status`, { status_itens: { telhado: 'atencao' } });
    expect(r.status).toBe(500);
    expect(r.body.error).not.toBe('migracao_pendente');
    expect(banco.escritas).toHaveLength(0);
    expect(linha().status_itens).toEqual({ padrao: 'conforme' });
  });
  it('vistoria de outro usuário é 404; sem login é 401', async () => {
    poeVistoria();
    expect((await put(`/vistorias/${ID}/status`, { status_itens: {} }, U2)).status).toBe(404);
    expect((await request(app).put(`/vistorias/${ID}/status`).send({ status_itens: {} })).status).toBe(401);
  });
});

describe('assinatura', () => {
  it('técnico sem nome é 400', async () => {
    poeVistoria();
    expect((await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: '  ', png: PNG })).status).toBe(400);
    expect(h.objetos.size).toBe(0);
  });
  it('PNG que não é PNG de verdade, ou sem o prefixo, é 400', async () => {
    poeVistoria();
    expect((await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: NAO_PNG })).status).toBe(400);
    expect((await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: PNG.split(',')[1] })).status).toBe(400);
    expect((await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD' })).status).toBe(400);
    expect(h.objetos.size).toBe(0);
  });
  it('PNG grande demais é 413', async () => {
    poeVistoria();
    const grande = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600_000)]).toString('base64');
    expect((await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: grande })).status).toBe(413);
  });
  it('grava a do técnico com registro e a do cliente sem nome', async () => {
    poeVistoria();
    const t = await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno Lima', registro: 'CFT 123', png: PNG });
    expect(t.status).toBe(200);
    expect(t.body.path).toMatch(new RegExp(`^vistorias/${U1}/${ID}/assinatura-tecnico-\\d+\\.png$`));
    expect(t.body.url).toContain('https://storage.test/');
    expect(h.objetos.has(t.body.path)).toBe(true);
    const c = await post(`/vistorias/${ID}/assinatura`, { papel: 'cliente', nome: '', png: PNG });
    expect(c.status).toBe(200);
    expect(linha().assinaturas.tecnico).toMatchObject({ nome: 'Bruno Lima', registro: 'CFT 123' });
    expect(linha().assinaturas.cliente).toBeTruthy();
    expect(linha().assinaturas.cliente.registro).toBeUndefined();
  });
  it('assinar de novo troca a do mesmo papel e apaga o PNG anterior', async () => {
    poeVistoria();
    const a = await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: PNG });
    await new Promise((r) => setTimeout(r, 5));
    const b = await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: PNG });
    expect(b.status).toBe(200);
    expect(linha().assinaturas.tecnico.path).toBe(b.body.path);
    expect(h.removidos).toContain(a.body.path);
    expect(h.objetos.has(a.body.path)).toBe(false);
  });
  it('concluída é 409; coluna ausente é 503', async () => {
    poeVistoria({ status: 'concluida' });
    expect((await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'B', png: PNG })).status).toBe(409);
    banco.reset();
    poeVistoria({}, false);
    banco.falhas['vistorias.select'] = { erro: COLUNA_AUSENTE, uma: true, pular: 1 };
    const r = await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'B', png: PNG });
    expect(r.status).toBe(503);
    expect(h.objetos.size).toBe(0);
  });
  it('se a releitura antes de gravar falhar, apaga o PNG recém-subido e não grava', async () => {
    poeVistoria();
    banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 2 };
    banco.escritas.length = 0;
    const r = await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', png: PNG });
    expect(r.status).toBe(500);
    expect(h.objetos.size).toBe(0);
    expect(banco.escritas).toHaveLength(0);
    expect(linha().assinaturas).toEqual({});
  });
  it('corrida: se outra requisição sobrescreveu no meio, junta as duas e regrava', async () => {
    poeVistoria();
    // leitura 1 = getOwned, 2 = checagem inicial, 3 = releitura, 4 = conferência depois de gravar.
    const antiga = { path: `vistorias/${U1}/${ID}/assinatura-tecnico-antiga.png`, nome: 'Antigo', registro: 'CFT 0', ts: 't' };
    const doCliente = { path: `vistorias/${U1}/${ID}/assinatura-cliente-1.png`, nome: 'Maria', ts: 't' };
    linha().assinaturas = { tecnico: antiga };
    h.aoLer = (n) => { if (n === 4) linha().assinaturas = { tecnico: antiga, cliente: doCliente }; };
    const r = await post(`/vistorias/${ID}/assinatura`, { papel: 'tecnico', nome: 'Bruno', registro: 'CFT 1', png: PNG });
    expect(r.status).toBe(200);
    expect(linha().assinaturas.tecnico.path).toBe(r.body.path);
    expect(linha().assinaturas.cliente).toEqual(doCliente);
  });
  it('apagar remove o arquivo e a chave', async () => {
    poeVistoria();
    const a = await post(`/vistorias/${ID}/assinatura`, { papel: 'cliente', nome: 'Maria', png: PNG });
    expect((await del(`/vistorias/${ID}/assinatura?papel=cliente`)).status).toBe(200);
    expect(linha().assinaturas.cliente).toBeUndefined();
    expect(h.objetos.has(a.body.path)).toBe(false);
    expect((await del(`/vistorias/${ID}/assinatura?papel=outro`)).status).toBe(400);
  });
});

describe('reabrir e concluir', () => {
  it('reabrir volta concluída para em andamento; em andamento é 409', async () => {
    poeVistoria({ status: 'concluida' });
    const r = await post(`/vistorias/${ID}/reabrir`);
    expect(r.status).toBe(200);
    expect(linha().status).toBe('em_andamento');
    expect((await post(`/vistorias/${ID}/reabrir`)).status).toBe(409);
  });
  it('reabrir vistoria de outro usuário é 404', async () => {
    poeVistoria({ status: 'concluida' });
    expect((await post(`/vistorias/${ID}/reabrir`, {}, U2)).status).toBe(404);
    expect(linha().status).toBe('concluida');
  });
  it('concluir sem nenhum status continua valendo e devolve resumo sem selo', async () => {
    poeVistoria();
    const r = await post(`/vistorias/${ID}/concluir`);
    expect(r.status).toBe(200);
    expect(linha().status).toBe('concluida');
    expect(r.body.resumo.selo).toBeNull();
    expect(r.body.resumo.itensComFoto).toBe(2);
  });
  it('concluir com status devolve o selo', async () => {
    poeVistoria({ status_itens: { telhado: 'nao_conforme' } });
    expect((await post(`/vistorias/${ID}/concluir`)).body.resumo.selo).toBe('nao_conforme');
  });
});

describe('GET', () => {
  it('/:id com as colunas novas traz status, assinaturas e resumo', async () => {
    poeVistoria({
      status_itens: { padrao: 'atencao' },
      assinaturas: { tecnico: { path: `vistorias/${U1}/${ID}/assinatura-tecnico-1.png`, nome: 'Bruno', registro: 'CFT 1', ts: 't' } },
    });
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.extras_disponiveis).toBe(true);
    expect(r.body.status_itens).toEqual({ padrao: 'atencao' });
    expect(r.body.resumo.selo).toBe('atencao');
    expect(r.body.assinaturas_url.tecnico).toContain('assinatura-tecnico-1.png');
    expect(r.body.itens).toHaveLength(12);
    expect(r.body.itens[2].fotos[0].signed).toContain('https://storage.test/');
  });
  it('/:id sem as colunas ainda responde 200, vazio e com extras_disponiveis falso', async () => {
    poeVistoria({}, false);
    banco.falhas['vistorias.select'] = { erro: COLUNA_AUSENTE, uma: true, pular: 1 };
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.extras_disponiveis).toBe(false);
    expect(r.body.status_itens).toEqual({});
    expect(r.body.resumo.selo).toBeNull();
    expect(r.body.itens).toHaveLength(12);
  });
  it('/:id com erro de banco que não é coluna ausente é 500, não "sem migration"', async () => {
    poeVistoria();
    banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 1 };
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(500);
  });
  it('/:id de outro usuário é 404', async () => {
    poeVistoria();
    expect((await get(`/vistorias/${ID}`, U2)).status).toBe(404);
  });
  it('/list serve a tabela: situação, progresso e selo', async () => {
    poeVistoria({ status_itens: { telhado: 'atencao' } });
    const r = await get('/vistorias/list');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ id: ID, cliente_nome: 'Maria Souza', status: 'em_andamento', total: 12, preenchidos: 2, selo: 'atencao' });
    expect(r.body[0].created_at).toBeTruthy();
  });
  it('/list sem as colunas novas devolve selo nulo', async () => {
    poeVistoria({}, false);
    banco.falhas['vistorias.select'] = { erro: COLUNA_AUSENTE, uma: true, pular: 1 };
    const r = await get('/vistorias/list');
    expect(r.status).toBe(200);
    expect(r.body[0].selo).toBeNull();
  });
});

// ── Lista de compras ───────────────────────────────────────────────────────────────────────────────

// Linha de material com id válido (^[a-z0-9]{6,24}$). Só o que muda entra em `extra`.
const material = (n: number, extra: Record<string, unknown> = {}) => ({
  id: 'linha' + String(n).padStart(3, '0'), tipo: 'material', nome: `Material ${n}`, qtd: 1, un: 'un', quem: 'cliente', obs: '', ...extra,
});

describe('PUT /:id/compras', () => {
  const url = `/vistorias/${ID}/compras`;
  // Entrada suja: nome em minúscula, 3 casas, espaços repetidos, travessão, e uma linha com id curto demais.
  const bruto = [
    { id: 'm3k9x2ab', tipo: 'material', nome: 'caixa de medição', esp: 'Modelo aprovado pela distribuidora.', qtd: 2.345, un: 'un', quem: 'cliente', item: 'padrao', cid: 'caixa-medicao', obs: 'Do lado   da  garagem.', ts: '2026-10-29T14:03:11.000Z' },
    { id: 'm3ka1c3h', tipo: 'obs', obs: 'Telha antiga ' + String.fromCharCode(0x2014) + ' pode ter amianto.', item: 'tipo_telha' },
    { id: 'lixo', tipo: 'material', nome: 'Id curto demais' },
  ];
  const limpo = [
    { id: 'm3k9x2ab', tipo: 'material', nome: 'Caixa de medição', esp: 'Modelo aprovado pela distribuidora.', qtd: 2.35, un: 'un', quem: 'cliente', item: 'padrao', cid: 'caixa-medicao', obs: 'Do lado da garagem.', ts: '2026-10-29T14:03:11.000Z' },
    { id: 'm3ka1c3h', tipo: 'obs', obs: 'Telha antiga - pode ter amianto.', item: 'tipo_telha' },
  ];

  it('grava a lista saneada, devolve o que gravou e conta as linhas descartadas', async () => {
    poeVistoria();
    const r = await put(url, { linhas: bruto });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.compras).toEqual({ v: 1, publica: true, linhas: limpo });
    expect(r.body.descartadas).toBe(1);
    expect(linha().compras).toEqual({ v: 1, publica: true, linhas: limpo });
  });
  it('publica omitido mantém o valor gravado; publica informado troca', async () => {
    poeVistoria({ compras: { v: 1, publica: false, linhas: [] } });
    const a = await put(url, { linhas: [material(1)] });
    expect(a.status).toBe(200);
    expect(a.body.compras.publica).toBe(false);
    expect(linha().compras.publica).toBe(false);
    const b = await put(url, { publica: true, linhas: [material(1)] });
    expect(b.body.compras.publica).toBe(true);
    expect(linha().compras.publica).toBe(true);
  });
  it('repetir o mesmo corpo dá o mesmo resultado; lista vazia limpa tudo', async () => {
    poeVistoria();
    expect((await put(url, { linhas: bruto })).status).toBe(200);
    const antes = JSON.parse(JSON.stringify(linha().compras));
    expect((await put(url, { linhas: bruto })).status).toBe(200);
    expect(linha().compras).toEqual(antes);
    expect((await put(url, { linhas: [] })).status).toBe(200);
    expect(linha().compras).toEqual({ v: 1, publica: true, linhas: [] });
  });
  it('só a coluna da lista muda: status, assinaturas e itens ficam como estavam, e não passa por RPC', async () => {
    poeVistoria({ status_itens: { padrao: 'atencao' } });
    const itensAntes = JSON.stringify(linha().itens);
    const r = await put(url, { linhas: [material(1)] });
    expect(r.status).toBe(200);
    expect(banco.escritas).toHaveLength(1);
    expect(banco.escritas[0]).toMatchObject({ tabela: 'vistorias', op: 'update' });
    expect(Object.keys(banco.escritas[0].payload).sort()).toEqual(['compras', 'updated_at']);
    expect(linha().status_itens).toEqual({ padrao: 'atencao' });
    expect(linha().assinaturas).toEqual({});
    expect(JSON.stringify(linha().itens)).toBe(itensAntes);
    expect(banco.rpcChamadas).toEqual([]);
  });
  it('corpo que não tem o formato é 400 e nada é gravado', async () => {
    poeVistoria();
    const corpos = [{ linhas: 'x' }, {}, { linhas: [], publica: 'sim' }, { linhas: Array.from({ length: 201 }, (_, i) => material(i)) }];
    for (const corpo of corpos) {
      const r = await put(url, corpo);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Dados inválidos');
    }
    expect(banco.escritas).toHaveLength(0);
    expect(linha().compras).toBeUndefined();
  });
  it('60 linhas passam; 61 válidas é 400 "A lista aceita até 60 itens." e nada é gravado; linha ruim não ocupa vaga', async () => {
    poeVistoria();
    const ok = await put(url, { linhas: Array.from({ length: 60 }, (_, i) => material(i)) });
    expect(ok.status).toBe(200);
    expect(ok.body.compras.linhas).toHaveLength(60);
    expect(ok.body.descartadas).toBe(0);

    banco.escritas.length = 0;
    const antes = JSON.stringify(linha().compras);
    const r = await put(url, { linhas: Array.from({ length: 61 }, (_, i) => material(i)) });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('A lista aceita até 60 itens.');
    expect(banco.escritas).toHaveLength(0);
    expect(JSON.stringify(linha().compras)).toBe(antes);

    const comLixo = await put(url, { linhas: [...Array.from({ length: 60 }, (_, i) => material(i)), { id: 'x', tipo: 'material', nome: 'Curto' }] });
    expect(comLixo.status).toBe(200);
    expect(comLixo.body.compras.linhas).toHaveLength(60);
    expect(comLixo.body.descartadas).toBe(1);
  });
  it('corpo acima de 48.000 caracteres é 413, antes de ler o banco', async () => {
    poeVistoria();
    const r = await put(url, { linhas: [{ id: 'abcdef12', tipo: 'obs', obs: 'x'.repeat(50_000) }] });
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('Lista grande demais.');
    expect(h.leituras).toBe(0);
    expect(banco.escritas).toHaveLength(0);
  });
  it('vistoria concluída é 409, não lê a lista e não grava', async () => {
    poeVistoria({ status: 'concluida' });
    const r = await put(url, { linhas: [material(1)] });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('Vistoria concluída. Reabra para editar.');
    expect(h.leituras).toBe(1);
    expect(banco.escritas).toHaveLength(0);
    expect(linha().compras).toBeUndefined();
  });
  it('coluna ainda não existe é 503 migracao_pendente e não grava', async () => {
    poeVistoria();
    banco.falhas['vistorias.select'] = { erro: COMPRAS_AUSENTE, uma: true, pular: 1 };
    const r = await put(url, { linhas: [material(1)] });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('migracao_pendente');
    expect(h.leituras).toBe(2);
    expect(banco.escritas).toHaveLength(0);
  });
  it('erro do banco que NÃO é coluna ausente responde 500, registra o erro e não grava', async () => {
    poeVistoria({ compras: { v: 1, publica: true, linhas: [] } });
    banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 1 };
    vi.mocked(logger.error).mockClear();
    const r = await put(url, { linhas: [material(1)] });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Não consegui carregar a lista de compras. Tente de novo.');
    expect(logger.error).toHaveBeenCalledWith('vistorias', 'falha lendo compras', expect.any(Error));
    expect(banco.escritas).toHaveLength(0);
    expect(linha().compras).toEqual({ v: 1, publica: true, linhas: [] });
  });
  it('erro ao gravar: coluna ausente é 503, outro erro é 500, e a lista guardada não muda', async () => {
    poeVistoria();
    // O banco falso registra a escrita mesmo quando ela falha, então a prova é a linha guardada.
    banco.falhas['vistorias.update'] = { erro: COMPRAS_AUSENTE, uma: true };
    const a = await put(url, { linhas: [material(1)] });
    expect(a.status).toBe(503);
    expect(a.body.error).toBe('migracao_pendente');
    banco.falhas['vistorias.update'] = { erro: BANCO_FORA, uma: true };
    const b = await put(url, { linhas: [material(1)] });
    expect(b.status).toBe(500);
    expect(b.body.error).toBe('Não consegui salvar a lista de compras.');
    expect(linha().compras).toBeUndefined();
  });
  it('vistoria de outro usuário é 404; sem login é 401', async () => {
    poeVistoria();
    const r = await put(url, { linhas: [material(1)] }, U2);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Vistoria não encontrada.');
    expect((await request(app).put(url).send({ linhas: [] })).status).toBe(401);
    expect(banco.escritas).toHaveLength(0);
    expect(linha().compras).toBeUndefined();
  });
});

describe('GET /:id e a lista de compras', () => {
  // Gravada com o nome em minúscula: o que a tela recebe é a leitura saneada, não o JSON cru da coluna.
  const gravada = { v: 1, publica: false, linhas: [{ id: 'm3k9x2ab', tipo: 'material', nome: 'caixa de medição', qtd: 1, un: 'un', quem: 'cliente', obs: '' }] };
  const lida = { publica: false, linhas: [{ id: 'm3k9x2ab', tipo: 'material', nome: 'Caixa de medição', qtd: 1, un: 'un', quem: 'cliente', obs: '' }] };

  it('traz compras (lida e saneada) e compras_disponivel true, junto de status e assinaturas', async () => {
    poeVistoria({ compras: gravada, status_itens: { padrao: 'atencao' } });
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.compras).toEqual(lida);
    expect(r.body.compras_disponivel).toBe(true);
    expect(r.body.extras_disponiveis).toBe(true);
    expect(r.body.status_itens).toEqual({ padrao: 'atencao' });
    expect(h.leituras).toBe(3);
  });
  it('coluna no padrão {} é lista vazia e visível', async () => {
    poeVistoria({ compras: {} });
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.compras).toEqual({ publica: true, linhas: [] });
    expect(r.body.compras_disponivel).toBe(true);
  });
  it('sem a coluna da lista responde 200 com a flag falsa, e status e assinaturas seguem ligados', async () => {
    poeVistoria({ status_itens: { padrao: 'atencao' } });
    banco.falhas['vistorias.select'] = { erro: COMPRAS_AUSENTE, uma: true, pular: 2 };
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.compras_disponivel).toBe(false);
    expect(r.body.compras).toEqual({ publica: true, linhas: [] });
    expect(r.body.extras_disponiveis).toBe(true);
    expect(r.body.status_itens).toEqual({ padrao: 'atencao' });
    expect(r.body.resumo.selo).toBe('atencao');
  });
  it('erro do banco na leitura da lista é 500 com o texto da lista (não o dos status)', async () => {
    poeVistoria();
    banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 2 };
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Não consegui carregar a lista de compras. Tente de novo.');
  });
  it('com a projeção de colunas ligada a resposta ainda traz a lista (prova que o select pediu a coluna)', async () => {
    poeVistoria({ compras: gravada, status_itens: { padrao: 'atencao' } });
    banco.projeta = true;
    const r = await get(`/vistorias/${ID}`);
    expect(r.status).toBe(200);
    expect(r.body.compras).toEqual(lida);
    expect(r.body.compras_disponivel).toBe(true);
    expect(r.body.status_itens).toEqual({ padrao: 'atencao' });
  });
  it('só o GET /:id e o PUT /compras leem a lista: as outras rotas mantêm a contagem de leituras', async () => {
    poeVistoria();
    const leituras = async (rota: () => PromiseLike<{ status: number }>) => {
      h.leituras = 0;
      expect((await rota()).status).toBe(200);
      return h.leituras;
    };
    expect(await leituras(() => put(`/vistorias/${ID}/localizacao`, { colado: '-22.1234,-45.6789' }))).toBe(1);
    expect(await leituras(() => request(app).patch(`/vistorias/${ID}/item`).set('x-user', U1).send({ item_key: 'padrao', obs: 'ok' }))).toBe(1);
    expect(await leituras(() => put(`/vistorias/${ID}/status`, { status_itens: {} }))).toBe(2);
    expect(await leituras(() => post(`/vistorias/${ID}/concluir`))).toBe(2);
    expect(await leituras(() => post(`/vistorias/${ID}/reabrir`))).toBe(1);
    expect(await leituras(() => get(`/vistorias/${ID}`))).toBe(3);
    expect(await leituras(() => put(`/vistorias/${ID}/compras`, { linhas: [] }))).toBe(2);
  });
});

// ── ZIP autenticado: todos os arquivos, inclusive o documento pessoal ──────────────────────────────

const BASE_ZIP = `vistorias/${U1}/${ID}`;
// Itens que têm arquivo nesta vistoria de teste: nome no Storage, tipo e o conteúdo (texto inventado).
const ARQUIVOS: Record<string, { nome: string; tipo: 'image' | 'file'; texto: string }[]> = {
  conta_luz: [{ nome: 'conta_luz-1.jpg', tipo: 'image', texto: 'bytes da conta de luz' }],
  documento_pessoal: [{ nome: 'documento_pessoal-1.jpg', tipo: 'image', texto: 'bytes do documento pessoal' }],
  padrao: [
    { nome: 'padrao-1.jpg', tipo: 'image', texto: 'bytes do padrao' },
    { nome: 'padrao-2.pdf', tipo: 'file', texto: 'bytes do laudo' },
  ],
  telhado: [{ nome: 'telhado-1.jpg', tipo: 'image', texto: 'bytes do telhado' }],
};
// O que o ZIP completo tem de trazer, na ordem do checklist (a numeração é a posição do item).
const NOMES_NO_ZIP = ['01-conta-de-luz-1.jpg', '02-cnh-identidade-1.jpg', '03-padrao-de-entrada-1.jpg', '03-padrao-de-entrada-2.pdf', '08-telhado-1.jpg'];

/** Vistoria com 5 arquivos em 4 itens. Com `noStorage` falso, os arquivos existem só no banco (o Storage não os tem). */
function semearArquivos(extra: Record<string, unknown> = {}, noStorage = true) {
  const itens = CHECKLIST_VISTORIA.map((c) => ({
    key: c.key, label: c.label, dica: c.dica, obs: '',
    fotos: (ARQUIVOS[c.key] ?? []).map((a) => ({ url: `${BASE_ZIP}/${a.nome}`, ts: 't', tipo: a.tipo, ...(a.tipo === 'file' ? { nome: 'laudo.pdf' } : {}) })),
  }));
  if (noStorage) for (const lista of Object.values(ARQUIVOS)) for (const a of lista) h.objetos.set(`${BASE_ZIP}/${a.nome}`, Buffer.from(a.texto));
  poeVistoria({ itens, ...extra });
}

// Resposta binária no supertest: junta os pedaços num Buffer em vez de tentar ler como texto.
const comoBuffer = (res: any, cb: (err: Error | null, corpo: Buffer) => void): void => {
  const partes: Buffer[] = [];
  res.on('data', (p: Buffer) => partes.push(p));
  res.on('end', () => cb(null, Buffer.concat(partes)));
};
const baixarZip = (url: string, user = U1) => request(app).get(url).set('x-user', user).buffer(true).parse(comoBuffer);

describe('GET /:id/fotos.zip (todos os arquivos, só para o dono)', () => {
  const url = `/vistorias/${ID}/fotos.zip`;

  it('leva TODOS os arquivos, inclusive o documento pessoal, na ordem do checklist e sem cache', async () => {
    semearArquivos();
    const r = await baixarZip(url);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/zip');
    expect(r.headers['content-disposition']).toBe('attachment; filename="vistoria-maria-souza.zip"');
    expect(r.headers['cache-control']).toBe('private, no-store');
    const zip = await JSZip.loadAsync(r.body);
    expect(Object.keys(zip.files)).toEqual(NOMES_NO_ZIP);
    expect(await zip.file('02-cnh-identidade-1.jpg')!.async('string')).toBe('bytes do documento pessoal');
    expect(await zip.file('03-padrao-de-entrada-2.pdf')!.async('string')).toBe('bytes do laudo');
    expect(h.leituras).toBe(1);
    expect(banco.escritas).toHaveLength(0);
  });
  it('a ordem do ZIP não depende de qual download termina primeiro', async () => {
    semearArquivos();
    h.atrasoMs.set(`${BASE_ZIP}/conta_luz-1.jpg`, 40);
    h.atrasoMs.set(`${BASE_ZIP}/padrao-1.jpg`, 20);
    const r = await baixarZip(url);
    expect(r.status).toBe(200);
    expect(Object.keys((await JSZip.loadAsync(r.body)).files)).toEqual(NOMES_NO_ZIP);
  });
  it('vistoria concluída também baixa tudo', async () => {
    semearArquivos({ status: 'concluida' });
    const r = await baixarZip(url);
    expect(r.status).toBe(200);
    expect(Object.keys((await JSZip.loadAsync(r.body)).files)).toEqual(NOMES_NO_ZIP);
  });
  it('arquivo que não está no Storage fica de fora, sem derrubar o ZIP', async () => {
    semearArquivos({}, false);
    h.objetos.set(`${BASE_ZIP}/padrao-1.jpg`, Buffer.from('so este existe'));
    const r = await baixarZip(url);
    expect(r.status).toBe(200);
    expect(Object.keys((await JSZip.loadAsync(r.body)).files)).toEqual(['03-padrao-de-entrada-1.jpg']);
  });
  it('sem nenhum arquivo é 404 com a frase "Esta vistoria ainda não tem fotos."', async () => {
    poeVistoria({ itens: CHECKLIST_VISTORIA.map((c) => ({ key: c.key, label: c.label, dica: c.dica, obs: '', fotos: [] })) });
    const vazia = await get(url);
    expect(vazia.status).toBe(404);
    expect(vazia.body.error).toBe('Esta vistoria ainda não tem fotos.');
    // Arquivos só no banco, nenhum no Storage: também não há o que entregar.
    banco.reset();
    semearArquivos({}, false);
    const semStorage = await get(url);
    expect(semStorage.status).toBe(404);
    expect(semStorage.body.error).toBe('Esta vistoria ainda não tem fotos.');
  });
  it('sem login é 401; vistoria de outro usuário e vistoria inexistente são 404', async () => {
    semearArquivos();
    expect((await request(app).get(url)).status).toBe(401);
    const outro = await get(url, U2);
    expect(outro.status).toBe(404);
    expect(outro.body.error).toBe('Vistoria não encontrada.');
    expect(outro.headers['content-type']).not.toContain('zip');
    expect((await get(`/vistorias/${ID_INEXISTENTE}/fotos.zip`)).status).toBe(404);
  });
});

describe('montarZipDaVistoria e slugify', () => {
  it('pularItens tira o documento sem renumerar os outros itens', async () => {
    semearArquivos();
    const buf = await montarZipDaVistoria(linha().itens, { pularItens: ['documento_pessoal'] });
    expect(buf).not.toBeNull();
    const zip = await JSZip.loadAsync(buf!);
    expect(Object.keys(zip.files)).toEqual(NOMES_NO_ZIP.filter((n) => !n.startsWith('02-')));
  });
  it('tolera entrada que não é lista, item sem fotos e arquivo sem caminho: devolve null, não lança', async () => {
    expect(await montarZipDaVistoria(null)).toBeNull();
    expect(await montarZipDaVistoria({})).toBeNull();
    expect(await montarZipDaVistoria([null, { key: 'x', label: 5, fotos: 'nao' }, { key: 'y', label: 'Y', fotos: [{ url: 7 }, null] }])).toBeNull();
  });
  it('slugify tira acento, caixa e símbolo', () => {
    expect(slugify('CNH / Identidade')).toBe('cnh-identidade');
    expect(slugify('Padrão de entrada')).toBe('padrao-de-entrada');
    expect(slugify('')).toBe('item');
  });
});

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe('relatório público /v/:id', () => {
  it('vistoria antiga, sem status: igual a antes, sem selo, e já com Baixar PDF e sem emoji', async () => {
    poeVistoria({}, false);
    banco.falhas['vistorias.select'] = { erro: COLUNA_AUSENTE, uma: true, pular: 1 };
    const r = await request(app).get(`/v/${ID}`);
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('Resultado da vistoria');
    expect(r.text).not.toContain('Pendências e prioridades');
    expect(r.text).toContain('Padrão de entrada');
    expect(r.text).toContain('Arquivo anexado: laudo.pdf');
    expect(r.text).toContain(`href="/v/${ID}/pdf"`);
    expect(r.text).toContain('<title>Vistoria: Maria Souza</title>');
    expect(r.text).not.toMatch(EMOJI);
    expect(r.text).not.toMatch(/[—–]/);
  });
  it('vistoria em andamento continua pública', async () => {
    poeVistoria({ status: 'em_andamento' });
    const r = await request(app).get(`/v/${ID}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Em andamento');
  });
  it('vistoria nova mostra selo, status do item, pendências, conclusão e assinaturas', async () => {
    poeVistoria({
      status: 'concluida',
      status_itens: { padrao: 'nao_conforme', telhado: 'conforme', medidor: 'atencao' },
      assinaturas: {
        tecnico: { path: `vistorias/${U1}/${ID}/assinatura-tecnico-1.png`, nome: 'Bruno Lima', registro: 'CFT 123', ts: 't' },
        cliente: { path: `vistorias/${U1}/${ID}/assinatura-cliente-1.png`, nome: 'Maria Souza', ts: 't' },
      },
    });
    const r = await request(app).get(`/v/${ID}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Resultado da vistoria');
    expect(r.text).toContain('Adequar antes de instalar');
    expect(r.text).toContain('Pendências e prioridades');
    expect(r.text).toContain('Prioridade alta');
    expect(r.text).toContain('Prioridade média');
    expect(r.text).toContain('Foi encontrada não conformidade em padrão de entrada.');
    expect(r.text).toContain('class="chip s-conforme"');
    expect(r.text).toContain('Assinatura do técnico');
    expect(r.text).toContain('Registro: CFT 123');
    expect(r.text).toContain('assinatura-cliente-1.png');
    expect(r.text).not.toMatch(EMOJI);
  });
  it('item só com status, sem foto, aparece; item sem nada continua em "Sem registro"', async () => {
    poeVistoria({ status_itens: { sombreamento: 'atencao' } });
    const r = await request(app).get(`/v/${ID}`);
    expect(r.text).toContain('<strong>Sombreamento</strong>');
    expect(r.text).toMatch(/Sem registro:.*Medidor/);
  });
  it('UUID inválido e inexistente são 404', async () => {
    expect((await request(app).get('/v/abc')).status).toBe(404);
    expect((await request(app).get(`/v/${ID_INEXISTENTE}`)).status).toBe(404);
  });
});

describe('PDF /v/:id/pdf', () => {
  const pdfs = () => [...h.objetos.keys()].filter((k) => k.includes('relatorio-'));

  it('gera, sobe para o bucket e responde 302 para a URL assinada', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    const r = await request(app).get(`/v/${ID}/pdf`).redirects(0);
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(new RegExp(`^https://storage\\.test/vistorias/${U1}/${ID}/relatorio-[0-9a-f]{16}\\.pdf`));
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(pdfs()).toHaveLength(1);
    expect(h.navegador.abriu).toBe(1);
    expect(h.navegador.fechou).toBe(1);
  });
  it('o HTML do PDF não tem botão, lazy-load nem emoji e traz o anexo como texto', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    await request(app).get(`/v/${ID}/pdf`).redirects(0);
    const html = h.navegador.html;
    expect(html).toContain('Resultado da vistoria');
    expect(html).toContain('Arquivo anexado: laudo.pdf');
    expect(html).not.toContain('Baixar PDF');
    expect(html).not.toContain('loading="lazy"');
    expect(html).not.toContain('fotos.zip');
    expect(html).not.toMatch(EMOJI);
    expect(html).toContain('@page');
  });
  it('duas chamadas iguais geram o PDF uma vez só', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    const a = await request(app).get(`/v/${ID}/pdf`).redirects(0);
    const b = await request(app).get(`/v/${ID}/pdf`).redirects(0);
    expect(a.status).toBe(302);
    expect(b.status).toBe(302);
    expect(h.navegador.abriu).toBe(1);
    expect(pdfs()).toHaveLength(1);
    expect(b.headers.location.split('?')[0]).toBe(a.headers.location.split('?')[0]);
  });
  it('mudou o conteúdo: gera de novo, apaga o antigo e mantém o atual', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    const a = await request(app).get(`/v/${ID}/pdf`).redirects(0);
    linha().status_itens = { padrao: 'nao_conforme' };
    const b = await request(app).get(`/v/${ID}/pdf`).redirects(0);
    expect(h.navegador.abriu).toBe(2);
    expect(b.headers.location.split('?')[0]).not.toBe(a.headers.location.split('?')[0]);
    const atual = pdfs();
    expect(atual).toHaveLength(1);
    expect(b.headers.location).toContain(atual[0]);
    // mudar só a observação de um item também muda o PDF
    linha().itens = linha().itens.map((i: any) => (i.key === 'telhado' ? { ...i, obs: 'telha trincada' } : i));
    await request(app).get(`/v/${ID}/pdf`).redirects(0);
    expect(h.navegador.abriu).toBe(3);
    expect(pdfs()).toHaveLength(1);
  });
  it('a URL assinada da foto não entra no hash: reabrir não regera', async () => {
    poeVistoria();
    await request(app).get(`/v/${ID}/pdf`).redirects(0);
    await request(app).get(`/v/${ID}/pdf`).redirects(0);
    await request(app).get(`/v/${ID}/pdf`).redirects(0);
    expect(h.navegador.abriu).toBe(1);
  });
  it('UUID inválido e inexistente são 404 e não abrem o navegador', async () => {
    expect((await request(app).get('/v/abc/pdf')).status).toBe(404);
    expect((await request(app).get(`/v/${ID_INEXISTENTE}/pdf`)).status).toBe(404);
    expect(h.navegador.abriu).toBe(0);
  });
  it('erro no navegador vira página 500 com o texto e fecha o navegador', async () => {
    poeVistoria();
    h.navegador.falha = true;
    const r = await request(app).get(`/v/${ID}/pdf`).redirects(0);
    expect(r.status).toBe(500);
    expect(r.text).toContain('Não consegui gerar o PDF. Tente de novo.');
    expect(h.navegador.fechou).toBe(1);
  });
});

// ── Relatório público do lote 5a: marca, cadastro do cliente, cabeçalhos, rodapé do PDF e documento pessoal ──

const CLI_ID = '22222222-2222-4222-8222-222222222222';
const EMPRESA = {
  user_id: U1, nome: 'Solar Teste Energia LTDA', nome_fantasia: 'Solar Teste', cnpj: '12345678000190',
  logo_base64: PNG, cor_marca: '#0E6B5C', whatsapp: '31999990000', endereco: 'Rua dos Fundos, 10', cidade: 'Contagem',
};
const CLIENTE_DB = {
  id: CLI_ID, user_id: U1, nome: 'Maria Souza', cpf_cnpj: '123.456.789-09', email: 'maria@exemplo.test',
  telefone: '31988887777', telefone2: '3133334444', endereco: 'Rua das Flores, 100', cep: '30000-000',
  cidade: 'Belo Horizonte', uf: 'MG', concessionaria: 'Distribuidora Regional',
};
const ENDERECO_CLIENTE = 'Rua das Flores, 100, Belo Horizonte/MG, CEP 30000-000';
const DADOS_PRIVADOS = ['123.456.789-09', 'maria@exemplo.test', '31988887777', '3133334444'];
const pdfRota = () => request(app).get(`/v/${ID}/pdf`).redirects(0);
const pdfsNoBucket = () => [...h.objetos.keys()].filter((k) => k.includes('relatorio-'));
const opcoesDoPdf = () => h.navegador.opcoes as {
  format: string; printBackground: boolean; preferCSSPageSize: boolean; displayHeaderFooter: boolean; footerTemplate: string;
};

describe('relatório público: marca do integrador', () => {
  it('mostra logo, nome, CNPJ formatado e o código do documento, na tela e no PDF', async () => {
    poeVistoria();
    banco.poe('company', EMPRESA);
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('<title>Vistoria: Maria Souza</title>');
    expect(tela.text).toContain('<b>Solar Teste</b>');
    expect(tela.text).toContain('<span>CNPJ 12.345.678/0001-90</span>');
    expect(tela.text).toContain(`<img src="${PNG}" alt="Solar Teste"/>`);
    expect(tela.text).toContain('<b>VT-11111111</b>');
    await pdfRota();
    expect(h.navegador.html).toContain('<b>Solar Teste</b>');
    expect(h.navegador.html).toContain(`<img src="${PNG}" alt="Solar Teste"/>`);
    expect(h.navegador.html).toContain('<span>CNPJ 12.345.678/0001-90</span>');
  });
  it('o contato da empresa (WhatsApp, endereço, cidade) não sai, mesmo preenchido no banco', async () => {
    poeVistoria();
    banco.poe('company', EMPRESA);
    const tela = await request(app).get(`/v/${ID}`);
    await pdfRota();
    for (const texto of [tela.text, h.navegador.html]) {
      expect(texto).not.toContain('WhatsApp');
      expect(texto).not.toContain('31999990000');
      expect(texto).not.toContain('99999-0000');
      expect(texto).not.toContain('Rua dos Fundos');
      expect(texto).not.toContain('Contagem');
    }
  });
  it('sem empresa cadastrada (ou só de outro usuário) o relatório sai com a identidade padrão', async () => {
    poeVistoria();
    banco.poe('company', { ...EMPRESA, user_id: U2, nome_fantasia: 'Outra Empresa' });
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('<div class="marca"><div class="emp"><b>Vistoria de Energia Solar</b></div></div>');
    expect(tela.text).not.toContain('Outra Empresa');
    expect((await pdfRota()).status).toBe(302);
    expect(h.navegador.html).not.toContain('Outra Empresa');
  });
  it('erro do banco ao ler a empresa não derruba o link: 200 na tela, 302 no PDF, e o erro vai para o log', async () => {
    poeVistoria();
    banco.poe('company', EMPRESA);
    banco.falhas['company.select'] = { erro: BANCO_FORA };
    vi.mocked(logger.error).mockClear();
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('<title>Vistoria: Maria Souza</title>');
    expect(tela.text).not.toContain('Solar Teste');
    expect((await pdfRota()).status).toBe(302);
    expect(logger.error).toHaveBeenCalledWith('relatorio', 'falha lendo a marca da empresa', expect.anything());
  });
  it('marca editada aparece na tela no mesmo instante e gera um PDF novo; sem edição o PDF guardado vale', async () => {
    poeVistoria();
    banco.poe('company', EMPRESA);
    const a = await pdfRota();
    const b = await pdfRota();
    expect(h.navegador.abriu).toBe(1);
    expect(b.headers.location.split('?')[0]).toBe(a.headers.location.split('?')[0]);
    banco.linhas('company')[0]!.nome_fantasia = 'Solar Nova';
    const c = await pdfRota();
    expect(h.navegador.abriu).toBe(2);
    expect(h.navegador.html).toContain('<b>Solar Nova</b>');
    expect(c.headers.location.split('?')[0]).not.toBe(a.headers.location.split('?')[0]);
    expect(pdfsNoBucket()).toHaveLength(1);
    expect((await request(app).get(`/v/${ID}`)).text).toContain('<b>Solar Nova</b>');
  });
  it('com a projeção de colunas ligada, as duas rotas ainda pedem o dono e o cadastro (user_id e cliente_id)', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('company', EMPRESA);
    banco.poe('clients', CLIENTE_DB);
    banco.projeta = true;
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('<b>Solar Teste</b>');
    expect(tela.text).toContain(ENDERECO_CLIENTE);
    expect((await pdfRota()).status).toBe(302);
    expect(h.navegador.html).toContain('<b>Solar Teste</b>');
    expect(h.navegador.html).toContain(ENDERECO_CLIENTE);
  });
});

describe('relatório público: cadastro do cliente', () => {
  it('mostra o endereço do cadastro e a concessionária, na tela e no PDF', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('clients', CLIENTE_DB);
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.text).toContain(`<dt>Endereço do cadastro</dt><dd>${ENDERECO_CLIENTE}</dd>`);
    expect(tela.text).toContain('<dt>Concessionária</dt><dd>Distribuidora Regional</dd>');
    await pdfRota();
    expect(h.navegador.html).toContain(`<dt>Endereço do cadastro</dt><dd>${ENDERECO_CLIENTE}</dd>`);
    expect(h.navegador.html).toContain('<dt>Concessionária</dt><dd>Distribuidora Regional</dd>');
  });
  it('CPF, e-mail e telefones do cadastro nunca aparecem', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('clients', CLIENTE_DB);
    const tela = await request(app).get(`/v/${ID}`);
    await pdfRota();
    for (const texto of [tela.text, h.navegador.html]) for (const privado of DADOS_PRIVADOS) expect(texto).not.toContain(privado);
  });
  it('vistoria sem cliente_id ("só o nome") não consulta o cadastro', async () => {
    poeVistoria();
    banco.poe('clients', CLIENTE_DB);
    // Se alguém ler `clients`, a falha é gasta e some do mapa: ela continuar lá prova que ninguém leu.
    banco.falhas['clients.select'] = { erro: BANCO_FORA, uma: true };
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).not.toContain('Endereço do cadastro');
    expect((await pdfRota()).status).toBe(302);
    expect(banco.falhas['clients.select']).toBeDefined();
    expect(banco.escritas).toHaveLength(0);
  });
  it('cliente de outro usuário nunca aparece', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('clients', { ...CLIENTE_DB, user_id: U2, endereco: 'Rua Secreta, 1' });
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).not.toContain('Rua Secreta');
    expect(tela.text).not.toContain('Endereço do cadastro');
  });
  it('erro do banco no cadastro não derruba o relatório', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('clients', CLIENTE_DB);
    banco.falhas['clients.select'] = { erro: BANCO_FORA };
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('<title>Vistoria: Maria Souza</title>');
    expect(tela.text).not.toContain('Endereço do cadastro');
    expect((await pdfRota()).status).toBe(302);
  });
  it('coluna nova ausente no cadastro: tenta de novo só com endereço e CEP', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('clients', CLIENTE_DB);
    banco.falhas['clients.select'] = { erro: { code: '42703', message: 'column clients.concessionaria does not exist' }, uma: true };
    banco.projeta = true;
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('<dt>Endereço do cadastro</dt><dd>Rua das Flores, 100, CEP 30000-000</dd>');
    expect(tela.text).not.toContain('Concessionária');
  });
  it('mudar o endereço do cadastro gera um PDF novo; mudar um campo que o relatório não mostra, não', async () => {
    poeVistoria({ cliente_id: CLI_ID });
    banco.poe('clients', CLIENTE_DB);
    await pdfRota();
    await pdfRota();
    expect(h.navegador.abriu).toBe(1);
    banco.linhas('clients')[0]!.endereco = 'Avenida Nova, 9';
    await pdfRota();
    expect(h.navegador.abriu).toBe(2);
    expect(h.navegador.html).toContain('Avenida Nova, 9');
    banco.linhas('clients')[0]!.email = 'outro@exemplo.test';
    await pdfRota();
    expect(h.navegador.abriu).toBe(2);
    expect(pdfsNoBucket()).toHaveLength(1);
  });
});

describe('relatório público: cabeçalhos e prévia', () => {
  it('a tela não guarda cache, sai fora dos buscadores e tem os metas da prévia', async () => {
    poeVistoria();
    const r = await request(app).get(`/v/${ID}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.text).toContain('<meta name="robots" content="noindex,nofollow"/>');
    expect(r.text).toContain('<meta property="og:title" content="Vistoria: Maria Souza"/>');
    expect(r.text).toContain('<meta property="og:description" content="Relatório de vistoria de energia solar de Maria Souza."/>');
    expect(r.text).toContain('<meta property="og:type" content="article"/>');
  });
  it('a descrição da prévia leva o nome da empresa quando há marca', async () => {
    poeVistoria();
    banco.poe('company', EMPRESA);
    const r = await request(app).get(`/v/${ID}`);
    expect(r.text).toContain('<meta property="og:description" content="Relatório de vistoria de energia solar de Maria Souza, por Solar Teste."/>');
  });
  it('a página de vistoria não encontrada também fica fora dos buscadores e em tema claro', async () => {
    const r = await request(app).get(`/v/${ID_INEXISTENTE}`);
    expect(r.status).toBe(404);
    expect(r.text).toContain('<meta name="robots" content="noindex,nofollow"/>');
    expect(r.text).not.toContain('#0F172A');
  });
  it('as assinaturas levam data e hora de Brasília, e o responsável técnico aparece no cabeçalho', async () => {
    poeVistoria({
      status: 'concluida',
      assinaturas: {
        tecnico: { path: `vistorias/${U1}/${ID}/assinatura-tecnico-1.png`, nome: 'Bruno Lima', registro: 'CFT 123', ts: '2026-10-27T17:32:00.000Z' },
        cliente: { path: `vistorias/${U1}/${ID}/assinatura-cliente-1.png`, nome: 'Maria Souza', ts: '2026-10-27T17:40:00.000Z' },
      },
    });
    const r = await request(app).get(`/v/${ID}`);
    expect(r.text).toContain('Assinado em 27/10/2026 às 14:32');
    expect(r.text).toContain('Assinado em 27/10/2026 às 14:40');
    expect(r.text).toContain('<span>Responsável técnico: Bruno Lima, <span class="nw">CFT 123</span></span>');
  });
});

describe('PDF: rodapé de página e nome do arquivo', () => {
  it('o rodapé traz empresa, código e cliente, com "Página X de Y", e o PDF sai em A4', async () => {
    poeVistoria();
    banco.poe('company', EMPRESA);
    expect((await pdfRota()).status).toBe(302);
    const o = opcoesDoPdf();
    expect(o).toMatchObject({ format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true });
    expect(o.footerTemplate).toContain('Solar Teste · VT-11111111 · Maria Souza');
    expect(o.footerTemplate).toContain('class="pageNumber"');
    expect(o.footerTemplate).toContain('class="totalPages"');
    expect(o.footerTemplate).toContain('font-size:10.5px');
  });
  it('sem empresa, o rodapé leva só o código e o cliente', async () => {
    poeVistoria();
    await pdfRota();
    expect(opcoesDoPdf().footerTemplate).toContain('>VT-11111111 · Maria Souza</span>');
  });
  it('o nome do arquivo baixado é vistoria-<cliente>-<código>.pdf', async () => {
    poeVistoria();
    const r = await pdfRota();
    expect(r.headers.location).toContain('download=vistoria-maria-souza-VT-11111111.pdf');
    banco.reset();
    poeVistoria({ cliente_nome: null });
    const sem = await pdfRota();
    expect(sem.headers.location).toContain('download=vistoria-solar-VT-11111111.pdf');
  });
  it('o HTML do PDF tem a versão online, a margem do @page e nada de tela', async () => {
    poeVistoria({ status_itens: { padrao: 'conforme' } });
    await pdfRota();
    const html = h.navegador.html;
    expect(html).toContain(`Versão online deste relatório: <a href="${urlPublica('v', ID)}">`);
    expect(html).toContain('@page{size:A4;margin:14mm 16mm 18mm}');
    expect(html).not.toContain('<footer class="rod">');
    expect(html).not.toContain('Ir para:');
  });
});

describe('documento pessoal (CNH ou identidade) fora do link público', () => {
  it('a tela e o HTML do PDF não trazem imagem nem link do documento; a conta de luz continua', async () => {
    semearArquivos({ status: 'concluida' });
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).not.toContain('documento_pessoal-1.jpg');
    expect(tela.text).toContain('conta_luz-1.jpg');
    expect(tela.text).toContain('Documento recebido. A imagem fica só com a empresa.');
    expect(tela.text).toContain('Baixar fotos e arquivos (4)'); // conta de luz, 2 do padrão e telhado; o documento fica de fora
    await pdfRota();
    expect(h.navegador.html).not.toContain('documento_pessoal-1.jpg');
    expect(h.navegador.html).toContain('conta_luz-1.jpg');
    expect(h.navegador.html).toContain('Documento recebido. A imagem fica só com a empresa.');
  });
  it('o ZIP público não leva o documento pessoal; o ZIP do dono leva tudo', async () => {
    semearArquivos();
    const publico = await request(app).get(`/v/${ID}/fotos.zip`).buffer(true).parse(comoBuffer);
    expect(publico.status).toBe(200);
    const zip = await JSZip.loadAsync(publico.body);
    expect(Object.keys(zip.files)).toEqual(NOMES_NO_ZIP.filter((n) => !n.startsWith('02-')));
    for (const nome of Object.keys(zip.files)) expect(await zip.file(nome)!.async('string')).not.toContain('documento pessoal');
    const dono = await baixarZip(`/vistorias/${ID}/fotos.zip`);
    expect(Object.keys((await JSZip.loadAsync(dono.body)).files)).toEqual(NOMES_NO_ZIP);
  });
  it('vistoria só com o documento pessoal: ZIP público é 404 e a tela não oferece o botão', async () => {
    poeVistoria({
      itens: CHECKLIST_VISTORIA.map((c) => ({
        key: c.key, label: c.label, dica: c.dica, obs: '',
        fotos: c.key === 'documento_pessoal' ? [{ url: `${BASE_ZIP}/documento_pessoal-1.jpg`, ts: 't', tipo: 'image' }] : [],
      })),
    });
    h.objetos.set(`${BASE_ZIP}/documento_pessoal-1.jpg`, Buffer.from('bytes do documento pessoal'));
    const zip = await request(app).get(`/v/${ID}/fotos.zip`);
    expect(zip.status).toBe(404);
    expect(zip.text).toBe('Esta vistoria ainda não tem fotos.');
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).not.toContain('Baixar fotos e arquivos');
    expect(tela.text).not.toContain('documento_pessoal-1.jpg');
    expect(tela.text).toContain('Documento recebido. A imagem fica só com a empresa.');
  });
});

// ── Relatório público do lote 5b: lista de compras ("Materiais e providências") ──────────────────────

/** A lista como fica na coluna. Uma cópia nova a cada uso: os testes mexem nas linhas e o banco falso não copia. */
const comprasGravada = () => JSON.parse(JSON.stringify({
  v: 1,
  publica: true,
  linhas: [
    { id: 'm3k9x2ab', tipo: 'material', nome: 'Caixa de medição', esp: 'Modelo aprovado pela distribuidora.', qtd: 1, un: 'un', quem: 'cliente', item: 'padrao', cid: 'caixa-medicao', obs: 'Caixa atual é antiga.', ts: '2026-10-29T14:03:11.000Z' },
    { id: 'm3k9y7cd', tipo: 'material', nome: 'Cabo solar CC', qtd: 120, un: 'm', quem: 'integrador', item: 'cabeamento', obs: '' },
    { id: 'm3ka1c3h', tipo: 'obs', obs: 'Telha antiga, pode ter amianto.', item: 'tipo_telha' },
  ],
}));
const STATUS_COM_LISTA = { padrao: 'nao_conforme', cabeamento: 'conforme' };
const poeComLista = (extra: Record<string, unknown> = {}) =>
  poeVistoria({ status: 'concluida', status_itens: STATUS_COM_LISTA, compras: comprasGravada(), ...extra });

describe('relatório público: lista de compras', () => {
  it('a tela e o PDF mostram a lista gravada, com o prazo do item e o "Na lista:" da pendência', async () => {
    poeComLista();
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('id="compras"');
    expect(tela.text).toContain('Materiais e providências');
    expect(tela.text).toContain('<b>Caixa de medição</b>');
    expect(tela.text).toContain('class="chip p-alta">Antes de instalar<');
    expect(tela.text).toContain('Item da vistoria: Padrão de entrada');
    expect(tela.text).toContain('<p class="nalista">Na lista: Caixa de medição.</p>');
    expect(tela.text).toContain('<li><b>Tipo de telha:</b> Telha antiga, pode ter amianto.</li>');
    expect(tela.text).toContain('<a href="#compras">Compras</a>');
    await pdfRota();
    const pdf = h.navegador.html;
    expect(pdf).toContain('id="compras"');
    expect(pdf).toContain('<b>Cabo solar CC</b>');
    expect(pdf).toContain('120\u00A0metros');
    expect(pdf).toContain('<p class="nalista">Na lista: Caixa de medição.</p>');
    expect(pdf).not.toContain('href="#compras"');
    for (const texto of [tela.text, pdf]) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(EMOJI);
    }
  });
  for (const [nome, compras] of [
    ['oculta', { ...comprasGravada(), publica: false }],
    ['vazia', { v: 1, publica: true, linhas: [] }],
    ['no padrão {}', {}],
  ] as const) {
    it(`lista ${nome}: nenhuma seção na tela nem no PDF, e o PDF é o mesmo de uma vistoria sem lista`, async () => {
      poeComLista({ compras });
      const tela = await request(app).get(`/v/${ID}`);
      expect(tela.status).toBe(200);
      for (const trecho of ['id="compras"', 'Materiais e providências', 'Na lista:', 'class="cmp"', '.nalista', 'href="#compras"']) {
        expect(tela.text, trecho).not.toContain(trecho);
      }
      const a = await pdfRota();
      expect(a.status).toBe(302);
      expect(h.navegador.html).not.toContain('id="compras"');
      banco.reset();
      h.objetos.clear();
      poeVistoria({ status: 'concluida', status_itens: STATUS_COM_LISTA });
      const semLista = await pdfRota();
      expect(semLista.headers.location.split('?')[0]).toBe(a.headers.location.split('?')[0]);
    });
  }
  it('sem a coluna da lista (3ª leitura): a tela e o PDF saem sem a seção, e o resto do relatório segue', async () => {
    poeComLista();
    banco.falhas['vistorias.select'] = { erro: COMPRAS_AUSENTE, uma: true, pular: 2 };
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).not.toContain('id="compras"');
    expect(tela.text).toContain('Resultado da vistoria');
    expect(tela.text).toContain('Adequar antes de instalar');
    banco.falhas['vistorias.select'] = { erro: COMPRAS_AUSENTE, uma: true, pular: 2 };
    expect((await pdfRota()).status).toBe(302);
    expect(h.navegador.html).not.toContain('id="compras"');
    expect(h.navegador.html).toContain('Resultado da vistoria');
  });
  it('erro do banco na leitura da lista: 500 na tela e no PDF, sem abrir o navegador e sem guardar PDF', async () => {
    poeComLista();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 2 };
      const tela = await request(app).get(`/v/${ID}`);
      expect(tela.status).toBe(500);
      expect(tela.text).not.toContain('Materiais e providências');
      banco.falhas['vistorias.select'] = { erro: BANCO_FORA, uma: true, pular: 2 };
      const pdf = await pdfRota();
      expect(pdf.status).toBe(500);
      expect(pdf.text).toContain('Não consegui gerar o PDF. Tente de novo.');
      expect(h.navegador.abriu).toBe(0);
      expect(pdfsNoBucket()).toHaveLength(0);
    } finally {
      erro.mockRestore();
    }
  });
  it('a lista é a terceira leitura em `vistorias` nas duas rotas públicas', async () => {
    poeComLista();
    h.leituras = 0;
    expect((await request(app).get(`/v/${ID}`)).status).toBe(200);
    expect(h.leituras).toBe(3);
    h.leituras = 0;
    expect((await pdfRota()).status).toBe(302);
    expect(h.leituras).toBe(3);
  });
  it('com a projeção de colunas ligada as duas rotas ainda mostram a lista (o select pediu a coluna)', async () => {
    poeComLista();
    banco.projeta = true;
    const tela = await request(app).get(`/v/${ID}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('id="compras"');
    expect((await pdfRota()).status).toBe(302);
    expect(h.navegador.html).toContain('id="compras"');
  });
});

describe('PDF: a lista de compras e o cache do arquivo', () => {
  it('mudar só a quantidade, quem providencia, o item, a nota, o nome, a especificação ou a ordem gera um PDF novo e sobra um só', async () => {
    poeComLista();
    await pdfRota();
    expect(h.navegador.abriu).toBe(1);
    const muda = async (campo: string, edita: (linhas: any[]) => void) => {
      const antes = h.navegador.abriu;
      edita(linha().compras.linhas);
      await pdfRota();
      expect(h.navegador.abriu, campo).toBe(antes + 1);
      expect(pdfsNoBucket(), campo).toHaveLength(1);
    };
    await muda('quantidade', (l) => { l[0].qtd = 2; });
    await muda('quem', (l) => { l[0].quem = 'integrador'; });
    await muda('item', (l) => { l[0].item = 'telhado'; });
    await muda('nota', (l) => { l[0].obs = 'Outra nota.'; });
    await muda('nome', (l) => { l[0].nome = 'Caixa de medição trifásica'; });
    await muda('especificação', (l) => { l[0].esp = 'Outra especificação.'; });
    await muda('ordem', (l) => { l.reverse(); });
  });
  it('mudar só o ts, o cid ou o id da linha não gera PDF novo', async () => {
    poeComLista();
    await pdfRota();
    const primeira = () => linha().compras.linhas[0];
    primeira().ts = '2026-10-30T10:00:00.000Z';
    await pdfRota();
    primeira().cid = 'outro-cid';
    await pdfRota();
    primeira().id = 'm3k9x2zz';
    await pdfRota();
    expect(h.navegador.abriu).toBe(1);
    expect(pdfsNoBucket()).toHaveLength(1);
  });
  it('lista oculta não gera PDF novo: editar as linhas ocultas mantém o arquivo, que é o mesmo de uma vistoria sem lista', async () => {
    poeComLista({ compras: { ...comprasGravada(), publica: false } });
    const a = await pdfRota();
    expect(h.navegador.abriu).toBe(1);
    linha().compras.linhas[0].qtd = 9;
    linha().compras.linhas[1].nome = 'Outro cabo';
    const b = await pdfRota();
    expect(h.navegador.abriu).toBe(1);
    expect(b.headers.location.split('?')[0]).toBe(a.headers.location.split('?')[0]);
    banco.reset();
    h.objetos.clear();
    poeVistoria({ status: 'concluida', status_itens: STATUS_COM_LISTA });
    const semLista = await pdfRota();
    expect(semLista.headers.location.split('?')[0]).toBe(a.headers.location.split('?')[0]);
  });
  it('esconder a lista (ou mostrá-la de novo) muda o conteúdo do PDF, então gera um arquivo novo', async () => {
    poeComLista();
    const visivel = await pdfRota();
    linha().compras.publica = false;
    const oculta = await pdfRota();
    expect(h.navegador.abriu).toBe(2);
    expect(oculta.headers.location.split('?')[0]).not.toBe(visivel.headers.location.split('?')[0]);
    expect(h.navegador.html).not.toContain('id="compras"');
    expect(pdfsNoBucket()).toHaveLength(1);
    linha().compras.publica = true;
    const outraVez = await pdfRota();
    expect(h.navegador.abriu).toBe(3);
    expect(outraVez.headers.location.split('?')[0]).toBe(visivel.headers.location.split('?')[0]);
    expect(h.navegador.html).toContain('id="compras"');
    expect(pdfsNoBucket()).toHaveLength(1);
  });
});
