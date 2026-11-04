import { describe, it, expect } from 'vitest';
import { montarEndereco, temParteDeEndereco } from '../services/enderecoCliente';

describe('montarEndereco', () => {
  it('junta as partes na ordem rua, número, complemento, bairro', () => {
    expect(montarEndereco({ logradouro: 'Rua das Flores', numero: '123', complemento: 'Apto 4', bairro: 'Centro' }))
      .toBe('Rua das Flores, 123, Apto 4, Centro');
  });
  it('pula vazios, espaços e o que não é texto', () => {
    expect(montarEndereco({ logradouro: ' Rua A ', numero: '', complemento: undefined, bairro: 'Centro' })).toBe('Rua A, Centro');
    expect(montarEndereco({ logradouro: 'Rua A', numero: 7 as unknown, bairro: null })).toBe('Rua A');
    expect(montarEndereco({})).toBe('');
  });
});

describe('temParteDeEndereco', () => {
  it('detecta qualquer parte presente, mesmo vazia (limpar também é mexer)', () => {
    expect(temParteDeEndereco({ nome: 'X' })).toBe(false);
    expect(temParteDeEndereco({ endereco: 'Rua A' })).toBe(false);
    expect(temParteDeEndereco({ bairro: '' })).toBe(true);
    expect(temParteDeEndereco({ logradouro: 'Rua A' })).toBe(true);
  });
});

import { enderecoCompleto } from '../services/enderecoCliente';

describe('enderecoCompleto', () => {
  it('bairro vazio ou ausente: saída igual à de antes', () => {
    expect(enderecoCompleto('Rua A, 10', undefined, 'Uberlândia', 'MG')).toBe('Rua A, 10, Uberlândia/MG');
    expect(enderecoCompleto('Rua A, 10', '', 'Uberlândia', 'MG')).toBe('Rua A, 10, Uberlândia/MG');
    expect(enderecoCompleto('Rua A, 10', '  ', undefined, undefined)).toBe('Rua A, 10');
    expect(enderecoCompleto(undefined, undefined, undefined, undefined)).toBe('___');
  });
  it('bairro diferente da linha: acrescenta', () => {
    expect(enderecoCompleto('Rua A, 10', 'Centro', 'Uberlândia', 'MG')).toBe('Rua A, 10, Centro, Uberlândia/MG');
  });
  it('bairro já na linha como segmento: não repete (sem diferenciar caixa e acento)', () => {
    expect(enderecoCompleto('Rua A, 10, Centro', 'Centro', 'Uberlândia', 'MG')).toBe('Rua A, 10, Centro, Uberlândia/MG');
    expect(enderecoCompleto('Rua A, 10, Jardim São Paulo', 'JARDIM SAO PAULO', 'Uberlândia', 'MG')).toBe('Rua A, 10, Jardim São Paulo, Uberlândia/MG');
  });
  it('só segmento inteiro conta, não pedaço de texto', () => {
    expect(enderecoCompleto('Rua do Centro Velho, 10', 'Centro', 'Uberlândia', 'MG')).toBe('Rua do Centro Velho, 10, Centro, Uberlândia/MG');
  });
});
