import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { banco, evento, consultaFalsa, respostaJson } from './_monjourBancoFalso';

// GET /admin/monjour/gostos: o que mais gostam no app, retenção desde a compra e o dia em que param.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => consultaFalsa() } }));

import adminMonjour from '../routes/adminMonjour';

const app = express();
app.use(express.json());
app.use('/admin/monjour', adminMonjour);

const [M1, M2, M3, M4, M5, M6] = ['1', '2', '3', '4', '5', '6'].map((x) => `a${x}`.repeat(12));
const COMPRA = '2026-11-20T15:00:00.000Z';
let compras: Record<string, unknown>[] = [];

const venda = (m: string, quando: string) => ({ m, email: `${m.slice(0, 2)}@x.com`, plano: 'basico', tipo: 'compra', quando, pais: 'MX' });
const uso = (m: string, acao: string, quando: string, extra: Record<string, unknown> = {}) =>
  banco.linhas.push(evento('s-' + m, 'monjour_app', { lp: 'monjour', acao, m, ...extra }, quando));
const siteOk = () => vi.fn(async () => respostaJson({
  periodo: {}, truncado: false, vendas: { lista: compras }, leads: { total: 0, compraram: 0, conversao: 0, porDia: [], lista: [] },
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T15:00:00Z'));
  vi.stubEnv('MONJOUR_ADMIN_TOKEN', 'token-de-teste-com-mais-de-24-caracteres');
  banco.linhas = []; banco.consultas = []; banco.erro = false;
  compras = [M1, M2, M3, M4, M5].map((m) => venda(m, COMPRA)).concat(venda(M6, '2026-11-24T15:00:00.000Z'));
  vi.stubGlobal('fetch', siteOk());

  // D1: M1 e M2. D3: M1 e M4. M6 comprou ontem e voltou hoje.
  uso(M1, 'abriu', '2026-11-20T16:00:00Z', { dia: 1 });
  uso(M1, 'abriu', '2026-11-21T16:00:00Z', { dia: 2 });
  uso(M1, 'abriu', '2026-11-23T16:00:00Z', { dia: 4 });
  uso(M2, 'abriu', '2026-11-20T16:00:00Z', { dia: 1 });
  uso(M2, 'abriu', '2026-11-21T16:00:00Z', { dia: 2 });
  uso(M3, 'abriu', '2026-11-20T17:00:00Z', { dia: 1 });
  uso(M4, 'abriu', '2026-11-20T18:00:00Z', { dia: 1 });
  uso(M4, 'abriu', '2026-11-23T18:00:00Z', { dia: 4 });
  uso(M6, 'abriu', '2026-11-25T12:00:00Z', { dia: 2 });
  for (let i = 0; i < 3; i += 1) uso(M1, 'receta_vista', `2026-11-21T17:0${i}:00Z`, { alvo: 'r1', nome: 'Huevos a la mexicana' });
  uso(M2, 'receta_vista', '2026-11-21T17:10:00Z', { alvo: 'r1', nome: 'Huevos a la mexicana' });
  uso(M3, 'receta_vista', '2026-11-20T17:10:00Z', { alvo: 'r2', nome: 'Avena' });
  uso(M1, 'receta_hecha', '2026-11-21T17:20:00Z', { alvo: 'r1', nome: 'Huevos a la mexicana', tipo: 'desayuno' });
  uso(M1, 'favorito', '2026-11-21T18:00:00Z', { alvo: 'r1', on: true });
  uso(M2, 'favorito', '2026-11-21T18:01:00Z', { alvo: 'r1', on: true });
  uso(M2, 'favorito', '2026-11-21T18:30:00Z', { alvo: 'r1', on: false });
  uso(M3, 'favorito', '2026-11-20T18:00:00Z', { alvo: 'r2', on: true });
  uso(M1, 'infusion_hecha', '2026-11-21T09:00:00Z', { alvo: 'i1', nome: 'Jengibre con limón' });
  uso(M1, 'infusion_hecha', '2026-11-22T09:00:00Z', { alvo: 'i1', nome: 'Jengibre con limón' });
  uso(M2, 'infusion_hecha', '2026-11-21T09:00:00Z', { alvo: 'i1', nome: 'Jengibre con limón' });
  uso(M1, 'aba', '2026-11-21T16:01:00Z', { alvo: 'hoy' });
  uso(M1, 'aba', '2026-11-22T16:01:00Z', { alvo: 'hoy' });
  uso(M2, 'aba', '2026-11-21T16:01:00Z', { alvo: 'hoy' });
  uso(M1, 'aba', '2026-11-21T16:02:00Z', { alvo: 'recetas' });
  uso(M1, 'lista_bloque', '2026-11-21T19:00:00Z', { alvo: 'bloque1', cada: 4 });
  uso(M1, 'lo_tengo', '2026-11-21T19:01:00Z', { alvo: 'huevos' });
  uso(M2, 'enviar_lista', '2026-11-21T19:02:00Z', { alvo: 'bloque1' });
  uso(M1, 'peso_registrado', '2026-11-21T19:03:00Z', { dia: 2 });
  uso(M1, 'instalou', '2026-11-21T19:04:00Z');
  uso(M2, 'instalou', '2026-11-21T19:05:00Z');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('GET /admin/monjour/gostos', () => {
  it('receitas, infusões e favoritas ordenadas por vezes, com as pessoas distintas', async () => {
    const r = await request(app).get('/admin/monjour/gostos?period=maximo');
    expect(r.status).toBe(200);
    expect(r.body.recetasVistas).toEqual([
      { alvo: 'r1', nome: 'Huevos a la mexicana', vezes: 4, pessoas: 2 },
      { alvo: 'r2', nome: 'Avena', vezes: 1, pessoas: 1 },
    ]);
    expect(r.body.recetasFeitas).toEqual([{ alvo: 'r1', nome: 'Huevos a la mexicana', vezes: 1, pessoas: 1 }]);
    // Quem desfavoritou deixa de contar nas pessoas, mas os cliques seguem nas vezes.
    expect(r.body.favoritas).toEqual([
      { alvo: 'r1', nome: 'r1', vezes: 2, pessoas: 1 },
      { alvo: 'r2', nome: 'r2', vezes: 1, pessoas: 1 },
    ]);
    expect(r.body.infusoes).toEqual([{ alvo: 'i1', nome: 'Jengibre con limón', vezes: 3, pessoas: 2 }]);
  });

  it('uso de cada aba, lista de mercado, peso e instalação em porcentagem de quem usou', async () => {
    const r = await request(app).get('/admin/monjour/gostos?period=maximo');
    expect(r.body.pessoas).toBe(5);
    expect(r.body.abas).toEqual([
      { aba: 'hoy', pessoas: 2, vezes: 3 }, { aba: 'recetas', pessoas: 1, vezes: 1 },
      { aba: 'compras', pessoas: 0, vezes: 0 }, { aba: 'progreso', pessoas: 0, vezes: 0 },
      { aba: 'plus', pessoas: 0, vezes: 0 }, { aba: 'ayuda', pessoas: 0, vezes: 0 },
    ]);
    expect(r.body.usoLista).toBe(40);
    expect(r.body.registraPeso).toBe(20);
    expect(r.body.instalou).toBe(40);
  });

  it('retenção por dia desde a compra só conta quem já completou o dia', async () => {
    const r = await request(app).get('/admin/monjour/gostos?period=maximo');
    // D1: 3 de 6 (M1, M2 e M6). D3: 2 de 5 (M6 ainda não completou 3 dias). D7 em diante: ninguém completou, sem medida.
    expect(r.body.retencao).toEqual([
      { dia: 1, pct: 50, elegiveis: 6 }, { dia: 3, pct: 40, elegiveis: 5 },
      { dia: 7, pct: null, elegiveis: 0 }, { dia: 14, pct: null, elegiveis: 0 }, { dia: 21, pct: null, elegiveis: 0 },
    ]);
  });

  it('coorte vazia: ninguém elegível vira pct null, nunca 0%', async () => {
    // Em Hoje ninguém comprou hoje: não dá para medir, o que é diferente de ninguém voltar.
    const r = await request(app).get('/admin/monjour/gostos?period=hoje');
    expect(r.body.retencao).toEqual([1, 3, 7, 14, 21].map((dia) => ({ dia, pct: null, elegiveis: 0 })));
    // Elegível que não voltou continua 0%, não null.
    compras = [venda(M5, COMPRA)];
    const r2 = await request(app).get('/admin/monjour/gostos?period=maximo');
    expect(r2.body.retencao[0]).toEqual({ dia: 1, pct: 0, elegiveis: 1 });
  });

  it('em que dia do plano as pessoas param', async () => {
    const r = await request(app).get('/admin/monjour/gostos?period=maximo');
    // M2 (dia 2) e M3 (dia 1) estão sem uso há 3 dias ou mais; M1 e M4 usaram há dois dias, M6 hoje.
    expect(r.body.paramNoDia).toEqual([{ dia: 1, pessoas: 1 }, { dia: 2, pessoas: 1 }]);
  });

  it('o período recorta o uso', async () => {
    const r = await request(app).get('/admin/monjour/gostos?period=hoje');
    expect(r.body.periodo).toBe('hoje');
    expect(r.body.pessoas).toBe(1);
    expect(r.body.recetasVistas).toEqual([]);
    expect(r.body.retencao.every((x: { pct: number | null }) => x.pct === null)).toBe(true);
    expect(r.body.abas).toHaveLength(6);
  });

  it('período desconhecido vira 7dias e sem uso nada quebra', async () => {
    banco.linhas = [];
    const r = await request(app).get('/admin/monjour/gostos?period=xyz');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ periodo: '7dias', pessoas: 0, usoLista: 0, registraPeso: 0, instalou: 0, paramNoDia: [] });
  });

  it('site fora: o uso sai, a retenção vem sem medida e indisponivel avisa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson({}, 503)));
    const r = await request(app).get('/admin/monjour/gostos?period=maximo');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ indisponivel: true, motivo: 'O site do Monjour respondeu 503' });
    expect(r.body.recetasVistas[0].alvo).toBe('r1');
    expect(r.body.retencao.every((x: { pct: number | null }) => x.pct === null)).toBe(true);
  });

  it('banco fora volta 500', async () => {
    banco.erro = true;
    expect((await request(app).get('/admin/monjour/gostos')).status).toBe(500);
  });
});
