import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const CLIENT_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const DOC_UUID    = 'b1ffc99a-9c0b-4ef8-bb6d-6bb9bd380a22';
const mockSingle  = vi.fn();
// Reserva do número da proposta (rpc reservar_codigo_curto).
const mockRpc     = vi.fn();
// Spies compartilhados do Storage: o regenerate PRECISA trocar o arquivo, porque
// /p/:id e o PDF leem o arquivo_url antes do content.
const mockUpload  = vi.fn().mockResolvedValue({ error: null });
const mockRemove  = vi.fn().mockResolvedValue({ error: null });
// Reassinatura das galerias do modelo Completo (renovarUrlsPortfolio).
const mockSignedUrls = vi.fn();
// O que o controller manda para documents.insert (a prova do dados_json gravado).
const mockInsert = vi.fn();

// ─── mocks antes do import de app ───────────────────────────────────
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: mockSingle,
      insert: vi.fn(function (this: unknown, ...a: unknown[]) { mockInsert(...a); return this; }),
      // update(...).eq(...).select('id') devolve a linha acertada (o controller confere que o doc ainda existe).
      update: vi.fn(() => {
        const q: Record<string, unknown> = {};
        for (const m of ['eq', 'select', 'lt']) q[m] = () => q;
        q.single = mockSingle;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'x' }], error: null }).then(ok);
        return q;
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
      lt:     vi.fn().mockReturnThis(),
      in:     vi.fn().mockResolvedValue({ data: [], error: null }),
      not:    vi.fn().mockReturnThis(),
      lte:    vi.fn().mockReturnThis(),
    })),
    // Função (e não mockRpc direto): o factory roda antes da const ser inicializada.
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: vi.fn(() => ({ upload: mockUpload, remove: mockRemove, createSignedUrls: (...a: unknown[]) => mockSignedUrls(...a) })) },
  },
}));
vi.mock('../utils/logger',    () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/jwt',       () => ({
  signToken:   vi.fn().mockReturnValue('mock-token'),
  verifyToken: vi.fn((t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  }),
}));
vi.mock('stripe',             () => ({ default: class { customers = { list: vi.fn().mockResolvedValue({ data: [] }) } } }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('../utils/mailer',    () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  sendWelcomeWhatsApp:    vi.fn(),
  handleIncomingWhatsApp: vi.fn(),
  processMessageQueue:    vi.fn().mockResolvedValue({ processed: 0 }),
}));
vi.mock('../services/aiService',      () => ({ generateDocumentWithAI: vi.fn().mockResolvedValue('<html>doc</html>') }));
vi.mock('../services/templateService', () => ({
  generateFromTemplate: vi.fn().mockReturnValue('<html>template</html>'),
  propostaDiasValidade: vi.fn().mockReturnValue(7),
}));

// O teto de 10 gerações por minuto (aiLimiter) é do app, não do que este arquivo prova: passa direto.
vi.mock('../middleware/rateLimiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/rateLimiter')>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from '../app';
// Já mockado acima — serve pra inspecionar com que fields o template foi chamado.
import { generateFromTemplate } from '../services/templateService';
import { linkExpiraEm } from '../services/propostaLink';

const AUTH = 'Bearer valid-token';

beforeEach(() => vi.clearAllMocks());

const ASSIN_OK = {
  empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11.222.333/0001-81', representante: 'Carlos Pereira', cargo: 'Sócio' },
  cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '529.982.247-25' },
};

