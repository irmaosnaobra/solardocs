import { describe, it, expect } from 'vitest';
import { aplicarCupom, normalizarCodigo, Cupom } from '../services/cuponsService';
import { bolhasOferta } from '../utils/ofertaCupom';

// ═══════════════════════════════════════════════════════════════════════════
// Cupom de primeiro mês. O que este teste protege é a conta do desconto:
// o cupom vira `amount_off` em CENTAVOS na Stripe, e um erro aqui não aparece
// numa tela — aparece na fatura do cliente. Os dois modos de falha caros são
// desconto maior que o preço (fatura R$ 0 = mês grátis) e desconto zero
// (cliente clicou no link do cupom e pagou cheio).
// ═══════════════════════════════════════════════════════════════════════════

function cupom(valor: number): Cupom {
  return {
    codigo: 'ACESSO19', descricao: null, primeiro_mes_valor: valor,
    planos: ['ilimitado'], validade: null, usos_max: null, usos: 0, ativo: true,
  };
}

describe('normalizarCodigo', () => {
  it('sobe pra maiúsculo e tira o que não é código', () => {
    expect(normalizarCodigo(' acesso19 ')).toBe('ACESSO19');
    expect(normalizarCodigo('meu cupom!')).toBe('MEUCUPOM');
    expect(normalizarCodigo(null)).toBe('');
  });
});

describe('aplicarCupom', () => {
  it('R$ 19 num plano de R$ 67 desconta R$ 48 (4800 centavos)', () => {
    const a = aplicarCupom(cupom(19), 67);
    expect(a).not.toBeNull();
    expect(a!.primeiroMes).toBe(19);
    expect(a!.precoCheio).toBe(67);
    expect(a!.descontoCentavos).toBe(4800);
  });

  it('valor quebrado não perde centavo no arredondamento', () => {
    expect(aplicarCupom(cupom(19.9), 67)!.descontoCentavos).toBe(4710);
  });

  // Sem esta guarda, um cupom de R$ 19 num plano de R$ 19 (ou menor) geraria
  // amount_off ≥ total: a Stripe fecha a fatura em R$ 0 e o cliente ganha o mês.
  it('recusa cupom que zeraria ou passaria do preço do plano', () => {
    expect(aplicarCupom(cupom(27), 27)).toBeNull();
    expect(aplicarCupom(cupom(67), 27)).toBeNull();
  });

  it('sem cupom, sem desconto', () => {
    expect(aplicarCupom(null, 67)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// As bolhas que a Giovanna manda. É a mensagem que o cliente lê antes de pagar:
// se o código sair errado, ele digita errado e paga o preço cheio; se o preço
// do mês 2 sumir, ele acha que R$19 é a mensalidade e contesta depois.
// ═══════════════════════════════════════════════════════════════════════════
describe('bolhasOferta', () => {
  const oferta = { codigo: 'ACESSO19', primeiroMes: 19, precoCheio: 67 };

  it('leva link, código e os dois preços', () => {
    const texto = bolhasOferta(oferta).join('\n');
    expect(texto).toContain('solardoc.app');
    expect(texto).toContain('ACESSO19');
    expect(texto).toMatch(/R\$ 19/);
    expect(texto).toMatch(/R\$ 67\/m[êe]s/);
  });

  it('manda DIGITAR o código no checkout (é o caminho novo)', () => {
    expect(bolhasOferta(oferta).join('\n')).toMatch(/digita/i);
  });

  it('bolhas curtas: nenhuma passa de 200 caracteres', () => {
    for (const b of bolhasOferta(oferta)) expect(b.length).toBeLessThanOrEqual(200);
  });

  // Cupom desligado no banco = nenhuma promessa de desconto na mensagem.
  it('sem oferta, convida pro site sem inventar cupom', () => {
    const texto = bolhasOferta(null).join('\n');
    expect(texto).toContain('solardoc.app');
    expect(texto).not.toMatch(/cupom|c[óo]digo promocional|R\$ 19/i);
  });
});
