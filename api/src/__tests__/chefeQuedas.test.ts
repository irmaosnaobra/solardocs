import { describe, it, expect } from 'vitest';
import { simular, porHoraBrt, picoEmJanela, PedidoAgendado, ResultadoSimulacao, Enviado } from '../services/chefe/simular';

// ─────────────────────────────────────────────────────────────────────────────
// As 4 quedas da linha 5040, reencenadas pelo decidir() do CHEFE, tick a tick
// (2 min), com os números da memória. A pergunta de cada uma: com o CHEFE no
// meio, quantas mensagens teriam saído por hora?
//
//   01/08 (sáb) 4º toque da Bia: 57 toques em 5h, até 5 bolhas cada
//         [memória linha-io-5040-bloqueio-e-travas.md]
//   04/08 (ter) às 8h a fila da agenda soltou 8 pessoas e 37 mensagens numa
//         hora [memória janela-diurna-linha-whatsapp.md; código
//         lineThrottle.ts:121-126]. No mesmo dia a instância desconectou e
//         ficou ~41h fora, sem ser ban [memória linha-io-queda-04-06-ago.md];
//         o replay modela só a 1ª hora da queda, com a volta às 10h.
//   30/08 (dom) 98 envios frios a 18/h por ~9h pela rota crua, de 184
//         [memória linha-io-bloqueio-30-ago.md]
//   02/10 (sex) reagenda: 39 frios em 55 min, 3 bolhas cada, carimbando como
//         agenda [memória linha-io-queda-02-out-reagenda.md]
//
// E o CONTROLE POSITIVO: dias de agenda cheia (36 reuniões) com resposta, aviso
// e evento no meio. Nada importante fica de fora e nada de evento é adiado. Sem
// ele, um CHEFE que não deixa nada sair passaria em todos os replays acima.
//
// AGENDA NUNCA BLOQUEIA [regra do dono, 07/10/2026; memória
// agenda-nunca-bloqueia.md]: nos controles, nenhuma mensagem de agenda expira
// nem fica pendente, nem com as carteiras do solar na mesma linha, nem na hora de
// pico de conversa. Quando falta espaço, quem perde a vez é o frio.
//
// Os replays recebem o robô com a classe CERTA de CLASSE_POR_ROBO. Os casos de
// classe ERRADA (o frio pedindo como agenda, em 30/08 e em 02/10, o prazo
// inventado e o lote pedindo como evento) estão cravados como DÍVIDA CONHECIDA:
// o CHEFE puro não segura classe errada na escala da hora, e nenhum volume
// separa o frio mal classificado de uma agenda cheia. Desde a regra do dono a
// agenda está fora dos freios de volume, então essas dívidas PIORARAM (números
// novos abaixo): o que segura o robô frio pedindo como agenda é a rajada por
// robô (6 em 10 min) e a guarda arquivo → robôs permitidos (chefeGuarda, regra
// robo), que reprova o pedido com o nome de um robô de OUTRO arquivo. Dentro de
// um arquivo que pode pedir uma classe mais urgente que a do próprio robô ela não
// separa a classe, e a defesa completa é o passaporte por chamada (dívida).
// Telefones fictícios.
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 60_000;
const HORA = 60 * MIN;
const brt = (s: string): number => Date.parse(`${s}:00-03:00`);
const lead = (i: number): string => `5534980${String(i).padStart(6, '0')}`;
const EQUIPE = ['34900000001', '34900000002'];

const diaBrt = (t: number): string => new Date(t - 3 * HORA).toISOString().slice(0, 10);
const horaBrt = (t: number): number => new Date(t - 3 * HORA).getUTCHours();
const semanaBrt = (t: number): number => new Date(t - 3 * HORA).getUTCDay();
const resumo = (nome: string, r: ResultadoSimulacao) =>
  console.log(`[chefe:${nome}] enviados=${r.enviados.length} caixa=${r.caixa.length} pendentes=${r.pendentes.length} expirados=${r.expirados.length} por hora: ${[...porHoraBrt(r.enviados)].map(([h, n]) => `${h.slice(5)}=${n}`).join(' ')}`);

function gaps(xs: Enviado[]): number[] {
  const ts = xs.map(x => x.em).sort((a, b) => a - b);
  return ts.slice(1).map((t, i) => t - ts[i]!);
}

describe('queda 1 — 01/08, 4º toque da Bia (57 toques em 5h, até 5 bolhas)', () => {
  const inicio = brt('2026-08-01T16:35');
  const pedidos: PedidoAgendado[] = Array.from({ length: 57 }, (_, i) => ({
    robo: 'bia_recuperacao', destino: lead(i), bolhas: 5, chave: `limpapro_grupo_sent:${i}`,
    desde: inicio, modo: 'tick', semConversa: true, rotulo: 'bia_grupo',
  }));
  const r = simular(pedidos, { inicio, fim: brt('2026-08-04T21:00') });
  resumo('01/08', r);

  it('1 bolha por toque, no máximo 6 por hora e 30 por 24h, nada no domingo nem fora das 9h–20h', () => {
    expect(r.enviados.every(e => e.bolhas === 1)).toBe(true);
    expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
    expect(picoEmJanela(r.enviados, 24 * HORA)).toBeLessThanOrEqual(30);
    for (const e of r.enviados) {
      expect(semanaBrt(e.em)).not.toBe(0);
      expect(horaBrt(e.em)).toBeGreaterThanOrEqual(9);
      expect(horaBrt(e.em)).toBeLessThan(20);
    }
  });

  it('frio contra frio a 10 min ou mais', () => {
    expect(Math.min(...gaps(r.enviados))).toBeGreaterThanOrEqual(10 * MIN);
  });

  it('nas 5h da queda saem no máximo 21 mensagens (eram 57 toques, ~285 mensagens); o resto sai segunda e terça', () => {
    const naJanela = r.enviados.filter(e => e.em >= inicio && e.em < inicio + 5 * HORA);
    expect(naJanela.length).toBeLessThanOrEqual(21);
    expect(r.enviados.length).toBe(57);
    expect(r.pendentes.length + r.caixa.length + r.expirados.length).toBe(0);
    expect(new Set(r.enviados.map(e => diaBrt(e.em)))).toEqual(new Set(['2026-08-01', '2026-08-03', '2026-08-04']));
  });
});

