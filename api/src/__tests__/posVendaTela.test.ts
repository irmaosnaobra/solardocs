import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// O pos-venda do eletroposto no /gerador e na Agenda: as funcoes puras de
// dashboard/public/gerador/pos-venda.js, carregadas num `window` falso.
const ARQ = join(__dirname, '../../../dashboard/public/gerador/pos-venda.js');

function carregar(): any {
  const w: any = {};
  vm.runInNewContext(readFileSync(ARQ, 'utf8'), { window: w, Intl, Date, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, isNaN, RegExp, Error, Promise });
  return w.PosVenda;
}
const P = carregar();

const CAT = {
  modelos: [{ slug: 'meio_a_meio', rotulo: '50/50', papeis: 'x' }],
  etapas: {
    papeis: { rotulo: 'Papéis', dono: 'cliente', prazo_dias: 7 },
    obra: { rotulo: 'Obra civil e elétrica', dono: 'nos', prazo_dias: 30 },
    concluido: { rotulo: 'Concluído', dono: 'nos', prazo_dias: 0 },
  },
  trilhos: { meio_a_meio: ['papeis', 'obra', 'concluido'], '': ['papeis'] },
};

describe('parseValor', () => {
  const casos: Array<[string, number | null | 'NaN']> = [
    ['145.000', 145000], ['145.000,50', 145000.5], ['1.450.000', 1450000], ['145,5', 145.5],
    ['145.50', 145.5], ['145000', 145000], ['R$ 145.000,00', 145000], ['', null],
    ['70 mil', 'NaN'], ['-5', 'NaN'], ['1.2.3', 'NaN'],
    ['145.000.000', 'NaN'], ['100.000.000', 100000000], ['10R$20', 'NaN'],
    ['1,2,3', 'NaN'], ['1.234.56', 'NaN'],
  ];
  for (const [entrada, esperado] of casos) {
    it(`${JSON.stringify(entrada)} -> ${esperado}`, () => {
      const r = P.parseValor(entrada);
      if (esperado === 'NaN') expect(Number.isNaN(r)).toBe(true);
      else expect(r).toBe(esperado);
    });
  }
});

describe('resumo', () => {
  it('atrasada conta os dias certos', () => {
    const r = P.resumo({ modelo: 'meio_a_meio', etapa: 'obra', etapa_desde: '2026-10-05T15:00:00Z', previsto: '2026-10-07' }, CAT, '2026-10-10');
    expect(r.atrasoDias).toBe(3);
    expect(r.diasNaEtapa).toBe(5);
    expect(r.previstoBr).toBe('07/10');
    expect(r.faltaInformar).toBe(false);
    expect(r.etapaRot).toBe('Obra civil e elétrica');
    expect(r.donoRot).toBe('Nosso');
    expect(r.posicao).toBe(2);
    expect(r.total).toBe(3);
  });
  it('previsto de hoje ou do futuro nao atrasa', () => {
    expect(P.resumo({ modelo: 'meio_a_meio', etapa: 'obra', previsto: '2026-10-10' }, CAT, '2026-10-10').atrasoDias).toBe(0);
    expect(P.resumo({ modelo: 'meio_a_meio', etapa: 'obra', previsto: '2026-10-20' }, CAT, '2026-10-10').atrasoDias).toBe(0);
  });
  it('concluido nunca atrasa', () => {
    const r = P.resumo({ modelo: 'meio_a_meio', etapa: 'concluido', previsto: '2026-01-01' }, CAT, '2026-10-10');
    expect(r.concluido).toBe(true);
    expect(r.atrasoDias).toBe(0);
  });
  it('sem registro ou com modelo vazio falta informar', () => {
    expect(P.resumo(null, CAT, '2026-10-10').faltaInformar).toBe(true);
    expect(P.resumo({ modelo: '', etapa: 'papeis' }, CAT, '2026-10-10').faltaInformar).toBe(true);
    expect(P.resumo({ modelo: 'meio_a_meio', etapa: 'papeis' }, CAT, '2026-10-10').faltaInformar).toBe(false);
  });
});

describe('proximaEtapa', () => {
  it('no meio do trilho devolve a seguinte', () => {
    expect(P.proximaEtapa({ modelo: 'meio_a_meio', etapa: 'papeis' }, CAT)).toBe('obra');
  });
  it('na ultima devolve null', () => {
    expect(P.proximaEtapa({ modelo: 'meio_a_meio', etapa: 'concluido' }, CAT)).toBeNull();
  });
  it('etapa fora do trilho devolve null', () => {
    expect(P.proximaEtapa({ modelo: 'meio_a_meio', etapa: 'inexistente' }, CAT)).toBeNull();
  });
  it('sem registro devolve null', () => {
    expect(P.proximaEtapa(null, CAT)).toBeNull();
  });
});

