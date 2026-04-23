import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// ─── mocks globais antes de importar app ────────────────────────────
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      neq:    vi.fn().mockReturnThis(),
      not:    vi.fn().mockReturnThis(),
      lt:     vi.fn().mockReturnThis(),
      in:     vi.fn().mockReturnThis(),
      gte:    vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  handleIncomingWhatsApp: vi.fn().mockResolvedValue(undefined),
  processMessageQueue:    vi.fn().mockResolvedValue({ processed: 0 }),
  sendWelcomeWhatsApp:    vi.fn().mockResolvedValue(undefined),
}));

import app from '../app';
import { handleIncomingWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';

// ─── testes do webhook WhatsApp ──────────────────────────────────────
describe('POST /webhook/whatsapp', () => {
  it('retorna 200 para mensagem válida', async () => {
    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({
        phone: '5534991360223',
        text: 'tenho interesse em energia solar',
        fromMe: false,
        isGroup: false,
        senderName: 'João',
      }));

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('retorna 200 mesmo sem body', async () => {
    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'text/plain')
      .send('');

    expect(res.status).toBe(200);
  });

  it('ignora mensagens enviadas pelo próprio bot (fromMe: true)', async () => {
    vi.clearAllMocks();

    await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({
        phone: '5534991360223',
        text: 'mensagem enviada pelo bot',
        fromMe: true,
        isGroup: false,
      }));

    expect(handleIncomingWhatsApp).not.toHaveBeenCalled();
  });

  it('ignora mensagens de grupo', async () => {
    vi.clearAllMocks();

    await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({
        phone: '5534991360223',
        text: 'mensagem no grupo',
        fromMe: false,
        isGroup: true,
      }));

    expect(handleIncomingWhatsApp).not.toHaveBeenCalled();
  });

  it('captura ctwa_clid de anúncio Meta', async () => {
    vi.clearAllMocks();

    await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({
        phone: '5534991360223',
        text: 'oi',
        fromMe: false,
        isGroup: false,
        externalAdReply: { ctwaClid: 'abc123' },
      }));

    expect(handleIncomingWhatsApp).toHaveBeenCalledWith(
      '5534991360223',
      'oi',
      undefined,
      expect.objectContaining({ ctwa_clid: 'abc123' }),
    );
  });
});

describe('GET /webhook/whatsapp', () => {
  it('retorna status online', async () => {
    const res = await request(app).get('/webhook/whatsapp');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'webhook online');
  });
});
