import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Rotas da Manutenção preventiva (autenticadas em /manutencoes e públicas em /m) contra o banco falso
// e um bucket em memória. Nada sai para a rede; dados inventados. O que se prova: criar com código e
// padrões, PUT que nunca toca fotos nem assinaturas, concluir com 422, isolamento entre usuários,
// público só por UUID, tabela ausente virando 503 e o ciclo do PDF por versão.

const h = vi.hoisted(() => ({
  objetos: new Map<string, Buffer>(),
  removidos: [] as string[],
  navegador: { abriu: 0, fechou: 0, html: '' as string, pdfOpcoes: null as any },
  // Ganchos para simular uma segunda requisição que chega no meio da primeira.
  aoSubir: null as null | (() => void),
  aposCarregar: null as null | (() => void),
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
      upload: async (path: string, buf: Buffer) => { h.objetos.set(path, buf); const g = h.aoSubir; h.aoSubir = null; g?.(); return { data: { path }, error: null }; },
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
    if (t === 'manutencoes') {
      const orig = c.maybeSingle.bind(c);
      c.maybeSingle = async () => {
        const r = await orig();
        const g = h.aposCarregar; h.aposCarregar = null;
        g?.();
        return r;
      };
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
        setContent: async (html: string) => { h.navegador.html = html; },
        pdf: async (o: unknown) => { h.navegador.pdfOpcoes = o; return new Uint8Array([37, 80, 68, 70]); },
      }),
      close: async () => { h.navegador.fechou++; },
    };
  },
}));

import { banco } from './_bancoFalso';
import manutencoesRoutes from '../routes/manutencoes';
import publicManutencaoRoutes from '../routes/publicManutencao';
import { hojeBRT } from '../services/manutencao/relatorio';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/manutencoes', manutencoesRoutes);
app.use('/m', publicManutencaoRoutes);

const U1 = 'user-1';
const U2 = 'user-2';
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const png = Buffer.from('imagem-falsa').toString('base64');

const get = (url: string, user = U1) => request(app).get(url).set('x-user', user);
const post = (url: string, body: unknown = {}, user = U1) => request(app).post(url).set('x-user', user).send(body as object);
const put = (url: string, body: unknown, user = U1) => request(app).put(url).set('x-user', user).send(body as object);
const del = (url: string, body: unknown = {}, user = U1) => request(app).delete(url).set('x-user', user).send(body as object);

const linha = (id: string) => banco.linhas('manutencoes').find((r) => r.id === id)!;

/** `dados` completo, com todos os itens conformes, para o PUT. */
function dadosCompletos(extra: Record<string, unknown> = {}, itensExtra: Record<string, unknown> = {}) {
  const keys = ['modulos', 'estrutura', 'cabos', 'stringbox', 'quadro_ca', 'dps', 'aterramento', 'inversor', 'monitoramento'];
  return {
    sistema: { tipo: 'residencial', qtd_modulos: 12, potencia_kwp: 6.6, modulo_modelo: 'Mod 550', inversores: [{ marca: 'A', modelo: 'B', serie: '1' }], telhado: ['ceramico'], endereco: 'Rua Tal, 10' },
    itens: keys.map((k) => ({ key: k, status: 'conforme', visto: '', providencia: '', ...(itensExtra[k] as object | undefined) })),
    atividades: [{ key: 'limpeza', feita: true, status: 'concluido', obs: '' }],
    geracao: { esperada_kwh: null, medida_kwh: null },
    recomendacoes: '', observacoes_proxima: '', conclusao_manual: null,
    periodicidade_meses: 6,
    responsavel: { nome: 'Bruno Lima', registro: 'CFT 123' },
    ...extra,
  };
}

async function criar(user = U1, corpo: object = { cliente_nome: 'Maria Souza' }) {
  const r = await post('/manutencoes', corpo, user);
  expect(r.status).toBe(200);
  return r.body as { id: string; codigo: string; dados: any; status: string };
}

beforeEach(() => {
  banco.reset();
  h.objetos.clear();
  h.removidos.length = 0;
  h.aoSubir = null; h.aposCarregar = null;
  h.navegador.abriu = 0; h.navegador.fechou = 0; h.navegador.html = ''; h.navegador.pdfOpcoes = null;
  banco.poe('company', {
    user_id: U1, nome: 'Solar Teste Ltda', nome_fantasia: 'Solar Teste Energia', cnpj: '11.222.333/0001-81', cor_marca: '#1d6fb8',
    logo_base64: '', tecnico_nome: '', tecnico2_nome: 'Bruno Lima', tecnico2_crt_cft: 'CFT 123', engenheiro_nome: 'Eva Eng', engenheiro_crea: 'CREA 9',
  });
});

