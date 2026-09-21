import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PRA ONDE CADA PESSOA VAI: Arrendamento, Investidores ou Curioso.
//
// A regra do dono (21/09/2026) mora em DOIS lugares: destinoDe() no servidor, que
// monta os pares e o Match, e cadDestino() na aba Cadastros do /gerador. Este teste
// cobre a tabela de destino linha a linha e depois LÊ o JavaScript da aba e roda os
// dois lado a lado. Se alguém mexer num só, ele aponta a resposta em que discordaram.
import { destinoDe, podeCeder, valorEmMil, valorOk, agruparPorDestino, PISO_INVESTIDOR_MIL, type LinhaOrigem } from '../services/io/eletropostoPares';

const GERADOR = join(__dirname, '../../../dashboard/public/gerador/index.html');

function regraDaTela() {
  const html = readFileSync(GERADOR, 'utf8');
  const de = 'function cadPodeCeder(', ate = 'const CAD_STATUS = {';
  const i = html.indexOf(de), j = html.indexOf(ate);
  // Marcador que sumiu = tela refatorada. Melhor um teste quebrado do que um que
  // passa sem comparar nada.
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu do /gerador: "${de}" … "${ate}"`);
  return new Function(html.slice(i, j) + '\nreturn { cadPodeCeder, cadValorEmMil, cadDestino, CAD_PISO_MIL };')() as {
    cadPodeCeder: (t: unknown) => boolean;
    cadValorEmMil: (t: unknown) => number | null;
    cadDestino: (origem: string, r: Record<string, unknown>) => string;
    CAD_PISO_MIL: number;
  };
}

// Todas as respostas que existem hoje nos formulários (cadastro e LP), mais o que
// chega escrito à mão no WhatsApp.
const RELACOES = [
  'Sou o proprietário', 'Administro o local', 'Represento o proprietário', 'Sou inquilino',
  'Estou negociando com o proprietário', 'Ainda não é meu · pretendo alugar ou comprar',
  'Ainda não é meu — pretendo alugar ou comprar', 'Tenho um local em vista, mas ainda não conversei',
  'Tenho um local em negociação com o proprietário', 'Não tenho ideia de onde instalar', '', null,
];
const VALORES = [
  'R$ 70 mil', 'R$ 140 mil', 'R$ 280 mil', 'R$ 500 mil', 'Mais de R$ 500 mil', 'Menos de R$ 70 mil',
  'Até R$ 50 mil', 'R$ 50 mil a R$ 100 mil', 'R$ 100 mil a R$ 200 mil', 'Acima de R$ 200 mil',
  'Depende do ponto', 'uns 100k', 'R$ 70.000', 'R$ 70.000,00', '1,5 milhão', '2 milhões', 'uns 60 mil',
  'entre 80 e 120 mil', '150000', 'abaixo de 100 mil', 'não sei ainda', '', null,
  // a fronteira do piso (R$ 50 mil desde 21/09)
  'R$ 50 mil', 'uns 49 mil', 'Menos de R$ 50 mil', 'R$ 49.999', 'R$ 50.000',
];

describe('podeCeder: quem assina o arrendamento (contrato, Cl. 16.1)', () => {
  it('dono, inquilino, administrador e representante podem', () => {
    for (const t of ['Sou o proprietário', 'Sou inquilino', 'Administro o local', 'Represento o proprietário']) {
      expect(podeCeder(t), t).toBe(true);
    }
  });
  it('quem negocia, ainda não é dono, só tem em vista ou não respondeu, não pode', () => {
    for (const t of ['Estou negociando com o proprietário', 'Ainda não é meu · pretendo alugar ou comprar',
      'Tenho um local em vista, mas ainda não conversei', 'Tenho um local em negociação com o proprietário',
      'Não tenho ideia de onde instalar', '', null, undefined]) {
      expect(podeCeder(t), String(t)).toBe(false);
    }
  });
});

describe('valorEmMil: o valor em mil reais, venha de onde vier', () => {
  it.each([
    ['R$ 70 mil', 70], ['R$ 140 mil', 140], ['Mais de R$ 500 mil', 500],
    ['R$ 50 mil a R$ 100 mil', 100],      // faixa: vale o teto
    ['R$ 100 mil a R$ 200 mil', 200], ['Até R$ 50 mil', 50], ['Acima de R$ 200 mil', 200],
    ['uns 100k', 100], ['R$ 70.000', 70], ['R$ 70.000,00', 70], ['150000', 150],
    ['1,5 milhão', 1500], ['2 milhões', 2000], ['entre 80 e 120 mil', 120],
  ])('%s = %s mil', (texto, mil) => {
    expect(valorEmMil(texto)).toBe(mil);
  });
  it('"menos de" e "abaixo de" ficam logo abaixo do número', () => {
    expect(valorOk('Menos de R$ 50 mil')).toBe(false);
    expect(valorEmMil('abaixo de 100 mil')!).toBeLessThan(100);
  });
  it('sem número é "não disse", e não zero', () => {
    for (const t of ['Depende do ponto', 'não sei ainda', '', null, undefined]) {
      expect(valorEmMil(t), String(t)).toBeNull();
      expect(valorOk(t), String(t)).toBeNull();
    }
  });
});

describe('a tabela de destino, linha a linha', () => {
  const ficha = (local: string | null, valor: string | null) =>
    [local && `Local é seu: ${local}`, valor && `Quanto pretende investir: ${valor}`].filter(Boolean).join('\n');

  it('1. pode ceder: ARRENDAMENTO, qualquer que seja o valor', () => {
    expect(destinoDe('parceria', { lado: 'ponto', ponto_relacao: 'Sou inquilino' })).toBe('ponto');
    expect(destinoDe('parceria', { lado: 'ponto', ponto_relacao: 'Sou o proprietário', capital_faixa: 'Até R$ 50 mil' })).toBe('ponto');
    expect(destinoDe('nota1', { ficha: ficha('Sou o proprietário', null) })).toBe('ponto');
  });
  it('o piso é R$ 50 mil ("de 50 mil pra cima", 21/09)', () => {
    expect(PISO_INVESTIDOR_MIL).toBe(50);
    expect(valorOk('R$ 50 mil')).toBe(true);
    expect(valorOk('uns 49 mil')).toBe(false);
  });
  it('2. não pode e declarou R$ 50 mil ou mais: INVESTIDORES', () => {
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: 'R$ 70 mil' })).toBe('capital');
    expect(destinoDe('nota1', { ficha: '', valor_investir: 'R$ 50 mil' })).toBe('capital');
    expect(destinoDe('nota1', { ficha: ficha('Ainda não é meu · pretendo alugar ou comprar', 'R$ 140 mil') })).toBe('capital');
  });
  it('3. as faixas "R$ 50 a 100 mil" e "Até R$ 50 mil" do cadastro alcançam o piso: INVESTIDORES', () => {
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: 'R$ 50 mil a R$ 100 mil' })).toBe('capital');
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: 'Até R$ 50 mil' })).toBe('capital');
  });
  it('"Menos de X" com X acima do piso é teto, não valor: "não disse" (a opção antiga "Menos de R$ 70 mil")', () => {
    expect(valorOk('Menos de R$ 70 mil')).toBeNull();
    expect(valorOk('abaixo de 100 mil')).toBeNull();
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: 'Menos de R$ 70 mil' })).toBe('curioso');
    expect(destinoDe('nota1', { ficha: '', valor_investir: 'Menos de R$ 70 mil' })).toBe('curioso');
  });
  it('4. declarou abaixo de 50: CURIOSO', () => {
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: 'uns 30 mil' })).toBe('curioso');
    expect(destinoDe('nota1', { ficha: '', valor_investir: 'Menos de R$ 50 mil' })).toBe('curioso');
  });
  it('5, 6 e 7. não disse o valor, seja como for que pague ou onde esteja o local: CURIOSO', () => {
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: 'Depende do ponto' })).toBe('curioso');
    expect(destinoDe('parceria', { lado: 'capital', capital_faixa: null })).toBe('curioso');
    expect(destinoDe('nota1', { capital_faixa: 'proprio', ficha: 'Como pretende investir: Recurso próprio' })).toBe('curioso');
    expect(destinoDe('nota1', { ficha: ficha('Ainda não é meu · pretendo alugar ou comprar', null) })).toBe('curioso');
    expect(destinoDe('nota1', { ficha: '' })).toBe('curioso');
  });
  it('cadastro de PONTO que ainda negocia o local: sai do Arrendamento pelo valor', () => {
    expect(destinoDe('parceria', { lado: 'ponto', ponto_relacao: 'Estou negociando com o proprietário',
      capital_faixa: 'R$ 100 mil a R$ 200 mil' })).toBe('capital');
    expect(destinoDe('parceria', { lado: 'ponto', ponto_relacao: 'Estou negociando com o proprietário' })).toBe('curioso');
  });
  it('o valor gravado pelo consultor ganha do texto da ficha: quem respondeu sobe', () => {
    expect(destinoDe('nota1', { ficha: ficha('Ainda não é meu', null), valor_investir: 'R$ 280 mil' })).toBe('capital');
    expect(destinoDe('nota1', { ficha: ficha(null, 'R$ 140 mil'), valor_investir: 'Menos de R$ 50 mil' })).toBe('curioso');
  });
  it('marcado ARRENDAMENTO na agenda: sempre Arrendamento', () => {
    expect(destinoDe('agenda', {})).toBe('ponto');
  });
});

describe('a tela e o servidor usam a MESMA regra', () => {
  const tela = regraDaTela();

  it('o piso é o mesmo número nos dois lados', () => {
    expect(tela.CAD_PISO_MIL).toBe(PISO_INVESTIDOR_MIL);
  });

  it('podeCeder concorda em todas as respostas dos formulários', () => {
    for (const r of RELACOES) expect(tela.cadPodeCeder(r), String(r)).toBe(podeCeder(r));
  });

  it('valorEmMil concorda em todos os valores', () => {
    for (const v of VALORES) expect(tela.cadValorEmMil(v), String(v)).toBe(valorEmMil(v));
  });

  it('o destino concorda em toda combinação de posse × valor, nas três origens', () => {
    const divergencias: string[] = [];
    for (const rel of RELACOES) for (const val of VALORES) {
      const casos: Array<['parceria' | 'nota1' | 'agenda', Record<string, unknown>]> = [
        ['parceria', { lado: 'ponto', ponto_relacao: rel, capital_faixa: val }],
        ['parceria', { lado: 'capital', ponto_relacao: rel, capital_faixa: val }],
        ['nota1', { ficha: [rel && `Local é seu: ${rel}`, val && `Quanto pretende investir: ${val}`].filter(Boolean).join('\n'),
          valor_investir: val }],
        ['nota1', { ficha: rel ? `Local é seu: ${rel}` : '', valor_investir: val }],
        // o valor só no texto da ficha (a LP escreveu, ninguém gravou ainda)
        ['nota1', { ficha: val ? `Quanto pretende investir: ${val}` : '', valor_investir: null }],
        ['agenda', { ponto_relacao: rel }],
      ];
      for (const [origem, r] of casos) {
        const a = destinoDe(origem, r), b = tela.cadDestino(origem, r);
        if (a !== b) divergencias.push(`${origem} ${JSON.stringify(r)}: servidor ${a}, tela ${b}`);
      }
    }
    expect(divergencias.join('\n')).toBe('');
  });
});

// ── o AGRUPAMENTO por telefone também é gêmeo ───────────────────────────────
// É ele que decide quem está no Curioso: a aba mostra uma lista e a pauta do
// Curioso manda pra outra se os dois divergirem. Recorta o agrupamento de
// cadCarregar() e roda com as mesmas linhas que o servidor recebe.
function agrupamentoDaTela() {
  const html = readFileSync(GERADOR, 'utf8');
  const fatia = (de: string, ate: string) => {
    const i = html.indexOf(de), j = html.indexOf(ate, i);
    if (i < 0 || j < 0) throw new Error(`marcador sumiu do /gerador: "${de}"`);
    return html.slice(i, j);
  };
  const fonte = fatia('function cadPodeCeder(', 'const CAD_STATUS = {')
    + fatia('function cadValorDaFicha(', '/** A lista de quem esta perto')
    + fatia('    // Cada linha das tres origens ganha o seu destino', '    cadDados = {')
    + '\nreturn listas;';
  return new Function('pontos', 'capital', 'fichas', 'agendaArr', fonte) as
    (p: any[], c: any[], f: any[], a: any[]) => Record<string, Array<{ tab: string; id: number }>>;
}

describe('a lista de cada aba é a mesma na tela e no servidor', () => {
  const T = { A: '5534999990001', B: '5534999990002', C: '5534999990003', D: '5534999990004', E: '5534999990005' };
  const pontos = [
    { id: 1, lado: 'ponto', telefone: T.A, ponto_relacao: 'Sou o proprietário', created_at: '2026-09-10' },
    { id: 4, lado: 'ponto', telefone: T.D, ponto_relacao: 'Estou negociando com o proprietário',
      capital_faixa: 'R$ 50 mil a R$ 100 mil', created_at: '2026-09-14' },
  ];
  const capital = [
    { id: 2, lado: 'capital', telefone: T.A, capital_faixa: 'R$ 140 mil', created_at: '2026-09-12' },
    { id: 3, lado: 'capital', telefone: T.B, capital_faixa: 'Até R$ 50 mil', created_at: '2026-09-11' },
    { id: 5, lado: 'capital', telefone: null, capital_faixa: null, created_at: '2026-09-09' },
  ];
  // fichas e agenda chegam do mais novo pro mais velho, como a API devolve
  const fichas = [
    { id: 13, telefone: T.E, ficha: '', valor_investir: 'R$ 70 mil', created_at: '2026-09-20' },
    { id: 12, telefone: T.D, ficha: 'Local é seu: Sou inquilino', created_at: '2026-09-19' },
    { id: 11, telefone: T.C, ficha: 'Local é seu: Ainda não é meu', created_at: '2026-09-18' },
    { id: 10, telefone: T.B, ficha: 'Quanto pretende investir: R$ 280 mil', created_at: '2026-09-17' },
    { id: 9, telefone: T.C, ficha: '', created_at: '2026-09-16' },
  ];
  const agenda = [{ id: 900, cliente_telefone: T.C, created_at: '2026-09-21' }];

  it('Arrendamento, Investidores e Curioso batem linha a linha', () => {
    const tela = agrupamentoDaTela()(pontos, capital, fichas, agenda);
    const porData = (a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at));
    const linhas: LinhaOrigem[] = [
      ...[...pontos, ...capital].sort(porData).map(r => ({ origem: 'parceria' as const, r })),
      ...fichas.map(r => ({ origem: 'nota1' as const, r })),
      ...agenda.map(r => ({ origem: 'agenda' as const, r })),
    ];
    const servidor = agruparPorDestino(linhas);
    const ORIGEM: Record<string, string> = { eletroposto_parceria: 'parceria', eletroposto_nota1: 'nota1', agendamentos: 'agenda' };
    for (const d of ['ponto', 'capital', 'curioso'] as const) {
      expect(tela[d].map(r => ORIGEM[r.tab] + ':' + r.id), d)
        .toEqual(servidor[d].map(l => l.origem + ':' + l.r.id));
    }
    // e o resultado é o que a regra do dono manda
    expect(servidor.ponto.map(l => l.origem + ':' + l.r.id).sort()).toEqual(['agenda:900', 'nota1:12', 'parceria:1']);
    expect(servidor.capital.map(l => l.origem + ':' + l.r.id).sort()).toEqual(['nota1:13', 'parceria:3']);
    expect(servidor.curioso.map(l => l.origem + ':' + l.r.id)).toEqual(['parceria:5']);
  });
});
