import { describe, it, expect, vi, beforeEach } from 'vitest';

// Guarda a gravação tolerante do endereço em partes: enquanto a migration
// MIGRATION_clients_endereco_partes.sql não rodar, o banco recusa as 4 colunas
// e o cadastro tem que repetir só com `endereco` (a linha completa).
type Chamada = { op: 'insert' | 'update'; valores: Record<string, unknown> };
const chamadas: Chamada[] = [];
let respostas: Array<{ data: unknown; error: unknown }> = [];
let linhaAtual: Record<string, unknown> | null = null; // o que o select('*') do PUT parcial devolve

vi.mock('../utils/supabase', () => {
  const cadeia = (op: 'insert' | 'update', valores: Record<string, unknown>) => {
    chamadas.push({ op, valores });
    const resp = respostas.shift() ?? { data: { id: 'c1' }, error: null };
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'select']) c[m] = () => c;
    c.single = () => Promise.resolve(resp);
    c.maybeSingle = () => Promise.resolve(resp);
    return c;
  };
  return {
    supabase: {
      from: () => ({
        insert: (v: Record<string, unknown>) => cadeia('insert', v),
        update: (v: Record<string, unknown>) => cadeia('update', v),
        // select('*') do PUT parcial: devolve a linha atual sem consumir `respostas`.
        select: () => {
          const c: Record<string, unknown> = {};
          c.eq = () => c;
          c.maybeSingle = () => Promise.resolve({ data: linhaAtual, error: null });
          return c;
        },
      }),
    },
  };
});

import { createClient, updateClient } from '../controllers/clientsController';

function res() {
  const r = { statusCode: 200, body: undefined as unknown } as { statusCode: number; body: unknown; status: (n: number) => typeof r; json: (b: unknown) => typeof r; send: () => typeof r };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = () => r;
  return r;
}

const partes = { logradouro: 'Rua das Flores', numero: '123', complemento: 'Apto 4', bairro: 'Centro' };
const semColuna = (code: string, msg: string) => ({ data: null, error: { code, message: msg } });

beforeEach(() => { chamadas.length = 0; respostas = []; linhaAtual = null; });

describe('clientsController: endereço em partes', () => {
  it('banco com as colunas: grava as partes e a linha montada, sem repetir', async () => {
    const r = res();
    await createClient({ body: { nome: 'Ana', ...partes }, userId: 'u1' } as never, r as never);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].valores).toMatchObject({ ...partes, endereco: 'Rua das Flores, 123, Apto 4, Centro' });
    expect(r.statusCode).toBe(201);
  });

  it('insert: PGRST204 repete sem as 4 partes e com o endereco montado', async () => {
    respostas = [semColuna('PGRST204', "Could not find the 'bairro' column of 'clients' in the schema cache")];
    const r = res();
    await createClient({ body: { nome: 'Ana', ...partes }, userId: 'u1' } as never, r as never);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].valores).toEqual({ nome: 'Ana', tipo: 'PF', endereco: 'Rua das Flores, 123, Apto 4, Centro', user_id: 'u1' });
    expect(r.statusCode).toBe(201);
  });

  it('update: 42703 repete sem as 4 partes e com o endereco montado', async () => {
    respostas = [semColuna('42703', 'column "logradouro" of relation "clients" does not exist')];
    const r = res();
    await updateClient({ body: { ...partes }, params: { id: 'c1' }, userId: 'u1' } as never, r as never);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].valores).toMatchObject({ endereco: 'Rua das Flores, 123, Apto 4, Centro' });
    expect(chamadas[1].valores).not.toHaveProperty('bairro');
    expect(r.statusCode).toBe(200);
  });

  it('erro de outra coluna não é engolido', async () => {
    respostas = [semColuna('42703', 'column "outra" of relation "clients" does not exist')];
    const r = res();
    await createClient({ body: { nome: 'Ana', ...partes }, userId: 'u1' } as never, r as never);
    expect(chamadas).toHaveLength(1);
    expect(r.statusCode).toBe(500);
  });

  it('sem nenhuma parte no corpo o endereco não é mexido', async () => {
    const r = res();
    await createClient({ body: { nome: 'Ana', endereco: 'Rua Velha, 9' }, userId: 'u1' } as never, r as never);
    expect(chamadas[0].valores).toMatchObject({ endereco: 'Rua Velha, 9' });
    expect(chamadas[0].valores).not.toHaveProperty('logradouro');
  });

  it('PUT parcial só com bairro, cliente sem partes no banco: a rua do endereco não some', async () => {
    linhaAtual = { id: 'c1', endereco: 'Rua X, 123' };
    const r = res();
    await updateClient({ body: { bairro: 'Centro' }, params: { id: 'c1' }, userId: 'u1' } as never, r as never);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].valores).toMatchObject({ logradouro: 'Rua X, 123', bairro: 'Centro', endereco: 'Rua X, 123, Centro' });
    expect(r.statusCode).toBe(200);
  });

  it('PUT parcial com o cliente já tendo partes: mantém as que não vieram', async () => {
    linhaAtual = { id: 'c1', endereco: 'Rua A, 1, Velho', logradouro: 'Rua A', numero: '1', complemento: '', bairro: 'Velho' };
    const r = res();
    await updateClient({ body: { bairro: 'Centro' }, params: { id: 'c1' }, userId: 'u1' } as never, r as never);
    expect(chamadas[0].valores).toMatchObject({ endereco: 'Rua A, 1, Centro' });
  });
});
