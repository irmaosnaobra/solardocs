import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normFone, separarNome, normCidade, normUf, userData, cookieMeta, sha256,
  enviarEventoMeta, pixelDoProduto, PIXEL_SOLAR, PIXEL_ELETROPOSTO,
} from '../utils/metaCapi';

describe('normalização do que identifica a pessoa', () => {
  it('telefone sai com 55 e só dígitos, em qualquer formato que chega', () => {
    expect(normFone('(34) 99816-5040')).toBe('5534998165040');
    expect(normFone('34998165040')).toBe('5534998165040');
    expect(normFone('+55 34 99816-5040')).toBe('5534998165040');
    expect(normFone('553432105040')).toBe('553432105040');
    expect(normFone('3432105040')).toBe('553432105040');
  });
  it('telefone torto vira null em vez de hash de lixo', () => {
    expect(normFone('')).toBeNull();
    expect(normFone('99816')).toBeNull();
    expect(normFone('1234567890123')).toBeNull(); // 13 dígitos sem o 55
    expect(normFone(null)).toBeNull();
  });
  it('nome: primeiro e último, sem acento', () => {
    expect(separarNome('  João da Silva Araújo ')).toEqual({ fn: 'joao', ln: 'araujo' });
    expect(separarNome('Ana')).toEqual({ fn: 'ana', ln: '' });
    expect(separarNome('')).toEqual({ fn: '', ln: '' });
  });
  it('cidade e UF saem do jeito que o Meta compara', () => {
    expect(normCidade('Uberlândia, MG')).toBe('uberlandia');
    expect(normCidade('Uberlândia/MG')).toBe('uberlandia');
    expect(normCidade('São João del-Rei')).toBe('saojoaodelrei');
    expect(normUf('MG')).toBe('mg');
    expect(normUf('Uberlândia, MG')).toBe('mg');
    expect(normUf('Uberlândia')).toBe('');
  });
});

describe('userData', () => {
  it('telefone vira ph e external_id com o MESMO hash', () => {
    const u = userData({ telefone: '(34) 99816-5040', nome: 'Ana Souza', cidade: 'Uberaba, MG' });
    expect(u.ph).toEqual([sha256('5534998165040')]);
    expect(u.external_id).toEqual(u.ph);
    expect(u.fn).toEqual([sha256('ana')]);
    expect(u.ln).toEqual([sha256('souza')]);
    expect(u.ct).toEqual([sha256('uberaba')]);
    expect(u.st).toEqual([sha256('mg')]);
    expect(u.country).toEqual([sha256('br')]);
  });
  it('campo vazio não entra (hash de vazio casaria com ninguém)', () => {
    const u = userData({ telefone: '', nome: 'Ana' });
    expect(u).not.toHaveProperty('ph');
    expect(u).not.toHaveProperty('ln');
    expect(u).not.toHaveProperty('ct');
    expect(u).not.toHaveProperty('em');
  });
  it('fbc, fbp, IP e navegador vão em texto puro', () => {
    const u = userData({ telefone: '34998165040' }, { fbc: 'fb.1.1700000000000.abc', fbp: 'fb.1.1700000000000.123', ip: '1.2.3.4', userAgent: 'UA' });
    expect(u.fbc).toBe('fb.1.1700000000000.abc');
    expect(u.fbp).toBe('fb.1.1700000000000.123');
    expect(u.client_ip_address).toBe('1.2.3.4');
    expect(u.client_user_agent).toBe('UA');
  });
});

describe('cookieMeta', () => {
  it('aceita o formato do Meta e recusa o resto', () => {
    expect(cookieMeta('fb.1.1712345678901.IwAR0abc')).toBe('fb.1.1712345678901.IwAR0abc');
    expect(cookieMeta('fb.1.1712345678901.1234567890')).toBe('fb.1.1712345678901.1234567890');
    expect(cookieMeta('qualquer coisa')).toBeNull();
    expect(cookieMeta('<script>')).toBeNull();
    expect(cookieMeta(undefined)).toBeNull();
  });
});

describe('enviarEventoMeta', () => {
  const envAntes = { ...process.env };
  let chamadas: Array<{ url: string; corpo: any }>;
  beforeEach(() => {
    chamadas = [];
    process.env.META_SYSTEM_USER_TOKEN = 'tk-teste';
    delete process.env.META_TEST_EVENT_CODE;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      chamadas.push({ url, corpo: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ events_received: 1 }) } as any;
    }));
  });
  afterEach(() => { process.env = { ...envAntes }; vi.unstubAllGlobals(); });

  it('cada produto vai pro seu pixel', () => {
    expect(pixelDoProduto('solar')).toBe(PIXEL_SOLAR);
    expect(pixelDoProduto('eletroposto')).toBe(PIXEL_ELETROPOSTO);
    expect(PIXEL_SOLAR).not.toBe(PIXEL_ELETROPOSTO);
  });

  it('monta o evento com id, origem, valor em BRL e o pixel do eletroposto', async () => {
    const r = await enviarEventoMeta({
      produto: 'eletroposto', nome: 'ClienteQuente', origem: 'system_generated',
      pessoa: { telefone: '34998165040', nome: 'Ana Souza' }, eventId: 'quente_ag_12', valor: 1500.555,
      dados: { status: 'chave_na_mao' },
    });
    expect(r).toEqual({ ok: true, status: 200, recebidos: 1 });
    expect(chamadas[0].url).toContain(`/${PIXEL_ELETROPOSTO}/events`);
    const ev = chamadas[0].corpo.data[0];
    expect(ev.event_name).toBe('ClienteQuente');
    expect(ev.action_source).toBe('system_generated');
    expect(ev.event_id).toBe('quente_ag_12');
    expect(ev.custom_data).toEqual({ status: 'chave_na_mao', value: 1500.56, currency: 'BRL' });
    expect(chamadas[0].corpo).not.toHaveProperty('test_event_code');
  });

  it('META_TEST_EVENT_CODE manda pra aba de teste', async () => {
    process.env.META_TEST_EVENT_CODE = 'TEST123';
    await enviarEventoMeta({ produto: 'solar', nome: 'Schedule', origem: 'website', pessoa: { telefone: '34998165040' } });
    expect(chamadas[0].corpo.test_event_code).toBe('TEST123');
    expect(chamadas[0].url).toContain(`/${PIXEL_SOLAR}/events`);
  });

  it('sem token ou sem identificador não chama o Meta', async () => {
    delete process.env.META_SYSTEM_USER_TOKEN; delete process.env.META_PIXEL_TOKEN;
    expect((await enviarEventoMeta({ produto: 'solar', nome: 'X', origem: 'website', pessoa: { telefone: '34998165040' } })).erro).toBe('sem_token');
    process.env.META_SYSTEM_USER_TOKEN = 'tk';
    expect((await enviarEventoMeta({ produto: 'solar', nome: 'X', origem: 'website', pessoa: { nome: 'Ana' } })).erro).toBe('sem_identificador');
    expect(chamadas).toHaveLength(0);
  });

  it('erro do Meta ou de rede volta como resultado, nunca lança', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid parameter' } }) })));
    expect(await enviarEventoMeta({ produto: 'solar', nome: 'X', origem: 'website', pessoa: { telefone: '34998165040' } }))
      .toEqual({ ok: false, status: 400, erro: 'Invalid parameter' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    expect(await enviarEventoMeta({ produto: 'solar', nome: 'X', origem: 'website', pessoa: { telefone: '34998165040' } }))
      .toEqual({ ok: false, status: 0, erro: 'timeout' });
  });
});