describe('queda 2 — 04/08, a fila da agenda (8 pessoas, 37 mensagens às 8h) e a desconexão', () => {
  const oito = brt('2026-08-04T08:00');

  it('as 8 confirmações saem em 1 bolha cada, no máximo 6 em 10 min, 25 s ou mais entre elas', () => {
    const pedidos: PedidoAgendado[] = Array.from({ length: 8 }, (_, i) => ({
      robo: 'ep_agenda', destino: lead(i), bolhas: 5, chave: `ep_agenda_sent:${i}:confirmacao`,
      desde: oito, modo: 'tick', semConversa: true, rotulo: 'confirmacao',
    }));
    const r = simular(pedidos, { inicio: oito, fim: oito + HORA });
    resumo('04/08 rajada', r);
    expect(r.enviados.length).toBe(8);
    expect(r.enviados.reduce((s, e) => s + e.bolhas, 0)).toBe(8);   // eram 37
    expect(picoEmJanela(r.enviados, 10 * MIN)).toBeLessThanOrEqual(6);
    expect(Math.min(...gaps(r.enviados))).toBeGreaterThanOrEqual(25_000);
  });

  it('linha caída: o freio para a proativa depois de 2 erros, o evento vai para a caixa, e na volta a rampa segura o frio sem segurar a agenda', () => {
    const nove = brt('2026-08-04T09:00');
    const dez = brt('2026-08-04T10:00');
    const reunioes = Array.from({ length: 8 }, (_, i) => brt('2026-08-04T11:00') + i * 15 * MIN);
    const pedidos: PedidoAgendado[] = [
      ...Array.from({ length: 20 }, (_, i): PedidoAgendado => ({
        robo: 'ep_agenda', destino: lead(100 + i), chave: `ep_agenda_sent:${100 + i}:d`, desde: nove,
        validoAte: brt('2026-08-04T14:00'), modo: 'tick', semConversa: true, rotulo: 'diario',
      })),
      ...reunioes.map((t, i): PedidoAgendado => ({
        robo: 'ep_agenda', destino: lead(200 + i), chave: `ep_agenda_sent:${200 + i}:1h`, prazo: t,
        desde: t - 75 * MIN, validoAte: t - 45 * MIN, modo: 'tick', rotulo: '1h',
      })),
      { robo: 'solardoc_compra', destino: lead(300), desde: brt('2026-08-04T09:05'), modo: 'imediato', rotulo: 'compra' },
      { robo: 'solardoc_compra', destino: lead(301), desde: brt('2026-08-04T09:10'), modo: 'imediato', rotulo: 'compra' },
      ...Array.from({ length: 10 }, (_, i): PedidoAgendado => ({
        robo: 'semente', destino: lead(400 + i), chave: `semente:${i}`, desde: nove, modo: 'tick', semConversa: true, rotulo: 'frio',
      })),
    ];
    const r = simular(pedidos, {
      inicio: nove, fim: brt('2026-08-04T14:00'),
      falhas: [{ de: nove, ate: dez, erro: 'linha' }], reconectadoEm: dez,
    });
    resumo('04/08 queda', r);

    // Freio: em vez de 1 tentativa por tick (30 na hora), 2 erros e o lembrete
    // como sonda a cada 5 min no máximo.
    expect(r.falhas.length).toBeLessThanOrEqual(2 + 60 / 5);
    expect(r.enviados.filter(e => e.em < dez)).toEqual([]);
    // Evento nunca é adiado: com a linha freada, vai para a caixa de saída.
    expect(r.caixa.map(c => [c.pedido.rotulo, c.motivo])).toEqual([['compra', 'freio_de_erro'], ['compra', 'freio_de_erro']]);
    // ...e a caixa entrega quando a linha volta.
    const compras = r.enviados.filter(e => e.pedido.rotulo === 'compra');
    expect(compras.length).toBe(2);
    for (const c of compras) {
      expect(c.viaCaixa).toBe(true);
      expect(c.em).toBeGreaterThanOrEqual(dez);
      expect(c.em).toBeLessThan(dez + 30 * MIN);
    }
    // Volta: a rampa do dia 0 segura o frio (1 no dia, o dia da rampa menos a
    // reserva); a agenda do dia fica fora da rampa [regra do dono, 07/10] e só é
    // espaçada: os 20 diários saem na hora da volta, 1 bolha, no máximo 6 em 10 min.
    expect(r.enviados.filter(e => e.pedido.rotulo === 'frio').length).toBe(1);
    const p3 = r.enviados.filter(e => e.pedido.rotulo === 'diario');
    expect(p3.length).toBe(20);
    expect(p3.every(e => e.bolhas === 1 && e.em >= dez && e.em < dez + HORA)).toBe(true);
    expect(picoEmJanela(p3, 10 * MIN)).toBeLessThanOrEqual(6);
    // ...e todo lembrete de 1h sai dentro da janela dele.
    const lembretes = r.enviados.filter(e => e.pedido.rotulo === '1h');
    expect(lembretes.length).toBe(8);
    for (const e of lembretes) {
      expect(e.classe).toBe('lembrete_p1');
      expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 75 * MIN);
      expect(e.em).toBeLessThanOrEqual(e.pedido.prazo! - 45 * MIN);
    }
    expect(r.expirados).toEqual([]);
  });
});

describe('queda 3 — 30/08, 184 frios pela rota crua (98 saíram a 18/h)', () => {
  const domingo = brt('2026-08-30T09:30');
  const fila = (n: number, desde: (i: number) => number, robo = 'zapi_admin_lote'): PedidoAgendado[] =>
    Array.from({ length: n }, (_, i) => ({
      robo, destino: lead(i), bolhas: 1, chave: `pesquisa:${i}`, desde: desde(i), modo: 'tick', semConversa: true, rotulo: 'pesquisa',
    }));

  it('no domingo não sai nada; de segunda em diante 6/h e 30/24h: "todos em 7 dias", sem perder ninguém', () => {
    const r = simular(fila(184, () => domingo), { inicio: domingo, fim: brt('2026-09-08T21:00') });
    resumo('30/08', r);
    expect(r.enviados.filter(e => semanaBrt(e.em) === 0)).toEqual([]);
    expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
    expect(picoEmJanela(r.enviados, 24 * HORA)).toBeLessThanOrEqual(30);
    expect(r.enviados.length).toBe(184);
    const dias = [...new Set(r.enviados.map(e => diaBrt(e.em)))].sort();
    expect(dias.length).toBe(Math.ceil(184 / 30));
    expect(dias[0]).toBe('2026-08-31');
  });

  it('o mesmo ritmo num dia útil (1 a cada 3,2 min desde 9h30): no máximo 6/h no lugar de 18/h e 30 no dia no lugar de 98', () => {
    const seg = brt('2026-08-31T09:30');
    const r = simular(fila(98, i => seg + Math.round(i * 3.2 * MIN)), { inicio: seg, fim: brt('2026-09-05T21:00') });
    resumo('30/08 dia útil', r);
    expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
    expect(r.enviados.filter(e => e.em < brt('2026-08-31T18:17')).length).toBeLessThanOrEqual(30);
    expect(r.enviados.length).toBe(98);
    expect(new Set(r.enviados.map(e => diaBrt(e.em))).size).toBe(Math.ceil(98 / 30));
  });

  it('DÍVIDA CONHECIDA: com a classe ERRADA (frio pedindo como agenda) o CHEFE puro NÃO segura 30/08', () => {
    // A agenda está fora do volume sustentado desde a regra do dono (07/10): os
    // picos de 3h e 6h, que ele achatava em 40 e 60, agora são 57 e 98. Na hora
    // passa 19 (o ritmo de chegada), acima dos 18/h que bloquearam a linha, e saem
    // todos os 98 até 18h17, como na queda. A defesa contra classe errada é a
    // guarda arquivo → robôs permitidos: o zapiAdmin.ts só pode pedir como
    // zapi_admin_lote, e o pedido como ep_agenda reprova no chefeGuarda. Ela
    // lê o nome literal, 'x' as const, satisfies e const do arquivo; o passaporte
    // por chamada fecha o resto (dívida). Números cravados: se mudarem, alguém
    // mexeu na régua e tem de olhar.
    const seg = brt('2026-08-31T09:30');
    const r = simular(fila(98, i => seg + Math.round(i * 3.2 * MIN), 'ep_agenda'), { inicio: seg, fim: brt('2026-08-31T21:00') });
    resumo('30/08 classe errada', r);
    expect(r.enviados.filter(e => e.em < brt('2026-08-31T18:17')).length).toBe(98);
    expect(picoEmJanela(r.enviados, HORA)).toBe(19);
    expect(picoEmJanela(r.enviados, 3 * HORA)).toBe(57);
    expect(picoEmJanela(r.enviados, 6 * HORA)).toBe(98);
    expect(r.enviados.every(e => e.classe === 'transacional_agenda_p3')).toBe(true);
  });
});

