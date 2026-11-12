import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A parte pura da Helena (agente de investidores): relógio, fila, textos,
// horários, observação do card e leitura da IA. Nada aqui toca rede: os clientes
// de banco são trocados por objetos vazios e nenhum teste os chama.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  INICIO_ISO, antesDoInicio, janelaAberta, janelaDeResposta, tetoDoDia, dataBrasilia, horaBrasiliaTexto, inicioDoDiaBrasiliaIso,
  telefoneZap, primeiroNome, valorNaFrase, valorLegivel, renderAbertura, renderRetomada, indicesDeAbertura, varianteDoTipo, TIPOS_HELENA,
  montarFila, CADASTRO_MINIMO_MS, cardReabre, cardParaRemarcar, tipoDoTipoCard, sessaoVoltaComoRetorno, ultimoEnvioDaSessao,
  montarFichaConsultor, linhaDaFichaNoHistorico, CAMPOS_DA_FICHA, TETO_DA_FICHA,
  type CardDoContato, type CardEletroposto, vagasLivres, escolherQuatro, horariosDaOferta, horarioCurto, linhaDoHorario, horarioNaFrase,
  textoOferta, textoConfirmacao, numeroSolto, escolhaPorNumero, pediuParar, textoDaAbertura, montarObservacao, comoPretendeInvestir,
  naoPareceNomeDePessoa, pedidoDeReescrita, respostasDaFicha, fatosDoFormulario, fatosDeHoje, TETO_DO_FORMULARIO,
  montarSistema, montarPedido, lerSaida, limparBolhas, juntarDados, violaRegras,
  ehConviteDeHorario, textoEncerramentoPreparo,
  type FiltrosDaFila,
} from '../services/io/investidorAgentePuro';
import { ABERTURAS_POR_TIPO, RETOMADAS_POR_VARIANTE, ENCERRAMENTO_DO_PREPARO } from '../services/io/investidorAgenteTextos';
import {
  escolhaPendenteDe, dentroDaJanelaDeRecuperacao, SCHEMA_SAIDA_HELENA, ACOES_HELENA,
  escolhaPorNumero as escolha, lerSaida as ler, montarSistema as sistema, type MsgDaConversa,
} from '../services/io/investidorAgentePuro';
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

