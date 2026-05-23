import { Request, Response } from 'express';
import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { runMonthlyReset } from '../services/planService';
import { fetchAdsetInsights, sumTotals, type MetaPeriod } from '../services/metaAdsService';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// price_id → nome do plano. Sincronizado com PLAN_MAP em paymentsController.ts —
// se mudar lá, mudar aqui.
const PRICE_TO_PLAN: Record<string, string> = {
  [(process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim()]: 'pro',
  [(process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim()]: 'ilimitado',
};

// Início-de-período em America/Sao_Paulo. A API roda em UTC, então
// setHours(0,0,0,0) cai em SP 21:00 do dia anterior — bugava o "Hoje" do
// funil entre 21:00 SP e meia-noite. SP é UTC-3 fixo (Brasil aboliu DST em 2019).
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

type UserRow = {
  id: string;
  email: string;
  plano: string;
  documentos_usados: number;
  limite_documentos: number;
  created_at: string;
  is_admin: boolean;
  whatsapp: string | null;
  followup_started_at: string | null;
};

export async function getUsers(req: Request, res: Response): Promise<void> {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, plano, documentos_usados, limite_documentos, created_at, is_admin, whatsapp, followup_started_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: companies } = await supabase
      .from('company')
      .select('user_id, nome, cnpj, whatsapp');

    const companyMap = new Map(companies?.map(c => [c.user_id, c]) ?? []);

    // Stripe status por email: detecta quem passou cartão e quem ficou FREE
    // sem chegar no checkout. Lookup nos últimos 60 dias cobre todos os trials
    // ativos + churn recente sem custo excessivo de API.
    const stripeByEmail = new Map<string, { status: string; plan: string | null }>();
    try {
      const sinceUnix = Math.floor(Date.now() / 1000) - 60 * 86400;
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const subs = await stripe.subscriptions.list({
          created: { gte: sinceUnix },
          status: 'all',
          limit: 100,
          starting_after: cursor,
          expand: ['data.customer'],
        });
        for (const s of subs.data) {
          const cust = s.customer as { email?: string | null } | string;
          const email = typeof cust === 'string' ? null : (cust.email ?? null);
          if (!email) continue;
          const key = email.toLowerCase();
          // Stripe lista por created desc — primeira sub que aparecer pra esse email
          // é a vigente. Sem esse guard, uma past_due velha (jonoilson tinha sub
          // de abril que sobrescrevia a trial nova de maio) ganha do trial vigente.
          if (stripeByEmail.has(key)) continue;
          const priceId = s.items.data[0]?.price?.id ?? '';
          stripeByEmail.set(key, {
            status: s.status,
            plan: PRICE_TO_PLAN[priceId] ?? null,
          });
        }
        if (!subs.has_more) break;
        cursor = subs.data[subs.data.length - 1]?.id;
      }
    } catch (err) {
      console.error('getUsers: stripe lookup falhou (segue sem stripe_status):', err);
    }

    const result = (users as UserRow[] | null)?.map(u => {
      const stripe = stripeByEmail.get(u.email.toLowerCase());
      return {
        ...u,
        empresa_nome:     companyMap.get(u.id)?.nome     ?? null,
        empresa_cnpj:     companyMap.get(u.id)?.cnpj     ?? null,
        empresa_whatsapp: companyMap.get(u.id)?.whatsapp ?? null,
        stripe_status:    stripe?.status ?? null,
        stripe_plan:      stripe?.plan   ?? null,
      };
    });

    const { data: docs } = await supabase
      .from('documents')
      .select('created_at')
      .order('created_at', { ascending: false });

    res.json({ users: result, documents: docs ?? [] });
  } catch (err) {
    console.error('Admin getUsers error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function getVisits(req: Request, res: Response): Promise<void> {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 200, 500);
    const offset = Number(req.query.offset) || 0;

    const { data, error, count } = await supabase
      .from('page_visits')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ visits: data, total: count });
  } catch (err) {
    console.error('getVisits error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Funil da operação SolarDoc B2B: VSL → Landing → Cadastro → Empresa → Stripe → Plataforma
// Counts únicos por session_id quando possível.
export async function getFunnel(req: Request, res: Response): Promise<void> {
  try {
    const period = (req.query.period as string) || 'maximo';
    const now = new Date();
    let since: Date;
    if (period === 'hoje')       { since = spStartOfToday(); }
    else if (period === 'ontem') { since = spStartOfYesterday(); }
    else if (period === '3dias') { since = new Date(now.getTime() - 3 * 86400000); }
    else if (period === '7dias') { since = new Date(now.getTime() - 7 * 86400000); }
    else if (period === '30dias'){ since = new Date(now.getTime() - 30 * 86400000); }
    else if (period === 'mes')   { since = spStartOfMonth(); }
    else                         { since = new Date(0); }

    // 1) VSL — visitas em /apresentacao
    const { data: vslRows } = await supabase
      .from('page_visits')
      .select('session_id')
      .gte('created_at', since.toISOString())
      .ilike('landing_url', '%apresentacao%')
      .limit(10000);
    const vslPageviews = vslRows?.length ?? 0;
    const vslUnique = new Set((vslRows ?? []).map(v => v.session_id).filter(Boolean)).size;

    // 2) Landing — visitas na home (excluindo /io, /gerador, /apresentacao)
    const { data: allVisits } = await supabase
      .from('page_visits')
      .select('session_id, landing_url')
      .gte('created_at', since.toISOString())
      .limit(10000);
    const landingFiltered = (allVisits ?? []).filter(v => {
      const url = (v.landing_url || '').toLowerCase();
      if (!url) return true; // sem landing_url = considera root
      if (url.includes('apresentacao')) return false;
      if (url.includes('/io')) return false;
      if (url.includes('/gerador')) return false;
      if (url.includes('/auth')) return false;
      if (url.includes('pack.solardoc')) return false; // tem aba própria
      return true;
    });
    const landingPageviews = landingFiltered.length;
    const landingUnique = new Set(landingFiltered.map(v => v.session_id).filter(Boolean)).size;

    // 3) Cadastros — users criados no período (qualquer plano)
    const { count: cadastros } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since.toISOString());

    // 4) Stripe — subscriptions criadas no período via Stripe API.
    // Distingue quem só passou cartão (trial/canceled) de quem fechou (status=active,
    // ou seja, passou do trial de 7d e pagou a primeira fatura). Quebra por produto.
    let stripeReached = 0;
    let stripeClosed = 0;
    const byProduct: Record<string, number> = { pro: 0, ilimitado: 0 };
    try {
      const sinceUnix = Math.floor(since.getTime() / 1000);
      let cursor: string | undefined;
      // Pagina até 5 páginas (500 subs) — suficiente para qualquer período corrente.
      for (let page = 0; page < 5; page++) {
        const subs = await stripe.subscriptions.list({
          created: { gte: sinceUnix },
          status: 'all',
          limit: 100,
          starting_after: cursor,
        });
        for (const s of subs.data) {
          stripeReached += 1;
          if (s.status === 'active') stripeClosed += 1;
          const priceId = s.items.data[0]?.price?.id ?? '';
          const plano = PRICE_TO_PLAN[priceId];
          if (plano) byProduct[plano] = (byProduct[plano] ?? 0) + 1;
        }
        if (!subs.has_more) break;
        cursor = subs.data[subs.data.length - 1]?.id;
      }
    } catch (err) {
      console.error('getFunnel — falha ao consultar Stripe, caindo no fallback DB:', err);
      const { count: pagantes } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since.toISOString())
        .neq('plano', 'free');
      stripeReached = pagantes ?? 0;
    }

    // 5) Empresa preenchida — users criados no período que já têm registro em company.
    // Gate entre Cadastro e Stripe: VSL → Cadastro → /empresa → Stripe → Documentos.
    // company não tem created_at, então usamos users.created_at como proxy
    // (user criado no período E tem empresa cadastrada em algum momento).
    const { data: newUsers } = await supabase
      .from('users')
      .select('id')
      .gte('created_at', since.toISOString())
      .limit(10000);
    const newUserIds = (newUsers ?? []).map(u => u.id);
    let empresaCount = 0;
    if (newUserIds.length) {
      const { data: companies } = await supabase
        .from('company')
        .select('user_id')
        .in('user_id', newUserIds);
      empresaCount = new Set((companies ?? []).map(c => c.user_id)).size;
    }

    // 6) Plataforma — users que geraram pelo menos 1 documento no período
    const { data: docsRows } = await supabase
      .from('documents')
      .select('user_id')
      .gte('created_at', since.toISOString())
      .limit(10000);
    const ativos = new Set((docsRows ?? []).map(d => d.user_id).filter(Boolean)).size;

    res.json({
      period,
      since: since.toISOString(),
      steps: [
        { key: 'vsl',        label: 'VSL',         count: vslUnique,        sub: `${vslPageviews} pageviews` },
        { key: 'landing',    label: 'Landing',     count: landingUnique,    sub: `${landingPageviews} pageviews` },
        { key: 'cadastro',   label: 'Cadastro',    count: cadastros ?? 0,   sub: 'contas criadas' },
        { key: 'empresa',    label: 'Empresa',     count: empresaCount,     sub: 'preencheram CNPJ' },
        {
          key: 'stripe',
          label: 'Stripe',
          count: stripeReached,
          sub: 'chegaram ao pagamento',
          detail: { closed: stripeClosed, byProduct },
        },
        { key: 'plataforma', label: 'Plataforma',  count: ativos,           sub: 'geraram 1+ documento' },
      ],
    });
  } catch (err) {
    console.error('getFunnel error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function getAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 500);
    const period = (req.query.period as string) || 'maximo';

    const now = new Date();
    let since: Date;
    if (period === 'hoje')        { since = spStartOfToday(); }
    else if (period === 'ontem')  { since = spStartOfYesterday(); }
    else if (period === '3d')     { since = new Date(now.getTime() - 3 * 86400000); }
    else if (period === '7dias')  { since = new Date(now.getTime() - 7 * 86400000); }
    else if (period === 'mes')    { since = spStartOfMonth(); }
    else                          { since = new Date(0); }

    // Busca visitas recentes
    const { data: visits, error: vErr } = await supabase
      .from('page_visits')
      .select('*')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (vErr) throw vErr;

    const sessionIds = (visits ?? [])
      .map(v => v.session_id)
      .filter(Boolean) as string[];

    // Busca eventos das sessões
    let events: Array<{ session_id: string; event_type: string; event_data: Record<string, unknown>; created_at: string }> = [];
    if (sessionIds.length > 0) {
      const { data: evData } = await supabase
        .from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('session_id', sessionIds);
      events = evData ?? [];
    }

    // Agrupa eventos por session_id
    const eventsBySession = new Map<string, typeof events>();
    events.forEach(e => {
      const arr = eventsBySession.get(e.session_id) ?? [];
      arr.push(e);
      eventsBySession.set(e.session_id, arr);
    });

    // Helper TZ
    const TZ = 'America/Sao_Paulo';
    function isToday(dateStr: string) {
      const opts: Intl.DateTimeFormatOptions = { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' };
      const d   = new Date(dateStr).toLocaleDateString('pt-BR', opts);
      const now = new Date().toLocaleDateString('pt-BR', opts);
      return d === now;
    }

    // Monta sessões enriquecidas
    type SessionSummary = {
      session_id: string | null;
      created_at: string;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      utm_content: string | null;
      utm_term: string | null;
      referrer: string | null;
      landing_url: string | null;
      user_agent: string | null;
      ip: string | null;
      max_scroll: number;
      sections_seen: string[];
      cta_clicks: Array<{ label?: string; href?: string; plan?: string; step?: number }>;
      time_on_page: number | null;
      max_step: number;        // simulador: maior step alcançado (0 se não é simulador)
      sim_abandon: boolean;    // simulador: disparou abandono
    };

    const sessions: SessionSummary[] = (visits ?? []).map(v => {
      const sevents = v.session_id ? (eventsBySession.get(v.session_id) ?? []) : [];

      const scrollEvts = sevents.filter(e => e.event_type === 'scroll');
      const maxScroll = scrollEvts.length > 0
        ? Math.max(...scrollEvts.map(e => Number((e.event_data as { depth?: number })?.depth ?? 0)))
        : 0;

      const sectionEvts = sevents.filter(e => e.event_type === 'section');
      const sectionsSeen = sectionEvts
        .map(e => String((e.event_data as { section?: string })?.section ?? ''))
        .filter(Boolean);

      const ctaEvts = sevents.filter(e => e.event_type === 'cta_click');
      const ctaClicks = ctaEvts.map(e => e.event_data as { label?: string; href?: string; plan?: string; step?: number });

      const timeEvt = sevents.find(e => e.event_type === 'time_on_page');
      const timeOnPage = timeEvt
        ? Number((timeEvt.event_data as { seconds?: number })?.seconds ?? null)
        : null;

      // Simulador — extrai max_step e sim_abandon
      const stepEvts = sevents.filter(e => e.event_type === 'sim_step');
      const maxStep = stepEvts.length > 0
        ? Math.max(...stepEvts.map(e => Number((e.event_data as { step?: number })?.step ?? 0)))
        : 0;
      const simAbandon = sevents.some(e => e.event_type === 'sim_abandon');

      return {
        session_id:   v.session_id   ?? null,
        created_at:   v.created_at,
        utm_source:   v.utm_source   ?? null,
        utm_medium:   v.utm_medium   ?? null,
        utm_campaign: v.utm_campaign ?? null,
        utm_content:  v.utm_content  ?? null,
        utm_term:     v.utm_term     ?? null,
        referrer:     v.referrer     ?? null,
        landing_url:  v.landing_url  ?? null,
        user_agent:   v.user_agent   ?? null,
        ip:           v.ip           ?? null,
        max_scroll:   maxScroll,
        sections_seen: sectionsSeen,
        cta_clicks:   ctaClicks,
        time_on_page: isNaN(timeOnPage as number) ? null : timeOnPage,
        max_step:     maxStep,
        sim_abandon:  simAbandon,
      };
    });

    // Funil
    const totalVisits = sessions.length;
    const scroll50    = sessions.filter(s => s.max_scroll >= 50).length;
    const sawPrecos   = sessions.filter(s => s.sections_seen.includes('precos')).length;
    const ctaTotal    = sessions.filter(s => s.cta_clicks.length > 0).length;

    // Tempo médio
    const withTime = sessions.filter(s => s.time_on_page !== null && (s.time_on_page as number) > 0);
    const avgTime = withTime.length > 0
      ? Math.round(withTime.reduce((a, s) => a + (s.time_on_page as number), 0) / withTime.length)
      : null;

    // Top origens com funil
    function sourceLabel(s: SessionSummary) {
      if (s.utm_source) return s.utm_source;
      if (s.referrer) {
        try { return new URL(s.referrer).hostname.replace('www.', ''); } catch { return s.referrer; }
      }
      return 'Direto';
    }

    const sourceMap = new Map<string, SessionSummary[]>();
    sessions.forEach(s => {
      const src = sourceLabel(s);
      const arr = sourceMap.get(src) ?? [];
      arr.push(s);
      sourceMap.set(src, arr);
    });

    const sources = Array.from(sourceMap.entries())
      .map(([source, slist]) => ({
        source,
        visits:     slist.length,
        scroll_50:  slist.filter(s => s.max_scroll >= 50).length,
        saw_precos: slist.filter(s => s.sections_seen.includes('precos')).length,
        cta_clicks: slist.filter(s => s.cta_clicks.length > 0).length,
      }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);

    // Top CTAs clicados
    const ctaMap = new Map<string, number>();
    sessions.forEach(s => {
      s.cta_clicks.forEach(c => {
        const label = c.label ?? 'Desconhecido';
        ctaMap.set(label, (ctaMap.get(label) ?? 0) + 1);
      });
    });
    const topCtas = Array.from(ctaMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // Hoje
    const todayVisits = sessions.filter(s => isToday(s.created_at)).length;

    // Funil de conversão da plataforma (Lead → CompleteRegistration → Purchase)
    const [usersRes, companiesRes, paidRes] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('company').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).neq('plano', 'free'),
    ]);

    const conversion = {
      cadastros:    usersRes.count    ?? 0,
      empresas:     companiesRes.count ?? 0,
      assinantes:   paidRes.count     ?? 0,
    };

    res.json({
      total: totalVisits,
      today: todayVisits,
      avg_time: avgTime,
      funnel: { visits: totalVisits, scroll_50: scroll50, saw_precos: sawPrecos, cta_clicks: ctaTotal },
      conversion,
      sources,
      top_ctas: topCtas,
      sessions,
    });
  } catch (err) {
    console.error('getAnalytics error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function getMetaFunnel(req: Request, res: Response): Promise<void> {
  const token     = process.env.META_PIXEL_TOKEN   || '';
  const accountId = process.env.META_AD_ACCOUNT_ID || '';

  if (!token || !accountId) {
    res.json({ available: false, reason: 'Configure META_PIXEL_TOKEN e META_AD_ACCOUNT_ID nas variáveis de ambiente.' });
    return;
  }

  const period = (req.query.period as string) || 'maximo';
  
  let metaPeriod: MetaPeriod = 'today';
  if (period === 'hoje')   metaPeriod = 'today';
  if (period === 'ontem')  metaPeriod = 'yesterday';
  if (period === '3d')     metaPeriod = 'last_3d';
  if (period === '7dias')  metaPeriod = 'last_7d';
  if (period === 'mes')    metaPeriod = 'this_month';
  if (period === 'maximo') metaPeriod = 'maximum';

  const now   = new Date();
  let since: Date;
  if (period === 'hoje')        { since = spStartOfToday(); }
  else if (period === 'ontem')  { since = spStartOfYesterday(); }
  else if (period === '3d')     { since = new Date(now.getTime() - 3 * 86400000); }
  else if (period === '7dias')  { since = new Date(now.getTime() - 7 * 86400000); }
  else if (period === 'mes')    { since = spStartOfMonth(); }
  else                          { since = new Date(0); }

  try {
    // ── 1. Meta Ads insights ──────────────────────────────
    const adsets = await fetchAdsetInsights(accountId, token, metaPeriod);
    const totals = sumTotals(adsets);

    // ── 2. Visitas LP vindas do Meta ──────────────────────
    const META_SOURCES = ['facebook', 'instagram', 'fb', 'meta', 'ig'];

    const { data: visits } = await supabase
      .from('page_visits')
      .select('*')
      .gte('created_at', since.toISOString());

    const metaVisits = (visits ?? []).filter(v =>
      META_SOURCES.includes((v.utm_source ?? '').toLowerCase())
    );

    const sessionIds = metaVisits.map(v => v.session_id).filter(Boolean) as string[];

    let events: Array<{ session_id: string; event_type: string; event_data: Record<string, unknown> }> = [];
    if (sessionIds.length > 0) {
      const { data: evData } = await supabase
        .from('lp_events')
        .select('session_id, event_type, event_data')
        .in('session_id', sessionIds);
      events = evData ?? [];
    }

    const eventsBySession = new Map<string, typeof events>();
    events.forEach(e => {
      const arr = eventsBySession.get(e.session_id) ?? [];
      arr.push(e);
      eventsBySession.set(e.session_id, arr);
    });

    // Enriquece cada visita
    const enriched = metaVisits.map(v => {
      const sevents = v.session_id ? (eventsBySession.get(v.session_id) ?? []) : [];
      const scrollEvts = sevents.filter(e => e.event_type === 'scroll');
      const maxScroll  = scrollEvts.length > 0
        ? Math.max(...scrollEvts.map(e => Number((e.event_data as { depth?: number })?.depth ?? 0)))
        : 0;
      const sections   = sevents.filter(e => e.event_type === 'section').map(e => String((e.event_data as { section?: string })?.section ?? ''));
      const ctaClicks  = sevents.filter(e => e.event_type === 'cta_click');
      const timeEvt    = sevents.find(e => e.event_type === 'time_on_page');
      const timeOnPage = timeEvt ? Number((timeEvt.event_data as { seconds?: number })?.seconds ?? 0) : null;

      return {
        utm_campaign: v.utm_campaign ?? '',
        utm_content:  v.utm_content  ?? '',
        utm_medium:   v.utm_medium   ?? '',
        max_scroll:   maxScroll,
        sections,
        cta_clicks:   ctaClicks.length,
        time_on_page: timeOnPage,
      };
    });

    // Funil geral Meta → LP
    const lpVisits    = enriched.length;
    const scroll50    = enriched.filter(e => e.max_scroll >= 50).length;
    const sawPrecos   = enriched.filter(e => e.sections.includes('precos')).length;
    const ctaTotal    = enriched.filter(e => e.cta_clicks > 0).length;

    const withTime    = enriched.filter(e => e.time_on_page !== null && (e.time_on_page as number) > 0);
    const avgTime     = withTime.length > 0
      ? Math.round(withTime.reduce((a, e) => a + (e.time_on_page as number), 0) / withTime.length)
      : null;

    // ── 3. Por conjunto de anúncio (join por utm_content ≈ adset_name) ──
    const adsetRows = adsets.map(adset => {
      // Tenta casar utm_content ou utm_campaign com o nome do adset/campanha
      const adsetNorm    = adset.adset_name.toLowerCase().trim();
      const campaignNorm = adset.campaign_name.toLowerCase().trim();

      const matching = enriched.filter(e => {
        const c = e.utm_content.toLowerCase().trim();
        const p = e.utm_campaign.toLowerCase().trim();
        return c === adsetNorm || p === campaignNorm ||
               c.includes(adsetNorm) || adsetNorm.includes(c) ||
               p.includes(campaignNorm) || campaignNorm.includes(p);
      });

      return {
        adset_id:      adset.adset_id,
        adset_name:    adset.adset_name,
        campaign_name: adset.campaign_name,
        impressions:   adset.impressions,
        reach:         adset.reach,
        clicks:        adset.clicks,
        spend:         adset.spend,
        ctr:           adset.ctr,
        cpc:           adset.cpc,
        lp_visits:     matching.length,
        scroll_50:     matching.filter(e => e.max_scroll >= 50).length,
        saw_precos:    matching.filter(e => e.sections.includes('precos')).length,
        cta_clicks:    matching.filter(e => e.cta_clicks > 0).length,
        avg_time:      matching.filter(e => (e.time_on_page ?? 0) > 0).length > 0
          ? Math.round(matching.filter(e => (e.time_on_page ?? 0) > 0).reduce((a, e) => a + (e.time_on_page as number), 0) / matching.filter(e => (e.time_on_page ?? 0) > 0).length)
          : null,
      };
    });

    res.json({
      available: true,
      period,
      meta_totals: totals,
      lp_funnel: {
        meta_clicks: totals.clicks,
        lp_visits:   lpVisits,
        scroll_50:   scroll50,
        saw_precos:  sawPrecos,
        cta_clicks:  ctaTotal,
      },
      avg_time: avgTime,
      adsets: adsetRows,
    });
  } catch (err) {
    console.error('getMetaFunnel error:', err);
    res.status(500).json({ error: String(err) });
  }
}

export async function triggerMonthlyReset(req: Request, res: Response): Promise<void> {
  try {
    await runMonthlyReset();
    res.json({ ok: true, message: 'Reset mensal executado com sucesso' });
  } catch (err) {
    console.error('triggerMonthlyReset error:', err);
    res.status(500).json({ error: 'Erro ao executar reset' });
  }
}
