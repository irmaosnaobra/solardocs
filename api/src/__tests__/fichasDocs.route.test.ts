import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Documentos e relatório de engenharia da ficha de clientes (Solar e Eletroposto): rotas com o login, a planilha, os
// dois bancos e o Storage simulados (dados inventados). O que se prova aqui: a posse (404 igual) ANTES de qualquer outra
// recusa, que o caminho é do servidor e só vale o que o Storage confirma, que o metadado não guarda nome de arquivo, o
// vínculo único com proposta vendida, que o relatório não leva dinheiro nem para sócio, o bucket público recusado e que
// log nenhum leva caminho.

type Obj = { size: number; contentType: string; conteudo: Buffer };
const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  csv: '',
  cards: [] as Array<Record<string, unknown>>,
  propostas: [] as Array<Record<string, any>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  objetos: new Map<string, Obj>(),
  bucket: null as null | Record<string, unknown>,
  erroUpdateBucket: false,
  erroInfo: false,
  chamadas: [] as Array<{ op: string; arg?: unknown }>,
  validades: [] as number[],
  noMeio: null as null | (() => void),
  tique: 0,
  sig: 0,
  ranges: [] as string[],
  falhaBytes: false,
  erroRemove: false,
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
    storage: {
      from: () => ({
        createSignedUrl: async (_p: string, seg: number) => { h.validades.push(seg); return { data: { signedUrl: `https://dossie.test/s${++h.sig}` }, error: null }; },
      }),
    },
    from: (tabela: string) => {
      if (tabela === 'agendamentos') {
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
      }
      if (tabela === 'propostas') {
        return {
          select: () => {
            const f: Record<string, unknown> = {};
            const b: any = {
              eq: (c: string, v: unknown) => { f[c] = v; return b; },
              order: () => b,
              range: async () => ({ data: h.propostas.filter((p) => ('vendido' in f ? p.vendido === f.vendido : true)), error: null }),
              maybeSingle: async () => ({ data: h.propostas.find((p) => p.codigo === f.codigo) ?? null, error: null }),
            };
            return b;
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      getBucket: async () => {
        h.chamadas.push({ op: 'getBucket' });
        return h.bucket ? { data: h.bucket, error: null } : { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
      },
      createBucket: async (_n: string, o: Record<string, unknown>) => {
        h.chamadas.push({ op: 'createBucket', arg: o });
        h.bucket = { public: !!o.public, file_size_limit: o.fileSizeLimit, allowed_mime_types: o.allowedMimeTypes };
        return { data: {}, error: null };
      },
      updateBucket: async (_n: string, o: Record<string, unknown>) => {
        h.chamadas.push({ op: 'updateBucket', arg: o });
        if (h.erroUpdateBucket) return { data: null, error: { message: 'x' } };
        h.bucket = { public: !!o.public, file_size_limit: o.fileSizeLimit, allowed_mime_types: o.allowedMimeTypes };
        return { data: {}, error: null };
      },
      from: (bucket?: string) => ({
        // O dossiê da venda (bucket `dossie-vendas`) também mora neste banco: a URL dele é opaca, sem o caminho.
        createSignedUrl: async (p: string, seg?: number) => {
          if (bucket === 'dossie-vendas') { h.validades.push(Number(seg)); return { data: { signedUrl: `https://dossie.test/s${++h.sig}` }, error: null }; }
          return { data: { signedUrl: `https://bytes.test/${encodeURIComponent(p)}` }, error: null };
        },
        createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `https://up.test/u?x=1`, token: 'tok-1', path: p }, error: null }),
        // Exatamente o que o storage-js devolve: `info` passa por recursiveToCamel (size, contentType).
        info: async (p: string) => {
          if (h.erroInfo) return { data: null, error: { message: `falhou em ${p}`, statusCode: '500' } };
          const o = h.objetos.get(p);
          return o ? { data: { id: 'o1', name: p, bucketId: 'fichas-docs', size: o.size, contentType: o.contentType }, error: null }
            : { data: null, error: { message: 'Object not found', statusCode: '404' } };
        },
        remove: async (ps: string[]) => { if (h.erroRemove) return { data: null, error: { message: `falhou ${ps[0]}`, statusCode: '500' } }; for (const p of ps) { h.objetos.delete(p); h.chamadas.push({ op: 'remove' }); } return { data: [], error: null }; },
        createSignedUrls: async (ps: string[], seg: number) => {
          h.validades.push(seg);
          return { data: ps.map((p) => (h.objetos.has(p) ? { path: p, signedUrl: `https://docs.test/s${++h.sig}`, error: null } : { path: p, signedUrl: null, error: 'Object not found' })), error: null };
        },
      }),
    },
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-14T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          in: async (_c: string, chaves: string[]) => ({ data: chaves.filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null }),
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => {
              const l = h.linhas.get(k);
              const r = { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
              if (h.noMeio) { const f = h.noMeio; h.noMeio = null; f(); }
              return r;
            },
          }),
        }),
        insert: async (l: { key: string; value: unknown }) => {
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: stamp() });
          return { error: null };
        },
        update: (novo: { value: unknown }) => ({
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
import { mountClientesEletroposto } from '../routes/geradorEletropostoClientes';
import { mountClientesDocs } from '../routes/geradorClientesDocs';
import { limparCacheBucketDocs } from '../services/gerador/docsClienteBanco';
import { mountSolar, limparCachesSolar } from '../routes/geradorSolar';
import { lerCaminho, nomesParecidos, lerRegistroDocs, CATALOGO, codigoDeRota, LIMITES, limiteDoItem } from '../services/gerador/docsCliente';
import { logger } from '../utils/logger';
import { supabaseGerador } from '../utils/supabaseGerador';

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
const SENT: Record<string, string> = {
  'ORIGEM DO LEAD': '#0013 ZZClienteAlheio',
  'VALOR DA VENDA': 'R$ 8.887,77', 'FORMA DE PAGTO': 'ZZFORMA11', 'RECEBIDO REAL': 'R$ 7.776,66', RECEBIMENTO: 'Quitado', 'PAGTO ART': 'ZZART22',
  'VALOR ART': 'R$ 654,32', 'VALOR PAGO DO PROJETO': 'R$ 987,65', 'VALOR KIT': 'R$ 4.321,09', 'TAXAS/DESCONTOS': 'R$ 111,22',
  'FATOR X': 'ZZFATOR12', FORNECEDOR: 'ZZFORN33', 'AC - CC': 'R$ 4.444,44', 'KM INICIAL': 'ZZKMI101', 'KM FINAL': 'ZZKMF202', 'KM TOTAL': 'ZZKMT303',
  'M.O / PEÇAS/ ALIM / HOSP/PED': 'R$ 555,44', NF: 'ZZNF55', 'COMISSÃO VENDA': 'R$ 333,21', 'PRÉ VENDA': 'R$ 222,10',
  'TOTAL CUSTO': 'R$ 6.543,21', 'TOTAL LUCRO': 'R$ 2.345,67', '% DE LUCRO': 'ZZPCT265', 'COLUNA NOVA DA PLANILHA': 'ZZNOVA77',
  'DEPOIMENTO INSTAGRAM': 'ZZDEPOIMENTO',
};
function venda(codigo: string, campos: Record<string, string>): string[] {
  const l = new Array(CABECALHO.length).fill('');
  l[0] = codigo;
  for (const [nome, v] of Object.entries({ ...SENT, ...campos })) l[CABECALHO.indexOf(nome)] = v;
  return l;
}
const paraCsv = (linhas: string[][]) => [CABECALHO, ...linhas]
  .map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
const planilha = () => paraCsv([
  venda('#0057', { 'NOME CLIENTE': 'Ana Souza', CONSULTOR: 'Nilce', CIDADE: 'Uberlandia', UF: 'MG', 'CADASTRO TRELLO': '03/08/2026', 'QTD PLACA': '10', CONTATO: '34988880001' }),
  venda('#0058', { 'NOME CLIENTE': 'Bruno Lima', CONSULTOR: 'Giovanna', 'CADASTRO TRELLO': '01/09/2026', 'SISTEMA LIBERADO PELA CONCESSIONARIA': 'Liberado' }),
  venda('#0059', { 'NOME CLIENTE': 'Ana Souza Pereira', CONSULTOR: 'Nilce', 'CADASTRO TRELLO': '20/08/2026' }),
]);

const r = Router();
mountSolar(r);
mountClientes(r);
mountClientesEletroposto(r);
mountClientesDocs(r);
const app = express();
app.set('trust proxy', 1);   // como no app.ts: o IP do limitador por IP vem do X-Forwarded-For
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const UUID = '0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4';
const UUID2 = '1c7a2d3f-4e5b-4c6d-9e7f-8091a2b3c4d5';

const card = (id: number, o: Record<string, unknown>) => ({
  id, cliente_nome: 'Fulano', cliente_telefone: '', cidade: '', vendedor_nome: 'Nilce', created_by: 'lp_eletroposto',
  status: 'fechou', created_at: '2026-09-10T15:00:00.000Z', ...o,
});
const PV_101 = {
  modelo: 'meio_a_meio', valor: 250000.55, vendido_em: '2026-09-20', etapa: 'projeto', etapa_desde: '2026-09-21T12:00:00.000Z',
  previsto: '2026-10-05', responsavel: 'ZZRESP', obs: 'ZZOBSPV', por: 'thiago', em: '2026-09-21T12:00:00.000Z',
};
const PV_102 = {
  modelo: 'carregador', valor: 9876.5, vendido_em: '2026-09-25', etapa: 'concluido', etapa_desde: '2026-10-01T12:00:00.000Z',
  previsto: null, responsavel: '', obs: '', por: 'giovanna', em: '2026-10-01T12:00:00.000Z',
};
const prop = (codigo: string, nome: string, o: Record<string, unknown> = {}) => ({
  codigo, cliente_nome: nome, consultor_nome: 'Nilce', cliente_cidade: 'Uberlandia', cliente_uf: 'MG', vendido: true, created_at: '2026-08-01T10:00:00.000Z',
  dados: {}, qtd_placas: null, inversor: null, qtd_inversor: null, ...o,
});
const DOSSIE_P1 = {
  dossie: { versao: 1, atualizado_em: 'x', campos: {}, trello: {}, arquivos: {
    documento: [{ path: 'IN-1/documento-1-abc.pdf', nome: 'CNH-ANA-SOUZA.pdf', tipo: 'application/pdf', bytes: 10, em: 'x', trello_status: 'pendente' }],
    fachada: [{ path: 'IN-1/fachada-2-abc.jpg', nome: 'casa-da-ana.jpg', tipo: 'image/jpeg', bytes: 10, em: 'x', trello_status: 'pendente' }],
  } },
};

let spyErr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-giovanna': 'giovanna@irmaosnaobra.app',
    'tk-estranho': 'alguem@gmail.com',
  };
  h.csv = planilha();
  h.cards = [
    card(101, { cliente_nome: 'Carlos Alves', cliente_telefone: '(34) 98888-0001', cidade: 'Uberlandia', vendedor_nome: 'Nilce' }),
    card(102, { cliente_nome: 'Dora Reis', cidade: 'Catalao', vendedor_nome: 'Giovanna', created_by: 'manychat_eletroposto' }),
    card(103, { cliente_nome: 'Eli Solar', vendedor_nome: 'Nilce', created_by: 'lp_solar' }),
    card(104, { cliente_nome: 'Fabio Agendado', vendedor_nome: 'Nilce', status: 'agendado' }),
  ];
  h.propostas = [
    prop('IN-1', 'Ana Souza', { dados: DOSSIE_P1 }),
    prop('IN-2', 'Ana Souza', { vendido: false }),
    prop('IN-3', 'Bruno Lima', { consultor_nome: 'Giovanna' }),
    prop('IN-4', 'Ana Souza Pereira'),
  ];
  h.linhas = new Map([
    ['pos_venda:101', { value: PV_101, updated_at: 'v1' }],
    ['pos_venda:102', { value: PV_102, updated_at: 'v2' }],
  ]);
  h.objetos = new Map(); h.bucket = { public: false, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] };
  h.ranges = []; h.falhaBytes = false; h.erroRemove = false; h.erroUpdateBucket = false; h.erroInfo = false; h.chamadas = []; h.validades = []; h.noMeio = null; h.tique = 0; h.sig = 0;
  delete process.env.SOLAR_SOCIOS;
  limparCacheClientes(); limparCachesSolar(); limparCacheBucketDocs();
  spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('docs.google.com')) return new Response(h.csv, { status: 200 });
    if (String(url).startsWith('https://bytes.test/')) {
      if (h.falhaBytes) throw new Error(`rede caiu em ${url}`);
      h.ranges.push(String((init?.headers as Record<string, string> | undefined)?.Range ?? ''));
      const o = h.objetos.get(decodeURIComponent(String(url).slice('https://bytes.test/'.length)));
      return o ? new Response(new Uint8Array(o.conteudo.subarray(0, 16)), { status: 206 }) : new Response('x', { status: 404 });
    }
    throw new Error('rede indisponível no teste');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const caminhoDe = (linha: string, cod: string, uuid = UUID, ext = 'jpg') => `${linha}/${cod}/${uuid}.${ext}`;
