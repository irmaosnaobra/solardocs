import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Vendas FINALIZADAS da Jornada (05/11/2026). Por ordem do dono, as vendas solares que já existiam passam a aparecer como finalizadas, com a ficha
// preenchida pela Planilha de clientes. Login, bancos, Storage, alocador e Trello simulados; IA mock; nenhum envio real. Dados inventados.
// O `system_state` simulado conta os INSERTs do corte e devolve 23505 na chave repetida, como o Postgres.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  agendamentos: [] as Array<Record<string, any>>,
  propostas: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: any; updated_at: string }>(),
  priv: new Map<string, string>(),
  obrasPlanilha: [] as any[],
  planilhaCai: false,
  aloc: { chamadas: [] as any[], resultado: { ok: true, acao: 'criou', codigo: '#0070' } as any },
  tique: 0,
  insertsDoCorte: 0,
  tentativasDoCorte: 0,
  falhaEstado: false,
}));

const jsonb = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : 1)).map(([k, x]) => [k, jsonb(x)]));
  }
  return v;
};

function tabela(fonte: () => Array<Record<string, any>>) {
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
    from: (t: string) => tabela(() => (t === 'agendamentos' ? h.agendamentos : h.propostas)),
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
            maybeSingle: async () => {
              // As duas leituras do corte enxergam "vazio" antes de qualquer um gravar (dois processos ao mesmo tempo).
              await Promise.resolve();
              const l = h.linhas.get(q.k as string);
              return { data: l ? { key: q.k, value: l.value, updated_at: l.updated_at } : null, error: null };
            },
            then: (ok: any, ko: any) => Promise.resolve({ data: (q.in ?? []).filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null }).then(ok, ko),
          };
          return chain;
        },
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.falhaEstado && l.key.startsWith('jornada_solar:')) return { error: { code: 'XX000' } };
          if (l.key === 'jornada_corte') h.tentativasDoCorte++;
          if (h.linhas.has(l.key)) return { error: { code: '23505' } };
          if (l.key === 'jornada_corte') h.insertsDoCorte++;
          h.linhas.set(l.key, { value: jsonb(l.value), updated_at: stamp() });
          return { error: null };
        },
        upsert: async (l: { key: string; value: unknown }) => { h.linhas.set(l.key, { value: jsonb(l.value), updated_at: stamp() }); return { error: null }; },
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
  lerCadastroVisto: async () => ({ v: 1, alteracoes: [], em: null, campos: {} }),
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
  alocarCodigoSolar: vi.fn(async (p: any) => { h.aloc.chamadas.push({ card: p.card.id }); return h.aloc.resultado; }),
}));
vi.mock('../services/gerador/docsClienteBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/docsClienteBanco')>()),
  garantirBucketDocs: async () => undefined,
  assinarVarios: async () => new Map(),
}));

import { mountJornadaSolar } from '../routes/geradorJornadaSolar';
import { guardaDaObra } from '../routes/geradorJornadaGuarda';
import { exigeConsultor } from '../routes/geradorDossie';
import { alocarCodigoSolar } from '../services/gerador/vendaSolarCodigo';
import { assinarJornada, normalizarJornada, reiniciarLogsDaJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { assinarLigacao, invalidarCachesHub, reiniciarLogsDoHub } from '../services/gerador/vendaSolarHub';
import { ehFinalizada, lerCorte, reiniciarCorte, dataDoVendidoDoCard, CHAVE_CORTE } from '../services/gerador/jornadaCorte';
import { lancamentoObraParaGravar, montarLancamentoObra } from '../services/gerador/jornadaDinheiro';
import { chaveLancamento } from '../services/gerador/financeiroCliente';
import { dadosDaPlanilha } from '../services/gerador/jornadaFinalizada';
import { montarObra } from '../services/gerador/solarObras';
import { lerTudo } from '../services/io/jornadaMensagensBase';
import { eventosDoCard, filaDaPessoa, GRUPOS_MSG } from '../services/io/jornadaMensagensPuro';

const r = Router();
mountJornadaSolar(r);
r.post('/guarda/:card', exigeConsultor, async (req, res) => { const g = await guardaDaObra(req, res); if (g) res.json({ ok: true }); });
r.get('/guarda/:card', exigeConsultor, async (req, res) => { const g = await guardaDaObra(req, res); if (g) res.json({ ok: true }); });
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';
const CARLA = 'Bearer tk-carla';
const CORTE = '2026-11-05T15:00:00.000Z';
const ANTES = '2026-11-05T14:00:00.000Z';
const DEPOIS = '2026-11-06T09:00:00.000Z';
const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);
const post = (url: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const put = (url: string, corpo: unknown, auth = NILCE) => request(app).put(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const patch = (url: string, corpo: unknown, auth = NILCE) => request(app).patch(`/gerador${url}`).set('Authorization', auth).send(corpo as object);

const cardBase = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Cliente Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-03-01T10:00:00.000Z', quando: null, historico: '', ...o,
});
const ligar = (id: number, codigo: string): void => {
  const lig = { proposta: null, venda: codigo, por: 'nilce', em: ANTES };
  h.linhas.set(`venda_solar:${id}`, { updated_at: 'v', value: { ...lig, sig: assinarLigacao(id, lig) } });
};
const gravarEstado = (id: number, e: EstadoJornada): EstadoJornada => {
  const n = normalizarJornada(id, e)!;
  h.linhas.set(`jornada_solar:${id}`, { updated_at: 'j0', value: jsonb({ ...n, sig: assinarJornada(id, n) }) });
  return n;
};
/** Estado só de leitura (a materialização), como o que existia antes do corte sem ninguém ter trabalhado. */
const semearLeitura = (id: number): void => { gravarEstado(id, estadoMaterializado(id, 'Nilce', 2, ANTES)); };
/** Estado com trabalho de GENTE antes do corte. */
const semearComGente = (id: number): void => {
  const e = estadoMaterializado(id, 'Nilce', 2, ANTES);
  e.historico.push({ em: ANTES, por: 'nilce', acao: 'concluir', etapa: 1 });
  gravarEstado(id, e);
};
const estadoGravado = (id: number): EstadoJornada | null => {
  const l = h.linhas.get(`jornada_solar:${id}`);
  return l ? normalizarJornada(id, l.value) : null;
};
const obraPlanilha = (o: Record<string, unknown>) => ({
  codigo: '#0066', cliente: 'Joana Lima', homologacao: '', consultor: 'Nilce', origem: 'Tráfego pago', valorVenda: 38900, formaPagto: 'Pix e financiamento', recebidoReal: 38900,
  recebimento: 'Quitado', liberadoTxt: 'Liberado', depoimentoTxt: '', telefone: '(34) 98888-1111', endereco: 'Rua das Flores, 10', cidade: 'Araguari', uf: 'MG',
  entregaMaterial: '01/04/2026', previsaoMontagem: '', inicioInstalacao: '10/04/2026', fimInstalacao: '12/04/2026', qtdPlaca: '12', modeloPlaca: 'DMEGC', potPlaca: '550',
  statusPlaca: 'instalado', qtdInv: '1', modeloInversor: 'Growatt 6k', statusInversor: 'instalado', tipoEstrutura: 'Telhado', statusEstrutura: 'instalado',
  cadastroTrello: '10/02/2026', parecerAcesso: '10/03/2026', pedidoVistoria: '20/04/2026', liberacaoVistoria: '25/04/2026', engenheiro: 'Eng Teste', concessionaria: 'CEMIG-A',
  equipe: 'Equipe 1', ...o,
});