describe('queda 4 — 02/10, o reagenda (39 em 55 min, 3 bolhas, carimbando como agenda)', () => {
  // Desde 07/10 a remarcação do NÃO ATENDEU é AGENDA, por ordem do dono: sai
  // sempre, só espaçada (1 a cada 15 min, a cadência própria), nunca em rajada e
  // nunca cortada. Antes ela era frio e o que não cabia nos 30 do dia ia para o
  // dia seguinte.
  const nove = brt('2026-10-02T09:00');
  const reagenda: PedidoAgendado[] = Array.from({ length: 39 }, (_, i) => ({
    robo: 'ep_reagenda_auto', destino: lead(i), bolhas: 3, chave: `ep_agenda_sent:${600 + i}:reagendado`,
    desde: nove, modo: 'tick', semConversa: true, rotulo: 'reagenda',
  }));
  // A agenda já logava "bom dia segurado pelo teto da linha" [memória
  // linha-io-queda-02-out-reagenda.md]. A memória não diz quantos: o 12 é
  // [proposta] do teste, para o bom dia disputar a hora com o reagenda.
  const bonsDias: PedidoAgendado[] = Array.from({ length: 12 }, (_, i) => ({
    robo: 'ep_agenda', destino: lead(100 + i), chave: `ep_agenda_sent:${100 + i}:manha`,
    prazo: brt('2026-10-02T12:00') + i * 30 * MIN, desde: nove, validoAte: brt('2026-10-02T12:00'),
    modo: 'tick', semConversa: true, rotulo: 'bom_dia',
  }));

  it('a remarcação do NÃO ATENDEU sai toda no mesmo dia, 1 a cada 15 min ou mais, 1 bolha; nos 55 min da queda, no máximo 4 (eram 39 × 3 bolhas); o bom dia passa na frente', () => {
    const r = simular([...reagenda, ...bonsDias], { inicio: nove, fim: brt('2026-10-03T20:00') });
    resumo('02/10', r);
    const rg = r.enviados.filter(e => e.pedido.rotulo === 'reagenda');
    const bd = r.enviados.filter(e => e.pedido.rotulo === 'bom_dia');
    expect(rg.filter(e => e.em < nove + 55 * MIN).length).toBeLessThanOrEqual(4);
    expect(rg.every(e => e.bolhas === 1 && e.classe === 'transacional_agenda_p3')).toBe(true);
    expect(picoEmJanela(rg, HORA)).toBeLessThanOrEqual(4);
    expect(Math.min(...gaps(rg))).toBeGreaterThanOrEqual(15 * MIN);
    // Todos os bons dias saem antes do prazo, e a remarcação espera a fila deles.
    expect(bd.length).toBe(12);
    const ultimoBomDia = Math.max(...bd.map(e => e.em));
    expect(rg.filter(e => e.em < ultimoBomDia).length).toBe(0);
    // Nunca cortada: as 39 saem, todas na sexta, dentro da janela do transacional.
    expect(rg.length).toBe(39);
    expect(r.expirados.length + r.pendentes.length).toBe(0);
    expect(new Set(rg.map(e => diaBrt(e.em)))).toEqual(new Set(['2026-10-02']));
    for (const e of rg) expect(horaBrt(e.em)).toBeLessThan(21);
  });

  it('com a linha caindo às 9h55, para no erro: 2 erros e uma sonda a cada 15 min, não um por tick', () => {
    const r = simular([...reagenda, ...bonsDias], {
      inicio: nove, fim: brt('2026-10-02T11:55'),
      falhas: [{ de: brt('2026-10-02T09:55'), ate: brt('2026-10-03T14:47'), erro: 'linha' }],
    });
    resumo('02/10 queda', r);
    expect(r.falhas.length).toBeLessThanOrEqual(2 + Math.ceil(120 / 15));
  });

  // A causa real do 02/10 foi a classe: o reagenda se dizia agenda. Aqui ele
  // pede como ep_agenda, a classe errada, como fez na queda.
  const comoAgenda = (prazo?: number, desde = nove): PedidoAgendado[] => reagenda.map(p => ({ ...p, robo: 'ep_agenda', prazo, desde }));

  it('DÍVIDA CONHECIDA: com a classe ERRADA (pedindo como ep_agenda) o CHEFE puro deixa 28 em 55 min (eram 24)', () => {
    // A rajada achata os 10 min (de ~21 para 5) e a bolha cai para 1. A hora,
    // que o teto da linha de P3 segurava em 24, sobe para 30: desde a regra do
    // dono (07/10) a agenda está fora do teto da linha, e quem segura é o espaço
    // entre proativas e a rajada por robô. Na queda foram 39 contatos em 55 min.
    // A defesa é a guarda arquivo → robôs: o eletropostoReagendaAuto.ts só pode
    // pedir como ep_reagenda_auto (que tem a cadência de 15 min), e o pedido como
    // ep_agenda reprova no chefeGuarda. Números cravados.
    const r = simular(comoAgenda(), { inicio: nove, fim: brt('2026-10-03T20:00') });
    resumo('02/10 classe errada', r);
    expect(r.enviados.length).toBe(39);
    expect(r.enviados.every(e => e.bolhas === 1 && e.classe === 'transacional_agenda_p3')).toBe(true);
    expect(r.enviados.filter(e => e.em < nove + 55 * MIN).length).toBe(28);
    expect(picoEmJanela(r.enviados, 10 * MIN)).toBe(5);
    expect(picoEmJanela(r.enviados, HORA)).toBe(30);
    expect([...porHoraBrt(r.enviados).values()]).toEqual([30, 9]);
  });

  it('o prazo não é passe livre: 39 pedidos como ep_agenda com prazo=agora+60min não saem em rajada nem de madrugada', () => {
    // Antes: o prazo promovia os 39 a lembrete_p1 e saíam em 6,3 min (pico de
    // 39 em 10 min), e no domingo às 3h também. Agora o lembrete com prazo mora
    // na janela do transacional (7h–21h) e numa rajada própria de 6 em 10 min.
    const sexta = simular(comoAgenda(nove + HORA), { inicio: nove, fim: nove + 40 * HORA });
    resumo('02/10 com prazo', sexta);
    expect(sexta.enviados.length).toBe(39);
    expect(picoEmJanela(sexta.enviados, 10 * MIN)).toBeLessThanOrEqual(6);
    // Quem segura é a rajada por robô (o mesmo ep_agenda, com e sem prazo).
    expect(sexta.motivos.rajada_robo ?? 0).toBeGreaterThan(0);
    // DÍVIDA CONHECIDA: na hora passam 32 (eram 28 com o teto próprio do
    // lembrete, que saiu da agenda pela regra do dono). O prazo é de quem chama;
    // a defesa é a guarda arquivo → robôs e, completa, o passaporte por chamada.
    expect(picoEmJanela(sexta.enviados, HORA)).toBe(32);

    const tresDaManha = brt('2026-10-04T03:00');
    const domingo = simular(comoAgenda(tresDaManha + HORA, tresDaManha), { inicio: tresDaManha, fim: tresDaManha + 40 * HORA });
    resumo('domingo 3h com prazo', domingo);
    expect(domingo.enviados.length).toBe(39);
    for (const e of [...sexta.enviados, ...domingo.enviados]) {
      expect(horaBrt(e.em)).toBeGreaterThanOrEqual(7);
      expect(horaBrt(e.em)).toBeLessThan(21);
    }
    expect(picoEmJanela(domingo.enviados, 10 * MIN)).toBeLessThanOrEqual(6);
  });
});

