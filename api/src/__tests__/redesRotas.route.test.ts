import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rotas das redes (fase 1): login, lista fechada da equipe, UM item por chamada, chave desligada, URL de envio
// do vídeo, caixa de comentários com o que o motor já fez e o cache de 1 minuto. Banco, Graph e Z-API são dublês.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  fbLidos: [] as any[],
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
  },
}));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));
vi.mock('../services/instagram/igClient', () => ({
  getIgConfig: vi.fn(async () => ({ access_token: 'igtk', ig_user_id: '17841400000001' })),
  replyToComment: vi.fn(async () => ({ id: 'R-IG' })),
}));
vi.mock('../services/instagram/igEngine', () => ({ chaveRespostaGenteIg: (id: string) => `ig_sent:gente:${id}` }));
vi.mock('../services/instagram/fbComentarios', () => ({
  PAGINA_FB: '704395102766155',
  tokenDaPaginaFb: vi.fn(async () => 'pgtk'),
  chaveRespostaGenteFb: (id: string) => `fb_gente:${id}`,
  lerComentariosRecentesFb: vi.fn(async () => h.fbLidos),
  responderComentarioFb: vi.fn(async () => ({ ok: true, id: 'R-FB' })),
}));

import { banco, chaves, valorDe } from './redesBancoFalso';
import { mountRedes } from '../routes/geradorRedes';
import { lerComentariosRecentesFb } from '../services/instagram/fbComentarios';
import { replyToComment } from '../services/instagram/igClient';

const r = Router();
mountRedes(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const THIAGO = 'Bearer tk-thiago';
const MARIA = 'Bearer tk-maria';       // consultora de fora da lista da equipe
const ESTRANHO = 'Bearer tk-estranho'; // conta de fora do domínio

const ENVS = ['REDES_STATUS_5040_LIGADO', 'REDES_REELS_IG_LIGADO', 'REDES_REELS_FB_LIGADO', 'REDES_RESPOSTA_IG_LIGADA', 'REDES_RESPOSTA_FB_LIGADA', 'REDES_CAIXA_LIGADA', 'REDES_EQUIPE'];

beforeEach(() => {
  banco.reiniciar();
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-maria': 'maria@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com',
  };
  h.fbLidos = [];
  for (const k of ENVS) delete process.env[k];
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.META_SYSTEM_USER_TOKEN = 'tk';
  vi.mocked(lerComentariosRecentesFb).mockClear();
  vi.mocked(replyToComment).mockClear();
});
afterEach(() => { for (const k of ENVS) delete process.env[k]; });

const get = (caminho: string, auth = NILCE) => request(app).get(`/gerador/redes${caminho}`).set('Authorization', auth);
const post = (caminho: string, corpo: unknown, auth = NILCE) => request(app).post(`/gerador/redes${caminho}`).set('Authorization', auth).send(corpo as object);

describe('login e equipe', () => {
  it('401 sem token e com token inválido, em todas as 7 rotas', async () => {
    const id = 'instagram.17841400000001.0123456789abcdef';
    for (const [metodo, caminho] of [
      ['post', '/upload-url'], ['post', '/publicar'], ['get', '/publicacoes'], ['post', `/publicacoes/${id}/avancar`],
      ['get', '/comentarios?rede=instagram'], ['post', '/comentarios/responder'], ['get', '/limites'],
    ] as const) {
      const sem = await (request(app) as any)[metodo](`/gerador/redes${caminho}`).send({});
      expect({ caminho, status: sem.status }).toEqual({ caminho, status: 401 });
      const ruim = await (request(app) as any)[metodo](`/gerador/redes${caminho}`).set('Authorization', 'Bearer lixo').send({});
      expect({ caminho, status: ruim.status }).toEqual({ caminho, status: 401 });
    }
  });

  it('conta de fora do domínio dá 403; consultora fora da lista da equipe dá 403 "equipe"; thiago, diego, giovanna e nilce passam', async () => {
    expect((await get('/limites', ESTRANHO)).status).toBe(403);
    const maria = await get('/limites', MARIA);
    expect(maria.status).toBe(403);
    expect(maria.body).toMatchObject({ ok: false, precisa: 'equipe' });
    expect((await post('/publicar', { rede: 'status' }, MARIA)).status).toBe(403);
    expect((await get('/limites', NILCE)).status).toBe(200);
    expect((await get('/limites', THIAGO)).status).toBe(200);
    process.env.REDES_EQUIPE = 'maria';
    expect((await get('/limites', MARIA)).status).toBe(200);
    expect((await get('/limites', NILCE)).status).toBe(403);
  });

  it('as respostas não ficam em cache', async () => {
    expect((await get('/limites')).headers['cache-control']).toBe('no-store');
  });
});

