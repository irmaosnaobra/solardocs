'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';

// ── Tipos ─────────────────────────────────────────────────────────

interface SdrLead {
  phone: string; nome: string | null; cidade: string | null; estado: string | null;
  estagio: string; ultima_mensagem: string | null; total_mensagens: number; updated_at: string;
}

interface PlatLead {
  id: string; email: string; whatsapp: string | null; plano: string;
  empresa: string | null; cnpj: string | null; documentos_usados: number;
  created_at: string; ativo_recente: boolean;
}

// ── Configurações dos Kanbans ──────────────────────────────────────

const SDR_COLS = [
  { id: 'novo',       label: 'Novo Cliente',  emoji: '🆕', color: '#64748b', bg: 'rgba(100,116,139,0.1)',  border: 'rgba(100,116,139,0.3)' },
  { id: 'frio',       label: 'Frio',          emoji: '🔵', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)' },
  { id: 'morno',      label: 'Morno',         emoji: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)' },
  { id: 'quente',     label: 'Quente',        emoji: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.3)' },
  { id: 'perdido',    label: 'Perdido',       emoji: '❌', color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)' },
  { id: 'fechamento', label: 'Fechamento',    emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.3)' },
];

const PLAT_COLS = [
  { id: 'sem_cnpj',   label: 'Sem CNPJ',          emoji: '📋', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
  { id: 'desativado', label: 'Cadastro Desativado', emoji: '😴', color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.3)' },
  { id: 'ativo',      label: 'Cadastro Ativo',     emoji: '⚡', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
  { id: 'pro',        label: 'PRO',                emoji: '🚀', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)' },
  { id: 'vip',        label: 'VIP',                emoji: '👑', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
];

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function fmtPhone(p: string) {
  const d = (p || '').replace(/\D/g, '');
  if (d.length >= 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9,13)}`;
  return p;
}

// ── Coluna Kanban ─────────────────────────────────────────────────

function KanbanCol({ col, children, count }: { col: typeof SDR_COLS[0]; children: React.ReactNode; count: number }) {
  return (
    <div style={{ minWidth: 220, flex: '0 0 220px' }}>
      <div style={{
        padding: '10px 14px', borderRadius: '10px 10px 0 0',
        background: col.bg, border: `1px solid ${col.border}`, borderBottom: 'none',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontWeight: 800, fontSize: 13, color: col.color }}>{col.emoji} {col.label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, background: col.bg, color: col.color, padding: '2px 8px', borderRadius: 999, border: `1px solid ${col.border}` }}>{count}</span>
      </div>
      <div style={{
        minHeight: 120, border: `1px solid ${col.border}`, borderTop: 'none',
        borderRadius: '0 0 10px 10px', padding: 8, display: 'flex', flexDirection: 'column', gap: 8,
        background: 'rgba(255,255,255,0.01)',
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Card SDR ──────────────────────────────────────────────────────

function SdrCard({ lead, cols, onMove }: { lead: SdrLead; cols: typeof SDR_COLS; onMove: (phone: string, estagio: string) => void }) {
  const col = cols.find(c => c.id === lead.estagio) ?? cols[0];
  return (
    <div style={{
      background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
      borderLeft: `3px solid ${col.color}`, borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text)', marginBottom: 4 }}>
        {lead.nome || 'Sem nome'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        {lead.cidade ? `📍 ${lead.cidade}${lead.estado ? ` - ${lead.estado}` : ''}` : fmtPhone(lead.phone)}
      </div>
      {lead.ultima_mensagem && (
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: '0 0 8px', lineHeight: 1.4 }}>
          "{lead.ultima_mensagem.slice(0, 80)}{lead.ultima_mensagem.length > 80 ? '...' : ''}"
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener noreferrer"
          style={{ padding: '4px 10px', borderRadius: 6, background: '#25d366', color: '#fff', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
          💬 WA
        </a>
        <select value={lead.estagio} onChange={e => onMove(lead.phone, e.target.value)}
          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${col.border}`, background: col.bg, color: col.color, fontWeight: 700, cursor: 'pointer', flex: 1 }}>
          {cols.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
        💬 {lead.total_mensagens} msgs · {fmtDate(lead.updated_at)}
      </div>
    </div>
  );
}

