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
  comTrava: async (_id: unknown, _por: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../routes/geradorSolar', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorSolar')>()),
  planilha: async () => ({ dados: { obras: [], ts: Date.now() }, atual: true }),
  comSobrescritas: async (o: any[]) => o,
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
import { esquecerConferenciaDoBucket } from '../services/gerador/financeiroArquivos';
import { assinarJornada, normalizarJornada, reiniciarLogsDaJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';
import { assinarObra, obraVazia } from '../services/gerador/jornadaObraBanco';
import { AJUSTES_PADRAO, assinarAjustes, idDoEstorno, normalizarAjustes } from '../services/gerador/jornadaDinheiro';
import { assinarLigacao, invalidarCachesHub, POR_GERADOR, reiniciarLogsDoHub } from '../services/gerador/vendaSolarHub';

const r = Router();
mountFinanceiro(r);
mountJornadaDinheiro(r);
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

const SOLAR = 601;      // venda solar da Nilce
const ALHEIA = 602;     // venda solar da Carla, com o número #0062
const ELETRO = 701;     // eletroposto vendido, da Nilce
const ELETRO_ALHEIO = 702;
const cardBase = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Cliente Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', quando: null, historico: '', ...o,
});
const dinheiro = (card: number, sufixo = '') => `/jornada-solar/obra/${card}/dinheiro${sufixo}`;

let n = 0;
const novoId = (p = 'lan'): string => `${p}-${String(++n).padStart(8, '0')}`;
const PDF = (texto: string): Buffer => Buffer.from(`%PDF-1.4\n${texto}\n%%EOF`);
const iaLe = (valor: number | null, extra: Record<string, unknown> = {}) => {
  h.ia = () => ({
    ok: true, eh_comprovante: true,
    sugestao: { valor_centavos: valor, data: '2026-11-04', pagador: null, recebedor: 'Fornecedor Inventado', forma: 'pix', id_transacao: null, descricao: null, confianca: 'alta', ...extra },
  });
};

/** Sobe um comprovante pela rota e devolve o caminho dele. */
async function subir(texto: string, o: { card?: number; auth?: string; ler?: boolean; doc?: 'comprovante' | 'nota' } = {}) {
  const res = await post(dinheiro(o.card ?? SOLAR, '/comprovante'), { base64: PDF(texto).toString('base64'), media_type: 'application/pdf', nome: 'comprovante.pdf', ler: o.ler ?? true, ...(o.doc ? { doc: o.doc } : {}) }, o.auth ?? NILCE);
  return { res, path: res.body?.arquivo?.path as string };
}
const corpoGasto = (arquivo_path: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: novoId('sai'), tipo: 'saida', categoria: 'frete', etapa: 4, valor_centavos: 25_000, data: '2026-11-04', forma: 'pix', descricao: 'Frete do depósito', contraparte: 'Frete Rápido Udi',
  ...(arquivo_path ? { arquivo_path } : {}), ...extra,
});
const corpoEntrada = (arquivo_path: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: novoId('ent'), tipo: 'entrada', categoria: 'entrada', etapa: 2, valor_centavos: 1_167_000, data: '2026-10-01', forma: 'pix', ...(arquivo_path ? { arquivo_path } : {}), ...extra,
});
/** Um gasto completo: sobe, a IA lê o valor e lança. */
async function gastar(texto: string, valor = 25_000, o: { card?: number; auth?: string; extra?: Record<string, unknown> } = {}) {
  iaLe(valor);
  const { path: p } = await subir(texto, { card: o.card, auth: o.auth });
  return post(dinheiro(o.card ?? SOLAR, '/lancamento'), corpoGasto(p, { valor_centavos: valor, ...(o.extra ?? {}) }), o.auth ?? NILCE);
}
const fins = (card = SOLAR): string[] => [...h.linhas.keys()].filter((k) => k.startsWith(`fin:${card}:`));
const gravado = (card = SOLAR): Array<Record<string, any>> => fins(card).map((k) => h.linhas.get(k)!.value);

const semear = (id: number, etapa = 4, vendedor = 'Nilce'): void => {
  const e = estadoMaterializado(id, vendedor, etapa, AGORA);
  const nn = normalizarJornada(id, { ...e, origem: 'vendido', vendido_em: AGORA, vendido_por: 'nilce' })!;
  h.linhas.set(`jornada_solar:${id}`, { updated_at: 'j0', value: jsonb({ ...nn, sig: assinarJornada(id, nn) }) });
};
const venda = (id: number, valor = 3_890_000): void => {
  h.priv.set(`vendasolar/${id}.jornada.json`, JSON.stringify({ v: 1, venda: { valor_centavos: valor, pagamento: [{ forma: 'pix', valor_centavos: valor, obs: '' }], desconto_centavos: null, prazo_prometido: '', nota: '', kit_confirmado: true, combinado_por: 'nilce', combinado_em: AGORA, editado: [] }, cancelamento: null, descancelamentos: [] }));
};
const fechar = (id: number): void => {
  const o = { ...obraVazia(id), fechada: { em: AGORA, por: 'thiago' } };
  h.linhas.set(`jornada_obra:${id}`, { updated_at: 'o0', value: jsonb({ ...o, sig: assinarObra(id, o) }) });
};
const ajustes = (aberto: boolean): void => {
  const a = normalizarAjustes({ ...AJUSTES_PADRAO, dinheiro_aberto: aberto, editado_em: AGORA, editado_por: 'thiago' })!;
  h.linhas.set('jornada_solar_ajustes', { updated_at: 'a0', value: jsonb({ ...a, sig: assinarAjustes(a) }) });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AGORA));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
  };
  h.agendamentos = [
    cardBase(SOLAR), cardBase(ALHEIA, { vendedor_nome: 'Carla' }),
    cardBase(ELETRO, { created_by: 'lp_eletroposto' }), cardBase(ELETRO_ALHEIO, { created_by: 'lp_eletroposto', vendedor_nome: 'Carla' }),
  ];
  h.linhas = new Map(); h.priv = new Map(); h.bucket = new Map(); h.tique = 0; h.iaChamadas = 0; h.ia = null; h.nota = null;
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS;
  invalidarCachesHub(); reiniciarLogsDoHub(); reiniciarLogsDaJornada(); esquecerConferenciaDoBucket();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede indisponível no teste'); }));
  semear(SOLAR); semear(ALHEIA, 4, 'Carla'); venda(SOLAR); venda(ALHEIA);
  // `por: gerador`: o número veio do alocador do Gerador, então a planilha não dá a obra ao consultor dela (e o teste não precisa da grade).
  const lig = { proposta: null, venda: '#0062', por: POR_GERADOR, em: AGORA };
  h.linhas.set(`venda_solar:${ALHEIA}`, { updated_at: 'v', value: { ...lig, sig: assinarLigacao(ALHEIA, lig) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('sem comprovante não salva', () => {
  it('sem `arquivo_path`, com caminho de outro card ou sem a leitura gravada: 400, e nada é gravado', async () => {
    const sem = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(undefined));
    expect(sem.status).toBe(400);
    expect(sem.body).toMatchObject({ error: 'comprovante_obrigatorio', mensagem: 'Sem comprovante, o lançamento não entra.' });
    iaLe(25_000);
    const outro = await subir('arquivo da alheia', { card: ALHEIA, auth: THIAGO });
    const deOutro = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(outro.path));
    expect(deOutro.status).toBe(400);
    expect(deOutro.body.error).toBe('comprovante_obrigatorio');
    const inventado = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(`fin/${SOLAR}/202611/3f2504e0-4f89-41d3-9a0c-0305e82c3301.pdf`));
    expect(inventado.status).toBe(400);
    expect(inventado.body).toMatchObject({ error: 'comprovante_nao_encontrado', mensagem: 'Anexe o comprovante de novo.' });
    const nota = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(`fin/${SOLAR}/202611/3f2504e0-4f89-41d3-9a0c-0305e82c3301.pdf.ia.json`));
    expect(nota.status).toBe(400);
    expect(fins()).toEqual([]);
    expect(fins(ALHEIA)).toEqual([]);
  });

  it('o comprovante sobe com a leitura gravada ao lado e a resposta traz a sugestão', async () => {
    iaLe(25_000);
    const { res, path: p } = await subir('um comprovante');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, leitura: 'ok', sugestao: { valor_centavos: 25_000, confianca: 'alta' }, nota: null });
    expect(res.body.arquivo.url).toContain('assinado.test');
    expect(res.body.repetido).toBeUndefined();
    const ia = JSON.parse(h.bucket.get(`${p}.ia.json`)!.toString('utf8'));
    expect(ia).toMatchObject({ v: 1, card_id: SOLAR, path: p, doc: 'comprovante', por: 'nilce', leitura: 'ok', sugestao: { valor_centavos: 25_000 } });
    expect(ia.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.iaChamadas).toBe(1);
    // O servidor sempre lê: o `ler: false` da Nilce é ignorado. Só o ADM pula.
    const sem = await subir('outro comprovante', { ler: false });
    expect(sem.res.body.leitura).toBe('ok');
    expect(h.iaChamadas).toBe(2);
    const adm = await subir('comprovante sem ia', { ler: false, auth: THIAGO });
    expect(adm.res.body.leitura).toBe('pulada');
    expect(h.iaChamadas).toBe(2);
  });

  it('uma nota fiscal não paga lançamento: 400 `e_nota`', async () => {
    const { path: p, res } = await subir('uma nota fiscal', { doc: 'nota', ler: false, auth: THIAGO });
    expect(res.status).toBe(200);
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p), THIAGO);
    expect(l.status).toBe(400);
    expect(l.body).toMatchObject({ error: 'e_nota', mensagem: 'Isto é uma nota fiscal. Para pagar, anexe o comprovante do pagamento.' });
    expect(fins()).toEqual([]);
  });

  it('o arquivo que a IA diz que não é comprovante: 409 `nao_e_comprovante`', async () => {
    h.ia = () => ({ ok: true, eh_comprovante: false, sugestao: { valor_centavos: null, data: null, pagador: null, recebedor: null, forma: null, id_transacao: null, descricao: null, confianca: 'baixa' } });
    const { path: p, res } = await subir('uma foto qualquer');
    expect(res.body.leitura).toBe('nao_e_comprovante');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p));
    expect(l.status).toBe(409);
    expect(l.body).toMatchObject({ error: 'nao_e_comprovante' });
    expect(fins()).toEqual([]);
  });
});

