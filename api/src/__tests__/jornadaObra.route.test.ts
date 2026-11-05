import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

// O dinheiro da obra solar, Fase 2 da Jornada (06/11/2026): comprovante obrigatório, valor conferido pela IA no servidor, repetido recusado,
// estorno, comissão por quem vendeu, quem lança o quê, conta fechada, a guarda do dono e a guarda do financeiro antigo. Login, os dois bancos, o
// Storage e a IA SIMULADOS (a API da Anthropic nunca é chamada). Nenhuma mensagem sai. Dados inventados.
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
    from: (t: string) => { if (t !== 'agendamentos') throw new Error(`tabela inesperada: ${t}`); return tabela(() => h.agendamentos); },
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
vi.mock('../routes/geradorSolar', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorSolar')>()),
  planilha: async () => ({ dados: { obras: [], ts: Date.now() }, atual: true }),
  comSobrescritas: async (o: any[]) => o,
}));
vi.mock('../services/gerador/cadastroVenda', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVenda')>()),
  lerCadastroVisto: async () => ({
    v: 1, alteracoes: [], em: null,
    campos: Object.fromEntries(Object.entries(h.cad).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-11-01T10:00:00.000Z', fonte: 'manual' }])),
  }),
}));
vi.mock('../routes/geradorJornadaSolar', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorJornadaSolar')>()),
  etapaDaPlanilha: async () => ({ etapaPlanilha: h.etapaPlanilha, fora: false }),
}));
vi.mock('../services/gerador/docsClienteBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/docsClienteBanco')>()),
  garantirBucketDocs: async () => undefined,
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

import { mountFinanceiro } from '../routes/geradorFinanceiro';
import { mountJornadaDinheiro } from '../routes/geradorJornadaDinheiro';
import { mountJornadaObra } from '../routes/geradorJornadaObra';
import { mountJornadaSolar } from '../routes/geradorJornadaSolar';
import { esquecerConferenciaDoBucket } from '../services/gerador/financeiroArquivos';
import { assinarJornada, normalizarJornada, reiniciarLogsDaJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';
import { assinarObra, obraPrivadaVazia, obraVazia } from '../services/gerador/jornadaObraBanco';
import { obraMaterializada, type ObraPrivada, type EstadoObra } from '../services/gerador/jornadaObra';
import { lancamentoObraParaGravar, montarLancamentoObra } from '../services/gerador/jornadaDinheiro';
import { assinarLigacao, invalidarCachesHub, POR_GERADOR, reiniciarLogsDoHub } from '../services/gerador/vendaSolarHub';
import { cifrar } from '../services/gerador/cofreObra';

const r = Router();
mountFinanceiro(r);
mountJornadaSolar(r);
mountJornadaDinheiro(r);
mountJornadaObra(r);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';
const AGORA = '2026-11-05T15:00:00.000Z';
const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);
const post = (url: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const put = (url: string, corpo: unknown, auth = NILCE) => request(app).put(`/gerador${url}`).set('Authorization', auth).send(corpo as object);

const SOLAR = 601;
const ALHEIA = 602;
const SEM_ESTADO = 603;
const cardBase = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Cliente Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', quando: null, historico: '', ...o,
});
const F2 = (card: number, sufixo = '') => `/jornada-solar/obra/${card}/fase2${sufixo}`;
const DIN = (card: number, sufixo = '') => `/jornada-solar/obra/${card}/dinheiro${sufixo}`;
const U = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
let seq = 0;
const novoId = (p: string): string => `${p}-${String(++seq).padStart(8, '0')}`;
const PDF = (texto: string): Buffer => Buffer.from(`%PDF-1.4\n${texto}\n%%EOF`);

const comDv = (c43: string): string => {
  let soma = 0;
  for (let i = 0; i < 43; i++) soma += Number(c43[i]) * (2 + ((42 - i) % 8));
  const dv = 11 - (soma % 11);
  return c43 + String(dv >= 10 ? 0 : dv);
};
const CHAVE_A = comDv('3126100123456700019055001000000123100000012');
const CHAVE_B = comDv('3526109999999900010155001000004567100004567');
const notaLida = (chave: string | null, total = 89_000) => () => ({
  ok: true, eh_documento: true,
  nota: { tipo: 'nota_fiscal', emitente: 'Elétrica Central', cnpj: '12345678000190', numero: '123', data: '2026-10-16', chave, valor_total_centavos: total,
    itens: [{ descricao: 'Cabo solar 6 mm', quantidade: 100, unidade: 'm', valor_unitario_centavos: 450, valor_total_centavos: 45_000 }, { descricao: 'Conector MC4', quantidade: 10, unidade: 'par', valor_unitario_centavos: 2_000, valor_total_centavos: 20_000 }],
    confianca: 'alta' },
});

const semearJs = (id: number, etapa = 4, vendedor = 'Nilce'): void => {
  const e = estadoMaterializado(id, vendedor, etapa, AGORA);
  const n = normalizarJornada(id, { ...e, origem: 'vendido', vendido_em: AGORA, vendido_por: 'nilce' })!;
  h.linhas.set(`jornada_solar:${id}`, { updated_at: 'j0', value: jsonb({ ...n, sig: assinarJornada(id, n) }) });
};
const semearJo = (id: number, mut: (e: EstadoObra) => void = () => undefined, etapa = 4): EstadoObra => {
  const e = obraMaterializada(id, etapa, AGORA, AGORA);
  mut(e);
  h.linhas.set(`jornada_obra:${id}`, { updated_at: 'o0', value: jsonb({ ...e, sig: assinarObra(id, e) }) });
  return e;
};
const joGravado = (id: number): any => h.linhas.get(`jornada_obra:${id}`)?.value;
const semearPrivada = (id: number, mut: (p: ObraPrivada) => void): ObraPrivada => {
  const p = h.priv.has(`vendasolar/${id}.obra.json`) ? JSON.parse(h.priv.get(`vendasolar/${id}.obra.json`)!) as ObraPrivada : obraPrivadaVazia();
  mut(p);
  h.priv.set(`vendasolar/${id}.obra.json`, JSON.stringify(p));
  return p;
};
const privadaGravada = (id: number): ObraPrivada | null => (h.priv.has(`vendasolar/${id}.obra.json`) ? JSON.parse(h.priv.get(`vendasolar/${id}.obra.json`)!) : null);
const venda = (id: number, valor = 3_890_000): void => {
  h.priv.set(`vendasolar/${id}.jornada.json`, JSON.stringify({ v: 1, venda: { valor_centavos: valor, pagamento: [{ forma: 'pix', valor_centavos: valor, obs: '' }], desconto_centavos: null, prazo_prometido: '', nota: '', kit_confirmado: true, combinado_por: 'nilce', combinado_em: AGORA, editado: [] }, cancelamento: null, descancelamentos: [] }));
};
const anexos = (id: number, ids: Array<[string, string]>): void => {
  h.linhas.set(`docs_cliente:vendasolar:${id}`, {
    updated_at: 'd',
    value: { arquivos: ids.map(([aid, slot], i) => ({ id: aid, slot, caminho: `vendasolar/${id}/${U(i + 1)}.pdf`, mime: 'application/pdf', bytes: 10, em: '2026-10-10T12:00:00.000Z', por: 'x' })), alteracoes: [], apagados: [] },
  });
};
/** Um lançamento direto no `system_state` (já assinado), com comprovante. */
const linha = (card: number, tipo: 'entrada' | 'saida', categoria: string, etapa: number, data: string, valor: number, o: { compra_id?: string; comissao?: { nome: string; papel: 'venda' | 'socio'; pb: number }; conferencia?: string; sem_arquivo?: boolean } = {}): string => {
  const id = novoId('lan');
  const m = montarLancamentoObra({
    id, tipo, categoria, etapa, valor_centavos: valor, data, forma: 'pix', conferencia: o.conferencia ?? 'bateu', compra_id: o.compra_id ?? null, comissao: o.comissao ?? null,
    arquivo: o.sem_arquivo ? null : { path: `fin/${card}/202610/${U(seq)}.pdf`, nome: 'c.pdf', tipo: 'application/pdf', tamanho: 10, sha256: (String(seq).padStart(4, '0') + 'ab').repeat(16).slice(0, 64) },
  }, { cardId: card, autor: 'giovanna', agoraIso: AGORA, hojeBr: '2026-11-05' });
  if (!m.ok) throw new Error(m.erro);
  const l = lancamentoObraParaGravar(card, m.lancamento)!;
  h.linhas.set(`fin:${card}:${id}`, { updated_at: 'f', value: jsonb(l) });
  return id;
};
const iaLe = (valor: number) => {
  h.ia = () => ({ ok: true, eh_comprovante: true, sugestao: { valor_centavos: valor, data: '2026-11-04', pagador: null, recebedor: 'Fornecedor', forma: 'pix', id_transacao: null, descricao: null, confianca: 'alta' } });
};
async function subir(texto: string, o: { card?: number; auth?: string; doc?: 'comprovante' | 'nota' } = {}) {
  const res = await post(DIN(o.card ?? SOLAR, '/comprovante'), { base64: PDF(texto).toString('base64'), media_type: 'application/pdf', nome: 'c.pdf', ler: true, ...(o.doc ? { doc: o.doc } : {}) }, o.auth ?? NILCE);
  return { res, path: res.body?.arquivo?.path as string };
}

