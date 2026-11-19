import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { gravarAjustes } from '../services/gerador/jornadaDinheiroBanco';
import { AJUSTES_PADRAO } from '../services/gerador/jornadaDinheiro';

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
  fontes: {} as Record<string, string>,
  /** campo -> item do documento de onde a IA leu (CampoGravado.doc). */
  docs: {} as Record<string, string>,
  lerTudo: { resultado: { acao: 'ok', preenchidos: ['rg_ie'], ignorados: 1 } as any, chamadas: [] as any[] },
  obrasPlanilha: [] as any[],
  planilhaCai: false,
  aloc: { chamadas: [] as any[], resultado: { ok: true, acao: 'criou', codigo: '#0070' } as any },
  tique: 0,
  fetchs: 0,
  disparos: [] as Array<{ card: number; nome: string }>,
  relatorios: [] as Array<{ card: number; nome: string }>,
  relatorioFalha: null as null | 'grande' | 'chromium',
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

// O limite por minuto do ler-tudo (aiLimiter) não é o assunto aqui: o teste faz mais de 10 pedidos seguidos.
vi.mock('../middleware/rateLimiter', async (orig) => ({ ...(await orig<typeof import('../middleware/rateLimiter')>()), aiLimiter: (_q: unknown, _s: unknown, next: () => void) => next() }));
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
    campos: Object.fromEntries(Object.entries(h.cad).map(([k, valor]) => [k, { valor, por: 'nilce', em: '2026-11-01T10:00:00.000Z', fonte: h.fontes[k] ?? 'manual', ...(h.docs[k] ? { doc: h.docs[k] } : {}) }])),
  }),
}));
// "Ler tudo": a leitura em si é provada em vendaSolar.route.test.ts; aqui só a rota, a permissão e as respostas.
vi.mock('../services/gerador/cadastroLeituraAuto', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroLeituraAuto')>()),
  lerTudoDaVenda: async (g: unknown) => { h.lerTudo.chamadas.push(g); return h.lerTudo.resultado; },
}));
// O Trello automático é provado à parte (trelloAutomatico.test.ts): aqui só se confere QUEM o dispara e QUANDO.
vi.mock('../routes/geradorJornadaTrelloAuto', () => ({
  dispararTrelloAutomatico: (card: { id: number }, quem: { nome: string }) => { h.disparos.push({ card: card.id, nome: quem.nome }); },
  tentarTrelloAutomatico: async () => ({ acao: 'nao_pronto', falta: [] }),
  anexarRelatorioManual: async () => 'sem_cartao',
}));
// O PDF do relatório final é provado à parte (vendaSolarTrello.route.test.ts, com o Chromium simulado): aqui só a rota, a permissão e as respostas.
vi.mock('../routes/geradorJornadaRelatorioFinal', () => ({
  gerarRelatorioFinal: async (g: { nome: string; card: { id: number } }) => {
    if (h.relatorioFalha === 'chromium') throw new Error('chromium fora');
    h.relatorios.push({ card: g.card.id, nome: g.nome });
    return h.relatorioFalha === 'grande' ? null : { pdf: Buffer.from('%PDF-1.4'), gerado_em: '2026-09-15T13:00:00.000Z' };
  },
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
/** Os Ajustes do Solar com o "dinheiro aberto" desligado: só o vendedor, a Giovanna e o ADM veem o valor da obra. */
const fecharDinheiro = (): Promise<unknown> => gravarAjustes({ comissoes: AJUSTES_PADRAO.comissoes, dinheiro_aberto: false }, 'thiago');

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
  h.linhas = new Map(); h.priv = new Map(); h.cad = {}; h.obrasPlanilha = []; h.planilhaCai = false; h.tique = 0; h.fetchs = 0; h.disparos = []; h.relatorios = []; h.relatorioFalha = null; h.fontes = {}; h.docs = {}; h.lerTudo = { resultado: { acao: 'ok', preenchidos: ['rg_ie'], ignorados: 1 }, chamadas: [] };
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
  it('preencher: o arquivo que a Planilha (#NNNN) já conta como foto da etapa 1, com a origem; contrato e procuração não contam', async () => {
    semear(304);
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: null, venda: '#0057', por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    h.linhas.set('docs_cliente:solar:0057', {
      updated_at: 'd',
      value: { arquivos: ['fachada', 'contrato_assinado'].map((s, i) => ({ id: `p${i}`, slot: s, caminho: `solar/0057/${U(i + 1)}.pdf`, mime: 'application/pdf', bytes: 10, em: AGORA, por: 'x' })), alteracoes: [], apagados: [] },
    });
    h.obrasPlanilha = [obraPlanilha({ codigo: '#0057', consultor: 'Nilce' })];
    const res = await obra(304);
    expect(res.status).toBe(200);
    const item = (n: number, chave: string) => res.body.etapas[n - 1].itens.find((i: any) => i.chave === chave);
    expect(item(1, 'fachada').feito).toBe(true);   // as fotos e documentos são da etapa 1
    expect(item(2, 'contrato_assinado').feito).toBe(false);
    expect(res.body.origem_slots).toEqual({ fachada: 'planilha' });
    expect(res.body.slots.contrato_assinado).toBe(false);
    // Com a mesma foto também no card, o card é a origem e nada aparece em `origem_slots`.
    anexos(304, ['fachada']);
    const comCard = await obra(304);
    expect(comCard.body.origem_slots).toEqual({});
    expect(comCard.body.slots.fachada).toBe(true);
  });
  it('preencher: quem não vê a linha da planilha (a Giovanna) tem o portão contado, mas não recebe a origem "planilha"; o Thiago recebe', async () => {
    semear(304);
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: null, venda: '#0057', por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    h.linhas.set('docs_cliente:solar:0057', {
      updated_at: 'd',
      value: { arquivos: [{ id: 'p0', slot: 'fachada', caminho: `solar/0057/${U(1)}.pdf`, mime: 'application/pdf', bytes: 10, em: AGORA, por: 'x' }], alteracoes: [], apagados: [] },
    });
    h.obrasPlanilha = [obraPlanilha({ codigo: '#0057', consultor: 'Nilce' })];
    const g = await obra(304, GIOVANNA);
    expect(g.status).toBe(200);
    expect(g.body.slots.fachada).toBe(true);
    expect(g.body.etapas[0].itens.find((i: any) => i.chave === 'fachada').feito).toBe(true);
    expect(g.body.origem_slots).toEqual({});
    expect(JSON.stringify(g.body)).not.toContain('"planilha"');
    const t = await obra(304, THIAGO);
    expect(t.body.origem_slots).toEqual({ fachada: 'planilha' });
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
  it('item faltando dá 409 com a lista; quem não é dono leva 403; Giovanna conclui a 2 (o par assinado e a vistoria 80%) e a 3 abre; a etapa 2 sem número tenta o número uma vez', async () => {
    semear(304);
    const falta = await post('/jornada-solar/obra/304/etapa', { etapa: 1 });
    expect(falta.status).toBe(409);
    expect(falta.body).toMatchObject({ precisa: 'itens' });
    expect(falta.body.falta.length).toBeGreaterThan(5);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 1 }, GIOVANNA)).status).toBe(403);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA)).status).toBe(409);   // não é a da vez
    semear(304, concluida1);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA)).status).toBe(409);   // faltam o contrato e a procuração assinados
    anexos(304, ['contrato_assinado', 'documento_titular', 'conta_luz', 'fachada']);
    const quase = await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA);
    expect(quase.status).toBe(409);
    // o que a etapa 1 (regra antiga) deixou sem arquivo volta como pendência da etapa 1 e segura a conclusão
    expect(quase.body.falta.map((i: any) => i.chave)).toEqual(['procuracao', 'vistoria', 'padrao', 'disjuntor', 'medidor']);
    expect(quase.body.falta.slice(2).map((i: any) => i.texto)).toEqual(['Foto do padrão de entrada (pendente da etapa 1)', 'Foto do disjuntor (pendente da etapa 1)', 'Foto do medidor (pendente da etapa 1)']);
    expect(h.disparos).toEqual([]);
    anexos(304, ['contrato_assinado', 'procuracao']);
    expect((await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA)).body.falta.map((i: any) => i.chave)).toEqual(['vistoria', 'documento', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor']);
    anexos(304, ['contrato_assinado', 'procuracao', 'documento_titular', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor']);
    const semVistoria = await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA);
    expect(semVistoria.status).toBe(409);
    expect(semVistoria.body.falta.map((i: any) => i.chave)).toEqual(['vistoria']);   // o par assinado está lá; falta a vistoria 80%
    expect(h.disparos).toEqual([]);
    const v80 = { data: '2026-11-18', quem: 'Nilce', acomp: 'Marcos', concl: 'ok', obs: 'ok', telhado: { tipo: 'a', estado: 'b', orient: 'c', incl: 'd', area: 'e', sombra: 'f', estr: 'g', acesso: 'h' }, entrada: { padrao: 'a', tensao: 'b', disj: 'c', apto: 'd', aterr: 'e', quadro: 'f' }, inversor: { local: 'a', dist: '', abrig: '', wifi: '' } };
    h.priv.set('vendasolar/304.obra.json', JSON.stringify({ v: 1, vistoria: v80 }));   // 20 de 23 campos = 86%
    const ok = await post('/jornada-solar/obra/304/etapa', { etapa: 2 }, GIOVANNA);
    expect(ok.status).toBe(200);
    expect(h.disparos).toEqual([{ card: 304, nome: 'giovanna' }]);   // o Trello automático foi pedido, depois do número
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

describe('fases 1 a 3 (18/11/2026): permissões e o Trello automático', () => {
  const cadastroBase = () => {
    h.cad = { nome: 'Marcos Andrade', cpf_cnpj: '52998224725', endereco: 'Rua A, 10', bairro: 'Centro', cidade: 'Uberlândia', uf: 'MG', unidade_consumidora: '3012345678', endereco_ponto: 'Rua A, 10' };
    h.priv.set('vendasolar/304.jornada.json', JSON.stringify({ v: 1, venda: { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], desconto_centavos: null, prazo_prometido: 'x', nota: '', kit_confirmado: false, combinado_por: 'nilce', combinado_em: AGORA, editado: [] }, cancelamento: null, descancelamentos: [] }));
  };
  const na3 = (e: EstadoJornada): void => {
    concluida1(e); e.etapas[2].concluida_em = AGORA; e.etapas[2].concluida_por = 'giovanna'; e.etapas[3].aberta_em = AGORA;
  };
  it('gerar_papeis vale com a etapa 1 ABERTA (o vendedor gera o contrato antes de concluir) e continua recusando quem não pode, cancelada e conta fechada', async () => {
    semear(304); cadastroBase();
    const aberta = await obra(304);
    expect(aberta.body.pode.gerar_papeis).toBe(true);
    const x = await post('/jornada-solar/obra/304/papel', { tipo: 'contrato' });
    expect(x.status).toBe(200);
    expect(estadoGravado(304)!.etapas[2].papeis.contrato).toMatchObject({ por: 'nilce' });
    expect(estadoGravado(304)!.etapas[1].concluida_em).toBeNull();
    // o item da etapa 1 enxerga o papel gerado
    const item = (await obra(304)).body.etapas[0].itens.find((i: any) => i.chave === 'papel_contrato');
    expect(item).toMatchObject({ bloco: 'papeis', texto: 'Contrato gerado', feito: true });
    expect((await post('/jornada-solar/obra/304/papel', { tipo: 'contrato' }, DIEGO)).status).toBe(403);
    semear(304, (e) => { e.cancelada = { em: AGORA, por: 'thiago', etapa: 1, com_numero: false }; });
    expect((await obra(304)).body.pode.gerar_papeis).toBe(false);
  });
  it('marcar_excedente: com a etapa 1 aberta, o vendedor, a Giovanna e o ADM; depois de concluída, só a Giovanna e o ADM (o vendedor perde)', async () => {
    semear(304);
    expect((await obra(304)).body.pode.marcar_excedente).toBe(true);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' })).status).toBe(200);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'nao' })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].excedente).toBe('nao');
    expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' }, DIEGO)).status).toBe(403);
    expect((await obra(304, GIOVANNA)).body.pode.marcar_excedente).toBe(true);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' }, GIOVANNA)).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].excedente).toBe('sim');
    semear(304, concluida1);
    expect((await obra(304)).body.pode.marcar_excedente).toBe(false);
    expect((await obra(304, GIOVANNA)).body.pode.marcar_excedente).toBe(true);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'nao' }, GIOVANNA)).status).toBe(200);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' })).status).toBe(403);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' }, DIEGO)).status).toBe(403);
  });
  it('etapa 1 concluída (obra antiga): Giovanna e ADM confirmam e respondem o financiamento; o vendedor leva 403; a conclusão não muda', async () => {
    semear(304, concluida1); cadastroBase();
    h.cad.telefone = '34999990000';
    const conclusao = (): unknown => JSON.stringify([estadoGravado(304)!.etapas[1].concluida_em, estadoGravado(304)!.etapas[1].concluida_por, estadoGravado(304)!.etapas[2].aberta_em]);
    const antes = conclusao();
    for (const auth of [GIOVANNA, THIAGO]) {
      const pode = (await obra(304, auth)).body.pode;
      expect(pode).toMatchObject({ confirmar: true, marcar_excedente: true });
      expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: true }, auth)).status).toBe(200);
      expect(estadoGravado(304)!.etapas[1].confirmados!.nome).toMatchObject({ marca: expect.any(String) });
      expect((await patch('/jornada-solar/obra/304', { financiamento: 'sim' }, auth)).status).toBe(200);
      expect((await patch('/jornada-solar/obra/304', { excedente: 'nao' }, auth)).status).toBe(200);
      expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_cnh', feito: true }, auth)).status).toBe(200);
      expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: false }, auth)).status).toBe(200);
    }
    expect(estadoGravado(304)!.etapas[1]).toMatchObject({ financiamento: 'sim', excedente: 'nao' });
    expect(conclusao()).toBe(antes);
    const vend = (await obra(304, NILCE)).body.pode;
    expect(vend).toMatchObject({ confirmar: false, marcar_excedente: false });
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: true }, NILCE)).status).toBe(403);
    expect((await patch('/jornada-solar/obra/304', { financiamento: 'nao' }, NILCE)).status).toBe(403);
    expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' }, NILCE)).status).toBe(403);
    expect(estadoGravado(304)!.etapas[1].financiamento).toBe('sim');
    // cancelada: ninguém
    semear(304, (e) => { concluida1(e); e.cancelada = { em: AGORA, por: 'thiago', etapa: 2, com_numero: false }; });
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: true }, GIOVANNA)).status).toBe(409);
  });
  it('obra só deduzida (sem estado gravado): Giovanna e ADM não confirmam nem respondem, e nada é gravado', async () => {
    cadastroBase();
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: null, venda: '#0057', por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    h.obrasPlanilha = [obraPlanilha({ codigo: '#0057', consultor: 'Nilce' })];
    for (const auth of [GIOVANNA, THIAGO]) {
      const o = await obra(304, auth);
      expect(o.body.trilho).toBe('deduzida');
      expect(o.body.pode).toMatchObject({ confirmar: false, marcar_excedente: false });
      expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: true }, auth)).status).toBe(403);
      expect((await patch('/jornada-solar/obra/304', { financiamento: 'sim' }, auth)).status).toBe(403);
      expect((await patch('/jornada-solar/obra/304', { excedente: 'sim' }, auth)).status).toBe(403);
    }
    expect(estadoGravado(304)).toBeNull();
  });
  it('confirmar placas e inversor só enquanto o kit pode mudar: com a etapa 3 concluída, 403 e nada gravado; nome ainda passa', async () => {
    semear(304, (e) => { na3(e); e.etapas[3].concluida_em = AGORA; e.etapas[3].concluida_por = 'thiago'; });
    cadastroBase();
    const antes = JSON.stringify(estadoGravado(304));
    for (const chave of ['placas', 'inversor']) {
      for (const auth of [GIOVANNA, THIAGO]) {
        const r = await post('/jornada-solar/obra/304/confirmar', { chave, confirmar: true, texto: '14 x Canadian 590 W' }, auth);
        expect(r.status, `${chave} ${auth}`).toBe(403);
        expect(r.body.error).toBe('O kit só muda até a homologação.');
      }
    }
    expect(JSON.stringify(estadoGravado(304))).toBe(antes);
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: true }, GIOVANNA)).status).toBe(200);
  });
  it('kit: confirmar na etapa 3 funciona (Giovanna), o PUT pede o Trello automático, e o GET diz pode.confirmar_kit só até a etapa 3 concluir', async () => {
    semear(304, na3); cadastroBase();
    const g = await obra(304, GIOVANNA);
    expect(g.body.pode).toMatchObject({ confirmar_kit: true, editar_venda: true });
    expect((await obra(304)).body.pode.confirmar_kit).toBe(false);   // a Nilce não mexe na venda depois da etapa 1: mesma regra de hoje
    const kitFalso = await put('/jornada-solar/obra/304/venda', { ...PAGAMENTO, valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], prazo_prometido: 'x', kit_confirmado: false }, GIOVANNA);
    expect(kitFalso.status).toBe(200);
    expect(h.disparos).toEqual([]);   // kit não confirmado: nada a disparar
    const ok = await put('/jornada-solar/obra/304/venda', { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], prazo_prometido: 'x', kit_confirmado: true }, GIOVANNA);
    expect(ok.status).toBe(200);
    expect(ok.body.venda.kit_confirmado).toBe(true);
    expect(h.disparos).toEqual([{ card: 304, nome: 'giovanna' }]);
    expect(ok.body.venda.editado.at(-1)).toMatchObject({ campos: ['kit'] });   // só o kit mudou: valor, pagamento e prazo ficaram como estavam
    expect((await put('/jornada-solar/obra/304/venda', { ...PAGAMENTO }, DIEGO)).status).toBe(403);
    semear(304, (e) => { na3(e); e.etapas[3].concluida_em = AGORA; });
    expect((await obra(304, GIOVANNA)).body.pode.confirmar_kit).toBe(false);
    // etapa 3 concluída: o PUT recusa MUDAR o kit (desfazer), mas segue aceitando a venda com o kit como estava
    const desfaz = await put('/jornada-solar/obra/304/venda', { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], prazo_prometido: 'x', kit_confirmado: false }, GIOVANNA);
    expect(desfaz.status).toBe(403);
    expect(JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).venda.kit_confirmado).toBe(true);
    const mantem = await put('/jornada-solar/obra/304/venda', { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], prazo_prometido: 'y', kit_confirmado: true }, GIOVANNA);
    expect(mantem.status).toBe(200);
  });
  it('GET: trello_auto diz o que falta (pronto: false) e dados_cliente leva os 4 campos do bloco cliente', async () => {
    semear(304, na3); cadastroBase();
    h.cad.telefone = '34999990000'; h.cad.email = 'a@b.c';
    const r = await obra(304, GIOVANNA);
    expect(r.body.trello_auto).toEqual({
      pronto: false, falta: ['Datasheet da placa', 'Datasheet do inversor', 'KMZ do local', 'Número da venda'],
    });
    expect(r.body.dados_cliente).toMatchObject({ nome: 'Marcos Andrade', endereco_ponto: 'Rua A, 10', telefone: '34999990000', email: 'a@b.c' });
    expect(r.body.slots).toMatchObject({ kmz: false, datasheet_modulo: false, datasheet_inversor: false, conta_luz_beneficiaria: false });
    expect(r.body.etapas[0].nome).toBe('Venda');
    expect(r.body.etapas[0].itens.map((i: any) => i.chave)).not.toContain('contrato_assinado');
    expect(r.body.etapas[1].itens.slice(0, 2).map((i: any) => [i.bloco, i.chave])).toEqual([['anexos', 'contrato_assinado'], ['anexos', 'procuracao']]);
    expect(r.body.kit_vendido).toEqual({ placas: '', inversor: '', kwp: null, faltando: ['placas', 'inversor'], manual: [] });   // sem proposta ligada
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: 'P1', venda: null, por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
    expect((await obra(304, GIOVANNA)).body.kit_vendido).toEqual({ placas: '14 × Canadian CS7N 590 W', inversor: '1 × Growatt 10K', kwp: 8.26, faltando: [], manual: [] });
    expect(r.body.etapas[1].nome).toBe('Assinaturas e vistoria');
    expect(r.body.etapas[1].curto).toBe('Assinaturas');
    expect(r.body.etapas[2].itens.slice(0, 3).map((i: any) => i.chave)).toEqual(['datasheet_modulo', 'datasheet_inversor', 'kmz']);
  });
  it('blocoVendaCompleto sem o kit: com proposta, valor e prazo, ligar a proposta já conta como venda completa', async () => {
    semear(304); cadastroBase();
    const { lerJornadaComVersao } = await import('../services/gerador/jornadaSolarBanco');
    expect((await post('/jornada-solar/obra/304/proposta', { codigo: 'P1' })).status).toBe(200);
    const estado = (await lerJornadaComVersao(304)).estado!;
    expect(estado.historico.some((x) => x.acao === 'venda_completa')).toBe(true);
  });
});

