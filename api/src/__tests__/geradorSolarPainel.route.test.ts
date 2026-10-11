import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// GET /gerador/solar/painel, com login, banco e Meta simulados. O que se prova:
// quem vê gasto, que a chave de dinheiro nem existe para consultor (nem no cache),
// que Meta fora do ar não derruba, que o cache poupa o banco e que período
// inválido cai em 7 dias.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  eventos: [] as unknown[], visitas: [] as unknown[], cards: [] as unknown[], leads: [] as unknown[],
  leituras: 0,
  bancoFora: false,
  metaFora: false,
  chamadasMeta: 0,
  periodosPedidos: [] as string[],
  conjuntoSoGasto: false,
  chamadasSoGasto: [] as string[][],
}));

/** Query builder falso: ignora filtros, devolve a tabela e respeita o range. */
function consulta(linhas: () => unknown[]) {
  const q: any = {
    select: () => q, in: () => q, gte: (_c: string, v: string) => { h.periodosPedidos.push(v); return q; },
    lt: () => q, ilike: () => q, like: () => q, eq: () => q, order: () => q,
    range: (de: number, ate: number) => {
      h.leituras++;
      if (h.bancoFora) return Promise.resolve({ data: null, error: { message: 'connection refused postgres://user:segredo@db' } });
      return Promise.resolve({ data: linhas().slice(de, ate + 1), error: null });
    },
  };
  return q;
}

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t === 'lp_events') return consulta(() => h.eventos);
      if (t === 'page_visits') return consulta(() => h.visitas);
      throw new Error(`tabela inesperada: ${t}`);
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: (t: string) => {
      if (t === 'agendamentos') return consulta(() => h.cards);
      if (t === 'leads_meta') return consulta(() => h.leads);
      throw new Error(`tabela inesperada: ${t}`);
    },
  },
}));
vi.mock('../services/io/metaConjuntos', async (orig) => {
  const real = await orig<typeof import('../services/io/metaConjuntos')>();
  return {
    ...real,
    buscarConjuntosMeta: vi.fn(async (ids: string[]) => {
      h.chamadasMeta++;
      if (h.metaFora) return { ok: false, motivo: 'Meta 500 com detalhe interno', conjuntos: new Map() };
      const mapa = new Map(ids.filter((i) => /^\d{10,20}$/.test(i)).map((id) => [id, { id, nome: 'Conjunto A', status: 'ACTIVE', gasto: 50 }]));
      // Conjunto que gastou e não trouxe visita nem reunião: só existe por causa do gasto.
      if (h.conjuntoSoGasto) mapa.set('120256657642860999', { id: '120256657642860999', nome: 'Conjunto só gasto', status: 'ACTIVE', gasto: 200 });
      return { ok: true, conjuntos: mapa };
    }),
    buscarAnunciosComGastoMeta: vi.fn(async (ids: string[]) => {
      h.chamadasSoGasto.push(ids);
      if (h.metaFora) return { ok: false, motivo: 'Meta 500 com detalhe interno', anuncios: new Map() };
      return {
        ok: true,
        anuncios: new Map(h.conjuntoSoGasto ? [['120256657642860888', { id: '120256657642860888', nome: 'Gastou e sumiu', status: 'PAUSED', gasto: 33 }]] : []),
      };
    }),
    buscarAnunciosMeta: vi.fn(async (ids: string[]) => {
      if (h.metaFora) return { ok: false, motivo: 'Meta 500 com detalhe interno', anuncios: new Map() };
      const nomes: Record<string, [string, string, number]> = {
        '120256657642860602': ['6 Video 4.9 avaliacao', 'ACTIVE', 82.5],
        '120256657642860603': ['Foto antiga', 'PAUSED', 10],
      };
      return {
        ok: true,
        anuncios: new Map(ids.filter((i) => nomes[i]).map((id) => [id, { id, nome: nomes[id][0], status: nomes[id][1], gasto: nomes[id][2] }])),
      };
    }),
  };
});

import { mountSolar, limparCachesSolar } from '../routes/geradorSolar';
import { CAMINHOS_SOLAR } from '../services/io/quizFunil';

