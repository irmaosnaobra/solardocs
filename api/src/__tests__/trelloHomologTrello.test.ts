import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Homologação lida do Trello (20/11/2026): as chamadas ao Trello. O token só vai a endereço do Trello; o anexo é conferido (tamanho, tipo, assinatura).
// `fetch` simulado: nada sai para a rede. Chave e token inventados.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { baixarAnexoDoTrello, lerCartaoHomologacao, lerCorpoLimitado } from '../services/gerador/trelloHomologTrello';
import type { AnexoTrello } from '../services/gerador/trelloHomologPuro';

const CRED = { key: 'chave-falsa-123', token: 'token-falso-456' };
const ID = 'a'.repeat(24);
const anexo = (o: Partial<AnexoTrello> = {}): AnexoTrello => ({
  id: ID, nome: 'ART.pdf', arquivo: 'art.pdf', url: 'https://trello.com/1/cards/c1/attachments/a1/download/art.pdf', mime: 'application/pdf', bytes: 100,
  em: '2026-11-18T10:00:00.000Z', upload: true, ...o,
});
const pdf = (): Buffer => Buffer.from('%PDF-1.4\n conteudo');
const resp = (corpo: Buffer | string, init: { status?: number; headers?: Record<string, string> } = {}): Response =>
  new Response(typeof corpo === 'string' ? corpo : new Uint8Array(corpo), { status: init.status ?? 200, headers: init.headers });

let chamadas: Array<{ url: string; headers: Record<string, string>; metodo: string; redirect: string | undefined }>;
const simular = (...respostas: Array<Response | Error>): void => {
  chamadas = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), headers: { ...((init?.headers as Record<string, string>) ?? {}) }, metodo: String(init?.method), redirect: init?.redirect });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  }));
};
beforeEach(() => { chamadas = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('baixar o anexo: o token só vai ao Trello', () => {
  it('URL de fora do Trello: nem chama a rede (o token não vai para outro host)', async () => {
    simular(resp(pdf()));
    for (const url of ['https://example.com/a.pdf', 'https://trello.com.evil.com/a.pdf', 'http://trello.com/a.pdf', 'https://trello-attachments.s3.amazonaws.com/a.pdf']) {
      expect(await baixarAnexoDoTrello(CRED, anexo({ url }))).toEqual({ ok: false, motivo: 'fora_do_trello', definitivo: true });
    }
    expect(chamadas).toHaveLength(0);
  });
  it('link (não é upload) nem baixa', async () => {
    simular(resp(pdf()));
    expect(await baixarAnexoDoTrello(CRED, anexo({ upload: false }))).toMatchObject({ ok: false, motivo: 'fora_do_trello' });
    expect(chamadas).toHaveLength(0);
  });
  it('URL do Trello: header OAuth com key e token, GET, redirect manual; devolve os bytes e o tipo pela assinatura', async () => {
    simular(resp(pdf()));
    const r = await baixarAnexoDoTrello(CRED, anexo());
    expect(r).toMatchObject({ ok: true, mime: 'application/pdf' });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].metodo).toBe('GET');
    expect(chamadas[0].redirect).toBe('manual');
    expect(chamadas[0].headers.Authorization).toBe(`OAuth oauth_consumer_key="${CRED.key}", oauth_token="${CRED.token}"`);
    expect(chamadas[0].url).not.toContain(CRED.token);   // o token vai no header, nunca na URL
  });
  it('redirecionamento para fora do Trello: segue SEM o header; para o Trello, com ele', async () => {
    simular(resp('', { status: 302, headers: { location: 'https://bucket-externo.example.com/assinado?x=1' } }), resp(pdf()));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: true });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].headers.Authorization).toContain(CRED.token);
    expect(chamadas[1].url).toContain('bucket-externo.example.com');
    expect(chamadas[1].headers.Authorization).toBeUndefined();

    simular(resp('', { status: 302, headers: { location: 'https://trello-attachments.trello.com/z/a.pdf' } }), resp(pdf()));
    await baixarAnexoDoTrello(CRED, anexo());
    expect(chamadas[1].headers.Authorization).toContain(CRED.token);
  });
  it('redirecionamento para http, sem destino ou sem fim: recusa, sem vazar o header', async () => {
    simular(resp('', { status: 302, headers: { location: 'http://trello.com/a.pdf' } }));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: false, motivo: 'fora_do_trello', definitivo: true });
    simular(resp('', { status: 302 }));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: false, motivo: 'rede', definitivo: false });
    simular(resp('', { status: 302, headers: { location: 'https://trello.com/outro' } }));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: false, motivo: 'rede' });
    expect(chamadas.length).toBeLessThanOrEqual(4);
  });
});

