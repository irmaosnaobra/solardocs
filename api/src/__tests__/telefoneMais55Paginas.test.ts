import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// "+55 34 99816-5040" (o que o preenchimento automático do celular põe, autocomplete="tel")
// virava 5555349981650 nas páginas de lead: a máscara cortava em 11 dígitos ANTES de olhar o
// 55, e os dois últimos dígitos se perdiam (54 cadastros em produção, número sem conserto).
// Todas usam agora a mesma regra do quiz solar, ampliada para o 0 da frente:
//   .replace(/^(?:55|0)(?=\d{10,11}$)/, '')  ANTES do  .slice(0, 11)
// Este teste lê o texto de cada página e roda a máscara dela com os três jeitos de digitar.
const PUB = join(__dirname, '../../../dashboard/public');
const ler = (rel: string) => readFileSync(join(PUB, rel), 'utf8').split('\r\n').join('\n');

const REGRA = ".replace(/^(?:55|0)(?=\\d{10,11}$)/, '')";
const PAGINAS = [
  'io/eletroposto/index.html',
  'io/eletroposto/parceria/index.html',
  'io/index.html',
  'io/oferta/index.html',
  'io/solar/simulador/index.html',
  'io/solar/index.html',
  'nexus/app/js/app.js',
];

describe('a normalização do 55 e do 0 mora antes do corte em 11 dígitos, em toda página de lead', () => {
  for (const rel of PAGINAS) {
    it(rel, () => {
      const t = ler(rel);
      const i = t.indexOf(REGRA);
      expect(i, 'regra ausente').toBeGreaterThan(0);
      expect(t.slice(i + REGRA.length, i + REGRA.length + 20)).toMatch(/^\.slice\(0,\s*11\)/);
    });
  }

  it('nenhuma máscara das páginas de lead corta em 11 dígitos sem a regra antes', () => {
    for (const rel of PAGINAS) {
      const t = ler(rel);
      const cortes = [...t.matchAll(/replace\(\/\\D\/g,\s*''\)\.slice\(0,\s*11\)/g)];
      expect(cortes.length, `${rel}: corte em 11 sem a regra`).toBe(0);
    }
  });

  it('io/oferta não tem maxlength no WhatsApp: o "+55 34 99816-5040" colado tem 17 caracteres e seria cortado antes da máscara', () => {
    expect(ler('io/oferta/index.html')).not.toMatch(/name="whatsapp"[^>]*maxlength/);
  });
});

describe('a regra, executada', () => {
  const norm = (bruto: string) => bruto.replace(/\D/g, '').replace(/^(?:55|0)(?=\d{10,11}$)/, '').slice(0, 11);
  it('o 55 e o 0 da frente saem; número normal e DDD 55 ficam como estão', () => {
    for (const v of ['+55 34 99816-5040', '+5534998165040', '034 99816-5040', '34 99816-5040', '(34) 99816-5040'])
      expect(norm(v), v).toBe('34998165040');
    expect(norm('(55) 99999-9999')).toBe('55999999999');
    expect(norm('+55 55 99999-9999')).toBe('55999999999');
    expect(norm('+55 34 3333-4444')).toBe('3433334444');
  });
});
