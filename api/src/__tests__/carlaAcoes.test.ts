import { describe, it, expect } from 'vitest';

import {
  parseAcoesCarla, pecaDaTag, MIDIA_CARLA, TAGS_MIDIA, blocoDeAcoes,
  BOLHAS_CARLA,
} from '../services/agents/sdr/carlaAcoes';
import { emBolhas } from '../services/agents/bolhas';

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

// ═══════════════════════════════════════════════════════════════════════════
// Bolhas curtas.
//
// Ordem do Thiago em 30/08/2026: "bolhas curtas sempre". O que ele leu como
// parede não era texto longo (mediana medida: 128 caracteres), era TEMPO: com
// slow=true cada bolha gasta de 8 a 15s de "digitando" mais 2,5 a 5,5s de
// intervalo, então o teto padrão de 5 bolhas ocupa de 50 a 97 segundos da tela.
// Sem teste, esse teto sobe de novo na primeira vez que alguém mexer no envio.
// ═══════════════════════════════════════════════════════════════════════════

describe('BOLHAS_CARLA', () => {
  it('mantém o teto em 2 bolhas e 120 caracteres', () => {
    // 2, alinhado com o padrão da casa desde 31/08/2026: o WhatsApp conta bolha,
    // e o robô gastava 3,78 delas por toque. Baixar o teto corta 53,8% do
    // contador do número sem perder um contato.
    expect(BOLHAS_CARLA.maxBolhas).toBe(2);
    expect(BOLHAS_CARLA.max).toBe(120);
  });

  it('continua com slow ligado (ritmo de vendedora, não de bot de suporte)', () => {
    expect(BOLHAS_CARLA.slow).toBe(true);
  });

  it('resposta comprida sai em no máximo 3 bolhas, sem perder texto', () => {
    const longo = [
      'primeira ideia que ela quer passar pro lead aqui',
      'segunda ideia completamente diferente da primeira',
      'terceira ideia que também é longa e ocupa espaço',
      'quarta ideia que deveria ser juntada com as outras',
      'quinta ideia que estouraria o teto se não houvesse trava',
    ].join('||');
    const saida = emBolhas(longo, { max: BOLHAS_CARLA.max, maxBolhas: BOLHAS_CARLA.maxBolhas });
    expect(saida.length).toBeLessThanOrEqual(2);
    // emBolhas nunca trunca: junta o excesso. Todo pedaço tem que sobreviver.
    for (const p of ['primeira ideia', 'quinta ideia']) {
      expect(saida.join(' ')).toContain(p);
    }
  });

  it('resposta curta de verdade sai em bolha curta', () => {
    const saida = emBolhas('então você paga 100% e usa 30%||aqui é R$ 67 o mês inteiro', {
      max: BOLHAS_CARLA.max, maxBolhas: BOLHAS_CARLA.maxBolhas,
    });
    expect(saida.length).toBeLessThanOrEqual(2);
  });
});
