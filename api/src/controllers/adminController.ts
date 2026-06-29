import { Request, Response } from 'express';
import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { runMonthlyReset } from '../services/planService';
import { fetchAdsetInsights, sumTotals, type MetaPeriod } from '../services/metaAdsService';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// price_id → nome do plano. Sincronizado com PLAN_MAP em paymentsController.ts —
// se mudar lá, mudar aqui.
// price_1TKPoS é o PRO antigo (R$47), mantido como alias pra clientes legados
// que ainda assinam por esse preço (ex: comercial@newenergyrssolar.com.br).
const PRICE_TO_PLAN: Record<string, string> = {
  [(process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim()]: 'pro',
  [(process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim()]: 'ilimitado',
  'price_1TKPoSCkkgzQ4IHesK6wi3Qq': 'pro',  // PRO antigo (R$47)
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
  // Status do follow-up de EMAIL (cadência CNPJ — o canal que está ATIVO).
  followup_email_last_sent_at: string | null;
  // Contadores de follow-up (quantos toques cada cadência já deu pro usuário).
  // Alimentam o "contador ao lado de cada um" no painel admin.
  // OBS: carla_* são WhatsApp (canal PAUSADO desde mai/2026 por ban Z-API) —
  // mostram só histórico. O canal vivo é o email (followup_email_last_sent_at).
  carla_inativo_count: number | null;
  carla_sem_cnpj_count: number | null;
  contract_reminder_count: number | null;
};

// Uma mensagem trocada (formato do whatsapp_sessions.messages jsonb).
type ChatMsg = { role: 'user' | 'assistant'; content: string };

export async function getUsers(req: Request, res: Response): Promise<void> {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, plano, documentos_usados, limite_documentos, created_at, is_admin, whatsapp, followup_started_at, followup_email_last_sent_at, carla_inativo_count, carla_sem_cnpj_count, contract_reminder_count')
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

    // Docs com user_id — alimenta a timeline (created_at) E o contador de docs
    // gerados por usuário (base da "temperatura" de conversão no painel).
    const { data: docs } = await supabase
      .from('documents')
      .select('user_id, created_at')
      .order('created_at', { ascending: false });

    const docCountByUser = new Map<string, number>();
    for (const d of docs ?? []) {
      if (d.user_id) docCountByUser.set(d.user_id, (docCountByUser.get(d.user_id) ?? 0) + 1);
    }

    // Temperatura de conversão (só faz sentido pra FREE — alvo de upgrade):
    // 🔥 quente = 3+ docs (engajado, candidato forte) · 🟡 morno = 1-2 · ❄️ frio = 0.
    const temperatura = (plano: string, docs: number): 'quente' | 'morno' | 'frio' | null => {
      if (plano !== 'free') return null;
      if (docs >= 3) return 'quente';
      if (docs >= 1) return 'morno';
      return 'frio';
    };

    // ── Conversas de WhatsApp (whatsapp_sessions, tipo='platform'). ──────────
    // É a conversa REAL trocada com o membro (o que ele escreveu + o que o
    // agente respondeu). Casa com o user por user_id OU por telefone (sufixo de
    // 10 dígitos pra driblar 9º dígito/DDI — ver normalização LimpaPro). O
    // phone-join ~dobra a cobertura (25→43 dos 91 FREE).
    const normFone = (s: string | null | undefined): string => (s ? s.replace(/\D/g, '') : '');
    const sufixo = (s: string): string => (s.length >= 10 ? s.slice(-10) : '');
    const { data: sessions } = await supabase
      .from('whatsapp_sessions')
      .select('user_id, phone, nome, messages, updated_at, tipo')
      .eq('tipo', 'platform');

    const convByUserId = new Map<string, { messages: ChatMsg[]; updated_at: string; nome: string | null }>();
    const convBySufixo = new Map<string, { messages: ChatMsg[]; updated_at: string; nome: string | null }>();
    for (const s of sessions ?? []) {
      const msgs = Array.isArray(s.messages) ? (s.messages as ChatMsg[]) : [];
      if (!msgs.length) continue;
      const entry = { messages: msgs, updated_at: s.updated_at as string, nome: (s.nome as string) ?? null };
      if (s.user_id) convByUserId.set(s.user_id as string, entry);
      const suf = sufixo(normFone(s.phone as string));
      if (suf) convBySufixo.set(suf, entry); // última sessão por sufixo vence (mais recente vinda do select)
    }

    // Resolve a conversa de um user: prioriza match por user_id, cai pro fone.
    const conversaDoUser = (u: UserRow): { messages: ChatMsg[]; updated_at: string } | null => {
      const direct = convByUserId.get(u.id);
      if (direct) return { messages: direct.messages, updated_at: direct.updated_at };
      const suf = sufixo(normFone(u.whatsapp));
      const byFone = suf ? convBySufixo.get(suf) : undefined;
      return byFone ? { messages: byFone.messages, updated_at: byFone.updated_at } : null;
    };

    const result = (users as UserRow[] | null)?.map(u => {
      const stripe = stripeByEmail.get(u.email.toLowerCase());
      const docsGerados = docCountByUser.get(u.id) ?? 0;
      // Total de toques de follow-up que esse usuário já recebeu (soma das cadências).
      const followupWhatsapp =
        (u.carla_inativo_count ?? 0) +
        (u.carla_sem_cnpj_count ?? 0) +
        (u.contract_reminder_count ?? 0);
      // Nº de emails de follow-up enviados: o schema não guarda um contador
      // dedicado, então sinalizamos pelo timestamp do último envio (canal ativo).
      const conversa = conversaDoUser(u);
      return {
        ...u,
        empresa_nome:     companyMap.get(u.id)?.nome     ?? null,
        empresa_cnpj:     companyMap.get(u.id)?.cnpj     ?? null,
        empresa_whatsapp: companyMap.get(u.id)?.whatsapp ?? null,
        stripe_status:    stripe?.status ?? null,
        stripe_plan:      stripe?.plan   ?? null,
        docs_gerados:     docsGerados,
        // followup_toques: mantido por compat (= toques WhatsApp, canal pausado).
        followup_toques:  followupWhatsapp,
        followup_whatsapp_toques: followupWhatsapp,
        // Canal ATIVO: email. Último envio da cadência CNPJ (null = nunca recebeu).
        followup_email_last_sent_at: u.followup_email_last_sent_at ?? null,
        // Conversa real trocada no WhatsApp (null quando não há histórico).
        conversa: conversa ? { mensagens: conversa.messages, atualizada_em: conversa.updated_at } : null,
        temperatura:      temperatura(u.plano, docsGerados),
      };
    });

    // Uso da Calculadora de Precificação (beta). Analytics interno — não
    // consome crédito. Agrega aberturas/cálculos/clientes únicos pro card do admin.
    const { data: calcEvents } = await supabase
      .from('feature_events')
      .select('user_id, event_type')
      .eq('feature', 'precificacao')
      .limit(50000);
    const calcRows = calcEvents ?? [];
    const calculadora = {
      aberturas: calcRows.filter(e => e.event_type === 'open').length,
      calculos:  calcRows.filter(e => e.event_type === 'calc').length,
      clientes:  new Set(calcRows.map(e => e.user_id).filter(Boolean)).size,
    };

    res.json({ users: result, documents: docs ?? [], calculadora });
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

    // 4b) WhatsApp boas-vindas — users criados no período que tiveram a mensagem
    // de boas-vindas/compra (Giovanna) DISPARADA. Forward-only: só conta a partir
    // de jun/2026, quando o registro foi ligado (cadastros antigos têm NULL).
    const { count: whatsappCount } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since.toISOString())
      .not('whatsapp_welcome_sent_at', 'is', null);

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
      // Ordem do fluxo atual: VSL → LP → Stripe (cartão) → WhatsApp → Cadastro → Empresa → Plataforma.
      // O cartão vem ANTES da conta — só cadastra quem passou pelo checkout.
      steps: [
        { key: 'vsl',        label: 'VSL',         count: vslUnique,        sub: `${vslPageviews} pageviews` },
        { key: 'landing',    label: 'Landing',     count: landingUnique,    sub: `${landingPageviews} pageviews` },
        {
          key: 'stripe',
          label: 'Stripe',
          count: stripeReached,
          sub: 'passaram cartão',
          detail: { closed: stripeClosed, byProduct },
        },
        { key: 'whatsapp',   label: 'WhatsApp',    count: whatsappCount ?? 0, sub: 'receberam boas-vindas' },
        { key: 'cadastro',   label: 'Cadastro',    count: cadastros ?? 0,   sub: 'criaram conta' },
        { key: 'empresa',    label: 'Empresa',     count: empresaCount,     sub: 'preencheram CNPJ' },
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
        campaign_id:   adset.campaign_id,
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

// plano → priceId (pra buscar o unit_amount REAL no Stripe). Espelha PLAN_MAP
// do paymentsController. NÃO usar o valorMap do webhook (aquilo é valor de
// evento Meta CAPI, não o preço da assinatura).
const PLAN_TO_PRICE: Record<string, string> = {
  pro:       (process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim(),
  ilimitado: (process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim(),
};

// Busca o valor mensal REAL (em reais) de um plano via Stripe unit_amount,
// cacheando por priceId pra não bater na API a cada usuário.
const _mrrCache = new Map<string, number>();
async function mrrForPlano(plano: string): Promise<number> {
  const priceId = PLAN_TO_PRICE[plano];
  if (!priceId) return 0;
  if (_mrrCache.has(priceId)) return _mrrCache.get(priceId)!;
  try {
    const price = await stripe.prices.retrieve(priceId);
    const reais = (price.unit_amount ?? 0) / 100;
    _mrrCache.set(priceId, reais);
    return reais;
  } catch (err) {
    console.error('mrrForPlano falhou pra', plano, err);
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════
// RECEBIMENTO (Stripe) — acumulado recebido + previsão mês atual / próximo.
// Fonte de verdade: faturas PAGAS do Stripe (recebido) e estado das assinaturas
// (previsão). NUNCA conta plano×preço do banco — os 12 em trial pagaram R$0 e os
// churned podem ter pago 1× e parado; só a fatura PAGA conta como recebido.
//
// Conta Stripe COMPARTILHADA (Pack Solar, etc): tudo é filtrado pelos price IDs
// do SolarDoc (PRO/VIP + PRO antigo R$47 de clientes legados). Mesmo isolamento
// do webhook (paymentsController). Valores em BRUTO (sem deduzir taxa Stripe).
// ════════════════════════════════════════════════════════════════════════

// Set de price IDs que SÃO SolarDoc (mesma fonte do PRICE_TO_PLAN, sem o mapa).
const SOLARDOC_PRICE_IDS = new Set(Object.keys(PRICE_TO_PLAN));

type BillingPayload = {
  recebido_total: number;       // acumulado recebido (bruto, all-time)
  recebido_mes: number;         // recebido dentro do mês corrente (SP)
  previsao_mes: number;         // recebido_mes + o que ainda fatura até o fim do mês
  previsao_proximo_mes: number; // MRR firme das assinaturas ATIVAS (sem trial)
  mrr_ativo: number;            // = previsao_proximo_mes (alias explícito)
  trial_upside: number;         // MRR potencial dos trials (SE converterem) — não somado
  assinaturas_ativas: number;
  trials: number;
  moeda: 'BRL';
  atualizado_em: string;
};

let _billingCache: { at: number; data: BillingPayload } | null = null;
const BILLING_TTL_MS = 60_000;

// Fim do mês corrente em SP (1º dia do mês seguinte 00:00 SP, como instante).
function spStartOfNextMonth(): Date {
  const inicio = spStartOfMonth();
  const d = new Date(inicio);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export async function getBilling(req: Request, res: Response): Promise<void> {
  try {
    if (_billingCache && Date.now() - _billingCache.at < BILLING_TTL_MS) {
      res.json(_billingCache.data);
      return;
    }

    const inicioMes = spStartOfMonth();
    const fimMes = spStartOfNextMonth();
    const inicioMesUnix = Math.floor(inicioMes.getTime() / 1000);
    const fimMesUnix = Math.floor(fimMes.getTime() / 1000);

    // Uma invoice "é SolarDoc" se qualquer linha aponta pra um price do SolarDoc.
    // Retorna o valor SolarDoc dessa fatura (em centavos) — só as linhas nossas,
    // pra não contar Pack Solar de uma fatura mista (raro, mas seguro).
    // Tipagem estrutural leve: o shape de Invoice muda entre versões do SDK, então
    // lemos só os campos que importam (mesmo padrão pragmático do webhook).
    // ATENÇÃO: no SDK 22 / API 2025 o price da linha NÃO é mais `line.price.id`,
    // e sim `line.pricing.price_details.price` (string ID por padrão, sem expand).
    // Lemos os dois (pricing novo + price legado) pra ser robusto entre versões —
    // se errar o caminho, o filtro casa 0 linhas e zera o recebido em SILÊNCIO.
    type LineLite = {
      amount?: number | null;
      pricing?: { price_details?: { price?: string | { id?: string } } } | null;
      price?: { id?: string } | null;
    };
    type InvoiceLite = {
      created: number;
      status_transitions?: { paid_at?: number | null };
      lines?: { data?: LineLite[] };
    };
    const linePriceId = (line: LineLite): string => {
      const p = line.pricing?.price_details?.price;
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') return p.id ?? '';
      return line.price?.id ?? ''; // fallback API antiga
    };
    const solardocAmountCents = (inv: InvoiceLite): number => {
      let cents = 0;
      for (const line of inv.lines?.data ?? []) {
        if (SOLARDOC_PRICE_IDS.has(linePriceId(line))) cents += line.amount ?? 0;
      }
      return cents;
    };

    // ── 1) RECEBIDO: faturas pagas (all-time), paginadas. ──────────────────
    let recebidoTotalCents = 0;
    let recebidoMesCents = 0;
    let cursor: string | undefined;
    for (let page = 0; page < 40; page++) { // teto defensivo (40×100 = 4000 faturas)
      const invoices = await stripe.invoices.list({
        status: 'paid',
        limit: 100,
        starting_after: cursor,
      });
      for (const inv of invoices.data as unknown as InvoiceLite[]) {
        const cents = solardocAmountCents(inv);
        if (cents <= 0) continue; // fatura de outro produto (Pack Solar) → ignora
        recebidoTotalCents += cents;
        const paidAt = inv.status_transitions?.paid_at ?? inv.created;
        if (paidAt >= inicioMesUnix && paidAt < fimMesUnix) recebidoMesCents += cents;
      }
      if (!invoices.has_more) break;
      cursor = invoices.data[invoices.data.length - 1]?.id;
    }

    // ── 2) PREVISÃO: percorre as assinaturas vivas (active + trialing). ────
    let mrrAtivoCents = 0;
    let trialUpsideCents = 0;
    let aFaturarAteFimMesCents = 0; // renovações/1ª cobrança que caem dentro do mês
    let nAtivas = 0;
    let nTrials = 0;
    let subCursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const subs = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        starting_after: subCursor,
        expand: ['data.items.data.price'],
      });
      const nowUnix = Math.floor(Date.now() / 1000);
      for (const s of subs.data) {
        const item = s.items.data[0];
        const priceId = item?.price?.id ?? '';
        if (!SOLARDOC_PRICE_IDS.has(priceId)) continue; // não é SolarDoc
        const valorCents = item?.price?.unit_amount ?? 0;
        // No SDK 22 / API 2025 o current_period_end migrou pro item da assinatura.
        // Fallback no campo legado da sub pra robustez entre versões.
        const periodEnd =
          (item as { current_period_end?: number } | undefined)?.current_period_end ??
          (s as unknown as { current_period_end?: number }).current_period_end ?? 0;

        if (s.status === 'active') {
          mrrAtivoCents += valorCents;
          nAtivas++;
          // Renovação que vence dentro deste mês e ainda não foi faturada hoje:
          // entra na previsão do mês corrente.
          if (periodEnd >= nowUnix && periodEnd < fimMesUnix) {
            aFaturarAteFimMesCents += valorCents;
          }
        } else if (s.status === 'trialing') {
          trialUpsideCents += valorCents;
          nTrials++;
          // Trial que termina dentro do mês → 1ª cobrança cai neste mês (SE não
          // cancelar). Conta como previsão do mês (otimista mas é "previsão").
          const trialEnd = s.trial_end ?? 0;
          if (trialEnd >= nowUnix && trialEnd < fimMesUnix) {
            aFaturarAteFimMesCents += valorCents;
          }
        }
      }
      if (!subs.has_more) break;
      subCursor = subs.data[subs.data.length - 1]?.id;
    }

    const toReais = (c: number) => Math.round(c) / 100;
    const payload: BillingPayload = {
      recebido_total:       toReais(recebidoTotalCents),
      recebido_mes:         toReais(recebidoMesCents),
      previsao_mes:         toReais(recebidoMesCents + aFaturarAteFimMesCents),
      previsao_proximo_mes: toReais(mrrAtivoCents),
      mrr_ativo:            toReais(mrrAtivoCents),
      trial_upside:         toReais(trialUpsideCents),
      assinaturas_ativas:   nAtivas,
      trials:               nTrials,
      moeda:                'BRL',
      atualizado_em:        new Date().toISOString(),
    };

    _billingCache = { at: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    console.error('getBilling error:', err);
    res.status(500).json({ error: 'Erro ao calcular recebimento' });
  }
}

// Receita atribuída por campanha (forward-only). Agrupa usuários PAGANTES
// (plano != free) com atribuição capturada na janela, por utm_campaign EXATO
// (normalizado). NÃO usa o join fuzzy do meta-funnel — aqui é dinheiro, match
// frouxo dobraria receita. O ROAS é calculado no front cruzando com o gasto Meta.
export async function getRevenue(req: Request, res: Response): Promise<void> {
  try {
    const period = (req.query.period as string) || 'maximo';
    const now = new Date();
    let since: Date;
    if (period === 'hoje')        { since = spStartOfToday(); }
    else if (period === 'ontem')  { since = spStartOfYesterday(); }
    else if (period === '3d')     { since = new Date(now.getTime() - 3 * 86400000); }
    else if (period === '7dias')  { since = new Date(now.getTime() - 7 * 86400000); }
    else if (period === 'mes')    { since = spStartOfMonth(); }
    else                          { since = new Date(0); }

    // Pagantes atribuídos na janela. attribution_captured_at é a data do vínculo
    // (não o created_at) — é quando a venda foi atribuída a uma campanha.
    // Exclui suspended: ao cancelar, o plano fica 'pro' mas billing_status vira
    // 'suspended' — sem este filtro, assinatura morta inflaria a receita pra sempre.
    const { data: users, error } = await supabase
      .from('users')
      .select('plano, billing_status, utm_source, utm_campaign, attribution_captured_at')
      .neq('plano', 'free')
      .neq('billing_status', 'suspended')
      .not('attribution_captured_at', 'is', null)
      .gte('attribution_captured_at', since.toISOString());

    if (error) throw error;
    const rows = users ?? [];

    // Resolve o MRR real de cada plano presente (1 fetch por plano, cacheado).
    const planos = Array.from(new Set(rows.map(r => r.plano)));
    const mrrByPlano = new Map<string, number>();
    for (const p of planos) mrrByPlano.set(p, await mrrForPlano(p));

    // Nome legível das campanhas (utm_campaign = ID da campanha Meta). Busca em
    // mm_campanhas pra exibir "Solardoc.App - Lp" em vez do ID cru — mesmo que a
    // campanha não esteja no gasto Meta da janela atual.
    const campIds = Array.from(new Set(rows.map(r => (r.utm_campaign || '').trim()).filter(Boolean)));
    const nameById = new Map<string, string>();
    if (campIds.length) {
      const { data: camps } = await supabase.from('mm_campanhas').select('id, nome').in('id', campIds);
      for (const c of camps ?? []) if (c.nome) nameById.set(String(c.id), c.nome);
    }

    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

    // campaign = ID da campanha Meta (chave do join com o gasto no front).
    // campaign_name = rótulo legível (mm_campanhas), cai no ID se desconhecido.
    const campMap = new Map<string, { campaign: string; campaign_name: string; users: number; mrr: number; plans: Record<string, number> }>();
    const srcMap  = new Map<string, { source: string; users: number; mrr: number }>();
    let totalMrr = 0;

    for (const r of rows) {
      const mrr = mrrByPlano.get(r.plano) ?? 0;
      totalMrr += mrr;

      // Campanha — agrupa pelo ID (utm_campaign), exibe o nome quando conhecido.
      const campKey   = norm(r.utm_campaign);
      const campId    = (r.utm_campaign || '').trim();
      const campName  = nameById.get(campId) || campId;
      const c = campMap.get(campKey) ?? { campaign: campId, campaign_name: campName, users: 0, mrr: 0, plans: {} as Record<string, number> };
      c.users++; c.mrr += mrr; c.plans[r.plano] = (c.plans[r.plano] ?? 0) + 1;
      campMap.set(campKey, c);

      // Origem (utm_source).
      const srcKey   = norm(r.utm_source);
      const srcLabel = (r.utm_source || '').trim();
      const s = srcMap.get(srcKey) ?? { source: srcLabel, users: 0, mrr: 0 };
      s.users++; s.mrr += mrr;
      srcMap.set(srcKey, s);
    }

    res.json({
      period,
      mrr_source: 'stripe_unit_amount',
      total_mrr: totalMrr,
      total_users: rows.length,
      by_campaign: Array.from(campMap.values()).sort((a, b) => b.mrr - a.mrr),
      by_source:   Array.from(srcMap.values()).sort((a, b) => b.mrr - a.mrr),
    });
  } catch (err) {
    console.error('getRevenue error:', err);
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
