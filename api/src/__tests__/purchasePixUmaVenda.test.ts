import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─────────────────────────────────────────────────────────────────────────────
// UM PIX = UM PURCHASE (10/11/2026).
//
// De 03 a 09/11 o servidor mandou 18 Purchase para 14 vendas. O claim do quiz (`pix_<hash>`, system_state) saía 1 a 2 s
// DEPOIS de a linha `sales` do Asaas nascer, a linha ficava com meta_response_ok = false e o re-drive a mandava de novo
// (`asaas:<contrato>`), 22 a 44 min depois. O desenho publicado (commit e4936f32): a venda do quiz nasce com
// `meta_event_id = pix_<hash>` e o re-drive confere o claim. Uma venda tem UM event_id no Meta; pode haver mais de um
// envio, desde que todos levem o mesmo id (o Meta deduplica). Do outro lado, o Pix por comprovante e o /pix-liberar
// mandavam Purchase sem criar linha em `sales`: aí a regra é exatamente 1 envio e 1 linha.
//
// O banco falso impõe chave única (system_state.key e sales.checkout_session_id) e entende o filtro de JSON do PostgREST
// (`value->>user_id`). Os dois caminhos de envio ao Meta caem no MESMO contador (`H.meta`): é ele que tem que dar 1.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;

