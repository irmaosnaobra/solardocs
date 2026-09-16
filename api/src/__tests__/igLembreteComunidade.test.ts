import { describe, it, expect, beforeEach } from 'vitest';

import { lembrete1h } from '../services/instagram/igGate';
import { buildMessage } from '../services/instagram/igClient';

// O segundo destino do lembrete de 1h (15/09/2026).
//
// Fluxo pedido pelo Thiago: quem comenta em post de eletroposto recebe uma DM
// curta com botão pro AGENDAMENTO; uma hora depois, o lembrete leva pra
// COMUNIDADE do WhatsApp. São dois links diferentes em dois toques diferentes,
// e antes disso o lembrete só sabia repetir o link_url da própria automação.

const AUTO = {
  id: 'eletro',
  link_url: 'https://solardoc.app/io/eletroposto?src=ig',
  gate_off: true,
  lembrete_1h_texto: 'Enquanto você decide, entra na comunidade do Eletroposto.\nLá tem vaga nova, retorno real e bastidor de quem já instalou.',
  lembrete_1h_link: 'https://chat.whatsapp.com/EXEMPLO',
  lembrete_1h_botao: 'Entrar na comunidade',
};

beforeEach(() => { delete process.env.IG_LEMBRETE_1H_OFF; delete process.env.IG_GATE_OFF; });

describe('lembrete de 1h com destino próprio', () => {
  it('leva a COMUNIDADE, não o link da automação', () => {
    const l = lembrete1h(AUTO, '123')!;
    expect(l.button).toEqual({ url: AUTO.lembrete_1h_link, title: 'Entrar na comunidade' });
    // O link do agendamento é o do primeiro toque: repeti-lo aqui era o bug.
    expect(l.text).not.toContain('io/eletroposto');
  });

  it('vira card de verdade no Instagram (template generic)', () => {
    const l = lembrete1h(AUTO, '123')!;
    const m = buildMessage({ text: l.text, button: l.button });
    expect(m.attachment.payload.template_type).toBe('generic');
    const el = m.attachment.payload.elements[0];
    expect(el.buttons[0].url).toBe(AUTO.lembrete_1h_link);
    // Rótulo de 20 caracteres é o teto da Meta: 'Entrar na comunidade' bate no
    // limite exato, então não pode sair cortado.
    expect(el.buttons[0].title).toBe('Entrar na comunidade');
  });

  it('sem copy própria não põe botão — o texto padrão fala do link da automação', () => {
    // "conseguiu abrir o link?" + botão pra outro lugar seria contradição.
    const l = lembrete1h({ ...AUTO, lembrete_1h_texto: null }, '123')!;
    expect(l.button).toBeUndefined();
    expect(l.text).toContain('io/eletroposto');
  });

  it('copy longa demais pro card cai no texto com o link embutido', () => {
    const l = lembrete1h({ ...AUTO, lembrete_1h_texto: 'x'.repeat(200) }, '123')!;
    expect(l.button).toBeUndefined();
    expect(l.text).toContain(AUTO.lembrete_1h_link);
  });

  it('link sem rótulo (ou rótulo sem link) não vira botão pela metade', () => {
    expect(lembrete1h({ ...AUTO, lembrete_1h_botao: null }, '123')!.button).toBeUndefined();
    expect(lembrete1h({ ...AUTO, lembrete_1h_link: '   ' }, '123')!.button).toBeUndefined();
  });

  it('o desligamento geral continua valendo', () => {
    process.env.IG_LEMBRETE_1H_OFF = 'true';
    expect(lembrete1h(AUTO, '123')).toBeNull();
    delete process.env.IG_LEMBRETE_1H_OFF;
    expect(lembrete1h({ ...AUTO, lembrete_1h_off: true }, '123')).toBeNull();
  });
});
