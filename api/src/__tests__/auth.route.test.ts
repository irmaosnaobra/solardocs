import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── mocks antes do import de app ───────────────────────────────────
const mockInsert  = vi.fn();
const mockSingle  = vi.fn();

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), single: mockSingle }),
      single: mockSingle,
    })),
  },
}));
// Stripe mockado com fns compartilhados pra os testes configurarem o retorno
// (detectPlanFromSession usa checkout.sessions.retrieve + subscriptions.retrieve).
// vi.mock é içado pro topo do arquivo → as vars do factory PRECISAM começar com
// "mock" (única exceção que o vitest permite usar antes da inicialização).
const { mockSessionRetrieve, mockSubRetrieve, mockSubList, mockCustomerList } = vi.hoisted(() => ({
  mockSessionRetrieve: vi.fn(),
  mockSubRetrieve:     vi.fn(),
  mockSubList:         vi.fn(),
  mockCustomerList:    vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class {
    customers = { list: mockCustomerList };
    subscriptions = { list: mockSubList, retrieve: mockSubRetrieve };
    checkout = { sessions: { retrieve: mockSessionRetrieve } };
  },
}));
// Price VIP (fallback hardcoded do authController quando env não está setado).
const PRICE_VIP = 'price_1TUh2yCkkgzQ4IHeZqy52Zu2';
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/mailer', () => ({
  sendPasswordResetEmail:       vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail:             vi.fn().mockResolvedValue(undefined),
  sendPurchaseEmail:            vi.fn().mockResolvedValue(undefined),
  sendCheckoutCompletionEmail:  vi.fn().mockResolvedValue(undefined),
}));

// CNPJ válido (dígitos verificadores corretos) + WhatsApp — exigidos no fluxo
// free orgânico. O cadastro pós-pago (fromCheckout/session) NÃO exige esses.
const CNPJ_VALIDO = '11222333000181';
const WHATSAPP_OK = '34999999999';
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  sendWelcomeWhatsApp:    vi.fn().mockResolvedValue(undefined),
  sendPurchaseWhatsApp:   vi.fn().mockResolvedValue(undefined),
  handleIncomingWhatsApp: vi.fn().mockResolvedValue(undefined),
  processMessageQueue:    vi.fn().mockResolvedValue({ processed: 0 }),
}));

import app from '../app';

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks zera as implementações — re-arma os defaults "vazios" do Stripe
  // (sem sub / sem customer) que os testes que NÃO sobrescrevem dependem.
  mockSubList.mockResolvedValue({ data: [] });
  mockCustomerList.mockResolvedValue({ data: [] });
});

// ─── POST /auth/register ─────────────────────────────────────────────
describe('POST /auth/register', () => {
  // Fluxo FREE orgânico: exige CNPJ + WhatsApp válidos (gate de conta "ativa").
  it('cria usuário free e retorna token (com CNPJ + WhatsApp)', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: null })          // email não existe
      .mockResolvedValueOnce({ data: { id: 'uid-1', email: 'a@a.com', plano: 'free', limite_documentos: 10, documentos_usados: 0, created_at: new Date().toISOString() }, error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@a.com', password: 'senha123', nome: 'Fulano', whatsapp: WHATSAPP_OK, cnpj: CNPJ_VALIDO });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ email: 'a@a.com', plano: 'free' });
  });

  // Fluxo free orgânico SEM CNPJ → barrado pelo schema (gate de onboarding).
  it('retorna 400 no free sem CNPJ/WhatsApp', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'semcnpj@a.com', password: 'senha123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cnpj|whatsapp/i);
  });

  // Cadastro PÓS-PAGO (fromCheckout): só email + senha. Sem CNPJ/WhatsApp.
  // Stripe (mockado) não acha sub → plano não detectado → 402 PAGAMENTO_NAO_DETECTADO
  // (NÃO cria free silenciosa). Cobre o guard do fluxo pago.
  it('pós-pago sem plano detectável retorna 402 (não cria free sem CNPJ)', async () => {
    mockSingle.mockResolvedValueOnce({ data: null }); // email não existe

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'pagou@a.com', password: 'senha123', fromCheckout: true });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('PAGAMENTO_NAO_DETECTADO');
  });

  // Happy-path pós-pago: session com plano VIP detectável → cria conta no plano
  // pago, SEM exigir CNPJ. É o comportamento central que esta tarefa entregou.
  it('cria conta pós-pago (session VIP) sem CNPJ → 201 no plano pago', async () => {
    mockSessionRetrieve.mockResolvedValueOnce({
      metadata: { source: 'public_checkout' },
      subscription: 'sub_123',
      customer_email: 'vip@a.com',
    });
    mockSubRetrieve.mockResolvedValueOnce({ items: { data: [{ price: { id: PRICE_VIP } }] } });

    mockSingle
      .mockResolvedValueOnce({ data: null }) // email não existe
      .mockResolvedValueOnce({ data: { id: 'uid-vip', email: 'vip@a.com', plano: 'ilimitado', limite_documentos: 999999, documentos_usados: 0, created_at: new Date().toISOString() }, error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'vip@a.com', password: 'senha123', session: 'cs_test_123', fromCheckout: true });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ email: 'vip@a.com', plano: 'ilimitado' });
  });

  it('retorna 409 quando email já existe (free orgânico)', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'uid-existing' } });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'existente@a.com', password: 'senha123', nome: 'Fulano', whatsapp: WHATSAPP_OK, cnpj: CNPJ_VALIDO });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/já cadastrado/i);
  });

  it('retorna 400 para email inválido', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'nao-e-email', password: 'senha123' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 para senha curta', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@a.com', password: '123' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /auth/login ────────────────────────────────────────────────
describe('POST /auth/login', () => {
  it('retorna 401 para email não cadastrado', async () => {
    mockSingle.mockResolvedValueOnce({ data: null });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'desconhecido@a.com', password: 'qualquer' });

    expect(res.status).toBe(401);
  });

  it('retorna 400 para body vazio', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});
