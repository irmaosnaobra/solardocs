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
