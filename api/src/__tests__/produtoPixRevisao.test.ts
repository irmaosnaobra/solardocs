import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Compra por Pix: o que a revisao pediu. Falha permanente x transitoria no webhook, alerta no maximo 1 por hora,
// valor conferido em todos os caminhos, cobranca substituida apagada no Asaas, LimpaPro com membro, posse vencida.
// Banco em memoria e Asaas simulado; CPFs de teste (digito verificador valido).
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  asaasFetch: vi.fn(),
  statusAsaas: { v: 'PENDING' },
  pagamentos: 0,
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
import { logger } from '../utils/logger';
import { concederAcesso, acessos } from '../services/produtos/acessos';
import { liberarOffGrid } from '../services/offgrid/acesso';
import { criarPixProdutoHandler, statusPixProdutoHandler } from '../controllers/produtoPixController';
import { tratarWebhookProduto, refDaCobranca, ALERTA_INTERVALO_MS } from '../services/produtos/produtoPix';
import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';

const CPF = '529.982.247-25';
const OUTRO_CPF = '111.444.777-35';
const EMAIL = 'cliente@empresa.com.br';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.userId = String(req.headers['x-user'] || ''); next(); });
  a.post('/produtos/pix', criarPixProdutoHandler);
  a.get('/produtos/pix/:cobrancaId', statusPixProdutoHandler);
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
function consultar(userId: string, cobrancaId: string) {
  return request(app()).get(`/produtos/pix/${cobrancaId}`).set('x-user', userId);
}

const cobrancas = () => db.produto_cobrancas ?? [];

function pagamentoDe(c: Record<string, any>, over: Record<string, any> = {}) {
  return { id: c.asaas_payment_id, value: Number(c.valor), externalReference: refDaCobranca(c.produto, c.id, c.user_id), ...over };
}
const semValor = (c: Record<string, any>) => ({ id: c.asaas_payment_id, externalReference: refDaCobranca(c.produto, c.id, c.user_id) });
const seisSegundosAtras = () => new Date(Date.now() - 6_000).toISOString();

