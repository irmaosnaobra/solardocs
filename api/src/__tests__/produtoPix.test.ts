import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// COMPRA POR PIX DENTRO DO APP (loja "Para crescer"): POST /produtos/pix, GET /produtos/pix/:id, GET /produtos/cpf
// e a liberacao pelo webhook do Asaas. Banco em memoria (helpers/dbFalso) e Asaas simulado: nada toca rede nem producao.
// Os CPFs abaixo sao numeros de teste (digito verificador valido), nao de pessoa.
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  asaasFetch: vi.fn(),
  statusAsaas: { v: 'PENDING' },
  pagamentos: 0,
  validade: { v: '' },
  /** undefined: o valor da cobranca; null: o Asaas nao manda `value`; numero: esse valor. */
  valorAsaas: { v: undefined as number | null | undefined },
  deleteFalha: { v: false },
}));

vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return { supabase: supabaseFalso };
});
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => {}) }));
vi.mock('../services/asaas/asaasClient', () => ({
  asaasHabilitado: () => true,
  AsaasError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  asaasFetch: (...a: unknown[]) => H.asaasFetch(...a),
}));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  garantirClienteAsaas: vi.fn(async () => 'cus_teste'),
  soDigitos: (v: unknown) => String(v ?? '').replace(/\D/g, ''),
  PLANOS_PIX: {},
}));
vi.mock('../services/asaas/asaasPlugcashLink', () => ({ acharOfertaDoPagamento: vi.fn(async () => null), clienteDoAsaas: vi.fn(), logLink: vi.fn() }));
vi.mock('../services/plugcashService', () => ({ processarEventoPlugcash: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async () => ({})) }));

import { db, falhas, limpar, semear } from './helpers/dbFalso';
import { sendOpsAlert } from '../utils/mailer';
import { criarPixProdutoHandler, statusPixProdutoHandler, cpfPixProdutoHandler } from '../controllers/produtoPixController';
import { tratarWebhookProduto, lerRefDaCobranca, refDaCobranca, mascararCpf, liberarCobranca } from '../services/produtos/produtoPix';
import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';
import { acessos } from '../services/produtos/acessos';

const CPF = '529.982.247-25';
const CPF_DIGITOS = '52998224725';
const EMAIL = 'cliente@empresa.com.br';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.userId = String(req.headers['x-user'] || ''); next(); });
  a.post('/produtos/pix', criarPixProdutoHandler);
  a.get('/produtos/pix/:cobrancaId', statusPixProdutoHandler);
  a.get('/produtos/cpf', cpfPixProdutoHandler);
  return a;
}

function usuario(over: Record<string, any> = {}) {
  return semear('users', {
    id: randomUUID(), email: EMAIL, nome: 'Cliente Teste', whatsapp: null, plano: 'free', is_admin: false,
    plano_expira_em: null, offgrid_desde: null, offgrid_credito: 0, ...over,
  });
}

function pagar(userId: string, produto: string, corpo: Record<string, unknown> = {}) {
  return request(app()).post('/produtos/pix').set('x-user', userId).send({ produto, cpf: CPF, ...corpo });
}

const cobrancas = () => db.produto_cobrancas ?? [];

/** O que o Asaas manda no PAYMENT_RECEIVED / PAYMENT_CONFIRMED desta cobranca. */
function pagamentoDe(c: Record<string, any>, over: Record<string, any> = {}) {
  return { id: c.asaas_payment_id, value: Number(c.valor), externalReference: refDaCobranca(c.produto, c.id, c.user_id), ...over };
}

