import { describe, it, expect } from 'vitest';

// UMA BOLHA, TRÊS HORÁRIOS, NENHUM CONVITE REPETIDO.
//
// Este robô fala com gente que nunca respondeu nada — é o caso em que a linha
// mais se parece com disparo, e ela já foi bloqueada três vezes por volume
// (01–03/ago, 04–06/ago e 30/ago). Por isso o que este teste protege não é o
// texto bonito: é a régua que impede o número de cair de novo.
//
//   • a mensagem tem que ser UMA. Cinco balões por pessoa foi exatamente o
//     padrão que derrubou a linha em agosto (57 mensagens em 5h).
//   • os horários têm que estar DENTRO dela. Se a lista não for junto, a
//     conversa vira "tem interesse?" → "tenho" → "que horas?" — três toques
//     por pessoa em vez de um.
//   • telefone sem DDI não entra: 8 fichas do eletroposto já ficaram mudas
//     porque o número foi montado errado.
import {
  bolhaConvite, normalizarTel, foraDaJanela, minutosBrasilia, positivoSemHorario,
} from '../services/io/eletropostoConviteInvestidor';

const OFERTAS = [
  '2026-09-14T17:00:00.000Z',   // segunda, 14h BRT
  '2026-09-14T18:00:00.000Z',   // segunda, 15h BRT
  '2026-09-15T16:00:00.000Z',   // terça, 13h BRT
];

describe('convite ao investidor — a mensagem', () => {
  it('é UMA bolha só: a linha corta rajada desde o bloqueio', () => {
    const b = bolhaConvite('Lucas Araujo Bezerra', 'Propriá/SE', OFERTAS, 'Thiago');
    expect(b).toHaveLength(1);
  });

  it('leva os três horários na própria mensagem, numerados', () => {
    const [txt] = bolhaConvite('Lucas', 'Propriá/SE', OFERTAS, 'Thiago');
    expect(txt).toContain('1)');
    expect(txt).toContain('2)');
    expect(txt).toContain('3)');
    // e diz o que fazer com eles — sem isto o lead responde "pode ser" e não marca nada
    expect(txt).toMatch(/responde 1, 2 ou 3/i);
  });

  it('abre pelo que a PESSOA respondeu, não pelo que a gente vende', () => {
    const [txt] = bolhaConvite('Lucas', 'Propriá/SE', OFERTAS, 'Thiago');
    const ondeFalaDela = txt.indexOf('já tem o capital');
    const ondeFalaDaGente = txt.indexOf('importa os carregadores');
    expect(ondeFalaDela).toBeGreaterThan(-1);
    expect(ondeFalaDaGente).toBeGreaterThan(ondeFalaDela);
  });

  it('cita a cidade que ela mesma deu — é o que prova que não é disparo', () => {
    const [txt] = bolhaConvite('Lucas', 'Propriá/SE', OFERTAS, 'Thiago');
    expect(txt).toContain('Propriá/SE');
  });

  it('sem cidade na ficha, não inventa nem deixa buraco na frase', () => {
    const [txt] = bolhaConvite('Lucas', null, OFERTAS, 'Diego');
    expect(txt).toContain('já viu um ponto.');
    expect(txt).not.toContain('em .');
    expect(txt).not.toContain('undefined');
  });

  it('assina com o consultor de quem são os horários oferecidos', () => {
    const [txt] = bolhaConvite('Lucas', 'Manaus', OFERTAS, 'Diego');
    expect(txt).toContain('o Diego');
  });

  it('diz as três formas de pagar, que é o que o Thiago pediu na mensagem', () => {
    const [txt] = bolhaConvite('Lucas', 'Manaus', OFERTAS, 'Thiago');
    expect(txt).toMatch(/à vista/i);
    expect(txt).toMatch(/18x/);
    expect(txt).toMatch(/72 meses/);
  });

  it('trata nome vazio sem virar "Oi !"', () => {
    const [txt] = bolhaConvite('', 'Manaus', OFERTAS, 'Thiago');
    expect(txt.startsWith('Oi!')).toBe(true);
  });
});

