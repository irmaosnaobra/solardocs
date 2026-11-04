import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// A marca de quem chegou no pagamento (03/11/2026): `quiz_pagto:<hmac>`. Só grava; nada de envio. Banco em memória, sem rede.

const h = vi.hoisted(() => ({
  /** leads_meta do Gerador: o que já existe (por lead_id) e o que o handler inseriu. */
  /** Já existe conta (users) com o e-mail do Pix? */
  dono: false as false | { plano?: string | null; plano_expira_em?: string | null },
  leadsExistentes: new Set<string>(),
  leadsInseridos: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: Record<string, unknown>; updated_at: string }>(),
  criarPixRecorrente: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === 'users') {
        const u: any = { select: () => u, eq: () => u, update: () => u, maybeSingle: async () => ({ data: h.dono ? { id: 'u-dono', whatsapp: '34998123456', ...h.dono } : null, error: null }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) };
        return u;
      }
      let chave = '';
      let valor: Record<string, unknown> | null = null;
      let op: 'select' | 'insert' | 'update' = 'select';
      const q: any = {
        select: () => q,
        eq: (_c: string, k: string) => { chave = k; return q; },
        insert: (v: { key: string; value: Record<string, unknown>; updated_at: string }) => {
          if (h.linhas.has(v.key)) return Promise.resolve({ error: { code: '23505' } });
          h.linhas.set(v.key, { value: v.value, updated_at: v.updated_at });
          return Promise.resolve({ error: null });
        },
        update: (v: { value: Record<string, unknown>; updated_at: string }) => { op = 'update'; valor = v.value; void v; return q; },
        maybeSingle: async () => ({ data: h.linhas.has(chave) ? { value: h.linhas.get(chave)!.value } : null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (op === 'update' && valor && h.linhas.has(chave)) h.linhas.get(chave)!.value = valor;
          return Promise.resolve({ error: null }).then(ok);
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      let leadId = '';
      const q: any = {
        select: () => q, eq: (_c: string, v: string) => { leadId = v; return q; },
        limit: async () => ({ data: h.leadsExistentes.has(leadId) ? [{ lead_id: leadId }] : [], error: null }),
        insert: async (v: Record<string, any>) => { h.leadsInseridos.push(v); return { error: null }; },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/asaas/asaasClient', () => ({ asaasHabilitado: () => true }));
vi.mock('../services/asaas/asaasWebhookService', () => ({ processarWebhookAsaas: vi.fn() }));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  criarPixRecorrente: (...a: unknown[]) => h.criarPixRecorrente(...a),
  buscarAssinaturaPorId: vi.fn(), buscarAssinaturaAtiva: vi.fn(), cancelarPixRecorrente: vi.fn(),
  docValido: (d: string) => String(d || '').replace(/\D/g, '').length === 11,
  soDigitos: (v: unknown) => String(v ?? '').replace(/\D/g, ''),
  PLANOS_PIX: { vip: { nome: 'VIP', valor: 67 } },
}));

import { gravarMarcaPagamento, hmacDoPagamento } from '../services/solardoc/marcaPagamentoQuiz';
import { gravarLeadLp, FORM_ID_LP_PIX } from '../services/solardoc/leadLpSolardoc';
import { codigoDoQuiz } from '../services/solardoc/quizSolardoc';
import { criarPixPublicoHandler, contaEhDeClientePagante } from '../controllers/asaasPixController';
import { prefixosDaLinha } from '../services/agents/whatsapp/lineThrottle';
import { PREFIXO_PAGTO, marcaDeLinha } from '../services/solardoc/recuperacaoCarlaRegras';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';

const ENV = ['PIX_PUBLICO_ATIVO', 'PIX_AUTO_QUIZ', 'PIX_AUTO_LP', 'AGENTES5040_HMAC', 'SUPABASE_SERVICE_KEY'] as const;
const salvo: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) salvo[k] = process.env[k];
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  delete process.env.AGENTES5040_HMAC;
  process.env.PIX_AUTO_QUIZ = 'true';
  process.env.PIX_AUTO_LP = 'true';
  h.linhas.clear();
  h.leadsExistentes.clear(); h.leadsInseridos = []; h.dono = false;
  h.criarPixRecorrente.mockReset();
});
afterEach(() => { for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; } });

const hmacDoClaim = (tel: string): string => hmacDe(chaveDoTelefone(normalizarTelefoneSd(tel) as string)) as string;

