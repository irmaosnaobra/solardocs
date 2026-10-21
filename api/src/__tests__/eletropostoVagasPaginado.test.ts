import { describe, it, expect, vi, beforeEach } from 'vitest';

// carregarCompromissos LIA `agendamentos` com `.limit(2000)` e o PostgREST corta em
// 1000 linhas sem avisar: com a agenda passando disso, horário ocupado aparecia
// livre. Agora a leitura é paginada (e a das fichas do solar também). Aqui o banco
// falso devolve de 1000 em 1000, igual ao PostgREST, e o teste prova que as
// 2.300 linhas chegam e que erro em qualquer página devolve null.

type Linha = Record<string, any>;
const estado = vi.hoisted(() => ({
  ep: [] as Linha[],
  solar: [] as Linha[],
  chamadas: [] as Array<{ tipo: 'ep' | 'solar'; de: number; ate: number }>,
  /** Número (1-based) da página do EP que deve falhar; 0 = nenhuma. */
  falhaEpNaPagina: 0,
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/supabaseGerador', () => {
  // O PostgREST devolve no máximo 1000 linhas por resposta, mesmo se pedirem mais.
  const CORTE = 1000;
  class Q implements PromiseLike<any> {
    private tipo: 'ep' | 'solar' = 'ep';
    private faixa: [number, number] | null = null;
    private lim = Infinity;
    select() { return this; }
    eq(c: string, v: any) { if (c === 'created_by' && v === 'lp_solar') this.tipo = 'solar'; return this; }
    gte() { return this; }
    lte() { return this; }
    not() { return this; }
    in() { return this; }
    order() { return this; }
    limit(n: number) { this.lim = n; return this; }
    range(de: number, ate: number) { this.faixa = [de, ate]; return this; }
    then<A, B>(ok?: any, ko?: any): PromiseLike<A | B> { return this.exec().then(ok, ko); }
    private async exec() {
      const fonte = this.tipo === 'ep' ? estado.ep : estado.solar;
      const [de, ate] = this.faixa ?? [0, Infinity];
      if (this.faixa) estado.chamadas.push({ tipo: this.tipo, de, ate });
      if (this.tipo === 'ep' && this.faixa && estado.falhaEpNaPagina === de / CORTE + 1) {
        return { data: null, error: { message: 'caiu' } };
      }
      const teto = Math.min(this.lim, CORTE, ate - de + 1);
      return { data: fonte.slice(de, de + teto).map(l => ({ ...l })), error: null };
    }
  }
  return { supabaseGerador: { from: () => new Q() } };
});

import { carregarCompromissos } from '../services/io/eletropostoVagas';

const DE = '2026-11-02T00:00:00.000Z';
const ATE = '2026-11-23T00:00:00.000Z';
const DIA0 = Date.parse('2026-11-04T11:00:00.000Z');

/** N compromissos de eletroposto, um por minuto, sem repetir horário. */
const epLinhas = (n: number): Linha[] =>
  Array.from({ length: n }, (_, i) => ({
    quando: new Date(DIA0 + i * 60_000).toISOString(),
    vendedor_nome: i % 2 ? 'Thiago' : 'Diego',
    status: 'agendado',
    created_by: 'quiz_eletroposto',
  }));

beforeEach(() => {
  estado.ep = [];
  estado.solar = [];
  estado.chamadas = [];
  estado.falhaEpNaPagina = 0;
});

describe('carregarCompromissos paginado', () => {
  it('2.300 compromissos em páginas de 1000: a função vê todos', async () => {
    estado.ep = epLinhas(2300);
    const r = await carregarCompromissos(DE, ATE);
    expect(r).not.toBeNull();
    expect(r).toHaveLength(2300);
    expect(new Set(r!.map(c => c.ts)).size).toBe(2300);
    const ep = estado.chamadas.filter(c => c.tipo === 'ep');
    expect(ep.map(c => c.de)).toEqual([0, 1000, 2000]);
  });

  it('exatamente 1000 linhas pede a página seguinte e termina na vazia', async () => {
    estado.ep = epLinhas(1000);
    const r = await carregarCompromissos(DE, ATE);
    expect(r).toHaveLength(1000);
    expect(estado.chamadas.filter(c => c.tipo === 'ep').map(c => c.de)).toEqual([0, 1000]);
  });

  it('erro na 2ª página devolve null (lista parcial diria que a agenda está livre)', async () => {
    estado.ep = epLinhas(2300);
    estado.falhaEpNaPagina = 2;
    expect(await carregarCompromissos(DE, ATE)).toBeNull();
  });

  it('o filtro continua valendo: lp_solar sai da leitura comum e vencido não conta', async () => {
    estado.ep = [
      ...epLinhas(3),
      { quando: new Date(DIA0 + 99 * 60_000).toISOString(), vendedor_nome: 'Diego', status: 'agendado', created_by: 'lp_solar' },
      { quando: null, vendedor_nome: 'Diego', status: 'agendado', created_by: 'x' },
    ];
    const r = await carregarCompromissos(DE, ATE);
    expect(r).toHaveLength(3);
  });

  it('as fichas do solar também são paginadas: 1.500 fichas entram como vistoria', async () => {
    estado.ep = epLinhas(2);
    estado.solar = Array.from({ length: 1500 }, (_, i) => ({
      quando: new Date(DIA0 + i * 60_000).toISOString(),
      vendedor_nome: 'Thiago',
      created_by: 'lp_solar',
      cidade: null,
      observacao: null,
    }));
    const r = await carregarCompromissos(DE, ATE);
    expect(r).not.toBeNull();
    expect(r!.filter(c => c.vistoria)).toHaveLength(1500);
    expect(r).toHaveLength(1502);
    expect(estado.chamadas.filter(c => c.tipo === 'solar').map(c => c.de)).toEqual([0, 1000]);
  });
});