describe('Fase 1 (versão final): confirmar, pedidos, financiamento, vistoria e relatório final', () => {
  const ligarP1 = async () => {
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: 'P1', venda: null, por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
  };
  const cadastroCompleto = () => {
    h.cad = { nome: 'Marcos Andrade', telefone: '34999990000', email: 'a@b.c', endereco_ponto: 'Rua A, 10', endereco: 'Rua B, 20', bairro: 'Centro', cidade: 'Uberlândia', uf: 'MG', cep: '38400000' };
    h.priv.set('vendasolar/304.jornada.json', JSON.stringify({ v: 1, venda: { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }], desconto_centavos: null, prazo_prometido: 'x', nota: '', kit_confirmado: false, combinado_por: 'nilce', combinado_em: AGORA, editado: [] }, cancelamento: null, descancelamentos: [] }));
  };
  const confirmar = (chave: string, confirmarValor = true, auth = NILCE) => post('/jornada-solar/obra/304/confirmar', { chave, confirmar: confirmarValor }, auth);
  const kitGravado = (): boolean => JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).venda.kit_confirmado;

  it('confirmar grava a marca do valor de agora; mudou o valor, a confirmação some do GET e o item volta a pedir; confirmar:false remove', async () => {
    semear(304); cadastroCompleto(); await ligarP1();
    const antes = await obra(304);
    expect(antes.body.confirmados).toEqual({});
    expect(antes.body.etapas[0].itens.find((i: any) => i.chave === 'nome')).toMatchObject({ bloco: 'cliente', feito: false });
    const ok = await confirmar('nome');
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body.confirmados)).toEqual(['nome']);
    expect(estadoGravado(304)!.etapas[1].confirmados!.nome).toMatchObject({ por: 'nilce', marca: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const depois = await obra(304);
    expect(depois.body.confirmados).toEqual({ nome: { em: AGORA, por: 'nilce' } });
    expect(depois.body.etapas[0].itens.find((i: any) => i.chave === 'nome').feito).toBe(true);
    h.cad.nome = 'Marcos A. Andrade';   // o valor mudou
    const mudou = await obra(304);
    expect(mudou.body.confirmados).toEqual({});
    expect(mudou.body.etapas[0].itens.find((i: any) => i.chave === 'nome').feito).toBe(false);
    expect(estadoGravado(304)!.etapas[1].confirmados!.nome).toBeDefined();   // a marca velha fica guardada, mas não vale
    expect((await confirmar('nome')).status).toBe(200);
    expect((await obra(304)).body.confirmados).toHaveProperty('nome');
    expect((await confirmar('nome', false)).body.confirmados).toEqual({});
    expect(estadoGravado(304)!.etapas[1].confirmados).toBeUndefined();
  });
  it('confirmar: chave ou corpo inválido 400; sem o dado 409; quem não edita 403 e a Giovanna pode; etapa 1 concluída ou cancelada recusa; nada de valor no estado nem no log', async () => {
    semear(304); cadastroCompleto(); await ligarP1();
    expect((await confirmar('kit')).status).toBe(400);
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome' })).status).toBe(400);
    delete h.cad.telefone;
    const sem = await confirmar('telefone');
    expect(sem.status).toBe(409);
    expect(sem.body.error).toBe('Falta o dado para confirmar.');
    expect((await confirmar('nome', true, DIEGO)).status).toBe(403);
    expect((await confirmar('valor', true, GIOVANNA)).status).toBe(200);
    expect((await confirmar('pagamento')).status).toBe(200);
    expect(JSON.stringify([...h.linhas.values()])).not.toContain('3890000');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('3890000');
    semear(304, concluida1);
    expect((await confirmar('nome')).status).toBe(403);
    expect((await obra(304)).body.pode.confirmar).toBe(false);
    semear(304, (e) => { e.cancelada = { em: AGORA, por: 'thiago', etapa: 1, com_numero: false }; });
    expect((await confirmar('nome')).status).toBe(409);
  });
  it('confirmar placas E inversor grava kit_confirmado=true (compatibilidade); desfazer um deles volta a false; a proposta que muda invalida', async () => {
    semear(304); cadastroCompleto(); await ligarP1();
    expect((await confirmar('placas')).status).toBe(200);
    expect(kitGravado()).toBe(false);
    expect((await confirmar('inversor')).status).toBe(200);
    expect(kitGravado()).toBe(true);
    expect((await obra(304)).body.kit_vendido).toMatchObject({ placas: '14 × Canadian CS7N 590 W', inversor: '1 × Growatt 10K' });
    h.propostas.find((p) => p.codigo === 'P1')!.inversor = 'Fronius 10K';
    expect(Object.keys((await obra(304)).body.confirmados)).toEqual(['placas']);
    expect((await confirmar('inversor')).status).toBe(200);
    expect((await confirmar('placas', false)).status).toBe(200);
    expect(kitGravado()).toBe(false);
  });
  it('proposta SEM marca ou quantidade: confirmar aceita `texto` (3 a 120), a confirmação é sobre o texto, kit_vendido lista o que falta; com dado na proposta, sem texto funciona como sempre', async () => {
    semear(304); cadastroCompleto(); await ligarP1();
    const p1 = h.propostas.find((p) => p.codigo === 'P1')!;
    p1.dados = {};   // sem marca da placa e sem potência
    p1.inversor = null;   // sem inversor
    const sem = await obra(304);
    expect(sem.body.kit_vendido).toEqual({ placas: '14', inversor: '1', kwp: null, faltando: ['placas', 'inversor'], manual: [] });
    // sem dado e sem texto: não dá para confirmar
    expect((await confirmar('placas')).status).toBe(409);
    expect((await confirmar('inversor')).status).toBe(409);
    // texto inválido ou na chave errada
    for (const corpo of [{ chave: 'placas', confirmar: true, texto: 'ab' }, { chave: 'placas', confirmar: true, texto: 'x'.repeat(121) }, { chave: 'placas', confirmar: true, texto: 12 },
      { chave: 'nome', confirmar: true, texto: 'Marcos' }, { chave: 'placas', confirmar: true, texto: 'a\u0001b c' }]) {
      expect((await post('/jornada-solar/obra/304/confirmar', corpo)).status, JSON.stringify(corpo)).toBe(400);
    }
    const ok = await post('/jornada-solar/obra/304/confirmar', { chave: 'placas', confirmar: true, texto: '14 x Canadian 590 W' });
    expect(ok.status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].kit_texto).toEqual({ placas: '14 x Canadian 590 W' });
    expect(Object.keys(ok.body.confirmados)).toEqual(['placas']);
    expect(kitGravado()).toBe(false);   // falta o inversor
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'inversor', confirmar: true, texto: '1 x Growatt 10K' })).status).toBe(200);
    expect(kitGravado()).toBe(true);
    const g = await obra(304);
    expect(g.body.kit_vendido).toMatchObject({ placas: '14 x Canadian 590 W', inversor: '1 x Growatt 10K', faltando: [], manual: ['placas', 'inversor'] });   // a tela mostra o texto com Editar
    expect(g.body.etapas[0].itens.filter((i: any) => i.chave === 'placas' || i.chave === 'inversor').map((i: any) => i.feito)).toEqual([true, true]);
    // Editar: trocar o texto de um item JÁ confirmado e confirmar de novo (a marca nova substitui a anterior)
    const marcaVelha = estadoGravado(304)!.etapas[1].confirmados!.placas.marca;
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'placas', confirmar: true, texto: '15 x Canadian 590 W' })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].kit_texto!.placas).toBe('15 x Canadian 590 W');
    expect(estadoGravado(304)!.etapas[1].confirmados!.placas.marca).not.toBe(marcaVelha);
    const editado = await obra(304);
    expect(editado.body.kit_vendido).toMatchObject({ placas: '15 x Canadian 590 W', manual: ['placas', 'inversor'] });
    expect(editado.body.confirmados).toHaveProperty('placas');
    // só mudar o texto (sem confirmar) também invalida: o valor guardado vira outro e a marca antiga não bate
    const { mudarJornada } = await import('../services/gerador/jornadaSolarBanco');
    await mudarJornada(304, () => { throw new Error('existe'); }, (e) => ({ ...e, etapas: { ...e.etapas, 1: { ...e.etapas[1], kit_texto: { ...e.etapas[1].kit_texto, placas: '99 x Outra 600 W' } } } }));
    expect((await obra(304)).body.confirmados).not.toHaveProperty('placas');
    // mudou o texto: a confirmação antiga deixa de valer até confirmar de novo (a marca é do texto)
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'placas', confirmar: false })).status).toBe(200);
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'placas', confirmar: true, texto: '16 x Canadian 590 W' })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].kit_texto!.placas).toBe('16 x Canadian 590 W');
    // a proposta ganhou os dados: vale o da proposta; confirmar sem texto funciona; o texto mandado agora é ignorado
    p1.dados = { tab: { mod: 'Canadian CS7N', pot: 590 } }; p1.inversor = 'Growatt 10K'; p1.qtd_inversor = 1;
    const comDado = await obra(304);
    expect(comDado.body.kit_vendido).toMatchObject({ placas: '14 × Canadian CS7N 590 W', inversor: '1 × Growatt 10K', faltando: [] });
    expect(comDado.body.confirmados).not.toHaveProperty('placas');   // a confirmação era do texto, não deste dado
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'placas', confirmar: true, texto: 'qualquer coisa aqui' })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].kit_texto!.placas).toBe('16 x Canadian 590 W');   // não regravou: a proposta tem dado
    expect((await obra(304)).body.confirmados).toHaveProperty('placas');
  });
  it('quem não vê dinheiro (Diego, com o dinheiro aberto desligado) não recebe valor nem pagamento em lugar nenhum da resposta; o vendedor, a Giovanna e o ADM seguem vendo', async () => {
    semear(304); cadastroCompleto(); await ligarP1(); await fecharDinheiro();
    const sem = await obra(304, DIEGO);
    expect(sem.status).toBe(200);
    const texto = JSON.stringify(sem.body);
    expect(texto).not.toContain('3890000');
    expect(texto).not.toContain('194500');   // nem a comissão de 5%
    expect(texto).not.toContain('"valor_centavos"');
    expect(texto).not.toContain('"pagamento":');
    expect(texto).not.toContain('"desconto_centavos"');
    expect(sem.body.comissoes).toEqual([]);
    expect(sem.body.venda).toEqual({ prazo_prometido: 'x', kit_confirmado: false, combinado_por: 'nilce', combinado_em: AGORA });   // o que a tela usa, sem dinheiro
    expect(Object.keys(sem.body.dados_cliente)).not.toContain('valor_centavos');
    for (const auth of [NILCE, GIOVANNA, THIAGO]) {
      const com = await obra(304, auth);
      expect(com.body.venda).toMatchObject({ valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: '' }] });
      expect(com.body.dados_cliente.valor_centavos).toBe(3890000);
    }
    // o vendedor continua vendo depois de concluir a etapa 1 (quando já não edita a venda)
    semear(304, concluida1);
    expect((await obra(304, NILCE)).body.venda.valor_centavos).toBe(3890000);
    expect(JSON.stringify((await obra(304, DIEGO)).body)).not.toContain('3890000');
  });
  it('regra única de valor: com o dinheiro aberto (padrão) todo consultor da obra vê o valor; fechado, só vendedor, Giovanna e ADM', async () => {
    semear(304); cadastroCompleto(); await ligarP1();
    expect((await obra(304, DIEGO)).body.venda).toMatchObject({ valor_centavos: 3890000 });
    expect((await obra(304, DIEGO)).body.dados_cliente.valor_centavos).toBe(3890000);
    await fecharDinheiro();
    expect((await obra(304, DIEGO)).body.venda).not.toHaveProperty('valor_centavos');
    expect((await obra(304, NILCE)).body.venda.valor_centavos).toBe(3890000);   // o vendedor da obra vê mesmo fechado
  });
  it('sem permissão de valor, a resposta da obra não tem NENHUMA chave terminada em _centavos (nem o banco da fase2); com permissão o banco leva os valores', async () => {
    semear(304); cadastroCompleto(); await ligarP1(); await fecharDinheiro();
    h.priv.set('vendasolar/304.obra.json', JSON.stringify({ v: 1, banco: { banco: 'BV', agencia: '0001', conta: '123-4', eq_centavos: 2500000, mo_centavos: 800000 } }));
    const chaves = (x: unknown, acc: string[] = []): string[] => {
      if (Array.isArray(x)) x.forEach((i) => chaves(i, acc));
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { acc.push(k); chaves(v, acc); }
      return acc;
    };
    const sem = await obra(304, DIEGO);
    expect(sem.status).toBe(200);
    expect(chaves(sem.body).filter((k) => k.endsWith('_centavos'))).toEqual([]);
    expect(JSON.stringify(sem.body)).not.toContain('2500000');
    expect(sem.body.fase2.dados.banco).toMatchObject({ banco: 'BV', agencia: '0001', conta: '123-4' });
    for (const auth of [NILCE, GIOVANNA, THIAGO]) expect((await obra(304, auth)).body.fase2.dados.banco).toMatchObject({ eq_centavos: 2500000, mo_centavos: 800000 });
  });
  it('GET: dados_cliente.cpf e a origem de cada dado (ia, manual, card ou sem dado)', async () => {
    semear(304); cadastroCompleto();
    h.cad.cpf_cnpj = '529.982.247-25';
    h.fontes = { nome: 'ia', cpf_cnpj: 'ia', telefone: 'ficha', endereco_ponto: 'contrato' };
    delete h.cad.email;
    const g = await obra(304);
    expect(g.body.dados_cliente.cpf).toBe('529.982.247-25');
    expect(g.body.dados_cliente.origem).toMatchObject({ nome: 'ia', telefone: 'card', endereco: 'manual', endereco_ponto: 'manual', email: null, cpf: 'ia' });
    // quem não vê dinheiro vê o CPF como o cadastro mostra (não é dado de dinheiro) e a origem também
    expect((await obra(304, DIEGO)).body.dados_cliente).toMatchObject({ cpf: '529.982.247-25', origem: { nome: 'ia' } });
    h.cad = {}; h.fontes = {};
    expect((await obra(304)).body.dados_cliente).toMatchObject({ cpf: '', origem: { nome: null, telefone: null, endereco: null, endereco_ponto: null, email: null, cpf: null } });
  });
  it('PATCH dos pedidos ao cliente: grava {em, por}, o item fecha, feito:false remove; pedido sem feito ou desconhecido 400; só quem edita; só com a etapa 1 aberta', async () => {
    semear(304); cadastroCompleto();
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_cnh', feito: true })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].pedidos).toEqual({ pedido_cnh: { em: AGORA, por: 'nilce' } });
    const g = await obra(304);
    expect(g.body.pedidos).toEqual({ pedido_cnh: { em: AGORA, por: 'nilce' } });
    expect(g.body.etapas[0].itens.some((i: any) => i.chave.startsWith('pedido_'))).toBe(false);   // o tique fica no estado, não é mais item
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_cnh', feito: false })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1].pedidos).toBeUndefined();
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_cnh' })).status).toBe(400);
    expect((await patch('/jornada-solar/obra/304', { feito: true })).status).toBe(400);
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_x', feito: true })).status).toBe(400);
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_cnh', feito: true }, DIEGO)).status).toBe(403);
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_fachada', feito: true }, GIOVANNA)).status).toBe(200);
    // o arquivo fecha o item de documento ou foto da etapa 1 (sem tique)
    anexos(304, ['conta_luz', 'medidor']);
    expect((await obra(304)).body.etapas[0].itens.filter((i: any) => i.bloco === 'documentos' || i.bloco === 'fotos').map((i: any) => [i.chave, i.feito]))
      .toEqual([['documento', false], ['conta_luz', true], ['fachada', false], ['padrao', false], ['disjuntor', false], ['medidor', true]]);
    semear(304, concluida1);
    expect((await patch('/jornada-solar/obra/304', { pedido: 'pedido_cnh', feito: true })).status).toBe(403);
  });
  it('financiamento no mesmo PATCH do excedente: sim abre o item proposta_banco (banco, agência e conta da obra), não some; GET traz a resposta', async () => {
    semear(304); cadastroCompleto();
    expect((await obra(304)).body.financiamento).toBeNull();
    expect((await patch('/jornada-solar/obra/304', { financiamento: 'talvez' })).status).toBe(400);
    expect((await patch('/jornada-solar/obra/304', { financiamento: 'sim', excedente: 'nao' })).status).toBe(200);
    expect(estadoGravado(304)!.etapas[1]).toMatchObject({ financiamento: 'sim', excedente: 'nao' });
    const g = await obra(304);
    expect(g.body.financiamento).toBe('sim');
    const itens = g.body.etapas[0].itens;
    expect(itens.find((i: any) => i.chave === 'financiamento')).toMatchObject({ bloco: 'venda', feito: true });
    expect(itens.find((i: any) => i.chave === 'proposta_banco')).toMatchObject({ bloco: 'venda', feito: false });
    h.priv.set('vendasolar/304.obra.json', JSON.stringify({ v: 1, banco: { banco: 'BV', agencia: '0001', conta: '123-4' } }));
    expect((await obra(304)).body.etapas[0].itens.find((i: any) => i.chave === 'proposta_banco').feito).toBe(true);
    expect((await patch('/jornada-solar/obra/304', { financiamento: 'nao' })).status).toBe(200);
    expect((await obra(304)).body.etapas[0].itens.some((i: any) => i.chave === 'proposta_banco')).toBe(false);
  });
  it('GET: vistoria_pct, fase2 (vistoria e proposta de banco, versões e pode.secoes), excedente_cpf, relatorio_final e dados_cliente com o endereço (valor só para quem mexe na venda)', async () => {
    semear(304); cadastroCompleto(); await ligarP1();
    const vazio = await obra(304);
    expect(vazio.body).toMatchObject({ vistoria_pct: 0, excedente_cpf: { ok: null, texto: null }, relatorio_final: null });
    expect(vazio.body.fase2.dados).toEqual({ vistoria: null, banco: null });
    expect(vazio.body.fase2.pode.secoes).toEqual(['vistoria', 'banco']);
    expect((await obra(304, DIEGO)).body.fase2.pode.secoes).toEqual([]);
    expect((await obra(304, GIOVANNA)).body.fase2.pode.secoes).toEqual(['vistoria', 'banco']);
    const v = { data: '2026-11-18', quem: 'Nilce', acomp: 'Marcos', concl: 'ok', obs: 'ok', telhado: { tipo: 'colonial', estado: 'bom', orient: 'norte', incl: '20', area: '40', sombra: 'não', estr: 'madeira', acesso: 'fácil' },
      entrada: { padrao: 'monofásico', tensao: '220', disj: '50', apto: 'sim', aterr: 'sim', quadro: 'sim' }, inversor: { local: 'garagem', dist: '', abrig: '', wifi: '' } };
    h.priv.set('vendasolar/304.obra.json', JSON.stringify({ v: 1, vistoria: v, versoes: { vistoria: 3 } }));
    const cheio = await obra(304);
    expect(cheio.body.vistoria_pct).toBe(86);   // 20 de 23 campos
    expect(cheio.body.fase2.dados.vistoria).toMatchObject({ data: '2026-11-18', concl: 'ok' });
    expect(cheio.body.fase2.versoes.vistoria).toBe(3);
    expect(cheio.body.etapas[1].itens.find((i: any) => i.chave === 'vistoria')).toMatchObject({ bloco: 'vistoria', feito: true });   // a vistoria é item da etapa 2
    expect(cheio.body.etapas[0].itens.some((i: any) => i.chave === 'vistoria')).toBe(false);
    // o endereço completo e o dinheiro: o vendedor e a Giovanna veem o valor; o Diego, não
    const nilce = await obra(304);
    expect(nilce.body.dados_cliente).toMatchObject({ nome: 'Marcos Andrade', endereco: 'Rua B, 20', bairro: 'Centro', cidade: 'Uberlândia', uf: 'MG', cep: '38400000', endereco_ponto: 'Rua A, 10', telefone: '34999990000' });
    expect(nilce.body.dados_cliente.valor_centavos).toBe(3890000);
    expect(nilce.body.dados_cliente.pagamento).toEqual([{ forma: 'pix', valor_centavos: 3890000 }]);
    expect((await obra(304, GIOVANNA)).body.dados_cliente.valor_centavos).toBe(3890000);
    expect((await obra(304, THIAGO)).body.dados_cliente.valor_centavos).toBe(3890000);   // ADM
    await fecharDinheiro();
    expect(Object.keys((await obra(304, DIEGO)).body.dados_cliente)).not.toContain('valor_centavos');
    // CPF do excedente
    semear(304, (e) => { e.etapas[1].excedente = 'sim'; });
    h.cad = { ...h.cad, cpf_cnpj: '52998224725', titular_conta: 'Marcos Andrade', benef_1_uc: '3012', benef_1_titular: 'Marcos Andrade', benef_1_doc: '11144477735' };
    const cpf = await obra(304);
    expect(cpf.body.excedente_cpf).toEqual({ ok: false, texto: 'Conta do excedente em outro CPF. Peça ao cliente para passar para o mesmo CPF.' });
    expect(cpf.body.etapas[0].itens.find((i: any) => i.chave === 'excedente')).toMatchObject({ bloco: 'excedente', feito: false });
  });
  it('relatório final: o vendedor e os donos de etapa geram; outro consultor 404; cancelada 403; PDF grande 413; Chromium fora 503', async () => {
    semear(304); cadastroCompleto();
    h.relatorios = [];
    const ok = await post('/jornada-solar/obra/304/relatorio-final', {});
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, gerado_em: expect.any(String), trello: 'sem_cartao' });   // o anexo ao cartão é provado em vendaSolarTrello.route.test.ts
    expect(h.relatorios).toEqual([{ card: 304, nome: 'nilce' }]);
    expect((await post('/jornada-solar/obra/304/relatorio-final', {}, DIEGO)).status).toBe(200);
    expect((await post('/jornada-solar/obra/304/relatorio-final', {}, CARLA)).status).toBe(404);
    h.relatorioFalha = 'grande';
    expect((await post('/jornada-solar/obra/304/relatorio-final', {})).status).toBe(413);
    h.relatorioFalha = 'chromium';
    expect((await post('/jornada-solar/obra/304/relatorio-final', {})).status).toBe(503);
    h.relatorioFalha = null;
    semear(304, (e) => { e.cancelada = { em: AGORA, por: 'thiago', etapa: 1, com_numero: false }; });
    expect((await post('/jornada-solar/obra/304/relatorio-final', {})).status).toBe(403);
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

