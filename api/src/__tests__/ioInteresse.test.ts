import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// A rota da lista da Irmãos na Obra: validação por porta, gravação e quem chama card e aviso (19/11/2026).
const h = vi.hoisted(() => ({
  rpc: [] as Array<{ nome: string; args: Record<string, any> }>,
  resposta: { data: { id: 1, posicao: 7, novo: true, card_solar_id: null, card_eletroposto_id: null }, error: null } as any,
  wa: [] as string[], cards: [] as string[], avisos: [] as any[], voltou: false,
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    rpc: (nome: string, args: Record<string, any>) => { h.rpc.push({ nome, args }); return Promise.resolve(h.resposta); },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: 3, error: null }) }) }),
  },
}));
vi.mock('../services/nexus/verificaWhatsapp', () => ({
  verificarWhatsapp: async (tel: string) => { h.wa.push(tel); return { whatsappOk: true }; },
}));
vi.mock('../services/io/listaIgCards', () => ({
  TABELA_LISTA: 'io_instagram_interesse',
  criarCardSolar: async () => { h.cards.push('solar'); if (h.voltou) return { status: 'voltou', card: { id: 77, dono: 'Nilce' } }; return { status: 'ok', card: { id: 11, quando: '2026-11-19T17:05:00Z', dono: 'Nilce' } }; },
  criarCardEletroposto: async () => { h.cards.push('eletroposto'); return { status: 'ok', card: { id: 12, quando: '2026-11-19T17:05:00Z', dono: 'Diego' } }; },
}));
vi.mock('../services/io/listaIgAviso', () => ({ avisarLeadDaLista: async (p: any) => { h.avisos.push(p); return { motivo: 'enviado', enviados: [] }; } }));

import { cadastrarInteresseIo, ioInteresseLimiter, listarInteresseIoAdmin } from '../routes/ioInteresse';

const app = express();
app.use(express.json());
app.post('/x', cadastrarInteresseIo);
const contato = { nome: 'Ana Souza', telefone: '55 (34) 99111-2222', email: 'ana@exemplo.com', cidade: 'Uberlândia', uf: 'MG' };
const SOLAR = { ...contato, porta: 'solar', solar: { tipo: 'casa', conta: '300_600', pagamento: 'cartao' } };
const ELE = { ...contato, porta: 'eletroposto', caminho: 'parceiro', respostas: { atuacao: 'eletricista', experiencia: 'nunca', interesse: 'vender', empresa: 'Luz Ltda' } };
const INT = { ...contato, porta: 'integrador', integrador: { atuacao: 'integrador', equipe: '2_5', propostas: '10_30' } };
const MOB = { ...contato, porta: 'mobilidade', mobilidade: ['moto', 'patinete'], objetivo: 'frota', investimento: '100_250', recurso: 'os_dois' };
// A resposta sai antes do card e do aviso (waitUntil): espera a fila de promessas andar.
const post = async (b: object) => { const r = await request(app).post('/x').send(b); await new Promise(ok => setTimeout(ok, 20)); return r; };