describe('criar', () => {
  it('nasce com código MP, 9 itens sem status, padrões e o 1º técnico da empresa', async () => {
    const r = await criar();
    const ano = hojeBRT().slice(0, 4);
    expect(r.codigo).toBe(`MP${ano}001`);
    expect(r.status).toBe('em_andamento');
    expect(r.dados.itens).toHaveLength(9);
    expect(r.dados.itens.every((i: any) => i.status === null)).toBe(true);
    expect(r.dados.atividades.filter((a: any) => a.feita).map((a: any) => a.key)).toEqual(['limpeza', 'inspecao_visual']);
    expect(r.dados.periodicidade_meses).toBe(6);
    expect(r.dados.responsavel).toEqual({ nome: 'Bruno Lima', registro: 'CFT 123' });
    expect((r as any).resumo.faltam_status).toBe(9);
  });
  it('sem técnico cai no engenheiro; sem nenhum, vazio', async () => {
    banco.tabelas.company![0] = { ...banco.tabelas.company![0], tecnico2_nome: '' };
    expect((await criar()).dados.responsavel).toEqual({ nome: 'Eva Eng', registro: 'CREA 9' });
    expect((await criar(U2)).dados.responsavel).toEqual({ nome: '', registro: '' });
  });
  it('o número sobe por usuário e cada usuário começa em 001', async () => {
    const ano = hojeBRT().slice(0, 4);
    expect((await criar()).codigo).toBe(`MP${ano}001`);
    expect((await criar()).codigo).toBe(`MP${ano}002`);
    expect((await criar(U2)).codigo).toBe(`MP${ano}001`);
  });
  it('colisão no índice único (23505) tenta de novo com o número seguinte', async () => {
    banco.falhas['manutencoes.insert'] = { erro: { code: '23505', message: 'duplicate' }, uma: true };
    const ano = hojeBRT().slice(0, 4);
    expect((await criar()).codigo).toBe(`MP${ano}001`);
  });
  it('sem login é 401', async () => {
    expect((await request(app).post('/manutencoes').send({})).status).toBe(401);
  });
});

describe('PUT', () => {
  it('substitui `dados`, recalcula a próxima visita e NÃO toca fotos nem assinaturas', async () => {
    const r = await criar();
    linha(r.id).fotos = { modulos: [{ path: `manutencoes/${U1}/${r.id}/modulos-1.jpg`, ts: 't' }] };
    linha(r.id).assinaturas = { tecnico: { path: 'x.png', nome: 'B', ts: 't' } };
    banco.escritas.length = 0;

    const res = await put(`/manutencoes/${r.id}`, {
      dados: dadosCompletos({ periodicidade_meses: 6 }, { dps: { status: 'atencao' } }),
      data_inspecao: '2026-08-31', cliente_nome: 'Maria S.',
    });
    expect(res.status).toBe(200);
    expect(res.body.resumo).toMatchObject({ selo: 'atencao', faltam_status: 0, proxima_visita: '2027-02-28' });
    expect(res.body.resumo.pendencias).toHaveLength(1);

    const upd = banco.escritas.filter((e) => e.tabela === 'manutencoes' && e.op === 'update');
    expect(upd).toHaveLength(1);
    expect(Object.keys(upd[0]!.payload)).not.toContain('fotos');
    expect(Object.keys(upd[0]!.payload)).not.toContain('assinaturas');
    expect(linha(r.id).fotos.modulos).toHaveLength(1);
    expect(linha(r.id).assinaturas.tecnico.nome).toBe('B');
    expect(linha(r.id)).toMatchObject({ data_inspecao: '2026-08-31', proxima_visita: '2027-02-28', cliente_nome: 'Maria S.' });
  });
  it('cliente_id que não existe mais: 200, vínculo some e o nome enviado fica', async () => {
    const r = await criar();
    const res = await put(`/manutencoes/${r.id}`, { dados: dadosCompletos(), cliente_id: ID_INEXISTENTE, cliente_nome: 'Maria Antiga' });
    expect(res.status).toBe(200);
    expect(linha(r.id)).toMatchObject({ cliente_id: null, cliente_nome: 'Maria Antiga' });
  });
  it('cliente_id de outro usuário também solta o vínculo, sem vazar o nome do outro', async () => {
    const r = await criar();
    banco.poe('clients', { id: ID_INEXISTENTE, user_id: U2, nome: 'Cliente do Outro' });
    const res = await put(`/manutencoes/${r.id}`, { dados: dadosCompletos(), cliente_id: ID_INEXISTENTE, cliente_nome: 'Maria' });
    expect(res.status).toBe(200);
    expect(linha(r.id)).toMatchObject({ cliente_id: null, cliente_nome: 'Maria' });
  });
  it('cliente_id válido do usuário vincula e usa o nome do cadastro', async () => {
    const r = await criar();
    banco.poe('clients', { id: ID_INEXISTENTE, user_id: U1, nome: 'Cadastro Oficial' });
    const res = await put(`/manutencoes/${r.id}`, { dados: dadosCompletos(), cliente_id: ID_INEXISTENTE, cliente_nome: 'Outro' });
    expect(res.status).toBe(200);
    expect(linha(r.id)).toMatchObject({ cliente_id: ID_INEXISTENTE, cliente_nome: 'Cadastro Oficial' });
  });
  it('descarta chave desconhecida e mantém a ordem fixa dos itens', async () => {
    const r = await criar();
    const dados = dadosCompletos();
    dados.itens.push({ key: 'invasor', status: 'conforme', visto: '', providencia: '' });
    dados.itens.reverse();
    await put(`/manutencoes/${r.id}`, { dados });
    expect(linha(r.id).dados.itens.map((i: any) => i.key)).toEqual(['modulos', 'estrutura', 'cabos', 'stringbox', 'quadro_ca', 'dps', 'aterramento', 'inversor', 'monitoramento']);
  });
  it('recusa limites: texto grande, mais de 10 inversores, status inválido', async () => {
    const r = await criar();
    expect((await put(`/manutencoes/${r.id}`, { dados: dadosCompletos({ recomendacoes: 'x'.repeat(2001) }) })).status).toBe(400);
    const inv = Array.from({ length: 11 }, () => ({ marca: 'a', modelo: 'b', serie: 'c' }));
    expect((await put(`/manutencoes/${r.id}`, { dados: dadosCompletos({ sistema: { ...dadosCompletos().sistema, inversores: inv } }) })).status).toBe(400);
    expect((await put(`/manutencoes/${r.id}`, { dados: dadosCompletos({}, { dps: { status: 'otimo' } }) })).status).toBe(400);
    expect((await put(`/manutencoes/${r.id}`, { dados: dadosCompletos(), data_inspecao: '2026-02-30' })).status).toBe(400);
  });
  it('relatório concluído recusa com 409', async () => {
    const r = await criar();
    await put(`/manutencoes/${r.id}`, { dados: dadosCompletos() });
    expect((await post(`/manutencoes/${r.id}/concluir`)).status).toBe(200);
    expect((await put(`/manutencoes/${r.id}`, { dados: dadosCompletos() })).status).toBe(409);
  });
});