describe('a IA confere o valor no servidor', () => {
  it('leitura 25.000 e digitado 26.000: 409 com o valor lido; a Nilce com `confirmar_valor` continua 409; o Thiago passa e fica `divergente_adm`', async () => {
    iaLe(25_000);
    const { path: p } = await subir('comprovante do frete');
    const dig = corpoGasto(p, { valor_centavos: 26_000 });
    const a = await post(dinheiro(SOLAR, '/lancamento'), dig);
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ error: 'valor_diferente', valor_lido_centavos: 25_000, mensagem: 'O comprovante diz R$ 250,00.' });
    const b = await post(dinheiro(SOLAR, '/lancamento'), { ...dig, confirmar_valor: true });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('valor_diferente');
    expect(fins()).toEqual([]);
    const c = await post(dinheiro(SOLAR, '/lancamento'), { ...dig, confirmar_valor: true }, THIAGO);
    expect(c.status).toBe(200);
    expect(c.body.lancamento).toMatchObject({ valor_centavos: 26_000, conferencia: 'divergente_adm' });
    expect(gravado()[0].obra.conferencia).toBe('divergente_adm');
    expect(c.body.livro.gasto).toBe(26_000);
  });

  it('valor igual ao lido: `bateu`, `origem: ia`, e o `lido_pela_ia` do corpo é ignorado', async () => {
    iaLe(25_000);
    const { path: p } = await subir('comprovante que bate');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { lido_pela_ia: { valor_centavos: 1, data: '2020-01-01', id_transacao: 'FORJADO' }, origem: 'manual', conferencia: 'divergente_adm', id_transacao: 'FORJADO-2' }));
    expect(l.status).toBe(200);
    const g = gravado()[0];
    expect(g.obra.conferencia).toBe('bateu');
    expect(g.origem).toBe('ia');
    expect(g.lido_pela_ia).toEqual({ valor_centavos: 25_000, data: '2026-11-04', id_transacao: null });
    expect(g.id_transacao).toBe('');
    expect(g.arquivo).toMatchObject({ path: p, nome: 'comprovante.pdf', tipo: 'application/pdf' });
  });

  it('IA que falhou ou confiança baixa: salva marcado "não conferido", sem travar o dinheiro', async () => {
    h.ia = () => ({ ok: false, motivo: 'falhou' });
    const { path: p } = await subir('sem leitura');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { valor_centavos: 31_000 }));
    expect(l.status).toBe(200);
    expect(l.body.lancamento.conferencia).toBe('sem_leitura');
    h.ia = () => { throw new Error('IA fora do ar'); };
    const q = await subir('IA lançou erro');
    expect(q.res.status).toBe(200);
    expect(q.res.body.leitura).toBe('falhou');
    iaLe(99_999, { confianca: 'baixa' });
    const { path: p2 } = await subir('confianca baixa');
    const l2 = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p2, { valor_centavos: 31_500 }));
    expect(l2.status).toBe(200);
    expect(l2.body.lancamento.conferencia).toBe('baixa_confianca');
    const l3 = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(q.path, { valor_centavos: 100 }));
    expect(l3.status).toBe(200);
    expect(l3.body.lancamento.conferencia).toBe('sem_leitura');
  });

  it('a etapa tem que ter aberto: etapa 5 numa obra na etapa 4 dá 400', async () => {
    iaLe(25_000);
    const { path: p } = await subir('etapa adiante');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { etapa: 5 }));
    expect(l.status).toBe(400);
    expect(l.body).toMatchObject({ error: 'etapa_invalida', mensagem: 'Esta etapa ainda não abriu.' });
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { etapa: 0 }))).status).toBe(400);
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { etapa: 4 }))).status).toBe(200);
  });
});