describe('Leitura por IA na obra (19/11): dados do cadastro, origem por documento, venda_origem e "Ler tudo"', () => {
  const seedPrivado = (venda: Record<string, unknown> | null): void => {
    h.priv.set('vendasolar/304.jornada.json', JSON.stringify({ v: 1, cancelamento: null, descancelamentos: [], trazidas: [], venda: venda && {
      valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: 'Entrada' }], desconto_centavos: null, prazo_prometido: 'até 60 dias', nota: '',
      kit_confirmado: false, combinado_por: '', combinado_em: '', editado: [], ...venda,
    } }));
  };

  it('GET: dados_cliente traz rg, nascimento, estado civil, profissão e a unidade geradora; origem e origem_doc cobrem os campos novos', async () => {
    semear(304);
    h.cad = { nome: 'Ana Souza', rg_ie: 'MG1234567', nascimento: '17/05/1980', estado_civil: 'casada', profissao: 'Professora', unidade_consumidora: '12345678', concessionaria: 'Cemig', titular_conta: 'Ana Souza', uc_classe: 'residencial', consumo_medio_kwh: '412.5' };
    h.fontes = { nome: 'ia', rg_ie: 'ia', nascimento: 'ia', profissao: 'manual', unidade_consumidora: 'ia', consumo_medio_kwh: 'ia' };
    h.docs = { nome: 'documento_titular', rg_ie: 'documento_titular', unidade_consumidora: 'conta_luz', consumo_medio_kwh: 'conta_luz', profissao: 'contrato_assinado' };
    const d = (await obra(304)).body.dados_cliente;
    expect(d).toMatchObject({
      rg: 'MG1234567', nascimento: '17/05/1980', estado_civil: 'casada', profissao: 'Professora', unidade_consumidora: '12345678',
      concessionaria: 'Cemig', titular_conta: 'Ana Souza', uc_classe: 'residencial', consumo_medio_kwh: '412.5',
    });
    expect(d.origem).toMatchObject({ nome: 'ia', rg: 'ia', profissao: 'manual', unidade_consumidora: 'ia', concessionaria: 'manual', uc_classe: 'manual' });
    expect(d.origem_doc).toMatchObject({ nome: 'documento_titular', rg: 'documento_titular', unidade_consumidora: 'conta_luz', consumo_medio_kwh: 'conta_luz', concessionaria: null, nascimento: null });
    expect(d.origem_doc.profissao).toBeNull();   // o slot só vale quando foi a IA que gravou
    h.cad = {}; h.fontes = {}; h.docs = {};
    const vazio = (await obra(304)).body.dados_cliente;
    expect(vazio).toMatchObject({ rg: '', nascimento: '', consumo_medio_kwh: '' });
    expect(Object.values(vazio.origem_doc).every((v) => v === null)).toBe(true);
  });

  it('GET: venda_origem (valor, pagamento, prazo) diz ia com o slot ou manual; só sai com o valor, para quem vê o dinheiro', async () => {
    semear(304);
    seedPrivado({ ia: { valor: 'orcamento', prazo: 'contrato_assinado' } });
    const v = (await obra(304)).body.dados_cliente;
    expect(v.valor_centavos).toBe(3890000);
    expect(v.venda_origem).toEqual({ valor: { fonte: 'ia', doc: 'orcamento' }, pagamento: { fonte: 'manual', doc: null }, prazo: { fonte: 'ia', doc: 'contrato_assinado' } });
    seedPrivado({ valor_centavos: 0, pagamento: [], prazo_prometido: '' });
    expect((await obra(304)).body.dados_cliente.venda_origem).toEqual({ valor: null, pagamento: null, prazo: null });
    // quem não vê o dinheiro (Diego não é o vendedor, a Giovanna nem ADM) não recebe valor nem venda_origem
    seedPrivado({ ia: { valor: 'orcamento' } });
    await fecharDinheiro();
    const diego = await obra(304, DIEGO);
    expect(diego.status).toBe(200);
    expect(diego.body.dados_cliente).not.toHaveProperty('valor_centavos');
    expect(diego.body.dados_cliente).not.toHaveProperty('venda_origem');
    expect(JSON.stringify(diego.body)).not.toContain('3890000');
    expect(JSON.stringify(diego.body)).not.toContain('orcamento');
    // a Giovanna vê
    expect((await obra(304, GIOVANNA)).body.dados_cliente.venda_origem.valor).toEqual({ fonte: 'ia', doc: 'orcamento' });
  });

  const ligarP1 = async (): Promise<void> => {
    const { assinarLigacao } = await import('../services/gerador/vendaSolarHub');
    const lig = { proposta: 'P1', venda: null, por: 'nilce', em: AGORA };
    h.linhas.set('venda_solar:304', { updated_at: 'v', value: { ...lig, sig: assinarLigacao(304, lig) } });
  };
  const avisos = (): number => (estadoGravado(304)?.historico ?? []).filter((x) => x.acao === 'venda_completa').length;
  const MARCAS = { ia: { valor: 'orcamento', pagamento: 'orcamento', prazo: 'contrato_assinado' } };
  const proposta = () => h.propostas.find((x) => x.codigo === 'P1')!;

  it('o que a IA gravou não completa o bloco Venda: ligar a proposta não dá o aviso nem espelha; o PUT de uma pessoa aceita (apaga as marcas), espelha e avisa UMA vez', async () => {
    semear(304);
    seedPrivado(MARCAS);
    expect((await post('/jornada-solar/obra/304/proposta', { codigo: 'P1' })).status).toBe(200);
    expect(avisos()).toBe(0);                                     // valor, pagamento e prazo ainda são da IA
    expect(proposta().valor_vendido).toBeUndefined();             // e nada foi espelhado
    const corpo = { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 3890000, obs: 'Entrada' }], prazo_prometido: 'até 60 dias' };
    expect((await put('/jornada-solar/obra/304/venda', corpo)).status).toBe(200);
    expect(avisos()).toBe(1);
    expect(proposta().valor_vendido).toBe(38900);
    expect(JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).venda.ia).toBeUndefined();
    expect((await obra(304)).body.dados_cliente.venda_origem).toEqual({ valor: { fonte: 'manual', doc: null }, pagamento: { fonte: 'manual', doc: null }, prazo: { fonte: 'manual', doc: null } });
    expect((await put('/jornada-solar/obra/304/venda', corpo)).status).toBe(200);
    expect(avisos()).toBe(1);                                     // uma vez só
  });

  it('confirmar o valor (ou o pagamento) aceita o bloco: apaga as marcas, espelha na proposta ligada e dá o aviso UMA vez; confirmar outro dado não mexe nas marcas', async () => {
    semear(304); await ligarP1();
    h.cad = { nome: 'Marcos Andrade' };
    seedPrivado(MARCAS);
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'nome', confirmar: true })).status).toBe(200);
    expect(avisos()).toBe(0);
    expect(JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).venda.ia).toEqual(MARCAS.ia);
    expect((await get('/jornada-solar/obra/304')).status).toBe(200);
    const c = await post('/jornada-solar/obra/304/confirmar', { chave: 'valor', confirmar: true });
    expect(c.status).toBe(200);
    expect(avisos()).toBe(1);
    expect(proposta().valor_vendido).toBe(38900);
    expect(JSON.parse(h.priv.get('vendasolar/304.jornada.json')!).venda.ia).toBeUndefined();
    expect((await post('/jornada-solar/obra/304/confirmar', { chave: 'pagamento', confirmar: true })).status).toBe(200);
    expect(avisos()).toBe(1);                                     // sem marcas, nada roda de novo
  });

  it('venda com as marcas ia de valor ou pagamento e proposta ligada: blocoVendaCompleto é falso até uma pessoa aceitar; a marca só do prazo não pesa', async () => {
    const { blocoVendaCompleto } = await import('../services/gerador/jornadaSolar');
    const venda = { valor_centavos: 100, pagamento: [{ forma: 'pix' as const, valor_centavos: 100, obs: '' }], desconto_centavos: null, prazo_prometido: '30 dias', nota: '', kit_confirmado: false, combinado_por: '', combinado_em: '', editado: [] };
    const base = { v: 1 as const, cancelamento: null, descancelamentos: [], trazidas: [] };
    expect(blocoVendaCompleto({ proposta: 'P1' }, { ...base, venda })).toBe(true);
    expect(blocoVendaCompleto({ proposta: 'P1' }, { ...base, venda: { ...venda, ia: { prazo: 'contrato_assinado' } } })).toBe(true);    // o prazo não é dinheiro nem tem confirmação própria
    expect(blocoVendaCompleto({ proposta: 'P1' }, { ...base, venda: { ...venda, ia: { valor: 'orcamento' } } })).toBe(false);
    expect(blocoVendaCompleto({ proposta: 'P1' }, { ...base, venda: { ...venda, ia: { pagamento: 'orcamento', prazo: 'orcamento' } } })).toBe(false);
  });

  it('pode.ler_tudo: o vendedor, a Giovanna e o ADM; outro consultor com acesso à obra não; venda cancelada ninguém', async () => {
    semear(304);
    expect((await obra(304)).body.pode.ler_tudo).toBe(true);                 // Nilce, a vendedora
    expect((await obra(304, GIOVANNA)).body.pode.ler_tudo).toBe(true);
    expect((await obra(304, THIAGO)).body.pode.ler_tudo).toBe(true);         // ADM (sócio)
    const diego = await obra(304, DIEGO);
    if (diego.status === 200) expect(diego.body.pode.ler_tudo).toBe(false);
    semear(304, (e) => { e.cancelada = { em: AGORA, por: 'thiago', etapa: 1, com_numero: false }; });
    for (const auth of [NILCE, GIOVANNA, THIAGO]) expect((await obra(304, auth)).body.pode.ler_tudo).toBe(false);
  });

  it('POST ler-tudo: o vendedor, a Giovanna e o ADM leem; devolve { ok, preenchidos, ignorados }; nome do card e de quem pediu vão ao serviço', async () => {
    semear(304);
    for (const auth of [NILCE, GIOVANNA, THIAGO]) {
      const r = await post('/jornada-solar/obra/304/ler-tudo', {}, auth);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, preenchidos: ['rg_ie'], ignorados: 1 });
    }
    expect(h.lerTudo.chamadas).toHaveLength(3);
    expect(h.lerTudo.chamadas[0]).toMatchObject({ card: { id: 304 }, nome: 'nilce' });
    expect(h.lerTudo.chamadas.map((c: any) => c.nome)).toEqual(['nilce', 'giovanna', 'thiago']);
  });

  it('POST ler-tudo: sem permissão não lê (403 ou 404 igual para alheio), venda cancelada dá 403, cota dá 429 e erro da IA dá 502 com mensagem curta', async () => {
    semear(304);
    const carla = await post('/jornada-solar/obra/304/ler-tudo', {}, CARLA);   // consultora de outra venda: a guarda da obra responde 404
    expect(carla.status).toBe(404);
    const diego = await post('/jornada-solar/obra/304/ler-tudo', {}, DIEGO);
    expect([403, 404]).toContain(diego.status);
    expect(h.lerTudo.chamadas).toHaveLength(0);
    h.lerTudo.resultado = { acao: 'cota' };
    const cota = await post('/jornada-solar/obra/304/ler-tudo', {});
    expect(cota.status).toBe(429);
    expect(cota.body).toMatchObject({ ok: false });
    h.lerTudo.resultado = { acao: 'falhou' };
    const ia = await post('/jornada-solar/obra/304/ler-tudo', {});
    expect(ia.status).toBe(502);
    expect(ia.body.error.length).toBeLessThan(80);
    h.lerTudo.resultado = { acao: 'sem_arquivo' };
    expect((await post('/jornada-solar/obra/304/ler-tudo', {})).body).toEqual({ ok: true, preenchidos: [], ignorados: 0 });
    h.lerTudo.chamadas = [];
    semear(304, (e) => { e.cancelada = { em: AGORA, por: 'thiago', etapa: 1, com_numero: false }; });
    for (const auth of [NILCE, GIOVANNA, THIAGO]) expect((await post('/jornada-solar/obra/304/ler-tudo', {}, auth)).status).toBe(403);
    expect(h.lerTudo.chamadas).toHaveLength(0);
  });
});

