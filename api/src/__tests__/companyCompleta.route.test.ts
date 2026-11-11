import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Colunas novas da Completa + Banco na tela Empresa: fotos_obras e dados_bancarios.
const h = vi.hoisted(() => ({
  gravado: [] as Record<string, unknown>[],
  linha: { id: 'c1', user_id: 'user-123', nome: 'Sol Forte', cnpj: '11.222.333/0001-81' } as Record<string, unknown> | null,
  colunaAusente: false,
  colunaSempreAusente: false,
  assinaturas: 0,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      let escrita: Record<string, unknown> | null = null;
      const resultado = () => {
        if (escrita && h.colunaSempreAusente && ('fotos_obras' in escrita || 'dados_bancarios' in escrita)) {
          return { data: null, error: { code: '42703', message: 'column "fotos_obras" of relation "company" does not exist' } };
        }
        if (escrita && h.colunaAusente && ('fotos_obras' in escrita || 'dados_bancarios' in escrita)) {
          h.colunaAusente = false; // só a 1ª tentativa falha; a repetição sem as colunas passa
          return { data: null, error: { code: '42703', message: 'column "fotos_obras" of relation "company" does not exist' } };
        }
        if (escrita) { h.gravado.push(escrita); return { data: { ...h.linha, ...escrita }, error: null }; }
        return { data: h.linha, error: null };
      };
      q.select = () => q;
      q.eq = () => q;
      q.limit = () => q;
      q.insert = (v: Record<string, unknown>) => { escrita = v; return q; };
      q.update = (v: Record<string, unknown>) => { escrita = v; return q; };
      q.single = async () => resultado();
      q.maybeSingle = async () => resultado();
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => (h.assinaturas++, {
          data: paths.map((path) => ({ path, signedUrl: `https://x.test/assinada/${path}`, error: null })), error: null,
        }),
      }),
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }));
vi.mock('../utils/jwt', () => ({
  signToken: vi.fn().mockReturnValue('mock-token'),
  verifyToken: vi.fn((t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  }),
}));
vi.mock('../middleware/clerkAuth', () => ({ clerkAtivo: false, resolverUsuarioDoClerk: async () => null }));

import companyRoutes from '../routes/company';
import { sendMetaEvent } from '../utils/metaPixel';

const app = express();
app.use(express.json());
app.use('/company', companyRoutes);

const AUTH = 'Bearer valid-token';
const MEU = 'portfolio/user-123/obra/1700000000000-abcdef12.jpg';
const MEU2 = 'portfolio/user-123/obra/1700000000001-abcdef13.png';
const ALHEIO = 'portfolio/user-999/obra/1700000000000-abcdef12.jpg';
const DE_EMPRESA = 'portfolio/user-123/empresa/1700000000000-abcdef12.jpg';

beforeEach(() => {
  h.gravado = [];
  h.colunaAusente = false;
  h.colunaSempreAusente = false;
  h.assinaturas = 0;
  h.linha = { id: 'c1', user_id: 'user-123', nome: 'Sol Forte', cnpj: '11.222.333/0001-81' };
});

