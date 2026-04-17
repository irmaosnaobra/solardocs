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
}
interface SessionRow {
  session_id: string | null; created_at: string;
  utm_source: string | null; utm_medium: string | null;
  utm_campaign: string | null; utm_content: string | null;
  referrer: string | null; landing_url: string | null;
  user_agent: string | null; ip: string | null;
  max_scroll: number; sections_seen: string[];
  cta_clicks: Array<{ label?: string; href?: string }>;
  time_on_page: number | null;
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
  const [tab, setTab] = useState<'users'|'visits'>('users');

  const [users, setUsers]               = useState<UserRow[]>([]);
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
  const [metaPeriod, setMetaPeriod]       = useState<'today'|'7d'|'30d'>('today');
  const [metaLoaded, setMetaLoaded]       = useState(false);

  useEffect(() => {
    api.get('/admin/users').then(r => setUsers(r.data.users)).catch(()=>{}).finally(()=>setLoadingUsers(false));
  }, []);

  const loadAnalytics = useCallback(() => {
    setLoadingAnalytics(true);
    api.get('/admin/analytics?limit=300').then(r=>{setAnalytics(r.data);setAnalyticsLoaded(true);}).catch(()=>{}).finally(()=>setLoadingAnalytics(false));
  }, []);

  const loadMeta = useCallback((p: string) => {
    setLoadingMeta(true);
    api.get(`/admin/meta-funnel?period=${p}`).then(r=>{setMetaData(r.data);setMetaLoaded(true);}).catch(()=>{}).finally(()=>setLoadingMeta(false));
  }, []);

  useEffect(() => { if (tab==='visits' && !analyticsLoaded) loadAnalytics(); }, [tab,analyticsLoaded,loadAnalytics]);
  useEffect(() => { if (tab==='visits' && !metaLoaded) loadMeta(metaPeriod); }, [tab,metaLoaded,metaPeriod,loadMeta]);

