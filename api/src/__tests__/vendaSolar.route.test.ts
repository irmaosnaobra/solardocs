import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Venda SOLAR pelo card (linha `vendasolar`): as rotas. Tudo simulado (login, os dois bancos, os buckets, a planilha e a Anthropic;
// nenhuma chamada sai para a rede). Dados inventados. O que se prova: a guarda (vendedor, consultor da venda ligada, sócio; outro
// consultor, card de eletroposto e card não vendido recusados com a mesma resposta), o catálogo e o envio, o cadastro (validação
// por linha, percentual, o que falta), as ligações com a proposta e a venda (automática por telefone único, nunca só por nome,
// desligar não religa, unicidade dentro da trava), o dossiê da proposta ligada (aparece nos documentos e entra na leitura, sem
// copiar nada) e a leitura por IA por papel.

type Entrada = { erro?: unknown; saida?: unknown; parada?: string };
const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  csv: '',
  cards: [] as Array<Record<string, unknown>>,
  propostas: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  /** Bucket `fichas-docs`: caminho -> bytes. */
  objetos: new Map<string, Buffer>(),
  /** Bucket `cadastros-venda`: `vendasolar/<id>.json` e `vendasolar/<id>.docs.json`. */
  cad: new Map<string, Buffer>(),
  /** Bucket `dossie-vendas`: caminho -> bytes. */
  dossie: new Map<string, Buffer>(),
  baixados: [] as string[],
  assinados: [] as string[],
  /** Quantas vezes a lista de TODAS as propostas vendidas foi lida (a por telefone não conta). */
  listagens: 0,
  /** Derruba a leitura de propostas do Gerador: só o resumo (vínculo) ou só a geração. */
  falha: null as 'resumo' | 'geracao' | null,
  tique: 0,
  sig: 0,
  ia: { fila: [] as Entrada[], chamadas: [] as Array<{ corpo: any; opcoes: any }> },
  logs: [] as unknown[][],
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: (...a: unknown[]) => { h.logs.push(a); }, warn: (...a: unknown[]) => { h.logs.push(a); }, info: (...a: unknown[]) => { h.logs.push(a); },
  },
}));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      stream: (corpo: any, opcoes: unknown) => {
        h.ia.chamadas.push({ corpo, opcoes });
        const e = h.ia.fila.shift() ?? { erro: new Error('fila vazia') };
        return {
          finalMessage: async () => {
            if (e.erro) throw e.erro;
            const saida = typeof e.saida === 'function' ? (e.saida as (c: unknown) => unknown)(corpo?.messages?.[0]?.content) : e.saida;
            return { stop_reason: e.parada ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(saida) }] };
          },
        };
      },
    },
  }),
}));

/** `in`, `eq`, `like`, `order` e `range` do PostgREST, em cima de uma lista de linhas. */
function consulta(linhas: Array<Record<string, any>>, alias?: (r: Record<string, any>) => Record<string, any>, aoListar?: (porTelefone: boolean) => void) {
  const f: Record<string, unknown> = {};
  let sufixo = '';
  let em: string[] | null = null;
  const resultado = () => {
    let l = linhas.filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
    if (sufixo) l = l.filter((r) => String(r.dados?.telefoneDigitos ?? '').endsWith(sufixo));
    if (em) l = l.filter((r) => (em as string[]).includes(r.codigo));
    return alias ? l.map(alias) : l;
  };
  const b: any = {
    eq: (c: string, v: unknown) => { f[c] = v; return b; },
    like: (_c: string, p: string) => { sufixo = p.replace(/^%/, ''); return b; },
    order: () => b,
    in: async (_c: string, arr: string[]) => { em = arr; return { data: resultado(), error: null }; },
    range: async () => { aoListar?.(!!sufixo); return { data: resultado(), error: null }; },
    maybeSingle: async () => ({ data: resultado()[0] ?? null, error: null }),
  };
  return b;
}

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
      if (tabela === 'agendamentos') return { select: () => consulta(h.cards) };
      if (tabela === 'propostas') {
        return {
          select: (colunas = '') => consulta(h.propostas, (p) => {
            // `falha` simula o banco do Gerador caindo só na leitura do resumo (o vínculo) ou só na da geração.
            if (h.falha === 'resumo' && /vendido/.test(colunas)) throw new Error('banco fora do ar');
            if (h.falha === 'geracao' && /mediaMensalGerada/.test(colunas)) throw new Error('banco fora do ar');
            return {
              ...p, tel: p.dados?.telefoneDigitos ?? null, tel2: p.dados?.telefone ?? null,
              media: p.dados?.mediaMensalGerada ?? null, anual: p.dados?.geracaoAnualKwh ?? null,
              mensal: p.dados?.mensalKwh ?? null, consumo: p.dados?.consumoKwh ?? null,
            };
          }, (porTel) => { if (!porTel) h.listagens++; }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      getBucket: async (nome: string) => ({
        data: nome === 'cadastros-venda'
          ? { public: false, file_size_limit: 262144, allowed_mime_types: ['application/json'] }
          : { public: false, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
        error: null,
      }),
      createBucket: async () => ({ data: {}, error: null }),
      updateBucket: async () => ({ data: {}, error: null }),
      from: (nome: string) => {
        const cadastro = nome === 'cadastros-venda';
        const dossie = nome === 'dossie-vendas';
        const mapa = cadastro ? h.cad : dossie ? h.dossie : h.objetos;
        return {
          info: async (p: string) => {
            const t = mapa.get(p);
            return t === undefined
              ? { data: null, error: { message: 'Object not found', statusCode: '404' } }
              : { data: { id: 'o1', name: p, size: t.length, contentType: cadastro ? 'application/json' : p.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }, error: null };
          },
          download: async (p: string) => {
            if (dossie) h.baixados.push(p);
            const t = mapa.get(p);
            return t === undefined
              ? { data: null, error: { message: '{}', status: 400 } }
              : { data: { text: async () => t.toString('utf8'), arrayBuffer: async () => t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength) }, error: null };
          },
          upload: async (p: string, corpo: Buffer) => { mapa.set(p, Buffer.from(corpo)); return { data: { path: p }, error: null }; },
          remove: async (ps: string[]) => { for (const p of ps) mapa.delete(p); return { data: [], error: null }; },
          createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: 'https://up.test/u?x=1', token: 'tok-1', path: p }, error: null }),
          createSignedUrl: async (p: string) => {
            if (dossie) { h.assinados.push(p); return { data: { signedUrl: `https://dossie.test/s${++h.sig}` }, error: null }; }
            return { data: { signedUrl: `https://bytes.test/${encodeURIComponent(p)}` }, error: null };
          },
          createSignedUrls: async (ps: string[]) => ({
            data: ps.map((p) => (mapa.has(p) ? { path: p, signedUrl: `https://docs.test/s${++h.sig}`, error: null } : { path: p, signedUrl: null, error: 'Object not found' })),
            error: null,
          }),
        };
      },
    },
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-20T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => {
          const b: any = {
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
              const prefixo = p.replace(/\\/g, '').replace(/%$/, '');
              const chain: any = {
                order: () => chain,
                range: async () => ({
                  data: [...h.linhas.entries()].filter(([k]) => k.startsWith(prefixo)).sort(([a], [c]) => (a < c ? -1 : 1)).map(([k, l]) => ({ key: k, value: l.value })),
                  error: null,
                }),
              };
              return chain;
            },
          };
          return b;
        },
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: l.key.startsWith('cadastro_trava:') ? String(l.updated_at) : stamp() });
          return { error: null };
        },
        upsert: async (l: { key: string; value: unknown }) => { h.linhas.set(l.key, { value: l.value, updated_at: stamp() }); return { error: null }; },
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
        update: (novo: { value: unknown; updated_at: string }) => ({
          eq: (_c: string, k: string) => {
            const faz = (ok: (l: { updated_at: string }) => boolean) => ({
              select: async () => {
                const l = h.linhas.get(k);
                if (!l || !ok(l)) return { data: [], error: null };
                h.linhas.set(k, { value: novo.value, updated_at: stamp() });
                return { data: [{ key: k }], error: null };
              },
            });
            return { eq: (_c2: string, v: string) => faz((l) => l.updated_at === v), is: () => faz(() => false) };
          },
        }),
      };
    },
  },
}));

import { mountClientes, limparCacheClientes } from '../routes/geradorClientes';
import { mountClientesDocs } from '../routes/geradorClientesDocs';
import { mountCadastroVenda } from '../routes/geradorCadastroVenda';
import { mountVendaSolar } from '../routes/geradorVendaSolar';
import { limparCacheBucketDocs } from '../services/gerador/docsClienteBanco';
import { limparCacheBucketCadastros } from '../services/gerador/cadastroVendaBanco';
import * as hubReal from '../services/gerador/vendaSolarHub';
import { assinarLigacao, invalidarCachesHub, reiniciarLogsDoHub, type Ligacao } from '../services/gerador/vendaSolarHub';
import { SISTEMA_CADASTRO_SOLAR } from '../services/gerador/cadastroVendaLeitura';
import { CATALOGO } from '../services/gerador/docsCliente';

const CABECALHO: string[] = [
  'J49', 'NOME CLIENTE', 'NOME HOMOLOGAÇÃO', 'CONSULTOR', 'ORIGEM DO LEAD', 'VALOR DA VENDA', 'FORMA DE PAGTO', 'RECEBIDO REAL',
  'RECEBIMENTO', 'SISTEMA LIBERADO PELA CONCESSIONARIA', 'DEPOIMENTO INSTAGRAM', 'CONTATO', 'ENDEREÇO', 'CIDADE', 'UF',
  'ENTREGA DO MATERIAL', 'PREVISÃO DE MONTAGEM', 'DATA INICIO INSTALAÇÃO', 'DATA FINAL INSTALAÇÃO', 'QTD PLACA', 'MODELO PLACA',
  'POT PLACA', 'STATUS', 'QTD INV', 'MODELO E VOLTAGEM DO INVERSOR', 'MODELO INVERSOR', 'STATUS', 'TIPO ESTRUTURA', 'STATUS',
  'OUTRO EQUIP', 'CONTRATO COOPERATIVA', 'TEMPO DE CONTRATO COOP', 'OBS:', 'CADASTRO TRELLO', 'PAGTO ART', 'VALOR ART',
  'DATA EMISSÃO ULTIMO PARECER DE ACESSO', 'DATA PEDIDO DE VISTORIA', 'LIBERAÇÃO VISTORIA', 'ENGENHEIRO', 'EXCEDENTES',
  'CONCESSIONARIA', 'VALOR PAGO DO PROJETO', 'VALOR KIT', 'TAXAS/DESCONTOS', 'FATOR X', 'FORNECEDOR', 'AC - CC', 'EQUIPE',
  'PREVISÃO DE MONTAGEM', 'INCIO INSTALAÇÃO', 'FIM INSTALAÇÃO', 'KM INICIAL', 'KM FINAL', 'KM TOTAL',
  'M.O / PEÇAS/ ALIM / HOSP/PED', 'NF', 'COMISSÃO VENDA', 'PRÉ VENDA', 'TOTAL CUSTO', 'TOTAL LUCRO', '% DE LUCRO', 'COLUNA NOVA DA PLANILHA',
];
const SENT: Record<string, string> = { 'VALOR DA VENDA': 'R$ 8.887,77', 'RECEBIDO REAL': 'R$ 7.776,66', 'TOTAL LUCRO': 'R$ 2.345,67', OBS: 'x' };
function venda(codigo: string, campos: Record<string, string>): string[] {
  const l = new Array(CABECALHO.length).fill('');
  l[0] = codigo;
  for (const [nome, v] of Object.entries({ ...SENT, ...campos })) { const i = CABECALHO.indexOf(nome); if (i >= 0) l[i] = v; }
  return l;
}
const paraCsv = (linhas: string[][]) => [CABECALHO, ...linhas]
  .map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
const planilha = () => paraCsv([
  venda('#0057', { 'NOME CLIENTE': 'Ana Souza', CONSULTOR: 'Nilce', CONTATO: '34988880001', 'CADASTRO TRELLO': '03/08/2026', 'SISTEMA LIBERADO PELA CONCESSIONARIA': 'Liberado' }),
  venda('#0058', { 'NOME CLIENTE': 'Bruno Lima', CONSULTOR: 'Giovanna', CONTATO: '34977770002', 'CADASTRO TRELLO': '01/09/2026' }),
  venda('#0059', { 'NOME CLIENTE': 'Ana Souza Pereira', CONSULTOR: 'Nilce', 'CADASTRO TRELLO': '20/08/2026' }),
  venda('#0060', { 'NOME CLIENTE': 'Carla Dias', CONSULTOR: 'Nilce', CONTATO: '34999990003', 'CADASTRO TRELLO': '05/09/2026' }),
  venda('#0061', { 'NOME CLIENTE': 'Bruno Lima', CONSULTOR: 'Giovanna', CONTATO: '34977770002', 'CADASTRO TRELLO': '06/09/2026' }),
]);

