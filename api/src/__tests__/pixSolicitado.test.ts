import { describe, it, expect } from 'vitest';
import { acharEmail, bolhasPix, chaveTelefone } from '../services/agents/whatsapp/pixSolicitado';

// ═══════════════════════════════════════════════════════════════════════════
// Pix sob demanda: quem PEDE Pix recebe, e sempre com o mesmo pedido —
// comprovante E e-mail. O e-mail não é burocracia: é a única chave que casa o
// pagamento com a conta quando a pessoa não veio de checkout abandonado. Sem
// ele o cliente paga e fica no limbo esperando alguém liberar na mão.
// ═══════════════════════════════════════════════════════════════════════════

describe('acharEmail', () => {
  it('acha o e-mail no meio da frase', () => {
    expect(acharEmail('opa, meu email é Joao.Silva@Gmail.com valeu')).toBe('joao.silva@gmail.com');
  });

  it('aceita domínio composto', () => {
    expect(acharEmail('contato@solar-energia.com.br')).toBe('contato@solar-energia.com.br');
  });

  // Conservador de propósito: e-mail errado cria conta errada e libera acesso
  // pra quem não pagou.
  it('não inventa e-mail onde não tem', () => {
    expect(acharEmail('paguei o pix agora, arroba joao gmail')).toBeNull();
    expect(acharEmail('')).toBeNull();
    expect(acharEmail('meu @ é joao@')).toBeNull();
  });
});

describe('bolhasPix', () => {
  const bolhas = bolhasPix('00020126BR...', 67);

  it('manda o código, o valor e pede as DUAS coisas', () => {
    expect(bolhas[0]).toBe('00020126BR...');
    const texto = bolhas.join('\n');
    expect(texto).toContain('R$ 67');
    expect(texto).toMatch(/comprovante/i);
    expect(texto).toMatch(/e-?mail/i);
  });

  it('o copia-e-cola vem sozinho na primeira bolha (dá pra copiar sem sujeira)', () => {
    expect(bolhas[0]).not.toMatch(/\s/);
  });
});

describe('chaveTelefone', () => {
  // Sufixo curto (8 dígitos) faria dois clientes dividirem o mesmo registro — e o
  // mês pago por um liberaria o acesso do outro. 11 dígitos = DDD + número.
  it('não colide entre números diferentes que terminam igual', () => {
    expect(chaveTelefone('34991360223')).not.toBe(chaveTelefone('11991360223'));
  });

  it('o mesmo número com e sem DDI vira a mesma chave', () => {
    expect(chaveTelefone('5534991360223')).toBe(chaveTelefone('34991360223'));
    expect(chaveTelefone('+55 (34) 99136-0223')).toBe(chaveTelefone('34991360223'));
  });
});
