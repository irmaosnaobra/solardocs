import { describe, it, expect, vi } from 'vitest';

// E-mail do Pix que ficou esperando (03/11/2026): enviado fora da janela do WhatsApp, 1 por contrato.

const enviados: any[] = [];
let erro: { name: string; message: string } | null = null;
vi.mock('resend', () => ({
  Resend: class { emails = { send: async (o: any) => { enviados.push(o); return { error: erro }; } }; },
}));

import { sendPixEsperandoEmail, sendPixAssineEmail } from '../utils/mailer';

const LINK = 'https://solardoc.app/?pagar=pix&utm_source=recuperacao&utm_medium=email&utm_term=conj123';

describe('e-mail do Pix que ficou esperando', () => {
  it('assunto, destinatário, texto aprovado e botão "Gerar meu Pix" com o link', async () => {
    enviados.length = 0; erro = null;
    await sendPixEsperandoEmail({ to: 'ana@exemplo.com', link: LINK });
    expect(enviados).toHaveLength(1);
    const e = enviados[0];
    expect(e.subject).toBe('Seu Pix da SolarDoc ficou esperando');
    expect(e.to).toBe('ana@exemplo.com');
    for (const trecho of [
      'Oi, aqui é a Carla, da SolarDoc.',
      'Vi que você começou a assinar e o Pix não chegou a ser pago. Acontece, e dá para gerar outro em 1 minuto.',
      'Mais de 3.600 propostas solares já saíram pela SolarDoc, e mais de 700 só no último mês.',
      'O Pix é automático: R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc. O banco debita sozinho e você cancela quando quiser pelo app do banco, sem falar com ninguém.',
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

describe('e-mail do dia seguinte (Assine a SolarDoc no Pix automático)', () => {
  const LINK2 = 'https://solardoc.app/?pagar=pix&utm_source=recuperacao&utm_medium=email&utm_term=conj123';
  it('assunto, texto aprovado, os 3 depoimentos literais com "Nome, Empresa, Cidade" e o botão com o link', async () => {
    enviados.length = 0; erro = null;
    await sendPixAssineEmail({ to: 'ana@exemplo.com', link: LINK2 });
    const e = enviados[0];
    expect(e.subject).toBe('Assine a SolarDoc no Pix automático');
    expect(e.to).toBe('ana@exemplo.com');
    for (const trecho of [
      'Olá,',
      'Mais de 3.600 propostas solares já saíram pela SolarDoc, mais de 700 delas só no último mês.',
      'A proposta sai com a logo e a cor da sua empresa, pronta para mandar no WhatsApp.',
      'Veja o que quem usa conta:',
      'Entre todas que já usei e outras que apenas testei, essa é a que conseguimos gerar propostas mais rapidamente.',
      'Vanderlei, American Energy Solar, Rondonópolis/MT',
      'Aqui, com quatro, cinco cliques eu consigo montar uma proposta.',
      'Alessandro Goulart, Força Solar, Feliz/RS',
      'Tenho me surpreendido positivamente com o nível de detalhes das propostas.',
      'GSI Energia Solar, Unaí/MG',
      'Como funciona o Pix automático:',
      'A SolarDoc custa R$ 67 por mês.',
      'O banco debita sozinho todo mês, e a cobrança sai no nome da AIOROS GROUP, dona da SolarDoc.',
      'Você cancela quando quiser pelo app do banco, sem falar com ninguém.',
    ]) {
      expect(e.html).toContain(trecho);
      expect(e.text).toContain(trecho);
    }
    expect(e.html).toContain('>Assinar no Pix automático</a>');
    expect(e.html).toContain('href="https://solardoc.app/?pagar=pix&amp;utm_source=recuperacao&amp;utm_medium=email&amp;utm_term=conj123"');
    expect(e.text).toContain(LINK2);
    expect(`${e.html}${e.text}`).not.toMatch(/[–—]/);
  });

  it('a citação é uma caixa clara de borda inteira, em itálico, sem barra lateral (nenhum border-left)', async () => {
    enviados.length = 0; erro = null;
    await sendPixAssineEmail({ to: 'ana@exemplo.com', link: LINK2 });
    const html: string = enviados[0].html;
    expect(html).not.toContain('border-left');
    expect(html).toContain('background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px');
    expect(html.match(/font-style:italic/g)).toHaveLength(3);
  });

  it('o Resend recusar joga erro (quem chama solta o claim)', async () => {
    erro = { name: 'validation_error', message: 'x' };
    await expect(sendPixAssineEmail({ to: 'ana@exemplo.com', link: LINK2 })).rejects.toThrow(/Resend error/);
    erro = null;
  });
});

describe('rodapé de saída dos e-mails de venda', () => {
  it('os dois e-mails (1º e dia seguinte) trazem "Não quer mais receber? Responda este e-mail com SAIR." no html e no texto', async () => {
    enviados.length = 0; erro = null;
    await sendPixEsperandoEmail({ to: 'ana@exemplo.com', link: 'https://solardoc.app/?pagar=pix' });
    await sendPixAssineEmail({ to: 'ana@exemplo.com', link: 'https://solardoc.app/?pagar=pix' });
    expect(enviados).toHaveLength(2);
    for (const e of enviados) {
      expect(e.html).toContain('Não quer mais receber? Responda este e-mail com SAIR.');
      expect(e.text).toContain('Não quer mais receber? Responda este e-mail com SAIR.');
      expect(`${e.html}${e.text}`).not.toMatch(/do SolarDoc|pelo SolarDoc/);
    }
  });
});
