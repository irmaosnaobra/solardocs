import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A VENDA DO PIX RECORRENTE PRECISA EXISTIR FORA DO PRÓPRIO TRILHO.
//
// Até 14/08/2026 o webhook do Asaas liberava o acesso, avisava o dono e parava
// aí: não gravava em `sales`, não mandava Purchase pro Meta e não aparecia na
// UTMify. Pra quem paga tráfego é o pior recorte possível — a venda que o
// anúncio gerou existe no extrato do banco e não existe onde se decide quanto
// investir.
//
// Estes testes existem porque esse caminho não tem como ser exercitado sem um
// pagamento de verdade: forjar um evento pro Meta envenenaria o otimizador de
// campanha. Então o que dá pra garantir aqui é que, quando o pagamento chegar,
// as três pontas são chamadas — e com os dados certos.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const db: Record<string, Row[]> = { asaas_pix_assinaturas: [], asaas_webhook_events: [], users: [], system_state: [] };

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;

  const linhas = () => db[table].filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'insert' || modo === 'upsert') {
      db[table].push({ ...pendente });
      return { data: pendente, error: null };
    }
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos.map((r) => ({ ...r })), error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    insert: (r: Row) => { modo = 'insert'; pendente = r; return q; },
    upsert: (r: Row) => { modo = 'upsert'; pendente = r; return q; },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
    then: (res: (v: any) => void) => res(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));

// O acesso em si já é trilho antigo (o mesmo do Pix manual) — aqui só precisa
// devolver uma data pra o fluxo seguir.
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  liberarAcessoPix: vi.fn(async () => new Date('2026-09-14T00:00:00Z')),
}));
vi.mock('../services/dunningService', () => ({ cancelStripeSubsForEmail: vi.fn(async () => 1) }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async () => {}) }));
vi.mock('../services/cuponsService', () => ({ registrarUsoCupom: vi.fn(async () => {}) }));
vi.mock('../services/plugcashService', () => ({ processarEventoPlugcash: vi.fn(async () => ({ acao: 'ignorado' })) }));
vi.mock('../services/asaas/asaasPlugcashLink', () => ({
  acharOfertaDoPagamento: vi.fn(async () => null), // não é venda de curso: segue pro trilho de assinatura
  clienteDoAsaas: vi.fn(async () => ({ email: null, nome: null, telefone: null })),
  logLink: vi.fn(),
}));

const vendas: any[] = [];
const purchases: string[] = [];
vi.mock('../services/salesLedger', () => ({
  upsertSale: vi.fn(async (s: any) => { vendas.push(s); return 'sale-1'; }),
  sendPurchaseForSale: vi.fn(async (id: string) => { purchases.push(id); return true; }),
}));

const utmify: any[] = [];
vi.mock('../services/utmifyOrders', () => ({
  sendUtmifyOrder: vi.fn(async (o: any) => { utmify.push(o); return true; }),
}));

import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';

const CONTRATO = 'SD-VIP-teste1';

function contrato(over: Row = {}): Row {
  return {
    id: 'c1', user_id: 'u1', email: 'cliente@teste.com', modo: 'automatico',
    authorization_id: 'auth-1', subscription_id: null, contract_id: CONTRATO,
    plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null,
    status: 'pendente', ultimo_pagamento_id: '', ...over,
  };
}

function evento(id: string, over: Row = {}): any {
  return {
    id, event: 'PAYMENT_CONFIRMED',
    payment: { id: 'pay-1', value: 67, externalReference: CONTRATO, dueDate: '2026-09-14' },
    ...over,
  };
}

beforeEach(() => {
  db.asaas_pix_assinaturas = [contrato()];
  db.asaas_webhook_events = [];
  db.system_state = [];
  db.users = [{
    id: 'u1', email: 'cliente@teste.com', nome: 'Cliente Teste', whatsapp: '34999990000',
    plano_expira_em: null, billing_status: 'active',
    utm_source: 'FB', utm_medium: 'ads', utm_campaign: 'solardoc|123', utm_content: 'criativo-7', utm_term: null,
  }];
  vendas.length = 0; purchases.length = 0; utmify.length = 0;
});