beforeEach(() => {
  limpar('users', 'entitlements', 'kit_pedidos', 'limpapro_entitlements', 'limpapro_membros', 'produto_cobrancas', 'asaas_webhook_events');
  H.statusAsaas.v = 'PENDING';
  H.valorAsaas.v = undefined;
  H.deleteFalha.v = false;
  H.pagamentos = 0;
  const dois = new Date(Date.now() + 2 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  H.validade.v = `${dois} 23:59:59`;
  H.asaasFetch.mockReset();
  H.asaasFetch.mockImplementation(async (path: string, init?: { method?: string; body?: any }) => {
    const metodo = init?.method ?? 'GET';
    if (path === '/payments' && metodo === 'POST') { H.pagamentos += 1; return { id: `pay_${H.pagamentos}` }; }
    if (/\/pixQrCode$/.test(path)) return { encodedImage: 'QRBASE64', payload: '00020126PIXCOPIAECOLA', expirationDate: H.validade.v };
    if (/^\/payments\/[^/]+$/.test(path) && metodo === 'GET') {
      const linha = (db.produto_cobrancas ?? []).find((x) => `/payments/${x.asaas_payment_id}` === path);
      return { status: H.statusAsaas.v, ...(H.valorAsaas.v === undefined ? { value: linha ? Number(linha.valor) : undefined } : H.valorAsaas.v === null ? {} : { value: H.valorAsaas.v }) };
    }
    if (/^\/payments\/[^/]+$/.test(path) && metodo === 'DELETE') { if (H.deleteFalha.v) throw new Error('nao pode apagar'); return {}; }
    return {};
  });
  vi.mocked(sendOpsAlert).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /produtos/pix: validacao', () => {
  it('CPF invalido (digito verificador, tamanho, sequencia repetida) da 400 e nao cria cobranca', async () => {
    const u = usuario();
    for (const cpf of ['529.982.247-24', '123', '111.111.111-11', '', 'abc']) {
      const r = await pagar(u.id, 'inventario', { cpf });
      expect(r.status).toBe(400);
      expect(r.body.error).toBeTruthy();
    }
    expect(H.pagamentos).toBe(0);
    expect(cobrancas()).toHaveLength(0);
  });

  it('produto desconhecido da 400 (inclusive produto do catalogo que nao e vendido por Pix)', async () => {
    const u = usuario();
    for (const produto of ['nao-existe', 'precificacao', '', undefined]) {
      const r = await pagar(u.id, produto as string);
      expect(r.status).toBe(400);
    }
    expect(H.pagamentos).toBe(0);
  });

  it('quem ja tem o produto recebe 409 com jaTem: true', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'compra', expira_em: null });
    const r = await pagar(u.id, 'inventario');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ jaTem: true });
    expect(r.body.error).toBeTruthy();
    expect(H.pagamentos).toBe(0);
  });
});

describe('POST /produtos/pix: criacao', () => {
  it('o valor sai do catalogo mesmo se o cliente mandar outro', async () => {
    const u = usuario();
    const r = await pagar(u.id, 'curso-fechamento', { valor: 1, preco: 0.01, value: 1 });
    expect(r.status).toBe(200);
    expect(r.body.valor).toBe(27);
    const chamada = H.asaasFetch.mock.calls.find(([p, i]) => p === '/payments' && i?.method === 'POST')!;
    expect(chamada[1].body.value).toBe(27);
    expect(chamada[1].body.billingType).toBe('PIX');
    expect(cobrancas()[0].valor).toBe(27);
  });

  it('devolve o QR no formato do contrato e grava a linha (referencia com produto, cobranca e usuario)', async () => {
    const u = usuario();
    const r = await pagar(u.id, 'offgrid');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['cobrancaId', 'expiraEm', 'produto', 'qrImagemBase64', 'qrPayload', 'valor']);
    expect(r.body).toMatchObject({ produto: 'offgrid', valor: 97, qrPayload: '00020126PIXCOPIAECOLA', qrImagemBase64: 'QRBASE64' });
    expect(Date.parse(r.body.expiraEm)).toBeGreaterThan(Date.now());
    const linha = cobrancas()[0];
    expect(linha).toMatchObject({ id: r.body.cobrancaId, user_id: u.id, produto: 'offgrid', cpf: CPF_DIGITOS, status: 'pendente', asaas_payment_id: 'pay_1' });
    const chamada = H.asaasFetch.mock.calls.find(([p]) => p === '/payments')!;
    expect(lerRefDaCobranca(chamada[1].body.externalReference)).toEqual({ produto: 'offgrid', cobrancaId: r.body.cobrancaId, userId: u.id });
  });

  it('cobranca pendente e nao vencida do mesmo produto e reaproveitada (sem criar outra no Asaas)', async () => {
    const u = usuario();
    const a = await pagar(u.id, 'inventario');
    const b = await pagar(u.id, 'inventario');
    expect(b.status).toBe(200);
    expect(b.body.cobrancaId).toBe(a.body.cobrancaId);
    expect(H.pagamentos).toBe(1);
    expect(cobrancas()).toHaveLength(1);
    // outro produto nao reaproveita
    const c = await pagar(u.id, 'curso-limpapro');
    expect(c.body.cobrancaId).not.toBe(a.body.cobrancaId);
    expect(H.pagamentos).toBe(2);
  });

  it('cobranca vencida nao e reaproveitada: marca expirada e cria outra', async () => {
    const u = usuario();
    const a = await pagar(u.id, 'inventario');
    cobrancas()[0].expira_em = new Date(Date.now() - 60_000).toISOString();
    const b = await pagar(u.id, 'inventario');
    expect(b.body.cobrancaId).not.toBe(a.body.cobrancaId);
    expect(cobrancas().find((c) => c.id === a.body.cobrancaId)!.status).toBe('expirado');
  });
});