describe('concluir e reabrir', () => {
  it('item sem status dá 422 com a conta do que falta', async () => {
    const r = await criar();
    const res = await post(`/manutencoes/${r.id}/concluir`);
    expect(res.status).toBe(422);
    expect(res.body.faltam_status).toBe(9);
    expect(res.body.erro).toBe('Marque o status de todos os itens para continuar.');
    expect(linha(r.id).status).toBe('em_andamento');
  });
  it('nenhuma atividade feita também dá 422', async () => {
    const r = await criar();
    await put(`/manutencoes/${r.id}`, { dados: dadosCompletos({ atividades: [{ key: 'limpeza', feita: false, status: 'concluido', obs: '' }, { key: 'inspecao_visual', feita: false, status: 'concluido', obs: '' }] }) });
    expect((await post(`/manutencoes/${r.id}/concluir`)).status).toBe(422);
  });
  it('conclui gravando status, selo, próxima visita e data; reabrir zera o selo', async () => {
    const r = await criar();
    await put(`/manutencoes/${r.id}`, { dados: dadosCompletos({}, { cabos: { status: 'nao_conforme' } }), data_inspecao: '2026-10-27' });
    const c = await post(`/manutencoes/${r.id}/concluir`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'concluida', selo: 'nao_conforme', proxima_visita: '2027-04-27' });
    expect(linha(r.id).concluida_em).toBeTruthy();
    const re = await post(`/manutencoes/${r.id}/reabrir`);
    expect(re.body).toMatchObject({ status: 'em_andamento', selo: null, concluida_em: null });
  });
});

describe('isolamento entre usuários e id mal formado', () => {
  it('outro usuário recebe 404 em tudo', async () => {
    const r = await criar();
    expect((await get(`/manutencoes/${r.id}`, U2)).status).toBe(404);
    expect((await put(`/manutencoes/${r.id}`, { dados: dadosCompletos() }, U2)).status).toBe(404);
    expect((await post(`/manutencoes/${r.id}/concluir`, {}, U2)).status).toBe(404);
    expect((await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png }, U2)).status).toBe(404);
    expect((await del(`/manutencoes/${r.id}`, {}, U2)).status).toBe(404);
    expect(banco.linhas('manutencoes')).toHaveLength(1);
  });
  it('id que não é UUID é 404, não 500', async () => {
    expect((await get('/manutencoes/abc')).status).toBe(404);
    expect((await put('/manutencoes/abc', { dados: dadosCompletos() })).status).toBe(404);
  });
});

