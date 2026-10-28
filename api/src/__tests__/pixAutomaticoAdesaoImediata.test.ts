import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// PIX AUTOMÁTICO COM 1ª COBRANÇA IMEDIATA (prova de produção, 25/10/2026).
//
// O PAYMENT_RECEIVED do 1º mês chega ANTES do ACTIVATED e sem ligação nenhuma com o
// contrato: sem subscription, sem autorização, externalReference nulo e OUTRO customer.
// A ligação real é payment.pixQrCodeId == authorization.immediateQrCode.conciliationIdentifier.
// O cliente pagava e não ganhava acesso. Estes testes usam a FORMA REAL dos dois payloads.
//
// O banco falso aqui IMPÕE chave única (system_state.key, asaas_webhook_events.event_id) e
// entende o filtro de JSON do PostgREST (`payload->payment->>pixQrCodeId`). Sem isso, os casos
// de reentrega e de busca no histórico passariam sem provar nada.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;

const H = vi.hoisted(() => {
  type R = Record<string, any>;
  const db: Record<string, R[]> = {
    asaas_pix_assinaturas: [], asaas_webhook_events: [], users: [], system_state: [],
  };
  const flags = { falhaClaimAdesao: { v: false } };
  const UNICA: Record<string, string> = { system_state: 'key', asaas_webhook_events: 'event_id', users: 'email' };
  // Insert com chave única: devolve 23505 se já existe (igual ao Postgres).
  function inserir(table: string, row: R): { error: any } {
    if (flags.falhaClaimAdesao.v && table === 'system_state' && String(row.key).startsWith('asaas_adesao:')) {
      return { error: { code: 'XX000', message: 'banco fora' } };
    }
    const col = UNICA[table];
    if (col && db[table].some((r) => r[col] === row[col])) return { error: { code: '23505', message: 'duplicate key' } };
    db[table].push({ ...row });
    return { error: null };
  }
  const caminho = (r: R, col: string) => col.split(/->>|->/).reduce((v: any, p) => v?.[p], r);
  return {
    db, inserir, caminho,
    emails: [] as any[],
    whats: [] as string[],
    vendas: [] as any[],
    purchases: [] as string[],
    quiz: [] as any[],
    liberacoes: [] as string[],
    bases: [] as Array<string | null>,
    falhaClaimAdesao: flags.falhaClaimAdesao,
    e2e: { valor: 'E1234567890123456789012345' as string | null, falha: false },
    autFalha: { v: false },
    chamadasAsaas: [] as string[],
  };
});
const { db } = H;

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let max = Infinity;
  const linhas = () => db[table].filter((r) => filtros.every((f) => f(r))).slice(0, max);

  function executa(): { data: any; error: any } {
    if (modo === 'insert') {
      const row = { id: `id-${db[table].length + 1}`, ...pendente } as Row;
      const { error } = H.inserir(table, row);
      return { data: error ? null : { ...row }, error };
    }
    if (modo === 'upsert') {
      const col = ({ system_state: 'key' } as Record<string, string>)[table] ?? 'id';
      const i = db[table].findIndex((r) => r[col] === pendente![col]);
      if (i >= 0) db[table][i] = { ...db[table][i], ...pendente }; else db[table].push({ ...pendente });
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
    eq: (c: string, v: any) => { filtros.push((r) => String(H.caminho(r, c)) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    order: () => q,
    limit: (n: number) => { max = n; return q; },
    maybeSingle: async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
    single: async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
    then: (res: (v: any) => void) => res(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));

vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  liberarAcessoPix: vi.fn(async (userId: string, base?: string | null) => { H.liberacoes.push(userId); H.bases.push(base ?? null); return new Date('2026-11-27T00:00:00Z'); }),
  // Mesma regra do original (chaveE2e), sem carregar o módulo inteiro (ele sobe o SDK da Anthropic no boot).
  chaveE2e: (id: string | null | undefined, valor: number) => {
    const s = String(id ?? '').replace(/\s+/g, '');
    return /^E\d{20}/.test(s) ? `pix_e2e:${s.slice(0, 21).toUpperCase()}:${Math.round(valor)}` : null;
  },
  // Mesma regra do original (e2eJaUsado): insert único em system_state, 23505 = já usado.
  e2eJaUsado: vi.fn(async (key: string | null, valor: number, userId: string) => {
    if (!key) return false;
    const { error } = H.inserir('system_state', { key, value: { user_id: userId, valor, at: 'x' } });
    return !!error;
  }),
  getOrCreatePixUser: vi.fn(async (email: string, nome: string | null, phone: string) => {
    const existente = db.users.find((u) => u.email === email);
    if (existente) return { ...existente, criadaAgora: false };
    const u = { id: 'u-novo', email, nome, whatsapp: phone, plano_expira_em: null, billing_status: 'free', reset_token: 'TOKEN-SECRETO-123' };
    db.users.push(u);
    return { ...u, criadaAgora: true };
  }),
}));
vi.mock('../services/dunningService', () => ({ cancelStripeSubsForEmail: vi.fn(async () => 0) }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async (_p: string, texto: string) => { H.whats.push(texto); }) }));
vi.mock('../services/cuponsService', () => ({
  registrarUsoCupom: vi.fn(async () => {}),
  buscarCupomValido: vi.fn(async () => null),
  aplicarCupom: vi.fn(() => null),
}));
vi.mock('../services/plugcashService', () => ({ processarEventoPlugcash: vi.fn(async () => ({ acao: 'ignorado' })) }));
vi.mock('../services/asaas/asaasPlugcashLink', () => ({
  acharOfertaDoPagamento: vi.fn(async () => null),
  clienteDoAsaas: vi.fn(async () => ({ email: null, nome: null, telefone: null })),
  logLink: vi.fn(),
}));
vi.mock('../services/salesLedger', () => ({
  upsertSale: vi.fn(async (s: any) => { H.vendas.push(s); return 'sale-1'; }),
  sendPurchaseForSale: vi.fn(async (id: string) => { H.purchases.push(id); return true; }),
}));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async () => true) }));
vi.mock('../services/solardoc/avisoGrupoSolardoc', () => ({
  avisarCompra: vi.fn(async () => 'enviado'),
  idDeVenda: (prefixo: string, ...partes: Array<string | null | undefined>) => {
    const p = partes.find(Boolean);
    return p ? `${prefixo}${p}` : null;
  },
}));
vi.mock('../services/solardoc/purchasePixQuiz', () => ({
  dispararPurchasePixQuiz: vi.fn(async (e: any) => { H.quiz.push(e); return 'enviado'; }),
}));
vi.mock('../utils/mailer', () => ({
  sendPixAutomaticoAcessoEmail: vi.fn(async (o: any) => { H.emails.push(o); }),
}));
vi.mock('../services/asaas/asaasClient', () => ({
  asaasHabilitado: () => true,
  AsaasError: class extends Error {},
  asaasFetch: vi.fn(async (path: string) => {
    H.chamadasAsaas.push(path);
    if (path.startsWith('/customers?')) return { data: [{ id: 'cus_criacao' }] };
    if (path === '/pix/automatic/authorizations') {
      if (H.autFalha.v) throw new Error('conta inelegível');
      return {
        id: 'auth-nova', status: 'CREATED', payload: '00020126', encodedImage: 'img',
        immediateQrCode: { conciliationIdentifier: 'QRCRIADO1', expirationDate: '2026-10-25T12:00:00Z' },
      };
    }
    if (path.startsWith('/pix/transactions/')) {
      if (H.e2e.falha) throw new Error('asaas fora do ar');
      return { endToEndIdentifier: H.e2e.valor };
    }
    throw new Error(`rota inesperada: ${path}`);
  }),
}));

