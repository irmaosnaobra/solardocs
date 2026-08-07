'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOWUP — "acompanhar os agentes trabalhando". Lê /admin/hub-followup?produto=X
// (whatsapp_sessions do agente do produto): quantos ativos, em conversa, com handoff
// (humano assumiu), opt-out, e a atividade recente. Só exibe.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubFollowup, HubConversaoBloco } from './hubFollowup.types';

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

// Funil do agente. O que não dá pra medir aparece como "—" — nunca como 0.
function FunilConversao({ b }: { b: HubConversaoBloco }) {
  const medivel = b.converteram !== null;
  const passos = [
    { label: 'Abordados', value: String(b.abordados), color: 'var(--color-text)' },
    { label: 'Responderam', value: String(b.responderam), color: '#2C9C67' },
    { label: 'Converteram', value: medivel ? String(b.converteram) : '—', color: medivel ? 'var(--color-primary)' : 'var(--color-text-muted)' },
    { label: 'Taxa de sucesso', value: b.taxa_pct !== null ? `${b.taxa_pct.toString().replace('.', ',')}%` : '—', color: b.taxa_pct !== null ? 'var(--color-primary)' : 'var(--color-text-muted)' },
  ];
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>{b.rotulo}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>Converteu = {b.medida}.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        {passos.map((p, i) => (
          <div key={i}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{p.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: p.color }}>{p.value}</div>
          </div>
        ))}
      </div>
      {!medivel && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
          Sem sessão nesse recorte pra medir conversão ainda.
        </div>
      )}
    </div>
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

      {data?.conversao
        ? data.conversao.map((b, i) => <FunilConversao key={i} b={b} />)
        : (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Sucesso de conversão</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-muted)' }}>—</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {loading ? 'Carregando…' : 'Este produto ainda não tem agente de followup — não há o que medir.'}
            </div>
          </div>
        )}

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
          <thead><tr><th>Cliente</th><th>Última mensagem</th><th>Situação</th><th>Resultado</th><th style={{ textAlign: 'right' }}>Atualizado</th></tr></thead>
          <tbody>
            {(data?.sessions ?? []).length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>{loading ? 'Carregando…' : 'Nenhuma sessão do agente no período.'}</td></tr>
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
                <td>
                  {row.converteu === true && <Badge label="converteu" color="var(--color-primary)" />}
                  {row.converteu === false && row.respondeu && <Badge label="respondeu" color="#2C9C67" />}
                  {row.converteu === false && !row.respondeu && <span style={{ color: 'var(--color-text-muted)' }}>sem resposta</span>}
                  {row.converteu === null && <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtWhen(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Fonte: <code>/admin/hub-followup</code> (whatsapp_sessions do agente do produto, cruzado com a compra/agenda de cada
        produto pro &quot;converteu&quot;). Só leitura — não dispara nada.
      </p>
    </div>
  );
}
