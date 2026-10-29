import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// Ordem do dono em 29/10/2026: TODA venda nova da SolarDoc vira Purchase no Meta
// (até então só 4 de ~28 chegavam, porque o gate de 14/08 barrava follow-up e
// recompra). Só ficam de fora a venda de TESTE (utm raio-x-teste) e a cobrança
// repetida do mesmo e-mail em menos de 24 h.
//
// Três jeitos de isso apodrecer em silêncio — os três cobertos aqui:
//   1) o classificador deixar de ver o cupom (o painel "De onde chegaram" perderia
//      a separação anúncio/follow-up/direto);
//   2) o skip NÃO gravar estado terminal — aí o cron reDrivePendingPurchases
//      manda amanhã, sozinho, justamente o que a gente decidiu não mandar;
//   3) o redrive não pegar as vendas que a regra ANTIGA pulou (followup/recompra)
//      nos últimos 7 dias, que ainda dá tempo de mandar.

type Row = Record<string, any>;
const sales: Row[] = [];

vi.mock('../utils/supabase', () => {
  function query() {
    const filtros: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const alvos = () => sales.filter((r) => filtros.every((f) => f(r)));
    const q: any = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      upsert: () => q,
      eq:  (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
      neq: (col: string, val: any) => { filtros.push((r) => String(r[col]) !== String(val)); return q; },
      in:  (col: string, vals: any[]) => { filtros.push((r) => vals.includes(r[col])); return q; },
      gte: (col: string, val: any) => { filtros.push((r) => r[col] != null && new Date(r[col]).getTime() >= new Date(val).getTime()); return q; },
      // Como o PostgREST: comparação com NULL é falsa, a linha sai.
      lt:  (col: string, val: any) => { filtros.push((r) => r[col] != null && Number(r[col]) < Number(val)); return q; },
      // Só o formato 'col.is.null,col.lt.N' (OU entre os termos).
      or:  (expr: string) => {
        const termos = expr.split(',').map((t) => t.split('.'));
        filtros.push((r) => termos.some(([col, op, val]) =>
          op === 'is' && val === 'null' ? r[col] == null : op === 'lt' ? r[col] != null && Number(r[col]) < Number(val) : false));
        return q;
      },
      order: () => q,
      limit: () => q,
      single: async () => {
        const linhas = alvos();
        if (patch) linhas.forEach((r) => Object.assign(r, patch));
        return { data: linhas[0] ?? null, error: linhas.length ? null : new Error('sem linha') };
      },
      then: (ok: any, erro: any) => {
        const linhas = alvos();
        if (patch) linhas.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: linhas, error: null }).then(ok, erro);
      },
    };
    return q;
  }
  return { supabase: { from: () => query() } };
});

