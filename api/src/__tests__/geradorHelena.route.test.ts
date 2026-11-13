import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rotas da aba Helena (só leitura), com login e banco simulados. Dados inventados.
// Prova: 401 sem token, a lista para consultor, a recusa da rota de pessoa para quem não é da equipe,
// o formato da conversa ({ de, texto, em }), o filtro de instância e erro de banco como 502.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  mensagens: [] as Array<Record<string, unknown>>,
  lids: [] as Array<Record<string, unknown>>,
  bancoFora: false,
  falhaDaLista: false,
  falhaDaAgenda: false,
  instancias: [] as string[],
  escritas: 0,
}));

function consulta(tabela: string) {
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => { if (tabela === 'wa_mensagens' && c === 'instancia') h.instancias.push(String(v)); return q; },
    in: () => q, order: () => q, limit: () => q,
    insert: () => { h.escritas++; return q; }, update: () => { h.escritas++; return q; },
    upsert: () => { h.escritas++; return q; }, delete: () => { h.escritas++; return q; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (h.bancoFora) return Promise.resolve({ data: null, error: { code: '08006', message: 'falha 5511988880001 oi tudo bem' } }).then(ok, ko);
      const data = tabela === 'wa_mensagens' ? h.mensagens : tabela === 'wa_lid_telefone' ? h.lids : [];
      return Promise.resolve({ data, error: null }).then(ok, ko);
    },
  };
  return q;
}

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
  },
}));
vi.mock('../services/io/helenaAcompanhamento', () => ({
  lerAcompanhamento: vi.fn(async () => {
    if (h.falhaDaLista) throw new Error('leitura da fila falhou 5511988880001');
    return { ok: true, ligada: true, itens: [{ chave: '1188880001', nome: 'Maria Teste', tipo: 'investidor', situacao: 'na_fila', card_id: null }] };
  }),
  lerPessoa: vi.fn(async (chave: string, item: { nome: string } | null) => ({
    ok: true, chave, nome: item?.nome ?? '', tipo: 'investidor', ficha: { cidade: 'Cidade Exemplo' }, resumo_para_consultor: 'resumo',
    sessao: { estagio: null, situacao: 'na_fila', toques: 0, aberta_em: null, ultimo_contato_em: null }, card: null,
  })),
}));

vi.mock('../services/io/helenaAgenda', () => ({
  lerAgendaDaHelena: vi.fn(async () => {
    if (h.falhaDaAgenda) throw new Error('leitura da agenda falhou 5511988880001');
    return { ocultos: ['101', '102'], marcadas: ['7'], gerado_em: '2026-11-12T15:00:00.000Z' };
  }),
}));

import { mountHelena } from '../routes/geradorHelena';

const r = Router();
mountHelena(r);
const app = express();
app.use('/gerador', r);

const THIAGO = 'Bearer tk-thiago';
const FORA = 'Bearer tk-fora';
const ESTRANHO = 'Bearer tk-estranho';
const M = (o: Record<string, unknown>) => ({
  id: 1, telefone: '5511988880001', is_group: false, from_me: false, from_api: null, chat_name: 'Maria Teste',
  sender_name: null, tipo: 'texto', texto: 'oi', media_url: null, momment: '2026-11-12T14:00:00Z', ...o,
});

let erroConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.ZAPI_INSTANCE_ID_IO = 'instancia-de-teste';
  delete process.env.CAIXA_EQUIPE;
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-fora': 'fulano@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com' };
  h.mensagens = [
    M({ id: 3, texto: 'digitado no celular', from_me: true, from_api: false, momment: '2026-11-12T14:05:00Z' }),
    M({ id: 2, texto: 'resposta da Helena', from_me: true, from_api: true, momment: '2026-11-12T14:01:00Z' }),
    M({ id: 1, momment: '2026-11-12T14:00:00Z' }),
    M({ id: 4, tipo: 'audio', texto: null, momment: '2026-11-12T14:06:00Z' }),
    M({ id: 5, tipo: 'reacao', texto: '👍', momment: '2026-11-12T14:07:00Z' }),
  ];
  h.lids = [];
  h.bancoFora = false; h.falhaDaLista = false; h.falhaDaAgenda = false; h.instancias = []; h.escritas = 0;
  erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { erroConsole.mockRestore(); });

