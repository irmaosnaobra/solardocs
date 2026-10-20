import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Banco falso: cada tabela responde por uma função; o encadeamento é permissivo.
const tabelas: Record<string, (op: { filtros: Array<[string, any[]]>; escrita?: any }) => any> = {};
const upserts: any[] = [];

function cadeia(nome: string) {
  const op: { filtros: Array<[string, any[]]>; escrita?: any } = { filtros: [] };
  const resolver = () => Promise.resolve(tabelas[nome] ? tabelas[nome](op) : { data: null, error: null });
  const c: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (ok: any, ko: any) => resolver().then(ok, ko);
      if (prop === 'upsert') return (v: any) => { op.escrita = v; upserts.push({ tabela: nome, v }); return c; };
      return (...a: any[]) => { op.filtros.push([prop, a]); return c; };
    },
  });
  return c;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (n: string) => cadeia(n) } }));

import { lerAnuncioDoPayload, lerAnuncioDaMensagem, relatorioAnuncios } from '../services/agentes5040/anuncio';
import { buscarOrigemDoAnuncio, produtoDaCampanha } from '../services/io/metaConjuntos';

const AD = '120211234567890123';

beforeEach(() => {
  process.env.ZAPI_INSTANCE_ID_IO = 'INST-IO';
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  upserts.length = 0;
});
afterEach(() => {
  delete process.env.ZAPI_INSTANCE_ID_IO;
  vi.unstubAllGlobals();
  delete process.env.META_SYSTEM_USER_TOKEN;
  delete process.env.META_PIXEL_TOKEN;
});

describe('lerAnuncioDoPayload', () => {
  it('externalAdReply completo', () => {
    const a = lerAnuncioDoPayload({
      phone: '5534999990000', text: { message: 'oi' },
      externalAdReply: { sourceId: AD, sourceUrl: 'https://fb.me/abc', title: 'Energia solar', ctwaClid: 'CLID123', sourceType: 'ad', thumbnailUrl: 'x' },
    })!;
    expect(a.adId).toBe(AD);
    expect(a.sourceUrl).toBe('https://fb.me/abc');
    expect(a.titulo).toBe('Energia solar');
    expect(a.sourceType).toBe('ad');
    expect(a.ctwaClid).toBe('CLID123');
    expect(a.camposExternalAdReply).toEqual(expect.arrayContaining(['sourceId', 'ctwaClid', 'thumbnailUrl']));
  });

  it('só o ctwa_clid do topo (webhook antigo): sem id de anúncio', () => {
    const a = lerAnuncioDoPayload({ phone: '5534999990000', ctwa_clid: 'SO-CLID' })!;
    expect(a.ctwaClid).toBe('SO-CLID');
    expect(a.adId).toBeNull();
  });

  it('só adContext: lista branca, e os nomes de campo saem sem valores', () => {
    const a = lerAnuncioDoPayload({
      adContext: { sourceId: AD, title: 'Quiz', segredoInterno: 'nao-passa', aninhado: { fundo: 1 }, lista: [{ x: 1 }] },
    })!;
    expect(a.adId).toBe(AD);
    expect(a.adContext).toEqual({ sourceId: AD, title: 'Quiz' });
    expect(JSON.stringify(a.adContext)).not.toContain('nao-passa');
    expect(a.camposAdContext).toEqual(expect.arrayContaining(['sourceId', 'segredoInterno', 'aninhado.fundo', 'lista[]', 'lista[].x']));
    expect(a.camposAdContext.join('|')).not.toContain('nao-passa');
  });

  it('sourceId que não é id da Meta não vira adId', () => {
    expect(lerAnuncioDoPayload({ externalAdReply: { sourceId: 'abc' } })!.adId).toBeNull();
    expect(lerAnuncioDoPayload({ externalAdReply: { sourceId: '123' } })!.adId).toBeNull();
  });

  it('lixo devolve null e nunca lança', () => {
    for (const x of [null, undefined, 'texto', 42, [], {}, { externalAdReply: 'x', adContext: [] }, { externalAdReply: null }]) {
      expect(lerAnuncioDoPayload(x)).toBeNull();
    }
  });
});

describe('lerAnuncioDaMensagem', () => {
  const UUID = '0b8d9b5e-1c3a-4f6e-9d2a-7a1b2c3d4e5f';

  it('id torto nem consulta o banco', async () => {
    const r = await lerAnuncioDaMensagem('1; drop');
    expect(r.ok).toBe(false);
  });

  it('lê o bloco pelo webhook_debug_id', async () => {
    tabelas.webhook_debug = () => ({ data: { externalAdReply: { sourceId: AD, title: 'T' }, adContext: null, ctwa_clid: null }, error: null });
    const r = await lerAnuncioDaMensagem(UUID);
    expect(r.ok).toBe(true);
    expect(r.anuncio?.adId).toBe(AD);
  });

  it('mensagem sem anúncio: ok com anuncio null', async () => {
    tabelas.webhook_debug = () => ({ data: { externalAdReply: null, adContext: null, ctwa_clid: null }, error: null });
    expect(await lerAnuncioDaMensagem(UUID)).toEqual({ ok: true, anuncio: null });
  });

  it('erro de leitura vira ok:false (quem decide trata como "não sei")', async () => {
    tabelas.webhook_debug = () => ({ data: null, error: { message: 'timeout' } });
    const r = await lerAnuncioDaMensagem(UUID);
    expect(r.ok).toBe(false);
    expect(r.anuncio).toBeNull();
  });
});

