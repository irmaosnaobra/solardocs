import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// O limitador do PDF público (GET /p/:id/pdf da SolarDoc e /gerador/completa/:codigo/pdf) conta pelo IP REAL do cliente
// (clientIp, o X-Forwarded-For), não pelo req.ip: atrás do rewrite do dashboard o req.ip pode ser o do proxy, e todo visitante
// dividiria o mesmo teto de 20 por 15 minutos.

vi.mock('../controllers/trackingGeradorController', () => ({
  clientIp: (req: { headers: Record<string, string> }) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
}));

import { propostaPdfLimiter } from '../middleware/rateLimiter';

describe('propostaPdfLimiter pelo IP real', () => {
  it('IPs diferentes atrás do mesmo proxy têm tetos separados; o 21º do mesmo IP leva 429', async () => {
    const app = express();
    app.get('/pdf', propostaPdfLimiter, (_req, res) => { res.status(200).send('ok'); });
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get('/pdf').set('X-Forwarded-For', '203.0.113.10')).status).toBe(200);
    }
    expect((await request(app).get('/pdf').set('X-Forwarded-For', '203.0.113.10')).status).toBe(429);
    // outro cliente, mesmo socket (o proxy): segue livre
    expect((await request(app).get('/pdf').set('X-Forwarded-For', '203.0.113.11')).status).toBe(200);
  });
});
