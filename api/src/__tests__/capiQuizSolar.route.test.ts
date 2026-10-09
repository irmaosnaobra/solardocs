import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// API de Conversões do quiz solar: o Schedule do servidor (gêmeo do navegador,
// junto pelo event_id) e o LeadQuente. O Meta e o banco são simulados; a decisão
// de caminho e de nota vem do módulo real, só a vitrine é fixada.

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  leadsErro: null as unknown,
  agendaErro: null as unknown,
  pontos: 90,
  caminho: 'vistoria' as string,
}));

vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.enviar }));
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn().mockResolvedValue(false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/io/solarQuiz', async (orig) => {
  const real = await orig<typeof import('../services/io/solarQuiz')>();
  return {
    ...real,
    cabe: () => true,
    decidirEMontar: () => ({
      dec: {
        caminho: h.caminho, motivo: 'x', kwh: 800, grande: false, cidade: { nome: 'Uberlândia', uf: 'MG' },
        pontos: h.pontos, pontuacao: { pontos: h.pontos, partes: [] }, candidatos: ['Diego'], qualifica: null,
      },
      dias: [], semHorario: false,
    }),
  };
});
vi.mock('../utils/supabaseGerador', () => {
  // Cadeia que serve para qualquer select/insert/update: o `await` no fim resolve
  // com lista vazia, e o resultado das gravações vem do estado do teste.
  const cadeia = (tabela: string) => {
    let op = 'select';
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') return (ok: (v: unknown) => void) => ok(
          tabela === 'leads_meta' && op !== 'select' ? { error: h.leadsErro } : { data: [], error: null });
        if (k === 'single') return () => Promise.resolve(
          h.agendaErro ? { data: null, error: h.agendaErro }
            : { data: { id: 77, vendedor_nome: 'Diego', quando: 'x', cliente_nome: 'Ana Souza', cliente_telefone: '5534991112222', observacao: '' }, error: null });
        return (..._a: unknown[]) => { if (k === 'insert' || k === 'update') op = String(k); return c; };
      },
    });
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});

import router from '../routes/ioSolar';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/solar', router);

