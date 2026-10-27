import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Purchase do Pix do quiz SolarDoc (27/10/2026): lead do quiz que compra pela 1ª vez por Pix no WhatsApp manda
// Purchase ao pixel do quiz pela Conversions API. O gancho (só 1ª compra liberada) é testado em pixRenovacao67.test.ts.

const semBanco = (t: string): never => { throw new Error(`supabase não deve ser tocado (${t}) nos testes com deps falsos`); };
const sup = vi.hoisted(() => ({ tabelas: [] as string[], impl: null as null | ((t: string) => unknown) }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => { sup.tabelas.push(t); if (sup.impl) return sup.impl(t); return semBanco(t); } } }));
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));
const gerador = vi.hoisted(() => ({ from: vi.fn(() => { throw new Error('gerador não deve ser tocado'); }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: gerador.from } }));

import { dispararPurchasePixQuiz, idDoEventoPix, TETO_PURCHASE_PIX_MS, PRAZO_ENVIO_PURCHASE_PIX_MS, type DepsPurchasePix } from '../services/solardoc/purchasePixQuiz';
import type { LeadQuizLinha } from '../services/solardoc/avisoGrupoSolardoc';

// Formato real da chave: pix_e2e:<21 caracteres>:<valor>. O trecho do meio tem exatamente 21 (conferido abaixo).
const CHAVE = 'pix_e2e:E1234567890123456789X:67';
// sha256(CHAVE) em hexadecimal minúsculo, calculado com node (crypto.createHash).
const SHA = 'ecaef51ce6f692f1f4cfef198e8836478bf869099b3911cab7a5cfbf61cc1fca';
const ID_ESPERADO = 'pix_ecaef51ce6f692f1f4cfef198e883647';

const FBC = 'fb.1.1761500000000.AbCdEfGhIjKl';
const FBP = 'fb.1.1761500000000.1234567890';
const lead = (extra: Array<{ name: string; values: string[] }> = []): LeadQuizLinha => ({
  lead_id: 'sdquiz_3499111222', nome: 'Leo Implant', whatsapp: '5534991112222', cidade: 'Uberlandia-MG',
  field_data: [
    { name: 'fbc', values: [FBC] }, { name: 'fbp', values: [FBP] }, { name: 'lp_session', values: ['sess-1'] },
    ...extra,
  ],
});

type Mocks = { [K in keyof DepsPurchasePix]: ReturnType<typeof vi.fn> };
function deps(over: Partial<Record<keyof DepsPurchasePix, unknown>> = {}): { d: Mocks; p: Partial<DepsPurchasePix> } {
  const d = {
    lerLead: vi.fn(async () => lead()),
    claim: vi.fn(async () => 'ok'),
    marcar: vi.fn(async () => {}),
    navegador: vi.fn(async () => ({ userAgent: 'Mozilla/5.0 teste', ip: '203.0.113.9' })),
    enviar: vi.fn(async () => ({ ok: true, status: 200, recebidos: 1 })),
    agora: vi.fn(() => new Date('2026-10-27T15:00:00Z')),
    ...over,
  } as unknown as Mocks;
  return { d, p: d as unknown as Partial<DepsPurchasePix> };
}

const ENTRADA = {
  telefone: '5534991112222', email: 'leoimplant@gmail.com', nome: 'Leo', valor: 67,
  chaveE2e: CHAVE, dedupKey: 'pix_dedup:5534991112222:67:2026-10-27', quando: new Date('2026-10-27T14:30:00Z'),
};

beforeEach(() => { sup.tabelas.length = 0; sup.impl = null; gerador.from.mockClear(); });

describe('idDoEventoPix', () => {
  it('vetor fixo: pix_ + 32 primeiros hex do sha256 da chave inteira', () => {
    expect(CHAVE.split(':')[1]).toHaveLength(21);
    expect(SHA.slice(0, 32)).toBe(ID_ESPERADO.slice(4));
    expect(idDoEventoPix(CHAVE)).toBe(ID_ESPERADO);
  });
  it('sem E2E o mesmo hash vale sobre o dedupKey', async () => {
    const { d, p } = deps();
    await dispararPurchasePixQuiz({ ...ENTRADA, chaveE2e: null }, p);
    expect((d.enviar.mock.calls[0]![0] as any).eventId).toBe(idDoEventoPix(ENTRADA.dedupKey));
  });
});