// ─── POST /documents/generate ────────────────────────────────────────
describe('POST /documents/generate', () => {
  it('gera documento com sucesso', async () => {
    // Ordem real das 7 chamadas .single() no controller:
    //  1. company  2. users(free-check)  3. client  4. checkLimit(users)
    //  5. incrementUsed(users)  6. users(isVip-check)  7. insert
    mockSingle
      .mockResolvedValueOnce({ data: { nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } })
      .mockResolvedValueOnce({ data: { documentos_usados: 5 } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'contratoSolar', cliente_id: CLIENT_UUID, fields: { versao_garantia: 1 }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
    expect(res.body).toHaveProperty('doc_id');
    // Texto de garantia de 11/2026: a marca é só do servidor e sobrescreve a do formulário.
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.versao_garantia).toBe(2);
  });

  it('contratoSolar pelo caminho da IA (useTemplate false) não leva a marca versao_garantia', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } })
      .mockResolvedValueOnce({ data: { documentos_usados: 5 } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'contratoSolar', cliente_id: CLIENT_UUID, fields: {}, useTemplate: false });

    expect(res.status).toBe(200);
    expect(vi.mocked(generateFromTemplate)).not.toHaveBeenCalled();
    const insert = mockInsert.mock.calls[mockInsert.mock.calls.length - 1]?.[0] as { dados_json?: Record<string, unknown> } | undefined;
    expect(insert?.dados_json?.versao_garantia).toBeUndefined();
  });

  it('retorna 400 sem cliente_id ou terceiro_id', async () => {
    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'contratoSolar', fields: {} });

    expect(res.status).toBe(400);
  });

  it('retorna 403 quando limite atingido', async () => {
    // company → users(free-check) → client → checkLimit(users, no limite)
    mockSingle
      .mockResolvedValueOnce({ data: { nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 90, limite_documentos: 90 } });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'contratoSolar', cliente_id: CLIENT_UUID, fields: {}, useTemplate: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LIMIT_REACHED');
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post('/documents/generate')
      .send({ tipo: 'contratoSolar', cliente_id: CLIENT_UUID, fields: {} });

    expect(res.status).toBe(401);
  });

  // Proposta solar: company → users(free-check) → client → checkLimit(users) →
  // company(slug) → [rpc reservar_codigo_curto] → incrementUsed → users(isVip) → insert.
  function mockGeracaoProposta() {
    mockSingle
      .mockResolvedValueOnce({ data: { id: 'comp-1', nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } })
      .mockResolvedValueOnce({ data: { id: 'comp-1', nome: 'Empresa', slug: 'empresa' } })
      .mockResolvedValueOnce({ data: { documentos_usados: 5 } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });
  }

  // Até 14/09/2026 o número impresso era 2026 + 0001 + NNNN pra TODO integrador
  // (users.numero_seq nunca existiu): 202600010001 estava em 94 propostas de 90
  // empresas. O número impresso agora é o do link, reservado no contador do banco.
  it('proposta solar imprime o mesmo número do link, reservado no contador', async () => {
    mockGeracaoProposta();
    mockRpc.mockResolvedValueOnce({ data: '20260036', error: null });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, fields: {}, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('reservar_codigo_curto', { p_user_id: 'user-123', p_ano: new Date().getFullYear() });
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.codigo).toBe('20260036');
    expect(res.body).toMatchObject({ codigo: '20260036', codigo_curto: '20260036', empresa_slug: 'empresa' });
  });

  // Modelo 4 (Completo): as galerias chegam ao template só com URL assinada pelo servidor,
  // e o dados_json guardado é essa versão. Path de outro usuário e URL do cliente não passam.
  it('modelo 4: galerias reassinadas pelo path antes do template; modelo_usado = modelo-4', async () => {
    mockGeracaoProposta();
    mockRpc.mockResolvedValueOnce({ data: '20260037', error: null });
    mockSignedUrls.mockImplementationOnce(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: 'https://x.test/nova/' + path, error: null })), error: null,
    }));
    const meu = 'portfolio/user-123/obra/1700000000000-abcdef12.jpg';
    const alheio = 'portfolio/user-999/obra/1700000000000-abcdef12.jpg';

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({
        tipo: 'propostaSolar', cliente_id: CLIENT_UUID, useTemplate: true, modeloNumero: 4,
        fields: { fotos_obras: [{ path: meu, url: 'http://interno/x' }, { path: alheio, url: 'https://a/b' }], assinatura: ASSIN_OK },
      });

    expect(res.status).toBe(200);
    const call = vi.mocked(generateFromTemplate).mock.calls[0];
    expect(call[4]).toBe(4);
    expect(call[3]).toMatchObject({ fotos_obras: [{ path: meu, url: 'https://x.test/nova/' + meu }] });
    expect(JSON.stringify(call[3])).not.toContain('interno');
    expect(JSON.stringify(call[3])).not.toContain('user-999');
    expect(res.body.modelo_usado).toBe('modelo-4');
  });

  // Completa + Banco: o aceite é obrigatório e a validação roda ANTES de gastar número e cota.
  it('modelo 4 sem assinatura: 400 com a mensagem, sem reservar número nem gerar', async () => {
    const res = await request(app)
      .post('/documents/generate').set('Authorization', AUTH)
      .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, fields: {}, useTemplate: true, modeloNumero: 4 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Para gerar a Completa + Banco, preencha as assinaturas do cliente e da empresa.');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(generateFromTemplate).not.toHaveBeenCalled();
  });

  it('modelo 4 com CPF inválido: 400 com a mensagem do CPF', async () => {
    const res = await request(app)
      .post('/documents/generate').set('Authorization', AUTH)
      .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, useTemplate: true, modeloNumero: 4,
        fields: { assinatura: { ...ASSIN_OK, cliente: { ...ASSIN_OK.cliente, documento: '111.111.111-11' } } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CPF do cliente inválido. Confira os números.');
    expect(generateFromTemplate).not.toHaveBeenCalled();
  });

  it('modelo 4: grava a assinatura limpa (documentos só com dígitos) e preserva bancos_logos []', async () => {
    mockGeracaoProposta();
    mockRpc.mockResolvedValueOnce({ data: '20260038', error: null });
    const res = await request(app)
      .post('/documents/generate').set('Authorization', AUTH)
      .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, useTemplate: true, modeloNumero: 4,
        fields: { assinatura: ASSIN_OK, bancos_logos: [] } });
    expect(res.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>;
    expect(fields.bancos_logos).toEqual([]);
    expect(fields.assinatura.cliente.documento).toBe('52998224725');
    expect(fields.assinatura.empresa.cnpj).toBe('11222333000181');
  });

  it('modelo 4: sem a chave fotos_obras valem as fotos da empresa; [] explícito não preenche', async () => {
    const meu = 'portfolio/user-123/obra/1700000000000-abcdef12.jpg';
    const empresaComFotos = { data: { id: 'comp-1', nome: 'Empresa', cnpj: '00.000.000/0001-00', fotos_obras: [{ path: meu, legenda: 'Casa' }] } };
    mockSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: 'https://x.test/nova/' + path, error: null })), error: null,
    }));
    const gerar = async (fields: Record<string, unknown>) => {
      mockGeracaoProposta();
      mockSingle.mockReset();
      mockSingle
        .mockResolvedValueOnce(empresaComFotos)
        .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
        .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
        .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } })
        .mockResolvedValueOnce({ data: { id: 'comp-1', nome: 'Empresa', slug: 'empresa' } })
        .mockResolvedValueOnce({ data: { documentos_usados: 5 } })
        .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
        .mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });
      mockRpc.mockResolvedValueOnce({ data: '20260039', error: null });
      vi.mocked(generateFromTemplate).mockClear();
      const r = await request(app).post('/documents/generate').set('Authorization', AUTH)
        .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, useTemplate: true, modeloNumero: 4, fields: { assinatura: ASSIN_OK, ...fields } });
      expect(r.status).toBe(200);
      return vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>;
    };
    const auto = await gerar({});
    expect(auto.fotos_obras).toEqual([{ path: meu, legenda: 'Casa', url: 'https://x.test/nova/' + meu }]);
    const tirou = await gerar({ fotos_obras: [] });
    expect(tirou.fotos_obras).toEqual([]);
  });

  // Reserva que falha NÃO recomeça do 0001 (foi o que um 504 fez em 12/09/2026), e o
  // número que veio do prefill (de outra proposta) não pode sair impresso.
  it('sem número reservado, a proposta sai sem número, nem o do prefill', async () => {
    mockGeracaoProposta();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'upstream timeout' } });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, fields: { codigo: '202600010002' }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.codigo).toBeUndefined();
    expect(res.body).toMatchObject({ codigo: null, codigo_curto: null });
  });

  // Link rastreado: a proposta solar nasce com validade do link (fim do último dia, em Brasília).
  it('proposta solar nasce com link rastreado e devolve link_expira_em', async () => {
    mockGeracaoProposta();
    mockRpc.mockResolvedValueOnce({ data: '20260037', error: null });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      // O prefill pode arrastar a validade de outra proposta: não vale.
      .send({ tipo: 'propostaSolar', cliente_id: CLIENT_UUID, fields: { validade_dias: '10', link_expira_em: '2020-01-01T23:59:59-03:00' }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    expect(res.body.link_expira_em).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59-03:00$/);
    expect(res.body.link_expira_em).toBe(linkExpiraEm({ validade_dias: '10' }, new Date().toISOString()));
    // Mesmo objeto que vai para o dados_json do insert.
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.link_rastreado).toBe(true);
    expect(fields.link_expira_em).toBe(res.body.link_expira_em);
  });

  it('outros tipos não ganham link rastreado', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } })
      .mockResolvedValueOnce({ data: { documentos_usados: 5 } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });

    const res = await request(app)
      .post('/documents/generate')
      .set('Authorization', AUTH)
      .send({ tipo: 'contratoSolar', cliente_id: CLIENT_UUID, fields: { link_rastreado: true, link_expira_em: 'x' }, useTemplate: true });

    expect(res.status).toBe(200);
    expect(res.body.link_expira_em).toBeNull();
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.link_rastreado).toBeUndefined();
    expect(fields.link_expira_em).toBeUndefined();
  });
});

