import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { generateFromTemplate } from '../services/templateService';
import { cenariosModerno } from './fixtures/propostaModernoDados';

// O Moderno (modelos 2 e 3) foi refeito em folhas A4 em 18/11/2026. O texto do WhatsApp (out.resumo) dos
// modelos 2, 3 e 4 e o HTML do modelo 1 NÃO podiam mudar com isso. A referência foi gravada com o código de
// antes da reforma (main de 18/11/2026), com o relógio fixo. Para regravar de propósito: GERAR_GOLDEN=1.
const ARQ = path.join(__dirname, 'fixtures', 'propostaModernoResumo.golden.json');

interface Golden { [cenario: string]: { resumo2: string; resumo3: string; resumo4: string; html1: string } }

function capturar(): Golden {
  const g: Golden = {};
  for (const c of cenariosModerno) {
    const r = (m: 2 | 3 | 4) => {
      const out: { resumo?: string } = {};
      generateFromTemplate('propostaSolar', c.empresa, c.cliente, { ...c.campos }, m, out);
      return out.resumo ?? '';
    };
    const html1 = generateFromTemplate('propostaSolar', c.empresa, c.cliente, { ...c.campos }, 1);
    g[c.nome] = { resumo2: r(2), resumo3: r(3), resumo4: r(4), html1: createHash('sha256').update(html1).digest('hex') };
  }
  return g;
}

describe('Moderno refeito: o que não podia mudar', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T15:00:00.000Z')); });
  afterAll(() => { vi.useRealTimers(); });

  if (process.env.GERAR_GOLDEN === '1') {
    it('grava a referência (só com GERAR_GOLDEN=1)', () => {
      fs.writeFileSync(ARQ, JSON.stringify(capturar(), null, 2) + '\n');
    });
  }

  const ref: Golden = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8')) : {};
  for (const c of cenariosModerno) {
    it(`${c.nome}: resumo do WhatsApp igual nos modelos 2, 3 e 4`, () => {
      const atual = capturar()[c.nome];
      expect(atual.resumo2).toBe(ref[c.nome].resumo2);
      expect(atual.resumo3).toBe(ref[c.nome].resumo3);
      expect(atual.resumo4).toBe(ref[c.nome].resumo4);
    });
    it(`${c.nome}: modelo 1 byte a byte igual`, () => {
      expect(capturar()[c.nome].html1).toBe(ref[c.nome].html1);
    });
  }

  it('a referência não é vazia', () => {
    for (const c of cenariosModerno) expect(ref[c.nome].resumo2.length).toBeGreaterThan(100);
  });
});
