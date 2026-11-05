import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Spies do Storage compartilhados com o factory do mock (o factory roda antes das consts).
const mockUpload = vi.fn();
const mockSignedUrl = vi.fn();
const mockSignedUrls = vi.fn();

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      lt: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
      not: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    })),
    rpc: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        upload: (...a: unknown[]) => mockUpload(...a),
        createSignedUrl: (...a: unknown[]) => mockSignedUrl(...a),
        createSignedUrls: (...a: unknown[]) => mockSignedUrls(...a),
      })),
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/jwt', () => ({
  signToken: vi.fn().mockReturnValue('mock-token'),
  verifyToken: vi.fn((t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  }),
}));
vi.mock('stripe', () => ({ default: class { customers = { list: vi.fn().mockResolvedValue({ data: [] }) } } }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('../utils/mailer', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  sendWelcomeWhatsApp: vi.fn(),
  handleIncomingWhatsApp: vi.fn(),
  processMessageQueue: vi.fn().mockResolvedValue({ processed: 0 }),
}));

import app from '../app';
import { renovarUrlsPortfolio } from '../controllers/portfolioController';

const AUTH = 'Bearer valid-token';
const CINCO_ANOS = 5 * 365 * 24 * 3600;

// PNG de verdade (assinatura + enchimento) com o tamanho pedido em bytes.
function pngDataUrl(bytes = 200, mime = 'png'): string {
  const head = mime === 'png' ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : mime === 'jpeg' ? Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    : Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  const buf = Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 1)]);
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://x.test/assinada' }, error: null });
  mockSignedUrls.mockReset().mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://x.test/nova/${path}`, error: null })),
    error: null,
  }));
});

