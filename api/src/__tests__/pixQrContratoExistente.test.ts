import { describe, it, expect, vi, beforeEach } from 'vitest';

// Contrato que JÁ EXISTE (reaproveitado) devolve a imagem do QR gerada do copia e cola, no mesmo formato da criação (PNG em base64,
// sem prefixo). Antes devolvia null e a tela reaberta ficava sem o QR. Nada aqui toca banco, Asaas ou rede.

const h = vi.hoisted(() => ({ existente: null as Record<string, unknown> | null }));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q, or: () => q, in: () => q, order: () => q, limit: () => q, eq: () => q,
        maybeSingle: async () => ({ data: tabela === 'asaas_pix_assinaturas' ? h.existente : null, error: null }),
        update: () => q, insert: () => q, upsert: async () => ({ error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/cuponsService', () => ({ buscarCupomValido: async () => null, aplicarCupom: () => null }));
vi.mock('../services/asaas/asaasClient', () => ({ asaasHabilitado: () => true, AsaasError: class extends Error {}, asaasFetch: async () => ({}) }));

import { criarPixRecorrente } from '../services/asaas/pixRecorrenteService';

const MIN = 60_000;
const linha = (extra: Record<string, unknown> = {}) => ({
  id: 'id-1', user_id: null, email: 'ana@exemplo.com', modo: 'automatico', authorization_id: 'auth_1', subscription_id: null,
  contract_id: 'SD-VIP-1', plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', qr_payload: '000201ABC6304ABCD',
  ultimo_pagamento_em: null, proximo_vencimento: null, created_at: new Date(Date.now() - 10 * MIN).toISOString(), ...extra,
});
const criar = () => criarPixRecorrente({ userId: null, email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '12345678901', whatsapp: '34999990000', planKey: 'ilimitado', exigirAutomatico: true });

beforeEach(() => { h.existente = null; });

describe('criarPixRecorrente com contrato existente: qrImagemBase64', () => {
  it('pendente com copia e cola: devolve o PNG em base64 (sem data:)', async () => {
    h.existente = linha();
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-1');
    expect(r.qrPayload).toBe('000201ABC6304ABCD');
    expect(r.qrImagemBase64).toMatch(/^iVBORw0KGgo[A-Za-z0-9+/=]+$/);
  });

  it('pendente sem copia e cola: null', async () => {
    h.existente = linha({ qr_payload: null });
    expect((await criar()).qrImagemBase64).toBeNull();
  });

  it('ativo: null (nao ha mais o que pagar)', async () => {
    h.existente = linha({ status: 'ativo' });
    expect((await criar()).qrImagemBase64).toBeNull();
  });
});
