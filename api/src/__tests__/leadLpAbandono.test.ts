import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// F: o lead da LP ANTES do "Gerar" (05/11/2026): POST /payments/pix-recorrente/lead-lp. Celular completo, 1 lead por sessão, número novo substitui o anterior,
// a fila do abandono da LP (15 min, 1 toque, depois de quem gerou o Pix). Dependências simuladas: nada toca banco, Asaas, Z-API nem relógio.

const h = vi.hoisted(() => ({
  estado: new Map<string, { value: any; updated_at?: string }>(),
  leads: new Map<string, Record<string, any>>(),
  inserts: [] as Array<Record<string, any>>,
  criarPixRecorrente: undefined as undefined | ((...a: unknown[]) => unknown),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      let alvo = '';
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { alvo = v; return q; },
        maybeSingle: async () => ({ data: tabela === 'system_state' ? (h.estado.get(alvo) ?? null) : null, error: null }),
        insert: async (linha: any) => {
          if (tabela !== 'system_state') return { error: null };
          if (h.estado.has(linha.key)) return { error: { code: '23505' } };
          h.estado.set(linha.key, { value: linha.value, updated_at: linha.updated_at });
          return { error: null };
        },
        update: (valor: any) => ({ eq: async (_c: string, k: string) => { const a = h.estado.get(k); if (a) h.estado.set(k, { ...a, value: valor.value ?? a.value }); return { error: null }; } }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      let id = '';
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { id = v; return q; },
        limit: async () => ({ data: h.leads.has(id) ? [{ lead_id: id }] : [], error: null }),
        insert: async (linha: any) => { h.inserts.push(linha); if (h.leads.has(linha.lead_id)) return { error: { code: '23505' } }; h.leads.set(linha.lead_id, linha); return { error: null }; },
      };
      return q;
    },
  },
}));
vi.mock('../services/asaas/asaasClient', () => ({ asaasHabilitado: () => true }));
vi.mock('../services/asaas/asaasWebhookService', () => ({ processarWebhookAsaas: vi.fn() }));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  criarPixRecorrente: (...a: unknown[]) => h.criarPixRecorrente?.(...a),
  buscarAssinaturaPorId: vi.fn(), buscarAssinaturaAtiva: vi.fn(), cancelarPixRecorrente: vi.fn(),
  docValido: (d: string) => String(d || '').replace(/\D/g, '').length === 11,
  soDigitos: (v: unknown) => String(v ?? '').replace(/\D/g, ''),
  PLANOS_PIX: { ilimitado: { nome: 'VIP', valor: 67 } },
}));

import { criarPixPublicoHandler, leadLpPublicoHandler } from '../controllers/asaasPixController';
import { celularBrCompleto, ETAPA_LP_ABANDONO, FORM_ID_LP_PIX } from '../services/solardoc/leadLpSolardoc';
import { codigoDoQuiz, chaveDoTelefone, leadIdDoQuiz } from '../services/solardoc/quizSolardoc';
import { hmacDe } from '../services/agentes5040/hmac';

const SESSAO = 'lp-sessao-12345678';
const TEL1 = '5534991230001';
const TEL2 = '5534991230002';
const hm = (tel: string): string => hmacDe(chaveDoTelefone(tel))!;

function app() {
  const a = express();
  a.use(express.json());
  a.post('/lead-lp', leadLpPublicoHandler);
  a.post('/publico', criarPixPublicoHandler);
  return a;
}

const ENV = ['PIX_AUTO_LP', 'PIX_PUBLICO_ATIVO', 'AGENTES5040_HMAC'] as const;
const salvo: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) salvo[k] = process.env[k];
  process.env.PIX_AUTO_LP = 'true';
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.estado.clear(); h.leads.clear(); h.inserts = []; h.criarPixRecorrente = undefined;
});
afterEach(() => { for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; } });

describe('celularBrCompleto: só DDD + 9 + 8 dígitos', () => {
  it('aceita com ou sem 55, pontuação e espaço', () => {
    expect(celularBrCompleto('34991230001')).toBe('5534991230001');
    expect(celularBrCompleto('(34) 99123-0001')).toBe('5534991230001');
    expect(celularBrCompleto('+55 34 99123-0001')).toBe('5534991230001');
    expect(celularBrCompleto('5534991230001')).toBe('5534991230001');
  });
  it('recusa incompleto, fixo, sem o 9, DDD inválido e comprido demais', () => {
    for (const x of ['3499123000', '3433123000', '34 3312-3000', '349912300011', '0991230001', '00991230001', '', null, undefined, 'abc', '55349912300', '553499123000112']) {
      expect(celularBrCompleto(x), String(x)).toBeNull();
    }
  });
});

