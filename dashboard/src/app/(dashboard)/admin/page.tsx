'use client';

import React, { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import styles from './admin.module.css';

/* ─── tipos ─────────────────────────────────────────────────── */
interface UserRow {
  id: string; email: string; plano: string;
  documentos_usados: number; limite_documentos: number;
  created_at: string; is_admin: boolean;
  whatsapp: string | null;
  empresa_nome: string | null; empresa_cnpj: string | null; empresa_whatsapp: string | null;
  followup_day_recovered: number | null;
  followup_started_at: string | null;
  stripe_status: string | null;
  stripe_plan: string | null;
}
interface LeadRow {
  id: string; name: string; whatsapp: string | null;
  city: string; state: string; created_at: string; status: string;
  score: number | null; followup: string;
}
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
  adset_id: string; adset_name: string; campaign_name: string;
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

/* ─── helpers ────────────────────────────────────────────────── */
import { toBrasilia, nowBrasilia, fmtDateTimeBR, fmtDateBR, daysDiffBR } from '@/utils/brasilia';

function fmt(d: string) { return fmtDateTimeBR(d); }
function isToday(d: string) {
  const a = toBrasilia(d), b = nowBrasilia();
  return a.getUTCFullYear()===b.getUTCFullYear() && a.getUTCMonth()===b.getUTCMonth() && a.getUTCDate()===b.getUTCDate();
}
function relDate(d: string) {
  const diff = daysDiffBR(d);
  const s    = toBrasilia(d);
  const hh   = String(s.getUTCHours()).padStart(2,'0');
  const mm   = String(s.getUTCMinutes()).padStart(2,'0');
  const time = `${hh}:${mm}`;
  const date = fmtDateBR(d);
  let label: string; let color: string;
  if (diff === 0)      { label = 'HOJE';         color = '#22c55e'; }
  else if (diff === 1) { label = 'ONTEM';        color = '#60a5fa'; }
  else if (diff <= 7)  { label = `${diff} DIAS`; color = '#f59e0b'; }
  else                 { label = date;            color = 'var(--color-text-muted)'; }
  return { label, color, time, showTime: diff <= 7 };
}
function srcLabel(s: SessionRow) {
  if (s.utm_source) return s.utm_source;
  if (s.referrer) { try { return new URL(s.referrer).hostname.replace('www.',''); } catch { return s.referrer; } }
  return 'Direto';
}
function deviceIcon(ua: string | null) { return !ua ? '—' : /Mobile|Android|iPhone|iPad/i.test(ua) ? '📱' : '🖥️'; }
function fmtTime(sec: number | null | undefined) {
  if (sec == null || sec <= 0) return '—';
  return sec < 60 ? `${sec}s` : `${Math.floor(sec/60)}m${sec%60>0?` ${sec%60}s`:''}`;
}
function pct(n: number, total: number) { return !total ? '—' : `${Math.round(n/total*100)}%`; }
function fmtBRL(val: number) { return val.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2}); }
function fmtNum(n: number) { return n.toLocaleString('pt-BR'); }