const iniciar = async (): Promise<void> => {
  // A primeira leitura depois do deploy grava o corte em CORTE.
  vi.setSystemTime(new Date(CORTE));
  expect(await lerCorte()).toBe(Date.parse(CORTE));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CORTE));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app',
    'tk-diego': 'diego@irmaosnaobra.app', 'tk-carla': 'carla@irmaosnaobra.app',
  };
  h.agendamentos = [
    cardBase(401, { cliente_nome: 'Joana Lima' }), cardBase(402, { cliente_nome: 'Joana Lima Silva' }), cardBase(403, { cliente_nome: 'Maria Souza' }),
    cardBase(404, { cliente_nome: 'Carlos Dias', vendedor_nome: 'Carla' }), cardBase(405, { status: 'agendado', cliente_nome: 'Venda Nova' }),
  ];
  h.propostas = [];
  h.linhas = new Map(); h.priv = new Map(); h.obrasPlanilha = []; h.planilhaCai = false; h.tique = 0; h.insertsDoCorte = 0; h.tentativasDoCorte = 0; h.falhaEstado = false;
  h.aloc.chamadas = [];
  delete process.env.JORNADA_FINALIZADAS_OFF;
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS;
  reiniciarCorte(); invalidarCachesHub(); reiniciarLogsDoHub(); reiniciarLogsDaJornada();
  vi.mocked(alocarCodigoSolar).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede indisponível no teste'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); process.env.JORNADA_FINALIZADAS_OFF = '1'; });

describe('o corte', () => {
  it('duas leituras ao mesmo tempo gravam UM corte só (a segunda perde a corrida com 23505 e lê o que a primeira gravou)', async () => {
    // Dois "processos": o segundo começa antes de o primeiro gravar. Os dois enxergam a chave vazia.
    const a = lerCorte();
    reiniciarCorte();
    vi.setSystemTime(new Date(DEPOIS));
    const b = lerCorte();
    const [ta, tb] = await Promise.all([a, b]);
    expect(h.tentativasDoCorte).toBe(2);
    expect(h.insertsDoCorte).toBe(1);
    expect(ta).toBe(tb);
    expect([...h.linhas.keys()].filter((k) => k === CHAVE_CORTE)).toHaveLength(1);
    // Daí em diante vale o gravado: nova leitura, em outro processo, em outra hora, devolve o mesmo.
    reiniciarCorte(); vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
    expect(await lerCorte()).toBe(ta);
    expect(h.tentativasDoCorte).toBe(2);
  });
  it('no mesmo processo, dez leituras juntas fazem um INSERT só', async () => {
    await Promise.all(Array.from({ length: 10 }, () => lerCorte()));
    expect(h.tentativasDoCorte).toBe(1);
  });
  it('corte ilegível: a jornada se comporta como DESLIGADA (ninguém é finalizada), sem 503, e só o código vai ao log', async () => {
    h.linhas.set(CHAVE_CORTE, { updated_at: 'c', value: 'lixo' });
    expect(await lerCorte()).toBe(0);
    expect(h.tentativasDoCorte).toBe(0);
    const l = await get('/jornada-solar/lista', THIAGO);
    expect(l.status).toBe(200);
    expect(l.body.contagem.finalizadas).toBe(0);
    const erros = vi.mocked(console.error).mock.calls.map((c) => c.join(' ')).join(' | ');
    expect(erros).toMatch(/corte_invalido/);
    expect(erros).not.toMatch(/lixo/);
    expect((await post('/jornada-solar/obra/401/trazer', { motivo: 'Cliente pediu revisão' }, THIAGO)).status).toBe(409);   // não é finalizada: já está na jornada
  });
  it('o corte é uma data ISO simples, gravada sem segredo; o corte antigo, com assinatura, vale pela data dele', async () => {
    delete process.env.VINCULO_SOLAR_SECRET;
    expect(await lerCorte()).toBe(Date.parse(CORTE));
    expect(h.linhas.get(CHAVE_CORTE)!.value).toBe(CORTE);
    reiniciarCorte();
    h.linhas.set(CHAVE_CORTE, { updated_at: 'c', value: { v: 1, em: '2020-01-01T00:00:00.000Z', sig: 'f'.repeat(64) } });
    expect(await lerCorte()).toBe(Date.parse('2020-01-01T00:00:00.000Z'));
  });
  it('JORNADA_FINALIZADAS_OFF=1 desliga a regra: ninguém é finalizada e o corte nem é lido', async () => {
    process.env.JORNADA_FINALIZADAS_OFF = '1';
    expect(ehFinalizada(null, null, 0, { vendidoMs: 1 })).toBe(false);
    expect(await lerCorte()).toBe(0);
    expect(h.tentativasDoCorte).toBe(0);
  });
});

