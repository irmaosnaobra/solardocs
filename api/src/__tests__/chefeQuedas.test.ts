import { describe, it, expect } from 'vitest';
import { simular, porHoraBrt, picoEmJanela, PedidoAgendado, ResultadoSimulacao, Enviado } from '../services/chefe/simular';

// ─────────────────────────────────────────────────────────────────────────────
// As 4 quedas da linha 5040, reencenadas pelo decidir() do CHEFE, tick a tick
// (2 min), com os números da memória. A pergunta de cada uma: com o CHEFE no
// meio, quantas mensagens teriam saído por hora?
//
//   01/08 (sáb) 4º toque da Bia: 57 toques em 5h, até 5 bolhas cada
//         [memória linha-io-5040-bloqueio-e-travas.md]
//   04/08 (ter) fila da agenda soltou 8 pessoas e 37 mensagens às 8h; a linha
//         desconectou [memória linha-io-queda-04-06-ago.md]
//   30/08 (dom) 98 envios frios a 18/h por ~9h pela rota crua, de 184
//         [memória linha-io-bloqueio-30-ago.md]
//   02/10 (sex) reagenda: 39 frios em 55 min, 3 bolhas cada, carimbando como
//         agenda [memória linha-io-queda-02-out-reagenda.md]
//
// E o CONTROLE POSITIVO: um dia de agenda cheia (36 reuniões nas faixas :00/:30
// e :15/:45) com resposta, aviso e evento no meio. Nada importante fica de fora
// e nada de evento é adiado. Sem ele, um CHEFE que não deixa nada sair passaria
// em todos os replays acima.
//
// Os replays recebem o robô com a classe CERTA de CLASSE_POR_ROBO. O caso de
// classe errada (frio carimbado como agenda) tem variante própria: quem pega é o
// volume sustentado sem conversa. Telefones fictícios.
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

  it('com a classe ERRADA (frio pedindo como agenda), o volume sustentado sem conversa segura: 40 em 3h e 60 em 6h', () => {
    const seg = brt('2026-08-31T09:30');
    const r = simular(fila(98, i => seg + Math.round(i * 3.2 * MIN), 'ep_agenda'), { inicio: seg, fim: brt('2026-08-31T21:00') });
    resumo('30/08 classe errada', r);
    expect(picoEmJanela(r.enviados, 3 * HORA)).toBeLessThanOrEqual(40);
    expect(picoEmJanela(r.enviados, 6 * HORA)).toBeLessThanOrEqual(60);
    expect(picoEmJanela(r.enviados, HORA)).toBeLessThanOrEqual(24);
    expect(r.motivos.volume_sustentado ?? 0).toBeGreaterThan(0);
  });
});

describe('queda 4 — 02/10, o reagenda (39 frios em 55 min, 3 bolhas, carimbando como agenda)', () => {
  const nove = brt('2026-10-02T09:00');
  const reagenda: PedidoAgendado[] = Array.from({ length: 39 }, (_, i) => ({
    robo: 'ep_reagenda_auto', destino: lead(i), bolhas: 3, chave: `ep_agenda_sent:${600 + i}:reagendado`,
    desde: nove, modo: 'tick', semConversa: true, rotulo: 'reagenda',
  }));
  // A agenda já logava "bom dia segurado pelo teto da linha": 12 bons dias represados às 9h.
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

describe('CONTROLE POSITIVO — segunda de agenda cheia (36 reuniões), com resposta, aviso e evento', () => {
  const dia = '2026-10-05';
  const t = (hhmm: string) => brt(`${dia}T${hhmm}`);
  const reunioes = Array.from({ length: 36 }, (_, i) => t('09:00') + i * 15 * MIN);   // 09:00 a 17:45
  const pedidos: PedidoAgendado[] = [];
  const entradas = new Map<string, number>();

  reunioes.forEach((T, m) => {
    const tel = lead(m);
    pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `bd:${m}`, prazo: T - HORA, desde: t('07:00'),
      validoAte: Math.min(t('12:00'), T - HORA), modo: 'tick', semConversa: m % 2 === 0, rotulo: 'bom_dia' });
    pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `1h:${m}`, prazo: T, desde: T - 75 * MIN,
      validoAte: T - 45 * MIN, modo: 'tick', rotulo: '1h' });
    pedidos.push({ robo: 'ep_agenda', destino: tel, chave: `5m:${m}`, prazo: T, desde: T - 12 * MIN,
      validoAte: T + 3 * MIN, modo: 'tick', rotulo: '5min' });
    pedidos.push({ robo: 'ep_alerta_10min', destino: EQUIPE[m % 2]!, chave: `al:${m}`, prazo: T, desde: T - 10 * MIN,
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

  const r = simular(pedidos, { inicio: t('07:00'), fim: t('21:00'), equipe: EQUIPE, entradas });
  resumo('agenda cheia', r);
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

  it('todo lembrete sai dentro da janela dele, e o alerta antes da reunião', () => {
    for (const e of de('1h')) {
      expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 75 * MIN);
      expect(e.em).toBeLessThanOrEqual(e.pedido.prazo! - 45 * MIN);
    }
    for (const e of de('5min')) {
      expect(e.em).toBeGreaterThanOrEqual(e.pedido.prazo! - 12 * MIN);
      expect(e.em).toBeLessThanOrEqual(e.pedido.prazo! + 3 * MIN);
    }
    for (const e of de('alerta')) expect(e.em).toBeLessThan(e.pedido.prazo!);
  });

  it('todo bom dia sai entre 7h e 12h e pelo menos 60 min antes da reunião; confirmação e cobrança antes do prazo', () => {
    for (const e of de('bom_dia')) {
      expect(horaBrt(e.em)).toBeGreaterThanOrEqual(7);
      expect(e.em).toBeLessThanOrEqual(Math.min(t('12:00'), e.pedido.prazo!));
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
});
