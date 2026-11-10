import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from './fixtures/qualidadeMeta2026-11-10.json';

// Banco, Meta e e-mail são falsos: o teste não toca produção, não gasta cota do Meta e não manda e-mail.
const h = vi.hoisted(() => {
  const estado = new Map<string, any>();                   // system_state do banco principal
  const tabelas: Record<string, any[]> = {};               // linhas devolvidas pelos selects (sales, agendamentos)
  const inserts: Array<{ tabela: string; rows: any[] }> = [];
  const upserts: Array<{ tabela: string; row: any }> = [];
  function builder(tabela: string) {
    const ctx: any = { eq: null, faixa: [0, 999] };
    const b: any = {
      select: () => b, not: () => b, gte: () => b, lt: () => b, order: () => b,
      eq: (c: string, v: string) => { ctx.eq = [c, v]; return b; },
      range: (a: number, z: number) => { ctx.faixa = [a, z]; return b; },
      maybeSingle: async () => (tabela === 'system_state' && estado.has(ctx.eq?.[1])
        ? { data: { value: estado.get(ctx.eq[1]) }, error: null } : { data: null, error: null }),
      upsert: async (row: any) => { upserts.push({ tabela, row }); if (tabela === 'system_state') estado.set(row.key, row.value); return { error: null }; },
      insert: async (rows: any[]) => { inserts.push({ tabela, rows }); return { error: null }; },
      then: (ok: any, ko: any) => Promise.resolve({ data: (tabelas[tabela] || []).slice(ctx.faixa[0], ctx.faixa[1] + 1), error: null }).then(ok, ko),
    };
    return b;
  }
  return { estado, tabelas, inserts, upserts, builder, qualidade: {} as Record<string, any>, insights: [] as any[], alertas: [] as Array<[string, string]> };
});

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.builder(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => h.builder(t) } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async (assunto: string, corpo: string) => { h.alertas.push([assunto, corpo]); }) }));

import {
  medirQualidadeSemanal, conferirMetaVsBanco, linhasDaResposta, semanaISO, janelaSeteDias, divergiu, chavesQueFaltam,
  CHAVE_CONFERENCIA, chaveSemana,
} from '../services/meta/medidorQualidade';
import { PIXEL_SOLARDOC, PIXEL_SOLAR, PIXEL_ELETROPOSTO } from '../utils/metaCapi';

const pixels = fixture as Record<string, any>;
const SEGUNDA_13H = Date.parse('2026-11-09T13:00:00Z');   // segunda, semana ISO 46
const SEGUNDA_11H = Date.parse('2026-11-09T11:00:00Z');
const TERCA_13H = Date.parse('2026-11-10T13:00:00Z');
const TERCA_10H = Date.parse('2026-11-10T10:59:00Z');
const TERCA_12H = Date.parse('2026-11-10T12:00:00Z');

let chamadas: Array<{ url: string; method: string }>;
const resposta = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo });

