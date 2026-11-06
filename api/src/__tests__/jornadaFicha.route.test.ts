import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

// A ficha consolidada da venda solar (06/11/2026): GET /jornada-solar/obra/:card/ficha e GET /jornada-solar/proposta/:codigo/venda. Login, os dois
// bancos, o Storage e a IA SIMULADOS (a API da Anthropic nunca é chamada). Só LEITURA: nada grava, nada chama IA. Dados inventados.
// O `system_state` simulado REORDENA as chaves de todo objeto no INSERT e no UPDATE (como o jsonb) e entende o `alias:value->a->>b` do select.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  agendamentos: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: any; updated_at: string }>(),
  priv: new Map<string, string>(),
  bucket: new Map<string, Buffer>(),
  tique: 0,
  iaChamadas: 0,
  ia: null as null | ((e: { bytes: Buffer; media_type: string }) => unknown),
  nota: null as null | (() => unknown),
  filas: new Map<string, Promise<void>>(),
  etapaPlanilha: undefined as string | undefined,
  cad: {} as Record<string, string>,
  cadIa: {} as Record<string, string>,
  propostas: [] as Array<Record<string, any>>,
  obrasPlanilha: [] as any[],
  pdfTam: [] as number[],
  pdfFechou: 0,
  pdfHtmls: [] as string[],
  pdfFalha: false,
  recusaTipo: false,
  falhaReserva: false,
}));

const jsonb = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : 1)).map(([k, x]) => [k, jsonb(x)]));
  }
  return v;
};

