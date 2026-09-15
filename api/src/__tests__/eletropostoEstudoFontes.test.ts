import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  criar: vi.fn(),
}));

// Fake do Supabase do Gerador: devolve as linhas que o teste puser, aplicando o
// ilike de observação e telefone, que é o que o histórico usa.
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
      const like = (col: string, padrao: string) => {
        const re = new RegExp('^' + padrao.split('%').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'is');
        filtros.push(r => re.test(String(r[col] ?? '')));
      };
      const api: any = {
        select: () => api,
        ilike: (col: string, p: string) => { like(col, p); return api; },
        neq: (col: string, v: unknown) => { filtros.push(r => r[col] !== v); return api; },
        order: () => api,
        limit: () => api,
        then: (ok: (v: unknown) => unknown) => ok({ data: h.linhas.filter(r => filtros.every(f => f(r))), error: null }),
      };
      return api;
    },
  },
}));

vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({ messages: { create: h.criar } }),
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buscarLocal, buscarProximos, streetViewMeta, provarStaticMap, ibgePopulacao, ibgePibPerCapita,
  frotaDoMunicipio, historicoDoEndereco, escreverTextos, imagemRua, MASCARA_LOCAL,
} from '../services/io/eletropostoEstudoFontes';
import { montarFatosIA, extrairFicha } from '../services/io/eletropostoEstudoPuro';

const CHAVE = 'CHAVE_FALSA_TESTE';

const json = (status: number, corpo: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Response(JSON.stringify(corpo), { status, headers });

const lugar = (i: number) => ({
  id: `p${i}`, displayName: { text: `Lugar ${i}` },
  location: { latitude: -18.91 + i / 10000, longitude: -48.27 }, primaryType: 'restaurant', types: ['restaurant'],
});

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = CHAVE;
  h.linhas = [];
  h.criar.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe('Google Maps', () => {
  it('searchText 200: devolve os lugares, custo de tabela e a chave só no header', async () => {
    const f = vi.fn(async () => json(200, { places: [lugar(1)] }));
    vi.stubGlobal('fetch', f);
    const r = await buscarLocal('Rua Um, 10, Centro, Uberaba - MG, Brasil', { lat: -19.7, lng: -47.9 });
    expect(r.ok).toBe(true);
    expect(r.dado).toHaveLength(1);
    expect(r.custo_usd).toBe(0.032);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    const hdr = init.headers as Record<string, string>;
    expect(hdr['X-Goog-Api-Key']).toBe(CHAVE);
    expect(hdr['X-Goog-FieldMask']).toBe(MASCARA_LOCAL);
    expect(MASCARA_LOCAL).not.toMatch(/rating|phone|website/i);
    const corpo = JSON.parse(String(init.body));
    expect(corpo.locationBias.circle.radius).toBe(30000);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('searchText 403 PERMISSION_DENIED: erro:403, sem lançar e sem repassar o corpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: { status: 'PERMISSION_DENIED', message: 'API key CHAVE_FALSA_TESTE blocked' } })));
    const r = await buscarLocal('x');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('erro:403');
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('searchText sem resultado: zero_resultados, ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, {})));
    const r = await buscarLocal('x');
    expect(r.status).toBe('zero_resultados');
    expect(r.ok).toBe(true);
    expect(r.dado).toEqual([]);
  });

  it('Nearby com 20 lugares', async () => {
    const f = vi.fn(async () => json(200, { places: Array.from({ length: 20 }, (_, i) => lugar(i)) }));
    vi.stubGlobal('fetch', f);
    const r = await buscarProximos({ lat: -18.91, lng: -48.27 }, ['restaurant'], 1000);
    expect(r.dado).toHaveLength(20);
    const corpo = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(corpo).toMatchObject({ maxResultCount: 20, rankPreference: 'DISTANCE' });
    expect(corpo.locationRestriction.circle.radius).toBe(1000);
  });

  it('429 tenta de novo uma vez só', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, { places: [lugar(1)] }));
    vi.stubGlobal('fetch', f);
    expect((await buscarProximos({ lat: 0, lng: 0 }, ['gym'], 500)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);

    const g = vi.fn(async () => json(429, {}));
    vi.stubGlobal('fetch', g);
    const r = await buscarProximos({ lat: 0, lng: 0 }, ['gym'], 500);
    expect(r.status).toBe('erro:429');
    expect(g).toHaveBeenCalledTimes(2);
  });

  it('Street View metadata ZERO_RESULTS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { status: 'ZERO_RESULTS' })));
    const r = await streetViewMeta({ lat: 0, lng: 0 });
    expect(r.status).toBe('zero_resultados');
    expect(r.dado).toBeNull();
  });

  it('Street View metadata OK guarda pano e data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { status: 'OK', pano_id: 'abc', date: '2024-03', location: { lat: 1, lng: 2 } })));
    const r = await streetViewMeta({ lat: 0, lng: 0 });
    expect(r.dado).toEqual({ pano_id: 'abc', data: '2024-03', lat: 1, lng: 2 });
  });

  it('Static Maps prova 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })));
    const r = await provarStaticMap({ lat: 0, lng: 0 });
    expect(r.status).toBe('erro:403');
    expect(r.custo_usd).toBe(0);
  });

  it('imagem que não é imagem vira erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const r = await imagemRua('abc', 90);
    expect(r.ok).toBe(false);
    expect(r.dado).toBeNull();
  });

  it('sem chave: nem chama o Google', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await buscarLocal('x')).status).toBe('sem_chave');
    expect((await streetViewMeta({ lat: 0, lng: 0 })).status).toBe('sem_chave');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('IBGE', () => {
  it('população: último ano publicado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [{ resultados: [{ series: [{ serie: { '2025': '355000', '2026': '359275' } }] }] }])));
    const r = await ibgePopulacao(3170107);
    expect(r.dado).toEqual({ valor: 359275, ano: '2026' });
  });

  it('PIB per capita: último ano com valor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [{ res: [{ localidade: '317010', res: { '2022': '69802.51', '2023': '70120.94', '2024': null } }] }])));
    const r = await ibgePibPerCapita(3170107);
    expect(r.dado).toEqual({ valor: 70120.94, ano: '2023' });
  });

  it('IBGE em timeout (relógio falso)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const p = ibgePopulacao(3170206);
    await vi.advanceTimersByTimeAsync(5001);
    const r = await p;
    expect(r.status).toBe('timeout');
    expect(r.ok).toBe(false);
  });
});

