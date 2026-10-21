import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Editar e trocar documentos do card de venda (21/10/2026): PATCH `{ slot, trocar: true }` (troca os dois de lugar numa gravação
// só), POST com `substitui` ("Trocar arquivo": o novo grava antes de o antigo sair) e DELETE. Mesmo cenário simulado do
// docsRotulos.route.test.ts (login, bancos, buckets e a Anthropic; nada sai para a rede). Dados inventados.

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
  /** Caminhos que o servidor mandou apagar do bucket dos documentos. */
  removidos: [] as string[],
  /** Quantas chamadas seguidas a `remove` do bucket dos documentos devem falhar. */
  removeFalhas: 0,
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
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(saidaEmLista(e.saida, (corpo as any)?.messages?.[0]?.content)) }] };
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
              : { data: { id: 'o1', name: p, size: t.length, contentType: cadastro ? 'application/json' : p.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }, error: null };
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
          remove: async (caminhos: string[]) => { if (!cadastro && h.removeFalhas > 0) { h.removeFalhas--; return { data: null, error: { message: 'fora do ar', statusCode: '500' } }; } if (!cadastro) { h.removidos.push(...caminhos); caminhos.forEach((c) => mapa.delete(c)); } return { data: [], error: null }; },
          createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x.test/${p}` }, error: null }),
          createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `https://up.test/${p}`, token: 'tk' }, error: null }),
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

import { saidaEmLista } from './_saidaIaEmLista';
import { mountCadastroVenda } from '../routes/geradorCadastroVenda';
import { mountClientesDocs } from '../routes/geradorClientesDocs';
import { limparCacheClientes } from '../routes/geradorClientes';
import { limparCachesSolar } from '../routes/geradorSolar';
import { limparCacheBucketDocs } from '../services/gerador/docsClienteBanco';
import { limparCacheBucketCadastros } from '../services/gerador/cadastroVendaBanco';
import { ordemDeLeitura, SLOTS_LIDOS, MOTIVO_NAO_COUBE, DESCRICAO_DOS_ITENS } from '../services/gerador/cadastroVendaLeitura';
import { CATALOGO } from '../services/gerador/docsCliente';
import { rotuloDaIa, rotuloManual } from '../services/gerador/docsRotulos';
import { cadastroLeituraLimiter } from '../middleware/rateLimiter';

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
    if (String(url).startsWith('https://x.test/')) return new Response(h.objetos.get(String(url).slice('https://x.test/'.length)) ?? Buffer.alloc(0), { status: 200 });
    throw new Error('rede indisponível no teste');
  }));
  limparCacheBucketDocs();
  limparCacheBucketCadastros();
  h.ia.fila = []; h.ia.chamadas = []; h.logs = []; h.removidos = []; h.removeFalhas = 0;
  delete process.env.CADASTRO_IA_MODELO;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T15:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const NOVO = (i: number, cardId = 101): string => `eletroposto/${cardId}/${uuid(i)}.jpg`;
const caminhoDe = (cardId: number, i: number): string | undefined => registro(cardId).arquivos.find((a) => a.id === idDe(i))?.caminho;
const post = (rota: string, corpo: unknown, auth = NILCE) => request(app).post(`${base}/${rota}`).set('Authorization', auth).send(corpo as object);
const apagar = (id: number, i: number | string, auth = NILCE) => request(app).delete(`${base}/${id}/docs/${typeof i === 'number' ? idDe(i) : i}`).set('Authorization', auth);

