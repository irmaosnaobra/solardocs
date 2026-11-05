import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  inseridos: [] as Record<string, unknown>[],
  enviar: vi.fn(),
  vapid: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) q[m] = () => q;
      q.limit = async () => ({ data: h.linhas, error: null });
      q.insert = async (l: Record<string, unknown>) => { h.inseridos.push(l); return { error: null }; };
      return q;
    },
  },
}));
vi.mock('../utils/jwt', () => ({
  verifyToken: (t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  },
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: (...a: unknown[]) => h.vapid(...a), sendNotification: (...a: unknown[]) => h.enviar(...a) },
}));

import pushRoutes from '../routes/push';
import { hostPushPermitido, inscricoesAtivas, enviarPushAoUsuario } from '../services/pushUsuario';

const app = express();
app.use(express.json());
app.use('/push', pushRoutes);

const AUTH = 'Bearer valid-token';
const chaves = { p256dh: 'BPpublicKeyDoAparelhoXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', auth: 'authDoAparelho12345' };
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';

beforeEach(() => {
  h.linhas = [];
  h.inseridos = [];
  h.enviar.mockReset();
  h.vapid.mockReset();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe('hostPushPermitido', () => {
  it('aceita só https nos serviços de push conhecidos', () => {
    for (const e of [
      FCM,
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/QGxyz',
      'https://api.push.apple.com/3/device/abc',
    ]) expect(hostPushPermitido(e), e).toBe(true);
  });

  it('recusa host fora da lista, http, credenciais, porta e truques de nome', () => {
    for (const e of [
      'https://evil.com/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x',
      'https://evil.com/fcm.googleapis.com', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
      'https://notify.windows.com.evil.com/x', 'https://evilnotify.windows.com/x', 'https://169.254.169.254/latest', 'https://localhost/x',
      'ftp://fcm.googleapis.com/x', 'lixo', '', undefined,
    ]) expect(hostPushPermitido(e), String(e)).toBe(false);
  });
});

describe('inscricoesAtivas', () => {
  const ins = (endpoint: string) => ({ event_type: 'inscricao', event_data: { endpoint, keys: { p256dh: 'p', auth: 'a' } } });
  const canc = (endpoint: string) => ({ event_type: 'cancelada', event_data: { endpoint } });

  it('ativa é a que tem a inscrição como último evento do endpoint (linhas da mais nova para a mais antiga)', () => {
    const ativas = inscricoesAtivas([
      canc('https://a'), ins('https://a'),      // a: cancelada depois de inscrita
      ins('https://b'), canc('https://b'),      // b: reinscrita depois de cancelar
      ins('https://c'),                         // c: só inscrita
      ins('https://c'),                         // repetida
    ]);
    expect(ativas.map((x) => x.endpoint)).toEqual(['https://b', 'https://c']);
  });

  it('inscrição sem chaves ou sem endpoint é ignorada', () => {
    expect(inscricoesAtivas([
      { event_type: 'inscricao', event_data: { endpoint: 'https://x' } },
      { event_type: 'inscricao', event_data: null },
    ])).toEqual([]);
  });
});

describe('rotas /push', () => {
  it('sem login dá 401', async () => {
    expect((await request(app).get('/push/chave')).status).toBe(401);
    expect((await request(app).post('/push/inscricao').send({})).status).toBe(401);
    expect((await request(app).delete('/push/inscricao').send({ endpoint: FCM })).status).toBe(401);
  });

  it('GET /push/chave: 503 sem a env, publicKey com ela', async () => {
    const sem = await request(app).get('/push/chave').set('Authorization', AUTH);
    expect(sem.status).toBe(503);
    expect(sem.body).toHaveProperty('error');
    process.env.VAPID_PUBLIC_KEY = 'chave-publica-de-teste';
    const com = await request(app).get('/push/chave').set('Authorization', AUTH);
    expect(com.status).toBe(200);
    expect(com.body).toEqual({ publicKey: 'chave-publica-de-teste' });
  });

  it('POST com host fora da lista dá 400 e não grava', async () => {
    const res = await request(app).post('/push/inscricao').set('Authorization', AUTH)
      .send({ subscription: { endpoint: 'https://evil.com/push', keys: chaves } });
    expect(res.status).toBe(400);
    expect(h.inseridos).toHaveLength(0);
  });

  it('POST com corpo inválido dá 400', async () => {
    const res = await request(app).post('/push/inscricao').set('Authorization', AUTH).send({ subscription: { endpoint: FCM } });
    expect(res.status).toBe(400);
  });

  it('POST grava a inscrição com o UA; repetida e já ativa não grava de novo', async () => {
    const res = await request(app).post('/push/inscricao').set('Authorization', AUTH).set('User-Agent', 'MeuCelular/1.0')
      .send({ subscription: { endpoint: FCM, keys: chaves } });
    expect(res.status).toBe(200);
    expect(h.inseridos).toEqual([{
      user_id: 'user-123', feature: 'push', event_type: 'inscricao',
      event_data: { endpoint: FCM, keys: chaves, ua: 'MeuCelular/1.0' },
    }]);

    h.linhas = [{ event_type: 'inscricao', event_data: { endpoint: FCM, keys: chaves } }];
    h.inseridos = [];
    const again = await request(app).post('/push/inscricao').set('Authorization', AUTH)
      .send({ subscription: { endpoint: FCM, keys: chaves } });
    expect(again.status).toBe(200);
    expect(h.inseridos).toHaveLength(0);
  });

  it('DELETE grava cancelada', async () => {
    const res = await request(app).delete('/push/inscricao').set('Authorization', AUTH).send({ endpoint: FCM });
    expect(res.status).toBe(200);
    expect(h.inseridos).toEqual([{ user_id: 'user-123', feature: 'push', event_type: 'cancelada', event_data: { endpoint: FCM } }]);
    expect((await request(app).delete('/push/inscricao').set('Authorization', AUTH).send({})).status).toBe(400);
  });
});

describe('enviarPushAoUsuario', () => {
  const payload = { title: 'Proposta aberta', body: 'Maria abriu sua proposta', url: '/historico' };
  const ativa = (endpoint: string) => ({ event_type: 'inscricao', event_data: { endpoint, keys: chaves } });

  it('sem as envs não faz nada', async () => {
    h.linhas = [ativa(FCM)];
    expect(await enviarPushAoUsuario('user-1', payload)).toEqual({ enviados: 0, removidas: 0 });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('envia com VAPID e TTL de 1 dia para cada aparelho ativo, ignorando host fora da lista', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
    h.linhas = [ativa(FCM), ativa('https://evil.com/x')];
    h.enviar.mockResolvedValue({});
    expect(await enviarPushAoUsuario('user-1', payload)).toEqual({ enviados: 1, removidas: 0 });
    expect(h.vapid).toHaveBeenCalledWith('mailto:equipe@solardoc.app', 'pub', 'priv');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const [ins, corpo, opts] = h.enviar.mock.calls[0];
    expect(ins.endpoint).toBe(FCM);
    expect(JSON.parse(corpo)).toEqual(payload);
    expect(opts.TTL).toBe(86400);
  });

  it('404 e 410 viram cancelada; outro erro não cancela e não lança', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
    h.linhas = [ativa(FCM), ativa('https://web.push.apple.com/a'), ativa('https://updates.push.services.mozilla.com/b')];
    h.enviar.mockImplementation(async (ins: { endpoint: string }) => {
      if (ins.endpoint === FCM) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (ins.endpoint.includes('apple')) throw Object.assign(new Error('nf'), { statusCode: 404 });
      throw Object.assign(new Error('500'), { statusCode: 500 });
    });
    expect(await enviarPushAoUsuario('user-1', payload)).toEqual({ enviados: 0, removidas: 2 });
    expect(h.inseridos.map((i) => [i.event_type, (i.event_data as { endpoint: string }).endpoint]).sort())
      .toEqual([['cancelada', FCM], ['cancelada', 'https://web.push.apple.com/a']].sort());
  });
});
