import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

// A Jornada da obra, fase 1 (05/11/2026): Vendido, lista, obra, venda, proposta, etapas, esperando, cancelar, papéis, número na assinatura,
// Trello sem número e a forja do estado. Login, bancos, Storage, alocador e Trello simulados; nada sai para a rede. Dados inventados.
// O `system_state` simulado REORDENA as chaves de todo objeto no INSERT e no UPDATE (por tamanho e depois alfabética, como o jsonb),
// para a assinatura ser provada como em produção.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  agendamentos: [] as Array<Record<string, any>>,
  propostas: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: any; updated_at: string }>(),
  priv: new Map<string, string>(),
  cad: {} as Record<string, string>,
  obrasPlanilha: [] as any[],
  planilhaCai: false,
  aloc: { chamadas: [] as any[], resultado: { ok: true, acao: 'criou', codigo: '#0070' } as any },
  tique: 0,
  fetchs: 0,
}));

const jsonb = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : 1)).map(([k, x]) => [k, jsonb(x)]));
  }
  return v;
};

/** Um construtor de consulta genérico sobre um array de linhas (filtros, update, select, range). */
function tabela(nome: string, fonte: () => Array<Record<string, any>>) {
  void nome;
  const q: { op: string; filtros: Array<(r: any) => boolean>; upd: any; ret: boolean; rng: [number, number] | null } = { op: 'select', filtros: [], upd: null, ret: false, rng: null };
  const exec = (unico: boolean) => {
    let rows = fonte().filter((r) => q.filtros.every((f) => f(r)));
    if (q.op === 'update') {
      for (const r of rows) Object.assign(r, q.upd);
      return { data: q.ret ? rows.map((r) => ({ ...r })) : null, error: null };
    }
    if (q.rng) rows = rows.slice(q.rng[0], q.rng[1] + 1);
    return { data: unico ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r })), error: null };
  };
  const b: any = {
    select: () => { if (q.op === 'update') q.ret = true; return b; },
    update: (v: any) => { q.op = 'update'; q.upd = v; return b; },
    eq: (c: string, v: any) => { q.filtros.push((r) => r[c] === v); return b; },
    gte: (c: string, v: any) => { q.filtros.push((r) => String(r[c] ?? '') >= v); return b; },
    in: (c: string, vs: any[]) => { q.filtros.push((r) => vs.includes(r[c])); return b; },
    order: () => b,
    range: (a: number, z: number) => { q.rng = [a, z]; return b; },
    maybeSingle: async () => exec(true),
    then: (ok: any, ko: any) => Promise.resolve(exec(false)).then(ok, ko),
  };
  return b;
}

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
    from: (t: string) => tabela(t, () => (t === 'agendamentos' ? h.agendamentos : h.propostas)),
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const stamp = () => `2026-11-05T15:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => {
          const q: { k?: string; pre?: string; in?: string[] } = {};
          const chain: any = {
            eq: (_c: string, k: string) => { q.k = k; return chain; },
            like: (_c: string, p: string) => { q.pre = p.replace(/%$/, ''); return chain; },
            in: (_c: string, ks: string[]) => { q.in = ks; return chain; },
            order: () => chain,
            range: async () => ({ data: [...h.linhas.entries()].filter(([k]) => k.startsWith(q.pre ?? '\u0000')).map(([k, l]) => ({ key: k, value: l.value })), error: null }),
            maybeSingle: async () => { const l = h.linhas.get(q.k as string); return { data: l ? { key: q.k, value: l.value, updated_at: l.updated_at } : null, error: null }; },
            then: (ok: any, ko: any) => Promise.resolve({ data: (q.in ?? []).filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null }).then(ok, ko),
          };
          return chain;
        },
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505' } };
          h.linhas.set(l.key, { value: jsonb(l.value), updated_at: stamp() });
          return { error: null };
        },
        upsert: async (l: { key: string; value: unknown }) => { h.linhas.set(l.key, { value: jsonb(l.value), updated_at: stamp() }); return { error: null }; },
        update: (v: { value: unknown }) => {
          const f: { k?: string; ua?: string | null } = {};
          const chain: any = {
            eq: (c: string, x: string) => { if (c === 'key') f.k = x; else f.ua = x; return chain; },
            is: (_c: string, _x: null) => { f.ua = ''; return chain; },
            select: async () => {
              const l = h.linhas.get(f.k as string);
              if (!l || (f.ua !== undefined && f.ua !== '' && l.updated_at !== f.ua)) return { data: [], error: null };
              h.linhas.set(f.k as string, { value: jsonb(v.value), updated_at: stamp() });
              return { data: [{ key: f.k }], error: null };
            },
          };
          return chain;
        },
        delete: () => ({ eq: () => ({ then: (ok: any) => Promise.resolve({ error: null }).then(ok) }) }),
      };
    },
  },
}));
vi.mock('../services/gerador/cadastroVendaBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVendaBanco')>()),
  lerJsonBruto: async (c: string) => (h.priv.has(c) ? JSON.parse(h.priv.get(c) as string) : null),
  gravarJsonBruto: async (c: string, v: unknown) => { h.priv.set(c, JSON.stringify(v)); },
  comTrava: async (_id: unknown, _por: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../services/gerador/cadastroVenda', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVenda')>()),
  lerCadastroVisto: async () => ({
    v: 1, alteracoes: [], em: null,
    campos: Object.fromEntries(Object.entries(h.cad).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-11-01T10:00:00.000Z', fonte: 'manual' }])),
  }),
}));
vi.mock('../routes/geradorClientesDocs', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorClientesDocs')>()),
  dossieDaVendaSolar: async () => null,
}));
vi.mock('../routes/geradorSolar', async (orig) => ({
  ...(await orig<typeof import('../routes/geradorSolar')>()),
  planilha: async () => { if (h.planilhaCai) throw new Error('fora'); return { dados: { obras: h.obrasPlanilha, ts: Date.now() }, atual: true }; },
  comSobrescritas: async (o: any[]) => o,
}));
vi.mock('../services/gerador/vendaSolarCodigo', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/vendaSolarCodigo')>()),
  alocarCodigoSolar: vi.fn(async (p: any) => {
    h.aloc.chamadas.push({ novo: p.novo, card: p.card.id });
    const r = h.aloc.resultado;
    if (r.ok) {
      const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
      const l = { proposta: null, venda: r.codigo, por: 'gerador', em: '2026-11-05T15:00:00.000Z' };
      h.linhas.set(`venda_solar:${p.card.id}`, { updated_at: 'v', value: { ...l, sig: assinarLigacao(p.card.id, l) } });
    }
    return r;
  }),
}));
vi.mock('../services/gerador/docsClienteBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/docsClienteBanco')>()),
  garantirBucketDocs: async () => undefined,
  sondarObjeto: async () => ({ existe: true, bytes: 100, mime: 'application/pdf' }),
  lerPrimeirosBytes: async () => new Uint8Array(Buffer.from('%PDF-1.4\n')),
  assinarVarios: async () => new Map(),
  removerObjeto: async () => undefined,
}));

import { mountVendaSolar } from '../routes/geradorVendaSolar';
import { mountClientesDocs } from '../routes/geradorClientesDocs';
import { mountJornadaSolar } from '../routes/geradorJornadaSolar';
import { alocarCodigoSolar } from '../services/gerador/vendaSolarCodigo';
import { assinarJornada, normalizarJornada, reiniciarLogsDaJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { invalidarCachesHub, reiniciarLogsDoHub } from '../services/gerador/vendaSolarHub';
import { formaDoEspelho } from '../services/gerador/jornadaFicha';

const r = Router();
mountVendaSolar(r);
mountClientesDocs(r);
mountJornadaSolar(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';
const CARLA = 'Bearer tk-carla';
const AGORA = '2026-11-05T15:00:00.000Z';
const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);
const post = (url: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const put = (url: string, corpo: unknown, auth = NILCE) => request(app).put(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const patch = (url: string, corpo: unknown, auth = NILCE) => request(app).patch(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const obra = (id: number, auth = NILCE) => get(`/jornada-solar/obra/${id}`, auth);

const cardBase = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Cliente Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', quando: null, historico: '', ...o,
});
const U = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const anexos = (id: number, slots: string[]): void => {
  h.linhas.set(`docs_cliente:vendasolar:${id}`, {
    updated_at: 'd',
    value: { arquivos: slots.map((s, i) => ({ id: `a${i}`, slot: s, caminho: `vendasolar/${id}/${U(i + 1)}.pdf`, mime: 'application/pdf', bytes: 10, em: AGORA, por: 'x' })), alteracoes: [], apagados: [] },
  });
};
/** Semeia um estado assinado (e reordenado como o jsonb). */
const semear = (id: number, mut: (e: EstadoJornada) => void = () => undefined): EstadoJornada => {
  const e = { ...estadoMaterializado(id, 'Nilce', 1, AGORA), origem: 'vendido' as const, vendido_em: AGORA, vendido_por: 'nilce' };
  mut(e);
  const n = normalizarJornada(id, e)!;
  h.linhas.set(`jornada_solar:${id}`, { updated_at: 'j0', value: jsonb({ ...n, sig: assinarJornada(id, n) }) });
  return n;
};
const estadoGravado = (id: number): EstadoJornada | null => {
  const l = h.linhas.get(`jornada_solar:${id}`);
  return l ? normalizarJornada(id, l.value) : null;
};
const concluida1 = (e: EstadoJornada): void => { e.etapas[1].concluida_em = AGORA; e.etapas[1].concluida_por = 'nilce'; e.etapas[2].aberta_em = AGORA; };
const obraPlanilha = (o: Record<string, unknown>) => ({
  codigo: '#0066', cliente: 'Joana Lima', homologacao: '', consultor: 'Thiago', origem: '', valorVenda: 0, recebidoReal: 0, recebimento: '', liberadoTxt: '', depoimentoTxt: '',
  telefone: '', endereco: '', cidade: 'Araguari', uf: 'MG', entregaMaterial: '', previsaoMontagem: '', inicioInstalacao: '', fimInstalacao: '', qtdPlaca: '', modeloPlaca: '',
  statusPlaca: '', qtdInv: '', modeloInversor: '', statusInversor: '', tipoEstrutura: '', statusEstrutura: '', cadastroTrello: '', parecerAcesso: '', pedidoVistoria: '',
  liberacaoVistoria: '', engenheiro: '', concessionaria: '', equipe: '', ...o,
});
const PAGAMENTO = { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 1167000, obs: 'Entrada de 30%' }, { forma: 'financiamento', valor_centavos: 2723000, obs: 'BV' }], prazo_prometido: 'até 60 dias', kit_confirmado: true };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AGORA));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app',
    'tk-diego': 'diego@irmaosnaobra.app', 'tk-carla': 'carla@irmaosnaobra.app',
  };
  h.agendamentos = [
    cardBase(301, { status: 'agendado' }), cardBase(302, { status: 'agendado', created_by: 'lp_eletroposto' }), cardBase(303, { vendedor_nome: 'Carla' }),
    cardBase(304), cardBase(305, { cliente_nome: 'Maria Souza', created_at: '2026-10-20T10:00:00.000Z' }),
  ];
  h.propostas = [
    { codigo: 'P1', cliente_nome: 'Cliente Inventado', cliente_cidade: 'Uberlândia', consultor_nome: 'Nilce', kwp: 8.25, created_at: '2026-10-25T10:00:00.000Z', tipo: 'solar', vendido: false, tel: '34999990001', tel2: null, qtd_placas: 14, inversor: 'Growatt 10K', qtd_inversor: 1, dados: { tab: { mod: 'Canadian CS7N', pot: 590 } } },
    { codigo: 'P2', cliente_nome: 'Cliente Inventado', cliente_cidade: 'Uberlândia', consultor_nome: 'Carla', kwp: 5, created_at: '2026-10-25T10:00:00.000Z', tipo: 'solar', vendido: false, tel: '34999990001', tel2: null, dados: {} },
  ];
  h.linhas = new Map(); h.priv = new Map(); h.cad = {}; h.obrasPlanilha = []; h.planilhaCai = false; h.tique = 0; h.fetchs = 0;
  h.aloc.chamadas = []; h.aloc.resultado = { ok: true, acao: 'criou', codigo: '#0070' };
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  process.env.TRELLO_KEY = 'chave-trello-falsa'; process.env.TRELLO_TOKEN = 'token-trello-falso';
  delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS;
  invalidarCachesHub(); reiniciarLogsDoHub(); reiniciarLogsDaJornada();
  vi.mocked(alocarCodigoSolar).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { h.fetchs++; throw new Error('rede indisponível no teste'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Vendido pelo servidor', () => {
  it('grava status e histórico, abre a etapa 1 assinada, é idempotente e NUNCA chama o alocador', async () => {
    const linha = '[05/11 12h00 · Nilce] 🏷️ Status: AGENDADO → VENDIDO.';
    const a = await post('/vendas-solares/301/vendido', { linha });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, status: 'fechou', jornada: true });
    expect(h.agendamentos.find((c) => c.id === 301)).toMatchObject({ status: 'fechou' });
    expect(h.agendamentos.find((c) => c.id === 301)!.historico.startsWith(linha)).toBe(true);
    const e = estadoGravado(301)!;
    expect(e).toMatchObject({ origem: 'vendido', vendedor: 'nilce' });
    expect(e.etapas[1].aberta_em).not.toBeNull();
    expect(h.linhas.get('jornada_solar:301')!.value.sig).toMatch(/^[0-9a-f]{64}$/);
    const b = await post('/vendas-solares/301/vendido', { linha });
    expect(b.body).toEqual({ ok: true, ja_vendido: true, status: 'fechou' });
    expect(vi.mocked(alocarCodigoSolar)).not.toHaveBeenCalled();
    expect([...h.linhas.keys()].some((k) => k.startsWith('venda_solar:'))).toBe(false);
  });
  it('sem a linha o servidor monta a sua; eletroposto dá 409; card de outro consultor dá 404; linha torta dá 400', async () => {
    const a = await post('/vendas-solares/301/vendido', {});
    expect(a.body.historico).toMatch(/^\[05\/11 12h00 · Nilce\] 🏷️ Status: AGENDADO → VENDIDO\.$/);
    expect((await post('/vendas-solares/302/vendido', {}, THIAGO)).status).toBe(409);
    h.agendamentos.push(cardBase(306, { status: 'agendado', vendedor_nome: 'Carla' }));
    expect((await post('/vendas-solares/306/vendido', {})).status).toBe(404);
    expect((await post('/vendas-solares/999/vendido', {})).status).toBe(404);
    h.agendamentos.push(cardBase(307, { status: 'agendado' }));
    expect((await post('/vendas-solares/307/vendido', { linha: 'sem colchete' })).status).toBe(400);
  });
});

describe('lista', () => {
  it('a Nilce vê só as dela; a Giovanna vê todas; ordem por vendida_em decrescente; sem telefone; * sem número', async () => {
    semear(304); semear(305, (e) => { e.vendido_em = '2026-10-20T10:00:00.000Z'; });
    const n = await get('/jornada-solar/lista');
    expect(n.status).toBe(200);
    expect(n.body.linhas.map((l: any) => l.card)).toEqual([304, 305]);   // 304: vendido_em 05/11; 305: card de 20/10
    expect(n.body.linhas[0]).toMatchObject({ codigo: null, trilho: 'jornada', etapa: { n: 1 }, grupo: 'ativas' });
    expect(JSON.stringify(n.body)).not.toMatch(/telefone|99999/);
    const g = await get('/jornada-solar/lista', GIOVANNA);
    expect(g.body.linhas.map((l: any) => l.card).sort()).toEqual([303, 304, 305]);
    expect(g.body.eu.vePorConsultor).toBe(true);
    expect(n.body.eu.vePorConsultor).toBe(false);
  });
  it('deduzida, sem trilho, planilha sem card, cancelada com motivo, minha fila e dinheiro/número pendente só para o Thiago', async () => {
    semear(304, (e) => { e.cancelada = { em: AGORA, por: 'thiago', etapa: 1, com_numero: false }; });
    h.priv.set('vendasolar/304.jornada.json', JSON.stringify({ v: 1, venda: null, cancelamento: { motivo: 'Cliente desistiu', em: AGORA, por: 'thiago' }, descancelamentos: [] }));
    h.linhas.set('venda_solar:305', { updated_at: 'v', value: { proposta: null, venda: '#0063', por: 'nilce', em: AGORA, sig: '' } });
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: null, venda: '#0063', por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:305', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(305, lig) } });
    h.obrasPlanilha = [obraPlanilha({}), obraPlanilha({ codigo: '#0070', cliente: 'Outra' })];
    const t = await get('/jornada-solar/lista', THIAGO);
    const por = (c: number) => t.body.linhas.find((l: any) => l.card === c);
    expect(por(304)).toMatchObject({ grupo: 'canceladas', cancelada: { motivo: 'Cliente desistiu', por: 'thiago' } });
    expect(por(305)).toMatchObject({ trilho: 'sem_trilho', etapa: null, minha: false, codigo: '#0063' });
    expect(t.body.linhas.filter((l: any) => l.trilho === 'planilha').map((l: any) => l.codigo).sort()).toEqual(['#0066', '#0070']);
    expect(t.body.contagem).toMatchObject({ canceladas: 1, atrasadas: 0 });
    expect(por(304).dinheiro).toBe('Antes do contrato');
    const n = await get('/jornada-solar/lista');
    expect(n.body.linhas.every((l: any) => l.dinheiro === null && l.numero_pendente === null)).toBe(true);
  });
  it('minha fila: o dono da etapa vê; deduzida na etapa 4 não entra na fila do Diego; planilha fora do ar não derruba', async () => {
    semear(304, (e) => { concluida1(e); });   // etapa 2: dona Giovanna
    h.planilhaCai = true;
    const g = await get('/jornada-solar/lista', GIOVANNA);
    expect(g.status).toBe(200);
    expect(g.body.fonte.planilha).toBe(false);
    expect(g.body.linhas.find((l: any) => l.card === 304)).toMatchObject({ minha: true, etapa: { n: 2 }, dono: { nome: 'giovanna', iniciais: 'GI' } });
    h.obrasPlanilha = [obraPlanilha({ codigo: '#0071', consultor: 'Nilce' })];
    h.planilhaCai = false;
    const lig = { proposta: null, venda: '#0071', por: 'nilce', em: AGORA };
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    h.linhas.set('venda_solar:305', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(305, lig) } });
    const d = await get('/jornada-solar/lista', DIEGO);
    expect(d.body.linhas.filter((l: any) => l.minha)).toEqual([]);
  });
});

describe('venda e proposta', () => {
  it('soma diferente dá 400; a Nilce grava com a etapa 1 aberta; depois de concluída ela leva 403 e a Giovanna grava (editado só com nomes)', async () => {
    semear(304);
    const ruim = await put('/jornada-solar/obra/304/venda', { ...PAGAMENTO, valor_centavos: 3000000 });
    expect(ruim.status).toBe(400);
    expect(ruim.body.error).toMatch(/As formas somam R\$ 38\.900,00\. O valor vendido é R\$ 30\.000,00\./);
    const ok = await put('/jornada-solar/obra/304/venda', PAGAMENTO);
    expect(ok.status).toBe(200);
    expect(JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).venda).toMatchObject({ valor_centavos: 3890000, combinado_por: 'nilce' });
    // o dinheiro nunca vai para o system_state
    expect(JSON.stringify([...h.linhas.values()])).not.toContain('3890000');
    semear(304, concluida1);
    expect((await put('/jornada-solar/obra/304/venda', PAGAMENTO)).status).toBe(403);
    const g = await put('/jornada-solar/obra/304/venda', { ...PAGAMENTO, prazo_prometido: 'até 45 dias' }, GIOVANNA);
    expect(g.status).toBe(200);
    expect(g.body.venda.editado).toEqual([{ em: AGORA, por: 'giovanna', campos: ['prazo'] }]);
  });
  it('com proposta ligada o servidor espelha vendido e valor_vendido em reais na proposta', async () => {
    semear(304);
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: 'P1', venda: null, por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    expect((await put('/jornada-solar/obra/304/venda', PAGAMENTO)).status).toBe(200);
    expect(h.propostas.find((p) => p.codigo === 'P1')).toMatchObject({ vendido: true, valor_vendido: 38900, forma_pagamento: 'financiamento' });
  });
  it('proposta de outro consultor dá 404; a não vendida passa a vendido e fica ligada; a ligada a outro card dá 409', async () => {
    semear(304); semear(305);
    expect((await post('/jornada-solar/obra/304/proposta', { codigo: 'P2' })).status).toBe(404);
    const ok = await post('/jornada-solar/obra/304/proposta', { codigo: 'P1' });
    expect(ok.status).toBe(200);
    expect(h.propostas.find((p) => p.codigo === 'P1')).toMatchObject({ vendido: true });
    const { lerLigacao } = await import('../services/gerador/vendaSolarHub');
    expect((await lerLigacao(304)).lig.proposta).toBe('P1');
    expect((await post('/jornada-solar/obra/305/proposta', { codigo: 'P1' })).status).toBe(409);
  });
  it('preencher: a venda gravada antes da proposta vai para ela ao ligar (valor em reais e a forma do modal antigo)', async () => {
    semear(304);
    expect((await put('/jornada-solar/obra/304/venda', PAGAMENTO)).status).toBe(200);
    expect(h.propostas.find((p) => p.codigo === 'P1')).toMatchObject({ vendido: false });
    expect(h.propostas.find((p) => p.codigo === 'P1')!.valor_vendido).toBeUndefined();
    const ok = await post('/jornada-solar/obra/304/proposta', { codigo: 'P1' });
    expect(ok.status).toBe(200);
    expect(h.propostas.find((p) => p.codigo === 'P1')).toMatchObject({ vendido: true, valor_vendido: 38900, forma_pagamento: formaDoEspelho(['pix', 'financiamento']) });
    expect(h.propostas.find((p) => p.codigo === 'P1')!.forma_pagamento).toBe('financiamento');
  });
  it('preencher: valor e forma que já estavam na proposta (Histórico) nunca são sobrescritos ao ligar', async () => {
    semear(304);
    h.propostas.find((p) => p.codigo === 'P1')!.valor_vendido = 500;
    h.propostas.find((p) => p.codigo === 'P1')!.forma_pagamento = 'cartao';
    expect((await put('/jornada-solar/obra/304/venda', PAGAMENTO)).status).toBe(200);
    expect((await post('/jornada-solar/obra/304/proposta', { codigo: 'P1' })).status).toBe(200);
    expect(h.propostas.find((p) => p.codigo === 'P1')).toMatchObject({ vendido: true, valor_vendido: 500, forma_pagamento: 'cartao' });
  });
  it('preencher: o arquivo que a Planilha (#NNNN) já tem conta no portão da etapa 1, com a origem; contrato e procuração não contam', async () => {
    semear(304);
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: null, venda: '#0057', por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    h.linhas.set('docs_cliente:solar:0057', {
      updated_at: 'd',
      value: { arquivos: ['fachada', 'contrato_assinado'].map((s, i) => ({ id: `p${i}`, slot: s, caminho: `solar/0057/${U(i + 1)}.pdf`, mime: 'application/pdf', bytes: 10, em: AGORA, por: 'x' })), alteracoes: [], apagados: [] },
    });
    const res = await obra(304);
    expect(res.status).toBe(200);
    const item = (n: number, chave: string) => res.body.etapas[n - 1].itens.find((i: any) => i.chave === chave);
    expect(item(1, 'fachada').feito).toBe(true);
    expect(item(2, 'contrato_assinado').feito).toBe(false);
    expect(res.body.origem_slots).toEqual({ fachada: 'planilha' });
    expect(res.body.slots.contrato_assinado).toBe(false);
    // Com a mesma foto também no card, o card é a origem e nada aparece em `origem_slots`.
    anexos(304, ['fachada']);
    const comCard = await obra(304);
    expect(comCard.body.origem_slots).toEqual({});
    expect(comCard.body.slots.fachada).toBe(true);
  });
  it('preencher: o link do Trello do dossiê da proposta aparece quando a obra não tem URL, com a origem e o mesmo tem_cartao', async () => {
    semear(304);
    h.propostas.find((p) => p.codigo === 'P1')!.dados = { tab: { mod: 'Canadian CS7N', pot: 590 }, dossie: { trello: { card_id: 'abc', card_url: 'https://trello.com/c/abc' } } };
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: 'P1', venda: null, por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    const res = await obra(304);
    expect(res.status).toBe(200);
    expect(res.body.trello).toMatchObject({ url: 'https://trello.com/c/abc', fonte: 'dossie', rotulo: 'dossiê da proposta', tem_cartao: false, criado_em: null, por: null });
  });
});

describe('concluir a etapa', () => {
  it('item faltando dá 409 com a lista; quem não é dono leva 403; Giovanna conclui a 2 e a 3 abre; a etapa 2 sem número tenta o número uma vez', async () => {
    semear(304);
    const falta = await post('/jornada-solar/obra/304/etapa', { etapa: 1 });
    expect(falta.status).toBe(409);
    expect(falta.body).toMatchObject({ precisa: 'itens' });
    expect(falta.body.falta.length).toBeGreaterThan(5);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 1 }, GIOVANNA)).status).toBe(403);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA)).status).toBe(409);   // não é a da vez
    semear(304, concluida1);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA)).status).toBe(409);   // faltam os papéis
    anexos(304, ['contrato_assinado', 'procuracao']);
    const ok = await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ etapa_atual: 3, numero: { ok: true, codigo: '#0070' } });
    expect(h.aloc.chamadas).toEqual([{ novo: true, card: 304 }]);
    expect(estadoGravado(304)!.etapas[3].aberta_em).not.toBeNull();
    expect(estadoGravado(304)!.numero.nasceu_em).not.toBeNull();
  });
});

describe('número só na assinatura', () => {
  it('só o contrato não chama o alocador; com o par o alocador roda UMA vez (novo true na venda nascida no servidor); o Trocar não repete', async () => {
    semear(304, concluida1);
    anexos(304, ['contrato_assinado']);
    expect((await obra(304, GIOVANNA)).body.numero.estado).toBe('falta_papeis');
    expect((await post('/jornada-solar/obra/304/numero', {}, GIOVANNA)).status).toBe(403);
    expect(h.aloc.chamadas).toHaveLength(0);
    anexos(304, ['contrato_assinado', 'procuracao']);
    expect((await obra(304, GIOVANNA)).body.numero.estado).toBe('pronto');
    const a = await post('/jornada-solar/obra/304/numero', {}, GIOVANNA);
    expect(a.body).toEqual({ ok: true, codigo: '#0070' });
    expect(h.aloc.chamadas).toEqual([{ novo: true, card: 304 }]);
    const b = await post('/jornada-solar/obra/304/numero', {}, GIOVANNA);
    expect(b.body.codigo).toBe('#0070');
    expect(h.aloc.chamadas).toHaveLength(1);
    expect((await obra(304, GIOVANNA)).body.numero).toMatchObject({ estado: 'tem', codigo: '#0070' });
  });
  it('venda antiga sem estado chama com novo false; confirmar grava numero.falha e só o ADM vê os candidatos', async () => {
    anexos(305, ['contrato_assinado', 'procuracao']);
    h.aloc.resultado = { ok: false, motivo: 'confirmar', candidatos: [{ codigo: '#0040', cliente: 'Parente', data: '2026-09-01', motivo: 'telefone' }], ocultas: 0 };
    const x = await post('/jornada-solar/obra/305/numero', {}, GIOVANNA);
    expect(x.status).toBe(409);
    expect(x.body).toMatchObject({ precisa: 'confirmar' });
    expect(x.body.candidatos).toBeUndefined();
    expect(h.aloc.chamadas).toEqual([{ novo: false, card: 305 }]);
    expect(estadoGravado(305)).toMatchObject({ origem: 'leitura', numero: { falha: 'confirmar' } });
    const t = await post('/jornada-solar/obra/305/numero', {}, THIAGO);
    expect(t.body.candidatos).toHaveLength(1);
    const o = await obra(305, THIAGO);
    expect(o.body.numero).toMatchObject({ estado: 'confirmar' });
    expect(o.body.pode.numero_novo).toBe(true);
    // novo: true de quem não é ADM dá 403
    expect((await post('/jornada-solar/obra/305/numero', { novo: true }, GIOVANNA)).status).toBe(403);
  });
  it('a cancelada com o par completo nunca chama o alocador', async () => {
    semear(304, (e) => { concluida1(e); e.cancelada = { em: AGORA, por: 'thiago', etapa: 2, com_numero: false }; });
    anexos(304, ['contrato_assinado', 'procuracao']);
    const x = await post('/jornada-solar/obra/304/numero', {}, THIAGO);
    expect(x.status).toBe(403);   // cancelada: ninguém pede o número
    expect(h.aloc.chamadas).toHaveLength(0);
    const c = await post('/vendas-solares/304/cliente', {}, THIAGO);
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ precisa: 'cancelada' });
    expect(h.aloc.chamadas).toHaveLength(0);
  });
  it('o registro do arquivo (POST /docs) dispara o número só quando o par fecha', async () => {
    semear(304, concluida1);
    const reg = async (slot: string, i: number) => post('/clientes/vendasolar/304/docs', { slot, caminho: `vendasolar/304/${U(50 + i)}.pdf` }, GIOVANNA);
    const a = await reg('contrato_assinado', 1);
    expect(a.status).toBe(200);
    expect(a.body.numero).toEqual({ ok: false, motivo: 'assinatura' });
    expect(h.aloc.chamadas).toHaveLength(0);
    const b = await reg('procuracao', 2);
    expect(b.status).toBe(200);
    expect(b.body.numero).toEqual({ ok: true, codigo: '#0070' });
    expect(h.aloc.chamadas).toEqual([{ novo: true, card: 304 }]);
    const outro = await reg('fachada', 4);
    expect(outro.body.numero).toBeUndefined();
  });
});

describe('Trello e /cliente sem número', () => {
  it('a prévia e o envio sem número dão 409 numero e o Trello recebe ZERO chamadas', async () => {
    semear(304);
    const a = await post('/vendas-solares/304/trello', { previa: true });
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ ok: false, precisa: 'numero' });
    expect((await post('/vendas-solares/304/trello', {})).status).toBe(409);
    expect(h.fetchs).toBe(0);
  });
  it('/cliente sem o par: 409 assinatura e o alocador em zero; /vinculos com venda pela Nilce: 403 adm, com proposta passa', async () => {
    const a = await post('/vendas-solares/304/cliente', {});
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ precisa: 'assinatura' });
    expect(h.aloc.chamadas).toHaveLength(0);
    const v = await post('/vendas-solares/304/vinculos', { venda: '#0057' });
    expect(v.status).toBe(403);
    expect(v.body.precisa).toBe('adm');
  });
});

describe('cancelar e esperando', () => {
  it('sem motivo 400; a Nilce cancela antes do número e leva 403 depois; o motivo fica só no JSON privado; descancelar é só do ADM', async () => {
    semear(304);
    expect((await post('/jornada-solar/obra/304/cancelar', {})).status).toBe(400);
    const ok = await post('/jornada-solar/obra/304/cancelar', { motivo: 'Cliente desistiu do projeto' });
    expect(ok.status).toBe(200);
    expect(estadoGravado(304)!.cancelada).toMatchObject({ por: 'nilce', com_numero: false });
    expect(JSON.stringify([...h.linhas.values()])).not.toContain('desistiu');
    expect(JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).cancelamento.motivo).toBe('Cliente desistiu do projeto');
    expect((await post('/jornada-solar/obra/304/descancelar', { motivo: 'Voltou' })).status).toBe(403);
    expect((await post('/jornada-solar/obra/304/descancelar', { motivo: 'Voltou' }, THIAGO)).status).toBe(200);
    expect(estadoGravado(304)!.cancelada).toBeNull();
    // depois do número a Nilce não cancela, o Thiago sim
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: null, venda: '#0070', por: 'gerador', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    expect((await post('/jornada-solar/obra/304/cancelar', { motivo: 'Tentativa' })).status).toBe(403);
    expect((await post('/jornada-solar/obra/304/cancelar', { motivo: 'Cancelada pelo sócio' }, THIAGO)).status).toBe(200);
    expect(estadoGravado(304)!.cancelada).toMatchObject({ com_numero: true });
    expect(h.aloc.chamadas).toHaveLength(0);
  });
  it('esperando: além de 5 dias úteis dá 400; dentro, a situação vira esperando; voltar limpa', async () => {
    semear(304);
    expect((await post('/jornada-solar/obra/304/esperar', { motivo: 'cliente', ate: '2026-11-30' })).status).toBe(400);
    expect((await post('/jornada-solar/obra/304/esperar', { motivo: 'cliente', ate: '2026-11-09' })).status).toBe(200);
    const o = await obra(304);
    expect(o.body.esperando).toMatchObject({ motivo: 'cliente', ate: '2026-11-09' });
    expect(o.body.etapas[0].situacao.tipo).toBe('esperando');
    expect((await post('/jornada-solar/obra/304/esperar', { voltar: true })).status).toBe(200);
    expect((await obra(304)).body.esperando).toBeNull();
    expect((await post('/jornada-solar/obra/304/esperar', { motivo: 'cliente', ate: '2026-11-09' }, DIEGO)).status).toBe(403);
  });
});

describe('papéis da SolarDoc', () => {
  const cadastroOk = () => {
    h.cad = { nome: 'Marcos Andrade', cpf_cnpj: '52998224725', endereco: 'Rua A, 10', bairro: 'Centro', cidade: 'Uberlândia', uf: 'MG', unidade_consumidora: '3012345678', endereco_ponto: 'Rua A, 10' };
    h.priv.set('vendasolar/304.jornada.json', JSON.stringify({ v: 1, venda: { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], desconto_centavos: null, prazo_prometido: 'x', nota: '', kit_confirmado: true, combinado_por: 'nilce', combinado_em: AGORA, editado: [] }, cancelamento: null, descancelamentos: [] }));
  };
  it('o contrato sai em html com AIOROS LTDA e o contratante, sem script, e o emitente é forçado mesmo com empresa.nome no corpo', async () => {
    semear(304, concluida1); cadastroOk();
    const x = await post('/jornada-solar/obra/304/papel', { tipo: 'contrato', empresa: { nome: 'Outra Empresa', cnpj: '00.000.000/0001-00', cidade: 'Uberlândia', engenheiro_nome: 'Eng Teste' } }, GIOVANNA);
    expect(x.status).toBe(200);
    expect(x.body.formato).toBe('html');
    expect(x.body.conteudo).toContain('AIOROS LTDA');
    expect(x.body.conteudo).toContain('Marcos Andrade');
    expect(x.body.conteudo).not.toContain('Outra Empresa');
    expect(x.body.conteudo).not.toMatch(/<script/i);
    expect(estadoGravado(304)!.etapas[2].papeis.contrato).toMatchObject({ por: 'giovanna' });
  });
  it('a procuração com homologacao_mesmo outra_pessoa sai com o tuc_nome; o recibo sai em texto com o pagamento; sem CPF dá 409 cadastro', async () => {
    semear(304, concluida1); cadastroOk();
    h.cad.homologacao_mesmo = 'outra_pessoa'; h.cad.tuc_nome = 'Titular Diferente da Silva'; h.cad.tuc_cpf_cnpj = '11144477735';
    const p = await post('/jornada-solar/obra/304/papel', { tipo: 'procuracao', modelo: 1 }, GIOVANNA);
    expect(p.status).toBe(200);
    expect(p.body.conteudo).toContain('Titular Diferente da Silva');
    const rec = await post('/jornada-solar/obra/304/papel', { tipo: 'recibo', recibo: { numero: '70/2026', pagamentos: [{ forma: 'pix', data: '2026-11-05', valor_centavos: 1167000 }] } }, GIOVANNA);
    expect(rec.status).toBe(200);
    expect(rec.body.formato).toBe('texto');
    expect(rec.body.conteudo).toContain('11.670,00');
    delete h.cad.cpf_cnpj;
    const sem = await post('/jornada-solar/obra/304/papel', { tipo: 'contrato' }, GIOVANNA);
    expect(sem.status).toBe(409);
    expect(sem.body).toMatchObject({ precisa: 'cadastro' });
    expect((await post('/jornada-solar/obra/304/papel', { tipo: 'contrato' }, DIEGO)).status).toBe(403);
  });
});

describe('etapa 3 e a forja', () => {
  it('só o Thiago mexe em protocolo, engenheiro e rateio; o rateio só confere com total 100', async () => {
    semear(304, (e) => { concluida1(e); e.etapas[2].concluida_em = AGORA; e.etapas[3].aberta_em = AGORA; e.etapas[1].excedente = 'sim'; });
    h.cad = { geradora_pct: '80', unidade_consumidora: '1', benef_1_uc: '2', benef_1_pct: '10' };
    expect((await patch('/jornada-solar/obra/304', { engenheiro: 'pago' })).status).toBe(403);
    expect((await patch('/jornada-solar/obra/304', { engenheiro: 'a_pagar', protocolo: { numero: '0923-48117', em: '2026-11-05' } }, THIAGO)).status).toBe(200);
    expect(estadoGravado(304)!.etapas[3]).toMatchObject({ engenheiro: 'a_pagar', protocolo: { numero: '0923-48117', em: '2026-11-05' } });
    const ruim = await patch('/jornada-solar/obra/304', { rateio_conferido: true }, THIAGO);
    expect(ruim.status).toBe(409);
    expect(ruim.body.error).toMatch(/O rateio soma 90%/);
    h.cad.benef_1_pct = '20';
    expect((await patch('/jornada-solar/obra/304', { rateio_conferido: true }, THIAGO)).status).toBe(200);
    expect(estadoGravado(304)!.etapas[3].rateio).toMatchObject({ por: 'thiago' });
  });
  it('linha com assinatura errada vale como ausente e a próxima escrita a sobrescreve pelo compare-and-swap, sem 23505', async () => {
    const e = semear(304);
    const forjada = { ...(h.linhas.get('jornada_solar:304')!.value), sig: 'f'.repeat(64), vendedor: 'carla' };
    h.linhas.set('jornada_solar:304', { updated_at: 'j0', value: forjada });
    const o = await obra(304);
    expect(o.status).toBe(200);
    expect(o.body.trilho).toBe('deduzida');   // o estado forjado não vale
    expect((await patch('/jornada-solar/obra/304', { excedente: 'nao' })).status).toBe(200);
    const novo = estadoGravado(304)!;
    expect(novo.etapas[1].excedente).toBe('nao');
    expect(h.linhas.get('jornada_solar:304')!.value.sig).toBe(assinarJornada(304, novo));
    expect(e.card).toBe(304);
    // a Carla não ganha acesso por um estado que diz vendedor carla
    expect((await obra(304, CARLA)).status).toBe(404);
  });
});

describe('estrutura', () => {
  it('as rotas novas não usam supabase.from("agendamentos") nem supabase.from("propostas") (o banco do Gerador é outro)', () => {
    for (const f of ['geradorJornadaSolar.ts', 'geradorJornadaNumero.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
      expect(src).not.toMatch(/(^|[^A-Za-z])supabase\.from\(\s*['"`](agendamentos|propostas)['"`]/m);
    }
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'geradorJornadaSolar.ts'), 'utf8');
    expect(src).toMatch(/supabaseGerador\.from\('agendamentos'\)/);
  });
});