// ─── POST /documents/:id/regenerate ──────────────────────────────────
// Botão "Editar esta proposta": corrige e reemite o MESMO doc.
describe('POST /documents/:id/regenerate', () => {
  const DOIS_DIAS_ATRAS  = new Date(Date.now() - 2 * 86400000).toISOString();
  const TRINTA_DIAS_ATRAS = new Date(Date.now() - 30 * 86400000).toISOString();
  const docAvulso = {
    id: DOC_UUID, tipo: 'propostaSolar', cliente_id: null, terceiro_id: null,
    cliente_nome: 'Adelides', arquivo_url: null, codigo_curto: '20260035',
    dados_json: { codigo: '202600010035', investimento: '20.000,00' },
    created_at: DOIS_DIAS_ATRAS,
  };
  const empresa = { data: { nome: 'Empresa', cnpj: '00.000.000/0001-00', slug: 'aiorosgroup' } };

  function post(id = DOC_UUID, body: Record<string, unknown> = {}) {
    return request(app)
      .post(`/documents/${id}/regenerate`)
      .set('Authorization', AUTH)
      .send({ fields: { investimento: '22.000,00' }, useTemplate: true, modeloNumero: 1, cliente_nome_avulso: 'Adelides', ...body });
  }

  it('mantem id, codigo e codigo_curto — o link ja enviado continua valendo', async () => {
    // Só 3 chamadas .single(): 1. documents  2. company  3. users(free-check).
    // Não existe 4ª: reeditar não passa por checkLimit/incrementUsed (não gasta cota).
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      doc_id: DOC_UUID, codigo: '202600010035', codigo_curto: '20260035',
      empresa_slug: 'aiorosgroup', cliente_nome: 'Adelides', modelo_usado: 'modelo-1',
    });
    expect(mockSingle).toHaveBeenCalledTimes(3);
  });

  it('proposta ainda no prazo: congela a data de emissao (nao renova sozinha)', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })              // emitida ha 2 dias, vale 7
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });

    await post();

    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.emitido_em).toBe(DOIS_DIAS_ATRAS);
  });

  it('modelo 4: reedição preserva bancos_logos [] e, sem assinatura, gera sem o aceite (sem 400)', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });
    const res = await post(DOC_UUID, { modeloNumero: 4, fields: { bancos_logos: [] } });
    expect(res.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.bancos_logos).toEqual([]);
    expect(fields.assinatura).toBeUndefined();
  });

  it('modelo 4: reedição com assinatura inválida recebe 400; válida passa limpa', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });
    const ruim = await post(DOC_UUID, { modeloNumero: 4, fields: { assinatura: { ...ASSIN_OK, empresa: { ...ASSIN_OK.empresa, representante: '' } } } });
    expect(ruim.status).toBe(400);
    expect(ruim.body.error).toBe('Escreva quem assina pela sua empresa.');
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'ilimitado', is_admin: false } });
    const ok = await post(DOC_UUID, { modeloNumero: 4, fields: { assinatura: ASSIN_OK } });
    expect(ok.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>;
    expect(fields.assinatura.cliente.documento).toBe('52998224725');
  });

  // Plano com limite não troca o cliente: com assinatura salva, o cliente do aceite é o salvo.
  const OUTRO_CLIENTE = { tipo: 'PF', nome: 'Outra Pessoa Silva', documento: '111.444.777-35' };
  const docComAssinatura = { ...docAvulso, dados_json: { ...docAvulso.dados_json, assinatura: ASSIN_OK } };

  it('modelo 4, plano com limite: o cliente salvo no aceite vence o que veio; a empresa nova vale', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docComAssinatura })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });
    const res = await post(DOC_UUID, { modeloNumero: 4, fields: { assinatura: { ...ASSIN_OK, cliente: OUTRO_CLIENTE, empresa: { ...ASSIN_OK.empresa, representante: 'Novo Rep' }, local: 'Araguari' } } });
    expect(res.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>;
    expect(fields.assinatura.cliente).toEqual({ tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' });
    expect(fields.assinatura.empresa.representante).toBe('Novo Rep');
    expect(fields.assinatura.local).toBe('Araguari');
  });

  it('modelo 4, plano ilimitado troca o cliente do aceite; proposta antiga sem assinatura aceita a nova', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docComAssinatura })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'ilimitado', is_admin: false } });
    const livre = await post(DOC_UUID, { modeloNumero: 4, fields: { assinatura: { ...ASSIN_OK, cliente: OUTRO_CLIENTE } } });
    expect(livre.status).toBe(200);
    expect((vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>).assinatura.cliente.documento).toBe('11144477735');

    vi.mocked(generateFromTemplate).mockClear();
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'ilimitado', is_admin: false } });
    const nova = await post(DOC_UUID, { modeloNumero: 4, fields: { assinatura: { ...ASSIN_OK, cliente: OUTRO_CLIENTE } } });
    expect(nova.status).toBe(200);
    expect((vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>).assinatura.cliente.nome).toBe('Outra Pessoa Silva');
  });

  // Proposta emitida em outro modelo (sem assinatura salva) regerada como modelo 4, em plano com limite:
  // o nome na assinatura tem que ser o cliente da proposta.
  it('modelo 4 sem assinatura salva, plano com limite: outro nome na assinatura recebe 400; o mesmo nome passa', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });
    const outro = await post(DOC_UUID, { modeloNumero: 4, fields: { assinatura: { ...ASSIN_OK, cliente: OUTRO_CLIENTE } } });
    expect(outro.status).toBe(400);
    expect(outro.body.error).toBe('No seu plano, o nome na assinatura tem que ser o mesmo cliente desta proposta.');
    expect(generateFromTemplate).not.toHaveBeenCalled();

    const docMaria = { ...docAvulso, cliente_nome: 'Maria Aparecida Souza' };
    mockSingle
      .mockResolvedValueOnce({ data: docMaria })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });
    const igual = await post(DOC_UUID, { modeloNumero: 4, cliente_nome_avulso: 'Maria Aparecida Souza', fields: { assinatura: ASSIN_OK } });
    expect(igual.status).toBe(200);
    expect((vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>).assinatura.cliente.nome).toBe('Maria Aparecida Souza');
  });

  it('modelo 4: assinatura nova nula, ausente ou vazia mantém a salva (render e dados_json gravado), em qualquer plano', async () => {
    const salvaLimpa = { ...ASSIN_OK, empresa: { ...ASSIN_OK.empresa, cnpj: '11222333000181' }, cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' } };
    for (const [plano, campos] of [['free', { assinatura: null }], ['ilimitado', {}], ['free', { assinatura: {} }]] as const) {
      vi.mocked(generateFromTemplate).mockClear();
      mockSingle
        .mockResolvedValueOnce({ data: docComAssinatura })
        .mockResolvedValueOnce(empresa)
        .mockResolvedValueOnce({ data: { plano, is_admin: false } });
      const res = await post(DOC_UUID, { modeloNumero: 4, fields: { ...campos } });
      expect(res.status).toBe(200);
      const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, any>;
      expect(fields.assinatura).toEqual(salvaLimpa);
    }
  });

  it('proposta ja vencida: reeditar vale como reemissao (data volta a contar de hoje)', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { ...docAvulso, created_at: TRINTA_DIAS_ATRAS } })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });

    // O front devolve o dados_json inteiro: mesmo mandando o emitido_em antigo,
    // a proposta vencida não pode sair congelada na data velha.
    await post(DOC_UUID, { fields: { investimento: '22.000,00', emitido_em: TRINTA_DIAS_ATRAS } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.emitido_em).toBeUndefined();
  });

  it('link rastreado: recalcula a validade a partir do emitido_em preservado', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })              // emitida ha 2 dias, vale 7
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });

    // O que o front devolveu do dados_json antigo não vale.
    const res = await post(DOC_UUID, { fields: { investimento: '22.000,00', link_expira_em: '2020-01-01T23:59:59-03:00' } });

    const esperado = linkExpiraEm({ emitido_em: DOIS_DIAS_ATRAS });
    expect(res.body.link_expira_em).toBe(esperado);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.link_rastreado).toBe(true);
    expect(fields.link_expira_em).toBe(esperado);
  });

  it('link rastreado: proposta vencida reemitida conta de hoje', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { ...docAvulso, created_at: TRINTA_DIAS_ATRAS } })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });

    const res = await post();

    expect(res.body.link_expira_em).toBe(linkExpiraEm({}, new Date().toISOString()));
    expect(new Date(res.body.link_expira_em).getTime()).toBeGreaterThan(Date.now());
  });

  it('troca o HTML no Storage: sobe o novo e apaga o antigo', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { ...docAvulso, arquivo_url: 'user-123/antigo.html' } })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'ilimitado', is_admin: true } });

    const res = await post();

    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith(['user-123/antigo.html']);
  });

  // O formulário carrega o número de OUTRA proposta (prefill por cliente, doc aberto
  // do histórico, rascunho). Reeditar imprime o número salvo deste doc, não o do form.
  it('reeditar imprime o número salvo, não o que veio no formulário', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: docAvulso })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'free', is_admin: false } });

    await post(DOC_UUID, { fields: { investimento: '22.000,00', codigo: '20260010' } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.codigo).toBe('202600010035');
  });

  // Texto de garantia de 11/2026: a marca é só do servidor. A reedição mantém a que estava
  // salva (ou a falta dela), nunca a que o formulário devolve.
  it('contratoSolar antigo, sem a marca: a reedição continua sem ela', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { ...docAvulso, tipo: 'contratoSolar', dados_json: { valor_total: '1' } } })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } });

    await post(DOC_UUID, { fields: { valor_total: '2', versao_garantia: 2 }, modeloNumero: 2 });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect('versao_garantia' in fields).toBe(false);
  });

  it('contratoSolar novo: a reedição mantém a versão salva, mesmo se o formulário mandar outra', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { ...docAvulso, tipo: 'contratoSolar', dados_json: { valor_total: '1', versao_garantia: 2 } } })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } });

    await post(DOC_UUID, { fields: { valor_total: '2', versao_garantia: 1 }, modeloNumero: 2 });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields.versao_garantia).toBe(2);
  });

  it('retorna 404 pra doc de outro usuario', async () => {
    mockSingle.mockResolvedValueOnce({ data: null });
    const res = await post();
    expect(res.status).toBe(404);
  });

  // Até 28/10/2026 o regenerate recusava esse tipo porque o generate injeta o cliente
  // final nos campos e reemitir sem repetir isso sairia com o contrato pela metade.
  // A injeção virou uma função comum aos dois caminhos.
  it('prestacaoServico reedita e injeta o cliente final, como na emissao', async () => {
    const T_UUID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
    mockSingle
      .mockResolvedValueOnce({ data: { ...docAvulso, tipo: 'prestacaoServico', terceiro_id: T_UUID, cliente_id: CLIENT_UUID, cliente_nome: 'Montadora Sol' } })
      .mockResolvedValueOnce(empresa)
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } })
      .mockResolvedValueOnce({ data: { id: T_UUID, nome: 'Montadora Sol' } })                 // terceiro (a entidade)
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Dona Maria', endereco: 'Rua A, 10', tipo_telhado: 'Cerâmico', padrao: 'Monofásico' } }); // cliente final

    const res = await post(DOC_UUID, { fields: { valor_servico: '3.000,00', telefone_cliente: '8399999' }, cliente_nome_avulso: undefined });

    expect(res.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0][3] as Record<string, unknown>;
    expect(fields).toMatchObject({
      valor_servico: '3.000,00',
      cliente_final_nome: 'Dona Maria',
      cliente_final_telefone: '8399999',
      cliente_final_endereco_instalacao: 'Rua A, 10',
      cliente_final_padrao: 'Monofásico',
    });
    // Não é proposta: nada de número nem de data de emissão dentro do dados_json de contrato.
    expect(fields.codigo).toBeUndefined();
    expect(fields.emitido_em).toBeUndefined();
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post(`/documents/${DOC_UUID}/regenerate`)
      .send({ fields: {} });
    expect(res.status).toBe(401);
  });
});

