import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// API de Conversões do eletroposto: Schedule (gêmeo do navegador, junto pelo
// event_id) e LeadQuente (nota 3 ou capital de R$ 100 mil pra cima). Meta e banco
// são simulados.

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  agendaErro: null as unknown,
  parceriaErro: null as unknown,
}));

vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.enviar }));
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn().mockResolvedValue(false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(), garantirEstudo: vi.fn() }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn().mockResolvedValue([]), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/supabaseGerador', () => {
  // O corpo da última ficha de parceria gravada volta no .single(), como o upsert real.
  let ultima: Record<string, unknown> = {};
  const cadeia = (tabela: string) => {
    let op = 'select';
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') return (ok: (v: unknown) => void) => ok({ data: [], error: null });
        if (k === 'single') return () => Promise.resolve(
          tabela === 'agendamentos'
            ? (h.agendaErro ? { data: null, error: h.agendaErro } : { data: { id: 55 }, error: null })
            : (h.parceriaErro ? { data: null, error: h.parceriaErro } : { data: { id: 9, ...ultima }, error: null }));
        return (...a: unknown[]) => {
          if (k === 'insert' || k === 'update' || k === 'upsert') op = String(k);
          if (k === 'upsert') ultima = a[0] as Record<string, unknown>;
          return c;
        };
      },
    });
    void op;
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});

import router from '../routes/ioEletroposto';
import { idDoTelefone } from '../utils/capiQuiz';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/eletroposto', router);

const FBC = 'fb.1.1760000000000.AbCdEf123';
const FBP = 'fb.1.1760000000000.1234567890';
const QUANDO = '2026-10-14T13:00:00.000Z';
const obs = (nota: number, quanto?: string) => [
  'LP ELETROPOSTO · Comércio', `NOTA ${nota} · 10/11 pts`, 'Ponto: Já tenho o ponto definido',
  'Como pretende investir: Recurso próprio', ...(quanto ? [`Quanto pretende investir: ${quanto}`] : []), 'Decisor: Eu',
].join('\n');
const agendar = (o: Record<string, unknown> = {}) => ({
  vendedor_nome: 'Thiago', quando: QUANDO, cliente_nome: 'Carlos Lima', cliente_telefone: '5534991113333',
  cidade: 'Uberlândia', observacao: obs(2), event_id: 'agd_ep123abc', fbc: FBC, fbp: FBP, ...o,
});
const chamadas = () => h.enviar.mock.calls.map(c => c[0]);
const doTipo = (nome: string) => chamadas().filter(e => e.nome === nome);

beforeEach(() => {
  h.enviar.mockReset().mockResolvedValue({ ok: true, status: 200 });
  h.agendaErro = null; h.parceriaErro = null;
  delete process.env.CAPI_QUIZ_OFF;
});
afterEach(() => { delete process.env.CAPI_QUIZ_OFF; });