import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';
import { criarPixRecorrente } from '../services/asaas/pixRecorrenteService';
import { dispararPurchasePixQuiz } from '../services/solardoc/purchasePixQuiz';
import { sendPurchaseForSale } from '../services/salesLedger';
import { avisarCompra } from '../services/solardoc/avisoGrupoSolardoc';
import { cancelStripeSubsForEmail } from '../services/dunningService';
import { getOrCreatePixUser } from '../services/agents/whatsapp/pixComprovanteService';
import { logger } from '../utils/logger';

const CONTRATO = 'SD-VIP-auto1';
const QR = 'QR-CONCILIACAO-1';
const E2E_ID = 'E1234567890123456789012345';
const E2E_CHAVE = 'pix_e2e:E12345678901234567890:19';

function contrato(over: Row = {}): Row {
  return {
    id: 'c1', user_id: null, email: 'cliente@teste.com', modo: 'automatico', asaas_customer_id: 'cus_contrato',
    authorization_id: 'auth-1', subscription_id: null, contract_id: CONTRATO,
    plano: 'ilimitado', valor: 67, primeiro_mes: 19, cupom: null,
    status: 'pendente', ultimo_pagamento_id: '', ultimo_pagamento_em: null, ...over,
  };
}

// A FORMA REAL de 25/10/2026: PAYMENT_RECEIVED sem nenhuma ligação com o contrato.
function recebido(id: string, over: Row = {}, pay: Row = {}): any {
  return {
    id, event: 'PAYMENT_RECEIVED',
    payment: {
      id: 'pay_imediato', value: 19, status: 'RECEIVED', billingType: 'PIX', customer: 'cus_outro',
      description: 'SolarDoc Ilimitado', pixQrCodeId: QR, pixTransaction: 'tx_1', externalReference: null, ...pay,
    },
    ...over,
  };
}