const r = Router();
mountClientes(r);
mountClientesDocs(r);
mountCadastroVenda(r);
mountVendaSolar(r);
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PDF = Buffer.from('%PDF-1.4\nconta de luz de teste\n%%EOF');
const PDF2 = Buffer.from('%PDF-1.4\ndocumento do dossie\n%%EOF');

const card = (id: number, o: Record<string, unknown>) => ({
  id, cliente_nome: 'Fulano', cliente_telefone: '', cidade: '', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-09-10T15:00:00.000Z', ...o,
});
const arquivosDossie = (extra: Record<string, unknown[]> = {}) => ({
  dossie: {
    versao: 1, atualizado_em: 'x', campos: {}, trello: {},
    arquivos: {
      documento: [{ path: 'P1/documento-1.pdf', nome: 'CNH-ANA-SOUZA.pdf', tipo: 'application/pdf', bytes: PDF2.length, em: '2026-08-01T00:00:00.000Z', trello_status: 'pendente' }],
      conta_luz: [{ path: 'P1/conta_luz-2.jpg', nome: 'luz-da-ana.jpg', tipo: 'image/jpg', bytes: JPG.length, em: '2026-08-01T00:00:00.000Z', trello_status: 'pendente' }],
      fachada: [{ path: 'P1/fachada-3.jpg', nome: 'casa.jpg', tipo: 'image/jpeg', bytes: JPG.length, em: '2026-08-01T00:00:00.000Z', trello_status: 'pendente' }],
      padrao: [{ path: 'OUTRA/padrao-9.jpg', nome: 'injetado.jpg', tipo: 'image/jpeg', bytes: JPG.length, em: 'x', trello_status: 'pendente' }],
      medidor: [{ path: 'P1/medidor-4.heic', nome: 'rel.heic', tipo: 'image/heic', bytes: 10, em: 'x', trello_status: 'pendente' }],
      ...extra,
    },
  },
});
const prop = (codigo: string, nome: string, o: Record<string, unknown> = {}) => ({
  codigo, cliente_nome: nome, consultor_nome: 'Nilce', cliente_cidade: 'Uberlandia', cliente_uf: 'MG', vendido: true, kwp: 8.8, tipo: 'solar',
  created_at: '2026-08-01T10:00:00.000Z', dados: {}, ...o,
});

const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);
const post = (url: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const put = (url: string, corpo: unknown, auth = NILCE) => request(app).put(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const del = (url: string, auth = NILCE) => request(app).delete(`/gerador${url}`).set('Authorization', auth);
const docs = (id: number, auth = NILCE) => get(`/clientes/vendasolar/${id}/docs`, auth);
const vinculos = (id: number, auth = NILCE) => get(`/vendas-solares/${id}/vinculos`, auth);
const ligar = (id: number, corpo: unknown, auth = NILCE) => post(`/vendas-solares/${id}/vinculos`, corpo, auth);
const ligacao = (id: number) => h.linhas.get(`venda_solar:${id}`)?.value as { proposta: string | null; venda: string | null; por: string; em: string } | undefined;
/** Escreve direto no system_state, como alguém com a chave pública faria. `sig`: 'certa' (assinada pelo servidor), 'torta', ou ausente. */
const injeta = (id: number, lig: Partial<Ligacao>, sig: 'certa' | 'torta' | 'nenhuma' = 'certa') => {
  const l: Ligacao = { proposta: null, venda: null, por: 'x', em: '2026-10-20T10:00:00.000Z', ...lig };
  const value = sig === 'nenhuma' ? l : { ...l, sig: sig === 'certa' ? assinarLigacao(id, l) : 'ab'.repeat(32) };
  h.linhas.set(`venda_solar:${id}`, { updated_at: 'x', value });
};
const cadastroDe = (id: number) => JSON.parse(h.cad.get(`vendasolar/${id}.json`)?.toString('utf8') ?? '{"campos":{},"alteracoes":[]}');
const anexa = (id: number, arquivos: Array<{ slot: string; uuid: string; ext: string; mime: string; bytes: number; em: string }>) => {
  h.linhas.set(`docs_cliente:vendasolar:${id}`, {
    updated_at: 'd0',
    value: {
      arquivos: arquivos.map((a, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, slot: a.slot, caminho: `vendasolar/${id}/${a.uuid}.${a.ext}`, mime: a.mime, bytes: a.bytes, em: a.em, por: 'nilce' })),
      alteracoes: [], apagados: [],
    },
  });
};

beforeEach(() => {
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app' };
  h.csv = planilha();
  h.cards = [
    card(201, { cliente_nome: 'Ana Souza', cliente_telefone: '(34) 98888-0001' }),
    card(202, { cliente_nome: 'Dora Eletroposto', created_by: 'lp_eletroposto' }),
    card(203, { cliente_nome: 'Fabio Agendado', status: 'agendado' }),
    card(204, { cliente_nome: 'Bruno Lima', cliente_telefone: '(34) 97777-0002', vendedor_nome: 'Giovanna' }),
    card(205, { cliente_nome: 'Ana Souza Pereira' }),
    card(206, { cliente_nome: 'Ana Souza', cliente_telefone: '34988880001' }),
    card(207, { cliente_nome: 'Carla Dias', cliente_telefone: '34 99999-0003' }),
  ];
  h.propostas = [
    prop('P1', 'Ana Souza', { dados: { telefoneDigitos: '34988880001', ...arquivosDossie() } }),
    prop('P2', 'Ana Souza', { vendido: false, dados: { telefoneDigitos: '34988880001' } }),
    prop('P3', 'Bruno Lima', { consultor_nome: 'Giovanna', dados: { telefoneDigitos: '34977770002' } }),
    prop('P4', 'Bruno Lima', { consultor_nome: 'Giovanna', dados: { telefoneDigitos: '34977770002' } }),
    prop('P5', 'Carla Dias', { dados: { telefoneDigitos: '34999990003' } }),
    prop('P6', 'Ana Souza Pereira', { kwp: 5, dados: {} }),
    prop('P7', 'Ana Souza', { tipo: 'eletroposto', kwp: null, dados: { telefoneDigitos: '34988880001' } }),
  ];
  h.linhas = new Map();
  h.objetos = new Map(); h.cad = new Map(); h.dossie = new Map();
  h.dossie.set('P1/documento-1.pdf', PDF2);
  h.dossie.set('P1/conta_luz-2.jpg', JPG);
  h.baixados = []; h.assinados = []; h.listagens = 0;
  h.tique = 0; h.sig = 0;
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-servico-falsa-do-teste';
  delete process.env.VINCULO_SOLAR_SECRET;
  invalidarCachesHub(); reiniciarLogsDoHub();
  h.ia.fila = []; h.ia.chamadas = [];
  h.logs = [];
  h.falha = null;
  delete process.env.SOLAR_SOCIOS;
  delete process.env.CADASTRO_IA_MODELO;
  limparCacheClientes(); limparCacheBucketDocs(); limparCacheBucketCadastros();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T15:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('docs.google.com')) return new Response(h.csv, { status: 200 });
    if (String(url).startsWith('https://bytes.test/')) return new Response(new Uint8Array(JPG.subarray(0, 16)), { status: 206 });
    throw new Error('rede indisponível no teste');
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('guarda da linha vendasolar', () => {
  it('o vendedor do card e o sócio entram; outro consultor, card de eletroposto, card não vendido e inexistente respondem 404 IGUAL', async () => {
    const ok = await docs(201);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect((await docs(201, THIAGO)).status).toBe(200);
    const alheia = await docs(201, GIOVANNA);
    expect(alheia.status).toBe(404);
    for (const id of [202, 203, 999]) {
      const x = await docs(id, THIAGO);
      expect(x.status).toBe(404);
      expect(x.body).toEqual(alheia.body);
    }
    expect((await get('/clientes/vendasolar/abc/docs')).status).toBe(400);
    expect((await get('/clientes/vendasolar/0/docs')).status).toBe(400);
    expect((await request(app).get('/gerador/clientes/vendasolar/201/docs')).status).toBe(401);
    // a mesma guarda vale para o cadastro, a leitura e o relatório
    expect((await get('/clientes/vendasolar/201/cadastro', GIOVANNA)).status).toBe(404);
    expect((await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'X' } }, GIOVANNA)).status).toBe(404);
    expect((await post('/clientes/vendasolar/201/cadastro/ler', {}, GIOVANNA)).status).toBe(404);
    expect((await get('/clientes/vendasolar/202/relatorio', THIAGO)).status).toBe(404);
    expect(h.cad.size).toBe(0);
  });
  it('o consultor da venda da planilha ligada ao card passa; o consultor de OUTRA venda não', async () => {
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    // sócio liga o card à venda da Giovanna (#0058): ela passa a ver o card; a Nilce segue vendo (é a vendedora)
    expect((await ligar(201, { venda: '#0058' }, THIAGO)).status).toBe(200);
    expect((await docs(201, GIOVANNA)).status).toBe(200);
    expect((await docs(201)).status).toBe(200);
    // ligada à venda da Nilce, a Giovanna volta a ser recusada
    expect((await ligar(201, { venda: '#0057' }, THIAGO)).status).toBe(200);
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    expect((await get('/clientes/vendasolar/201/cadastro', GIOVANNA)).status).toBe(404);
  });
  it('planilha fora do ar não barra o próprio vendedor do card', async () => {
    h.csv = '';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede caiu'); }));
    limparCacheClientes();
    expect((await docs(201)).status).toBe(200);
    expect((await docs(201, THIAGO)).status).toBe(200);
  });
});

describe('catálogo e envio', () => {
  it('a lista devolve o catálogo da vendasolar e o dossiê vazio quando não há proposta ligada', async () => {
    const res = await docs(201);
    expect(res.body.slots.map((s: any) => s.chave)).toEqual(CATALOGO.vendasolar.map((s) => s.chave));
    expect(res.body.slots.find((s: any) => s.chave === 'fachada')).toMatchObject({ aceita: 'imagem', obrigatorio: true, varios: false });
    expect(res.body.slots.find((s: any) => s.chave === 'conta_luz_beneficiaria')).toMatchObject({ aceita: 'ambos', obrigatorio: false, varios: true });
    expect(res.body.arquivos).toEqual([]);
    expect(res.body.dossie).toBeNull();
    expect(res.body.vinculo).toBeNull();
    expect(res.body.pode_remover).toBe(true);
  });
  it('envio: o item da linha, o formato do item, o caminho do servidor, desta venda; remove e rotula como nas outras linhas', async () => {
    expect((await post('/clientes/vendasolar/201/docs/upload-url', { slot: 'art', mime: 'application/pdf', bytes: 10 })).status).toBe(400);    // item do eletroposto/solar, não desta linha
    expect((await post('/clientes/vendasolar/201/docs/upload-url', { slot: 'fachada', mime: 'application/pdf', bytes: 10 })).status).toBe(400);   // foto só imagem
    const u = await post('/clientes/vendasolar/201/docs/upload-url', { slot: 'documento_titular_uc', mime: 'image/jpeg', bytes: JPG.length });
    expect(u.status).toBe(200);
    expect(u.body.caminho).toMatch(/^vendasolar\/201\/[0-9a-f-]{36}\.jpg$/);
    h.objetos.set(u.body.caminho, JPG);
    // caminho de outro card ou de outra linha: recusado
    expect((await post('/clientes/vendasolar/201/docs', { slot: 'documento_titular_uc', caminho: `vendasolar/204/${U1}.jpg` })).status).toBe(400);
    expect((await post('/clientes/vendasolar/201/docs', { slot: 'documento_titular_uc', caminho: `eletroposto/201/${U1}.jpg` })).status).toBe(400);
    const reg = await post('/clientes/vendasolar/201/docs', { slot: 'documento_titular_uc', caminho: u.body.caminho });
    expect(reg.status).toBe(200);
    expect(reg.body.arquivo).toMatchObject({ slot: 'documento_titular_uc', mime: 'image/jpeg' });
    const chave = h.linhas.get('docs_cliente:vendasolar:201')!.value as { arquivos: any[] };
    expect(chave.arquivos).toHaveLength(1);
    expect(JSON.stringify(chave)).not.toMatch(/Ana|CNH/);
    // item de um só arquivo ocupado
    expect((await post('/clientes/vendasolar/201/docs/upload-url', { slot: 'documento_titular_uc', mime: 'image/jpeg', bytes: 5 })).status).toBe(409);
    // mover entre itens da linha, renomear, remover
    const id = chave.arquivos[0].id;
    expect((await request(app).patch(`/gerador/clientes/vendasolar/201/docs/${id}`).set('Authorization', NILCE).send({ slot: 'documento_titular', rotulo: 'CNH da Ana' })).status).toBe(200);
    expect((await docs(201)).body.arquivos[0]).toMatchObject({ slot: 'documento_titular', rotulo: 'CNH da Ana', rotulo_fonte: 'manual' });
    expect(h.cad.has('vendasolar/201.docs.json')).toBe(true);
    expect((await del(`/clientes/vendasolar/201/docs/${id}`)).status).toBe(200);
    expect((await docs(201)).body.arquivos).toEqual([]);
  });
});