/** Escolhe as colunas de um select do PostgREST: `key`, `value`, `updated_at` e `alias:value->a->>b`. */
function colunas(cols: string, key: string, row: { value: any; updated_at: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const bruto of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(?:(\w+):)?(.+)$/.exec(bruto)!;
    const alias = m[1];
    const expr = m[2];
    if (expr === 'key') out[alias ?? 'key'] = key;
    else if (expr === 'value') out[alias ?? 'value'] = row.value;
    else if (expr === 'updated_at') out[alias ?? 'updated_at'] = row.updated_at;
    else if (expr.startsWith('value->')) {
      let v: any = row.value;
      for (const t of expr.replace(/^value(->>|->)/, '').split(/->>|->/)) v = v && typeof v === 'object' ? v[t] : undefined;
      out[alias ?? expr] = v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
  return out;
}

function tabela(fonte: () => Array<Record<string, any>>) {
  const filtros: Array<(r: any) => boolean> = [];
  const lista = () => fonte().filter((r) => filtros.every((f) => f(r))).map((r) => ({ ...r }));
  const b: any = {
    select: () => b,
    eq: (c: string, v: any) => { filtros.push((r) => r[c] === v); return b; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return b; },
    gte: () => b,
    order: () => b,
    range: async (a: number, z: number) => ({ data: lista().slice(a, z + 1), error: null }),
    maybeSingle: async () => ({ data: lista()[0] ?? null, error: null }),
    then: (ok: any, ko: any) => Promise.resolve({ data: lista(), error: null }).then(ok, ko),
  };
  return b;
}

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../middleware/rateLimiter', () => ({ aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: (t: string) => { if (t !== 'agendamentos' && t !== 'propostas') throw new Error(`tabela inesperada: ${t}`); return tabela(() => (t === 'agendamentos' ? h.agendamentos : h.propostas)); },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'system_state') throw new Error(`tabela inesperada: ${t}`);
      const stamp = () => `2026-11-05T15:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: (cols = 'key, value') => {
          const f: { k?: string; pre?: string; inn?: string[] } = {};
          const rows = () => [...h.linhas.entries()]
            .filter(([k]) => (f.k !== undefined ? k === f.k : f.inn ? f.inn.includes(k) : f.pre !== undefined ? k.startsWith(f.pre) : true))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
          const chain: any = {
            eq: (_c: string, k: string) => { f.k = k; return chain; },
            like: (_c: string, p: string) => { f.pre = p.replace(/%$/, ''); return chain; },
            in: (_c: string, ks: string[]) => { f.inn = ks; return chain; },
            order: () => chain,
            range: async (a: number, z: number) => ({ data: rows().slice(a, z + 1).map(([k, r]) => colunas(cols, k, r)), error: null }),
            maybeSingle: async () => { const r = rows()[0]; return { data: r ? colunas(cols, r[0], r[1]) : null, error: null }; },
            then: (ok: any, ko: any) => Promise.resolve({ data: rows().map(([k, r]) => colunas(cols, k, r)), error: null }).then(ok, ko),
          };
          return chain;
        },
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.falhaReserva && l.key.startsWith('nfe_chave:')) return { error: { code: 'XX000' } };
          if (h.linhas.has(l.key)) return { error: { code: '23505' } };
          h.linhas.set(l.key, { value: jsonb(l.value), updated_at: stamp() });
          return { error: null };
        },
        update: (v: { value: unknown }) => {
          const f: { k?: string; ua?: string | null } = {};
          const chain: any = {
            eq: (c: string, x: string) => { if (c === 'key') f.k = x; else f.ua = x; return chain; },
            is: () => { f.ua = ''; return chain; },
            select: async () => {
              const l = h.linhas.get(f.k as string);
              if (!l || (f.ua !== undefined && f.ua !== '' && l.updated_at !== f.ua)) return { data: [], error: null };
              h.linhas.set(f.k as string, { value: jsonb(v.value), updated_at: stamp() });
              return { data: [{ key: f.k }], error: null };
            },
          };
          return chain;
        },
      };
    },
    storage: {
      from: (_bucket: string) => ({
        upload: async (p: string, corpo: Buffer, o: { upsert: boolean }) => {
          if (h.recusaTipo && p.endsWith('.xml')) return { data: null, error: { message: 'mime type application/xml is not supported', statusCode: '415' } };
          if (h.bucket.has(p) && !o.upsert) return { data: null, error: { message: 'The resource already exists' } };
          h.bucket.set(p, Buffer.from(corpo));
          return { data: { path: p }, error: null };
        },
        createSignedUrl: async (p: string, s: number) => ({ data: { signedUrl: `https://assinado.test/${p}?exp=${s}` }, error: null }),
        download: async (p: string) => {
          const b = h.bucket.get(p);
          return b ? { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null } : { data: null, error: { message: 'Object not found' } };
        },
      }),
      getBucket: async (nome: string) => ({ data: { name: nome, public: false }, error: null }),
      createBucket: async (nome: string) => ({ data: { name: nome }, error: null }),
    },
  },
}));
vi.mock('../services/gerador/cadastroVendaBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVendaBanco')>()),
  lerJsonBruto: async (c: string) => (h.priv.has(c) ? JSON.parse(h.priv.get(c) as string) : null),
  gravarJsonBruto: async (c: string, v: unknown) => { h.priv.set(c, JSON.stringify(v)); },
  gravarArquivoBruto: async (c: string, b: Buffer) => { h.bucket.set(c, Buffer.from(b)); },
  assinarArquivoBruto: async (c: string, seg: number) => (h.bucket.has(c) ? `https://assinado.test/${c}?exp=${seg}` : null),
  // Trava de verdade (uma fila por chave), para provar que dois pedidos juntos não gravam duas vezes.
  comTrava: async (id: unknown, _por: string, fn: () => Promise<unknown>) => {
    const k = String(id);
    const antes = h.filas.get(k) ?? Promise.resolve();
    let solta: () => void = () => undefined;
    h.filas.set(k, new Promise<void>((r) => { solta = r; }));
    await antes;
    try { return await fn(); } finally { solta(); }
  },
}));
vi.mock('../controllers/pdfController', () => ({
  abrirNavegador: async () => {
    if (h.pdfFalha) throw new Error('chromium fora');
    return {
      newPage: async () => ({
        setJavaScriptEnabled: async () => undefined,
        setContent: async (html: string) => { h.pdfHtmls.push(html); },
        pdf: async () => Buffer.alloc(h.pdfTam.shift() ?? 1000, 1),
        close: async () => undefined,
      }),
      close: async () => { h.pdfFechou++; },
    };
  },
}));
vi.mock('../routes/geradorSolar', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorSolar')>()),
  planilha: async () => ({ dados: { obras: h.obrasPlanilha, ts: Date.now() }, atual: true }),
  comSobrescritas: async (o: any[]) => o,
}));
vi.mock('../services/gerador/cadastroVenda', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVenda')>()),
  lerCadastroVisto: async () => ({
    v: 1, alteracoes: [], em: null,
    campos: {
      ...Object.fromEntries(Object.entries(h.cad).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-11-01T10:00:00.000Z', fonte: 'manual' }])),
      ...Object.fromEntries(Object.entries(h.cadIa).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-11-01T10:00:00.000Z', fonte: 'ia' }])),
    },
  }),
}));
vi.mock('../routes/geradorJornadaSolar', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorJornadaSolar')>()),
  etapaDaPlanilha: async () => ({ etapaPlanilha: h.etapaPlanilha, fora: false }),
}));
vi.mock('../services/gerador/docsClienteBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/docsClienteBanco')>()),
  garantirBucketDocs: async () => undefined,
  assinarVarios: async (c: string[]) => new Map(c.map((x) => [x, `https://foto.test/${x}`] as [string, string])),
}));
// A IA é SEMPRE simulada: nenhuma chamada à API da Anthropic, em teste nenhum.
vi.mock('../services/gerador/financeiroLeitura', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/financeiroLeitura')>()),
  lerComprovante: vi.fn(async (e: { bytes: Buffer; media_type: string }) => {
    h.iaChamadas++;
    if (!h.ia) throw new Error('leitura não simulada');
    return h.ia(e);
  }),
}));

