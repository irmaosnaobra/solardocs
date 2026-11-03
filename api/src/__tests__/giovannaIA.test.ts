import { describe, it, expect } from 'vitest';
import { FRASE_IA_GIOVANNA, semNegarIA } from '../services/agents/whatsapp/giovannaIA';

// A Giovanna nunca nega ser IA (regra do dono de 20/10, trava mecânica de 03/11/2026). A função é pura: aqui só se prova o que ela troca
// e o que deixa em paz. O gancho no envio e na sessão gravada é provado em giovannaAgenteLaco.test.ts.

describe('semNegarIA: troca a negação pela frase certa', () => {
  it('"não sou robô" (com e sem acento) e as variações de IA, bot e inteligência artificial', () => {
    for (const txt of [
      'Não sou robô, sou a Giovanna.', 'nao sou robo, tô aqui pra te ajudar', 'Não sou uma IA, pode ficar tranquilo.',
      'não sou um bot', 'Não sou uma inteligência artificial, tá?', 'NÃO SOU ROBÔ!',
    ]) {
      expect(semNegarIA(txt), txt).toBe(FRASE_IA_GIOVANNA);
    }
  });

  it('"sou humana", "sou uma pessoa de verdade", "sou gente"', () => {
    for (const txt of ['Sou humana, sim.', 'Sou uma pessoa de verdade!', 'sou um humano', 'Sou gente de verdade']) {
      expect(semNegarIA(txt), txt).toBe(FRASE_IA_GIOVANNA);
    }
  });

  it('só a primeira vira a frase; as outras saem, e a frase não se repete', () => {
    const r = semNegarIA('Não sou robô. Sou uma pessoa de verdade. Posso te ajudar com a proposta?');
    expect(r.match(/Sou a IA do SolarDoc, sim\./g)).toHaveLength(1);
    expect(r).toContain('Posso te ajudar com a proposta?');
    expect(r).not.toMatch(/pessoa|robô/i);
  });

  it('só troca a frase da negação: o resto da resposta fica', () => {
    const r = semNegarIA('Claro! Não sou robô. Você já cadastrou o CNPJ?');
    expect(r).toBe(`Claro! ${FRASE_IA_GIOVANNA} Você já cadastrou o CNPJ?`);
  });
});

describe('semNegarIA: texto comum fica como veio', () => {
  it('não mexe no que não nega nem afirma ser gente', () => {
    for (const txt of [
      'Oi, Ana! Sou a Giovanna, do SolarDoc. Como posso ajudar?',
      'Sou a IA do SolarDoc, sim.',
      'Pode subir a logo em Empresa. A pessoalidade do contrato vem da razão social.',
      'Seu plano é de R$ 67 por mês. Posso mandar o link?',
      'Isso não é robótica, é cadastro: abra Empresa.',
    ]) {
      expect(semNegarIA(txt), txt).toBe(txt);
    }
  });

  it('vazio e espaços voltam como vieram', () => {
    expect(semNegarIA('')).toBe('');
    expect(semNegarIA('   ')).toBe('   ');
  });

  it('o separador de bolhas (||) não é engolido pela troca', () => {
    expect(semNegarIA('Não sou robô.||Quer ver a proposta?')).toBe(`${FRASE_IA_GIOVANNA}||Quer ver a proposta?`);
  });
});
