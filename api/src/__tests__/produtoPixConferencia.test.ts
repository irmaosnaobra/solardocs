import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Compra por Pix, 2a revisao: conferencia final incerta (banco piscando) nao e falha permanente; erros com `code` de
// schema (42703, 23514) viram permanentes e os de rede seguem transitorios; offgrid_desde nao lido nao regrava o
// credito; corrida no DELETE da cobranca substituida; alerta que nao saiu nao carimba a hora de silencio.
// Banco em memoria e Asaas simulado; CPFs de teste (digito verificador valido).
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  asaasFetch: vi.fn(),
  statusAsaas: { v: 'PENDING' },
  pagamentos: 0,
  deleteFalha: { v: false },
  getFalha: { v: false },
  /** valor que o Asaas devolve no GET (undefined: o da cobranca registrada). */
  valorAsaas: { v: undefined as number | undefined },
  /** quantas proximas chamadas de acessos() "nao enxergam nada" (leitura que engoliu erro). Infinity = todas. */
  cegar: { n: 0 },
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
// acessos() com "cegueira" controlada: simula a leitura que engole o erro do banco e devolve "nao tem nada".
vi.mock('../services/produtos/acessos', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/produtos/acessos')>();
  return {
    ...real,
    acessos: async (...a: Parameters<typeof real.acessos>) => {
      if (H.cegar.n > 0) {
        H.cegar.n -= 1;
        return { produtos: new Set<string>(), plano: 'free', assinante: false, isAdmin: false, origem: {} };
      }
      return real.acessos(...a);
    },
  };
});

import { db, falhas, limpar, semear } from './helpers/dbFalso';
import { sendOpsAlert } from '../utils/mailer';
import { concederAcesso } from '../services/produtos/acessos';
import { liberarOffGrid } from '../services/offgrid/acesso';
import { criarPixProdutoHandler, statusPixProdutoHandler } from '../controllers/produtoPixController';
import { tratarWebhookProduto, refDaCobranca, JANELA_REENVIO_CONFERENCIA_MS } from '../services/produtos/produtoPix';
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
const cobrancas = () => db.produto_cobrancas ?? [];
function pagamentoDe(c: Record<string, any>) {
  return { id: c.asaas_payment_id, value: Number(c.valor), externalReference: refDaCobranca(c.produto, c.id, c.user_id) };
}

beforeEach(() => {
  limpar('users', 'entitlements', 'kit_pedidos', 'limpapro_entitlements', 'limpapro_membros', 'produto_cobrancas', 'asaas_webhook_events');
  vi.mocked(sendOpsAlert).mockReset();
  vi.mocked(sendOpsAlert).mockResolvedValue(undefined);
  H.statusAsaas.v = 'PENDING';
  H.deleteFalha.v = false;
  H.getFalha.v = false;
  H.valorAsaas.v = undefined;
  H.cegar.n = 0;
  H.pagamentos = 0;
  const dois = new Date(Date.now() + 2 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  H.asaasFetch.mockReset();
  H.asaasFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    const metodo = init?.method ?? 'GET';
    if (path === '/payments' && metodo === 'POST') { H.pagamentos += 1; return { id: `pay_${H.pagamentos}` }; }
    if (/\/pixQrCode$/.test(path)) return { encodedImage: 'QRBASE64', payload: '00020126PIXCOPIAECOLA', expirationDate: `${dois} 23:59:59` };
    if (/^\/payments\/[^/]+$/.test(path) && metodo === 'GET') {
      if (H.getFalha.v) throw new Error('Asaas fora do ar');
      const linha = cobrancas().find((x) => `/payments/${x.asaas_payment_id}` === path);
      return { status: H.statusAsaas.v, value: H.valorAsaas.v ?? (linha ? Number(linha.valor) : undefined) };
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

describe('1. conferencia final incerta nao fecha a porta', () => {
  it('a primeira leitura da conferencia falha mas a segunda enxerga: libera, sem erro e sem alerta', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    H.cegar.n = 2; // "antes" e a 1a leitura da conferencia; a 2a leitura enxerga
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(r.motivo).toBe('produto liberado');
    expect(cobrancas()[0].liberado_em).toBeTruthy();
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it('nao enxerga nas duas leituras: NAO e permanente. Trava devolvida, alerta, 500 para o Asaas reenviar, e a reentrega libera', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    const c = cobrancas()[0];
    H.cegar.n = 3; // antes + 2 leituras da conferencia
    await expect(processarWebhookAsaas({ id: 'evt-c1', event: 'PAYMENT_RECEIVED', payment: pagamentoDe(c) } as never)).rejects.toThrow(/conferencia/);
    // a concessao FOI gravada; so a conferencia nao pode confirmar
    expect(db.entitlements).toHaveLength(1);
    expect(cobrancas()[0].liberado_em).toBeFalsy();
    expect(cobrancas()[0].status).toBe('pago');
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    // o evento volta a ser reenviavel (nao fica como "ja visto")
    expect(db.asaas_webhook_events.some((e) => e.event_id === 'evt-c1')).toBe(false);

    H.cegar.n = 0;
    const de_novo = await processarWebhookAsaas({ id: 'evt-c1', event: 'PAYMENT_RECEIVED', payment: pagamentoDe(c) } as never);
    expect(de_novo.motivo).toBe('produto liberado');
    expect(db.entitlements).toHaveLength(1);
  });

  it('a tela tambem refaz: o GET seguinte libera', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'inventario');
    H.cegar.n = 3;
    await expect(tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]))).rejects.toThrow();
    H.cegar.n = 0;
    cobrancas()[0].consultado_em = new Date(Date.now() - 6_000).toISOString();
    const r = await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(r.body).toMatchObject({ status: 'pago', liberado: true });
  });

  it('sem risco de loop: passada a janela desde o pagamento, o webhook responde 200 tratado:false (nao 500)', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    cobrancas()[0].pago_em = new Date(Date.now() - JANELA_REENVIO_CONFERENCIA_MS - 60_000).toISOString();
    H.cegar.n = 3;
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(r.tratado).toBe(false);
    expect(r.motivo).toMatch(/nova tentativa/);
    expect(cobrancas()[0].liberado_em).toBeFalsy();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });
});

