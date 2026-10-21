import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// A4: os avisos antigos saem cedo SÓ com o interruptor `ficha` ligado e SÓ para card que a ficha cobre.
// Aqui as rotas de verdade (ioEletroposto /alerta, ioSolar /alerta e /quiz/agendar) e o link do card.
// Banco e WhatsApp simulados.

const h = vi.hoisted(() => ({
  enviados: [] as Array<{ numero: string; texto: string }>,
  ficha: null as Record<string, unknown> | null,
  single: null as Record<string, unknown> | null,
  agend: null as Record<string, unknown> | null,
  capi: vi.fn(),
  usuarios: {} as Record<string, string>,
}));

vi.mock('../utils/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));
vi.mock('../utils/supabaseGerador', () => {
  const cadeia = (tabela: string) => {
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') return (ok: (v: unknown) => void) => ok({ data: [], error: null });
        if (k === 'single') return () => Promise.resolve({ data: h.single, error: null });
        if (k === 'maybeSingle') return () => Promise.resolve({ data: tabela === 'agendamentos' ? h.agend : null, error: null });
        return () => c;
      },
    });
    return c;
  };
  return {
    geradorComServiceKey: false,
    supabaseGerador: {
      from: (t: string) => cadeia(t),
      auth: {
        getUser: async (token: string) => {
          const email = h.usuarios[token];
          return email
            ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
            : { data: { user: null }, error: { message: 'jwt' } };
        },
      },
    },
  };
});
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (numero: string, texto: string) => { h.enviados.push({ numero, texto }); }),
}));
vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.capi }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/io/solarQuiz', async (orig) => {
  const real = await orig<typeof import('../services/io/solarQuiz')>();
  return {
    ...real,
    cabe: () => true,
    decidirEMontar: () => ({
      dec: {
        caminho: 'ligacao', motivo: 'x', kwh: 800, grande: false, cidade: { nome: 'Uberlândia', uf: 'MG' },
        pontos: 90, pontuacao: { pontos: 90, partes: [] }, candidatos: ['Diego'], qualifica: null,
      },
      dias: [], semHorario: false,
    }),
  };
});
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(() => ({})), garantirEstudo: vi.fn(async () => null) }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn(), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({
  geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
  funilEletropostoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
  caixaIpLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
  caixaPessoaLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
}));

import ioEletroposto from '../routes/ioEletroposto';
import ioSolar from '../routes/ioSolar';
import { mountCaixa } from '../routes/geradorCaixa';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/eletroposto', ioEletroposto);
app.use('/io/solar', ioSolar);
const caixa = Router();
mountCaixa(caixa);
app.use('/gerador', caixa);

let id = 5000;
const card = (extra: Record<string, unknown> = {}) => ({
  id, vendedor_nome: 'Diego', quando: '2026-10-21T17:30:00.000Z', cliente_nome: 'Camila Souza',
  cliente_telefone: '5534991113333', cidade: 'Uberlândia', temperatura: 'quente', created_at: new Date().toISOString(),
  created_by: 'lp_eletroposto', status: 'agendado',
  observacao: 'LP ELETROPOSTO · Posto\nPonto: Tenho o local\nNOTA 3 · 9/11 pts', ...extra,
});

beforeEach(() => {
  id += 1;
  h.enviados.length = 0; h.capi.mockReset().mockResolvedValue({ ok: true, status: 200 });
  h.agend = null;
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  process.env.AGENTES5040_FICHA = '1';
  process.env.ZAPI_INSTANCE_ID_IO = 'instancia-de-teste';
  delete process.env.CAIXA_EQUIPE;
  zerarCacheInterruptores();
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-fora': 'fulano@irmaosnaobra.app' };
});
afterEach(() => { delete process.env.AGENTES5040_FICHA; delete process.env.AGENTES5040_HMAC; });

describe('ioEletroposto /alerta', () => {
  const alertar = () => request(app).post('/io/eletroposto/alerta').send({ id });

  it('interruptor desligado: o aviso de sempre, para a equipe toda', async () => {
    process.env.AGENTES5040_FICHA = '0';
    h.single = card();
    const r = await alertar();
    expect(r.body).toEqual({ ok: true, enviados: 2 });
    expect(h.enviados).toHaveLength(2);
  });

  it('ligado: sai cedo, nenhum aviso antigo, resposta ok', async () => {
    h.single = card();
    const r = await alertar();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, enviados: 0, substituido_pela_ficha: true });
    expect(h.enviados).toEqual([]);
  });

  it('ligado mas o card está cancelado: a ficha não cobre, então o aviso antigo sai (nunca zero)', async () => {
    h.single = card({ status: 'cancelado' });
    const r = await alertar();
    expect(r.body).toEqual({ ok: true, enviados: 2 });
  });
});

