import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rótulo do documento (nome dado a cada anexo da venda de eletroposto), PATCH que renomeia e move, e a leitura por IA que
// também organiza os anexos. Tudo simulado: login, os dois bancos, os dois buckets privados e a Anthropic (nada sai para a
// rede). Dados inventados. O que se prova: rótulo só no bucket `cadastros-venda` (nunca no `system_state`), GET que nunca
// cai por causa do rótulo, PATCH com guarda e limites, `ler` que move só de `outros`, o rótulo manual que sempre vence, e
// nenhum rótulo nem valor de campo em log.

type Entrada = { erro?: unknown; saida?: unknown };
const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, unknown>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  objetos: new Map<string, Buffer>(),
  cad: new Map<string, Buffer>(),
  cadFora: false,
  cadUploadFalha: false,
  docsGravaFalha: false,
  tique: 0,
  travaDuranteIA: null as boolean | null,
  /** As chaves de trava que existiam NO MOMENTO de cada gravação de rótulo/cadastro. */
  travasNoUpload: [] as string[][],
  /** Roda no meio da chamada à IA: simula alguém mexendo nos anexos enquanto o modelo lê. */
  durante: null as null | (() => void),
  ia: { fila: [] as Entrada[], chamadas: [] as Array<{ corpo: any }> },
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
      stream: (corpo: unknown) => {
        h.ia.chamadas.push({ corpo });
        h.travaDuranteIA = h.linhas.has('cadastro_trava:101');
        h.durante?.();
        const e = h.ia.fila.shift() ?? { erro: new Error('fila vazia') };
        return {
          finalMessage: async () => {
            if (e.erro) throw e.erro;
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(e.saida) }] };
          },
        };
      },
    },
  }),
}));
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
      if (tabela === 'propostas') {
        const b: any = { eq: () => b, order: () => b, range: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
        return { select: () => b };
      }
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const f: Record<string, unknown> = {};
          const b: any = {
            eq: (c: string, v: unknown) => { f[c] = v; return b; },
            ilike: () => b,
            order: () => b,
            range: async () => ({ data: h.cards.filter((r) => ('status' in f ? r.status === f.status : true)), error: null }),
            maybeSingle: async () => ({ data: h.cards.find((r) => r.id === f.id) ?? null, error: null }),
          };
          return b;
        },
      };
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      getBucket: async (nome: string) => {
        if (nome === 'cadastros-venda') {
          return h.cadFora
            ? { data: null, error: { message: 'fora do ar', statusCode: '500' } }
            : { data: { public: false, file_size_limit: 262144, allowed_mime_types: ['application/json'] }, error: null };
        }
        return { data: { public: false, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }, error: null };
      },
      createBucket: async () => ({ data: {}, error: null }),
      updateBucket: async () => ({ data: {}, error: null }),
      from: (nome: string) => {
        const cadastro = nome === 'cadastros-venda';
        const mapa = cadastro ? h.cad : h.objetos;
        const fora = (): boolean => cadastro && h.cadFora;
        return {
          info: async (p: string) => {
            if (fora()) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
            const t = mapa.get(p);
            return t === undefined
              ? { data: null, error: { message: 'Object not found', statusCode: '404' } }
              : { data: { id: 'o1', name: p, size: t.length, contentType: 'application/json' }, error: null };
          },
          download: async (p: string) => {
            if (fora()) return { data: null, error: { message: '{}', status: 500 } };
            const t = mapa.get(p);
            return t === undefined
              ? { data: null, error: { message: '{}', status: 400 } }
              : { data: { text: async () => t.toString('utf8'), arrayBuffer: async () => t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength) }, error: null };
          },
          upload: async (p: string, corpo: Buffer) => {
            if (fora() || (cadastro && h.cadUploadFalha)) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
            if (cadastro) h.travasNoUpload.push([...h.linhas.keys()].filter((k) => k.startsWith('cadastro_trava:')));
            mapa.set(p, Buffer.from(corpo));
            return { data: { path: p }, error: null };
          },
          list: async (pasta: string) => {
            const nomes = new Set<string>();
            for (const k of mapa.keys()) if (k.startsWith(pasta + '/')) nomes.add(k.slice(pasta.length + 1).split('/')[0]);
            return { data: [...nomes].map((name) => ({ name })), error: null };
          },
          createSignedUrls: async (caminhos: string[]) => ({ data: caminhos.map((path) => ({ path, signedUrl: `https://x.test/${path}`, error: null })), error: null }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-19T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
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
        }),
        insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: l.key.startsWith('cadastro_trava:') ? String(l.updated_at) : stamp() });
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
        update: (novo: { value: unknown; updated_at: string }) => ({
          eq: (_c: string, k: string) => {
            const faz = (ok: (l: { updated_at: string }) => boolean) => ({
              select: async () => {
                if (h.docsGravaFalha && k.startsWith('docs_cliente:')) return { data: null, error: { code: '500', message: 'fora' } };
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

import { mountCadastroVenda } from '../routes/geradorCadastroVenda';
import { mountClientesDocs } from '../routes/geradorClientesDocs';
import { limparCacheClientes } from '../routes/geradorClientes';
import { limparCachesSolar } from '../routes/geradorSolar';
import { limparCacheBucketDocs } from '../services/gerador/docsClienteBanco';
import { limparCacheBucketCadastros } from '../services/gerador/cadastroVendaBanco';
import { ordemDeLeitura, SLOTS_LIDOS, MOTIVO_NAO_COUBE } from '../services/gerador/cadastroVendaLeitura';
import { rotuloDaIa, rotuloManual } from '../services/gerador/docsRotulos';

// Planilha do Solar (só para a posse das vendas #0057 da Nilce e #0058 da Giovanna). Cabeçalho igual ao da planilha real.
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
function vendaSolar(codigo: string, campos: Record<string, string>): string[] {
  const l = new Array(CABECALHO.length).fill('');
  l[0] = codigo;
  for (const [nome, v] of Object.entries(campos)) l[CABECALHO.indexOf(nome)] = v;
  return l;
}
const planilha = (): string => [CABECALHO,
  vendaSolar('#0057', { 'NOME CLIENTE': 'Ana Souza', CONSULTOR: 'Nilce', CIDADE: 'Uberlandia', UF: 'MG', 'CADASTRO TRELLO': '03/08/2026' }),
  vendaSolar('#0058', { 'NOME CLIENTE': 'Bruno Lima', CONSULTOR: 'Giovanna', 'CADASTRO TRELLO': '01/09/2026' }),
].map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

const r = Router();
mountClientesDocs(r);
mountCadastroVenda(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PDF = Buffer.from('%PDF-1.4\nconta de luz de teste\n%%EOF');

const uuid = (i: number): string => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;
const idDe = (i: number): string => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
const hora = (i: number): string => `2026-10-19T10:${String(i % 60).padStart(2, '0')}:00.000Z`;

interface Doc { slot: string; mime?: string; i: number }
/** Anexa documentos à venda; o arquivo `i` tem id `idDe(i)` e caminho `eletroposto/<id>/<uuid(i)>.<ext>`. Põe os bytes no bucket. */
const anexa = (cardId: number, docs: Doc[]) => {
  h.linhas.set(`docs_cliente:eletroposto:${cardId}`, {
    updated_at: 'd0',
    value: {
      arquivos: docs.map((d) => {
        const mime = d.mime ?? 'image/jpeg';
        const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
        const caminho = `eletroposto/${cardId}/${uuid(d.i)}.${ext}`;
        h.objetos.set(caminho, mime === 'application/pdf' ? PDF : JPG);
        return { id: idDe(d.i), slot: d.slot, caminho, mime, bytes: mime === 'application/pdf' ? PDF.length : JPG.length, em: hora(d.i), por: 'nilce' };
      }),
      alteracoes: [], apagados: [],
    },
  });
};
const registro = (cardId: number) => (h.linhas.get(`docs_cliente:eletroposto:${cardId}`)!.value as { arquivos: Array<{ id: string; slot: string; caminho: string }>; alteracoes: Array<{ acao: string; slot?: string }> });
const slotDe = (cardId: number, i: number): string | undefined => registro(cardId).arquivos.find((a) => a.id === idDe(i))?.slot;
const rotulosNoBucket = (cardId: number) => (h.cad.has(`eletroposto/${cardId}.docs.json`)
  ? JSON.parse(h.cad.get(`eletroposto/${cardId}.docs.json`)!.toString('utf8')) as { v: number; rotulos: Record<string, { rotulo: string; fonte: string; por: string; em: string }> }
  : null);
const poeRotulo = (cardId: number, i: number, rotulo: string, fonte: 'ia' | 'manual') => {
  const atual = rotulosNoBucket(cardId) ?? { v: 1, rotulos: {} };
  atual.rotulos[idDe(i)] = { rotulo, fonte, por: 'x', em: '2026-10-19T09:00:00.000Z' };
  h.cad.set(`eletroposto/${cardId}.docs.json`, Buffer.from(JSON.stringify(atual)));
};

/** Resposta da IA: nenhum campo achado e a lista de documentos pedida. */
const iaDocs = (documentos: Array<{ indice: number; tipo: string; rotulo: string }>) => ({ saida: { documentos } });

const base = '/gerador/clientes/eletroposto';
const getDocs = (id: number, auth = NILCE) => request(app).get(`${base}/${id}/docs`).set('Authorization', auth);
const patch = (id: number, i: number | string, corpo: unknown, auth = NILCE) =>
  request(app).patch(`${base}/${id}/docs/${typeof i === 'number' ? idDe(i) : i}`).set('Authorization', auth).send(corpo as object);
const ler = (id: number, auth = NILCE) => request(app).post(`${base}/${id}/cadastro/ler`).set('Authorization', auth).send({});

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app',
  };
  h.cards = [
    { id: 101, cliente_nome: 'Carlos Alves', cliente_telefone: '', cidade: '', vendedor_nome: 'Nilce', created_by: 'lp_eletroposto', status: 'fechou', created_at: '2026-09-10T15:00:00.000Z' },
    { id: 102, cliente_nome: 'Dora Reis', cliente_telefone: '', cidade: '', vendedor_nome: 'Giovanna', created_by: 'manychat_eletroposto', status: 'fechou', created_at: '2026-09-10T15:00:00.000Z' },
  ];
  h.linhas = new Map(); h.objetos = new Map(); h.cad = new Map();
  h.cadFora = false; h.cadUploadFalha = false; h.docsGravaFalha = false; h.tique = 0; h.travaDuranteIA = null; h.durante = null; h.travasNoUpload = [];
  limparCacheClientes(); limparCachesSolar();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('docs.google.com')) return new Response(planilha(), { status: 200 });
    throw new Error('rede indisponível no teste');
  }));
  limparCacheBucketDocs();
  limparCacheBucketCadastros();
  h.ia.fila = []; h.ia.chamadas = []; h.logs = [];
  delete process.env.CADASTRO_IA_MODELO;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T15:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('rótulo no GET dos documentos', () => {
  it('devolve rotulo e rotulo_fonte só nos arquivos que têm; os outros seguem como antes', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'conta_luz', i: 2 }, { slot: 'outros', i: 3 }]);
    poeRotulo(101, 1, 'Matrícula do imóvel', 'ia');
    poeRotulo(101, 3, 'Planta que eu nomeei', 'manual');
    const res = await getDocs(101);
    expect(res.status).toBe(200);
    expect(res.body.rotulos_indisponivel).toBeUndefined();
    const por = Object.fromEntries(res.body.arquivos.map((a: any) => [a.id, a]));
    expect(por[idDe(1)]).toMatchObject({ rotulo: 'Matrícula do imóvel', rotulo_fonte: 'ia', slot: 'outros' });
    expect(por[idDe(3)]).toMatchObject({ rotulo: 'Planta que eu nomeei', rotulo_fonte: 'manual' });
    expect('rotulo' in por[idDe(2)]).toBe(false);
    expect('rotulo_fonte' in por[idDe(2)]).toBe(false);
  });
  it('JSON dos rótulos torto ou bucket fora do ar: a lista vem normal, com rotulos_indisponivel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'conta_luz', i: 2 }]);
    h.cad.set('eletroposto/101.docs.json', Buffer.from('{isto nao e json'));
    const a = await getDocs(101);
    expect(a.status).toBe(200);
    expect(a.body.rotulos_indisponivel).toBe(true);
    expect(a.body.arquivos).toHaveLength(2);
    expect(a.body.arquivos[0].url).toContain('https://x.test/');
    h.cad.delete('eletroposto/101.docs.json');
    h.cadFora = true;
    const b = await getDocs(101);
    expect(b.status).toBe(200);
    expect(b.body.rotulos_indisponivel).toBe(true);
    expect(b.body.arquivos).toHaveLength(2);
  });
  it('o relatório de engenharia usa só o rótulo da IA; o manual (pode ter nome de pessoa) fica de fora e sai o nome do item', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'conta_luz', i: 2 }, { slot: 'outros', i: 3 }]);
    poeRotulo(101, 1, 'Cartão CNPJ', 'ia');
    poeRotulo(101, 3, 'ZZDocumento da Maria', 'manual');
    poeRotulo(101, 2, 'ZZConta do João', 'manual');
    const res = await request(app).get(`${base}/101/relatorio`).set('Authorization', NILCE);
    expect(res.status).toBe(200);
    const rotulos = res.body.documentos.map((d: any) => `${d.slot}:${d.rotulo}`);
    expect(rotulos).toContain('outros:Cartão CNPJ');
    expect(rotulos).toContain('outros:Outros documentos');
    expect(rotulos).toContain('conta_luz:Conta de luz');
    expect(JSON.stringify(res.body)).not.toContain('ZZ');
  });
});

