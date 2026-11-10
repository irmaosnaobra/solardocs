import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';
import { valorParcelaCartao, valorParcelaFin } from '../services/propostaSolarCalculos';
import { pBRL } from '../services/propostaSolarBase';
import { empresaOffGrid, clienteOffGrid, dadosOffGrid } from './fixtures/offgridDados';

// Resumo de texto do WhatsApp da proposta off-grid: neutro no modo próprio e nas formas de pagamento novas, com as
// MESMAS parcelas do PDF. Sem esses campos, o texto de sempre (o golden do modelo 1 prova o byte a byte).

const base: Record<string, unknown> = { ...dadosOffGrid, emitido_em: '2026-11-09T15:00:00.000Z' };
const gerar = (f: Record<string, unknown> = {}, modelo: 1 | 2 = 2) => {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaOffGrid', empresaOffGrid, clienteOffGrid, { ...base, ...f }, modelo, out);
  return { html, resumo: out.resumo ?? '' };
};
const celula = (k: number, v: number) => `<span class="n">${k}× de</span><span class="v num">${pBRL(v)}</span>`;
/** Parcelas do resumo ("* 12x de R$ 7.000") como [n, texto do valor]. */
const parcelasDoResumo = (resumo: string, titulo: string): Array<[number, string]> => {
  const linhas = resumo.split('\n');
  const i = linhas.indexOf(titulo);
  if (i < 0) return [];
  const out: Array<[number, string]> = [];
  for (const l of linhas.slice(i + 1)) {
    const m = l.match(/^\* (\d+)x de (.+)$/);
    if (!m) break;
    out.push([Number(m[1]), m[2]]);
  }
  return out;
};

const pag = {
  investimento: 78900, preco_avista: 70000, pag_vista: true,
  pag_cartao: true, pag_cartao_1: true, pag_cartao_6: true, pag_cartao_12: true,
  pag_fin: true, pag_fin_36: true, pag_fin_60: true, pag_fin_84: true,
};