const r = Router();
mountSolar(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const THIAGO = 'Bearer tk-thiago';
const A = '120256657642860602', B = '120256657642860603', CJ = '120256657642860111';

const ev = (s: string, tipo: string, d: Record<string, unknown>, quando: string) =>
  ({ session_id: s, event_type: tipo, event_data: { lp: 'solar', pl: 1, seq: 1, ...d }, created_at: quando });
const fd = (nota: number | null, caminho: string, anuncio: string) => [
  { name: 'Origem', values: ['Quiz Solar'] }, { name: 'Caminho', values: [caminho] },
  ...(nota === null ? [] : [{ name: 'Pontos', values: [String(nota)] }]),
  ...(anuncio ? [{ name: 'utm_content', values: [anuncio] }, { name: 'utm_term', values: [CJ] }] : []),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T15:00:00Z'));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app',
    'tk-thiago': 'thiago@irmaosnaobra.app',
    'tk-estranho': 'alguem@gmail.com',
  };
  h.conjuntoSoGasto = false; h.chamadasSoGasto = [];
  h.leituras = 0; h.bancoFora = false; h.metaFora = false; h.chamadasMeta = 0; h.periodosPedidos = [];
  h.eventos = [
    ev('a', 'quiz_passo', { passo: 'conta' }, '2026-10-09T14:01:00Z'),
    ev('a', 'quiz_fim', { destino: 'vistoria' }, '2026-10-10T02:30:00Z'),   // dia 09 em Brasília
    ev('b', 'quiz_passo', { passo: 'conta' }, '2026-10-10T14:01:00Z'),
  ];
  h.visitas = [
    { session_id: 'a', landing_url: 'https://solardoc.app/io/solar?utm_campaign=x', utm_campaign: 'x', utm_term: CJ, created_at: '2026-10-09T14:00:00Z' },
    { session_id: 'b', landing_url: 'https://solardoc.app/io/solar', utm_campaign: null, utm_term: null, created_at: '2026-10-10T14:00:00Z' },
  ];
  h.cards = [
    { utm_term: CJ, utm_content: A, status: 'agendado', created_at: '2026-10-09T15:00:00Z' },
    { utm_term: CJ, utm_content: A, status: 'fechou', created_at: '2026-10-08T15:00:00Z' },
    { utm_term: CJ, utm_content: B, status: 'cancelado', created_at: '2026-10-09T15:00:00Z' },
    { utm_term: null, utm_content: null, status: 'sem_interesse', created_at: '2026-10-09T16:00:00Z' },
  ];
  h.leads = [
    { lead_id: 'quiz_5534991110001', created_time: '2026-10-09T14:00:00Z', field_data: fd(90, 'vistoria', A) },
    { lead_id: 'quiz_5534991110002', created_time: '2026-10-09T14:10:00Z', field_data: fd(60, 'video', A) },
    { lead_id: 'quiz_5534991110003', created_time: '2026-10-09T14:20:00Z', field_data: fd(20, 'curioso', B) },
    { lead_id: 'quiz_5534991110004', created_time: '2026-10-09T14:30:00Z', field_data: fd(null, 'ligacao', '') },
    { lead_id: 'quizX5534991110005', created_time: '2026-10-09T14:40:00Z', field_data: fd(99, 'vistoria', A) },   // não é do quiz
  ];
  limparCachesSolar();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const painel = (qs = '', auth = NILCE) => request(app).get(`/gerador/solar/painel${qs}`).set('Authorization', auth);
const chaves = (o: unknown, achadas: string[] = []): string[] => {
  if (Array.isArray(o)) o.forEach((x) => chaves(x, achadas));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { achadas.push(k); chaves(v, achadas); }
  return achadas;
};
const chavesDeDinheiro = (o: unknown) => chaves(o).filter((k) => k !== 'verGasto' && /gasto|custo|spend|valor/i.test(k));

describe('login', () => {
  it('401 sem token, com chave publishable e com token inválido', async () => {
    expect((await request(app).get('/gerador/solar/painel')).status).toBe(401);
    expect((await painel('', 'Bearer sb_publishable_abc')).status).toBe(401);
    expect((await painel('', 'Bearer lixo')).status).toBe(401);
    expect(h.leituras).toBe(0);
  });
  it('403 para conta que não é de consultor', async () => {
    expect((await painel('', 'Bearer tk-estranho')).status).toBe(403);
    expect(h.leituras).toBe(0);
  });
});

describe('o que o consultor comum vê', () => {
  it('tudo menos dinheiro: nenhuma chave de gasto ou custo, em lugar nenhum', async () => {
    const res = await painel();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.verGasto).toBe(false);
    expect(chavesDeDinheiro(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/82\.5|"gasto"|custoPorAgendado|custo_reuniao/);
    expect(res.headers['cache-control']).toBe('no-store');
    // Contagem e nota ficam.
    expect(res.body.porAnuncio[0]).toMatchObject({ id: A, nome: '6 Video 4.9 avaliacao', situacao: 'ACTIVE', leads: 2, agendados: 2, notaMedia: 75, quentes: 1 });
    expect(res.body.porConjunto[0]).toMatchObject({ id: CJ, nome: 'Conjunto A', reunioes: 3 });
    // O motivo técnico da Meta também fica de fora.
    expect(res.body.meta_ok).toBe(true);
    expect(res.body.meta_motivo).toBeNull();
  });
});

describe('o que o sócio vê', () => {
  it('gasto e custo por agendado nos anúncios e nos conjuntos', async () => {
    const res = await painel('', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.verGasto).toBe(true);
    expect(res.body.porAnuncio[0]).toMatchObject({ id: A, gasto: 82.5, custoPorAgendado: 41.25 });
    const cj = res.body.porConjunto.find((c: { id: string }) => c.id === CJ);
    expect(cj).toMatchObject({ id: CJ, gasto: 50 });
    expect(cj.custo_reuniao).toBe(16.67);
  });
});

describe('o formato da resposta', () => {
  it('funil, qualidade dos leads, resultado, dias e anúncios', async () => {
    const res = await painel('?period=7dias', THIAGO);
    const b = res.body;
    expect(b.periodo).toBe('7dias');
    expect(b.desde).toBe('2026-10-03T15:00:00.000Z');
    expect(b.ate).toBeNull();
    expect(b.funil).toMatchObject({ visitas: 2, abriram: 2, terminaram: 1, destinos: { vistoria: 1 } });
    expect(b.funil.caminhos.map((c: { id: string }) => c.id)).toEqual(CAMINHOS_SOLAR.map((c) => c.id));
    // O lead "quizX..." não é do quiz e fica de fora (o "_" do LIKE é curinga).
    expect(b.leads).toEqual({
      total: 4, comNota: 3, notaMedia: 57, quentes: 1, mornos: 1, curiosos: 1,
      porCaminho: { vistoria: 1, video: 1, ligacao: 1, curioso: 1 },
    });
    expect(b.resultado).toEqual({ agendados: 3, orcamentos: 0, vendidos: 1, semInteresse: 1, naoAtendeu: 0, emAberto: 1 });
    expect(b.porDia.map((d: { dia: string }) => d.dia)).toEqual([
      '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ]);
    expect(b.porDia.find((d: { dia: string }) => d.dia === '2026-10-05')).toEqual({ dia: '2026-10-05', visitas: 0, terminaram: 0, agendados: 0 });
    expect(b.porDia.find((d: { dia: string }) => d.dia === '2026-10-09')).toEqual({ dia: '2026-10-09', visitas: 1, terminaram: 1, agendados: 2 });
    expect(b.porDia.find((d: { dia: string }) => d.dia === '2026-10-10')).toEqual({ dia: '2026-10-10', visitas: 1, terminaram: 0, agendados: 0 });
    expect(b.porAnuncio.map((a: { id: string }) => a.id)).toEqual([A, '', B]);
    expect(b.porAnuncio[1]).toMatchObject({ nome: '(sem anúncio)', agendados: 1, leads: 1 });
    const somaAgendados = b.porAnuncio.reduce((s: number, a: { agendados: number }) => s + a.agendados, 0);
    expect(somaAgendados).toBe(b.resultado.agendados);
    expect(b.meta_ok).toBe(true);
  });
  it('a soma dos dias bate com o funil', async () => {
    const b = (await painel('', THIAGO)).body;
    expect(b.porDia.reduce((s: number, d: { visitas: number }) => s + d.visitas, 0)).toBe(b.funil.visitas);
    expect(b.porDia.reduce((s: number, d: { terminaram: number }) => s + d.terminaram, 0)).toBe(b.funil.terminaram);
  });
  it('ontem: o intervalo fecha à meia-noite de Brasília', async () => {
    const b = (await painel('?period=ontem')).body;
    expect(b.desde).toBe('2026-10-09T03:00:00.000Z');
    expect(b.ate).toBe('2026-10-10T03:00:00.000Z');
    expect(b.porDia.map((d: { dia: string }) => d.dia)).toEqual(['2026-10-09']);
  });
  it('30dias: 31 dias de calendário no máximo', async () => {
    const b = (await painel('?period=30dias')).body;
    expect(b.periodo).toBe('30dias');
    expect(b.porDia).toHaveLength(31);
    expect(b.porDia[30].dia).toBe('2026-10-10');
  });
  it('maximo não existe no Gerador: cai em 7dias, para sócio e consultor', async () => {
    for (const auth of [NILCE, THIAGO]) {
      const b = (await painel('?period=maximo', auth)).body;
      expect(b.periodo).toBe('7dias');
      expect(b.desde).toBe('2026-10-03T15:00:00.000Z');
    }
  });
  it('período inválido cai em 7dias', async () => {
    for (const q of ['?period=ano', '?period=', '?period[]=hoje', '?period=%27%3B--', '?period=MAXIMO']) {
      const res = await painel(q);
      expect(res.status).toBe(200);
      expect(res.body.periodo).toBe('7dias');
    }
  });
});

describe('o que só existe por causa do gasto', () => {
  it('sócio vê o anúncio que gastou e não trouxe nada, e o conjunto que só gastou', async () => {
    h.conjuntoSoGasto = true;
    const b = (await painel('', THIAGO)).body;
    const ids = b.porAnuncio.map((a: { id: string }) => a.id);
    expect(ids[ids.length - 1]).toBe('120256657642860888');
    expect(b.porAnuncio[ids.length - 1]).toMatchObject({ nome: 'Gastou e sumiu', situacao: 'PAUSED', leads: 0, agendados: 0, gasto: 33, custoPorAgendado: null });
    expect(b.porConjunto.map((c: { id: string }) => c.id)).toContain('120256657642860999');
    // Só os conjuntos que mais gastaram vão à Meta, o de maior gasto primeiro.
    expect(h.chamadasSoGasto[0][0]).toBe('120256657642860999');
    expect(h.chamadasSoGasto[0].length).toBeLessThanOrEqual(5);
  });
  it('consultor comum não vê nenhuma dessas linhas, nem o nome nem o id, nem pelo cache do sócio', async () => {
    h.conjuntoSoGasto = true;
    await painel('', THIAGO);            // o cache já nasce com as linhas de gasto
    const b = (await painel('', NILCE)).body;
    expect(b.porAnuncio.map((a: { id: string }) => a.id)).toEqual([A, '', B]);
    expect(b.porConjunto.map((c: { id: string }) => c.id)).toEqual([CJ, '(sem)']);   // o '(sem)' tem visita e reunião de verdade
    expect(JSON.stringify(b)).not.toMatch(/Gastou e sumiu|120256657642860888|120256657642860999|Conjunto só gasto/);
    expect(chavesDeDinheiro(b)).toEqual([]);
  });
  it('consultor primeiro, sócio depois: o sócio ainda recebe tudo', async () => {
    h.conjuntoSoGasto = true;
    await painel('', NILCE);
    const b = (await painel('', THIAGO)).body;
    expect(b.porAnuncio.map((a: { id: string }) => a.id)).toContain('120256657642860888');
  });
  it('ordem dos conjuntos do consultor não segue o gasto', async () => {
    h.conjuntoSoGasto = true;
    const socio = (await painel('', THIAGO)).body.porConjunto.map((c: { id: string }) => c.id);
    expect(socio[0]).toBe('120256657642860999');   // o de maior gasto vem primeiro para o sócio
    const consultor = (await painel('', NILCE)).body.porConjunto.map((c: { id: string }) => c.id);
    expect(consultor[0]).toBe(CJ);
  });
});

describe('Meta fora do ar', () => {
  it('200 com meta_ok false; os números ficam e o gasto vira null para o sócio', async () => {
    h.metaFora = true;
    const socio = await painel('', THIAGO);
    expect(socio.status).toBe(200);
    expect(socio.body.meta_ok).toBe(false);
    expect(socio.body.meta_motivo).toContain('Meta 500');
    expect(socio.body.porAnuncio[0]).toMatchObject({ id: A, nome: A, leads: 2, agendados: 2, gasto: null, custoPorAgendado: null });
    expect(socio.body.leads.total).toBe(4);
    const consultor = await painel();
    expect(consultor.status).toBe(200);
    expect(consultor.body.meta_ok).toBe(false);
    expect(consultor.body.meta_motivo).toBeNull();
    expect(chavesDeDinheiro(consultor.body)).toEqual([]);
  });
});

describe('cache de 3 minutos por período', () => {
  it('a segunda chamada não lê o banco nem a Meta de novo', async () => {
    await painel('', THIAGO);
    const leituras = h.leituras, meta = h.chamadasMeta;
    expect(leituras).toBeGreaterThan(0);
    await painel('', THIAGO);
    await painel('', NILCE);
    expect(h.leituras).toBe(leituras);
    expect(h.chamadasMeta).toBe(meta);
  });
  it('período diferente tem cache próprio', async () => {
    await painel('?period=7dias');
    const leituras = h.leituras;
    await painel('?period=30dias');
    expect(h.leituras).toBeGreaterThan(leituras);
  });
  it('vence em 3 minutos', async () => {
    await painel();
    const leituras = h.leituras;
    vi.setSystemTime(new Date('2026-10-10T15:02:00Z'));
    await painel();
    expect(h.leituras).toBe(leituras);
    vi.setSystemTime(new Date('2026-10-10T15:03:01Z'));
    await painel();
    expect(h.leituras).toBeGreaterThan(leituras);
  });
  it('resposta de sócio em cache não vaza gasto para consultor (e o contrário)', async () => {
    const socio1 = await painel('', THIAGO);
    const consultor = await painel('', NILCE);
    const socio2 = await painel('', THIAGO);
    expect(socio1.body.porAnuncio[0].gasto).toBe(82.5);
    expect(chavesDeDinheiro(consultor.body)).toEqual([]);
    expect(socio2.body.porAnuncio[0].gasto).toBe(82.5);
    expect(socio2.body.porConjunto.find((c: { id: string }) => c.id === CJ).gasto).toBe(50);
    // E na ordem inversa, com cache novo: consultor primeiro, sócio depois.
    limparCachesSolar();
    const consultor2 = await painel('', NILCE);
    const socio3 = await painel('', THIAGO);
    expect(chavesDeDinheiro(consultor2.body)).toEqual([]);
    expect(socio3.body.porAnuncio[0].gasto).toBe(82.5);
  });
  it('três pedidos juntos viram uma só leitura', async () => {
    const todos = await Promise.all([painel(), painel('', THIAGO), painel()]);
    expect(todos.map((x) => x.status)).toEqual([200, 200, 200]);
    const porLeitura = h.leituras;
    limparCachesSolar(); h.leituras = 0;
    await painel();
    expect(porLeitura).toBe(h.leituras);
  });
  it('erro de banco não entra no cache: a próxima tentativa lê de novo', async () => {
    h.bancoFora = true;
    expect((await painel()).status).toBe(502);
    h.bancoFora = false;
    const ok = await painel();
    expect(ok.status).toBe(200);
  });
});

describe('falha de leitura', () => {
  it('502 com erro curto, sem stack, sem URL e sem a mensagem do banco', async () => {
    h.bancoFora = true;
    for (const auth of [NILCE, THIAGO]) {
      const res = await painel('', auth);
      expect(res.status).toBe(502);
      expect(res.body.error).toBeTruthy();
      expect(String(res.body.error).length).toBeLessThan(120);
      expect(JSON.stringify(res.body)).not.toMatch(/postgres|segredo|http|\bat \w|stack/i);
    }
  });
});

describe('a leitura do banco', () => {
  it('todas as leituras (eventos, visitas, cards, leads) usam o mesmo início de período', async () => {
    await painel();
    // todas as leituras de período usam o mesmo "desde" (agora menos 7 dias)
    expect(new Set(h.periodosPedidos)).toEqual(new Set(['2026-10-03T15:00:00.000Z']));
  });
});
