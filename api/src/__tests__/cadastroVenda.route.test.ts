import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Cadastro da venda do eletroposto: rotas, leitura dos documentos por IA e a ficha lendo do cadastro. Tudo simulado:
// o login, os dois bancos, o bucket privado e a Anthropic (nenhuma chamada sai para a rede). Dados inventados.
// O que se prova: guarda (404 igual), PUT que não grava nada com erro, fail-closed do bucket, imagem grande e PDF falso
// ignorados, plano B do modelo, sugestão inválida vira baixa, nenhum valor de campo em log, e a ficha migrando.

type Entrada = { erro?: unknown; saida?: unknown; parada?: string };
const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, unknown>>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  /** Bucket `fichas-docs` (documentos): caminho -> bytes. */
  objetos: new Map<string, Buffer>(),
  /** Bucket `cadastros-venda` (o cadastro): `eletroposto/<id>.json` -> bytes. */
  cad: new Map<string, Buffer>(),
  cadExiste: true,
  cadFora: false,
  docsFora: false,
  baixaFora: false,
  atrasoUpload: 0,
  /** A linha da trava como estava NO MOMENTO do upload do cadastro. */
  travaNoUpload: '',
  semLimparFicha: false,
  criados: [] as Array<{ nome: string; opcoes: any }>,
  atualizados: 0,
  getBuckets: [] as string[],
  tique: 0,
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
      stream: (corpo: unknown, opcoes: unknown) => {
        h.ia.chamadas.push({ corpo, opcoes });
        const e = h.ia.fila.shift() ?? { erro: new Error('fila vazia') };
        return {
          finalMessage: async () => {
            if (e.erro) throw e.erro;
            return { stop_reason: e.parada ?? 'end_turn', content: [{ type: 'text', text: JSON.stringify(e.saida) }] };
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
        h.getBuckets.push(nome);
        if (nome === 'cadastros-venda') {
          if (h.cadFora) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
          return h.cadExiste
            ? { data: { public: false, file_size_limit: 262144, allowed_mime_types: ['application/json'] }, error: null }
            : { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
        }
        return h.docsFora
          ? { data: null, error: { message: 'fora do ar', statusCode: '500' } }
          : { data: { public: false, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }, error: null };
      },
      createBucket: async (nome: string, opcoes: unknown) => {
        h.criados.push({ nome, opcoes });
        if (h.cadFora) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
        if (nome === 'cadastros-venda') h.cadExiste = true;
        return { data: {}, error: null };
      },
      updateBucket: async () => { h.atualizados++; return { data: {}, error: null }; },
      from: (nome: string) => {
        const cadastro = nome === 'cadastros-venda';
        const mapa = cadastro ? h.cad : h.objetos;
        const fora = (): boolean => (cadastro ? h.cadFora : h.docsFora);
        return {
          // Como o storage-js real devolve no download (noResolveJson): mensagem vazia e status 400, sem "not found" em texto.
          info: async (p: string) => {
            if (fora()) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
            const t = mapa.get(p);
            return t === undefined
              ? { data: null, error: { message: 'Object not found', statusCode: '404' } }
              : { data: { id: 'o1', name: p, size: t.length, contentType: 'application/json' }, error: null };
          },
          download: async (p: string) => {
            if (fora() || (!cadastro && h.baixaFora)) return { data: null, error: { message: '{}', status: 500 } };
            const t = mapa.get(p);
            return t === undefined
              ? { data: null, error: { message: '{}', status: 400 } }
              : { data: { text: async () => t.toString('utf8'), arrayBuffer: async () => t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength) }, error: null };
          },
          upload: async (p: string, corpo: Buffer) => {
            if (fora()) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
            if (cadastro) h.travaNoUpload = JSON.stringify(h.linhas.get('cadastro_trava:101') ?? null);
            if (h.atrasoUpload) await new Promise((r) => setTimeout(r, h.atrasoUpload));
            mapa.set(p, Buffer.from(corpo));
            return { data: { path: p }, error: null };
          },
          list: async (pasta: string) => {
            if (fora()) return { data: null, error: { message: 'fora do ar', statusCode: '500' } };
            const nomes = new Set<string>();
            for (const k of mapa.keys()) if (k.startsWith(pasta + '/')) nomes.add(k.slice(pasta.length + 1).split('/')[0]);
            return { data: [...nomes].map((name) => ({ name })), error: null };
          },
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
                const l = h.linhas.get(k);
                if (!l || !ok(l) || (h.semLimparFicha && k.startsWith('cliente_ep:'))) return { data: [], error: null };
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
import { mountClientesEletroposto } from '../routes/geradorEletropostoClientes';
import { mountClientesDocs } from '../routes/geradorClientesDocs';
import { validarCampo, gravarCampos, lerCadastro, faltando, normalizarCadastro, cadastroVazio } from '../services/gerador/cadastroVenda';
import { limparCacheBucketDocs } from '../services/gerador/docsClienteBanco';
import { limparCacheBucketCadastros } from '../services/gerador/cadastroVendaBanco';
import { MODELO_PLANO_B, SISTEMA_CADASTRO } from '../services/gerador/cadastroVendaLeitura';

const r = Router();
mountClientesDocs(r);
mountCadastroVenda(r);
mountClientesEletroposto(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';

const CPF_OK = '529.982.247-25';
const CNPJ_OK = '11.222.333/0001-81';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PDF = Buffer.from('%PDF-1.4\nconta de luz de teste\n%%EOF');

const card = (id: number, o: Record<string, unknown>) => ({
  id, cliente_nome: 'Fulano', cliente_telefone: '', cidade: '', vendedor_nome: 'Nilce', created_by: 'lp_eletroposto',
  status: 'fechou', created_at: '2026-09-10T15:00:00.000Z', ...o,
});
const cadastroDe = (id: number) => JSON.parse(h.cad.get(`eletroposto/${id}.json`)?.toString('utf8') ?? '{"campos":{},"alteracoes":[]}');
const anexa = (id: number, arquivos: Array<{ slot: string; uuid: string; ext: string; mime: string; bytes: number; em: string }>) => {
  h.linhas.set(`docs_cliente:eletroposto:${id}`, {
    updated_at: 'd0',
    value: {
      arquivos: arquivos.map((a, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, slot: a.slot, caminho: `eletroposto/${id}/${a.uuid}.${a.ext}`, mime: a.mime, bytes: a.bytes, em: a.em, por: 'nilce' })),
      alteracoes: [], apagados: [],
    },
  });
};
const sugestaoIA = (extra: Record<string, { valor: string; slot: string; confianca: string }> = {}) => ({ saida: extra });
const base = '/gerador/clientes/eletroposto';
const getCad = (id: number, auth = NILCE) => request(app).get(`${base}/${id}/cadastro`).set('Authorization', auth);
const putCad = (id: number, corpo: unknown, auth = NILCE) => request(app).put(`${base}/${id}/cadastro`).set('Authorization', auth).send(corpo as object);
const ler = (id: number, auth = NILCE) => request(app).post(`${base}/${id}/cadastro/ler`).set('Authorization', auth).send({});
const postCampo = (corpo: Record<string, unknown>, auth = NILCE) =>
  request(app).post(`${base}/campo`).set('Authorization', auth).send({ base_em: '2000-01-01T00:00:00.000Z', ...corpo });

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app',
  };
  h.cards = [
    card(101, { cliente_nome: 'Carlos Alves', cliente_telefone: '(34) 98888-0001', cidade: 'Uberlandia' }),
    card(102, { cliente_nome: 'Dora Reis', vendedor_nome: 'Giovanna', created_by: 'manychat_eletroposto' }),
    card(103, { cliente_nome: 'Eli Solar', created_by: 'lp_solar' }),
    card(104, { cliente_nome: 'Fabio Agendado', status: 'agendado' }),
  ];
  h.linhas = new Map();
  h.objetos = new Map();
  h.cad = new Map();
  h.cadExiste = true; h.cadFora = false; h.docsFora = false; h.baixaFora = false; h.atrasoUpload = 0; h.semLimparFicha = false; h.travaNoUpload = '';
  h.criados = []; h.atualizados = 0; h.getBuckets = [];
  limparCacheBucketDocs();
  limparCacheBucketCadastros();
  h.tique = 0;
  h.ia.fila = []; h.ia.chamadas = [];
  h.logs = [];
  delete process.env.CADASTRO_IA_MODELO;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T15:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('validação dos campos', () => {
  it('CPF e CNPJ: dígito verificador conferido e saída formatada', () => {
    expect(validarCampo('cpf_cnpj', '52998224725')).toEqual({ ok: true, valor: CPF_OK });
    expect(validarCampo('cpf_cnpj', CNPJ_OK)).toEqual({ ok: true, valor: CNPJ_OK });
    expect(validarCampo('cpf_cnpj', '11222333000181')).toEqual({ ok: true, valor: CNPJ_OK });
    expect(validarCampo('cpf_cnpj', '529.982.247-24')).toEqual({ ok: false, erro: 'Dígito do CPF não confere.' });
    expect(validarCampo('cpf_cnpj', '11.222.333/0001-80')).toEqual({ ok: false, erro: 'Dígito do CNPJ não confere.' });
    expect(validarCampo('cpf_cnpj', '111.111.111-11').ok).toBe(false);
    expect(validarCampo('cpf_cnpj', '123').ok).toBe(false);
    expect(validarCampo('rep_cpf', CNPJ_OK).ok).toBe(false);
    expect(validarCampo('rep_cpf', '52998224725')).toEqual({ ok: true, valor: CPF_OK });
  });
  it('CEP, UF, e-mail, nascimento, telefone, tipo e limite de tamanho', () => {
    expect(validarCampo('cep', '38400100')).toEqual({ ok: true, valor: '38400-100' });
    expect(validarCampo('cep', '384').ok).toBe(false);
    expect(validarCampo('uf', 'mg')).toEqual({ ok: true, valor: 'MG' });
    expect(validarCampo('uf', 'XX').ok).toBe(false);
    expect(validarCampo('email', 'Ana@Exemplo.com')).toEqual({ ok: true, valor: 'ana@exemplo.com' });
    expect(validarCampo('email', 'sem-arroba').ok).toBe(false);
    expect(validarCampo('nascimento', '29/02/2000')).toEqual({ ok: true, valor: '29/02/2000' });
    expect(validarCampo('nascimento', '29/02/2001').ok).toBe(false);
    expect(validarCampo('nascimento', '31/04/1990').ok).toBe(false);
    expect(validarCampo('nascimento', '01/01/2999').ok).toBe(false);
    expect(validarCampo('nascimento', '1990-01-01').ok).toBe(false);
    expect(validarCampo('telefone', '(34) 98888-0001')).toEqual({ ok: true, valor: '34988880001' });
    expect(validarCampo('telefone', '123').ok).toBe(false);
    expect(validarCampo('tipo', 'pj')).toEqual({ ok: true, valor: 'PJ' });
    expect(validarCampo('tipo', 'XX').ok).toBe(false);
    expect(validarCampo('profissao', 'x'.repeat(201)).ok).toBe(false);
    expect(validarCampo('profissao', 'x'.repeat(200)).ok).toBe(true);
    expect(validarCampo('profissao', '')).toEqual({ ok: true, valor: '' });
    expect(validarCampo('nome', 42).ok).toBe(false);
  });
  it('faltando: PF e PJ pedem coisas diferentes; IE aceita "isento"', () => {
    const c = cadastroVazio();
    expect(faltando(c)).toContain('nacionalidade');
    expect(faltando(c)).not.toContain('rep_nome');
    const pj = normalizarCadastro({ campos: { cpf_cnpj: { valor: CNPJ_OK, por: 'x', em: 'y', fonte: 'manual' }, rg_ie: { valor: 'isento', por: 'x', em: 'y', fonte: 'manual' } } });
    expect(faltando(pj)).toContain('rep_nome');
    expect(faltando(pj)).toContain('rep_cpf');
    expect(faltando(pj)).not.toContain('nacionalidade');
    expect(faltando(pj)).not.toContain('rg_ie');
  });
});

describe('mescla por campo no bucket', () => {
  it('cada gravação lê o JSON mais recente: a de um campo não apaga a do outro, e a última vence no mesmo campo', async () => {
    await gravarCampos(101, { nome: 'Ana' }, 'nilce', 'manual', '2026-10-19T10:00:00.000Z');
    await gravarCampos(101, { email: 'a@b.com' }, 'thiago', 'ia', '2026-10-19T10:01:00.000Z');
    await gravarCampos(101, { nome: 'Ana Maria' }, 'thiago', 'manual', '2026-10-19T10:02:00.000Z');
    const c = await lerCadastro(101);
    expect(c.campos.nome).toMatchObject({ valor: 'Ana Maria', por: 'thiago', fonte: 'manual' });
    expect(c.campos.email).toMatchObject({ valor: 'a@b.com', por: 'thiago', fonte: 'ia' });
    // a trilha guarda quem, quando e qual campo, nunca o valor
    expect(c.alteracoes).toHaveLength(3);
    expect(JSON.stringify(cadastroDe(101).alteracoes)).not.toMatch(/Ana|a@b\.com/);
    // vazio limpa
    await gravarCampos(101, { email: '' }, 'nilce', 'manual');
    expect((await lerCadastro(101)).campos.email).toBeUndefined();
  });
  it('a trilha guarda só as últimas 50', async () => {
    for (let i = 0; i < 60; i++) await gravarCampos(101, { profissao: `p${i}` }, 'nilce', 'manual');
    expect(cadastroDe(101).alteracoes).toHaveLength(50);
  });
  it('bucket fora do ar: erro, nunca cadastro vazio de mentira', async () => {
    h.cadFora = true;
    await expect(lerCadastro(101)).rejects.toThrow();
    await expect(gravarCampos(101, { nome: 'Ana' }, 'nilce', 'manual')).rejects.toThrow();
  });
});

describe('GET e PUT do cadastro', () => {
  it('GET de venda sem cadastro: vazio, o que falta e tipo PF', async () => {
    const res = await getCad(101);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.ok).toBe(true);
    expect(res.body.cadastro.campos).toEqual({});
    expect(res.body.cadastro.tipo).toBe('PF');
    expect(res.body.cadastro.faltando).toEqual(expect.arrayContaining(['nome', 'cpf_cnpj', 'rg_ie', 'nacionalidade', 'unidade_consumidora']));
  });
  it('guarda: consultor de outra venda, card de solar, card não vendido e inexistente respondem 404 igual; sócio vê; sem login 401', async () => {
    const alheia = await getCad(101, GIOVANNA);
    expect(alheia.status).toBe(404);
    for (const id of [103, 104, 999]) {
      const x = await getCad(id, THIAGO);
      expect(x.status).toBe(404);
      expect(x.body).toEqual(alheia.body);
    }
    expect((await getCad(101, THIAGO)).status).toBe(200);
    expect((await putCad(101, { campos: { nome: 'X' } }, GIOVANNA)).status).toBe(404);
    expect((await ler(101, GIOVANNA)).status).toBe(404);
    expect(h.cad.size).toBe(0);
    expect((await request(app).get(`${base}/101/cadastro`)).status).toBe(401);
  });
  it('PUT grava formatado, deriva o tipo pelo documento e devolve o cadastro', async () => {
    const res = await putCad(101, { campos: { nome: 'Carlos Alves', cpf_cnpj: '52998224725', cep: '38400100', uf: 'mg', telefone: '(34) 98888-0001' } });
    expect(res.status).toBe(200);
    expect(res.body.cadastro.campos.cpf_cnpj).toMatchObject({ valor: CPF_OK, por: 'nilce', fonte: 'manual' });
    expect(res.body.cadastro.campos.uf.valor).toBe('MG');
    expect(res.body.cadastro.campos.cep.valor).toBe('38400-100');
    expect(res.body.cadastro.campos.telefone.valor).toBe('34988880001');
    expect(res.body.cadastro.tipo).toBe('PF');
    expect(res.body.cadastro.faltando).not.toContain('cpf_cnpj');
    expect(cadastroDe(101).campos.tipo.valor).toBe('PF');
    const pj = await putCad(101, { campos: { cpf_cnpj: CNPJ_OK }, fonte: 'ia' });
    expect(pj.body.cadastro.tipo).toBe('PJ');
    expect(pj.body.cadastro.campos.cpf_cnpj.fonte).toBe('ia');
    expect(pj.body.cadastro.faltando).toContain('rep_nome');
    expect((await getCad(101)).body.cadastro.campos.nome.valor).toBe('Carlos Alves');
    // o cadastro NUNCA vai para o system_state
    expect([...h.linhas.keys()].some((k) => k.startsWith('cadastro') || k.startsWith('cliente_ep'))).toBe(false);
  });
  it('PUT com um campo inválido: 400 com os erros por campo e NADA é gravado', async () => {
    const res = await putCad(101, { campos: { nome: 'Ana', cpf_cnpj: '111.111.111-11', cep: '12' } });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(Object.keys(res.body.erros).sort()).toEqual(['cep', 'cpf_cnpj']);
    expect(h.cad.size).toBe(0);
  });
  it('PUT: campo desconhecido, corpo vazio, fonte inválida e valor que não é texto dão 400 sem gravar', async () => {
    const a = await putCad(101, { campos: { nome: 'Ana', senha: 'x' } });
    expect(a.status).toBe(400);
    expect(a.body.erros).toEqual({ senha: 'Campo desconhecido.' });
    expect((await putCad(101, { campos: {} })).status).toBe(400);
    expect((await putCad(101, {})).status).toBe(400);
    expect((await putCad(101, { campos: { nome: 'Ana' }, fonte: 'ficha' })).status).toBe(400);
    expect((await putCad(101, { campos: { nome: 12 } })).status).toBe(400);
    expect(h.cad.size).toBe(0);
  });
  it('bucket fora do ar: GET e PUT dão 503 cadastro_indisponivel', async () => {
    h.cadFora = true;
    const g = await getCad(101);
    expect(g.status).toBe(503);
    expect(g.body).toEqual({ ok: false, motivo: 'cadastro_indisponivel' });
    const p = await putCad(101, { campos: { nome: 'Ana' } });
    expect(p.status).toBe(503);
    expect(p.body).toEqual({ ok: false, motivo: 'cadastro_indisponivel' });
  });
});

describe('POST cadastro/ler (IA lê os documentos já anexados)', () => {
  const doc = (slot: string, uuid: string, ext: string, mime: string, bytes: number, em: string) => ({ slot, uuid, ext, mime, bytes, em });

  it('sem documento de slot lido: 409 sem_documentos e a IA nem é chamada', async () => {
    anexa(101, [doc('foto_local', U1, 'jpg', 'image/jpeg', JPG.length, '2026-10-19T10:00:00.000Z')]);
    h.objetos.set(`eletroposto/101/${U1}.jpg`, JPG);
    const res = await ler(101);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, motivo: 'sem_documentos' });
    expect(h.ia.chamadas).toHaveLength(0);
    expect((await ler(102, THIAGO)).status).toBe(409);
  });
  it('lê os slots certos, manda image e document, e devolve sugestões revalidadas (inválida vira baixa com nota)', async () => {
    anexa(101, [
      doc('documento_titular', U1, 'jpg', 'image/jpeg', JPG.length, '2026-10-19T10:00:00.000Z'),
      doc('conta_luz', U2, 'pdf', 'application/pdf', PDF.length, '2026-10-19T11:00:00.000Z'),
      doc('foto_local', U3, 'jpg', 'image/jpeg', JPG.length, '2026-10-19T12:00:00.000Z'),
    ]);
    h.objetos.set(`eletroposto/101/${U1}.jpg`, JPG);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, PDF);
    h.objetos.set(`eletroposto/101/${U3}.jpg`, JPG);
    h.ia.fila.push(sugestaoIA({
      nome: { valor: 'ZZNOME Teste', slot: 'documento_titular', confianca: 'alta' },
      cpf_cnpj: { valor: '529.982.247-24', slot: 'documento_titular', confianca: 'alta' },
      rg_ie: { valor: '', slot: '', confianca: 'baixa' },
      unidade_consumidora: { valor: '0012345678', slot: 'conta_luz', confianca: 'Média' },
      cep: { valor: '38400100', slot: 'conta_luz', confianca: 'alta' },
      endereco_ponto: { valor: 'Rua Teste 10, Centro, Uberlandia MG', slot: 'foto_local', confianca: 'alta' },
    }));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.lidos).toEqual(expect.arrayContaining([{ slot: 'documento_titular', n: 1 }, { slot: 'conta_luz', n: 1 }]));
    expect(res.body.lidos).toHaveLength(2);
    const s = res.body.sugestoes;
    expect(s.nome).toEqual({ valor: 'ZZNOME Teste', slot: 'documento_titular', confianca: 'alta' });
    expect(s.cpf_cnpj).toEqual({ valor: '529.982.247-24', slot: 'documento_titular', confianca: 'baixa', nota: 'Dígito do CPF não confere.' });
    expect(s.cep).toEqual({ valor: '38400-100', slot: 'conta_luz', confianca: 'alta' });
    expect(s.unidade_consumidora.confianca).toBe('media');
    expect(s.rg_ie).toBeUndefined();   // vazio sai das sugestões
    expect(s.endereco_ponto.slot).toBe('');   // slot que não foi lido não vale
    // a IA SÓ sugere: nada foi gravado
    expect(h.cad.has('eletroposto/101.json')).toBe(false);
    // o pedido
    expect(h.ia.chamadas).toHaveLength(1);
    const { corpo, opcoes } = h.ia.chamadas[0];
    expect(corpo.model).toBe('claude-sonnet-5-5');
    expect(corpo.max_tokens).toBe(8000);
    expect(corpo.system).toBe(SISTEMA_CADASTRO);
    expect(opcoes.timeout).toBe(90_000);
    expect('tool_choice' in corpo).toBe(false);
    expect(corpo.output_config.format.type).toBe('json_schema');
    const tipos = corpo.messages[0].content.map((b: any) => b.type);
    expect(tipos.filter((t: string) => t === 'image')).toHaveLength(1);
    expect(tipos.filter((t: string) => t === 'document')).toHaveLength(1);
    const bloco = corpo.messages[0].content.find((b: any) => b.type === 'document');
    expect(bloco.source).toEqual({ type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') });
  });
  it('os mais recentes primeiro, no máximo 8 arquivos', async () => {
    const fs = Array.from({ length: 10 }, (_, i) => {
      const uuid = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;
      h.objetos.set(`eletroposto/101/${uuid}.jpg`, JPG);
      return doc('outros', uuid, 'jpg', 'image/jpeg', JPG.length, `2026-10-19T10:${String(i).padStart(2, '0')}:00.000Z`);
    });
    anexa(101, fs);
    h.ia.fila.push(sugestaoIA());
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.lidos).toEqual([{ slot: 'outros', n: 8 }]);
    expect(res.body.ignorados).toHaveLength(2);
  });
  it('imagem acima de 3,75 MB (pelo metadado ou pelos bytes) e PDF sem %PDF- vão para ignorados; sem sobrar nada, 409', async () => {
    anexa(101, [
      doc('documento_titular', U1, 'jpg', 'image/jpeg', 4 * 1024 * 1024, '2026-10-19T10:00:00.000Z'),
      doc('conta_luz', U2, 'pdf', 'application/pdf', 40, '2026-10-19T11:00:00.000Z'),
      doc('procuracao', U3, 'jpg', 'image/jpeg', 100, '2026-10-19T12:00:00.000Z'),
    ]);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, Buffer.from('isto nao e um pdf de verdade, so texto'));
    h.objetos.set(`eletroposto/101/${U3}.jpg`, Buffer.concat([JPG, Buffer.alloc(3.75 * 1024 * 1024 + 10, 2)]));   // o metadado mente
    const res = await ler(101);
    expect(res.status).toBe(409);
    expect(res.body.motivo).toBe('sem_documentos');
    const m = Object.fromEntries(res.body.ignorados.map((i: { slot: string; motivo: string }) => [i.slot, i.motivo]));
    expect(m.documento_titular).toBe('Foto acima de 3,7 MB: mande uma menor.');
    expect(m.procuracao).toBe('Foto acima de 3,7 MB: mande uma menor.');
    expect(m.conta_luz).toBe('O arquivo não é do tipo informado.');
    expect(h.ia.chamadas).toHaveLength(0);
  });
  it('foto com cabeçalho de outro tipo é ignorada; o resto segue', async () => {
    anexa(101, [
      doc('documento_titular', U1, 'png', 'image/png', JPG.length, '2026-10-19T10:00:00.000Z'),   // diz png, é jpeg
      doc('conta_luz', U2, 'pdf', 'application/pdf', PDF.length, '2026-10-19T11:00:00.000Z'),
    ]);
    h.objetos.set(`eletroposto/101/${U1}.png`, JPG);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, PDF);
    h.ia.fila.push(sugestaoIA());
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.lidos).toEqual([{ slot: 'conta_luz', n: 1 }]);
    expect(res.body.ignorados).toEqual([{ slot: 'documento_titular', motivo: 'O arquivo não é do tipo informado.' }]);
  });
  it('modelo inexistente: tenta UMA vez o claude-sonnet-4-6; CADASTRO_IA_MODELO troca o primeiro', async () => {
    anexa(101, [doc('conta_luz', U2, 'pdf', 'application/pdf', PDF.length, '2026-10-19T11:00:00.000Z')]);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, PDF);
    process.env.CADASTRO_IA_MODELO = 'modelo-que-nao-existe';
    h.ia.fila.push({ erro: Object.assign(new Error('model: modelo-que-nao-existe'), { status: 404 }) });
    h.ia.fila.push(sugestaoIA({ concessionaria: { valor: 'Cemig', slot: 'conta_luz', confianca: 'alta' } }));
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(h.ia.chamadas.map((c) => c.corpo.model)).toEqual(['modelo-que-nao-existe', MODELO_PLANO_B]);
    expect(res.body.sugestoes.concessionaria.valor).toBe('Cemig');
  });
  it('erro que não é modelo inexistente (limite, 500) NÃO troca de modelo: 502 ia_indisponivel', async () => {
    anexa(101, [doc('conta_luz', U2, 'pdf', 'application/pdf', PDF.length, '2026-10-19T11:00:00.000Z')]);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, PDF);
    h.ia.fila.push({ erro: Object.assign(new Error('overloaded'), { status: 529 }) });
    const res = await ler(101);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ ok: false, motivo: 'ia_indisponivel' });
    expect(h.ia.chamadas).toHaveLength(1);
  });
  it('resposta cortada (max_tokens) ou fora do formato: 502, nunca sugestão pela metade', async () => {
    anexa(101, [doc('conta_luz', U2, 'pdf', 'application/pdf', PDF.length, '2026-10-19T11:00:00.000Z')]);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, PDF);
    h.ia.fila.push({ saida: { nome: { valor: 'Cortado', slot: 'conta_luz', confianca: 'alta' } }, parada: 'max_tokens' });
    expect((await ler(101)).status).toBe(502);
    h.ia.fila.push({ saida: null });
    expect((await ler(101)).status).toBe(502);
  });
  it('bucket de documentos fora do ar: 503 cadastro_indisponivel', async () => {
    h.docsFora = true;
    const res = await ler(101);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, motivo: 'cadastro_indisponivel' });
  });
  it('download que falha por culpa do bucket não vira "sem documentos": 503; se sobrou algum arquivo bom, a leitura segue', async () => {
    anexa(101, [doc('conta_luz', U2, 'pdf', 'application/pdf', PDF.length, '2026-10-19T11:00:00.000Z')]);
    h.objetos.set(`eletroposto/101/${U2}.pdf`, PDF);
    h.baixaFora = true;
    const res = await ler(101);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, motivo: 'cadastro_indisponivel' });
    expect(h.ia.chamadas).toHaveLength(0);
  });
  it('limite de 20 leituras por hora por pessoa: a 21ª dá 429', async () => {
    for (let i = 0; i < 20; i++) expect((await ler(101, DIEGO)).status).toBe(409);
    const x = await ler(101, DIEGO);
    expect(x.status).toBe(429);
    expect(x.body.motivo).toBe('limite');
    // outra pessoa não é afetada
    expect((await ler(101, THIAGO)).status).toBe(409);
  });
});

