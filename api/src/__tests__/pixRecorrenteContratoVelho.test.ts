import { describe, it, expect, vi, beforeEach } from 'vitest';

// Contrato `pendente` velho não devolve código vencido (03/11/2026): com mais de 55 min pelo created_at o contrato vira `expirado` e nasce
// um novo. `ativo` e `inadimplente` seguem como sempre (devolvidos, nunca um segundo contrato). Nada aqui toca banco, Asaas ou rede.

const h = vi.hoisted(() => ({
  existente: null as Record<string, unknown> | null,
  atualizacoes: [] as Array<{ tabela: string; valor: Record<string, unknown> }>,
  insercoes: [] as Array<{ tabela: string; valor: Record<string, unknown> }>,
  chamadasAsaas: [] as string[],
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q, or: () => q, in: () => q, order: () => q, limit: () => q, eq: () => q,
        maybeSingle: async () => (q.inserindo ? { data: { id: 'novo-id' }, error: null }
          : { data: tabela === 'asaas_pix_assinaturas' ? h.existente : null, error: null }),
        update: (valor: Record<string, unknown>) => { h.atualizacoes.push({ tabela, valor }); return q; },
        insert: (valor: Record<string, unknown>) => { h.insercoes.push({ tabela, valor }); q.inserindo = true; return q; },
        upsert: async () => ({ error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/cuponsService', () => ({ buscarCupomValido: async () => null, aplicarCupom: () => null }));
vi.mock('../services/asaas/asaasClient', () => ({
  asaasHabilitado: () => true,
  AsaasError: class extends Error {},
  asaasFetch: async (url: string) => {
    h.chamadasAsaas.push(url);
    if (url.startsWith('/customers?')) return { data: [{ id: 'cus_1' }] };
    if (url === '/pix/automatic/authorizations') {
      return { id: 'auth_novo', status: 'CREATED', payload: '000201NOVO6304ABCD', encodedImage: 'img', immediateQrCode: { conciliationIdentifier: 'conc-1' } };
    }
    return {};
  },
}));

import { criarPixRecorrente, contratoPendenteVencido, CONTRATO_PENDENTE_VALE_MS } from '../services/asaas/pixRecorrenteService';

const MIN = 60_000;
const linha = (status: string, minutosAtras: number, extra: Record<string, unknown> = {}) => ({
  id: 'velho-id', user_id: null, email: 'ana@exemplo.com', modo: 'automatico', authorization_id: 'auth_velho', subscription_id: null,
  contract_id: 'SD-VIP-VELHO', plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status, qr_payload: '000201VELHO6304ABCD',
  ultimo_pagamento_em: null, proximo_vencimento: null, created_at: new Date(Date.now() - minutosAtras * MIN).toISOString(), ...extra,
});
const criar = () => criarPixRecorrente({
  userId: null, email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '12345678901', whatsapp: '34999990000', planKey: 'ilimitado', exigirAutomatico: true,
});

beforeEach(() => { h.existente = null; h.atualizacoes = []; h.insercoes = []; h.chamadasAsaas = []; });

describe('contratoPendenteVencido', () => {
  it('só o pendente AUTOMÁTICO com mais de 65 min pelo created_at (o QR dura 60 min)', () => {
    const agora = Date.now();
    const ha = (m: number) => new Date(agora - m * MIN).toISOString();
    expect(CONTRATO_PENDENTE_VALE_MS).toBe(65 * MIN);
    expect(contratoPendenteVencido({ status: 'pendente', modo: 'automatico', created_at: ha(66) }, agora)).toBe(true);
    expect(contratoPendenteVencido({ status: 'pendente', modo: 'automatico', created_at: ha(56) }, agora)).toBe(false);
    expect(contratoPendenteVencido({ status: 'pendente', modo: 'assinatura', created_at: ha(5000) }, agora)).toBe(false);
    expect(contratoPendenteVencido({ status: 'ativo', modo: 'automatico', created_at: ha(600) }, agora)).toBe(false);
    expect(contratoPendenteVencido({ status: 'inadimplente', modo: 'automatico', created_at: ha(600) }, agora)).toBe(false);
    expect(contratoPendenteVencido({ status: 'pendente', modo: 'automatico', created_at: null }, agora)).toBe(false);
  });
});

describe('criarPixRecorrente com contrato existente', () => {
  it('pendente automático de 66 min: vira expirado e cria um contrato novo (autorização nova no Asaas)', async () => {
    h.existente = linha('pendente', 66);
    const r = await criar();
    expect(h.atualizacoes.some(u => u.tabela === 'asaas_pix_assinaturas' && u.valor.status === 'expirado')).toBe(true);
    expect(h.chamadasAsaas).toContain('/pix/automatic/authorizations');
    expect(r.contractId).not.toBe('SD-VIP-VELHO');
    expect(r.qrPayload).toBe('000201NOVO6304ABCD');
    expect(h.insercoes.some(i => i.tabela === 'asaas_pix_assinaturas')).toBe(true);
  });

  it('pendente de 56 min (o QR ainda paga): devolve o mesmo contrato, sem criar nada, nem dois QRs pagáveis', async () => {
    h.existente = linha('pendente', 56);
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(r.qrPayload).toBe('000201VELHO6304ABCD');
    expect(h.atualizacoes.filter(u => u.tabela === 'asaas_pix_assinaturas')).toHaveLength(0);
    expect(h.chamadasAsaas).not.toContain('/pix/automatic/authorizations');
  });

  it('pendente em modo assinatura nunca cria outro, por mais velho que seja', async () => {
    h.existente = linha('pendente', 5000, { modo: 'assinatura', authorization_id: null, subscription_id: 'sub_1' });
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(h.atualizacoes.filter(u => u.tabela === 'asaas_pix_assinaturas')).toHaveLength(0);
    expect(h.chamadasAsaas).not.toContain('/pix/automatic/authorizations');
  });

  it('ativo velho continua como hoje: devolvido, nunca expira nem abre um segundo', async () => {
    h.existente = linha('ativo', 5000);
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(r.status).toBe('ativo');
    expect(h.atualizacoes.filter(u => u.tabela === 'asaas_pix_assinaturas')).toHaveLength(0);
    expect(h.chamadasAsaas).not.toContain('/pix/automatic/authorizations');
  });

  it('inadimplente velho continua como hoje: devolvido', async () => {
    h.existente = linha('inadimplente', 5000);
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(r.status).toBe('inadimplente');
    expect(h.atualizacoes.filter(u => u.tabela === 'asaas_pix_assinaturas')).toHaveLength(0);
    expect(h.chamadasAsaas).not.toContain('/pix/automatic/authorizations');
  });
});
