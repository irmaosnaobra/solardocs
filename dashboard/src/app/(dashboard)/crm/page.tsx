'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import api from '@/services/api';
import './crm.css';

// ── Tipos ─────────────────────────────────────────────────────────

interface SdrLead {
  phone: string;
  nome: string | null;
  cidade: string | null;
  estado: string | null;
  estagio: string;
  ultima_mensagem: string | null;
  total_mensagens: number;
  updated_at: string;
  created_at?: string;
  ultimo_contato?: string;
  contatos?: number;
  instance?: string | null;
  human_takeover?: boolean;
  ctwa_clid?: string | null;

  canal_atendimento?: string | null;
  horario_atendimento?: string | null;
  horario_iso?: string | null;
  agendado_at?: string | null;
  endereco_vistoria?: string | null;
  lembrete_enviado_at?: string | null;

  notas_internas?: string | null;
  tags?: string[];

  qualif_consumo?: number | null;
  qualif_padrao?: string | null;
  qualif_telhado?: string | null;
  qualif_dor?: string | null;
  qualif_pagamento?: string | null;
  qualif_casa?: string | null;
  qualif_aumento_consumo?: boolean | null;

  consultor?: string | null;
  valor_venda?: number | null;
  codigo_contrato?: string | null;
}

interface PlatLead {
  id: string; email: string; whatsapp: string | null; plano: string;
  empresa: string | null; cnpj: string | null; documentos_usados: number;
  created_at: string; ativo_recente: boolean; crm_estagio: string | null;
}

interface Metrics {
  total: number;
  hoje: number;
  mes: number;
  por_estagio: Record<string, number>;
  conversao_pct: number;
  agendados_24h: any[];
  em_takeover: number;
  valor_vendido_mes: number;
  valor_vendido_ano: number;
  meta_mes?: number;
}

interface Insights {
  resumo?: string;
  score?: number | null;
  proxima_acao?: string | null;
}

// ── Configurações dos Kanbans ──────────────────────────────────────