describe('mensagemErro', () => {
  const casos: Array<[string, string]> = [
    ['valor_invalido', 'Esse valor não foi aceito. Confira o número.'],
    ['etapa_fora_do_trilho', 'Essa etapa não existe neste modelo. Escolha outra.'],
    ['previsto_invalido', 'Essa data não foi aceita. Escolha outra.'],
    ['data_invalida', 'Essa data não foi aceita. Escolha outra.'],
    ['modelo_invalido', 'Esse modelo não foi aceito. Escolha de novo.'],
    ['texto_invalido', 'Esse texto não foi aceito. Escreva de novo.'],
  ];
  for (const [codigo, msg] of casos) {
    it(codigo, () => expect(P.mensagemErro({ codigo })).toBe(msg));
  }
  it('qualquer outro codigo, ou erro sem codigo, cai na mensagem geral', () => {
    const geral = 'Não deu para salvar o pós-venda. Tente de novo.';
    expect(P.mensagemErro({ codigo: 'sei_la' })).toBe(geral);
    expect(P.mensagemErro(new Error('x'))).toBe(geral);
    expect(P.mensagemErro(null)).toBe(geral);
  });
});

describe('gravar', () => {
  it('o erro da API vira Error com status e codigo (aceita error e erro)', async () => {
    const w: any = {};
    const falso = (corpo: any) => async () => ({ ok: false, status: 400, json: async () => corpo });
    vm.runInNewContext(readFileSync(ARQ, 'utf8'), { window: w, fetch: falso({ error: 'valor_invalido' }), Intl, Date, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, isNaN, RegExp, Error, Promise });
    let e: any;
    try { await w.PosVenda.gravar('/_api', 1, { valor: 1 }); } catch (x) { e = x; }
    expect(e.status).toBe(400);
    expect(e.codigo).toBe('valor_invalido');
    const w2: any = {};
    vm.runInNewContext(readFileSync(ARQ, 'utf8'), { window: w2, fetch: falso({ erro: 'etapa_fora_do_trilho' }), Intl, Date, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, isNaN, RegExp, Error, Promise });
    try { await w2.PosVenda.gravar('/_api', 1, {}); } catch (x) { e = x; }
    expect(e.codigo).toBe('etapa_fora_do_trilho');
  });
});

describe('dataDaVendaNoHistorico', () => {
  it('le o carimbo da linha de status e da venda registrada', () => {
    expect(P.dataDaVendaNoHistorico('[03/10 09h15 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', '2026-10-10')).toBe('2026-10-03');
    expect(P.dataDaVendaNoHistorico('[04/10 10h00 · Giovanna] 🏆 Venda registrada: R$ 90.000,00 (proposta X). O card estava em NEGOCIANDO.', '2026-10-10')).toBe('2026-10-04');
  });
  it('o ano vira: 28/12 visto em janeiro e do ano anterior', () => {
    expect(P.dataDaVendaNoHistorico('[28/12 08h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', '2027-01-05')).toBe('2026-12-28');
    expect(P.dataDaVendaNoHistorico('[05/01 08h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', '2027-01-05')).toBe('2027-01-05');
  });
  it('venda desfeita e refeita pega a ultima marcacao, em qualquer ordem do texto', () => {
    const topo = '[09/10 10h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.\n\n[08/10 10h00 · Diego] 🏷️ Status: VENDIDO → AGENDADO.\n\n[02/10 10h00 · Diego] 🏷️ Status: NEGOCIANDO → VENDIDO.';
    expect(P.dataDaVendaNoHistorico(topo, '2026-10-10')).toBe('2026-10-09');
    const invertido = topo.split('\n\n').reverse().join('\n\n');
    expect(P.dataDaVendaNoHistorico(invertido, '2026-10-10')).toBe('2026-10-09');
  });
  it('venda desfeita, nota solta e texto vazio nao contam', () => {
    expect(P.dataDaVendaNoHistorico('[08/10 10h00 · Diego] 🏷️ Status: VENDIDO → AGENDADO.', '2026-10-10')).toBeNull();
    expect(P.dataDaVendaNoHistorico('[08/10 10h00 · Diego] cliente disse que vai VENDIDO', '2026-10-10')).toBeNull();
    expect(P.dataDaVendaNoHistorico('[08/10 10h00 · Diego] Pós-venda: Papéis → Obra.', '2026-10-10')).toBeNull();
    expect(P.dataDaVendaNoHistorico('', '2026-10-10')).toBeNull();
    expect(P.dataDaVendaNoHistorico(null, '2026-10-10')).toBeNull();
  });
});