describe('POST /redes/publicar: uma rede e um item por chamada, chave desligada', () => {
  it('lista, rede em lista, campo desconhecido e rede fora das três dão 400, antes de qualquer outra conferência', async () => {
    for (const corpo of [
      [{ rede: 'instagram', video_url: 'x', legenda: '' }],
      { rede: ['instagram', 'facebook'], video_url: 'x', legenda: '' },
      { rede: 'instagram', video_url: ['a', 'b'], legenda: '' },
      { rede: 'instagram', video_url: 'x', legenda: ['a'] },
      { redes: ['instagram', 'facebook', 'status'], video_url: 'x', legenda: '' },
      { rede: 'instagram', video_url: 'x', legenda: '', extra: 1 },
      { rede: 'tiktok', video_url: 'x', legenda: '' },
      {},
    ]) {
      const res = await post('/publicar', corpo);
      expect({ corpo: JSON.stringify(corpo), status: res.status }).toEqual({ corpo: JSON.stringify(corpo), status: 400 });
    }
    expect(chaves(banco, 'redes_')).toEqual([]);
  });

  it('sem a env de cada item, 403 "chave_desligada": nada sai, em cada uma das três redes', async () => {
    const video = 'https://x.supabase.co/storage/v1/object/public/redes-videos/2026/10/a.mp4';
    for (const rede of ['instagram', 'facebook', 'status']) {
      const res = await post('/publicar', { rede, video_url: video, legenda: 'oi' });
      expect({ rede, status: res.status, motivo: res.body.motivo }).toEqual({ rede, status: 403, motivo: 'chave_desligada' });
    }
    expect(chaves(banco, 'redes_')).toEqual([]);
    expect(chaves(banco, 'status_io')).toEqual([]);
  });
});

describe('POST /redes/upload-url', () => {
  const corpo = { nome: 'reel.mp4', tipo: 'video/mp4', tamanho: 12_000_000 };

  it('desligado (nenhum item de publicação ligado): 403; corpo em lista: 400', async () => {
    expect((await post('/upload-url', corpo)).status).toBe(403);
    process.env.REDES_REELS_IG_LIGADO = '1';
    expect((await post('/upload-url', [corpo])).status).toBe(400);
    expect((await post('/upload-url', { ...corpo, nome: ['a.mp4'] })).status).toBe(400);
  });

  it('cria o bucket público na 1ª vez (confere com getBucket), devolve a URL de envio e a URL pública final; na 2ª não cria de novo', async () => {
    process.env.REDES_REELS_IG_LIGADO = '1';
    const a = await post('/upload-url', corpo);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, metodo: 'PUT', limite_bytes: 50 * 1024 * 1024, cabecalhos: { 'content-type': 'video/mp4' } });
    expect(a.body.upload_url).toContain('/upload/sign/redes-videos/');
    expect(a.body.video_url).toMatch(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/redes-videos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp4$/);
    expect(banco.storage.criados).toEqual(['redes-videos']);
    const b = await post('/upload-url', { ...corpo, nome: 'outro.mov', tipo: 'video/quicktime' });
    expect(b.status).toBe(200);
    expect(b.body.video_url.endsWith('.mov')).toBe(true);
    expect(banco.storage.criados).toEqual(['redes-videos']);
  });

  it('formato fora de mp4 e mov, tamanho acima de 50 MB ou sem tamanho: 400', async () => {
    process.env.REDES_REELS_IG_LIGADO = '1';
    expect((await post('/upload-url', { nome: 'a.avi', tipo: 'video/x-msvideo', tamanho: 1000 })).status).toBe(400);
    expect((await post('/upload-url', { ...corpo, tamanho: 51 * 1024 * 1024 })).body).toMatchObject({ ok: false, motivo: 'grande' });
    expect((await post('/upload-url', { ...corpo, tamanho: '12000000' })).status).toBe(400);
    expect((await post('/upload-url', { nome: 'a.mp4', tipo: 'video/mp4' })).status).toBe(400);
    expect(banco.storage.assinados).toEqual([]);
  });

  it('erro ao conferir o bucket é 502 e NÃO cria; bucket que existe sem ser público dá erro em vez de um link que daria 404', async () => {
    process.env.REDES_REELS_IG_LIGADO = '1';
    banco.storage.bucket.erroLeitura = true;
    expect((await post('/upload-url', corpo)).status).toBe(502);
    expect(banco.storage.criados).toEqual([]);
    banco.storage.bucket = { existe: true, publico: false, erroLeitura: false };
    const priv = await post('/upload-url', corpo);
    expect(priv.status).toBe(502);
    expect(priv.body.upload_url).toBeUndefined();
  });
});

