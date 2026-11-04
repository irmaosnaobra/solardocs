import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../services/templateService';
import { inversoresDaProposta, totalKwInversores, marcasInversorDasPropostas } from '../services/inversoresProposta';

// Vários inversores na proposta solar: lista `inversores` no dados_json, com os
// campos soltos (qtd_inversores, marca_inversor...) espelhando a primeira linha.
// Proposta antiga só tem os campos soltos e tem que sair byte a byte igual.

const company: any = {
  nome: 'CMO ENERGIA SOLAR LTDA', nome_fantasia: 'CMO ENERGIA SOLAR', cnpj: '12345678000190',
  endereco: 'AVENIDA ALCEBÍADES BERNARDO, 738', socio_adm: 'Jair', whatsapp: '5517996803659',
};
const client: any = { nome: 'Fulano de Tal', cidade: 'Uberlândia', uf: 'MG' };
const EMISSAO = '2026-10-21T15:00:00.000Z';
const base: Record<string, unknown> = {
  cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '450', qtd_modulos: '10', potencia_modulo: '620',
  marca_modulo: 'Canadian', investimento: '22000', taxa_minima: '90', tarifa_kwh: '1,20', emitido_em: EMISSAO,
};
const solta = { ...base, qtd_inversores: '1', marca_inversor: 'Growatt', potencia_inversor: '5', garantia_inversor: '10' };
const umaLinha = {
  ...solta,
  inversores: [{ qtd: '1', marca: 'Growatt', potencia: '5', garantia: '10' }],
};
const duas = {
  ...base, qtd_inversores: '1', marca_inversor: 'Growatt', potencia_inversor: '8', garantia_inversor: '10',
  inversores: [
    { qtd: '1', marca: 'Growatt', potencia: '8', garantia: '10' },
    { qtd: '1', marca: 'Deye', potencia: '5', garantia: '10' },
  ],
};
const duasGarantiasDiferentes = {
  ...duas,
  inversores: [
    { qtd: '1', marca: 'Growatt', potencia: '8', garantia: '10' },
    { qtd: '1', marca: 'Deye', potencia: '5', garantia: '5' },
  ],
};

function render(fix: Record<string, unknown>, modelo: 1 | 2 | 3) {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaSolar', company, client, { ...fix }, modelo, out);
  return { html, resumo: out.resumo ?? '' };
}