describe('quem é finalizada (a conta pura)', () => {
  const corte = Date.parse(CORTE);
  const ANT = { vendidoMs: Date.parse(ANTES) };
  const DEP = { vendidoMs: Date.parse(DEPOIS) };
  it('sem estado, é finalizada SÓ se a data da venda é anterior ao corte; só leitura antes do corte, também', () => {
    expect(ehFinalizada(null, null, corte, ANT)).toBe(true);
    expect(ehFinalizada(estadoMaterializado(1, 'nilce', 2, ANTES), null, corte, ANT)).toBe(true);
    // Venda nova sem estado (a criação do estado falhou): a data é depois do corte, ou nem se sabe a data. Continua ativa.
    expect(ehFinalizada(null, null, corte, DEP)).toBe(false);
    expect(ehFinalizada(null, null, corte, { vendidoMs: corte })).toBe(false);
    expect(ehFinalizada(null, null, corte, { vendidoMs: null })).toBe(false);
    expect(ehFinalizada(null, null, corte)).toBe(false);
    // O estado só de leitura de uma venda NOVA (materializado depois do corte, sem `vendido_em`) também continua ativo.
    expect(ehFinalizada(estadoMaterializado(1, 'nilce', 1, DEPOIS), null, corte, DEP)).toBe(false);
    // Obra com dinheiro vivo lançado não é finalizada.
    expect(ehFinalizada(null, null, corte, { ...ANT, comDinheiro: true })).toBe(false);
    // Corte 0 (desligado ou ilegível): ninguém.
    expect(ehFinalizada(null, null, 0, ANT)).toBe(false);
  });
  it('evento de gente ATÉ o corte mantém ativa; DEPOIS do corte não reabre; número, venda completa e sonda não contam', () => {
    const com = (por: string, acao: any, em: string): EstadoJornada => {
      const e = estadoMaterializado(1, 'nilce', 2, ANTES); e.historico.push({ em, por, acao, etapa: 1 }); return e;
    };
    expect(ehFinalizada(com('nilce', 'concluir', ANTES), null, corte, ANT)).toBe(false);
    expect(ehFinalizada(com('nilce', 'concluir', DEPOIS), null, corte, ANT)).toBe(true);
    expect(ehFinalizada(com('nilce', 'numero', ANTES), null, corte, ANT)).toBe(true);
    expect(ehFinalizada(com('nilce', 'venda_completa', ANTES), null, corte, ANT)).toBe(true);
    expect(ehFinalizada(com('sonda', 'concluir', ANTES), null, corte, ANT)).toBe(true);
    expect(ehFinalizada(com('', 'concluir', ANTES), null, corte, ANT)).toBe(true);
  });
  it('vendido depois do corte, ou com a marca trazida, é ativa; o horário é comparado como data, não como texto', () => {
    const e = estadoMaterializado(1, 'nilce', 1, DEPOIS); e.vendido_em = DEPOIS;
    expect(ehFinalizada(e, null, corte)).toBe(false);
    const t = estadoMaterializado(1, 'nilce', 1, ANTES); t.historico.push({ em: DEPOIS, por: 'thiago', acao: 'trazida', etapa: 1 });
    expect(ehFinalizada(t, null, corte)).toBe(false);
    // Mesmo instante em formatos diferentes (+00:00 do banco, Z do JS).
    const f = estadoMaterializado(1, 'nilce', 1, ANTES); f.historico.push({ em: '2026-11-05T15:00:00.000Z', por: 'nilce', acao: 'concluir', etapa: 1 });
    expect(ehFinalizada(f, null, Date.parse('2026-11-05T12:00:00-03:00'), ANT)).toBe(false);
  });
});

