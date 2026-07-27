'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOWUP — "acompanhar os agentes trabalhando". Lê /admin/hub-followup?produto=X
// (whatsapp_sessions do agente do produto): quantos ativos, em conversa, com handoff
// (humano assumiu), opt-out, e a atividade recente. Só exibe.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubFollowup } from './hubFollowup.types';

const fmtWhen = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 999, padding: '2px 8px', marginRight: 5 }}>
      {label}
    </span>
  );
}

export default function FollowupPanel({ produto }: { produto: string }) {
  const [data, setData] = useState<HubFollowup | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/admin/hub-followup?produto=${encodeURIComponent(produto)}`)
      .then((r) => setData(r.data as HubFollowup)).catch(() => {}).finally(() => setLoading(false));
  }, [produto]);
  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const cards = [
    { label: 'Sessões ativas', value: s?.total ?? 0, color: 'var(--color-primary)' },
    { label: 'Em conversa', value: s?.em_conversa ?? 0, color: '#2C9C67' },
    { label: 'Handoff (humano)', value: s?.handoff ?? 0, color: '#C87A1E' },
    { label: 'Opt-out / perdido', value: s?.opt_out ?? 0, color: '#B4544B' },
    { label: 'Últimas 24h', value: s?.ultimas24h ?? 0, color: 'var(--color-text)' },
    { label: 'Últimos 7d', value: s?.ultimos7d ?? 0, color: 'var(--color-text)' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.cards}>
        {cards.map((c, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.cardLabel}>{c.label}</div>
            <div className={styles.cardValue} style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Cliente</th><th>Última mensagem</th><th>Situação</th><th style={{ textAlign: 'right' }}>Atualizado</th></tr></thead>
          <tbody>
            {(data?.sessions ?? []).length === 0 && (
              <tr><td colSpan={4} className={styles.empty}>{loading ? 'Carregando…' : 'Nenhuma sessão do agente no período.'}</td></tr>
            )}
            {(data?.sessions ?? []).map((row, i) => (
              <tr key={i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{row.nome || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{row.phone}</div>
                </td>
                <td style={{ maxWidth: 340, color: 'var(--color-text-muted)', fontSize: 13 }}>
                  {row.last_role === 'user' ? '👤 ' : row.last_role === 'assistant' ? '🤖 ' : ''}
                  {row.last_msg || '—'}
                </td>
                <td>
                  {row.handed_off && <Badge label="handoff" color="#C87A1E" />}
                  {row.opt_out && <Badge label="opt-out" color="#B4544B" />}
                  {!row.handed_off && !row.opt_out && <Badge label="ativo" color="#2C9C67" />}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtWhen(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Fonte: <code>/admin/hub-followup</code> (whatsapp_sessions do agente do produto). Só leitura — não dispara nada.
      </p>
    </div>
  );
}