// ─── GET /documents/:id/edit ─────────────────────────────────────────
describe('GET /documents/:id/edit', () => {
  it('devolve o doc no formato que o formulario reabre', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: {
        id: DOC_UUID, tipo: 'propostaSolar', cliente_nome: 'Adelides',
        dados_json: { codigo: '202600010035', investimento: '20.000,00' },
        modelo_usado: 'modelo-2', content: '<html>proposta</html>',
        codigo_curto: '20260035', created_at: '2026-07-30T03:41:43.000Z',
      } })
      .mockResolvedValueOnce({ data: { slug: 'aiorosgroup' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', is_admin: false } });

    const res = await request(app).get(`/documents/${DOC_UUID}/edit`).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.document).toMatchObject({
      doc_id: DOC_UUID, cliente_nome: 'Adelides', modelo_numero: 2,
      codigo: '202600010035', codigo_curto: '20260035', empresa_slug: 'aiorosgroup',
      cliente_id: null, terceiro_id: null, pode_trocar_cliente: false,
    });
    expect(res.body.document.dados_json.investimento).toBe('20.000,00');
  });

  it('retorna 404 pra doc de outro usuario', async () => {
    mockSingle.mockResolvedValueOnce({ data: null });
    const res = await request(app).get(`/documents/${DOC_UUID}/edit`).set('Authorization', AUTH);
    expect(res.status).toBe(404);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get(`/documents/${DOC_UUID}/edit`);
    expect(res.status).toBe(401);
  });
});

