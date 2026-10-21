/**
 * Portal do Parceiro NEXUS: a conta do gerador de propostas.
 *
 * `calc.js` (dashboard/public/nexus/app/js) e' uma copia fiel de computeEletro, eletroCenariosSens e
 * pmtPriceCarencia do /gerador, em funcoes puras. Roda no navegador (window.NexusCalc) e aqui, por require.
 * Cada numero abaixo foi calculado a mao (a conta esta no comentario de cada caso), nao tirado da propria funcao.
 *
 * Padroes do Simulador: 10 carros/dia, 20 kWh por carro, custo do kWh 0,70, preco ao motorista 2,35,
 * ativacao 1,20 por recarga, software 10%, repasse 0%, imposto 6%, manutencao 200/mes, internet 200/mes,
 * ocupacao inicial 50% subindo ate 100% em 6 meses. Seguro = investimento x 1% / 12.
 *   kWh/mes        = 10 x 20 x 30 = 6.000
 *   faturamento    = 6.000 x 2,35 + (10 x 30) x 1,20 = 14.100 + 360 = 14.460,00
 *   taxas (%)      = 10% + 0% + 6% = 16% do faturamento = 2.313,60
 *   margem variavel= 14.460 - energia - 2.313,60
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const requireCjs = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: any = requireCjs(path.resolve(__dirname, '../../../dashboard/public/nexus/app/js/calc.js'));

const perto = (valor: number, esperado: number, casas = 2) => expect(valor).toBeCloseTo(esperado, casas);

// Exemplo do canvas aprovado: 1x DC 80 kW a 69.990 + 30.000 de servicos = 99.990.
const SERVICOS_CANVAS = [
  { id: 'infra', valor: '14.000,00' },
  { id: 'projeto', valor: '4.500,00' },
  { id: 'civil', valor: '6.000,00' },
  { id: 'instal', valor: '5.500,00' },
];
const caso80 = () => ({ equip: { quantidade: 1, preco: 69990 }, itens: SERVICOS_CANVAS });

describe('NexusCalc: total da proposta', () => {
  it('equipamento x quantidade + itens (1x DC 80 kW a 69.990 + 30.000 = 99.990)', () => {
    const t = C.totalProposta(caso80());
    expect(t.equipamento).toBe(69990);
    expect(t.itens).toBe(30000);
    expect(t.total).toBe(99990);
  });

  it('2x DC 120 kW a 89.990 sem servicos = 179.980', () => {
    expect(C.totalProposta({ equip: { quantidade: 2, preco: 89990 }, itens: [] }).total).toBe(179980);
  });

  it('item de valor zero ou vazio nao entra no total', () => {
    const t = C.totalProposta({ equip: { quantidade: 1, preco: 69990 }, itens: [{ id: 'infra', valor: '' }, { id: 'civil', valor: '0,00' }] });
    expect(t.total).toBe(69990);
  });

  it('ponto de milhar: "145.000" e "145.000,50" nao viram 145 (licao do /gerador)', () => {
    expect(C.lerMoeda('145.000')).toBe(145000);
    expect(C.lerMoeda('145.000,50')).toBe(145000.5);
    expect(C.lerMoeda('R$ 69.990,00')).toBe(69990);
    expect(C.lerMoeda('')).toBe(0);
    expect(C.lerMoeda('-5')).toBe(5);
  });
});

describe('NexusCalc: caso do canvas, 1x DC 80 kW, padroes do Simulador, operacao plena', () => {
  // seguro/mes = 99.990 x 0,01 / 12 = 83,325
  // fixos/mes  = manutencao 200 + internet 200 + seguro 83,325 + outros 0 = 483,325
  // energia    = 6.000 kWh x 0,70 = 4.200,00
  // custos     = 4.200 + 2.313,60 + 483,325 = 6.996,925  (a tela arredonda para 6.996,93)
  // lucro/mes  = 14.460 - 6.996,925 = 7.463,075          (a tela arredonda para 7.463,07 ou 7.463,08)
  const c = C.calcular(caso80());
  it('faturamento, custos e lucro por mes', () => {
    perto(c.r.kwhMes, 6000);
    perto(c.r.fatMes, 14460);
    perto(c.r.seguroMes, 83.325, 3);
    perto(c.r.fixosMes, 483.325, 3);
    perto(c.r.custosMes, 6996.925, 3);
    perto(c.r.lucroMes, 7463.075, 3);
    perto(c.r.lucroMes, 7463.07, 1);
  });

  it('retorno em operacao plena = investimento / lucro mensal = 99.990 / 7.463,075 = 13,398 meses (a tela diz cerca de 14)', () => {
    perto(c.paybackPleno, 13.398, 3);
    expect(Math.ceil(c.paybackPleno)).toBe(14);
  });

  it('payback do Simulador, com a rampa de ocupacao: 1,2496 anos', () => {
    // ocupacao do mes m (1 a 5) = 0,5 + 0,5 x (m-1)/5 = 0,5 / 0,6 / 0,7 / 0,8 / 0,9; do mes 6 em diante, 1,0
    // soma dos 12 meses = 3,5 + 7 = 10,5
    // margem variavel/mes = 14.460 - 4.200 - 2.313,60 = 7.946,40
    // ano 1 = 7.946,40 x 10,5 - 12 x 483,325 = 83.437,20 - 5.799,90 = 77.637,30
    // ano 2 = 12 x 7.463,075 = 89.556,90
    // payback = 1 + (99.990 - 77.637,30) / 89.556,90 = 1,24959
    perto(c.r.lucroAno1, 77637.3, 2);
    perto(c.r.fluxoAnual[1], 89556.9, 2);
    perto(c.r.payback, 1.24959, 4);
    expect(C.anos1(c.r.payback)).toBe('1,2 anos');
  });

  it('patrimonio em 10 anos = -99.990 + 77.637,30 + 9 x 89.556,90 = 783.659,40', () => {
    perto(c.r.acumulado10, 783659.4, 1);
    expect(c.r.tir).toBeGreaterThan(0);
    expect(c.r.vpl).toBeGreaterThan(0);
  });

  it('caixa acumulado em 60 meses, em operacao plena: -99.990 + 60 x 7.463,075 = 347.794,50 (a tela diz cerca de 347.800)', () => {
    const m = C.fluxoMensal(c.r, 60);
    expect(m.pontos.length).toBe(61);
    perto(m.pontos[0], -99990);
    perto(m.pontos[60], 347794.5, 1);
    perto(m.cruza, 13.398, 3);
  });

  it('caixa acumulado COM a rampa cruza o zero em 14,995 meses (o mesmo 1,2496 ano do Simulador)', () => {
    const m = C.fluxoMensal(c.r, 60, true);
    perto(m.cruza, 14.995, 3);
    perto(m.cruza / 12, c.r.payback, 3);
  });

  it('cenarios: Conservador 6, Base 10 e Otimista 14 carros por dia', () => {
    // 6 carros: 6 x 20 x 30 = 3.600 kWh x 2,35 = 8.460 + 180 x 1,20 = 216 -> 8.676
    // 14 carros: 14 x 20 x 30 = 8.400 kWh x 2,35 = 19.740 + 420 x 1,20 = 504 -> 20.244
    const cen = C.cenariosSens(c.p);
    expect(cen.map((x: { carros: number }) => x.carros)).toEqual([6, 10, 14]);
    perto(cen[0].r.fatMes, 8676);
    perto(cen[1].r.fatMes, 14460);
    perto(cen[2].r.fatMes, 20244);
    expect(cen[1].r.lucroMes).toBeCloseTo(c.r.lucroMes, 6);
  });
});

describe('NexusCalc: 2x DC 120 kW com usina solar propria, 20 recargas por dia', () => {
  // Recargas por dia = 10 por carregador enquanto o parceiro nao edita: 2 carregadores = 20 (total do posto).
  // Investimento = 2 x 89.990 = 179.980.
  // kWh/mes = 20 x 20 x 30 = 12.000 ; faturamento = 12.000 x 2,35 + (20 x 30) x 1,20 = 28.200 + 720 = 28.920
  // Usina ligada: custo do kWh = 0,30 -> energia = 12.000 x 0,30 = 3.600
  // taxas = 16% de 28.920 = 4.627,20 ; seguro/mes = 179.980 x 0,01 / 12 = 149,9833 ; fixos = 200 + 200 + 149,9833 = 549,9833
  // custos = 3.600 + 4.627,20 + 549,9833 = 8.777,1833 ; lucro = 28.920 - 8.777,1833 = 20.142,8167
  const form = { equip: { quantidade: 2, preco: 89990 }, itens: [], prem: { carros: C.recargasPadrao(2), custoKwh: C.CUSTO_KWH_SOLAR } };
  const c = C.calcular(form);
  it('recargas por dia padrao = 10 x quantidade (1 a 50)', () => {
    expect(C.recargasPadrao(1)).toBe(10);
    expect(C.recargasPadrao(2)).toBe(20);
    expect(C.recargasPadrao(50)).toBe(500);
    expect(C.recargasPadrao(0)).toBe(10);
    expect(C.recargasPadrao(99)).toBe(500);
  });
  it('investimento, faturamento, custos e lucro', () => {
    expect(C.CUSTO_KWH_SOLAR).toBe(0.3);
    perto(c.totais.total, 179980);
    perto(c.r.kwhMes, 12000);
    perto(c.r.fatMes, 28920);
    perto(c.r.custosMes, 8777.1833, 3);
    perto(c.r.lucroMes, 20142.8167, 3);
  });
  it('retorno pleno = 179.980 / 20.142,8167 = 8,935 meses', () => perto(c.paybackPleno, 8.935, 3));
  it('payback com rampa: margem 28.920 - 3.600 - 4.627,20 = 20.692,80; ano 1 = 20.692,80 x 10,5 - 12 x 549,9833 = 210.674,60; paga no ano 1: 179.980 / 210.674,60 = 0,8543 ano', () => {
    perto(c.r.fluxoAnual[0], 210674.6, 1);
    perto(c.r.payback, 0.8543, 4);
  });
  it('18x sem acrescimo = 179.980 / 18 = 9.998,89', () => perto(c.pg.cartao.parcela, 9998.8889, 3));
  it('96x Price com 4 meses de carencia = 3.752,25 (nao depende das recargas)', () => {
    // 179.980 x 1,0149^4 x 0,0149 / (1 - 1,0149^-96)
    perto(c.pg.fin.parcela, 3752.2478, 3);
  });
  it('o mesmo posto com 10 recargas por dia (so 1 carro por carregador editado para baixo): lucro 9.796,42', () => {
    const d = C.calcular({ equip: { quantidade: 2, preco: 89990 }, itens: [], prem: { custoKwh: C.CUSTO_KWH_SOLAR } });
    perto(d.r.lucroMes, 9796.4167, 3);
  });
});

describe('NexusCalc: lucro negativo, payback "nao se paga"', () => {
  it('posto parado (0 carros): lucro = -(200 + 200 + seguro 58,325) = -458,325/mes e nenhum payback', () => {
    // 1x DC 80 kW a 69.990, seguro/mes = 69.990 x 0,01 / 12 = 58,325
    const c = C.calcular({ equip: { quantidade: 1, preco: 69990 }, itens: [], prem: { carros: 0 } });
    perto(c.r.fatMes, 0);
    perto(c.r.lucroMes, -458.325, 3);
    expect(c.r.payback).toBeNull();
    expect(c.r.tir).toBeNull();
    expect(c.paybackPleno).toBeNull();
    expect(c.r.acumulado10).toBeLessThan(-69990);
    expect(C.anos1(c.r.payback)).toBe('Não se paga em 10 anos');
    expect(C.pct1(c.r.tir)).toBe('Indisponível');
  });

  it('1 carro por dia: lucro positivo (336,32/mes) mas pequeno demais, sem payback em 10 anos', () => {
    // fat = 600 x 2,35 + 30 x 1,20 = 1.446; custos = 420 + 231,36 + 458,325 = 1.109,685; lucro = 336,315
    const c = C.calcular({ equip: { quantidade: 1, preco: 69990 }, itens: [], prem: { carros: 1 } });
    perto(c.r.lucroMes, 336.315, 3);
    expect(c.r.payback).toBeNull();
    expect(c.paybackPleno).toBeGreaterThan(100);
  });
});

describe('NexusCalc: pagamento', () => {
  it('cartao em 18x sem acrescimo por padrao: 99.990 / 18 = 5.555,00; 69.990 / 18 = 3.888,33; 89.990 / 18 = 4.999,44', () => {
    expect(C.CARTAO_ACRESCIMO_PADRAO).toBe(0);
    expect(C.ORC_ENTRADA_PARC).toBe(18);
    perto(C.pagamento(99990, {}).cartao.parcela, 5555.0);
    perto(C.pagamento(69990, {}).cartao.parcela, 3888.33);
    perto(C.pagamento(89990, {}).cartao.parcela, 4999.44);
  });

  it('acrescimo editavel e' + " TOTAL sobre o restante: (99.990 - 10.000) x 1,225 / 18 = 6.124,38", () => {
    const p = C.pagamento(99990, { cartaoEntrada: '10.000,00', cartaoJuros: 22.5 }).cartao;
    perto(p.restante, 89990);
    perto(p.parcela, (89990 * 1.225) / 18, 6);
    perto(p.parcela, 6124.3, 1);
  });

  it('financiamento: R$ 99.990 em 96x com 120 dias de carencia a 1,49% a.m. = 2.084,605 (a tela arredonda para 2.084,61)', () => {
    // saldo apos a carencia = 99.990 x 1,0149^4 = 106.082,2 ; i / (1 - (1+i)^-96) com i = 0,0149
    // parcela = 106.082,2 x 0,0149 / (1 - 1,0149^-96) = 2.084,6053
    // A especificacao e o canvas dizem 2.084,60: e' a mesma conta truncada. Arredondando, como o /gerador, sai 2.084,61.
    const f = C.pagamento(99990, {}).fin;
    expect(f.parcelas).toBe(96);
    expect(f.taxa).toBe(1.49);
    expect(f.carenciaDias).toBe(120);
    expect(f.carencia).toBe(4);
    perto(f.parcela, 2084.6053, 3);
    perto(f.parcela, 2084.6, 1);
    expect(C.moeda2(f.parcela)).toBe('R$ 2.084,61');
    perto(C.pmtPriceCarencia(99990, 0.0149, 96, 4), 2084.6053, 3);
  });

  it('mesma formula do /gerador (pmtPriceCarencia): saldo x i / (1 - (1+i)^-n), com saldo = pv x (1+i)^carencia', () => {
    const pv = 50000, i = 0.022, n = 36, k = 4;
    const esperado = (pv * Math.pow(1 + i, k) * i) / (1 - Math.pow(1 + i, -n));
    expect(C.pmtPriceCarencia(pv, i, n, k)).toBeCloseTo(esperado, 8);
    expect(C.pmtPriceCarencia(0, i, n, k)).toBe(0);
  });

  it('entrada reduz o valor financiado; carencia vem de dias (60 dias = 2 meses)', () => {
    const f = C.pagamento(99990, { finEntrada: '20.000,00', finCarenciaDias: 60 }).fin;
    perto(f.financiado, 79990);
    expect(f.carencia).toBe(2);
    perto(f.parcela, C.pmtPriceCarencia(79990, 0.0149, 96, 2), 6);
  });

  it('forma desligada some do resultado', () => {
    const p = C.pagamento(99990, { cartao: false, fin: false });
    expect(p.cartao).toBeNull();
    expect(p.fin).toBeNull();
    expect(p.vista.valor).toBe(99990);
  });
});

describe('NexusCalc: validade e nome do arquivo', () => {
  it('quarta 21/10/2026 12h de Brasilia: a proxima sexta 18h e' + ' 23/10/2026', () => {
    const quarta = new Date('2026-10-21T15:00:00Z');
    const sexta = C.proximaSexta18(quarta);
    expect(sexta.toISOString()).toBe('2026-10-23T21:00:00.000Z');
    expect(C.validadeTexto({ modo: 'sexta' }, quarta)).toBe('Válido até sexta, 23/10/2026, às 18h');
  });

  it('validade por dias', () => {
    expect(C.validadeTexto({ modo: 'dias', dias: 5 }, new Date('2026-10-21T15:00:00Z'))).toBe('Válido por 5 dias · até 26/10/2026');
  });

  it('nome do arquivo sem acento nem espaco', () => {
    expect(C.nomeArquivo('completo', 'João da Silva Ltda', '20260012')).toBe('Proposta-Eletroposto-JoaodaSilvaLtda-20260012');
    expect(C.nomeArquivo('basico', 'Posto Exemplo', '20260012')).toBe('Orcamento-Basico-Eletroposto-PostoExemplo-20260012');
    expect(C.nomeArquivo('simulador', 'Hotel', '1')).toBe('Simulador-Eletroposto-Hotel-1');
  });

  it('textos padrao da entrega', () => {
    expect(C.ENTREGA_PADRAO).toBe('Entrega na primeira quinzena de dezembro');
    expect(C.INSTALACAO_PADRAO).toBe('Instalação combinada com o cliente depois da entrega');
  });
});