// A leitura da nota também é SEMPRE simulada.
vi.mock('../services/gerador/notaLeitura', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/notaLeitura')>()),
  lerNota: vi.fn(async () => {
    h.iaChamadas++;
    return h.nota ? h.nota() : { ok: false, motivo: 'falhou' };
  }),
}));

import { mountJornadaFicha } from '../routes/geradorJornadaFicha';
import { mountJornadaSolar } from '../routes/geradorJornadaSolar';
import { assinarJornada, normalizarJornada, reiniciarLogsDaJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';
import { AJUSTES_PADRAO, assinarAjustes, normalizarAjustes } from '../services/gerador/jornadaDinheiro';
import { assinarLigacao, invalidarCachesHub, POR_GERADOR, reiniciarLogsDoHub } from '../services/gerador/vendaSolarHub';

const r = Router();
mountJornadaSolar(r);
mountJornadaFicha(r);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';
const AGORA = '2026-11-05T15:00:00.000Z';
const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);

const SOLAR = 601;
const ALHEIA = 602;
const SEM_NUMERO = 603;
const DO_DIEGO = 604;
const cardBase = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Marcos Negociador', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', quando: null, historico: '', ...o,
});
const FICHA = (card: number): string => `/jornada-solar/obra/${card}/ficha`;
const U = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

