import { describe, it, expect, vi, afterEach } from 'vitest';

const upserts: Array<{ tabela: string; linhas: any }> = [];
let linhasLidas: any[] = [];
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const cadeia: any = new Proxy({}, {
        get: (_a, prop) => {
          if (prop === 'upsert') return (linhas: any) => { upserts.push({ tabela, linhas }); return Promise.resolve({ error: null }); };
          if (prop === 'then') return (ok: (v: unknown) => unknown) => ok({ data: linhasLidas, error: null });
          return () => cadeia;
        },
      });
      return cadeia;
    },
  },
}));
vi.mock('../services/gerador/redes/publicador', () => ({ contaDoInstagram: vi.fn(async () => '17841400000000000') }));

import {
  mediana, classificarPost, marcarCortar, proximaMeta, tipoDaMidia, lerInsightsDaMidia, montarRelatorio,
  coletarMetricasIg, coletaDiariaIg, horaBR, ORCAMENTO_CHAMADAS, type LinhaPost,
} from '../services/instagram/igMedidor';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); linhasLidas = []; });

const resp = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) }) as unknown as Response;

describe('mediana', () => {
  it('ímpar, par, vazio e ignora lixo', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([])).toBe(0);
    expect(mediana([null, undefined, 10, NaN as number])).toBe(10);
  });
});

describe('classificarPost', () => {
  const med = { medViews: 1000, medSalvaCompart: 10 };
  it('REPETIR: views >= 1,5x e salva+compart >= 1x', () => {
    expect(classificarPost({ views: 1500, salvaCompart: 10 }, med)).toBe('REPETIR');
  });
  it('REPETIR: qualquer um >= 2x', () => {
    expect(classificarPost({ views: 2000, salvaCompart: 8 }, med)).toBe('REPETIR');
    expect(classificarPost({ views: 900, salvaCompart: 20 }, med)).toBe('REPETIR');
  });
  it('MANTER: views 1,5x mas salva+compart abaixo da mediana não repete', () => {
    expect(classificarPost({ views: 1500, salvaCompart: 9 }, med)).toBe('MANTER');
  });
  it('CORRIGIR: qualquer um <= 0,67x', () => {
    expect(classificarPost({ views: 670, salvaCompart: 10 }, med)).toBe('CORRIGIR');
    expect(classificarPost({ views: 1000, salvaCompart: 6 }, med)).toBe('CORRIGIR');
  });
  it('MANTER: o resto', () => {
    expect(classificarPost({ views: 1000, salvaCompart: 10 }, med)).toBe('MANTER');
  });
  it('mediana 0 não dá razão: não conta nem a favor nem contra', () => {
    expect(classificarPost({ views: 0, salvaCompart: 0 }, { medViews: 0, medSalvaCompart: 0 })).toBe('MANTER');
  });
});

describe('marcarCortar', () => {
  const f = (tipo: string, decisoes: Array<'REPETIR' | 'MANTER' | 'CORRIGIR'>) => ({ tipo, decisoes, decisao: 'MANTER' as const });
  it('3 mais recentes seguidos em CORRIGIR vira CORTAR', () => {
    const r = marcarCortar([f('REELS', ['CORRIGIR', 'CORRIGIR', 'CORRIGIR', 'REPETIR'])]);
    expect(r[0].decisao).toBe('CORTAR');
  });
  it('2 seguidos, ou 3 que não são os mais recentes, não corta', () => {
    expect(marcarCortar([f('REELS', ['CORRIGIR', 'CORRIGIR'])])[0].decisao).toBe('MANTER');
    expect(marcarCortar([f('IMAGE', ['MANTER', 'CORRIGIR', 'CORRIGIR', 'CORRIGIR'])])[0].decisao).toBe('MANTER');
  });
  it('só o formato que bate vira CORTAR', () => {
    const r = marcarCortar([f('REELS', ['CORRIGIR', 'CORRIGIR', 'CORRIGIR']), f('IMAGE', ['REPETIR', 'CORRIGIR', 'CORRIGIR'])]);
    expect(r.map((x) => x.decisao)).toEqual(['CORTAR', 'MANTER']);
  });
});

