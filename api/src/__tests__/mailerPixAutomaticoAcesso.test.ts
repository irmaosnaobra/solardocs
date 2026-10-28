import { describe, it, expect, vi } from 'vitest';

// E-mail do acesso criado pelo webhook do Pix Automático: é o ÚNICO canal do link de definir senha.

const enviados: any[] = [];
vi.mock('resend', () => ({
  Resend: class { emails = { send: async (o: any) => { enviados.push(o); return { error: null }; } }; },
}));

import { sendPixAutomaticoAcessoEmail, textoPixAutomaticoAcesso } from '../utils/mailer';

const LINK = 'https://solardoc.app/auth?mode=redefinir&token=abc123';

describe('e-mail de acesso do Pix Automático', () => {
  it('texto exato, com o primeiro nome', () => {
    expect(textoPixAutomaticoAcesso('Maria da Silva', LINK)).toBe(
      `Oi, Maria. Sua assinatura do SolarDoc no Pix automático está ativa. Para entrar, crie sua senha neste link: ${LINK}. O link vale por 30 dias.`,
    );
  });

  it('sem nome: abre com "Oi."', () => {
    expect(textoPixAutomaticoAcesso(null, LINK)).toMatch(/^Oi\. Sua assinatura/);
  });

  it('assunto combinado, destinatário certo e o link no corpo (html e texto)', async () => {
    enviados.length = 0;
    await sendPixAutomaticoAcessoEmail({ to: 'cliente@teste.com', nome: 'Maria da Silva', acessoUrl: LINK });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].subject).toBe('Seu acesso ao SolarDoc está pronto');
    expect(enviados[0].to).toBe('cliente@teste.com');
    expect(enviados[0].text).toContain(LINK);
    expect(enviados[0].html).toContain('href="https://solardoc.app/auth?mode=redefinir&amp;token=abc123"');
  });
});
