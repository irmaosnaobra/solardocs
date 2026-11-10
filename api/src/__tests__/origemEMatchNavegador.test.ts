import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash, webcrypto } from 'crypto';
import vm from 'vm';
import { normFone } from '../utils/metaCapi';

// Carrega dashboard/public/lib/origem.js e meta-am.js num contexto vm com stubs mínimos de navegador.

const LIB = resolve(__dirname, '../../../dashboard/public/lib');
const codigo = (f: string) => readFileSync(resolve(LIB, f), 'utf8');

function navegador(url: string, opts: { cookies?: string; ls?: Record<string, string>; fbq?: boolean } = {}) {
  const jar = new Map<string, string>();
  for (const c of (opts.cookies || '').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = c.indexOf('='); jar.set(c.slice(0, i), c.slice(i + 1));
  }
  const ls = new Map<string, string>(Object.entries(opts.ls || {}));
  const chamadasFbq: unknown[][] = [];
  const u = new URL(url);
  const document: any = {
    referrer: 'https://ref.example/',
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(v: string) { const [par] = v.split(';'); const i = par.indexOf('='); jar.set(par.slice(0, i).trim(), par.slice(i + 1)); },
  };
  const window: any = {
    location: { href: u.href, search: u.search }, document,
    localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); } },
    crypto: webcrypto,
  };
  if (opts.fbq !== false) window.fbq = (...a: unknown[]) => { chamadasFbq.push(a); };
  const ctx: any = vm.createContext({ window, document, TextEncoder, Promise, Date, JSON, encodeURIComponent, decodeURIComponent });
  return {
    jar, ls, chamadasFbq, window,
    rodar: (f: string) => vm.runInContext(codigo(f), ctx),
  };
}

const cookieIoOrig = (jar: Map<string, string>) => JSON.parse(decodeURIComponent(jar.get('io_orig') || '%7B%7D'));

describe('origem.js', () => {
  it('fbclid sem cookie _fbc cria fb.1.<ts>.<fbclid> e grava o cookie _fbc', () => {
    const n = navegador('https://x.test/lp?utm_source=fb&utm_campaign=c1&fbclid=ABC123');
    const antes = Date.now();
    n.rodar('origem.js');
    const fbc = n.jar.get('_fbc')!;
    expect(fbc).toMatch(/^fb\.1\.\d{13}\.ABC123$/);
    expect(Number(fbc.split('.')[2])).toBeGreaterThanOrEqual(antes);
    const e = n.window.ioOrigem.paraEnvio();
    expect(e).toMatchObject({ utm_source: 'fb', utm_campaign: 'c1', fbclid: 'ABC123', fbc, landing_url: 'https://x.test/lp?utm_source=fb&utm_campaign=c1&fbclid=ABC123', referrer: 'https://ref.example/' });
    expect(cookieIoOrig(n.jar).utm_source).toBe('fb');
    expect(JSON.parse(n.ls.get('io_origem')!).fbclid).toBe('ABC123');
  });

  it('cookie _fbc existente vence o fbclid; fbp é lido na hora da consulta', () => {
    const n = navegador('https://x.test/?fbclid=NOVO', { cookies: '_fbc=fb.1.1700000000000.VELHO' });
    n.rodar('origem.js');
    expect(n.window.ioOrigem.get().fbc).toBe('fb.1.1700000000000.VELHO');
    expect(n.window.ioOrigem.paraEnvio().fbp).toBeUndefined();
    n.jar.set('_fbp', 'fb.1.1700000000000.999'); // o pixel cria depois
    expect(n.window.ioOrigem.paraEnvio().fbp).toBe('fb.1.1700000000000.999');
  });

  it('visita sem parâmetro NÃO apaga; visita com parâmetro SUBSTITUI o conjunto', () => {
    const a = navegador('https://x.test/lp?utm_source=fb&utm_medium=cpc&fbclid=ABC123');
    a.rodar('origem.js');
    const guardado = a.jar.get('io_orig')!;
    // volta sem parâmetro, mesmo cookie/localStorage
    const b = navegador('https://x.test/outra', { cookies: `io_orig=${guardado}; _fbc=${a.jar.get('_fbc')}`, ls: { io_origem: a.ls.get('io_origem')! } });
    b.rodar('origem.js');
    expect(b.jar.get('io_orig')).toBe(guardado);
    expect(b.window.ioOrigem.paraEnvio()).toMatchObject({ utm_source: 'fb', utm_medium: 'cpc', fbclid: 'ABC123', landing_url: 'https://x.test/lp?utm_source=fb&utm_medium=cpc&fbclid=ABC123' });
    // só localStorage (cookie apagado) também se mantém
    const c = navegador('https://x.test/outra', { ls: { io_origem: a.ls.get('io_origem')! } });
    c.rodar('origem.js');
    expect(c.window.ioOrigem.get().utm_source).toBe('fb');
    // novo toque substitui por inteiro (utm_medium antigo some)
    const d = navegador('https://x.test/z?utm_source=google', { cookies: `io_orig=${guardado}` });
    d.rodar('origem.js');
    const p = d.window.ioOrigem.paraEnvio();
    expect(p.utm_source).toBe('google');
    expect(p.utm_medium).toBeUndefined();
    expect(p.fbclid).toBeUndefined();
    expect(p.landing_url).toBe('https://x.test/z?utm_source=google');
  });

  it('sem nada guardado e sem parâmetro: objeto vazio, sem erro', () => {
    const n = navegador('https://x.test/');
    n.rodar('origem.js');
    expect(n.window.ioOrigem.paraEnvio()).toEqual({});
    expect(n.jar.has('io_orig')).toBe(false);
  });
});

