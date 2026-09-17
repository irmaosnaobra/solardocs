import { describe, it, expect } from 'vitest';

import { buildMessage } from '../services/instagram/igClient';

// Carrossel para quem NAO disse o que quer (17/09/2026).
//
// Tres botoes e o teto de UM cartao, nao da mensagem. Sao seis produtos, e quem
// comenta "quanto custa?" sem dizer de que caia num menu de tres estava sendo
// mandado para um lugar que podia nao ser o dele.

const MENU = {
  cards: [
    { title: 'Qual deles e o seu caso?', subtitle: 'Toque no botao do que voce procura.',
      buttons: [
        { url: 'https://solardoc.app/simular', title: 'Energia solar' },
        { url: 'https://solardoc.app/io/eletroposto', title: 'Eletroposto' },
        { url: 'https://solardoc.app/bike', title: 'Bike eletrica' },
      ] },
    { title: 'Trabalha com energia solar?', subtitle: 'Ferramentas e formacao de quem vende e instala.',
      buttons: [
        { url: 'https://solardoc.app/kit', title: 'Kit de fechamento' },
        { url: 'https://limpapro.solardoc.app/', title: 'Limpa Solar Pro' },
        { url: 'https://solardoc.app/', title: 'SolarDoc' },
      ] },
  ],
};

describe('carrossel do menu', () => {
  it('monta um elemento por cartao, com os botoes de cada um', () => {
    const p = buildMessage(MENU).attachment.payload;
    expect(p.template_type).toBe('generic');
    expect(p.elements).toHaveLength(2);
    expect(p.elements[0].buttons.map((b: any) => b.title))
      .toEqual(['Energia solar', 'Eletroposto', 'Bike eletrica']);
    expect(p.elements[1].buttons.map((b: any) => b.title))
      .toEqual(['Kit de fechamento', 'Limpa Solar Pro', 'SolarDoc']);
  });

  it('nenhum cartao abre no toque: quem escolhe e a pessoa', () => {
    const els = buildMessage(MENU).attachment.payload.elements;
    expect(els.every((e: any) => e.default_action === undefined)).toBe(true);
  });

  it('respeita os tetos da Meta: 3 botoes por cartao, 10 cartoes, rotulo 20', () => {
    const p = buildMessage({
      cards: Array.from({ length: 14 }, (_, i) => ({
        title: 'Cartao ' + i,
        buttons: [1, 2, 3, 4, 5].map(j => ({ url: 'https://x.y/' + j, title: 'Rotulo bem comprido ' + j })),
      })),
    }).attachment.payload;
    expect(p.elements).toHaveLength(10);
    expect(p.elements[0].buttons).toHaveLength(3);
    expect(p.elements[0].buttons[0].title).toHaveLength(20);
  });

  it('cartao sem titulo ou sem botao valido nao entra pela metade', () => {
    const p = buildMessage({
      cards: [
        { title: '', buttons: [{ url: 'https://a', title: 'A' }] },
        { title: 'Sem botao bom', buttons: [{ url: '', title: 'X' }] },
        { title: 'Bom', buttons: [{ url: 'https://c', title: 'C' }] },
      ],
    }).attachment.payload;
    expect(p.elements).toHaveLength(1);
    expect(p.elements[0].title).toBe('Bom');
  });

  it('sem cartao valido nenhum, cai no caminho de sempre', () => {
    const m = buildMessage({ text: 'texto', cards: [{ title: '', buttons: [] }] });
    expect(m.text).toBe('texto');
    expect(m.attachment).toBeUndefined();
  });
});
