import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  campoDoLead, lerLead, classeDoLead, qualidadeDosLeads, resultadoDosCards, diaBRT, diasDoPeriodo,
  montarPorDia, montarPorAnuncio, idsDosAnuncios, respostaDoPainel, acrescentarSoGasto, SEM_ANUNCIO,
  type LeadLido, type CardQuiz, type PainelQuizSolar, type LinhaAnuncio,
} from '../services/io/painelQuizSolarPuro';
import { montarFunil, CONFIG_SOLAR, type EventoQuiz } from '../services/io/quizFunil';
import type { LinhaConjunto } from '../services/io/quizFunil';
import type { MetaAnuncio } from '../services/io/metaConjuntos';

const lead = (nota: number | null, caminho: string, anuncio = ''): LeadLido => ({ nota, caminho, anuncio });
const card = (status: string, utm_content: string | null = null, created_at = '2026-10-09T15:00:00Z'): CardQuiz =>
  ({ utm_term: null, utm_content, status, created_at });

describe('lendo o lead do quiz (field_data)', () => {
  const fd = [
    { name: 'Origem', values: ['Quiz Solar'] }, { name: 'Caminho', values: ['Vistoria'] },
    { name: 'Pontos', values: ['78'] }, { name: 'utm_content', values: ['120256657642860602'] },
  ];
  it('acha o campo pelo nome, sem ligar para a caixa', () => {
    expect(campoDoLead(fd, 'pontos')).toBe('78');
    expect(campoDoLead(fd, 'Caminho')).toBe('Vistoria');
    expect(campoDoLead(fd, 'nao_existe')).toBe('');
  });
  it('tolera jsonb que chega como texto e lixo', () => {
    expect(campoDoLead(JSON.stringify(fd), 'Pontos')).toBe('78');
    expect(campoDoLead('{quebrado', 'Pontos')).toBe('');
    expect(campoDoLead(null, 'Pontos')).toBe('');
    expect(campoDoLead([null, 3, { name: 'Pontos' }], 'Pontos')).toBe('');
  });
  it('lerLead: nota numérica, caminho em minúsculas, anúncio', () => {
    expect(lerLead({ field_data: fd })).toEqual({ nota: 78, caminho: 'vistoria', anuncio: '120256657642860602' });
    expect(lerLead({ field_data: [] })).toEqual({ nota: null, caminho: '', anuncio: '' });
    expect(lerLead({ field_data: [{ name: 'Pontos', values: ['abc'] }] }).nota).toBeNull();
  });
});

describe('qualidade dos leads', () => {
  it('faixas exclusivas, curioso primeiro: 80 quente, 40 a 79 morno, abaixo de 40 ou porta curioso', () => {
    expect(classeDoLead(lead(80, 'vistoria'))).toBe('quente');
    expect(classeDoLead(lead(79, 'video'))).toBe('morno');
    expect(classeDoLead(lead(40, 'ligacao'))).toBe('morno');
    expect(classeDoLead(lead(39, 'ligacao'))).toBe('curioso');
    expect(classeDoLead(lead(95, 'curioso'))).toBe('curioso');   // porta manda mais que a nota
    expect(classeDoLead(lead(null, 'curioso'))).toBe('curioso');
    expect(classeDoLead(lead(null, 'vistoria'))).toBeNull();
  });
  it('conta total, nota média só de quem tem nota, e as portas', () => {
    const q = qualidadeDosLeads([
      lead(90, 'vistoria'), lead(70, 'video'), lead(60, 'ligacao'), lead(20, 'curioso'), lead(null, 'ligacao'),
    ]);
    expect(q).toEqual({
      total: 5, comNota: 4, notaMedia: 60, quentes: 1, mornos: 2, curiosos: 1,
      porCaminho: { vistoria: 1, video: 1, ligacao: 2, curioso: 1 },
    });
    expect(q.quentes + q.mornos + q.curiosos).toBeLessThanOrEqual(q.total);
  });
  it('sem lead: zeros, nota média null e as quatro portas presentes', () => {
    expect(qualidadeDosLeads([])).toEqual({
      total: 0, comNota: 0, notaMedia: null, quentes: 0, mornos: 0, curiosos: 0,
      porCaminho: { vistoria: 0, video: 0, ligacao: 0, curioso: 0 },
    });
  });
});

