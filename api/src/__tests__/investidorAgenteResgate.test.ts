import { describe, it, expect } from 'vitest';
import {
  montarFilaResgate, montarFila, escolherGrupo, ehVezDoResgate, tetoResgateDoDia, mesPorExtenso,
  textoDaAberturaResgate, renderAberturaResgate, paragrafoDeResgate, montarSistema,
  RESGATE_POR_DIA, RESGATE_MS_MINIMO,
  type FiltrosDaFila, type CardDaAgenda, type DadosDoResgate,
} from '../services/io/investidorAgentePuro';
import { ABERTURAS_RESGATE, ABERTURA_RESGATE_SEM_NOME, CONVERSA_DE_RESGATE } from '../services/io/investidorAgenteTextos';
import type { LinhaOrigem } from '../services/io/eletropostoPares';

// O resgate dos cancelados (12/10/2026), a parte pura: quem entra, em que ordem,
// quando é a vez dele e o que a pessoa lê.

const AGORA = Date.parse('2026-10-12T13:00:00Z');
const DIA = 86_400_000;
const haDias = (n: number): string => new Date(AGORA - n * DIA).toISOString();

const pessoa = (id: number, nome: string, tel: string, faixa = 'R$ 140 mil'): LinhaOrigem => ({
  origem: 'parceria',
  r: { id, nome, telefone: tel, cidade: null, lado: 'capital', capital_faixa: faixa, status: 'novo', created_at: `2026-09-0${id}T12:00:00Z` },
});
const filtros = (over: Partial<FiltrosDaFila> = {}): FiltrosDaFila => ({
  comCard: new Set(), comSessao: new Set(), comConversa: new Set(),
  silenciado: () => false, bloqueado: () => false, mudo: () => false, comHumano: () => false, ...over,
});
const card = (id: number, o: Partial<CardDaAgenda> = {}): CardDaAgenda =>
  ({ id, status: 'cancelado', quando: '2026-09-24T17:00:00Z', escreveu: false, ...o });
const dados = (cards: Record<string, CardDaAgenda[]>, liberados: Record<number, string>): DadosDoResgate =>
  ({ cards: new Map(Object.entries(cards)), liberados: new Map(Object.entries(liberados).map(([k, v]) => [Number(k), v])), agora: AGORA });

const ANA = '5534999990001', BRUNO = '5534999990002', CARLA = '5534999990003';
const K_ANA = '3499990001', K_BRUNO = '3499990002', K_CARLA = '3499990003';