beforeEach(() => {
  limpar('users', 'entitlements', 'kit_pedidos', 'limpapro_entitlements', 'limpapro_membros', 'produto_cobrancas', 'asaas_webhook_events');
  vi.mocked(logger.error).mockClear();
  vi.mocked(sendOpsAlert).mockClear();
  H.statusAsaas.v = 'PENDING';
  H.valorAsaas.v = undefined;
  H.deleteFalha.v = false;
  H.pagamentos = 0;
  const dois = new Date(Date.now() + 2 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  H.asaasFetch.mockReset();
  H.asaasFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    const metodo = init?.method ?? 'GET';
    if (path === '/payments' && metodo === 'POST') { H.pagamentos += 1; return { id: `pay_${H.pagamentos}` }; }
    if (/\/pixQrCode$/.test(path)) return { encodedImage: 'QRBASE64', payload: '00020126PIXCOPIAECOLA', expirationDate: `${dois} 23:59:59` };
    if (/^\/payments\/[^/]+$/.test(path) && metodo === 'GET') {
      const linha = cobrancas().find((x) => `/payments/${x.asaas_payment_id}` === path);
      const valor = H.valorAsaas.v === undefined ? (linha ? Number(linha.valor) : undefined) : H.valorAsaas.v;
      return { status: H.statusAsaas.v, ...(valor === null || valor === undefined ? {} : { value: valor }) };
    }
    if (/^\/payments\/[^/]+$/.test(path) && metodo === 'DELETE') {
      if (H.deleteFalha.v) throw new Error('nao pode apagar');
      return {};
    }
    return {};
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('webhook: falha permanente x transitoria', () => {
  it('permanente (schema que nao bate): 200 tratado:false, alerta, cobranca marcada; a tela refaz e libera', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'curso-limpapro');
    const c = cobrancas()[0];
    falhas.tabelaQuebrada.add('limpapro_entitlements');
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c));
    expect(r.tratado).toBe(false);
    expect(r.motivo).toMatch(/nova tentativa/);
    expect(cobrancas()[0].liberado_em).toBeFalsy();
    expect(cobrancas()[0].status).toBe('pago');
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);

    falhas.tabelaQuebrada.delete('limpapro_entitlements');
    const g = await consultar(u.id, body.cobrancaId);
    expect(g.body).toMatchObject({ status: 'pago', liberado: true });
    expect(db.limpapro_entitlements).toHaveLength(1);
  });

  it('permanente pelo processarWebhookAsaas: nao lanca (nao pausa a fila do Asaas) e o evento fica registrado', async () => {
    const u = usuario();
    await pagar(u.id, 'curso-limpapro');
    falhas.tabelaQuebrada.add('limpapro_entitlements');
    const r = await processarWebhookAsaas({ id: 'evt-perm', event: 'PAYMENT_RECEIVED', payment: pagamentoDe(cobrancas()[0]) } as never);
    expect(r.tratado).toBe(false);
    expect(db.asaas_webhook_events.some((e) => e.event_id === 'evt-perm')).toBe(true);
  });

  it('transitoria (banco caiu): lanca para o Asaas reenviar e devolve o evento; a reentrega libera', async () => {
    const u = usuario();
    await pagar(u.id, 'curso-limpapro');
    const c = cobrancas()[0];
    falhas.tabelaInstavel.add('limpapro_entitlements');
    await expect(processarWebhookAsaas({ id: 'evt-9', event: 'PAYMENT_RECEIVED', payment: pagamentoDe(c) } as never)).rejects.toThrow();
    expect(cobrancas()[0].liberado_em).toBeFalsy();
    falhas.tabelaInstavel.delete('limpapro_entitlements');
    expect(db.asaas_webhook_events.some((e) => e.event_id === 'evt-9')).toBe(false);
    const r = await processarWebhookAsaas({ id: 'evt-9', event: 'PAYMENT_RECEIVED', payment: pagamentoDe(c) } as never);
    expect(r.motivo).toBe('produto liberado');
  });

  it('conta que ficou sem e-mail depois de pagar: permanente (200 + alerta), nao 500', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    db.users.find((x) => x.id === u.id)!.email = '';
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(r.tratado).toBe(false);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('se nem a trava puder ser devolvida, o alerta diz isso (sem a espera de 1 hora)', async () => {
    const u = usuario();
    await pagar(u.id, 'curso-limpapro');
    const c = cobrancas()[0];
    falhas.tabelaQuebrada.add('limpapro_entitlements');
    // o UPDATE que devolve a trava e o unico com `liberado_em: null`: derruba so ele
    const { supabaseFalso } = await import('./helpers/dbFalso');
    const original = supabaseFalso.from;
    vi.spyOn(supabaseFalso, 'from').mockImplementation((t: string) => {
      const q: any = original(t);
      if (t !== 'produto_cobrancas') return q;
      const update = q.update;
      q.update = (p: Record<string, unknown>) => {
        if (p && 'liberado_em' in p && p.liberado_em === null) {
          const falso: any = { eq: () => falso, then: (res: (v: unknown) => void) => res({ data: null, error: { message: 'timeout' } }) };
          return falso;
        }
        return update(p);
      };
      return q;
    });
    await expect(tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(c))).resolves.toMatchObject({ tratado: false });
    const html = String(vi.mocked(sendOpsAlert).mock.calls[0][1]);
    expect(html).toMatch(/trava/i);
    expect(html).toMatch(/timeout/);
  });
});