describe('Orçamento é item com preço: só quem vê o valor da obra lista, abre, envia, move ou remove (19/11)', () => {
  const docs = (auth = NILCE) => get('/clientes/vendasolar/304/docs', auth);
  const chavesDe = (r: any): string[] => r.body.slots.map((i: any) => i.chave);
  const slotsDe = (r: any): string[] => r.body.arquivos.map((a: any) => a.slot);
  const registro = () => h.linhas.get('docs_cliente:vendasolar:304')!.value.arquivos.map((a: any) => a.slot);

  it('com o dinheiro fechado: a lista de quem não vê (Diego) não traz o item nem o arquivo do orçamento, mas traz o contrato; o vendedor, a Giovanna e o ADM veem os dois', async () => {
    semear(304);
    anexos(304, ['contrato_assinado', 'orcamento']);
    await fecharDinheiro();
    const diego = await docs(DIEGO);
    expect(diego.status).toBe(200);
    expect(chavesDe(diego)).toContain('contrato_assinado');
    expect(chavesDe(diego)).not.toContain('orcamento');
    expect(slotsDe(diego)).toEqual(['contrato_assinado']);
    expect(JSON.stringify(diego.body)).not.toContain('orcamento');
    for (const auth of [NILCE, GIOVANNA, THIAGO]) {
      const r = await docs(auth);
      expect(r.status).toBe(200);
      expect(chavesDe(r)).toContain('orcamento');
      expect(slotsDe(r).sort()).toEqual(['contrato_assinado', 'orcamento']);
    }
  });

  it('com o dinheiro aberto todo mundo com acesso à venda vê o orçamento (a mesma regra do valor da obra)', async () => {
    semear(304);
    anexos(304, ['orcamento']);
    expect(chavesDe(await docs(DIEGO))).toContain('orcamento');
  });

  it('quem não vê o dinheiro leva 403 ao enviar (URL de envio e registro), mover para o orçamento, e ao mexer no arquivo que já está lá; o contrato segue livre', async () => {
    semear(304);
    anexos(304, ['contrato_assinado', 'orcamento']);
    await fecharDinheiro();
    const envio = await post('/clientes/vendasolar/304/docs/upload-url', { slot: 'orcamento', mime: 'application/pdf', bytes: 10 }, DIEGO);
    expect(envio.status).toBe(403);
    expect((await post('/clientes/vendasolar/304/docs', { slot: 'orcamento', caminho: 'vendasolar/304/qualquer.pdf' }, DIEGO)).status).toBe(403);
    expect((await post('/clientes/vendasolar/304/docs/upload-url', { slot: 'contrato_assinado', mime: 'application/pdf', bytes: 10 }, DIEGO)).status).not.toBe(403);
    // arquivos com id de verdade para as rotas de remover e mover
    const ID_CON = '11111111-1111-4111-8111-111111111111'; const ID_ORC = '22222222-2222-4222-8222-222222222222';
    h.linhas.set('docs_cliente:vendasolar:304', { updated_at: 'd2', value: { arquivos: [
      { id: ID_CON, slot: 'contrato_assinado', caminho: `vendasolar/304/${ID_CON}.pdf`, mime: 'application/pdf', bytes: 10, em: AGORA, por: 'x' },
      { id: ID_ORC, slot: 'orcamento', caminho: `vendasolar/304/${ID_ORC}.pdf`, mime: 'application/pdf', bytes: 10, em: AGORA, por: 'x' },
    ], alteracoes: [], apagados: [] } });
    expect((await request(app).delete(`/gerador/clientes/vendasolar/304/docs/${ID_ORC}`).set('Authorization', DIEGO)).status).toBe(403);
    expect((await request(app).patch(`/gerador/clientes/vendasolar/304/docs/${ID_ORC}`).set('Authorization', DIEGO).send({ rotulo: 'Meu orçamento' })).status).toBe(403);
    expect((await request(app).patch(`/gerador/clientes/vendasolar/304/docs/${ID_CON}`).set('Authorization', DIEGO).send({ slot: 'orcamento' })).status).toBe(403);
    expect((await request(app).patch(`/gerador/clientes/vendasolar/304/docs/${ID_CON}`).set('Authorization', DIEGO).send({ rotulo: 'Contrato do Marcos' })).status).not.toBe(403);   // o contrato segue como era
    expect(registro().sort()).toEqual(['contrato_assinado', 'orcamento']);
  });
});
