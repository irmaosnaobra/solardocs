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
  selecionados: [] as string[],
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'system_state') throw new Error(`tabela inesperada: ${t}`);
      let prefixo = '';
      const q: any = {
        select: (cols: string) => { h.selecionado = cols; h.selecionados.push(cols); return q; },
        like: (_col: string, padrao: string) => { prefixo = padrao.replace(/%$/, ''); return q; },
        order: () => q,
        range: (de: number, ate: number) => {
          if (h.bancoFora) return Promise.resolve({ data: null, error: { message: 'connection refused' } });
          // O padrão do like vale: sessão da Helena e etiqueta de card são leituras diferentes.
          const doPrefixo = (h.linhas as { key: string }[]).filter((l) => l.key.startsWith(prefixo));
          return Promise.resolve({ data: doPrefixo.slice(de, ate + 1), error: null });
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
import { lerAtendimentos, lerEtiquetasDosCards, mapearEtiquetas, mapearSessao } from '../services/io/investidorAtendimento';

const r = Router();
mountEletropostoAtendimento(r);
const app = express();
app.use('/gerador', r);

beforeEach(() => {
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com' };
  h.bancoFora = false;
  h.selecionado = '';
  h.selecionados = [];
  h.linhas = [
    { key: 'inv_agente:3499111222', updated_at: '2026-10-12T11:15:00Z',
      value: { estagio: 'conversando', consultor: 'Diego', aberto_em: '2026-10-12T10:00:00Z', agendamento_id: null, motivo: null, resumo: 'x'.repeat(500), erro: null, telefone: '5534991112222' } },
    { key: 'inv_agente:1199998888', updated_at: '2026-10-12T09:00:00Z',
      value: { estagio: 'chamado', consultor: 'Giovanna', aberto_em: '2026-10-12T09:00:00Z', erro: 'Z-API 500', resumo: '' } },
    { key: 'inv_agente:3188887777', updated_at: '2026-10-11T09:00:00Z',
      value: { estagio: 'agendado', consultor: 'Diego', agendamento_id: 1234, resumo: 'ok' } },
    { key: 'inv_agente:0000000000', updated_at: '2026-10-11T09:00:00Z', value: 'isto não é json {' },
    // Etiquetas de negócio dos cards: objeto, texto JSON, lixo e etiqueta vazia.
    { key: 'etiqueta_card:101', value: { etiqueta: 'arrendamento', em: '2026-10-13T10:00:00Z', por: 'lp' } },
    { key: 'etiqueta_card:102', value: '{"etiqueta":"cotista"}' },
    { key: 'etiqueta_card:103', value: 'isto não é json {' },
    { key: 'etiqueta_card:104', value: { etiqueta: '   ' } },
    { key: 'etiqueta_card:105', value: ['integrador'] },
    // Tipo com que o card nasceu: sobrevive à etiqueta (a agenda apaga a etiqueta, o tipo fica).
    { key: 'tipo_card:101', value: { tipo: 'arrendamento', em: '2026-10-13T10:00:00Z', por: 'lp' } },
    { key: 'tipo_card:201', value: { tipo: 'cotista', em: '2026-10-13T10:00:00Z', por: 'helena' } },
    { key: 'tipo_card:202', value: '{"tipo":"integrador"}' },
    { key: 'tipo_card:203', value: 'isto não é json {' },
    { key: 'tipo_card:204', value: { tipo: '  ' } },
    { key: 'tipo_card:205', value: ['cotista'] },
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
    expect(h.selecionados.some((c) => c.includes('updated_at'))).toBe(true);
  });

  it('devolve também as etiquetas de negócio dos cards, por id, e o resto da resposta não muda', async () => {
    const res = await pedir('Bearer tk-nilce');
    expect(res.status).toBe(200);
    expect(res.body.etiquetas).toEqual({ '101': 'arrendamento', '102': 'cotista' });
    expect(Object.keys(res.body).sort()).toEqual(['etiquetas', 'gerado_em', 'itens', 'ok', 'tipos']);
    // as etiquetas não vazam para a lista de sessões, nem o contrário
    expect(res.body.itens).toHaveLength(3);
  });

  it('devolve os tipos dos cards por id (texto JSON vale; lixo, vazio e array não), separados das etiquetas', async () => {
    const res = await pedir('Bearer tk-nilce');
    expect(res.body.tipos).toEqual({ '101': 'arrendamento', '201': 'cotista', '202': 'integrador' });
    // card 201 só tem tipo: a etiqueta guardada some sem levar o tipo junto
    expect(res.body.etiquetas['201']).toBeUndefined();
  });

  it('sem nenhum tipo guardado, tipos vem como objeto vazio', async () => {
    h.linhas = h.linhas.filter((l) => !(l as { key: string }).key.startsWith('tipo_card:'));
    const res = await pedir('Bearer tk-nilce');
    expect(res.status).toBe(200);
    expect(res.body.tipos).toEqual({});
  });

  it('erro de leitura dos tipos SOBE como 500 (nunca lista vazia no lugar do erro)', async () => {
    const { lerTiposDosCards } = await import('../services/io/investidorAtendimento');
    h.bancoFora = true;
    await expect(lerTiposDosCards()).rejects.toThrow(/tipos dos cards/);
  });

  it('sem nenhuma etiqueta guardada, etiquetas vem como objeto vazio', async () => {
    h.linhas = h.linhas.filter((l) => !(l as { key: string }).key.startsWith('etiqueta_card:'));
    const res = await pedir('Bearer tk-nilce');
    expect(res.status).toBe(200);
    expect(res.body.etiquetas).toEqual({});
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
    expect(a.grupo).toBeNull();
    expect(Object.keys(a).sort()).toEqual([
      'aberto_em', 'agendamento_id', 'chave', 'consultor', 'erro_envio', 'estagio', 'grupo', 'motivo', 'movimento_em', 'resumo', 'toques',
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

describe('lerEtiquetasDosCards', () => {
  it('lê só as chaves etiqueta_card: e mapeia id -> etiqueta (texto JSON vale; lixo, vazio e array não)', async () => {
    expect(await lerEtiquetasDosCards()).toEqual({ '101': 'arrendamento', '102': 'cotista' });
  });

  it('pagina: mais de 1000 etiquetas voltam inteiras', async () => {
    h.linhas = Array.from({ length: 2300 }, (_, i) => ({ key: `etiqueta_card:${i + 1}`, value: { etiqueta: 'cotista' } }));
    expect(Object.keys(await lerEtiquetasDosCards())).toHaveLength(2300);
  });

  it('o erro de leitura SOBE', async () => {
    h.bancoFora = true;
    await expect(lerEtiquetasDosCards()).rejects.toThrow(/etiquetas dos cards/);
  });

  it('mapearEtiquetas ignora chave de outro prefixo e id vazio', () => {
    expect(mapearEtiquetas([
      { key: 'inv_agente:1', value: { etiqueta: 'x' } },
      { key: 'etiqueta_card:', value: { etiqueta: 'x' } },
      { key: 'etiqueta_card:7', value: { etiqueta: ' integrador ' } },
    ])).toEqual({ '7': 'integrador' });
  });
});
