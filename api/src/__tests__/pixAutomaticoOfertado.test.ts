import { describe, it, expect, afterEach } from 'vitest';
import {
  pixAutomaticoLink, fraseOferecePixAutomatico, bolhasPixCheckout, pixBlocoWhatsApp, pixBlocoEmailHtml, fraseProximoMesSemComprovante,
} from '../utils/pixInfo';
import { emBolhas } from '../services/agents/bolhas';

// Ordem do dono (04/11/2026): todo lugar que OFERECE Pix oferece o Pix automático, com o link dentro da frase.
// Nada que sai por aqui pode trazer o copia e cola (000201), a chave, a Kiwify ou pedido de comprovante.

const SALVO = process.env.SOLARDOC_PIX_CHECKOUT_URL;
afterEach(() => {
  if (SALVO === undefined) delete process.env.SOLARDOC_PIX_CHECKOUT_URL; else process.env.SOLARDOC_PIX_CHECKOUT_URL = SALVO;
});

const ORIGENS = ['recuperacao', 'sdr', 'giovanna', 'renovacao', 'abandono'];

describe('link do Pix automático', () => {
  it('leva utm_source da origem, utm_medium=whatsapp e nenhum utm_term', () => {
    for (const o of ORIGENS) {
      expect(pixAutomaticoLink(o)).toBe(`https://solardoc.app/?pagar=pix&utm_source=${o}&utm_medium=whatsapp`);
    }
    expect(pixAutomaticoLink('email', 'email')).toBe('https://solardoc.app/?pagar=pix&utm_source=email&utm_medium=email');
    expect(pixAutomaticoLink('x')).not.toContain('utm_term');
  });
});

describe('textos de WhatsApp que oferecem Pix: 1 bolha, link dentro da frase, sem Kiwify nem copia e cola', () => {
  const textos = (): Array<[string, string]> => [
    ...ORIGENS.map((o): [string, string] => [`bolhasPixCheckout(${o})`, bolhasPixCheckout(o).join(' ')]),
    ['pixBlocoWhatsApp', pixBlocoWhatsApp()],
    ['fraseProximoMesSemComprovante', fraseProximoMesSemComprovante()],
    ['fraseOferecePixAutomatico', fraseOferecePixAutomatico('giovanna')],
  ];

  it('bolhasPixCheckout devolve UMA frase só', () => {
    for (const o of ORIGENS) expect(bolhasPixCheckout(o)).toHaveLength(1);
  });

  it.each(textos())('%s: emBolhas com maxBolhas 1 dá 1 bolha, e o link não fica sozinho', (_nome, t) => {
    expect(emBolhas(t, { maxBolhas: 1, max: 900 })).toHaveLength(1);
    expect(t).toContain('?pagar=pix&utm_source=');
    // link dentro da frase: nunca é a mensagem inteira, e há texto antes dele
    expect(t.trim()).not.toMatch(/^https?:\/\/\S+$/);
    expect(t).toMatch(/\S\s+https:\/\/solardoc\.app\/\?pagar=pix\S*/);
  });

  it('com a URL da Kiwify configurada, nada oferecido a traz, nem o código 000201, nem pede comprovante', () => {
    process.env.SOLARDOC_PIX_CHECKOUT_URL = 'https://pay.kiwify.com.br/TESTE';
    for (const [, t] of textos()) {
      expect(t).not.toMatch(/kiwify|000201|63636043000188/i);
      expect(t).not.toMatch(/mand[ea] (o )?comprovante/i);
    }
  });

  it('a frase de oferta diz para usar o e-mail da conta', () => {
    expect(fraseOferecePixAutomatico('giovanna')).toMatch(/e-mail da sua conta/);
  });

  it('o fecho da confirmação é a frase combinada, com utm_source=renovacao', () => {
    expect(fraseProximoMesSemComprovante()).toBe(
      'Se quiser, o próximo mês já fica sem comprovante: é só assinar o Pix automático em https://solardoc.app/?pagar=pix&utm_source=renovacao&utm_medium=whatsapp.',
    );
  });
});

describe('pixBlocoEmailHtml', () => {
  it('traz o botão "Assinar no Pix automático" com o link do e-mail, e não traz chave, Kiwify nem pedido de comprovante', () => {
    process.env.SOLARDOC_PIX_CHECKOUT_URL = 'https://pay.kiwify.com.br/TESTE';
    const html = pixBlocoEmailHtml();
    expect(html).toContain('>Assinar no Pix automático</a>');
    expect(html).toContain('href="https://solardoc.app/?pagar=pix&utm_source=email&utm_medium=email"');
    expect(html).not.toMatch(/kiwify|000201|63636043000188|mand[ea] (o )?comprovante/i);
  });
});