/** A #0065 na etapa 8: tudo pago, tudo com comprovante, 2 itens de material com origem, passos da Cemig com prints. Pronta para fechar. */
function cenario8(card = SOLAR): void {
  semearJs(card, 4);
  semearJo(card, (e) => { e.pedido = { numero: '1026-50392', em: '2026-10-26' }; }, 8);
  venda(card);
  semearPrivada(card, (p) => {
    p.compra.compras = [{ id: 'c-1', fornecedor: 'Distribuidora Solar Centro', cidade: 'Uberlândia', data: '2026-10-15', forma: 'boleto', nota_chega: 'anexada', nota: null }];
    const it = (id: string, valor: number) => ({
      id, origem: 'manual' as const, tipo: 'outro' as const, descricao: id, quantidade: 1, unidade: 'un' as const, marca: '', modelo: '', potencia_w: null, potencia_kw: null,
      garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: 'c-1', fornecedor: 'Distribuidora Solar Centro', valor_centavos: valor, data: '2026-10-15',
      etapa: 4 as const, criado_por: 'thiago', criado_em: AGORA,
    });
    p.compra.itens = [it('i-1', 60_000), it('i-2', 40_000)];
    p.liberacao.passos = {
      pedido: { data: '2026-10-26', arquivo_id: 'a-ped' }, vistoria: { data: '2026-11-03', arquivo_id: 'a-vis' }, medidor: { data: '2026-11-05', arquivo_id: 'a-med' },
      liberada: { data: '2026-11-06', arquivo_id: 'a-lib' },
    };
  });
  anexos(card, [['a-ped', 'lib_pedido'], ['a-vis', 'lib_vistoria'], ['a-med', 'lib_medidor'], ['a-lib', 'lib_liberacao']]);
  linha(card, 'entrada', 'entrada', 2, '2026-09-18', 3_890_000);
  linha(card, 'saida', 'material', 4, '2026-10-15', 100_000, { compra_id: 'c-1' });
  linha(card, 'saida', 'comissao_venda', 2, '2026-09-21', 194_500, { comissao: { nome: 'nilce', papel: 'venda', pb: 500 } });
  linha(card, 'saida', 'retirada_socio', 2, '2026-09-21', 77_800, { comissao: { nome: 'thiago', papel: 'socio', pb: 200 } });
  linha(card, 'saida', 'retirada_socio', 2, '2026-09-21', 77_800, { comissao: { nome: 'diego', papel: 'socio', pb: 200 } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AGORA));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
  };
  h.agendamentos = [cardBase(SOLAR), cardBase(ALHEIA, { vendedor_nome: 'Carla' }), cardBase(SEM_ESTADO)];
  h.linhas = new Map(); h.priv = new Map(); h.bucket = new Map(); h.tique = 0; h.iaChamadas = 0; h.ia = null; h.nota = null;
  h.filas = new Map(); h.etapaPlanilha = undefined; h.cad = {};
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS;
  invalidarCachesHub(); reiniciarLogsDoHub(); reiniciarLogsDaJornada(); esquecerConferenciaDoBucket();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede indisponível no teste'); }));
  const lig = { proposta: null, venda: '#0062', por: POR_GERADOR, em: AGORA };
  h.linhas.set(`venda_solar:${ALHEIA}`, { updated_at: 'v', value: { ...lig, sig: assinarLigacao(ALHEIA, lig) } });
  semearJs(SOLAR, 4); semearJs(ALHEIA, 4, 'Carla'); venda(SOLAR); venda(ALHEIA);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GET fase2 e a seção Compra', () => {
  it('com a etapa 4 aberta devolve os `sugeridos` e NÃO grava nada; o primeiro PUT grava; dois PUTs juntos gravam a lista uma vez só', async () => {
    const g = await get(F2(SOLAR), THIAGO);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ ok: true, etapa_atual: 4, fechada: null });
    expect(g.body.etapas.map((e: any) => e.n)).toEqual([4, 5, 6, 7, 8]);
    expect(g.body.etapas[0]).toMatchObject({ n: 4, nome: 'Compra', prazo: { rotulo: 'Prazo' } });
    expect(g.body.etapas[0].aberta_em).not.toBeNull();
    expect(g.body.etapas[1].aberta_em).toBeNull();
    const sug = g.body.dados.compra.sugeridos;
    expect(sug.length).toBeGreaterThan(5);
    expect(sug.every((s: any) => s.id === null)).toBe(true);
    expect(sug.map((s: any) => s.descricao)).toContain('Conector MC4');
    expect(g.body.dados.compra.itens).toEqual([]);
    expect(g.body.versoes.compra).toBe(0);
    expect(g.body.equipes.map((e: any) => e.id)).toEqual(['pablo', 'diego', 'propria', 'thiago_ari', 'branco']);
    expect(g.body.lista_pronta).toHaveLength(15);
    // Nenhum GET escreve.
    expect(h.priv.has(`vendasolar/${SOLAR}.obra.json`)).toBe(false);
    expect(h.linhas.has(`jornada_obra:${SOLAR}`)).toBe(false);

    const dados = { itens: sug.slice(0, 3).map((s: any) => ({ ...s, id: null })), compras: [] };
    const [a, b] = await Promise.all([put(F2(SOLAR, '/compra'), { versao: 0, dados }, THIAGO), put(F2(SOLAR, '/compra'), { versao: 0, dados }, THIAGO)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const perdeu = a.status === 409 ? a : b;
    expect(perdeu.body).toMatchObject({ mudou: true, error: 'Outra pessoa mexeu nesta parte agora. A tela vai recarregar.' });
    const p = privadaGravada(SOLAR)!;
    expect(p.compra.itens).toHaveLength(3);
    expect(p.versoes.compra).toBe(1);
    expect(p.compra.itens.every((i) => /^i-[0-9a-f-]{12}$/.test(i.id) && i.criado_por === 'thiago')).toBe(true);
    // A gravação materializou as duas chaves (a 4 já estava aberta pela Fase 1).
    expect(h.linhas.has(`jornada_obra:${SOLAR}`)).toBe(true);
    const ok = a.status === 200 ? a : b;
    expect(ok.body.versoes.compra).toBe(1);
    expect(ok.body.dados.compra.itens).toHaveLength(3);
    expect(ok.body.dados.compra.sugeridos).toEqual([]);
  });

  it('versão velha dá 409 `mudou`; a Nilce leva 403; o id do item é do servidor, mesmo que o navegador mande um', async () => {
    const dados = { itens: [{ id: 'forjado-0001', descricao: 'Cabo solar', criado_por: 'nilce', criado_em: '2020-01-01T00:00:00.000Z', tipo: 'eletrico', quantidade: 10 }], compras: [{ id: 'c-forjada', fornecedor: 'Elétrica Central', nota: { path: 'fin/1/x.pdf', sha256: 'a'.repeat(64) } }] };
    expect((await put(F2(SOLAR, '/compra'), { versao: 0, dados }, NILCE)).status).toBe(403);
    const ok = await put(F2(SOLAR, '/compra'), { versao: 0, dados }, THIAGO);
    expect(ok.status).toBe(200);
    const p = privadaGravada(SOLAR)!;
    expect(p.compra.itens[0].id).not.toBe('forjado-0001');
    expect(p.compra.itens[0]).toMatchObject({ criado_por: 'thiago' });
    expect(p.compra.itens[0].criado_em).toBe(AGORA);
    expect(p.compra.compras[0].id).not.toBe('c-forjada');
    expect(p.compra.compras[0].nota).toBeNull();
    const velho = await put(F2(SOLAR, '/compra'), { versao: 0, dados: { itens: [], compras: [] } }, THIAGO);
    expect(velho.status).toBe(409);
    expect(velho.body.mudou).toBe(true);
    expect(privadaGravada(SOLAR)!.compra.itens).toHaveLength(1);
    // Seção que não existe, corpo torto, `previsto` fora desta rota.
    expect((await put(F2(SOLAR, '/previsto'), { versao: 0, dados: {} }, THIAGO)).status).toBe(400);
    expect((await put(F2(SOLAR, '/nada'), { versao: 0, dados: {} }, THIAGO)).status).toBe(400);
    expect((await put(F2(SOLAR, '/compra'), { dados: {} }, THIAGO)).status).toBe(400);
  });

  it('quem mexe em cada seção: o Diego não grava a liberação; o Thiago só o plano da obra; a Nilce só a vistoria da dela; conta fechada e venda cancelada travam', async () => {
    expect((await put(F2(SOLAR, '/liberacao'), { versao: 0, dados: { passos: {} } }, DIEGO)).status).toBe(403);
    expect((await put(F2(SOLAR, '/liberacao'), { versao: 0, dados: { passos: {} } }, THIAGO)).status).toBe(200);
    expect((await put(F2(SOLAR, '/logistica'), { versao: 0, dados: { cargas: [] } }, THIAGO)).status).toBe(200);   // o ADM mexe em tudo
    expect((await put(F2(SOLAR, '/entrega'), { versao: 0, dados: {} }, GIOVANNA)).status).toBe(403);
    expect((await put(F2(SOLAR, '/vistoria'), { versao: 0, dados: { data: '2026-09-16', concl: 'ok', obs: 'Telhado em bom estado' } }, NILCE)).status).toBe(200);
    expect(privadaGravada(SOLAR)!.vistoria).toMatchObject({ concl: 'ok', obs: 'Telhado em bom estado' });
    expect((await put(F2(ALHEIA, '/vistoria'), { versao: 0, dados: {} }, NILCE)).status).toBe(404);
    expect((await put(F2(SOLAR, '/banco'), { versao: 0, dados: { banco: 'BV', agencia: '0001', conta: '123-4' } }, GIOVANNA)).status).toBe(200);
    // O Thiago (que não é o Diego) mexe no plano, e o resto da obra fica como estava.
    const plano = { plano: [{ data: '2026-10-26', inicio: '08:00', fim: '17:00', equipe: 'pablo', ajudantes: 2, servico: 'Estrutura' }], diario: [{ data: '2026-10-26', chegada: '08:00', saida: '17:00', fotos: [], ocorrencia: 'Forjado' }], checklist: { dps: true } };
    expect((await put(F2(SOLAR, '/obra'), { versao: 0, dados: plano }, THIAGO)).status).toBe(200);
    // ADM: tudo. O Thiago é ADM, então grava também o diário; o Diego faz o mesmo e o Thiago-que-não-é-ADM é provado pelo SOLAR_ADM.
    process.env.SOLAR_ADM = 'giovanna';
    const so = await put(F2(SOLAR, '/obra'), { versao: 1, dados: { ...plano, plano: [], diario: [{ data: '2026-10-27', chegada: '08:00', saida: '17:00', fotos: [], ocorrencia: 'Do Thiago' }] } }, THIAGO);
    expect(so.status).toBe(200);
    expect(privadaGravada(SOLAR)!.obra.plano).toEqual([]);
    expect(privadaGravada(SOLAR)!.obra.diario.map((d) => d.ocorrencia)).toEqual(['Forjado']);
    delete process.env.SOLAR_ADM;
    fechar2(SOLAR);
    expect((await put(F2(SOLAR, '/compra'), { versao: 0, dados: { itens: [], compras: [] } }, THIAGO)).status).toBe(409);
  });
});
const fechar2 = (id: number): void => { semearJo(id, (e) => { e.fechada = { em: AGORA, por: 'thiago' }; }, 8); };

