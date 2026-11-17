import { describe, it, expect, afterAll } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A consulta de "o Pix foi pago?" (GET /payments/pix-recorrente/publico/:id, a cada 3 s) fica FORA do limite geral de 500 por IP
// a cada 15 min e tem limite próprio por IP (1.500 a cada 15 min). O limitador global é o de verdade, montado como no app.ts.

import { globalLimiter, pixStatusPublicoLimiter, ehStatusPixPublico } from '../middleware/rateLimiter';

describe('ehStatusPixPublico: o skip casa só o GET do status', () => {
  it('casa o GET, com ou sem query', () => {
    expect(ehStatusPixPublico('GET', '/payments/pix-recorrente/publico/11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(ehStatusPixPublico('GET', '/payments/pix-recorrente/publico/abc?qr=1')).toBe(true);
  });
  it('o POST que cria cobrança e outros métodos continuam no global', () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', undefined]) expect(ehStatusPixPublico(m, '/payments/pix-recorrente/publico/abc')).toBe(false);
    expect(ehStatusPixPublico('POST', '/payments/pix-recorrente/publico')).toBe(false);
  });
  it('rotas parecidas não casam', () => {
    const naoCasa = [
      '/payments/pix-recorrente/publico', '/payments/pix-recorrente/publico/', '/payments/pix-recorrente/publico/abc/x',
      '/payments/pix-recorrente/publico//abc', '/payments/pix-recorrente', '/payments/pix-recorrente/cancelar',
      '/payments/pix-avulso/publico/abc', '/payments/pix-recorrente/lead-lp', '/x/payments/pix-recorrente/publico/abc',
      '/payments/pix-recorrente/publico/abc#/x/y', '',
    ];
    for (const u of naoCasa) expect(ehStatusPixPublico('GET', u), u).toBe(false);
    expect(ehStatusPixPublico('GET', undefined)).toBe(false);
  });
});

it('a rota de verdade (routes/payments.ts) usa o limite próprio no GET do status e não no POST', () => {
  const fonte = readFileSync(join(__dirname, '../routes/payments.ts'), 'utf8');
  expect(fonte).toMatch(/router\.get\('\/pix-recorrente\/publico\/:id', pixStatusPublicoLimiter, statusPixPublicoHandler\)/);
  expect(fonte).not.toMatch(/router\.post\('\/pix-recorrente\/publico', pixStatusPublicoLimiter/);
});

const router = Router();
const ok = (_req: express.Request, res: express.Response) => { res.json({ ok: true }); };
router.get('/pix-recorrente/publico/:id', pixStatusPublicoLimiter, ok);
router.post('/pix-recorrente/publico', ok);
router.get('/comum', ok);
const app = express();
app.set('trust proxy', 1);
app.use(globalLimiter);                 // como no app.ts
app.use('/payments', router);
const servidor = app.listen(0);
afterAll(() => { servidor.close(); });

async function rajada(metodo: 'get' | 'post', rota: string, vezes: number, ip: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < vezes; i++) out.push((await request(servidor)[metodo](rota).set('X-Forwarded-For', ip)).status);
  return out;
}
const STATUS = '/payments/pix-recorrente/publico/abc';

describe('limitador global x consulta do Pix pago', () => {
  it('mais de 500 consultas do mesmo IP não gastam a conta global: o resto da API segue 200', async () => {
    const a = await rajada('get', STATUS, 520, '203.0.113.7');
    expect(a.every((s) => s === 200)).toBe(true);
    const comum = await request(servidor).get('/payments/comum').set('X-Forwarded-For', '203.0.113.7');
    expect(comum.status).toBe(200);
  });

  it('o POST de criar cobrança segue na conta global (501º do mesmo IP leva 429)', async () => {
    const a = await rajada('post', '/payments/pix-recorrente/publico', 500, '203.0.113.8');
    expect(a.every((s) => s === 200)).toBe(true);
    expect((await request(servidor).post('/payments/pix-recorrente/publico').set('X-Forwarded-For', '203.0.113.8')).status).toBe(429);
  });

  it('o limite próprio é de 1.500 por IP: o 1.501º leva 429 e outro IP não é afetado', async () => {
    const a = await rajada('get', STATUS, 1500, '203.0.113.9');
    expect(a.every((s) => s === 200)).toBe(true);
    const estourou = await request(servidor).get(STATUS).set('X-Forwarded-For', '203.0.113.9');
    expect(estourou.status).toBe(429);
    expect(estourou.body.error).toMatch(/Muitas consultas/);
    expect((await request(servidor).get(STATUS).set('X-Forwarded-For', '203.0.113.10')).status).toBe(200);
  });
}, 120_000);