describe('repetido é recusado', () => {
  it('o mesmo arquivo na mesma obra: 409 `comprovante_repetido`', async () => {
    expect((await gastar('o mesmo comprovante')).status).toBe(200);
    iaLe(25_000);
    const { path: p2, res } = await subir('o mesmo comprovante');
    expect(res.body.repetido).toEqual({ onde: 'esta obra' });
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p2));
    expect(l.status).toBe(409);
    expect(l.body).toMatchObject({ error: 'comprovante_repetido', onde: 'esta obra', mensagem: 'Este comprovante já foi lançado nesta obra.' });
    expect(fins()).toHaveLength(1);
  });

  it('em OUTRA obra também: quem a vê ouve o número; a Nilce, que não a vê, ouve "outra obra" sem número nem nome', async () => {
    const outra = await gastar('comprovante da obra da Carla', 25_000, { card: ALHEIA, auth: THIAGO });
    expect(outra.status).toBe(200);
    iaLe(25_000);
    const dela = await subir('comprovante da obra da Carla');
    expect(dela.res.body.repetido).toEqual({ onde: 'outra obra' });
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(dela.path));
    expect(l.status).toBe(409);
    expect(l.body).toMatchObject({ error: 'comprovante_repetido', onde: 'outra obra', mensagem: 'Este comprovante já foi lançado em outra obra.' });
    expect(JSON.stringify(l.body)).not.toMatch(/0062|Carla|carla|Cliente Inventado/);
    // O Thiago, que vê a obra da Carla, ouve o número.
    iaLe(25_000);
    const dele = await subir('comprovante da obra da Carla', { auth: THIAGO });
    const l2 = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(dele.path), THIAGO);
    expect(l2.status).toBe(409);
    expect(l2.body).toMatchObject({ onde: 'a obra #0062', mensagem: 'Este comprovante já foi lançado na obra #0062.' });
    expect(fins()).toEqual([]);
  });

  it('num card do eletroposto (linha `fin:` sem assinatura) também, com `onde` "um card do eletroposto"', async () => {
    const bytes = PDF('comprovante do eletroposto');
    const { createHash } = await import('crypto');
    const sha = createHash('sha256').update(bytes).digest('hex');
    h.linhas.set(`fin:${ELETRO}:ent-00000001`, {
      updated_at: 'e0',
      value: jsonb({ id: 'ent-00000001', card_id: ELETRO, tipo: 'saida', categoria: 'equipamento', valor_centavos: 25_000, data: '2026-10-01', arquivo: { path: `fin/${ELETRO}/202610/x.pdf`, nome: 'x.pdf', tipo: 'application/pdf', tamanho: 10, sha256: sha }, apagado: false }),
    });
    iaLe(25_000);
    const { path: p } = await subir('comprovante do eletroposto', { auth: THIAGO });
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p), THIAGO);
    expect(l.status).toBe(409);
    expect(l.body).toMatchObject({ error: 'comprovante_repetido', onde: 'um card do eletroposto', mensagem: 'Este comprovante já foi lançado num card do eletroposto.' });
    expect(fins()).toEqual([]);
  });

  it('depois de estornar a primeira, o mesmo arquivo entra de novo (quem lançou errado relança)', async () => {
    const a = await gastar('relançar o mesmo');
    expect(a.status).toBe(200);
    const est = await post(dinheiro(SOLAR, '/estorno'), { id_original: a.body.lancamento.id, motivo: 'Lancei na obra errada' });
    expect(est.status).toBe(200);
    iaLe(25_000);
    const { path: p2 } = await subir('relançar o mesmo');
    const b = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p2));
    expect(b.status).toBe(200);
    expect(b.body.livro.gasto).toBe(25_000);
    expect(b.body.livro.linhas).toHaveLength(3);
  });

  it('o mesmo valor na mesma data é AVISO que se confirma (duas retiradas de R$ 778,00 com arquivos diferentes)', async () => {
    const dia = { data: '2026-09-21', forma: 'pix' };
    const l1 = await gastar('retirada um', 77_800, { extra: { ...dia, etapa: 2 } });
    expect(l1.status).toBe(200);
    iaLe(77_800);
    const { path: p2 } = await subir('retirada dois');
    const corpo = corpoGasto(p2, { ...dia, etapa: 2, valor_centavos: 77_800 });
    const sem = await post(dinheiro(SOLAR, '/lancamento'), corpo);
    expect(sem.status).toBe(409);
    expect(sem.body.error).toBe('possivel_duplicado');
    expect(sem.body.duplicados).toHaveLength(1);
    expect(sem.body.duplicados[0]).toMatchObject({ valor_centavos: 77_800, data: '2026-09-21', motivo: 'mesmo_valor_e_data', onde: 'esta obra' });
    const com = await post(dinheiro(SOLAR, '/lancamento'), { ...corpo, confirmar_duplicado: true });
    expect(com.status).toBe(200);
    expect(fins()).toHaveLength(2);
  });

  it('o mesmo ID de Pix em outra obra avisa sem mostrar valor nem data; a mesma obra repetindo o mesmo `id` devolve o que existe', async () => {
    const pix = 'E12345678202611041030abcdefghijk';
    iaLe(25_000, { id_transacao: pix });
    const a = await subir('pix um', { card: ALHEIA, auth: THIAGO });
    expect((await post(dinheiro(ALHEIA, '/lancamento'), corpoGasto(a.path), THIAGO)).status).toBe(200);
    const b = await subir('pix dois', { auth: THIAGO });
    const sem = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(b.path, { valor_centavos: 25_000 }), THIAGO);
    expect(sem.status).toBe(409);
    expect(sem.body.duplicados).toEqual([{ motivo: 'mesma_transacao', onde: 'a obra #0062' }]);
    const corpo = corpoGasto(b.path, { confirmar_duplicado: true });
    const ok = await post(dinheiro(SOLAR, '/lancamento'), corpo, THIAGO);
    expect(ok.status).toBe(200);
    expect(gravado()[0].id_transacao).toBe(pix);
    // O pedido repetido (toque duplo): mesma linha, sem gravar de novo.
    const outra = await post(dinheiro(SOLAR, '/lancamento'), corpo, THIAGO);
    expect(outra.status).toBe(200);
    expect(fins()).toHaveLength(1);
  });
});

describe('estorno', () => {
  it('o estorno zera a conta, as duas linhas ficam, e o segundo estorno da mesma linha dá 409', async () => {
    const a = await gastar('frete a estornar');
    const id = a.body.lancamento.id;
    const est = await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'Valor lançado errado' });
    expect(est.status).toBe(200);
    expect(est.body.livro.gasto).toBe(0);
    expect(est.body.livro.por_etapa['4']).toBe(0);
    expect(est.body.livro.linhas).toHaveLength(2);
    expect(est.body.livro.linhas.find((l: any) => l.id === id).estornada).toMatchObject({ por: 'nilce', motivo: 'Valor lançado errado' });
    expect(est.body.lancamento).toMatchObject({ estorno_de: id, conferencia: 'estorno', valor_centavos: 25_000 });
    expect(est.body.lancamento.id).toMatch(/^est-[0-9a-f]{40}$/);
    expect(fins()).toHaveLength(2);
    const outra = await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'De novo' });
    expect(outra.status).toBe(409);
    expect(outra.body).toMatchObject({ error: 'ja_estornado', mensagem: 'Este lançamento já foi estornado.' });
    expect(fins()).toHaveLength(2);
    // Estorno não se estorna.
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: est.body.lancamento.id, motivo: 'Estornar o estorno' })).status).toBe(400);
  });

  it('a Nilce não estorna o gasto do Diego; o Diego estorna o dele; motivo curto e original inexistente são recusados', async () => {
    const d = await gastar('gasto do Diego', 25_000, { auth: DIEGO });
    expect(d.status).toBe(200);
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: d.body.lancamento.id, motivo: 'Quero estornar' })).status).toBe(403);
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: d.body.lancamento.id, motivo: 'ab' }, DIEGO)).status).toBe(400);
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: 'nao-existe-000', motivo: 'Sem original' }, DIEGO)).status).toBe(404);
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: d.body.lancamento.id, motivo: 'Foi engano meu' }, DIEGO)).status).toBe(200);
  });

  it('a Giovanna estorna a entrada; a Nilce e o Diego não; devolução sem arquivo dá 400', async () => {
    iaLe(1_167_000);
    const { path: p } = await subir('entrada de 30 por cento', { auth: GIOVANNA });
    const e = await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), GIOVANNA);
    expect(e.status).toBe(200);
    const id = e.body.lancamento.id;
    expect(e.body.livro).toMatchObject({ recebido: 1_167_000, a_receber: 2_723_000 });
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'Pix devolvido' }, NILCE)).status).toBe(403);
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'Pix devolvido' }, DIEGO)).status).toBe(403);
    const semArquivo = await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'Pix devolvido', devolucao: true }, GIOVANNA);
    expect(semArquivo.status).toBe(400);
    expect(semArquivo.body.mensagem).toBe('A devolução precisa do comprovante.');
    const ok = await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'Pix devolvido' }, GIOVANNA);
    expect(ok.status).toBe(200);
    expect(ok.body.livro).toMatchObject({ recebido: 0, a_receber: 3_890_000 });
  });

  it('estorno com devolução leva o comprovante, que passa pela IA e pelo repetido', async () => {
    iaLe(1_167_000);
    const { path: p } = await subir('entrada com devolucao', { auth: GIOVANNA });
    const e = await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), GIOVANNA);
    iaLe(1_000);
    const dev = await subir('comprovante da devolucao', { auth: GIOVANNA });
    const errado = await post(dinheiro(SOLAR, '/estorno'), { id_original: e.body.lancamento.id, motivo: 'Devolvi o Pix', devolucao: true, arquivo_path: dev.path }, GIOVANNA);
    expect(errado.status).toBe(409);
    expect(errado.body.error).toBe('valor_diferente');
    iaLe(1_167_000);
    const dev2 = await subir('comprovante da devolucao certo', { auth: GIOVANNA });
    const ok = await post(dinheiro(SOLAR, '/estorno'), { id_original: e.body.lancamento.id, motivo: 'Devolvi o Pix', devolucao: true, arquivo_path: dev2.path }, GIOVANNA);
    expect(ok.status).toBe(200);
    expect(ok.body.lancamento).toMatchObject({ devolucao: true, conferencia: 'estorno' });
    expect(ok.body.lancamento.comprovante).not.toBeNull();
    // O mesmo comprovante de devolução não serve de novo.
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: e.body.lancamento.id, motivo: 'Outra vez', devolucao: true, arquivo_path: dev2.path }, GIOVANNA)).status).toBe(409);
  });
});

