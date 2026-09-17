import { describe, it, expect } from 'vitest';

import { buildMessage } from '../services/instagram/igClient';

// Card de MAIS DE UM destino (17/09/2026).
//
// O Menu e a rede de seguranca pegam quem disse que tem interesse sem dizer de
// qual produto. Ate aqui pediam pra pessoa DIGITAR "SOLAR", "ELETROPOSTO" ou
// "BIKE": um toque a mais, num ponto do funil onde metade nao responde.
// Agora sao tres botoes num card so, que e o teto da Meta.

const TRES = {
  text: 'Qual deles e o seu caso?\nToque no botao e eu te levo direto.',
  buttons: [
    { url: 'https://solardoc.app/simular',       title: 'Energia solar' },
    { url: 'https://solardoc.app/io/eletroposto', title: 'Eletroposto' },
    { url: 'https://solardoc.app/bike',           title: 'Bike eletrica' },
  ],
};

describe('card com mais de um destino', () => {
  it('monta os tres botoes no template generic', () => {
    const el = buildMessage(TRES).attachment.payload.elements[0];
    expect(el.buttons).toHaveLength(3);
    expect(el.buttons.map((b: any) => b.title)).toEqual(['Energia solar', 'Eletroposto', 'Bike eletrica']);
    expect(el.buttons.every((b: any) => b.type === 'web_url')).toBe(true);
  });

  it('NAO abre no toque do card quando ha mais de um destino', () => {
    // Tocar no card levaria ao primeiro produto sem a pessoa ter escolhido.
    const el = buildMessage(TRES).attachment.payload.elements[0];
    expect(el.default_action).toBeUndefined();
  });

  it('com um destino so, o toque no card continua abrindo o link', () => {
    const el = buildMessage({ text: 'Um titulo', button: { url: 'https://x.y', title: 'Ir' } })
      .attachment.payload.elements[0];
    expect(el.default_action.url).toBe('https://x.y');
    expect(el.buttons).toHaveLength(1);
  });

  it('corta no teto da Meta: 3 botoes e rotulo de 20', () => {
    const el = buildMessage({
      text: 'T',
      buttons: [1, 2, 3, 4, 5].map(i => ({ url: 'https://x.y/' + i, title: 'Rotulo bem comprido ' + i })),
    }).attachment.payload.elements[0];
    expect(el.buttons).toHaveLength(3);
    expect(el.buttons[0].title).toHaveLength(20);
  });

  it('botao sem url ou sem rotulo nao entra pela metade', () => {
    const el = buildMessage({
      text: 'T',
      buttons: [{ url: 'https://ok', title: 'Bom' }, { url: '', title: 'Sem url' }, { url: 'https://y', title: '' }],
    }).attachment.payload.elements[0];
    expect(el.buttons).toHaveLength(1);
  });

  it('sem botao nenhum volta a ser texto puro', () => {
    const m = buildMessage({ text: 'so texto', buttons: [] });
    expect(m.text).toBe('so texto');
    expect(m.attachment).toBeUndefined();
  });
});
