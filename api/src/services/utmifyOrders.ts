import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// utmifyOrders — envia as vendas do SolarDoc (Stripe) pra API de Pedidos da UTMify.
//
// POR QUE EXISTE: o dashboard "Principal" da UTMify só integra o Kiwify (LimpaPro).
// O SolarDoc roda no Stripe e NÃO tinha webhook pra UTMify → toda venda do SolarDoc
// aparecia como 0 no painel (a campanha "SolarDoc — CBO" nunca mostrava conversão,
// por melhor que vendesse). Aqui a gente empurra o pedido pra UTMify pelos MESMOS
// UTMs que já viajam LP → Stripe metadata → tabela `sales`, casando a venda com o
// anúncio. Espelho da CAPI (que vai pro Meta); isto vai pro painel da UTMify.
//
// CICLO (assinatura com 7 dias grátis):
//   checkout.session.completed → 'waiting_payment' (trial começou, ainda sem cobrança)
//   invoice.payment_succeeded  → 'paid'            (trial converteu / renovou)
// orderId = subscription_id (estável) → o 2º envio ATUALIZA o mesmo pedido, não cria
// outro. `createdAt` é constante entre os envios (exigência da UTMify).
//
// À PROVA DE ERRO: nunca lança — engole o próprio erro e devolve bool. O webhook/
// pagamento nunca quebra por causa daqui.
// KILL-SWITCHES: UTMIFY_ORDERS_OFF=1 desliga; sem UTMIFY_API_TOKEN → no-op.
// UTMIFY_TEST=1 marca isTest (valida sem sujar os dados reais do painel).
// ─────────────────────────────────────────────────────────────────────────────

const UTMIFY_URL = 'https://api.utmify.com.br/api-credentials/orders';

export type UtmifyStatus = 'waiting_payment' | 'paid' | 'refused' | 'refunded' | 'chargedback';

export interface UtmifyOrderInput {
  orderId: string;                     // estável por venda (usar o subscription_id)
  status: UtmifyStatus;
  createdAt: Date | string;            // T0 da venda — CONSTANTE entre atualizações
  approvedDate?: Date | string | null; // usado quando status = 'paid'
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  productId: string;
  productName: string;
  priceInReais: number;                // preço do plano (R$) → vira priceInCents
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

// "YYYY-MM-DD HH:MM:SS" em UTC (formato exigido pela UTMify).
function toUtmifyDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function sendUtmifyOrder(i: UtmifyOrderInput): Promise<boolean> {
  if (process.env.UTMIFY_ORDERS_OFF === '1') return false;

  const token = (process.env.UTMIFY_API_TOKEN || '').trim();
  if (!token) {
    logger.info('utmify', `UTMIFY_API_TOKEN ausente — pedido ${i.orderId} não enviado (no-op)`);
    return false;
  }

  const priceInCents = Math.max(0, Math.round((Number(i.priceInReais) || 0) * 100));

  const body = {
    orderId: i.orderId,
    platform: 'SolarDoc',
    paymentMethod: 'credit_card',
    status: i.status,
    createdAt: toUtmifyDate(i.createdAt),
    approvedDate: i.status === 'paid' ? toUtmifyDate(i.approvedDate || new Date()) : null,
    refundedAt: i.status === 'refunded' ? toUtmifyDate(i.approvedDate || new Date()) : null,
    customer: {
      name: i.name || 'Cliente SolarDoc',
      email: i.email || 'sem-email@solardoc.app',
      phone: i.phone || null,
      document: null,
      country: 'BR',
    },
    products: [{
      id: i.productId,
      name: i.productName,
      planId: i.productId,
      planName: i.productName,
      quantity: 1,
      priceInCents,
    }],
    trackingParameters: {
      src: null,
      sck: null,
      utm_source: i.utm_source || null,
      utm_campaign: i.utm_campaign || null,
      utm_medium: i.utm_medium || null,
      utm_content: i.utm_content || null,
      utm_term: i.utm_term || null,
    },
    commission: {
      totalPriceInCents: priceInCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: priceInCents,   // regra da UTMify: não pode ser 0
      currency: 'BRL',
    },
    isTest: process.env.UTMIFY_TEST === '1',
  };

  try {
    const resp = await fetch(UTMIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': token },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      logger.error('utmify', `pedido ${i.orderId} (${i.status}) rejeitado: ${resp.status} ${txt.slice(0, 300)}`);
      return false;
    }
    logger.info('utmify', `pedido ${i.orderId} enviado (${i.status})`);
    return true;
  } catch (err) {
    logger.error('utmify', `falha ao enviar pedido ${i.orderId}`, err as Error);
    return false;
  }
}