describe('POST /lead-lp', () => {
  const corpo = (over: Record<string, unknown> = {}) => ({ whatsapp: TEL1, nome: 'Ana', sessao: SESSAO, lp_session: 'lp-attr-1', utm_source: 'meta', utm_term: 'conj9', ...over });

  it('trava PIX_AUTO_LP: desligada, 503 e nada gravado', async () => {
    delete process.env.PIX_AUTO_LP;
    const r = await request(app()).post('/lead-lp').send(corpo());
    expect(r.status).toBe(503);
    expect(h.inserts).toHaveLength(0);
  });

  it('celular incompleto: 400, sem lead nem sessão gravados', async () => {
    for (const w of ['349912300', '(34) 3312-3000', '']) {
      const r = await request(app()).post('/lead-lp').send(corpo({ whatsapp: w }));
      expect(r.status, w).toBe(400);
    }
    expect(h.inserts).toHaveLength(0);
    expect(h.estado.size).toBe(0);
  });

  it('sessão ausente ou torta: 400', async () => {
    expect((await request(app()).post('/lead-lp').send(corpo({ sessao: undefined, lp_session: undefined }))).status).toBe(400);
    expect((await request(app()).post('/lead-lp').send(corpo({ sessao: 'curta' }))).status).toBe(400);
    expect((await request(app()).post('/lead-lp').send(corpo({ sessao: 'tem espaço e <tag>' }))).status).toBe(400);
  });

  it('grava o lead (form lp_solardoc_pix, Etapa abandono, o mesmo lead_id e o Código do wa.me) e responde { codigo }', async () => {
    const r = await request(app()).post('/lead-lp').send(corpo({ email: 'Ana@Exemplo.com' }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ codigo: codigoDoQuiz(TEL1) });
    expect(h.inserts).toHaveLength(1);
    const l = h.inserts[0]!;
    expect(l).toMatchObject({ lead_id: leadIdDoQuiz(TEL1), form_id: FORM_ID_LP_PIX, whatsapp: TEL1, nome: 'Ana' });
    const campo = (n: string) => (l.field_data as Array<{ name: string; values: string[] }>).find(c => c.name === n)?.values[0];
    expect(campo('Etapa')).toBe(ETAPA_LP_ABANDONO);
    expect(campo('Código')).toBe(codigoDoQuiz(TEL1));
    expect(campo('lp_session')).toBe('lp-attr-1');   // a sessão da atribuição (a mesma que a marca do Pix leva)
    expect(campo('utm_term')).toBe('conj9');
    expect(campo('E-mail')).toBe('ana@exemplo.com');
    expect(h.estado.get(`lp_lead_sessao:${SESSAO}`)?.value).toMatchObject({ hmac: hm(TEL1), lead_id: leadIdDoQuiz(TEL1) });
  });

  it('o mesmo número de novo na mesma sessão: nenhum lead novo, ninguém substituído', async () => {
    await request(app()).post('/lead-lp').send(corpo());
    await request(app()).post('/lead-lp').send(corpo());
    expect(h.inserts).toHaveLength(1);
    expect([...h.estado.keys()].some(k => k.startsWith('lp_lead_subst:'))).toBe(false);
  });

  it('1 lead por sessão: o número NOVO substitui o anterior, e o anterior sai da fila (lp_lead_subst)', async () => {
    await request(app()).post('/lead-lp').send(corpo({ whatsapp: TEL1 }));
    const r = await request(app()).post('/lead-lp').send(corpo({ whatsapp: TEL2 }));
    expect(r.body).toEqual({ codigo: codigoDoQuiz(TEL2) });
    expect(h.estado.has(`lp_lead_subst:${hm(TEL1)}`)).toBe(true);
    expect(h.estado.has(`lp_lead_subst:${hm(TEL2)}`)).toBe(false);
    expect(h.estado.get(`lp_lead_sessao:${SESSAO}`)?.value.hmac).toBe(hm(TEL2));
    // voltar ao primeiro número não "desfaz" nada: o primeiro segue substituído, e o segundo passa a ser o substituído
    await request(app()).post('/lead-lp').send(corpo({ whatsapp: TEL1 }));
    expect(h.estado.has(`lp_lead_subst:${hm(TEL2)}`)).toBe(true);
  });

  it('lead que já existe (o do quiz) nunca é sobrescrito', async () => {
    h.leads.set(leadIdDoQuiz(TEL1), { lead_id: leadIdDoQuiz(TEL1), form_id: 'quiz_solardoc' });
    await request(app()).post('/lead-lp').send(corpo());
    expect(h.inserts).toHaveLength(0);
    expect(h.leads.get(leadIdDoQuiz(TEL1))?.form_id).toBe('quiz_solardoc');
  });

  it('teste (raio-x-teste) e cliente pagante (utm renovacao): devolve o código e não grava nada', async () => {
    const t = await request(app()).post('/lead-lp').send(corpo({ utm_source: 'raio-x-teste' }));
    const c = await request(app()).post('/lead-lp').send(corpo({ utm_source: 'renovacao' }));
    expect(t.body).toEqual({ codigo: codigoDoQuiz(TEL1) });
    expect(c.body).toEqual({ codigo: codigoDoQuiz(TEL1) });
    expect(h.inserts).toHaveLength(0);
    expect(h.estado.size).toBe(0);
  });
});