const FBC = 'fb.1.1760000000000.AbCdEf123';
const FBP = 'fb.1.1760000000000.1234567890';
const base = {
  nome: 'Ana Souza', tel: '5534991112222',
  respostas: { conta: '2000_5000', cidade: 'Uberlândia-MG', urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', tipo: 'empresa' },
  fbc: FBC, fbp: FBP,
};
const agendar = { ...base, ymd: '2026-10-14', h: '09:00', dono: 'Diego', event_id: 'agd_abc123xyz' };
const chamadas = () => h.enviar.mock.calls.map(c => c[0]);

beforeEach(() => {
  h.enviar.mockReset().mockResolvedValue({ ok: true, status: 200 });
  h.leadsErro = null; h.agendaErro = null; h.pontos = 90; h.caminho = 'vistoria';
  delete process.env.CAPI_QUIZ_OFF;
});
afterEach(() => { delete process.env.CAPI_QUIZ_OFF; });

describe('POST /quiz/agendar: Schedule pela API de Conversões', () => {
  it('manda o Schedule no pixel solar com o MESMO event_id, pessoa, fbc, fbp e navegador', async () => {
    const r = await request(app).post('/io/solar/quiz/agendar').set('User-Agent', 'UA-Teste').send(agendar);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const ev = chamadas().find(e => e.nome === 'Schedule');
    expect(ev).toMatchObject({
      produto: 'solar', origem: 'website', eventId: 'agd_abc123xyz', urlDaPagina: 'https://solardoc.app/io/solar',
      pessoa: { telefone: '5534991112222', nome: 'Ana Souza', cidade: 'Uberlândia', uf: 'MG' },
      navegador: { fbc: FBC, fbp: FBP, userAgent: 'UA-Teste' },
    });
    expect(ev.navegador.ip).toBeTruthy();
    expect(ev.valor).toBeUndefined();
  });

  it('fbc malformado é descartado, fbp válido passa', async () => {
    await request(app).post('/io/solar/quiz/agendar').send({ ...agendar, fbc: 'lixo<script>' });
    const ev = chamadas().find(e => e.nome === 'Schedule');
    expect(ev.navegador.fbc).toBeNull();
    expect(ev.navegador.fbp).toBe(FBP);
  });

  it('SEM event_id (página velha em cache) não manda Schedule: o navegador já contou', async () => {
    const { event_id, ...semId } = agendar; void event_id;
    const r = await request(app).post('/io/solar/quiz/agendar').send(semId);
    expect(r.status).toBe(200);
    expect(chamadas().filter(e => e.nome === 'Schedule')).toHaveLength(0);
  });

  it('event_id fora do formato também não manda', async () => {
    await request(app).post('/io/solar/quiz/agendar').send({ ...agendar, event_id: 'a b!' });
    expect(chamadas()).toHaveLength(0);
  });

  it('CAPI_QUIZ_OFF=1 desliga o envio e a resposta é a mesma', async () => {
    process.env.CAPI_QUIZ_OFF = '1';
    const r = await request(app).post('/io/solar/quiz/agendar').send(agendar);
    expect(r.status).toBe(200);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('Meta rejeitando, devolvendo ok:false ou demorando não muda a resposta', async () => {
    h.enviar.mockRejectedValueOnce(new Error('boom'));
    expect((await request(app).post('/io/solar/quiz/agendar').send(agendar)).status).toBe(200);
    h.enviar.mockResolvedValueOnce({ ok: false, status: 400, erro: 'x' });
    expect((await request(app).post('/io/solar/quiz/agendar').send(agendar)).body.ok).toBe(true);
    h.enviar.mockReturnValueOnce(new Promise(() => {}));   // nunca resolve
    const t0 = Date.now();
    const r = await request(app).post('/io/solar/quiz/agendar').send(agendar);
    expect(r.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(3500);
  });

  it('falha ao gravar a ficha: nada vai ao Meta', async () => {
    h.agendaErro = { code: 'XX000', message: 'banco' };
    const r = await request(app).post('/io/solar/quiz/agendar').send(agendar);
    expect(r.status).toBe(500);
    expect(h.enviar).not.toHaveBeenCalled();
  });
});

describe('POST /quiz: LeadQuente', () => {
  it('nota 80 ou mais e não curioso: manda LeadQuente com id por telefone e dados', async () => {
    h.pontos = 80;
    const r = await request(app).post('/io/solar/quiz').send(base);
    expect(r.status).toBe(200);
    expect(chamadas()).toHaveLength(1);
    expect(chamadas()[0]).toMatchObject({
      produto: 'solar', nome: 'LeadQuente', eventId: expect.stringMatching(/^leadquente_/),
      dados: { nota: 80, caminho: 'vistoria' },
      navegador: { fbc: FBC, fbp: FBP },
    });
  });
  it('o mesmo telefone repetido gera o mesmo eventId (o Meta deduplica)', async () => {
    await request(app).post('/io/solar/quiz').send(base);
    await request(app).post('/io/solar/quiz').send(base);
    expect(chamadas()[0].eventId).toBe(chamadas()[1].eventId);
    expect(chamadas()[0].eventId).toMatch(/^leadquente_[0-9a-f]{24}$/);
    expect(chamadas()[0].eventId).not.toContain('991112222');   // o telefone nunca vai em texto puro
  });
  it('nota 79 não manda', async () => {
    h.pontos = 79;
    await request(app).post('/io/solar/quiz').send(base);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('curioso não manda, mesmo com nota alta', async () => {
    h.caminho = 'curioso';
    await request(app).post('/io/solar/quiz').send(base);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('?dry=1 não grava e não manda', async () => {
    await request(app).post('/io/solar/quiz?dry=1').send(base);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('rascunho que não gravou não manda', async () => {
    h.leadsErro = { message: 'banco' };
    const r = await request(app).post('/io/solar/quiz').send(base);
    expect(r.status).toBe(200);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('CAPI_QUIZ_OFF=1 desliga', async () => {
    process.env.CAPI_QUIZ_OFF = '1';
    await request(app).post('/io/solar/quiz').send(base);
    expect(h.enviar).not.toHaveBeenCalled();
  });
  it('Meta com erro não muda a resposta', async () => {
    h.enviar.mockRejectedValue(new Error('fora do ar'));
    const r = await request(app).post('/io/solar/quiz').send(base);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});
