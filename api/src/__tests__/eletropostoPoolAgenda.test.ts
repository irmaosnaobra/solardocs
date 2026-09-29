import { describe, it, expect, vi, beforeEach } from 'vitest';

// Três tabelas, cada uma com o que o teste pedir. O filtro `.eq('status',
// 'arrendamento')` da agenda é respeitado de verdade: se o pool esquecer o
// filtro, o lead "agendado" do meio vaza e o teste pega.
let tabelas: Record<string, Record<string, unknown>[]> = {};
vi.mock('../utils/supabaseGerador', () => {
  const resposta = (tabela: string) => {
    const filtros: Array<[string, (x: unknown) => boolean]> = [];
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { filtros.push([col, (x: unknown) => x === v]); return q; },
      in: (col: string, vs: unknown[]) => { filtros.push([col, (x: unknown) => vs.includes(x)]); return q; },
      // O pool filtra a agenda por created_by ilike '%eletroposto%'. O mock
      // cumpre o filtro de verdade: sem isso, uma reuniao de outro produto
      // vazaria pro lado do ponto e o teste nao pegaria.
      ilike: (col: string, padrao: string) => {
        const partes = String(padrao).toLowerCase().split('%').filter(Boolean);
        filtros.push([col, (x: unknown) => {
          const v = String(x ?? '').toLowerCase();
          return partes.every(t => v.includes(t));
        }]);
        return q;
      },
      order: () => q,
      limit: () => q,
      then: (ok: any) => Promise.resolve({
        data: (tabelas[tabela] || []).filter(l => filtros.every(([c, ok]) => ok(l[c]))),
        error: null,
      }).then(ok),
    };
    return q;
  };
  return { supabaseGerador: { from: (t: string) => resposta(t) } };
});

import { pool, ehProprio, soPontosProprios, ehOpcaoArrendamento, relacaoDaLinha,
         montarPares, MAX_PARES, type Candidato } from '../services/io/eletropostoPares';