describe('listas', () => {
  it('list traz só as colunas do contrato, do usuário, da mais nova para a mais antiga', async () => {
    const a = await criar(); const b = await criar(); await criar(U2);
    linha(a.id).created_at = '2026-01-01T00:00:00Z'; linha(b.id).created_at = '2026-02-01T00:00:00Z';
    const r = await get('/manutencoes/list');
    expect(r.body.map((x: any) => x.id)).toEqual([b.id, a.id]);
    expect(Object.keys(r.body[0]).sort()).toEqual(['cliente_nome', 'codigo', 'created_at', 'data_inspecao', 'id', 'proxima_visita', 'selo', 'status']);
  });
  it('proximas: só concluídas, a mais recente por cliente, em ordem de prazo, com dias', async () => {
    const hoje = hojeBRT();
    const mk = (extra: Record<string, unknown>) => banco.poe('manutencoes', { id: crypto.randomUUID(), user_id: U1, status: 'concluida', created_at: '2026-01-01T00:00:00Z', ...extra });
    mk({ id: 'r1', cliente_id: 'c1', cliente_nome: 'Ana', data_inspecao: '2026-01-10', proxima_visita: '2026-07-10', concluida_em: '2026-01-10T10:00:00Z' });
    mk({ id: 'r2', cliente_id: 'c1', cliente_nome: 'Ana', data_inspecao: '2026-07-10', proxima_visita: '2099-01-10', concluida_em: '2026-07-10T10:00:00Z' });
    mk({ id: 'r3', cliente_id: null, cliente_nome: '  JOÃO  da Silva', data_inspecao: '2026-05-01', proxima_visita: '2000-01-01', concluida_em: '2026-05-01T10:00:00Z' });
    mk({ id: 'r4', cliente_id: null, cliente_nome: 'joao da silva', data_inspecao: '2026-04-01', proxima_visita: '1999-01-01', concluida_em: '2026-04-01T10:00:00Z' });
    banco.poe('manutencoes', { id: 'r5', user_id: U1, status: 'em_andamento', cliente_nome: 'Rascunho', data_inspecao: '2026-09-01', proxima_visita: '2026-12-01', created_at: '2026-09-01T00:00:00Z' });
    mk({ id: 'r6', user_id: U2, cliente_nome: 'Alheio', data_inspecao: '2026-09-01', proxima_visita: '2026-12-01' });
    const r = await get('/manutencoes/proximas');
    expect(r.body.map((x: any) => x.id)).toEqual(['r3', 'r2']);
    expect(r.body[0].dias).toBeLessThan(0);
    expect(r.body[1].dias).toBeGreaterThan(1000);
    expect(hoje).toBeTruthy();
  });
});