function ativado(id: string, over: Row = {}): any {
  return {
    id, event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    authorization: {
      id: 'auth-1', status: 'ACTIVE', value: 67, contractId: CONTRATO, customerId: 'cus_contrato',
      subscriptionId: 'sub_x', originType: 'IMMEDIATE_PAYMENT_AND_RECURRING_QR_CODE', startDate: '2026-11-25',
      endToEndIdentifier: 'E000', immediateQrCode: { conciliationIdentifier: QR, expirationDate: '2026-10-25T12:00:00Z' },
      ...over,
    },
  };
}

const qrSalvo = () => db.system_state.push({ key: `pix_auto_qr:${QR}`, value: { contract_id: CONTRATO, em: 'x' } });
const atribQuiz = () => db.system_state.push({
  key: `pix_auto_atrib:${CONTRATO}`,
  value: {
    origem: 'quiz_solardoc', whatsapp: '34999990000', nome: 'Maria da Silva', lp_session: 'sess-123',
    utm_source: 'FB', utm_medium: 'ads', utm_campaign: 'quiz|1', utm_content: 'c7', utm_term: 't', fbc: 'fb.1.123.abc', fbp: 'fb.1.456.def',
  },
});

beforeEach(() => {
  db.asaas_pix_assinaturas = [contrato()];
  db.asaas_webhook_events = [];
  db.system_state = [];
  db.users = [{ id: 'u1', email: 'cliente@teste.com', nome: 'Cliente', whatsapp: '34999990000', plano_expira_em: null, billing_status: 'free' }];
  H.emails.length = 0; H.whats.length = 0; H.vendas.length = 0; H.purchases.length = 0; H.quiz.length = 0;
  H.liberacoes.length = 0; H.chamadasAsaas.length = 0; H.bases.length = 0; H.falhaClaimAdesao.v = false;
  H.e2e.valor = E2E_ID; H.e2e.falha = false; H.autFalha.v = false;
  vi.mocked(dispararPurchasePixQuiz).mockClear();
  vi.mocked(sendPurchaseForSale).mockClear();
  vi.mocked(avisarCompra).mockClear();
  vi.mocked(cancelStripeSubsForEmail).mockClear();
  vi.mocked(getOrCreatePixUser).mockClear();
});

