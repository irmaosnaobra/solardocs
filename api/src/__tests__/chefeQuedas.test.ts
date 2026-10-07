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
// Os replays recebem o robô com a classe CERTA de CLASSE_POR_ROBO. Os casos de
// classe ERRADA (o frio pedindo como agenda, em 30/08 e em 02/10, e o lote
// pedindo como evento num arquivo misto) estão cravados como DÍVIDA CONHECIDA:
// o CHEFE puro não segura classe errada na escala da hora, e nenhum volume
// separa o frio mal classificado de uma agenda cheia. A guarda arquivo → robôs
// permitidos (chefeGuarda, regra robo) já reprova o pedido com o nome de um
// robô de OUTRO arquivo; dentro dos 9 arquivos mistos ela não separa a classe,
// e a defesa completa é o passaporte por chamada (dívida). Telefones fictícios.
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

  it('linha caída: o freio para a proativa depois de 2 erros, o evento vai para a caixa, e na volta a rampa segura o P3 sem segurar o lembrete', () => {
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
    // Volta: rampa dia 0 segura o transacional do dia em 10/h...
    const p3 = r.enviados.filter(e => e.classe === 'transacional_agenda_p3');
    expect(picoEmJanela(p3, HORA)).toBeLessThanOrEqual(10);
    expect(r.enviados.filter(e => e.pedido.rotulo === 'diario').length).toBe(20);
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
    // O volume sustentado (40 em 3h, 60 em 6h) só achata os picos de 3h e 6h.
    // Na hora passa 19, acima dos 18/h que bloquearam a linha, e saem todos os
    // 98 até 18h17, como na queda. A defesa contra classe errada é a guarda
    // arquivo → robôs permitidos: o zapiAdmin.ts só pode pedir como
    // zapi_admin_lote, e o pedido como ep_agenda reprova no chefeGuarda. Ela
    // só vê nome literal; o passaporte por chamada fecha o resto (dívida).
    // Números cravados: se mudarem, alguém mexeu na régua e tem de olhar.
    const seg = brt('2026-08-31T09:30');
    const r = simular(fila(98, i => seg + Math.round(i * 3.2 * MIN), 'ep_agenda'), { inicio: seg, fim: brt('2026-08-31T21:00') });
    resumo('30/08 classe errada', r);
    expect(r.enviados.filter(e => e.em < brt('2026-08-31T18:17')).length).toBe(98);
    expect(picoEmJanela(r.enviados, HORA)).toBe(19);
    expect(picoEmJanela(r.enviados, 3 * HORA)).toBe(40);
    expect(picoEmJanela(r.enviados, 6 * HORA)).toBe(60);
    expect(r.enviados.every(e => e.classe === 'transacional_agenda_p3')).toBe(true);
  });
});