describe('3. erro com `code` do banco: schema vira permanente, rede segue transitoria', () => {
  it('concederAcesso com lancarErro leva o code do Postgres', async () => {
    const u = usuario();
    falhas.colunaAusente.add('expira_em');
    await expect(concederAcesso({ userId: u.id, produto: 'inventario', lancarErro: true })).rejects.toMatchObject({ code: '42703' });
    falhas.colunaAusente.clear();
    falhas.erroInsercao.set('entitlements', '23514');
    await expect(concederAcesso({ userId: u.id, produto: 'inventario', lancarErro: true })).rejects.toMatchObject({ code: '23514' });
  });

  it('42703 (coluna inexistente) no entitlements: o webhook responde 200 e avisa, sem 500 em loop', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    falhas.erroInsercao.set('entitlements', '42703');
    const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(r.tratado).toBe(false);
    expect(cobrancas()[0].liberado_em).toBeFalsy();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('23514 (violacao de CHECK) tambem e permanente, no Estoque e no Off-grid', async () => {
    for (const produto of ['inventario', 'offgrid']) {
      limpar('users', 'entitlements', 'produto_cobrancas');
      vi.mocked(sendOpsAlert).mockClear();
      const u = usuario();
      await pagar(u.id, produto);
      falhas.erroInsercao.set('entitlements', '23514');
      const r = await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
      expect(r.tratado).toBe(false);
      expect(r.motivo).toMatch(/nova tentativa/);
    }
  });

  it('erro de rede (57014) no entitlements continua transitorio: lanca para o Asaas reenviar', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    falhas.erroInsercao.set('entitlements', '57014');
    await expect(tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]))).rejects.toThrow();
    expect(cobrancas()[0].liberado_em).toBeFalsy();
  });
});

