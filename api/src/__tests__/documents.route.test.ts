import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const CLIENT_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const mockSingle  = vi.fn();

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
    storage: { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn() })) },
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
    // Ordem: company → client → checkLimit → incrementUsed.select → insert.single
    mockSingle
      .mockResolvedValueOnce({ data: { nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
      .mockResolvedValueOnce({ data: { id: CLIENT_UUID, nome: 'Cliente' } })
      .mockResolvedValueOnce({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } })
      .mockResolvedValueOnce({ data: { documentos_usados: 5 } })
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
    mockSingle
      .mockResolvedValueOnce({ data: { nome: 'Empresa', cnpj: '00.000.000/0001-00' } })
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
