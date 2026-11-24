import { describe, it, expect, vi, beforeEach } from 'vitest';

// A contagem do déficit só olha cards de DEPOIS do início da divisão (SOLAR_DIVISAO_INICIO). Desde 24/10 todo card solar é da
// Nilce: contar esse passado faria ela estrear a divisão sem receber lead por semanas.

type Row = Record<string, any>;
let banco: Row[] = [];
let gtes: string[] = [];

// O banco aplica o filtro `gte('created_at', ...)` de verdade (o duble antigo ignorava).
function cadeia() {
  const filtros: Array<(r: Row) => boolean> = [];
  const c: any = {};
  c.select = () => c;
  c.order = () => c;
  c.in = (col: string, vals: unknown[]) => { filtros.push(r => vals.includes(r[col])); return c; };
  c.neq = (col: string, v: unknown) => { filtros.push(r => r[col] !== v); return c; };
  c.gte = (col: string, v: string) => { gtes.push(v); filtros.push(r => String(r[col]) >= String(v)); return c; };
  c.range = () => Promise.resolve({ data: banco.filter(r => filtros.every(f => f(r))), error: null });
  return c;
}
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => cadeia() } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { candidatosDoGrupo, desdeDaContagem, _limparCacheDivisao, SOLAR_DIVISAO_INICIO } from '../services/agenda/divisaoSolar';
import { SOLAR_DIVISAO_INICIO as INICIO_DA_ROTA } from '../services/agenda/solarRota';

const INICIO_MS = Date.parse(SOLAR_DIVISAO_INICIO);   // a constante, nunca uma data escrita à mão: o horário exato muda na entrada no ar
const DIA = 86_400_000;
const card = (vendedor: string, createdMs: number): Row => ({
  vendedor_nome: vendedor, status: 'agendado', created_by: 'lp_solar', created_at: new Date(createdMs).toISOString(),
  observacao: 'LP SOLAR QUIZ\nConta de luz: R$ 400 a R$ 800',
});

beforeEach(() => { _limparCacheDivisao(); banco = []; gtes = []; });

describe('o início da divisão', () => {
  it('a constante é uma data válida e é a mesma da rota e da divisão', () => {
    expect(Number.isFinite(INICIO_MS)).toBe(true);
    expect(INICIO_DA_ROTA).toBe(SOLAR_DIVISAO_INICIO);
  });

  it('a janela é max(agora - 30 dias, início): na estreia vale o início; depois de 30 dias, a janela', () => {
    expect(desdeDaContagem(INICIO_MS + 2 * DIA)).toBe(new Date(INICIO_MS).toISOString());
    expect(desdeDaContagem(INICIO_MS + 40 * DIA)).toBe(new Date(INICIO_MS + 10 * DIA).toISOString());
  });

  it('o início passado como argumento (a env) manda no corte', () => {
    const outro = new Date(INICIO_MS + 7 * DIA).toISOString();
    expect(desdeDaContagem(Date.parse(outro) + DIA, outro)).toBe(outro);
  });

  it('card de antes do início não conta: a Nilce cheia de cards antigos e ninguém com card novo, o 1º do grupo menor sai pela ordem da tabela', async () => {
    const agora = INICIO_MS + 2 * DIA;
    // 20 cards da Nilce de antes da divisão (24/10 a 22/11) e nenhum de ninguém depois dela.
    for (let i = 0; i < 20; i++) banco.push(card('Nilce', INICIO_MS - (i + 1) * DIA));
    const lista = await candidatosDoGrupo('menor', { agoraMs: agora });
    expect(lista).toEqual(['Nilce', 'Giovanna']);
    expect(gtes).toEqual([new Date(INICIO_MS).toISOString()]);
  });

  it('card de depois do início conta: a Nilce com 2 cards novos passa a vez para a Giovanna', async () => {
    const agora = INICIO_MS + 2 * DIA;
    for (let i = 0; i < 20; i++) banco.push(card('Nilce', INICIO_MS - (i + 1) * DIA));
    banco.push(card('Nilce', INICIO_MS + 3_600_000), card('Nilce', INICIO_MS + 7_200_000));
    expect((await candidatosDoGrupo('menor', { agoraMs: agora }))[0]).toBe('Giovanna');
  });
});
