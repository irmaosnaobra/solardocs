import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Pix AVULSO do funil (03/11/2026): POST/GET /pix-avulso/publico, atrás de PIX_AVULSO_FUNIL.
// Asaas e system_state simulados: nada aqui toca banco, Asaas ou rede.

const H = vi.hoisted(() => ({
  estado: new Map<string, Record<string, any>>(),
  asaasFetch: vi.fn(),
  falhaGravar: { v: false },
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/asaas/asaasClient', () => ({
  asaasHabilitado: () => true,
  AsaasError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  asaasFetch: (...a: unknown[]) => H.asaasFetch(...a),
}));
vi.mock('../services/asaas/asaasWebhookService', () => ({
  processarWebhookAsaas: vi.fn(),
  lerEstado: async (k: string) => H.estado.get(k) ?? null,
  gravarSoSeNovo: async (k: string, v: Record<string, any>) => {
    if (H.falhaGravar.v) return 'erro';
    if (H.estado.has(k)) return 'existia';
    H.estado.set(k, v);
    return 'novo';
  },
}));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  criarPixRecorrente: vi.fn(), buscarAssinaturaPorId: vi.fn(), buscarAssinaturaAtiva: vi.fn(), cancelarPixRecorrente: vi.fn(),
  docValido: () => true,
  soDigitos: (v: unknown) => String(v ?? '').replace(/\D/g, ''),
  PLANOS_PIX: { vip: { nome: 'VIP', valor: 67 } },
  gravarEstado: async (k: string, v: Record<string, any>) => { H.estado.set(k, v); },
}));

import { criarPixAvulsoPublicoHandler, statusPixAvulsoPublicoHandler } from '../controllers/asaasPixController';
import { _resetChavePixAsaas, chavePixAsaas } from '../services/asaas/pixAvulsoAsaas';
import { pixAvulsoFunilAtivo } from '../utils/pixInfo';

function app() {
  const a = express();
  a.use(express.json());
  a.post('/pix-avulso/publico', criarPixAvulsoPublicoHandler);
  a.get('/pix-avulso/publico/:id', statusPixAvulsoPublicoHandler);
  return a;
}

const CHAVE = 'chave-pix-secreta-123';
const corpoLp = {
  email: 'Ana@Exemplo.com', whatsapp: '(34) 99999-0000', nome: 'Ana', origem: 'lp_solardoc',
  lp_session: 'sess-lp', utm_source: 'fb', utm_term: '120000000001', fbc: 'fb.1.2.3', fbp: 'fb.1.2',
};

const ENV = ['PIX_AVULSO_FUNIL', 'PIX_PUBLICO_ATIVO', 'PIX_AUTO_QUIZ', 'PIX_AUTO_LP'] as const;
const salvo: Record<string, string | undefined> = {};

let contadorQr = 0;
function asaasOk(over: { chaves?: unknown[] } = {}) {
  H.asaasFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/pix/addressKeys')) return { data: over.chaves ?? [{ id: 'k1', key: CHAVE, status: 'ACTIVE' }] };
    if (path === '/pix/qrCodes/static') return { id: `qr-${++contadorQr}`, payload: '000201PAYLOAD', encodedImage: 'AAAA', expirationDate: '2026-11-04 10:00:00' };
    throw new Error(`rota inesperada: ${path}`);
  });
}

beforeEach(() => {
  for (const k of ENV) { salvo[k] = process.env[k]; delete process.env[k]; }
  H.estado.clear(); H.falhaGravar.v = false; contadorQr = 0;
  H.asaasFetch.mockReset(); asaasOk();
  _resetChavePixAsaas();
});
afterEach(() => {
  for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
});

describe('pixAvulsoFunilAtivo', () => {
  it('só liga com PIX_AVULSO_FUNIL = true; as outras travas não ligam esta', () => {
    expect(pixAvulsoFunilAtivo()).toBe(false);
    process.env.PIX_PUBLICO_ATIVO = 'true'; process.env.PIX_AUTO_QUIZ = 'true'; process.env.PIX_AUTO_LP = 'true';
    expect(pixAvulsoFunilAtivo()).toBe(false);
    process.env.PIX_AVULSO_FUNIL = ' True ';
    expect(pixAvulsoFunilAtivo()).toBe(true);
  });
});

