import { describe, it, expect, vi } from 'vitest';

// O módulo das boas-vindas importa os clientes do banco e do WhatsApp; aqui só a
// função de texto interessa.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendHuman: vi.fn() }));

import { bolhasConfirmacaoQuiz, bolhasBoasVindas } from '../services/io/solarBoasVindas';

const Q = '2026-10-13T09:00:00-03:00';   // terça 13/10, 09:00

describe('confirmação do quiz solar', () => {
  it('visita: dia, hora, quem vai, pede SIM e a foto do padrão', () => {
    const b = bolhasConfirmacaoQuiz('Roberto Lima', 'Thiago', Q, 'vistoria', '5534991360223');
    const txt = b.join('\n');
    expect(b[0]).toBe('☀️ Está marcado, Roberto!');
    expect(txt).toContain('*Thiago* vai até você');
    expect(txt).toMatch(/13\/10 às 09h00/);
    expect(txt).toContain('Responda *SIM*');
    expect(txt).toContain('padrão de entrada');
    expect(txt).toContain('(34) 99136-0223');
  });
  it('ligação não pede SIM; videochamada pede', () => {
    expect(bolhasConfirmacaoQuiz('Ana', 'Nilce', Q, 'ligacao').join('\n')).not.toContain('SIM');
    expect(bolhasConfirmacaoQuiz('Ana', 'Diego', Q, 'video').join('\n')).toContain('SIM');
  });
  it('sem artigo antes do nome, emoji só na primeira linha e nada de travessão', () => {
    for (const c of ['vistoria', 'video', 'ligacao'] as const) {
      const b = bolhasConfirmacaoQuiz('Ana', 'Nilce', Q, c, '5534991516846');
      expect(b.join('\n')).not.toMatch(/\b(o|a) \*Nilce\*/);
      expect(b.join('\n')).not.toMatch(/[—–]/);
      for (const linha of b.slice(1)) expect(linha).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('as boas-vindas de quem não veio do quiz continuam sem horário', () => {
    expect(bolhasBoasVindas('Ana', 'Nilce').join('\n')).not.toMatch(/\d{2}h\d{2}/);
  });
});
