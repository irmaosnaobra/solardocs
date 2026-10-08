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

  // ── A FAIXA DE FOLLOW-UP VALE O DIA INTEIRO (ordem do Thiago, 30/09) ──────
  // "A agenda para follow-up vai ficar liberada todo o período, das 8h15 até as
  // 17h45. Pode ficar marcado durante todo o dia."
  //
  // Isto DERRUBOU o desenho anterior, em que a faixa era derivada da grade de
  // venda (+15 min). Derivando, a terça só teria follow-up das 13:15 às 17:45,
  // porque a venda da tarde começa às 13:00: a manhã inteira ficaria fechada
  // pra remarcar, sem motivo — remarcação não disputa horário de vitrine.
  it('follow-up abre 08:15 e fecha 17:45', () => {
    const g = horasDoDia('2026-10-06', 'remarcacao');
    expect(g[0]).toBe('08:15');
    expect(g[g.length - 1]).toBe('17:45');
  });

  it('são 20 horários de follow-up, de 30 em 30 minutos', () => {
    const g = horasDoDia('2026-10-06', 'remarcacao');
    expect(g.length).toBe(20);
    for (let i = 1; i < g.length; i++) {
      const min = (h: string) => Number(h.split(':')[0]) * 60 + Number(h.split(':')[1]);
      expect(min(g[i]) - min(g[i - 1])).toBe(30);
    }
  });

  it('a faixa de follow-up é IGUAL em todo dia útil, inclusive na segunda', () => {
    // A grade de VENDA muda por dia (segunda tem lista própria, dia pós-feriado
    // ganha manhã). A de follow-up não: ela é a mesma sempre, e é isso que quer
    // dizer "liberada todo o período".
    const terca = horasDoDia('2026-10-06', 'remarcacao');
    for (const dia of ['2026-10-05', '2026-10-07', '2026-10-08', '2026-10-09']) {
      expect(horasDoDia(dia, 'remarcacao')).toEqual(terca);
    }
  });

  it('a manhã, que a venda não tem na terça, existe pro follow-up', () => {
    const g = horasDoDia('2026-10-06', 'remarcacao');
    expect(g).toContain('08:15');
    expect(g).toContain('11:45');
    expect(horasDoDia('2026-10-06').some(h => h < '13:00')).toBe(false);   // venda não
  });

  it('o almoço entra no follow-up de propósito', () => {
    // "Pode ficar marcado durante todo o dia". A grade de venda pula as 12h;
    // esta não pula, porque follow-up é ligação de 15 min, não apresentação.
    // Tirar 12:15 e 12:45 é uma linha, se ele mudar de ideia.
    const g = horasDoDia('2026-10-06', 'remarcacao');
    expect(g).toContain('12:15');
    expect(g).toContain('12:45');
  });

  it('as duas faixas nunca coincidem', () => {
    for (const dia of ['2026-10-05', '2026-10-06', '2026-10-09']) {
      const novo = horasDoDia(dia);
      const rem = horasDoDia(dia, 'remarcacao');
      expect(rem.filter(h => novo.includes(h))).toEqual([]);
    }
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

// ── AS DUAS PONTAS TÊM QUE CONCORDAR ───────────────────────────────────────
//
// A revisão de 30/09/2026 achou o defeito que este bloco existe pra impedir de
// voltar: a vitrine jogava fora a bandeira `ep` no map, o ramo novo do
// `donosLivres` virava código morto, e ela escondia um horário redondo que o
// servidor continuava achando livre. Ninguém percebeu porque o teste cobria o
// servidor e a conferência manual montou o objeto com `ep` na mão, pulando
// justamente o map defeituoso.
//
// Então aqui a régua da VITRINE é reescrita em TypeScript, igualzinha, e as
// duas são comparadas em cima dos mesmos casos. Se alguém mexer num lado só,
// isto quebra.
describe('a vitrine e o servidor dizem a mesma coisa', () => {
  const DUR = 30 * 60 * 1000;
  const REMARC = 15 * 60 * 1000;
  const VIST = 60 * 60 * 1000;
  const nosQuinze = (ts: number) => [15, 45].includes(new Date(ts).getUTCMinutes());
  /** Cópia fiel de `duracaoDe` + `donosLivres` da LP do eletroposto. */
  const vitrineDiz = (slot: number, c: { ts: number; ep?: boolean; vistoria?: boolean; ini?: number; fim?: number }): boolean => {
    // Cópia do map do `carregarOcupados` (07/10/2026): bloco pronto da visita do
    // quiz solar vira ts = ini e dur = fim - ini, sem bandeira `ep`.
    if (c.ini && c.fim && c.fim > c.ini) return !(c.ini < slot + DUR && slot < c.fim);
    const dur = c.vistoria ? VIST : (c.ep && nosQuinze(c.ts) ? REMARC : DUR);
    if (c.ep && nosQuinze(c.ts)) return !(Math.abs(c.ts - slot) < REMARC);
    return !(c.ts < slot + DUR && slot < c.ts + dur);
  };

  const CASOS: Array<[string, string, Partial<Compromisso>]> = [
    ['lead novo 14:00 x remarcacao nossa 14:15', '14:00', { ts: t('14:15'), ep: true }],
    ['lead novo 14:30 x remarcacao nossa 14:15', '14:30', { ts: t('14:15'), ep: true }],
    ['lead novo 14:00 x lead novo 14:00',        '14:00', { ts: t('14:00'), ep: true }],
    ['lead novo 14:30 x lead novo 14:00',        '14:30', { ts: t('14:00'), ep: true }],
    ['lead novo 14:00 x solar do Meta 14:15',    '14:00', { ts: t('14:15'), ep: false }],
    ['lead novo 14:00 x solar quebrado 14:10',   '14:00', { ts: t('14:10'), ep: false }],
    ['lead novo 13:00 x vistoria 13:30 (1h)',    '13:00', { ts: t('13:30'), ep: false, vistoria: true }],
    ['lead novo 14:00 x vistoria 13:30 (1h)',    '14:00', { ts: t('13:30'), ep: false, vistoria: true }],
    ['lead novo 14:30 x vistoria 13:30 (1h)',    '14:30', { ts: t('13:30'), ep: false, vistoria: true }],
    // Visita do quiz solar com estrada: marcada 10:00 em Patrocínio, o sócio sai
    // 07:49 e volta 13:11. Fecha o 13:00 dos dois lados; o 13:30 continua à venda.
    ['lead novo 13:00 x rota que volta 13:11',   '13:00', { ts: t('10:00'), ep: false, vistoria: true, ini: t('07:49'), fim: t('13:11') }],
    ['lead novo 13:30 x rota que volta 13:11',   '13:30', { ts: t('10:00'), ep: false, vistoria: true, ini: t('07:49'), fim: t('13:11') }],
    ['lead novo 10:00 x rota de Catalão 08:02-10:58', '10:00', { ts: t('09:00'), ep: false, vistoria: true, ini: t('08:02'), fim: t('10:58') }],
    ['lead novo 11:00 x rota de Catalão 08:02-10:58', '11:00', { ts: t('09:00'), ep: false, vistoria: true, ini: t('08:02'), fim: t('10:58') }],
  ];

  for (const [nome, slot, comp] of CASOS) {
    it(nome, () => {
      const c = { dono: DONO, ...comp } as Compromisso;
      expect(livrePara(iso(slot), DONO, [c])).toBe(vitrineDiz(t(slot), c));
    });
  }

  it('a vistoria de 1h fecha as 14:00 no servidor, como já fechava na vitrine', () => {
    const vist = { ts: t('13:30'), dono: DONO, ep: false, vistoria: true } as Compromisso;
    expect(livrePara(iso('14:00'), DONO, [vist])).toBe(false);   // o sócio está na rua
    expect(livrePara(iso('13:00'), DONO, [vist])).toBe(true);    // acaba quando ela começa
  });

  it('sem a marca de vistoria ela voltaria a valer meia hora, e as 14:00 abririam', () => {
    // Prende a razão de `vistoria` existir no tipo: é ela que separa 1h de 30min.
    const comoAntes = { ts: t('13:30'), dono: DONO, ep: false } as Compromisso;
    expect(livrePara(iso('14:00'), DONO, [comoAntes])).toBe(true);
  });
});

// A cópia da vitrine aqui em cima só vale se a página fizer a mesma coisa. Lê o
// HTML e confere que o map do `carregarOcupados` usa o bloco pronto da visita.
describe('a vitrine do eletroposto lê o bloco da visita do solar', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const html = readFileSync(join(__dirname, '../../../dashboard/public/io/eletroposto/index.html'), 'utf8');
  it('o map troca ts e dur por ini e fim quando eles vêm', () => {
    expect(html).toMatch(/\(a\.ini && a\.fim > a\.ini\)/);
    expect(html).toMatch(/\{ ts: a\.ini, dono: String\(a\.dono\), ep: false, dur: a\.fim - a\.ini \}/);
  });
});