describe('PATCH renomeia e move', () => {
  it('renomeia: grava no bucket privado como manual, devolve o arquivo, e "" limpa', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    const a = await patch(101, 1, { rotulo: '  Matrícula   da casa  ' });
    expect(a.status).toBe(200);
    expect(a.body.arquivo).toMatchObject({ id: idDe(1), slot: 'outros', rotulo: 'Matrícula da casa', rotulo_fonte: 'manual' });
    const g = rotulosNoBucket(101)!;
    expect(g.v).toBe(1);
    expect(g.rotulos[idDe(1)]).toMatchObject({ rotulo: 'Matrícula da casa', fonte: 'manual', por: 'nilce' });
    expect((await getDocs(101)).body.arquivos[0].rotulo).toBe('Matrícula da casa');
    const b = await patch(101, 1, { rotulo: '   ' });
    expect(b.status).toBe(200);
    expect('rotulo' in b.body.arquivo).toBe(false);
    expect(rotulosNoBucket(101)!.rotulos[idDe(1)]).toBeUndefined();
  });
  it('rótulo com mais de 60 caracteres, que não é texto, ou corpo sem rotulo nem slot: 400', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    expect((await patch(101, 1, { rotulo: 'x'.repeat(61) })).status).toBe(400);
    expect((await patch(101, 1, { rotulo: 'x'.repeat(60) })).status).toBe(200);
    expect((await patch(101, 1, { rotulo: 42 })).status).toBe(400);
    expect((await patch(101, 1, { rotulo: null })).status).toBe(400);
    expect((await patch(101, 1, {})).status).toBe(400);
    expect((await patch(101, 1, { slot: 'nao_existe' })).status).toBe(400);
    expect((await patch(101, 'nao-e-um-id', { rotulo: 'x' })).status).toBe(400);
  });
  it('move de outros para um item vazio: só o metadado muda, o caminho no bucket fica, e a trilha registra', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    const antes = registro(101).arquivos[0].caminho;
    const res = await patch(101, 1, { slot: 'conta_luz' });
    expect(res.status).toBe(200);
    expect(res.body.arquivo.slot).toBe('conta_luz');
    expect(slotDe(101, 1)).toBe('conta_luz');
    expect(registro(101).arquivos[0].caminho).toBe(antes);
    expect(registro(101).alteracoes[registro(101).alteracoes.length - 1]).toMatchObject({ acao: 'moveu', slot: 'conta_luz' });
    // renomear e mover no mesmo pedido
    const dois = await patch(101, 1, { slot: 'outros', rotulo: 'Conta da casa velha' });
    expect(dois.body.arquivo).toMatchObject({ slot: 'outros', rotulo: 'Conta da casa velha' });
  });
  it('item de um arquivo só já ocupado: 409 slot_ocupado, e nada muda', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'conta_luz', i: 2 }]);
    const res = await patch(101, 1, { slot: 'conta_luz' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, motivo: 'slot_ocupado' });
    expect(typeof res.body.error).toBe('string');
    expect(slotDe(101, 1)).toBe('outros');
  });
  it('item que não aceita o formato: 400 formato_nao_aceito (pdf em item de foto)', async () => {
    anexa(101, [{ slot: 'outros', i: 1, mime: 'application/pdf' }]);
    const res = await patch(101, 1, { slot: 'foto_local' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, motivo: 'formato_nao_aceito' });
    expect(slotDe(101, 1)).toBe('outros');
    // foto vai para item de foto
    anexa(101, [{ slot: 'outros', i: 2 }]);
    expect((await patch(101, 2, { slot: 'foto_local' })).status).toBe(200);
  });
  it('item que aceita vários: cabe até o limite de 20 (21º dá 409 muitos_no_item)', async () => {
    anexa(101, [...Array.from({ length: 20 }, (_, k) => ({ slot: 'instalacao', i: k + 1 })), { slot: 'outros', i: 30 }]);
    const res = await patch(101, 30, { slot: 'instalacao' });
    expect(res.status).toBe(409);
    expect(res.body.motivo).toBe('muitos_no_item');
  });
  it('com 60 arquivos na venda, mover um não esbarra no teto da venda', async () => {
    anexa(101, Array.from({ length: 60 }, (_, k) => ({ slot: 'outros', i: k + 1 })));
    expect((await patch(101, 7, { slot: 'conta_luz' })).status).toBe(200);
    expect(slotDe(101, 7)).toBe('conta_luz');
  });
  it('arquivo que não existe: 404', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    const res = await patch(101, 9, { rotulo: 'Qualquer' });
    expect(res.status).toBe(404);
  });
  it('guarda: consultor de outra venda leva o mesmo 404 de venda inexistente; sócio pode', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    const alheia = await patch(101, 1, { rotulo: 'Invasor' }, GIOVANNA);
    const inexistente = await patch(999, 1, { rotulo: 'Invasor' }, GIOVANNA);
    expect(alheia.status).toBe(404);
    expect(alheia.body).toEqual(inexistente.body);
    expect(rotulosNoBucket(101)).toBeNull();
    expect((await patch(101, 1, { rotulo: 'Do sócio' }, THIAGO)).status).toBe(200);
    expect((await patch(101, 1, { rotulo: 'Sem login' }, 'Bearer lixo')).status).toBe(401);
  });
  it('bucket dos rótulos fora do ar: renomear dá 503 e nada muda; só mover segue funcionando', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2 }]);
    h.cadFora = true;
    const a = await patch(101, 1, { rotulo: 'Nome', slot: 'conta_luz' });
    expect(a.status).toBe(503);
    expect(a.body.motivo).toBe('rotulos_indisponivel');
    expect(slotDe(101, 1)).toBe('outros');   // nada mudou pela metade
    const b = await patch(101, 2, { slot: 'conta_luz' });
    expect(b.status).toBe(200);
    expect(slotDe(101, 2)).toBe('conta_luz');
  });
  it('mover deu certo e gravar o nome falhou: 503 avisando que foi movido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.cadUploadFalha = true;
    const res = await patch(101, 1, { rotulo: 'Nome', slot: 'conta_luz' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, motivo: 'rotulos_indisponivel', movido: true });
    expect(slotDe(101, 1)).toBe('conta_luz');
  });
});

