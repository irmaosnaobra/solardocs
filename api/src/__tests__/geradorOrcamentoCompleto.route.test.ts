import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rotas públicas do orçamento oficial do /gerador (HTML e PDF). Banco do Gerador, banco da SolarDoc, Storage e Chromium
// simulados; dados inventados. O que se prova: código inválido e proposta ausente dão resposta limpa, link vencido não
// entrega número nenhum, eletroposto não vira este papel, o HTML leva a CSP das imagens do Storage e o botão do PDF, e o
// PDF sai inline com o nome "Orcamento <codigo> - <cliente>.pdf".

const h = vi.hoisted(() => ({
  supabaseUrl: (process.env.SUPABASE_URL = 'https://projetoteste.supabase.co'),
  rpc: { data: null as unknown, error: null as null | { message: string } },
  rpcChamadas: [] as Array<[string, unknown]>,
  company: { data: null as Record<string, unknown> | null, error: null as null | { message: string } },
  companyUserIds: [] as string[],
  fotosChamadas: [] as Array<[string, unknown]>,
  pdfHtml: [] as string[],
  pdfErro: false,
  guardados: new Set<string>(),
  uploads: [] as string[],
  uploadErro: false,
  assinadas: [] as Array<{ path: string; segundos: number; opcoes: unknown }>,
  listados: [] as Array<{ name: string; created_at?: string }>,
  removeFalha: false,
  listas: [] as Array<{ pasta: string; opcoes: unknown }>,
  usuarios: {
    'token-valido': { email: 'nilce@irmaosnaobra.app', email_confirmed_at: '2026-01-01T00:00:00Z' },
    'token-de-fora': { email: 'alguem@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
  } as Record<string, { email: string; email_confirmed_at: string }>,
  removidos: [] as string[][],
  eventos: [] as Array<Record<string, unknown>>,
  eventoLento: false,
  eventoTerminou: false,
  eventoFalha: false,
  limitado: false,
  galeria: [] as Array<{ url: string; legenda?: string }>,
  logs: [] as unknown[][],
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn((...a: unknown[]) => { h.logs.push(a); }),
    warn: vi.fn((...a: unknown[]) => { h.logs.push(a); }),
    info: vi.fn((...a: unknown[]) => { h.logs.push(a); }),
  },
}));
vi.mock('../middleware/rateLimiter', async () => {
  const real = await vi.importActual<typeof import('../middleware/rateLimiter')>('../middleware/rateLimiter');
  return {
    ...real,
    propostaPdfLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
    orcamentoEventoLimiter: (_q: unknown, r: { locals: Record<string, unknown> }, next: () => void) => { if (h.limitado) r.locals.limitado = true; next(); },
  };
});
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    rpc: vi.fn(async (nome: string, args: unknown) => { h.rpcChamadas.push([nome, args]); return { data: h.rpc.data, error: h.rpc.error }; }),
    auth: {
      getUser: vi.fn(async (tok: string) => {
        const u = h.usuarios[tok];
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      }),
    },
  },
}));
vi.mock('../controllers/trackingGeradorController', () => ({
  clientIp: () => '203.0.113.7',
  registrarEventoGerador: vi.fn(async (a: Record<string, unknown>) => {
    h.eventos.push(a);
    if (h.eventoLento) { await new Promise((ok) => setTimeout(ok, 1500)); h.eventoTerminou = true; }
    if (h.eventoFalha) throw new Error('rpc caiu');
    return { ok: true };
  }),
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, segundos: number, opcoes: unknown) => {
          h.assinadas.push({ path, segundos, opcoes });
          return h.guardados.has(path)
            ? { data: { signedUrl: `https://projetoteste.supabase.co/storage/v1/object/sign/documentos/${path}?token=t` }, error: null }
            : { data: null, error: { message: 'Object not found' } };
        },
        upload: async (path: string) => {
          if (h.uploadErro) return { error: { message: 'cheio' } };
          h.uploads.push(path); h.guardados.add(path);
          return { error: null };
        },
        list: async (pasta: string, opcoes: unknown) => { h.listas.push({ pasta, opcoes }); return { data: h.listados, error: null }; },
        remove: async (paths: string[]) => { if (h.removeFalha) throw new Error('remove caiu'); h.removidos.push(paths); return { data: [], error: null }; },
      }),
    },
    from: (tabela: string) => {
      if (tabela !== 'company') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => ({
          eq: (_c: string, v: string) => {
            h.companyUserIds.push(v);
            return { maybeSingle: async () => ({ data: h.company.data, error: h.company.error }) };
          },
        }),
      };
    },
  },
}));
vi.mock('../controllers/portfolioController', () => ({
  renovarUrlsPortfolio: vi.fn(async (userId: string, fields: Record<string, unknown>) => {
    h.fotosChamadas.push([userId, fields]);
    return { ...fields, fotos_obras: h.galeria };
  }),
}));
vi.mock('../controllers/pdfController', () => ({
  gerarPdfDeHtml: vi.fn(async (html: string) => {
    h.pdfHtml.push(html);
    if (h.pdfErro) throw new Error('chromium caiu');
    return Buffer.from('%PDF-1.4 teste');
  }),
}));

