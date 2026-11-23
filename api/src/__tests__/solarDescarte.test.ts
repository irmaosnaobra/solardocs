import { describe, it, expect } from 'vitest';
import regiao from '../data/cidadesRegiaoSolar.json';
import {
  cidadeNaRegiaoSolar, motivoDescarteSolar, cidadeUfDoDescarte, NOTA_MINIMA_SOLAR, TOTAL_CIDADES_REGIAO,
  chaveDescartadoSolar, marcaDescartaRascunho,
} from '../services/io/solarDescarte';

// DESCARTE DO QUIZ SOLAR (27/10/2026): nota abaixo de 70 ou cidade fora das 114 da região de 200 km de Uberlândia.
// Desde 23/11/2026 também conta abaixo de R$ 400 de quem não vai aumentar o consumo.
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

describe('motivoDescarteSolar: conta baixa sem aumento (23/11/2026)', () => {
  const base = { pontos: 100, cidade: 'Uberlândia-MG' };
  it('ate400 com aumento "nao" descarta por conta, mesmo com nota 100', () => {
    expect(motivoDescarteSolar({ ...base, conta: 'ate400', aumento: 'nao' })).toBe('conta');
  });
  it.each(['clima', 'carro', 'maquinas'])('ate400 com aumento "%s" segue', (aumento) => {
    expect(motivoDescarteSolar({ ...base, conta: 'ate400', aumento })).toBeNull();
  });
  it.each([undefined, null, '', 'xyz'])('ate400 com aumento vazio ou desconhecido (%s) NÃO descarta por conta', (aumento) => {
    expect(motivoDescarteSolar({ ...base, conta: 'ate400', aumento })).toBeNull();
  });
  it('ate400 sem o campo aumento segue', () => {
    expect(motivoDescarteSolar({ ...base, conta: 'ate400' })).toBeNull();
  });
  it('ate300 (a faixa legada, também abaixo de R$ 400) com "nao" descarta', () => {
    expect(motivoDescarteSolar({ ...base, conta: 'ate300', aumento: 'nao' })).toBe('conta');
  });
  it.each(['400_800', '800_1200', '1200_mais', '300_600', '600_1050'])('%s com "nao" segue', (conta) => {
    expect(motivoDescarteSolar({ ...base, conta, aumento: 'nao' })).toBeNull();
  });
  it('a região tem prioridade sobre a conta', () => {
    expect(motivoDescarteSolar({ pontos: 100, cidade: 'Belo Horizonte-MG', conta: 'ate400', aumento: 'nao' })).toBe('regiao');
  });
  it('a conta tem prioridade sobre a nota', () => {
    expect(motivoDescarteSolar({ pontos: 30, cidade: 'Uberlândia-MG', conta: 'ate400', aumento: 'nao' })).toBe('conta');
  });
  it('conta que segue ainda cai na nota abaixo de 70', () => {
    expect(motivoDescarteSolar({ pontos: 65, cidade: 'Uberlândia-MG', conta: 'ate400', aumento: 'clima' })).toBe('nota');
  });
});

describe('a marca de descarte contra o rascunho (vale a tentativa mais recente)', () => {
  const T = Date.parse('2026-11-23T12:00:00Z');
  it('a chave tem o prefixo, o "teste_" da sonda e o telefone', () => {
    expect(chaveDescartadoSolar('3491112222', false)).toBe('solar_quiz_descartado:3491112222');
    expect(chaveDescartadoSolar('3491112222', true)).toBe('solar_quiz_descartado:teste_3491112222');
  });
  it('sem marca, o rascunho vale', () => {
    expect(marcaDescartaRascunho(false, undefined, T)).toBe(false);
  });
  it('marca mais nova que o rascunho descarta', () => {
    expect(marcaDescartaRascunho(true, new Date(T + 60_000).toISOString(), T)).toBe(true);
  });
  it('marca mais velha que o rascunho (o lead passou depois) não descarta', () => {
    expect(marcaDescartaRascunho(true, new Date(T - 60_000).toISOString(), T)).toBe(false);
  });
  it('sem como comparar o tempo, a marca vale sempre', () => {
    expect(marcaDescartaRascunho(true, undefined, T)).toBe(true);
    expect(marcaDescartaRascunho(true, 'lixo', T)).toBe(true);
    expect(marcaDescartaRascunho(true, new Date(T - 60_000).toISOString(), NaN)).toBe(true);
  });
});