describe('cobranca paga sem liberar: mesma espera de 5 s e no maximo 1 alerta por hora', () => {
  async function pagaSemLiberar(userId: string) {
    const { body } = await pagar(userId, 'curso-limpapro');
    falhas.tabelaQuebrada.add('limpapro_entitlements');
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    vi.mocked(sendOpsAlert).mockClear();
    vi.mocked(logger.error).mockClear();
    return body.cobrancaId as string;
  }
  const tentativas = () => vi.mocked(logger.error).mock.calls.filter(([, m]) => String(m).includes('liberacao de curso-limpapro falhou')).length;

  it('rajada de GET: a concessao e tentada uma vez a cada 5 s, nao a cada GET', async () => {
    const u = usuario();
    const id = await pagaSemLiberar(u.id);
    for (let i = 0; i < 6; i++) await consultar(u.id, id);
    expect(tentativas()).toBe(1);
    cobrancas()[0].consultado_em = seisSegundosAtras();
    await consultar(u.id, id);
    expect(tentativas()).toBe(2);
  });

  it('no maximo 1 e-mail de alerta por cobranca por hora, mesmo com varias tentativas', async () => {
    const u = usuario();
    const id = await pagaSemLiberar(u.id);
    for (let i = 0; i < 4; i++) {
      cobrancas()[0].consultado_em = seisSegundosAtras();
      await consultar(u.id, id);
    }
    expect(tentativas()).toBe(4);
    // o webhook que falhou ja avisou (e carimbou alertado_em): as 4 tentativas seguintes nao mandam nada
    expect(sendOpsAlert).toHaveBeenCalledTimes(0);
    cobrancas()[0].alertado_em = new Date(Date.now() - ALERTA_INTERVALO_MS - 1000).toISOString();
    cobrancas()[0].consultado_em = seisSegundosAtras();
    await consultar(u.id, id);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    // e dentro da nova hora, silencio de novo
    cobrancas()[0].consultado_em = seisSegundosAtras();
    await consultar(u.id, id);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('resolvida a causa, o proprio GET libera', async () => {
    const u = usuario();
    const id = await pagaSemLiberar(u.id);
    falhas.tabelaQuebrada.delete('limpapro_entitlements');
    cobrancas()[0].consultado_em = seisSegundosAtras();
    const r = await consultar(u.id, id);
    expect(r.body).toMatchObject({ status: 'pago', liberado: true });
  });

  it('o POST de um produto ja pago e ainda sem liberar da 409 "estamos liberando", sem cobrar de novo', async () => {
    const u = usuario();
    await pagaSemLiberar(u.id);
    const antes = H.pagamentos;
    const r = await pagar(u.id, 'curso-limpapro');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ pagoAguardando: true });
    expect(r.body.jaTem).toBeUndefined();
    expect(r.body.error).toMatch(/pago/i);
    expect(H.pagamentos).toBe(antes);
  });
});

describe('o valor tem que conferir em todos os caminhos', () => {
  it('consulta da tela: Asaas diz pago com valor menor: nao libera e avisa', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'offgrid');
    H.statusAsaas.v = 'RECEIVED';
    H.valorAsaas.v = 10;
    const r = await consultar(u.id, body.cobrancaId);
    expect(r.body).toMatchObject({ status: 'pendente', liberado: false });
    expect(db.entitlements ?? []).toHaveLength(0);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('consulta da tela: Asaas sem `value` tambem nao libera', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'inventario');
    H.statusAsaas.v = 'CONFIRMED';
    H.valorAsaas.v = null;
    expect((await consultar(u.id, body.cobrancaId)).body.liberado).toBe(false);
  });

  it('webhook sem `value`: pergunta ao Asaas e libera se o valor confere', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', semValor(c));
    expect(r.motivo).toBe('produto liberado');
    expect(H.asaasFetch.mock.calls.some(([p]) => p === `/payments/${c.asaas_payment_id}`)).toBe(true);
  });

  it('webhook sem `value` e Asaas com valor menor, ou sem valor nenhum: nao libera', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    H.valorAsaas.v = 1;
    expect((await tratarWebhookProduto('PAYMENT_RECEIVED', semValor(c))).tratado).toBe(false);
    H.valorAsaas.v = null;
    expect((await tratarWebhookProduto('PAYMENT_RECEIVED', semValor(c))).tratado).toBe(false);
    expect(db.entitlements ?? []).toHaveLength(0);
    expect(cobrancas()[0].liberado_em).toBeFalsy();
  });

  it('valor maior que o cobrado libera (so o menor e recusado)', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0], { value: 80 }));
    expect(r.motivo).toBe('produto liberado');
  });
});

