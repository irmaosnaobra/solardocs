'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DE VENDA (Solar / Eletroposto) — visitas das LPs /io/*. Lê /admin/analytics
// e filtra as sessões pelo caminho da LP (page_visits, via o beacon /_t/v que as
// páginas passaram a mandar). Funil visita → rolou 50% → clicou CTA.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
// Retenção do vídeo de entrada. Mora aqui embaixo (e não em aba própria) porque
// "deram play" só significa alguma coisa dividido pelas visitas desta mesma tela.
import VslPanel from './VslPanel';

interface SessionRow { landing_url: string | null; max_scroll: number; cta_clicks: { label?: string }[]; utm_source?: string | null; }
interface Analytics { sessions: SessionRow[]; }

const PERIODS: { k: string; label: string }[] = [
  { k: 'hoje', label: 'Hoje' }, { k: '7dias', label: '7 dias' }, { k: 'mes', label: 'Mês' }, { k: 'maximo', label: 'Máx' },
];
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function IoLpPanel({ match }: { match: string }) {
  const [period, setPeriod] = useState('7dias');
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((p: string) => {
    setLoading(true);
    api.get(`/admin/analytics?limit=500&period=${p}`)
      .then((r) => { const all = ((r.data as Analytics)?.sessions) || []; setRows(all.filter((s) => (s.landing_url || '').includes(match))); })
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [match]);
  useEffect(() => { load(period); }, [period, load]);

  const visits = rows?.length ?? 0;
  const scrolled = (rows ?? []).filter((s) => (s.max_scroll ?? 0) >= 50).length;
  const clicked = (rows ?? []).filter((s) => (s.cta_clicks?.length ?? 0) > 0).length;
  const steps = [
    { label: 'Visitas', v: visits },
    { label: 'Rolou 50%', v: scrolled },
    { label: 'Clicou (WhatsApp/CTA)', v: clicked },
  ];

  // fontes de tráfego
  const bySource = new Map<string, number>();
  for (const s of rows ?? []) { const k = s.utm_source || '(direto)'; bySource.set(k, (bySource.get(k) ?? 0) + 1); }
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div>
      <div className={styles.periodTabs}>
        {PERIODS.map((p) => (
          <button key={p.k} className={period === p.k ? styles.periodActive : styles.periodBtn} onClick={() => setPeriod(p.k)}>{p.label}</button>
        ))}
        <button className={styles.periodBtn} disabled={loading} onClick={() => load(period)} style={{ marginLeft: 'auto' }}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.card} style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Jornada na LP <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)' }}>{match}</span></div>
        {visits === 0 ? (
          <p className={styles.empty} style={{ margin: 0 }}>
            {loading ? 'Carregando…' : 'Sem visitas rastreadas ainda — o beacon foi ligado agora; enche conforme o tráfego chega.'}
          </p>
        ) : (
          <div className={styles.funnelSteps}>
            {steps.map((s, i) => (
              <div key={i} className={styles.funnelStep}>
                <div className={styles.funnelLabel}>{s.label}</div>
                <div className={styles.funnelBar}><div className={styles.funnelFill} style={{ width: `${pct(s.v, visits)}%` }} /></div>
                <div className={styles.funnelValue}>{s.v.toLocaleString('pt-BR')} <span className={styles.funnelPct}>{pct(s.v, visits)}%</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sources.length > 0 && (
        <div className={styles.tableWrap} style={{ marginTop: 16 }}>
          <table className={styles.table}>
            <thead><tr><th>Fonte (utm_source)</th><th style={{ textAlign: 'right' }}>Visitas</th></tr></thead>
            <tbody>{sources.map(([src, n], i) => (<tr key={i}><td>{src}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n}</td></tr>))}</tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Fonte: <code>/admin/analytics</code> filtrado por <code>{match}</code> (page_visits, beacon novo na LP).
      </p>

      {match === '/io/eletroposto' && <VslPanel lp="eletroposto" />}
    </div>
  );
}