describe('ioSolar /alerta e o aviso do quiz ao dono', () => {
  const alertar = () => request(app).post('/io/solar/alerta').send({ id });
  const solar = (extra: Record<string, unknown> = {}) => card({ created_by: 'lp_solar', observacao: 'LP SOLAR — Casa\nConta de luz: R$ 600', ...extra });

  it('/alerta desligado: avisa a equipe inteira; ligado: sai cedo; ligado e cancelado: avisa', async () => {
    process.env.AGENTES5040_FICHA = '0';
    h.single = solar();
    expect((await alertar()).body.enviados).toBe(3);
    id += 1; h.enviados.length = 0; process.env.AGENTES5040_FICHA = '1'; h.single = solar();
    expect((await alertar()).body).toEqual({ ok: true, enviados: 0, substituido_pela_ficha: true });
    expect(h.enviados).toEqual([]);
    id += 1; h.single = solar({ status: 'cancelado' });
    expect((await alertar()).body.enviados).toBe(3);
  });

  const agendar = {
    nome: 'Ana Souza', tel: '5534991112222',
    respostas: { conta: '2000_5000', cidade: 'Uberlândia-MG', urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', tipo: 'empresa' },
    ymd: '2026-10-21', h: '09:00', dono: 'Diego', event_id: 'agd_abc123xyz',
  };
  const quiz = () => {
    h.single = { id: 77, vendedor_nome: 'Diego', quando: 'x', cliente_nome: 'Ana Souza', cliente_telefone: '5534991112222', observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO' };
    return request(app).post('/io/solar/quiz/agendar').send(agendar);
  };

  it('quiz desligado: o dono recebe o aviso de sempre', async () => {
    process.env.AGENTES5040_FICHA = '0';
    const r = await quiz();
    expect(r.status).toBe(200);
    expect(h.enviados).toHaveLength(1);
  });

  it('quiz ligado: nenhum aviso antigo ao dono, e a API de Conversões (Schedule) segue como sempre', async () => {
    const r = await quiz();
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(h.enviados).toEqual([]);
    expect(h.capi.mock.calls.map(c => c[0]).some(e => e.nome === 'Schedule')).toBe(true);
  });
});

describe('GET /gerador/caixa/do-card: o link da ficha (?card=<id>)', () => {
  const THIAGO = 'Bearer tk-thiago';
  const FORA = 'Bearer tk-fora';

  it('sem login 401; fora da equipe 403 sem tocar no card', async () => {
    expect((await request(app).get('/gerador/caixa/do-card?id=5')).status).toBe(401);
    h.agend = { id: 5, cliente_nome: 'Camila', cliente_telefone: '5534991113333' };
    const r = await request(app).get('/gerador/caixa/do-card?id=5').set('Authorization', FORA);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toMatch(/Camila|91113333/);
  });

  it('com login e equipe: devolve a chave do contato (DDD + 8) e o nome, nunca o telefone inteiro', async () => {
    h.agend = { id: 5, cliente_nome: 'Camila', cliente_telefone: '5534991113333' };
    const r = await request(app).get('/gerador/caixa/do-card?id=5').set('Authorization', THIAGO);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, chave: '3491113333', nome: 'Camila' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(r.body)).not.toContain('5534991113333');
  });

  it('id inválido 400; card inexistente ou sem telefone 404', async () => {
    for (const q of ['', 'abc', '0', '-3', '1e3', '5;drop']) {
      expect((await request(app).get('/gerador/caixa/do-card?id=' + encodeURIComponent(q)).set('Authorization', THIAGO)).status, q).toBe(400);
    }
    h.agend = null;
    expect((await request(app).get('/gerador/caixa/do-card?id=5').set('Authorization', THIAGO)).status).toBe(404);
    h.agend = { id: 5, cliente_nome: 'Camila', cliente_telefone: '' };
    expect((await request(app).get('/gerador/caixa/do-card?id=5').set('Authorization', THIAGO)).status).toBe(404);
  });
});
