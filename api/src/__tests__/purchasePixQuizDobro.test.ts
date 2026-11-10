import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE EM DOBRO DO PIX DO QUIZ (09/11/2026).
//
// O Pix do quiz (automático e por código) mandava o Purchase duas vezes: na hora do pagamento pelo pixel do quiz
// (`pix_<hash>`) e, de 30 a 300 min depois, pelo re-drive horário (`reDrivePendingPurchases` -> `sendPurchaseForSale`,
// event_id `asaas:<contrato>`), porque a linha de `sales` seguia com meta_response_ok = false.
// Agora o id `pix_<hash>` vai na linha já no upsert, o envio bem-sucedido fecha a linha, e o re-drive confere o claim
// `meta_purchase_pix:`, espera o envio em andamento (claim `novo` com menos de 2 min) e, quando manda, usa o MESMO id.
//
// O salesLedger e o webhook do Asaas são os REAIS; só o banco (em memória), o Meta e os vizinhos são falsos.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  asaas_pix_assinaturas: [], asaas_webhook_events: [], users: [], system_state: [], sales: [],
};

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
  let pendente: Row | null = null;
  let conflito = '';
  const tab = () => (db[table] ??= []);
  const linhas = () => tab().filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'insert') {
      const unico = table === 'system_state' ? 'key' : table === 'asaas_webhook_events' ? 'event_id' : null;
      if (unico && tab().some((r) => r[unico] === pendente![unico])) {
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      tab().push({ ...pendente });
      return { data: pendente, error: null };
    }
    if (modo === 'upsert') {
      const existente = tab().find((r) => r[conflito] === pendente![conflito]);
      if (existente) { Object.assign(existente, pendente); return { data: { ...existente }, error: null }; }
      const nova = table === 'sales'
        ? { id: `sale-${tab().length + 1}`, meta_response_ok: false, meta_attempts: 0, ...pendente }
        : { ...pendente };
      tab().push(nova);
      return { data: { ...nova }, error: null };
    }
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos.map((r) => ({ ...r })), error: null };
    }
    if (modo === 'delete') {
      const fora = new Set(linhas());
      db[table] = tab().filter((r) => !fora.has(r));
      return { data: null, error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }
  const um = async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; };
  const metodos: Record<string, (...a: any[]) => any> = {
    select: () => q,
    insert: (r: Row) => { modo = 'insert'; pendente = r; return q; },
    upsert: (r: Row, o?: { onConflict?: string }) => { modo = 'upsert'; pendente = r; conflito = o?.onConflict ?? 'id'; return q; },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    is: (c: string, v: any) => { filtros.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    gte: (c: string, v: any) => { filtros.push((r) => r[c] != null && new Date(r[c]).getTime() >= new Date(v).getTime()); return q; },
    lt: (c: string, v: any) => { filtros.push((r) => r[c] != null && Number(r[c]) < Number(v)); return q; },
    or: (expr: string) => {
      const termos = expr.split(',').map((t) => t.split('.'));
      filtros.push((r) => termos.some(([c, op, v]) => (op === 'is' && v === 'null' ? r[c] == null : op === 'lt' ? r[c] != null && Number(r[c]) < Number(v) : false)));
      return q;
    },
    maybeSingle: um,
    single: async () => { const r = await um(); return r.data ? r : { data: null, error: new Error('sem linha') }; },
    then: (res: (v: any) => void, rej?: (e: any) => void) => Promise.resolve(executa()).then(res, rej),
  };
  // Método que o mock não conhece (order, limit, not, ilike...) não filtra e não quebra.
  const q: any = new Proxy({}, { get: (_t, p: string) => metodos[p] ?? (() => q) });
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  liberarAcessoPix: vi.fn(async () => new Date('2026-12-09T00:00:00Z')),
  getOrCreatePixUser: vi.fn(async () => null),
}));
vi.mock('../services/dunningService', () => ({
  cancelStripeSubsForEmail: vi.fn(async () => 0), sendDunningDay0: vi.fn(), sendDunningRecovered: vi.fn(),
}));
const whatsTextos: string[] = [];
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async (_t: string, texto: string) => { whatsTextos.push(texto); }) }));
vi.mock('../services/cuponsService', () => ({
  registrarUsoCupom: vi.fn(async () => {}), normalizarCodigo: (c: any) => (c ? String(c) : null),
  buscarCupomValido: vi.fn(), aplicarCupom: vi.fn(), garantirCupomStripe: vi.fn(), garantirPromotionCode: vi.fn(),
  cupomAtivoParaPlano: vi.fn(), resumoPublicoCupom: vi.fn(),
}));
vi.mock('../services/plugcashService', () => ({ processarEventoPlugcash: vi.fn(async () => ({ acao: 'ignorado' })) }));
vi.mock('../services/asaas/asaasPlugcashLink', () => ({
  acharOfertaDoPagamento: vi.fn(async () => null),
  clienteDoAsaas: vi.fn(async () => ({ email: null, nome: null, telefone: null })),
  logLink: vi.fn(),
}));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async () => true) }));
vi.mock('../utils/mailer', () => ({
  sendCheckoutCompletionEmail: vi.fn(async () => {}), sendOpsAlert: vi.fn(async () => {}), sendPixAutomaticoAcessoEmail: vi.fn(async () => {}),
}));
vi.mock('../services/solardoc/avisoGrupoSolardoc', () => ({
  avisarCompra: vi.fn(async () => {}), idDeVenda: (...p: any[]) => p.filter(Boolean).join(':') || null,
}));