describe('vendas', () => {
  const HOJE = '2026-10-10';
  it('o credito e do vendedor do card, mesmo com registro.por diferente', () => {
    const v = P.vendas([{ id: 1, cliente_nome: 'A', cidade: 'X', vendedor_nome: 'Diego' }],
      { 1: { modelo: 'meio_a_meio', valor: 90000, vendido_em: '2026-10-02', por: 'Giovanna' } }, HOJE);
    expect(v[0].consultor).toBe('Diego');
    expect(v[0]).toMatchObject({ id: '1', cliente: 'A', cidade: 'X', valor: 90000, modelo: 'meio_a_meio', dia: '2026-10-02', mes: '2026-10', temRegistro: true });
  });
  it('card sem vendedor vira "Sem consultor"', () => {
    expect(P.vendas([{ id: 1, vendedor_nome: '  ' }, { id: 2 }], {}, HOJE).map((x: any) => x.consultor)).toEqual(['Sem consultor', 'Sem consultor']);
  });
  it('venda sem valor tem valor null e modelo vazio quando nao ha registro', () => {
    const v = P.vendas([{ id: 1, vendedor_nome: 'Diego', historico: '[03/10 09h15 · Diego] 🏷️ Status: AGENDADO → VENDIDO.' }], {}, HOJE)[0];
    expect(v.valor).toBeNull();
    expect(v.modelo).toBe('');
    expect(v.temRegistro).toBe(false);
  });
  it('a data vem do registro; sem registro, do historico; depois de quando em Brasilia; depois de hoje', () => {
    const cards = [
      { id: 1, historico: '[01/10 09h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', quando: '2026-09-20T14:00:00-03:00' },
      { id: 2, historico: '[01/10 09h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.' },
      { id: 3, historico: 'sem linha de venda', quando: '2026-09-30T23:30:00-03:00' },
      { id: 4, historico: '' },
      { id: 5, historico: '', quando: '2026-12-20T14:00:00-03:00' },
    ];
    const v = P.vendas(cards, { 1: { vendido_em: '2026-08-15', valor: 1 } }, HOJE);
    expect(v.map((x: any) => x.dia)).toEqual(['2026-08-15', '2026-10-01', '2026-09-30', '2026-10-10', '2026-10-10']);
  });
  it('quando em UTC depois das 21h de Brasilia cai no dia de Brasilia', () => {
    const v = P.vendas([{ id: 1, quando: '2026-10-01T01:30:00Z' }], {}, HOJE)[0];
    expect(v.dia).toBe('2026-09-30');
  });
});

describe('resumoVendas, evolucaoMensal e mesesComVenda', () => {
  const HOJE = '2026-10-10';
  const V = (consultor: string, mes: string, valor: number | null) => ({ id: consultor + mes + valor, consultor, valor, mes, dia: mes + '-05' });
  const lista = [V('Diego', '2026-10', 100000), V('Diego', '2026-10', null), V('Nilce', '2026-07', 50000), V('Giovanna', '2026-10', 30000)];
  it('geral e mes: soma so do informado, ticket pelo que tem valor', () => {
    const r = P.resumoVendas(lista, HOJE);
    expect(r.geral).toEqual({ qtd: 4, valor: 180000, comValor: 3, semValor: 1, ticket: 60000 });
    expect(r.mes).toEqual({ qtd: 3, valor: 130000, comValor: 2, semValor: 1, ticket: 65000 });
  });
  it('ticket e null quando nenhuma venda tem valor; sem vendas tudo zera', () => {
    expect(P.resumoVendas([V('A', '2026-10', null)], HOJE).geral.ticket).toBeNull();
    expect(P.resumoVendas([], HOJE)).toEqual({
      geral: { qtd: 0, valor: 0, comValor: 0, semValor: 0, ticket: null },
      mes: { qtd: 0, valor: 0, comValor: 0, semValor: 0, ticket: null },
    });
  });
  it('evolucao preenche o mes vazio com zero, do primeiro mes ate o corrente', () => {
    expect(P.evolucaoMensal(lista, HOJE)).toEqual([
      { mes: '2026-07', qtd: 1, valor: 50000 }, { mes: '2026-08', qtd: 0, valor: 0 },
      { mes: '2026-09', qtd: 0, valor: 0 }, { mes: '2026-10', qtd: 3, valor: 130000 },
    ]);
    expect(P.evolucaoMensal([], HOJE)).toEqual([]);
  });
  it('evolucao vira o ano e fica nos 12 ultimos meses', () => {
    const ev = P.evolucaoMensal([V('A', '2025-01', 1)], '2027-02-10');
    expect(ev.length).toBe(12);
    expect(ev[0].mes).toBe('2026-03');
    expect(ev[11].mes).toBe('2027-02');
    expect(P.evolucaoMensal([V('A', '2026-12', 1)], '2027-01-05').map((x: any) => x.mes)).toEqual(['2026-12', '2027-01']);
  });
  it('mesesComVenda: distintos, do mais novo para o mais velho', () => {
    expect(P.mesesComVenda(lista)).toEqual(['2026-10', '2026-07']);
  });
});

