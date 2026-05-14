'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/services/api';
import '../crm.css';

// ── Tipos ──────────────────────────────────────────────────────────
interface IoLead {
  id: string;
  created_at: string;
  updated_at: string;
  nome: string;
  whatsapp: string;
  cidade: string | null;
  estado: string | null;
  tipo: string | null;
  telhado: string | null;
  padrao: string | null;
  pagamento: string | null;
  consumo_rs: number | null;
  comercial_kwp: number | null;
  comercial_preco: number | null;
  comercial_inv: string | null;
  premium_kwp: number | null;
  premium_preco: number | null;
  premium_inv: string | null;
  status: IoStatus;
  plano_escolhido: string | null;
  notes: string | null;
  last_contact_at: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
}

type IoStatus = 'novo' | 'em_contato' | 'frio' | 'morno' | 'quente' | 'followup' | 'vendido' | 'perdido';

interface HistoryEntry {
  id: string; created_at: string;
  from_status: string | null; to_status: string; note: string | null;
}

interface ColumnDef {
  id: IoStatus; label: string; emoji: string;
  color: string; bg: string; border: string;
}

// ── Configuração das colunas ──────────────────────────────────────
const COLS: ColumnDef[] = [
  { id: 'novo',       label: 'Novo lead',  emoji: '🆕', color: '#64748b', bg: 'rgba(100,116,139,0.1)',  border: 'rgba(100,116,139,0.3)' },
  { id: 'em_contato', label: 'Em contato', emoji: '💬', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',   border: 'rgba(59,130,246,0.3)' },
  { id: 'frio',       label: 'Frio',       emoji: '🧊', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)',   border: 'rgba(14,165,233,0.3)' },
  { id: 'morno',      label: 'Morno',      emoji: '🌤️', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.3)' },
  { id: 'quente',     label: 'Quente',     emoji: '🔥', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)' },
  { id: 'followup',   label: 'Follow-up',  emoji: '📅', color: '#a855f7', bg: 'rgba(168,85,247,0.1)',   border: 'rgba(168,85,247,0.3)' },
  { id: 'vendido',    label: 'Vendido',    emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)' },
  { id: 'perdido',    label: 'Perdido',    emoji: '❌', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)',  border: 'rgba(148,163,184,0.3)' },
];
const COL_BY_ID = Object.fromEntries(COLS.map(c => [c.id, c])) as Record<IoStatus, ColumnDef>;

// ── Helpers ────────────────────────────────────────────────────────
function fmtBRL(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtWhats(w: string) {
  const v = (w || '').replace(/\D/g, '').slice(-11);
  if (v.length === 11) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
  if (v.length === 10) return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
  return w;
}
function fmtRel(d: string) {
  const t = new Date(d).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'agora';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d`;
  return new Date(d).toLocaleDateString('pt-BR');
}
function fmtPag(p: string | null) {
  return ({ avista: 'À vista', cartao: 'Cartão (18×)', financiamento: 'Financiamento (84×)' } as any)[p || ''] || (p || '—');
}
function fmtTipo(t: string | null) {
  if (!t) return '—';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fmtPadrao(p: string | null) {
  return ({ mono110: 'Mono 110V', mono220: 'Mono 220V', bif220: 'Bifásico 220V', tri220: 'Trifásico' } as any)[p || ''] || (p || '—');
}
function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
}
function isThisMonth(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth();
}
function buildWaLink(lead: IoLead) {
  const phone = (lead.whatsapp || '').replace(/\D/g, '');
  const primeiroNome = (lead.nome || '').trim().split(/\s+/)[0] || '';
  const planoLinha = lead.comercial_preco
    ? `\n\nVi aqui que sua simulação fechou em ${fmtBRL(lead.comercial_preco)}. Quero te explicar como economiza na conta de luz e te mando a proposta detalhada agora.`
    : '\n\nVi sua simulação aqui e quero te ajudar com a proposta de energia solar.';
  const msg = encodeURIComponent(
    `Olá ${primeiroNome}! Aqui é da Irmãos na Obra Energia Solar.${planoLinha}\n\nTem 2 minutinhos pra conversar?`
  );
  return `https://wa.me/55${phone}?text=${msg}`;
}

// ── Pílula de métrica ──────────────────────────────────────────────
function MetricPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="crm-metric-pill">
      <span className="crm-metric-label">{label}</span>
      <span className="crm-metric-value" style={{ color: color || 'var(--color-text)' }}>{value}</span>
    </div>
  );
}

