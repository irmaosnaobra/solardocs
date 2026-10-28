import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { BancoFalso } from './bancoFalsoQuiz';

// DESCARTE DO QUIZ SOLAR (27/10/2026), pelas rotas. Lead com nota abaixo de 70 ou de cidade fora das 114 da região de 200 km
// de Uberlândia: sem rascunho, sem card, sem aviso, sem LeadQuente, sem Schedule. Fica só a marca em system_state.
// Banco, WhatsApp e API de Conversões em memória; nada alcança a rede.

const h = vi.hoisted(() => ({
  main: null as any,
  ger: null as any,
  enviados: [] as Array<{ numero: string; texto: string }>,
  capi: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: (t: string) => h.ger.from(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (numero: string, texto: string) => { h.enviados.push({ numero, texto }); }),
  linhaEmCooldown: vi.fn(() => false),
}));
vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.capi }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));

import router from '../routes/ioSolar';
import { estaBloqueado } from '../services/agents/whatsapp/silenciar';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/solar', router);

const brt = (ymd: string, hhmm: string): number => Date.parse(`${ymd}T${hhmm}:00-03:00`);
const SEXTA_14H = brt('2026-10-23', '14:00');
const SEGREDO = 'segredo-de-teste-descarte';

const RESP_BOA = {
  conta: '600_1050', cidade: 'Uberlândia-MG', tipo: 'casa', imovel: 'proprio', urgencia: 'ja', concorrente: 'sim', pagamento: 'vista', decisor: 'eu', grupoa: 'nao',
  telhado: 'ceramica', sombra: 'sol', aumento: 'nao', dor: 'sobe', tempo: 'meses', travou: 'caro', desejo: 'viajar', criterio: 'parcela',
};
/** 0 + 20 + 20 + 15 + 10 = 65 pontos: abaixo do corte de 70. */
const RESP_NOTA_65 = { ...RESP_BOA, urgencia: 'pesquisando' };
/** 3meses (18) + 20 + 20 + 15 + 10 = 83 pontos. */
const RESP_NOTA_83 = { ...RESP_BOA, urgencia: '3meses' };
const RESP_FORA = { ...RESP_BOA, cidade: 'Jaboticatubas-MG' };

const corpo = (resp: Record<string, unknown> = RESP_BOA, extra: Record<string, unknown> = {}) =>
  ({ nome: 'Ana Souza', tel: '5534991112222', respostas: resp, event_id: 'agd_abc123xyz', ...extra });
const marcas = () => h.main.tabela('system_state').filter((l: any) => String(l.key).startsWith('solar_quiz_descartado:'));
const semEscrita = () => {
  expect(h.ger.tabela('leads_meta')).toHaveLength(0);
  expect(h.ger.tabela('agendamentos')).toHaveLength(0);
  expect(h.capi).not.toHaveBeenCalled();
  expect(h.enviados).toHaveLength(0);
};

beforeEach(() => {
  h.main = new BancoFalso();
  h.ger = new BancoFalso();
  h.enviados.length = 0;
  h.capi.mockReset().mockResolvedValue({ ok: true, status: 200 });
  process.env.AGENTES5040_FICHA = '0';
  process.env.CRON_SECRET = SEGREDO;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SEXTA_14H);
});
afterEach(() => { vi.useRealTimers(); });