describe('gravarMarcaPagamento', () => {
  const base = { contratoId: 'SD-VIP-1', origem: 'quiz_solardoc', email: 'Ana@Exemplo.com', nome: 'Ana', utm_term: 'conj1', lp_session: 'lp-1' };

  it('grava quiz_pagto:<hmac> com {em, contratoId, origem, email, nome, utm_term, lp_session} e o hmac do claim quiz_rec_sent', async () => {
    const agora = new Date('2026-11-03T15:00:00.000Z');
    expect(await gravarMarcaPagamento({ ...base, whatsapp: '(34) 99812-3456' }, agora)).toBe(true);
    const chave = `${PREFIXO_PAGTO}${hmacDoClaim('34998123456')}`;
    expect([...h.linhas.keys()]).toEqual([chave]);
    expect(h.linhas.get(chave)!.value).toEqual({
      em: agora.toISOString(), contratoId: 'SD-VIP-1', origem: 'quiz_solardoc', email: 'ana@exemplo.com', nome: 'Ana', utm_term: 'conj1', lp_session: 'lp-1',
    });
    // telefone cru nunca vai para a marca
    expect(JSON.stringify([...h.linhas.entries()])).not.toMatch(/99812|3456/);
    // e o leitor da rodada entende o que foi gravado
    const m = marcaDeLinha(chave, h.linhas.get(chave)!.value);
    expect(m?.hmac).toBe(hmacDoClaim('34998123456'));
    expect(m?.contratoId).toBe('SD-VIP-1');
  });

  it('o mesmo telefone no quiz (DDD+8) e na LP (55+11) cai na MESMA chave: um claim só', async () => {
    expect(hmacDoPagamento('3498123456')).toBe(hmacDoPagamento('5534998123456'));
    await gravarMarcaPagamento({ ...base, whatsapp: '3498123456' });
    await gravarMarcaPagamento({ ...base, origem: 'lp_solardoc', whatsapp: '5534998123456' });
    expect(h.linhas.size).toBe(1);
  });

  it('o mesmo contrato de novo não anda a hora (a espera de 5 min não recomeça); outro contrato troca a marca', async () => {
    await gravarMarcaPagamento({ ...base, whatsapp: '34998123456' }, new Date('2026-11-03T15:00:00.000Z'));
    await gravarMarcaPagamento({ ...base, whatsapp: '34998123456' }, new Date('2026-11-03T15:30:00.000Z'));
    const chave = `${PREFIXO_PAGTO}${hmacDoClaim('34998123456')}`;
    expect(h.linhas.get(chave)!.value.em).toBe('2026-11-03T15:00:00.000Z');
    await gravarMarcaPagamento({ ...base, contratoId: 'SD-VIP-2', whatsapp: '34998123456' }, new Date('2026-11-03T16:00:00.000Z'));
    expect(h.linhas.get(chave)!.value).toMatchObject({ contratoId: 'SD-VIP-2', em: '2026-11-03T16:00:00.000Z' });
  });

  it('sem telefone legível não grava', async () => {
    expect(await gravarMarcaPagamento({ ...base, whatsapp: '123' })).toBe(false);
    expect(await gravarMarcaPagamento({ ...base, whatsapp: null })).toBe(false);
    expect(h.linhas.size).toBe(0);
  });

  it('a marca fica FORA de BOT_SENT_PREFIXES (não é envio)', () => {
    const p = prefixosDaLinha();
    expect(p.some(x => `${PREFIXO_PAGTO}abc`.startsWith(x))).toBe(false);
    expect(p.some(x => 'quiz_pagto_email:SD-1'.startsWith(x))).toBe(false);
  });
});

