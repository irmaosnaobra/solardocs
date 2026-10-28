import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Rotas da Vistoria (autenticadas em /vistorias e públicas em /v) contra o banco falso e um bucket
// em memória. Dados inventados, nada sai para a rede. Prova: status que descarta lixo, 409 em vistoria
// concluída, 503 quando as colunas novas não existem, assinatura exigindo nome e PNG de verdade, reabrir,
// GET com e sem colunas, relatório público com e sem selo e o PDF em 302.

const h = vi.hoisted(() => ({
  objetos: new Map<string, Buffer>(),
  removidos: [] as string[],
  navegador: { abriu: 0, fechou: 0, html: '' as string, falha: false },
  // Contagem de leituras (maybeSingle) em `vistorias` e gancho para simular outra requisição no meio.
  leituras: 0,
  aoLer: null as null | ((n: number) => void),
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
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?token=abc` }, error: null }),
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
        pdf: async () => new Uint8Array([37, 80, 68, 70]),
      }),
      close: async () => { h.navegador.fechou++; },
    };
  },
}));

import { banco } from './_bancoFalso';
import vistoriasRoutes, { CHECKLIST_VISTORIA } from '../routes/vistorias';
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
  h.navegador.abriu = 0; h.navegador.fechou = 0; h.navegador.html = ''; h.navegador.falha = false;
  h.leituras = 0; h.aoLer = null;
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
