import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// O CARD DA LP NASCE COM A ETIQUETA DO TIPO (regra da agenda de 13/10/2026).
//
// Ordem do dono: "Todos os ARRENDAMENTOS, INVESTIDORES e PARCEIROS cairão na agenda
// com suas etiquetas já colocadas." A LP manda `tipo` no POST /agendar e a rota
// grava `etiqueta_card:<id>` no `system_state`, no MESMO formato do /gerador.
//
// O que este arquivo prende:
//   1. o tipo válido vira a marca, com `por: 'lp'`;
//   2. valor fora da lista é ignorado e a reunião é gravada do mesmo jeito;
//   3. falha ao gravar a marca NÃO derruba o agendamento;
//   4. `status` e `created_by` do card não mudam;
//   5. ficha de teste (nome começando com "teste") não manda nada ao Meta.
// Banco e Meta são simulados: nada aqui toca rede.

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  upserts: [] as Array<{ tabela: string; linha: any; opts: any }>,
  inseridas: [] as Array<Record<string, unknown>>,
  etiquetaErro: null as unknown,
  etiquetaExplode: false,
  bloqueado: false,
}));

vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.enviar }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => ({
      upsert: (linha: any, opts: any) => {
        if (h.etiquetaExplode) return Promise.reject(new Error('rede caiu'));
        h.upserts.push({ tabela, linha, opts });
        return Promise.resolve({ error: h.etiquetaErro });
      },
    }),
  },
}));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn(async () => h.bloqueado) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(), garantirEstudo: vi.fn() }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn().mockResolvedValue([]), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => {
  let ultima: Record<string, unknown> = {};
  const cadeia = (tabela: string) => {
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') return (ok: (v: unknown) => void) => ok({ data: [], error: null });
        if (k === 'single') return () => Promise.resolve(
          tabela === 'agendamentos' ? { data: { id: 77 }, error: null } : { data: { id: 9, ...ultima }, error: null });
        return (...a: unknown[]) => {
          if (k === 'insert' && tabela === 'agendamentos') h.inseridas.push(a[0] as Record<string, unknown>);
          if (k === 'upsert') ultima = a[0] as Record<string, unknown>;
          return c;
        };
      },
    });
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});

import router, { TIPOS_DO_CARD_LP, eventIdLeadQuente } from '../routes/ioEletroposto';
import { ETIQUETA_PREFIX, ETIQUETAS_DE_NEGOCIO, TIPO_CARD_PREFIX } from '../services/agenda/salaDeEspera';
import { logger } from '../utils/logger';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/eletroposto', router);

const QUANDO = '2026-10-14T13:00:00.000Z';
const OBS_QUENTE = ['LP ELETROPOSTO · Investidor', 'INVESTIDOR SEM LOCAL', 'Local: Não tenho local', 'Quanto pretende investir: R$ 140 mil'].join('\n');
const corpo = (o: Record<string, unknown> = {}) => ({
  vendedor_nome: 'Thiago', quando: QUANDO, cliente_nome: 'Carlos Lima', cliente_telefone: '5534991113333',
  cidade: 'Uberlândia', observacao: OBS_QUENTE, event_id: 'agd_ep123abc', status: 'agendado', created_by: 'lp_eletroposto', ...o,
});
const post = (o: Record<string, unknown> = {}) => request(app).post('/io/eletroposto/agendar').send(corpo(o));

beforeEach(() => {
  h.enviar.mockReset().mockResolvedValue({ ok: true, status: 200 });
  h.upserts.length = 0; h.inseridas.length = 0;
  h.etiquetaErro = null; h.etiquetaExplode = false; h.bloqueado = false;
  vi.mocked(logger.error).mockClear();
  delete process.env.CAPI_QUIZ_OFF;
});

