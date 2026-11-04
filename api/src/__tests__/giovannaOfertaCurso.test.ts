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

import { buildSystemPrompt, semCupomDe19 } from '../services/agents/whatsapp/whatsappAgentService';

// ═══════════════════════════════════════════════════════════════════════════
// A ENTRADA DE R$19 SAIU DE VENDA EM 20/10/2026 (e do prompt da Giovanna em 03/11/2026).
//
// Era o curso Kit de Fechamento por pagamento único mais 30 dias de plataforma. Decisão do dono de 20/10: saem o ACESSO19 e o Pix de R$ 19.
// A Giovanna não pode mais oferecê-la a ninguém, nem como primeira oferta ao grátis nem como saída do inadimplente. O prompt é código, e
// regressão em prompt não quebra build: este teste trava o comportamento. O envio do Pix de R$ 19 também saiu (giovannaAgenteLaco.test.ts).
//
// Também travados aqui: ela nunca nega ser IA (regra do dono de 20/10), o preço é único e o que fica em "Para liberar" é vendido à parte,
// e o caminho de começar a usar é o do menu de hoje.
// ═══════════════════════════════════════════════════════════════════════════

const base = { email: 'x@y.com', nome_empresa: 'ACME', tem_cnpj: true, nome: 'Joao' };

const prompt = (over: Record<string, any> = {}) =>
  buildSystemPrompt({ ...base, plano: 'free', ...over } as any);

