import { describe, it, expect } from 'vitest';

// AS DUAS FAIXAS DA GRADE DO ELETROPOSTO (30/09/2026).
//
// Ordem do Thiago: "clientes novos de agenda ocupará hora e hora e meia, os
// clientes remarcados e followups hora e quinze e hora e quarenta e cinco".
//
// A regra parece uma lista nova de horários e não é: ela não funciona sem mexer
// na distância mínima entre compromissos. Com a régua antiga (30 min pra tudo),
// 14:15 fica a 15 min de 14:00 E de 14:30, `|15| < 30` recusa dos dois lados, e
// a faixa de remarcação nasceria impossível de usar — o robô varreria 21 dias e
// não acharia vaga nenhuma. É esse o buraco que estes testes prendem.
//
// E há o lado oposto, que é o que pode quebrar em produção: afrouxar a folga pra
// todo mundo faria a reunião de SOLAR em horário quebrado (14:10) parar de
// ocupar a meia hora dela, e o robô marcaria eletroposto por cima de uma reunião
// que já existe. A folga só cai quando os DOIS horários estão na grade.

import {
  horasDoDia, livrePara, folgaDoCompromisso, type Compromisso,
} from '../services/io/eletropostoVagas';

/** Um horário de Brasília. `-03:00` fixo, como no módulo. */
const t = (hhmm: string, dia = '2026-10-06'): number =>
  new Date(`${dia}T${hhmm}:00-03:00`).getTime();
const iso = (hhmm: string, dia = '2026-10-06'): string => new Date(t(hhmm, dia)).toISOString();

const DONO = 'Diego';
/** Reunião de ELETROPOSTO (a nossa). */
const ocupa = (...hs: string[]): Compromisso[] => hs.map(h => ({ ts: t(h), dono: DONO, ep: true }));
/** Reunião de SOLAR: outra origem, ocupa a meia hora inteira. */
const ocupaSolar = (...hs: string[]): Compromisso[] => hs.map(h => ({ ts: t(h), dono: DONO, ep: false }));

// 06/10/2026 é uma terça — a grade `HORAS_PADRAO`, de meia em meia hora.
describe('a grade de cada faixa', () => {
  it('lead novo continua caindo em hora cheia e meia hora', () => {
    const g = horasDoDia('2026-10-06');
    expect(g).toContain('14:00');
    expect(g).toContain('14:30');
    expect(g.every(h => /:(00|30)$/.test(h))).toBe(true);
  });

  it('remarcação e follow-up caem nos quinze', () => {
    const g = horasDoDia('2026-10-06', 'remarcacao');
    expect(g).toContain('14:15');
    expect(g).toContain('14:45');
    expect(g.every(h => /:(15|45)$/.test(h))).toBe(true);
  });

  it('as duas faixas têm o mesmo tamanho e nunca coincidem', () => {
    for (const dia of ['2026-10-05', '2026-10-06', '2026-10-09']) {   // segunda, terça, sexta
      const novo = horasDoDia(dia);
      const rem = horasDoDia(dia, 'remarcacao');
      expect(rem.length).toBe(novo.length);
      expect(rem.filter(h => novo.includes(h))).toEqual([]);
    }
  });

  it('a faixa de remarcação é DERIVADA: mexer na grade mexe nas duas', () => {
    // Prende a derivação, não os valores: se um dia alguém trocar a grade da
    // tarde, a faixa de remarcação tem que acompanhar sozinha. Uma segunda lista
    // literal no arquivo passaria neste teste só por sorte.
    const novo = horasDoDia('2026-10-06');
    const rem = horasDoDia('2026-10-06', 'remarcacao');
    novo.forEach((h, i) => {
      const [hh, mm] = h.split(':').map(Number);
      const esperado = `${String(Math.floor((hh * 60 + mm + 15) / 60) % 24).padStart(2, '0')}:${String((mm + 15) % 60).padStart(2, '0')}`;
      expect(rem[i]).toBe(esperado);
    });
  });

  it('a segunda-feira, que tem grade própria, também ganha a faixa', () => {
    // 05/10/2026 é segunda: HORAS_SEGUNDA, de hora em hora.
    expect(horasDoDia('2026-10-05', 'remarcacao')).toContain('13:15');
  });
});

