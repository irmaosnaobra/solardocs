import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Proposta off-grid no /documents: acesso do add-on em QUALQUER plano (402), modelo 2 com fotos, bancos e aceite,
// link rastreado e guarda de payload. O supabase é um mock por TABELA (a ordem das chamadas não importa).

const h = vi.hoisted(() => ({
  company: {} as Record<string, unknown>,
  user: {} as Record<string, unknown>,
  docRow: null as Record<string, unknown> | null,
  // O que o acessos() devolve: produtos liberados e se é admin.
  acessos: { produtos: new Set<string>(), isAdmin: false } as { produtos: Set<string>; isAdmin: boolean },
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ tabela: string; linha: Record<string, unknown> }>,
  rpc: vi.fn(),
  assinarPaths: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      let modo: 'select' | 'insert' | 'update' = 'select';
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'lt', 'lte', 'gte', 'not', 'in', 'limit', 'is', 'neq']) q[m] = () => q;
      q.insert = (linha: Record<string, unknown>) => { modo = 'insert'; if (tabela === 'documents') h.inserts.push(linha); return q; };
      q.update = (linha: Record<string, unknown>) => { modo = 'update'; h.updates.push({ tabela, linha }); return q; };
      q.single = async () => {
        if (tabela === 'company') return { data: h.company, error: null };
        if (tabela === 'users') return { data: h.user, error: null };
        if (tabela === 'documents') return { data: modo === 'insert' ? { id: 'doc-1' } : h.docRow, error: null };
        return { data: null, error: null };
      };
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: modo === 'update' ? [{ id: 'x' }] : [], error: null }).then(ok);
      return q;
    },
    rpc: (...a: unknown[]) => h.rpc(...a),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        createSignedUrls: (...a: unknown[]) => h.assinarPaths(...a),
      }),
    },
  },
}));
// O acesso é o REAL (acessoOffGrid); só a fonte única de acessos() é mockada.
vi.mock('../services/produtos/acessos', () => ({
  acessos: async () => ({ ...h.acessos, plano: 'pro', assinante: true, origem: {} }),
  concederAcesso: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/jwt', () => ({
  signToken: vi.fn().mockReturnValue('mock-token'),
  verifyToken: vi.fn((t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  }),
}));
vi.mock('stripe', () => ({ default: class { customers = { list: vi.fn().mockResolvedValue({ data: [] }) } } }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('../utils/mailer', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  sendWelcomeWhatsApp: vi.fn(),
  handleIncomingWhatsApp: vi.fn(),
  processMessageQueue: vi.fn().mockResolvedValue({ processed: 0 }),
}));
vi.mock('../services/aiService', () => ({ generateDocumentWithAI: vi.fn().mockResolvedValue('<html>doc</html>') }));
vi.mock('../services/templateService', () => ({
  generateFromTemplate: vi.fn().mockReturnValue('<html>template</html>'),
  propostaDiasValidade: vi.fn().mockReturnValue(7),
}));
vi.mock('../middleware/rateLimiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/rateLimiter')>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from '../app';
import { generateFromTemplate } from '../services/templateService';

const AUTH = 'Bearer valid-token';
const DOC_UUID = 'b1ffc99a-9c0b-4ef8-bb6d-6bb9bd380a22';
const ASSIN_OK = {
  empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11.222.333/0001-81', representante: 'Carlos Pereira', cargo: 'Sócio' },
  cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '529.982.247-25' },
};
const MEU = 'portfolio/user-123/obra/1700000000000-abcdef12.jpg';
const ALHEIO = 'portfolio/user-999/obra/1700000000000-abcdef12.jpg';

const gerar = (body: Record<string, unknown> = {}) => request(app)
  .post('/documents/generate').set('Authorization', AUTH)
  .send({ tipo: 'propostaOffGrid', cliente_nome_avulso: 'Maria Aparecida Souza', useTemplate: true, modeloNumero: 1, fields: {}, ...body });

