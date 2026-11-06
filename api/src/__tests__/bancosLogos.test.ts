import { describe, it, expect } from 'vitest';
import { BANCOS_IDS, BANCOS_FIXOS, bancosEscolhidos } from '../services/templates/bancosLogos';

describe('bancosEscolhidos', () => {
  it('undefined e null devolvem os 12 na ordem fixa', () => {
    expect(bancosEscolhidos(undefined)).toHaveLength(12);
    expect(bancosEscolhidos(undefined)).toEqual([...BANCOS_IDS]);
    expect(bancosEscolhidos(null)).toEqual([...BANCOS_IDS]);
  });

  it('array vazio devolve nenhum', () => {
    expect(bancosEscolhidos([])).toHaveLength(0);
  });

  it('filtra ids inválidos, tira repetidos e segue a ordem fixa', () => {
    expect(bancosEscolhidos(['itau', 'xx', 'itau', 'bb'])).toEqual(['bb', 'itau']);
  });

  it('aceita os ids novos e mantém a ordem fixa', () => {
    expect(bancosEscolhidos(['btg', '77sol', 'itau', 'solagora', 'solfacil'])).toEqual(['itau', 'solfacil', 'solagora', '77sol', 'btg']);
  });

  it('outro tipo devolve os 12', () => {
    expect(bancosEscolhidos('itau')).toHaveLength(12);
    expect(bancosEscolhidos(42)).toHaveLength(12);
    expect(bancosEscolhidos({})).toHaveLength(12);
  });
});

describe('BANCOS_FIXOS', () => {
  it('todo banco tem nome e imagem PNG válida em base64', () => {
    const assinatura = [0x89, 0x50, 0x4e, 0x47];
    for (const id of BANCOS_IDS) {
      const { nome, img } = BANCOS_FIXOS[id];
      expect(nome.length).toBeGreaterThan(0);
      expect(img.startsWith('data:image/png;base64,')).toBe(true);
      const bytes = Buffer.from(img.slice('data:image/png;base64,'.length), 'base64');
      expect([...bytes.subarray(0, 4)]).toEqual(assinatura);
    }
  });
});
