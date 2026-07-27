'use client';

// ─────────────────────────────────────────────────────────────────────────────
// RECEITA / ROAS — SolarDoc. Reusa /admin/revenue (MRR por campanha, vínculo
// forward-only UTM→Stripe) + /admin/meta-funnel (gasto Meta, só leitura) pra o ROAS.
// Espelha o bloco "Receita" que já existe (oculto) no /admin, num painel próprio.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface RevenueCampaignRow { campaign: string; campaign_name?: string; users: number; mrr: number; plans: Record<string, number>; }
interface RevenueData { period: string; total_mrr: number; total_users: number; mrr_source: string; by_campaign: RevenueCampaignRow[]; by_source: { source: string; users: number; mrr: number }[]; }
interface MetaFunnelData { available: boolean; meta_totals?: { spend: number; purchases: number }; }

const PERIODS: { k: string; label: string }[] = [
  { k: 'hoje', label: 'Hoje' }, { k: '7dias', label: '7 dias' }, { k: 'mes', label: 'Mês' }, { k: 'maximo', label: 'Máx' },
];
const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ReceitaPanel() {
  const [period, setPeriod] = useState('mes');
  const [rev, setRev] = useState<RevenueData | null>(null);
  const [meta, setMeta] = useState<MetaFunnelData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((p: string) => {
    setLoading(true);
    Promise.all([
      api.get(`/admin/revenue?period=${p}`).then((r) => r.data as RevenueData).catch(() => null),
      api.get(`/admin/meta-funnel?period=${p}`).then((r) => r.data as MetaFunnelData).catch(() => null),
    ]).then(([rv, mt]) => { setRev(rv); setMeta(mt); }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const spend = meta?.available ? (meta.meta_totals?.spend ?? 0) : 0;
  const mrr = rev?.total_mrr ?? 0;
  const roas = spend > 0 ? mrr / spend : null;

  const cards = [
    { label: 'MRR atribuído', value: fmtBRL(mrr), color: 'var(--color-primary)' },
    { label: 'Assinantes', value: String(rev?.total_users ?? 0), color: 'var(--color-text)' },
    { label: 'Gasto Meta', value: spend > 0 ? fmtBRL(spend) : '—', color: 'var(--color-text)' },
    { label: 'ROAS (MRR/gasto)', value: roas != null ? `${roas.toFixed(2)}×` : '—', color: roas != null && roas >= 1 ? '#2C9C67' : 'var(--color-text)' },
  ];

  return (
    <div>
      <div className={styles.periodTabs}>
        {PERIODS.map((p) => (
          <button key={p.k} className={period === p.k ? styles.periodActive : styles.periodBtn} onClick={() => setPeriod(p.k)}>{p.label}</button>
        ))}
        <button className={styles.periodBtn} disabled={loading} onClick={() => load(period)} style={{ marginLeft: 'auto' }}>
          {loading ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      <div className={styles.cards} style={{ marginTop: 12 }}>
        {cards.map((c, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.cardLabel}>{c.label}</div>
            <div className={styles.cardValue} style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Campanha</th><th style={{ textAlign: 'right' }}>Assinantes</th><th style={{ textAlign: 'right' }}>MRR</th></tr></thead>
          <tbody>
            {(rev?.by_campaign ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Sem receita atribuída no período.'}</td></tr>
            )}
            {(rev?.by_campaign ?? []).map((c, i) => (
              <tr key={i}>
                <td>{c.campaign_name || c.campaign || '—'}</td>
                <td style={{ textAlign: 'right' }}>{c.users}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtBRL(c.mrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        MRR de <code>/admin/revenue</code> (vínculo UTM→Stripe forward-only) · gasto de <code>/admin/meta-funnel</code> (Meta só leitura).
      </p>
    </div>
  );
}
