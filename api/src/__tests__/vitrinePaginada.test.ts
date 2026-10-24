import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// As leituras de `agendamentos` que alimentam a VITRINE (GET /agenda do solar e do
// eletroposto, e o lerOcupacoes do quiz solar) usavam `.limit(500)` e `.limit(2000)`.
// O PostgREST corta em 1000 linhas e ignora o limit maior: com a agenda passando
// disso, horário ocupado aparecia livre. Agora lêem em páginas (lerPaginado).
// O banco falso devolve de 1000 em 1000, como o PostgREST, e o teste prova que as
// 2.300 linhas chegam e que erro na 2ª página cai na falha que a rota já tratava:
//   GET /agenda  -> `ocupados: null` (a página avisa)
//   POST /quiz   -> 503 'agenda indisponivel' (a vitrine não abre)

type Linha = Record<string, any>;
const h = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, any>>,
  paginas: [] as number[],
  falhaNaPagina: 0,
  vistas: -1,
}));

vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: vi.fn() }));
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn().mockResolvedValue(false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/agenda/filaContaBaixa', () => ({ proximoDaContaBaixa: vi.fn().mockResolvedValue('Nilce') }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(), garantirEstudo: vi.fn() }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn().mockResolvedValue([]), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(), funilEletropostoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(), quizCardLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/io/solarQuiz', async (orig) => {
  const real = await orig<typeof import('../services/io/solarQuiz')>();
  return {
    ...real,
    // Só registra o que a rota leu; a decisão em si não é o assunto aqui.
    decidirEMontar: (_resp: unknown, _dono: unknown, ocupacoes: unknown[]) => {
      h.vistas = ocupacoes.length;
      return {
        dec: {
          caminho: 'curioso', motivo: 'x', kwh: 800, grande: false, cidade: { nome: 'Uberlândia', uf: 'MG' },
          pontos: 10, pontuacao: { pontos: 10, partes: [] }, candidatos: ['Diego'], qualifica: null,
        },
        dias: [], semHorario: false,
      };
    },
  };
});
vi.mock('../utils/supabaseGerador', () => {
  // O PostgREST devolve no máximo 1000 linhas por resposta, mesmo se pedirem mais.
  const CORTE = 1000;
  const cadeia = (tabela: string) => {
    let faixa: [number, number] | null = null;
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') return (ok: (v: unknown) => void) => {
          if (tabela !== 'agendamentos' || !faixa) return ok({ data: [], error: null, count: 0 });
          const [de, ate] = faixa;
          h.paginas.push(de);
          if (h.falhaNaPagina === de / CORTE + 1) return ok({ data: null, error: { message: 'caiu' } });
          return ok({ data: h.linhas.slice(de, de + Math.min(CORTE, ate - de + 1)).map(l => ({ ...l })), error: null });
        };
        if (k === 'single') return () => Promise.resolve({ data: null, error: { message: 'sem' } });
        return (...a: unknown[]) => { if (k === 'range') faixa = [a[0] as number, a[1] as number]; return c; };
      },
    });
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});

import solar from '../routes/ioSolar';
import eletroposto from '../routes/ioEletroposto';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/solar', solar);
app.use('/io/eletroposto', eletroposto);

const DIA0 = Date.parse('2026-11-04T11:00:00.000Z');
const fichas = (n: number, created_by: string): Linha[] =>
  Array.from({ length: n }, (_, i) => ({
    quando: new Date(DIA0 + i * 60_000).toISOString(),
    vendedor_nome: i % 2 ? 'Thiago' : 'Diego',
    created_by,
    status: 'agendado',
  }));
const JANELA = '?de=2026-11-02T00:00:00.000Z&ate=2026-11-23T00:00:00.000Z';
const quiz = {
  nome: 'Ana Souza', tel: '5534991112222',
  respostas: { conta: '2000_5000', cidade: 'Uberlândia-MG', urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', tipo: 'empresa' },
};

beforeEach(() => {
  h.linhas = []; h.paginas = []; h.falhaNaPagina = 0; h.vistas = -1;
});

describe('GET /io/solar/agenda paginado', () => {
  it('2.300 compromissos chegam inteiros, em 3 páginas', async () => {
    h.linhas = fichas(2300, 'quiz_eletroposto');
    const r = await request(app).get('/io/solar/agenda' + JANELA);
    expect(r.status).toBe(200);
    expect(r.body.ocupados).toHaveLength(2300);
    expect(h.paginas).toEqual([0, 1000, 2000]);
  });

  it('erro na 2ª página devolve ocupados: null (não consegui ler)', async () => {
    h.linhas = fichas(2300, 'quiz_eletroposto');
    h.falhaNaPagina = 2;
    const r = await request(app).get('/io/solar/agenda' + JANELA);
    expect(r.status).toBe(200);
    expect(r.body.ocupados).toBeNull();
  });
});

describe('GET /io/eletroposto/agenda paginado', () => {
  it('2.300 compromissos chegam inteiros, em 3 páginas', async () => {
    h.linhas = fichas(2300, 'lp_eletroposto');
    const r = await request(app).get('/io/eletroposto/agenda' + JANELA);
    expect(r.status).toBe(200);
    expect(r.body.ocupados).toHaveLength(2300);
    expect(h.paginas).toEqual([0, 1000, 2000]);
  });

  it('erro na 2ª página devolve ocupados: null (não consegui ler)', async () => {
    h.linhas = fichas(2300, 'lp_eletroposto');
    h.falhaNaPagina = 2;
    const r = await request(app).get('/io/eletroposto/agenda' + JANELA);
    expect(r.status).toBe(200);
    expect(r.body.ocupados).toBeNull();
  });
});

describe('POST /io/solar/quiz: lerOcupacoes paginado', () => {
  it('2.300 fichas de outras origens chegam inteiras à decisão', async () => {
    h.linhas = fichas(2300, 'lp_eletroposto');
    const r = await request(app).post('/io/solar/quiz?dry=1').send(quiz);
    expect(r.status).toBe(200);
    expect(h.vistas).toBe(2300);
    expect(h.paginas).toEqual([0, 1000, 2000]);
  });

  it('erro na 2ª página: 503 e a vitrine não abre', async () => {
    h.linhas = fichas(2300, 'lp_eletroposto');
    h.falhaNaPagina = 2;
    const r = await request(app).post('/io/solar/quiz?dry=1').send(quiz);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('agenda indisponivel');
    expect(h.vistas).toBe(-1);
  });
});
