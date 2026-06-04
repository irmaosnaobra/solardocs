import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';

// ── Funil do produto LimpaPro (curso de limpeza de placas, vendido na Kiwify) ──
// Totalmente isolado do funil SolarDoc: grava em limpapro_events, nunca em page_visits.
// Fluxo: PageView (visita na LP) → Checkout (clique no botão) → Compra (webhook Kiwify).

// Início-de-período em America/Sao_Paulo (UTC-3 fixo). Mesma lógica do adminController.
function spStartOfToday(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${ymd}T00:00:00-03:00`);
}
function spStartOfYesterday(): Date {
  const dt = spStartOfToday();
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt;
}
function spStartOfMonth(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${ymd.slice(0, 7)}-01T00:00:00-03:00`);
}

function sinceFromPeriod(period: string): Date {
  const now = new Date();
  if (period === 'hoje')  return spStartOfToday();
  if (period === 'ontem') return spStartOfYesterday();
  if (period === '3dias') return new Date(now.getTime() - 3 * 86400000);
  if (period === '7dias') return new Date(now.getTime() - 7 * 86400000);
  if (period === 'mes')   return spStartOfMonth();
  return new Date(0); // maximo
}

// ── 1) Tracking público — chamado pela landing limpapro.solardoc.app ──
// POST /_t/limpapro  { event_type, session_id, utm_*, referrer, landing_url }
export async function trackLimpapro(req: Request, res: Response): Promise<void> {
  try {
    const b = req.body as Record<string, string>;
    const eventType = b.event_type === 'checkout_click' ? 'checkout_click' : 'pageview';

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    await supabase.from('limpapro_events').insert({
      event_type:   eventType,
      session_id:   b.session_id   || null,
      utm_source:   b.utm_source   || null,
      utm_medium:   b.utm_medium   || null,
      utm_campaign: b.utm_campaign || null,
      utm_content:  b.utm_content  || null,
      utm_term:     b.utm_term     || null,
      referrer:     b.referrer     || null,
      landing_url:  b.landing_url  || null,
      user_agent:   (req.headers['user-agent'] as string) || null,
      ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('trackLimpapro error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

// ── 2) Webhook Kiwify — recebe vendas ──
// POST /webhook/kiwify  (body cru via express.text — assinatura validada antes do parse)
// A Kiwify assina o payload com HMAC-SHA1 do corpo cru usando o token do webhook,
// enviado como query ?signature= (ou header). Sem KIWIFY_WEBHOOK_TOKEN configurado,
// aceita mesmo assim (degrada com aviso) — o payload bruto SEMPRE é auditado primeiro.
export async function kiwifyWebhook(req: Request, res: Response): Promise<void> {
  // O app monta /webhook com express.text({ type: '*/*' }) → req.body é string crua.
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

  // 1. Audit log síncrono ANTES de qualquer parse — garante captura do 1º evento real
  //    mesmo se o mapeamento de campos estiver errado (não conhecemos o payload ainda).
  try {
    await supabase.from('webhook_debug').insert({
      payload: { _route: '/webhook/kiwify', raw: rawBody.slice(0, 20000) },
    });
  } catch (err) {
    console.error('[kiwify] audit log falhou:', err);
  }

  // 2. Valida assinatura HMAC-SHA1 (se token configurado).
  const token = process.env.KIWIFY_WEBHOOK_TOKEN?.trim();
  if (token) {
    const sig =
      (req.query.signature as string) ||
      (req.headers['x-kiwify-signature'] as string) ||
      '';
    const expected = crypto.createHmac('sha1', token).update(rawBody).digest('hex');
    if (!sig || sig !== expected) {
      console.warn('[kiwify] assinatura inválida — rejeitando');
      res.status(401).json({ error: 'invalid signature' });
      return;
    }
  } else {
    console.warn('[kiwify] KIWIFY_WEBHOOK_TOKEN ausente — aceitando sem validar assinatura');
  }

  // 3. Parse + persistência da venda.
  try {
    const evt = JSON.parse(rawBody) as KiwifyPayload;

    const orderId = String(
      evt.order_id || evt.id || evt.Customer?.order_id || evt.order?.id || ''
    ).trim() || null;
    const statusRaw = String(
      evt.order_status || evt.status || evt.webhook_event_type || ''
    ).toLowerCase();
    // Normaliza pros estados que importam pro funil.
    const status =
      /paid|aprovad|approved/.test(statusRaw) ? 'paid' :
      /refund|reembols/.test(statusRaw)       ? 'refunded' :
      /chargeback/.test(statusRaw)            ? 'chargeback' :
      /waiting|pending|aguard/.test(statusRaw) ? 'waiting_payment' :
      statusRaw || null;

    const buyer = evt.Customer || evt.customer || evt.buyer || {};
    const product = evt.Product || evt.product || {};
    const commission = evt.Commissions || evt.commissions || {};
    const amountCents =
      toCents(commission.charge_amount) ??
      toCents(evt.charge_amount) ??
      toCents(product.price) ??
      null;

    const row = {
      event_type:   'purchase',
      order_id:     orderId,
      buyer_email:  (buyer.email || '').toLowerCase() || null,
      buyer_name:   buyer.full_name || buyer.name || null,
      product_name: product.product_name || product.name || evt.product_name || null,
      status,
      amount_cents: amountCents,
      raw:          evt as unknown as Record<string, unknown>,
    };

    // Upsert por order_id (índice único parcial) — reentrega não duplica, só atualiza status.
    if (orderId) {
      await supabase.from('limpapro_events').upsert(row, { onConflict: 'order_id' });
    } else {
      // Sem order_id identificável: insere assim mesmo (auditoria), não dá pra deduplicar.
      await supabase.from('limpapro_events').insert(row);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[kiwify] parse/persist falhou (payload salvo em webhook_debug):', err);
    // 200 mesmo assim — o evento já foi auditado; não queremos a Kiwify reenviando em loop.
    res.status(200).json({ ok: true, parsed: false });
  }
}

// ── 3) Funil admin — GET /admin/funnel-limpapro?period= ──
export async function getLimpaproFunnel(req: Request, res: Response): Promise<void> {
  try {
    const period = (req.query.period as string) || 'maximo';
    const since = sinceFromPeriod(period);
    const sinceIso = since.toISOString();

    const { data: rows } = await supabase
      .from('limpapro_events')
      .select('event_type, session_id, status, amount_cents')
      .gte('created_at', sinceIso)
      .limit(50000);

    const all = rows ?? [];
    const pageviewRows = all.filter(r => r.event_type === 'pageview');
    const clickRows    = all.filter(r => r.event_type === 'checkout_click');
    const purchaseRows = all.filter(r => r.event_type === 'purchase');

    const visitasPV   = pageviewRows.length;
    const visitas     = new Set(pageviewRows.map(r => r.session_id).filter(Boolean)).size;
    const cliquesPV   = clickRows.length;
    const cliques     = new Set(clickRows.map(r => r.session_id).filter(Boolean)).size;

    const pagos       = purchaseRows.filter(r => r.status === 'paid');
    const vendas      = pagos.length;
    const faturamento = pagos.reduce((acc, r) => acc + (r.amount_cents ?? 0), 0) / 100;

    res.json({
      period,
      since: sinceIso,
      steps: [
        { key: 'visita',   label: 'Visitou a LP',   count: visitas, sub: `${visitasPV} pageviews` },
        { key: 'checkout', label: 'Clicou comprar', count: cliques, sub: `${cliquesPV} cliques` },
        { key: 'venda',    label: 'Comprou',        count: vendas,  sub: faturamento > 0 ? `R$ ${faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : undefined },
      ],
      faturamento,
    });
  } catch (err) {
    console.error('getLimpaproFunnel error:', err);
    res.status(500).json({ error: 'Erro ao carregar funil LimpaPro' });
  }
}

function toCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  // Kiwify manda valores em reais (ex 77 ou "77.00") → centavos.
  return Math.round(n * 100);
}

// Tipagem solta do payload Kiwify — campos variam por versão do webhook.
interface KiwifyPayload {
  order_id?: string; id?: string; order_status?: string; status?: string;
  webhook_event_type?: string; charge_amount?: number | string; product_name?: string;
  order?: { id?: string };
  Customer?: { order_id?: string; email?: string; full_name?: string; name?: string };
  customer?: { email?: string; full_name?: string; name?: string };
  buyer?: { email?: string; full_name?: string; name?: string };
  Product?: { product_name?: string; name?: string; price?: number | string };
  product?: { product_name?: string; name?: string; price?: number | string };
  Commissions?: { charge_amount?: number | string };
  commissions?: { charge_amount?: number | string };
}