const viaLedger: Array<{ eventId: string; valor: unknown }> = [];
vi.mock('../utils/metaPixel', () => ({
  sendMetaEvent: vi.fn(async (_n: string, o: any) => { viaLedger.push({ eventId: o.eventId, valor: o.customData?.value }); return { ok: true, status: 200 }; }),
}));

// Meta pelo caminho do pixel do quiz: o resultado é escolhido por teste; o id do evento é o real.
let resultadoPixQuiz: string = 'enviado';
let durantePixQuiz: (() => Promise<void>) | null = null;
const viaPixQuiz: Array<Record<string, any>> = [];
vi.mock('../services/solardoc/purchasePixQuiz', async (orig) => {
  const real = await orig<typeof import('../services/solardoc/purchasePixQuiz')>();
  return {
    ...real,
    dispararPurchasePixQuiz: vi.fn(async (e: any) => {
      viaPixQuiz.push(e);
      if (durantePixQuiz) await durantePixQuiz();
      return resultadoPixQuiz;
    }),
  };
});


import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';
import { reDrivePendingPurchases, sendPurchaseForSale, PREFIXO_CLAIM_PIX_NO_LEDGER } from '../services/salesLedger';
import { idDoEventoPix, PREFIXO_CLAIM_PURCHASE_PIX } from '../services/solardoc/purchasePixQuiz';

describe('prefixo do claim do Purchase do Pix', () => {
  it('o ledger usa o mesmo prefixo do quiz (senão o re-drive volta a mandar em dobro)', () => {
    expect(PREFIXO_CLAIM_PIX_NO_LEDGER).toBe(PREFIXO_CLAIM_PURCHASE_PIX);
  });
});

const CONTRATO = 'SD-VIP-teste1';
const ID_PIX = idDoEventoPix(`asaas:${CONTRATO}`);
const PASSADO = '2020-01-01T00:00:00.000Z';

function contrato(over: Row = {}): Row {
  return {
    id: 'c1', user_id: 'u1', email: 'cliente@teste.com', modo: 'automatico', authorization_id: 'auth-1', subscription_id: null,
    contract_id: CONTRATO, plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', ultimo_pagamento_id: '', ...over,
  };
}
const evento = (id: string): any => ({
  id, event: 'PAYMENT_CONFIRMED',
  payment: { id: `pay-${id}`, value: 67, externalReference: CONTRATO, dueDate: '2026-12-09' },
});
const quiz = () => db.system_state.push({ key: `pix_auto_atrib:${CONTRATO}`, value: { origem: 'quiz_solardoc', whatsapp: '34999990000', nome: 'Cliente' } });
const usuario = (over: Row = {}): Row => ({
  id: 'u1', email: 'cliente@teste.com', nome: 'Cliente', whatsapp: '34999990000',
  plano: 'free', billing_status: 'active', plano_expira_em: null, past_due_since: null, ...over,
});
const venda = (chave = `asaas:${CONTRATO}`) => db.sales.find((s) => s.checkout_session_id === chave)!;

