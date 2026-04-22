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
  const [selectedUser, setSelectedUser] = useState<UserRow|null>(null);

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
  const [visitPeriod, setVisitPeriod]     = useState<'hoje'|'ontem'|'3d'|'7dias'|'mes'|'maximo'>('7dias');
  const [metaLoaded, setMetaLoaded]       = useState(false);

  useEffect(() => {
    api.get('/admin/users').then(r => setUsers(r.data.users)).catch(()=>{}).finally(()=>setLoadingUsers(false));
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
    <div className={tab==='users' ? styles.pageWa : styles.page}>
      {/* ── TOP BAR apenas na aba Acessos ── */}
      {tab==='visits' && (
        <div className={styles.header} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <h1 className={styles.title}>📊 Acessos LP</h1>
            <p className={styles.subtitle}>{users.length} usuários cadastrados</p>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn-secondary" disabled={loadingAnalytics||loadingMeta}
              onClick={()=>{loadAnalytics();setMetaLoaded(false);loadMeta();}}>
              {(loadingAnalytics||loadingMeta)?'Atualizando...':'🔄 Atualizar'}
            </button>
            <button className="btn-secondary" onClick={()=>setTab('users')}>👥 CRM</button>
          </div>
        </div>
      )}
      {resetMsg && (
        <div style={{background:'rgba(34,197,94,0.1)',border:'1px solid #22c55e',color:'#22c55e',borderRadius:8,padding:'10px 16px',marginBottom:16,fontSize:13}}>
          ✓ {resetMsg}
        </div>
      )}

      {/* ═══ CRM ESTILO WHATSAPP ══════════════════════════════════ */}
      {tab==='users' && (
        <div className={styles.waRoot}>

          {/* ── SIDEBAR ── */}
          <aside className={styles.waSidebar}>
            {/* Header sidebar */}
            <div className={styles.waHeader}>
              <div className={styles.waHeaderLeft}>
                <div className={styles.waAvatar} style={{background:'#128C7E',fontSize:16}}>☀️</div>
                <div>
                  <div className={styles.waHeaderName}>SolarDocs Pro</div>
                  <div className={styles.waHeaderSub}>CRM de Usuários</div>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className={styles.waIconBtn} title="Acessos LP" onClick={()=>setTab('visits')}>📊</button>
                <button className={styles.waIconBtn} disabled={resetting} title="Reset Mensal" onClick={async()=>{
                  if(!confirm('Resetar documentos de todos os usuários FREE/PRO com data vencida?'))return;
                  setResetting(true);setResetMsg('');
                  try{const r=await api.post('/admin/reset-monthly');setResetMsg(r.data.message);}
                  catch{setResetMsg('Erro ao executar reset');}
                  finally{setResetting(false);}
                }}>🔄</button>
              </div>
            </div>

            {/* Barra de busca */}
            <div className={styles.waSearch}>
              <span className={styles.waSearchIcon}>🔍</span>
              <input
                className={styles.waSearchInput}
                placeholder="Pesquisar usuário..."
                value={search}
                onChange={e=>setSearch(e.target.value)}
              />
            </div>

            {/* Filtros de plano */}
            <div className={styles.waFilterTabs}>
              {([['todos','Todos'],['free','FREE'],['pro','PRO'],['ilimitado','VIP']] as const).map(([v,l])=>(
                <button key={v} className={filterPlano===v?styles.waFilterActive:styles.waFilterBtn} onClick={()=>setFilterPlano(v)}>{l}</button>
              ))}
            </div>

            {/* Lista de contatos */}
            <div className={styles.waContactList}>
              {filteredUsers.length===0 && (
                <div className={styles.waEmpty}>Nenhum usuário encontrado</div>
              )}
              {filteredUsers.map(u=>{
                const isNew = isToday(u.created_at);
                const r = relDate(u.created_at);
                const wpp = u.empresa_whatsapp || u.whatsapp;
                const initials = (u.empresa_nome || u.email).slice(0,2).toUpperCase();
                const planoColor = PLANO_COLOR[u.plano] || '#64748b';
                const fsRaw = u.followup_started_at;
                const isInSystem = !!fsRaw;
                const baseMs = fsRaw ? new Date(fsRaw.replace(' ','T')+'Z').getTime() : 0;
                const diffDays = isInSystem ? Math.floor((Date.now() - baseMs) / 86400000) : 0;
                const followupDay = diffDays + 1;
                const inSequence = isInSystem && !u.empresa_cnpj && followupDay >= 1 && followupDay <= 7;
                const expired = isInSystem && !u.empresa_cnpj && followupDay > 7;
                const converted = isInSystem && !!u.empresa_cnpj;
                const isSelected = selectedUser?.id === u.id;
                return (
                  <div
                    key={u.id}
                    className={`${styles.waContact} ${isSelected?styles.waContactActive:''} ${isNew?styles.waContactNew:''}`}
                    onClick={()=>setSelectedUser(isSelected?null:u)}
                  >
                    <div className={styles.waContactAvatar} style={{background:planoColor+'33',border:`2px solid ${planoColor}55`}}>
                      <span style={{color:planoColor,fontWeight:800,fontSize:13}}>{initials}</span>
                    </div>
                    <div className={styles.waContactBody}>
                      <div className={styles.waContactTop}>
                        <span className={styles.waContactName}>{u.empresa_nome || u.email.split('@')[0]}</span>
                        <span className={styles.waContactTime} style={{color:r.color}}>{r.label}</span>
                      </div>
                      <div className={styles.waContactPreview}>
                        <span className={styles.waContactMsg}>
                          {converted ? '✅ Convertido' : expired ? '❌ Sem retorno' : inSequence ? `📌 Followup dia ${followupDay}` : wpp ? `📲 ${wpp}` : u.email}
                        </span>
                        <span className={styles.waPlanBadge} style={{background:planoColor+'22',color:planoColor,borderColor:planoColor+'44'}}>{PLANO_LABEL[u.plano]??u.plano}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ── PAINEL DIREITO ── */}
          <main className={styles.waMain}>
            {!selectedUser ? (
              <div className={styles.waEmpty2}>
                <div className={styles.waEmptyIcon}>☀️</div>
                <h2 className={styles.waEmptyTitle}>SolarDocs CRM</h2>
                <p className={styles.waEmptySub}>Selecione um usuário para ver os detalhes,<br/>histórico de followup e acessar o WhatsApp.</p>
                <div className={styles.waEmptyStats}>
                  <div className={styles.waEmptyStat}><span className={styles.waEmptyStatNum} style={{color:'#22c55e'}}>{totalPeriodo}</span><span className={styles.waEmptyStatLabel}>Total</span></div>
                  <div className={styles.waEmptyStat}><span className={styles.waEmptyStatNum} style={{color:'#64748b'}}>{totalFree}</span><span className={styles.waEmptyStatLabel}>FREE</span></div>
                  <div className={styles.waEmptyStat}><span className={styles.waEmptyStatNum} style={{color:'#F59E0B'}}>{totalPro}</span><span className={styles.waEmptyStatLabel}>PRO</span></div>
                  <div className={styles.waEmptyStat}><span className={styles.waEmptyStatNum} style={{color:'#f97316'}}>{totalVip}</span><span className={styles.waEmptyStatLabel}>VIP</span></div>
                </div>
              </div>
            ) : (() => {
              const u = selectedUser;
              const wpp = u.empresa_whatsapp || u.whatsapp;
              const planoColor = PLANO_COLOR[u.plano] || '#64748b';
              const fsRaw = u.followup_started_at;
              const isInSystem = !!fsRaw;
              const baseMs = fsRaw ? new Date(fsRaw.replace(' ','T')+'Z').getTime() : 0;
              const diffDays = isInSystem ? Math.floor((Date.now() - baseMs) / 86400000) : 0;
              const followupDay = diffDays + 1;
              const inSequence = isInSystem && !u.empresa_cnpj && followupDay >= 1 && followupDay <= 7;
              const expired = isInSystem && !u.empresa_cnpj && followupDay > 7;
              const converted = isInSystem && !!u.empresa_cnpj;
              const convDay = u.followup_day_recovered ?? (converted ? followupDay : null);
              const initials = (u.empresa_nome || u.email).slice(0,2).toUpperCase();
              const r = relDate(u.created_at);
              return (
                <>
                  {/* Top bar do chat */}
                  <div className={styles.waChatHeader}>
                    <div className={styles.waContactAvatar} style={{width:42,height:42,background:planoColor+'33',border:`2px solid ${planoColor}55`,fontSize:15}}>
                      <span style={{color:planoColor,fontWeight:800}}>{initials}</span>
                    </div>
                    <div style={{flex:1}}>
                      <div className={styles.waChatName}>{u.empresa_nome || u.email.split('@')[0]}</div>
                      <div className={styles.waChatSub}>{u.email}</div>
                    </div>
                    {wpp && (
                      <a href={`https://wa.me/55${wpp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className={styles.waWhatsAppBtn}>
                        <span>💬</span> Abrir WhatsApp
                      </a>
                    )}
                    <button className={styles.waIconBtn} onClick={()=>setSelectedUser(null)} title="Fechar">✕</button>
                  </div>

                  {/* Body do chat */}
                  <div className={styles.waChatBody}>

                    {/* Bubble: dados do usuário */}
                    <div className={styles.waBubbleWrap}>
                      <div className={styles.waBubble}>
                        <div className={styles.waBubbleLabel}>📋 Dados do Usuário</div>
                        <div className={styles.waBubbleGrid}>
                          <div><span className={styles.waBubbleKey}>Email</span><span className={styles.waBubbleVal}>{u.email}</span></div>
                          <div><span className={styles.waBubbleKey}>Plano</span><span style={{fontWeight:700,color:planoColor}}>{PLANO_LABEL[u.plano]??u.plano}</span></div>
                          <div><span className={styles.waBubbleKey}>Documentos</span><span className={styles.waBubbleVal}>{u.documentos_usados}/{u.limite_documentos===999999?'∞':u.limite_documentos}</span></div>
                          <div><span className={styles.waBubbleKey}>Cadastro</span><span className={styles.waBubbleVal} style={{color:r.color}}>{r.label} {r.showTime&&r.time}</span></div>
                          {u.is_admin && <div><span className={styles.waBubbleKey}>Role</span><span style={{color:'#818cf8',fontWeight:700}}>Admin</span></div>}
                        </div>
                        <div className={styles.waBubbleTime}>{fmt(u.created_at)}</div>
                      </div>
                    </div>

                    {/* Bubble: empresa */}
                    {(u.empresa_nome || u.empresa_cnpj) && (
                      <div className={styles.waBubbleWrap}>
                        <div className={styles.waBubble}>
                          <div className={styles.waBubbleLabel}>🏢 Empresa</div>
                          <div className={styles.waBubbleGrid}>
                            {u.empresa_nome && <div><span className={styles.waBubbleKey}>Nome</span><span className={styles.waBubbleVal}>{u.empresa_nome}</span></div>}
                            {u.empresa_cnpj && <div><span className={styles.waBubbleKey}>CNPJ</span><span className={styles.waBubbleVal}>{u.empresa_cnpj}</span></div>}
                            {u.empresa_whatsapp && <div><span className={styles.waBubbleKey}>WhatsApp empresa</span><span style={{color:'#22c55e',fontWeight:600}}>{u.empresa_whatsapp}</span></div>}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Bubble: followup */}
                    <div className={styles.waBubbleWrap}>
                      <div className={`${styles.waBubble} ${converted?styles.waBubbleSuccess:expired?styles.waBubbleDanger:inSequence?styles.waBubbleWarning:''}`}>
                        <div className={styles.waBubbleLabel}>📌 Status Followup</div>
                        {!isInSystem && <div className={styles.waBubbleVal} style={{color:'var(--color-text-muted)'}}>Nenhum followup iniciado</div>}
                        {isInSystem && (
                          <div className={styles.waBubbleGrid}>
                            <div><span className={styles.waBubbleKey}>Iniciado em</span><span className={styles.waBubbleVal}>{fsRaw ? fmt(fsRaw.replace(' ','T')+'Z') : '—'}</span></div>
                            <div><span className={styles.waBubbleKey}>Dia atual</span><span style={{fontWeight:700,fontSize:18,color: inSequence?'#f59e0b':converted?'#22c55e':'#f87171'}}>#{followupDay}</span></div>
                            {converted && <div><span className={styles.waBubbleKey}>Resultado</span><span style={{color:'#22c55e',fontWeight:700}}>✅ Sucesso no dia {String(convDay??followupDay).padStart(2,'0')}</span></div>}
                            {expired && !converted && <div><span className={styles.waBubbleKey}>Resultado</span><span style={{color:'#f87171',fontWeight:700}}>❌ Sem retorno após 7 dias</span></div>}
                            {inSequence && <div><span className={styles.waBubbleKey}>Situação</span><span style={{color:'#f59e0b',fontWeight:700}}>⏳ Em andamento</span></div>}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bubble: ações rápidas */}
                    {wpp && (
                      <div className={styles.waBubbleWrap} style={{alignItems:'center'}}>
                        <div className={styles.waBubble} style={{background:'rgba(18,140,126,0.1)',border:'1px solid rgba(18,140,126,0.25)'}}>
                          <div className={styles.waBubbleLabel}>⚡ Ações Rápidas</div>
                          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:8}}>
                            <a href={`https://wa.me/55${wpp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className={styles.waActionBtn} style={{background:'#128C7E',color:'white'}}>
                              💬 Enviar mensagem no WhatsApp
                            </a>
                            <a href={`https://wa.me/55${wpp.replace(/\D/g,'')}?text=Olá!%20Vi%20que%20você%20tem%20interesse%20no%20SolarDocs%20Pro.%20Posso%20te%20ajudar?`} target="_blank" rel="noopener noreferrer" className={styles.waActionBtn}>
                              📝 Iniciar followup padrão
                            </a>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                </>
              );
            })()}
          </main>
        </div>
      )}

      {/* ═══ ABA ACESSOS LP ═════════════════════════════════════ */}
      {tab === 'visits' && (
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
            <span style={{fontSize:12,color:'var(--color-text-muted)',marginLeft:'auto'}}>{baseSessions.length} registros no período</span>
          </div>

          {loadingAnalytics ? (
            <div className={styles.loading}>Carregando estatísticas...</div>
          ) : (
            <>
              {(() => {
                const ctaGratis = baseSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('grátis'))).length;
                const ctaPro    = baseSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('pro'))).length;
                const ctaVip    = baseSessions.filter(s => s.cta_clicks?.some(c => c.label?.toLowerCase().includes('vip'))).length;

                return (
                  <div className={styles.cards} style={{gridTemplateColumns:'repeat(4,1fr)', marginTop: 12}}>
                    <div className={styles.card}>
                      <div className={styles.cardLabel}>Acessaram a LP</div>
                      <div className={styles.cardValue} style={{color:'var(--color-primary)'}}>{baseSessions.length}</div>
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
                );
              })()}
            </>
          )}
        </>
      )}

    </div>
  );
}