import {
  mountOrcamentoCompleto, userIdDaEmpresa, EMPRESA_SOLARDOC_USER_ID_PADRAO, nomeDoPdfOrcamento, PDF_LAYOUT_VERSAO, hashDoOrcamento, caminhoDoPdf, destinoWhatsapp,
} from '../routes/geradorOrcamentoCompleto';

const postar = (url: string) => request(app).post(url).set('Authorization', 'Bearer token-valido');

const r = Router();
mountOrcamentoCompleto(r);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/gerador', r);

const dados = {
  nome: 'Cliente Teste', cidade: 'Uberlândia, MG', telhado: 'Cerâmico',
  item: { n: 6, g: 440, kwp: 3.6, invs: 1 }, tab: { inv: 'SAJ 3K', mod: 'TCL 600W', pot: 600 }, qtdInv: 1, garInv: '10',
  tarifa: 1.09, taxaMin: 95, inflTarifa: 0.06, inflTaxaMin: 0.06, consumoKwh: 500, mediaMensalGerada: 440,
  garPaineis: '25', garEstrutura: '10', garInstalacao: '1', prazoInstalacao: '30', precoVista: 9000, precoOrcamento: 9000,
  parcelasCartao: { 21: 10735 },
  pagOpts: { vista: false, cartao: { ativo: true, parcelas: [21] }, fin: { ativo: false }, entrada: { ativo: false }, custom: '' },
  consultor: 'Nilce', consultorWhats: '5534991516846', validadeDias: 4, expiraEmISO: '2026-11-13T21:00:00.000Z',
};
const empresa = {
  nome: 'Empresa Exemplo LTDA', nome_fantasia: 'Exemplo', cnpj: '12345678000190', socio_adm: 'Maria Souza',
  cor_marca: '#14235B', cidade: 'Uberlândia MG', whatsapp: '34998165040', fotos_obras: [{ path: 'portfolio/u/obra/1.jpg' }],
};

beforeEach(() => {
  h.rpc = { data: [{ codigo: '202600951', dados, created_at: '2026-11-10T12:20:51Z', expirou: false }], error: null };
  h.company = { data: { ...empresa }, error: null };
  h.rpcChamadas.length = 0; h.companyUserIds.length = 0; h.fotosChamadas.length = 0; h.pdfHtml.length = 0; h.pdfErro = false;
  h.guardados.clear(); h.uploads.length = 0; h.uploadErro = false; h.assinadas.length = 0; h.listados = []; h.listas.length = 0; h.removidos.length = 0; h.removeFalha = false;
  h.eventos.length = 0; h.eventoLento = false; h.eventoTerminou = false; h.eventoFalha = false; h.limitado = false;
  h.galeria = []; h.logs.length = 0;
});

