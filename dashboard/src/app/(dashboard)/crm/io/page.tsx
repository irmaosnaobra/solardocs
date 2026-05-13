'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/services/api';
import styles from './io.module.css';

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

// ── Config dos status ──────────────────────────────────────────────
const STATUS_LIST: { id: IoStatus; label: string; emoji: string; color: string; bg: string }[] = [
  { id: 'novo',       label: 'Novo lead',  emoji: '🆕', color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
  { id: 'em_contato', label: 'Em contato', emoji: '💬', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  { id: 'frio',       label: 'Frio',       emoji: '🧊', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)' },
  { id: 'morno',      label: 'Morno',      emoji: '🌤️', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  { id: 'quente',     label: 'Quente',     emoji: '🔥', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  { id: 'followup',   label: 'Follow-up',  emoji: '📅', color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
  { id: 'vendido',    label: 'Vendido',    emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  { id: 'perdido',    label: 'Perdido',    emoji: '❌', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
];
const STATUS_BY_ID = Object.fromEntries(STATUS_LIST.map(s => [s.id, s])) as Record<IoStatus, typeof STATUS_LIST[0]>;

// ── Helpers ────────────────────────────────────────────────────────
function fmtBRL(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtWhats(w: string) {
  const v = w.replace(/\D/g, '').slice(-11);
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
  return ({ avista: 'À vista', cartao: 'Cartão (18x)', financiamento: 'Financiamento (84x)' } as any)[p || ''] || (p || '—');
}
function fmtTipo(t: string | null) {
  if (!t) return '—';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fmtPadrao(p: string | null) {
  return ({ mono110: 'Mono 110V', mono220: 'Mono 220V', bif220: 'Bifásico 220V', tri220: 'Trifásico' } as any)[p || ''] || (p || '—');
}

// ── Componente ─────────────────────────────────────────────────────
export default function CrmIoPage() {
  const [leads, setLeads] = useState<IoLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<IoStatus | 'todos'>('todos');
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);
  const [editingNotes, setEditingNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/io-leads');
      setLeads(data.leads || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return leads.filter(l => {
      if (filterStatus !== 'todos' && l.status !== filterStatus) return false;
      if (search) {
        const s = search.toLowerCase();
        const hit = [l.nome, l.whatsapp, l.cidade, l.estado].some(x => (x || '').toLowerCase().includes(s));
        if (!hit) return false;
      }
      return true;
    });
  }, [leads, filterStatus, search]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { todos: leads.length };
    STATUS_LIST.forEach(s => { map[s.id] = leads.filter(l => l.status === s.id).length; });
    return map;
  }, [leads]);

  const selected = useMemo(() => leads.find(l => l.id === selectedId) || null, [leads, selectedId]);

  useEffect(() => {
    if (!selectedId) { setHistory([]); setEditingNotes(''); return; }
    setEditingNotes(selected?.notes || '');
    api.get(`/io-leads/${selectedId}/history`).then(r => setHistory(r.data.history || [])).catch(() => setHistory([]));
  }, [selectedId, selected?.notes]);

  async function changeStatus(id: string, status: IoStatus, note?: string) {
    setSavingStatus(true);
    try {
      await api.patch(`/io-leads/${id}`, { status, note: note || undefined });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status, last_contact_at: new Date().toISOString() } : l));
      if (id === selectedId) {
        const r = await api.get(`/io-leads/${id}/history`);
        setHistory(r.data.history || []);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao atualizar status');
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveNotes() {
    if (!selectedId) return;
    setSavingNotes(true);
    try {
      await api.patch(`/io-leads/${selectedId}`, { notes: editingNotes });
      setLeads(prev => prev.map(l => l.id === selectedId ? { ...l, notes: editingNotes } : l));
    } catch (e) {
      alert('Erro ao salvar notas');
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>🏗️ CRM Irmãos na Obra</h1>
          <p className={styles.subtitle}>{leads.length} leads no total · funil completo do simulador /io</p>
        </div>
        <button className={styles.refresh} onClick={load} disabled={loading}>{loading ? 'Atualizando…' : '🔄 Atualizar'}</button>
      </header>

      <div className={styles.statsRow}>
        <button
          className={`${styles.statChip} ${filterStatus === 'todos' ? styles.statChipActive : ''}`}
          onClick={() => setFilterStatus('todos')}
        >
          <span className={styles.statLbl}>Todos</span>
          <span className={styles.statVal}>{counts.todos}</span>
        </button>
        {STATUS_LIST.map(s => (
          <button
            key={s.id}
            className={`${styles.statChip} ${filterStatus === s.id ? styles.statChipActive : ''}`}
            onClick={() => setFilterStatus(s.id)}
            style={filterStatus === s.id ? { background: s.bg, borderColor: s.color, color: s.color } : {}}
          >
            <span className={styles.statLbl}>{s.emoji} {s.label}</span>
            <span className={styles.statVal} style={{ color: s.color }}>{counts[s.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        <input
          type="text"
          placeholder="Buscar nome, WhatsApp ou cidade..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={styles.search}
        />
        <span className={styles.resultCount}>{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className={styles.layout}>
        <div className={styles.listCol}>
          {loading ? (
            <div className={styles.empty}>Carregando leads...</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              {leads.length === 0
                ? 'Nenhum lead ainda. Os leads aparecerão aqui quando alguém concluir o simulador em /io/simular.'
                : 'Nenhum lead corresponde ao filtro.'}
            </div>
          ) : filtered.map(l => {
            const st = STATUS_BY_ID[l.status] || STATUS_BY_ID.novo;
            const isSel = l.id === selectedId;
            return (
              <button
                key={l.id}
                className={`${styles.card} ${isSel ? styles.cardActive : ''}`}
                onClick={() => setSelectedId(l.id)}
                style={isSel ? { borderColor: st.color } : {}}
              >
                <div className={styles.cardTop}>
                  <span className={styles.statusBadge} style={{ background: st.bg, color: st.color }}>{st.emoji} {st.label}</span>
                  <span className={styles.timeAgo}>{fmtRel(l.created_at)}</span>
                </div>
                <div className={styles.cardName}>{l.nome}</div>
                <div className={styles.cardMeta}>
                  <span>📍 {l.cidade ? `${l.cidade}/${l.estado || ''}` : '—'}</span>
                  <span>💰 {fmtBRL(l.consumo_rs)}/mês</span>
                </div>
                <div className={styles.cardPlanos}>
                  {l.comercial_preco != null && <span><b>C:</b> {fmtBRL(l.comercial_preco)}</span>}
                  {l.premium_preco != null && <span><b>P:</b> {fmtBRL(l.premium_preco)}</span>}
                  <span style={{ marginLeft: 'auto', opacity: .7 }}>{fmtPag(l.pagamento)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className={styles.detailCol}>
          {!selected ? (
            <div className={styles.detailEmpty}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>👈</div>
              <div>Selecione um lead pra ver os detalhes</div>
            </div>
          ) : (
            <div className={styles.detailCard}>
              <div className={styles.detailHead}>
                <div>
                  <div className={styles.detailName}>{selected.nome}</div>
                  <div className={styles.detailContact}>
                    <a href={`https://wa.me/55${selected.whatsapp}`} target="_blank" rel="noopener noreferrer" className={styles.waLink}>
                      📲 {fmtWhats(selected.whatsapp)}
                    </a>
                    <span> · {selected.cidade ? `${selected.cidade}/${selected.estado || ''}` : '—'}</span>
                  </div>
                </div>
                <span className={styles.statusBadge} style={{ background: STATUS_BY_ID[selected.status].bg, color: STATUS_BY_ID[selected.status].color, fontSize: 14, padding: '6px 14px' }}>
                  {STATUS_BY_ID[selected.status].emoji} {STATUS_BY_ID[selected.status].label}
                </span>
              </div>

              <div className={styles.detailGrid}>
                <div className={styles.detailField}><div className={styles.detailLbl}>Tipo</div><div className={styles.detailVal}>{fmtTipo(selected.tipo)} · {fmtTipo(selected.telhado)}</div></div>
                <div className={styles.detailField}><div className={styles.detailLbl}>Padrão</div><div className={styles.detailVal}>{fmtPadrao(selected.padrao)}</div></div>
                <div className={styles.detailField}><div className={styles.detailLbl}>Conta atual</div><div className={styles.detailVal}>{fmtBRL(selected.consumo_rs)}/mês</div></div>
                <div className={styles.detailField}><div className={styles.detailLbl}>Forma de pagamento</div><div className={styles.detailVal}>{fmtPag(selected.pagamento)}</div></div>
              </div>

              <div className={styles.planosCard}>
                <div className={`${styles.planBox} ${selected.plano_escolhido === 'comercial' ? styles.planBoxActive : ''}`}>
                  <div className={styles.planTag}>💼 Comercial</div>
                  <div className={styles.planPrice}>{fmtBRL(selected.comercial_preco)}</div>
                  <div className={styles.planSpecs}>
                    {selected.comercial_kwp ? `${selected.comercial_kwp} kWp` : '—'}
                    {selected.comercial_inv ? ` · ${selected.comercial_inv}` : ''}
                  </div>
                </div>
                <div className={`${styles.planBox} ${selected.plano_escolhido === 'premium' ? styles.planBoxActive : ''}`}>
                  <div className={styles.planTag}>⭐ Premium</div>
                  <div className={styles.planPrice}>{fmtBRL(selected.premium_preco)}</div>
                  <div className={styles.planSpecs}>
                    {selected.premium_kwp ? `${selected.premium_kwp} kWp` : '—'}
                    {selected.premium_inv ? ` · ${selected.premium_inv}` : ''}
                  </div>
                </div>
              </div>

              <div className={styles.actionsRow}>
                <div className={styles.actionsLbl}>Mover pra:</div>
                <div className={styles.actionsBtns}>
                  {STATUS_LIST.filter(s => s.id !== selected.status).map(s => (
                    <button
                      key={s.id}
                      className={styles.actBtn}
                      style={{ background: s.bg, color: s.color, borderColor: s.color }}
                      disabled={savingStatus}
                      onClick={() => changeStatus(selected.id, s.id)}
                    >
                      {s.emoji} {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.notesSection}>
                <div className={styles.detailLbl}>Notas do atendente</div>
                <textarea
                  className={styles.notesArea}
                  value={editingNotes}
                  onChange={e => setEditingNotes(e.target.value)}
                  placeholder="Anotações sobre o lead, próximos passos, objeções..."
                />
                <button
                  className={styles.saveBtn}
                  onClick={saveNotes}
                  disabled={savingNotes || editingNotes === (selected.notes || '')}
                >
                  {savingNotes ? 'Salvando...' : '💾 Salvar notas'}
                </button>
              </div>

              {history.length > 0 && (
                <div className={styles.historySection}>
                  <div className={styles.detailLbl}>Histórico de status</div>
                  <div className={styles.historyList}>
                    {history.map(h => (
                      <div key={h.id} className={styles.historyRow}>
                        <span className={styles.historyTime}>{fmtRel(h.created_at)}</span>
                        <span>
                          {h.from_status ? `${STATUS_BY_ID[h.from_status as IoStatus]?.emoji || ''} ${h.from_status}` : 'Criado'}
                          {' → '}
                          {STATUS_BY_ID[h.to_status as IoStatus]?.emoji || ''} {h.to_status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.metaFooter}>
                Criado {fmtRel(selected.created_at)}
                {selected.last_contact_at ? ` · Último contato ${fmtRel(selected.last_contact_at)}` : ''}
                {selected.utm_source ? ` · origem: ${selected.utm_source}${selected.utm_campaign ? '/' + selected.utm_campaign : ''}` : ''}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
