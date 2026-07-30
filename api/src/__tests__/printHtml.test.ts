import { describe, it, expect } from 'vitest';
import { injectPrint, stripPrint } from '../utils/printHtml';

const proposta = '<!DOCTYPE html><html><body><h1>Proposta</h1></body></html>';

describe('script de impressão', () => {
  it('entra antes do </body>', () => {
    const out = injectPrint(proposta);
    expect(out).toContain('window.print()');
    expect(out.indexOf('window.print()')).toBeLessThan(out.indexOf('</body>'));
  });

  it('não injeta duas vezes', () => {
    const duas = injectPrint(injectPrint(proposta));
    expect(duas.match(/window\.print\(\)/g)).toHaveLength(1);
  });

  it('stripPrint desfaz o inject — proposta antiga do Storage volta a abrir em paz', () => {
    expect(stripPrint(injectPrint(proposta))).toBe(proposta);
  });

  it('stripPrint não mexe em HTML que nunca teve o script', () => {
    expect(stripPrint(proposta)).toBe(proposta);
  });
});