describe('resultado dos cards', () => {
  it('cancelado não conta; agendados é a soma dos cinco; o resto vira em aberto', () => {
    const r = resultadoDosCards([
      card('agendado'), card('agendado'), card('arrendamento'), card('chave_na_mao'),
      card('fez_orcamento'), card('proposta_apresentada'), card('fechou'),
      card('sem_interesse'), card('sem_interesse'), card('nao_atendeu'), card('cancelado'),
    ]);
    expect(r).toEqual({ agendados: 10, orcamentos: 2, vendidos: 1, semInteresse: 2, naoAtendeu: 1, emAberto: 4 });
    expect(r.orcamentos + r.vendidos + r.semInteresse + r.naoAtendeu + r.emAberto).toBe(r.agendados);
  });
  it('status vazio conta como em aberto', () => {
    expect(resultadoDosCards([{ utm_term: null, status: null }]).emAberto).toBe(1);
  });
});

describe('dias de Brasília', () => {
  it('02:30 UTC ainda é o dia anterior em Brasília', () => {
    expect(diaBRT('2026-10-10T02:30:00Z')).toBe('2026-10-09');
    expect(diaBRT('2026-10-10T03:00:00Z')).toBe('2026-10-10');
    expect(diaBRT('lixo')).toBe('');
    expect(diaBRT(null)).toBe('');
  });
  it('lista os dias, atravessa a virada de mês e corta nos últimos 31', () => {
    expect(diasDoPeriodo('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    const muitos = diasDoPeriodo('2026-07-21', '2026-10-10');
    expect(muitos).toHaveLength(31);
    expect(muitos[30]).toBe('2026-10-10');
    expect(muitos[0]).toBe('2026-09-10');
  });
});

describe('por dia', () => {
  const ev = (s: string, tipo: string, d: Record<string, unknown>, quando: string): EventoQuiz =>
    ({ session_id: s, event_type: tipo, event_data: { lp: 'solar', pl: 1, seq: 1, ...d }, created_at: quando });
  const dias = diasDoPeriodo('2026-10-08', '2026-10-10');

  const visitas = [
    { session_id: 'a', landing_url: 'https://solardoc.app/io/solar?x=1', created_at: '2026-10-09T14:00:00Z' },
    { session_id: 'a', landing_url: 'https://solardoc.app/io/solar', created_at: '2026-10-10T14:00:00Z' },   // recarregou: conta uma vez
    { session_id: 'b', landing_url: 'https://solardoc.app/io/solar', created_at: '2026-10-10T02:30:00Z' },   // ainda dia 09 em Brasília
    { session_id: 'c', landing_url: 'https://solardoc.app/io/solar/simulador', created_at: '2026-10-09T14:00:00Z' },
    { session_id: 'd', landing_url: 'https://solardoc.app/io/solar', created_at: '2026-09-01T14:00:00Z' },   // fora da janela
  ];
  const eventos: EventoQuiz[] = [
    ev('a', 'quiz_passo', { passo: 'conta' }, '2026-10-09T14:01:00Z'),
    ev('a', 'quiz_fim', { destino: 'vistoria' }, '2026-10-10T02:30:00Z'),
    ev('b', 'quiz_passo', { passo: 'conta' }, '2026-10-10T14:01:00Z'),
    ev('b', 'quiz_fim', { destino: 'video' }, '2026-10-10T14:05:00Z'),
    ev('e', 'quiz_fim', { destino: 'vistoria' }, '2026-10-10T14:05:00Z'),   // fim sem pergunta: não conta (como no funil)
    { session_id: 'f', event_type: 'quiz_passo', event_data: { lp: 'eletroposto', passo: 'p-porta' }, created_at: '2026-10-10T14:00:00Z' },
    { session_id: 'f', event_type: 'quiz_fim', event_data: { lp: 'eletroposto', destino: 'x' }, created_at: '2026-10-10T14:05:00Z' },
  ];

  it('um item por dia, com zero nos dias sem movimento, e o fuso de Brasília', () => {
    const d = montarPorDia(dias, visitas, eventos, [
      card('agendado', null, '2026-10-10T02:30:00Z'), card('agendado', null, '2026-10-10T20:00:00Z'), card('cancelado', null, '2026-10-10T20:00:00Z'),
    ]);
    expect(d).toEqual([
      { dia: '2026-10-08', visitas: 0, terminaram: 0, agendados: 0 },
      { dia: '2026-10-09', visitas: 2, terminaram: 1, agendados: 1 },
      { dia: '2026-10-10', visitas: 0, terminaram: 1, agendados: 1 },
    ]);
  });
  it('a soma dos dias bate com o funil quando o período cabe na janela', () => {
    const dentro = visitas.filter((v) => v.session_id !== 'd');
    const funil = montarFunil(eventos, dentro, { config: CONFIG_SOLAR });
    const d = montarPorDia(dias, dentro, eventos, []);
    expect(d.reduce((s, x) => s + x.visitas, 0)).toBe(funil.visitas);
    expect(d.reduce((s, x) => s + x.terminaram, 0)).toBe(funil.terminaram);
  });
  it('visita sem data não vira dia', () => {
    const d = montarPorDia(dias, [{ session_id: 'z', landing_url: 'https://solardoc.app/io/solar' }], [], []);
    expect(d.every((x) => x.visitas === 0)).toBe(true);
  });
});

describe('por anúncio', () => {
  const A = '120256657642860602', B = '120256657642860603', C = '120256657642860604';
  const meta = new Map<string, MetaAnuncio>([
    [A, { id: A, nome: '6 Video 4.9 avaliacao', status: 'ACTIVE', gasto: 82.5 }],
    [B, { id: B, nome: 'Foto antiga', status: 'PAUSED', gasto: 10 }],
  ]);
  const leads = [lead(90, 'vistoria', A), lead(60, 'video', A), lead(20, 'curioso', B), lead(50, 'ligacao', ''), lead(70, 'ligacao', C)];
  const cards = [card('agendado', A), card('fechou', A), card('agendado', B), card('cancelado', B), card('agendado', null)];

  it('junta leads e cards pelo utm_content, ordena e calcula o custo por agendado', () => {
    const r = montarPorAnuncio(leads, cards, meta, true);
    // agendados primeiro, depois leads; empate (1 agendado) fica pela ordem de chegada
    expect(r.map((x) => x.id)).toEqual([A, B, '', C]);
    expect(r[0]).toEqual({
      id: A, nome: '6 Video 4.9 avaliacao', situacao: 'ACTIVE', leads: 2, agendados: 2, notaMedia: 75, quentes: 1,
      gasto: 82.5, custoPorAgendado: 41.25,
    });
    expect(r[1]).toMatchObject({ nome: 'Foto antiga', agendados: 1, leads: 1, custoPorAgendado: 10 });   // o cancelado não conta
    expect(r[2]).toMatchObject({ nome: SEM_ANUNCIO, leads: 1, agendados: 1, gasto: 0, custoPorAgendado: 0 });
    // Anúncio que a Meta não conhece: id no lugar do nome, gasto 0 (a Meta respondeu), sem custo (nenhum agendado).
    expect(r[3]).toMatchObject({ nome: C, situacao: '', gasto: 0, agendados: 0, custoPorAgendado: null });
  });
  it('Meta fora do ar: gasto e custo viram null, nunca zero', () => {
    const r = montarPorAnuncio(leads, cards, new Map(), false);
    expect(r[0]).toMatchObject({ id: A, nome: A, gasto: null, custoPorAgendado: null, agendados: 2 });
  });
  it('a soma dos agendados por anúncio é o total do resultado', () => {
    const r = montarPorAnuncio(leads, cards, meta, true);
    expect(r.reduce((s, x) => s + x.agendados, 0)).toBe(resultadoDosCards(cards).agendados);
  });
  it('idsDosAnuncios: o que mais agenda primeiro, sem o vazio', () => {
    expect(idsDosAnuncios(leads, cards)).toEqual([A, B, C]);
  });
});

describe('o corte do gasto', () => {
  const A = '120256657642860602';
  const painel = (): PainelQuizSolar => ({
    periodo: '7dias', desde: '2026-10-03T15:00:00.000Z', ate: null,
    funil: montarFunil([], [], { config: CONFIG_SOLAR }),
    leads: qualidadeDosLeads([]), resultado: resultadoDosCards([]), porDia: [],
    porAnuncio: [{ id: A, nome: 'x', situacao: 'ACTIVE', leads: 1, agendados: 1, notaMedia: 60, quentes: 0, gasto: 80, custoPorAgendado: 80 }],
    porConjunto: [{
      id: '1', nome: 'c', status: 'ACTIVE', gasto: 50, visitas: 4, abriram_quiz: 3, reunioes: 2, investidores: 0, pontos: 0,
      parceiros: 0, fichas: 0, custo_reuniao: 25, custo_resultado: 25, negocio: 0, arrendamento: 0, perdidas: 0, pior: null,
    }],
    meta_ok: false, meta_motivo: 'Meta 500',
  });
  const chaves = (o: unknown, achadas: string[] = []): string[] => {
    if (Array.isArray(o)) o.forEach((x) => chaves(x, achadas));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { achadas.push(k); chaves(v, achadas); }
    return achadas;
  };

  it('sócio recebe tudo; consultor não recebe nenhuma chave de gasto ou custo, em lugar nenhum', () => {
    const socio = respostaDoPainel(painel(), true);
    expect(socio.verGasto).toBe(true);
    expect(chaves(socio)).toEqual(expect.arrayContaining(['gasto', 'custoPorAgendado', 'custo_reuniao', 'custo_resultado']));
    const consultor = respostaDoPainel(painel(), false);
    expect(consultor.verGasto).toBe(false);
    expect(chaves(consultor).filter((k) => k !== 'verGasto' && /gasto|custo|spend/i.test(k))).toEqual([]);
    // Contagem continua para todos.
    expect(consultor.porAnuncio[0]).toMatchObject({ leads: 1, agendados: 1, notaMedia: 60 });
    expect(consultor.porConjunto[0]).toMatchObject({ reunioes: 2, visitas: 4 });
  });
  it('não altera o objeto de origem (ele mora em cache), em qualquer ordem', () => {
    const p = painel();
    respostaDoPainel(p, false);
    expect(p.porAnuncio[0].gasto).toBe(80);
    expect(p.porConjunto[0].custo_reuniao).toBe(25);
    expect((respostaDoPainel(p, true).porAnuncio[0] as { gasto: number }).gasto).toBe(80);
    expect(chaves(respostaDoPainel(p, false)).filter((k) => k !== 'verGasto' && /gasto|custo/i.test(k))).toEqual([]);
  });
  it('o motivo técnico da Meta é só do sócio', () => {
    expect(respostaDoPainel(painel(), true).meta_motivo).toBe('Meta 500');
    expect(respostaDoPainel(painel(), false).meta_motivo).toBeNull();
    expect(respostaDoPainel(painel(), false).meta_ok).toBe(false);
  });
});

describe('buscarAnunciosMeta', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
  const A = '120256657642860602', B = '120256657642860603', CJ = '120256657642860111';
  // O token é lido quando o módulo carrega: ambiente primeiro, import depois.
  async function carregar(token: string) {
    vi.resetModules();
    vi.stubEnv('META_SYSTEM_USER_TOKEN', token);
    vi.stubEnv('META_PIXEL_TOKEN', '');
    return import('../services/io/metaConjuntos');
  }

  it('sem token: ok false, sem chamar a rede', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const { buscarAnunciosMeta } = await carregar('');
    const r = await buscarAnunciosMeta([A], '2026-10-03', '2026-10-10');
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('lê nome, situação e gasto por GET e descarta id que não é de anúncio', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      urls.push(String(url));
      expect(init?.method || 'GET').toBe('GET');
      if (String(url).includes('/insights')) return new Response(JSON.stringify({ data: [{ ad_id: A, spend: '82.50' }] }), { status: 200 });
      return new Response(JSON.stringify({
        [A]: { name: 'Anúncio A', effective_status: 'ACTIVE', adset_id: CJ }, [B]: { name: 'Anúncio B', effective_status: 'PAUSED', adset_id: CJ },
      }), { status: 200 });
    }));
    const { buscarAnunciosMeta } = await carregar('tk-teste');
    const r = await buscarAnunciosMeta([A, B, '(sem)', ''], '2026-10-03', '2026-10-10');
    expect(r.ok).toBe(true);
    expect(r.anuncios.get(A)).toEqual({ id: A, nome: 'Anúncio A', status: 'ACTIVE', gasto: 82.5 });
    expect(r.anuncios.get(B)?.gasto).toBe(0);   // não aparece no insights: não gastou
    expect(urls[0]).toContain(`ids=${A},${B}`);
    expect(urls[0]).not.toContain('sem');
    expect(urls[1]).toContain('level=ad');
  });
  it('lote falho é refeito um a um', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/insights')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (u.includes('ids=')) return new Response(JSON.stringify({ error: { message: 'bad id' } }), { status: 400 });
      if (u.includes(`/${A}?`)) return new Response(JSON.stringify({ name: 'Só o A', effective_status: 'ACTIVE', adset_id: CJ }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 });
    }));
    const { buscarAnunciosMeta } = await carregar('tk-teste');
    const r = await buscarAnunciosMeta([A, B], '2026-10-03', '2026-10-10');
    expect(r.ok).toBe(true);
    expect([...r.anuncios.keys()]).toEqual([A]);
  });
  it('Meta fora do ar: ok false, motivo curto sem o token, gasto null, não lança', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/insights')) throw new Error('rede caiu');
      return new Response(JSON.stringify({ [A]: { name: 'Anúncio A', effective_status: 'ACTIVE', adset_id: CJ } }), { status: 200 });
    }));
    const { buscarAnunciosMeta } = await carregar('tk-teste');
    const r = await buscarAnunciosMeta([A], '2026-10-03', '2026-10-10');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('rede caiu');
    expect(r.motivo).not.toContain('tk-teste');
    expect(r.anuncios.get(A)?.gasto).toBeNull();
  });
  it('id que é conjunto, campanha ou lixo (sem adset_id) não vira anúncio nem ganha gasto', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/insights')) return new Response(JSON.stringify({ data: [{ ad_id: A, spend: '7' }, { ad_id: B, spend: '999' }] }), { status: 200 });
      return new Response(JSON.stringify({
        [A]: { name: 'Anúncio A', effective_status: 'ACTIVE', adset_id: CJ },
        [B]: { name: 'Conjunto disfarçado', effective_status: 'ACTIVE' },   // objeto de conjunto: sem adset_id
      }), { status: 200 });
    }));
    const { buscarAnunciosMeta } = await carregar('tk-teste');
    const r = await buscarAnunciosMeta([A, B], '2026-10-03', '2026-10-10');
    expect([...r.anuncios.keys()]).toEqual([A]);
    expect(r.anuncios.get(A)?.gasto).toBe(7);
    // Na junção, o id rejeitado vira linha sem nome e sem gasto (nada de gasto de conjunto).
    const linhas = montarPorAnuncio([lead(50, 'video', B)], [], r.anuncios, r.ok);
    expect(linhas[0]).toMatchObject({ id: B, nome: B, situacao: '', gasto: 0 });
  });
  it('pede o campo adset_id à Meta', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }));
    const { buscarAnunciosMeta } = await carregar('tk-teste');
    await buscarAnunciosMeta([A], '2026-10-03', '2026-10-10');
    expect(urls[0]).toContain('adset_id');
  });
});