describe('a lista e o filtro Finalizadas', () => {
  it('venda antes do corte é finalizada; com evento de gente antes do corte continua ativa; depois do corte entra na jornada', async () => {
    ligar(402, '#0067');
    semearLeitura(401); semearComGente(403);
    // 404 é da Carla: a Nilce não vê. 405 ainda é agendado.
    const a = await get('/jornada-solar/lista');
    expect(a.status).toBe(200);
    const por = (c: number) => a.body.linhas.find((l: any) => l.card === c);
    expect(por(401)).toMatchObject({ grupo: 'finalizadas', finalizada: true, trilho: 'finalizada', etapa: null, dono: null, minha: false, numero_pendente: null, codigo: null });
    expect(por(402)).toMatchObject({ grupo: 'finalizadas', finalizada: true, codigo: '#0067' });
    expect(por(403)).toMatchObject({ grupo: 'ativas', finalizada: false, trilho: 'jornada' });
    expect(a.body.contagem).toMatchObject({ finalizadas: 2, ativas: 1 });
    // O corte ficou gravado na primeira leitura.
    expect(h.insertsDoCorte).toBe(1);
    expect(Date.parse(h.linhas.get(CHAVE_CORTE)!.value)).toBe(Date.parse(CORTE));

    // Depois do corte: a venda nova entra na jornada (etapa 1 aberta, da Nilce); a antiga continua finalizada.
    vi.setSystemTime(new Date(DEPOIS));
    expect((await post('/vendas-solares/405/vendido', {})).status).toBe(200);
    const b = await get('/jornada-solar/lista');
    expect(b.body.linhas.find((l: any) => l.card === 405)).toMatchObject({ grupo: 'ativas', finalizada: false, trilho: 'jornada', etapa: { n: 1 }, minha: true });
    expect(b.body.linhas.find((l: any) => l.card === 401)).toMatchObject({ grupo: 'finalizadas' });
    expect(b.body.contagem).toMatchObject({ finalizadas: 2, ativas: 2 });
    expect(h.insertsDoCorte).toBe(1);
  });
  it('evento de gente DEPOIS do corte (upload, número, Trello) não devolve a venda antiga à cobrança', async () => {
    semearLeitura(401);
    await get('/jornada-solar/lista');
    vi.setSystemTime(new Date(DEPOIS));
    const e = estadoGravado(401)!;
    e.historico.push({ em: DEPOIS, por: 'nilce', acao: 'numero', etapa: 2 }, { em: DEPOIS, por: 'giovanna', acao: 'trello', etapa: 3 });
    gravarEstado(401, e);
    const b = await get('/jornada-solar/lista');
    expect(b.body.linhas.find((l: any) => l.card === 401)).toMatchObject({ grupo: 'finalizadas' });
  });
  it('as linhas só da planilha (sem card) são todas finalizadas, com o filtro por consultor igual ao de antes', async () => {
    h.obrasPlanilha = [obraPlanilha({ codigo: '#0040', cliente: 'So Planilha' }), obraPlanilha({ codigo: '#0041', cliente: 'Da Carla', consultor: 'Carla' })];
    const n = await get('/jornada-solar/lista');
    expect(n.body.linhas.filter((l: any) => l.trilho === 'planilha')).toEqual([
      expect.objectContaining({ codigo: '#0040', grupo: 'finalizadas', finalizada: true, card: null, etapa: null, minha: false }),
    ]);
    const t = await get('/jornada-solar/lista', THIAGO);
    expect(t.body.linhas.filter((l: any) => l.trilho === 'planilha').map((l: any) => l.codigo).sort()).toEqual(['#0040', '#0041']);
    expect(t.body.contagem.finalizadas).toBeGreaterThanOrEqual(2);
  });
  it('a finalizada não lê slot, não deduz etapa e só o ADM vê o dinheiro dela', async () => {
    ligar(401, '#0066'); h.obrasPlanilha = [obraPlanilha({})];
    const t = await get('/jornada-solar/lista', THIAGO);
    expect(t.body.linhas.find((l: any) => l.card === 401)).toMatchObject({ grupo: 'finalizadas', dinheiro: 'Quitada', etapa: null });
    const n = await get('/jornada-solar/lista');
    expect(n.body.linhas.find((l: any) => l.card === 401).dinheiro).toBeNull();
  });
});

