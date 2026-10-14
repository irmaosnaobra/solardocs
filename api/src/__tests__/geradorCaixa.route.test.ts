import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Rotas da caixa (fase 1, só leitura), com login e banco simulados. Dados
// inventados. Prova: as duas travas (consultor e lista da equipe), que o filtro
// de instância vai ao banco, que o LID entra na conversa, que erro de banco é 502
// (nunca lista vazia), que nada é gravado e que o erro não vaza telefone nem texto.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  mensagens: [] as Array<Record<string, unknown>>,
  lids: [] as Array<Record<string, unknown>>,
  pausas: [] as Array<Record<string, unknown>>,
  estado: null as null | { value: unknown; updated_at: string },
  bancoFora: false,
  escritas: 0,
  filtros: [] as string[],
  instancias: [] as string[],
}));

function consulta(tabela: string) {
  const q: any = {
    _eq: {} as Record<string, unknown>, _gt: null as number | null,
    select: () => q,
    eq: (c: string, v: unknown) => { q._eq[c] = v; h.filtros.push(`${tabela}.${c}`); if (tabela === 'wa_mensagens' && c === 'instancia') h.instancias.push(String(v)); return q; },
    in: () => q, is: () => q, gte: () => q, lt: () => q, or: () => q, order: () => q,
    gt: (_c: string, v: number) => { q._gt = v; return q; },
    insert: () => { h.escritas++; return q; }, update: () => { h.escritas++; return q; },
    upsert: () => { h.escritas++; return q; }, delete: () => { h.escritas++; return q; },
    limit: () => q, range: () => q,
    maybeSingle: () => q,
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (h.bancoFora) return Promise.resolve({ data: null, error: { code: '08006', message: 'falha 5511988880001 oi tudo bem' } }).then(ok, ko);
      let data: unknown = [];
      if (tabela === 'wa_mensagens') {
        data = h.mensagens.filter((m) => (q._gt === null || (m.id as number) > q._gt));
      } else if (tabela === 'wa_lid_telefone') data = h.lids;
      else if (tabela === 'atendimento_pausa') data = h.pausas;
      else if (tabela === 'system_state') data = h.estado;
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

import { mountCaixa, limparCachesCaixa } from '../routes/geradorCaixa';

const r = Router();
mountCaixa(r);
const app = express();
app.use('/gerador', r);

const THIAGO = 'Bearer tk-thiago';
const FORA = 'Bearer tk-fora';
const ESTRANHO = 'Bearer tk-estranho';
const M = (o: Record<string, unknown>) => ({
  id: 1, telefone: '5511988880001', is_group: false, from_me: false, from_api: null, chat_name: 'Maria Teste',
  sender_name: null, tipo: 'texto', texto: 'oi', media_url: null, momment: '2026-10-13T14:00:00Z', ...o,
});

let erroConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.ZAPI_INSTANCE_ID_IO = 'instancia-de-teste';
  delete process.env.CAIXA_EQUIPE;
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-fora': 'fulano@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com' };
  h.mensagens = [
    M({ id: 1 }),
    M({ id: 2, from_me: true, from_api: true, chat_name: 'Maria Teste', texto: 'resposta do robo' }),
    M({ id: 3, telefone: '253068247589084', from_me: true, from_api: false, texto: 'digitado no celular' }),
    M({ id: 4, texto: 'e agora?' }),
  ];
  h.lids = [{ lid: '253068247589084', telefone: '5511988880001', chave: '1188880001' }];
  h.pausas = [];
  h.estado = { value: { downStreak: 0, ultimaConexao: new Date().toISOString() }, updated_at: new Date().toISOString() };
  h.bancoFora = false; h.escritas = 0; h.filtros = []; h.instancias = [];
  limparCachesCaixa();
  erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { erroConsole.mockRestore(); });

describe('travas de acesso', () => {
  it('sem token: 401, e a resposta já sai sem cache', async () => {
    const res = await request(app).get('/gerador/caixa/conversas');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('conta que não é de consultor: 403 do login, sem dado', async () => {
    const res = await request(app).get('/gerador/caixa/conversas').set('Authorization', ESTRANHO);
    expect(res.status).toBe(403);
    expect(res.body.precisa).toBe('login');
  });
  it('consultor fora da lista da equipe: 403 com marcador próprio e nenhum dado', async () => {
    for (const rota of ['conversas', 'conversa?chave=1188880001', 'novas?desde=0', 'estado']) {
      const res = await request(app).get('/gerador/caixa/' + rota).set('Authorization', FORA);
      expect(res.status).toBe(403);
      expect(res.body.precisa).toBe('equipe');
      expect(JSON.stringify(res.body)).not.toMatch(/Maria|conversas|mensagens/);
    }
    expect(h.filtros).toEqual([]);   // nem chegou a tocar no banco
  });
  it('CAIXA_EQUIPE troca a lista', async () => {
    process.env.CAIXA_EQUIPE = 'fulano';
    expect((await request(app).get('/gerador/caixa/estado').set('Authorization', FORA)).status).toBe(200);
    expect((await request(app).get('/gerador/caixa/estado').set('Authorization', THIAGO)).status).toBe(403);
  });
});

describe('rotas', () => {
  it('conversas: junta telefone e LID, conta não respondidas e filtra pela instância', async () => {
    const res = await request(app).get('/gerador/caixa/conversas?dias=3').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.ok).toBe(true);
    expect(res.body.truncado).toBe(false);
    expect(res.body.cursor).toBe(4);
    expect(res.body.conversas).toHaveLength(1);
    expect(res.body.conversas[0]).toMatchObject({ chave: '1188880001', nome: 'Maria Teste', nao_respondidas: 1 });
    expect(h.filtros).toContain('wa_mensagens.instancia');
    expect(h.filtros).toContain('wa_mensagens.is_group');
  });

  it('conversa: ordem cronológica, autor de cada uma e o contato', async () => {
    const res = await request(app).get('/gerador/caixa/conversa?chave=1188880001').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.mensagens.map((m: any) => m.autor)).toEqual(expect.arrayContaining(['lead', 'robo', 'equipe']));
    expect(res.body.contato.nome).toBe('Maria Teste');
    expect(res.body.tem_mais).toBe(false);
  });

  it('conversa com chave inválida: 400', async () => {
    const res = await request(app).get('/gerador/caixa/conversa?chave=abc').set('Authorization', THIAGO);
    expect(res.status).toBe(400);
  });

  it('novas: sem cursor devolve o ponto de partida; com cursor devolve só o que passou dele (com a sobreposição)', async () => {
    h.mensagens = Array.from({ length: 40 }, (_, i) => M({ id: i + 1 }));
    const semCursor = await request(app).get('/gerador/caixa/novas').set('Authorization', THIAGO);
    expect(semCursor.body.mensagens).toEqual([]);
    const res = await request(app).get('/gerador/caixa/novas?desde=38').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    // Recua 25 ids: 13 em diante. A tela tira a repetida por id.
    expect(res.body.mensagens.map((m: any) => m.id)[0]).toBe(14);
    expect(res.body.mensagens.every((m: any) => m.chave === '1188880001')).toBe(true);
    expect(res.body.cursor).toBe(40);
  });

  it('estado: devolve a linha e quem está logado', async () => {
    const res = await request(app).get('/gerador/caixa/estado').set('Authorization', THIAGO);
    expect(res.body.linha.estado).toBe('conectada');
    expect(res.body.usuario.nome).toBe('thiago');
  });
});

describe('falhas e escritas', () => {
  it('erro de banco: 502 genérico, nunca lista vazia, sem vazar telefone nem texto', async () => {
    h.bancoFora = true;
    for (const rota of ['conversas', 'conversa?chave=1188880001', 'novas?desde=5', 'estado']) {
      const res = await request(app).get('/gerador/caixa/' + rota).set('Authorization', THIAGO);
      expect(res.status).toBe(502);
      expect(res.body.ok).toBe(false);
      expect(res.body.conversas).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/5511988880001|oi tudo bem|falha/);
    }
    const logado = erroConsole.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(logado).not.toMatch(/5511988880001|oi tudo bem|falha/);
  });

  it('sem a variável da instância: 502 genérico para o navegador, motivo exato no console do servidor, nenhuma leitura', async () => {
    delete process.env.ZAPI_INSTANCE_ID_IO;
    for (const rota of ['conversas', 'conversa?chave=1188880001', 'novas?desde=1']) {
      erroConsole.mockClear();
      const res = await request(app).get('/gerador/caixa/' + rota).set('Authorization', THIAGO);
      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).not.toMatch(/ZAPI|instancia|variável/i);
      expect(erroConsole.mock.calls.map((c: unknown[]) => c.join(' ')).join(' | ')).toMatch(/ZAPI_INSTANCE_ID_IO não está definida/);
    }
    expect(h.filtros).toEqual([]);
  });

  it('com a variável definida, toda leitura de mensagens filtra pela instância da linha IO (nenhuma lê outra linha)', async () => {
    await request(app).get('/gerador/caixa/conversas').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/conversa?chave=1188880001').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/conversa?chave=lid:253068247589084').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/novas?desde=1').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/novas').set('Authorization', THIAGO);
    expect(h.instancias.length).toBeGreaterThanOrEqual(5);
    expect(new Set(h.instancias)).toEqual(new Set(['instancia-de-teste']));
  });

  it('nenhuma rota escreve no banco', async () => {
    await request(app).get('/gerador/caixa/conversas').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/conversa?chave=1188880001').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/novas?desde=1').set('Authorization', THIAGO);
    await request(app).get('/gerador/caixa/estado').set('Authorization', THIAGO);
    expect(h.escritas).toBe(0);
    for (const m of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await (request(app) as any)[m]('/gerador/caixa/conversas').set('Authorization', THIAGO);
      expect(res.status).toBe(404);
    }
  });
});