describe('PATCH com trocar: troca dos dois de lugar', () => {
  it('destino de um arquivo só ocupado + trocar:true: os dois mudam de item numa gravação, a resposta traz os dois', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }, { slot: 'conta_luz', i: 3 }]);
    const res = await patch(101, 1, { slot: 'documento_cedente', trocar: true });
    expect(res.status).toBe(200);
    expect(res.body.arquivo).toMatchObject({ id: idDe(1), slot: 'documento_cedente' });
    expect(res.body.trocado).toMatchObject({ id: idDe(2), slot: 'documento_titular' });
    expect(slotDe(101, 1)).toBe('documento_cedente');
    expect(slotDe(101, 2)).toBe('documento_titular');
    expect(slotDe(101, 3)).toBe('conta_luz');
    const t = registro(101).alteracoes.slice(-2);
    expect(t).toEqual([expect.objectContaining({ acao: 'moveu', slot: 'documento_cedente' }), expect.objectContaining({ acao: 'moveu', slot: 'documento_titular' })]);
    // o GET mostra a mesma coisa
    const g = await getDocs(101);
    const por = Object.fromEntries(g.body.arquivos.map((a: any) => [a.id, a.slot]));
    expect(por).toMatchObject({ [idDe(1)]: 'documento_cedente', [idDe(2)]: 'documento_titular' });
  });
  it('sem trocar: segue o 409 slot_ocupado, com frase clara, e nada muda', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }]);
    const res = await patch(101, 1, { slot: 'documento_cedente' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, motivo: 'slot_ocupado' });
    expect(res.body.error).toMatch(/Troque os dois de lugar/);
    const falso = await patch(101, 1, { slot: 'documento_cedente', trocar: 'true' });
    expect(falso.status).toBe(409);
    expect(slotDe(101, 1)).toBe('documento_titular');
    expect(slotDe(101, 2)).toBe('documento_cedente');
  });
  it('permissão: outro consultor e venda alheia dão 404 igual (nada muda); o sócio pode', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }]);
    const alheio = await patch(101, 1, { slot: 'documento_cedente', trocar: true }, GIOVANNA);
    expect(alheio.status).toBe(404);
    const inexistente = await patch(999, 1, { slot: 'documento_cedente', trocar: true }, NILCE);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body).toEqual(alheio.body);
    const daOutra = await patch(102, 1, { slot: 'documento_cedente', trocar: true }, NILCE);   // o 102 é da Giovanna
    expect(daOutra.status).toBe(404);
    expect(slotDe(101, 1)).toBe('documento_titular');
    expect((await patch(101, 1, { slot: 'documento_cedente', trocar: true }, THIAGO)).status).toBe(200);
    expect(slotDe(101, 1)).toBe('documento_cedente');
  });
  it('destino que aceita vários (ou vazio) não precisa de troca: é um move comum, mesmo com trocar:true', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_outra_pessoa', i: 2 }, { slot: 'documento_cedente', i: 3 }]);
    const a = await patch(101, 1, { slot: 'documento_outra_pessoa', trocar: true });
    expect(a.status).toBe(200);
    expect(a.body.trocado).toBeUndefined();
    expect(slotDe(101, 1)).toBe('documento_outra_pessoa');
    expect(slotDe(101, 2)).toBe('documento_outra_pessoa');
    const b = await patch(101, 3, { slot: 'comprovante_endereco_cedente', trocar: true });
    expect(b.status).toBe(200);
    expect(b.body.trocado).toBeUndefined();
    expect(slotDe(101, 3)).toBe('comprovante_endereco_cedente');
  });
  it('o arquivo que está lá não cabe no item de origem: 400 e nada muda', async () => {
    anexa(101, [{ slot: 'foto_local', i: 1 }, { slot: 'documento_titular', i: 2, mime: 'application/pdf' }]);
    const res = await patch(101, 1, { slot: 'documento_titular', trocar: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, motivo: 'troca_nao_cabe' });
    expect(slotDe(101, 1)).toBe('foto_local');
    expect(slotDe(101, 2)).toBe('documento_titular');
  });
  it('a gravação falha: nenhum dos dois muda de lugar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }]);
    h.docsGravaFalha = true;
    const res = await patch(101, 1, { slot: 'documento_cedente', trocar: true });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(slotDe(101, 1)).toBe('documento_titular');
    expect(slotDe(101, 2)).toBe('documento_cedente');
  });
});

