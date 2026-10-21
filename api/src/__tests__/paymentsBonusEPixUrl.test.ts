import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── B3c no webhook da Stripe e na rota /payments/pix-url ─────────────────────
// 1) O gancho do bônus da planilha entra DEPOIS do plano, do ledger e do Purchase, e um gancho que
//    lança (síncrono ou assíncrono) não muda a resposta do webhook nem o que foi gravado.
// 2) GET /payments/pix-url devolve { url } só com https, senão { url: null }.

// O PLAN_MAP lê a env no momento do import, então ela tem que existir ANTES dele (vi.hoisted).
const PRICE_VIP = vi.hoisted(() => {
  process.env.STRIPE_PRICE_VIP = 'price_vip_teste';
  return 'price_vip_teste';
});

const ordem: string[] = []; // a ordem em que as coisas aconteceram
const bonusMock = vi.hoisted(() => ({ tentar: vi.fn(async (_a: any) => true) }));
let eventoAtual: any = null;
let temSubscription = true;

vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: () => eventoAtual };
    webhookEndpoints = { list: async () => ({ data: [] }), update: async () => ({}) };
    subscriptions = { retrieve: async () => ({ items: { data: [{ price: { id: PRICE_VIP } }] }, status: 'active' }) };
    prices = { list: async () => ({ data: [] }) };
    customers = { retrieve: async () => ({}) };
    checkout = { sessions: { listLineItems: async () => ({ data: [] }) } };
  },
}));

// supabase: qualquer cadeia resolve { data: null, error: null }; registra os updates de plano.
vi.mock('../utils/supabase', () => {
  const cadeia = (tabela: string, op: { v?: string }) => {
    const q: any = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: any) => void) => res({ data: null, error: null });
        if (prop === 'update') return (patch: any) => { if (tabela === 'users' && patch?.plano) ordem.push('plano:' + patch.plano); return q; };
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
        return () => q;
      },
    });
    return q;
  };
  return { supabase: { from: (t: string) => cadeia(t, {}) } };
});
vi.mock('../services/agentes5040/planilhaBonus', () => ({ tentarBonusPosPagamento: bonusMock.tentar }));
vi.mock('../services/dunningService', () => ({ sendDunningDay0: vi.fn(), sendDunningRecovered: vi.fn() }));
vi.mock('../utils/mailer', () => ({ sendCheckoutCompletionEmail: vi.fn(), sendOpsAlert: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ sendActivationWhatsApp: vi.fn() }));
vi.mock('../services/salesLedger', () => ({
  upsertSale: vi.fn(async () => { ordem.push('ledger'); return 'sale1'; }),
  sendPurchaseForSale: vi.fn(async () => { ordem.push('purchase'); }),
  classificarOrigem: vi.fn(() => ({ origem: 'organico', detalhe: '' })),
}));
vi.mock('../services/vendaAviso', () => ({ avisarVendaAoDono: vi.fn(async () => {}), historicoDoCliente: vi.fn(async () => null), avisarRenovacaoAoDono: vi.fn() }));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async () => { ordem.push('utmify'); }) }));
vi.mock('../services/kitIntegradorService', () => ({ concederCursoPorAssinatura: vi.fn() }));

import { stripeWebhook, getPixUrl } from '../controllers/paymentsController';

function resFalso() {
  const r: any = { code: 200, body: undefined as any };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  return r;
}

function sessao(over: Record<string, any> = {}) {
  return {
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_test_1',
      metadata: { userId: 'u-1' },
      customer_email: 'cliente@teste.com',
      customer_details: { phone: '+55 34 99111-2222', name: 'Cliente' },
      subscription: temSubscription ? 'sub_1' : null,
      payment_status: 'paid',
      amount_total: 6700,
      total_details: { amount_discount: 0 },
      ...over,
    } },
  };
}

async function chamar() {
  const res = resFalso();
  await stripeWebhook({ headers: { 'stripe-signature': 'x' }, body: Buffer.from('{}') } as any, res);
  return res;
}

