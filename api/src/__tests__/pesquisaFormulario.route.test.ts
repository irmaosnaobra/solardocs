import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { novoBanco } from './_agentes5040Fake';

// As pesquisas (04/11/2026): o token, o GET e o POST dos dois formulários, o tamanho dos campos, o aviso ao Thiago e a lista do admin.
// Banco em memória; o e-mail de operação e o login são espiões.

const h = vi.hoisted(() => ({ banco: null as any, avisos: [] as Array<{ assunto: string; html: string }>, falhaAviso: false }));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.banco.cliente.from(t) } }));
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: async (assunto: string, html: string) => {
    if (h.falhaAviso) throw new Error('resend fora do ar');
    h.avisos.push({ assunto, html });
  },
}));
vi.mock('../middleware/auth', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.userId = 'admin-1'; next(); } }));
vi.mock('../middleware/adminAuth', () => ({
  adminMiddleware: (req: any, res: any, next: any) => (req.headers['x-admin'] === '1' ? next() : res.status(403).json({ error: 'Acesso restrito a administradores' })),
}));

import { pesquisaAdminRouter, pesquisaPublicaRouter } from '../routes/pesquisa';
import { registrarToken, resolverToken, tokenPesquisa, chaveToken, chaveResposta } from '../services/pesquisa/token';

const app = express();
app.use(express.json());
app.use('/admin/pesquisas', pesquisaAdminRouter);
app.use('/pesquisa', pesquisaPublicaRouter);

const ANA = 'u-ana';
const BIA = 'u-bia';

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.banco = novoBanco();
  h.avisos = [];
  h.falhaAviso = false;
  h.banco.tabelas.users = [
    { id: ANA, nome: 'Ana Souza', email: 'ana@exemplo.com' },
    { id: BIA, nome: 'Bia Lima', email: 'bia@exemplo.com' },
  ];
  h.banco.tabelas.company = [{ user_id: ANA, nome: 'Ana Souza ME', nome_fantasia: 'Solar da Ana', cidade: 'Uberlândia' }];
});

const estado = (key: string) => (h.banco.tabelas.system_state ?? []).find((l: any) => l.key === key);

describe('token', () => {
  it('é curto, estável, não carrega o userId e muda com a pessoa e com o tipo', () => {
    const t = tokenPesquisa(ANA, 'saida')!;
    expect(t).toMatch(/^[a-f0-9]{32}$/);
    expect(tokenPesquisa(ANA, 'saida')).toBe(t);
    expect(t).not.toContain('ana');
    expect(tokenPesquisa(BIA, 'saida')).not.toBe(t);
    expect(tokenPesquisa(ANA, 'depoimento')).not.toBe(t);
  });

  it('não aceita token de outro usuário nem de outro tipo', async () => {
    const tAna = await registrarToken(ANA, 'saida');
    await registrarToken(BIA, 'saida');
    expect(await resolverToken('saida', tAna)).toBe(ANA);
    // outro tipo: o token da saída não abre o depoimento
    expect(await resolverToken('depoimento', tAna)).toBeNull();
    // token de uma pessoa que nunca foi convidada
    expect(await resolverToken('saida', tokenPesquisa('u-estranho', 'saida'))).toBeNull();
    // o registro guarda outro tipo: não vale
    h.banco.tabelas.system_state.find((l: any) => l.key === chaveToken('saida', tAna)).value.tipo = 'depoimento';
    expect(await resolverToken('saida', tAna)).toBeNull();
    // formato torto
    expect(await resolverToken('saida', 'abc')).toBeNull();
    expect(await resolverToken('saida', undefined)).toBeNull();
    expect(await resolverToken('x', tAna)).toBeNull();
  });
});

describe('a validade do token vem do registro guardado', () => {
  it('vale até 60 dias do registro, mesmo que o segredo do HMAC mude; depois disso o link não vale', async () => {
    const t = await registrarToken(ANA, 'saida');
    process.env.AGENTES5040_HMAC = 'outro-segredo-depois-da-troca';
    expect(await resolverToken('saida', t)).toBe(ANA);
    const registro = h.banco.tabelas.system_state.find((l: any) => l.key === chaveToken('saida', t));
    const agora = Date.parse(registro.value.em);
    expect(await resolverToken('saida', t, new Date(agora + 59 * 24 * 3_600_000))).toBe(ANA);
    expect(await resolverToken('saida', t, new Date(agora + 61 * 24 * 3_600_000))).toBeNull();
  });

  it('GET e POST de um token vencido dão 404 "link não vale"', async () => {
    const t = await registrarToken(ANA, 'saida');
    h.banco.tabelas.system_state.find((l: any) => l.key === chaveToken('saida', t)).value.em = new Date(Date.now() - 61 * 24 * 3_600_000).toISOString();
    const g = await request(app).get(`/pesquisa/saida/${t}`);
    expect(g.status).toBe(404);
    expect(g.body.error).toMatch(/não vale/);
    expect((await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'x' })).status).toBe(404);
  });
});

