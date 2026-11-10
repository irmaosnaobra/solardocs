import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromTemplate } from '../services/templateService';
import { variantesCB, clienteCB } from './fixtures/propostaCompletaBancoDados';

// A "Completa + Banco" (propostaSolar, modelo 4) está no ar e tem que sair BYTE A BYTE igual ao de antes de a
// Completa ser reaproveitada pelo off-grid (exports novos, `subtitulo` e `tituloFicha` opcionais no cabeçalho).
// A referência foi gravada com o código de f0f29da4, com o relógio fixo em 05/11/2026 15:00 UTC.
// Para regravar de propósito (só com o código antigo ou com mudança aprovada): GERAR_GOLDEN=1.
const arq = (nome: string) => path.join(__dirname, 'fixtures', `propostaCompletaBanco-${nome}.golden.html`);

// Um clone Windows com autocrlf regrava o golden com CRLF: o conteúdo é o mesmo, então compara com LF.
const lerGolden = (a: string) => fs.readFileSync(a, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

describe('Completa + Banco (modelo 4): byte a byte', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  const conteudo = (v: (typeof variantesCB)[number]) => {
    const out: { resumo?: string } = {};
    const html = generateFromTemplate('propostaSolar', v.empresa, clienteCB, v.campos, 4, out);
    return `${html}\n<!--RESUMO-->\n${out.resumo ?? ''}`;
  };

  if (process.env.GERAR_GOLDEN === '1') {
    it('grava a referência (só com GERAR_GOLDEN=1)', () => {
      for (const v of variantesCB) fs.writeFileSync(arq(v.nome), conteudo(v));
    });
  }

  for (const v of variantesCB) {
    it(`variante ${v.nome}`, () => {
      expect(conteudo(v)).toBe(lerGolden(arq(v.nome)));
    });
  }

  it('as variantes são diferentes entre si (o teste não compara vazio)', () => {
    const [a, b, c] = variantesCB.map(conteudo);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a.length).toBeGreaterThan(20000);
    expect(a).toContain('Dados para pagamento');
    expect(c.match(/<div class="page[ "]/g)!.length).toBeGreaterThan(5);
  });
});
