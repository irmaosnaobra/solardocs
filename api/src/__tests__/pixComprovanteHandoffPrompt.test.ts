import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, sendHuman: vi.fn(), sendImage: vi.fn(), sendWhatsApp: vi.fn(),
}));
vi.mock('../services/agents/sdr/sdrAgentService', () => ({ handleSdrLead: vi.fn() }));
vi.mock('../services/agents/whatsapp/promoGeradorActivation', () => ({
  detectAndActivatePromoCredits: vi.fn(),
}));

import { buildSystemPrompt } from '../services/agents/whatsapp/whatsappAgentService';
import type { HandoffComprovante } from '../services/agents/whatsapp/comprovanteHandoff';

// O bloco do comprovante reprovado entra no FIM do prompt da Giovanna de suporte, e só
// quando há handoff. Sem handoff o prompt é o de sempre.

const base = { email: 'x@y.com', nome_empresa: 'ACME', tem_cnpj: true, nome: 'Joao', plano: 'free' };
const h: HandoffComprovante = {
  valor: 69.9, recebedor_nome: 'SEND CRISTTINY LIMA SANTOS DE A', recebedor_documento: '60453375000139',
  data: '2026-10-07', id_transacao: 'E607469482026100801I7A3980A7OMjI',
  motivo: 'recebedor NÃO parece ser a Aioros', codigo: 'recebedor', recebedor_ok: false,
  em: new Date().toISOString(), instancia: 'io',
};

describe('buildSystemPrompt com comprovante reprovado', () => {
  it('sem handoff, o prompt não tem o bloco', () => {
    expect(buildSystemPrompt(base as any)).not.toContain('COMPROVANTE QUE O SISTEMA NÃO ACEITOU');
  });

  it('com handoff, o bloco vai no fim, com o recebedor, e proíbe dizer que liberou', () => {
    const p = buildSystemPrompt(base as any, undefined, null, h);
    const i = p.indexOf('COMPROVANTE QUE O SISTEMA NÃO ACEITOU');
    expect(i).toBeGreaterThan(0);
    expect(p.slice(i)).toContain('SEND CRISTTINY LIMA SANTOS DE A');
    expect(p.slice(i)).toMatch(/NUNCA diga que liberou/);
    expect(p.trimEnd().endsWith('FIM DO BLOCO DO COMPROVANTE ━━')).toBe(true);
  });
});
