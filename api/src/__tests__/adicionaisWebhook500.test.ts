import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Stripe fora do ar na hora de ler a assinatura da fatura: sem ela não dá para saber se a fatura é do plano ou só de adicional. O webhook
// responde 500 (a Stripe reenvia) e NADA segue pelo caminho do plano (status de cobrança, dunning, UTMify, aviso de renovação).
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  evento: null as null | Record<string, any>,
  retrieveSub: null as null | ((id: string) => Promise<any>),
  tocouNoPlano: [] as string[],
}));

vi.mock('stripe', () => {
  class FakeStripe {
    webhooks = { constructEvent: () => h.evento };
    webhookEndpoints = { list: async () => ({ data: [] }), update: async () => ({}) };
    subscriptions = { retrieve: (id: string) => h.retrieveSub!(id) };
    customers = { retrieve: async () => ({ id: 'cus_1', email: 'c@x.com' }) };
  }
  return { default: FakeStripe, Stripe: FakeStripe };
});

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, is: () => q, or: () => q, limit: () => q, order: () => q,
        update: () => { h.tocouNoPlano.push(`update:${tabela}`); return q; },
        insert: () => { h.tocouNoPlano.push(`insert:${tabela}`); return q; },
        upsert: () => { h.tocouNoPlano.push(`upsert:${tabela}`); return q; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../services/dunningService', () => ({
  sendDunningDay0: vi.fn(async () => { h.tocouNoPlano.push('dunning0'); }),
  sendDunningRecovered: vi.fn(async () => { h.tocouNoPlano.push('recuperado'); }),
}));
vi.mock('../utils/mailer', () => ({ sendCheckoutCompletionEmail: vi.fn(), sendOpsAlert: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ sendActivationWhatsApp: vi.fn() }));
vi.mock('../services/salesLedger', () => ({ upsertSale: vi.fn(), sendPurchaseForSale: vi.fn(), classificarOrigem: vi.fn() }));
vi.mock('../services/vendaAviso', () => ({
  avisarVendaAoDono: vi.fn(), avisarRenovacaoAoDono: vi.fn(async () => { h.tocouNoPlano.push('aviso-renovacao'); }), historicoDoCliente: vi.fn(),
}));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async () => { h.tocouNoPlano.push('utmify'); }) }));
vi.mock('../services/kitIntegradorService', () => ({ concederCursoPorAssinatura: vi.fn() }));
vi.mock('../services/stripeContaLink', () => ({ emailsDaConta: vi.fn(async () => ['c@x.com']) }));

import { stripeWebhook } from '../controllers/paymentsController';

function resposta() {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: any) { out.body = b; return res; },
    send(b: any) { out.body = b; return res; },
  };
  return { out, res };
}
const chama = async (evento: Record<string, any>) => {
  h.evento = evento;
  const { out, res } = resposta();
  await stripeWebhook({ headers: { 'stripe-signature': 'x' }, body: Buffer.from('{}') } as any, res);
  return out;
};

beforeEach(() => {
  h.tocouNoPlano = [];
  h.retrieveSub = async () => { throw new Error('stripe fora do ar'); };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('webhook: Stripe sem responder na leitura da assinatura da fatura', () => {
  it('invoice.payment_succeeded: 500 e nada do plano foi tocado', async () => {
    const r = await chama({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_paid: 1700 } },
    });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'assinatura_indisponivel' });
    expect(h.tocouNoPlano).toEqual([]);
  });

  it('invoice.payment_failed de renovação: 500 e o dunning não abre', async () => {
    const r = await chama({
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', customer: 'cus_1', subscription: 'sub_1', billing_reason: 'subscription_cycle' } },
    });
    expect(r.status).toBe(500);
    expect(h.tocouNoPlano).toEqual([]);
  });

  it('com a Stripe respondendo e a assinatura só de adicional, a fatura NÃO segue pelo caminho do plano (200, nada do plano)', async () => {
    h.retrieveSub = async () => ({
      id: 'sub_1', status: 'active', metadata: { userId: 'u1' }, customer: 'cus_1', current_period_end: 2_000_000_000,
      items: { data: [{ id: 'si_1', price: { id: 'p', lookup_key: 'ad_offgrid_mensal' }, current_period_end: 2_000_000_000 }] },
    });
    const r = await chama({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_3', customer: 'cus_1', subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_paid: 1700 } },
    });
    expect(r.status).toBe(200);
    expect(h.tocouNoPlano).not.toContain('utmify');
    expect(h.tocouNoPlano).not.toContain('aviso-renovacao');
    expect(h.tocouNoPlano).not.toContain('recuperado');
  });
});