beforeEach(() => {
  h.estado.clear(); h.inserts.length = 0; h.upserts.length = 0; h.alertas.length = 0;
  for (const k of Object.keys(h.tabelas)) delete h.tabelas[k];
  h.qualidade = { [PIXEL_SOLARDOC]: pixels['824905216831401'], [PIXEL_SOLAR]: pixels['446093469730871'], [PIXEL_ELETROPOSTO]: pixels['26788759654130722'] };
  h.insights = [];
  chamadas = [];
  process.env.META_SYSTEM_USER_TOKEN = 'token-de-teste';
  delete process.env.MEDIDOR_META_OFF;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    chamadas.push({ url: String(url), method: init?.method });
    const u = new URL(String(url));
    if (u.pathname.endsWith('/dataset_quality')) return resposta(h.qualidade[u.searchParams.get('dataset_id') || ''] ?? {});
    if (u.pathname.endsWith('/insights')) return resposta({ data: h.insights });
    return resposta({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.META_SYSTEM_USER_TOKEN; delete process.env.MEDIDOR_META_OFF; });

describe('relógio', () => {
  it('semana ISO', () => {
    expect(semanaISO(SEGUNDA_13H)).toBe('2026-W46');
    expect(semanaISO(Date.parse('2026-11-15T23:59:00Z'))).toBe('2026-W46');
    expect(semanaISO(Date.parse('2026-11-16T00:00:00Z'))).toBe('2026-W47');
    expect(semanaISO(Date.parse('2027-01-03T12:00:00Z'))).toBe('2026-W53');
    expect(semanaISO(Date.parse('2026-01-01T12:00:00Z'))).toBe('2026-W01');
  });
  it('janela: 7 dias completos até ontem em Brasília', () => {
    const j = janelaSeteDias(TERCA_12H);
    expect([j.desde, j.ate]).toEqual(['2026-11-03', '2026-11-09']);
    expect([j.deUtc, j.ateUtc]).toEqual(['2026-11-03T03:00:00.000Z', '2026-11-10T03:00:00.000Z']);
  });
});

describe('parser da resposta real do Meta', () => {
  it('SolarDoc: Purchase 9.1 e CompleteRegistration 6.1', () => {
    const l = linhasDaResposta(PIXEL_SOLARDOC, 'solardoc', pixels['824905216831401'], '2026-11-10T00:00:00Z');
    expect(l).toHaveLength(pixels['824905216831401'].web.length);
    const compra = l.find((x) => x.event_name === 'Purchase')!;
    expect(compra).toMatchObject({ dataset_id: PIXEL_SOLARDOC, produto: 'solardoc', nota: 9.1 });
    expect(Array.isArray(compra.cobertura)).toBe(true);
    expect(compra.bruto).toMatchObject({ event_name: 'Purchase' });
    expect(l.find((x) => x.event_name === 'CompleteRegistration')!.nota).toBe(6.1);
    // evento sem nota (poucos eventos) entra com nota nula
    expect(l.find((x) => x.event_name === 'SubscribedButtonClick')).toMatchObject({ nota: null, cobertura: null });
  });
  it('resposta vazia vira uma linha vazia', () => {
    expect(linhasDaResposta(PIXEL_ELETROPOSTO, 'eletroposto', {}, 'agora')).toEqual([
      { medido_em: 'agora', dataset_id: PIXEL_ELETROPOSTO, produto: 'eletroposto', event_name: null, nota: null, cobertura: null, bruto: {} },
    ]);
  });
  it('as 2 chaves que mais faltam (ausente conta 0%)', () => {
    const cob = [{ identifier: 'email', coverage: { percentage: 100 } }, { identifier: 'phone', coverage: { percentage: 33.3 } }, { identifier: 'fn', coverage: { percentage: 90 } }];
    // ln, external_id, fbc, fbp, ip_address, user_agent ausentes = 0%: os dois primeiros da ordem da tabela
    expect(chavesQueFaltam(cob)).toEqual(['ln 0%', 'external_id 0%']);
  });
});

describe('medirQualidadeSemanal', () => {
  it('grava uma linha por pixel e evento (e a linha vazia do pixel sem volume)', async () => {
    const r = await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    expect(r.pulado).toBeUndefined();
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].tabela).toBe('meta_qualidade_dataset');
    const rows = h.inserts[0].rows;
    const esperado = pixels['824905216831401'].web.length + pixels['446093469730871'].web.length + 1;
    expect(rows).toHaveLength(esperado);
    expect(rows.find((x) => x.dataset_id === PIXEL_SOLARDOC && x.event_name === 'Purchase').nota).toBe(9.1);
    expect(rows.find((x) => x.dataset_id === PIXEL_ELETROPOSTO)).toMatchObject({ event_name: null, nota: null, bruto: {} });
    expect(h.estado.has(chaveSemana('2026-W46'))).toBe(true);
  });

  it('só faz GET no Meta, com o token no cabeçalho e nunca na URL', async () => {
    await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    await conferirMetaVsBanco({ agora: TERCA_12H });
    expect(chamadas.length).toBeGreaterThanOrEqual(4);
    for (const c of chamadas) {
      expect(c.method).toBe('GET');
      expect(c.url).not.toContain('token-de-teste');
      expect(c.url).toContain('graph.facebook.com/v21.0/');
    }
    expect(chamadas.filter((c) => c.url.includes('dataset_quality')).map((c) => new URL(c.url).searchParams.get('dataset_id')).sort())
      .toEqual([PIXEL_ELETROPOSTO, PIXEL_SOLAR, PIXEL_SOLARDOC].sort());
  });

  it('a trava impede a segunda execução na mesma semana', async () => {
    await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    const antes = chamadas.length;
    const r = await medirQualidadeSemanal({ agora: SEGUNDA_13H + 3600_000 });
    expect(r.pulado).toBe('semana_ja_rodou');
    expect(chamadas.length).toBe(antes);
    expect(h.inserts).toHaveLength(1);
  });

  it('semana seguinte roda de novo', async () => {
    await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    const r = await medirQualidadeSemanal({ agora: SEGUNDA_13H + 7 * 24 * 3600_000 });
    expect(r.pulado).toBeUndefined();
    expect(h.inserts).toHaveLength(2);
  });

  it('fora do horário não roda (terça, ou segunda antes das 12:00 UTC)', async () => {
    for (const quando of [SEGUNDA_11H, TERCA_13H]) {
      const r = await medirQualidadeSemanal({ agora: quando });
      expect(r.pulado).toBe('fora_do_horario');
    }
    expect(chamadas).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('avisa só os eventos chave abaixo de 8, com as 2 chaves que mais faltam', async () => {
    await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    expect(h.alertas).toHaveLength(1);
    const corpo = h.alertas[0][1];
    // Lead 7.8 e CompleteRegistration 6.1 (SolarDoc) e Schedule 7.8 (Solar) estão abaixo de 8
    expect(corpo).toContain('CompleteRegistration');
    expect(corpo).toContain('>Lead<');
    expect(corpo).toContain('>Schedule<');
    // Purchase 9.1 passa; ClienteQuente 4.8 não é evento chave; PageView 6.1 idem
    expect(corpo).not.toContain('>Purchase<');
    expect(corpo).not.toContain('ClienteQuente');
    expect(corpo).not.toContain('PageView');
    expect(corpo).toMatch(/\w+ \d+%, \w+ \d+%/);
  });

  it('com todos os eventos chave em 8 ou mais, não avisa', async () => {
    const ok = (nota: number) => ({ event_match_quality: { composite_score: nota, match_key_feedback: [] } });
    h.qualidade = {
      [PIXEL_SOLARDOC]: { web: [{ event_name: 'Purchase', ...ok(9.1) }, { event_name: 'Lead', ...ok(8) }, { event_name: 'PageView', ...ok(3) }] },
      [PIXEL_SOLAR]: { web: [{ event_name: 'Schedule', ...ok(8.4) }, { event_name: 'ClienteQuente', ...ok(4.8) }] },
      [PIXEL_ELETROPOSTO]: {},
    };
    await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    expect(h.inserts).toHaveLength(1);
    expect(h.alertas).toHaveLength(0);
  });

  it('dry não grava, não trava e não avisa, e devolve o que faria (mesmo fora do horário)', async () => {
    const r = await medirQualidadeSemanal({ dry: true, agora: TERCA_13H });
    expect(r.dry).toBe(true);
    expect(r.pulado).toBeUndefined();
    expect(r.seriaGravado!.length).toBeGreaterThan(10);
    expect(r.abaixoDeOito!.length).toBeGreaterThan(0);
    expect(h.inserts).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);
    expect(h.alertas).toHaveLength(0);
  });

  it('kill-switch desliga, até o dry', async () => {
    process.env.MEDIDOR_META_OFF = '1';
    expect((await medirQualidadeSemanal({ agora: SEGUNDA_13H })).pulado).toBe('desligado');
    expect((await medirQualidadeSemanal({ dry: true, agora: SEGUNDA_13H })).pulado).toBe('desligado');
    expect(chamadas).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('sem token não chama o Meta', async () => {
    delete process.env.META_SYSTEM_USER_TOKEN; delete process.env.META_PIXEL_TOKEN;
    expect((await medirQualidadeSemanal({ agora: SEGUNDA_13H })).pulado).toBe('sem_token');
    expect(chamadas).toHaveLength(0);
  });

  it('falha do Meta não grava, não trava e não lança', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'x' } }) })));
    const r = await medirQualidadeSemanal({ agora: SEGUNDA_13H });
    expect(r.erro).toBeTruthy();
    expect(h.inserts.filter((i) => i.tabela === 'meta_qualidade_dataset')).toHaveLength(0);
    expect(h.estado.has(chaveSemana('2026-W46'))).toBe(false);
  });
});

