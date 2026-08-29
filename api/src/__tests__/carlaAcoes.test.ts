import { describe, it, expect } from 'vitest';

import {
  parseAcoesCarla, pecaDaTag, MIDIA_CARLA, TAGS_MIDIA, blocoDeAcoes,
} from '../services/agents/sdr/carlaAcoes';

// ═══════════════════════════════════════════════════════════════════════════
// Ações da Carla.
//
// Esta função decide se a intenção da agente vira ato ou vira lixo na tela do
// lead. Os dois modos de falhar são caros e opostos:
//   1. Tag não reconhecida → ela "mostra a proposta" e o lead recebe texto
//      solto. Foi o que aconteceu por dois meses, quando o prompt anunciava 11
//      peças e o código conhecia zero.
//   2. Tag reconhecida mas não removida → o lead lê "[[ENVIAR_IMAGEM:...]]" no
//      WhatsApp. Pior que o primeiro caso: denuncia o robô E não entrega nada.
// ═══════════════════════════════════════════════════════════════════════════

describe('parseAcoesCarla', () => {
  it('reconhece a peça e tira a tag do texto', () => {
    const r = parseAcoesCarla('é essa aqui, ó [[ENVIAR_IMAGEM:orcamento_1pagina]]');
    expect(r.imagem).toBe('orcamento_1pagina');
    expect(r.limpo).toBe('é essa aqui, ó');
    expect(r.limpo).not.toContain('[[');
  });

  it('reconhece o Pix e tira a tag', () => {
    const r = parseAcoesCarla('sem problema, tem no pix também||[[ENVIAR_PIX]]');
    expect(r.pix).toBe(true);
    expect(r.limpo).not.toContain('ENVIAR_PIX');
  });

  it('não confunde texto sobre pix com o pedido de pix', () => {
    // A agente fala "pix" o tempo todo em conversa de pagamento. Só a TAG cobra.
    const r = parseAcoesCarla('dá pra pagar no pix sim, prefere assim?');
    expect(r.pix).toBe(false);
    expect(r.imagem).toBeNull();
  });

  it('tag desconhecida some do texto e é sinalizada', () => {
    // O lead nunca pode ver a tag, mesmo quando ela erra o nome da peça.
    const r = parseAcoesCarla('olha só [[ENVIAR_IMAGEM:proposta_bonita]]');
    expect(r.imagem).toBeNull();
    expect(r.imagemInvalida).toBe('proposta_bonita');
    expect(r.limpo).toBe('olha só');
  });

  it('duas imagens na mesma resposta: vale a primeira e as duas somem', () => {
    // Regra de anti-ban: uma peça por resposta. A linha já caiu uma vez por
    // envio automático, e três imagens seguidas é o que um disparo parece.
    const r = parseAcoesCarla('a [[ENVIAR_IMAGEM:doc_contrato]] b [[ENVIAR_IMAGEM:doc_recibo]]');
    expect(r.imagem).toBe('doc_contrato');
    expect(r.limpo).not.toContain('[[');
  });

  it('aceita a tag com espaços e em maiúscula', () => {
    const r = parseAcoesCarla('[[ ENVIAR_IMAGEM : DOC_CONTRATO ]]');
    expect(r.imagem).toBe('doc_contrato');
  });

  it('imagem e pix na mesma resposta funcionam juntos', () => {
    const r = parseAcoesCarla('é essa [[ENVIAR_IMAGEM:orcamento_1pagina]] e o pix [[ENVIAR_PIX]]');
    expect(r.imagem).toBe('orcamento_1pagina');
    expect(r.pix).toBe(true);
    expect(r.limpo).toBe('é essa e o pix');
  });

  it('resposta que era só a tag devolve texto vazio, não a tag', () => {
    // O handler usa isso pra decidir que o anexo É a resposta e não grudar um
    // "me perdi aqui" numa proposta.
    const r = parseAcoesCarla('[[ENVIAR_IMAGEM:orcamento_1pagina]]');
    expect(r.limpo).toBe('');
    expect(r.imagem).toBe('orcamento_1pagina');
  });

  it('texto sem tag nenhuma passa intacto', () => {
    const t = 'quantas propostas você faz por mês?';
    expect(parseAcoesCarla(t).limpo).toBe(t);
  });
});

describe('catálogo de mídia', () => {
  it('toda peça tem URL https e legenda que aponta o que olhar', () => {
    for (const [tag, peca] of Object.entries(MIDIA_CARLA)) {
      expect(peca.url, tag).toMatch(/^https:\/\//);
      // JPG é obrigatório: o WhatsApp trata WEBP como figurinha, e as 26 folhas
      // publicadas em solardoc.app/tela são todas .webp. Mandar webp entregaria
      // um sticker no lugar da proposta.
      expect(peca.url, tag).toMatch(/\.jpg$/);
      expect(peca.legenda.length, tag).toBeGreaterThan(20);
      expect(peca.legenda, tag).not.toMatch(/^olha (aí|ai)/i);
    }
  });

  it('o prompt anuncia exatamente as tags que o código executa', () => {
    // A divergência entre as duas listas é o bug original: o prompt prometia 11
    // peças e o código não conhecia nenhuma.
    const bloco = blocoDeAcoes();
    for (const tag of TAGS_MIDIA) expect(bloco).toContain(`[[ENVIAR_IMAGEM:${tag}]]`);
    const anunciadas = [...bloco.matchAll(/\[\[ENVIAR_IMAGEM:([a-z0-9_]+)\]\]/g)].map((m) => m[1]);
    expect(anunciadas.sort()).toEqual([...TAGS_MIDIA].sort());
  });

  it('a peça que os leads mais pediram existe', () => {
    // Três leads pediram ver a proposta; um deles quatro vezes.
    expect(pecaDaTag('orcamento_1pagina')).not.toBeNull();
  });

  it('pecaDaTag devolve null pra tag inexistente e pra null', () => {
    expect(pecaDaTag('nao_existe')).toBeNull();
    expect(pecaDaTag(null)).toBeNull();
  });
});
