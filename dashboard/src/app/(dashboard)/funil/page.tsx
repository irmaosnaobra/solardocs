'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import styles from './funil.module.css';

interface FunnelStep {
  label: string;
  count: number;
  icon: string;
}

const DAYS_OPTIONS = [
  { label: 'Hoje', value: 1 },
  { label: '7 dias', value: 7 },
  { label: '30 dias', value: 30 },
];

export default function FunilPage() {
  const router = useRouter();
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [totalSessions, setTotalSessions] = useState(0);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Verificar se o usuário é admin antes de carregar o funil
    api.get('/auth/me')
      .then(({ data }) => {
        if (!data?.is_admin) {
          router.replace('/dashboard');
          return;
        }
        setAuthorized(true);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    setLoading(true);
    api.get(`/quiz/funnel?days=${days}`)
      .then(({ data }) => {
        setFunnel(data.funnel ?? []);
        setTotalSessions(data.total_sessions ?? 0);
      })
      .finally(() => setLoading(false));
  }, [days, authorized]);

  const maxCount = Math.max(...funnel.map(s => s.count), 1);
  const top = funnel[0]?.count || 1;

  if (!authorized) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Funil de Conversão</h1>
          <p className={styles.subtitle}>Do quiz até a compra — etapa por etapa</p>
        </div>
        <div className={styles.filters}>
          {DAYS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`${styles.filterBtn} ${days === opt.value ? styles.filterActive : ''}`}
              onClick={() => setDays(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className={styles.empty}>Carregando...</p>
      ) : (
        <div className={styles.funnel}>
          {funnel.map((step, i) => {
            const pct = top > 0 ? Math.round((step.count / top) * 100) : 0;
            const dropPct = i > 0 && funnel[i - 1].count > 0
              ? Math.round(((funnel[i - 1].count - step.count) / funnel[i - 1].count) * 100)
              : null;
            const isLast = step.label === 'Comprou';

            return (
              <div key={i} className={styles.step}>
                {dropPct !== null && dropPct > 0 && (
                  <div className={styles.drop}>▼ {dropPct}% saíram aqui</div>
                )}
                <div className={styles.stepRow}>
                  <div className={styles.stepLeft}>
                    <span className={styles.stepIcon}>{step.icon}</span>
                    <span className={styles.stepLabel}>{step.label}</span>
                  </div>
                  <div className={styles.stepRight}>
                    <div className={styles.barWrap}>
                      <div
                        className={`${styles.bar} ${isLast ? styles.barGreen : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={styles.stepCount}>
                      {step.count.toLocaleString('pt-BR')}
                      <span className={styles.stepPct}> ({pct}%)</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {funnel.length > 0 && (
            <div className={styles.summary}>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Sessões no quiz</span>
                <span className={styles.summaryValue}>{totalSessions.toLocaleString('pt-BR')}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Completaram</span>
                <span className={styles.summaryValue}>
                  {funnel.find(s => s.label === 'Completou o Quiz')?.count ?? 0}
                </span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Foram à LP</span>
                <span className={styles.summaryValue}>
                  {funnel.find(s => s.label === 'Clicou pra LP')?.count ?? 0}
                </span>
              </div>
              <div className={`${styles.summaryCard} ${styles.summaryHighlight}`}>
                <span className={styles.summaryLabel}>Compraram</span>
                <span className={styles.summaryValue}>
                  {funnel.find(s => s.label === 'Comprou')?.count ?? 0}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