describe('GET /gerador/completa/:codigo', () => {
  it('código fora do formato: 400 e nada é lido do banco', async () => {
    for (const c of ['abc', '123', '1234567890123', '2026009%27', '..%2F..']) {
      const res = await request(app).get(`/gerador/completa/${c}`);
      expect(res.status).toBe(400);
    }
    expect(h.rpcChamadas).toHaveLength(0);
  });

  it('proposta que não existe: 404 limpo, em HTML, sem vazar nada', async () => {
    h.rpc.data = [];
    const res = await request(app).get('/gerador/completa/202600999');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('não encontrado');
    expect(h.rpcChamadas[0]).toEqual(['get_proposta_pub', { p_codigo: '202600999' }]);
  });

  const vencida = (extra: Record<string, unknown> = {}) => [{
    codigo: '202600951', created_at: '2026-11-01T00:00:00Z', expirou: true,
    dados: { nome: 'Cliente Teste', consultor: 'Nilce', validadeDias: 4, consultorWhats: '5534991516846', ...extra },
  }];

  it('link vencido: 410 com a página de vencida, o nome da empresa, o botão de WhatsApp, o pixel e nenhum número da proposta', async () => {
    h.rpc.data = vencida();
    const res = await request(app).get('/gerador/completa/202600951');
    expect(res.status).toBe(410);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('venceu');
    expect(res.text).toContain('Exemplo');
    expect(res.text).toContain('href="/orcamento/202600951/w"');
    expect(res.text).toContain('<img src="/orcamento/202600951/o.gif"');
    expect(res.text).toContain('Cliente, sua proposta');
    expect(res.text).not.toMatch(/R\$\s*\d/);
    expect(res.text).not.toContain('wa.me');
  });

  it('vencida sem WhatsApp do consultor usa o da empresa; sem nenhum dos dois, não há botão', async () => {
    h.rpc.data = vencida({ consultorWhats: '' });
    expect((await request(app).get('/gerador/completa/202600951')).text).toContain('/orcamento/202600951/w');
    h.company = { data: { ...empresa, whatsapp: '' }, error: null };
    const sem = await request(app).get('/gerador/completa/202600951');
    expect(sem.status).toBe(410);
    expect(sem.text).not.toContain('/orcamento/202600951/w');
  });

  it('proposta solar antiga, sem o kit gravado: 404 limpo (o /gerador usa o ?p= nela)', async () => {
    const antigo = { ...dados } as Record<string, unknown>;
    delete antigo.item;
    h.rpc.data = [{ codigo: '202600951', dados: antigo, created_at: '2026-11-10T12:00:00Z', expirou: false }];
    expect((await request(app).get('/gerador/completa/202600951')).status).toBe(404);
    expect((await request(app).get('/gerador/completa/202600951/pdf')).status).toBe(404);
  });

  it('eletroposto não vira este papel: 404', async () => {
    h.rpc.data = [{ codigo: '202600951', dados: { ...dados, produto: 'eletroposto' }, created_at: '2026-11-10T12:00:00Z', expirou: false }];
    expect((await request(app).get('/gerador/completa/202600951')).status).toBe(404);
  });

  it('banco do Gerador fora do ar: 503 sem mensagem técnica', async () => {
    h.rpc = { data: null, error: { message: 'DADO-SECRETO-NO-ERRO' } };
    const res = await request(app).get('/gerador/completa/202600951');
    expect(res.status).toBe(503);
    expect(res.text).not.toContain('DADO-SECRETO');
  });

  it('empresa da SolarDoc sumiu: 503', async () => {
    h.company = { data: null, error: null };
    expect((await request(app).get('/gerador/completa/202600951')).status).toBe(503);
  });

  it('proposta válida: HTML do modelo 4, empresa do dono, prévia, botão do PDF e CSP das imagens do Storage', async () => {
    const res = await request(app).get('/gerador/completa/202600951');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['content-security-policy']).toContain('https://projetoteste.supabase.co');
    expect(res.text).toContain('Proposta Comercial');
    // Assinatura Não (padrão): o link do cliente nunca leva folha de aceite.
    expect(res.text).not.toContain('Aceite da proposta');
    expect(res.text).toContain('property="og:title"');
    expect(res.text).toContain('href="/orcamento/202600951/pdf"');
    expect(res.text).toContain('Baixar PDF');
    expect(res.text).toContain('<img src="/orcamento/202600951/o.gif"');
    // O botão do WhatsApp passa pelo redirect rastreado; o wa.me direto não sobra na página do cliente.
    expect(res.text).toContain('<a href="/orcamento/202600951/w" target="_blank"');
    expect(res.text).not.toContain('href="https://wa.me/');
    expect(res.text).not.toContain('undefined');
    expect(h.companyUserIds[0]).toBe(EMPRESA_SOLARDOC_USER_ID_PADRAO);
    expect(h.fotosChamadas[0][0]).toBe(EMPRESA_SOLARDOC_USER_ID_PADRAO);
    expect(h.fotosChamadas[0][1]).toEqual({ fotos_obras: empresa.fotos_obras });
  });
});