describe('nenhum valor de campo em log', () => {
  it('nem na leitura por IA, nem no PUT, nem na ficha, nem em falha do bucket', async () => {
    const espiao = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info')];
    espiao.forEach((e) => e.mockImplementation(() => {}));
    anexa(101, [{ slot: 'documento_titular', uuid: U1, ext: 'jpg', mime: 'image/jpeg', bytes: JPG.length, em: '2026-10-19T10:00:00.000Z' }]);
    h.objetos.set(`eletroposto/101/${U1}.jpg`, JPG);
    h.ia.fila.push(sugestaoIA({
      nome: { valor: 'ZZNOME Sigiloso', slot: 'documento_titular', confianca: 'alta' },
      cpf_cnpj: { valor: '529.982.247-24', slot: 'documento_titular', confianca: 'alta' },
    }));
    await ler(101);
    h.ia.fila.push({ erro: Object.assign(new Error('ZZNOME Sigiloso 52998224725'), { status: 500 }) });
    await ler(101);
    await putCad(101, { campos: { nome: 'ZZNOME Sigiloso', cpf_cnpj: '52998224725', email: 'zz@sigiloso.com' } });
    await putCad(101, { campos: { cpf_cnpj: '52998224724' } });
    await request(app).get(base).set('Authorization', NILCE);
    await postCampo({ codigo: '101', coluna: 'endereco', valor: 'Rua ZZSigilosa 1' });
    h.cadFora = true;
    await getCad(101);
    await request(app).get(base).set('Authorization', NILCE);
    const tudo = JSON.stringify([...h.logs, ...espiao.flatMap((e) => e.mock.calls)]);
    expect(tudo.length).toBeGreaterThan(10);   // houve log (erros do bucket e da IA), só sem valores
    for (const proibido of ['ZZNOME', '529.982', '52998224', 'sigiloso', 'ZZSigilosa', 'Rua ']) expect(tudo.toLowerCase()).not.toContain(proibido.toLowerCase());
  });
});

