import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  // Lido por cspPaginaProposta() quando a rota é montada.
  supabaseUrl: (process.env.SUPABASE_URL = 'https://projetoteste.supabase.co'),
  doc: null as Record<string, unknown> | null,
  company: null as Record<string, unknown> | null,
  eventos: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  contagem: 3,
  contagemDia: 3,
  duplicado: false,
  selects: [] as string[],
  selectNovoComErro: false,
  insertLento: false,
  push: vi.fn(),
  filtrosTipo: [] as Array<[string, unknown]>,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      let porChave = false;
      let desde = false;
      q.select = (cols: string) => { h.selects.push(`${tabela}: ${cols}`); return q; };
      q.eq = (c: string) => { if (c === 'event_data->>chave') porChave = true; return q; };
      q.gte = () => { desde = true; return q; };
      // As consultas de abertura filtram por tipo: só aberta e aberta_vencida (o download do PDF não conta).
      q.in = (c: string, v: unknown) => { h.filtrosTipo.push([c, v]); return q; };
      for (const m of ['order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => {
        if (tabela === 'documents' && h.selectNovoComErro && h.selects[h.selects.length - 1].includes('dados_json')) {
          return { data: null, error: { message: 'column dados_json->>link_rastreado does not exist' } };
        }
        // Select antigo: só as colunas de antes do rastreio.
        if (tabela === 'documents' && h.selectNovoComErro && h.doc) {
          const { id, tipo, arquivo_url, content } = h.doc as Record<string, unknown>;
          return { data: { id, tipo, arquivo_url, content }, error: null };
        }
        return { data: tabela === 'company' ? h.company : h.doc, error: null };
      };
      q.insert = async (linha: Record<string, unknown>) => {
        if (h.insertLento) await new Promise((r) => setTimeout(r, 5000));
        if (h.insertError) return { error: h.insertError };
        h.eventos.push(linha);
        return { error: null };
      };
      // Consultas aguardadas direto: busca por chave (duplicada?), contagem das últimas 24 h e contagem total.
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(porChave
          ? { data: h.duplicado ? [{ id: 'x' }] : [], error: null }
          : { count: desde ? h.contagemDia : h.contagem, data: [], error: null }).then(ok, ko);
      return q;
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  },
}));
vi.mock('../utils/jwt', () => ({
  verifyToken: (t: string) => {
    if (t === 'dono') return { userId: 'user-1' };
    if (t === 'outro') return { userId: 'user-2' };
    throw new Error('invalid');
  },
}));
// Clerk ligado: o login do dono pode vir por ele, como no authMiddleware.
vi.mock('../middleware/clerkAuth', () => ({
  clerkAtivo: true,
  resolverUsuarioDoClerk: async (t: string) => (t === 'clerk-dono' ? 'user-1' : null),
}));
vi.mock('../services/pushUsuario', () => ({ enviarPushAoUsuario: (...a: unknown[]) => h.push(...a) }));

import helmet from 'helmet';
import publicProposta from '../routes/publicProposta';

const app = express();
app.use('/p', publicProposta);

const DOC_ID = 'b1ffc99a-9c0b-4ef8-bb6d-6bb9bd380a22';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WHATSAPP = 'WhatsApp/2.23.20.0 A';
const FUTURO = new Date(Date.now() + 3 * 86400000).toISOString();
const PASSADO = '2026-10-10T23:59:59-03:00';

// A rota pede só algumas chaves do dados_json, com alias (->>): a linha chega achatada, tudo em texto.
function doc(dados: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const t = (v: unknown) => (v === undefined || v === null ? null : String(v));
  return {
    id: DOC_ID, tipo: 'propostaSolar', arquivo_url: null, content: '<html><body>PROPOSTA ORIGINAL</body></html>',
    user_id: 'user-1', created_at: '2026-11-01T12:00:00Z', cliente_nome: 'Maria',
    link_rastreado: t(dados.link_rastreado), link_expira_em: t(dados.link_expira_em), codigo: t(dados.codigo),
    vendedor_nome: t(dados.vendedor_nome), vendedor_whatsapp: t(dados.vendedor_whatsapp), cliente_dados: null,
    ...extra,
  };
}
const rastreada = (expira: string) => ({
  link_rastreado: true, link_expira_em: expira, codigo: '20260001',
  vendedor_nome: 'João', vendedor_whatsapp: '(17) 99680-3659',
});

