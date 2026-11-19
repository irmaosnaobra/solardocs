import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Banco falso em memória: uma tabela nexus_interesse com o mínimo do PostgREST
// que o handler usa (select/eq/lte/maybeSingle/single/insert/update/count).
const h = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, any>>,
  proximoId: 1,
  falhar: false,
  cegarLeitura: false, // 1ª leitura por telefone devolve null (simula a corrida do 23505)
  escritas: [] as string[],
}));

function construtor() {
  const st: { op: string; payload?: any; filtros: Array<[string, string, any]>; head?: boolean } = { op: 'select', filtros: [] };
  const aplica = () => h.linhas.filter((l) => st.filtros.every(([c, t, v]) => (t === 'eq' ? l[c] === v : l[c] <= v)));
  const q: any = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) st.head = true; return q; },
    insert: (p: any) => { st.op = 'insert'; st.payload = p; return q; },
    update: (p: any) => { st.op = 'update'; st.payload = p; return q; },
    eq: (c: string, v: any) => { st.filtros.push([c, 'eq', v]); return q; },
    lte: (c: string, v: any) => { st.filtros.push([c, 'lte', v]); return q; },
    maybeSingle: () => {
      if (h.cegarLeitura) { h.cegarLeitura = false; return Promise.resolve({ data: null, error: null }); }
      return Promise.resolve(exec(true));
    },
    single: () => Promise.resolve(exec(true)),
    then: (ok: any, ko: any) => Promise.resolve(exec(false)).then(ok, ko),
  };
  function exec(um: boolean) {
    if (h.falhar) return { data: null, error: { message: 'boom' } };
    if (st.op !== 'select') h.escritas.push(st.op);
    if (st.op === 'insert') {
      if (h.linhas.some((l) => l.telefone === st.payload.telefone)) return { data: null, error: { code: '23505', message: 'dup' } };
      const nova = { id: h.proximoId++, ...st.payload };
      h.linhas.push(nova);
      return { data: nova, error: null };
    }
    if (st.op === 'update') {
      const alvo = aplica()[0];
      Object.assign(alvo, st.payload);
      return { data: alvo, error: null };
    }
    const r = aplica();
    if (st.head) return { data: null, count: r.length, error: null };
    return { data: um ? (r[0] ?? null) : r, error: null };
  }
  return q;
}

vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: true,
  supabaseGerador: { from: () => construtor() },
}));

import { cadastrarInteresse } from '../routes/nexusInteresse';

const app = express();
app.use(express.json());
app.post('/nexus-interesse', cadastrarInteresse);

const base = {
  itens: ['carro_compacto'], uso: 'proprio', nome: 'Maria Souza',
  telefone: '55 (34) 99999-0001', cidade: 'Uberlândia, MG',
};
const post = (b: object) => request(app).post('/nexus-interesse').send(b);

beforeEach(() => {
  h.linhas.length = 0; h.proximoId = 1; h.falhar = false; h.cegarLeitura = false; h.escritas.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /nexus-interesse: validação', () => {
  it('descarta item inválido e grava os válidos', async () => {
    const r = await post({ ...base, itens: ['moto', 'foguete', 'wallbox'] });
    expect(r.status).toBe(200);
    expect(h.linhas[0].itens).toEqual(['moto', 'wallbox']);
  });

  it('sem item válido é 400', async () => {
    const r = await post({ ...base, itens: ['foguete'] });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.erro).toMatch(/^[A-ZÁÉÍÓÚ]/);
    expect(h.linhas).toHaveLength(0);
  });

  it('telefone ruim é 400', async () => {
    expect((await post({ ...base, telefone: '34999990001' })).status).toBe(400);
    expect((await post({ ...base, telefone: '123' })).status).toBe(400);
    expect(h.linhas).toHaveLength(0);
  });

  it('uso inválido ou ausente é 400', async () => {
    expect((await post({ ...base, uso: 'lazer' })).status).toBe(400);
    expect((await post({ ...base, uso: undefined })).status).toBe(400);
  });

  it('nome curto é 400', async () => {
    expect((await post({ ...base, nome: 'A' })).status).toBe(400);
  });
});