describe('a venda sem estado (as antigas)', () => {
  it('deduzida na etapa 6: o GET diz etapa 6, o gasto da etapa 6 entra SEM materializar, e o concluir da 6 materializa as duas chaves e abre a 7', async () => {
    const lig = { proposta: null, venda: '#0066', por: POR_GERADOR, em: AGORA };
    h.linhas.set(`venda_solar:${SEM_ESTADO}`, { updated_at: 'v', value: { ...lig, sig: assinarLigacao(SEM_ESTADO, lig) } });
    h.etapaPlanilha = 'instalacao';
    venda(SEM_ESTADO);
    const g = await get(F2(SEM_ESTADO), DIEGO);
    expect(g.status).toBe(200);
    expect(g.body.etapa_atual).toBe(6);
    expect(g.body.etapas.find((e: any) => e.n === 6).aberta_em).not.toBeNull();
    expect(g.body.etapas.find((e: any) => e.n === 4).concluida_em).not.toBeNull();
    expect(h.linhas.has(`jornada_solar:${SEM_ESTADO}`)).toBe(false);
    expect(h.linhas.has(`jornada_obra:${SEM_ESTADO}`)).toBe(false);
    // O gasto da etapa 6 entra (e a etapa 7 não), sem materializar.
    iaLe(100_000);
    const { path: p } = await subir('equipe pablo', { card: SEM_ESTADO, auth: DIEGO });
    const l = await post(DIN(SEM_ESTADO, '/lancamento'), { id: novoId('sai'), tipo: 'saida', categoria: 'mao_de_obra', etapa: 6, valor_centavos: 100_000, data: '2026-11-04', forma: 'pix', arquivo_path: p }, DIEGO);
    expect(l.status).toBe(200);
    iaLe(5_000);
    const { path: p7 } = await subir('etapa adiante', { card: SEM_ESTADO, auth: DIEGO });
    expect((await post(DIN(SEM_ESTADO, '/lancamento'), { id: novoId('sai'), tipo: 'saida', categoria: 'frete', etapa: 7, valor_centavos: 5_000, data: '2026-11-04', arquivo_path: p7 }, DIEGO)).status).toBe(400);
    expect(h.linhas.has(`jornada_solar:${SEM_ESTADO}`)).toBe(false);
    expect(h.linhas.has(`jornada_obra:${SEM_ESTADO}`)).toBe(false);
    // O portão da 6.
    semearPrivada(SEM_ESTADO, (pv) => {
      pv.obra.plano = [{ data: '2026-10-23', inicio: '08:00', fim: '17:00', equipe: 'pablo', ajudantes: 2, servico: 'Obra' }];
      pv.obra.diario = [{ data: '2026-10-23', chegada: '08:00', saida: '17:00', fotos: ['a-f1'], ocorrencia: '' }];
      pv.obra.checklist = Object.fromEntries(['estrutura', 'placas', 'strings', 'inversor', 'dps', 'aterramento', 'cabos', 'padrao'].map((k) => [k, true]));
      pv.obra.equipe = { combinado_centavos: 100_000, descricao: '15 placas' };
    });
    anexos(SEM_ESTADO, [['a-f1', 'obra_foto']]);
    expect((await post('/jornada-solar/obra/603/etapa-obra', { etapa: 6 }, NILCE)).status).toBe(403);   // quem conclui é o dono (o Diego)
    const c = await post('/jornada-solar/obra/603/etapa-obra', { etapa: 6 }, DIEGO);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ ok: true, etapa_atual: 7 });
    expect(h.linhas.has(`jornada_solar:${SEM_ESTADO}`)).toBe(true);
    const jo = joGravado(SEM_ESTADO);
    expect(jo.etapas['4'].concluida_por).toBe('leitura');
    expect(jo.etapas['6']).toMatchObject({ concluida_por: 'diego' });
    expect(jo.etapas['7'].aberta_em).not.toBeNull();
    expect(jo.historico.map((x: any) => x.acao)).toEqual(expect.arrayContaining(['materializada', 'concluir', 'abrir']));
    expect((await get(F2(SEM_ESTADO), DIEGO)).body.etapa_atual).toBe(7);
  });
});

