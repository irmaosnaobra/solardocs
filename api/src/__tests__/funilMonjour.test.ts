import { describe, it, expect } from 'vitest';
import { montarFunilMonjour } from '../services/monjour/funilMonjourPuro';
import type { EventoMonjour } from '../services/monjour/monjourCatalogo';
import { TELAS_MONJOUR } from '../services/monjour/monjourCatalogo';

// A conta do funil do quiz Monjour: eventos de exemplo entram, o FunilMonjour sai.

const BASE = Date.parse('2026-11-19T15:00:00.000Z'); // 12h em São Paulo
const AGORA = new Date('2026-11-19T18:00:00.000Z');
const OP = { periodo: '7dias', desde: '2026-11-12T00:00:00.000Z', ate: AGORA.toISOString(), agora: AGORA };

const ANUNCIO_IMG = '120256011166960271'; // IMG01, CJ1 - Imagens
const ANUNCIO_VID = '120256011191360271'; // VID02, CJ2 - Videos 1
const CJ1 = '120256011160400271';

let seq = 0;
/** Evento com ts do navegador = BASE + seg segundos (e o created_at igual). */
function ev(sid: string, tipo: string, d: Record<string, unknown>, seg = 0): EventoMonjour {
  seq += 1;
  const ms = BASE + seg * 1000;
  return {
    session_id: sid, event_type: tipo, created_at: new Date(ms).toISOString(),
    event_data: { lp: 'monjour', v: 1, seq, ts: ms, ...d },
  };
}
const CHAVE = (n: number): string => TELAS_MONJOUR.find((t) => t.n === n)!.chave;

/** Sessão que viu as telas de 1 a ate (uma a cada `passo` segundos), com o contexto dado. */
function viu(sid: string, ate: number, ctx: Record<string, unknown> = {}, passo = 10, pulaMeta = false): EventoMonjour[] {
  const saida: EventoMonjour[] = [];
  for (let n = 1; n <= ate; n += 1) {
    if (pulaMeta && n === 20) continue;
    saida.push(ev(sid, 'monjour_passo', { passo: CHAVE(n), n, pais: 'MX', disp: 'movil', so: 'android', nav: 'chrome', ...ctx }, n * passo));
  }
  return saida;
}
const resp = (sid: string, passo: string, r: unknown, seg = 5): EventoMonjour => ev(sid, 'monjour_resp', { passo, resp: r }, seg);
const fim = (sid: string, destino: string, extra: Record<string, unknown> = {}, seg = 400): EventoMonjour =>
  ev(sid, 'monjour_fim', { destino, ...extra }, seg);

const etapa = (f: ReturnType<typeof montarFunilMonjour>, n: number) => f.etapas.find((e) => e.n === n)!;