describe('resgate: elegibilidade', () => {
  it('só cancelado com carimbo de liberação há 14 dias ou mais', () => {
    const linhas = [pessoa(1, 'Ana Lima', ANA), pessoa(2, 'Bruno Reis', BRUNO), pessoa(3, 'Carla Dias', CARLA)];
    const r = montarFilaResgate(linhas, filtros(), dados(
      {
        [K_ANA]: [card(11)],
        [K_BRUNO]: [card(12, { status: 'agendado' })],
        [K_CARLA]: [card(13)],
      },
      { 11: haDias(15), 12: haDias(15) },               // a Carla não tem carimbo
    ));
    expect(r.fila.map(c => c.chave)).toEqual([K_ANA]);
    expect(r.excluidos).toEqual({ card_em_outro_status: 1, sem_carimbo_de_liberacao: 1 });
  });

  it('13 dias fora, 14 dentro (o limite é inclusivo)', () => {
    const linhas = [pessoa(1, 'Ana Lima', ANA), pessoa(2, 'Bruno Reis', BRUNO)];
    const r = montarFilaResgate(linhas, filtros(), dados(
      { [K_ANA]: [card(11)], [K_BRUNO]: [card(12)] },
      { 11: haDias(13), 12: haDias(14) },
    ));
    expect(r.fila.map(c => c.chave)).toEqual([K_BRUNO]);
    expect(r.excluidos).toEqual({ menos_de_14_dias: 1 });
    expect(RESGATE_MS_MINIMO).toBe(14 * DIA);
  });

  it('vale a liberação MAIS RECENTE entre os cards: uma antiga e uma de 3 dias deixam fora', () => {
    const linhas = [pessoa(1, 'Ana Lima', ANA)];
    const r = montarFilaResgate(linhas, filtros(), dados({ [K_ANA]: [card(11), card(12)] }, { 11: haDias(40), 12: haDias(3) }));
    expect(r.fila).toEqual([]);
    expect(r.excluidos).toEqual({ menos_de_14_dias: 1 });
  });

  it('um card em outro status mantém a pessoa fora, mesmo com os outros cancelados e liberados', () => {
    const linhas = [pessoa(1, 'Ana Lima', ANA)];
    const r = montarFilaResgate(linhas, filtros(), dados(
      { [K_ANA]: [card(11), card(12, { status: 'agendado' })] }, { 11: haDias(30) }));
    expect(r.fila).toEqual([]);
    expect(r.excluidos).toEqual({ card_em_outro_status: 1 });
  });

  it('quem não tem card nenhum não é do resgate (e não entra nem na contagem)', () => {
    const r = montarFilaResgate([pessoa(1, 'Ana Lima', ANA)], filtros(), dados({}, {}));
    expect(r.fila).toEqual([]);
    expect(r.excluidos).toEqual({});
  });

  it('a reunião perdida é o `quando` do card cancelado mais recente', () => {
    const r = montarFilaResgate([pessoa(1, 'Ana Lima', ANA)], filtros(), dados(
      { [K_ANA]: [card(11, { quando: '2026-08-20T17:00:00Z' }), card(12, { quando: '2026-09-24T17:00:00Z' })] },
      { 11: haDias(50), 12: haDias(18) },
    ));
    expect(r.fila[0]!.reuniaoPerdidaEm).toBe('2026-09-24T17:00:00Z');
    expect(r.fila[0]!.liberadoEm).toBe(haDias(18));
  });

  it('sem data da reunião não dá para escrever o mês: fica fora', () => {
    const r = montarFilaResgate([pessoa(1, 'Ana Lima', ANA)], filtros(), dados({ [K_ANA]: [card(11, { quando: null })] }, { 11: haDias(20) }));
    expect(r.fila).toEqual([]);
    expect(r.excluidos).toEqual({ sem_data_da_reuniao: 1 });
  });

  it('os outros cortes valem: opt-out, bloqueio, humano, conversa de 7 dias, sessão, nome de teste e valor ilegível', () => {
    const linhas = [
      pessoa(1, 'Ana Lima', ANA), pessoa(2, 'Bruno Reis', BRUNO), pessoa(3, 'Carla Dias', CARLA),
      pessoa(4, 'Teste Interno', '5534999990004'), pessoa(5, 'Eva Melo', '5534999990005', 'uns 100k'),
      pessoa(6, 'Fábio Luz', '5534999990006'), pessoa(7, 'Gil Reis', '5534999990007'), pessoa(8, 'Helô Paz', '5534999990008'),
    ];
    const cards: Record<string, CardDaAgenda[]> = {};
    const lib: Record<number, string> = {};
    linhas.forEach((l, i) => { const k = '34' + String(l.r.telefone).slice(-8); cards[k] = [card(20 + i)]; lib[20 + i] = haDias(30); });
    const r = montarFilaResgate(linhas, filtros({
      silenciado: t => t === ANA, bloqueado: t => t === BRUNO, comHumano: t => t === CARLA,
      comConversa: new Set(['3499990006']), comSessao: new Set(['3499990007']),
    }), dados(cards, lib));
    expect(r.fila.map(c => c.chave)).toEqual(['3499990008']);
    expect(r.excluidos).toEqual({
      opt_out: 1, bloqueado: 1, humano_na_conversa: 1, nome_teste: 1, sem_valor_legivel: 1, conversa_7_dias: 1, tem_sessao: 1,
    });
  });
});

describe('resgate: a exceção do mudo é só do resgate', () => {
  const linhas = [pessoa(1, 'Ana Lima', ANA), pessoa(2, 'Bruno Reis', BRUNO)];
  const mudo = (t: string) => t === ANA || t === BRUNO;

  it('o resgate ignora o mudo', () => {
    const r = montarFilaResgate(linhas, filtros({ mudo }), dados(
      { [K_ANA]: [card(11)], [K_BRUNO]: [card(12)] }, { 11: haDias(20), 12: haDias(20) }));
    expect(r.fila).toHaveLength(2);
    expect((r.excluidos as Record<string, number>).mudo).toBeUndefined();
  });

  it('a fila principal continua barrando o mudo, exatamente como antes', () => {
    const r = montarFila(linhas, filtros({ mudo }));
    expect(r.fila).toEqual([]);
    expect(r.excluidos).toEqual({ mudo: 2 });
  });
});