describe('PUT /company: fotos_obras', () => {
  it('descarta path de outro usuário e de outro tipo; grava só path e legenda (80); máx 12', async () => {
    const fotos = [
      { path: MEU, legenda: 'L'.repeat(120), url: 'http://interno/x' },
      { path: ALHEIO, legenda: 'alheia' },
      { path: DE_EMPRESA },
      { path: '../../etc/passwd' },
      { path: MEU2 },
      ...Array.from({ length: 14 }, (_, i) => ({ path: `portfolio/user-123/obra/17000000000${i}0-abcdef1${i}.jpg` })),
    ];
    const res = await request(app).put('/company').set('Authorization', AUTH).send({ fotos_obras: fotos });
    expect(res.status).toBe(200);
    const gravado = h.gravado[0].fotos_obras as Array<Record<string, unknown>>;
    expect(gravado).toHaveLength(12);
    expect(gravado[0]).toEqual({ path: MEU, legenda: 'L'.repeat(80) });
    expect(gravado[1]).toEqual({ path: MEU2 });
    expect(JSON.stringify(gravado)).not.toContain('user-999');
    expect(JSON.stringify(gravado)).not.toContain('interno');
    // A resposta devolve cada item com a URL assinada agora.
    expect(res.body.company.fotos_obras[0].url).toBe(`https://x.test/assinada/${MEU}`);
  });

  it('GET devolve a url assinada de cada foto', async () => {
    h.linha = { ...h.linha, fotos_obras: [{ path: MEU, legenda: 'Casa' }] };
    const res = await request(app).get('/company').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.company.fotos_obras).toEqual([{ path: MEU, legenda: 'Casa', url: `https://x.test/assinada/${MEU}` }]);
  });

  it('GET assina todas as fotos numa chamada só ao storage, e não chama sem foto', async () => {
    h.linha = { ...h.linha, fotos_obras: [{ path: MEU }, { path: MEU2 }, { path: ALHEIO }] };
    const res = await request(app).get('/company').set('Authorization', AUTH);
    expect(res.body.company.fotos_obras).toHaveLength(2);
    expect(h.assinaturas).toBe(1);
    h.assinaturas = 0;
    h.linha = { ...h.linha, fotos_obras: [] };
    await request(app).get('/company').set('Authorization', AUTH);
    expect(h.assinaturas).toBe(0);
  });

  it('PUT só com as colunas novas e a coluna ausente: 503, nunca 200 sem gravar', async () => {
    h.colunaSempreAusente = true;
    const res = await request(app).put('/company').set('Authorization', AUTH).send({ fotos_obras: [{ path: MEU }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Não deu para salvar agora. Tente de novo em instantes.');
    expect(h.gravado).toEqual([]);
  });

  it('sem a chave no corpo, a coluna não é tocada', async () => {
    const res = await request(app).put('/company').set('Authorization', AUTH).send({ nome: 'Sol Forte 2' });
    expect(res.status).toBe(200);
    expect(h.gravado[0]).toEqual({ nome: 'Sol Forte 2' });
  });
});

describe('PUT /company: dados_bancarios', () => {
  it('normaliza: apara, limita, tira vazio', async () => {
    const res = await request(app).put('/company').set('Authorization', AUTH).send({
      dados_bancarios: { banco: '  Banco X ', agencia: '', conta: '123-4', tipo_conta: 'poupanca', titular: 'T'.repeat(200), pix: 'a@b.com', lixo: 'x' },
    });
    expect(res.status).toBe(200);
    expect(h.gravado[0].dados_bancarios).toEqual({ banco: 'Banco X', conta: '123-4', tipo_conta: 'poupanca', titular: 'T'.repeat(120), pix: 'a@b.com' });
  });

  it('objeto sem nada vira null; tipo_conta fora da lista sai', async () => {
    await request(app).put('/company').set('Authorization', AUTH).send({ dados_bancarios: { banco: '  ', tipo_conta: 'xx' } });
    expect(h.gravado[0].dados_bancarios).toBeNull();
  });

  it('coluna ausente no banco, com o formulário inteiro da tela: 503 e NADA gravado (nem o resto)', async () => {
    h.colunaAusente = true;
    const res = await request(app).put('/company').set('Authorization', AUTH).send({
      nome: 'Sol Forte 3', nome_fantasia: 'Sol Forte', cnpj: '11.222.333/0001-81', endereco: 'Rua A, 1', cidade: 'Uberlândia',
      cor_marca: '#0B3D2E', whatsapp: '34999990000', fotos_obras: [{ path: MEU }], dados_bancarios: { pix: 'a@b.com' },
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Não deu para salvar agora. Tente de novo em instantes.');
    expect(h.gravado).toEqual([]);
  });

  it('sem as colunas novas no corpo, o PUT grava normalmente mesmo que elas faltem no banco', async () => {
    h.colunaSempreAusente = true;
    const res = await request(app).put('/company').set('Authorization', AUTH).send({ nome: 'Sol Forte 4', cidade: 'Araguari' });
    expect(res.status).toBe(200);
    expect(h.gravado).toEqual([{ nome: 'Sol Forte 4', cidade: 'Araguari' }]);
  });
});

describe('POST /company aceita as duas colunas', () => {
  it('cria com fotos e dados bancários limpos', async () => {
    h.linha = null as unknown as Record<string, unknown>; // ainda não existe empresa
    const res = await request(app).post('/company').set('Authorization', AUTH).send({
      nome: 'Sol Forte', cnpj: '11.222.333/0001-81', fotos_obras: [{ path: MEU }, { path: ALHEIO }], dados_bancarios: { pix: ' chave ' },
    });
    expect(res.status).toBe(201);
    expect(h.gravado[0]).toMatchObject({ user_id: 'user-123', fotos_obras: [{ path: MEU }], dados_bancarios: { pix: 'chave' } });
  });

  it('a criação da empresa manda o evento personalizado EmpresaCriada com o event_id do navegador, nunca CompleteRegistration', async () => {
    h.linha = null as unknown as Record<string, unknown>;
    vi.mocked(sendMetaEvent).mockClear();
    const res = await request(app).post('/company').set('Authorization', AUTH).set('x-meta-event-id', 'ev-empresa-1')
      .send({ nome: 'Sol Forte', cnpj: '11.222.333/0001-81' });
    expect(res.status).toBe(201);
    const nomes = vi.mocked(sendMetaEvent).mock.calls.map((c) => c[0]);
    expect(nomes).toEqual(['EmpresaCriada']);
    expect(vi.mocked(sendMetaEvent).mock.calls[0][1]).toMatchObject({ eventId: 'ev-empresa-1' });
  });
});
