'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DE VENDA (LP) — SolarDoc. Reusa /admin/analytics: quem entra na LP, até
// onde rola, quem viu preços e quem clicou no CTA — e a conversão até assinante.
// Funil em barras (proporção sobre as visitas) + fontes de tráfego.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface SourceRow { source: string; visits: number; scroll_50: number; saw_precos: number; cta_clicks: number; }
interface Analytics {
  total: number; today: number; avg_time: number | null;
  funnel: { visits: number; scroll_50: number; saw_precos: number; cta_clicks: number };
  conversion: { cadastros: number; empresas: number; assinantes: number };
  sources: SourceRow[];
}

const PERIODS: { k: string; label: string }[] = [
  { k: 'hoje', label: 'Hoje' }, { k: '7dias', label: '7 dias' }, { k: 'mes', label: 'Mês' }, { k: 'maximo', label: 'Máx' },
];
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function LpVendaPanel() {
  const [period, setPeriod] = useState('7dias');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((p: string) => {
    setLoading(true);
    api.get(`/admin/analytics?limit=300&period=${p}`).then((r) => setData(r.data as Analytics)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(period); }, [period, load]);

  const f = data?.funnel;
  const base = f?.visits ?? 0;
  const steps = f ? [
    { label: 'Visitas', value: f.visits },
    { label: 'Scroll 50%', value: f.scroll_50 },
    { label: 'Viu preços', value: f.saw_precos },
    { label: 'Clicou CTA', value: f.cta_clicks },
  ] : [];
  const conv = data?.conversion;
  const convCards = conv ? [
    { label: 'Cadastros', value: conv.cadastros },
    { label: 'Empresas', value: conv.empresas },
    { label: 'Assinantes', value: conv.assinantes },
  ] : [];

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

      {/* funil da LP */}
      <div className={styles.card} style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Jornada na página de venda</div>
        {steps.length === 0 ? (
          <p className={styles.empty}>{loading ? 'Carregando…' : 'Sem visitas no período.'}</p>
        ) : (
          <div className={styles.funnelSteps}>
            {steps.map((s, i) => (
              <div key={i} className={styles.funnelStep}>
                <div className={styles.funnelLabel}>{s.label}</div>
                <div className={styles.funnelBar}>
                  <div className={styles.funnelFill} style={{ width: `${pct(s.value, base)}%` }} />
                </div>
                <div className={styles.funnelValue}>
                  {s.value.toLocaleString('pt-BR')} <span className={styles.funnelPct}>{pct(s.value, base)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* conversão até assinante */}
      <div className={styles.cards} style={{ marginTop: 14 }}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Visitas (total)</div>
          <div className={styles.cardValue}>{(data?.total ?? 0).toLocaleString('pt-BR')}</div>
          <div className={styles.cardSub}>{data?.today ?? 0} hoje</div>
        </div>
        {convCards.map((c, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.cardLabel}>{c.label}</div>
            <div className={styles.cardValue}>{c.value.toLocaleString('pt-BR')}</div>
            <div className={styles.cardSub}>{pct(c.value, base)}% das visitas</div>
          </div>
        ))}
      </div>

      {/* fontes de tráfego */}
      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Fonte</th><th style={{ textAlign: 'right' }}>Visitas</th><th style={{ textAlign: 'right' }}>Viu preços</th><th style={{ textAlign: 'right' }}>CTA</th></tr></thead>
          <tbody>
            {(data?.sources ?? []).length === 0 && (
              <tr><td colSpan={4} className={styles.empty}>{loading ? 'Carregando…' : 'Sem fontes no período.'}</td></tr>
            )}
            {(data?.sources ?? []).slice(0, 12).map((s, i) => (
              <tr key={i}>
                <td>{s.source || '(direto)'}</td>
                <td style={{ textAlign: 'right' }}>{s.visits}</td>
                <td style={{ textAlign: 'right' }}>{s.saw_precos}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{s.cta_clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Dados de <code>/admin/analytics</code> (page_visits + lp_events da LP SolarDoc).
      </p>
    </div>
  );
}