describe('POST cadastro/ler também organiza', () => {
  it('a trava da venda não fica segurada durante a chamada à IA (que leva até 90 s) e é solta no fim', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.ia.fila.push(iaDocs([{ indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz' }]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(h.travaDuranteIA).toBe(false);
    expect(h.linhas.has('cadastro_trava:101')).toBe(false);
    expect(res.body.aviso).toBeUndefined();
  });
  it('o índice do pedido aponta para o arquivo certo: conta de luz sai de outros, o resto fica com o nome', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2, mime: 'application/pdf' }]);
    // leitura: i=2 (mais recente) é o Arquivo 1; i=1 é o Arquivo 2
    h.ia.fila.push(iaDocs([
      { indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz da CEMIG' },
      { indice: 2, tipo: 'outro', rotulo: 'Matrícula do imóvel' },
    ]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.organizados).toEqual(expect.arrayContaining([
      { id: idDe(2), de: 'outros', para: 'conta_luz', rotulo: 'Conta de luz da CEMIG' },
      { id: idDe(1), de: 'outros', para: 'outros', rotulo: 'Matrícula do imóvel' },
    ]));
    expect(slotDe(101, 2)).toBe('conta_luz');
    expect(slotDe(101, 1)).toBe('outros');
    const g = rotulosNoBucket(101)!;
    expect(g.rotulos[idDe(2)]).toMatchObject({ rotulo: 'Conta de luz da CEMIG', fonte: 'ia', por: 'nilce' });
    expect(g.rotulos[idDe(1)]).toMatchObject({ rotulo: 'Matrícula do imóvel', fonte: 'ia' });
    // o pedido leva as chaves do catálogo e o esquema pede `documentos`
    const { corpo } = h.ia.chamadas[0];
    expect(corpo.system).toContain('"conta_luz"');
    expect(JSON.stringify(corpo.output_config.format.schema)).toContain('documentos');
    // aparece no GET
    const lista = (await getDocs(101)).body.arquivos;
    expect(lista.find((a: any) => a.id === idDe(2))).toMatchObject({ slot: 'conta_luz', rotulo: 'Conta de luz da CEMIG', rotulo_fonte: 'ia' });
  });
  it('arquivo que a pessoa pôs num item NUNCA é movido (só ganha nome se não tinha)', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'conta_luz', i: 2, mime: 'application/pdf' }]);
    // ordem: titular (grupo 1) é o Arquivo 1; conta_luz (grupo 2) é o Arquivo 2
    h.ia.fila.push(iaDocs([
      { indice: 1, tipo: 'conta_luz', rotulo: 'CNH' },
      { indice: 2, tipo: 'documento_titular', rotulo: 'Conta de luz da CEMIG' },
    ]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(slotDe(101, 1)).toBe('documento_titular');
    expect(slotDe(101, 2)).toBe('conta_luz');
    expect(res.body.organizados).toEqual(expect.arrayContaining([
      { id: idDe(1), de: 'documento_titular', para: 'documento_titular', rotulo: 'CNH' },
      { id: idDe(2), de: 'conta_luz', para: 'conta_luz', rotulo: 'Conta de luz da CEMIG' },
    ]));
    expect(registro(101).alteracoes.some((a) => a.acao === 'moveu')).toBe(false);
  });
  it('rótulo manual nunca é sobrescrito pela IA (nem aparece em organizados como feito pela IA); o da IA é trocado pelo novo da IA', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2 }]);
    poeRotulo(101, 1, 'Nome da Nilce', 'manual');
    poeRotulo(101, 2, 'Nome velho da IA', 'ia');
    // sem rótulo primeiro: nenhum dos dois; ordem por recência: i=2 é o Arquivo 1... mas rotulados vão para o grupo 3, recência decide
    h.ia.fila.push(iaDocs([
      { indice: 1, tipo: 'outro', rotulo: 'Rótulo novo A' },
      { indice: 2, tipo: 'outro', rotulo: 'Rótulo novo B' },
    ]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    const g = rotulosNoBucket(101)!;
    expect(g.rotulos[idDe(1)]).toMatchObject({ rotulo: 'Nome da Nilce', fonte: 'manual' });
    expect(g.rotulos[idDe(2)]).toMatchObject({ rotulo: 'Rótulo novo A', fonte: 'ia' });
    expect(res.body.organizados.map((o: any) => o.id)).toEqual([idDe(2)]);
  });
  it('rótulo manual vence também quando o arquivo é movido: o rótulo devolvido é o manual', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    poeRotulo(101, 1, 'Conta que eu chamo assim', 'manual');
    h.ia.fila.push(iaDocs([{ indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz da CEMIG' }]));
    const res = await ler(101);
    expect(res.body.organizados).toEqual([{ id: idDe(1), de: 'outros', para: 'conta_luz', rotulo: 'Conta que eu chamo assim' }]);
    expect(rotulosNoBucket(101)!.rotulos[idDe(1)]).toMatchObject({ rotulo: 'Conta que eu chamo assim', fonte: 'manual' });
  });
  it('dois arquivos do mesmo item de um arquivo só: o primeiro vai, o segundo fica em outros', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2 }]);
    h.ia.fila.push(iaDocs([
      { indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz' },
      { indice: 2, tipo: 'conta_luz', rotulo: 'Outra conta de luz' },
    ]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    const noItem = registro(101).arquivos.filter((a) => a.slot === 'conta_luz');
    expect(noItem).toHaveLength(1);
    expect(registro(101).arquivos.filter((a) => a.slot === 'outros')).toHaveLength(1);
    expect(res.body.organizados).toHaveLength(2);   // o que ficou em outros ganhou nome
  });
  it('item cheio, formato que o item não aceita e tipo desconhecido: não move', async () => {
    anexa(101, [
      { slot: 'conta_luz', i: 1 }, { slot: 'outros', i: 2 },                 // conta_luz ocupado
      { slot: 'outros', i: 3, mime: 'application/pdf' },                      // pdf para item de foto
      { slot: 'outros', i: 4 },                                               // tipo inventado
    ]);
    // a IA responde pelo número do pedido: o teste usa a mesma ordem que o servidor usa
    const ordem = ordemDeLeitura((h.linhas.get('docs_cliente:eletroposto:101')!.value as any).arquivos);
    const tipoPorId: Record<string, string> = { [idDe(2)]: 'conta_luz', [idDe(3)]: 'foto_local', [idDe(4)]: 'tipo_que_nao_existe' };
    h.ia.fila.push(iaDocs(ordem.map((a, k) => ({ indice: k + 1, tipo: tipoPorId[a.id] ?? 'outro', rotulo: `Doc ${k + 1}` }))));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(slotDe(101, 2)).toBe('outros');
    expect(slotDe(101, 3)).toBe('outros');
    expect(slotDe(101, 4)).toBe('outros');
    expect(slotDe(101, 1)).toBe('conta_luz');
    // todos ganharam nome
    expect(res.body.organizados).toHaveLength(4);
  });
  it('a pessoa mexe nos anexos enquanto a IA lê: quem já foi posto num item não é movido, e quem foi removido é pulado', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2 }, { slot: 'outros', i: 3 }]);
    // leitura: i=3 é o Arquivo 1, i=2 o 2, i=1 o 3. Durante a IA: o 3 vai para o titular à mão e o 2 é removido.
    h.durante = () => {
      const reg = h.linhas.get('docs_cliente:eletroposto:101')!;
      const v = reg.value as { arquivos: Array<{ id: string; slot: string }> };
      v.arquivos = v.arquivos.filter((a) => a.id !== idDe(2)).map((a) => (a.id === idDe(3) ? { ...a, slot: 'documento_titular' } : a));
      reg.updated_at = 'd1';
    };
    h.ia.fila.push(iaDocs([
      { indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz' },
      { indice: 2, tipo: 'conta_luz', rotulo: 'Conta removida' },
      { indice: 3, tipo: 'procuracao', rotulo: 'Procuração' },
    ]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(slotDe(101, 3)).toBe('documento_titular');   // a escolha da pessoa vale
    expect(slotDe(101, 2)).toBeUndefined();
    expect(slotDe(101, 1)).toBe('procuracao');          // o único que seguia em outros
    expect(rotulosNoBucket(101)!.rotulos[idDe(2)]).toBeUndefined();   // sem rótulo para arquivo que não existe mais
    expect(res.body.organizados.map((o: any) => o.id).sort()).toEqual([idDe(1), idDe(3)].sort());
  });
  it('foto que está em outros e a IA vê como foto do local: vai para o item de foto', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.ia.fila.push(iaDocs([{ indice: 1, tipo: 'foto_local', rotulo: 'Foto do local' }]));
    const res = await ler(101);
    expect(res.body.organizados).toEqual([{ id: idDe(1), de: 'outros', para: 'foto_local', rotulo: 'Foto do local' }]);
  });
  it('lê até 12 arquivos; o resto vai para ignorados com a mensagem de ler de novo', async () => {
    anexa(101, Array.from({ length: 14 }, (_, k) => ({ slot: 'outros', i: k + 1 })));
    h.ia.fila.push({ saida: {} });
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.lidos).toEqual([{ slot: 'outros', n: 12 }]);
    expect(res.body.ignorados).toHaveLength(2);
    expect(res.body.ignorados.every((i: any) => i.motivo === 'Não coube nesta leitura: aperte Ler de novo para os próximos.')).toBe(true);
    expect(res.body.ignorados[0].motivo).toBe(MOTIVO_NAO_COUBE);
    const textos = h.ia.chamadas[0].corpo.messages[0].content.filter((b: any) => b.type === 'text' && /^Arquivo \d+/.test(b.text));
    expect(textos).toHaveLength(12);
  });
  it('prioridade: outros sem rótulo, depois titular, conta de luz e os demais; os sem nome entram antes dos com nome', () => {
    const f = (i: number, slot: string) => ({ id: idDe(i), slot, caminho: `eletroposto/101/${uuid(i)}.jpg`, mime: 'image/jpeg', bytes: 10, em: hora(i), por: 'x' });
    const arquivos = [
      f(1, 'outros'), f(2, 'outros'), f(3, 'documento_titular'), f(4, 'conta_luz'), f(5, 'contrato_assinado'),
      f(6, 'outros'), f(7, 'foto_local'), f(8, 'procuracao'),
    ];
    const rotulados = new Set([idDe(2), idDe(8)]);
    const ordem = ordemDeLeitura(arquivos, rotulados).map((a) => a.id);
    // grupo 0 = outros sem rótulo (6 depois 1, mais recente primeiro); grupo 1 = titular; 2 = conta; 3 = o resto (sem nome primeiro)
    expect(ordem).toEqual([idDe(6), idDe(1), idDe(3), idDe(4), idDe(5), idDe(8), idDe(2)]);
    expect(ordem).not.toContain(idDe(7));   // foto não é lida
  });
  it('os itens só de foto não entram na leitura; os de documento entram', () => {
    expect(SLOTS_LIDOS).toEqual(expect.arrayContaining(['documento_titular', 'conta_luz', 'contrato_assinado', 'procuracao', 'anuencia', 'vistoria', 'art', 'projeto', 'parecer_acesso', 'outros']));
    for (const foto of ['foto_local', 'padrao', 'quadro_eletrico', 'instalacao']) expect(SLOTS_LIDOS).not.toContain(foto);
  });
  it('falha ao mover (banco dos documentos recusa a gravação) NÃO derruba as sugestões: vem aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.docsGravaFalha = true;
    h.ia.fila.push({ saida: { nome: { valor: 'Carlos Alves', slot: 'outros', confianca: 'alta' }, documentos: [{ indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz' }] } });
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.sugestoes.nome.valor).toBe('Carlos Alves');
    expect(res.body.aviso).toMatch(/mover/);
    expect(slotDe(101, 1)).toBe('outros');
    expect(res.body.organizados).toEqual([{ id: idDe(1), de: 'outros', para: 'outros', rotulo: 'Conta de luz' }]);   // o nome foi gravado
  });
  it('falha ao gravar os nomes: sugestões e movimento seguem, com aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.cadUploadFalha = true;
    h.ia.fila.push({ saida: { nome: { valor: 'Carlos Alves', slot: 'outros', confianca: 'alta' }, documentos: [{ indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz' }] } });
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.sugestoes.nome.valor).toBe('Carlos Alves');
    expect(res.body.aviso).toMatch(/nomes/);
    expect(slotDe(101, 1)).toBe('conta_luz');
    expect(res.body.organizados).toEqual([{ id: idDe(1), de: 'outros', para: 'conta_luz', rotulo: '' }]);
  });
  it('bucket dos rótulos fora do ar na leitura: as sugestões vêm, o movimento ainda acontece e há aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.cadFora = true;
    h.ia.fila.push({ saida: { nome: { valor: 'Carlos Alves', slot: 'outros', confianca: 'alta' }, documentos: [{ indice: 1, tipo: 'conta_luz', rotulo: 'Conta de luz' }] } });
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.sugestoes.nome.valor).toBe('Carlos Alves');
    expect(res.body.aviso).toBeTruthy();
    expect(slotDe(101, 1)).toBe('conta_luz');
  });
  it('aviso dos nomes só quando havia nome a gravar: sem rótulo da IA e bucket fora do ar, o movimento segue sem aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.cadFora = true;
    h.ia.fila.push(iaDocs([{ indice: 1, tipo: 'conta_luz', rotulo: '' }]));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(slotDe(101, 1)).toBe('conta_luz');
    expect(res.body.aviso).toBeUndefined();
    expect(res.body.organizados).toEqual([{ id: idDe(1), de: 'outros', para: 'conta_luz', rotulo: '' }]);
  });
  it('sem a lista de documentos na resposta da IA: organizados vazio e sem aviso', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.ia.fila.push({ saida: { nome: { valor: 'Carlos Alves', slot: 'outros', confianca: 'alta' } } });
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.organizados).toEqual([]);
    expect(res.body.aviso).toBeUndefined();
    expect(slotDe(101, 1)).toBe('outros');
  });
  it('índice fora da faixa, repetido ou torto é ignorado', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    h.ia.fila.push(iaDocs([
      { indice: 7, tipo: 'conta_luz', rotulo: 'Fora' }, { indice: 0, tipo: 'conta_luz', rotulo: 'Zero' },
      { indice: 1.5, tipo: 'conta_luz', rotulo: 'Quebrado' },
      { indice: 1, tipo: 'outro', rotulo: 'Cartão CNPJ' }, { indice: 1, tipo: 'conta_luz', rotulo: 'Repetido' },
    ]));
    const res = await ler(101);
    expect(res.body.organizados).toEqual([{ id: idDe(1), de: 'outros', para: 'outros', rotulo: 'Cartão CNPJ' }]);
  });
  it('o desfecho de quem tem documento mas nenhum item legível continua igual (409 sem_documentos)', async () => {
    anexa(101, [{ slot: 'foto_local', i: 1 }]);
    const res = await ler(101);
    expect(res.status).toBe(409);
    expect(res.body.motivo).toBe('sem_documentos');
  });
});

