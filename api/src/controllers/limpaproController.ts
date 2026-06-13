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
    // A Kiwify JÁ manda os valores em CENTAVOS (charge_amount: 1200 = R$ 12,00),
    // então guardamos o inteiro direto — NÃO multiplicar por 100. (product.price também
    // vem em centavos no payload da Kiwify.)
    const amountCents =
      asCents(commission.charge_amount) ??
      asCents(evt.charge_amount) ??
      asCents(product.price) ??
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
// Retorna o funil (Visita → Clique → Compra) + um painel rico de vendas:
// nº de clientes, nº de vendas, reembolsos, ticket médio e lista de produtos vendidos.
//
// Definições (fechadas com o Thiago):
// • "Compra" = pedidos individuais — cada produto/order bump da Kiwify é 1 linha.
//   (O mesmo checkout com 4 bumps conta como 4 vendas; por isso convers conversão Clique→Compra
//    pode passar de 100%, já que o clique é por sessão da LP e a venda é por pedido na Kiwify.)
// • "Clientes" = e-mails distintos que compraram (dedup do bundle).
// • Faturamento = valor BRUTO cobrado (charge_amount, com juros de parcelamento incluídos) —
//   é o número que a Kiwify mostra na vitrine de vendas. Já vive em amount_cents.
interface LimpaproFunnelRpc {
  pv_total: number; pv_uniq: number;
  ck_total: number; ck_uniq: number;
  vendas: number; clientes: number; faturamento: number; liquido: number;
  reembolsos: number; reembolso_valor: number; recusados: number; aguardando: number;
  produtos: { name: string; vendas: number; receita: number }[];
}

export async function getLimpaproFunnel(req: Request, res: Response): Promise<void> {
  try {
    const period = (req.query.period as string) || 'maximo';
    const since = sinceFromPeriod(period);
    const sinceIso = since.toISOString();

    // Agregação no banco via RPC — evita o cap de 1000 linhas do PostgREST (já passamos de 1300
    // eventos) e resolve COUNT(DISTINCT session) que o supabase-js não expressa. Os números
    // batem 1:1 com a vitrine da Kiwify.
    const { data, error } = await supabase.rpc('limpapro_funnel', { since_ts: sinceIso });
    if (error) throw error;
    const r = (data ?? {}) as LimpaproFunnelRpc;

    const visitas     = r.pv_uniq ?? 0;
    const visitasPV   = r.pv_total ?? 0;
    const cliques     = r.ck_uniq ?? 0;
    const cliquesPV   = r.ck_total ?? 0;
    const vendas      = r.vendas ?? 0;           // pedidos individuais (cada bump conta 1)
    const clientes    = r.clientes ?? 0;         // compradores únicos (e-mail distinto)
    const faturamento = Number(r.faturamento ?? 0); // bruto cobrado (charge_amount)
    const liquido     = Number(r.liquido ?? 0);     // líquido (my_commission) — = tela "Vendas" da Kiwify

    const ticketVenda   = vendas > 0 ? faturamento / vendas : 0;
    const ticketCliente = clientes > 0 ? faturamento / clientes : 0;

    const produtos = (r.produtos ?? []).map(p => ({
      name: p.name,
      vendas: Number(p.vendas),
      receita: Number(p.receita),
    }));

    res.json({
      period,
      since: sinceIso,
      steps: [
        { key: 'visita',   label: 'Visitou a LP',   count: visitas, sub: `${visitasPV} pageviews` },
        { key: 'checkout', label: 'Clicou comprar', count: cliques, sub: `${cliquesPV} cliques` },
        { key: 'venda',    label: 'Comprou',        count: vendas,  sub: faturamento > 0 ? `R$ ${faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : undefined },
      ],
      faturamento,
      liquido,
      stats: {
        clientes,
        vendas,
        liquido,
        ticketVenda,
        ticketCliente,
        reembolsos:     r.reembolsos ?? 0,
        reembolsoValor: Number(r.reembolso_valor ?? 0),
        recusados:      r.recusados ?? 0,
        aguardando:     r.aguardando ?? 0,
      },
      produtos,
    });
  } catch (err) {
    console.error('getLimpaproFunnel error:', err);
    res.status(500).json({ error: 'Erro ao carregar funil LimpaPro' });
  }
}

// A Kiwify envia montantes já em centavos como inteiro (1200 = R$ 12,00).
// Só normalizamos pra número inteiro — sem multiplicar por 100.
function asCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return Math.round(n);
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