describe('DÍVIDA CONHECIDA — o prazo declarado por quem chama (sondas A, A2 e A3 da revisão)', () => {
  // O mesmo ep_agenda pedindo com prazo inventado. Na 1ª revisão: A dava 11 em
  // 10 min e 48 na hora; A2 sustentava 35/h por 13 horas e 450 no dia; A3 dava
  // 406. Na 2ª, com o teto próprio do lembrete (28/h e 150/24h) e o volume
  // sustentado, A2 caiu para 164 e A3 para 305. A regra do dono (07/10, agenda
  // nunca bloqueia) tirou a agenda dos dois: o que segura o prazo inventado é só
  // a rajada por robô (6 em 10 min, dura) e a emergência, e A2 e A3 voltam para
  // perto de 35/h o dia inteiro. É a dívida declarada da regra: nenhum volume
  // separa frio mal classificado de agenda, e a defesa é a guarda arquivo →
  // robôs e, completa, o passaporte por chamada.
  // Números cravados: se mudarem, alguém mexeu na régua e tem de olhar.
  const nove = brt('2026-10-02T09:00');
  const seg7 = brt('2026-10-05T07:00');
  const A: PedidoAgendado[] = [
    ...Array.from({ length: 39 }, (_, i): PedidoAgendado => ({ robo: 'ep_agenda', destino: lead(i), bolhas: 3, chave: `a${i}`, prazo: nove + HORA, desde: nove, modo: 'tick', semConversa: true })),
    ...Array.from({ length: 39 }, (_, i): PedidoAgendado => ({ robo: 'ep_agenda', destino: lead(100 + i), bolhas: 3, chave: `b${i}`, desde: nove, modo: 'tick', semConversa: true })),
  ];
  const A2: PedidoAgendado[] = Array.from({ length: 500 }, (_, i): PedidoAgendado => {
    const desde = seg7 + i * 100_000;
    return { robo: 'ep_agenda', destino: lead(1000 + i), chave: `c${i}`, prazo: desde + HORA, desde, modo: 'tick', semConversa: true };
  });
  const A3: PedidoAgendado[] = A2.map((p, i) => (i % 2 ? { ...p, prazo: undefined } : p));
  const rA = simular(A, { inicio: nove, fim: brt('2026-10-03T21:00') });
  const rA2 = simular(A2, { inicio: seg7, fim: brt('2026-10-05T21:00') });
  const rA3 = simular(A3, { inicio: seg7, fim: brt('2026-10-05T21:00') });
  resumo('sonda A', rA);
  resumo('sonda A2', rA2);
  resumo('sonda A3', rA3);
  const lembretes = (r: ResultadoSimulacao) => r.enviados.filter(e => e.classe === 'lembrete_p1');

  it('A: metade com prazo e metade sem, o mesmo robô: 6 em 10 min (eram 11) e 36 na hora (eram 48; 35 na 2ª revisão)', () => {
    expect(rA.enviados.length).toBe(78);
    expect(picoEmJanela(rA.enviados, 10 * MIN)).toBe(6);
    expect(picoEmJanela(rA.enviados, HORA)).toBe(36);
    expect(lembretes(rA).length).toBe(32);
  });

  it('A2: prazo renovado (nascimento + 60 min): 35/h e 466 lembretes no dia (eram 35/h e 450; 28/h e 150 na 2ª revisão)', () => {
    expect(picoEmJanela(lembretes(rA2), HORA)).toBe(35);
    expect(lembretes(rA2).length).toBe(466);
    expect(rA2.enviados.length).toBe(466);
    expect(picoEmJanela(rA2.enviados, 10 * MIN)).toBe(6);
    expect(rA2.motivos.rajada_robo ?? 0).toBeGreaterThan(0);
    expect(rA2.motivos.teto_lembrete_dia ?? 0).toBe(0);
  });

  it('A3: metade sem prazo: 457 no dia (eram 406; 305 na 2ª revisão), pico de 36 na hora', () => {
    expect(rA3.enviados.length).toBe(457);
    expect(lembretes(rA3).length).toBe(233);
    expect(picoEmJanela(rA3.enviados, HORA)).toBe(36);
    expect(picoEmJanela(rA3.enviados, 10 * MIN)).toBe(6);
  });
});

describe('DÍVIDA CONHECIDA — lote pedindo como evento num arquivo de classe máxima evento (passaporte por chamada)', () => {
  // São 8 arquivos que podem pedir como evento (chefeGuarda, "DÍVIDA
  // DECLARADA"): 5 mistos (o dunningService.ts hospeda o dunning_lembrete, frio
  // de receita, ao lado do dunning_d0) e 3 só de evento (authController,
  // paymentsController, trafegoController). Um lote novo ali, pedindo com o nome
  // do robô de evento do arquivo, sai como evento: sem janela, sem orçamento do
  // frio, só com o espaçamento de 10 s e a emergência. Domingo 04/10 às 3h, 150
  // leads. Evento nunca é adiado (vai para a caixa), então o risco é mandar
  // demais, não atrasar. A defesa é o passaporte por chamada provar o evento.
  const tres = brt('2026-10-04T03:00');
  const pedidos: PedidoAgendado[] = Array.from({ length: 150 }, (_, i) => ({
    robo: 'dunning_d0', destino: lead(3000 + i), chave: `dunning:${i}`, desde: tres, modo: 'tick', semConversa: true, rotulo: 'lote_como_evento',
  }));
  const r = simular(pedidos, { inicio: tres, fim: tres + 6 * HORA, equipe: EQUIPE });
  resumo('lote como evento', r);

  it('150 enviados como evento a partir das 3h de domingo: 60 em 10 min, 60 na hora (a emergência é o único freio)', () => {
    expect(r.enviados.length).toBe(150);
    expect(r.enviados.every(e => e.classe === 'evento_p0')).toBe(true);
    expect(picoEmJanela(r.enviados, 10 * MIN)).toBe(60);
    expect(picoEmJanela(r.enviados, HORA)).toBe(60);
    expect([...porHoraBrt(r.enviados).values()]).toEqual([60, 60, 30]);
  });
});