describe('fotos e assinaturas', () => {
  it('sobe foto, guarda o caminho (nunca a URL), devolve path e url', async () => {
    const r = await criar();
    const f = await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png, media_type: 'image/jpeg' });
    expect(f.status).toBe(200);
    expect(f.body.path).toMatch(new RegExp(`^manutencoes/${U1}/${r.id}/antes-\\d+-[0-9a-f]{6}\\.jpg$`));
    expect(f.body.url).toContain('https://storage.test/');
    expect(JSON.stringify(linha(r.id).fotos)).not.toContain('https://');
    const g = await get(`/manutencoes/${r.id}`);
    expect(g.body.fotos_url.antes[0]).toEqual({ path: f.body.path, url: expect.stringContaining('token=') });
  });
  it('grupo desconhecido é 400; 13ª foto do grupo é 422; formato inválido é 400', async () => {
    const r = await criar();
    expect((await post(`/manutencoes/${r.id}/foto`, { grupo: 'cozinha', base64: png })).status).toBe(400);
    expect((await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png, media_type: 'application/pdf' })).status).toBe(400);
    linha(r.id).fotos = { antes: Array.from({ length: 12 }, (_, i) => ({ path: `p${i}`, ts: 't' })) };
    expect((await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png })).status).toBe(422);
  });
  it('apaga só foto deste relatório', async () => {
    const r = await criar();
    const f = await post(`/manutencoes/${r.id}/foto`, { grupo: 'dps', base64: png });
    expect((await del(`/manutencoes/${r.id}/foto`, { path: `manutencoes/${U2}/outro/x.jpg` })).status).toBe(400);
    expect((await del(`/manutencoes/${r.id}/foto`, { path: `manutencoes/${U1}/${r.id}/nao-esta-na-lista.jpg` })).status).toBe(404);
    expect((await del(`/manutencoes/${r.id}/foto`, { path: f.body.path })).status).toBe(200);
    expect(linha(r.id).fotos.dps).toBeUndefined();
    expect(h.objetos.has(f.body.path)).toBe(false);
  });
  it('apagar foto relê as fotos: a que subiu em paralelo não é perdida', async () => {
    const r = await criar();
    const a = await post(`/manutencoes/${r.id}/foto`, { grupo: 'dps', base64: png });
    const b = await post(`/manutencoes/${r.id}/foto`, { grupo: 'dps', base64: png });
    const nova = { path: `manutencoes/${U1}/${r.id}/dps-paralela.jpg`, ts: 't' };
    h.aposCarregar = () => { linha(r.id).fotos = { dps: [...linha(r.id).fotos.dps, nova] }; };
    expect((await del(`/manutencoes/${r.id}/foto`, { path: a.body.path })).status).toBe(200);
    expect(linha(r.id).fotos.dps.map((f: any) => f.path)).toEqual([b.body.path, nova.path]);
  });
  it('foto que termina de subir depois do relatório ser concluído: 409 e o arquivo sai do bucket', async () => {
    const r = await criar();
    h.aoSubir = () => { linha(r.id).status = 'concluida'; };
    const f = await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png });
    expect(f.status).toBe(409);
    expect(linha(r.id).fotos ?? {}).toEqual({});
    expect([...h.objetos.keys()].filter((p) => p.includes('/antes-'))).toHaveLength(0);
    expect(h.removidos.some((p) => p.includes('/antes-'))).toBe(true);
  });
  it('relatório concluído entre a releitura e o update: 0 linhas gravadas vira 409 e o arquivo sai', async () => {
    const r = await criar();
    // 1ª leitura = carregar; o gancho dela arma o da 2ª (a releitura das fotos), que conclui o relatório
    // logo depois de a releitura ainda ver em_andamento. Só o filtro de status do update percebe.
    h.aposCarregar = () => { h.aposCarregar = () => { linha(r.id).status = 'concluida'; }; };
    const f = await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png });
    expect(f.status).toBe(409);
    expect(linha(r.id).fotos ?? {}).toEqual({});
    expect([...h.objetos.keys()].filter((p) => p.includes('/antes-'))).toHaveLength(0);
  });
  it('apagar foto de relatório concluído no meio do caminho é 409 e não grava', async () => {
    const r = await criar();
    const a = await post(`/manutencoes/${r.id}/foto`, { grupo: 'dps', base64: png });
    h.aposCarregar = () => { linha(r.id).status = 'concluida'; };
    expect((await del(`/manutencoes/${r.id}/foto`, { path: a.body.path })).status).toBe(409);
    expect(linha(r.id).fotos.dps).toHaveLength(1);
  });
  it('assinatura devolve o path e substitui a anterior e apaga o arquivo velho; DELETE limpa', async () => {
    const r = await criar();
    const a1 = await post(`/manutencoes/${r.id}/assinatura`, { quem: 'tecnico', base64: png, nome: 'Bruno', registro: 'CFT 123' });
    expect(a1.status).toBe(200);
    const velho = linha(r.id).assinaturas.tecnico.path;
    expect(a1.body.path).toBe(velho);
    await new Promise((ok) => setTimeout(ok, 5));
    await post(`/manutencoes/${r.id}/assinatura`, { quem: 'tecnico', base64: png, nome: 'Bruno L.', registro: 'CFT 123' });
    expect(h.objetos.has(velho)).toBe(false);
    expect(linha(r.id).assinaturas.tecnico.nome).toBe('Bruno L.');
    expect((await get(`/manutencoes/${r.id}`)).body.assinaturas_url.tecnico).toContain('https://storage.test/');
    expect((await del(`/manutencoes/${r.id}/assinatura`, { quem: 'tecnico' })).status).toBe(200);
    expect(linha(r.id).assinaturas.tecnico).toBeUndefined();
  });
  it('apagar o relatório apaga a linha e todos os arquivos do prefixo', async () => {
    const r = await criar();
    await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png });
    await post(`/manutencoes/${r.id}/assinatura`, { quem: 'cliente', base64: png, nome: 'Maria' });
    h.objetos.set(`manutencoes/${U1}/${r.id}/relatorio-1.pdf`, Buffer.from('pdf'));
    h.objetos.set(`manutencoes/${U1}/outro-id/foto.jpg`, Buffer.from('x'));
    expect((await del(`/manutencoes/${r.id}`)).status).toBe(200);
    expect(banco.linhas('manutencoes')).toHaveLength(0);
    expect([...h.objetos.keys()]).toEqual([`manutencoes/${U1}/outro-id/foto.jpg`]);
  });
});