describe('cadastro da vendasolar', () => {
  it('GET sem cadastro: o comprador e a unidade geradora faltam; nenhum papel extra', async () => {
    const res = await get('/clientes/vendasolar/201/cadastro');
    expect(res.status).toBe(200);
    expect(res.body.cadastro.campos).toEqual({});
    expect(res.body.cadastro.tipo).toBe('PF');
    expect(res.body.cadastro.faltando).toEqual(expect.arrayContaining(['nome', 'cpf_cnpj', 'endereco_ponto', 'unidade_consumidora', 'concessionaria']));
    expect(res.body.cadastro.faltando.some((k: string) => /^(tuc|aval|imovel|benef|ced)_/.test(k))).toBe(false);
  });
  it('PUT grava formatado em vendasolar/<id>.json (nunca em eletroposto/ nem no system_state)', async () => {
    const res = await put('/clientes/vendasolar/201/cadastro', { campos: {
      nome: 'Ana Souza', cpf_cnpj: '52998224725', unidade_consumidora: '0012345678', uc_classe: 'Poder Público', consumo_medio_kwh: '1.250,5',
      tuc_nome: 'Maria Souza', tuc_cpf_cnpj: '52998224725', tuc_relacao: 'Pai/Mãe', benef_1_uc: '0098765432', benef_1_pct: '33,5',
    } });
    expect(res.status).toBe(200);
    const v = res.body.cadastro.valores;
    expect(v).toMatchObject({ cpf_cnpj: '529.982.247-25', uc_classe: 'poder_publico', consumo_medio_kwh: '1250.5', tuc_relacao: 'pai_mae', benef_1_pct: '33.5', tipo: 'PF' });
    expect(res.body.cadastro.campos.tuc_nome).toMatchObject({ valor: 'Maria Souza', por: 'nilce', fonte: 'manual' });
    expect(cadastroDe(201).campos.consumo_medio_kwh.valor).toBe('1250.5');
    expect([...h.cad.keys()].every((k) => k.startsWith('vendasolar/'))).toBe(true);
    expect([...h.linhas.keys()].some((k) => k.startsWith('cadastro') && !k.startsWith('cadastro_trava:'))).toBe(false);
    expect(JSON.stringify(cadastroDe(201).alteracoes)).not.toMatch(/Maria|52998224725|0012345678/);
    expect((await get('/clientes/vendasolar/201/cadastro')).body.cadastro.valores.tuc_nome).toBe('Maria Souza');
    // o mesmo card no eletroposto não enxerga nada disso (outra pasta)
    expect(h.cad.has('eletroposto/201.json')).toBe(false);
  });
  it('o que falta: titular da homologação só com homologacao_mesmo = outra_pessoa; beneficiária só depois de começada', async () => {
    const res = await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: 'Maria', homologacao_mesmo: 'outra_pessoa', benef_2_uc: '0098765432' } });
    const f: string[] = res.body.cadastro.faltando;
    expect(f).toEqual(expect.arrayContaining(['tuc_cpf_cnpj', 'tuc_relacao', 'benef_2_titular', 'benef_2_pct']));
    expect(f).not.toContain('benef_1_uc');
    expect(f).not.toContain('tuc_nome');
    expect(f).not.toContain('aval_nome');
  });
  it('PUT inválido: 400 com os erros por campo e NADA é gravado; campo da outra linha é desconhecido', async () => {
    const ruim = await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'Ana', benef_1_pct: '101', benef_6_uc: 'x', ced_nome: 'Cedente', consumo_medio_kwh: '0', uc_classe: 'lua', tuc_relacao: 'vizinho' } });
    expect(ruim.status).toBe(400);
    expect(ruim.body.erros).toMatchObject({ benef_1_pct: expect.any(String), benef_6_uc: 'Campo desconhecido.', ced_nome: 'Campo desconhecido.', consumo_medio_kwh: expect.any(String), uc_classe: expect.any(String), tuc_relacao: expect.any(String) });
    expect(ruim.body.erros.nome).toBeUndefined();
    expect(h.cad.size).toBe(0);
  });
  it('o eletroposto recusa tuc_* e benef_*, e a vendasolar recusa ced_* (um teste para cada lado)', async () => {
    // card 202 é de eletroposto: a rota do eletroposto o aceita (a guarda é a da ficha) e recusa os campos da venda solar
    const ep = await put('/clientes/eletroposto/202/cadastro', { campos: { tuc_nome: 'X', benef_1_uc: '1', uc_classe: 'rural', consumo_medio_kwh: '5' } });
    expect(ep.status).toBe(400);
    expect(Object.keys(ep.body.erros).sort()).toEqual(['benef_1_uc', 'consumo_medio_kwh', 'tuc_nome', 'uc_classe']);
    expect(Object.values(ep.body.erros)).toEqual(['Campo desconhecido.', 'Campo desconhecido.', 'Campo desconhecido.', 'Campo desconhecido.']);
    expect(h.cad.size).toBe(0);
    // e o card de eletroposto não existe para a rota da venda solar
    expect((await put('/clientes/vendasolar/202/cadastro', { campos: { nome: 'X' } })).status).toBe(404);
    // `solar` (a venda da planilha) não tem cadastro
    expect((await get('/clientes/solar/57/cadastro')).status).toBe(404);
    const sol = await put('/clientes/vendasolar/201/cadastro', { campos: { ced_cpf_cnpj: '52998224725' } });
    expect(sol.status).toBe(400);
    expect(h.cad.size).toBe(0);
  });
});

