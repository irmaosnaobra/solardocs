import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// As rotas do painel da retomada dos usuários (03/11/2026): GET do estado, PUT da pausa e GET do modo seco. Login simulado como no painel do
// ensaio; o painel, o estado, o robô e as vagas da linha são trocados por espiões. Prova: 401, 403 (fora da equipe e não sócio), o 400 do PUT,
// o nome de quem pausou, o corte do `n` do seco entre 1 e 40 e que nenhuma rota importa ou chama envio.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  painel: vi.fn(),
  vagas: vi.fn(),
  pausar: vi.fn(),
  retomar: vi.fn(),
  seco: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: () => { throw new Error('sem banco neste teste'); } } }));
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
  },
}));
vi.mock('../services/agentes5040/replay', () => ({ runReplay: vi.fn() }));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ vagasDoFrioLinha: (...a: unknown[]) => h.vagas(...a) }));
vi.mock('../services/solardoc/retomadaUsuariosPainel', () => ({ lerPainelRetomada: (...a: unknown[]) => h.painel(...a) }));
vi.mock('../services/solardoc/retomadaUsuariosEstado', () => ({
  pausarRetomada: (...a: unknown[]) => h.pausar(...a), retomarRetomada: (...a: unknown[]) => h.retomar(...a),
}));
vi.mock('../services/solardoc/retomadaUsuarios', () => ({ sondarRetomadaUsuarios: (...a: unknown[]) => h.seco(...a) }));

import { mountRetomadaUsuarios } from '../routes/geradorRetomadaUsuarios';

const r = Router();
mountRetomadaUsuarios(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const THIAGO = 'Bearer tk-thiago';   // sócio e equipe
const NILCE = 'Bearer tk-nilce';     // equipe, não sócio
const FORA = 'Bearer tk-fora';       // consultor fora da equipe

const PAINEL = {
  estado: { ligada: true, motivo: 'ligada' }, pausa: null, enviadas_hoje: 3, enviadas_24h: 3, enviadas_7d: 9, enviadas_total: 12, ultima: '2026-11-05T17:00:00.000Z',
  fila: 41, fila_lida_em: '2026-11-05T17:00:00.000Z', linha_na_hora: 2, linha_limite: 4, responderam: 5, pararam: 1, voltaram_a_assinar: 0,
  inicio: '2026-11-04T12:00:00.000Z', parada: null,
};
const VAGAS = { hora: { teto: 6, usadas: 2 }, dia: { teto: 30, usadas: 12 } };

let erroConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env.CAIXA_EQUIPE; delete process.env.SOLAR_SOCIOS;
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-fora': 'fulano@irmaosnaobra.app' };
  h.painel.mockReset().mockResolvedValue(PAINEL);
  h.vagas.mockReset().mockResolvedValue(VAGAS);
  h.pausar.mockReset().mockResolvedValue(undefined);
  h.retomar.mockReset().mockResolvedValue(undefined);
  h.seco.mockReset().mockResolvedValue({ estado: { ligada: true, motivo: 'ligada' }, linhas: [{ posicao: 1, hmac8: 'abcd1234', situacao: 'elegivel' }] });
  erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { erroConsole.mockRestore(); vi.restoreAllMocks(); });

const ROTAS: Array<['get' | 'put', string]> = [
  ['get', '/gerador/ensaio/retomada-usuarios'], ['put', '/gerador/ensaio/retomada-usuarios'], ['get', '/gerador/ensaio/retomada-usuarios/fila?n=5'],
];