beforeEach(() => {
  h.rpc.length = 0; h.wa.length = 0; h.cards.length = 0; h.avisos.length = 0; h.voltou = false;
  h.resposta = { data: { id: 1, posicao: 7, novo: true, card_solar_id: null, card_eletroposto_id: null }, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function recusa(b: object) {
  h.rpc.length = 0;
  const r = await post(b);
  expect(r.status).toBe(400);
  expect(r.body.erro).toMatch(/^[A-ZÁÉÍÓÚ]/);
  expect(h.rpc).toHaveLength(0);
}

describe('validação por porta', () => {
  it('solar grava p_portas e p_solar, cria o card da Nilce e avisa', async () => {
    const r = await post(SOLAR);
    expect(r.body).toEqual({ ok: true, posicao: 7, novo: true });
    expect(h.rpc[0].nome).toBe('io_instagram_gravar');
    expect(h.rpc[0].args).toMatchObject({ p_portas: ['solar'], p_solar: SOLAR.solar, p_telefone: '5534991112222', p_whatsapp_ok: true, p_teste: false });
    expect(h.cards).toEqual(['solar']);
    expect(h.avisos[0]).toMatchObject({ porta: 'solar', cardId: 11, dono: 'nilce' });
  });
  it('solar: resposta faltando, fora da lista ou com tipo errado é 400', async () => {
    await recusa({ ...SOLAR, solar: { tipo: 'casa', conta: '300_600' } });
    await recusa({ ...SOLAR, solar: { ...SOLAR.solar, conta: 'muito' } });
    await recusa({ ...SOLAR, solar: { ...SOLAR.solar, tipo: 1 } });
    await recusa({ ...SOLAR, solar: 'casa' });
    await recusa({ ...SOLAR, porta: 'outra' });
    await recusa({ ...SOLAR, nome: 123 });
  });
  it('eletroposto: 6 caminhos e as 3 respostas da NEXUS, empresa só no parceiro; cria o card e avisa pelo dono', async () => {
    await post(ELE);
    expect(h.rpc[0].args).toMatchObject({ p_portas: ['eletroposto'], p_eletroposto: ['parceiro'], p_eletroposto_respostas: { parceiro: ELE.respostas } });
    expect(h.avisos[0]).toMatchObject({ porta: 'eletroposto', cardId: 12, dono: 'diego' });
    h.rpc.length = 0;
    await post({ ...ELE, caminho: 'cotista', respostas: { local: 'meu', capital: '100', recurso: 'proprio', empresa: 'X' } });
    expect(h.rpc[0].args.p_eletroposto_respostas).toEqual({ cotista: { local: 'meu', capital: '100', recurso: 'proprio' } });
    await recusa({ ...ELE, caminho: 'frota' });
    await recusa({ ...ELE, respostas: { atuacao: 'eletricista', experiencia: 'nunca' } });
    await recusa({ ...ELE, respostas: [] });
  });
  it('integrador e mobilidade: só a lista, nada de card nem aviso', async () => {
    await post(INT);
    await post(MOB);
    expect(h.rpc.map(c => c.args.p_portas)).toEqual([['integrador'], ['mobilidade']]);
    expect(h.rpc[1].args).toMatchObject({ p_mobilidade: ['moto'], p_objetivo: 'frota', p_investimento: '100_250', p_recurso: 'os_dois' });
    expect(h.cards).toEqual([]);
    expect(h.avisos).toEqual([]);
    await recusa({ ...INT, integrador: { ...INT.integrador, equipe: '50' } });
    await recusa({ ...MOB, investimento: 'ate_10' });
    await recusa({ ...MOB, investimento: '10_50' });
    await recusa({ ...MOB, mobilidade: ['patinete'] });
    await recusa({ ...MOB, recurso: ['proprio'] });
  });
  it('quem voltou com card parado: aviso "voltou" à equipe, com o card que existe', async () => {
    h.voltou = true;
    await post(SOLAR);
    expect(h.avisos[0]).toMatchObject({ porta: 'solar', cardId: 77, dono: 'nilce', voltou: true });
    expect(h.avisos[0].texto).toContain('voltou pela lista do Instagram');
  });
  it('telefone de teste: grava como teste, não consulta o WhatsApp, sem card e sem aviso', async () => {
    await post({ ...SOLAR, telefone: '553490000012' });
    await post({ ...ELE, telefone: '5534900000123' });
    expect(h.rpc.map(c => c.args.p_teste)).toEqual([true, true]);
    expect(h.wa).toEqual([]);
    expect(h.cards).toEqual([]);
    expect(h.avisos).toEqual([]);
  });
  it('a linha que já tem card não cria outro nem avisa; honeypot não grava', async () => {
    h.resposta = { data: { id: 1, posicao: 7, card_solar_id: 99, card_eletroposto_id: 98 }, error: null };
    await post(SOLAR);
    await post(ELE);
    expect(h.cards).toEqual([]);
    const r = await post({ ...SOLAR, site: 'x' });
    expect(r.body).toEqual({ ok: true, posicao: 4, novo: true });
    expect(h.rpc).toHaveLength(2);
  });
});

describe('rotas no router de ioSolar', () => {
  async function handlersDa(metodo: 'get' | 'post', caminho: string) {
    const mod = await import('../routes/ioSolar');
    const camada = ((mod.default as any).stack as any[]).find((x) => x.route && x.route.path === caminho && x.route.methods[metodo]);
    expect(camada).toBeTruthy();
    return camada.route.stack.map((s: any) => s.handle) as Function[];
  }
  it('GET /lista-interesse/admin: authMiddleware, adminMiddleware e o handler, nessa ordem', async () => {
    const { authMiddleware } = await import('../middleware/auth');
    const { adminMiddleware } = await import('../middleware/adminAuth');
    expect(await handlersDa('get', '/lista-interesse/admin')).toEqual([authMiddleware, adminMiddleware, listarInteresseIoAdmin]);
  }, 60000);
  it('POST /lista-interesse: limitador antes do handler', async () => {
    expect(await handlersDa('post', '/lista-interesse')).toEqual([ioInteresseLimiter, cadastrarInteresseIo]);
  }, 60000);
});
