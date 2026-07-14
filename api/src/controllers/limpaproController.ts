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
    // Aceita 'checkout_click' E variantes com plano ('checkout_click_full', '_downsell',
    // '_basic') — a LP manda o CTA clicado no sufixo. Guardamos o tipo completo (capado)
    // pra o funil saber QUAL card foi clicado; qualquer outra coisa vira pageview.
    const rawType = String(b.event_type || '');
    const eventType = /^checkout_click/.test(rawType) ? rawType.slice(0, 40) : 'pageview';

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

    // A Kiwify manda o rastreio do anúncio em TrackingParameters (utm_*). O
    // utm_content vem com o fbclid colado (…30602::PAZ…aem_…::) → corta no '::'.
    // (Descoberto 14/07: sempre esteve no payload, o webhook só não lia.)
    const tp = ((evt as any).TrackingParameters || (evt as any).tracking_parameters || {}) as Record<string, string>;
    const limpaContent = (v?: string | null) => (v ? String(v).split('::')[0] : null) || null;

    // Só inclui utm no row SE o payload trouxe (senão o upsert de um evento posterior
    // sem tracking — ex: refund — apagaria a atribuição já gravada).
    const utmCols = tp.utm_campaign ? {
      utm_source:   tp.utm_source   || null,
      utm_medium:   tp.utm_medium   || null,
      utm_campaign: tp.utm_campaign,
      utm_term:     tp.utm_term     || null,
      utm_content:  limpaContent(tp.utm_content),
    } : {};

    const row = {
      event_type:   'purchase',
      order_id:     orderId,
      ...utmCols,
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
  ck_por_plano?: Record<string, number>;   // cliques por CTA/plano (full/downsell/basic/geral)
  co_pessoas: number; abandonos: number;
  vendas: number; clientes: number; faturamento: number; liquido: number;
  upsell_n?: number; upsell_rev?: number;       // Usina R$197 (1-clique)
  downsell_n?: number; downsell_rev?: number;   // Usina R$97 (1-clique)
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

    // ── Etapas novas do funil ──────────────────────────────────────────
    const upsellN   = Number(r.upsell_n ?? 0);
    const upsellRev = Number(r.upsell_rev ?? 0);
    const downsellN = Number(r.downsell_n ?? 0);
    const downsellRev = Number(r.downsell_rev ?? 0);
    const ckPorPlano = (r.ck_por_plano && typeof r.ck_por_plano === 'object') ? r.ck_por_plano : {};

    // App: quantos ENTRARAM no app (acessaram). Filtra por ultimo_acesso no período;
    // 'maximo' = todos. Tabela admin-only, rota já é admin-gated.
    let appAcessos = 0;
    try {
      let q = supabase.from('limpapro_membros')
        .select('email', { count: 'exact', head: true })
        .not('ultimo_acesso_em', 'is', null);
      if (period !== 'maximo') q = q.gte('ultimo_acesso_em', sinceIso);
      const { count } = await q;
      appAcessos = count ?? 0;
    } catch { /* app access é best-effort — não derruba o funil */ }

    const brlSub = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    res.json({
      period,
      since: sinceIso,
      // Funil completo (pessoas/eventos únicos). 1-2 = sessão da LP (tracking próprio);
      // 3-4 = pessoa na Kiwify (e-mail); 5-6 = 1-clique pós-compra; 7 = acesso ao app.
      steps: [
        { key: 'visita',   label: 'Visitou a LP',       count: visitas,   sub: `${visitasPV} pageviews` },
        { key: 'clique',   label: 'Clicou num CTA',     count: cliques,   sub: `${cliquesPV} cliques`, breakdown: ckPorPlano },
        { key: 'checkout', label: 'Entrou no checkout', count: coPessoas, sub: abandonos > 0 ? `${abandonos} abandonaram` : undefined },
        { key: 'venda',    label: 'Comprou o curso',    count: clientes,  sub: vendas > 0 ? `${vendas} pedidos · ${brlSub(faturamento)}` : undefined },
        { key: 'upsell',   label: 'Upsell (Usina R$197)',   count: upsellN,   sub: upsellRev > 0 ? brlSub(upsellRev) : 'nenhuma aceita' },
        { key: 'downsell', label: 'Downsell (R$97)',        count: downsellN, sub: downsellRev > 0 ? brlSub(downsellRev) : 'nenhuma aceita' },
        { key: 'app',      label: 'Entrou no app',      count: appAcessos, sub: `${clientes > 0 ? Math.round((appAcessos / clientes) * 100) : 0}% dos compradores` },
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
        upsellN,
        upsellRev,
        downsellN,
        downsellRev,
        appAcessos,
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
// • comprou    = o email da sessão tem purchase paga → RECUPERADO (a venda fechou!)
// • perdido    = cliente recusou explícito (lead_data.status='perdido') → Bia parou de vender
// • takeover   = humano assumiu (lead_data.human_takeover) → Bia calou
// • respondeu  = a pessoa mandou ao menos 1 msg (role='user') → engajou
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

    const rows = (data ?? []) as BiaSessionRow[];

    // RECUPERADOS: quais emails das sessões já têm compra paga? Uma query só (in-list dos
    // emails presentes nas sessões), pra marcar "comprou" sem N+1. lead_data.email é o elo.
    const emails = Array.from(new Set(
      rows.map((s) => String((s.lead_data?.['email'] ?? '')).toLowerCase().trim()).filter(Boolean),
    ));
    const compradores = new Set<string>();
    if (emails.length) {
      const { data: pagos } = await supabase
        .from('limpapro_events')
        .select('buyer_email')
        .eq('event_type', 'purchase').eq('status', 'paid')
        .in('buyer_email', emails);
      for (const p of (pagos ?? []) as { buyer_email: string | null }[]) {
        if (p.buyer_email) compradores.add(p.buyer_email.toLowerCase().trim());
      }
    }

    const TESTE_PHONE = '5534991360223';
    const conversas = rows.map((s) => {
      const msgs = Array.isArray(s.messages) ? s.messages : [];
      const respondeu = msgs.some((m) => m?.role === 'user');
      const takeover = Boolean(s.lead_data?.['human_takeover']);
      const perdido = s.lead_data?.['status'] === 'perdido';
      const email = String(s.lead_data?.['email'] ?? '').toLowerCase().trim();
      const comprou = Boolean(email && compradores.has(email));
      const ehTeste = s.phone === TESTE_PHONE || /(^|\W)teste\b/i.test(s.nome ?? '');
      return {
        phone: s.phone,
        nome: s.nome,
        updated_at: s.updated_at,
        n_msgs: msgs.length,
        respondeu,
        takeover,
        perdido,
        comprou,
        teste: ehTeste,
        // Texto da conversa, na ordem em que aconteceu.
        mensagens: msgs.map((m) => ({ role: m.role, content: m.content })),
      };
    });

    res.json({
      total: conversas.length,
      respondidas: conversas.filter((c) => c.respondeu && !c.teste).length,
      recuperados: conversas.filter((c) => c.comprou && !c.teste).length,
      conversas,
    });
  } catch (err) {
    console.error('getLimpaproConversas error:', err);
    res.status(500).json({ error: 'Erro ao carregar conversas da Bia' });
  }
}

// ── 6) Membros LimpaPro (base da Área de Membros) — GET /admin/membros-limpapro ──
// Quem comprou o curso e tem acesso à área de membros (limpapro.solardoc.app/membros).
// Junta limpapro_membros (conta + acesso) com limpapro_entitlements (o que cada um
// tem direito) e o progresso salvo. Foco em "como o público age":
//  • Attach rate — de cada comprador, quantos levaram cada extra (o número de VERDADE hoje).
//  • Ativação — quem já criou senha / entrou no app × quem ainda nem sabe que ele existe
//    (essa lista, com link de WhatsApp, é o alvo do "avisar os clientes").
//  • Engajamento — aulas concluídas / terminou o principal (enche com o tempo).
// Tabelas admin-only, sem PostgREST público: rota já é admin-gated (auth + admin).
// PII (nome/telefone) só trafega nesta rota fechada. senha_hash NUNCA sai — vira booleano.

// Rótulos amigáveis dos itens (slug técnico → nome que o Thiago reconhece).
const LIMPAPRO_ITENS: { slug: string; label: string; tipo: 'curso' | 'plano' | 'extra' | 'grupo' | 'mentoria' }[] = [
  { slug: 'curso-principal', label: 'Curso Principal',        tipo: 'curso' },
  { slug: 'premium',         label: 'Plano Completo',          tipo: 'plano' },
  { slug: 'usina',           label: 'Telhados & Usinas',      tipo: 'extra' },
  { slug: 'kit-captacao',    label: 'Estratégia de Dominação', tipo: 'extra' },
  { slug: 'kit-equipamento', label: 'Kit do Zero (Equip.)',   tipo: 'extra' },
  { slug: 'fidelidade',      label: 'Cliente Fidelizado',     tipo: 'extra' },
  { slug: 'comunidade',      label: 'Grupo de Crescimento',   tipo: 'grupo' },
  { slug: 'formacao',        label: 'Mentoria',               tipo: 'mentoria' },
];
// Módulos do curso (5) e bônus Premium (2). Chave de progresso = "<slug>#0" (espelha o app).
const LIMPAPRO_MODULOS = [
  { slug: 'm01', label: 'M1 · Técnica de Limpeza' },
  { slug: 'm02', label: 'M2 · Segurança em Altura' },
  { slug: 'm03', label: 'M3 · Precificação' },
  { slug: 'm04', label: 'M4 · Captação de Clientes' },
  { slug: 'm05', label: 'M5 · Renda Recorrente' },
];
const LIMPAPRO_BONUS = [
  { slug: 'scripts', label: 'Bônus · Scripts de WhatsApp' },
  { slug: 'b00',     label: 'Bônus · Tabela de Precificação' },
];
const LIMPAPRO_LABEL: Record<string, string> = Object.fromEntries(LIMPAPRO_ITENS.map(i => [i.slug, i.label]));
// product_name da Kiwify → slug (espelha mapItemNome do app). Pra atribuir vendas internas.
function slugFromNome(name: string | null): string | null {
  const n = (name || '').toLowerCase();
  if (/vital|premium/.test(n)) return 'premium';
  if (/limpa\s*solar\s*pro/.test(n)) return 'curso-principal';
  if (/comunidade|\+\s*sol/.test(n)) return 'comunidade';
  if (/usina|telhado/.test(n)) return 'usina';
  if (/fidel|contrato|recorr/.test(n)) return 'fidelidade';
  if (/equipamento|do\s*zero/.test(n)) return 'kit-equipamento';
  if (/kit|capta|estrat|domina/.test(n)) return 'kit-captacao';
  if (/forma|mentoria/.test(n)) return 'formacao';
  return null;
}

interface MembroRow {
  email: string; nome: string | null; telefone: string | null;
  ativo: boolean | null; progresso: Record<string, boolean> | null;
  criado_em: string | null; atualizado_em: string | null;
  ultimo_acesso_em: string | null; senha_hash: string | null;
}
interface EntRow { email: string; item: string; ativo: boolean | null; }

export async function getLimpaproMembros(_req: Request, res: Response): Promise<void> {
  try {
    // Base pequena (dezenas) → bem abaixo do teto de 1000 do PostgREST. Em paralelo:
    // membros + entitlements + o FUNIL de aquisição (RPC) pra montar a jornada completa.
    const [membrosRes, entsRes, funnelRes] = await Promise.all([
      supabase.from('limpapro_membros')
        .select('email, nome, telefone, ativo, progresso, criado_em, atualizado_em, ultimo_acesso_em, senha_hash')
        .order('criado_em', { ascending: false }),
      supabase.from('limpapro_entitlements').select('email, item, ativo').eq('ativo', true),
      supabase.rpc('limpapro_funnel', { since_ts: new Date(0).toISOString() }), // visitou/clicou/comprou (todo o período)
    ]);
    if (membrosRes.error) throw membrosRes.error;
    if (entsRes.error) throw entsRes.error;

    const membros = (membrosRes.data ?? []) as MembroRow[];
    const ents = (entsRes.data ?? []) as EntRow[];
    const fn = (funnelRes && !funnelRes.error ? funnelRes.data : null) as { pv_uniq?: number; ck_uniq?: number; clientes?: number } | null;

    // e-mail → itens que a pessoa tem direito.
    const itensPorEmail = new Map<string, Set<string>>();
    for (const e of ents) {
      const key = (e.email || '').toLowerCase().trim();
      if (!key || !e.item) continue;
      (itensPorEmail.get(key) ?? itensPorEmail.set(key, new Set()).get(key)!).add(e.item);
    }

    const soDigitos = (t: string | null) => (t ? t.replace(/\D/g, '') : '');

    const linhas = membros.map(m => {
      const email = (m.email || '').toLowerCase().trim();
      const itens = itensPorEmail.get(email) ?? new Set<string>();
      const premium = itens.has('premium');                       // plano COMPLETO
      const itensExtras = LIMPAPRO_ITENS.filter(i => (i.tipo === 'extra' || i.tipo === 'grupo' || i.tipo === 'mentoria') && itens.has(i.slug)).map(i => i.slug);

      const prog = (m.progresso && typeof m.progresso === 'object') ? m.progresso : {};
      const feito = (slug: string) => !!prog[`${slug}#0`];
      const modulosFeitos = LIMPAPRO_MODULOS.filter(x => feito(x.slug)).map(x => x.slug);
      const bonusFeitos = LIMPAPRO_BONUS.filter(x => feito(x.slug)).map(x => x.slug);
      const completouCurso = LIMPAPRO_MODULOS.every(x => feito(x.slug));  // os 5 módulos
      const aulasConcluidas = Object.values(prog).filter(Boolean).length;

      const criouSenha = !!m.senha_hash;
      const acessou = !!m.ultimo_acesso_em;
      const status: 'acessou' | 'ativou' | 'nao_acessou' = acessou ? 'acessou' : criouSenha ? 'ativou' : 'nao_acessou';
      const certificado: 'liberado' | 'em_andamento' | 'bloqueado' =
        premium ? (completouCurso ? 'liberado' : 'em_andamento') : 'bloqueado';

      const tel = soDigitos(m.telefone);
      const telE164 = tel ? (tel.startsWith('55') ? tel : `55${tel}`) : '';

      return {
        email,
        nome: m.nome || null,
        telefone: tel || null,
        whatsapp_url: telE164 ? `https://wa.me/${telE164}` : null,
        ativo: m.ativo !== false,
        premium,
        plano: (premium ? 'completo' : 'basico') as 'completo' | 'basico',
        itens: LIMPAPRO_ITENS.filter(i => itens.has(i.slug)).map(i => i.slug),
        produtos: LIMPAPRO_ITENS.filter(i => itens.has(i.slug)).map(i => i.label),
        n_extras: itensExtras.length,
        criou_senha: criouSenha,
        acessou,
        status,
        modulos_feitos: modulosFeitos,
        n_modulos: LIMPAPRO_MODULOS.length,
        completou_curso: completouCurso,
        bonus_feitos: bonusFeitos,
        certificado,
        aulas_concluidas: aulasConcluidas,
        criado_em: m.criado_em,
        atualizado_em: m.atualizado_em,
        ultimo_acesso_em: m.ultimo_acesso_em,
      };
    });

    const total = linhas.length;
    const completo = linhas.filter(l => l.premium).length;
    const acessaram = linhas.filter(l => l.acessou).length;
    const criaramSenha = linhas.filter(l => l.criou_senha).length;
    const concluiramCurso = linhas.filter(l => l.completou_curso).length;
    const certificados = linhas.filter(l => l.certificado === 'liberado').length;

    // Acessos liberados (ownership) por produto/plano.
    const produtos = LIMPAPRO_ITENS.map(i => {
      const donos = linhas.filter(l => l.itens.includes(i.slug)).length;
      return { slug: i.slug, label: i.label, tipo: i.tipo, donos, pct: total > 0 ? Math.round((donos / total) * 100) : 0 };
    });

    // Engajamento: quantos concluíram cada módulo / bônus (onde a galera trava).
    // Bônus só contam sobre a base que PODE acessar (premium).
    const engajamento = [
      ...LIMPAPRO_MODULOS.map(x => ({ ...x, bonus: false })),
      ...LIMPAPRO_BONUS.map(x => ({ ...x, bonus: true })),
    ].map(x => {
      const feitos = linhas.filter(l => (x.bonus ? l.bonus_feitos : l.modulos_feitos).includes(x.slug)).length;
      const base = x.bonus ? completo : total;
      return { slug: x.slug, label: x.label, bonus: x.bonus, feitos, base, pct: base > 0 ? Math.round((feitos / base) * 100) : 0 };
    });

    // Jornada COMPLETA: aquisição (funil) → entrada no app → conclusão → certificado.
    const jornada = [
      { key: 'visitou',  label: 'Visitou a LP',      value: fn?.pv_uniq ?? 0 },
      { key: 'clicou',   label: 'Clicou em comprar', value: fn?.ck_uniq ?? 0 },
      { key: 'comprou',  label: 'Comprou',           value: fn?.clientes ?? total },
      { key: 'entrou',   label: 'Entrou no app',     value: acessaram },
      { key: 'senha',    label: 'Criou senha',       value: criaramSenha },
      { key: 'concluiu', label: 'Concluiu o curso',  value: concluiramCurso },
      { key: 'cert',     label: 'Certificado',       value: certificados },
    ];

    const kpis = {
      total,
      completo,
      basico: total - completo,
      acessaram,
      criaram_senha: criaramSenha,
      concluiram_curso: concluiramCurso,
      certificados,
      nunca_acessaram: total - acessaram,
      com_whatsapp: linhas.filter(l => l.whatsapp_url).length,
      total_extras_vendidos: linhas.reduce((s, l) => s + l.n_extras, 0),
    };

    // ── Cliques DENTRO do app (analytics de uso) ──────────────────────
    // Top aulas / ofertas / checkouts clicados. Best-effort: se a tabela ainda
    // não tiver dados (recém-criada), devolve vazio e o painel esconde a seção.
    const cliquesApp: {
      total: number;
      aulas: { alvo: string; n: number }[];
      ofertas: { alvo: string; n: number }[];
      checkouts: { alvo: string; n: number }[];
    } = { total: 0, aulas: [], ofertas: [], checkouts: [] };
    try {
      const { data: evs } = await supabase
        .from('limpapro_app_events').select('tipo, alvo').limit(20000);
      const rows = (evs ?? []) as { tipo: string; alvo: string }[];
      cliquesApp.total = rows.length;
      const topN = (t: string) => {
        const m = new Map<string, number>();
        for (const e of rows) if (e.tipo === t && e.alvo) m.set(e.alvo, (m.get(e.alvo) ?? 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([alvo, n]) => ({ alvo, n }));
      };
      cliquesApp.aulas     = topN('aula');
      cliquesApp.ofertas   = topN('oferta');
      cliquesApp.checkouts = topN('checkout');
    } catch { /* sem dados de clique ainda */ }

    // ── Vendas DENTRO do app (radar de monetização interna) ───────────
    // Atribuição: quem clicou no CHECKOUT de um produto dentro do app e depois
    // COMPROU esse produto (webhook, paid) = venda interna, com valor. Foco/melhoria.
    const vendasInternas: {
      hoje_valor: number; total_valor: number; total_qtd: number;
      checkouts: number; convertidos: number; conversao_pct: number;
      atividade: { email: string; nome: string | null; produto: string; tipo: string; comprou: boolean; valor: number; criado_em: string }[];
    } = { hoje_valor: 0, total_valor: 0, total_qtd: 0, checkouts: 0, convertidos: 0, conversao_pct: 0, atividade: [] };
    try {
      const [evRes, comprasRes] = await Promise.all([
        supabase.from('limpapro_app_events').select('email, tipo, alvo, criado_em').in('tipo', ['oferta', 'checkout']).order('criado_em', { ascending: false }).limit(5000),
        supabase.from('limpapro_events').select('buyer_email, product_name, amount_cents, created_at').eq('event_type', 'purchase').eq('status', 'paid').limit(5000),
      ]);
      const evs = (evRes.data ?? []) as { email: string; tipo: string; alvo: string; criado_em: string }[];
      const compras = (comprasRes.data ?? []) as { buyer_email: string; product_name: string | null; amount_cents: number | null; created_at: string }[];
      const nomeMap = new Map(linhas.map(l => [l.email, l.nome]));
      const hojeIso = spStartOfToday().toISOString();

      // clique de checkout mais ANTIGO por email+slug (âncora da atribuição).
      const cliqueCheckout = new Map<string, number>();
      for (const e of evs) {
        if (e.tipo !== 'checkout' || !e.alvo || !e.email) continue;
        const key = `${e.email.toLowerCase()}|${e.alvo}`;
        const t = new Date(e.criado_em).getTime();
        if (!cliqueCheckout.has(key) || t < cliqueCheckout.get(key)!) cliqueCheckout.set(key, t);
      }
      vendasInternas.checkouts = cliqueCheckout.size;

      // venda interna = compra paga de um EXTRA cujo checkout foi clicado no app ANTES.
      const vendaKeys = new Set<string>();
      const valorPorKey = new Map<string, number>();
      for (const c of compras) {
        const slug = slugFromNome(c.product_name);
        if (!slug || slug === 'curso-principal' || slug === 'premium') continue;
        const key = `${(c.buyer_email || '').toLowerCase()}|${slug}`;
        valorPorKey.set(key, (c.amount_cents ?? 0) / 100);
        const clickT = cliqueCheckout.get(key);
        if (clickT == null || new Date(c.created_at).getTime() < clickT) continue; // comprou sem clicar no app antes
        if (vendaKeys.has(key)) continue;                                          // 1 venda por email+produto
        vendaKeys.add(key);
        const valor = (c.amount_cents ?? 0) / 100;
        vendasInternas.total_valor += valor;
        vendasInternas.total_qtd += 1;
        if (c.created_at >= hojeIso) vendasInternas.hoje_valor += valor;
      }
      vendasInternas.convertidos = vendaKeys.size;
      vendasInternas.conversao_pct = vendasInternas.checkouts > 0 ? Math.round((vendasInternas.convertidos / vendasInternas.checkouts) * 100) : 0;

      // atividade por pessoa (ofertas vistas + checkouts clicados), com conversão + valor.
      vendasInternas.atividade = evs.slice(0, 80).map(e => {
        const key = `${(e.email || '').toLowerCase()}|${e.alvo}`;
        const comprou = vendaKeys.has(key);
        return {
          email: e.email, nome: nomeMap.get((e.email || '').toLowerCase()) ?? null,
          produto: LIMPAPRO_LABEL[e.alvo] ?? e.alvo, tipo: e.tipo,
          comprou, valor: comprou ? (valorPorKey.get(key) ?? 0) : 0, criado_em: e.criado_em,
        };
      });
    } catch { /* sem dados ainda */ }

    res.json({ gerado_em: new Date().toISOString(), kpis, jornada, engajamento, produtos, cliques_app: cliquesApp, vendas_internas: vendasInternas, membros: linhas });
  } catch (err) {
    console.error('getLimpaproMembros error:', err);
    res.status(500).json({ error: 'Erro ao carregar membros LimpaPro' });
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
