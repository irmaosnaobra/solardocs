import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O placar do 5040 manda um NÚMERO cinco vezes por dia no celular da Giovanna.
// O erro caro aqui não é errar a conta por uma unidade: é tocar o celular dela
// no sábado, às 3 da manhã, ou duas vezes no mesmo slot — que é como um recado
// interno vira um robô que ela silencia.
//
// Então o que este arquivo tranca são as duas partes puras: a JANELA (quem pode
// tocar e quando) e o TEXTO (o delta que faz um número repetido continuar sendo
// lido). A leitura do banco não entra aqui de propósito — ela é I/O, e o que ela
// tem de regra própria (a bolha da recepção, a ordem decrescente) está medida no
// comentário do serviço.
// ─────────────────────────────────────────────────────────────────────────────

import { noHorario, montarPlacar, horasDoPlacar, desligado, type Placar } from '../services/io/placarGiovanna';

/** Um instante de Brasília, escrito como UTC (BRT = UTC-3, sem horário de verão). */
const brt = (iso: string): Date => new Date(`${iso}-03:00`);

const base: Placar = {
  conversas: 100, mensagens: 312, hoje: 31, mais24h: 54,
  maisAntigaH: 120, hora: 14, anterior: null, horaAnterior: null,
};

describe('placar do 5040 — a janela', () => {
  const envAntes = { ...process.env };
  beforeEach(() => { delete process.env.PLACAR_HORAS; delete process.env.PLACAR_OFF; });
  afterEach(() => { process.env = { ...envAntes }; });

  it('toca nas horas pedidas: 8, 10, 12, 14 e 16', () => {
    for (const h of [8, 10, 12, 14, 16]) {
      const r = noHorario(brt(`2026-09-21T${String(h).padStart(2, '0')}:00:00`));  // segunda
      expect(r.ok, `${h}h deveria disparar`).toBe(true);
      expect(r.hora).toBe(h);
    }
  });

  it('não toca nas horas de fora, inclusive as 17 e as 9', () => {
    for (const h of [7, 9, 11, 13, 15, 17, 18, 21, 3]) {
      const r = noHorario(brt(`2026-09-21T${String(h).padStart(2, '0')}:30:00`));
      expect(r.ok, `${h}h não deveria disparar`).toBe(false);
      expect(r.motivo).toBe('fora_da_hora');
    }
  });

  // O pedido é "de segunda a sexta". Sábado com fila cheia é o caso que mais
  // tenta o robô a falar — e é exatamente quando ninguém vai responder.
  it('cala no sábado e no domingo', () => {
    expect(noHorario(brt('2026-09-18T14:00:00')).ok).toBe(true);           // sexta
    expect(noHorario(brt('2026-09-19T14:00:00')).motivo).toBe('fim_de_semana');  // sábado
    expect(noHorario(brt('2026-09-20T14:00:00')).motivo).toBe('fim_de_semana');  // domingo
    expect(noHorario(brt('2026-09-21T14:00:00')).ok).toBe(true);           // segunda
  });

  it('cala em feriado nacional', () => {
    // 12/10/2026 (Nossa Senhora Aparecida) cai numa segunda.
    const r = noHorario(brt('2026-10-12T10:00:00'));
    expect(r.motivo).toBe('feriado');
  });

  // A cadência é recado interno: mudar de ideia sobre ela não pode exigir deploy.
  it('a lista de horas sai da env', () => {
    process.env.PLACAR_HORAS = '9,15';
    expect(horasDoPlacar()).toEqual([9, 15]);
    expect(noHorario(brt('2026-09-22T09:00:00')).ok).toBe(true);
    expect(noHorario(brt('2026-09-22T08:00:00')).ok).toBe(false);
  });

  it('PLACAR_OFF=1 desliga sem deploy', () => {
    expect(desligado()).toBe(false);
    process.env.PLACAR_OFF = '1';
    expect(desligado()).toBe(true);
  });
});

describe('placar do 5040 — o texto', () => {
  it('leva os dois números que o Thiago pediu: conversas e mensagens', () => {
    const t = montarPlacar(base);
    expect(t).toContain('*100* pessoas esperando resposta');
    expect(t).toContain('*312* mensagens sem retorno');
    expect(t).toContain('14h');
  });

  // O número sem o delta é o que faz cinco recados por dia virarem ruído.
  it('compara com o tick anterior, pra cima e pra baixo', () => {
    expect(montarPlacar({ ...base, conversas: 100, anterior: 97, horaAnterior: 12 }))
      .toContain('Às 12h eram 97. Subiu 3.');
    expect(montarPlacar({ ...base, conversas: 90, anterior: 97, horaAnterior: 12 }))
      .toContain('Às 12h eram 97. Caiu 7.');
    expect(montarPlacar({ ...base, conversas: 97, anterior: 97, horaAnterior: 12 }))
      .toContain('A fila não andou.');
  });

  it('no primeiro placar do dia não inventa comparação', () => {
    const t = montarPlacar({ ...base, hora: 8, anterior: null, horaAnterior: null });
    // "eram" cru daria falso negativo: "escreveram hoje" contém a palavra.
    expect(t).not.toMatch(/Às \d+h eram/);
    expect(t).not.toContain('Subiu');
    expect(t).not.toContain('Caiu');
    expect(t).not.toContain('não andou');
  });

  // "Sem ler" não existe no banco. O texto não pode deixar o número passar por
  // contagem de não lidas do WhatsApp, que é outra coisa.
  it('diz que a conta é de quem ficou sem resposta, lido ou não', () => {
    expect(montarPlacar(base)).toContain('lido ou não');
  });

  it('fila zerada vira comemoração curta, não um relatório de zeros', () => {
    const t = montarPlacar({ ...base, conversas: 0, mensagens: 0, hoje: 0, mais24h: 0, maisAntigaH: 0 });
    expect(t).toContain('zerada');
    expect(t).not.toContain('sem retorno');
  });

  it('espera longa vira dia, não um número de horas que ninguém lê', () => {
    expect(montarPlacar({ ...base, maisAntigaH: 120 })).toContain('há 5 dias');
    expect(montarPlacar({ ...base, maisAntigaH: 6 })).toContain('há 6h');
  });

  it('não leva nome nem link — isso é da sentinela, e repetir é ser silenciado', () => {
    const t = montarPlacar({ ...base, anterior: 97, horaAnterior: 12 });
    expect(t).not.toContain('wa.me');
  });

  it('uma pessoa só não vira "1 pessoas"', () => {
    const t = montarPlacar({ ...base, conversas: 1, mensagens: 1, hoje: 1, mais24h: 0 });
    expect(t).toContain('*1* pessoa esperando');
    expect(t).toContain('*1* mensagem sem retorno');
  });
});