describe('comissão por quem vendeu', () => {
  const pagar = async (nome: string, papel: 'venda' | 'socio', valor: number, texto: string, auth = GIOVANNA, extra: Record<string, unknown> = {}) => {
    iaLe(valor);
    const { path: p } = await subir(texto, { auth });
    return post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome, papel, data: '2026-10-02', forma: 'pix', arquivo_path: p, ...extra }, auth);
  };
  const lancarEntrada = async (texto: string, auth = GIOVANNA) => {
    iaLe(1_167_000);
    const { path: p } = await subir(texto, { auth });
    return post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), auth);
  };

  it('sem entrada, 409; a Giovanna paga a Nilce (194.500, custo) e a retirada do Thiago (77.800, retirada); a regra fica congelada', async () => {
    const sem = await pagar('nilce', 'venda', 194_500, 'comissao sem entrada');
    expect(sem.status).toBe(409);
    expect(sem.body.mensagem).toBe('A comissão libera depois que a entrada entrar.');
    expect((await lancarEntrada('a entrada')).status).toBe(200);
    expect(h.priv.has(`vendasolar/${SOLAR}.obra.json`)).toBe(false);

    const a = await pagar('nilce', 'venda', 194_500, 'comissao da nilce');
    expect(a.status).toBe(200);
    expect(a.body.lancamento).toMatchObject({ categoria: 'comissao_venda', grupo: 'custo', valor_centavos: 194_500, etapa: 2, descricao: 'Comissão de venda, Nilce (5%)' });
    expect(a.body.livro).toMatchObject({ gasto: 194_500, retirada: 0 });
    const t = await pagar('thiago', 'socio', 77_800, 'retirada do thiago');
    expect(t.status).toBe(200);
    expect(t.body.lancamento).toMatchObject({ categoria: 'retirada_socio', grupo: 'retirada', valor_centavos: 77_800, descricao: 'Thiago, sócio 2%' });
    expect(t.body.livro).toMatchObject({ gasto: 194_500, retirada: 77_800, saldo: 1_167_000 - 194_500 - 77_800 });
    const pagoNilce = t.body.livro.comissoes.linhas.find((l: any) => l.nome === 'nilce');
    expect(pagoNilce.pago).not.toBeNull();
    expect(t.body.livro.comissoes.linhas.find((l: any) => l.nome === 'diego').pago).toBeNull();
    expect(t.body.livro.a_pagar.map((p: any) => p.texto)).toEqual(['Comissão de Diego (sócio 2%): R$ 778,00']);
    // A regra ficou congelada no `obra.json` no primeiro pagamento.
    const obra = JSON.parse(h.priv.get(`vendasolar/${SOLAR}.obra.json`)!);
    expect(obra.regra_comissao.linhas).toEqual([{ nome: 'nilce', papel: 'venda', pb: 500 }, { nome: 'thiago', papel: 'socio', pb: 200 }, { nome: 'diego', papel: 'socio', pb: 200 }]);
    // A mesma linha duas vezes dá 409.
    const dois = await pagar('nilce', 'venda', 194_500, 'comissao da nilce de novo');
    expect(dois.status).toBe(409);
    expect(dois.body.mensagem).toBe('Esta comissão já foi paga.');
    expect(await pagar('carla', 'venda', 100, 'linha que nao existe')).toMatchObject({ status: 400 });
  });

  it('a Nilce e o Diego levam 403; o Thiago paga; estornar a comissão volta a pendência dela', async () => {
    await lancarEntrada('a entrada para a comissao');
    expect((await pagar('nilce', 'venda', 194_500, 'a nilce paga a propria comissao', NILCE)).status).toBe(403);
    expect((await pagar('nilce', 'venda', 194_500, 'o diego paga', DIEGO)).status).toBe(403);
    const ok = await pagar('nilce', 'venda', 194_500, 'o thiago paga', THIAGO);
    expect(ok.status).toBe(200);
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: ok.body.lancamento.id, motivo: 'Valor errado' }, NILCE)).status).toBe(403);
    const est = await post(dinheiro(SOLAR, '/estorno'), { id_original: ok.body.lancamento.id, motivo: 'Valor errado' }, GIOVANNA);
    expect(est.status).toBe(200);
    expect(est.body.livro.gasto).toBe(0);
    expect(est.body.livro.a_pagar.map((p: any) => p.texto)).toContain('Comissão de Nilce (venda 5%): R$ 1.945,00');
  });

  it('a regra dos Ajustes vale para a obra sem comissão paga; depois do primeiro pagamento, a mudança não chega', async () => {
    await lancarEntrada('entrada antes da mudanca');
    const antes = await get(dinheiro(SOLAR), GIOVANNA);
    expect(antes.body.livro.comissoes.linhas[0]).toMatchObject({ nome: 'nilce', valor_centavos: 194_500 });
    const muda = JSON.parse(JSON.stringify(AJUSTES_PADRAO.comissoes));
    muda.nilce[0].pb = 400;
    expect((await put('/jornada-solar/ajustes', { comissoes: muda, dinheiro_aberto: true }, THIAGO)).status).toBe(200);
    const meio = await get(dinheiro(SOLAR), GIOVANNA);
    expect(meio.body.livro.comissoes.linhas[0]).toMatchObject({ nome: 'nilce', pb: 400, valor_centavos: 155_600 });
    // Paga o sócio com a regra de 4%: a obra congela a regra DE AGORA...
    expect((await pagar('thiago', 'socio', 77_800, 'retirada que congela')).status).toBe(200);
    muda.nilce[0].pb = 300;
    await put('/jornada-solar/ajustes', { comissoes: muda, dinheiro_aberto: true }, THIAGO);
    const depois = await get(dinheiro(SOLAR), GIOVANNA);
    expect(depois.body.livro.comissoes).toMatchObject({ congelada: true });
    expect(depois.body.livro.comissoes.linhas[0]).toMatchObject({ pb: 400, valor_centavos: 155_600 });
  });
});

describe('a retirada dos sócios só para o ADM e para a Giovanna', () => {
  it('a Nilce e o Diego (não ADM) não recebem a retirada nem o que a deduza; a Giovanna e o Thiago recebem; o saldo da Nilce é recebido menos gasto', async () => {
    iaLe(1_167_000);
    const { path: pe } = await subir('entrada para a retirada', { auth: GIOVANNA });
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(pe), GIOVANNA)).status).toBe(200);
    iaLe(194_500);
    const { path: pn } = await subir('comissao da nilce', { auth: GIOVANNA });
    expect((await post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome: 'nilce', papel: 'venda', data: '2026-10-02', forma: 'pix', arquivo_path: pn }, GIOVANNA)).status).toBe(200);
    iaLe(77_800);
    const { path: pt } = await subir('retirada do thiago', { auth: GIOVANNA });
    expect((await post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome: 'thiago', papel: 'socio', data: '2026-10-02', forma: 'pix', arquivo_path: pt }, GIOVANNA)).status).toBe(200);
    iaLe(25_000);
    expect((await gastar('um frete qualquer', 25_000, { auth: DIEGO })).status).toBe(200);

    for (const auth of [NILCE, DIEGO]) {
      const g = await get(dinheiro(SOLAR), auth);
      expect(g.status).toBe(200);
      const l = g.body.livro;
      expect(l.recebido).toBe(1_167_000);
      expect(l.gasto).toBe(194_500 + 25_000);
      expect(l.saldo).toBe(1_167_000 - 194_500 - 25_000);   // recebido menos gasto, sem a retirada
      expect('retirada' in l).toBe(false);
      expect(l.linhas.map((x: any) => x.categoria).sort()).toEqual(['comissao_venda', 'entrada', 'frete']);
      expect(l.comissoes.linhas.map((x: any) => x.papel)).toEqual(['venda']);
      expect(l.comissoes.linhas[0]).toMatchObject({ nome: 'nilce', valor_centavos: 194_500 });   // a comissão de quem vendeu fica
      expect(l.a_pagar.map((x: any) => x.texto)).toEqual([]);   // a retirada do Diego ainda não paga NÃO aparece
      expect(l.fechamento.faltam.join('|')).not.toMatch(/Diego|Thiago|sócio/);
      expect(g.text).not.toMatch(/retirada|77800|7\.78|778,00|1\.556|155600/i);
      // A resposta de um gasto também sai recortada.
      expect(JSON.stringify(l.por_etapa)).not.toContain('77800');
    }
    for (const auth of [GIOVANNA, THIAGO]) {
      const g = await get(dinheiro(SOLAR), auth);
      const l = g.body.livro;
      expect(l.retirada).toBe(77_800);
      expect(l.saldo).toBe(1_167_000 - 194_500 - 25_000 - 77_800);
      expect(l.linhas.some((x: any) => x.categoria === 'retirada_socio' && x.valor_centavos === 77_800)).toBe(true);
      expect(l.comissoes.linhas.map((x: any) => x.papel).sort()).toEqual(['socio', 'socio', 'venda']);
      expect(l.a_pagar.map((x: any) => x.texto)).toEqual(['Comissão de Diego (sócio 2%): R$ 778,00']);
    }
  });
});