const SDR_COLS = [
  { id: 'reativacao', label: 'Reativação', emoji: '⚡', color: '#a855f7', bg: 'rgba(168,85,247,0.1)',   border: 'rgba(168,85,247,0.3)' },
  { id: 'novo',       label: 'Novo',       emoji: '🆕', color: '#64748b', bg: 'rgba(100,116,139,0.1)',  border: 'rgba(100,116,139,0.3)' },
  { id: 'frio',       label: 'Frio',       emoji: '🔵', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',   border: 'rgba(59,130,246,0.3)' },
  { id: 'morno',      label: 'Morno',      emoji: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.3)' },
  { id: 'quente',     label: 'Quente',     emoji: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.3)' },
  { id: 'fechamento', label: 'Fechado',    emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',    border: 'rgba(34,197,94,0.3)' },
  { id: 'perdido',    label: 'Perdido',    emoji: '❌', color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)' },
];

const CONSULTORES = [
  { id: 'diego',    nome: 'Diego',    inicial: 'D', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)' },
  { id: 'giovanna', nome: 'Giovanna', inicial: 'G', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.4)' },
  { id: 'nilce',    nome: 'Nilce',    inicial: 'N', color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)' },
  { id: 'thiago',   nome: 'Thiago',   inicial: 'T', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
];

const PLAT_COLS = [
  { id: 'sem_cnpj',   label: 'Sem CNPJ',           emoji: '📋', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)' },
  { id: 'desativado', label: 'Cadastro Desativado', emoji: '😴', color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.3)' },
  { id: 'ativo',      label: 'Cadastro Ativo',      emoji: '⚡', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)' },
  { id: 'pro',        label: 'PRO',                 emoji: '🚀', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)',  border: 'rgba(139,92,246,0.3)' },
  { id: 'vip',        label: 'VIP',                 emoji: '👑', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
];

const POLL_INTERVAL_MS = 30_000;

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// Phone pode vir com sufixo "#0042" pra leads de venda múltipla. Strip pra exibir.
function stripPhoneSuffix(p: string): string {
  return (p || '').split('#')[0];
}

function fmtPhone(p: string) {
  const d = stripPhoneSuffix(p).replace(/\D/g, '');
  const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `${local.slice(0,2)} ${local.slice(2,7)}-${local.slice(7,11)}`;
  if (local.length === 10) return `${local.slice(0,2)} ${local.slice(2,6)}-${local.slice(6,10)}`;
  return p;
}

function fmtMoney(v?: number | null): string {
  if (v == null || isNaN(Number(v))) return 'R$ 0';
  const n = Number(v);
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(1)}k`;
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function canalLabel(c: string | null | undefined): string {
  if (c === 'ligacao') return '📞 Ligação';
  if (c === 'meet') return '🎥 Meet';
  if (c === 'vistoria') return '🏠 Vistoria';
  return '';
}

// ── Componentes ────────────────────────────────────────────────────

// Pílula compacta com label uppercase + valor inline (cabe na linha do header)
function MetricPill({ label, value, color, progress, meta }: {
  label: string; value: string | number; color?: string;
  progress?: number; meta?: string;
}) {
  const pct = progress != null ? Math.max(0, Math.min(100, progress)) : null;
  const barColor = pct == null ? color : (pct >= 100 ? '#22c55e' : pct >= 70 ? '#84cc16' : pct >= 40 ? '#f59e0b' : '#ef4444');
  return (
    <span
      className="crm-metric-pill"
      title={meta ? `${label}: ${value} · ${meta}${pct != null ? ` (${pct.toFixed(0)}%)` : ''}` : undefined}
    >
      <span className="crm-metric-label">{label}</span>
      <span className="crm-metric-value" style={{ color: color || 'var(--color-text)' }}>{value}</span>
      {pct != null && (
        <span style={{
          display: 'inline-block', width: 22, height: 4, borderRadius: 999,
          background: 'rgba(100,116,139,0.25)', overflow: 'hidden', flexShrink: 0,
        }}>
          <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: barColor }} />
        </span>
      )}
    </span>
  );
}

function KanbanCol({ col, children, count, onDropPhone, isDragOver, onDragEnter, onDragLeave }: {
  col: typeof SDR_COLS[0];
  children: React.ReactNode;
  count: number;
  onDropPhone?: (phone: string, estagio: string) => void;
  isDragOver?: boolean;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
}) {
  return (
    <div className="crm-kanban-col"
      onDragOver={(e) => { if (onDropPhone) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDragEnter={(e) => { if (onDropPhone) { e.preventDefault(); onDragEnter?.(); } }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        if (!onDropPhone) return;
        e.preventDefault();
        const phone = e.dataTransfer.getData('text/plain');
        if (phone) onDropPhone(phone, col.id);
        onDragLeave?.();
      }}>
      <div className="crm-col-head" style={{
        background: col.bg,
        border: `1px solid ${col.border}`,
        borderBottom: 'none',
        color: col.color,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {col.emoji} {col.label}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
          border: `1px solid ${col.border}`, color: col.color, flexShrink: 0,
        }}>{count}</span>
      </div>
      <div className="crm-col-body" style={{
        border: `1px solid ${col.border}`,
        background: isDragOver ? 'rgba(99,179,237,0.08)' : 'rgba(255,255,255,0.01)',
        boxShadow: isDragOver ? `inset 0 0 0 2px var(--color-primary)` : undefined,
        transition: 'background 0.15s',
      }}>
        {children}
      </div>
    </div>
  );
}

function Badge({ children, color = 'gray', title }: { children: React.ReactNode; color?: string; title?: string }) {
  const colors: Record<string, [string, string, string]> = {
    gray:   ['rgba(100,116,139,0.12)', 'rgba(100,116,139,0.3)', '#94a3b8'],
    amber:  ['rgba(245,158,11,0.15)', 'rgba(245,158,11,0.3)', '#f59e0b'],
    purple: ['rgba(168,85,247,0.15)', 'rgba(168,85,247,0.3)', '#a855f7'],
    green:  ['rgba(34,197,94,0.12)', 'rgba(34,197,94,0.3)', '#22c55e'],
    blue:   ['rgba(59,130,246,0.12)', 'rgba(59,130,246,0.3)', '#3b82f6'],
    red:    ['rgba(239,68,68,0.12)', 'rgba(239,68,68,0.3)', '#ef4444'],
  };
  const [bg, border, fg] = colors[color] || colors.gray;
  return (
    <span title={title} style={{
      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
      background: bg, color: fg, border: `1px solid ${border}`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function SdrCard({ lead, onClick, onMove, onToggleTakeover, onSetConsultor }: {
  lead: SdrLead;
  onClick: () => void;
  onMove: (phone: string, estagio: string) => void;
  onToggleTakeover: (phone: string, takeover: boolean) => void;
  onSetConsultor: (phone: string, consultor: string | null) => void;
}) {
  const col = SDR_COLS.find(c => c.id === lead.estagio) ?? SDR_COLS[0];
  const isTakeover = !!lead.human_takeover;
  const isIO = lead.instance === 'io';
  const fromMeta = !!lead.ctwa_clid;
  const agendado = !!lead.canal_atendimento && !!lead.horario_atendimento;
  const consultor = CONSULTORES.find(c => c.id === lead.consultor);

  // Sinaliza lead que precisa atenção: agendamento próximo, sem resposta há tempo
  const horarioMs = lead.horario_iso ? new Date(lead.horario_iso).getTime() : 0;
  const agendamentoProximo = horarioMs && (horarioMs - Date.now()) > 0 && (horarioMs - Date.now()) < 60 * 60 * 1000;

  const qualif: string[] = [];
  if (lead.qualif_consumo) qualif.push(`R$${lead.qualif_consumo}`);
  if (lead.qualif_padrao) qualif.push(lead.qualif_padrao);
  if (lead.qualif_telhado) qualif.push(lead.qualif_telhado);
  if (lead.qualif_pagamento) qualif.push(lead.qualif_pagamento);

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', lead.phone);
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={{
        background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
        borderLeft: `3px solid ${col.color}`, borderRadius: 8, padding: '8px 10px',
        cursor: 'grab', transition: 'transform 0.1s',
        ...(agendamentoProximo && { boxShadow: '0 0 0 2px rgba(239,68,68,0.4)' }),
      }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {consultor && (
          <span title={`Consultor: ${consultor.nome}`} style={{
            width: 16, height: 16, borderRadius: '50%',
            background: consultor.bg, border: `1.5px solid ${consultor.border}`,
            color: consultor.color, fontSize: 9, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>{consultor.inicial}</span>
        )}
        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' }}>
          {lead.nome || 'Sem nome'}
        </span>
        {isIO && <Badge color="amber" title="Linha Irmãos na Obra">☀️ IO</Badge>}
        {fromMeta && <Badge color="blue" title="Veio de anúncio Meta">📢 Ad</Badge>}
        {isTakeover ? <Badge color="purple" title="Humano assumiu">🤝 Humano</Badge> : <Badge color="green" title="Luma atendendo">🤖 Luma</Badge>}
        {agendamentoProximo && <Badge color="red" title="Agendamento em &lt; 1h">⏰ Próximo!</Badge>}
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        {lead.cidade ? `📍 ${lead.cidade}${lead.estado ? `/${lead.estado}` : ''} · ` : ''}
        {fmtPhone(lead.phone)}
      </div>

      {agendado && (
        <div style={{
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 6, padding: '4px 8px', marginBottom: 6,
          fontSize: 11, fontWeight: 700, color: '#22c55e',
        }}>
          📅 {canalLabel(lead.canal_atendimento)} · {lead.horario_atendimento}
        </div>
      )}

      {lead.estagio === 'fechamento' && (
        <div style={{
          background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: 6, padding: '6px 10px', marginBottom: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
        }}>
          {lead.codigo_contrato && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>
              {lead.codigo_contrato}
            </span>
          )}
          <span style={{ fontSize: 13, fontWeight: 800, color: '#22c55e', marginLeft: 'auto' }}>
            {lead.valor_venda != null && lead.valor_venda > 0
              ? `R$ ${Number(lead.valor_venda).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : 'sem valor'}
          </span>
        </div>
      )}

      {qualif.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
          {qualif.map((q, i) => (
            <span key={i} style={{
              fontSize: 10, padding: '1px 5px', borderRadius: 4,
              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}>{q}</span>
          ))}
        </div>
      )}

      {lead.tags && lead.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
          {lead.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
              background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)',
              color: '#a855f7',
            }}>#{tag}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }} onClick={e => e.stopPropagation()}>
        <a href={`https://wa.me/${stripPhoneSuffix(lead.phone)}`} target="_blank" rel="noopener noreferrer"
          style={{ padding: '3px 8px', borderRadius: 6, background: '#25d366', color: '#fff', fontWeight: 700, fontSize: 10, textDecoration: 'none' }}>💬</a>
        <select value={lead.estagio} onChange={e => onMove(lead.phone, e.target.value)}
          style={{ fontSize: 10, padding: '2px 4px', borderRadius: 6, border: `1px solid ${col.border}`, background: col.bg, color: col.color, fontWeight: 700, cursor: 'pointer', flex: 1 }}>
          {SDR_COLS.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>
        <button onClick={() => onToggleTakeover(lead.phone, !isTakeover)}
          title={isTakeover ? 'Devolver pra Luma' : 'Assumir manualmente'}
          style={{
            padding: '3px 6px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
            border: '1px solid var(--color-border)',
            background: isTakeover ? 'rgba(34,197,94,0.12)' : 'rgba(168,85,247,0.12)',
            color: isTakeover ? '#22c55e' : '#a855f7',
          }}>{isTakeover ? '↩️' : '🙋'}</button>
      </div>
      <div onClick={e => e.stopPropagation()}>
        <select value={lead.consultor || ''} onChange={e => onSetConsultor(lead.phone, e.target.value || null)}
          title="Consultor responsável"
          style={{
            width: '100%', fontSize: 10, padding: '2px 6px', borderRadius: 6,
            border: `1px solid ${consultor ? consultor.border : 'var(--color-border)'}`,
            background: consultor ? consultor.bg : 'var(--color-bg)',
            color: consultor ? consultor.color : 'var(--color-text-muted)',
            fontWeight: 700, cursor: 'pointer',
          }}>
          <option value="">👤 Sem consultor</option>
          {CONSULTORES.map(c => <option key={c.id} value={c.id}>{c.inicial} · {c.nome}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
        💬 {lead.total_mensagens}{lead.contatos ? ` · 📤 ${lead.contatos}` : ''} · {timeAgo(lead.updated_at)}
      </div>
    </div>
  );
}

// ── Drawer de detalhe ──────────────────────────────────────────────

function LeadDrawer({ lead, onClose, onUpdate, onSetConsultor }: {
  lead: SdrLead | null;
  onClose: () => void;
  onUpdate: () => void;
  onSetConsultor: (phone: string, consultor: string | null) => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [notas, setNotas] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [msgManual, setMsgManual] = useState('');
  const [valorVenda, setValorVenda] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setNotas(lead.notas_internas || '');
    setTagsInput((lead.tags || []).join(', '));
    setValorVenda(lead.valor_venda != null ? String(lead.valor_venda) : '');
    setInsights(null);
    api.get(`/admin/sdr-leads/${lead.phone}/history`)
      .then(r => setHistory(r.data.messages || []))
      .catch(() => setHistory([]));
  }, [lead]);

  if (!lead) return null;

  async function gerarInsights() {
    if (!lead) return;
    setLoadingInsights(true);
    try {
      const r = await api.get(`/admin/sdr-leads/${lead.phone}/insights`);
      setInsights(r.data);
    } catch { setInsights({ resumo: 'Erro gerando insights' }); }
    finally { setLoadingInsights(false); }
  }

  async function salvarNotas() {
    if (!lead) return;
    setBusy(true);
    await api.patch(`/admin/sdr-leads/${lead.phone}/notas`, { notas });
    setBusy(false);
  }

  async function salvarValorVenda() {
    if (!lead) return;
    setBusy(true);
    const v = valorVenda.replace(/\./g, '').replace(',', '.');
    const num = v === '' ? null : Number(v);
    await api.patch(`/admin/sdr-leads/${lead.phone}/valor-venda`, { valor: num });
    setBusy(false);
    onUpdate();
  }

  async function salvarTags() {
    if (!lead) return;
    const tags = tagsInput.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
    setBusy(true);
    await api.patch(`/admin/sdr-leads/${lead.phone}/tags`, { tags });
    setBusy(false);
    onUpdate();
  }

  async function enviarMsg() {
    if (!lead || !msgManual.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/sdr-leads/${lead.phone}/send-message`, { message: msgManual.trim() });
      setMsgManual('');
      const r = await api.get(`/admin/sdr-leads/${lead.phone}/history`);
      setHistory(r.data.messages || []);
      onUpdate();
    } catch (e: any) { alert('Erro: ' + (e?.response?.data?.error || e.message)); }
    finally { setBusy(false); }
  }

  async function forcarFollowup() {
    if (!lead) return;
    if (!confirm('Forçar follow-up agora? A Luma vai mandar próxima mensagem no próximo cron (~1 min).')) return;
    setBusy(true);
    await api.post(`/admin/sdr-leads/${lead.phone}/force-followup`);
    setBusy(false);
    onUpdate();
  }

  async function cancelarAgendamento() {
    if (!lead) return;
    if (!confirm('Cancelar agendamento? O lead volta pro estágio "morno" mas continua vivo.')) return;
    setBusy(true);
    await api.post(`/admin/sdr-leads/${lead.phone}/cancel-schedule`);
    setBusy(false);
    onUpdate();
    onClose();
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div className="crm-drawer" onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, height: '100vh', overflowY: 'auto',
        background: 'var(--color-bg)', borderLeft: '1px solid var(--color-border)',
        padding: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: 'var(--color-text)' }}>{lead.nome || 'Sem nome'}</h2>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {fmtPhone(lead.phone)} · {lead.cidade || 'cidade —'}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {lead.instance === 'io' && <Badge color="amber">☀️ IO</Badge>}
              {lead.ctwa_clid && <Badge color="blue">📢 Meta Ad</Badge>}
              {lead.human_takeover ? <Badge color="purple">🤝 Humano</Badge> : <Badge color="green">🤖 Luma</Badge>}
            </div>
          </div>
          <button onClick={onClose} style={{
            padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>

        {/* Agendamento */}
        {lead.canal_atendimento && (
          <div style={{
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 10, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', marginBottom: 4 }}>📅 Agendamento</div>
            <div style={{ fontSize: 14, color: 'var(--color-text)', fontWeight: 700 }}>
              {canalLabel(lead.canal_atendimento)} · {lead.horario_atendimento}
            </div>
            {lead.endereco_vistoria && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>📍 {lead.endereco_vistoria}</div>
            )}
            {lead.lembrete_enviado_at && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>✓ Lembrete pré-evento já disparado</div>
            )}
            <button onClick={cancelarAgendamento} disabled={busy} style={{
              marginTop: 8, padding: '4px 10px', borderRadius: 6, fontSize: 11,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', cursor: 'pointer', fontWeight: 700,
            }}>Cancelar agendamento</button>
          </div>
        )}

        {/* Insights IA */}
        <div style={{ marginBottom: 16 }}>
          {!insights ? (
            <button onClick={gerarInsights} disabled={loadingInsights} style={{
              width: '100%', padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: 'rgba(99,179,237,0.1)', border: '1px solid var(--color-primary)',
              color: 'var(--color-primary)', cursor: 'pointer',
            }}>{loadingInsights ? 'Analisando…' : '🧠 Gerar insights da IA'}</button>
          ) : (
            <div style={{
              background: 'rgba(99,179,237,0.05)', border: '1px solid var(--color-primary)',
              borderRadius: 10, padding: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', marginBottom: 4 }}>🧠 Análise IA</div>
              <p style={{ fontSize: 13, color: 'var(--color-text)', margin: '0 0 8px' }}>{insights.resumo}</p>
              {typeof insights.score === 'number' && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Score de fechamento: <strong style={{ color: insights.score > 60 ? '#22c55e' : insights.score > 30 ? '#f59e0b' : '#ef4444' }}>{insights.score}/100</strong>
                </div>
              )}
              {insights.proxima_acao && (
                <div style={{ fontSize: 12, color: 'var(--color-text)', marginTop: 6, padding: 8, background: 'var(--color-surface)', borderRadius: 6 }}>
                  <strong>Próxima ação:</strong> {insights.proxima_acao}
                </div>
              )}
              <button onClick={gerarInsights} disabled={loadingInsights} style={{
                marginTop: 8, fontSize: 10, padding: '2px 8px', borderRadius: 4,
                background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer',
              }}>↻ Regenerar</button>
            </div>
          )}
        </div>

        {/* Valor da venda */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>💰 Valor da venda (R$)</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input type="text" value={valorVenda} onChange={e => setValorVenda(e.target.value)}
              onBlur={salvarValorVenda}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="Ex: 12990 ou 12990.00"
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 700 }} />
            {lead.codigo_contrato && (
              <span style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                {lead.codigo_contrato}
              </span>
            )}
          </div>
        </div>

        {/* Consultor */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>👤 Consultor responsável</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <button onClick={() => onSetConsultor(lead.phone, null)} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: !lead.consultor ? '2px solid var(--color-text-muted)' : '1px solid var(--color-border)',
              background: !lead.consultor ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-text-muted)',
            }}>👤 Sem</button>
            {CONSULTORES.map(c => {
              const ativo = lead.consultor === c.id;
              return (
                <button key={c.id} onClick={() => onSetConsultor(lead.phone, c.id)} style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: ativo ? `2px solid ${c.color}` : `1px solid ${c.border}`,
                  background: ativo ? c.bg : 'transparent', color: c.color,
                }}>{c.inicial} · {c.nome}</button>
              );
            })}
          </div>
        </div>

        {/* Tags */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Tags (separadas por vírgula)</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input type="text" value={tagsInput} onChange={e => setTagsInput(e.target.value)}
              placeholder="VIP, indicação, reagendar..."
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
            <button onClick={salvarTags} disabled={busy} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: 'var(--color-primary)', border: 'none', color: '#fff', cursor: 'pointer',
            }}>Salvar</button>
          </div>
        </div>

        {/* Notas internas */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>📝 Notas internas (não vai pro lead)</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)}
            onBlur={salvarNotas}
            placeholder="Anotações da equipe sobre esse lead..."
            rows={3}
            style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, marginTop: 4, resize: 'vertical' }} />
        </div>

        {/* Mandar mensagem manual */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>💬 Mandar mensagem (silencia Luma)</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input type="text" value={msgManual} onChange={e => setMsgManual(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') enviarMsg(); }}
              placeholder="Digite sua mensagem..."
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
            <button onClick={enviarMsg} disabled={busy || !msgManual.trim()} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: '#25d366', border: 'none', color: '#fff', cursor: 'pointer',
            }}>Enviar</button>
          </div>
        </div>

        {/* Ações */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={forcarFollowup} disabled={busy} style={{
            flex: 1, padding: 8, borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#f59e0b', cursor: 'pointer',
          }}>🔁 Forçar follow-up agora</button>
        </div>

        {/* Histórico */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>💬 Histórico ({history.length})</label>
          <div className="crm-history" style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, padding: 10, marginTop: 4, maxHeight: 320, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {history.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>Sem mensagens</div>
            ) : history.map((m, i) => {
              const isUser = m.role === 'user';
              const content = typeof m.content === 'string' ? m.content : '[mídia]';
              return (
                <div key={i} style={{
                  alignSelf: isUser ? 'flex-start' : 'flex-end',
                  maxWidth: '85%',
                  background: isUser ? 'var(--color-bg)' : 'rgba(34,197,94,0.1)',
                  border: `1px solid ${isUser ? 'var(--color-border)' : 'rgba(34,197,94,0.3)'}`,
                  borderRadius: 10, padding: '6px 10px',
                  fontSize: 12, color: 'var(--color-text)', whiteSpace: 'pre-wrap',
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: isUser ? '#94a3b8' : '#22c55e', marginBottom: 2 }}>
                    {isUser ? '👤 Lead' : '🤖 Luma'}
                  </div>
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────

interface FilterState {
  agendados: 'all' | 'sim' | 'nao';
  origem: 'all' | 'meta' | 'organico';
  takeover: 'all' | 'humano' | 'luma';
  consultor: 'all' | 'sem' | 'diego' | 'giovanna' | 'nilce' | 'thiago';
}

export default function CrmPage() {
  const searchParams = useSearchParams();
  const initialTab: 'solar' | 'plataforma' = searchParams.get('tab') === 'plataforma' ? 'plataforma' : 'solar';
  const [tab, setTab] = useState<'solar' | 'plataforma'>(initialTab);

  // Sidebar agora navega entre Solar/Plataforma via /crm/solar-io e /crm/solardoc,
  // que redirecionam pra /crm?tab=... — App Router reusa o componente, então
  // sincronizamos o tab manualmente quando o query param muda.
  useEffect(() => {
    const next: 'solar' | 'plataforma' = searchParams.get('tab') === 'plataforma' ? 'plataforma' : 'solar';
    setTab(prev => prev === next ? prev : next);
  }, [searchParams]);
  const [sdrLeads, setSdrLeads] = useState<SdrLead[]>([]);
  const [platCols, setPlatCols] = useState<Record<string, PlatLead[]>>({});
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filters, setFilters] = useState<FilterState>({ agendados: 'all', origem: 'all', takeover: 'all', consultor: 'all' });
  const [drawerLead, setDrawerLead] = useState<SdrLead | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  // Relógio em tempo real (atualiza a cada segundo)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = useCallback(async () => {
    const [s, p, m] = await Promise.all([
      api.get('/admin/sdr-leads').catch(() => ({ data: { leads: [] } })),
      api.get('/admin/platform-crm').catch(() => ({ data: { columns: {} } })),
      api.get('/admin/sdr-metrics').catch(() => ({ data: null })),
    ]);
    // CRM Solar foca apenas na linha IO. SolarDoc fica em tab separada.
    setSdrLeads((s.data.leads || []).filter((l: SdrLead) => l.instance === 'io'));
    setPlatCols(p.data.columns ?? {});
    setMetrics(m.data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Polling automático a cada 30s
  useEffect(() => {
    const id = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  async function moveSdr(phone: string, estagio: string) {
    // Otimista — atualiza UI antes do servidor responder
    setSdrLeads(prev => prev.map(l => l.phone === phone ? { ...l, estagio } : l));
    try {
      await api.patch(`/admin/sdr-leads/${phone}/estagio`, { estagio });
    } catch {
      // Rollback em caso de erro
      fetchAll();
    }
  }

  async function toggleSdrTakeover(phone: string, takeover: boolean) {
    setSdrLeads(prev => prev.map(l => l.phone === phone ? { ...l, human_takeover: takeover } : l));
    await api.patch(`/admin/sdr-leads/${phone}/takeover`, { takeover });
  }

  async function setConsultor(phone: string, consultor: string | null) {
    setSdrLeads(prev => prev.map(l => l.phone === phone ? { ...l, consultor } : l));
    await api.patch(`/admin/sdr-leads/${phone}/consultor`, { consultor });
  }

  async function movePlat(id: string, estagio: string) {
    await api.patch(`/admin/platform-crm/${id}/estagio`, { estagio });
    setPlatCols(prev => {
      const next = { ...prev };
      let lead: PlatLead | undefined;
      for (const col of Object.keys(next)) {
        const idx = next[col].findIndex(l => l.id === id);
        if (idx !== -1) { lead = { ...next[col][idx], crm_estagio: estagio }; next[col] = next[col].filter(l => l.id !== id); break; }
      }
      if (lead) (next[estagio] ??= []).unshift(lead);
      return next;
    });
  }

  async function paraSdr(id: string) {
    await api.post(`/admin/platform-crm/${id}/para-sdr`);
    alert('Lead enviado para o CRM SDR Solar ☀️');
    fetchAll();
  }

  // Filtros + busca
  const sdrFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return sdrLeads.filter(l => {
      if (q && ![l.nome, l.phone, l.cidade, ...(l.tags || [])].some(v => (v as string)?.toLowerCase()?.includes(q))) return false;
      if (filters.agendados === 'sim' && !l.canal_atendimento) return false;
      if (filters.agendados === 'nao' && l.canal_atendimento) return false;
      if (filters.origem === 'meta' && !l.ctwa_clid) return false;
      if (filters.origem === 'organico' && l.ctwa_clid) return false;
      if (filters.takeover === 'humano' && !l.human_takeover) return false;
      if (filters.takeover === 'luma' && l.human_takeover) return false;
      if (filters.consultor === 'sem' && l.consultor) return false;
      if (filters.consultor !== 'all' && filters.consultor !== 'sem' && l.consultor !== filters.consultor) return false;
      return true;
    });
  }, [sdrLeads, busca, filters]);

  const algumFiltroAtivo = filters.agendados !== 'all' || filters.origem !== 'all' || filters.takeover !== 'all' || filters.consultor !== 'all';
  const totalPlat = Object.values(platCols).reduce((a, c) => a + c.length, 0);
  const q = busca.toLowerCase().trim();

  return (
    <div className="crm-shell">
      {/* ── LINHA 1: título · ClockBadge · busca · import · refresh ── */}
      <div className="crm-row crm-row-1">
        <div className="crm-title">
          <h1>📋 CRM</h1>
          <span className="crm-subtitle">
            {tab === 'solar' ? 'Pipeline IO · Luma + 4' : 'Pipeline plataforma'}
          </span>
          <ClockBadge now={now} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <input type="text" placeholder="🔍 Nome, telefone, cidade..." value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'var(--color-bg)', color: 'var(--color-text)',
              fontSize: 12, width: 220, height: 28,
            }} />
          {tab === 'solar' && (
            <button onClick={() => setImportOpen(true)} title="Importar lista de leads pra reativação" style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(168,85,247,0.4)',
              background: 'rgba(168,85,247,0.12)', color: '#a855f7',
              cursor: 'pointer', fontSize: 12, fontWeight: 700, height: 28,
            }}>⚡ Importar</button>
          )}
          <button onClick={fetchAll} title="Atualizar agora" style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text-muted)',
            cursor: 'pointer', fontSize: 12, height: 28,
          }}>🔄</button>
        </div>
      </div>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={fetchAll} />}

      {/* ── LINHA 2: métricas inline (pílulas). Tabs removidos — sidebar já navega pra /crm?tab=... ── */}
      <div className="crm-row crm-row-2">
        {tab === 'solar' && metrics && (
          <div className="crm-metrics-inline">
            <MetricPill label="Hoje" value={metrics.hoje} color="var(--color-primary)" />
            <MetricPill label="Mês" value={metrics.mes} />
            <MetricPill label="Total" value={metrics.total} />
            <MetricPill label="Quentes" value={metrics.por_estagio.quente || 0} color="#ef4444" />
            <MetricPill label="Fechados" value={metrics.por_estagio.fechamento || 0} color="#22c55e" />
            <MetricPill label="Conv. Mês" value={`${metrics.conversao_pct}%`} color="#22c55e" />
            <MetricPill label="💰 Mês" value={fmtMoney(metrics.valor_vendido_mes)} color="#22c55e"
              progress={metrics.meta_mes ? (metrics.valor_vendido_mes / metrics.meta_mes) * 100 : undefined}
              meta={metrics.meta_mes ? `Meta ${fmtMoney(metrics.meta_mes)}` : undefined} />
            <MetricPill label="💰 Ano" value={fmtMoney(metrics.valor_vendido_ano)} color="#f59e0b" />
            <MetricPill label="Takeover" value={metrics.em_takeover} color="#a855f7" />
            <MetricPill label="Agend. 24h" value={metrics.agendados_24h.length} color="#f59e0b" />
          </div>
        )}
      </div>

      {/* ── LINHA 3: filtros (32px, só na tab Solar) ── */}
      {tab === 'solar' && (
        <div className="crm-filters-strip">
          <FilterChip label="Consultor" value={filters.consultor} options={[
            { v: 'all', l: 'Todos' },
            { v: 'sem', l: '👤 Sem' },
            ...CONSULTORES.map(c => ({ v: c.id, l: `${c.inicial} · ${c.nome}` })),
          ]} onChange={v => setFilters(f => ({ ...f, consultor: v as any }))} />

          <FilterChip label="Agendados" value={filters.agendados} options={[
            { v: 'all', l: 'Todos' }, { v: 'sim', l: '📅 Sim' }, { v: 'nao', l: 'Não' },
          ]} onChange={v => setFilters(f => ({ ...f, agendados: v as any }))} />

          <FilterChip label="Origem" value={filters.origem} options={[
            { v: 'all', l: 'Todas' }, { v: 'meta', l: '📢 Meta' }, { v: 'organico', l: 'Orgânico' },
          ]} onChange={v => setFilters(f => ({ ...f, origem: v as any }))} />

          <FilterChip label="Atendimento" value={filters.takeover} options={[
            { v: 'all', l: 'Todos' }, { v: 'luma', l: '🤖 Luma' }, { v: 'humano', l: '🤝 Humano' },
          ]} onChange={v => setFilters(f => ({ ...f, takeover: v as any }))} />

          {algumFiltroAtivo && (
            <button onClick={() => setFilters({ agendados: 'all', origem: 'all', takeover: 'all', consultor: 'all' })}
              title="Limpar filtros"
              style={{
                padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444',
                height: 28, flexShrink: 0,
              }}>✕</button>
          )}
          <span style={{
            fontSize: 11, color: 'var(--color-text-muted)',
            marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {sdrFiltrados.length} de {sdrLeads.length}
          </span>
        </div>
      )}

      {/* ── ÁREA DO KANBAN: ocupa todo o flex:1 restante ── */}
      {tab === 'solar' && (
        loading ? (
          <div style={{ flex: 1, padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Carregando...
          </div>
        ) : (
          <div className="crm-kanban-area">
            {SDR_COLS.map(col => {
              let colLeads = sdrFiltrados.filter(l => l.estagio === col.id);
              if (col.id === 'fechamento') {
                colLeads = [...colLeads].sort((a, b) =>
                  (b.codigo_contrato || '').localeCompare(a.codigo_contrato || '')
                );
              }
              return (
                <KanbanCol
                  key={col.id} col={col} count={colLeads.length}
                  isDragOver={dragOverCol === col.id}
                  onDragEnter={() => setDragOverCol(col.id)}
                  onDragLeave={() => setDragOverCol(null)}
                  onDropPhone={(phone, estagio) => {
                    setDragOverCol(null);
                    const lead = sdrLeads.find(l => l.phone === phone);
                    if (lead && lead.estagio !== estagio) moveSdr(phone, estagio);
                  }}>
                  {colLeads.length === 0
                    ? <div style={{ textAlign: 'center', padding: '12px 8px', color: 'var(--color-text-muted)', fontSize: 11 }}>—</div>
                    : colLeads.map(l => (
                      <SdrCard key={l.phone} lead={l}
                        onClick={() => setDrawerLead(l)}
                        onMove={moveSdr}
                        onToggleTakeover={toggleSdrTakeover}
                        onSetConsultor={setConsultor} />
                    ))
                  }
                </KanbanCol>
              );
            })}
          </div>
        )
      )}

      {tab === 'solar' && (
        <LeadDrawer
          lead={drawerLead ? sdrLeads.find(l => l.phone === drawerLead.phone) || drawerLead : null}
          onClose={() => setDrawerLead(null)}
          onUpdate={fetchAll}
          onSetConsultor={setConsultor}
        />
      )}

      {/* ── TAB PLATAFORMA: scroll horizontal próprio ── */}
      {tab === 'plataforma' && (
        <div className="crm-plat-scroll">
          {PLAT_COLS.map(col => {
            const colLeads = (platCols[col.id] ?? []).filter(l =>
              !q || [l.email, l.empresa, l.cnpj, l.whatsapp].some(v => v?.toLowerCase().includes(q))
            );
            return (
              <KanbanCol key={col.id} col={col} count={colLeads.length}>
                {colLeads.length === 0
                  ? <div style={{ textAlign: 'center', padding: '20px 10px', color: 'var(--color-text-muted)', fontSize: 12 }}>—</div>
                  : colLeads.map(l => (
                    <PlatCard key={l.id} lead={l} colId={col.id} onMove={movePlat} onParaSdr={paraSdr} />
                  ))
                }
              </KanbanCol>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Relógio em tempo real ──────────────────────────────────────────

function ClockBadge({ now }: { now: Date }) {
  const dataStr = now.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  });
  const horaStr = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo',
  });
  const diaSemana = now.toLocaleDateString('pt-BR', {
    weekday: 'short', timeZone: 'America/Sao_Paulo',
  }).replace('.', '');
  // Indicador se está no horário comercial (Luma operando reativação)
  const horaBR = parseInt(now.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }), 10);
  const dow = parseInt(now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' }) === 'Sun' ? '0' :
    now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' }) === 'Sat' ? '6' : '1', 10);
  const isBusinessHour = dow > 0 && dow < 6 && horaBR >= 9 && horaBR < 20;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 6, padding: '3px 8px',
      fontFamily: 'monospace',
      flexShrink: 0,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: isBusinessHour ? '#22c55e' : '#64748b',
        boxShadow: isBusinessHour ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
        animation: isBusinessHour ? 'pulse 2s infinite' : 'none',
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {diaSemana}, {dataStr}
      </span>
      <span style={{ fontSize: 11, color: 'var(--color-text)', fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
        {horaStr}
      </span>
    </div>
  );
}

// ── Modal de import de leads pra reativação ────────────────────────

// Heurística pra achar coluna no Excel: case-insensitive, sem acento
function colMatch(headers: string[], candidates: string[]): number {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const normHdrs = headers.map(norm);
  for (const c of candidates) {
    const cn = norm(c);
    const idx = normHdrs.findIndex(h => h === cn || h.includes(cn));
    if (idx !== -1) return idx;
  }
  return -1;
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [fileLeads, setFileLeads] = useState<{ nome: string; phone: string; cidade?: string }[]>([]);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parser de texto livre (formato colado)
  const parsed = useMemo(() => {
    if (fileLeads.length > 0) return { leads: fileLeads, erros: [] as string[] };
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const leads: { nome: string; phone: string }[] = [];
    const erros: string[] = [];
    for (const line of lines) {
      const sepMatch = line.match(/^(.+?)[\s,;\t-]+(\+?\d[\d\s().-]{8,})\s*$/) ||
                       line.match(/^(\+?\d[\d\s().-]{8,})[\s,;\t-]+(.+)$/);
      if (!sepMatch) {
        const numMatch = line.match(/^\+?\d[\d\s().-]{8,}$/);
        if (numMatch) { leads.push({ nome: '', phone: line }); continue; }
        erros.push(line);
        continue;
      }
      const a = sepMatch[1].trim();
      const b = sepMatch[2].trim();
      const aIsPhone = /^\+?\d[\d\s().-]+$/.test(a);
      const phone = aIsPhone ? a : b;
      const nome = aIsPhone ? b : a;
      leads.push({ nome, phone: phone.replace(/\D/g, '') });
    }
    return { leads, erros };
  }, [text, fileLeads]);

  async function processarArquivo(file: File) {
    setFileError('');
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // Lê como matriz (sem cabeçalho automático), pra detectar colunas
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length === 0) { setFileError('Planilha vazia'); return; }

      // Detecta cabeçalho — primeira linha não-vazia que pareça texto
      let headerIdx = 0;
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const r = rows[i].map(String);
        const hasText = r.some(c => /[a-záé]/i.test(c) && !/^\d+$/.test(c));
        if (hasText) { headerIdx = i; break; }
      }
      const headers: string[] = (rows[headerIdx] || []).map((c: any) => String(c ?? '').trim());

      const idxNome = colMatch(headers, ['nome', 'name', 'cliente', 'lead', 'contato']);
      const idxPhone = colMatch(headers, ['telefone', 'celular', 'whatsapp', 'whats', 'wpp', 'phone', 'tel', 'numero', 'número', 'fone']);
      const idxCidade = colMatch(headers, ['cidade', 'city', 'municipio', 'município']);

      if (idxPhone === -1) {
        setFileError('Não encontrei coluna de telefone. Renomeia a coluna pra "Telefone", "Celular" ou "WhatsApp".');
        return;
      }

      const leads: { nome: string; phone: string; cidade?: string }[] = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const phoneRaw = String(row[idxPhone] ?? '').replace(/\D/g, '');
        if (phoneRaw.length < 10 || phoneRaw.length > 13) continue;
        const nome = idxNome !== -1 ? String(row[idxNome] ?? '').trim() : '';
        const cidade = idxCidade !== -1 ? String(row[idxCidade] ?? '').trim() : '';
        leads.push({ nome, phone: phoneRaw, cidade: cidade || undefined });
      }

      if (leads.length === 0) {
        setFileError('Nenhuma linha com telefone válido foi encontrada.');
        return;
      }
      setFileLeads(leads);
      setText('');
    } catch (e: any) {
      setFileError(`Erro lendo arquivo: ${e?.message || e}`);
    }
  }

  function limparArquivo() {
    setFileName('');
    setFileLeads([]);
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function importar() {
    if (parsed.leads.length === 0) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/sdr-leads/import', { leads: parsed.leads });
      setResult(r.data);
      onImport();
    } catch (e: any) {
      setResult({ error: e?.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--color-text)' }}>⚡ Importar leads pra reativação</h2>
          <button onClick={onClose} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
          Importe um Excel (.xlsx) ou cole a lista. A Luma chama até <strong>50/dia</strong> em horário comercial (seg-sex 9h-20h). Quando responderem, viram &quot;Novo&quot; automático.
        </p>

        {/* Upload Excel/CSV */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
            📊 Upload de planilha (Excel ou CSV)
          </label>
          {!fileName ? (
            <label style={{
              display: 'block', padding: 16, borderRadius: 8,
              border: '2px dashed var(--color-border)', background: 'var(--color-surface)',
              color: 'var(--color-text-muted)', textAlign: 'center', cursor: 'pointer', fontSize: 13,
            }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={e => { const f = e.target.files?.[0]; if (f) processarArquivo(f); }}
                style={{ display: 'none' }} />
              📂 Clique pra selecionar arquivo (.xlsx, .xls, .csv)
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
                Detecta colunas: Nome / Telefone / Cidade automaticamente
              </div>
            </label>
          ) : (
            <div style={{
              padding: 10, borderRadius: 8,
              background: fileError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
              border: `1px solid ${fileError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ fontSize: 12 }}>
                {fileError
                  ? <span style={{ color: '#ef4444' }}>❌ {fileError}</span>
                  : <span style={{ color: '#22c55e' }}>✅ <strong>{fileName}</strong> · {fileLeads.length} leads detectados</span>}
              </div>
              <button onClick={limparArquivo} style={{ padding: '2px 8px', borderRadius: 4, background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          )}
        </div>

        {/* Ou colar texto */}
        {!fileName && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }}></div>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>OU COLE TEXTO</span>
              <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }}></div>
            </div>

            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <strong>Formatos aceitos:</strong> João Silva, 34999998888 · Maria Santos - 34988887777 · 34911223344
            </div>

            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="João Silva, 34999998888&#10;Maria Santos, 34988887777&#10;..."
              rows={6}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
          </>
        )}

        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
          <strong>{parsed.leads.length}</strong> leads válidos
          {parsed.erros.length > 0 && (
            <span style={{ color: '#ef4444' }}> · {parsed.erros.length} linhas inválidas</span>
          )}
        </div>

        {parsed.erros.length > 0 && (
          <details style={{ marginTop: 8, fontSize: 11 }}>
            <summary style={{ cursor: 'pointer', color: '#ef4444' }}>Ver linhas inválidas</summary>
            <ul style={{ marginTop: 4, paddingLeft: 16, color: 'var(--color-text-muted)' }}>
              {parsed.erros.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {parsed.erros.length > 10 && <li>... e mais {parsed.erros.length - 10}</li>}
            </ul>
          </details>
        )}

        {result && (
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 8, fontSize: 12,
            background: result.error ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
            border: `1px solid ${result.error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            color: result.error ? '#ef4444' : '#22c55e',
          }}>
            {result.error ? `Erro: ${result.error}` : (
              <>
                ✅ Importação concluída: <strong>{result.inseridos}</strong> novos
                {result.duplicados > 0 && <> · <strong>{result.duplicados}</strong> já existiam</>}
                {result.invalidos > 0 && <> · <strong>{result.invalidos}</strong> inválidos</>}
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>Fechar</button>
          <button onClick={importar} disabled={busy || parsed.leads.length === 0}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#a855f7', color: '#fff', cursor: parsed.leads.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: parsed.leads.length === 0 ? 0.5 : 1 }}>
            {busy ? 'Importando...' : `Importar ${parsed.leads.length} leads`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card Plataforma ────────────────────────────────────────────────

function PlatCard({ lead, colId, onMove, onParaSdr }: {
  lead: PlatLead; colId: string;
  onMove: (id: string, estagio: string) => void;
  onParaSdr: (id: string) => void;
}) {
  const col = PLAT_COLS.find(c => c.id === colId) ?? PLAT_COLS[0];
  return (
    <div style={{
      background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
      borderLeft: `3px solid ${col.color}`, borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)', marginBottom: 4, wordBreak: 'break-all' }}>
        {lead.empresa || lead.email}
      </div>
      {lead.empresa && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>✉️ {lead.email}</div>}
      {lead.cnpj && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>🏢 {lead.cnpj}</div>}

      <select value={colId} onChange={e => onMove(lead.id, e.target.value)}
        style={{ width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 6, border: `1px solid ${col.border}`, background: col.bg, color: col.color, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
        {PLAT_COLS.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
      </select>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {lead.whatsapp && (
          <a href={`https://wa.me/55${lead.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '4px 9px', borderRadius: 6, background: '#25d366', color: '#fff', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>💬 WA</a>
        )}
        {lead.whatsapp && (
          <button onClick={() => onParaSdr(lead.id)}
            style={{ padding: '4px 9px', borderRadius: 6, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>☀️ → SDR</button>
        )}
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>📄 {lead.documentos_usados}</span>
      </div>

      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
        {lead.crm_estagio ? '✏️ Manual' : '🔄 Auto'} · {lead.ativo_recente ? '🟢 Ativo' : '⚪ Inativo'}
      </div>
    </div>
  );
}

// ── Filter chip helper ────────────────────────────────────────────

function FilterChip({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
}) {
  const active = value !== 'all';
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      title={label}
      className={`crm-filter-mini${active ? ' active' : ''}`}>
      {options.map(o => <option key={o.v} value={o.v}>{label}: {o.l}</option>)}
    </select>
  );
}