const H = vi.hoisted(() => ({
  db: { system_state: [], sales: [], users: [] } as Record<string, Array<Record<string, any>>>,
  meta: [] as Array<{ via: 'quiz' | 'ledger'; eventId: string; valor: unknown }>,
  seq: { n: 0 },
  falhar: { quiz: false },
  utmify: [] as unknown[],
}));

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let conflito = 'id';
  let max = Infinity;
  const caminho = (r: Row, col: string) => col.split(/->>|->/).reduce((v: any, p) => v?.[p], r);
  const linhas = () => H.db[table].filter((r) => filtros.every((f) => f(r))).slice(0, max);

  function executa(): { data: any; error: any } {
    if (modo === 'insert') {
      if (table === 'system_state' && H.db[table].some((r) => r.key === pendente!.key)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      H.db[table].push({ ...pendente });
      return { data: pendente, error: null };
    }
    if (modo === 'upsert') {
      const i = H.db[table].findIndex((r) => r[conflito] === pendente![conflito]);
      if (i >= 0) { H.db[table][i] = { ...H.db[table][i], ...pendente }; return { data: { ...H.db[table][i] }, error: null }; }
      // Padrões de coluna do banco (sales): meta_response_ok false, meta_attempts 0.
      const nova = table === 'sales'
        ? { id: `sale-${++H.seq.n}`, meta_response_ok: false, meta_attempts: 0, created_at: new Date().toISOString(), ...pendente }
        : { ...pendente };
      H.db[table].push(nova);
      return { data: { ...nova }, error: null };
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
    upsert: (r: Row, o?: { onConflict?: string }) => { modo = 'upsert'; pendente = r; conflito = o?.onConflict ?? 'id'; return q; },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(caminho(r, c)) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(caminho(r, c)) !== String(v)); return q; },
    ilike: (c: string, v: string) => { filtros.push((r) => String(r[c]).toLowerCase() === String(v).toLowerCase()); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    is: (c: string, v: null) => { filtros.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    like: (c: string, p: string) => { const pre = p.replace('%', ''); filtros.push((r) => String(r[c]).startsWith(pre)); return q; },
    filter: (c: string, op: string, v: string) => {
      filtros.push((r) => {
        const x = String(caminho(r, c));
        return op === 'gte' ? x >= String(v) : op === 'lte' ? x <= String(v) : x === String(v);
      });
      return q;
    },
    gte: (c: string, v: any) => { filtros.push((r) => r[c] != null && new Date(r[c]).getTime() >= new Date(v).getTime()); return q; },
    lt: (c: string, v: any) => { filtros.push((r) => r[c] != null && Number(r[c]) < Number(v)); return q; },
    or: (expr: string) => {
      const termos = expr.split(',').map((t) => t.split('.'));
      filtros.push((r) => termos.some(([col, op, val]) =>
        op === 'is' && val === 'null' ? r[col] == null : op === 'lt' ? r[col] != null && Number(r[col]) < Number(val) : false));
      return q;
    },
    order: () => q,
    limit: (n: number) => { max = n; return q; },
    maybeSingle: async () => { const { data, error } = executa(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
    single: async () => {
      const { data, error } = executa();
      const d = Array.isArray(data) ? data[0] ?? null : data;
      return { data: d, error: error ?? (d ? null : new Error('sem linha')) };
    },
    then: (ok: any, erro: any) => Promise.resolve(executa()).then(ok, erro),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => {
  const vazio = () => {
    const q: any = { select: () => q, eq: () => q, contains: () => q, order: () => q, limit: () => Promise.resolve({ data: [], error: null }) };
    return q;
  };
  return { geradorComServiceKey: false, supabaseGerador: { from: () => vazio() } };
});
// Os dois caminhos de envio ao Meta (CAPI do quiz e pixel do ledger) caem no mesmo contador.
vi.mock('../utils/metaCapi', async (orig) => {
  const real = await orig<typeof import('../utils/metaCapi')>();
  return { ...real, enviarEventoMeta: vi.fn(async (ev: any) => { if (H.falhar.quiz) return { ok: false, status: 500, erro: 'http_500', recebidos: 0 }; H.meta.push({ via: 'quiz', eventId: ev.eventId, valor: ev.valor }); return { ok: true, status: 200, recebidos: 1 }; }) };
});
vi.mock('../utils/metaPixel', () => ({
  sendMetaEvent: vi.fn(async (_n: string, o: any) => { H.meta.push({ via: 'ledger', eventId: o.eventId, valor: o.customData?.value }); return { ok: true, status: 200 }; }),
}));
vi.mock('../services/utmifyOrders', () => ({ sendUtmifyOrder: vi.fn(async (o: unknown) => { H.utmify.push(o); return true; }) }));
// /pix-liberar: o módulo do comprovante sobe o SDK da Anthropic no boot; aqui só importam estas duas peças.
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  VALOR_RENOVACAO_PIX: 67,
  jaEraClientePagante: () => false,
}));
vi.mock('../middleware/auth', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../middleware/adminAuth', () => ({ adminMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));

import { dispararPurchasePixQuiz, idDoEventoPix, PREFIXO_CLAIM_PURCHASE_PIX } from '../services/solardoc/purchasePixQuiz';
import { upsertSale, sendPurchaseForSale, reDrivePendingPurchases } from '../services/salesLedger';
import admin from '../routes/admin';

const CONTRATO = 'SD-VIP-TESTE-001';
const CSID = `asaas:${CONTRATO}`;
const E2E = 'pix_e2e:E1234567890123456789X:67';
const ID_E2E = idDoEventoPix(E2E);
const EMAIL = 'comprador@example.com';
const min = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Linha do ledger como o webhook do Asaas a deixa (upsertSale): ainda sem Purchase, já com o id do pixel do quiz. */
const criarVendaAsaas = (quandoISO = new Date().toISOString(), metaEventId: string | null = ID_E2E) => upsertSale({
  checkout_session_id: CSID, email: EMAIL, nome: 'Comprador', phone: '5534991112222',
  plano: 'ilimitado', produto: 'SolarDoc VIP', valor: 67, status: 'paid', card_passed_at: quandoISO,
  meta_event_id: metaEventId,
});

/** O caminho do quiz do webhook do Asaas (origin/main): sem `venda`, a linha é marcada por registrarPurchasePixQuizNaVenda. */
const dispararDoAsaas = () => dispararPurchasePixQuiz({
  telefone: '5534991112222', email: EMAIL, nome: 'Comprador', valor: 67,
  chaveE2e: E2E, dedupKey: CSID, quando: new Date(),
});

const idsNoMeta = () => [...new Set(H.meta.map((m) => m.eventId))];

beforeEach(() => {
  H.db.system_state = []; H.db.sales = []; H.db.users = [{ id: 'u1', email: EMAIL, whatsapp: '5534991112222' }];
  H.meta.length = 0; H.utmify.length = 0; H.seq.n = 0; H.falhar.quiz = false;
});

describe('Pix automático: uma venda, um event_id no Meta', () => {
  it('(1) claim ANTES da venda: a linha nasce com o id do claim e o ledger fecha sem enviar', async () => {
    expect(await dispararDoAsaas()).toBe('enviado');
    expect(H.db.sales).toHaveLength(0);

    const saleId = await criarVendaAsaas();
    expect(await sendPurchaseForSale(saleId!)).toBe(true);
    await reDrivePendingPurchases();

    expect(H.meta).toHaveLength(1);
    expect(H.meta[0]).toMatchObject({ via: 'quiz', eventId: ID_E2E, valor: 67 });
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: true, meta_skip_motivo: null });
    expect(H.db.sales[0].meta_purchase_sent_at).toBeTruthy();
  });

  it('(2) claim 2 s DEPOIS da venda: o re-drive confere o claim `enviado` e só fecha a linha', async () => {
    await criarVendaAsaas();
    expect(H.db.sales[0]).toMatchObject({ meta_response_ok: false, meta_event_id: ID_E2E }); // o webhook já gravou o id

    expect(await dispararDoAsaas()).toBe('enviado');
    const r = await reDrivePendingPurchases();
    expect(r).toEqual({ tried: 1, ok: 1 });
    expect(H.meta).toHaveLength(1);
    expect(idsNoMeta()).toEqual([ID_E2E]);
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: true });

    // Cron seguinte: nada pendente.
    expect(await reDrivePendingPurchases()).toEqual({ tried: 0, ok: 0 });
    expect(H.meta).toHaveLength(1);
  });

  it('(3) re-drive 30 min depois com o claim `enviado` (sem vínculo no value): fecha a linha e não envia', async () => {
    const t30 = min(30);
    const saleId = await criarVendaAsaas(t30);
    H.db.system_state.push(
      { key: E2E, value: { user_id: 'u1', valor: 67, at: t30 } },
      { key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_E2E}`, value: { estado: 'enviado', em: t30 } },
    );

    expect(await reDrivePendingPurchases()).toEqual({ tried: 1, ok: 1 });
    expect(H.meta).toHaveLength(0);
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ id: saleId, meta_event_id: ID_E2E, meta_response_ok: true });
    await reDrivePendingPurchases(); // cron seguinte: continua sem enviar
    expect(H.meta).toHaveLength(0);
  });

  it('(3b) claim `novo` de menos de 2 min (o pixel do quiz está enviando): o re-drive espera, não manda junto', async () => {
    await criarVendaAsaas(min(1));
    H.db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_E2E}`, value: { estado: 'novo', em: new Date().toISOString() } });
    expect(await reDrivePendingPurchases()).toEqual({ tried: 1, ok: 0 });
    expect(H.meta).toHaveLength(0);
    expect(H.db.sales[0]).toMatchObject({ meta_response_ok: false });
  });

  it('(3c) claim que FALHOU não segura a venda: o re-drive manda com o MESMO id do claim', async () => {
    await criarVendaAsaas(min(30));
    H.db.system_state.push(
      { key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_E2E}`, value: { estado: 'falhou', em: min(30), erro: 'http_500' } },
    );
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(1);
    expect(H.meta[0]).toMatchObject({ via: 'ledger', eventId: ID_E2E });
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: true });
  });

  it('(3d) venda asaas sem id de pixel do quiz (não veio do quiz) manda com o próprio id', async () => {
    await criarVendaAsaas(min(30), null);
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(1);
    expect(H.meta[0]).toMatchObject({ via: 'ledger', eventId: CSID });
  });

  it('(3e) o mesmo Pix reentregue: claim duplicado não envia de novo e o id é um só', async () => {
    await dispararDoAsaas();
    await criarVendaAsaas();
    expect(await dispararDoAsaas()).toBe('duplicado');
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(1);
    expect(idsNoMeta()).toEqual([ID_E2E]);
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: true });
  });

  it('venda de cartão (cs_...) segue mandando com o próprio id', async () => {
    const id = await upsertSale({
      checkout_session_id: 'cs_abc', email: EMAIL, plano: 'ilimitado', produto: 'SolarDoc VIP', valor: 67, status: 'paid',
      card_passed_at: new Date().toISOString(),
    });
    await sendPurchaseForSale(id!);
    expect(H.meta).toHaveLength(1);
    expect(H.meta[0]).toMatchObject({ via: 'ledger', eventId: 'cs_abc' });
  });
});

describe('Pix por comprovante: ganha linha em sales, marcada como enviada, e não manda um segundo Purchase', () => {
  const entradaComprovante = () => ({
    telefone: '5534991112222', email: EMAIL, valor: 67,
    chaveE2e: E2E, dedupKey: 'pix_comprov:5534991112222:67:10/11', quando: new Date(),
    venda: { checkoutSessionId: `pix:${E2E}`, userId: 'u1', criar: { plano: 'ilimitado', produto: 'SolarDoc VIP (Pix por comprovante)' } },
  });

  it('(4) comprovante sem venda: 1 Purchase e 1 linha com o id do claim; reentrega e re-drive não duplicam', async () => {
    expect(await dispararPurchasePixQuiz(entradaComprovante())).toBe('enviado');
    expect(H.meta).toHaveLength(1);
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({
      checkout_session_id: `pix:${E2E}`, email: EMAIL, valor: 67, status: 'paid',
      meta_event_id: ID_E2E, meta_response_ok: true, meta_skip_motivo: null,
    });

    expect(await dispararPurchasePixQuiz(entradaComprovante())).toBe('duplicado'); // o mesmo comprovante relido
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(1);
    expect(H.db.sales).toHaveLength(1);
    // Não manda pedido à UTMify: o caminho nunca mandou e criar a linha não chama a UTMify.
    expect(H.utmify).toHaveLength(0);
  });

  it('(4b) comprovante com o envio FALHANDO: cria 1 linha pendente (meta_response_ok=false) e o re-drive manda com o MESMO id', async () => {
    H.falhar.quiz = true;
    expect(await dispararPurchasePixQuiz(entradaComprovante())).toBe('falhou');
    expect(H.meta).toHaveLength(0);
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ checkout_session_id: `pix:${E2E}`, meta_event_id: ID_E2E, meta_response_ok: false });
    expect(H.db.sales[0].meta_purchase_sent_at).toBeFalsy();

    // Reentrega do mesmo comprovante com o claim `falhou`: continua 1 linha só, ainda pendente.
    H.falhar.quiz = false;
    expect(await dispararPurchasePixQuiz(entradaComprovante())).toBe('duplicado');
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: false });

    // O re-drive reenvia, uma vez, com o id do claim.
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(1);
    expect(H.meta[0]).toMatchObject({ via: 'ledger', eventId: ID_E2E, valor: 67 });
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: true });
  });

  it('(4c) claim `novo` (outro envio em andamento): a linha nasce pendente, uma só, e o re-drive espera', async () => {
    H.db.system_state.push({ key: `${PREFIXO_CLAIM_PURCHASE_PIX}${ID_E2E}`, value: { estado: 'novo', em: new Date().toISOString() } });
    expect(await dispararPurchasePixQuiz(entradaComprovante())).toBe('duplicado');
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({ meta_event_id: ID_E2E, meta_response_ok: false });
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(0);
    expect(H.db.sales).toHaveLength(1);
  });

  it('sem chave (nem E2E nem dedup): nada de venda e nada de Purchase (sem_id), como antes', async () => {
    expect(await dispararPurchasePixQuiz({ telefone: '5534991112222', email: EMAIL, valor: 67, venda: null })).toBe('sem_id');
    expect(H.meta).toHaveLength(0);
    expect(H.db.sales).toHaveLength(0);
  });
});

describe('/pix-liberar', () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', admin);
  const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

  it('(5) libera a 1ª compra: 1 Purchase e 1 linha em sales com o id do claim; a 2ª chamada é renovação e não manda', async () => {
    const r1 = await request(app).post('/admin/pix-liberar').send({ email: EMAIL, meses: 1 });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ ok: true, purchase: 'enviado' });
    const id = idDoEventoPix(`admin:u1:${hoje()}`);
    expect(H.meta).toHaveLength(1);
    expect(H.meta[0]).toMatchObject({ via: 'quiz', eventId: id, valor: 67 });
    expect(H.db.sales).toHaveLength(1);
    expect(H.db.sales[0]).toMatchObject({
      checkout_session_id: `admin_pix:u1:${hoje()}`, email: EMAIL, valor: 67, status: 'paid',
      meta_event_id: id, meta_response_ok: true,
    });

    const r2 = await request(app).post('/admin/pix-liberar').send({ email: EMAIL, meses: 1 });
    expect(r2.status).toBe(200);
    expect(r2.body.purchase).toBeNull(); // já tem plano_expira_em: renovação
    await reDrivePendingPurchases();
    expect(H.meta).toHaveLength(1);
    expect(H.db.sales).toHaveLength(1);
    expect(H.utmify).toHaveLength(0);
  });
});
