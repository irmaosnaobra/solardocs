import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// A série `#E001` dos clientes de eletroposto (fase 2, etapa 4). Os dois bancos e o login simulados em memória; dados inventados.
// `comTrava` é a de verdade (a trava mora no mesmo `system_state` de mentira). Nenhuma chamada sai para a rede.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: any; updated_at: string }>(),
  insertFalha: false,
  aoInserir: null as null | ((key: string) => 'dup' | void),
  tique: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
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
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const f: Record<string, unknown> = {};
          const b: any = {
            eq: (c: string, v: unknown) => { f[c] = v; return b; },
            ilike: () => b,
            order: () => b,
            range: async () => ({ data: h.cards.filter((r) => ('status' in f ? r.status === f.status : true)).map((c) => ({ ...c })), error: null }),
            maybeSingle: async () => ({ data: h.cards.find((r) => r.id === f.id) ?? null, error: null }),
          };
          return b;
        },
      };
    },
  },
}));
vi.mock('../utils/supabase', () => {
  const stamp = () => `2026-10-22T15:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
  return {
    supabase: {
      storage: {
        getBucket: async () => ({ data: { public: false, file_size_limit: 262144, allowed_mime_types: ['application/json'] }, error: null }),
        from: () => ({
          info: async () => ({ data: null, error: { message: 'Object not found', statusCode: '404' } }),
          download: async () => ({ data: null, error: { message: '{}', status: 400 } }),
          upload: async (p: string) => ({ data: { path: p }, error: null }),
          list: async () => ({ data: [], error: null }),
        }),
      },
      from: (tabela: string) => {
        if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
        return {
          select: () => ({
            in: async (_c: string, chaves: string[]) => ({
              data: chaves.filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null,
            }),
            eq: (_c: string, k: string) => ({
              maybeSingle: async () => {
                const l = h.linhas.get(k);
                return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
              },
            }),
            like: (_c: string, p: string) => {
              const prefixo = p.replace(/%$/, '');
              const chain: any = {
                order: () => chain,
                range: async (de: number, ate: number) => ({
                  data: [...h.linhas.entries()].filter(([k]) => k.startsWith(prefixo)).sort(([a], [b]) => (a < b ? -1 : 1))
                    .slice(de, ate + 1).map(([k, l]) => ({ key: k, value: l.value })),
                  error: null,
                }),
              };
              return chain;
            },
          }),
          insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
            const ehTrava = l.key.startsWith('cadastro_trava:');
            if (!ehTrava && h.insertFalha) return { error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
            const hook = ehTrava ? undefined : h.aoInserir?.(l.key);
            if (hook === 'dup' || h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
            h.linhas.set(l.key, { value: l.value, updated_at: ehTrava ? String(l.updated_at) : stamp() });
            return { error: null };
          },
          delete: () => ({
            eq: (_c: string, k: string) => ({
              eq: (_c2: string, v: string) => ({
                select: async () => {
                  const l = h.linhas.get(k);
                  if (!l || l.updated_at !== v) return { data: [], error: null };
                  h.linhas.delete(k);
                  return { data: [{ key: k }], error: null };
                },
              }),
            }),
          }),
        };
      },
    },
  };
});

import { mountClientesEletroposto } from '../routes/geradorEletropostoClientes';
import {
  SERIE_EP, ordenarPendentes, serieComPassada, alocarLoteDaSerie, lerSerieDosCards, LIMITE_DA_PASSADA,
} from '../services/gerador/eletropostoSerie';
import { alocarCodigoDaSerie } from '../services/gerador/vendaSolarCodigo';
import { inserirRegistro, numeroDoCodigo, chaveCodigoSolar, registroAssinado, reiniciarLogsDoRegistro, SERIE_SOLAR } from '../services/gerador/vendaSolarRegistro';

const r = Router();
mountClientesEletroposto(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';

type Card = Record<string, any>;
const card = (id: number, o: Partial<Card> = {}): Card => ({
  id, cliente_nome: 'Fulano Inventado', cliente_telefone: '5534900000000', cidade: 'Uberlandia', vendedor_nome: 'Nilce',
  created_by: 'lp_eletroposto', status: 'fechou', created_at: '2026-09-10T15:00:00.000Z', quando: null, ...o,
});
const pv = (vendido_em: string) => ({
  modelo: 'meio_a_meio', valor: 1000, vendido_em, etapa: 'projeto', etapa_desde: '2026-10-01T12:00:00.000Z',
  previsto: null, responsavel: '', obs: '', por: 'thiago', em: '2026-10-01T12:00:00.000Z',
});
const pvDe = (id: number, dia: string) => h.linhas.set(`pos_venda:${id}`, { value: pv(dia), updated_at: 'v' });

/** O cenário de hoje (dados inventados): ids fora da ordem das datas, de dois consultores. */
function cenarioDeHoje(): void {
  h.cards = [
    card(1269, { vendedor_nome: 'Nilce' }),      // 19/10
    card(1321, { vendedor_nome: 'Nilce' }),      // 16/10
    card(1326, { vendedor_nome: 'Giovanna' }),   // 15/10
    card(1197, { vendedor_nome: 'Giovanna' }),   // 09/10
    card(1078, { vendedor_nome: 'Nilce' }),      // 05/10
  ];
  pvDe(1269, '2026-10-19'); pvDe(1321, '2026-10-16'); pvDe(1326, '2026-10-15'); pvDe(1197, '2026-10-09'); pvDe(1078, '2026-10-05');
}

beforeEach(() => {
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste-inventado';
  delete process.env.SOLAR_SOCIOS;
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app',
  };
  h.cards = [];
  h.linhas = new Map();
  h.insertFalha = false; h.aoInserir = null; h.tique = 0;
  reiniciarLogsDoRegistro();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.VINCULO_SOLAR_SECRET; });

const get = (auth = THIAGO) => request(app).get('/gerador/clientes/eletroposto').set('Authorization', auth);
const series = (auth = THIAGO) => request(app).get('/gerador/clientes/eletroposto/series').set('Authorization', auth);
const postSerie = (id: string | number, auth = NILCE) => request(app).post(`/gerador/clientes/eletroposto/${id}/serie`).set('Authorization', auth).send({});
const serieDasLinhas = (body: { linhas: Array<{ codigo: string; serie?: string }> }): Record<string, string | undefined> =>
  Object.fromEntries(body.linhas.map((l) => [l.codigo, l.serie]));
const chavesE = (): string[] => [...h.linhas.keys()].filter((k) => k.startsWith('ep_serie_cod:')).sort();

describe('a série E: formato e registro', () => {
  it('E001, três ou mais dígitos; a chave leva o código; E1000 vem depois de E999 e volta da chave', () => {
    expect(SERIE_EP.formatar(1)).toBe('E001');
    expect(SERIE_EP.formatar(999)).toBe('E999');
    expect(SERIE_EP.formatar(1000)).toBe('E1000');
    expect(numeroDoCodigo('E001', SERIE_EP)).toBe(1);
    expect(numeroDoCodigo('E1000', SERIE_EP)).toBe(1000);
    expect(numeroDoCodigo('#0065', SERIE_EP)).toBeNull();
    expect(numeroDoCodigo('E01', SERIE_EP)).toBeNull();
    expect(chaveCodigoSolar('E001', SERIE_EP)).toBe('ep_serie_cod:E001');
    expect(chaveCodigoSolar('E1000', SERIE_EP)).toBe('ep_serie_cod:E1000');
  });

  it('depois de E999 vem E1000, e o registro de E1000 se lê de volta', async () => {
    expect(await inserirRegistro({ codigo: 'E999', card: 9, por: 'x', em: '2026-10-22T15:00:00.000Z', origem: 'novo' }, SERIE_EP)).toBe('ok');
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 10, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: 'E1000' });
    const lidos = await lerSerieDosCards();
    expect(lidos.get(10)).toBe('E1000');
    expect(registroAssinado('ep_serie_cod:E1000', h.linhas.get('ep_serie_cod:E1000')!.value, SERIE_EP)?.card).toBe(10);
  });

  it('próximo número, idempotência e card que já tem código; a série solar é recusada', async () => {
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 301, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: 'E001' });
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 302, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: 'E002' });
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 301, por: 'giovanna' })).toEqual({ ok: true, acao: 'ja_tinha', codigo: 'E001' });
    await expect(alocarCodigoDaSerie(SERIE_SOLAR, { card: 301, por: 'nilce' })).rejects.toBeTruthy();
    expect(chavesE()).toEqual(['ep_serie_cod:E001', 'ep_serie_cod:E002']);
  });

  it('dois pedidos ao mesmo tempo para cards diferentes: códigos diferentes, sem repetir', async () => {
    const [a, b] = await Promise.all([
      alocarCodigoDaSerie(SERIE_EP, { card: 401, por: 'nilce' }),
      alocarCodigoDaSerie(SERIE_EP, { card: 402, por: 'giovanna' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const cods = [a, b].map((x) => (x.ok ? x.codigo : '')).sort();
    expect(cods).toEqual(['E001', 'E002']);
    expect(chavesE()).toEqual(['ep_serie_cod:E001', 'ep_serie_cod:E002']);
  });

  it('dois pedidos ao mesmo tempo para o MESMO card: um código só', async () => {
    const [a, b] = await Promise.all([
      alocarCodigoDaSerie(SERIE_EP, { card: 501, por: 'nilce' }),
      alocarCodigoDaSerie(SERIE_EP, { card: 501, por: 'nilce' }),
    ]);
    expect(a).toMatchObject({ ok: true, codigo: 'E001' });
    expect(b).toMatchObject({ ok: true, codigo: 'E001' });
    expect(chavesE()).toEqual(['ep_serie_cod:E001']);
  });

  it('23505 no INSERT (a trava venceu e outro gravou): pula o número e usa o seguinte, sem repetir', async () => {
    let primeira = true;
    h.aoInserir = (k) => { if (k === 'ep_serie_cod:E001' && primeira) { primeira = false; return 'dup'; } };
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 601, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: 'E002' });
  });

  it('registro sem assinatura válida é ignorado no máximo e o número dele é pulado, nunca reusado', async () => {
    h.linhas.set('ep_serie_cod:E001', { value: { codigo: 'E001', card: 7, por: 'x', em: '2026-10-22T15:00:00.000Z', origem: 'novo', sig: 'forjada' }, updated_at: 'v' });
    h.linhas.set('ep_serie_cod:E050', { value: { codigo: 'E050', card: 8, por: 'x', em: '2026-10-22T15:00:00.000Z', origem: 'novo', sig: 'forjada' }, updated_at: 'v' });
    expect((await lerSerieDosCards()).size).toBe(0);
    // O máximo válido é 0: o próximo é E001, que está ocupado por linha forjada, então pula para E002.
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 701, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: 'E002' });
  });

  it('o registro não leva dado pessoal: só código, card, por, em, origem e sig', async () => {
    await alocarCodigoDaSerie(SERIE_EP, { card: 801, por: 'nilce' });
    const v = h.linhas.get('ep_serie_cod:E001')!.value;
    expect(Object.keys(v).sort()).toEqual(['card', 'codigo', 'em', 'origem', 'por', 'sig']);
  });

  it('sem segredo no ambiente nada é gravado', async () => {
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    expect(await alocarCodigoDaSerie(SERIE_EP, { card: 901, por: 'nilce' })).toEqual({ ok: false, motivo: 'sem_segredo' });
    expect(chavesE()).toEqual([]);
  });
});

describe('ordenarPendentes', () => {
  it('vendido_em com horário vale pela data dos 10 primeiros caracteres (não vai para o fim da fila)', () => {
    const cards = [card(1), card(2), card(3), card(4)] as any[];
    const pvs = new Map<number, unknown>([
      [1, pv('2026-10-05T15:30:00.000Z')], [2, pv('2026-10-04 12:00')], [3, pv('2026-10-06')], [4, pv('2026-10-0512')],
    ]);
    // 4 tem lixo colado na data (sem T nem espaço): sem data válida, fim da fila.
    expect(ordenarPendentes(cards, pvs).map((c) => c.id)).toEqual([2, 1, 3, 4]);
  });
  it('vendido_em, depois quando, depois id; sem data válida vai depois de quem tem', () => {
    const cards = [
      card(5), card(4, { quando: '2026-10-08T12:00:00.000Z' }), card(3, { quando: '2026-10-07T12:00:00.000Z' }), card(2), card(1),
    ] as any[];
    const pvs = new Map<number, unknown>([[5, pv('2026-10-05')], [4, pv('2026-10-05')], [3, pv('2026-10-05')], [2, pv('2026-10-04')]]);
    // 1 não tem pós-venda: vai por último. 2 (04/10) vem primeiro. Entre os de 05/10: quando (3 antes de 4), e o sem `quando` (5) depois.
    expect(ordenarPendentes(cards, pvs).map((c) => c.id)).toEqual([2, 3, 4, 5, 1]);
  });
  it('vendido_em torto (não AAAA-MM-DD) conta como sem data', () => {
    const cards = [card(10), card(11)] as any[];
    const pvs = new Map<number, unknown>([[10, pv('ontem')], [11, pv('2026-10-01')]]);
    expect(ordenarPendentes(cards, pvs).map((c) => c.id)).toEqual([11, 10]);
  });
});

describe('a passada de pendentes na leitura da lista (retroativo)', () => {
  it('os 5 vendidos de hoje saem na ordem do vendido_em, mesmo quando um CONSULTOR abre a lista primeiro', async () => {
    cenarioDeHoje();
    // Nilce abre primeiro: ela só vê os dela, mas a numeração é global.
    const nilce = await get(NILCE);
    expect(nilce.status).toBe(200);
    expect(serieDasLinhas(nilce.body)).toEqual({ '1269': 'E005', '1321': 'E004', '1078': 'E001' });
    const socio = await get(THIAGO);
    expect(serieDasLinhas(socio.body)).toEqual({ '1326': 'E003', '1269': 'E005', '1321': 'E004', '1197': 'E002', '1078': 'E001' });
    // A célula só de leitura vem com o `#`; o código do card continua sendo a chave.
    const lin = socio.body.linhas.find((l: any) => l.codigo === '1078');
    expect(lin.celulas.serie).toMatchObject({ valor: '#E001', origem: 'sistema' });
    const col = socio.body.catalogo.colunas.find((c: any) => c.chave === 'serie');
    expect(col).toMatchObject({ grupo: 'Venda', editavel: false, obrigatoria: false });
    // O registro não tem dado pessoal (a ficha tem nome e telefone; o `system_state` da série não).
    const tudo = JSON.stringify(chavesE().map((k) => h.linhas.get(k)!.value));
    expect(tudo).not.toMatch(/Fulano|5534900000000|Uberlandia/);
    for (const k of chavesE()) expect(Object.keys(h.linhas.get(k)!.value).sort()).toEqual(['card', 'codigo', 'em', 'origem', 'por', 'sig']);
  });

  it('card fechou sem pós-venda (o "Depois" da Agenda) entra depois dos 5 com data: #E006; sem data, vale quando e depois o id', async () => {
    cenarioDeHoje();
    h.cards.push(card(1500, { quando: '2026-10-21T12:00:00.000Z' }), card(1400, { quando: '2026-10-21T12:00:00.000Z' }), card(1450, { quando: '2026-10-10T12:00:00.000Z' }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(serieDasLinhas(res.body)).toMatchObject({ '1078': 'E001', '1197': 'E002', '1326': 'E003', '1321': 'E004', '1269': 'E005' });
    expect(serieDasLinhas(res.body)).toMatchObject({ '1450': 'E006', '1400': 'E007', '1500': 'E008' });
  });

  it('numera uma vez só: a segunda leitura não renumera e editar o vendido_em depois não muda nada', async () => {
    cenarioDeHoje();
    const a = await get();
    pvDe(1078, '2026-10-30');   // a data da venda mais antiga foi editada para a mais nova
    const b = await get();
    expect(serieDasLinhas(b.body)).toEqual(serieDasLinhas(a.body));
    expect(serieDasLinhas(b.body)['1078']).toBe('E001');
    expect(chavesE()).toHaveLength(5);
  });

  it('o card que sai de fechou mantém o código e o número não é reusado', async () => {
    cenarioDeHoje();
    await get();
    h.cards = h.cards.map((c) => (c.id === 1078 ? { ...c, status: 'agendado' } : c));   // desmarcarVenda
    h.cards.push(card(1400));
    pvDe(1400, '2026-10-20');
    const depois = await get();
    expect(serieDasLinhas(depois.body)['1400']).toBe('E006');
    expect(h.linhas.has('ep_serie_cod:E001')).toBe(true);
    // Volta a vender: recebe o MESMO código de antes.
    h.cards = h.cards.map((c) => (c.id === 1078 ? { ...c, status: 'fechou' } : c));
    expect(serieDasLinhas((await get()).body)['1078']).toBe('E001');
  });

  it('no máximo 20 por passada: 25 pendentes dão 20 e depois 5', async () => {
    h.cards = Array.from({ length: 25 }, (_, i) => card(2000 + i));
    for (let i = 0; i < 25; i++) pvDe(2000 + i, `2026-09-${String(i + 1).padStart(2, '0')}`);
    const a = await get();
    expect(a.body.linhas.filter((l: any) => l.serie)).toHaveLength(LIMITE_DA_PASSADA);
    expect(serieDasLinhas(a.body)['2000']).toBe('E001');
    expect(serieDasLinhas(a.body)['2019']).toBe('E020');
    expect(serieDasLinhas(a.body)['2020']).toBeUndefined();
    const b = await get();
    expect(b.body.linhas.filter((l: any) => l.serie)).toHaveLength(25);
    expect(serieDasLinhas(b.body)['2024']).toBe('E025');
    expect(serieDasLinhas(b.body)['2000']).toBe('E001');
  });

  it('falha ao gravar a série não derruba a lista', async () => {
    cenarioDeHoje();
    h.insertFalha = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.linhas).toHaveLength(5);
    expect(res.body.linhas.some((l: any) => l.serie)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('VALOR-SECRETO-NO-ERRO');
    // E o log só leva o código do erro.
    const saidas = (console.error as any).mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(saidas).not.toContain('VALOR-SECRETO-NO-ERRO');
    expect(saidas).not.toMatch(/Fulano|5534900000000/);
    h.insertFalha = false;
    expect(serieDasLinhas((await get()).body)['1078']).toBe('E001');   // a próxima leitura cobre
  });

  it('sem segredo a lista sai sem série e sem erro', async () => {
    cenarioDeHoje();
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.linhas.some((l: any) => l.serie)).toBe(false);
    expect(chavesE()).toEqual([]);
  });

  it('card de solar ou não vendido nunca entra na série', async () => {
    h.cards = [card(11), card(12, { created_by: 'lp_solar' }), card(13, { status: 'agendado' })];
    pvDe(11, '2026-10-01');
    const res = await get();
    expect(serieDasLinhas(res.body)).toEqual({ '11': 'E001' });
    expect(chavesE()).toEqual(['ep_serie_cod:E001']);
  });

  it('serieComPassada com a trava ocupada devolve o que há, sem esperar e sem erro', async () => {
    cenarioDeHoje();
    h.linhas.set('cadastro_trava:eletroposto_serie', { value: { por: 'outro', ate: new Date(Date.now() + 60_000).toISOString() }, updated_at: new Date().toISOString() });
    const t0 = Date.now();
    const m = await serieComPassada(h.cards as any[]);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(m.size).toBe(0);
    expect(chavesE()).toEqual([]);
  });
});