describe('negociador, contratante, titular da homologação e do financiamento', () => {
  const gestao = (codigo: string) => h.linhas.get(`gestao_cliente:${codigo}`)?.value as
    { campos: Record<string, { valor: string; por: string; em: string }>; alteracoes: Array<{ coluna: string; antes: unknown; por: string }> } | undefined;
  const homologacao = (codigo = '0057') => gestao(codigo)?.campos?.homologacao;
  /** A planilha mãe com o "Nome na homologação" da #0057 já escrito no CSV (como se alguém tivesse digitado lá). */
  const csvComHomologacao = (nome: string) => {
    h.csv = paraCsv([venda('#0057', { 'NOME CLIENTE': 'Ana Souza', 'NOME HOMOLOGAÇÃO': nome, CONSULTOR: 'Nilce', CONTATO: '34988880001', 'CADASTRO TRELLO': '03/08/2026' })]);
    limparCacheClientes();
  };
  const gravaTuc = (nome: string) => put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: nome } });

  it('o GET devolve o negociador (o nome do card), só leitura: o cadastro grava outros nomes e o card fica como está', async () => {
    expect((await get('/clientes/vendasolar/201/cadastro')).body.negociador).toBe('Ana Souza');
    const res = await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'Pedro Contratante', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Maria Souza', financiamento_mesmo: 'outra_pessoa', fin_nome: 'Joao Banco' } });
    expect(res.status).toBe(200);
    expect(res.body.negociador).toBe('Ana Souza');
    const g = await get('/clientes/vendasolar/201/cadastro');
    expect(g.body.negociador).toBe('Ana Souza');
    expect(g.body.cadastro.valores).toMatchObject({ nome: 'Pedro Contratante', tuc_nome: 'Maria Souza', fin_nome: 'Joao Banco', homologacao_mesmo: 'outra_pessoa', financiamento_mesmo: 'outra_pessoa' });
    expect(h.cards.find((c) => c.id === 201)!.cliente_nome).toBe('Ana Souza');
    // o `negociador` não é campo: tentar gravá-lo é campo desconhecido
    const ruim = await put('/clientes/vendasolar/201/cadastro', { campos: { negociador: 'Outro' } });
    expect(ruim.status).toBe(400);
    expect(ruim.body.erros.negociador).toBe('Campo desconhecido.');
  });
  it('o eletroposto não recebe nada disto: sem negociador, e fin_* e *_mesmo são campos desconhecidos', async () => {
    const g = await get('/clientes/eletroposto/202/cadastro', THIAGO);
    expect(g.status).toBe(200);
    expect(g.body.negociador).toBeUndefined();
    const p = await put('/clientes/eletroposto/202/cadastro', { campos: { fin_nome: 'X', homologacao_mesmo: 'contratante', financiamento_mesmo: 'contratante' } }, THIAGO);
    expect(p.status).toBe(400);
    expect(p.body.erros).toMatchObject({ fin_nome: 'Campo desconhecido.', homologacao_mesmo: 'Campo desconhecido.', financiamento_mesmo: 'Campo desconhecido.' });
    expect(h.cad.has('eletroposto/202.json')).toBe(false);
    const ok = await put('/clientes/eletroposto/202/cadastro', { campos: { nome: 'Dora' } }, THIAGO);
    expect(ok.status).toBe(200);
    expect(ok.body.negociador).toBeUndefined();
    expect(gestao('0057')).toBeUndefined();
  });
  it('fin_* valida e o faltando segue o *_mesmo; "contratante" esvazia o papel e o que veio junto no pedido', async () => {
    const ruim = await put('/clientes/vendasolar/201/cadastro', { campos: { fin_cpf_cnpj: '111', fin_uf: 'XX', financiamento_mesmo: 'amigo' } });
    expect(ruim.status).toBe(400);
    expect(Object.keys(ruim.body.erros).sort()).toEqual(['fin_cpf_cnpj', 'fin_uf', 'financiamento_mesmo']);
    expect(h.cad.size).toBe(0);
    const a = await put('/clientes/vendasolar/201/cadastro', { campos: { financiamento_mesmo: 'outra_pessoa', fin_nome: 'Joao Banco', fin_cpf_cnpj: '52998224725' } });
    expect(a.body.cadastro.valores.fin_cpf_cnpj).toBe('529.982.247-25');
    expect(a.body.cadastro.faltando).toEqual(expect.arrayContaining(['fin_endereco', 'fin_cep', 'fin_rg_ie']));
    expect(a.body.cadastro.faltando).not.toContain('fin_nome');
    const b = await put('/clientes/vendasolar/201/cadastro', { campos: { financiamento_mesmo: 'contratante', fin_nome: 'Joao Banco' } });
    expect(b.status).toBe(200);
    expect(b.body.cadastro.valores.financiamento_mesmo).toBe('contratante');
    expect(b.body.cadastro.valores.fin_nome).toBeUndefined();                 // saiu, e o fin_nome do mesmo pedido perdeu
    expect(b.body.cadastro.valores.fin_cpf_cnpj).toBeUndefined();
    expect(b.body.cadastro.faltando.some((k: string) => k.startsWith('fin_'))).toBe(false);
    expect(cadastroDe(201).campos.fin_cpf_cnpj).toBeUndefined();
    expect(JSON.stringify(cadastroDe(201).alteracoes)).not.toMatch(/Joao|52998224725/);   // a trilha guarda o campo, nunca o valor
  });
  it('planilha mãe: o nome do titular da homologação vai para a coluna "Nome na homologação" da venda ligada, só o nome', async () => {
    await ligar(201, { venda: '#0057' });
    const r = await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: 'Maria Souza', tuc_cpf_cnpj: '52998224725', tuc_endereco: 'Rua A, 10' } });
    expect(r.status).toBe(200);
    expect(r.body.aviso).toBeUndefined();
    expect(homologacao()).toMatchObject({ valor: 'Maria Souza', por: 'nilce' });
    expect(gestao('0057')!.alteracoes[gestao('0057')!.alteracoes.length - 1]).toMatchObject({ coluna: 'homologacao', antes: null, por: 'nilce' });   // a trilha da Planilha do Cliente
    expect(JSON.stringify(gestao('0057'))).not.toMatch(/529|Rua A/);       // nada de CPF nem endereço na planilha
    expect(Object.keys(gestao('0057')!.campos)).toEqual(['homologacao']);    // só a coluna do nome; o `cliente` da planilha não é tocado
  });
  it('planilha mãe: o nome que esta via escreveu acompanha a troca; o contratante vira o nome quando homologacao_mesmo = contratante', async () => {
    await ligar(201, { venda: '#0057' });
    await gravaTuc('Maria Souza');
    expect(homologacao()!.valor).toBe('Maria Souza');
    await gravaTuc('Maria Souza Lima');
    expect(homologacao()!.valor).toBe('Maria Souza Lima');
    expect(gestao('0057')!.alteracoes.filter((a) => a.coluna === 'homologacao')).toHaveLength(2);
    const igual = await gravaTuc('MARIA SOUZA LIMA');                         // o mesmo nome (sem acento e caixa): nada a gravar
    expect(igual.status).toBe(200);
    expect(gestao('0057')!.alteracoes.filter((a) => a.coluna === 'homologacao')).toHaveLength(2);
    const c = await put('/clientes/vendasolar/201/cadastro', { campos: { homologacao_mesmo: 'contratante', nome: 'Pedro Contratante' } });
    expect(c.body.cadastro.valores.tuc_nome).toBeUndefined();                 // "contratante" esvaziou o titular da homologação
    expect(homologacao()!.valor).toBe('Pedro Contratante');
    const d = await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'Pedro C. Contratante' } });   // o contratante muda de nome: a planilha segue
    expect(d.status).toBe(200);
    expect(homologacao()!.valor).toBe('Pedro C. Contratante');
    const sem = await put('/clientes/vendasolar/201/cadastro', { campos: { email: 'a@b.com' } });             // nada ligado ao nome: a planilha não é tocada
    expect(sem.status).toBe(200);
    expect(gestao('0057')!.alteracoes.filter((a) => a.coluna === 'homologacao')).toHaveLength(4);
  });
  it('planilha mãe: não sobrescreve o que alguém digitou, na planilha nem na Planilha do Cliente', async () => {
    csvComHomologacao('Digitado Na Planilha');
    await ligar(201, { venda: '#0057' });
    const a = await gravaTuc('Maria Souza');
    expect(a.status).toBe(200);
    expect(a.body.aviso).toBeUndefined();
    expect(gestao('0057')).toBeUndefined();                                   // o CSV tinha valor: nada gravado
    expect(cadastroDe(201).campos.tuc_nome.valor).toBe('Maria Souza');        // e o cadastro valeu
    // agora vazio na planilha: a via escreve; depois a Giovanna digita por cima na Planilha do Cliente e a via respeita
    csvComHomologacao('');
    await gravaTuc('Joana Souza');
    expect(homologacao()!.valor).toBe('Joana Souza');
    h.linhas.set('gestao_cliente:0057', {
      updated_at: 'g1',
      value: { campos: { homologacao: { valor: 'Joana Digitada', por: 'giovanna', em: '2026-10-20T14:00:00.000Z' } }, alteracoes: [{ em: '2026-10-20T14:00:00.000Z', por: 'giovanna', coluna: 'homologacao', antes: 'Joana Souza' }], em: '2026-10-20T14:00:00.000Z' },
    });
    await gravaTuc('Terceira Pessoa');
    expect(homologacao()).toMatchObject({ valor: 'Joana Digitada', por: 'giovanna' });
    expect(cadastroDe(201).campos.tuc_nome.valor).toBe('Terceira Pessoa');
  });
  it('planilha mãe: sem venda ligada, sem nome, ou pedido que não mexe no nome, não escreve nada', async () => {
    await gravaTuc('Maria Souza');                                            // sem ligação
    expect(gestao('0057')).toBeUndefined();
    await ligar(201, { venda: '#0057' });
    await put('/clientes/vendasolar/201/cadastro', { campos: { telefone: '34988880001', cidade: 'Uberlandia' } });   // não mexe em tuc_nome, nome nem homologacao_mesmo
    expect(gestao('0057')).toBeUndefined();
    const vazio = await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: '' } });   // apagar o nome nunca grava vazio
    expect(vazio.status).toBe(200);
    expect(gestao('0057')).toBeUndefined();
  });
  it('planilha mãe: decide com a planilha FRESCA: cache dizendo vazio e planilha com nome digitado não grava', async () => {
    await ligar(201, { venda: '#0057' });                                     // o cache da planilha agora diz "vazio"
    h.csv = paraCsv([venda('#0057', { 'NOME CLIENTE': 'Ana Souza', 'NOME HOMOLOGAÇÃO': 'Digitado Agora', CONSULTOR: 'Nilce', CONTATO: '34988880001', 'CADASTRO TRELLO': '03/08/2026' })]);
    const r = await gravaTuc('Maria Souza');                                  // sem limpar o cache
    expect(r.status).toBe(200);
    expect(r.body.aviso).toBeUndefined();
    expect(gestao('0057')).toBeUndefined();
    expect(cadastroDe(201).campos.tuc_nome.valor).toBe('Maria Souza');
  });
  it('planilha mãe: planilha fora do ar com cópia no cache NÃO escreve (a cópia velha não decide), e avisa', async () => {
    await ligar(201, { venda: '#0057' });                                     // há cópia no cache
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 500 })));
    const r = await gravaTuc('Maria Souza');
    expect(r.status).toBe(200);
    expect(r.body.aviso).toBe('Salvo. Não consegui conferir a planilha agora; o nome da homologação não foi copiado.');
    expect(gestao('0057')).toBeUndefined();
    expect(cadastroDe(201).campos.tuc_nome.valor).toBe('Maria Souza');
  });
  it('planilha mãe: quem grava precisa enxergar a venda ligada: o vendedor do card A ligado à venda da consultora B não escreve nela; sócio escreve', async () => {
    injeta(201, { venda: '#0058' });                                          // card da Nilce ligado à venda da Giovanna (ligação antiga ou injetada)
    invalidarCachesHub();
    const a = await gravaTuc('Maria Souza');
    expect(a.status).toBe(200);
    expect(a.body.aviso).toBe('Salvo. Você não tem acesso à venda ligada na planilha; o nome da homologação não foi copiado.');
    expect(gestao('0058')).toBeUndefined();
    expect(cadastroDe(201).campos.tuc_nome.valor).toBe('Maria Souza');        // o cadastro valeu
    const s = await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: 'Maria Souza Lima' } }, THIAGO);
    expect(s.body.aviso).toBeUndefined();
    expect(gestao('0058')!.campos.homologacao).toMatchObject({ valor: 'Maria Souza Lima', por: 'thiago' });
  });
  it('contratante gravado: tuc_*/fin_* novos são ignorados, a não ser que o mesmo pedido mude o *_mesmo para outra_pessoa', async () => {
    await put('/clientes/vendasolar/201/cadastro', { campos: { homologacao_mesmo: 'contratante', financiamento_mesmo: 'contratante', nome: 'Pedro Contratante' } });
    const a = await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: 'Maria Souza', fin_nome: 'Joao Banco', fin_cpf_cnpj: '52998224725' } });
    expect(a.status).toBe(200);
    expect(a.body.cadastro.valores.tuc_nome).toBeUndefined();
    expect(a.body.cadastro.valores.fin_nome).toBeUndefined();
    expect(cadastroDe(201).campos.tuc_nome).toBeUndefined();
    expect(cadastroDe(201).campos.fin_cpf_cnpj).toBeUndefined();
    expect(a.body.cadastro.faltando.some((k: string) => /^(tuc|fin)_/.test(k))).toBe(false);
    const b = await put('/clientes/vendasolar/201/cadastro', { campos: { homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Maria Souza' } });
    expect(b.body.cadastro.valores).toMatchObject({ homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Maria Souza', financiamento_mesmo: 'contratante' });
    const c = await put('/clientes/vendasolar/201/cadastro', { campos: { fin_nome: 'Joao Banco' } });       // o financiamento segue "contratante"
    expect(c.body.cadastro.valores.fin_nome).toBeUndefined();
    const d = await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: 'Maria Lima' } });         // e a homologação, agora outra pessoa, aceita
    expect(d.body.cadastro.valores.tuc_nome).toBe('Maria Lima');
  });
  it('planilha mãe: falha na planilha ou no banco não derruba o PUT, vai num aviso; a venda sem a coluna também avisa', async () => {
    await ligar(201, { venda: '#0057' });
    limparCacheClientes();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 500 })));
    const r = await gravaTuc('Maria Souza');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.aviso).toBe('Salvo. Não consegui conferir a planilha agora; o nome da homologação não foi copiado.');
    expect(r.body.cadastro.valores.tuc_nome).toBe('Maria Souza');
    expect(cadastroDe(201).campos.tuc_nome.valor).toBe('Maria Souza');
    expect(gestao('0057')).toBeUndefined();
    expect(JSON.stringify(h.logs)).not.toContain('Maria Souza');
    // volta o ar: a próxima gravação do nome escreve
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('docs.google.com') ? new Response(h.csv, { status: 200 }) : new Response('', { status: 404 }))));
    limparCacheClientes();
    const ok = await gravaTuc('Maria Souza Lima');
    expect(ok.body.aviso).toBeUndefined();
    expect(homologacao()!.valor).toBe('Maria Souza Lima');
    // a venda ligada que sumiu da planilha
    injeta(201, { ...ligacao(201), venda: '#0099' });
    invalidarCachesHub();
    const sumiu = await gravaTuc('Outra Maria');
    expect(sumiu.status).toBe(200);
    expect(sumiu.body.aviso).toMatch(/Não achei a venda ligada/);
  });
});

