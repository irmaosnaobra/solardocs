import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// PDF da proposta no link público: GET /p/:id/pdf e o botão "Baixar PDF" injetado na página.
const h = vi.hoisted(() => ({
  doc: null as Record<string, unknown> | null,
  arquivos: new Set<string>(), // caminhos que já estão no bucket (o cache)
  listados: [] as string[],
  enviados: [] as Array<{ caminho: string; opcoes: unknown }>,
  removidos: [] as string[][],
  assinaturas: [] as Array<{ caminho: string; opcoes: unknown }>,
  eventos: [] as Record<string, unknown>[],
  filtros: [] as Array<[string, unknown]>,
  insertErro: false,
  push: vi.fn(),
  gerar: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      let porChave: string | null = null;
      let tipo: string | null = null;
      q.select = () => q;
      q.eq = (c: string, v: unknown) => {
        h.filtros.push([`${tabela}.${c}`, v]);
        if (c === 'event_data->>chave') porChave = String(v);
        if (c === 'event_type') tipo = String(v);
        return q;
      };
      q.in = (c: string, v: unknown) => { h.filtros.push([`${tabela}.${c}`, v]); return q; };
      q.gte = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: tabela === 'company' ? { user_id: 'user-1' } : h.doc, error: null });
      q.insert = async (linha: Record<string, unknown>) => {
        if (h.insertErro) return { error: { message: 'falhou' } };
        h.eventos.push(linha);
        return { error: null };
      };
      // Consultas aguardadas direto: repetição por chave (mesmo tipo) e contagem do teto diário.
      q.then = (ok: (v: unknown) => unknown) => {
        const repetido = porChave
          ? h.eventos.filter((e) => (!tipo || e.event_type === tipo) && (e.event_data as { chave?: string }).chave === porChave)
          : [];
        return Promise.resolve({ count: 0, data: repetido.length ? [{ id: 'x' }] : [], error: null }).then(ok);
      };
      return q;
    },
    storage: {
      from: () => ({
        list: async (prefixo: string) => { h.listados.push(prefixo); return { data: Array.from(h.arquivos).filter((c) => c.startsWith(prefixo + '/')).map((c) => ({ name: c.split('/').pop() })), error: null }; },
        upload: async (caminho: string, _buf: unknown, opcoes: unknown) => { h.enviados.push({ caminho, opcoes }); h.arquivos.add(caminho); return { error: null }; },
        remove: async (lista: string[]) => { h.removidos.push(lista); return { error: null }; },
        // Objeto que não existe: a assinatura falha, como no Storage de verdade.
        createSignedUrl: async (caminho: string, _ttl: number, opcoes: unknown) => {
          h.assinaturas.push({ caminho, opcoes });
          return h.arquivos.has(caminho)
            ? { data: { signedUrl: `https://storage.test/assinada/${caminho}` }, error: null }
            : { data: null, error: { message: 'Object not found' } };
        },
      }),
    },
  },
}));
vi.mock('../utils/jwt', () => ({
  verifyToken: (t: string) => {
    if (t === 'dono') return { userId: 'user-1' };
    throw new Error('invalid');
  },
}));
vi.mock('../middleware/clerkAuth', () => ({ clerkAtivo: false, resolverUsuarioDoClerk: async () => null }));
vi.mock('../services/pushUsuario', () => ({ enviarPushAoUsuario: (...a: unknown[]) => h.push(...a) }));
vi.mock('../controllers/pdfController', () => ({ gerarPdfDeHtml: (...a: unknown[]) => h.gerar(...a) }));
vi.mock('../middleware/rateLimiter', () => ({ propostaPdfLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));

import publicProposta, { comBotaoPdf } from '../routes/publicProposta';

const app = express();
app.use('/p', publicProposta);

const DOC_ID = 'b1ffc99a-9c0b-4ef8-bb6d-6bb9bd380a22';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const FUTURO = new Date(Date.now() + 3 * 86400000).toISOString();
const HTML = '<html><body>PROPOSTA CPF 529.982.247-25 CNPJ 11.222.333/0001-81</body></html>';

function doc(extra: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, tipo: 'propostaSolar', arquivo_url: null, content: HTML, user_id: 'user-1', created_at: '2026-11-01T12:00:00Z',
    cliente_nome: 'Maria Aparecida Souza', link_rastreado: 'true', link_expira_em: FUTURO, codigo: '20260051',
    vendedor_nome: 'João', vendedor_whatsapp: '17996803659', cliente_dados: null, ...extra,
  };
}
const baixar = (id = DOC_ID, headers: Record<string, string> = {}) => request(app).get(`/p/${id}/pdf`).set({ 'User-Agent': IPHONE, ...headers }).redirects(0);