describe('convite ao investidor — o telefone', () => {
  it('exige DDI: número sem 55 não vira chave de fila', () => {
    expect(normalizarTel('34998165040')).toBeNull();
  });

  it('aceita o formato que a ficha grava', () => {
    expect(normalizarTel('5534998165040')).toBe('5534998165040');
  });

  it('descarta o 55 duplicado, que já deixou 8 fichas mudas', () => {
    // 555534998165040 tem 15 dígitos — fora da faixa de 12 a 13
    expect(normalizarTel('555534998165040')).toBeNull();
  });

  it('ignora máscara e espaço', () => {
    expect(normalizarTel('+55 (34) 99816-5040')).toBe('5534998165040');
  });

  it('recusa vazio e lixo', () => {
    expect(normalizarTel(null)).toBeNull();
    expect(normalizarTel('')).toBeNull();
    expect(normalizarTel('abc')).toBeNull();
  });
});


// A JANELA VAI ATÉ 21:45, E 45 MINUTOS NÃO CABEM EM HORA CHEIA.
//
// Com corte por hora só existiam duas saídas erradas: parar às 21:00 (perder os
// 45min que o dono pediu) ou varar as 22h. O relógio da linha é em minuto.
const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`);

describe('convite ao investidor — janela de envio', () => {
  it('19:30 está dentro: é a hora em que o dono mandou começar', () => {
    expect(foraDaJanela(brt('2026-09-09', '19:30'))).toBe(false);
  });

  it('21:44 ainda manda; 21:45 já não', () => {
    expect(foraDaJanela(brt('2026-09-09', '21:44'))).toBe(false);
    expect(foraDaJanela(brt('2026-09-09', '21:45'))).toBe(true);
  });

  it('07:00 abre e 06:59 não', () => {
    expect(foraDaJanela(brt('2026-09-10', '07:00'))).toBe(false);
    expect(foraDaJanela(brt('2026-09-10', '06:59'))).toBe(true);
  });

  it('madrugada fica fora — foi o que já saiu por engano às 01h13', () => {
    expect(foraDaJanela(brt('2026-09-10', '01:13'))).toBe(true);
  });

  it('lê minuto de verdade, não só a hora', () => {
    expect(minutosBrasilia(brt('2026-09-09', '19:30'))).toBe(19 * 60 + 30);
  });
});

// POSITIVO QUE NÃO ESCOLHEU HORÁRIO AINDA É POSITIVO.
//
// Sem este caminho, "tenho interesse" caía no `nada`: virava aviso pra equipe e
// a reunião ficava esperando alguém ler o recado. É o buraco que fez 178 das 194
// fichas nunca chegarem à agenda.
describe('convite ao investidor — quem diz sim sem apontar horário', () => {
  it.each([
    ['tenho interesse'], ['quero sim'], ['pode marcar'], ['bora'],
    ['me interessa'], ['fechado'], ['perfeito'], ['pode ser'],
  ])('reconhece "%s" como positivo', (t) => {
    expect(positivoSemHorario([t])).toBe(true);
  });

  it.each([
    ['não tenho interesse'], ['nao quero'], ['sem interesse'],
    ['pare de mandar mensagem'], ['desisti'],
  ])('NÃO confunde "%s" com positivo', (t) => {
    expect(positivoSemHorario([t])).toBe(false);
  });

  it('mensagem vazia não é sim', () => {
    expect(positivoSemHorario([])).toBe(false);
    expect(positivoSemHorario([''])).toBe(false);
  });

  it('"não tenho interesse" contém "interesse" e mesmo assim é não', () => {
    // a negativa é testada ANTES da positiva de propósito
    expect(positivoSemHorario(['Obrigado, mas não tenho interesse'])).toBe(false);
  });
});