describe('resgate: a ordem dentro do grupo', () => {
  it('quem já escreveu alguma vez primeiro; depois, maior valor; no empate, cadastro mais novo', () => {
    const linhas = [
      pessoa(1, 'Ana Lima', ANA, 'R$ 500 mil'),             // nunca escreveu, o maior valor
      pessoa(2, 'Bruno Reis', BRUNO, 'R$ 60 mil'),          // já escreveu, o menor valor
      pessoa(3, 'Carla Dias', CARLA, 'R$ 140 mil'),         // já escreveu, valor médio
      pessoa(4, 'Dani Luz', '5534999990004', 'R$ 140 mil'), // nunca escreveu, empata com a Carla no valor
    ];
    const r = montarFilaResgate(linhas, filtros(), dados(
      {
        [K_ANA]: [card(11)],
        [K_BRUNO]: [card(12, { escreveu: true })],
        [K_CARLA]: [card(13), card(14, { escreveu: true })],   // basta UM card com resposta
        '3499990004': [card(15)],
      },
      { 11: haDias(20), 12: haDias(20), 13: haDias(20), 14: haDias(20), 15: haDias(20) },
    ));
    expect(r.fila.map(c => [c.chave, c.escreveu])).toEqual([
      [K_CARLA, true], [K_BRUNO, true], [K_ANA, false], ['3499990004', false],
    ]);
  });
});

describe('resgate: a vez, a cota e o teto', () => {
  it('a 2ª, 4ª, 7ª, 10ª e 13ª abertura do dia (contadas só entre as aberturas) são a vez do resgate', () => {
    const vezes = Array.from({ length: 30 }, (_, i) => i + 1).filter(ehVezDoResgate);
    expect(vezes).toEqual([2, 4, 7, 10, 13]);
    expect(ehVezDoResgate(0)).toBe(false);
    expect(ehVezDoResgate(1.5)).toBe(false);
  });

  it('um dia de 30 aberturas com gente de sobra: resgate só nas 5 posições, nunca em bloco', () => {
    let resgates = 0;
    const grupos: string[] = [];
    for (let posicao = 1; posicao <= 30; posicao++) {
      const g = escolherGrupo({ posicao, resgateLigado: true, cotaDeResgate: resgates < RESGATE_POR_DIA, resgateElegivel: true, principalTem: true });
      grupos.push(String(g));
      if (g === 'resgate') resgates++;
    }
    const posicoes = grupos.map((g, i) => (g === 'resgate' ? i + 1 : 0)).filter(Boolean);
    expect(posicoes).toEqual([2, 4, 7, 10, 13]);
    expect(resgates).toBe(5);
  });

  it('na vez do resgate sem elegível sai a principal', () => {
    expect(escolherGrupo({ posicao: 2, resgateLigado: true, cotaDeResgate: true, resgateElegivel: false, principalTem: true })).toBe('principal');
  });

  it('fora da vez, mesmo com elegível, sai a principal', () => {
    expect(escolherGrupo({ posicao: 3, resgateLigado: true, cotaDeResgate: true, resgateElegivel: true, principalTem: true })).toBe('principal');
  });

  it('principal vazia: o resgate usa a vez, mas só enquanto houver cota', () => {
    expect(escolherGrupo({ posicao: 1, resgateLigado: true, cotaDeResgate: true, resgateElegivel: true, principalTem: false })).toBe('resgate');
    expect(escolherGrupo({ posicao: 1, resgateLigado: true, cotaDeResgate: false, resgateElegivel: true, principalTem: false })).toBeNull();
  });

  it('disjuntor do grupo (ou erro de leitura) fecha o resgate, e a principal segue', () => {
    expect(escolherGrupo({ posicao: 2, resgateLigado: false, cotaDeResgate: true, resgateElegivel: true, principalTem: true })).toBe('principal');
    expect(escolherGrupo({ posicao: 2, resgateLigado: false, cotaDeResgate: true, resgateElegivel: true, principalTem: false })).toBeNull();
  });

  it('o teto é 5 e a env só aperta', () => {
    expect(tetoResgateDoDia()).toBe(5);
    expect(tetoResgateDoDia('2')).toBe(2);
    expect(tetoResgateDoDia('0')).toBe(0);
    expect(tetoResgateDoDia('50')).toBe(5);
    expect(tetoResgateDoDia('abc')).toBe(5);
  });
});

