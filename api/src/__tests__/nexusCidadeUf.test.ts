import { describe, it, expect } from 'vitest';
import { cidadeUf, separarCidadeUf } from '../services/nexus/repositorio';

// O cadastro do SolarDoc guarda a cidade com a UF junto; o parceiro nasce com cidade e uf separados.
describe('separarCidadeUf', () => {
  it.each([
    ['Uberlândia MG', '', 'Uberlândia', 'MG'],
    ['Goiânia - GO', '', 'Goiânia', 'GO'],
    ['Cuiabá/MT', '', 'Cuiabá', 'MT'],
    ['Brasília, DF', null, 'Brasília', 'DF'],
    ['Palmas', '', 'Palmas', null],
    ['São Paulo SP', 'SP', 'São Paulo', 'SP'],
  ])('%s com uf %s', (entrada, uf, cidade, esperadaUf) => {
    expect(separarCidadeUf(entrada, uf)).toEqual({ cidade, uf: esperadaUf });
  });

  it('sem diferenciar maiúscula, hífen sem espaço e uf já separado', () => {
    expect(separarCidadeUf('Cidade-mg', undefined)).toEqual({ cidade: 'Cidade', uf: 'MG' });
    expect(separarCidadeUf('Uberlândia', 'mg')).toEqual({ cidade: 'Uberlândia', uf: 'MG' });
  });

  it('não mexe quando a sigla é de outro estado ou não é UF', () => {
    expect(separarCidadeUf('Uberlândia MG', 'SP')).toEqual({ cidade: 'Uberlândia MG', uf: 'SP' });
    expect(separarCidadeUf('Pará de Minas', '')).toEqual({ cidade: 'Pará de Minas', uf: null });
    expect(separarCidadeUf('Santa Rita do Sapucaí', '')).toEqual({ cidade: 'Santa Rita do Sapucaí', uf: null });
    expect(separarCidadeUf('', '')).toEqual({ cidade: null, uf: null });
  });
});

describe('cidadeUf (texto de aviso, e-mail e resumo)', () => {
  it('junta sem repetir a sigla', () => {
    expect(cidadeUf('Uberlândia MG', 'MG')).toBe('Uberlândia/MG');
    expect(cidadeUf('Goiânia - GO', '')).toBe('Goiânia/GO');
    expect(cidadeUf('Palmas', 'TO')).toBe('Palmas/TO');
    expect(cidadeUf('Palmas', null)).toBe('Palmas');
    expect(cidadeUf('', 'sp')).toBe('SP');
    expect(cidadeUf('Uberlândia MG', 'SP')).toBe('Uberlândia MG/SP');
    expect(cidadeUf(null, undefined)).toBe('');
  });
});