describe('tabela ainda não criada', () => {
  it.each([['PGRST205'], ['42P01']])('vira 503 migracao_pendente (%s)', async (code) => {
    banco.falhas['manutencoes.select'] = { erro: { code, message: 'sem tabela' } };
    const l = await get('/manutencoes/list');
    expect(l.status).toBe(503);
    expect(l.body.erro).toBe('migracao_pendente');
    expect((await get('/manutencoes/proximas')).status).toBe(503);
    expect((await get(`/manutencoes/${ID_INEXISTENTE}`)).status).toBe(503);
    expect((await post('/manutencoes', { cliente_nome: 'X' })).status).toBe(503);
    const p = await request(app).get(`/m/${ID_INEXISTENTE}`);
    expect(p.status).toBe(503);
    expect(p.text).toContain('sendo liberado');
  });
  it('criar com a tabela ausente no insert também é 503', async () => {
    banco.falhas['manutencoes.insert'] = { erro: { code: 'PGRST205', message: 'sem tabela' } };
    expect((await post('/manutencoes', { cliente_nome: 'X' })).status).toBe(503);
  });
});

describe('público /m', () => {
  async function concluida(extra: Record<string, unknown> = {}) {
    const r = await criar(U1, { cliente_nome: 'Maria <b>Souza</b>' });
    await put(`/manutencoes/${r.id}`, {
      dados: dadosCompletos({ recomendacoes: 'Lavar <script>alert(1)</script> os módulos', ...extra }, { cabos: { status: 'atencao', visto: 'cabo ressecado', providencia: 'trocar' } }),
      data_inspecao: '2026-10-27',
    });
    await post(`/manutencoes/${r.id}/foto`, { grupo: 'antes', base64: png });
    await post(`/manutencoes/${r.id}/concluir`);
    return r;
  }

  it('id que não é UUID é 404 em HTML', async () => {
    for (const id of ['123', 'abc', "x'or'1", ID_INEXISTENTE.slice(1)]) {
      const r = await request(app).get(`/m/${encodeURIComponent(id)}`);
      expect(r.status).toBe(404);
      expect(r.text).toContain('Relatório não encontrado');
    }
    expect((await request(app).get(`/m/${ID_INEXISTENTE}`)).status).toBe(404);
    expect((await request(app).get('/m/abc/pdf')).status).toBe(404);
  });
  it('em andamento mostra a página de "não concluído", sem dados', async () => {
    const r = await criar();
    const res = await request(app).get(`/m/${r.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Este relatório ainda não foi concluído.');
    expect(res.text).not.toContain('Maria Souza');
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await request(app).get(`/m/${r.id}/pdf`)).status).toBe(409);
  });
  it('concluído: HTML com a marca, selo, pendência, foto assinada, sem script injetado nem dado de contato', async () => {
    const r = await concluida();
    banco.tabelas.company![0] = { ...banco.tabelas.company![0], whatsapp: '31999990000', socio_adm: 'Fulano' };
    const res = await request(app).get(`/m/${r.id}`);
    expect(res.status).toBe(200);
    const t = res.text;
    expect(t).toContain('Solar Teste Energia');
    expect(t).toContain('Com pontos de atenção');
    expect(t).toContain('Cabos e conectores');
    expect(t).toContain('cabo ressecado');
    expect(t).toContain('https://storage.test/manutencoes/');
    expect(t).toContain('MP-');
    expect(t).not.toContain('<script>alert');
    expect(t).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(t).not.toContain('<b>Souza</b>');
    expect(t).not.toContain('31999990000');
    expect(t).not.toContain('loading="lazy"');
    expect(t).toContain('@page');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
  it('depois de reabrir ou apagar, a página pública reflete na hora (sem cache)', async () => {
    const r = await concluida();
    expect((await request(app).get(`/m/${r.id}`)).headers['cache-control']).toBe('private, no-store');
    await post(`/manutencoes/${r.id}/reabrir`);
    const reaberto = await request(app).get(`/m/${r.id}`);
    expect(reaberto.text).toContain('Este relatório ainda não foi concluído.');
    expect(reaberto.headers['cache-control']).toBe('no-store');
    await del(`/manutencoes/${r.id}`);
    expect((await request(app).get(`/m/${r.id}`)).status).toBe(404);
  });
  it('conclusão manual vence a automática', async () => {
    const r = await concluida({ conclusao_manual: 'Texto escrito pelo técnico.' });
    const t = (await request(app).get(`/m/${r.id}`)).text;
    expect(t).toContain('Texto escrito pelo técnico.');
    expect(t).not.toContain('pedem acompanhamento e ajuste');
  });
  it('PDF: gera uma vez, sobe por versão, redireciona e não regera enquanto nada mudar', async () => {
    const r = await concluida();
    const a = await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    expect(a.status).toBe(302);
    expect(a.headers.location).toMatch(new RegExp(`^https://storage.test/manutencoes/${U1}/${r.id}/relatorio-v\\d+-\\d+-[0-9a-f]{8}\\.pdf`));
    expect(h.navegador.abriu).toBe(1);
    expect(h.navegador.fechou).toBe(1);
    expect(h.navegador.pdfOpcoes).toMatchObject({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    expect(h.navegador.html).toContain('Relatório de manutenção preventiva');
    const b = await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    expect(b.status).toBe(302);
    expect(h.navegador.abriu).toBe(1);
  });
  it('PDF novo depois de mexer (reabrir e concluir) e o velho sai do bucket', async () => {
    const r = await concluida();
    await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    const antes = [...h.objetos.keys()].filter((p) => p.endsWith('.pdf'));
    expect(antes).toHaveLength(1);
    await post(`/manutencoes/${r.id}/reabrir`);
    await new Promise((ok) => setTimeout(ok, 5));
    await post(`/manutencoes/${r.id}/concluir`);
    await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    expect(h.navegador.abriu).toBe(2);
    const depois = [...h.objetos.keys()].filter((p) => p.endsWith('.pdf'));
    expect(depois).toHaveLength(1);
    expect(depois[0]).not.toBe(antes[0]);
  });
  it('navegador sempre fecha, mesmo se o PDF falhar', async () => {
    const r = await concluida();
    const orig = h.navegador;
    const setOriginal = h.objetos.set.bind(h.objetos);
    h.objetos.set = ((): never => { throw new Error('bucket fora'); }) as never;
    try {
      const res = await request(app).get(`/m/${r.id}/pdf`).redirects(0);
      expect(res.status).toBe(500);
      expect(orig.fechou).toBe(1);
    } finally {
      h.objetos.set = setOriginal;
    }
  });
  it('tela: marca do integrador, data de emissão e prévia do WhatsApp, sem o contato da empresa', async () => {
    const r = await concluida();
    banco.tabelas.company![0] = { ...banco.tabelas.company![0], whatsapp: '31999990000', endereco: 'Rua Secreta, 1' };
    const t = (await request(app).get(`/m/${r.id}`)).text;
    expect(t).toContain('<b>Solar Teste Energia</b>');
    expect(t).toContain('<span>CNPJ 11.222.333/0001-81</span>');
    expect(t).toMatch(/<span>Emitido em \d{2}\/\d{2}\/\d{4}<\/span>/);
    expect(t).toContain('<meta property="og:title" content="Manutenção preventiva MP-');
    expect(t).toContain('<meta property="og:description" content="Relatório de manutenção preventiva de Maria &lt;b&gt;Souza&lt;/b&gt;, por Solar Teste Energia."/>');
    expect(t).toContain('<meta property="og:type" content="article"/>');
    expect(t).not.toContain('31999990000');
    expect(t).not.toContain('Rua Secreta');
    expect(t).toContain('class="barra"');
    expect(t).not.toContain('class="online"');
  });
  it('PDF: o nome leva a versão, o instante da última alteração e o hash da marca', async () => {
    const r = await concluida();
    const a = await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    const ms = new Date(linha(r.id).updated_at).getTime();
    expect(a.headers.location).toContain(`/relatorio-v2-${ms}-`);
    const guardados = [...h.objetos.keys()].filter((p) => p.endsWith('.pdf'));
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatch(new RegExp(`/relatorio-v2-${ms}-[0-9a-f]{8}\\.pdf$`));
    expect(guardados[0]!.endsWith('-00000000.pdf')).toBe(false);
  });
  it('PDF: trocar o nome da empresa gera outro arquivo, o velho sai do bucket e sem mexer de novo não regera', async () => {
    const r = await concluida();
    await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    const antes = [...h.objetos.keys()].filter((p) => p.endsWith('.pdf'));
    banco.tabelas.company![0] = { ...banco.tabelas.company![0], nome_fantasia: 'Solar Outro Nome' };
    const b = await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    expect(b.status).toBe(302);
    expect(h.navegador.abriu).toBe(2);
    expect(h.navegador.html).toContain('Solar Outro Nome');
    const depois = [...h.objetos.keys()].filter((p) => p.endsWith('.pdf'));
    expect(depois).toHaveLength(1);
    expect(depois[0]).not.toBe(antes[0]);
    await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    expect(h.navegador.abriu).toBe(2);
  });
  it('PDF: o HTML vem em modo PDF e o rodapé leva a empresa, o código do relatório, o cliente e "Página"', async () => {
    const r = await concluida();
    banco.tabelas.company![0] = { ...banco.tabelas.company![0], whatsapp: '31999990000' };
    await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    const doc = h.navegador.html;
    expect(doc).not.toContain('class="barra"');
    expect(doc).not.toContain('Baixar PDF');
    expect(doc).not.toContain('<a href="https://storage.test');
    expect(doc).not.toContain('31999990000');
    expect(doc).toContain('class="online"');
    expect(doc).toContain(`/m/${r.id}`);
    const rodape = h.navegador.pdfOpcoes.footerTemplate as string;
    expect(rodape).toMatch(/Solar Teste Energia · MP-\d{4}-001 · Maria &lt;b&gt;Souza&lt;\/b&gt;/);
    expect(rodape).toContain('Página');
    expect(rodape).toContain('class="pageNumber"');
    expect(rodape).toContain('class="totalPages"');
  });
  it('erro ao ler a marca: a tela e o PDF saem sem a marca, sem virar 500', async () => {
    const r = await concluida();
    banco.falhas['company.select'] = { erro: { code: 'XX000', message: 'banco fora' } };
    const tela = await request(app).get(`/m/${r.id}`);
    expect(tela.status).toBe(200);
    expect(tela.text).toContain('Relatório de manutenção preventiva');
    expect(tela.text).not.toContain('Solar Teste Energia');
    const pdf = await request(app).get(`/m/${r.id}/pdf`).redirects(0);
    expect(pdf.status).toBe(302);
    expect(pdf.headers.location).toMatch(/relatorio-v2-\d+-00000000\.pdf/);
    expect(h.navegador.html).not.toContain('Solar Teste Energia');
  });
  it('assinatura do técnico com registro, data e hora; o cliente que não assinou aparece só com o nome', async () => {
    const r = await criar(U1, { cliente_nome: 'Maria Souza' });
    await put(`/manutencoes/${r.id}`, { dados: dadosCompletos(), data_inspecao: '2026-10-27' });
    await post(`/manutencoes/${r.id}/assinatura`, { quem: 'tecnico', base64: png, nome: 'Bruno Lima', registro: 'CFT 123' });
    await post(`/manutencoes/${r.id}/concluir`);
    const t = (await request(app).get(`/m/${r.id}`)).text;
    expect(t).toContain('<p class="nm">Bruno Lima</p><p class="rg">Registro: CFT 123</p>');
    expect(t).toMatch(/<p class="dt">Assinado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}<\/p>/);
    expect(t).toContain('<p class="nm">Maria Souza</p><p class="rg"></p><p class="dt"></p>');
    expect(t).not.toContain('Sem assinatura');
  });
  it('sem assinatura e sem responsável o bloco do técnico diz "Sem assinatura"', async () => {
    banco.tabelas.company![0] = { ...banco.tabelas.company![0], tecnico2_nome: '', tecnico2_crt_cft: '', engenheiro_nome: '', engenheiro_crea: '' };
    const r = await criar(U1, { cliente_nome: 'Maria Souza' });
    await put(`/manutencoes/${r.id}`, { dados: dadosCompletos({ responsavel: { nome: '', registro: '' } }), data_inspecao: '2026-10-27' });
    await post(`/manutencoes/${r.id}/concluir`);
    const t = (await request(app).get(`/m/${r.id}`)).text;
    expect(t).toContain('<p class="nm sem">Sem assinatura</p><p class="rg"></p><p class="dt"></p><p class="cap">Assinatura do técnico</p>');
  });
  it('atividade parcial: a conclusão avisa, as pendências explicam e a atividade sai de "realizadas"', async () => {
    const r = await concluida({
      atividades: [
        { key: 'limpeza', feita: true, status: 'concluido', obs: '' },
        { key: 'inspecao_visual', feita: true, status: 'concluido', obs: '' },
        { key: 'reaperto', feita: true, status: 'parcial', obs: 'Faltou acesso ao quadro.' },
      ],
    });
    const t = (await request(app).get(`/m/${r.id}`)).text;
    expect(t).toContain('Ficou incompleta 1 atividade. Veja o motivo em Pendências e prioridades.');
    expect(t).toContain('<h3>O que ficou por fazer nesta visita</h3>');
    expect(t).toContain('Faltou acesso ao quadro.');
    expect(t).toContain('<span>Atividades concluídas</span><b>2 de 3</b>');
    expect(t).toContain('<span>Ficou por fazer</span><b>1</b>');
    expect(t.slice(t.indexOf('<h2>Atividades realizadas</h2>'), t.indexOf('</section>', t.indexOf('<h2>Atividades realizadas</h2>')))).not.toContain('Reaperto de conexões');
  });
});