describe('grafico mensal: evolucaoDetalhada, fmtBrlCompacto e escalaEixo', () => {
  const HOJE = '2026-10-10';
  const V = (mes: string, valor: number | null) => ({ id: mes + valor, consultor: 'A', valor, mes, dia: mes + '-05' });
  it('evolucaoDetalhada: ticket so das vendas com valor, e mes so sem valor tem ticket nulo', () => {
    const ev = P.evolucaoDetalhada([V('2026-08', 100000), V('2026-08', null), V('2026-10', null), V('2026-10', null)], HOJE);
    expect(ev).toEqual([
      { mes: '2026-08', qtd: 2, valor: 100000, comValor: 1, semValor: 1, ticket: 100000 },
      { mes: '2026-09', qtd: 0, valor: 0, comValor: 0, semValor: 0, ticket: null },
      { mes: '2026-10', qtd: 2, valor: 0, comValor: 0, semValor: 2, ticket: null },
    ]);
    expect(P.evolucaoDetalhada([], HOJE)).toEqual([]);
  });
  it('minMeses: completa para tras com zero, termina no mes corrente, no maximo 12', () => {
    const um = P.evolucaoMensal([V('2026-10', 5)], HOJE, 6);
    expect(um.map((x: any) => x.mes)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(um.slice(0, 5).every((x: any) => x.qtd === 0 && x.valor === 0)).toBe(true);
    expect(um[5]).toEqual({ mes: '2026-10', qtd: 1, valor: 5 });
    // virada de ano para tras
    expect(P.evolucaoMensal([V('2026-02', 1)], '2026-02-10', 6).map((x: any) => x.mes)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    // 8 meses de venda ficam 8; 15 meses ficam 12
    const oito = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => V(m, 1));
    expect(P.evolucaoMensal(oito, HOJE, 6).length).toBe(8);
    expect(P.evolucaoDetalhada(oito, HOJE, 6).length).toBe(8);
    const quinze = ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => V(m, 1));
    expect(P.evolucaoMensal(quinze, HOJE, 6).length).toBe(12);
    expect(P.evolucaoMensal(quinze, HOJE, 99).length).toBe(12);
    // nenhuma venda: vazio, com ou sem minMeses
    expect(P.evolucaoMensal([], HOJE, 6)).toEqual([]);
    expect(P.evolucaoDetalhada([], HOJE, 6)).toEqual([]);
    // sem o parametro (ou lixo), o comportamento antigo
    expect(P.evolucaoMensal([V('2026-10', 5)], HOJE).length).toBe(1);
    expect(P.evolucaoMensal([V('2026-10', 5)], HOJE, NaN).length).toBe(1);
  });
  it('evolucaoDetalhada com minMeses: mes completado vem zerado, com ticket nulo', () => {
    const ev = P.evolucaoDetalhada([V('2026-10', null)], HOJE, 6);
    expect(ev.length).toBe(6);
    expect(ev[0]).toEqual({ mes: '2026-05', qtd: 0, valor: 0, comValor: 0, semValor: 0, ticket: null });
    expect(ev[5]).toEqual({ mes: '2026-10', qtd: 1, valor: 0, comValor: 0, semValor: 1, ticket: null });
  });
  it('evolucaoMensal segue com o mesmo formato (sem campos a mais)', () => {
    expect(P.evolucaoMensal([V('2026-10', 5)], HOJE)).toEqual([{ mes: '2026-10', qtd: 1, valor: 5 }]);
  });
  it('fmtBrlCompacto: unidade, mil, mi e as viradas', () => {
    const f = (n: number) => P.fmtBrlCompacto(n);
    expect(f(0)).toBe('R$ 0');
    expect(f(999)).toBe('R$ 999');
    expect(f(999.4)).toBe('R$ 999');
    expect(f(1000)).toBe('R$ 1 mil');
    expect(f(1500)).toBe('R$ 1,5 mil');
    expect(f(9949)).toBe('R$ 9,9 mil');
    expect(f(9950)).toBe('R$ 10 mil');
    expect(f(145000)).toBe('R$ 145 mil');
    expect(f(999499)).toBe('R$ 999 mil');
    expect(f(999500)).toBe('R$ 1 mi');
    expect(f(1e6)).toBe('R$ 1 mi');
    expect(f(1.2e6)).toBe('R$ 1,2 mi');
    expect(f(1.25e6)).toBe('R$ 1,3 mi');
    expect(f(150e6)).toBe('R$ 150 mi');
    expect(f(1234e6)).toBe('R$ 1.234 mi');
  });
  it('fmtBrlCompacto: sem prefixo, negativo e lixo', () => {
    expect(P.fmtBrlCompacto(145000, true)).toBe('145 mil');
    expect(P.fmtBrlCompacto(-2500)).toBe('-R$ 2,5 mil');
    expect(P.fmtBrlCompacto(NaN)).toBe('R$ 0');
    expect(P.fmtBrlCompacto(undefined)).toBe('R$ 0');
  });
  it('escalaEixo: no maximo 3 linhas, topo cobre o maximo, contagem so em inteiro', () => {
    expect(P.escalaEixo(0, true)).toEqual({ topo: 0, passo: 0, ticks: [] });
    expect(P.escalaEixo(NaN, false).ticks).toEqual([]);
    expect(P.escalaEixo(1, true).ticks).toEqual([1]);
    expect(P.escalaEixo(3, true).ticks).toEqual([1, 2, 3]);
    expect(P.escalaEixo(4, true).ticks).toEqual([2, 4]);
    expect(P.escalaEixo(7, true).ticks).toEqual([5, 10]);
    for (const m of [1, 2, 3, 4, 5, 7, 9, 12, 13, 29, 101]) {
      const e = P.escalaEixo(m, true);
      expect(e.ticks.length).toBeGreaterThan(0);
      expect(e.ticks.length).toBeLessThanOrEqual(3);
      expect(e.topo).toBeGreaterThanOrEqual(m);
      e.ticks.forEach((t: number) => expect(Number.isInteger(t)).toBe(true));
    }
    expect(P.escalaEixo(145000, false).ticks).toEqual([50000, 100000, 150000]);
    expect(P.escalaEixo(0.5, false).ticks.length).toBeLessThanOrEqual(3);
  });
});

