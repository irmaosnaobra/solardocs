import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Coluna Base do CRM (B4a): a rota GET /gerador/base-5040 com o banco, o login e a leitura da conversa simulados
// (dados inventados). Prova: login, produto, cada etapa, card agendado fora, cancelado/nao_atendeu dentro com cardId,
// produto errado não conta, paginação das posses e que nada é escrito.

type Linha = Record<string, any>;
const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  posses: [] as Array<{ phone: string; lead_data: any }>,
  cards: [] as Array<Record<string, any>>,
  conversas: new Map<string, { msgs: any[]; completa: boolean }>(),
  escritas: 0,
  erroPosses: false,
  paginasPedidas: [] as number[],
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agentes5040/contexto', () => ({
  lerConversa: vi.fn(async (chave: string) => h.conversas.get(chave) ?? { msgs: [], completa: true }),
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'whatsapp_sessions') throw new Error(`tabela inesperada: ${tabela}`);
      const filtros: Array<[string, string]> = [];
      const q: any = {
        select: () => q,
        eq: (col: string, v: string) => { filtros.push([col, v]); return q; },
        order: () => q,
        range: async (de: number, ate: number) => {
          h.paginasPedidas.push(de);
          if (h.erroPosses) return { data: null, error: { code: 'XX000', message: 'TELEFONE-NO-ERRO' } };
          const todas = h.posses
            .filter(p => filtros.every(([c, v]) => {
              if (c === 'tipo') return v === 'ag5040';
              if (c === 'lead_data->>dona') return p.lead_data.dona === v;
              if (c === 'lead_data->>estado') return p.lead_data.estado === v;
              return false;
            }))
            .sort((a, b) => a.phone.localeCompare(b.phone));
          return { data: todas.slice(de, ate + 1), error: null };
        },
        insert: () => { h.escritas++; return q; }, update: () => { h.escritas++; return q; },
        upsert: () => { h.escritas++; return q; }, delete: () => { h.escritas++; return q; },
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
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada: ${tabela}`);
      let caudas: string[] = [];
      const q: any = {
        select: () => q,
        or: (filtro: string) => { caudas = filtro.split(',').map(f => f.replace('cliente_telefone.ilike.*', '')); return q; },
        order: () => q,
        range: async (de: number, ate: number) => {
          const ok = h.cards.filter(c => caudas.some(t => String(c.cliente_telefone ?? '').replace(/\D/g, '').endsWith(t)));
          return { data: ok.slice(de, ate + 1), error: null };
        },
        insert: () => { h.escritas++; return q; }, update: () => { h.escritas++; return q; },
        upsert: () => { h.escritas++; return q; }, delete: () => { h.escritas++; return q; },
      };
      return q;
    },
  },
}));

import { mountBase5040 } from '../routes/geradorBase5040';
import { limitesBase } from '../services/agentes5040/base';

const r = Router();
mountBase5040(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const AGORA = Date.parse('2026-10-21T15:00:00.000Z');
const H = (horasAtras: number) => new Date(AGORA - horasAtras * 3600_000).toISOString();
const F = (horas: number) => new Date(AGORA + horas * 3600_000).toISOString();

// Chaves de 10 dígitos (DDD + 8); o telefone completo do card/da conversa leva 55 e o nono dígito.
const CH = (n: number) => `3499${String(900000 + n).padStart(6, '0')}`.slice(0, 10);
const posse = (n: number, extra: Linha = {}, dona = 'duda') => ({
  phone: CH(n),
  lead_data: { dona, estado: 'viva', desde: H(10), ate_wa_id: 1, respostas: 0, imagens: [], links: [], ...extra },
});
const msg = (id: number, from_me: boolean, momment: string): Linha => ({ id, from_me, from_api: from_me, autor: from_me ? 'robo' : 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment });
const conversa = (n: number, msgs: any[], completa = true) => h.conversas.set(CH(n), { msgs, completa });
const fone = (n: number) => { const t = CH(n).slice(2); return `(34) 9${t.slice(0, 4)}-${t.slice(4)}`; };
const card = (n: number, status: string | null, extra: Linha = {}) => ({
  id: 1000 + n, status, quando: H(5), created_by: 'solar', cliente_nome: `Cliente ${n}`, cidade: 'Uberlandia',
  cliente_telefone: fone(n), ...extra,
});

const get = (q = '?produto=solar', auth: string | null = NILCE) => {
  const rq = request(app).get(`/gerador/base-5040${q}`);
  return auth ? rq.set('Authorization', auth) : rq;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  h.usuarios = { 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com' };
  h.posses = []; h.cards = []; h.conversas = new Map(); h.escritas = 0; h.erroPosses = false; h.paginasPedidas = [];
  limitesBase.pagina = 1000; limitesBase.maxPaginas = 5;
});

describe('login e produto', () => {
  it('401 sem token ou inválido, 403 conta de fora, 400 produto errado, sem cache', async () => {
    expect((await get('?produto=solar', null)).status).toBe(401);
    expect((await get('?produto=solar', 'Bearer lixo')).status).toBe(401);
    expect((await get('?produto=solar', 'Bearer tk-estranho')).status).toBe(403);
    expect((await get('?produto=solardoc')).status).toBe(400);
    expect((await get('')).status).toBe(400);
    const ok = await get('?produto=solar');
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body).toEqual({ ok: true, produto: 'solar', itens: [] });
  });
});

describe('etapas', () => {
  it('chegou, em_conversa, sem_resposta e estacionado; só a Duda no solar', async () => {
    h.posses = [
      posse(1),                                                       // nada nosso depois do desde -> chegou
      posse(2),                                                       // o lead falou por último -> em_conversa
      posse(3),                                                       // nossa há 4 h, lead calado -> sem_resposta
      posse(4),                                                       // nossa há 1 h -> em_conversa (ainda cedo)
      posse(5, { base: { estacionado_ate: F(48), motivo: 'agora_nao' } }), // estacionado
      posse(6, { base: { estacionado_ate: H(2) } }),                  // data passada -> regra normal
      posse(7, {}, 'helena'),                                         // dona do outro produto: fora
      { phone: CH(8), lead_data: { dona: 'duda', estado: 'encerrada', desde: H(10), respostas: 0, imagens: [], links: [] } }, // não viva
    ];
    conversa(1, [msg(1, false, H(9))]);
    conversa(2, [msg(1, false, H(9)), msg(2, true, H(8)), msg(3, false, H(0.5))]);
    conversa(3, [msg(1, false, H(9)), msg(2, true, H(4))]);
    conversa(4, [msg(1, false, H(9)), msg(2, true, H(1))]);
    conversa(5, [msg(1, false, H(9)), msg(2, true, H(8))]);
    conversa(6, [msg(1, false, H(9)), msg(2, true, H(5))]);

    const res = await get('?produto=solar');
    expect(res.status).toBe(200);
    const por = Object.fromEntries(res.body.itens.map((i: Linha) => [i.telefone.slice(-8), i]));
    const de = (n: number) => por[CH(n).slice(-8)];
    expect(de(1).etapa).toBe('chegou');
    expect(de(2).etapa).toBe('em_conversa');
    expect(de(3).etapa).toBe('sem_resposta');
    expect(de(4).etapa).toBe('em_conversa');
    expect(de(5).etapa).toBe('estacionado');
    expect(de(5).volta_em).toBe(F(48));
    expect(de(6).etapa).toBe('sem_resposta');
    expect(de(6).volta_em).toBeNull();
    expect(res.body.itens).toHaveLength(6);
    expect(de(3)).toMatchObject({ cardId: null, dona: 'duda', desde: H(10), ultima_fala_em: H(4) });
    expect(h.escritas).toBe(0);
  });

  it('mensagem nossa ANTES do desde da posse não conta: continua chegou', async () => {
    h.posses = [posse(1)];
    conversa(1, [msg(1, true, H(30)), msg(2, false, H(9))]);
    expect((await get()).body.itens[0].etapa).toBe('chegou');
  });

  it('equipe digitando no celular (from_me sem from_api) conta como resposta nossa', async () => {
    h.posses = [posse(1)];
    conversa(1, [msg(1, false, H(9)), { ...msg(2, true, H(6)), from_api: false, autor: 'equipe' }]);
    expect((await get()).body.itens[0].etapa).toBe('sem_resposta');
  });

  it('conversa lida pela metade não afirma chegou nem sem_resposta: cai em em_conversa', async () => {
    h.posses = [posse(1)];
    conversa(1, [], false);
    const i = (await get()).body.itens[0];
    expect(i.etapa).toBe('em_conversa');
    expect(i.ultima_fala_em).toBeNull();
  });

  it('a Helena lê o eletroposto', async () => {
    h.posses = [posse(1, {}, 'helena'), posse(2, {}, 'duda')];
    const res = await get('?produto=eletroposto');
    expect(res.body.itens).toHaveLength(1);
    expect(res.body.itens[0].dona).toBe('helena');
  });
});

describe('cruzamento com o card do produto', () => {
  it('card agendado (ou qualquer status vivo) tira da Base; cancelado e nao_atendeu entram com o cardId', async () => {
    h.posses = [posse(1), posse(2), posse(3), posse(4)];
    h.cards = [card(1, 'agendado'), card(2, 'cancelado'), card(3, 'nao_atendeu'), card(4, 'fechou')];
    const { lerConversa } = await import('../services/agentes5040/contexto');
    (lerConversa as unknown as ReturnType<typeof vi.fn>).mockClear();
    const res = await get();
    const ids = res.body.itens.map((i: Linha) => i.cardId).sort();
    expect(ids).toEqual([1002, 1003]);
    const c2 = res.body.itens.find((i: Linha) => i.cardId === 1002);
    expect(c2).toMatchObject({ nome: 'Cliente 2', cidade: 'Uberlandia', etapa: 'chegou' });
    // Quem tem card agendado nem tem a conversa lida.
    const lidas = (lerConversa as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(lidas).not.toContain(CH(1));
    expect(lidas).not.toContain(CH(4));
  });

  it('vale o card mais novo do produto: agendado futuro tira da Base, cancelado mais novo que um agendado velho deixa', async () => {
    h.posses = [posse(1), posse(2)];
    h.cards = [
      card(1, 'cancelado', { id: 11, quando: H(50) }), card(1, 'agendado', { id: 12, quando: F(24) }),   // agendado futuro é o mais novo
      card(2, 'agendado', { id: 21, quando: H(50) }), card(2, 'cancelado', { id: 22, quando: H(1) }),    // cancelado é o mais novo
    ];
    const res = await get();
    expect(res.body.itens.map((i: Linha) => i.cardId)).toEqual([22]);
  });

  it('card do OUTRO produto não conta: solar com card de eletroposto agendado segue na Base sem cardId', async () => {
    h.posses = [posse(1)];
    h.cards = [card(1, 'agendado', { created_by: 'eletroposto_lp' })];
    const res = await get('?produto=solar');
    expect(res.body.itens).toHaveLength(1);
    expect(res.body.itens[0].cardId).toBeNull();
  });

  it('telefone de card com o mesmo final e DDD diferente não cruza', async () => {
    h.posses = [posse(1)];
    h.cards = [{ ...card(1, 'agendado'), cliente_telefone: fone(1).replace('(34)', '(11)') }];
    const res = await get();
    expect(res.body.itens).toHaveLength(1);
    expect(res.body.itens[0].cardId).toBeNull();
  });

  it('sem card: o telefone sai da chave, com 55 e o nono dígito', async () => {
    h.posses = [posse(1)];
    const t = (await get()).body.itens[0].telefone as string;
    expect(t).toMatch(/^55349\d{8}$/);
    expect(t.slice(-8)).toBe(CH(1).slice(-8));
  });
});

describe('paginação e erro', () => {
  it('lê a 2ª página das posses e avisa quando passa do teto', async () => {
    limitesBase.pagina = 2; limitesBase.maxPaginas = 2;
    h.posses = [posse(1), posse(2), posse(3), posse(4), posse(5)];
    const res = await get();
    expect(res.status).toBe(200);
    expect(h.paginasPedidas).toEqual([0, 2]);
    expect(res.body.itens).toHaveLength(4);
    expect(res.body.cortou).toBe(true);
  });

  it('com páginas de sobra lê tudo e não avisa corte', async () => {
    limitesBase.pagina = 2; limitesBase.maxPaginas = 5;
    h.posses = [posse(1), posse(2), posse(3), posse(4), posse(5)];
    const res = await get();
    expect(res.body.itens).toHaveLength(5);
    expect(res.body.cortou).toBeUndefined();
  });

  it('erro do banco vira 500 genérico, sem o texto do driver', async () => {
    h.erroPosses = true;
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('TELEFONE-NO-ERRO');
  });
});
