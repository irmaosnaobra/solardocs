import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// GET /gerador/dashboard e /gerador/dashboard/negocio, com login, banco, planilha
// e painel simulados. O que se prova: o papel vem do token, consultor comum só
// vê o que é dele e NUNCA uma chave de dinheiro, o cache guarda dado e não
// resposta, e cada fonte que cai (planilha, Meta, pós-venda) deixa a rota de pé.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  cards: [] as Array<Record<string, unknown>>,
  propostas: [] as Array<Record<string, unknown>>,
  leads: [] as Array<Record<string, unknown>>,
  estado: new Map<string, unknown>(),
  leituras: 0,
  bancoFora: false,
  posVendaFora: false,
  planilhaFora: false,
  metaFora: false,
  painelLento: false,
  chamadasPainel: 0,
  leiturasEstado: 0,
}));

/** Query builder falso: ignora filtros (de propósito: o JS tem que filtrar de verdade) e respeita o range. */
function consulta(linhas: () => unknown[]) {
  const q: any = {
    select: () => q, gte: () => q, like: () => q, order: () => q,
    range: (de: number, ate: number) => {
      h.leituras++;
      if (h.bancoFora) return Promise.resolve({ data: null, error: { message: 'connection refused postgres://user:segredo@db' } });
      return Promise.resolve({ data: linhas().slice(de, ate + 1), error: null });
    },
  };
  return q;
}

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'system_state') throw new Error(`tabela inesperada: ${t}`);
      return {
        select: () => ({
          in: async (_c: string, chaves: string[]) => {
            h.leiturasEstado++;
            if (h.posVendaFora) return { data: null, error: { message: 'boom' } };
            return { data: chaves.filter((k) => h.estado.has(k)).map((k) => ({ key: k, value: h.estado.get(k) })), error: null };
          },
        }),
      };
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
    from: (t: string) => {
      if (t === 'agendamentos') return consulta(() => h.cards);
      if (t === 'propostas') return consulta(() => h.propostas);
      if (t === 'leads_meta') return consulta(() => h.leads);
      throw new Error(`tabela inesperada: ${t}`);
    },
  },
}));
vi.mock('../services/io/painelQuizSolar', async (orig) => {
  const real = await orig<typeof import('../services/io/painelQuizSolar')>();
  return {
    ...real,
    lerPainelQuizSolar: vi.fn(async () => {
      h.chamadasPainel++;
      if (h.painelLento) return new Promise(() => { /* nunca resolve */ });
      return {
        periodo: '30dias', desde: '', ate: null,
        resultado: { agendados: 15, orcamentos: 0, vendidos: 0, semInteresse: 0, naoAtendeu: 0, emAberto: 15 },
        porAnuncio: [{ id: 'a', gasto: 900 }, { id: 'b', gasto: 60 }],
        meta_ok: !h.metaFora, meta_motivo: h.metaFora ? 'Meta 500 com detalhe interno' : null,
      };
    }),
  };
});

import { mountDashboard, limparCachesDashboard, limitesDashboard } from '../routes/geradorDashboard';
import { limparCachesSolar } from '../routes/geradorSolar';
import { planilhaPadrao } from './solarPlanilhaFixture';