// ─────────────────────────────────────────────────────────────────────────────
describe('a abertura (12/11/2026: por tipo, hash da chave, retorno)', () => {
  const chaveDeCada = (n: number) => Array.from({ length: n }, (_, i) => `34${String(90000000 + i * 7919)}`);

  it('a mesma pessoa recebe sempre a mesma versão, e o hash espalha as pessoas pelas 3 aberturas', () => {
    const ctx = { tipo: 'investidor' as const };
    expect(renderAbertura('3499990001', 'Ana', 'R$ 140 mil', ctx)).toEqual(renderAbertura('3499990001', 'Ana', 'R$ 140 mil', ctx));
    const usados = new Set(chaveDeCada(60).map(c => renderAbertura(c, 'Ana', 'R$ 140 mil', ctx).indice));
    expect([...usados].sort()).toEqual([0, 1, 2]);
  });

  it('cada tipo usa as suas aberturas, e todas passam pela trava de conteúdo e cabem numa bolha', () => {
    for (const tipo of TIPOS_HELENA) {
      for (const chave of chaveDeCada(30)) {
        for (const nome of ['carlos eduardo', null]) {
          const a = renderAbertura(chave, nome, tipo === 'investidor' ? 'R$ 100 mil a R$ 200 mil' : '', { tipo, cidade: 'Uberlândia' });
          expect(a.texto).not.toMatch(/[{}]/);
          expect(a.texto.length).toBeLessThanOrEqual(900);
          expect(violaRegras([a.texto], [100_000, 200_000]), `${tipo}: ${a.texto}`).toBeNull();
          expect(a.texto).toContain('Helena');
          if (nome) expect(a.texto).toContain('Carlos');
        }
      }
    }
  });

  it('o Investidor cita o valor que a pessoa marcou, com a primeira palavra em minúscula no meio da frase', () => {
    for (const [marcado, naFrase] of [['R$ 140 mil', 'R$ 140 mil'], ['Até R$ 50 mil', 'até R$ 50 mil'], ['Mais de R$ 500 mil', 'mais de R$ 500 mil']] as const) {
      const a = renderAbertura('3400000003', 'Ana', marcado, { tipo: 'investidor' });
      expect(a.texto).toContain(naFrase);
      if (marcado !== naFrase) expect(a.texto).not.toContain(marcado);
    }
  });

  it('a abertura 2 do Arrendamento só quando há cidade', () => {
    expect(indicesDeAbertura('arrendamento', 'Uberlândia')).toEqual([0, 1, 2]);
    expect(indicesDeAbertura('arrendamento', '')).toEqual([0, 2]);
    expect(indicesDeAbertura('arrendamento', null)).toEqual([0, 2]);
    for (const chave of chaveDeCada(60)) {
      expect(renderAbertura(chave, 'Ana', '', { tipo: 'arrendamento', cidade: null }).indice).not.toBe(1);
    }
    const comCidade = chaveDeCada(60).map(c => renderAbertura(c, 'Ana', '', { tipo: 'arrendamento', cidade: 'Catalão' }));
    expect(comCidade.some(a => a.indice === 1)).toBe(true);
    for (const a of comCidade.filter(x => x.indice === 1)) expect(a.texto).toContain('um local em Catalão');
  });

  it('nome de empresa ou sem nome: o mesmo molde do redator sem o nome (nunca "Olá, Eletro!")', () => {
    for (const nome of ['Eletro posto', '@fulano_99', '', null]) {
      for (const tipo of TIPOS_HELENA) {
        const a = renderAbertura('3400000003', nome, 'R$ 140 mil', { tipo, cidade: 'Catalão' });
        expect(a.texto).not.toContain('Eletro');
        expect(a.texto).not.toMatch(/[{}]/);
        expect(a.texto).not.toMatch(/\s,|,\s*[,!.]|\s{2,}|^[,!.\s]/);
      }
    }
  });

  it('a abertura registrada na sessão é reconstituída pelo índice, não pela chave', () => {
    expect(textoDaAbertura(2, 'ana', 'R$ 140 mil', { tipo: 'investidor' })).toBe(ABERTURAS_POR_TIPO.investidor[2]!.replace('{nome}', 'Ana').replace('{valor}', 'R$ 140 mil'));
    // Índice que não existe cai na primeira abertura, em vez de sair com "{nome}".
    expect(textoDaAbertura(9, 'ana', 'R$ 140 mil', { tipo: 'curioso' })).toBe(ABERTURAS_POR_TIPO.curioso[0]!.replace('{nome}', 'Ana'));
  });

  it('RETORNO: a abertura é o texto do toque 4 da variante do tipo (local para Arrendamento, capital para os outros)', () => {
    expect(renderAbertura('3400000003', 'Ana', 'R$ 140 mil', { tipo: 'arrendamento', retorno: true }).texto)
      .toBe(RETOMADAS_POR_VARIANTE[4].local.replace('{nome}', 'Ana'));
    for (const tipo of ['investidor', 'parceiro', 'curioso'] as const) {
      expect(renderAbertura('3400000003', 'Ana', '', { tipo, retorno: true }).texto).toBe(RETOMADAS_POR_VARIANTE[4].capital.replace('{nome}', 'Ana'));
    }
    expect(varianteDoTipo('arrendamento')).toBe('local');
    expect(varianteDoTipo('investidor')).toBe('capital');
  });

  it('as retomadas por variante saem com e sem nome, e passam pela trava de conteúdo', () => {
    for (const toque of [2, 3, 4, 5] as const) {
      for (const tipo of TIPOS_HELENA) {
        for (const nome of ['Ana Lima', null]) {
          const t = renderRetomada(toque, nome, tipo);
          expect(t.texto).not.toMatch(/[{}]/);
          expect(violaRegras([t.texto])).toBeNull();
          expect(t.indice).toBe(nome ? 0 : -1);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a fila (12/11/2026: todos os tipos, só quem tem card não atendido, ordem estrita)', () => {
  const AGORA = Date.parse('2026-11-12T15:00:00Z');
  const cad = (id: number, nome: string, telefone: string, capital_faixa: string | null, extra: Record<string, unknown> = {}): LinhaOrigem =>
    ({ origem: 'parceria', r: { id, nome, telefone, capital_faixa, lado: 'capital', status: 'novo', cidade: 'Uberlândia', created_at: '2026-09-01T12:00:00Z', ...extra } });
  const fic = (id: number, nome: string, telefone: string, extra: Record<string, unknown> = {}): LinhaOrigem =>
    ({ origem: 'nota1', r: { id, nome, telefone, ficha: '', valor_investir: null, status: 'novo', cidade: null, created_at: '2026-09-20T12:00:00Z', ...extra } });
  const card = (id: number, status = 'cancelado', extra: Partial<CardDoContato> = {}): CardDoContato =>
    ({ id, status, quando: '2026-10-01T15:00:00Z', origem: 'lp_eletroposto', vendedor: 'Thiago', ...extra });
  const lote = (id: number, quando = '2026-12-01T15:00:00Z'): CardDoContato => card(id, 'agendado', { origem: 'cadastro_eletroposto', quando });

  const livre: FiltrosDaFila = {
    cards: new Map(), comSessao: new Set(), retorno: new Set(), comConversa: new Set(),
    silenciado: () => false, bloqueado: () => false, mudo: () => false, comHumano: () => false, agora: AGORA,
  };
  /** Os cards entram por chave (DDD + 8). */
  const comCards = (mapa: Record<string, CardDoContato[]>, extra: Partial<FiltrosDaFila> = {}): FiltrosDaFila =>
    ({ ...livre, cards: new Map(Object.entries(mapa)), ...extra });
  const nomes = (r: { fila: Array<{ nome: string | null }> }) => r.fila.map(c => c.nome);

  it('os 4 tipos, pela mesma regra da aba Cadastros: ponto = Arrendamento, R$ 50 mil ou mais = Investidor, integrador = Parceiro, o resto = Curioso', () => {
    const linhas: LinhaOrigem[] = [
      cad(1, 'Ana Investidora', '5534999990001', 'R$ 140 mil'),
      cad(2, 'Bia Dona', '5534999990002', null, { lado: 'ponto', ponto_relacao: 'Sou o proprietário' }),
      cad(3, 'Caio Instalador', '5534999990003', null, { lado: 'integrador' }),
      cad(4, 'Duda Curiosa', '5534999990004', 'Até R$ 20 mil'),
      fic(5, 'Edu Ficha', '5534999990005', { valor_investir: 'Mais de R$ 500 mil' }),
    ];
    const cards = Object.fromEntries(['3499990001', '3499990002', '3499990003', '3499990004', '3499990005'].map((k, i) => [k, [card(10 + i)]]));
    const r = montarFila(linhas, comCards(cards));
    expect(Object.fromEntries(r.fila.map(c => [c.nome, c.tipo]))).toEqual({
      'Ana Investidora': 'investidor', 'Bia Dona': 'arrendamento', 'Caio Instalador': 'parceiro', 'Duda Curiosa': 'curioso', 'Edu Ficha': 'investidor',
    });
    expect(r.porTipo).toEqual({ arrendamento: 1, investidor: 2, parceiro: 1, curioso: 1 });
    // Piso e "só capital" saíram: quem tem menos de R$ 50 mil ENTRA, como Curioso, e não leva valor para citar.
    expect(r.fila.find(c => c.nome === 'Duda Curiosa')).toMatchObject({ tipo: 'curioso', valorTxt: '' });
  });

  it('ordem ESTRITA por tipo, sem rodízio: investidores, depois arrendamento, parceiro e curioso por último', () => {
    const linhas: LinhaOrigem[] = [
      cad(1, 'Curioso 1', '5534999990001', null),
      cad(2, 'Parceiro 1', '5534999990002', null, { lado: 'integrador' }),
      cad(3, 'Dono 1', '5534999990003', null, { lado: 'ponto', ponto_relacao: 'Sou o proprietário' }),
      cad(4, 'Investidor 1', '5534999990004', 'R$ 140 mil'),
      cad(5, 'Investidor 2', '5534999990005', 'Mais de R$ 500 mil'),
      cad(6, 'Dono 2', '5534999990006', null, { lado: 'ponto', ponto_relacao: 'Sou o proprietário', created_at: '2026-10-01T12:00:00Z' }),
    ];
    const cards = Object.fromEntries(linhas.map((l, i) => [`34${String(l.r.telefone).slice(-8)}`, [card(100 + i)]]));
    expect(nomes(montarFila(linhas, comCards(cards)))).toEqual(['Investidor 2', 'Investidor 1', 'Dono 2', 'Dono 1', 'Parceiro 1', 'Curioso 1']);
  });

  it('dentro do tipo: primeiro quem já pediu reunião (card parado), depois o lote mudo; Investidor por valor, os outros pelo card mais recente', () => {
    const linhas: LinhaOrigem[] = [
      cad(1, 'Lote grande', '5534999990001', 'Mais de R$ 500 mil'),
      cad(2, 'Parado pequeno', '5534999990002', 'R$ 100 mil'),
      cad(3, 'Parado médio', '5534999990003', 'R$ 140 mil'),
      cad(4, 'Curioso velho', '5534999990004', null),
      cad(5, 'Curioso novo', '5534999990005', null),
    ];
    const r = montarFila(linhas, comCards({
      '3499990001': [lote(50)], '3499990002': [card(51)], '3499990003': [card(52, 'nao_atendeu')],
      '3499990004': [card(60)], '3499990005': [card(70)],
    }));
    expect(nomes(r)).toEqual(['Parado médio', 'Parado pequeno', 'Lote grande', 'Curioso novo', 'Curioso velho']);
    expect(r.fila.map(c => c.faixa)).toEqual(['card_parado', 'card_parado', 'lote_mudo', 'card_parado', 'card_parado']);
  });

  it('SÓ entra quem tem card não atendido: sem card nenhum fica fora, e o status arrendamento conta como atendido', () => {
    const linhas = [cad(1, 'Sem card', '5534999990001', 'R$ 140 mil'), cad(2, 'Com card', '5534999990002', 'R$ 140 mil'), cad(3, 'Arrendamento', '5534999990003', 'R$ 140 mil')];
    const r = montarFila(linhas, comCards({ '3499990002': [card(2)], '3499990003': [card(3, 'arrendamento')] }));
    expect(nomes(r)).toEqual(['Com card']);
    expect(r.excluidos).toMatchObject({ sem_card: 1, card_vivo: 1 });
  });

  it('cards: cancelado, nao_atendeu, lote mudo em qualquer data e agendado de outra origem vencido há mais de 24h reabrem', () => {
    const ok = [card(1, 'cancelado'), card(2, 'nao_atendeu'), lote(3, '2026-11-20T15:00:00Z'), lote(4, '2026-10-01T15:00:00Z'),
      card(5, 'agendado', { quando: '2026-11-10T15:00:00Z' })];
    for (const c of ok) expect(cardReabre(c, AGORA), `${c.status} ${c.origem}`).toBe(true);
    const nao = [card(6, 'agendado', { quando: '2026-11-13T15:00:00Z' }), card(7, 'agendado', { quando: '2026-11-12T10:00:00Z' }),
      ...['sem_interesse', 'chave_na_mao', 'meio_a_meio', 'carregador', 'proposta_apresentada', 'em_atendimento', 'falando_whatsapp', 'fechou', 'fechou_concorrente', 'arrendamento', 'status_novo_qualquer'].map((s, i) => card(20 + i, s))];
    for (const c of nao) expect(cardReabre(c, AGORA), `${c.status} ${c.quando}`).toBe(false);
  });

  it('reunião real futura NÃO entra (agendado de outra origem de hoje em diante), nem se a pessoa também tem card parado', () => {
    const linhas = [cad(1, 'Reunião futura', '5534999990001', 'R$ 140 mil'), cad(2, 'Reunião de 12h atrás', '5534999990002', 'R$ 140 mil'), cad(3, 'Misto', '5534999990003', 'R$ 140 mil')];
    const r = montarFila(linhas, comCards({
      '3499990001': [card(1, 'agendado', { quando: '2026-11-14T15:00:00Z' })],
      '3499990002': [card(2, 'agendado', { quando: '2026-11-12T03:00:00Z' })],
      '3499990003': [card(3, 'cancelado'), card(4, 'em_atendimento')],
    }));
    expect(nomes(r)).toEqual([]);
    expect(r.excluidos).toMatchObject({ reuniao_real: 2, card_vivo: 1 });
  });

  it('o lote mudo agendado ENTRA (a marca ep_mudo não exclui), e quem tem card de solar vivo fica fora', () => {
    const linhas = [cad(1, 'Do lote', '5534999990001', 'R$ 140 mil'), cad(2, 'Solar vivo', '5534999990002', 'R$ 140 mil')];
    const r = montarFila(linhas, comCards({ '3499990001': [lote(1)], '3499990002': [card(2), card(3, 'em_atendimento', { origem: 'lp_solar' })] }));
    expect(nomes(r)).toEqual(['Do lote']);
    expect(r.fila[0]!.card).toMatchObject({ id: 1, origem: 'cadastro_eletroposto' });
  });

  it('o card que ela remarca é o mais recente de ELETROPOSTO; card de solar só conta para EXCLUIR, nunca para entrar (ordem do dono, 12/11/2026)', () => {
    const linhas = [cad(1, 'Duas', '5534999990001', 'R$ 140 mil'), cad(2, 'So solar parado', '5534999990002', 'R$ 140 mil'),
      cad(3, 'Solar vivo e eletroposto parado', '5534999990003', 'R$ 140 mil')];
    const r = montarFila(linhas, comCards({
      '3499990001': [card(5, 'cancelado'), card(9, 'nao_atendeu', { vendedor: 'Diego' }), card(12, 'cancelado', { origem: 'lp_solar' })],
      '3499990002': [card(7, 'cancelado', { origem: 'lead-meta' })],
      '3499990003': [card(13), card(14, 'em_atendimento', { origem: 'lp_solar' })],
    }));
    expect(nomes(r)).toEqual(['Duas']);
    expect(r.fila[0]!.card).toMatchObject({ id: 9, vendedor: 'Diego' });
    expect(r.excluidos).toMatchObject({ sem_card: 1, card_vivo: 1 });
    expect(cardParaRemarcar([], AGORA)).toBeNull();
  });

  it('QUARTA FONTE: telefone com card de eletroposto e sem cadastro entra, com o tipo do tipo_card (cotista, arrendamento, integrador; sem ele, curioso)', () => {
    const doCard = (id: number, tel: string, tipoCard: string | null, observacao = ''): CardEletroposto =>
      ({ id, telefone: tel, nome: `Card ${id}`, cidade: 'Catalão', observacao, criadoEm: '2026-09-01T12:00:00Z', tipoCard });
    const cardsEp = [
      doCard(1, '5534999990001', 'cotista', 'LP ELETROPOSTO · Investidor\nQuanto pretende investir: R$ 140 mil'),
      doCard(2, '5534999990002', 'arrendamento', 'Local é seu: Sou o proprietário'),
      doCard(3, '5534999990003', 'integrador'),
      doCard(4, '5534999990004', null),
      doCard(5, '5534999990005', 'cotista', 'Sem valor nenhum'),
    ];
    const cards = Object.fromEntries(cardsEp.map(c => [`34${c.telefone!.slice(-8)}`, [card(c.id)]]));
    const r = montarFila([], comCards(cards, { cardsEletroposto: cardsEp }));
    expect(Object.fromEntries(r.fila.map(c => [c.nome, c.tipo]))).toEqual({
      'Card 1': 'investidor', 'Card 2': 'arrendamento', 'Card 3': 'parceiro', 'Card 4': 'curioso', 'Card 5': 'curioso',
    });
    const inv = r.fila.find(c => c.nome === 'Card 1')!;
    expect(inv).toMatchObject({ origem: 'card', valorTxt: 'R$ 140 mil', cidade: 'Catalão' });
    expect(inv.fatosDoCard).toContain('Quanto pretende investir: R$ 140 mil');
    expect(r.fila.find(c => c.nome === 'Card 5')!.valorTxt).toBe('');   // investidor sem valor legível vira curioso: a abertura não cita {valor}
    expect(tipoDoTipoCard('cotista')).toBe('investidor');
  });

  it('quem está no cadastro NÃO entra de novo pela quarta fonte', () => {
    const cardEp: CardEletroposto = { id: 1, telefone: '5534999990001', nome: 'Card', cidade: null, observacao: null, criadoEm: '', tipoCard: 'cotista' };
    const r = montarFila([cad(1, 'Do cadastro', '5534999990001', 'R$ 140 mil')], comCards({ '3499990001': [card(1)] }, { cardsEletroposto: [cardEp] }));
    expect(r.fila).toHaveLength(1);
    expect(r.fila[0]).toMatchObject({ nome: 'Do cadastro', origem: 'parceria' });
  });

  it('a mesma pessoa no cadastro e na ficha (com e sem o nono dígito) é UMA, com as duas linhas', () => {
    const r = montarFila([cad(1, 'Ana', '5534999990001', 'R$ 140 mil'), fic(21, 'Ana', '553499990001', { valor_investir: 'R$ 140 mil' })], comCards({ '3499990001': [card(1)] }));
    expect(r.fila).toHaveLength(1);
    expect(r.fila[0]!.telefone).toBe('5534999990001');
    expect(r.fila[0]!.refs).toEqual([{ origem: 'parceria', id: 1 }, { origem: 'nota1', id: 21 }]);
  });

  it('cada exclusão sai pelo seu motivo', () => {
    const linhas = [
      cad(1, 'Teste Fulano', '5534999990001', 'R$ 140 mil'), cad(2, 'Eva', '5534999990002', 'R$ 140 mil', { status: 'sem_interesse' }),
      cad(3, 'Opt', '5534999990003', 'R$ 140 mil'), cad(4, 'Bloq', '5534999990004', 'R$ 140 mil'), cad(5, 'Mudo', '5534999990005', 'R$ 140 mil'),
      cad(6, 'Humano', '5534999990006', 'R$ 140 mil'), cad(7, 'Conversa', '5534999990007', 'R$ 140 mil'), cad(8, 'Sessao', '5534999990008', 'R$ 140 mil'),
      cad(9, 'Fixo ruim', '123', 'R$ 140 mil'), cad(10, 'Livre', '5534999990010', 'R$ 140 mil'),
      cad(11, 'Recente', '5534999990011', 'R$ 140 mil', { created_at: '2026-11-12T10:00:00Z' }),
    ];
    const cards = Object.fromEntries(linhas.filter(l => String(l.r.telefone).length > 5).map((l, i) => [`34${String(l.r.telefone).slice(-8)}`, [card(i + 1)]]));
    const r = montarFila(linhas, comCards(cards, {
      silenciado: t => t === '5534999990003', bloqueado: t => t === '5534999990004', mudo: t => t === '5534999990005',
      comHumano: t => t === '5534999990006', comConversa: new Set(['3499990007']), comSessao: new Set(['3499990008']),
    }));
    expect(nomes(r)).toEqual(['Livre']);
    expect(r.excluidos).toEqual({
      nome_teste: 1, sem_interesse_no_cadastro: 1, opt_out: 1, bloqueado: 1, mudo: 1, humano_na_conversa: 1,
      conversa_7_dias: 1, tem_sessao: 1, telefone_invalido: 1, cadastro_recente: 1,
    });
  });

  it('cadastro com menos de 24h fica de fora; 24h em ponto entra', () => {
    const l = (created_at: string) => [cad(1, 'Ana', '5534999990001', 'R$ 140 mil', { created_at })];
    const c = comCards({ '3499990001': [card(1)] });
    expect(montarFila(l(new Date(AGORA - CADASTRO_MINIMO_MS + 1000).toISOString()), c).excluidos).toEqual({ cadastro_recente: 1 });
    expect(montarFila(l(new Date(AGORA - CADASTRO_MINIMO_MS).toISOString()), c).fila).toHaveLength(1);
  });

  it('sessão antiga que VOLTA (retorno) não é cortada por tem_sessao, e a fila a marca como retorno', () => {
    const r = montarFila([cad(1, 'Ana', '5534999990001', 'R$ 140 mil')], comCards({ '3499990001': [card(1)] }, { comSessao: new Set(), retorno: new Set(['3499990001']) }));
    expect(r.fila[0]).toMatchObject({ retorno: true });
  });
});

describe('retorno: a sessão antiga que volta (12/11/2026)', () => {
  const DIA = 86_400_000;
  const AGORA = Date.parse('2026-11-12T15:00:00Z');
  const velha = AGORA - 30 * DIA;

  it('chamado do regime ANTIGO (sem `tipo`), 21 dias ou mais sem resposta, volta como retorno', () => {
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', telefone: '5534999990001' }, velha, AGORA)).toBe(true);
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', telefone: '5534999990001' }, AGORA - 21 * DIA, AGORA)).toBe(false);   // "mais de 21 dias"
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', telefone: '5534999990001' }, AGORA - 21 * DIA - 1000, AGORA)).toBe(true);
  });

  it('a sessão fechada sem resposta volta; humano, sem interesse por outro motivo, agendado, conversando, ofertou e adiado não', () => {
    expect(sessaoVoltaComoRetorno({ estagio: 'sem_interesse', motivo: 'sem_resposta', telefone: 'x' }, velha, AGORA)).toBe(true);
    for (const s of [
      { estagio: 'humano' }, { estagio: 'sem_interesse', motivo: 'disse_nao' }, { estagio: 'sem_interesse', motivo: 'pediu_parar' },
      { estagio: 'agendado' }, { estagio: 'conversando' }, { estagio: 'ofertou' }, { estagio: 'adiado' },
    ]) expect(sessaoVoltaComoRetorno({ ...s, telefone: 'x' }, velha, AGORA), s.estagio + (s as { motivo?: string }).motivo).toBe(false);
  });

  it('a sessão do regime novo em chamado segue o ciclo de toques (o toque 4 dela sai aos 60 dias), e a com erro de envio ou ciclo encerrado nunca volta', () => {
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', tipo: 'investidor', telefone: 'x' }, velha, AGORA)).toBe(false);
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', erro: 'HTTP 500', telefone: 'x' }, velha, AGORA)).toBe(false);
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', ciclo_encerrado: 'outra_conversa', telefone: 'x' }, velha, AGORA)).toBe(false);
    expect(sessaoVoltaComoRetorno({ estagio: 'chamado', telefone: 'x' }, null, AGORA)).toBe(false);
  });

  it('o último envio é o mais novo entre os carimbos dos toques e a sessão', () => {
    expect(ultimoEnvioDaSessao({ aberto_em: '2026-10-13T12:00:00Z' })).toBe(Date.parse('2026-10-13T12:00:00Z'));
    expect(ultimoEnvioDaSessao({ aberto_em: '2026-10-13T12:00:00Z', ultimo_toque_em: '2026-10-20T12:00:00Z' }, { 1: '2026-10-13T12:00:00Z', 2: '2026-10-25T12:00:00Z' })).toBe(Date.parse('2026-10-25T12:00:00Z'));
    expect(ultimoEnvioDaSessao({})).toBeNull();
  });
});

describe('a ficha para o consultor e a conversa de descoberta (12/11/2026)', () => {
  it('os campos da ficha são mesclados: campo novo nunca apaga o anterior', () => {
    const antes = { cidade: 'Catalão', ocupacao: 'Dono de posto', tipo_local: 'posto' };
    const j = juntarDados(antes, { cidade: '', ocupacao: 'Dono de posto e de uma loja', movimento: 'Alto de dia' });
    expect(j).toMatchObject({ cidade: 'Catalão', ocupacao: 'Dono de posto e de uma loja', tipo_local: 'posto', movimento: 'Alto de dia' });
    expect(CAMPOS_DA_FICHA).toHaveLength(28);
  });

  it('a saída do modelo lê todos os campos da ficha, e o schema exige todos', () => {
    const dados = Object.fromEntries(CAMPOS_DA_FICHA.map(k => [k, k === 'bairro_local' ? 'Centro' : '']));
    const s = lerSaida(JSON.stringify({ bolhas: ['Oi.'], acao: 'continuar', opcao: 0, dados, resumo: 'R.' }));
    expect(s.valido).toBe(true);
    expect(s.dados.bairro_local).toBe('Centro');
    const props = (SCHEMA_SAIDA_HELENA.properties.dados as unknown as { properties: Record<string, unknown>; required: string[] });
    expect(Object.keys(props.properties)).toEqual([...CAMPOS_DA_FICHA]);
    expect(props.required).toEqual([...CAMPOS_DA_FICHA]);
  });

  it('a ficha ao consultor: o resumo e SÓ os campos preenchidos, um por linha, e cabe numa bolha', () => {
    const t = montarFichaConsultor({
      nome: 'Bia', telefone: '5534999990001', tipo: 'arrendamento', consultor: 'Giovanna', quando: '2026-11-17T13:00:00Z',
      dados: { tipo_local: 'Estacionamento', bairro_local: 'Centro', padrao_energia: 'não sabe', movimento: '' }, resumo: 'Dona de um estacionamento no centro. Quer ceder o espaço. Falta ver a energia.',
    });
    expect(t).toContain('HELENA MARCOU UMA REUNIÃO PARA VOCÊ');
    expect(t).toContain('*Tipo:* Arrendamento');
    expect(t).toContain('Tipo de local: Estacionamento');
    expect(t).toContain('Padrão de energia: não sabe');
    expect(t).not.toContain('O que espera receber');
    expect(t).not.toMatch(/Movimento do local/);
    expect(t.length).toBeLessThanOrEqual(TETO_DA_FICHA);
    const humano = montarFichaConsultor({ nome: null, telefone: '5534999990001', tipo: 'curioso', retorno: true, consultor: 'Diego', motivo: 'Pediu uma pessoa', dados: {}, resumo: '' });
    expect(humano).toContain('PASSOU UMA CONVERSA PARA VOCÊ');
    expect(humano).toContain('*Motivo:* Pediu uma pessoa');
    expect(humano).toContain('retomada depois de um tempo');
  });

  it('a linha da ficha no historico do card é uma linha só, sem o ponto médio nem o travessão do contrato do banco', () => {
    const l = linhaDaFichaNoHistorico({ ocupacao: 'Dono · posto — grande' }, 'Resumo.\nSegunda linha.');
    expect(l).not.toMatch(/\n/);
    expect(l).not.toMatch(/[·—–]/);
    expect(l.length).toBeLessThanOrEqual(900);
  });

  it('os fatos do sistema levam tipo, cadastro, card antigo (só para saber), retorno e o primeiro nome do consultor', () => {
    const base = { nome: 'Ana Lima', valorTxt: '', cidade: 'Catalão', consultor: 'Thiago Silva', oferta: [], dados: {} };
    const s = montarSistema({ ...base, tipo: 'arrendamento', retorno: true, cardAntigo: { status: 'cancelado', lote: false }, nota: 7, cadastroEm: '2026-09-01T12:00:00Z' });
    expect(s).toContain('Tipo do cadastro: Arrendamento');
    expect(s).toContain('marcar uma reunião com Thiago.');
    expect(s).not.toContain('Thiago Silva');
    expect(s).toContain('Cadastro feito em 01/09/2026');
    expect(s).toContain('Nota interna do cadastro: 7 (uso interno');
    expect(s).toContain('com status cancelado. É só para você saber: nunca conte isso');
    expect(s).toContain('há mais de três semanas');
    expect(s).not.toContain('Valor que ela marcou');
    const lote = montarSistema({ ...base, tipo: 'investidor', valorTxt: 'R$ 140 mil', cardAntigo: { status: 'agendado', lote: true } });
    expect(lote).toContain('Valor que ela marcou no formulário: R$ 140 mil');
    expect(lote).toContain('ELA NÃO MARCOU e não conhece');
    expect(lote).toContain('nunca fale dele');
  });

  it('o que a conversa já descobriu volta nos fatos, com o rótulo de cada campo', () => {
    const s = montarSistema({ nome: 'Ana', valorTxt: '', cidade: null, consultor: 'Diego', oferta: [], tipo: 'parceiro', dados: { atuacao: 'Eletricista residencial', regiao_atuacao: 'Triângulo' } });
    expect(s).toContain('O que a conversa já descobriu:');
    expect(s).toContain('  O que faz: Eletricista residencial');
    expect(s).toContain('  Região em que atua: Triângulo');
    expect(s).toContain('Tipo do cadastro: Parceiro');
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
    // Grade única desde 13/10/2026 (08:00 às 17:30, sem o almoço): a Helena oferece
    // a 1ª vaga da manhã e a 1ª da tarde de cada um dos dois dias.
    expect(oferta.map(hhmm)).toEqual([
      'Terça 13/10 às 08:00',
      'Terça 13/10 às 13:30',
      'Quarta 14/10 às 08:00',
      'Quarta 14/10 às 13:30',
    ]);
    expect(oferta.map((iso, i) => linhaDoHorario(iso, i))[0]).toBe('1. Terça 13/10 às 08:00');
  });

  it('nenhuma vaga começa no almoço (12:00 às 13:30), nem na segunda nem na sexta', () => {
    const agora = brt('2026-10-10T22:00').getTime();
    const livres = vagasLivres(DONO, semNada, agora);
    for (const iso of livres) {
      const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      expect(m >= 12 * 60 && m < 13 * 60 + 30).toBe(false);
    }
    // Uma terça (13/10), uma sexta (16/10) e uma segunda (19/10) com 17 vagas cada.
    for (const dia of ['2026-10-13', '2026-10-16', '2026-10-19']) {
      const doDia = livres.filter(iso => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) === dia);
      expect(doDia).toHaveLength(17);
    }
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
    // Terça 13/10 às 10:30: 13:00 não existe mais (almoço) e 13:30 está a 3h (entra).
    const agora = brt('2026-10-13T10:30').getTime();
    const livres = vagasLivres(DONO, semNada, agora);
    expect(hhmm(livres[0]!)).toBe('Terça 13/10 às 13:30');
    for (const iso of livres) expect(new Date(iso).getTime() - agora).toBeGreaterThanOrEqual(3 * 3600_000);
    // E às 08:30 da terça só sobra o fim da manhã (11:30, a 3h) e a tarde.
    expect(horariosDaOferta(DONO, semNada, brt('2026-10-13T08:30').getTime()).map(hhmm)).toEqual([
      'Terça 13/10 às 11:30', 'Terça 13/10 às 13:30', 'Quarta 14/10 às 08:00', 'Quarta 14/10 às 13:30',
    ]);
  });

  it('horário ocupado do MESMO consultor sai; o do outro consultor não atrapalha', () => {
    const agora = brt('2026-10-10T22:00').getTime();
    const oitoDaTerca = brt('2026-10-13T08:00').getTime();
    const doThiago: Compromisso[] = [{ ts: oitoDaTerca, dono: 'Thiago', ep: true }];
    expect(hhmm(horariosDaOferta('Thiago', doThiago, agora)[0]!)).toBe('Terça 13/10 às 08:30');
    expect(hhmm(horariosDaOferta('Diego', doThiago, agora)[0]!)).toBe('Terça 13/10 às 08:00');
  });

  it('se o primeiro dia não fecha dois, vão os 4 próximos livres', () => {
    // Terça 13/10 às 14:20: só sobra 17:30 na terça.
    const oferta = horariosDaOferta(DONO, semNada, brt('2026-10-13T14:20').getTime());
    expect(oferta.map(hhmm)).toEqual([
      'Terça 13/10 às 17:30', 'Quarta 14/10 às 08:00', 'Quarta 14/10 às 08:30', 'Quarta 14/10 às 09:00',
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
      expect(texto).toContain('1. Terça 13/10 às 08:00');
      expect(texto).toContain('2. Terça 13/10 às 13:30');
      expect(texto).toContain('3. Quarta 14/10 às 08:00');
      expect(texto).toContain('4. Quarta 14/10 às 13:30');
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
      'AGENTE HELENA: reunião marcada pela agente do eletroposto no WhatsApp',
      'Quanto pretende investir: R$ 140 mil',
      'Valor confirmado na conversa: Sim, continua',
      'Como pretende investir: Recurso próprio',
      'Pagamento (o que disse): Recurso próprio',
      'Tem ponto (o que disse): Ainda não tem',
      'Cidade: Uberaba',
      'Cadastro de origem: cadastro (eletroposto_parceria) #45, de 02/09/2026',
      'Resumo da conversa:',
      '- Confirmou o interesse e o valor.',
      '- Vai pagar com recurso próprio.',
      '- Quer entender as opções de negócio.',
    ]);
  });

  it('os outros tipos entram como "Outro: ..." na linha que o trigger lê, sem as linhas de investimento', () => {
    const obs = montarObservacao({ ...base, tipo: 'arrendamento', valorTxt: '' }).split('\n');
    expect(obs[0]).toBe('LP ELETROPOSTO · Outro: Arrendamento');
    expect(obs).toContain('Tipo do cadastro: Arrendamento');
    expect(obs.join('\n')).not.toMatch(/Quanto pretende investir|Como pretende investir/);
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
    expect(s).toContain('Em "agendar", "humano" e "parar" o sistema manda a mensagem pronta no seu lugar');
    expect(s).toContain('Em "oferecer_horarios" e "sem_interesse" sai UMA bolha sua, curta, antes da mensagem pronta');
    expect(s).toContain('em "adiar" a sua bolha curta vai no lugar da mensagem pronta');
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
      'Palavras proibidas na resposta: retorno, rendimento, rentabilidade, lucro, payback, garantia, juros, por cento, cota. A única exceção é a frase "dividimos os lucros", ao falar da sociedade 50/50, sem número. Para falar do resto disso, diga "os números".');
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
      'Em que cidade você pensa em montar?', 'Posso te mandar os horários para conversar com o Diego?',
      'Que bom. Você já tem um local em mente?', 'Combinado, Ana.']) {
      expect(violaRegras([t]), t).toBeNull();
    }
  });

  it('valor em reais só passa se a pessoa o disse (a lista vem de quem chama; sem lista, nenhum passa)', () => {
    expect(violaRegras(['R$ 140 mil, certo?'], [140000])).toBeNull();
    expect(violaRegras(['R$ 140 mil, certo?'])).toMatch(/valor em reais/);
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

// ═════════════════════════════════════════════════════════════════════════════
// 12/10/2026: a escolha do horário que se perdeu
// ═════════════════════════════════════════════════════════════════════════════

describe('escolhaPorNumero: a ÚLTIMA mensagem da leva manda', () => {
  it('frase e depois o número solto: é a escolha (o caso real de 12/10)', () => {
    expect(escolha(['Pode ser terça-feira, amanhã às 10h.', '1'], 4)).toBe(0);
    expect(escolha(['Pode ser terça', 'opção 3'], 4)).toBe(2);
    expect(escolha(['Pode ser terça', 'a 2.'], 4)).toBe(1);
    expect(escolha(['Pode ser terça', ' 4 '], 4)).toBe(3);
  });

  it('o número solto fora da lista ainda é -1', () => {
    expect(escolha(['Pode ser', '7'], 4)).toBe(-1);
  });

  it('frase com número no meio, SEM número solto no fim, continua não sendo escolha', () => {
    expect(escolha(['10h não consigo, tem outro?'], 4)).toBeNull();
    expect(escolha(['Nenhum serve, trabalho até as 15'], 4)).toBeNull();
    expect(escolha(['2', 'Pode ser terça'], 4)).toBeNull();           // a última é frase
    expect(escolha(['Quero o 2', 'obrigado'], 4)).toBeNull();
  });

  it('dois números soltos diferentes seguem ambíguos, com ou sem frase', () => {
    expect(escolha(['1', '2'], 4)).toBeNull();
    expect(escolha(['Pode ser', '1', '2'], 4)).toBeNull();
    expect(escolha(['Pode ser terça', '2', '2'], 4)).toBe(1);
  });

  it('negação ou dúvida numa mensagem anterior da leva: o número não agenda sozinho, vai para a IA', () => {
    expect(escolha(['10h não dá', '1'], 4)).toBeNull();
    expect(escolha(['Vou com meu sócio', '2'], 4)).toBe(1);               // sem negação nem dúvida: segue valendo
    expect(escolha(['Nao posso terça', '2'], 4)).toBeNull();
    expect(escolha(['Nenhum serve', '2'], 4)).toBeNull();
    expect(escolha(['Nenhuma dessas', '2'], 4)).toBeNull();
    expect(escolha(['Nem pensar na terça', '3'], 4)).toBeNull();
    expect(escolha(['Talvez terça', '1'], 4)).toBeNull();
    expect(escolha(['Depende do meu sócio', '1'], 4)).toBeNull();
    expect(escolha(['Pode ser terça?', '1'], 4)).toBeNull();
    expect(escolha(['Pode ser terça-feira, amanhã às 10h.', '1'], 4)).toBe(0);   // continua direto
    expect(escolha(['Quero terça', 'Pode ser às 10h', '1'], 4)).toBe(0);
    expect(escolha(['Não dá', 'Pode ser terça às 10h', '1'], 4)).toBeNull();     // a negação está em qualquer anterior
    expect(escolha(['Cenário nada a ver', '1'], 4)).toBe(0);                      // "nada" não é uma das palavras
    expect(escolha(['1'], 4)).toBe(0);                                            // uma mensagem só não muda
    expect(escolha(['Não'], 4)).toBeNull();
  });

  it('as regras antigas seguem: número solto, com cortesia, sozinho', () => {
    expect(escolha(['2'], 4)).toBe(1);
    expect(escolha(['2', 'obrigado'], 4)).toBe(1);
    expect(escolha(['obrigado'], 4)).toBeNull();
    expect(escolha([], 4)).toBeNull();
  });
});

describe('a ação agendar na saída do modelo', () => {
  const base = { bolhas: [], acao: 'agendar', opcao: 1, dados: { valor_confirmado: '', pagamento: '', tem_ponto: '', cidade: '' }, resumo: 'Escolheu o 1.' };

  it('é uma ação válida, e o schema pede o campo opcao', () => {
    expect(ACOES_HELENA).toContain('agendar');
    expect(SCHEMA_SAIDA_HELENA.properties.acao.enum).toContain('agendar');
    expect(SCHEMA_SAIDA_HELENA.properties.opcao).toEqual({ type: 'integer' });
    expect(SCHEMA_SAIDA_HELENA.required).toContain('opcao');
  });

  it('o leitor devolve a ação e a opção; opção que não é inteiro vira 0', () => {
    expect(ler(JSON.stringify(base))).toMatchObject({ valido: true, acao: 'agendar', opcao: 1 });
    expect(ler(JSON.stringify({ ...base, opcao: 3 })).opcao).toBe(3);
    expect(ler(JSON.stringify({ ...base, opcao: '2' })).opcao).toBe(2);       // texto numérico vale
    expect(ler(JSON.stringify({ ...base, opcao: ' 3 ' })).opcao).toBe(3);
    expect(ler(JSON.stringify({ ...base, opcao: 'dois' })).opcao).toBe(0);
    expect(ler(JSON.stringify({ ...base, opcao: '2x' })).opcao).toBe(0);
    expect(ler(JSON.stringify({ ...base, opcao: '-1' })).opcao).toBe(0);
    expect(ler(JSON.stringify({ ...base, opcao: 1.5 })).opcao).toBe(0);
    const { opcao: _fora, ...semOpcao } = base;
    expect(ler(JSON.stringify(semOpcao)).opcao).toBe(0);
  });

  it('as instruções técnicas ensinam quando usar e quando NÃO usar', () => {
    const t = sistema({ nome: 'Carlos', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Diego', oferta: ['2026-10-13T13:00:00Z'], dados: {} });
    expect(t).toContain('- "agendar": use SÓ quando a lista de horários já foi enviada');
    expect(t).toContain('Informe em "opcao" a posição dele na lista.');
    expect(t).toContain('NÃO use "agendar": use "oferecer_horarios"');
    expect(t).toContain('"opcao": número inteiro.');
    expect(t).toContain('os campos "bolhas", "acao", "opcao", "dados", "resumo" e "convite"');
  });
});

describe('escolhaPendenteDe: quem ficou no vácuo depois de escolher', () => {
  const AGORA_MS = Date.parse('2026-10-11T13:00:00Z');
  const em = (min: number): string => new Date(AGORA_MS - min * 60_000).toISOString();
  const nos = (min: number, texto = 'Tenho estes horários'): MsgDaConversa => ({ from_me: true, texto, tipo: 'texto', momment: em(min) });
  const ele = (min: number, texto: string): MsgDaConversa => ({ from_me: false, texto, tipo: 'texto', momment: em(min) });

  it('a última fala é dele, com mais de 10 minutos e já lida: está pendente, e as falas vêm separadas da conversa', () => {
    const p = escolhaPendenteDe([nos(60), ele(30, 'Pode ser terça às 10h'), ele(29, '1')], em(28), null, AGORA_MS);
    expect(p?.ultima).toBe(em(29));
    expect(p?.novas.map(m => m.texto)).toEqual(['Pode ser terça às 10h', '1']);
    expect(p?.historico.map(m => m.texto)).toEqual(['Tenho estes horários']);
  });

  it('mensagem de horas atrás também vale (a regra da hora não se aplica)', () => {
    expect(escolhaPendenteDe([nos(300), ele(200, '1')], em(199), null, AGORA_MS)).not.toBeNull();
  });

  it('nega: a última é nossa, tem 10 minutos ou menos, ainda não foi lida, ou já foi reprocessada', () => {
    expect(escolhaPendenteDe([ele(30, '1'), nos(20)], em(15), null, AGORA_MS)).toBeNull();
    expect(escolhaPendenteDe([nos(60), ele(10, '1')], em(5), null, AGORA_MS)).toBeNull();
    expect(escolhaPendenteDe([nos(60), ele(9, '1')], em(5), null, AGORA_MS)).toBeNull();
    expect(escolhaPendenteDe([nos(60), ele(30, '1')], em(40), null, AGORA_MS)).toBeNull();       // cursor antes da fala
    expect(escolhaPendenteDe([nos(60), ele(30, '1')], null, null, AGORA_MS)).toBeNull();
    expect(escolhaPendenteDe([nos(60), ele(30, '1')], em(29), em(30), AGORA_MS)).toBeNull();     // já reprocessada
    expect(escolhaPendenteDe([nos(60), { from_me: false, texto: null, tipo: 'audio', momment: em(30) }], em(29), null, AGORA_MS)).toBeNull();
    expect(escolhaPendenteDe([], em(29), null, AGORA_MS)).toBeNull();
  });

  it('a janela da recuperação é de 08:00 às 20:00 de Brasília', () => {
    const brt = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00-03:00`);
    expect(dentroDaJanelaDeRecuperacao(brt('07:59'))).toBe(false);
    expect(dentroDaJanelaDeRecuperacao(brt('08:00'))).toBe(true);
    expect(dentroDaJanelaDeRecuperacao(brt('19:59'))).toBe(true);
    expect(dentroDaJanelaDeRecuperacao(brt('20:00'))).toBe(false);
  });
});

describe('horários de 12/11/2026: frio de segunda a sábado (feriado incluído) e respostas das 7h às 20h', () => {
  it('a janela do frio: segunda a sábado das 9h às 19h59, feriado em dia de semana incluído, domingo fora', () => {
    // 20/11/2026 é sexta e feriado nacional: abre normalmente.
    expect(janelaAberta(brt('2026-11-20T09:00'))).toBe(true);
    expect(janelaAberta(brt('2026-11-20T19:59'))).toBe(true);
    expect(janelaAberta(brt('2026-11-20T20:00'))).toBe(false);
    expect(janelaAberta(brt('2026-11-20T08:59'))).toBe(false);
    expect(janelaAberta(brt('2026-11-14T10:00'))).toBe(true);    // sábado
    expect(janelaAberta(brt('2026-11-15T10:00'))).toBe(false);   // domingo
  });

  it('a janela das respostas: todos os dias das 7h às 19h59, domingo e feriado incluídos', () => {
    expect(janelaDeResposta(brt('2026-11-15T07:00'))).toBe(true);   // domingo
    expect(janelaDeResposta(brt('2026-11-20T12:00'))).toBe(true);   // feriado
    expect(janelaDeResposta(brt('2026-11-15T19:59'))).toBe(true);
    expect(janelaDeResposta(brt('2026-11-15T20:00'))).toBe(false);
    expect(janelaDeResposta(brt('2026-11-15T06:59'))).toBe(false);
  });
});

describe('a agenda da Giovanna ocupa o horário dela (12/11/2026)', () => {
  const agora = Date.parse('2026-11-16T10:00:00Z');   // segunda
  const slot = (h: string) => new Date(`2026-11-17T${h}:00-03:00`).toISOString();

  it('compromisso de QUALQUER origem da Giovanna (inclusive solar) tira o horário dela, e o do Thiago não', () => {
    const cs: Compromisso[] = [
      { ts: new Date(slot('10:00')).getTime(), dono: 'Giovanna', ep: false },
      { ts: new Date(slot('14:00')).getTime(), dono: 'Giovanna', ep: false, vistoria: true },
      { ts: new Date(slot('09:00')).getTime(), dono: 'Thiago', ep: true },
    ];
    const g = vagasLivres('Giovanna', cs, agora);
    expect(g).not.toContain(slot('10:00'));
    expect(g).not.toContain(slot('14:00'));
    expect(g).not.toContain(slot('14:30'));   // a vistoria leva 1 hora
    expect(g).toContain(slot('09:00'));
    expect(vagasLivres('Thiago', cs, agora)).not.toContain(slot('09:00'));
    expect(vagasLivres('Thiago', cs, agora)).toContain(slot('10:00'));
  });

  it('a leitura dos compromissos não filtra por dono: lê todos os cards, paginados', () => {
    const src = readFileSync(join(__dirname, '../services/io/eletropostoVagas.ts'), 'utf8');
    const corpo = src.slice(src.indexOf('export async function carregarCompromissos'), src.indexOf('export async function proximasVagas'));
    expect(corpo).not.toMatch(/\.in\('vendedor_nome'|\.eq\('vendedor_nome'/);
    expect(corpo).toContain('lerPaginado');
  });
});

describe('convite e preparo no código puro (rodada 2, 12/11/2026)', () => {
  const lido = (extra: Record<string, unknown>) => lerSaida(JSON.stringify({ bolhas: ['Posso te mandar os horários?'], acao: 'continuar', opcao: 0, dados: {}, resumo: 'x', ...extra }));

  it('o schema pede `convite` e lerSaida lê só o true de verdade', () => {
    expect(SCHEMA_SAIDA_HELENA.required).toContain('convite');
    expect(SCHEMA_SAIDA_HELENA.properties.convite).toEqual({ type: 'boolean' });
    expect(lido({ convite: true }).convite).toBe(true);
    expect(lido({ convite: false }).convite).toBe(false);
    expect(lido({}).convite).toBe(false);
    expect(lido({ convite: 'true' }).convite).toBe(false);
  });

  it('ehConviteDeHorario: as falas de convite do prompt passam; sem pergunta de horário, ou com convite false, não', () => {
    const conv = { convite: true };
    for (const b of [
      ['Posso te mandar os horários?'],
      ['Vale uma conversa com Diego, que olha o seu caso. Posso te mandar os horários?'],
      ['Posso te mandar os horários agora?'],
      ['Respondi o que deu.', 'Quer que eu te mande os horários?'],
      ['Posso te mandar o horário?'],
    ]) expect(ehConviteDeHorario(conv, b), b.join(' / ')).toBe(true);
    for (const b of [
      ['Em que cidade você está?'],
      ['O Diego mostra isso na reunião.'],
      ['Os horários ficam com o Diego.'],
      [],
    ]) expect(ehConviteDeHorario(conv, b), b.join(' / ')).toBe(false);
    expect(ehConviteDeHorario({ convite: false }, ['Posso te mandar os horários?'])).toBe(false);
    expect(ehConviteDeHorario({}, ['Posso te mandar os horários?'])).toBe(false);
  });

  it('montarSistema no modo preparo: 1ª pergunta, pergunta seguinte e fecho; sem o bloco fora do preparo', () => {
    const base = { nome: 'Ana', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Diego Silva', oferta: [], dados: {} };
    const quando = '2026-10-13T16:30:00Z';
    const primeira = montarSistema({ ...base, preparo: { feitas: 0, quando, encerrar: false, confirmacao: 'Combinado! Sua reunião ficou marcada.' } });
    expect(primeira).toContain('MODO PREPARO: a reunião JÁ ESTÁ MARCADA');
    expect(primeira).toContain("Siga a seção 'DEPOIS DE MARCAR'. Você já fez 0 pergunta(s) de preparo.");
    expect(primeira).toContain('"Combinado! Sua reunião ficou marcada."');
    expect(primeira).toContain('a primeira pergunta de preparo');
    expect(montarSistema({ ...base, preparo: { feitas: 1, quando, encerrar: false } })).toContain('a próxima pergunta de preparo');
    expect(montarSistema({ ...base, preparo: { feitas: 2, quando, encerrar: true } })).toContain('Este é o fim do preparo');
    expect(montarSistema(base)).not.toContain('MODO PREPARO');
    expect(montarSistema(base)).toContain('"convite": true SÓ quando a mensagem em "bolhas" convida para a reunião');
  });

  it('o texto fixo de encerramento do preparo troca {consultor} e varia pela chave', () => {
    const quando = '2026-10-13T11:00:00.000Z';
    const a = textoEncerramentoPreparo('3499990001', 'Diego', quando);
    expect(a).toContain('Diego');
    expect(a).not.toContain('{consultor}');
    expect(a).not.toContain('{quando}');
    expect(a).toContain(horarioNaFrase(quando));   // o dia como está na confirmação, nunca 'amanhã' nem 'hoje'
    expect(new Set(['3499990001', '3499990002', '3499990003', '3499990004', '3499990005'].map(c => textoEncerramentoPreparo(c, 'Diego', quando))).size).toBeGreaterThan(1);
    for (const v of ENCERRAMENTO_DO_PREPARO) { expect(v).not.toMatch(/em mãos|anotad|amanhã|hoje/i); }
  });
});