describe('rankingVendas', () => {
  const V = (consultor: string, mes: string, valor: number | null) => ({ consultor, valor, mes });
  it('ordem: vendas, valor, em negociacao, nome', () => {
    const vendas = [V('Bia', '2026-10', 10), V('Ana', '2026-10', 10), V('Caio', '2026-10', 10), V('Dora', '2026-10', 10), V('Eva', '2026-10', 30)];
    const neg = [{ vendedor_nome: 'Dora' }, { vendedor_nome: 'Dora' }, { vendedor_nome: 'Caio' }];
    const r = P.rankingVendas(vendas, neg, '2026-10');
    expect(r.map((x: any) => x.consultor)).toEqual(['Eva', 'Dora', 'Caio', 'Ana', 'Bia']);
    expect(r[1].negociando).toBe(2);
  });
  it('mais vendas vence mais dinheiro', () => {
    const r = P.rankingVendas([V('A', '2026-10', 1), V('A', '2026-10', 1), V('B', '2026-10', 999999)], [], '2026-10');
    expect(r.map((x: any) => x.consultor)).toEqual(['A', 'B']);
  });
  it('periodo filtra o mes; tudo soma todos; negociando e igual em qualquer periodo', () => {
    const vendas = [V('A', '2026-10', 100), V('A', '2026-09', 50), V('B', '2026-09', null)];
    const neg = [{ vendedor_nome: 'A' }];
    const out = P.rankingVendas(vendas, neg, '2026-10');
    expect(out).toEqual([{ consultor: 'A', vendas: 1, valor: 100, semValor: 0, negociando: 1 }]);
    const set = P.rankingVendas(vendas, neg, '2026-09');
    expect(set.find((x: any) => x.consultor === 'A')).toMatchObject({ vendas: 1, valor: 50, negociando: 1 });
    expect(set.find((x: any) => x.consultor === 'B')).toMatchObject({ vendas: 1, valor: 0, semValor: 1, negociando: 0 });
    const tudo = P.rankingVendas(vendas, neg, 'tudo');
    expect(tudo[0]).toMatchObject({ consultor: 'A', vendas: 2, valor: 150, negociando: 1 });
  });
  it('quem so tem card em negociacao entra, com zero venda; sem vendedor vira "Sem consultor"', () => {
    const r = P.rankingVendas([V('A', '2026-10', 1)], [{ vendedor_nome: 'Z' }, { vendedor_nome: '' }], '2026-10');
    expect(r.map((x: any) => x.consultor)).toEqual(['A', 'Sem consultor', 'Z']);
    expect(r[2]).toMatchObject({ vendas: 0, valor: 0, negociando: 1 });
  });
});