describe('cobranca pendente substituida some do Asaas', () => {
  it('troca de CPF: cria a nova, apaga a antiga no Asaas e marca cancelada; o PAYMENT_DELETED dela nao vira alerta', async () => {
    const u = usuario();
    const a = await pagar(u.id, 'inventario');
    const b = await pagar(u.id, 'inventario', { cpf: OUTRO_CPF });
    expect(b.body.cobrancaId).not.toBe(a.body.cobrancaId);
    expect(H.asaasFetch.mock.calls.some(([p, i]) => p === '/payments/pay_1' && i?.method === 'DELETE')).toBe(true);
    const antiga = cobrancas().find((x) => x.id === a.body.cobrancaId)!;
    expect(antiga.status).toBe('cancelado');
    expect(cobrancas().find((x) => x.id === b.body.cobrancaId)!.status).toBe('pendente');
    const r = await tratarWebhookProduto('PAYMENT_DELETED', pagamentoDe(antiga));
    expect(r.tratado).toBe(true);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it('cobranca vencida substituida: tenta apagar tambem e o POST segue mesmo se falhar', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    cobrancas()[0].expira_em = new Date(Date.now() - 60_000).toISOString();
    H.deleteFalha.v = true;
    const b = await pagar(u.id, 'inventario');
    expect(b.status).toBe(200);
    expect(cobrancas()[0].status).toBe('expirado');
  });

  it('se apagar no Asaas falhar, o POST segue e a antiga continua pendente (pode ter sido paga agora)', async () => {
    const u = usuario();
    const a = await pagar(u.id, 'inventario');
    H.deleteFalha.v = true;
    const b = await pagar(u.id, 'inventario', { cpf: OUTRO_CPF });
    expect(b.status).toBe(200);
    expect(cobrancas().find((x) => x.id === a.body.cobrancaId)!.status).toBe('pendente');
  });
});

describe('conta sem e-mail', () => {
  it('o POST recusa com 400 claro ANTES de cobrar', async () => {
    const u = usuario({ email: '' });
    const r = await pagar(u.id, 'curso-limpapro');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/e-mail/i);
    expect(H.pagamentos).toBe(0);
    expect(cobrancas()).toHaveLength(0);
  });
});

describe('LimpaPro: a area de membros reconhece o comprador', () => {
  it('cria a linha em limpapro_membros (e-mail minusculo, nome, telefone, progresso vazio) sem senha', async () => {
    const u = usuario({ email: 'Cliente@Empresa.com.br', whatsapp: '(34) 99999-0000' });
    await pagar(u.id, 'curso-limpapro');
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(db.limpapro_membros).toHaveLength(1);
    expect(db.limpapro_membros[0]).toMatchObject({ email: 'cliente@empresa.com.br', nome: 'Cliente Teste', telefone: '34999990000', progresso: {} });
    expect(db.limpapro_membros[0].senha_hash).toBeUndefined();
  });

  it('sem WhatsApp na conta, nao grava telefone', async () => {
    const u = usuario();
    await pagar(u.id, 'curso-limpapro');
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect('telefone' in db.limpapro_membros[0]).toBe(false);
  });

  it('membro que ja existia (com senha e progresso) NAO e alterado (on conflict do nothing)', async () => {
    const u = usuario();
    semear('limpapro_membros', { email: EMAIL, nome: 'Nome Antigo', senha_hash: 'hash', progresso: { 'm01#0': true }, ativo: false });
    await pagar(u.id, 'curso-limpapro');
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(db.limpapro_membros).toHaveLength(1);
    expect(db.limpapro_membros[0]).toMatchObject({ nome: 'Nome Antigo', senha_hash: 'hash', progresso: { 'm01#0': true } });
  });

  it('o webhook repetido nao duplica nada', async () => {
    const u = usuario();
    await pagar(u.id, 'curso-limpapro');
    const p = pagamentoDe(cobrancas()[0]);
    await tratarWebhookProduto('PAYMENT_CONFIRMED', p);
    await tratarWebhookProduto('PAYMENT_RECEIVED', p);
    expect(db.limpapro_membros).toHaveLength(1);
    expect(db.limpapro_entitlements).toHaveLength(1);
  });
});

