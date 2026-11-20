import { describe, it, expect } from 'vitest';
import { montarFunilMonjour } from '../services/monjour/funilMonjourPuro';
import type { EventoMonjour } from '../services/monjour/monjourCatalogo';
import { TELAS_MONJOUR, ETAPAS_DEPOIS, QUIZ_NOVO_DESDE, QUIZ_BLOCO2_DESDE } from '../services/monjour/monjourCatalogo';

// A conta do funil do quiz Monjour: eventos de exemplo entram, o FunilMonjour sai.

// Estas sessões são ANTIGAS (8 h antes do quiz novo): as telas com `desde` (abertura e prévia do app) não existem para elas, e a conta
// do quiz de 29 telas fica como era. Hoje 12h em São Paulo; se o QUIZ_NOVO_DESDE mudar, o resto acompanha.
const BASE = Date.parse(QUIZ_NOVO_DESDE) - 8 * 3600_000;
const DIA_SP = new Date(BASE - 3 * 3600_000).toISOString().slice(0, 10);
const HORA_SP = String(new Date(BASE - 3 * 3600_000).getUTCHours()).padStart(2, '0');
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
// Os números dos testes antigos (1 a 29 telas, 30 clicou, 31 comprou) ficam: CHAVE leva o n antigo à chave, e `etapa` acha a etapa por ela.
const NOVAS = ['inicio', 'app', 'af_ropa', 'af_lunes']; // telas que o quiz de 29 telas não tinha
const LEGADO = TELAS_MONJOUR.filter((t) => !NOVAS.includes(t.chave));
const CHAVE = (n: number): string => LEGADO[n - 1].chave;
const chaveAntiga = (n: number): string => (n <= LEGADO.length ? CHAVE(n) : ETAPAS_DEPOIS[n - LEGADO.length - 1].chave);

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

const etapa = (f: ReturnType<typeof montarFunilMonjour>, n: number) => f.etapas.find((e) => e.chave === chaveAntiga(n))!;