describe('buscarAnunciosComGastoMeta', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
  const CJ1 = '120256657642860111', CJ2 = '120256657642860222';
  async function carregar(token: string) {
    vi.resetModules();
    vi.stubEnv('META_SYSTEM_USER_TOKEN', token);
    vi.stubEnv('META_PIXEL_TOKEN', '');
    return import('../services/io/metaConjuntos');
  }
  it('sem token: ok false, sem rede', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const { buscarAnunciosComGastoMeta } = await carregar('');
    expect((await buscarAnunciosComGastoMeta([CJ1], '2026-10-03', '2026-10-10')).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('uma chamada por conjunto, no máximo 5, só GET, só anúncio que gastou', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url); urls.push(u);
      expect(init?.method || 'GET').toBe('GET');
      if (u.includes(`/${CJ1}/insights`)) return new Response(JSON.stringify({ data: [{ ad_id: '120256657642860701', ad_name: 'Gastou e não trouxe', spend: '40' }, { ad_id: '120256657642860702', ad_name: 'Zerado', spend: '0' }] }), { status: 200 });
      if (u.includes('/insights')) return new Response(JSON.stringify({ data: [{ ad_id: '120256657642860703', ad_name: 'Outro', spend: '15.5' }] }), { status: 200 });
      return new Response(JSON.stringify({ '120256657642860701': { effective_status: 'PAUSED' } }), { status: 200 });
    }));
    const { buscarAnunciosComGastoMeta } = await carregar('tk-teste');
    const ids = [CJ1, CJ2, '120256657642860333', '120256657642860444', '120256657642860555', '120256657642860666', '(sem)'];
    const r = await buscarAnunciosComGastoMeta(ids, '2026-10-03', '2026-10-10');
    expect(r.ok).toBe(true);
    expect(urls.filter((u) => u.includes('/insights'))).toHaveLength(5);
    expect(urls.filter((u) => u.includes('/insights')).every((u) => u.includes('level=ad'))).toBe(true);
    expect(r.anuncios.get('120256657642860701')).toEqual({ id: '120256657642860701', nome: 'Gastou e não trouxe', status: 'PAUSED', gasto: 40 });
    expect(r.anuncios.has('120256657642860702')).toBe(false);
    expect(r.anuncios.get('120256657642860703')?.gasto).toBe(15.5);
  });
  it('um conjunto que falha não derruba os outros: ok false, o resto vem', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes(`/${CJ1}/insights`)) throw new Error('rede caiu');
      if (u.includes('/insights')) return new Response(JSON.stringify({ data: [{ ad_id: '120256657642860703', ad_name: 'Outro', spend: '9' }] }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'sem status' } }), { status: 400 });
    }));
    const { buscarAnunciosComGastoMeta } = await carregar('tk-teste');
    const r = await buscarAnunciosComGastoMeta([CJ1, CJ2], '2026-10-03', '2026-10-10');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('rede caiu');
    expect(r.motivo).not.toContain('tk-teste');
    expect([...r.anuncios.keys()]).toEqual(['120256657642860703']);
    expect(r.anuncios.get('120256657642860703')?.status).toBe('');   // status é melhor esforço
  });
});