describe('a ficha lê e grava no cadastro', () => {
  const grade = async (auth = NILCE) => (await request(app).get(base).set('Authorization', auth));
  const linha = (res: any, id: string) => res.body.linhas.find((l: { codigo: string }) => l.codigo === id);

  it('GET da ficha: o cadastro vai por cima do system_state e o legado que só existe lá continua aparecendo', async () => {
    h.linhas.set('cliente_ep:101', {
      updated_at: 'f0',
      value: {
        campos: {
          cpf_cnpj: { valor: '000.LEGADO', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
          cidade: { valor: 'Araguari', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
          trifasico: { valor: 'Sim', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
        },
        alteracoes: [], em: '2026-10-01T10:00:00.000Z',
      },
    });
    await putCad(101, { campos: { cpf_cnpj: CPF_OK, nome: 'Carlos Cadastro', telefone: '34977776666' } });
    const res = await grade();
    expect(res.status).toBe(200);
    expect(res.body.cadastro_indisponivel).toBeUndefined();
    const c = linha(res, '101').celulas;
    expect(c.cpf_cnpj).toMatchObject({ valor: CPF_OK, origem: 'sistema', por: 'nilce' });
    expect(c.cliente).toMatchObject({ valor: 'Carlos Cadastro', origem: 'sistema' });
    expect(c.contato).toMatchObject({ valor: '34977776666', origem: 'sistema' });
    expect(c.cidade.valor).toBe('Araguari');       // legado, ninguém tinha migrado
    expect(c.trifasico.valor).toBe('Sim');
    expect(linha(res, '101').cliente).toBe('Carlos Cadastro');
    // sem cadastro: o pré-preenchimento do card continua valendo
    expect(linha(await grade(GIOVANNA), '102').celulas.cliente).toMatchObject({ valor: 'Dora Reis', origem: 'card' });
  });
  it('GET da ficha com o bucket fora: a ficha sai com o system_state e cadastro_indisponivel: true', async () => {
    h.linhas.set('cliente_ep:101', {
      updated_at: 'f0', value: { campos: { cpf_cnpj: { valor: '000.LEGADO', por: 'nilce', em: '2026-10-01T10:00:00.000Z' } }, alteracoes: [], em: null },
    });
    h.cadFora = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await grade();
    expect(res.status).toBe(200);
    expect(res.body.cadastro_indisponivel).toBe(true);
    expect(linha(res, '101').celulas.cpf_cnpj.valor).toBe('000.LEGADO');
  });
  it('escrever uma coluna do cadastro pela ficha grava no cadastro, apaga o valor do system_state e limpa o antes', async () => {
    h.linhas.set('cliente_ep:101', {
      updated_at: 'f0',
      value: {
        campos: {
          cpf_cnpj: { valor: 'ANTIGO-CPF-LEGADO', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
          trifasico: { valor: 'Sim', por: 'nilce', em: '2026-10-01T10:00:00.000Z' },
        },
        alteracoes: [
          { em: '2026-10-01T10:00:00.000Z', por: 'nilce', coluna: 'cpf_cnpj', antes: 'ANTES-DO-CPF' },
          { em: '2026-10-01T10:00:00.000Z', por: 'nilce', coluna: 'endereco', antes: 'ANTES-DO-ENDERECO' },
          { em: '2026-10-01T10:00:00.000Z', por: 'nilce', coluna: 'trifasico', antes: 'Não' },
        ],
        em: '2026-10-01T10:00:00.000Z',
      },
    });
    const res = await postCampo({ codigo: '101', coluna: 'cpf_cnpj', valor: '52998224725' });
    expect(res.status).toBe(200);
    expect(res.body.celula).toMatchObject({ valor: CPF_OK, origem: 'sistema', por: 'nilce' });
    expect(cadastroDe(101).campos.cpf_cnpj).toMatchObject({ valor: CPF_OK, por: 'nilce', fonte: 'manual' });
    expect(cadastroDe(101).campos.tipo.valor).toBe('PF');
    const reg = h.linhas.get('cliente_ep:101')!.value as { campos: Record<string, { valor: unknown }>; alteracoes: Array<{ coluna: string; antes: unknown }> };
    expect(reg.campos.cpf_cnpj).toBeUndefined();
    expect(reg.campos.trifasico.valor).toBe('Sim');
    expect(JSON.stringify(reg)).not.toMatch(/ANTIGO-CPF|ANTES-DO|529\.982/);
    expect(reg.alteracoes.find((a) => a.coluna === 'trifasico')!.antes).toBe('Não');   // coluna que não é do cadastro fica como estava
    // a grade seguinte mostra o do cadastro
    expect(linha(await grade(), '101').celulas.cpf_cnpj.valor).toBe(CPF_OK);
  });
  it('apagar pela ficha limpa o campo no cadastro e volta o que o card trouxe', async () => {
    await putCad(101, { campos: { nome: 'Nome do Cadastro' } });
    const t = await grade();
    expect(linha(t, '101').celulas.cliente.valor).toBe('Nome do Cadastro');
    const res = await postCampo({ codigo: '101', coluna: 'cliente', valor: '' });
    expect(res.status).toBe(200);
    expect(res.body.celula).toEqual({ valor: 'Carlos Alves', origem: 'card' });
    expect(cadastroDe(101).campos.nome).toBeUndefined();
  });
  it('conflito: quem mexeu no cadastro depois do base_em barra a gravação pela ficha (409), e a mesma pessoa não', async () => {
    await putCad(101, { campos: { email: 'a@b.com' } }, THIAGO);
    const n = await postCampo({ codigo: '101', coluna: 'email', valor: 'c@d.com' });
    expect(n.status).toBe(409);
    expect(n.body).toMatchObject({ conflito: true, por: 'thiago' });
    expect(cadastroDe(101).campos.email.valor).toBe('a@b.com');
    expect((await postCampo({ codigo: '101', coluna: 'email', valor: 'c@d.com' }, THIAGO)).status).toBe(200);
  });
  it('campo do cadastro com bucket fora: 500 genérico e nada gravado; coluna que não é do cadastro grava normalmente', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.cadFora = true;
    const a = await postCampo({ codigo: '101', coluna: 'cep', valor: '38400100' });
    expect(a.status).toBe(500);
    expect(h.linhas.has('cliente_ep:101')).toBe(false);
    const b = await postCampo({ codigo: '101', coluna: 'trifasico', valor: 'sim' });
    expect(b.status).toBe(200);
    expect((h.linhas.get('cliente_ep:101')!.value as { campos: Record<string, { valor: unknown }> }).campos.trifasico.valor).toBe('Sim');
  });
  it('texto acima de 200 caracteres numa coluna do cadastro: 400', async () => {
    const res = await postCampo({ codigo: '101', coluna: 'endereco', valor: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(h.cad.size).toBe(0);
  });
  it('o relatório de engenharia enxerga o cadastro', async () => {
    await putCad(101, { campos: { cpf_cnpj: CPF_OK } });
    const res = await request(app).get(`${base}/101/relatorio`.replace('/eletroposto/', '/eletroposto/')).set('Authorization', NILCE);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.secoes)).toContain(CPF_OK);
  });
});

// ── Bucket próprio, migração completa, trava por venda e isolamento por venda ──

const legado = (campos: Record<string, string>) => h.linhas.set('cliente_ep:101', {
  updated_at: 'f0',
  value: {
    campos: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, { valor: v, por: 'nilce', em: '2026-10-01T10:00:00.000Z' }])),
    alteracoes: [{ em: '2026-10-01T10:00:00.000Z', por: 'nilce', coluna: 'cpf_cnpj', antes: 'ANTES-SECRETO' }],
    em: '2026-10-01T10:00:00.000Z',
  },
});
const regDe = () => h.linhas.get('cliente_ep:101')!.value as { campos: Record<string, { valor: unknown }>; alteracoes: Array<{ coluna: string; antes: unknown }> };
const gradeDe = async (auth = NILCE) => request(app).get(base).set('Authorization', auth);
const linhaDe = (res: any, id: string) => res.body.linhas.find((l: { codigo: string }) => l.codigo === id);

