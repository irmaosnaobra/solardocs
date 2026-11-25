import { describe, it, expect } from 'vitest';
import { montarFunilDominaia, medianaDe } from '../services/dominaia/funilDominaiaPuro';
import { montarJornada, itemDaSessao } from '../services/dominaia/sessoesQuizDominaia';
import { agruparSessoes } from '../services/dominaia/sessoesDominaia';
import {
  TELAS_DOMINAIA, ETAPAS_DEPOIS, PERGUNTAS_DOMINAIA, ETAPA_OFERTA, ETAPA_CHECKOUT, ETAPA_COMPRA, N_POR_CHAVE,
  conjuntoDoAnuncio, nomeDoAnuncio, nomeDoConjunto, chaveDaResposta, ACOES_APP_DOMINAIA, type EventoDominaia,
} from '../services/dominaia/dominaiaCatalogo';

// A conta do funil do quiz da Domina IA: eventos de exemplo entram, o FunilDominaia sai.

const BASE = Date.parse('2026-11-25T15:00:00.000Z'); // 12h em São Paulo
const AGORA = new Date('2026-11-25T18:00:00.000Z');
const OP = { periodo: '7dias', desde: '2026-11-24T03:00:00.000Z', ate: AGORA.toISOString(), agora: AGORA };

const AD_A = '120256102223900271'; // A - correo del jefe, CJ1
const AD_B = '120256102299300271'; // B - correos del proveedor, CJ2
const AD_V3 = '120256125677150271'; // V3 - la presentación, CJ3
const CJ1 = '120256102215990271';
const CJ2 = '120256102294610271';

let seq = 0;
/** Evento com ts do navegador = BASE + seg segundos (e o created_at igual). */
function ev(sid: string, tipo: string, d: Record<string, unknown>, seg = 0): EventoDominaia {
  seq += 1;
  const ms = BASE + seg * 1000;
  return { session_id: sid, event_type: tipo, created_at: new Date(ms).toISOString(), event_data: { lp: 'dominaia', v: 1, seq, ts: ms, ...d } };
}
const CHAVES = TELAS_DOMINAIA.map((t) => t.chave);

/** Sessão que viu as telas de 1 a ate (uma a cada `passo` segundos), com o contexto dado. */
function viu(sid: string, ate: number, ctx: Record<string, unknown> = {}, passo = 10): EventoDominaia[] {
  return Array.from({ length: ate }, (_, i) => ev(sid, 'dominaia_passo', { passo: CHAVES[i], n: i + 1, pais: 'MX', disp: 'movil', so: 'android', nav: 'chrome', ...ctx }, (i + 1) * passo));
}
const resp = (sid: string, passo: string, r: unknown, seg = 5) => ev(sid, 'dominaia_resp', { passo, resp: r }, seg);
const fim = (sid: string, destino: string, extra: Record<string, unknown> = {}, seg = 400) => ev(sid, 'dominaia_fim', { destino, ...extra }, seg);
const app = (sid: string, acao: string) => ev(sid, 'dominaia_app', { acao, m: 'abcdef0123456789' }, 900);