describe('o aviso ao Thiago só na 1ª resposta ou quando o conteúdo muda', () => {
  it('repetição idêntica (duplo clique) não avisa de novo; conteúdo diferente avisa; a resposta é regravada nos dois casos', async () => {
    const t = await registrarToken(ANA, 'saida');
    await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'Caro' });
    await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'Caro' });
    expect(h.avisos).toHaveLength(1);
    await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'Caro', voltaria: 'Preço menor' });
    expect(h.avisos).toHaveLength(2);
    expect(estado(chaveResposta('saida', ANA)).value.voltaria).toBe('Preço menor');
  });

  it('depoimento: mudar só a autorização conta como mudança', async () => {
    const t = await registrarToken(ANA, 'depoimento');
    await request(app).post(`/pesquisa/depoimento/${t}`).send({ frase: 'Muito bom', autorizo: false });
    await request(app).post(`/pesquisa/depoimento/${t}`).send({ frase: 'Muito bom', autorizo: false });
    expect(h.avisos).toHaveLength(1);
    await request(app).post(`/pesquisa/depoimento/${t}`).send({ frase: 'Muito bom', autorizo: true });
    expect(h.avisos).toHaveLength(2);
    expect(h.avisos[1]!.assunto).toMatch(/COM autorização/);
  });
});

describe('GET /pesquisa/:tipo/:token', () => {
  it('devolve só ok, nome, empresa e cidade (nunca o id nem o e-mail)', async () => {
    const t = await registrarToken(ANA, 'depoimento');
    const r = await request(app).get(`/pesquisa/depoimento/${t}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nome: 'Ana Souza', empresa: 'Solar da Ana', cidade: 'Uberlândia' });
  });

  it('sem empresa cadastrada, empresa e cidade vêm vazias', async () => {
    const t = await registrarToken(BIA, 'saida');
    const r = await request(app).get(`/pesquisa/saida/${t}`);
    expect(r.body).toEqual({ ok: true, nome: 'Bia Lima', empresa: '', cidade: '' });
  });

  it('token errado, de outro tipo ou tipo desconhecido dá 404', async () => {
    const t = await registrarToken(ANA, 'saida');
    expect((await request(app).get(`/pesquisa/depoimento/${t}`)).status).toBe(404);
    expect((await request(app).get(`/pesquisa/saida/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await request(app).get(`/pesquisa/outro/${t}`)).status).toBe(404);
  });
});

describe('POST /pesquisa/saida/:token', () => {
  it('grava pesquisa_saida:<userId> com em, avisa o Thiago com as respostas, e a última resposta vale', async () => {
    const t = await registrarToken(ANA, 'saida');
    const r = await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'Ficou caro', critica: 'Faltou modelo', voltaria: 'Preço menor' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const linha = estado(chaveResposta('saida', ANA));
    expect(linha.value).toMatchObject({ tipo: 'saida', user_id: ANA, porque: 'Ficou caro', critica: 'Faltou modelo', voltaria: 'Preço menor', origem: 'formulario' });
    expect(Date.parse(linha.value.em)).toBeGreaterThan(0);
    expect(h.avisos).toHaveLength(1);
    expect(h.avisos[0]!.assunto).toMatch(/Entrevista de saída/);
    expect(h.avisos[0]!.html).toContain('Ficou caro');
    expect(h.avisos[0]!.html).toContain('ana@exemplo.com');

    await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'Mudei de ideia' });
    expect(h.banco.tabelas.system_state.filter((l: any) => l.key === chaveResposta('saida', ANA))).toHaveLength(1);
    expect(estado(chaveResposta('saida', ANA)).value.porque).toBe('Mudei de ideia');
  });

  it('valida o tamanho: 1000 passa, 1001 volta 400 e nada é gravado nem avisado', async () => {
    const t = await registrarToken(ANA, 'saida');
    expect((await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'x'.repeat(1000) })).status).toBe(200);
    h.avisos = [];
    for (const campo of ['porque', 'critica', 'voltaria']) {
      const r = await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'ok', [campo]: 'x'.repeat(1001) });
      expect(r.status, campo).toBe(400);
      expect(r.body.ok).toBe(false);
    }
    expect(h.avisos).toHaveLength(0);
    expect(estado(chaveResposta('saida', ANA)).value.porque).toBe('x'.repeat(1000));
  });

  it('corpo vazio, campo que não é texto e token inválido são recusados', async () => {
    const t = await registrarToken(ANA, 'saida');
    expect((await request(app).post(`/pesquisa/saida/${t}`).send({})).status).toBe(400);
    expect((await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 123 })).status).toBe(400);
    expect((await request(app).post(`/pesquisa/saida/${'1'.repeat(32)}`).send({ porque: 'oi' })).status).toBe(404);
    expect(h.banco.tabelas.system_state.filter((l: any) => String(l.key).startsWith('pesquisa_saida:'))).toHaveLength(0);
  });

  it('o texto das respostas vai escapado no e-mail ao Thiago, e se o aviso falhar a resposta fica gravada', async () => {
    const t = await registrarToken(ANA, 'saida');
    await request(app).post(`/pesquisa/saida/${t}`).send({ critica: '<script>alert(1)</script>' });
    expect(h.avisos[0]!.html).not.toContain('<script>');
    expect(h.avisos[0]!.html).toContain('&lt;script&gt;');
    h.falhaAviso = true;
    const r = await request(app).post(`/pesquisa/saida/${t}`).send({ critica: 'de novo' });
    expect(r.status).toBe(200);
    expect(estado(chaveResposta('saida', ANA)).value.critica).toBe('de novo');
  });

  it('o token do depoimento não grava a saída', async () => {
    const t = await registrarToken(ANA, 'depoimento');
    expect((await request(app).post(`/pesquisa/saida/${t}`).send({ porque: 'oi' })).status).toBe(404);
  });
});