describe('bucket próprio do cadastro', () => {
  it('na primeira escrita cria o cadastros-venda privado (uma vez, memorizado), nunca atualiza e nunca toca o fichas-docs', async () => {
    h.cadExiste = false;
    expect((await putCad(101, { campos: { nome: 'Ana' } })).status).toBe(200);
    expect(h.criados).toEqual([{ nome: 'cadastros-venda', opcoes: { public: false, fileSizeLimit: 262144, allowedMimeTypes: ['application/json'] } }]);
    const consultas = h.getBuckets.filter((n) => n === 'cadastros-venda').length;
    expect((await putCad(101, { campos: { email: 'a@b.com' } })).status).toBe(200);
    expect((await getCad(101)).status).toBe(200);
    expect(h.criados).toHaveLength(1);
    expect(h.getBuckets.filter((n) => n === 'cadastros-venda').length).toBe(consultas);
    expect(h.atualizados).toBe(0);
    expect(h.getBuckets).not.toContain('fichas-docs');
    expect(h.cad.has('eletroposto/101.json')).toBe(true);
  });
  it('cadastro fora do ar: 503 só nas rotas de cadastro e flag na ficha; os documentos seguem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.cadFora = true;
    expect((await getCad(101)).status).toBe(503);
    expect((await putCad(101, { campos: { nome: 'Ana' } })).status).toBe(503);
    const docs = await request(app).get(`${base}/101/docs`).set('Authorization', NILCE);
    expect(docs.status).toBe(200);
    expect(docs.body.ok).toBe(true);
    const grade = await gradeDe();
    expect(grade.status).toBe(200);
    expect(grade.body.cadastro_indisponivel).toBe(true);
  });
});