describe('lote do CRM para quem escreveu ontem: conta no orçamento do frio', () => {
  // O manual_crm é o humano digitando no CRM. Antes, reativo atrasado com
  // conversa nas últimas 24h virava P3 e um lote dele saía a 24/h, fora do
  // frio. Agora reativo atrasado é frio, e chamada com mais de um destino é
  // lote, decidida como o zapi_admin_lote.
  const nove = brt('2026-10-05T09:00');
  const entradas = new Map<string, number>();
  const lote = (destinosNaChamada?: number): PedidoAgendado[] => Array.from({ length: 60 }, (_, i) => {
    entradas.set(lead(900 + i), nove - 20 * HORA);
    return { robo: 'manual_crm', destino: lead(900 + i), chave: `crm:${i}`, desde: nove, modo: 'imediato', rotulo: 'crm', destinosNaChamada };
  });

  it('60 pedidos para quem escreveu há 20h: 6/h e 30 em 24h, todos frio, ninguém perdido', () => {
    const r = simular(lote(), { inicio: nove, fim: brt('2026-10-07T21:00'), entradas });
    resumo('CRM ontem', r);
    expect(r.enviados.every(e => e.classe === 'frio_p5' && e.bolhas === 1)).toBe(true);
    expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
    expect(picoEmJanela(r.enviados, 24 * HORA)).toBeLessThanOrEqual(30);
    expect(r.enviados.length).toBe(60);
    expect(new Set(r.enviados.map(e => diaBrt(e.em)))).toEqual(new Set(['2026-10-05', '2026-10-06']));
  });

  it('a mesma chamada de 60 destinos para quem escreveu há 5 min também é frio: lote não é resposta', () => {
    const agora = new Map<string, number>(Array.from({ length: 60 }, (_, i) => [lead(900 + i), nove - 5 * MIN] as [string, number]));
    const r = simular(lote(60), { inicio: nove, fim: brt('2026-10-07T21:00'), entradas: agora });
    expect(r.enviados.every(e => e.classe === 'frio_p5')).toBe(true);
    expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
    expect(picoEmJanela(r.enviados, 24 * HORA)).toBeLessThanOrEqual(30);
  });
});

describe('aviso para lead e grupo de fora: frio, não aviso ao time', () => {
  // [revisão] As sondas do verificador, domingo 04/10 às 3h: 60 pedidos de
  // robô de aviso para lead saíam como aviso_interno_p2 a 24/h, de madrugada
  // e no domingo; 40 pedidos de robô frio para '...-group' saíam a 12/h.
  const tres = brt('2026-10-04T03:00');
  const segunda9h = brt('2026-10-05T09:00');
  const domingoInteiro = (r: ResultadoSimulacao) => r.enviados.filter(e => e.em < segunda9h);

  for (const robo of ['ep_alerta_10min', 'ep_respostas_aviso', 'ep_aviso_ficha', 'ep_card_ping', 'sentinela_vacuo']) {
    // Simulado na coleta (o de evento passa 30h na caixa de saída, re-perguntado a cada tick).
    const pedidos: PedidoAgendado[] = Array.from({ length: 60 }, (_, i) => ({
      robo, destino: lead(i), chave: `${robo}:${i}`, desde: tres, modo: 'tick', semConversa: true, rotulo: 'aviso_lead',
      prazo: robo === 'ep_alerta_10min' ? tres + 10 * MIN : undefined,
    }));
    const r = simular(pedidos, { inicio: tres, fim: brt('2026-10-05T13:00'), equipe: EQUIPE });
    it(`60 ${robo} para lead, domingo às 3h: nada sai no domingo; na segunda, frio a 6/h`, () => {
      expect(domingoInteiro(r)).toEqual([]);
      expect(r.enviados.every(e => e.classe === 'frio_p5')).toBe(true);
      expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
      expect(r.enviados.length).toBeGreaterThan(0);
    });
  }

  for (const robo of ['semente', 'robo_novo_sem_registro', 'zapi_admin_lote']) {
    it(`40 ${robo} para '...-group', domingo às 3h: continua frio, nada sai no domingo`, () => {
      const pedidos: PedidoAgendado[] = Array.from({ length: 40 }, (_, i) => ({
        robo, destino: '120363410228854732-group', chave: `${robo}:g:${i}`, desde: tres, modo: 'tick', semConversa: true, rotulo: 'grupo',
      }));
      const r = simular(pedidos, { inicio: tres, fim: brt('2026-10-05T21:00'), equipe: EQUIPE });
      expect(domingoInteiro(r)).toEqual([]);
      expect(r.enviados.every(e => e.classe === 'frio_p5')).toBe(true);
      expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(6);
    });
  }

  it('o grupo da lista explícita continua aviso ao time', () => {
    const pedidos: PedidoAgendado[] = Array.from({ length: 4 }, (_, i) => ({
      robo: 'semente', destino: '120363424419098566@g.us', chave: `g:${i}`, desde: tres, modo: 'tick', rotulo: 'grupo_time',
    }));
    const r = simular(pedidos, { inicio: tres, fim: tres + HORA, equipe: EQUIPE, gruposInternos: ['120363424419098566-group'] });
    expect(r.enviados.map(e => e.classe)).toEqual(Array(4).fill('aviso_interno_p2'));
  });
});

