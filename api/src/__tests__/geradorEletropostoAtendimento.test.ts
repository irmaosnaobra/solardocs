import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// GET /gerador/eletroposto/atendimento: login de consultor, mapeamento das sessões
// da Helena e erro de leitura subindo (nunca lista vazia no lugar do erro).

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  linhas: [] as unknown[],
  bancoFora: false,
  selecionado: '' as string,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'system_state') throw new Error(`tabela inesperada: ${t}`);
      const q: any = {
        select: (cols: string) => { h.selecionado = cols; return q; },
        like: () => q, order: () => q,
        range: (de: number, ate: number) => {
          if (h.bancoFora) return Promise.resolve({ data: null, error: { message: 'connection refused' } });
          return Promise.resolve({ data: h.linhas.slice(de, ate + 1), error: null });
        },
      };
      return q;
    },
  },
}));
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

import { mountEletropostoAtendimento } from '../routes/geradorEletropostoAtendimento';
import { lerAtendimentos, mapearSessao } from '../services/io/investidorAtendimento';

const r = Router();
mountEletropostoAtendimento(r);
const app = express();
app.use('/gerador', r);

beforeEach(() => {
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com' };
  h.bancoFora = false;
  h.selecionado = '';
  h.linhas = [
    { key: 'inv_agente:3499111222', updated_at: '2026-10-12T11:15:00Z',
      value: { estagio: 'conversando', consultor: 'Diego', aberto_em: '2026-10-12T10:00:00Z', agendamento_id: null, motivo: null, resumo: 'x'.repeat(500), erro: null, telefone: '5534991112222' } },
    { key: 'inv_agente:1199998888', updated_at: '2026-10-12T09:00:00Z',
      value: { estagio: 'chamado', consultor: 'Giovanna', aberto_em: '2026-10-12T09:00:00Z', erro: 'Z-API 500', resumo: '' } },
    { key: 'inv_agente:3188887777', updated_at: '2026-10-11T09:00:00Z',
      value: { estagio: 'agendado', consultor: 'Diego', agendamento_id: 1234, resumo: 'ok' } },
    { key: 'inv_agente:0000000000', updated_at: '2026-10-11T09:00:00Z', value: 'isto não é json {' },
  ];
});

const pedir = (auth?: string) => {
  const q = request(app).get('/gerador/eletroposto/atendimento');
  return auth ? q.set('Authorization', auth) : q;
};

describe('GET /gerador/eletroposto/atendimento', () => {
  it('recusa sem Authorization', async () => {
    const res = await pedir();
    expect(res.status).toBe(401);
  });

  it('recusa a chave publishable', async () => {
    const res = await pedir('Bearer sb_publishable_abc123');
    expect(res.status).toBe(401);
  });

  it('recusa conta que não é de consultor', async () => {
    const res = await pedir('Bearer tk-estranho');
    expect(res.status).toBe(403);
  });

  it('com consultor logado devolve ok, gerado_em e os itens, sem telefone', async () => {
    const res = await pedir('Bearer tk-nilce');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Number.isFinite(Date.parse(res.body.gerado_em))).toBe(true);
    expect(res.body.itens).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toContain('5534991112222');
    expect(h.selecionado).toContain('updated_at');
  });

  it('erro de leitura vira 500 com ok:false, sem vazar o detalhe do banco', async () => {
    h.bancoFora = true;
    const res = await pedir('Bearer tk-nilce');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});

describe('lerAtendimentos', () => {
  it('mapeia a sessão normal: chave, estágio, consultor, movimento e resumo cortado em 300', async () => {
    const itens = await lerAtendimentos();
    const a = itens.find((i) => i.chave === '3499111222')!;
    expect(a).toMatchObject({
      estagio: 'conversando', consultor: 'Diego', aberto_em: '2026-10-12T10:00:00Z',
      movimento_em: '2026-10-12T11:15:00Z', agendamento_id: null, erro_envio: false,
    });
    expect(a.resumo).toHaveLength(300);
    expect(Object.keys(a).sort()).toEqual([
      'aberto_em', 'agendamento_id', 'chave', 'consultor', 'erro_envio', 'estagio', 'motivo', 'movimento_em', 'resumo',
    ].sort());
  });

  it('sessão com erro de envio marca erro_envio', async () => {
    const b = (await lerAtendimentos()).find((i) => i.chave === '1199998888')!;
    expect(b.erro_envio).toBe(true);
    expect(b.estagio).toBe('chamado');
  });

  it('guarda o agendamento_id', async () => {
    const c = (await lerAtendimentos()).find((i) => i.chave === '3188887777')!;
    expect(c.agendamento_id).toBe(1234);
  });

  it('valor que não é JSON é pulado', async () => {
    const itens = await lerAtendimentos();
    expect(itens.map((i) => i.chave)).not.toContain('0000000000');
    expect(itens).toHaveLength(3);
  });

  it('valor texto com JSON dentro ainda vale; array e nulo são pulados', () => {
    expect(mapearSessao({ key: 'inv_agente:1', value: '{"estagio":"humano","consultor":"Diego"}' })?.estagio).toBe('humano');
    expect(mapearSessao({ key: 'inv_agente:1', value: [] })).toBeNull();
    expect(mapearSessao({ key: 'inv_agente:1', value: null })).toBeNull();
  });

  it('o erro de leitura SOBE', async () => {
    h.bancoFora = true;
    await expect(lerAtendimentos()).rejects.toThrow(/atendimento dos investidores/);
  });

  it('pagina: mais de 1000 linhas voltam inteiras', async () => {
    h.linhas = Array.from({ length: 2300 }, (_, i) => ({ key: `inv_agente:${String(i).padStart(10, '0')}`, updated_at: null, value: { estagio: 'chamado' } }));
    expect(await lerAtendimentos()).toHaveLength(2300);
  });
});