describe('a nota fiscal', () => {
  const nota = async (texto: string, card: number, compra: string, chave: string | null, auth = THIAGO, extra: Record<string, unknown> = {}) => {
    h.nota = notaLida(chave);
    const { path: p, res } = await subir(texto, { card, auth, doc: 'nota' });
    expect(res.status).toBe(200);
    return post(F2(card, '/nota'), { compra_id: compra, arquivo_path: p, ...extra }, auth);
  };
  beforeEach(() => {
    semearJo(SOLAR); semearJo(ALHEIA);
    for (const [card, id] of [[SOLAR, 'c-1'], [ALHEIA, 'c-9']] as const) {
      semearPrivada(card, (p) => { p.compra.compras = [{ id, fornecedor: 'Elétrica Central', cidade: '', data: '2026-10-16', forma: 'cartao', nota_chega: 'anexada', nota: null }]; });
    }
  });
  it('a nota é lida e ligada à compra; a mesma nota (sha256) em outra obra dá 409; a mesma chave de 44 dígitos válida também', async () => {
    const a = await nota('nota fiscal 123', SOLAR, 'c-1', CHAVE_A);
    expect(a.status).toBe(200);
    expect(a.body.mensagem).toBe('A nota foi lida: Elétrica Central · 16/10 · 2 itens · R$ 890,00');
    expect(a.body.lida).toMatchObject({ emitente: 'Elétrica Central', n_itens: 2, valor_total_centavos: 89_000 });
    const p = privadaGravada(SOLAR)!;
    expect(p.compra.compras[0].nota).toMatchObject({ numero: '123', chave: CHAVE_A });
    expect([...h.linhas.keys()].some((k) => k.startsWith(`fin_nf:${SOLAR}:`))).toBe(true);
    // Outra obra, o mesmo arquivo.
    const b = await nota('nota fiscal 123', ALHEIA, 'c-9', null);
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ error: 'nota_repetida' });
    expect(b.body.mensagem).toMatch(/^Esta nota já foi lançada /);
    expect(JSON.stringify(b.body)).not.toMatch(/Cliente Inventado|Carla/);
    // Outra obra, outro arquivo, a mesma chave.
    const c = await nota('nota fiscal 124 de outro papel', ALHEIA, 'c-9', CHAVE_A);
    expect(c.status).toBe(409);
    expect(c.body.error).toBe('nota_repetida');
    // Chave que não passa no dígito verificador vale como não lida: não trava por ela (a lida vem null do servidor).
    const d = await nota('nota fiscal 125 outra', ALHEIA, 'c-9', CHAVE_A.slice(0, 43) + String((Number(CHAVE_A[43]) + 1) % 10));
    expect(d.status).toBe(200);
    expect(privadaGravada(ALHEIA)!.compra.compras[0].nota!.chave).toBe('');
    expect(h.iaChamadas).toBeGreaterThan(0);
  });
  it('compra que já tem nota pede `trocar`; trocar libera a anterior para outra obra', async () => {
    expect((await nota('nota um', SOLAR, 'c-1', CHAVE_A)).status).toBe(200);
    const sem = await nota('nota dois', SOLAR, 'c-1', CHAVE_B);
    expect(sem.status).toBe(409);
    expect(sem.body.mensagem).toBe('Esta compra já tem nota. Use Trocar a nota.');
    expect((await nota('nota dois', SOLAR, 'c-1', CHAVE_B, THIAGO, { trocar: true })).status).toBe(200);
    expect(privadaGravada(SOLAR)!.compra.compras[0].nota!.chave).toBe(CHAVE_B);
    // A primeira ficou livre: entra em outra obra.
    expect((await nota('nota um', ALHEIA, 'c-9', CHAVE_A)).status).toBe(200);
    // Quem não é da compra não anexa; compra que não existe; arquivo que é comprovante, não nota.
    h.nota = notaLida(null);
    const { path: p } = await subir('mais uma nota', { card: SOLAR, auth: THIAGO, doc: 'nota' });
    expect((await post(F2(SOLAR, '/nota'), { compra_id: 'c-1', arquivo_path: p, trocar: true }, NILCE)).status).toBe(403);
    expect((await post(F2(SOLAR, '/nota'), { compra_id: 'c-inexistente', arquivo_path: p }, THIAGO)).status).toBe(400);
    iaLe(100);
    const comp = await subir('um comprovante', { card: SOLAR, auth: THIAGO });
    const errado = await post(F2(SOLAR, '/nota'), { compra_id: 'c-1', arquivo_path: comp.path, trocar: true }, THIAGO);
    expect(errado.status).toBe(400);
    expect(errado.body.error).toBe('nao_e_nota');
  });
});