describe('funil do quiz Monjour: etapas', () => {
  const eventos = [
    ...viu('a', 30), fim('a', 'checkout', { plan: 'basico' }), fim('a', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd', pais_cartao: 'MX' }, 500),
    ...viu('b', 30), fim('b', 'checkout', { plan: 'plus' }),
    ...viu('c', 30),
    ...viu('d', 10),
    ...viu('e', 5),
    ...viu('f', 1),
  ];
  const f = montarFunilMonjour(eventos, OP);

  it('o funil só desce, com 32 etapas', () => {
    expect(f.etapas).toHaveLength(32);
    const chegaram = f.etapas.map((e) => e.chegaram);
    for (let i = 1; i < chegaram.length; i += 1) expect(chegaram[i]).toBeLessThanOrEqual(chegaram[i - 1]);
    expect([1, 5, 6, 10, 11, 30, 31, 32].map((n) => etapa(f, n).chegaram)).toEqual([6, 5, 4, 4, 3, 3, 2, 1]);
  });

  it('saíram = chegaram menos o da etapa seguinte; oferta e clique fecham o funil', () => {
    expect(etapa(f, 1).sairam).toBe(1);
    expect(etapa(f, 5).sairam).toBe(1);
    expect(etapa(f, 10).sairam).toBe(1);
    expect(etapa(f, 30).sairam).toBe(1); // c viu a oferta e não clicou em comprar
    expect(etapa(f, 31).sairam).toBe(1); // b clicou e não comprou
    expect(etapa(f, 32).sairam).toBe(0);
    expect(etapa(f, 30).rotulo).toBe('Oferta');
    expect(etapa(f, 31).rotulo).toBe('Clicou em comprar');
    expect(etapa(f, 32).rotulo).toBe('Comprou');
  });

  it('porcentagens: do início e de saída (0 a 100, uma casa)', () => {
    expect(etapa(f, 1).pctInicio).toBe(100);
    expect(etapa(f, 10).pctInicio).toBe(66.7);
    expect(etapa(f, 30).pctSaida).toBe(33.3);
    expect(etapa(f, 31).pctSaida).toBe(50);
  });

  it('totais, plano, receita, ticket e conversão', () => {
    expect(f.totais).toMatchObject({
      sessoes: 6, ofertas: 3, checkouts: 2, compras: 1, comprasBasico: 1, comprasPlus: 0,
      receitaCentavos: 1990, ticketMedioCentavos: 1990, upgrades: 0,
    });
    expect(f.totais.conversao).toBeCloseTo(1 / 6, 3);
  });
});

describe('funil do quiz Monjour: tela da meta pulada', () => {
  const eventos = [...viu('p', 24, {}, 10, true), ...viu('q', 24), ...viu('r', 19)];
  const f = montarFunilMonjour(eventos, OP);

  it('quem pulou a meta ainda chegou à tela 20 e é contado em pularam', () => {
    expect(etapa(f, 20).chegaram).toBe(2);
    expect(etapa(f, 20).pularam).toBe(1);
    expect(etapa(f, 19).pularam).toBeUndefined();
    // o 20 não perde a sessão que pulou: ela saiu depois do 21
    expect(etapa(f, 20).sairam).toBe(0);
    expect(etapa(f, 19).sairam).toBe(1);
  });

  it('a mediana do 19 usa o 21 quando o 20 foi pulado', () => {
    // p: 19 em 190s, 21 em 210s (20s); q: 19 em 190s, 20 em 200s (10s); mediana 15
    expect(etapa(f, 19).medianaSegundos).toBe(15);
  });
});

describe('funil do quiz Monjour: saídas especiais', () => {
  it('conta fin_seguridad e partida sem saída por sessão', () => {
    const f = montarFunilMonjour([
      ...viu('s1', 23), fim('s1', 'fin_seguridad'),
      ...viu('s2', 23), fim('s2', 'fin_seguridad'),
      ...viu('s3', 21), fim('s3', 'partida_sin_salida'),
      ...viu('s4', 21),
    ], OP);
    expect(f.saidas).toEqual({ finSeguridad: 2, partidaSemSaida: 1 });
    expect(etapa(f, 21).sairam).toBe(2); // s3 e s4 não passaram da partida
  });
});

describe('funil do quiz Monjour: tempo mediano', () => {
  it('mediana entre a primeira vista de n e a de n+1, cortando acima de 30 min', () => {
    const f = montarFunilMonjour([
      ...viu('t1', 3, {}, 10), // 1 -> 2: 10 s
      ...viu('t2', 3, {}, 20), // 20 s
      ...viu('t3', 3, {}, 30), // 30 s
      ev('t4', 'monjour_passo', { passo: 'edad', n: 1 }, 0),
      ev('t4', 'monjour_passo', { passo: 'objetivo', n: 2 }, 31 * 60), // 31 min: descartado
      ev('t5', 'monjour_passo', { passo: 'edad', n: 1 }, 0),
      ev('t5', 'monjour_passo', { passo: 'objetivo', n: 2 }, 30 * 60), // 30 min exatos: vale
    ], OP);
    // 10, 20, 30 e 1800; o de 31 min sai. Mediana de 4 valores = (20 + 30) / 2
    expect(etapa(f, 1).medianaSegundos).toBe(25);
    expect(etapa(f, 2).medianaSegundos).toBe(20); // t1, t2 e t3: 10, 20 e 30 s
  });

  it('só considera quem chegou à etapa seguinte; sem ninguém, null', () => {
    const f = montarFunilMonjour(viu('u', 2), OP);
    expect(etapa(f, 2).medianaSegundos).toBeNull();
    expect(etapa(f, 32).medianaSegundos).toBeNull();
  });

  it('a oferta mede até o clique em comprar, e o clique até a compra', () => {
    const f = montarFunilMonjour([
      ...viu('v', 30), fim('v', 'checkout', { plan: 'plus' }, 330), fim('v', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 390),
    ], OP);
    expect(etapa(f, 30).medianaSegundos).toBe(30); // oferta vista em 300 s, clique em 330 s
    expect(etapa(f, 31).medianaSegundos).toBe(60);
  });
});

describe('funil do quiz Monjour: recortes', () => {
  const eventos = [
    ...viu('r1', 30, { pais: 'MX', disp: 'movil', so: 'ios', nav: 'safari', utm_content: ANUNCIO_IMG }),
    resp('r1', 'correo', 'consent_si'), fim('r1', 'checkout', { plan: 'basico' }),
    fim('r1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 450),
    ...viu('r2', 12, { pais: 'CO', disp: 'movil', so: 'android', nav: 'instagram', utm_content: ANUNCIO_VID }),
    ...viu('r3', 5, { pais: 'XX', disp: 'escritorio', so: 'windows', nav: 'chrome', utm_content: '999' }),
    ...viu('r4', 3, { pais: '', disp: 'tablet', so: 'otro', nav: 'otro' }),
    ...viu('r5', 4, { pais: 'MX', disp: 'movil', so: 'android', nav: 'chrome', utm_content: ANUNCIO_IMG }),
  ];
  const f = montarFunilMonjour(eventos, OP);
  const por = (lista: { chave: string }[], chave: string) => lista.find((l) => l.chave === chave) as any;

  it('país: nome em português, código desconhecido e sem país', () => {
    expect(por(f.recortes.pais, 'MX')).toMatchObject({ rotulo: 'México', sessoes: 2, compras: 1, leads: 1, ofertas: 1, checkouts: 1, receitaCentavos: 1990 });
    expect(por(f.recortes.pais, 'MX').conversao).toBe(0.5);
    expect(por(f.recortes.pais, 'CO').rotulo).toBe('Colômbia');
    expect(por(f.recortes.pais, 'XX').rotulo).toBe('XX');
    expect(por(f.recortes.pais, '(sem)').rotulo).toBe('Sem país');
    expect(f.recortes.pais[0].chave).toBe('MX'); // ordenado por volume
  });

  it('aparelho, sistema e navegador', () => {
    expect(por(f.recortes.aparelho, 'movil')).toMatchObject({ rotulo: 'Celular', sessoes: 3 });
    expect(por(f.recortes.aparelho, 'escritorio').rotulo).toBe('Computador');
    expect(por(f.recortes.sistema, 'ios').rotulo).toBe('iOS');
    expect(por(f.recortes.navegador, 'instagram').rotulo).toBe('Instagram');
  });

  it('anúncio: id conhecido, desconhecido e sem utm', () => {
    expect(por(f.recortes.anuncio, ANUNCIO_IMG)).toMatchObject({ rotulo: 'IMG01 Dono 1 livro', sessoes: 2 });
    expect(por(f.recortes.anuncio, ANUNCIO_VID).rotulo).toBe('VID02');
    expect(por(f.recortes.anuncio, '999').rotulo).toBe('Anúncio 999');
    expect(por(f.recortes.anuncio, 'sem').rotulo).toBe('Sem anúncio (orgânico ou direto)');
  });

  it('conjunto vem do anúncio; desconhecido e sem anúncio ficam separados', () => {
    expect(por(f.recortes.conjunto, CJ1)).toMatchObject({ rotulo: 'CJ1 - Imagens', sessoes: 2 });
    expect(por(f.recortes.conjunto, '120256011163980271').rotulo).toBe('CJ2 - Videos 1');
    expect(por(f.recortes.conjunto, 'desconhecido').sessoes).toBe(1);
    expect(por(f.recortes.conjunto, 'sem').sessoes).toBe(1);
  });

  it('dia e hora em São Paulo; hora traz as 24 faixas', () => {
    expect(f.recortes.dia).toHaveLength(1);
    expect(f.recortes.dia[0]).toMatchObject({ chave: '2026-11-19', rotulo: '19/11', sessoes: 5 });
    expect(f.recortes.hora).toHaveLength(24);
    expect(por(f.recortes.hora, '12')).toMatchObject({ rotulo: '12h', sessoes: 5 });
    expect(por(f.recortes.hora, '03').sessoes).toBe(0);
  });

  it('dia vira em São Paulo, não em UTC', () => {
    const noite = (sid: string, iso: string): EventoMonjour => ({
      session_id: sid, event_type: 'monjour_passo', created_at: iso, event_data: { passo: 'edad', n: 1 },
    });
    const g = montarFunilMonjour([noite('n1', '2026-11-19T02:30:00.000Z'), noite('n2', '2026-11-19T03:30:00.000Z')], OP);
    expect(g.recortes.dia.map((d) => [d.chave, d.sessoes])).toEqual([['2026-11-18', 1], ['2026-11-19', 1]]);
    expect(por(g.recortes.hora, '23').sessoes).toBe(1);
    expect(por(g.recortes.hora, '00').sessoes).toBe(1);
  });

  it('opções de filtro: países, aparelhos e anúncios do período', () => {
    expect(f.filtros.paises[0]).toEqual({ codigo: 'MX', nome: 'México', sessoes: 2 });
    expect(f.filtros.paises.map((p) => p.codigo).sort()).toEqual(['CO', 'MX', 'XX']);
    expect(f.filtros.aparelhos.find((a) => a.chave === 'movil')!.sessoes).toBe(3);
    expect(f.filtros.anuncios.find((a) => a.id === ANUNCIO_IMG)).toEqual({ id: ANUNCIO_IMG, nome: 'IMG01 Dono 1 livro', conjunto: CJ1, sessoes: 2 });
    expect(f.filtros.anuncios.find((a) => a.id === 'sem')!.sessoes).toBe(1);
  });
});

describe('funil do quiz Monjour: respostas e conversão', () => {
  const eventos = [
    ...viu('x1', 30), resp('x1', 'edad', '25'), resp('x1', 'probado', ['dietas', 'ayuno']), resp('x1', 'picar', 'si'),
    fim('x1', 'checkout', { plan: 'plus' }), fim('x1', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 450),
    ...viu('x2', 30), resp('x2', 'edad', '25'), resp('x2', 'probado', ['dietas']),
    ...viu('x3', 12), resp('x3', 'edad', '35'), resp('x3', 'edad', '45', 8), // troca: vale a última
    ...viu('x4', 5), resp('x4', 'cargando_sabor', 'citricos'), resp('x4', 'peso', '70'), resp('x4', 'correo', 'consent_no'),
  ];
  const f = montarFunilMonjour(eventos, OP);
  const pergunta = (chave: string) => f.respostas.find((r) => r.chave === chave)!;
  const opcao = (chave: string, valor: string) => pergunta(chave).opcoes.find((o) => o.valor === valor)!;

  it('distribuição, chegada à oferta e conversão por opção', () => {
    expect(opcao('edad', '25')).toMatchObject({ rotulo: '25-34 años', sessoes: 2, pct: 66.7, chegaramOferta: 2, compras: 1, conversao: 0.5 });
    expect(opcao('edad', '45')).toMatchObject({ sessoes: 1, pct: 33.3, chegaramOferta: 0, compras: 0, conversao: 0 });
    expect(opcao('edad', '35').sessoes).toBe(0); // trocou para 45
    expect(opcao('edad', '55').sessoes).toBe(0);
  });

  it('múltipla: a sessão conta em cada opção marcada', () => {
    expect(opcao('probado', 'dietas')).toMatchObject({ sessoes: 2, pct: 100, compras: 1 });
    expect(opcao('probado', 'ayuno').sessoes).toBe(1);
    expect(opcao('probado', 'nada').sessoes).toBe(0);
  });

  it('mini-perguntas do cargando e aceite de e-mail', () => {
    expect(opcao('picar', 'si').sessoes).toBe(1);
    expect(opcao('sabor', 'citricos').sessoes).toBe(1);
    expect(opcao('correo', 'consent_no').sessoes).toBe(1);
    expect(f.totais.leads).toBe(1); // consent_no também é e-mail informado
  });

  it('nunca expõe resposta de peso, altura, meta, segurança ou nome', () => {
    const chaves = f.respostas.map((r) => r.chave);
    for (const proibida of ['peso', 'altura', 'meta', 'seguridad', 'nombre']) expect(chaves).not.toContain(proibida);
  });

  it('valor de resposta fora da lista aparece com o próprio texto', () => {
    const g = montarFunilMonjour([...viu('y', 2), resp('y', 'objetivo', 'algo_novo')], OP);
    expect(g.respostas.find((r) => r.chave === 'objetivo')!.opcoes.find((o) => o.valor === 'algo_novo')).toMatchObject({ rotulo: 'algo_novo', sessoes: 1 });
  });
});

describe('funil do quiz Monjour: filtros', () => {
  const eventos = [
    ...viu('f1', 30, { pais: 'MX', disp: 'movil', utm_content: ANUNCIO_IMG }),
    ...viu('f2', 10, { pais: 'CO', disp: 'movil', utm_content: ANUNCIO_VID }),
    ...viu('f3', 10, { pais: 'MX', disp: 'escritorio', utm_content: ANUNCIO_VID }),
    ...viu('f4', 4, { pais: 'MX', disp: 'movil' }),
  ];
  const total = (filtros: Parameters<typeof montarFunilMonjour>[1]['filtros']) => montarFunilMonjour(eventos, { ...OP, filtros }).totais.sessoes;

  it('país, aparelho, anúncio e conjunto valem pela sessão', () => {
    expect(total({})).toBe(4);
    expect(total({ pais: 'MX' })).toBe(3);
    expect(total({ pais: 'mx' })).toBe(3);
    expect(total({ disp: 'movil' })).toBe(3);
    expect(total({ anuncio: ANUNCIO_VID })).toBe(2);
    expect(total({ anuncio: 'sem' })).toBe(1);
    expect(total({ conjunto: CJ1 })).toBe(1);
    expect(total({ conjunto: '120256011163980271' })).toBe(2);
    expect(total({ conjunto: 'sem' })).toBe(1);
    expect(total({ pais: 'MX', disp: 'movil', anuncio: ANUNCIO_IMG })).toBe(1);
    expect(total({ pais: 'AR' })).toBe(0);
  });

  it('as opções de filtro não encolhem quando alguém filtra', () => {
    const g = montarFunilMonjour(eventos, { ...OP, filtros: { pais: 'CO' } });
    expect(g.filtros.paises.map((p) => p.codigo).sort()).toEqual(['CO', 'MX']);
    expect(g.etapas[0].chegaram).toBe(1);
  });

  it('o contexto vale mesmo quando só um evento da sessão o carrega', () => {
    const g = montarFunilMonjour([
      ev('z', 'monjour_passo', { passo: 'edad', n: 1 }, 0),
      ev('z', 'monjour_passo', { passo: 'objetivo', n: 2, pais: 'PE', utm_content: ANUNCIO_IMG }, 5),
    ], { ...OP, filtros: { pais: 'PE' } });
    expect(g.totais.sessoes).toBe(1);
  });
});

describe('funil do quiz Monjour: sessões de teste (sonda)', () => {
  it('utm_source sonda sai de todas as contagens, inclusive o webhook sem utm', () => {
    const f = montarFunilMonjour([
      ...viu('real', 30, { utm_source: 'meta' }),
      ...viu('teste', 30, { utm_source: 'sonda' }), resp('teste', 'edad', '25'),
      fim('teste', 'checkout', { plan: 'basico' }), fim('teste', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 450),
      ev('teste', 'monjour_app', { acao: 'abriu' }),
    ], OP);
    expect(f.totais).toMatchObject({ sessoes: 1, compras: 0, receitaCentavos: 0, checkouts: 0 });
    expect(f.app.abriram).toBe(0);
    expect(f.recortes.pais[0].sessoes).toBe(1);
    expect(f.filtros.paises[0].sessoes).toBe(1);
    expect(f.respostas.find((r) => r.chave === 'edad')!.opcoes.every((o) => o.sessoes === 0)).toBe(true);
  });

  it('sonda em maiúsculas também é teste', () => {
    const f = montarFunilMonjour(viu('t', 5, { utm_source: 'SONDA' }), OP);
    expect(f.totais.sessoes).toBe(0);
  });
});

describe('funil do quiz Monjour: compra, upgrade e app', () => {
  it('webhook repetido não duplica; upgrade e app contam à parte', () => {
    const f = montarFunilMonjour([
      ...viu('k1', 30), fim('k1', 'checkout', { plan: 'basico' }),
      fim('k1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 450),
      fim('k1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 460),
      fim('k1', 'upgrade', { plan: 'plus', valor: 1000, moeda: 'usd' }, 900),
      ev('k1', 'monjour_app', { acao: 'abriu' }, 1000), ev('k1', 'monjour_app', { acao: 'instalou' }, 1010),
      ev('k1', 'monjour_app', { acao: 'upgrade_click' }, 1020),
      ...viu('k2', 30), fim('k2', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 450),
      ev('antigo', 'monjour_app', { acao: 'abriu' }),
    ], OP);
    expect(f.totais).toMatchObject({
      sessoes: 2, compras: 2, comprasBasico: 1, comprasPlus: 1, upgrades: 1,
      // O ticket médio é só da compra: o upgrade fica fora da média.
      receitaCentavos: 1990 + 1000 + 2990, ticketMedioCentavos: Math.round((1990 + 2990) / 2),
    });
    expect(f.app).toEqual({ abriram: 2, instalaram: 1, upgradeClicks: 1 });
    // k2 comprou sem registro de clique: o funil não pode ter mais compras que cliques
    expect(etapa(f, 31).chegaram).toBe(2);
    expect(etapa(f, 32).chegaram).toBe(2);
  });

  it('sessão só com upgrade (quiz em outro dia) não entra no funil, mas conta o upgrade', () => {
    const f = montarFunilMonjour([
      ...viu('quiz', 3),
      ev('velha', 'monjour_fim', { destino: 'upgrade', plan: 'plus', valor: 1000, moeda: 'usd', pais: 'US', disp: 'escritorio' }, 50),
    ], OP);
    expect(f.totais).toMatchObject({ sessoes: 1, compras: 0, upgrades: 1, receitaCentavos: 1000, ticketMedioCentavos: 0 });
    expect(etapa(f, 1).chegaram).toBe(1);
    expect(etapa(f, 1).sairam).toBe(0);
    expect(etapa(f, 3).sairam).toBe(1);
    expect(f.recortes.pais.map((l) => l.chave)).toEqual(['MX']);
    expect(f.filtros.paises.map((p) => p.codigo)).toEqual(['MX']);
    expect(f.filtros.aparelhos.map((a) => a.chave)).toEqual(['movil']);
  });

  it('sessão só com a compra do webhook (quiz antes da meia-noite) não sobe as 32 etapas', () => {
    const f = montarFunilMonjour([
      ...viu('quiz', 2),
      ev('virada', 'monjour_fim', { destino: 'compra', plan: 'basico', valor: 1990, moeda: 'usd', pais: 'US' }, 50),
    ], OP);
    expect(f.totais).toMatchObject({ sessoes: 1, compras: 0, ofertas: 0, checkouts: 0, receitaCentavos: 0 });
    expect(etapa(f, 1).chegaram).toBe(1);
    expect(etapa(f, 30).chegaram).toBe(0);
    expect(etapa(f, 32).chegaram).toBe(0);
    expect(f.recortes.pais.map((l) => l.chave)).toEqual(['MX']);
  });

  it('o país e o aparelho vêm do navegador, nunca do webhook', () => {
    const f = montarFunilMonjour([
      ev('w', 'monjour_fim', { destino: 'compra', plan: 'basico', valor: 1990, moeda: 'usd', pais: 'US', disp: 'escritorio' }, 1),
      ev('w', 'monjour_passo', { passo: 'edad', n: 1, pais: 'CO', disp: 'movil' }, 2),
    ], OP);
    expect(f.recortes.pais.map((l) => l.chave)).toEqual(['CO']);
    expect(f.recortes.aparelho.map((l) => l.chave)).toEqual(['movil']);
    expect(f.totais.compras).toBe(1);
  });

  it('quem só abriu o app (cliente antigo) não entra como visitante do quiz', () => {
    const f = montarFunilMonjour([ev('so-app', 'monjour_app', { acao: 'abriu' })], OP);
    expect(f.totais.sessoes).toBe(0);
    expect(f.app.abriram).toBe(1);
  });

  it('valor em outra moeda não entra na receita em dólar', () => {
    const f = montarFunilMonjour([...viu('m', 30), fim('m', 'compra', { plan: 'basico', valor: 99900, moeda: 'mxn' }, 450)], OP);
    expect(f.totais.compras).toBe(1);
    expect(f.totais.receitaCentavos).toBe(0);
  });
});

describe('funil do quiz Monjour: período vazio e cabeçalho', () => {
  const f = montarFunilMonjour([], { ...OP, inicioRastreio: '2026-11-18T12:00:00.000Z' });

  it('zera tudo e mantém as 32 etapas', () => {
    expect(f.totais).toEqual({
      sessoes: 0, leads: 0, ofertas: 0, checkouts: 0, compras: 0, comprasBasico: 0, comprasPlus: 0,
      upgrades: 0, receitaCentavos: 0, conversao: 0, ticketMedioCentavos: 0,
    });
    expect(f.etapas).toHaveLength(32);
    expect(f.etapas.every((e) => e.chegaram === 0 && e.pctInicio === 0 && e.pctSaida === 0 && e.medianaSegundos === null)).toBe(true);
    expect(f.recortes).toEqual({ pais: [], aparelho: [], sistema: [], navegador: [], anuncio: [], conjunto: [], dia: [], hora: [] });
    expect(f.filtros).toEqual({ paises: [], aparelhos: [], anuncios: [] });
    expect(f.saidas).toEqual({ finSeguridad: 0, partidaSemSaida: 0 });
    expect(f.app).toEqual({ abriram: 0, instalaram: 0, upgradeClicks: 0 });
  });

  it('cabeçalho: período, datas, rastreio e truncado', () => {
    expect(f).toMatchObject({
      periodo: '7dias', desde: OP.desde, ate: OP.ate, atualizadoEm: AGORA.toISOString(),
      inicioRastreio: '2026-11-18T12:00:00.000Z', truncado: false,
    });
    expect(montarFunilMonjour([], { ...OP, truncado: true }).truncado).toBe(true);
    expect(montarFunilMonjour([], OP).inicioRastreio).toBeNull();
  });

  it('as perguntas aparecem mesmo sem resposta, e as etapas seguem a ordem das telas', () => {
    expect(f.respostas.map((r) => r.chave).slice(0, 3)).toEqual(['edad', 'objetivo', 'cuerpo']);
    expect(f.respostas.find((r) => r.chave === 'edad')!.opcoes.map((o) => o.valor)).toEqual(['25', '35', '45', '55']);
    expect(f.etapas.map((e) => e.n)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(etapa(f, 23)).toMatchObject({ chave: 'seguridad', rotulo: 'Segurança', tipo: 'multipla' });
  });
});
