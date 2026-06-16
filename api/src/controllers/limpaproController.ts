import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { agendarRecuperacaoRealtime } from '../services/agents/whatsapp/limpaproRecoveryService';

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
      // Abandono da Kiwify guarda o email no TOPO do raw (evt.email), não em Customer —
      // por isso o coalesce. Sem ele, buyer_email fica null no abandono e o produtor
      // real-time da Bia (gate abaixo) nunca semeia. Casa com o coalesce da RPC limpapro_leads.
      buyer_email:  (buyer.email || evt.email || '').toLowerCase() || null,
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

    // ── Produtor real-time da recuperação (Bia) ──
    // Só semeia pra quem está EM ABERTO (pix gerado / abandono). NUNCA paid/refunded/
    // chargeback. NÃO envia aqui — só agenda o marcador; o consumidor (com re-check de
    // pagamento) envia depois do debounce. await + try/catch: em serverless 'void promise'
    // após o res morre sem rodar. É 1 select + 1 upsert (~50-150ms); o webhook já awaita
    // supabase antes do 200, e o catch externo responde 200 mesmo se algo lançar.
    const ehEmAberto = status === 'waiting_payment' || /abandon/.test(statusRaw);
    if (row.buyer_email && ehEmAberto) {
      try { await agendarRecuperacaoRealtime(row.buyer_email, row.buyer_name); }
      catch (e) { console.warn('[kiwify] seed recuperação falhou (ignorado):', e); }
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
  co_pessoas: number; abandonos: number;
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
    const coPessoas   = r.co_pessoas ?? 0;       // entraram no checkout da Kiwify (pessoas únicas)
    const abandonos   = r.abandonos ?? 0;        // entraram no checkout e NÃO compraram
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

    const brlSub = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    res.json({
      period,
      since: sinceIso,
      // Funil de 4 etapas — todas em PESSOAS únicas, então as barras nunca passam de 100%.
      // Etapas 1-2 = sessão da LP (tracking próprio); 3-4 = pessoa na Kiwify (por e-mail).
      // A transição 2→3 cruza dois sistemas (sessão LP × e-mail Kiwify) = aproximação.
      steps: [
        { key: 'visita',   label: 'Visitou a LP',      count: visitas,   sub: `${visitasPV} pageviews` },
        { key: 'clique',   label: 'Clicou no botão',   count: cliques,   sub: `${cliquesPV} cliques` },
        { key: 'checkout', label: 'Entrou no checkout',count: coPessoas, sub: abandonos > 0 ? `${abandonos} abandonaram` : undefined },
        { key: 'venda',    label: 'Comprou',           count: clientes,  sub: vendas > 0 ? `${vendas} pedidos · ${brlSub(faturamento)}` : undefined },
      ],
      faturamento,
      liquido,
      stats: {
        clientes,
        vendas,
        abandonos,
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

// ── 4) Leads de recuperação de checkout — GET /admin/leads-limpapro?period= ──
// Pessoas que entraram no checkout da Kiwify e NÃO compraram (abandonaram ou geraram
// pix e não pagaram). A lista é a fonte pra followup (WhatsApp). Contém PII (nome/
// telefone): a RPC limpapro_leads é security definer com grant SÓ pro service_role,
// e esta rota já é admin-gated (authMiddleware + adminMiddleware).
//
// Definições (auditadas):
// • Recuperado = abandonou/gerou pix e SÓ DEPOIS comprou (Δt positivo; refused NÃO ancora
//   recuperação — retry de cartão na mesma sessão não é recuperação).
// • Em aberto = nunca pagou e nunca estornou → vai pra lista (sempre cumulativo, qualquer
//   período: lead antigo ainda é recuperável).
// • R$ na mesa = soma das SKUs distintas da sessão de pix ATIVA (por pix_expiration), nunca
//   amount_cents (bug ×100). Abandono puro não tem valor no raw → âncora R$ 47 (Limpa Solar Pro).
// • since_ts filtra SÓ a métrica "recuperados no período" (por data da compra); a lista ignora.
export async function getLimpaproLeads(req: Request, res: Response): Promise<void> {
  try {
    const period = (req.query.period as string) || 'maximo';
    const since = sinceFromPeriod(period);
    // period 'maximo' → desde a epoch; a RPC interpreta null como "sem corte de período"
    // (mesma semântica), mas mandamos o ISO real pra alinhar com o resto do painel.
    const sinceIso = period === 'maximo' ? null : since.toISOString();

    const { data, error } = await supabase.rpc('limpapro_leads', { since_ts: sinceIso });
    if (error) throw error;

    // A RPC retorna { metrics, leads_abertos } pronto — repassa direto.
    res.json(data ?? { metrics: {}, leads_abertos: [] });
  } catch (err) {
    console.error('getLimpaproLeads error:', err);
    res.status(500).json({ error: 'Erro ao carregar leads LimpaPro' });
  }
}

// ── 5) Conversas da Bia (recuperação) — GET /admin/conversas-limpapro ──
// Histórico das conversas que a agente Bia teve com quem abandonou o checkout.
// Lê whatsapp_sessions tipo='recuperacao' (a Bia só abre sessão com quem ELA abordou,
// nunca toca cliente de energia solar). Contém PII (telefone + texto da conversa):
// rota admin-gated (authMiddleware + adminMiddleware), mesma classe da lista de leads.
//
// Cada sessão carrega messages[] {role:'assistant'|'user', content}. Derivamos:
// • respondeu  = a pessoa mandou ao menos 1 msg (role='user') → engajou
// • takeover   = humano assumiu (lead_data.human_takeover) → Bia calou
// A sessão de teste do Thiago (phone 5534991360223 / email teste+...@limpapro.local)
// é marcada como teste pro front poder esconder, sem sumir do banco.
interface BiaMsg { role: 'assistant' | 'user'; content: string }
interface BiaSessionRow {
  phone: string | null;
  nome: string | null;
  messages: BiaMsg[] | null;
  updated_at: string | null;
  lead_data: Record<string, unknown> | null;
}

export async function getLimpaproConversas(_req: Request, res: Response): Promise<void> {
  try {
    // Sessões da Bia, mais recentes primeiro. Cap de 200 — a fila de recuperação é
    // pequena (dezenas), bem abaixo do teto de 1000 do PostgREST.
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('phone, nome, messages, updated_at, lead_data')
      .eq('tipo', 'recuperacao')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const TESTE_PHONE = '5534991360223';
    const conversas = ((data ?? []) as BiaSessionRow[]).map((s) => {
      const msgs = Array.isArray(s.messages) ? s.messages : [];
      const respondeu = msgs.some((m) => m?.role === 'user');
      const takeover = Boolean(s.lead_data?.['human_takeover']);
      const ehTeste = s.phone === TESTE_PHONE || /(^|\W)teste\b/i.test(s.nome ?? '');
      return {
        phone: s.phone,
        nome: s.nome,
        updated_at: s.updated_at,
        n_msgs: msgs.length,
        respondeu,
        takeover,
        teste: ehTeste,
        // Texto da conversa, na ordem em que aconteceu.
        mensagens: msgs.map((m) => ({ role: m.role, content: m.content })),
      };
    });

    res.json({
      total: conversas.length,
      respondidas: conversas.filter((c) => c.respondeu && !c.teste).length,
      conversas,
    });
  } catch (err) {
    console.error('getLimpaproConversas error:', err);
    res.status(500).json({ error: 'Erro ao carregar conversas da Bia' });
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
  email?: string; // Kiwify põe o email do abandono no topo do raw, fora de Customer.
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