describe('GET /gerador/completa/:codigo/pdf', () => {
  it('código inválido: 400 sem abrir o Chromium', async () => {
    expect((await request(app).get('/gerador/completa/xx/pdf')).status).toBe(400);
    expect(h.pdfHtml).toHaveLength(0);
  });

  it('proposta ausente e vencida: 404 e 410, sem Chromium', async () => {
    h.rpc.data = [];
    expect((await request(app).get('/gerador/completa/202600999/pdf')).status).toBe(404);
    h.rpc.data = [{ codigo: '202600951', dados: { nome: 'X' }, created_at: '2026-11-01T00:00:00Z', expirou: true }];
    expect((await request(app).get('/gerador/completa/202600951/pdf')).status).toBe(410);
    expect(h.pdfHtml).toHaveLength(0);
  });

  it('cache-miss: gera, guarda no Storage por hash e responde 302 para a URL assinada com o nome do arquivo', async () => {
    const res = await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/storage/v1/object/sign/documentos/propostas-pdf/gerador/202600951/orcamento-v');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(h.pdfHtml).toHaveLength(1);
    expect(h.pdfHtml[0]).not.toContain('Aceite da proposta');
    // O PDF é o papel puro: sem botão "Baixar PDF" e sem o pixel de abertura.
    expect(h.pdfHtml[0]).not.toContain('Baixar PDF');
    expect(h.pdfHtml[0]).not.toContain('o.gif');
    // No PDF PÚBLICO o botão passa pelo redirect rastreado, com link ABSOLUTO (o PDF vive fora do site).
    expect(h.pdfHtml[0]).toContain('<a href="https://solardoc.app/orcamento/202600951/w"');
    expect(h.pdfHtml[0]).not.toContain('href="https://wa.me/');
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatch(new RegExp(`^propostas-pdf/gerador/202600951/orcamento-v${PDF_LAYOUT_VERSAO}-[0-9a-f]{24}\\.pdf$`));
    const ultima = h.assinadas[h.assinadas.length - 1];
    expect(ultima.segundos).toBe(600);
    expect(ultima.opcoes).toEqual({ download: 'Orcamento 202600951 - Cliente Teste.pdf' });
  });

  it('cache-hit: o segundo pedido não abre o Chromium nem grava de novo', async () => {
    await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    const res = await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(res.status).toBe(302);
    expect(h.pdfHtml).toHaveLength(1);
    expect(h.uploads).toHaveLength(1);
  });

  it('editou a proposta: o hash muda e o PDF é gerado de novo; versões antigas saem do bucket', async () => {
    await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    const antigo = h.uploads[0];
    h.listados = [{ name: antigo.split('/').pop() as string }, { name: 'outro.txt' }];
    h.rpc.data = [{ codigo: '202600951', dados: { ...dados, precoOrcamento: 9500 }, created_at: '2026-11-10T12:20:51Z', expirou: false }];
    const res = await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(res.status).toBe(302);
    expect(h.pdfHtml).toHaveLength(2);
    expect(h.uploads).toHaveLength(2);
    expect(h.uploads[1]).not.toBe(antigo);
    expect(h.removidos[0]).toEqual([antigo]);
  });

  it('limpeza: aguarda o remove e nunca apaga o arquivo da chave recém-gravada', async () => {
    await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    const atual = h.uploads[0].split('/').pop() as string;
    h.guardados.clear();
    h.listados = [{ name: atual }, { name: 'orcamento-v0-aaaa.pdf' }, { name: 'foto.jpg' }];
    const res = await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(res.status).toBe(302);
    expect(h.removidos).toEqual([['propostas-pdf/gerador/202600951/orcamento-v0-aaaa.pdf']]);
  });

  it('hash e caminho: mudam com os dados, com a empresa e com a versão do desenho', () => {
    const base = { dados, company: { ...empresa } };
    const h0 = hashDoOrcamento(base);
    expect(hashDoOrcamento({ dados, company: { ...empresa } })).toBe(h0);
    expect(hashDoOrcamento({ dados: { ...dados, nome: 'Outro' }, company: empresa })).not.toBe(h0);
    expect(hashDoOrcamento({ dados, company: { ...empresa, cor_marca: '#000000' } })).not.toBe(h0);
    expect(hashDoOrcamento(base, PDF_LAYOUT_VERSAO + 1)).not.toBe(h0);
    expect(caminhoDoPdf('202600951', h0).caminho).toBe(`propostas-pdf/gerador/202600951/orcamento-v${PDF_LAYOUT_VERSAO}-${h0}.pdf`);
  });

  it('falha ao guardar: devolve o PDF direto, inline, como antes', async () => {
    h.uploadErro = true;
    const res = await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="Orcamento 202600951 - Cliente Teste.pdf"');
    expect(res.body.toString()).toContain('%PDF');
    expect(h.pdfHtml).toHaveLength(1);
  });

  it('HEAD não abre o Chromium nem grava', async () => {
    const res = await request(app).head('/gerador/completa/202600951/pdf');
    expect(res.status).toBe(200);
    expect(h.pdfHtml).toHaveLength(0);
    expect(h.uploads).toHaveLength(0);
  });

  it('Chromium falha: 500 limpo', async () => {
    h.pdfErro = true;
    const res = await request(app).get('/gerador/completa/202600951/pdf');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('chromium caiu');
  });
});