beforeEach(() => {
  db.asaas_pix_assinaturas = [contrato()];
  db.asaas_webhook_events = []; db.system_state = []; db.sales = [];
  db.users = [usuario()];
  viaLedger.length = 0; viaPixQuiz.length = 0; resultadoPixQuiz = 'enviado'; durantePixQuiz = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// ── PIX AUTOMÁTICO ──────────────────────────────────────────────────────────
describe('Pix automático do quiz: um Purchase por venda', () => {
  it('enviado pelo pixel do quiz: a linha fecha e o re-drive NÃO manda de novo', async () => {
    quiz();
    await processarWebhookAsaas(evento('ev-1'));
    expect(viaPixQuiz).toHaveLength(1);
    expect(venda().meta_response_ok).toBe(true);
    expect(venda().meta_event_id).toBe(ID_PIX);
    expect(venda().meta_purchase_sent_at).toBeTruthy();

    const r = await reDrivePendingPurchases();
    expect(r).toEqual({ tried: 0, ok: 0 });
    expect(viaLedger).toHaveLength(0);
  });

  it('timeout do quiz com o claim já `enviado`: o re-drive confere o claim e não manda', async () => {
    quiz();
    resultadoPixQuiz = 'timeout';
    await processarWebhookAsaas(evento('ev-2'));
    expect(venda().meta_response_ok).toBe(false); // não fecha às cegas
    expect(venda().meta_event_id).toBe(ID_PIX);
    db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_PIX}`, value: { estado: 'enviado' } });

    await reDrivePendingPurchases();
    expect(viaLedger).toHaveLength(0);
    expect(venda().meta_response_ok).toBe(true);
  });

  it('o pixel do quiz falhou: a venda não se perde, o re-drive manda UMA vez com o MESMO event_id', async () => {
    quiz();
    resultadoPixQuiz = 'falhou';
    await processarWebhookAsaas(evento('ev-3'));
    db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_PIX}`, value: { estado: 'falhou' } });

    await reDrivePendingPurchases();
    expect(viaLedger).toEqual([{ eventId: ID_PIX, valor: 67 }]);
    expect(venda().meta_response_ok).toBe(true);
    expect((await reDrivePendingPurchases()).tried).toBe(0);
  });

  it('(k) re-drive DENTRO da janela do envio (claim `novo`): o id já está na linha e o re-drive espera; sai uma vez só', async () => {
    quiz();
    let idNaLinhaDuranteOEnvio: string | null = null;
    durantePixQuiz = async () => {
      // o pixel do quiz pegou o claim e está esperando o Meta; o re-drive horário passa neste instante
      db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_PIX}`, value: { estado: 'novo', em: new Date().toISOString() } });
      idNaLinhaDuranteOEnvio = venda().meta_event_id;
      await reDrivePendingPurchases();
      db.system_state.find((r) => r.key === `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_PIX}`)!.value = { estado: 'enviado' };
    };
    await processarWebhookAsaas(evento('ev-k'));
    expect(idNaLinhaDuranteOEnvio).toBe(ID_PIX);
    expect(viaPixQuiz).toHaveLength(1);
    expect(viaLedger).toHaveLength(0);
    expect(venda().meta_response_ok).toBe(true);
    expect((await reDrivePendingPurchases()).tried).toBe(0);
    expect(viaLedger).toHaveLength(0);
  });

  it('(k) re-drive antes de o pixel do quiz pegar o claim: os dois usam o MESMO event_id (o Meta deduplica)', async () => {
    quiz();
    durantePixQuiz = async () => { await reDrivePendingPurchases(); };
    await processarWebhookAsaas(evento('ev-k2'));
    expect(viaLedger).toEqual([{ eventId: ID_PIX, valor: 67 }]);
    expect(idDoEventoPix(String(viaPixQuiz[0]!.chaveE2e || '').trim() || viaPixQuiz[0]!.dedupKey)).toBe(ID_PIX);
  });

  it('(k) claim `novo` velho (envio que morreu no meio): o re-drive manda, com o mesmo id', async () => {
    quiz();
    resultadoPixQuiz = 'timeout';
    await processarWebhookAsaas(evento('ev-k3'));
    db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_PIX}`, value: { estado: 'novo', em: PASSADO } });
    await reDrivePendingPurchases();
    expect(viaLedger).toEqual([{ eventId: ID_PIX, valor: 67 }]);
  });

  it('lead de teste do quiz (`teste`): a linha fecha como `teste` e o re-drive não manda nada', async () => {
    quiz();
    resultadoPixQuiz = 'teste';
    await processarWebhookAsaas(evento('ev-teste'));
    expect(venda()).toMatchObject({ meta_response_ok: true, meta_skip_motivo: 'teste' });
    expect(venda().meta_purchase_sent_at).toBeTruthy();
    expect((await reDrivePendingPurchases()).tried).toBe(0);
    expect(viaLedger).toHaveLength(0);
  });

  it('venda que não passou pelo pixel do quiz (adesão normal): o ledger manda normalmente, com o id do contrato', async () => {
    await processarWebhookAsaas(evento('ev-4'));
    expect(viaPixQuiz).toHaveLength(0);
    expect(viaLedger).toEqual([{ eventId: `asaas:${CONTRATO}`, valor: 67 }]);
    expect(venda().meta_event_id).toBe(`asaas:${CONTRATO}`);
  });

  it('sendPurchaseForSale sem `pix_` no meta_event_id (cartão): nada muda', async () => {
    db.sales.push({ id: 's9', checkout_session_id: 'cs_9', email: 'x@y.com', plano: 'ilimitado', produto: 'VIP', valor: 67, meta_attempts: 0 });
    expect(await sendPurchaseForSale('s9')).toBe(true);
    expect(viaLedger).toEqual([{ eventId: 'cs_9', valor: 67 }]);
  });
});