describe('análise do rateio e do consumo (cadastro da vendasolar)', () => {
  // Formato real do gerador: `mensalKwh` é o array de 12 gerações mensais e `consumoKwh` é o consumo informado.
  const DOZE = (media: number) => new Array(12).fill(media);
  const comGeracao = (g: { mediaMensalGerada?: unknown; geracaoAnualKwh?: unknown; mensalKwh?: unknown; consumoKwh?: unknown }) => {
    h.propostas = h.propostas.map((p) => (p.codigo === 'P1' ? { ...p, dados: { ...p.dados, ...g } } : p));
  };
  it('GET sem proposta ligada: rateio zerado e consumo sem comparação', async () => {
    const res = await get('/clientes/vendasolar/201/cadastro');
    expect(res.status).toBe(200);
    expect(res.body.analise.rateio).toEqual({ soma: 0, bloqueios: [], avisos: [] });
    expect(res.body.analise.consumo).toMatchObject({ base: null, proposta_kwh: null, aviso: null });
  });
  it('PUT grava mesmo com bloqueio (101%) e devolve a análise com o bloqueio', async () => {
    const res = await put('/clientes/vendasolar/201/cadastro', { campos: { geradora_pct: '60', benef_1_uc: '0098765432', benef_1_pct: '41' } });
    expect(res.status).toBe(200);
    expect(res.body.analise.rateio.soma).toBe(101);
    expect(res.body.analise.rateio.bloqueios.join(' ')).toMatch(/não pode passar de 100%/);
    expect(cadastroDe(201).campos.benef_1_pct.valor).toBe('41');   // gravou
    expect((await get('/clientes/vendasolar/201/cadastro')).body.analise.rateio.bloqueios).toHaveLength(1);
  });
  it('proposta ligada: usa a média gerada antes da anual; 80% e 140% avisam, 100% não', async () => {
    comGeracao({ mediaMensalGerada: 800, mensalKwh: DOZE(700), geracaoAnualKwh: 12000, consumoKwh: 500 });
    expect((await ligar(201, { proposta: 'P1' })).status).toBe(200);
    const baixo = await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '1000' } });
    expect(baixo.body.analise.consumo).toMatchObject({ base: 'proposta_media_gerada', proposta_kwh: 800, conta_kwh: 1000 });
    expect(baixo.body.analise.consumo.aviso).toBe('O sistema da proposta gera 800 kWh/mês e a conta mostra 1.000 kWh/mês de consumo. Confira o dimensionamento.');
    const alto = await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '571,43' } });   // 800 / 571,43 = 140%
    expect(alto.body.analise.consumo.aviso).toMatch(/Confira o dimensionamento/);
    const certo = await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '800' } });
    expect(certo.body.analise.consumo.aviso).toBeNull();
    // o GET repete a mesma análise
    expect((await get('/clientes/vendasolar/201/cadastro')).body.analise.consumo).toEqual(certo.body.analise.consumo);
  });
  it('89% e 131% avisam pela média do array mensalKwh (sem mediaMensalGerada); o consumoKwh sai à parte', async () => {
    comGeracao({ mediaMensalGerada: null, mensalKwh: DOZE(890), consumoKwh: 950 });
    expect((await ligar(201, { proposta: 'P1' })).status).toBe(200);
    const a = await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '1000' } });
    expect(a.body.analise.consumo).toMatchObject({ base: 'proposta_mensal_12', proposta_kwh: 890, proposta_consumo_kwh: 950 });
    expect(a.body.analise.consumo.aviso).toMatch(/gera 890 kWh\/mês e a conta mostra 1\.000 kWh\/mês/);
    comGeracao({ mensalKwh: DOZE(1310) });
    expect((await get('/clientes/vendasolar/201/cadastro')).body.analise.consumo.aviso).toMatch(/gera 1\.310 kWh\/mês/);
    comGeracao({ mensalKwh: DOZE(1000) });
    expect((await get('/clientes/vendasolar/201/cadastro')).body.analise.consumo.aviso).toBeNull();
  });
  it('sem média nem array, usa a geração anual / 12; só com o consumoKwh não compara; proposta fora do papel não entra', async () => {
    comGeracao({ mediaMensalGerada: null, mensalKwh: null, geracaoAnualKwh: '6000', consumoKwh: 900 });
    expect((await ligar(201, { proposta: 'P1' })).status).toBe(200);
    const r = await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '500' } });
    expect(r.body.analise.consumo).toMatchObject({ base: 'proposta_anual_12', proposta_kwh: 500, proposta_consumo_kwh: 900, aviso: null });
    comGeracao({ mediaMensalGerada: null, mensalKwh: null, geracaoAnualKwh: null, consumoKwh: 500 });
    const so = await get('/clientes/vendasolar/201/cadastro');
    expect(so.body.analise.consumo).toMatchObject({ base: null, proposta_kwh: null, proposta_consumo_kwh: 500, aviso: null });
    comGeracao({ geracaoAnualKwh: '6000', consumoKwh: 900 });
    // a proposta passa a ser de outro consultor: o vínculo deixa de valer para a Nilce e a comparação some
    h.propostas = h.propostas.map((p) => (p.codigo === 'P1' ? { ...p, consultor_nome: 'Giovanna' } : p));
    expect((await get('/clientes/vendasolar/201/cadastro')).body.analise.consumo.base).toBeNull();
  });
  it('banco do Gerador fora do ar (vínculo ou geração): o GET e o PUT seguem com consumo.base null e o rateio intacto', async () => {
    comGeracao({ mediaMensalGerada: 800, consumoKwh: 500 });
    expect((await ligar(201, { proposta: 'P1' })).status).toBe(200);
    await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '1000', geradora_pct: '60', benef_1_uc: '77', benef_1_pct: '41' } });
    for (const falha of ['geracao', 'resumo'] as const) {
      h.falha = falha;   // 'geracao' derruba lerGeracaoDaProposta; 'resumo' derruba propostaLigadaAoCard
      const g = await get('/clientes/vendasolar/201/cadastro');
      expect(g.status, falha).toBe(200);
      expect(g.body.analise.consumo, falha).toMatchObject({ base: null, proposta_kwh: null, proposta_consumo_kwh: null, aviso: null, conta_kwh: 1000 });
      expect(g.body.analise.rateio.soma, falha).toBe(101);
      expect(g.body.analise.rateio.bloqueios, falha).toHaveLength(1);
      const p = await put('/clientes/vendasolar/201/cadastro', { campos: { consumo_medio_kwh: '1000' } });
      expect(p.status, falha).toBe(200);
      expect(p.body.analise.consumo.base, falha).toBeNull();
    }
    h.falha = null;
    expect((await get('/clientes/vendasolar/201/cadastro')).body.analise.consumo.base).toBe('proposta_media_gerada');   // voltou ao normal
  });
  it('o eletroposto não recebe análise de solar', async () => {
    const g = await get('/clientes/eletroposto/202/cadastro', THIAGO);
    expect(g.status).toBe(200);
    expect(g.body.analise).toBeUndefined();
    const p = await put('/clientes/eletroposto/202/cadastro', { campos: { nome: 'Dora' } }, THIAGO);
    expect(p.status).toBe(200);
    expect(p.body.analise).toBeUndefined();
  });
  it('rateio_modalidade e benef_N_doc validam; o eletroposto os recusa', async () => {
    const ok = await put('/clientes/vendasolar/201/cadastro', { campos: { rateio_modalidade: 'Autoconsumo remoto', geradora_pct: '50', benef_1_doc: '52998224725' } });
    expect(ok.status).toBe(200);
    expect(ok.body.cadastro.valores).toMatchObject({ rateio_modalidade: 'autoconsumo_remoto', geradora_pct: '50', benef_1_doc: '529.982.247-25' });
    const ruim = await put('/clientes/vendasolar/201/cadastro', { campos: { rateio_modalidade: 'lua', geradora_pct: '101', benef_2_doc: '11111111111' } });
    expect(ruim.status).toBe(400);
    expect(Object.keys(ruim.body.erros).sort()).toEqual(['benef_2_doc', 'geradora_pct', 'rateio_modalidade']);
    const ep = await put('/clientes/eletroposto/202/cadastro', { campos: { rateio_modalidade: 'autoconsumo_local', geradora_pct: '10', benef_1_doc: '52998224725' } }, THIAGO);
    expect(ep.status).toBe(400);
  });
});