describe('POST /nexus-interesse: gravação', () => {
  it('honeypot preenchido responde ok e não grava', async () => {
    await post({ ...base, telefone: '5511999990009' });
    h.escritas.length = 0;
    const r = await post({ ...base, site: 'http://spam.com' });
    expect(r.body).toEqual({ ok: true, posicao: 2, novo: true });
    expect(h.escritas).toEqual([]);
    expect(h.linhas).toHaveLength(1);
  });

  it('primeiro cadastro: novo e posição 1', async () => {
    const r = await post({ ...base, utm: { source: 'ig', medium: 'bio' }, origem: 'bio' });
    expect(r.body).toEqual({ ok: true, posicao: 1, novo: true });
    expect(h.linhas[0].telefone).toBe('5534999990001');
    expect(h.linhas[0].utm).toEqual({ source: 'ig', medium: 'bio' });
  });

  it('mesmo telefone une os itens, não troca nome/uso já gravados e preenche vazio', async () => {
    await post({ ...base, itens: ['moto', 'wallbox'], cidade: '' });
    const r = await post({ ...base, itens: ['wallbox', 'bateria'], nome: 'Outro Nome', uso: 'empresa', outro: 'quero financiar', cidade: 'Uberlândia, MG' });
    expect(r.body).toEqual({ ok: true, posicao: 1, novo: false });
    expect(h.linhas).toHaveLength(1);
    expect(h.linhas[0].itens).toEqual(['moto', 'wallbox', 'bateria']);
    expect(h.linhas[0].nome).toBe('Maria Souza');
    expect(h.linhas[0].uso).toBe('proprio');
    expect(h.linhas[0].outro).toBe('quero financiar');
    expect(h.linhas[0].cidade).toBeTruthy();
  });

  it('corrida (23505) vira update com a mesma regra', async () => {
    await post({ ...base, itens: ['moto'] });
    h.cegarLeitura = true;
    const r = await post({ ...base, itens: ['bateria'], nome: 'Outro Nome' });
    expect(r.body).toEqual({ ok: true, posicao: 1, novo: false });
    expect(h.escritas).toEqual(['insert', 'insert', 'update']);
    expect(h.linhas[0].itens).toEqual(['moto', 'bateria']);
    expect(h.linhas[0].nome).toBe('Maria Souza');
  });

  it('teste sobre lead real não vira teste', async () => {
    await post(base);
    await post({ ...base, teste: true });
    expect(h.linhas[0].teste).toBe(false);
  });

  it('chamada real sobre lead de teste tira o teste', async () => {
    await post({ ...base, teste: true });
    expect(h.linhas[0].teste).toBe(true);
    await post(base);
    expect(h.linhas[0].teste).toBe(false);
  });

  it('tipo errado dá 400, nunca 500', async () => {
    expect((await post({ ...base, nome: { a: 1 } })).status).toBe(400);
    expect((await post({ ...base, telefone: 5534999990001 })).status).toBe(400);
    expect((await post({ ...base, uso: ['proprio'] })).status).toBe(400);
    expect((await post({ ...base, itens: 'moto' })).status).toBe(400);
    const r = await post({ ...base, cidade: { x: 1 }, outro: 5, origem: [], utm: ['a'] });
    expect(r.status).toBe(200);
    expect(h.linhas[0].utm).toBeNull();
  });

  it('posição ignora linhas de teste', async () => {
    await post({ ...base, telefone: '5511999990002', teste: true });
    const r = await post({ ...base, telefone: '5511999990003' });
    expect(r.body.posicao).toBe(1);
    const r2 = await post({ ...base, telefone: '5511999990004' });
    expect(r2.body.posicao).toBe(2);
  });

  it('erro de banco é 500 com a frase combinada', async () => {
    h.falhar = true;
    const r = await post(base);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ ok: false, erro: 'Não deu para salvar agora. Tente de novo em instantes.' });
    expect(console.error).toHaveBeenCalled();
  });
});