describe('CPF salvo (upsell de um toque)', () => {
  it('GET /produtos/cpf devolve mascarado, ou null sem cobranca; usarCpfSalvo gera sem pedir o CPF', async () => {
    const u = usuario();
    expect((await request(app()).get('/produtos/cpf').set('x-user', u.id)).body).toEqual({ cpf: null });
    expect((await pagar(u.id, 'offgrid', { cpf: undefined, usarCpfSalvo: true })).status).toBe(400);

    await pagar(u.id, 'offgrid');
    const g = await request(app()).get('/produtos/cpf').set('x-user', u.id);
    expect(g.body).toEqual({ cpf: '529.***.***-25' });
    expect(JSON.stringify(g.body)).not.toContain('982');

    const up = await pagar(u.id, 'inventario', { cpf: undefined, usarCpfSalvo: true });
    expect(up.status).toBe(200);
    expect(cobrancas().find((c) => c.id === up.body.cobrancaId)!.cpf).toBe(CPF_DIGITOS);
  });

  it('o CPF de outra pessoa nunca aparece', async () => {
    const a = usuario();
    const b = usuario({ email: 'outro@empresa.com.br' });
    await pagar(a.id, 'offgrid');
    expect((await request(app()).get('/produtos/cpf').set('x-user', b.id)).body).toEqual({ cpf: null });
    expect(mascararCpf('123')).toBeNull();
  });
});

describe('GET /produtos/pix/:id', () => {
  it('so o dono le: outro usuario e id invalido dao 404', async () => {
    const a = usuario();
    const b = usuario({ email: 'outro@empresa.com.br' });
    const { body } = await pagar(a.id, 'inventario');
    expect((await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', b.id)).status).toBe(404);
    expect((await request(app()).get('/produtos/pix/nao-e-uuid').set('x-user', a.id)).status).toBe(404);
    expect((await request(app()).get(`/produtos/pix/${randomUUID()}`).set('x-user', a.id)).status).toBe(404);
    const ok = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', a.id);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'pendente', produto: 'inventario', liberado: false });
    expect(ok.body.proximo).toBeUndefined();
  });

  it('pendente consulta o Asaas, e se foi pago libera e devolve liberado + proximo', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'inventario');
    H.statusAsaas.v = 'RECEIVED';
    const r = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'pago', produto: 'inventario', liberado: true, proximo: { produto: 'offgrid', nome: 'Venda Off-Grid', preco: 97 } });
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0]).toMatchObject({ user_id: u.id, produto: 'inventario', origem: 'compra', order_id: `pix:${body.cobrancaId}` });
    expect(cobrancas()[0]).toMatchObject({ status: 'pago' });
    expect(cobrancas()[0].liberado_em).toBeTruthy();
    expect((await acessos(u.id)).produtos.has('inventario')).toBe(true);
  });

  it('consulta o Asaas no maximo uma vez a cada 5 s por cobranca', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'inventario');
    const consultas = () => H.asaasFetch.mock.calls.filter(([p, i]) => p === '/payments/pay_1' && (i?.method ?? 'GET') === 'GET').length;
    for (let i = 0; i < 4; i++) await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(consultas()).toBe(1);
    cobrancas()[0].consultado_em = new Date(Date.now() - 6_000).toISOString();
    await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(consultas()).toBe(2);
  });

  it('Asaas fora do ar na consulta: a tela continua pendente, sem 500', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'inventario');
    H.asaasFetch.mockRejectedValueOnce(new Error('rede'));
    const r = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'pendente', liberado: false });
  });

  it('vencida sem pagamento aparece como expirado', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'inventario');
    cobrancas()[0].expira_em = new Date(Date.now() - 60_000).toISOString();
    cobrancas()[0].consultado_em = new Date().toISOString();
    const r = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(r.body).toMatchObject({ status: 'expirado', liberado: false });
  });

  it('o proximo pula o que a pessoa ja tem, na ordem Off-grid, Estoque, Fecha Vendas, LimpaPro', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'offgrid', origem: 'compra', expira_em: null });
    semear('kit_pedidos', { order_id: 'K1', email: EMAIL, user_id: u.id, itens: ['kit'], status: 'paid', criado_em: new Date().toISOString() });
    const { body } = await pagar(u.id, 'inventario');
    H.statusAsaas.v = 'CONFIRMED';
    const r = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    // tem Off-grid e Fecha Vendas, acabou de comprar Estoque: sobra so o LimpaPro
    expect(r.body.proximo).toEqual({ produto: 'curso-limpapro', nome: 'LimpaPro', preco: 47 });
    // com o LimpaPro tambem, nao ha proximo
    semear('limpapro_entitlements', { email: EMAIL, item: 'curso-principal', ativo: true });
    const r2 = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(r2.body.proximo).toBeUndefined();
  });
});