describe('ligações do card com a proposta e a venda', () => {
  it('sem login 401; formato do card 400; a guarda 404 igual', async () => {
    expect((await request(app).get('/gerador/vendas-solares/201/vinculos')).status).toBe(401);
    expect((await vinculos(0)).status).toBe(400);
    const alheia = await vinculos(201, GIOVANNA);
    expect(alheia.status).toBe(404);
    for (const id of [202, 203, 999]) expect((await vinculos(id, THIAGO)).body).toEqual(alheia.body);
    expect((await ligar(201, { proposta: 'P1' }, GIOVANNA)).status).toBe(404);
    expect(ligacao(201)).toBeUndefined();
  });
  it('o GET NUNCA liga sozinho (regra do dono, 22/10): um candidato forte por telefone em cada tipo volta como sugerida e nada é gravado', async () => {
    const antes = [...h.linhas.keys()];
    const res = await vinculos(201);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, proposta: null, venda: null });
    expect(res.body.por).not.toBe('auto');
    const props = res.body.sugestoes.propostas;
    const vds = res.body.sugestoes.vendas;
    expect(props[0]).toMatchObject({ codigo: 'P1', motivo: 'telefone', sugerida: true });
    expect(vds[0]).toMatchObject({ codigo: '#0057', motivo: 'telefone', sugerida: true });
    expect(props.map((p: any) => p.codigo)).not.toContain('P2');      // não vendida
    expect(props.map((p: any) => p.codigo)).not.toContain('P7');      // eletroposto
    expect(ligacao(201)).toBeUndefined();
    expect([...h.linhas.keys()]).toEqual(antes);
    expect([...h.linhas.keys()].some((k) => k.startsWith('venda_solar:'))).toBe(false);
  });
  it('candidata forte do mesmo consultor: o GET devolve, sem chamar gravarLigacao nem gravar no system_state', async () => {
    const gravar = vi.spyOn(hubReal, 'gravarLigacao');
    const antes = new Map([...h.linhas.entries()].map(([k, l]) => [k, JSON.stringify(l.value)]));
    const res = await vinculos(207);        // Nilce, vendedora do card e dona de P5 e #0060, telefone com DDD dos dois lados
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((p: any) => [p.codigo, p.motivo, p.sugerida])).toEqual([['P5', 'telefone', true]]);
    expect(res.body.sugestoes.vendas.map((v: any) => [v.codigo, v.motivo, v.sugerida])).toEqual([['#0060', 'telefone', true]]);
    expect(gravar).not.toHaveBeenCalled();
    expect(new Map([...h.linhas.entries()].map(([k, l]) => [k, JSON.stringify(l.value)]))).toEqual(antes);
    // a segunda leitura é igual: nada mudou de uma para a outra
    expect((await vinculos(207)).body).toMatchObject({ proposta: null, venda: null });
    expect(gravar).not.toHaveBeenCalled();
    gravar.mockRestore();
  });
  it('desligar uma ponta grava a chave e o GET NÃO religa sozinho', async () => {
    await ligar(201, { proposta: 'P1', venda: '#0057' });
    const off = await ligar(201, { proposta: null });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ proposta: null, venda: '#0057', por: 'nilce' });
    const de_novo = await vinculos(201);
    expect(de_novo.body).toMatchObject({ proposta: null, venda: '#0057', por: 'nilce' });
    expect(de_novo.body.sugestoes.propostas.map((p: any) => p.codigo)).toEqual(['P1', 'P6']);   // continua sugerindo, sem ligar
    expect(ligacao(201)?.proposta).toBeNull();
    // desligar tudo também não religa
    await ligar(201, { venda: null });
    const nada = await vinculos(201);
    expect(nada.body).toMatchObject({ proposta: null, venda: null });
    expect(ligacao(201)).toMatchObject({ proposta: null, venda: null });
  });
  it('dois candidatos por telefone: não liga; lista os dois com motivo "telefone"', async () => {
    const res = await vinculos(204, GIOVANNA);
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((p: any) => [p.codigo, p.motivo])).toEqual([['P3', 'telefone'], ['P4', 'telefone']]);
    expect(res.body.sugestoes.vendas.map((v: any) => [v.codigo, v.motivo])).toEqual([['#0058', 'telefone'], ['#0061', 'telefone']]);
    expect(res.body.sugestoes.propostas[0]).toMatchObject({ cliente: 'Bruno Lima', cidade: 'Uberlandia', kwp: 8.8, data: '2026-08-01' });
    expect(res.body.sugestoes.vendas[0]).toMatchObject({ cliente: 'Bruno Lima', data: '2026-09-01' });
    expect(ligacao(204)).toBeUndefined();
  });
  it('NUNCA liga só por nome: um único nome parecido vira sugestão com motivo "nome"', async () => {
    const res = await vinculos(205);       // 'Ana Souza Pereira', sem telefone: P6 e #0059 têm o mesmo nome e são os únicos
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((p: any) => [p.codigo, p.motivo])).toContainEqual(['P6', 'nome']);
    expect(res.body.sugestoes.vendas.map((v: any) => [v.codigo, v.motivo])).toContainEqual(['#0059', 'nome']);
    expect(ligacao(205)).toBeUndefined();
  });
  it('quem pode ligar: proposta só do consultor dela (ou sócio) e vendida; venda só a que o pedinte enxerga', async () => {
    expect((await ligar(201, { proposta: 'P3' })).status).toBe(404);            // proposta da Giovanna
    expect((await ligar(201, { proposta: 'P2' })).status).toBe(409);            // não vendida
    expect((await ligar(201, { proposta: 'NAOEXISTE' })).status).toBe(404);
    expect((await ligar(201, { proposta: '../x' })).status).toBe(400);
    expect((await ligar(201, { venda: '#0058' })).status).toBe(404);             // venda da Giovanna
    expect((await ligar(201, { venda: 'abc' })).status).toBe(400);
    expect((await ligar(201, {})).status).toBe(400);
    expect(ligacao(201)).toBeUndefined();
    expect((await ligar(201, { proposta: 'P3' }, THIAGO)).status).toBe(200);      // sócio liga qualquer proposta vendida
    expect((await ligar(201, { venda: '57' })).status).toBe(200);                // '57' e '#0057' são a mesma venda
    expect(ligacao(201)).toMatchObject({ proposta: 'P3', venda: '#0057', por: 'nilce' });
  });
  it('o POST manual grava a ligação sem dado pessoal (nem nome, nem telefone)', async () => {
    const res = await ligar(201, { proposta: 'P1', venda: '#0057' });
    expect(res.status).toBe(200);
    expect(ligacao(201)).toEqual({ proposta: 'P1', venda: '#0057', por: 'nilce', em: '2026-10-20T15:00:00.000Z', sig: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(ligacao(201))).not.toMatch(/Ana|Souza|3498888|98888/);
    expect(JSON.stringify(res.body)).not.toMatch(/Ana|Souza|3498888|98888/);
  });
  it('soSeVazia: liga quando o card está vazio; se já tem proposta (ou venda) responde 409 e não troca nada; sem a marca, o POST manual troca como sempre', async () => {
    const ok = await ligar(201, { proposta: 'P1', soSeVazia: true });
    expect(ok.status).toBe(200);
    expect(ligacao(201)).toMatchObject({ proposta: 'P1', venda: null });
    const antes = JSON.stringify(ligacao(201));
    const cheia = await ligar(201, { proposta: 'P6', soSeVazia: true });
    expect(cheia.status).toBe(409);
    expect(cheia.body.error).toMatch(/já tem ligação/);
    expect(JSON.stringify(ligacao(201))).toBe(antes);
    const mesma = await ligar(201, { proposta: 'P1', soSeVazia: true });
    expect(mesma.status).toBe(409);
    // a venda segue a mesma regra, só para o campo que está sendo ligado
    expect((await ligar(201, { venda: '#0057', soSeVazia: true })).status).toBe(200);
    expect((await ligar(201, { venda: '#0060', soSeVazia: true })).status).toBe(409);
    expect(ligacao(201)).toMatchObject({ proposta: 'P1', venda: '#0057' });
    // o botão manual não manda a marca e troca
    expect((await ligar(201, { proposta: 'P6' })).status).toBe(200);
    expect(ligacao(201)?.proposta).toBe('P6');
  });
  it('uma proposta e uma venda só podem estar ligadas a UM card', async () => {
    expect((await ligar(201, { proposta: 'P1', venda: '#0057' })).status).toBe(200);
    const p = await ligar(206, { proposta: 'P1' });
    expect(p.status).toBe(409);
    expect(p.body.error).toMatch(/outra venda/);
    const v = await ligar(206, { venda: '#0057' });
    expect(v.status).toBe(409);
    expect(ligacao(206)).toBeUndefined();
    // o card 206 tem o mesmo telefone, mas o que já é de outro card não é sugerido nem ligado sozinho
    const res = await vinculos(206);
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((x: any) => x.codigo)).not.toContain('P1');
    expect(res.body.sugestoes.vendas.map((x: any) => x.codigo)).not.toContain('#0057');
    expect(ligacao(206)).toBeUndefined();
    // desligar no primeiro libera para o segundo
    await ligar(201, { proposta: null, venda: null });
    expect((await ligar(206, { proposta: 'P1' })).status).toBe(200);
  });
  it('dois cards disputando a mesma proposta ao mesmo tempo: só um fica com ela (uma trava para todos os cards)', async () => {
    const [a, b] = await Promise.all([ligar(201, { proposta: 'P1' }), ligar(206, { proposta: 'P1' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const donos = [201, 206].filter((id) => ligacao(id)?.proposta === 'P1');
    expect(donos).toHaveLength(1);
    expect([...h.linhas.keys()].some((k) => k.startsWith('cadastro_trava:'))).toBe(false);   // a trava foi solta
  });
  it('a proposta que o outro card já levou não é candidata; a venda #0057 continua só sugerida', async () => {
    await ligar(206, { proposta: 'P1' });
    const res = await vinculos(201);          // P1 é de outro card: não é candidata; a venda #0057 ainda é única, mas só sugerida
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((p: any) => p.codigo)).not.toContain('P1');
    expect(res.body.sugestoes.vendas[0]).toMatchObject({ codigo: '#0057', sugerida: true });
    expect(ligacao(201)).toBeUndefined();
  });
});

describe('dossiê da proposta ligada, só leitura', () => {
  const liga = async () => { await ligar(201, { proposta: 'P1' }); };
  it('o GET dos documentos devolve o dossiê nos itens da vendasolar; caminho injetado e HEIC não aparecem; nada é copiado', async () => {
    await liga();
    const res = await docs(201);
    expect(res.status).toBe(200);
    expect(res.body.dossie.proposta).toBe('P1');
    const arqs: Array<{ slot: string; url: string; mime: string; de: string }> = res.body.dossie.arquivos;
    const porSlot = Object.fromEntries(arqs.map((a) => [a.slot, a]));
    expect(Object.keys(porSlot).sort()).toEqual(['conta_luz', 'documento_titular_uc', 'fachada', 'medidor']);
    expect(porSlot.documento_titular_uc).toMatchObject({ mime: 'application/pdf', de: 'dossie' });
    expect(porSlot.conta_luz.mime).toBe('image/jpeg');                    // 'image/jpg' do dossiê vira jpeg
    expect(porSlot.medidor.mime).toBe('image/heic');                       // HEIC aparece para quem vê (o navegador abre); só a leitura por IA o ignora
    expect(arqs.every((a) => /^https:\/\/dossie\.test\//.test(a.url))).toBe(true);
    expect(arqs.some((a) => a.slot === 'padrao')).toBe(false);             // o caminho 'OUTRA/...' não é da proposta
    expect(h.assinados.some((p) => p.startsWith('OUTRA/'))).toBe(false);
    expect(res.body.arquivos).toEqual([]);                                 // não migrou: os anexos da venda seguem vazios
    expect(h.linhas.has('docs_cliente:vendasolar:201')).toBe(false);
    // as rotas do dossiê da proposta não mudaram: a lista não leva `nome` original de arquivo
    expect(JSON.stringify(res.body)).not.toMatch(/CNH-ANA|luz-da-ana|casa\.jpg/);
  });
  it('vínculo que não vale na leitura é ignorado: proposta de outro consultor ou não vendida', async () => {
    injeta(201, { proposta: 'P3' });
    expect((await docs(201)).body.dossie).toBeNull();
    injeta(201, { proposta: 'P2' });
    expect((await docs(201)).body.dossie).toBeNull();
    // o sócio vê qualquer proposta VENDIDA ligada
    injeta(201, { proposta: 'P1' });
    expect((await docs(201, THIAGO)).body.dossie.proposta).toBe('P1');
  });
  it('dossiê fora do ar não derruba a lista', async () => {
    await liga();
    h.propostas = h.propostas.map((p) => (p.codigo === 'P1' ? { ...p, dados: 'torto' } : p));
    const res = await docs(201);
    expect(res.status).toBe(200);
    expect(res.body.dossie.arquivos).toEqual([]);
  });
  const valorRel = (corpo: any, rotulo: string): string | undefined => corpo.secoes.flatMap((x: any) => x.campos).find((c: any) => c.rotulo === rotulo)?.valor;
  const PROIBIDOS = ['Consultor', 'Nilce', 'Modelo da venda', 'Data da venda', 'Contrato assinado', 'Obra não concluída', 'Engenheiro', 'emitido_por', '"obra"', 'obra_concluida', 'Forma de pagamento'];
  const CAD = {
    nome: 'Ana Souza', cpf_cnpj: '52998224725', concessionaria: 'Cemig', uf: 'MG', endereco_ponto: 'Rua das Flores, 10', unidade_consumidora: '0012345678',
    titular_conta: 'Maria Souza', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Maria Souza', tuc_cpf_cnpj: '11144477735', uc_fornecimento: 'Trifásico',
    coordenadas: '-18.912345, -48.275432', disjuntor_a: '50 A', materiais: 'Cabo solar 6 mm, string box',
    rateio_modalidade: 'Autoconsumo remoto', geradora_pct: '33.33', benef_1_uc: '0098765432', benef_1_titular: 'Ana Souza', benef_1_pct: '40', benef_1_doc: '52998224725',
  };
  it('o relatório de homologação leva o cadastro do card, o dossiê classificado por seção e o rateio, sem dinheiro nem dado interno', async () => {
    await ligar(201, { proposta: 'P1', venda: '#0057' });
    expect((await put('/clientes/vendasolar/201/cadastro', { campos: CAD })).status).toBe(200);
    const res = await get('/clientes/vendasolar/201/relatorio');
    expect(res.status).toBe(200);
    expect(res.body.cabecalho).toMatchObject({ linha: 'vendasolar', codigo: '201', cliente: 'Ana Souza' });
    expect(res.body.secoes.map((x: any) => x.numero)).toEqual([1, 2, 3, 4, 5]);
    expect(valorRel(res.body, 'Estado')).toBe('MG');
    expect(valorRel(res.body, 'Nome da concessionária')).toBe('Cemig');
    expect(valorRel(res.body, 'Pessoa física ou jurídica')).toBe('Pessoa física');
    // a homologação fica com outra pessoa: o "cliente" da seção 2 é ela (nome, CPF e PF/PJ do tuc_*)
    expect(valorRel(res.body, 'Nome completo')).toBe('Maria Souza');
    expect(valorRel(res.body, 'CPF')).toBe('111.444.777-35');
    expect(JSON.stringify(res.body.secoes[1])).not.toContain('529.982');
    expect(valorRel(res.body, 'Trocar titularidade?')).toBe('Não');            // a conta já está no nome de quem fica com a homologação
    expect(valorRel(res.body, 'Tipo de disjuntor')).toBe('Trifásico');          // vem do tipo de fornecimento da geradora
    expect(valorRel(res.body, 'Rede trifásica')).toBe('Sim');
    expect(valorRel(res.body, 'Valor do disjuntor (A)')).toBe('50');
    expect(valorRel(res.body, 'Latitude do projeto')).toBe('-18.912345');
    expect(valorRel(res.body, 'Longitude do projeto')).toBe('-48.275432');
    expect(valorRel(res.body, 'Materiais')).toBe('Cabo solar 6 mm, string box');
    expect(valorRel(res.body, 'Documento de rateio: modalidade')).toBe('Autoconsumo remoto');
    expect(valorRel(res.body, 'Documento de rateio: percentual da geradora')).toBe('33,33%');   // percentual não passa por filtro de texto
    expect(valorRel(res.body, 'Beneficiária 1: percentual')).toBe('40%');
    expect(res.body.pendencias).toEqual({ campos: [], documentos: ['Foto do padrão de entrada', 'Foto do disjuntor', 'Conta de energia das unidades beneficiárias'] });
    // o documento da homologação (titular_uc, vindo do dossiê) é o documento com foto
    expect(res.body.documentos.map((d: any) => d.arquivo).sort()).toEqual(['2-documento-com-foto', '3-conta-de-energia', '5-fachada-1', '5-medidor-1']);
    expect(res.body.documentos.find((d: any) => d.slot === 'documento_titular_uc').rotulo).toBe('CNH ou documento do titular da homologação');
    const t = JSON.stringify(res.body);
    expect(t).not.toMatch(/8\.887|7\.776|2\.345/);
    for (const p of PROIBIDOS) expect(t, p).not.toContain(p);
    // sem venda ligada: o cadastro do card segue, só não há equipamento da planilha
    await ligar(201, { venda: null });
    const sem = await get('/clientes/vendasolar/201/relatorio');
    expect(valorRel(sem.body, 'Nome completo')).toBe('Maria Souza');   // quem fica com a homologação
    expect(valorRel(sem.body, 'Potência total (kWp)')).toBe('');
  });
  it('eletroposto com o cadastro já no bucket: coordenadas separadas, disjuntor e materiais sem dinheiro; a IA nunca pede esses campos', async () => {
    const ok = await put('/clientes/eletroposto/202/cadastro', { campos: { nome: 'Dora Eletroposto', coordenadas: '-18.9, -48.2', disjuntor_tipo: 'bifasico', disjuntor_a: '40', uf_ponto: 'go', materiais: 'Cabo 10 mm, haste' } });
    expect(ok.status).toBe(200);
    const rel = await get('/clientes/eletroposto/202/relatorio');
    expect(rel.status).toBe(200);
    expect(valorRel(rel.body, 'Latitude do projeto')).toBe('-18.9');
    expect(valorRel(rel.body, 'Longitude do projeto')).toBe('-48.2');
    expect(valorRel(rel.body, 'Tipo de disjuntor')).toBe('Bifásico');
    expect(valorRel(rel.body, 'Valor do disjuntor (A)')).toBe('40');
    expect(valorRel(rel.body, 'Estado')).toBe('GO');
    expect(rel.body.pendencias.campos).toEqual([]);
    expect((await put('/clientes/eletroposto/202/cadastro', { campos: { materiais: 'Cabo por R$ 3.000' } })).status).toBe(400);
  });
  it('o contratante fica com a homologação: o documento do titular da homologação anexado vale como o documento com foto dele; coordenada fora do intervalo é recusada', async () => {
    await ligar(201, { proposta: 'P1' });
    expect((await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'Ana Souza', titular_conta: 'ana souza', homologacao_mesmo: 'contratante' } })).status).toBe(200);
    const res = await get('/clientes/vendasolar/201/relatorio');
    expect(valorRel(res.body, 'Trocar titularidade?')).toBe('Não');
    expect(res.body.documentos.map((d: any) => [d.slot, d.arquivo])).toContainEqual(['documento_titular_uc', '2-documento-com-foto']);
    expect(res.body.pendencias.documentos).not.toContain('Documento com foto do cliente');
    expect(valorRel(res.body, 'Nome completo')).toBe('Ana Souza');
    expect(res.body.pendencias.campos).toEqual(['Coordenadas (latitude e longitude)', 'Tipo de disjuntor', 'Valor do disjuntor (A)']);
    const ruim = await put('/clientes/vendasolar/201/cadastro', { campos: { coordenadas: '95, 200' } });
    expect(ruim.status).toBe(400);
    expect(JSON.stringify(ruim.body)).not.toContain('200');
    expect((await put('/clientes/vendasolar/201/cadastro', { campos: { coordenadas: '-18,9; -48,2', disjuntor_a: 'quarenta' } })).status).toBe(400);
    expect((await put('/clientes/vendasolar/201/cadastro', { campos: { coordenadas: '18.9 W, 48.2 S' } })).status).toBe(400);   // letra trocada
  });
  it('outra pessoa com a homologação e a conta no nome de um terceiro: troca a titularidade; materiais com valor ou "sinal" é barrado', async () => {
    expect((await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'Ana Souza', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Maria Souza', tuc_cpf_cnpj: '11222333000181', titular_conta: 'José Pereira' } })).status).toBe(200);
    const res = await get('/clientes/vendasolar/201/relatorio');
    expect(valorRel(res.body, 'Nome completo')).toBe('Maria Souza');
    expect(valorRel(res.body, 'Pessoa física ou jurídica')).toBe('Pessoa jurídica');
    expect(valorRel(res.body, 'CNPJ')).toBe('11.222.333/0001-81');
    expect(valorRel(res.body, 'Trocar titularidade?')).toBe('Sim');
    for (const t of ['Cabo 1.500,00', 'sinal de 30%', 'kit por R$ 3 mil']) {
      expect((await put('/clientes/vendasolar/201/cadastro', { campos: { materiais: t } })).status, t).toBe(400);
    }
  });
});

describe('leitura por IA da vendasolar', () => {
  const indiceDe = (content: any[], slot: string, depois = 0): number => {
    const n = content.filter((b) => b?.type === 'text' && new RegExp(`^Arquivo \\d+, slot "${slot}"`).test(b.text)).map((b) => Number(/^Arquivo (\d+),/.exec(b.text)![1]));
    return n[depois];
  };
  const campo = (campo: string, indice: number, valor: string, confianca = 'alta') => ({ campo, valor, indice, confianca, nota: '' });

  it('lê os anexos e o dossiê da proposta ligada; cada arquivo só preenche o que é do papel dele', async () => {
    anexa(201, [
      { slot: 'conta_luz', uuid: U1, ext: 'pdf', mime: 'application/pdf', bytes: PDF.length, em: '2026-10-20T11:00:00.000Z' },
      { slot: 'conta_luz_beneficiaria', uuid: U2, ext: 'pdf', mime: 'application/pdf', bytes: PDF.length, em: '2026-10-20T10:00:00.000Z' },
      { slot: 'documento_titular_uc', uuid: U3, ext: 'jpg', mime: 'image/jpeg', bytes: JPG.length, em: '2026-10-20T09:00:00.000Z' },
      { slot: 'fachada', uuid: U4, ext: 'jpg', mime: 'image/jpeg', bytes: JPG.length, em: '2026-10-20T08:00:00.000Z' },
    ]);
    h.objetos.set(`vendasolar/201/${U1}.pdf`, PDF);
    h.objetos.set(`vendasolar/201/${U2}.pdf`, PDF);
    h.objetos.set(`vendasolar/201/${U3}.jpg`, JPG);
    h.objetos.set(`vendasolar/201/${U4}.jpg`, JPG);
    await ligar(201, { proposta: 'P1' });
    h.ia.fila.push({
      saida: (content: any[]) => ({
        campos: [
          campo('unidade_consumidora', indiceDe(content, 'conta_luz'), '0012345678'),
          campo('consumo_medio_kwh', indiceDe(content, 'conta_luz'), '412,5', 'media'),
          campo('uc_classe', indiceDe(content, 'conta_luz'), 'residencial'),
          campo('tuc_nome', indiceDe(content, 'documento_titular_uc', 1), 'Ana Souza'),   // o 2º arquivo do item é o do DOSSIÊ (documento -> documento_titular_uc)
          campo('benef_1_uc', indiceDe(content, 'conta_luz_beneficiaria'), '0098765432'),
          campo('benef_1_titular', indiceDe(content, 'conta_luz_beneficiaria'), 'Bruno Lima'),
          campo('endereco_ponto', indiceDe(content, 'conta_luz_beneficiaria'), 'Rua B, 20'),     // descartada: a beneficiária não dá o ponto
          campo('tuc_cpf_cnpj', indiceDe(content, 'documento_titular_uc', 0), '529.982.247-25'),
          campo('nome', indiceDe(content, 'documento_titular_uc', 0), 'Maria Souza'),            // descartada: o titular da UC só dá tuc_*
          campo('nome', indiceDe(content, 'documento_titular_uc', 1), 'Ana Souza'),              // descartada: o documento do dossiê também é o do titular da conta
          campo('cpf_cnpj', indiceDe(content, 'fachada') || 99, '529.982.247-25'),               // foto não é lida: sem origem, descartada
        ],
        documentos: [],
      }),
    });
    const res = await post('/clientes/vendasolar/201/cadastro/ler', {});
    expect(res.status).toBe(200);
    const s = res.body.sugestoes;
    expect(Object.keys(s).sort()).toEqual(['benef_1_titular', 'benef_1_uc', 'consumo_medio_kwh', 'tuc_cpf_cnpj', 'tuc_nome', 'uc_classe', 'unidade_consumidora']);
    expect(s.unidade_consumidora).toMatchObject({ valor: '0012345678', slot: 'conta_luz' });
    expect(s.consumo_medio_kwh).toMatchObject({ valor: '412.5', confianca: 'media' });
    expect(s.tuc_nome).toMatchObject({ valor: 'Ana Souza', slot: 'documento_titular_uc' });       // veio do dossiê
    expect(s.tuc_cpf_cnpj.slot).toBe('documento_titular_uc');
    expect(s.benef_1_uc.slot).toBe('conta_luz_beneficiaria');
    expect(res.body.descartadas.map((d: any) => d.campo).sort()).toEqual(['cpf_cnpj', 'endereco_ponto', 'nome', 'nome']);   // os dois `nome` vieram de documentos do titular da conta

    // o pedido à IA: esquema e prompt da vendasolar, e o dossiê foi BAIXADO (só os caminhos da proposta; o injetado e o HEIC não)
    expect(h.ia.chamadas).toHaveLength(1);
    const corpo = h.ia.chamadas[0].corpo;
    expect(corpo.system).toBe(SISTEMA_CADASTRO_SOLAR);
    expect(JSON.stringify(corpo.output_config.format)).toContain('benef_1_uc');
    expect(JSON.stringify(corpo.output_config.format)).not.toContain('benef_1_pct');
    const blocos = corpo.messages[0].content as any[];
    expect(blocos.some((b) => b.type === 'document' && b.source.data === PDF2.toString('base64'))).toBe(true);   // o PDF do dossiê
    expect(blocos.filter((b) => b.type === 'image' && b.source.data === JPG.toString('base64')).length).toBeGreaterThanOrEqual(2);   // documento do titular da UC + conta do dossiê
    expect(h.baixados.sort()).toEqual(['P1/conta_luz-2.jpg', 'P1/documento-1.pdf']);
    expect(blocos.some((b) => b.type === 'text' && /desta venda|titular_uc/.test(b.text))).toBe(true);
    // nada do dossiê foi copiado, rotulado ou movido; o cadastro NÃO foi gravado (só sugere)
    const registro = h.linhas.get('docs_cliente:vendasolar:201')!.value as { arquivos: any[] };
    expect(registro.arquivos).toHaveLength(4);
    expect(JSON.stringify([...h.cad.keys()])).not.toContain('201.json"');
    expect(JSON.stringify(res.body.organizados)).not.toContain('dossie:');
  });
  it('o documento do titular do financiamento só preenche fin_*; o nome do card vai como negociador, não como contratante', async () => {
    anexa(201, [
      { slot: 'documento_financiamento', uuid: U1, ext: 'pdf', mime: 'application/pdf', bytes: PDF.length, em: '2026-10-20T11:00:00.000Z' },
      { slot: 'comprovante_endereco_financiamento', uuid: U2, ext: 'jpg', mime: 'image/jpeg', bytes: JPG.length, em: '2026-10-20T10:00:00.000Z' },
    ]);
    h.objetos.set(`vendasolar/201/${U1}.pdf`, PDF);
    h.objetos.set(`vendasolar/201/${U2}.jpg`, JPG);
    await put('/clientes/vendasolar/201/cadastro', { campos: { tuc_nome: 'Maria Souza', financiamento_mesmo: 'outra_pessoa' } });
    h.ia.fila.push({
      saida: (content: any[]) => ({
        campos: [
          campo('fin_nome', indiceDe(content, 'documento_financiamento'), 'Joao Banco'),
          campo('fin_cpf_cnpj', indiceDe(content, 'documento_financiamento'), '529.982.247-25'),
          campo('fin_endereco', indiceDe(content, 'comprovante_endereco_financiamento'), 'Rua C, 30'),
          campo('nome', indiceDe(content, 'documento_financiamento'), 'Joao Banco'),              // descartada: é o documento do financiamento
          campo('endereco', indiceDe(content, 'comprovante_endereco_financiamento'), 'Rua C, 30'), // descartada
          campo('tuc_nome', indiceDe(content, 'documento_financiamento'), 'Joao Banco'),          // descartada
          campo('financiamento_mesmo', indiceDe(content, 'documento_financiamento'), 'outra_pessoa'),   // nunca sai da IA
        ],
        documentos: [],
      }),
    });
    const res = await post('/clientes/vendasolar/201/cadastro/ler', {});
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.sugestoes).sort()).toEqual(['fin_cpf_cnpj', 'fin_endereco', 'fin_nome']);
    expect(res.body.sugestoes.fin_nome.slot).toBe('documento_financiamento');
    expect(res.body.descartadas.map((d: any) => d.campo).sort()).toEqual(['endereco', 'nome', 'tuc_nome']);
    const textos = (h.ia.chamadas[0].corpo.messages[0].content as any[]).filter((b) => b.type === 'text').map((b) => b.text as string);
    const pessoas = textos.find((t) => t.startsWith('Extraia')) ?? '';
    expect(pessoas).toContain('negociador: "Ana Souza"');       // o nome do card
    expect(pessoas).toContain('titular_uc: "Maria Souza"');
    expect(pessoas).not.toContain('comprador:');                // sem contratante cadastrado, o nome do card NÃO vira o contratante
    expect(cadastroDe(201).campos.fin_nome).toBeUndefined();    // só sugere
  });
  it('sem proposta ligada e sem anexo: 409 sem_documentos; o dossiê sozinho já basta para ler', async () => {
    expect((await post('/clientes/vendasolar/201/cadastro/ler', {})).status).toBe(409);
    await ligar(201, { proposta: 'P1' });
    h.ia.fila.push({ saida: (c: any[]) => ({ campos: [campo('tuc_nome', indiceDe(c, 'documento_titular_uc'), 'Ana Souza')], documentos: [] }) });
    const res = await post('/clientes/vendasolar/201/cadastro/ler', {});
    expect(res.status).toBe(200);
    expect(res.body.sugestoes.tuc_nome.valor).toBe('Ana Souza');
    expect(res.body.lidos).toEqual(expect.arrayContaining([{ slot: 'documento_titular_uc', n: 1 },{ slot: 'conta_luz', n: 1 }]));
  });
  it('proposta ligada que não vale (de outro consultor) NÃO entra na leitura', async () => {
    injeta(201, { proposta: 'P3' });
    const res = await post('/clientes/vendasolar/201/cadastro/ler', {});
    expect(res.status).toBe(409);
    expect(h.baixados).toEqual([]);
    expect(h.ia.chamadas).toHaveLength(0);
  });
});

