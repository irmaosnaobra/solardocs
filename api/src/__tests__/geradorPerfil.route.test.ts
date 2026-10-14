import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Meu perfil: rotas com o login, o banco do Gerador, o banco principal e o Storage simulados
// (números e nomes inventados). O que se prova aqui: quem pode editar o quê, o telefone
// validado e gravado no formato que os robôs leem, que o NOME nunca entra no patch, a foto
// (tipo, tamanho, bucket público) e a trilha.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  consultores: [] as Array<{ nome: string; whatsapp: string | null; foto_url: string | null }>,
  /** Cada update recebido: o patch inteiro e o filtro usado. */
  updates: [] as Array<{ patch: Record<string, unknown>; nome: string }>,
  updateVazio: false,
  erroLeitura: false,
  trilha: null as null | { value: unknown; updated_at: string },
  tique: 0,
  bucket: null as null | { public: boolean },
  bucketCriado: [] as Array<{ nome: string; opcoes: Record<string, unknown> }>,
  uploads: [] as Array<{ path: string; bytes: number; contentType: string }>,
  uploadErro: false,
  /** Os contadores do limitador são do módulo: só o teste do teto liga o limite de verdade. */
  limiteReal: false,
}));

vi.mock('../middleware/rateLimiter', async () => {
  const real = await vi.importActual<typeof import('../middleware/rateLimiter')>('../middleware/rateLimiter');
  type Mw = (req: unknown, res: unknown, next: () => void) => unknown;
  const quando = (mw: unknown): Mw => (req, res, next) => (h.limiteReal ? (mw as Mw)(req, res, next) : next());
  return {
    ...real,
    perfilIpLimiter: quando(real.perfilIpLimiter),
    perfilPessoaLimiter: quando(real.perfilPessoaLimiter),
    perfilGravarLimiter: quando(real.perfilGravarLimiter),
  };
});
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
    from: (tabela: string) => {
      if (tabela !== 'consultores') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => ({
          limit: async () => h.erroLeitura
            ? { data: null, error: { code: 'XX000', message: 'DADO-SECRETO-NO-ERRO' } }
            : { data: h.consultores.map((c) => ({ ...c })), error: null },
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, nome: string) => ({
            select: async () => {
              h.updates.push({ patch, nome });
              if (h.updateVazio) return { data: [], error: null };
              const alvo = h.consultores.filter((c) => c.nome === nome);
              for (const c of alvo) Object.assign(c, patch);
              return { data: alvo.map((c) => ({ nome: c.nome })), error: null };
            },
          }),
        }),
      };
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-14T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.trilha ? { ...h.trilha } : null, error: null }) }),
        }),
        insert: async (l: { value: unknown }) => {
          if (h.trilha) return { error: { code: '23505', message: 'dup' } };
          h.trilha = { value: l.value, updated_at: stamp() };
          return { error: null };
        },
        update: (novo: { value: unknown }) => ({
          eq: () => ({
            eq: (_c: string, v: string) => ({
              select: async () => {
                if (!h.trilha || h.trilha.updated_at !== v) return { data: [], error: null };
                h.trilha = { value: novo.value, updated_at: stamp() };
                return { data: [{ key: 'perfil_alteracoes' }], error: null };
              },
            }),
            is: () => ({ select: async () => ({ data: [], error: null }) }),
          }),
        }),
      };
    },
    storage: {
      getBucket: async () => h.bucket
        ? { data: { ...h.bucket }, error: null }
        : { data: null, error: { message: 'Bucket not found' } },
      createBucket: async (nome: string, opcoes: Record<string, unknown>) => {
        h.bucketCriado.push({ nome, opcoes });
        h.bucket = { public: opcoes.public === true };
        return { error: null };
      },
      from: (bucket: string) => ({
        upload: async (path: string, corpo: Buffer, o: { contentType: string }) => {
          if (h.uploadErro) return { error: { message: 'falhou' } };
          h.uploads.push({ path, bytes: corpo.length, contentType: o.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.exemplo.test/${bucket}/${path}` } }),
      }),
    },
  },
}));

import { mountPerfil } from '../routes/geradorPerfil';
import { esquecerConferenciaDoBucket, normalizarWhatsapp, pastaDoNome } from '../services/gerador/perfilEquipe';

const r = Router();
mountPerfil(r);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';

// Números inventados (DDD válido, 9 na frente).
const CEL_A = '(34) 98111-2233';
const CEL_A_GRAVADO = '5534981112233';
const CEL_B = '11 97444-5566';

/** Cabeçalhos mínimos de arquivo de verdade: o servidor confere os primeiros bytes. */
const JPEG = (n = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PNG = (n = 200) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(n, 7)]);
const foto = (bytes: Buffer, tipo = 'image/jpeg') => ({ tipo, base64: bytes.toString('base64') });

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com', 'tk-lote': 'lote@irmaosnaobra.app',
  };
  h.consultores = [
    { nome: 'Diego', whatsapp: '5534900000001', foto_url: null },
    { nome: 'Giovanna', whatsapp: '34900000002', foto_url: 'https://exemplo.test/giovanna-antiga.jpg' },
    { nome: 'Nilce', whatsapp: null, foto_url: null },
    { nome: 'Thiago', whatsapp: '5534900000004', foto_url: null },
  ];
  h.updates = []; h.updateVazio = false; h.erroLeitura = false; h.trilha = null; h.tique = 0;
  h.bucket = null; h.bucketCriado = []; h.uploads = []; h.uploadErro = false; h.limiteReal = false;
  delete process.env.SOLAR_SOCIOS;
  esquecerConferenciaDoBucket();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const get = (auth = NILCE) => request(app).get('/gerador/perfil').set('Authorization', auth);
const post = (corpo: Record<string, unknown>, auth = NILCE) =>
  request(app).post('/gerador/perfil').set('Authorization', auth).send(corpo);

describe('login', () => {
  it('401 sem token e com token inválido; 403 para conta de fora; nada é gravado', async () => {
    expect((await request(app).get('/gerador/perfil')).status).toBe(401);
    expect((await request(app).post('/gerador/perfil').send({ whatsapp: CEL_A })).status).toBe(401);
    expect((await post({ whatsapp: CEL_A }, 'Bearer lixo')).status).toBe(401);
    expect((await post({ whatsapp: CEL_A }, 'Bearer tk-estranho')).status).toBe(403);
    expect(h.updates).toHaveLength(0);
    expect(h.trilha).toBeNull();
  });
});

describe('GET /perfil', () => {
  it('consultor: o próprio perfil (nome com a caixa da tabela) e equipe vazia', async () => {
    const res = await get(NILCE);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      ok: true,
      eu: { nome: 'Nilce', email: 'nilce@irmaosnaobra.app', socio: false, whatsapp: null, foto_url: null },
      equipe: [],
    });
    expect(JSON.stringify(res.body)).not.toContain('5534900000001');   // telefone dos outros não vaza
  });
  it('sócio: eu.socio verdadeiro e a lista da equipe com nome, whatsapp e foto', async () => {
    const res = await get(THIAGO);
    expect(res.body.eu).toMatchObject({ nome: 'Thiago', socio: true, whatsapp: '5534900000004' });
    expect(res.body.equipe.map((e: { nome: string }) => e.nome)).toEqual(['Diego', 'Giovanna', 'Nilce', 'Thiago']);
    expect(Object.keys(res.body.equipe[0]).sort()).toEqual(['foto_url', 'nome', 'whatsapp']);
  });
  it('banco fora: 502 genérico, sem o texto do erro do driver', async () => {
    h.erroLeitura = true;
    const res = await get(NILCE);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('DADO-SECRETO');
  });
});

describe('POST /perfil: o próprio perfil', () => {
  it('consultor edita o próprio WhatsApp: normaliza para 55 + 11 dígitos, grava e registra a trilha', async () => {
    const res = await post({ whatsapp: CEL_A }, NILCE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, alterado: { whatsapp: true, foto: false }, trilha: true,
      perfil: { nome: 'Nilce', whatsapp: CEL_A_GRAVADO, foto_url: null },
    });
    expect(h.updates).toEqual([{ patch: { whatsapp: CEL_A_GRAVADO }, nome: 'Nilce' }]);
    const trilha = h.trilha!.value as Array<Record<string, unknown>>;
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({ por: 'nilce', alvo: 'Nilce', campo: 'whatsapp', antes: null, depois: CEL_A_GRAVADO });
    expect(typeof trilha[0].em).toBe('string');
  });
  it('consultor manda o próprio nome em outra caixa no `alvo`: passa, não é 403', async () => {
    const res = await post({ alvo: 'NILCE', whatsapp: CEL_A }, NILCE);
    expect(res.status).toBe(200);
    expect(h.updates[0].nome).toBe('Nilce');
  });
  it('mesmo número já gravado (em outro formato): não grava nem registra trilha', async () => {
    const res = await post({ whatsapp: '(34) 90000-0002' }, GIOVANNA);   // gravado como 34900000002, sem o 55
    expect(res.status).toBe(200);
    expect(res.body.alterado).toEqual({ whatsapp: false, foto: false });
    expect(h.updates).toHaveLength(0);
    expect(h.trilha).toBeNull();
  });
  it('a trilha guarda o valor de antes e acumula', async () => {
    await post({ whatsapp: CEL_A }, GIOVANNA);
    await post({ whatsapp: CEL_B }, GIOVANNA);
    const trilha = h.trilha!.value as Array<{ antes: string | null; depois: string }>;
    expect(trilha.map((t) => [t.antes, t.depois])).toEqual([['34900000002', CEL_A_GRAVADO], [CEL_A_GRAVADO, '5511974445566']]);
  });
});

describe('POST /perfil: papel', () => {
  it('consultor editando outro: 403, e nada é lido nem gravado (o nome existindo ou não)', async () => {
    const res = await post({ alvo: 'Diego', whatsapp: CEL_A }, NILCE);
    expect(res.status).toBe(403);
    expect((await post({ alvo: 'fulano-que-nao-existe', whatsapp: CEL_A }, NILCE)).status).toBe(403);
    expect(h.updates).toHaveLength(0);
    expect(h.trilha).toBeNull();
    expect(h.consultores.find((c) => c.nome === 'Diego')!.whatsapp).toBe('5534900000001');
  });
  it('sócio editando outro: passa, o filtro é o nome canônico e a trilha diz quem mudou e de quem', async () => {
    const res = await post({ alvo: 'nilce', whatsapp: CEL_A }, THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.perfil).toMatchObject({ nome: 'Nilce', whatsapp: CEL_A_GRAVADO });
    expect(h.updates).toEqual([{ patch: { whatsapp: CEL_A_GRAVADO }, nome: 'Nilce' }]);
    expect(h.trilha!.value).toEqual([expect.objectContaining({ por: 'thiago', alvo: 'Nilce', campo: 'whatsapp' })]);
  });
  it('o outro sócio também edita o de qualquer um', async () => {
    expect((await post({ alvo: 'Giovanna', whatsapp: CEL_B }, DIEGO)).status).toBe(200);
  });
  it('sócio com alvo inexistente: 404, nada gravado', async () => {
    const res = await post({ alvo: 'ninguem', whatsapp: CEL_A }, THIAGO);
    expect(res.status).toBe(404);
    expect(h.updates).toHaveLength(0);
  });
  it('sócio é decidido por SOLAR_SOCIOS: com a variável trocada, Thiago vira consultor comum', async () => {
    process.env.SOLAR_SOCIOS = 'diego';
    expect((await post({ alvo: 'Nilce', whatsapp: CEL_A }, THIAGO)).status).toBe(403);
    expect((await get(THIAGO)).body.equipe).toEqual([]);
  });
});

describe('POST /perfil: telefone', () => {
  const invalidos: Array<[string, unknown]> = [
    ['vazio', ''], ['só letras', 'abc'], ['fixo (8 dígitos)', '(34) 3211-2233'], ['curto', '9811-2233'],
    ['sem o 9 na frente', '(34) 88111-2233'], ['DDD que não existe', '(10) 98111-2233'], ['DDD 20', '20981112233'],
    ['longo demais', '34981112233445'], ['dígitos repetidos', '(34) 99999-9999'], ['número, não texto', 34981112233],
    ['55 sobrando em número curto', '55 9811-2233'],
  ];
  for (const [rotulo, valor] of invalidos) {
    it(`inválido (${rotulo}): 400 com mensagem clara, nada gravado`, async () => {
      const res = await post({ whatsapp: valor }, NILCE);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/WhatsApp inválido/);
      expect(h.updates).toHaveLength(0);
      expect(h.trilha).toBeNull();
    });
  }
  it('formatos aceitos viram o mesmo: dígitos, máscara, +55, com e sem país', () => {
    for (const v of ['34981112233', '(34) 98111-2233', '+55 (34) 98111-2233', '5534981112233', ' 34 9 8111 2233 ']) {
      expect(normalizarWhatsapp(v)).toBe('5534981112233');
    }
  });
  it('DDD 55 (RS) não é confundido com o código do país: guarda 55 + 55 + 9 dígitos', () => {
    expect(normalizarWhatsapp('(55) 98111-2233')).toBe('5555981112233');
    expect(normalizarWhatsapp('5555981112233')).toBe('5555981112233');
  });
  it('telefone ruim junto com foto boa: 400 e a foto NÃO sobe', async () => {
    const res = await post({ whatsapp: '123', foto: foto(JPEG()) }, NILCE);
    expect(res.status).toBe(400);
    expect(h.uploads).toHaveLength(0);
    expect(h.bucketCriado).toHaveLength(0);
  });
});

describe('POST /perfil: o nome nunca muda', () => {
  it('`nome` no corpo é ignorado: o patch só tem whatsapp e foto_url e o filtro é o nome canônico', async () => {
    const res = await post({ nome: 'Outro Nome', whatsapp: CEL_A, foto: foto(JPEG()) }, NILCE);
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(Object.keys(h.updates[0].patch).sort()).toEqual(['foto_url', 'whatsapp']);
    expect(h.updates[0].nome).toBe('Nilce');
    expect(h.consultores.map((c) => c.nome)).toEqual(['Diego', 'Giovanna', 'Nilce', 'Thiago']);
    expect(res.body.perfil.nome).toBe('Nilce');
  });
  it('sócio mandando `nome` junto com o alvo: também ignorado', async () => {
    await post({ alvo: 'Diego', nome: 'Trocado', whatsapp: CEL_A }, THIAGO);
    expect(Object.keys(h.updates[0].patch)).toEqual(['whatsapp']);
    expect(h.consultores.some((c) => c.nome === 'Trocado')).toBe(false);
  });
  it('pedido só com `nome`: 400, nada gravado', async () => {
    const res = await post({ nome: 'Outro' }, NILCE);
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });
});

describe('POST /perfil: foto', () => {
  it('JPEG: cria o bucket PÚBLICO na primeira gravação, sobe em <nome>/<instante>.jpg e grava a URL', async () => {
    const res = await post({ foto: foto(JPEG(500)) }, NILCE);
    expect(res.status).toBe(200);
    expect(h.bucketCriado).toHaveLength(1);
    expect(h.bucketCriado[0]).toMatchObject({ nome: 'equipe-fotos', opcoes: { public: true } });
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].path).toMatch(/^nilce\/\d{10,}\.jpg$/);
    expect(h.uploads[0]).toMatchObject({ bytes: 504, contentType: 'image/jpeg' });
    expect(res.body.alterado).toEqual({ whatsapp: false, foto: true });
    expect(res.body.perfil.foto_url).toMatch(/^https:\/\/storage\.exemplo\.test\/equipe-fotos\/nilce\/\d+\.jpg$/);
    expect(h.updates[0].patch).toEqual({ foto_url: res.body.perfil.foto_url });
    expect(h.trilha!.value).toEqual([expect.objectContaining({ campo: 'foto', antes: null, depois: res.body.perfil.foto_url })]);
  });
  it('bucket que já existe e é público: não recria; na segunda foto nem confere de novo', async () => {
    h.bucket = { public: true };
    expect((await post({ foto: foto(JPEG()) }, NILCE)).status).toBe(200);
    expect((await post({ foto: foto(PNG(), 'image/png') }, NILCE)).status).toBe(200);
    expect(h.bucketCriado).toHaveLength(0);
    expect(h.uploads).toHaveLength(2);
    expect(h.uploads[1].contentType).toBe('image/png');
  });
  it('bucket que existe mas é PRIVADO: recusa (502), a foto não abriria, nada gravado', async () => {
    h.bucket = { public: false };
    const res = await post({ foto: foto(JPEG()), whatsapp: CEL_A }, NILCE);
    expect(res.status).toBe(502);
    expect(h.uploads).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });
  it('WebP e `image/jpg` (o que muito celular manda) passam', async () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(50)]);
    expect((await post({ foto: foto(webp, 'image/webp') }, NILCE)).status).toBe(200);
    expect((await post({ foto: foto(JPEG(), 'image/jpg') }, NILCE)).status).toBe(200);
  });
  it('foto grande demais (acima de 1,5 MB): 413, nada sobe nem grava', async () => {
    const res = await post({ foto: foto(JPEG(1.5 * 1024 * 1024 + 10)) }, NILCE);
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/1,5 MB/);
    expect(h.uploads).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });
  it('1,5 MB cravado ainda passa', async () => {
    const res = await post({ foto: foto(JPEG(1.5 * 1024 * 1024 - 4)) }, NILCE);
    expect(res.status).toBe(200);
  });
  it('tipo errado (PDF, GIF, HEIC, sem tipo): 400', async () => {
    for (const tipo of ['application/pdf', 'image/gif', 'image/heic', '']) {
      const res = await post({ foto: foto(JPEG(), tipo) }, NILCE);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Tipo de imagem não aceito/);
    }
    expect(h.uploads).toHaveLength(0);
  });
  it('arquivo que não é o que diz ser (PNG declarado, bytes de texto) e base64 quebrado: 400', async () => {
    const texto = foto(Buffer.from('isto nao e uma imagem de verdade'), 'image/png');
    expect((await post({ foto: texto }, NILCE)).status).toBe(400);
    expect((await post({ foto: { tipo: 'image/jpeg', base64: '@@@@' } }, NILCE)).status).toBe(400);
    expect((await post({ foto: 'texto solto' }, NILCE)).status).toBe(400);
    expect(h.uploads).toHaveLength(0);
  });
  it('Storage fora: 502, e o consultores NÃO é tocado (o telefone junto também não)', async () => {
    h.uploadErro = true;
    const res = await post({ foto: foto(JPEG()), whatsapp: CEL_A }, NILCE);
    expect(res.status).toBe(502);
    expect(h.updates).toHaveLength(0);
    expect(h.trilha).toBeNull();
  });
  it('sócio sobe a foto de outro: vai para a pasta do outro', async () => {
    const res = await post({ alvo: 'giovanna', foto: foto(JPEG()) }, DIEGO);
    expect(res.status).toBe(200);
    expect(h.uploads[0].path).toMatch(/^giovanna\//);
    expect(h.trilha!.value).toEqual([expect.objectContaining({ por: 'diego', alvo: 'Giovanna', antes: 'https://exemplo.test/giovanna-antiga.jpg' })]);
  });
  it('a pasta no Storage não deixa o nome escapar do caminho', () => {
    expect(pastaDoNome('José Álvaro')).toBe('jose-alvaro');
    expect(pastaDoNome('../../x')).toBe('x');
    expect(pastaDoNome('???')).toBe('consultor');
  });
});

describe('POST /perfil: o banco do Gerador barra a gravação', () => {
  it('UPDATE que volta lista vazia (política) NÃO vira sucesso: 502', async () => {
    h.updateVazio = true;
    const res = await post({ whatsapp: CEL_A }, NILCE);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(h.trilha).toBeNull();
  });
  it('pedido sem nada (nem WhatsApp nem foto): 400', async () => {
    expect((await post({}, NILCE)).status).toBe(400);
    expect((await post({ alvo: 'Nilce' }, NILCE)).status).toBe(400);
  });
});

describe('trilha', () => {
  it('é cortada nas últimas 200', async () => {
    h.trilha = {
      value: Array.from({ length: 200 }, (_, i) => ({ em: 'x', por: 'p', alvo: 'a', campo: 'whatsapp', antes: null, depois: `velho-${i}` })),
      updated_at: '2026-10-14T00:00:00.000000+00:00',
    };
    await post({ whatsapp: CEL_A }, NILCE);
    const v = h.trilha!.value as Array<{ depois: string }>;
    expect(v).toHaveLength(200);
    expect(v[0].depois).toBe('velho-1');
    expect(v[199].depois).toBe(CEL_A_GRAVADO);
  });
  it('trilha que não consegue gravar não é engolida: a resposta diz `trilha: false`', async () => {
    h.trilha = { value: [], updated_at: 'v0' };
    // a linha muda entre a leitura e a gravação em TODAS as tentativas: corrida perdida
    const original = h.trilha;
    Object.defineProperty(h, 'trilha', {
      configurable: true,
      get() { return { value: [], updated_at: `v${++h.tique}` }; },
      set() { /* ninguém consegue gravar */ },
    });
    const res = await post({ whatsapp: CEL_A }, NILCE);
    Object.defineProperty(h, 'trilha', { configurable: true, writable: true, value: original });
    expect(res.status).toBe(200);
    expect(res.body.trilha).toBe(false);
    expect(res.body.perfil.whatsapp).toBe(CEL_A_GRAVADO);   // a mudança foi feita; só o registro falhou
  });
});

describe('teto por pessoa', () => {
  it('a 21ª gravação em 15 minutos da MESMA pessoa dá 429; outra pessoa segue normal', async () => {
    h.limiteReal = true;
    let ultimo = 0;
    for (let i = 0; i < 21; i++) ultimo = (await post({ whatsapp: 'x' }, 'Bearer tk-lote')).status;
    expect(ultimo).toBe(429);
    expect((await post({ whatsapp: 'x' }, GIOVANNA)).status).toBe(400);
  });
});