// ── Coluna do Kanban ───────────────────────────────────────────────
function KanbanCol({
  col, count, children,
  onDropId, isDragOver, onDragEnter, onDragLeave,
}: {
  col: ColumnDef; count: number; children: React.ReactNode;
  onDropId: (id: string, status: IoStatus) => void;
  isDragOver: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
}) {
  return (
    <div className="crm-kanban-col"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDragEnter={(e) => { e.preventDefault(); onDragEnter(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) onDropId(id, col.id);
        onDragLeave();
      }}>
      <div className="crm-col-head" style={{
        background: col.bg, border: `1px solid ${col.border}`,
        borderBottom: 'none', color: col.color,
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

// ── Card de lead ───────────────────────────────────────────────────
function LeadCard({ lead, onClick }: { lead: IoLead; onClick: () => void }) {
  const col = COL_BY_ID[lead.status] || COL_BY_ID.novo;
  const fromMeta = !!lead.utm_source && /(face|insta|meta|fb|ig)/i.test(lead.utm_source);
  const novo = isToday(lead.created_at);

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={{
        background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
        borderLeft: `3px solid ${col.color}`, borderRadius: 8, padding: '8px 10px',
        cursor: 'grab', transition: 'transform 0.1s', position: 'relative',
      }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{
          fontWeight: 700, fontSize: 12.5, color: 'var(--color-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0, flex: '1 1 auto',
        }}>{lead.nome}</span>
        {novo && (
          <span title="Cadastrado hoje" style={{
            fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4,
            background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)',
          }}>NOVO</span>
        )}
        {fromMeta && (
          <span title={`Origem: ${lead.utm_source}`} style={{
            fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4,
            background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)',
          }}>📢 AD</span>
        )}
        <a href={buildWaLink(lead)} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Abrir WhatsApp de ${lead.nome.split(' ')[0]}`}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
            textDecoration: 'none', fontSize: 12, lineHeight: 1, flexShrink: 0,
          }}>📲</a>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, lineHeight: 1.3 }}>
        📍 {lead.cidade ? `${lead.cidade}${lead.estado ? '/'+lead.estado : ''}` : '—'} · {fmtWhats(lead.whatsapp)}
      </div>

      {lead.consumo_rs != null && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          💰 Conta {fmtBRL(lead.consumo_rs)}/mês
          {lead.pagamento && <span style={{ marginLeft: 6, opacity: .8 }}>· {fmtPag(lead.pagamento)}</span>}
        </div>
      )}

      {lead.comercial_preco != null && (
        <div style={{
          background: lead.status === 'vendido' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.06)',
          border: `1px solid ${lead.status === 'vendido' ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.25)'}`,
          borderRadius: 6, padding: '4px 8px',
          fontSize: 11, fontWeight: 800,
          color: lead.status === 'vendido' ? '#22c55e' : '#f59e0b',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{lead.comercial_kwp ? `${lead.comercial_kwp} kWp` : 'Kit'}</span>
          <span>{fmtBRL(lead.comercial_preco)}</span>
        </div>
      )}

      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right' }}>
        {fmtRel(lead.created_at)}
      </div>
    </div>
  );
}