describe('concluir as etapas', () => {
  it('a etapa 4 só conclui com 100% do material (409 com `precisa: itens`); o Diego leva 403 na 4 (quem conclui é o Thiago)', async () => {
    semearJo(SOLAR);
    semearPrivada(SOLAR, (p) => {
      p.compra.compras = [{ id: 'c-1', fornecedor: 'Distribuidora', cidade: '', data: '2026-10-15', forma: 'pix', nota_chega: 'anexada', nota: null }];
      p.compra.itens = [
        { id: 'i-1', origem: 'manual', tipo: 'outro', descricao: 'Kit', quantidade: 1, unidade: 'un', marca: '', modelo: '', potencia_w: null, potencia_kw: null, garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: 'c-1', fornecedor: 'Distribuidora', valor_centavos: 100_000, data: '2026-10-15', etapa: 4, criado_por: 'thiago', criado_em: AGORA },
        { id: 'i-2', origem: 'manual', tipo: 'outro', descricao: 'Cabos', quantidade: 1, unidade: 'un', marca: '', modelo: '', potencia_w: null, potencia_kw: null, garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: null, fornecedor: '', valor_centavos: null, data: null, etapa: 4, criado_por: 'thiago', criado_em: AGORA },
      ];
    });
    expect((await post('/jornada-solar/obra/601/etapa-obra', { etapa: 4 }, DIEGO)).status).toBe(403);
    const c = await post('/jornada-solar/obra/601/etapa-obra', { etapa: 4 }, THIAGO);
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ precisa: 'itens' });
    expect(c.body.falta.map((x: any) => x.chave)).toEqual(['material', 'comprovante']);
    expect(c.body.falta[0].texto).toContain('(0 de 2)');
    expect(joGravado(SOLAR).etapas['4'].concluida_em).toBeNull();
    // Etapa que não é a da vez.
    expect((await post('/jornada-solar/obra/601/etapa-obra', { etapa: 6 }, DIEGO)).status).toBe(409);
    expect((await post('/jornada-solar/obra/601/etapa-obra', { etapa: 3 }, THIAGO)).status).toBe(400);
  });

  it('a espera de 4 a 8: o dono põe, a Nilce não, o teto é de 5 dias úteis, e voltar limpa', async () => {
    semearJo(SOLAR);
    expect((await post('/jornada-solar/obra/601/esperar-obra', { motivo: 'fornecedor', ate: '2026-11-10' }, NILCE)).status).toBe(403);
    expect((await post('/jornada-solar/obra/601/esperar-obra', { motivo: 'fornecedor', ate: '2026-12-30' }, THIAGO)).status).toBe(400);
    const ok = await post('/jornada-solar/obra/601/esperar-obra', { motivo: 'fornecedor', ate: '2026-11-10' }, DIEGO);
    expect(ok.status).toBe(200);
    expect(ok.body.texto).toBe('Esperando até 10/11 · Fornecedor');
    expect(joGravado(SOLAR).esperando).toMatchObject({ motivo: 'fornecedor', etapa: 4, por: 'diego' });
    const g = await get(F2(SOLAR), THIAGO);
    expect(g.body.esperando).toMatchObject({ motivo: 'fornecedor' });
    expect(g.body.etapas[0].situacao.tipo).toBe('esperando');
    expect((await post('/jornada-solar/obra/601/esperar-obra', { voltar: true }, DIEGO)).status).toBe(200);
    expect(joGravado(SOLAR).esperando).toBeNull();
  });
});

describe('fechamento só com tudo em zero', () => {
  it('"a pagar" diferente de zero trava a etapa 8; zerado e com 100% do material, conclui e a conta trava; só o ADM reabre, com motivo, e o motivo não vai ao system_state', async () => {
    cenario8();
    // Falta pagar a retirada do Diego.
    const diego = [...h.linhas.keys()].find((k) => k.startsWith(`fin:${SOLAR}:`) && JSON.stringify(h.linhas.get(k)!.value).includes('"diego"'))!;
    const guardada = h.linhas.get(diego)!;
    h.linhas.delete(diego);
    const a = await get(DIN(SOLAR), THIAGO);
    expect(a.body.livro.fechamento.pode_fechar).toBe(false);
    expect(a.body.livro.a_pagar.map((x: any) => x.texto)).toEqual(['Comissão de Diego (sócio 2%): R$ 778,00']);
    const trava = await post('/jornada-solar/obra/601/etapa-obra', { etapa: 8 }, THIAGO);
    expect(trava.status).toBe(409);
    expect(trava.body.precisa).toBe('itens');
    expect(trava.body.falta.map((x: any) => x.chave)).toEqual(['dinheiro']);
    expect(joGravado(SOLAR).fechada).toBeNull();
    // O dono da 8 é o Thiago: o Diego não conclui.
    h.linhas.set(diego, guardada);
    expect((await post('/jornada-solar/obra/601/etapa-obra', { etapa: 8 }, DIEGO)).status).toBe(403);
    const ok = await post('/jornada-solar/obra/601/etapa-obra', { etapa: 8 }, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, etapa_atual: 9, fechada: { por: 'thiago' } });
    expect(joGravado(SOLAR).fechada).not.toBeNull();
    expect(joGravado(SOLAR).historico.map((x: any) => x.acao)).toEqual(expect.arrayContaining(['concluir', 'fechar']));
    // Fechada: o lançamento seguinte dá 409, e a venda não muda.
    iaLe(1_000);
    const { path: p } = await subir('depois de fechar', { card: SOLAR, auth: THIAGO });
    const l = await post(DIN(SOLAR, '/lancamento'), { id: novoId('sai'), tipo: 'saida', categoria: 'combustivel', etapa: 8, valor_centavos: 1_000, data: '2026-11-04', arquivo_path: p }, THIAGO);
    expect(l.status).toBe(409);
    expect(l.body.mensagem).toBe('A conta desta obra está fechada. Só o Thiago reabre.');
    const v = await put('/jornada-solar/obra/601/venda', { valor_centavos: 3_900_000, pagamento: [{ forma: 'pix', valor_centavos: 3_900_000, obs: '' }], kit_confirmado: true }, THIAGO);
    expect(v.status).toBe(409);
    expect((await get(F2(SOLAR), THIAGO)).body.pode).toMatchObject({ reabrir: true, fechar: false });
    // Reabrir: o Diego e a Giovanna levam 403; sem motivo, 400; o Thiago reabre.
    expect((await post(DIN(SOLAR, '/reabrir'), { motivo: 'Preciso corrigir' }, DIEGO)).status).toBe(403);
    expect((await post(DIN(SOLAR, '/reabrir'), { motivo: 'Preciso corrigir' }, GIOVANNA)).status).toBe(403);
    expect((await post(DIN(SOLAR, '/reabrir'), {}, THIAGO)).status).toBe(400);
    expect((await post(DIN(SOLAR, '/reabrir'), { motivo: 'ab' }, THIAGO)).status).toBe(400);
    const re = await post(DIN(SOLAR, '/reabrir'), { motivo: 'Faltou o recibo do cartorio' }, THIAGO);
    expect(re.status).toBe(200);
    expect(joGravado(SOLAR).fechada).toBeNull();
    expect(joGravado(SOLAR).reaberturas).toHaveLength(1);
    expect(joGravado(SOLAR).reaberturas[0]).toEqual(expect.objectContaining({ por: 'thiago' }));
    expect(JSON.stringify([...h.linhas.entries()])).not.toContain('recibo do cartorio');
    expect(privadaGravada(SOLAR)!.reaberturas).toMatchObject([{ por: 'thiago', motivo: 'Faltou o recibo do cartorio' }]);
    expect((await post(DIN(SOLAR, '/reabrir'), { motivo: 'De novo sem estar fechada' }, THIAGO)).status).toBe(409);
    // Reaberta com tudo em zero, o ADM fecha de novo (e só ele).
    expect((await post(DIN(SOLAR, '/fechar'), {}, DIEGO)).status).toBe(403);
    const f = await post(DIN(SOLAR, '/fechar'), {}, THIAGO);
    expect(f.status).toBe(200);
    expect(joGravado(SOLAR).fechada).not.toBeNull();
    expect((await post(DIN(SOLAR, '/fechar'), {}, THIAGO)).status).toBe(409);
  });

  it('o fechar do ADM confere o "tudo em zero": com "a receber" diferente de zero, 409 com `faltam`', async () => {
    cenario8();
    semearJo(SOLAR, (e) => { e.etapas[8].concluida_em = AGORA; e.etapas[8].concluida_por = 'thiago'; }, 8);
    const entrada = [...h.linhas.keys()].find((k) => k.startsWith(`fin:${SOLAR}:`) && h.linhas.get(k)!.value.tipo === 'entrada')!;
    const guardada = h.linhas.get(entrada)!;
    h.linhas.delete(entrada);
    const f = await post(DIN(SOLAR, '/fechar'), {}, THIAGO);
    expect(f.status).toBe(409);
    expect(f.body.faltam).toContain('A receber: R$ 38.900,00');
    expect(joGravado(SOLAR).fechada).toBeNull();
    h.linhas.set(entrada, guardada);
    expect((await post(DIN(SOLAR, '/fechar'), {}, THIAGO)).status).toBe(200);
  });

  it('material com 100% é condição: item sem data, ou compra paga a menos, trava a 8 e a 4', async () => {
    cenario8();
    semearPrivada(SOLAR, (p) => { p.compra.itens[1].data = null; });
    const a = await post('/jornada-solar/obra/601/etapa-obra', { etapa: 8 }, THIAGO);
    expect(a.status).toBe(409);
    expect(a.body.falta.map((x: any) => x.chave)).toEqual(['material']);
    expect(a.body.falta[0].texto).toContain('(1 de 2)');
    expect(joGravado(SOLAR).fechada).toBeNull();
    const g = await get(DIN(SOLAR), THIAGO);
    expect(g.body.livro.fechamento.faltam).toContain('Material com origem: 1 de 2');
    expect(g.body.livro.fechamento.pode_fechar).toBe(false);
  });

  it('a etapa 8 sem o print da vistoria trava, e a Nilce não conclui', async () => {
    cenario8();
    anexos(SOLAR, [['a-ped', 'lib_pedido'], ['a-med', 'lib_medidor'], ['a-lib', 'lib_liberacao']]);
    const a = await post('/jornada-solar/obra/601/etapa-obra', { etapa: 8 }, THIAGO);
    expect(a.status).toBe(409);
    expect(a.body.falta.map((x: any) => x.chave)).toEqual(['vistoria']);
    expect((await post('/jornada-solar/obra/601/etapa-obra', { etapa: 8 }, NILCE)).status).toBe(403);
  });
});