describe('catálogo da Domina IA', () => {
  it('as 32 telas do site, na ordem de telas.js, com n = posição e a oferta por último', () => {
    expect(TELAS_DOMINAIA).toHaveLength(32);
    expect(CHAVES.slice(0, 6)).toEqual(['inicio', 'edad', 'espejo_ia', 'objetivo', 'horas', 'ocupacion']);
    expect(CHAVES.slice(-4)).toEqual(['cargando', 'correo', 'resultado', 'oferta']);
    expect(TELAS_DOMINAIA.every((t, i) => t.n === i + 1)).toBe(true);
    expect(new Set(CHAVES).size).toBe(32);
    expect(ETAPA_OFERTA).toBe(32);
    expect([ETAPA_CHECKOUT, ETAPA_COMPRA]).toEqual([33, 34]);
    expect(ETAPAS_DEPOIS.map((e) => e.chave)).toEqual(['checkout', 'compra']);
  });

  it('não tem as telas meta, partida, app nem venta, e todo rótulo tem 1 a 3 palavras', () => {
    for (const c of ['meta', 'partida', 'app', 'venta']) expect(N_POR_CHAVE[c]).toBeUndefined();
    for (const t of TELAS_DOMINAIA) expect(t.rotulo.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it('respostas: só as que o site manda; cuenta e hoy15 são perguntas dentro do cargando; nome nunca', () => {
    const chaves = PERGUNTAS_DOMINAIA.map((p) => p.chave);
    for (const c of ['genero', 'edad', 'cuenta', 'hoy15', 'correo', 'herramientas']) expect(chaves).toContain(c);
    expect(chaves).not.toContain('nombre');
    expect(chaves).not.toContain('oferta'); // o site não manda dominaia_resp da oferta (o plano vai no checkout)
    expect(chaveDaResposta('cuenta')).toBe('cuenta');
    expect(chaveDaResposta('nombre')).toBeNull();
    expect(chaveDaResposta('cargando_picar')).toBeNull();
  });

  it('anúncios e conjuntos da campanha; anúncio fora da lista cai no utm_term quando ele é de um conjunto conhecido', () => {
    expect(nomeDoAnuncio(AD_A)).toBe('A - correo del jefe');
    expect(nomeDoAnuncio('120256103204930271')).toBe('B2');
    expect(conjuntoDoAnuncio('120256103204930271')).toBe(CJ2);
    expect(nomeDoConjunto(CJ1)).toBe('CJ1 - El jefe');
    expect(nomeDoConjunto('120256114832120271')).toBe('CJ3 - Mateo y don Beto');
    expect(conjuntoDoAnuncio('999')).toBe('desconhecido');
    expect(conjuntoDoAnuncio('999', CJ2)).toBe(CJ2);
    expect(conjuntoDoAnuncio('999', '888')).toBe('desconhecido');
    expect(conjuntoDoAnuncio('')).toBe('sem');
    expect(conjuntoDoAnuncio('', CJ2)).toBe('sem');
  });
});

describe('funil do quiz Domina IA: etapas e totais', () => {
  const eventos = [
    ...viu('a', 32), fim('a', 'checkout', { plan: 'basico' }), fim('a', 'compra', { valor: 990, moeda: 'usd', pais_cartao: 'MX' }, 500),
    ...viu('b', 32), fim('b', 'checkout', { plan: 'basico' }),
    ...viu('c', 32),
    ...viu('d', 10),
    ...viu('e', 5),
    ...viu('f', 1),
  ];
  const f = montarFunilDominaia(eventos, OP);

  it('o funil só desce, com as 34 etapas (32 telas, clicou em comprar e comprou)', () => {
    expect(f.etapas).toHaveLength(34);
    const chegaram = f.etapas.map((e) => e.chegaram);
    for (let i = 1; i < chegaram.length; i += 1) expect(chegaram[i]).toBeLessThanOrEqual(chegaram[i - 1]);
    expect([1, 5, 6, 10, 11, 32, 33, 34].map((n) => f.etapas[n - 1].chegaram)).toEqual([6, 5, 4, 4, 3, 3, 2, 1]);
  });

  it('saíram = chegaram menos o da etapa seguinte; a oferta e o clique fecham o funil', () => {
    expect(f.etapas[0].sairam).toBe(1); // f parou na abertura
    expect(f.etapas[ETAPA_OFERTA - 1].sairam).toBe(1); // c viu a oferta e não clicou
    expect(f.etapas[ETAPA_CHECKOUT - 1].sairam).toBe(1); // b clicou e não comprou
    expect(f.etapas[ETAPA_COMPRA - 1]).toMatchObject({ chegaram: 1, sairam: 0, medianaSegundos: null });
  });

  it('totais: só o plano básico, receita só da compra, sem plus nem upgrade', () => {
    expect(f.totais).toMatchObject({
      sessoes: 6, ofertas: 3, checkouts: 2, compras: 1, comprasBasico: 1, comprasPlus: 0, upgrades: 0,
      receitaCentavos: 990, ticketMedioCentavos: 990, atalho: 0, voltas: 0,
    });
    expect(f.totais.conversao).toBeCloseTo(0.1667, 4);
  });

  it('as chaves do contrato que não existem aqui saem zeradas, nunca removidas', () => {
    expect(f.saidas).toEqual({ finSeguridad: 0, partidaSemSaida: 0 });
    expect(f.paginaVenta).toEqual({ visitas: 0, planes: 0, compra: 0, checkouts: 0, compras: 0, secoes: [], cliques: [] });
    expect(Object.keys(f).sort()).toEqual([
      'app', 'ate', 'atualizadoEm', 'desde', 'etapas', 'filtros', 'inicioRastreio', 'paginaVenta', 'periodo', 'recortes', 'respostas', 'saidas', 'totais', 'truncado',
    ]);
  });

  it('a compra do webhook herda o plano do clique, mas conta como básica mesmo sem ele', () => {
    const sem = montarFunilDominaia([...viu('x', 3), fim('x', 'compra', { valor: 990, moeda: 'usd' })], OP);
    expect(sem.totais).toMatchObject({ compras: 1, comprasBasico: 1, comprasPlus: 0 });
  });

  it('webhook repetido não duplica; moeda que não é dólar não entra na receita; só compra do webhook não vira visitante', () => {
    const dup = montarFunilDominaia([...viu('x', 3), fim('x', 'compra', { valor: 990, moeda: 'usd' }), fim('x', 'compra', { valor: 990, moeda: 'usd' }, 600)], OP);
    expect(dup.totais).toMatchObject({ compras: 1, receitaCentavos: 990 });
    const brl = montarFunilDominaia([...viu('y', 3), fim('y', 'compra', { valor: 5000, moeda: 'brl' })], OP);
    expect(brl.totais).toMatchObject({ compras: 1, receitaCentavos: 0 });
    const so = montarFunilDominaia([fim('z', 'compra', { valor: 990, moeda: 'usd' })], OP);
    expect(so.totais).toMatchObject({ sessoes: 0, compras: 0, receitaCentavos: 0 });
  });

  it('não existe upgrade: um fim "upgrade" é ignorado', () => {
    const r = montarFunilDominaia([...viu('u', 3), fim('u', 'upgrade', { valor: 900, moeda: 'usd' })], OP);
    expect(r.totais).toMatchObject({ upgrades: 0, receitaCentavos: 0, compras: 0 });
  });
});

describe('funil do quiz Domina IA: tempo, atalho e volta', () => {
  it('mediana entre a primeira vista de n e a de n+1; acima de 30 min não conta', () => {
    const f = montarFunilDominaia([...viu('a', 3, {}, 10), ...viu('b', 3, {}, 20), ...viu('c', 3, {}, 4000)], OP);
    expect(f.etapas[0].medianaSegundos).toBe(15);
    expect(f.etapas[2].medianaSegundos).toBeNull();
    expect(medianaDe([])).toBeNull();
  });

  it('atalho e volta contam à parte e não inflam as perguntas do meio', () => {
    const passoSemN = (sid: string, passo: string, seg: number) => ev(sid, 'dominaia_passo', { passo, pais: 'MX' }, seg);
    const f = montarFunilDominaia([
      ...viu('n', 6),
      ...viu('a', 1), passoSemN('a', 'atalho_oferta', 30), ev('a', 'dominaia_passo', { passo: 'oferta', n: 32 }, 40),
      passoSemN('v', 'volta_oferta', 50), ev('v', 'dominaia_passo', { passo: 'oferta', n: 32 }, 55),
    ], OP);
    expect(f.totais).toMatchObject({ sessoes: 3, atalho: 1, voltas: 1, ofertas: 2 });
    expect(f.etapas[1].chegaram).toBe(1); // edad: só a normal
    expect(f.etapas[0].sairam).toBe(0); // a do atalho viu a abertura e seguiu, não saiu
    expect(f.etapas[ETAPA_OFERTA - 1].chegaram).toBe(2);
  });
});

describe('funil do quiz Domina IA: recortes e filtros', () => {
  const eventos = [
    ...viu('a', 4, { pais: 'MX', disp: 'movil', utm_content: AD_A, utm_term: CJ1 }),
    ...viu('b', 4, { pais: 'CO', disp: 'escritorio', utm_content: AD_B, utm_term: CJ2 }),
    ...viu('c', 4, { pais: 'MX', disp: 'movil', utm_content: '999', utm_term: CJ2 }), // anúncio fora da lista, conjunto pelo utm_term
    ...viu('d', 4, { pais: 'MX', disp: 'movil', utm_content: AD_V3 }),
    ...viu('e', 4, { pais: 'XX', disp: 'movil' }),
  ];
  const f = montarFunilDominaia(eventos, OP);

  it('anúncio e conjunto do catálogo; o utm_term resolve o anúncio desconhecido', () => {
    const nomes = Object.fromEntries(f.recortes.anuncio.map((l) => [l.chave, l.rotulo]));
    expect(nomes[AD_A]).toBe('A - correo del jefe');
    expect(nomes['999']).toBe('Anúncio 999');
    expect(nomes.sem).toMatch(/Sem anúncio/);
    const conj = Object.fromEntries(f.recortes.conjunto.map((l) => [l.rotulo, l.sessoes]));
    expect(conj).toEqual({ 'CJ1 - El jefe': 1, 'CJ2 - El proveedor': 2, 'CJ3 - Mateo y don Beto': 1, 'Sem anúncio (orgânico ou direto)': 1 });
    expect(f.filtros.anuncios.find((a) => a.id === '999')).toMatchObject({ conjunto: CJ2 });
  });

  it('país, aparelho e hora: nome em português, código desconhecido, 24 faixas', () => {
    expect(f.recortes.pais.find((l) => l.chave === 'MX')).toMatchObject({ rotulo: 'México', sessoes: 3 });
    expect(f.recortes.pais.find((l) => l.chave === 'XX')?.rotulo).toBe('XX');
    expect(f.recortes.aparelho.find((l) => l.chave === 'escritorio')?.rotulo).toBe('Computador');
    expect(f.recortes.hora).toHaveLength(24);
    expect(f.recortes.dia.map((l) => l.chave)).toEqual(['2026-11-25']);
  });

  it('os filtros valem pela sessão e as opções de filtro não encolhem', () => {
    const so = (filtros: Record<string, string>) => montarFunilDominaia(eventos, { ...OP, filtros });
    expect(so({ pais: 'mx' }).totais.sessoes).toBe(3);
    expect(so({ pais: 'MX', disp: 'movil' }).totais.sessoes).toBe(3);
    expect(so({ anuncio: AD_B }).totais.sessoes).toBe(1);
    expect(so({ anuncio: 'sem' }).totais.sessoes).toBe(1);
    expect(so({ conjunto: CJ2 }).totais.sessoes).toBe(2); // b e c (c pelo utm_term)
    expect(so({ conjunto: CJ1 }).filtros.paises).toEqual(f.filtros.paises);
  });

  it('sonda sai de tudo, inclusive o webhook sem utm', () => {
    const r = montarFunilDominaia([...viu('s', 3, { utm_source: 'SONDA' }), fim('s', 'compra', { valor: 990, moeda: 'usd' }), ...viu('ok', 3)], OP);
    expect(r.totais).toMatchObject({ sessoes: 1, compras: 0 });
  });

  it('o país e o aparelho vêm do navegador, nunca do webhook da compra', () => {
    const r = montarFunilDominaia([...viu('a', 3), fim('a', 'compra', { valor: 990, moeda: 'usd', pais_cartao: 'US', pais: 'ES', disp: 'tablet' })], OP);
    expect(r.recortes.pais.map((l) => l.chave)).toEqual(['MX']);
    expect(r.recortes.aparelho.map((l) => l.chave)).toEqual(['movil']);
  });
});

describe('funil do quiz Domina IA: respostas', () => {
  const eventos = [
    ...viu('a', 32), resp('a', 'edad', '25'), resp('a', 'frena', ['empezar', 'pedir']), resp('a', 'cuenta', 'no'), resp('a', 'correo', 'consent_si'),
    fim('a', 'checkout', { plan: 'basico' }), fim('a', 'compra', { valor: 990, moeda: 'usd' }, 500),
    ...viu('b', 4), resp('b', 'edad', '25'), resp('b', 'edad', '35'), resp('b', 'nombre', 'Maria'), resp('b', 'edad_x', 'lixo'), resp('b', 'ocupacion', 'texto-solto'),
  ];
  const f = montarFunilDominaia(eventos, OP);
  const pergunta = (c: string) => f.respostas.find((r) => r.chave === c)!;

  it('as perguntas aparecem mesmo sem resposta e a última resposta de cada sessão vale', () => {
    expect(f.respostas.map((r) => r.chave)).toEqual(PERGUNTAS_DOMINAIA.map((p) => p.chave));
    expect(pergunta('edad').opcoes.find((o) => o.valor === '25')).toMatchObject({ sessoes: 1, pct: 50, compras: 1, conversao: 1 });
    expect(pergunta('edad').opcoes.find((o) => o.valor === '35')).toMatchObject({ sessoes: 1, chegaramOferta: 0, compras: 0 });
    expect(pergunta('horas').opcoes.every((o) => o.sessoes === 0)).toBe(true);
  });

  it('múltipla: a sessão conta em cada opção marcada; cuenta e aceite de e-mail entram; lead = aceitou e-mail', () => {
    expect(pergunta('frena').opcoes.filter((o) => o.sessoes === 1).map((o) => o.valor)).toEqual(['empezar', 'pedir']);
    expect(pergunta('cuenta').opcoes.find((o) => o.valor === 'no')?.sessoes).toBe(1);
    expect(pergunta('correo').opcoes.find((o) => o.valor === 'consent_si')?.sessoes).toBe(1);
    expect(f.totais.leads).toBe(1);
  });

  it('nome nunca aparece; valor fora da lista aparece com o próprio texto', () => {
    expect(JSON.stringify(f.respostas)).not.toContain('Maria');
    expect(JSON.stringify(f.respostas)).not.toContain('lixo');
    expect(pergunta('ocupacion').opcoes.find((o) => o.valor === 'texto-solto')).toMatchObject({ sessoes: 1, rotulo: 'texto-solto' });
  });
});

describe('funil do quiz Domina IA: app (só as ações que o site emite)', () => {
  it('conta sessões distintas por ação; ação que o site não emite fica de fora; upgradeClicks é sempre 0', () => {
    const f = montarFunilDominaia([
      ...viu('a', 3), app('a', 'abriu'), app('a', 'abriu'), app('a', 'instalou'), app('a', 'leccion_hecha'),
      app('b', 'abriu'), app('b', 'prompt_copiado'), app('b', 'upgrade_click'), app('b', 'aba'),
    ], OP);
    expect(f.app).toMatchObject({ abriram: 2, instalaram: 1, upgradeClicks: 0 });
    expect(Object.keys(f.app.acoes)).toEqual([...ACOES_APP_DOMINAIA]);
    expect(f.app.acoes).toEqual({ abriu: 2, aba: 1, dia_visto: 0, leccion_vista: 0, prompt_copiado: 1, ejercicio_hecho: 0, leccion_hecha: 1, instalou: 1 });
    expect(f.totais.sessoes).toBe(1); // 'b' só abriu o app: não é visitante do quiz
  });

  it('as 8 ações do catálogo são exatamente as de ACOES_APP em lib/funil.js do site', () => {
    expect([...ACOES_APP_DOMINAIA].sort()).toEqual(['aba', 'dia_visto', 'ejercicio_hecho', 'instalou', 'leccion_hecha', 'leccion_vista', 'abriu', 'prompt_copiado'].sort());
  });
});

describe('funil do quiz Domina IA: período vazio e jornada', () => {
  it('zera tudo, mantém as 34 etapas e as perguntas', () => {
    const f = montarFunilDominaia([], { ...OP, inicioRastreio: null });
    expect(f.totais).toMatchObject({ sessoes: 0, compras: 0, receitaCentavos: 0, ticketMedioCentavos: 0, conversao: 0 });
    expect(f.etapas).toHaveLength(34);
    expect(f.recortes.pais).toEqual([]);
    expect(f.recortes.hora).toEqual([]);
    expect(f.respostas).toHaveLength(PERGUNTAS_DOMINAIA.length);
    expect(f.app.acoes.abriu).toBe(0);
  });

  it('a jornada rotula cuenta/hoy15 na tela cargando, genero na abertura e ignora o resto', () => {
    const linhas = montarJornada([
      ev('j', 'dominaia_passo', { passo: 'inicio', n: 1 }, 0), resp('j', 'genero', 'm', 3),
      ev('j', 'dominaia_passo', { passo: 'cargando', n: 29 }, 10), resp('j', 'hoy15', 'si', 12),
      ev('j', 'dominaia_sinal', { q: 'saida' }, 13), fim('j', 'checkout', {}, 20),
    ]);
    expect(linhas.map((l) => `${l.tipo}:${l.passo}:${l.n}`)).toEqual(['viu:inicio:1', 'respondeu:genero:1', 'viu:cargando:29', 'respondeu:hoy15:29', 'fim:checkout:33']);
    expect(linhas[1].resposta).toBe('Mujer');
  });

  it('o resumo da sessão: cuerpo vai vazio e o plano vem do clique', () => {
    const [s] = agruparSessoes([...viu('r', 4, { utm_content: AD_A }), resp('r', 'edad', '45'), fim('r', 'checkout', { plan: 'basico' })]);
    expect(itemDaSessao(s)).toMatchObject({ sid: 'r', idade: '45 o más', cuerpo: '', plano: 'basico', clicouComprar: true, comprou: false, maxPasso: 32 });
  });
});