describe('POST /pix/publico grava a marca', () => {
  const app = () => { const a = express(); a.use(express.json()); a.post('/pix/publico', criarPixPublicoHandler); return a; };
  const corpo = { plan: 'vip', email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '12345678901', whatsapp: '(34) 99812-3456', utm_term: 'conj9', lp_session: 'lp-9' };
  const criado = (status: string) => ({
    id: 'u1', modo: 'automatico', contractId: 'SD-VIP-9', plano: 'vip', valor: 67, primeiroMes: 67, cupom: null, qrPayload: '000201', qrImagemBase64: 'A', status,
  });

  it('origem quiz_solardoc ou lp_solardoc com contrato pendente: grava a marca com o contrato e a atribuição', async () => {
    for (const origem of ['quiz_solardoc', 'lp_solardoc']) {
      h.linhas.clear();
      h.criarPixRecorrente.mockResolvedValue(criado('pendente'));
      const r = await request(app()).post('/pix/publico').send({ ...corpo, origem });
      expect(r.status).toBe(200);
      const chave = `${PREFIXO_PAGTO}${hmacDoClaim('34998123456')}`;
      expect(h.linhas.get(chave)?.value).toMatchObject({ contratoId: 'SD-VIP-9', origem, email: 'ana@exemplo.com', nome: 'Ana', utm_term: 'conj9', lp_session: 'lp-9' });
    }
  });

  it('contrato devolvido já ativo não ganha marca (não há o que recuperar)', async () => {
    h.criarPixRecorrente.mockResolvedValue(criado('ativo'));
    const r = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'quiz_solardoc' });
    expect(r.status).toBe(200);
    expect(h.linhas.size).toBe(0);
  });

  it('Pix de teste (utm_source = raio-x-teste) não grava marca', async () => {
    h.criarPixRecorrente.mockResolvedValue(criado('pendente'));
    const r = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc', utm_source: 'raio-x-teste' });
    expect(r.status).toBe(200);
    expect(h.linhas.size).toBe(0);
    const normal = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc', utm_source: 'facebook' });
    expect(normal.status).toBe(200);
    expect(h.linhas.size).toBe(1);
  });

  it('sem origem de funil (PIX_PUBLICO_ATIVO puro) não grava marca', async () => {
    process.env.PIX_PUBLICO_ATIVO = 'true';
    h.criarPixRecorrente.mockResolvedValue(criado('pendente'));
    const r = await request(app()).post('/pix/publico').send(corpo);
    expect(r.status).toBe(200);
    expect(h.linhas.size).toBe(0);
  });
});

describe('o lead da LP no WhatsApp (leads_meta, form_id lp_solardoc_pix)', () => {
  const app = () => { const a = express(); a.use(express.json()); a.post('/pix/publico', criarPixPublicoHandler); return a; };
  const corpo = { plan: 'vip', email: 'ana@exemplo.com', nome: 'Ana Souza', cpfCnpj: '12345678901', whatsapp: '(34) 99812-3456', utm_term: 'conj9', lp_session: 'lp-9' };
  const criado = { id: 'u1', modo: 'automatico', contractId: 'SD-VIP-9', plano: 'vip', valor: 67, primeiroMes: 67, cupom: null, qrPayload: '000201', qrImagemBase64: 'A', status: 'pendente' };
  const COD = codigoDoQuiz('5534998123456');

  it('origem LP: grava o lead (sdquiz_<DDD+8>, nome, whatsapp, Origem LP e o Código) e devolve o codigo no JSON', async () => {
    h.criarPixRecorrente.mockResolvedValue({ ...criado });
    const r = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc' });
    expect(r.status).toBe(200);
    expect(r.body.codigo).toBe(COD);
    expect(h.leadsInseridos).toHaveLength(1);
    const l = h.leadsInseridos[0]!;
    expect(l).toMatchObject({ lead_id: 'sdquiz_3498123456', form_id: FORM_ID_LP_PIX, nome: 'Ana Souza', whatsapp: '5534998123456' });
    expect(FORM_ID_LP_PIX).toBe('lp_solardoc_pix');
    const campo = (n: string) => (l.field_data as Array<{ name: string; values: string[] }>).find(c => c.name === n)?.values[0];
    expect(campo('Código')).toBe(COD);
    expect(campo('Origem')).toBe('LP');
    expect(campo('utm_term')).toBe('conj9');
  });

  it('o lead que já existe (o do quiz) NUNCA é sobrescrito; o código volta mesmo assim', async () => {
    h.leadsExistentes.add('sdquiz_3498123456');
    h.criarPixRecorrente.mockResolvedValue({ ...criado });
    const r = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc' });
    expect(r.body.codigo).toBe(COD);
    expect(h.leadsInseridos).toHaveLength(0);
  });

  it('origem quiz não grava lead da LP nem devolve codigo; teste (raio-x-teste) e contrato ativo não gravam lead mas a LP devolve o codigo', async () => {
    h.criarPixRecorrente.mockResolvedValue({ ...criado });
    const quiz = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'quiz_solardoc' });
    expect(quiz.body.codigo).toBeUndefined();
    const teste = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc', utm_source: 'raio-x-teste' });
    expect(teste.body.codigo).toBe(COD);
    h.criarPixRecorrente.mockResolvedValue({ ...criado, status: 'ativo' });
    const ativo = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc' });
    expect(ativo.body.codigo).toBe(COD);
    expect(h.leadsInseridos).toHaveLength(0);
  });

  it('gravarLeadLp com telefone ilegível não grava nem devolve código', async () => {
    expect(await gravarLeadLp({ whatsapp: '123', nome: 'Ana' })).toBeNull();
    expect(h.leadsInseridos).toHaveLength(0);
  });
});

