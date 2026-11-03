import { describe, it, expect, vi } from 'vitest';

// E-mail do Pix que ficou esperando (03/11/2026): enviado fora da janela do WhatsApp, 1 por contrato.

const enviados: any[] = [];
let erro: { name: string; message: string } | null = null;
vi.mock('resend', () => ({
  Resend: class { emails = { send: async (o: any) => { enviados.push(o); return { error: erro }; } }; },
}));

import { sendPixEsperandoEmail } from '../utils/mailer';

const LINK = 'https://solardoc.app/?pagar=pix&utm_source=recuperacao&utm_medium=email&utm_term=conj123';

describe('e-mail do Pix que ficou esperando', () => {
  it('assunto, destinatário, texto aprovado e botão "Gerar meu Pix" com o link', async () => {
    enviados.length = 0; erro = null;
    await sendPixEsperandoEmail({ to: 'ana@exemplo.com', link: LINK });
    expect(enviados).toHaveLength(1);
    const e = enviados[0];
    expect(e.subject).toBe('Seu Pix do SolarDoc ficou esperando');
    expect(e.to).toBe('ana@exemplo.com');
    for (const trecho of [
      'Oi, aqui é a Carla, do SolarDoc.',
      'Vi que você começou a assinar e o Pix não chegou a ser pago. Acontece, e dá para gerar outro em 1 minuto.',
      'Mais de 3.600 propostas solares já saíram pelo SolarDoc, e mais de 700 só no último mês.',
      'O Pix é automático: R$ 67 por mês, no nome da AIOROS GROUP, dona do SolarDoc. O banco debita sozinho e você cancela quando quiser pelo app do banco, sem falar com ninguém.',
    ]) {
      expect(e.html).toContain(trecho);
      expect(e.text).toContain(trecho);
    }
    expect(e.html).toContain('>Gerar meu Pix</a>');
    expect(e.html).toContain('href="https://solardoc.app/?pagar=pix&amp;utm_source=recuperacao&amp;utm_medium=email&amp;utm_term=conj123"');
    expect(e.text).toContain(LINK);
    expect(`${e.html}${e.text}`).not.toMatch(/[–—]/);
  });

  it('o Resend recusar joga erro (quem chama solta o claim)', async () => {
    erro = { name: 'validation_error', message: 'x' };
    await expect(sendPixEsperandoEmail({ to: 'ana@exemplo.com', link: LINK })).rejects.toThrow(/Resend error/);
    erro = null;
  });
});