describe('4. liberarOffGrid nunca regrava o credito sem ter lido o estado', () => {
  it('garantirPosse: leitura de offgrid_desde com erro lanca e NAO grava credito, data nem entitlement', async () => {
    const u = usuario({ offgrid_desde: null, offgrid_credito: 0 });
    falhas.colunaAusente.add('offgrid_desde'); // faz so o SELECT daquela coluna voltar com erro
    await expect(liberarOffGrid(u.id, 97, { garantirPosse: true })).rejects.toMatchObject({ code: '42703' });
    const dono = db.users.find((x) => x.id === u.id)!;
    expect(dono.offgrid_credito).toBe(0);
    expect(dono.offgrid_desde).toBeNull();
    expect(db.entitlements ?? []).toHaveLength(0);
  });

  it('garantirPosse com a leitura quebrada no pagamento: o webhook responde 200 + alerta (code 42703) e o credito de R$ 97 nao e regravado', async () => {
    const u = usuario({ offgrid_desde: '2026-01-01T00:00:00Z', offgrid_credito: 0 });
    // offgrid_desde ja preenchido: a conta e a mesma de quem comprou antes; o credito ja usado fica 0
    await pagar(u.id, 'offgrid');
    falhas.colunaAusente.add('offgrid_desde');
    await expect(tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]))).resolves.toMatchObject({ tratado: false });
    expect(db.users.find((x) => x.id === u.id)!.offgrid_credito).toBe(0);
  });

  it('sem a opcao (Kiwify) o comportamento e o de antes: nao lanca', async () => {
    const u = usuario({ offgrid_desde: null, offgrid_credito: 0 });
    falhas.colunaAusente.add('offgrid_desde');
    await expect(liberarOffGrid(u.id, 97)).resolves.toBe(true);
  });
});

describe('5. corrida no DELETE da cobranca substituida', () => {
  it('DELETE falha porque a antiga acabou de ser paga: apaga a nova, libera pela antiga e responde 409 jaTem', async () => {
    const u = usuario();
    const a = await pagar(u.id, 'inventario');
    H.deleteFalha.v = true;
    H.statusAsaas.v = 'RECEIVED';
    const b = await pagar(u.id, 'inventario', { cpf: OUTRO_CPF });
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ jaTem: true });

    const antiga = cobrancas().find((x) => x.id === a.body.cobrancaId)!;
    expect(antiga.status).toBe('pago');
    expect(antiga.liberado_em).toBeTruthy();
    expect(db.entitlements).toHaveLength(1);
    const nova = cobrancas().find((x) => x.id !== a.body.cobrancaId)!;
    expect(nova.status).toBe('cancelado');
    expect(H.asaasFetch.mock.calls.some(([p, i]) => p === `/payments/${nova.asaas_payment_id}` && i?.method === 'DELETE')).toBe(true);
  });

  it('DELETE falha, a antiga continua pendente no Asaas: o POST segue com a nova e a antiga volta a pendente', async () => {
    const u = usuario();
    const a = await pagar(u.id, 'inventario');
    H.deleteFalha.v = true;
    const b = await pagar(u.id, 'inventario', { cpf: OUTRO_CPF });
    expect(b.status).toBe(200);
    expect(cobrancas().find((x) => x.id === a.body.cobrancaId)!.status).toBe('pendente');
    expect(cobrancas().find((x) => x.id === b.body.cobrancaId)!.status).toBe('pendente');
  });

  it('DELETE falha e nao da para consultar a antiga: o POST segue e nada e liberado', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    H.deleteFalha.v = true;
    H.getFalha.v = true;
    const b = await pagar(u.id, 'inventario', { cpf: OUTRO_CPF });
    expect(b.status).toBe(200);
    expect(db.entitlements ?? []).toHaveLength(0);
  });

  it('antiga paga com valor menor nao libera nada pela antiga', async () => {
    const u = usuario();
    await pagar(u.id, 'inventario');
    H.deleteFalha.v = true;
    H.statusAsaas.v = 'RECEIVED';
    H.valorAsaas.v = 10; // o Asaas confirma menos do que a cobranca registrada (67)
    const b = await pagar(u.id, 'inventario', { cpf: OUTRO_CPF });
    expect(b.status).toBe(200);
    expect(db.entitlements ?? []).toHaveLength(0);
  });
});

describe('6. alerta que nao saiu nao carimba a hora de silencio', () => {
  it('o e-mail falha: alertado_em volta a vazio e a proxima falha avisa de novo', async () => {
    const u = usuario();
    const { body } = await pagar(u.id, 'curso-limpapro');
    falhas.tabelaQuebrada.add('limpapro_entitlements');
    vi.mocked(sendOpsAlert).mockRejectedValueOnce(new Error('Resend fora do ar'));
    await tratarWebhookProduto('PAYMENT_RECEIVED', pagamentoDe(cobrancas()[0]));
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(cobrancas()[0].alertado_em).toBeFalsy();

    cobrancas()[0].consultado_em = new Date(Date.now() - 6_000).toISOString();
    await request(app()).get(`/produtos/pix/${body.cobrancaId}`).set('x-user', u.id);
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
    expect(cobrancas()[0].alertado_em).toBeTruthy();
  });
});