describe('POST /agendar com `tipo`: o card nasce com a etiqueta', () => {
  it('a lista da LP são os três tipos, e os três estão na lista do /gerador', () => {
    expect([...TIPOS_DO_CARD_LP].sort()).toEqual(['arrendamento', 'cotista', 'integrador']);
    for (const t of TIPOS_DO_CARD_LP) expect(ETIQUETAS_DE_NEGOCIO.has(t), t).toBe(true);
  });

  for (const tipo of ['arrendamento', 'cotista', 'integrador']) {
    it(`tipo "${tipo}" grava etiqueta_card:<id> no formato do /gerador, com por "lp"`, async () => {
      const r = await post({ tipo });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, id: 77 });
      // Duas marcas: a etiqueta (que a agenda pode apagar) e o tipo (que nunca some).
      expect(h.upserts).toHaveLength(2);
      const u = h.upserts.find(x => x.linha.key === `${ETIQUETA_PREFIX}77`)!;
      expect(u.tabela).toBe('system_state');
      expect(u.opts).toEqual({ onConflict: 'key' });
      expect(u.linha.key).toBe(`${ETIQUETA_PREFIX}77`);
      expect(Object.keys(u.linha.value).sort()).toEqual(['em', 'etiqueta', 'por']);
      expect(u.linha.value).toMatchObject({ etiqueta: tipo, por: 'lp' });
      expect(Number.isFinite(Date.parse(u.linha.value.em))).toBe(true);
      expect(u.linha.updated_at).toBe(u.linha.value.em);
    });
  }

  for (const tipo of ['arrendamento', 'cotista', 'integrador']) {
    it(`tipo "${tipo}" grava também tipo_card:<id>, sem sobrescrever o que já existe`, async () => {
      await post({ tipo });
      const t = h.upserts.find(x => x.linha.key === `${TIPO_CARD_PREFIX}77`)!;
      expect(t.tabela).toBe('system_state');
      // ignoreDuplicates: a segunda gravação não regrava a marca do primeiro gravador.
      expect(t.opts).toEqual({ onConflict: 'key', ignoreDuplicates: true });
      expect(Object.keys(t.linha.value).sort()).toEqual(['em', 'por', 'tipo']);
      expect(t.linha.value).toMatchObject({ tipo, por: 'lp' });
      expect(Number.isFinite(Date.parse(t.linha.value.em))).toBe(true);
    });
  }

  it('erro do banco no tipo_card NÃO derruba o agendamento, e fica no log', async () => {
    h.etiquetaErro = { message: 'system_state fora' };
    const r = await post({ tipo: 'cotista' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, id: 77 });
    expect(vi.mocked(logger.error).mock.calls.some(c => String(c[1]).includes('tipo cotista do card #77'))).toBe(true);
  });

  it('o card continua `agendado` e `lp_eletroposto`, e `tipo` não vira coluna', async () => {
    await post({ tipo: 'cotista', status: 'cotista', created_by: 'qualquer_coisa' });
    expect(h.inseridas).toHaveLength(1);
    expect(h.inseridas[0]).toMatchObject({ status: 'agendado', created_by: 'lp_eletroposto' });
    expect(h.inseridas[0]).not.toHaveProperty('tipo');
  });

  it('sem `tipo` nada é gravado no system_state (página antiga em cache)', async () => {
    const r = await post();
    expect(r.body).toEqual({ ok: true, id: 77 });
    expect(h.upserts).toHaveLength(0);
  });

  for (const ruim of ['curioso', 'chave_na_mao', 'ARRENDAMENTO', '', 'x'.repeat(300), 42, { a: 1 }, ['cotista', 'x']]) {
    it(`valor fora da lista (${JSON.stringify(ruim).slice(0, 30)}) é ignorado e a reunião é gravada`, async () => {
      const r = await post({ tipo: ruim });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, id: 77 });
      expect(h.upserts).toHaveLength(0);
      expect(h.inseridas).toHaveLength(1);
    });
  }

  it('banco devolvendo erro na etiqueta NÃO derruba o agendamento, e fica no log', async () => {
    h.etiquetaErro = { message: 'system_state fora' };
    const r = await post({ tipo: 'arrendamento' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, id: 77 });
    expect(vi.mocked(logger.error).mock.calls.some(c => String(c[1]).includes('etiqueta arrendamento do card #77'))).toBe(true);
  });

  it('a chamada da etiqueta estourando também não derruba, e os eventos do Meta saem', async () => {
    h.etiquetaExplode = true;
    const r = await post({ tipo: 'cotista' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, id: 77 });
    expect(h.enviar.mock.calls.map(c => c[0].nome).sort()).toEqual(['LeadQuente', 'Schedule']);
  });

  it('telefone bloqueado: sem card, sem etiqueta', async () => {
    h.bloqueado = true;
    const r = await post({ tipo: 'integrador' });
    expect(r.body).toEqual({ ok: true, id: null });
    expect(h.upserts).toHaveLength(0);
  });
});

