import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O fallback por customer do webhook do Asaas não pode creditar o mês do PLANO com um pagamento de ADICIONAL que chegou sem ligação (o mesmo CPF
// tem a autorização do plano e a do adicional, e as duas moram no mesmo customer do Asaas).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return { supabase: supabaseFalso };
});
const liberarAcessoPix = vi.fn(async () => new Date('2026-12-14T00:00:00Z'));
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({ liberarAcessoPix: (...a: unknown[]) => liberarAcessoPix(...(a as [])) }));
vi.mock('../services/dunningService', () => ({ cancelStripeSubsForEmail: vi.fn(async () => 0) }));
const sendWhatsApp = vi.fn(async () => {});
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: (...a: unknown[]) => sendWhatsApp(...(a as [])) }));
vi.mock('../services/cuponsService', () => ({ registrarUsoCupom: vi.fn(async () => {}) }));
vi.mock('../services/plugcashService', () => ({ processarEventoPlugcash: vi.fn(async () => ({ acao: 'ignorado' })) }));
vi.mock('../services/asaas/asaasPlugcashLink', () => ({
  acharOfertaDoPagamento: vi.fn(async () => null),
  clienteDoAsaas: vi.fn(async () => ({ email: null, nome: null, telefone: null })),
  logLink: vi.fn(),
}));
vi.mock('../services/salesLedger', () => ({ upsertSale: vi.fn(async () => 'sale-1'), sendPurchaseForSale: vi.fn(async () => true) }));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async () => {}) }));
vi.mock('../services/avisoVendaDiego', () => ({ avisarDiegoDaVenda: vi.fn(async () => {}) }));
vi.mock('../services/solardoc/avisoGrupoSolardoc', () => ({ avisarCompra: vi.fn(async () => {}), idDeVenda: vi.fn(() => 'v1') }));

import { db, limpar, semear } from './helpers/dbFalso';
import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';
import { pagamentoParecePixDeAdicional, gravarAdicionaisDoPlano } from '../services/produtos/adicionaisPlanoPix';

let n = 0;
const evento = (payment: Record<string, unknown>, tipo = 'PAYMENT_RECEIVED') => ({
  id: `evt_${++n}`, event: tipo, payment: { id: `pay_${n}`, customer: 'cus_1', ...payment },
});

beforeEach(() => {
  limpar('users', 'asaas_pix_assinaturas', 'asaas_webhook_events', 'system_state');
  liberarAcessoPix.mockClear();
  sendWhatsApp.mockClear();
  const u = semear('users', { email: 'c@x.com', plano: 'ilimitado', plano_expira_em: null, billing_status: 'active', nome: 'C', whatsapp: null });
  semear('asaas_pix_assinaturas', {
    user_id: u.id, email: 'c@x.com', modo: 'automatico', authorization_id: 'auth_plano', subscription_id: null, contract_id: 'SD-VIP-plano',
    plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'ativo', qr_payload: null, ultimo_pagamento_em: null,
    ultimo_pagamento_id: '', proximo_vencimento: null, asaas_customer_id: 'cus_1', created_at: new Date().toISOString(),
  });
});

describe('fallback por customer x pagamento de adicional sem ligação', () => {
  it('R$ 17 sem ligação NÃO credita o plano e avisa o dono', async () => {
    const r = await processarWebhookAsaas(evento({ value: 17 }) as never);
    expect(r.tratado).toBe(false);
    expect(r.motivo).toMatch(/adicional/);
    expect(liberarAcessoPix).not.toHaveBeenCalled();
    expect(sendWhatsApp).toHaveBeenCalled();
  });

  it('R$ 40 sem ligação também não', async () => {
    const r = await processarWebhookAsaas(evento({ value: 40 }) as never);
    expect(r.tratado).toBe(false);
    expect(liberarAcessoPix).not.toHaveBeenCalled();
  });

  it('descrição com "adicional" também segura, qualquer que seja o valor', async () => {
    const r = await processarWebhookAsaas(evento({ value: 67, description: 'SolarDoc adicional mensal' }) as never);
    expect(r.tratado).toBe(false);
    expect(liberarAcessoPix).not.toHaveBeenCalled();
  });

  it('o pagamento normal do plano (R$ 67) pelo mesmo fallback segue creditando', async () => {
    const r = await processarWebhookAsaas(evento({ value: 67 }) as never);
    expect(r).toEqual({ tratado: true, motivo: 'pagamento creditado' });
    expect(liberarAcessoPix).toHaveBeenCalledTimes(1);
  });

  it('plano com bump (R$ 84) e 1º mês com cupom (R$ 19) continuam creditando', async () => {
    db.asaas_pix_assinaturas[0].primeiro_mes = 19;
    expect((await processarWebhookAsaas(evento({ value: 19 }) as never)).tratado).toBe(true);
    await gravarAdicionaisDoPlano('SD-VIP-plano', ['offgrid']);
    expect((await processarWebhookAsaas(evento({ value: 84 }) as never)).tratado).toBe(true);
    expect(liberarAcessoPix).toHaveBeenCalledTimes(2);
  });

  it('um contrato de plano que de fato cobra R$ 17 não é barrado (o valor bate com o contrato)', async () => {
    db.asaas_pix_assinaturas[0].valor = 17;
    db.asaas_pix_assinaturas[0].primeiro_mes = 17;
    expect((await processarWebhookAsaas(evento({ value: 17 }) as never)).tratado).toBe(true);
  });

  it('pagamento com ligação exata (referência do contrato) nunca é barrado', async () => {
    const r = await processarWebhookAsaas(evento({ value: 17, externalReference: 'SD-VIP-plano' }) as never);
    expect(r.tratado).toBe(true);
  });
});

describe('pagamentoParecePixDeAdicional (a regra pura)', () => {
  const contrato = { contract_id: 'SD-VIP-plano', valor: 67, primeiro_mes: 67 };

  it('sem ligação exata: 17 e 40 parecem de adicional; 67 e 30 não', async () => {
    expect(await pagamentoParecePixDeAdicional({ value: 17 }, contrato)).toBe(true);
    expect(await pagamentoParecePixDeAdicional({ value: 40 }, contrato)).toBe(true);
    expect(await pagamentoParecePixDeAdicional({ value: 67 }, contrato)).toBe(false);
    expect(await pagamentoParecePixDeAdicional({ value: 30 }, contrato)).toBe(false);
  });

  it('com assinatura ou referência: nunca', async () => {
    expect(await pagamentoParecePixDeAdicional({ value: 17, subscription: 'sub_1' }, contrato)).toBe(false);
    expect(await pagamentoParecePixDeAdicional({ value: 17, description: 'adicional', externalReference: 'SD-x' }, contrato)).toBe(false);
  });
});
