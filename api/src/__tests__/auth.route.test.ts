import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── mocks antes do import de app ───────────────────────────────────
const mockInsert  = vi.fn();
const mockSingle  = vi.fn();
const mockLimit   = vi.fn();

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      // O register consulta kit_pedidos (comprador do kit é pós-pago e não
      // precisa de CNPJ). Sem compra, devolve lista vazia — o fluxo free
      // orgânico segue exigindo CNPJ, que é o que estes testes cobrem.
      order:  vi.fn().mockReturnThis(),
      limit:  mockLimit,
      // mockInsert grava o que o register insere em users (teste de atribuição).
      insert: (...args: unknown[]) => { mockInsert(...args); return { select: vi.fn().mockReturnThis(), single: mockSingle }; },
      // update().eq() precisa resolver numa Promise (o register chama .then()
      // pra registrar whatsapp_welcome_sent_at). eq isolado pra não afetar o
      // eq de topo usado pela cadeia SELECT.
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      single: mockSingle,
      // Login, recuperação e /auth/me leem com maybeSingle (erro de banco não pode
      // virar "não achei"). Mesma fila de respostas do single.
      maybeSingle: mockSingle,
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
import { sendMetaEvent } from '../utils/metaPixel';

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
    mockLimit.mockResolvedValue({ data: [], error: null });
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

  // Atribuição do navegador (10/11/2026): utm_*, fbc, fbp, fbclid, landing_url, referrer e a sessão da LP
  // vão do corpo para users. Trim, 500 caracteres no máximo, vazio fica de fora.
  it('grava a atribuição do corpo em users (trim, limite de 500, vazio fora)', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockSingle
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { id: 'uid-at', email: 'at@a.com', plano: 'free', limite_documentos: 10, documentos_usados: 0, created_at: new Date().toISOString() }, error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'at@a.com', password: 'senha123', nome: 'Ana Souza', whatsapp: WHATSAPP_OK, cnpj: CNPJ_VALIDO,
        utm_source: '  facebook ', utm_content: 'x'.repeat(600), utm_medium: '   ', utm_term: 42,
        fbc: 'fb.1.1.abc', fbp: 'fb.1.2.def', fbclid: 'abc', landing_url: 'https://solardoc.app/?utm_source=facebook',
        referrer: '', attribution_session_id: 'sess-1',
      });

    expect(res.status).toBe(201);
    const linha = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(linha).toMatchObject({
      email: 'at@a.com', utm_source: 'facebook', fbc: 'fb.1.1.abc', fbp: 'fb.1.2.def', fbclid: 'abc',
      landing_url: 'https://solardoc.app/?utm_source=facebook', attribution_session_id: 'sess-1',
    });
    expect((linha.utm_content as string).length).toBe(500);
    expect(linha).not.toHaveProperty('utm_medium');
    expect(linha).not.toHaveProperty('utm_term');
    expect(linha).not.toHaveProperty('referrer');
    expect(typeof linha.attribution_captured_at).toBe('string');
  });

  it('cadastra normalmente sem nenhum campo de atribuição (nenhuma coluna nova no insert)', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockSingle
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { id: 'uid-sa', email: 'sa@a.com', plano: 'free', limite_documentos: 10, documentos_usados: 0, created_at: new Date().toISOString() }, error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'sa@a.com', password: 'senha123', nome: 'Sem Atrib', whatsapp: WHATSAPP_OK, cnpj: CNPJ_VALIDO });

    expect(res.status).toBe(201);
    const linha = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    for (const k of ['utm_source', 'fbc', 'fbp', 'fbclid', 'landing_url', 'referrer', 'attribution_session_id', 'attribution_captured_at']) {
      expect(linha).not.toHaveProperty(k);
    }
  });

  it('coluna de atribuição ausente no banco: refaz o insert sem ela e o cadastro segue', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockSingle
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column fbc does not exist' } })
      .mockResolvedValueOnce({ data: { id: 'uid-rt', email: 'rt@a.com', plano: 'free', limite_documentos: 10, documentos_usados: 0, created_at: new Date().toISOString() }, error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'rt@a.com', password: 'senha123', nome: 'Retry Teste', whatsapp: WHATSAPP_OK, cnpj: CNPJ_VALIDO, fbc: 'fb.1.1.abc' });

    expect(res.status).toBe(201);
    // o insert em company (CNPJ) usa o mesmo mock: só conta as linhas de users
    const users = mockInsert.mock.calls.map(c => c[0] as Record<string, unknown>).filter(l => 'password_hash' in l);
    expect(users).toHaveLength(2);
    expect(users[0]).toHaveProperty('fbc');
    expect(users[1]).not.toHaveProperty('fbc');
  });

  // EMQ do CompleteRegistration (10/11/2026): o gêmeo do servidor leva telefone e nome, o external_id é o mesmo do Lead
  // (o email) e o event_id é o do navegador (RegisterForm), para o Meta juntar a mesma pessoa e deduplicar.
  it('CompleteRegistration sai com o mesmo event_id e o mesmo external_id do Lead, mais telefone, nome e país', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockSingle
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { id: 'uid-2', email: 'maria@a.com', plano: 'free', limite_documentos: 10, documentos_usados: 0, created_at: new Date().toISOString() }, error: null });

    const res = await request(app)
      .post('/auth/register')
      .set('X-Meta-Event-Id', 'evt-1234-abcd')
      .send({ email: 'Maria@a.com', password: 'senha123', nome: 'Maria José da Silva', whatsapp: WHATSAPP_OK, cnpj: CNPJ_VALIDO });
    expect(res.status).toBe(201);

    const chamadas = vi.mocked(sendMetaEvent).mock.calls;
    const lead = chamadas.find(c => c[0] === 'Lead')!;
    const cr = chamadas.find(c => c[0] === 'CompleteRegistration')!;
    expect(lead).toBeTruthy();
    expect(cr).toBeTruthy();
    expect(cr[1]).toMatchObject({
      eventId: 'evt-1234-abcd', email: 'maria@a.com', phone: WHATSAPP_OK,
      firstName: 'maria', lastName: 'silva', externalId: 'maria@a.com', country: 'br',
    });
    // O Lead não passa externalId: o metaPixel usa o email. O do CR é o próprio email: mesmo esquema, mesmo hash.
    expect(lead[1]).toMatchObject({ eventId: 'evt-1234-abcd', email: 'Maria@a.com' }); // o sha256 do metaPixel baixa a caixa: mesmo hash do CR
    expect(lead[1]!.externalId).toBeUndefined();
    expect(cr[1]!.eventId).toBe(lead[1]!.eventId);
  });

  // Fluxo free orgânico SEM CNPJ → barrado pelo schema (gate de onboarding).
  // Quem comprou o kit na Kiwify já pagou e a conta dele foi criada pelo webhook
  // sem senha. Exigir CNPJ aqui travaria justo o comprador — o backend confirma
  // o pedido pago pelo e-mail (nunca por um campo que o cliente manda).
  it('comprador do kit cadastra sem CNPJ (pedido pago confirmado no servidor)', async () => {
    mockLimit.mockResolvedValueOnce({ data: [{ id: 'pedido-1', status: 'paid' }], error: null });
    mockSingle
      .mockResolvedValueOnce({ data: null })                       // users: não existe ainda
      .mockResolvedValueOnce({ data: { id: 'uid-kit' } });         // insert -> select().single()

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'comprador@kit.com', password: 'senha123', origem: 'kit' });

    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(402);
  });

  // Pix/boleto: a Kiwify manda 'waiting_payment' e só depois 'paid'. Quem paga no
  // Pix clica em "criar senha" antes da confirmação — e o formulário da página de
  // obrigado nem tem campo de WhatsApp pra reclamar. Precisa de mensagem própria.
  it('Pix ainda confirmando → COMPRA_PENDENTE (não erro de WhatsApp)', async () => {
    mockLimit.mockResolvedValueOnce({ data: [{ id: 'p-1', status: 'waiting_payment' }], error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'pix@kit.com', password: 'senha123', origem: 'kit' });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('COMPRA_PENDENTE');
    expect(res.body.mensagem).toMatch(/pix/i);
  });

  // E-mail diferente do usado na Kiwify (ou webhook que não chegou).
  it('sem pedido nenhum vindo do kit → COMPRA_NAO_ENCONTRADA', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'outro@kit.com', password: 'senha123', origem: 'kit' });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('COMPRA_NAO_ENCONTRADA');
    expect(res.body.mensagem).toMatch(/mesmo e-mail/i);
  });

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

  // 14/09/2026: um 504 do gateway na leitura do usuário virava 401 "Credenciais
  // inválidas", e a pessoa com a senha certa ia trocar a senha à toa.
  it('banco fora do ar responde 503 com aviso de instabilidade, não 401', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'upstream timeout' }, status: 504 })
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'upstream timeout' }, status: 504 });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'cliente@a.com', password: 'senha-certa' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/instabilidade/i);
  });

  it('um soluço só do banco é absorvido pela retentativa', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'upstream timeout' }, status: 504 })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'desconhecido@a.com', password: 'qualquer' });

    // Chegou a resposta de verdade do banco (e-mail não existe): 401, não 503.
    expect(res.status).toBe(401);
  });
});