describe('quem lança o quê', () => {
  it('o Diego lança gasto, leva 403 em entrada, e a categoria `comissao_venda` pela rota do lançamento dá 400', async () => {
    expect((await gastar('gasto do diego', 25_000, { auth: DIEGO })).status).toBe(200);
    iaLe(1_167_000);
    const { path: p } = await subir('o diego tenta entrada', { auth: DIEGO });
    const e = await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), DIEGO);
    expect(e.status).toBe(403);
    expect(e.body.mensagem).toBe('Só a Giovanna e o Thiago lançam recebimento.');
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), NILCE)).status).toBe(403);
    iaLe(194_500);
    const { path: p2 } = await subir('comissao pelo caminho errado', { auth: GIOVANNA });
    const c = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p2, { categoria: 'comissao_venda', valor_centavos: 194_500 }), GIOVANNA);
    expect(c.status).toBe(400);
    expect(c.body.mensagem).toBe('Comissão se lança no bloco Comissões da etapa 2.');
    const rs = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p2, { categoria: 'retirada_socio', valor_centavos: 194_500 }), GIOVANNA);
    expect(rs.status).toBe(400);
    expect(fins()).toHaveLength(1);
  });

  it('a Giovanna e o Thiago lançam recebimento; categoria fora da lista do tipo dá 400', async () => {
    iaLe(1_167_000);
    const { path: p } = await subir('entrada da giovanna', { auth: GIOVANNA });
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), GIOVANNA)).status).toBe(200);
    iaLe(1_167_000);
    const { path: p2 } = await subir('entrada do thiago', { auth: THIAGO });
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p2, { categoria: 'frete' }), THIAGO)).status).toBe(400);
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p2, { id: 'ab' }), THIAGO)).status).toBe(400);
  });
});

describe('conta fechada', () => {
  it('com `fechada` no `jornada_obra`, lançamento, comissão e estorno dão 409', async () => {
    const a = await gastar('antes de fechar');
    expect(a.status).toBe(200);
    iaLe(1_167_000);
    const { path: p } = await subir('entrada com a conta aberta', { auth: GIOVANNA });
    const e = await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), GIOVANNA);
    expect(e.status).toBe(200);
    fechar(SOLAR);
    iaLe(25_000);
    const novo = await subir('depois de fechar');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(novo.path));
    expect(l.status).toBe(409);
    expect(l.body.mensagem).toBe('A conta desta obra está fechada. Só o Thiago reabre.');
    const c = await post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome: 'nilce', papel: 'venda', data: '2026-10-02', forma: 'pix', arquivo_path: novo.path }, GIOVANNA);
    expect(c.status).toBe(409);
    const est = await post(dinheiro(SOLAR, '/estorno'), { id_original: a.body.lancamento.id, motivo: 'Depois de fechada' }, THIAGO);
    expect(est.status).toBe(409);
    expect(fins()).toHaveLength(2);
    const g = await get(dinheiro(SOLAR), THIAGO);
    expect(g.body.pode).toMatchObject({ fechada: true, lancar_saida: false, lancar_entrada: false, comissao: false, estornar_ids: [] });
  });

  it('obra cancelada só aceita estorno', async () => {
    const a = await gastar('antes de cancelar');
    const e = estadoMaterializado(SOLAR, 'Nilce', 4, AGORA);
    const nn = normalizarJornada(SOLAR, { ...e, origem: 'vendido', vendido_em: AGORA, vendido_por: 'nilce', cancelada: { em: AGORA, por: 'thiago', etapa: 4, com_numero: false } })!;
    h.linhas.set(`jornada_solar:${SOLAR}`, { updated_at: 'j1', value: jsonb({ ...nn, sig: assinarJornada(SOLAR, nn) }) });
    iaLe(25_000);
    const novo = await subir('obra cancelada');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(novo.path));
    expect(l.status).toBe(409);
    expect(l.body.mensagem).toBe('Venda cancelada. Só cabe estorno.');
    expect((await post(dinheiro(SOLAR, '/estorno'), { id_original: a.body.lancamento.id, motivo: 'Cancelaram a venda' })).status).toBe(200);
  });
});

describe('a guarda do dono', () => {
  it('a Nilce, em obra de outro consultor, leva 404 em todas as rotas novas; a Giovanna e o Thiago veem', async () => {
    const corpo = { id: novoId('sai'), tipo: 'saida', categoria: 'frete', etapa: 4, valor_centavos: 100, data: '2026-11-04', arquivo_path: `fin/${ALHEIA}/202611/3f2504e0-4f89-41d3-9a0c-0305e82c3301.pdf` };
    expect((await get(dinheiro(ALHEIA))).status).toBe(404);
    expect((await post(dinheiro(ALHEIA, '/comprovante'), { base64: PDF('x').toString('base64'), media_type: 'application/pdf' })).status).toBe(404);
    expect((await post(dinheiro(ALHEIA, '/lancamento'), corpo)).status).toBe(404);
    expect((await post(dinheiro(ALHEIA, '/comissao'), { id: novoId('com'), nome: 'carla', papel: 'venda' })).status).toBe(404);
    expect((await post(dinheiro(ALHEIA, '/estorno'), { id_original: 'lan-00000001', motivo: 'Teste' })).status).toBe(404);
    expect((await put(dinheiro(ALHEIA, '/previsto'), { versao: 0, homologacao: 0, material: 0, frete: 0, mao_de_obra: 0, outros: 0 })).status).toBe(403);
    expect((await get(dinheiro(999999))).status).toBe(404);
    expect(h.bucket.size).toBe(0);
    for (const auth of [GIOVANNA, THIAGO, DIEGO]) expect((await get(dinheiro(ALHEIA), auth)).status).toBe(200);
  });

  it('`dinheiro_aberto: false` esconde o livro da Nilce e mostra para a Giovanna e o Thiago; a Nilce ainda lança gasto, sem receber o livro', async () => {
    ajustes(false);
    const n = await get(dinheiro(SOLAR));
    expect(n.status).toBe(200);
    expect(n.body).toEqual({ ok: true, visivel: false });
    const g = await get(dinheiro(SOLAR), GIOVANNA);
    expect(g.body.visivel).toBe(true);
    expect((await get(dinheiro(SOLAR), THIAGO)).body.visivel).toBe(true);
    const gasto = await gastar('a nilce gasta com o livro fechado');
    expect(gasto.status).toBe(200);
    expect(gasto.body.livro).toBeUndefined();
    expect(JSON.stringify(gasto.body)).not.toMatch(/recebido|saldo|sobra/);
    iaLe(1_167_000);
    const { path: p } = await subir('entrada da nilce');
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p))).status).toBe(403);
    ajustes(true);
    expect((await get(dinheiro(SOLAR))).body.visivel).toBe(true);
  });

  it('a Nilce vê o livro da própria obra, sem a parte do Thiago; o Thiago vê a sobra e a Nilce não', async () => {
    await gastar('um gasto qualquer');
    const n = await get(dinheiro(SOLAR));
    expect(n.body.livro.fechamento.adm).toBeUndefined();
    expect(n.text).not.toMatch(/sobra|"fica"/);
    expect(n.body.pode).toMatchObject({ lancar_saida: true, lancar_entrada: false, comissao: false, previsto: false });
    const t = await get(dinheiro(SOLAR), THIAGO);
    expect(t.body.livro.fechamento.adm).toMatchObject({ sobra: 3_890_000 - 25_000 });
    expect(t.body.pode).toMatchObject({ lancar_entrada: true, comissao: true, previsto: true });
    expect(t.body.categorias.length).toBeGreaterThan(10);
  });
});