// ── PIX POR CÓDIGO ──────────────────────────────────────────────────────────
const AVULSO = '11111111-2222-3333-4444-555555555555';
const ID_AVULSO = idDoEventoPix(`asaas_avulso:${AVULSO}`);
const avulso = (origem: string | null = null) => db.system_state.push({
  key: `pix_avulso:${AVULSO}`,
  value: { email: 'cliente@teste.com', nome: 'Cliente', whatsapp: '34999990000', origem, atrib: {}, qrId: null },
});
const pagamentoAvulso = (id: string): any => ({
  id, event: 'PAYMENT_RECEIVED', payment: { id: `pay-${id}`, value: 67, externalReference: `sdav:${AVULSO}` },
});
const vendaAvulso = () => venda(`asaas_avulso:${AVULSO}`);

describe('Pix por código: a mesma regra de id', () => {
  it('do quiz: o id do pixel do quiz vai na linha antes do envio, a linha fecha e o re-drive não repete', async () => {
    avulso('quiz_solardoc');
    let idNaLinha: string | null = null;
    durantePixQuiz = async () => { idNaLinha = vendaAvulso().meta_event_id; };
    await processarWebhookAsaas(pagamentoAvulso('av-1'));
    expect(idNaLinha).toBe(ID_AVULSO);
    expect(viaPixQuiz).toHaveLength(1);
    expect(vendaAvulso().meta_response_ok).toBe(true);
    expect((await reDrivePendingPurchases()).tried).toBe(0);
    expect(viaLedger).toHaveLength(0);
  });

  it('do quiz com o pixel falhando: o re-drive manda UMA vez, com o MESMO id', async () => {
    avulso('quiz_solardoc');
    resultadoPixQuiz = 'falhou';
    await processarWebhookAsaas(pagamentoAvulso('av-2'));
    db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_AVULSO}`, value: { estado: 'falhou' } });
    await reDrivePendingPurchases();
    expect(viaLedger).toEqual([{ eventId: ID_AVULSO, valor: 67 }]);
    expect((await reDrivePendingPurchases()).tried).toBe(0);
  });

  it('fora do quiz: o ledger manda normalmente, com o id do checkout', async () => {
    avulso();
    await processarWebhookAsaas(pagamentoAvulso('av-3'));
    expect(viaPixQuiz).toHaveLength(0);
    expect(viaLedger).toEqual([{ eventId: `asaas_avulso:${AVULSO}`, valor: 67 }]);
  });
});
