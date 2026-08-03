import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Fake do Supabase do Gerador, com estado em memória ──────────────────────
// Respeita o que importa pro motor: o UNIQUE de telefone em prospeccao_contatos
// (é ele que garante "ninguém aborda o mesmo integrador duas vezes") e o lease
// do tick. Sem isso, testar dedup e "não roda a mesma busca duas vezes" seria fé.

type Row = Record<string, any>;
const db: Record<string, Row[]> = { prospeccao_buscas: [], prospeccao_listas: [], prospeccao_contatos: [] };
const telefonesUsados = new Set<string>();

function novoId(p: string) { return p + '-' + Math.random().toString(36).slice(2, 8); }

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  let patch: Row | null = null;
  let pendente: Row[] = [];
  let ignoreDup = false;
  let contarExato = false;

  const linhas = () => db[table].filter(r => filtros.every(f => f(r)));

  function executa(): { data: any; error: any; count?: number } {
    if (modo === 'update') {
      const alvo = linhas();
      alvo.forEach(r => Object.assign(r, patch));
      return { data: alvo, error: null };
    }
    if (modo === 'insert' || modo === 'upsert') {
      const inseridas: Row[] = [];
      for (const p of pendente) {
        if (table === 'prospeccao_contatos') {
          if (telefonesUsados.has(p.telefone)) { if (ignoreDup) continue; return { data: null, error: { message: 'duplicate telefone' } }; }
          telefonesUsados.add(p.telefone);
        }
        const row = { id: novoId(table.slice(-3)), ...p };
        db[table].push(row); inseridas.push(row);
      }
      return { data: inseridas, error: null };
    }
    const l = linhas();
    return { data: l, error: null, count: contarExato ? l.length : undefined };
  }

  const api: any = {
    select(_cols?: string, opts?: any) {
      if (opts?.count === 'exact') contarExato = true;
      return api;   // head:true não encerra a cadeia — .gte()/.in() ainda vêm depois
    },
    insert(v: Row | Row[]) { modo = 'insert'; pendente = Array.isArray(v) ? v : [v]; return api; },
    upsert(v: Row | Row[], opts?: any) {
      modo = 'upsert'; pendente = Array.isArray(v) ? v : [v]; ignoreDup = !!opts?.ignoreDuplicates; return api;
    },
    update(v: Row) { modo = 'update'; patch = v; return api; },
    eq(col: string, val: any) { filtros.push(r => r[col] === val); return api; },
    is(col: string, val: any) { filtros.push(r => (r[col] ?? null) === val); return api; },
    not(col: string, _op: string, val: any) { filtros.push(r => (r[col] ?? null) !== val); return api; },
    in(col: string, vals: any[]) { filtros.push(r => vals.includes(r[col])); return api; },
    gte(col: string, val: any) { filtros.push(r => String(r[col] ?? '') >= String(val)); return api; },
    or(expr: string) {
      // só o que o motor usa: "locked_until.is.null,locked_until.lt.<iso>"
      const iso = (expr.match(/locked_until\.lt\.(.+)$/) || [])[1];
      filtros.push(r => !r.locked_until || (iso ? new Date(r.locked_until) < new Date(iso) : false));
      return api;
    },
    order() { return api; },
    limit() { return api; },
    single() { const r = executa(); return { data: (r.data || [])[0] ?? null, error: r.error }; },
    then(resolve: any) { return Promise.resolve(executa()).then(resolve); },
  };
  return api;
}

vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => query(t) } }));

import {
  runProspeccaoApifyTick, mapearItem, normalizarTelefone, normalizarUf, ehCelular,
} from '../services/io/prospeccaoApifyService';

