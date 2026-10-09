import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// MAPA DO ARRENDAMENTO — endereço → coordenada (08/10/2026).
//
// Cada teste aqui é um erro que apareceu geocodificando a base de verdade:
// travessão como separador, CEP da cidade inteira, rua de mesmo nome em outro
// estado, cidade de nome repetido sem UF. Os endereços abaixo são públicos ou
// inventados: o repositório é público e nenhum endereço da base entra aqui.
// ─────────────────────────────────────────────────────────────────────────────

const estado: Record<string, unknown> = {};
let upserts = 0;
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (_c: string, chaves: string[]) => Promise.resolve({
          data: chaves.filter(k => k in estado).map(k => ({ key: k, value: estado[k] })), error: null }),
      }),
      upsert: (row: { key: string; value: unknown }) => { upserts++; estado[row.key] = row.value; return Promise.resolve({ error: null }); },
    }),
  },
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
  partirEndereco, ehCepDaCidade, temNomeDeRua, ufDoDdd, resolverMunicipio,
  confereAchado, chaveCache, kmEntre, geocodificarLote, guardadoServe,
} from '../services/io/eletropostoGeo';

describe('partirEndereco', () => {
  it('lê o formato da LP, com ponto médio', () => {
    const e = partirEndereco('Avenida Paulista, 1578 · Bela Vista · São Paulo-SP · CEP 01310-200')!;
    expect(e).toMatchObject({ rua: 'Avenida Paulista, 1578', ruaSemNum: 'Avenida Paulista', numero: '1578',
      bairro: 'Bela Vista', cidade: 'São Paulo-SP', cep: '01310200', estruturado: true });
  });

  it('lê ficha de antes de 10/09, separada com travessão', () => {
    const e = partirEndereco('Rua Inventada, 45 — Centro — Araguari-MG — CEP 38440-000 — Obs.: fundos')!;
    expect(e).toMatchObject({ ruaSemNum: 'Rua Inventada', numero: '45', bairro: 'Centro',
      cidade: 'Araguari-MG', cep: '38440000', estruturado: true });
  });

  it('acha a cidade sem UF quando o município já é conhecido', () => {
    const sem = partirEndereco('Rua Inventada, 10 · Centro · Araguari')!;
    expect(sem.estruturado).toBe(false);
    const com = partirEndereco('Rua Inventada, 10 · Centro · Araguari', 'Araguari')!;
    expect(com).toMatchObject({ cidade: 'Araguari', bairro: 'Centro', estruturado: true });
  });

  it('vazio é null, não endereço vazio', () => {
    expect(partirEndereco('')).toBeNull();
    expect(partirEndereco(null)).toBeNull();
  });
});

describe('as réguas pequenas', () => {
  it('CEP terminado em 000 é o da cidade inteira', () => {
    expect(ehCepDaCidade('38440000')).toBe(true);
    expect(ehCepDaCidade('01310200')).toBe(false);
  });

  it('"Quadra 12 Lote 3" não é nome de rua; "Av. Brasil" é', () => {
    expect(temNomeDeRua('Quadra 12 Lote 3')).toBe(false);
    expect(temNomeDeRua('Qd 7 Lt 2')).toBe(false);
    expect(temNomeDeRua('Av. Brasil')).toBe(true);
    expect(temNomeDeRua('Rua das Acácias')).toBe(true);
  });

  it('DDD vira UF', () => {
    expect(ufDoDdd('34')).toBe('MG');
    expect(ufDoDdd('86')).toBe('PI');
    expect(ufDoDdd('61')).toBe('DF');
    expect(ufDoDdd('10')).toBeNull();
    expect(ufDoDdd('')).toBeNull();
  });

  it('kmEntre não arredonda (as réguas são de 2 e 15 km)', () => {
    const d = kmEntre({ lat: -18.0, lng: -48.0 }, { lat: -18.0135, lng: -48.0 });
    expect(d).toBeGreaterThan(1.4);
    expect(d).toBeLessThan(1.6);
  });
});

