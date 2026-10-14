import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// GET /io/eletroposto/funil (rota pública): lê TODAS as páginas de pc_eventos (o PostgREST corta em 1000 linhas)
// e as chaves de `por_motivo`, que vêm de payload livre de um POST público, saem limpas. Banco simulado: nada toca rede.

const h = vi.hoisted(() => ({
  eventos: [] as Array<{ id: number; tipo: string; payload: unknown; created_at: string }>,
  erro: false,
  intervalos: [] as Array<[number, number]>,
  selects: [] as string[],
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'pc_eventos') throw new Error(`tabela inesperada: ${tabela}`);
      const b: any = {
        select: (cols: string) => { h.selects.push(cols); return b; }, in: () => b, gte: () => b, order: () => b,
        // o servidor de verdade devolve no máximo 1000 linhas por pedido, qualquer que seja o intervalo
        range: async (de: number, ate: number) => {
          h.intervalos.push([de, ate]);
          if (h.erro) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
          // projeção do `select('id, tipo, motivo:payload->>motivo')`: o payload inteiro não chega; `->>` devolve texto
          const texto = (m: unknown): string | null => (m === undefined || m === null ? null : typeof m === 'string' ? m : JSON.stringify(m));
          return {
            data: h.eventos.slice(de, Math.min(ate + 1, de + 1000))
              .map((e) => ({ id: e.id, tipo: e.tipo, motivo: texto((e.payload as { motivo?: unknown } | null)?.motivo) })),
            error: null,
          };
        },
      };
      return b;
    },
  },
}));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn(async () => false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(), garantirEstudo: vi.fn() }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn().mockResolvedValue([]), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(), funilEletropostoLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => { throw new Error('não deveria ler o Gerador'); } } }));

import router, { limparCacheFunil } from '../routes/ioEletroposto';
import { logger } from '../utils/logger';
import { chaveDoMotivo, contarFunil, lerEventosDoFunil, TAMANHO_PAGINA, TETO_PAGINAS } from '../services/io/funilEletroposto';

const app = express();
app.use(express.json());
app.use('/io/eletroposto', router);

const ev = (id: number, tipo: string, motivo?: unknown) => ({
  id, tipo, payload: motivo === undefined ? null : { motivo }, created_at: '2026-10-10T12:00:00.000Z',
});

beforeEach(() => {
  h.eventos = []; h.erro = false; h.intervalos = []; h.selects = [];
  limparCacheFunil();
  vi.mocked(logger.warn).mockClear(); vi.mocked(logger.error).mockClear();
});