// ── Meta x banco ─────────────────────────────────────────────────────────────
const camp = (id: string, nome: string, compras: number, agend: number) => ({
  campaign_id: id, campaign_name: nome,
  // o Meta devolve a mesma compra em vários action_types: só o "purchase" exato conta
  actions: [{ action_type: 'purchase', value: String(compras) }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: String(compras) }],
  conversions: [{ action_type: 'schedule_total', value: String(agend) }],
});
const vendas = (id: string, n: number) => Array.from({ length: n }, () => ({ utm_campaign: id, meta_skip_motivo: null }));
const agends = (id: string, n: number) => Array.from({ length: n }, () => ({ utm_campaign: id }));

describe('divergiu', () => {
  it('30% do maior lado e 3 eventos', () => {
    expect(divergiu(10, 7)).toBe(true);     // 30%
    expect(divergiu(10, 8)).toBe(false);    // 20%
    expect(divergiu(3, 2)).toBe(true);      // 33%, maior lado = 3
    expect(divergiu(2, 0)).toBe(false);     // 100%, mas maior lado = 2
    expect(divergiu(0, 3)).toBe(true);      // Meta não viu nada e o banco tem 3
    expect(divergiu(5, 5)).toBe(false);
  });
});

describe('conferirMetaVsBanco', () => {
  it('avisa a campanha que diverge 30% com 3+ eventos, e só ela', async () => {
    h.insights = [
      camp('111111111111', 'SolarDoc - Venda', 10, 0),          // Meta 10, banco 7: 30% -> avisa
      camp('222222222222', 'SolarDoc - Quiz', 10, 0),           // Meta 10, banco 8: 20% -> não
      camp('333333333333', 'Solar - Quiz - Agenda', 0, 2),      // Meta 2, banco 0: volume baixo -> não
      camp('444444444444', 'Nexus eletroposto', 0, 6),          // Schedule vem de conversions: Meta 6, banco 6 -> não
    ];
    h.tabelas.sales = [...vendas('111111111111', 7), ...vendas('222222222222', 8), { utm_campaign: '111111111111', meta_skip_motivo: 'teste' }];
    h.tabelas.agendamentos = [...agends('444444444444', 6), ...agends('eletroposto', 4), { utm_campaign: null }];
    const r = await conferirMetaVsBanco({ agora: TERCA_12H });
    expect(r.pulado).toBeUndefined();
    expect(r.janela).toEqual({ desde: '2026-11-03', ate: '2026-11-09' });
    expect(r.alertas).toBe(1);
    expect(r.avisou).toBe(true);
    expect(h.alertas).toHaveLength(1);
    expect(h.alertas[0][1]).toContain('SolarDoc - Venda');
    expect(h.alertas[0][1]).not.toContain('SolarDoc - Quiz');
    expect(h.alertas[0][1]).not.toContain('Nexus eletroposto');
    const por = Object.fromEntries(r.linhas!.map((l) => [l.campanha_id, l]));
    expect(por['111111111111']).toMatchObject({ produto: 'solardoc', metrica: 'compras', meta: 10, banco: 7, difPct: 30, alerta: true });
    expect(por['444444444444']).toMatchObject({ produto: 'eletroposto', metrica: 'agendamentos', meta: 6, banco: 6, alerta: false });
    // utm "eletroposto" (DM do Instagram) não é campanha do Meta: fica de fora da conta e aparece à parte
    expect(r.semCampanhaNoMeta).toEqual({ compras: 0, agendamentos: 4 });
    // resultado fica para leitura
    const salvo = h.estado.get(CHAVE_CONFERENCIA);
    expect(salvo.dia).toBe('2026-11-10');
    expect(salvo.alertas).toBe(1);
  });

  it('com 20% de diferença, não avisa (mas grava o resultado)', async () => {
    h.insights = [camp('111111111111', 'SolarDoc - Venda', 10, 0)];
    h.tabelas.sales = vendas('111111111111', 8);
    const r = await conferirMetaVsBanco({ agora: TERCA_12H });
    expect(r.alertas).toBe(0);
    expect(h.alertas).toHaveLength(0);
    expect(h.estado.has(CHAVE_CONFERENCIA)).toBe(true);
  });

  it('casa o utm_campaign pelo nome da campanha também', async () => {
    h.insights = [camp('111111111111', 'SolarDoc - Venda', 10, 0)];
    h.tabelas.sales = vendas('solardoc - venda', 10);
    const r = await conferirMetaVsBanco({ agora: TERCA_12H });
    expect(r.linhas![0]).toMatchObject({ meta: 10, banco: 10, alerta: false });
  });

  it('a trava diária impede a segunda execução no mesmo dia', async () => {
    h.insights = [camp('111111111111', 'SolarDoc - Venda', 10, 0)];
    await conferirMetaVsBanco({ agora: TERCA_12H });
    const antes = chamadas.length;
    expect((await conferirMetaVsBanco({ agora: TERCA_13H })).pulado).toBe('hoje_ja_rodou');
    expect(chamadas.length).toBe(antes);
    // dia seguinte roda de novo
    expect((await conferirMetaVsBanco({ agora: TERCA_12H + 24 * 3600_000 })).pulado).toBeUndefined();
  });

  it('antes das 11:00 UTC não roda', async () => {
    expect((await conferirMetaVsBanco({ agora: TERCA_10H })).pulado).toBe('fora_do_horario');
    expect(chamadas).toHaveLength(0);
  });

  it('dry não grava nem avisa, e devolve a conferência (mesmo fora do horário)', async () => {
    h.insights = [camp('111111111111', 'SolarDoc - Venda', 10, 0)];
    h.tabelas.sales = vendas('111111111111', 3);
    const r = await conferirMetaVsBanco({ dry: true, agora: TERCA_10H });
    expect(r.dry).toBe(true);
    expect(r.alertas).toBe(1);
    expect(r.avisou).toBe(false);
    expect(h.upserts).toHaveLength(0);
    expect(h.alertas).toHaveLength(0);
  });

  it('kill-switch desliga', async () => {
    process.env.MEDIDOR_META_OFF = '1';
    expect((await conferirMetaVsBanco({ agora: TERCA_12H })).pulado).toBe('desligado');
    expect(chamadas).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);
  });
});