describe('resolverMunicipio', () => {
  it('usa a cidade do endereço antes do campo cidade', () => {
    expect(resolverMunicipio('Rua X, 1 · Centro · Araguari-MG · CEP 38440-000', 'Uberlândia', '34'))
      .toMatchObject({ municipio: 'Araguari', uf: 'MG' });
  });

  it('nome repetido sem UF: o DDD desempata', () => {
    // "Bom Jesus" existe em vários estados; sem UF o resolvedor offline recusa.
    expect(resolverMunicipio('Rua X, 1 · Centro · Bom Jesus', 'Bom Jesus', null)).toBeNull();
    expect(resolverMunicipio('Rua X, 1 · Centro · Bom Jesus', 'Bom Jesus', '86'))
      .toMatchObject({ municipio: 'Bom Jesus', uf: 'PI' });
  });

  it('o DDD não transforma bairro em cidade', () => {
    // "Santa Rita" é bairro aqui; o município é ilegível. Melhor sem pino que pino em outra cidade.
    expect(resolverMunicipio('Rua X, 1 · Santa Rita · Cidade Que Nao Existe', 'Cidade Que Nao Existe', '83')).toBeNull();
  });
});

describe('confereAchado', () => {
  const mun = { municipio: 'Araguari', uf: 'MG', lat: -18.65, lng: -48.19 };
  const centro = { lat: -18.647, lng: -48.187 };

  it('aceita a mesma cidade e a mesma UF', () => {
    expect(confereAchado({ lat: -18.65, lon: -48.19,
      address: { city: 'Araguari', 'ISO3166-2-lvl4': 'BR-MG' } }, mun, centro)).toBe(true);
  });

  it('recusa rua de mesmo nome em outro estado', () => {
    expect(confereAchado({ lat: -23.55, lon: -46.63,
      address: { city: 'São Paulo', 'ISO3166-2-lvl4': 'BR-SP' } }, mun, centro)).toBe(false);
  });

  it('recusa a mesma UF longe da cidade', () => {
    expect(confereAchado({ lat: -18.91, lon: -48.27,
      address: { city: 'Uberlândia', 'ISO3166-2-lvl4': 'BR-MG' } }, mun, centro)).toBe(false);
  });

  it('aceita distrito com outro nome colado na cidade', () => {
    expect(confereAchado({ lat: -18.70, lon: -48.20,
      address: { village: 'Distrito Inventado', 'ISO3166-2-lvl4': 'BR-MG' } }, mun, centro)).toBe(true);
  });
});

describe('chaveCache', () => {
  const mun = { municipio: 'Araguari', uf: 'MG', lat: 0, lng: 0 };
  it('é a mesma para o mesmo endereço com caixa e acento diferentes', () => {
    expect(chaveCache('Rua Inventada, 45', mun)).toBe(chaveCache('  RUA  inventada, 45 ', mun));
  });
  it('muda quando o endereço muda', () => {
    expect(chaveCache('Rua Inventada, 45', mun)).not.toBe(chaveCache('Rua Inventada, 46', mun));
  });
  it('não carrega o endereço na chave', () => {
    expect(chaveCache('Rua Inventada, 45', mun)).toMatch(/^ep_geo:[0-9a-f]{24}$/);
  });
});

describe('guardadoServe — o que o cache ainda pode devolver', () => {
  const base = { lat: -18.6, lng: -48.1, municipio: 'Araguari', uf: 'MG' };
  const agora = Date.parse('2026-10-08T12:00:00Z');

  it('"CEP" da versão 1 é refeito: era centro de cidade vindo do BrasilAPI', () => {
    expect(guardadoServe({ ...base, precisao: 'cep', v: 1 }, agora)).toBe(false);
    expect(guardadoServe({ ...base, precisao: 'cep' }, agora)).toBe(false);
    expect(guardadoServe({ ...base, precisao: 'cep', v: 2 }, agora)).toBe(true);
  });

  it('rua, número, bairro e cidade da versão 1 continuam valendo (nunca passaram pelo BrasilAPI)', () => {
    for (const precisao of ['rua', 'numero', 'bairro', 'cidade'] as const) {
      expect(guardadoServe({ ...base, precisao, v: 1 }, agora), precisao).toBe(true);
    }
  });

  it('parcial vale um dia e depois é refeito', () => {
    expect(guardadoServe({ ...base, precisao: 'rua', v: 2, parcial: true, em: '2026-10-08T02:00:00Z' }, agora)).toBe(true);
    expect(guardadoServe({ ...base, precisao: 'rua', v: 2, parcial: true, em: '2026-10-06T12:00:00Z' }, agora)).toBe(false);
    expect(guardadoServe({ ...base, precisao: 'rua', v: 2, parcial: true }, agora)).toBe(false);
  });

  it('lixo não serve', () => {
    expect(guardadoServe(null, agora)).toBe(false);
    expect(guardadoServe({ ...base, precisao: 'galaxia' as never, v: 2 }, agora)).toBe(false);
  });
});

