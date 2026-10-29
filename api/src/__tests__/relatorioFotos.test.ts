import { describe, it, expect } from 'vitest';
import { dividirJunto, numerarGrupos, refFotos } from '../services/relatorio/fotos';

// Numeração e referência das fotos dos relatórios. Tudo função pura, sem banco.

const pares = (m: Map<string, number[]>) => [...m.entries()];

describe('numerarGrupos', () => {
  it('numera de forma global e contínua, na ordem dada', () => {
    const m = numerarGrupos(['antes', 'depois', 'modulos'], { antes: 3, depois: 2, modulos: 1 });
    expect(pares(m)).toEqual([['antes', [1, 2, 3]], ['depois', [4, 5]], ['modulos', [6]]]);
  });
  it('grupo sem foto não aparece no mapa e não gasta número', () => {
    const m = numerarGrupos(['antes', 'depois', 'modulos'], { antes: 0, depois: 2 });
    expect(m.has('antes')).toBe(false);
    expect(m.has('modulos')).toBe(false);
    expect(pares(m)).toEqual([['depois', [1, 2]]]);
  });
  it('a ordem dada decide a numeração, não a ordem das chaves da contagem', () => {
    const m = numerarGrupos(['b', 'a'], { a: 1, b: 1 });
    expect(pares(m)).toEqual([['b', [1]], ['a', [2]]]);
  });
  it('começa em `inicio`', () => {
    expect(pares(numerarGrupos(['a', 'b'], { a: 2, b: 1 }, 10))).toEqual([['a', [10, 11]], ['b', [12]]]);
  });
  it('`inicio` inválido volta a 1', () => {
    expect(pares(numerarGrupos(['a'], { a: 2 }, NaN))).toEqual([['a', [1, 2]]]);
  });
  it('grupo fora da ordem é ignorado e grupo repetido na ordem conta uma vez', () => {
    const m = numerarGrupos(['a', 'a', 'b'], { a: 2, b: 1, fora: 5 });
    expect(pares(m)).toEqual([['a', [1, 2]], ['b', [3]]]);
  });
  it('contagem estranha vira zero ou arredonda para baixo', () => {
    const m = numerarGrupos(['neg', 'nan', 'frac', 'texto'], { neg: -2, nan: NaN, frac: 2.9, texto: 'x' as unknown as number });
    expect(pares(m)).toEqual([['frac', [1, 2]]]);
  });
  it('ordem vazia devolve mapa vazio', () => {
    expect(numerarGrupos([], { a: 3 }).size).toBe(0);
  });
});

describe('refFotos', () => {
  it('lista vazia devolve vazio', () => {
    expect(refFotos([])).toBe('');
    expect(refFotos([], 'Documento')).toBe('');
  });
  it('uma foto fica no singular', () => {
    expect(refFotos([3])).toBe('Foto 3');
  });
  it('duas seguidas ficam escritas uma a uma', () => {
    expect(refFotos([3, 4])).toBe('Fotos 3 e 4');
  });
  it('separa com vírgula e põe "e" antes do último', () => {
    expect(refFotos([1, 2, 5])).toBe('Fotos 1, 2 e 5');
    expect(refFotos([1, 3, 5, 8])).toBe('Fotos 1, 3, 5 e 8');
  });
  it('três seguidas ou mais viram "x a y"', () => {
    expect(refFotos([1, 2, 3])).toBe('Fotos 1 a 3');
    expect(refFotos([1, 2, 3, 4, 5, 6])).toBe('Fotos 1 a 6');
    expect(refFotos([1, 2, 3, 5])).toBe('Fotos 1 a 3 e 5');
    expect(refFotos([1, 2, 4, 5, 6, 9])).toBe('Fotos 1, 2, 4 a 6 e 9');
    expect(refFotos([1, 2, 3, 5, 6, 7])).toBe('Fotos 1 a 3 e 5 a 7');
  });
  it('põe em ordem e tira repetido antes de montar o texto', () => {
    expect(refFotos([5, 1, 3, 2, 3, 1])).toBe('Fotos 1 a 3 e 5');
  });
  it('o plural segue a quantidade de números, não a de trechos', () => {
    expect(refFotos([4, 4])).toBe('Foto 4');
    expect(refFotos([1, 2, 3])).toMatch(/^Fotos /);
  });
  it('ignora o que não é número inteiro', () => {
    expect(refFotos([1, NaN, 2.5, 2, Infinity])).toBe('Fotos 1 e 2');
  });
  it('rótulo Documento', () => {
    expect(refFotos([1], 'Documento')).toBe('Documento 1');
    expect(refFotos([1, 2], 'Documento')).toBe('Documentos 1 e 2');
    expect(refFotos([1, 2, 3], 'Documento')).toBe('Documentos 1 a 3');
  });
  it('não altera a lista de entrada', () => {
    const entrada = [5, 1, 3, 2, 3, 1];
    refFotos(entrada);
    expect(entrada).toEqual([5, 1, 3, 2, 3, 1]);
  });
  it('combina com numerarGrupos: a legenda e a referência concordam', () => {
    const m = numerarGrupos(['antes', 'depois'], { antes: 3, depois: 2 });
    expect(refFotos(m.get('antes')!)).toBe('Fotos 1 a 3');
    expect(refFotos(m.get('depois')!)).toBe('Fotos 4 e 5');
  });
});

describe('dividirJunto', () => {
  it('lista vazia', () => {
    expect(dividirJunto([], 3)).toEqual({ junto: [], resto: [] });
  });
  it('uma foto cabe inteira junto do título', () => {
    expect(dividirJunto(['a'], 3)).toEqual({ junto: ['a'], resto: [] });
  });
  it('n maior que a lista deixa tudo em junto', () => {
    expect(dividirJunto([1, 2], 10)).toEqual({ junto: [1, 2], resto: [] });
    expect(dividirJunto([1, 2], Infinity)).toEqual({ junto: [1, 2], resto: [] });
  });
  it('n igual ao tamanho da lista', () => {
    expect(dividirJunto([1, 2, 3], 3)).toEqual({ junto: [1, 2, 3], resto: [] });
  });
  it('lista maior que n manda o resto para depois', () => {
    expect(dividirJunto([1, 2, 3, 4, 5], 3)).toEqual({ junto: [1, 2, 3], resto: [4, 5] });
  });
  it('n zero, negativo ou inválido deixa tudo no resto', () => {
    expect(dividirJunto([1, 2], 0)).toEqual({ junto: [], resto: [1, 2] });
    expect(dividirJunto([1, 2], -4)).toEqual({ junto: [], resto: [1, 2] });
    expect(dividirJunto([1, 2], NaN)).toEqual({ junto: [], resto: [1, 2] });
  });
  it('n com fração arredonda para baixo', () => {
    expect(dividirJunto([1, 2, 3], 2.9)).toEqual({ junto: [1, 2], resto: [3] });
  });
  it('não altera a lista de entrada e devolve cópias', () => {
    const entrada = [1, 2, 3, 4];
    const r = dividirJunto(entrada, 2);
    expect(entrada).toEqual([1, 2, 3, 4]);
    expect(r.junto).not.toBe(entrada);
    expect(r.resto).not.toBe(entrada);
  });
});
