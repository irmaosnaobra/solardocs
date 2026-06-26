'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import styles from './admin.module.css';
import FunilSolarDocPanel from './_components/FunilSolarDocPanel';
import FunilLimpaproPanel from './_components/FunilLimpaproPanel';
import MembrosPanel from './_components/MembrosPanel';
import TrafegoPanel from './_components/TrafegoPanel';

/* ─── tipos ─────────────────────────────────────────────────── */
interface SessionRow {
  session_id: string | null; created_at: string;
  utm_source: string | null; utm_medium: string | null;
  utm_campaign: string | null; utm_content: string | null;
  referrer: string | null; landing_url: string | null;
  user_agent: string | null; ip: string | null;
  max_scroll: number; sections_seen: string[];
  cta_clicks: Array<{ label?: string; href?: string; plan?: string; step?: number }>;
  time_on_page: number | null;
  max_step?: number;        // simulador: maior step alcançado (1-4)
  sim_abandon?: boolean;    // simulador: abandonou sem chegar ao resultado
}
interface SourceRow { source: string; visits: number; scroll_50: number; saw_precos: number; cta_clicks: number; }
interface CtaRow    { label: string; count: number; }
interface Analytics {
  total: number; today: number; avg_time: number | null;
  funnel: { visits: number; scroll_50: number; saw_precos: number; cta_clicks: number };
  conversion: { cadastros: number; empresas: number; assinantes: number };
  sources: SourceRow[]; top_ctas: CtaRow[]; sessions: SessionRow[];
}
interface MetaAdsetRow {
  adset_id: string; adset_name: string; campaign_id?: string; campaign_name: string;
  impressions: number; reach: number; clicks: number;
  spend: number; ctr: number; cpc: number;
  lp_visits: number; scroll_50: number; saw_precos: number;
  cta_clicks: number; avg_time: number | null;
}
interface MetaTotals { impressions: number; reach: number; clicks: number; spend: number; ctr: number; cpc: number; purchases: number; }
interface MetaFunnelData {
  available: boolean; reason?: string; period?: string;
  meta_totals?: MetaTotals;
  lp_funnel?: { meta_clicks: number; lp_visits: number; scroll_50: number; saw_precos: number; cta_clicks: number };
  avg_time?: number | null;
  adsets?: MetaAdsetRow[];
}
/* Receita atribuída por campanha (GET /admin/revenue) — vínculo forward-only UTM→Stripe. */
interface RevenueCampaignRow {
  campaign: string; campaign_name?: string; users: number; mrr: number; plans: Record<string, number>;
}
interface RevenueSourceRow { source: string; users: number; mrr: number; }
interface RevenueData {
  period: string; total_mrr: number; total_users: number;
  mrr_source: string;
  by_campaign: RevenueCampaignRow[];
  by_source: RevenueSourceRow[];
}

/* ─── helpers ────────────────────────────────────────────────── */
import { toBrasilia, fmtDateBR, daysDiffBR } from '@/utils/brasilia';

function relDate(d: string) {
  const diff = daysDiffBR(d);
  const s    = toBrasilia(d);
  const hh   = String(s.getUTCHours()).padStart(2,'0');
  const mm   = String(s.getUTCMinutes()).padStart(2,'0');
  const time = `${hh}:${mm}`;
  const date = fmtDateBR(d);
  let label: string; let color: string;
  if (diff === 0)      { label = 'HOJE';         color = 'var(--color-text)'; }
  else if (diff === 1) { label = 'ONTEM';        color = 'var(--color-text)'; }
  else if (diff <= 7)  { label = `${diff} DIAS`; color = 'var(--color-text-muted)'; }
  else                 { label = date;            color = 'var(--color-text-muted)'; }
  return { label, color, time, showTime: diff <= 7 };
}
function srcLabel(s: SessionRow) {
  if (s.utm_source) return s.utm_source;
  if (s.referrer) { try { return new URL(s.referrer).hostname.replace('www.',''); } catch { return s.referrer; } }
  return 'Direto';
}
function deviceIcon(ua: string | null) { return !ua ? '—' : /Mobile|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop'; }
function fmtTime(sec: number | null | undefined) {
  if (sec == null || sec <= 0) return '—';
  return sec < 60 ? `${sec}s` : `${Math.floor(sec/60)}m${sec%60>0?` ${sec%60}s`:''}`;
}
function pct(n: number, total: number) { return !total ? '—' : `${Math.round(n/total*100)}%`; }
function fmtBRL(val: number) { return val.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2}); }
function fmtNum(n: number) { return n.toLocaleString('pt-BR'); }

const PLANO_LABEL: Record<string,string> = { free:'FREE', pro:'PRO', ilimitado:'VIP' };
const PLANO_COLOR: Record<string,string> = { free:'#64748b', pro:'#64748b', ilimitado:'#64748b' };

/* ─── componente funil SVG (estilo UTMify) ───────────────────── */
interface FunnelStep { label: string; value: number; sub?: string; }