  function changePeriod(p: 'today'|'7d'|'30d') {
    setMetaPeriod(p); setMetaLoaded(false); loadMeta(p);
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

  const totalHoje = users.filter(u=>isToday(u.created_at)).length;
  const totalPro  = users.filter(u=>u.plano==='pro').length;
  const totalVip  = users.filter(u=>u.plano==='ilimitado').length;
  const totalFree = users.filter(u=>u.plano==='free').length;

  const allSources      = Array.from(new Set((analytics?.sessions??[]).map(s=>srcLabel(s)))).sort();
  const filteredSessions = (analytics?.sessions??[]).filter(s => {
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
            onClick={()=>{loadAnalytics();setMetaLoaded(false);loadMeta(metaPeriod);}}>
            {(loadingAnalytics||loadingMeta)?'Atualizando...':'🔄 Atualizar'}
          </button>
        )}
      </div>

      {resetMsg && (
        <div style={{background:'rgba(34,197,94,0.1)',border:'1px solid #22c55e',color:'#22c55e',borderRadius:8,padding:'10px 16px',marginBottom:16,fontSize:13}}>
          ✓ {resetMsg}
        </div>
      )}

      <div className={styles.tabs}>
        <button className={tab==='users'?styles.tabActive:styles.tab} onClick={()=>setTab('users')}>👥 Usuários</button>
        <button className={tab==='visits'?styles.tabActive:styles.tab} onClick={()=>setTab('visits')}>📊 Acessos LP</button>
      </div>

      {/* ═══ ABA USUÁRIOS ══════════════════════════════════════ */}
      {tab==='users' && (
        <>
          <div className={styles.cards}>
            <div className={styles.card}><div className={styles.cardLabel}>Novos hoje</div><div className={styles.cardValue} style={{color:'#22c55e'}}>{totalHoje}</div></div>
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
              <thead><tr><th>Email</th><th>Empresa</th><th>WhatsApp</th><th>Plano</th><th>Docs</th><th>Cadastro</th><th>Followup</th><th>Resultado Followup</th></tr></thead>
              <tbody>
                {filteredUsers.length===0&&<tr><td colSpan={8} className={styles.empty}>Nenhum usuário encontrado</td></tr>}
                {filteredUsers.map(u=>{
                  const baseDate    = u.followup_started_at ? new Date(u.followup_started_at.replace(' ', 'T')) : null;
                  const isInSystem  = !!baseDate;
                  const diffDays    = baseDate ? Math.floor((Date.now() - baseDate.getTime()) / 86400000) : 0;
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

      {/* ═══ ABA ACESSOS LP ═════════════════════════════════════ */}
      {tab==='visits' && (
        <>
          {/* ── BLOCO META ADS ── */}
          <div className={styles.metaBlock}>
            <div className={styles.metaBlockHeader}>
              <div className={styles.metaBlockTitle}>
                <span className={styles.metaFIcon}>f</span>
                <span>Meta Ads</span>
                {loadingMeta && <span className={styles.metaSpinner} />}
              </div>
              <div className={styles.periodTabs}>
                {(['today','7d','30d'] as const).map(p=>(
                  <button key={p} className={metaPeriod===p?styles.periodActive:styles.periodBtn}
                    onClick={()=>changePeriod(p)} disabled={loadingMeta}>
                    {p==='today'?'Hoje':p==='7d'?'7 dias':'30 dias'}
                  </button>
                ))}
              </div>
            </div>

            {metaData?.available===false && (
              <div className={styles.setupCallout}>
                <span>⚙️</span>
                <div>
                  <strong>Configure o Meta Ads</strong>
                  <p>Adicione <code>META_AD_ACCOUNT_ID</code> e <code>META_PIXEL_TOKEN</code> (com permissão <code>ads_read</code>) nas variáveis de ambiente da Vercel.</p>
                </div>
              </div>
            )}

            {metaData?.available && mt && lpf && funnelSteps.length > 0 && (
              <>
                {/* Funil SVG estilo UTMify */}
                <div className={styles.funnelCard} style={{marginBottom:20}}>
                  <div className={styles.funnelTitle}>Funil de Conversão (Meta Ads → LP)</div>
                  <FunnelSVG steps={funnelSteps} />
                </div>

                {/* Grid de métricas financeiras */}
                <div className={styles.metaFinGrid}>
                  {metaFinCards.map(c=>(
                    <div key={c.label} className={styles.metaFinCard}>
                      <div className={styles.metaFinLabel}>{c.label}</div>
                      <div className={styles.metaFinValue} style={{color:c.color}}>{c.value}</div>
                    </div>
                  ))}
                </div>

                {/* Por conjunto de anúncio */}
                {(metaData.adsets??[]).length>0 && (
                  <div className={styles.sourcesCard} style={{marginTop:20}}>
                    <div className={styles.funnelTitle}>Por conjunto de anúncio</div>
                    <div className={styles.tableWrap} style={{marginTop:12}}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Conjunto / Campanha</th>
                            <th>Gasto</th><th>Impr.</th><th>Cliques</th>
                            <th>CTR</th><th>CPC</th>
                            <th>Visitas LP</th><th>Viu Preços</th><th>CTA</th><th>Tempo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(metaData.adsets??[]).map(a=>(
                            <tr key={a.adset_id}>
                              <td>
                                <div style={{fontWeight:600,fontSize:12}}>{a.adset_name}</div>
                                <div style={{fontSize:11,color:'var(--color-text-muted)'}}>{a.campaign_name}</div>
                              </td>
                              <td style={{color:'#f87171',fontWeight:600}}>{fmtBRL(a.spend)}</td>
                              <td className={styles.mutedCell}>{fmtNum(a.impressions)}</td>
                              <td className={styles.mutedCell}>{fmtNum(a.clicks)}</td>
                              <td className={styles.mutedCell}>{a.ctr.toFixed(2)}%</td>
                              <td className={styles.mutedCell}>{fmtBRL(a.cpc)}</td>
                              <td><span className={styles.metricBadge} style={{background:'rgba(52,211,153,0.12)',color:'#34d399',borderColor:'rgba(52,211,153,0.25)'}}>{a.lp_visits}</span></td>
                              <td><span className={styles.metricBadge} style={{background:'rgba(251,146,60,0.12)',color:'#fb923c',borderColor:'rgba(251,146,60,0.25)'}}>{a.saw_precos}{a.lp_visits>0&&<span className={styles.funnelPctInline}> {pct(a.saw_precos,a.lp_visits)}</span>}</span></td>
                              <td><span className={styles.metricBadge} style={{background:'rgba(167,139,250,0.12)',color:'#a78bfa',borderColor:'rgba(167,139,250,0.25)'}}>{a.cta_clicks}{a.lp_visits>0&&<span className={styles.funnelPctInline}> {pct(a.cta_clicks,a.lp_visits)}</span>}</span></td>
                              <td className={styles.mutedCell}>{fmtTime(a.avg_time)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.sectionDivider}/>

          {/* ── ANALYTICS GERAL ── */}
          {loadingAnalytics && <div className={styles.loading}>Carregando...</div>}
          {!loadingAnalytics && analytics && (
            <>
              <div className={styles.sectionLabel2}>Todos os canais</div>
              <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)'}}>
                <div className={styles.card}><div className={styles.cardLabel}>Total visitas</div><div className={styles.cardValue} style={{color:'#22c55e'}}>{analytics.total}</div></div>
                <div className={styles.card}><div className={styles.cardLabel}>Hoje</div><div className={styles.cardValue} style={{color:'#60a5fa'}}>{analytics.today}</div></div>
                <div className={styles.card}><div className={styles.cardLabel}>Clicaram CTA</div><div className={styles.cardValue} style={{color:'#a78bfa'}}>{fn?.cta_clicks??0}</div><div className={styles.cardSub}>{pct(fn?.cta_clicks??0,fn?.visits??0)} do total</div></div>
                <div className={styles.card}><div className={styles.cardLabel}>Tempo médio</div><div className={styles.cardValue} style={{color:'#fb923c'}}>{fmtTime(analytics.avg_time)}</div></div>
              </div>

              {fn && fn.visits>0 && (
                <div className={styles.funnelCard}>
                  <div className={styles.funnelTitle}>Funil — todos os canais</div>
                  <div className={styles.funnelSteps}>
                    {[
                      {label:'Visitas',icon:'👁️',value:fn.visits,pctVal:100},
                      {label:'Scroll 50%',icon:'📜',value:fn.scroll_50,pctVal:Math.round(fn.scroll_50/fn.visits*100)},
                      {label:'Viu Preços',icon:'💰',value:fn.saw_precos,pctVal:Math.round(fn.saw_precos/fn.visits*100)},
                      {label:'Clicou CTA',icon:'🖱️',value:fn.cta_clicks,pctVal:Math.round(fn.cta_clicks/fn.visits*100)},
                    ].map((step,i)=>(
                      <div key={i} className={styles.funnelStep}>
                        <div className={styles.funnelIcon}>{step.icon}</div>
                        <div className={styles.funnelBar}><div className={styles.funnelFill} style={{width:`${step.pctVal}%`}}/></div>
                        <div className={styles.funnelMeta}>
                          <span className={styles.funnelValue}>{step.value}</span>
                          <span className={styles.funnelPct}>{step.pctVal}%</span>
                          <span className={styles.funnelLabel}>{step.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analytics?.conversion && (
                <div className={styles.funnelCard} style={{marginTop:16}}>
                  <div className={styles.funnelTitle}>Funil de Conversão — Plataforma</div>
                  <div className={styles.funnelSteps}>
                    {(() => {
                      const cv = analytics.conversion;
                      const base = Math.max(fn?.cta_clicks ?? 0, cv.cadastros, 1);
                      const steps = [
                        { label: 'Clicaram no CTA',          icon: '🖱️', value: fn?.cta_clicks ?? 0,  color: '#60a5fa' },
                        { label: 'Cadastraram (Lead)',         icon: '✍️', value: cv.cadastros,         color: '#a78bfa' },
                        { label: 'Concluíram inscrição',       icon: '🏢', value: cv.empresas,          color: '#34d399' },
                        { label: 'Assinaram (Purchase)',       icon: '💳', value: cv.assinantes,        color: '#fbbf24' },
                      ];
                      return steps.map((s, i) => (
                        <div key={i} className={styles.funnelStep}>
                          <div className={styles.funnelIcon}>{s.icon}</div>
                          <div className={styles.funnelBar}>
                            <div className={styles.funnelFill} style={{ width: `${Math.round(s.value / base * 100)}%`, background: s.color }} />
                          </div>
                          <div className={styles.funnelMeta}>
                            <span className={styles.funnelValue} style={{color: s.color}}>{s.value}</span>
                            <span className={styles.funnelPct}>{Math.round(s.value / base * 100)}%</span>
                            <span className={styles.funnelLabel}>{s.label}</span>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                  <div style={{display:'flex',gap:16,marginTop:14,paddingTop:12,borderTop:'1px solid var(--color-border)',flexWrap:'wrap'}}>
                    {analytics.conversion.cadastros > 0 && (
                      <span style={{fontSize:12,color:'var(--color-text-muted)'}}>
                        Taxa CTA→Cadastro: <strong style={{color:'#a78bfa'}}>{pct(analytics.conversion.cadastros, fn?.cta_clicks ?? 0)}</strong>
                      </span>
                    )}
                    {analytics.conversion.cadastros > 0 && (
                      <span style={{fontSize:12,color:'var(--color-text-muted)'}}>
                        Taxa Cadastro→Empresa: <strong style={{color:'#34d399'}}>{pct(analytics.conversion.empresas, analytics.conversion.cadastros)}</strong>
                      </span>
                    )}
                    {analytics.conversion.empresas > 0 && (
                      <span style={{fontSize:12,color:'var(--color-text-muted)'}}>
                        Taxa Empresa→Assinante: <strong style={{color:'#fbbf24'}}>{pct(analytics.conversion.assinantes, analytics.conversion.empresas)}</strong>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {analytics.sources.length>0 && (
                <div className={styles.sourcesCard}>
                  <div className={styles.funnelTitle}>Por origem</div>
                  <div className={styles.tableWrap} style={{marginTop:12}}>
                    <table className={styles.table}>
                      <thead><tr><th>Origem</th><th>Visitas</th><th>Scroll 50%</th><th>Viu Preços</th><th>CTA</th></tr></thead>
                      <tbody>
                        {analytics.sources.map(s=>(
                          <tr key={s.source}>
                            <td><span className={styles.sourceTag}>{s.source}</span></td>
                            <td className={styles.mutedCell}>{s.visits}</td>
                            <td className={styles.mutedCell}>{s.scroll_50} <span className={styles.funnelPctInline}>{pct(s.scroll_50,s.visits)}</span></td>
                            <td className={styles.mutedCell}>{s.saw_precos} <span className={styles.funnelPctInline}>{pct(s.saw_precos,s.visits)}</span></td>
                            <td className={styles.mutedCell}>{s.cta_clicks} <span className={styles.funnelPctInline}>{pct(s.cta_clicks,s.visits)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {analytics.top_ctas.length>0 && (
                <div className={styles.sourcesCard}>
                  <div className={styles.funnelTitle}>Botões mais clicados</div>
                  <div className={styles.ctaList}>
                    {analytics.top_ctas.map((c,i)=>(
                      <div key={i} className={styles.ctaItem}>
                        <span className={styles.ctaLabel}>{c.label}</span>
                        <div className={styles.ctaBarWrap}><div className={styles.ctaBar} style={{width:`${Math.round(c.count/(analytics.top_ctas[0]?.count||1)*100)}%`}}/></div>
                        <span className={styles.ctaCount}>{c.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.filters} style={{marginTop:24}}>
                <input type="text" placeholder="Buscar campanha, criativo, IP..." value={visitSearch} onChange={e=>setVisitSearch(e.target.value)} className="input-field" style={{maxWidth:280}}/>
                <select value={filterSource} onChange={e=>setFilterSource(e.target.value)} className="input-field" style={{maxWidth:180}}>
                  <option value="">Todas as origens</option>
                  {allSources.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Data/Hora</th><th>Origem</th><th>Campanha</th><th>Disp.</th><th>Scroll</th><th>Seções</th><th>Tempo</th><th>CTA</th></tr></thead>
                  <tbody>
                    {filteredSessions.length===0&&<tr><td colSpan={8} className={styles.empty}>Nenhum acesso registrado</td></tr>}
                    {filteredSessions.map((s,i)=>{
                      const key = s.session_id??`no-sid-${i}`;
                      const isExp = expandedSession===key;
                      return (
                        <React.Fragment key={key}>
                          <tr className={`${isToday(s.created_at)?styles.rowNew:''} ${styles.rowClickable}`} onClick={()=>setExpandedSession(isExp?null:key)}>
                            <td className={styles.mutedCell} style={{whiteSpace:'nowrap'}}>{fmt(s.created_at)}</td>
                            <td><span className={styles.sourceTag}>{srcLabel(s)}</span></td>
                            <td className={styles.mutedCell}>{s.utm_campaign??<span className={styles.emptyDash}>—</span>}</td>
                            <td className={styles.mutedCell}>{deviceIcon(s.user_agent)}</td>
                            <td>{s.max_scroll>0?<span className={styles.scrollTag}>{s.max_scroll}%</span>:<span className={styles.emptyDash}>—</span>}</td>
                            <td>{s.sections_seen.length>0?<div className={styles.sectionPills}>{s.sections_seen.map(sec=><span key={sec} className={`${styles.sectionPill}${sec==='precos'?` ${styles.sectionPillHighlight}`:''}`}>{SECTION_LABEL[sec]??sec}</span>)}</div>:<span className={styles.emptyDash}>—</span>}</td>
                            <td className={styles.mutedCell}>{fmtTime(s.time_on_page)}</td>
                            <td>{s.cta_clicks.length>0?<span className={styles.ctaClickTag}>{s.cta_clicks.length} clique{s.cta_clicks.length>1?'s':''}</span>:<span className={styles.emptyDash}>—</span>}</td>
                          </tr>
                          {isExp&&(
                            <tr className={styles.expandedRow}>
                              <td colSpan={8}>
                                <div className={styles.expandedContent}>
                                  <div className={styles.expandedGrid}>
                                    <div><span className={styles.expandedLabel}>Session ID</span><span className={styles.expandedVal}>{s.session_id??'—'}</span></div>
                                    <div><span className={styles.expandedLabel}>IP</span><span className={styles.expandedVal}>{s.ip??'—'}</span></div>
                                    <div><span className={styles.expandedLabel}>UTM Medium</span><span className={styles.expandedVal}>{s.utm_medium??'—'}</span></div>
                                    <div><span className={styles.expandedLabel}>UTM Content</span><span className={styles.expandedVal}>{s.utm_content??'—'}</span></div>
                                    <div><span className={styles.expandedLabel}>Referrer</span><span className={styles.expandedVal}>{s.referrer??'Acesso direto'}</span></div>
                                    <div><span className={styles.expandedLabel}>URL</span><span className={styles.expandedVal} style={{wordBreak:'break-all'}}>{s.landing_url??'—'}</span></div>
                                  </div>
                                  {s.cta_clicks.length>0&&(
                                    <div style={{marginTop:10}}>
                                      <span className={styles.expandedLabel}>Botões clicados:</span>
                                      <div className={styles.ctaClickList}>{s.cta_clicks.map((c,ci)=><span key={ci} className={styles.ctaClickBadge}>{c.label??'CTA'}</span>)}</div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
