import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// O checkout público aceita `origem` só com o valor 'quiz_solardoc' (lista fechada)
// e grava em metadata.origem da sessão da Stripe. O resto do checkout não muda.

const h = vi.hoisted(() => ({ criadas: [] as any[] }));

vi.mock('stripe', () => {
  // Qualquer chamada que não seja a criação da sessão devolve uma lista vazia.
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
vi.mock('../services/cuponsService', () => ({
  buscarCupomValido: vi.fn().mockResolvedValue(null), aplicarCupom: vi.fn().mockReturnValue(null), garantirCupomStripe: vi.fn(),
  garantirPromotionCode: vi.fn(), cupomAtivoParaPlano: vi.fn().mockResolvedValue(false), registrarUsoCupom: vi.fn(),
  resumoPublicoCupom: vi.fn(), normalizarCodigo: vi.fn(),
}));

import { createPublicCheckout, ORIGEM_QUIZ_SOLARDOC } from '../controllers/paymentsController';

const chamar = async (body: Record<string, unknown>) => {
  const res: any = { statusCode: 200, body: undefined as any };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await createPublicCheckout({ body } as unknown as Request, res as Response);
  return res;
};

beforeEach(() => { h.criadas.length = 0; });

describe('createPublicCheckout: origem do quiz', () => {
  it("'quiz_solardoc' vai no metadata da sessão e da assinatura", async () => {
    const r = await chamar({ plan: 'vip', utm_source: 'fb', origem: 'quiz_solardoc' });
    expect(r.statusCode).toBe(200);
    expect(r.body.url).toContain('checkout.stripe.test');
    expect(ORIGEM_QUIZ_SOLARDOC).toBe('quiz_solardoc');
    expect(h.criadas).toHaveLength(1);
    expect(h.criadas[0].metadata).toMatchObject({ source: 'public_checkout', origem: 'quiz_solardoc', utm_source: 'fb' });
    expect(h.criadas[0].subscription_data.metadata.origem).toBe('quiz_solardoc');
  });

  it('qualquer outro valor (ou nenhum) não entra no metadata', async () => {
    for (const origem of ['outra', '', 'QUIZ_SOLARDOC', undefined, 5 as unknown as string]) {
      h.criadas.length = 0;
      const r = await chamar({ plan: 'vip', origem });
      expect(r.statusCode).toBe(200);
      expect(h.criadas[0].metadata).not.toHaveProperty('origem');
    }
  });

  it('plano inválido continua 400', async () => {
    const r = await chamar({ plan: 'nao-existe', origem: 'quiz_solardoc' });
    expect(r.statusCode).toBe(400);
    expect(h.criadas).toHaveLength(0);
  });
});