describe('prazo total de cada tarefa (60 s em produção)', () => {
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fetchLento = (ms: number) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    await espera(ms);
    const u = new URL(String(url));
    if (u.pathname.endsWith('/dataset_quality')) return resposta(h.qualidade[u.searchParams.get('dataset_id') || ''] ?? {});
    if (u.pathname.endsWith('/insights')) return resposta({ data: h.insights });
    return resposta({});
  }));

  it('qualidade: o Meta lento estoura o prazo, devolve "prazo estourado", não lança e não grava nada (nem depois)', async () => {
    fetchLento(40); // 3 pixels em fila: ~120 ms contra um prazo de 60 ms
    const r = await medirQualidadeSemanal({ agora: SEGUNDA_13H, prazoMs: 60 });
    expect(r.erro).toBe('prazo estourado');
    expect(h.inserts.filter((x) => x.tabela === 'meta_qualidade_dataset')).toHaveLength(0);
    expect(h.upserts.filter((u) => u.tabela === 'system_state')).toHaveLength(0);
    expect(h.alertas).toHaveLength(0);
    await espera(250); // a rodada que ficou para trás termina e continua sem gravar
    expect(h.inserts.filter((x) => x.tabela === 'meta_qualidade_dataset')).toHaveLength(0);
    expect(h.upserts.filter((u) => u.tabela === 'system_state')).toHaveLength(0);
    expect(h.alertas).toHaveLength(0);
    expect(h.estado.has(chaveSemana(semanaISO(SEGUNDA_13H)))).toBe(false); // sem trava: a próxima rodada mede de novo
  });

  it('qualidade: dentro do prazo grava normalmente', async () => {
    const r = await medirQualidadeSemanal({ agora: SEGUNDA_13H, prazoMs: 5000 });
    expect(r.erro).toBeUndefined();
    expect(h.inserts.filter((x) => x.tabela === 'meta_qualidade_dataset')).toHaveLength(1);
  });

  it('conferência: leitura lenta estoura o prazo, devolve "prazo estourado" e não grava o resultado do dia', async () => {
    fetchLento(150);
    const r = await conferirMetaVsBanco({ agora: TERCA_13H, prazoMs: 50 });
    expect(r.erro).toBe('prazo estourado');
    await espera(350);
    expect(h.upserts.filter((u) => u.tabela === 'system_state')).toHaveLength(0);
    expect(h.alertas).toHaveLength(0);
    expect(h.estado.has(CHAVE_CONFERENCIA)).toBe(false);
  });
});