describe('a obra finalizada: só leitura, com "Dados da planilha"', () => {
  it('casa pelo CÓDIGO ligado ao card; o nome parecido não casa; venda sem número não tem linha na planilha', async () => {
    ligar(401, '#0066');   // Joana Lima, ligada à #0066
    h.obrasPlanilha = [
      obraPlanilha({ codigo: '#0066', cliente: 'Joana Lima', concessionaria: 'CEMIG-A' }),
      obraPlanilha({ codigo: '#0067', cliente: 'Joana Lima Silva', concessionaria: 'CEMIG-B' }),   // nome parecido, código outro
      obraPlanilha({ codigo: '#0068', cliente: 'Maria Souza', concessionaria: 'CEMIG-C' }),        // mesmo nome do card 403, que não tem número
    ];
    const a = await get('/jornada-solar/obra/401');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, finalizada: true, codigo: '#0066', trilho: 'finalizada', etapa_atual: null, card: { id: 401, cliente: 'Joana Lima' } });
    const campo = (c: string) => a.body.planilha.campos.find((x: any) => x.chave === c)?.valor;
    expect(campo('concessionaria')).toBe('CEMIG-A');
    expect(a.body.planilha.codigo).toBe('#0066');
    expect(JSON.stringify(a.body)).not.toMatch(/CEMIG-B|CEMIG-C/);
    // O card 403 tem o mesmo nome da #0068 e NENHUM número: o nome não escolhe linha.
    const b = await get('/jornada-solar/obra/403');
    expect(b.body).toMatchObject({ finalizada: true, codigo: null, planilha: null });
    expect(b.body.planilha_aviso).toMatch(/ainda não tem número/);
    expect(JSON.stringify(b.body)).not.toMatch(/CEMIG-C|0068/);
  });
  it('mostra os campos úteis e esconde o campo vazio', async () => {
    ligar(401, '#0066');
    h.obrasPlanilha = [obraPlanilha({ engenheiro: '', equipe: '', tipoEstrutura: '', depoimentoTxt: '' })];
    const a = await get('/jornada-solar/obra/401', THIAGO);
    const chaves = a.body.planilha.campos.map((x: any) => x.chave);
    for (const k of ['valor_vendido', 'forma_pagamento', 'recebido', 'telefone', 'endereco', 'cidade', 'concessionaria', 'placas', 'kwp', 'inversor', 'data_venda', 'homologacao', 'material', 'instalacao', 'liberacao']) expect(chaves).toContain(k);
    for (const k of ['engenheiro', 'equipe', 'estrutura', 'depoimento']) expect(chaves).not.toContain(k);
    const campo = (c: string) => a.body.planilha.campos.find((x: any) => x.chave === c)?.valor;
    expect(campo('kwp')).toBe('6,6 kWp');
    expect(campo('placas')).toBe('12 x DMEGC (550 W)');
    expect(campo('data_venda')).toBe('10/02/2026');
    expect(campo('instalacao')).toBe('10/04/2026 a 12/04/2026');
    expect(campo('forma_pagamento')).toBe('Pix e financiamento');
    expect(a.body.planilha.campos.every((x: any) => String(x.valor).trim() !== '')).toBe(true);
  });
  it('a visibilidade é a da Planilha de clientes: valores só de sócio, o bloco só de sócio ou do consultor da venda', async () => {
    ligar(401, '#0066'); h.obrasPlanilha = [obraPlanilha({})];
    const chavesDe = (b: any): string[] => (b.planilha?.campos ?? []).map((x: any) => x.chave);
    // Consultora da venda (não é sócia): vê a ficha, sem dinheiro. A chave nem existe.
    const nilce = await get('/jornada-solar/obra/401', NILCE);
    expect(chavesDe(nilce.body)).toContain('concessionaria');
    for (const k of ['valor_vendido', 'forma_pagamento', 'recebido', 'a_receber']) expect(chavesDe(nilce.body)).not.toContain(k);
    expect(JSON.stringify(nilce.body)).not.toMatch(/38\.900|Pix e financiamento/);
    // Origem em texto cru só do sócio: para a Nilce, só o tipo.
    expect(nilce.body.planilha.campos.find((x: any) => x.chave === 'origem').valor).toBe('Tráfego');
    // Sócios (Thiago ADM e Diego): veem o dinheiro e o texto cru da origem.
    for (const auth of [THIAGO, DIEGO]) {
      const s = await get('/jornada-solar/obra/401', auth);
      expect(chavesDe(s.body)).toEqual(expect.arrayContaining(['valor_vendido', 'forma_pagamento', 'recebido']));
      expect(s.body.planilha.campos.find((x: any) => x.chave === 'valor_vendido').valor).toMatch(/38\.900,00/);
      expect(s.body.planilha.campos.find((x: any) => x.chave === 'origem').valor).toBe('Tráfego pago');
    }
    // Giovanna (dona de etapa, não é sócia nem consultora desta venda): abre o cabeçalho e NÃO recebe o bloco.
    const g = await get('/jornada-solar/obra/401', GIOVANNA);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ finalizada: true, planilha: null, planilha_oculta: true, card: { id: 401 } });
    expect(JSON.stringify(g.body)).not.toMatch(/CEMIG|Rua das Flores|98888|38\.900/);
    // A venda 404 é da Carla: a Nilce leva 404, igual ao de uma venda que não existe.
    expect((await get('/jornada-solar/obra/404', NILCE)).status).toBe(404);
    expect((await get('/jornada-solar/obra/999', NILCE)).status).toBe(404);
  });
  it('a troca de consultor da Gestão de clientes vale: a linha é do consultor que ela diz, e a Nilce deixa de ver o bloco', async () => {
    ligar(401, '#0066'); h.obrasPlanilha = [obraPlanilha({ consultor: 'Carla' })];
    const n = await get('/jornada-solar/obra/401', NILCE);
    expect(n.body).toMatchObject({ finalizada: true, planilha: null, planilha_oculta: true });
  });
  it('planilha fora do ar não derruba a obra: cabeçalho e o aviso', async () => {
    ligar(401, '#0066'); h.planilhaCai = true;
    const a = await get('/jornada-solar/obra/401');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ finalizada: true, planilha: null, planilha_aviso: 'Não consegui ler a planilha agora.' });
  });
  it('a linha só da planilha abre por código, com a mesma visibilidade; a que um card já usa manda abrir pelo card', async () => {
    h.obrasPlanilha = [obraPlanilha({ codigo: '#0040', cliente: 'So Planilha' }), obraPlanilha({ codigo: '#0066' })];
    ligar(401, '#0066');
    const a = await get('/jornada-solar/planilha/%230040');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ finalizada: true, card: null, codigo: '#0040', cabecalho: { cliente: 'So Planilha' }, pode: { trazer: false } });
    expect(a.body.planilha.campos.map((x: any) => x.chave)).not.toContain('valor_vendido');
    expect((await get('/jornada-solar/planilha/%230066')).body).toEqual({ ok: true, abrir_card: 401 });
    expect((await get('/jornada-solar/planilha/%230040', CARLA)).status).toBe(404);   // a Carla não vê linha da Nilce
    expect((await get('/jornada-solar/planilha/%230099', THIAGO)).status).toBe(404);
    expect((await get('/jornada-solar/planilha/abc', THIAGO)).status).toBe(400);
    const t = await get('/jornada-solar/planilha/%230040', THIAGO);
    expect(t.body.planilha.campos.map((x: any) => x.chave)).toContain('valor_vendido');
    h.planilhaCai = true;
    expect((await get('/jornada-solar/planilha/%230040', THIAGO)).status).toBe(503);
  });
  it('a conta pura: sem permissão para ver, o bloco é null; sem planilha, kWp não aparece', () => {
    const b = obraPlanilha({ potPlaca: '' });
    const m = montarObra(b as any, '2026-11-05');
    expect(dadosDaPlanilha(b as any, m, 'carla')).toBeNull();
    const ok = dadosDaPlanilha(b as any, m, 'nilce')!;
    expect(ok.campos.map((c) => c.chave)).not.toContain('kwp');
    expect(ok.campos.map((c) => c.chave)).not.toContain('valor_vendido');
  });
});