describe('POST /agendar: ficha de teste não ensina o pixel', () => {
  it('nome de gente manda Schedule e LeadQuente (R$ 140 mil)', async () => {
    await post({ tipo: 'cotista' });
    expect(h.enviar.mock.calls.map(c => c[0].nome).sort()).toEqual(['LeadQuente', 'Schedule']);
  });

  for (const nome of ['Teste Thiago', 'teste', '  TESTE da regra nova']) {
    it(`"${nome}": grava o card e a etiqueta, e nada vai ao Meta`, async () => {
      const r = await post({ cliente_nome: nome, tipo: 'cotista' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, id: 77 });
      expect(h.inseridas).toHaveLength(1);
      expect(h.upserts).toHaveLength(2);
      expect(h.enviar).not.toHaveBeenCalled();
    });
  }

  it('"teste" no meio do nome não é ficha de teste', async () => {
    await post({ cliente_nome: 'Maria Teste' });
    expect(h.enviar.mock.calls.map(c => c[0].nome)).toContain('Schedule');
  });
});

describe('LeadQuente: o MESMO event_id no cadastro e no agendamento (o Meta deduplica)', () => {
  it('o /parceria e o /agendar do mesmo telefone mandam o mesmo id', async () => {
    await request(app).post('/io/eletroposto/parceria').send({
      lado: 'capital', nome: 'Carlos Lima', telefone: '5534991113333', cidade: 'Uberlândia', capital_faixa: 'R$ 140 mil',
    });
    await post({ tipo: 'cotista' });
    const ids = h.enviar.mock.calls.filter(c => c[0].nome === 'LeadQuente').map(c => c[0].eventId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(eventIdLeadQuente('5534991113333'));
    expect(ids[0]).toMatch(/^leadquente_ep_[0-9a-f]{24}$/);
  });

  it('o telefone com ou sem o 55 e o 9 dá o mesmo id', () => {
    expect(eventIdLeadQuente('5534991113333')).toBe(eventIdLeadQuente('34991113333'));
  });
});

describe('POST /parceria: o cadastro que vem antes da agenda também não ensina o pixel', () => {
  const parceria = (o: Record<string, unknown> = {}) => request(app).post('/io/eletroposto/parceria').send({
    lado: 'capital', nome: 'Carlos Lima', telefone: '5534991113333', cidade: 'Uberlândia', capital_faixa: 'R$ 140 mil', ...o,
  });

  it('investidor de R$ 140 mil manda LeadQuente', async () => {
    expect((await parceria()).body).toEqual({ ok: true });
    expect(h.enviar.mock.calls.map(c => c[0].nome)).toEqual(['LeadQuente']);
  });

  it('o mesmo cadastro com nome de teste é gravado e não manda', async () => {
    expect((await parceria({ nome: 'Teste Regra Agenda' })).body).toEqual({ ok: true });
    expect(h.enviar).not.toHaveBeenCalled();
  });
});