const MAGICO: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]),
  'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]),
  'application/pdf': Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3', 'latin1'),
};
const sobe = (caminho: string, size = 1000, contentType = 'image/jpeg', conteudo?: Buffer) => { h.objetos.set(caminho, { size, contentType, conteudo: conteudo ?? MAGICO[contentType] ?? Buffer.alloc(16) }); };
const get = (url: string, auth = NILCE) => request(app).get(`/gerador${url}`).set('Authorization', auth);
const post = (url: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador${url}`).set('Authorization', auth).send(corpo as object);
const del = (url: string, auth = NILCE) => request(app).delete(`/gerador${url}`).set('Authorization', auth);
const valorDe = (chave: string) => h.linhas.get(chave)?.value as { arquivos: any[]; alteracoes: any[]; apagados: string[]; vinculo?: any } | undefined;
const registra = async (url: string, slot: string, caminho: string, auth = NILCE) => post(url, { slot, caminho }, auth);

describe('módulo puro', () => {
  it('código: aceita #0057, 57 e 0057; recusa lixo; eletroposto só inteiro positivo', () => {
    expect(codigoDeRota('solar', '#0057')).toBe('0057');
    expect(codigoDeRota('solar', '57')).toBe('0057');
    expect(codigoDeRota('solar', '0057')).toBe('0057');
    expect(codigoDeRota('solar', '0')).toBeNull();
    expect(codigoDeRota('solar', '../x')).toBeNull();
    expect(codigoDeRota('eletroposto', '0101')).toBe('101');
    expect(codigoDeRota('eletroposto', '#101')).toBeNull();
  });
  it('caminho: só o formato do servidor, inteiro', () => {
    expect(lerCaminho(caminhoDe('solar', '0057'))?.mime).toBe('image/jpeg');
    for (const ruim of [`solar/0057/../0058/${UUID}.jpg`, `solar/0057/${UUID}.jpg/`, `solar//0057/${UUID}.jpg`, `solar/0057/${UUID}.gif`,
      `solar/0057/${UUID}.JPG`, `outra/0057/${UUID}.jpg`, `solar/0057/x.jpg`, `/solar/0057/${UUID}.jpg`, `solar/0057/${UUID}.jpg?x=1`, 42, null]) {
      expect(lerCaminho(ruim as never)).toBeNull();
    }
  });
  it('nome parecido', () => {
    expect(nomesParecidos('ana souza', 'ana souza')).toBe(true);
    expect(nomesParecidos('ana souza', 'ana souza pereira')).toBe(true);
    expect(nomesParecidos('carlos alves', 'carlos pereira')).toBe(false);
    expect(nomesParecidos('silva', 'maria silva')).toBe(false);                       // nome de uma palavra só nunca casa com maior
    expect(nomesParecidos('jose dos santos', 'maria dos santos')).toBe(false);       // "dos" não conta
    expect(nomesParecidos('joao da silva', 'pedro da silva')).toBe(false);
    expect(nomesParecidos('ana lima', 'ana souza')).toBe(false);
    expect(nomesParecidos('', 'ana')).toBe(false);
  });
  it('metadado: lê só as chaves conhecidas (nome de arquivo gravado por fora não passa)', () => {
    const v = lerRegistroDocs({ arquivos: [{ id: 'a', slot: 'documento', caminho: caminhoDe('solar', '0057'), mime: 'image/jpeg', bytes: 5, em: 'e', por: 'p', nome: 'CNH-ZZ.jpg' }, { id: 'b', slot: 'x', caminho: '../fora' }] });
    expect(v.arquivos).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain('CNH-ZZ');
  });
  it('catálogo: obrigatórios e "outros" nunca obrigatório', () => {
    for (const l of ['solar', 'eletroposto'] as const) {
      expect(CATALOGO[l].find((x) => x.chave === 'outros')).toMatchObject({ obrigatorio: false, varios: true });
      expect(CATALOGO[l].some((x) => x.obrigatorio)).toBe(true);
    }
    expect(CATALOGO.solar.map((x) => x.chave)).toEqual(['documento', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor', 'contrato_assinado', 'art', 'projeto', 'parecer_acesso', 'obra_pronta', 'outros']);
    expect(CATALOGO.eletroposto.map((x) => x.chave)).toEqual([
      'documento_titular', 'comprovante_endereco_comprador', 'documento_cedente', 'comprovante_endereco_cedente', 'documento_avalista',
      'comprovante_endereco_avalista', 'documento_outra_pessoa', 'documento_imovel', 'conta_luz', 'conta_luz_geradora', 'conta_luz_beneficiaria',
      'foto_local', 'padrao', 'quadro_eletrico', 'contrato_assinado', 'procuracao', 'anuencia', 'vistoria', 'art', 'projeto', 'parecer_acesso',
      'instalacao', 'outros']);
  });
});

describe('login', () => {
  it('401 sem token, 403 conta de fora, em todas as rotas', async () => {
    const rotas = ['/clientes/solar/57/docs', '/clientes/eletroposto/101/relatorio', '/clientes/solar/57/sugestoes-proposta'];
    for (const u of rotas) {
      expect((await request(app).get(`/gerador${u}`)).status).toBe(401);
      expect((await get(u, 'Bearer tk-estranho')).status).toBe(403);
    }
    expect((await request(app).delete(`/gerador/clientes/solar/57/docs/${UUID}`)).status).toBe(401);
  });
});