// ── Drawer de detalhe ──────────────────────────────────────────────
function LeadDrawer({
  lead, history, onClose, onChangeStatus, onSaveNotes, savingStatus, savingNotes,
}: {
  lead: IoLead | null;
  history: HistoryEntry[];
  onClose: () => void;
  onChangeStatus: (id: string, status: IoStatus) => void;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  savingStatus: boolean;
  savingNotes: boolean;
}) {
  const [editingNotes, setEditingNotes] = useState('');

  useEffect(() => {
    if (lead) setEditingNotes(lead.notes || '');
  }, [lead]);

  if (!lead) return null;
  const col = COL_BY_ID[lead.status] || COL_BY_ID.novo;
  const dirty = editingNotes !== (lead.notes || '');

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
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 22, color: 'var(--color-text)', lineHeight: 1.1 }}>{lead.nome}</h2>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              <a href={buildWaLink(lead)} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e', fontWeight: 700, textDecoration: 'none' }}>
                📲 {fmtWhats(lead.whatsapp)}
              </a>
              <span> · {lead.cidade || 'cidade —'}{lead.estado ? '/'+lead.estado : ''}</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 999,
                fontSize: 11, fontWeight: 800,
                background: col.bg, color: col.color, border: `1px solid ${col.border}`,
              }}>{col.emoji} {col.label}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>

        {/* Mover pra: */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Mover pra</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {COLS.filter(s => s.id !== lead.status).map(s => (
              <button key={s.id} disabled={savingStatus} onClick={() => onChangeStatus(lead.id, s.id)} style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${s.border}`, color: s.color,
              }}>{s.emoji} {s.label}</button>
            ))}
          </div>
        </div>

        {/* Dados da simulação */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 10, padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '.06em' }}>📋 Dados da simulação</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field lbl="Tipo" val={`${fmtTipo(lead.tipo)} · ${fmtTipo(lead.telhado)}`} />
            <Field lbl="Padrão" val={fmtPadrao(lead.padrao)} />
            <Field lbl="Conta atual" val={fmtBRL(lead.consumo_rs) + '/mês'} />
            <Field lbl="Pagamento" val={fmtPag(lead.pagamento)} />
          </div>
        </div>

        {/* Oferta */}
        {lead.comercial_preco != null && (
          <div style={{
            background: 'rgba(245,158,11,0.06)', border: '1.5px solid rgba(245,158,11,0.3)',
            borderRadius: 10, padding: 14, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.06em' }}>💼 Kit ofertado</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {lead.comercial_kwp ? `${lead.comercial_kwp} kWp` : '—'}
                  {lead.comercial_inv ? ` · ${lead.comercial_inv}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#f59e0b' }}>{fmtBRL(lead.comercial_preco)}</div>
            </div>
          </div>
        )}

        {/* Notas */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>📝 Notas do atendente</label>
          <textarea value={editingNotes} onChange={e => setEditingNotes(e.target.value)}
            placeholder="Anotações sobre o lead, próximos passos, objeções..."
            rows={4}
            style={{
              width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13,
              marginTop: 6, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4,
            }} />
          <button disabled={savingNotes || !dirty} onClick={() => onSaveNotes(lead.id, editingNotes)} style={{
            marginTop: 6, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: dirty ? 'var(--color-primary)' : 'transparent',
            border: dirty ? 'none' : '1px solid var(--color-border)',
            color: dirty ? '#fff' : 'var(--color-text-muted)',
            cursor: dirty && !savingNotes ? 'pointer' : 'default',
            opacity: savingNotes ? 0.5 : 1,
          }}>{savingNotes ? 'Salvando...' : '💾 Salvar notas'}</button>
        </div>

        {/* Histórico */}
        {history.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>📜 Histórico de status</label>
            <div className="crm-history" style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 8, padding: 8, marginTop: 6, maxHeight: 200, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {history.map(h => {
                const fromCol = h.from_status ? COL_BY_ID[h.from_status as IoStatus] : null;
                const toCol = COL_BY_ID[h.to_status as IoStatus];
                return (
                  <div key={h.id} style={{
                    display: 'flex', gap: 10, padding: '6px 10px',
                    background: 'var(--color-bg)', borderRadius: 6,
                    fontSize: 12, color: 'var(--color-text)',
                  }}>
                    <span style={{ color: 'var(--color-text-muted)', minWidth: 50, fontSize: 11 }}>{fmtRel(h.created_at)}</span>
                    <span style={{ flex: 1 }}>
                      {fromCol ? `${fromCol.emoji} ${fromCol.label}` : 'Criado'}
                      <span style={{ margin: '0 6px', opacity: 0.5 }}>→</span>
                      <span style={{ color: toCol?.color || 'inherit', fontWeight: 700 }}>{toCol?.emoji} {toCol?.label || h.to_status}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-muted)' }}>
          Criado {fmtRel(lead.created_at)}
          {lead.last_contact_at && ` · Último contato ${fmtRel(lead.last_contact_at)}`}
          {lead.utm_source && ` · origem ${lead.utm_source}${lead.utm_campaign ? '/'+lead.utm_campaign : ''}`}
        </div>
      </div>
    </div>
  );
}

function Field({ lbl, val }: { lbl: string; val: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{lbl}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{val}</div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────
export default function CrmIoPage() {
  const [leads, setLeads] = useState<IoLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [drawerLead, setDrawerLead] = useState<IoLead | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<IoStatus | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/io-leads');
      setLeads(data.leads || []);
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh 45s
  useEffect(() => {
    const id = setInterval(() => load(true), 45_000);
    return () => clearInterval(id);
  }, [load]);

  // Carrega histórico quando abre drawer
  useEffect(() => {
    if (!drawerLead) { setHistory([]); return; }
    api.get(`/io-leads/${drawerLead.id}/history`)
      .then(r => setHistory(r.data.history || []))
      .catch(() => setHistory([]));
  }, [drawerLead?.id]);

  // Filtro
  const leadsFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return leads;
    return leads.filter(l =>
      [l.nome, l.whatsapp, l.cidade, l.estado, l.utm_source, l.utm_campaign]
        .some(x => (x || '').toLowerCase().includes(q))
    );
  }, [leads, busca]);

  // Métricas
  const counts = useMemo(() => {
    const c = { total: leads.length, hoje: 0, mes: 0, novo: 0, quente: 0, vendido: 0, valorMes: 0 };
    leads.forEach(l => {
      if (isToday(l.created_at)) c.hoje++;
      if (isThisMonth(l.created_at)) c.mes++;
      if (l.status === 'novo') c.novo++;
      if (l.status === 'quente') c.quente++;
      if (l.status === 'vendido') {
        c.vendido++;
        if (isThisMonth(l.updated_at) && l.comercial_preco) c.valorMes += l.comercial_preco;
      }
    });
    return c;
  }, [leads]);
  const conversaoMes = counts.mes > 0 ? Math.round((counts.vendido / counts.mes) * 100) : 0;

  async function changeStatus(id: string, status: IoStatus) {
    setSavingStatus(true);
    // Otimista
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status, last_contact_at: new Date().toISOString() } : l));
    try {
      await api.patch(`/io-leads/${id}`, { status });
      // Refetch history se for o lead aberto
      if (drawerLead?.id === id) {
        const r = await api.get(`/io-leads/${id}/history`);
        setHistory(r.data.history || []);
        setDrawerLead(prev => prev ? { ...prev, status } : null);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao mover lead');
      load();
    } finally { setSavingStatus(false); }
  }

  async function saveNotes(id: string, notes: string) {
    setSavingNotes(true);
    try {
      await api.patch(`/io-leads/${id}`, { notes });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, notes } : l));
      setDrawerLead(prev => prev ? { ...prev, notes } : null);
    } catch (e) { alert('Erro ao salvar notas'); }
    finally { setSavingNotes(false); }
  }

  return (
    <div className="crm-shell">
      {/* Linha 1 — Título + busca + refresh */}
      <div className="crm-row crm-row-1">
        <div className="crm-title">
          <h1>🏗️ CRM Irmãos na Obra</h1>
          <span className="crm-subtitle">Pipeline B2C · simulador /io</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <input type="text" placeholder="🔍 Nome, WhatsApp, cidade, UTM..." value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'var(--color-bg)', color: 'var(--color-text)',
              fontSize: 12, width: 240, height: 28,
            }} />
          <button onClick={() => load()} disabled={loading} title="Atualizar agora" style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text-muted)',
            cursor: 'pointer', fontSize: 12, height: 28,
          }}>{loading ? '...' : '🔄'}</button>
        </div>
      </div>

      {/* Linha 2 — Métricas */}
      <div className="crm-row crm-row-2">
        <div className="crm-metrics-inline">
          <MetricPill label="Hoje" value={counts.hoje} color="var(--color-primary)" />
          <MetricPill label="Mês" value={counts.mes} />
          <MetricPill label="Total" value={counts.total} />
          <MetricPill label="Novos" value={counts.novo} color="#64748b" />
          <MetricPill label="Quentes" value={counts.quente} color="#ef4444" />
          <MetricPill label="Vendidos" value={counts.vendido} color="#22c55e" />
          <MetricPill label="Conv. Mês" value={`${conversaoMes}%`} color="#22c55e" />
          <MetricPill label="💰 Mês" value={fmtBRL(counts.valorMes)} color="#22c55e" />
        </div>
      </div>

      {/* Kanban */}
      {loading ? (
        <div style={{ flex: 1, padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Carregando leads...
        </div>
      ) : (
        <div className="crm-plat-scroll">
          {COLS.map(col => {
            const colLeads = leadsFiltrados.filter(l => l.status === col.id);
            return (
              <KanbanCol
                key={col.id} col={col} count={colLeads.length}
                isDragOver={dragOverCol === col.id}
                onDragEnter={() => setDragOverCol(col.id)}
                onDragLeave={() => setDragOverCol(null)}
                onDropId={(id, status) => {
                  setDragOverCol(null);
                  const lead = leads.find(l => l.id === id);
                  if (lead && lead.status !== status) changeStatus(id, status);
                }}>
                {colLeads.length === 0
                  ? <div style={{ textAlign: 'center', padding: '12px 8px', color: 'var(--color-text-muted)', fontSize: 11 }}>—</div>
                  : colLeads.map(l => <LeadCard key={l.id} lead={l} onClick={() => setDrawerLead(l)} />)
                }
              </KanbanCol>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      <LeadDrawer
        lead={drawerLead ? leads.find(l => l.id === drawerLead.id) || drawerLead : null}
        history={history}
        onClose={() => setDrawerLead(null)}
        onChangeStatus={changeStatus}
        onSaveNotes={saveNotes}
        savingStatus={savingStatus}
        savingNotes={savingNotes}
      />
    </div>
  );
}
