import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { banco } from './_bancoFalso';
import { PARTNER, PED1, U1, U2, app, bearer, receita, semearParceiro, LOGO } from './_nexusAjuda';

// Link público da proposta (v3): criado uma vez pelo dono; o GET público devolve só a lista branca (sem dado interno),
// conta a abertura com janela de 10 minutos, responde 404 para token inexistente ou malformado e 503 com o portal
// desligado, e tem limite por IP. Também o Termo de Parceria: gate (Pro), versão e aceite uma vez só.

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'sem consultor neste arquivo' } })) },
    from: () => {
      const q: any = { select: () => q, eq: () => q, ilike: () => q, gte: () => q, order: () => q, range: () => Promise.resolve({ data: [], error: null }), limit: () => Promise.resolve({ data: [], error: null }) };
      return q;
    },
  },
}));

const enviados: Array<{ phone: string; texto: string; linha: string }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => { enviados.push({ phone, texto, linha }); }),
}));
const emails: string[] = [];
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: vi.fn(async (assunto: string) => { emails.push(assunto); }),
}));

import { resetSondaPortal } from '../services/nexus/repositorio';
import { JANELA_ABERTURA_MS } from '../routes/geradorNexus';

const P1 = '00000000-0000-4000-a000-0000000000f1';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'; // 32 caracteres base64url

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  resetSondaPortal();
  enviados.length = 0;
  emails.length = 0;
  delete process.env.NEXUS_AVISO_LIGADO;
  delete process.env.NEXUS_AVISO_PHONE;
  receita('ativa');
});
afterEach(() => vi.unstubAllGlobals());

const ligarAviso = () => {
  process.env.NEXUS_AVISO_LIGADO = '1';
  process.env.NEXUS_AVISO_PHONE = '5511900000000';
};

function semearProposta(uid = U1, extra: Record<string, unknown> = {}) {
  const p = {
    id: P1, user_id: uid, numero: '20261001', saida_ultima: 'completo', cliente_nome: 'Posto Exemplo', cliente_doc: '12345678900',
    cliente_cidade: 'Araguari', cliente_uf: 'MG', cliente_telefone: '34988880000', cliente_email: 'posto@exemplo.com', tipo_local: 'posto',
    modelo: 'nexus-dc-80', quantidade: 2, preco_unitario: 69990, valor_total: 139980, dados: { form: { a: 1 }, resumo: { total: 139980 } },
    created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z', link_token: null, link_criado_em: null,
    aberturas: 0, primeira_abertura_em: null, ultima_abertura_em: null, ...extra,
  };
  banco.poe('nexus_propostas', p);
  return p;
}
const comLink = (extra: Record<string, unknown> = {}) => semearProposta(U1, { link_token: TOKEN, link_criado_em: '2026-10-20T13:00:00Z', ...extra });
const linhaDaProposta = () => banco.linhas('nexus_propostas')[0]!;
const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('POST /nexus/propostas/:id/link', () => {
  it('cria o link uma vez: token de 32 caracteres base64url e a url pública', async () => {
    semearParceiro(U1, PARTNER);
    semearProposta();
    const r = await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1));
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(r.body.url).toBe(`https://solardoc.app/nexus/p/?t=${r.body.token}`);
    expect(linhaDaProposta()).toMatchObject({ link_token: r.body.token });
    expect(linhaDaProposta().link_criado_em).toEqual(expect.any(String));
  });

  it('chamar de novo devolve o MESMO token e não grava outro', async () => {
    semearParceiro(U1, PARTNER);
    semearProposta();
    const a = await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1));
    const antes = banco.escritas.length;
    const b = await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1));
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ token: a.body.token, url: a.body.url });
    expect(banco.escritas.length).toBe(antes);
  });

  it('duas chamadas ao mesmo tempo terminam com um token só, igual nas duas respostas', async () => {
    semearParceiro(U1, PARTNER);
    semearProposta();
    const [a, b] = await Promise.all([
      request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1)),
      request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1)),
    ]);
    expect(a.body.token).toBe(b.body.token);
    expect(linhaDaProposta().link_token).toBe(a.body.token);
  });

  it('só o dono: proposta de outro parceiro, id mal formado e sem login', async () => {
    semearParceiro(U1, PARTNER);
    semearParceiro(U2, PARTNER);
    semearProposta(U2);
    expect((await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1))).status).toBe(404);
    expect(linhaDaProposta().link_token).toBeNull();
    expect((await request(app()).post('/gerador/nexus/propostas/abc/link').set(bearer(U1))).status).toBe(404);
    expect((await request(app()).post(`/gerador/nexus/propostas/${P1}/link`)).status).toBe(401);
  });

  it('portal desligado: 503', async () => {
    semearParceiro(U1, PARTNER);
    semearProposta();
    banco.falhas['nexus_usinas.select'] = { erro: { code: '42P01', message: 'x' } };
    expect((await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1))).status).toBe(503);
  });

  it('GET /propostas e GET /propostas/:id trazem link_token e as aberturas', async () => {
    semearParceiro(U1, PARTNER);
    comLink({ aberturas: 3, primeira_abertura_em: '2026-10-20T14:00:00Z', ultima_abertura_em: '2026-10-21T10:00:00Z' });
    const lista = await request(app()).get('/gerador/nexus/propostas').set(bearer(U1));
    expect(lista.body.propostas[0]).toMatchObject({ link_token: TOKEN, aberturas: 3, primeira_abertura_em: '2026-10-20T14:00:00Z', ultima_abertura_em: '2026-10-21T10:00:00Z' });
    const uma = await request(app()).get(`/gerador/nexus/propostas/${P1}`).set(bearer(U1));
    expect(uma.body.proposta).toMatchObject({ link_token: TOKEN, aberturas: 3 });
    expect(uma.body.proposta.user_id).toBeUndefined();
  });
});

