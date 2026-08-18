import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── O que este teste protege ────────────────────────────────────────────────
// 18/08/2026: cliente pagou VIP R$67 às 12h41 por Apple Pay e às 14h27 o cron
// o rebaixou pra free, carimbando a venda como `canceled`. Duas causas, e as
// duas ficam presas aqui:
//
//   1. O `Customer` da Stripe nasce com o e-mail da CARTEIRA, não com o da
//      conta. Casar só por `customer.email` não acha quem pagou por wallet.
//   2. Pior que a causa: `stripeTruth?.plano ?? 'free'` lia "não encontrei"
//      como "não assina". Enquanto essa leitura existir, QUALQUER motivo novo
//      de não-encontrar rebaixa assinante pagante em silêncio.

const linhas: Record<string, any[]> = { sales: [] };

vi.mock('../utils/supabase', () => {
  const query = (tabela: string) => {
    const filtros: ((r: any) => boolean)[] = [];
    const api: any = {
      select: () => api,
      order:  () => api,
      limit:  () => api,
      not:    () => api,
      eq:    (c: string, v: any) => { filtros.push(r => r[c] === v); return api; },
      ilike: (c: string, v: any) => { filtros.push(r => String(r[c] ?? '').toLowerCase() === String(v).toLowerCase()); return api; },
      maybeSingle: async () => ({ data: linhas[tabela].filter(r => filtros.every(f => f(r)))[0] ?? null, error: null }),
      then: (res: any) => res({ data: linhas[tabela].filter(r => filtros.every(f => f(r))), error: null }),
    };
    return api;
  };
  return { supabase: { from: (t: string) => query(t) } };
});
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { emailsDaConta, carregarPonteEmailConta, customerIdsDaConta } from '../services/stripeContaLink';
import { deveSegurarRebaixamento } from '../services/stripeSyncService';

const VENDA_APPLE_PAY = {
  subscription_id: 'sub_max',
  customer_id: 'cus_max',
  email: 'max.myller.s.n@gmail.com',   // conta (o que ele digitou no checkout)
  created_at: '2026-08-18T15:41:17Z',
};
const EMAIL_DA_CARTEIRA = 'mossoroenergy@gmail.com';   // Apple Pay pôs isto no Customer

beforeEach(() => { linhas.sales = [{ ...VENDA_APPLE_PAY }]; });

describe('achar a conta de quem pagou por carteira digital', () => {
  it('pelo subscription_id, devolve o e-mail da CONTA — não o da carteira', async () => {
    const emails = await emailsDaConta({ subscriptionId: 'sub_max', customerId: 'cus_max', emailDoCustomer: EMAIL_DA_CARTEIRA });
    expect(emails[0]).toBe('max.myller.s.n@gmail.com');
  });

  it('devolve TAMBÉM o e-mail do Customer: é aditivo, não substitui', async () => {
    const emails = await emailsDaConta({ subscriptionId: 'sub_max', emailDoCustomer: EMAIL_DA_CARTEIRA });
    expect(emails).toContain(EMAIL_DA_CARTEIRA);
  });

  it('assinatura sem linha no ledger se comporta como antes (só o Customer)', async () => {
    linhas.sales = [];
    const emails = await emailsDaConta({ subscriptionId: 'sub_antiga', emailDoCustomer: 'alguem@gmail.com' });
    expect(emails).toEqual(['alguem@gmail.com']);
  });

  it('e-mail em MAIÚSCULA também casa — 6 contas têm', async () => {
    const emails = await emailsDaConta({ subscriptionId: 'sub_x', emailDoCustomer: 'GRITA@GMAIL.COM' });
    expect(emails).toContain('grita@gmail.com');
  });

  it('sem chave nenhuma não inventa conta', async () => {
    expect(await emailsDaConta({})).toEqual([]);
  });

  it('a ponte indexa os DOIS lados: assinatura e cliente', async () => {
    const ponte = await carregarPonteEmailConta();
    expect(ponte.get('sub_max')).toBe('max.myller.s.n@gmail.com');
    expect(ponte.get('cus_max')).toBe('max.myller.s.n@gmail.com');
  });

  it('caminho inverso acha o Customer da carteira pra poder CANCELAR', async () => {
    // Sem isto, cancelar a conta não cancela a cobrança: a conta fica suspensa
    // e os R$67 continuam saindo todo mês.
    expect(await customerIdsDaConta('max.myller.s.n@gmail.com')).toEqual(['cus_max']);
  });
});

describe('a trava: ausência não é cancelamento', () => {
  it('SEGURA quem pagou e sumiu da Stripe — o caso de 18/08', () => {
    expect(deveSegurarRebaixamento({
      temAssinaturaViva: false, vistoNoStripe: false, compraConfirmada: true,
    })).toBe(true);
  });

  it('REBAIXA quando a Stripe disse que acabou (assinatura vista, fora de ativa)', () => {
    expect(deveSegurarRebaixamento({
      temAssinaturaViva: false, vistoNoStripe: true, compraConfirmada: true,
    })).toBe(false);
  });

  it('não segura conta que nunca comprou nada', () => {
    expect(deveSegurarRebaixamento({
      temAssinaturaViva: false, vistoNoStripe: false, compraConfirmada: false,
    })).toBe(false);
  });

  it('quem assina não entra na trava', () => {
    expect(deveSegurarRebaixamento({
      temAssinaturaViva: true, vistoNoStripe: true, compraConfirmada: true,
    })).toBe(false);
  });
});