// ─── GET /documents/list ─────────────────────────────────────────────
// A lista de verdade (sem bloqueio por plano, paginada, com filtros) tem o teste dela
// em documentosNuvem.route.test.ts, com o banco falso. Aqui fica só o portão.
describe('GET /documents/list', () => {
  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/documents/list');
    expect(res.status).toBe(401);
  });
});

// ─── GET /documents/proposta-prefill ─────────────────────────────────
describe('GET /documents/proposta-prefill', () => {
  // Uma cadeia de consulta que termina em limit() com o resultado dado.
  function cadeia(resultado: unknown) {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.limit = vi.fn().mockResolvedValue(resultado);
    return q;
  }
  async function mockFontes(propostas: unknown[], cadastro: unknown[]) {
    const { supabase } = await import('../utils/supabase');
    vi.mocked(supabase.from)
      .mockImplementationOnce(() => cadeia({ data: propostas, error: null }) as never)
      .mockImplementationOnce(() => cadeia({ data: cadastro, error: null }) as never);
  }

  // Até 14/09/2026 só as propostas emitidas entravam: cliente cadastrado sem proposta
  // nem aparecia no seletor, e escolher o nome não carregava nada (92 de 174 clientes
  // cadastrados em 30 dias).
  it('cliente só do cadastro aparece na lista e carrega cidade, UF, endereço e telhado, sem ligar pra acento', async () => {
    await mockFontes([], [{
      nome: 'PAROQUIA DE SÃO JOSÉ', cidade: 'CAMPINA GRANDE/PB', uf: 'PB',
      endereco: 'RUA CAMPOS SALES, 615', tipo_telhado: 'fibrocimento',
    }]);

    const res = await request(app)
      .get('/documents/proposta-prefill')
      .query({ cliente_nome: 'paroquia de sao jose' })
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.clientes).toContain('PAROQUIA DE SÃO JOSÉ');
    expect(res.body.cliente).toEqual({
      cidade: 'CAMPINA GRANDE', uf: 'PB', endereco: 'RUA CAMPOS SALES, 615', tipo_telhado: 'Fibrocimento',
    });
  });

  it('telhado que a proposta não tem fica de fora', async () => {
    await mockFontes([], [{ nome: 'Jeziel', cidade: 'Campina Grande', uf: 'PB', endereco: null, tipo_telhado: 'Fibromadeira' }]);

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Jeziel' }).set('Authorization', AUTH);

    expect(res.body.cliente).toEqual({ cidade: 'Campina Grande', uf: 'PB' });
  });

  it('cliente com proposta continua trazendo tudo da última proposta, sem o número dela', async () => {
    await mockFontes(
      [{ cliente_nome: 'João da Silva', created_at: '2026-09-10T12:00:00Z', dados_json: { consumo_kwh: '500', cidade: 'Uberlândia', uf: 'MG', codigo: '20260010' } }],
      [{ nome: 'JOAO DA SILVA', cidade: 'Outra', uf: 'SP', endereco: null, tipo_telhado: null }],
    );

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'joão da silva' }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.clientes).toEqual(['João da Silva']);
    expect(res.body.cliente).toMatchObject({ consumo_kwh: '500', cidade: 'Uberlândia', uf: 'MG' });
    expect(res.body.cliente.codigo).toBeUndefined();
  });

  // Endereço completo da proposta (28/10/2026): as partes são do cliente, não do kit
  // do vendedor. Se vazassem para o kit, a próxima proposta de OUTRO cliente nasceria
  // com a rua do anterior.
  it('o kit não traz o endereço do cliente, nem CEP, rua, número, complemento e bairro', async () => {
    await mockFontes(
      [{ cliente_nome: 'Ana', created_at: '2026-10-10T12:00:00Z', dados_json: {
        marca_modulo: 'Canadian', endereco: 'Rua A, 10, Centro', cep: '38400-000', logradouro: 'Rua A',
        numero: '10', complemento: 'Casa 2', bairro: 'Centro',
      } }],
      [],
    );

    const res = await request(app).get('/documents/proposta-prefill').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.kit.marca_modulo).toBe('Canadian');
    for (const k of ['endereco', 'cep', 'logradouro', 'numero', 'complemento', 'bairro']) {
      expect(res.body.kit[k]).toBeUndefined();
    }
  });

  it('cliente com proposta volta com as partes do endereço', async () => {
    await mockFontes(
      [{ cliente_nome: 'Ana', created_at: '2026-10-10T12:00:00Z', dados_json: { logradouro: 'Rua A', numero: '10', cep: '38400-000' } }],
      [],
    );

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Ana' }).set('Authorization', AUTH);

    expect(res.body.cliente).toMatchObject({ logradouro: 'Rua A', numero: '10', cep: '38400-000' });
  });

  it('cliente só do cadastro traz o CEP junto com o endereço', async () => {
    await mockFontes([], [{ nome: 'Bia', cidade: 'Uberlândia', uf: 'MG', endereco: 'Rua B, 20', cep: '38400-100', tipo_telhado: null }]);

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Bia' }).set('Authorization', AUTH);

    expect(res.body.cliente).toEqual({ cidade: 'Uberlândia', uf: 'MG', endereco: 'Rua B, 20', cep: '38400-100' });
  });

  // Endereço em partes (04/11/2026): a leitura da conta de luz grava rua, número,
  // complemento e bairro no cadastro (colunas da MIGRATION_clients_endereco_partes.sql).
  // A proposta recebe cada parte no seu campo e SEM a linha única: com ela o formulário a
  // trata como texto antigo e joga tudo no campo Rua.
  it('cadastro com as partes do endereço entrega cada parte, sem a linha única', async () => {
    await mockFontes([], [{
      nome: 'Carla', cidade: 'Uberlândia', uf: 'MG', cep: '38400-100', tipo_telhado: null,
      endereco: 'Rua das Flores, 123, Apto 4, Centro',
      logradouro: 'Rua das Flores', numero: '123', complemento: 'Apto 4', bairro: 'Centro',
    }]);

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Carla' }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.cliente).toEqual({
      cidade: 'Uberlândia', uf: 'MG', cep: '38400-100',
      logradouro: 'Rua das Flores', numero: '123', complemento: 'Apto 4', bairro: 'Centro',
    });
    expect(res.body.cliente.endereco).toBeUndefined();
  });

  it('partes vazias não viram campo; só o que veio preenchido segue', async () => {
    await mockFontes([], [{
      nome: 'Dani', cidade: 'Uberlândia', uf: 'MG', tipo_telhado: null,
      endereco: 'Rua C, 5', logradouro: 'Rua C', numero: '5', complemento: '  ', bairro: null,
    }]);

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Dani' }).set('Authorization', AUTH);

    expect(res.body.cliente).toEqual({ cidade: 'Uberlândia', uf: 'MG', logradouro: 'Rua C', numero: '5' });
  });

  // Completa + Banco: o tipo (PF/PJ) e o CPF/CNPJ do cadastro entram em data.cliente para a assinatura.
  it('cliente do cadastro traz tipo e cpf_cnpj (só dígitos) em data.cliente', async () => {
    await mockFontes([], [{ nome: 'Fátima', cidade: 'Uberlândia', uf: 'MG', tipo_telhado: null, tipo: 'pf', cpf_cnpj: '529.982.247-25' }]);
    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Fátima' }).set('Authorization', AUTH);
    expect(res.body.cliente).toMatchObject({ tipo: 'PF', cpf_cnpj: '52998224725' });
  });

  it('cliente com proposta anterior também recebe tipo e cpf_cnpj do cadastro; a assinatura antiga não vai para outro cliente (kit)', async () => {
    await mockFontes(
      [{ cliente_nome: 'Gil', created_at: '2026-10-10T12:00:00Z', dados_json: { bancos_logos: [], assinatura: { cliente: { nome: 'Gil Souza' } } } }],
      [{ nome: 'Gil', cidade: 'Uberlândia', uf: 'MG', tipo_telhado: null, tipo: 'PJ', cpf_cnpj: '11.222.333/0001-81' }],
    );
    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Gil' }).set('Authorization', AUTH);
    expect(res.body.cliente).toMatchObject({ tipo: 'PJ', cpf_cnpj: '11222333000181', bancos_logos: [] });
    expect(res.body.kit.bancos_logos).toEqual([]);
    expect(res.body.kit.assinatura).toBeUndefined();
  });

  it('o CPF da Ana não vaza: kit e prefill da Bia (sem cadastro) não trazem documento nem assinatura', async () => {
    const ana = {
      cliente_nome: 'Ana', created_at: '2026-10-10T12:00:00Z',
      dados_json: { cpf_cnpj: '52998224725', tipo: 'PF', bancos_logos: [], assinatura: { cliente: { tipo: 'PF', nome: 'Ana Souza', documento: '52998224725' } } },
    };
    await mockFontes([ana], []);
    const bia = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Bia' }).set('Authorization', AUTH);
    expect(bia.body.cliente).toBeNull();
    expect(JSON.stringify(bia.body.kit)).not.toContain('52998224725');
    expect(bia.body.kit).not.toHaveProperty('cpf_cnpj');
    expect(bia.body.kit).not.toHaveProperty('tipo');
    expect(bia.body.kit).not.toHaveProperty('assinatura');
    expect(bia.body.kit.bancos_logos).toEqual([]);

    // Bia no cadastro, sem documento: continua sem o da Ana.
    await mockFontes([ana], [{ nome: 'Bia', cidade: 'Uberlândia', uf: 'MG', tipo_telhado: null }]);
    const bia2 = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Bia' }).set('Authorization', AUTH);
    expect(bia2.body.cliente).not.toHaveProperty('cpf_cnpj');
    expect(bia2.body.cliente).not.toHaveProperty('assinatura');

    // A própria Ana: só a assinatura dela volta; cpf_cnpj e tipo soltos do dados_json não valem.
    await mockFontes([ana], []);
    const a = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Ana' }).set('Authorization', AUTH);
    expect(a.body.cliente.assinatura.cliente.documento).toBe('52998224725');
    expect(a.body.cliente).not.toHaveProperty('cpf_cnpj');
    expect(a.body.cliente).not.toHaveProperty('tipo');
  });

  it('coluna das partes inexistente (migration não rodou): repete sem elas e devolve como antes', async () => {
    const { supabase } = await import('../utils/supabase');
    const primeira = cadeia({ data: null, error: { code: '42703', message: 'column clients.logradouro does not exist' } });
    const segunda = cadeia({ data: [{ nome: 'Eva', cidade: 'Uberlândia', uf: 'MG', endereco: 'Rua D, 7', cep: '38400-200', tipo_telhado: null }], error: null });
    vi.mocked(supabase.from)
      .mockImplementationOnce(() => cadeia({ data: [], error: null }) as never)
      .mockImplementationOnce(() => primeira as never)
      .mockImplementationOnce(() => segunda as never);

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Eva' }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(primeira.select).toHaveBeenCalledWith(expect.stringContaining('logradouro'));
    expect(segunda.select).toHaveBeenCalledWith('nome, cidade, uf, endereco, cep, tipo_telhado, tipo, cpf_cnpj, created_at');
    expect(res.body.cliente).toEqual({ cidade: 'Uberlândia', uf: 'MG', endereco: 'Rua D, 7', cep: '38400-200' });
  });

  it('erro do cadastro que não é de coluna não repete e segue só com o histórico', async () => {
    const { supabase } = await import('../utils/supabase');
    const falha = cadeia({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    vi.mocked(supabase.from)
      .mockImplementationOnce(() => cadeia({ data: [], error: null }) as never)
      .mockImplementationOnce(() => falha as never);

    const res = await request(app).get('/documents/proposta-prefill').query({ cliente_nome: 'Eva' }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(vi.mocked(supabase.from)).toHaveBeenCalledTimes(2);
    expect(res.body.cliente).toBeNull();
  });
});
