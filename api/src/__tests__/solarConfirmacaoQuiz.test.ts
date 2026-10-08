import { describe, it, expect, vi } from 'vitest';

// O módulo das boas-vindas importa os clientes do banco e do WhatsApp; aqui só a
// função de texto interessa.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendHuman: vi.fn() }));

import {
  bolhasConfirmacaoQuiz, bolhasBoasVindas, bolhasCuriosoQuiz, bolhasNaoMarcouQuiz, resumoDaFicha, resumoDoLead,
} from '../services/io/solarBoasVindas';
import { limparRespostas, montarObservacao, camposDoLead } from '../services/io/solarQuiz';
import { decidirCaminho } from '../services/agenda/solarRota';

const Q = '2026-10-13T09:00:00-03:00';   // terça 13/10, 09:00

// A ficha de verdade, do mesmo jeito que o quiz grava.
const R = limparRespostas({ conta: '2000_5000', cidade: 'Catalão-GO', urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', concorrente: 'sim', tipo: 'empresa' });
const OBS = montarObservacao(R, decidirCaminho(R), null);

describe('confirmação do quiz solar: a Duda abre a conversa', () => {
  it('visita: diz quem é, quem vai, quando, devolve as respostas, pede SIM e a foto do padrão', () => {
    const b = bolhasConfirmacaoQuiz('Roberto Lima', 'Diego', Q, 'vistoria', '5534991360223', OBS);
    const txt = b.join('\n');
    expect(b[0]).toBe('☀️ Oi, Roberto! Aqui é a Duda, da Irmãos na Obra.');
    expect(txt).toContain('*Diego* vai até você');
    expect(txt).toMatch(/13\/10 às 09h00/);
    expect(txt).toContain('Anotei aqui: conta de');
    expect(txt).toContain('em Catalão');
    expect(txt).toContain('Responda *SIM*');
    expect(txt).toContain('padrão de entrada');
    expect(txt).toContain('(34) 99136-0223');
  });
  it('ligação não pede SIM; o atendimento online do Thiago pede', () => {
    expect(bolhasConfirmacaoQuiz('Ana', 'Nilce', Q, 'ligacao').join('\n')).not.toContain('SIM');
    const v = bolhasConfirmacaoQuiz('Ana', 'Thiago', Q, 'video').join('\n');
    expect(v).toContain('SIM');
    expect(v).toContain('*Thiago* te chama por vídeo');
  });
  it('sem ficha, a frase do resumo some (nada de "Anotei aqui: .")', () => {
    expect(bolhasConfirmacaoQuiz('Ana', 'Giovanna', Q, 'ligacao').join('\n')).not.toContain('Anotei');
  });
  it('sem artigo antes do nome, emoji só na primeira linha e nada de travessão', () => {
    const todas = [
      ...(['vistoria', 'video', 'ligacao'] as const).map(c => bolhasConfirmacaoQuiz('Ana', 'Nilce', Q, c, '5534991516846', OBS)),
      bolhasCuriosoQuiz('Ana', resumoDaFicha(OBS)),
      bolhasNaoMarcouQuiz('Ana', 'Nilce', resumoDaFicha(OBS)),
    ];
    for (const b of todas) {
      expect(b.join('\n')).not.toMatch(/\b(o|a) \*Nilce\*/);
      expect(b.join('\n')).not.toMatch(/[—–]/);
      for (const linha of b.slice(1)) expect(linha).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const linha of b) expect(linha.charAt(linha.search(/\p{L}/u))).toMatch(/\p{Lu}/u);
    }
  });
  it('as boas-vindas de quem não veio do quiz continuam sem horário', () => {
    expect(bolhasBoasVindas('Ana', 'Nilce').join('\n')).not.toMatch(/\d{2}h\d{2}/);
  });
});

describe('o resumo das respostas', () => {
  it('sai da ficha e do lead com o mesmo texto', () => {
    const daFicha = resumoDaFicha(OBS);
    expect(daFicha).toMatch(/^conta de .+, imóvel .+ em Catalão, quer .+ e pagamento .+$/);
    const doLead = resumoDoLead(camposDoLead(R, decidirCaminho(R)), 'Catalão');
    expect(doLead).toBe(daFicha);
  });
  it('vazio não quebra', () => {
    expect(resumoDaFicha(null)).toBe('');
    expect(resumoDoLead([], null)).toBe('');
  });
});

describe('curioso e quem não marcou', () => {
  it('curioso não ganha promessa de horário', () => {
    const t = bolhasCuriosoQuiz('Ana', '').join('\n');
    expect(t).not.toMatch(/\d{2}h\d{2}|amanhã|te liga/);
    expect(t).not.toContain('Anotei aqui: .');
  });
  it('quem não marcou recebe o caminho de volta para a página', () => {
    expect(bolhasNaoMarcouQuiz('Ana', 'Giovanna', '').join('\n')).toContain('*Giovanna*');
    expect(bolhasNaoMarcouQuiz('Ana', null, '').join('\n')).toContain('solardoc.app/io/solar');
  });
});