describe('POST /agendar: Schedule', () => {
  it('manda o Schedule no pixel do eletroposto com o MESMO event_id, fbc, fbp e navegador', async () => {
    const r = await request(app).post('/io/eletroposto/agendar').set('User-Agent', 'UA-EP').send(agendar());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, id: 55 });
    const [ev] = doTipo('Schedule');
    expect(ev).toMatchObject({
      produto: 'eletroposto', origem: 'website', eventId: 'agd_ep123abc', urlDaPagina: 'https://solardoc.app/io/eletroposto',
      pessoa: { telefone: '5534991113333', nome: 'Carlos Lima', cidade: 'Uberlândia' },
      navegador: { fbc: FBC, fbp: FBP, userAgent: 'UA-EP' },
    });
    expect(doTipo('LeadQuente')).toHaveLength(0);   // nota 2, sem capital
  });
  it('fbc malformado é descartado', async () => {
    await request(app).post('/io/eletroposto/agendar').send(agendar({ fbc: 'x y' }));
    expect(doTipo('Schedule')[0].navegador.fbc).toBeNull();
  });
  it('SEM event_id não manda o Schedule (o navegador já contou), mas o LeadQuente não é afetado', async () => {
    const { event_id, ...semId } = agendar({ observacao: obs(3) }); void event_id;
    const r = await request(app).post('/io/eletroposto/agendar').send(semId);
    expect(r.status).toBe(200);
    expect(doTipo('Schedule')).toHaveLength(0);
    expect(doTipo('LeadQuente')).toHaveLength(1);
  });
  it('sem event_id e sem lead quente: nada vai ao Meta', async () => {
    await request(app).post('/io/eletroposto/agendar').send(agendar({ event_id: undefined }));
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('falha ao gravar: nada vai ao Meta', async () => {
    h.agendaErro = { message: 'banco' };
    const r = await request(app).post('/io/eletroposto/agendar').send(agendar({ observacao: obs(3) }));
    expect(r.status).toBe(500);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('CAPI_QUIZ_OFF=1 desliga tudo', async () => {
    process.env.CAPI_QUIZ_OFF = '1';
    const r = await request(app).post('/io/eletroposto/agendar').send(agendar({ observacao: obs(3) }));
    expect(r.status).toBe(200);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('Meta rejeitando, com ok:false ou travado não muda a resposta', async () => {
    h.enviar.mockRejectedValueOnce(new Error('boom'));
    expect((await request(app).post('/io/eletroposto/agendar').send(agendar())).body.ok).toBe(true);
    h.enviar.mockResolvedValueOnce({ ok: false, status: 400, erro: 'x' });
    expect((await request(app).post('/io/eletroposto/agendar').send(agendar())).body.ok).toBe(true);
    h.enviar.mockReturnValueOnce(new Promise(() => {}));
    const t0 = Date.now();
    expect((await request(app).post('/io/eletroposto/agendar').send(agendar())).status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(3500);
  });
});

describe('POST /agendar: LeadQuente', () => {
  it('NOTA 3 manda LeadQuente com id fixo por telefone', async () => {
    await request(app).post('/io/eletroposto/agendar').send(agendar({ observacao: obs(3) }));
    expect(doTipo('LeadQuente')[0]).toMatchObject({
      produto: 'eletroposto', eventId: `leadquente_ep_${idDoTelefone('5534991113333')}`, dados: { nota: 3 },
    });
    expect(doTipo('LeadQuente')[0].eventId).not.toContain('5534991113333');
  });
  it('NOTA 2 com capital de R$ 100 mil a R$ 200 mil manda', async () => {
    await request(app).post('/io/eletroposto/agendar').send(agendar({ observacao: obs(2, 'R$ 100 mil a R$ 200 mil') }));
    expect(doTipo('LeadQuente')).toHaveLength(1);
  });
  it('NOTA 2 com capital de R$ 70 mil, Menos de R$ 150 mil ou sem a linha não manda', async () => {
    for (const q of ['R$ 70 mil', 'Menos de R$ 150 mil', 'Ainda não sei', undefined]) {
      await request(app).post('/io/eletroposto/agendar').send(agendar({ event_id: undefined, observacao: obs(2, q) }));
    }
    expect(h.enviar).not.toHaveBeenCalled();
  });
});

describe('POST /parceria: LeadQuente de capital', () => {
  const corpo = (o: Record<string, unknown> = {}) => ({
    lado: 'capital', nome: 'Marta Reis', telefone: '5534991114444', cidade: 'Uberlândia',
    capital_faixa: 'R$ 140 mil', fbc: FBC, fbp: FBP, ...o,
  });
  const faixas: Array<[string, boolean]> = [
    ['R$ 100 mil a R$ 200 mil', true], ['R$ 140 mil', true], ['Acima de R$ 200 mil', true], ['Mais de R$ 500 mil', true],
    ['R$ 50 mil a R$ 100 mil', false], ['R$ 70 mil', false], ['Até R$ 50 mil', false], ['Menos de R$ 50 mil', false],
    ['Ainda não sei', false], ['', false],
  ];
  it.each(faixas)('capital "%s" -> quente=%s', async (faixa, quente) => {
    const r = await request(app).post('/io/eletroposto/parceria').send(corpo({ capital_faixa: faixa }));
    expect(r.status).toBe(200);
    expect(doTipo('LeadQuente')).toHaveLength(quente ? 1 : 0);
  });
  it('manda com fbc, fbp, dados do lado e faixa, e id fixo', async () => {
    await request(app).post('/io/eletroposto/parceria').send(corpo());
    expect(doTipo('LeadQuente')[0]).toMatchObject({
      produto: 'eletroposto', origem: 'website', eventId: `leadquente_ep_capital_${idDoTelefone('5534991114444')}`,
      pessoa: { telefone: '5534991114444', nome: 'Marta Reis' },
      navegador: { fbc: FBC, fbp: FBP },
      dados: { lado: 'capital', capital_faixa: 'R$ 140 mil' },
    });
  });
  it('nenhum event_id leva os dígitos do telefone', async () => {
    await request(app).post('/io/eletroposto/parceria').send(corpo());
    await request(app).post('/io/eletroposto/agendar').send(agendar({ observacao: obs(3) }));
    const ids = chamadas().map(e => String(e.eventId));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) { expect(id).not.toContain('5534991114444'); expect(id).not.toContain('5534991113333'); expect(id).not.toContain('991114444'); }
  });
  it('ponto e integrador não mandam, mesmo com faixa alta', async () => {
    await request(app).post('/io/eletroposto/parceria').send(corpo({ lado: 'ponto' }));
    await request(app).post('/io/eletroposto/parceria').send(corpo({ lado: 'integrador' }));
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('teste:true não manda', async () => {
    await request(app).post('/io/eletroposto/parceria').send(corpo({ teste: true }));
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('gravação que falha: 500 e nada vai ao Meta', async () => {
    h.parceriaErro = { message: 'banco' };
    const r = await request(app).post('/io/eletroposto/parceria').send(corpo());
    expect(r.status).toBe(500);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('CAPI_QUIZ_OFF=1 desliga', async () => {
    process.env.CAPI_QUIZ_OFF = '1';
    const r = await request(app).post('/io/eletroposto/parceria').send(corpo());
    expect(r.status).toBe(200);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('Meta com erro não muda a resposta', async () => {
    h.enviar.mockRejectedValue(new Error('fora do ar'));
    const r = await request(app).post('/io/eletroposto/parceria').send(corpo());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
