import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// A marca de quem chegou no pagamento (03/11/2026): `quiz_pagto:<hmac>`. Só grava; nada de envio. Banco em memória, sem rede.

const h = vi.hoisted(() => ({
  linhas: new Map<string, { value: Record<string, unknown>; updated_at: string }>(),
  criarPixRecorrente: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
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
import { criarPixPublicoHandler } from '../controllers/asaasPixController';
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