describe('o previsto e os Ajustes', () => {
  it('só o ADM grava o previsto, com a versão; versão velha dá 409', async () => {
    const corpo = { versao: 0, homologacao: 70_000, material: 2_130_000, frete: 30_000, mao_de_obra: 165_000, outros: 38_300 };
    expect((await put(dinheiro(SOLAR, '/previsto'), corpo, DIEGO)).status).toBe(403);
    const ok = await put(dinheiro(SOLAR, '/previsto'), corpo, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body.previsto_versao).toBe(1);
    // O previsto total soma os 5 digitados e a comissão de venda calculada pela regra (5% de R$ 38.900,00).
    expect(ok.body.livro.previsto.total.previsto).toBe(70_000 + 2_130_000 + 30_000 + 165_000 + 38_300 + 194_500);
    const velho = await put(dinheiro(SOLAR, '/previsto'), corpo, THIAGO);
    expect(velho.status).toBe(409);
    expect(velho.body.mudou).toBe(true);
    expect((await put(dinheiro(SOLAR, '/previsto'), { ...corpo, versao: 1, frete: -1 }, THIAGO)).status).toBe(400);
    expect((await put(dinheiro(SOLAR, '/previsto'), { ...corpo, versao: 1, frete: 1.5 }, THIAGO)).status).toBe(400);
  });

  it('GET dos Ajustes para qualquer consultor; PUT só do ADM, validado e assinado', async () => {
    const g = await get('/jornada-solar/ajustes');
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ ok: true, valido: true, socios: ['thiago', 'diego'] });
    expect(g.body.ajustes.comissoes.nilce[0]).toEqual({ nome: 'nilce', papel: 'venda', pb: 500 });
    expect((await put('/jornada-solar/ajustes', { comissoes: AJUSTES_PADRAO.comissoes, dinheiro_aberto: true }, NILCE)).status).toBe(403);
    expect((await put('/jornada-solar/ajustes', { comissoes: AJUSTES_PADRAO.comissoes, dinheiro_aberto: true }, DIEGO)).status).toBe(403);
    const ruim = JSON.parse(JSON.stringify(AJUSTES_PADRAO.comissoes));
    ruim.nilce.push({ nome: 'nilce', papel: 'venda', pb: 100 });
    expect((await put('/jornada-solar/ajustes', { comissoes: ruim, dinheiro_aberto: true }, THIAGO)).status).toBe(400);
    expect((await put('/jornada-solar/ajustes', { comissoes: AJUSTES_PADRAO.comissoes }, THIAGO)).status).toBe(400);
    const ok = await put('/jornada-solar/ajustes', { comissoes: AJUSTES_PADRAO.comissoes, dinheiro_aberto: false }, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body.ajustes).toMatchObject({ dinheiro_aberto: false, editado_por: 'thiago' });
    expect(h.linhas.get('jornada_solar_ajustes')!.value.sig).toMatch(/^[0-9a-f]{64}$/);
    // Linha forjada (sem assinatura válida): vale o padrão e o GET avisa.
    const forjada = JSON.parse(JSON.stringify(h.linhas.get('jornada_solar_ajustes')!.value));
    forjada.comissoes.nilce[0].pb = 1;
    h.linhas.set('jornada_solar_ajustes', { value: jsonb(forjada), updated_at: 'f' });
    const f = await get('/jornada-solar/ajustes');
    expect(f.body.valido).toBe(false);
    expect(f.body.ajustes.comissoes.nilce[0].pb).toBe(500);
    expect(f.body.ajustes.dinheiro_aberto).toBe(true);
  });
});

describe('uma linha sem assinatura fica fora da conta e trava o fechamento', () => {
  it('linha forjada no `system_state` não entra no livro e conta em `ignoradas`', async () => {
    const forjada = { id: 'forjada-0001', card_id: SOLAR, tipo: 'entrada', categoria: 'entrada', valor_centavos: 3_890_000, data: '2026-10-01', arquivo: null, apagado: false, obra: { v: 1, etapa: 2, grupo: 'entrada', conferencia: 'bateu' } };
    h.linhas.set(`fin:${SOLAR}:forjada-0001`, { updated_at: 'f', value: jsonb({ ...forjada, sig: 'a'.repeat(64) }) });
    const g = await get(dinheiro(SOLAR), THIAGO);
    expect(g.body.livro.recebido).toBe(0);
    expect(g.body.livro.a_receber).toBe(3_890_000);
    expect(g.body.livro.ignoradas).toBe(1);
    expect(g.body.livro.fechamento.faltam).toContain('1 linha do dinheiro sem assinatura. Fale com o Thiago.');
    expect(g.body.livro.linhas).toEqual([]);
  });
});