describe('inversoresDaProposta', () => {
  it('só campos soltos: uma linha, com os padrões de sempre', () => {
    const l = inversoresDaProposta({ qtd_inversores: '2', marca_inversor: ' Growatt ', potencia_inversor: '1,875', garantia_inversor: '12' });
    expect(l).toEqual([{ qtd: 2, marca: 'Growatt', marcaCrua: ' Growatt ', potenciaKw: 1.875, potenciaTxt: '1,875', garantiaAnos: 12 }]);
  });

  it('campos soltos vazios: qtd 1, garantia 10, potência 0', () => {
    const l = inversoresDaProposta({});
    expect(l).toEqual([{ qtd: 1, marca: '', marcaCrua: '', potenciaKw: 0, potenciaTxt: '', garantiaAnos: 10 }]);
  });

  it('potência com ponto vira vírgula no texto e vale o mesmo número', () => {
    const [i] = inversoresDaProposta({ potencia_inversor: '1.875' });
    expect(i.potenciaTxt).toBe('1,875');
    expect(i.potenciaKw).toBe(1.875);
  });

  it('lista: devolve as linhas, "1,875" vira 1.875', () => {
    const l = inversoresDaProposta({
      qtd_inversores: '1', marca_inversor: 'Growatt', potencia_inversor: '8',
      inversores: [
        { qtd: '2', marca: 'Growatt', potencia: '1,875', garantia: '12' },
        { qtd: '1', marca: 'Deye', potencia: '5', garantia: '5' },
      ],
    });
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ qtd: 2, marca: 'Growatt', potenciaKw: 1.875, potenciaTxt: '1,875', garantiaAnos: 12 });
    expect(l[1]).toMatchObject({ qtd: 1, marca: 'Deye', potenciaKw: 5, garantiaAnos: 5 });
  });

  it('linhas com marca e potência vazias são puladas', () => {
    const l = inversoresDaProposta({
      inversores: [
        { qtd: '1', marca: '', potencia: '', garantia: '10' },
        { qtd: '1', marca: '  ', potencia: ' ', garantia: '10' },
        { qtd: '1', marca: 'Deye', potencia: '', garantia: '10' },
        { qtd: '1', marca: '', potencia: '5', garantia: '10' },
      ],
    });
    expect(l.map((i) => i.marca)).toEqual(['Deye', '']);
    expect(l[1].potenciaKw).toBe(5);
  });

  it('só linhas vazias: cai nos campos soltos', () => {
    const l = inversoresDaProposta({ marca_inversor: 'Solis', inversores: [{ marca: '', potencia: '' }] });
    expect(l).toHaveLength(1);
    expect(l[0].marca).toBe('Solis');
  });

  it('garantia vazia na linha cai para a dos campos soltos e depois para 10', () => {
    const a = inversoresDaProposta({ garantia_inversor: '7', inversores: [{ marca: 'A', potencia: '1', garantia: '' }, { marca: 'B', potencia: '1', garantia: '3' }] });
    expect(a.map((i) => i.garantiaAnos)).toEqual([7, 3]);
    const b = inversoresDaProposta({ inversores: [{ marca: 'A', potencia: '1' }] });
    expect(b[0].garantiaAnos).toBe(10);
  });

  it('qtd vazia na linha vale 1', () => {
    const [i] = inversoresDaProposta({ inversores: [{ qtd: '', marca: 'A', potencia: '1' }] });
    expect(i.qtd).toBe(1);
  });

  it('inversores torto (string, null, número, objeto) cai nos campos soltos sem quebrar', () => {
    for (const torto of ['abc', null, 7, {}, true]) {
      const l = inversoresDaProposta({ marca_inversor: 'Solis', potencia_inversor: '3', inversores: torto });
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ marca: 'Solis', potenciaKw: 3 });
    }
  });

  it('itens que não são objeto e valores que não são texto são ignorados', () => {
    const l = inversoresDaProposta({
      inversores: [null, 'x', 5, [], { marca: { a: 1 }, potencia: ['2'] }, { marca: 'Deye', potencia: 5, qtd: 2, garantia: 8 }],
    });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ marca: 'Deye', potenciaKw: 5, qtd: 2, garantiaAnos: 8 });
  });

  it('totalKwInversores soma qtd × potência', () => {
    const l = inversoresDaProposta({
      inversores: [{ qtd: '2', marca: 'A', potencia: '1,875' }, { qtd: '1', marca: 'B', potencia: '5' }],
    });
    expect(totalKwInversores(l)).toBeCloseTo(8.75, 6);
    expect(totalKwInversores([])).toBe(0);
  });
});

