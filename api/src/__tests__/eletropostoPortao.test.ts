import { describe, it, expect } from 'vitest';
import { avaliarPortao } from '../services/io/eletropostoPortao';

describe('avaliarPortao (só leitura, a LP não corta)', () => {
  it('Investidor sem forma de pagamento cairia na regra', () => {
    expect(avaliarPortao({ perfil: 'investidor', invest: 'naosei' })).toEqual({ cortaria: true, regra: 'investidor_sem_capital' });
  });

  it('outros perfis com naosei não cairiam', () => {
    for (const perfil of ['outro', 'posto', 'mercado'] as const) {
      expect(avaliarPortao({ perfil, invest: 'naosei' }).cortaria).toBe(false);
    }
  });

  it('Investidor com recurso próprio ou modelo 01 (sem resposta) não cairia', () => {
    expect(avaliarPortao({ perfil: 'investidor', invest: 'proprio' }).cortaria).toBe(false);
    expect(avaliarPortao({ perfil: 'investidor', invest: null }).cortaria).toBe(false);
  });
});