describe('travas de acesso', () => {
  it('sem token: 401 nas três rotas, sem cache', async () => {
    for (const [m, url] of ROTAS) {
      const res = await (request(app) as any)[m](url).send({ pausar: true });
      expect(res.status, `${m} ${url}`).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(h.painel).not.toHaveBeenCalled();
    expect(h.pausar).not.toHaveBeenCalled();
    expect(h.seco).not.toHaveBeenCalled();
  });

  it('consultor fora da equipe: 403 nas três rotas', async () => {
    for (const [m, url] of ROTAS) {
      const res = await (request(app) as any)[m](url).set('Authorization', FORA).send({ pausar: true });
      expect(res.status, `${m} ${url}`).toBe(403);
      expect(res.body.precisa).toBe('equipe');
    }
    expect(h.pausar).not.toHaveBeenCalled();
  });

  it('da equipe mas não sócio: 403 nas três rotas, e nada é lido nem gravado', async () => {
    for (const [m, url] of ROTAS) {
      const res = await (request(app) as any)[m](url).set('Authorization', NILCE).send({ pausar: true });
      expect(res.status, `${m} ${url}`).toBe(403);
      expect(res.body.precisa).toBe('socio');
    }
    expect(h.painel).not.toHaveBeenCalled();
    expect(h.pausar).not.toHaveBeenCalled();
    expect(h.retomar).not.toHaveBeenCalled();
    expect(h.seco).not.toHaveBeenCalled();
  });
});

describe('GET /ensaio/retomada-usuarios', () => {
  it('devolve o painel, o início, as vagas do frio, a linha na hora e o limite', async () => {
    const res = await request(app).get('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, inicio: '2026-11-04T12:00:00.000Z', vagas_do_frio: VAGAS, linha_na_hora: 2, linha_limite: 4, enviadas_hoje: 3, fila: 41,
      estado: { ligada: true }, parada: null,
    });
  });

  it('as vagas que não deram para ler vão como null, e a resposta segue (a tela escreve o sinal de "sem número")', async () => {
    h.vagas.mockRejectedValue(new Error('banco caiu'));
    const res = await request(app).get('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.vagas_do_frio).toBeNull();
    expect(res.body.enviadas_hoje).toBe(3);
  });

  it('erro do painel: 502 genérico, sem telefone e sem vazar a mensagem', async () => {
    h.painel.mockRejectedValue(new Error('falha com 5534991110001'));
    const res = await request(app).get('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/5534991110001|falha com/);
  });
});

describe('PUT /ensaio/retomada-usuarios', () => {
  it('pausar que não é booleano: 400, e nada é gravado', async () => {
    for (const corpo of [{}, { pausar: 'true' }, { pausar: 1 }, { pausar: null }]) {
      const res = await request(app).put('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO).send(corpo);
      expect(res.status, JSON.stringify(corpo)).toBe(400);
    }
    expect(h.pausar).not.toHaveBeenCalled();
    expect(h.retomar).not.toHaveBeenCalled();
  });

  it('pausar: true grava a pausa com o motivo painel e o nome de quem pediu, e devolve o painel', async () => {
    const res = await request(app).put('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO).send({ pausar: true });
    expect(res.status).toBe(200);
    expect(h.pausar).toHaveBeenCalledTimes(1);
    expect(h.pausar.mock.calls[0]![0]).toMatchObject({ motivo: 'painel', por: expect.stringMatching(/thiago/i) });
    expect(h.retomar).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: true, vagas_do_frio: VAGAS, fila: 41 });
  });

  it('pausar: false tira a pausa', async () => {
    const res = await request(app).put('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO).send({ pausar: false });
    expect(res.status).toBe(200);
    expect(h.retomar).toHaveBeenCalledTimes(1);
    expect(h.pausar).not.toHaveBeenCalled();
  });

  it('a gravação que falha vira 502: o botão não finge que pausou', async () => {
    h.pausar.mockRejectedValue(new Error('gravar a pausa da retomada'));
    const res = await request(app).put('/gerador/ensaio/retomada-usuarios').set('Authorization', THIAGO).send({ pausar: true });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /ensaio/retomada-usuarios/fila (o modo seco)', () => {
  it('o n fica entre 1 e 40, e sem n ou com n ilegível vale 20', async () => {
    const casos: Array<[string, number]> = [['', 20], ['?n=abc', 20], ['?n=0', 20], ['?n=7', 7], ['?n=100', 40], ['?n=-5', 1], ['?n=12.9', 12]];
    for (const [qs, esperado] of casos) {
      h.seco.mockClear();
      const res = await request(app).get(`/gerador/ensaio/retomada-usuarios/fila${qs}`).set('Authorization', THIAGO);
      expect(res.status, qs).toBe(200);
      expect(h.seco, qs).toHaveBeenCalledTimes(1);
      expect(h.seco.mock.calls[0]![0], qs).toEqual({ n: esperado });
    }
  });

  it('devolve o que o seco leu, sem telefone', async () => {
    const res = await request(app).get('/gerador/ensaio/retomada-usuarios/fila?n=5').set('Authorization', THIAGO);
    expect(res.body).toMatchObject({ ok: true, linhas: [{ posicao: 1, hmac8: 'abcd1234', situacao: 'elegivel' }] });
    expect(JSON.stringify(res.body)).not.toMatch(/\d{10,}/);
  });
});

describe('o arquivo das rotas não envia nada', () => {
  it('não importa nem cita envio (Z-API, sendFrio, sendHuman, phone-exists)', () => {
    const fonte = readFileSync(join(__dirname, '..', 'routes', 'geradorRetomadaUsuarios.ts'), 'utf8');
    const codigo = fonte.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codigo).not.toMatch(/sendFrio|sendHuman|sendWhatsApp|zapiPost|numeroTemWhatsApp|zapiClient|enviar\(/);
  });
});