describe('Solar: o mesmo rótulo, com a trava e a posse do Solar', () => {
  const baseSolar = '/gerador/clientes/solar';
  /** Anexa à venda `cod` (4 dígitos). O arquivo `i` tem id `idDe(i)`. */
  const anexaSolar = (cod: string, docs: Array<{ slot: string; i: number }>) => {
    h.linhas.set(`docs_cliente:solar:${cod}`, {
      updated_at: 'd0',
      value: {
        arquivos: docs.map((d) => ({ id: idDe(d.i), slot: d.slot, caminho: `solar/${cod}/${uuid(d.i)}.jpg`, mime: 'image/jpeg', bytes: JPG.length, em: hora(d.i), por: 'nilce' })),
        alteracoes: [], apagados: [],
      },
    });
  };
  const rotulosSolar = (cod: string) => (h.cad.has(`solar/${cod}.docs.json`)
    ? JSON.parse(h.cad.get(`solar/${cod}.docs.json`)!.toString('utf8')) as { rotulos: Record<string, { rotulo: string; fonte: string }> }
    : null);
  const getSolar = (cod: string, auth = NILCE) => request(app).get(`${baseSolar}/${cod}/docs`).set('Authorization', auth);
  const patchSolar = (cod: string, i: number, corpo: unknown, auth = NILCE) =>
    request(app).patch(`${baseSolar}/${cod}/docs/${idDe(i)}`).set('Authorization', auth).send(corpo as object);
  const delSolar = (cod: string, i: number, auth = NILCE) => request(app).delete(`${baseSolar}/${cod}/docs/${idDe(i)}`).set('Authorization', auth);

  it('GET: rotulo e rotulo_fonte nos arquivos da venda solar (rótulo em solar/0057.docs.json)', async () => {
    anexaSolar('0057', [{ slot: 'outros', i: 1 }, { slot: 'fachada', i: 2 }]);
    h.cad.set('solar/0057.docs.json', Buffer.from(JSON.stringify({ v: 1, rotulos: { [idDe(1)]: { rotulo: 'ART assinada', fonte: 'ia', por: 'x', em: 'y' } } })));
    const res = await getSolar('57');
    expect(res.status).toBe(200);
    const por = Object.fromEntries(res.body.arquivos.map((a: any) => [a.id, a]));
    expect(por[idDe(1)]).toMatchObject({ rotulo: 'ART assinada', rotulo_fonte: 'ia' });
    expect('rotulo' in por[idDe(2)]).toBe(false);
    expect(res.body.rotulos_indisponivel).toBeUndefined();
  });
  it('PATCH de rótulo: grava em solar/0057.docs.json sob a trava solar:0057 (não a do card 57) e solta a trava', async () => {
    anexaSolar('0057', [{ slot: 'outros', i: 1 }]);
    const res = await patchSolar('57', 1, { rotulo: 'Projeto aprovado' });
    expect(res.status).toBe(200);
    expect(res.body.arquivo).toMatchObject({ id: idDe(1), slot: 'outros', rotulo: 'Projeto aprovado', rotulo_fonte: 'manual' });
    expect(rotulosSolar('0057')!.rotulos[idDe(1)]).toMatchObject({ rotulo: 'Projeto aprovado', fonte: 'manual' });
    expect(h.travasNoUpload).toEqual([['cadastro_trava:solar:0057']]);
    expect([...h.linhas.keys()].some((k) => k.startsWith('cadastro_trava:'))).toBe(false);
    // o rótulo não vai para o system_state
    expect(JSON.stringify([...h.linhas.values()])).not.toContain('Projeto aprovado');
    // e o card 57 do eletroposto não é tocado
    expect(h.cad.has('eletroposto/57.docs.json')).toBe(false);
  });
  it('PATCH de item na venda solar: move dentro do catálogo do Solar e recusa item que é do eletroposto', async () => {
    anexaSolar('0057', [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2 }]);
    expect((await patchSolar('57', 1, { slot: 'conta_luz' })).status).toBe(200);
    expect(((h.linhas.get('docs_cliente:solar:0057')!.value as any).arquivos as Array<{ id: string; slot: string }>).find((a) => a.id === idDe(1))!.slot).toBe('conta_luz');
    const x = await patchSolar('57', 2, { slot: 'documento_titular' });   // só existe no eletroposto
    expect(x.status).toBe(400);
  });
  it('PATCH em venda solar de outro consultor: 404 igual ao DELETE e ao de venda inexistente, e nada é gravado', async () => {
    anexaSolar('0058', [{ slot: 'outros', i: 1 }]);
    const alheia = await patchSolar('58', 1, { rotulo: 'Invasor', slot: 'conta_luz' });   // Nilce na venda da Giovanna
    const apagar = await delSolar('58', 1);
    const inexistente = await patchSolar('999', 1, { rotulo: 'Invasor' });
    expect(alheia.status).toBe(404);
    expect(apagar.status).toBe(404);
    expect(alheia.body).toEqual(apagar.body);
    expect(alheia.body).toEqual(inexistente.body);
    expect(h.cad.size).toBe(0);
    expect(((h.linhas.get('docs_cliente:solar:0058')!.value as any).arquivos as Array<{ slot: string }>)[0].slot).toBe('outros');
    // a dona da venda e o sócio podem
    expect((await patchSolar('58', 1, { rotulo: 'Da dona' }, GIOVANNA)).status).toBe(200);
    expect((await patchSolar('58', 1, { rotulo: 'Do sócio' }, THIAGO)).status).toBe(200);
    expect(rotulosSolar('0058')!.rotulos[idDe(1)].rotulo).toBe('Do sócio');
  });
});

