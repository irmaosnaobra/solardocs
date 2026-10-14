import { describe, it, expect, vi, afterAll } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Limitadores da caixa (/gerador/caixa/*): ficam FORA da conta do limitador global (500 por 15 min por IP) e têm
// limite próprio, por pessoa. Aqui o limitador global é o de verdade, montado como no app.ts, e o login e o banco são
// simulados. Dados inventados.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, is: () => q, maybeSingle: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: { value: { downStreak: 0 }, updated_at: new Date().toISOString() }, error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const nome = token.replace('tk-', '');
        return { data: { user: { email: `${nome}@irmaosnaobra.app`, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null };
      }),
    },
  },
}));

import { globalLimiter } from '../middleware/rateLimiter';
import { mountCaixa } from '../routes/geradorCaixa';

const router = Router();
mountCaixa(router);
router.get('/comum', (_req, res) => { res.json({ ok: true }); });
const app = express();
app.set('trust proxy', 1);
app.use(globalLimiter);                 // como no app.ts
app.use('/gerador', router);
const servidor = app.listen(0);
afterAll(() => { servidor.close(); });

const pessoa = (nome: string) => `Bearer tk-${nome}`;
async function rajada(nome: string, vezes: number, rota = '/gerador/caixa/estado'): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < vezes; i++) {
    const r = await request(servidor).get(rota).set('Authorization', pessoa(nome)).set('X-Forwarded-For', '203.0.113.7');
    out.push(r.status);
  }
  return out;
}

describe('limitadores da caixa', () => {
  it('3 pessoas do mesmo IP consultando a caixa (750 pedidos) não derrubam uma rota comum do gerador', async () => {
    const [a, b, c] = await Promise.all([rajada('thiago', 250), rajada('diego', 250), rajada('giovanna', 250)]);
    expect([...a, ...b, ...c].every((s) => s === 200)).toBe(true);
    // 750 > 500 (o teto global): se a caixa entrasse na conta, a rota comum já estaria barrada.
    const comum = await request(servidor).get('/gerador/comum').set('X-Forwarded-For', '203.0.113.7');
    expect(comum.status).toBe(200);
    expect(comum.body.ok).toBe(true);
  }, 120_000);

  it('o limitador global continua valendo para as rotas comuns (500 por IP)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 502; i++) {
      const r = await request(servidor).get('/gerador/comum').set('X-Forwarded-For', '198.51.100.9');
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 500).every((s) => s === 200)).toBe(true);
    expect(statuses[500]).toBe(429);
  }, 120_000);

  it('uma pessoa acima do teto dela (600) recebe 429 com Retry-After só na caixa; a outra pessoa e a rota comum seguem', async () => {
    const r = await rajada('nilce', 600);
    expect(r.every((s) => s === 200)).toBe(true);
    const acima = await request(servidor).get('/gerador/caixa/estado').set('Authorization', pessoa('nilce')).set('X-Forwarded-For', '192.0.2.50');
    expect(acima.status).toBe(429);
    expect(Number(acima.headers['retry-after'])).toBeGreaterThan(0);
    expect(acima.headers['cache-control']).toBe('no-store');
    expect(acima.body.ok).toBe(false);
    // Outra pessoa, mesmo IP: segue.
    const outra = await request(servidor).get('/gerador/caixa/estado').set('Authorization', pessoa('diego')).set('X-Forwarded-For', '192.0.2.50');
    expect(outra.status).toBe(200);
    // Rota comum do gerador, mesmo IP: segue.
    const comum = await request(servidor).get('/gerador/comum').set('X-Forwarded-For', '192.0.2.50');
    expect(comum.status).toBe(200);
  }, 120_000);

  it('o 429 não expõe o token nem o e-mail', async () => {
    const acima = await request(servidor).get('/gerador/caixa/estado').set('Authorization', pessoa('nilce')).set('X-Forwarded-For', '192.0.2.50');
    expect(acima.status).toBe(429);
    expect(JSON.stringify(acima.body) + JSON.stringify(acima.headers)).not.toMatch(/tk-nilce|nilce@/);
  });
});