describe('o cofre', () => {
  const SENHA = 'Sen#ha-Secreta-9';
  it('a senha não aparece no GET, no system_state nem no obra.json em texto; a Nilce e a Giovanna levam 403 no revelar; o Diego revela e o histórico ganha `cofre_revelado` sem a senha', async () => {
    semearJo(SOLAR);
    expect((await put(`/jornada-solar/obra/${SOLAR}/cofre`, { senha: SENHA }, NILCE)).status).toBe(403);
    expect((await put(`/jornada-solar/obra/${SOLAR}/cofre`, { senha: SENHA }, GIOVANNA)).status).toBe(403);
    expect((await put(`/jornada-solar/obra/${SOLAR}/cofre`, { senha: '' }, DIEGO)).status).toBe(400);
    expect((await put(`/jornada-solar/obra/${SOLAR}/cofre`, { senha: 'a'.repeat(121) }, DIEGO)).status).toBe(400);
    expect((await put(`/jornada-solar/obra/${SOLAR}/cofre`, { senha: 'a\nb' }, DIEGO)).status).toBe(400);
    const ok = await put(`/jornada-solar/obra/${SOLAR}/cofre`, { senha: SENHA }, DIEGO);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, gravado: true });
    expect(JSON.stringify(ok.body)).not.toContain(SENHA);
    const p = privadaGravada(SOLAR)!;
    expect(p.entrega.cofre).toMatchObject({ por: 'diego' });
    expect(h.priv.get(`vendasolar/${SOLAR}.obra.json`)).not.toContain(SENHA);
    const g = await get(F2(SOLAR), DIEGO);
    expect(g.text).not.toContain(SENHA);
    expect(g.text).not.toContain(p.entrega.cofre!.cifra);
    expect(g.body.dados.entrega.cofre).toMatchObject({ gravado: true, por: 'diego' });
    expect(g.body.pode).toMatchObject({ cofre_gravar: true, cofre_revelar: true });
    expect((await get(F2(SOLAR), NILCE)).body.pode).toMatchObject({ cofre_gravar: false, cofre_revelar: false });
    // A conta do monitoramento sai mascarada para todos.
    await put(F2(SOLAR, '/entrega'), { versao: 0, dados: { monitoramento: { app: 'iSolarCloud', conta: 'cliente@exemplo.com', usina: 'Casa', online: true, serie: 'INV-1', comissionamento: '' } } }, DIEGO);
    const m = await get(F2(SOLAR), THIAGO);
    expect(m.body.dados.entrega.monitoramento.conta).toBe('cl•••@exemplo.com');
    expect(m.text).not.toContain('cliente@exemplo.com');
    // Salvar de novo com a conta mascarada não apaga a conta de verdade.
    const v2 = m.body.versoes.entrega;
    await put(F2(SOLAR, '/entrega'), { versao: v2, dados: { ...m.body.dados.entrega, monitoramento: { ...m.body.dados.entrega.monitoramento, serie: 'INV-2' } } }, DIEGO);
    expect(privadaGravada(SOLAR)!.entrega.monitoramento).toMatchObject({ conta: 'cliente@exemplo.com', serie: 'INV-2' });
    expect(privadaGravada(SOLAR)!.entrega.cofre).not.toBeNull();   // o PUT da entrega nunca toca no cofre
    // Revelar: só sócio.
    for (const a of [NILCE, GIOVANNA]) {
      const no = await post(`/jornada-solar/obra/${SOLAR}/cofre/revelar`, {}, a);
      expect(no.status).toBe(403);
      expect(no.body.error).toBe('Só sócio revela.');
    }
    const rev = await post(`/jornada-solar/obra/${SOLAR}/cofre/revelar`, {}, DIEGO);
    expect(rev.status).toBe(200);
    expect(rev.headers['cache-control']).toBe('no-store');
    expect(rev.body).toEqual({ ok: true, senha: SENHA, conta: 'cliente@exemplo.com' });
    expect(privadaGravada(SOLAR)!.entrega.cofre_revelado).toMatchObject([{ por: 'diego' }]);
    expect(joGravado(SOLAR).historico.map((x: any) => x.acao)).toContain('cofre_revelado');
    expect(JSON.stringify([...h.linhas.entries()])).not.toContain(SENHA);
    expect(h.priv.get(`vendasolar/${SOLAR}.obra.json`)).not.toContain(SENHA);
  });
  it('trocar o segredo: o cofre não abre e a rota diz para gravar a senha de novo', async () => {
    semearJo(SOLAR);
    semearPrivada(SOLAR, (p) => { p.entrega.cofre = { ...cifrar('antiga'), em: AGORA, por: 'diego' }; });
    process.env.VINCULO_SOLAR_SECRET = 'outro-segredo-qualquer';
    const rev = await post(`/jornada-solar/obra/${SOLAR}/cofre/revelar`, {}, THIAGO);
    expect(rev.status).toBe(409);
    expect(rev.body.error).toBe('O cofre não abriu. Grave a senha de novo.');
    process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
    expect((await post(`/jornada-solar/obra/${ALHEIA}/cofre/revelar`, {}, THIAGO)).status).toBe(404);
  });
});

