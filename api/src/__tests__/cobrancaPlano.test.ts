import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A TELA É CONVENIÊNCIA, NÃO AUTORIDADE.
//
// `sanearPlano` é o que separa "o que o navegador mandou" de "o que vira
// cobrança no Asaas". Todo campo que chega do front passa por aqui antes de
// custar dinheiro — e é aqui que um valor absurdo, um CPF que não é CPF ou um
// parcelamento em 90x morrem.
//
// O caso que mais importa: sem CPF válido não existe cliente no Asaas, e sem
// cliente não existe cobrança avulsa. Deixar `meio: 'boleto'` passar sem
// documento faria a criação estourar na cara do Thiago no meio de uma conversa
// com o cliente. O saneamento devolve 'link', que é o caminho que funciona.
// ─────────────────────────────────────────────────────────────────────────────

import { sanearPlano } from '../services/asaas/cobrancaBrief';

const base = {
  cliente: { nome: 'Bruno Henrique', cpfCnpj: '249.715.637-92' },
  descricao: 'Entrada do eletroposto',
  meio: 'cartao', parcelas: 18, valorModo: 'liquido', valor: 7700,
  vencimentoDias: 3, antecipar: true,
};

describe('sem CPF válido, o meio vira link', () => {
  it('boleto sem documento não pode virar cobrança avulsa', () => {
    const p = sanearPlano({ ...base, meio: 'boleto', cliente: { nome: 'X' } });
    expect(p.meio).toBe('link');
  });

  it('CPF pela metade também não vale', () => {
    const p = sanearPlano({ ...base, cliente: { nome: 'X', cpfCnpj: '2497156' } });
    expect(p.meio).toBe('link');
    expect(p.cliente.cpfCnpj).toBeNull();
  });

  it('CPF e CNPJ completos passam, sem pontuação', () => {
    expect(sanearPlano(base).cliente.cpfCnpj).toBe('24971563792');
    const pj = sanearPlano({ ...base, cliente: { nome: 'X', cpfCnpj: '12.345.678/0001-95' } });
    expect(pj.cliente.cpfCnpj).toBe('12345678000195');
    expect(pj.meio).toBe('cartao');
  });
});

describe('limites que não dependem da tela', () => {
  it('parcelas param em 21 e nunca ficam abaixo de 1', () => {
    expect(sanearPlano({ ...base, parcelas: 90 }).parcelas).toBe(21);
    expect(sanearPlano({ ...base, parcelas: 0 }).parcelas).toBe(1);
    expect(sanearPlano({ ...base, parcelas: -5 }).parcelas).toBe(1);
  });

  it('vencimento fica entre 1 e 30 dias', () => {
    expect(sanearPlano({ ...base, vencimentoDias: 999 }).vencimentoDias).toBe(30);
    expect(sanearPlano({ ...base, vencimentoDias: 0 }).vencimentoDias).toBe(3);
  });

  it('valor zerado, negativo ou absurdo é recusado', () => {
    expect(() => sanearPlano({ ...base, valor: 0 })).toThrow();
    expect(() => sanearPlano({ ...base, valor: -100 })).toThrow();
    expect(() => sanearPlano({ ...base, valor: 900000 })).toThrow(/teto/i);
    expect(() => sanearPlano({ ...base, valor: 'muito' })).toThrow();
  });

  it('meio desconhecido cai no link, não estoura', () => {
    expect(sanearPlano({ ...base, meio: 'bitcoin' }).meio).toBe('link');
  });
});

describe('o modo do valor decide quem paga a taxa', () => {
  it('só "cheio" desliga o alvo de líquido — qualquer outra coisa é líquido', () => {
    expect(sanearPlano({ ...base, valorModo: 'cheio' }).valorModo).toBe('cheio');
    expect(sanearPlano({ ...base, valorModo: 'liquido' }).valorModo).toBe('liquido');
    expect(sanearPlano({ ...base, valorModo: undefined }).valorModo).toBe('liquido');
  });

  it('Pix e boleto não antecipam, mesmo se a tela pedir', () => {
    const p = sanearPlano({ ...base, meio: 'pix', antecipar: true });
    expect(p.antecipar).toBe(false);
  });
});