describe('assinatura das ligações', () => {
  it('registro injetado SEM sig não dá acesso, nem dossiê, nem conta como dono; sig adulterada idem; sig certa dá', async () => {
    // Giovanna não é dona do card 201 nem da venda #0057: só uma ligação ASSINADA à venda dela (#0058) lhe abre o card.
    injeta(201, { venda: '#0058' }, 'nenhuma');
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    injeta(201, { venda: '#0058' }, 'torta');
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    expect((await get('/clientes/vendasolar/201/cadastro', GIOVANNA)).status).toBe(404);
    // assinatura de OUTRO card, ou com campo trocado depois de assinada: não vale
    const l: Ligacao = { proposta: null, venda: '#0058', por: 'x', em: '2026-10-20T10:00:00.000Z' };
    h.linhas.set('venda_solar:201', { updated_at: 'x', value: { ...l, sig: assinarLigacao(204, l) } });
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    h.linhas.set('venda_solar:201', { updated_at: 'x', value: { ...l, venda: '#0058', por: 'outro', sig: assinarLigacao(201, l) } });
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    // a certa
    injeta(201, { venda: '#0058' }, 'certa');
    expect((await docs(201, GIOVANNA)).status).toBe(200);
    // o vendedor do card e o sócio nunca dependem da assinatura
    injeta(201, { venda: '#0058' }, 'nenhuma');
    expect((await docs(201)).status).toBe(200);
    expect((await docs(201, THIAGO)).status).toBe(200);
  });
  it('proposta injetada sem sig não serve o dossiê; o GET de vínculos a trata como inexistente (e o log não leva dado pessoal)', async () => {
    injeta(201, { proposta: 'P1' }, 'nenhuma');
    expect((await docs(201)).body.dossie).toBeNull();
    const res = await vinculos(201);
    expect(res.body).toMatchObject({ proposta: null, venda: null });                        // a chave não vale e o GET não regrava nada
    expect(h.linhas.get('venda_solar:201')!.value).not.toHaveProperty('sig');
    expect((await docs(201)).body.dossie).toBeNull();
    const logs = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logs).toContain('sig_invalida');
    expect(logs).not.toMatch(/Ana|Souza|3498888|P1/);
  });
  it('ligação injetada sem sig não ocupa a proposta nem a venda no teste de unicidade', async () => {
    injeta(206, { proposta: 'P1', venda: '#0057' }, 'nenhuma');
    expect((await ligar(201, { proposta: 'P1', venda: '#0057' })).status).toBe(200);
    // e a ASSINADA ocupa
    injeta(204, { proposta: 'P5' }, 'certa');
    expect((await ligar(207, { proposta: 'P5' })).status).toBe(409);
  });
  it('toda gravação leva sig = HMAC-SHA256 hex de card|proposta|venda|por|em, com segredo derivado da chave de serviço', async () => {
    await ligar(201, { proposta: 'P1', venda: '#0057' });
    const v = h.linhas.get('venda_solar:201')!.value as Ligacao & { sig: string };
    expect(v.sig).toBe(assinarLigacao(201, v));
    expect(v.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(assinarLigacao(202, v)).not.toBe(v.sig);
    process.env.VINCULO_SOLAR_SECRET = 'segredo-proprio';
    expect(assinarLigacao(201, v)).not.toBe(v.sig);           // a env própria manda sobre a derivação
    // com a env própria a ligação antiga deixa de valer
    expect((await docs(201, GIOVANNA)).status).toBe(404);
  });
  it('sem nenhum segredo no ambiente: a ligação não grava (503) e a guarda só aceita o vendedor do card e o sócio', async () => {
    injeta(201, { venda: '#0058' }, 'certa');
    expect((await docs(201, GIOVANNA)).status).toBe(200);
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.VINCULO_SOLAR_SECRET;
    expect((await docs(201, GIOVANNA)).status).toBe(404);
    expect((await docs(201)).status).toBe(200);
    expect((await docs(201, THIAGO)).status).toBe(200);
    const res = await ligar(201, { proposta: 'P1' });
    expect(res.status).toBe(503);
    expect((await vinculos(201)).body).toMatchObject({ ok: true, proposta: null, venda: null });   // lê, mas não liga sozinho
    expect(h.linhas.get('venda_solar:201')!.value).not.toHaveProperty('proposta', 'P1');
  });
});