// ── Card Plataforma ────────────────────────────────────────────────

function PlatCard({ lead, colId }: { lead: PlatLead; colId: string }) {
  const col = PLAT_COLS.find(c => c.id === colId) ?? PLAT_COLS[0];
  return (
    <div style={{
      background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
      borderLeft: `3px solid ${col.color}`, borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)', marginBottom: 4, wordBreak: 'break-all' }}>
        {lead.empresa || lead.email}
      </div>
      {lead.empresa && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          ✉️ {lead.email}
        </div>
      )}
      {lead.cnpj && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          🏢 {lead.cnpj}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        {lead.whatsapp && (
          <a href={`https://wa.me/55${lead.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '4px 10px', borderRadius: 6, background: '#25d366', color: '#fff', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
            💬 WA
          </a>
        )}
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          📄 {lead.documentos_usados} docs
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
        {lead.ativo_recente ? '🟢 Ativo agora' : '⚪ Sem doc recente'} · {fmtDate(lead.created_at)}
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────

export default function CrmPage() {
  const [tab, setTab] = useState<'sdr' | 'plataforma'>('sdr');
  const [sdrLeads, setSdrLeads] = useState<SdrLead[]>([]);
  const [platCols, setPlatCols] = useState<Record<string, PlatLead[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [s, p] = await Promise.all([
      api.get('/admin/sdr-leads').catch(() => ({ data: { leads: [] } })),
      api.get('/admin/platform-crm').catch(() => ({ data: { columns: {} } })),
    ]);
    setSdrLeads(s.data.leads);
    setPlatCols(p.data.columns ?? {});
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function moveSdr(phone: string, estagio: string) {
    await api.patch(`/admin/sdr-leads/${phone}/estagio`, { estagio });
    setSdrLeads(prev => prev.map(l => l.phone === phone ? { ...l, estagio } : l));
  }

  const totalPlat = Object.values(platCols).reduce((a, c) => a + c.length, 0);

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-text)', margin: '0 0 4px' }}>📋 CRM</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: 0 }}>Pipeline de vendas</p>
        </div>
        <button onClick={fetchAll} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
          🔄 Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[
          { id: 'sdr', label: '☀️ SDR Solar', count: sdrLeads.length },
          { id: 'plataforma', label: '💼 Plataforma SolarDoc', count: totalPlat },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{
              padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              border: tab === t.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: tab === t.id ? 'rgba(99,179,237,0.1)' : 'transparent',
              color: tab === t.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
            }}>
            {t.label} <span style={{ opacity: 0.7, fontSize: 12 }}>({t.count})</span>
          </button>
        ))}
      </div>

      {/* Kanban */}
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', padding: 40, textAlign: 'center' }}>Carregando...</p>
      ) : tab === 'sdr' ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {SDR_COLS.map(col => {
            const colLeads = sdrLeads.filter(l => l.estagio === col.id);
            return (
              <KanbanCol key={col.id} col={col} count={colLeads.length}>
                {colLeads.length === 0
                  ? <div style={{ textAlign: 'center', padding: '20px 10px', color: 'var(--color-text-muted)', fontSize: 12 }}>Nenhum lead</div>
                  : colLeads.map(l => <SdrCard key={l.phone} lead={l} cols={SDR_COLS} onMove={moveSdr} />)
                }
              </KanbanCol>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {PLAT_COLS.map(col => {
            const colLeads = platCols[col.id] ?? [];
            return (
              <KanbanCol key={col.id} col={col} count={colLeads.length}>
                {colLeads.length === 0
                  ? <div style={{ textAlign: 'center', padding: '20px 10px', color: 'var(--color-text-muted)', fontSize: 12 }}>Nenhum usuário</div>
                  : colLeads.map(l => <PlatCard key={l.id} lead={l} colId={col.id} />)
                }
              </KanbanCol>
            );
          })}
        </div>
      )}
    </div>
  );
}