describe('POST /clientes/eletroposto/:id/serie', () => {
  it('exige login (401) e id válido (400)', async () => {
    expect((await request(app).post('/gerador/clientes/eletroposto/1/serie').send({})).status).toBe(401);
    expect((await postSerie('abc')).status).toBe(400);
    expect((await postSerie(0)).status).toBe(400);
  });

  it('dá o código e é idempotente: o segundo pedido devolve o mesmo com criou false', async () => {
    h.cards = [card(31), card(32)];
    const a = await postSerie(31);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ ok: true, serie: 'E001', criou: true });
    const b = await postSerie(31);
    expect(b.body).toEqual({ ok: true, serie: 'E001', criou: false });
    // O 32 também estava pendente: a passada do primeiro pedido já o numerou (na ordem), então aqui ele só é devolvido.
    expect((await postSerie(32)).body).toEqual({ ok: true, serie: 'E002', criou: false });
    expect(chavesE()).toHaveLength(2);
  });

  it('serve qualquer modelo de negócio, inclusive card sem pós-venda', async () => {
    h.cards = [card(41), card(42), card(43)];
    h.linhas.set('pos_venda:42', { value: { ...pv('2026-10-01'), modelo: 'arrendamento' }, updated_at: 'v' });
    h.linhas.set('pos_venda:43', { value: { ...pv('2026-10-01'), modelo: 'cotista' }, updated_at: 'v' });
    for (const id of [41, 42, 43]) expect((await postSerie(id)).body.ok).toBe(true);
  });

  it('404 igual para card inexistente, alheio, de solar e não vendido; nada é gravado', async () => {
    h.cards = [
      card(51, { vendedor_nome: 'Giovanna' }),                    // alheio para a Nilce
      card(52, { created_by: 'lp_solar' }),                       // solar
      card(53, { status: 'agendado' }),                           // não vendido
    ];
    const respostas = [];
    for (const id of [51, 52, 53, 999]) respostas.push(await postSerie(id, NILCE));
    respostas.push(await postSerie(52, THIAGO));                  // solar nem para o sócio
    for (const x of respostas) {
      expect(x.status).toBe(404);
      expect(x.body).toEqual(respostas[0].body);
    }
    expect(chavesE()).toEqual([]);
    // O dono (Giovanna) e o sócio conseguem no card 51.
    expect((await postSerie(51, GIOVANNA)).status).toBe(200);
  });

  it('o código da lista é o mesmo da rota e o mapa de séries respeita o papel', async () => {
    h.cards = [card(61, { vendedor_nome: 'Nilce' }), card(62, { vendedor_nome: 'Giovanna' })];
    pvDe(61, '2026-10-01'); pvDe(62, '2026-10-02');
    // O gancho do 62 (mais novo) numera antes o 61, que é mais antigo: a ordem vale mesmo sem leitura da lista.
    expect((await postSerie(62, GIOVANNA)).body).toEqual({ ok: true, serie: 'E002', criou: true });
    expect((await series(NILCE)).body.series).toEqual({ '61': 'E001' });   // o 62 é de outra pessoa e não aparece para ela
    expect((await series(THIAGO)).body.series).toEqual({ '61': 'E001', '62': 'E002' });
    expect((await series(GIOVANNA)).body.series).toEqual({ '62': 'E002' });
    expect((await request(app).get('/gerador/clientes/eletroposto/series')).status).toBe(401);
  });

  it('o gancho de uma venda ANTIGA regravada, antes de qualquer leitura da lista, não fura a fila: o mais novo recebe o número dele', async () => {
    cenarioDeHoje();
    const nova = await postSerie(1269, NILCE);          // 19/10, o mais novo dos 5
    expect(nova.status).toBe(200);
    expect(nova.body).toEqual({ ok: true, serie: 'E005', criou: true });
    expect(chavesE()).toHaveLength(5);                  // os mais antigos foram numerados antes, em ordem
    const socio = await series(THIAGO);
    expect(socio.body.series).toEqual({ '1078': 'E001', '1197': 'E002', '1326': 'E003', '1321': 'E004', '1269': 'E005' });
    // De novo: o mesmo número, criou false.
    expect((await postSerie(1269, NILCE)).body).toEqual({ ok: true, serie: 'E005', criou: false });
    expect((await get(THIAGO)).status).toBe(200);
    expect(chavesE()).toHaveLength(5);
  });

  it('GET /series com o banco fora (ou sem segredo) responde 503, nunca 200 vazio', async () => {
    cenarioDeHoje();
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    const res = await series(THIAGO);
    expect(res.status).toBe(503);
    expect(res.body.series).toBeUndefined();
  });

  it('trava ocupada: 409 com tentarDeNovo', async () => {
    h.cards = [card(71)];
    h.linhas.set('cadastro_trava:eletroposto_serie', { value: { por: 'outro', ate: new Date(Date.now() + 60_000).toISOString() }, updated_at: new Date().toISOString() });
    const res = await postSerie(71);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, conflito: true, tentarDeNovo: true });
  }, 30_000);
});

describe('alocarLoteDaSerie', () => {
  it('card que já tem código recebe o mesmo e o lote continua do maior', async () => {
    await alocarCodigoDaSerie(SERIE_EP, { card: 1, por: 'x' });
    const lote = await alocarLoteDaSerie([2, 1, 3], 'passada');
    expect(lote.ok && [...lote.codigos.entries()]).toEqual([[2, 'E002'], [1, 'E001'], [3, 'E003']]);
    expect(lote.ok && [...lote.criou]).toEqual([2, 3]);
  });
});