describe('GET /redes/comentarios e POST /redes/comentarios/responder', () => {
  const agora = () => new Date().toISOString();
  const comentarioIg = (id: string, texto = 'Quanto custa?') =>
    (banco.tabelas.ig_events ??= []).push({ id: `e${id}`, tipo: 'comment', ref: id, raw: { id, text: texto, from: { id: `U${id}`, username: 'ana' }, media: { id: 'M1' } }, criado_em: agora() });

  it('uma rede por chamada: sem rede, rede inválida ou rede repetida (lista) dá 400; caixa desligada dá 403', async () => {
    expect((await get('/comentarios')).status).toBe(400);
    expect((await get('/comentarios?rede=twitter')).status).toBe(400);
    expect((await get('/comentarios?rede=instagram&rede=facebook')).status).toBe(400);
    expect((await get('/comentarios?rede=instagram')).status).toBe(403);
  });

  it('Instagram: mostra o que o motor já mandou ou tem na fila e se gente já respondeu, antes do campo de resposta', async () => {
    process.env.REDES_CAIXA_LIGADA = '1';
    comentarioIg('C10001'); comentarioIg('C10002'); comentarioIg('C10003');
    banco.tabelas.ig_queue = [
      { id: 'q1', tipo: 'private_reply', recipient: 'C10001', status: 'sent' },
      { id: 'q2', tipo: 'public_reply', recipient: 'C10001', status: 'pending' },
      { id: 'q3', tipo: 'private_reply', recipient: 'C10002', status: 'failed' },
    ];
    (banco.tabelas.system_state ??= []).push({ key: 'ig_sent:gente:C10003', value: { por: 'diego', em: agora(), estado: 'enviado' }, updated_at: agora() });
    const res = await get('/comentarios?rede=instagram');
    expect(res.status).toBe(200);
    expect(res.body.fonte).toBe('banco');
    const por = (id: string) => res.body.itens.find((i: any) => i.id === id);
    expect(por('C10001')).toMatchObject({ motor: { dm: 'enviada', publica: 'na_fila' }, gente: null, pode_responder: true, autor_nome: '@ana', texto: 'Quanto custa?' });
    expect(por('C10002')).toMatchObject({ motor: { dm: 'falhou', publica: null } });
    expect(por('C10003')).toMatchObject({ gente: { por: 'diego' }, pode_responder: false });
  });

  it('Facebook: lê no Graph uma vez por minuto e serve a cópia do banco dentro do minuto; mostra o que o motor já mandou', async () => {
    process.env.REDES_CAIXA_LIGADA = '1';
    h.fbLidos = [{ id: 'F1', message: 'Tenho interesse', created_time: agora(), fromId: 'U1', fromName: 'Ana', postId: 'P1', ehAnuncio: false }];
    (banco.tabelas.ig_events ??= []).push({ id: 'x1', tipo: 'fb_private_reply', ref: 'F1', raw: {}, criado_em: agora() });
    const a = await get('/comentarios?rede=facebook');
    expect(a.body).toMatchObject({ ok: true, fonte: 'meta' });
    expect(a.body.itens[0]).toMatchObject({ id: 'F1', motor: { dm: 'enviada', publica: 'enviada' }, pode_responder: true });
    const b = await get('/comentarios?rede=facebook');
    expect(b.body.fonte).toBe('cache');
    expect(lerComentariosRecentesFb).toHaveBeenCalledTimes(1);
    // Passou o minuto: lê de novo.
    banco.tabelas.system_state!.find(l => l.key === 'redes_cx_cache:facebook')!.value.em = new Date(Date.now() - 61_000).toISOString();
    expect((await get('/comentarios?rede=facebook')).body.fonte).toBe('meta');
    expect(lerComentariosRecentesFb).toHaveBeenCalledTimes(2);
  });

  it('Facebook em parada da Meta: serve a cópia velha sem chamar a Meta', async () => {
    process.env.REDES_CAIXA_LIGADA = '1';
    (banco.tabelas.system_state ??= []).push(
      { key: 'redes_parada:facebook', value: { ate: new Date(Date.now() + 600_000).toISOString(), codigo: 613 }, updated_at: agora() },
      { key: 'redes_cx_cache:facebook', value: { em: new Date(Date.now() - 600_000).toISOString(), itens: [{ id: 'F9', texto: 'velho', autor_id: null, autor_nome: null, post_id: null, criado_em: null }] }, updated_at: agora() },
    );
    const res = await get('/comentarios?rede=facebook');
    expect(res.body).toMatchObject({ fonte: 'cache_velho', parada: { motivo: 'parada_meta_613' } });
    expect(lerComentariosRecentesFb).not.toHaveBeenCalled();
  });

  it('responder: corpo em lista ou campo a mais dá 400; sem a env, 403; ligado, grava QUEM clicou e responde uma vez', async () => {
    comentarioIg('C10001');
    expect((await post('/comentarios/responder', [{ rede: 'instagram', comentario_id: 'C10001', texto: 'oi' }])).status).toBe(400);
    expect((await post('/comentarios/responder', { rede: 'instagram', comentario_id: ['C10001'], texto: 'oi' })).status).toBe(400);
    expect((await post('/comentarios/responder', { rede: 'instagram', comentario_id: 'C10001', texto: 'oi', extra: true })).status).toBe(400);
    expect((await post('/comentarios/responder', { rede: 'instagram', comentario_id: 'C10001', texto: 'oi' })).status).toBe(403);
    process.env.REDES_RESPOSTA_IG_LIGADA = '1';
    const ok = await post('/comentarios/responder', { rede: 'instagram', comentario_id: 'C10001', texto: 'Obrigada!' }, NILCE);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, motivo: 'enviada' });
    expect(valorDe(banco, 'ig_sent:gente:C10001')).toMatchObject({ por: 'nilce', estado: 'enviado' });
    expect(replyToComment).toHaveBeenCalledTimes(1);
    const de_novo = await post('/comentarios/responder', { rede: 'instagram', comentario_id: 'C10001', texto: 'outra' }, THIAGO);
    expect(de_novo.status).toBe(409);
    expect(replyToComment).toHaveBeenCalledTimes(1);
  });
});

