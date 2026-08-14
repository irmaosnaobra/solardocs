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

  // PREÇO ÚNICO: antes ela dizia "aí sim escolhe PRO (R$27) ou VIP (R$67)".
  // Não há mais escolha — no fim dos 30 dias ele assina o preço único ou não.
  it('diz que a decisão de assinar fica pro fim dos 30 dias, num preço só', () => {
    expect(p).toMatch(/30 dias/);
    expect(p).toMatch(/R\$ ?67\/m[êe]s/);
    expect(p).not.toMatch(/escolhe PRO|PRO ou VIP|PRO \(R\$ ?27\)/);
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

  // Preço único: não existe upgrade pra oferecer, e o prompt não pode nomear
  // degrau ("VIP"/"PRO") — quem paga é só "assinante".
  it('assinante segue orientado a NÃO receber upgrade', () => {
    const p = prompt({ plano: 'ilimitado' });
    expect(p).toMatch(/N[ÃA]O ofereça upgrade/i);
    expect(p).toMatch(/JÁ PAGA/i);
  });
});

describe('inadimplente — R$19 só como saída, nunca como primeira oferta', () => {
  const p = prompt({ plano: 'pro', billing_status: 'past_due' });

  // Desde 08/08/2026 a reativação OFERECIDA é LINK + CUPOM (o cliente reassina
  // sozinho no site). O Pix não sumiu: ele existe sob demanda, pra quem pedir.
  it('a oferta de reativação é o site, com o link+cupom', () => {
    expect(p).toMatch(/ACESSO PAUSADO/);
    expect(p).toContain('[[ENVIAR_LINK_CUPOM]]');
  });

  it('o Pix só aparece condicionado a ELE pedir', () => {
    expect(p).toMatch(/SE ELE PEDIR PIX/);
    expect(p).toContain('[[ENVIAR_PIX]]');
  });

  // O e-mail é o que casa o pagamento com a conta: sem ele o cliente paga e fica
  // esperando alguém liberar na mão — exatamente o que este fluxo veio matar.
  it('quando manda Pix, exige comprovante E e-mail', () => {
    expect(p).toMatch(/\*comprovante\* e o \*e-?mail\*/i);
  });

  it('sem cupom vivo, não inventa desconto', () => {
    expect(p).toMatch(/N[ÃA]O h[áa] cupom de desconto — n[ãa]o invente nenhum/i);
  });

  it('com cupom vivo, manda digitar o código no checkout', () => {
    const comCupom = buildSystemPrompt(
      { ...base, plano: 'pro', billing_status: 'past_due' } as any,
      undefined,
      { codigo: 'ACESSO19', primeiroMes: 19, precoCheio: 67 },
    );
    expect(comCupom).toMatch(/digita.*ACESSO19|ACESSO19.*checkout/i);
    expect(comCupom).toMatch(/primeiro m[êe]s R\$ ?19/i);
  });

  it('os R$19 do curso aparecem condicionados a ele travar no valor', () => {
    expect(p).toMatch(/SE ELE TRAVAR/i);
    expect(p).toMatch(/R\$ ?19/);
    expect(p).toContain('[[ENVIAR_PIX_CURSO]]');
  });

  // Dois R$19 convivem agora: o do CURSO (Pix, pagamento único) e o do CUPOM
  // (primeiro mês da assinatura, no cartão). Trocar um pelo outro na conversa é
  // vender a coisa errada — o prompt tem que dizer isso com todas as letras.
  it('avisa explicitamente para não confundir os dois R$19', () => {
    expect(p).toMatch(/N[ÃA]O CONFUNDA os dois caminhos de R\$ ?19/i);
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