describe('Pix recorrente — a venda chega no ledger, no Meta e na UTMify', () => {
  it('adesão grava a venda com o valor PAGO e a atribuição do cadastro', async () => {
    const r = await processarWebhookAsaas(evento('ev-1'));
    expect(r.tratado).toBe(true);

    expect(vendas).toHaveLength(1);
    const v = vendas[0];
    expect(v.email).toBe('cliente@teste.com');
    expect(v.valor).toBe(67);
    expect(v.status).toBe('paid');
    expect(v.plano).toBe('ilimitado');
    // Chave estável por contrato: reentrega cai no mesmo upsert, não vira 2ª venda.
    expect(v.checkout_session_id).toBe(`asaas:${CONTRATO}`);
    // Sem isto a venda entra como orgânica e o anúncio perde o crédito por uma
    // conversão que ele fez.
    expect(v.utm_campaign).toBe('solardoc|123');
    expect(v.utm_content).toBe('criativo-7');
  });

  it('manda o Purchase pro Meta e o pedido pra UTMify, marcado como PIX', async () => {
    await processarWebhookAsaas(evento('ev-2'));

    expect(purchases).toEqual(['sale-1']);

    expect(utmify).toHaveLength(1);
    // Mandar Pix como 'credit_card' faria o painel mentir justamente sobre a
    // pergunta que motivou o Pix: quanto se vende sem cartão.
    expect(utmify[0].paymentMethod).toBe('pix');
    expect(utmify[0].status).toBe('paid');
    expect(utmify[0].priceInReais).toBe(67);
    expect(utmify[0].orderId).toBe(`asaas:${CONTRATO}`);
  });

  it('o valor que vai pro ledger é o COBRADO, não o do catálogo (cupom de adesão)', async () => {
    db.asaas_pix_assinaturas = [contrato({ cupom: 'ACESSO19', primeiro_mes: 19 })];
    await processarWebhookAsaas(evento('ev-3', {
      payment: { id: 'pay-9', value: 19, externalReference: CONTRATO, dueDate: '2026-09-14' },
    }));

    expect(vendas[0].valor).toBe(19);
    expect(vendas[0].cupom).toBe('ACESSO19');
    expect(vendas[0].comDesconto).toBe(true);
    expect(utmify[0].priceInReais).toBe(19);
  });

  it('RENOVAÇÃO não vira venda nova — mesma regra do cartão', async () => {
    db.asaas_pix_assinaturas = [contrato({ status: 'ativo', ultimo_pagamento_id: 'pay-anterior' })];
    const r = await processarWebhookAsaas(evento('ev-4', {
      payment: { id: 'pay-2', value: 67, externalReference: CONTRATO, dueDate: '2026-10-14' },
    }));

    expect(r.tratado).toBe(true);
    // Uma venda, uma linha. Renovação é aviso, não receita nova no ledger —
    // senão o mesmo cliente vira 12 vendas por ano e o CAC despenca no papel.
    expect(vendas).toHaveLength(0);
    expect(purchases).toHaveLength(0);
    expect(utmify).toHaveLength(0);
  });

  it('o mesmo pagamento entregue duas vezes não gera duas vendas', async () => {
    await processarWebhookAsaas(evento('ev-5'));
    expect(vendas).toHaveLength(1);

    // PAYMENT_CONFIRMED e PAYMENT_RECEIVED são eventos DIFERENTES do MESMO
    // pagamento — a trava é o payment id, não o id do evento.
    await processarWebhookAsaas(evento('ev-6', {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay-1', value: 67, externalReference: CONTRATO, dueDate: '2026-09-14' },
    }));
    expect(vendas).toHaveLength(1);
    expect(purchases).toHaveLength(1);
  });

  it('se o ledger falhar, o acesso do cliente NÃO cai junto', async () => {
    const { upsertSale } = await import('../services/salesLedger');
    (upsertSale as any).mockRejectedValueOnce(new Error('ledger fora do ar'));

    const r = await processarWebhookAsaas(evento('ev-7'));
    // O cliente pagou: o pagamento continua creditado mesmo sem a venda registrada.
    expect(r.tratado).toBe(true);
    expect(db.asaas_pix_assinaturas[0].status).toBe('ativo');
  });
});