describe('a finalizada não é editável', () => {
  it('toda rota que grava responde 409 finalizada, sem criar estado e sem alocar número', async () => {
    h.obrasPlanilha = [obraPlanilha({})]; ligar(401, '#0066');
    const corpoVenda = { valor_centavos: 100, pagamento: [{ forma: 'pix', valor_centavos: 100, obs: '' }], prazo_prometido: 'x', nota: '', kit_confirmado: true };
    const chamadas = await Promise.all([
      put('/jornada-solar/obra/401/venda', corpoVenda, THIAGO),
      post('/jornada-solar/obra/401/proposta', { codigo: 'P1' }, THIAGO),
      patch('/jornada-solar/obra/401', { excedente: 'nao' }, THIAGO),
      post('/jornada-solar/obra/401/etapa', { etapa: 1 }, THIAGO),
      post('/jornada-solar/obra/401/esperar', { motivo: 'cliente', ate: '2026-11-10' }, THIAGO),
      post('/jornada-solar/obra/401/cancelar', { motivo: 'teste teste' }, THIAGO),
      post('/jornada-solar/obra/401/descancelar', { motivo: 'teste teste' }, THIAGO),
      post('/jornada-solar/obra/401/papel', { tipo: 'contrato' }, THIAGO),
      post('/jornada-solar/obra/401/numero', {}, THIAGO),
    ]);
    for (const c of chamadas) expect(c.body).toMatchObject({ ok: false, precisa: 'finalizada' });
    for (const c of chamadas) expect(c.status).toBe(409);
    expect(h.linhas.has('jornada_solar:401')).toBe(false);
    expect(h.linhas.has('jornada_obra:401')).toBe(false);
    expect(h.priv.size).toBe(0);
    expect(vi.mocked(alocarCodigoSolar)).not.toHaveBeenCalled();
  });
  it('a guarda comum das rotas das etapas 4 a 8 e do dinheiro: leitura passa, gravação dá 409 finalizada; a venda ativa grava', async () => {
    semearComGente(403);
    expect((await get('/guarda/401', THIAGO)).status).toBe(200);
    const w = await post('/guarda/401', {}, THIAGO);
    expect(w.status).toBe(409);
    expect(w.body).toMatchObject({ precisa: 'finalizada' });
    expect((await post('/guarda/403', {}, THIAGO)).status).toBe(200);
  });
  it('o número da assinatura e o cartão do Trello não mexem numa finalizada', async () => {
    const { tentarNumeroDaJornada, guardarTrelloNaJornada } = await import('../routes/geradorJornadaNumero');
    const card = h.agendamentos.find((c) => c.id === 401) as any;
    const r1 = await tentarNumeroDaJornada(card, { nome: 'nilce', socio: false }, Date.now(), {});
    expect(r1).toEqual({ ok: false, motivo: 'finalizada' });
    await guardarTrelloNaJornada(401, 'https://trello.com/c/AbCdEf12', 'nilce', card);
    expect(h.linhas.has('jornada_solar:401')).toBe(false);
    expect(vi.mocked(alocarCodigoSolar)).not.toHaveBeenCalled();
  });
});

describe('nenhum robô enxerga a finalizada', () => {
  it('lerTudo (a fonte de todos os robôs) deixa a finalizada de fora, e a ativa fica', async () => {
    semearLeitura(401); semearComGente(403);
    const leitura = await lerTudo();
    expect(leitura).not.toBeNull();
    expect(leitura!.obras.map((o) => o.card)).toEqual([403]);
  });
  it('fila das 08:00, "É sua" e escalada não pegam a finalizada, mesmo com a etapa dela na vez do dono', async () => {
    semearLeitura(401);   // etapa 2, dona Giovanna: se a leitura a trouxesse, entrava na fila dela
    const leitura = await lerTudo();
    expect(filaDaPessoa('giovanna', leitura!.obras, '2026-11-05').itens).toEqual([]);
    const ligados = Object.fromEntries(GRUPOS_MSG.map((g) => [g, '2026-11-01T00:00:00.000Z'])) as any;
    expect(leitura!.obras.flatMap((o) => eventosDoCard({ card: o.card, js: o.js, jo: o.jo, vendedor: o.vendedor }, new Date(CORTE), ligados))).toEqual([]);
  });
  it('sem conseguir ler o BANCO do corte, o robô não vê nada (leitura nula: ninguém envia)', async () => {
    const { supabase } = await import('../utils/supabase');
    vi.spyOn(supabase as any, 'from').mockImplementation(() => { throw Object.assign(new Error('fora'), { code: 'PGRST000' }); });
    expect(await lerTudo()).toBeNull();
  });
  it('com o corte ilegível o robô se comporta como desligado: enxerga a venda que tem estado, sem derrubar nada', async () => {
    h.linhas.set(CHAVE_CORTE, { updated_at: 'c', value: 'lixo' });
    semearLeitura(401);
    const leitura = await lerTudo();
    expect(leitura!.obras.map((o) => o.card)).toEqual([401]);
  });
});

