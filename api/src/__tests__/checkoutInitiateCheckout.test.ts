import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Par do servidor para o InitiateCheckout do pixel da SolarDoc: com `ic_event_id` válido manda uma vez, com o mesmo
// event_id; sem ele (ou inválido) não manda; erro no envio nunca quebra nem atrasa o checkout.

const h = vi.hoisted(() => ({ criadas: [] as any[], meta: vi.fn() }));

vi.mock('stripe', () => {
  const fundo = (): any => new Proxy(function () { /* noop */ }, {
    get: (_t, k) => (k === 'then' ? undefined : fundo()),
    apply: () => Promise.resolve({ data: [], has_more: false, url: null }),
  });
  class Stripe {
    checkout = { sessions: { create: async (a: any) => { h.criadas.push(a); return { url: 'https://checkout.stripe.test/s' }; } } };
    constructor() { return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : fundo()) }); }
  }
  return { default: Stripe };
});
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: h.meta }));
vi.mock('../services/cuponsService', () => ({
  buscarCupomValido: vi.fn().mockResolvedValue(null), aplicarCupom: vi.fn().mockReturnValue(null), garantirCupomStripe: vi.fn(),
  garantirPromotionCode: vi.fn(), cupomAtivoParaPlano: vi.fn().mockResolvedValue(false), registrarUsoCupom: vi.fn(),
  resumoPublicoCupom: vi.fn(), normalizarCodigo: vi.fn(),
}));

import { createPublicCheckout } from '../controllers/paymentsController';

const chamar = async (body: Record<string, unknown>) => {
  const res: any = { statusCode: 200, body: undefined as any };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await createPublicCheckout(
    { body, ip: '203.0.113.9', headers: { 'user-agent': 'UA-teste' } } as unknown as Request, res as Response);
  return res;
};

beforeEach(() => { h.criadas.length = 0; h.meta.mockReset(); h.meta.mockResolvedValue({ ok: true, status: 200 }); });

describe('createPublicCheckout: InitiateCheckout do servidor', () => {
  it('com ic_event_id manda uma vez, com esse id e os dados do corpo', async () => {
    const r = await chamar({
      plan: 'vip', ic_event_id: 'ic_abc-123.x:y', email: 'Ana@Ex.com', telefone: '(34) 99999-0000', nome: 'Ana Souza',
      fbc: 'fb.1.1700000000000.AbCdEf123', fbp: 'fb.1.1700000000000.123456789',
    });
    expect(r.statusCode).toBe(200);
    expect(h.meta).toHaveBeenCalledTimes(1);
    const [nome, o] = h.meta.mock.calls[0];
    expect(nome).toBe('InitiateCheckout');
    expect(o).toMatchObject({
      eventId: 'ic_abc-123.x:y', email: 'Ana@Ex.com', phone: '(34) 99999-0000', firstName: 'ana', lastName: 'souza',
      fbc: 'fb.1.1700000000000.AbCdEf123', fbp: 'fb.1.1700000000000.123456789', ip: '203.0.113.9', userAgent: 'UA-teste',
      customData: { value: 67, currency: 'BRL' },
    });
    expect(o.externalId).toBeUndefined(); // sem externalId, o sendMetaEvent usa o e-mail: igual ao Lead do cadastro
  });

  it('sem ic_event_id não manda nada', async () => {
    const r = await chamar({ plan: 'vip', email: 'a@b.com' });
    expect(r.statusCode).toBe(200);
    expect(h.meta).not.toHaveBeenCalled();
  });

  it('ic_event_id inválido não manda', async () => {
    for (const id of ['', 'com espaço', 'a'.repeat(101), 'x;drop', '<b>', 5, null, {}]) {
      const r = await chamar({ plan: 'vip', ic_event_id: id });
      expect(r.statusCode).toBe(200);
    }
    expect(h.meta).not.toHaveBeenCalled();
  });

  it('erro no envio (rejeição ou exceção) não quebra o checkout', async () => {
    h.meta.mockRejectedValueOnce(new Error('meta fora'));
    const r1 = await chamar({ plan: 'vip', ic_event_id: 'ic_1' });
    h.meta.mockImplementationOnce(() => { throw new Error('boom sincrono'); });
    const r2 = await chamar({ plan: 'vip', ic_event_id: 'ic_2' });
    expect(r1.statusCode).toBe(200);
    expect(r1.body.url).toContain('checkout.stripe.test');
    expect(r2.statusCode).toBe(200);
    expect(r2.body.url).toContain('checkout.stripe.test');
    expect(h.meta).toHaveBeenCalledTimes(2);
  });

  it('não espera o envio: resposta sai mesmo com o Meta pendurado', async () => {
    h.meta.mockReturnValueOnce(new Promise(() => { /* nunca resolve */ }));
    const r = await chamar({ plan: 'vip', ic_event_id: 'ic_3' });
    expect(r.statusCode).toBe(200);
  });
});
