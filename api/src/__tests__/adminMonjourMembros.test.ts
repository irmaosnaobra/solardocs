import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { banco, evento, consultaFalsa, respostaJson } from './_monjourBancoFalso';

// GET /admin/monjour/membros e /membros/:m: compras do site (com `m`) juntas ao uso do app em lp_events.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consultaFalsa() } }));

import adminMonjour from '../routes/adminMonjour';

const app = express();
app.use(express.json());
app.use('/admin/monjour', adminMonjour);

const TOKEN = 'token-de-teste-com-mais-de-24-caracteres';
const [A, B, C, D, E, F] = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => x.repeat(24));
let compras: Record<string, unknown>[] = [];
let truncadoSite = false;

const venda = (m: string, email: string, plano: string, quando: string) =>
  ({ m, email, plano, tipo: 'compra', quando, valorCentavos: 990, pais: 'MX', reembolsada: false, contestada: false, utmContent: '' });
const uso = (m: string, acao: string, quando: string, extra: Record<string, unknown> = {}) =>
  banco.linhas.push(evento('s-' + m, 'monjour_app', { lp: 'monjour', acao, m, ...extra }, quando));
const corpoSite = () => ({
  periodo: {}, atualizadoEm: '', truncado: truncadoSite,
  vendas: { compras: compras.length, lista: compras }, leads: { total: 0, compraram: 0, conversao: 0, porDia: [], lista: [] },
});
const ids = (r: { body: { itens: { m: string }[] } }) => r.body.itens.map((i) => i.m);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T15:00:00Z'));
  vi.stubEnv('MONJOUR_ADMIN_TOKEN', TOKEN);
  vi.stubGlobal('fetch', vi.fn(async () => respostaJson(corpoSite())));
  banco.linhas = []; banco.consultas = []; banco.erro = false; truncadoSite = false;
  compras = [
    venda(A, 'ana@x.com', 'basico', '2026-11-22T15:00:00.000Z'),
    venda(B, 'bia@x.com', 'plus', '2026-11-20T15:00:00.000Z'),
    venda(C, 'caio@x.com', 'basico', '2026-11-20T10:00:00.000Z'),
    venda(E, 'eva@x.com', 'basico', '2026-11-25T10:00:00.000Z'),
  ];
  // Ana: 3 dias de uso, instalou, último uso há 26 h.
  uso(A, 'abriu', '2026-11-22T16:00:00Z', { dia: 1 });
  uso(A, 'abriu', '2026-11-23T14:00:00Z', { dia: 2 });
  uso(A, 'infusion_hecha', '2026-11-23T14:05:00Z', { alvo: 'i1', nome: 'Jengibre con limón', dia: 2 });
  uso(A, 'receta_vista', '2026-11-23T14:10:00Z', { alvo: 'r1', nome: 'Huevos a la mexicana', tipo: 'desayuno' });
  uso(A, 'abriu', '2026-11-24T13:00:00Z', { dia: 3 });
  uso(A, 'aba', '2026-11-24T13:01:00Z', { alvo: 'recetas' });
  uso(A, 'instalou', '2026-11-24T13:02:00Z');
  uso(A, 'peso_registrado', '2026-11-24T13:03:00Z', { dia: 3 });
  uso(A, 'enviar_lista', '2026-11-24T13:04:00Z', { alvo: 'bloque1' });
  // Bia parou no dia 1.
  uso(B, 'abriu', '2026-11-20T16:00:00Z', { dia: 1 });
  uso(B, 'receta_vista', '2026-11-21T16:00:00Z', { alvo: 'r2', nome: 'Avena', plan: 'plus' });
  // Quem tem uso e nenhuma compra: um de cortesia e um sem nada.
  uso(D, 'abriu', '2026-11-24T14:00:00Z', { dia: 1, plan: 'plus', cortesia: true, pais: 'CO' });
  uso(F, 'abriu', '2026-11-23T15:30:00Z', { dia: 1 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('GET /admin/monjour/membros', () => {
  it('junta compra e uso, do uso mais recente ao mais antigo, e quem nunca usou no fim', async () => {
    const r = await request(app).get('/admin/monjour/membros?period=maximo');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(6);
    expect(ids(r)).toEqual([D, A, F, B, E, C]);
    const ana = r.body.itens.find((i: { m: string }) => i.m === A);
    expect(ana).toEqual({
      m: A, email: 'ana@x.com', plano: 'basico', compradoEm: '2026-11-22T15:00:00.000Z', pais: 'MX', cortesia: false, semCompra: false,
      ultimoUso: '2026-11-24T13:04:00.000Z', diasAtivos: 3, diaMaximo: 3, instalou: true, nota: 79, parado: false,
    });
  });

  it('com compra e sem uso, e sem compra (cortesia ou não)', async () => {
    const r = await request(app).get('/admin/monjour/membros?period=maximo');
    const por = (m: string) => r.body.itens.find((i: { m: string }) => i.m === m);
    expect(por(C)).toMatchObject({ email: 'caio@x.com', ultimoUso: null, diasAtivos: 0, diaMaximo: null, instalou: false, nota: 0, parado: true });
    expect(por(E)).toMatchObject({ ultimoUso: null, parado: false });
    expect(por(D)).toMatchObject({ email: null, plano: 'plus', compradoEm: null, pais: 'CO', cortesia: true, semCompra: true, parado: false });
    expect(por(F)).toMatchObject({ email: null, cortesia: false, semCompra: true, plano: null });
  });

  it('busca por e-mail, filtro de plano e parados há 3 dias ou mais', async () => {
    expect(ids(await request(app).get('/admin/monjour/membros?q=ANA'))).toEqual([A]);
    expect(ids(await request(app).get(`/admin/monjour/membros?q=${F.slice(0, 6)}`))).toEqual([F]);
    expect(ids(await request(app).get('/admin/monjour/membros?plano=plus'))).toEqual([D, B]);
    expect(ids(await request(app).get('/admin/monjour/membros?parados=1'))).toEqual([B, C]);
    expect(ids(await request(app).get('/admin/monjour/membros?parados=1&plano=basico'))).toEqual([C]);
  });

  it('cortesia e sem compra filtram na api, com o total do filtro', async () => {
    const cortesia = await request(app).get('/admin/monjour/membros?plano=cortesia');
    expect(ids(cortesia)).toEqual([D]);
    expect(cortesia.body.total).toBe(1);
    const sem = await request(app).get('/admin/monjour/membros?plano=sem_compra');
    expect(ids(sem)).toEqual([F]);
    expect(sem.body.total).toBe(1);
  });

  it('site fora: a leitura do uso para em vez de ir até o teto', async () => {
    // 3 páginas de uso; o site responde fora antes da segunda.
    for (let i = 0; i < 2500; i += 1) uso(A, 'aba', new Date(Date.parse('2026-11-24T00:00:00Z') + i * 1000).toISOString(), { alvo: 'hoy' });
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson({}, 503)));
    banco.atrasoMs = 20;
    try {
      const r = await request(app).get('/admin/monjour/membros');
      expect(r.body.indisponivel).toBe(true);
      expect(banco.consultas.length).toBeLessThan(3);
    } finally { banco.atrasoMs = 0; }
  });

  it('o período vale só para os dias ativos', async () => {
    const hoje = await request(app).get('/admin/monjour/membros?period=hoje');
    const ana = hoje.body.itens.find((i: { m: string }) => i.m === A);
    expect(ana).toMatchObject({ diasAtivos: 0, nota: 79, ultimoUso: '2026-11-24T13:04:00.000Z' });
    const ontem = await request(app).get('/admin/monjour/membros?period=ontem');
    expect(ontem.body.itens.find((i: { m: string }) => i.m === A).diasAtivos).toBe(1);
  });

  it('chama o site com a janela máxima e o token só no cabeçalho', async () => {
    const r = await request(app).get('/admin/monjour/membros');
    const chamada = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(chamada[0])).toContain('/api/admin-resumo?desde=2026-11-19&ate=2026-11-25');
    expect(chamada[1].headers['x-admin-token']).toBe(TOKEN);
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });

  it('lista que o site cortou em 500 sai com truncado', async () => {
    truncadoSite = true;
    expect((await request(app).get('/admin/monjour/membros')).body.truncado).toBe(true);
  });

  it('compra sem `m` (site antigo) não vira membro', async () => {
    compras = [{ ...venda(A, 'ana@x.com', 'basico', '2026-11-22T15:00:00.000Z'), m: undefined }];
    const r = await request(app).get('/admin/monjour/membros');
    expect(ids(r)).not.toContain('undefined');
    expect(r.body.itens.every((i: { semCompra: boolean }) => i.semCompra)).toBe(true);
  });

  it('site fora, sem token ou fora do formato: 200 com indisponivel e lista vazia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede'); }));
    const fora = await request(app).get('/admin/monjour/membros');
    expect(fora.status).toBe(200);
    expect(fora.body).toMatchObject({ indisponivel: true, total: 0, itens: [], motivo: 'O site do Monjour está fora do ar' });
    vi.stubEnv('MONJOUR_ADMIN_TOKEN', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const semToken = await request(app).get('/admin/monjour/membros');
    expect(semToken.body).toMatchObject({ indisponivel: true, itens: [] });
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv('MONJOUR_ADMIN_TOKEN', TOKEN);
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson({ nada: 1 })));
    expect((await request(app).get('/admin/monjour/membros')).body.indisponivel).toBe(true);
  });

  it('só as colunas do uso são lidas e o banco fora volta 500', async () => {
    await request(app).get('/admin/monjour/membros');
    expect(banco.consultas[0].colunas).toContain('m:event_data->>m');
    expect(banco.consultas[0].colunas).not.toContain('event_data,');
    banco.erro = true;
    expect((await request(app).get('/admin/monjour/membros')).status).toBe(500);
  });
});