const r = Router();
mountDashboard(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const THIAGO = 'Bearer tk-thiago';
const PROIBIDO = /valor|gasto|custo|receber|trafego/i;

const ag = (o: Record<string, unknown>) => ({
  id: 1, quando: '2026-10-12T17:30:00Z', status: 'agendado', vendedor_nome: 'Nilce', cliente_nome: 'Ana Souza Lima',
  cidade: 'Uberlândia', created_at: '2026-10-05T12:00:00Z', created_by: 'lp_solar', ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app',
    'tk-thiago': 'thiago@irmaosnaobra.app',
    'tk-estranho': 'alguem@gmail.com',
  };
  h.leituras = 0; h.leiturasEstado = 0; h.chamadasPainel = 0;
  h.bancoFora = false; h.posVendaFora = false; h.planilhaFora = false; h.metaFora = false; h.painelLento = false;
  h.cards = [
    ag({ id: 1 }),
    ag({ id: 2, vendedor_nome: 'Giovanna', quando: '2026-10-12T18:00:00Z', created_by: 'lp_eletroposto', cliente_nome: 'Bia Costa' }),
    ag({ id: 3, vendedor_nome: 'Diego', quando: '2026-09-01T15:00:00Z', cliente_nome: 'Caio Prado' }),
    ag({ id: 201, vendedor_nome: 'Nilce', status: 'fechou', quando: '2026-10-02T15:00:00Z', created_by: 'lp_eletroposto', cliente_nome: 'Dani Reis' }),
    ag({ id: 202, vendedor_nome: 'Giovanna', status: 'fechou', quando: '2026-10-03T15:00:00Z', created_by: 'lp_eletroposto', cliente_nome: 'Edu Lima' }),
  ];
  h.propostas = [
    { codigo: 'A1', consultor_nome: 'Nilce', created_at: '2026-10-02T12:00:00Z' },
    { codigo: 'A2', consultor_nome: 'Giovanna', created_at: '2026-10-03T12:00:00Z' },
  ];
  const fd = [{ name: 'Caminho', values: ['vistoria'] }];
  h.leads = [
    { lead_id: 'quiz_5534991110001', created_time: '2026-10-10T12:00:00Z', field_data: fd, agendado_id: null, consultor: 'Nilce' },
    { lead_id: 'quiz_5534991110002', created_time: '2026-10-10T12:00:00Z', field_data: fd, agendado_id: null, consultor: 'Diego' },
  ];
  h.estado = new Map([['pos_venda:201', { valor: 154000, vendido_em: '2026-10-05', modelo: 'meio_a_meio' }]]);
  limitesDashboard.painelMs = 6_000;
  limparCachesDashboard(); limparCachesSolar();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('docs.google.com')) {
      return h.planilhaFora ? new Response('erro', { status: 500 }) : new Response(planilhaPadrao(), { status: 200 });
    }
    throw new Error(`fetch inesperado: ${String(url).split('?')[0]}`);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const dash = (qs = '', auth = NILCE) => request(app).get(`/gerador/dashboard${qs}`).set('Authorization', auth);
const neg = (qs = '', auth = NILCE) => request(app).get(`/gerador/dashboard/negocio${qs}`).set('Authorization', auth);

describe('login', () => {
  it('401 sem token, com publishable e com token inválido; 403 para quem não é consultor', async () => {
    for (const rota of ['/gerador/dashboard', '/gerador/dashboard/negocio']) {
      expect((await request(app).get(rota)).status).toBe(401);
      expect((await request(app).get(rota).set('Authorization', 'Bearer sb_publishable_x')).status).toBe(401);
      expect((await request(app).get(rota).set('Authorization', 'Bearer lixo')).status).toBe(401);
      expect((await request(app).get(rota).set('Authorization', 'Bearer tk-estranho')).status).toBe(403);
    }
    expect(h.leituras).toBe(0);
  });
});

describe('GET /dashboard', () => {
  it('consultor comum: só os cards e a linha dele no time, sem nenhuma chave de dinheiro', async () => {
    const res = await dash();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, hoje: '2026-10-12', consultor: 'nilce', verTudo: false, verDinheiro: false });
    expect(res.body.periodo).toEqual({ chave: 'mes', de: '2026-10-01', ate: '2026-10-12', rotulo: 'Este mês' });
    expect(res.body.agendaHoje.total).toBe(1);
    expect(res.body.agendaHoje.porConsultor.map((l: any) => l.consultor)).toEqual(['Nilce']);
    expect(res.body.agendaHoje.proximos[0]).toMatchObject({ id: 1, hora: '14:30', cliente: 'Ana L.', produto: 'solar' });
    expect(res.body.pendencias.agendadosVencidos.total).toBe(0);
    expect(res.body.pendencias.quizSemHorario.total).toBe(1);
    expect(res.body.time.map((t: any) => t.consultor)).toEqual(['Nilce']);
    expect(PROIBIDO.test(JSON.stringify(res.body))).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/Bia|Caio|Giovanna.*proximos/);
  });

  it('sócio: vê tudo', async () => {
    const res = await dash('', THIAGO);
    expect(res.body).toMatchObject({ verTudo: true, verDinheiro: true, consultor: 'thiago' });
    expect(res.body.agendaHoje.total).toBe(2);
    expect(res.body.pendencias.agendadosVencidos).toMatchObject({ total: 1, solar: 1 });
    expect(res.body.pendencias.quizSemHorario.total).toBe(2);
    expect(res.body.funil.eletroposto.agendaram).toBe(3);
  });

  it('cache do dado bruto: a segunda chamada não lê o banco, e a resposta do sócio não vaza para o consultor', async () => {
    const socio = await dash('', THIAGO);
    const lidas = h.leituras;
    expect(lidas).toBeGreaterThan(0);
    const nilce = await dash('');
    expect(h.leituras).toBe(lidas);
    expect(nilce.body.agendaHoje.total).toBe(1);
    expect(socio.body.agendaHoje.total).toBe(2);
    // Ordem inversa: o consultor primeiro e o sócio depois.
    limparCachesDashboard();
    const n2 = await dash('');
    const s2 = await dash('', THIAGO);
    expect(n2.body.agendaHoje.total).toBe(1);
    expect(s2.body.agendaHoje.total).toBe(2);
  });

  it('período: 90dias traz 90 dias no porDia; inválido cai em mes', async () => {
    const r90 = await dash('?periodo=90dias', THIAGO);
    expect(r90.body.periodo.chave).toBe('90dias');
    expect(r90.body.porDia).toHaveLength(90);
    const ruim = await dash('?periodo=ontem');
    expect(ruim.body.periodo.chave).toBe('mes');
    expect(ruim.body.porDia).toHaveLength(12);
  });

  it('banco fora: 502 curto, sem stack nem URL', async () => {
    h.bancoFora = true;
    const res = await dash('', THIAGO);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|segredo|at /);
  });
});

