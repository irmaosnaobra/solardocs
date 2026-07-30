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

// ═══════════════════════════════════════════════════════════════════════════
// A quem a Giovanna pode oferecer a entrada de R$19.
//
// A entrada é curso + 30 dias de plataforma por pagamento único. Ela existe
// pra converter quem NÃO paga. Se vazar pra assinante ativo, ele troca R$67
// por mês por R$19 avulso — a oferta passa a canibalizar a própria receita.
//
// O gate é o `vendaBloco` por plano em buildSystemPrompt. Este teste trava
// esse comportamento: prompt é código, e regressão em prompt não quebra build.
// ═══════════════════════════════════════════════════════════════════════════

const base = { email: 'x@y.com', nome_empresa: 'ACME', tem_cnpj: true, nome: 'Joao' };

const prompt = (over: Record<string, any> = {}) =>
  buildSystemPrompt({ ...base, plano: 'free', ...over } as any);

describe('FREE — é o público da entrada de R$19', () => {
  const p = prompt({ plano: 'free' });

  it('recebe a oferta de R$19 com o curso como produto', () => {
    expect(p).toMatch(/R\$ ?19/);
    expect(p).toMatch(/Kit de Fechamento/i);
  });

  it('sabe mandar o Pix do curso e a imagem', () => {
    expect(p).toContain('[[ENVIAR_PIX_CURSO]]');
    expect(p).toContain('[[ENVIAR_IMAGEM_KIT]]');
  });

  it('deixa explícito que é pagamento único, sem mensalidade e sem cartão', () => {
    expect(p).toMatch(/pagamento ÚNICO/i);
    expect(p).toMatch(/N[ÃA]O pede cart[ãa]o|n[ãa]o há cart[ãa]o|sem cart[ãa]o/i);
    expect(p).toMatch(/N[ÃA]O é mensalidade|sem mensalidade/i);
  });

  it('diz que a decisão de PRO/VIP fica pro fim dos 30 dias', () => {
    expect(p).toMatch(/30 dias/);
    expect(p).toMatch(/PRO \(R\$27\) ou VIP \(R\$67\)|PRO ou VIP/);
  });

  it('proíbe misturar com os 7 dias grátis na mesma conversa', () => {
    expect(p).toMatch(/NUNCA misture com os "7 dias grátis"|Uma coisa OU a outra/i);
  });

  it('marca que é oferta de primeira vez', () => {
    expect(p).toMatch(/PRIMEIRA VEZ|uma vez por pessoa/i);
  });
});

describe('assinante ativo — a entrada NÃO pode aparecer', () => {
  it('PRO não vê a oferta de R$19 nem as tags dela', () => {
    const p = prompt({ plano: 'pro' });
    expect(p).not.toMatch(/R\$ ?19/);
    expect(p).not.toContain('[[ENVIAR_PIX_CURSO]]');
  });

  it('VIP não vê a oferta de R$19 nem as tags dela', () => {
    const p = prompt({ plano: 'ilimitado' });
    expect(p).not.toMatch(/R\$ ?19/);
    expect(p).not.toContain('[[ENVIAR_PIX_CURSO]]');
  });

  it('VIP segue orientado a NÃO receber upgrade', () => {
    expect(prompt({ plano: 'ilimitado' })).toMatch(/já é VIP/i);
  });
});

describe('inadimplente — R$19 só como saída, nunca como primeira oferta', () => {
  const p = prompt({ plano: 'pro', billing_status: 'past_due' });

  it('a prioridade continua sendo reativar pelos R$67', () => {
    expect(p).toMatch(/ACESSO PAUSADO/);
    expect(p).toContain('[[ENVIAR_PIX]]');
    expect(p).toMatch(/R\$67/);
  });

  it('os R$19 aparecem condicionados a ele travar no valor', () => {
    expect(p).toMatch(/SE ELE TRAVAR/i);
    expect(p).toMatch(/R\$ ?19/);
    expect(p).toContain('[[ENVIAR_PIX_CURSO]]');
  });

  it('avisa explicitamente para não trocar as tags de Pix', () => {
    expect(p).toMatch(/N[ÃA]O o \[\[ENVIAR_PIX\]\]/);
  });

  it('suspenso recebe o mesmo tratamento de past_due', () => {
    expect(prompt({ plano: 'pro', billing_status: 'suspended' })).toMatch(/ACESSO PAUSADO/);
  });
});

describe('regras que não podem se perder', () => {
  it('a Giovanna nunca se apresenta como IA', () => {
    expect(prompt()).toMatch(/nunca diga que é IA/i);
  });

  it('o curso é oferecido como resposta a uma dor, não como brinde', () => {
    const p = prompt({ plano: 'free' });
    expect(p).toMatch(/N[ÃA]O ofereça no primeiro contato/i);
    expect(p).toMatch(/RESPOSTA pra uma dor/i);
  });
});