describe('Pix Automático com cobrança imediata: o pagamento acha o contrato pelo QR', () => {
  it('(1) RECEIVED antes do ACTIVATED, com pix_auto_qr gravado na criação: credita 1 vez', async () => {
    qrSalvo();
    const r = await processarWebhookAsaas(recebido('ev-1'));
    expect(r).toEqual({ tratado: true, motivo: 'pagamento creditado' });
    expect(H.liberacoes).toEqual(['u1']);
    expect(db.asaas_pix_assinaturas[0]).toMatchObject({ status: 'ativo', user_id: 'u1', ultimo_pagamento_id: 'pay_imediato' });
    expect(db.system_state.some((s) => s.key === `asaas_adesao:${CONTRATO}`)).toBe(true);

    // O ACTIVATED que vem depois só confirma a autorização: não credita de novo.
    await processarWebhookAsaas(ativado('ev-2'));
    expect(H.liberacoes).toHaveLength(1);
    expect(H.vendas).toHaveLength(1);
  });

  it('(2) RECEIVED sem pix_auto_qr: o ACTIVATED acha o pagamento no histórico e credita 1 vez', async () => {
    const r1 = await processarWebhookAsaas(recebido('ev-1'));
    expect(r1.tratado).toBe(false); // fora do trilho: ninguém ligou ainda
    expect(H.liberacoes).toHaveLength(0);
    expect(db.asaas_webhook_events).toHaveLength(1); // ficou guardado para o ACTIVATED achar

    const r2 = await processarWebhookAsaas(ativado('ev-2'));
    expect(r2.tratado).toBe(true);
    expect(H.liberacoes).toEqual(['u1']);
    expect(db.system_state.find((s) => s.key === `pix_auto_qr:${QR}`)?.value.contract_id).toBe(CONTRATO);
    expect(db.asaas_pix_assinaturas[0]).toMatchObject({ status: 'ativo', ultimo_pagamento_id: 'pay_imediato' });
  });

  it('(2b) ACTIVATED sem pagamento guardado só ativa; sem originType imediato não procura nada', async () => {
    await processarWebhookAsaas(ativado('ev-1'));
    expect(H.liberacoes).toHaveLength(0);
    expect(db.asaas_pix_assinaturas[0].status).toBe('ativo');
    await processarWebhookAsaas(recebido('ev-2')); // agora o RECEIVED acha pelo pix_auto_qr que o ACTIVATED gravou
    expect(H.liberacoes).toEqual(['u1']);
  });

  it('(3) reentrega dos dois eventos e CONFIRMED + RECEIVED do mesmo pagamento: credita 1 vez', async () => {
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect((await processarWebhookAsaas(recebido('ev-1'))).motivo).toBe('evento repetido');
    await processarWebhookAsaas(recebido('ev-1b', { event: 'PAYMENT_CONFIRMED' })); // outro evento, mesmo pagamento
    await processarWebhookAsaas(ativado('ev-2'));
    expect((await processarWebhookAsaas(ativado('ev-2'))).motivo).toBe('evento repetido');
    await processarWebhookAsaas(ativado('ev-2b')); // reentrega com outro id de evento
    expect(H.liberacoes).toHaveLength(1);
    expect(H.vendas).toHaveLength(1);
  });

  it('(3b) corrida: RECEIVED e ACTIVATED no mesmo instante creditam 1 vez', async () => {
    await processarWebhookAsaas(recebido('ev-1')); // sem ligação: fica guardado
    await Promise.all([processarWebhookAsaas(ativado('ev-2')), processarWebhookAsaas(recebido('ev-3', { event: 'PAYMENT_CONFIRMED' }))]);
    expect(H.liberacoes).toHaveLength(1);
  });

  it('(4) E2E já reservado pelo comprovante: não credita, só liga o contrato', async () => {
    qrSalvo();
    db.system_state.push({ key: E2E_CHAVE, value: { user_id: 'u1', valor: 19, at: 'x' } });
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.liberacoes).toHaveLength(0);
    expect(H.vendas).toHaveLength(0);
    expect(db.asaas_pix_assinaturas[0]).toMatchObject({ status: 'ativo', user_id: 'u1', ultimo_pagamento_id: 'pay_imediato' });
    expect(db.asaas_pix_assinaturas[0].ultimo_pagamento_em).toBeTruthy();
    expect(H.chamadasAsaas).toContain('/pix/transactions/tx_1');
  });

  it('(4b) credita e RESERVA o E2E com a mesma chave do comprovante (o comprovante depois não credita)', async () => {
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(db.system_state.find((s) => s.key === E2E_CHAVE)?.value.user_id).toBe('u1');
  });

  it('(4c) busca do E2E falhou: credita assim mesmo', async () => {
    qrSalvo();
    H.e2e.falha = true;
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.liberacoes).toEqual(['u1']);
  });

  it('(5) contrato sem usuário: cria a conta, credita e manda o e-mail; o link não vai a lugar nenhum público', async () => {
    db.users = [];
    qrSalvo();
    atribQuiz();
    const r = await processarWebhookAsaas(recebido('ev-1'));

    expect(H.liberacoes).toEqual(['u-novo']);
    expect(db.asaas_pix_assinaturas[0]).toMatchObject({ status: 'ativo', user_id: 'u-novo' });
    expect(H.emails).toHaveLength(1);
    expect(H.emails[0].to).toBe('cliente@teste.com');
    expect(H.emails[0].nome).toBe('Maria da Silva');
    expect(H.emails[0].acessoUrl).toMatch(/\/auth\?mode=redefinir&token=TOKEN-SECRETO-123$/);

    // O token só existe no e-mail: nem na resposta, nem no contrato, nem no system_state, nem no WhatsApp.
    const resto = JSON.stringify([r, db.asaas_pix_assinaturas, db.system_state, db.asaas_webhook_events, H.vendas, H.whats]);
    expect(resto).not.toContain('TOKEN-SECRETO-123');
  });

  it('(1b) o QR vence o customer: outra linha viva do mesmo customer não leva o pagamento', async () => {
    qrSalvo();
    db.asaas_pix_assinaturas.push(contrato({
      id: 'c-errado', contract_id: 'SD-VIP-outro', authorization_id: 'auth-outro', asaas_customer_id: 'cus_outro', user_id: 'u1',
    }));
    await processarWebhookAsaas(recebido('ev-1'));
    const certo = db.asaas_pix_assinaturas.find((l) => l.id === 'c1')!;
    const errado = db.asaas_pix_assinaturas.find((l) => l.id === 'c-errado')!;
    expect(certo).toMatchObject({ status: 'ativo', ultimo_pagamento_id: 'pay_imediato' });
    expect(errado).toMatchObject({ status: 'pendente', ultimo_pagamento_id: '' });
  });

  it('(5b) um aviso só ao Thiago por adesão; se o e-mail falhar, o MESMO aviso diz isso (nenhum envio extra)', async () => {
    db.users = [];
    qrSalvo();
    const { sendPixAutomaticoAcessoEmail } = await import('../utils/mailer');
    vi.mocked(sendPixAutomaticoAcessoEmail).mockRejectedValueOnce(new Error('resend fora'));
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('Nova assinatura');
    expect(H.whats[0]).toContain('Conta criada agora');
    expect(H.whats[0]).toContain('NÃO saiu');
    expect(H.whats[0]).not.toContain('TOKEN-SECRETO-123');
  });

  it('(5c) e-mail ok: um aviso só, sem a linha de falha; E2E já usado não manda WhatsApp nenhum', async () => {
    db.users = [];
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('Conta criada agora');
    expect(H.whats[0]).not.toContain('NÃO saiu');

    H.whats.length = 0;
    db.asaas_pix_assinaturas = [contrato()];
    db.system_state = [{ key: E2E_CHAVE, value: { user_id: 'u1' } }];
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-9', {}, { id: 'pay_outro' }));
    expect(H.whats).toHaveLength(0);
  });

  it('(6) quiz: chama dispararPurchasePixQuiz (com o E2E) e NÃO sendPurchaseForSale; a venda leva a atribuição', async () => {
    qrSalvo();
    atribQuiz();
    await processarWebhookAsaas(recebido('ev-1'));

    expect(dispararPurchasePixQuiz).toHaveBeenCalledTimes(1);
    expect(sendPurchaseForSale).not.toHaveBeenCalled();
    expect(H.quiz[0]).toMatchObject({ telefone: '34999990000', email: 'cliente@teste.com', valor: 19, chaveE2e: E2E_CHAVE, dedupKey: `asaas:${CONTRATO}` });

    expect(H.vendas).toHaveLength(1);
    expect(H.vendas[0]).toMatchObject({
      checkout_session_id: `asaas:${CONTRATO}`, valor: 19, phone: '34999990000', nome: 'Maria da Silva',
      attribution_session_id: 'sess-123', fbc: 'fb.1.123.abc', fbp: 'fb.1.456.def',
      utm_source: 'FB', utm_medium: 'ads', utm_campaign: 'quiz|1', utm_content: 'c7', utm_term: 't',
    });
  });

  it('(6b) quiz sem E2E: a chave do Purchase vira asaas:<contrato>', async () => {
    qrSalvo(); atribQuiz();
    H.e2e.valor = null;
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.quiz[0].chaveE2e).toBeNull();
    expect(H.quiz[0].dedupKey).toBe(`asaas:${CONTRATO}`);
  });

  it('(6c) contrato que não é do quiz: segue com sendPurchaseForSale, como antes', async () => {
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(dispararPurchasePixQuiz).not.toHaveBeenCalled();
    expect(sendPurchaseForSale).toHaveBeenCalledWith('sale-1');
  });

  it('(7) instrução mensal seguida de CONFIRMED: renova (e só uma vez, sem venda nova)', async () => {
    db.asaas_pix_assinaturas = [contrato({
      status: 'ativo', user_id: 'u1', ultimo_pagamento_id: 'pay_anterior', ultimo_pagamento_em: '2026-10-25T00:00:00Z',
    })];
    db.users[0].plano_expira_em = '2026-11-27T00:00:00Z';

    const ins = await processarWebhookAsaas({
      id: 'ev-i', event: 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED',
      paymentInstruction: { id: 'ins-1', status: 'SCHEDULED', dueDate: '2026-11-25', paymentId: 'pay_mensal', authorization: { id: 'auth-1' } },
    });
    expect(ins.tratado).toBe(true);
    expect(db.system_state.find((s) => s.key === 'pix_auto_pag:pay_mensal')?.value.authorization_id).toBe('auth-1');

    const mensal = (id: string, event: string) => ({
      id, event, payment: { id: 'pay_mensal', value: 67, status: 'CONFIRMED', billingType: 'PIX', customer: 'cus_outro', externalReference: null, dueDate: '2026-11-25' },
    });
    const r = await processarWebhookAsaas(mensal('ev-c', 'PAYMENT_CONFIRMED'));
    expect(r.motivo).toBe('pagamento creditado');
    await processarWebhookAsaas(mensal('ev-r', 'PAYMENT_RECEIVED'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.vendas).toHaveLength(0);
    expect(H.emails).toHaveLength(0);
    expect(db.asaas_pix_assinaturas[0].ultimo_pagamento_id).toBe('pay_mensal');
  });

  it('(7b) pagamento sem contrato, sem QR e sem instrução: continua fora do trilho', async () => {
    const r = await processarWebhookAsaas(recebido('ev-1', {}, { pixQrCodeId: 'desconhecido' }));
    expect(r).toEqual({ tratado: false, motivo: 'pagamento fora do trilho Pix recorrente' });
    expect(H.liberacoes).toHaveLength(0);
  });

  it('(8) assinatura Pix e pagamento já ligado continuam iguais: adesão 1 vez, depois renovação', async () => {
    db.asaas_pix_assinaturas = [contrato({ modo: 'assinatura', authorization_id: null, subscription_id: 'sub_9', user_id: 'u1', primeiro_mes: 67 })];
    const pag = (id: string, ev: string, pid: string) => ({
      id, event: 'PAYMENT_CONFIRMED',
      payment: { id: pid, value: 67, subscription: 'sub_9', externalReference: CONTRATO, dueDate: '2026-11-25' },
    } as any);
    await processarWebhookAsaas(pag('ev-1', 'x', 'pay_a'));
    expect(H.vendas).toHaveLength(1);
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.chamadasAsaas.some((p) => p.startsWith('/pix/transactions/'))).toBe(false); // sem pixTransaction, sem busca de E2E
    expect(sendPurchaseForSale).toHaveBeenCalledTimes(1);

    await processarWebhookAsaas(pag('ev-2', 'x', 'pay_b')); // mês seguinte
    expect(H.liberacoes).toHaveLength(2);
    expect(H.vendas).toHaveLength(1); // renovação não vira venda
  });

  it('(8b) contrato antigo já ativo, sem a chave de adesão: o próximo pagamento é renovação', async () => {
    db.asaas_pix_assinaturas = [contrato({
      user_id: 'u1', status: 'ativo', ultimo_pagamento_id: 'pay_velho', ultimo_pagamento_em: '2026-09-01T00:00:00Z',
    })];
    await processarWebhookAsaas({
      id: 'ev-1', event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_novo', value: 67, externalReference: CONTRATO, dueDate: '2026-10-25' },
    });
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.vendas).toHaveLength(0);
    expect(db.system_state.some((s) => s.key.startsWith('asaas_adesao:'))).toBe(false);
  });
});