describe('marcasInversorDasPropostas', () => {
  it('tira repetida sem diferenciar maiúscula e guarda a primeira grafia', () => {
    const r = marcasInversorDasPropostas([
      { dados_json: { marca_inversor: 'Growatt' } },
      { dados_json: { marca_inversor: ' GROWATT ' } },
      { dados_json: { marca_inversor: 'deye' } },
      { dados_json: { marca_inversor: 'Deye' } },
    ]);
    expect(r).toEqual(['Growatt', 'deye']);
  });

  it('segue a ordem dos docs e lê a lista antes do campo solto', () => {
    const r = marcasInversorDasPropostas([
      { dados_json: { marca_inversor: 'Growatt', inversores: [{ marca: 'Growatt' }, { marca: 'Deye' }] } },
      { dados_json: { marca_inversor: 'Solis' } },
      { dados_json: { inversores: [{ marca: 'Sungrow' }] } },
    ]);
    expect(r).toEqual(['Growatt', 'Deye', 'Solis', 'Sungrow']);
  });

  it('a lista vem antes do campo solto dentro do mesmo doc', () => {
    const r = marcasInversorDasPropostas([{ dados_json: { marca_inversor: 'Primeira', inversores: [{ marca: 'Segunda' }] } }]);
    expect(r).toEqual(['Segunda', 'Primeira']);
  });

  it('pula vazias', () => {
    const r = marcasInversorDasPropostas([{ dados_json: { marca_inversor: '  ', inversores: [{ marca: '' }, { marca: 'Deye' }] } }]);
    expect(r).toEqual(['Deye']);
  });

  it('teto de 30', () => {
    const docs = Array.from({ length: 45 }, (_, n) => ({ dados_json: { marca_inversor: `Marca ${n}` } }));
    const r = marcasInversorDasPropostas(docs);
    expect(r).toHaveLength(30);
    expect(r[0]).toBe('Marca 0');
    expect(r[29]).toBe('Marca 29');
  });

  it('teto de 30 também dentro de uma lista grande', () => {
    const r = marcasInversorDasPropostas([{ dados_json: { inversores: Array.from({ length: 40 }, (_, n) => ({ marca: `M${n}` })) } }]);
    expect(r).toHaveLength(30);
  });

  it('dados_json torto nunca lança', () => {
    const torto: any[] = [
      { dados_json: null }, { dados_json: undefined }, { dados_json: 'texto' }, { dados_json: 5 }, { dados_json: [] },
      { dados_json: { inversores: 'x', marca_inversor: 7 } }, { dados_json: { inversores: [null, 3, 'a', { marca: {} }], marca_inversor: {} } },
      {}, null, undefined, 'x',
    ];
    expect(() => marcasInversorDasPropostas(torto)).not.toThrow();
    expect(marcasInversorDasPropostas(torto)).toEqual(['7']);
    expect(marcasInversorDasPropostas(null as any)).toEqual([]);
  });
});

describe('proposta com uma linha: idêntica à de campos soltos (propostas antigas)', () => {
  for (const modelo of [1, 2, 3] as const) {
    it(`modelo ${modelo}: HTML e resumo byte a byte iguais`, () => {
      const a = render(solta, modelo);
      const b = render(umaLinha, modelo);
      expect(b.html).toBe(a.html);
      expect(b.resumo).toBe(a.resumo);
    });
  }

  it('com marca suja e potência decimal também', () => {
    const suja = { ...base, qtd_inversores: '2', marca_inversor: ' Gro&watt ', potencia_inversor: '1.875', garantia_inversor: '1' };
    const lista = { ...suja, inversores: [{ qtd: '2', marca: ' Gro&watt ', potencia: '1.875', garantia: '1' }] };
    for (const modelo of [1, 2, 3] as const) {
      const a = render(suja, modelo);
      const b = render(lista, modelo);
      expect(b.html).toBe(a.html);
      expect(b.resumo).toBe(a.resumo);
    }
  });

  it('sem nenhum campo de inversor também não muda', () => {
    const vazio = { ...base };
    const lista = { ...base, inversores: [] };
    for (const modelo of [1, 2, 3] as const) {
      expect(render(lista, modelo).html).toBe(render(vazio, modelo).html);
    }
  });

  it('o texto de hoje continua lá', () => {
    expect(render(solta, 2).html).toContain('1× Growatt 5 kW');
    expect(render(solta, 1).html).toContain('Incluído · 1 un');
    expect(render(solta, 2).resumo).toContain('1x Growatt 5K');
  });

  // Trechos LITERAIS tirados da saída do código anterior a esta mudança (templateService
  // do HEAD de 04/11/2026), fixture 1× Growatt 5 kW, garantia 10. Prova contra o passado:
  // soltos x lista de 1 linha passaria mesmo se os dois mudassem juntos.
  const TRECHOS_HEAD = {
    inversor1Pagina: '<div class="r"><span class="lab">Inversor <em class="mkq">Growatt · 5 kW</em></span><span class="inc">Incluído · 1 un</span></div>',
    garantias1Pagina: '<div class="r"><span class="lab">Garantias (painéis 25 anos · inversor 10 anos)</span><span class="inc">Incluído</span></div>',
    specModerno: '<div class="spec-label">Inversor</div>\n        <div class="spec-value">1× Growatt 5 kW</div>',
    seloModerno: '<div class="garantia"><div class="garantia-num">10</div><div class="garantia-label">anos<br/>inversor</div></div>',
    resumoSistema: '* 10x Canadian 620W + 1x Growatt 5K',
    resumoGarantia: '* Inversor: 10 anos',
  };
  for (const [nome, fix] of [['campos soltos', solta], ['lista de 1 linha', umaLinha]] as const) {
    it(`trechos fixos do código anterior (${nome})`, () => {
      const m1 = render(fix, 1).html;
      expect(m1).toContain(TRECHOS_HEAD.inversor1Pagina);
      expect(m1).toContain(TRECHOS_HEAD.garantias1Pagina);
      for (const modelo of [2, 3] as const) {
        const m = render(fix, modelo).html;
        expect(m).toContain(TRECHOS_HEAD.specModerno);
        expect(m).toContain(TRECHOS_HEAD.seloModerno);
      }
      for (const modelo of [1, 2, 3] as const) {
        const { resumo } = render(fix, modelo);
        expect(resumo).toContain(TRECHOS_HEAD.resumoSistema);
        expect(resumo).toContain(TRECHOS_HEAD.resumoGarantia);
      }
    });
  }
});