describe('GET /nexus/p/:token (público)', () => {
  it('devolve a proposta, o parceiro, o catálogo, a entrega e o financiamento, sem login', async () => {
    semearParceiro(U1, PARTNER);
    comLink();
    const r = await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-robots-tag']).toMatch(/noindex/);
    expect(Object.keys(r.body).sort()).toEqual(['catalogo', 'entrega', 'financiamento', 'parceiro', 'proposta']);
    expect(r.body.proposta).toEqual({
      numero: '20261001', cliente_nome: 'Posto Exemplo', cliente_cidade: 'Araguari', cliente_uf: 'MG', tipo_local: 'posto',
      modelo: 'nexus-dc-80', quantidade: 2, valor_total: 139980, dados: { form: { a: 1 }, resumo: { total: 139980 } }, created_at: '2026-10-20T12:00:00Z',
    });
    expect(r.body.parceiro).toEqual({ empresa: 'Solar Exemplo', cidade: 'Uberlândia', uf: 'MG', whatsapp: '34999990000', logo_base64: LOGO });
    expect(r.body.catalogo.produtos.map((p: any) => p.precoSugerido)).toEqual([69990, 89990]);
    expect(r.body.entrega).toBe('Entrega na primeira quinzena de dezembro');
    expect(r.body.financiamento).toEqual({ parcelas: 96, carenciaDias: 120, taxaRefMensal: 1.49 });
  });

  it('nada interno vaza: sem user_id, ids, notas da equipe, pedido, aberturas nem o token', async () => {
    semearParceiro(U1, { ...PARTNER, notas_equipe: 'cliente difícil', lead_gerador_id: 'lead-99' });
    banco.poe('nexus_pedidos', { id: PED1, user_id: U1, tipo: 'equipamento', modelo: 'nexus-dc-80', quantidade: 2, status: 'negociando', obs_equipe: 'desconto de 10' });
    comLink({ aberturas: 4 });
    const texto = JSON.stringify((await request(app()).get(`/gerador/nexus/p/${TOKEN}`)).body);
    for (const proibido of [U1, P1, TOKEN, 'user_id', 'notas_equipe', 'cliente difícil', 'lead-99', 'negociando', 'desconto', 'aberturas', 'link_token', 'cnpj', 'perfil_completo']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('não devolve dado pessoal do cliente final, na raiz nem em dados (qualquer nível); nome, cidade, UF e tipo de local ficam', async () => {
    semearParceiro(U1, PARTNER);
    comLink({
      cliente_doc: '12345678900', cliente_telefone: '34988880000', cliente_email: 'posto@exemplo.com',
      dados: {
        cliente: { nome: 'Posto Exemplo', cpf: '123.456.789-00', cnpj: '11222333000181', doc: '999', cliente_doc: '888', telefone: '34988880000', whatsapp: '34977770000', email: 'posto@exemplo.com', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto' },
        form: { clienteTelefone: '34966660000', clienteEmail: 'x@y.com', 'cpf-cnpj': '1', itens: [{ nome: 'Obra', contato: { fone: '3433334444', e_mail: 'a@b.com', cidade: 'X' } }], total: 139980 },
        empresa: { nome: 'Solar Exemplo', cnpj: '11222333000181', whatsapp: '34999990000' },
      },
    });
    const r = await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(r.status).toBe(200);
    const texto = JSON.stringify(r.body.proposta);
    for (const vazou of ['12345678900', '123.456.789-00', '34988880000', '34977770000', '34966660000', '3433334444', 'posto@exemplo.com', 'x@y.com', 'a@b.com', '"999"', '"888"']) {
      expect(texto).not.toContain(vazou);
    }
    expect(r.body.proposta.dados.cliente).toEqual({ nome: 'Posto Exemplo', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto' });
    expect(r.body.proposta.dados.form).toEqual({ itens: [{ nome: 'Obra', contato: { cidade: 'X' } }], total: 139980 });
    expect(r.body.proposta).toMatchObject({ cliente_nome: 'Posto Exemplo', cliente_cidade: 'Araguari', cliente_uf: 'MG', tipo_local: 'posto' });
    expect(Object.keys(r.body.proposta)).not.toEqual(expect.arrayContaining(['cliente_doc', 'cliente_telefone', 'cliente_email']));
    // a empresa do parceiro continua no documento e no bloco parceiro
    expect(r.body.proposta.dados.empresa).toEqual({ nome: 'Solar Exemplo', cnpj: '11222333000181', whatsapp: '34999990000' });
    expect(r.body.parceiro.whatsapp).toBe('34999990000');
  });

  it('conta a primeira abertura: aberturas 1, primeira e última preenchidas', async () => {
    semearParceiro(U1, PARTNER);
    comLink();
    await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    const p = linhaDaProposta();
    expect(p.aberturas).toBe(1);
    expect(p.primeira_abertura_em).toEqual(expect.any(String));
    expect(p.ultima_abertura_em).toBe(p.primeira_abertura_em);
  });

  it('reabrir dentro de 10 minutos não conta de novo (nem na segunda chamada seguida)', async () => {
    semearParceiro(U1, PARTNER);
    comLink();
    await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(linhaDaProposta().aberturas).toBe(1);
  });

  it('última abertura há 5 minutos: não conta. Há 11 minutos: conta e mantém a primeira', async () => {
    semearParceiro(U1, PARTNER);
    comLink({ aberturas: 2, primeira_abertura_em: '2026-10-20T14:00:00Z', ultima_abertura_em: minutosAtras(5) });
    await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(linhaDaProposta().aberturas).toBe(2);
    expect(linhaDaProposta().ultima_abertura_em).not.toBeNull();

    banco.reset(); banco.projeta = true; resetSondaPortal();
    semearParceiro(U1, PARTNER);
    const antiga = minutosAtras(11);
    comLink({ aberturas: 2, primeira_abertura_em: '2026-10-20T14:00:00Z', ultima_abertura_em: antiga });
    await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    const p = linhaDaProposta();
    expect(p.aberturas).toBe(3);
    expect(p.primeira_abertura_em).toBe('2026-10-20T14:00:00Z');
    expect(Date.parse(p.ultima_abertura_em)).toBeGreaterThan(Date.parse(antiga));
    expect(JANELA_ABERTURA_MS).toBe(10 * 60 * 1000);
  });

  it('falha ao contar a abertura não derruba a resposta ao cliente', async () => {
    semearParceiro(U1, PARTNER);
    comLink();
    banco.falhas['nexus_propostas.update'] = { erro: { code: '57014', message: 'timeout' } };
    const r = await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body.proposta.numero).toBe('20261001');
  });

  it('token inexistente ou de formato inválido: 404 (o malformado nem chega ao banco)', async () => {
    semearParceiro(U1, PARTNER);
    comLink();
    expect((await request(app()).get('/gerador/nexus/p/ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')).status).toBe(404);
    const antes = banco.escritas.length;
    for (const ruim of ['curto', 'x'.repeat(33), 'AbCdEfGhIjKlMnOpQrStUvWxYz01234!']) {
      expect((await request(app()).get(`/gerador/nexus/p/${encodeURIComponent(ruim)}`)).status).toBe(404);
    }
    expect(banco.escritas.length).toBe(antes);
  });

  it('portal desligado: 503', async () => {
    semearParceiro(U1, PARTNER);
    comLink();
    banco.falhas['nexus_propostas.select'] = { erro: { code: '42P01', message: 'x' } };
    const r = await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ erro: 'portal_desligado' });
  });

  it('parceiro sem logo e sem WhatsApp: os campos vêm nulos, a proposta abre do mesmo jeito', async () => {
    semearParceiro(U1, PARTNER, { logo_base64: null, whatsapp: null });
    comLink();
    const r = await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body.parceiro).toMatchObject({ whatsapp: null, logo_base64: null, empresa: 'Solar Exemplo' });
  });

  it('limite por IP: a 61ª chamada no minuto leva 429', async () => {
    const a = app();
    let ultimo = 0;
    for (let i = 0; i < 61; i++) ultimo = (await request(a).get('/gerador/nexus/p/curto')).status;
    expect(ultimo).toBe(429);
  });
});

describe('POST /nexus/termo/aceitar', () => {
  const PRO = { ...PARTNER, carregadores_comprados: 1 };

  it('só do Pro em diante: antes da primeira compra, 403', async () => {
    semearParceiro(U1, PARTNER);
    const r = await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send({ versao: 'v1' });
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('etapa_bloqueada');
    expect(banco.linhas('nexus_parceiros')[0]!.termo_aceito_em).toBeUndefined();
  });

  it('versão diferente de v1 ou ausente: 400 versao_invalida', async () => {
    semearParceiro(U1, PRO);
    for (const corpo of [{ versao: 'v2' }, { versao: '' }, {}]) {
      const r = await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send(corpo);
      expect(r.status).toBe(400);
      expect(r.body.erro).toBe('versao_invalida');
    }
  });

  it('aceita: grava versão e data, o /eu mostra o aceite e as oportunidades passam a liberar', async () => {
    semearParceiro(U1, PRO);
    const antes = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(antes.body.libera.oportunidades).toBe(false);
    expect(antes.body.termo).toEqual({ versao: 'v1', disponivel: true, aceito_em: null });

    const r = await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send({ versao: 'v1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, versao: 'v1' });
    expect(banco.linhas('nexus_parceiros')[0]).toMatchObject({ termo_versao: 'v1', termo_aceito_em: r.body.aceito_em });

    const depois = await request(app()).get('/gerador/nexus/eu').set(bearer(U1));
    expect(depois.body.termo).toEqual({ versao: 'v1', disponivel: true, aceito_em: r.body.aceito_em });
    expect(depois.body.libera.oportunidades).toBe(true);
    expect(depois.body.bloqueios.oportunidades).toBeUndefined();
  });

  it('aceitar de novo não regrava a data e não avisa outra vez', async () => {
    ligarAviso();
    semearParceiro(U1, PRO);
    const a = await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send({ versao: 'v1' });
    const b = await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send({ versao: 'v1' });
    expect(b.body.aceito_em).toBe(a.body.aceito_em);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.texto).toMatch(/Solar Exemplo aceitou o Termo de Parceria NEXUS \(v1\)\. WhatsApp: 34999990000\./);
    expect(banco.linhas('system_state').filter((s) => String(s.key).startsWith('nexus_aviso:termo:'))).toHaveLength(1);
  });

  it('com o aviso desligado, aceita e não manda nada', async () => {
    semearParceiro(U1, PRO);
    expect((await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send({ versao: 'v1' })).status).toBe(200);
    expect(enviados).toHaveLength(0);
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('sem login: 401; sem linha de parceiro: 409', async () => {
    expect((await request(app()).post('/gerador/nexus/termo/aceitar').send({ versao: 'v1' })).status).toBe(401);
    expect((await request(app()).post('/gerador/nexus/termo/aceitar').set(bearer(U1)).send({ versao: 'v1' })).status).toBe(409);
  });
});

describe('regras novas do link (rodada 3 da revisão)', () => {
  it('criar o link exige libera.completo: perfil incompleto (sem logo) leva 403 etapa_bloqueada e não grava token', async () => {
    semearParceiro(U1, PARTNER, { logo_base64: null });
    semearProposta();
    const r = await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1));
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('etapa_bloqueada');
    expect(linhaDaProposta().link_token).toBeNull();
  });

  it('proposta de outro parceiro continua 404 (dono primeiro)', async () => {
    semearParceiro(U1, PARTNER);
    semearParceiro(U2, PARTNER);
    semearProposta(U2);
    expect((await request(app()).post(`/gerador/nexus/propostas/${P1}/link`).set(bearer(U1))).status).toBe(404);
  });

  it('GET /nexus/p/:token devolve 404 quando o parceiro dono está descartado, e não conta abertura', async () => {
    semearParceiro(U1, { ...PARTNER, status: 'descartado' });
    comLink();
    const r = await request(app()).get(`/gerador/nexus/p/${TOKEN}`);
    expect(r.status).toBe(404);
    expect(r.body.erro).toBe('nao_encontrada');
    expect(linhaDaProposta().aberturas).toBe(0);
  });
});
