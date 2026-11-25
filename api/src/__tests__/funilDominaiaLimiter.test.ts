import { describe, expect, it } from 'vitest';
import { ehFunilAutorizado } from '../middleware/rateLimiter';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!';

describe('ehFunilAutorizado: eventos do Domina IA fora do limiter global', () => {
  it('libera POST /_t/e com o cabeçalho igual ao segredo', () => {
    expect(ehFunilAutorizado('POST', '/_t/e', SEGREDO, SEGREDO)).toBe(true);
    expect(ehFunilAutorizado('POST', '/_t/e?x=1', [SEGREDO], SEGREDO)).toBe(true);
  });

  it('apara espaço e quebra de linha da env antes de comparar', () => {
    expect(ehFunilAutorizado('POST', '/_t/e', SEGREDO, SEGREDO + '\n')).toBe(true);
    expect(ehFunilAutorizado('POST', '/_t/e', SEGREDO, '  ' + SEGREDO + ' ')).toBe(true);
  });

  it('não libera sem segredo configurado ou com segredo curto', () => {
    expect(ehFunilAutorizado('POST', '/_t/e', '', '')).toBe(false);
    expect(ehFunilAutorizado('POST', '/_t/e', 'curto', 'curto')).toBe(false);
  });

  it('não libera com cabeçalho errado, ausente ou de outro tamanho', () => {
    expect(ehFunilAutorizado('POST', '/_t/e', undefined, SEGREDO)).toBe(false);
    expect(ehFunilAutorizado('POST', '/_t/e', SEGREDO.slice(0, -1) + 'x', SEGREDO)).toBe(false);
    expect(ehFunilAutorizado('POST', '/_t/e', SEGREDO + 'a', SEGREDO)).toBe(false);
  });

  it('não libera outro método nem outra rota', () => {
    expect(ehFunilAutorizado('GET', '/_t/e', SEGREDO, SEGREDO)).toBe(false);
    expect(ehFunilAutorizado('POST', '/_t/v', SEGREDO, SEGREDO)).toBe(false);
    expect(ehFunilAutorizado('POST', '/admin/dominaia/quiz-funil', SEGREDO, SEGREDO)).toBe(false);
    expect(ehFunilAutorizado('POST', '/_t/e/x', SEGREDO, SEGREDO)).toBe(false);
  });

  it('lê a env FUNIL_TOKEN por padrão', () => {
    const antes = process.env.FUNIL_TOKEN;
    process.env.FUNIL_TOKEN = SEGREDO;
    try {
      expect(ehFunilAutorizado('POST', '/_t/e', SEGREDO)).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.FUNIL_TOKEN;
      else process.env.FUNIL_TOKEN = antes;
    }
  });
});
