import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// "Pix pago" na tela (16/11/2026): o GET publico e o status logado ganham pago, pagoEm, situacao, criadoEm e expiraEm, sempre SOMADOS.
// O supabase simulado devolve a linha PROJETADA nas colunas que o select pediu: se a consulta real nao pedir ultimo_pagamento_id, o pago sai falso.

const h = vi.hoisted(() => ({
  linha: null as Record<string, unknown> | null,
  selects: [] as string[],
  exp: undefined as unknown,
  expLeituras: 0,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      let cols = '';
      let chave = '';
      const q: any = {
        select: (c: string) => { cols = c; if (tabela === 'asaas_pix_assinaturas') h.selects.push(c); return q; },
        eq: (_c: string, v: string) => { chave = v; return q; },
        in: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => {
          if (tabela === 'system_state') {
            if (chave.startsWith('pix_auto_exp:')) h.expLeituras++;
            return { data: h.exp === undefined || !chave.startsWith('pix_auto_exp:') ? null : { value: h.exp }, error: null };
          }
          if (tabela === 'asaas_pix_assinaturas') {
            if (!h.linha) return { data: null, error: null };
            const pedidas = cols.split(',').map(s => s.trim());
            return { data: Object.fromEntries(Object.entries(h.linha).filter(([k]) => pedidas.includes(k))), error: null };
          }
          return { data: { plano: 'ilimitado', plano_expira_em: null }, error: null };
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/cuponsService', () => ({ buscarCupomValido: async () => null, aplicarCupom: () => null }));
vi.mock('../services/asaas/asaasClient', () => ({ asaasHabilitado: () => true, AsaasError: class extends Error {}, asaasFetch: async () => ({}) }));
vi.mock('../services/asaas/asaasWebhookService', () => ({ processarWebhookAsaas: vi.fn() }));
vi.mock('../services/produtos/adicionaisPlanoPix', () => ({ lerAdicionaisDoPlano: async () => null, temAdicionais: () => false }));

import { statusPixPublicoHandler, statusPixRecorrenteHandler } from '../controllers/asaasPixController';
import { calcularPagamentoPix } from '../services/asaas/pixPagoTela';

const CRIADO = '2026-11-16T10:00:00.000Z';
const DEPOIS = '2026-11-16T10:05:00.000Z';
const ANTES = '2026-11-01T10:00:00.000Z';
const ID = '11111111-2222-3333-4444-555555555555';

function linha(extra: Record<string, unknown> = {}) {
  return {
    id: ID, user_id: null, email: 'ana@exemplo.com', cpf_cnpj: '12345678901', modo: 'automatico', authorization_id: 'auth_1', subscription_id: null,
    contract_id: 'SD-VIP-1', plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', qr_payload: '000201ABC',
    ultimo_pagamento_em: null, ultimo_pagamento_id: '', proximo_vencimento: null, created_at: CRIADO, ...extra,
  };
}

function app() {
  const a = express();
  a.get('/publico/:id', statusPixPublicoHandler);
  a.get('/logado', (req, _res, next) => { (req as unknown as { userId: string }).userId = 'u1'; next(); }, statusPixRecorrenteHandler);
  return a;
}

const ENV = ['PIX_PUBLICO_ATIVO', 'PIX_AUTO_QUIZ'] as const;
const salvo: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { salvo[k] = process.env[k]; delete process.env[k]; }
  process.env.PIX_AUTO_QUIZ = 'true';
  h.linha = null; h.selects = []; h.exp = undefined; h.expLeituras = 0;
});
afterEach(() => {
  for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
});

const consultar = async (extra: Record<string, unknown>) => {
  h.linha = linha(extra);
  const r = await request(app()).get(`/publico/${ID}`);
  expect(r.status).toBe(200);
  return r.body as Record<string, any>;
};

describe('GET /publico/:id: pago, situacao, criadoEm, expiraEm', () => {
  it('pendente sem pagamento: esperando, pago false, com criadoEm e expiraEm', async () => {
    const b = await consultar({});
    expect(b).toMatchObject({ status: 'pendente', pago: false, pagoEm: null, situacao: 'esperando', criadoEm: CRIADO });
    expect(typeof b.expiraEm).toBe('string');
    expect(Date.parse(b.expiraEm)).toBeGreaterThan(Date.parse(CRIADO));
  });

  it('expiraEm usa a validade real gravada em pix_auto_exp', async () => {
    h.exp = { expira_em: '2026-11-17T09:30:00.000Z' };
    const b = await consultar({});
    expect(b.expiraEm).toBe('2026-11-17T09:30:00.000Z');
  });

  it('pendente com pagamento depois de criado (webhook ja gravou o id): pago true, situacao pago', async () => {
    const b = await consultar({ ultimo_pagamento_id: 'pay_abc', ultimo_pagamento_em: DEPOIS });
    expect(b).toMatchObject({ status: 'pendente', pago: true, pagoEm: DEPOIS, situacao: 'pago' });
  });

  it('ativo com pagamento: pago true', async () => {
    const b = await consultar({ status: 'ativo', ultimo_pagamento_id: 'pay_abc', ultimo_pagamento_em: DEPOIS });
    expect(b).toMatchObject({ status: 'ativo', pago: true, situacao: 'pago', expiraEm: null });
  });

  it('ativo sem pagamento: status ativo, pago false, situacao ativo', async () => {
    const b = await consultar({ status: 'ativo' });
    expect(b).toMatchObject({ status: 'ativo', pago: false, pagoEm: null, situacao: 'ativo' });
  });

  it('recusado com pagamento depois de criado (pagou e o banco recusou o debito mensal): pago true, situacao pago', async () => {
    const b = await consultar({ status: 'recusado', ultimo_pagamento_id: 'pay_xyz', ultimo_pagamento_em: DEPOIS });
    expect(b).toMatchObject({ status: 'recusado', pago: true, situacao: 'pago' });
  });

  it('recusado sem pagamento: situacao recusado, pago false', async () => {
    const b = await consultar({ status: 'recusado' });
    expect(b).toMatchObject({ status: 'recusado', pago: false, situacao: 'recusado', expiraEm: null });
  });

  it('expirado sem pagamento: situacao vencido, pago false', async () => {
    const b = await consultar({ status: 'expirado' });
    expect(b).toMatchObject({ status: 'expirado', pago: false, situacao: 'vencido' });
  });

  it('expirado com pagamento depois de criado: pago true', async () => {
    const b = await consultar({ status: 'expirado', ultimo_pagamento_id: 'pay_1', ultimo_pagamento_em: DEPOIS });
    expect(b).toMatchObject({ pago: true, situacao: 'pago' });
  });

  it('inadimplente com pagamento antigo: pago false (nao anuncia Pix pago de mes passado)', async () => {
    const b = await consultar({ status: 'inadimplente', ultimo_pagamento_id: 'pay_velho', ultimo_pagamento_em: DEPOIS });
    expect(b).toMatchObject({ status: 'inadimplente', pago: false, pagoEm: null, situacao: 'inadimplente' });
  });

  it('cancelado: pago false mesmo com pagamento gravado', async () => {
    const b = await consultar({ status: 'cancelado', ultimo_pagamento_id: 'pay_1', ultimo_pagamento_em: DEPOIS });
    expect(b).toMatchObject({ status: 'cancelado', pago: false, situacao: 'cancelado' });
  });

  it('contrato reaproveitado com pagamento de ANTES de nascer: pago false', async () => {
    const b = await consultar({ ultimo_pagamento_id: 'pay_velho', ultimo_pagamento_em: ANTES });
    expect(b).toMatchObject({ pago: false, situacao: 'esperando' });
  });

  it('a resposta nao contem e-mail, CPF nem ultimo_pagamento_id', async () => {
    h.linha = linha({ ultimo_pagamento_id: 'pay_segredo_123', ultimo_pagamento_em: DEPOIS });
    const r = await request(app()).get(`/publico/${ID}`);
    const txt = JSON.stringify(r.body);
    expect(txt).not.toContain('ana@exemplo.com');
    expect(txt).not.toContain('12345678901');
    expect(txt).not.toContain('pay_segredo_123');
    expect(Object.keys(r.body)).not.toContain('ultimo_pagamento_id');
    expect(Object.keys(r.body)).not.toContain('email');
  });

  it('a consulta REAL pede ultimo_pagamento_id (e ultimo_pagamento_em) ao banco', async () => {
    h.linha = linha({ ultimo_pagamento_id: 'pay_abc', ultimo_pagamento_em: DEPOIS });
    const r = await request(app()).get(`/publico/${ID}`);
    const pedidas = h.selects[0]!.split(',').map(s => s.trim());
    expect(pedidas).toContain('ultimo_pagamento_id');
    expect(pedidas).toContain('ultimo_pagamento_em');
    expect(r.body.pago).toBe(true);
  });

  it('mantem os campos antigos intactos', async () => {
    const b = await consultar({});
    expect(b).toMatchObject({ id: ID, status: 'pendente', modo: 'automatico', plano: 'ilimitado', valor: 67, primeiroMes: 67, contractId: 'SD-VIP-1', qrPayload: '000201ABC', totalMensal: 67 });
  });
});

describe('a leitura de pix_auto_exp (lerExpiracaoDoContrato) so acontece para contrato automatico, pendente e com QR', () => {
  it('automatico pendente com QR: uma leitura', async () => {
    await consultar({});
    expect(h.expLeituras).toBe(1);
  });
  it.each([
    ['ativo', { status: 'ativo' }],
    ['pago (pendente com pagamento) ainda e pendente: le uma vez', { ultimo_pagamento_id: 'p', ultimo_pagamento_em: DEPOIS }],
    ['modo assinatura', { modo: 'assinatura' }],
    ['sem QR', { qr_payload: null }],
    ['recusado', { status: 'recusado' }],
    ['expirado', { status: 'expirado' }],
  ])('%s', async (nome, extra) => {
    await consultar(extra as Record<string, unknown>);
    expect(h.expLeituras).toBe(nome.startsWith('pago') ? 1 : 0);
  });
});

describe('GET publico com ?qr=1: a imagem do QR gerada do copia e cola', () => {
  const PNG = /^iVBORw0KGgo[A-Za-z0-9+/=]+$/;
  const pedir = async (extra: Record<string, unknown>, query: string) => {
    h.linha = linha(extra);
    const r = await request(app()).get(`/publico/${ID}${query}`);
    expect(r.status).toBe(200);
    return r.body as Record<string, any>;
  };
  it('sem ?qr: nao manda a imagem (resposta igual a de antes)', async () => {
    expect(Object.keys(await pedir({}, ''))).not.toContain('qrImagemBase64');
  });
  it('?qr=0 e ?qr=true tambem nao mandam', async () => {
    expect(Object.keys(await pedir({}, '?qr=0'))).not.toContain('qrImagemBase64');
    expect(Object.keys(await pedir({}, '?qr=true'))).not.toContain('qrImagemBase64');
  });
  it('?qr=1 com o contrato pendente e com QR: manda o PNG em base64, sem prefixo data:', async () => {
    const b = await pedir({}, '?qr=1');
    expect(b.qrImagemBase64).toMatch(PNG);
    expect(b.qrPayload).toBe('000201ABC');
  });
  it.each([
    ['ativo', { status: 'ativo' }],
    ['recusado', { status: 'recusado' }],
    ['expirado', { status: 'expirado' }],
    ['sem QR', { qr_payload: null }],
  ])('?qr=1 com contrato %s: nao manda a imagem', async (_n, extra) => {
    expect(Object.keys(await pedir(extra as Record<string, unknown>, '?qr=1'))).not.toContain('qrImagemBase64');
  });
  it('a tela logada tambem recebe, dentro de contrato, com ?qr=1', async () => {
    h.linha = linha({});
    const r = await request(app()).get('/logado?qr=1');
    expect(r.body.contrato.qrImagemBase64).toMatch(PNG);
    const sem = await request(app()).get('/logado');
    expect(Object.keys(sem.body.contrato)).not.toContain('qrImagemBase64');
  });
});

describe('GET logado: contrato.pago e contrato.situacao', () => {
  it('pendente com pagamento: contrato.pago true, ativo segue pelo status', async () => {
    h.linha = linha({ ultimo_pagamento_id: 'pay_abc', ultimo_pagamento_em: DEPOIS });
    const r = await request(app()).get('/logado');
    expect(r.status).toBe(200);
    expect(r.body.ativo).toBe(false);
    expect(r.body.contrato).toMatchObject({ status: 'pendente', pago: true, pagoEm: DEPOIS, situacao: 'pago', criadoEm: CRIADO });
    expect(JSON.stringify(r.body)).not.toContain('pay_abc');
  });

  it('inadimplente com pagamento: contrato.pago false', async () => {
    h.linha = linha({ status: 'inadimplente', ultimo_pagamento_id: 'pay_abc', ultimo_pagamento_em: DEPOIS });
    const r = await request(app()).get('/logado');
    expect(r.body.contrato).toMatchObject({ pago: false, situacao: 'inadimplente' });
  });
});

describe('calcularPagamentoPix (regra pura)', () => {
  it('empate de horario vale (>= created_at)', () => {
    expect(calcularPagamentoPix({ status: 'recusado', created_at: CRIADO, ultimo_pagamento_id: 'p', ultimo_pagamento_em: CRIADO }).pago).toBe(true);
  });
  it('id sem data de pagamento (webhook grava o id primeiro): pago', () => {
    expect(calcularPagamentoPix({ status: 'pendente', created_at: CRIADO, ultimo_pagamento_id: 'p', ultimo_pagamento_em: null })).toMatchObject({ pago: true, pagoEm: null, situacao: 'pago' });
  });
  it('status desconhecido sem pagamento: esperando', () => {
    expect(calcularPagamentoPix({ status: 'qualquer', created_at: CRIADO }).situacao).toBe('esperando');
  });
});