describe('dispararPurchasePixQuiz', () => {
  it('lead do quiz: chama enviarEventoMeta 1 vez com id da fórmula, valor, origem website, fbc e fbp', async () => {
    const { d, p } = deps();
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('enviado');
    expect(d.enviar).toHaveBeenCalledTimes(1);
    const ev = d.enviar.mock.calls[0]![0] as any;
    expect(ev.produto).toBe('solardoc');
    expect(ev.nome).toBe('Purchase');
    expect(ev.origem).toBe('website');
    expect(ev.eventId).toBe(ID_ESPERADO);
    expect(ev.urlDaPagina).toBe('https://solardoc.app/diagnostico');
    expect(ev.eventTime).toBe(Math.floor(Date.parse('2026-10-27T14:30:00Z') / 1000));
    expect(ev.valor).toBe(67);
    expect(ev.dados).toEqual({ content_name: 'VIP' });
    expect(ev.pessoa).toMatchObject({ telefone: '5534991112222', email: 'leoimplant@gmail.com', nome: 'Leo' });
    expect(ev.navegador).toEqual({ fbc: FBC, fbp: FBP, userAgent: 'Mozilla/5.0 teste', ip: '203.0.113.9' });
    expect(d.claim).toHaveBeenCalledWith(`meta_purchase_pix:${ID_ESPERADO}`, expect.objectContaining({ estado: 'novo' }));
    expect(d.marcar).toHaveBeenCalledWith(`meta_purchase_pix:${ID_ESPERADO}`, expect.objectContaining({ estado: 'enviado', em: expect.any(String) }));
    expect(d.navegador).toHaveBeenCalledWith('sess-1');
  });
  it('sem user agent e IP em page_visits, o evento sai só com fbc e fbp e com origem system_generated', async () => {
    const { d, p } = deps({ navegador: vi.fn(async () => { throw new Error('banco fora'); }) });
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('enviado');
    const ev = d.enviar.mock.calls[0]![0] as any;
    expect(ev.navegador).toEqual({ fbc: FBC, fbp: FBP });
    expect(ev.origem).toBe('system_generated');
  });
  it('lead sem lp_session: origem system_generated; com user agent, website', async () => {
    const semSessao = deps({ lerLead: vi.fn(async () => ({ ...lead(), field_data: [{ name: 'fbc', values: [FBC] }] })) });
    await dispararPurchasePixQuiz(ENTRADA, semSessao.p);
    expect(semSessao.d.navegador).not.toHaveBeenCalled();
    expect((semSessao.d.enviar.mock.calls[0]![0] as any).origem).toBe('system_generated');
    const semUa = deps({ navegador: vi.fn(async () => ({ userAgent: null, ip: '203.0.113.9' })) });
    await dispararPurchasePixQuiz(ENTRADA, semUa.p);
    expect((semUa.d.enviar.mock.calls[0]![0] as any).origem).toBe('system_generated');
    const comUa = deps();
    await dispararPurchasePixQuiz(ENTRADA, comUa.p);
    expect((comUa.d.enviar.mock.calls[0]![0] as any).origem).toBe('website');
  });
  it('telefone que não é do quiz: não chama', async () => {
    const { d, p } = deps({ lerLead: vi.fn(async () => null) });
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('nao_e_quiz');
    expect(d.enviar).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
  });
  it('lead de teste: não chama', async () => {
    const { d, p } = deps({ lerLead: vi.fn(async () => lead([{ name: 'teste', values: ['sim'] }])) });
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('teste');
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('claim duplicado: não chama', async () => {
    const { d, p } = deps({ claim: vi.fn(async () => 'duplicado') });
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('duplicado');
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('claim duplicado de verdade (insert no system_state devolve 23505): não chama o envio', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    sup.impl = (t: string) => {
      if (t !== 'system_state') return semBanco(t);
      return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: { code: '23505', message: 'duplicate key' } }; } };
    };
    const { d, p } = deps({ claim: undefined });
    delete (p as any).claim;
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('duplicado');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.key).toBe(`meta_purchase_pix:${ID_ESPERADO}`);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('claim que não grava: não chama', async () => {
    const { d, p } = deps({ claim: vi.fn(async () => 'erro') });
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('sem_claim');
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('sem E2E e sem dedupKey: não chama (sem id estável)', async () => {
    const { d, p } = deps();
    expect(await dispararPurchasePixQuiz({ ...ENTRADA, chaveE2e: null, dedupKey: '' }, p)).toBe('sem_id');
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('enviarEventoMeta que lança: a função não lança e grava falhou', async () => {
    const { d, p } = deps({ enviar: vi.fn(async () => { throw new Error('meta fora'); }) });
    await expect(dispararPurchasePixQuiz(ENTRADA, p)).resolves.toBe('falhou');
    expect(d.marcar).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ estado: 'falhou' }));
  });
  it('Meta recusa (ok:false): grava falhou', async () => {
    const { d, p } = deps({ enviar: vi.fn(async () => ({ ok: false, status: 400, erro: 'token' })) });
    expect(await dispararPurchasePixQuiz(ENTRADA, p)).toBe('falhou');
    expect(d.marcar).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ estado: 'falhou' }));
  });
  it('leitura do lead que lança: a função não lança', async () => {
    const { p } = deps({ lerLead: vi.fn(async () => { throw new Error('gerador fora'); }) });
    await expect(dispararPurchasePixQuiz(ENTRADA, p)).resolves.toBe('erro');
  });
  it('Meta que não responde: o envio estoura em 6 s, o claim vira falhou e o teto de 8 s nem chega', async () => {
    vi.useFakeTimers();
    try {
      const { d, p } = deps({ enviar: vi.fn(() => new Promise(() => {})) });
      const r = dispararPurchasePixQuiz(ENTRADA, p);
      await vi.advanceTimersByTimeAsync(PRAZO_ENVIO_PURCHASE_PIX_MS + 10);
      await expect(r).resolves.toBe('falhou');
      expect(d.marcar).toHaveBeenCalledWith(`meta_purchase_pix:${ID_ESPERADO}`, expect.objectContaining({ estado: 'falhou', erro: 'timeout_envio' }));
      expect(PRAZO_ENVIO_PURCHASE_PIX_MS).toBeLessThan(TETO_PURCHASE_PIX_MS);
    } finally { vi.useRealTimers(); }
  });
});