describe('FREE: a entrada de R$19 não existe mais', () => {
  const p = prompt({ plano: 'free' });

  it('não recebe a oferta de R$19 nem o curso como produto', () => {
    expect(p).not.toMatch(/R\$ ?19/);
    expect(p).not.toMatch(/Kit de Fechamento por R\$/i);
    expect(p).not.toMatch(/A OFERTA DE ENTRADA/);
  });

  it('não sabe mandar o Pix do curso nem a imagem do kit', () => {
    expect(p).not.toContain('[[ENVIAR_PIX_CURSO]]');
    expect(p).not.toContain('[[ENVIAR_IMAGEM_KIT]]');
  });

  it('não promete 30 dias de plataforma aberta nem desconto de primeiro mês', () => {
    expect(p).not.toMatch(/30 dias/);
    expect(p).not.toMatch(/desconto de primeiro mês/i);
  });

  it('segue vendendo a assinatura de preço único e entrega o link do site', () => {
    expect(p).toMatch(/SUA MISSÃO: CONVERTER ESTE FREE EM ASSINANTE/);
    expect(p).toMatch(/R\$ ?67\/m[êe]s/);
    expect(p).toContain(process.env.DASHBOARD_URL || 'https://solardoc.app');
  });

  it('o que fica em Para liberar é vendido à parte, e a assinatura não promete toda a plataforma', () => {
    expect(p).toMatch(/Para liberar/);
    for (const nome of ['Kit Off-Grid', 'Inventário', 'Precificação', 'Kit Fecha Vendas', 'LimpaPro']) expect(p, nome).toContain(nome);
    expect(p).toMatch(/vendido à parte e não vem na assinatura/);
    expect(p).not.toMatch(/toda expansão da plataforma/i);
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

describe('inadimplente: a reativação é o site com o link e o cupom que existir, sem R$19 do curso', () => {
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
  // Era "exige comprovante E e-mail": desde 04/11/2026 todo Pix é o automático (assina uma vez com o e-mail da conta), sem comprovante.
  it('quando manda Pix, manda o Pix automático com o e-mail da conta e nunca pede comprovante', () => {
    expect(p).toMatch(/Pix AUTOMÁTICO/);
    expect(p).toMatch(/e-mail da conta/i);
    expect(p).toMatch(/NUNCA ofereça copia-e-cola e NUNCA peça comprovante/);
    expect(p).not.toMatch(/\*comprovante\* e o \*e-?mail\*/i);
  });

  it('sem cupom vivo, não inventa desconto: nem no Pix nem no cartão', () => {
    expect(p).toMatch(/N[ÃA]O h[áa] cupom de desconto — n[ãa]o invente nenhum/i);
    expect(p).toMatch(/Não existe desconto, nem no Pix nem no cartão: é R\$ 67 por mês/);
    expect(p).not.toMatch(/desconto de primeiro mês/i);
  });

  it('com um cupom vivo que não é o de R$ 19, manda digitar o código no checkout e diz que o desconto é só no cartão', () => {
    const comCupom = buildSystemPrompt(
      { ...base, plano: 'pro', billing_status: 'past_due' } as any,
      undefined,
      { codigo: 'VOLTA10', primeiroMes: 57, precoCheio: 67 },
    );
    expect(comCupom).toMatch(/digita.*VOLTA10|VOLTA10.*checkout/i);
    expect(comCupom).toMatch(/primeiro m[êe]s R\$ ?57/i);
    expect(comCupom).toMatch(/desconto de primeiro mês existe SÓ no cartão/i);
    expect(comCupom).not.toMatch(/Não existe desconto, nem no Pix nem no cartão/);
  });

  it('a saída de R$19 do curso e o aviso de "dois R$19" saíram do dunning', () => {
    expect(p).not.toMatch(/SE ELE TRAVAR/i);
    expect(p).not.toMatch(/R\$ ?19/);
    expect(p).not.toContain('[[ENVIAR_PIX_CURSO]]');
    expect(p).not.toContain('[[ENVIAR_IMAGEM_KIT]]');
    expect(p).not.toMatch(/N[ÃA]O CONFUNDA os dois caminhos/i);
  });

  it('suspenso recebe o mesmo tratamento de past_due', () => {
    expect(prompt({ plano: 'pro', billing_status: 'suspended' })).toMatch(/ACESSO PAUSADO/);
  });
});

describe('semCupomDe19: tira SÓ o cupom da entrada de R$ 19', () => {
  it('tira o cupom de primeiro mês de R$ 19, qualquer que seja o código', () => {
    expect(semCupomDe19({ codigo: 'QUALQUER', primeiroMes: 19, precoCheio: 67 })).toBeNull();
  });

  it('tira o ACESSO19 em qualquer caixa e com espaços, mesmo que o valor seja outro', () => {
    for (const codigo of ['ACESSO19', 'acesso19', ' Acesso19 ']) {
      expect(semCupomDe19({ codigo, primeiroMes: 30, precoCheio: 67 }), codigo).toBeNull();
    }
  });

  it('mantém outro cupom vivo como está, e null continua null', () => {
    const outro = { codigo: 'VOLTA10', primeiroMes: 57, precoCheio: 67 };
    expect(semCupomDe19(outro)).toBe(outro);
    expect(semCupomDe19(null)).toBeNull();
  });
});

describe('regras que não podem se perder', () => {
  it('a Giovanna nunca nega ser IA: diz que sim numa frase e volta ao assunto', () => {
    for (const plano of ['free', 'pro', 'ilimitado']) {
      const p = prompt({ plano });
      expect(p, plano).toMatch(/Sou a IA do SolarDoc, sim\./);
      expect(p, plano).toMatch(/Nunca diga que é humana, pessoa ou gente de verdade/);
      expect(p, plano).not.toMatch(/HUMANA DO COMEÇO AO FIM/);
      expect(p, plano).not.toMatch(/nunca diga que é IA/i);
      expect(p, plano).not.toMatch(/mas humana e consultiva/);
    }
    expect(prompt({ plano: 'pro', billing_status: 'past_due' })).not.toMatch(/você é a Giovanna, humana/);
  });

  it('o menu de hoje: Nova proposta, Ler conta de luz, Papelada, Arquivos e Para liberar; nada de Escanear Conta', () => {
    const p = prompt({ plano: 'free' });
    for (const trecho of ['Nova proposta', 'Ler conta de luz', 'Papelada', 'Arquivos', 'Para liberar', 'Outros documentos']) {
      expect(p, trecho).toContain(trecho);
    }
    expect(p).not.toContain('Escanear Conta');
  });
});