// ─── POST /auth/forgot-password ──────────────────────────────────────
describe('POST /auth/forgot-password', () => {
  it('banco fora do ar responde 503 em vez de fingir que mandou o e-mail', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'statement timeout' }, status: 500 })
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'statement timeout' }, status: 500 });

    const res = await request(app).post('/auth/forgot-password').send({ email: 'cliente@a.com' });

    expect(res.status).toBe(503);
  });

  it('e-mail que não existe continua com a resposta genérica', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null, status: 200 });

    const res = await request(app).post('/auth/forgot-password').send({ email: 'ninguem@a.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/se o email estiver cadastrado/i);
  });

  // Teto próprio da rota (04/11/2026): cada pedido de conta real manda e-mail E WhatsApp. 10 por 15 min por IP.
  // Nos testes ele fica desligado; FORGOT_LIMITE_NO_TESTE=1 liga só aqui.
  it('11º pedido do mesmo IP em 15 min leva 429; o healthcheck da Carla fica fora do teto', async () => {
    process.env.FORGOT_LIMITE_NO_TESTE = '1';
    try {
      mockSingle.mockResolvedValue({ data: null, error: null, status: 200 });
      for (let i = 0; i < 10; i++) {
        const ok = await request(app).post('/auth/forgot-password').send({ email: `ninguem${i}@a.com` });
        expect(ok.status).toBe(200);
      }
      const barrado = await request(app).post('/auth/forgot-password').send({ email: 'ninguem@a.com' });
      expect(barrado.status).toBe(429);

      // O healthcheck (sdrB2bAgentService) posta com este e-mail, que não é conta: segue 200 mesmo com o IP no teto.
      const saude = await request(app).post('/auth/forgot-password').send({ email: 'healthcheck@solardoc.app' });
      expect(saude.status).toBe(200);
    } finally {
      delete process.env.FORGOT_LIMITE_NO_TESTE;
      mockSingle.mockReset();
    }
  });
});

// ─── GET /auth/me ────────────────────────────────────────────────────
describe('GET /auth/me', () => {
  // O layout do painel tratava qualquer erro como sessão morta e, com o cookie
  // ainda lá, o proxy devolvia a pessoa pro painel: laço até o banco voltar.
  it('banco fora do ar responde 503, não 404', async () => {
    const { signToken } = await import('../utils/jwt');
    mockSingle
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'upstream timeout' }, status: 504 })
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'upstream timeout' }, status: 504 });

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${signToken('uid-1')}`);

    expect(res.status).toBe(503);
  });

  it('conta que não existe mais responde 401, pro front apagar o cookie', async () => {
    const { signToken } = await import('../utils/jwt');
    mockSingle.mockResolvedValueOnce({ data: null, error: null, status: 200 });

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${signToken('uid-sumiu')}`);

    expect(res.status).toBe(401);
  });
});