describe('posse: 404 igual, antes de qualquer outra recusa', () => {
  it('venda alheia e inexistente respondem o MESMO corpo, em todas as rotas, mesmo com pedido inválido', async () => {
    const mesmo = async (alheia: () => Promise<request.Response>, inexistente: () => Promise<request.Response>) => {
      const a = await alheia(); const b = await inexistente();
      expect(a.status).toBe(404); expect(b.status).toBe(404);
      expect(a.body).toEqual(b.body);
      expect(a.headers['cache-control']).toBe('no-store');
    };
    // Solar: #0058 é da Giovanna, a Nilce pede. #0999 não existe.
    await mesmo(() => get('/clientes/solar/58/docs'), () => get('/clientes/solar/999/docs'));
    await mesmo(() => post('/clientes/solar/58/docs/upload-url', { slot: 'NAO-EXISTE', mime: 'x/y', bytes: -1 }), () => post('/clientes/solar/999/docs/upload-url', { slot: 'NAO-EXISTE', mime: 'x/y', bytes: -1 }));
    await mesmo(() => post('/clientes/solar/58/docs', { slot: 'NAO-EXISTE', caminho: '../..' }), () => post('/clientes/solar/999/docs', { slot: 'NAO-EXISTE', caminho: '../..' }));
    await mesmo(() => del(`/clientes/solar/58/docs/${UUID}`), () => del(`/clientes/solar/999/docs/${UUID}`));
    await mesmo(() => get('/clientes/solar/58/relatorio'), () => get('/clientes/solar/999/relatorio'));
    await mesmo(() => get('/clientes/solar/58/sugestoes-proposta'), () => get('/clientes/solar/999/sugestoes-proposta'));
    await mesmo(() => post('/clientes/solar/58/vincular-proposta', { proposta: '***' }), () => post('/clientes/solar/999/vincular-proposta', { proposta: '***' }));
    // Eletroposto: 102 é da Giovanna; 103 é de solar; 104 não está vendido; 999 não existe.
    const inex = () => post('/clientes/eletroposto/999/docs/upload-url', { slot: 'NAO-EXISTE' });
    for (const id of [102, 103, 104]) {
      await mesmo(() => post(`/clientes/eletroposto/${id}/docs/upload-url`, { slot: 'NAO-EXISTE' }), inex);
      await mesmo(() => get(`/clientes/eletroposto/${id}/docs`), () => get('/clientes/eletroposto/999/docs'));
      await mesmo(() => get(`/clientes/eletroposto/${id}/relatorio`), () => get('/clientes/eletroposto/999/relatorio'));
    }
  });
  it('venda alheia: nada é lido do Storage, nada é gravado, e o objeto fica', async () => {
    sobe(caminhoDe('solar', '0058'));
    const antes = h.linhas.size;
    expect((await registra('/clientes/solar/58/docs', 'fachada', caminhoDe('solar', '0058'))).status).toBe(404);
    expect((await del(`/clientes/solar/58/docs/${UUID}`)).status).toBe(404);
    expect(h.linhas.size).toBe(antes);
    expect(h.objetos.has(caminhoDe('solar', '0058'))).toBe(true);
    expect(h.chamadas.filter((c) => c.op === 'remove')).toHaveLength(0);
  });
  it('sócio acessa qualquer venda; consultor, a dele; formato de código e de linha inválidos dão 400', async () => {
    expect((await get('/clientes/solar/58/docs', THIAGO)).status).toBe(200);
    expect((await get('/clientes/eletroposto/102/docs', THIAGO)).status).toBe(200);
    expect((await get('/clientes/solar/57/docs')).status).toBe(200);
    expect((await get('/clientes/eletroposto/101/docs')).status).toBe(200);
    expect((await get('/clientes/solar/%2523x/docs')).status).toBe(400);
    expect((await get('/clientes/outra/57/docs')).status).toBe(400);
    expect((await get('/clientes/eletroposto/abc/docs')).status).toBe(400);
  });
  it('código com #, sem zeros e com zeros são a mesma venda', async () => {
    for (const c of ['%230057', '57', '0057']) expect((await get(`/clientes/solar/${c}/docs`)).status).toBe(200);
  });
});

describe('GET docs', () => {
  it('devolve o catálogo, a lista, limite e pode_remover; sem vínculo no eletroposto', async () => {
    const s = await get('/clientes/solar/57/docs');
    expect(s.body).toMatchObject({ ok: true, arquivos: [], vinculo: null, pode_remover: true, limite_bytes: 10485760 });
    expect(s.body.slots).toHaveLength(12);
    expect(s.body.slots[0]).toEqual({ chave: 'documento', rotulo: 'CNH ou identidade', aceita: 'ambos', obrigatorio: true, varios: false });
    const e = await get('/clientes/eletroposto/101/docs');
    expect(e.body.vinculo).toBeNull();
    expect(e.body.slots.map((x: any) => x.chave)).toContain('quadro_eletrico');
  });
});