beforeEach(() => {
  h.doc = doc();
  h.arquivos = new Set(); h.listados = []; h.enviados = []; h.removidos = []; h.assinaturas = []; h.eventos = []; h.filtros = []; h.insertErro = false;
  h.push.mockReset().mockResolvedValue({ enviados: 1, removidos: 0 });
  h.gerar.mockReset().mockResolvedValue(Buffer.from('%PDF-1.4 falso'));
});

describe('GET /p/:id/pdf', () => {
  it('gera o PDF do HTML do link (CPF inteiro), guarda no bucket e entrega com o nome "Proposta {codigo} {cliente}.pdf"', async () => {
    const res = await baixar();
    expect(res.status).toBe(302);
    expect(h.gerar).toHaveBeenCalledTimes(1);
    const htmlGerador = String(h.gerar.mock.calls[0][0]);
    // O PDF público leva o mesmo HTML do link, com o CPF e o CNPJ inteiros (igual ao PDF autenticado).
    expect(htmlGerador).toContain('CPF 529.982.247-25');
    expect(htmlGerador).not.toContain('***');
    expect(htmlGerador).toContain('CNPJ 11.222.333/0001-81');
    expect(htmlGerador).not.toContain('Baixar PDF'); // o botão não vai para dentro do PDF
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0].opcoes).toMatchObject({ contentType: 'application/pdf' });
    expect(res.headers.location).toBe(`https://storage.test/assinada/${h.enviados[0].caminho}`);
    expect(h.assinaturas[h.assinaturas.length - 1].opcoes).toEqual({ download: 'Proposta 20260051 Maria Aparecida Souza.pdf' });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('o caminho no Storage não expõe id de usuário nem de documento', async () => {
    await baixar();
    const caminho = h.enviados[0].caminho;
    expect(caminho).toMatch(/^propostas-pdf\/[0-9a-f]{24}\/proposta-[0-9a-f]{24}\.pdf$/);
    expect(caminho).not.toContain('user-1');
    expect(caminho).not.toContain(DOC_ID);
  });

  it('cache sem list(): a segunda chamada assina direto o caminho esperado e o gerador não roda de novo', async () => {
    await baixar();
    expect(h.listados).toHaveLength(1); // só a limpeza de versões antigas, no momento de gerar
    h.listados = [];
    const res = await baixar();
    expect(res.status).toBe(302);
    expect(h.gerar).toHaveBeenCalledTimes(1);
    expect(h.enviados).toHaveLength(1);
    expect(h.listados).toHaveLength(0);
  });

  it('proposta reeditada (conteúdo novo): gera de novo e a versão antiga sai do bucket', async () => {
    await baixar();
    const antigo = h.enviados[0].caminho;
    h.doc = doc({ content: HTML.replace('PROPOSTA', 'PROPOSTA EDITADA') });
    await baixar();
    expect(h.gerar).toHaveBeenCalledTimes(2);
    expect(h.removidos).toEqual([[antigo]]);
    expect(h.enviados[1].caminho).not.toBe(antigo);
  });

  it('HEAD responde sem gerar PDF, sem ler o HTML e sem gravar evento', async () => {
    const res = await request(app).head(`/p/${DOC_ID}/pdf`).set({ 'User-Agent': IPHONE });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(h.gerar).not.toHaveBeenCalled();
    expect(h.enviados).toHaveLength(0);
    expect(h.assinaturas).toHaveLength(0);
    expect(h.eventos).toHaveLength(0);
  });

  it('grava o evento pdf_baixado no mesmo lugar e formato da abertura e avisa o dono', async () => {
    const res = await baixar(DOC_ID, { 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country-region': 'SP', 'x-vercel-ip-country': 'BR' });
    expect(res.status).toBe(302);
    expect(h.eventos).toHaveLength(1);
    expect(h.eventos[0]).toEqual({
      user_id: 'user-1', feature: 'proposta_link', event_type: 'pdf_baixado',
      event_data: {
        document_id: DOC_ID, codigo: '20260051', cliente: 'Maria Aparecida Souza', cidade: 'São Paulo', uf: 'SP', pais: 'BR',
        dispositivo: 'Celular', chave: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(JSON.stringify(h.eventos[0])).not.toContain('529.982');
    expect(Object.keys((h.eventos[0] as { event_data: object }).event_data).sort()).toEqual(['chave', 'cidade', 'cliente', 'codigo', 'dispositivo', 'document_id', 'pais', 'uf']);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0][1]).toMatchObject({ body: 'Maria Aparecida Souza baixou o PDF da proposta.' });
  });

  it('o mesmo aparelho baixando de novo em 2 min: o PDF sai, mas evento e aviso só uma vez; outro aparelho conta', async () => {
    expect((await baixar()).status).toBe(302);
    expect((await baixar()).status).toBe(302);
    expect(h.eventos).toHaveLength(1);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.gerar).toHaveBeenCalledTimes(1);
    const outro = await baixar(DOC_ID, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' });
    expect(outro.status).toBe(302);
    expect(h.eventos).toHaveLength(2);
    expect(h.push).toHaveBeenCalledTimes(2);
    // A repetição é só entre downloads: uma abertura da página não esconde um download.
    expect(h.filtros).toContainEqual(['feature_events.event_type', 'pdf_baixado']);
  });

  it('o dono baixando do próprio link (cookie de login) não gera evento nem aviso', async () => {
    const res = await baixar(DOC_ID, { Cookie: 'solardoc_token=dono' });
    expect(res.status).toBe(302);
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('robô de prévia e proposta sem rastreio não gravam evento nem avisam; o PDF sai igual', async () => {
    const robo = await baixar(DOC_ID, { 'User-Agent': 'WhatsApp/2.23.20.0 A' });
    expect(robo.status).toBe(302);
    h.doc = doc({ link_rastreado: null, link_expira_em: null });
    expect((await baixar()).status).toBe(302);
    expect(h.eventos).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('falha ao gravar o evento não derruba o download', async () => {
    h.insertErro = true;
    const res = await baixar();
    expect(res.status).toBe(302);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('404 para id inexistente, formato inválido e documento que não é proposta solar', async () => {
    h.doc = null;
    expect((await baixar()).status).toBe(404);
    expect((await baixar('qualquer-coisa')).status).toBe(404);
    h.doc = doc({ tipo: 'contratoSolar' });
    expect((await baixar()).status).toBe(404);
    expect(h.gerar).not.toHaveBeenCalled();
  });

  it('link vencido: 410, sem PDF', async () => {
    h.doc = doc({ link_expira_em: '2026-10-10T23:59:59-03:00' });
    const res = await baixar();
    expect(res.status).toBe(410);
    expect(h.gerar).not.toHaveBeenCalled();
  });

  it('o gerador quebrou: 500 com frase clara e nada gravado', async () => {
    h.gerar.mockRejectedValueOnce(new Error('chromium caiu'));
    const res = await baixar();
    expect(res.status).toBe(500);
    expect(res.text).toContain('Não deu para gerar o PDF agora');
    expect(h.eventos).toHaveLength(0);
  });

  it('nome do arquivo sem acento problemático', async () => {
    h.doc = doc({ cliente_nome: 'José Antônio d’Ávila / Cia', codigo: '' });
    await baixar();
    expect(h.assinaturas[h.assinaturas.length - 1].opcoes).toEqual({ download: 'Proposta Jose Antonio d Avila Cia.pdf' });
  });
});

describe('Botão "Baixar PDF" na página pública', () => {
  const abrir = () => request(app).get(`/p/${DOC_ID}`).set({ 'User-Agent': IPHONE });

  it('proposta solar: botão RELATIVO (mesmo domínio do link), nofollow, antes do </body> e fora da área impressa', async () => {
    const res = await abrir();
    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="/p/${DOC_ID}/pdf"`);
    expect(res.text).not.toContain('https://api.solardoc.app/p/');
    expect(res.text).toContain('rel="nofollow noopener"');
    expect(res.text).toContain('Baixar PDF');
    expect(res.text).toContain('@media print{.sd-pdf{display:none!important}}');
    expect(res.text.indexOf('Baixar PDF')).toBeLessThan(res.text.indexOf('</body>'));
    expect(res.text).toContain('CPF 529.982.247-25');
    expect(h.doc?.content).toBe(HTML);
  });

  it('proposta off-grid não ganha o botão', async () => {
    h.doc = doc({ tipo: 'propostaOffGrid', link_rastreado: null });
    expect((await abrir()).text).not.toContain('Baixar PDF');
  });

  it('abertura: a contagem e a repetição olham só aberta e aberta_vencida (o download não mexe nelas)', async () => {
    await abrir();
    const filtrosTipo = h.filtros.filter(([c]) => c === 'feature_events.event_type');
    expect(filtrosTipo.length).toBeGreaterThan(0);
    expect(filtrosTipo.every(([, v]) => Array.isArray(v) && (v as string[]).join() === 'aberta,aberta_vencida')).toBe(true);
  });

  it('comBotaoPdf: sem </body> acrescenta no fim; o id vai codificado', () => {
    expect(comBotaoPdf('<p>x</p>', 'a.b c')).toContain('href="/p/a.b%20c/pdf"');
    expect(comBotaoPdf('<p>x</p>', 'abc').startsWith('<p>x</p><style>')).toBe(true);
  });
});