describe('Trazer para a jornada', () => {
  it('só o ADM; exige motivo; 409 se não é finalizada; a venda volta na etapa que a dedução indica e vira ativa', async () => {
    h.obrasPlanilha = [];
    const corpo = { motivo: 'Cliente pediu revisão da obra' };
    expect((await post('/jornada-solar/obra/401/trazer', corpo, NILCE)).status).toBe(403);
    expect((await post('/jornada-solar/obra/401/trazer', corpo, DIEGO)).status).toBe(403);   // sócio, mas não ADM
    expect((await post('/jornada-solar/obra/401/trazer', corpo, GIOVANNA)).status).toBe(403);
    expect((await post('/jornada-solar/obra/401/trazer', { motivo: 'ab' }, THIAGO)).status).toBe(400);
    expect((await post('/jornada-solar/obra/401/trazer', {}, THIAGO)).status).toBe(400);
    expect(h.linhas.has('jornada_solar:401')).toBe(false);
    // Os dois "pode" da obra finalizada: só o ADM vê o botão.
    expect((await get('/jornada-solar/obra/401', THIAGO)).body.pode).toEqual({ trazer: true });
    expect((await get('/jornada-solar/obra/401', DIEGO)).body.pode).toEqual({ trazer: false });
    expect((await get('/jornada-solar/obra/401', NILCE)).body.pode).toEqual({ trazer: false });

    const ok = await post('/jornada-solar/obra/401/trazer', corpo, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, etapa: 1 });
    const e = estadoGravado(401)!;
    expect(e.historico.some((x) => x.acao === 'trazida' && x.por === 'thiago')).toBe(true);
    expect(JSON.parse(h.priv.get('vendasolar/401.jornada.json') as string).trazidas[0]).toMatchObject({ motivo: 'Cliente pediu revisão da obra', por: 'thiago' });
    const l = await get('/jornada-solar/lista', THIAGO);
    expect(l.body.linhas.find((x: any) => x.card === 401)).toMatchObject({ grupo: 'ativas', finalizada: false, trilho: 'jornada' });
    expect((await post('/jornada-solar/obra/401/trazer', corpo, THIAGO)).status).toBe(409);
    // A obra trazida abre como obra normal (não finalizada) e aceita escrita.
    const o = await get('/jornada-solar/obra/401', THIAGO);
    expect(o.body.finalizada).toBeUndefined();
    expect(o.body.etapa_atual).toBe(1);
    expect((await patch('/jornada-solar/obra/401', { excedente: 'nao' }, THIAGO)).status).toBe(200);
    // O evento humano de DEPOIS do corte, junto com a marca, mantém a venda ativa mesmo com o tempo passando.
    vi.setSystemTime(new Date('2026-12-20T10:00:00.000Z'));
    reiniciarCorte();
    expect((await get('/jornada-solar/lista', THIAGO)).body.linhas.find((x: any) => x.card === 401).grupo).toBe('ativas');
  });
  it('entra na etapa que a planilha indica (aqui, a 6) e materializa os dois estados com as anteriores fechadas como leitura', async () => {
    ligar(401, '#0066');
    h.obrasPlanilha = [obraPlanilha({ fimInstalacao: '', pedidoVistoria: '', liberacaoVistoria: '', liberadoTxt: '' })];
    // Instalação sem data final: a etapa atual da planilha é a 6 (instalação).
    const ok = await post('/jornada-solar/obra/401/trazer', { motivo: 'Obra em andamento' }, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body.etapa).toBe(6);
    expect(h.linhas.has('jornada_obra:401')).toBe(true);
    const e = estadoGravado(401)!;
    expect(e.etapas[1].concluida_por).toBe('leitura');
    expect(e.etapas[3].concluida_por).toBe('leitura');
    expect(e.historico.filter((x) => x.por !== 'leitura').map((x) => x.acao)).toEqual(['trazida']);
  });
  it('NÃO dispara mensagem retroativa: depois de trazer, os eventos dos robôs saem vazios e nada fala de etapa que já passou', async () => {
    ligar(401, '#0066');
    h.obrasPlanilha = [obraPlanilha({ fimInstalacao: '', pedidoVistoria: '', liberacaoVistoria: '', liberadoTxt: '' })];
    await post('/jornada-solar/obra/401/trazer', { motivo: 'Obra em andamento' }, THIAGO);
    const leitura = await lerTudo();
    const o = leitura!.obras.find((x) => x.card === 401)!;
    expect(o).toBeTruthy();   // agora é ativa: o robô a enxerga
    const ligados = Object.fromEntries(GRUPOS_MSG.map((g) => [g, '2026-11-01T00:00:00.000Z'])) as any;
    for (const agora of [new Date(CORTE), new Date('2026-11-05T15:30:00.000Z'), new Date('2026-11-06T08:00:00.000Z')]) {
      expect(eventosDoCard({ card: 401, js: o.js, jo: o.jo, vendedor: o.vendedor }, agora, ligados, { equipeVenda: ['5534999990001'] })).toEqual([]);
    }
  });
  it('a gravação é só da venda trazida: nenhuma outra venda ganha estado', async () => {
    semearLeitura(402);
    const antes = [...h.linhas.keys()].sort();
    await post('/jornada-solar/obra/401/trazer', { motivo: 'Cliente pediu revisão' }, THIAGO);
    const novas = [...h.linhas.keys()].filter((k) => !antes.includes(k)).sort();
    expect(novas).toEqual(['jornada_corte', 'jornada_solar:401']);
  });
});

// ── Achados da revisão (05/11/2026): venda nova sem estado, dinheiro vivo e a data do Vendido ───────────────────────────────────────────

/** Um gasto lançado (assinado) na obra, como o do `lancamento`; `estorno_de` no `extra` faz a linha de estorno. */
const semearGasto = (card: number, id: string, extra: Record<string, unknown> = {}): void => {
  const m = montarLancamentoObra({
    id, tipo: 'saida', categoria: 'material', etapa: 2, valor_centavos: 10_000, data: '2026-11-01', descricao: 'Material', conferencia: 'sem_comprovante', arquivo: null, ...extra,
  }, { cardId: card, autor: 'nilce', agoraIso: ANTES, hojeBr: '2026-11-05' });
  if (!m.ok) throw new Error(`lançamento de teste inválido: ${m.erro}`);
  h.linhas.set(chaveLancamento(card, id), { updated_at: 'f', value: jsonb(lancamentoObraParaGravar(card, m.lancamento)) });
};
const linhaVendido = (dia: string, hora: string): string => `[${dia} ${hora} · Nilce] 🏷️ Status: AGENDADO → VENDIDO.`;

