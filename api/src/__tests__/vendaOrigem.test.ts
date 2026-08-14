import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// Decisão do Thiago em 14/08/2026: o pixel da Meta só recebe VENDA NOVA. Venda
// fechada pelo follow-up (cupom da Giovanna, link de recuperação) e recompra de
// quem já comprou ficam SÓ no painel e no aviso do WhatsApp.
//
// Três jeitos de isso apodrecer em silêncio — os três cobertos aqui:
//   1) o classificador deixar de ver o cupom (venda de follow-up voltaria a ser
//      contada como do anúncio, que é o problema original);
//   2) o skip NÃO gravar estado terminal — aí o cron reDrivePendingPurchases
//      manda amanhã, sozinho, justamente o que a gente decidiu não mandar;
//   3) o corte pegar largo demais e engolir a venda direta/orgânica, que É nova
//      e tem que continuar ensinando o anúncio.

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

import { classificarOrigem, decisaoMeta, sendPurchaseForSale } from '../services/salesLedger';

const ONTEM = '2026-08-13T10:00:00.000Z';
const HOJE  = '2026-08-14T10:00:00.000Z';

function venda(over: Row = {}): Row {
  return {
    id: 'v1', email: 'novo@teste.com', checkout_session_id: 'cs_1',
    plano: 'ilimitado', produto: 'VIP', valor: 67,
    card_passed_at: HOJE, created_at: HOJE,
    origem: 'anuncio', meta_attempts: 0, meta_response_ok: false,
    ...over,
  };
}

beforeEach(() => {
  sales.length = 0;
  enviadosAoMeta.length = 0;
});

describe('classificarOrigem', () => {
  it('cupom manda mais que o clique do anúncio — quem fechou foi o follow-up', () => {
    // O caso real: clicou no anúncio, não comprou, e só fechou quando a Giovanna
    // mandou o código. O Meta contava essa venda como dele.
    const c = classificarOrigem({ fbc: 'fb.1.123.abc', utm_campaign: '120255606160730602', cupom: 'ACESSO19' });
    expect(c.origem).toBe('followup');
    expect(c.detalhe).toBe('cupom ACESSO19');
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
    // Elvis e Rodrigo (14/08): primeira compra, sem UTM. Continuam indo pro Meta.
    expect(classificarOrigem({}).origem).toBe('direto');
    expect(classificarOrigem({}).detalhe).toBe('sem UTM');
  });
});

describe('decisaoMeta', () => {
  it('só venda nova que não veio de follow-up vira Purchase', () => {
    expect(decisaoMeta({ origem: 'anuncio',  clienteNovo: true  })).toEqual({ envia: true,  motivo: null });
    expect(decisaoMeta({ origem: 'direto',   clienteNovo: true  })).toEqual({ envia: true,  motivo: null });
    expect(decisaoMeta({ origem: 'followup', clienteNovo: true  })).toEqual({ envia: false, motivo: 'followup' });
    expect(decisaoMeta({ origem: 'anuncio',  clienteNovo: false })).toEqual({ envia: false, motivo: 'recompra' });
  });
});

describe('sendPurchaseForSale — o gate', () => {
  it('venda nova de anúncio vai pro Meta com o valor do plano', async () => {
    sales.push(venda());
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toEqual([{ evento: 'Purchase', valor: 67 }]);
    expect(sales[0].meta_skip_motivo).toBeUndefined();
  });

  it('venda de follow-up NÃO vai, e fica em estado terminal (o cron não reenvia)', async () => {
    sales.push(venda({ origem: 'followup', valor: 19 }));
    const ok = await sendPurchaseForSale('v1');
    expect(ok).toBe(true);                        // resolvida, não é falha
    expect(enviadosAoMeta).toHaveLength(0);
    expect(sales[0].meta_skip_motivo).toBe('followup');
    // É esta linha que impede o reDrivePendingPurchases de varrer e mandar
    // amanhã: ele procura meta_response_ok = false.
    expect(sales[0].meta_response_ok).toBe(true);
  });

  it('recompra do mesmo e-mail não vai (o anúncio não vende duas vezes a mesma pessoa)', async () => {
    sales.push(venda({ id: 'v0', checkout_session_id: 'cs_0', card_passed_at: ONTEM, created_at: ONTEM }));
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1' }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(0);
    expect(sales[1].meta_skip_motivo).toBe('recompra');
  });

  it('a PRIMEIRA compra continua indo mesmo se uma venda mais nova já existir', async () => {
    // O cron reprocessa linha velha depois de a nova entrar. Sem comparar por
    // tempo, a primeira compra da pessoa viraria "recompra" retroativamente.
    sales.push(venda({ id: 'v1', checkout_session_id: 'cs_1', card_passed_at: ONTEM, created_at: ONTEM }));
    sales.push(venda({ id: 'v2', checkout_session_id: 'cs_2', card_passed_at: HOJE,  created_at: HOJE }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toHaveLength(1);
  });

  it('venda direta (sem UTM) de cliente novo continua ensinando o anúncio', async () => {
    sales.push(venda({ origem: 'direto', valor: 27 }));
    await sendPurchaseForSale('v1');
    expect(enviadosAoMeta).toEqual([{ evento: 'Purchase', valor: 27 }]);
  });
});
