import { describe, it, expect, afterAll } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Envio de anexos da venda (POST .../docs/upload-url e POST .../docs): FORA da conta do limitador global (500 por 15 min
// por IP) e com limite próprio por pessoa (400 por 15 min). O limitador global é o de verdade, montado como no app.ts
// (sem prefixo); as rotas são de mentira, só para ter por onde passar. Dados inventados.

import { globalLimiter, docsEnvioLimiter, ehEnvioDeDocs } from '../middleware/rateLimiter';

describe('ehEnvioDeDocs: o skip casa só os dois POSTs de anexo', () => {
  it('casa os dois pedidos, com ou sem query, nas duas linhas', () => {
    expect(ehEnvioDeDocs('POST', '/gerador/clientes/eletroposto/101/docs/upload-url')).toBe(true);
    expect(ehEnvioDeDocs('POST', '/gerador/clientes/solar/0057/docs')).toBe(true);
    expect(ehEnvioDeDocs('POST', '/gerador/clientes/solar/57/docs?x=1')).toBe(true);
    expect(ehEnvioDeDocs('POST', '/gerador/clientes/eletroposto/9/docs/upload-url?a=b')).toBe(true);
  });
  it('outros métodos na mesma rota continuam contando no global', () => {
    for (const m of ['GET', 'DELETE', 'PATCH', 'PUT', 'HEAD', undefined]) {
      expect(ehEnvioDeDocs(m, '/gerador/clientes/eletroposto/101/docs')).toBe(false);
      expect(ehEnvioDeDocs(m, '/gerador/clientes/eletroposto/101/docs/upload-url')).toBe(false);
    }
  });
  it('rotas parecidas e outras rotas de docs, cadastro e relatório não casam', () => {
    const naoCasa = [
      '/gerador/clientes/eletroposto/1/docs/x/upload-url',
      '/gerador/clientes/eletroposto/1/docs/upload-url/x',
      '/gerador/clientes/eletroposto/1/docs/00000000-0000-4000-8000-000000000000',   // DELETE e PATCH
      '/gerador/clientes/eletroposto/1/docs/',
      '/gerador/clientes/eletroposto/1/docs//upload-url',
      '/gerador/clientes/eletroposto/1/cadastro/ler',
      '/gerador/clientes/eletroposto/1/relatorio',
      '/gerador/clientes/solar/1/vincular-proposta',
      '/gerador/clientes/outra/1/docs',
      '/gerador/clientes/solar/abc/docs',
      '/gerador/clientes/solar/%2523x/docs',
      '/gerador/clientes/solar/../eletroposto/1/docs',
      '/gerador/clientes/solar/1/../docs',
      '/gerador/clientes/solar/1/docs/..',
      '/gerador/clientes/solar/../docs',
      '/gerador/clientes/solar//docs',
      '/gerador/clientes/solar/1234567890123/docs',
      '/x/gerador/clientes/solar/1/docs',
      '/gerador/clientes/solar/1/docs#/upload-url/x',
      '/gerador/caixa/estado',
      '',
    ];
    for (const u of naoCasa) expect(ehEnvioDeDocs('POST', u), u).toBe(false);
    expect(ehEnvioDeDocs('POST', undefined)).toBe(false);
  });
});

// Login de mentira: o cabeçalho X-Pessoa vira o e-mail do consultor (o que o `exigeConsultor` faz de verdade).
const router = Router();
router.use((req, _res, next) => { const p = req.header('x-pessoa'); if (p) (req as any).consultor = { email: `${p}@irmaosnaobra.app` }; next(); });
const ok = (_req: express.Request, res: express.Response) => { res.json({ ok: true }); };
router.post('/clientes/:linha/:codigo/docs/upload-url', docsEnvioLimiter, ok);
router.post('/clientes/:linha/:codigo/docs', docsEnvioLimiter, ok);
router.get('/clientes/:linha/:codigo/docs', ok);
router.patch('/clientes/:linha/:codigo/docs/:id', ok);
router.post('/clientes/:linha/:codigo/docs/:x/upload-url', ok);
router.get('/comum', ok);
const app = express();
app.set('trust proxy', 1);
app.use(globalLimiter);                 // como no app.ts
app.use('/gerador', router);
const servidor = app.listen(0);
afterAll(() => { servidor.close(); });

async function rajada(metodo: 'get' | 'post' | 'patch', rota: string, vezes: number, ip: string, pessoa?: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < vezes; i++) {
    let r = request(servidor)[metodo](rota).set('X-Forwarded-For', ip);
    if (pessoa) r = r.set('X-Pessoa', pessoa);
    out.push((await r).status);
  }
  return out;
}
const UP = '/gerador/clientes/eletroposto/101/docs/upload-url';
const REG = '/gerador/clientes/eletroposto/101/docs';

describe('limitador global x envio de anexos', () => {
  it('um lote que passa de 500 pedidos (upload-url + registro) do mesmo IP não gasta a conta global', async () => {
    const [a, b] = await Promise.all([rajada('post', UP, 150, '203.0.113.7', 'thiago'), rajada('post', REG, 150, '203.0.113.7', 'diego')]);
    const c = await rajada('post', UP, 150, '203.0.113.7', 'giovanna');
    expect([...a, ...b, ...c].every((s) => s === 200)).toBe(true);   // 450 aqui
    const d = await rajada('post', REG, 100, '203.0.113.7', 'nilce');
    expect(d.every((s) => s === 200)).toBe(true);                     // 550 no total
    const comum = await request(servidor).get('/gerador/comum').set('X-Forwarded-For', '203.0.113.7');
    expect(comum.status).toBe(200);
  }, 120_000);

  it('GET docs continua contando no global: o 501º do mesmo IP é barrado', async () => {
    const s = await rajada('get', REG, 502, '198.51.100.1', 'thiago');
    expect(s.slice(0, 500).every((x) => x === 200)).toBe(true);
    expect(s[500]).toBe(429);
  }, 120_000);

  it('PATCH e a rota parecida /docs/x/upload-url continuam contando no global', async () => {
    const p = await rajada('patch', `${REG}/00000000-0000-4000-8000-000000000000`, 502, '198.51.100.2', 'thiago');
    expect(p[500]).toBe(429);
    const q = await rajada('post', '/gerador/clientes/eletroposto/1/docs/x/upload-url', 502, '198.51.100.3', 'thiago');
    expect(q[500]).toBe(429);
  }, 120_000);
});

describe('docsEnvioLimiter: 400 por 15 minutos, por pessoa', () => {
  it('o 401º da mesma pessoa leva 429 no formato das rotas de docs; outra pessoa do mesmo IP segue', async () => {
    const s = await rajada('post', UP, 401, '192.0.2.10', 'lote');
    expect(s.slice(0, 400).every((x) => x === 200)).toBe(true);
    expect(s[400]).toBe(429);
    const barrada = await request(servidor).post(REG).set('X-Forwarded-For', '192.0.2.10').set('X-Pessoa', 'lote');   // upload-url e registro dividem a conta
    expect(barrada.status).toBe(429);
    expect(barrada.body).toEqual({ ok: false, error: 'Muitos envios seguidos. Espere alguns minutos e continue.' });
    const outra = await request(servidor).post(UP).set('X-Forwarded-For', '192.0.2.10').set('X-Pessoa', 'outra');
    expect(outra.status).toBe(200);
  }, 120_000);
  // O envio sem login não chega aqui: quem barra é o `docsEnvioIpLimiter`, testado com as rotas de verdade em fichasDocs.route.test.ts.
});