const templateChamado = () => vi.mocked(generateFromTemplate).mock.calls[0];
const gravado = () => h.inserts[h.inserts.length - 1] as { dados_json: Record<string, any>; modelo_usado: string };

beforeEach(() => {
  vi.clearAllMocks();
  h.company = { id: 'comp-1', nome: 'Empresa', cnpj: '00.000.000/0001-00', slug: 'empresa', fotos_obras: [] };
  h.user = { plano: 'pro', is_admin: false, documentos_usados: 5, limite_documentos: 90 };
  h.docRow = null;
  h.acessos = { produtos: new Set(['offgrid']), isAdmin: false };
  h.inserts = [];
  h.updates = [];
  h.rpc.mockReset().mockResolvedValue({ data: '20260050', error: null });
  h.assinarPaths.mockReset().mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: 'https://x.test/nova/' + path, error: null })), error: null,
  }));
});

describe('POST /documents/generate: proposta off-grid só com o acesso Off-Grid, em qualquer plano', () => {
  it('free sem o add-on: 402 no formato do /offgrid/orcar, sem reservar número nem gerar', async () => {
    h.user = { plano: 'free', is_admin: false };
    h.acessos = { produtos: new Set(), isAdmin: false };
    const res = await gerar();
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      trancado: true, preco_addon: 97, tabela_versao: expect.any(String),
      motivo: 'A proposta off-grid faz parte do acesso ao Kit Off-Grid.',
      error: 'A proposta off-grid faz parte do acesso ao Kit Off-Grid.',
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(generateFromTemplate).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it('plano pago SEM o add-on: 402 também (antes passava)', async () => {
    h.user = { plano: 'pro', is_admin: false, documentos_usados: 5, limite_documentos: 90 };
    h.acessos = { produtos: new Set(), isAdmin: false };
    const res = await gerar();
    expect(res.status).toBe(402);
    expect(res.body.trancado).toBe(true);
    expect(generateFromTemplate).not.toHaveBeenCalled();
    // O modelo 2 e a assinatura inválida não passam na frente: quem não tem acesso recebe 402, nunca 400.
    const modelo2 = await gerar({ modeloNumero: 2, fields: { assinatura: { lixo: true } } });
    expect(modelo2.status).toBe(402);
  });

  it('plano pago COM o entitlement: gera, grava o número, o link rastreado e a validade', async () => {
    const res = await gerar({ fields: { validade_dias: 5 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tipo: 'propostaOffGrid', doc_id: 'doc-1', codigo: '20260050', codigo_curto: '20260050', modelo_usado: 'modelo-1' });
    expect(typeof res.body.link_expira_em).toBe('string');
    expect(gravado().dados_json).toMatchObject({ link_rastreado: true, codigo: '20260050', link_expira_em: res.body.link_expira_em });
  });

  it('admin gera (o acessos() entrega todos os produtos ao admin)', async () => {
    h.user = { plano: 'free', is_admin: true };
    h.acessos = { produtos: new Set(['offgrid']), isAdmin: true };
    const res = await gerar();
    expect(res.status).toBe(200);
  });

  it('modelo 1: a validade do link é presa em 180 dias, como a data impressa', async () => {
    const res = await gerar({ fields: { validade_dias: 400 } });
    expect(res.status).toBe(200);
    const ate = new Date(res.body.link_expira_em).getTime();
    const dias = (ate - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(178);
    expect(dias).toBeLessThan(182);
  });

  it('outros tipos não passam pelo gate do off-grid (documento comum, plano pago, sem o add-on)', async () => {
    h.acessos = { produtos: new Set(), isAdmin: false };
    const res = await request(app).post('/documents/generate').set('Authorization', AUTH)
      .send({ tipo: 'propostaSolar', cliente_nome_avulso: 'Maria Aparecida Souza', useTemplate: true, modeloNumero: 1, fields: {} });
    expect(res.status).toBe(200);
  });
});

describe('POST /documents/generate: proposta off-grid, modelo 2 (Completa)', () => {
  it('junta as fotos pelo path do PRÓPRIO usuário e ignora URL, path de outro usuário e URL do cliente', async () => {
    const daEmpresa = [{ path: 'portfolio/user-123/obra/1700000000001-abcdef13.jpg', legenda: 'Da empresa' }];
    h.company = { ...h.company, fotos_obras: daEmpresa };
    const res = await gerar({
      modeloNumero: 2,
      fields: { fotos_obras: [{ path: MEU, url: 'http://interno/x' }, { path: ALHEIO, url: 'https://a/b' }, { path: 'https://evil.test/x.jpg', url: 'https://evil.test/x.jpg' }] },
    });
    expect(res.status).toBe(200);
    const [tipo, , , camposTemplate, modelo] = templateChamado();
    expect(tipo).toBe('propostaOffGrid');
    expect(modelo).toBe(2);
    // Template: as próprias primeiro, depois as da empresa, cada uma com URL assinada AGORA pelo servidor.
    expect((camposTemplate as { fotos_obras: Array<{ path: string; url: string }> }).fotos_obras.map((f) => [f.path, f.url])).toEqual([
      [MEU, 'https://x.test/nova/' + MEU],
      [daEmpresa[0].path, 'https://x.test/nova/' + daEmpresa[0].path],
    ]);
    const tudo = JSON.stringify([camposTemplate, gravado().dados_json]);
    expect(tudo).not.toContain('interno');
    expect(tudo).not.toContain('user-999');
    expect(tudo).not.toContain('evil.test');
    // O que o servidor assinou foram só os paths do usuário.
    expect(h.assinarPaths.mock.calls[0][0]).toEqual([MEU, daEmpresa[0].path]);
    // dados_json: só as fotos PRÓPRIAS da proposta (as da empresa têm a fonte delas).
    expect(gravado().dados_json.fotos_obras.map((f: { path: string }) => f.path)).toEqual([MEU]);
    expect(gravado().modelo_usado).toBe('modelo-2');
  });

  it('[] não tira as fotos da empresa; no máximo 12 vão para o template', async () => {
    h.company = { ...h.company, fotos_obras: Array.from({ length: 12 }, (_, i) => ({ path: `portfolio/user-123/obra/17000000${String(i).padStart(4, '0')}-abcdef0${i % 10}.jpg` })) };
    const res = await gerar({ modeloNumero: 2, fields: { fotos_obras: [{ path: MEU }] } });
    expect(res.status).toBe(200);
    const campos = templateChamado()[3] as { fotos_obras: unknown[] };
    expect(campos.fotos_obras).toHaveLength(12);
    vi.mocked(generateFromTemplate).mockClear();
    const vazio = await gerar({ modeloNumero: 2, fields: { fotos_obras: [] } });
    expect(vazio.status).toBe(200);
    expect((templateChamado()[3] as { fotos_obras: unknown[] }).fotos_obras).toHaveLength(12);
  });

  it('modelo 1 não junta fotos (a galeria é do modelo 2)', async () => {
    h.company = { ...h.company, fotos_obras: [{ path: MEU }] };
    const res = await gerar({ modeloNumero: 1, fields: {} });
    expect(res.status).toBe(200);
    expect(h.assinarPaths).not.toHaveBeenCalled();
  });

  it('assinatura é opcional: sem ela gera (sem a chave); com ela válida grava a versão limpa', async () => {
    const sem = await gerar({ modeloNumero: 2, fields: { assinatura: null } });
    expect(sem.status).toBe(200);
    expect('assinatura' in gravado().dados_json).toBe(false);
    const com = await gerar({ modeloNumero: 2, fields: { assinatura: ASSIN_OK } });
    expect(com.status).toBe(200);
    expect(gravado().dados_json.assinatura.cliente.documento).toBe('52998224725');
    expect(gravado().dados_json.assinatura.empresa.cnpj).toBe('11222333000181');
  });

  it('assinatura que veio e é inválida: 400 com a frase, antes de gastar número e cota', async () => {
    h.rpc.mockClear();
    const cpf = await gerar({ modeloNumero: 2, fields: { assinatura: { ...ASSIN_OK, cliente: { ...ASSIN_OK.cliente, documento: '111.111.111-11' } } } });
    expect(cpf.status).toBe(400);
    expect(cpf.body.error).toBe('CPF do cliente inválido. Confira os números.');
    const lixo = await gerar({ modeloNumero: 2, fields: { assinatura: 'qualquer coisa' } });
    expect(lixo.status).toBe(400);
    expect(lixo.body.error).toBe('Preencha as assinaturas do cliente e da empresa, ou deixe a assinatura em branco.');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(generateFromTemplate).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it('modelo 1 não valida assinatura (só o modelo 2 tem folha de aceite)', async () => {
    const res = await gerar({ modeloNumero: 1, fields: { assinatura: { lixo: true } } });
    expect(res.status).toBe(200);
  });
});

describe('POST /documents/generate: limite do payload da proposta off-grid', () => {
  const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ nome: `Item ${i}`, qtd: 1 }));
  it('itens acima de 20, aparelhos acima de 60 e texto livre acima de 2.000: 400; no limite passa', async () => {
    expect((await gerar({ fields: { itens_cliente: itens(21) } })).status).toBe(400);
    expect((await gerar({ fields: { aparelhos: itens(61) } })).status).toBe(400);
    const texto = await gerar({ modeloNumero: 2, fields: { pag_custom: 'a'.repeat(2001) } });
    expect(texto.status).toBe(400);
    expect(texto.body.error).toContain('pag_custom');
    expect(generateFromTemplate).not.toHaveBeenCalled();
    expect((await gerar({ fields: { itens_cliente: itens(20), aparelhos: itens(60), pag_custom: 'a'.repeat(2000) } })).status).toBe(200);
  });
});

describe('POST /documents/:id/regenerate: proposta off-grid', () => {
  const DOIS_DIAS_ATRAS = new Date(Date.now() - 2 * 86400000).toISOString();
  const docOff = (dados: Record<string, unknown> = {}) => ({
    id: DOC_UUID, tipo: 'propostaOffGrid', cliente_id: null, terceiro_id: null, cliente_nome: 'Maria Aparecida Souza',
    arquivo_url: null, codigo_curto: '20260050', dados_json: { codigo: '20260050', ...dados }, created_at: DOIS_DIAS_ATRAS,
  });
  const post = (body: Record<string, unknown> = {}) => request(app)
    .post(`/documents/${DOC_UUID}/regenerate`).set('Authorization', AUTH)
    .send({ fields: {}, useTemplate: true, modeloNumero: 2, cliente_nome_avulso: 'Maria Aparecida Souza', ...body });

  beforeEach(() => { h.docRow = docOff(); });

  it('sem o add-on (free ou pago): 402 no mesmo formato, nada gravado', async () => {
    h.acessos = { produtos: new Set(), isAdmin: false };
    for (const plano of ['free', 'pro']) {
      h.user = { plano, is_admin: false };
      const res = await post();
      expect(res.status).toBe(402);
      expect(res.body).toMatchObject({ trancado: true, preco_addon: 97, motivo: 'Editar a proposta off-grid faz parte do acesso ao Kit Off-Grid.' });
    }
    expect(h.updates.filter((u) => u.tabela === 'documents')).toHaveLength(0);
    expect(generateFromTemplate).not.toHaveBeenCalled();
  });

  it('modelo 2: fotos pelo path do usuário, link rastreado regravado, número e emissão preservados', async () => {
    h.company = { ...h.company, fotos_obras: [{ path: MEU }] };
    const res = await post({ fields: { fotos_obras: [{ path: ALHEIO, url: 'http://interno/x' }] } });
    expect(res.status).toBe(200);
    const campos = templateChamado()[3] as Record<string, any>;
    expect(campos.fotos_obras).toEqual([{ path: MEU, url: 'https://x.test/nova/' + MEU }]);
    expect(JSON.stringify(campos)).not.toContain('interno');
    expect(campos.codigo).toBe('20260050');
    expect(campos.emitido_em).toBe(DOIS_DIAS_ATRAS);
    const upd = h.updates.find((u) => u.tabela === 'documents')!.linha as { dados_json: Record<string, any> };
    expect(upd.dados_json.link_rastreado).toBe(true);
    expect(typeof upd.dados_json.link_expira_em).toBe('string');
    expect(upd.dados_json.fotos_obras).toEqual([]); // a da empresa não fica gravada na proposta
  });

  it('assinatura nova inválida: 400; sem assinatura nova, a SALVA fica; lixo não some calado', async () => {
    const ruim = await post({ fields: { assinatura: { ...ASSIN_OK, empresa: { ...ASSIN_OK.empresa, representante: '' } } } });
    expect(ruim.status).toBe(400);
    expect(ruim.body.error).toBe('Escreva quem assina pela sua empresa.');
    const lixo = await post({ fields: { assinatura: 'qualquer coisa' } });
    expect(lixo.status).toBe(400);
    h.docRow = docOff({ assinatura: { empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio' }, cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' } } });
    vi.mocked(generateFromTemplate).mockClear();
    const salva = await post({ fields: {} });
    expect(salva.status).toBe(200);
    expect((templateChamado()[3] as Record<string, any>).assinatura.cliente.documento).toBe('52998224725');
  });

  it('plano com limite não troca o cliente da assinatura salva (a trava de cota do modelo 4 vale aqui)', async () => {
    h.docRow = docOff({ assinatura: { empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio' }, cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' } } });
    const res = await post({ fields: { assinatura: { ...ASSIN_OK, cliente: { tipo: 'PF', nome: 'Outro Cliente Silva', documento: '111.444.777-35' } } } });
    expect(res.status).toBe(200);
    expect((templateChamado()[3] as Record<string, any>).assinatura.cliente.nome).toBe('Maria Aparecida Souza');
  });

  it('payload grande demais: 400 também na reedição', async () => {
    const res = await post({ fields: { itens_cliente: Array.from({ length: 21 }, (_, i) => ({ nome: `I${i}`, qtd: 1 })) } });
    expect(res.status).toBe(400);
  });
});

describe('POST /documents/save: a proposta off-grid não passa por aqui sem o acesso Off-Grid', () => {
  const salvar = (body: Record<string, unknown> = {}) => request(app)
    .post('/documents/save').set('Authorization', AUTH)
    .send({ tipo: 'propostaOffGrid', content: '<html>doc</html>', cliente_nome: 'Maria Aparecida Souza', ...body });

  it('sem o add-on: 402 no mesmo formato do generate, sem gravar nada', async () => {
    h.acessos = { produtos: new Set(), isAdmin: false };
    const res = await salvar();
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      trancado: true, preco_addon: 97,
      motivo: 'A proposta off-grid faz parte do acesso ao Kit Off-Grid.',
      error: 'A proposta off-grid faz parte do acesso ao Kit Off-Grid.',
    });
    expect(h.inserts).toHaveLength(0);
  });

  it('com o add-on e como admin: grava (201)', async () => {
    const comAddon = await salvar();
    expect(comAddon.status).toBe(201);
    expect(h.inserts).toHaveLength(1);
    h.user = { plano: 'free', is_admin: true };
    h.acessos = { produtos: new Set(['offgrid']), isAdmin: true }; // o acessos() entrega todos os produtos ao admin
    const admin = await salvar();
    expect(admin.status).toBe(201);
    expect(h.inserts).toHaveLength(2);
  });

  it('outro tipo de documento não muda: grava mesmo sem o add-on', async () => {
    h.acessos = { produtos: new Set(), isAdmin: false };
    const res = await salvar({ tipo: 'propostaSolar' });
    expect(res.status).toBe(201);
    expect(h.inserts).toHaveLength(1);
  });
});