describe('meta-am.js', () => {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

  it('external_id do telefone = sha256 do telefone normalizado (igual ao normFone/sha256 do servidor)', async () => {
    const n = navegador('https://x.test/');
    n.rodar('meta-am.js');
    const ud = await n.window.ioMatch('824905216831401', { tel: '(34) 99999-0000', email: ' Ana@Ex.COM ', externalId: 'tel' });
    const fone = normFone('(34) 99999-0000')!;
    expect(fone).toBe('5534999990000');
    expect(ud).toEqual({ ph: fone, em: 'ana@ex.com', external_id: sha(fone) });
    expect(n.chamadasFbq).toEqual([['init', '824905216831401', { ph: fone, em: 'ana@ex.com', external_id: sha(fone) }]]);
  });

  it('a regra de telefone é idêntica à do servidor em vários formatos', async () => {
    for (const t of ['34999990000', '+55 34 99999-0000', '5534999990000', '(34) 9999-0000', '123', '4499990000000', '', null]) {
      const n = navegador('https://x.test/');
      n.rodar('meta-am.js');
      const ud = await n.window.ioMatch('1', { tel: t, externalId: 'tel' });
      const esperado = normFone(t);
      if (esperado) expect(ud).toEqual({ ph: esperado, external_id: sha(esperado) });
      else expect(ud).toBeNull();
    }
  });

  it("externalId 'email' usa o sha256 do e-mail normalizado; só manda o que existe", async () => {
    const n = navegador('https://x.test/');
    n.rodar('meta-am.js');
    const ud = await n.window.ioMatch('1', { email: 'Ana@Ex.com', externalId: 'email' });
    expect(ud).toEqual({ em: 'ana@ex.com', external_id: sha('ana@ex.com') });
    expect(n.chamadasFbq[0][2]).not.toHaveProperty('ph');
  });

  it('sem fbq resolve sem fazer nada e nunca rejeita', async () => {
    const n = navegador('https://x.test/', { fbq: false });
    n.rodar('meta-am.js');
    await expect(n.window.ioMatch('1', { tel: '34999990000', externalId: 'tel' })).resolves.toBeNull();
    n.window.fbq = () => { throw new Error('quebrou'); };
    await expect(n.window.ioMatch('1', { tel: '34999990000', externalId: 'tel' })).resolves.toBeNull();
    await expect(n.window.ioMatch(undefined, undefined)).resolves.toBeNull();
  });
});
