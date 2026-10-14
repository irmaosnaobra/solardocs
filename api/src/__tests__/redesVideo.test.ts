import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Vídeo das redes: só o nosso bucket (o caminho já resolvido e decodificado é que vale), tamanho e tipo pelo HEAD,
// e o bucket criado ou ajustado com 50 MB e só mp4 e mov. Storage e rede são dublês.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));

import { banco } from './redesBancoFalso';
import { validarVideo, criarUrlDeEnvio, ErroVideo } from '../services/gerador/redes/video';

const BASE = 'https://x.supabase.co/storage/v1/object/public/redes-videos/';
const OPCOES = { public: true, fileSizeLimit: 50 * 1024 * 1024, allowedMimeTypes: ['video/mp4', 'video/quicktime'] };

const fetchMock = vi.fn(async () => ({
  ok: true, status: 200, headers: new Headers({ 'content-length': '5000000', 'content-type': 'video/mp4', etag: '"e1"' }),
}) as unknown as Response);

beforeEach(() => {
  banco.reiniciar();
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const valida = (url: string) => validarVideo(url, { maxBytes: 50 * 1024 * 1024 });

describe('validarVideo: o link tem de ficar dentro do nosso bucket depois de resolvido', () => {
  it('link normal passa e a impressão digital vem do etag', async () => {
    const r = await valida(`${BASE}2026/10/a.mp4`);
    expect(r).toMatchObject({ ok: true, ext: 'mp4', bytes: 5_000_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['%2e%2e minúsculo', `${BASE}%2e%2e/outro-bucket/a.mp4`],
    ['%2E%2E maiúsculo', `${BASE}%2E%2E/outro-bucket/a.mp4`],
    ['..%2f', `${BASE}..%2foutro-bucket/a.mp4`],
    ['%2e%2e%2f', `${BASE}%2e%2e%2foutro-bucket/a.mp4`],
    ['barra dupla', `${BASE}/a.mp4`],
    ['barra dupla no meio', `${BASE}2026//a.mp4`],
    ['.. literal que sai do bucket', `${BASE}../outro-bucket/a.mp4`],
    ['.. literal que volta', `${BASE}x/../a.mp4`],
    ['segmento ponto', `${BASE}x/./a.mp4`],
    ['% no nome', `${BASE}a%20b.mp4`],
    ['barra invertida', `${BASE}x\\..\\a.mp4`],
    ['outro bucket', 'https://x.supabase.co/storage/v1/object/public/outro-bucket/a.mp4'],
    ['outro host', 'https://evil.example.com/storage/v1/object/public/redes-videos/a.mp4'],
    ['usuário no link', 'https://x.supabase.co@evil.example.com/storage/v1/object/public/redes-videos/a.mp4'],
    ['query', `${BASE}a.mp4?x=1`],
  ])('recusa: %s', async (_nome, url) => {
    const r = await valida(url);
    expect(r.ok).toBe(false);
    expect((r as { motivo: string }).motivo).toBe('video_de_fora');
    expect(fetchMock).not.toHaveBeenCalled();     // nem chega a abrir o link
  });

  it('extensão fora de mp4 e mov, e mov no status (só mp4), recusam', async () => {
    expect(await valida(`${BASE}a.avi`)).toMatchObject({ ok: false, motivo: 'formato' });
    expect(await validarVideo(`${BASE}a.mov`, { maxBytes: 1e8, soMp4: true })).toMatchObject({ ok: false, motivo: 'formato' });
    expect((await valida(`${BASE}a.mov`)).ok).toBe(true);
  });
});

describe('o bucket: criado ou ajustado com 50 MB e só mp4 e mov', () => {
  const pedir = () => criarUrlDeEnvio({ nome: 'a.mp4', tipo: 'video/mp4', tamanho: 1000 });

  it('não existe: cria público, com o limite de 50 MB e os dois tipos', async () => {
    await pedir();
    expect(banco.storage.criados).toEqual(['redes-videos']);
    expect(banco.storage.opcoes[0]).toEqual(OPCOES);
    expect(banco.storage.atualizados).toEqual([]);
  });

  it('existe SEM os limites: atualiza (updateBucket) e segue', async () => {
    banco.storage.bucket = { existe: true, publico: true, erroLeitura: false, limite: null, tipos: null };
    const u = await pedir();
    expect(u.upload_url).toContain('/upload/sign/');
    expect(banco.storage.atualizados).toEqual([{ nome: 'redes-videos', opcoes: OPCOES }]);
    expect(banco.storage.criados).toEqual([]);
  });

  it('existe com o limite certo mas tipo a mais ou a menos: também atualiza', async () => {
    banco.storage.bucket = { existe: true, publico: true, erroLeitura: false, limite: 50 * 1024 * 1024, tipos: ['video/mp4'] };
    await pedir();
    expect(banco.storage.atualizados).toHaveLength(1);
    banco.reiniciar();
    banco.storage.bucket = { existe: true, publico: true, erroLeitura: false, limite: 50 * 1024 * 1024, tipos: ['video/mp4', 'video/quicktime', 'image/png'] };
    await pedir();
    expect(banco.storage.atualizados).toHaveLength(1);
  });

  it('existe SEM os limites e a atualização falha: 502, sem URL de envio', async () => {
    banco.storage.bucket = { existe: true, publico: true, erroLeitura: false, limite: null, tipos: null, erroAtualizar: true };
    await expect(pedir()).rejects.toMatchObject({ http: 502, motivo: 'bucket_sem_limites' });
    expect(banco.storage.assinados).toEqual([]);
    await expect(pedir()).rejects.toBeInstanceOf(ErroVideo);
  });

  it('já está certo: não mexe', async () => {
    banco.storage.bucket = { existe: true, publico: true, erroLeitura: false, limite: 50 * 1024 * 1024, tipos: ['video/quicktime', 'video/mp4'] };
    await pedir();
    expect(banco.storage.atualizados).toEqual([]);
    expect(banco.storage.criados).toEqual([]);
  });
});