describe('estrutura: cada tabela no seu banco', () => {
  it('leads_meta só pelo supabaseGerador (via lerLeadDoQuiz); system_state e page_visits só pelo supabase', async () => {
    const lidas: Array<{ banco: 'principal' | 'gerador'; tabela: string }> = [];
    gerador.from.mockImplementation(((t: string) => {
      lidas.push({ banco: 'gerador', tabela: t });
      const q: any = { select: () => q, eq: () => q, contains: () => q, order: () => q, limit: async () => ({ data: [lead()], error: null }) };
      return q;
    }) as any);
    const { lerLeadDoQuiz } = await import('../services/solardoc/avisoGrupoSolardoc');
    expect((await lerLeadDoQuiz({ telefone: '5534991112222' }))?.lead_id).toBe('sdquiz_3499111222');
    expect(lidas).toEqual([{ banco: 'gerador', tabela: 'leads_meta' }]);
    // o módulo novo, com os deps padrão, só toca o banco principal em system_state e page_visits
    const fonte = readFileSync(join(__dirname, '..', 'services', 'solardoc', 'purchasePixQuiz.ts'), 'utf8');
    const principal = [...fonte.matchAll(/supabase\.from\('(\w+)'\)/g)].map(m => m[1]);
    expect([...new Set(principal)].sort()).toEqual(['page_visits', 'system_state']);
    expect(fonte).not.toMatch(/supabaseGerador\.from|leads_meta/);
    gerador.from.mockImplementation((() => { throw new Error('gerador não deve ser tocado'); }) as any);
  });
});
