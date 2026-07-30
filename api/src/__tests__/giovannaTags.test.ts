import { describe, it, expect, vi } from 'vitest';

// Dependências pesadas do módulo (SDK, banco, Z-API) não têm nada a ver com o
// parse de tags — mockadas só pra permitir o import da função pura.
vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, sendHuman: vi.fn(), sendImage: vi.fn(), sendWhatsApp: vi.fn(),
}));
vi.mock('../services/agents/sdr/sdrAgentService', () => ({ handleSdrLead: vi.fn() }));
vi.mock('../services/agents/whatsapp/promoGeradorActivation', () => ({
  detectAndActivatePromoCredits: vi.fn(),
}));

import { parseTagsResposta } from '../services/agents/whatsapp/whatsappAgentService';

// ═══════════════════════════════════════════════════════════════════════════
// Tags da Giovanna.
//
// Duas tags de Pix convivem e valem VALORES DIFERENTES: ENVIAR_PIX = R$67
// (reativação) e ENVIAR_PIX_CURSO = R$19 (entrada com o curso). Casar uma
// como a outra faz o cliente pagar o valor errado — e ele só descobre depois
// de pagar. É o bug mais caro possível neste arquivo, então tem teste próprio.
// ═══════════════════════════════════════════════════════════════════════════

describe('ENVIAR_PIX vs ENVIAR_PIX_CURSO', () => {
  it('a tag do curso NÃO aciona o Pix de R$67', () => {
    const r = parseTagsResposta('Fechou! [[ENVIAR_PIX_CURSO]]');
    expect(r.pedePixCurso).toBe(true);
    expect(r.pedePix).toBe(false);   // ← o bug que este teste existe pra pegar
  });

  it('a tag da reativação aciona só o Pix de R$67', () => {
    const r = parseTagsResposta('Vamos reativar então [[ENVIAR_PIX]]');
    expect(r.pedePix).toBe(true);
    expect(r.pedePixCurso).toBe(false);
  });

  it('as duas juntas: o handler prioriza o curso (é o `else if` do envio)', () => {
    const r = parseTagsResposta('[[ENVIAR_PIX]] [[ENVIAR_PIX_CURSO]]');
    expect(r.pedePixCurso).toBe(true);
    expect(r.pedePix).toBe(true);
    // A exclusividade é garantida no envio; aqui garantimos que o curso é
    // detectável mesmo quando o modelo emite as duas por engano.
  });
});

describe('nenhuma tag pode vazar pro cliente', () => {
  const casos = [
    '[[ENVIAR_PIX_CURSO]]',
    '[[ENVIAR_PIX]]',
    '[[ENVIAR_IMAGEM_KIT]]',
    '[HUMANO]',
    '[[ ENVIAR_PIX_CURSO ]]',      // com espaços
    '[[enviar_pix_curso]]',        // minúsculo
    '[[Enviar_Imagem_Kit]]',       // misto
  ];

  for (const tag of casos) {
    it(`remove ${tag} do texto enviado`, () => {
      const { parts } = parseTagsResposta(`Olha só ${tag} beleza?`);
      const texto = parts.join(' ');
      expect(texto).not.toMatch(/\[\[/);
      expect(texto).not.toMatch(/ENVIAR_/i);
      expect(texto).not.toMatch(/\[HUMANO\]/i);
      expect(texto).toContain('Olha só');
      expect(texto).toContain('beleza?');
    });
  }

  it('detecta variações com espaço e caixa diferente', () => {
    expect(parseTagsResposta('[[ enviar_pix_curso ]]').pedePixCurso).toBe(true);
    expect(parseTagsResposta('[[Enviar_Imagem_Kit]]').pedeImagemKit).toBe(true);
    expect(parseTagsResposta('[humano]').pedeHumano).toBe(true);
  });
});

describe('bolhas', () => {
  it('separa por || e descarta vazias', () => {
    const { parts } = parseTagsResposta('Primeira || Segunda ||  || Terceira');
    expect(parts).toEqual(['Primeira', 'Segunda', 'Terceira']);
  });

  it('tag sozinha não gera bolha vazia (o cliente não recebe mensagem em branco)', () => {
    const { parts, pedePixCurso } = parseTagsResposta('[[ENVIAR_PIX_CURSO]]');
    expect(pedePixCurso).toBe(true);
    expect(parts).toEqual([]);
  });

  it('texto sem tag nenhuma passa intacto', () => {
    const r = parseTagsResposta('Bom dia! Tudo certo por aí?');
    expect(r.parts).toEqual(['Bom dia! Tudo certo por aí?']);
    expect(r.pedePix).toBe(false);
    expect(r.pedePixCurso).toBe(false);
    expect(r.pedeImagemKit).toBe(false);
    expect(r.pedeHumano).toBe(false);
  });

  it('imagem do curso + Pix do curso na mesma resposta funcionam juntas', () => {
    const r = parseTagsResposta('É esse aqui ó [[ENVIAR_IMAGEM_KIT]] || bora? [[ENVIAR_PIX_CURSO]]');
    expect(r.pedeImagemKit).toBe(true);
    expect(r.pedePixCurso).toBe(true);
    expect(r.pedePix).toBe(false);
    expect(r.parts).toEqual(['É esse aqui ó', 'bora?']);
  });
});