describe('frota', () => {
  it('Uberlândia: 3.017 plug-ins, por mil e as comparações', () => {
    const f = frotaDoMunicipio(3170206, 'MG')!;
    expect(f.plugin).toBe(3017);
    expect(f.por_mil).toBeCloseTo(5.3, 1);
    expect(f.uf_por_mil).not.toBeNull();
    expect(f.br_por_mil).toBeCloseTo(3.1, 1);
    expect(f.ref).toBe('julho/2026');
    expect(frotaDoMunicipio(1, 'MG')).toBeNull();
  });
});

describe('histórico do endereço', () => {
  const endereco = { rua: 'Avenida dos Ipês', numero: '1500', bairro: 'Vila Nova', cidade: 'Uberlândia-MG', cep: '', compl: '' };

  it('acha pela rua e número normalizados e pelo telefone, tira a própria ficha, mais recente primeiro', async () => {
    h.linhas = [
      { id: 10, created_by: 'lp_eletroposto', quando: '2026-08-20T17:00:00Z', status: 'nao_atendeu', vendedor_nome: 'Diego', cliente_telefone: '5534900000001', observacao: 'LP ELETROPOSTO · Mercado\nEndereço: Avenida dos Ipês, 1500 · Vila Nova · Uberlândia-MG' },
      { id: 11, created_by: 'lp_eletroposto', quando: '2026-09-01T17:00:00Z', status: 'cancelado', vendedor_nome: 'Thiago', cliente_telefone: '5534988887777', observacao: 'LP ELETROPOSTO · Mercado\nEndereço: Outra Rua, 3 · Centro · Uberlândia-MG' },
      { id: 12, created_by: 'lp_eletroposto', quando: '2026-09-02T17:00:00Z', status: 'agendado', vendedor_nome: 'Diego', cliente_telefone: '5534900000009', observacao: 'Endereço: Avenida dos Ipês, 1500 · Vila Nova · Uberaba-MG' },
      { id: 99, created_by: 'lp_eletroposto', quando: '2026-09-20T17:00:00Z', status: 'agendado', vendedor_nome: 'Diego', cliente_telefone: '5534988887777', observacao: 'Endereço: Avenida dos Ipês, 1500 · Vila Nova · Uberlândia-MG' },
    ];
    const r = await historicoDoEndereco({ endereco, telefone: '(34) 98888-7777', excluirId: 99 });
    expect(r.dado?.map(x => x.id)).toEqual([11, 10]);
    expect(r.dado?.[0]).toEqual({ id: 11, quando: '2026-09-01T17:00:00Z', status: 'cancelado', consultor: 'Thiago' });
  });

  it('nada parecido: zero_resultados', async () => {
    const r = await historicoDoEndereco({ endereco, telefone: null, excluirId: 1 });
    expect(r.status).toBe('zero_resultados');
    expect(r.dado).toEqual([]);
  });
});

describe('IA', () => {
  const fatos = montarFatosIA({ ficha: extrairFicha('LP ELETROPOSTO · Academia\nPonto: Já tenho o ponto definido'), sinais: [], situacao: 'pronto' });

  it('tool_use limpo vira texto da IA, com custo pelos tokens', async () => {
    h.criar.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'escrever_estudo', input: {
        resumo: 'Academia com o ponto definido.', leitura_do_entorno: 'O entorno não foi consultado.',
        perguntas: ['Quantas vagas ficam livres?', 'Quem decide?', 'Qual o horário de pico?'],
        cuidados: [], modelo_sugerido: '02', porque_modelo: 'Sem modelo marcado, a sociedade é o começo.',
      } }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const r = await escreverTextos(fatos);
    expect(r.ia.origem).toBe('ia');
    expect(r.ia.modelo_sugerido).toBe('02');
    expect(r.custo_usd).toBeCloseTo(0.0105, 4);
    const pedido = h.criar.mock.calls[0][0];
    expect(pedido.tool_choice).toEqual({ type: 'tool', name: 'escrever_estudo' });
    expect(JSON.stringify(pedido.messages)).not.toMatch(/Avenida|telefone/);
  });

  it('IA com erro (crédito zerado): texto padrão, sem lançar', async () => {
    h.criar.mockRejectedValue(new Error('credit balance is too low'));
    const r = await escreverTextos(fatos);
    expect(r.ia.origem).toBe('modelo');
    expect(r.status).toBe('erro:ia');
    expect(r.ia.perguntas.length).toBeGreaterThanOrEqual(3);
  });

  it('IA escreve R$: campo cai no modelo', async () => {
    h.criar.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'escrever_estudo', input: {
        resumo: 'Vai render R$ 7 mil.', leitura_do_entorno: 'Entorno bom.',
        perguntas: ['Quantas vagas?', 'Quem decide?', 'Qual o horário?'], cuidados: [], modelo_sugerido: '03', porque_modelo: 'Tem capital.',
      } }],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const r = await escreverTextos(fatos);
    expect(r.ia.reprovados).toContain('resumo');
    expect(r.ia.resumo).not.toContain('R$');
  });
});