describe('só cliente PAGANTE deixa de ser lead de venda (a conta grátis é prospect)', () => {
  const app = () => { const a = express(); a.use(express.json()); a.post('/pix/publico', criarPixPublicoHandler); return a; };
  const corpo = { plan: 'vip', email: 'ana@exemplo.com', nome: 'Ana Souza', cpfCnpj: '12345678901', whatsapp: '(34) 99812-3456', utm_term: 'conj9', lp_session: 'lp-9' };
  const criado = { id: 'u1', modo: 'automatico', contractId: 'SD-VIP-9', plano: 'vip', valor: 67, primeiroMes: 67, cupom: null, qrPayload: '000201', qrImagemBase64: 'A', status: 'pendente' };
  const diasAtras = (n: number): string => new Date(Date.now() - n * 24 * 3600_000).toISOString();
  const gerar = async (extra: Record<string, unknown> = {}) => {
    h.criarPixRecorrente.mockResolvedValue({ ...criado });
    const r = await request(app()).post('/pix/publico').send({ ...corpo, origem: 'lp_solardoc', ...extra });
    expect(r.status).toBe(200);
    return r;
  };
  const gravou = (): boolean => h.linhas.size === 1 && h.leadsInseridos.length === 1;
  const naoGravou = (): boolean => h.linhas.size === 0 && h.leadsInseridos.length === 0;

  it('conta GRÁTIS que fez o quiz e gerou o Pix ganha a marca e o lead', async () => {
    h.dono = { plano: 'free', plano_expira_em: null };
    await gerar();
    expect(gravou()).toBe(true);
  });

  it('conta PAGA (plano diferente de free) não ganha; o codigo ainda volta', async () => {
    h.dono = { plano: 'ilimitado', plano_expira_em: diasAtras(-20) };
    const r = await gerar();
    expect(r.body.codigo).toBeTruthy();
    expect(naoGravou()).toBe(true);
  });

  it('plano vencido há 10 dias (ainda dentro dos 30) não ganha', async () => {
    h.dono = { plano: 'free', plano_expira_em: diasAtras(10) };
    await gerar();
    expect(naoGravou()).toBe(true);
  });

  it('plano vencido há 40 dias ganha (voltou a ser prospect)', async () => {
    h.dono = { plano: 'free', plano_expira_em: diasAtras(40) };
    await gerar();
    expect(gravou()).toBe(true);
  });

  it('utm_source=recuperacao sem conta paga ganha (é o link da Carla, que fala com prospect); com conta paga não', async () => {
    await gerar({ utm_source: 'recuperacao' });
    expect(gravou()).toBe(true);
    h.linhas.clear(); h.leadsInseridos = [];
    h.dono = { plano: 'pro', plano_expira_em: null };
    await gerar({ utm_source: 'recuperacao' });
    expect(naoGravou()).toBe(true);
  });

  it('giovanna, sdr, link_pix e email também deixam a decisão para a conta (sem conta paga, ganham)', async () => {
    for (const utm of ['giovanna', 'sdr', 'link_pix', 'email']) {
      h.linhas.clear(); h.leadsInseridos = [];
      await gerar({ utm_source: utm });
      expect(gravou()).toBe(true);
    }
  });

  it.each(['renovacao', 'dunning', 'RENOVACAO'])('utm_source=%s não ganha, mesmo sem conta', async (utm) => {
    await gerar({ utm_source: utm });
    expect(naoGravou()).toBe(true);
  });

  it('contaEhDeClientePagante: sem conta, free sem data e free com data futura', () => {
    expect(contaEhDeClientePagante(null)).toBe(false);
    expect(contaEhDeClientePagante({ plano: 'free' })).toBe(false);
    expect(contaEhDeClientePagante({ plano: 'free', plano_expira_em: diasAtras(-5) })).toBe(true);
    expect(contaEhDeClientePagante({ plano: null, plano_expira_em: 'lixo' })).toBe(false);
  });
});