describe('GET /admin/monjour/membros/:m', () => {
  it('linha do tempo em português, do mais novo ao mais velho, com os totais por ação', async () => {
    const r = await request(app).get(`/admin/monjour/membros/${A}`);
    expect(r.status).toBe(200);
    expect(r.body.membro).toMatchObject({ m: A, email: 'ana@x.com', plano: 'basico', nota: 79, diasAtivos: 3, instalou: true });
    expect(r.body.totais.porAcao).toEqual({
      abriu: 3, infusion_hecha: 1, receta_vista: 1, aba: 1, instalou: 1, peso_registrado: 1, enviar_lista: 1,
    });
    expect(r.body.linha.map((l: { texto: string }) => l.texto)).toEqual([
      'Mandou a lista de mercado', 'Registrou o peso', 'Instalou o app', 'Abriu a aba Receitas', 'Abriu o app no dia 3',
      'Viu a receita Huevos a la mexicana', 'Marcou a infusão Jengibre con limón', 'Abriu o app no dia 2', 'Abriu o app no dia 1',
    ]);
    expect(r.body.linha[0]).toEqual({ ts: '2026-11-24T13:04:00.000Z', acao: 'enviar_lista', texto: 'Mandou a lista de mercado' });
    expect(r.body.indisponivel).toBeUndefined();
  });

  it('membro sem compra mostra o uso; sem compra e sem uso é 404; m estranho é 400', async () => {
    const d = await request(app).get(`/admin/monjour/membros/${D.toUpperCase()}`);
    expect(d.body.membro).toMatchObject({ m: D, email: null, semCompra: true, cortesia: true });
    expect(d.body.linha).toHaveLength(1);
    expect((await request(app).get(`/admin/monjour/membros/${'9'.repeat(24)}`)).status).toBe(404);
    expect((await request(app).get('/admin/monjour/membros/xyz')).status).toBe(400);
    expect((await request(app).get(`/admin/monjour/membros/${A}'%20or%201=1`)).status).toBe(400);
  });

  it('membro que comprou e nunca usou aparece com a linha vazia', async () => {
    const r = await request(app).get(`/admin/monjour/membros/${C}`);
    expect(r.body.membro).toMatchObject({ email: 'caio@x.com', parado: true });
    expect(r.body.linha).toEqual([]);
    expect(r.body.totais.porAcao).toEqual({});
  });

  it('a linha tem no máximo 500 eventos, mas o total conta todos', async () => {
    const G = 'abcdef0123456789abcdef01';
    for (let i = 0; i < 600; i += 1) uso(G, 'aba', new Date(Date.UTC(2026, 10, 24, 12, 0, 0) + i * 1000).toISOString(), { alvo: 'hoy' });
    const r = await request(app).get(`/admin/monjour/membros/${G}`);
    expect(r.body.linha).toHaveLength(500);
    expect(r.body.totais.porAcao.aba).toBe(600);
    expect(r.body.linha[0].ts > r.body.linha[499].ts).toBe(true);
  });

  it('site fora: a linha do tempo sai, sem e-mail, com indisponivel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson({}, 500)));
    const r = await request(app).get(`/admin/monjour/membros/${A}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ indisponivel: true, motivo: 'O site do Monjour respondeu 500' });
    expect(r.body.membro.email).toBeNull();
    expect(r.body.linha.length).toBe(9);
  });
});