describe('proposta com dois inversores', () => {
  it('modelos 2 e 3: as duas marcas, juntas por " + "', () => {
    for (const modelo of [2, 3] as const) {
      const { html } = render(duas, modelo);
      expect(html).toContain('1× Growatt 8 kW + 1× Deye 5 kW');
    }
  });

  it('modelo 1 (1 página): uma linha por inversor e a potência total', () => {
    const { html } = render(duas, 1);
    expect(html).toContain('Growatt · 8 kW');
    expect(html).toContain('Deye · 5 kW');
    expect(html.match(/<span class="lab">Inversor <em/g)).toHaveLength(2);
    expect(html).toContain('Potência total dos inversores');
    expect(html).toMatch(/Potência total dos inversores<\/span><span class="inc">13 kW<\/span>/);
  });

  it('potência total com casas decimais em pt-BR', () => {
    const f = { ...duas, inversores: [{ qtd: '2', marca: 'A', potencia: '1,875', garantia: '10' }, { qtd: '1', marca: 'B', potencia: '5', garantia: '10' }] };
    expect(render(f, 1).html).toMatch(/Potência total dos inversores<\/span><span class="inc">8,75 kW<\/span>/);
  });

  it('resumo do WhatsApp traz as duas, no formato de hoje', () => {
    for (const modelo of [1, 2, 3] as const) {
      const { resumo } = render(duas, modelo);
      expect(resumo).toContain('1x Growatt 8K + 1x Deye 5K');
    }
  });

  it('garantias iguais: texto de sempre', () => {
    const m1 = render(duas, 1).html;
    expect(m1).toContain('Garantias (painéis 25 anos · inversor 10 anos)');
    expect(render(duas, 2).resumo).toContain('* Inversor: 10 anos');
  });

  it('garantias 10 e 5: o selo mostra 5, o menor', () => {
    const { html } = render(duasGarantiasDiferentes, 2);
    expect(html).toMatch(/<div class="garantia-num">5<\/div><div class="garantia-label">anos<br\/>inversor<\/div>/);
    expect(html).not.toMatch(/<div class="garantia-num">10<\/div><div class="garantia-label">anos<br\/>inversor<\/div>/);
  });

  it('garantias diferentes: 1 página e resumo dizem o prazo de cada marca', () => {
    expect(render(duasGarantiasDiferentes, 1).html).toContain('Garantias (painéis 25 anos · inversores Growatt 10 anos, Deye 5 anos)');
    const { resumo } = render(duasGarantiasDiferentes, 2);
    expect(resumo).toContain('* Inversores: Growatt 10 anos, Deye 5 anos');
    expect(resumo).not.toContain('* Inversor: ');
  });

  it('a marca é escapada em cada lugar', () => {
    const f = { ...duas, inversores: [{ qtd: '1', marca: 'A<b>', potencia: '8', garantia: '10' }, { qtd: '1', marca: 'Deye', potencia: '5', garantia: '10' }] };
    for (const modelo of [1, 2, 3] as const) {
      const { html } = render(f, modelo);
      expect(html).not.toContain('A<b>');
      expect(html).toContain('A&lt;b&gt;');
    }
  });
});