describe('auxiliares', () => {
  it('proximaMeta', () => {
    expect(proximaMeta(3200)).toBe(10000);
    expect(proximaMeta(10000)).toBe(20000);
    expect(proximaMeta(60000)).toBe(100000);
  });
  it('tipoDaMidia', () => {
    expect(tipoDaMidia('VIDEO', 'REELS')).toBe('REELS');
    expect(tipoDaMidia('CAROUSEL_ALBUM', 'FEED')).toBe('CAROUSEL_ALBUM');
    expect(tipoDaMidia(null, null)).toBe('DESCONHECIDO');
  });
  it('horaBR converte UTC para Brasília (UTC-3)', () => {
    expect(horaBR(new Date('2026-11-23T09:17:00Z'))).toBe(6);
    expect(horaBR(new Date('2026-11-23T02:00:00Z'))).toBe(23);
  });
});

describe('lerInsightsDaMidia: métrica não suportada não derruba', () => {
  it('tira a métrica citada no erro, repete e grava null nela', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      const metric = new URL(String(url)).searchParams.get('metric') ?? '';
      if (metric.split(',').includes('follows')) {
        return resp(400, { error: { code: 100, message: 'The Media Insights API does not support the follows metric for this media product type.' } });
      }
      return resp(200, { data: metric.split(',').map((name, i) => ({ name, values: [{ value: (i + 1) * 10 }] })) });
    }));
    const r = await lerInsightsDaMidia('999', 'token-falso');
    expect(r.follows).toBeNull();
    expect(r.reach).toBe(10);
    expect(r.profile_visits).not.toBeNull();
    expect(urls).toHaveLength(2);
    expect(urls[1]).not.toContain('follows');
  });

  it('erro sem nome de métrica: pede uma de cada vez, a que falha fica null', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const metric = new URL(String(url)).searchParams.get('metric') ?? '';
      if (metric.includes(',') || metric === 'shares') return resp(400, { error: { code: 100, message: 'Invalid parameter' } });
      return resp(200, { data: [{ name: metric, total_value: { value: 7 } }] });
    }));
    const r = await lerInsightsDaMidia('999', 'token-falso');
    expect(r.shares).toBeNull();
    expect(r.likes).toBe(7);
  });

  it('erro que não é de métrica (token) sobe e não é engolido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(401, { error: { code: 190, message: 'Invalid OAuth access token' } })));
    await expect(lerInsightsDaMidia('999', 'token-falso')).rejects.toThrow(/401/);
  });
});

describe('coleta: interruptor e ambiente', () => {
  it('desligada não chama a Meta', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.stubEnv('IG_MEDIDOR_LIGADO', '');
    expect(await coletarMetricasIg()).toEqual({ ok: false, motivo: 'desligado' });
    expect(f).not.toHaveBeenCalled();
  });
  it('ligada sem token sai sem erro', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.stubEnv('IG_MEDIDOR_LIGADO', 'true');
    vi.stubEnv('META_SYSTEM_USER_TOKEN', '');
    expect(await coletarMetricasIg()).toEqual({ ok: false, motivo: 'sem_token' });
    expect(f).not.toHaveBeenCalled();
  });
  it('o gancho do cron só roda na hora 6 de Brasília', async () => {
    expect(await coletaDiariaIg(new Date('2026-11-23T15:17:00Z'))).toEqual({ ok: true, pulou: 'fora_da_hora' });
    vi.stubEnv('IG_MEDIDOR_LIGADO', '');
    expect(await coletaDiariaIg(new Date('2026-11-23T09:17:00Z'))).toEqual({ ok: false, motivo: 'desligado' });
  });
});

