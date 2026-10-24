import { describe, it, expect, vi, beforeEach } from 'vitest';

// Grupo de vendas do SolarDoc (24/10/2026) no aviso de venda da Stripe: o aviso individual ao Thiago NUNCA é
// dispensado; o do grupo é um a mais, só com plano ativo, só para venda nova e com id único.

const h = vi.hoisted(() => ({
  claimOk: true,
  sendWhatsApp: vi.fn(async (..._a: unknown[]) => undefined),
  sendOpsAlert: vi.fn(async (..._a: unknown[]) => undefined),
  avisarCompra: vi.fn(async (_c: unknown) => 'enviado'),
}));

vi.mock('../utils/supabase', () => {
  const q: any = {
    update: () => q, eq: () => q, is: () => q, select: () => q,
    maybeSingle: async () => (h.claimOk ? { data: { id: 'venda-1' }, error: null } : { data: null, error: null }),
  };
  return { supabase: { from: () => q } };
});
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: (...a: unknown[]) => h.sendWhatsApp(...a) }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: (...a: unknown[]) => h.sendOpsAlert(...a) }));
vi.mock('../services/solardoc/avisoGrupoSolardoc', async (orig) => ({ ...(await orig<typeof import('../services/solardoc/avisoGrupoSolardoc')>()), avisarCompra: h.avisarCompra }));

import { avisarVendaAoDono, type VendaAviso } from '../services/vendaAviso';

const venda = (over: Partial<VendaAviso> = {}): VendaAviso => ({
  produto: 'VIP', valor: 67, cobrouAgora: true, email: 'a@b.com', nome: 'Carlos Andrade', phone: '34999998888',
  historico: { tipo: 'novo', primeiraCompra: null, comprasAnteriores: 0, assinaturaAtiva: false },
  sessionId: 'cs_test_123', lpSession: 'lp-1', origemQuiz: true, planoAtivo: true, ...over,
});
const thiago = () => h.sendWhatsApp.mock.calls.filter((c) => c[0] === '34991360223');

beforeEach(() => {
  h.claimOk = true;
  h.sendWhatsApp.mockReset(); h.sendWhatsApp.mockResolvedValue(undefined);
  h.sendOpsAlert.mockReset(); h.sendOpsAlert.mockResolvedValue(undefined);
  h.avisarCompra.mockReset(); h.avisarCompra.mockResolvedValue('enviado');
});

describe('aviso de venda da Stripe: grupo é um aviso a mais', () => {
  it('plano ativo: o Thiago recebe E o grupo recebe, com o id da sessão e a origem do quiz', async () => {
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('enviado');
    expect(thiago()).toHaveLength(1);
    expect(h.avisarCompra).toHaveBeenCalledTimes(1);
    expect(h.avisarCompra.mock.calls[0]![0]).toMatchObject({
      id: 'cs_test_123', canal: 'cartao', planoAtivo: true, emTeste: false, valor: 67, lpSession: 'lp-1', origemQuiz: true, telefone: '34999998888',
    });
  });
  it('o Thiago recebe qualquer que seja o resultado do grupo', async () => {
    for (const r of ['enviado', 'pendente', 'duplicado', 'sem_grupo', 'falhou', 'erro', 'ignorado']) {
      h.sendWhatsApp.mockClear(); h.avisarCompra.mockResolvedValue(r);
      await avisarVendaAoDono('venda-1', venda());
      expect(thiago(), r).toHaveLength(1);
    }
  });
  it('sem plano ativo (planoAtivo falso ou ausente): o Thiago recebe e o grupo não', async () => {
    await avisarVendaAoDono('venda-1', venda({ planoAtivo: false }));
    await avisarVendaAoDono('venda-1', venda({ planoAtivo: undefined }));
    expect(thiago()).toHaveLength(2);
    expect(h.avisarCompra).not.toHaveBeenCalled();
  });
  it('recompra (historico recorrente): só o Thiago, que carrega o alerta de cobrança dupla', async () => {
    await avisarVendaAoDono('venda-1', venda({ historico: { tipo: 'recorrente', primeiraCompra: '2026-05-22T00:00:00Z', comprasAnteriores: 1, assinaturaAtiva: true } }));
    expect(thiago()).toHaveLength(1);
    expect(String(thiago()[0]![1])).toContain('RECORRENTE');
    expect(h.avisarCompra).not.toHaveBeenCalled();
  });
  it('cartão em teste grátis (cobrouAgora falso) vai para o grupo como assinatura em teste', async () => {
    await avisarVendaAoDono('venda-1', venda({ cobrouAgora: false }));
    expect(h.avisarCompra.mock.calls[0]![0]).toMatchObject({ emTeste: true });
  });
  it('reentrega da Stripe (claim já tomado): nem o Thiago nem o grupo avisam de novo', async () => {
    h.claimOk = false;
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('duplicado');
    expect(thiago()).toHaveLength(0);
    expect(h.avisarCompra).not.toHaveBeenCalled();
  });
  it('WhatsApp do Thiago caiu: o e-mail de resgate sai e o grupo ainda é pedido', async () => {
    h.sendWhatsApp.mockRejectedValue(new Error('linha fora'));
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('email');
    expect(h.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(h.avisarCompra).toHaveBeenCalledTimes(1);
  });
  it('se o aviso ao grupo estourar, o Thiago já recebeu e a função devolve o resultado dele', async () => {
    h.avisarCompra.mockRejectedValue(new Error('grupo fora'));
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('enviado');
    expect(thiago()).toHaveLength(1);
  });
  it('sem id da sessão usa o id da venda; sem nenhum dos dois, não chama o grupo (nada de chave nula)', async () => {
    await avisarVendaAoDono('venda-1', venda({ sessionId: null }));
    expect((h.avisarCompra.mock.calls[0]![0] as any).id).toBe('sale:venda-1');
    h.avisarCompra.mockClear(); h.sendWhatsApp.mockClear();
    await avisarVendaAoDono(null, venda({ sessionId: null }));
    expect(thiago()).toHaveLength(1);
    expect(h.avisarCompra).not.toHaveBeenCalled();
  });
});