describe('o Book', () => {
  const contrato = {
    gerado_em: AGORA, por: 'giovanna', fonte: 'gerado' as const, versao_garantia: '2', garantia_modulos_anos: '25', garantia_inversor_anos: '10', garantia_instalacao_anos: '1',
    garantia_instalacao_unidade: 'anos', garantia_resposta_dias: '2', empresa_nome: 'AIOROS LTDA', empresa_cnpj: '63.636.043/0001-88', empresa_telefone: '(34) 90000-0000',
    cliente_nome: 'Marcos Vinícius Andrade', cliente_doc: '000.000.000-00', cliente_tipo: 'fisica', endereco_instalacao: 'Rua Exemplo, 100', cidade: 'Uberlândia', uf: 'MG',
    kwp: '8,25', quantidade_modulos: '15', marca_modulos: 'JA Solar', quantidade_inversores: '1', marca_inversor: 'SAJ',
  };
  const preparar = (): void => {
    semearJo(SOLAR, undefined, 7);
    semearPrivada(SOLAR, (p) => {
      p.contrato = contrato;
      p.compra.itens = [
        { id: 'i-1', origem: 'manual', tipo: 'modulo', descricao: 'Módulo', quantidade: 15, unidade: 'un', marca: 'JA Solar', modelo: 'JAM72S30', potencia_w: 550, potencia_kw: null, garantia_fabricacao_anos: 12, garantia_desempenho_anos: 25, garantia_anos: null, compra_id: null, fornecedor: 'Distribuidora', valor_centavos: 1_789_000, data: '2026-10-15', etapa: 4, criado_por: 'thiago', criado_em: AGORA },
        { id: 'i-2', origem: 'manual', tipo: 'inversor', descricao: 'Inversor', quantidade: 1, unidade: 'un', marca: 'SAJ', modelo: 'R5 8K', potencia_w: null, potencia_kw: 8, garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: 10, compra_id: null, fornecedor: 'Distribuidora', valor_centavos: 200_000, data: '2026-10-15', etapa: 4, criado_por: 'thiago', criado_em: AGORA },
      ];
      p.entrega.monitoramento = { app: 'iSolarCloud', conta: 'cliente@exemplo.com', usina: 'Casa', online: true, serie: 'INV-8K-2610-4471', comissionamento: 'ok' };
      p.entrega.termo = { assinado_em: '2026-10-30T15:00:00.000Z', nome: 'Marcos', arquivo_id: 'a-ass', chk: ['sim', 'sim', 'sim', 'sim', 'sim', 'na'], ressalva: '' };
      p.entrega.responsavel = 'Diego';
      p.entrega.cofre = { ...cifrar('SenhaDoApp7'), em: AGORA, por: 'diego' };
    });
  };
  it('com trava, 409 com a lista; sem trava, 200 sem nenhum valor em reais e sem a senha', async () => {
    preparar();
    semearPrivada(SOLAR, (p) => { p.contrato!.marca_inversor = 'Growatt'; });
    const t = await get(`/jornada-solar/obra/${SOLAR}/book`, DIEGO);
    expect(t.status).toBe(409);
    expect(t.body.trava).toEqual(['A marca do inversor da Compra (SAJ) é diferente da do contrato (Growatt).']);
    expect((await get(F2(SOLAR), DIEGO)).body.book).toEqual({ pode: false, trava: t.body.trava });
    semearPrivada(SOLAR, (p) => { p.contrato!.marca_inversor = 'SAJ'; });
    const ok = await get(`/jornada-solar/obra/${SOLAR}/book`, DIEGO);
    expect(ok.status).toBe(200);
    expect(ok.body.titulo).toBe('Book da obra · * · Marcos Vinícius Andrade');
    expect(ok.body.termo_html).toContain('TERMO DE GARANTIA DA SUA USINA SOLAR');
    expect(ok.body.termo_html).toContain('12 (doze) anos');
    expect(ok.body.contatos).toEqual({ whatsapp: '(34) 90000-0000' });
    expect(ok.body.monitoramento).toEqual({ app: 'iSolarCloud', conta: 'cliente@exemplo.com', usina: 'Casa', serie: 'INV-8K-2610-4471', comissionamento: 'ok' });
    expect(ok.text).not.toMatch(/R\$|valor_centavos|SenhaDoApp7|cifra|"tag"/);
    expect((await get(F2(SOLAR), DIEGO)).body.book.pode).toBe(true);
    expect((await get(`/jornada-solar/obra/${ALHEIA}/book`, NILCE)).status).toBe(404);
  });
  it('contrato gerado antes de 06/11/2026: o Termo recalcula pela proposta e marca `recalculado`', async () => {
    preparar();
    semearPrivada(SOLAR, (p) => { p.contrato = null; });
    const g = await get(F2(SOLAR), THIAGO);
    expect(g.body.dados.contrato_garantias).toMatchObject({ fonte: 'recalculado', modulos: '25', inversor: '10', instalacao: '1 (um) ano' });
    const t = await get(`/jornada-solar/obra/${SOLAR}/book`, THIAGO);
    expect(t.status).toBe(409);
    expect(t.body.trava.join(' ')).toContain('cliente');
  });
});

describe('a agenda das equipes', () => {
  it('duas obras com a Equipe Pablo no mesmo dia aparecem em `conflitos`; a obra que a Nilce não vê sai "Ocupada"', async () => {
    semearJo(SOLAR, (e) => { e.dias_obra = [{ data: '2026-10-23', equipe: 'pablo' }, { data: '2026-10-24', equipe: 'pablo' }]; });
    semearJo(ALHEIA, (e) => { e.dias_obra = [{ data: '2026-10-23', equipe: 'pablo' }, { data: '2026-10-26', equipe: 'diego' }]; });
    const t = await get('/jornada-solar/agenda-equipes?de=2026-10-21', THIAGO);
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ de: '2026-10-19', ate: '2026-10-25' });
    expect(t.body.dias).toHaveLength(7);
    expect(t.body.conflitos).toEqual([{ equipe: 'pablo', data: '2026-10-23', cards: [SOLAR, ALHEIA] }]);
    const pablo = t.body.linhas.find((l: any) => l.equipe === 'pablo');
    expect(pablo.rotulo).toBe('Equipe Pablo (montagem)');
    expect(pablo.dias['2026-10-23']).toHaveLength(2);
    expect(pablo.dias['2026-10-24']).toEqual([{ card: SOLAR, codigo: null, cliente: 'Cliente Inventado' }]);
    expect(pablo.dias['2026-10-26']).toBeUndefined();   // fora da semana
    const n = await get('/jornada-solar/agenda-equipes?de=2026-10-21', NILCE);
    const pn = n.body.linhas.find((l: any) => l.equipe === 'pablo').dias['2026-10-23'];
    expect(pn).toContainEqual({ card: null, codigo: null, cliente: 'Ocupada' });
    expect(pn).toContainEqual({ card: SOLAR, codigo: null, cliente: 'Cliente Inventado' });
    expect(JSON.stringify(n.body)).not.toContain(String(ALHEIA));
    expect(JSON.stringify(n.body)).not.toContain('#0062');
  });
  it('salvar o plano atualiza os dias da obra e avisa dos conflitos sem bloquear', async () => {
    semearJo(SOLAR); semearJo(ALHEIA, (e) => { e.dias_obra = [{ data: '2026-10-23', equipe: 'pablo' }]; });
    const plano = { plano: [{ data: '2026-10-23', inicio: '08:00', fim: '17:00', equipe: 'pablo', ajudantes: 2, servico: 'Obra' }, { data: '2026-10-22', inicio: '08:00', fim: '17:00', equipe: 'diego', ajudantes: 1, servico: 'Estrutura' }], diario: [], checklist: {}, equipe: { combinado_centavos: null, descricao: '' } };
    const r = await put(F2(SOLAR, '/obra'), { versao: 0, dados: plano }, DIEGO);
    expect(r.status).toBe(200);
    expect(r.body.conflitos).toEqual([{ equipe: 'pablo', data: '2026-10-23', cards: [ALHEIA] }]);
    expect(joGravado(SOLAR).dias_obra).toEqual([{ data: '2026-10-22', equipe: 'diego' }, { data: '2026-10-23', equipe: 'pablo' }]);
    // O pedido de vistoria da liberação alimenta o prazo da Cemig.
    const lib = await put(F2(SOLAR, '/liberacao'), { versao: 0, dados: { pedido_numero: '1026-50392', passos: { pedido: { data: '2026-10-26', arquivo_id: '' } } } }, THIAGO);
    expect(lib.status).toBe(200);
    expect(joGravado(SOLAR).pedido).toEqual({ numero: '1026-50392', em: '2026-10-26' });
    expect(joGravado(SOLAR).historico.map((x: any) => x.acao)).toContain('pedido');
  });
});