describe('migração completa na primeira escrita', () => {
  it('PUT do cadastro: o legado inteiro entra com fonte "ficha", a edição por cima, e o system_state perde as 13 colunas e o antes', async () => {
    legado({ cpf_cnpj: '000.LEGADO', cidade: 'Araguari', email: 'l@x.com', trifasico: 'Sim' });
    const res = await putCad(101, { campos: { nome: 'Novo Nome' } });
    expect(res.status).toBe(200);
    expect(res.body.aviso).toBeUndefined();
    const c = cadastroDe(101);
    expect(c.migrado).toBe(true);
    expect(c.campos.cpf_cnpj).toMatchObject({ valor: '000.LEGADO', fonte: 'ficha', por: 'nilce' });
    expect(c.campos.cidade).toMatchObject({ valor: 'Araguari', fonte: 'ficha' });
    expect(c.campos.email).toMatchObject({ valor: 'l@x.com', fonte: 'ficha' });
    expect(c.campos.nome).toMatchObject({ valor: 'Novo Nome', fonte: 'manual' });
    const reg = regDe();
    expect(Object.keys(reg.campos)).toEqual(['trifasico']);
    expect(reg.alteracoes.every((a) => a.antes === null)).toBe(true);
    expect(JSON.stringify(reg)).not.toMatch(/LEGADO|ANTES-SECRETO|l@x\.com|Araguari/);
    expect(h.linhas.has('cadastro_trava:101')).toBe(false);
  });
  it('PUT com "" num campo que era legado limpa de verdade (a ficha volta ao que o card trouxe)', async () => {
    legado({ cidade: 'Araguari' });
    expect((await putCad(101, { campos: { cidade: '' } })).status).toBe(200);
    expect(cadastroDe(101).campos.cidade).toBeUndefined();
    expect(regDe().campos.cidade).toBeUndefined();
    expect(linhaDe(await gradeDe(), '101').celulas.cidade).toEqual({ valor: 'Uberlandia', origem: 'card' });
  });
  it('GET do cadastro mostra o legado (fonte "ficha") enquanto não migrou, sem gravar nada', async () => {
    legado({ cidade: 'Araguari', email: 'l@x.com' });
    const res = await getCad(101);
    expect(res.status).toBe(200);
    expect(res.body.cadastro.campos.cidade).toMatchObject({ valor: 'Araguari', fonte: 'ficha' });
    expect(res.body.cadastro.valores.email).toBe('l@x.com');
    expect(h.cad.size).toBe(0);
    expect(regDe().campos.cidade.valor).toBe('Araguari');
  });
  it('PUT da ficha numa coluna do cadastro também migra o resto do legado', async () => {
    legado({ cpf_cnpj: '000.LEGADO', email: 'l@x.com' });
    const res = await postCampo({ codigo: '101', coluna: 'cidade', valor: 'Araguari' });
    expect(res.status).toBe(200);
    expect(res.body.aviso).toBeUndefined();
    const c = cadastroDe(101);
    expect(c.campos.cpf_cnpj).toMatchObject({ valor: '000.LEGADO', fonte: 'ficha' });
    expect(c.campos.email).toMatchObject({ valor: 'l@x.com', fonte: 'ficha' });
    expect(c.campos.cidade).toMatchObject({ valor: 'Araguari', fonte: 'manual' });
    expect(Object.keys(regDe().campos)).toEqual([]);
  });
  it('o cadastro gravado mas o system_state sem deixar limpar: sucesso com aviso (nunca 409), e a leitura ignora o legado que sobrou', async () => {
    legado({ email: 'l@x.com' });
    h.semLimparFicha = true;
    const res = await postCampo({ codigo: '101', coluna: 'cidade', valor: 'Araguari' });
    expect(res.status).toBe(200);
    expect(res.body.aviso).toMatch(/^Salvo\./);
    expect(res.body.celula).toMatchObject({ valor: 'Araguari', origem: 'sistema' });
    expect(cadastroDe(101).campos.cidade.valor).toBe('Araguari');
    expect(regDe().campos.email.valor).toBe('l@x.com');   // a limpeza não rolou
    const p = await putCad(101, { campos: { nome: 'Ana' } });
    expect(p.status).toBe(200);
    expect(p.body.aviso).toMatch(/^Salvo\./);
    h.semLimparFicha = false;
    expect(linhaDe(await gradeDe(), '101').celulas.email).toMatchObject({ valor: 'l@x.com', origem: 'sistema' });   // veio do cadastro
  });
  it('a ficha valida com o validador do cadastro: CPF com dígito errado é 400, UF e CEP saem normalizados, nada gravado no erro', async () => {
    const ruim = await postCampo({ codigo: '101', coluna: 'cpf_cnpj', valor: '12345678901' });
    expect(ruim.status).toBe(400);
    expect(ruim.body).toEqual({ ok: false, error: 'Dígito do CPF não confere.' });
    expect(h.cad.size).toBe(0);
    expect((await postCampo({ codigo: '101', coluna: 'uf', valor: 'mg' })).body.celula.valor).toBe('MG');
    expect((await postCampo({ codigo: '101', coluna: 'cep', valor: '38400100' })).body.celula.valor).toBe('38400-100');
    expect(cadastroDe(101).campos.cep.valor).toBe('38400-100');
  });
});