describe('a data do Vendido, lida do histórico do card', () => {
  it('a linha não tem ano: o ano sobe quando dia/mês volta, e vale a linha VENDIDO mais nova, no horário de Brasília', () => {
    const h1 = `${linhaVendido('05/01', '10h00')}\n\n[02/12 09h00 · Nilce] 🏷️ Status: NOVO → AGENDADO.`;
    expect(dataDoVendidoDoCard(h1, '2025-12-01T10:00:00.000Z', Date.parse(CORTE))).toBe(Date.UTC(2026, 0, 5, 13, 0));
    expect(dataDoVendidoDoCard(linhaVendido('06/11', '09h00'), '2026-03-01T10:00:00.000Z', Date.parse(DEPOIS))).toBe(Date.UTC(2026, 10, 6, 12, 0));
    // "VENDIDO → CANCELADO" não é a venda; sem linha de venda, vale o created_at.
    expect(dataDoVendidoDoCard('[03/04 10h00 · Nilce] 🏷️ Status: VENDIDO → CANCELADO.', '2026-03-01T10:00:00.000Z', Date.parse(CORTE))).toBe(Date.parse('2026-03-01T10:00:00.000Z'));
    expect(dataDoVendidoDoCard('', null, Date.parse(CORTE))).toBeNull();
  });
});

describe('venda nova sem estado não vira finalizada calada', () => {
  it('na lista: card vendido depois do corte (linha VENDIDO do histórico, ou criado depois) continua ativo; o antigo é finalizado', async () => {
    await iniciar();
    h.agendamentos.push(
      cardBase(406, { cliente_nome: 'Vendeu Hoje', historico: linhaVendido('06/11', '09h00') }),   // lead antigo, vendido depois do corte
      cardBase(407, { cliente_nome: 'Lead Novo', created_at: DEPOIS }),                            // criado depois do corte, sem linha
      cardBase(408, { cliente_nome: 'Vendeu Antes', historico: linhaVendido('10/04', '10h00') }),  // vendido antes do corte
    );
    vi.setSystemTime(new Date('2026-11-07T10:00:00.000Z'));
    const b = await get('/jornada-solar/lista');
    expect(b.status).toBe(200);
    const por = (c: number) => b.body.linhas.find((l: any) => l.card === c);
    expect(por(406)).toMatchObject({ grupo: 'ativas', finalizada: false });
    expect(por(407)).toMatchObject({ grupo: 'ativas', finalizada: false });
    expect(por(408)).toMatchObject({ grupo: 'finalizadas', finalizada: true });
    expect(por(401)).toMatchObject({ grupo: 'finalizadas' });   // o antigo sem linha: created_at de março
  });
  it('o estado só de leitura (sem vendido_em) de uma venda NOVA continua ativo na lista e na guarda de escrita', async () => {
    await iniciar();
    h.agendamentos.push(cardBase(409, { cliente_nome: 'Vendeu Depois', historico: linhaVendido('06/11', '09h00') }));
    vi.setSystemTime(new Date(DEPOIS));
    gravarEstado(409, estadoMaterializado(409, 'Nilce', 2, DEPOIS));
    const l = await get('/jornada-solar/lista');
    expect(l.body.linhas.find((x: any) => x.card === 409)).toMatchObject({ grupo: 'ativas', finalizada: false });
    expect((await post('/guarda/409', {})).status).toBe(200);
  });
  it('Vendido com a criação do estado falhando: 200, mas `jornada:false` e um `aviso` para quem clicou; o card segue ativo', async () => {
    await iniciar();
    vi.setSystemTime(new Date(DEPOIS));
    h.falhaEstado = true;
    const v = await post('/vendas-solares/405/vendido', {});
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ ok: true, status: 'fechou', jornada: false });
    expect(String(v.body.aviso)).toMatch(/jornada não abriu/);
    expect(h.linhas.has('jornada_solar:405')).toBe(false);
    h.falhaEstado = false;
    vi.setSystemTime(new Date('2026-11-07T10:00:00.000Z'));
    const l = await get('/jornada-solar/lista');
    expect(l.body.linhas.find((x: any) => x.card === 405)).toMatchObject({ grupo: 'ativas', finalizada: false });
    expect((await post('/guarda/405', {})).status).toBe(200);
  });
});

describe('dinheiro vivo lançado é trabalho de gente', () => {
  it('a obra com gasto lançado antes do corte continua ativa (lista, guarda de escrita e robô); sem o gasto, é finalizada', async () => {
    semearGasto(402, 'gasto-0001');
    const l = await get('/jornada-solar/lista');
    expect(l.body.linhas.find((x: any) => x.card === 402)).toMatchObject({ grupo: 'ativas', finalizada: false });
    expect(l.body.linhas.find((x: any) => x.card === 401)).toMatchObject({ grupo: 'finalizadas' });
    // `anexar`, `dispensar` e `conferir` passam pela guarda: com dinheiro vivo não ficam presos no 409.
    expect((await post('/guarda/402', {})).status).toBe(200);
    expect((await post('/guarda/401', {})).status).toBe(409);
  });
  it('gasto ESTORNADO não conta: a obra volta a ser finalizada', async () => {
    semearGasto(402, 'gasto-0001');
    semearGasto(402, 'est-000001', { estorno_de: 'gasto-0001', motivo_estorno: 'Erro', conferencia: 'estorno' });
    const l = await get('/jornada-solar/lista');
    expect(l.body.linhas.find((x: any) => x.card === 402)).toMatchObject({ grupo: 'finalizadas' });
    expect((await post('/guarda/402', {})).status).toBe(409);
  });
});
