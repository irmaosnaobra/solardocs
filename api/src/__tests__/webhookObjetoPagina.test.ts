import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// O endereço /instagram/webhook é o MESMO app da Página do Facebook. Enquanto a
// Página não tinha o app inscrito (subscribed_apps vazio), ela nunca mandou
// nada aqui. No dia em que a inscrição entra, para o private_replies do
// fbComentarios voltar a funcionar, a Página passa a mandar `entry.messaging`
// com PSID de Messenger neste mesmo endereço.
//
// PSID de Messenger não é id de Instagram. Sem a trava de `body.object`, esse
// id entrava no motor do Instagram e ia responder em /{ig-user}/messages: ou
// fala na conta errada, ou vira enxurrada de falha no app de onde a Carla
// também responde. O Facebook é atendido por varredura, não por este webhook.

vi.mock('../services/instagram/igClient', async () => {
  const real = await vi.importActual<any>('../services/instagram/igClient');
  return { ...real, verifyHmac: () => true, getIgConfig: async () => ({ ig_user_id: '17841475845665007' }) };
});
vi.mock('../services/instagram/igEngine', () => ({
  handleComment: vi.fn(async () => {}),
  handleMessage: vi.fn(async () => {}),
  drainIgQueue: vi.fn(async () => ({})),
}));

import request from 'supertest';
import app from '../app';
import { handleComment, handleMessage } from '../services/instagram/igEngine';

const envia = (body: any) =>
  request(app).post('/instagram/webhook').set('Content-Type', 'application/json').send(JSON.stringify(body));

describe('o webhook do Instagram só atende o Instagram', () => {
  beforeEach(() => vi.clearAllMocks());

  it('evento da PÁGINA do Facebook é descartado, não vira resposta', async () => {
    const r = await envia({
      object: 'page',
      entry: [{ id: '704395102766155', messaging: [{ sender: { id: '28002003082829032' }, message: { text: 'oi' } }] }],
    });
    expect(r.status).toBe(200);
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it('comentário vindo como objeto page também fica de fora', async () => {
    const r = await envia({
      object: 'page',
      entry: [{ id: '704395102766155', changes: [{ field: 'comments', value: { id: 'x_1', text: 'tenho interesse' } }] }],
    });
    expect(r.status).toBe(200);
    expect(handleComment).not.toHaveBeenCalled();
  });

  it('evento do Instagram continua passando igual a antes', async () => {
    const r = await envia({
      object: 'instagram',
      entry: [{ id: '17841475845665007', changes: [{ field: 'comments', value: { id: 'ig_1', text: 'quero' } }] }],
    });
    expect(r.status).toBe(200);
    expect(handleComment).toHaveBeenCalledTimes(1);
  });

  it('corpo sem `object` não é barrado, para não quebrar chamada de teste da Meta', async () => {
    const r = await envia({
      entry: [{ id: '17841475845665007', messaging: [{ sender: { id: 'ig_2' }, message: { text: 'oi' } }] }],
    });
    expect(r.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});
