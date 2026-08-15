import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A CONTA QUE DECIDE QUANTO COBRAR DE UM CLIENTE DE VERDADE.
//
// Este é o arquivo mais caro do app de cobranças: se ele errar pra menos, o
// Thiago manda um link, o cliente paga, e só um mês depois aparece que faltou
// dinheiro — com a venda fechada e nada a fazer.
//
// Dois defeitos concretos que estes testes existem pra impedir:
//
//   1. Usar a taxa de antecipação errada. O Asaas tem DUAS e a diferença é de
//      36%: 1,25% a.m. para cobrança à vista, 1,70% a.m. para PARCELAMENTO.
//      Num 18x de R$7,7 mil isso é ~R$190 sumindo em silêncio.
//   2. Antecipar 18 parcelas custar "um mês". Cada parcela é antecipada por um
//      mês a mais que a anterior — o custo é a MÉDIA, (n+1)/2 meses. Tratar
//      como um mês faz o 18x parecer 9× mais barato do que é.
// ─────────────────────────────────────────────────────────────────────────────

import {
  liquidoDe, brutoParaLiquido, fatorAntecipacao, calcularPrevia,
} from '../services/asaas/asaasCobrancas';
import type { Taxas } from '../services/asaas/asaasTaxas';

// Taxas conferidas contra a API do Asaas em 14/08/2026 (preço de balcão, sem a
// promo). São estas que a conta paga quando o desconto de adesão vence.
const TAXAS: Taxas = {
  ambiente: 'prod',
  cartaoFixo: 0.49,
  cartaoPct: { avista: 2.99, ate6: 3.49, ate12: 3.99, ate21: 4.29 },
  promoAtiva: false, promoVence: null, cartaoDias: 32,
  boleto: 1.99, boletoDias: 1,
  pixTipo: 'FIXED', pixFixo: 1.99, pixPct: 0, pixMin: 0, pixMax: 0,
  pixGratisMes: 0, pixJaUsadosMes: 0,
  antecipAvistaMes: 1.25, antecipParceladoMes: 1.70,
};

describe('taxa de antecipação: parcelado ≠ à vista', () => {
  it('usa 1,70% a.m. no parcelado e 1,25% no à vista', () => {
    // 1x → 1,25% sobre (3 dias de vencimento + 32 de liquidação) = 1,17 mês
    expect(fatorAntecipacao(TAXAS, 1, 3)).toBeCloseTo(0.0125 * (35 / 30), 6);
    // 18x → 1,70% sobre a média dos prazos: 3 + 32 + 30×8,5 = 290 dias
    expect(fatorAntecipacao(TAXAS, 18, 3)).toBeCloseTo(0.017 * (290 / 30), 6);
  });

  it('antecipar 18x custa ~9,7 meses de taxa, não 1', () => {
    const um = fatorAntecipacao(TAXAS, 1, 3);
    expect(fatorAntecipacao(TAXAS, 18, 3) / um).toBeGreaterThan(10);
  });

  it('a estimativa fica perto do que o Asaas cobrou de verdade', () => {
    // Conferido ao vivo em 14/08/2026: parcelamento de R$9.496,08 em 18x, taxa
    // real de antecipação R$1.584,69. O modelo pode ficar um pouco abaixo — é
    // por isso que cobrança com CPF confere no Asaas antes de virar link — mas
    // não pode desabar: um erro grande aqui passaria da correção automática.
    const estimado = 9496.08 * fatorAntecipacao(TAXAS, 18, 3);
    expect(estimado).toBeGreaterThan(1584.69 * 0.95);
    expect(estimado).toBeLessThan(1584.69 * 1.10);
  });
});