const semearJs = (id: number, etapa = 1, vendedor = 'Nilce'): void => {
  const e = estadoMaterializado(id, vendedor, etapa, AGORA);
  const n = normalizarJornada(id, { ...e, origem: 'vendido', vendido_em: AGORA, vendido_por: 'nilce' })!;
  h.linhas.set(`jornada_solar:${id}`, { updated_at: 'j0', value: jsonb({ ...n, sig: assinarJornada(id, n) }) });
};
const ligar = (card: number, lig: { proposta: string | null; venda: string | null }): void => {
  const l = { ...lig, por: POR_GERADOR, em: AGORA };
  h.linhas.set(`venda_solar:${card}`, { updated_at: 'v', value: { ...l, sig: assinarLigacao(card, l) } });
};
const venda = (id: number, o: Record<string, unknown> = {}, valor = 3_890_000): void => {
  h.priv.set(`vendasolar/${id}.jornada.json`, JSON.stringify({
    v: 1,
    venda: {
      valor_centavos: valor, pagamento: [{ forma: 'pix', valor_centavos: valor, obs: '' }], desconto_centavos: null, prazo_prometido: 'até 60 dias',
      nota: 'Nota privada da negociação', kit_confirmado: true, combinado_por: 'nilce', combinado_em: AGORA, editado: [], ...o,
    },
    cancelamento: null, descancelamentos: [], trazidas: [],
  }));
};
const obraPlanilha = (o: Record<string, unknown>) => ({
  codigo: '#0057', cliente: 'Ana Souza', homologacao: '', consultor: 'Nilce', origem: '', valorVenda: 0, recebidoReal: 0, recebimento: '', liberadoTxt: '', depoimentoTxt: '',
  telefone: '', endereco: '', cidade: 'Araguari', uf: 'MG', entregaMaterial: '', previsaoMontagem: '', inicioInstalacao: '', fimInstalacao: '', qtdPlaca: '', modeloPlaca: '',
  statusPlaca: '', qtdInv: '', modeloInversor: '', statusInversor: '', tipoEstrutura: '', statusEstrutura: '', cadastroTrello: '', parecerAcesso: '', pedidoVistoria: '',
  liberacaoVistoria: '', engenheiro: '', concessionaria: '', equipe: '', ...o,
});
const docsDaPlanilha = (codigo: string, slots: string[]): void => {
  h.linhas.set(`docs_cliente:solar:${codigo}`, {
    updated_at: 'd',
    value: {
      arquivos: slots.map((s, i) => ({ id: `p${i}`, slot: s, caminho: `solar/${codigo}/${U(i + 1)}.pdf`, mime: 'application/pdf', bytes: 10, em: '2026-09-01T12:00:00.000Z', por: 'x' })),
      alteracoes: [], apagados: [],
    },
  });
};
const estadoDoBanco = (): string => JSON.stringify({
  linhas: [...h.linhas.entries()], priv: [...h.priv.entries()], bucket: [...h.bucket.entries()].map(([k, v]) => [k, v.length]), propostas: h.propostas, agendamentos: h.agendamentos,
});
const PROPOSTA_P1 = {
  codigo: 'P1', cliente_nome: 'Ana', cliente_cidade: 'Uberlândia', cliente_uf: 'MG', consultor_nome: 'Nilce', tipo: 'solar', vendido: true, valor_vendido: 38_000,
  forma_pagamento: 'cartao', obs_venda: 'nota', qtd_placas: 14, inversor: 'Growatt 10K', qtd_inversor: 1, dados: { fase: 'Trifásica', kwp: 8.25, tab: { mod: 'Canadian', pot: 590 } },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AGORA));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
  };
  h.agendamentos = [
    cardBase(SOLAR), cardBase(ALHEIA, { vendedor_nome: 'Carla' }), cardBase(SEM_NUMERO, { cliente_nome: 'Ana Souza' }), cardBase(DO_DIEGO, { vendedor_nome: 'Diego' }),
  ];
  h.propostas = [];
  h.linhas = new Map(); h.priv = new Map(); h.bucket = new Map(); h.tique = 0; h.iaChamadas = 0; h.ia = null; h.nota = null;
  h.filas = new Map(); h.etapaPlanilha = undefined; h.cad = {}; h.cadIa = {}; h.obrasPlanilha = []; h.recusaTipo = false; h.falhaReserva = false;
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS;
  invalidarCachesHub(); reiniciarLogsDoHub(); reiniciarLogsDaJornada();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede indisponível no teste'); }));
  semearJs(SOLAR); semearJs(ALHEIA, 1, 'Carla'); semearJs(SEM_NUMERO); semearJs(DO_DIEGO, 1, 'Diego');
  ligar(SOLAR, { proposta: null, venda: '#0057' });
  ligar(ALHEIA, { proposta: null, venda: '#0062' });
  venda(SOLAR);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('1. a guarda da obra', () => {
  it('sem login: 401; card inválido: 400; card de outro vendedor e inexistente: 404 com o mesmo corpo', async () => {
    expect((await request(app).get(`/gerador${FICHA(SOLAR)}`)).status).toBe(401);
    expect((await get(FICHA(0))).status).toBe(400);
    expect((await get('/jornada-solar/obra/abc/ficha')).status).toBe(400);
    const alheia = await get(FICHA(DO_DIEGO));
    const inexistente = await get(FICHA(999));
    expect(alheia.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(alheia.body).toEqual(inexistente.body);
  });
});

describe('2. o dono abre', () => {
  it('200, versão 1 e as cinco listas de sugestões', async () => {
    const res = await get(FICHA(SOLAR));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, card: SOLAR });
    expect(res.body.ficha.v).toBe(1);
    expect(Object.keys(res.body.ficha.sugestoes).sort()).toEqual(['banco', 'cadastro', 'recebimento', 'venda', 'vistoria']);
    expect(res.body.ficha.campos['venda.valor_centavos']).toMatchObject({ valor: 3_890_000, fonte: 'obra', rotulo: 'obra' });
    expect(res.body.ficha.sugestoes.venda).toEqual({});
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('3. a Giovanna não vê a linha da planilha', () => {
  it('nenhum campo da planilha para ela; os campos da obra aparecem; para a Nilce (consultora da linha) a planilha aparece', async () => {
    h.obrasPlanilha = [obraPlanilha({ endereco: 'Rua A, 100', concessionaria: 'Cemig' })];
    docsDaPlanilha('0057', ['fachada']);
    const g = await get(FICHA(SOLAR), GIOVANNA);
    expect(g.status).toBe(200);
    // Só a presença do arquivo (slot e data, sem link) segue o portão da etapa 1; campos e sugestões não levam nada da planilha.
    const txt = JSON.stringify({ campos: g.body.ficha.campos, sugestoes: g.body.ficha.sugestoes, trello: g.body.ficha.trello });
    expect(txt).not.toContain('"fonte":"planilha"');
    expect(txt).not.toContain('Rua A, 100');
    expect(txt).not.toContain('Cemig');
    expect(g.body.ficha.campos['venda.valor_centavos'].fonte).toBe('obra');
    expect(g.body.ficha.documentos_fora).toHaveLength(1);
    expect(g.body.ficha.documentos_fora[0].url).toBeNull();
    const n = await get(FICHA(SOLAR), NILCE);
    expect(n.body.ficha.campos['uc.endereco_ponto']).toMatchObject({ valor: 'Rua A, 100', fonte: 'planilha' });
    expect(n.body.ficha.campos['uc.concessionaria']).toMatchObject({ valor: 'Cemig', fonte: 'planilha' });
    expect(n.body.ficha.documentos_fora[0]).toMatchObject({ slot: 'fachada', fonte: 'planilha' });
    expect(n.body.ficha.documentos_fora[0].url).toContain('https://foto.test/');
  });
});

describe('4. o dinheiro da planilha é só para sócio', () => {
  it('o Diego (sócio) recebe o valor da planilha quando a obra e a proposta não têm; a Nilce não recebe a chave', async () => {
    h.priv.delete(`vendasolar/${SOLAR}.jornada.json`);
    h.obrasPlanilha = [obraPlanilha({ valorVenda: 38_900, formaPagto: 'Financiamento' })];
    const d = await get(FICHA(SOLAR), DIEGO);
    expect(d.status).toBe(200);
    expect(d.body.ficha.campos['venda.valor_centavos']).toMatchObject({ valor: 3_890_000, fonte: 'planilha' });
    expect(d.body.ficha.sugestoes.venda.valor_centavos).toMatchObject({ valor: 3_890_000, fonte: 'planilha' });
    expect(d.body.ficha.sugestoes.venda.forma).toMatchObject({ valor: 'financiamento', fonte: 'planilha' });
    const n = await get(FICHA(SOLAR), NILCE);
    expect(n.status).toBe(200);
    expect(n.body.ficha.campos['venda.valor_centavos']).toBeUndefined();
    expect(n.body.ficha.campos['venda.forma']).toBeUndefined();
    expect(JSON.stringify(n.body)).not.toContain('3890000');
  });
});

describe('5. a planilha casa pelo código, nunca pelo nome', () => {
  it('duas linhas com o mesmo nome: o card ligado ao #0057 pega a Rua A; o card sem número com o mesmo nome não pega nada', async () => {
    h.obrasPlanilha = [
      obraPlanilha({ codigo: '#0057', cliente: 'Ana Souza', endereco: 'Rua A, 100' }),
      obraPlanilha({ codigo: '#0058', cliente: 'Ana Souza', endereco: 'Rua B, 200' }),
    ];
    const ligado = await get(FICHA(SOLAR));
    expect(ligado.body.ficha.campos['uc.endereco_ponto']).toMatchObject({ valor: 'Rua A, 100', fonte: 'planilha' });
    expect(JSON.stringify(ligado.body)).not.toContain('Rua B');
    const semNumero = await get(FICHA(SEM_NUMERO));
    expect(semNumero.status).toBe(200);
    expect(JSON.stringify(semNumero.body)).not.toContain('"fonte":"planilha"');
    expect(JSON.stringify(semNumero.body)).not.toContain('Rua');
  });
});

describe('6. a leitura não grava e não chama a IA', () => {
  it('banco, JSON privado, bucket e propostas ficam iguais; nenhuma chamada ao modelo', async () => {
    h.propostas = [{ ...PROPOSTA_P1 }];
    ligar(SOLAR, { proposta: 'P1', venda: '#0057' });
    h.obrasPlanilha = [obraPlanilha({ endereco: 'Rua A, 100' })];
    docsDaPlanilha('0057', ['fachada', 'conta_luz']);
    const antes = estadoDoBanco();
    for (const auth of [NILCE, GIOVANNA, DIEGO, THIAGO]) expect((await get(FICHA(SOLAR), auth)).status).toBe(200);
    expect(estadoDoBanco()).toBe(antes);
    expect(h.iaChamadas).toBe(0);
  });
  it('a proposta ligada entra: ligação e sistema vêm dela, e a nota do valor aparece', async () => {
    h.propostas = [{ ...PROPOSTA_P1 }];
    ligar(SOLAR, { proposta: 'P1', venda: null });
    const res = await get(FICHA(SOLAR));
    const f = res.body.ficha;
    expect(f.campos['sistema.kwp']).toMatchObject({ valor: 8.25, fonte: 'proposta' });
    expect(f.campos['sistema.ligacao']).toMatchObject({ valor: 'trifasico', fonte: 'proposta' });
    expect(f.campos['venda.valor_centavos']).toMatchObject({ valor: 3_890_000, fonte: 'obra', alt: { valor: 3_800_000, fonte: 'proposta' } });
    expect(f.sugestoes.cadastro.uc_fornecimento).toMatchObject({ valor: 'trifasico', fonte: 'proposta' });
    expect(f.sugestoes.vistoria['entrada.padrao']).toMatchObject({ fonte: 'proposta' });
  });
});

describe('7. o dinheiro do livro só para quem o vê', () => {
  it('com o dinheiro fechado, a Nilce (vendedora) não recebe sugestão de recebimento; a Giovanna e o Thiago recebem', async () => {
    const a = normalizarAjustes({ ...AJUSTES_PADRAO, dinheiro_aberto: false, editado_em: AGORA, editado_por: 'thiago' })!;
    h.linhas.set('jornada_solar_ajustes', { updated_at: 'a0', value: jsonb({ ...a, sig: assinarAjustes(a) }) });
    const n = await get(FICHA(SOLAR), NILCE);
    expect(n.status).toBe(200);
    expect(n.body.ficha.sugestoes.recebimento).toEqual({});
    const g = await get(FICHA(SOLAR), GIOVANNA);
    expect(g.body.ficha.sugestoes.recebimento.valor_centavos).toMatchObject({ valor: 3_890_000, fonte: 'combinado' });
    expect(g.body.ficha.sugestoes.recebimento.forma.valor).toBe('pix');
    const t = await get(FICHA(SOLAR), THIAGO);
    expect(t.body.ficha.sugestoes.recebimento.categoria.valor).toBe('entrada');
  });
});

describe('8. o cadastro por IA entra sem chamar o modelo', () => {
  it('a IA aceita entra como "leitura da IA"; o card nunca vira contratante', async () => {
    h.cadIa = { uc_fornecimento: 'bifasico', consumo_medio_kwh: '620' };
    const res = await get(FICHA(SOLAR));
    const f = res.body.ficha;
    expect(f.campos['sistema.ligacao']).toMatchObject({ valor: 'bifasico', fonte: 'ia', rotulo: 'leitura da IA' });
    expect(f.campos['sistema.consumo_kwh']).toMatchObject({ valor: '620', fonte: 'ia' });
    expect(f.campos['contratante.nome']).toBeUndefined();
    expect(f.campos['contratante.telefone']).toBeUndefined();
    // O nome do card só aparece como quem acompanhou a vistoria (o negociador), nunca em pessoa.
    const comNome = Object.entries(f.campos).filter(([, c]) => JSON.stringify(c).includes('Marcos Negociador')).map(([k]) => k);
    expect(comNome).toEqual(['vistoria.acomp']);
    expect(f.sugestoes.cadastro.uc_fornecimento).toBeUndefined();
    expect(h.iaChamadas).toBe(0);
  });
});

describe('9. GET /jornada-solar/proposta/:codigo/venda (o modal antigo)', () => {
  const ligarProposta = (card: number, codigo: string): void => ligar(card, { proposta: codigo, venda: null });
  it('o dono recebe valor e forma, nunca a nota nem o prazo; alheio e duplicado dão 404; código inválido dá 400', async () => {
    ligarProposta(SOLAR, 'P1');
    const ok = await get('/jornada-solar/proposta/P1/venda');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, card: SOLAR, venda: { valor_centavos: 3_890_000, forma: 'vista', fonte: 'obra' } });
    const txt = JSON.stringify(ok.body);
    expect(txt).not.toContain('nota');
    expect(txt).not.toContain('Nota privada');
    expect(txt).not.toContain('prazo');
    expect(txt).not.toContain('60 dias');
    ligarProposta(ALHEIA, 'P2');
    expect((await get('/jornada-solar/proposta/P2/venda')).status).toBe(404);
    ligarProposta(SEM_NUMERO, 'P3'); ligarProposta(DO_DIEGO, 'P3');
    expect((await get('/jornada-solar/proposta/P3/venda', DIEGO)).status).toBe(404);
    expect((await get('/jornada-solar/proposta/P9/venda')).status).toBe(404);
    expect((await get('/jornada-solar/proposta/a%20b/venda')).status).toBe(400);
    expect((await request(app).get('/gerador/jornada-solar/proposta/P1/venda')).status).toBe(401);
  });
  it('proposta ligada a obra sem venda gravada: venda nula', async () => {
    h.priv.delete(`vendasolar/${SOLAR}.jornada.json`);
    ligarProposta(SOLAR, 'P1');
    const res = await get('/jornada-solar/proposta/P1/venda');
    expect(res.status).toBe(200);
    expect(res.body.venda).toBeNull();
  });
});