describe('POST /pesquisa/depoimento/:token', () => {
  const corpo = { mudou: 'Ganhei tempo', frase: 'Faço proposta em 2 minutos.', nome: 'Ana S.', empresa: 'Solar da Ana', cidade: 'Uberlândia', autorizo: true };

  it('com autorização: grava e o aviso diz COM autorização', async () => {
    const t = await registrarToken(ANA, 'depoimento');
    const r = await request(app).post(`/pesquisa/depoimento/${t}`).send(corpo);
    expect(r.status).toBe(200);
    expect(estado(chaveResposta('depoimento', ANA)).value).toMatchObject({ ...corpo, tipo: 'depoimento', user_id: ANA, origem: 'formulario' });
    expect(h.avisos).toHaveLength(1);
    expect(h.avisos[0]!.assunto).toMatch(/COM autorização/);
    expect(h.avisos[0]!.html).toContain('Faço proposta em 2 minutos.');
  });

  it('sem autorização (ou sem o campo): grava autorizo false e o aviso diz SEM autorização', async () => {
    const t = await registrarToken(ANA, 'depoimento');
    await request(app).post(`/pesquisa/depoimento/${t}`).send({ ...corpo, autorizo: false });
    expect(h.avisos[0]!.assunto).toMatch(/SEM autorização/);
    const { autorizo: _a, ...semCampo } = corpo;
    await request(app).post(`/pesquisa/depoimento/${t}`).send({ ...semCampo, frase: 'Outra frase' });
    expect(estado(chaveResposta('depoimento', ANA)).value.autorizo).toBe(false);
    expect(h.avisos[1]!.assunto).toMatch(/SEM autorização/);
  });

  it('valida o tamanho de cada campo, o tipo do autorizo e exige o depoimento', async () => {
    const t = await registrarToken(ANA, 'depoimento');
    for (const campo of ['mudou', 'frase', 'nome', 'empresa', 'cidade']) {
      expect((await request(app).post(`/pesquisa/depoimento/${t}`).send({ ...corpo, [campo]: 'x'.repeat(1001) })).status, campo).toBe(400);
    }
    expect((await request(app).post(`/pesquisa/depoimento/${t}`).send({ ...corpo, autorizo: 'sim' })).status).toBe(400);
    expect((await request(app).post(`/pesquisa/depoimento/${t}`).send({ nome: 'Ana', autorizo: true })).status).toBe(400);
    expect(h.avisos).toHaveLength(0);
  });
});

describe('GET /admin/pesquisas', () => {
  it('fica atrás do guard de admin e lista as respostas dos dois tipos, com nome e e-mail', async () => {
    const ts = await registrarToken(ANA, 'saida');
    const td = await registrarToken(BIA, 'depoimento');
    await request(app).post(`/pesquisa/saida/${ts}`).send({ porque: 'Caro' });
    await request(app).post(`/pesquisa/depoimento/${td}`).send({ frase: 'Muito bom', autorizo: true });

    expect((await request(app).get('/admin/pesquisas')).status).toBe(403);
    const r = await request(app).get('/admin/pesquisas').set('x-admin', '1');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.saida).toHaveLength(1);
    expect(r.body.depoimento).toHaveLength(1);
    expect(r.body.saida[0]).toMatchObject({ tipo: 'saida', user_id: ANA, nome: 'Ana Souza', email: 'ana@exemplo.com' });
    expect(r.body.saida[0].resposta.porque).toBe('Caro');
    expect(r.body.depoimento[0].resposta.autorizo).toBe(true);
  });
});