describe('renovação nunca vira adesão; efeitos de adesão só onde cabe', () => {
  // O estado REAL do contrato de 25/10: quem creditou foi o comprovante, o webhook nunca viu o pagamento.
  const contratoReal = () => contrato({ status: 'ativo', user_id: 'u1', ultimo_pagamento_id: '', ultimo_pagamento_em: null });
  const BASE_SEM_FOLGA = '2026-11-20T00:00:00.000Z'; // 27/11 menos os 7 dias de folga já somados

  function mensal(over: Row = {}, pay: Row = {}): any {
    return {
      id: 'ev-mensal', event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_mensal', value: 67, status: 'CONFIRMED', billingType: 'PIX', customer: 'cus_outro', externalReference: null, dueDate: '2026-11-25', ...pay },
      ...over,
    };
  }
  function semEfeitosDeAdesao() {
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.bases).toEqual([BASE_SEM_FOLGA]); // renovação desconta a folga anterior; adesão não
    expect(H.vendas).toHaveLength(0);
    expect(H.purchases).toHaveLength(0);
    expect(H.quiz).toHaveLength(0);
    expect(avisarCompra).not.toHaveBeenCalled();
    expect(cancelStripeSubsForEmail).not.toHaveBeenCalled();
    expect(db.system_state.some((x) => x.key.startsWith('asaas_adesao:'))).toBe(false);
    expect(H.whats.join('\n')).toContain('Renovação');
    expect(H.whats.join('\n')).not.toContain('Nova assinatura');
  }
  beforeEach(() => {
    db.asaas_pix_assinaturas = [contratoReal()];
    db.users[0].plano_expira_em = '2026-11-27T00:00:00Z';
    db.users[0].billing_status = 'active';
    atribQuiz(); // até um contrato do quiz: o mês 2 não manda Purchase
  });

  it('(9a) débito do mês 2 achado pela AUTORIZAÇÃO: renova', async () => {
    await processarWebhookAsaas(mensal({ authorization: { id: 'auth-1' } }));
    semEfeitosDeAdesao();
  });

  it('(9b) débito do mês 2 achado pelo CUSTOMER: renova', async () => {
    await processarWebhookAsaas(mensal({}, { customer: 'cus_contrato' }));
    semEfeitosDeAdesao();
  });

  it('(9c) débito do mês 2 achado pela INSTRUÇÃO: renova', async () => {
    await processarWebhookAsaas({
      id: 'ev-i', event: 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED',
      paymentInstruction: { id: 'ins-1', paymentId: 'pay_mensal', authorization: { id: 'auth-1' } },
    });
    await processarWebhookAsaas(mensal());
    semEfeitosDeAdesao();
  });

  it('(9d) contrato PENDENTE + instrução: renovação (a instrução vem antes do acharContrato e vence o status)', async () => {
    db.asaas_pix_assinaturas = [contrato({ user_id: 'u1' })]; // pendente
    db.system_state.push({ key: 'pix_auto_pag:pay_mensal', value: { authorization_id: 'auth-1' } });
    await processarWebhookAsaas(mensal({}, { customer: 'cus_contrato' }));
    expect(db.system_state.some((x) => x.key.startsWith('asaas_adesao:'))).toBe(false);
    expect(H.vendas).toHaveLength(0);
    expect(avisarCompra).not.toHaveBeenCalled();
    expect(cancelStripeSubsForEmail).not.toHaveBeenCalled();
  });

  it('(9e) os casos 1 e 2 (QR imediato) CONTINUAM virando adesão, mesmo com o contrato já ativo e sem pagamento', async () => {
    db.asaas_pix_assinaturas = [contrato({ status: 'ativo', user_id: 'u1' })]; // ativo por causa do ACTIVATED, nunca pagou
    db.users[0].billing_status = 'free';
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(db.system_state.some((x) => x.key === `asaas_adesao:${CONTRATO}`)).toBe(true);
    expect(H.vendas).toHaveLength(1);
    expect(avisarCompra).toHaveBeenCalledTimes(1);
    expect(H.quiz).toHaveLength(1);

    // caso 2: pela busca retroativa do ACTIVATED
    db.asaas_pix_assinaturas = [contrato()];
    db.system_state = [];
    db.asaas_webhook_events = [];
    H.vendas.length = 0; H.liberacoes.length = 0;
    atribQuiz();
    await processarWebhookAsaas(recebido('ev-10', {}, { id: 'pay_b' }));
    await processarWebhookAsaas(ativado('ev-11'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.vendas).toHaveLength(1);
    expect(db.system_state.some((x) => x.key === `asaas_adesao:${CONTRATO}`)).toBe(true);
  });

  it('(10) contrato SEM user_id: não cancela cartão na Stripe; o aviso único traz a linha de conferir à mão', async () => {
    db.asaas_pix_assinaturas = [contrato()]; // pendente, user_id null; o e-mail do contrato tem conta com cartão ativo
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(cancelStripeSubsForEmail).not.toHaveBeenCalled();
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('conferir à mão');
    expect(H.whats[0]).not.toContain('Cartão na Stripe');
  });

  it('(10b) contrato COM user_id continua cancelando o cartão (comportamento de sempre)', async () => {
    db.asaas_pix_assinaturas = [contrato({ user_id: 'u1' })];
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(cancelStripeSubsForEmail).toHaveBeenCalledWith('cliente@teste.com');
  });

  it('(10c) rota PÚBLICA com e-mail de conta existente que tem cartão: user_id gravado, mas NÃO cancela e avisa', async () => {
    db.asaas_pix_assinaturas = [contrato({ user_id: 'u1' })]; // a rota pública grava o user_id do e-mail digitado
    db.users[0].billing_status = 'active';
    qrSalvo();
    db.system_state = db.system_state.filter((x) => !x.key.startsWith('pix_auto_atrib:')); // troca a atribuição do quiz
    db.system_state.push({ key: `pix_auto_atrib:${CONTRATO}`, value: { rota: 'publica' } }); // fora do quiz, sem origem
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(cancelStripeSubsForEmail).not.toHaveBeenCalled();
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('Pix pela página pública com e-mail que tem cartão ativo na Stripe; conferir à mão');
    expect(H.whats[0]).not.toContain('Cartão na Stripe:');
  });

  it('(10d) rota LOGADA (sem rota na atribuição) com cartão: cancela como sempre', async () => {
    db.asaas_pix_assinaturas = [contrato({ user_id: 'u1' })];
    db.users[0].billing_status = 'active';
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(cancelStripeSubsForEmail).toHaveBeenCalledWith('cliente@teste.com');
    expect(H.whats.join(' ')).not.toContain('página pública');
  });

  it('(11) claim de adesão que dá ERRO: credita como renovação, sem efeitos de adesão, e registra no log', async () => {
    H.falhaClaimAdesao.v = true;
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    qrSalvo();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.vendas).toHaveLength(0);
    expect(H.quiz).toHaveLength(0);
    expect(avisarCompra).not.toHaveBeenCalled();
    expect(cancelStripeSubsForEmail).not.toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[1]).includes('claim de adesão falhou'))).toBe(true);
    log.mockRestore();
  });

  it('(12) conta nova nasce com whatsappSoSeLivre, para não sobrescrever o WhatsApp de conta existente', async () => {
    db.users = [];
    db.asaas_pix_assinaturas = [contrato()];
    db.system_state = [];
    qrSalvo(); atribQuiz();
    await processarWebhookAsaas(recebido('ev-1'));
    expect(getOrCreatePixUser).toHaveBeenCalledWith('cliente@teste.com', 'Maria da Silva', '34999990000', { whatsappSoSeLivre: true });
  });
});