describe('queda 4 — 02/10, o reagenda (39 frios em 55 min, 3 bolhas, carimbando como agenda)', () => {
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

  it('nos 55 min da queda saem no máximo 6 reagendas (eram 39 × 3 bolhas), e o bom dia passa na frente', () => {
    const r = simular([...reagenda, ...bonsDias], { inicio: nove, fim: brt('2026-10-03T20:00') });
    resumo('02/10', r);
    const rg = r.enviados.filter(e => e.pedido.rotulo === 'reagenda');
    const bd = r.enviados.filter(e => e.pedido.rotulo === 'bom_dia');
    expect(rg.filter(e => e.em < nove + 55 * MIN).length).toBeLessThanOrEqual(6);
    expect(rg.every(e => e.bolhas === 1 && e.classe === 'frio_p5')).toBe(true);
    expect(picoEmJanela(rg, HORA)).toBeLessThanOrEqual(6);
    expect(picoEmJanela(rg, 24 * HORA)).toBeLessThanOrEqual(30);
    expect(Math.min(...gaps(rg))).toBeGreaterThanOrEqual(10 * MIN);
    // Todos os bons dias saem antes do prazo, e o frio espera a fila deles.
    expect(bd.length).toBe(12);
    const ultimoBomDia = Math.max(...bd.map(e => e.em));
    expect(rg.filter(e => e.em < ultimoBomDia).length).toBeLessThanOrEqual(1);
    // Ninguém se perde: o que não coube na sexta sai no sábado.
    expect(rg.length).toBe(39);
    expect(new Set(rg.map(e => diaBrt(e.em)))).toEqual(new Set(['2026-10-02', '2026-10-03']));
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

  it('DÍVIDA CONHECIDA: com a classe ERRADA (pedindo como ep_agenda) o CHEFE puro deixa 24 frios em 55 min', () => {
    // A rajada achata os 10 min (de ~21 para 5), a bolha cai para 1, mas a hora
    // fica em 24 de frio para quem não escreveu: o teto da linha de P3. Na queda
    // foram 39 contatos em 55 min. A defesa é a guarda arquivo → robôs: o
    // eletropostoReagendaAuto.ts só pode pedir como ep_reagenda_auto, e o pedido
    // como ep_agenda reprova no chefeGuarda. Números cravados.
    const r = simular(comoAgenda(), { inicio: nove, fim: brt('2026-10-03T20:00') });
    resumo('02/10 classe errada', r);
    expect(r.enviados.length).toBe(39);
    expect(r.enviados.every(e => e.bolhas === 1 && e.classe === 'transacional_agenda_p3')).toBe(true);
    expect(r.enviados.filter(e => e.em < nove + 55 * MIN).length).toBe(24);
    expect(picoEmJanela(r.enviados, 10 * MIN)).toBe(5);
    expect(picoEmJanela(r.enviados, HORA)).toBe(24);
    expect([...porHoraBrt(r.enviados).values()]).toEqual([24, 15]);
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
    // DÍVIDA CONHECIDA: na hora ainda passam 28, o teto próprio do lembrete (era
    // 30 antes dele). O prazo é de quem chama; a defesa é a guarda arquivo →
    // robôs e, completa, o passaporte por chamada.
    expect(picoEmJanela(sexta.enviados, HORA)).toBe(28);

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
  // O mesmo ep_agenda pedindo com prazo inventado. Antes desta rodada: A dava
  // 11 em 10 min e 48 na hora; A2 sustentava 35/h por 13 horas e 450 no dia,
  // até o teto de emergência; A3 dava 406 no dia. Agora a rajada por robô (6 em
  // 10 min somando com e sem prazo) e o teto próprio do lembrete (28/h e
  // 150/24h) seguram o que dá para segurar sem cortar a agenda cheia legítima.
  // O que sobra é P3 sem prazo para quem não conversa, que só o volume
  // sustentado segura (nenhum volume separa frio mal classificado de agenda).
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

  it('A: metade com prazo e metade sem, o mesmo robô: 6 em 10 min (eram 11) e 35 na hora (eram 48)', () => {
    expect(rA.enviados.length).toBe(78);
    expect(picoEmJanela(rA.enviados, 10 * MIN)).toBe(6);
    expect(picoEmJanela(rA.enviados, HORA)).toBe(35);
    expect(lembretes(rA).length).toBe(30);
  });

  it('A2: prazo renovado (nascimento + 60 min): 28/h e 150 lembretes no dia (eram 35/h e 450)', () => {
    expect(picoEmJanela(lembretes(rA2), HORA)).toBe(28);
    expect(lembretes(rA2).length).toBe(150);
    expect(rA2.enviados.length).toBe(164);
    expect(picoEmJanela(rA2.enviados, 10 * MIN)).toBe(6);
    expect(picoEmJanela(rA2.enviados, HORA)).toBe(36);
    expect(rA2.motivos.teto_lembrete_dia ?? 0).toBeGreaterThan(0);
  });

  it('A3: metade sem prazo: 305 no dia (eram 406), pico de 36 na hora; o resto é P3 que só o volume sustentado segura', () => {
    expect(rA3.enviados.length).toBe(305);
    expect(lembretes(rA3).length).toBe(150);
    expect(picoEmJanela(rA3.enviados, HORA)).toBe(36);
    expect(picoEmJanela(rA3.enviados, 10 * MIN)).toBe(6);
  });
});

describe('DÍVIDA CONHECIDA — lote pedindo como evento num arquivo misto (passaporte por chamada)', () => {
  // O dunningService.ts hospeda o dunning_lembrete (frio de receita) e o
  // dunning_d0 (evento). A guarda arquivo → robôs deixa o arquivo pedir os dois
  // (chefeGuarda, "DÍVIDA DECLARADA"), então um lote do lembrete pedindo como
  // dunning_d0 sai como evento: sem janela, sem orçamento do frio, só com o
  // espaçamento de 10 s e a emergência. Domingo 04/10 às 3h, 150 leads.
  // Evento nunca é adiado (vai para a caixa), então o risco é mandar demais,
  // não atrasar. A defesa é o passaporte por chamada provar o evento.
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
// e evento no meio. Três formatos de agenda:
//   - uma reunião a cada 15 min das 9h às 17h45, com o bom dia levando prazo
//     de 1h antes da reunião (alguns entram como P1 pelo prazo);
//   - a grade real, 2 consultores em :00/:30 das 9h às 17h30, com o bom dia SEM
//     prazo e todo mundo sem conversa (o P1 não entra pela porta do prazo e o
//     volume sustentado pega todo P3) [revisão];
//   - as duas faixas cheias, 2 reuniões por quarto de hora das 9h às 13h15.
// ─────────────────────────────────────────────────────────────────────────────

interface Reuniao { T: number; consultor: number }

const tDia = (hhmm: string) => brt(`2026-10-05T${hhmm}`);

/** Uma segunda de agenda: reuniões, resposta, aviso, evento e 40 frios de fundo, das 7h às 21h. */
function diaDeAgenda(reunioes: readonly Reuniao[], opts: { bomDiaComPrazo: boolean; todosSemConversa: boolean }): ResultadoSimulacao {
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
  // 60 respostas a quem escreveu, 2 bolhas cada, das 8h às 19h.
  for (let i = 0; i < 60; i++) {
    const quando = t('08:00') + i * 11 * MIN + 37_000;
    const tel = lead(500 + i);
    entradas.set(tel, quando - 30_000);
    pedidos.push({ robo: i % 2 ? 'giovanna_reativa' : 'duda_recepcao', destino: tel, bolhas: 2, desde: quando, modo: 'imediato', rotulo: 'reativo' });
  }
  // 3 compras (uma no pico das 9h) e 10 fichas novas para a equipe.
  for (const [i, hhmm] of ['09:00', '12:07', '16:31'].entries()) {
    pedidos.push({ robo: 'solardoc_compra', destino: lead(700 + i), desde: t(hhmm) + 20_000, modo: 'imediato', rotulo: 'evento' });
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

function controle(titulo: string, reunioes: readonly Reuniao[], opts: {
  bomDiaComPrazo: boolean; todosSemConversa: boolean; frioCravado: number; rajadaLembreteCravada: number;
}) {
  describe(`CONTROLE POSITIVO — ${titulo}`, () => {
    const t = tDia;
    const r = diaDeAgenda(reunioes, opts);
    resumo(`agenda cheia, ${titulo}`, r);
    const de = (rotulo: string) => r.enviados.filter(e => e.pedido.rotulo === rotulo);
    const IMPORTANTES = ['bom_dia', '1h', '5min', 'alerta', 'confirmacao', 'cobranca', 'reativo', 'evento', 'aviso_ficha'];

    it('nada importante fica de fora: nenhum expirado nem pendente; o que passou pela caixa chega em até 10 min', () => {
      const fora = [...r.expirados, ...r.pendentes].map(x => x.pedido.rotulo).filter(x => IMPORTANTES.includes(x!));
      expect(fora).toEqual([]);
      expect(r.caixa.filter(c => c.pedido.rotulo === 'evento')).toEqual([]);
      for (const e of r.enviados.filter(x => x.viaCaixa)) expect(e.em - e.pedido.desde).toBeLessThanOrEqual(10 * MIN);
      for (const [rotulo, n] of [['bom_dia', 36], ['1h', 36], ['5min', 36], ['alerta', 36], ['confirmacao', 12], ['cobranca', 12], ['reativo', 60], ['evento', 3], ['aviso_ficha', 10]] as const) {
        expect({ rotulo, n: de(rotulo).length }).toEqual({ rotulo, n });
      }
    });

    it('evento e resposta saem em até 10 s, na primeira pergunta', () => {
      for (const e of [...de('evento'), ...de('reativo')]) {
        expect(e.tentativas).toBe(1);
        expect(e.em - e.pedido.desde).toBeLessThanOrEqual(10_000);
      }
      expect(de('reativo').every(e => e.bolhas === 2)).toBe(true);
    });

    it('todo lembrete sai dentro da janela dele, e o alerta antes da reunião; o lembrete legítimo fica abaixo do teto próprio', () => {
      for (const e of de('1h')) {
        expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 75 * MIN);
        expect(e.em).toBeLessThanOrEqual(e.pedido.prazo! - 45 * MIN);
      }
      for (const e of de('5min')) {
        expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 12 * MIN);
        expect(e.em).toBeLessThanOrEqual(e.pedido.prazo! + 3 * MIN);
      }
      for (const e of de('alerta')) expect(e.em).toBeLessThan(e.pedido.prazo!);
      // A rajada própria do lembrete (6 em 10 min) e o teto próprio (28/h e
      // 150/24h) existem para o prazo declarado por quem chama. Na agenda de
      // verdade não seguram nenhum lembrete de vez: no máximo adiam alguns
      // minutos dentro da janela (número cravado por controle).
      const lembretes = r.enviados.filter(e => e.classe === 'lembrete_p1');
      expect(picoEmJanela(lembretes, HORA)).toBeLessThanOrEqual(28);
      expect(lembretes.length).toBeLessThanOrEqual(150);
      expect(r.motivos.rajada_lembrete ?? 0).toBe(opts.rajadaLembreteCravada);
      expect(r.motivos.teto_lembrete_hora ?? 0).toBe(0);
    });

    it('todo bom dia sai entre 7h e 12h e pelo menos 60 min antes da reunião; confirmação e cobrança antes do prazo', () => {
      for (const e of de('bom_dia')) {
        expect(horaBrt(e.em)).toBeGreaterThanOrEqual(7);
        expect(e.em).toBeLessThanOrEqual(e.pedido.validoAte!);
      }
      for (const e of de('confirmacao')) expect(e.em).toBeLessThan(e.pedido.prazo!);
      for (const e of de('cobranca')) expect(e.em).toBeLessThanOrEqual(e.pedido.validoAte!);
    });

    it('mesmo assim, a régua segura: P2–P5 até 24/h, total até 60/h, frio até 6/h, 1 bolha no proativo', () => {
      const proativos = r.enviados.filter(e => ['aviso_interno_p2', 'transacional_agenda_p3', 'frio_receita_p4', 'frio_p5'].includes(e.classe));
      expect(picoEmJanela(proativos, HORA)).toBeLessThanOrEqual(24);
      expect(picoEmJanela(proativos, 10 * MIN)).toBeLessThanOrEqual(6);
      expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(60);
      expect(picoEmJanela(de('frio'), HORA)).toBeLessThanOrEqual(6);
      expect(proativos.every(e => e.bolhas === 1)).toBe(true);
    });

    it(`frio entregue: ${opts.frioCravado} de 30 (40 esperando)`, () => {
      // Número cravado, para a fome do frio não mudar sem ninguém ver. O frio
      // espera 10 a 15 min do último envio CARIMBADO, agenda inclusive (regra do
      // HEAD, lineThrottle.ts:337), então a agenda densa come o frio.
      expect(de('frio').length).toBe(opts.frioCravado);
    });
  });
}

{
  const t = tDia;
  // FOME CONHECIDA: com uma reunião a cada 15 min o frio entrega 15 de 30. Não
  // é limite da linha, é o espaçamento do frio contra o lembrete (regra do
  // HEAD). Medir na sombra contra a agenda real antes de afrouxar.
  controle('uma reunião a cada 15 min', Array.from({ length: 36 }, (_, i) => ({ T: t('09:00') + i * 15 * MIN, consultor: i % 2 })),
    { bomDiaComPrazo: true, todosSemConversa: false, frioCravado: 15, rajadaLembreteCravada: 0 });
  controle('grade real, 2 consultores em :00/:30, bom dia sem prazo', Array.from({ length: 36 }, (_, i) => ({ T: t('09:00') + Math.floor(i / 2) * 30 * MIN, consultor: i % 2 })),
    { bomDiaComPrazo: false, todosSemConversa: true, frioCravado: 29, rajadaLembreteCravada: 0 });
  // As duas faixas cheias (lead novo em :00/:30, remarcação em :15/:45), 2 por
  // quarto de hora: o mais denso que a agenda faz. A rajada por robô espalha o
  // ep_agenda e junta lembretes: a rajada do lembrete adia 9 vezes, sem perder
  // nenhum, e o lembrete chega a 27/h (o teto próprio é 28 por isso).
  controle('duas faixas cheias, 2 reuniões por quarto de hora', Array.from({ length: 36 }, (_, i) => ({ T: t('09:00') + Math.floor(i / 2) * 15 * MIN, consultor: i % 2 })),
    { bomDiaComPrazo: true, todosSemConversa: false, frioCravado: 30, rajadaLembreteCravada: 9 });
}

describe('DÍVIDA CONHECIDA — agenda densa com bom dia sem prazo, todo mundo sem conversa', () => {
  // As duas faixas cheias (2 reuniões por quarto de hora, 9h às 13h15), o bom
  // dia sem prazo e ninguém com conversa nas últimas 24h. O total proativo de
  // 40/h (lembrete e resposta entram na conta) e o volume sustentado (40 em 3h
  // para quem não escreveu) seguram o bom dia, que é P3 sem prazo, e 8 deles
  // passam das 12h sem sair: 7 pelo total da hora e 1 pelo volume. É régua de
  // volume segurando agenda legítima; nenhuma delas separa agenda de frio mal
  // classificado (ver o regulamento). A rajada do lembrete não entra nisso.
  // Cravado para medir na sombra contra a agenda real antes de mexer.
  const t = tDia;
  const r = diaDeAgenda(Array.from({ length: 36 }, (_, i) => ({ T: t('09:00') + Math.floor(i / 2) * 15 * MIN, consultor: i % 2 })),
    { bomDiaComPrazo: false, todosSemConversa: true });
  resumo('agenda densa, bom dia sem prazo', r);

  it('8 bons dias expiram; os lembretes, as respostas e os eventos saem todos', () => {
    const perdidos = r.expirados.map(x => x.pedido.rotulo);
    expect(perdidos).toEqual(Array(8).fill('bom_dia'));
    const motivos = r.expirados.map(x => x.ultimoMotivo);
    expect(motivos.filter(m => m === 'teto_proativo_total').length).toBe(7);
    expect(motivos.filter(m => m === 'volume_sustentado').length).toBe(1);
    expect(r.motivos.rajada_lembrete ?? 0).toBe(0);
    for (const rotulo of ['1h', '5min', 'alerta', 'reativo', 'evento']) {
      expect({ rotulo, fora: r.pendentes.concat(r.expirados).filter(x => x.pedido.rotulo === rotulo).length }).toEqual({ rotulo, fora: 0 });
    }
  });
});