// ─── POST /documents/portfolio-imagem ────────────────────────────────
describe('POST /documents/portfolio-imagem', () => {
  const post = (body: unknown) => request(app).post('/documents/portfolio-imagem').set('Authorization', AUTH).send(body as object);

  it('sobe a imagem em portfolio/{userId}/{tipo}/ e devolve path e URL assinada de 5 anos', async () => {
    const res = await post({ tipo: 'obra', dataUrl: pngDataUrl() });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/^portfolio\/user-123\/obra\/\d+-[a-f0-9]{10}\.png$/);
    expect(res.body.url).toBe('https://x.test/assinada');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [path, buf, opts] = mockUpload.mock.calls[0];
    expect(path).toBe(res.body.path);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(opts).toMatchObject({ contentType: 'image/png', upsert: false });
    expect(mockSignedUrl).toHaveBeenCalledWith(res.body.path, CINCO_ANOS);
  });

  it('aceita jpeg e webp, com a extensão certa', async () => {
    const j = await post({ tipo: 'empresa', dataUrl: pngDataUrl(300, 'jpeg') });
    expect(j.status).toBe(200);
    expect(j.body.path).toMatch(/^portfolio\/user-123\/empresa\/\d+-[a-f0-9]{10}\.jpg$/);
    const w = await post({ tipo: 'banco', dataUrl: pngDataUrl(300, 'webp') });
    expect(w.status).toBe(200);
    expect(w.body.path).toMatch(/^portfolio\/user-123\/banco\/\d+-[a-f0-9]{10}\.webp$/);
  });

  it('tipo fora de obra/empresa/banco dá 400', async () => {
    const res = await post({ tipo: 'outro', dataUrl: pngDataUrl() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('mime inválido (gif, svg, texto) dá 400', async () => {
    for (const dataUrl of [
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:text/html;base64,PGh0bWw+',
      'https://exemplo.com/a.png',
      'data:image/png;base64,@@@@',
    ]) {
      const res = await post({ tipo: 'obra', dataUrl });
      expect(res.status).toBe(400);
    }
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('mime que não bate com o conteúdo dá 400', async () => {
    const res = await post({ tipo: 'obra', dataUrl: `data:image/png;base64,${Buffer.from('<html>oi</html>').toString('base64')}` });
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('acima de 3 MB decodificado dá 400, e 3 MB cravados passa', async () => {
    const grande = await post({ tipo: 'obra', dataUrl: pngDataUrl(3 * 1024 * 1024 + 1) });
    expect(grande.status).toBe(400);
    expect(grande.body.error).toMatch(/3 MB/);
    const enorme = await post({ tipo: 'obra', dataUrl: pngDataUrl(6 * 1024 * 1024) });
    expect(enorme.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
    const limite = await post({ tipo: 'obra', dataUrl: pngDataUrl(3 * 1024 * 1024) });
    expect(limite.status).toBe(200);
  });

  it('sem login dá 401', async () => {
    const res = await request(app).post('/documents/portfolio-imagem').send({ tipo: 'obra', dataUrl: pngDataUrl() });
    expect(res.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('erro do storage vira 500 com mensagem genérica, sem vazar o erro', async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: 'bucket secreto xyz falhou' } });
    const res = await post({ tipo: 'obra', dataUrl: pngDataUrl() });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/enviar a imagem/);
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    mockSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'chave vazada' } });
    const res2 = await post({ tipo: 'obra', dataUrl: pngDataUrl() });
    expect(res2.status).toBe(500);
    expect(JSON.stringify(res2.body)).not.toContain('vazada');
  });
});

// ─── renovarUrlsPortfolio ────────────────────────────────────────────
describe('renovarUrlsPortfolio', () => {
  const U = 'user-123';
  const obra = (n: number) => `portfolio/${U}/obra/${1700000000000 + n}-abcdef12.jpg`;
  const emp = (n: number) => `portfolio/${U}/empresa/${1700000000000 + n}-abcdef12.png`;
  const ban = (n: number) => `portfolio/${U}/banco/${1700000000000 + n}-abcdef12.webp`;

  it('sem galeria nenhuma: devolve o mesmo objeto e não toca no storage', async () => {
    const f = { investimento: '1000' };
    expect(await renovarUrlsPortfolio(U, f)).toBe(f);
    expect(mockSignedUrls).not.toHaveBeenCalled();
  });

  it('chave ausente continua ausente (propostas dos modelos 1 a 3 não ganham [])', async () => {
    const r = await renovarUrlsPortfolio(U, { fotos_obras: [{ path: obra(1), url: 'https://velha/x' }] });
    expect(r).toHaveProperty('fotos_obras');
    expect(r).not.toHaveProperty('empresas_atendidas');
    expect(r).not.toHaveProperty('bancos_parceiros');
  });

  it('re-assina pelo path e NUNCA usa a URL que veio do cliente', async () => {
    const r = await renovarUrlsPortfolio(U, {
      fotos_obras: [{ path: obra(1), url: 'http://interno.local/segredo', legenda: ' Casa ' }],
      empresas_atendidas: [{ path: emp(2), url: 'javascript:alert(1)', nome: 'Empresa X' }],
      bancos_parceiros: [{ nome: 'Banco A', path: ban(3), url: 'https://nao.vale/y' }],
    });
    expect(mockSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockSignedUrls.mock.calls[0][1]).toBe(CINCO_ANOS);
    expect(mockSignedUrls.mock.calls[0][0]).toEqual([obra(1), emp(2), ban(3)]);
    expect(r.fotos_obras).toEqual([{ path: obra(1), url: `https://x.test/nova/${obra(1)}`, legenda: 'Casa' }]);
    expect(r.empresas_atendidas).toEqual([{ path: emp(2), url: `https://x.test/nova/${emp(2)}`, nome: 'Empresa X' }]);
    expect(r.bancos_parceiros).toEqual([{ nome: 'Banco A', path: ban(3), url: `https://x.test/nova/${ban(3)}` }]);
    expect(JSON.stringify(r)).not.toContain('interno.local');
    expect(JSON.stringify(r)).not.toContain('nao.vale');
  });

  it('path de outro usuário, com .. ou barra invertida, ou do tipo errado sai', async () => {
    const r = await renovarUrlsPortfolio(U, {
      fotos_obras: [
        { path: 'portfolio/outro-usuario/obra/1700000000000-abcdef12.jpg', url: 'https://a/b' },
        { path: `portfolio/${U}/obra/../../outro/obra/1700000000000-abcdef12.jpg`, url: 'https://a/b' },
        { path: `portfolio\\${U}\\obra\\1700000000000-abcdef12.jpg`, url: 'https://a/b' },
        { path: `portfolio/${U}/empresa/1700000000000-abcdef12.jpg`, url: 'https://a/b' },
        { path: `vistorias/${U}/obra/1700000000000-abcdef12.jpg`, url: 'https://a/b' },
        { url: 'https://a/b' },
        'texto solto',
        null,
        { path: obra(9), url: 'https://a/b' },
      ],
    });
    expect(r.fotos_obras).toEqual([{ path: obra(9), url: `https://x.test/nova/${obra(9)}` }]);
    expect(mockSignedUrls.mock.calls[0][0]).toEqual([obra(9)]);
  });

  it('banco sem path fica só com o nome; banco com path de outro usuário sai; sem nome nem path sai', async () => {
    const r = await renovarUrlsPortfolio(U, {
      bancos_parceiros: [
        { nome: 'Banco do Brasil' },
        { nome: 'Banco Falso', path: 'portfolio/outro/banco/1700000000000-abcdef12.png', url: 'https://a/b' },
        { nome: '   ' },
        { nome: 'Caixa', url: 'https://a/b' },
      ],
    });
    expect(r.bancos_parceiros).toEqual([{ nome: 'Banco do Brasil' }, { nome: 'Caixa' }]);
    expect(mockSignedUrls).not.toHaveBeenCalled();
  });

  it('assinatura que falha: o item continua salvo (sem url), para a galeria não sumir das próximas propostas', async () => {
    mockSignedUrls.mockResolvedValueOnce({
      data: [
        { path: obra(1), signedUrl: null, error: 'Object not found' },
        { path: obra(2), signedUrl: `https://x.test/nova/${obra(2)}`, error: null },
        { path: ban(3), signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    });
    const r = await renovarUrlsPortfolio(U, {
      fotos_obras: [{ path: obra(1), url: 'x' }, { path: obra(2), url: 'x' }],
      bancos_parceiros: [{ nome: 'Banco A', path: ban(3) }, { nome: '', path: ban(4) }],
    });
    expect(r.fotos_obras).toEqual([{ path: obra(1) }, { path: obra(2), url: `https://x.test/nova/${obra(2)}` }]);
    expect(r.bancos_parceiros).toEqual([{ nome: 'Banco A', path: ban(3) }, { nome: '', path: ban(4) }]);
  });

  it('o resultado é associado pelo path, não pela posição', async () => {
    mockSignedUrls.mockResolvedValueOnce({
      data: [
        { path: obra(2), signedUrl: 'https://x.test/dois', error: null },
        { path: obra(1), signedUrl: 'https://x.test/um', error: null },
      ],
      error: null,
    });
    const r = await renovarUrlsPortfolio(U, { fotos_obras: [{ path: obra(1) }, { path: obra(2) }] });
    expect(r.fotos_obras).toEqual([{ path: obra(1), url: 'https://x.test/um' }, { path: obra(2), url: 'https://x.test/dois' }]);
  });

  it('falha total do storage: itens salvos sem url, sem lançar erro', async () => {
    mockSignedUrls.mockRejectedValueOnce(new Error('rede caiu'));
    const r = await renovarUrlsPortfolio(U, {
      fotos_obras: [{ path: obra(1) }],
      empresas_atendidas: [{ path: emp(1) }],
      bancos_parceiros: [{ nome: 'Banco A', path: ban(1) }, { nome: 'Caixa' }],
    });
    // Nada de URL, mas tudo continua salvo; o template é que não desenha item sem URL.
    expect(r.fotos_obras).toEqual([{ path: obra(1) }]);
    expect(r.empresas_atendidas).toEqual([{ path: emp(1) }]);
    expect(r.bancos_parceiros).toEqual([{ nome: 'Banco A', path: ban(1) }, { nome: 'Caixa' }]);
  });

  it('limites 6, 12 e 8; textos aparados em 80 caracteres', async () => {
    const r = await renovarUrlsPortfolio(U, {
      fotos_obras: Array.from({ length: 9 }, (_, i) => ({ path: obra(i), legenda: 'L'.repeat(200) })),
      empresas_atendidas: Array.from({ length: 15 }, (_, i) => ({ path: emp(i), nome: 'N'.repeat(100) })),
      bancos_parceiros: Array.from({ length: 11 }, (_, i) => ({ nome: `Banco ${i}` })),
    });
    expect((r.fotos_obras as Array<{ legenda: string }>)).toHaveLength(6);
    expect((r.fotos_obras as Array<{ legenda: string }>)[0].legenda).toHaveLength(80);
    expect((r.empresas_atendidas as Array<{ nome: string }>)).toHaveLength(12);
    expect((r.empresas_atendidas as Array<{ nome: string }>)[0].nome).toHaveLength(80);
    expect(r.bancos_parceiros as unknown[]).toHaveLength(8);
  });

  it('valor que não é lista vira lista vazia, sem quebrar', async () => {
    const r = await renovarUrlsPortfolio(U, { fotos_obras: 'x', empresas_atendidas: { a: 1 }, bancos_parceiros: 5 });
    expect(r).toMatchObject({ fotos_obras: [], empresas_atendidas: [], bancos_parceiros: [] });
  });

  it('não altera o objeto original', async () => {
    const f = { fotos_obras: [{ path: obra(1), url: 'velha' }] };
    const copia = JSON.parse(JSON.stringify(f));
    await renovarUrlsPortfolio(U, f);
    expect(f).toEqual(copia);
  });
});
