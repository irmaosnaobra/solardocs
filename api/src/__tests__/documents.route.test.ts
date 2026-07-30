import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const CLIENT_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const DOC_UUID    = 'b1ffc99a-9c0b-4ef8-bb6d-6bb9bd380a22';
const mockSingle  = vi.fn();
// Spies compartilhados do Storage: o regenerate PRECISA trocar o arquivo, porque
// /p/:id e o PDF leem o arquivo_url antes do content.
const mockUpload  = vi.fn().mockResolvedValue({ error: null });
const mockRemove  = vi.fn().mockResolvedValue({ error: null });

// ─── mocks antes do import de app ───────────────────────────────────
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: mockSingle,
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
      lt:     vi.fn().mockReturnThis(),
      in:     vi.fn().mockResolvedValue({ data: [], error: null }),
      not:    vi.fn().mockReturnThis(),
      lte:    vi.fn().mockReturnThis(),
    })),
    storage: { from: vi.fn(() => ({ upload: mockUpload, remove: mockRemove })) },
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
}));

import app from '../app';

const AUTH = 'Bearer valid-token';

beforeEach(() => vi.clearAllMocks());

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
      .send({ tipo: 'contratoSolar', cliente_id: CLIENT_UUID, fields: {}, useTemplate: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
    expect(res.body).toHaveProperty('doc_id');
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
});

// ─── POST /documents/:id/regenerate ──────────────────────────────────
// Botão "Editar esta proposta": corrige e reemite o MESMO doc.
describe('POST /documents/:id/regenerate', () => {
  const docAvulso = {
    id: DOC_UUID, tipo: 'propostaSolar', cliente_id: null, terceiro_id: null,
    cliente_nome: 'Adelides', arquivo_url: null, codigo_curto: '20260035',
    dados_json: { codigo: '202600010035', investimento: '20.000,00' },
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

  it('retorna 404 pra doc de outro usuario', async () => {
    mockSingle.mockResolvedValueOnce({ data: null });
    const res = await post();
    expect(res.status).toBe(404);
  });

  it('recusa prestacaoServico (a geracao injeta o cliente final)', async () => {
    mockSingle.mockResolvedValueOnce({ data: { ...docAvulso, tipo: 'prestacaoServico' } });
    const res = await post();
    expect(res.status).toBe(400);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post(`/documents/${DOC_UUID}/regenerate`)
      .send({ fields: {} });
    expect(res.status).toBe(401);
  });
});

// ─── GET /documents/list ─────────────────────────────────────────────
describe('GET /documents/list', () => {
  it('retorna historico: false para plano free', async () => {
    // Controller retorna cedo quando plano = free (sem consultar documentos)
    mockSingle.mockResolvedValueOnce({ data: { plano: 'free' } });

    const res = await request(app)
      .get('/documents/list')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ documents: [], historico: false });
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/documents/list');
    expect(res.status).toBe(401);
  });
});
