import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A VENDA POR LINK DO ASAAS TEM QUE VIRAR ACESSO.
//
// O trilho do Asaas nasceu para a ASSINATURA do SolarDoc, e todo evento dele é
// resolvido contra `asaas_pix_assinaturas`. Uma venda de curso pelo link de
// pagamento não tem contrato nenhum lá — então, sem o ramo novo, ela cairia como
// "pagamento fora do trilho" e o cliente ficaria PAGO E SEM ACESSO.
//
// É esse o defeito que estes testes existem pra impedir de voltar.
// ─────────────────────────────────────────────────────────────────────────────

const cursos: Array<{ slug: string; copy: unknown }> = [];
const eventosGravados: Array<Record<string, unknown>> = [];
let erroDoInsert: { code?: string } | null = null;

vi.mock('../utils/supabase', () => {
  // Encadeável em qualquer ordem e sempre vazio no fim: o que estes testes
  // exercitam é o DESVIO pro PlugCash, não a busca de contrato de assinatura —
  // que, para uma venda de curso, tem mesmo que não achar nada.
  const vazio = (): Record<string, unknown> => {
    const ret: Record<string, unknown> = {
      maybeSingle: async () => ({ data: null }),
      single: async () => ({ data: null }),
      then: undefined,
    };
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'gte', 'lte', 'is']) {
      ret[m] = () => vazio();
    }
    return ret;
  };

  const supabase = {
    from: (tabela: string) => {
      if (tabela === 'pc_cursos') {
        return { select: async () => ({ data: cursos }), insert: async () => ({ error: null }) } as never;
      }
      return {
        ...vazio(),
        insert: async (linha: Record<string, unknown>) => {
          if (tabela === 'asaas_webhook_events') eventosGravados.push(linha);
          return { error: erroDoInsert };
        },
        update: () => ({ eq: () => ({ neq: () => ({ select: async () => ({ data: [] }) }), select: async () => ({ data: [] }) }) }),
      } as never;
    },
  };
  return { supabase };
});

const asaasFetchMock = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve({}));
vi.mock('../services/asaas/asaasClient', () => ({
  asaasFetch: (path: string, init?: unknown) => asaasFetchMock(path, init),
  asaasApiKey: () => 'chave-de-teste',
  asaasBaseUrl: () => 'https://api-sandbox.asaas.com/v3',
  asaasHabilitado: () => true,
  AsaasError: class extends Error {},
}));

type ArgVenda = Record<string, unknown>;
const processarMock = vi.fn(async (_evt: ArgVenda) => ({ ok: true, acao: 'liberado', detalhe: '' }));
vi.mock('../services/plugcashService', () => ({
  processarEventoPlugcash: (evt: ArgVenda) => processarMock(evt),
}));

vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async () => ({})) }));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  PLANOS_PIX: { ilimitado: { nome: 'Ilimitado' } },
}));

import { processarWebhookAsaas } from '../services/asaas/asaasWebhookService';
import { acharOfertaDoPagamento } from '../services/asaas/asaasPlugcashLink';

/** O que o webhook mandou pro caminho de liberação, na chamada `i`. */
const argDaChamada = (i: number): ArgVenda => (processarMock.mock.calls[i]?.[0] ?? {}) as ArgVenda;

const CURSO_COM_ESCADA = {
  slug: 'fundamentos',
  copy: {
    ofertas: [
      { id: 'cheia',    centavos: 6700, asaas_link_id: 'lnk_67', checkout_url: 'https://asaas.com/c/lnk_67' },
      { id: 'desconto', centavos: 4700, asaas_link_id: 'lnk_47', checkout_url: 'https://asaas.com/c/lnk_47' },
      { id: 'ultima',   centavos: 2700, asaas_link_id: 'lnk_27', checkout_url: 'https://asaas.com/c/lnk_27' },
    ],
  },
};

const evento = (event: string, payment: Record<string, unknown>) => ({
  id: `evt_${Math.random().toString(36).slice(2)}`,
  event,
  payment: { customer: 'cus_1', ...payment },
});

beforeEach(() => {
  cursos.length = 0;
  cursos.push(CURSO_COM_ESCADA);
  eventosGravados.length = 0;
  erroDoInsert = null;
  processarMock.mockClear();
  asaasFetchMock.mockReset();
  asaasFetchMock.mockResolvedValue({ name: 'Cliente Teste', email: 'Cliente@Teste.com', mobilePhone: '34999998888' });
});