describe('a distância mínima, que é o que faz a faixa existir', () => {
  it('a remarcação cabe entre dois clientes novos', () => {
    // O caso central da ordem: 14:00 e 14:30 vendidos pra lead novo, e a
    // remarcação entra às 14:15 sem derrubar nenhum dos dois.
    expect(livrePara(iso('14:15'), DONO, ocupa('14:00', '14:30'))).toBe(true);
  });

  it('mas não cabe duas vezes no mesmo quinze', () => {
    expect(livrePara(iso('14:15'), DONO, ocupa('14:15'))).toBe(false);
  });

  it('reunião de SOLAR em horário quebrado continua ocupando meia hora', () => {
    // A proteção que não pode cair junto: 14:10 não é da nossa grade, então ela
    // segura 14:00 e 14:15. Sem isto o robô marcaria por cima de uma reunião viva.
    expect(livrePara(iso('14:00'), DONO, ocupaSolar('14:10'))).toBe(false);
    expect(livrePara(iso('14:15'), DONO, ocupaSolar('14:10'))).toBe(false);
  });

  // O BUG QUE A PRIMEIRA VERSÃO TINHA, e que um teste do `eletropostoRemarcar`
  // pegou: a folga olhava só o MINUTO. Reunião de solar do Meta cai em horário
  // quebrado e 13:15/14:15 são dos mais comuns lá — pelo minuto ela passaria por
  // remarcação nossa, encolheria pra 15 min, e o robô marcaria eletroposto às
  // 14:00 por cima de uma reunião que já existe. Quem separa é a ORIGEM.
  it('solar às 14:15 NÃO é remarcação: continua fechando as 14:00', () => {
    expect(livrePara(iso('14:00'), DONO, ocupaSolar('14:15'))).toBe(false);
    expect(livrePara(iso('14:00'), DONO, ocupa('14:15'))).toBe(true);
  });

  it('ficha sem origem conhecida ocupa meia hora — na dúvida, não marca por cima', () => {
    expect(livrePara(iso('14:00'), DONO, [{ ts: t('14:15'), dono: DONO }])).toBe(false);
  });

  it('dois clientes novos de meia em meia hora seguem convivendo', () => {
    // Comportamento de 31/08 que não pode regredir.
    expect(livrePara(iso('14:30'), DONO, ocupa('14:00'))).toBe(true);
  });

  it('a agenda do OUTRO consultor nunca bloqueia', () => {
    expect(livrePara(iso('14:15'), 'Thiago', ocupa('14:00', '14:15', '14:30'))).toBe(true);
  });

  it('reunião NOSSA na grade vale 15 min, nos dois sentidos; o resto vale 30', () => {
    // A folga é 15 tanto pro lado da remarcação (:15/:45) quanto pro do lead
    // novo (:00/:30), e tem que ser: se só a remarcação encolhesse, a PRIMEIRA
    // das duas a ser marcada trancaria a outra, e qual delas depende da ordem de
    // chegada — bug que só aparece em metade dos dias.
    expect(folgaDoCompromisso({ ts: t('14:15'), dono: DONO, ep: true })).toBe(15 * 60 * 1000);
    expect(folgaDoCompromisso({ ts: t('14:45'), dono: DONO, ep: true })).toBe(15 * 60 * 1000);
    expect(folgaDoCompromisso({ ts: t('14:00'), dono: DONO, ep: true })).toBe(15 * 60 * 1000);
    // Origem de fora, ou horário que não é da grade: meia hora inteira.
    expect(folgaDoCompromisso({ ts: t('14:15'), dono: DONO, ep: false })).toBe(30 * 60 * 1000);
    expect(folgaDoCompromisso({ ts: t('14:10'), dono: DONO, ep: true })).toBe(30 * 60 * 1000);
    expect(folgaDoCompromisso({ ts: t('14:00'), dono: DONO })).toBe(30 * 60 * 1000);
  });

  it('a ordem de chegada não muda o resultado', () => {
    // O mesmo par, marcado nas duas ordens, tem que caber das duas formas.
    expect(livrePara(iso('14:15'), DONO, ocupa('14:00'))).toBe(true);
    expect(livrePara(iso('14:00'), DONO, ocupa('14:15'))).toBe(true);
  });

  it('com a régua antiga a faixa seria inútil — é por isso que ela mudou', () => {
    // Documenta a conta que obrigou a mudança: 30 min pra tudo recusaria 14:15
    // tendo 14:00 marcado, e a ordem do Thiago não teria como ser cumprida.
    const distancia = Math.abs(t('14:15') - t('14:00'));
    expect(distancia).toBe(15 * 60 * 1000);
    expect(distancia < 30 * 60 * 1000).toBe(true);        // recusaria
    expect(distancia < folgaDoCompromisso({ ts: t('14:15'), dono: DONO, ep: true })).toBe(false);
  });
});