describe('funil do quiz Monjour: etapas', () => {
  const eventos = [
    ...viu('a', 29), fim('a', 'checkout', { plan: 'basico' }), fim('a', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd', pais_cartao: 'MX' }, 500),
    ...viu('b', 29), fim('b', 'checkout', { plan: 'plus' }),
    ...viu('c', 29),
    ...viu('d', 10),
    ...viu('e', 5),
    ...viu('f', 1),
  ];
  const f = montarFunilMonjour(eventos, OP);

  it('o funil só desce, com as 35 etapas do catálogo', () => {
    expect(f.etapas).toHaveLength(35);
    // Sessão antiga não tem abertura nem prévia do app: só o quiz de 29 telas entra na conta de descida.
    const chegaram = f.etapas.filter((e) => !NOVAS.includes(e.chave)).map((e) => e.chegaram);
    for (let i = 1; i < chegaram.length; i += 1) expect(chegaram[i]).toBeLessThanOrEqual(chegaram[i - 1]);
    expect([1, 5, 6, 10, 11, 29, 30, 31].map((n) => etapa(f, n).chegaram)).toEqual([6, 5, 4, 4, 3, 3, 2, 1]);
  });

  it('saíram = chegaram menos o da etapa seguinte; oferta e clique fecham o funil', () => {
    expect(etapa(f, 1).sairam).toBe(1);
    expect(etapa(f, 5).sairam).toBe(1);
    expect(etapa(f, 10).sairam).toBe(1);
    expect(etapa(f, 29).sairam).toBe(1); // c viu a oferta e não clicou em comprar
    expect(etapa(f, 30).sairam).toBe(1); // b clicou e não comprou
    expect(etapa(f, 31).sairam).toBe(0);
    expect(etapa(f, 29).rotulo).toBe('Oferta');
    expect(etapa(f, 30).rotulo).toBe('Clicou em comprar');
    expect(etapa(f, 31).rotulo).toBe('Comprou');
  });

  it('porcentagens: do início e de saída (0 a 100, uma casa)', () => {
    expect(etapa(f, 1).pctInicio).toBe(100);
    expect(etapa(f, 10).pctInicio).toBe(66.7);
    expect(etapa(f, 29).pctSaida).toBe(33.3);
    expect(etapa(f, 30).pctSaida).toBe(50);
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
    expect(etapa(f, 31).medianaSegundos).toBeNull();
  });

  it('a oferta mede até o clique em comprar, e o clique até a compra', () => {
    const f = montarFunilMonjour([
      ...viu('v', 29), fim('v', 'checkout', { plan: 'plus' }, 320), fim('v', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 380),
    ], OP);
    expect(etapa(f, 29).medianaSegundos).toBe(30); // oferta vista em 290 s, clique em 320 s
    expect(etapa(f, 30).medianaSegundos).toBe(60);
  });
});

describe('funil do quiz Monjour: recortes', () => {
  const eventos = [
    ...viu('r1', 29, { pais: 'MX', disp: 'movil', so: 'ios', nav: 'safari', utm_content: ANUNCIO_IMG }),
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
    expect(f.recortes.dia[0]).toMatchObject({ chave: DIA_SP, rotulo: `${DIA_SP.slice(8, 10)}/${DIA_SP.slice(5, 7)}`, sessoes: 5 });
    expect(f.recortes.hora).toHaveLength(24);
    expect(por(f.recortes.hora, HORA_SP)).toMatchObject({ rotulo: `${HORA_SP}h`, sessoes: 5 });
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
    ...viu('x1', 29), resp('x1', 'edad', '25'), resp('x1', 'probado', ['dietas', 'ayuno']), resp('x1', 'picar', 'si'),
    fim('x1', 'checkout', { plan: 'plus' }), fim('x1', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 450),
    ...viu('x2', 29), resp('x2', 'edad', '25'), resp('x2', 'probado', ['dietas']),
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
    ...viu('f1', 29, { pais: 'MX', disp: 'movil', utm_content: ANUNCIO_IMG }),
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
    expect(etapa(g, 1).chegaram).toBe(1);
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
      ...viu('real', 29, { utm_source: 'meta' }),
      ...viu('teste', 29, { utm_source: 'sonda' }), resp('teste', 'edad', '25'),
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
      ...viu('k1', 29), fim('k1', 'checkout', { plan: 'basico' }),
      fim('k1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 450),
      fim('k1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 460),
      fim('k1', 'upgrade', { plan: 'plus', valor: 1000, moeda: 'usd' }, 900),
      ev('k1', 'monjour_app', { acao: 'abriu' }, 1000), ev('k1', 'monjour_app', { acao: 'instalou' }, 1010),
      ev('k1', 'monjour_app', { acao: 'upgrade_click' }, 1020),
      ...viu('k2', 29), fim('k2', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 450),
      ev('antigo', 'monjour_app', { acao: 'abriu' }),
    ], OP);
    expect(f.totais).toMatchObject({
      sessoes: 2, compras: 2, comprasBasico: 1, comprasPlus: 1, upgrades: 1,
      // O ticket médio é só da compra: o upgrade fica fora da média.
      receitaCentavos: 1990 + 1000 + 2990, ticketMedioCentavos: Math.round((1990 + 2990) / 2),
    });
    expect(f.app).toEqual({ abriram: 2, instalaram: 1, upgradeClicks: 1 });
    // k2 comprou sem registro de clique: o funil não pode ter mais compras que cliques
    expect(etapa(f, 30).chegaram).toBe(2);
    expect(etapa(f, 31).chegaram).toBe(2);
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

  it('sessão só com a compra do webhook (quiz antes da meia-noite) não sobe as 31 etapas', () => {
    const f = montarFunilMonjour([
      ...viu('quiz', 2),
      ev('virada', 'monjour_fim', { destino: 'compra', plan: 'basico', valor: 1990, moeda: 'usd', pais: 'US' }, 50),
    ], OP);
    expect(f.totais).toMatchObject({ sessoes: 1, compras: 0, ofertas: 0, checkouts: 0, receitaCentavos: 0 });
    expect(etapa(f, 1).chegaram).toBe(1);
    expect(etapa(f, 29).chegaram).toBe(0);
    expect(etapa(f, 31).chegaram).toBe(0);
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
    const f = montarFunilMonjour([...viu('m', 29), fim('m', 'compra', { plan: 'basico', valor: 99900, moeda: 'mxn' }, 450)], OP);
    expect(f.totais.compras).toBe(1);
    expect(f.totais.receitaCentavos).toBe(0);
  });
});

describe('funil do quiz Monjour: período vazio e cabeçalho', () => {
  const f = montarFunilMonjour([], { ...OP, inicioRastreio: '2026-11-18T12:00:00.000Z' });

  it('zera tudo e mantém as 35 etapas', () => {
    expect(f.totais).toEqual({
      sessoes: 0, leads: 0, ofertas: 0, checkouts: 0, compras: 0, comprasBasico: 0, comprasPlus: 0,
      upgrades: 0, receitaCentavos: 0, conversao: 0, ticketMedioCentavos: 0, atalho: 0, voltas: 0,
    });
    expect(f.etapas).toHaveLength(35);
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
    expect(f.etapas.map((e) => e.n)).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
    expect(etapa(f, 23)).toMatchObject({ chave: 'seguridad', rotulo: 'Segurança', tipo: 'multipla' });
  });
});

describe('funil do quiz Monjour: atalho e volta direto para a oferta', () => {
  const passoSemN = (sid: string, passo: string, seg: number): EventoMonjour => ev(sid, 'monjour_passo', { passo, pais: 'MX', disp: 'movil' }, seg);
  const oferta = (sid: string, seg: number): EventoMonjour => ev(sid, 'monjour_passo', { passo: 'oferta', n: 30, pais: 'MX', disp: 'movil' }, seg);
  const eventos = [
    ...viu('n1', 29), fim('n1', 'checkout', { plan: 'basico' }), fim('n1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 500), // quiz inteiro
    ...viu('at', 1), passoSemN('at', 'atalho_oferta', 15), oferta('at', 20), fim('at', 'checkout', { plan: 'plus' }, 60), fim('at', 'compra', { plan: 'plus', valor: 2990, moeda: 'usd' }, 120),
    ...viu('at2', 1), passoSemN('at2', 'atalho_oferta', 15), oferta('at2', 20), // atalho, viu a oferta e saiu
    passoSemN('vo', 'volta_oferta', 5), oferta('vo', 6), fim('vo', 'checkout', { plan: 'basico' }, 50), // voltou outro dia
    passoSemN('vo2', 'volta_oferta', 5), // voltou e nem chegou a ver a oferta registrada
    ...viu('p5', 5), // parou na tela 5
  ];
  const f = montarFunilMonjour(eventos, OP);

  it('sessão de atalho ou volta não infla as perguntas do meio', () => {
    expect(etapa(f, 1).chegaram).toBe(4); // n1, at, at2, p5: quem só voltou não é visitante novo da tela 1
    expect(etapa(f, 2).chegaram).toBe(2); // n1 e p5
    expect(etapa(f, 5).chegaram).toBe(2);
    expect(etapa(f, 6).chegaram).toBe(1);
    expect(etapa(f, 28).chegaram).toBe(1);
  });

  it('continua contando na oferta, no clique em comprar e na compra', () => {
    expect(etapa(f, 29).chegaram).toBe(4); // n1, at, at2, vo
    expect(etapa(f, 30).chegaram).toBe(3); // n1, at, vo
    expect(etapa(f, 31).chegaram).toBe(2); // n1, at
    expect(f.totais).toMatchObject({ sessoes: 6, ofertas: 4, checkouts: 3, compras: 2 });
  });

  it('quem foi direto à oferta não "saiu" nas telas do meio', () => {
    expect(etapa(f, 1).sairam).toBe(0); // at e at2 seguiram para a oferta; p5 seguiu até a 5
    expect(etapa(f, 5).sairam).toBe(1); // p5 parou de verdade
    expect(etapa(f, 29).sairam).toBe(1); // at2 viu a oferta e não clicou
    expect(etapa(f, 30).sairam).toBe(1); // vo clicou e não comprou
  });

  it('conta atalho e voltas por sessão', () => {
    expect(f.totais.atalho).toBe(2);
    expect(f.totais.voltas).toBe(2);
  });

  it('sem atalho nem volta, tudo igual: os dois números são zero', () => {
    const g = montarFunilMonjour([...viu('x', 3), ...viu('y', 29)], OP);
    expect(g.totais).toMatchObject({ atalho: 0, voltas: 0 });
    expect(etapa(g, 2).chegaram).toBe(2);
    expect(etapa(g, 3).sairam).toBe(1);
  });

  it('a mediana da tela 1 não usa o atalho como se fosse a tela 2', () => {
    const g = montarFunilMonjour([...viu('at', 1), passoSemN('at', 'atalho_oferta', 15), oferta('at', 20)], OP);
    expect(etapa(g, 1).medianaSegundos).toBeNull();
  });
});

describe('funil do quiz Monjour: telas novas (abertura e prévia do app) e sessões antigas', () => {
  const DESDE = Date.parse(QUIZ_NOVO_DESDE);
  /** Passo de uma sessão no instante `ms`, sempre pela chave (o n do site não vale). */
  const passoEm = (sid: string, passo: string, ms: number, n = 99): EventoMonjour => ({
    session_id: sid, event_type: 'monjour_passo', created_at: new Date(ms).toISOString(),
    event_data: { lp: 'monjour', passo, n, ts: ms, pais: 'MX', disp: 'movil' },
  });
  const sessaoEm = (sid: string, inicio: number, passos: [string, number][]): EventoMonjour[] =>
    passos.map(([p, seg]) => passoEm(sid, p, inicio + seg * 1000));

  const eventos = [
    ...sessaoEm('antiga', DESDE - 3600_000, [['edad', 0], ['objetivo', 40]]), // entrou antes: nunca viu abertura nem prévia
    ...sessaoEm('nova1', DESDE + 3600_000, [['inicio', 0], ['edad', 20]]),
    ...sessaoEm('nova2', DESDE + 7200_000, [['inicio', 0], ['edad', 10], ['app', 22], ['objetivo', 40]]),
  ];
  const f = montarFunilMonjour(eventos, OP);
  const porChave = (chave: string) => f.etapas.find((e) => e.chave === chave)!;

  it('a ordem do catálogo é inicio, edad, app, objetivo, com os rótulos novos e n = posição', () => {
    expect(f.etapas.slice(0, 4).map((e) => [e.n, e.chave, e.rotulo])).toEqual([
      [1, 'inicio', 'Abertura'], [2, 'edad', 'Idade'], [3, 'app', 'Prévia do app'], [4, 'objetivo', 'Objetivo'],
    ]);
    expect(TELAS_MONJOUR.find((t) => t.chave === 'inicio')!.desde).toBe(QUIZ_NOVO_DESDE);
    expect(TELAS_MONJOUR.find((t) => t.chave === 'app')!.desde).toBe(QUIZ_NOVO_DESDE);
    expect(TELAS_MONJOUR.find((t) => t.chave === 'edad')!.desde).toBeUndefined();
  });

  it('sessão antiga não conta em inicio nem em app; a nova conta nas etapas que viu', () => {
    expect(porChave('inicio').chegaram).toBe(2); // nova1 e nova2
    expect(porChave('edad').chegaram).toBe(3);
    expect(porChave('app').chegaram).toBe(1); // só nova2
    expect(porChave('objetivo').chegaram).toBe(2); // antiga e nova2
  });

  it('saíram: a antiga passa de Idade direto para Objetivo; ninguém sai de uma etapa que não existe para ela', () => {
    expect(porChave('inicio').sairam).toBe(0);
    expect(porChave('edad').sairam).toBe(1); // só nova1 parou em Idade
    expect(porChave('app').sairam).toBe(0);
    expect(porChave('objetivo').sairam).toBe(2); // antiga e nova2
  });

  it('o tempo de Abertura para Idade sai só das sessões novas; o de Idade usa a etapa seguinte de cada uma', () => {
    expect(porChave('inicio').medianaSegundos).toBe(15); // nova1 20 s, nova2 10 s
    // antiga: Idade -> Objetivo em 40 s (pulou a prévia); nova2: Idade -> Prévia em 12 s; nova1 não chegou à prévia
    expect(porChave('edad').medianaSegundos).toBe(26);
  });

  it('o instante do `desde` já conta como sessão nova', () => {
    const g = montarFunilMonjour(sessaoEm('limite', DESDE, [['inicio', 0], ['edad', 5]]), OP);
    expect(g.etapas.find((e) => e.chave === 'inicio')!.chegaram).toBe(1);
  });

  it('o n que o site manda não ordena nada: vale a chave', () => {
    // O site manda app com n 30 e inicio com n 31 (só informação): a conta segue o catálogo.
    const g = montarFunilMonjour([
      ...sessaoEm('x', DESDE + 3600_000, [['inicio', 0], ['edad', 5], ['app', 10]]).map((e) => ({ ...e, event_data: { ...e.event_data, n: e.event_data!.passo === 'inicio' ? 31 : e.event_data!.passo === 'app' ? 30 : 1 } })),
    ], OP);
    expect(g.etapas.slice(0, 3).map((e) => [e.chave, e.chegaram])).toEqual([['inicio', 1], ['edad', 1], ['app', 1]]);
    expect(g.etapas.find((e) => e.chave === 'checkout')!.chegaram).toBe(0); // o n 30 do app não virou "clicou em comprar"
    expect(g.etapas.find((e) => e.chave === 'compra')!.chegaram).toBe(0);
  });

  it('sessão com só um evento sem passo conhecido cai na primeira etapa que existe para ela', () => {
    const resp = (sid: string, ms: number): EventoMonjour => ({
      session_id: sid, event_type: 'monjour_resp', created_at: new Date(ms).toISOString(), event_data: { passo: 'edad', resp: '25', ts: ms },
    });
    const g = montarFunilMonjour([
      resp('velha', DESDE - 3600_000), passoEm('velha2', 'tela_que_nao_existe', DESDE - 3600_000), // antigas: a primeira etapa é a Idade
      resp('nova', DESDE + 3600_000), // nova: a primeira etapa é a Abertura
    ], OP);
    const c = (k: string) => g.etapas.find((e) => e.chave === k)!;
    expect(g.totais.sessoes).toBe(3);
    expect(c('inicio').chegaram).toBe(1); // só a nova
    expect(c('edad').chegaram).toBe(2); // as duas antigas; a nova parou na Abertura
    expect(c('edad').sairam).toBe(2); // as antigas pararam na Idade
    expect(c('inicio').sairam).toBe(1); // a nova parou na Abertura
  });

  it('atalho de sessão nova: viu só a abertura e foi à oferta, sem inflar Idade nem a prévia', () => {
    const g = montarFunilMonjour([
      ...sessaoEm('a1', DESDE + 3600_000, [['inicio', 0], ['atalho_oferta', 3], ['oferta', 4]]),
      ...sessaoEm('n9', DESDE + 3600_000, [['inicio', 0], ['edad', 5], ['app', 9]]),
    ], OP);
    const c = (k: string) => g.etapas.find((e) => e.chave === k)!;
    expect([c('inicio').chegaram, c('edad').chegaram, c('app').chegaram, c('oferta').chegaram]).toEqual([2, 1, 1, 1]);
    expect(c('inicio').sairam).toBe(0); // a1 seguiu para a oferta, n9 seguiu para Idade
    expect(g.totais).toMatchObject({ atalho: 1, voltas: 0 });
  });
});

describe('funil do quiz Monjour: segunda entrega (af_ropa e af_lunes entram, hace e despues saem)', () => {
  const B2 = Date.parse(QUIZ_BLOCO2_DESDE);
  const passoEm = (sid: string, passo: string, ms: number): EventoMonjour => ({
    session_id: sid, event_type: 'monjour_passo', created_at: new Date(ms).toISOString(),
    event_data: { lp: 'monjour', passo, ts: ms, pais: 'MX', disp: 'movil' },
  });
  /** Percorre as chaves, 10 s por tela, a partir de `inicio`. */
  const percurso = (sid: string, inicio: number, chaves: string[]): EventoMonjour[] =>
    chaves.map((k, i) => passoEm(sid, k, inicio + i * 10_000));
  const ATE_ZONA = ['inicio', 'edad', 'app', 'objetivo', 'cuerpo', 'zona'];
  const VELHO = [...ATE_ZONA, 'hace', 'inyecciones', 'noticia', 'probado', 'despues', 'culpa'];
  const NOVO = [...ATE_ZONA, 'af_ropa', 'inyecciones', 'noticia', 'probado', 'af_lunes', 'culpa'];

  const eventos = [...percurso('velho', B2 - 3600_000, VELHO), ...percurso('novo', B2 + 3600_000, NOVO)];
  const f = montarFunilMonjour(eventos, OP);
  const e = (k: string) => f.etapas.find((x) => x.chave === k)!;
  const de = (g: typeof f, k: string) => g.etapas.find((x) => x.chave === k)!;

  it('a ordem do trecho: zona, hace, af_ropa, inyecciones, noticia, probado, despues, af_lunes, culpa', () => {
    const chaves = f.etapas.map((x) => x.chave);
    const i = chaves.indexOf('zona');
    expect(chaves.slice(i, i + 9)).toEqual(['zona', 'hace', 'af_ropa', 'inyecciones', 'noticia', 'probado', 'despues', 'af_lunes', 'culpa']);
    expect(e('af_ropa')).toMatchObject({ rotulo: 'Afirmação: roupa', desde: QUIZ_BLOCO2_DESDE });
    expect(e('af_lunes')).toMatchObject({ rotulo: 'Afirmação: segunda-feira', desde: QUIZ_BLOCO2_DESDE });
    expect(e('hace')).toMatchObject({ ate: QUIZ_BLOCO2_DESDE });
    expect(e('despues').desde).toBeUndefined();
  });

  it('sessão antiga conta em hace e despues e não nas af_; a nova ao contrário', () => {
    const so = (id: string) => montarFunilMonjour(eventos.filter((x) => x.session_id === id), OP);
    const quatro = (g: typeof f) => ['hace', 'despues', 'af_ropa', 'af_lunes'].map((k) => de(g, k).chegaram);
    expect(quatro(so('velho'))).toEqual([1, 1, 0, 0]);
    expect(quatro(so('novo'))).toEqual([0, 0, 1, 1]);
    expect(quatro(f)).toEqual([1, 1, 1, 1]);
  });

  it('a passagem: zona → hace → inyecciones nas antigas e zona → af_ropa → inyecciones nas novas', () => {
    expect(e('zona').chegaram).toBe(2);
    expect(e('inyecciones').chegaram).toBe(2);
    expect(['zona', 'hace', 'af_ropa', 'despues', 'af_lunes'].map((k) => e(k).sairam)).toEqual([0, 0, 0, 0, 0]);
    // 10 s de cada tela para a próxima que existe para a sessão
    expect(['zona', 'hace', 'af_ropa', 'despues', 'af_lunes'].map((k) => e(k).medianaSegundos)).toEqual([10, 10, 10, 10, 10]);
  });

  it('quem para na etapa dela sai dela; a zona não perde nenhuma das duas', () => {
    const g = montarFunilMonjour([
      ...percurso('v', B2 - 3600_000, [...ATE_ZONA, 'hace']),
      ...percurso('n', B2 + 3600_000, [...ATE_ZONA, 'af_ropa']),
    ], OP);
    expect(['hace', 'af_ropa'].map((k) => [de(g, k).chegaram, de(g, k).sairam])).toEqual([[1, 1], [1, 1]]);
    expect(de(g, 'zona').sairam).toBe(0);
  });

  it('o limite exato: no instante do ate/desde já é sessão nova', () => {
    const noLimite = montarFunilMonjour(percurso('l', B2, [...ATE_ZONA, 'af_ropa', 'inyecciones']), OP);
    const antes = montarFunilMonjour(percurso('l', B2 - 1, [...ATE_ZONA, 'hace', 'inyecciones']), OP);
    expect(['af_ropa', 'hace'].map((k) => de(noLimite, k).chegaram)).toEqual([1, 0]);
    expect(['af_ropa', 'hace'].map((k) => de(antes, k).chegaram)).toEqual([0, 1]);
  });

  it('aplicaveis: período só de sessões novas não mostra hace/despues, e só de antigas não mostra as af_', () => {
    const so = (id: string) => montarFunilMonjour(eventos.filter((x) => x.session_id === id), OP);
    const ap = (g: typeof f, k: string) => de(g, k).aplicaveis;
    expect(['hace', 'af_ropa', 'af_lunes'].map((k) => ap(so('velho'), k))).toEqual([1, 0, 0]);
    expect(['hace', 'despues', 'af_ropa'].map((k) => ap(so('novo'), k))).toEqual([0, 0, 1]);
    expect([ap(f, 'hace'), ap(f, 'af_ropa')]).toEqual([1, 1]);
    expect(de(f, 'edad').aplicaveis).toBeUndefined(); // etapa de sempre não leva o campo
  });

  it('nenhuma porcentagem passa de 100, mesmo misturando sessões de épocas diferentes', () => {
    const g = montarFunilMonjour([
      ...eventos, ...percurso('v2', B2 - 7200_000, [...ATE_ZONA, 'hace']), ...percurso('n2', B2 + 7200_000, ['inicio', 'edad']),
      ...percurso('n3', B2 + 7300_000, NOVO),
    ], OP);
    for (const x of g.etapas) {
      expect(x.pctInicio).toBeLessThanOrEqual(100);
      expect(x.pctSaida).toBeLessThanOrEqual(100);
      expect(x.pctInicio).toBeGreaterThanOrEqual(0);
    }
    for (const r of g.respostas) for (const o of r.opcoes) expect(o.pct).toBeLessThanOrEqual(100);
  });

  it('respostas das afirmações: Sim, Não e Não sei', () => {
    const resp = (sid: string, passo: string, v: string, ms: number): EventoMonjour => ({
      session_id: sid, event_type: 'monjour_resp', created_at: new Date(ms).toISOString(), event_data: { passo, resp: v, ts: ms },
    });
    const g = montarFunilMonjour([
      ...percurso('r1', B2 + 3600_000, NOVO), resp('r1', 'af_ropa', 'si', B2 + 3_700_000), resp('r1', 'af_lunes', 'nose', B2 + 3_800_000),
      ...percurso('r2', B2 + 3600_000, NOVO), resp('r2', 'af_ropa', 'no', B2 + 3_700_000),
    ], OP);
    const ropa = g.respostas.find((r) => r.chave === 'af_ropa')!;
    expect(ropa.pergunta).toBe('Afirmação: roupa');
    expect(ropa.opcoes.map((o) => [o.valor, o.rotulo, o.sessoes])).toEqual([['si', 'Sim', 1], ['no', 'Não', 1], ['nose', 'Não sei', 0]]);
    const lunes = g.respostas.find((r) => r.chave === 'af_lunes')!;
    expect(lunes.opcoes.find((o) => o.valor === 'nose')).toMatchObject({ rotulo: 'Não sei', sessoes: 1, pct: 100 });
  });
});

describe('funil do quiz Monjour: página de venda (/plan/) fora do quiz', () => {
  const sinal = (sid: string, q: string, extra: Record<string, unknown> = {}, seg = 0): EventoMonjour =>
    ev(sid, 'monjour_sinal', { passo: 'venta', q, ...extra }, seg);
  const daPagina = (sid: string, ctx: Record<string, unknown> = {}): EventoMonjour[] => [
    sinal(sid, 'carga', { pais: 'MX', disp: 'movil', ...ctx }, 1), sinal(sid, 'planes', {}, 5), sinal(sid, 'compra', {}, 9),
    fim(sid, 'checkout', { plan: 'basico', origen: 'plan' }, 12),
  ];

  it('sessão só com checkout origen plan não aparece em nenhuma etapa, saída, recorte nem total do quiz', () => {
    const f = montarFunilMonjour(daPagina('p1'), OP);
    expect(f.totais.sessoes).toBe(0);
    expect(f.totais.checkouts).toBe(0);
    for (const e of f.etapas) { expect(e.chegaram).toBe(0); expect(e.sairam).toBe(0); }
    expect(f.recortes.pais).toEqual([]);
    expect(f.recortes.anuncio).toEqual([]);
    expect(f.filtros.paises).toEqual([]);
    expect(f.respostas.every((r) => r.opcoes.every((o) => o.sessoes === 0))).toBe(true);
  });

  it('a página não mexe nos números do quiz: com ou sem ela o funil é o mesmo', () => {
    const quiz = [
      ...viu('a', 29), fim('a', 'checkout', { plan: 'basico' }), fim('a', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd' }, 500),
      ...viu('b', 10), ...viu('c', 3),
    ];
    const sem = montarFunilMonjour(quiz, OP);
    const com = montarFunilMonjour([
      ...quiz, ...daPagina('p1'), ...daPagina('p2'), fim('p2', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd', origen: 'plan' }, 500),
    ], OP);
    const { paginaVenta: _a, ...semResto } = sem;
    const { paginaVenta: _b, ...comResto } = com;
    expect(comResto).toEqual(semResto);
    expect(com.totais).toMatchObject({ sessoes: 3, checkouts: 1, compras: 1, receitaCentavos: 1990 });
  });

  it('o webhook da compra com origen plan marca a sessão como da página, mesmo sem o clique do navegador no período', () => {
    const f = montarFunilMonjour([fim('p3', 'compra', { plan: 'plus', valor: 3990, moeda: 'usd', origen: 'plan' })], OP);
    expect(f.totais.compras).toBe(0);
    expect(f.paginaVenta.compras).toBe(1);
  });

  it('paginaVenta conta as 5 etapas por sessão distinta, repetir evento não soma', () => {
    const f = montarFunilMonjour([
      ...daPagina('p1'), sinal('p1', 'carga', {}, 20), sinal('p1', 'planes', {}, 21), fim('p1', 'checkout', { plan: 'plus', origen: 'plan' }, 30),
      ...daPagina('p2'), fim('p2', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd', origen: 'plan' }, 500),
      fim('p2', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd', origen: 'plan' }, 501),
      sinal('p3', 'carga', {}, 2), sinal('p3', 'planes', {}, 6),
      sinal('p4', 'carga', {}, 3),
    ], OP);
    expect(f.paginaVenta).toMatchObject({ visitas: 4, planes: 3, compra: 2, checkouts: 2, compras: 1 });
  });

  it('sinal sem passo venta não conta como visita da página', () => {
    const f = montarFunilMonjour([ev('q1', 'monjour_sinal', { passo: 'edad', q: 'carga' })], OP);
    expect(f.paginaVenta).toMatchObject({ visitas: 0, planes: 0, compra: 0, checkouts: 0, compras: 0 });
  });

  it('sessão sonda fica fora de paginaVenta', () => {
    const f = montarFunilMonjour([...daPagina('s1', { utm_source: 'sonda' }), ...daPagina('p1')], OP);
    expect(f.paginaVenta).toMatchObject({ visitas: 1, planes: 1, compra: 1, checkouts: 1, compras: 0 });
  });

  it('os filtros de país, aparelho, anúncio e conjunto valem para paginaVenta (mesmo contexto da sessão)', () => {
    const eventos = [
      ...daPagina('p1', { pais: 'MX', utm_content: ANUNCIO_IMG }),
      ...daPagina('p2', { pais: 'CO', utm_content: ANUNCIO_VID }),
      ...daPagina('p3', { pais: 'MX', disp: 'escritorio' }),
    ];
    const visitas = (filtros: Record<string, string>) => montarFunilMonjour(eventos, { ...OP, filtros }).paginaVenta.visitas;
    expect(visitas({})).toBe(3);
    expect(visitas({ pais: 'MX' })).toBe(2);
    expect(visitas({ anuncio: ANUNCIO_VID })).toBe(1);
    expect(visitas({ conjunto: CJ1 })).toBe(1);
    expect(visitas({ pais: 'MX', disp: 'movil' })).toBe(1);
  });

  describe('secoes e cliques da página (sinal saida)', () => {
    const saida = (sid: string, sec: unknown, cl: unknown, seg = 30, extra: Record<string, unknown> = {}): EventoMonjour =>
      sinal(sid, 'saida', { sec, cl, ...extra }, seg);
    const SECOES = ['v', 'h', 'q', 'c', 'a', 'x', 'r', 'p', 'g', 'f', 'z'];

    it('devolve todas as seções na ordem da página, com 0 para a que ninguém viu', () => {
      const f = montarFunilMonjour([saida('p1', 'h,q', '')], OP);
      expect(f.paginaVenta.secoes.map((x) => x.codigo)).toEqual(SECOES);
      expect(f.paginaVenta.secoes.find((x) => x.codigo === 'h')).toEqual({ codigo: 'h', nome: 'Topo (título e preço)', sessoes: 1 });
      expect(f.paginaVenta.secoes.find((x) => x.codigo === 'z')).toEqual({ codigo: 'z', nome: 'Cierre', sessoes: 0 });
      expect(montarFunilMonjour([], OP).paginaVenta.secoes.every((x) => x.sessoes === 0)).toBe(true);
      expect(montarFunilMonjour([], OP).paginaVenta.cliques).toEqual([]);
    });

    it('as saídas da mesma sessão se unem; cada sessão conta uma vez por seção', () => {
      const f = montarFunilMonjour([
        saida('p1', 'h,q', '', 30), saida('p1', 'h,q,c', '', 40), saida('p1', 'h,p', '', 50),
        saida('p2', 'h,c', ''),
      ], OP);
      const n = (c: string) => f.paginaVenta.secoes.find((x) => x.codigo === c)!.sessoes;
      expect([n('h'), n('q'), n('c'), n('p'), n('z')]).toEqual([2, 1, 2, 1, 0]);
    });

    it('cliques: maior valor por código na sessão (acumulado, não soma), total soma as sessões, ordem por sessoes', () => {
      const f = montarFunilMonjour([
        saida('p1', 'h', 'cta_heroi:1', 30), saida('p1', 'h', 'cta_heroi:2,faq3:2', 40), saida('p1', 'h', 'cta_heroi:2,faq3:2,plan_plus:1', 50),
        saida('p2', 'h', 'cta_heroi:1,plan_plus:3'),
        saida('p3', 'h', 'plan_plus:1'),
        saida('p4', 'h', 'faq3:1'),
      ], OP);
      expect(f.paginaVenta.cliques).toEqual([
        { codigo: 'cta_heroi', nome: 'Botão do topo', sessoes: 2, total: 3 },
        { codigo: 'plan_plus', nome: 'Quiero el plan Plus', sessoes: 3, total: 5 },
        { codigo: 'faq3', nome: 'Pergunta 3', sessoes: 2, total: 3 },
      ].sort((a, b) => b.sessoes - a.sessoes));
      expect(f.paginaVenta.cliques.map((x) => x.codigo)).toEqual(['plan_plus', 'cta_heroi', 'faq3']);
    });

    it('código fora da lista e valor malformado são ignorados sem quebrar a conta', () => {
      const f = montarFunilMonjour([
        saida('p1', 'h,w,,HOLA,q', 'cta_heroi:1,xyz:4,faq3:abc,faq4,:2,plan_basico:0,plan_plus:-1,legal:2:9,fechar:2'),
        saida('p2', 123, { a: 1 }),
        saida('p3', null, undefined),
      ], OP);
      expect(f.paginaVenta.secoes.filter((x) => x.sessoes > 0).map((x) => x.codigo)).toEqual(['h', 'q']);
      expect(f.paginaVenta.cliques).toEqual([
        { codigo: 'cta_heroi', nome: 'Botão do topo', sessoes: 1, total: 1 },
        { codigo: 'fechar', nome: 'Fechar a folha de compra', sessoes: 1, total: 2 },
      ]);
      expect(f.paginaVenta.visitas).toBe(0);
    });

    it('sessão sonda fica fora de secoes e cliques', () => {
      const f = montarFunilMonjour([saida('s1', 'h,q', 'cta_heroi:5', 30, { utm_source: 'sonda' }), saida('p1', 'h', 'cta_heroi:1')], OP);
      expect(f.paginaVenta.secoes.find((x) => x.codigo === 'h')!.sessoes).toBe(1);
      expect(f.paginaVenta.secoes.find((x) => x.codigo === 'q')!.sessoes).toBe(0);
      expect(f.paginaVenta.cliques).toEqual([{ codigo: 'cta_heroi', nome: 'Botão do topo', sessoes: 1, total: 1 }]);
    });

    it('os filtros valem para secoes e cliques; saída de quem comprou pela página também conta', () => {
      const eventos = [
        ...daPagina('p1', { pais: 'MX', utm_content: ANUNCIO_IMG }), saida('p1', 'h,q', 'cta_heroi:1'),
        ...daPagina('p2', { pais: 'CO', utm_content: ANUNCIO_VID }), saida('p2', 'h', 'cta_heroi:2,faq1:1'),
        ...daPagina('p3', { pais: 'MX', disp: 'escritorio' }), saida('p3', 'h,q,c', 'plan_basico:1'),
      ];
      const com = (filtros: Record<string, string>) => montarFunilMonjour(eventos, { ...OP, filtros }).paginaVenta;
      const sec = (p: ReturnType<typeof com>, c: string) => p.secoes.find((x) => x.codigo === c)!.sessoes;
      expect([sec(com({}), 'h'), sec(com({}), 'q'), sec(com({}), 'c')]).toEqual([3, 2, 1]);
      expect([sec(com({ pais: 'MX' }), 'h'), sec(com({ pais: 'MX' }), 'q')]).toEqual([2, 2]);
      expect(com({ anuncio: ANUNCIO_VID }).cliques).toEqual([
        { codigo: 'cta_heroi', nome: 'Botão do topo', sessoes: 1, total: 2 },
        { codigo: 'faq1', nome: 'Pergunta 1', sessoes: 1, total: 1 },
      ]);
      expect(com({ conjunto: CJ1 }).cliques.map((x) => x.codigo)).toEqual(['cta_heroi']);
      expect(com({ pais: 'MX', disp: 'movil' }).cliques).toEqual([{ codigo: 'cta_heroi', nome: 'Botão do topo', sessoes: 1, total: 1 }]);
    });
  });

  it('o upgrade e a receita dele continuam contando para quem comprou pela página', () => {
    const f = montarFunilMonjour([
      ...daPagina('p1'), fim('p1', 'compra', { plan: 'basico', valor: 1990, moeda: 'usd', origen: 'plan' }, 500),
      fim('p1', 'upgrade', { valor: 1000, moeda: 'usd' }, 900),
    ], OP);
    expect(f.totais.upgrades).toBe(1);
    expect(f.totais.receitaCentavos).toBe(1000);
    expect(f.paginaVenta.compras).toBe(1);
  });
});