// ── util de teste ───────────────────────────────────────────────────────────
function enfileirar(extra: Row = {}): Row {
  const b = {
    id: novoId('busca'), criada_em: new Date().toISOString(), criada_por: 'Giovanna',
    fonte: 'google_maps', actor_id: 'compass/crawler-google-places',
    input: { searchStringsArray: ['energia solar'], locationQuery: 'Bahia, Brasil' },
    limite: 50, so_celular: true, lista_nome: 'Solares BA', lista_origem: 'Apify · Google Maps',
    lista_id: null, status: 'pedida', run_id: null, dataset_id: null,
    encontrados: 0, importados: 0, dup: 0, sem_telefone: 0, custo_usd: 0,
    erro: null, cursor_offset: 0, locked_until: null, ...extra,
  };
  db.prospeccao_buscas.push(b);
  return b;
}
const lugar = (o: Row = {}) => ({
  title: 'Alfa Solar', phoneUnformatted: '+5577988880011', phone: '(77) 98888-0011',
  city: 'Barreiras', state: 'Bahia', website: 'alfa.com.br', totalScore: 4.9, reviewsCount: 115, ...o,
});

beforeEach(() => {
  db.prospeccao_buscas = []; db.prospeccao_listas = []; db.prospeccao_contatos = [];
  telefonesUsados.clear();
  delete process.env.APIFY_TOKEN;
  delete process.env.PROSPECCAO_APIFY_OFF;
  vi.restoreAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

// ────────────────────────────────────────────────────────────────────────────
describe('mapeamento do lead', () => {
  it('usa o telefone não formatado e devolve com DDI', () => {
    expect(normalizarTelefone('+55 77 98888-0011')).toBe('5577988880011');
    expect(normalizarTelefone('(77) 98888-0011')).toBe('5577988880011');
    expect(normalizarTelefone('77 3319-0011')).toBe('557733190011');  // fixo ganha DDI, não ganha o 9
  });

  it('separa celular de fixo — fixo não recebe WhatsApp', () => {
    expect(ehCelular('5577988880011')).toBe(true);
    expect(ehCelular('557733190011')).toBe(false);
  });

  it('traduz o estado por extenso do Google pra UF', () => {
    expect(normalizarUf('Bahia')).toBe('BA');
    expect(normalizarUf('Minas Gerais')).toBe('MG');   // cortar em 2 letras daria "MI"
    expect(normalizarUf('SP')).toBe('SP');
    expect(normalizarUf('')).toBeNull();
  });

  it('lê os apelidos de campo de um actor qualquer', () => {
    const c = mapearItem({ name: 'Beta Energia', whatsapp: '5574988090012', locality: 'Juazeiro', region: 'BA', rating: '4,7' });
    expect(c).toMatchObject({ empresa: 'Beta Energia', telefone: '5574988090012', cidade: 'Juazeiro', uf: 'BA', nota: 4.7 });
  });

  it('descarta item sem empresa ou sem telefone', () => {
    expect(mapearItem({ title: 'Sem Telefone Solar' })).toBeNull();
    expect(mapearItem({ phone: '5577988880011' })).toBeNull();
  });

  it('guarda a ficha do Google que vem no mesmo preço', () => {
    const c = mapearItem(lugar({
      address: 'Av. ACM, 100 - Centro, Barreiras - BA, 47800-000',
      neighborhood: 'Centro', postalCode: '47800-000',
      categoryName: 'Fornecedor de energia solar',
      location: { lat: -12.1528, lng: -44.99 },
      url: 'https://maps.google.com/?cid=123', placeId: 'ChIJabc',
      emails: ['contato@alfa.com.br'],
      openingHours: [{ day: 'Monday', hours: '08:00 to 18:00' }],
    }))!;
    expect(c).toMatchObject({
      endereco: 'Av. ACM, 100 - Centro, Barreiras - BA, 47800-000',
      bairro: 'Centro', cep: '47800-000', categoria: 'Fornecedor de energia solar',
      lat: -12.1528, lng: -44.99, place_id: 'ChIJabc', email: 'contato@alfa.com.br',
      maps_url: 'https://maps.google.com/?cid=123',
    });
    // o item cru fica inteiro: o que não virou coluna hoje segue disponível
    expect((c.dados as any).openingHours[0].hours).toBe('08:00 to 18:00');
  });

  it('o link do Maps não entra como site da empresa', () => {
    // `url` no item do Maps é o perfil no Google — se caísse em `site`, todo lugar
    // pareceria ter site e o gancho de venda do Site do integrador sumiria.
    const c = mapearItem(lugar({ website: '', url: 'https://maps.google.com/?cid=9' }))!;
    expect(c.site).toBeNull();
    expect(c.maps_url).toBe('https://maps.google.com/?cid=9');
  });

  it('item gigante é podado em vez de estourar a linha', () => {
    const c = mapearItem(lugar({
      reviews: Array.from({ length: 400 }, (_, i) => ({ text: 'x'.repeat(300), reviewId: 'r' + i })),
    }))!;
    expect((c.dados as any)._podado).toBe(true);
    expect((c.dados as any).reviews).toBeUndefined();
    expect(JSON.stringify(c.dados).length).toBeLessThan(60000);
    expect((c.dados as any).title).toBe('Alfa Solar');   // o que importa continua lá
  });
});

describe('travas de gasto', () => {
  it('kill-switch impede qualquer tick', async () => {
    process.env.PROSPECCAO_APIFY_OFF = 'true';
    enfileirar();
    const r = await runProspeccaoApifyTick();
    expect(r.off).toBe(true);
    expect(db.prospeccao_buscas[0].status).toBe('pedida');
  });

  it('sem APIFY_TOKEN falha fechado, sem chamar a Apify', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const b = enfileirar();
    const r = await runProspeccaoApifyTick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    const linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('erro');
    expect(linha.erro).toContain('APIFY_TOKEN');
  });

  it('respeita o teto de buscas por dia', async () => {
    process.env.APIFY_TOKEN = 'tok';
    // teto padrão = 5 buscas/dia (PROSPECCAO_MAX_BUSCAS_DIA); com 5 já gastas hoje,
    // a sexta não pode sair — é o teto de gasto, não a autenticação.
    for (let i = 0; i < 5; i++) enfileirar({ status: 'concluida' });
    const b = enfileirar();
    vi.stubGlobal('fetch', vi.fn());
    await runProspeccaoApifyTick();
    const linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('erro');
    expect(linha.erro).toContain('buscas por dia');
  });
});

describe('caminho feliz: pedida → rodando → importando → concluída', () => {
  it('roda a Apify e vira lista, jogando fora fechado, fixo e repetido', async () => {
    process.env.APIFY_TOKEN = 'tok';
    const b = enfileirar();

    // 1) inicia a run
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      expect(String(url)).toContain('/acts/compass~crawler-google-places/runs');
      const enviado = JSON.parse(init.body);
      expect(enviado.maxCrawledPlacesPerSearch).toBe(50);
      expect(enviado.language).toBe('pt-BR');
      expect(enviado.countryCode).toBe('br');
      return new Response(JSON.stringify({ data: { id: 'run1', defaultDatasetId: 'ds1', status: 'RUNNING' } }), { status: 201 });
    }));
    await runProspeccaoApifyTick();
    let linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('rodando');
    expect(linha.run_id).toBe('run1');

    // 2) run ainda rodando → não importa nada
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ data: { status: 'RUNNING', usageTotalUsd: 0.02 } }), { status: 200 })));
    await runProspeccaoApifyTick();
    expect(db.prospeccao_buscas.find(x => x.id === b.id)!.status).toBe('rodando');

    // 3) run terminou
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ data: { status: 'SUCCEEDED', usageTotalUsd: 0.21 } }), { status: 200 })));
    await runProspeccaoApifyTick();
    linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('importando');
    expect(Number(linha.custo_usd)).toBeCloseTo(0.21);

    // 4) importa o dataset
    const dataset = [
      lugar(),                                                            // ok
      lugar({ title: 'Beta Energia', phoneUnformatted: '+5574988090012' }),// ok
      lugar({ title: 'Alfa de novo' }),                                   // telefone repetido no próprio dataset
      lugar({ title: 'Gama Fechada', permanentlyClosed: true, phoneUnformatted: '+5577988880033' }),
      lugar({ title: 'Delta Fixo', phoneUnformatted: '+557733190044' }),  // fixo
      lugar({ title: 'Sem Fone Solar', phoneUnformatted: '', phone: '' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toContain('/datasets/ds1/items');
      return new Response(JSON.stringify(dataset), { status: 200 });
    }));
    await runProspeccaoApifyTick();

    linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('concluida');
    expect(linha.encontrados).toBe(6);
    expect(linha.importados).toBe(2);      // Alfa + Beta
    expect(linha.dup).toBe(1);             // "Alfa de novo", mesmo telefone
    expect(linha.sem_telefone).toBe(3);    // fechada + fixo + sem fone
    expect(db.prospeccao_listas).toHaveLength(1);
    expect(db.prospeccao_listas[0].nome).toBe('Solares BA');
    expect(db.prospeccao_contatos.map(c => c.empresa).sort()).toEqual(['Alfa Solar', 'Beta Energia']);
    expect(db.prospeccao_contatos[0]).toMatchObject({ uf: 'BA', cidade: 'Barreiras', nota: 4.9, avaliacoes: 115 });
  });

  it('run que falhou vira erro com link do console, sem criar lista', async () => {
    process.env.APIFY_TOKEN = 'tok';
    const b = enfileirar({ status: 'rodando', run_id: 'run9', dataset_id: 'ds9' });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ data: { status: 'FAILED', usageTotalUsd: 0.05 } }), { status: 200 })));
    await runProspeccaoApifyTick();
    const linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('erro');
    expect(linha.erro).toContain('run9');
    expect(db.prospeccao_listas).toHaveLength(0);
  });

  it('cancelar aborta a run na Apify — senão o gasto continua', async () => {
    process.env.APIFY_TOKEN = 'tok';
    const b = enfileirar({ status: 'cancelada', run_id: 'run7', dataset_id: 'ds7' });
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      chamadas.push(String(url));
      return new Response('{}', { status: 200 });
    }));
    await runProspeccaoApifyTick();
    expect(chamadas.some(u => u.includes('/actor-runs/run7/abort'))).toBe(true);
    const linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('cancelada');
    expect(linha.erro).toContain('abortada');
  });

  it('cancelada já abortada não é abortada de novo a cada tick', async () => {
    process.env.APIFY_TOKEN = 'tok';
    enfileirar({ status: 'cancelada', run_id: 'run8', erro: 'Cancelada — run abortada na Apify.' });
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await runProspeccaoApifyTick();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dataset grande pausa no orçamento do tick e continua do cursor', async () => {
    process.env.APIFY_TOKEN = 'tok';
    // 500 = tamanho da página do motor: a 1ª página cheia obriga a buscar a 2ª
    const pagina1 = Array.from({ length: 500 }, (_, i) =>
      lugar({ title: `Empresa ${i}`, phoneUnformatted: `+55779${String(10000000 + i)}` }));
    const pagina2 = [lugar({ title: 'Ultima Solar', phoneUnformatted: '+5577999990099' })];
    const b = enfileirar({ status: 'importando', run_id: 'runB', dataset_id: 'dsB' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const off = Number((String(url).match(/offset=(\d+)/) || [])[1] || 0);
      return new Response(JSON.stringify(off === 0 ? pagina1 : pagina2), { status: 200 });
    }));
    await runProspeccaoApifyTick();
    const linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.status).toBe('concluida');
    expect(linha.cursor_offset).toBe(501);
    expect(linha.importados).toBe(501);
    expect(db.prospeccao_listas).toHaveLength(1);   // uma lista só, não uma por página
  });

  it('telefone que já existe em outra lista conta como repetido, não como novo', async () => {
    process.env.APIFY_TOKEN = 'tok';
    telefonesUsados.add('5577988880011');                     // já está na base
    db.prospeccao_contatos.push({ id: 'c0', empresa: 'Alfa Solar', telefone: '5577988880011' });
    const b = enfileirar({ status: 'importando', run_id: 'run2', dataset_id: 'ds2' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([lugar()]), { status: 200 })));
    await runProspeccaoApifyTick();
    const linha = db.prospeccao_buscas.find(x => x.id === b.id)!;
    expect(linha.importados).toBe(0);
    expect(linha.dup).toBe(1);
    expect(linha.status).toBe('concluida');
  });
});