describe('reconhecer de qual produto é o pagamento', () => {
  it('casa pelo id do link — que é o que o pagamento sempre traz', async () => {
    const o = await acharOfertaDoPagamento({ paymentLink: 'lnk_47', externalReference: null });
    expect(o).toMatchObject({ slug: 'fundamentos', ofertaId: 'desconto', centavos: 4700 });
  });

  // Rede: link recriado à mão no painel não está no banco, mas o `pc:` diz o produto.
  it('cai no externalReference quando o link é desconhecido', async () => {
    const o = await acharOfertaDoPagamento({ paymentLink: 'lnk_novo', externalReference: 'pc:fundamentos:cheia' });
    expect(o).toMatchObject({ slug: 'fundamentos', ofertaId: 'cheia' });
  });

  it('pagamento que não é do PlugCash devolve nada', async () => {
    expect(await acharOfertaDoPagamento({ paymentLink: 'lnk_de_outro', externalReference: null })).toBeNull();
    expect(await acharOfertaDoPagamento({ paymentLink: null, externalReference: 'contrato-123' })).toBeNull();
  });
});

describe('o webhook libera a venda', () => {
  it('PAYMENT_RECEIVED do link vira acesso, pelo valor COBRADO e com gateway asaas', async () => {
    const r = await processarWebhookAsaas(
      evento('PAYMENT_RECEIVED', { id: 'pay_1', paymentLink: 'lnk_27', value: 27, billingType: 'PIX' }) as never,
    );
    expect(r.tratado).toBe(true);
    expect(processarMock).toHaveBeenCalledTimes(1);
    const arg = argDaChamada(0);
    expect(arg).toMatchObject({
      orderId: 'pay_1',
      email: 'cliente@teste.com',           // normalizado
      status: 'paid',
      gateway: 'asaas',
      valorCentavos: 2700,                  // o degrau pago, não o preço cheio
      itemDireto: { item_tipo: 'curso', item_slug: 'fundamentos', gera_credito: true },
    });
  });

  // O crédito de abatimento sai do valor pago. Usar o do catálogo daria R$ 67 de
  // crédito a quem pagou R$ 27 — dinheiro inventado no upgrade.
  it('o valor vem do pagamento, não do catálogo', async () => {
    await processarWebhookAsaas(
      evento('PAYMENT_CONFIRMED', { id: 'pay_2', paymentLink: 'lnk_67', value: 67 }) as never,
    );
    expect(argDaChamada(0).valorCentavos).toBe(6700);
  });

  it('reembolso e chargeback chegam como estado final, pra revogar', async () => {
    await processarWebhookAsaas(evento('PAYMENT_REFUNDED', { id: 'pay_3', paymentLink: 'lnk_47', value: 47 }) as never);
    expect(argDaChamada(0).status).toBe('refunded');

    processarMock.mockClear();
    await processarWebhookAsaas(
      evento('PAYMENT_CHARGEBACK_REQUESTED', { id: 'pay_4', paymentLink: 'lnk_47', value: 47 }) as never,
    );
    expect(argDaChamada(0).status).toBe('chargeback');
  });

  // Sem e-mail não há conta pra liberar. Gravar a venda assim mesmo deixaria o
  // cliente pago e sem acesso, sem ninguém saber — melhor estourar e deixar o
  // Asaas reentregar (ele reenvia por 14 dias enquanto não receber 2xx).
  it('cliente sem e-mail estoura em vez de gravar venda órfã', async () => {
    asaasFetchMock.mockResolvedValue({ name: 'Sem Email', email: '' });
    await expect(
      processarWebhookAsaas(evento('PAYMENT_RECEIVED', { id: 'pay_5', paymentLink: 'lnk_67', value: 67 }) as never),
    ).rejects.toThrow(/sem e-mail/i);
    expect(processarMock).not.toHaveBeenCalled();
  });

  it('pagamento da assinatura não é desviado pro PlugCash', async () => {
    const r = await processarWebhookAsaas(
      evento('PAYMENT_RECEIVED', { id: 'pay_6', paymentLink: null, subscription: 'sub_1', value: 67 }) as never,
    );
    expect(processarMock).not.toHaveBeenCalled();
    expect(r.motivo).toMatch(/fora do trilho/i);
  });

  // A escada não pode existir no banco sem link: aí o Stripe é quem vende, e o
  // webhook do Asaas não tem nada a ver com aquela venda.
  it('curso sem link do Asaas não é reconhecido', async () => {
    cursos.length = 0;
    cursos.push({ slug: 'fundamentos', copy: { ofertas: [{ id: 'cheia', centavos: 6700 }] } });
    const r = await processarWebhookAsaas(
      evento('PAYMENT_RECEIVED', { id: 'pay_7', paymentLink: 'lnk_67', value: 67 }) as never,
    );
    expect(processarMock).not.toHaveBeenCalled();
    expect(r.tratado).toBe(false);
  });
});