describe('trava por venda', () => {
  it('duas escritas concorrentes de campos diferentes: as duas sobrevivem (o upload é lento de propósito)', async () => {
    h.atrasoUpload = 40;
    const [a, b] = await Promise.all([
      putCad(101, { campos: { nome: 'Ana' } }),
      putCad(101, { campos: { email: 'a@b.com' } }, THIAGO),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const c = cadastroDe(101);
    expect(c.campos.nome.valor).toBe('Ana');
    expect(c.campos.email.valor).toBe('a@b.com');
    expect(h.linhas.has('cadastro_trava:101')).toBe(false);
  });
  it('quatro escritas ao mesmo tempo (PUT e ficha): nenhuma se perde', async () => {
    h.atrasoUpload = 25;
    const rs = await Promise.all([
      putCad(101, { campos: { nome: 'Ana' } }),
      putCad(101, { campos: { profissao: 'Engenheira' } }, THIAGO),
      postCampo({ codigo: '101', coluna: 'cidade', valor: 'Araguari' }),
      postCampo({ codigo: '101', coluna: 'email', valor: 'a@b.com' }, THIAGO),
    ]);
    expect(rs.map((x) => x.status)).toEqual([200, 200, 200, 200]);
    const c = cadastroDe(101).campos;
    expect([c.nome?.valor, c.profissao?.valor, c.cidade?.valor, c.email?.valor]).toEqual(['Ana', 'Engenheira', 'Araguari', 'a@b.com']);
  });
  it('trava vencida (TTL de 15 s) é tomada; trava viva barra com 503 ocupado e fica intacta', async () => {
    h.linhas.set('cadastro_trava:101', { value: { por: 'x', ate: '2000-01-01T00:00:00.000Z' }, updated_at: 'velho' });
    expect((await putCad(101, { campos: { nome: 'Ana' } })).status).toBe(200);
    expect(h.linhas.has('cadastro_trava:101')).toBe(false);
    h.linhas.set('cadastro_trava:101', { value: { por: 'x', ate: '2999-01-01T00:00:00.000Z' }, updated_at: 'vivo' });
    const res = await putCad(101, { campos: { email: 'a@b.com' } });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, motivo: 'cadastro_indisponivel', ocupado: true });
    expect(h.linhas.get('cadastro_trava:101')!.updated_at).toBe('vivo');
    expect(cadastroDe(101).campos.email).toBeUndefined();
    // pela ficha, "ocupado" é o 409 de tentar de novo que a tela já conhece
    const f = await postCampo({ codigo: '101', coluna: 'cidade', valor: 'Araguari' });
    expect(f.status).toBe(409);
    expect(f.body).toMatchObject({ conflito: true, tentarDeNovo: true });
  }, 15000);
  it('a trava é solta mesmo quando a escrita falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.cadFora = true;
    expect((await putCad(101, { campos: { nome: 'Ana' } })).status).toBe(503);
    expect(h.linhas.has('cadastro_trava:101')).toBe(false);
  });
  it('a linha da trava não leva dado pessoal', async () => {
    const res = await putCad(101, { campos: { nome: 'ZZNOME Sigiloso', cpf_cnpj: CPF_OK } });
    expect(res.status).toBe(200);
    expect(h.travaNoUpload).toMatch(/"por":"nilce"/);   // a trava existia enquanto o cadastro era gravado
    expect(h.travaNoUpload).not.toMatch(/ZZNOME|529/);
  });
});

