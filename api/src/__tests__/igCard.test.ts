import { describe, it, expect } from 'vitest';

import { buildMessage } from '../services/instagram/igClient';

const CARD = {
  text: 'Bike Konnan, pronta entrega.\nToque no botão e fale com a gente agora no WhatsApp.',
  button: { url: 'https://wa.me/5534998165040', title: 'Falar no WhatsApp' },
};

describe('card com botão (o que o cliente toca)', () => {
  it('usa o template GENERIC — o `button` é do Messenger e o Instagram recusa', () => {
    const m = buildMessage(CARD);
    expect(m.attachment.payload.template_type).toBe('generic');
    const el = m.attachment.payload.elements[0];
    expect(el.title).toBe('Bike Konnan, pronta entrega.');
    expect(el.subtitle).toBe('Toque no botão e fale com a gente agora no WhatsApp.');
    expect(el.buttons[0]).toEqual({ type: 'web_url', url: CARD.button.url, title: 'Falar no WhatsApp' });
    // Tocar no card inteiro leva pro mesmo lugar do botão.
    expect(el.default_action.url).toBe(CARD.button.url);
  });

  it('respeita os limites da Meta (título 80, subtítulo 80, rótulo 20)', () => {
    const m = buildMessage({
      text: 'x'.repeat(120) + '\n' + 'y'.repeat(120),
      button: { url: 'https://solardoc.app/kit', title: 'Rótulo absurdamente comprido' },
    });
    const el = m.attachment.payload.elements[0];
    expect(el.title.length).toBe(80);
    expect(el.subtitle.length).toBe(80);
    expect(el.buttons[0].title.length).toBe(20);
  });

  it('sem botão continua sendo mensagem de texto simples', () => {
    const m = buildMessage({ text: 'Oi!' });
    expect(m).toEqual({ text: 'Oi!' });
    expect(m.attachment).toBeUndefined();
  });

  it('quick reply (o botão do porteiro) não vira template', () => {
    const m = buildMessage({ text: 'Me segue', quick_replies: [{ title: 'Seguindo', payload: 'IG_GATE_SEGUINDO' }] });
    expect(m.attachment).toBeUndefined();
    expect(m.quick_replies[0].content_type).toBe('text');
  });
});