describe('buscarOrigemDoAnuncio', () => {
  const respostaMeta = { id: AD, name: 'Anuncio 01', adset: { id: '111', name: 'Conjunto A' }, campaign: { id: '222', name: 'Irmãos na Obra | Quiz Solar' } };

  it('sem token não chama a Meta', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await buscarOrigemDoAnuncio(AD);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/sem META_SYSTEM_USER_TOKEN/);
    expect(f).not.toHaveBeenCalled();
  });

  it('id inválido nem chega na rede', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await buscarOrigemDoAnuncio('(sem)')).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('sucesso: só GET com os campos pedidos, e grava o cache sem dado pessoal', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => respostaMeta }));
    vi.stubGlobal('fetch', f);
    const r = await buscarOrigemDoAnuncio(AD);
    expect(r).toMatchObject({ ok: true, anuncio: { id: AD, nome: 'Anuncio 01' }, conjunto: { id: '111' }, campanha: { id: '222', nome: 'Irmãos na Obra | Quiz Solar' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, any];
    expect(String(url)).toContain(`/${AD}?fields=`);
    expect(decodeURIComponent(String(url))).toContain('name,adset{id,name},campaign{id,name}');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].v.key).toBe(`meta_ad:${AD}`);
    expect(upserts[0].v.value).not.toMatch(/ctwa|phone|telefone/i);
  });

  it('erro da Meta vira ok:false com motivo e não grava cache', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Unsupported get request' } }) })));
    const r = await buscarOrigemDoAnuncio(AD);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('Unsupported get request');
    expect(upserts).toHaveLength(0);
  });

  it('rede que cai também vira ok:false', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const r = await buscarOrigemDoAnuncio(AD);
    expect(r.ok).toBe(false);
  });

  it('cache de menos de 7 dias responde sem chamar a Meta; vencido chama', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => respostaMeta }));
    vi.stubGlobal('fetch', f);
    const guardado = (em: string) => JSON.stringify({ anuncio: { id: AD, nome: 'Velho' }, campanha: { id: '222', nome: 'C' }, em });
    tabelas.system_state = () => ({ data: { value: guardado(new Date(Date.now() - 2 * 86_400_000).toISOString()) }, error: null });
    const novo = await buscarOrigemDoAnuncio(AD);
    expect(novo).toMatchObject({ ok: true, doCache: true, anuncio: { nome: 'Velho' } });
    expect(f).not.toHaveBeenCalled();

    tabelas.system_state = () => ({ data: { value: guardado(new Date(Date.now() - 8 * 86_400_000).toISOString()) }, error: null });
    const vencido = await buscarOrigemDoAnuncio(AD);
    expect(vencido.doCache).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('produtoDaCampanha', () => {
  it('regra por palavra', () => {
    expect(produtoDaCampanha('NEXUS Eletropostos | Quiz')).toBe('eletroposto');
    expect(produtoDaCampanha('Irmãos na Obra - Quiz')).toBe('solar');
    expect(produtoDaCampanha('Quiz Solar 1-1-X')).toBe('solar');
    expect(produtoDaCampanha('SolarDoc propostas')).toBe('solardoc');
    expect(produtoDaCampanha('Solar Doc - teste')).toBe('solardoc');
    expect(produtoDaCampanha('Campanha qualquer')).toBeNull();
    expect(produtoDaCampanha(null)).toBeNull();
  });

  it('o mapa manual vence a regra, sem acento e sem diferença de caixa', () => {
    expect(produtoDaCampanha('Irmãos na Obra | Especial', { 'irmaos na obra | especial': 'eletroposto' })).toBe('eletroposto');
    expect(produtoDaCampanha('Campanha qualquer', { 'CAMPANHA QUALQUER': 'solardoc' })).toBe('solardoc');
  });

  it('valor torto no mapa é ignorado', () => {
    expect(produtoDaCampanha('Quiz Solar', { 'quiz solar': 'banana' })).toBe('solar');
  });
});