describe('anúncio que gastou e não trouxe nada', () => {
  const base: LinhaAnuncio = { id: '1', nome: 'com resultado', situacao: 'ACTIVE', leads: 2, agendados: 1, notaMedia: 70, quentes: 1, gasto: 20, custoPorAgendado: 20 };
  const extras = new Map<string, MetaAnuncio>([
    ['1', { id: '1', nome: 'repetido', status: '', gasto: 999 }],
    ['2', { id: '2', nome: 'gastou pouco', status: 'ACTIVE', gasto: 5 }],
    ['3', { id: '3', nome: 'gastou muito', status: 'PAUSED', gasto: 120 }],
    ['4', { id: '4', nome: 'zerado', status: '', gasto: 0 }],
  ]);
  const painel = (): PainelQuizSolar => ({
    periodo: '7dias', desde: 'x', ate: null, funil: montarFunil([], [], { config: CONFIG_SOLAR }),
    leads: qualidadeDosLeads([]), resultado: resultadoDosCards([]), porDia: [],
    porAnuncio: acrescentarSoGasto([base], extras), porConjunto: [], meta_ok: true, meta_motivo: null,
  });
  it('entram depois dos que têm resultado, do maior gasto ao menor, sem repetir nem pegar gasto zero', () => {
    const l = acrescentarSoGasto([base], extras);
    expect(l.map((x) => x.id)).toEqual(['1', '3', '2']);
    expect(l[1]).toEqual({ id: '3', nome: 'gastou muito', situacao: 'PAUSED', leads: 0, agendados: 0, notaMedia: null, quentes: 0, gasto: 120, custoPorAgendado: null });
    expect(l[0].gasto).toBe(20);   // o repetido não sobrescreve
  });
  it('sócio vê as linhas; consultor comum não vê nenhuma (a presença revela gasto)', () => {
    expect(respostaDoPainel(painel(), true).porAnuncio.map((x) => x.id)).toEqual(['1', '3', '2']);
    const c = respostaDoPainel(painel(), false);
    expect(c.porAnuncio.map((x) => x.id)).toEqual(['1']);
    expect(JSON.stringify(c)).not.toMatch(/gastou muito|gastou pouco/);
  });
});