describe('POST /gerador/completa/:codigo/pdf-assinado', () => {
  const CPF = '529.982.247-25';
  const URL = '/gerador/completa/202600951/pdf-assinado';
  const ok = { nome: 'Cliente Teste da Silva', documento: CPF };

  it('exige login de consultor: sem token, token da chave publishable ou inválido = 401; conta fora do domínio = 403; sem Chromium nem leitura', async () => {
    expect((await request(app).post(URL).send(ok)).status).toBe(401);
    expect((await request(app).post(URL).set('Authorization', 'Bearer sb_publishable_xxx').send(ok)).status).toBe(401);
    expect((await request(app).post(URL).set('Authorization', 'Bearer token-qualquer').send(ok)).status).toBe(401);
    expect((await request(app).post(URL).set('Authorization', 'Bearer token-de-fora').send(ok)).status).toBe(403);
    expect(h.rpcChamadas).toHaveLength(0);
    expect(h.pdfHtml).toHaveLength(0);
    expect(h.uploads).toHaveLength(0);
  });

  it('com token válido de consultor: segue e gera', async () => {
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido').send(ok);
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
  });
  const semCpf = (x: unknown) => JSON.stringify(x);

  it('código inválido: 400, sem ler o banco nem abrir o Chromium', async () => {
    const res = await postar('/gerador/completa/xx/pdf-assinado').send(ok);
    expect(res.status).toBe(400);
    expect(h.rpcChamadas).toHaveLength(0);
    expect(h.pdfHtml).toHaveLength(0);
  });

  it('documento inválido (ausente, dígito errado, repetido): 400 e nada é lido nem gerado', async () => {
    for (const documento of [undefined, '', '529.982.247-26', '111.111.111-11', '123', 'abc', 12345678909]) {
      const res = await postar(URL).send({ nome: ok.nome, documento });
      expect(res.status).toBe(400);
      expect(res.body.erro).toMatch(/CPF ou CNPJ/);
    }
    expect(h.rpcChamadas).toHaveLength(0);
    expect(h.pdfHtml).toHaveLength(0);
  });

  it('nome vazio, de 1 letra ou com mais de 120: 400', async () => {
    for (const nome of [undefined, '', '   ', 'A', 'x'.repeat(121), 42]) {
      const res = await postar(URL).send({ nome, documento: CPF });
      expect(res.status).toBe(400);
    }
    expect((await postar(URL).send({ nome: 'Jo', documento: CPF })).status).toBe(200);
    expect((await postar(URL).send({ nome: 'x'.repeat(120), documento: CPF })).status).toBe(200);
    expect((await postar(URL)).status).toBe(400);
  });

  it('proposta vencida: 410; sem papel oficial (eletroposto): 404; sem Chromium', async () => {
    h.rpc.data = [{ codigo: '202600951', dados: { nome: 'X' }, created_at: '2026-11-01T00:00:00Z', expirou: true }];
    expect((await postar(URL).send(ok)).status).toBe(410);
    h.rpc.data = [{ codigo: '202600951', dados: { ...dados, produto: 'eletroposto' }, created_at: '2026-11-10T12:20:51Z', expirou: false }];
    expect((await postar(URL).send(ok)).status).toBe(404);
    h.rpc.data = [];
    expect((await postar(URL).send(ok)).status).toBe(404);
    expect(h.pdfHtml).toHaveLength(0);
  });

  it('sucesso: gera o PDF COM a folha de aceite, grava na pasta plana gerador-assinado/<codigo>-<uuid>.pdf e responde { url } de 600 s', async () => {
    const res = await postar(URL).send(ok);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Object.keys(res.body)).toEqual(['url']);
    expect(res.body.url).toMatch(/^https:\/\/projetoteste\.supabase\.co\/storage\/v1\/object\/sign\/documentos\/propostas-pdf\/gerador-assinado\/202600951-[0-9a-f-]{36}\.pdf\?token=/);
    // O papel leva a folha de aceite, com o nome e o CPF do cliente.
    expect(h.pdfHtml).toHaveLength(1);
    expect(h.pdfHtml[0]).toContain('Aceite da proposta');
    expect(h.pdfHtml[0]).toContain('Cliente Teste da Silva');
    expect(h.pdfHtml[0]).toContain('529.982.247-25');
    expect(h.pdfHtml[0]).toContain('Maria Souza');
    // O PDF assinado (o do consultor, para o banco) mantém o wa.me direto.
    expect(h.pdfHtml[0]).toContain('href="https://wa.me/5534991516846');
    expect(h.pdfHtml[0]).not.toContain('/orcamento/202600951/w');
    expect(h.pdfHtml[0]).not.toContain('Baixar PDF');
    expect(h.pdfHtml[0]).not.toContain('o.gif');
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatch(/^propostas-pdf\/gerador-assinado\/202600951-[0-9a-f-]{36}\.pdf$/);
    expect(h.uploads[0]).not.toContain('52998224725');
    const ultima = h.assinadas[h.assinadas.length - 1];
    expect(ultima.segundos).toBe(600);
    expect(ultima.opcoes).toEqual({ download: 'Orcamento 202600951 - Cliente Teste da Silva.pdf' });
  });

  it('limpeza: a cada POST apaga (aguardado) os do mesmo código e os de mais de 1 dia; os de outro código e novos ficam', async () => {
    const agora = Date.now();
    const horas = (n: number) => new Date(agora - n * 3600_000).toISOString();
    h.listados = [
      { name: '202600951-aaaa.pdf', created_at: horas(2) },    // mesmo código, recente: sai
      { name: '202600777-bbbb.pdf', created_at: horas(30) },   // outro código, de ontem: sai pela idade
      { name: '202600888-cccc.pdf', created_at: horas(3) },    // outro código, recente: fica
      { name: '202600666-dddd.pdf' },                          // sem data: fica
      { name: 'foto.jpg', created_at: horas(90) },             // não é PDF: fica
    ];
    const res = await postar(URL).send(ok);
    expect(res.status).toBe(200);
    expect(h.listas.every((l) => l.pasta === 'propostas-pdf/gerador-assinado')).toBe(true);
    expect(h.listas[0].opcoes).toMatchObject({ limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
    expect(h.removidos).toHaveLength(1);
    expect([...h.removidos[0]].sort()).toEqual([
      'propostas-pdf/gerador-assinado/202600777-bbbb.pdf',
      'propostas-pdf/gerador-assinado/202600951-aaaa.pdf',
    ]);
    // a limpeza vem ANTES da gravação do novo
    expect(h.uploads).toHaveLength(1);
  });

  it('falha na limpeza não derruba o POST', async () => {
    h.listados = [{ name: '202600951-aaaa.pdf', created_at: new Date().toISOString() }];
    h.removeFalha = true;
    const res = await postar(URL).send(ok);
    expect(res.status).toBe(200);
  });

  it('o nome do arquivo é sorteado a cada pedido (o cache do GET não serve PDF assinado)', async () => {
    await postar(URL).send(ok);
    await postar(URL).send(ok);
    expect(h.uploads).toHaveLength(2);
    expect(h.uploads[0]).not.toBe(h.uploads[1]);
    expect(h.pdfHtml).toHaveLength(2);
  });

  it('CNPJ: a folha sai como pessoa jurídica', async () => {
    const res = await postar(URL).send({ nome: 'Mercado Exemplo LTDA', documento: '11222333000181' });
    expect(res.status).toBe(200);
    expect(h.pdfHtml[0]).toContain('11.222.333/0001-81');
  });

  it('o GET do PDF depois de um POST assinado continua sem folha de aceite e sem o CPF', async () => {
    await postar(URL).send(ok);
    await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(h.pdfHtml).toHaveLength(2);
    expect(h.pdfHtml[1]).not.toContain('Aceite da proposta');
    expect(h.pdfHtml[1]).not.toContain('529.982.247-25');
    const pagina = await request(app).get('/gerador/completa/202600951');
    expect(pagina.text).not.toContain('Cliente Teste da Silva');
    expect(pagina.text).not.toContain('529.982.247');
  });

  it('upload falha: 502 com mensagem clara, sem PDF inline', async () => {
    h.uploadErro = true;
    const res = await postar(URL).send(ok);
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.erro).toMatch(/guardar o PDF/);
    expect(res.body.url).toBeUndefined();
    expect(res.text).not.toContain('%PDF');
  });

  it('Chromium falha: 500 limpo e sem eco do erro', async () => {
    h.pdfErro = true;
    const res = await postar(URL).send(ok);
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('chromium caiu');
  });

  it('nada de nome nem de CPF em log, nem na leitura da proposta, nem nas fotos', async () => {
    await postar(URL).send(ok);
    h.uploadErro = true;
    await postar(URL).send(ok);
    h.uploadErro = false; h.pdfErro = true;
    await postar(URL).send(ok);
    expect(h.logs.length).toBeGreaterThan(0);
    for (const alvo of [h.logs, h.rpcChamadas, h.fotosChamadas, h.companyUserIds, h.eventos]) {
      const t = semCpf(alvo);
      expect(t).not.toContain('52998224725');
      expect(t).not.toContain('529.982.247-25');
      expect(t).not.toContain('Cliente Teste da Silva');
    }
  });
});

