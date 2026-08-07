import { describe, it, expect, vi } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// A conta da Stripe é COMPARTILHADA (SolarDoc + Pack Solar). O auto-conserto da
// assinatura de eventos escreve na configuração viva do webhook, então o risco
// real não é ele deixar de somar um evento — é ele APAGAR o evento de outro
// produto, ou mexer no endpoint errado. Aqui as duas travas ficam presas.
//
// Contexto: `checkout.session.expired` não estava assinado e `abandoned_checkouts`
// passou 29 dias (08/07→06/08) sem uma linha — a cadência de recuperação inteira
// sem semente, em silêncio, porque evento que falta não gera erro nenhum.

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../services/dunningService', () => ({ sendDunningDay0: vi.fn(), sendDunningRecovered: vi.fn() }));
vi.mock('../utils/mailer', () => ({ sendCheckoutCompletionEmail: vi.fn(), sendOpsAlert: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ sendActivationWhatsApp: vi.fn() }));
vi.mock('../services/salesLedger', () => ({ upsertSale: vi.fn(), sendPurchaseForSale: vi.fn() }));
vi.mock('../services/vendaAviso', () => ({ avisarVendaAoDono: vi.fn() }));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn() }));
vi.mock('../services/kitIntegradorService', () => ({ concederCursoPorAssinatura: vi.fn() }));

import { ehNossoEndpoint, eventosFaltando } from '../controllers/paymentsController';

const ep = (over: Record<string, any> = {}) => ({
  id: 'we_1', url: 'https://api.solardoc.app/payments/webhook',
  status: 'enabled', enabled_events: ['checkout.session.completed'],
  ...over,
});

describe('qual endpoint o auto-conserto pode tocar', () => {
  it('o nosso, vivo, entra', () => {
    expect(ehNossoEndpoint(ep())).toBe(true);
  });

  it('endpoint de OUTRO produto na mesma conta fica de fora', () => {
    expect(ehNossoEndpoint(ep({ url: 'https://pack.solardoc.app/api/stripe-hook' }))).toBe(false);
  });

  it('endpoint desabilitado não é ressuscitado', () => {
    expect(ehNossoEndpoint(ep({ status: 'disabled' }))).toBe(false);
  });
});

describe('o que ele soma', () => {
  it('acha o expired faltando — o furo real de 08/07 a 06/08', () => {
    expect(eventosFaltando(ep())).toContain('checkout.session.expired');
  });

  it('endpoint completo não é tocado', () => {
    const completo = ep({
      enabled_events: [
        'checkout.session.completed', 'checkout.session.expired',
        'invoice.payment_failed', 'invoice.payment_succeeded',
        'customer.subscription.deleted',
      ],
    });
    expect(eventosFaltando(completo)).toEqual([]);
  });

  it('quem escuta tudo (*) não é tocado', () => {
    expect(eventosFaltando(ep({ enabled_events: ['*'] }))).toEqual([]);
  });

  it('NUNCA remove: o resultado é só o que falta, e o chamador soma ao que já existe', () => {
    const comAlheio = ep({ enabled_events: ['checkout.session.completed', 'payment_intent.succeeded'] });
    const faltando = eventosFaltando(comAlheio);
    expect(faltando).not.toContain('checkout.session.completed');
    expect(faltando).not.toContain('payment_intent.succeeded');
    // a lista final que o update manda = atuais + faltando → o alheio sobrevive
    const final = [...(comAlheio.enabled_events ?? []), ...faltando];
    expect(final).toContain('payment_intent.succeeded');
    expect(final).toContain('checkout.session.expired');
  });
});