const PLANO_LABEL: Record<string,string> = { free:'FREE', pro:'PRO', ilimitado:'VIP' };
const PLANO_COLOR: Record<string,string> = { free:'#64748b', pro:'#F59E0B', ilimitado:'#f97316' };
const SECTION_LABEL: Record<string,string> = { problema:'Problema', crenca:'Crença', solucao:'Solução', precos:'Preços', faq:'FAQ' };

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
            <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.95" />
            <stop offset="45%"  stopColor="#8b5cf6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0.95" />
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
  const [tab, setTab] = useState<'users'|'visits'|'io_visits'|'sim_visits'>('users');

  const [users, setUsers]               = useState<UserRow[]>([]);
  const [documents, setDocuments]       = useState<{created_at: string}[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch]             = useState('');
  const [filterPlano, setFilterPlano]   = useState('todos');
  const [filterPeriodo, setFilterPeriodo] = useState<'hoje'|'ontem'|'7dias'|'mes'|'custom'|'maximo'>('maximo');
  const [customFrom, setCustomFrom]     = useState('');
  const [customTo, setCustomTo]         = useState('');
  const [resetting, setResetting]       = useState(false);
  const [resetMsg, setResetMsg]         = useState('');

  const [analytics, setAnalytics]               = useState<Analytics|null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded]   = useState(false);
  const [visitSearch, setVisitSearch]           = useState('');
  const [filterSource, setFilterSource]         = useState('');
  const [expandedSession, setExpandedSession]   = useState<string|null>(null);

  const [metaData, setMetaData]           = useState<MetaFunnelData|null>(null);
  const [loadingMeta, setLoadingMeta]     = useState(false);
  const [visitPeriod, setVisitPeriod]     = useState<'hoje'|'ontem'|'3d'|'7dias'|'mes'|'maximo'>('7dias');
  const [metaLoaded, setMetaLoaded]       = useState(false);

  useEffect(() => {
    api.get('/admin/users').then(r => {
      setUsers(r.data.users);
      setDocuments(r.data.documents ?? []);
    }).catch(()=>{}).finally(()=>setLoadingUsers(false));
  }, []);

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

  useEffect(() => { if (tab==='visits' && !analyticsLoaded) loadAnalytics(visitPeriod); }, [tab,analyticsLoaded,loadAnalytics,visitPeriod]);
  useEffect(() => { if (tab==='visits' && !metaLoaded) loadMeta(visitPeriod); }, [tab,metaLoaded,visitPeriod,loadMeta]);
  useEffect(() => { if ((tab==='io_visits'||tab==='sim_visits') && !analyticsLoaded) loadAnalytics(visitPeriod); }, [tab,analyticsLoaded,loadAnalytics,visitPeriod]);

  function changeVisitPeriod(p: 'hoje'|'ontem'|'3d'|'7dias'|'mes'|'maximo') {
    setVisitPeriod(p); 
    setMetaLoaded(false); 
    setAnalyticsLoaded(false); 
    loadMeta(p); 
    loadAnalytics(p);
  }

  const filteredUsers = users.filter(u => {
    const okSearch = search==='' || u.email.toLowerCase().includes(search.toLowerCase()) || (u.empresa_nome??'').toLowerCase().includes(search.toLowerCase());
    const okPlano  = filterPlano==='todos' || u.plano===filterPlano;
    let okPeriodo  = true;
    if (filterPeriodo !== 'maximo') {
      const now = nowBrasilia();
      const d   = toBrasilia(u.created_at);
      if (filterPeriodo === 'hoje') {
        okPeriodo = d.getUTCFullYear()===now.getUTCFullYear() && d.getUTCMonth()===now.getUTCMonth() && d.getUTCDate()===now.getUTCDate();
      } else if (filterPeriodo === 'ontem') {
        const ontem = new Date(now); ontem.setUTCDate(ontem.getUTCDate()-1);
        okPeriodo = d.getUTCFullYear()===ontem.getUTCFullYear() && d.getUTCMonth()===ontem.getUTCMonth() && d.getUTCDate()===ontem.getUTCDate();
      } else if (filterPeriodo === '7dias') {
        const sete = new Date(now); sete.setUTCDate(sete.getUTCDate()-6);
        sete.setUTCHours(0,0,0,0);
        okPeriodo = d >= sete;
      } else if (filterPeriodo === 'mes') {
        okPeriodo = d.getUTCFullYear()===now.getUTCFullYear() && d.getUTCMonth()===now.getUTCMonth();
      } else if (filterPeriodo === 'custom') {
        const from = customFrom ? new Date(customFrom+'T03:00:00Z') : null;
        const to   = customTo   ? new Date(customTo  +'T02:59:59Z') : null;
        if (from) okPeriodo = okPeriodo && d >= from;
        if (to)   okPeriodo = okPeriodo && d <= to;
      }
    }
    return okSearch && okPlano && okPeriodo;
  });

  const totalPeriodo = filteredUsers.length;
  const totalPro  = filteredUsers.filter(u=>u.plano==='pro').length;
  const totalVip  = filteredUsers.filter(u=>u.plano==='ilimitado').length;
  const totalFree = filteredUsers.filter(u=>u.plano==='free').length;

  const totalDocs = documents.filter(d => {
    if (filterPeriodo === 'maximo') return true;
    const now = nowBrasilia();
    const dt  = toBrasilia(d.created_at);
    if (filterPeriodo === 'hoje') {
      return dt.getUTCFullYear()===now.getUTCFullYear() && dt.getUTCMonth()===now.getUTCMonth() && dt.getUTCDate()===now.getUTCDate();
    }
    if (filterPeriodo === 'ontem') {
      const ontem = new Date(now); ontem.setUTCDate(ontem.getUTCDate()-1);
      return dt.getUTCFullYear()===ontem.getUTCFullYear() && dt.getUTCMonth()===ontem.getUTCMonth() && dt.getUTCDate()===ontem.getUTCDate();
    }
    if (filterPeriodo === '7dias') {
      const sete = new Date(now); sete.setUTCDate(sete.getUTCDate()-6); sete.setUTCHours(0,0,0,0);
      return dt >= sete;
    }
    if (filterPeriodo === 'mes') {
      return dt.getUTCFullYear()===now.getUTCFullYear() && dt.getUTCMonth()===now.getUTCMonth();
    }
    if (filterPeriodo === 'custom') {
      const from = customFrom ? new Date(customFrom+'T03:00:00Z') : null;
      const to   = customTo   ? new Date(customTo  +'T02:59:59Z') : null;
      if (from && dt < from) return false;
      if (to   && dt > to)   return false;
      return true;
    }
    return true;
  }).length;

  const baseSessions = (analytics?.sessions??[]);

  const allSources      = Array.from(new Set(baseSessions.map(s=>srcLabel(s)))).sort();
  const filteredSessions = baseSessions.filter(s => {
    const src = srcLabel(s).toLowerCase();
    return (!filterSource||src===filterSource.toLowerCase()) &&
           (!visitSearch||src.includes(visitSearch.toLowerCase())||(s.utm_campaign??'').toLowerCase().includes(visitSearch.toLowerCase())||(s.ip??'').includes(visitSearch));
  });

  if (loadingUsers) return <div className={styles.loading}>Carregando...</div>;

  const fn  = analytics?.funnel;
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
    { label: 'Gasto total',      value: fmtBRL(mt.spend),                                    color: '#f87171' },
    { label: 'CPC',              value: fmtBRL(mt.cpc),                                      color: '#fb923c' },
    { label: 'CPM',              value: mt.impressions>0?fmtBRL(mt.spend/mt.impressions*1000):'—', color: '#fbbf24' },
    { label: 'Custo / visita LP',value: lpf.lp_visits>0?fmtBRL(mt.spend/lpf.lp_visits):'—', color: '#34d399' },
    { label: 'Custo / Preços',   value: lpf.saw_precos>0?fmtBRL(mt.spend/lpf.saw_precos):'—',color: '#fb923c' },
    { label: 'Custo / CTA',      value: lpf.cta_clicks>0?fmtBRL(mt.spend/lpf.cta_clicks):'—',color: '#a78bfa' },
    { label: 'CTR',              value: mt.ctr.toFixed(2)+'%',                               color: '#60a5fa' },
    { label: 'Taxa LP→Preços',   value: pct(lpf.saw_precos, lpf.lp_visits),                  color: '#818cf8' },
    { label: 'Taxa LP→CTA',      value: pct(lpf.cta_clicks, lpf.lp_visits),                  color: '#c084fc' },
    { label: 'Taxa Click→LP',    value: pct(lpf.lp_visits, mt.clicks),                       color: '#2dd4bf' },
    { label: 'Tempo médio LP',   value: fmtTime(metaData?.avg_time),                         color: '#94a3b8' },
    { label: 'Impressões',       value: fmtNum(mt.impressions),                              color: '#60a5fa' },
  ] : [];

  return (
    <div className={styles.page}>
      <div className={styles.header} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <h1 className={styles.title}>⚙️ Painel Admin</h1>
          <p className={styles.subtitle}>{users.length} usuários cadastrados</p>
        </div>
        {tab==='users' && (
          <button className="btn-secondary" disabled={resetting} onClick={async()=>{
            if(!confirm('Resetar documentos de todos os usuários FREE/PRO com data vencida?'))return;
            setResetting(true);setResetMsg('');
            try{const r=await api.post('/admin/reset-monthly');setResetMsg(r.data.message);}
            catch{setResetMsg('Erro ao executar reset');}
            finally{setResetting(false);}
          }}>{resetting?'Executando...':'🔄 Reset Mensal'}</button>
        )}
        {tab==='visits' && (
          <button className="btn-secondary" disabled={loadingAnalytics||loadingMeta}
            onClick={()=>{loadAnalytics();setMetaLoaded(false);loadMeta();}}>
            {(loadingAnalytics||loadingMeta)?'Atualizando...':'🔄 Atualizar'}
          </button>
        )}
        {tab==='io_visits' && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <a href="/io" target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{textDecoration:'none'}}>↗ Abrir Site /io</a>
            <button className="btn-secondary" disabled={loadingAnalytics} onClick={()=>loadAnalytics()}>
              {loadingAnalytics?'Atualizando...':'🔄 Atualizar'}
            </button>
          </div>
        )}
        {tab==='sim_visits' && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <a href="/io/simular" target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{textDecoration:'none'}}>↗ Abrir /io/simular</a>
            <button className="btn-secondary" disabled={loadingAnalytics} onClick={()=>loadAnalytics()}>
              {loadingAnalytics?'Atualizando...':'🔄 Atualizar'}
            </button>
          </div>
        )}
      </div>

      {resetMsg && (
        <div style={{background:'rgba(34,197,94,0.1)',border:'1px solid #22c55e',color:'#22c55e',borderRadius:8,padding:'10px 16px',marginBottom:16,fontSize:13}}>
          ✓ {resetMsg}
        </div>
      )}

      <div className={styles.tabs}>
        <button className={tab==='users'?styles.tabActive:styles.tab} onClick={()=>setTab('users')}>👥 Usuários SolarDocs Pro</button>
        <button className={tab==='visits'?styles.tabActive:styles.tab} onClick={()=>setTab('visits')}>📊 LP SolarDoc</button>
        <button className={tab==='io_visits'?styles.tabActive:styles.tab} onClick={()=>setTab('io_visits')}>🏗️ Acessos Site IO</button>
        <button className={tab==='sim_visits'?styles.tabActive:styles.tab} onClick={()=>setTab('sim_visits')}>🧮 Acesso Simulador</button>
      </div>

      {/* ═══ ABA USUÁRIOS ══════════════════════════════════════ */}
      {tab==='users' && (
        <>
          <div className={styles.cards}>
            <div className={styles.card}><div className={styles.cardLabel}>Cadastros (Período)</div><div className={styles.cardValue} style={{color:'#22c55e'}}>{totalPeriodo}</div></div>
            <div className={styles.card}><div className={styles.cardLabel}>Documentos Gerados</div><div className={styles.cardValue} style={{color:'#3b82f6'}}>{totalDocs}</div></div>
            <div className={styles.card}><div className={styles.cardLabel}>FREE</div><div className={styles.cardValue} style={{color:'#64748b'}}>{totalFree}</div></div>
            <div className={styles.card}><div className={styles.cardLabel}>PRO</div><div className={styles.cardValue} style={{color:'#F59E0B'}}>{totalPro}</div></div>
            <div className={styles.card}><div className={styles.cardLabel}>VIP</div><div className={styles.cardValue} style={{color:'#f97316'}}>{totalVip}</div></div>
          </div>
          <div className={styles.filters}>
            <input type="text" placeholder="Buscar por email ou empresa..." value={search} onChange={e=>setSearch(e.target.value)} className="input-field" style={{maxWidth:320}}/>
            <select value={filterPlano} onChange={e=>setFilterPlano(e.target.value)} className="input-field" style={{maxWidth:140}}>
              <option value="todos">Todos os planos</option>
              <option value="free">FREE</option><option value="pro">PRO</option><option value="ilimitado">VIP</option>
            </select>
          </div>
          <div className={styles.filters} style={{marginTop:8,alignItems:'center'}}>
            <div className={styles.periodTabs}>
              {([['hoje','Hoje'],['ontem','Ontem'],['7dias','7 dias'],['mes','Esse mês'],['custom','Período'],['maximo','Máximo']] as const).map(([v,l])=>(
                <button key={v} className={filterPeriodo===v?styles.periodActive:styles.periodBtn} onClick={()=>setFilterPeriodo(v)}>{l}</button>
              ))}
            </div>
            {filterPeriodo==='custom'&&(
              <>
                <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} className="input-field" style={{maxWidth:150}} />
                <span style={{color:'var(--color-text-muted)',fontSize:13}}>até</span>
                <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} className="input-field" style={{maxWidth:150}} />
              </>
            )}
            <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>{filteredUsers.length} resultado{filteredUsers.length!==1?'s':''}</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Email</th><th>Empresa</th><th>WhatsApp</th><th>Plano</th><th>Stripe</th><th>Docs</th><th>Cadastro</th><th>Followup</th><th>Resultado Followup</th></tr></thead>
              <tbody>
                {filteredUsers.length===0&&<tr><td colSpan={9} className={styles.empty}>Nenhum usuário encontrado</td></tr>}
                {filteredUsers.map(u=>{
                  const fsRaw       = u.followup_started_at;
                  const isInSystem  = !!fsRaw;
                  const baseMs      = fsRaw ? new Date(fsRaw.replace(' ','T')+'Z').getTime() : 0;
                  const diffDays    = isInSystem ? Math.floor((Date.now() - baseMs) / 86400000) : 0;
                  const followupDay = diffDays + 1;
                  const inSequence  = isInSystem && !u.empresa_cnpj && followupDay >= 1 && followupDay <= 7;
                  const expired     = isInSystem && !u.empresa_cnpj && followupDay > 7;
                  const converted   = isInSystem && !!u.empresa_cnpj;
                  const convDay     = u.followup_day_recovered ?? (converted ? followupDay : null);
                  return (
                  <tr key={u.id} className={isToday(u.created_at)?styles.rowNew:''}>
                    <td>
                      {u.email}
                      {u.is_admin&&<span className={styles.adminTag}>admin</span>}
                    </td>
                    <td className={styles.mutedCell}>{u.empresa_nome??<span className={styles.emptyDash}>—</span>}</td>
                    <td className={styles.mutedCell}>{(() => {
                      const wpp = u.empresa_whatsapp || u.whatsapp;
                      return wpp ? <a href={`https://wa.me/55${wpp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" style={{color:'#22c55e',textDecoration:'none'}}>📲 {wpp}</a> : <span className={styles.emptyDash}>—</span>;
                    })()}</td>
                    <td><span className={styles.planTag} style={{background:PLANO_COLOR[u.plano]+'22',color:PLANO_COLOR[u.plano],borderColor:PLANO_COLOR[u.plano]+'55'}}>{PLANO_LABEL[u.plano]??u.plano}</span></td>
                    <td style={{textAlign:'center'}}>{(() => {
                      // Sem subscription no Stripe: cadastrou mas não passou cartão
                      if (!u.stripe_status) {
                        return u.plano === 'free'
                          ? <span title="Cadastrou mas não passou cartão" style={{display:'inline-block',padding:'2px 8px',borderRadius:6,background:'rgba(239,68,68,0.10)',border:'1px solid rgba(239,68,68,0.30)',color:'#f87171',fontWeight:700,fontSize:11,whiteSpace:'nowrap'}}>Não passou</span>
                          : <span className={styles.emptyDash}>—</span>;
                      }
                      // Com subscription: traduzir status
                      const map: Record<string,{label:string;bg:string;border:string;color:string}> = {
                        trialing:           { label:'Trial',     bg:'rgba(59,130,246,0.10)', border:'rgba(59,130,246,0.30)', color:'#60a5fa' },
                        active:             { label:'Ativo',     bg:'rgba(34,197,94,0.10)',  border:'rgba(34,197,94,0.30)',  color:'#22c55e' },
                        past_due:           { label:'Em atraso', bg:'rgba(245,158,11,0.10)', border:'rgba(245,158,11,0.30)', color:'#f59e0b' },
                        canceled:           { label:'Cancelou',  bg:'rgba(239,68,68,0.10)',  border:'rgba(239,68,68,0.30)',  color:'#f87171' },
                        incomplete:         { label:'Incompleto',bg:'rgba(148,163,184,0.10)',border:'rgba(148,163,184,0.30)',color:'#94a3b8' },
                        incomplete_expired: { label:'Expirou',   bg:'rgba(148,163,184,0.10)',border:'rgba(148,163,184,0.30)',color:'#94a3b8' },
                        unpaid:             { label:'Não pagou', bg:'rgba(239,68,68,0.10)',  border:'rgba(239,68,68,0.30)',  color:'#f87171' },
                        paused:             { label:'Pausada',   bg:'rgba(148,163,184,0.10)',border:'rgba(148,163,184,0.30)',color:'#94a3b8' },
                      };
                      const s = map[u.stripe_status] ?? { label:u.stripe_status, bg:'rgba(148,163,184,0.10)', border:'rgba(148,163,184,0.30)', color:'#94a3b8' };
                      return <span title={`Stripe: ${u.stripe_status}`} style={{display:'inline-block',padding:'2px 8px',borderRadius:6,background:s.bg,border:`1px solid ${s.border}`,color:s.color,fontWeight:700,fontSize:11,whiteSpace:'nowrap'}}>{s.label}</span>;
                    })()}</td>
                    <td className={styles.mutedCell}>{u.documentos_usados}/{u.limite_documentos===999999?'∞':u.limite_documentos}</td>
                    <td>{(() => { const r = relDate(u.created_at); return <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontWeight:600,fontSize:12,color:r.color}}>{r.label}</span>{r.showTime&&<span style={{fontSize:11,color:'var(--color-text-muted)'}}>{r.time}</span>}</div>; })()}</td>
                    <td style={{textAlign:'center'}}>
                      {inSequence
                        ? <span style={{display:'inline-block',padding:'2px 10px',borderRadius:6,background:'rgba(245,158,11,0.12)',border:'1px solid rgba(245,158,11,0.35)',color:'#f59e0b',fontWeight:700,fontSize:12}}>{String(followupDay).padStart(2,'0')}</span>
                        : <span className={styles.emptyDash}>—</span>
                      }
                    </td>
                    <td style={{textAlign:'center'}}>
                      {converted
                        ? <span style={{display:'inline-block',padding:'2px 10px',borderRadius:6,background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.3)',color:'#22c55e',fontWeight:700,fontSize:11,whiteSpace:'nowrap'}}>Sucesso followup {String(convDay??followupDay).padStart(2,'0')}</span>
                        : expired
                          ? <span style={{display:'inline-block',padding:'2px 10px',borderRadius:6,background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',color:'#f87171',fontWeight:600,fontSize:11,whiteSpace:'nowrap'}}>Sem sucesso</span>
                          : <span className={styles.emptyDash}>—</span>
                      }
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ═══ ABA ACESSOS SITE IO ════════════════════════════════ */}
      {tab === 'io_visits' && (() => {
        // Inclui /io, /io/oferta etc. — exclui /io/simular (tem aba própria).
        const ioSessions = baseSessions.filter(s => {
          const url = s.landing_url || '';
          return url.includes('/io') && !url.includes('/io/simular');
        });
        const visits     = ioSessions.length;
        const scroll50   = ioSessions.filter(s => (s.max_scroll||0) >= 50).length;
        const ctaTotal   = ioSessions.filter(s => (s.cta_clicks?.length||0) > 0).length;
        const ctaHero    = ioSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('hero'))).length;
        const ctaWhats   = ioSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('whats'))).length;
        const formSubmit = ioSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('contact_form'))).length;
        const avgTime    = ioSessions.reduce((a,s) => a + (s.time_on_page||0), 0) / Math.max(visits, 1);
        const mobile     = ioSessions.filter(s => /Mobile|Android|iPhone|iPad/i.test(s.user_agent||'')).length;
        const desktop    = visits - mobile;

        // Funil IO: Acessou → Scroll 50% → CTA hero → Clicou WhatsApp
        const ioFunnel: FunnelStep[] = [
          { label: 'Acessou /io',     value: visits },
          { label: 'Scroll 50%',      value: scroll50 },
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
                <div style={{fontSize:48, marginBottom:12}}>🏗️</div>
                <div style={{fontWeight:700, marginBottom:6}}>Sem acessos registrados ainda</div>
                <div style={{fontSize:13, color:'var(--color-text-muted)'}}>Os dados aparecem aqui depois que alguém visita <code>/io</code>. O Meta Pixel também já está capturando, ver no <a href="https://business.facebook.com/events_manager2/list/pixel/446093469730871/overview" target="_blank" rel="noopener noreferrer" style={{color:'#22c55e'}}>Gerenciador de Eventos</a>.</div>
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
                    <div className={styles.cardValue} style={{color:'#3b82f6'}}>{ctaTotal}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>CTA Hero ({pct(ctaHero, visits)})</div>
                    <div className={styles.cardValue} style={{color:'#F59E0B'}}>{ctaHero}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Cliques WhatsApp ({pct(ctaWhats, visits)})</div>
                    <div className={styles.cardValue} style={{color:'#22c55e'}}>{ctaWhats}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Form contato</div>
                    <div className={styles.cardValue} style={{color:'#a78bfa'}}>{formSubmit}</div>
                  </div>
                </div>

                {/* Cards secundários — engajamento */}
                <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)', marginTop: 12}}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Scroll 50%+ ({pct(scroll50, visits)})</div>
                    <div className={styles.cardValue} style={{color:'#ec4899'}}>{scroll50}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>⏱️ Tempo médio</div>
                    <div className={styles.cardValue} style={{color:'#94a3b8'}}>{fmtTime(Math.round(avgTime))}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>📱 Mobile</div>
                    <div className={styles.cardValue} style={{color:'#60a5fa'}}>{mobile} ({pct(mobile, visits)})</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>🖥️ Desktop</div>
                    <div className={styles.cardValue} style={{color:'#a78bfa'}}>{desktop} ({pct(desktop, visits)})</div>
                  </div>
                </div>

                {/* Funil SVG */}
                <div style={{marginTop:24, background:'var(--color-bg-elevated)', borderRadius:8, padding:'18px 16px 8px'}}>
                  <div style={{fontSize:13, fontWeight:700, color:'var(--color-text)', marginBottom:12}}>📉 Funil do /io</div>
                  <FunnelSVG steps={ioFunnel} />
                </div>

                {/* Origens + Campanhas lado a lado */}
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:24}}>
                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>🌐 Top origens</div>
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
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>📣 Top campanhas (UTM)</div>
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
        const scroll50   = lpSessions.filter(s => (s.max_scroll||0) >= 50).length;
        const sawPrecos  = lpSessions.filter(s => s.sections_seen?.includes('precos')).length;
        const ctaTotal   = lpSessions.filter(s => (s.cta_clicks?.length||0) > 0).length;
        const ctaGratis  = lpSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('grátis'))).length;
        const ctaPro     = lpSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('pro'))).length;
        const ctaVip     = lpSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('vip'))).length;
        const avgTime    = lpSessions.reduce((a,s) => a + (s.time_on_page||0), 0) / Math.max(visits, 1);
        const mobile     = lpSessions.filter(s => /Mobile|Android|iPhone|iPad/i.test(s.user_agent||'')).length;
        const desktop    = visits - mobile;

        // Funil LP: Acessou → Scroll 50% → Viu Preços → Clicou CTA → Cadastrou (conversão geral)
        const lpFunnel: FunnelStep[] = [
          { label: 'Acessou LP',  value: visits },
          { label: 'Scroll 50%',  value: scroll50 },
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
              <div style={{fontSize:48, marginBottom:12}}>📊</div>
              <div style={{fontWeight:700, marginBottom:6}}>Sem acessos no período</div>
              <div style={{fontSize:13, color:'var(--color-text-muted)'}}>Trocar o filtro acima ou aguardar novo tráfego em <code>solardoc.app</code>.</div>
            </div>
          ) : (
            <>
              {/* Cards primários — funil de conversão */}
              <div className={styles.cards} style={{gridTemplateColumns:'repeat(5,1fr)', marginTop: 12}}>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Acessaram a LP</div>
                  <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{visits}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicou alguma CTA ({pct(ctaTotal, visits)})</div>
                  <div className={styles.cardValue} style={{color:'#3b82f6'}}>{ctaTotal}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicaram Grátis</div>
                  <div className={styles.cardValue} style={{color:'#22c55e'}}>{ctaGratis}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicaram PRO</div>
                  <div className={styles.cardValue} style={{color:'#F59E0B'}}>{ctaPro}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicaram VIP</div>
                  <div className={styles.cardValue} style={{color:'#f97316'}}>{ctaVip}</div>
                </div>
              </div>

              {/* Cards secundários — engajamento */}
              <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)', marginTop: 12}}>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Scroll 50%+ ({pct(scroll50, visits)})</div>
                  <div className={styles.cardValue} style={{color:'#a78bfa'}}>{scroll50}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Viu seção Preços ({pct(sawPrecos, visits)})</div>
                  <div className={styles.cardValue} style={{color:'#ec4899'}}>{sawPrecos}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>📱 Mobile</div>
                  <div className={styles.cardValue} style={{color:'#60a5fa'}}>{mobile} ({pct(mobile, visits)})</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>🖥️ Desktop</div>
                  <div className={styles.cardValue} style={{color:'#a78bfa'}}>{desktop} ({pct(desktop, visits)})</div>
                </div>
              </div>

              {/* Tempo médio em destaque */}
              <div className={styles.cards} style={{gridTemplateColumns:'1fr', marginTop: 12}}>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>⏱️ Tempo médio na LP</div>
                  <div className={styles.cardValue} style={{color:'#94a3b8'}}>{fmtTime(Math.round(avgTime))}</div>
                </div>
              </div>

              {/* Funil SVG */}
              <div style={{marginTop:24, background:'var(--color-bg-elevated)', borderRadius:8, padding:'18px 16px 8px'}}>
                <div style={{fontSize:13, fontWeight:700, color:'var(--color-text)', marginBottom:12}}>📉 Funil da LP</div>
                <FunnelSVG steps={lpFunnel} />
              </div>

              {/* Origens + Campanhas lado a lado */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:24}}>
                <div className={styles.tableWrap}>
                  <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>🌐 Top origens</div>
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
                  <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>📣 Top campanhas (UTM)</div>
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

      {/* ═══ ABA ACESSO SIMULADOR ════════════════════════════════ */}
      {tab === 'sim_visits' && (() => {
        const simSessions = baseSessions.filter(s => (s.landing_url || '').includes('/io/simular'));
        const visits = simSessions.length;
        const step1 = simSessions.filter(s => (s.max_step ?? 0) >= 1).length;
        // Novo fluxo single-page: sem step 2 e 3 — só entrou (1) → viu proposta (4)
        const propostaVista = simSessions.filter(s => (s.max_step ?? 0) >= 4).length;
        const whatsClicks = simSessions.filter(s => s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('whatsapp_sim'))).length;
        const abandonos = simSessions.filter(s => s.sim_abandon).length;
        const avgTime = simSessions.reduce((a,s)=>a+(s.time_on_page||0),0) / Math.max(simSessions.length,1);
        const mobileCount = simSessions.filter(s => /Mobile|Android|iPhone|iPad/i.test(s.user_agent||'')).length;
        const desktopCount = visits - mobileCount;

        // Funil SVG — novo fluxo simplificado
        const simFunnel: FunnelStep[] = [
          { label: 'Entrou',          value: step1 },
          { label: 'Viu proposta',    value: propostaVista },
          { label: 'Clicou WhatsApp', value: whatsClicks },
        ];

        // Origens (top)
        const srcMap = new Map<string, { visits: number; step4: number; whats: number }>();
        simSessions.forEach(s => {
          const src = srcLabel(s);
          const cur = srcMap.get(src) ?? { visits: 0, step4: 0, whats: 0 };
          cur.visits++;
          if ((s.max_step ?? 0) >= 4) cur.step4++;
          if (s.cta_clicks?.some(c => (c.label||'').toLowerCase().includes('whatsapp_sim'))) cur.whats++;
          srcMap.set(src, cur);
        });
        const sources = Array.from(srcMap.entries())
          .map(([source, v]) => ({ source, ...v }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 8);

        // Campanhas UTM (top)
        const campMap = new Map<string, number>();
        simSessions.forEach(s => {
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
              <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>{visits} acessos no /io/simular · {baseSessions.length} totais</span>
            </div>

            {loadingAnalytics ? (
              <div className={styles.loading}>Carregando estatísticas...</div>
            ) : visits === 0 ? (
              <div className={styles.loading} style={{textAlign:'center', padding:'48px 24px'}}>
                <div style={{fontSize:48, marginBottom:12}}>🧮</div>
                <div style={{fontWeight:700, marginBottom:6}}>Sem acessos registrados ainda</div>
                <div style={{fontSize:13, color:'var(--color-text-muted)'}}>
                  Os dados aparecem aqui quando alguém visita <code>/io/simular</code>.
                  O Meta Pixel também tá capturando — ver eventos <code>Sim_Entrou</code>, <code>Sim_Step4_Resultado</code>, <code>Sim_WhatsApp</code> no{' '}
                  <a href="https://business.facebook.com/events_manager2/list/pixel/446093469730871/overview" target="_blank" rel="noopener noreferrer" style={{color:'#22c55e'}}>Gerenciador de Eventos</a>.
                </div>
              </div>
            ) : (
              <>
                {/* Cards principais — novo fluxo single-page */}
                <div className={styles.cards} style={{gridTemplateColumns:'repeat(3,1fr)', marginTop: 12}}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Entrou</div>
                    <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{step1}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Viu proposta ({pct(propostaVista, step1)})</div>
                    <div className={styles.cardValue} style={{color:'#F59E0B'}}>{propostaVista}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Cliques WhatsApp ({pct(whatsClicks, step1)})</div>
                    <div className={styles.cardValue} style={{color:'#22c55e'}}>{whatsClicks}</div>
                  </div>
                </div>

                {/* Cards secundários */}
                <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)', marginTop: 12}}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Tempo médio</div>
                    <div className={styles.cardValue} style={{color:'#94a3b8'}}>{fmtTime(Math.round(avgTime))}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Abandonaram</div>
                    <div className={styles.cardValue} style={{color:'#f87171'}}>{abandonos}</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>📱 Mobile</div>
                    <div className={styles.cardValue} style={{color:'#60a5fa'}}>{mobileCount} ({pct(mobileCount, visits)})</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>🖥️ Desktop</div>
                    <div className={styles.cardValue} style={{color:'#a78bfa'}}>{desktopCount} ({pct(desktopCount, visits)})</div>
                  </div>
                </div>

                {/* Funil SVG */}
                <div style={{marginTop:24, background:'var(--color-bg-elevated)', borderRadius:8, padding:'18px 16px 8px'}}>
                  <div style={{fontSize:13, fontWeight:700, color:'var(--color-text)', marginBottom:12}}>📉 Funil completo do simulador</div>
                  <FunnelSVG steps={simFunnel} />
                </div>

                {/* Origens + Campanhas lado a lado */}
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:24}}>
                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>🌐 Top origens</div>
                    <table className={styles.table}>
                      <thead><tr><th>Origem</th><th>Visitas</th><th>Resultado</th><th>WhatsApp</th></tr></thead>
                      <tbody>
                        {sources.map(s => (
                          <tr key={s.source}>
                            <td style={{fontWeight:600}}>{s.source}</td>
                            <td className={styles.mutedCell}>{s.visits}</td>
                            <td className={styles.mutedCell}>{s.step4} ({pct(s.step4, s.visits)})</td>
                            <td className={styles.mutedCell}>{s.whats} ({pct(s.whats, s.visits)})</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className={styles.tableWrap}>
                    <div style={{padding:'12px 16px', fontSize:13, fontWeight:700, borderBottom:'1px solid var(--color-border)'}}>📣 Top campanhas (UTM)</div>
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
                      <th>Etapa</th>
                      <th>Tempo</th>
                      <th>WhatsApp</th>
                      <th>Status</th>
                    </tr></thead>
                    <tbody>
                      {simSessions.slice(0, 80).map((s, i) => {
                        const r = relDate(s.created_at);
                        const stp = s.max_step ?? 0;
                        const viuProposta = stp >= 4;
                        const etapaLabel = viuProposta ? 'Viu proposta' : 'Só entrou';
                        const etapaColor = viuProposta ? '#F59E0B' : '#94a3b8';
                        const wa = s.cta_clicks?.find(c => (c.label||'').toLowerCase().includes('whatsapp_sim'));
                        const status = viuProposta && wa ? '✅ Lead + zap' : viuProposta ? '🔥 Lead' : s.sim_abandon ? '🚪 Abandonou' : '⏳ Em fluxo';
                        const statusColor = viuProposta && wa ? '#22c55e' : viuProposta ? '#F59E0B' : s.sim_abandon ? '#f87171' : '#94a3b8';
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
                            <td>
                              <span style={{display:'inline-block', padding:'2px 8px', borderRadius:4, background:'rgba(255,255,255,0.05)', color:etapaColor, fontWeight:700, fontSize:12}}>
                                {stp > 0 ? etapaLabel : '—'}
                              </span>
                            </td>
                            <td className={styles.mutedCell}>{fmtTime(s.time_on_page)}</td>
                            <td className={styles.mutedCell}>{wa ? `✓ ${wa.plan ?? 'geral'}` : <span className={styles.emptyDash}>—</span>}</td>
                            <td style={{color:statusColor, fontWeight:600, fontSize:12}}>{status}</td>
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

    </div>
  );
}