describe('aviso do PDF: click_pdf pelo GET /pdf de cliente', () => {
  const PDF = '/gerador/completa/202600951/pdf';
  const CEL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

  it('cache-miss e cache-hit de cliente registram click_pdf COM aviso', async () => {
    await request(app).get(PDF).set('User-Agent', CEL_UA).redirects(0);   // miss: gera e guarda
    await request(app).get(PDF).set('User-Agent', CEL_UA).redirects(0);   // hit: só assina
    expect(h.pdfHtml).toHaveLength(1);
    expect(h.eventos).toHaveLength(2);
    for (const e of h.eventos) expect(e).toMatchObject({ codigo: '202600951', evento: 'click_pdf', avisarPdf: true, userAgent: CEL_UA });
  });

  it('falha ao guardar (PDF inline): também registra e avisa uma vez', async () => {
    h.uploadErro = true;
    const res = await request(app).get(PDF).set('User-Agent', CEL_UA).redirects(0);
    expect(res.status).toBe(200);
    expect(h.eventos).toHaveLength(1);
    expect(h.eventos[0]).toMatchObject({ evento: 'click_pdf', avisarPdf: true });
  });

  it('robô de prévia, UA vazio, prefetch, HEAD, consultor logado e IP acima do limite: serve o PDF e não registra', async () => {
    await request(app).get(PDF).set('User-Agent', 'WhatsApp/2.23.20.0').redirects(0);
    await request(app).get(PDF).set('User-Agent', '').redirects(0);
    await request(app).get(PDF).set('User-Agent', CEL_UA).set('Sec-Purpose', 'prefetch').redirects(0);
    await request(app).head(PDF).set('User-Agent', CEL_UA);
    await request(app).get(PDF).set('User-Agent', CEL_UA).set('Cookie', 'x=1; gerador_consultor=1').redirects(0);
    h.limitado = true;
    const res = await request(app).get(PDF).set('User-Agent', CEL_UA).redirects(0);
    expect(res.status).toBe(302);
    expect(h.eventos).toHaveLength(0);
  });

  it('o POST do PDF assinado (consultor) não registra nem avisa', async () => {
    const res = await postar('/gerador/completa/202600951/pdf-assinado').set('User-Agent', CEL_UA).send({ nome: 'Cliente Teste da Silva', documento: '529.982.247-25' });
    expect(res.status).toBe(200);
    expect(h.eventos).toHaveLength(0);
  });

  it('proposta ausente, vencida ou código inválido: nada registrado', async () => {
    h.rpc.data = [];
    await request(app).get(PDF).set('User-Agent', CEL_UA).redirects(0);
    h.rpc.data = [{ codigo: '202600951', dados: { nome: 'X' }, created_at: '2026-11-01T00:00:00Z', expirou: true }];
    await request(app).get(PDF).set('User-Agent', CEL_UA).redirects(0);
    await request(app).get('/gerador/completa/xx/pdf').set('User-Agent', CEL_UA).redirects(0);
    expect(h.eventos).toHaveLength(0);
  });

  it('o PDF muda (link /w absoluto): o cache de versão antiga não vale', () => {
    expect(PDF_LAYOUT_VERSAO).toBeGreaterThanOrEqual(2);
  });
});

