import { describe, it, expect, vi, beforeEach } from 'vitest';

// A parte pura da Helena (agente de investidores): relógio, fila, textos,
// horários, observação do card e leitura da IA. Nada aqui toca rede: os clientes
// de banco são trocados por objetos vazios e nenhum teste os chama.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  INICIO_ISO, antesDoInicio, janelaAberta, tetoDoDia, dataBrasilia, horaBrasiliaTexto, inicioDoDiaBrasiliaIso,
  telefoneZap, primeiroNome, valorNaFrase, valorLegivel, indicePorChave, renderAbertura,
  montarFila, vagasLivres, escolherQuatro, horariosDaOferta, horarioCurto, linhaDoHorario, horarioNaFrase,
  textoOferta, textoConfirmacao, numeroSolto, escolhaPorNumero, pediuParar, textoDaAbertura, montarObservacao, comoPretendeInvestir,
  naoPareceNomeDePessoa, pedidoDeReescrita, respostasDaFicha, fatosDoFormulario, fatosDeHoje, TETO_DO_FORMULARIO,
  montarSistema, montarPedido, lerSaida, limparBolhas, juntarDados, violaRegras,
  type FiltrosDaFila,
} from '../services/io/investidorAgentePuro';
import { ABERTURAS, ABERTURA_SEM_NOME } from '../services/io/investidorAgenteTextos';
import { ehFeriadoBR } from '../utils/feriadosBR';
import type { LinhaOrigem } from '../services/io/eletropostoPares';
import type { Compromisso } from '../services/io/eletropostoVagas';

/** Um instante dito em hora de Brasília: brt('2026-10-11T07:59'). */
const brt = (s: string): Date => new Date(`${s}:00-03:00`);