describe('pool do PONTO — arrendamento marcado na agenda (21/09)', () => {
  beforeEach(() => {
    tabelas = {
      eletroposto_parceria: [
        { id: 1, lado: 'ponto', nome: 'Cadastrado', telefone: '5534999990001', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Sou o proprietário' },
        // cadastrou como PONTO, mas ainda negocia o local e tem dinheiro: e investidor
        { id: 2, lado: 'ponto', nome: 'Negocia', telefone: '5534999990005', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Estou negociando com o proprietário', capital_faixa: 'R$ 100 mil a R$ 200 mil' },
        // investidor que nunca disse o valor: curioso, fora dos dois pools
        { id: 3, lado: 'capital', nome: 'Sem valor', telefone: '5534999990006', cidade: 'Uberlândia-MG',
          capital_faixa: 'Depende do ponto' },
      ],
      eletroposto_nota1: [
        { id: 7, nome: 'Da ficha', telefone: '5534999990002', cidade: 'Uberlândia-MG',
          ficha: 'Tem ponto: Já tenho o ponto definido\nLocal é seu: Sou o proprietário' },
        // tem o local em vista e disse o valor: investidor
        { id: 8, nome: 'Em vista', telefone: '5534999990007', cidade: 'Uberlândia-MG',
          ficha: 'Local é seu: Ainda não é meu\nQuanto pretende investir: R$ 140 mil' },
        // em vista e nao disse o valor: curioso
        { id: 9, nome: 'Curioso', telefone: '5534999990008', cidade: 'Uberlândia-MG',
          ficha: 'Local é seu: Ainda não é meu' },
      ],
      agendamentos: [
        { id: 1128, created_by: 'lp_eletroposto', status: 'arrendamento', cliente_nome: 'Só na agenda',
          cliente_telefone: '5534999990003', cidade: 'Uberlândia-MG' },
        // mesmo telefone do cadastro: a linha rica ganha, a da agenda não duplica
        { id: 1129, created_by: 'lp_eletroposto', status: 'arrendamento', cliente_nome: 'Duplicado',
          cliente_telefone: '5534999990001', cidade: 'Uberlândia-MG' },
        // outro status: não é arrendamento, não entra
        { id: 1130, created_by: 'lp_eletroposto', status: 'agendado', cliente_nome: 'Só agendado',
          cliente_telefone: '5534999990004', cidade: 'Uberlândia-MG' },
      ],
    };
  });

  it('quem foi marcado ARRENDAMENTO na agenda entra no lado do ponto, com a origem certa', async () => {
    const pontos = await pool('ponto');
    const daAgenda = pontos.find(p => p.telefone === '5534999990003');
    expect(daAgenda).toBeDefined();
    expect(daAgenda!.tab).toBe('agenda');
    expect(daAgenda!.id).toBe(1128);
    // foi conversado pelo consultor: não é "da ficha, nunca falamos"
    expect(daAgenda!.daFicha).toBe(false);
  });

  it('a ordem é cadastro > ficha > agenda: o mesmo telefone não aparece duas vezes', async () => {
    const pontos = await pool('ponto');
    const doTelefone = pontos.filter(p => p.telefone === '5534999990001');
    expect(doTelefone).toHaveLength(1);
    expect(doTelefone[0].tab).toBe('parceria');
  });

  it('só o status arrendamento entra: agendado comum fica de fora', async () => {
    const pontos = await pool('ponto');
    expect(pontos.some(p => p.telefone === '5534999990004')).toBe(false);
  });

  it('a agenda NÃO alimenta o lado do capital: quem cede o local não é investidor', async () => {
    const capital = await pool('capital');
    expect(capital.some(c => c.tab === 'agenda')).toBe(false);
  });

  it('as três origens chegam juntas e com coordenada, prontas pro cálculo de pares', async () => {
    const pontos = await pool('ponto');
    expect(pontos.map(p => p.tab).sort()).toEqual(['agenda', 'nota1', 'parceria']);
    expect(pontos.every(p => typeof p.lat === 'number')).toBe(true);
  });

  it('quem ainda negocia o local e declarou dinheiro sai do ponto e vira investidor', async () => {
    const pontos = await pool('ponto');
    const capital = await pool('capital');
    expect(pontos.some(p => p.telefone === '5534999990005')).toBe(false);
    expect(capital.find(c => c.telefone === '5534999990005')?.tab).toBe('parceria');
    expect(capital.find(c => c.telefone === '5534999990007')?.tab).toBe('nota1');
  });

  it('quem nao disse o valor (curioso) nao entra em pool nenhum', async () => {
    const pontos = await pool('ponto');
    const capital = await pool('capital');
    for (const tel of ['5534999990006', '5534999990008']) {
      expect(pontos.some(p => p.telefone === tel)).toBe(false);
      expect(capital.some(c => c.telefone === tel)).toBe(false);
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// SÓ PONTO PRÓPRIO É OFERECIDO NO MATCH (ordem do dono, 28/09/2026)
//
// Duas réguas, e o teste existe pra não deixarem virar uma: `pool('ponto')`
// continua trazendo os quatro que podem ceder (é o gêmeo da aba Arrendamento), e
// `soPontosProprios` é quem estreita para a INDICAÇÃO — a dupla da tela e o ponto
// citado no aviso do WhatsApp. Se alguém "simplificar" cortando podeCeder, o
// inquilino desaparece da aba e cai em Investidores/Curioso, que é outra coisa.
// ─────────────────────────────────────────────────────────────────────────────
describe('ehProprio — quem é dono do local', () => {
  it('só o dono passa; quem representa, administra ou aluga não', () => {
    expect(ehProprio('Sou o proprietário')).toBe(true);
    expect(ehProprio('proprietario')).toBe(true);
    expect(ehProprio('O local é meu')).toBe(true);
    expect(ehProprio('Sou inquilino')).toBe(false);
    expect(ehProprio('Administro o local')).toBe(false);
    expect(ehProprio('Represento o proprietário')).toBe(false);
  });

  it('as duas frases que dizem "proprietário" SEM ser dono continuam fora', () => {
    // A ordem da leitura é o que resolve: as duas contêm a palavra dono.
    expect(ehProprio('Estou negociando com o proprietário')).toBe(false);
    expect(ehProprio('Represento o proprietário')).toBe(false);
  });

  it('ninguém perguntou não é "sim": vazio e nulo não afirmam posse', () => {
    expect(ehProprio(null)).toBe(false);
    expect(ehProprio(undefined)).toBe(false);
    expect(ehProprio('')).toBe(false);
    expect(ehProprio('não respondeu')).toBe(false);
    expect(ehProprio('Ainda não é meu · pretendo alugar ou comprar')).toBe(false);
    expect(ehProprio('nao_e_meu')).toBe(false);
  });
});

describe('o pool marca quem é próprio, e só esses pareiam', () => {
  beforeEach(() => {
    tabelas = {
      eletroposto_parceria: [
        { id: 1, lado: 'ponto', nome: 'Dono', telefone: '5534999990001', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Sou o proprietário' },
        { id: 2, lado: 'ponto', nome: 'Inquilino', telefone: '5534999990002', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Sou inquilino' },
        { id: 3, lado: 'ponto', nome: 'Representante', telefone: '5534999990003', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Represento o proprietário' },
      ],
      eletroposto_nota1: [],
      agendamentos: [
        { id: 900, created_by: 'lp_eletroposto', status: 'arrendamento', cliente_nome: 'Dono na agenda', cidade: 'Uberlândia-MG',
          cliente_telefone: '5534999990004', ponto_relacao: 'Sou o proprietário' },
        // marcada na mão: ninguém respondeu de quem é o local
        { id: 901, created_by: 'lp_eletroposto', status: 'arrendamento', cliente_nome: 'Sem resposta', cidade: 'Uberlândia-MG',
          cliente_telefone: '5534999990005' },
      ],
    };
  });

  it('inquilino e representante seguem no pool do ponto — a aba não muda', async () => {
    const pontos = await pool('ponto');
    expect(pontos.map(p => p.telefone).sort())
      .toEqual(['5534999990001', '5534999990002', '5534999990003', '5534999990004', '5534999990005']);
  });

  it('a indicação fica só com o dono do local', async () => {
    const proprios = soPontosProprios(await pool('ponto'));
    expect(proprios.map(p => p.nome).sort()).toEqual(['Dono', 'Dono na agenda']);
  });

  it('reunião marcada sem a resposta não é dada como própria', async () => {
    const pontos = await pool('ponto');
    const semResposta = pontos.find(p => p.telefone === '5534999990005');
    expect(semResposta!.proprio).toBe(false);
    expect(semResposta!.relacao).toBeNull();
  });

  it('do lado do capital ninguém é "próprio": o campo é do ponto', async () => {
    const capital = await pool('capital');
    expect(capital.every(c => c.proprio === false)).toBe(true);
  });
});


// -----------------------------------------------------------------------------
// OS DOIS EIXOS (ordem do dono, 28/09/2026)
//
// "Temos que considerar todos que tem endereco proprio como opcao de arrendamento.
// Tem gente que chega querendo comprar e no final nao tem dinheiro e podemos
// oferecer arrendamento."
//
// O que este bloco trava: a reuniao que morreu em SEM INTERESSE com "Sou o
// proprietario" na ficha E opcao de arrendamento, e quem tem local E dinheiro
// aparece nos DOIS lados sem virar par de si mesmo.
// -----------------------------------------------------------------------------
describe('ehOpcaoArrendamento — o eixo do local', () => {
  it('reunião de qualquer desfecho entra, desde que a ficha diga de quem é o local', () => {
    for (const status of ['sem_interesse', 'cancelado', 'nao_atendeu', 'em_atendimento',
                          'agendado', 'proposta_apresentada', 'chave_na_mao', 'meio_a_meio']) {
      expect(ehOpcaoArrendamento('agenda',
        { status, observacao: 'LP ELETROPOSTO — Posto\nLocal é seu: Sou o proprietário' })).toBe(true);
    }
  });

  it('modelo em negociação NÃO é venda: 50/50, chave na mão e carregador continuam valendo', () => {
    // O rótulo de venda é `fechou`/VENDIDO. Confundir os três com venda tiraria
    // 21 donos de local da lista, que é o contrário da ordem.
    expect(ehOpcaoArrendamento('agenda',
      { status: 'chave_na_mao', observacao: 'Local é seu: Sou o proprietário' })).toBe(true);
    expect(ehOpcaoArrendamento('agenda',
      { status: 'fechou', observacao: 'Local é seu: Sou o proprietário' })).toBe(false);
    expect(ehOpcaoArrendamento('agenda',
      { status: 'fechou_concorrente', observacao: 'Local é seu: Sou o proprietário' })).toBe(false);
  });

  it('marcado ARRENDAMENTO no card entra mesmo sem ninguém ter respondido', () => {
    expect(ehOpcaoArrendamento('agenda', { status: 'arrendamento' })).toBe(true);
    // sem resposta e sem o botão, não entra: ninguém sabe de quem é o local
    expect(ehOpcaoArrendamento('agenda', { status: 'agendado', observacao: 'LP ELETROPOSTO — Posto' })).toBe(false);
  });

  it('quem negocia o local ou ainda não é dono continua fora', () => {
    expect(ehOpcaoArrendamento('agenda',
      { status: 'agendado', observacao: 'Local é seu: Estou negociando com o proprietário' })).toBe(false);
    expect(ehOpcaoArrendamento('nota1',
      { ficha: 'Local é seu: Ainda não é meu · pretendo alugar ou comprar' })).toBe(false);
  });

  it('a coluna ganha do texto, e o texto salva as 96% em que a coluna está vazia', () => {
    expect(relacaoDaLinha('agenda', { ponto_relacao: 'Sou inquilino', observacao: 'Local é seu: Sou o proprietário' }))
      .toBe('Sou inquilino');
    expect(relacaoDaLinha('agenda', { observacao: 'Ponto: definido\nLocal é seu: Sou o proprietário\nDecisor: eu' }))
      .toBe('Sou o proprietário');
    expect(relacaoDaLinha('agenda', { observacao: 'LP ELETROPOSTO — Posto' })).toBeNull();
  });
});

describe('a mesma pessoa nos dois lados', () => {
  beforeEach(() => {
    tabelas = {
      // cadastrou como INVESTIDOR com dinheiro, e o local é dele
      eletroposto_parceria: [
        { id: 10, lado: 'capital', nome: 'Tem os dois', telefone: '5534999991010', cidade: 'Uberlândia-MG',
          ponto_relacao: 'Sou o proprietário', capital_faixa: 'R$ 100 mil a R$ 200 mil' },
      ],
      eletroposto_nota1: [],
      agendamentos: [
        // reunião que morreu por falta de dinheiro, com o endereço na ficha
        { id: 700, created_by: 'lp_eletroposto', status: 'sem_interesse', cliente_nome: 'Dono sem dinheiro', cidade: 'Araguari-MG',
          cliente_telefone: '5534999991020',
          observacao: 'LP ELETROPOSTO — Posto\nLocal é seu: Sou o proprietário\nEndereço: Av. X, 10' },
        // reuniao de SOLAR com a mesma resposta: nao e desta base
        { id: 701, created_by: 'lp_solar', status: 'sem_interesse', cliente_nome: 'Dono do solar',
          cidade: 'Araguari-MG', cliente_telefone: '5534999991030',
          observacao: 'Local é seu: Sou o proprietário' },
      ],
    };
  });

  it('reunião de outro produto não entra, mesmo dizendo que o local é dele', async () => {
    const pontos = await pool('ponto');
    expect(pontos.some(p => p.telefone === '5534999991030')).toBe(false);
  });

  it('quem tem local E dinheiro aparece no ponto e no capital', async () => {
    const pontos = await pool('ponto');
    const capital = await pool('capital');
    expect(pontos.some(p => p.telefone === '5534999991010')).toBe(true);
    expect(capital.some(c => c.telefone === '5534999991010')).toBe(true);
  });

  it('a reunião perdida por falta de dinheiro vira opção de arrendamento', async () => {
    const pontos = await pool('ponto');
    const perdido = pontos.find(p => p.telefone === '5534999991020');
    expect(perdido).toBeDefined();
    expect(perdido!.tab).toBe('agenda');
    expect(perdido!.proprio).toBe(true);
  });

  it('e ninguém vira par de si mesmo', async () => {
    const pontos = await pool('ponto');
    const capital = await pool('capital');
    const { matches, pares } = montarPares(pontos, capital);
    const eu = 'parceria:10';
    expect(matches.some(m => m.ponto === eu && m.capital === eu)).toBe(false);
    expect((pares[eu] || []).some(x => x.ref === eu)).toBe(false);
  });
});

describe('montarPares — a trava de auto-par e o teto por ponto', () => {
  const cand = (over: Partial<Candidato>): Candidato => ({
    nome: 'X', telefone: '5534999990000', cidade: 'Uberlândia-MG', daFicha: false,
    tab: 'parceria', id: 1, proprio: true, relacao: 'Sou o proprietário',
    lat: -18.91, lng: -48.27, ...over,
  });

  it('o mesmo humano com telefone escrito de dois jeitos não vira dupla', () => {
    // 55 34 9 9999-0001 e 34 9999-0001: mesma pessoa, 8 últimos dígitos iguais.
    const p = cand({ telefone: '5534999990001', tab: 'parceria', id: 1 });
    const c = cand({ telefone: '3499990001', tab: 'nota1', id: 2, proprio: false });
    const { matches } = montarPares([p], [c]);
    expect(matches).toHaveLength(0);
  });

  it('cada ponto entra com no máximo MAX_PARES investidores, os mais perto', () => {
    const p = cand({ telefone: '5534999990001', id: 1 });
    const investidores = [
      cand({ nome: 'perto', telefone: '5534999990002', id: 2, proprio: false, lat: -18.91, lng: -48.27 }),
      cand({ nome: 'medio', telefone: '5534999990003', id: 3, proprio: false, lat: -18.64, lng: -48.19 }),
      cand({ nome: 'longe', telefone: '5534999990004', id: 4, proprio: false, lat: -19.74, lng: -47.93 }),
      cand({ nome: 'quarto', telefone: '5534999990005', id: 5, proprio: false, lat: -19.75, lng: -47.94 }),
    ];
    const { matches, pares } = montarPares([p], investidores);
    expect(matches).toHaveLength(MAX_PARES);
    // a coluna continua contando TODOS os que estão perto; o teto é só da dupla
    expect(pares['parceria:1']).toHaveLength(4);
    const kms = matches.map(m => m.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
  });

  it('ponto que não é próprio não vira dupla, e sai na lista de sem_dono', () => {
    const inquilino = cand({ telefone: '5534999990001', id: 1, proprio: false, relacao: 'Sou inquilino' });
    const investidor = cand({ telefone: '5534999990002', id: 2, proprio: false });
    const { matches, sem_dono, pares } = montarPares([inquilino], [investidor]);
    expect(matches).toHaveLength(0);
    expect(sem_dono).toEqual(['parceria:1']);
    // e ele não recebe lista de investidor: a lista seria a indicação que saiu
    expect(pares['parceria:1']).toBeUndefined();
  });
});