beforeEach(() => {
  ordem.length = 0;
  temSubscription = true;
  eventoAtual = sessao();
  bonusMock.tentar.mockReset();
  bonusMock.tentar.mockImplementation(async (_a: any) => { ordem.push('bonus'); return true; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Stripe checkout.session.completed do plano: bônus da planilha', () => {
  it('chama o gancho UMA vez, por último: depois do plano, do ledger e do Purchase', async () => {
    const res = await chamar();
    expect(res.body).toEqual({ received: true });
    expect(bonusMock.tentar).toHaveBeenCalledTimes(1);
    expect(bonusMock.tentar.mock.calls[0]![0]).toMatchObject({
      userId: 'u-1', email: 'cliente@teste.com', telefone: '+55 34 99111-2222', origem: 'stripe',
    });
    expect(ordem[0]).toBe('plano:ilimitado');
    expect(ordem.indexOf('bonus')).toBe(ordem.length - 1);
    expect(ordem).toEqual(expect.arrayContaining(['ledger', 'purchase', 'utmify']));
  });

  it('o dia do fechamento é o do PAGAMENTO (event.created), não o do processamento do webhook', async () => {
    // pago às 23:59 de Brasília (02:59 UTC do dia seguinte); o webhook só roda às 00:01 de Brasília
    const pagoEm = new Date('2026-10-21T02:59:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T03:01:00Z'));
    try {
      eventoAtual = { ...sessao(), created: Math.floor(pagoEm.getTime() / 1000) };
      await chamar();
    } finally { vi.useRealTimers(); }
    expect(bonusMock.tentar).toHaveBeenCalledTimes(1);
    expect((bonusMock.tentar.mock.calls[0]![0] as any).agora).toEqual(pagoEm);
  });

  it('gancho que LANÇA (síncrono ou assíncrono) não muda a resposta nem o que foi gravado', async () => {
    for (const falha of [
      () => { throw new Error('bônus quebrou'); },
      async () => { throw new Error('bônus quebrou depois'); },
    ]) {
      ordem.length = 0;
      bonusMock.tentar.mockReset();
      bonusMock.tentar.mockImplementationOnce(falha as any);
      const res = await chamar();
      expect(res.code).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(ordem).toEqual(['plano:ilimitado', 'ledger', 'purchase', 'utmify']);
    }
  });

  it('compra sem assinatura (Pack Solar, mode=payment) não chega no gancho', async () => {
    temSubscription = false;
    eventoAtual = sessao();
    const res = await chamar();
    expect(res.body).toEqual({ received: true });
    expect(bonusMock.tentar).not.toHaveBeenCalled();
    expect(ordem).toEqual([]);
  });
});

describe('GET /payments/pix-url', () => {
  const antes = process.env.SOLARDOC_PIX_CHECKOUT_URL;
  afterEach(() => {
    if (antes === undefined) delete process.env.SOLARDOC_PIX_CHECKOUT_URL; else process.env.SOLARDOC_PIX_CHECKOUT_URL = antes;
  });
  const url = () => { const res = resFalso(); getPixUrl({} as any, res); return res.body; };

  it('com a env em https devolve a url', () => {
    process.env.SOLARDOC_PIX_CHECKOUT_URL = ' https://pay.kiwify.com.br/ABC123 ';
    expect(url()).toEqual({ url: 'https://pay.kiwify.com.br/ABC123' });
  });

  it('sem env devolve null', () => {
    delete process.env.SOLARDOC_PIX_CHECKOUT_URL;
    expect(url()).toEqual({ url: null });
    process.env.SOLARDOC_PIX_CHECKOUT_URL = '   ';
    expect(url()).toEqual({ url: null });
  });

  it('fora de https (http, javascript:, sem esquema, com espaço) devolve null', () => {
    for (const ruim of ['http://pay.kiwify.com.br/x', 'javascript:alert(1)', 'pay.kiwify.com.br/x', 'https://a.com/x y', '//evil.com']) {
      process.env.SOLARDOC_PIX_CHECKOUT_URL = ruim;
      expect(url()).toEqual({ url: null });
    }
  });
});
