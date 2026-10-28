import { describe, it, expect } from 'vitest';
import regiao from '../data/cidadesRegiaoSolar.json';
import { cidadeNaRegiaoSolar, motivoDescarteSolar, cidadeUfDoDescarte, NOTA_MINIMA_SOLAR, TOTAL_CIDADES_REGIAO } from '../services/io/solarDescarte';

// DESCARTE DO QUIZ SOLAR (27/10/2026): nota abaixo de 70 ou cidade fora das 114 da região de 200 km de Uberlândia.
// A regra que manda: na dúvida (cidade que não resolveu, ou resolvida só pelo DDD), MANTÉM.

describe('a lista da região', () => {
  it('tem 114 cidades', () => {
    expect(regiao).toHaveLength(114);
    expect(TOTAL_CIDADES_REGIAO).toBe(114);
  });
  it('cada uma das 114, escrita como "Nome-UF", é reconhecida (trava a grafia contra a tabela do IBGE)', () => {
    const fora = (regiao as Array<{ nome: string; uf: string }>)
      .filter(c => cidadeNaRegiaoSolar(`${c.nome}-${c.uf}`) !== true).map(c => `${c.nome}-${c.uf}`);
    expect(fora).toEqual([]);
  });
});

describe('cidadeNaRegiaoSolar', () => {
  it.each(['Goiatuba Goiás', 'Goiatuba-GO', 'Cristais Paulista-SP', 'Uberlândia-MG', 'uberlandia mg', 'Uberlândia'])(
    'mantém %s (está na região)', (txt) => { expect(cidadeNaRegiaoSolar(txt)).toBe(true); });

  it.each(['Jaboticatubas-MG', 'Cristais-MG', 'Belo Horizonte-MG', 'São Paulo-SP'])(
    'descarta %s (município do IBGE fora da região)', (txt) => { expect(cidadeNaRegiaoSolar(txt)).toBe(false); });

  it.each(['xyz abc', '', 'Bom Jesus', 'Jaboticatubas'])('texto que não resolveu (%s) devolve null e nunca descarta', (txt) => {
    expect(cidadeNaRegiaoSolar(txt)).toBeNull();
  });

  it('resolvida só pelo DDD: dentro da lista mantém (true), fora dela devolve null e NÃO descarta', () => {
    expect(cidadeNaRegiaoSolar('Goiatuba', '5564991112222')).toBe(true);
    // "Jaboticatubas" é nome único e MG: com DDD 31 o DDD aponta para MG, e isso só serve para manter.
    expect(cidadeNaRegiaoSolar('Jaboticatubas', '5531991112222')).toBeNull();
  });
});

describe('cidadeUfDoDescarte', () => {
  it('devolve o "Município-UF" canônico, ou null quando a cidade não resolveu', () => {
    expect(cidadeUfDoDescarte('jaboticatubas mg')).toBe('Jaboticatubas-MG');
    expect(cidadeUfDoDescarte('xyz abc')).toBeNull();
  });
});

describe('motivoDescarteSolar', () => {
  it('nota 69 descarta e 70 mantém (cidade dentro)', () => {
    expect(NOTA_MINIMA_SOLAR).toBe(70);
    expect(motivoDescarteSolar({ pontos: 69, cidade: 'Uberlândia-MG' })).toBe('nota');
    expect(motivoDescarteSolar({ pontos: 70, cidade: 'Uberlândia-MG' })).toBeNull();
  });
  it('cidade fora da região descarta mesmo com nota 100', () => {
    expect(motivoDescarteSolar({ pontos: 100, cidade: 'Jaboticatubas-MG' })).toBe('regiao');
  });
  it('a região vence a nota', () => {
    expect(motivoDescarteSolar({ pontos: 10, cidade: 'Belo Horizonte-MG' })).toBe('regiao');
  });
  it('cidade que não resolveu não descarta por região (só a nota decide)', () => {
    expect(motivoDescarteSolar({ pontos: 90, cidade: 'xyz abc' })).toBeNull();
    expect(motivoDescarteSolar({ pontos: 30, cidade: 'xyz abc' })).toBe('nota');
  });
});