describe('limpeza do rótulo', () => {
  it('IA: corta em 60, começa com maiúscula, troca travessão e descarta número de documento e e-mail', () => {
    expect(rotuloDaIa('  cartão   CNPJ ')).toBe('Cartão CNPJ');
    expect(rotuloDaIa('Conta de luz — CEMIG')).toBe('Conta de luz - CEMIG');
    expect(rotuloDaIa('CNH 123456789')).toBe('');
    expect(rotuloDaIa('CPF 123.456.789-00')).toBe('');
    expect(rotuloDaIa('Contrato de 2 vias')).toBe('Contrato de 2 vias');
    expect(rotuloDaIa('fulano@exemplo.com')).toBe('');
    expect(rotuloDaIa(42)).toBe('');
    expect(rotuloDaIa('palavra '.repeat(20)).length).toBeLessThanOrEqual(60);
  });
  it('pessoa: aparar, juntar espaços, recusar mais de 60 e não-texto, "" limpa', () => {
    expect(rotuloManual('  a   b  ')).toEqual({ ok: true, valor: 'a b' });
    expect(rotuloManual('')).toEqual({ ok: true, valor: '' });
    expect(rotuloManual('x'.repeat(61)).ok).toBe(false);
    expect(rotuloManual(undefined).ok).toBe(false);
  });
});

