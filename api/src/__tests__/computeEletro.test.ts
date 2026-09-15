import { describe, it, expect } from 'vitest';
import {
  computeEletro, tetoFisico, recargasParaPagar, contaDeReferencia, configDoKw,
  PREMISSAS_LP, CARGAS_EP, CONFIGS_EP,
} from '../utils/computeEletro';
import { computeEletro as doController } from '../controllers/apresentacaoController';

// Conferência escrita na LP /io/eletroposto (params()): é ela que manda.
const lp = (invest: number, carros = 10) => computeEletro({
  ...PREMISSAS_LP, carga: CARGAS_EP.cidade, carros, invest,
});

describe('computeEletro: teste de ouro contra a conferência da LP', () => {
  it('R$ 160.000: lucro 6.920, margem 47,86%, payback 2,46 anos', () => {
    const r = lp(160000);
    expect(Math.abs(r.lucroMes - 6920)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.margem * 100 - 47.86)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(Number(r.payback) - 2.46)).toBeLessThanOrEqual(0.005);
  });

  it('R$ 144.595: lucro 6.933, payback 2,27 anos', () => {
    const r = lp(144595);
    expect(Math.abs(r.lucroMes - 6933)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(r.payback) - 2.27)).toBeLessThanOrEqual(0.005);
  });

  it('o controller reexporta a mesma função', () => {
    expect(doController).toBe(computeEletro);
  });
});

describe('tetoFisico: cópia do rotativ() da LP', () => {
  it('80 kW na cidade fica no teto do simulador (30); na rodovia a máquina limita (27)', () => {
    expect(tetoFisico(80, 20)).toBe(30);
    expect(tetoFisico(80, 35)).toBe(27);
  });
  it('60 e 120 kW', () => {
    expect(tetoFisico(60, 20)).toBe(20);
    expect(tetoFisico(120, 20)).toBe(40);
    expect(tetoFisico(120, 35)).toBe(40);
  });
  it('160 e 240 kW caem na de 120; potência fora da tabela cai na de baixo', () => {
    expect(configDoKw(160)).toBe(120);
    expect(configDoKw(240)).toBe(120);
    expect(configDoKw(100)).toBe(80);
    expect(configDoKw(40)).toBe(60);
    expect(tetoFisico(240, 20)).toBe(tetoFisico(120, 20));
  });
});

describe('recargasParaPagar', () => {
  const base = { ...PREMISSAS_LP, carga: 20, invest: CONFIGS_EP[80].invest };

  it('menos meses pede mais recargas (monotônica)', () => {
    const r24 = recargasParaPagar(base, 30, 24);
    const r36 = recargasParaPagar(base, 30, 36);
    const r60 = recargasParaPagar(base, 30, 60);
    expect(r36).not.toBeNull();
    expect(r24 as number).toBeGreaterThanOrEqual(r36 as number);
    expect(r36 as number).toBeGreaterThanOrEqual(r60 as number);
  });

  it('o número devolvido paga no prazo e o anterior não', () => {
    const n = recargasParaPagar(base, 30, 36) as number;
    expect(Number(computeEletro({ ...base, carros: n }).payback) * 12).toBeLessThanOrEqual(36);
    if (n > 1) {
      const antes: number | null = computeEletro({ ...base, carros: n - 1 }).payback;
      expect(antes === null || antes * 12 > 36).toBe(true);
    }
  });

  it('null quando nem o teto paga', () => {
    expect(recargasParaPagar({ ...base, invest: 5_000_000 }, 30, 36)).toBeNull();
  });
});

describe('contaDeReferencia', () => {
  it('sem a linha Simulou: 80 kW, 10 carros, R$ 145.000', () => {
    const c = contaDeReferencia({});
    expect(c.kw).toBe(80);
    expect(c.invest).toBe(145000);
    expect(c.base.carros).toBe(10);
    expect(c.carga).toBe(20);
  });

  it('piso <= base <= teto, e o teto nunca passa da máquina', () => {
    for (const kw of [60, 80, 120, 160, 240]) {
      for (const carros of [1, 5, 10, 14, 30, 60]) {
        for (const rodovia of [false, true]) {
          const c = contaDeReferencia({ kw, carros, rodovia });
          expect(c.piso.carros).toBeLessThanOrEqual(c.base.carros);
          expect(c.base.carros).toBeLessThanOrEqual(c.teto.carros);
          expect(c.teto.carros).toBeLessThanOrEqual(c.teto_fisico);
          expect(c.piso.carros).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('rodovia usa 35 kWh por recarga', () => {
    expect(contaDeReferencia({ rodovia: true }).carga).toBe(35);
  });
});