describe('baixar o anexo: tamanho, tipo e assinatura', () => {
  it('mais de 10 MB: pelo tamanho do Trello (nem baixa), pelo content-length e pelos bytes', async () => {
    simular(resp(pdf()));
    expect(await baixarAnexoDoTrello(CRED, anexo({ bytes: 10 * 1024 * 1024 + 1 }))).toEqual({ ok: false, motivo: 'grande', definitivo: true });
    expect(chamadas).toHaveLength(0);
    simular(resp(pdf(), { headers: { 'content-length': String(11 * 1024 * 1024) } }));
    expect(await baixarAnexoDoTrello(CRED, anexo({ bytes: 0 }))).toMatchObject({ ok: false, motivo: 'grande' });
    simular(resp(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)])));
    expect(await baixarAnexoDoTrello(CRED, anexo({ bytes: 0 }))).toMatchObject({ ok: false, motivo: 'grande' });
  });
  it('assinatura que não é jpeg, png, webp nem pdf: recusa; tipo declarado diferente da assinatura: recusa', async () => {
    simular(resp('<html>não é arquivo</html>'));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toEqual({ ok: false, motivo: 'tipo', definitivo: true });
    simular(resp(pdf()));
    expect(await baixarAnexoDoTrello(CRED, anexo({ mime: 'image/png' }))).toMatchObject({ ok: false, motivo: 'tipo' });
    simular(resp(pdf()));
    expect(await baixarAnexoDoTrello(CRED, anexo({ mime: 'application/octet-stream' }))).toMatchObject({ ok: true, mime: 'application/pdf' });
  });
  it('falha de rede e resposta de erro: não é definitivo (tenta de novo); 404 é definitivo; nada lança', async () => {
    simular(new Error('queda'));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toEqual({ ok: false, motivo: 'rede', definitivo: false });
    simular(resp('erro', { status: 500 }));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: false, definitivo: false });
    simular(resp('x', { status: 404 }));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: false, definitivo: true });
    simular(resp(''));
    expect(await baixarAnexoDoTrello(CRED, anexo())).toMatchObject({ ok: false, motivo: 'rede' });
  });
});

describe('ler o cartão (só GET)', () => {
  it('pede anexos e checklists, só por GET, e devolve o cartão no formato do contrato', async () => {
    simular(resp(JSON.stringify({
      shortUrl: 'https://trello.com/c/AbCd1234',
      checklists: [{ name: 'ENGENHARIA', checkItems: [{ name: 'Parecer Aprovado', state: 'complete', pos: 1 }] }],
      attachments: [{ id: ID, name: 'ART.pdf', url: 'https://trello.com/1/x', isUpload: true, bytes: 10, date: '2026-11-18T10:00:00.000Z', mimeType: 'application/pdf' }],
    })));
    const r = await lerCartaoHomologacao(CRED, ID);
    expect(r).toMatchObject({ ok: true, dados: { url: 'https://trello.com/c/AbCd1234', checklist: [{ nome: 'Parecer Aprovado', feito: true }] } });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].metodo).toBe('GET');
    expect(chamadas[0].url).toContain(`/cards/${ID}?`);
    expect(chamadas[0].url).toContain('attachments=true');
    expect(chamadas[0].url).toContain('checklists=all');
  });
  it('Trello fora do ar, recusando a chave ou devolvendo lixo: erro sem lançar e sem a URL no motivo', async () => {
    simular(resp('negado', { status: 401 }));
    const r = await lerCartaoHomologacao(CRED, ID);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(CRED.token);
    simular(new Error('queda'));
    expect((await lerCartaoHomologacao(CRED, ID)).ok).toBe(false);
    simular(resp('"texto"'));
    expect(await lerCartaoHomologacao(CRED, ID)).toMatchObject({ ok: false });
  });
});

describe('ler o corpo com tempo limite e teto de memória', () => {
  const fluxo = (pedacos: Uint8Array[], travarNoFim = false): Response => new Response(new ReadableStream<Uint8Array>({
    start(c) { for (const p of pedacos) c.enqueue(p); if (!travarNoFim) c.close(); },
  }));
  it('corpo dentro do limite volta inteiro', async () => {
    const r = await lerCorpoLimitado(fluxo([Buffer.from('%PDF-'), Buffer.from('1.4')]), 100, 1000);
    expect(Buffer.isBuffer(r) && r.toString()).toBe('%PDF-1.4');
  });
  it('passou do limite SEM content-length: aborta e não segura o resto', async () => {
    expect(await lerCorpoLimitado(fluxo([Buffer.alloc(6), Buffer.alloc(6), Buffer.alloc(6)]), 10, 1000)).toBe('grande');
  });
  it('corpo que não termina no prazo é cancelado (tempo), sem pendurar', async () => {
    const t0 = Date.now();
    expect(await lerCorpoLimitado(fluxo([Buffer.from('%PDF')], true), 100, 40)).toBe('tempo');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('baixarAnexoDoTrello: 11 MB em pedaços e sem content-length vira "grande" (definitivo)', async () => {
    const pedaco = Buffer.alloc(1024 * 1024, 1);
    simular(fluxo(Array.from({ length: 11 }, () => pedaco)));
    expect(await baixarAnexoDoTrello(CRED, anexo({ bytes: 0 }))).toEqual({ ok: false, motivo: 'grande', definitivo: true });
  });
});
