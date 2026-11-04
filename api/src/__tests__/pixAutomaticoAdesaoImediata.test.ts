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
    asaas_pix_assinaturas: [], asaas_webhook_events: [], users: [], system_state: [], sales: [{ id: 'sale-1' }],
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
  let modo: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
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
    if (modo === 'delete') {
      const alvos = linhas();
      db[table] = db[table].filter((r) => !alvos.includes(r));
      return { data: null, error: null };
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
    delete: () => { modo = 'delete'; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(H.caminho(r, c)) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    filter: (c: string, op: string, v: string) => { filtros.push((r) => op === 'gte' ? String(H.caminho(r, c)) >= String(v) : String(H.caminho(r, c)) === String(v)); return q; },
    like: (c: string, p: string) => { const pre = p.replace('%', ''); filtros.push((r) => String(r[c]).startsWith(pre)); return q; },
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
vi.mock('../services/solardoc/purchasePixQuiz', async () => {
  const { createHash } = await import('crypto');
  return {
    dispararPurchasePixQuiz: vi.fn(async (e: any) => { H.quiz.push(e); return 'enviado'; }),
    // Mesma fórmula do original (sem carregar o módulo, que puxa o resto do quiz).
    idDoEventoPix: (chave: string) => 'pix_' + createHash('sha256').update(chave, 'utf8').digest('hex').slice(0, 32),
    PREFIXO_CLAIM_PURCHASE_PIX: 'meta_purchase_pix:',
  };
});
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
import { dispararPurchasePixQuiz, idDoEventoPix } from '../services/solardoc/purchasePixQuiz';
import { sendPurchaseForSale } from '../services/salesLedger';
import { avisarCompra } from '../services/solardoc/avisoGrupoSolardoc';
import { cancelStripeSubsForEmail } from '../services/dunningService';
import { getOrCreatePixUser, liberarAcessoPix } from '../services/agents/whatsapp/pixComprovanteService';
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
  db.sales = [{ id: 'sale-1' }];
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

  // 29/10/2026: o comprovante do WhatsApp já creditou este usuário e mandou o Purchase pix_<hash>; a adesão não manda outro.
  const E2E_COMPR = 'pix_e2e:E9999999999999999999999:67';
  const comprovanteDe = (over: Row = {}) => ({
    key: 'pix_comprov:5534999990000:67:2026-10-29',
    value: { user_id: 'u1', valor: 67, e2e: E2E_COMPR, at: new Date().toISOString(), ...over },
  });
  // O registro do comprovante nasce antes do envio ao Meta; só vale se o claim do Purchase está 'enviado'.
  const claimDoComprovante = (estado: string, chave: string = E2E_COMPR) =>
    db.system_state.push({ key: `meta_purchase_pix:${idDoEventoPix(chave)}`, value: { estado, em: new Date().toISOString() } });
  it('(6d) comprovante de R$ 67 do mesmo usuário nas últimas 48 h com Purchase ENVIADO: não manda de novo e marca a venda como duplicada', async () => {
    qrSalvo();
    db.system_state.push(comprovanteDe());
    claimDoComprovante('enviado');
    await processarWebhookAsaas(recebido('ev-1'));
    expect(sendPurchaseForSale).not.toHaveBeenCalled();
    expect(dispararPurchasePixQuiz).not.toHaveBeenCalled();
    expect(db.sales[0]).toMatchObject({ meta_response_ok: true, meta_skip_motivo: 'duplicada' });
  });
  it('(6d2) comprovante sem E2E: o id vem da chave do próprio registro (dedupKey) e também vale', async () => {
    qrSalvo();
    const c = comprovanteDe({ e2e: null });
    db.system_state.push(c);
    claimDoComprovante('enviado', c.key);
    await processarWebhookAsaas(recebido('ev-1'));
    expect(sendPurchaseForSale).not.toHaveBeenCalled();
    expect(db.sales[0]).toMatchObject({ meta_skip_motivo: 'duplicada' });
  });
  it('(6d3) comprovante cujo Purchase FALHOU (ou ficou novo, ou sem claim): a adesão manda, senão a venda fica sem Purchase', async () => {
    for (const estado of ['falhou', 'novo', null]) {
      vi.mocked(sendPurchaseForSale).mockClear();
      db.system_state = [];
      qrSalvo();
      db.asaas_pix_assinaturas = [contrato()];
      db.asaas_webhook_events = [];
      db.system_state.push(comprovanteDe());
      if (estado) claimDoComprovante(estado);
      await processarWebhookAsaas(recebido(`ev-${estado}`));
      expect(sendPurchaseForSale, String(estado)).toHaveBeenCalledWith('sale-1');
    }
  });
  it('(6e) o mesmo vale no quiz', async () => {
    qrSalvo(); atribQuiz();
    db.system_state.push(comprovanteDe());
    claimDoComprovante('enviado');
    await processarWebhookAsaas(recebido('ev-1'));
    expect(dispararPurchasePixQuiz).not.toHaveBeenCalled();
    expect(db.sales[0]).toMatchObject({ meta_skip_motivo: 'duplicada' });
  });
  it('(6f) comprovante de 3 dias atrás, parcial de R$ 27 ou de outro usuário não conta: manda', async () => {
    qrSalvo();
    claimDoComprovante('enviado');
    db.system_state.push(
      comprovanteDe({ at: new Date(Date.now() - 72 * 3600_000).toISOString() }),
      { ...comprovanteDe({ valor: 27 }), key: 'pix_comprov:x:27:1' },
      { ...comprovanteDe({ user_id: 'u2' }), key: 'pix_comprov:y:67:1' },
    );
    await processarWebhookAsaas(recebido('ev-1'));
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

describe('Pix automático: o E2E do pagamento fica gravado também na RENOVAÇÃO', () => {
  it('débito do mês seguinte (contrato ativo) grava pix_e2e, então o comprovante do mesmo Pix não credita outro mês', async () => {
    db.asaas_pix_assinaturas = [contrato({ status: 'ativo', user_id: 'u1', ultimo_pagamento_id: 'pay_antigo' })];
    const r = await processarWebhookAsaas(recebido('ev-ren', {}, { id: 'pay_renov', customer: 'cus_contrato', pixQrCodeId: null }));
    expect(r.tratado).toBe(true);
    expect(H.liberacoes).toEqual(['u1']);
    const chave = chaveE2eFalso();
    expect(db.system_state.some((x) => x.key === chave)).toBe(true);
  });
});

function chaveE2eFalso(): string {
  return `pix_e2e:${E2E_ID.slice(0, 21).toUpperCase()}:19`;
}

describe('Aviso ao Thiago: Pix Automático recusado x QR vencido', () => {
  const evento = (tipo: string, auth: Row = {}): any => ({
    id: `ev-${tipo}-${Math.random()}`, event: `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_${tipo}`,
    authorization: { id: 'auth-1', contractId: CONTRATO, ...auth },
  });

  it('REFUSED sem motivo (cancellationReason nulo ou vazio): texto de QR vencido, status segue recusado', async () => {
    for (const cancellationReason of [null, undefined, '  ']) {
      H.whats.length = 0;
      db.asaas_pix_assinaturas = [contrato()];
      const r = await processarWebhookAsaas(evento('REFUSED', { cancellationReason }));
      expect(r.tratado).toBe(true);
      expect(db.asaas_pix_assinaturas[0].status).toBe('recusado');
      expect(H.whats).toHaveLength(1);
      const linhas = H.whats[0].split('\n');
      expect(linhas[0]).toBe('⏳ *Pix automático venceu sem pagamento*');
      expect(linhas[1]).toContain('cliente@teste.com');
      expect(linhas[1]).toContain('R$ 67');
      expect(linhas[2]).toBe('A pessoa gerou o código e não pagou dentro de 1 hora.');
      expect(linhas).toHaveLength(3);
    }
  });

  it('REFUSED com motivo: texto de hoje', async () => {
    const r = await processarWebhookAsaas(evento('REFUSED', { cancellationReason: 'USER_DECLINED' }));
    expect(r.tratado).toBe(true);
    expect(db.asaas_pix_assinaturas[0].status).toBe('recusado');
    expect(H.whats[0]).toContain('⚠️ *Pix Automático recusado*');
    expect(H.whats[0]).toContain('Não haverá mais débito automático');
    expect(H.whats[0]).not.toContain('venceu sem pagamento');
  });

  it('CANCELLED e EXPIRED ficam com o texto de hoje, mesmo sem motivo', async () => {
    await processarWebhookAsaas(evento('CANCELLED'));
    expect(db.asaas_pix_assinaturas[0].status).toBe('cancelado');
    expect(H.whats[0]).toContain('⚠️ *Pix Automático cancelado*');
    H.whats.length = 0;
    db.asaas_pix_assinaturas = [contrato()];
    await processarWebhookAsaas(evento('EXPIRED'));
    expect(db.asaas_pix_assinaturas[0].status).toBe('expirado');
    expect(H.whats[0]).toContain('⚠️ *Pix Automático expirado*');
    expect(H.whats[0]).not.toContain('venceu sem pagamento');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIX AVULSO DO FUNIL (QR estático de R$ 67, sem CPF): o pagamento acha o checkout por payment.pixQrCodeId.
// ─────────────────────────────────────────────────────────────────────────────
describe('Pix avulso do funil: webhook', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  const QR_AV = 'QR-AVULSO-1';

  const checkout = (over: Row = {}, atrib: Row = {}) => {
    db.system_state.push({
      key: `pix_avulso:${ID}`,
      value: {
        status: 'pendente', qrId: QR_AV, email: 'cliente@teste.com', whatsapp: '34999990000', nome: 'Maria da Silva',
        origem: 'lp_solardoc', criado_em: 'x', expira_em: new Date(Date.now() + 3600_000).toISOString(),
        atrib: {
          rota: 'publica', origem: 'lp_solardoc', whatsapp: '34999990000', lp_session: 'sess-lp', utm_source: 'fb', utm_campaign: '123',
          utm_term: '120000000001', fbc: 'fb.1.123.abc', fbp: 'fb.1.456.def', ...atrib,
        },
        ...over,
      },
    });
    db.system_state.push({ key: `pix_avulso_qr:${QR_AV}`, value: { id: ID, em: 'x' } });
  };
  const pagamento = (evento: string, over: Row = {}, id = 'pay_av'): any => ({
    id: `ev-${evento}-${id}-${Math.random()}`, event: evento,
    payment: {
      id, value: 67, status: 'RECEIVED', billingType: 'PIX', customer: 'cus_avulso', pixQrCodeId: QR_AV, pixTransaction: 'tx_av',
      externalReference: `sdav:${ID}`, ...over,
    },
  });
  const estado = () => db.system_state.find((s) => s.key === `pix_avulso:${ID}`)!.value;
  // Conta que já tem senha não recebe link; os testes de 'sem senha' zeram isto.
  beforeEach(() => { db.users[0].password_hash = 'hash'; });

  it('CONFIRMED e depois RECEIVED do mesmo pagamento: libera 1 vez, 1 venda, 1 aviso; a tela vira pago', async () => {
    checkout();
    const r1 = await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    const r2 = await processarWebhookAsaas(pagamento('PAYMENT_RECEIVED'));
    expect(r1).toEqual({ tratado: true, motivo: 'pagamento avulso creditado' });
    expect(r2.tratado).toBe(true);
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.vendas).toHaveLength(1);
    expect(H.whats.filter((w) => w.includes('Nova assinatura no Pix (código)'))).toHaveLength(1);
    expect(H.whats[0]).toContain('cliente@teste.com');
    expect(estado()).toMatchObject({ status: 'pago', payment_id: 'pay_av' });
    expect(estado().pago_em).toBeTruthy();
    expect(avisarCompra).toHaveBeenCalledTimes(1);
    // o contrato do automático nem foi tocado
    expect(db.asaas_pix_assinaturas[0]).toMatchObject({ status: 'pendente', ultimo_pagamento_id: '' });
  });

  it('LP: a venda grava utm_term, sessão, fbc e fbp; o Purchase sai por sendPurchaseForSale (não pelo pixel do quiz)', async () => {
    checkout();
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    expect(H.vendas[0]).toMatchObject({
      checkout_session_id: `asaas_avulso:${ID}`, email: 'cliente@teste.com', phone: '34999990000', plano: 'ilimitado', valor: 67, status: 'paid',
      utm_source: 'fb', utm_campaign: '123', utm_term: '120000000001', attribution_session_id: 'sess-lp', fbc: 'fb.1.123.abc', fbp: 'fb.1.456.def',
    });
    expect(H.vendas[0].produto).toContain('Pix por código');
    expect(sendPurchaseForSale).toHaveBeenCalledTimes(1);
    expect(dispararPurchasePixQuiz).not.toHaveBeenCalled();
    expect(vi.mocked(avisarCompra).mock.calls[0][0]).toMatchObject({ canal: 'asaas', origemQuiz: false, lpSession: 'sess-lp' });
  });

  it('quiz: o Purchase sai pelo pixel do quiz (não por sendPurchaseForSale)', async () => {
    checkout({ origem: 'quiz_solardoc' }, { origem: 'quiz_solardoc' });
    await processarWebhookAsaas(pagamento('PAYMENT_RECEIVED'));
    expect(dispararPurchasePixQuiz).toHaveBeenCalledTimes(1);
    expect(sendPurchaseForSale).not.toHaveBeenCalled();
    expect(vi.mocked(dispararPurchasePixQuiz).mock.calls[0][0]).toMatchObject({ valor: 67, email: 'cliente@teste.com', dedupKey: `asaas_avulso:${ID}` });
    expect(H.vendas[0].utm_term).toBe('120000000001');
    expect(vi.mocked(avisarCompra).mock.calls[0][0]).toMatchObject({ origemQuiz: true });
  });

  it('o mesmo Pix (E2E) em outro pagamento não credita de novo; a tela continua pago', async () => {
    checkout();
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED', {}, 'pay_av'));
    expect(H.liberacoes).toHaveLength(1);
    expect(db.system_state.some((s) => String(s.key).startsWith('pix_e2e:'))).toBe(true);
    // Outro payment.id com o mesmo E2E (o comprovante do WhatsApp, ou reemissão): barrado pela chave do E2E.
    const r = await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED', {}, 'pay_av_outro'));
    expect(r.motivo).toBe('pagamento avulso já creditado pelo comprovante');
    expect(H.liberacoes).toHaveLength(1);
    expect(H.vendas).toHaveLength(1);
    expect(estado().status).toBe('pago');
  });

  it('comprovante do WhatsApp chegou ANTES: não credita, mas marca a tela como paga', async () => {
    checkout();
    db.system_state.push({ key: chaveE2eMock(), value: { user_id: 'u1', valor: 67, at: 'x' } });
    const r = await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    expect(r.motivo).toBe('pagamento avulso já creditado pelo comprovante');
    expect(H.liberacoes).toHaveLength(0);
    expect(H.vendas).toHaveLength(0);
    expect(estado()).toMatchObject({ status: 'pago', via: 'comprovante' });
  });

  it('pagamento sem pixQrCodeId mas com externalReference sdav:<uuid>: acha o checkout assim mesmo', async () => {
    checkout();
    const r = await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED', { pixQrCodeId: null }));
    expect(r.motivo).toBe('pagamento avulso creditado');
    expect(H.liberacoes).toEqual(['u1']);
    expect(estado().status).toBe('pago');
  });

  it('valor menor que R$ 67: não libera, avisa o Thiago e grava valor_menor', async () => {
    checkout();
    const r = await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED', { value: 27 }));
    expect(r.motivo).toBe('pagamento avulso com valor menor');
    expect(H.liberacoes).toHaveLength(0);
    expect(H.vendas).toHaveLength(0);
    expect(estado().status).toBe('valor_menor');
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('valor menor');
    expect(H.whats[0]).toContain('27');
  });

  it('o pagador com o customer de um contrato antigo NÃO credita o contrato', async () => {
    checkout();
    db.asaas_pix_assinaturas = [contrato({ asaas_customer_id: 'cus_contrato', status: 'pendente' })];
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED', { customer: 'cus_contrato' }));
    expect(db.asaas_pix_assinaturas[0]).toMatchObject({ status: 'pendente', ultimo_pagamento_id: '' });
    expect(H.vendas.map((v) => v.checkout_session_id)).toEqual([`asaas_avulso:${ID}`]);
    expect(estado().status).toBe('pago');
  });

  it('conta nova: cria pendente, o link de senha vai só por e-mail (texto avulso) e não vaza', async () => {
    db.users = [];
    checkout({ email: 'novo@teste.com' });
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    expect(H.liberacoes).toEqual(['u-novo']);
    expect(H.emails).toHaveLength(1);
    expect(H.emails[0]).toMatchObject({ to: 'novo@teste.com', avulso: true });
    expect(H.emails[0].acessoUrl).toMatch(/\/auth\?mode=redefinir&token=TOKEN-SECRETO-123$/);
    expect(H.whats[0]).toContain('Conta criada agora');
    const resto = JSON.stringify([db.system_state, db.asaas_webhook_events, H.vendas, H.whats]);
    expect(resto).not.toContain('TOKEN-SECRETO-123');
  });

  it('Pix com QR que não casa com nada: avisa o Thiago 1 vez só (CONFIRMED e RECEIVED)', async () => {
    const solto = (evento: string) => pagamento(evento, { pixQrCodeId: 'QR-DESCONHECIDO', customer: 'cus_zzz', externalReference: null }, 'pay_solto');
    const r1 = await processarWebhookAsaas(solto('PAYMENT_CONFIRMED'));
    const r2 = await processarWebhookAsaas(solto('PAYMENT_RECEIVED'));
    expect(r1.tratado).toBe(false);
    expect(r2.tratado).toBe(false);
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toBe('⚠️ *Pix recebido sem dono*\nR$ 67 · pagamento pay_solto\nConfira no Asaas e libere na mão.');
    expect(H.liberacoes).toHaveLength(0);
  });

  it('[1] externalReference sdav: com pixQrCodeId DIFERENTE do QR do checkout: sem dono, não credita', async () => {
    checkout();
    const p = (evento: string) => pagamento(evento, { pixQrCodeId: 'QR-OUTRO' });
    const r1 = await processarWebhookAsaas(p('PAYMENT_CONFIRMED'));
    await processarWebhookAsaas(p('PAYMENT_RECEIVED'));
    expect(r1).toEqual({ tratado: false, motivo: 'QR do pagamento não é o do checkout avulso' });
    expect(H.liberacoes).toHaveLength(0);
    expect(H.vendas).toHaveLength(0);
    expect(estado().status).toBe('pendente');
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('Pix recebido sem dono');
  });

  it('[2] checkout não encontrado: avisa o Thiago 1 vez só (CONFIRMED e RECEIVED), pela chave pix_sem_dono', async () => {
    const p = (evento: string) => pagamento(evento, { pixQrCodeId: null });
    const r1 = await processarWebhookAsaas(p('PAYMENT_CONFIRMED'));
    await processarWebhookAsaas(p('PAYMENT_RECEIVED'));
    expect(r1.motivo).toBe('checkout avulso não encontrado');
    expect(H.whats).toHaveLength(1);
    expect(H.whats[0]).toContain('Pix recebido sem dono');
    expect(db.system_state.some((s) => s.key === 'pix_sem_dono:pay_av')).toBe(true);
  });

  it('[3] erro antes de liberar solta o claim: o RECEIVED seguinte tenta de novo e credita 1 vez', async () => {
    checkout();
    vi.mocked(liberarAcessoPix).mockRejectedValueOnce(new Error('banco fora'));
    await expect(processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'))).rejects.toThrow('banco fora');
    expect(db.system_state.some((s) => s.key === 'pix_avulso_pag:pay_av')).toBe(false);
    expect(db.system_state.some((s) => String(s.key).startsWith('pix_e2e:'))).toBe(false); // a reserva do E2E também foi solta
    expect(H.liberacoes).toHaveLength(0);
    const r = await processarWebhookAsaas(pagamento('PAYMENT_RECEIVED'));
    expect(r.motivo).toBe('pagamento avulso creditado');
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.vendas).toHaveLength(1);
    expect(db.system_state.some((s) => s.key === 'pix_avulso_pag:pay_av')).toBe(true);
    // e um terceiro evento do mesmo pagamento não credita de novo
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    expect(H.liberacoes).toHaveLength(1);
  });

  it('[5] conta que existe mas nunca definiu senha recebe o link por e-mail (só no avulso); com senha, não', async () => {
    db.users[0].password_hash = null;
    checkout();
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.emails).toHaveLength(1);
    expect(H.emails[0]).toMatchObject({ to: 'cliente@teste.com', avulso: true });
    const token = db.users[0].reset_token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(H.emails[0].acessoUrl.endsWith(`/auth?mode=redefinir&token=${token}`)).toBe(true);
    expect(H.whats[0]).toContain('Conta existente sem senha');
    expect(JSON.stringify([db.system_state, db.asaas_webhook_events, H.vendas, H.whats])).not.toContain(token);
  });

  it('[5] conta com senha: nenhum e-mail de senha', async () => {
    checkout();
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED'));
    expect(H.liberacoes).toEqual(['u1']);
    expect(H.emails).toHaveLength(0);
    expect(db.users[0].reset_token).toBeUndefined();
  });

  it('sem pixQrCodeId (cartão, boleto) não dispara o aviso de Pix sem dono', async () => {
    await processarWebhookAsaas(pagamento('PAYMENT_CONFIRMED', { pixQrCodeId: null, externalReference: null, billingType: 'CREDIT_CARD', customer: 'cus_zzz' }, 'pay_cartao'));
    expect(H.whats).toHaveLength(0);
  });
});

function chaveE2eMock(): string {
  // Mesma chave que o mock de chaveE2e monta para o E2E_ID de R$ 67.
  return `pix_e2e:${E2E_ID.slice(0, 21).toUpperCase()}:67`;
}