describe('POST /publico devolve expiraEm e o codigo da sessão', () => {
  const corpoPix = { plan: 'ilimitado', email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '52998224725', whatsapp: TEL1, origem: 'lp_solardoc', lp_session: 'lp-attr-1' };
  const criado = (over: Record<string, unknown> = {}) => ({
    id: 'u1', modo: 'automatico', contractId: 'SD-VIP-1', plano: 'ilimitado', valor: 67, primeiroMes: 67, cupom: null, qrPayload: '000201ABC', qrImagemBase64: 'AAA',
    status: 'pendente', expiraEm: '2026-11-05T15:00:00.000Z', ...over,
  });

  it('QR novo: expiraEm (ISO) e codigo da LP no corpo', async () => {
    h.criarPixRecorrente = async () => criado();
    const r = await request(app()).post('/publico').send(corpoPix);
    expect(r.status).toBe(200);
    expect(r.body.expiraEm).toBe('2026-11-05T15:00:00.000Z');
    expect(r.body.codigo).toBe(codigoDoQuiz(TEL1));
  });

  it('contrato já ativo: sem QR e expiraEm null', async () => {
    h.criarPixRecorrente = async () => criado({ status: 'ativo', expiraEm: '2026-11-05T15:00:00.000Z' });
    const r = await request(app()).post('/publico').send(corpoPix);
    expect(r.body).toMatchObject({ qrPayload: null, qrImagemBase64: null, expiraEm: null });
  });
});

