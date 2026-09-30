import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PRA ONDE CADA PESSOA VAI: Arrendamento, Investidores ou Curioso.
//
// A regra do dono (21/09/2026) mora em DOIS lugares: destinoDe() no servidor, que
// monta os pares e o Match, e cadDestino() na aba Cadastros do /gerador. Este teste
// cobre a tabela de destino linha a linha e depois LÊ o JavaScript da aba e roda os
// dois lado a lado. Se alguém mexer num só, ele aponta a resposta em que discordaram.
import { destinoDe, podeCeder, valorEmMil, valorOk, agruparPorDestino, PISO_INVESTIDOR_MIL,
         ehOpcaoArrendamento, relacaoDaLinha, precisaPerguntarDoDono, respondeuDeQuemE,
         type LinhaOrigem } from '../services/io/eletropostoPares';

const GERADOR = join(__dirname, '../../../dashboard/public/gerador/index.html');

function regraDaTela() {
  const html = readFileSync(GERADOR, 'utf8');
  const de = 'function cadPodeCeder(', ate = 'const CAD_STATUS = {';
  const i = html.indexOf(de), j = html.indexOf(ate);
  // Marcador que sumiu = tela refatorada. Melhor um teste quebrado do que um que
  // passa sem comparar nada.
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu do /gerador: "${de}" … "${ate}"`);
  return new Function(html.slice(i, j)
    + '\nreturn { cadPodeCeder, cadValorEmMil, cadDestino, CAD_PISO_MIL,'
    + ' cadEhOpcaoArrendamento, cadRelacaoDaLinha, cadPrecisaPerguntarDono,'
    + ' cadRespondeuDeQuemE };')() as {
    cadPodeCeder: (t: unknown) => boolean;
    cadValorEmMil: (t: unknown) => number | null;
    cadDestino: (origem: string, r: Record<string, unknown>) => string;
    CAD_PISO_MIL: number;
    cadEhOpcaoArrendamento: (origem: string, r: Record<string, unknown>) => boolean;
    cadRelacaoDaLinha: (origem: string, r: Record<string, unknown>) => string | null;
    cadPrecisaPerguntarDono: (origem: string, r: Record<string, unknown>) => boolean;
    cadRespondeuDeQuemE: (t: unknown) => boolean;
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
    + '\nreturn { listas, semDono };';
  return new Function('pontos', 'capital', 'fichas', 'agendaArr', fonte) as
    (p: any[], c: any[], f: any[], a: any[]) => {
      listas: Record<string, Array<{ tab: string; id: number }>>;
      semDono: Array<{ ref: string; status: string | null; nome?: string }>;
    };
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
  const agenda = [
    // marcada ARRENDAMENTO: entra pelo botão, sem precisar de resposta
    { id: 900, cliente_telefone: T.C, status: 'arrendamento', created_at: '2026-09-21' },
    // a reunião que morreu por falta de dinheiro, com o local do próprio dono:
    // é a ordem de 28/09 — ela É opção de arrendamento
    { id: 901, cliente_telefone: '5534999990009', status: 'sem_interesse', created_at: '2026-09-22',
      observacao: 'LP ELETROPOSTO — Posto\nLocal é seu: Sou o proprietário\nEndereço: Av. X, 10' },
    // reunião sem ninguém ter perguntado de quem é o local: fica fora
    { id: 902, cliente_telefone: '5534999990010', status: 'agendado', created_at: '2026-09-23',
      observacao: 'LP ELETROPOSTO — Posto' },
  ];

  it('CURIOSO é a fila do servidor: um destino por telefone, igualzinho', () => {
    const tela = agrupamentoDaTela()(pontos, capital, fichas, agenda).listas;
    const porData = (a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at));
    const linhas: LinhaOrigem[] = [
      ...[...pontos, ...capital].sort(porData).map(r => ({ origem: 'parceria' as const, r })),
      ...fichas.map(r => ({ origem: 'nota1' as const, r })),
      // curiosos() só lê a agenda marcada ARRENDAMENTO — é o que a fila do motor vê
      ...agenda.filter(r => r.status === 'arrendamento').map(r => ({ origem: 'agenda' as const, r })),
    ];
    const servidor = agruparPorDestino(linhas);
    const ORIGEM: Record<string, string> = { eletroposto_parceria: 'parceria', eletroposto_nota1: 'nota1', agendamentos: 'agenda' };
    // A aba Curioso e a fila que recebe a pergunta do valor têm que ser as mesmas
    // pessoas: a tela não pode prometer uma ligação que o motor não faz.
    expect(tela.curioso.map(r => ORIGEM[r.tab] + ':' + r.id))
      .toEqual(servidor.curioso.map(l => l.origem + ':' + l.r.id));
    expect(servidor.curioso.map(l => l.origem + ':' + l.r.id)).toEqual(['parceria:5']);
  });

  it('INVESTIDORES é o pool do servidor: toda linha que qualifica, inclusive quem tem local', () => {
    const tela = agrupamentoDaTela()(pontos, capital, fichas, agenda).listas;
    const ORIGEM: Record<string, string> = { eletroposto_parceria: 'parceria', eletroposto_nota1: 'nota1', agendamentos: 'agenda' };
    const refs = tela.capital.map(r => ORIGEM[r.tab] + ':' + r.id).sort();
    // parceria:2 é o telefone A, que tem local próprio (parceria:1) E R$ 140 mil:
    // antes de 28/09 ele desaparecia daqui, e com ele a dupla que o servidor
    // oferecia — `cadAcha` não encontrava a linha e a tela engolia o par.
    expect(refs).toContain('parceria:2');
    expect(refs).toEqual(['nota1:13', 'parceria:2', 'parceria:3', 'parceria:4']);
    // e é a mesma régua do pool: destinoDe por LINHA, sem o melhor-destino por pessoa
    const doPool = [
      ...[...pontos, ...capital].map(r => ['parceria', r] as const),
      ...fichas.map(r => ['nota1', r] as const),
    ].filter(([o, r]) => destinoDe(o as 'parceria' | 'nota1', r as Record<string, unknown>) === 'capital');
    const vistos = new Set<string>();
    const doPoolRefs: string[] = [];
    for (const [o, r] of doPool) {
      const tel = String((r as any).telefone || '').replace(/\D/g, '');
      if (tel) { if (vistos.has(tel)) continue; vistos.add(tel); }
      doPoolRefs.push(o + ':' + (r as any).id);
    }
    expect(refs).toEqual(doPoolRefs.sort());
  });

  // O eixo do LOCAL divergiu do agruparPorDestino DE PROPÓSITO em 28/09: lá cada
  // telefone tem um destino só (é o que a fila do Curioso precisa), aqui a aba
  // Arrendamento é um superconjunto. Quem garante que a tela e o servidor
  // concordam nesta régua é o teste de ehOpcaoArrendamento logo abaixo; o que
  // este caso trava é o CONTEÚDO da lista.
  it('Arrendamento é superconjunto: dono de local entra mesmo com dinheiro ou reunião perdida', () => {
    const tela = agrupamentoDaTela()(pontos, capital, fichas, agenda).listas;
    const refs = (l: Array<{ tab: string; id: number }>) => {
      const ORIGEM: Record<string, string> = { eletroposto_parceria: 'parceria', eletroposto_nota1: 'nota1', agendamentos: 'agenda' };
      return l.map(r => ORIGEM[r.tab] + ':' + r.id).sort();
    };
    expect(refs(tela.ponto)).toEqual(['agenda:900', 'agenda:901', 'nota1:12', 'parceria:1']);
    // a reunião sem resposta nenhuma continua fora
    expect(refs(tela.ponto)).not.toContain('agenda:902');
    // e o telefone A, que tem local próprio E R$ 140 mil, está nos DOIS eixos
    expect(refs(tela.ponto)).toContain('parceria:1');
    expect(refs(tela.capital)).toContain('parceria:2');
  });
});


// -----------------------------------------------------------------------------
// O EIXO DO LOCAL TAMBEM E GEMEO (28/09/2026)
//
// `ehOpcaoArrendamento` decide quem e opcao de arrendamento no servidor e
// `cadEhOpcaoArrendamento` faz o mesmo na aba. Sem este teste, os dois derivam e
// a aba lista quem o Match nao oferece — a falha que este arquivo existe pra
// impedir, agora na regra nova.
// -----------------------------------------------------------------------------
describe('ehOpcaoArrendamento: a tela e o servidor respondem igual', () => {
  const STATUS = ['arrendamento', 'agendado', 'sem_interesse', 'cancelado', 'nao_atendeu',
    'em_atendimento', 'proposta_apresentada', 'chave_na_mao', 'meio_a_meio', 'carregador',
    'fechou', 'fechou_concorrente', 'reagendar', '', null];

  it('reunião: as duas respostas batem em todo status × toda relação', () => {
    const tela = regraDaTela();
    for (const status of STATUS) {
      for (const rel of RELACOES) {
        const linha = { status, observacao: rel === null ? '' : 'LP ELETROPOSTO — Posto\nLocal é seu: ' + rel };
        expect(tela.cadEhOpcaoArrendamento('agenda', linha),
          `agenda ${status} · ${rel}`).toBe(ehOpcaoArrendamento('agenda', linha));
      }
      // e com a resposta na COLUNA em vez do texto
      const naColuna = { status, ponto_relacao: 'Sou o proprietário' };
      expect(tela.cadEhOpcaoArrendamento('agenda', naColuna), `coluna ${status}`)
        .toBe(ehOpcaoArrendamento('agenda', naColuna));
    }
  });

  it('cadastro e ficha: as duas respostas batem em toda relação', () => {
    const tela = regraDaTela();
    for (const rel of RELACOES) {
      const cad = { lado: 'capital', ponto_relacao: rel };
      expect(tela.cadEhOpcaoArrendamento('parceria', cad), `parceria ${rel}`)
        .toBe(ehOpcaoArrendamento('parceria', cad));
      const ficha = { ficha: rel === null ? '' : 'Local é seu: ' + rel };
      expect(tela.cadEhOpcaoArrendamento('nota1', ficha), `nota1 ${rel}`)
        .toBe(ehOpcaoArrendamento('nota1', ficha));
    }
  });

  it('a leitura da relação bate nas três origens', () => {
    const tela = regraDaTela();
    const casos: Array<[string, Record<string, unknown>]> = [
      ['agenda', { observacao: 'Ponto: definido\nLocal é seu: Sou o proprietário\nDecisor: eu' }],
      ['agenda', { ponto_relacao: 'Sou inquilino', observacao: 'Local é seu: Sou o proprietário' }],
      ['agenda', { observacao: 'LP ELETROPOSTO — Posto' }],
      ['nota1', { ficha: 'Local é seu: Administro o local' }],
      ['parceria', { ponto_relacao: 'Represento o proprietário' }],
      ['parceria', {}],
    ];
    for (const [origem, r] of casos) {
      expect(tela.cadRelacaoDaLinha(origem, r), `${origem} ${JSON.stringify(r)}`)
        .toBe(relacaoDaLinha(origem as 'parceria' | 'nota1' | 'agenda', r));
    }
  });

  it('o eixo do DINHEIRO não mudou: quem pode ceder não deixa de ser investidor', () => {
    // O cadastro de capital com local próprio é opção de arrendamento E continua
    // Investidores. É o lead "tem os dois", que antes de 28/09 desaparecia de um
    // dos lados.
    const r = { lado: 'capital', ponto_relacao: 'Sou o proprietário', capital_faixa: 'R$ 140 mil' };
    expect(ehOpcaoArrendamento('parceria', r)).toBe(true);
    expect(destinoDe('parceria', r)).toBe('capital');
    const tela = regraDaTela();
    expect(tela.cadEhOpcaoArrendamento('parceria', r)).toBe(true);
    expect(tela.cadDestino('parceria', r)).toBe('capital');
  });
});


// -----------------------------------------------------------------------------
// A PERGUNTA QUE FALTA, GEMEA NOS DOIS LADOS (29/09/2026)
//
// O grupo "Dono nao perguntado" do Menu de Avisos sai de precisaPerguntarDoDono()
// no servidor e de cadPrecisaPerguntarDono() na tela. Se os dois derivarem, a tela
// promete um numero de destinatarios e o motor manda pra outra gente.
// -----------------------------------------------------------------------------
describe('a lista "Dono nao perguntado" que a TELA monta', () => {
  it('sai com as mesmas linhas da regra, e a da agenda vai com status nulo', () => {
    const comEnd = 'LP ELETROPOSTO — Posto\nEndereço: Av. K, 50';
    const r = agrupamentoDaTela()(
      [],
      // cadastro de investidor com endereço e sem resposta: entra
      [{ id: 70, lado: 'capital', telefone: '5534999993001', ponto_endereco: 'Av. X, 10',
         capital_faixa: 'R$ 140 mil', created_at: '2026-09-20' }],
      // a que respondeu fica fora; a com "não respondeu" e endereço entra
      [{ id: 71, telefone: '5534999993002', endereco: 'Rua Z, 30', ficha: 'Local é seu: Ainda não é meu',
         created_at: '2026-09-19' },
       { id: 72, telefone: '5534999993003', endereco: 'Rua W, 40', ficha: 'Local é seu: não respondeu',
         created_at: '2026-09-18' }],
      // reunião perdida com endereço entra; sem endereço fica fora
      [{ id: 900, cliente_telefone: '5534999993004', cliente_nome: 'Perdido', status: 'sem_interesse',
         observacao: comEnd, created_at: '2026-09-21' },
       { id: 901, cliente_telefone: '5534999993005', cliente_nome: 'Sem endereco', status: 'agendado',
         observacao: 'LP ELETROPOSTO — Posto', created_at: '2026-09-22' }]);
    expect(r.semDono.map(x => x.ref).sort()).toEqual(['agenda:900', 'nota1:72', 'parceria:70']);
    const daAgenda = r.semDono.find(x => x.ref === 'agenda:900');
    // o desfecho da reunião NÃO vai como status de cadastro: a audiência do aviso
    // descartaria 'sem_interesse' e jogaria fora justamente quem a pergunta busca
    expect(daAgenda!.status).toBeNull();
    expect(daAgenda!.nome).toBe('Perdido');
  });
});

describe('precisaPerguntarDoDono: a tela e o servidor escolhem a mesma gente', () => {
  const COM_ENDERECO = 'LP ELETROPOSTO — Posto\nEndereço: Av. João Naves, 1200\n';

  it('reunião: bate em todo status x toda relação, com e sem endereço', () => {
    const tela = regraDaTela();
    const STATUS = ['agendado', 'sem_interesse', 'cancelado', 'nao_atendeu', 'em_atendimento',
      'chave_na_mao', 'meio_a_meio', 'carregador', 'arrendamento', 'fechou', 'fechou_concorrente', '', null];
    for (const status of STATUS) {
      for (const rel of [...RELACOES, 'não respondeu']) {
        for (const end of [COM_ENDERECO, '']) {
          const linha = { status, observacao: end + (rel === null ? '' : 'Local é seu: ' + rel) };
          expect(tela.cadPrecisaPerguntarDono('agenda', linha), `${status} · ${rel} · end=${!!end}`)
            .toBe(precisaPerguntarDoDono('agenda', linha));
        }
      }
    }
  });

  it('cadastro e ficha: bate com e sem endereço', () => {
    const tela = regraDaTela();
    for (const rel of [...RELACOES, 'não respondeu']) {
      for (const end of ['Av. X, 10', '']) {
        const cad = { lado: 'capital', ponto_relacao: rel, ponto_endereco: end };
        expect(tela.cadPrecisaPerguntarDono('parceria', cad), `parceria ${rel} ${end}`)
          .toBe(precisaPerguntarDoDono('parceria', cad));
        const ficha = { endereco: end, ficha: rel === null ? '' : 'Local é seu: ' + rel };
        expect(tela.cadPrecisaPerguntarDono('nota1', ficha), `nota1 ${rel} ${end}`)
          .toBe(precisaPerguntarDoDono('nota1', ficha));
      }
    }
  });

  it('a regra em si: endereço sim, resposta não, e quem respondeu fica fora', () => {
    // entra: tem endereço e ninguém perguntou
    expect(precisaPerguntarDoDono('agenda', { status: 'sem_interesse', observacao: COM_ENDERECO })).toBe(true);
    // "não respondeu" é pergunta não feita
    expect(precisaPerguntarDoDono('agenda',
      { status: 'agendado', observacao: COM_ENDERECO + 'Local é seu: não respondeu' })).toBe(true);
    // já respondeu, mesmo que a resposta tire ele do Arrendamento: não recebe
    expect(precisaPerguntarDoDono('agenda',
      { status: 'agendado', observacao: COM_ENDERECO + 'Local é seu: Ainda não é meu' })).toBe(false);
    expect(precisaPerguntarDoDono('agenda',
      { status: 'agendado', observacao: COM_ENDERECO + 'Local é seu: Estou negociando com o proprietário' })).toBe(false);
    // já é opção de arrendamento: a pergunta está respondida
    expect(precisaPerguntarDoDono('agenda',
      { status: 'agendado', observacao: COM_ENDERECO + 'Local é seu: Sou inquilino' })).toBe(false);
    // sem endereço não há local pra arrendar
    expect(precisaPerguntarDoDono('agenda', { status: 'agendado', observacao: 'LP ELETROPOSTO — Posto' })).toBe(false);
    // o local já tem carregador
    expect(precisaPerguntarDoDono('agenda', { status: 'fechou', observacao: COM_ENDERECO })).toBe(false);
    expect(precisaPerguntarDoDono('agenda', { status: 'fechou_concorrente', observacao: COM_ENDERECO })).toBe(false);
  });

  it('ficha de teste fica fora, e a tela concorda', () => {
    const tela = regraDaTela();
    const comEndereco = 'Endereço: Av. X, 10';
    for (const nome of ['Teste', 'teste 2', 'TESTE joao', '  Teste']) {
      const linha = { status: 'agendado', cliente_nome: nome, observacao: comEndereco };
      expect(precisaPerguntarDoDono('agenda', linha), nome).toBe(false);
      expect(tela.cadPrecisaPerguntarDono('agenda', linha), 'tela ' + nome).toBe(false);
    }
    // nome que só COMEÇA parecido continua na pauta
    for (const nome of ['Testemunha Silva', 'Ernesto', 'Teodoro']) {
      const linha = { status: 'agendado', cliente_nome: nome, observacao: comEndereco };
      expect(precisaPerguntarDoDono('agenda', linha), nome).toBe(true);
      expect(tela.cadPrecisaPerguntarDono('agenda', linha), 'tela ' + nome).toBe(true);
    }
  });

  it('respondeuDeQuemE: vazio, nulo e "não respondeu" são a mesma coisa', () => {
    for (const t of ['', null, undefined, '   ', 'não respondeu', 'Não respondeu', 'nao respondeu']) {
      expect(respondeuDeQuemE(t), String(t)).toBe(false);
    }
    for (const t of ['Sou o proprietário', 'Ainda não é meu', 'Sou inquilino']) {
      expect(respondeuDeQuemE(t), t).toBe(true);
    }
  });
});