describe('liberacao de cada produto pela mesma via da Kiwify', () => {
  async function pagarEPagar(produto: string, userId: string) {
    const { body } = await pagar(userId, produto);
    const c = cobrancas().find((x) => x.id === body.cobrancaId)!;
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c));
    return { c, r };
  }

  it('Venda Off-Grid: entitlement e offgrid_desde, com o credito de R$ 97', async () => {
    const u = usuario();
    const { r } = await pagarEPagar('offgrid', u.id);
    expect(r).toMatchObject({ tratado: true, motivo: 'produto liberado' });
    expect(db.entitlements.filter((e) => e.produto === 'offgrid')).toHaveLength(1);
    const dono = db.users.find((x) => x.id === u.id)!;
    expect(dono.offgrid_desde).toBeTruthy();
    expect(dono.offgrid_credito).toBe(97);
    expect((await acessos(u.id)).produtos.has('offgrid')).toBe(true);
  });

  it('Estoque em Dia: entitlement inventario', async () => {
    const u = usuario();
    await pagarEPagar('inventario', u.id);
    expect((await acessos(u.id)).origem.inventario).toBe('compra');
  });

  it('Fecha Vendas: pedido pago em kit_pedidos (o que o curso e o menu leem), mesmo para quem nao assina', async () => {
    const u = usuario();
    await pagarEPagar('curso-fechamento', u.id);
    expect(db.kit_pedidos).toHaveLength(1);
    expect(db.kit_pedidos[0]).toMatchObject({ user_id: u.id, email: EMAIL, itens: ['kit'], status: 'paid', valor: 27 });
    const a = await acessos(u.id);
    expect(a.produtos.has('curso-fechamento')).toBe(true);
    expect(a.assinante).toBe(false);
  });

  it('LimpaPro: curso-principal ativo em limpapro_entitlements, por e-mail da conta, sem bonus', async () => {
    const u = usuario({ email: 'Cliente@Empresa.com.br' });
    await pagarEPagar('curso-limpapro', u.id);
    expect(db.limpapro_entitlements).toEqual([{ id: expect.any(String), email: 'cliente@empresa.com.br', item: 'curso-principal', ativo: true, criado_em: expect.any(String) }]);
    expect((await acessos(u.id)).origem['curso-limpapro']).toBe('compra');
  });

  it('LimpaPro: entitlement que ja existia desativado volta a ficar ativo, sem linha nova', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'curso-principal', ativo: false });
    await pagarEPagar('curso-limpapro', u.id);
    expect(db.limpapro_entitlements).toHaveLength(1);
    expect(db.limpapro_entitlements[0].ativo).toBe(true);
  });
});