describe('sugestão por telefone (nunca liga): só do mesmo consultor, com DDD, e um candidato', () => {
  it('quem abriu o card não muda nada: o sócio abrindo um card de OUTRO consultor recebe sugestão sem a marca "sugerida"', async () => {
    h.cards = h.cards.map((c) => (c.id === 207 ? { ...c, vendedor_nome: 'Giovanna' } : c));     // P5 e #0060 são da Nilce
    const res = await vinculos(207, THIAGO);
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((p: any) => [p.codigo, p.motivo])).toEqual([['P5', 'telefone']]);
    expect(res.body.sugestoes.vendas.map((v: any) => [v.codigo, v.motivo])).toEqual([['#0060', 'telefone']]);
    expect(res.body.sugestoes.propostas[0].sugerida).toBeUndefined();
    expect(res.body.sugestoes.vendas[0].sugerida).toBeUndefined();
    expect(ligacao(207)).toBeUndefined();
    // o sócio abrindo o card de quem é o dono dos candidatos vê a marca, mas também não grava nada
    const ok = await vinculos(201, THIAGO);
    expect(ok.body).toMatchObject({ proposta: null, venda: null });
    expect(ok.body.sugestoes.propostas[0]).toMatchObject({ codigo: 'P1', sugerida: true });
    expect(ok.body.sugestoes.vendas[0]).toMatchObject({ codigo: '#0057', sugerida: true });
    expect(ligacao(201)).toBeUndefined();
  });
  it('só uma das pontas vem como sugerida quando a outra é de outro consultor', async () => {
    h.propostas = h.propostas.map((p) => (p.codigo === 'P5' ? { ...p, consultor_nome: 'Giovanna' } : p));
    const res = await vinculos(207);              // a Nilce só enxerga o que é dela: P5 some das sugestões
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas.map((p: any) => p.codigo)).not.toContain('P5');
    expect(res.body.sugestoes.vendas[0]).toMatchObject({ codigo: '#0060', sugerida: true });
    expect(ligacao(207)).toBeUndefined();
  });
  it('DDD diferente não casa; sem DDD de um dos lados só sugere, nunca liga sozinho', async () => {
    h.cards = h.cards.map((c) => (c.id === 201 ? { ...c, cliente_telefone: '(11) 98888-0001' } : c));
    const outroDdd = await vinculos(201);
    expect(outroDdd.body.sugestoes.propostas.filter((p: any) => p.motivo === 'telefone')).toEqual([]);
    expect(outroDdd.body.sugestoes.vendas.filter((v: any) => v.motivo === 'telefone')).toEqual([]);
    expect(outroDdd.body).toMatchObject({ proposta: null, venda: null });
    // a chave não foi gravada: só mudar o telefone do card já basta para tentar de novo
    h.cards = h.cards.map((c) => (c.id === 201 ? { ...c, cliente_telefone: '988880001' } : c));          // 9 dígitos, sem DDD
    invalidarCachesHub();
    const semDdd = await vinculos(201);
    expect(semDdd.body).toMatchObject({ proposta: null, venda: null });
    expect(semDdd.body.sugestoes.propostas.map((p: any) => [p.codigo, p.motivo])).toContainEqual(['P1', 'telefone']);
    expect(semDdd.body.sugestoes.vendas.map((v: any) => [v.codigo, v.motivo])).toContainEqual(['#0057', 'telefone']);
    expect(ligacao(201)).toBeUndefined();
  });
  it('o telefone da proposta também vem de dados.telefone (formatado), não só de telefoneDigitos', async () => {
    h.propostas = h.propostas.map((p) => (p.codigo === 'P5' ? { ...p, dados: { telefone: '(34) 99999-0003' } } : p));
    const res = await vinculos(207);
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas[0]).toMatchObject({ codigo: 'P5', motivo: 'telefone', sugerida: true });
    expect(res.body.sugestoes.vendas[0]).toMatchObject({ codigo: '#0060', sugerida: true });
    expect(ligacao(207)).toBeUndefined();
  });
  it('com +55 e sem o nono dígito no card ainda casa com DDD', async () => {
    h.cards = h.cards.map((c) => (c.id === 207 ? { ...c, cliente_telefone: '+55 34 9999-0003' } : c));
    const res = await vinculos(207);
    expect(res.body).toMatchObject({ proposta: null, venda: null });
    expect(res.body.sugestoes.propostas[0]).toMatchObject({ codigo: 'P5', sugerida: true });
    expect(res.body.sugestoes.vendas[0]).toMatchObject({ codigo: '#0060', sugerida: true });
    expect(ligacao(207)).toBeUndefined();
  });
});

describe('o relatório usa a posse da venda ligada', () => {
  it('quem não enxerga a venda ligada recebe o cadastro do card sem o equipamento da planilha; quem enxerga, com ele', async () => {
    expect((await ligar(201, { venda: '#0058' }, THIAGO)).status).toBe(200);           // venda da Giovanna ligada ao card da Nilce
    const nilce = await get('/clientes/vendasolar/201/relatorio');
    expect(nilce.status).toBe(200);
    expect(nilce.body.secoes.map((x: any) => x.numero)).toEqual([1, 2, 3, 4, 5]);
    expect(JSON.stringify(nilce.body)).not.toContain('Bruno');
    const giovanna = await get('/clientes/vendasolar/201/relatorio', GIOVANNA);
    expect(giovanna.status).toBe(200);
    expect(giovanna.body.secoes.length).toBe(5);
    expect((await get('/clientes/vendasolar/201/relatorio', THIAGO)).body.secoes.length).toBe(5);
  });
});

describe('log de assinatura inválida', () => {
  it('uma vez por card por instância, não a cada GET', async () => {
    injeta(201, { proposta: 'P1' }, 'nenhuma');
    for (let i = 0; i < 4; i++) await docs(201);
    await vinculos(201);
    const vezes = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c.includes('sig_invalida')).length;
    expect(vezes).toBe(1);
    // outro card tem o seu próprio aviso
    injeta(206, { proposta: 'P1' }, 'torta');
    await vinculos(206);
    await vinculos(206);
    const depois = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c.includes('sig_invalida')).length;
    expect(depois).toBe(2);
  });
});

describe('cache de 60 s do GET de vínculos', () => {
  it('a lista de propostas vendidas é lida uma vez por minuto e o POST de vínculo a invalida', async () => {
    await vinculos(205);          // nome parecido: usa a lista de todas as vendidas
    await vinculos(205);
    await vinculos(205);
    expect(h.listagens).toBe(1);
    vi.setSystemTime(new Date('2026-10-20T15:01:01.000Z'));
    await vinculos(205);
    expect(h.listagens).toBe(2);
    await vinculos(205);
    expect(h.listagens).toBe(2);
    await ligar(205, { venda: '#0059' });
    await vinculos(205);
    expect(h.listagens).toBe(3);
  });
  it('a planilha da sugestão também é guardada; falha não entra no cache', async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).includes('docs.google.com')) throw new Error('rede caiu');
      throw new Error('rede indisponível no teste');
    });
    vi.stubGlobal('fetch', f);
    limparCacheClientes();
    const falha = await vinculos(205);
    expect(falha.body.vendas_indisponivel).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('docs.google.com') ? new Response(h.csv, { status: 200 }) : new Response('x', { status: 404 }))));
    limparCacheClientes();
    const volta = await vinculos(205);
    expect(volta.body.vendas_indisponivel).toBeUndefined();
    expect(volta.body.sugestoes.vendas.length).toBeGreaterThan(0);
  });
});

describe('nenhum dado pessoal em log', () => {
  it('nem nas ligações, nem no cadastro, nem na leitura', async () => {
    const espiao = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    espiao.forEach((e) => e.mockImplementation(() => {}));
    await vinculos(201);
    await put('/clientes/vendasolar/201/cadastro', { campos: { nome: 'ZZNOME Sigiloso', cpf_cnpj: '52998224725', tuc_nome: 'ZZTITULAR' } });
    h.ia.fila.push({ erro: Object.assign(new Error('ZZNOME Sigiloso 52998224725'), { status: 500 }) });
    anexa(201, [{ slot: 'conta_luz', uuid: U1, ext: 'pdf', mime: 'application/pdf', bytes: PDF.length, em: '2026-10-20T11:00:00.000Z' }]);
    h.objetos.set(`vendasolar/201/${U1}.pdf`, PDF);
    await post('/clientes/vendasolar/201/cadastro/ler', {});
    const tudo = JSON.stringify([...h.logs, ...espiao.flatMap((e) => e.mock.calls)]).toLowerCase();
    for (const proibido of ['zznome', 'zztitular', '52998224', 'ana souza', '98888']) expect(tudo).not.toContain(proibido);
  });
});