describe('resgate: o mês e os textos', () => {
  it('o mês por extenso, minúsculo, em Brasília', () => {
    expect(mesPorExtenso('2026-09-24T17:00:00Z')).toBe('setembro');
    expect(mesPorExtenso('2026-03-10T12:00:00Z')).toBe('março');
    // 01/10 00:30 UTC ainda é 30/09 em Brasília.
    expect(mesPorExtenso('2026-10-01T00:30:00Z')).toBe('setembro');
    expect(mesPorExtenso('2026-10-01T03:00:00Z')).toBe('outubro');
    expect(mesPorExtenso('lixo')).toBe('');
    expect(mesPorExtenso(null)).toBe('');
  });

  it('as 4 aberturas e a reserva usam {valor} e {mes}; só as 4 usam {nome}', () => {
    expect(ABERTURAS_RESGATE).toHaveLength(4);
    for (const a of ABERTURAS_RESGATE) { expect(a).toContain('{nome}'); expect(a).toContain('{valor}'); expect(a).toContain('{mes}'); }
    expect(ABERTURA_RESGATE_SEM_NOME).toContain('{valor}');
    expect(ABERTURA_RESGATE_SEM_NOME).toContain('{mes}');
    expect(ABERTURA_RESGATE_SEM_NOME).not.toContain('{nome}');
    expect(CONVERSA_DE_RESGATE).toContain('{mes}');
  });

  it('nenhuma variável sobra depois de renderizar, e o texto não fala em "faltou" nem "não confirmou"', () => {
    for (let i = 0; i < 4; i++) {
      const t = textoDaAberturaResgate(i, 'Carlos Lima', 'R$ 140 mil', '2026-09-24T17:00:00Z');
      expect(t).not.toMatch(/\{[^}]*\}/);
      expect(t).toContain('Carlos');
      expect(t).toContain('R$ 140 mil');
      expect(t).toContain('setembro');
      expect(t).not.toMatch(/faltou|não confirmou|vídeo|link/i);
    }
  });

  it('nome que não parece de pessoa usa a reserva, sem nome', () => {
    const r = renderAberturaResgate('3499990001', 'Eletro posto', 'R$ 140 mil', '2026-09-24T17:00:00Z');
    expect(r.indice).toBe(-1);
    expect(r.texto).toBe(ABERTURA_RESGATE_SEM_NOME.split('{valor}').join('R$ 140 mil').split('{mes}').join('setembro'));
    expect(r.texto).not.toMatch(/\{[^}]*\}/);
  });

  it('o valor "Até R$ 50 mil" cai minúsculo no meio da frase, como nas outras aberturas', () => {
    expect(textoDaAberturaResgate(0, 'Carla', 'Até R$ 50 mil', '2026-09-24T17:00:00Z')).toContain('com até R$ 50 mil para investir');
  });

  it('a variação é determinística pela chave', () => {
    const a = renderAberturaResgate('3499990001', 'Ana', 'R$ 140 mil', '2026-09-24T17:00:00Z');
    const b = renderAberturaResgate('3499990001', 'Ana', 'R$ 140 mil', '2026-09-24T17:00:00Z');
    expect(a).toEqual(b);
    const indices = new Set(['3400000000', '3400000001', '3400000002', '3400000003'].map(k => renderAberturaResgate(k, 'Ana', 'R$ 1 mil', '2026-09-24T17:00:00Z').indice));
    expect(indices.size).toBe(4);
  });

  it('o parágrafo dos fatos leva o mês, e SÓ a conversa de resgate o recebe', () => {
    const ctx = { nome: 'Carlos', valorTxt: 'R$ 140 mil', cidade: null, consultor: 'Thiago', oferta: [], dados: {} };
    const comResgate = montarSistema({ ...ctx, resgateEm: '2026-09-24T17:00:00Z' });
    expect(comResgate).toContain(paragrafoDeResgate('2026-09-24T17:00:00Z'));
    expect(comResgate).toContain('uma reunião marcada em setembro');
    expect(comResgate).not.toContain('{mes}');
    const semResgate = montarSistema(ctx);
    expect(semResgate).not.toContain('Esta pessoa já teve uma reunião marcada');
    // Fora esse parágrafo, o sistema é idêntico: nada mais mudou.
    expect(comResgate.replace(`\n\n${paragrafoDeResgate('2026-09-24T17:00:00Z')}`, '')).toBe(semResgate);
  });
});