describe('resumo do WhatsApp, off-grid', () => {
  it('formas de pagamento novas: neutro (sem química, sem marca, sem travessão) e com as parcelas do PDF', () => {
    const { html, resumo } = gerar(pag, 1);
    expect(resumo).not.toMatch(/l[ií]tio/i);
    expect(resumo).not.toMatch(/—|–/);
    expect(resumo).toContain('Bateria: ');
    expect(resumo).toContain(`À vista: ${pBRL(70000)}`);
    const modelo2 = gerar(pag, 2);
    expect(modelo2.resumo).toBe(resumo); // o resumo é o mesmo nos dois modelos
    const cartao = parcelasDoResumo(resumo, 'Cartão de crédito:');
    const fin = parcelasDoResumo(resumo, 'Financiamento:');
    expect(cartao.map(([k]) => k)).toEqual([1, 6, 12]);
    expect(fin.map(([k]) => k)).toEqual([36, 60, 84]);
    // Contra o HTML da própria folha de pagamento do modelo 2, não contra conta feita à mão.
    for (const [k, v] of cartao) expect(modelo2.html).toContain(`<span class="n">${k}× de</span><span class="v num">${v}</span>`);
    for (const [k, v] of fin) expect(modelo2.html).toContain(`<span class="n">${k}× de</span><span class="v num">${v}</span>`);
    expect(html).not.toBe(modelo2.html);
  });

  it('as parcelas batem com os helpers solares, com taxa própria, taxa inválida e investimento em texto brasileiro', () => {
    const f = { ...pag, investimento: '78.900,50', taxa_cartao_6: '8,5', taxa_cartao_12: '500', taxa_fin_60: '1,9' };
    const { html, resumo } = gerar(f, 2);
    // Mesmo parse do PDF: "78.900,50" vale 78900,5, e taxa fora de 0 a 100 cai no padrão.
    const sane = { ...f, taxa_cartao_12: undefined };
    for (const [k, v] of parcelasDoResumo(resumo, 'Cartão de crédito:')) {
      expect(v).toBe(pBRL(valorParcelaCartao(sane, 78900.5, k)));
      expect(html).toContain(celula(k, valorParcelaCartao(sane, 78900.5, k)));
    }
    for (const [k, v] of parcelasDoResumo(resumo, 'Financiamento:')) {
      expect(v).toBe(pBRL(valorParcelaFin(f, 78900.5, k)));
      expect(html).toContain(celula(k, valorParcelaFin(f, 78900.5, k)));
    }
    expect(parcelasDoResumo(resumo, 'Cartão de crédito:')).toHaveLength(3);
  });

  it('investimento com ponto de milhar em texto ("78.900") vale 78.900, não 78', () => {
    const { html, resumo } = gerar({ ...pag, investimento: '78.900' }, 2);
    const [k, v] = parcelasDoResumo(resumo, 'Cartão de crédito:')[0];
    expect(v).toBe(pBRL(valorParcelaCartao({}, 78900, k)));
    expect(html).toContain(celula(k, valorParcelaCartao({}, 78900, k)));
  });

  it('só o que foi marcado sai; cartão e financiamento desligados somem; à vista desligado some', () => {
    const { resumo } = gerar({ ...pag, pag_cartao: false, pag_fin: false, pag_vista: false });
    expect(resumo).not.toContain('Cartão de crédito:');
    expect(resumo).not.toContain('Financiamento:');
    expect(resumo).not.toContain('À vista');
    expect(resumo).toContain('Investimento: R$');
  });

  it('o texto pronto parcela_cartao/parcela_financiamento é ignorado quando há forma de pagamento nova (nunca duas parcelas)', () => {
    const { resumo } = gerar({ ...pag, parcela_cartao: '12x de R$ 7.142 no cartão', parcela_financiamento: 'ou 60x de R$ 2.020 no financiamento' });
    expect(resumo).not.toContain('7.142');
    expect(resumo).not.toContain('2.020');
  });

  it('modo próprio sem nenhum pag_*: neutro, e as parcelas são os textos prontos (como no PDF)', () => {
    const { resumo } = gerar({ modo_equipamento: 'proprio', parcela_cartao: '12x de R$ 7.142 no cartão', parcela_financiamento: 'ou 60x de R$ 2.020 no financiamento' }, 2);
    expect(resumo).not.toMatch(/l[ií]tio/i);
    expect(resumo).not.toMatch(/—|–/);
    expect(resumo).toContain('ou 60x de R$ 2.020 no financiamento');
    expect(resumo).toContain('12x de R$ 7.142 no cartão');
    expect(resumo).not.toContain('Cartão de crédito:');
  });

  it('modo próprio com formas de pagamento: parcelas dos helpers, sem os textos prontos', () => {
    const { resumo } = gerar({ ...pag, modo_equipamento: 'proprio', parcela_cartao: '12x de R$ 7.142 no cartão' });
    expect(resumo).not.toMatch(/l[ií]tio/i);
    expect(resumo).not.toContain('7.142');
    expect(parcelasDoResumo(resumo, 'Cartão de crédito:').length).toBeGreaterThan(0);
  });

  it('entrada + saldo e condição especial entram no resumo com as regras do PDF', () => {
    const ent = { ...pag, pag_entrada: true, entrada_valor: 20000, entrada_modo: 'contrato' };
    const { resumo } = gerar(ent, 2);
    expect(resumo).toContain(`Entrada de ${pBRL(20000)} e restante de ${pBRL(58900)} na assinatura do contrato`);
    expect(gerar({ ...ent, entrada_modo: 'dias', entrada_dias: 15 }).resumo).toContain('em 15 dias');
    // Entrada zero, igual ao preço, maior que o preço ou desligada: nada sai.
    for (const v of [{ entrada_valor: 0 }, { entrada_valor: 78900 }, { entrada_valor: 90000 }, { pag_entrada: false }]) {
      expect(gerar({ ...ent, ...v }).resumo).not.toContain('Entrada de');
    }
    const custom = gerar({ ...pag, pag_custom: 'Aceito <b>troca</b> de <script>x</script> trator' }).resumo;
    expect(custom).toContain('Condição especial: Aceito troca de x trator');
    expect(custom).not.toMatch(/[<>]/);
    const longo = gerar({ ...pag, pag_custom: 'palavra '.repeat(200) }).resumo;
    const linha = longo.split('\n').find((l) => l.startsWith('Condição especial: ')) ?? '';
    expect(linha.length - 'Condição especial: '.length).toBeLessThanOrEqual(501);
    expect(gerar(pag).resumo).not.toContain('Condição especial');
  });

  it('resumo neutro nunca leva travessão: autonomia zero omite a linha', () => {
    const { resumo } = gerar({ ...pag, aut_tudo_dias: 0, aut_chuva_dias: 0 });
    expect(resumo).not.toMatch(/—|–/);
    expect(resumo).not.toContain('Com a casa inteira');
    expect(resumo).not.toContain('Chovendo o dia todo');
    expect(resumo).toContain('Aguenta 2 dias e 2 horas sem sol nenhum');
    expect(gerar({ ...pag, aut_essencial_dias: 0 }).resumo).not.toContain('Aguenta');
  });

  it('sem modo próprio e sem pag_*: o resumo de sempre (com "de lítio" e os textos prontos)', () => {
    const { resumo } = gerar({ parcela_cartao: '12x de R$ 7.142 no cartão' }, 1);
    expect(resumo).toContain('kWh de lítio');
    expect(resumo.split('\n')[0]).toContain('—');
    expect(resumo).toContain('12x de R$ 7.142 no cartão');
  });
});