describe('criarPixRecorrente: grava a ligação e a atribuição', () => {
  const args = {
    userId: 'u-cria', email: 'novo@teste.com', nome: 'Novo', cpfCnpj: '12345678909', whatsapp: '34999990000', planKey: 'ilimitado',
  };

  it('guarda pix_auto_qr (conciliationIdentifier) e pix_auto_atrib (só campos conhecidos, aparados)', async () => {
    db.asaas_pix_assinaturas = [];
    const r = await criarPixRecorrente({
      ...args, exigirAutomatico: true,
      atribuicao: { origem: 'quiz_solardoc', whatsapp: ' 34999990000 ', lp_session: 'sess-9', fbc: 'fb.1.2.3', ...({ lixo: 'x' } as any) },
    });
    expect(r.modo).toBe('automatico');
    const qr = db.system_state.find((s) => s.key === 'pix_auto_qr:QRCRIADO1');
    expect(qr?.value.contract_id).toBe(r.contractId);
    const atr = db.system_state.find((s) => s.key === `pix_auto_atrib:${r.contractId}`);
    expect(atr?.value).toEqual({ origem: 'quiz_solardoc', whatsapp: '34999990000', lp_session: 'sess-9', fbc: 'fb.1.2.3' });
  });

  it('exigirAutomatico: se a autorização falha, devolve erro e NÃO cai pra assinatura', async () => {
    db.asaas_pix_assinaturas = [];
    H.autFalha.v = true;
    await expect(criarPixRecorrente({ ...args, exigirAutomatico: true })).rejects.toMatchObject({ statusCode: 502 });
    expect(H.chamadasAsaas.some((p) => p.startsWith('/subscriptions'))).toBe(false);
    expect(db.asaas_pix_assinaturas).toHaveLength(0);
  });
});