describe('POST /pix-avulso/publico', () => {
  it('trava desligada: 503, e nada vai ao Asaas', async () => {
    const r = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(r.status).toBe(503);
    expect(H.asaasFetch).not.toHaveBeenCalled();
  });

  it('origem ausente ou desconhecida: 503 mesmo com a trava ligada', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    for (const origem of [undefined, 'outra_lp', 'QUIZ_SOLARDOC']) {
      const r = await request(app()).post('/pix-avulso/publico').send({ ...corpoLp, origem });
      expect(r.status).toBe(503);
    }
    expect(H.asaasFetch).not.toHaveBeenCalled();
  });

  it('e-mail inválido: 400', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    for (const email of [undefined, '', 'sem-arroba', 'a@b', 12345]) {
      const r = await request(app()).post('/pix-avulso/publico').send({ ...corpoLp, email });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Informe um e-mail válido');
    }
    expect(H.asaasFetch).not.toHaveBeenCalled();
  });

  it('LP sem WhatsApp (ou curto demais): 400; o quiz passa sem WhatsApp', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    for (const whatsapp of [undefined, '', '12345']) {
      const r = await request(app()).post('/pix-avulso/publico').send({ ...corpoLp, whatsapp });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Informe o seu WhatsApp');
    }
    const quiz = await request(app()).post('/pix-avulso/publico').send({ email: 'q@exemplo.com', origem: 'quiz_solardoc' });
    expect(quiz.status).toBe(200);
  });

  it('caminho bom: devolve o contrato, grava as duas chaves e não vaza a chave Pix', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    const antes = Date.now();
    const r = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['encodedImage', 'expiraEm', 'id', 'payload', 'valor']);
    expect(r.body).toMatchObject({ payload: '000201PAYLOAD', encodedImage: 'AAAA', valor: 67 });
    expect(r.body.encodedImage).not.toMatch(/^data:/);
    expect(JSON.stringify(r.body)).not.toContain(CHAVE);

    // expiraEm: ISO em UTC, ~24 h depois de agora (nosso relógio, não o texto sem fuso do Asaas).
    expect(r.body.expiraEm).toMatch(/Z$/);
    const dt = Date.parse(r.body.expiraEm) - antes;
    expect(dt).toBeGreaterThan(86400_000 - 5000);
    expect(dt).toBeLessThan(86400_000 + 5000);

    // Chamadas ao Asaas: a chave ativa e o QR estático com o corpo combinado.
    const post = H.asaasFetch.mock.calls.find((c) => c[0] === '/pix/qrCodes/static')![1];
    expect(post.method).toBe('POST');
    expect(post.body).toMatchObject({
      addressKey: CHAVE, description: 'SolarDoc VIP mensal', value: 67, format: 'ALL', expirationSeconds: 86400, allowsMultiplePayments: false,
    });
    expect(post.body.externalReference).toBe(`sdav:${r.body.id}`);

    const reg = H.estado.get(`pix_avulso:${r.body.id}`)!;
    expect(reg).toMatchObject({
      status: 'pendente', qrId: 'qr-1', email: 'ana@exemplo.com', whatsapp: '34999990000', nome: 'Ana', origem: 'lp_solardoc',
      expira_em: r.body.expiraEm,
    });
    expect(reg.atrib).toMatchObject({ origem: 'lp_solardoc', utm_term: '120000000001', lp_session: 'sess-lp', fbc: 'fb.1.2.3', fbp: 'fb.1.2' });
    expect(H.estado.get('pix_avulso_qr:qr-1')).toMatchObject({ id: r.body.id });
    expect(JSON.stringify([...H.estado.values()])).not.toContain(CHAVE);
  });

  it('[4] mesmo e-mail com checkout pendente e mais de 15 min de validade: devolve o MESMO código, sem QR novo', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    const a = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    const b = await request(app()).post('/pix-avulso/publico').send({ ...corpoLp, email: 'ANA@exemplo.com', nome: 'Outro' });
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(H.asaasFetch.mock.calls.filter((c) => c[0] === '/pix/qrCodes/static')).toHaveLength(1);
    expect(H.estado.get('pix_avulso_email:ana@exemplo.com')).toMatchObject({ id: a.body.id });
    // outro e-mail não reaproveita
    const c = await request(app()).post('/pix-avulso/publico').send({ ...corpoLp, email: 'bia@exemplo.com' });
    expect(c.body.id).not.toBe(a.body.id);
  });

  it('[4] checkout que vence em menos de 15 min, já pago ou com valor menor: cria um QR novo', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    const a = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    const chave = `pix_avulso:${a.body.id}`;

    H.estado.get(chave)!.expira_em = new Date(Date.now() + 10 * 60_000).toISOString();
    const b = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(b.body.id).not.toBe(a.body.id);
    expect(H.asaasFetch.mock.calls.filter((c) => c[0] === '/pix/qrCodes/static')).toHaveLength(2);

    H.estado.get(`pix_avulso:${b.body.id}`)!.status = 'pago';
    const c = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(c.body.id).not.toBe(b.body.id);

    H.estado.get(`pix_avulso:${c.body.id}`)!.status = 'valor_menor';
    const d = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(d.body.id).not.toBe(c.body.id);
    expect(H.estado.get('pix_avulso_email:ana@exemplo.com')).toMatchObject({ id: d.body.id });
  });

  it('nome ausente vira "Cliente"', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    const r = await request(app()).post('/pix-avulso/publico').send({ ...corpoLp, nome: undefined });
    expect(r.status).toBe(200);
    expect(H.estado.get(`pix_avulso:${r.body.id}`)!.nome).toBe('Cliente');
  });

  it('a chave Pix fica 1 h em memória; a falta de chave dá 503 e NÃO fica guardada', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    await request(app()).post('/pix-avulso/publico').send(corpoLp);
    await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(H.asaasFetch.mock.calls.filter((c) => String(c[0]).startsWith('/pix/addressKeys'))).toHaveLength(1);

    _resetChavePixAsaas(); H.asaasFetch.mockReset(); asaasOk({ chaves: [] }); H.estado.clear(); // sem checkout pendente para reaproveitar
    const sem = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(sem.status).toBe(503);
    expect(sem.body.error).toBe('Pix indisponível agora');
    asaasOk(); H.estado.clear(); // o mock devolve sempre o mesmo id de QR
    const volta = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(volta.status).toBe(200);
  });

  it('chavePixAsaas devolve a primeira ativa', async () => {
    asaasOk({ chaves: [{ key: 'primeira', status: 'ACTIVE' }, { key: 'segunda', status: 'ACTIVE' }] });
    expect(await chavePixAsaas()).toBe('primeira');
  });

  it('Asaas recusa o QR: 502 genérico, sem repassar o texto do Asaas, e nada fica gravado', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    const { AsaasError } = await import('../services/asaas/asaasClient');
    H.asaasFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/pix/addressKeys')) return { data: [{ key: CHAVE, status: 'ACTIVE' }] };
      throw new (AsaasError as any)(400, 'detalhe interno do Asaas');
    });
    const r = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('Pix indisponível agora');
    expect(H.estado.size).toBe(0);
  });

  it('se o estado não grava, o código NÃO é entregue', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    H.falhaGravar.v = true;
    const r = await request(app()).post('/pix-avulso/publico').send(corpoLp);
    expect(r.status).toBe(502);
    expect(r.body.payload).toBeUndefined();
  });
});