describe('upload-url', () => {
  const url = '/clientes/solar/57/docs/upload-url';
  it('item, mime e tamanho inválidos dão 400', async () => {
    for (const corpo of [
      { slot: 'inexistente', mime: 'image/jpeg', bytes: 10 },
      { slot: 'fachada', mime: 'image/gif', bytes: 10 },
      { slot: 'fachada', mime: 'application/pdf', bytes: 10 },   // fachada é só foto
      { slot: 'documento', mime: 'video/mp4', bytes: 10 },
      { slot: 'documento', mime: 'application/pdf', bytes: 10 * 1024 * 1024 + 1 },
      { slot: 'documento', mime: 'application/pdf', bytes: 0 },
      { slot: 'documento', mime: 'application/pdf', bytes: '10' },
      { slot: 'documento', mime: 'application/pdf', bytes: 1.5 },
      { slot: 'documento', mime: 'application/pdf' },
      { slot: ['documento'], mime: 'application/pdf', bytes: 10 },
    ]) {
      const x = await post(url, corpo);
      expect(x.status, JSON.stringify(corpo)).toBe(400);
    }
    expect((await request(app).post(`/gerador${url}`).set('Authorization', NILCE).send([1])).status).toBe(400);
    expect(h.chamadas.some((c) => c.op === 'createBucket')).toBe(false);
  });
  it('ok: caminho do servidor, PUT e content-type; o nome do arquivo no corpo é ignorado', async () => {
    const x = await post(url, { slot: 'documento', mime: 'application/pdf', bytes: 5000, nome: 'CNH-Ana-Souza.pdf' });
    expect(x.status).toBe(200);
    expect(x.body).toMatchObject({ ok: true, metodo: 'PUT', cabecalhos: { 'content-type': 'application/pdf', 'cache-control': 'max-age=60' }, token: 'tok-1' });
    expect(x.body.caminho).toMatch(/^solar\/0057\/[0-9a-f-]{36}\.pdf$/);
    expect(JSON.stringify(x.body)).not.toContain('Ana-Souza');
    const e = await post('/clientes/eletroposto/101/docs/upload-url', { slot: 'foto_local', mime: 'image/webp', bytes: 100 });
    expect(e.body.caminho).toMatch(/^eletroposto\/101\/[0-9a-f-]{36}\.webp$/);
  });
  it('bucket novo nasce PRIVADO, com 10 MB e só os 4 tipos', async () => {
    h.bucket = null;
    expect((await post(url, { slot: 'documento', mime: 'application/pdf', bytes: 5 })).status).toBe(200);
    const c = h.chamadas.find((x) => x.op === 'createBucket')!.arg as any;
    expect(c).toEqual({ public: false, fileSizeLimit: 10485760, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] });
  });
  it('item de um arquivo só já ocupado dá 409; item "vários" aceita', async () => {
    sobe(caminhoDe('solar', '0057'));
    expect((await registra('/clientes/solar/57/docs', 'documento', caminhoDe('solar', '0057'))).status).toBe(200);
    const o = await post(url, { slot: 'documento', mime: 'image/jpeg', bytes: 5 });
    expect(o.status).toBe(409);
    expect(o.body.motivo).toBe('slot_ocupado');
    expect((await post(url, { slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 })).status).toBe(200);
  });

  // Limites de 19/10/2026: 100 arquivos por venda, 100 em "outros" (o teto da venda) e 40 nos demais itens "vários".
  const semear = (partes: Array<[string, number]>) => {
    const arquivos: any[] = [];
    for (const [slot, n] of partes) {
      for (let k = 0; k < n; k++) {
        const uuid = `${(arquivos.length + 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
        arquivos.push({ id: `id${arquivos.length}`, slot, caminho: caminhoDe('solar', '0057', uuid), mime: 'image/jpeg', bytes: 1, em: 'e', por: 'nilce' });
      }
    }
    h.linhas.set('docs_cliente:solar:0057', { value: { arquivos, alteracoes: [], apagados: [] }, updated_at: 'v0' });
  };
  it('os limites estão em 100 por venda, 100 em "outros" e 40 nos itens "vários"', () => {
    expect(LIMITES).toMatchObject({ total: 100, outros: 100, porItem: 40 });
    const item = (linha: 'solar' | 'eletroposto', chave: string) => CATALOGO[linha].find((x) => x.chave === chave)!;
    expect(limiteDoItem(item('solar', 'outros'))).toBe(100);
    expect(limiteDoItem(item('solar', 'obra_pronta'))).toBe(40);
    expect(limiteDoItem(item('eletroposto', 'instalacao'))).toBe(40);
    expect(limiteDoItem(item('eletroposto', 'foto_local'))).toBe(1);
  });
  it('item "vários" (40): o 40º entra e o 41º é recusado com o número certo', async () => {
    semear([['obra_pronta', 39]]);
    expect((await post(url, { slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 })).status).toBe(200);
    semear([['obra_pronta', 40]]);
    const x = await post(url, { slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 });
    expect(x.status).toBe(409);
    expect(x.body).toMatchObject({ ok: false, motivo: 'muitos_no_item', error: 'Este item já tem 40 arquivos.' });
  });
  it('"outros" vai até 100: o 100º entra e o 101º é recusado como teto da venda', async () => {
    semear([['outros', 99]]);
    expect((await post(url, { slot: 'outros', mime: 'application/pdf', bytes: 5 })).status).toBe(200);
    semear([['outros', 100]]);
    const x = await post(url, { slot: 'outros', mime: 'application/pdf', bytes: 5 });
    expect(x.status).toBe(409);
    expect(x.body).toMatchObject({ ok: false, motivo: 'muitos_na_venda', error: 'Esta venda já tem 100 arquivos.' });
  });
  it('venda com 100 arquivos misturados: qualquer item "vários" é recusado, mesmo com espaço no item', async () => {
    semear([['outros', 70], ['obra_pronta', 30]]);
    const x = await post(url, { slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 });
    expect(x.status).toBe(409);
    expect(x.body.motivo).toBe('muitos_na_venda');
    semear([['outros', 70], ['obra_pronta', 29]]);
    expect((await post(url, { slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 })).status).toBe(200);
  });
});

// Teto por IP ANTES do login nos dois POSTs de anexo (as rotas são as de verdade; cada teste usa um IP próprio, via X-Forwarded-For).
describe('envio de anexos: teto por IP antes do login', () => {
  const UP = '/gerador/clientes/solar/57/docs/upload-url';
  const REG = '/gerador/clientes/solar/57/docs';
  const MSG = 'Muitos envios seguidos. Espere alguns minutos e continue.';
  const semToken = (rota: string, ip: string) => request(app).post(rota).set('X-Forwarded-For', ip).send({ slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 });
  const comToken = (rota: string, ip: string, auth: string) => request(app).post(rota).set('X-Forwarded-For', ip).set('Authorization', auth).send({ slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 });

  it('rajada SEM token: 150 respostas 401 e o 151º já leva 429 no formato das rotas de docs, sem tocar o login', async () => {
    const antes = vi.mocked(supabaseGerador.auth.getUser).mock.calls.length;
    const s: number[] = [];
    for (let i = 0; i < 151; i++) s.push((await semToken(UP, '192.0.2.50')).status);
    expect(s.slice(0, 150).every((x) => x === 401)).toBe(true);
    expect(s[150]).toBe(429);
    const x = await semToken(UP, '192.0.2.50');
    expect(x.status).toBe(429);
    expect(x.body).toEqual({ ok: false, error: MSG });
    // as duas rotas dividem a conta do IP
    expect((await semToken(REG, '192.0.2.50')).status).toBe(429);
    // outro IP não é afetado
    expect((await semToken(UP, '192.0.2.51')).status).toBe(401);
    // sem token nada chama o Supabase
    expect(vi.mocked(supabaseGerador.auth.getUser).mock.calls.length - antes).toBe(0);
  }, 120_000);

  it('rajada com `Bearer lixo`: o login (Supabase) é chamado só até o teto, depois o 429 barra antes dele', async () => {
    const antes = vi.mocked(supabaseGerador.auth.getUser).mock.calls.length;
    const s: number[] = [];
    for (let i = 0; i < 160; i++) s.push((await comToken(UP, '192.0.2.52', 'Bearer lixo')).status);
    expect(s.slice(0, 150).every((x) => x === 401)).toBe(true);
    expect(s.slice(150).every((x) => x === 429)).toBe(true);
    expect(vi.mocked(supabaseGerador.auth.getUser).mock.calls.length - antes).toBe(150);
  }, 120_000);

  it('envio legítimo não gasta o teto: 160 pedidos com token válido dão 200 seguidos, e depois ainda dá para errar o login', async () => {
    const s: number[] = [];
    for (let i = 0; i < 160; i++) s.push((await comToken(UP, '192.0.2.53', THIAGO)).status);
    expect(s.every((x) => x === 200)).toBe(true);
    expect((await semToken(UP, '192.0.2.53')).status).toBe(401);
  }, 120_000);

  it('só as respostas de falha de login gastam a conta: 409 e 400 de quem está logado não contam', async () => {
    for (let i = 0; i < 160; i++) {
      const r = await request(app).post(UP).set('X-Forwarded-For', '192.0.2.54').set('Authorization', THIAGO).send({ slot: 'inexistente', mime: 'image/jpeg', bytes: 5 });
      expect(r.status).toBe(400);
    }
    expect((await semToken(UP, '192.0.2.54')).status).toBe(401);
  }, 120_000);

  it('GET, DELETE e PATCH das mesmas rotas não usam esse teto (sem token seguem dando 401)', async () => {
    for (let i = 0; i < 155; i++) expect((await request(app).get(REG).set('X-Forwarded-For', '192.0.2.55')).status).toBe(401);
    expect((await request(app).delete(`${REG}/${UUID}`).set('X-Forwarded-For', '192.0.2.55')).status).toBe(401);
    expect((await semToken(UP, '192.0.2.55')).status).toBe(401);
  }, 120_000);
});

describe('bucket', () => {
  it('PÚBLICO é recusado com 502 em todas as rotas que tocam o Storage', async () => {
    h.bucket = { public: true, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] };
    expect((await get('/clientes/solar/57/docs')).status).toBe(502);
    expect((await post('/clientes/solar/57/docs/upload-url', { slot: 'documento', mime: 'application/pdf', bytes: 5 })).status).toBe(502);
    sobe(caminhoDe('solar', '0057'));
    expect((await registra('/clientes/solar/57/docs', 'fachada', caminhoDe('solar', '0057'))).status).toBe(502);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
    expect(h.chamadas.some((c) => c.op === 'updateBucket')).toBe(false);
  });
  it('sem limites: atualiza para privado + 10 MB + 4 tipos; se não conseguir, 502', async () => {
    h.bucket = { public: false, file_size_limit: null, allowed_mime_types: null };
    expect((await get('/clientes/solar/57/docs')).status).toBe(200);
    expect(h.chamadas.find((c) => c.op === 'updateBucket')!.arg).toEqual({ public: false, fileSizeLimit: 10485760, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] });
    h.bucket = { public: false, file_size_limit: 99999999, allowed_mime_types: ['image/jpeg'] };
    h.erroUpdateBucket = true; limparCacheBucketDocs();
    expect((await get('/clientes/solar/57/docs')).status).toBe(502);
  });
});

describe('registrar', () => {
  const url = '/clientes/solar/57/docs';
  it('ok: tamanho e tipo vêm do Storage; o metadado guarda SÓ slot, caminho, mime, bytes, em, por (e id)', async () => {
    const c = caminhoDe('solar', '0057', UUID, 'pdf');
    sobe(c, 4321, 'application/pdf');
    const x = await post(url, { slot: 'documento', caminho: c, nome: 'CNH-Ana-Souza.pdf', bytes: 1, mime: 'image/png' });
    expect(x.status).toBe(200);
    expect(x.body.arquivo).toMatchObject({ slot: 'documento', mime: 'application/pdf', bytes: 4321, por: 'nilce' });
    expect(x.body.arquivo.url).toMatch(/^https:\/\/docs\.test\//);
    expect(Object.keys(x.body.arquivo).sort()).toEqual(['bytes', 'em', 'id', 'mime', 'por', 'slot', 'url']);
    const v = valorDe('docs_cliente:solar:0057')!;
    expect(Object.keys(v.arquivos[0]).sort()).toEqual(['bytes', 'caminho', 'em', 'id', 'mime', 'por', 'slot']);
    expect(v.arquivos[0].caminho).toBe(c);
    expect(JSON.stringify(v)).not.toMatch(/Ana-Souza|CNH-/);
    expect(v.alteracoes).toEqual([{ em: expect.any(String), por: 'nilce', acao: 'anexou', slot: 'documento' }]);
    expect(JSON.stringify(v.alteracoes)).not.toContain(UUID);
    // a lista devolve o arquivo com URL de 5 min
    const l = await get(`${url}`);
    expect(l.body.arquivos).toHaveLength(1);
    expect(l.body.arquivos[0].url).toMatch(/^https:\/\/docs\.test\//);
    expect(l.body.arquivos[0]).not.toHaveProperty('caminho');
    expect(h.validades[h.validades.length - 1]).toBe(300);
  });
  it('caminho de OUTRA venda, de outra linha, com "..", de outro formato: 400, sem tocar o Storage', async () => {
    sobe(caminhoDe('solar', '0059'));
    for (const caminho of [
      caminhoDe('solar', '0059'), caminhoDe('solar', '0058'), caminhoDe('eletroposto', '57'), `solar/0057/../0059/${UUID}.jpg`,
      `solar/0057/${UUID}.gif`, `solar/0057/${UUID}.jpg/..`, 'solar/0057', '', 7, null,
    ]) {
      const x = await registra(url, 'fachada', caminho as string);
      expect(x.status, String(caminho)).toBe(400);
    }
    expect(h.chamadas.some((c) => c.op === 'remove')).toBe(false);
    expect(h.objetos.has(caminhoDe('solar', '0059'))).toBe(true);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
  });
  it('objeto inexistente: 400 e nada gravado', async () => {
    const x = await registra(url, 'fachada', caminhoDe('solar', '0057'));
    expect(x.status).toBe(400);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
  });
  it('tamanho acima de 10 MB ou tipo que não serve ao item: 400 e o objeto é removido', async () => {
    sobe(caminhoDe('solar', '0057', UUID), 10 * 1024 * 1024 + 1);
    expect((await registra(url, 'fachada', caminhoDe('solar', '0057', UUID))).status).toBe(400);
    expect(h.objetos.has(caminhoDe('solar', '0057', UUID))).toBe(false);
    sobe(caminhoDe('solar', '0057', UUID2, 'pdf'), 100, 'application/pdf');
    expect((await registra(url, 'fachada', caminhoDe('solar', '0057', UUID2, 'pdf'))).status).toBe(400);   // fachada é só foto
    // tipo guardado diferente da extensão do caminho
    sobe(caminhoDe('solar', '0057', UUID), 100, 'image/png');
    expect((await registra(url, 'fachada', caminhoDe('solar', '0057', UUID))).status).toBe(400);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
  });
  it('o mesmo caminho duas vezes: 409; item de um arquivo ocupado: 409; vários: ok; item inexistente: 400', async () => {
    sobe(caminhoDe('solar', '0057', UUID));
    expect((await registra(url, 'obra_pronta', caminhoDe('solar', '0057', UUID))).status).toBe(200);
    expect((await registra(url, 'obra_pronta', caminhoDe('solar', '0057', UUID))).status).toBe(409);
    expect((await registra(url, 'fachada', caminhoDe('solar', '0057', UUID))).status).toBe(409);
    sobe(caminhoDe('solar', '0057', UUID2));
    expect((await registra(url, 'obra_pronta', caminhoDe('solar', '0057', UUID2))).status).toBe(200);
    expect(valorDe('docs_cliente:solar:0057')!.arquivos).toHaveLength(2);
    expect((await registra(url, 'nao_existe', caminhoDe('solar', '0057', UUID2))).status).toBe(400);
  });
  it('corrida: outra gravação entre a leitura e a escrita é relida, sem perder nenhum dos dois', async () => {
    sobe(caminhoDe('solar', '0057', UUID));
    sobe(caminhoDe('solar', '0057', UUID2));
    expect((await registra(url, 'obra_pronta', caminhoDe('solar', '0057', UUID))).status).toBe(200);
    h.noMeio = () => {
      const l = h.linhas.get('docs_cliente:solar:0057')!;
      const v = l.value as any;
      h.linhas.set('docs_cliente:solar:0057', {
        value: { ...v, arquivos: [...v.arquivos, { id: 'zz', slot: 'outros', caminho: caminhoDe('solar', '0057', '2d8b3e4a-5f6c-4d7e-8f90-a1b2c3d4e5f6'), mime: 'image/jpeg', bytes: 1, em: 'e', por: 'thiago' }] },
        updated_at: 'outra-versao',
      });
    };
    expect((await registra(url, 'obra_pronta', caminhoDe('solar', '0057', UUID2))).status).toBe(200);
    expect(valorDe('docs_cliente:solar:0057')!.arquivos).toHaveLength(3);
  });
  it('eletroposto grava em docs_cliente:eletroposto:<id>', async () => {
    sobe(caminhoDe('eletroposto', '101', UUID, 'png'), 50, 'image/png');
    const x = await registra('/clientes/eletroposto/101/docs', 'quadro_eletrico', caminhoDe('eletroposto', '101', UUID, 'png'));
    expect(x.status).toBe(200);
    expect(valorDe('docs_cliente:eletroposto:101')!.arquivos[0].slot).toBe('quadro_eletrico');
  });
});

describe('remover', () => {
  async function anexa(): Promise<string> {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    const x = await registra('/clientes/solar/57/docs', 'fachada', c);
    return x.body.arquivo.id as string;
  }
  it('dono remove: objeto e metadado somem, com trilha sem nome nem caminho', async () => {
    const id = await anexa();
    const x = await del(`/clientes/solar/57/docs/${id}`);
    expect(x.status).toBe(200);
    expect(h.objetos.size).toBe(0);
    const v = valorDe('docs_cliente:solar:0057')!;
    expect(v.arquivos).toEqual([]);
    expect(v.alteracoes.map((a) => a.acao)).toEqual(['anexou', 'removeu']);
    expect(JSON.stringify(v.alteracoes)).not.toContain(UUID);   // a trilha não leva caminho; a lista de apagados leva, para o registro recusar
    expect(v.apagados).toEqual([caminhoDe('solar', '0057', UUID)]);
  });
  it('sócio remove arquivo de venda de outro; consultor de outra venda não (404) e nada some', async () => {
    const id = await anexa();
    expect((await del(`/clientes/solar/57/docs/${id}`, GIOVANNA)).status).toBe(404);
    expect(h.objetos.size).toBe(1);
    expect(valorDe('docs_cliente:solar:0057')!.arquivos).toHaveLength(1);
    expect((await del(`/clientes/solar/57/docs/${id}`, THIAGO)).status).toBe(200);
    expect(h.objetos.size).toBe(0);
  });
  it('id desconhecido: 404; id fora do formato: 400', async () => {
    await anexa();
    expect((await del(`/clientes/solar/57/docs/${UUID2}`)).status).toBe(404);
    expect((await del('/clientes/solar/57/docs/..%2Fx')).status).toBe(400);
    expect(h.objetos.size).toBe(1);
  });
});

describe('vínculo com a proposta (Solar)', () => {
  const vincular = (cod: string, proposta: unknown, auth = NILCE) => post(`/clientes/solar/${cod}/vincular-proposta`, { proposta }, auth);
  it('sugestões: só as vendidas de nome parecido, com 4 campos e nada mais', async () => {
    const x = await get('/clientes/solar/57/sugestoes-proposta');
    expect(x.status).toBe(200);
    expect(x.body.sugestoes.map((s: any) => s.codigo).sort()).toEqual(['IN-1', 'IN-4']);   // IN-2 não é vendida; IN-3 é outro nome
    expect(Object.keys(x.body.sugestoes[0]).sort()).toEqual(['cidade', 'cliente', 'codigo', 'data']);
  });
  it('vincula só proposta vendida, e o consultor só a de nome parecido (as outras dão o 404 de "não existe")', async () => {
    expect((await vincular('57', 'IN-2')).status).toBe(409);        // existe, parece, mas não foi vendida
    const outra = await vincular('57', 'IN-3');                      // vendida, de outro cliente
    const nao = await vincular('57', 'IN-999');
    expect(outra.status).toBe(404); expect(nao.status).toBe(404);
    expect(outra.body).toEqual(nao.body);
    expect((await vincular('57', 'IN 1')).status).toBe(400);
    expect((await vincular('57', { a: 1 })).status).toBe(400);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
    const ok = await vincular('57', 'IN-1');
    expect(ok.status).toBe(200);
    expect(ok.body.vinculo.proposta).toBe('IN-1');
    expect(valorDe('docs_cliente:solar:0057')!.vinculo).toMatchObject({ proposta: 'IN-1', por: 'nilce' });
    expect(valorDe('docs_cliente:solar:0057')!.alteracoes.slice(-1)[0]).toMatchObject({ acao: 'vinculou', proposta: 'IN-1' });
  });
  it('uma proposta só vale para UMA venda; trocar o vínculo pode; o sócio liga qualquer proposta vendida', async () => {
    expect((await vincular('57', 'IN-1')).status).toBe(200);
    expect((await vincular('57', 'IN-1')).status).toBe(200);              // repetir é idempotente
    const dupla = await vincular('59', 'IN-1', THIAGO);                    // outra venda, mesma proposta
    expect(dupla.status).toBe(409);
    expect(JSON.stringify(dupla.body)).not.toMatch(/0057|Ana/);           // não revela qual venda
    expect((await get('/clientes/solar/59/sugestoes-proposta', THIAGO)).body.sugestoes.map((s: any) => s.codigo)).not.toContain('IN-1');
    expect((await vincular('57', 'IN-4')).status).toBe(200);               // troca (IN-4 é "Ana Souza Pereira", parecida)
    expect(valorDe('docs_cliente:solar:0057')!.vinculo.proposta).toBe('IN-4');
    expect((await vincular('59', 'IN-1', THIAGO)).status).toBe(200);       // IN-1 ficou livre
    expect((await vincular('58', 'IN-3', THIAGO)).status).toBe(200);
    expect((await vincular('58', 'IN-3', NILCE)).status).toBe(404);        // venda alheia
  });
  it('GET docs traz os arquivos do dossiê vinculado (só slot, mime e url, sem nome nem caminho)', async () => {
    await vincular('57', 'IN-1');
    const x = await get('/clientes/solar/57/docs');
    expect(x.body.vinculo.proposta).toBe('IN-1');
    expect(x.body.vinculo.arquivos).toHaveLength(2);
    expect(x.body.vinculo.arquivos.map((a: any) => Object.keys(a).sort())).toEqual([['mime', 'slot', 'url'], ['mime', 'slot', 'url']]);
    expect(x.body.vinculo.arquivos[0]).toMatchObject({ slot: 'documento', mime: 'application/pdf' });
    expect(JSON.stringify(x.body)).not.toMatch(/CNH-ANA|casa-da-ana|IN-1\/|documento-1/);
  });
  it('venda sem vínculo não lê dossiê nenhum', async () => {
    const x = await get('/clientes/solar/57/docs');
    expect(x.body.vinculo).toBeNull();
    expect(h.sig).toBe(0);
  });
});

describe('relatório de homologação', () => {
  const todoTexto = (o: unknown): string => JSON.stringify(o);
  const SENTINELAS = ['ZZ', 'R$', '8.887', '7.776', '654,32', '987,65', '4.321', '111,22', '4.444', '555,44', '333,21', '222,10', '6.543', '2.345', 'Quitado', 'ZZClienteAlheio'];
  // O que o dono NUNCA quer ver no pacote da engenharia, em qualquer linha.
  const PROIBIDOS = ['Consultor', 'consultor', 'Nilce', 'thiago', 'Modelo da venda', 'Vendido em', 'Data da venda', 'Contrato assinado', 'Obra não concluída', 'Engenheiro',
    'Etapa', 'Trilho', 'Forma de pagamento', 'Banco', 'Sinal', 'Preço', 'emitido_por', '"obra"', 'obra_concluida', 'meio_a_meio', '50/50', 'Responsável'];
  const rotulosDe = (b: any): string[] => b.secoes.flatMap((s: any) => s.campos.map((c: any) => c.rotulo));
  const valorDe2 = (b: any, rotulo: string): string | undefined => b.secoes.flatMap((s: any) => s.campos).find((c: any) => c.rotulo === rotulo)?.valor;
  const fichaEp = (id: number, campos: Record<string, string | number>) => h.linhas.set(`cliente_ep:${id}`, {
    value: { campos: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, { valor: v, por: 'x', em: 'e' }])), alteracoes: [], em: 'e' }, updated_at: 'f1',
  });

  it('Solar, como SÓCIO: as 5 seções do formulário, sem dinheiro, consultor, datas nem obra', async () => {
    const x = await get('/clientes/solar/57/relatorio', THIAGO);
    expect(x.status).toBe(200);
    const t = todoTexto(x.body);
    for (const s of SENTINELAS) expect(t, s).not.toContain(s);
    for (const p of PROIBIDOS) expect(t, p).not.toContain(p);
    expect(x.headers['cache-control']).toBe('no-store');
    expect(x.body.secoes.map((s: any) => [s.numero, s.titulo])).toEqual([
      [1, 'Informações da concessionária'], [2, 'Informações do cliente'], [3, 'Informações da instalação (unidade consumidora/geradora)'],
      [4, 'Especificações do projeto'], [5, 'Documentos complementares'],
    ]);
    expect(Object.keys(x.body.cabecalho).sort()).toEqual(['cliente', 'codigo', 'emitido_em', 'linha']);
    expect(x.body.cabecalho).toMatchObject({ linha: 'solar', codigo: '#0057', cliente: 'Ana Souza' });
    expect(x.body.obra).toBeUndefined();
    expect(Object.keys(x.body.pendencias).sort()).toEqual(['campos', 'documentos']);
    expect(valorDe2(x.body, 'Estado')).toBe('MG');
  });
  it('Solar, como consultor dono: o mesmo corte', async () => {
    const x = await get('/clientes/solar/57/relatorio');
    expect(x.status).toBe(200);
    for (const s of SENTINELAS) expect(todoTexto(x.body), s).not.toContain(s);
    for (const p of PROIBIDOS) expect(todoTexto(x.body), p).not.toContain(p);
    expect(valorDe2(x.body, 'Módulos (placas)')).toBe('10 módulos');
    expect(valorDe2(x.body, 'Nome completo')).toBe('Ana Souza');
  });
  it('Solar: faltam só entradas da engenharia, e o dossiê vinculado quita o documento e a fachada vira complemento', async () => {
    const a = await get('/clientes/solar/57/relatorio');
    expect(a.body.preliminar).toBe(true);
    expect(a.body.pendencias.campos).toEqual(['Coordenadas (latitude e longitude)', 'Tipo de disjuntor', 'Valor do disjuntor (A)']);
    expect(a.body.pendencias.documentos).toEqual(['Documento com foto do cliente', 'Conta de energia', 'Foto do padrão de entrada', 'Foto do disjuntor']);
    expect(a.body.documentos).toEqual([]);
    sobe(caminhoDe('solar', '0057'));
    await registra('/clientes/solar/57/docs', 'padrao', caminhoDe('solar', '0057'));
    await post('/clientes/solar/57/vincular-proposta', { proposta: 'IN-1' });
    const b = await get('/clientes/solar/57/relatorio');
    expect(b.body.pendencias.documentos).toEqual(['Conta de energia', 'Foto do disjuntor']);
    expect(b.body.documentos.map((d: any) => [d.secao, d.tipo, d.arquivo])).toEqual([
      [2, 'documento-com-foto', '2-documento-com-foto'], [5, 'padrao-de-entrada', '5-padrao-de-entrada-1'], [5, 'fachada', '5-fachada-1'],   // o anexado aqui primeiro, depois o do dossiê
    ]);
    expect(Object.keys(b.body.documentos[0]).sort()).toEqual(['arquivo', 'mime', 'rotulo', 'secao', 'slot', 'tipo', 'url']);
    expect(h.validades[h.validades.length - 1]).toBe(900);
    expect(todoTexto(b.body)).not.toMatch(/CNH-ANA|casa-da-ana|IN-1\/|documento-1/);
  });
  it('Solar da planilha: sem coordenadas nem disjuntor para preencher, o nome é o da homologação', async () => {
    const x = await get('/clientes/solar/58/relatorio', THIAGO);
    expect(x.status).toBe(200);
    expect(valorDe2(x.body, 'Nome completo')).toBe('Bruno Lima');
    expect(valorDe2(x.body, 'Trocar titularidade?')).toBe('');
  });
  it('Eletroposto: seções 1 a 5 com os nomes do formulário, PF, coordenadas separadas e sem dinheiro, consultor, modelo, datas nem obra', async () => {
    fichaEp(101, {
      valor: 654321.09, entrada: 77777.7, forma_pagto: 'ZZPIX', banco: 'ZZBANCO', cpf_cnpj: '123.456.789-09', uf: 'MG',
      concessionaria: 'Cemig', endereco_ponto: 'Av. Brasil, 100', unidade_consumidora: '0012345678', titular_conta: 'Carlos Alves',
      trifasico: 'Sim', coordenadas: '-18.912345, -48.275432', disjuntor_tipo: 'Trifásico', disjuntor_a: '63', materiais: 'Cabo 10 mm, haste de aterramento',
      equipamento: 'Wallbox 22 kW', qtd_carregadores: 2, qtd_plugs: 4, potencia_kw: 22, contrato_assinado_em: '2026-09-01',
    });
    const x = await get('/clientes/eletroposto/101/relatorio', THIAGO);
    expect(x.status).toBe(200);
    const t = todoTexto(x.body);
    for (const s of ['250000', '250.000', 'R$', '654321', '77777', 'ZZPIX', 'ZZBANCO', 'ZZOBSPV']) expect(t, s).not.toContain(s);
    for (const p of PROIBIDOS) expect(t, p).not.toContain(p);
    expect(x.body.cabecalho).toMatchObject({ linha: 'eletroposto', codigo: '101', cliente: 'Carlos Alves' });
    expect(rotulosDe(x.body)).toEqual([
      'Estado', 'Nome da concessionária',
      'Pessoa física ou jurídica', 'CPF', 'Nome completo',
      'Endereço do ponto', 'Unidade consumidora', 'Titular da conta', 'Trocar titularidade?', 'Tipo de disjuntor', 'Valor do disjuntor (A)',
      'Latitude do projeto', 'Longitude do projeto', 'Rede trifásica',
      'Potência total (kW)', 'Equipamento', 'Quantidade de carregadores', 'Quantidade de plugs', 'Materiais',
    ]);
    expect(valorDe2(x.body, 'Pessoa física ou jurídica')).toBe('Pessoa física');
    expect(valorDe2(x.body, 'CPF')).toBe('123.456.789-09');
    expect(valorDe2(x.body, 'Latitude do projeto')).toBe('-18.912345');
    expect(valorDe2(x.body, 'Longitude do projeto')).toBe('-48.275432');
    expect(valorDe2(x.body, 'Trocar titularidade?')).toBe('Não');
    expect(valorDe2(x.body, 'Valor do disjuntor (A)')).toBe('63');
    expect(valorDe2(x.body, 'Quantidade de carregadores')).toBe('2');
    expect(x.body.pendencias).toEqual({ campos: [], documentos: ['Documento com foto do cliente', 'Conta de energia', 'Foto do padrão de entrada', 'Foto do disjuntor ou do quadro elétrico'] });
    expect(x.body.obra).toBeUndefined();
  });
  it('Eletroposto: "Trocar titularidade?" compara nomes sem acento nem caixa; titular diferente é Sim; sem titular não se sabe', async () => {
    fichaEp(101, { titular_conta: 'CARLOS  ALVES' });
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Trocar titularidade?')).toBe('Não');
    fichaEp(101, { titular_conta: 'Maria Souza' });
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Trocar titularidade?')).toBe('Sim');
    fichaEp(101, { cliente: 'José Álvares', titular_conta: 'jose alvares' });
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Trocar titularidade?')).toBe('Não');
    h.linhas.delete('cliente_ep:101');
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Trocar titularidade?')).toBe('');
  });
  it('Eletroposto: PJ mostra CNPJ; coordenadas no formato do Maps, com vírgula decimal ou fora do intervalo', async () => {
    fichaEp(101, { cpf_cnpj: '11.222.333/0001-81', coordenadas: '-18,912345; -48,275432' });
    const a = (await get('/clientes/eletroposto/101/relatorio')).body;
    expect(valorDe2(a, 'Pessoa física ou jurídica')).toBe('Pessoa jurídica');
    expect(valorDe2(a, 'CNPJ')).toBe('11.222.333/0001-81');
    expect(valorDe2(a, 'Latitude do projeto')).toBe('-18.912345');
    expect(valorDe2(a, 'Longitude do projeto')).toBe('-48.275432');
    expect(a.pendencias.campos).not.toContain('Coordenadas (latitude e longitude)');
    fichaEp(101, { coordenadas: '95.5, -48.2' });
    const b = (await get('/clientes/eletroposto/101/relatorio')).body;
    expect(valorDe2(b, 'Latitude do projeto')).toBe('');
    expect(b.pendencias.campos[0]).toMatch(/^Coordenadas inválidas/);
    expect(todoTexto(b)).not.toContain('95.5');
    fichaEp(101, { coordenadas: 'sem sentido' });
    expect((await get('/clientes/eletroposto/101/relatorio')).body.pendencias.campos[0]).toMatch(/^Coordenadas inválidas/);
  });
  it('Eletroposto: endereço e titular só perdem R$/reais/pix ("Km 12,50", "Rua da Entrada" e "Consultor" passam); materiais usa a regra larga', async () => {
    fichaEp(101, { endereco_ponto: 'Rodovia BR-050 Km 12,50, Rua da Entrada', titular_conta: 'Av. Consultor Fulano', potencia_kw: 4.4, materiais: 'Cabo 1.500,00' });
    const a = (await get('/clientes/eletroposto/101/relatorio')).body;
    expect(valorDe2(a, 'Endereço do ponto')).toBe('Rodovia BR-050 Km 12,50, Rua da Entrada');
    expect(valorDe2(a, 'Titular da conta')).toBe('Av. Consultor Fulano');
    expect(valorDe2(a, 'Potência total (kW)')).toBe('4,4');
    expect(valorDe2(a, 'Materiais')).toBe('');
    fichaEp(101, { endereco_ponto: 'Rua A, paguei R$ 500', titular_conta: 'Fulano pix', materiais: 'Cabo 10 mm, haste' });
    const b = (await get('/clientes/eletroposto/101/relatorio')).body;
    expect(valorDe2(b, 'Endereço do ponto')).toBe('');
    expect(valorDe2(b, 'Titular da conta')).toBe('');
    expect(valorDe2(b, 'Materiais')).toBe('Cabo 10 mm, haste');
  });
  it('Eletroposto: UF do ponto vem do campo, senão da UF do cliente, senão da Cemig', async () => {
    fichaEp(101, { uf_ponto: 'GO', uf: 'MG' });
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Estado')).toBe('GO');
    fichaEp(101, { uf: 'SP' });
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Estado')).toBe('SP');
    fichaEp(101, { concessionaria: 'Cemig' });
    expect(valorDe2((await get('/clientes/eletroposto/101/relatorio')).body, 'Estado')).toBe('MG');
  });
  it('Eletroposto, como consultor dono: o mesmo recorte; venda alheia 404', async () => {
    const a = await get('/clientes/eletroposto/101/relatorio');
    expect(todoTexto(a.body)).not.toMatch(/250000|R\$/);
    h.cards[1].vendedor_nome = 'Nilce';
    const b = await get('/clientes/eletroposto/102/relatorio');
    expect(b.status).toBe(200);
    expect(todoTexto(b.body)).not.toMatch(/9876|R\$/);
    for (const p of PROIBIDOS) expect(todoTexto(b.body), p).not.toContain(p);
    h.cards[1].vendedor_nome = 'Giovanna';
    expect((await get('/clientes/eletroposto/102/relatorio', GIOVANNA)).status).toBe(200);
    expect((await get('/clientes/eletroposto/102/relatorio')).status).toBe(404);
  });
  it('Eletroposto: arquivos anexados entram classificados por seção e quitam a falta', async () => {
    sobe(caminhoDe('eletroposto', '101', UUID, 'pdf'), 10, 'application/pdf');
    await registra('/clientes/eletroposto/101/docs', 'documento_titular', caminhoDe('eletroposto', '101', UUID, 'pdf'));
    const x = await get('/clientes/eletroposto/101/relatorio');
    expect(x.body.documentos).toEqual([{
      slot: 'documento_titular', rotulo: 'CNH ou documento pessoal do comprador', mime: 'application/pdf', secao: 2, tipo: 'documento-com-foto',
      arquivo: '2-documento-com-foto', url: expect.stringMatching(/^https:\/\/docs\.test\//),
    }]);
    expect(x.body.pendencias.documentos).not.toContain('Documento com foto do cliente');
  });
  it('Eletroposto: só entra o que serve à engenharia; documento do titular atual só quando troca a titularidade', async () => {
    const uuid = (n: number) => `${String(n).padStart(8, '0')}-3d4a-4b5c-8d6e-7f8091a2b3c4`;
    const slots = [
      'documento_titular', 'documento_cedente', 'documento_imovel', 'conta_luz', 'conta_luz_geradora', 'conta_luz_beneficiaria', 'padrao', 'quadro_eletrico', 'foto_local',
      'documento_avalista', 'documento_outra_pessoa', 'comprovante_endereco_comprador', 'comprovante_endereco_cedente', 'comprovante_endereco_avalista',
      'contrato_assinado', 'procuracao', 'anuencia', 'vistoria', 'art', 'projeto', 'parecer_acesso',
    ];
    for (const [i, slot] of slots.entries()) {
      const foto = ['padrao', 'quadro_eletrico', 'foto_local'].includes(slot);   // esses itens só aceitam imagem
      const c = caminhoDe('eletroposto', '101', uuid(i + 1), foto ? 'jpg' : 'pdf');
      sobe(c, 10, foto ? 'image/jpeg' : 'application/pdf');
      expect((await registra('/clientes/eletroposto/101/docs', slot, c)).status, slot).toBeLessThan(300);
    }
    fichaEp(101, { titular_conta: 'Carlos Alves' });
    const sem = await get('/clientes/eletroposto/101/relatorio');
    expect(sem.status).toBe(200);
    expect(sem.body.documentos.map((d: any) => d.arquivo)).toEqual([
      '2-documento-com-foto', '3-conta-de-energia', '5-documento-do-imovel-1', '5-conta-de-energia-geradora-1', '5-conta-de-energia-beneficiaria-1',
      '5-foto-do-local-1', '5-padrao-de-entrada-1', '5-quadro-eletrico-1',
    ]);
    expect(JSON.stringify(sem.body)).not.toMatch(/avalista|outra_pessoa|comprovante_endereco|contrato|procuracao|anuencia|vistoria|parecer/);
    expect(sem.body.pendencias.documentos).toEqual([]);
    fichaEp(101, { titular_conta: 'Maria Souza' });
    const com = await get('/clientes/eletroposto/101/relatorio');
    expect(com.body.documentos.find((d: any) => d.slot === 'documento_cedente')).toMatchObject({ secao: 5, tipo: 'documento-do-titular-atual', arquivo: '5-documento-do-titular-atual-1' });
  });
});

describe('log nunca leva caminho nem nome de arquivo', () => {
  it('erro do Storage com o caminho dentro da mensagem: só o código sobe', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    h.erroInfo = true;
    const x = await registra('/clientes/solar/57/docs', 'fachada', c);
    expect(x.status).toBe(502);
    const logado = JSON.stringify([...spyErr.mock.calls, ...(logger.error as any).mock.calls]);
    expect(logado).not.toContain(UUID);
    expect(logado).not.toContain('solar/0057');
    expect(logado).not.toContain('fichas-docs');
    expect(JSON.stringify(x.body)).not.toContain(UUID);
    expect(spyErr).toHaveBeenCalled();
  });
  it('fluxo inteiro (envio, registro, vínculo, relatório, remoção): nenhum log com uuid ou nome', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    const x = await registra('/clientes/solar/57/docs', 'fachada', c);
    await post('/clientes/solar/57/vincular-proposta', { proposta: 'IN-1' });
    await get('/clientes/solar/57/relatorio');
    await del(`/clientes/solar/57/docs/${x.body.arquivo.id}`);
    await registra('/clientes/solar/58/docs', 'fachada', c);
    const logado = JSON.stringify([...spyErr.mock.calls, ...(logger.error as any).mock.calls, ...(logger.info as any).mock.calls, ...(logger.warn as any).mock.calls]);
    expect(logado).not.toMatch(new RegExp(`${UUID}|CNH-ANA|casa-da-ana|solar/0057`));
  });
});

describe('vínculo: o nome do cliente não é permissão', () => {
  const vincular = (cod: string, proposta: unknown, auth = NILCE) => post(`/clientes/solar/${cod}/vincular-proposta`, { proposta }, auth);
  it('consultor que renomeia o cliente para o de outro consultor e vincula a proposta dele leva 404; sugestões nunca trazem proposta alheia', async () => {
    const ren = await post('/clientes/solar/campo', { codigo: '#0057', coluna: 'cliente', valor: 'Bruno Lima', base_em: '2000-01-01T00:00:00.000Z' });
    expect(ren.status).toBe(200);
    expect((await get('/clientes/solar/57/relatorio')).body.cabecalho.cliente).toBe('Bruno Lima');
    const x = await vincular('57', 'IN-3');   // proposta da Giovanna, nome idêntico ao "novo" cliente
    expect(x.status).toBe(404);
    expect(x.body).toEqual((await vincular('57', 'IN-999')).body);
    expect((await get('/clientes/solar/57/sugestoes-proposta')).body.sugestoes).toEqual([]);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
    expect((await vincular('57', 'IN-3', THIAGO)).status).toBe(200);   // o sócio continua podendo
  });
  it('proposta sem consultor_nome: só sócio vincula; nome igual de OUTRO consultor não basta', async () => {
    h.propostas[0].consultor_nome = '';
    expect((await vincular('57', 'IN-1')).status).toBe(404);
    expect((await get('/clientes/solar/57/sugestoes-proposta')).body.sugestoes.map((s: any) => s.codigo)).toEqual(['IN-4']);
    expect((await vincular('57', 'IN-1', THIAGO)).status).toBe(200);
    h.propostas[3].consultor_nome = 'Giovanna';
    expect((await vincular('57', 'IN-4')).status).toBe(404);
    expect((await get('/clientes/solar/57/sugestoes-proposta')).body.sugestoes).toEqual([]);
  });
});

describe('caminho guardado na leitura', () => {
  it('arquivo com caminho de outra venda (injetado no system_state) não é assinado, não é listado e não é apagado', async () => {
    const meu = caminhoDe('solar', '0057', UUID);
    const alheio = caminhoDe('solar', '0058', UUID2);
    sobe(meu); sobe(alheio);
    h.linhas.set('docs_cliente:solar:0057', { updated_at: 'v0', value: { alteracoes: [], arquivos: [
      { id: 'a1', slot: 'fachada', caminho: meu, mime: 'image/jpeg', bytes: 1, em: 'e', por: 'nilce' },
      { id: UUID2, slot: 'padrao', caminho: alheio, mime: 'image/jpeg', bytes: 1, em: 'e', por: 'nilce' },
      { id: 'a3', slot: 'medidor', caminho: caminhoDe('eletroposto', '57', UUID2), mime: 'image/jpeg', bytes: 1, em: 'e', por: 'nilce' },
    ] } });
    const l = await get('/clientes/solar/57/docs');
    expect(l.body.arquivos.map((a: any) => a.id)).toEqual(['a1']);
    const rel = await get('/clientes/solar/57/relatorio');
    expect(rel.body.documentos.map((d: any) => d.slot)).toEqual(['fachada']);
    expect(rel.body.pendencias.documentos).toContain('Foto do padrão de entrada');
    expect((await del(`/clientes/solar/57/docs/${UUID2}`)).status).toBe(404);
    expect(h.objetos.has(alheio)).toBe(true);
    expect(h.chamadas.filter((c) => c.op === 'remove')).toHaveLength(0);
    const logado = JSON.stringify(spyErr.mock.calls);
    expect(logado).toContain('caminho_fora');
    expect(logado).not.toContain(UUID2);
  });
});

describe('texto livre fora do relatório', () => {
  it('Solar: obs e contrato de cooperativa não saem; Eletroposto: obs da ficha não sai', async () => {
    h.csv = paraCsv([venda('#0057', { 'NOME CLIENTE': 'Ana Souza', CONSULTOR: 'Nilce', 'OBS:': 'ZZOBSLIVRE pagou 5 mil', 'CONTRATO COOPERATIVA': 'ZZCOOP 300 por mes' })]);
    limparCacheClientes();
    const a = await get('/clientes/solar/57/relatorio', THIAGO);
    expect(JSON.stringify(a.body)).not.toMatch(/ZZOBSLIVRE|ZZCOOP/);
    h.linhas.set('cliente_ep:101', { value: { campos: { obs: { valor: 'ZZOBSEP pix de 9 mil', por: 'x', em: 'e' } }, alteracoes: [], em: 'e' }, updated_at: 'f1' });
    const b = await get('/clientes/eletroposto/101/relatorio', THIAGO);
    expect(JSON.stringify(b.body)).not.toContain('ZZOBSEP');
    expect(b.body.secoes.map((s: any) => s.titulo)).not.toContain('Observação');
  });
});

describe('bucket público nas 6 rotas', () => {
  it('relatório (as duas linhas), remover, lista, envio e registro: 502 e nada muda', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    const reg = await registra('/clientes/solar/57/docs', 'fachada', c);
    const id = reg.body.arquivo.id;
    h.bucket = { public: true, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] };
    limparCacheBucketDocs();
    expect((await get('/clientes/solar/57/relatorio')).status).toBe(502);
    limparCacheBucketDocs();
    expect((await get('/clientes/eletroposto/101/relatorio')).status).toBe(502);
    limparCacheBucketDocs();
    expect((await del(`/clientes/solar/57/docs/${id}`)).status).toBe(502);
    expect(h.objetos.has(c)).toBe(true);
    expect(valorDe('docs_cliente:solar:0057')!.arquivos).toHaveLength(1);
    limparCacheBucketDocs();
    expect((await get('/clientes/solar/57/docs')).status).toBe(502);
    limparCacheBucketDocs();
    expect((await post('/clientes/solar/57/docs/upload-url', { slot: 'obra_pronta', mime: 'image/jpeg', bytes: 5 })).status).toBe(502);
    limparCacheBucketDocs();
    expect((await registra('/clientes/solar/57/docs', 'obra_pronta', c)).status).toBe(502);
  });
});

describe('assinatura de verdade (primeiros bytes)', () => {
  const url = '/clientes/solar/57/docs';
  it('PDF enviado como se fosse JPEG: 400, objeto removido, nada gravado', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c, 100, 'image/jpeg', MAGICO['application/pdf']);
    const x = await registra(url, 'fachada', c);
    expect(x.status).toBe(400);
    expect(h.objetos.has(c)).toBe(false);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
    expect(h.ranges).toEqual(['bytes=0-15']);
  });
  it('cada tipo confere a sua assinatura; lixo com o tipo certo no cabeçalho é recusado', async () => {
    const casos: Array<[string, string, string]> = [['jpg', 'image/jpeg', 'fachada'], ['png', 'image/png', 'padrao'], ['webp', 'image/webp', 'medidor'], ['pdf', 'application/pdf', 'documento']];
    let n = 0;
    for (const [ext, mime, slot] of casos) {
      const bom = caminhoDe('solar', '0057', `0000000${n}-0000-4000-8000-000000000000`, ext);
      sobe(bom, 100, mime);
      expect((await registra(url, slot, bom)).status, `bom ${mime}`).toBe(200);
      n++;
    }
    const ruim = caminhoDe('solar', '0057', UUID2, 'png');
    sobe(ruim, 100, 'image/png', Buffer.alloc(16));
    expect((await registra(url, 'obra_pronta', ruim)).status).toBe(400);
    expect(h.objetos.has(ruim)).toBe(false);
    const webpFalso = caminhoDe('solar', '0057', UUID, 'webp');
    sobe(webpFalso, 100, 'image/webp', Buffer.from('RIFF\0\0\0\0WAVEfmt '));
    expect((await registra(url, 'obra_pronta', webpFalso)).status).toBe(400);
  });
});

describe('arquivo apagado não volta', () => {
  it('depois do DELETE, o mesmo caminho é recusado no registro (e o objeto reenviado some)', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    const x = await registra('/clientes/solar/57/docs', 'fachada', c);
    expect((await del(`/clientes/solar/57/docs/${x.body.arquivo.id}`)).status).toBe(200);
    sobe(c);   // o token de envio ainda valia: reenviou no mesmo caminho
    const y = await registra('/clientes/solar/57/docs', 'fachada', c);
    expect(y.status).toBe(400);
    expect(h.objetos.has(c)).toBe(false);
    expect(valorDe('docs_cliente:solar:0057')!.arquivos).toEqual([]);
    const c2 = caminhoDe('solar', '0057', UUID2);
    sobe(c2);
    expect((await registra('/clientes/solar/57/docs', 'fachada', c2)).status).toBe(200);   // outro caminho do mesmo item segue valendo
  });
});

describe('vínculo conferido na leitura', () => {
  const injeta = (proposta: string) => h.linhas.set('docs_cliente:solar:0057', {
    updated_at: 'v0', value: { arquivos: [], alteracoes: [], apagados: [], vinculo: { proposta, por: 'nilce', em: 'e' } },
  });
  it('vínculo injetado para proposta de OUTRO consultor: ignorado no GET docs e no relatório (consultor), sem servir o dossiê', async () => {
    h.propostas[0].consultor_nome = 'Giovanna';   // IN-1 tem CNH e fachada no dossiê
    injeta('IN-1');
    const l = await get('/clientes/solar/57/docs');
    expect(l.body.vinculo).toBeNull();
    const r = await get('/clientes/solar/57/relatorio');
    expect(r.body.documentos).toEqual([]);
    expect(r.body.pendencias.documentos).toContain('Documento com foto do cliente');
    expect(h.sig).toBe(0);                         // nenhuma URL de dossiê foi assinada
    expect(JSON.stringify(spyErr.mock.calls)).toContain('vinculo_fora');
    // proposta que nem existe: também ignorada
    injeta('IN-999');
    expect((await get('/clientes/solar/57/docs')).body.vinculo).toBeNull();
  });
  it('o sócio vê o vínculo; o consultor vê o vínculo que é dele', async () => {
    h.propostas[0].consultor_nome = 'Giovanna';
    injeta('IN-1');
    const s = await get('/clientes/solar/57/docs', THIAGO);
    expect(s.body.vinculo.proposta).toBe('IN-1');
    expect(s.body.vinculo.arquivos).toHaveLength(2);
    h.propostas[0].consultor_nome = 'Nilce';
    expect((await get('/clientes/solar/57/docs')).body.vinculo.arquivos).toHaveLength(2);
  });
});

describe('arquivo órfão se a leitura dos bytes falhar', () => {
  it('rede caiu: remove o objeto antes do 502, nada gravado', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    h.falhaBytes = true;
    const x = await registra('/clientes/solar/57/docs', 'fachada', c);
    expect(x.status).toBe(502);
    expect(h.objetos.has(c)).toBe(false);
    expect(h.linhas.has('docs_cliente:solar:0057')).toBe(false);
  });
  it('se a remoção também falhar, responde 502 e o log leva só o código', async () => {
    const c = caminhoDe('solar', '0057', UUID);
    sobe(c);
    h.falhaBytes = true; h.erroRemove = true;
    const x = await registra('/clientes/solar/57/docs', 'fachada', c);
    expect(x.status).toBe(502);
    const logado = JSON.stringify([...spyErr.mock.calls, ...(logger.error as any).mock.calls]);
    expect(logado).toContain('remover_objeto');
    expect(logado).toContain('ler_bytes');
    expect(logado).not.toContain(UUID);
    expect(logado).not.toContain('solar/0057');
    expect(JSON.stringify(x.body)).not.toContain(UUID);
  });
});