describe('DELETE do documento', () => {
  it('o dono e o sócio apagam (registro e objeto); outro consultor leva 404 e o arquivo fica', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }, { slot: 'conta_luz', i: 3 }]);
    const c1 = caminhoDe(101, 1)!;
    const alheio = await apagar(101, 1, GIOVANNA);
    expect(alheio.status).toBe(404);
    expect(registro(101).arquivos).toHaveLength(3);
    expect(h.removidos).toEqual([]);
    const dono = await apagar(101, 1);
    expect(dono.status).toBe(200);
    expect(registro(101).arquivos.map((a) => a.id)).toEqual([idDe(2), idDe(3)]);
    expect(h.removidos).toEqual([c1]);
    expect(registro(101).alteracoes[registro(101).alteracoes.length - 1]).toMatchObject({ acao: 'removeu', slot: 'documento_titular' });
    expect((await apagar(101, 2, THIAGO)).status).toBe(200);
    expect(registro(101).arquivos.map((a) => a.id)).toEqual([idDe(3)]);
    expect((await apagar(101, 1)).status).toBe(404);
    expect((await apagar(101, 'nao-e-id')).status).toBe(400);
  });
});

describe('Trocar arquivo (substitui)', () => {
  const corpo = (i: number, extra: Record<string, unknown> = {}) => ({ slot: 'documento_titular', caminho: NOVO(i), ...extra });
  it('item de um arquivo só ocupado: o novo grava, o antigo sai do registro e só depois o objeto antigo é apagado', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }]);
    const velho = caminhoDe(101, 1)!;
    h.objetos.set(NOVO(50), JPG);
    const res = await post('101/docs', corpo(50, { substitui: idDe(1) }));
    expect(res.status).toBe(200);
    expect(res.body.substituiu).toBe(idDe(1));
    expect(res.body.arquivo).toMatchObject({ slot: 'documento_titular' });
    const arqs = registro(101).arquivos;
    expect(arqs).toHaveLength(2);
    expect(arqs.filter((a) => a.slot === 'documento_titular').map((a) => a.caminho)).toEqual([NOVO(50)]);
    expect(arqs.find((a) => a.slot === 'documento_cedente')).toBeTruthy();
    expect(h.removidos).toEqual([velho]);
    expect(h.objetos.has(velho)).toBe(false);
    expect(h.objetos.has(NOVO(50))).toBe(true);
  });
  it('o objeto antigo não sai na 1ª tentativa: tenta de novo e apaga', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }]);
    const velho = caminhoDe(101, 1)!;
    h.objetos.set(NOVO(54), JPG);
    h.removeFalhas = 1;
    const res = await post('101/docs', corpo(54, { substitui: idDe(1) }));
    expect(res.status).toBe(200);
    expect(h.removidos).toEqual([velho]);
    expect(h.objetos.has(velho)).toBe(false);
  });
  it('o objeto antigo não sai nas duas tentativas: a troca vale, e o log diz a venda e o arquivo, nunca o caminho', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'documento_titular', i: 1 }]);
    const velho = caminhoDe(101, 1)!;
    h.objetos.set(NOVO(55), JPG);
    h.removeFalhas = 2;
    const res = await post('101/docs', corpo(55, { substitui: idDe(1) }));
    expect(res.status).toBe(200);
    expect(registro(101).arquivos.map((a) => a.caminho)).toEqual([NOVO(55)]);
    const linhas = erro.mock.calls.map((c) => c.join(' '));
    expect(linhas.some((l) => l.includes('precisa de limpeza') && l.includes('eletroposto:101') && l.includes(idDe(1)))).toBe(true);
    expect(linhas.join(' | ')).not.toContain(velho);
  });
  it('o nome que a pessoa deu ao arquivo passa para o novo; o nome da IA e o tipo lido do antigo saem', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }]);
    poeRotulo(101, 1, 'CNH do Carlos', 'manual');
    poeRotulo(101, 2, 'Nome da IA', 'ia');
    const comTipos = rotulosNoBucket(101)!;
    (comTipos as any).tipos = { [idDe(1)]: 'documento_titular', [idDe(2)]: 'documento_cedente' };
    h.cad.set('eletroposto/101.docs.json', Buffer.from(JSON.stringify(comTipos)));
    h.objetos.set(NOVO(56), JPG);
    const res = await post('101/docs', corpo(56, { substitui: idDe(1) }));
    expect(res.status).toBe(200);
    const novoId = res.body.arquivo.id;
    const rot = rotulosNoBucket(101) as any;
    expect(rot.rotulos[novoId]).toMatchObject({ rotulo: 'CNH do Carlos', fonte: 'manual' });
    expect(rot.rotulos[idDe(1)]).toBeUndefined();
    expect(rot.tipos[idDe(1)]).toBeUndefined();
    expect(rot.rotulos[idDe(2)]).toMatchObject({ rotulo: 'Nome da IA' });   // o outro arquivo não muda
    expect(rot.tipos[idDe(2)]).toBe('documento_cedente');
    // rótulo da IA no antigo: não vai para o novo, mas o órfão sai
    h.objetos.set(NOVO(57), JPG);
    poeRotulo(101, 2, 'Nome da IA', 'ia');
    const r2 = await post('101/docs', { slot: 'documento_cedente', caminho: NOVO(57), substitui: idDe(2) });
    expect(r2.status).toBe(200);
    const rot2 = rotulosNoBucket(101) as any;
    expect(rot2.rotulos[r2.body.arquivo.id]).toBeUndefined();
    expect(rot2.rotulos[idDe(2)]).toBeUndefined();
  });
  it('sem substitui o item ocupado continua recusando (409) e o antigo fica', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }]);
    h.objetos.set(NOVO(51), JPG);
    const res = await post('101/docs', corpo(51));
    expect(res.status).toBe(409);
    expect(res.body.motivo).toBe('slot_ocupado');
    expect(slotDe(101, 1)).toBe('documento_titular');
    expect(h.objetos.has(caminhoDe(101, 1)!)).toBe(true);
  });
  it('a gravação do registro falha: o antigo fica no registro e no bucket', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anexa(101, [{ slot: 'documento_titular', i: 1 }]);
    const velho = caminhoDe(101, 1)!;
    h.objetos.set(NOVO(52), JPG);
    h.docsGravaFalha = true;
    const res = await post('101/docs', corpo(52, { substitui: idDe(1) }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(registro(101).arquivos.map((a) => a.id)).toEqual([idDe(1)]);
    expect(h.objetos.has(velho)).toBe(true);
    expect(h.removidos).not.toContain(velho);
  });
  it('recusas: id de outro item, id torto e outro consultor (404); a URL de envio segue a mesma regra', async () => {
    anexa(101, [{ slot: 'documento_titular', i: 1 }, { slot: 'documento_cedente', i: 2 }]);
    h.objetos.set(NOVO(53), JPG);
    expect((await post('101/docs', corpo(53, { substitui: idDe(2) }))).status).toBe(400);   // o 2 está em outro item
    expect((await post('101/docs', corpo(53, { substitui: 'x' }))).status).toBe(400);
    expect((await post('101/docs', corpo(53, { substitui: idDe(1) }), GIOVANNA)).status).toBe(404);
    expect(registro(101).arquivos.map((a) => a.id)).toEqual([idDe(1), idDe(2)]);
    const up = (extra: Record<string, unknown>, auth = NILCE) => post('101/docs/upload-url', { slot: 'documento_titular', mime: 'image/jpeg', bytes: 1000, ...extra }, auth);
    expect((await up({})).status).toBe(409);
    const ok = await up({ substitui: idDe(1) });
    expect(ok.status).toBe(200);
    expect(ok.body.upload_url).toContain('https://up.test/');
    expect((await up({ substitui: idDe(2) })).status).toBe(400);
    expect((await up({ substitui: idDe(1) }, GIOVANNA)).status).toBe(404);
  });
});