const abrir = (headers: Record<string, string> = {}) =>
  request(app).get(`/p/${DOC_ID}`).set({ 'User-Agent': IPHONE, ...headers });

beforeEach(() => {
  h.doc = doc(rastreada(FUTURO));
  h.company = { nome: 'CMO LTDA', nome_fantasia: 'CMO Solar', socio_adm: 'Jair', whatsapp: '5517988887777', logo_base64: null, cor_marca: '#0055aa' };
  h.eventos = [];
  h.insertError = null;
  h.contagem = 3;
  h.contagemDia = 3;
  h.duplicado = false;
  h.selects = [];
  h.selectNovoComErro = false;
  h.insertLento = false;
  h.filtrosTipo = [];
  h.push.mockReset();
  h.push.mockResolvedValue({ enviados: 1, removidas: 0 });
});

describe('GET /p/:id: CSP da página pública (imagens do Storage)', () => {
  const diretivas = (cabecalho: string) => Object.fromEntries(
    cabecalho.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [nome, ...resto] = d.split(/\s+/); return [nome, resto.join(' ')]; }),
  ) as Record<string, string>;

  it("img-src ganha o host do Supabase (derivado da env); default-src e script-src seguem 'self'", async () => {
    const res = await abrir();
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    const d = diretivas(csp);
    expect(d['img-src']).toBe("'self' data: https://projetoteste.supabase.co");
    expect(d['default-src']).toBe("'self'");
    expect(d['script-src']).toBe("'self'");
    expect(csp).not.toMatch(/img-src[^;]*\shttps:(\s|;|$)/); // nada de https: genérico
  });

  it('com o helmet do app na frente, só o img-src muda em relação à CSP padrão; as outras rotas ficam como estão', async () => {
    const comHelmet = express();
    comHelmet.use(helmet());
    comHelmet.get('/outra', (_q, r) => { r.send('ok'); });
    comHelmet.use('/p', publicProposta);
    const padrao = diretivas((await request(comHelmet).get('/outra')).headers['content-security-policy'] as string);
    const proposta = diretivas((await request(comHelmet).get(`/p/${DOC_ID}`).set({ 'User-Agent': IPHONE })).headers['content-security-policy'] as string);
    expect(padrao['img-src']).toBe("'self' data:");
    expect(proposta['img-src']).toBe("'self' data: https://projetoteste.supabase.co");
    const { 'img-src': _a, ...restoPadrao } = padrao;
    const { 'img-src': _b, ...restoProposta } = proposta;
    expect(restoProposta).toEqual(restoPadrao);
  });
});

describe('GET /p/:id: abertura não se mistura com download de PDF', () => {
  it('a repetição por aparelho e a contagem do aviso olham só aberta e aberta_vencida', async () => {
    await abrir();
    expect(h.filtrosTipo.length).toBeGreaterThanOrEqual(3); // repetição + contagem total + contagem do dia
    for (const [c, v] of h.filtrosTipo) {
      expect(c).toBe('event_type');
      expect(v).toEqual(['aberta', 'aberta_vencida']);
    }
  });
});

describe('GET /p/:id mostra a assinatura inteira (Completa + Banco)', () => {
  it('CPF e CNPJ saem inteiros no link público, igual ao PDF autenticado', async () => {
    h.doc = doc(rastreada(FUTURO), {
      content: '<html><body>CPF 529.982.247-25 e CNPJ 11.222.333/0001-81 titular 529.982.247-25</body></html>',
    });
    const res = await abrir();
    expect(res.status).toBe(200);
    expect(res.text).toContain('CPF 529.982.247-25');
    expect(res.text).toContain('CNPJ 11.222.333/0001-81');
    expect(res.text).not.toContain('***');
  });
});

