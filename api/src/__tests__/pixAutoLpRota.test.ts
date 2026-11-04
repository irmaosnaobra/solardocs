import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Trava própria da LP do SolarDoc (PIX_AUTO_LP), 03/11/2026: a rota pública de Pix recorrente abre
// para chamada com origem 'lp_solardoc' sem ligar PIX_PUBLICO_ATIVO nem PIX_AUTO_QUIZ.
// Dependências simuladas: nada aqui toca banco, Asaas ou rede.

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
// O lead da LP no WhatsApp (leads_meta do Gerador): aqui nada toca a rede.
vi.mock('../utils/supabaseGerador', () => {
  const q: any = { select: () => q, eq: () => q, limit: async () => ({ data: [], error: null }), insert: async () => ({ error: null }) };
  return { supabaseGerador: { from: () => q } };
});
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
import { pixAutoLpAtivo } from '../utils/pixInfo';

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

const ENV = ['PIX_PUBLICO_ATIVO', 'PIX_AUTO_QUIZ', 'PIX_AUTO_LP'] as const;
const salvo: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) { salvo[k] = process.env[k]; delete process.env[k]; }
  criarPixRecorrente.mockReset().mockResolvedValue({ ...criadoOk });
  buscarAssinaturaPorId.mockReset();
});
afterEach(() => {
  for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
});

describe('pixAutoLpAtivo', () => {
  it('só liga com PIX_AUTO_LP = true (sem a variável, desligada)', () => {
    expect(pixAutoLpAtivo()).toBe(false);
    process.env.PIX_AUTO_LP = 'false';
    expect(pixAutoLpAtivo()).toBe(false);
    process.env.PIX_AUTO_LP = ' TRUE ';
    expect(pixAutoLpAtivo()).toBe(true);
  });
});

describe('POST /pix/publico com a trava da LP', () => {
  it('lp_solardoc com a trava desligada: 503', async () => {
    const r = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'lp_solardoc' });
    expect(r.status).toBe(503);
    expect(criarPixRecorrente).not.toHaveBeenCalled();
  });

  it('só a trava do quiz ligada não abre a origem da LP (e a da LP não abre a do quiz)', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    const lp = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'lp_solardoc' });
    expect(lp.status).toBe(503);
    delete process.env.PIX_AUTO_QUIZ;
    process.env.PIX_AUTO_LP = 'true';
    const quiz = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'quiz_solardoc' });
    expect(quiz.status).toBe(503);
    expect(criarPixRecorrente).not.toHaveBeenCalled();
  });

  it('trava ligada e SEM WhatsApp: 400 "Informe o seu WhatsApp"', async () => {
    process.env.PIX_AUTO_LP = 'true';
    for (const whatsapp of [undefined, '', '123', '(34) 9999-000', '5534999990000999']) {
      const r = await request(app()).post('/pix/publico').send({ ...corpoBase, whatsapp, origem: 'lp_solardoc' });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Informe o seu WhatsApp');
    }
    expect(criarPixRecorrente).not.toHaveBeenCalled();
  });

  it('trava ligada e COM WhatsApp: chega ao serviço com exigirAutomatico e a atribuição inteira', async () => {
    process.env.PIX_AUTO_LP = 'true';
    const r = await request(app()).post('/pix/publico').send({
      ...corpoBase, origem: 'lp_solardoc', lp_session: 'sess-lp', utm_source: 'fb', utm_term: '120000000001',
      utm_campaign: 'c1', fbc: 'fb.1.2.3', fbp: 'fb.1.2',
    });
    expect(r.status).toBe(200);
    const arg = criarPixRecorrente.mock.calls[0][0];
    expect(arg.exigirAutomatico).toBe(true);
    expect(arg.whatsapp).toBe('34999990000');
    expect(arg.atribuicao).toEqual({
      rota: 'publica', origem: 'lp_solardoc', whatsapp: '34999990000', nome: 'Ana', lp_session: 'sess-lp',
      utm_source: 'fb', utm_campaign: 'c1', utm_term: '120000000001', fbc: 'fb.1.2.3', fbp: 'fb.1.2',
    });
  });

  it('WhatsApp com 55 na frente (12 ou 13 dígitos) vale', async () => {
    process.env.PIX_AUTO_LP = 'true';
    for (const whatsapp of ['+55 34 99999-0000', '553499990000']) {
      const r = await request(app()).post('/pix/publico').send({ ...corpoBase, whatsapp, origem: 'lp_solardoc' });
      expect(r.status).toBe(200);
    }
  });

  it('origem desconhecida continua 503, mesmo com as duas travas de funil ligadas', async () => {
    process.env.PIX_AUTO_LP = 'true';
    process.env.PIX_AUTO_QUIZ = 'true';
    const r = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'outra_lp' });
    expect(r.status).toBe(503);
    expect(criarPixRecorrente).not.toHaveBeenCalled();
  });

  it('trava geral ligada com origem lp_solardoc: passa, e a regra do WhatsApp continua valendo', async () => {
    process.env.PIX_PUBLICO_ATIVO = 'true';
    const sem = await request(app()).post('/pix/publico').send({ ...corpoBase, whatsapp: '', origem: 'lp_solardoc' });
    expect(sem.status).toBe(400);
    const com = await request(app()).post('/pix/publico').send({ ...corpoBase, origem: 'lp_solardoc' });
    expect(com.status).toBe(200);
    expect(criarPixRecorrente.mock.calls[0][0].exigirAutomatico).toBe(true);
  });

  it('o quiz não passou a exigir WhatsApp (mudança só da LP)', async () => {
    process.env.PIX_AUTO_QUIZ = 'true';
    const r = await request(app()).post('/pix/publico').send({ ...corpoBase, whatsapp: undefined, origem: 'quiz_solardoc' });
    expect(r.status).toBe(200);
  });
});

describe('GET /pix/publico/:id com a trava da LP', () => {
  it('desligado: 503', async () => {
    const r = await request(app()).get('/pix/publico/abc');
    expect(r.status).toBe(503);
  });
  it('PIX_AUTO_LP ligada: consulta o contrato', async () => {
    process.env.PIX_AUTO_LP = 'true';
    buscarAssinaturaPorId.mockResolvedValue({
      id: 'abc', status: 'ativo', modo: 'automatico', plano: 'vip', valor: 67, primeiro_mes: 67, cupom: null,
      contract_id: 'SD-VIP-1', qr_payload: null, proximo_vencimento: null,
    });
    const r = await request(app()).get('/pix/publico/abc');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ativo');
  });
});