describe('GET /gerador/helena/acompanhamento', () => {
  it('sem token: 401 e sem cache', async () => {
    const res = await request(app).get('/gerador/helena/acompanhamento');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('conta que não é de consultor: 403, sem dado', async () => {
    const res = await request(app).get('/gerador/helena/acompanhamento').set('Authorization', ESTRANHO);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('Maria');
  });
  it('consultor logado lê a lista (não exige a lista da equipe)', async () => {
    const res = await request(app).get('/gerador/helena/acompanhamento').set('Authorization', FORA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ligada: true });
    expect(res.body.itens[0].chave).toBe('1188880001');
  });
  it('falha de leitura: 502 genérico, sem telefone na resposta nem no console', async () => {
    h.falhaDaLista = true;
    const res = await request(app).get('/gerador/helena/acompanhamento').set('Authorization', THIAGO);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/5511/);
  });
});

describe('GET /gerador/helena/pessoa', () => {
  it('sem token: 401', async () => {
    const res = await request(app).get('/gerador/helena/pessoa?chave=1188880001');
    expect(res.status).toBe(401);
  });
  it('consultor fora da lista da equipe: 403 "equipe", sem tocar no banco', async () => {
    const res = await request(app).get('/gerador/helena/pessoa?chave=1188880001').set('Authorization', FORA);
    expect(res.status).toBe(403);
    expect(res.body.precisa).toBe('equipe');
    expect(JSON.stringify(res.body)).not.toMatch(/Maria|mensagens/);
    expect(h.instancias).toEqual([]);
  });
  it('chave inválida (ou LID): 400', async () => {
    for (const c of ['', 'abc', '123', 'lid:253068247589084', '11988880001']) {
      const res = await request(app).get('/gerador/helena/pessoa?chave=' + encodeURIComponent(c)).set('Authorization', THIAGO);
      expect(res.status).toBe(400);
    }
  });
  it('equipe lê a pessoa com a conversa em { de, texto, em }, em ordem, sem reação, só da instância da linha IO', async () => {
    const res = await request(app).get('/gerador/helena/pessoa?chave=1188880001').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, chave: '1188880001', nome: 'Maria Teste', ficha: { cidade: 'Cidade Exemplo' }, card: null });
    expect(res.body.mensagens).toEqual([
      { de: 'pessoa', texto: 'oi', em: '2026-11-12T14:00:00.000Z' },
      { de: 'helena', texto: 'resposta da Helena', em: '2026-11-12T14:01:00.000Z' },
      { de: 'equipe', texto: 'digitado no celular', em: '2026-11-12T14:05:00.000Z' },
      { de: 'pessoa', texto: '[audio]', em: '2026-11-12T14:06:00.000Z' },
    ]);
    expect(h.instancias).toEqual(['instancia-de-teste']);
    expect(h.escritas).toBe(0);
  });
  it('erro de banco: 502 genérico, sem telefone nem texto vazando', async () => {
    h.bancoFora = true;
    const res = await request(app).get('/gerador/helena/pessoa?chave=1188880001').set('Authorization', THIAGO);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/5511|tudo bem/);
    expect(erroConsole.mock.calls.flat().join(' ')).not.toMatch(/5511|tudo bem/);
  });
  it('sem a instância da linha IO: 502 (nunca "todas as linhas")', async () => {
    delete process.env.ZAPI_INSTANCE_ID_IO;
    const res = await request(app).get('/gerador/helena/pessoa?chave=1188880001').set('Authorization', THIAGO);
    expect(res.status).toBe(502);
  });
});

describe('GET /gerador/helena/agenda', () => {
  it('sem login, como a /gerador/apalavrado: devolve ocultos, marcadas e gerado_em, sem cache', async () => {
    const res = await request(app).get('/gerador/helena/agenda');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ocultos: ['101', '102'], marcadas: ['7'], gerado_em: '2026-11-12T15:00:00.000Z' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('falha na leitura: 503 sem telefone nem detalhe do erro, e a tela segue sem esconder', async () => {
    h.falhaDaAgenda = true;
    const res = await request(app).get('/gerador/helena/agenda');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('5511988880001');
    expect(res.body.ocultos).toBeUndefined();
  });
  it('nao escreve nada no banco', async () => {
    await request(app).get('/gerador/helena/agenda');
    expect(h.escritas).toBe(0);
  });
});