describe('GET /p/:id com link rastreado', () => {
  it('aberta: serve a proposta, sem cache, grava o evento e avisa o dono', async () => {
    const res = await abrir({
      'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country-region': 'SP', 'x-vercel-ip-country': 'BR',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('PROPOSTA ORIGINAL');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(h.eventos).toHaveLength(1);
    expect(h.eventos[0]).toEqual({
      user_id: 'user-1', feature: 'proposta_link', event_type: 'aberta',
      event_data: {
        document_id: DOC_ID, codigo: '20260001', cliente: 'Maria', cidade: 'São Paulo', uf: 'SP', pais: 'BR',
        dispositivo: 'Celular', chave: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    // O IP nunca vai puro para o banco.
    expect(JSON.stringify(h.eventos[0])).not.toMatch(/127\.0\.0\.1|::1\b|::ffff/);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith('user-1', expect.objectContaining({
      title: 'Proposta aberta',
      body: 'Maria abriu sua proposta · São Paulo-SP · Celular · 3ª vez',
      url: `/historico?doc=${DOC_ID}`,
    }));
  });

  it('sem cidade o aviso omite esse pedaço', async () => {
    h.contagem = 1;
    await abrir();
    expect(h.push.mock.calls[0][1].body).toBe('Maria abriu sua proposta · Celular · 1ª vez');
  });

  it('robô de prévia (WhatsApp) recebe a proposta mas não conta nem avisa', async () => {
    const res = await abrir({ 'User-Agent': WHATSAPP });
    expect(res.status).toBe(200);
    expect(res.text).toContain('PROPOSTA ORIGINAL');
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('prefetch do navegador não conta', async () => {
    await abrir({ 'Sec-Purpose': 'prefetch' });
    expect(h.eventos).toHaveLength(0);
  });

  it('pede só as chaves do dados_json que usa, nunca o dados_json inteiro', async () => {
    await abrir();
    const doDoc = h.selects.find((x) => x.startsWith('documents: '));
    expect(doDoc).toBeDefined();
    expect(doDoc).toContain('dados_json->>link_rastreado');
    expect(doDoc).toContain('dados_json->>link_expira_em');
    // dados_json só aparece como origem de uma chave (dados_json->>x), nunca solto.
    expect((doDoc as string).replace(/dados_json->>\w+/g, '')).not.toContain('dados_json');
  });

  it('select novo com erro cai no select antigo e serve a proposta como sempre, sem rastrear', async () => {
    h.selectNovoComErro = true;
    const res = await abrir();
    expect(res.status).toBe(200);
    // O corpo é o de sempre; a única diferença é o botão "Baixar PDF" injetado antes do </body>.
    expect(res.text.replace(/<style>\.sd-pdf[\s\S]*?<\/a>/, '')).toBe('<html><body>PROPOSTA ORIGINAL</body></html>');
    expect(res.text).toContain('class="sd-pdf"');
    expect(res.headers['cache-control']).toBe('public, max-age=60, s-maxage=60');
    const doDoc = h.selects.filter((x) => x.startsWith('documents: '));
    expect(doDoc).toHaveLength(2);
    expect(doDoc[1]).toBe('documents: id, tipo, arquivo_url, content');
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('mesmo aparelho na mesma proposta dentro de 10 min conta uma vez: sem evento e sem push', async () => {
    h.duplicado = true;
    const res = await abrir();
    expect(res.status).toBe(200);
    expect(res.text).toContain('PROPOSTA ORIGINAL');
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('a chave é a mesma para o mesmo aparelho e muda com o aparelho', async () => {
    await abrir();
    await abrir();
    await abrir({ 'User-Agent': IPHONE.replace('iPhone OS 17', 'iPhone OS 16') });
    const chaves = h.eventos.map((e) => (e.event_data as { chave: string }).chave);
    expect(chaves[0]).toBe(chaves[1]);
    expect(chaves[2]).not.toBe(chaves[0]);
  });

  it('teto de 30 avisos por proposta em 24 h: o evento grava, o aviso não sai', async () => {
    h.contagemDia = 31;
    await abrir();
    expect(h.eventos).toHaveLength(1);
    expect(h.push).not.toHaveBeenCalled();
    h.contagemDia = 30;
    await abrir({ 'User-Agent': IPHONE + ' outro' });
    expect(h.push).toHaveBeenCalledTimes(1);
  });

  it('o próprio dono (cookie solardoc_token) não conta', async () => {
    const res = await abrir({ Cookie: 'x=1; solardoc_token=dono' });
    expect(res.status).toBe(200);
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('dono logado pelo Clerk (mesmo reconhecimento do authMiddleware) também não conta', async () => {
    const res = await abrir({ Cookie: 'solardoc_token=clerk-dono' });
    expect(res.status).toBe(200);
    expect(h.eventos).toHaveLength(0);
  });

  it('outro usuário logado, ou cookie inválido, conta como cliente', async () => {
    h.contagem = 1;
    await abrir({ Cookie: 'solardoc_token=outro' });
    await abrir({ Cookie: 'solardoc_token=lixo' });
    expect(h.eventos).toHaveLength(2);
  });

  it('documento antigo (sem link_rastreado): serve como hoje, sem evento, e nunca vence', async () => {
    h.doc = doc({ link_expira_em: PASSADO, codigo: '1' });
    const res = await abrir();
    expect(res.status).toBe(200);
    // Idêntico ao que o origin/main servia: o HTML tal como está, mesmo tipo, mesmo cache.
    // O corpo é o de sempre; a única diferença é o botão "Baixar PDF" injetado antes do </body>.
    expect(res.text.replace(/<style>\.sd-pdf[\s\S]*?<\/a>/, '')).toBe('<html><body>PROPOSTA ORIGINAL</body></html>');
    expect(res.text).toContain('class="sd-pdf"');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=60, s-maxage=60');
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('proposta off-grid segue sem rastreio', async () => {
    h.doc = doc(rastreada(FUTURO), { tipo: 'propostaOffGrid' });
    const res = await abrir();
    expect(res.text).toContain('PROPOSTA ORIGINAL');
    expect(h.eventos).toHaveLength(0);
  });

  it('vencida: mostra a página de vencimento, nunca o HTML antigo, e grava aberta_vencida', async () => {
    h.doc = doc(rastreada(PASSADO));
    const res = await abrir();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.text).not.toContain('PROPOSTA ORIGINAL');
    expect(res.text).toContain('Esta proposta venceu em 10/10/2026.');
    expect(res.text).toContain('Fale com João para receber a proposta atualizada.');
    expect(res.text).toContain('https://wa.me/5517996803659?text=');
    expect(res.text).toContain('CMO Solar');
    expect(h.eventos).toHaveLength(1);
    expect(h.eventos[0]).toMatchObject({ feature: 'proposta_link', event_type: 'aberta_vencida' });
    expect(h.push).toHaveBeenCalledWith('user-1', {
      title: 'Proposta vencida aberta',
      body: 'Maria abriu a proposta vencida. Bom momento para ligar.',
      url: `/historico?doc=${DOC_ID}`, tag: `proposta-${DOC_ID}`,
    });
  });

  it('vencida sem telefone do vendedor usa o WhatsApp da empresa', async () => {
    h.doc = doc({ ...rastreada(PASSADO), vendedor_whatsapp: '___', vendedor_nome: '___' });
    const res = await abrir();
    expect(res.text).toContain('https://wa.me/5517988887777?text=');
    expect(res.text).toContain('Fale com Jair');
  });

  it('vencida aberta por robô ou pelo dono: página de vencimento, sem evento', async () => {
    h.doc = doc(rastreada(PASSADO));
    const robo = await abrir({ 'User-Agent': WHATSAPP });
    const dono = await abrir({ Cookie: 'solardoc_token=dono' });
    for (const r of [robo, dono]) {
      expect(r.text).toContain('Esta proposta venceu');
      expect(r.text).not.toContain('PROPOSTA ORIGINAL');
    }
    expect(h.eventos).toHaveLength(0);
  });

  it('push que trava não atrasa a resposta', async () => {
    h.push.mockImplementation(() => new Promise(() => { /* nunca responde */ }));
    const t0 = Date.now();
    const res = await abrir();
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(res.text).toContain('PROPOSTA ORIGINAL');
    expect(h.eventos).toHaveLength(1); // o evento foi gravado antes da resposta
    expect(ms).toBeLessThan(3000);
  });

  it('insert do evento que trava também não passa de ~1,5 s e não manda aviso', async () => {
    h.insertLento = true;
    const t0 = Date.now();
    const res = await abrir();
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(res.text).toContain('PROPOSTA ORIGINAL');
    expect(ms).toBeLessThan(1500);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('falha ao gravar o evento ou ao avisar nunca quebra a página', async () => {
    h.insertError = { message: 'banco fora' };
    const a = await abrir();
    expect(a.status).toBe(200);
    expect(a.text).toContain('PROPOSTA ORIGINAL');
    expect(h.push).not.toHaveBeenCalled();

    h.insertError = null;
    h.push.mockRejectedValue(new Error('push caiu'));
    const b = await abrir();
    expect(b.status).toBe(200);
    expect(b.text).toContain('PROPOSTA ORIGINAL');
  });

  it('proposta inexistente continua 404', async () => {
    h.doc = null;
    const res = await abrir();
    expect(res.status).toBe(404);
  });
});