describe('concederAcesso: posse vencida (so na compra por Pix; a Kiwify segue como era)', () => {
  const ontem = () => new Date(Date.now() - 86400_000).toISOString();

  it('sem opcao nenhuma (como a Kiwify chama): posse vencida continua devolvendo false e intacta', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'compra', expira_em: ontem() });
    expect(await concederAcesso({ userId: u.id, produto: 'inventario', origem: 'compra', orderId: 'K-1' })).toBe(false);
    expect(db.entitlements).toHaveLength(1);
    expect(Date.parse(db.entitlements[0].expira_em)).toBeLessThan(Date.now());
    expect(db.entitlements[0].order_id).toBeUndefined();
  });

  it('reativarVencido: tira o vencimento, grava a origem e o pedido, e devolve true', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'cortesia', expira_em: ontem() });
    expect(await concederAcesso({ userId: u.id, produto: 'inventario', origem: 'compra', orderId: 'pix:1', reativarVencido: true })).toBe(true);
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0]).toMatchObject({ expira_em: null, origem: 'compra', order_id: 'pix:1' });
  });

  it('reativarVencido nao mexe em posse que NAO venceu nem em posse sem vencimento', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'cortesia', expira_em: null });
    expect(await concederAcesso({ userId: u.id, produto: 'inventario', reativarVencido: true })).toBe(false);
    expect(db.entitlements[0].origem).toBe('cortesia');
  });

  it('lancarErro: erro de banco vira excecao; sem a opcao continua false', async () => {
    const u = usuario();
    falhas.tabelaInstavel.add('entitlements');
    await expect(concederAcesso({ userId: u.id, produto: 'inventario', lancarErro: true })).rejects.toThrow(/entitlements/);
    expect(await concederAcesso({ userId: u.id, produto: 'inventario' })).toBe(false);
  });

  it('inventario vencido: a pessoa pode comprar pelo Pix e a compra reativa a posse', async () => {
    const u = usuario();
    semear('entitlements', { user_id: u.id, produto: 'inventario', origem: 'compra', expira_em: ontem() });
    const { body } = await pagar(u.id, 'inventario');
    expect(body.cobrancaId).toBeTruthy();
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0].expira_em).toBeNull();
    expect((await acessos(u.id)).produtos.has('inventario')).toBe(true);
  });
});

describe('liberarOffGrid: offgrid_desde sem posse', () => {
  it('sem a opcao (Kiwify): offgrid_desde ja existe, sai cedo e NAO grava entitlement, como era', async () => {
    const u = usuario({ offgrid_desde: '2026-01-01T00:00:00Z', offgrid_credito: 0 });
    expect(await liberarOffGrid(u.id, 97)).toBe(false);
    expect(db.entitlements ?? []).toHaveLength(0);
    expect(db.users.find((x) => x.id === u.id)!.offgrid_credito).toBe(0);
  });

  it('garantirPosse: grava o entitlement que faltava, sem refazer o credito nem a data', async () => {
    const u = usuario({ offgrid_desde: '2026-01-01T00:00:00Z', offgrid_credito: 0 });
    expect(await liberarOffGrid(u.id, 97, { garantirPosse: true })).toBe(false);
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0]).toMatchObject({ user_id: u.id, produto: 'offgrid' });
    const dono = db.users.find((x) => x.id === u.id)!;
    expect(dono.offgrid_credito).toBe(0);
    expect(dono.offgrid_desde).toBe('2026-01-01T00:00:00Z');
  });

  it('garantirPosse: posse vencida e reativada', async () => {
    const u = usuario({ offgrid_desde: '2026-01-01T00:00:00Z' });
    semear('entitlements', { user_id: u.id, produto: 'offgrid', origem: 'compra', expira_em: new Date(Date.now() - 1000).toISOString() });
    await liberarOffGrid(u.id, 97, { garantirPosse: true });
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0].expira_em).toBeNull();
  });

  it('compra do Off-grid pelo Pix por quem tinha offgrid_desde sem posse: libera de verdade', async () => {
    const u = usuario({ offgrid_desde: '2026-01-01T00:00:00Z' });
    await pagar(u.id, 'offgrid');
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(r.motivo).toBe('produto liberado');
    expect((await acessos(u.id)).produtos.has('offgrid')).toBe(true);
  });
});