describe('relatorioAnuncios', () => {
  it('conta, agrega por anúncio e devolve só NOMES de campo, nunca valores', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    const UUIDS = ['a1', 'a2', 'a3'].map((x, i) => `0b8d9b5e-1c3a-4f6e-9d2a-7a1b2c3d4e0${i}`);
    let paginas = 0;
    tabelas.wa_mensagens = () => {
      paginas++;
      return { data: UUIDS.map((u, i) => ({ id: i + 1, webhook_debug_id: u })).concat([{ id: 9, webhook_debug_id: null as any }]), error: null };
    };
    tabelas.webhook_debug = () => ({
      data: [
        { externalAdReply: { sourceId: AD, ctwaClid: 'SEGREDO-CLID', title: 'Titulo' }, adContext: null, ctwa_clid: 'SEGREDO-CLID' },
        { externalAdReply: { sourceId: AD }, adContext: { campoNovo: 'valor-secreto' }, ctwa_clid: null },
        { externalAdReply: null, adContext: null, ctwa_clid: null },
      ],
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ id: AD, name: 'Anuncio', adset: { id: '1', name: 'S' }, campaign: { id: '2', name: 'Irmãos na Obra | Quiz' } }),
    })));
    const r = await relatorioAnuncios(30, { chaves: true });
    expect(paginas).toBe(1);
    expect(r).toMatchObject({ ok: true, mensagens_recebidas: 4, com_bloco: 2, com_ad_id: 2 });
    expect(r.ids).toEqual([{ id: AD, mensagens: 2, campanha: 'Irmãos na Obra | Quiz', produto: 'solar' }]);
    expect(r.por_produto).toEqual({ solardoc: 0, solar: 2, eletroposto: 0, desconhecido: 0 });
    expect(r.campos_adContext).toEqual(['campoNovo']);
    expect(r.campos_externalAdReply).toEqual(expect.arrayContaining(['sourceId', 'ctwaClid']));
    const saida = JSON.stringify(r);
    expect(saida).not.toContain('SEGREDO-CLID');
    expect(saida).not.toContain('valor-secreto');
  });

  it('sem chaves=1 não devolve a lista de campos; ?dias fora da faixa é limitado', async () => {
    tabelas.wa_mensagens = () => ({ data: [], error: null });
    const r = await relatorioAnuncios(9999, { meta: false });
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(90);
    expect(r).not.toHaveProperty('campos_adContext');
  });

  it('erro de leitura do banco vira ok:false, sem lançar', async () => {
    tabelas.wa_mensagens = () => ({ data: null, error: { message: 'statement timeout' } });
    const r = await relatorioAnuncios(30);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('statement timeout');
  });

  it('pagina no servidor: página cheia pede a seguinte', async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => ({ id: i, webhook_debug_id: null as any }));
    let chamadas = 0;
    tabelas.wa_mensagens = (op) => {
      chamadas++;
      const range = op.filtros.find(([n]) => n === 'range')!;
      return { data: range[1][0] === 0 ? cheia : [{ id: 5000, webhook_debug_id: null }], error: null };
    };
    const r = await relatorioAnuncios(7, { meta: false });
    expect(chamadas).toBe(2);
    expect(r.mensagens_recebidas).toBe(1001);
  });

  it('filtra pela instância da linha IO e se recusa sem ela', async () => {
    let filtros: Array<[string, any[]]> = [];
    tabelas.wa_mensagens = (op) => { filtros = op.filtros; return { data: [], error: null }; };
    await relatorioAnuncios(7, { meta: false });
    expect(filtros).toContainEqual(['eq', ['instancia', 'INST-IO']]);

    delete process.env.ZAPI_INSTANCE_ID_IO;
    filtros = [];
    const r = await relatorioAnuncios(7, { meta: false });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/ZAPI_INSTANCE_ID_IO/);
    expect(filtros).toEqual([]); // nem consultou o banco
  });

  it('Meta lenta: resolve em grupos de 5, para ao estourar o orçamento e marca truncado', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'tok';
    const adIds = Array.from({ length: 12 }, (_, i) => `1202112345678901${String(10 + i)}`);
    tabelas.wa_mensagens = () => ({ data: [{ id: 1, webhook_debug_id: '0b8d9b5e-1c3a-4f6e-9d2a-7a1b2c3d4e00' }], error: null });
    tabelas.webhook_debug = () => ({
      data: adIds.map((id) => ({ externalAdReply: { sourceId: id }, adContext: null, ctwa_clid: null })),
      error: null,
    });
    const f = vi.fn(async () => {
      await new Promise((ok) => setTimeout(ok, 80));
      return { ok: true, status: 200, json: async () => ({ id: AD, name: 'A', campaign: { id: '2', name: 'Quiz Solar' } }) };
    });
    vi.stubGlobal('fetch', f);
    const r = await relatorioAnuncios(30, { orcamentoTotalMs: 120 });
    expect(f).toHaveBeenCalledTimes(10); // 2 grupos de 5; o 3º não começa
    expect(r.truncado).toBe(true);
    expect(r.ids).toHaveLength(12);
    expect(r.por_produto).toEqual({ solardoc: 0, solar: 10, eletroposto: 0, desconhecido: 2 });
  });
});