beforeEach(() => {
  delete process.env.JANELA_DIURNA_OFF;
  delete process.env.JANELA_DOMINGO_ON;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('relógio de Brasília', () => {
  it('a data e a hora saem em Brasília, não em UTC', () => {
    // 01:30 UTC de 12/10 ainda é 22:30 de 11/10 em Brasília.
    const d = new Date('2026-10-12T01:30:00Z');
    expect(dataBrasilia(d)).toBe('2026-10-11');
    expect(horaBrasiliaTexto(d)).toBe('2026-10-11 22:30');
    expect(inicioDoDiaBrasiliaIso(d)).toBe('2026-10-11T03:00:00.000Z');
  });

  it('nada sai antes de domingo 11/10/2026 às 08h de Brasília', () => {
    expect(INICIO_ISO).toBe('2026-10-11T11:00:00Z');
    expect(antesDoInicio(brt('2026-10-10T19:00'))).toBe(true);
    expect(antesDoInicio(brt('2026-10-11T07:59'))).toBe(true);
    expect(antesDoInicio(brt('2026-10-11T08:00'))).toBe(false);
  });
});

describe('janela própria', () => {
  it('11/10 (domingo): fechada às 07:59, aberta das 08:00 às 19:59, fechada às 20:00', () => {
    expect(janelaAberta(brt('2026-10-11T07:59'))).toBe(false);
    expect(janelaAberta(brt('2026-10-11T08:00'))).toBe(true);
    expect(janelaAberta(brt('2026-10-11T19:59'))).toBe(true);
    expect(janelaAberta(brt('2026-10-11T20:00'))).toBe(false);
  });

  it('12/10 (feriado, segunda) tem a mesma janela da largada', () => {
    expect(janelaAberta(brt('2026-10-12T08:00'))).toBe(true);
    expect(janelaAberta(brt('2026-10-12T19:59'))).toBe(true);
    expect(janelaAberta(brt('2026-10-12T20:00'))).toBe(false);
  });

  it('13/10 em diante vale a janela da linha: fechada às 08:30, aberta às 09:00', () => {
    expect(janelaAberta(brt('2026-10-13T08:30'))).toBe(false);
    expect(janelaAberta(brt('2026-10-13T09:00'))).toBe(true);
    expect(janelaAberta(brt('2026-10-13T19:59'))).toBe(true);
    expect(janelaAberta(brt('2026-10-13T20:00'))).toBe(false);
  });

  it('domingo 18/10 volta a ser fechado, como em toda a linha', () => {
    expect(janelaAberta(brt('2026-10-18T10:00'))).toBe(false);
    expect(janelaAberta(brt('2026-10-18T15:00'))).toBe(false);
  });
});

describe('teto do dia', () => {
  it('30 em 11/10 e 12/10, 20 em qualquer outra data', () => {
    expect(tetoDoDia(brt('2026-10-11T10:00'))).toBe(30);
    expect(tetoDoDia(brt('2026-10-12T10:00'))).toBe(30);
    expect(tetoDoDia(brt('2026-10-13T10:00'))).toBe(20);
    expect(tetoDoDia(brt('2026-11-03T10:00'))).toBe(20);
  });

  it('a data é a de Brasília: 23:30 de 12/10 ainda vale 30', () => {
    expect(tetoDoDia(brt('2026-10-12T23:30'))).toBe(30);
    expect(tetoDoDia(brt('2026-10-13T00:10'))).toBe(20);
  });

  it('a variável de ambiente só APERTA', () => {
    expect(tetoDoDia(brt('2026-10-11T10:00'), '10')).toBe(10);
    expect(tetoDoDia(brt('2026-10-11T10:00'), '50')).toBe(30);
    expect(tetoDoDia(brt('2026-10-13T10:00'), '50')).toBe(20);
    expect(tetoDoDia(brt('2026-10-13T10:00'), '0')).toBe(0);
    // Lixo na variável não afrouxa nem aperta.
    expect(tetoDoDia(brt('2026-10-11T10:00'), 'abc')).toBe(30);
    expect(tetoDoDia(brt('2026-10-11T10:00'), '-5')).toBe(30);
    expect(tetoDoDia(brt('2026-10-11T10:00'), '')).toBe(30);
  });

  it('a rampa de reconexão da linha também só aperta', () => {
    expect(tetoDoDia(brt('2026-10-11T10:00'), null, 10)).toBe(10);
    expect(tetoDoDia(brt('2026-10-11T10:00'), null, 40)).toBe(30);
    expect(tetoDoDia(brt('2026-10-11T10:00'), '8', 10)).toBe(8);
    expect(tetoDoDia(brt('2026-10-11T10:00'), null, null)).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('nome, telefone e valor', () => {
  it('telefone: com 55 fica, sem 55 ganha, o resto não é telefone', () => {
    expect(telefoneZap('5534991360223')).toBe('5534991360223');
    expect(telefoneZap('(34) 99136-0223')).toBe('5534991360223');
    expect(telefoneZap('3491360223')).toBe('553491360223');
    expect(telefoneZap('123')).toBeNull();
    expect(telefoneZap('120363041234567890')).toBeNull();
    expect(telefoneZap(null)).toBeNull();
  });

  it('primeiro nome com a inicial maiúscula', () => {
    expect(primeiroNome('maria de souza')).toBe('Maria');
    expect(primeiroNome('JOÃO PEDRO')).toBe('João');
    expect(primeiroNome('  Érica ')).toBe('Érica');
  });

  it('os nomes da prova com dado real (11/10/2026)', () => {
    expect(primeiroNome('IGHOR')).toBe('Ighor');
    expect(primeiroNome('MARIANNE RIBEIRO BESERRA DA SILVA')).toBe('Marianne');
    expect(primeiroNome('João')).toBe('João');
    // "Eletro posto" viraria "Olá, Eletro!": é cadastro de empresa, vai sem nome.
    expect(primeiroNome('Eletro posto')).toBeNull();
  });

  it('nome que parece empresa, ou que não é nome, vai sem nome', () => {
    for (const n of ['Eletro posto', 'Posto Ipiranga', 'ELETROPOSTO BRASIL', 'Solar Engenharia', 'Maria Energia Solar', 'JR Comércio LTDA',
      'Paulo Serviços', 'Grupo Alfa', 'Empresa do João', 'Loja da Ana', 'Auto Center Silva', 'Oficina do Zé', 'Transportadora Lima',
      'Construtora Sol', 'Imobiliária Central', 'Consultoria RH', 'Carlos MEI', 'Pedro EIRELI', 'Joao2', 'Ana 34999']) {
      expect(naoPareceNomeDePessoa(n), n).toBe(true);
      expect(primeiroNome(n), n).toBeNull();
    }
  });

  it('nome de gente com pedaço parecido continua sendo nome', () => {
    // "mei" e "auto" só valem como começo de palavra: Almeida e Meire são gente.
    for (const [n, p] of [['Carlos Almeida', 'Carlos'], ['Meire Souza', 'Meire'], ['Paulo Mauto', 'Paulo'], ['Ana Lima', 'Ana']] as const) {
      expect(naoPareceNomeDePessoa(n), n).toBe(false);
      expect(primeiroNome(n), n).toBe(p);
    }
  });

  it('sem nome que dê para usar devolve null (vai a abertura reserva)', () => {
    for (const n of ['', null, '@fulano123', 'J', 'Dr. Paulo', 'Cliente 34', '34999990000', 'Teste']) {
      expect(primeiroNome(n), String(n)).toBeNull();
    }
  });

  it('o valor entra como a pessoa marcou; palavra no começo vai minúscula', () => {
    expect(valorNaFrase('R$ 140 mil')).toBe('R$ 140 mil');
    expect(valorNaFrase('R$ 100 mil a R$ 200 mil')).toBe('R$ 100 mil a R$ 200 mil');
    expect(valorNaFrase('Até R$ 50 mil')).toBe('até R$ 50 mil');
    expect(valorNaFrase('Mais de R$ 500 mil')).toBe('mais de R$ 500 mil');
    expect(valorNaFrase('Acima de R$ 1 milhão')).toBe('acima de R$ 1 milhão');
    expect(valorNaFrase('  R$ 70.000. ')).toBe('R$ 70.000');
  });

  it('valor legível: tem que dar para ler e para citar', () => {
    expect(valorLegivel('R$ 140 mil')).toBe(true);
    expect(valorLegivel('Até R$ 50 mil')).toBe(true);
    expect(valorLegivel('R$ 70.000')).toBe(true);
    expect(valorLegivel('uns 100k')).toBe(false);
    expect(valorLegivel('Depende do ponto')).toBe(false);
    expect(valorLegivel('Tenho uns R$ 80 mil mas depende do banco aprovar o resto do financiamento')).toBe(false);
    expect(valorLegivel('')).toBe(false);
  });
});

describe('a abertura', () => {
  // Uma chave para cada uma das 5 aberturas (soma dos dígitos módulo 5).
  const chaves = ['3400000003', '3400000004', '3400000000', '3400000001', '3400000002'];

  it('a escolha é pela chave: a mesma pessoa recebe sempre a mesma versão', () => {
    expect(chaves.map(c => indicePorChave(c, 5))).toEqual([0, 1, 2, 3, 4]);
    expect(renderAbertura('3400000003', 'Ana', 'R$ 140 mil')).toEqual(renderAbertura('3400000003', 'Ana', 'R$ 140 mil'));
  });

  const formas: Array<[string, string]> = [
    ['R$ 140 mil', 'R$ 140 mil'],
    ['R$ 100 mil a R$ 200 mil', 'R$ 100 mil a R$ 200 mil'],
    ['Até R$ 50 mil', 'até R$ 50 mil'],
    ['Mais de R$ 500 mil', 'mais de R$ 500 mil'],
  ];

  for (const [marcado, naFrase] of formas) {
    it(`"${marcado}" entra nas 5 aberturas como "${naFrase}"`, () => {
      chaves.forEach((chave, i) => {
        const a = renderAbertura(chave, 'carlos eduardo', marcado);
        expect(a.indice).toBe(i);
        expect(a.texto).toContain('Carlos');
        expect(a.texto).toContain(naFrase);
        expect(a.texto).not.toMatch(/[{}]/);
        // Palavra que abre o valor não fica maiúscula no meio da frase.
        if (marcado !== naFrase) expect(a.texto).not.toContain(marcado);
        expect(a.texto.length).toBeLessThanOrEqual(900);   // o teto de uma bolha do sendFrio
      });
    });
  }

  it('cadastro de empresa recebe a reserva, sem "Olá, Eletro!"', () => {
    const a = renderAbertura('3400000003', 'Eletro posto', 'R$ 140 mil');
    expect(a.indice).toBe(-1);
    expect(a.texto).toBe(ABERTURA_SEM_NOME.replace('{valor}', 'R$ 140 mil'));
    expect(a.texto).not.toContain('Eletro');
  });

  it('sem nome usa a reserva, que não chama ninguém pelo nome', () => {
    const a = renderAbertura('3400000003', '@fulano_99', 'Até R$ 50 mil');
    expect(a.indice).toBe(-1);
    expect(a.texto).toBe(ABERTURA_SEM_NOME.replace('{valor}', 'até R$ 50 mil'));
    expect(a.texto).not.toMatch(/[{}]/);
  });

  it('a abertura registrada na sessão é reconstituída pelo índice, não pela chave', () => {
    expect(textoDaAbertura(2, 'ana', 'R$ 140 mil')).toBe(ABERTURAS[2]!.replace('{nome}', 'Ana').replace('{valor}', 'R$ 140 mil'));
    expect(textoDaAbertura(-1, 'ana', 'R$ 140 mil')).toBe(ABERTURA_SEM_NOME.replace('{valor}', 'R$ 140 mil'));
    // Índice que não existe, ou nome que não dá para usar, cai na reserva em vez de sair com "{nome}".
    expect(textoDaAbertura(9, 'ana', 'R$ 140 mil')).not.toMatch(/[{}]/);
    expect(textoDaAbertura(0, '@x1', 'R$ 140 mil')).toBe(ABERTURA_SEM_NOME.replace('{valor}', 'R$ 140 mil'));
  });

  it('o texto renderizado é o do redator, só com as variáveis trocadas', () => {
    const a = renderAbertura('3400000003', 'Ana', 'R$ 140 mil');
    expect(a.texto).toBe(ABERTURAS[0]!.replace('{nome}', 'Ana').replace('{valor}', 'R$ 140 mil'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a fila', () => {
  const cad = (id: number, nome: string, telefone: string, capital_faixa: string, extra: Record<string, unknown> = {}): LinhaOrigem =>
    ({ origem: 'parceria', r: { id, nome, telefone, capital_faixa, lado: 'capital', status: 'novo', cidade: 'Uberlândia', created_at: '2026-09-01T12:00:00Z', ...extra } });
  const fic = (id: number, nome: string, telefone: string, extra: Record<string, unknown> = {}): LinhaOrigem =>
    ({ origem: 'nota1', r: { id, nome, telefone, ficha: '', valor_investir: null, status: 'novo', cidade: null, created_at: '2026-09-20T12:00:00Z', ...extra } });

  const linhas: LinhaOrigem[] = [
    cad(1, 'Ana Lima', '5534999990001', 'R$ 100 mil a R$ 200 mil'),
    cad(2, 'bruno', '34999990002', 'Mais de R$ 500 mil', { created_at: '2026-09-02T12:00:00Z' }),
    cad(3, 'Teste Fulano', '5534999990003', 'R$ 140 mil'),
    cad(4, 'Carla', '5534999990004', 'Até R$ 50 mil'),
    cad(5, 'Davi', '5534999990005', 'R$ 140 mil'),
    cad(6, 'Eva', '5534999990006', 'R$ 140 mil', { status: 'sem_interesse' }),
    cad(7, 'Fábio', '5534999990007', 'R$ 140 mil'),
    cad(8, 'Gil', '5534999990008', 'R$ 140 mil'),
    cad(9, 'Hugo', '5534999990009', 'R$ 140 mil'),
    cad(10, 'Iara', '5534999990010', 'R$ 140 mil'),
    cad(11, 'João', '5534999990011', 'R$ 140 mil'),
    cad(12, 'Karla', '5534999990012', 'R$ 140 mil'),
    cad(13, 'Léo', '123', 'R$ 140 mil'),
    // O dono de um local, cadastrado com o 55...
    { origem: 'parceria', r: { id: 14, nome: 'Dona do Ponto', telefone: '5534999990030', lado: 'ponto', ponto_relacao: 'Sou o proprietário', capital_faixa: null, status: 'novo', created_at: '2026-09-01T12:00:00Z' } },
    // A Ana de novo, na ficha, sem o nono dígito: é a MESMA pessoa.
    fic(21, 'Ana Lima', '553499990001', { valor_investir: 'R$ 140 mil' }),
    fic(22, 'Mara', '5534999990022', { ficha: 'LP ELETROPOSTO · Investidor\nQuanto pretende investir: R$ 200 mil\nDecisor: Eu decido', created_at: '2026-09-25T12:00:00Z' }),
    fic(23, 'Nilo', '5534999990023', { valor_investir: 'uns 100k' }),
    // ...e a mesma dona do local na ficha, sem o 55: o agrupamento por telefone
    // cru não junta as duas, e ela apareceria em Investidores.
    fic(25, 'Dona do Ponto', '34999990030', { valor_investir: 'R$ 140 mil' }),
    // Curioso (não declarou valor): nem entra no grupo.
    fic(26, 'Curioso', '5534999990026'),
  ];

  const filtros = (over: Partial<FiltrosDaFila> = {}): FiltrosDaFila => ({
    comCard: new Set(['3499990005']),
    comSessao: new Set(['3499990007']),
    comConversa: new Set(['3499990012']),
    silenciado: tel => tel.endsWith('0008'),
    mudo: tel => tel.endsWith('0009'),
    bloqueado: tel => tel.endsWith('0010'),
    comHumano: tel => tel.endsWith('0011'),
    ...over,
  });

  it('ordem: maior valor primeiro; no empate, cadastro mais novo primeiro', () => {
    const { fila } = montarFila(linhas, filtros());
    expect(fila.map(c => [c.nome, c.valorMil])).toEqual([
      ['bruno', 500],
      ['Mara', 200],        // 25/09
      ['Ana Lima', 200],    // 01/09
      ['Carla', 50],
    ]);
  });

  it('cada exclusão sai pelo seu motivo', () => {
    const { excluidos } = montarFila(linhas, filtros());
    expect(excluidos).toEqual({
      telefone_invalido: 1,           // Léo
      nome_teste: 1,                  // Teste Fulano
      sem_valor_legivel: 1,           // Nilo ("uns 100k")
      pode_ceder_local: 1,            // a dona do ponto, pela ficha sem o 55
      sem_interesse_no_cadastro: 1,   // Eva
      tem_card: 1,                    // Davi
      tem_sessao: 1,                  // Fábio
      opt_out: 1,                     // Gil
      mudo: 1,                        // Hugo
      bloqueado: 1,                   // Iara
      humano_na_conversa: 1,          // João
      conversa_7_dias: 1,             // Karla
      duplicado: 1,                   // a Ana da ficha
    });
  });

  it('a mesma pessoa no cadastro e na ficha é UMA, e leva as duas linhas', () => {
    const ana = montarFila(linhas, filtros()).fila.find(c => c.chave === '3499990001')!;
    expect(ana.origem).toBe('parceria');
    expect(ana.valorTxt).toBe('R$ 100 mil a R$ 200 mil');
    expect(ana.refs).toEqual([{ origem: 'parceria', id: 1 }, { origem: 'nota1', id: 21 }]);
  });

  it('o telefone sai no formato da Z-API e o valor é o texto que a pessoa marcou', () => {
    const { fila } = montarFila(linhas, filtros());
    expect(fila[0]).toMatchObject({ telefone: '5534999990002', chave: '3499990002', valorTxt: 'Mais de R$ 500 mil', origem: 'parceria', id: 2 });
    expect(fila[1]).toMatchObject({ valorTxt: 'R$ 200 mil', origem: 'nota1', id: 22 });
  });

  it('card compara pela chave DDD + 8, não pelo texto do telefone', () => {
    // O card do Bruno está gravado sem o nono dígito e sem o 55.
    const { fila, excluidos } = montarFila(linhas, filtros({ comCard: new Set(['3499990002']) }));
    expect(fila.some(c => c.nome === 'bruno')).toBe(false);
    expect(excluidos.tem_card).toBe(1);
  });

  it('sem filtro nenhum barrando, só os cortes da própria ficha ficam', () => {
    const tudoLivre = filtros({ comCard: new Set(), comSessao: new Set(), comConversa: new Set(), silenciado: () => false, mudo: () => false, bloqueado: () => false, comHumano: () => false });
    const { fila, excluidos } = montarFila(linhas, tudoLivre);
    expect(fila).toHaveLength(11);
    expect(Object.keys(excluidos).sort()).toEqual(['duplicado', 'nome_teste', 'pode_ceder_local', 'sem_interesse_no_cadastro', 'sem_valor_legivel', 'telefone_invalido']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('os 4 horários', () => {
  const DONO = 'Thiago';
  const semNada: Compromisso[] = [];
  const hhmm = (iso: string) => horarioCurto(iso);

  it('o calendário que a régua usa: 12/10/2026 é feriado nacional', () => {
    expect(ehFeriadoBR('2026-10-12')).toBe(true);
    expect(ehFeriadoBR('2026-10-13')).toBe(false);
  });

  it('sábado à noite: pula o domingo e o feriado de 12/10 e cai na terça 13/10', () => {
    const agora = brt('2026-10-10T22:00').getTime();
    const oferta = horariosDaOferta(DONO, semNada, agora);
    expect(oferta.map(hhmm)).toEqual([
      'Terça 13/10 às 10:00',    // a terça herda a manhã do feriado
      'Terça 13/10 às 13:00',
      'Quarta 14/10 às 13:00',
      'Quarta 14/10 às 15:00',
    ]);
    expect(oferta.map((iso, i) => linhaDoHorario(iso, i))[0]).toBe('1. Terça 13/10 às 10:00');
  });

  it('nenhum horário cai em domingo, sábado ou feriado, e todos são :00 ou :30', () => {
    const agora = brt('2026-10-10T22:00').getTime();
    const livres = vagasLivres(DONO, semNada, agora);
    expect(livres.length).toBeGreaterThan(20);
    for (const iso of livres) {
      const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
      expect([0, 30]).toContain(d.getUTCMinutes());
      expect(d.toISOString().slice(0, 10)).not.toBe('2026-10-12');
      expect(d.toISOString().slice(0, 10)).not.toBe('2026-10-11');
    }
  });

  it('nada com menos de 3 horas de antecedência', () => {
    // Terça 13/10 às 10:30: 13:00 está a 2h30 (fora) e 13:30 está a 3h (entra).
    const agora = brt('2026-10-13T10:30').getTime();
    const livres = vagasLivres(DONO, semNada, agora);
    expect(hhmm(livres[0]!)).toBe('Terça 13/10 às 13:30');
    for (const iso of livres) expect(new Date(iso).getTime() - agora).toBeGreaterThanOrEqual(3 * 3600_000);
    // E a manhã da terça já não aparece.
    expect(horariosDaOferta(DONO, semNada, brt('2026-10-13T08:30').getTime()).map(hhmm)).toEqual([
      'Terça 13/10 às 13:00', 'Terça 13/10 às 15:00', 'Quarta 14/10 às 13:00', 'Quarta 14/10 às 15:00',
    ]);
  });

  it('horário ocupado do MESMO consultor sai; o do outro consultor não atrapalha', () => {
    const agora = brt('2026-10-10T22:00').getTime();
    const dezDaTerca = brt('2026-10-13T10:00').getTime();
    const doThiago: Compromisso[] = [{ ts: dezDaTerca, dono: 'Thiago', ep: true }];
    expect(hhmm(horariosDaOferta('Thiago', doThiago, agora)[0]!)).toBe('Terça 13/10 às 11:00');
    expect(hhmm(horariosDaOferta('Diego', doThiago, agora)[0]!)).toBe('Terça 13/10 às 10:00');
  });

  it('se o primeiro dia não fecha dois, vão os 4 próximos livres', () => {
    // Terça 13/10 às 14:20: só sobra 17:30 na terça.
    const oferta = horariosDaOferta(DONO, semNada, brt('2026-10-13T14:20').getTime());
    expect(oferta.map(hhmm)).toEqual([
      'Terça 13/10 às 17:30', 'Quarta 14/10 às 13:00', 'Quarta 14/10 às 13:30', 'Quarta 14/10 às 14:00',
    ]);
  });

  it('quem pediu outros horários não recebe os mesmos de novo', () => {
    const agora = brt('2026-10-10T22:00').getTime();
    const primeira = horariosDaOferta(DONO, semNada, agora);
    const segunda = horariosDaOferta(DONO, semNada, agora, primeira);
    expect(segunda).toHaveLength(4);
    for (const iso of segunda) expect(primeira).not.toContain(iso);
  });

  it('menos de 4 livres devolve o que houver (quem chama passa para o consultor)', () => {
    expect(escolherQuatro([])).toEqual([]);
    expect(escolherQuatro(['2026-10-13T16:00:00.000Z'])).toEqual(['2026-10-13T16:00:00.000Z']);
  });

  it('a bolha da oferta é UMA mensagem com as 4 linhas numeradas', () => {
    const oferta = horariosDaOferta(DONO, semNada, brt('2026-10-10T22:00').getTime());
    for (const chave of ['3400000000', '3400000001']) {   // as duas variações
      const texto = textoOferta(chave, oferta);
      expect(texto).toContain('1. Terça 13/10 às 10:00');
      expect(texto).toContain('2. Terça 13/10 às 13:00');
      expect(texto).toContain('3. Quarta 14/10 às 13:00');
      expect(texto).toContain('4. Quarta 14/10 às 15:00');
      expect(texto).not.toMatch(/[{}]/);
      expect(texto.length).toBeLessThan(900);
    }
    expect(textoOferta('3400000000', oferta, { foiOcupado: true }).split('\n')[0]).toBe('Esse horário acabou de ser ocupado.');
  });

  it('a confirmação diz o dia, a hora e o consultor', () => {
    const iso = brt('2026-10-13T10:00').toISOString();
    expect(horarioNaFrase(iso)).toBe('terça 13/10 às 10:00');
    for (const chave of ['3400000000', '3400000001']) {
      const t = textoConfirmacao(chave, iso, 'Diego');
      expect(t).toContain('terça 13/10 às 10:00');
      expect(t).toContain('Diego');
      expect(t).not.toMatch(/[{}]/);
    }
  });

  it('BLOQUEANTE: recusa que cita o horário NÃO é escolha', () => {
    for (const t of ['10h não consigo, tem outro?', '15h não dá pra mim', 'Nenhum serve, trabalho até as 15',
      'terça às 10 não posso', 'pode ser o 2 mas antes me explica', 'o 1 ou o 2?', 'nenhum', 'sim']) {
      expect(escolhaPorNumero([t], 4), t).toBeNull();
    }
  });

  it('só o número solto escolhe: "2", " 2 ", "2." e "opção 2"', () => {
    for (const t of ['2', ' 2 ', '2.', 'opção 2', 'Opcao 2', 'a 2', '2!']) expect(escolhaPorNumero([t], 4), t).toBe(1);
    expect(escolhaPorNumero(['1'], 4)).toBe(0);
    expect(escolhaPorNumero(['4'], 4)).toBe(3);
  });

  it('número com cortesia na mesma leva vale; com frase de verdade, não', () => {
    expect(escolhaPorNumero(['2', 'obrigado'], 4)).toBe(1);
    expect(escolhaPorNumero(['ok', '3', 'valeu!'], 4)).toBe(2);
    expect(escolhaPorNumero(['2', 'na verdade nenhum serve'], 4)).toBeNull();
    // Dois números na mesma leva: não dá para saber qual.
    expect(escolhaPorNumero(['2', '3'], 4)).toBeNull();
    expect(escolhaPorNumero(['obrigado'], 4)).toBeNull();
    expect(escolhaPorNumero([], 4)).toBeNull();
  });

  it('número solto fora da lista devolve -1 (pede o número de 1 a 4)', () => {
    expect(escolhaPorNumero(['7'], 4)).toBe(-1);
    expect(escolhaPorNumero(['0'], 4)).toBe(-1);
    expect(escolhaPorNumero(['5'], 4)).toBe(-1);
  });

  it('número solto: separa "2" e "opção 3" de uma frase qualquer', () => {
    expect(numeroSolto('2')).toBe(2);
    expect(numeroSolto(' opção 3. ')).toBe(3);
    expect(numeroSolto('a 4')).toBe(4);
    expect(numeroSolto('7')).toBe(7);
    expect(numeroSolto('2 pessoas vão participar')).toBeNull();
    expect(numeroSolto('pode ser na terça')).toBeNull();
    expect(numeroSolto('')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pedido de parada escrito com todas as letras', () => {
  it('a palavra sozinha ou o pedido escrito viram parada sem depender da IA', () => {
    for (const t of ['pare', 'Parar', 'PARA', 'sair', 'stop.', 'Para de me mandar mensagem', 'não me mande mais mensagem',
      'Não me mandem mais', 'me tira da lista', 'me tire dessa lista por favor', 'não quero receber mais mensagens', 'parem de me chamar']) {
      expect(pediuParar([t]), t).toBe(true);
    }
    expect(pediuParar(['oi', 'pare'])).toBe(true);
  });

  it('desinteresse, dúvida e escolha de horário NÃO são parada: isso é da IA', () => {
    for (const t of ['não tenho interesse', 'agora não', 'para quando seria a reunião?', 'não me mande mais horários, pode ser o 2',
      'para mim a terça é melhor', 'não quero mais receber visita de vendedor', 'sim', '2', 'Parabéns pelo atendimento', '']) {
      expect(pediuParar([t]), t).toBe(false);
    }
    expect(pediuParar([])).toBe(false);
  });
});

describe('a observação do card', () => {
  const base = {
    valorTxt: 'R$ 140 mil',
    dados: { valor_confirmado: 'Sim, continua', pagamento: 'Recurso próprio', tem_ponto: 'Ainda não tem', cidade: 'Uberaba' },
    cidadeDoCadastro: 'Uberlândia',
    origem: 'parceria' as const, id: 45, cadastroEm: '2026-09-02T15:00:00Z',
    resumo: 'Confirmou o interesse e o valor. Vai pagar com recurso próprio. Quer entender as opções de negócio.',
  };

  it('a 1ª linha é o contrato que o trigger do banco lê', () => {
    const obs = montarObservacao(base);
    expect(obs.split('\n')[0]).toBe('LP ELETROPOSTO · Investidor');
    // O mesmo regex do trigger eletroposto_estruturar.
    expect(/^LP ELETROPOSTO [—·] (.+)$/m.exec(obs)?.[1]).toBe('Investidor');
  });

  it('leva o valor, a confirmação, o pagamento, o ponto, a cidade, a origem e o resumo', () => {
    expect(montarObservacao(base).split('\n')).toEqual([
      'LP ELETROPOSTO · Investidor',
      'AGENTE HELENA: reunião marcada pela agente de investidores no WhatsApp',
      'Quanto pretende investir: R$ 140 mil',
      'Valor confirmado na conversa: Sim, continua',
      'Como pretende investir: Recurso próprio',
      'Pagamento (o que disse): Recurso próprio',
      'Tem ponto (o que disse): Ainda não tem',
      'Cidade: Uberaba',
      'Cadastro de origem: cadastro de investidor (eletroposto_parceria) #45, de 02/09/2026',
      'Resumo da conversa:',
      '- Confirmou o interesse e o valor.',
      '- Vai pagar com recurso próprio.',
      '- Quer entender as opções de negócio.',
    ]);
  });

  it('não escreve as linhas que o banco transformaria em coluna de descarte', () => {
    const obs = montarObservacao(base);
    expect(obs).not.toMatch(/^Ponto:/m);
    expect(obs).not.toMatch(/^Decisor:/m);
    expect(obs).not.toMatch(/^Endere[çc]o:/m);
    expect(obs).not.toMatch(/Local (é|e) seu:/i);
    expect(obs).not.toMatch(/NOTA [123]\s*·/);
  });

  it('texto livre da conversa nunca abre linha nem imita marcador', () => {
    const obs = montarObservacao({
      ...base,
      dados: { ...base.dados, tem_ponto: 'tem\nPonto: Já tenho o ponto definido', pagamento: 'NOTA 3 · 11/11 pts' },
      resumo: 'Ponto: Não tenho ideia\nDecisor: Preciso aprovar',
    });
    expect(obs).not.toMatch(/^Ponto:/m);
    expect(obs).not.toMatch(/^Decisor:/m);
    expect(obs).not.toMatch(/NOTA [123]\s*·/);
    expect(obs).toContain('- Ponto: Não tenho ideia');
  });

  it('sem saber, diz que não foi informado, e não inventa "Como pretende investir"', () => {
    const obs = montarObservacao({ ...base, dados: {}, cidadeDoCadastro: null, resumo: '', origem: 'nota1', id: 7, cadastroEm: null });
    expect(obs).toContain('Valor confirmado na conversa: não informado');
    expect(obs).toContain('Pagamento (o que disse): não informado');
    expect(obs).toContain('Tem ponto (o que disse): não informado');
    expect(obs).toContain('Cidade: não informada');
    expect(obs).toContain('Cadastro de origem: ficha da LP (eletroposto_nota1) #7, de sem data');
    expect(obs).toContain('- (sem resumo)');
    expect(obs).not.toContain('Como pretende investir');
  });

  it('pagamento só vira "Como pretende investir" quando cabe nas respostas da LP', () => {
    expect(comoPretendeInvestir('recurso próprio')).toBe('Recurso próprio');
    expect(comoPretendeInvestir('À vista')).toBe('Recurso próprio');
    expect(comoPretendeInvestir('Vai financiar no banco')).toBe('Financiamento pelo banco');
    // O texto EXATO da opção da LP: é o que o trigger casa ("Recurso pr%prio + cart%").
    expect(comoPretendeInvestir('Parte própria e parte financiada')).toBe('Recurso próprio + cartão ou financiamento');
    expect(/^Recurso pr.prio \+ cart/.test(comoPretendeInvestir('Parte própria e parte financiada')!)).toBe(true);
    expect(comoPretendeInvestir('Recurso próprio, não quero financiar')).toBe('Recurso próprio');
    expect(comoPretendeInvestir('ainda não sabe')).toBeNull();
    expect(comoPretendeInvestir('')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('o que a IA recebe', () => {
  const ctx = { nome: 'carlos silva', valorTxt: 'R$ 140 mil', cidade: 'Uberlândia', consultor: 'Diego', oferta: [] as string[], dados: {} };

  it('as regras do redator com o nome do consultor, os fatos e o formato', () => {
    const s = montarSistema(ctx);
    expect(s).toContain('Você é a Helena, assistente virtual');
    expect(s).toContain('marcar uma reunião com Diego');
    expect(s).not.toContain('{consultor}');
    expect(s).toContain('Primeiro nome: Carlos');
    expect(s).toContain('Valor que ela marcou no formulário: R$ 140 mil');
    expect(s).toContain('Consultor que vai atender: Diego');
    expect(s).toContain('"oferecer_horarios"');
    // A ação nova (11/10/2026) está na lista do código e no aviso de mensagem pronta.
    expect(s).toContain('- "adiar": ela quer ser procurada mais para frente');
    expect(s).toContain('Em "oferecer_horarios", "adiar", "humano", "sem_interesse" e "parar" o sistema manda a mensagem pronta no seu lugar');
    // E o bloco de contorno do redator chega ao modelo com o nome do consultor.
    expect(s).toContain('Sua meta em toda conversa é marcar a reunião com Diego.');
    // As regras de conteúdo que não podem faltar.
    expect(s).toContain('Nunca prometa nem sugira rendimento, retorno, lucro ou prazo de retorno');
    expect(s).toContain('Nunca use as palavras "cota" ou "cotista"');
    expect(s).toContain('opções de negócio');
    expect(s).toContain('Nunca diga que é humana');
    expect(s).toContain('Nunca use emoji');
    expect(s).toContain('Nunca use travessão');
    expect(s).toContain('no máximo uma pergunta por resposta');
    // A última linha das instruções técnicas: as palavras que a trava barra.
    expect(s.trimEnd().split('\n').pop()).toBe(
      'Palavras proibidas na resposta: retorno, rendimento, rentabilidade, lucro, payback, garantia, juros, por cento, cota. Para falar disso, diga "os números".');
    // O separador || do rascunho não chega ao modelo: o transporte é a lista "bolhas".
    expect(s).not.toContain('||');
  });

  it('com a lista em aberto, a IA sabe quais horários já foram enviados', () => {
    const s = montarSistema({ ...ctx, oferta: [brt('2026-10-13T10:00').toISOString(), brt('2026-10-13T13:00').toISOString()], dados: { cidade: 'Araguari' } });
    expect(s).toContain('1. Terça 13/10 às 10:00');
    expect(s).toContain('2. Terça 13/10 às 13:00');
    expect(s).toContain('Cidade: Araguari');
  });

  it('a conversa vai em ordem, mídia vira etiqueta e linha vazia some', () => {
    const p = montarPedido(
      [{ from_me: true, texto: 'Oi, Carlos, tudo bem?', tipo: 'texto', momment: '1' }, { from_me: false, texto: '', tipo: 'texto', momment: '2' }],
      [{ from_me: false, texto: 'Sim, continuo', tipo: 'texto', momment: '3' }, { from_me: false, texto: null, tipo: 'audio', momment: '4' }],
    );
    expect(p).toContain('Nós: Oi, Carlos, tudo bem?');
    expect(p).toContain('Cliente: Sim, continuo\nCliente: [audio]');
    expect(p).not.toContain('Cliente: \n');
  });
});

describe('a leitura do que a IA devolve', () => {
  const ok = { bolhas: ['Que bom, Carlos.', 'Esse valor é recurso próprio?'], acao: 'continuar', dados: { valor_confirmado: 'Sim', pagamento: '', tem_ponto: '', cidade: '' }, resumo: 'Confirmou o interesse.' };

  it('JSON válido vira a saída, com até 2 bolhas', () => {
    const s = lerSaida(JSON.stringify({ ...ok, bolhas: ['Um.', 'Dois.', 'Três.'] }));
    expect(s).toMatchObject({ valido: true, acao: 'continuar', resumo: 'Confirmou o interesse.' });
    expect(s.bolhas).toEqual(['Um.', 'Dois.']);
    expect(s.dados.valor_confirmado).toBe('Sim');
  });

  it('JSON embrulhado em texto (modelo reserva) também é lido', () => {
    const s = lerSaida('Claro! Aqui está:\n```json\n' + JSON.stringify(ok) + '\n```');
    expect(s.valido).toBe(true);
    expect(s.bolhas).toHaveLength(2);
  });

  it('inválido vira `humano`, sem bolha nenhuma', () => {
    for (const lixo of ['', 'não sei responder', '{ "bolhas": [', JSON.stringify({ ...ok, acao: 'vender' }), JSON.stringify({ bolhas: ['Oi'] }), 'null', '[]']) {
      expect(lerSaida(lixo), lixo).toEqual({ valido: false, acao: 'humano', bolhas: [], dados: {}, resumo: '' });
    }
  });

  it('cada ação do combinado é aceita', () => {
    for (const acao of ['continuar', 'oferecer_horarios', 'adiar', 'humano', 'sem_interesse', 'parar']) {
      expect(lerSaida(JSON.stringify({ ...ok, acao })).acao).toBe(acao);
    }
  });

  it('bolha sai sem travessão, sem emoji e começando com maiúscula', () => {
    expect(limparBolhas(['que bom — fico feliz 😀', '  ', 'combinado 👍'])).toEqual(['Que bom, fico feliz', 'Combinado']);
    expect(lerSaida(JSON.stringify({ ...ok, bolhas: 'primeira || segunda || terceira' })).bolhas).toEqual(['Primeira', 'Segunda']);
  });

  it('o que a conversa descobriu se acumula; vazio não apaga', () => {
    expect(juntarDados({ cidade: 'Uberaba', pagamento: 'Recurso próprio' }, { cidade: '', pagamento: 'Vai financiar', tem_ponto: 'Não' }))
      .toEqual({ cidade: 'Uberaba', pagamento: 'Vai financiar', tem_ponto: 'Não' });
  });

  it('BLOQUEANTE: a frase da revisão é barrada, e a frase certa passa', () => {
    expect(violaRegras(['O retorno é de 3 por cento ao mês, veja solardoc.app/x e lucro garantido'])).not.toBeNull();
    expect(violaRegras(['Os números certinhos quem passa é o Thiago, na reunião, com base no seu caso.'])).toBeNull();
  });

  it('cada palavra de promessa é barrada, com e sem acento, maiúscula ou não', () => {
    for (const t of ['Qual o retorno?', 'O RENDIMENTO é bom', 'tem boa rentabilidade', 'é rentável', 'E RENTAVEL', 'dá lucro', 'negócio lucrativo',
      'o payback é curto', 'tem garantia', 'é garantido', 'Garantimos o resultado', 'rende 3 por cento', 'sem juros', 'Os Lucros são seus']) {
      expect(violaRegras([t]), t).not.toBeNull();
    }
  });

  it('cota, percentual, link e domínio solto', () => {
    expect(violaRegras(['Você pode entrar como cotista.'])).toBe('falou em cota');
    expect(violaRegras(['São cotas de R$ 70 mil.'])).toBe('falou em cota');
    expect(violaRegras(['Sobe 3% ao mês.'])).toBe('citou percentual');
    expect(violaRegras(['Veja em https://exemplo'])).toBe('colocou link');
    for (const t of ['Entra em solardoc.app', 'me chama em wa.me/5534999990000', 'veja nexus.com.br', 'site.net', 'pagina.io', 'ong.org', 'loja.com']) {
      expect(violaRegras([t]), t).toMatch(/endereço de site/);
    }
  });

  it('ressalva da revisão: "rende", "ganha ... por mês" e "se paga" também são barrados', () => {
    expect(violaRegras(['Rende bem, você ganha uns 4 mil por mês'])).not.toBeNull();
    expect(violaRegras(['Se paga em 2 anos'])).not.toBeNull();
    expect(violaRegras(['Não ter ponto não impede nada.'])).toBeNull();
    for (const t of ['Isso rende', 'Está rendendo bem', 'Dá uma boa renda', 'O ponto se paga rápido', 'Eles se pagam sozinhos',
      'Você ganha uns 4 mil', 'Dá para ganhar por mês', 'Ganhando 5 mil todo mês']) {
      expect(violaRegras([t]), t).not.toBeNull();
    }
  });

  it('"ganhar" sem número nem "por mês" é conversa, e o número de OUTRA frase não conta', () => {
    expect(violaRegras(['Você ganha tempo falando direto com o consultor.'])).toBeNull();
    expect(violaRegras(['Você ganha tempo com isso. Posso mandar os 4 horários?'])).toBeNull();
    // Palavras que só parecem: atender, entender e aprender não são "rend".
    expect(violaRegras(['O Diego vai te atender e você vai entender tudo.'])).toBeNull();
  });

  it('conversa normal não é barrada', () => {
    for (const t of ['Temos opções de negócio para o seu perfil.', 'O consultor leva a cotação na reunião.', 'Esse valor é recurso próprio?',
      'Em que cidade você pensa em montar?', 'Posso te mandar os horários para conversar com o Diego?', 'R$ 140 mil, certo?',
      'Que bom. Você já tem um local em mente?', 'Combinado, Ana.']) {
      expect(violaRegras([t]), t).toBeNull();
    }
  });

  it('o pedido de reescrita diz qual regra quebrou e o que tinha sido escrito', () => {
    const p = pedidoDeReescrita('PEDIDO ORIGINAL', 'usou a palavra "retorno"', ['O retorno é ótimo.']);
    expect(p.startsWith('PEDIDO ORIGINAL')).toBe(true);
    expect(p).toContain('usou a palavra "retorno"');
    expect(p).toContain('O retorno é ótimo.');
    expect(p).toContain('NÃO foi enviada');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('o que a pessoa JÁ respondeu no formulário', () => {
  const FICHA = [
    'LP ELETROPOSTO · Investidor',
    'Modelo de interesse: Modelo 02',
    'NOTA 1 · 5/11 pts (sem ponto próprio)',
    'Ponto: Não tenho ideia de onde instalar',
    'Local é seu: Ainda não é meu',
    'Como pretende investir: Financiamento · empresa com CNPJ e faturamento',
    'Quanto pretende investir: R$ 140 mil',
    'Decisor: Eu decido',
    'Entrada trifásica: Sim',
    'PONTO DISPONIVEL PARA INVESTIDOR',
    'Simulou 80 kW com 30 carros/dia',
    'Investimento estimado: R$ 350.000',
    '→ payback 3,2 anos · lucro R$ 9.000/mês',
  ].join('\n');

  it('da ficha entram só as linhas "Rótulo: resposta"', () => {
    expect(respostasDaFicha(FICHA)).toEqual([
      'Modelo de interesse: Modelo 02',
      'Ponto: Não tenho ideia de onde instalar',
      'Local é seu: Ainda não é meu',
      'Como pretende investir: Financiamento · empresa com CNPJ e faturamento',
      'Quanto pretende investir: R$ 140 mil',
      'Decisor: Eu decido',
      'Entrada trifásica: Sim',
    ].map(l => l.replace(' · ', ', ')));
  });

  it('o cabeçalho, a NOTA e as contas do simulador NUNCA entram', () => {
    const bloco = fatosDoFormulario([{ origem: 'nota1', r: { ficha: FICHA, created_at: '2026-09-18T15:00:00Z' } }]).join('\n');
    expect(bloco).not.toMatch(/LP ELETROPOSTO/i);
    expect(bloco).not.toMatch(/\bnota\b/i);
    expect(bloco).not.toMatch(/\bpts\b|\/11/i);
    expect(bloco).not.toMatch(/payback|lucro|Investimento estimado|Simulou/i);
    expect(bloco).not.toContain('PONTO DISPONIVEL');
    // Variações de como a nota aparece.
    for (const linha of ['NOTA 3 · 11/11 pts', 'Nota: 2', 'Pontuação: 7', 'nota 1 - 4/11 pts (sem ponto próprio)']) {
      expect(respostasDaFicha(linha), linha).toEqual([]);
    }
  });

  it('a data do cadastro vai por extenso, em Brasília', () => {
    const bloco = fatosDoFormulario([{ origem: 'nota1', r: { ficha: FICHA, created_at: '2026-09-19T01:30:00Z' } }]);
    expect(bloco[0]).toBe('Na página do eletroposto (preencheu o formulário em 18/09/2026):');
    expect(bloco).toContain('  Decisor: Eu decido');
  });

  it('do cadastro de parceria entram as colunas de resposta, com o lado por extenso', () => {
    const bloco = fatosDoFormulario([{ origem: 'parceria', r: {
      id: 45, nome: 'Carlos', telefone: '5534999990001', status: 'falando', obs: 'ANOTAÇÃO INTERNA', utm_source: 'meta',
      cidade: 'Uberaba', lado: 'capital', capital_faixa: 'R$ 100 mil a R$ 200 mil', prazo: 'Nos próximos 3 meses',
      ponto_relacao: null, ponto_tipo: '', created_at: '2026-09-25T12:00:00Z',
    } }]);
    expect(bloco).toEqual([
      'No cadastro de parceria (preencheu o formulário em 25/09/2026):',
      '  Cidade: Uberaba',
      '  Entrou pelo cadastro de: investidor (quer investir)',
      '  Quanto pretende investir: R$ 100 mil a R$ 200 mil',
      '  Quando pretende começar: Nos próximos 3 meses',
    ]);
    // Coluna que não é resposta da pessoa não entra.
    expect(bloco.join('\n')).not.toMatch(/ANOTAÇÃO|utm|falando|5534999990001/);
  });

  it('pessoa nas duas tabelas: junta as duas fontes sem repetir a mesma resposta', () => {
    const bloco = fatosDoFormulario([
      { origem: 'parceria', r: { cidade: 'Uberaba', lado: 'capital', capital_faixa: 'R$ 140 mil', created_at: '2026-09-25T12:00:00Z' } },
      { origem: 'nota1', r: { ficha: FICHA, cidade: 'Uberaba', created_at: '2026-09-18T15:00:00Z' } },
    ]);
    expect(bloco.filter(l => l.trim() === 'Quanto pretende investir: R$ 140 mil')).toHaveLength(1);
    expect(bloco.filter(l => l.trim() === 'Cidade: Uberaba')).toHaveLength(1);
    expect(bloco).toContain('No cadastro de parceria (preencheu o formulário em 25/09/2026):');
    expect(bloco).toContain('Na página do eletroposto (preencheu o formulário em 18/09/2026):');
    expect(bloco).toContain('  Decisor: Eu decido');
  });

  it('o bloco para em 1.500 caracteres', () => {
    // Rótulo da lista de permissão, com respostas diferentes, para encher o bloco.
    const gigante = Array.from({ length: 80 }, (_, i) => `Ponto: ${'resposta comprida '.repeat(6)}${i}`).join('\n');
    const bloco = fatosDoFormulario([{ origem: 'nota1', r: { ficha: gigante, created_at: '2026-09-18T15:00:00Z' } }]);
    expect(bloco.length).toBeGreaterThan(3);
    expect(bloco.join('\n').length).toBeLessThanOrEqual(TETO_DO_FORMULARIO);
  });

  it('sem resposta nenhuma não há bloco', () => {
    expect(fatosDoFormulario(undefined)).toEqual([]);
    expect(fatosDoFormulario([{ origem: 'nota1', r: { ficha: 'LP ELETROPOSTO · Investidor\nNOTA 1 · 3/11 pts' } }])).toEqual([]);
  });

  it('entra nos fatos do sistema, fora do bloco do redator, com a instrução de não perguntar de novo', () => {
    const s = montarSistema({
      nome: 'Carlos', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Thiago', oferta: [], dados: {},
      formulario: [{ origem: 'nota1', r: { ficha: FICHA, created_at: '2026-09-18T15:00:00Z' } }],
    });
    const fatos = s.slice(s.indexOf('O QUE VOCÊ SABE DESTA PESSOA'));
    expect(fatos).toContain('O que ela JÁ RESPONDEU no formulário:');
    expect(fatos).toContain('  Como pretende investir: Financiamento, empresa com CNPJ e faturamento');
    expect(fatos).toContain('O que já está respondido aqui você NÃO pergunta de novo. Confirme em uma frase se for útil e siga para o que falta.');
    expect(s).not.toMatch(/\bNOTA 1\b|\/11 pts/);
    // Sem formulário, o bloco não aparece.
    expect(montarSistema({ nome: 'Carlos', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Thiago', oferta: [], dados: {} }))
      .not.toContain('JÁ RESPONDEU');
  });
});

describe('que dia é hoje', () => {
  it('domingo 11/10/2026: hoje não tem atendimento, amanhã é feriado, o próximo dia é terça 13/10', () => {
    const f = fatosDeHoje(brt('2026-10-11T14:32'));
    expect(f[0]).toBe('Agora são 14:32 de domingo, 11/10/2026, horário de Brasília.');
    expect(f[1]).toBe('Hoje é domingo: não tem atendimento.');
    expect(f[2]).toBe('Amanhã, segunda-feira, 12/10/2026, é feriado nacional: não tem atendimento.');
    expect(f).toContain('O consultor atende de segunda a sexta-feira, menos em feriado. Sábado e domingo não tem reunião.');
    expect(f).toContain('O próximo dia com atendimento é terça-feira, 13/10/2026.');
  });

  it('terça 13/10: hoje e amanhã têm atendimento', () => {
    const f = fatosDeHoje(brt('2026-10-13T09:05'));
    expect(f[0]).toBe('Agora são 09:05 de terça-feira, 13/10/2026, horário de Brasília.');
    expect(f[1]).toBe('Hoje é dia útil: tem atendimento.');
    expect(f[2]).toBe('Amanhã, quarta-feira, 14/10/2026, é dia útil: tem atendimento.');
  });

  it('sexta à noite: amanhã é sábado e o próximo dia é segunda', () => {
    const f = fatosDeHoje(brt('2026-10-16T21:00'));
    expect(f[2]).toBe('Amanhã, sábado, 17/10/2026, é sábado: não tem atendimento.');
    expect(f).toContain('O próximo dia com atendimento é segunda-feira, 19/10/2026.');
  });

  it('a data é a de Brasília: 01:30 UTC de segunda ainda é domingo à noite', () => {
    expect(fatosDeHoje(new Date('2026-10-12T01:30:00Z'))[0]).toBe('Agora são 22:30 de domingo, 11/10/2026, horário de Brasília.');
  });

  it('entra no sistema só quando a hora é informada', () => {
    const base = { nome: 'Carlos', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Thiago', oferta: [], dados: {} };
    const com = montarSistema({ ...base, agora: brt('2026-10-11T14:32') });
    expect(com).toContain('QUE DIA É HOJE');
    expect(com).toContain('Amanhã, segunda-feira, 12/10/2026, é feriado nacional: não tem atendimento.');
    expect(com).toContain('Mensagem de dias atrás é conversa antiga');
    expect(montarSistema(base)).not.toContain('QUE DIA É HOJE');
  });
});

describe('histórico com data', () => {
  it('cada linha leva a data e a hora de Brasília na frente', () => {
    const p = montarPedido(
      [
        { from_me: true, texto: 'Promoção de solar, quer um orçamento?', tipo: 'texto', momment: '2026-09-18T17:32:00.000Z' },
        { from_me: true, texto: 'Oi, Carlos, tudo bem? Sou a Helena.', tipo: 'texto', momment: '2026-10-12T11:00:00.000Z' },
      ],
      [{ from_me: false, texto: 'Sim', tipo: 'texto', momment: '2026-10-12T11:07:00.000Z' }, { from_me: false, texto: null, tipo: 'audio', momment: '2026-10-13T02:10:00.000Z' }],
    );
    expect(p).toContain('[18/09 14:32] Nós: Promoção de solar, quer um orçamento?');
    expect(p).toContain('[12/10 08:00] Nós: Oi, Carlos, tudo bem? Sou a Helena.');
    expect(p).toContain('[12/10 08:07] Cliente: Sim');
    // 02:10 UTC de 13/10 ainda é 23:10 de 12/10 em Brasília.
    expect(p).toContain('[12/10 23:10] Cliente: [audio]');
  });

  it('data que não dá para ler fica sem carimbo, em vez de inventada', () => {
    const p = montarPedido([], [{ from_me: false, texto: 'Oi', tipo: 'texto', momment: '3' }, { from_me: false, texto: 'Tudo bem?', tipo: 'texto', momment: '' }]);
    expect(p).toContain('\nCliente: Oi\nCliente: Tudo bem?');
    expect(p).not.toContain('[');
  });
});

describe('a ficha é lista de PERMISSÃO (ressalva da revisão)', () => {
  it('só entram os rótulos que a página do eletroposto pergunta', () => {
    const ficha = [
      'LP ELETROPOSTO · Posto',
      'Local é seu: Sou o proprietário',
      'Ponto: Já tenho o ponto definido',
      'Endereço: Av. Brasil, 100 · Centro · Uberlândia',
      'Vagas disponíveis: 4 a 6',
      'Modelo de interesse: 02 · Sociedade meio a meio',
      'Rota de passagem: Rodovia',
      'Como pretende investir: Recurso próprio',
      'Quanto pretende investir: R$ 140 mil',
      'Decisor: Eu decido',
      'Entrada trifásica: Sim',
      'Cidade: Uberlândia',
      'Prazo: Nos próximos 3 meses',
    ].join('\n');
    expect(respostasDaFicha(ficha).map(l => l.split(':')[0])).toEqual([
      'Local é seu', 'Ponto', 'Endereço', 'Vagas disponíveis', 'Modelo de interesse', 'Rota de passagem',
      'Como pretende investir', 'Quanto pretende investir', 'Decisor', 'Entrada trifásica', 'Cidade', 'Prazo',
    ]);
  });

  it('rótulo desconhecido fica de fora, mesmo com cara de resposta', () => {
    for (const linha of [
      'Observação do consultor: cliente difícil, não insistir',
      'Classificação: frio',
      'Para onde vai: Curioso',
      'Você já tem reunião marcada: terça às 14h',
      'Investimento estimado: R$ 350.000',
      'Potência: 80 kW',
      'Unidades: 2',
      'Software e app: Sim',
      'Instalação: Com obra',
      'Outro: qualquer coisa',
      'Score: 7',
    ]) {
      expect(respostasDaFicha(linha), linha).toEqual([]);
    }
  });

  it('o rótulo casa sem depender de acento ou de maiúscula', () => {
    expect(respostasDaFicha('LOCAL E SEU: Sou inquilino\nentrada trifasica: Não sei')).toEqual(['LOCAL E SEU: Sou inquilino', 'entrada trifasica: Não sei']);
  });
});

describe('a trava de conteúdo barra o FORMATO da reunião (11/10/2026)', () => {
  it('vídeo, videochamada, chamada de vídeo, link, online, meet, zoom, "sem instalar" e presencial', () => {
    for (const t of ['A reunião é por vídeo.', 'É uma VIDEOCHAMADA rápida', 'Uma chamada de vídeo com o Thiago', 'Ele manda o link antes',
      'É tudo online', 'É on-line', 'A gente faz pelo Meet', 'Pode ser por Zoom', 'Você entra sem instalar nada', 'Não é presencial', 'É presencialmente',
      'Os vídeos explicam tudo', 'Te mando os links']) {
      expect(violaRegras([t]), t).toMatch(/formato da reunião/);
    }
  });

  it('celular, computador e telefone NÃO são barrados (ficam só na instrução, para não dar falso positivo)', () => {
    for (const t of ['Esse é o seu celular mesmo?', 'Pode responder quando estiver no computador.', 'O Thiago fala com você pelo telefone dele.',
      'O Thiago combina os detalhes com você pelo WhatsApp dele antes do horário.', 'É uma conversa com o Thiago, e ele combina os detalhes com você.',
      'Você escolhe o horário que encaixar na sua agenda.']) {
      expect(violaRegras([t]), t).toBeNull();
    }
  });

  it('o pedido de reescrita lembra de dizer só "reunião"', () => {
    const p = pedidoDeReescrita('PEDIDO', 'falou do formato da reunião ("video")', ['É por vídeo.']);
    expect(p).toContain('falou do formato da reunião');
    expect(p).toContain('diga só "reunião" ou "conversa com o consultor"');
  });
});