describe('a grade isola o cadastro quebrado de uma venda', () => {
  it('JSON torto de uma venda: só aquela linha sai com cadastro_indisponivel e o legado; as outras, normais', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    legado({ cidade: 'Araguari' });
    h.cad.set('eletroposto/101.json', Buffer.from('{ isto nao e json'));
    h.cad.set('eletroposto/102.json', Buffer.from(JSON.stringify({
      v: 1, campos: { nome: { valor: 'Dora Cadastro', por: 'x', em: 'e', fonte: 'manual' } }, alteracoes: [], em: null, migrado: true,
    })));
    const res = await gradeDe(THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.cadastro_indisponivel).toBeUndefined();
    expect(linhaDe(res, '101').cadastro_indisponivel).toBe(true);
    expect(linhaDe(res, '101').celulas.cidade.valor).toBe('Araguari');
    expect(linhaDe(res, '102').cadastro_indisponivel).toBeUndefined();
    expect(linhaDe(res, '102').celulas.cliente).toMatchObject({ valor: 'Dora Cadastro', origem: 'sistema' });
  });
});

describe('imagem lida pela IA', () => {
  it('3,5 MB passa; 4 MB não (o base64 tem que ficar abaixo de 5 MB)', async () => {
    const grande = Buffer.concat([JPG, Buffer.alloc(3.5 * 1024 * 1024, 3)]);
    anexa(101, [
      { slot: 'documento_titular', uuid: U1, ext: 'jpg', mime: 'image/jpeg', bytes: grande.length, em: '2026-10-19T10:00:00.000Z' },
      { slot: 'outros', uuid: U2, ext: 'jpg', mime: 'image/jpeg', bytes: 4 * 1024 * 1024, em: '2026-10-19T11:00:00.000Z' },
    ]);
    h.objetos.set(`eletroposto/101/${U1}.jpg`, grande);
    h.ia.fila.push(sugestaoIA());
    const res = await ler(101);
    expect(res.status).toBe(200);
    expect(res.body.lidos).toEqual([{ slot: 'documento_titular', n: 1 }]);
    expect(res.body.ignorados).toEqual([{ slot: 'outros', motivo: 'Foto acima de 3,7 MB: mande uma menor.' }]);
    const b64 = h.ia.chamadas[0].corpo.messages[0].content.find((b: any) => b.type === 'image').source.data;
    expect(b64.length).toBeLessThan(5 * 1024 * 1024);
  });
});