describe('webhook do Asaas', () => {
  it('confirmado libera UMA vez so, mesmo chegando duas vezes (RECEIVED + CONFIRMED e reentrega)', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'curso-fechamento');
    const c = cobrancas()[0];
    const p = pagamentoDe(c);
    const r1 = await tratarWebhookProduto('PAYMENT_CONFIRMED', p);
    const r2 = await tratarWebhookProduto('PAYMENT_RECEIVED', p);
    const r3 = await tratarWebhookProduto('PAYMENT_RECEIVED', p);
    expect(r1.motivo).toBe('produto liberado');
    expect(r2.motivo).toBe('produto ja liberado');
    expect(r3.motivo).toBe('produto ja liberado');
    expect(db.kit_pedidos).toHaveLength(1);
    const carimbo = cobrancas()[0].liberado_em;
    await tratarWebhookProduto('PAYMENT_RECEIVED', p);
    expect(cobrancas()[0].liberado_em).toBe(carimbo);
    expect(body.cobrancaId).toBe(c.id);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it('dois eventos ao mesmo tempo (webhook + webhook, ou webhook + tela) concedem uma vez so', async () => {
    const u = usuario();
    await pagar(u.id, 'offgrid');
    const c = cobrancas()[0];
    const [a, b] = await Promise.all([
      tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c)),
      tratarWebhookProduto('PAYMENT_CONFIRMED', pagamentoDe(c)),
    ]);
    expect([a.motivo, b.motivo].sort()).toEqual(['produto ja liberado', 'produto liberado']);
    expect(db.entitlements.filter((e) => e.produto === 'offgrid')).toHaveLength(1);
  });

  it('passa pelo processarWebhookAsaas sem tocar no trilho do plano (nenhum contrato e consultado)', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    const r = await processarWebhookAsaas({ id: 'evt-1', event: 'PAYMENT_RECEIVED', payment: pagamentoDe(c) } as never);
    expect(r).toMatchObject({ tratado: true, motivo: 'produto liberado' });
    expect(db.asaas_pix_assinaturas).toBeUndefined();
    // O banco falso nao tem a chave unica de asaas_webhook_events: a reentrega chega ate a trava da cobranca.
    const repetido = await processarWebhookAsaas({ id: 'evt-1b', event: 'PAYMENT_CONFIRMED', payment: pagamentoDe(c) } as never);
    expect(repetido.motivo).toBe('produto ja liberado');
    expect(db.entitlements).toHaveLength(1);
  });

  it('valor diferente do cobrado nao libera e avisa a operacao', async () => {
    const u = usuario();
    await pagar(u.id, 'offgrid');
    const c = cobrancas()[0];
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c, { value: 10 }));
    expect(r.tratado).toBe(false);
    expect(cobrancas()[0].liberado_em).toBeFalsy();
    expect(db.entitlements ?? []).toHaveLength(0);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('referencia de outro usuario ou pagamento sem cobranca: nada liberado, operacao avisada', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    const alheia = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c, { externalReference: refDaCobranca('inventario', c.id, randomUUID()) }));
    expect(alheia.tratado).toBe(false);
    const orfa = await tratarWebhookProduto('PAYMENT_RECEIVED', { id: 'pay_que_nao_existe', value: 67, externalReference: refDaCobranca('inventario', randomUUID(), randomUUID()) });
    expect(orfa.tratado).toBe(false);
    expect(db.entitlements ?? []).toHaveLength(0);
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
  });

  it('reembolso e exclusao so marcam o status e avisam: o acesso nao e revogado', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c));
    const r = await tratarWebhookProduto('PAYMENT_REFUNDED', pagamentoDe(c));
    expect(r.tratado).toBe(true);
    expect(cobrancas()[0].status).toBe('reembolsado');
    expect(db.entitlements).toHaveLength(1);
    expect((await acessos(u.id)).produtos.has('inventario')).toBe(true);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);

    // cobranca pendente excluida: so marca
    const u2 = usuario({ email: 'dois@empresa.com.br' });
    await pagar(u2.id, 'offgrid');
    const c2 = cobrancas().find((x) => x.user_id === u2.id)!;
    await tratarWebhookProduto('PAYMENT_DELETED', pagamentoDe(c2));
    expect(cobrancas().find((x) => x.id === c2.id)!.status).toBe('cancelado');
    expect(cobrancas().find((x) => x.id === c2.id)!.liberado_em).toBeFalsy();
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
  });

  it('pagamento em duplicidade (a conta ja tinha o produto) libera sem duplicar e avisa a operacao', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'compra', expira_em: null });
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(db.entitlements).toHaveLength(1);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('liberarCobranca em cobranca ja liberada nao faz nada', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    await liberarCobranca(c as never);
    const r = await liberarCobranca({ ...c, liberado_em: new Date().toISOString() } as never);
    expect(r).toEqual({ liberado: true, novo: false });
    expect(db.entitlements).toHaveLength(1);
  });
});