function FunnelSVG({ steps }: { steps: FunnelStep[] }) {
  if (!steps.length) return null;
  const W = 900, H = 200;
  const colW = W / steps.length;
  const maxV = steps[0].value || 1;

  const heights = steps.map(s => Math.max(24, Math.round((s.value / maxV) * H * 0.88)));
  const xs      = steps.map((_, i) => i * colW + colW / 2);
  const tops    = heights.map(h => (H - h) / 2);
  const bots    = heights.map(h => (H + h) / 2);

  // Build smooth bezier path
  let topD = `M 0 ${tops[0]} L ${xs[0]} ${tops[0]}`;
  for (let i = 0; i < steps.length - 1; i++) {
    const mx = (xs[i] + xs[i+1]) / 2;
    topD += ` C ${mx} ${tops[i]}, ${mx} ${tops[i+1]}, ${xs[i+1]} ${tops[i+1]}`;
  }
  topD += ` L ${W} ${tops[steps.length-1]}`;

  let botD = `L ${W} ${bots[steps.length-1]} L ${xs[steps.length-1]} ${bots[steps.length-1]}`;
  for (let i = steps.length - 2; i >= 0; i--) {
    const mx = (xs[i] + xs[i+1]) / 2;
    botD += ` C ${mx} ${bots[i+1]}, ${mx} ${bots[i]}, ${xs[i]} ${bots[i]}`;
  }
  botD += ` L 0 ${bots[0]} Z`;

  const gradId = `fg_${Math.random().toString(36).slice(2,6)}`;

  return (
    <div className={styles.svgFunnelWrap}>
      {/* Labels topo */}
      <div className={styles.svgFunnelLabels}>
        {steps.map((s, i) => (
          <div key={i} className={styles.svgFunnelLabelCol}>
            <span className={styles.svgFunnelLabelText}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* SVG */}
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svgFunnelSvg} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#F26513" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#9C3A06" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {/* Funil preenchido */}
        <path d={`${topD} ${botD}`} fill={`url(#${gradId})`} />

        {/* Divisórias verticais entre etapas */}
        {steps.slice(1).map((_, i) => {
          const x = (i + 1) * colW;
          return <line key={i} x1={x} y1={0} x2={x} y2={H} stroke="rgba(0,0,0,0.2)" strokeWidth="1" strokeDasharray="4 3" />;
        })}

        {/* Percentual dentro do funil */}
        {steps.map((s, i) => {
          const pctVal = i === 0 ? 100 : Math.round(s.value / maxV * 100);
          const midY   = H / 2;
          const visible = heights[i] > 32;
          return visible ? (
            <text key={i} x={xs[i]} y={midY + 6} textAnchor="middle"
              fill="white" fontSize="15" fontWeight="700" style={{ fontFamily: 'inherit' }}>
              {pctVal}%
            </text>
          ) : null;
        })}
      </svg>

      {/* Valores em baixo */}
      <div className={styles.svgFunnelValues}>
        {steps.map((s, i) => {
          const convFromFirst = i === 0 ? null : Math.round(s.value / maxV * 100);
          return (
            <div key={i} className={styles.svgFunnelValueCol}>
              <span className={styles.svgFunnelCount}>{fmtNum(s.value)}</span>
              {s.sub && <span className={styles.svgFunnelSub}>{s.sub}</span>}
              {convFromFirst !== null && (
                <span className={`${styles.svgFunnelConv} ${convFromFirst < 20 ? styles.convLow : convFromFirst < 50 ? styles.convMid : styles.convHigh}`}>
                  ↓ {convFromFirst}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── página principal ───────────────────────────────────────── */
export default function AdminPage() {
  const [tab, setTab] = useState<'visits'|'receita'|'io_visits'|'pack_visits'|'funil_solardoc'|'funil_limpapro'|'membros'|'trafego'>('membros');

  const [analytics, setAnalytics]               = useState<Analytics|null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded]   = useState(false);

  const [metaData, setMetaData]           = useState<MetaFunnelData|null>(null);
  const [loadingMeta, setLoadingMeta]     = useState(false);
  const [visitPeriod, setVisitPeriod]     = useState<'hoje'|'ontem'|'3d'|'7dias'|'mes'|'maximo'>('7dias');
  const [metaLoaded, setMetaLoaded]       = useState(false);

  const [revenue, setRevenue]             = useState<RevenueData|null>(null);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [revenueLoaded, setRevenueLoaded] = useState(false);

  const loadAnalytics = useCallback((p?: string) => {
    setLoadingAnalytics(true);
    const qp = p || visitPeriod;
    api.get(`/admin/analytics?limit=300&period=${qp}`).then(r=>{setAnalytics(r.data);setAnalyticsLoaded(true);}).catch(()=>{}).finally(()=>setLoadingAnalytics(false));
  }, [visitPeriod]);

  const loadMeta = useCallback((p?: string) => {
    setLoadingMeta(true);
    const qp = p || visitPeriod;
    api.get(`/admin/meta-funnel?period=${qp}`).then(r=>{setMetaData(r.data);setMetaLoaded(true);}).catch(()=>{}).finally(()=>setLoadingMeta(false));
  }, [visitPeriod]);

  const loadRevenue = useCallback((p?: string) => {
    setLoadingRevenue(true);
    const qp = p || visitPeriod;
    api.get(`/admin/revenue?period=${qp}`).then(r=>{setRevenue(r.data);setRevenueLoaded(true);}).catch(()=>{}).finally(()=>setLoadingRevenue(false));
  }, [visitPeriod]);

  useEffect(() => { if (tab==='visits' && !analyticsLoaded) loadAnalytics(visitPeriod); }, [tab,analyticsLoaded,loadAnalytics,visitPeriod]);
  useEffect(() => { if (tab==='visits' && !metaLoaded) loadMeta(visitPeriod); }, [tab,metaLoaded,visitPeriod,loadMeta]);
  useEffect(() => { if ((tab==='io_visits'||tab==='pack_visits') && !analyticsLoaded) loadAnalytics(visitPeriod); }, [tab,analyticsLoaded,loadAnalytics,visitPeriod]);
  // Receita precisa do gasto Meta (meta-funnel) pra calcular ROAS → carrega os dois.
  useEffect(() => { if (tab==='receita' && !revenueLoaded) loadRevenue(visitPeriod); }, [tab,revenueLoaded,loadRevenue,visitPeriod]);
  useEffect(() => { if (tab==='receita' && !metaLoaded) loadMeta(visitPeriod); }, [tab,metaLoaded,visitPeriod,loadMeta]);

  function changeVisitPeriod(p: 'hoje'|'ontem'|'3d'|'7dias'|'mes'|'maximo') {
    setVisitPeriod(p);
    setMetaLoaded(false);
    setAnalyticsLoaded(false);
    setRevenueLoaded(false);
    loadMeta(p);
    loadAnalytics(p);
    loadRevenue(p);
  }

  const baseSessions = (analytics?.sessions??[]);

  const mt  = metaData?.meta_totals;
  const lpf = metaData?.lp_funnel;

  // Dados do funil SVG Meta → LP
  const funnelSteps: FunnelStep[] = (metaData?.available && mt && lpf) ? [
    { label: 'Impressões',    value: mt.impressions,   sub: fmtBRL(mt.spend > 0 ? mt.spend/mt.impressions*1000 : 0)+' CPM' },
    { label: 'Alcance',       value: mt.reach },
    { label: 'Cliques Meta',  value: mt.clicks,        sub: mt.ctr.toFixed(2)+'% CTR' },
    { label: 'Visitas LP',    value: lpf.lp_visits,    sub: lpf.lp_visits > 0 ? fmtBRL(mt.spend/lpf.lp_visits)+'/vis.' : undefined },
    { label: 'Scroll 50%',    value: lpf.scroll_50 },
    { label: 'Viu Preços',    value: lpf.saw_precos },
    { label: 'Clicou CTA',    value: lpf.cta_clicks,   sub: lpf.cta_clicks > 0 ? fmtBRL(mt.spend/lpf.cta_clicks)+'/CTA' : undefined },
  ] : [];

  // Métricas financeiras derivadas
  const metaFinCards = (metaData?.available && mt && lpf) ? [
    { label: 'Gasto total',      value: fmtBRL(mt.spend),                                    color: 'var(--color-primary)' },
    { label: 'CPC',              value: fmtBRL(mt.cpc),                                      color: 'var(--color-text)' },
    { label: 'CPM',              value: mt.impressions>0?fmtBRL(mt.spend/mt.impressions*1000):'—', color: 'var(--color-text)' },
    { label: 'Custo / visita LP',value: lpf.lp_visits>0?fmtBRL(mt.spend/lpf.lp_visits):'—', color: 'var(--color-text)' },
    { label: 'Custo / Preços',   value: lpf.saw_precos>0?fmtBRL(mt.spend/lpf.saw_precos):'—',color: 'var(--color-text)' },
    { label: 'Custo / CTA',      value: lpf.cta_clicks>0?fmtBRL(mt.spend/lpf.cta_clicks):'—',color: 'var(--color-text)' },
    { label: 'CTR',              value: mt.ctr.toFixed(2)+'%',                               color: 'var(--color-text)' },
    { label: 'Taxa LP→Preços',   value: pct(lpf.saw_precos, lpf.lp_visits),                  color: 'var(--color-text)' },
    { label: 'Taxa LP→CTA',      value: pct(lpf.cta_clicks, lpf.lp_visits),                  color: 'var(--color-text)' },
    { label: 'Taxa Click→LP',    value: pct(lpf.lp_visits, mt.clicks),                       color: 'var(--color-text)' },
    { label: 'Tempo médio LP',   value: fmtTime(metaData?.avg_time),                         color: 'var(--color-text-muted)' },
    { label: 'Impressões',       value: fmtNum(mt.impressions),                              color: 'var(--color-text)' },
  ] : [];

  return (
    <div className={styles.page}>
      <div className={styles.header} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <h1 className={styles.title}>Tráfego &amp; Receita</h1>
          <p className={styles.subtitle}>Aquisição por campanha — visitas, funil e retorno do investimento</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {tab==='io_visits' && (
            <a href="/io" target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{textDecoration:'none'}}>↗ Abrir Site /io</a>
          )}
          {/* Funis e Membros têm seu próprio botão Atualizar e não usam o período
              compartilhado (analytics/meta) — o refresh global não vale ali. */}
          {tab!=='funil_solardoc' && tab!=='funil_limpapro' && tab!=='membros' && (
            <button className="btn-secondary" disabled={loadingAnalytics||loadingMeta}
              onClick={()=>{setAnalyticsLoaded(false);setMetaLoaded(false);loadAnalytics();loadMeta();}}>
              {(loadingAnalytics||loadingMeta)?'Atualizando...':'Atualizar'}
            </button>
          )}
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={tab==='membros'?styles.tabActive:styles.tab} onClick={()=>setTab('membros')}>Membros</button>
        <button className={tab==='trafego'?styles.tabActive:styles.tab} onClick={()=>setTab('trafego')}>📈 Tráfego Pago</button>
        <button className={tab==='visits'?styles.tabActive:styles.tab} onClick={()=>setTab('visits')}>LP SolarDoc</button>
        {/* Aba Receita / ROAS ocultada — bloco e fetch mantidos abaixo, só removido o botão de navegação. */}
        {/* <button className={tab==='receita'?styles.tabActive:styles.tab} onClick={()=>setTab('receita')}>Receita / ROAS</button> */}
        <button className={tab==='io_visits'?styles.tabActive:styles.tab} onClick={()=>setTab('io_visits')}>LP IO</button>
        <button className={tab==='pack_visits'?styles.tabActive:styles.tab} onClick={()=>setTab('pack_visits')}>LP Pack</button>
        <button className={tab==='funil_solardoc'?styles.tabActive:styles.tab} onClick={()=>setTab('funil_solardoc')}>Funil SolarDoc</button>
        <button className={tab==='funil_limpapro'?styles.tabActive:styles.tab} onClick={()=>setTab('funil_limpapro')}>Funil LimpaPro</button>
      </div>

      {/* ═══ ABA ACESSOS SITE IO ════════════════════════════════ */}
      {tab === 'io_visits' && (() => {
        const ioSessions = baseSessions.filter(s => (s.landing_url || '').includes('/io'));
        const visits     = ioSessions.length;
        const ctaTotal   = ioSessions.filter(s => (s.cta_clicks?.length||0) > 0).length;
        const ctaHero    = ioSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('hero'))).length;
        const ctaWhats   = ioSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('whats'))).length;
        const formSubmit = ioSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('contact_form'))).length;

        // Funil IO: Acessou → CTA hero → Clicou WhatsApp
        const ioFunnel: FunnelStep[] = [
          { label: 'Acessou /io',     value: visits },
          { label: 'CTA Hero',        value: ctaHero },
          { label: 'Clicou WhatsApp', value: ctaWhats },
        ];

        // Top origens
        const srcMap = new Map<string, { visits: number; scroll: number; whats: number; cta: number }>();
        ioSessions.forEach(s => {
          const src = srcLabel(s);
          const cur = srcMap.get(src) ?? { visits: 0, scroll: 0, whats: 0, cta: 0 };
          cur.visits++;
          if ((s.max_scroll||0) >= 50) cur.scroll++;
          if (s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('whats'))) cur.whats++;
          if ((s.cta_clicks?.length||0) > 0) cur.cta++;
          srcMap.set(src, cur);
        });
        const sources = Array.from(srcMap.entries())
          .map(([source, v]) => ({ source, ...v }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 8);

        // Top campanhas UTM
        const campMap = new Map<string, number>();
        ioSessions.forEach(s => {
          if (s.utm_campaign) campMap.set(s.utm_campaign, (campMap.get(s.utm_campaign) ?? 0) + 1);
        });
        const campaigns = Array.from(campMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6);

        return (
          <>
            <div className={styles.filters} style={{marginTop:16, marginBottom:24, alignItems:'center', background:'var(--color-bg-elevated)', padding:'12px 16px', borderRadius:8}}>
              <div className={styles.periodTabs}>
                {([['hoje','Hoje'],['ontem','Ontem'],['3d','3 dias'],['7dias','7 dias'],['mes','Esse mês'],['maximo','Máximo']] as const).map(([v,l])=>(
                  <button key={v} className={visitPeriod===v?styles.periodActive:styles.periodBtn} onClick={()=>changeVisitPeriod(v as any)} disabled={loadingAnalytics}>{l}</button>
                ))}
              </div>
              <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>{visits} acessos no <code>/io</code> · {baseSessions.length} totais</span>
            </div>

            {loadingAnalytics ? (
              <div className={styles.loading}>Carregando estatísticas...</div>
            ) : visits === 0 ? (
              <div className={styles.loading} style={{textAlign:'center', padding:'48px 24px'}}>
                <div style={{fontWeight:700, marginBottom:6}}>Sem acessos registrados ainda</div>
                <div style={{fontSize:13, color:'var(--color-text-muted)'}}>Os dados aparecem aqui depois que alguém visita <code>/io</code>. O Meta Pixel também já está capturando, ver no <a href="https://business.facebook.com/events_manager2/list/pixel/446093469730871/overview" target="_blank" rel="noopener noreferrer" style={{color:'var(--color-primary)'}}>Gerenciador de Eventos</a>.</div>
              </div>
            ) : (
              <>
                {/* Cards primários — conversão */}
                <div className={styles.cards} style={{gridTemplateColumns:'repeat(5,1fr)', marginTop: 12}}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Acessos no /io</div>
                    <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{visits}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Clicou alguma CTA ({pct(ctaTotal, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaTotal}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>CTA Hero ({pct(ctaHero, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaHero}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Cliques WhatsApp ({pct(ctaWhats, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaWhats}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Form contato</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{formSubmit}</div>
                  </div>
                </div>

                {/* Funil SVG */}
                <div style={{marginTop:24, background:'var(--color-bg-elevated)', borderRadius:8, padding:'18px 16px 8px'}}>
                  <div style={{fontSize:13, fontWeight:700, color:'var(--color-text)', marginBottom:12}}>Funil do /io</div>
                  <FunnelSVG steps={ioFunnel} />
                </div>

                {/* Origens + Campanhas lado a lado */}
                <div className={styles.twoCol} style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:24}}>
                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Top origens</div>
                    <table className={styles.table}>
                      <thead><tr><th>Origem</th><th>Visitas</th><th>Scroll</th><th>CTA</th><th>WhatsApp</th></tr></thead>
                      <tbody>
                        {sources.map(s => (
                          <tr key={s.source}>
                            <td style={{fontWeight:600}}>{s.source}</td>
                            <td className={styles.mutedCell}>{s.visits}</td>
                            <td className={styles.mutedCell}>{s.scroll} ({pct(s.scroll, s.visits)})</td>
                            <td className={styles.mutedCell}>{s.cta} ({pct(s.cta, s.visits)})</td>
                            <td className={styles.mutedCell}>{s.whats} ({pct(s.whats, s.visits)})</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Top campanhas (UTM)</div>
                    <table className={styles.table}>
                      <thead><tr><th>Campanha</th><th>Visitas</th></tr></thead>
                      <tbody>
                        {campaigns.length === 0 ? (
                          <tr><td colSpan={2} className={styles.mutedCell} style={{textAlign:'center',padding:'18px 8px'}}>Sem UTMs registradas</td></tr>
                        ) : campaigns.map(c => (
                          <tr key={c.name}>
                            <td style={{fontWeight:600}}>{c.name}</td>
                            <td className={styles.mutedCell}>{c.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Tabela de sessões */}
                <div className={styles.tableWrap} style={{marginTop:24}}>
                  <table className={styles.table}>
                    <thead><tr>
                      <th>Quando</th>
                      <th>Origem</th>
                      <th>Campanha</th>
                      <th>Dispositivo</th>
                      <th>Página</th>
                      <th>Scroll</th>
                      <th>Tempo</th>
                      <th>CTAs</th>
                    </tr></thead>
                    <tbody>
                      {ioSessions.slice(0, 80).map((s, i) => {
                        const r = relDate(s.created_at);
                        const ctaLabels = (s.cta_clicks ?? []).map(c => c.label).filter(Boolean).join(', ');
                        let pageLabel = '/io';
                        try {
                          if (s.landing_url) {
                            const u = new URL(s.landing_url);
                            pageLabel = u.pathname || '/io';
                          }
                        } catch {}
                        return (
                          <tr key={s.session_id || i}>
                            <td>
                              <div style={{display:'flex',flexDirection:'column',gap:2}}>
                                <span style={{fontWeight:600,fontSize:12,color:r.color}}>{r.label}</span>
                                {r.showTime && <span style={{fontSize:11,color:'var(--color-text-muted)'}}>{r.time}</span>}
                              </div>
                            </td>
                            <td className={styles.mutedCell}>{srcLabel(s)}</td>
                            <td className={styles.mutedCell}>{s.utm_campaign || <span className={styles.emptyDash}>—</span>}</td>
                            <td className={styles.mutedCell}>{deviceIcon(s.user_agent)}</td>
                            <td className={styles.mutedCell}><code style={{fontSize:11}}>{pageLabel}</code></td>
                            <td className={styles.mutedCell}>{s.max_scroll ? `${s.max_scroll}%` : '—'}</td>
                            <td className={styles.mutedCell}>{fmtTime(s.time_on_page)}</td>
                            <td className={styles.mutedCell} style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={ctaLabels || ''}>
                              {ctaLabels || <span className={styles.emptyDash}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ═══ ABA LP SOLARDOC ════════════════════════════════════ */}
      {tab === 'visits' && (() => {
        const lpSessions = baseSessions.filter(s => !(s.landing_url||'').includes('/io'));
        const visits     = lpSessions.length;
        const sawPrecos  = lpSessions.filter(s => s.sections_seen?.includes('precos')).length;
        const ctaTotal   = lpSessions.filter(s => (s.cta_clicks?.length||0) > 0).length;
        const ctaPro     = lpSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('pro'))).length;
        const ctaVip     = lpSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('vip'))).length;

        // Funil LP (sem Scroll): Acessou → Viu Preços → Clicou CTA
        const lpFunnel: FunnelStep[] = [
          { label: 'Acessou LP',  value: visits },
          { label: 'Viu Preços',  value: sawPrecos },
          { label: 'Clicou CTA',  value: ctaTotal },
        ];

        // Top origens
        const srcMap = new Map<string, { visits: number; scroll: number; precos: number; cta: number }>();
        lpSessions.forEach(s => {
          const src = srcLabel(s);
          const cur = srcMap.get(src) ?? { visits: 0, scroll: 0, precos: 0, cta: 0 };
          cur.visits++;
          if ((s.max_scroll||0) >= 50) cur.scroll++;
          if (s.sections_seen?.includes('precos')) cur.precos++;
          if ((s.cta_clicks?.length||0) > 0) cur.cta++;
          srcMap.set(src, cur);
        });
        const sources = Array.from(srcMap.entries())
          .map(([source, v]) => ({ source, ...v }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 8);

        // Top campanhas UTM
        const campMap = new Map<string, number>();
        lpSessions.forEach(s => {
          if (s.utm_campaign) campMap.set(s.utm_campaign, (campMap.get(s.utm_campaign) ?? 0) + 1);
        });
        const campaigns = Array.from(campMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6);

        return (
        <>
          <div className={styles.filters} style={{marginTop:16, marginBottom:24, alignItems:'center', background:'var(--color-bg-elevated)', padding:'12px 16px', borderRadius:8}}>
            <div className={styles.periodTabs}>
              {([['hoje','Hoje'],['ontem','Ontem'],['3d','3 dias'],['7dias','7 dias'],['mes','Esse mês'],['maximo','Máximo']] as const).map(([v,l])=>(
                <button
                  key={v}
                  className={visitPeriod===v?styles.periodActive:styles.periodBtn}
                  onClick={()=>changeVisitPeriod(v as any)}
                  disabled={loadingMeta || loadingAnalytics}
                >
                  {l}
                </button>
              ))}
            </div>
            <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>{visits} acessos em <code>solardoc.app</code></span>
          </div>

          {loadingAnalytics ? (
            <div className={styles.loading}>Carregando estatísticas...</div>
          ) : visits === 0 ? (
            <div className={styles.loading} style={{textAlign:'center', padding:'48px 24px'}}>
              <div style={{fontWeight:700, marginBottom:6}}>Sem acessos no período</div>
              <div style={{fontSize:13, color:'var(--color-text-muted)'}}>Trocar o filtro acima ou aguardar novo tráfego em <code>solardoc.app</code>.</div>
            </div>
          ) : (
            <>
              {/* Cards primários — funil de conversão */}
              <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)', marginTop: 12}}>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Acessaram a LP</div>
                  <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{visits}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicou alguma CTA ({pct(ctaTotal, visits)})</div>
                  <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaTotal}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicaram PRO</div>
                  <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaPro}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicaram VIP</div>
                  <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaVip}</div>
                </div>
              </div>

              {/* Funil SVG */}
              <div style={{marginTop:24, background:'var(--color-bg-elevated)', borderRadius:8, padding:'18px 16px 8px'}}>
                <div style={{fontSize:13, fontWeight:700, color:'var(--color-text)', marginBottom:12}}>Funil da LP</div>
                <FunnelSVG steps={lpFunnel} />
              </div>

              {/* Origens + Campanhas lado a lado */}
              <div className={styles.twoCol} style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:24}}>
                <div className={styles.tableWrap}>
                  <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Top origens</div>
                  <table className={styles.table}>
                    <thead><tr><th>Origem</th><th>Visitas</th><th>Scroll</th><th>Preços</th><th>CTA</th></tr></thead>
                    <tbody>
                      {sources.map(s => (
                        <tr key={s.source}>
                          <td style={{fontWeight:600}}>{s.source}</td>
                          <td className={styles.mutedCell}>{s.visits}</td>
                          <td className={styles.mutedCell}>{s.scroll} ({pct(s.scroll, s.visits)})</td>
                          <td className={styles.mutedCell}>{s.precos} ({pct(s.precos, s.visits)})</td>
                          <td className={styles.mutedCell}>{s.cta} ({pct(s.cta, s.visits)})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.tableWrap}>
                  <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Top campanhas (UTM)</div>
                  <table className={styles.table}>
                    <thead><tr><th>Campanha</th><th>Visitas</th></tr></thead>
                    <tbody>
                      {campaigns.length === 0 ? (
                        <tr><td colSpan={2} className={styles.mutedCell} style={{textAlign:'center',padding:'18px 8px'}}>Sem UTMs registradas</td></tr>
                      ) : campaigns.map(c => (
                        <tr key={c.name}>
                          <td style={{fontWeight:600}}>{c.name}</td>
                          <td className={styles.mutedCell}>{c.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tabela de sessões */}
              <div className={styles.tableWrap} style={{marginTop:24}}>
                <table className={styles.table}>
                  <thead><tr>
                    <th>Quando</th>
                    <th>Origem</th>
                    <th>Campanha</th>
                    <th>Dispositivo</th>
                    <th>Scroll</th>
                    <th>Tempo</th>
                    <th>CTAs</th>
                  </tr></thead>
                  <tbody>
                    {lpSessions.slice(0, 80).map((s, i) => {
                      const r = relDate(s.created_at);
                      const ctaLabels = (s.cta_clicks ?? []).map(c => c.label).filter(Boolean).join(', ');
                      return (
                        <tr key={s.session_id || i}>
                          <td>
                            <div style={{display:'flex',flexDirection:'column',gap:2}}>
                              <span style={{fontWeight:600,fontSize:12,color:r.color}}>{r.label}</span>
                              {r.showTime && <span style={{fontSize:11,color:'var(--color-text-muted)'}}>{r.time}</span>}
                            </div>
                          </td>
                          <td className={styles.mutedCell}>{srcLabel(s)}</td>
                          <td className={styles.mutedCell}>{s.utm_campaign || <span className={styles.emptyDash}>—</span>}</td>
                          <td className={styles.mutedCell}>{deviceIcon(s.user_agent)}</td>
                          <td className={styles.mutedCell}>{s.max_scroll ? `${s.max_scroll}%` : '—'}</td>
                          <td className={styles.mutedCell}>{fmtTime(s.time_on_page)}</td>
                          <td className={styles.mutedCell} style={{maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={ctaLabels || ''}>
                            {ctaLabels || <span className={styles.emptyDash}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
        );
      })()}

      {/* Aba sim_visits removida — funil /io/simular descontinuado */}

      {/* ═══ ABA RECEITA / ROAS ═════════════════════════════════ */}
      {tab === 'receita' && (() => {
        const loading = loadingRevenue || loadingMeta;
        const rows    = revenue?.by_campaign ?? [];

        // O utm_campaign que a Meta injeta na URL é o ID da campanha ({{campaign.id}}),
        // não o nome. Então cruzamos gasto×receita por campaign_id (ID↔ID), e usamos
        // o campaign_name dos adsets só pra exibir um rótulo legível na tabela.
        const spendById = new Map<string, number>();
        const nameById  = new Map<string, string>();
        (metaData?.adsets ?? []).forEach(a => {
          const id = (a.campaign_id || '').trim();
          if (!id) return;
          spendById.set(id, (spendById.get(id) ?? 0) + (a.spend || 0));
          if (a.campaign_name) nameById.set(id, a.campaign_name);
        });
        const metaAvailable = !!metaData?.available;

        const joined = rows.map(r => {
          const id    = (r.campaign || '').trim();
          const spend = spendById.get(id) ?? 0;
          const roas  = spend > 0 ? r.mrr / spend : null;
          // Nome legível: o backend (mm_campanhas) tem prioridade; cai pro nome do
          // gasto da janela, e por último o ID cru.
          const label = r.campaign_name || nameById.get(id) || r.campaign;
          return { ...r, label, spend, roas };
        }).sort((a, b) => b.mrr - a.mrr);

        const totalMrr   = revenue?.total_mrr ?? 0;
        const totalSpend = joined.reduce((acc, r) => acc + r.spend, 0);
        const totalRoas  = totalSpend > 0 ? totalMrr / totalSpend : null;
        const payingUsers = revenue?.total_users ?? 0;

        return (
          <>
            <div className={styles.filters} style={{marginTop:16, marginBottom:24, alignItems:'center', background:'var(--color-bg-elevated)', padding:'12px 16px', borderRadius:8}}>
              <div className={styles.periodTabs}>
                {([['hoje','Hoje'],['ontem','Ontem'],['3d','3 dias'],['7dias','7 dias'],['mes','Esse mês'],['maximo','Máximo']] as const).map(([v,l])=>(
                  <button key={v} className={visitPeriod===v?styles.periodActive:styles.periodBtn} onClick={()=>changeVisitPeriod(v as any)} disabled={loading}>{l}</button>
                ))}
              </div>
              <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>
                ROAS = MRR novo no período ÷ gasto Meta no período · atribuição forward-only
              </span>
            </div>

            {/* Aviso forward-only — a atribuição só conta checkouts NOVOS (pós-implementação). */}
            <div style={{background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-muted)', borderRadius:8, padding:'10px 14px', marginBottom:20, fontSize:12, lineHeight:1.5}}>
              A receita por campanha é <strong>forward-only</strong>: só aparece para checkouts feitos depois que a atribuição UTM→Stripe foi ligada. Compras antigas não têm a origem salva e não entram aqui.
            </div>

            {loading ? (
              <div className={styles.loading}>Carregando receita...</div>
            ) : payingUsers === 0 ? (
              <div className={styles.loading} style={{textAlign:'center', padding:'48px 24px'}}>
                <div style={{fontWeight:700, marginBottom:6}}>Nenhuma venda atribuída ainda</div>
                <div style={{fontSize:13, color:'var(--color-text-muted)', maxWidth:460, margin:'0 auto'}}>
                  O painel começa a encher a partir do próximo checkout que vier de um link com <code>?utm_campaign=...</code>. Assim que alguém pagar vindo de uma campanha, a receita e o ROAS aparecem aqui.
                </div>
              </div>
            ) : (
              <>
                {/* Cards de topo */}
                <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)', marginTop:12}}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel} title="Inclui assinaturas em trial de 7 dias (cancelamento no trial não é descontado)">MRR potencial (inclui trials)</div>
                    <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{fmtBRL(totalMrr)}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Assinantes atribuídos</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{payingUsers}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Gasto Meta (campanhas)</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{metaAvailable ? fmtBRL(totalSpend) : '—'}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>ROAS médio</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>
                      {totalRoas==null ? '—' : `${totalRoas.toFixed(2)}x`}
                    </div>
                  </div>
                </div>

                {/* Tabela receita por campanha */}
                <div className={styles.tableWrap} style={{marginTop:24}}>
                  <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Receita por campanha</div>
                  <table className={styles.table}>
                    <thead><tr>
                      <th>Campanha (UTM)</th>
                      <th>Assinantes</th>
                      <th>Planos</th>
                      <th>MRR</th>
                      <th>Gasto Meta</th>
                      <th>ROAS</th>
                    </tr></thead>
                    <tbody>
                      {joined.map(r => (
                        <tr key={r.campaign}>
                          <td style={{fontWeight:600}}>{r.label || <span className={styles.emptyDash}>(sem campanha)</span>}</td>
                          <td className={styles.mutedCell}>{r.users}</td>
                          <td className={styles.mutedCell}>
                            {Object.entries(r.plans).map(([p,n]) => (
                              <span key={p} className={styles.planTag} style={{background:(PLANO_COLOR[p]||'#64748b')+'22',color:PLANO_COLOR[p]||'#64748b',borderColor:(PLANO_COLOR[p]||'#64748b')+'55',marginRight:4}}>
                                {(PLANO_LABEL[p]??p)} {n}
                              </span>
                            ))}
                          </td>
                          <td className={styles.mutedCell} style={{fontWeight:700,color:'var(--color-text)'}}>{fmtBRL(r.mrr)}</td>
                          <td className={styles.mutedCell}>{r.spend>0 ? fmtBRL(r.spend) : (metaAvailable ? '—' : 'sem dado')}</td>
                          <td className={styles.mutedCell} style={{fontWeight:700, color:'var(--color-text)'}}>
                            {r.roas==null ? '—' : `${r.roas.toFixed(2)}x`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tabela receita por origem (utm_source) */}
                {(revenue?.by_source?.length ?? 0) > 0 && (
                  <div className={styles.tableWrap} style={{marginTop:24}}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Receita por origem</div>
                    <table className={styles.table}>
                      <thead><tr><th>Origem (utm_source)</th><th>Assinantes</th><th>MRR</th></tr></thead>
                      <tbody>
                        {(revenue?.by_source ?? []).map(s => (
                          <tr key={s.source}>
                            <td style={{fontWeight:600}}>{s.source || <span className={styles.emptyDash}>(direto)</span>}</td>
                            <td className={styles.mutedCell}>{s.users}</td>
                            <td className={styles.mutedCell} style={{fontWeight:700,color:'var(--color-text)'}}>{fmtBRL(s.mrr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}

      {/* ═══ ABA PACK SOLAR (pack.solardoc.app) ════════════════════ */}
      {tab === 'pack_visits' && (() => {
        // Filtra sessões da LP do Pack Solar (pack.solardoc.app/* — todas as rotas)
        const packSessions = baseSessions.filter(s => {
          const url = s.landing_url || '';
          return url.includes('pack.solardoc');
        });
        const visits     = packSessions.length;
        const ctaTotal   = packSessions.filter(s => (s.cta_clicks?.length||0) > 0).length;
        const ctaExtras  = packSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').includes('/extras'))).length;
        const ctaCheckout= packSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('checkout') || (c.label||'').toLowerCase().includes('pagamento'))).length;
        const ctaWhats   = packSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('whats'))).length;

        // Funil Pack Solar: Acessou LP → Foi pra /extras → Foi pro checkout
        const packFunnel: FunnelStep[] = [
          { label: 'Acessou LP',        value: visits },
          { label: 'Clicou Comprar',    value: ctaExtras },
          { label: 'Foi pro checkout',  value: ctaCheckout },
        ];

        const srcMap = new Map<string, { visits: number; scroll: number; cta: number; checkout: number }>();
        packSessions.forEach(s => {
          const src = srcLabel(s);
          const cur = srcMap.get(src) ?? { visits: 0, scroll: 0, cta: 0, checkout: 0 };
          cur.visits++;
          if ((s.max_scroll||0) >= 50) cur.scroll++;
          if ((s.cta_clicks?.length||0) > 0) cur.cta++;
          if (s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('checkout') || (c.label||'').toLowerCase().includes('pagamento'))) cur.checkout++;
          srcMap.set(src, cur);
        });
        const sources = Array.from(srcMap.entries())
          .map(([source, v]) => ({ source, ...v }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 8);

        const campMap = new Map<string, number>();
        packSessions.forEach(s => {
          if (s.utm_campaign) campMap.set(s.utm_campaign, (campMap.get(s.utm_campaign) ?? 0) + 1);
        });
        const campaigns = Array.from(campMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6);

        return (
          <>
            <div className={styles.filters} style={{marginTop:16, marginBottom:24, alignItems:'center', background:'var(--color-bg-elevated)', padding:'12px 16px', borderRadius:8}}>
              <div className={styles.periodTabs}>
                {([['hoje','Hoje'],['ontem','Ontem'],['3d','3 dias'],['7dias','7 dias'],['mes','Esse mês'],['maximo','Máximo']] as const).map(([v,l])=>(
                  <button key={v} className={visitPeriod===v?styles.periodActive:styles.periodBtn} onClick={()=>changeVisitPeriod(v as any)} disabled={loadingAnalytics}>{l}</button>
                ))}
              </div>
              <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>{visits} acessos no <code>pack.solardoc.app</code> · {baseSessions.length} totais</span>
            </div>

            {loadingAnalytics ? (
              <div className={styles.loading}>Carregando estatísticas...</div>
            ) : visits === 0 ? (
              <div className={styles.loading} style={{textAlign:'center', padding:'48px 24px'}}>
                <div style={{fontWeight:700, marginBottom:6}}>Sem acessos registrados ainda</div>
                <div style={{fontSize:13, color:'var(--color-text-muted)'}}>Dados aparecem aqui após alguém visitar <code>pack.solardoc.app</code>. Meta Pixel separado (824905216831401) também captura — ver no <a href="https://business.facebook.com/events_manager2/list/dataset/824905216831401/overview" target="_blank" rel="noopener noreferrer" style={{color:'var(--color-primary)'}}>Events Manager</a>.</div>
              </div>
            ) : (
              <>
                <div className={styles.cards} style={{gridTemplateColumns:'repeat(5,1fr)', marginTop: 12}}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Acessos</div>
                    <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{visits}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Clicou CTA ({pct(ctaTotal, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaTotal}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Foi pra /extras ({pct(ctaExtras, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaExtras}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Foi pro checkout ({pct(ctaCheckout, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaCheckout}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>WhatsApp ({pct(ctaWhats, visits)})</div>
                    <div className={styles.cardValue} style={{color:'var(--color-text)'}}>{ctaWhats}</div>
                  </div>
                </div>

                <div style={{marginTop:24, background:'var(--color-bg-elevated)', borderRadius:8, padding:'18px 16px 8px'}}>
                  <div style={{fontSize:13, fontWeight:700, color:'var(--color-text)', marginBottom:12}}>Funil Pack Solar</div>
                  <FunnelSVG steps={packFunnel} />
                </div>

                <div className={styles.twoCol} style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:24}}>
                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Top origens</div>
                    <table className={styles.table}>
                      <thead><tr><th>Origem</th><th>Visitas</th><th>Scroll</th><th>CTA</th><th>Checkout</th></tr></thead>
                      <tbody>
                        {sources.map(s => (
                          <tr key={s.source}>
                            <td style={{fontWeight:600}}>{s.source}</td>
                            <td className={styles.mutedCell}>{s.visits}</td>
                            <td className={styles.mutedCell}>{s.scroll} ({pct(s.scroll, s.visits)})</td>
                            <td className={styles.mutedCell}>{s.cta} ({pct(s.cta, s.visits)})</td>
                            <td className={styles.mutedCell}>{s.checkout} ({pct(s.checkout, s.visits)})</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>Top campanhas (UTM)</div>
                    <table className={styles.table}>
                      <thead><tr><th>Campanha</th><th>Visitas</th></tr></thead>
                      <tbody>
                        {campaigns.length === 0 ? (
                          <tr><td colSpan={2} className={styles.mutedCell} style={{textAlign:'center',padding:'18px 8px'}}>Sem UTMs registradas</td></tr>
                        ) : campaigns.map(c => (
                          <tr key={c.name}>
                            <td style={{fontWeight:600}}>{c.name}</td>
                            <td className={styles.mutedCell}>{c.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={styles.tableWrap} style={{marginTop:24}}>
                  <table className={styles.table}>
                    <thead><tr>
                      <th>Quando</th>
                      <th>Origem</th>
                      <th>Campanha</th>
                      <th>Dispositivo</th>
                      <th>Página</th>
                      <th>Scroll</th>
                      <th>Tempo</th>
                      <th>CTAs</th>
                    </tr></thead>
                    <tbody>
                      {packSessions.slice(0, 80).map((s, i) => {
                        const r = relDate(s.created_at);
                        const ctaLabels = (s.cta_clicks ?? []).map(c => c.label).filter(Boolean).join(', ');
                        let pageLabel = '/';
                        try {
                          if (s.landing_url) {
                            const u = new URL(s.landing_url);
                            pageLabel = u.pathname || '/';
                          }
                        } catch {}
                        return (
                          <tr key={s.session_id || i}>
                            <td>
                              <div style={{display:'flex',flexDirection:'column',gap:2}}>
                                <span style={{fontWeight:600,fontSize:12,color:r.color}}>{r.label}</span>
                                {r.showTime && <span style={{fontSize:11,color:'var(--color-text-muted)'}}>{r.time}</span>}
                              </div>
                            </td>
                            <td className={styles.mutedCell}>{srcLabel(s)}</td>
                            <td className={styles.mutedCell}>{s.utm_campaign || <span className={styles.emptyDash}>—</span>}</td>
                            <td className={styles.mutedCell}>{deviceIcon(s.user_agent)}</td>
                            <td className={styles.mutedCell}><code style={{fontSize:11}}>{pageLabel}</code></td>
                            <td className={styles.mutedCell}>{s.max_scroll ? `${s.max_scroll}%` : '—'}</td>
                            <td className={styles.mutedCell}>{fmtTime(s.time_on_page)}</td>
                            <td className={styles.mutedCell} style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={ctaLabels || ''}>
                              {ctaLabels || <span className={styles.emptyDash}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ═══ ABA MEMBROS (base de usuários da plataforma) ═══════════ */}
      {tab === 'membros' && <MembrosPanel />}
      {tab === 'trafego' && <TrafegoPanel />}

      {/* ═══ ABA FUNIL SOLARDOC ═════════════════════════════════ */}
      {tab === 'funil_solardoc' && <FunilSolarDocPanel />}

      {/* ═══ ABA FUNIL LIMPAPRO ═════════════════════════════════ */}
      {tab === 'funil_limpapro' && <FunilLimpaproPanel />}

    </div>
  );
}
