import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// A chave do limite da rota pública de Pix é o IP REAL do cliente (1º valor do x-forwarded-for),
// não req.ip: o quiz chama pela reescrita /_api do dashboard e todo visitante poderia cair no
// mesmo balde. Sem Upstash, o limitador em memória é PRÓPRIO desta rota (5 por hora) e usa a
// mesma chave.

vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn() }));

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let pixPublicoRateLimit: typeof import('../middleware/pixPublicoRateLimit').pixPublicoRateLimit;
beforeAll(async () => {
  ({ pixPublicoRateLimit } = await import('../middleware/pixPublicoRateLimit'));
});

function app() {
  const a = express();
  a.set('trust proxy', 1);
  a.post('/pix/publico', pixPublicoRateLimit, (_req, res) => { res.json({ ok: true }); });
  return a;
}

const chamar = (a: express.Express, ip: string) =>
  request(a).post('/pix/publico').set('x-forwarded-for', ip);

describe('pixPublicoRateLimit (fallback em memória)', () => {
  it('o mesmo visitante, acima do teto de 5, recebe 429 com Retry-After', async () => {
    const a = app();
    for (let i = 0; i < 5; i++) expect((await chamar(a, '203.0.113.10')).status).toBe(200);
    const sexta = await chamar(a, '203.0.113.10');
    expect(sexta.status).toBe(429);
    expect(sexta.body.error).toMatch(/Muitas tentativas/);
  });

  it('dois visitantes com x-forwarded-for diferentes não dividem o teto', async () => {
    const a = app();
    for (let i = 0; i < 5; i++) await chamar(a, '203.0.113.20');
    expect((await chamar(a, '203.0.113.20')).status).toBe(429);
    expect((await chamar(a, '203.0.113.21')).status).toBe(200);
  });

  it('usa o 1º valor do x-forwarded-for (cliente), não o último (proxy)', async () => {
    const a = app();
    // mesmo proxy no fim da lista, clientes diferentes no começo: baldes separados
    for (let i = 0; i < 5; i++) await chamar(a, '203.0.113.30, 76.76.21.21');
    expect((await chamar(a, '203.0.113.30, 76.76.21.21')).status).toBe(429);
    expect((await chamar(a, '203.0.113.31, 76.76.21.21')).status).toBe(200);
  });

  it('não divide balde com o limitador do formulário de indicação', async () => {
    const { indicacaoLimiter } = await import('../middleware/rateLimiter');
    const b = express();
    b.set('trust proxy', 1);
    b.post('/indicacao', indicacaoLimiter, (_req, res) => { res.json({ ok: true }); });
    for (let i = 0; i < 8; i++) await request(b).post('/indicacao').set('x-forwarded-for', '203.0.113.40');
    expect((await request(b).post('/indicacao').set('x-forwarded-for', '203.0.113.40')).status).toBe(429);
    expect((await chamar(app(), '203.0.113.40')).status).toBe(200);
  });
});