describe('avançar, listar e limites', () => {
  it('avançar: id torto é 404, corpo preenchido é 400', async () => {
    expect((await post('/publicacoes/nao-e-id/avancar', {})).status).toBe(404);
    expect((await post('/publicacoes/instagram.17841400000001.0123456789abcdef/avancar', {})).status).toBe(404);
    expect((await post('/publicacoes/instagram.17841400000001.0123456789abcdef/avancar', { x: 1 })).status).toBe(400);
  });

  it('lista de publicações: Reels e status, vazias no começo', async () => {
    const res = await get('/publicacoes');
    expect(res.body).toEqual({ ok: true, reels: [], status: [] });
  });

  it('limites: tudo desligado no começo, com o que cada item precisa', async () => {
    const res = await get('/limites');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: { ligado: false, pode: false, motivo: 'chave_desligada' },
      instagram: { publicar: { ligado: false }, responder: { ligado: false, hora: { teto: 180 }, dia: { teto: 300 } } },
      facebook: { publicar: { ligado: false }, responder: { ligado: false, hora: { teto: 60 } } },
      caixa: { ligado: false },
    });
    process.env.REDES_REELS_FB_LIGADO = '1'; process.env.REDES_CAIXA_LIGADA = '1';
    const ligado = await get('/limites');
    expect(ligado.body.facebook.publicar).toMatchObject({ ligado: true, pode: true });
    expect(ligado.body.caixa.ligado).toBe(true);
  });
});
