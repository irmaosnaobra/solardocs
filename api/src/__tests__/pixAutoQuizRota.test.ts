import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Trava própria do quiz (PIX_AUTO_QUIZ), 27/10/2026: a rota pública de Pix recorrente abre
// para chamada com origem 'quiz_solardoc' sem ligar PIX_PUBLICO_ATIVO (que também muda o
// cancel_url da Stripe). Dependências simuladas: nada aqui toca banco, Asaas ou rede.

const criarPixRecorrente = vi.fn();
const buscarAssinaturaPorId = vi.fn();

vi.mock('../utils/supabase', () => {
  const q: any = {
    select: () => q, eq: () => q, update: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
  };
  return { supabase: { from: () => q } };
});
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/asaas/asaasClient', () => ({ asaasHabilitado: () => true }));
vi.mock('../services/asaas/asaasWebhookService', () => ({ processarWebhookAsaas: vi.fn() }));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  criarPixRecorrente: (...a: unknown[]) => criarPixRecorrente(...a),
  buscarAssinaturaPorId: (...a: unknown[]) => buscarAssinaturaPorId(...a),
  buscarAssinaturaAtiva: vi.fn(),
  cancelarPixRecorrente: vi.fn(),
  docValido: (d: string) => String(d || '').replace(/\D/g, '').length === 11,
  soDigitos: (v: unknown) => String(v ?? '').replace(/\D/g, ''),
  PLANOS_PIX: { vip: { nome: 'VIP', valor: 67 } },
}));

import { criarPixPublicoHandler, statusPixPublicoHandler } from '../controllers/asaasPixController';

function app() {
  const a = express();
  a.use(express.json());
  a.post('/pix/publico', criarPixPublicoHandler);
  a.get('/pix/publico/:id', statusPixPublicoHandler);
  return a;
}

const corpoBase = { plan: 'vip', email: 'Ana@Exemplo.com', nome: 'Ana', cpfCnpj: '12345678901', whatsapp: '(34) 99999-0000' };
const criadoOk = {
  id: 'uuid-1', modo: 'automatico', contractId: 'SD-VIP-1', plano: 'vip', valor: 67, primeiroMes: 67,
  cupom: null, qrPayload: '000201', qrImagemBase64: 'AAA', status: 'pendente',
};

const ENV = ['PIX_PUBLICO_ATIVO', 'PIX_AUTO_QUIZ'] as const;
const salvo: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) { salvo[k] = process.env[k]; delete process.env[k]; }
  criarPixRecorrente.mockReset().mockResolvedValue({ ...criadoOk });
  buscarAssinaturaPorId.mockReset();
});
afterEach(() => {
  for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
});

describe('POST /pix/publico com a trava do quiz', () => {
  it('tudo desligado: 503 mesmo com origem do quiz', async () => {
    const r = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'quiz_solardoc' });
    expect(r.status).toBe(503);
    expect(criarPixRecorrente).not.toHaveBeenCalled();
  });

  it('PIX_AUTO_QUIZ ligada e origem do quiz: passa e repassa atribuicao + exigirAutomatico', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    const r = await request(app()).post('/pix/publico').send({
      ...corpoBase, origem: 'quiz_solardoc', lp_session: 'sess-1', utm_source: 'meta', utm_campaign: 'c1',
      fbc: 'fb.1.2.3', fbp: 'fb.1.2', utm_term: 12345,
    });
    expect(r.status).toBe(200);
    expect(r.body.modo).toBe('automatico');
    expect(r.body.qrPayload).toBe('000201');
    const arg = criarPixRecorrente.mock.calls[0][0];
    expect(arg.exigirAutomatico).toBe(true);
    expect(arg.email).toBe('ana@exemplo.com');
    expect(arg.atribuicao).toEqual({
      rota: 'publica', origem: 'quiz_solardoc', whatsapp: '34999990000', nome: 'Ana', lp_session: 'sess-1',
      utm_source: 'meta', utm_campaign: 'c1', fbc: 'fb.1.2.3', fbp: 'fb.1.2', // utm_term numérico foi ignorado
    });
  });

  it('PIX_AUTO_QUIZ ligada mas SEM origem do quiz (ou origem outra): 503', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    const sem = await request(app()).post('/pix/publico').send(corpoBase);
    const outra = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'outra_lp' });
    expect(sem.status).toBe(503);
    expect(outra.status).toBe(503);
    expect(criarPixRecorrente).not.toHaveBeenCalled();
  });

  it('PIX_PUBLICO_ATIVO ligada, sem origem: segue como antes (sem exigirAutomatico)', async () => {
    process.env.PIX_PUBLICO_ATIVO = 'true';
    const r = await request(app()).post('/pix/publico').send(corpoBase);
    expect(r.status).toBe(200);
    expect(criarPixRecorrente.mock.calls[0][0].exigirAutomatico).toBeUndefined();
  });

  it('contrato reaproveitado já ativo no quiz: qrPayload nulo; resposta nunca leva token', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    criarPixRecorrente.mockResolvedValue({ ...criadoOk, status: 'ativo', qrImagemBase64: null });
    const r = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'quiz_solardoc' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ativo');
    expect(r.body.qrPayload).toBeNull();
    expect(JSON.stringify(r.body)).not.toMatch(/token|senha|password/i);
  });

  it('erro do serviço (Pix automático indisponível) chega como 502, sem cair em assinatura', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    criarPixRecorrente.mockRejectedValue(Object.assign(new Error('O Pix automático não está disponível agora.'), { statusCode: 502 }));
    const r = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'quiz_solardoc' });
    expect(r.status).toBe(502);
  });
});

describe('GET /pix/publico/:id', () => {
  it('desligado: 503', async () => {
    const r = await request(app()).get('/pix/publico/abc');
    expect(r.status).toBe(503);
  });
  it('PIX_AUTO_QUIZ ligada: consulta o contrato', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    buscarAssinaturaPorId.mockResolvedValue({
      id: 'abc', status: 'ativo', modo: 'automatico', plano: 'vip', valor: 67, primeiro_mes: 67, cupom: null,
      contract_id: 'SD-VIP-1', qr_payload: null, proximo_vencimento: null,
    });
    const r = await request(app()).get('/pix/publico/abc');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ativo');
  });
});