describe('bloqueio 5: o freio de IP por dia (só o HASH do IP é gravado)', () => {
  const IP = '203.0.113.7';
  const post = (corpo: Record<string, unknown>, ip = IP) => request(app()).post('/lead-lp').set('x-forwarded-for', ip).send({
    nome: 'Ana', utm_source: 'meta', ...corpo,
  });
  const etapaDe = (tel: string): string | undefined =>
    ((h.leads.get(leadIdDoQuiz(tel))?.field_data ?? []) as Array<{ name: string; values: string[] }>).find(c => c.name === 'Etapa')?.values[0];

  it('o 1º número do IP no dia ganha a etapa; o 2º (OUTRA sessão, mesmo IP) grava o lead SEM etapa, e o código do wa.me sai igual', async () => {
    const a = await post({ whatsapp: TEL1, sessao: 'sessao-aaaaaaaa' });
    const b = await post({ whatsapp: TEL2, sessao: 'sessao-bbbbbbbb' });
    expect(a.body).toEqual({ codigo: codigoDoQuiz(TEL1) });
    expect(b.body).toEqual({ codigo: codigoDoQuiz(TEL2) });
    expect(etapaDe(TEL1)).toBe(ETAPA_LP_ABANDONO);
    expect(etapaDe(TEL2)).toBeUndefined();
    expect(h.leads.has(leadIdDoQuiz(TEL2))).toBe(true);   // o lead existe (o Pix depois usa), só não entra na fila do frio
  });

  it('IP diferente no mesmo dia: cada um ganha a etapa', async () => {
    await post({ whatsapp: TEL1, sessao: 'sessao-aaaaaaaa' }, '203.0.113.7');
    await post({ whatsapp: TEL2, sessao: 'sessao-bbbbbbbb' }, '203.0.113.8');
    expect(etapaDe(TEL1)).toBe(ETAPA_LP_ABANDONO);
    expect(etapaDe(TEL2)).toBe(ETAPA_LP_ABANDONO);
  });

  it('a correção do número dentro da MESMA sessão continua valendo (o número novo também entra na fila)', async () => {
    await post({ whatsapp: TEL1, sessao: 'sessao-aaaaaaaa' });
    await post({ whatsapp: TEL2, sessao: 'sessao-aaaaaaaa' });
    expect(etapaDe(TEL1)).toBe(ETAPA_LP_ABANDONO);
    expect(etapaDe(TEL2)).toBe(ETAPA_LP_ABANDONO);
    expect(h.estado.has(`lp_lead_subst:${hm(TEL1)}`)).toBe(true);
  });

  it('o claim é lp_lead_ip:<hash>:<dia BRT>, só por insert, e NUNCA guarda o IP (nem em chave, nem em valor)', async () => {
    await post({ whatsapp: TEL1, sessao: 'sessao-aaaaaaaa' });
    const chaves = [...h.estado.keys()].filter(k => k.startsWith('lp_lead_ip:'));
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toMatch(/^lp_lead_ip:[0-9a-f]{64}:\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify([...h.estado.entries()])).not.toContain(IP);
    expect(JSON.stringify(h.inserts)).not.toContain(IP);
  });

  it('sem IP legível ou sem segredo de hash: o lead é gravado SEM etapa (falha fechada), o código sai igual', async () => {
    const salvoHmac = process.env.AGENTES5040_HMAC; const salvoSvc = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.AGENTES5040_HMAC; delete process.env.SUPABASE_SERVICE_KEY;
    try {
      const r = await post({ whatsapp: TEL1, sessao: 'sessao-aaaaaaaa' });
      expect(r.body).toEqual({ codigo: codigoDoQuiz(TEL1) });
      expect(etapaDe(TEL1)).toBeUndefined();
    } finally {
      if (salvoHmac !== undefined) process.env.AGENTES5040_HMAC = salvoHmac;
      if (salvoSvc !== undefined) process.env.SUPABASE_SERVICE_KEY = salvoSvc;
    }
  });

  it('/publico NÃO tem o freio de IP: duas sessões do mesmo IP (CGNAT) geram o Pix e as DUAS ganham a marca de recuperação', async () => {
    const corpoPix = (tel: string, sessao: string) => ({
      plan: 'ilimitado', email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '52998224725', whatsapp: tel, origem: 'lp_solardoc', lp_session: sessao,
    });
    h.criarPixRecorrente = async () => ({
      id: 'u1', modo: 'automatico', contractId: 'SD-VIP-1', plano: 'ilimitado', valor: 67, primeiroMes: 67, cupom: null, qrPayload: '000201ABC', qrImagemBase64: 'AAA',
      status: 'pendente', expiraEm: '2026-11-06T15:00:00.000Z',
    });
    const um = await request(app()).post('/publico').set('x-forwarded-for', IP).send(corpoPix(TEL1, 'lp-sessao-1111111'));
    const dois = await request(app()).post('/publico').set('x-forwarded-for', IP).send(corpoPix(TEL2, 'lp-sessao-2222222'));
    expect(um.status).toBe(200);
    expect(dois.status).toBe(200);
    expect(h.estado.has(`quiz_pagto:${hm(TEL1)}`)).toBe(true);
    expect(h.estado.has(`quiz_pagto:${hm(TEL2)}`)).toBe(true);
    expect([...h.estado.keys()].some(k => k.startsWith('lp_lead_ip:'))).toBe(false);   // o claim de IP é só do lead-lp
  });
});

describe('/publico: 4xx de validação do Asaas volta como 400 com a mensagem; o resto segue 502', () => {
  const corpoPix = { plan: 'ilimitado', email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '52998224725', whatsapp: TEL1, origem: 'lp_solardoc', lp_session: 'lp-sessao-1111111' };
  const falha = (asaasStatus: number, asaasMensagem = 'invalid_cpfCnpj: O CPF informado é inválido.') => {
    h.criarPixRecorrente = async () => {
      throw Object.assign(new Error('O Pix automático não está disponível agora. Tente de novo em instantes.'), { statusCode: 502, asaasStatus, asaasMensagem });
    };
  };

  it.each([400, 422, 404])('HTTP %i do Asaas: 400 com a mensagem do Asaas (a tela mostra e a pessoa corrige)', async (st) => {
    falha(st);
    const r = await request(app()).post('/publico').send(corpoPix);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_cpfCnpj: O CPF informado é inválido.');
  });

  it.each([408, 429, 500, 503, 0])('HTTP %i (passageiro ou sem status): segue o 502 genérico', async (st) => {
    falha(st);
    const r = await request(app()).post('/publico').send(corpoPix);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/não está disponível agora/);
  });

  it('4xx sem mensagem do Asaas: também segue o 502 genérico (nada de 400 mudo)', async () => {
    falha(422, '');
    expect((await request(app()).post('/publico').send(corpoPix)).status).toBe(502);
  });
});
