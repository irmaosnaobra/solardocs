'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes' | 'maximo';

interface FunnelStep {
  key: 'vsl' | 'landing' | 'cadastro' | 'stripe' | 'plataforma';
  label: string;
  count: number;
  sub?: string;
}
interface FunnelData {
  period: Period;
  since: string;
  steps: FunnelStep[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoje',    label: 'Hoje' },
  { value: 'ontem',   label: 'Ontem' },
  { value: '7dias',   label: '7 dias' },
  { value: '30dias',  label: '30 dias' },
  { value: 'mes',     label: 'Mês' },
  { value: 'maximo',  label: 'Máximo' },
];

// Cores por etapa — degradê quente da VSL → laranja da plataforma
const STEP_COLORS: Record<FunnelStep['key'], { bg: string; border: string; accent: string }> = {
  vsl:        { bg: 'rgba(139, 92, 246, 0.10)', border: 'rgba(139, 92, 246, 0.30)', accent: '#a78bfa' },
  landing:    { bg: 'rgba(59, 130, 246, 0.10)', border: 'rgba(59, 130, 246, 0.30)', accent: '#60a5fa' },
  cadastro:   { bg: 'rgba(16, 185, 129, 0.10)', border: 'rgba(16, 185, 129, 0.30)', accent: '#34d399' },
  stripe:     { bg: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.30)', accent: '#fbbf24' },
  plataforma: { bg: 'rgba(239, 68, 68, 0.10)',  border: 'rgba(239, 68, 68, 0.30)',  accent: '#f87171' },
};

const STEP_DESCRIPTIONS: Record<FunnelStep['key'], string> = {
  vsl:        'Acessaram a página do vídeo de venda',
  landing:    'Chegaram na home solardoc.app',
  cadastro:   'Criaram conta na plataforma',
  stripe:     'Passaram cartão (trial 7d ou pagantes)',
  plataforma: 'Geraram ao menos 1 documento',
};

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default function FunilPage() {
  const [period, setPeriod] = useState<Period>('30dias');
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<FunnelData>('/admin/funnel', { params: { period } });
      setData(data);
    } catch {
      setError('Erro ao carregar funil. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchFunnel(); }, [fetchFunnel]);

  const topCount = data?.steps?.[0]?.count ?? 0;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
            Funil da operação SolarDoc
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: '6px 0 0' }}>
            VSL → Landing → Cadastro → Stripe → Plataforma · counts únicos por sessão (page_visits) ou usuário (users/documents)
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, background: 'var(--color-surface)', padding: 4, borderRadius: 10, border: '1px solid var(--color-border)' }}>
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 700,
                border: 0,
                borderRadius: 8,
                cursor: 'pointer',
                background: period === p.value ? 'var(--color-primary)' : 'transparent',
                color: period === p.value ? '#0f172a' : 'var(--color-text-muted)',
                fontFamily: 'inherit',
                transition: 'background 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Carregando funil…
        </div>
      )}

      {error && (
        <div style={{ padding: 24, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, color: '#f87171' }}>
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Funil horizontal — 5 cards + setas de conversão */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}>
            {data.steps.map((step, i) => {
              const colors = STEP_COLORS[step.key];
              const prev = data.steps[i - 1];
              const prevPct = i === 0 ? null : pct(step.count, prev.count);
              const totalPct = i === 0 ? null : pct(step.count, topCount);
              const dropoff = i === 0 || prev.count === 0 ? null : ((prev.count - step.count) / prev.count * 100).toFixed(1);

              return (
                <div key={step.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 220px', minWidth: 220 }}>
                  {/* Seta entre cards (não exibe antes do primeiro) */}
                  {i > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 6px', minWidth: 70 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {prevPct}
                      </div>
                      <div style={{ fontSize: 22, color: 'var(--color-text-muted)' }}>→</div>
                      {dropoff && Number(dropoff) > 0 && (
                        <div style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>
                          −{dropoff}%
                        </div>
                      )}
                    </div>
                  )}

                  {/* Card da etapa */}
                  <div style={{
                    flex: 1,
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 16,
                    padding: '20px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.accent }}>
                      {i + 1}. {step.label}
                    </div>
                    <div style={{ fontSize: 38, fontWeight: 900, color: 'var(--color-text)', lineHeight: 1, marginTop: 4 }}>
                      {step.count.toLocaleString('pt-BR')}
                    </div>
                    {step.sub && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {step.sub}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                      {STEP_DESCRIPTIONS[step.key]}
                    </div>
                    {totalPct !== null && (
                      <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11, color: colors.accent, fontWeight: 700, letterSpacing: '0.04em' }}>
                        {totalPct} do topo
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resumo de conversões macro */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { label: 'VSL → Cadastro',     val: pct(data.steps[2].count, data.steps[0].count) },
              { label: 'Landing → Cadastro', val: pct(data.steps[2].count, data.steps[1].count) },
              { label: 'Cadastro → Stripe',  val: pct(data.steps[3].count, data.steps[2].count) },
              { label: 'Stripe → Ativo',     val: pct(data.steps[4].count, data.steps[3].count) },
              { label: 'VSL → Pagante',      val: pct(data.steps[3].count, data.steps[0].count) },
              { label: 'VSL → Ativo',        val: pct(data.steps[4].count, data.steps[0].count) },
            ].map(m => (
              <div key={m.label} style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '16px 18px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>
                  {m.val}
                </div>
              </div>
            ))}
          </div>

          {/* Notas */}
          <div style={{ marginTop: 32, padding: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--color-text)' }}>Como ler:</strong> os números são únicos —
            visitantes únicos por sessão (VSL/Landing) e usuários distintos (Cadastro/Stripe/Plataforma).
            "Pageviews" no canto inferior conta o total de visitas (com re-visita). VSL conta acessos a
            <code style={{ padding: '0 4px' }}>/apresentacao</code>; Landing conta a home
            <code style={{ padding: '0 4px' }}>solardoc.app/</code> (excluindo /io, /gerador, /auth, /apresentacao).
          </div>
        </>
      )}
    </div>
  );
}
