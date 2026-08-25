import { describe, it, expect } from 'vitest';

// A feira (25–27/08/2026) cai em cima de uma agenda que já tinha 23 reuniões
// marcadas. Os riscos aqui são dois, e os dois são visíveis pro cliente:
//   1. a agenda continuar VENDENDO os três dias (ou o robô continuar oferecendo)
//   2. a mensagem culpar o cliente por uma ausência que é NOSSA
// O resto (fila, teto da linha, idempotência) é reaproveitado de agentes que já
// têm teste próprio — o que este arquivo trava é a régua nova.

import {
  agendaFechadaEm, agendaFechadaNoIso, ehSocio, temAgendaFechada, diasFechados,
} from '../services/agenda/agendaFechada';
import { bolhasFeiraEletroposto, bolhasFeiraSolar } from '../services/io/intersolarFeiraAgenda';
import { agendaAbre } from '../services/io/eletropostoVagas';

/** ISO de um horário de Brasília (o `-03:00` é fixo: sem horário de verão). */
const brt = (ymd: string, hora: number) => new Date(`${ymd}T${String(hora).padStart(2, '0')}:00:00-03:00`).toISOString();

describe('agendaFechada — os três dias da Intersolar', () => {
  it('fecha 25, 26 e 27/08 e mais nenhum', () => {
    expect(diasFechados()).toEqual(['2026-08-25', '2026-08-26', '2026-08-27']);
    expect(temAgendaFechada()).toBe(true);
    for (const d of ['2026-08-25', '2026-08-26', '2026-08-27']) expect(agendaFechadaEm(d)).toBe(true);
    // Sexta e segunda são justamente os dias que o Thiago reservou pros novos.
    expect(agendaFechadaEm('2026-08-28')).toBe(false);
    expect(agendaFechadaEm('2026-08-31')).toBe(false);
    expect(agendaFechadaEm('2026-08-24')).toBe(false);
  });

  it('lê o dia no fuso de Brasília, não no UTC', () => {
    // 27/08 às 22h BRT é 28/08 em UTC. Comparar em UTC abriria a última noite da
    // feira e fecharia a madrugada da sexta.
    expect(agendaFechadaNoIso(brt('2026-08-27', 22))).toBe(true);
    expect(agendaFechadaNoIso(brt('2026-08-28', 0))).toBe(false);
    expect(agendaFechadaNoIso(null)).toBe(false);
    expect(agendaFechadaNoIso('não é data')).toBe(false);
  });

  it('só o Thiago e o Diego estão na feira — Nilce e Giovanna seguem atendendo', () => {
    expect(ehSocio('Thiago')).toBe(true);
    expect(ehSocio('diego')).toBe(true);
    expect(ehSocio('Nilce')).toBe(false);
    // A regra é por NOME. Com duas pessoas na conta baixa, "não é a Nilce" seria
    // exatamente o bug que fechou a agenda da Giovanna em 18/08.
    expect(ehSocio('Giovanna')).toBe(false);
    expect(ehSocio(null)).toBe(false);
  });
});

describe('a régua de vagas do servidor', () => {
  it('não oferece nenhum dos dias da feira', () => {
    expect(agendaAbre('2026-08-25')).toBe(false);   // terça
    expect(agendaAbre('2026-08-26')).toBe(false);   // quarta
    expect(agendaAbre('2026-08-27')).toBe(false);   // quinta
  });
  it('volta a abrir na sexta e na segunda seguintes', () => {
    expect(agendaAbre('2026-08-28')).toBe(true);
    expect(agendaAbre('2026-08-31')).toBe(true);
  });
  it('não mexeu no resto da régua (feriado e fim de semana seguem fechados)', () => {
    expect(agendaAbre('2026-09-07')).toBe(false);   // Independência
    expect(agendaAbre('2026-08-29')).toBe(false);   // sábado
    expect(agendaAbre('2026-08-24')).toBe(true);    // segunda normal
  });
});

describe('a mensagem', () => {
  const ofertas = [brt('2026-08-28', 14), brt('2026-08-28', 15), brt('2026-08-31', 13)];

  it('diz o motivo antes de qualquer horário, e o motivo é nosso', () => {
    const b = bolhasFeiraEletroposto('Pablo', ofertas, 'Thiago', brt('2026-08-26', 15), false);
    expect(b[0]).toContain('Pablo');
    expect(b[0]).toContain('Intersolar');
    expect(b[0]).toContain('25 a 27 de agosto');
    // Quem está mudando a reunião somos nós: nada de "você não conseguiu".
    expect(b[0]).not.toMatch(/você não (conseguiu|apareceu|compareceu)/i);
  });

  it('pede desculpa quando o horário JÁ PASSOU', () => {
    const b = bolhasFeiraEletroposto('Donizete', ofertas, 'Diego', brt('2026-08-25', 13), true);
    expect(b[0]).toContain('não conseguiu te atender');
    expect(b[0]).toContain('desculpa');
  });

  it('numera as opções no formato que o robô de remarcação sabe ler', () => {
    const b = bolhasFeiraEletroposto('', ofertas, 'Thiago', brt('2026-08-26', 15), false);
    // "1) sexta, 28/08 às 14h00" — é este texto que faz o "2" do cliente casar
    // com a oferta certa no escolhaDaResposta.
    expect(b[1]).toMatch(/1\) sexta, 28\/08 às 14h00/);
    expect(b[1]).toMatch(/2\) sexta, 28\/08 às 15h00/);
    expect(b[1]).toMatch(/3\) segunda, 31\/08 às 13h00/);
    expect(b[2]).toContain('número');
  });

  it('convida pro Instagram na última bolha, nos dois caminhos', () => {
    const ep = bolhasFeiraEletroposto('Ana', ofertas, 'Thiago', brt('2026-08-26', 15), false);
    const solar = bolhasFeiraSolar('Ana', 'Diego', brt('2026-08-26', 15), false);
    expect(ep[ep.length - 1]).toContain('@irmaosnaobra__');
    expect(solar[solar.length - 1]).toContain('@irmaosnaobra__');
  });

  it('abre sem vírgula solta quando o nome não presta ("Lead Instagram")', () => {
    const b = bolhasFeiraEletroposto('', ofertas, 'Thiago', brt('2026-08-26', 15), false);
    expect(b[0]).toMatch(/^Oi! /);
  });

  it('solar dos sócios não recebe lista de horários — a grade de vistoria é outra', () => {
    const b = bolhasFeiraSolar('Valter', 'Thiago', brt('2026-08-26', 9), false);
    expect(b.join(' ')).not.toMatch(/\d\) /);
    expect(b[1]).toContain('Thiago');
  });
});