describe('o líquido nunca fica abaixo do alvo', () => {
  const alvos = [67, 497, 1500, 7700, 23400];
  const parcelas = [1, 2, 6, 10, 12, 18, 21];

  it('para toda combinação de alvo × parcelas, com e sem antecipação', () => {
    for (const alvo of alvos) {
      for (const n of parcelas) {
        for (const antecipar of [true, false]) {
          const bruto = brutoParaLiquido(TAXAS, 'cartao', alvo, n, antecipar);
          const sobra = liquidoDe(TAXAS, 'cartao', bruto, n, antecipar);
          expect(sobra).toBeGreaterThanOrEqual(alvo - 0.01);
          // E não pode exagerar: cobrar demais do cliente também é defeito.
          expect(sobra).toBeLessThan(alvo * 1.02 + 1);
        }
      }
    }
  });

  it('vale para Pix e boleto também', () => {
    for (const meio of ['pix', 'boleto'] as const) {
      const bruto = brutoParaLiquido(TAXAS, meio, 7700, 1, false);
      expect(liquidoDe(TAXAS, meio, bruto, 1, false)).toBeGreaterThanOrEqual(7699.99);
    }
  });
});

describe('a venda do Bruno — 18x com R$ 7.700 de líquido', () => {
  it('cobra ~R$ 9,6 mil, não os R$ 7,7 mil da conversa', async () => {
    const previa = await calcularPrevia({
      cliente: { nome: 'Bruno Henrique' },
      descricao: 'Entrada',
      meio: 'cartao', parcelas: 18,
      valorModo: 'liquido', valor: 7700,
      vencimentoDias: 3, antecipar: true,
    }, TAXAS);

    expect(previa.bruto).toBeGreaterThan(9400);
    expect(previa.bruto).toBeLessThan(9800);
    expect(previa.liquido).toBeGreaterThanOrEqual(7700);
    // A parcela é o número que o cliente lê: 18 × parcela tem que fechar o total
    // exato, sem centavo órfão na última.
    expect(previa.parcela * previa.parcelas).toBeCloseTo(previa.bruto, 2);
  });

  it('cobrar os R$ 7.700 crus deposita bem menos que 7.700', async () => {
    const previa = await calcularPrevia({
      cliente: { nome: 'Bruno Henrique' },
      descricao: 'Entrada',
      meio: 'cartao', parcelas: 18,
      valorModo: 'cheio', valor: 7700,
      vencimentoDias: 3, antecipar: true,
    }, TAXAS);
    expect(previa.liquido).toBeLessThan(6600);
  });

  it('sem antecipar sobra mais — o preço da pressa aparece na prévia', async () => {
    const base = { cliente: { nome: 'X' }, descricao: 'y', meio: 'cartao' as const,
                   parcelas: 18, valorModo: 'cheio' as const, valor: 9600, vencimentoDias: 3 };
    const comPressa = await calcularPrevia({ ...base, antecipar: true }, TAXAS);
    const semPressa = await calcularPrevia({ ...base, antecipar: false }, TAXAS);
    expect(semPressa.liquido - comPressa.liquido).toBeGreaterThan(1400);
    expect(comPressa.custoAntecipacao).toBeGreaterThan(1400);
    expect(semPressa.custoAntecipacao).toBe(0);
  });
});

describe('avisos que impedem promessa errada', () => {
  it('acima de 12x avisa que só Visa e Mastercard fazem', async () => {
    const p = await calcularPrevia({
      cliente: { nome: 'X' }, descricao: 'y', meio: 'cartao', parcelas: 18,
      valorModo: 'liquido', valor: 7700, vencimentoDias: 3, antecipar: true,
    }, TAXAS);
    expect(p.avisos.join(' ')).toMatch(/Visa e Mastercard/i);
    expect(p.avisos.join(' ')).toMatch(/limite/i);
  });

  it('em sandbox grita que a cobrança não é real', async () => {
    const p = await calcularPrevia({
      cliente: { nome: 'X' }, descricao: 'y', meio: 'link', parcelas: 1,
      valorModo: 'cheio', valor: 100, vencimentoDias: 3, antecipar: false,
    }, { ...TAXAS, ambiente: 'sandbox' });
    expect(p.avisos.join(' ')).toMatch(/TESTE/i);
  });

  it('mostra quanto sobraria no Pix, pra comparação ficar na tela', async () => {
    const p = await calcularPrevia({
      cliente: { nome: 'X' }, descricao: 'y', meio: 'cartao', parcelas: 18,
      valorModo: 'liquido', valor: 7700, vencimentoDias: 3, antecipar: true,
    }, TAXAS);
    expect(p.seFossePix).not.toBeNull();
    expect(p.seFossePix!.liquido).toBeGreaterThan(p.liquido);
  });
});