describe('montarRelatorio', () => {
  const agora = new Date('2026-11-23T12:00:00Z');
  const h = (horas: number) => new Date(agora.getTime() - horas * 3_600_000).toISOString();
  const post = (id: string, horas: number, views: number, saved: number, tipo = 'REELS'): LinhaPost => ({
    media_id: id, tipo, publicado_em: h(horas), legenda: `legenda ${id}`, permalink: `https://instagram.com/p/${id}`,
    views, saved, shares: 0, comments: 2, follows: 1,
  });
  it('mediana na base madura, AGUARDANDO nos novos, ritmo para a meta', () => {
    const linhas = [
      post('a', 100, 1000, 10), post('b', 200, 1000, 10), post('c', 300, 1000, 10),
      post('novo', 10, 50, 0),
      post('bom', 80, 3000, 30),
      post('ruim', 90, 100, 0),
    ];
    const conta = [
      { dia: '2026-11-23', seguidores: 9000, ganho_dia: 20 },
      { dia: '2026-11-22', seguidores: 8980, ganho_dia: 20 },
    ];
    const r = montarRelatorio(linhas, conta, agora);
    expect(r.medianas.medViews).toBe(1000);
    const porId = Object.fromEntries(r.posts.map((p) => [p.media_id, p]));
    expect(porId.novo.decisao).toBe('AGUARDANDO');
    expect(porId.bom.decisao).toBe('REPETIR');
    expect(porId.ruim.decisao).toBe('CORRIGIR');
    expect(r.seguidores).toBe(9000);
    expect(r.ritmoParaMeta).toEqual({ meta: 10000, faltam: 1000, diasNoRitmoAtual: 175 });
    expect(r.comentariosSemana).toBe(8);
  });
  it('formato com 3 posts recentes seguidos em CORRIGIR vira CORTAR', () => {
    const linhas = [
      post('r1', 100, 1000, 10, 'IMAGE'), post('r2', 110, 1000, 10, 'IMAGE'), post('r3', 120, 1000, 10, 'IMAGE'),
      post('x1', 80, 100, 0, 'REELS'), post('x2', 90, 100, 0, 'REELS'), post('x3', 95, 100, 0, 'REELS'),
    ];
    const r = montarRelatorio(linhas, [], agora);
    expect(r.porFormato.find((f) => f.tipo === 'REELS')?.decisao).toBe('CORTAR');
    expect(r.porFormato.find((f) => f.tipo === 'IMAGE')?.decisao).not.toBe('CORTAR');
    expect(r.seguidores).toBeNull();
  });
});

describe('coleta: orçamento de chamadas e limite da Meta', () => {
  const midias = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, media_type: 'VIDEO', media_product_type: 'REELS', caption: 'x', permalink: `https://instagram.com/p/m${i}`,
    timestamp: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
  }));
  const ligar = () => {
    upserts.length = 0;
    vi.stubEnv('IG_MEDIDOR_LIGADO', '1');
    vi.stubEnv('META_SYSTEM_USER_TOKEN', 'token-falso');
  };

  it('nunca passa de 60 chamadas, mesmo com repetições; grava o que tem; fallback só em 2 mídias', async () => {
    ligar();
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(String(url));
      chamadas.push(u.pathname + '?' + (u.searchParams.get('metric') ?? ''));
      if (u.pathname.endsWith('/media')) return resp(200, { data: midias(50) });
      if (u.pathname.endsWith('/insights')) return resp(400, { error: { code: 100, message: 'Invalid parameter' } });
      return resp(200, { followers_count: 5000, media_count: 80 });
    }));
    const r = await coletarMetricasIg();
    expect(chamadas.length).toBe(ORCAMENTO_CHAMADAS);
    expect(r.parou).toBe('orcamento');
    expect(r.ok).toBe(true);
    // 2 mídias com fallback (1 + 9 chamadas cada), as outras 1 chamada cada: 60 - 2 - 20 = 38
    expect(r.posts).toBe(40);
    expect(chamadas.filter((c) => /\/insights\?[a-z_]+$/.test(c)).length).toBe(18);
    const gravouPosts = upserts.find((u) => u.tabela === 'ig_metricas_post');
    expect(gravouPosts?.linhas).toHaveLength(40);
    expect(gravouPosts?.linhas[39].reach).toBeNull();
    expect(upserts.some((u) => u.tabela === 'ig_metricas_conta')).toBe(true);
  });

  it('ordem: conta, lista, depois insights da mais nova para a mais velha; ignora mídia com mais de 30 dias', async () => {
    ligar();
    const ordem: string[] = [];
    const lista = [
      { id: 'velha', timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString() },
      { id: 'meio', timestamp: new Date(Date.now() - 5 * 86_400_000).toISOString() },
      { id: 'nova', timestamp: new Date(Date.now() - 1 * 86_400_000).toISOString() },
    ].map((m) => ({ ...m, media_type: 'VIDEO', media_product_type: 'REELS' }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(String(url));
      ordem.push(u.pathname.split('/').slice(-2).join('/'));
      if (u.pathname.endsWith('/media')) return resp(200, { data: lista });
      if (u.pathname.endsWith('/insights')) return resp(200, { data: [{ name: 'reach', values: [{ value: 1 }] }] });
      return resp(200, { followers_count: 5000, media_count: 80 });
    }));
    await coletarMetricasIg();
    const insights = ordem.filter((o) => o.endsWith('/insights'));
    expect(insights.slice(0, 2)).toEqual(['nova/insights', 'meio/insights']);
    expect(ordem.some((o) => o.startsWith('velha'))).toBe(false);
    expect(ordem[1]).toMatch(/media$/); // 2ª é a lista, depois da conta
  });

  it.each([4, 17, 32, 613])('erro code %i para a coleta na hora, grava o que já tem e não repete', async (code) => {
    ligar();
    let insightsFeitos = 0;
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(String(url));
      chamadas.push(u.pathname);
      if (u.pathname.endsWith('/media')) return resp(200, { data: midias(10) });
      if (u.pathname.endsWith('/insights')) {
        insightsFeitos++;
        if (insightsFeitos === 3) return resp(400, { error: { code, message: 'Application request limit reached' } });
        return resp(200, { data: [{ name: 'reach', values: [{ value: 9 }] }] });
      }
      return resp(200, { followers_count: 5000, media_count: 80 });
    }));
    const r = await coletarMetricasIg();
    expect(r.parou).toBe('limite');
    expect(r.posts).toBe(2);
    expect(chamadas).toHaveLength(5); // conta + lista + 3 insights; nada depois (nem follower_count)
    expect(upserts.find((u) => u.tabela === 'ig_metricas_post')?.linhas).toHaveLength(2);
    expect(upserts.some((u) => u.tabela === 'ig_metricas_conta')).toBe(true);
  });

  it('limite logo na conta: sai sem gravar e sem lançar erro', async () => {
    ligar();
    const f = vi.fn(async () => resp(400, { error: { code: 4, message: 'limit' } }));
    vi.stubGlobal('fetch', f);
    const r = await coletarMetricasIg();
    expect(r).toMatchObject({ ok: false, motivo: 'limite', parou: 'limite' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(0);
  });
});