describe('fotos de obra no papel', () => {
  const g = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://projetoteste.supabase.co/storage/v1/object/sign/documentos/portfolio/u/obra/${i + 1}.jpg?token=t`, legenda: '' }));

  it('galeria de 12: as 10 primeiras, na ordem, e as 2 fixas do site no fim', async () => {
    h.galeria = g(12);
    await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    const x = h.pdfHtml[0];
    expect(x.match(/<div class="ob">/g)).toHaveLength(12);
    const pos = (n: number) => x.indexOf(`/obra/${n}.jpg`);
    for (let i = 1; i < 10; i++) expect(pos(i)).toBeGreaterThan(0), expect(pos(i + 1)).toBeGreaterThan(pos(i));
    expect(pos(11)).toBe(-1);
    expect(pos(12)).toBe(-1);
    const fixa = x.indexOf('data:image/webp;base64,');
    expect(fixa).toBeGreaterThan(pos(10));
    expect(x.match(/data:image\/webp;base64,/g)).toHaveLength(2);
    expect(x).not.toContain('<div class="cap"');
  });

  it('galeria de 4: as 4 + as 2 fixas (6, uma fileira completa)', async () => {
    h.galeria = g(4);
    await request(app).get('/gerador/completa/202600951/pdf').redirects(0);
    expect(h.pdfHtml[0].match(/<div class="ob">/g)).toHaveLength(6);
  });
});