const enviadosAoMeta: Array<{ evento: string; valor: unknown }> = [];
vi.mock('../utils/metaPixel', () => ({
  sendMetaEvent: vi.fn(async (evento: string, opts: any) => {
    enviadosAoMeta.push({ evento, valor: opts?.customData?.value });
    return { ok: true, status: 200 };
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { classificarOrigem, decisaoMeta, ehVendaDeTeste, reDrivePendingPurchases, sendPurchaseForSale } from '../services/salesLedger';

const AGORA = new Date('2026-10-29T12:00:00.000Z').getTime();
const horasAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();
const diasAtras  = (d: number) => horasAtras(d * 24);

function venda(over: Row = {}): Row {
  return {
    id: 'v1', email: 'novo@example.com', checkout_session_id: 'cs_1',
    plano: 'ilimitado', produto: 'VIP', valor: 67,
    card_passed_at: horasAtras(0), created_at: horasAtras(0),
    origem: 'anuncio', meta_attempts: 0, meta_response_ok: false,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  sales.length = 0;
  enviadosAoMeta.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('classificarOrigem', () => {
  it('cupom manda mais que o clique do anúncio — quem fechou foi o follow-up', () => {
    // O caso real: clicou no anúncio, não comprou, e só fechou quando a Giovanna
    // mandou o código. O painel separa essa venda do anúncio.
    const c = classificarOrigem({ fbc: 'fb.1.123.abc', utm_campaign: '120255606160730602', cupom: 'ACESSO19' });
    expect(c.origem).toBe('followup');
    expect(c.detalhe).toBe('cupom ACESSO19');
  });

  it('desconto SEM código resolvido também é follow-up', () => {
    // O cupom digitado no checkout vira código por um lookup na Stripe que pode falhar.
    const c = classificarOrigem({ comDesconto: true, fbc: 'fb.1.123.abc' });
    expect(c.origem).toBe('followup');
    expect(c.detalhe).toBe('desconto no checkout');
  });

  it('link carimbado pelo toque do WhatsApp é follow-up', () => {
    expect(classificarOrigem({ utm_source: 'followup', utm_medium: 'whatsapp', utm_campaign: 'recuperacao' }).origem)
      .toBe('followup');
  });

  it('id numérico de campanha, fbc ou fbp = anúncio', () => {
    expect(classificarOrigem({ utm_campaign: '120255606160730602' }).origem).toBe('anuncio');
    expect(classificarOrigem({ fbc: 'fb.1.123.abc' }).origem).toBe('anuncio');
    expect(classificarOrigem({ fbp: 'fb.1.123.999' }).origem).toBe('anuncio');
    expect(classificarOrigem({ utm_source: 'FB', utm_medium: 'ads' }).origem).toBe('anuncio');
  });

  it('sem rastro nenhum é direto — não é follow-up', () => {
    expect(classificarOrigem({}).origem).toBe('direto');
    expect(classificarOrigem({}).detalhe).toBe('sem UTM');
  });
});

describe('ehVendaDeTeste', () => {
  it('raio-x-teste em source, medium ou campaign (qualquer caixa) é teste', () => {
    expect(ehVendaDeTeste({ utm_source: 'raio-x-teste' })).toBe(true);
    expect(ehVendaDeTeste({ utm_medium: 'Raio-X-Teste' })).toBe(true);
    expect(ehVendaDeTeste({ utm_campaign: ' raio-x-teste ' })).toBe(true);
    expect(ehVendaDeTeste({ utm_source: 'fb', utm_campaign: '123456789' })).toBe(false);
    expect(ehVendaDeTeste({})).toBe(false);
  });
});

describe('decisaoMeta', () => {
  it('manda sempre; só teste e duplicada ficam de fora', () => {
    expect(decisaoMeta({ teste: false, duplicada: false })).toEqual({ envia: true,  motivo: null });
    expect(decisaoMeta({ teste: true,  duplicada: false })).toEqual({ envia: false, motivo: 'teste' });
    expect(decisaoMeta({ teste: false, duplicada: true  })).toEqual({ envia: false, motivo: 'duplicada' });
    expect(decisaoMeta({ teste: true,  duplicada: true  })).toEqual({ envia: false, motivo: 'teste' });
  });
});

describe('sendPurchaseForSale — o gate', () => {
  it('venda nova de anúncio vai pro Meta com o valor do plano', async () => {
    sales.push(venda());
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toEqual([{ evento: 'Purchase', valor: 67 }]);
    expect(sales[0].meta_skip_motivo).toBeNull();
    expect(sales[0].meta_response_ok).toBe(true);
  });

  it('venda de follow-up (cupom) AGORA vai pro Meta', async () => {
    sales.push(venda({ origem: 'followup', valor: 19 }));
    const ok = await sendPurchaseForSale('v1');
    expect(ok).toBe(true);
    expect(enviadosAoMeta).toEqual([{ evento: 'Purchase', valor: 19 }]);
    expect(sales[0].meta_skip_motivo).toBeNull();
  });

  it('recompra do mesmo e-mail, dias depois, AGORA vai pro Meta', async () => {
    sales.push(venda({ id: 'v0', checkout_session_id: 'cs_0', card_passed_at: diasAtras(3), created_at: diasAtras(3) }));
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1' }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(1);
    expect(sales[1].meta_skip_motivo).toBeNull();
  });

  it('venda de teste (utm raio-x-teste) NÃO vai, e fica em estado terminal', async () => {
    sales.push(venda({ utm_source: 'raio-x-teste' }));
    const ok = await sendPurchaseForSale('v1');
    expect(ok).toBe(true);                        // resolvida, não é falha
    expect(enviadosAoMeta).toHaveLength(0);
    expect(sales[0].meta_skip_motivo).toBe('teste');
    // É esta linha que impede o reDrivePendingPurchases de varrer e mandar
    // amanhã: ele procura meta_response_ok = false.
    expect(sales[0].meta_response_ok).toBe(true);
  });

  it('mesmo e-mail com outra venda 2 h antes é duplicada: NÃO vai', async () => {
    sales.push(venda({ id: 'v0', checkout_session_id: 'cs_0', card_passed_at: horasAtras(2), created_at: horasAtras(2) }));
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1' }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(0);
    expect(sales[1].meta_skip_motivo).toBe('duplicada');
    expect(sales[1].meta_response_ok).toBe(true);
  });

  it('mesmo e-mail com venda 25 h antes já é outra venda: vai', async () => {
    sales.push(venda({ id: 'v0', checkout_session_id: 'cs_0', card_passed_at: horasAtras(25), created_at: horasAtras(25) }));
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1' }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(1);
  });

  it('exatamente 24 h antes não é duplicada (menos de 24 h é estrito)', async () => {
    sales.push(venda({ id: 'v0', checkout_session_id: 'cs_0', card_passed_at: horasAtras(24), created_at: horasAtras(24) }));
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1' }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(1);
  });

  it('a venda mais ANTIGA continua indo mesmo se uma mais nova já existir', async () => {
    // O cron reprocessa linha velha depois de a nova entrar. Só conta venda ANTERIOR.
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1', card_passed_at: horasAtras(3), created_at: horasAtras(3) }));
    sales.push(venda({ id: 'v2', checkout_session_id: 'cs_2', card_passed_at: horasAtras(0), created_at: horasAtras(0) }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(1);
  });

  it('e-mail diferente nas últimas 24 h não conta como duplicada', async () => {
    sales.push(venda({ id: 'v0', email: 'outro@example.com', checkout_session_id: 'cs_0', card_passed_at: horasAtras(1), created_at: horasAtras(1) }));
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1' }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(1);
  });

  it('venda direta (sem UTM) de cliente novo continua ensinando o anúncio', async () => {
    sales.push(venda({ origem: 'direto', valor: 27 }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toEqual([{ evento: 'Purchase', valor: 27 }]);
  });
});

describe('reDrivePendingPurchases — as puladas pela regra antiga', () => {
  it('pega followup/recompra dos últimos 7 dias, manda e limpa o motivo', async () => {
    sales.push(venda({ id: 'f1', email: 'a@example.com', checkout_session_id: 'cs_f', origem: 'followup', valor: 19,
      card_passed_at: diasAtras(3), created_at: diasAtras(3), meta_response_ok: true, meta_skip_motivo: 'followup' }));
    sales.push(venda({ id: 'r1', email: 'b@example.com', checkout_session_id: 'cs_r',
      card_passed_at: diasAtras(2), created_at: diasAtras(2), meta_response_ok: true, meta_skip_motivo: 'recompra' }));
    const r = await reDrivePendingPurchases();
    expect(r).toEqual({ tried: 2, ok: 2 });
    expect(enviadosAoMeta).toHaveLength(2);
    expect(sales.map((s) => s.meta_skip_motivo)).toEqual([null, null]);
    expect(sales.every((s) => s.meta_response_ok === true)).toBe(true);
  });

  it('ignora as puladas com mais de 7 dias (o Meta recusa evento tão velho)', async () => {
    sales.push(venda({ id: 'f1', checkout_session_id: 'cs_f', origem: 'followup',
      card_passed_at: diasAtras(9), created_at: diasAtras(9), meta_response_ok: true, meta_skip_motivo: 'followup' }));
    const r = await reDrivePendingPurchases();
    expect(r).toEqual({ tried: 0, ok: 0 });
    expect(enviadosAoMeta).toHaveLength(0);
    expect(sales[0].meta_skip_motivo).toBe('followup');
  });

  it('não repete o que já foi pulado pela regra nova (teste e duplicada ficam terminais)', async () => {
    sales.push(venda({ id: 't1', checkout_session_id: 'cs_t', utm_source: 'raio-x-teste',
      card_passed_at: diasAtras(1), created_at: diasAtras(1), meta_response_ok: true, meta_skip_motivo: 'teste' }));
    sales.push(venda({ id: 'd1', email: 'd@example.com', checkout_session_id: 'cs_d',
      card_passed_at: diasAtras(1), created_at: diasAtras(1), meta_response_ok: true, meta_skip_motivo: 'duplicada' }));
    expect(await reDrivePendingPurchases()).toEqual({ tried: 0, ok: 0 });
  });

  it('respeita o teto de 6 tentativas e segue pegando as pendentes de sempre', async () => {
    sales.push(venda({ id: 'f1', email: 'a@example.com', checkout_session_id: 'cs_f', origem: 'followup', meta_attempts: 6,
      card_passed_at: diasAtras(1), created_at: diasAtras(1), meta_response_ok: true, meta_skip_motivo: 'followup' }));
    sales.push(venda({ id: 'p1', email: 'p@example.com', checkout_session_id: 'cs_p',
      card_passed_at: diasAtras(1), created_at: diasAtras(1), meta_response_ok: false }));
    const r = await reDrivePendingPurchases();
    expect(r).toEqual({ tried: 1, ok: 1 });
    expect(sales[0].meta_skip_motivo).toBe('followup');
    expect(sales[1].meta_response_ok).toBe(true);
  });

  it('pulada com meta_attempts NULL entra no redrive (o .lt sozinho descartaria a linha)', async () => {
    sales.push(venda({ id: 'n1', email: 'n@example.com', checkout_session_id: 'cs_n', origem: 'followup', meta_attempts: null,
      card_passed_at: diasAtras(2), created_at: diasAtras(2), meta_response_ok: true, meta_skip_motivo: 'followup' }));
    const r = await reDrivePendingPurchases();
    expect(r).toEqual({ tried: 1, ok: 1 });
    expect(enviadosAoMeta).toHaveLength(1);
    expect(sales[0].meta_skip_motivo).toBeNull();
  });

  it('uma pulada que agora é duplicada de outra venda recente fica pulada com o motivo novo', async () => {
    sales.push(venda({ id: 'a', checkout_session_id: 'cs_a', card_passed_at: horasAtras(30), created_at: horasAtras(30), meta_response_ok: true }));
    sales.push(venda({ id: 'b', checkout_session_id: 'cs_b', origem: 'followup',
      card_passed_at: horasAtras(20), created_at: horasAtras(20), meta_response_ok: true, meta_skip_motivo: 'followup' }));
    await reDrivePendingPurchases();
    expect(enviadosAoMeta).toHaveLength(0);
    expect(sales[1].meta_skip_motivo).toBe('duplicada');
  });
});