describe('caixa de saída: o drenador nunca manda o mesmo toque duas vezes', () => {
  it('webhook reentregue (a mesma compra 1 min depois): sai uma vez, a 2ª entra na caixa como chave repetida e recebe baixa', () => {
    const dez = brt('2026-10-05T10:00');
    const compra = (desde: number): PedidoAgendado => ({
      robo: 'solardoc_compra', destino: lead(42), chave: 'compra:42', desde, modo: 'imediato', rotulo: 'compra',
    });
    const r = simular([compra(dez + 20_000), compra(dez + 80_000)], { inicio: dez, fim: dez + HORA });
    expect(r.enviados.length).toBe(1);
    expect(r.caixa.map(c => c.motivo)).toEqual(['chave_repetida']);
    expect(r.deduplicados.length).toBe(1);
    expect(r.pendentes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLE POSITIVO — segunda de agenda cheia (36 reuniões), com resposta, aviso
// e evento no meio. AGENDA NUNCA BLOQUEIA [regra do dono, 07/10/2026]: nenhuma
// mensagem de agenda expira nem fica pendente, e quando falta espaço quem perde a
// vez é o frio. Os formatos:
//   - uma reunião a cada 15 min das 9h às 17h45, com o bom dia levando prazo
//     de 1h antes da reunião (alguns entram como P1 pelo prazo);
//   - a grade real, 2 consultores em :00/:30 das 9h às 17h30, com o bom dia SEM
//     prazo e todo mundo sem conversa;
//   - as duas faixas cheias, 2 reuniões por quarto de hora das 9h às 13h15;
//   - as duas faixas com o bom dia sem prazo e todo mundo sem conversa (era a
//     dívida de 8 bons dias expirados: o total da hora e o volume sustentado
//     seguravam agenda legítima);
//   - as duas faixas com as duas carteiras do solar na mesma linha;
//   - a hora de pico de conversa em cima das duas faixas.
// ─────────────────────────────────────────────────────────────────────────────

interface Reuniao { T: number; consultor: number }

interface ExtraDoDia {
  /**
   * Carteiras do solar (giovanna_agenda), uma ligação por horário. Bom dia das 7h
   * às 11h, nunca a menos de 30 min da ligação; toque de 5 min de T−10 a T+2
   * (solarAgendaGiovanna.ts:128-139).
   */
  solar?: readonly number[];
  /** Pico de conversa: n respostas novas (2 bolhas) espalhadas pela hora que começa em `de`. */
  pico?: { de: string; n: number };
  /** Horários das compras (evento). Padrão: 9h, 12h07 e 16h31. */
  compras?: readonly string[];
}

// Números cravados dos controles (fome do frio e pior espera da resposta no pico).
const FRIO_UMA_A_15 = 15;
const FRIO_GRADE = 29;
const FRIO_FAIXAS = 30;
const FRIO_DENSA = 30;
const FRIO_SOLAR = 29;
const FRIO_PICO = 30;
const PIOR_RESPOSTA_PICO_MIN = 40;
const LIMITE_DOBRO_PICO_HORA = 62;

const tDia = (hhmm: string) => brt(`2026-10-05T${hhmm}`);
const AGENDA = ['bom_dia', '1h', '5min', 'alerta', 'confirmacao', 'cobranca', 'solar_bom_dia', 'solar_5min'];
const IMPORTANTES = [...AGENDA, 'reativo', 'pico', 'evento', 'aviso_ficha'];

/** Uma segunda de agenda: reuniões, resposta, aviso, evento e 40 frios de fundo, das 7h às 21h. */
function diaDeAgenda(reunioes: readonly Reuniao[], opts: { bomDiaComPrazo: boolean; todosSemConversa: boolean }, x: ExtraDoDia = {}): ResultadoSimulacao {
  const t = tDia;
  const pedidos: PedidoAgendado[] = [];
  const entradas = new Map<string, number>();
  const semConversa = (m: number) => opts.todosSemConversa || m % 2 === 0;

  reunioes.forEach(({ T, consultor }, m) => {
    const tel = lead(m);
    pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `bd:${m}`, prazo: opts.bomDiaComPrazo ? T - HORA : undefined, desde: t('07:00'),
      validoAte: Math.min(t('12:00'), T - HORA), modo: 'tick', semConversa: semConversa(m), rotulo: 'bom_dia' });
    pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `1h:${m}`, prazo: T, desde: T - 75 * MIN,
      validoAte: T - 45 * MIN, modo: 'tick', semConversa: opts.todosSemConversa, rotulo: '1h' });
    pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `5m:${m}`, prazo: T, desde: T - 12 * MIN,
      validoAte: T + 3 * MIN, modo: 'tick', semConversa: opts.todosSemConversa, rotulo: '5min' });
    pedidos.push({ robo: 'ep_alerta_10min', destino: EQUIPE[consultor]!, chave: `al:${m}`, prazo: T, desde: T - 10 * MIN,
      validoAte: T, modo: 'tick', rotulo: 'alerta' });
    if (m % 3 === 0) {
      pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `cf:${m}`, prazo: T, desde: t('07:00'),
        validoAte: T, modo: 'tick', semConversa: true, rotulo: 'confirmacao' });
    } else if (m % 3 === 1) {
      pedidos.push({ robo: 'ep_cobra_sim', destino: tel, chave: `cs:${m}`, prazo: T, desde: Math.max(t('08:00'), T - 3 * HORA),
        validoAte: T - HORA, modo: 'tick', semConversa: true, rotulo: 'cobranca' });
    }
  });
  (x.solar ?? []).forEach((T, g) => {
    const tel = lead(900 + g);
    pedidos.push({ robo: 'giovanna_agenda', destino: tel, chave: `sbd:${g}`, desde: t('07:00'),
      validoAte: Math.min(t('11:00'), T - 30 * MIN), modo: 'tick', semConversa: true, rotulo: 'solar_bom_dia' });
    pedidos.push({ robo: 'giovanna_agenda', destino: tel, chave: `s5:${g}`, prazo: T, desde: T - 10 * MIN,
      validoAte: T + 2 * MIN, modo: 'tick', semConversa: true, rotulo: 'solar_5min' });
  });
  // 60 respostas a quem escreveu, 2 bolhas cada, das 8h às 19h.
  for (let i = 0; i < 60; i++) {
    const quando = t('08:00') + i * 11 * MIN + 37_000;
    const tel = lead(500 + i);
    entradas.set(tel, quando - 30_000);
    pedidos.push({ robo: i % 2 ? 'giovanna_reativa' : 'duda_recepcao', destino: tel, bolhas: 2, desde: quando, modo: 'imediato', rotulo: 'reativo' });
  }
  if (x.pico) {
    for (let i = 0; i < x.pico.n; i++) {
      const quando = t(x.pico.de) + i * Math.floor(HORA / x.pico.n) + 11_000;
      const tel = lead(600 + i);
      entradas.set(tel, quando - 20_000);
      pedidos.push({ robo: 'duda_recepcao', destino: tel, bolhas: 2, desde: quando, modo: 'imediato', rotulo: 'pico' });
    }
  }
  // Compras (uma no pico das 9h) e 10 fichas novas para a equipe.
  for (const [i, hhmm] of (x.compras ?? ['09:00', '12:07', '16:31']).entries()) {
    pedidos.push({ robo: 'solardoc_compra', destino: lead(700 + i), chave: `compra:${i}`, desde: t(hhmm) + 20_000, modo: 'imediato', rotulo: 'evento' });
  }
  for (let i = 0; i < 10; i++) {
    pedidos.push({ robo: 'ep_aviso_ficha', destino: EQUIPE[i % 2]!, desde: t('08:15') + i * 53 * MIN, modo: 'imediato', rotulo: 'aviso_ficha' });
  }
  // Frio de fundo: 40 toques da Bia esperando desde as 9h.
  for (let i = 0; i < 40; i++) {
    pedidos.push({ robo: 'bia_recuperacao', destino: lead(800 + i), chave: `bia:${i}`, desde: t('09:00'), modo: 'tick', semConversa: true, rotulo: 'frio' });
  }

  return simular(pedidos, { inicio: t('07:00'), fim: t('21:00'), equipe: EQUIPE, entradas });
}

/** Itens de agenda (ou importantes) que expiraram ou ficaram pendentes, com o último motivo. */
const foraDe = (r: ResultadoSimulacao, rotulos: readonly string[]) =>
  [...r.expirados, ...r.pendentes].filter(x => rotulos.includes(x.pedido.rotulo!)).map(x => `${x.pedido.rotulo}:${x.ultimoMotivo}`);

