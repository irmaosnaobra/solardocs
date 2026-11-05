import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// O rate limit do lead-lp: 5 por hora por IP e o teto GLOBAL da rota de 30 por hora (chefe anti-ban, 05/11/2026). Sem Upstash: limitador em memória.

vi.mock('../controllers/trackingGeradorController', () => ({
  clientIp: (req: { headers: Record<string, string | string[] | undefined> }) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'sem-ip',
}));

import { pixLeadLpRateLimit } from '../middleware/pixPublicoRateLimit';

const app = () => {
  const a = express();
  a.post('/lead-lp', pixLeadLpRateLimit, (_req, res) => { res.json({ ok: true }); });
  return a;
};
const chamar = (a: express.Express, ip: string) => request(a).post('/lead-lp').set('x-forwarded-for', ip);

describe('lead-lp: teto por IP e teto global', () => {
  const a = app();
  it('5 por hora por IP: a 6ª do mesmo IP é 429 (com Retry-After)', async () => {
    for (let i = 0; i < 5; i++) expect((await chamar(a, '10.0.0.1')).status).toBe(200);
    const sexta = await chamar(a, '10.0.0.1');
    expect(sexta.status).toBe(429);
  });
  it('30 por hora no TOTAL, de qualquer IP: a 31ª (de um IP novo) é 429', async () => {
    // já passaram 5 (IP 10.0.0.1). Mais 25 IPs diferentes completam os 30.
    for (let i = 2; i < 27; i++) expect((await chamar(a, `10.0.1.${i}`)).status, `IP ${i}`).toBe(200);
    const trinta_e_um = await chamar(a, '10.0.9.9');
    expect(trinta_e_um.status).toBe(429);
    expect(trinta_e_um.body.error).toMatch(/Muitas tentativas/);
  });
});