describe('geocodificarLote', () => {
  beforeEach(() => {
    for (const k of Object.keys(estado)) delete estado[k];
    upserts = 0;
    vi.restoreAllMocks();
  });

  it('cidade ilegível volta null, sem gastar rede', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const r = await geocodificarLote([{ k: 'a', endereco: 'Rua X, 1', cidade: 'Joinvikle', ddd: null }]);
    expect(r).toEqual({ pontos: { a: null }, pendentes: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('o que está no cache sai do cache, sem rede', async () => {
    const mun = resolverMunicipio('', 'Araguari-MG', null)!;
    estado[chaveCache('Rua Inventada, 45 · Centro · Araguari-MG', mun)] =
      { lat: -18.6, lng: -48.1, precisao: 'rua', municipio: 'Araguari', uf: 'MG' };
    const f = vi.spyOn(globalThis, 'fetch');
    const r = await geocodificarLote([{ k: 'a', endereco: 'Rua Inventada, 45 · Centro · Araguari-MG', cidade: '', ddd: '34' }]);
    expect(r.pontos.a).toMatchObject({ precisao: 'rua', uf: 'MG' });
    expect(r.pendentes).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('acima do teto de novos, o resto fica pendente em vez de travar a tela', async () => {
    const r = await geocodificarLote([
      { k: 'a', endereco: 'Rua A, 1 · Centro · Araguari-MG', cidade: '', ddd: '' },
      { k: 'b', endereco: 'Rua B, 2 · Centro · Araguari-MG', cidade: '', ddd: '' },
    ], { maxNovos: 0 });
    expect(r.pendentes).toBe(2);
    expect(r.pontos).toEqual({});
  });

  it('CEP recusado: o ponto sai com a precisão de verdade e fica marcado parcial no cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('awesomeapi')) return new Response('limite', { status: 503 });
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const endereco = 'Rua Sem Nome No Mapa, 9 · Centro · Araguari-MG · CEP 38440-123';
    const r = await geocodificarLote([{ k: 'a', endereco, cidade: '', ddd: '34' }], { maxNovos: 1 });
    expect(r.pendentes).toBe(0);
    // `parcial` vai pra tela: é a deixa pro navegador tentar o CEP por conta própria.
    expect(r.pontos.a).toMatchObject({ precisao: 'cidade', uf: 'MG', parcial: true });
    const mun = resolverMunicipio(endereco, '', '34')!;
    expect(estado[chaveCache(endereco, mun)]).toMatchObject({ precisao: 'cidade', parcial: true, v: 2 });
    // e quem lê do cache também recebe a marca
    vi.restoreAllMocks();
    const f = vi.spyOn(globalThis, 'fetch');
    const de = await geocodificarLote([{ k: 'b', endereco, cidade: '', ddd: '34' }]);
    expect(de.pontos.b).toMatchObject({ parcial: true });
    expect(f).not.toHaveBeenCalled();
  }, 20000);

  it('com AWESOMEAPI_KEY no ambiente, a chave vai no cabeçalho do CEP', async () => {
    process.env.AWESOMEAPI_KEY = 'chave-de-teste';
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init?: RequestInit) => {
      chamadas.push({ url: String(url), headers: (init?.headers || {}) as Record<string, string> });
      if (String(url).includes('awesomeapi')) return new Response('limite', { status: 503 });
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    try {
      await geocodificarLote([{ k: 'a', endereco: 'Rua Outra Sem Mapa, 3 · Centro · Araguari-MG · CEP 38440-456', cidade: '', ddd: '34' }],
        { maxNovos: 1 });
      const cep = chamadas.find(c => c.url.includes('awesomeapi'));
      expect(cep?.headers['x-api-key']).toBe('chave-de-teste');
    } finally {
      delete process.env.AWESOMEAPI_KEY;
    }
  }, 20000);

  it('Nominatim fora: fica pendente e não grava ponto ruim no cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede fora'));
    const r = await geocodificarLote([{ k: 'a', endereco: 'Rua A, 1 · Centro · Araguari-MG', cidade: '', ddd: '' }],
      { maxNovos: 1 });
    // A sede da cidade cai no IBGE, mas a busca da rua falha: a linha volta pendente.
    expect(r.pendentes).toBe(1);
    expect(upserts).toBe(0);
  });
});