function controle(titulo: string, reunioes: readonly Reuniao[], opts: {
  bomDiaComPrazo: boolean; todosSemConversa: boolean; frioCravado: number; extra?: ExtraDoDia;
  /** Linha no teto físico pela agenda (o solar junto): a resposta pode esperar a vaga, até 10 min. */
  linhaCheia?: boolean;
}) {
  describe(`CONTROLE POSITIVO — ${titulo}`, () => {
    const r = diaDeAgenda(reunioes, opts, opts.extra);
    resumo(`agenda cheia, ${titulo}`, r);
    const de = (rotulo: string) => r.enviados.filter(e => e.pedido.rotulo === rotulo);
    const solar = opts.extra?.solar?.length ?? 0;

    it('AGENDA NUNCA BLOQUEIA: nenhuma mensagem de agenda expira nem fica pendente; nada importante fica de fora; o que passou pela caixa chega em até 10 min', () => {
      expect(foraDe(r, AGENDA)).toEqual([]);
      expect(foraDe(r, IMPORTANTES)).toEqual([]);
      expect(r.caixa.filter(c => c.pedido.rotulo === 'evento')).toEqual([]);
      for (const e of r.enviados.filter(x => x.viaCaixa)) expect(e.em - e.pedido.desde).toBeLessThanOrEqual(10 * MIN);
      for (const [rotulo, n] of [['bom_dia', 36], ['1h', 36], ['5min', 36], ['alerta', 36], ['confirmacao', 12], ['cobranca', 12],
        ['solar_bom_dia', solar], ['solar_5min', solar], ['reativo', 60], ['evento', 3], ['aviso_ficha', 10]] as const) {
        expect({ rotulo, n: de(rotulo).length }).toEqual({ rotulo, n });
      }
    });

    it(opts.linhaCheia
      ? 'com a linha no teto físico pela agenda, a resposta espera a vaga (até 10 min) e continua resposta; o evento sai em até 1 min'
      : 'evento e resposta saem em até 10 s, na primeira pergunta', () => {
      for (const e of [...de('evento'), ...de('reativo')]) {
        if (!opts.linhaCheia) expect(e.tentativas).toBe(1);
        const teto = opts.linhaCheia ? (e.pedido.rotulo === 'evento' ? MIN : 10 * MIN) : 10_000;
        expect({ rotulo: e.pedido.rotulo, ok: e.em - e.pedido.desde <= teto }).toEqual({ rotulo: e.pedido.rotulo, ok: true });
      }
      expect(de('reativo').every(e => e.bolhas === 2 && e.classe === 'reativo_p1')).toBe(true);
    });

    it('todo lembrete sai dentro da janela dele, e o alerta antes da reunião; nenhum freio de volume segura agenda', () => {
      for (const e of de('1h')) {
        expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 75 * MIN);
        expect(e.em).toBeLessThanOrEqual(e.pedido.prazo! - 45 * MIN);
      }
      for (const e of [...de('5min'), ...de('solar_5min')]) {
        expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 12 * MIN);
        expect(e.em).toBeLessThanOrEqual(e.pedido.validoAte!);
      }
      for (const e of de('alerta')) expect(e.em).toBeLessThan(e.pedido.prazo!);
      // O teto próprio do lembrete (28/h e 150/24h) saiu da agenda legítima.
      expect(r.motivos.teto_lembrete_hora ?? 0).toBe(0);
      expect(r.motivos.teto_lembrete_dia ?? 0).toBe(0);
    });

    it('todo bom dia sai entre 7h e o fim da janela útil; confirmação e cobrança antes do prazo', () => {
      for (const e of [...de('bom_dia'), ...de('solar_bom_dia')]) {
        expect(horaBrt(e.em)).toBeGreaterThanOrEqual(7);
        expect(e.em).toBeLessThanOrEqual(e.pedido.validoAte!);
      }
      for (const e of de('confirmacao')) expect(e.em).toBeLessThan(e.pedido.prazo!);
      for (const e of de('cobranca')) expect(e.em).toBeLessThanOrEqual(e.pedido.validoAte!);
    });

    it('mesmo assim, a régua segura o resto: frio até 6/h e 30/24h só das 9h às 20h, total até 60/h, 1 bolha no proativo, nenhum robô acima de 6 em 10 min', () => {
      const proativos = r.enviados.filter(e => ['aviso_interno_p2', 'transacional_agenda_p3', 'frio_receita_p4', 'frio_p5'].includes(e.classe));
      expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(60);
      expect(picoEmJanela(de('frio'), HORA)).toBeLessThanOrEqual(6);
      expect(picoEmJanela(de('frio'), 24 * HORA)).toBeLessThanOrEqual(30);
      for (const e of de('frio')) { expect(horaBrt(e.em)).toBeGreaterThanOrEqual(9); expect(horaBrt(e.em)).toBeLessThan(20); }
      expect(proativos.every(e => e.bolhas === 1)).toBe(true);
      // Rajada por robô (dura, agenda inclusive): o mesmo robô, lembrete e proativa, até 6 em 10 min.
      for (const robo of ['ep_agenda', 'ep_cobra_sim', 'giovanna_agenda', 'ep_alerta_10min']) {
        const doRobo = r.enviados.filter(e => e.pedido.robo === robo && e.classe !== 'reativo_p1' && e.classe !== 'evento_p0');
        expect({ robo, pico: picoEmJanela(doRobo, 10 * MIN) <= 6 }).toEqual({ robo, pico: true });
      }
    });

    it(`frio entregue: ${opts.frioCravado} de 30 (40 esperando); quando falta espaço, o frio é quem cede`, () => {
      // Número cravado, para a fome do frio não mudar sem ninguém ver. O frio
      // espera 10 a 15 min do último envio CARIMBADO, agenda inclusive (regra do
      // HEAD, lineThrottle.ts:337), e não pega a vaga da linha que a agenda usa.
      expect(de('frio').length).toBe(opts.frioCravado);
    });
  });
}

const umaA15 = Array.from({ length: 36 }, (_, i) => ({ T: tDia('09:00') + i * 15 * MIN, consultor: i % 2 }));
const grade = Array.from({ length: 36 }, (_, i) => ({ T: tDia('09:00') + Math.floor(i / 2) * 30 * MIN, consultor: i % 2 }));
const duasFaixas = Array.from({ length: 36 }, (_, i) => ({ T: tDia('09:00') + Math.floor(i / 2) * 15 * MIN, consultor: i % 2 }));
/**
 * As duas carteiras do solar (Giovanna e Nilce) como o solarAgendaGiovanna.ts:60
 * as descreve: "as duas carteiras somam 30 a 32 ligações por dia". Aqui 32, uma
 * por dona a cada 30 min, das 9h às 16h30.
 */
const carteirasSolar = Array.from({ length: 32 }, (_, i) => tDia('09:00') + Math.floor(i / 2) * 30 * MIN);
/** O DOBRO do real: 62 ligações, uma por dona a cada 15 min (o LIMITE MEDIDO abaixo). */
const carteirasSolarDobro = Array.from({ length: 62 }, (_, i) => tDia('09:00') + Math.floor(i / 2) * 15 * MIN);