describe('GET /io/eletroposto/funil', () => {
  it('2.500 eventos contam 2.500 (não 1.000): lê página por página até acabar', async () => {
    const tipos = ['material_view', 'checkout_start', 'purchase'];
    for (let i = 1; i <= 2500; i++) h.eventos.push(ev(i, i <= 1500 ? tipos[0] : i <= 2200 ? tipos[1] : tipos[2], i % 2 ? 'sem_ponto' : 'sem_capital'));
    const res = await request(app).get('/io/eletroposto/funil?dias=30');
    expect(res.status).toBe(200);
    expect(res.body.dias).toBe(30);
    expect(res.body.total).toEqual({ material_view: 1500, checkout_start: 700, purchase: 300 });
    const soma = Object.values(res.body.por_motivo as Record<string, Record<string, number>>)
      .flatMap((m) => Object.values(m)).reduce((a, b) => a + b, 0);
    expect(soma).toBe(2500);
    expect(h.intervalos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(res.body.truncado).toBeUndefined();
    // só as colunas necessárias: o payload inteiro nunca é pedido
    expect(new Set(h.selects)).toEqual(new Set(['id, tipo, motivo:payload->>motivo']));
    expect(logger.warn).not.toHaveBeenCalled();
  });
  it('o formato não mudou: {dias, total, por_motivo} e, sem evento, objetos vazios', async () => {
    const res = await request(app).get('/io/eletroposto/funil');
    expect(res.body).toEqual({ dias: 30, total: {}, por_motivo: {} });
  });
  it('chave suja sai limpa, o valor contado é o mesmo e o que sobra vazio junta em "outro"', async () => {
    const longo = 'x'.repeat(200);
    h.eventos = [
      ev(1, 'material_view', 'sem_ponto'),
      ev(2, 'material_view', 'sem_ponto\n\r\t\u0000'),
      ev(3, 'purchase', '  sem_ponto  '),
      ev(4, 'material_view', '\n\u0007 \u2028'),
      ev(5, 'checkout_start', ''),
      ev(6, 'material_view', longo),
      ev(7, 'material_view', 'linha1\nlinha2'),
      ev(8, 'material_view', '__proto__'),
      ev(9, 'material_view'),          // sem motivo: não entra em por_motivo
      ev(10, 'material_view', ''),
    ];
    const res = await request(app).get('/io/eletroposto/funil');
    expect(res.status).toBe(200);
    expect(res.body.total).toEqual({ material_view: 8, checkout_start: 1, purchase: 1 });
    const pm = res.body.por_motivo;
    expect(pm.sem_ponto).toEqual({ material_view: 2, purchase: 1 });   // 'sem_ponto', o com controles e o com espaços viram a mesma chave
    expect(Object.keys(pm).every((k) => k.length <= 60 && !/[\u0000-\u001F\u007F]/.test(k))).toBe(true);
    expect(pm.outro).toEqual({ material_view: 1, checkout_start: 1 });
    expect(pm['x'.repeat(60)]).toEqual({ material_view: 1 });
    expect(pm['linha1 linha2']).toEqual({ material_view: 1 });
    expect(Object.prototype.hasOwnProperty.call(pm, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(pm)).toBe(Object.prototype);
  });
  it('cache de 60 s: a segunda consulta não lê o banco; janelas diferentes têm contagens próprias; passados 60 s lê de novo', async () => {
    h.eventos = [ev(1, 'purchase', 'a')];
    const a = await request(app).get('/io/eletroposto/funil?dias=30');
    h.eventos = [ev(1, 'purchase', 'a'), ev(2, 'purchase', 'a')];
    const b = await request(app).get('/io/eletroposto/funil?dias=30');
    expect(b.body).toEqual(a.body);
    expect(h.intervalos).toHaveLength(1);
    expect((await request(app).get('/io/eletroposto/funil?dias=7')).body.total).toEqual({ purchase: 2 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    try {
      expect((await request(app).get('/io/eletroposto/funil?dias=30')).body.total).toEqual({ purchase: 2 });
    } finally { vi.useRealTimers(); }
  });
  it('requisições juntas montam uma vez só', async () => {
    h.eventos = [ev(1, 'purchase', 'a')];
    const rs = await Promise.all([1, 2, 3, 4].map(() => request(app).get('/io/eletroposto/funil')));
    for (const r of rs) expect(r.body.total).toEqual({ purchase: 1 });
    expect(h.intervalos).toHaveLength(1);
  });
  it('bateu o teto: a resposta leva truncado:true (só nesse caso) e o log avisa', async () => {
    const um = ev(1, 'purchase', 'a');
    h.eventos = Array.from({ length: TAMANHO_PAGINA * TETO_PAGINAS + 10 }, () => um);
    const res = await request(app).get('/io/eletroposto/funil');
    expect(res.status).toBe(200);
    expect(res.body.truncado).toBe(true);
    expect(res.body.total.purchase).toBe(TAMANHO_PAGINA * TETO_PAGINAS);
    expect(Object.keys(res.body).sort()).toEqual(['dias', 'por_motivo', 'total', 'truncado']);
    expect(logger.warn).toHaveBeenCalled();
  });
  it('banco fora: total e por_motivo null (nunca zero) e sem texto do driver', async () => {
    h.erro = true;
    const res = await request(app).get('/io/eletroposto/funil');
    expect(res.body).toEqual({ dias: 30, total: null, por_motivo: null });
    expect(JSON.stringify(res.body)).not.toContain('VALOR-SECRETO');
  });
});

describe('funilEletroposto (puro)', () => {
  it('chaveDoMotivo: corta em 60, tira controle e quebra de linha, vazio vira "outro", ausente não conta', () => {
    expect(chaveDoMotivo(undefined)).toBeNull();
    expect(chaveDoMotivo(null)).toBeNull();
    expect(chaveDoMotivo('')).toBeNull();
    expect(chaveDoMotivo('   ')).toBe('outro');
    expect(chaveDoMotivo('a\nb\r\nc')).toBe('a b c');
    expect(chaveDoMotivo('\u0001ok\u007F')).toBe('ok');
    expect(chaveDoMotivo('é'.repeat(80))).toBe('é'.repeat(60));
    expect(chaveDoMotivo('😀'.repeat(80))).toBe('😀'.repeat(60));   // não corta no meio do par
    expect(chaveDoMotivo(42)).toBe('42');
    expect(chaveDoMotivo({})).toBe('outro');
    expect(chaveDoMotivo(['x'])).toBe('outro');
  });
  it('contarFunil conta tipo e motivo', () => {
    expect(contarFunil([ev(1, 'purchase', 'a'), ev(2, 'purchase', 'a'), ev(3, 'material_view')])).toEqual({
      total: { purchase: 2, material_view: 1 }, por_motivo: { a: { purchase: 2 } },
    });
  });
  it('bateu o teto de páginas: avisa e marca truncado; erro de banco sobe', async () => {
    const cheia = Array.from({ length: TAMANHO_PAGINA }, (_, i) => ev(i, 'purchase'));
    const aviso = vi.fn();
    const r = await lerEventosDoFunil(async () => ({ data: cheia, error: null }), aviso);
    expect(r.truncado).toBe(true);
    expect(r.eventos.length).toBe(TAMANHO_PAGINA * TETO_PAGINAS);
    expect(aviso).toHaveBeenCalledWith(TAMANHO_PAGINA * TETO_PAGINAS);
    await expect(lerEventosDoFunil(async () => ({ data: null, error: { code: 'X' } }), aviso)).rejects.toMatchObject({ code: 'X' });
  });
});