describe('rastreio: pixel (o.gif) e redirect do WhatsApp (w)', () => {
  const CEL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const gif = (res: { status: number; headers: Record<string, unknown> }) => {
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.headers['cache-control']).toBe('no-store');
  };
  const pixel = (extra?: (r: request.Test) => request.Test, cod = '202600951') => {
    const r = request(app).get(`/gerador/completa/${cod}/o.gif`).set('User-Agent', CEL);
    return extra ? extra(r) : r;
  };
  const venc = () => [{ codigo: '202600951', created_at: '2026-11-01T00:00:00Z', expirou: true, dados: { nome: 'Cliente Teste', consultor: 'Nilce', consultorWhats: '5534991516846' } }];

  it('pixel, proposta válida: gif e "abertura" pela mesma função do /track', async () => {
    gif(await pixel());
    expect(h.eventos).toEqual([{ codigo: '202600951', evento: 'abertura', ip: '203.0.113.7', userAgent: CEL }]);
  });

  it('pixel, proposta vencida: registra só "abertura_expirada"', async () => {
    h.rpc.data = venc();
    gif(await pixel());
    expect(h.eventos.map((e) => e.evento)).toEqual(['abertura_expirada']);
  });

  it('pixel, proposta que não existe, eletroposto ou solar antigo sem kit: gif e nada registrado', async () => {
    h.rpc.data = [];
    gif(await pixel());
    h.rpc.data = [{ codigo: '202600951', dados: { ...dados, produto: 'eletroposto' }, created_at: '2026-11-10T12:00:00Z', expirou: false }];
    gif(await pixel());
    const antigo = { ...dados } as Record<string, unknown>;
    delete antigo.item;
    h.rpc.data = [{ codigo: '202600951', dados: antigo, created_at: '2026-11-10T12:00:00Z', expirou: false }];
    gif(await pixel());
    h.rpc = { data: null, error: { message: 'caiu' } };
    gif(await pixel());
    gif(await pixel(undefined, 'abc'));
    expect(h.eventos).toHaveLength(0);
  });

  it('robô de prévia, UA vazio, prefetch, HEAD, consultor logado e IP acima do limite: gif e nada registrado', async () => {
    gif(await request(app).get('/gerador/completa/202600951/o.gif').set('User-Agent', 'WhatsApp/2.23.20.0'));
    gif(await request(app).get('/gerador/completa/202600951/o.gif').set('User-Agent', ''));
    gif(await pixel((r) => r.set('Sec-Purpose', 'prefetch')));
    expect((await request(app).head('/gerador/completa/202600951/o.gif').set('User-Agent', CEL)).status).toBe(200);
    gif(await pixel((r) => r.set('Cookie', 'x=1; gerador_consultor=1; y=2')));
    gif(await pixel((r) => r.set('Cookie', 'gerador_consultor=1')));
    h.limitado = true;
    gif(await pixel());
    expect(h.eventos).toHaveLength(0);
    // Cookie de outro nome ou com outro valor não vale como consultor.
    h.limitado = false;
    gif(await pixel((r) => r.set('Cookie', 'outro_gerador_consultor=1; gerador_consultor=0')));
    expect(h.eventos).toHaveLength(1);
  });

  it('registro que falha: gif do mesmo jeito', async () => {
    h.eventoFalha = true;
    gif(await pixel());
    expect(h.eventos).toHaveLength(1);
  });

  it('registro lento: a resposta espera o registro inteiro (serverless congela depois de responder)', async () => {
    h.eventoLento = true;
    gif(await pixel());
    expect(h.eventoTerminou).toBe(true);
  });

  it('w, proposta válida: 302 para o wa.me do consultor e registra "click_wpp_cta"', async () => {
    const res = await request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://wa.me/5534991516846?text=${encodeURIComponent('Olá Nilce! Quero fechar a proposta de Cliente Teste.')}`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(h.eventos.map((e) => e.evento)).toEqual(['click_wpp_cta']);
  });

  it('w, proposta vencida: 302 e "click_wpp_expirado"', async () => {
    h.rpc.data = venc();
    const res = await request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/wa\.me\/5534991516846\?text=/);
    expect(h.eventos.map((e) => e.evento)).toEqual(['click_wpp_expirado']);
  });

  it('w nunca vira open redirect: o destino não vem da query', async () => {
    const res = await request(app).get('/gerador/completa/202600951/w?u=https://evil.example&url=//evil.example&to=x').set('User-Agent', CEL).redirects(0);
    expect(res.headers.location).toMatch(/^https:\/\/wa\.me\/5534991516846\?text=/);
    expect(res.headers.location).not.toContain('evil');
  });

  it('w sem WhatsApp na proposta usa o da empresa; sem nenhum dos dois, 404', async () => {
    h.rpc.data = [{ codigo: '202600951', dados: { ...dados, consultorWhats: '' }, created_at: '2026-11-10T12:00:00Z', expirou: false }];
    const res = await request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).redirects(0);
    expect(res.headers.location).toMatch(/^https:\/\/wa\.me\/5534998165040\?text=/);
    h.company = { data: { ...empresa, whatsapp: '' }, error: null };
    expect((await request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).redirects(0)).status).toBe(404);
  });

  it('w, robô, HEAD, prefetch, consultor logado e IP acima do limite: redireciona e não registra', async () => {
    const vai = async (r: request.Test) => { const x = await r.redirects(0); expect(x.status).toBe(302); };
    await vai(request(app).get('/gerador/completa/202600951/w').set('User-Agent', 'WhatsApp/2.23.20.0'));
    await vai(request(app).head('/gerador/completa/202600951/w').set('User-Agent', CEL));
    await vai(request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).set('Sec-Purpose', 'prefetch'));
    await vai(request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).set('Cookie', 'gerador_consultor=1'));
    h.limitado = true;
    await vai(request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL));
    expect(h.eventos).toHaveLength(0);
  });

  it('w, código inválido, proposta ausente, eletroposto: nada registrado e nada de redirect', async () => {
    expect((await request(app).get('/gerador/completa/abc/w').set('User-Agent', CEL).redirects(0)).status).toBe(400);
    h.rpc.data = [];
    expect((await request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).redirects(0)).status).toBe(404);
    h.rpc.data = [{ codigo: '202600951', dados: { ...dados, produto: 'eletroposto' }, created_at: '2026-11-10T12:00:00Z', expirou: false }];
    expect((await request(app).get('/gerador/completa/202600951/w').set('User-Agent', CEL).redirects(0)).status).toBe(404);
    expect(h.eventos).toHaveLength(0);
  });

  it('destinoWhatsapp: prefixo 55, mínimo de 10 dígitos e texto codificado', () => {
    expect(destinoWhatsapp({ telefone: '(34) 99151-6846', consultor: 'Ana', cliente: 'Zé', vencida: false }))
      .toBe(`https://wa.me/5534991516846?text=${encodeURIComponent('Olá Ana! Quero fechar a proposta de Zé.')}`);
    expect(destinoWhatsapp({ telefone: '5534991516846', consultor: '', cliente: '', vencida: false })).toMatch(/^https:\/\/wa\.me\/5534991516846\?/);
    expect(destinoWhatsapp({ telefone: '99151', consultor: '', cliente: '', vencida: false })).toBeNull();
    expect(destinoWhatsapp({ telefone: null, consultor: '', cliente: '', vencida: true })).toBeNull();
  });
});

describe('pequenos', () => {
  it('user_id da empresa: padrão, override por env e valor torto ignorado', () => {
    const outro = '11111111-2222-3333-4444-555555555555';
    expect(userIdDaEmpresa({})).toBe(EMPRESA_SOLARDOC_USER_ID_PADRAO);
    expect(userIdDaEmpresa({ GERADOR_EMPRESA_SOLARDOC_USER_ID: outro } as never)).toBe(outro);
    expect(userIdDaEmpresa({ GERADOR_EMPRESA_SOLARDOC_USER_ID: 'x or 1=1' } as never)).toBe(EMPRESA_SOLARDOC_USER_ID_PADRAO);
  });
  it('nome do PDF só com ASCII', () => {
    expect(nomeDoPdfOrcamento('202600951', 'José Ação Ç Silva')).toBe('Orcamento 202600951 - Jose Acao C Silva.pdf');
    expect(nomeDoPdfOrcamento('202600951', '')).toBe('Orcamento 202600951.pdf');
  });
});