describe('GET /dashboard/negocio', () => {
  it('sócio: vendas com valor, a receber, obras e tráfego', async () => {
    const res = await neg('', THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, verTudo: true, verDinheiro: true });
    expect(res.body.vendas.periodo.eletroposto).toEqual({ qtd: 2, valor: 154000, semValor: 1 });
    expect(res.body.vendas.porMes).toHaveLength(6);
    expect(res.body.vendas.porMes[5]).toMatchObject({ mes: '2026-10', parcial: true });
    expect(res.body.aReceber).toEqual({ valor: 6000, vendas: 1 });
    expect(res.body.obras).toMatchObject({ emAndamento: 3, concluidas: 2 });
    expect(res.body.trafego).toEqual({ rotulo: 'Últimos 30 dias', gasto: 960, agendados: 15, custoPorAgendado: 64, meta_ok: true });
    expect(res.body.fontes).toEqual({ planilha: true, posVenda: true });
  });

  it('consultor comum: só as vendas dele, sem chave de dinheiro e sem chamar o painel', async () => {
    const res = await neg();
    expect(res.status).toBe(200);
    expect(res.body.verDinheiro).toBe(false);
    expect(res.body.vendas.periodo.eletroposto).toEqual({ qtd: 1 });
    expect(res.body.vendas.periodo.solar).toEqual({ qtd: 0 });
    expect(res.body).not.toHaveProperty('aReceber');
    expect(res.body).not.toHaveProperty('trafego');
    expect(h.chamadasPainel).toBe(0);
    expect(PROIBIDO.test(JSON.stringify(res.body))).toBe(false);
    // As obras dele: Ana (concluída), Carla (em andamento) e Fabio (concluída).
    expect(res.body.obras).toMatchObject({ emAndamento: 1, concluidas: 2 });
  });

  it('cache: a resposta de sócio em cache não vaza para o consultor', async () => {
    await neg('', THIAGO);
    const lidas = h.leituras;
    const res = await neg('');
    expect(h.leituras).toBe(lidas);
    expect(PROIBIDO.test(JSON.stringify(res.body))).toBe(false);
    expect(h.chamadasPainel).toBe(1);   // só a do sócio
  });

  it('planilha fora: 200, fontes.planilha=false e os blocos do solar marcados', async () => {
    h.planilhaFora = true;
    const res = await neg('', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.fontes.planilha).toBe(false);
    expect(res.body.obras.indisponivel).toBe(true);
    expect(res.body.aReceber.indisponivel).toBe(true);
    expect(res.body.vendas.periodo.solar).toEqual({ indisponivel: true });
    expect(res.body.vendas.periodo.eletroposto.qtd).toBe(2);
  });

  it('Meta fora: 200 e trafego.meta_ok=false, sem gasto nem custo', async () => {
    h.metaFora = true;
    const res = await neg('', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.trafego.meta_ok).toBe(false);
    expect(res.body.trafego).not.toHaveProperty('gasto');
    expect(res.body.trafego).not.toHaveProperty('custoPorAgendado');
    expect(JSON.stringify(res.body)).not.toMatch(/detalhe interno/);
  });

  it('painel lento não segura a rota além do limite', async () => {
    h.painelLento = true;
    limitesDashboard.painelMs = 50;
    const t0 = Date.now();
    const res = await neg('', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.trafego).toEqual({ rotulo: 'Últimos 30 dias', meta_ok: false });
    expect(res.body.vendas.periodo.eletroposto.qtd).toBe(2);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('pós-venda fora: 200, fontes.posVenda=false e a venda conta sem valor', async () => {
    h.posVendaFora = true;
    const res = await neg('', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.fontes.posVenda).toBe(false);
    // Sem o registro não se sabe o dia nem o valor: nada de quantidade por mês, nada de R$ 0.
    expect(res.body.vendas.periodo.eletroposto).toEqual({ indisponivel: true });
    expect(res.body.vendas.porMes.every((m: any) => m.eletroposto.indisponivel === true && m.eletroposto.qtd === undefined)).toBe(true);
    expect(res.body.notas.eletropostoSemRegistro).toBeUndefined();
  });

  it('banco fora: 502 curto', async () => {
    h.bancoFora = true;
    const res = await neg('', THIAGO);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ ok: false, error: expect.any(String) });
  });
});