describe('o financeiro antigo tem guarda SÓ no card solar da jornada', () => {
  const f = (rota: string, auth = NILCE) => request(app).get(`/gerador/financeiro/${rota}`).set('Authorization', auth);
  const fp = (rota: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador/financeiro/${rota}`).set('Authorization', auth).send(corpo as object);
  const ent = (id: string, valor = 100) => ({ id, tipo: 'entrada', categoria: 'sinal', valor_centavos: valor, data: '2026-10-01' });

  it('a Nilce leva 404 no card solar alheio; no próprio card solar o POST dá 409 `obra_solar` e o bucket não recebe nada', async () => {
    expect((await f(String(ALHEIA))).status).toBe(404);
    expect((await f(String(SOLAR))).status).toBe(200);
    const sobe = await fp(`${SOLAR}/arquivo`, { base64: PDF('antigo').toString('base64'), media_type: 'application/pdf', ler: false });
    expect(sobe.status).toBe(409);
    expect(sobe.body).toMatchObject({ error: 'obra_solar', mensagem: 'O dinheiro da obra solar se lança na própria obra, em Solar, Clientes.' });
    expect(h.bucket.size).toBe(0);
    expect((await fp(`${SOLAR}/lancamento`, ent('ent-00000001'))).status).toBe(409);
    expect((await fp(`${SOLAR}/lancamento/ent-00000001/apagar`, { motivo: 'teste' })).status).toBe(409);
    expect((await fp(`${ALHEIA}/arquivo`, { base64: PDF('antigo').toString('base64'), media_type: 'application/pdf' })).status).toBe(404);
    expect((await fp(`${ALHEIA}/lancamento`, ent('ent-00000001'))).status).toBe(404);
    expect(fins()).toEqual([]);
    expect(fins(ALHEIA)).toEqual([]);
    expect(h.bucket.size).toBe(0);
  });

  it('o eletroposto segue como era: a Giovanna (que não é sócia) lê e lança no card da Nilce, e o card que saiu de `fechou` continua acessível; id sem card também', async () => {
    h.agendamentos.push(cardBase(703, { created_by: 'lp_eletroposto', status: 'agendado' }));
    expect((await f(String(ELETRO), GIOVANNA)).status).toBe(200);
    expect((await f(String(ELETRO_ALHEIO), GIOVANNA)).status).toBe(200);
    expect((await f('703', GIOVANNA)).status).toBe(200);
    expect((await f('999999', GIOVANNA)).status).toBe(200);
    expect((await fp(`${ELETRO}/lancamento`, ent('ent-00000001'), GIOVANNA)).status).toBe(200);
    expect((await fp('703/lancamento', ent('ent-00000002'), GIOVANNA)).status).toBe(200);
    expect((await fp(`${ELETRO}/arquivo`, { base64: PDF('eletroposto').toString('base64'), media_type: 'application/pdf', ler: false }, GIOVANNA)).status).toBe(200);
    expect(fins(ELETRO)).toHaveLength(1);
    expect(fins(703)).toHaveLength(1);
  });

  it('`GET /financeiro/resumo` tira só o card SOLAR alheio; o eletroposto e o id sem card ficam como eram', async () => {
    await fp(`${ELETRO}/lancamento`, ent('ent-00000001', 100_000));
    await fp(`${ELETRO_ALHEIO}/lancamento`, ent('ent-00000002', 200_000), THIAGO);
    const res = await request(app).get(`/gerador/financeiro/resumo?ids=${ELETRO},${ELETRO_ALHEIO},${ALHEIA},999999`).set('Authorization', NILCE);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.resumo).sort()).toEqual([String(ELETRO), String(ELETRO_ALHEIO)]);
    await gastar('um gasto solar na alheia', 25_000, { card: ALHEIA, auth: THIAGO });
    const solar = await request(app).get(`/gerador/financeiro/resumo?ids=${ALHEIA}`).set('Authorization', NILCE);
    expect(solar.body.resumo).toEqual({});
    const socio = await request(app).get(`/gerador/financeiro/resumo?ids=${ALHEIA}`).set('Authorization', THIAGO);
    expect(socio.body.resumo).toEqual({});   // as linhas do solar têm o livro próprio: não entram no resumo antigo
  });

  it('linha com `obra` nunca é editada nem apagada pelo financeiro antigo (409), e o GET livre a filtra; a linha comum do eletroposto segue como era', async () => {
    h.linhas.set(`fin:${ELETRO}:ent-obra-0001`, {
      updated_at: 'e0',
      value: jsonb({ id: 'ent-obra-0001', card_id: ELETRO, tipo: 'entrada', categoria: 'sinal', valor_centavos: 777_001, data: '2026-10-01', apagado: false, obra: { v: 1, etapa: 2, grupo: 'entrada', conferencia: 'bateu' }, sig: 'a'.repeat(64) }),
    });
    await fp(`${ELETRO}/lancamento`, ent('ent-comum-001', 123_457));
    const edit = await fp(`${ELETRO}/lancamento`, { id: 'ent-obra-0001', valor_centavos: 5 }, THIAGO);
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe('linha_da_obra');
    const apaga = await fp(`${ELETRO}/lancamento/ent-obra-0001/apagar`, { motivo: 'limpando a conta' }, THIAGO);
    expect(apaga.status).toBe(409);
    expect(apaga.body.error).toBe('linha_da_obra');
    expect(h.linhas.get(`fin:${ELETRO}:ent-obra-0001`)!.value.valor_centavos).toBe(777_001);
    expect(h.linhas.get(`fin:${ELETRO}:ent-obra-0001`)!.value.apagado).toBe(false);
    const g = await f(String(ELETRO), THIAGO);
    expect(g.body.lancamentos.map((x: any) => x.id)).toEqual(['ent-comum-001']);
    expect(JSON.stringify(g.body)).not.toContain('777001');
    expect(g.body.totais.recebido).toBe(123_457);
    // A linha comum segue editável e apagável.
    expect((await fp(`${ELETRO}/lancamento`, { id: 'ent-comum-001', valor_centavos: 200_000 }, THIAGO)).status).toBe(200);
    expect((await fp(`${ELETRO}/lancamento/ent-comum-001/apagar`, { motivo: 'engano de digitacao' }, THIAGO)).status).toBe(200);
  });

  it('o GET antigo de um card solar não soma o estorno como positivo', async () => {
    const a = await gastar('gasto estornado lido pelo caminho antigo');
    await post(dinheiro(SOLAR, '/estorno'), { id_original: a.body.lancamento.id, motivo: 'Valor errado' });
    const velho = await f(String(SOLAR), THIAGO);
    expect(velho.status).toBe(200);
    expect(velho.body.totais.gasto).toBe(0);
    expect(velho.body.totais.qtd_saidas).toBe(0);
  });
});

describe('correções do revisor (commit 1)', () => {
  it('id reservado: lançar ou pagar comissão com `est-...` dá 400, e o estorno daquela linha continua funcionando', async () => {
    const a = await gastar('gasto a estornar com id reservado');
    const id = a.body.lancamento.id;
    iaLe(25_000);
    const { path: p } = await subir('arquivo do id reservado');
    const reservado = idDoEstorno(id);
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { id: reservado }));
    expect(l.status).toBe(400);
    expect(l.body.error).toBe('id_invalido');
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p, { id: 'EST-00000001' }))).status).toBe(400);
    expect((await post(dinheiro(SOLAR, '/comissao'), { id: reservado, nome: 'nilce', papel: 'venda', data: '2026-10-02', forma: 'pix', arquivo_path: p }, GIOVANNA)).status).toBe(400);
    expect(fins()).toHaveLength(1);
    const est = await post(dinheiro(SOLAR, '/estorno'), { id_original: id, motivo: 'Lancei na obra errada' });
    expect(est.status).toBe(200);
    expect(est.body.lancamento.id).toBe(reservado);
  });

  it('o comprovante da devolução (linha de estorno com arquivo) não serve de gasto em outra obra', async () => {
    iaLe(1_167_000);
    const { path: p } = await subir('entrada que será devolvida', { auth: GIOVANNA });
    const e = await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(p), GIOVANNA);
    const dev = await subir('pdf da devolucao', { auth: GIOVANNA });
    const est = await post(dinheiro(SOLAR, '/estorno'), { id_original: e.body.lancamento.id, motivo: 'Devolvi o Pix', devolucao: true, arquivo_path: dev.path }, GIOVANNA);
    expect(est.status).toBe(200);
    // O mesmo PDF como gasto em OUTRA obra: recusado.
    iaLe(1_167_000);
    const outra = await subir('pdf da devolucao', { card: ALHEIA, auth: THIAGO });
    const l = await post(dinheiro(ALHEIA, '/lancamento'), corpoGasto(outra.path, { valor_centavos: 1_167_000 }), THIAGO);
    expect(l.status).toBe(409);
    expect(l.body.error).toBe('comprovante_repetido');
    // E a original estornada continua liberando o próprio arquivo.
    iaLe(1_167_000);
    const velho = await subir('entrada que será devolvida', { card: ALHEIA, auth: THIAGO });
    expect((await post(dinheiro(ALHEIA, '/lancamento'), corpoGasto(velho.path, { valor_centavos: 1_167_000 }), THIAGO)).status).toBe(200);
  });

  it('a IA não pode ser pulada: o `ler:false` de quem não é ADM é ignorado; só o ADM pula; IA fora salva "não conferido"', async () => {
    iaLe(25_000);
    const nilce = await subir('a nilce tenta pular a ia', { ler: false });
    expect(nilce.res.body.leitura).toBe('ok');
    expect(h.iaChamadas).toBe(1);
    const diego = await subir('o diego tambem tenta', { ler: false, auth: DIEGO });
    expect(diego.res.body.leitura).toBe('ok');
    expect(h.iaChamadas).toBe(2);
    // Valor diferente do lido continua exigindo o ADM, mesmo com o `ler:false` no corpo.
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(nilce.path, { valor_centavos: 99_000, ler: false }));
    expect(l.status).toBe(409);
    expect(l.body.error).toBe('valor_diferente');
    // O ADM pode pular: a leitura fica `pulada` e o lançamento salva "não conferido".
    const thiago = await subir('o thiago pula a ia', { ler: false, auth: THIAGO });
    expect(thiago.res.body.leitura).toBe('pulada');
    expect(h.iaChamadas).toBe(2);
    const g = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(thiago.path), THIAGO);
    expect(g.status).toBe(200);
    expect(g.body.lancamento.conferencia).toBe('sem_leitura');
    // Nota fiscal: também sempre lida.
    h.nota = () => ({ ok: true, eh_documento: true, nota: { tipo: 'nota_fiscal', emitente: 'Elétrica Central', cnpj: '', numero: '1', data: '2026-10-16', chave: null, valor_total_centavos: 89_000, itens: [], confianca: 'alta' } });
    const nota = await subir('uma nota lida', { doc: 'nota', ler: false });
    expect(nota.res.body.leitura).toBe('ok');
    expect(nota.res.body.nota).toMatchObject({ emitente: 'Elétrica Central', valor_total_centavos: 89_000 });
  });

  it('o fechamento trava com linha "não conferida" até o ADM marcar; a marca reassina e não apaga nada', async () => {
    h.ia = () => ({ ok: false, motivo: 'falhou' });
    const { path: p } = await subir('sem leitura da ia');
    const l = await post(dinheiro(SOLAR, '/lancamento'), corpoGasto(p));
    expect(l.status).toBe(200);
    expect(l.body.lancamento.conferencia).toBe('sem_leitura');
    const antes = await get(dinheiro(SOLAR), THIAGO);
    expect(antes.body.livro.fechamento.faltam).toContain('1 lançamento não conferido pela IA. O Thiago confere.');
    expect(antes.body.livro.fechamento.pode_fechar_sem_material).toBe(false);
    // Quem não é ADM não marca.
    expect((await post(dinheiro(SOLAR, '/conferir'), { id: l.body.lancamento.id }, DIEGO)).status).toBe(403);
    expect((await post(dinheiro(SOLAR, '/conferir'), { id: l.body.lancamento.id }, GIOVANNA)).status).toBe(403);
    const ok = await post(dinheiro(SOLAR, '/conferir'), { id: l.body.lancamento.id }, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body.lancamento.conferencia).toBe('conferido_adm');
    expect(ok.body.livro.fechamento.faltam.join('|')).not.toContain('não conferido');
    expect(ok.body.livro.linhas).toHaveLength(1);
    expect(ok.body.livro.gasto).toBe(25_000);
    expect(gravado()[0].sig).toMatch(/^[0-9a-f]{64}$/);
    // A linha registra quem marcou, quando e de quê para quê.
    expect(gravado()[0].alteracoes).toEqual([{ em: AGORA, por: 'thiago', de: 'sem_leitura', para: 'conferido_adm' }]);
    // A segunda marca não tem o que conferir; linha de valor conferido pela IA também não.
    expect((await post(dinheiro(SOLAR, '/conferir'), { id: l.body.lancamento.id }, THIAGO)).status).toBe(409);
    expect((await post(dinheiro(SOLAR, '/conferir'), { id: 'nao-existe-000' }, THIAGO)).status).toBe(404);
    fechar(SOLAR);
    const a = await gastar('linha depois de fechar', 25_000);
    expect(a.status).toBe(409);
  });

  it('venda corrigida de 50.000 para 60.000 deixa R$ 500,00 a pagar para a Nilce; paga a diferença e zera; corrigida para baixo vira "a devolver"', async () => {
    venda(SOLAR, 5_000_000);
    iaLe(500_000);
    const { path: pe } = await subir('entrada de dez por cento', { auth: GIOVANNA });
    expect((await post(dinheiro(SOLAR, '/lancamento'), corpoEntrada(pe, { valor_centavos: 500_000 }), GIOVANNA)).status).toBe(200);
    iaLe(250_000);
    const { path: pc } = await subir('comissao da nilce 5000', { auth: GIOVANNA });
    const c = await post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome: 'nilce', papel: 'venda', data: '2026-10-02', forma: 'pix', arquivo_path: pc }, GIOVANNA);
    expect(c.status).toBe(200);
    expect(c.body.lancamento.valor_centavos).toBe(250_000);
    expect(c.body.livro.a_pagar.map((x: any) => x.texto)).not.toContain('Comissão de Nilce (venda 5%): faltam R$ 500,00');
    // A venda foi corrigida para R$ 60.000,00.
    venda(SOLAR, 6_000_000);
    const g = await get(dinheiro(SOLAR), THIAGO);
    const nilce = g.body.livro.comissoes.linhas.find((x: any) => x.nome === 'nilce');
    expect(nilce).toMatchObject({ valor_centavos: 300_000, pago_centavos: 250_000, diferenca_centavos: 50_000 });
    expect(g.body.livro.a_pagar.find((x: any) => x.texto.startsWith('Comissão de Nilce'))).toMatchObject({ texto: 'Comissão de Nilce (venda 5%): faltam R$ 500,00', valor_centavos: 50_000 });
    expect(g.body.livro.fechamento.pode_fechar_sem_material).toBe(false);
    // Paga só a diferença.
    iaLe(50_000);
    const { path: pd } = await subir('diferenca da comissao da nilce', { auth: GIOVANNA });
    const d = await post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome: 'nilce', papel: 'venda', data: '2026-10-03', forma: 'pix', arquivo_path: pd }, GIOVANNA);
    expect(d.status).toBe(200);
    expect(d.body.lancamento.valor_centavos).toBe(50_000);
    expect(d.body.livro.comissoes.linhas.find((x: any) => x.nome === 'nilce')).toMatchObject({ pago_centavos: 300_000, diferenca_centavos: 0 });
    expect(d.body.livro.a_pagar.map((x: any) => x.texto).join('|')).not.toContain('Comissão de Nilce');
    // Pago por completo: nova tentativa dá 409.
    iaLe(50_000);
    const { path: pf } = await subir('mais uma tentativa', { auth: GIOVANNA });
    expect((await post(dinheiro(SOLAR, '/comissao'), { id: novoId('com'), nome: 'nilce', papel: 'venda', data: '2026-10-03', forma: 'pix', arquivo_path: pf }, GIOVANNA)).status).toBe(409);
    // A venda cai para R$ 40.000,00: o pago passa da devida e aparece como "a devolver".
    venda(SOLAR, 4_000_000);
    const b = await get(dinheiro(SOLAR), THIAGO);
    const dev = b.body.livro.a_pagar.find((x: any) => x.texto.startsWith('Comissão de Nilce'));
    expect(dev).toMatchObject({ texto: 'Comissão de Nilce (venda 5%): a devolver R$ 1.000,00', valor_centavos: 100_000, devolver: true });
    expect(b.body.livro.fechamento.a_pagar_total).not.toBe(100_000);
    expect(b.body.livro.fechamento.pode_fechar_sem_material).toBe(false);
  });
});

describe('estrutura', () => {
  it('zero `supabase.from(\'agendamentos\')` e zero `supabase.from(\'propostas\')` nos arquivos novos (só `supabaseGerador`)', () => {
    const raiz = path.resolve(__dirname, '..');
    const arquivos = [
      'services/gerador/jornadaDinheiro.ts', 'services/gerador/jornadaDinheiroBanco.ts', 'services/gerador/jornadaObra.ts', 'services/gerador/jornadaObraBanco.ts',
      'routes/geradorJornadaGuarda.ts', 'routes/geradorJornadaDinheiro.ts',
    ];
    for (const a of arquivos) {
      const src = fs.readFileSync(path.join(raiz, a), 'utf8');
      expect(src, a).not.toMatch(/(?<![A-Za-z])supabase\.from\(\s*['"`](agendamentos|propostas)['"`]/);
    }
  });
  it('nenhum arquivo novo chama WhatsApp, Instagram, e-mail nem Z-API', () => {
    const raiz = path.resolve(__dirname, '..');
    for (const a of ['services/gerador/jornadaDinheiro.ts', 'services/gerador/jornadaDinheiroBanco.ts', 'services/gerador/jornadaObraBanco.ts', 'routes/geradorJornadaGuarda.ts', 'routes/geradorJornadaDinheiro.ts']) {
      const src = fs.readFileSync(path.join(raiz, a), 'utf8');
      const imports = src.split(String.fromCharCode(10)).filter((l) => /^\s*(import|const .*require\()/.test(l) || /from\s+'/.test(l)).join(String.fromCharCode(10));
      expect(imports, a).not.toMatch(/z-?api|whatsapp|instagram|mailer|resend|nodemailer|email|mensag/i);
      expect(src, a).not.toMatch(/fetch\(|sendMail|enviarMensagem|enviarWhatsapp/);
    }
  });
});
