import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromTemplate } from '../services/templateService';
import { empresaOffGrid, clienteOffGrid, dadosOffGrid } from './fixtures/offgridDados';

// O modelo 1 do off-grid tem que sair BYTE A BYTE igual ao de antes da "Off-grid Completa" (modelo 2).
// A saída de referência foi gravada com o template antigo, com o relógio fixo em 05/11/2026 15:00 UTC.
const GOLDEN = path.join(__dirname, 'fixtures', 'propostaOffGridModelo1.golden.html');
const GOLDEN_SEM_COMP = path.join(__dirname, 'fixtures', 'propostaOffGridModelo1-sem-comparativo.golden.html');

// Um clone Windows com autocrlf regrava o golden com CRLF: o conteúdo é o mesmo, então compara com LF.
function lerGolden(arq: string): string {
  return fs.readFileSync(arq, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
}

function semComparativo(): Record<string, unknown> {
  const f: Record<string, unknown> = { ...dadosOffGrid };
  delete f.comp_opcoes;
  return f;
}

describe('off-grid modelo 1: byte a byte', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  const gerar = (f: Record<string, unknown>) => {
    const out: { resumo?: string } = {};
    const html = generateFromTemplate('propostaOffGrid', empresaOffGrid, clienteOffGrid, f, 1, out);
    return { html, resumo: out.resumo ?? '' };
  };
  const conteudo = (f: Record<string, unknown>) => { const g = gerar(f); return `${g.html}\n<!--RESUMO-->\n${g.resumo}`; };

  if (process.env.GERAR_GOLDEN === '1') {
    it('grava a referência (só com GERAR_GOLDEN=1)', () => {
      fs.writeFileSync(GOLDEN, conteudo(dadosOffGrid));
      fs.writeFileSync(GOLDEN_SEM_COMP, conteudo(semComparativo()));
    });
  }

  it('com comparativo (3 folhas) e resumo do WhatsApp', () => {
    expect(conteudo(dadosOffGrid)).toBe(lerGolden(GOLDEN));
  });

  it('sem comparativo (2 folhas)', () => {
    expect(conteudo(semComparativo())).toBe(lerGolden(GOLDEN_SEM_COMP));
  });

  it('modeloNumero 1 e modelo ausente caem no mesmo documento', () => {
    expect(gerar(dadosOffGrid).html).toContain('Proposta de sistema off-grid');
  });
});
