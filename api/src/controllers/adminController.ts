import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { runMonthlyReset } from '../services/planService';
import { fetchAdsetInsights, sumTotals, type MetaPeriod } from '../services/metaAdsService';

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

    const result = users?.map(u => ({
      ...u,
      empresa_nome:          companyMap.get(u.id)?.nome     ?? null,
      empresa_cnpj:          companyMap.get(u.id)?.cnpj     ?? null,
      empresa_whatsapp:      companyMap.get(u.id)?.whatsapp ?? null,
      followup_started_at:   (u as any).followup_started_at   ?? null,
      followup_day_recovered:(u as any).followup_day_recovered ?? null,
    }));

    res.json({ users: result });
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

export async function getAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 500);

    // Busca visitas recentes
    const { data: visits, error: vErr } = await supabase
      .from('page_visits')
      .select('*')
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
      cta_clicks: Array<{ label?: string; href?: string }>;
      time_on_page: number | null;
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
      const ctaClicks = ctaEvts.map(e => e.event_data as { label?: string; href?: string });

      const timeEvt = sevents.find(e => e.event_type === 'time_on_page');
      const timeOnPage = timeEvt
        ? Number((timeEvt.event_data as { seconds?: number })?.seconds ?? null)
        : null;

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

  const period = (req.query.period as string) || 'today';
  const metaPeriod: MetaPeriod =
    period === '7d'  ? 'last_7d'  :
    period === '30d' ? 'last_30d' : 'today';

  // Janela de datas para filtrar a LP
  const now   = new Date();
  let since: Date;
  if (period === '7d')       since = new Date(now.getTime() - 7  * 86400000);
  else if (period === '30d') since = new Date(now.getTime() - 30 * 86400000);
  else { since = new Date(now); since.setHours(0, 0, 0, 0); }

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
