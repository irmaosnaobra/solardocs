import { describe, it, expect, vi, beforeEach } from 'vitest';

// O dossiê guarda CNH e conta de luz. Os arquivos moram no Storage do banco PRINCIPAL (service key que existe na Vercel);
// a service key do Gerador não existe lá. Este arquivo trava que TODO acesso ao bucket `dossie-vendas` usa o cliente do
// banco principal e que o cliente do Gerador nunca encosta no Storage.

const h = vi.hoisted(() => ({
  bucketExiste: false,
  bucketPublico: false,
  /** Quantas conferências de getBucket devem dizer "não existe" mesmo com o bucket já criado (corrida entre instâncias). */
  naoExisteAte: 0,
  getBucketErro: null as null | { message: string; statusCode?: string },
  criaErro: null as null | { message: string },
  criaMasCria: false,
  uploadErro: null as null | { message: string },
  chamadas: [] as string[],
  criados: [] as Array<{ nome: string; opcoes: any }>,
  uploads: [] as Array<{ nome: string; path: string; tipo: string }>,
  removidos: [] as string[],
  baixados: [] as string[],
  assinados: [] as string[],
  geradorStorage: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      getBucket: async (nome: string) => {
        h.chamadas.push('getBucket:' + nome);
        if (h.getBucketErro) return { data: null, error: h.getBucketErro };
        if (h.naoExisteAte > 0) { h.naoExisteAte--; return { data: null, error: { message: 'Bucket not found', statusCode: '404' } }; }
        return h.bucketExiste
          ? { data: { public: h.bucketPublico }, error: null }
          : { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
      },
      createBucket: async (nome: string, opcoes: unknown) => {
        h.chamadas.push('createBucket:' + nome);
        h.criados.push({ nome, opcoes });
        if (h.criaMasCria) h.bucketExiste = true;
        if (h.criaErro) return { data: null, error: h.criaErro };
        h.bucketExiste = true;
        return { data: {}, error: null };
      },
      updateBucket: async () => { throw new Error('nunca atualiza bucket'); },
      from: (nome: string) => ({
        upload: async (path: string, _b: Buffer, o: { contentType: string }) => {
          h.uploads.push({ nome, path, tipo: o.contentType });
          return { data: {}, error: h.uploadErro };
        },
        download: async (path: string) => {
          h.baixados.push(nome + '/' + path);
          return path.endsWith('ruim.jpg')
            ? { data: null, error: { message: 'x' } }
            : { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
        },
        remove: async (caminhos: string[]) => { h.removidos.push(...caminhos.map((c) => nome + '/' + c)); return { data: [], error: null }; },
        createSignedUrl: async (path: string) => { h.assinados.push(nome + '/' + path); return { data: { signedUrl: 'https://p/assinada/' + path }, error: null }; },
      }),
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: () => { throw new Error('metadados não entram neste teste'); },
    get storage() { h.geradorStorage++; throw new Error('o Storage do Gerador não pode ser usado'); },
  },
}));

import {
  BUCKET_DOSSIE, MIMES_DOSSIE, LIMITE_BUCKET_DOSSIE,
  garantirBucket, sondarBucket, subirArquivo, baixarArquivo, removerArquivo, assinar, limparCacheBucketDossie,
} from '../services/gerador/dossieVenda';

beforeEach(() => {
  limparCacheBucketDossie();
  h.bucketExiste = false; h.bucketPublico = false; h.naoExisteAte = 0; h.getBucketErro = null; h.criaErro = null;
  h.criaMasCria = false; h.uploadErro = null;
  h.chamadas.length = 0; h.criados.length = 0; h.uploads.length = 0; h.removidos.length = 0; h.baixados.length = 0; h.assinados.length = 0;
  h.geradorStorage = 0;
});

const buf = Buffer.from([1, 2, 3]);

describe('dossiê: Storage no banco principal', () => {
  it('upload e URL assinada usam o cliente do banco principal, no bucket do dossiê', async () => {
    h.bucketExiste = true;
    const r = await subirArquivo('2026/doc-1.jpg', buf, 'image/jpeg');
    expect(r).toEqual({ ok: true });
    expect(h.uploads).toEqual([{ nome: BUCKET_DOSSIE, path: '2026/doc-1.jpg', tipo: 'image/jpeg' }]);
    expect(await assinar('2026/doc-1.jpg')).toBe('https://p/assinada/2026/doc-1.jpg');
    expect(h.assinados).toEqual([`${BUCKET_DOSSIE}/2026/doc-1.jpg`]);
    expect(h.geradorStorage).toBe(0);
  });

  it('download devolve os bytes; arquivo ilegível vira null', async () => {
    const ok = await baixarArquivo('2026/a.jpg');
    expect(ok?.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(await baixarArquivo('2026/ruim.jpg')).toBeNull();
    expect(h.baixados[0]).toBe(`${BUCKET_DOSSIE}/2026/a.jpg`);
    expect(h.geradorStorage).toBe(0);
  });

  it('remoção usa o banco principal', async () => {
    expect(await removerArquivo('2026/a.jpg')).toBe(true);
    expect(h.removidos).toEqual([`${BUCKET_DOSSIE}/2026/a.jpg`]);
    expect(h.geradorStorage).toBe(0);
  });

  it('a sonda de saúde usa getBucket do banco principal: existe, não existe e indeterminado', async () => {
    h.bucketExiste = true;
    expect(await sondarBucket()).toBe('existe');
    h.bucketExiste = false;
    expect(await sondarBucket()).toBe('nao_existe');
    h.getBucketErro = { message: 'fora do ar', statusCode: '500' };
    expect(await sondarBucket()).toBe('indeterminado');
    expect(h.chamadas.every((c) => c === `getBucket:${BUCKET_DOSSIE}`)).toBe(true);
    expect(h.geradorStorage).toBe(0);
  });

  it('bucket inexistente é criado UMA vez, privado, com os tipos e o limite do dossiê', async () => {
    expect((await subirArquivo('a/1.png', buf, 'image/png')).ok).toBe(true);
    expect((await subirArquivo('a/2.png', buf, 'image/png')).ok).toBe(true);
    expect((await subirArquivo('a/3.pdf', buf, 'application/pdf')).ok).toBe(true);
    expect(h.criados).toHaveLength(1);
    expect(h.criados[0].nome).toBe(BUCKET_DOSSIE);
    expect(h.criados[0].opcoes).toEqual({ public: false, fileSizeLimit: LIMITE_BUCKET_DOSSIE, allowedMimeTypes: MIMES_DOSSIE });
    expect(MIMES_DOSSIE).toContain('application/pdf');
    expect(MIMES_DOSSIE).toContain('image/heic');
    // depois do primeiro sucesso a instância memoriza: um único getBucket
    expect(h.chamadas.filter((c) => c.startsWith('getBucket')).length).toBe(1);
    expect(h.uploads).toHaveLength(3);
  });

  it('bucket que já existe não é recriado nem atualizado', async () => {
    h.bucketExiste = true;
    await subirArquivo('a/1.png', buf, 'image/png');
    expect(h.criados).toHaveLength(0);
  });

  it('falha ao criar o bucket por permissão vira erro claro (503) sobre a chave do banco principal, e nada é gravado', async () => {
    h.criaErro = { message: 'new row violates row-level security policy' };
    const r = await subirArquivo('a/1.png', buf, 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.http).toBe(503);
      expect(r.erro).toContain('SUPABASE_SERVICE_KEY');
      expect(r.erro).not.toContain('SUPABASE_GERADOR_SERVICE_KEY');
    }
    expect(h.uploads).toHaveLength(0);
    const g = await garantirBucket();
    expect(g.ok).toBe(false);
    expect(g.motivo).not.toContain('SUPABASE_GERADOR_SERVICE_KEY');
  });

  it('outra falha de criação traz o motivo, sem mandar configurar a chave do Gerador', async () => {
    h.criaErro = { message: 'quota exceeded' };
    const g = await garantirBucket();
    expect(g.ok).toBe(false);
    expect(g.motivo).toContain('quota exceeded');
    expect(g.motivo).not.toContain('SUPABASE_GERADOR_SERVICE_KEY');
  });

  it('bucket que outra instância criou no mesmo instante conta como sucesso', async () => {
    h.criaErro = { message: 'already exists' };
    h.criaMasCria = true;
    const g = await garantirBucket();
    expect(g.ok).toBe(true);
    expect(h.criados).toHaveLength(1);
  });

  it('bucket público é recusado: CNH não pode ficar aberta', async () => {
    h.bucketExiste = true; h.bucketPublico = true;
    const r = await subirArquivo('a/1.png', buf, 'image/png');
    expect(r.ok).toBe(false);
    expect(h.uploads).toHaveLength(0);
  });

  it('upload com erro do Storage devolve 502 com a mensagem', async () => {
    h.bucketExiste = true;
    h.uploadErro = { message: 'payload too large' };
    const r = await subirArquivo('a/1.png', buf, 'image/png');
    expect(r).toEqual({ ok: false, http: 502, erro: 'não consegui salvar o arquivo: payload too large' });
  });
});
