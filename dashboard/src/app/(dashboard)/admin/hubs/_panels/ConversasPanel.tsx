'use client';

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSAS — as threads reais agente ↔ cliente (não só métrica). Lê o mesmo
// /admin/hub-followup?produto=X e mostra cada sessão expansível com as mensagens.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubFollowup, HubSession } from './hubFollowup.types';

const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

function Thread({ s }: { s: HubSession }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
      >
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{open ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{s.nome || s.phone}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.last_role === 'user' ? '👤 ' : '🤖 '}{s.last_msg || '—'}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          {s.msgs_count} msg · {fmtWhen(s.updated_at)}
        </div>
      </button>

      {open && (
        <div style={{ padding: '4px 16px 16px', display: 'grid', gap: 8, borderTop: '1px solid var(--color-border, rgba(127,127,127,.15))' }}>
          {s.messages.length === 0 && <p className={styles.empty}>Sem mensagens guardadas.</p>}
          {s.messages.map((m, i) => {
            const mine = m.role === 'assistant';
            return (
              <div key={i} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '78%', padding: '8px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                    background: mine ? 'var(--color-primary, #2A7DF0)' : 'var(--color-surface-2, rgba(127,127,127,.12))',
                    color: mine ? '#fff' : 'var(--color-text)',
                    borderBottomRightRadius: mine ? 3 : 12, borderBottomLeftRadius: mine ? 12 : 3,
                  }}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ConversasPanel({ produto }: { produto: string }) {
  const [data, setData] = useState<HubFollowup | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/admin/hub-followup?produto=${encodeURIComponent(produto)}`)
      .then((r) => setData(r.data as HubFollowup)).catch(() => {}).finally(() => setLoading(false));
  }, [produto]);
  useEffect(() => { load(); }, [load]);

  const sessions = data?.sessions ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{sessions.length} conversa(s) recentes</span>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>
      {sessions.length === 0 ? (
        <div className={styles.card}><p className={styles.empty} style={{ margin: 0 }}>{loading ? 'Carregando…' : 'Nenhuma conversa do agente no período.'}</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {sessions.map((s, i) => <Thread key={i} s={s} />)}
        </div>
      )}
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Threads reais de <code>whatsapp_sessions</code> (via <code>/admin/hub-followup</code>). Só leitura.
      </p>
    </div>
  );
}