describe('conjuntos do consultor comum: sem ranking de verba', () => {
  const cj = (id: string, gasto: number, visitas: number, reunioes: number): LinhaConjunto => ({
    id, nome: 'c' + id, status: 'ACTIVE', gasto, visitas, abriram_quiz: visitas, reunioes, investidores: 0, pontos: 0,
    parceiros: 0, fichas: 0, custo_reuniao: reunioes ? gasto / reunioes : null, custo_resultado: reunioes ? gasto / reunioes : null,
    negocio: 0, arrendamento: 0, perdidas: 0, pior: null,
  });
  // Na ordem do montarConjuntos: por gasto. X só tem gasto; Z gastou mais que Y mas rendeu mais.
  const lista = [cj('X', 300, 0, 0), cj('Z', 90, 2, 3), cj('Y', 10, 5, 1), cj('W', 5, 5, 1)];
  const painel = (): PainelQuizSolar => ({
    periodo: '7dias', desde: 'x', ate: null, funil: montarFunil([], [], { config: CONFIG_SOLAR }),
    leads: qualidadeDosLeads([]), resultado: resultadoDosCards([]), porDia: [], porAnuncio: [], porConjunto: lista,
    meta_ok: true, meta_motivo: null,
  });
  it('sócio: a lista como veio, inclusive o conjunto que só tem gasto', () => {
    expect(respostaDoPainel(painel(), true).porConjunto.map((c) => c.id)).toEqual(['X', 'Z', 'Y', 'W']);
  });
  it('consultor: sem o conjunto que só gastou, ordenado por reuniões, depois visitas, depois id', () => {
    const r = respostaDoPainel(painel(), false).porConjunto;
    expect(r.map((c) => c.id)).toEqual(['Z', 'W', 'Y']);   // W e Y empatam em reuniões e visitas: id
    expect(r.some((c) => c.id === 'X')).toBe(false);
  });
  it('não mexe na lista de origem', () => {
    const p = painel(); respostaDoPainel(p, false);
    expect(p.porConjunto.map((c) => c.id)).toEqual(['X', 'Z', 'Y', 'W']);
  });
});