describe('rotuloMes', () => {
  it('o mesmo formato dos botoes do ranking do solar', () => {
    expect(P.rotuloMes('2026-10')).toBe('out/26');
    expect(P.rotuloMes('2027-01')).toBe('jan/27');
  });
});

describe('dataDaVendaNoHistorico: casos da revisao', () => {
  const HOJE = '2026-10-10';
  it('a linha REAL de status, com o sufixo de modelo e valor', () => {
    const l = '[03/10 09h15 · Diego] 🏷️ Status: AGENDADO → VENDIDO. Modelo: Chave na mão. Valor: R$ 145.000,00.';
    expect(P.dataDaVendaNoHistorico(l, HOJE)).toBe('2026-10-03');
  });
  it('VENDIDO → VENDIDO depois de uma venda antiga: pega a antiga', () => {
    const t = '[09/10 10h00 · Diego] 🏷️ Status: VENDIDO → VENDIDO. Modelo: 50/50.\n\n[02/10 10h00 · Diego] 🏷️ Status: NEGOCIANDO → VENDIDO.';
    expect(P.dataDaVendaNoHistorico(t, HOJE)).toBe('2026-10-02');
    expect(P.dataDaVendaNoHistorico('[09/10 10h00 · Diego] 🏷️ Status: VENDIDO → VENDIDO.', HOJE)).toBeNull();
  });
  it('29/02 vale em ano bissexto', () => {
    expect(P.dataDaVendaNoHistorico('[29/02 10h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', '2028-03-10')).toBe('2028-02-29');
  });
  it('dia futuro no mesmo mes: ate 2 dias vira hoje, depois disso e do ano anterior', () => {
    expect(P.dataDaVendaNoHistorico('[11/10 10h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', HOJE)).toBe('2026-10-10');
    expect(P.dataDaVendaNoHistorico('[12/10 10h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', HOJE)).toBe('2026-10-10');
    expect(P.dataDaVendaNoHistorico('[13/10 10h00 · Diego] 🏷️ Status: AGENDADO → VENDIDO.', HOJE)).toBe('2025-10-13');
  });
  it('"Venda desmarcada" nao conta', () => {
    expect(P.dataDaVendaNoHistorico('[08/10 10h00 · Diego] ↩️ Venda desmarcada (proposta X). O card voltou pra AGENDADO.', HOJE)).toBeNull();
  });
});

describe('gravar: null em por, responsavel e obs', () => {
  async function corpoEnviado(campos: any) {
    const w: any = {};
    let corpo: any = null;
    const fetchFalso = async (_u: string, o: any) => { corpo = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ ok: true, registro: {} }) }; };
    vm.runInNewContext(readFileSync(ARQ, 'utf8'), { window: w, fetch: fetchFalso, Intl, Date, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, isNaN, RegExp, Error, Promise });
    await w.PosVenda.gravar('/_api', 7, campos);
    return corpo;
  }
  it('por, responsavel e obs null saem do corpo', async () => {
    expect(await corpoEnviado({ por: null, responsavel: null, obs: null, modelo: 'meio_a_meio' })).toEqual({ id: 7, modelo: 'meio_a_meio' });
  });
  it('valor e previsto null continuam indo (limpar)', async () => {
    expect(await corpoEnviado({ valor: null, previsto: null, por: 'Diego' })).toEqual({ id: 7, valor: null, previsto: null, por: 'Diego' });
  });
});