describe('POST /quiz descarta', () => {
  it.each([
    ['nota 65', RESP_NOTA_65, 'nota'],
    ['cidade fora da região', RESP_FORA, 'regiao'],
  ])('%s: não grava rascunho, não dispara evento e devolve descartado com o motivo', async (_n, resp, motivo) => {
    const r = await request(app).post('/io/solar/quiz').send(corpo(resp, { src: 'anuncio', utm_source: 'fb', utm_campaign: 'camp1' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, descartado: true, motivo, caminho: 'descartado', horario_agora: false });
    expect(r.body.diagnostico).toBeTruthy();
    expect(r.body.dias).toEqual([]);
    expect(r.body.lead_id).toBeUndefined();
    semEscrita();
    const m = marcas();
    expect(m).toHaveLength(1);
    expect(m[0].key).toMatch(/^solar_quiz_descartado:\d{10}$/);
    expect(m[0].value).toMatchObject({ motivo, src: 'anuncio', utm_source: 'fb', utm_campaign: 'camp1' });
    expect(typeof m[0].value.pontos).toBe('number');
    expect(typeof m[0].value.em).toBe('string');
  });

  it('cidade fora da região devolve o Município-UF para o título e guarda na marca', async () => {
    const a = await request(app).post('/io/solar/quiz').send(corpo(RESP_FORA));
    expect(a.body.cidade_uf).toBe('Jaboticatubas-MG');
    expect(marcas()[0].value.cidade).toBe('Jaboticatubas-MG');
  });

  it('a região vence a nota', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo({ ...RESP_NOTA_65, cidade: 'Belo Horizonte-MG' }));
    expect(r.body.motivo).toBe('regiao');
  });

  it('nota 83 de cidade da região NÃO é descartada: grava o rascunho e não deixa marca', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo(RESP_NOTA_83));
    expect(r.status).toBe(200);
    expect(r.body.descartado).toBeUndefined();
    expect(r.body.caminho).toBe('ligacao');
    expect(h.ger.tabela('leads_meta')).toHaveLength(1);
    expect(marcas()).toHaveLength(0);
  });

  it('cidade que não resolveu NÃO descarta por região', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo({ ...RESP_BOA, cidade: 'xyz abc' }));
    expect(r.body.descartado).toBeUndefined();
    expect(h.ger.tabela('leads_meta')).toHaveLength(1);
  });

  it('quem refaz o quiz e passa limpa a marca do descarte anterior', async () => {
    await request(app).post('/io/solar/quiz').send(corpo(RESP_NOTA_65));
    expect(marcas()).toHaveLength(1);
    const r = await request(app).post('/io/solar/quiz').send(corpo(RESP_BOA));
    expect(r.body.descartado).toBeUndefined();
    expect(marcas()).toHaveLength(0);
  });

  it('?dry=1 descartado não grava nem a marca', async () => {
    const r = await request(app).post('/io/solar/quiz?dry=1').send(corpo(RESP_NOTA_65));
    expect(r.body.descartado).toBe(true);
    expect(marcas()).toHaveLength(0);
    semEscrita();
  });

  it('modo teste passa pelo mesmo portão, com chave própria', async () => {
    const r = await request(app).post('/io/solar/quiz').set('x-cron-secret', SEGREDO).send(corpo(RESP_NOTA_65, { teste: true }));
    expect(r.body.descartado).toBe(true);
    expect(h.main.tabela('system_state').map((l: any) => l.key)).toEqual([expect.stringMatching(/^solar_quiz_descartado:teste_\d{10}$/)]);
    semEscrita();
  });

  it('falha ao gravar a marca não derruba a resposta', async () => {
    h.main = { from: () => { throw new Error('banco fora'); } };
    const r = await request(app).post('/io/solar/quiz').send(corpo(RESP_NOTA_65));
    expect(r.status).toBe(200);
    expect(r.body.descartado).toBe(true);
  });
});

describe('POST /quiz/agora e /quiz/agendar recusam o descartado antes de escrever', () => {
  it.each([
    ['nota', RESP_NOTA_65],
    ['região', RESP_FORA],
  ])('/agora com %s: 409 descartado, sem card, sem Schedule, sem aviso', async (_n, resp) => {
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo(resp));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, error: 'descartado' });
    expect(['nota', 'regiao']).toContain(r.body.motivo);
    semEscrita();
  });

  it('/agora fora do horário também responde descartado (o portão vem antes do horário)', async () => {
    vi.setSystemTime(brt('2026-10-25', '10:00'));   // domingo
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo(RESP_NOTA_65));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('descartado');
  });

  it.each([
    ['nota', RESP_NOTA_65],
    ['região', RESP_FORA],
  ])('/agendar com %s: 409 descartado, sem card, sem Schedule, sem aviso', async (_n, resp) => {
    const r = await request(app).post('/io/solar/quiz/agendar').send(corpo(resp, { ymd: '2026-10-24', h: '07:00', dono: 'Nilce' }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, error: 'descartado' });
    semEscrita();
  });

  it('/agendar descartado recusa até o telefone FORA DO PADRÃO (que antes respondia 200 e disparava o pixel)', async () => {
    vi.mocked(estaBloqueado).mockResolvedValue(true);
    try {
      const r = await request(app).post('/io/solar/quiz/agendar').send(corpo(RESP_NOTA_65, { ymd: '2026-10-24', h: '07:00', dono: 'Nilce' }));
      expect(r.status).toBe(409);
    } finally { vi.mocked(estaBloqueado).mockResolvedValue(false); }
  });

  it('lead bom segue marcando normalmente (o portão não afeta quem passa)', async () => {
    const r = await request(app).post('/io/solar/quiz/agendar').send(corpo(RESP_BOA, { ymd: '2026-10-24', h: '07:00', dono: 'Nilce' }));
    expect(r.status).toBe(200);
    expect(h.ger.tabela('agendamentos')).toHaveLength(1);
  });
});

describe('POST /quiz/saiu', () => {
  const saiu = () => request(app).post('/io/solar/quiz/saiu').send({ tel: '5534991112222', onde: 'resultado' });
  const marcaSaiu = () => h.main.tabela('system_state').filter((l: any) => String(l.key).startsWith('solar_saiu:'));

  it('lead descartado não ganha marca de saída, mesmo que um rascunho antigo exista', async () => {
    await request(app).post('/io/solar/quiz').send(corpo(RESP_BOA));            // passou: o rascunho existe
    await request(app).post('/io/solar/quiz').send(corpo(RESP_NOTA_65));        // refez e foi descartado
    expect(h.ger.tabela('leads_meta')).toHaveLength(1);
    const r = await saiu();
    expect(r.body).toMatchObject({ ok: true, marcou: false, descartado: true });
    expect(marcaSaiu()).toHaveLength(0);
  });

  it('lead que passou segue gravando a marca de saída', async () => {
    await request(app).post('/io/solar/quiz').send(corpo(RESP_BOA));
    const r = await saiu();
    expect(r.body.marcou).toBe(true);
    expect(marcaSaiu()).toHaveLength(1);
  });
});
