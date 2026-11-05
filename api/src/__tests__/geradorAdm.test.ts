import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ADM do /gerador (fase 0): a regra de quem é ADM, o middleware e a fiação nas rotas.
// Login simulado pelo mapa de tokens; nenhum banco é lido.

const h = vi.hoisted(() => ({ usuarios: {} as Record<string, string> }));

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
    from: () => { throw new Error('nenhum banco deveria ser lido aqui'); },
  },
}));

import { listaAdm, ehAdm, ehSocio } from '../services/gerador/solarObras';
import { exigeAdm, soAdmLogado } from '../routes/geradorAdm';

beforeEach(() => {
  delete process.env.SOLAR_ADM;
  h.usuarios = {
    'tk-thiago': 'thiago@irmaosnaobra.app',
    'tk-diego': 'diego@irmaosnaobra.app',
    'tk-nilce': 'nilce@irmaosnaobra.app',
  };
});
afterEach(() => { delete process.env.SOLAR_ADM; });

describe('listaAdm e ehAdm', () => {
  it('sem env, vazia, só espaço ou só vírgula: a lista é ["thiago"]', () => {
    expect(listaAdm()).toEqual(['thiago']);
    expect(listaAdm('')).toEqual(['thiago']);
    expect(listaAdm('  ')).toEqual(['thiago']);
    expect(listaAdm(' , ')).toEqual(['thiago']);
  });
  it('Thiago passa em qualquer caixa e com espaços', () => {
    expect(ehAdm('thiago')).toBe(true);
    expect(ehAdm('Thiago')).toBe(true);
    expect(ehAdm(' THIAGO ')).toBe(true);
  });
  it('os outros e o que não é nome não passam (nem sem acento)', () => {
    expect(ehAdm('thiagó')).toBe(false);
    expect(ehAdm('diego')).toBe(false);
    expect(ehAdm('nilce')).toBe(false);
    expect(ehAdm('')).toBe(false);
    expect(ehAdm(undefined as any)).toBe(false);
  });
  it('a env passada por argumento decide', () => {
    expect(ehAdm('thiago', 'diego')).toBe(false);
    expect(ehAdm('diego', 'diego')).toBe(true);
  });
  it('SOLAR_ADM do ambiente decide', () => {
    process.env.SOLAR_ADM = 'nilce';
    expect(ehAdm('nilce')).toBe(true);
    expect(ehAdm('thiago')).toBe(false);
  });
  it('SOLAR_ADM com e-mail, caixa e acento vira o nome do login', () => {
    expect(listaAdm('Thiago@irmaosnaobra.app, ')).toEqual(['thiago']);
    expect(listaAdm(' Thiagó@irmaosnaobra.app , NILCE ')).toEqual(['thiago', 'nilce']);
    process.env.SOLAR_ADM = 'Thiago@irmaosnaobra.app, ';
    expect(ehAdm('thiago')).toBe(true);
    expect(ehAdm('diego')).toBe(false);
    expect(ehAdm('thiagó')).toBe(false);
  });
  it('o ADM não mexe no sócio: Diego continua sócio', () => {
    expect(ehSocio('diego')).toBe(true);
  });
});

describe('exigeAdm isolado', () => {
  const app = express();
  app.use((req, _res, next) => { (req as any).consultor = { nome: req.header('x-nome') }; next(); });
  app.get('/x', exigeAdm, (_req, res) => { res.json({ ok: true }); });

  it('thiago: 200', async () => {
    expect((await request(app).get('/x').set('x-nome', 'thiago')).status).toBe(200);
  });
  it('diego e nilce: 403 precisa adm', async () => {
    for (const nome of ['diego', 'nilce']) {
      const res = await request(app).get('/x').set('x-nome', nome);
      expect(res.status).toBe(403);
      expect(res.body.precisa).toBe('adm');
      expect(res.body.ok).toBe(false);
    }
  });
  it('sem nome: 403', async () => {
    expect((await request(app).get('/x')).status).toBe(403);
  });
});

describe('soAdmLogado com login', () => {
  const app = express();
  app.get('/x', ...soAdmLogado, (_req, res) => { res.json({ ok: true }); });

  it('sem Authorization: 401 precisa login (o login vem antes do ADM)', async () => {
    const res = await request(app).get('/x');
    expect(res.status).toBe(401);
    expect(res.body.precisa).toBe('login');
  });
  it('token do Diego: 403 precisa adm', async () => {
    const res = await request(app).get('/x').set('Authorization', 'Bearer tk-diego');
    expect(res.status).toBe(403);
    expect(res.body.precisa).toBe('adm');
  });
  it('token do Thiago: 200', async () => {
    expect((await request(app).get('/x').set('Authorization', 'Bearer tk-thiago')).status).toBe(200);
  });
});

describe('a fiação no código', () => {
  const gerador = readFileSync(join(__dirname, '../routes/gerador.ts'), 'utf8');
  const solar = readFileSync(join(__dirname, '../routes/geradorSolar.ts'), 'utf8');
  const pares: Array<[string, string]> = [
    ['put', '/agentes/cerebro/:id'], ['delete', '/agentes/cerebro/:id'], ['post', '/agentes/conversar/:id'],
    ['get', '/cobranca/taxas'], ['post', '/cobranca/montar'], ['post', '/cobranca/simular'], ['post', '/cobranca/criar'],
    ['get', '/cobranca/lista'], ['post', '/cobranca/antecipar/simular'], ['post', '/cobranca/antecipar'],
  ];
  for (const [metodo, caminho] of pares) {
    it(`${metodo.toUpperCase()} ${caminho} leva ...soAdmLogado`, () => {
      const re = new RegExp(`router\\.${metodo}\\('${caminho.replace(/[/:]/g, (c) => '\\' + c)}',\\s*\\.\\.\\.soAdmLogado,`);
      expect(gerador).toMatch(re);
    });
  }
  it('GET /solar/painel leva exigeConsultor e exigeAdm', () => {
    expect(solar).toMatch(/router\.get\('\/solar\/painel',\s*exigeConsultor,\s*exigeAdm,/);
  });
});
