import { describe, it, expect, vi, beforeEach } from 'vitest';

// Grupo de vendas do SolarDoc (24/10/2026) no webhook do Asaas: o aviso individual ao Thiago NUNCA é dispensado; o do
// grupo é um a mais, só na ADESÃO (renovação fica só com o Thiago) e com id único da venda.

type Row = Record<string, any>;
const db: Record<string, Row[]> = { asaas_pix_assinaturas: [], asaas_webhook_events: [], users: [], system_state: [] };

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;
  const linhas = () => db[table]!.filter((r) => filtros.every((f) => f(r)));
  function executa(): { data: any; error: any } {
    if (modo === 'insert' || modo === 'upsert') { db[table]!.push({ ...pendente }); return { data: pendente, error: null }; }
    if (modo === 'update') { const alvos = linhas(); alvos.forEach((r) => Object.assign(r, patch)); return { data: alvos.map((r) => ({ ...r })), error: null }; }
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
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({ liberarAcessoPix: vi.fn(async () => new Date('2026-09-14T00:00:00Z')) }));
vi.mock('../services/dunningService', () => ({ cancelStripeSubsForEmail: vi.fn(async () => 1) }));
const zap = vi.hoisted(() => ({ sendWhatsApp: vi.fn(async (..._a: unknown[]) => {}) }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: zap.sendWhatsApp }));
vi.mock('../services/cuponsService', () => ({ registrarUsoCupom: vi.fn(async () => {}) }));
vi.mock('../services/plugcashService', () => ({ processarEventoPlugcash: vi.fn(async () => ({ acao: 'ignorado' })) }));
vi.mock('../services/asaas/asaasPlugcashLink', () => ({
  acharOfertaDoPagamento: vi.fn(async () => null),
  clienteDoAsaas: vi.fn(async () => ({ email: null, nome: null, telefone: null })),
  logLink: vi.fn(),
}));
vi.mock('../services/salesLedger', () => ({ upsertSale: vi.fn(async () => 'sale-1'), sendPurchaseForSale: vi.fn(async () => true) }));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async () => true) }));
const grupo = vi.hoisted(() => ({ avisarCompra: vi.fn(async (_c: unknown) => 'enviado') }));
vi.mock('../services/solardoc/avisoGrupoSolardoc', async (orig) => ({ ...(await orig<typeof import('../services/solardoc/avisoGrupoSolardoc')>()), avisarCompra: grupo.avisarCompra }));

import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';

const CONTRATO = 'SD-VIP-grupo1';
const contrato = (over: Row = {}): Row => ({
  id: 'c1', user_id: 'u1', email: 'cliente@teste.com', modo: 'automatico', authorization_id: 'auth-1', subscription_id: null,
  contract_id: CONTRATO, plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', ultimo_pagamento_id: '', ...over,
});
const evento = (id: string, over: Row = {}): any => ({
  id, event: 'PAYMENT_CONFIRMED', payment: { id: 'pay-1', value: 67, externalReference: CONTRATO, dueDate: '2026-09-14' }, ...over,
});
const thiago = () => zap.sendWhatsApp.mock.calls.filter((c) => c[0] === '34991360223');
const avisoAdesao = () => thiago().some((c) => String(c[1]).includes('Nova assinatura no Pix recorrente'));

beforeEach(() => {
  db.asaas_pix_assinaturas = [contrato()];
  db.asaas_webhook_events = []; db.system_state = [];
  db.users = [{ id: 'u1', email: 'cliente@teste.com', nome: 'Cliente Teste', whatsapp: '34999990000', plano_expira_em: null, billing_status: 'active' }];
  zap.sendWhatsApp.mockClear(); grupo.avisarCompra.mockReset(); grupo.avisarCompra.mockResolvedValue('enviado');
});

describe('Pix recorrente: grupo de vendas é um aviso a mais', () => {
  it('adesão: o Thiago recebe E o grupo recebe, com o id do contrato e o plano ativo', async () => {
    await processarWebhookAsaas(evento('ev-1'));
    expect(avisoAdesao()).toBe(true);
    expect(grupo.avisarCompra).toHaveBeenCalledTimes(1);
    expect(grupo.avisarCompra.mock.calls[0]![0]).toMatchObject({
      id: `asaas:${CONTRATO}`, canal: 'asaas', planoAtivo: true, valor: 67, nome: 'Cliente Teste', telefone: '34999990000',
    });
  });
  it('o Thiago recebe mesmo quando o grupo cobre (enviado, pendente, duplicado) e quando não (sem grupo, falhou, erro)', async () => {
    for (const r of ['enviado', 'pendente', 'duplicado', 'sem_grupo', 'falhou', 'erro']) {
      db.asaas_pix_assinaturas = [contrato()]; db.asaas_webhook_events = [];
      zap.sendWhatsApp.mockClear(); grupo.avisarCompra.mockResolvedValue(r);
      await processarWebhookAsaas(evento(`ev-${r}`, { payment: { id: `pay-${r}`, value: 67, externalReference: CONTRATO } }));
      expect(avisoAdesao(), r).toBe(true);
    }
  });
  it('se o aviso ao grupo estourar, o Thiago já recebeu e o webhook segue tratado', async () => {
    grupo.avisarCompra.mockRejectedValue(new Error('grupo fora'));
    const r = await processarWebhookAsaas(evento('ev-2'));
    expect(r.tratado).toBe(true);
    expect(avisoAdesao()).toBe(true);
  });
  it('renovação: só o Thiago (o grupo não é chamado)', async () => {
    db.asaas_pix_assinaturas = [contrato({ status: 'ativo', ultimo_pagamento_id: 'pay-anterior' })];
    await processarWebhookAsaas(evento('ev-3', { payment: { id: 'pay-2', value: 67, externalReference: CONTRATO, dueDate: '2026-10-14' } }));
    expect(thiago().some((c) => String(c[1]).includes('Renovação no Pix recorrente'))).toBe(true);
    expect(grupo.avisarCompra).not.toHaveBeenCalled();
  });
  it('sem contract_id usa a autorização; a chave do claim nunca leva "null" nem "undefined"', async () => {
    db.asaas_pix_assinaturas = [contrato({ contract_id: null, authorization_id: 'auth-77' })];
    await processarWebhookAsaas(evento('ev-4', { payment: { id: 'pay-4', value: 67, externalReference: null, dueDate: '2026-09-14' }, authorization: { id: 'auth-77' } }));
    expect(avisoAdesao()).toBe(true);
    expect((grupo.avisarCompra.mock.calls[0]![0] as any).id).toBe('asaas:auth-77');
  });
});