// FOME CONHECIDA: com uma reunião a cada 15 min o frio entrega metade do dia. Não
// é limite da linha, é o espaçamento do frio contra o lembrete (regra do HEAD).
controle('uma reunião a cada 15 min', umaA15, { bomDiaComPrazo: true, todosSemConversa: false, frioCravado: FRIO_UMA_A_15 });
controle('grade real, 2 consultores em :00/:30, bom dia sem prazo', grade, { bomDiaComPrazo: false, todosSemConversa: true, frioCravado: FRIO_GRADE });
controle('duas faixas cheias, 2 reuniões por quarto de hora', duasFaixas, { bomDiaComPrazo: true, todosSemConversa: false, frioCravado: FRIO_FAIXAS });
// Era DÍVIDA CONHECIDA na rodada anterior: 8 bons dias expiravam (7 pelo total da
// hora de 40, 1 pelo volume sustentado). A regra do dono tirou a agenda dos dois.
controle('duas faixas, bom dia sem prazo, todo mundo sem conversa (eram 8 bons dias expirados)', duasFaixas,
  { bomDiaComPrazo: false, todosSemConversa: true, frioCravado: FRIO_DENSA });
// A agenda do eletroposto e as carteiras do solar na MESMA linha: bom dia das 7h
// às 11h, toque de 5 min. Na rodada anterior, o teto próprio do lembrete (28/h),
// o total da hora e o teto da linha seguravam de 20 a 34 itens de agenda aqui.
controle('duas faixas + as duas carteiras do solar (32 ligações, bom dia 7h–11h, toque de 5 min)', duasFaixas,
  { bomDiaComPrazo: true, todosSemConversa: false, frioCravado: FRIO_SOLAR, extra: { solar: carteirasSolar }, linhaCheia: true });

describe('LIMITE MEDIDO — duas faixas + o DOBRO das carteiras do solar (62 ligações) na mesma linha', () => {
  // Com 62 ligações do solar em cima das duas faixas do eletroposto, a agenda
  // sozinha põe a linha em 58 a 62 mensagens por hora das 8h ao meio-dia: é o
  // teto físico (emergência, 60/h). O frio já cedeu tudo. O que ainda segura é a
  // rajada por robô (6 em 10 min, DURA, a defesa contra robô frio pedindo como
  // agenda), e ela corta 5 itens que vencem entre 11h e 12h (3 do ep_agenda e 2
  // bons dias do solar). Medido nesta rodada, com outras saídas: reservar vagas
  // do robô para o lembrete dele perde 16 bons dias do solar; tirar o lembrete
  // da agenda da rajada global perde 10. No volume real (32 ligações, controle
  // acima) nada se perde. Cravado para o dono decidir: afrouxar a rajada por robô
  // no último momento útil abre o prazo inventado.
  const r = diaDeAgenda(duasFaixas, { bomDiaComPrazo: true, todosSemConversa: false }, { solar: carteirasSolarDobro });
  resumo('dobro do solar', r);

  it('5 itens de agenda vencem entre 11h e 12h pela rajada por robô; o alerta, o toque de 5 min, a confirmação e a cobrança saem inteiros, e a linha fica no teto físico', () => {
    expect(foraDe(r, AGENDA).sort()).toEqual(['1h:rajada_robo', '1h:rajada_robo', 'bom_dia:rajada_robo', 'solar_bom_dia:null', 'solar_bom_dia:rajada_robo']);
    expect(foraDe(r, ['solar_5min', 'alerta', '5min', 'confirmacao', 'cobranca'])).toEqual([]);
    expect(picoEmJanela(r.enviados, HORA)).toBe(LIMITE_DOBRO_PICO_HORA);
  });
});

describe('CONTROLE POSITIVO — hora de pico de conversa em cima da agenda cheia: nenhum alerta ao consultor expira; o frio perde a vez', () => {
  // As duas faixas cheias, 20 conversas novas às 10h (2 bolhas cada) e 8 compras,
  // uma a cada meia hora das 9h às 12h37. Na rodada anterior 4 alertas ao
  // consultor expiravam pelo teto de emergência, e a resposta segurada passava de
  // 15 min, virava frio e saía até 5 horas depois. Medido junto: com a reserva da
  // emergência valendo para a resposta, ela esperava até 379 min (regulamento).
  const compras = ['09:00', '09:31', '10:02', '10:33', '11:04', '11:35', '12:06', '12:37'];
  const base = diaDeAgenda(duasFaixas, { bomDiaComPrazo: true, todosSemConversa: false }, { compras });
  const r = diaDeAgenda(duasFaixas, { bomDiaComPrazo: true, todosSemConversa: false }, { compras, pico: { de: '10:00', n: 20 } });
  resumo('pico de conversa', r);
  const de = (res: ResultadoSimulacao, rotulo: string) => res.enviados.filter(e => e.pedido.rotulo === rotulo);

  it('nenhum alerta ao consultor, lembrete ou bom dia expira; toda a agenda sai na janela', () => {
    expect(foraDe(r, AGENDA)).toEqual([]);
    expect(de(r, 'alerta').length).toBe(36);
    for (const e of de(r, 'alerta')) expect(e.em).toBeLessThan(e.pedido.prazo!);
    for (const e of de(r, '5min')) expect(e.em).toBeLessThanOrEqual(e.pedido.validoAte!);
  });

  it('a resposta continua resposta (nenhuma vira frio) e sai na mesma manhã; o evento chega pela caixa em até 10 min', () => {
    const respostas = [...de(r, 'reativo'), ...de(r, 'pico')];
    expect(respostas.length).toBe(80);
    expect(respostas.every(e => e.classe === 'reativo_p1')).toBe(true);
    expect(Math.max(...respostas.map(e => e.em - e.pedido.desde))).toBeLessThanOrEqual(PIOR_RESPOSTA_PICO_MIN * MIN);
    expect(de(r, 'evento').length).toBe(8);
    for (const e of de(r, 'evento')) expect(e.em - e.pedido.desde).toBeLessThanOrEqual(10 * MIN);
  });

  it('o frio é quem perde a vez (não o toque): nada de frio enquanto a agenda e o pico correm; sai mais tarde que no dia sem o pico, e sai inteiro', () => {
    const t = tDia;
    const primeiro = (res: ResultadoSimulacao) => Math.min(...de(res, 'frio').map(e => e.em));
    expect(de(r, 'frio').filter(e => e.em < t('12:00'))).toEqual([]);
    expect(primeiro(r)).toBeGreaterThan(primeiro(base));
    expect(de(r, 'frio').length).toBe(FRIO_PICO);
    expect(de(base, 'frio').length).toBe(FRIO_PICO);
    expect(picoEmJanela(de(r, 'frio'), HORA)).toBeLessThanOrEqual(6);
    for (const e of de(r, 'frio')) { expect(horaBrt(e.em)).toBeGreaterThanOrEqual(9); expect(horaBrt(e.em)).toBeLessThan(20); }
  });
});