describe('privacidade do rótulo', () => {
  it('nenhum rótulo, valor de campo ou nome vai para log; e nada de rótulo no system_state', async () => {
    const espiao = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info')];
    espiao.forEach((e) => e.mockImplementation(() => {}));
    anexa(101, [{ slot: 'outros', i: 1 }, { slot: 'outros', i: 2 }]);
    h.ia.fila.push({ saida: {
      nome: { valor: 'ZZNOME Sigiloso', slot: 'outros', confianca: 'alta' },
      documentos: [{ indice: 1, tipo: 'conta_luz', rotulo: 'ZZRotuloIA Secreto' }, { indice: 2, tipo: 'outro', rotulo: 'ZZOutroIA Secreto' }],
    } });
    await ler(101);
    await patch(101, 1, { rotulo: 'ZZManual Secreto', slot: 'outros' });
    await patch(101, 1, { rotulo: 'x'.repeat(61) });
    h.ia.fila.push({ erro: Object.assign(new Error('ZZNOME Sigiloso ZZManual'), { status: 500 }) });
    await ler(101);
    h.docsGravaFalha = true;
    h.ia.fila.push({ saida: { documentos: [{ indice: 1, tipo: 'conta_luz', rotulo: 'ZZFalha Secreto' }] } });
    await ler(101);
    h.docsGravaFalha = false;
    h.cadFora = true;
    await getDocs(101);
    await patch(101, 1, { rotulo: 'ZZForaDoAr Secreto' });
    const tudo = JSON.stringify([...h.logs, ...espiao.flatMap((e) => e.mock.calls)]).toLowerCase();
    expect(tudo.length).toBeGreaterThan(10);   // houve log (falhas), só sem conteúdo
    for (const proibido of ['zznome', 'zzrotulo', 'zzoutro', 'zzmanual', 'zzfalha', 'zzforadoar', 'secreto', 'sigiloso']) expect(tudo).not.toContain(proibido);
    // o system_state (legível pela chave pública) nunca guarda rótulo
    const estado = JSON.stringify([...h.linhas.entries()]).toLowerCase();
    for (const proibido of ['zzrotulo', 'zzoutro', 'zzmanual', 'zzfalha', 'secreto', 'rotulo']) expect(estado).not.toContain(proibido);
  });
  it('o rótulo mora só no bucket cadastros-venda, num objeto que a grade do cadastro não confunde com cadastro', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    await patch(101, 1, { rotulo: 'Escritura' });
    expect([...h.cad.keys()]).toEqual(['eletroposto/101.docs.json']);
    expect([...h.objetos.keys()].every((k) => !k.endsWith('.docs.json'))).toBe(true);
  });
  it('consultora de outra venda não lê os rótulos da venda alheia (o mesmo 404)', async () => {
    anexa(101, [{ slot: 'outros', i: 1 }]);
    poeRotulo(101, 1, 'Reservado', 'manual');
    const res = await getDocs(101, GIOVANNA);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Reservado');
  });
});