describe('gancho do master: não coleta duas vezes e respeita o tempo', () => {
  const as6 = new Date('2026-11-23T09:17:00Z');
  const ligar = () => {
    upserts.length = 0;
    vi.stubEnv('IG_MEDIDOR_LIGADO', '1');
    vi.stubEnv('META_SYSTEM_USER_TOKEN', 'token-falso');
  };

  it('linha de hoje já existe: pula (ja_coletado) e não chama a Meta', async () => {
    ligar();
    linhasLidas = [{ dia: '2026-11-23' }];
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await coletaDiariaIg(as6)).toEqual({ ok: true, pulou: 'ja_coletado' });
    expect(f).not.toHaveBeenCalled();
  });

  it('sem linha de hoje: coleta; e o POST manual (coletarMetricasIg) coleta mesmo com a linha existindo', async () => {
    ligar();
    const f = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/media')) return resp(200, { data: [] });
      return resp(200, { followers_count: 5000, media_count: 80 });
    });
    vi.stubGlobal('fetch', f);
    expect(await coletaDiariaIg(as6)).toMatchObject({ ok: true });
    expect(f).toHaveBeenCalled();
    f.mockClear();
    linhasLidas = [{ dia: '2026-11-23' }];
    expect(await coletarMetricasIg()).toMatchObject({ ok: true });
    expect(f).toHaveBeenCalled();
  });

  it('passou de 90 s no total: grava o que tem e sai com parou tempo', async () => {
    ligar();
    let relogio = Date.now();
    const espiao = vi.spyOn(Date, 'now').mockImplementation(() => relogio);
    const midias = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, media_type: 'VIDEO', media_product_type: 'REELS', timestamp: new Date(relogio - (i + 1) * 3_600_000).toISOString(),
    }));
    let insights = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/media')) return resp(200, { data: midias });
      if (u.pathname.endsWith('/insights')) {
        insights++;
        relogio += 40_000; // cada insights "demora" 40 s
        return resp(200, { data: [{ name: 'reach', values: [{ value: 3 }] }] });
      }
      return resp(200, { followers_count: 5000, media_count: 80 });
    }));
    const r = await coletarMetricasIg().finally(() => espiao.mockRestore());
    expect(r.parou).toBe('tempo');
    expect(insights).toBe(3); // 40 s, 80 s, 120 s: a 4ª chamada já não sai
    expect(r.posts).toBe(3);
    expect(upserts.find((u) => u.tabela === 'ig_metricas_post')?.linhas).toHaveLength(3);
    expect(upserts.some((u) => u.tabela === 'ig_metricas_conta')).toBe(true);
  });
});