describe('GET /pix-avulso/publico/:id', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  const reg = (over: Record<string, unknown> = {}) => H.estado.set(`pix_avulso:${ID}`, {
    status: 'pendente', email: 'x@y.com', expira_em: new Date(Date.now() + 3600_000).toISOString(), ...over,
  });

  it('trava desligada: 503', async () => {
    reg();
    expect((await request(app()).get(`/pix-avulso/publico/${ID}`)).status).toBe(503);
  });

  it('pendente, pago e expirado; devolve só { status, valor }', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    reg();
    const pend = await request(app()).get(`/pix-avulso/publico/${ID}`);
    expect(pend.status).toBe(200);
    expect(pend.body).toEqual({ status: 'pendente', valor: 67 });

    reg({ status: 'pago', pago_em: 'x' });
    expect((await request(app()).get(`/pix-avulso/publico/${ID}`)).body).toEqual({ status: 'pago', valor: 67 });

    // pago vence o relógio
    reg({ status: 'pago', expira_em: new Date(Date.now() - 1000).toISOString() });
    expect((await request(app()).get(`/pix-avulso/publico/${ID}`)).body.status).toBe('pago');

    reg({ expira_em: new Date(Date.now() - 1000).toISOString() });
    expect((await request(app()).get(`/pix-avulso/publico/${ID}`)).body).toEqual({ status: 'expirado', valor: 67 });
  });

  it('valor_menor segue o relógio (nunca aparece como status)', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    reg({ status: 'valor_menor' });
    expect((await request(app()).get(`/pix-avulso/publico/${ID}`)).body.status).toBe('pendente');
  });

  it('id que não é uuid ou não existe: 404', async () => {
    process.env.PIX_AVULSO_FUNIL = 'true';
    expect((await request(app()).get('/pix-avulso/publico/abc')).status).toBe(404);
    expect((await request(app()).get(`/pix-avulso/publico/${ID}`)).status).toBe(404);
  });
});