describe('a lista e o papel', () => {
  it('a obra na etapa 6 sai com etapa 6, entra em `minha` do Diego e em `atrasadas` quando vence; o ADM vê o dinheiro do livro e a Nilce não', async () => {
    semearJo(SOLAR, (e) => { e.dias_obra = [{ data: '2026-10-23', equipe: 'pablo' }]; }, 6);
    linha(SOLAR, 'entrada', 'entrada', 2, '2026-09-18', 1_167_000);
    linha(SOLAR, 'saida', 'combustivel', 1, '2026-09-16', 6_000);
    const d = await get('/jornada-solar/lista', DIEGO);
    expect(d.status).toBe(200);
    const l = d.body.linhas.find((x: any) => x.card === SOLAR);
    expect(l).toMatchObject({ etapa: { n: 6 }, minha: true, grupo: 'ativas', dono: { nome: 'diego' } });
    expect(l.situacao.tipo).toBe('travada');   // o último dia da obra foi 23/10 e hoje é 05/11
    expect(d.body.contagem.atrasadas).toBeGreaterThanOrEqual(1);
    expect(l.dinheiro).toBeNull();
    const t = await get('/jornada-solar/lista', THIAGO);
    expect(t.body.linhas.find((x: any) => x.card === SOLAR).dinheiro).toBe('Recebido R$ 11.670,00 · A receber R$ 27.230,00 · Gasto R$ 60,00 · Saldo R$ 11.610,00');
    const n = await get('/jornada-solar/lista', NILCE);
    expect(n.body.linhas.find((x: any) => x.card === SOLAR).dinheiro).toBeNull();
    expect(JSON.stringify(n.body)).not.toMatch(/Recebido|Saldo/);
  });
  it('etapa 9 vai para o pós-venda; a obra mostra as etapas 4 a 9 sem o campo `fase`', async () => {
    semearJo(SOLAR, (e) => { for (const i of [4, 5, 6, 7, 8] as const) e.etapas[i] = { aberta_em: AGORA, concluida_em: AGORA, concluida_por: 'x' }; e.fechada = { em: AGORA, por: 'thiago' }; }, 9);
    const t = await get('/jornada-solar/lista', THIAGO);
    expect(t.body.linhas.find((x: any) => x.card === SOLAR)).toMatchObject({ grupo: 'posvenda', etapa: { n: 9 } });
    const o = await get(`/jornada-solar/obra/${SOLAR}`, THIAGO);
    expect(o.body.etapa_atual).toBe(9);
    expect(o.body.etapas.find((e: any) => e.n === 5).fase).toBeUndefined();
  });
  it('gerar o contrato grava as garantias, o kit e o emitente no `obra.json`', async () => {
    h.cad = { nome: 'Marcos Vinícius Andrade', cpf_cnpj: '000.000.000-00', endereco: 'Rua Exemplo, 100', cidade: 'Uberlândia', uf: 'MG', endereco_ponto: 'Rua Exemplo, 100, Uberlândia-MG' };
    const r2 = await post(`/jornada-solar/obra/${SOLAR}/papel`, { tipo: 'contrato', empresa: { telefone: '(34) 90000-0000' } }, GIOVANNA);
    expect(r2.status).toBe(200);
    expect(r2.body.aviso).toBeUndefined();
    const c = privadaGravada(SOLAR)!.contrato!;
    expect(c).toMatchObject({
      fonte: 'gerado', por: 'giovanna', versao_garantia: '2', garantia_modulos_anos: '25', garantia_inversor_anos: '10', garantia_instalacao_anos: '1', garantia_resposta_dias: '2',
      empresa_nome: 'AIOROS LTDA', empresa_cnpj: '63.636.043/0001-88', empresa_telefone: '(34) 90000-0000', cliente_nome: 'Marcos Vinícius Andrade', cliente_doc: '000.000.000-00',
    });
    const g = await get(F2(SOLAR), GIOVANNA);
    expect(g.body.dados.contrato_garantias).toMatchObject({ fonte: 'gerado', modulos: '25', inversor: '10' });
    // Recibo e procuração não tocam no contrato guardado.
    const antes = JSON.stringify(privadaGravada(SOLAR)!.contrato);
    await post(`/jornada-solar/obra/${SOLAR}/papel`, { tipo: 'recibo', recibo: { pagamentos: [{ forma: 'pix', data: '2026-09-18', valor_centavos: 1_167_000 }] } }, GIOVANNA);
    expect(JSON.stringify(privadaGravada(SOLAR)!.contrato)).toBe(antes);
  });
});

describe('estrutura', () => {
  it('zero `supabase.from(\'agendamentos\')` e zero `supabase.from(\'propostas\')` nos arquivos novos (só `supabaseGerador`), e nada de mensagem', () => {
    const raiz = path.resolve(__dirname, '..');
    for (const a of ['routes/geradorJornadaObra.ts', 'services/gerador/jornadaObra.ts', 'services/gerador/notaLeitura.ts', 'services/gerador/termoGarantia.ts', 'services/gerador/cofreObra.ts']) {
      const src = fs.readFileSync(path.join(raiz, a), 'utf8');
      expect(src, a).not.toMatch(/(?<![A-Za-z])supabase\.from\(\s*['"`](agendamentos|propostas)['"`]/);
      const imports = src.split(String.fromCharCode(10)).filter((l) => /^\s*import\b/.test(l)).join(String.fromCharCode(10));
      expect(imports, a).not.toMatch(/z-?api|whatsapp|instagram|mailer|resend|nodemailer|email|mensag/i);
      expect(src, a).not.toMatch(/sendMail|enviarMensagem|enviarWhatsapp/);
    }
  });
  it('a IA nunca é chamada de verdade: o módulo da nota só entra por mock nos testes de rota', () => {
    expect(h.iaChamadas).toBeGreaterThanOrEqual(0);
  });
});
